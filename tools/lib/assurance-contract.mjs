import { createHash } from 'node:crypto';

export const PROMISE_IDS = Object.freeze(['search-library', 'atlas', 'record-source', 'compare', 'templates', 'guides', 'resources', 'provenance-freshness', 'open-local']);
export const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
export const PHASES = Object.freeze(['invariant', 'candidate', 'live']);
export const contractHash = (contract) => createHash('sha256').update(JSON.stringify(contract)).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const unique = values => Array.isArray(values) && values.length > 0 && values.every(nonempty) && new Set(values).size === values.length;
const same = (a, b) => unique(a) && unique(b) && a.length === b.length && a.every(value => b.includes(value));

// Structural assurance only. Referencing a test never establishes that it ran,
// nor that every asserted public meaning has received independent source review.
export function validateContract(contract, { exists, templateScopes, guideScopes } = {}) {
  const errors = [];
  if (contract?.schema_version !== '1.0' || !/^\d+\.\d+\.\d+$/.test(contract?.version ?? '')) errors.push('unsupported contract version');
  if (!same(contract?.promises?.map(p => p.id), PROMISE_IDS)) errors.push('duplicate, missing or unknown promise ID');
  const checks = new Set();
  for (const promise of contract?.promises ?? []) {
    const fail = message => errors.push(`${promise.id}: ${message}`);
    for (const field of ['claim', 'registry', 'owner_role', 'degraded_behavior']) if (!nonempty(promise[field])) fail(`missing ${field}`);
    if (!unique(promise.scope_ids)) fail('invalid or duplicate scope IDs');
    if (!unique(promise.semantic_review_triggers)) fail('missing semantic review triggers');
    if (exists && !exists(promise.registry)) fail(`stale registry ${promise.registry}`);
    if (!same(promise.checks?.map(c => c.phase), PHASES)) fail('missing or duplicate phase');
    for (const check of promise.checks ?? []) {
      if (!nonempty(check.id) || checks.has(check.id)) fail('duplicate or empty check ID');
      checks.add(check.id);
      if (!same(check.scope_ids, promise.scope_ids)) fail(`${check.id}: orphan or uncovered scope`);
      if (!unique(check.references)) fail(`${check.id}: missing test references`);
      for (const reference of check.references ?? []) if (exists && !exists(reference)) fail(`stale check ${reference}`);
    }
    const required = ['contract_hash', 'code_sha', 'artifact_digest', 'check_id', 'run_id', 'result_locator', 'report_sha256', 'browser', 'observed_at', 'valid_until', 'scope_ids', 'status', 'limitations', 'owner_role', 'next_check'];
    if (!same(promise.required_evidence, required)) fail('missing or unknown evidence field');
    if (promise.id === 'templates' && templateScopes && !same(promise.scope_ids, templateScopes)) fail('template registry scope drift');
    if (promise.id === 'guides' && guideScopes && !same(promise.scope_ids, guideScopes)) fail('guide registry scope drift');
  }
  if (templateScopes && templateScopes.length < 10) errors.push('template inventory below ten');
  if (guideScopes && guideScopes.length !== 11) errors.push('guide inventory must contain eleven IDs');
  return errors;
}

export function assessEvidence(contract, evidence, { phase, sha, artifactDigest, now = Date.now(), origin, execution } = {}) {
  const errors = [];
  if (!execution || execution.code_sha !== sha || execution.artifact_digest !== artifactDigest || execution.phase !== phase || !/^[a-f0-9]{64}$/.test(execution.report_sha256 ?? '')) errors.push('missing independently verified execution');
  if (!PHASES.includes(phase)) errors.push('unknown phase');
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) errors.push('invalid expected SHA');
  if (!/^[a-f0-9]{64}$/.test(artifactDigest ?? '')) errors.push('invalid expected artifact digest');
  if (phase === 'live' && origin !== 'https://atlas.rambulls.dev') errors.push('live evidence requires actual production origin');
  const required = contract.promises.flatMap(p => p.checks.filter(c => c.phase === phase).map(c => ({ promise: p, check: c })));
  const rows = evidence?.results ?? [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.check_id)) errors.push(`duplicate result ${row.check_id}`);
    seen.add(row.check_id);
    if (!required.some(({ check }) => check.id === row.check_id)) errors.push(`unknown result ${row.check_id}`);
  }
  for (const { promise, check } of required) {
    const row = rows.find(r => r.check_id === check.id);
    const fail = message => errors.push(`${check.id}: ${message}`);
    if (!row) { fail('not_run: missing result'); continue; }
    if (row.status !== 'pass') fail(`${row.status ?? 'unknown'}: ${row.reason || 'no reason recorded'}`);
    if (row.contract_hash !== contractHash(contract) || row.contract_version !== contract.version) fail('wrong contract');
    if (row.code_sha !== sha || row.artifact_digest !== artifactDigest) fail('wrong commit or artifact');
    if (row.phase !== phase) fail('wrong phase');
    if (phase === 'live' && row.origin !== origin) fail('wrong live origin');
    if (!same(row.scope_ids, check.scope_ids)) fail('missing or unknown exercised scope');
    if (!/^\d+$/.test(row.run_id ?? '') || !/^https:\/\/github\.com\/RAMBULLS\/control-atlas\/actions\/runs\/\d+\/artifacts\/\d+$/.test(row.result_locator ?? '') ||
        row.run_id !== execution?.run_id || row.result_locator !== execution?.result_locator || row.report_sha256 !== execution?.report_sha256 || row.browser !== execution?.browser) fail('missing or mismatched actual run/result identity');
    if (row.owner_role !== promise.owner_role) fail('unaccountable owner');
    if (!Array.isArray(row.limitations) || !nonempty(row.next_check)) fail('missing limitations or next check');
    const observed = Date.parse(row.observed_at), until = Date.parse(row.valid_until);
    if (!Number.isFinite(observed) || observed > now || !Number.isFinite(until) || until <= now || until <= observed || now - observed > MAX_EVIDENCE_AGE_MS || until - observed > MAX_EVIDENCE_AGE_MS) fail('stale or invalid observation');
    if (!Array.isArray(row.assertions) || !row.assertions.length || row.assertions.some(a => a.status !== 'pass' || !nonempty(a.id) || !check.scope_ids.includes(a.scope_id))) fail('missing or failed assertions');
    const assertionIds = row.assertions?.map(a => a.id) ?? [];
    if (new Set(assertionIds).size !== assertionIds.length) fail('duplicate assertion identity');
    const exercised = execution?.assertions?.filter(a => a.check_id === check.id) ?? [];
    if (row.assertions?.length !== exercised.length || row.assertions?.some(a => !exercised.some(actual => actual.id === a.id && actual.scope_id === a.scope_id && actual.status === a.status))) fail('unexpected or unverified assertion identity');
    for (const scope of check.scope_ids) if (!row.assertions?.some(a => a.scope_id === scope && a.status === 'pass')) fail(`unexercised scope ${scope}`);
  }
  return { status: errors.length ? 'unknown_or_failed' : 'pass', phase, errors };
}
