import pathlib,os,subprocess,json,hashlib,zipfile,stat,re,base64
scratch=pathlib.Path(os.environ['RUNNER_TEMP']);out=scratch/'atlas-proof';out.mkdir()
inputs={
 'candidate':{'id':11654737888,'run':38013784930,'digest':'42eb9f4eed4a93b20f96dd9f74f01490854f4ba60e140a1a0fbcb258185d1480','sha':'3fdbc2bbfea8e674994d750b401111d3b28e794b','head':'ef649b33622559543b677bb3bc13364122bcd3d9'},
 'rollback':{'id':11569924426,'run':37824229995,'digest':'2a061ecee54b774d09b8609fdd01e5a3d9003a92bfef4968c07ca475914f029f','sha':'aa4cc1af4b0ab53572f444fbf48af4a2b842d760','head':'aa4cc1af4b0ab53572f444fbf48af4a2b842d760'},
}
for label,item in inputs.items():
    artifact=json.loads(subprocess.check_output(['gh','api',f'repos/RAMBULLS/control-atlas/actions/artifacts/{item["id"]}']))
    assert artifact['workflow_run']['id']==item['run'] and artifact['workflow_run']['head_sha']==item['head']
    assert artifact['digest']=='sha256:'+item['digest'] and not artifact['expired'] and artifact['size_in_bytes']<500_000_000
    archive=scratch/('atlas-'+label+'.zip')
    with archive.open('wb') as stream:subprocess.run(['gh','api',f'repos/RAMBULLS/control-atlas/actions/artifacts/{item["id"]}/zip'],stdout=stream,check=True,timeout=300)
    assert archive.stat().st_size==artifact['size_in_bytes']
    with archive.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==item['digest']
    target=scratch/('atlas-'+label);target.mkdir();rows=[];seen=set();total=0
    with zipfile.ZipFile(archive) as z:
        assert len(z.infolist())<100_000
        for entry in z.infolist():
            p=pathlib.PurePosixPath(entry.filename)
            assert not p.is_absolute() and '..' not in p.parts and '\\' not in entry.filename
            assert not stat.S_ISLNK(entry.external_attr>>16)
            if entry.is_dir():continue
            assert entry.filename.casefold() not in seen;seen.add(entry.filename.casefold())
            assert not any(part in ['.env','.git','.github','AGENTS.md','CLAUDE.md','GEMINI.md','CNAME'] for part in p.parts)
            total+=entry.file_size;assert total<2_000_000_000
            destination=target/pathlib.Path(*p.parts);destination.parent.mkdir(parents=True,exist_ok=True)
            data=z.read(entry);destination.write_bytes(data)
            rows.append({'path':entry.filename,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    release=json.loads((target/'release.json').read_text());assert release['commit_sha']==item['sha']
    html=(target/'index.html').read_text()
    script=re.search(r'<script type="application/ld\+json">(.*?)</script>',html,re.S).group(1)
    hashed=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    assert "'sha256-"+hashed+"'" in html
    canonical='https://atlas.rambulls.dev/' if label=='candidate' else 'https://rambulls.github.io/control-atlas/'
    assert 'rel="canonical" href="'+canonical+'"' in html
    assert canonical+'sitemap.xml' in (target/'robots.txt').read_text()
    assert '<loc>'+canonical+'</loc>' in (target/'sitemap.xml').read_text()
    manifest={**item,'label':label,'bytes':total,'file_count':len(rows),'files':rows,'release':release,'inline_jsonld_hash':hashed,'artifact':artifact,'provenance':'PR synthetic merge artifact; not deployable main proof' if label=='candidate' else 'original successful main CI artifact matching current deployed release'}
    (out/(label+'-manifest.json')).write_text(json.dumps(manifest,indent=2))
    print(json.dumps({k:v for k,v in manifest.items() if k not in ['files','artifact','release']}))
