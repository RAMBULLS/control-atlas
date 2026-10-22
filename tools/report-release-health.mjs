#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySweepAlert, assessSweep, planSweepAlert } from './report-sweep-alert.mjs';

const repository = 'RAMBULLS/control-atlas';
const workflows = Object.freeze({
  '.github/workflows/ci.yml': { kind: 'release-ci', event: 'push' },
  '.github/workflows/security.yml': { kind: 'release-security', event: 'push' },
  '.github/workflows/deploy.yml': { kind: 'release-deploy', event: 'workflow_run' },
});

export function selectReleaseObservation(run, mainSha, latest) {
  const source = workflows[run.path];
  if (!source || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      run.head_branch !== 'main' || run.event !== source.event || run.status !== 'completed') {
    return { ignored: 'outside-production-release' };
  }
  if (run.conclusion === 'skipped') return { ignored: 'upstream-release-was-not-eligible' };
  if (!/^[a-f0-9]{40}$/i.test(mainSha ?? '') || run.head_sha !== mainSha ||
      latest?.id !== run.id || latest.run_attempt !== run.run_attempt) {
    return { ignored: 'superseded-release-observation' };
  }
  if (!['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(run.conclusion)) {
    throw new Error('Release workflow has no recognized terminal result.');
  }
  const runUrl = `https://github.com/${repository}/actions/runs/${run.id}`;
  return { kind: source.kind, results: { release: run.conclusion }, runUrl };
}

export function reportReleaseHealth(env = process.env, options = {}) {
  if (env.REPO !== repository || !/^\d+$/.test(env.OBSERVED_RUN_ID ?? '')) throw new Error('Invalid release observation target.');
  const execute = options.execFileImpl ?? execFileSync;
  const api = (path) => JSON.parse(execute('gh', ['api', path], { encoding: 'utf8' }));
  const run = api(`repos/${repository}/actions/runs/${env.OBSERVED_RUN_ID}`);
  const source = workflows[run.path];
  if (!source || run.event !== source.event) return { ignored: 'outside-production-release' };
  const main = api(`repos/${repository}/git/ref/heads/main`);
  const recent = api(`repos/${repository}/actions/workflows/${run.workflow_id}/runs?branch=main&event=${source.event}&per_page=1`);
  const observation = selectReleaseObservation(run, main.object?.sha, recent.workflow_runs?.[0]);
  if (observation.ignored) return observation;
  if (!api(`repos/${repository}`).has_issues) throw new Error('Repository Issues are disabled; release failures cannot be tracked.');
  const assessment = assessSweep(observation.kind, observation.results);
  const pages = JSON.parse(execute('gh', ['api', '--paginate', '--slurp',
    `repos/${repository}/issues?state=open&labels=${assessment.label}&per_page=100`], { encoding: 'utf8' }));
  const plans = planSweepAlert({ ...observation, issues: pages.flat() });
  applySweepAlert(plans, { repository, label: assessment.label, execFileImpl: execute });
  return { kind: observation.kind, red: assessment.red, changes: plans.length, runUrl: observation.runUrl };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(JSON.stringify(reportReleaseHealth()));
  } catch (error) {
    console.error(`Release health reporting failed: ${error.message}`);
    process.exitCode = 1;
  }
}
