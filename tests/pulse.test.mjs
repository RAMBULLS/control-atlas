// Pulse, Phase 1: every shown event is backed by accepted evidence, nothing
// quarantined, rejected, unaccepted or merely re-stamped can surface, and the
// same inputs always give the same artifact with the same event ids.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ACCEPTED_DECISIONS, PULSE_EVENT_TYPES, PULSE_HOME_LIMIT, PULSE_TYPE_LABELS, buildPulse, pulseHomeSlice, validatePresentation,
} from '../scripts/lib/pulse.mjs';
import { CONTENT_DIFF_BASIS, buildChangeEntry, buildRelationshipChangeEntry, diffCatalogRecords, mergeChangeLog, observeRelationshipSet } from '../scripts/lib/source-change-evidence.mjs';
import { RELATIONSHIP_SET_ENDPOINTS } from '../scripts/lib/catalog-refresh-profiles.mjs';
import { readProductHistory } from '../scripts/lib/product-history.mjs';

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
  changeLog: null, baselines: { catalogs: {} }, presentation: null, history: null, registry: { quarantine: [] }, publications,
  relationshipSets: RELATIONSHIP_SET_ENDPOINTS, servedSets: new Map(), dataset, inputs: {}, ...overrides,
});
// Product helpers: presentation is words only; history stands in for readProductHistory().
const feature = (pr, title) => ({ pull_request: pr, title, summary: 'S', destination: { label: 'Open', view: 'atlas-map' } });
const merged = (pairs, tags = new Map()) => ({
  available: true, head: 'f'.repeat(40), tags,
  merges: new Map(pairs.map(([pr, at]) => [pr, { sha: String(pr).padStart(40, 'a'), committed_at: new Date(at).toISOString(), subject: `feat: x (#${pr})` }])),
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

test('the same inputs give byte-identical output, stable ids, deduplicated events and newest-first order', () => {
  const log = mergeChangeLog(null, [entry({ diff: added31 })]);
  // The same accepted transition logged twice (for example a replayed merge) is one event.
  log.catalogs['disa-stig'].push(structuredClone(log.catalogs['disa-stig'][0]));
  const presentation = { schema_version: '1.0', features: [feature(1, 'Old'), feature(2, 'New')] };
  const history = merged([[1, '2026-09-01T10:00:00Z'], [2, '2026-09-30T10:00:00Z']]);
  const input = { changeLog: log, presentation, history, baselines: { catalogs: { 'disa-stig': baselineFor(1, 2) } } };
  const first = build(input);
  const second = build({ ...structuredClone({ ...input, history: null }), history });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.events.map((e) => e.id), ['feature-pr-2', second.events[1].id, 'feature-pr-1']);
  assert.match(first.events[1].id, /^source-disa-stig-[a-f0-9]{12}$/);
  assert.equal(first.events.filter((e) => e.subject.id === 'disa-stig').length, 1);
  // An unrelated later entry does not move an existing event's id.
  const grown = structuredClone(input);
  grown.changeLog = mergeChangeLog(grown.changeLog, [entry({ from: 2, to: 3, fromCount: 131, toCount: 140, diff: added31 })]);
  grown.baselines.catalogs['disa-stig'] = baselineFor(1, 2, 3);
  assert.ok(build(grown).events.some((e) => e.id === first.events[1].id));
});

test('quiet periods are computed from the evidence dates, not the clock', () => {
  const presentation = { schema_version: '1.0', features: [feature(1, 'A')] };
  const quiet = build({ presentation, history: merged([[1, '2026-08-01T12:00:00Z']]) });
  assert.equal(quiet.status.quiet, true);
  assert.equal(quiet.status.latest_event_date, '2026-08-01');
  const recent = build({ presentation, history: merged([[1, '2026-09-20T12:00:00Z']]) });
  assert.equal(recent.status.quiet, false);
});

test('Home receives only a bounded slice with no evidence payload', () => {
  const presentation = { schema_version: '1.0', features: Array.from({ length: 12 }, (_, i) => feature(i + 1, `T${i}`)) };
  const history = merged(Array.from({ length: 12 }, (_, i) => [i + 1, `2026-09-${String(i + 10).padStart(2, '0')}T12:00:00Z`]));
  const slice = pulseHomeSlice(build({ presentation, history }));
  assert.equal(slice.events.length, PULSE_HOME_LIMIT);
  assert.ok(PULSE_HOME_LIMIT >= 3 && PULSE_HOME_LIMIT <= 5);
  for (const event of slice.events) assert.deepEqual(Object.keys(event).sort(), ['date', 'date_kind', 'destination', 'id', 'subject', 'summary', 'title', 'type']);
});

test('the tracked presentation file holds words only, and every relationship set the gate records has declared endpoints', () => {
  const presentation = validatePresentation(JSON.parse(readFileSync('data/pulse-presentation.json', 'utf8')));
  assert.ok(presentation.features.length && presentation.releases.length);
  assert.doesNotMatch(readFileSync('data/pulse-presentation.json', 'utf8'), /shipped_at|merge_commit|"issue"|"date"/);
  for (const [path, endpoints] of Object.entries(RELATIONSHIP_SET_ENDPOINTS)) {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(Array.isArray(document.relationships) && document.relationships.length, `${path} is a relationship set`);
    assert.equal(endpoints.length, 2);
  }
});

// ---- Product events come from Git, never from authored facts -------------------
// A real repository: main carries GitHub squash merges; a side branch carries an unmerged pull request.
function repository(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir, ...env } }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Author']);
  git(['config', 'user.email', 'author@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  let n = 0;
  const commit = (subject, at, committer = ['GitHub', 'noreply@github.com']) => {
    writeFileSync(join(dir, 'file.txt'), `${n += 1}`);
    git(['add', 'file.txt']);
    git(['commit', '-q', '-m', subject], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_COMMITTER_NAME: committer[0], GIT_COMMITTER_EMAIL: committer[1] });
    return git(['rev-parse', 'HEAD']);
  };
  return { dir, git, commit };
}
const releaseEntry = (tag) => ({ tag, title: `Release ${tag}`, summary: 'S', destination: { label: 'About', view: 'about' } });
const productPulse = (repo, presentation, head = 'HEAD') => build({
  presentation, history: readProductHistory(repo.dir, { head, tags: (presentation.releases || []).map((r) => r.tag) }),
});

