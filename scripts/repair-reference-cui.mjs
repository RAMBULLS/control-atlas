#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCuiPolicyCatalog } from '../tools/importers/framework-adapters.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'data/cui-policy.json');
const prior = new Map(JSON.parse(readFileSync(file)).records.map((record) => [record.id, record]));
const registryPath = join(root, 'data/nara-cui-registry-manifest.json');
const document = buildCuiPolicyCatalog(JSON.parse(readFileSync(registryPath)).generated_at, registryPath);
for (const record of document.records) {
  const old = prior.get(record.id);
  if (old && old.metadata?.sha256 === record.metadata?.sha256) record.source = old.source;
}
writeJsonAtomically(file, document);
console.log(`CUI catalog: ${document.records.length} records; unavailable detail prose is explicitly source-qualified.`);
