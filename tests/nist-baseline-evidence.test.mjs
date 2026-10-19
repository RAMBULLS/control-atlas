import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fetchFrameworkCatalogs } from '../scripts/fetch-framework-catalogs.mjs';
import { checkUpstreamOscal } from '../scripts/check-oscal.mjs';
import { BASELINE_DIRECTORY, BASELINE_NAMES, BASELINE_REVISION_URL, gitBlobSha, parseBaselineProfile, verifyBaselineManifest, verifyBaselineProfileBytes } from '../scripts/lib/nist-baseline-profiles.mjs';

// Computed synthetic fixtures exercise failure handling, never publisher evidence.
const revision = createHash('sha1').update('baseline test publisher snapshot').digest('hex');
const directory = BASELINE_DIRECTORY.replace('/main/', `/${revision}/`);
const catalog = { catalog: { uuid: '12345678-1234-4234-8234-123456789012',
  metadata: { title: 'Test catalog', version: 'test', 'last-modified': '2026-01-01T00:00:00Z', 'oscal-version': '1.1.2' },
  groups: [{ id: 'ac', title: 'Access control', controls: [{ id: 'ac-1', class: 'SP800-53', title: 'Policy and procedures' }] }],
} };
const body = Buffer.from(JSON.stringify(catalog));
const makeProfile = (name, ids = ['ac-1']) => ({ profile: { metadata: { title: `Test ${name}`, version: 'test' }, merge: { 'as-is': true },
  imports: [{ href: 'NIST_SP-800-53_rev5_catalog.json', 'include-controls': [{ 'with-ids': ids }] }],
} });

function scenario({ editProfile = (profile) => profile, failProfile, extraDiscovery = false, catalogMismatch = false } = {}) {
  const payloads = new Map(BASELINE_NAMES.map((name) => [`NIST_SP-800-53_rev5_${name}-baseline_profile.json`, Buffer.from(JSON.stringify(editProfile(makeProfile(name), name)))]));
  const entries = [...payloads].map(([name, bytes]) => ({ name, type: 'file', sha: gitBlobSha(bytes), download_url: `${directory}${name}` }));
  entries.push({ name: 'NIST_SP-800-53_rev5_catalog.json', type: 'file', sha: gitBlobSha(catalogMismatch ? Buffer.from('other') : body), download_url: `${directory}NIST_SP-800-53_rev5_catalog.json` });
  if (extraDiscovery) entries.push({ name: 'NIST_SP-800-53_rev5_NEW-baseline_profile.json' });
  const writes = [];
  const requests = [];
  return { writes, requests, options: { only: ['nist-800-53-rev5'], fetchFedrampMembership: async () => ({}),
    writeJson: (...args) => writes.push(args),
    fetchImpl: async (url) => {
      requests.push(url);
      if (url === BASELINE_REVISION_URL) return new Response(JSON.stringify({ sha: revision }));
      if (url.includes('/contents/')) return new Response(JSON.stringify(entries));
      if (url.endsWith('NIST_SP-800-53_rev5_catalog.json')) return new Response(body);
      const name = url.split('/').pop();
      if (name.includes(failProfile || '!none!')) return new Response('', { status: 503 });
      assert.ok(payloads.has(name), `Unexpected URL: ${url}`);
      return new Response(payloads.get(name));
    },
  } };
}

test('ingestion binds all four explicit profiles to one immutable publisher catalog and exact assigned membership', async () => {
  const fixture = scenario();
  await fetchFrameworkCatalogs(fixture.options);
  assert.equal(fixture.writes.length, 2);
  const manifest = fixture.writes.find(([path]) => path.endsWith('nist-800-53b-profile-manifest.json'))[1];
  const normalized = fixture.writes.find(([path]) => path.endsWith('controls-800-53.json'))[1];
  assert.equal(verifyBaselineManifest(manifest, normalized).length, 4);
  assert.equal(manifest.discovery.publisher_commit, revision);
  assert.ok(manifest.profiles.every((profile) => profile.url.startsWith(directory)));
  assert.equal(normalized.records[0].metadata.nist_800_53b_baselines.length, 4);
  for (const profile of manifest.profiles) verifyBaselineProfileBytes(profile, Buffer.from(JSON.stringify(makeProfile(profile.label.replace('Test ', '')))));
  for (const mutate of [
    (value) => { value.profiles.pop(); },
    (value) => { value.profiles[0].reconciliation.ingested += 1; },
    (value) => { value.profiles[0].control_ids.push('AC-99'); },
    (value) => { value.catalog.byte_length += 1; },
    (value) => { value.profiles[0].import_urls = ['https://example.test/other']; },
    (value) => { value.profiles[0].sha256 = 'sha256:short'; },
  ]) {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => verifyBaselineManifest(changed, normalized));
  }
  const changedBytes = Buffer.from(JSON.stringify(makeProfile('HIGH', ['ac-2'])));
  assert.throws(() => verifyBaselineProfileBytes(manifest.profiles[0], changedBytes), /bytes differ/);
});