test('Git: a nonexistent pull request, an unmerged one, and a locally forged merge subject cannot surface', (t) => {
  const repo = repository(t);
  repo.commit('feat: shipped (#10)', '2026-09-24T12:00:00Z');
  repo.commit('feat: typed by hand to look merged (#12)', '2026-09-24T13:00:00Z', ['Someone', 'someone@example.com']);
  repo.git(['checkout', '-q', '-b', 'unmerged']);
  repo.commit('feat: still in review (#11)', '2026-09-24T14:00:00Z');
  repo.git(['checkout', '-q', 'main']);
  const pulse = productPulse(repo, { schema_version: '1.0', features: [feature(10, 'Shipped'), feature(11, 'Unmerged'), feature(12, 'Forged'), feature(999, 'Nonexistent')] });
  assert.deepEqual(pulse.events.map((e) => e.id), ['feature-pr-10']);
  assert.deepEqual(pulse.withheld.map((w) => [w.pull_request, w.reason]), [
    [11, 'pull_request_not_merged_on_build_history'],
    [12, 'pull_request_not_merged_on_build_history'],
    [999, 'pull_request_not_merged_on_build_history'],
  ]);
  // The unmerged pull request surfaces only once main actually carries its merge.
  repo.commit('feat: still in review (#11)', '2026-09-25T09:00:00Z');
  assert.ok(productPulse(repo, { schema_version: '1.0', features: [feature(11, 'Now merged')] }).events.some((e) => e.id === 'feature-pr-11'));
});

