import pathlib,os,subprocess,json,hashlib,zipfile,stat,re
s=pathlib.Path(os.environ['RUNNER_TEMP']);o=s/'runtime-proof';o.mkdir();a=json.loads(subprocess.check_output(['gh','api','repos/RAMBULLS/control-atlas/actions/artifacts/11654737888']))
expected='42eb9f4eed4a93b20f96dd9f74f01490854f4ba60e140a1a0fbcb258185d1480'
assert not a['expired'] and a['digest']=='sha256:'+expected and a['workflow_run']['id']==38013784930 and a['workflow_run']['head_sha']=='ef649b33622559543b677bb3bc13364122bcd3d9' and a['size_in_bytes']<500000000
p=s/'runtime-candidate.zip'
with p.open('wb') as f:subprocess.run(['gh','api','repos/RAMBULLS/control-atlas/actions/artifacts/11654737888/zip'],stdout=f,check=True,timeout=300)
with p.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==expected
assert p.stat().st_size==a['size_in_bytes'];expected_js={};root=pathlib.Path.cwd();total=0
with zipfile.ZipFile(p) as z:
 names=z.namelist();assert len(names)<100000 and len(set(x.casefold() for x in names))==len(names)
 for e in z.infolist():
  q=pathlib.PurePosixPath(e.filename);assert not q.is_absolute() and '..' not in q.parts and '\\' not in e.filename and not stat.S_ISLNK(e.external_attr>>16)
 def read(name):
  global total
  e=z.getinfo(name);assert not e.is_dir();total+=e.file_size;assert total<500000000;return z.read(e)
 release=json.loads(read('release.json'));assert release['commit_sha']=='3fdbc2bbfea8e674994d750b401111d3b28e794b'
 html=read('index.html');(o/'candidate-index.html').write_bytes(html)
 for name in names:
  if name.endswith('.js'):expected_js[name]=hashlib.sha256(read(name)).hexdigest()
 required=['library-search-index.json','connection-inventory.json','publication-identity-index.json','pulse.json']
 generated=(root/'data/generated').resolve();import_inputs=[]
 for source in [root/'vite.config.ts',*sorted((root/'src').rglob('*'))]:
  if not source.is_file() or source.suffix not in ['.js','.mjs','.ts','.tsx']:continue
  for ref in re.findall(r'''['"]([^'"\n]*data/generated/[^'"\n]*\.json)['"]''',source.read_text()):
   destination=(source.parent/ref).resolve()
   if destination.is_relative_to(generated):
    item=destination.relative_to(generated).as_posix();assert 'data/generated/'+item in names;required.append(item);import_inputs.append({'source':source.relative_to(root).as_posix(),'input':item})
 index=json.loads(read('data/generated/library-search-index.json'));required += [v['path'] for v in index['sharded_collection']['shards']]
 for name in sorted(set(required)):
  q=pathlib.PurePosixPath(name);assert not q.is_absolute() and '..' not in q.parts
  data=read('data/generated/'+name);dest=root/'data/generated'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
 (s/'runtime-expected.json').write_text(json.dumps(expected_js))
 (o/'runtime-inputs.json').write_text(json.dumps({'artifact_id':a['id'],'digest':expected,'head':a['workflow_run']['head_sha'],'release':release,'selected_bytes':total,'js_count':len(expected_js),'generated_inputs':required,'static_generated_imports':import_inputs},indent=2))
print(json.dumps({'js_count':len(expected_js),'selected_bytes':total,'artifact_digest':expected}))
