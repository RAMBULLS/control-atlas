// Pulse, Phase 1: every shown event is backed by accepted evidence, nothing
// quarantined, rejected, unaccepted or merely re-stamped can surface, and the
// same inputs always give the same artifact with the same event ids.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACCEPTED_DECISIONS, PULSE_EVENT_TYPES, PULSE_HOME_LIMIT, PULSE_TYPE_LABELS, buildPulse, pulseHomeSlice, validateReleaseEntry,
} from '../scripts/lib/pulse.mjs';
import { CONTENT_DIFF_BASIS, buildChangeEntry, buildRelationshipChangeEntry, diffCatalogRecords, mergeChangeLog, observeRelationshipSet } from '../scripts/lib/source-change-evidence.mjs';
import { RELATIONSHIP_SET_ENDPOINTS } from '../scripts/lib/catalog-refresh-profiles.mjs';

const sha = (n) => `sha256:${String(n).padStart(64, '0')}`;
const publications = new Map([
  ['disa-stig', { name: 'DISA STIG', publisher: 'DISA' }],
  ['fedramp-2026', { name: 'FedRAMP Rules', publisher: 'FedRAMP' }],
  ['nist-800-53', { name: 'NIST SP 800-53', publisher: 'NIST' }],
  ['csf-2', { name: 'NIST CSF 2.0', publisher: 'NIST' }],
]);
const dataset = { dataset_id: 'abcdefabcdef', source_data_generated_at: '2026-09-23T00:00:00.000Z' };
const observation = (count, hash, version = null) => ({ record_count: count, normalized_sha256: sha(hash), publisher_version: version });
const baselineFor = (...hashes) => ({
  accepted: { normalized_sha256: sha(hashes.at(-1)) },
  history: hashes.slice(0, -1).map((hash) => ({ normalized_sha256: sha(hash) })),
});
const rec = (id, extra = {}) => ({ id, title: id, source: { key: 'k', snapshot_date: '2026-09-01', version: '1', locator: id }, ...extra });

function entry({ id = 'disa-stig', from = 1, to = 2, fromCount = 100, toCount = 131, diff, decision = 'within_band', at = '2026-09-21T15:16:41.811Z', versions = [null, null] }) {
  return buildChangeEntry({
    catalogId: id, previous: { ...observation(fromCount, from, versions[0]), accepted_at: '2026-09-10T00:00:00Z' },
    candidate: observation(toCount, to, versions[1]), diff, reason: decision, acceptedAt: at,
  });
}
const build = (overrides = {}) => buildPulse({
  changeLog: null, baselines: { catalogs: {} }, releaseLog: null, registry: { quarantine: [] }, publications,
  relationshipSets: RELATIONSHIP_SET_ENDPOINTS, servedSets: new Map(), dataset, inputs: {}, ...overrides,
});
const added31 = diffCatalogRecords(Array.from({ length: 100 }, (_, i) => rec(`V-${i}`)), Array.from({ length: 131 }, (_, i) => rec(`V-${i}`)));

test('the governed diff ignores provenance stamps: a re-fetch that only moves dates is not a content change', () => {
  const before = [rec('A'), rec('B')];
  const after = [rec('A', { source: { key: 'k', snapshot_date: '2026-09-23', version: '2', locator: 'A', checksum: 'x' } }), rec('B', { title: 'Revised' })];
  const diff = diffCatalogRecords(before, after);
  assert.deepEqual([diff.changed_count, diff.stamp_only_count, diff.unchanged_count], [1, 1, 0]);
  assert.deepEqual(diff.changed_sample, ['B']);
  const logged = entry({ diff, fromCount: 2, toCount: 2 });
  assert.equal(logged.diff_basis, CONTENT_DIFF_BASIS);
  assert.equal(logged.stamp_only_count, 1);
});

