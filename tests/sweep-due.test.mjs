import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { decideSweepDue } from '../tools/sweep-due.mjs';

const NAME = 'Nightly build and contracts';
const run = (id, conclusion) => ({ id, jobs: [{ name: NAME, conclusion }, { name: 'Other', conclusion: 'success' }] });

test('a commit that never went through the job is due', () => {
  assert.deepEqual(decideSweepDue({ runs: [], currentRunId: 9, jobName: NAME }), { due: true, reason: 'commit_not_yet_tested' });
});

test('a commit already tested, passing or failing, is not tested again', () => {
  for (const conclusion of ['success', 'failure']) {
    const outcome = decideSweepDue({ runs: [run(5, conclusion)], currentRunId: 9, jobName: NAME });
    assert.equal(outcome.due, false, conclusion);
    assert.match(outcome.reason, /already_tested_in_run_5/);
  }
});

test('skipped or cancelled jobs, other jobs and the current run never count as tested', () => {
  for (const conclusion of ['skipped', 'cancelled', null]) assert.equal(decideSweepDue({ runs: [run(5, conclusion)], currentRunId: 9, jobName: NAME }).due, true, String(conclusion));
  assert.equal(decideSweepDue({ runs: [run(5, 'success')], currentRunId: 9, jobName: 'Independent OSCAL validation' }).due, true);
  assert.equal(decideSweepDue({ runs: [run(9, 'success')], currentRunId: 9, jobName: NAME }).due, true);
});

test('the workflow gates only the checks that re-test our own code, and never the publisher or security watches', () => {
  const jobs = parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs;
  for (const name of ['nightly-build', 'nightly-report', 'oscal', 'sweep-alert']) {
    const gated = String(jobs[name].if);
    assert.match(gated, /sweep-gate\.outputs\.(nightly|oscal)_due == 'true'/, name);
  }
  assert.ok(jobs['nightly-build'].needs.includes?.('sweep-gate') || jobs['nightly-build'].needs === 'sweep-gate');
  // Publisher refresh watches the outside world, so it is never gated on our commit.
  assert.doesNotMatch(String(jobs.refresh.if), /sweep-gate/);
  // Manual dispatch always runs.
  assert.match(String(jobs['nightly-build'].if), /workflow_dispatch/);
});
