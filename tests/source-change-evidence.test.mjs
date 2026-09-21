import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANGE_LOG_LIMIT, buildChangeEntry, diffCatalogRecords, mergeChangeLog } from '../scripts/lib/source-change-evidence.mjs';

const rec = (id, extra = {}) => ({ id, title: id, ...extra });

test('added, removed, changed and unchanged identities are counted exactly', () => {
  const diff = diffCatalogRecords([rec('A'), rec('B'), rec('C')], [rec('B'), rec('C', { title: 'new' }), rec('D'), rec('E')]);
  assert.deepEqual([diff.added_count, diff.removed_count, diff.changed_count, diff.unchanged_count], [2, 1, 1, 1]);
  assert.equal(diff.removed_pct, 33.33);
  assert.deepEqual(diff.added_sample, ['D', 'E']);
  assert.deepEqual(diff.removed_sample, ['A']);
});

test('key order and nested key order never look like a change', () => {
  const diff = diffCatalogRecords([{ id: 'A', x: { b: 1, a: 2 }, y: [1, 2] }], [{ y: [1, 2], x: { a: 2, b: 1 }, id: 'A' }]);
  assert.equal(diff.changed_count, 0);
});

test('lifecycle transitions are grouped by field and value, largest first', () => {
  const previous = [rec('A', { status: 'active' }), rec('B', { status: 'active' }), rec('C', { status: 'draft' })];
  const next = [rec('A', { status: 'withdrawn' }), rec('B', { status: 'withdrawn' }), rec('C', { status: 'final', superseded_by: 'D' })];
  const { lifecycle_transitions: moves } = diffCatalogRecords(previous, next);
  assert.deepEqual(moves[0], { field: 'status', from: 'active', to: 'withdrawn', count: 2 });
  assert.ok(moves.some((move) => move.field === 'status' && move.from === 'draft' && move.to === 'final'));
  assert.ok(moves.some((move) => move.field === 'superseded_by' && move.from === null && move.to === 'D'));
});

test('samples are bounded so the tracked change log stays small', () => {
  const diff = diffCatalogRecords([], Array.from({ length: 500 }, (_, index) => rec(`N-${index}`)));
  assert.equal(diff.added_count, 500);
  assert.equal(diff.added_sample.length, 25);
});

const observation = (count, over = {}) => ({ record_count: count, normalized_sha256: `sha256:${String(count).padStart(64, '0')}`, publisher_version: null, ...over });

test('an entry states previous and current identity, counts and time, and never invents a version', () => {
  const entry = buildChangeEntry({
    catalogId: 'x', previous: { ...observation(1), accepted_at: '2026-09-01' }, candidate: observation(2), reason: 'within_band',
    acceptedAt: '2026-09-08T00:00:00Z', diff: diffCatalogRecords([rec('A')], [rec('A'), rec('B')]),
  });
  assert.equal(entry.previous.publisher_version, null);
  assert.equal(entry.current.publisher_version, null);
  assert.equal(entry.version_changed, false);
  assert.deepEqual([entry.added_count, entry.removed_count, entry.changed_count], [1, 0, 0]);
  assert.equal(entry.accepted_at, '2026-09-08T00:00:00Z');
  const adopted = buildChangeEntry({ catalogId: 'x', previous: observation(1), candidate: observation(2), reason: 'adopted_committed_state', acceptedAt: 'z' });
  assert.deepEqual([adopted.added_count, adopted.removed_count, adopted.changed_count], [null, null, null], 'unmeasured is null, not zero');
});

test('the log appends per catalog, ignores a repeated state, and keeps only recent history', () => {
  const entry = (count) => buildChangeEntry({ catalogId: 'x', previous: observation(count - 1), candidate: observation(count), reason: 'within_band', acceptedAt: 't' });
  let log = mergeChangeLog(null, [entry(2)]);
  assert.equal(log.catalogs.x.length, 1);
  assert.equal(mergeChangeLog(log, [entry(2)]).catalogs.x.length, 1);
  for (let count = 3; count < 40; count += 1) log = mergeChangeLog(log, [entry(count)]);
  assert.equal(log.catalogs.x.length, CHANGE_LOG_LIMIT);
  assert.equal(log.catalogs.x.at(-1).current.record_count, 39);
});
