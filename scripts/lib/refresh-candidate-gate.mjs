import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';
import {
  CATALOG_REFRESH_PROFILES, INDEPENDENT_REFRESH_CATALOGS, PUBLISHER_RECONCILIATION, REFRESHED_RELATIONSHIP_SETS, catalogPath, publisherReconciled,
} from './catalog-refresh-profiles.mjs';
import { readNativeInventory } from '../build-catalog-source-inventory.mjs';
import {
  adoptCommittedBaseline, advanceBaseline, evaluateBaseline, isCountBandRejection, observeCatalog,
} from './source-baseline.mjs';
import { buildChangeEntry, buildRelationshipChangeEntry, diffCatalogRecords, mergeChangeLog } from './source-change-evidence.mjs';
import { writeJsonAtomically } from './write-json-atomically.mjs';

export const BASELINE_PATH = 'data/source-baselines.json';
export const POLICY_PATH = 'data/source-refresh-policy.json';
export const CHANGE_LOG_PATH = 'data/source-change-log.json';
const immutableFields = ['owner', 'authority_class', 'provenance_class', 'mandate_basis',
  'identity_kind', 'entity_kind', 'profile_id', 'origin', 'graph_eligible'];

export function assertRegistryTrustUnchanged(previous, current) {
  for (const collection of ['sources', 'publications', 'artifacts']) {
    const before = new Map((previous[collection] || []).map((item) => [item.id, item]));
    const after = new Map((current[collection] || []).map((item) => [item.id, item]));
    if (after.size !== (current[collection] || []).length || !isDeepStrictEqual([...before.keys()].sort(), [...after.keys()].sort())) {
      throw new Error(`Refresh changed admitted ${collection} identities`);
    }
    for (const [id, old] of before) {
      const next = after.get(id);
      for (const field of immutableFields) if (!isDeepStrictEqual(old[field], next[field])) {
        throw new Error(`Refresh changed protected ${collection}.${id}.${field}`);
      }
      if (!isDeepStrictEqual(old.metadata?.identity_kind, next.metadata?.identity_kind)) {
        throw new Error(`Refresh changed protected ${collection}.${id}.metadata.identity_kind`);
      }
    }
  }
}

