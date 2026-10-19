import assert from 'node:assert/strict';
import test from 'node:test';
import { separateDisaHistory, restoreDisaHistory } from '../scripts/lib/disa-record-history.mjs';

const native = { id: 'V-00001', title: 'Unicode Ω, "quotes"\nand lines', source: { version: 'V1R1' }, metadata: { benchmark_id: 'native-1' } };
const document = { records: [{ ...native, source: { version: 'V1R2' }, metadata: { ...native.metadata, previous_editions: [native] } }] };
const encoded = (history) => Buffer.from(`${JSON.stringify(history, null, 2)}\n`);

test('supporting native edition history round trips every field without changing item IDs or source text', () => {
  const { main, history } = separateDisaHistory(document, 'stig');
  assert.equal(main.records[0].metadata.previous_editions, undefined);
  assert.deepEqual(restoreDisaHistory(main, () => encoded(history)), document);
  assert.deepEqual(document.records[0].metadata.previous_editions, [native]);
});

test('missing, changed, wrong-edition and dangling supporting history fail closed', () => {
  const { main, history } = separateDisaHistory(document, 'stig');
  assert.throws(() => restoreDisaHistory(main, () => { throw Error('Missing history shard'); }), /Missing history/);
  assert.throws(() => restoreDisaHistory(main, () => Buffer.from('{}')), /altered DISA history/);
  assert.throws(() => restoreDisaHistory({ ...main, record_history: { ...main.record_history, edition_count: 2 } }, () => encoded(history)), /edition count mismatch/);
  assert.throws(() => restoreDisaHistory({ ...main, records: [] }, () => encoded(history)), /Dangling/);
  assert.throws(() => restoreDisaHistory({ ...main, record_history: { ...main.record_history, path: '../outside.json' } }, () => encoded(history)), /supporting history path/);
});
