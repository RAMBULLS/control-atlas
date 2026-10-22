import assert from 'node:assert/strict';
import test from 'node:test';
import { reportReleaseHealth, selectReleaseObservation } from '../tools/report-release-health.mjs';
import { planSweepAlert } from '../tools/report-sweep-alert.mjs';

const sha = 'a'.repeat(40);
const run = { id: 123, run_attempt: 1, workflow_id: 12, path: '.github/workflows/ci.yml',
  repository: { full_name: 'RAMBULLS/control-atlas' }, head_branch: 'main', head_sha: sha,
  status: 'completed', event: 'push', conclusion: 'failure' };
const observe = (value = run, latest = value) => selectReleaseObservation(value, sha, latest);

test('a main failure opens one persistent incident, stays quiet, and closes only on actual recovery', () => {
  const failure = observe();
  const [create] = planSweepAlert({ ...failure, issues: [] });
  assert.deepEqual(create.payload.labels, ['release-red-ci']);
  assert.match(create.payload.body, /Main CI failed/);
  const issue = { number: 394, state: 'open', ...create.payload };
  assert.deepEqual(planSweepAlert({ ...failure, issues: [issue] }), []);
  const recovery = observe({ ...run, id: 124, conclusion: 'success' });
  assert.equal(planSweepAlert({ ...recovery, issues: [issue] })[0].type, 'comment-close');
});

test('stale commits, attempts, and earlier events cannot erase a current failure', () => {
  for (const value of [
    observe({ ...run, head_sha: 'b'.repeat(40), conclusion: 'success' }),
    observe(run, { ...run, id: 124 }),
    observe(run, { ...run, run_attempt: 2 }),
  ]) assert.equal(value.ignored, 'superseded-release-observation');
});

test('pull requests, foreign repositories, skipped deploys and unsupported workflows cannot write incidents', () => {
  for (const value of [
    { ...run, event: 'pull_request' }, { ...run, head_branch: 'feature' },
    { ...run, repository: { full_name: 'other/repo' } }, { ...run, path: '.github/workflows/other.yml' },
  ]) assert.equal(observe(value).ignored, 'outside-production-release');
  assert.equal(observe({ ...run, path: '.github/workflows/deploy.yml', event: 'workflow_run',
    conclusion: 'skipped' }).ignored, 'upstream-release-was-not-eligible');
});

test('security and deployment failures have separate incident identities; cancelled work is not success', () => {
  const security = observe({ ...run, path: '.github/workflows/security.yml', conclusion: 'cancelled' });
  const deploy = observe({ ...run, path: '.github/workflows/deploy.yml', event: 'workflow_run' });
  assert.equal(security.kind, 'release-security');
  assert.equal(deploy.kind, 'release-deploy');
  assert.match(planSweepAlert({ ...security, issues: [] })[0].payload.body, /cancelled/);
});

test('release reporting uses remote run identity and verifies issue delivery instead of trusting event prose', () => {
  const writes = [];
  const execute = (_cmd, args, options = {}) => {
    if (args.includes('POST') || args[0] === 'label') { writes.push({ args, input: options.input }); return ''; }
    if (args.includes('--slurp')) return '[[]]';
    const path = args[1];
    if (path.endsWith('/actions/runs/123')) return JSON.stringify(run);
    if (path.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha } });
    if (path.includes('/actions/workflows/')) return JSON.stringify({ workflow_runs: [run] });
    if (path === 'repos/RAMBULLS/control-atlas') return '{"has_issues":true}';
    assert.fail(`Unexpected call: ${args.join(' ')}`);
  };
  assert.equal(reportReleaseHealth({ REPO: 'RAMBULLS/control-atlas', OBSERVED_RUN_ID: '123' },
    { execFileImpl: execute }).red, true);
  assert.equal(writes.length, 2);
  assert.throws(() => reportReleaseHealth({ REPO: 'other/repo', OBSERVED_RUN_ID: '123' },
    { execFileImpl: () => assert.fail('Invalid target must not be read') }), /Invalid release/);
  assert.throws(() => reportReleaseHealth({ REPO: 'RAMBULLS/control-atlas', OBSERVED_RUN_ID: '123' }, {
    execFileImpl: (cmd, args, options) => args[1] === 'repos/RAMBULLS/control-atlas' ? '{"has_issues":false}' : execute(cmd, args, options),
  }), /Issues are disabled/);
});
