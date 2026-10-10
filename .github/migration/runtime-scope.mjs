import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {build} from 'vite';
const root=process.cwd(), scratch=process.env.RUNNER_TEMP;
assert(scratch && process.env.GITHUB_ACTIONS==='true');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'ef649b33622559543b677bb3bc13364122bcd3d9');
const expected=JSON.parse(fs.readFileSync(path.join(scratch,'runtime-expected.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const lockFindings=Object.entries(lock.packages).filter(([p])=>p.endsWith('/sprintf-js')).map(([p,m])=>({path:p,version:m.version,dev:m.dev===true}));
assert(lockFindings.some(m=>m.version==='1.0.3' && m.dev));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
let seen=[];
const results=await build({configFile:path.resolve('vite.config.ts'),copyPublicDir:false,build:{write:false,emptyOutDir:false},plugins:[{name:'runtime-scope-evidence',generateBundle(_options,bundle){
 for(const [filename,chunk] of Object.entries(bundle))if(chunk.type==='chunk')seen.push({filename,modules:Object.entries(chunk.modules).map(([id,m])=>({id:id.startsWith(root+'/')?id.slice(root.length+1):'external:'+hash(id),chainMatch:/node_modules\/(?:sprintf-js|argparse|js-yaml|@lhci\/(?:cli|utils))\//.test(id)?id.replace(root+'/',''):null,renderedLength:m.renderedLength})),sha256:hash(chunk.code)});
}}]});
const outputs=(Array.isArray(results)?results:[results]).flatMap(r=>r.output);
const js=outputs.filter(x=>x.fileName.endsWith('.js')).map(x=>({path:x.fileName,sha256:hash(x.type==='chunk'?x.code:x.source)}));
const standalone=[];
for(const [filename,sha] of Object.entries(expected))if(!js.some(x=>x.path===filename)){
 assert.equal(filename,'progressive-shell.js','Unexpected non-emitted JavaScript');
 const content=fs.readFileSync(path.join(root,'src/public',filename));assert.equal(hash(content),sha);
 assert(!/\b(?:import\s*\(|require\s*\(|from\s*['"])/.test(content.toString()),'Standalone script contains module imports');
 standalone.push({path:filename,sha256:sha,classification:'Existing classic public script, source byte-matched to immutable artifact; no module imports'});js.push({path:filename,sha256:sha});
}
assert(js.length>0);assert.equal(js.length,Object.keys(expected).length);
for(const row of js)assert.equal(row.sha256,expected[row.path],row.path+' does not match immutable candidate');
const matches=seen.flatMap(c=>c.modules.filter(m=>m.chainMatch).map(m=>({chunk:c.filename,...m})));
assert.equal(matches.filter(m=>m.chainMatch.includes('/sprintf-js/')).length,0,'sprintf-js reached runtime graph');
assert.equal(matches.filter(m=>m.chainMatch.includes('/@lhci/')).length,0,'LHCI reached runtime graph');
const report={status:'PASS',candidate:'ef649b33622559543b677bb3bc13364122bcd3d9',artifact:11654737888,release:process.env.VITE_CONTROL_ATLAS_BUILD_SHA,js_count:js.length,exact_js_hashes:js,standalone,module_count:seen.reduce((n,c)=>n+c.modules.length,0),chain_matches:matches,lockFindings,direct_runtime_dependencies:Object.keys(pkg.dependencies||{}),chunks:seen,limits:'Exact byte-matched browser bundles and module graph only; vulnerable devtool remains in LHCI, no full security compliance claim.'};
const body=JSON.stringify(report,null,2);assert(Buffer.byteLength(body)<2*1024*1024);
fs.writeFileSync(path.join(scratch,'runtime-proof/runtime-scope.json'),body);console.log(JSON.stringify({status:report.status,js_count:report.js_count,module_count:report.module_count,chain_matches:matches.length}));
