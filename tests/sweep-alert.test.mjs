import assert from 'node:assert/strict';
import test from 'node:test';
import { applySweepAlert, assessSweep, planSweepAlert, runSweepAlert } from '../tools/report-sweep-alert.mjs';

const run = (id) => `https://github.com/RAMBULLS/control-atlas/actions/runs/${id}`;
const green = { build: 'success', browser: 'success', accessibility: 'success', refresh: 'skipped' };
const issue = (over = {}) => ({ number: 245, state: 'open', title: 'Scheduled Control Atlas job is failing: sweep-red-nightly', body: '', ...over });

test('a job the sweep never schedules may be skipped, and one it schedules may not', () => {
  assert.equal(assessSweep('nightly', green).red, false);
  assert.equal(assessSweep('refresh', { ...green, refresh: 'success' }).red, false);
  const skipped = assessSweep('nightly', { ...green, browser: 'skipped' });
  assert.equal(skipped.red, true, 'a browser suite that did not run cannot make the sweep green');
  assert.deepEqual(skipped.failing.map((job) => job.text), ['did not run']);
  assert.equal(assessSweep('refresh', { ...green, refresh: 'skipped' }).red, true);
  assert.equal(assessSweep('nightly', { ...green, build: undefined }).red, true);
  assert.equal(assessSweep('nightly', { ...green, accessibility: 'cancelled' }).failing[0].text, 'was cancelled');
  assert.throws(() => assessSweep('weekly', green), /Unknown sweep/);
});

test('red creates exactly one issue that names only what failed', () => {
  const [create] = planSweepAlert({ kind: 'nightly', results: { ...green, browser: 'failure' }, issues: [], runUrl: run(1) });
  assert.equal(create.type, 'create');
  assert.deepEqual(create.payload.labels, ['sweep-red-nightly']);
  assert.match(create.payload.body, /Browser tests failed/);
  assert.doesNotMatch(create.payload.body, /Accessibility|Build and contracts/);
});

test('staying red with the same failure adds no noise, even on a new run', () => {
  const first = planSweepAlert({ kind: 'nightly', results: { ...green, browser: 'failure' }, issues: [], runUrl: run(1) })[0].payload;
  assert.deepEqual(planSweepAlert({ kind: 'nightly', results: { ...green, browser: 'failure' }, issues: [issue(first)], runUrl: run(2) }), []);
});

test('a different failing set updates the same issue instead of leaving it stale or opening another', () => {
  // #245 said "Accessibility: success" while accessibility was in fact failing.
  const first = planSweepAlert({ kind: 'nightly', results: { ...green, browser: 'failure' }, issues: [], runUrl: run(1) })[0].payload;
  const [update, ...rest] = planSweepAlert({ kind: 'nightly', results: { ...green, browser: 'failure', accessibility: 'failure' }, issues: [issue(first)], runUrl: run(2) });
  assert.equal(rest.length, 0);
  assert.equal(update.type, 'update');
  assert.equal(update.number, 245);
  assert.match(update.payload.body, /Browser tests failed/);
  assert.match(update.payload.body, /Accessibility tests failed/);
  // One sub-job recovering shrinks the list rather than leaving it in place.
  const shrink = planSweepAlert({ kind: 'nightly', results: { ...green, accessibility: 'failure' }, issues: [issue(update.payload)], runUrl: run(3) })[0];
  assert.doesNotMatch(shrink.payload.body, /Browser tests/);
  assert.match(shrink.payload.body, /Accessibility tests failed/);
});

test('a legacy issue body from the old inline script is brought up to date', () => {
  const legacy = issue({ body: 'A scheduled job failed.\n\nBuild: success\nBrowser: failure\nAccessibility: success\nData refresh: skipped\n\nRun: x' });
  const [update] = planSweepAlert({ kind: 'nightly', results: { ...green, browser: 'failure' }, issues: [legacy], runUrl: run(9) });
  assert.equal(update.type, 'update');
});

test('green comments once and closes the open issue; nothing open means nothing to do', () => {
  const [close] = planSweepAlert({ kind: 'nightly', results: green, issues: [issue()], runUrl: run(4) });
  assert.equal(close.type, 'comment-close');
  assert.equal(close.number, 245);
  assert.deepEqual(planSweepAlert({ kind: 'nightly', results: green, issues: [], runUrl: run(4) }), []);
  assert.deepEqual(planSweepAlert({ kind: 'nightly', results: green, issues: [issue({ state: 'closed' }), issue({ pull_request: {} })], runUrl: run(4) }), []);
});