export function createCandidateGate(root, options = {}) {
  const committed = options.readCommitted || ((path) => execFileSync('git', ['show', `HEAD:${path}`], { cwd: root, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  // The date of the commit that carries the reviewed data. It is the same on a
  // shallow CI checkout and a full clone, so refresh and admission always agree.
  const commitTimestamp = options.commitTimestamp || (() => {
    try { return execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
  });
  const readCommittedOptional = (path) => {
    try { const value = committed(path); return value ? Buffer.from(value) : null; } catch { return null; }
  };
  const originalPolicyBytes = committed(POLICY_PATH);
  const originalBaselineBytes = committed(BASELINE_PATH);
  const policy = JSON.parse(originalPolicyBytes);
  const previous = JSON.parse(originalBaselineBytes);
  const ajv = new Ajv({ allErrors: true });
  for (const [name, document] of [['source-baselines', previous], ['source-refresh-policy', policy]]) {
    const schema = JSON.parse(readFileSync(new URL(`../../data/schemas/${name}.schema.json`, import.meta.url)));
    if (!ajv.validate(schema, document)) throw new Error(`${name}: ${ajv.errorsText()}`);
  }
  const originalRegistry = JSON.parse(committed('data/source-registry.json'));
  if (policy.schema_version !== '1.0' || previous.schema_version !== '1.0') throw new Error('Unsupported baseline schema');
  const ids = Object.keys(CATALOG_REFRESH_PROFILES);
  const acceptedCatalogHashes = new Map();
  if (!isDeepStrictEqual(Object.keys(previous.catalogs).sort(), [...ids].sort()) ||
      !isDeepStrictEqual(Object.keys(policy.catalogs).sort(), [...ids].sort())) throw new Error('Incomplete catalog baseline ownership');
  const measure = (id) => observeCatalog(readFileSync(join(root, catalogPath(id))));

  // Reviewed commits can change data without going through refresh. Judge the
  // candidate against what production serves, and record that this happened.
  const adoptions = new Map();
  for (const id of ids) {
    const bytes = readCommittedOptional(catalogPath(id));
    if (!bytes) continue;
    let observed;
    try { observed = observeCatalog(bytes); } catch { continue; }
    const result = adoptCommittedBaseline(previous.catalogs[id], observed, policy.catalogs[id], commitTimestamp());
    if (!result.adopted) continue;
    adoptions.set(id, {
      from: { ...previous.catalogs[id].accepted, accepted_at: previous.catalogs[id].accepted_at },
      to: observed, at: result.entry.accepted_at,
    });
    previous.catalogs[id] = result.entry;
  }

  // Identity evidence is only trusted when the committed file is exactly the
  // accepted snapshot it is being compared against.
  const committedRecords = (id) => {
    const bytes = readCommittedOptional(catalogPath(id));
    if (!bytes) return null;
    try {
      return observeCatalog(bytes).normalized_sha256 === previous.catalogs[id].accepted.normalized_sha256
        ? JSON.parse(bytes).records : null;
    } catch { return null; }
  };
  const diffFor = (id) => {
    const before = committedRecords(id);
    return before ? diffCatalogRecords(before, JSON.parse(readFileSync(join(root, catalogPath(id)))).records) : null;
  };
  const inventoryReconciled = (id, candidate) => {
    if (candidate.independent_inventory) return true;
    const rule = PUBLISHER_RECONCILIATION[id];
    if (!rule) return false;
    try { return publisherReconciled(rule, JSON.parse(readFileSync(join(root, rule.file), 'utf8'))); } catch { return false; }
  };
  const assess = (id, candidate) => {
    const entry = previous.catalogs[id];
    let decision = evaluateBaseline(entry, candidate, policy.catalogs[id]);
    let evidence = null;
    if (!decision.accepted && isCountBandRejection(decision.reason)) {
      const diff = diffFor(id);
      evidence = { diff, inventory_reconciled: Boolean(diff) && inventoryReconciled(id, candidate), removed_pct: diff?.removed_pct ?? 100 };
      decision = evaluateBaseline(entry, candidate, policy.catalogs[id], evidence);
    }
    return { decision, evidence };
  };
  const check = (id, candidate) => {
    const { decision, evidence } = assess(id, candidate);
    if (!decision.accepted) {
      const diff = evidence?.diff;
      const detail = diff ? ` (${diff.added_count} added, ${diff.removed_count} removed, ${diff.changed_count} changed of ${diff.previous_count})` : '';
      throw new Error(`${id}: ${decision.reason}${detail}`);
    }
    const native = (options.readNativeInventory || readNativeInventory)(root, id);
    if (native && candidate.record_count !== native.expected_count - native.excluded_count) {
      throw new Error(`${id}: native source inventory does not match imported records`);
    }
    if (!native && !INDEPENDENT_REFRESH_CATALOGS.has(id) && !candidate.independent_inventory &&
        candidate.record_count !== previous.catalogs[id].anchor.record_count) {
      throw new Error(`${id}: changed reviewed inventory requires publisher completeness evidence`);
    }
    return { decision, evidence };
  };
  const untouched = () => {
    if (!readFileSync(join(root, POLICY_PATH)).equals(originalPolicyBytes) ||
        !readFileSync(join(root, BASELINE_PATH)).equals(originalBaselineBytes)) throw new Error('Refresh mutated its acceptance policy or prior baseline');
  };
  const changeEntries = (acceptedAtFor, candidates) => {
    const entries = [...adoptions].map(([catalogId, { from, to, at }]) => buildChangeEntry({
      catalogId, previous: from, candidate: to, reason: 'adopted_committed_state', acceptedAt: at,
    }));
    for (const [id, candidate] of candidates) {
      const { decision } = assess(id, candidate);
      entries.push(buildChangeEntry({
        catalogId: id, candidate, diff: diffFor(id), reason: decision.reason, acceptedAt: acceptedAtFor(id),
        previous: { ...previous.catalogs[id].accepted, accepted_at: previous.catalogs[id].accepted_at },
      }));
    }
    return entries;
  };
  // Relationship sets: compared with the committed (served) set. A quarantined unit is
  // rolled back to that set, and its output is never recorded as an accepted change.
  const relationshipEntries = (acceptedAtFor, results = []) => REFRESHED_RELATIONSHIP_SETS.flatMap((setPath) => {
    if (results.some((result) => result.status === 'quarantined' && result.paths.some((path) => setPath === path || setPath.startsWith(`${path}/`)))) return [];
    const file = join(root, setPath);
    if (!existsSync(file)) return [];
    const bytes = readCommittedOptional(setPath);
    let previousDocument;
    let currentDocument;
    try { previousDocument = bytes ? JSON.parse(bytes) : null; currentDocument = JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
    const entry = buildRelationshipChangeEntry({ setPath, previousDocument, currentDocument, acceptedAt: acceptedAtFor(setPath) });
    return entry ? [entry] : [];
  });
  const committedChangeLog = () => {
    const bytes = readCommittedOptional(CHANGE_LOG_PATH);
    return bytes ? JSON.parse(bytes) : null;
  };
  return {
    adoptions,
    verifyPublished() {
      if (!readFileSync(join(root, POLICY_PATH)).equals(originalPolicyBytes)) throw new Error('Refresh changed its admission policy');
      assertRegistryTrustUnchanged(originalRegistry, JSON.parse(readFileSync(join(root, 'data/source-registry.json'))));
      const current = JSON.parse(readFileSync(join(root, BASELINE_PATH)));
      const expectedDocument = structuredClone(previous);
      if (!isDeepStrictEqual(Object.keys(current.catalogs).sort(), [...ids].sort())) throw new Error('Refresh changed baseline ownership');
      const changed = new Map();
      for (const id of ids) {
        const candidate = measure(id);
        if (candidate.normalized_sha256 === previous.catalogs[id].accepted.normalized_sha256) {
          if (!isDeepStrictEqual(current.catalogs[id], previous.catalogs[id])) throw new Error(`Unchanged source advanced baseline: ${id}`);
          continue;
        }
        const { evidence } = check(id, candidate);
        const proposed = current.catalogs[id];
        const expected = advanceBaseline(previous.catalogs[id], candidate, policy.catalogs[id], proposed.accepted_at, evidence).baseline;
        if (!isDeepStrictEqual(proposed, expected)) throw new Error(`Unverified baseline advancement: ${id}`);
        expectedDocument.catalogs[id] = expected;
        changed.set(id, candidate);
      }
      if (!isDeepStrictEqual(current, expectedDocument)) throw new Error('Refresh changed baseline provenance');
      const logPath = join(root, CHANGE_LOG_PATH);
      const currentLog = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : null;
      const entries = [
        ...changeEntries((id) => current.catalogs[id].accepted_at, changed),
        ...relationshipEntries((setPath) => currentLog?.relationship_sets?.[setPath]?.at(-1)?.accepted_at ?? null),
      ];
      const expectedLog = entries.length ? mergeChangeLog(committedChangeLog(), entries) : committedChangeLog();
      if (!isDeepStrictEqual(currentLog, expectedLog)) throw new Error('Refresh change log does not match accepted changes');
      return true;
    },
    recordResult(result) {
      if (result.status === 'accepted') {
        for (const id of ids) if (result.paths.some((path) => catalogPath(id) === path || catalogPath(id).startsWith(`${path}/`))) {
          acceptedCatalogHashes.set(id, measure(id).normalized_sha256);
        }
      }
      const registryPath = join(root, 'data/source-registry.json');
      const registry = JSON.parse(readFileSync(registryPath));
      registry.quarantine = (registry.quarantine || []).filter((entry) => entry.refresh_source_id !== result.sourceId);
      if (result.status === 'quarantined') {
        const catalogIds = ids.filter((id) => result.paths.some((path) => catalogPath(id) === path || catalogPath(id).startsWith(`${path}/`)));
        const artifactIds = (registry.catalog_source_bundles || [])
          .filter((bundle) => catalogIds.includes(bundle.catalog_id)).flatMap((bundle) => bundle.primary_artifact_ids || []);
        for (const id of new Set(artifactIds.length ? artifactIds : [result.sourceId])) {
          registry.quarantine.push({
            id, refresh_source_id: result.sourceId, task_id: result.taskId,
            reason: result.error, attempted_at: new Date().toISOString(),
            disposition: 'retained_last_good',
          });
        }
      }
      writeJsonAtomically(registryPath, registry);
    },
    validateCandidate(unit) {
      untouched();
      for (const id of ids) {
        const file = catalogPath(id);
        if (unit.paths.some((path) => file === path || file.startsWith(`${path}/`))) check(id, measure(id));
      }
      assertRegistryTrustUnchanged(originalRegistry, JSON.parse(readFileSync(join(root, 'data/source-registry.json'))));
    },
    finalize(results) {
      untouched();
      assertRegistryTrustUnchanged(originalRegistry, JSON.parse(readFileSync(join(root, 'data/source-registry.json'))));
      const proposed = structuredClone(previous);
      const now = new Date().toISOString();
      const changed = new Map();
      for (const id of ids) {
        const candidate = measure(id);
        // Retained last-good files do not need a new publisher proof and must
        // never acquire a new accepted date because another source succeeded.
        if (candidate.normalized_sha256 === previous.catalogs[id].accepted.normalized_sha256) continue;
        const file = catalogPath(id);
        if (results.some((result) => result.status === 'quarantined' && result.paths.some((path) => file === path || file.startsWith(`${path}/`))) &&
            acceptedCatalogHashes.get(id) !== candidate.normalized_sha256) {
          throw new Error(`Quarantined source output changed after rollback: ${id}`);
        }
        const { evidence } = check(id, candidate);
        proposed.catalogs[id] = advanceBaseline(previous.catalogs[id], candidate, policy.catalogs[id], now, evidence).baseline;
        changed.set(id, candidate);
      }
      writeJsonAtomically(join(root, BASELINE_PATH), proposed);
      const entries = [...changeEntries((id) => proposed.catalogs[id].accepted_at, changed), ...relationshipEntries(() => now, results)];
      if (entries.length) writeJsonAtomically(join(root, CHANGE_LOG_PATH), mergeChangeLog(committedChangeLog(), entries));
      return proposed;
    },
  };
}
