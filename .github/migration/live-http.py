import pathlib,os,subprocess,json,hashlib,zipfile,stat,re,base64,urllib.request,urllib.error,concurrent.futures,datetime
scratch=pathlib.Path(os.environ['RUNNER_TEMP']);out=scratch/'atlas-live-proof';out.mkdir()
sha=os.environ['EXPECTED_DEPLOY_SHA'];run_id=os.environ['PRODUCTION_CI_RUN'];artifact_id=os.environ['PRODUCTION_ARTIFACT'];assert re.fullmatch('[a-f0-9]{40}',sha)
def api(p):return json.loads(subprocess.check_output(['gh','api','repos/RAMBULLS/control-atlas/'+p],timeout=30))
run=api('actions/runs/'+run_id);artifact=api('actions/artifacts/'+artifact_id)
assert run['conclusion']=='success' and run['event']=='push' and run['head_branch']=='main' and run['head_sha']==sha
assert artifact['workflow_run']['id']==int(run_id) and artifact['workflow_run']['head_sha']==sha and artifact['name']=='site-build' and not artifact['expired'] and artifact['size_in_bytes']<500_000_000
archive=scratch/'atlas-live.zip'
with archive.open('wb') as f:subprocess.run(['gh','api',f'repos/RAMBULLS/control-atlas/actions/artifacts/{artifact_id}/zip'],stdout=f,check=True,timeout=300)
with archive.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==artifact['digest'].split(':')[1]
rows=[];seen=set();total=0
with zipfile.ZipFile(archive) as z:
 assert len(z.infolist())<10000
 for e in z.infolist():
  p=pathlib.PurePosixPath(e.filename);assert not p.is_absolute() and '..' not in p.parts and '\\' not in e.filename and not stat.S_ISLNK(e.external_attr>>16)
  if e.is_dir():continue
  assert e.filename.casefold() not in seen;seen.add(e.filename.casefold());assert not any(x in ['.env','.git','.github','AGENTS.md','CLAUDE.md','GEMINI.md','CNAME'] for x in p.parts)
  total+=e.file_size;assert total<2_000_000_000
  with z.open(e) as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
  rows.append({'path':e.filename,'bytes':e.file_size,'sha256':digest})
 release=json.loads(z.read('release.json'));assert release['commit_sha']==sha
 html=z.read('index.html').decode();script=re.search(r'<script type="application/ld\+json">(.*?)</script>',html,re.S).group(1)
 inline=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode();assert "'sha256-"+inline+"'" in html
 assert 'rel="canonical" href="https://atlas.rambulls.dev/"' in html
 assert 'https://atlas.rambulls.dev/sitemap.xml' in z.read('robots.txt').decode() and '<loc>https://atlas.rambulls.dev/</loc>' in z.read('sitemap.xml').decode()
manifest={'sha':sha,'run':run_id,'artifact':artifact,'digest_verified':True,'files':rows,'file_count':len(rows),'bytes':total,'release':release,'inline_jsonld_hash':inline}
(out/'live-manifest.json').write_text(json.dumps(manifest,indent=2))
assert len(rows)==3745
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None
opener=urllib.request.build_opener(NoRedirect)
def request(url,method='GET'):
 try:
  try:r=opener.open(urllib.request.Request(url,method=method),timeout=20)
  except urllib.error.HTTPError as e:r=e
  with r:body=r.read(64*1024**2+1);assert len(body)<=64*1024**2;headers={k.lower():v for k,v in r.headers.items()};status=r.status
  return {'url':url,'method':method,'status':status,'headers':headers,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'trusted_tls':True},body
 except Exception as e:return {'url':url,'method':method,'error':str(e),'match':False},b''
origin='https://atlas.rambulls.dev';index={x['path']:x for x in rows}
paths=['index.html','release.json','robots.txt','sitemap.xml','404.html','og-image.png']
paths+=re.findall(r'(?:src|href)="\./(assets/[^"?]+\.(?:js|css))"',html)
paths += [x['path'] for x in rows if x['path'].endswith('.json') and x['path'].startswith('data/') and x['bytes']<100000][:3]
paths=list(dict.fromkeys(paths));assert len(paths)<=18
mime={'.html':['text/html'],'.json':['application/json'],'.js':['application/javascript','text/javascript'],'.css':['text/css'],'.xml':['text/xml','application/xml'],'.txt':['text/plain'],'.png':['image/png']}
def resource(name):
 route='/' if name=='index.html' else '/'+name;row,body=request(origin+route);row['path']=name
 row['match']=row.get('status')==200 and row.get('sha256')==index[name]['sha256'] and row.get('headers',{}).get('content-type','').split(';')[0] in mime[pathlib.Path(name).suffix]
 if name=='index.html':row['security_csp_match']="'sha256-"+inline+"'" in body.decode();row['referrer_policy_match']='content="no-referrer"' in body.decode();row['match']=row['match'] and row['security_csp_match'] and row['referrer_policy_match']
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:resources=list(pool.map(resource,paths))
query='?source=test&x=1&x=2&empty=&utf8=%E2%9C%93';redirects=[]
for suffix in ['/', '/'+query,'/release.json','/robots.txt','/sitemap.xml','/og-image.png','/missing-migration-page']:
 row,_=request('https://rambulls.github.io/control-atlas'+suffix);row['expected_location']=origin+suffix;row['match']=row.get('status')==301 and row.get('headers',{}).get('location')==row['expected_location'];redirects.append(row)
row,_=request('https://rambulls.github.io/control-atlas/'+query,'HEAD');row['expected_location']=origin+'/'+query;row['match']=row.get('status')==301 and row.get('headers',{}).get('location')==row['expected_location'];redirects.append(row)
guards=[]
for suffix in ['/missing-migration-page','/.git/config','/AGENTS.md','/.env']:
 row,_=request(origin+suffix);row['match']=row.get('status')==404;guards.append(row)
proof={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expected_sha':sha,'resources':resources,'redirects':redirects,'guards':guards,'status':'PASS' if all(x['match'] for x in resources+redirects+guards) else 'FAIL','limits':'Normal trusted TLS with native status/Location and cache headers. Selected live resources; all3745 archive hashes verified separately, not all3745 HTTP responses.'}
(out/'http-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps({'status':proof['status'],'archive_files':len(rows),'checks':len(resources+redirects+guards),'failures':[x for x in resources+redirects+guards if not x['match']]}));assert proof['status']=='PASS'
