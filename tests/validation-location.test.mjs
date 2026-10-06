import assert from 'node:assert/strict';
import test from 'node:test';
import { posix, win32 } from 'node:path';
import { isHostedRunner, requireValidationLocation, verifyHostedCheckout, verifyRemoteHostedRunner } from '../tools/validation-location.mjs';
import { assertCapacity, assertGrowth, assertLocalExpansion } from '../tools/run-local-validation.mjs';
import { verifySourceBranch } from '../tools/local-source-hygiene.mjs';

const sha = 'a'.repeat(40);
const hosted = {
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_NAME: 'GitHub Actions 123',
  ImageOS: 'ubuntu24', GITHUB_RUN_ID: '123', GITHUB_SHA: sha,
  GITHUB_REPOSITORY: 'RAMBULLS/control-atlas', RUNNER_TOOL_CACHE: '/opt/hostedtoolcache', GITHUB_RUN_ATTEMPT: '1',
};
const options = { realpath: (path) => posix.resolve(path), executable: '/opt/hostedtoolcache/node/bin/node', platform: 'linux' };

test('local wrapper rejects stale capacity, unsupported expansions and exceeded output/temporary limits', () => {
  const decision = { ExpectedOutputBytes: 8, ExpectedTemporaryBytes: 8, ReserveBytes: 100 };
  assertCapacity(decision, 108);
  assert.throws(() => assertCapacity(decision, 107), /pre-launch capacity/);
  assert.throws(() => assertCapacity(decision, NaN), /pre-launch capacity/);
  assertGrowth(decision, 8, 120, 104);
  assert.throws(() => assertGrowth(decision, 9, 120, 104), /limit exceeded/);
  assert.throws(() => assertGrowth(decision, 0, 120, 103), /limit exceeded/);
  assert.throws(() => assertGrowth(decision, 0, 120, 99), /limit exceeded/);
  assertLocalExpansion('build:site');
  assert.throws(() => assertLocalExpansion('test:e2e:run'), /does not support/);
  assert.throws(() => assertLocalExpansion('setup:data-python'), /does not support/);
});

test('local and fabricated CI flags never authorize heavy work', () => {
  for (const env of [{}, { CI: 'true' }, { GITHUB_ACTIONS: 'true' },
    { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }]) {
    assert.equal(isHostedRunner(env, options), false);
    assert.throws(() => requireValidationLocation({ ...options, env }), /GitHub-hosted/);
  }
});

test('hosted image identity also requires a runtime inside its real tool cache', () => {
  assert.equal(isHostedRunner(hosted, options), true);
  assert.equal(isHostedRunner(hosted, { ...options, executable: '/local/node' }), false);
  assert.equal(isHostedRunner({ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }, options), false);
  assert.equal(isHostedRunner({ ...hosted, RUNNER_TOOL_CACHE: '/caller-selected/cache' },
    { ...options, executable: '/caller-selected/cache/node' }), false);
  assert.equal(isHostedRunner({ ...hosted, RUNNER_TOOL_CACHE: undefined },
    { ...options, realpath: () => { throw new Error('missing cache'); } }), false);
});

test('hosted image names and runtime containment follow the actual runner platform', () => {
  for (const ImageOS of ['ubuntu24', 'ubuntu26']) {
    assert.equal(isHostedRunner({ ...hosted, ImageOS }, options), true);
  }
  for (const ImageOS of ['win25', 'windows2025', 'ubuntu', 'ubuntuinvalid', 'ubuntu24invalid']) {
    assert.equal(isHostedRunner({ ...hosted, ImageOS }, options), false);
  }
  const windows = { ...hosted, RUNNER_TOOL_CACHE: 'C:\\hostedtoolcache\\windows' };
  const windowsOptions = { platform: 'win32', realpath: (path) => win32.resolve(path),
    executable: 'C:\\hostedtoolcache\\windows\\node\\22\\x64\\node.exe' };
  for (const ImageOS of ['win22', 'win25', 'win25-vs2026']) {
    assert.equal(isHostedRunner({ ...windows, ImageOS }, windowsOptions), true);
  }
  for (const ImageOS of ['ubuntu24', 'windows2025', 'win', 'wininvalid', 'win25invalid']) {
    assert.equal(isHostedRunner({ ...windows, ImageOS }, windowsOptions), false);
  }
  assert.equal(isHostedRunner({ ...windows, ImageOS: 'win25' }, {
    ...windowsOptions, executable: 'C:\\hostedtoolcache\\windows-other\\node.exe',
  }), false);
  assert.equal(isHostedRunner({ ...windows, ImageOS: 'win25' }, {
    ...windowsOptions, executable: 'D:\\hostedtoolcache\\windows\\node.exe',
  }), false);
  assert.equal(isHostedRunner({ ...windows, ImageOS: 'win25', RUNNER_ENVIRONMENT: 'self-hosted' }, windowsOptions), false);
});