test('accepted source changes become typed, dated, plain-language events with a destination and evidence', () => {
  const changeLog = mergeChangeLog(null, [
    entry({ diff: added31 }),
    entry({ id: 'fedramp-2026', from: 10, to: 11, fromCount: 444, toCount: 449, versions: ['2026.07.14.01', '2026.09.13.02'], diff: diffCatalogRecords([], []) }),
  ]);
  const pulse = build({ changeLog, baselines: { catalogs: { 'disa-stig': baselineFor(1, 2), 'fedramp-2026': baselineFor(10, 11) } } });
  const [stig, fedramp] = [pulse.events.find((e) => e.subject.id === 'disa-stig'), pulse.events.find((e) => e.subject.id === 'fedramp-2026')];
  assert.equal(stig.type, 'records_added');
  assert.equal(stig.title, '31 new DISA STIG records');
  assert.deepEqual(stig.counts, { previous_records: 100, current_records: 131, added: 31, removed: 0, revised: 0 });
  assert.equal(stig.date, '2026-09-21');
  assert.equal(stig.timestamp, '2026-09-21T15:16:41.811Z');
  assert.equal(stig.date_kind, 'accepted');
  assert.deepEqual(stig.destination, { label: 'Open DISA STIG', view: 'catalog-detail', patch: { catalog: 'disa-stig' } });
  assert.equal(stig.evidence.pointer, 'data/source-change-log.json#catalogs.disa-stig[0]');
  assert.equal(stig.evidence.decision, 'within_band');
  assert.equal(stig.identity.accepted_sha256, sha(2));
  assert.equal(fedramp.type, 'publication_updated');
  assert.equal(fedramp.title, 'FedRAMP Rules updated to 2026.09.13.02');
  assert.match(fedramp.summary, /was 2026\.07\.14\.01/);
  for (const event of pulse.events) {
    assert.ok(PULSE_EVENT_TYPES.includes(event.type));
    assert.ok(PULSE_TYPE_LABELS[event.type]);
    for (const field of ['id', 'date', 'title', 'summary']) assert.ok(event[field], `${event.id} ${field}`);
  }
});

test('a reviewed snapshot adoption says what was verified and admits what was not itemized', () => {
  const changeLog = mergeChangeLog(null, [entry({ decision: 'adopted_committed_state', fromCount: 17021, toCount: 26957 })]);
  const [event] = build({ changeLog, baselines: { catalogs: { 'disa-stig': baselineFor(1, 2) } } }).events;
  assert.equal(event.type, 'snapshot_changed');
  assert.equal(event.title, 'DISA STIG record set grew to 26,957');
  assert.match(event.summary, /not itemized/);
  assert.deepEqual(event.counts, { previous_records: 17021, current_records: 26957 }, 'unmeasured additions are not reported as zero');
});

test('supersessions and removals are reported from lifecycle evidence, not guessed', () => {
  const before = Array.from({ length: 20 }, (_, i) => rec(`R-${i}`, { status: 'active' }));
  const after = before.map((r, i) => (i < 4 ? { ...r, status: 'superseded', superseded_by: `N-${i}` } : r));
  const changeLog = mergeChangeLog(null, [entry({ diff: diffCatalogRecords(before, after), fromCount: 20, toCount: 20 })]);
  const [event] = build({ changeLog, baselines: { catalogs: { 'disa-stig': baselineFor(1, 2) } } }).events;
  assert.equal(event.type, 'records_superseded');
  assert.equal(event.counts.superseded, 4, 'status and superseded_by both moved for the same 4 records: counted once');
});

test('quarantined, rejected, unaccepted and stamp-only changes never surface', () => {
  const churn = diffCatalogRecords([rec('A')], [rec('A', { source: { key: 'k', snapshot_date: '2026-09-23', version: '1', locator: 'A' } })]);
  const changeLog = mergeChangeLog(null, [
    entry({ id: 'disa-stig', from: 1, to: 2, diff: added31 }), // current hash is NOT in the accepted chain: a forged or unaccepted entry
    entry({ id: 'fedramp-2026', from: 10, to: 11, decision: 'uncorroborated_count_change', diff: added31 }), // a rejected decision
    entry({ id: 'nist-800-53', from: 20, to: 21, fromCount: 1, toCount: 1, diff: churn }), // provenance stamps only
    entry({ id: 'csf-2', from: 30, to: 31, fromCount: 5, toCount: 5, decision: 'adopted_committed_state' }), // unmeasured, no count change
  ]);
  const registry = { quarantine: [{ id: 'artifact-disa-stig-library', refresh_source_id: 'fetch-disa-library', attempted_at: '2026-09-22T00:00:00Z', disposition: 'retained_last_good', reason: 'HTTP 503' }] };
  const pulse = build({
    changeLog, registry,
    baselines: { catalogs: { 'disa-stig': baselineFor(1, 9), 'fedramp-2026': baselineFor(10, 11), 'nist-800-53': baselineFor(20, 21), 'csf-2': baselineFor(30, 31) } },
  });
  assert.deepEqual(pulse.events, []);
  assert.deepEqual(pulse.withheld.map((w) => [w.catalog_id, w.reason]).sort(), [
    ['csf-2', 'unmeasured_without_count_change'],
    ['disa-stig', 'not_in_accepted_baseline_chain'],
    ['fedramp-2026', 'decision_not_accepted'],
    ['nist-800-53', 'no_verified_content_change'],
  ]);
  assert.deepEqual(pulse.quarantine, [{ id: 'artifact-disa-stig-library', refresh_source_id: 'fetch-disa-library', attempted_at: '2026-09-22T00:00:00Z', disposition: 'retained_last_good', shown_as_event: false }]);
  assert.equal(pulse.status.quiet, true);
  assert.deepEqual(pulseHomeSlice(pulse).events, [], 'an empty Pulse renders its empty state, never filler');
  assert.ok(ACCEPTED_DECISIONS.every((decision) => !/quarantin|reject/.test(decision)));
});

