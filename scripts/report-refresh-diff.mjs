#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import '../tools/verify-refresh-admission.mjs';

const outputPath = process.argv[2] || 'refresh-pr-body.md';
const current = JSON.parse(readFileSync('data/source-registry.json', 'utf8'));
const previous = JSON.parse(
  execFileSync('git', ['show', 'HEAD:data/source-registry.json'], { encoding: 'utf8' }),
);

const sources = new Map(current.sources.map((source) => [source.id, source]));
const oldSources = new Map(previous.sources.map((source) => [source.id, source]));
const oldFreshness = new Map(
  (previous.freshness?.sources || []).map((entry) => [entry.source_id, entry]),
);

const rows = current.freshness.sources
  .map((entry) => {
    const before = oldFreshness.get(entry.source_id) || {};
    const source = sources.get(entry.source_id);
    const oldSource = oldSources.get(entry.source_id) || {};
    if (
      before.last_checked === entry.last_checked &&
      before.last_imported === entry.last_imported &&
      before.hash === entry.hash &&
      oldSource.version === source.version
    ) return null;
    const contentChanged = before.hash !== entry.hash || oldSource.version !== source.version;
    return `| \`${entry.source_id}\` | ${oldSource.version || '—'} → ${source.version || '—'} | ${contentChanged ? 'yes' : 'no'} | ${entry.last_checked} |`;
  })
  .filter(Boolean);

const readHead = (path) => {
  try { return JSON.parse(execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })); } catch { return null; }
};
const readWorking = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

// Catalog changes the admission gate accepted in this run, with the evidence it used.
const knownEntries = new Set(Object.values(readHead('data/source-change-log.json')?.catalogs || {})
  .flat().map((entry) => `${entry.catalog_id}:${entry.current.normalized_sha256}`));
const acceptedChanges = Object.values(readWorking('data/source-change-log.json')?.catalogs || {}).flat()
  .filter((entry) => !knownEntries.has(`${entry.catalog_id}:${entry.current.normalized_sha256}`))
  .map((entry) => `| \`${entry.catalog_id}\` | ${entry.decision} | ${entry.previous.record_count} → ${entry.current.record_count} | ${entry.added_count ?? 'n/a'} | ${entry.removed_count ?? 'n/a'} | ${entry.changed_count ?? 'n/a'} |`);

const limitations = (readWorking('data/olir-catalog-manifest.json')?.processed_items || [])
  .filter((item) => item.refresh_status === 'retained_last_good' && item.retention)
  .map((item) => `- OLIR submission ${item.id}: last accepted mapping retained (${item.retention.cause}, since ${item.retention.first_retained_at}). ${item.refresh_error}`);

const stat = execFileSync('git', ['diff', '--stat', '--', 'data', 'maps'], {
  encoding: 'utf8',
}).trim();
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : 'Local workflow-equivalent run';

const body = [
  '## Public-source refresh',
  '',
  'This PR contains validated official-source updates. Failed sources retain their last-good snapshots and generate quarantine alerts. Publication requires independent CI and Security checks on this commit.',
  '',
  `Workflow evidence: ${runUrl}`,
  '',
  '### Source changes',
  '',
  '| Source | Version | Content changed | Checked |',
  '|---|---|---:|---|',
  ...(rows.length ? rows : ['| None | — | no | — |']),
  '',
  ...(acceptedChanges.length ? [
    '### Accepted catalog changes',
    '',
    '| Catalog | Decision | Records | Added | Removed | Changed |',
    '|---|---|---|---:|---:|---:|',
    ...acceptedChanges,
    '',
  ] : []),
  ...(limitations.length ? ['### Recorded limitations', '', ...limitations, ''] : []),
  '### Artifact diff',
  '',
  '```text',
  stat || 'No data or map changes.',
  '```',
  '',
  '### Automated publication gates',
  '',
  '- Source admission compared candidates with the prior committed baseline.',
  '- Protected source authority fields and refresh policy remained unchanged.',
  '- The full repository verification passed before this PR was opened.',
  '- Independent pull-request CI and Security must pass before automatic merge.',
  '',
].join('\n');

writeFileSync(outputPath, body, 'utf8');
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, body, 'utf8');
console.log(`Wrote refresh summary to ${outputPath}`);
