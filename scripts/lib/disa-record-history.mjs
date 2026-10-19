import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomically } from './write-json-atomically.mjs';

const checksum = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const historyPath = (kind) => `data/curated/disa/${kind}-previous-editions.json`;

/** A supporting file holds full prior native records; canonical item IDs stay unchanged. */
export function separateDisaHistory(document, kind) {
  assert.ok(['stig', 'srg'].includes(kind), 'Unknown DISA history kind');
  const records = {};
  const main = { ...document, records: document.records.map((record) => {
    const metadata = { ...record.metadata };
    if (metadata.previous_editions?.length) records[record.id] = metadata.previous_editions;
    delete metadata.previous_editions;
    return { ...record, metadata };
  }) };
  delete main.record_history;
  const history = { schema_version: '1.0', catalog_id: `disa-${kind}`, records };
  if (Object.keys(records).length) {
    const bytes = Buffer.from(`${JSON.stringify(history, null, 2)}\n`);
    main.record_history = { path: historyPath(kind), sha256: checksum(bytes), byte_length: bytes.length,
      record_count: Object.keys(records).length, edition_count: Object.values(records).reduce((n, editions) => n + editions.length, 0) };
  }
  return { main, history };
}

export function restoreDisaHistory(document, loadBytes) {
  if (!document.record_history) return document;
  const ref = document.record_history;
  assert.ok(['stig', 'srg'].some((kind) => ref.path === historyPath(kind)), 'Invalid DISA supporting history path');
  const bytes = loadBytes(ref.path);
  assert.equal(bytes.length, ref.byte_length, 'Missing or altered DISA history bytes');
  assert.equal(checksum(bytes), ref.sha256, 'Missing or altered DISA history checksum');
  const history = JSON.parse(bytes);
  assert.equal(ref.path, historyPath(history.catalog_id?.replace('disa-', '')), 'History catalog mismatch');
  assert.equal(Object.keys(history.records).length, ref.record_count, 'History record count mismatch');
  assert.equal(Object.values(history.records).reduce((n, editions) => n + editions.length, 0), ref.edition_count, 'History edition count mismatch');
  const ids = new Set(document.records.map((record) => record.id));
  for (const [id, editions] of Object.entries(history.records)) {
    assert.ok(ids.has(id) && Array.isArray(editions) && editions.every((record) => record.id === id), 'Dangling or wrong-ID native history');
  }
  const restored = { ...document, records: document.records.map((record) => history.records[record.id]
    ? { ...record, metadata: { ...record.metadata, previous_editions: history.records[record.id] } } : record) };
  delete restored.record_history;
  return restored;
}

export function readDisaCatalog(root, kind) {
  const path = join(root, 'data', kind === 'stig' ? 'stig-rules.json' : 'srg-requirements.json');
  if (!existsSync(path)) return null;
  return restoreDisaHistory(JSON.parse(readFileSync(path)), (relative) => readFileSync(join(root, relative)));
}

export function writeDisaCatalog(root, kind, document) {
  const { main, history } = separateDisaHistory(document, kind);
  if (main.record_history) writeJsonAtomically(join(root, main.record_history.path), history);
  writeJsonAtomically(join(root, 'data', kind === 'stig' ? 'stig-rules.json' : 'srg-requirements.json'), main);
  return main;
}

/** Attest actual stored projections and supporting files without inventing publisher byte evidence. */
export function attestDisaProjections(root, manifest) {
  const registry = JSON.parse(readFileSync(join(root, 'data/source-registry.json')));
  const hydration = JSON.parse(readFileSync(join(root, 'data/artifact-hydration-manifest.json')));
  for (const [id, relative] of [['artifact-disa-stig-library', 'data/stig-rules.json'], ['artifact-disa-srg-library', 'data/srg-requirements.json'], ['artifact-disa-stig-srg-cci-references', 'maps/stig-srg-to-cci.json']]) {
    const bytes = readFileSync(join(root, relative)); const document = JSON.parse(bytes);
    const artifact = registry.artifacts.find((row) => row.id === id); assert.ok(artifact, 'Missing admitted DISA artifact');
    Object.assign(artifact, { sha256: checksum(bytes), byte_length: bytes.length, artifact_url: manifest.compilation_url, retrieved_at: manifest.retrieval_timestamp.slice(0, 10) });
    if (document.records) artifact.record_count = document.records.length;
    if (document.relationships) artifact.relationship_count = document.relationships.length;
    artifact.metadata = { ...artifact.metadata, byte_evidence_kind: 'normalized_projection', byte_evidence_locator: relative, current_compilation_checksum: manifest.checksum,
      ...(document.record_history ? { supporting_files: [{ ...document.record_history, role: 'retained_native_editions' }] } : {}) };
    const receipt = hydration.results.find((row) => row.id === id);
    if (receipt) Object.assign(receipt, { sha256: artifact.sha256, byte_length: bytes.length, url: manifest.compilation_url, retrieved_at: artifact.retrieved_at });
  }
  const artifact = registry.artifacts.find((row) => row.id === 'artifact-disa-compilation-zip'); assert.ok(artifact);
  const edition = manifest.compilation_url.match(/Library_([A-Za-z]+_\d{4}|\d{4}_\d{2})\.zip$/)?.[1]?.replaceAll('_', ' ') || null;
  Object.assign(artifact, { version: edition, artifact_url: manifest.compilation_url, sha256: manifest.checksum, byte_length: manifest.byte_length, retrieved_at: manifest.retrieval_timestamp.slice(0, 10) });
  const receipt = hydration.results.find((row) => row.id === artifact.id);
  if (receipt) Object.assign(receipt, { sha256: artifact.sha256, byte_length: artifact.byte_length, url: artifact.artifact_url, retrieved_at: artifact.retrieved_at });
  writeJsonAtomically(join(root, 'data/source-registry.json'), registry);
  writeJsonAtomically(join(root, 'data/artifact-hydration-manifest.json'), hydration);
}
