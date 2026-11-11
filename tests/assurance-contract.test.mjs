import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { practitionerGuides } from '../src/app/learn-content.mjs';
import { assessEvidence, contractHash, validateContract } from '../tools/lib/assurance-contract.mjs';

const contract = JSON.parse(readFileSync('config/assurance/promises.json', 'utf8'));
const templates = JSON.parse(readFileSync('data/template-registry.json', 'utf8')).templates;
const context = { exists: existsSync, templateScopes: templates.flatMap(t => t.supported_formats.map(f => `${t.template_id}:${f}`)), guideScopes: practitionerGuides.map(g => g.id) };
const sha = 'a'.repeat(40), artifactDigest = 'b'.repeat(64), now = Date.parse('2026-11-11T12:00:00Z');
const execution = { run_id: '123', result_locator: 'https://github.com/RAMBULLS/control-atlas/actions/runs/123/artifacts/456', code_sha: sha, artifact_digest: artifactDigest, phase: 'candidate', browser: 'chromium', report_sha256: 'd'.repeat(64), assertions: [] };
const options = { phase: 'candidate', sha, artifactDigest, now, execution };
function fixture() {
  return { results: contract.promises.map(p => {
    const check = p.checks.find(c => c.phase === 'candidate');
    return { check_id: check.id, phase: 'candidate', contract_hash: contractHash(contract), contract_version: contract.version, code_sha: sha, artifact_digest: artifactDigest,
      run_id: execution.run_id, result_locator: execution.result_locator, browser: execution.browser, report_sha256: execution.report_sha256, observed_at: '2026-11-11T11:00:00Z', valid_until: '2026-11-11T13:00:00Z',
      scope_ids: check.scope_ids, owner_role: p.owner_role, limitations: ['Synthetic validator fixture, not product evidence'], next_check: 'next release', status: 'pass',
      assertions: check.scope_ids.map(scope_id => ({ id: `fixture:${scope_id}`, scope_id, status: 'pass' })) };
  }) };
}

execution.assertions = fixture().results.flatMap(row => row.assertions.map(a => ({ ...a, check_id: row.check_id })));

test('nine promises bind every template format and guide to current registry IDs and references', () => {
  assert.equal(templates.length, 10);
  assert.equal(practitionerGuides.length, 11);
  assert.deepEqual(validateContract(contract, context), []);
});
for (const [name, mutate] of [
  ['duplicate promise', c => c.promises.push(c.promises[0])],
  ['unknown promise', c => { c.promises[0].id = 'unknown'; }],
  ['missing phase', c => c.promises[0].checks.pop()],
  ['orphan scope', c => c.promises[0].checks[0].scope_ids.push('orphan')],
  ['missing required evidence', c => c.promises[0].required_evidence.pop()],
  ['stale reference', c => { c.promises[0].checks[0].references = ['tests/does-not-exist.mjs']; }],
  ['changed template registry ID', c => { c.promises.find(p => p.id === 'templates').scope_ids[0] = 'unknown'; }],
]) test(`contract rejects ${name}`, () => {
  const changed = structuredClone(contract); mutate(changed);
  assert.ok(validateContract(changed, context).length);
});

test('evidence validator accepts only a complete synthetic test fixture', () => assert.equal(assessEvidence(contract, fixture(), options).status, 'pass'));
for (const [name, mutate] of [
  ['duplicate assertion', e => e.results[0].assertions.push(e.results[0].assertions[0])],
  ['unexpected assertion', e => { e.results[0].assertions[0].id = 'invented'; }],
  ['arbitrary locator', e => { e.results[0].result_locator = 'fixture-only'; }],
  ['far-future expiry', e => { e.results[0].valid_until = '2036-11-11T13:00:00Z'; }],
  ['wrong report digest', e => { e.results[0].report_sha256 = 'e'.repeat(64); }],
  ['missing result', e => e.results.pop()],
  ['unknown result', e => { e.results[0].check_id = 'unknown'; }],
  ['duplicate result', e => e.results.push(e.results[0])],
  ['not run', e => { e.results[0].status = 'not_run'; }],
  ['unsupported exemption', e => { e.results[0].status = 'not_applicable'; e.results[0].reason = 'skipped'; }],
  ['failed assertion', e => { e.results[0].assertions[0].status = 'fail'; }],
  ['unexercised scope', e => e.results[0].assertions.pop()],
  ['wrong commit', e => { e.results[0].code_sha = 'c'.repeat(40); }],
  ['wrong artifact', e => { e.results[0].artifact_digest = 'c'.repeat(64); }],
  ['stale contract', e => { e.results[0].contract_hash = 'c'.repeat(64); }],
  ['stale observation', e => { e.results[0].valid_until = '2026-11-10T13:00:00Z'; }],
  ['future observation', e => { e.results[0].observed_at = '2026-11-12T13:00:00Z'; }],
  ['missing owner', e => { delete e.results[0].owner_role; }],
  ['missing result identity', e => { delete e.results[0].result_locator; }],
]) test(`evidence rejects ${name}`, () => {
  const evidence = fixture(); mutate(evidence);
  assert.notEqual(assessEvidence(contract, evidence, options).status, 'pass');
});
test('candidate results cannot attest actual-domain live acceptance', () => {
  assert.notEqual(assessEvidence(contract, fixture(), { ...options, phase: 'live', origin: 'http://localhost:4173' }).status, 'pass');
});
test('previously passing evidence expires at evaluation time', () => {
  assert.notEqual(assessEvidence(contract, fixture(), { ...options, now: now + 86400000 }).status, 'pass');
});

test('caller-authored evidence without independent execution cannot pass', () => assert.notEqual(assessEvidence(contract, fixture(), { ...options, execution: undefined }).status, 'pass'));
