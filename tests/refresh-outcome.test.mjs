import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { HEARTBEAT_DAYS, classifyRefresh, isMaterialChange, oldestCheckedDay } from '../tools/classify-refresh-outcome.mjs';

const json = (value) => Buffer.from(JSON.stringify(value));
const registry = (lastChecked) => ({ freshness: { sources: [{ source_id: 'a', sync_model: 'auto_synced', last_checked: lastChecked }, { source_id: 'curated', sync_model: 'curated', last_checked: '2020-01-01' }] } });
const now = new Date('2026-09-23T00:00:00Z');

test('dates and run timings are bookkeeping, records and versions are not', () => {
  const before = json({ generated_at: '2026-09-16', snapshot_date: '2026-09-16', records: [{ id: 'A', retrieved_at: '2026-09-16', title: 'Same' }] });
  const stamped = json({ generated_at: '2026-09-23', snapshot_date: '2026-09-23', records: [{ id: 'A', retrieved_at: '2026-09-23', title: 'Same' }] });
  assert.equal(isMaterialChange('data/x.json', before, stamped), false);
  assert.equal(isMaterialChange('data/x.json', before, json({ records: [{ id: 'A', title: 'Changed' }] })), true);
  assert.equal(isMaterialChange('data/x.json', before, json({ generated_at: '2026-09-16', snapshot_date: '2026-09-16', records: [{ id: 'A', retrieved_at: '2026-09-16', title: 'Same' }, { id: 'B' }] })), true);
  assert.equal(isMaterialChange('data/ingestion-pipeline-manifest.json', json({ a: 1 }), json({ a: 2 })), false, 'run telemetry is never a source change');
  assert.equal(isMaterialChange('maps/new.json', null, json({})), true, 'a new file is material');
  assert.equal(isMaterialChange('maps/gone.json', json({}), null), true, 'a deleted file is material');
  assert.equal(isMaterialChange('data/notes.md', Buffer.from('a'), Buffer.from('b')), true);
  assert.equal(isMaterialChange('data/x.json', Buffer.from('{not json'), Buffer.from('{other')), true, 'unparseable changes fail toward publishing');
});

test('nothing material and fresh dates stops the run; material change or a due heartbeat publishes', () => {
  const noise = [{ path: 'data/a.json', head: json({ generated_at: '1' }), working: json({ generated_at: '2' }) }];
  const quiet = classifyRefresh({ changes: noise, headRegistry: registry('2026-09-16'), now });
  assert.deepEqual([quiet.publish, quiet.reason, quiet.material_paths], [false, 'no_material_change', []]);
  assert.deepEqual(quiet.bookkeeping_paths, ['data/a.json']);
  assert.equal(classifyRefresh({ changes: [], headRegistry: registry('2026-09-16'), now }).publish, false);
  const changed = classifyRefresh({ changes: [{ path: 'data/a.json', head: json({ records: [] }), working: json({ records: [{ id: 'A' }] }) }], headRegistry: registry('2026-09-16'), now });
  assert.deepEqual([changed.publish, changed.reason], [true, 'material_source_change']);
  const stale = classifyRefresh({ changes: noise, headRegistry: registry('2026-08-25'), now });
  assert.deepEqual([stale.publish, stale.reason, stale.heartbeat_due], [true, 'freshness_heartbeat', true]);
});

test('the heartbeat comes well before the 45-day staleness window and ignores curated sources', () => {
  assert.ok(HEARTBEAT_DAYS <= 28 && HEARTBEAT_DAYS >= 7);
  assert.equal(oldestCheckedDay(registry('2026-09-16')), Date.parse('2026-09-16T00:00:00Z'));
  assert.equal(oldestCheckedDay({}), null);
  assert.equal(classifyRefresh({ changes: [], headRegistry: {}, now }).publish, true, 'unknown freshness publishes');
});

test('the command restores a bookkeeping-only tree and leaves a material one alone', (t) => {
  mkdirSync('.local', { recursive: true });
  const repo = mkdtempSync(resolve('.local', 'refresh-outcome-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const run = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, stdio: 'pipe' });
  mkdirSync(join(repo, 'data'));
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(repo, 'data/source-registry.json'), JSON.stringify(registry(today)));
  writeFileSync(join(repo, 'data/catalog.json'), JSON.stringify({ generated_at: '1', records: [{ id: 'A' }] }));
  run(['init', '-q']);
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'seed']);
  const tool = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'classify-refresh-outcome.mjs');
  const classify = () => spawnSync(process.execPath, [tool], { cwd: repo, encoding: 'utf8' });

  writeFileSync(join(repo, 'data/catalog.json'), JSON.stringify({ generated_at: '2', records: [{ id: 'A' }] }));
  const quiet = classify();
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stdout, /no_material_change/);
  assert.equal(JSON.parse(readFileSync(join(repo, 'data/catalog.json'), 'utf8')).generated_at, '1', 'bookkeeping is put back');

  writeFileSync(join(repo, 'data/catalog.json'), JSON.stringify({ generated_at: '2', records: [{ id: 'A' }, { id: 'B' }] }));
  const material = classify();
  assert.match(material.stdout, /material_source_change/);
  assert.equal(JSON.parse(readFileSync(join(repo, 'data/catalog.json'), 'utf8')).records.length, 2, 'a real change is kept');
});
