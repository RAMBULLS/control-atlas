#!/usr/bin/env node

/**
 * Ship a verified task branch to main.
 *
 * The repository rule `main-ship-gate` requires a passing `checks` status on
 * the commit before origin/main accepts it. Two facts make a direct push
 * impossible, and this script exists to work with them rather than around them:
 *
 * 1. No workflow triggers on a task-branch push. Control Atlas CI runs on
 *    `push` to main, on `pull_request`, on schedule, and on dispatch. Pushing a
 *    task branch therefore produces no run at all.
 * 2. A check produced on the task branch is not accepted for a push to main.
 *    Even after dispatching CI manually, the push is refused with
 *    "Required status check \"checks\" is expected".
 *
 * A pull request satisfies the gate because CI runs in the `pull_request`
 * context, which is the same path every recent change to main actually took.
 * So this script:
 *
 * 1. Runs lightweight source hygiene
 * 2. Pushes the task branch
 * 3. Opens a pull request, or reuses the open one
 * 4. Waits for Control Atlas CI on that commit
 * 5. Squash-merges and deletes the branch
 * 6. Leaves the checkout on an up-to-date main
 *
 * Usage:
 *   node tools/ship-to-main.mjs [--no-wait]
 */

import { execFileSync, spawnSync } from 'node:child_process';

import { resolveCommitSha, waitForChecks } from './wait-for-checks.mjs';

const args = new Set(process.argv.slice(2));
const skipLocal = args.has('--skip-local');
const noWait = args.has('--no-wait');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...options }).trim();
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureCleanTree() {
  const status = git(['status', '--porcelain']);
  if (status) {
    console.error('[error] Working tree is not clean. Commit or stash changes first.');
    process.exit(1);
  }
}

/** Reuse the branch's open pull request, or open one from its commit subjects. */
function resolvePullRequest(taskBranch) {
  const existing = gh([
    'pr', 'list', '--head', taskBranch, '--state', 'open',
    '--json', 'number,url', '--jq', '.[0].number // empty',
  ]);
  if (existing) {
    console.log(`[ship] Reusing open pull request #${existing}.`);
    return existing;
  }

  const subjects = git(['log', 'origin/main..HEAD', '--format=%s']).split('\n').filter(Boolean);
  const title = subjects.at(-1) || `Ship ${taskBranch}`;
  const body = subjects.length > 1
    ? `${subjects.map((subject) => `- ${subject}`).join('\n')}\n`
    : `${title}\n`;

  gh(['pr', 'create', '--base', 'main', '--head', taskBranch, '--title', title, '--body', body]);
  const created = gh([
    'pr', 'list', '--head', taskBranch, '--state', 'open',
    '--json', 'number', '--jq', '.[0].number // empty',
  ]);
  console.log(`[ship] Opened pull request #${created}.`);
  return created;
}

async function main() {
  if (process.env.GITHUB_TOKEN) {
    console.log(
      '[warn] GITHUB_TOKEN is set and may break gh auth. Unset it for ship tooling.',
    );
  }

  ensureCleanTree();

  const taskBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (taskBranch === 'main') {
    console.error('[error] Direct ship must start from a verified task branch, not main.');
    process.exit(1);
  }
  const commitSha = resolveCommitSha('HEAD');

  if (skipLocal) throw new Error('--skip-local is retired. Source hygiene and required hosted gates cannot be skipped.');
  console.log('[ship] Checking source hygiene; final validation runs on GitHub...');
  run('npm', ['run', 'verify:local']);

  console.log(`[ship] Pushing ${taskBranch}...`);
  run('node', ['tools/git-push-with-retry.mjs', taskBranch]);

  const pullRequest = resolvePullRequest(taskBranch);

  if (noWait) {
    console.log(`[ship] Skipping remote wait (--no-wait). Merge #${pullRequest} after checks pass.`);
    return;
  }

  console.log(`[ship] Waiting for Control Atlas CI on ${commitSha.slice(0, 7)}...`);
  const checksRun = await waitForChecks(commitSha);
  console.log(`[ok] Remote checks passed: ${checksRun.url}`);

  console.log(`[ship] Squash-merging #${pullRequest}...`);
  run('gh', ['pr', 'merge', String(pullRequest), '--squash', '--match-head-commit', commitSha]);

  git(['checkout', 'main']);
  git(['pull', '--ff-only', 'origin', 'main']);

  console.log('[ok] Ship complete.');
  console.log(`     Pull request: #${pullRequest}`);
  console.log(`     Branch:       ${taskBranch}`);
  console.log(`     Commit:       ${commitSha.slice(0, 7)}`);
  console.log(`     Main:         ${resolveCommitSha('HEAD').slice(0, 7)}`);
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exit(1);
});