test('relationship-set changes keep direction, and only a set matching the served data surfaces', () => {
  const set = (rels, version = '1') => ({ source_key: 'olir', source_version: version, snapshot_date: 'x', relationships: rels });
  const a = { source_id: 'AC-01', target_id: 'GV.OC-03', relationship_type: 'Concept Crosswalk' };
  const b = { source_id: 'AC-02', target_id: 'PR.AA-01', relationship_type: 'Concept Crosswalk' };
  const previousDocument = set([a]);
  const currentDocument = set([a, b]);
  assert.equal(buildRelationshipChangeEntry({ setPath: 'maps/800-53-to-csf.json', previousDocument, currentDocument: { ...previousDocument, snapshot_date: 'y' }, acceptedAt: 't' }), null, 'a re-stamped set is not a change');
  const changed = buildRelationshipChangeEntry({ setPath: 'maps/800-53-to-csf.json', previousDocument, currentDocument, acceptedAt: '2026-09-22T10:00:00Z' });
  assert.deepEqual(changed.added_sample, [{ source_catalog: '', source_id: 'AC-02', relationship_type: 'Concept Crosswalk', target_catalog: '', target_id: 'PR.AA-01' }]);
  const changeLog = mergeChangeLog(null, [changed]);
  const served = new Map([['maps/800-53-to-csf.json', observeRelationshipSet(currentDocument)]]);
  const [event] = build({ changeLog, servedSets: served }).events;
  assert.equal(event.type, 'relationships_changed');
  assert.equal(event.title, 'NIST SP 800-53 to NIST CSF 2.0 connections updated');
  assert.deepEqual(event.subject.direction, { from: 'nist-800-53', to: 'csf-2' });
  assert.equal(event.destination.view, 'matrix');
  assert.deepEqual(event.counts, { previous_connections: 1, current_connections: 2, added: 1, removed: 0 });
  const notServed = build({ changeLog, servedSets: new Map([['maps/800-53-to-csf.json', observeRelationshipSet(previousDocument)]]) });
  assert.deepEqual(notServed.events, []);
  assert.equal(notServed.withheld[0].reason, 'does_not_match_served_set');
});

test('shipped features and releases need auditable evidence and a destination', () => {
  const good = { id: 'feature-x', kind: 'feature', shipped_at: '2026-09-24', title: 'T', summary: 'S', evidence: { pull_request: 1 }, destination: { label: 'Open', view: 'atlas-map', patch: {} } };
  assert.doesNotThrow(() => validateReleaseEntry(good));
  assert.throws(() => validateReleaseEntry({ ...good, evidence: {} }), /cites its issue or pull request/);
  assert.throws(() => validateReleaseEntry({ ...good, evidence: { pull_request: 1, merge_commit: 'abc' } }), /full commit SHA/);
  assert.throws(() => validateReleaseEntry({ ...good, destination: { label: 'x', view: 'nowhere' } }), /known view/);
  assert.throws(() => validateReleaseEntry({ ...good, kind: 'release', evidence: { tag: 'v1' } }), /tag and release URL/);
  assert.throws(() => validateReleaseEntry({ ...good, shipped_at: 'yesterday' }), /YYYY-MM-DD/);
  const [event] = build({ releaseLog: { releases: [good] } }).events;
  assert.deepEqual([event.type, event.date_kind, event.timestamp], ['feature_shipped', 'shipped', null]);
});

