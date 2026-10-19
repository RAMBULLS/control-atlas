import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyHostedCheckout, verifyRemoteHostedRunner } from './validation-location.mjs';

export async function verifySourceBranch(branch, options = {}) {
  if (branch !== 'main') return;
  // Main is read only in CI; local pushes still require a task branch.
  verifyHostedCheckout(options);
  await verifyRemoteHostedRunner(options.env ?? process.env, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Read-only Git checks: no installation, corpus parsing, browser or build.
    execFileSync('git', ['diff', '--check', 'HEAD'], { stdio: 'inherit', timeout: 10_000 });
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', timeout: 10_000 }).trim();
    await verifySourceBranch(branch);
    console.log('Source whitespace check passed. Required validation runs on GitHub.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
