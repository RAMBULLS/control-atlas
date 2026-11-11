import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkerCount } from '../playwright.config.mjs';
import { createGeneratedFixtureReader } from './helpers/generated-fixture-cache.mjs';

test('local browser verification uses a bounded parallel worker pool', () => {
  assert.equal(resolveWorkerCount({}), 2);
  assert.equal(resolveWorkerCount({ CI: 'true' }), 1);
  assert.equal(resolveWorkerCount({ PLAYWRIGHT_WORKERS: '3' }), 3);
  assert.equal(resolveWorkerCount({ PLAYWRIGHT_WORKERS: '0' }), 2);
});

test('large immutable generated fixtures are parsed once per test process', () => {
  const calls = [];
  const generated = createGeneratedFixtureReader({
    root: 'fixture-root',
    read(root, name) {
      calls.push([root, name]);
      return { name };
    },
  });

  assert.strictEqual(generated('nodes'), generated('nodes'));
  assert.strictEqual(generated('edges'), generated('edges'));
  assert.deepEqual(calls, [
    ['fixture-root', 'nodes'],
    ['fixture-root', 'edges'],
  ]);
});

test('assurance registry edits retain mandatory checks in the existing affected planner', async () => {
  const { classifyChangedPaths } = await import('../tools/classify-change-scope.mjs');
  const { createVerificationPlan } = await import('../tools/verify-affected.mjs');
  for (const path of ['config/assurance/promises.json', 'config/assurance/promises.schema.json', 'tools/lib/assurance-contract.mjs', 'tools/verify-assurance.mjs', 'tools/assurance-node-reporter.mjs', 'tools/lib/assurance-node-results.mjs', 'tests/assurance-node-results.test.mjs']) {
    const plan = createVerificationPlan([path], classifyChangedPaths([path]));
    assert.equal(plan.blocked, false, `${path}: ${plan.reasons}`);
    assert.ok(plan.steps.some(step => step.id === 'assurance-contracts'), path);
    assert.ok(plan.steps.some(step => step.id === 'assurance-registry'), path);
    assert.ok(plan.steps.every(step => step.expectedTests <= 50 && step.budgetSeconds <= 120));
  }
});