test('the same inputs give byte-identical output, stable ids, deduplicated events and newest-first order', () => {
  const log = mergeChangeLog(null, [entry({ diff: added31 })]);
  // The same accepted transition logged twice (for example a replayed merge) is one event.
  log.catalogs['disa-stig'].push(structuredClone(log.catalogs['disa-stig'][0]));
  const releaseLog = { releases: [
    { id: 'feature-old', kind: 'feature', shipped_at: '2026-09-01', title: 'Old', summary: 'S', evidence: { issue: 1 }, destination: { label: 'Open', view: 'atlas-map' } },
    { id: 'feature-new', kind: 'feature', shipped_at: '2026-09-30', title: 'New', summary: 'S', evidence: { issue: 2 }, destination: { label: 'Open', view: 'atlas-map' } },
  ] };
  const input = { changeLog: log, releaseLog, baselines: { catalogs: { 'disa-stig': baselineFor(1, 2) } } };
  const first = build(input);
  const second = build(structuredClone(input));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.events.map((e) => e.id), ['feature-new', second.events[1].id, 'feature-old']);
  assert.match(first.events[1].id, /^source-disa-stig-[a-f0-9]{12}$/);
  assert.equal(first.events.filter((e) => e.subject.id === 'disa-stig').length, 1);
  // An unrelated later entry does not move an existing event's id.
  const grown = structuredClone(input);
  grown.changeLog = mergeChangeLog(grown.changeLog, [entry({ from: 2, to: 3, fromCount: 131, toCount: 140, diff: added31 })]);
  grown.baselines.catalogs['disa-stig'] = baselineFor(1, 2, 3);
  assert.ok(build(grown).events.some((e) => e.id === first.events[1].id));
});

test('quiet periods are computed from the evidence dates, not the clock', () => {
  const releaseLog = { releases: [{ id: 'feature-a', kind: 'feature', shipped_at: '2026-08-01', title: 'A', summary: 'S', evidence: { issue: 1 }, destination: { label: 'Open', view: 'atlas-map' } }] };
  const quiet = build({ releaseLog });
  assert.equal(quiet.status.quiet, true);
  assert.equal(quiet.status.latest_event_date, '2026-08-01');
  const recent = build({ releaseLog: { releases: [{ ...releaseLog.releases[0], shipped_at: '2026-09-20' }] } });
  assert.equal(recent.status.quiet, false);
});

test('Home receives only a bounded slice with no evidence payload', () => {
  const releases = Array.from({ length: 12 }, (_, i) => ({ id: `feature-${i}`, kind: 'feature', shipped_at: `2026-09-${String(i + 10).padStart(2, '0')}`, title: `T${i}`, summary: 'S', evidence: { issue: i + 1 }, destination: { label: 'Open', view: 'atlas-map' } }));
  const slice = pulseHomeSlice(build({ releaseLog: { releases } }));
  assert.equal(slice.events.length, PULSE_HOME_LIMIT);
  assert.ok(PULSE_HOME_LIMIT >= 3 && PULSE_HOME_LIMIT <= 5);
  for (const event of slice.events) assert.deepEqual(Object.keys(event).sort(), ['date', 'date_kind', 'destination', 'id', 'subject', 'summary', 'title', 'type']);
});

test('the tracked release log validates and every relationship set the gate records has declared endpoints', () => {
  const log = JSON.parse(readFileSync('data/product-release-log.json', 'utf8'));
  assert.equal(log.schema_version, '1.0');
  const ids = new Set();
  for (const release of log.releases) {
    validateReleaseEntry(release);
    assert.ok(!ids.has(release.id), `duplicate release id ${release.id}`);
    ids.add(release.id);
  }
  const dates = log.releases.map((r) => r.shipped_at);
  assert.deepEqual(dates, [...dates].sort(), 'newest last');
  for (const [path, endpoints] of Object.entries(RELATIONSHIP_SET_ENDPOINTS)) {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(Array.isArray(document.relationships) && document.relationships.length, `${path} is a relationship set`);
    assert.equal(endpoints.length, 2);
  }
});
