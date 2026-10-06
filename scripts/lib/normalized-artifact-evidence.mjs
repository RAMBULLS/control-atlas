import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { validateNormalizedRecords } from '../../tools/normalizers/oscal-normalize.mjs';

export function verifyNormalizedArtifactEvidence(artifact, evidence, root) {
  if (evidence?.evidence_scope !== 'local_normalized') throw new Error(`Missing normalized evidence scope: ${artifact.id}`);
  if (evidence.local_path !== 'data/800-53b-baselines.json') throw new Error(`Unsupported normalized evidence locator: ${artifact.id}`);
  const path = resolve(root, evidence.local_path);
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error('Normalized evidence escapes repository');
  const bytes = readFileSync(path);
  const payload = validateNormalizedRecords(JSON.parse(bytes.toString('utf8')));
  const actual = { sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byte_length: bytes.length,
    record_count: payload.records.length, relationship_count: payload.relationships?.length || 0 };
  for (const [field, value] of Object.entries(actual)) {
    if (artifact[field] !== value || evidence[field] !== value) throw new Error(`Normalized evidence ${field} mismatch: ${artifact.id}`);
  }
  if (artifact.format !== 'json' || evidence.format !== 'json' || artifact.profile_id !== 'artifact.json'
    || artifact.origin !== 'publisher_normalized' || evidence.http !== 'local'
    || artifact.artifact_url !== 'https://github.com/RAMBULLS/control-atlas/blob/main/data/800-53b-baselines.json'
    || artifact.upstream_reference_url !== 'https://raw.githubusercontent.com/usnistgov/oscal-content/v1.5.0/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_MODERATE-baseline_profile.json'
    || artifact.artifact_url !== evidence.url || artifact.upstream_reference_url !== evidence.upstream_reference_url) {
    throw new Error(`Normalized evidence locator or scope mismatch: ${artifact.id}`);
  }
  return actual;
}