test('Git: authored dates and SHAs are rejected; the event carries the derived merge commit and time', (t) => {
  const repo = repository(t);
  const sha = repo.commit('feat: shipped (#10)', '2026-09-24T12:00:00Z');
  for (const forged of [{ shipped_at: '2030-01-01' }, { merge_commit: 'b'.repeat(40) }, { timestamp: '2030-01-01T00:00:00Z' }, { issue: 1 }]) {
    assert.throws(() => productPulse(repo, { schema_version: '1.0', features: [{ ...feature(10, 'Shipped'), ...forged }] }), /shipping facts come from Git/);
  }
  const [event] = productPulse(repo, { schema_version: '1.0', features: [feature(10, 'Shipped')] }).events;
  assert.equal(event.identity.merge_commit, sha);
  assert.equal(event.evidence.commit, sha);
  assert.equal(event.timestamp, '2026-09-24T12:00:00.000Z');
  assert.equal(event.date, '2026-09-24');
  assert.equal(event.evidence.basis, 'merged_pull_request');
  assert.equal(event.evidence.subject, 'feat: shipped (#10)');
});

test('Git: two merges on the same day order by their actual merge time, not by the presentation order', (t) => {
  const repo = repository(t);
  repo.commit('feat: morning (#20)', '2026-09-24T08:15:00-04:00');
  repo.commit('feat: evening (#21)', '2026-09-24T19:40:00-04:00');
  const pulse = productPulse(repo, { schema_version: '1.0', features: [feature(20, 'Morning'), feature(21, 'Evening')] });
  assert.deepEqual(pulse.events.map((e) => [e.id, e.timestamp]), [
    ['feature-pr-21', '2026-09-24T23:40:00.000Z'],
    ['feature-pr-20', '2026-09-24T12:15:00.000Z'],
  ]);
});

test('Git: a real merged feature is the same stable event on every rebuild, including after later merges', (t) => {
  const repo = repository(t);
  repo.commit('feat: shipped (#10)', '2026-09-24T12:00:00Z');
  const presentation = { schema_version: '1.0', features: [feature(10, 'Shipped')] };
  const first = productPulse(repo, presentation).events[0];
  const again = productPulse(repo, presentation).events[0];
  assert.deepEqual({ ...again, evidence: { ...again.evidence } }, first);
  repo.commit('feat: later (#30)', '2026-09-26T12:00:00Z');
  const later = productPulse(repo, presentation).events[0];
  assert.equal(later.id, first.id);
  assert.deepEqual([later.timestamp, later.identity], [first.timestamp, first.identity]);
});

test('Git: a release event needs a real tag whose commit is reachable from the build history', (t) => {
  const repo = repository(t);
  const tagged = repo.commit('chore: release (#40)', '2026-07-28T22:00:00Z');
  repo.git(['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], { GIT_COMMITTER_DATE: '2026-07-28T22:59:23Z' });
  repo.git(['checkout', '-q', '-b', 'side']);
  repo.commit('feat: side (#41)', '2026-07-29T10:00:00Z');
  repo.git(['tag', '-a', 'v9.9.9', '-m', 'v9.9.9'], { GIT_COMMITTER_DATE: '2026-07-29T11:00:00Z' });
  repo.git(['checkout', '-q', 'main']);
  const pulse = productPulse(repo, { schema_version: '1.0', releases: [releaseEntry('v1.0.0'), releaseEntry('v9.9.9'), releaseEntry('v0.0.1')] });
  assert.deepEqual(pulse.events.map((e) => [e.id, e.type, e.timestamp, e.identity.tag_commit]), [['release-v1.0.0', 'product_release', '2026-07-28T22:59:23.000Z', tagged]]);
  assert.deepEqual(pulse.withheld.map((w) => [w.tag, w.reason]), [['v9.9.9', 'tag_not_reachable_from_build_history'], ['v0.0.1', 'tag_not_found']]);
});

test('Git: without full history nothing is asserted as shipped', (t) => {
  const repo = repository(t);
  repo.commit('feat: shipped (#10)', '2026-09-24T12:00:00Z');
  const shallow = build({ presentation: { schema_version: '1.0', features: [feature(10, 'Shipped')] }, history: { available: false, reason: 'shallow_history' } });
  assert.deepEqual(shallow.events, []);
  assert.deepEqual([shallow.withheld[0].reason, shallow.product_history], ['git_history_unavailable', { available: false, reason: 'shallow_history' }]);
});
