import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBrowserEvidence } from '../tools/lib/assurance-results.mjs';
const contract = { version: '1.0.0', promises: [{ id: 'guides', owner_role: 'repository-maintainer', checks: [{ id: 'guides-candidate', phase: 'candidate', scope_ids: ['one', 'two'], references: ['tests/e2e/fixture.spec.mjs'] }] }] };
const identity = { phase: 'candidate', sha: 'a'.repeat(40), artifactDigest: 'b'.repeat(64), browser: 'chromium', runId: 'fixture', resultLocator: 'fixture' };
const report = () => ({ stats: { startTime: '2026-11-11T12:00:00Z', duration: 1234, expected: 2, unexpected: 0, skipped: 0, flaky: 0 }, errors: [], suites: [{ specs: ['one', 'two'].map(scope => ({ title: scope, file: 'fixture.spec.mjs', tests: [{ projectName: 'chromium', annotations: [{ type: 'assurance', description: `guides:${scope}` }], expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }] })) }] });
test('browser evidence derives observed scopes, assertions and time from runner results', () => {
  const row = collectBrowserEvidence(contract, report(), identity).results[0];
  assert.equal(row.status, 'pass');
  assert.deepEqual(row.scope_ids, ['one', 'two']);
  assert.equal(row.observed_at, '2026-11-11T12:00:01.234Z');
});
for (const [name, mutate, expected] of [
  ['missing scope', r => { r.suites[0].specs.pop(); r.stats.expected = 1; }, 'not_run'],
  ['skipped', r => { r.suites[0].specs[0].tests[0].results[0].status = 'skipped'; }, 'fail'],
  ['failed assertion', r => { r.suites[0].specs[0].tests[0].results[0].status = 'failed'; }, 'fail'],
  ['flaky retry', r => r.suites[0].specs[0].tests[0].results.push({ status: 'passed' }), 'fail'],
  ['expected failure', r => { r.suites[0].specs[0].tests[0].expectedStatus = 'failed'; }, 'fail'],
  ['global runner failure', r => r.errors.push({ message: 'server stopped' }), 'fail'],
]) test(`browser evidence never promotes ${name}`, () => {
  const data = report(); mutate(data);
  assert.equal(collectBrowserEvidence(contract, data, identity).results[0].status, expected);
});
test('missing actual runner timing is rejected', () => assert.throws(() => collectBrowserEvidence(contract, {}, identity)));

for (const [name, mutate] of [
  ['empty inventory', r => { r.suites = []; r.stats.expected = 0; }],
  ['duplicate test', r => { r.suites[0].specs.push(r.suites[0].specs[0]); r.stats.expected = 3; }],
  ['unknown source', r => { r.suites[0].specs[0].file = 'unknown.spec.mjs'; }],
  ['wrong browser', r => { r.suites[0].specs[0].tests[0].projectName = 'webkit'; }],
  ['result count mismatch', r => { r.stats.expected = 9; }],
]) test(`collector rejects ${name}`, () => {
  const data = report(); mutate(data);
  assert.throws(() => collectBrowserEvidence(contract, data, identity));
});
