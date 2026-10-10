import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium,expect } from '@playwright/test';
import {waitForAppReady,dismissOnboarding} from '../../tests/e2e/support.mjs';
const scratch=process.env.RUNNER_TEMP;const out=path.join(scratch,'atlas-proof');
const roots={candidate:path.join(scratch,'atlas-candidate'),rollback:path.join(scratch,'atlas-rollback')};
const manifests={};for(const mode of ['candidate','rollback'])manifests[mode]=JSON.parse(await readFile(path.join(out,mode+'-manifest.json'),'utf8'));
const indexes={};for(const mode of ['candidate','rollback'])indexes[mode]=new Map(manifests[mode].files.map(x=>[x.path,x]));
const canonical='https://atlas.rambulls.dev';const old='https://rambulls.github.io';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon','.csv':'text/csv','.xml':'application/xml','.txt':'text/plain','.pdf':'application/pdf','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
let mode='candidate';const browser=await chromium.launch({channel:'chrome'});
const proof={browser:browser.version(),network:'Modeled HTTPS origins from exact immutable archives; no real certificate, DNS, provider header, redirect or cache proof.',contexts:[]};
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport,isMobile:viewport.width===390,hasTouch:viewport.width===390});
    const errors=[];const blocked=[];const violations=[];const missing=[];const served=[];
    await context.exposeBinding('__captureMigrationCsp',(_,event)=>violations.push(event));
    await context.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.__captureMigrationCsp({directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition})));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(![canonical,old].includes(url.origin)){blocked.push(url.origin);await route.abort();return;}
      const active=url.origin===old?'rollback':mode;
      let name=decodeURIComponent(url.pathname);if(url.origin===old){assert(name.startsWith('/control-atlas/'));name=name.slice('/control-atlas'.length);}
      name=name.slice(1);if(!name||name.endsWith('/'))name+='index.html';assert(!name.split('/').includes('..'));
      const item=indexes[active].get(name);
      if(!item){missing.push({name,mode:active});await route.fulfill({status:404,contentType:'text/html',body:await readFile(path.join(roots[active],'404.html'))});return;}
      const body=await readFile(path.join(roots[active],name));assert.equal(createHash('sha256').update(body).digest('hex'),item.sha256);
      served.push({mode:active,path:name,sha256:item.sha256});
      await route.fulfill({status:200,contentType:mime[path.extname(name)]||'application/octet-stream',body});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
    async function open(url){await page.goto(url,{waitUntil:'domcontentloaded'});await waitForAppReady(page,{allowPartial:true});await dismissOnboarding(page);}
    await open(old+'/control-atlas/#/library?q=AC-2');
    const oldStorage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
    mode='candidate';await open(canonical+'/#/library?q=AC-2');
    const newStorage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
    assert.deepEqual(oldStorage.local,[]);assert.deepEqual(newStorage.local,[]);
    await page.getByRole('button',{name:'Compare',exact:true}).click();
    const boxes=page.locator('input[type="checkbox"][aria-label*="for comparison"]');await expect(boxes).toHaveCount(2);
    await boxes.nth(0).click();await boxes.nth(1).click();
    const link=page.getByRole('link',{name:/^Compare 2$/});const generatedHref=await link.getAttribute('href');
    await link.click();await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});
    const bookmark=page.url();assert.equal(new URL(bookmark).origin,canonical);
    assert(new URL(bookmark).hash.includes('intent=item-mapping'));assert(new URL(bookmark).hash.includes('compareRun=true'));
    const row={viewport,oldStorage,newStorage,generatedHref,bookmark,phases:[]};
    for(const phase of ['candidate','rollback','candidate']) {
      mode=phase;await page.goto('about:blank');await open(bookmark);
      await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});
      const pendingDownload=page.waitForEvent('download');
      await page.getByRole('button',{name:'CSV',exact:true}).click();
      const download=await pendingDownload;assert.match(download.suggestedFilename(),/\.csv$/);
      const csv=await readFile(await download.path(),'utf8');assert(csv.length>30&&csv.length<1024*1024);assert.match(csv,/AC-2/);assert(csv.split('\n').length>=2);
      await page.reload();await waitForAppReady(page,{allowPartial:true});await dismissOnboarding(page);
      await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});
      const release=await page.evaluate(async()=>await(await fetch('./release.json')).json());assert.equal(release.commit_sha,manifests[mode].sha);
      const initialHash=new URL(page.url()).hash;assert.equal(initialHash,new URL(bookmark).hash);
      await page.evaluate(()=>{location.hash='/library?q=AC-2';});await waitForAppReady(page,{allowPartial:true});
      await page.goBack();await expect(page.locator('.compare-results-table tbody tr').first()).toBeVisible({timeout:60000});
      assert.equal(new URL(page.url()).hash,initialHash);
      await page.goForward();await expect(page.getByRole('button',{name:'Compare',exact:true})).toBeVisible();
      await open(canonical+'/#/atlas?atlasAxis=framework&atlasFramework=mitre-attack');
      await expect(page.getByRole('main')).toContainText(/ATT&CK Enterprise/,{timeout:60000});
      assert(new URL(page.url()).hash.includes('atlasFramework=mitre-attack'));
      await open(canonical+'/#/learn?pattern=read-a-record');await expect.poll(()=>new URL(page.url()).hash).toBe('#/library');
      await open(canonical+'/?migration-fixture=1#/library?q=AC-2');
      assert.equal(new URL(page.url()).search,'?migration-fixture=1');
      if(mode==='candidate'&&row.phases.length===0)await page.screenshot({path:path.join(out,'atlas-'+viewport.width+'.png'),fullPage:true});
      await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body));
      row.phases.push({mode,release_sha:release.commit_sha,bookmark_reload_history:true,legacy_scoped_route:true,retired_guide_destination:true,library_query:true,keyboard_focus:true,csv_download:{bytes:Buffer.byteLength(csv),sha256:createHash('sha256').update(csv).digest('hex')}});
    }
    assert.equal((await page.goto(canonical+'/missing-migration-page')).status(),404);
    assert.deepEqual(missing.map(x=>x.name).filter(x=>x!=='missing-migration-page'),[]);
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(violations,[]);
    row.served_count=served.length;row.served_unique=[...new Set(served.map(x=>x.mode+':'+x.path))].length;row.csp_events=violations;row.errors=errors;row.unexpected_requests=blocked;
    proof.contexts.push(row);await context.close();
  }
  proof.storage='Source inventory finds only origin-scoped introduction and chunk-reload session flags, no localStorage/IndexedDB/service-worker persistence. Genuine selection/comparison state is retained in the app-generated bookmark; origin flags need no user-data transfer.';
  await writeFile(path.join(out,'browser-proof.json'),JSON.stringify(proof,null,2));
} finally {await browser.close();}
