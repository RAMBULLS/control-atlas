#!/usr/bin/env node
// One-time storage migration: move prior-edition citations out of the DISA
// STIG/SRG-to-CCI map into checksummed shards so no file nears GitHub's limit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISA_MAP_PATH, readDisaMap, writeDisaMap } from './lib/disa-map-citations.mjs';
import { disaSupportingFiles } from './lib/disa-record-history.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'data/source-registry.json')));
const hydration = JSON.parse(readFileSync(join(root, 'data/artifact-hydration-manifest.json')));
const original = readDisaMap(root);
const main = writeDisaMap(root, original);
assert.deepEqual(readDisaMap(root), original, 'Citation shards must restore every canonical field');
const bytes = readFileSync(join(root, DISA_MAP_PATH));
const artifact = registry.artifacts.find((row) => row.id === 'artifact-disa-stig-srg-cci-references');
Object.assign(artifact, { sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byte_length: bytes.length });
const metadata = { ...artifact.metadata }; delete metadata.supporting_files;
artifact.metadata = { ...metadata, ...disaSupportingFiles(main) };
const receipt = hydration.results.find((row) => row.id === artifact.id);
if (receipt) Object.assign(receipt, { sha256: artifact.sha256, byte_length: artifact.byte_length });
writeJsonAtomically(join(root, 'data/source-registry.json'), registry);
writeJsonAtomically(join(root, 'data/artifact-hydration-manifest.json'), hydration);
console.log(`map: ${original.relationships.length} connections; ${bytes.length} main bytes; shards ${(main.citation_history?.shards || []).map((shard) => `${shard.path} ${shard.byte_length}`).join(', ')}; lossless restoration passed`);
