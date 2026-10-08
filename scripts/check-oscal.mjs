#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyBaselineCatalogBytes, verifyBaselineManifest, verifyBaselineProfileBytes } from './lib/nist-baseline-profiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function admittedOscalArtifacts(registry, manifest) {
  const evidence = new Map(manifest.results.filter((entry) => entry.status === 'OK').map((entry) => [entry.id, entry]));
  const artifacts = registry.artifacts.filter((entry) => entry.format === 'oscal_json');
  if (!artifacts.length) throw new Error('No admitted upstream OSCAL artifacts');
  for (const artifact of artifacts) {
    const entry = evidence.get(artifact.id);
    if (artifact.origin !== 'publisher_exact' || !entry || !Number.isInteger(entry.http) || entry.http < 200 || entry.http >= 300
      || !artifact.artifact_url.startsWith('https://raw.githubusercontent.com/usnistgov/oscal-content/')
      || entry.url !== artifact.artifact_url || entry.sha256 !== artifact.sha256
      || entry.byte_length !== artifact.byte_length || !/^sha256:[a-f0-9]{64}$/.test(artifact.sha256)
      || !Number.isInteger(artifact.byte_length) || artifact.byte_length <= 0) {
      throw new Error(`Upstream OSCAL evidence mismatch: ${artifact.id}`);
    }
  }
  return artifacts;
}

export function verifyUpstreamBytes(artifact, bytes) {
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (sha256 !== artifact.sha256 || bytes.length !== artifact.byte_length) {
    throw new Error(`Upstream OSCAL bytes disagree with admitted evidence: ${artifact.id}`);
  }
  const document = JSON.parse(bytes.toString('utf8'));
  const models = ['catalog', 'profile', 'component-definition', 'assessment-plan', 'assessment-results', 'poam', 'system-security-plan'].filter((model) => document[model]);
  if (models.length !== 1) throw new Error(`Expected one upstream OSCAL model: ${artifact.id}`);
  return models[0];
}

export async function checkUpstreamOscal({ root = ROOT, fetchImpl = fetch, validate = (model, path) => {
  const result = spawnSync(process.execPath, [join(ROOT, 'tools/run-oscal-cli.mjs'), model, 'validate', path], { encoding: 'utf8', cwd: root });
  if (result.error || result.status !== 0) throw new Error(`NIST CLI rejected ${model}: ${result.error?.message || result.stderr || result.stdout}`);
} } = {}) {
  const registry = JSON.parse(readFileSync(join(root, 'data/source-registry.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'data/artifact-hydration-manifest.json'), 'utf8'));
  const artifacts = admittedOscalArtifacts(registry, manifest);
  const baselineManifest = JSON.parse(readFileSync(join(root, 'data/nist-800-53b-profile-manifest.json'), 'utf8'));
  const baselineReconciliation = verifyBaselineManifest(baselineManifest, JSON.parse(readFileSync(join(root, 'data/controls-800-53.json'), 'utf8')));
  const profiles = baselineManifest.profiles.map((profile) => ({ ...profile, id: `nist-800-53b-${profile.url.split('/').pop()}`, artifact_url: profile.url }));
  const baselineCatalog = { ...baselineManifest.catalog, id: 'nist-800-53b-imported-catalog', artifact_url: baselineManifest.catalog.url, baseline_catalog: true };
  const output = join(root, 'artifacts/oscal-cli/upstream');
  mkdirSync(output, { recursive: true });
  const results = [];
  for (const artifact of [...artifacts, baselineCatalog, ...profiles]) {
    const response = await fetchImpl(artifact.artifact_url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Upstream OSCAL retrieval failed: ${artifact.id} HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const model = verifyUpstreamBytes(artifact, bytes);
    if (artifact.baseline_catalog) {
      if (model !== 'catalog') throw new Error('NIST baseline imported bytes are not an OSCAL catalog');
      verifyBaselineCatalogBytes(artifact, bytes);
    }
    if (artifact.control_ids) {
      if (model !== 'profile') throw new Error('NIST baseline bytes are not an OSCAL profile');
      verifyBaselineProfileBytes(artifact, bytes);
    }
    const path = join(output, `${artifact.id}.json`);
    writeFileSync(path, bytes);
    await validate(model, path);
    results.push({ id: artifact.id, url: artifact.artifact_url, sha256: artifact.sha256, byte_length: bytes.length, model, status: 'PASS' });
  }
  const report = { generated_at: new Date().toISOString(), validation_scope: 'admitted publisher-exact OSCAL payloads only', oscal_cli_version: '1.0.3', results,
    excluded_normalized_artifacts: registry.artifacts.filter((entry) => entry.origin === 'publisher_normalized').map((entry) => entry.id),
    baseline_profile_completeness: { validation_scope: 'all four publisher profiles discovered at the recorded NIST commit, reconciled against ingested catalog membership and validated by the NIST CLI', publisher_commit: baselineManifest.discovery.publisher_commit, reconciliation: baselineReconciliation } };
  writeFileSync(join(output, '../upstream-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Upstream OSCAL verification: ${results.length} admitted publisher payloads passed the NIST CLI.`);
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  checkUpstreamOscal().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
