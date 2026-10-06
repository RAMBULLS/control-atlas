#!/usr/bin/env node
// A scheduled check that re-tests unchanged code proves nothing new. It is due
// only when the commit under test has not already been through that same job.
// Jobs that watch things outside this repository (publishers, advisories) do not
// use this gate.
//
// "Already been through" means the job actually ran to success or failure on
// this SHA in any earlier run, scheduled or manual. A skipped or cancelled job
// tested nothing. A failure counts as tested: running the same code again
// cannot turn it green, and a fix arrives as a new commit, which is due.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function decideSweepDue({ runs, currentRunId, jobName }) {
  const covered = runs.find((run) => String(run.id) !== String(currentRunId) &&
    (run.jobs || []).some((job) => job.name === jobName && ['success', 'failure'].includes(job.conclusion)));
  return covered
    ? { due: false, reason: `already_tested_in_run_${covered.id}` }
    : { due: true, reason: 'commit_not_yet_tested' };
}

function gh(args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}

function main() {
  const { REPO, SHA, RUN_ID, JOB_NAME, FORCE } = process.env;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(REPO || '') || !/^[a-f0-9]{40}$/.test(SHA || '') || !JOB_NAME) {
    throw new Error('REPO, SHA and JOB_NAME are required');
  }
  let outcome = { due: true, reason: 'forced' };
  if (FORCE !== 'true') {
    const listed = gh([`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&per_page=50`]).workflow_runs
      .filter((run) => run.status === 'completed' || String(run.id) === String(RUN_ID));
    const runs = listed.filter((run) => String(run.id) !== String(RUN_ID)).map((run) => ({
      id: run.id, jobs: gh([`repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`]).jobs,
    }));
    outcome = decideSweepDue({ runs, currentRunId: RUN_ID, jobName: JOB_NAME });
  }
  const line = `due=${outcome.due}\nreason=${outcome.reason}\n`;
  console.log(`Sweep ${JOB_NAME}: ${outcome.due ? 'due' : 'skipped'} (${outcome.reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Sweep ${JOB_NAME}: ${outcome.due ? 'due' : 'skipped'} (${outcome.reason})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    // If the question cannot be answered, run the check. Skipping on doubt would hide a red sweep.
    console.error(`Sweep gate could not decide (${error.message}); running the check.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'due=true\nreason=gate_error\n');
  }
}
