import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { admittedOscalArtifacts, verifyUpstreamBytes } from '../scripts/check-oscal.mjs';
import { validateNormalizedRecords } from '../tools/normalizers/oscal-normalize.mjs';
import { verifyNormalizedArtifactEvidence } from '../scripts/lib/normalized-artifact-evidence.mjs';

const projectRoot = process.cwd();

test('committed baseline evidence matches actual local bytes and remains separate from publisher admission', () => {
  const registry = JSON.parse(readFileSync(join(projectRoot, 'data/source-registry.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'data/artifact-hydration-manifest.json'), 'utf8'));
  const baseline = registry.artifacts.find((entry) => entry.id === 'artifact-nist-800-53b-baselines');
  assert.equal(verifyNormalizedArtifactEvidence(baseline, manifest.results.find((entry) => entry.id === baseline.id), projectRoot).record_count, 4);
  const admitted = admittedOscalArtifacts(registry, manifest);
  assert.ok(admitted.length > 0);
  assert.ok(admitted.every((entry) => entry.id !== baseline.id));
});

test('internal normalized files use the separate AJV gate', () => {
  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'check-normalized-records.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `check-oscal.mjs failed with output:\n${result.stderr || result.stdout}`);
  assert.match(result.stdout, /not upstream OSCAL validation/i);
});

const bytes = Buffer.from(JSON.stringify({ catalog: { uuid: 'fixture' } }));
const artifact = { id: 'artifact-test', format: 'oscal_json', origin: 'publisher_exact', artifact_url: 'https://raw.githubusercontent.com/usnistgov/oscal-content/v1.5.0/fixture.json', sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byte_length: bytes.length };
const evidence = { id: artifact.id, status: 'OK', http: 200, url: artifact.artifact_url, sha256: artifact.sha256, byte_length: bytes.length };

test('upstream gate admits only independently located publisher bytes', () => {
  assert.deepEqual(admittedOscalArtifacts({ artifacts: [artifact] }, { results: [evidence] }), [artifact]);
  for (const patch of [{ http: 'local' }, { url: `${artifact.artifact_url}?other` }, { byte_length: bytes.length + 1 }, { sha256: 'sha256:abbreviated' }]) {
    assert.throws(() => admittedOscalArtifacts({ artifacts: [artifact] }, { results: [{ ...evidence, ...patch }] }), /evidence mismatch/);
  }
  assert.throws(() => admittedOscalArtifacts({ artifacts: [{ ...artifact, origin: 'publisher_normalized' }] }, { results: [evidence] }), /evidence mismatch/);
});

test('upstream gate fails changed bytes and ambiguous document models before CLI validation', () => {
  assert.equal(verifyUpstreamBytes(artifact, bytes), 'catalog');
  assert.throws(() => verifyUpstreamBytes(artifact, Buffer.from('changed')), /bytes disagree/);
  assert.throws(() => verifyUpstreamBytes({ ...artifact, byte_length: bytes.length + 1 }, bytes), /bytes disagree/);
  const ambiguous = Buffer.from(JSON.stringify({ catalog: {}, profile: {} }));
  assert.throws(() => verifyUpstreamBytes({ ...artifact, sha256: `sha256:${createHash('sha256').update(ambiguous).digest('hex')}`, byte_length: ambiguous.length }, ambiguous), /Expected one upstream OSCAL model/);
  assert.throws(() => validateNormalizedRecords({ schema_version: '1.0', source_key: 'test', records: [{ id: 'a' }] }), /Invalid internal normalized records/);
});

test('check:oscal fails when target file is missing or invalid', () => {
  const result = spawnSync(process.execPath, [
    join(projectRoot, 'tools', 'run-oscal-cli.mjs'),
    'catalog',
    'validate',
    'non-existent-oscal-file.json',
  ], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'OSCAL CLI must fail when target file does not exist');
});
