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
