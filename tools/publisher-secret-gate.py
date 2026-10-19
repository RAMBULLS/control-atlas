"""Verify reviewed DISA publisher examples without excluding source files.

The disposition binds repository, native record/field digest, detector and columns.
Publisher provenance is retained in data/disa-artifact-manifest.json and the
canonical DISA records. Other findings and unavailable evidence fail the gate.
The security workflow supplies checksum-verified Gitleaks 8.24.3.
"""
import copy
import hashlib
import json
from pathlib import Path
import pathlib
import re
import subprocess
import sys
import tempfile
import tomllib

REPO_CONFIG_SHA = "c5b761dd86c7abeec5569573770c860709e3edb6a2b51dfb083fc689222670de"
PUBLISHER_RULES = [
    {
        "RuleID": "curl-auth-user",
        "record_id": "V-220366",
        "field": "fix_text",
        "field_sha256": "f6ecc37c17092f79a15eadb11ccbee179ce2fe9fbf19e0fdcc6be4a9aceb7f37",
        "StartColumn": 533,
        "EndColumn": 622,
        "path": "data/curated/disa/stig-previous-editions.json"
    },
    {
        "RuleID": "generic-api-key",
        "record_id": "V-257787",
        "field": "check_text",
        "field_sha256": "0f52497e7fb3633e54b65d9cd9676aa7a800ffd6d1e561dc1aeb36af727016e5",
        "StartColumn": 416,
        "EndColumn": 496,
        "path": "data/curated/disa/stig-previous-editions.json"
    },
    {
        "RuleID": "generic-api-key",
        "record_id": "V-269137",
        "field": "check_text",
        "field_sha256": "25b8542db6eb6a42148cd1cd99f9d2d2e2456529d03707989ed19561de75c04f",
        "StartColumn": 340,
        "EndColumn": 420,
        "path": "data/curated/disa/stig-previous-editions.json"
    },
    {
        "RuleID": "generic-api-key",
        "record_id": "V-271635",
        "field": "check_text",
        "field_sha256": "e11b8bb86e5e09698ad8721a5fd72e9359575e96c0692180d2df9fa845cce1a4",
        "StartColumn": 374,
        "EndColumn": 454,
        "path": "data/curated/disa/stig-previous-editions.json"
    },
    {
        "RuleID": "generic-api-key",
        "record_id": "V-279542",
        "field": "check_text",
        "field_sha256": "027359907cffcb928f8308e935a715178f828546e8bf6cf5cb4e7fe9a2c3fd7b",
        "StartColumn": 170,
        "EndColumn": 245,
        "path": "data/curated/disa/stig-previous-editions.json"
    },
    {
        "RuleID": "generic-api-key",
        "record_id": "V-281166",
        "field": "check_text",
        "field_sha256": "f7c044e1ec03d42267f49c63b006bfe67d6e14486f550e93372f32eeff3957ee",
        "StartColumn": 359,
        "EndColumn": 439,
        "path": "data/curated/disa/stig-previous-editions.json"
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-17173",
        "field": "description",
        "field_sha256": "818391374ca4e56aa9048111f94c090db42203f14bd10f1d5fbd752c65066959",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-17173",
        "field": "description",
        "field_sha256": "818391374ca4e56aa9048111f94c090db42203f14bd10f1d5fbd752c65066959",
        "StartColumn": 355,
        "EndColumn": 381
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "curl-auth-user",
        "record_id": "V-220366",
        "field": "fix_text",
        "field_sha256": "f6ecc37c17092f79a15eadb11ccbee179ce2fe9fbf19e0fdcc6be4a9aceb7f37",
        "StartColumn": 531,
        "EndColumn": 620
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-223298",
        "field": "description",
        "field_sha256": "7e1a3acdc6fe6f7252a41f808481f2dd65296aa5672f9b49576acf0e4dfaafcf",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-223298",
        "field": "description",
        "field_sha256": "7e1a3acdc6fe6f7252a41f808481f2dd65296aa5672f9b49576acf0e4dfaafcf",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-228419",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-228419",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238008",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238008",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238044",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238044",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238054",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238054",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238079",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238079",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238091",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238091",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238108",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238108",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238121",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238121",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238155",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238155",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238482",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-238482",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-241840",
        "field": "description",
        "field_sha256": "818391374ca4e56aa9048111f94c090db42203f14bd10f1d5fbd752c65066959",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-241840",
        "field": "description",
        "field_sha256": "818391374ca4e56aa9048111f94c090db42203f14bd10f1d5fbd752c65066959",
        "StartColumn": 355,
        "EndColumn": 381
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "generic-api-key",
        "record_id": "V-255245",
        "field": "check_text",
        "field_sha256": "bb2d1e8e378363f59dbfad3bb8d5c9ea2e80335adb1c22fecebf5fe718801b45",
        "StartColumn": 313,
        "EndColumn": 358
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "generic-api-key",
        "record_id": "V-273825",
        "field": "check_text",
        "field_sha256": "1b36b4f47557f2d51dfbb4102d3f720046fb6dc4c5ba171feebaf3990cd913e4",
        "StartColumn": 191,
        "EndColumn": 243
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "generic-api-key",
        "record_id": "V-273825",
        "field": "check_text",
        "field_sha256": "1b36b4f47557f2d51dfbb4102d3f720046fb6dc4c5ba171feebaf3990cd913e4",
        "StartColumn": 259,
        "EndColumn": 303
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "generic-api-key",
        "record_id": "V-279542",
        "field": "check_text",
        "field_sha256": "027359907cffcb928f8308e935a715178f828546e8bf6cf5cb4e7fe9a2c3fd7b",
        "StartColumn": 168,
        "EndColumn": 243
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "generic-api-key",
        "record_id": "V-283916",
        "field": "check_text",
        "field_sha256": "d0b483d181246baadac5c917866d919a870ac2ace11202b356a361951a8828a2",
        "StartColumn": 776,
        "EndColumn": 849
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70703",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70703",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70803",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70803",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70829",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70829",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70907",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-70907",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-71041",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 137,
        "EndColumn": 161
    },
    {
        "path": "data/stig-rules.json",
        "RuleID": "credential-bearing-http-url",
        "record_id": "V-71041",
        "field": "description",
        "field_sha256": "39c56059b796bcc6c60a05c61b5147ce73f15feb1c09fcf4fccf6f0f5b4b69ac",
        "StartColumn": 353,
        "EndColumn": 379
    },
    {
        "path": "data/srg-requirements.json",
        "RuleID": "generic-api-key",
        "record_id": "V-274847",
        "field": "check_text",
        "field_sha256": "f3d638672df8d408e2be1a0f17e98222f541fb69106b2bbb414dee7eebc82aca",
        "StartColumn": 177,
        "EndColumn": 211
    }
]