test('duplicate open alerts are consolidated into the oldest', () => {
  const plans = planSweepAlert({ kind: 'refresh', results: { ...green, refresh: 'failure' }, issues: [issue({ number: 7, title: 'x' }), issue({ number: 3, title: 'x' })], runUrl: run(5) });
  assert.equal(plans.find((plan) => plan.type === 'update').number, 3);
  const duplicate = plans.find((plan) => plan.type === 'comment-close');
  assert.equal(duplicate.number, 7);
  assert.equal(duplicate.notPlanned, true);
});

function fakeGh(state) {
  const calls = [];
  return {
    calls,
    execFileImpl: (_cmd, args, options = {}) => {
      calls.push({ args, input: options.input });
      if (args[0] === 'api' && args[1] === 'repos/RAMBULLS/control-atlas') return 'true\n';
      if (args.includes('--slurp')) return JSON.stringify([state.issues]);
      return '';
    },
  };
}
const env = (over = {}) => ({
  SWEEP_KIND: 'nightly', REPO: 'RAMBULLS/control-atlas', RUN_URL: run(6),
  RESULT_BUILD: 'success', RESULT_BROWSER: 'success', RESULT_ACCESSIBILITY: 'success', RESULT_REFRESH: 'skipped', ...over,
});

test('the command creates on red, is quiet on the same red, and closes on recovery', () => {
  const opened = fakeGh({ issues: [] });
  runSweepAlert(env({ RESULT_BROWSER: 'failure' }), opened);
  assert.ok(opened.calls.some((call) => call.args.includes('create') && call.args.includes('sweep-red-nightly')));
  const posted = opened.calls.find((call) => call.args.includes('POST') && call.args.includes('repos/RAMBULLS/control-atlas/issues'));
  assert.deepEqual(JSON.parse(posted.input).labels, ['sweep-red-nightly']);

  const quiet = fakeGh({ issues: [issue({ body: JSON.parse(posted.input).body, title: JSON.parse(posted.input).title })] });
  const result = runSweepAlert(env({ RESULT_BROWSER: 'failure' }), quiet);
  assert.equal(result.plans.length, 0);
  assert.equal(quiet.calls.filter((call) => call.args.includes('POST') || call.args.includes('PATCH')).length, 0);

  const closing = fakeGh({ issues: [issue()] });
  runSweepAlert(env(), closing);
  assert.ok(closing.calls.some((call) => call.args.includes('PATCH') && JSON.parse(call.input).state === 'closed'));
  assert.ok(closing.calls.some((call) => call.args.some((arg) => String(arg).endsWith('/comments'))));
});

test('disabled Issues fail loudly and malformed inputs are rejected before any write', () => {
  const disabled = { execFileImpl: () => 'false\n' };
  assert.throws(() => runSweepAlert(env(), disabled), /Issues are disabled/);
  assert.throws(() => runSweepAlert(env({ REPO: 'not a repo' }), fakeGh({ issues: [] })), /Invalid repository/);
  assert.throws(() => runSweepAlert(env({ RUN_URL: 'https://example.com/run' }), fakeGh({ issues: [] })), /Invalid run URL/);
  const untouched = fakeGh({ issues: [] });
  applySweepAlert([], { repository: 'RAMBULLS/control-atlas', execFileImpl: untouched.execFileImpl, label: 'x' });
  assert.equal(untouched.calls.length, 0);
});

test('source, aggregate refresh and nightly alerts are separate states and must stay separate', () => {
  // Do not merge these into one global health state.
  const labels = ['nightly', 'refresh'].map((kind) => assessSweep(kind, green).label);
  assert.deepEqual(labels, ['sweep-red-nightly', 'sweep-red-refresh']);
  // A green nightly never closes the refresh alert and a green refresh never closes the nightly one.
  const refreshIssue = issue({ title: 'Scheduled Control Atlas job is failing: sweep-red-refresh' });
  assert.equal(planSweepAlert({ kind: 'nightly', results: green, issues: [], runUrl: run(1) }).length, 0);
  assert.equal(planSweepAlert({ kind: 'refresh', results: { ...green, refresh: 'success' }, issues: [refreshIssue], runUrl: run(1) })[0].type, 'comment-close');
  // Aggregate refresh is red whenever the refresh job fails, even if every source was individually accepted.
  assert.equal(assessSweep('refresh', { ...green, refresh: 'failure' }).red, true);
});
