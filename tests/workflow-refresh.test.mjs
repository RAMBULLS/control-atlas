import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const refreshScript = readFileSync('scripts/refresh-data.mjs', 'utf8');
const ingestionPipeline = readFileSync('scripts/lib/ingestion-pipeline.mjs', 'utf8');
const lighthouseAb = readFileSync('tools/run-lighthouse-ab.mjs', 'utf8');
const trackedWorkflows = readdirSync('.github/workflows')
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => `.github/workflows/${name}`);

test('FedRAMP diagnostic preserves only the fixed catalog without relaxing generated-data failures', () => {
  const steps = parse(workflow).jobs.generated.steps;
  const reproduce = steps.findIndex((step) => step.id === 'reproduce-data');
  const generate = steps.findIndex((step) => step.id === 'generate-data');
  const capture = steps.findIndex((step) => step.id === 'fedramp-diagnostic');
  const upload = steps.findIndex((step) => step.name === 'Upload FedRAMP catalog diagnostic');
  const guard = steps.findIndex((step) => step.name === 'Reject generator writes outside derived output');
  const clean = steps.findIndex((step) => step.name === 'Verify clean canonical FedRAMP input');
  assert.ok(clean >= 0 && clean < reproduce && clean < generate);
  assert.equal(steps[clean].run, 'git diff --exit-code HEAD -- data/fedramp-2026-catalog.json');
  assert.ok(reproduce < capture && generate < capture && capture < upload && upload < guard);
  assert.equal(steps[reproduce].run, 'npm run verify:generated-reproducibility');
  assert.equal(steps[generate].run, 'npm run generate:data');
  for (const index of [reproduce, generate, capture, upload, guard]) {
    assert.notEqual(steps[index]['continue-on-error'], true);
    assert.doesNotMatch(steps[index].run || '', /\|\| true|set \+e|git (?:restore|checkout|reset)/);
  }
  assert.match(steps[capture].if, /!cancelled\(\)/);
  for (const id of ['reproduce-data', 'generate-data']) {
    assert.ok(steps[capture].if.includes(`steps.${id}.outcome == 'failure'`));
    assert.ok(steps[capture].if.includes(`steps.${id}.outcome == 'success'`));
  }
  assert.match(steps[capture].run, /catalog=data\/fedramp-2026-catalog\.json/);
  assert.match(steps[capture].run, /output="\$RUNNER_TEMP\/fedramp-catalog-diagnostic"/);
  assert.match(steps[capture].run, /git diff --no-ext-diff --no-textconv --binary HEAD -- "\$catalog"/);
  for (const field of ['head_sha', 'checkout_sha', 'run_id', 'run_attempt', 'old_sha256', 'new_sha256', 'patch_sha256', 'raw_sha256', 'generator_sha256']) {
    assert.ok(steps[capture].run.includes(`--arg ${field} `), field);
  }
  assert.deepEqual(steps[upload].with.path.trim().split('\n'), [
    '${{ runner.temp }}/fedramp-catalog-diagnostic/fedramp-2026-catalog.json',
    '${{ runner.temp }}/fedramp-catalog-diagnostic/catalog.patch',
    '${{ runner.temp }}/fedramp-catalog-diagnostic/receipt.json',
  ]);
  assert.equal(steps[upload].with['if-no-files-found'], 'error');
  assert.equal(steps[upload].with['retention-days'], 2);
  assert.match(steps[upload].if, /!cancelled\(\).*steps\.fedramp-diagnostic\.outputs\.changed == 'true'/);
  assert.equal(steps[guard].if, undefined);
  assert.ok(steps[guard].run.includes("git status --short --untracked-files=all -- . ':(exclude)data/generated/**'"));
  assert.match(steps[guard].run, /exit 1/);
  const accepted = steps.find((step) => step.with?.name === 'generated-data');
  assert.equal(accepted.if, undefined);
  assert.equal(accepted.with.path, 'data/generated');
});

test('source refresh runs weekly and remains manually dispatchable', () => {
  assert.match(workflow, /cron: '17 7 \* \* 3'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.schedule \|\| inputs\.task \|\| github\.ref/);
});

test('nightly browser shards keep parallelism visible and allow exactly one retry', () => {
  assert.match(workflow, /PLAYWRIGHT_FULLY_PARALLEL: '1'/);
  assert.match(workflow, /PLAYWRIGHT_WORKERS: '2'/);
  assert.match(
    workflow,
    /npm run test:e2e:run -- --shard=\$\{\{ matrix\.shard \}\}\/2 --retries=1 --reporter=blob,github/,
  );
});

