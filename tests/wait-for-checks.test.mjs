import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECK_WORKFLOW_FILE, CHECK_WORKFLOW_NAME, waitForChecks } from '../tools/wait-for-checks.mjs';

const commitSha = '89fc3d55c3a850e89fe184d026fd542b1854b017';
const run = (databaseId, status = 'completed', conclusion = 'success') => ({
  databaseId, headSha: commitSha, name: CHECK_WORKFLOW_NAME, status, conclusion, url: `https://github.example/runs/${databaseId}`,
});
const job = (name, conclusion = 'success', status = 'completed') => ({ name, conclusion, status });
const details = (value, jobs = [job('Required CI'), job('checks')]) => ({ ...value, jobs });

function harness(runs, inventories) {
  let clock = 0; const calls = [];
  return { calls, options: {
    log: () => {}, now: () => clock, pollMs: 5, timeoutMs: 10,
    sleep: async milliseconds => { clock += milliseconds; },
    runGh(args) {
      calls.push(args);
      if (args[1] === 'list') return JSON.stringify(typeof runs === 'function' ? runs(clock) : runs);
      assert.equal(args[1], 'view');
      const value = typeof inventories === 'function' ? inventories(Number(args[2]), clock) : inventories[args[2]];
      return JSON.stringify(value);
    },
  } };
}

test('checks waiter uses canonical workflow and verifies both actual exact-head acceptance jobs', async () => {
  const expected = run(1); const fixture = harness([expected], { 1: details(expected) });
  assert.deepEqual(await waitForChecks(commitSha, fixture.options), expected);
  assert.deepEqual(fixture.calls[0].slice(0, 6), ['run', 'list', '--workflow', CHECK_WORKFLOW_FILE, '--commit', commitSha]);
  assert.deepEqual(fixture.calls[1], ['run', 'view', '1', '--json', 'headSha,status,conclusion,jobs']);
  assert.equal(CHECK_WORKFLOW_FILE, 'ci.yml'); assert.equal(CHECK_WORKFLOW_NAME, 'Control Atlas CI');
});

test('newer successful diagnostic cannot conceal an older failed standard run or accept an older green run', async () => {
  const diagnostic = run(3); const failed = run(2, 'completed', 'failure'); const older = run(1);
  const fixture = harness([diagnostic, failed, older], {
    3: details(diagnostic, [job('Required CI', 'skipped'), job('checks', 'skipped')]),
    2: details(failed, [job('Required CI', 'failure'), job('checks', 'failure')]), 1: details(older),
  });
  await assert.rejects(waitForChecks(commitSha, fixture.options), /Required CI: failure/);
  assert.deepEqual(fixture.calls.filter(args => args[1] === 'view').map(args => args[2]), ['3', '2']);
});

test('diagnostic-only skipped acceptance cannot return success', async () => {
  const diagnostic = run(1); const fixture = harness([diagnostic], { 1: details(diagnostic, [job('Required CI', 'skipped'), job('checks', 'skipped')]) });
  await assert.rejects(waitForChecks(commitSha, fixture.options), /Timed out/);
});

for (const jobs of [[], [job('Required CI')], [job('Required CI'), job('checks'), job('checks')]]) {
  test(`missing or ambiguous acceptance inventory (${jobs.length} jobs) cannot fall back to older green`, async () => {
    const latest = run(2); const older = run(1);
    const fixture = harness([latest, older], { 2: details(latest, jobs), 1: details(older) });
    await assert.rejects(waitForChecks(commitSha, fixture.options), /Timed out/);
    assert.ok(!fixture.calls.some(args => args[1] === 'view' && args[2] === '1'));
  });
}

test('pending standard acceptance blocks older green and is polled until both gates pass', async () => {
  const latest = run(2); const older = run(1);
  const fixture = harness([latest, older], (id, clock) => id === 1 ? details(older) : clock === 0
    ? details(run(2, 'in_progress', ''), [job('Required CI', '', 'in_progress'), job('checks', '', 'queued')]) : details(latest));
  assert.deepEqual(await waitForChecks(commitSha, fixture.options), latest);
  assert.equal(fixture.calls.filter(args => args[1] === 'list').length, 2);
  assert.ok(!fixture.calls.some(args => args[1] === 'view' && args[2] === '1'));
});

test('partially reported diagnostic skip stays unresolved until both skip conclusions are available', async () => {
  const diagnostic = run(2); const standard = run(1);
  const fixture = harness([diagnostic, standard], (id, clock) => id === 1 ? details(standard)
    : details(clock === 0 ? run(2, 'in_progress', '') : diagnostic,
      [job('Required CI', 'skipped'), job('checks', clock === 0 ? '' : 'skipped', clock === 0 ? 'queued' : 'completed')]));
  assert.deepEqual(await waitForChecks(commitSha, fixture.options), standard);
  assert.equal(fixture.calls.filter(args => args[1] === 'list').length, 2);
});

for (const gates of [[job('Required CI', 'failure'), job('checks')], [job('Required CI'), job('checks', 'failure')],
  [job('Required CI', 'cancelled'), job('checks')], [job('Required CI', 'skipped'), job('checks')]]) {
  test(`overall workflow success cannot override ${gates.find(value => value.conclusion !== 'success').name} ${gates.find(value => value.conclusion !== 'success').conclusion}`, async () => {
    const value = run(1); const fixture = harness([value], { 1: details(value, gates) });
    await assert.rejects(waitForChecks(commitSha, fixture.options), /Control Atlas CI failed/);
  });
}

test('failed overall workflow still fails closed even if aggregates appear successful', async () => {
  const value = run(1, 'completed', 'failure'); const fixture = harness([value], { 1: details(value) });
  await assert.rejects(waitForChecks(commitSha, fixture.options), /Control Atlas CI failed \(failure\)/);
});

test('a newer diagnostic is excluded before accepting successful standard acceptance', async () => {
  const diagnostic = run(2); const standard = run(1); const fixture = harness([diagnostic, standard], {
    2: details(diagnostic, [job('Required CI', 'skipped'), job('checks', 'skipped')]), 1: details(standard),
  });
  assert.deepEqual(await waitForChecks(commitSha, fixture.options), standard);
});

for (const mismatched of ['list', 'view']) test(`wrong-head ${mismatched} evidence fails closed`, async () => {
  const value = run(1); const other = 'a'.repeat(40);
  const fixture = harness([{ ...value, ...(mismatched === 'list' ? { headSha: other } : {}) }],
    { 1: { ...details(value), ...(mismatched === 'view' ? { headSha: other } : {}) } });
  await assert.rejects(waitForChecks(commitSha, fixture.options), /run identity/);
});

test('waiter times out without any canonical run and rejects abbreviated commit identities', async () => {
  const fixture = harness([], {});
  await assert.rejects(waitForChecks(commitSha, fixture.options), /Timed out/);
  await assert.rejects(waitForChecks('89fc3d5', fixture.options), /full commit SHA/);
});
