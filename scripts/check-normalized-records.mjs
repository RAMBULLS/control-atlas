#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNormalizedRecords } from '../tools/normalizers/oscal-normalize.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['controls-800-53.json', 'csf-subcategories.json', '800-53b-baselines.json']) {
  validateNormalizedRecords(JSON.parse(readFileSync(join(root, 'data', file), 'utf8')));
}
console.log('AJV validated three internal normalized record files; this is not upstream OSCAL validation.');