test('source refresh opens one App PR after the full gate and requires independent admission', () => {
  assert.match(workflow, /permission-contents: write/);
  assert.match(workflow, /permission-pull-requests: write/);
  assert.match(workflow, /npm run refresh:data/);
  assert.match(workflow, /name: Restore strict conditional source cache/);
  assert.match(workflow, /path: \.local\/http-cache-v1/);
  assert.match(workflow, /key: source-http-v1-\$\{\{ runner\.os \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /npm run resources:health/);
  assert.doesNotMatch(workflow, /npm run audit:deps/);
  assert.match(workflow, /npx playwright install --with-deps chromium/);
  assert.match(workflow, /npm run precommit:incremental/);
  assert.match(workflow, /npm run sbom:generate/);
  assert.match(workflow, /name: Restore tracked SBOM before source admission\s+run: git restore --worktree -- artifacts\/sbom\.cdx\.json/);
  assert.match(workflow, /peter-evans\/create-pull-request@[0-9a-f]{40}/);
  assert.match(workflow, /branch: automation\/source-refresh/);
  assert.match(workflow, /draft: false/);
  assert.match(workflow, /token: \$\{\{ steps.refresh-app.outputs.token \}\}/);
  assert.match(workflow, /node tools\/verify-refresh-admission.mjs/);
  assert.match(workflow, /node tools\/report-refresh-alerts.mjs/);
  assert.ok(workflow.indexOf('name: Create repository-scoped publisher token') > workflow.indexOf('name: Verify refreshed repository'));
  assert.ok(workflow.indexOf('Restore tracked SBOM before source admission') > workflow.indexOf('name: source-refresh-sbom-cdx-json'));
  assert.ok(workflow.indexOf('node scripts/report-refresh-diff.mjs') > workflow.indexOf('Restore tracked SBOM before source admission'));
  assert.match(workflow, /data\/\*\*/);
  assert.match(workflow, /maps\/\*\*/);
  assert.doesNotMatch(workflow, /git push|\[skip ci\]|auto-merge/i);
});

test('refresh stops before the expensive steps when nothing changed materially', () => {
  const steps = parse(workflow).jobs.refresh.steps;
  const text = (step) => JSON.stringify(step);
  const decide = steps.findIndex((step) => step.id === 'outcome');
  assert.ok(decide > steps.findIndex((step) => /Refresh validated build-time data/.test(step.name || '')));
  assert.equal(steps[decide].run, 'node tools/classify-refresh-outcome.mjs');
  for (const marker of ['playwright install', 'precommit:incremental', 'sbom:generate', 'create-pull-request', 'report-refresh-diff', 'create-github-app-token']) {
    const index = steps.findIndex((step) => text(step).includes(marker));
    assert.ok(index > decide, `${marker} runs after the decision`);
    assert.equal(steps[index].if, "${{ steps.outcome.outputs.publish == 'true' }}", marker);
  }
  // The refresh itself and its alerting must never be skipped by the shortcut.
  for (const marker of ['npm run refresh:data', 'report-refresh-alerts']) {
    const step = steps.find((entry) => text(entry).includes(marker));
    assert.ok(!String(step.if || '').includes('outcome'), marker);
  }
});

test('scheduled sweep alerts come from one tested tool, not inline shell', () => {
  const job = parse(workflow).jobs['sweep-alert'];
  assert.ok(job.steps.some((step) => step.run === 'node tools/report-sweep-alert.mjs'));
  assert.ok(!job.steps.some((step) => /gh issue (create|close)/.test(step.run || '')));
  const env = job.steps.find((step) => step.run === 'node tools/report-sweep-alert.mjs').env;
  assert.match(env.SWEEP_KIND, /inputs\.task == 'refresh'.*'refresh' \|\| 'nightly'/);
  for (const key of ['RESULT_BUILD', 'RESULT_BROWSER', 'RESULT_ACCESSIBILITY', 'RESULT_REFRESH']) assert.ok(env[key], key);
});

test('obsolete Tenable refresh cannot run outside the current registry pipeline', () => {
  assert.equal(existsSync('.github/workflows/weekly-tenable.yml'), false);
});

test('source refresh ingests the current structured FedRAMP rules before rebuilding', () => {
  assert.match(ingestionPipeline, /fetch-fedramp-2026-rules\.mjs/);
  assert.match(ingestionPipeline, /reconcile-artifact-counts\.mjs/);
  assert.match(ingestionPipeline, /verify-discovery\.mjs/);
  assert.match(ingestionPipeline, /verify-manifests\.mjs/);
  assert.match(ingestionPipeline, /presentation/);
  assert.match(refreshScript, /INGESTION_TASKS/);
});

test('Lighthouse A/B gates a candidate against a baseline on the same mobile runner', () => {
  assert.match(workflow, /default: v1\.0\.0/);
  assert.match(workflow, /AFTER_REF: \$\{\{ inputs\.after_ref \|\| github\.sha \}\}/);
  assert.match(workflow, /MAX_MEDIAN_DROP: '3'/);
  assert.match(workflow, /ROUTE: '\/#\/explore\?node=/);
  assert.match(lighthouseAb, /fetchRef\(beforeRef\)/);
  assert.match(lighthouseAb, /fetchRef\(afterRef\)/);
  assert.match(lighthouseAb, /--only-categories=performance/);
  assert.match(lighthouseAb, /--max-wait-for-load=90000/);
  assert.match(lighthouseAb, /--disable-dev-shm-usage/);
  assert.match(lighthouseAb, /function median/);
  assert.match(lighthouseAb, /afterMedian < allowedMinimum/);
  assert.match(workflow, /name: lighthouse-ab/);
  assert.doesNotMatch(lighthouseAb, /npm install/);
});

test('workflow artifacts use the Node-20-deprecation-safe upload action', () => {
  for (const filename of trackedWorkflows) {
    const content = readFileSync(filename, 'utf8');
    assert.doesNotMatch(content, /actions\/upload-artifact@v\d+\b/, filename);
  }
});

test('workflow JavaScript actions no longer use the Node 20 checkout or setup runtimes', () => {
  for (const filename of trackedWorkflows) {
    const content = readFileSync(filename, 'utf8');
    assert.doesNotMatch(content, /actions\/checkout@v\d+\b/, filename);
    assert.doesNotMatch(content, /actions\/setup-node@v\d+\b/, filename);
  }
});