def _git_bytes(cwd,*args):
    p=subprocess.run(['git','-C',str(cwd),*args],capture_output=True,timeout=12)
    if p.returncode:raise ValueError('Publisher Git evidence unavailable; held')
    return p.stdout

def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Ambiguous publisher JSON; held')
        result[key]=value
    return result

def publisher_findings_allowed(findings,arguments,cwd=None,blob_cache=None):
    # Native tool inputs and authentication metadata NEVER receive dispositions.
    if not arguments or arguments[0] not in ('git','dir') or not isinstance(findings,list) or not findings:
        return False
    cwd=pathlib.Path(cwd or '.').resolve()
    origin=_git_bytes(cwd,'config','--get','remote.origin.url').decode().strip()
    if origin.lower() not in ('https://github.com/rambulls/control-atlas.git','https://github.com/rambulls/control-atlas','git@github.com:rambulls/control-atlas.git'):
        return False
    snapshot=arguments[0]=='dir'
    cache={} if blob_cache is None else blob_cache
    for finding in findings:
        if not isinstance(finding,dict):
            return False
        path=finding.get('File','').replace('\\','/')
        candidates=[r for r in PUBLISHER_RULES if r['path']==path and r['RuleID']==finding.get('RuleID')]
        if not candidates or finding.get('StartLine')!=finding.get('EndLine'):
            return False
        if not all(type(finding.get(k)) is int and finding[k]>0 for k in ('StartLine','EndLine','StartColumn','EndColumn')):
            return False
        commit=finding.get('Commit','')
        if not snapshot and not re.fullmatch('[0-9a-f]{40,64}',commit):
            return False
        ref='HEAD:'+path if snapshot else commit+':'+path
        if ref not in cache:
            raw=_git_bytes(cwd,'show',ref)
            if len(raw)>85000000:
                return False
            # Parse the actual staged/commit object; duplicate keys stay held.
            doc=json.loads(raw,object_pairs_hook=_unique)
            if not isinstance(doc,dict):
                return False
            # Bytes keep an extra decoded copy of large source inputs out of RAM.
            cache[ref]=(raw.splitlines(),doc)
        lines,doc=cache[ref]
        number=finding['StartLine']
        if number>len(lines):
            return False
        primary=path in ('data/stig-rules.json','data/srg-requirements.json')
        indent=6 if primary else 8
        if not re.match(rb'^ {'+str(indent).encode()+rb'}"(?:description|check_text|fix_text)": ',lines[number-1]):
            return False
        line=lines[number-1].strip().rstrip(b',')
        field=json.loads(b'{'+line+b'}',object_pairs_hook=_unique)
        if len(field)!=1:
            return False
        pattern=rb'^      "id": "(V-[0-9]+)",' if primary else rb'^\s*"(V-[0-9]+)"\s*:\s*\['
        owner=None
        for index in range(number-2,-1,-1):
            match=re.match(pattern,lines[index])
            if match:
                owner=match.group(1).decode()
                break
        records=doc.get('records')
        if primary:
            if not isinstance(records,list):
                return False
            owned=[r for r in records if isinstance(r,dict) and r.get('id')==owner]
            if len(owned)!=1:
                return False
        else:
            if not isinstance(records,dict):
                return False
            owned=records.get(owner,[])
        if not isinstance(owned,list):
            return False
        accepted=[]
        for rule in candidates:
            if owner!=rule['record_id'] or finding['StartColumn']!=rule['StartColumn'] or finding['EndColumn']!=rule['EndColumn']:
                continue
            value=field.get(rule['field'])
            if not isinstance(value,str) or hashlib.sha256(value.encode()).hexdigest()!=rule['field_sha256']:
                continue
            if sum(isinstance(r,dict) and r.get(rule['field'])==value for r in owned)!=1:
                continue
            accepted.append(rule)
        if len(accepted)!=1:
            return False
    return True

