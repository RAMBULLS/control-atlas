#!/usr/bin/env node
// After a refresh has run, decide whether anything is worth publishing.
//
// A refresh re-fetches every source, and re-stamps retrieval dates in dozens of
// files even when the publishers changed nothing. Building, testing, opening a
// pull request and deploying to prove that nothing changed is the most expensive
// way to learn it. This tool separates a material change (records, versions,
// relationships, evidence) from bookkeeping (dates, run timings), and tells the
// workflow to stop early when only bookkeeping moved.
//
// A slow heartbeat still publishes, so "last checked" dates on the site stay
// truthful well inside the 45-day staleness window.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dates and timings describe the run, not the source.
export const VOLATILE_KEYS = new Set([
  'generated_at', 'retrieved_at', 'retrieval_timestamp', 'snapshot_date', 'observed_at', 'last_checked',
  'last_imported', 'lastUpdated', 'attempted_at', 'started_at', 'completed_at', 'checked_at', 'duration_ms',
]);
// Whole files that record what this run did and nothing about the sources.
export const TELEMETRY_FILES = new Set(['data/ingestion-pipeline-manifest.json']);
export const HEARTBEAT_DAYS = 21;
const DAY_MS = 86_400_000;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => !VOLATILE_KEYS.has(key)).sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function isMaterialChange(path, head, working) {
  if (TELEMETRY_FILES.has(path)) return false;
  if (head === null || working === null) return head !== working;
  if (Buffer.compare(head, working) === 0) return false;
  if (!path.endsWith('.json')) return true;
  try {
    return stable(JSON.parse(head.toString('utf8'))) !== stable(JSON.parse(working.toString('utf8')));
  } catch {
    return true;
  }
}

/** Oldest "last checked" among sources this refresh keeps current. */
export function oldestCheckedDay(registry) {
  const days = (registry?.freshness?.sources || [])
    .filter((entry) => entry.sync_model === 'auto_synced' && /^\d{4}-\d{2}-\d{2}$/.test(entry.last_checked || ''))
    .map((entry) => Date.parse(`${entry.last_checked}T00:00:00Z`));
  return days.length ? Math.min(...days) : null;
}

export function classifyRefresh({ changes, headRegistry, now = new Date() }) {
  const material = changes.filter(({ path, head, working }) => isMaterialChange(path, head, working)).map(({ path }) => path);
  const oldest = oldestCheckedDay(headRegistry);
  const heartbeatDue = oldest === null || (now.getTime() - oldest) / DAY_MS >= HEARTBEAT_DAYS;
  return {
    publish: material.length > 0 || heartbeatDue,
    material_paths: material,
    bookkeeping_paths: changes.map(({ path }) => path).filter((path) => !material.includes(path)),
    heartbeat_due: heartbeatDue,
    reason: material.length ? 'material_source_change' : heartbeatDue ? 'freshness_heartbeat' : 'no_material_change',
  };
}

const git = (args, options = {}) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...options });
const tryGit = (args) => { try { return git(args); } catch { return null; } };

function collectChanges(root) {
  const tracked = git(['diff', '--name-only', '-z', 'HEAD', '--', 'data', 'maps'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'data', 'maps'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter((path) => !path.startsWith('data/generated/')).map((path) => {
    let working;
    try { working = readFileSync(resolve(root, path)); } catch { working = null; }
    return { path, head: tryGit(['show', `HEAD:${path}`]), working };
  });
}

function main() {
  const root = process.cwd();
  const changes = collectChanges(root);
  const headRegistry = JSON.parse(git(['show', 'HEAD:data/source-registry.json'], { cwd: root, encoding: 'utf8' }));
  const outcome = classifyRefresh({ changes, headRegistry });
  if (!outcome.publish) {
    // Nothing here is worth a build, a pull request or a deploy. Put the tree back.
    const tracked = changes.filter(({ head }) => head !== null).map(({ path }) => path);
    if (tracked.length) git(['checkout', 'HEAD', '--', ...tracked], { cwd: root });
  }
  const summary = `Refresh outcome: ${outcome.reason}; ${outcome.material_paths.length} material path(s), `
    + `${outcome.bookkeeping_paths.length} bookkeeping-only path(s)${outcome.publish ? '' : ' restored'}.`;
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${outcome.publish}\nreason=${outcome.reason}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(`Refresh outcome classification failed: ${error.message}`); process.exitCode = 1; }
}
