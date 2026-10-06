import { execFileSync } from 'node:child_process';

// Read-only Git checks: no installation, corpus parsing, browser, build or output.
execFileSync('git', ['diff', '--check', 'HEAD'], { stdio: 'inherit', timeout: 10_000 });
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', timeout: 10_000 }).trim();
if (branch === 'main') {
  throw new Error('Use a task branch before pushing changes.');
}
console.log('Source whitespace check passed. Required validation runs on GitHub.');
