import { reportDigest } from './assurance-execution.mjs';
import { contractHash, MAX_EVIDENCE_AGE_MS } from './assurance-contract.mjs';

function reportTests(suites) {
  return (suites ?? []).flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => (spec.tests ?? []).map(test => ({ ...test, title: spec.title, file: spec.file }))),
    ...reportTests(suite.suites),
  ]);
}

// Consume Playwright's actual JSON result, never a manually authored green map.
// Absence, skip, expected failure, flaky retry and incomplete report stay red.
export function collectBrowserEvidence(contract, report, identity) {
  const tests = reportTests(report.suites);
  const identities = tests.map(t => `${t.file}:${t.title}:${t.projectId ?? t.projectName}`);
  if (!tests.length || new Set(identities).size !== tests.length) throw new Error('Empty or duplicate executed test inventory');
  const counts = ['expected', 'unexpected', 'skipped', 'flaky'];
  if (counts.some(key => !Number.isSafeInteger(report.stats?.[key]) || report.stats[key] < 0) || counts.reduce((sum, key) => sum + report.stats[key], 0) !== tests.length) throw new Error('Runner result count mismatch');
  for (const test of tests) for (const annotation of test.annotations ?? []) {
    if (annotation.type !== 'assurance') continue;
    const promise = contract.promises.find(p => annotation.description?.startsWith(`${p.id}:`));
    const scope = promise && annotation.description.slice(promise.id.length + 1);
    const check = promise?.checks.find(c => c.phase === identity.phase);
    const file = test.file?.startsWith('tests/e2e/') ? test.file : `tests/e2e/${test.file}`;
    if (!check?.scope_ids.includes(scope) || !check.references.includes(file) || (test.projectId ?? test.projectName) !== identity.browser) throw new Error('Unexpected assertion source, scope or browser');
  }
  const phase = identity.phase;
  if (!['candidate', 'live'].includes(phase)) throw new Error('Browser evidence requires candidate or live phase.');
  if (!report.stats || !Number.isFinite(Date.parse(report.stats.startTime)) || !Number.isFinite(report.stats.duration)) throw new Error('Missing actual runner timing.');
  const observed = Date.parse(report.stats.startTime) + report.stats.duration;
  const results = contract.promises.map(promise => {
    const check = promise.checks.find(c => c.phase === phase);
    const assertions = [];
    for (const scope of check.scope_ids) {
      const matched = tests.filter(test => test.annotations?.some(a => a.type === 'assurance' && a.description === `${promise.id}:${scope}`));
      for (const test of matched) assertions.push({
        id: `${test.file}:${test.title}:${test.projectId ?? test.projectName}`,
        scope_id: scope,
        status: test.expectedStatus === 'passed' && test.results?.length === 1 && test.results[0].status === 'passed' && test.status === 'expected' ? 'pass' : 'fail',
      });
    }
    const scopes = [...new Set(assertions.map(a => a.scope_id))];
    const missing = check.scope_ids.filter(scope => !scopes.includes(scope));
    const failed = assertions.some(a => a.status !== 'pass') || (report.errors?.length ?? 0) > 0;
    const status = failed ? 'fail' : missing.length ? 'not_run' : 'pass';
    return {
      contract_version: contract.version, contract_hash: contractHash(contract), code_sha: identity.sha,
      artifact_digest: identity.artifactDigest, phase, origin: identity.origin,
      check_id: check.id, run_id: identity.runId, result_locator: identity.resultLocator,
      report_sha256: reportDigest(report), browser: identity.browser, observed_at: new Date(observed).toISOString(),
      valid_until: new Date(observed + MAX_EVIDENCE_AGE_MS).toISOString(),
      scope_ids: scopes, assertions, status,
      reason: failed ? 'Runner failure, assertion failure or retry observed' : missing.length ? `No executed assertion for: ${missing.join(', ')}` : '',
      limitations: ['Automated browser emulation; physical devices and real screen readers unverified.', 'Checks prove only annotated assertions, not complete source meaning or continuous live health.'],
      owner_role: promise.owner_role, next_check: 'Next deployment or existing governed sweep, before this observation expires',
    };
  });
  return { schema_version: '1.0', results };
}
