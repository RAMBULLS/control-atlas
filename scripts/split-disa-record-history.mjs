#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDisaCatalog, writeDisaCatalog } from './lib/disa-record-history.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'data/source-registry.json')));
const hydration = JSON.parse(readFileSync(join(root, 'data/artifact-hydration-manifest.json')));
for (const kind of ['stig', 'srg']) {
  const original = readDisaCatalog(root, kind);
  const main = writeDisaCatalog(root, kind, original);
  assert.deepEqual(readDisaCatalog(root, kind), original, 'Supporting history must restore every canonical field');
  const bytes = readFileSync(join(root, 'data', kind === 'stig' ? 'stig-rules.json' : 'srg-requirements.json'));
  assert.ok(bytes.length < 100 * 1024 * 1024, 'Canonical source file exceeds GitHub blob limit');
  const artifact = registry.artifacts.find((row) => row.id === `artifact-disa-${kind}-library`);
  Object.assign(artifact, { sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byte_length: bytes.length });
  artifact.metadata = { ...artifact.metadata, ...(main.record_history ? { supporting_files: [{ ...main.record_history, role: 'retained_native_editions' }] } : {}) };
  const receipt = hydration.results.find((row) => row.id === artifact.id);
  if (receipt) Object.assign(receipt, { sha256: artifact.sha256, byte_length: artifact.byte_length });
  console.log(`${kind}: ${main.records.length} IDs; ${main.record_history?.edition_count || 0} complete prior editions; ${bytes.length} main bytes; lossless restoration passed`);
}
writeJsonAtomically(join(root, 'data/source-registry.json'), registry);
writeJsonAtomically(join(root, 'data/artifact-hydration-manifest.json'), hydration);