test('hosted acceptance requires current GitHub job and runner readback', async () => {
  const job = { id: 123, runner_name: hosted.RUNNER_NAME, runner_group_name: 'GitHub Actions',
    status: 'in_progress', labels: ['ubuntu-latest'], head_sha: sha };
  const request = async () => ({ ok: true, json: async () => ({ jobs: [job] }) });
  assert.equal((await verifyRemoteHostedRunner(hosted, { request })).id, 123);
  for (const jobs of [[], [{ ...job, runner_name: 'other' }], [{ ...job, status: 'completed' }],
    [{ ...job, runner_group_name: 'self-hosted' }], [{ ...job, head_sha: 'b'.repeat(40) }], [job, job]]) {
    await assert.rejects(verifyRemoteHostedRunner(hosted, {
      request: async () => ({ ok: true, json: async () => ({ jobs }) }),
    }), /absent or ambiguous/);
  }
  await assert.rejects(verifyRemoteHostedRunner(hosted, {
    request: async () => ({ ok: false, status: 500 }),
  }), /readback failed/);
  assert.equal((await verifyRemoteHostedRunner({ ...hosted, GITHUB_SHA: 'b'.repeat(40), ATLAS_RUNNER_HEAD_SHA: sha }, { request })).sha, sha);
});

test('fresh checkout is bound to the exact workflow SHA', () => {
  assert.equal(verifyHostedCheckout({ ...options, env: hosted, git: () => sha }).sha, sha);
  assert.throws(() => verifyHostedCheckout({ ...options, env: hosted, git: () => 'b'.repeat(40) }), /does not match/);
  assert.throws(() => verifyHostedCheckout({ ...options, env: {} }), /GitHub-hosted/);
});

test('source hygiene keeps local main denied and admits ordinary task branches', async () => {
  await verifySourceBranch('chore/hosted-main-hygiene', { env: {} });
  await assert.rejects(verifySourceBranch('main', { ...options, env: {} }), /GitHub-hosted/);
  await assert.rejects(verifySourceBranch('main', {
    ...options, env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' },
  }), /GitHub-hosted/);
});

test('source hygiene admits main only with exact hosted checkout and current job proof', async () => {
  const job = { id: 123, runner_name: hosted.RUNNER_NAME, runner_group_name: 'GitHub Actions',
    status: 'in_progress', labels: ['ubuntu-latest'], head_sha: sha };
  const context = { ...options, env: hosted, git: () => sha,
    request: async () => ({ ok: true, json: async () => ({ jobs: [job] }) }) };
  await verifySourceBranch('main', context);
  await assert.rejects(verifySourceBranch('main', { ...context, git: () => 'b'.repeat(40) }), /does not match/);
  await assert.rejects(verifySourceBranch('main', { ...context,
    request: async () => ({ ok: true, json: async () => ({ jobs: [] }) }),
  }), /absent or ambiguous/);
  await assert.rejects(verifySourceBranch('main', { ...context,
    request: async () => ({ ok: false, status: 500 }),
  }), /readback failed/);
});

test('explicit local requests require a current checkout-scoped canonical preflight receipt', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const receipt = {
    authorization: 'current explicit user request', tasks: ['build:data'],
    outputPath: '/checkout',
    expectedSeconds: 30, checkCount: 1,
    issuedAt: '2026-10-06T11:59:00Z', expiresAt: '2026-10-06T12:04:00Z',
    decision: { Allowed: true, Workload: 'Heavy', ExplicitLocalRequestRecorded: true,
      Path: '/checkout', ExpectedOutputBytes: 0, ExpectedTemporaryBytes: 0,
      ReserveBytes: 1024 ** 3, FreeBytes: 2 * 1024 ** 3 },
  };
  const local = { ...options, root: '/checkout', now,
    env: { npm_lifecycle_event: 'prebuild:data', ATLAS_LOCAL_PREFLIGHT: 'approved-receipt.json', ATLAS_LOCAL_MONITOR_PID: '123' },
    readFile: () => JSON.stringify(receipt) };
  assert.equal(requireValidationLocation(local).location, 'explicit-local-request');
  for (const changed of [
    { ...receipt, authorization: '' }, { ...receipt, tasks: ['test'] },
    { ...receipt, expiresAt: '2026-10-06T11:59:59Z' },
    { ...receipt, decision: { ...receipt.decision, Allowed: false } },
    { ...receipt, decision: { ...receipt.decision, ExplicitLocalRequestRecorded: false } },
    { ...receipt, decision: { ...receipt.decision, Path: '/other' } },
    { ...receipt, decision: { ...receipt.decision, FreeBytes: 1 } },
    { ...receipt, outputPath: '/other/output' },
    { ...receipt, expectedSeconds: undefined },
    { ...receipt, checkCount: undefined },
  ]) assert.throws(() => requireValidationLocation({ ...local, readFile: () => JSON.stringify(changed) }), /receipt/);
  assert.throws(() => requireValidationLocation({ ...local, env: { ...local.env, ATLAS_LOCAL_MONITOR_PID: undefined } }), /receipt/);
});
