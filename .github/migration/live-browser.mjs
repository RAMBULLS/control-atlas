import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {waitForAppReady,dismissOnboarding} from '../../tests/e2e/support.mjs';
const out=path.join(process.env.RUNNER_TEMP,'atlas-live-proof');
const sha=process.env.EXPECTED_DEPLOY_SHA;assert.match(sha,/^[a-f0-9]{40}$/);
const manifest=JSON.parse(await readFile(path.join(out,'live-manifest.json'),'utf8'));
assert.equal(manifest.sha,sha);const files=new Map(manifest.files.map(x=>[x.path,x]));
const canonical='https://atlas.rambulls.dev',old='https://rambulls.github.io/control-atlas';
const query='?source=test&x=1&x=2&empty=&utf8=%E2%9C%93';
const fragment='#/compare/relationships?source=nist-800-53&target=nist-800-53a&items=nist-800-53:AC-2&intent=item-mapping&compareRun=true';
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out: '+label)),60000);timer.unref();})]);}finally{clearTimeout(timer);}}
const browser=await chromium.launch({channel:'chrome'});
const proof={browser:browser.version(),network:'Actual normal trusted TLS; no interception, fulfillment or security bypass.',expected_sha:sha,contexts:[],status:'RUNNING'};
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  const context=await browser.newContext({viewport,isMobile:viewport.width===390,hasTouch:viewport.width===390});
  context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
  const errors=[],violations=[],unexpected=[],responses=[],pending=[],navigationAborts=[],workerHttpChecks=[],inspected=new Set();let bytes=0;
  await context.exposeBinding('__captureMigrationCsp',(_,x)=>violations.push(x));
  await context.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.__captureMigrationCsp({directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition})));
  context.on('request',req=>{const u=new URL(req.url());if(![canonical,'https://rambulls.github.io'].includes(u.origin))unexpected.push(req.url());});
  context.on('requestfailed',req=>{const url=req.url(),failure=req.failure()?.errorText||'unknown';const u=new URL(url);
   if(u.origin===canonical&&u.pathname.startsWith('/data/generated/library-search-index/')&&failure==='net::ERR_ABORTED')navigationAborts.push({url,failure});
   else errors.push('Request failed '+url+': '+failure);
  });
  context.on('requestfinished',req=>{
   if(new URL(req.url()).origin!==canonical)return;
   pending.push((async()=>{let name;try{const res=await req.response();if(!res)return;
    const u=new URL(res.url());name=decodeURIComponent(u.pathname).slice(1);if(!name||name.endsWith('/'))name+='index.html';
    if(res.status()===304)return;assert.equal(res.status(),200,'Completed response '+name);
    if(inspected.has(name))return;const expected=files.get(name);assert(expected,'Unexpected served path '+name);
    let body;
    try{body=await bounded(res.body(),'completed response body '+name);}catch(bodyError){
     if(name!=='assets/jsonParseWorker-vpjcTFyL.js'||!bodyError.message.includes('response.body: Target page, context or browser has been closed'))throw bodyError;
     assert(!page.isClosed(),'A closed browser page cannot qualify Worker HTTP coverage');
     const independent=await context.request.get(u.href,{timeout:15000,maxRedirects:0});assert.equal(independent.status(),200);
     const contentType=independent.headers()['content-type']?.split(';')[0];assert(['application/javascript','text/javascript'].includes(contentType));
     const fetched=await bounded(independent.body(),'independent Worker HTTP body');assert(fetched.length<=64*1024**2);
     const fetchedHash=createHash('sha256').update(fetched).digest('hex');assert.equal(fetchedHash,expected.sha256,name);
     workerHttpChecks.push({path:name,url:u.href,original_completed_browser_status:res.status(),original_browser_body_available:false,original_body_error:bodyError.message,
      verification:'Separate normal trusted TLS HTTP GET; does not prove original Worker browser-body bytes.',http_status:independent.status(),content_type:contentType,bytes:fetched.length,sha256:fetchedHash,expected_sha256:expected.sha256});
     inspected.add(name);return;
    }
    assert(body.length<=64*1024**2);bytes+=body.length;assert(bytes<=256*1024**2);
    const digest=createHash('sha256').update(body).digest('hex');assert.equal(digest,expected.sha256,name);inspected.add(name);
    responses.push({path:name,bytes:body.length,sha256:digest,status:res.status(),content_type:res.headers()['content-type'],completed:true});
   }catch(e){errors.push('Completed response '+(name||req.url())+': '+e.message);}})());
  });
  async function drainCompleted(){let count=0;while(count<pending.length){const next=pending.length;await bounded(Promise.all(pending.slice(count,next)),'completed response inspection');count=next;}}
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  async function checkpoint(phase){proof.last_checkpoint={phase,viewport,url:page.url(),completed_hashes:responses.length,bytes,errors:[...errors]};console.log(JSON.stringify(proof.last_checkpoint));await writeFile(path.join(out,'browser-proof.json'),JSON.stringify(proof,null,2));}
  async function open(url){await checkpoint('before '+url);await drainCompleted();await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await waitForAppReady(page,{allowPartial:true});await dismissOnboarding(page);await checkpoint('opened '+url);}
  await open(old+'/'+query+fragment);assert.equal(page.url(),canonical+'/'+query+fragment);
  await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});
  const old_bookmark_final=page.url();
  await checkpoint('CSV start');const downloadPromise=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:'CSV',exact:true}).click();
  const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.csv$/);
  const csv=await readFile(await bounded(download.path(),'completed CSV download'));await checkpoint('CSV downloaded');const csvSha=createHash('sha256').update(csv).digest('hex');
  assert.equal(csv.length,692);assert.equal(csvSha,'e7b0e3abfb572d06a8d056a56f76559dcc181bf08190735651b8d4cd18fcd2aa');
  await page.reload();await waitForAppReady(page,{allowPartial:true});await dismissOnboarding(page);
  await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});assert.equal(page.url(),old_bookmark_final);
  await open(canonical+'/'+query+'#/library?q=AC-2');await page.goBack();
  await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});assert.equal(page.url(),old_bookmark_final);
  await page.goForward();await expect(page.getByRole('button',{name:'Compare',exact:true})).toBeVisible();
  await open(canonical+'/#/atlas?atlasAxis=framework&atlasFramework=mitre-attack');
  await expect(page.getByRole('main')).toContainText(/ATT&CK Enterprise/,{timeout:60000});assert(new URL(page.url()).hash.includes('atlasFramework=mitre-attack'));
  await open(canonical+'/#/learn?pattern=read-a-record');await expect.poll(()=>new URL(page.url()).hash).toBe('#/library');
  await open(canonical+'/?migration-fixture=1#/library?q=AC-2');assert.equal(new URL(page.url()).search,'?migration-fixture=1');
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body));
  await page.screenshot({path:path.join(out,'atlas-'+viewport.width+'.png'),fullPage:true});
  const release=await context.request.get(canonical+'/release.json');assert.equal(release.status(),200);assert.equal((await release.json()).commit_sha,sha);
  const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));assert.deepEqual(storage.local,[]);
  await page.waitForLoadState('networkidle',{timeout:15000});await drainCompleted();assert(responses.length>10);assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);assert.deepEqual(unexpected,[]);
  await context.close();await drainCompleted();assert.deepEqual(errors,[]);
  proof.contexts.push({viewport,old_bookmark_final,bookmark_reload_history:true,legacy_scoped_route:true,retired_guide_destination:true,library_query:true,keyboard_focus:true,release_sha:sha,csv:{bytes:csv.length,sha256:csvSha},storage,responses,worker_http_checks:workerHttpChecks,navigation_aborts:navigationAborts,csp_events:violations,errors,unexpected_requests:unexpected});
 }
 proof.status='PASS';
}catch(e){proof.status='FAIL';proof.failure=e.stack;throw e;}finally{await writeFile(path.join(out,'browser-proof.json'),JSON.stringify(proof,null,2));await browser.close();}