test('fourth profile failure, unknown selections, discovery changes and catalog mismatch publish no partial outputs', async () => {
  for (const options of [
    { failProfile: 'PRIVACY' }, { extraDiscovery: true }, { catalogMismatch: true },
    { editProfile: (profile, name) => name === 'HIGH' ? makeProfile(name, ['ac-99']) : profile },
    { editProfile: (profile, name) => name === 'HIGH' ? makeProfile(name, ['ac-1', 'AC-1']) : profile },
    { editProfile: (profile, name) => name === 'HIGH' ? { profile: { ...profile.profile, modify: {} } } : profile },
  ]) {
    const fixture = scenario(options);
    await assert.rejects(fetchFrameworkCatalogs(fixture.options));
    assert.equal(fixture.writes.length, 0);
  }
});

test('unsupported selectors and ambiguous fragment locators fail before interpretation', () => {
  for (const patch of [ { 'include-all': {} }, { 'exclude-controls': [] }, { 'include-controls': [{ 'with-ids': ['ac-1'], 'with-child-controls': 'yes' }] }, { href: '#missing' } ]) {
    const profile = makeProfile('LOW');
    Object.assign(profile.profile.imports[0], patch);
    assert.throws(() => parseBaselineProfile(profile, `${directory}profile.json`));
  }
});

test('upstream validation includes the ingested baseline catalog even when registry admission retains an older edition', async (t) => {
  const fixture = scenario();
  await fetchFrameworkCatalogs(fixture.options);
  const base = join(process.cwd(), '.local/nist-baseline-evidence-tests');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  for (const [path, value] of fixture.writes) writeFileSync(join(root, 'data', path.split(/[/\\]/).pop()), JSON.stringify(value));
  const oldBytes = Buffer.from(JSON.stringify({ catalog: { ...catalog.catalog, metadata: { ...catalog.catalog.metadata, version: 'older-test' } } }));
  const oldArtifact = { id: 'old-catalog', format: 'oscal_json', origin: 'publisher_exact', artifact_url: `${BASELINE_DIRECTORY.replace('/main/', '/v1.5.0/')}NIST_SP-800-53_rev5_catalog.json`, sha256: `sha256:${createHash('sha256').update(oldBytes).digest('hex')}`, byte_length: oldBytes.length };
  writeFileSync(join(root, 'data/source-registry.json'), JSON.stringify({ artifacts: [oldArtifact] }));
  writeFileSync(join(root, 'data/artifact-hydration-manifest.json'), JSON.stringify({ results: [{ id: oldArtifact.id, status: 'OK', http: 200, url: oldArtifact.artifact_url, sha256: oldArtifact.sha256, byte_length: oldBytes.length }] }));
  const validated = [];
  const report = await checkUpstreamOscal({ root,
    fetchImpl: (url) => url === oldArtifact.artifact_url ? new Response(oldBytes) : fixture.options.fetchImpl(url),
    validate: (model, path) => validated.push({ model, document: JSON.parse(readFileSync(path, 'utf8')) }),
  });
  assert.equal(report.results.length, 6);
  assert.deepEqual(validated.filter((entry) => entry.model === 'catalog').map((entry) => entry.document.catalog.metadata.version), ['older-test', 'test']);
  assert.equal(report.results.find((entry) => entry.id === 'nist-800-53b-imported-catalog').model, 'catalog');
});