def _digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _snapshot_config(raw):
    """Remove only the two native-file exclusions from the snapshot policy."""
    exclusions = {r"data/stig-rules\.json", r"data/srg-requirements\.json"}
    original = tomllib.loads(raw.decode("utf-8"))
    paths = original.get("allowlist", {}).get("paths")
    if not isinstance(paths, list) or any(paths.count(path) != 1 for path in exclusions):
        raise ValueError("Native-source scanner scope is unavailable")
    removed = set()
    kept = []
    quote = "'" * 3
    for line in raw.decode("utf-8").splitlines(keepends=True):
        matches = [path for path in exclusions if line.strip() == quote + path + quote + ","]
        if matches:
            if matches[0] in removed:
                raise ValueError("Ambiguous scanner scope")
            removed.add(matches[0])
        else:
            kept.append(line)
    if removed != exclusions:
        raise ValueError("Native-source scanner policy changed")
    effective = "".join(kept).encode("utf-8")
    expected = copy.deepcopy(original)
    expected["allowlist"]["paths"] = [p for p in paths if p not in exclusions]
    if tomllib.loads(effective.decode("utf-8")) != expected:
        raise ValueError("Unexpected scanner policy modification")
    return effective


def _snapshot_identity(cwd):
    """Verify the exact tracked source bytes, retaining only their digests."""
    identities = {}
    for path in sorted({rule["path"] for rule in PUBLISHER_RULES}):
        expected = hashlib.sha256(_git_bytes(cwd, "show", "HEAD:" + path)).hexdigest()
        actual = _digest(Path(cwd) / path)
        if actual != expected:
            raise ValueError("Snapshot differs from its Git source")
        identities[path] = actual
    return identities


