import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { practitionerGuides } from '../src/app/learn-content.mjs';
import { assessEvidence, validateContract } from './lib/assurance-contract.mjs';

export function verifyAssurance({ root = process.cwd(), evidence, phase, sha, artifactDigest, origin, now } = {}) {
  const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const contract = read('config/assurance/promises.json');
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(read('config/assurance/promises.schema.json'));
  if (!validate(contract)) throw new Error(JSON.stringify(validate.errors));
  const registry = read('data/template-registry.json');
  const errors = validateContract(contract, {
    exists: path => typeof path === 'string' && !relative(root, resolve(root, path)).startsWith('..') && existsSync(resolve(root, path)),
    templateScopes: registry.templates.flatMap(t => t.supported_formats.map(f => `${t.template_id}:${f}`)),
    guideScopes: practitionerGuides.map(g => g.id),
  });
  if (registry.templates.length !== 10) errors.push('template inventory must contain ten IDs');
  if (errors.length) throw new Error(errors.join('\n'));
  if (!evidence) return { status: 'contract_valid', limitation: 'No execution evidence evaluated; this is not release acceptance.' };
  return assessEvidence(contract, read(evidence), { phase, sha, artifactDigest, origin, now });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const value = key => { const index = process.argv.indexOf(`--${key}`); return index < 0 ? undefined : process.argv[index + 1]; };
  try {
    const result = verifyAssurance({ evidence: value('evidence'), phase: value('phase'), sha: value('sha'), artifactDigest: value('artifact-digest'), origin: value('origin') });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'unknown_or_failed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
