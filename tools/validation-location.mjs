import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, posix, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function isHostedRunner(env = process.env, options = {}) {
  const realpath = options.realpath ?? realpathSync;
  const executable = options.executable ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const cacheRoot = { linux: '/opt/hostedtoolcache', win32: 'C:\\hostedtoolcache\\windows' }[platform];
  const paths = { linux: posix, win32 }[platform];
  const imagePattern = { linux: /^ubuntu\d+(?:-|$)/i, win32: /^win\d+(?:-|$)/i }[platform];
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      !/^GitHub Actions \S+/.test(env.RUNNER_NAME ?? '') ||
      !imagePattern?.test(env.ImageOS ?? '') ||
      !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^[a-f0-9]{40}$/i.test(env.GITHUB_SHA ?? '') ||
      env.GITHUB_REPOSITORY?.toLowerCase() !== 'rambulls/control-atlas') return false;
  try {
    const cache = realpath(env.RUNNER_TOOL_CACHE);
    if (!cacheRoot || cache.toLowerCase() !== paths.resolve(cacheRoot).toLowerCase()) return false;
    const path = paths.relative(cache, realpath(executable));
    return path !== '' && !path.startsWith('..') && !paths.isAbsolute(path);
  } catch {
    return false;
  }
}

export function requireValidationLocation(options = {}) {
  const env = options.env ?? process.env;
  if (isHostedRunner(env, options)) return { location: 'github-hosted' };
  // A pointer to a scoped, current preflight receipt is not an approval flag.
  // The operator must already hold the explicit user authorization named in it.
  if (env.ATLAS_LOCAL_PREFLIGHT) {
    const receipt = JSON.parse((options.readFile ?? readFileSync)(env.ATLAS_LOCAL_PREFLIGHT, 'utf8'));
    const decision = receipt.decision;
    const now = options.now ?? Date.now();
    const task = (env.npm_lifecycle_event ?? '').replace(/^pre(?=(?:build|generate|test|verify|refresh|fetch|audit|lint|typecheck|materialize|diagnose|lighthouse|qa|review|extract|hydrate|resources|setup|sync|migrate|check|smoke|sbom|dev|serve|precommit|prepush))/, '');
    const issued = Date.parse(receipt.issuedAt);
    const expires = Date.parse(receipt.expiresAt);
    const outputPath = resolve(receipt.outputPath ?? '');
    if (decision?.Allowed === true && decision.Workload === 'Heavy' &&
        decision.ExplicitLocalRequestRecorded === true && typeof receipt.authorization === 'string' &&
        receipt.authorization.trim() && issued <= now && expires > now && expires - issued <= 15 * 60_000 &&
        resolve(decision.Path ?? '') === resolve(options.root ?? root) &&
        Array.isArray(receipt.tasks) && receipt.tasks.includes(task) &&
        Number.isSafeInteger(decision.ExpectedOutputBytes) && decision.ExpectedOutputBytes >= 0 &&
        Number.isSafeInteger(decision.ExpectedTemporaryBytes) && decision.ExpectedTemporaryBytes >= 0 &&
        Number.isSafeInteger(receipt.expectedSeconds) && receipt.expectedSeconds > 0 &&
        Number.isSafeInteger(receipt.checkCount) && receipt.checkCount >= 0 &&
        outputPath === resolve(options.root ?? root) &&
        Number.isSafeInteger(Number(env.ATLAS_LOCAL_MONITOR_PID)) && Number(env.ATLAS_LOCAL_MONITOR_PID) > 0 &&
        decision.ReserveBytes >= Math.max(1024 ** 3, 2 * decision.ExpectedTemporaryBytes) &&
        decision.FreeBytes - decision.ExpectedOutputBytes >= decision.ReserveBytes) {
      return { location: 'explicit-local-request', authorization: receipt.authorization };
    }
    throw new Error('Local preflight receipt is missing, expired, unscoped, or denied. No workload started.');
  }
  throw new Error('Heavy validation requires a GitHub-hosted runner. Open the PR or dispatch ci.yml; no workload started.');
}

export async function verifyRemoteHostedRunner(env = process.env, options = {}) {
  const request = options.request ?? fetch;
  const attempt = env.GITHUB_RUN_ATTEMPT;
  if (!/^\d+$/.test(attempt ?? '')) throw new Error('Hosted run attempt is missing.');
  const identity = { run: env.GITHUB_RUN_ID, attempt, runner: env.RUNNER_NAME,
    sha: env.ATLAS_RUNNER_HEAD_SHA ?? env.GITHUB_SHA, checkoutSha: env.GITHUB_SHA };
  const cachePath = env.RUNNER_TEMP && resolve(env.RUNNER_TEMP, 'atlas-hosted-runner.json');
  if (!options.request && cachePath && existsSync(cachePath)) {
    const saved = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (JSON.stringify(saved.identity) === JSON.stringify(identity) && saved.verifiedAt > Date.now() - 60 * 60_000) return saved.job;
  }
  const endpoint = `https://api.github.com/repos/RAMBULLS/control-atlas/actions/runs/${identity.run}/attempts/${attempt}/jobs?per_page=100`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (env.ATLAS_RUNNER_TOKEN) headers.Authorization = `Bearer ${env.ATLAS_RUNNER_TOKEN}`;
  let response = await request(endpoint, { headers, signal: AbortSignal.timeout(10_000) });
  // Public repository readback remains available to jobs with narrower tokens.
  if (response.status === 403 && headers.Authorization) {
    delete headers.Authorization;
    response = await request(endpoint, { headers, signal: AbortSignal.timeout(10_000) });
  }
  if (!response.ok) throw new Error(`Hosted runner readback failed (${response.status}).`);
  const inventory = await response.json();
  const jobs = inventory.jobs?.filter(job => job.runner_name === identity.runner &&
    job.runner_group_name === 'GitHub Actions' && job.status === 'in_progress' &&
    job.head_sha === identity.sha &&
    job.labels?.some(label => /^(ubuntu|windows|macos)-/.test(label))) ?? [];
  if (jobs.length !== 1) throw new Error('Current hosted runner is absent or ambiguous in GitHub job readback.');
  const job = { id: jobs[0].id, sha: jobs[0].head_sha, runner: jobs[0].runner_name, group: jobs[0].runner_group_name, labels: jobs[0].labels };
  if (!options.request && cachePath) writeFileSync(cachePath, JSON.stringify({ identity, job, verifiedAt: Date.now() }));
  return job;
}

export function verifyHostedCheckout(options = {}) {
  const env = options.env ?? process.env;
  if (!isHostedRunner(env, options)) throw new Error('Fresh-checkout acceptance requires a GitHub-hosted runner.');
  const sha = (options.git ?? ((args) => execFileSync('git', args, { encoding: 'utf8' }).trim()))(['rev-parse', 'HEAD']);
  if (sha !== env.GITHUB_SHA) throw new Error('Hosted checkout does not match the workflow commit.');
  return { sha, run: env.GITHUB_RUN_ID, runner: env.RUNNER_NAME, image: env.ImageOS };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = process.argv.includes('--checkout') ? verifyHostedCheckout() : requireValidationLocation();
    if (result.location === 'github-hosted' || process.argv.includes('--checkout')) result.job = await verifyRemoteHostedRunner();
    console.log(JSON.stringify({ allowed: true, ...result }));
  } catch (error) {
    console.error(JSON.stringify({ allowed: false, reason: error.message }));
    process.exitCode = 2;
  }
}
