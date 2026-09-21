#!/usr/bin/env node
// One persistent issue per scheduled sweep, driven by the sweep's own jobs.
//   red    -> open one issue that names only the jobs that failed, or bring the
//             existing one up to date if a different set is failing now
//   green  -> comment and close the open issue
// Nothing else is written, so a run that stays red does not add noise.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A sweep proves something only if the jobs it exists to run actually ran.
// "skipped" is success for a job this sweep never schedules, and a failure for
// one it does.
export const SWEEPS = Object.freeze({
  nightly: {
    label: 'sweep-red-nightly',
    jobs: [['build', 'Build and contracts'], ['browser', 'Browser tests'], ['accessibility', 'Accessibility tests']],
  },
  refresh: {
    label: 'sweep-red-refresh',
    jobs: [['refresh', 'Source data refresh']],
  },
});

const DESCRIPTIONS = { failure: 'failed', cancelled: 'was cancelled', skipped: 'did not run', undefined: 'reported no result' };

export function assessSweep(kind, results) {
  const sweep = SWEEPS[kind];
  if (!sweep) throw new Error(`Unknown sweep kind: ${kind}`);
  const failing = sweep.jobs
    .filter(([key]) => results?.[key] !== 'success')
    .map(([key, name]) => ({ key, name, result: results?.[key], text: DESCRIPTIONS[results?.[key]] || `ended as ${results?.[key]}` }));
  return { label: sweep.label, red: failing.length > 0, failing };
}

const RUN_LINE = /\n?Run: \S+\n?/;

export function sweepIssueBody(assessment, runUrl) {
  return [
    'A scheduled Control Atlas sweep is red.',
    '',
    ...assessment.failing.map((job) => `- ${job.name} ${job.text}.`),
    '',
    `Run: ${runUrl}`,
    '',
    'This issue closes by itself when the sweep next passes. It is updated, not',
    'duplicated, while the sweep stays red.',
  ].join('\n');
}

const stripRun = (body) => String(body || '').replace(RUN_LINE, '\n').trim();

/** @returns {Array<{type: 'create'|'update'|'comment-close', number?: number, payload: object}>} */
export function planSweepAlert({ kind, results, issues = [], runUrl }) {
  const assessment = assessSweep(kind, results);
  const open = issues.filter((issue) => !issue.pull_request && issue.state === 'open')
    .sort((left, right) => left.number - right.number);
  const title = `Scheduled Control Atlas job is failing: ${assessment.label}`;
  if (!assessment.red) {
    return open.map((issue) => ({
      type: 'comment-close', number: issue.number,
      payload: { comment: `The scheduled jobs passed again. Run: ${runUrl}` },
    }));
  }
  const body = sweepIssueBody(assessment, runUrl);
  const [current, ...duplicates] = open;
  const plans = [];
  if (!current) plans.push({ type: 'create', payload: { title, body, labels: [assessment.label] } });
  else if (stripRun(current.body) !== stripRun(body) || current.title !== title) {
    // A new run URL alone is not news; a different failing set is.
    plans.push({ type: 'update', number: current.number, payload: { title, body } });
  }
  for (const duplicate of duplicates) {
    plans.push({ type: 'comment-close', number: duplicate.number, notPlanned: true,
      payload: { comment: `Duplicate alert. Follow #${current.number}.` } });
  }
  return plans;
}

function gh(args, options = {}) {
  return (options.execFileImpl || execFileSync)('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options.exec });
}

export function applySweepAlert(plans, { repository, execFileImpl, label }) {
  for (const plan of plans) {
    if (plan.type === 'create') {
      gh(['label', 'create', label, '--repo', repository, '--color', 'B60205',
        '--description', 'Scheduled Control Atlas job is failing', '--force'], { execFileImpl });
      gh(['api', '--method', 'POST', `repos/${repository}/issues`, '--input', '-'],
        { execFileImpl, exec: { input: JSON.stringify(plan.payload) } });
    } else if (plan.type === 'update') {
      gh(['api', '--method', 'PATCH', `repos/${repository}/issues/${plan.number}`, '--input', '-'],
        { execFileImpl, exec: { input: JSON.stringify({ ...plan.payload, state: 'open' }) } });
    } else {
      gh(['api', '--method', 'POST', `repos/${repository}/issues/${plan.number}/comments`, '--input', '-'],
        { execFileImpl, exec: { input: JSON.stringify({ body: plan.payload.comment }) } });
      gh(['api', '--method', 'PATCH', `repos/${repository}/issues/${plan.number}`, '--input', '-'],
        { execFileImpl, exec: { input: JSON.stringify({ state: 'closed', state_reason: plan.notPlanned ? 'not_planned' : 'completed' }) } });
    }
  }
}

export function runSweepAlert(env = process.env, options = {}) {
  const kind = env.SWEEP_KIND;
  const repository = env.REPO;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository || '')) throw new Error('Invalid repository');
  const results = {
    build: env.RESULT_BUILD, browser: env.RESULT_BROWSER, accessibility: env.RESULT_ACCESSIBILITY, refresh: env.RESULT_REFRESH,
  };
  const assessment = assessSweep(kind, results);
  const runUrl = env.RUN_URL;
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+$/.test(runUrl || '')) throw new Error('Invalid run URL');
  const issuesEnabled = JSON.parse(gh(['api', `repos/${repository}`, '--jq', '.has_issues'], options).trim() || 'false');
  if (!issuesEnabled) {
    throw new Error(`Repository Issues are disabled, so the persistent sweep alert cannot be ${assessment.red ? 'opened' : 'resolved'}.`);
  }
  const issues = JSON.parse(gh(['api', '--paginate', '--slurp',
    `repos/${repository}/issues?state=open&labels=${assessment.label}&per_page=100`], options)).flat();
  const plans = planSweepAlert({ kind, results, issues, runUrl });
  applySweepAlert(plans, { repository, execFileImpl: options.execFileImpl, label: assessment.label });
  return { assessment, plans };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { assessment, plans } = runSweepAlert();
    const state = assessment.red ? `red (${assessment.failing.map((job) => job.key).join(', ')})` : 'green';
    console.log(`Sweep ${state}; ${plans.length} alert change${plans.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(`Sweep alert failed: ${error.message}`);
    process.exitCode = 1;
  }
}
