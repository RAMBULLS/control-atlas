import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNNER_TEMP = process.env.RUNNER_TEMP || '/tmp';
const PW_SPEC = process.env.PLAYWRIGHT_MODULE || pathToFileURL(path.join(RUNNER_TEMP, 'browser', 'node_modules', 'playwright', 'index.mjs')).href;
const BEACON_PATH = path.join(RUNNER_TEMP, 'beacon.min.js');
const OUT_DIR = path.join(RUNNER_TEMP, 'analytics-proof');
const OUT_FILE = path.join(OUT_DIR, 'privacy.json');

const HOSTS = ['https://rambulls.dev', 'https://atlas.rambulls.dev', 'https://orbital.rambulls.dev'];
const SYNTHETIC_TOKEN = '00000000000000000000000000000000';
const MARKERS = {
  PREVIOUS_SYNTHETIC_SECRET: 'PREV_SEC_9999',
  QUERY_SYNTHETIC_SECRET: 'QRY_SEC_8888',
  HASH_SYNTHETIC_SECRET: 'HSH_SEC_7777',
  QUERY_ROUTE_SECRET: 'RTE_QRY_6666',
  HASH_ROUTE_SECRET: 'RTE_HSH_5555'
};

function inspectForMarkers(val, currPath = '$', hits = []) {
  if (val === null || val === undefined) return hits;
  if (typeof val === 'string') {
    for (const [k, s] of Object.entries(MARKERS)) {
      if (val.includes(s)) hits.push({ marker: k, path: currPath, foundIn: val });
    }
  } else if (Array.isArray(val)) {
    val.forEach((item, idx) => inspectForMarkers(item, `${currPath}[${idx}]`, hits));
  } else if (typeof val === 'object') {
    for (const [prop, v] of Object.entries(val)) {
      for (const [k, s] of Object.entries(MARKERS)) {
        if (prop.includes(s)) hits.push({ marker: k, path: `${currPath}.<key:${prop}>`, foundIn: prop });
      }
      inspectForMarkers(v, `${currPath}.${prop}`, hits);
    }
  }
  return hits;
}

async function main() {
  let beaconBytes = '';
  beaconBytes = await fs.readFile(BEACON_PATH, 'utf-8');
  assert(beaconBytes.length > 1000 && beaconBytes.length < 262144, 'Actual official SDK required; no mock fallback');
  const sdkHash = createHash('sha256').update(beaconBytes).digest('hex');
  const { chromium } = await import(PW_SPEC);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const report = { timestamp: new Date().toISOString(), sdkHash, sdkBytesLength: beaconBytes.length, runs: {}, blockedRun: null, passed: true, gateStatus: 'PAYLOAD_DIAGNOSTIC_ONLY' };

  try {
    for (const host of HOSTS) {
      const hostRun = { host, capturedPosts: [], markersFound: [], initCount: 0, sdkRequests: 0, unexpectedRequests: [] };
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.route('**/*', async (route) => {
        const u = new URL(route.request().url());
        if (u.origin === host) {
          const html = `<!DOCTYPE html><html><head><title>Synthetic Test</title></head><body><h1>Ready</h1><button id="allow">Allow</button><script>window.__initCount=0; document.getElementById('allow').addEventListener('click', () => { window.__initCount++; const s = document.createElement('script'); s.onload=()=>{window.__sdkLoaded=true}; s.onerror=()=>{window.__sdkFailed=true}; s.type='module'; s.defer=true; s.src='https://static.cloudflareinsights.com/beacon.min.js'; s.setAttribute('data-cf-beacon', JSON.stringify({ token: '${SYNTHETIC_TOKEN}', spa: true })); document.head.appendChild(s); });</script></body></html>`;
          return route.fulfill({ status: 200, contentType: 'text/html', body: html });
        }
        if (route.request().url() === 'https://static.cloudflareinsights.com/beacon.min.js') {
          hostRun.sdkRequests++;
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: beaconBytes });
        }
        if (u.origin === 'https://cloudflareinsights.com' && u.pathname === '/cdn-cgi/rum' && route.request().method() === 'POST') {
          const postData = route.request().postData() || '';
          let parsed = null;
          try { parsed = JSON.parse(postData); } catch { parsed = postData; }
          const hits = inspectForMarkers(parsed);
          hostRun.capturedPosts.push({ url: route.request().url(), raw: postData, parsed, markerHits: hits });
          if (hits.length > 0) hostRun.markersFound.push(...hits);
          return route.fulfill({ status: 204, body: '' });
        }
        hostRun.unexpectedRequests.push(route.request().url()); return route.abort('blockedbyclient');
      });

      const page = await ctx.newPage();
      await page.goto(`${host}/prior?marker=${MARKERS.PREVIOUS_SYNTHETIC_SECRET}`);
      await page.goto(`${host}/?search=${MARKERS.QUERY_SYNTHETIC_SECRET}#/library?q=${MARKERS.HASH_SYNTHETIC_SECRET}`);
      assert.equal(hostRun.capturedPosts.length, 0, 'Unsolicited POST before consent');
      assert.equal(hostRun.sdkRequests, 0, 'SDK loaded before consent');
      hostRun.defaultOff = true;
      await page.click('#allow');
      await page.waitForFunction(()=>window.__sdkLoaded===true,{},{timeout:5000});
      hostRun.initCount=await page.evaluate(()=>window.__initCount);
      assert.equal(hostRun.initCount,1);assert.equal(hostRun.sdkRequests,1);
      hostRun.syntheticPage=await page.evaluate(()=>({referrer:document.referrer,location:location.href}));
      hostRun.storageBefore=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
      await page.evaluate(({ q, h }) => { history.pushState({}, '', `/?q=${q}#/compare?items=${h}`); }, { q: MARKERS.QUERY_ROUTE_SECRET, h: MARKERS.HASH_ROUTE_SECRET });
      await page.goto(`${host}/complete`);
      await page.waitForTimeout(500);
      assert(hostRun.capturedPosts.length > 0, 'No actual SDK payload captured');
      assert.equal(hostRun.unexpectedRequests.length,0);
      hostRun.cookies=await ctx.cookies();
      hostRun.storageAfter=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
      report.runs[host] = hostRun;
      if (hostRun.markersFound.length > 0) { report.gateStatus = 'LEAK_DETECTED'; report.passed = false; }
      await ctx.close();
    }

    const blockedCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await blockedCtx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === HOSTS[0]) {
        const html = `<!DOCTYPE html><html><head><title>Blocked SDK Fixture</title></head><body><h1>Ready</h1><script src="https://static.cloudflareinsights.com/beacon.min.js" onerror="window.__err=true"></script></body></html>`;
        return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      }
      return route.abort('blockedbyclient');
    });
    const blockedPage = await blockedCtx.newPage();
    await blockedPage.goto(`${HOSTS[0]}/`);
    const h1 = await blockedPage.locator('h1').textContent();assert.equal(h1,'Ready');
    report.blockedRun = { functionalH1: h1 === 'Ready', passed: h1 === 'Ready' };
    await blockedCtx.close();
  } finally {
    await browser.close();
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPayload = JSON.stringify(report, null, 2);
  assert(Buffer.byteLength(outPayload)<2097152);
  await fs.writeFile(OUT_FILE,outPayload);
  await fs.writeFile(path.join(OUT_DIR,'beacon.min.js'),beaconBytes);
  console.log(JSON.stringify({ result: report.passed ? 'QUALIFIED_PAYLOAD_ONLY' : 'GATE_HOLD', gateStatus: report.gateStatus, out: OUT_FILE }));
}
main().catch((e) => { console.error(e); process.exit(1); });