def _native_finding(result, mode):
    locations = result.get("locations")
    if not isinstance(locations, list) or len(locations) != 1:
        raise ValueError("Ambiguous finding location")
    physical = locations[0]["physicalLocation"]
    region = physical["region"]
    finding = {
        "RuleID": result["ruleId"],
        "File": physical["artifactLocation"]["uri"],
        "StartLine": region["startLine"],
        "EndLine": region.get("endLine", region["startLine"]),
        "StartColumn": region["startColumn"],
        "EndColumn": region["endColumn"],
    }
    if mode == "history":
        finding["Commit"] = result.get("partialFingerprints", {}).get("commitSha")
        if not isinstance(finding["Commit"], str):
            raise ValueError("Missing history commit")
    return finding


def scan_report(mode, report, cwd="."):
    cwd = Path(cwd).resolve()
    names = {"snapshot": "results.sarif", "history": "history-results.sarif"}
    if mode not in names or report != names[mode]:
        raise ValueError("Unsupported scan invocation")
    config = cwd / ".gitleaks.toml"
    binary = cwd / "gitleaks"
    if _digest(config) != REPO_CONFIG_SHA:
        raise ValueError("Scanner policy changed")
    binary_identity = _digest(binary)
    version = subprocess.run([str(binary), "version"], capture_output=True, cwd=cwd, timeout=10)
    if version.returncode or version.stdout.decode("utf-8").strip() != "8.24.3":
        raise ValueError("Unexpected scanner version")
    before = _snapshot_identity(cwd) if mode == "snapshot" else None
    report_path = cwd / report
    report_path.unlink(missing_ok=True)
    action = "dir" if mode == "snapshot" else "git"
    effective = _snapshot_config(config.read_bytes()) if mode == "snapshot" else config.read_bytes()
    temporary = None
    try:
        config_path = config
        if mode == "snapshot":
            with tempfile.NamedTemporaryFile(prefix=".publisher-snapshot-", suffix=".toml", dir=cwd, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(effective)
                config_path = temporary
        process = subprocess.run([
            str(binary), action, ".", "--redact=100", "--config=" + str(config_path),
            "--report-format=sarif", "--report-path=" + report,
        ], capture_output=True, cwd=cwd, timeout=180)
        if _digest(config_path) != hashlib.sha256(effective).hexdigest():
            raise ValueError("Effective scanner policy changed")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    if process.returncode not in (0, 1):
        raise ValueError("Scanner execution failed")
    document = json.loads(report_path.read_text(encoding="utf-8"), object_pairs_hook=_unique)
    runs = document.get("runs")
    if not isinstance(runs, list) or not runs:
        raise ValueError("Missing scanner report")
    results = []
    for run in runs:
        entries = run.get("results")
        if not isinstance(entries, list) or not all(isinstance(r, dict) for r in entries):
            raise ValueError("Malformed scanner results")
        results.extend(entries)
    if bool(process.returncode) != bool(results):
        raise ValueError("Scanner exit/report disagree")
    if _digest(config) != REPO_CONFIG_SHA or _digest(binary) != binary_identity:
        raise ValueError("Scanner inputs changed")
    if mode == "snapshot" and _snapshot_identity(cwd) != before:
        raise ValueError("Source changed during scan")
    held = 0
    blob_cache = {}
    for result in results:
        try:
            finding = _native_finding(result, mode)
            accepted = publisher_findings_allowed([finding], [action, "."], cwd, blob_cache=blob_cache)
        except (KeyError, ValueError, TypeError, OSError, subprocess.SubprocessError):
            accepted = False
        if accepted:
            result["suppressions"] = [{
                "kind": "external",
                "justification": "Reviewed DISA publisher instruction or sample; native record, field SHA256 and detector coordinates verified.",
            }]
        else:
            # An unreviewed result is never accepted because it carries a label.
            result.pop("suppressions", None)
            held += 1
    report_path.write_text(json.dumps(document) + "\n", encoding="utf-8")
    return 1 if held else 0


def main():
    try:
        if len(sys.argv) != 3:
            raise ValueError("Expected scan mode and report")
        return scan_report(*sys.argv[1:])
    except (ValueError, TypeError, KeyError, OSError, subprocess.SubprocessError):
        print("Secret scan verification failed; publication held", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
