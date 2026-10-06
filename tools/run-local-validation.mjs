import { spawn, spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireValidationLocation } from './validation-location.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function measureOutput(path, limit = 10_000) {
  let bytes = 0;
  let entries = 0;
  const visit = (current) => {
    const stat = lstatSync(current);
    if (++entries > limit || stat.isSymbolicLink()) throw new Error('Output inventory limit or link encountered.');
    if (stat.isDirectory()) for (const name of readdirSync(current)) visit(join(current, name));
    else bytes += stat.size;
  };
  visit(path);
  return bytes;
}

export function assertLocalExpansion(task) {
  if (!['build:data', 'build:site', 'build:site:incremental', 'generate:data'].includes(task)) {
    throw new Error('Local exception does not support this task expansion. Use GitHub-hosted validation.');
  }
}

export function assertCapacity(decision, free) {
  if (!Number.isSafeInteger(free) || free - decision.ExpectedOutputBytes < decision.ReserveBytes) {
    throw new Error('Actual pre-launch capacity violates the declared reserve.');
  }
}

export function assertGrowth(decision, growth, initialFree, free) {
  if (growth > decision.ExpectedOutputBytes || free < decision.ReserveBytes ||
      initialFree - free > decision.ExpectedOutputBytes + decision.ExpectedTemporaryBytes) {
    throw new Error('Declared output, temporary demand or capacity limit exceeded.');
  }
}

export async function runLocalValidation(task, receiptPath) {
if (!task || !receiptPath || !process.env.npm_execpath) throw new Error('Use npm run local:heavy -- <task> <approved receipt>.');
assertLocalExpansion(task);
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const temporary = resolve(receipt.temporaryPath ?? '');
const temporaryScope = relative(root, temporary);
if (!temporaryScope || temporaryScope.startsWith('..') || isAbsolute(temporaryScope)) throw new Error('Temporary output must stay inside the monitored checkout.');
const env = { ...process.env, ATLAS_LOCAL_PREFLIGHT: resolve(receiptPath),
  ATLAS_LOCAL_MONITOR_PID: String(process.pid), npm_lifecycle_event: task,
  TEMP: temporary, TMP: temporary, TMPDIR: temporary, npm_config_cache: temporary };
requireValidationLocation({ env });
const output = resolve(receipt.outputPath);
// Refuse links in every ancestor, including a junction above the output.
for (const path of [output, temporary]) {
  for (let ancestor = path; ancestor; ancestor = dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Output path contains a link.');
    if (ancestor === dirname(ancestor)) break;
  }
}
const scope = relative(root, output);
if (scope !== '') throw new Error('Local exception must monitor the complete checkout.');
const baseline = measureOutput(output);
const decision = receipt.decision;
const initialVolume = statfsSync(output);
const initialFree = initialVolume.bavail * initialVolume.bsize;
assertCapacity(decision, initialFree);
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', task], {
  cwd: root, env, detached: process.platform !== 'win32', stdio: 'inherit',
});
let failure;
function stop(reason) {
  if (failure) return;
  failure = reason;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 });
  else process.kill(-child.pid, 'SIGKILL');
}
function inspect() {
  try {
    const growth = Math.max(0, measureOutput(output) - baseline);
    const volume = statfsSync(output);
    const free = volume.bavail * volume.bsize;
    assertGrowth(decision, growth, initialFree, free);
  } catch (error) { stop(error.message); }
}
const interval = setInterval(inspect, 1000);
const timeout = setTimeout(() => stop('Declared runtime exceeded.'), receipt.expectedSeconds * 1000);
const cancel = () => stop('Validation cancelled.');
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
try {
  const status = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', resolveExit);
  });
  inspect();
  if (failure) throw new Error(failure);
  process.exitCode = status ?? 1;
} finally {
  clearInterval(interval); clearTimeout(timeout);
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalValidation(...process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
