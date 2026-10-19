#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cuiPublisherInventory } from '../tools/importers/cui-inventory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const acquisitions = read('.local-agent/reference-export/inventory-acquisition.json');
function verified(id) {
  const entry = acquisitions.sources.find((source) => source.id === id);
  assert.equal(entry?.status, 'ACQUIRED', `Missing acquired ${id}`);
  const bytes = readFileSync(join(root, entry.path));
  assert.equal(bytes.length, entry.bytes); assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, entry.sha256);
  return bytes.toString('utf8');
}
const proof = cuiPublisherInventory(verified('nara-category-list'), verified('artifact-isoo-cui-regulation'));
const document = read('data/cui-policy.json');
assert.deepEqual(document.records.map((record) => record.id).sort(), proof.record_ids, 'Source identity reconciliation failed');
const manifest = read('data/nara-cui-registry-manifest.json');
assert.equal(proof.source_evidence[0].sha256, `sha256:${manifest.list_page.sha256}`, 'Category inventory bytes differ from accepted source');
manifest.publisher_inventory = proof;
writeFileSync(join(root, 'data/nara-cui-registry-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`CUI publisher identity inventory PASSED: ${proof.record_count} items from separately traversed official registry and regulatory foundation definitions.`);
