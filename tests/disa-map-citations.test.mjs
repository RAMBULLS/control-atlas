import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DISA_MAP_CITATION_DIRECTORY, DISA_MAP_PATH, disaCitationShardName, disaMapSupportingPaths,
  readDisaMap, restoreDisaMapCitations, separateDisaMapCitations, writeDisaMap,
} from '../scripts/lib/disa-map-citations.mjs';

const JULY = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_SRG-STIG_Library_July_2026.zip';
const OCT = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_SRG-STIG_Library_October_2026.zip';
const SOLO = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_RHEL_8_V2R9_STIG.zip';
const cite = (url, n, locator) => ({ source_locator: `a.xml#V-${n}`, source_url: url, source_version: 'V1R1', checksum: `sha256:${n}`, locator });
const row = (n, citations, extra = {}) => ({ source_catalog: 'disa-stig', source_id: `V-${n}`, target_catalog: 'disa-cci', target_id: 'CCI-000001',
  source_locator: `a.xml#V-${n}`, source_citations: citations, source_locators: citations.map((c) => c.locator), atlas_connection_id: `edge:stig-srg-to-cci:${n}`, ...extra });
const document = { schema_version: '2.0', source_artifact: OCT, relationships: [
  // Prior editions interleave with current ones; order must survive exactly.
  row(1, [cite(JULY, 1, 'a.xml#V-1'), cite(OCT, 1, `${OCT} | a.xml#V-1`), cite(SOLO, 1, `${SOLO} | a.xml#V-1`), cite(OCT, 2, `${OCT} | a.xml#V-1`)]),
  row(2, [cite(OCT, 2, 'a.xml#V-2')]),
  { ...row(3, [cite(JULY, 3, 'x')]), source_locators: ['explicit, not derivable'] },
  row(4, [cite(JULY, 4, 'only prior')], { warning: 'retained' }),
] };

const store = (split) => new Map(split.shards.map((shard) => [shard.ref.path, shard.bytes]));

test('prior-edition citations move to shards and restore byte-for-byte, field order included', () => {
  const split = separateDisaMapCitations(document);
  assert.deepEqual(split.main.relationships[0].source_citations.map((c) => c.source_url), [OCT, OCT]);
  assert.equal(split.main.relationships[0].source_locators, null);
  assert.deepEqual(split.main.relationships[2].source_locators, ['explicit, not derivable']);
  assert.deepEqual(split.main.relationships[3].source_citations, []);
  assert.deepEqual(split.shards.map((shard) => shard.ref.path).sort(), [
    `${DISA_MAP_CITATION_DIRECTORY}/U_SRG-STIG_Library_July_2026.json`, `${DISA_MAP_CITATION_DIRECTORY}/standalone-packages.json`]);
  const files = store(split);
  const restored = restoreDisaMapCitations(JSON.parse(JSON.stringify(split.main)), (path) => files.get(path));
  assert.equal(JSON.stringify(restored), JSON.stringify(document));
});

test('only compilation editions get their own shard', () => {
  assert.equal(disaCitationShardName(JULY), 'U_SRG-STIG_Library_July_2026');
  assert.equal(disaCitationShardName(SOLO), 'standalone-packages');
  assert.equal(disaCitationShardName('https://evil.example/../U_SRG-STIG_Library_July_2026.zip/../x'), 'standalone-packages');
});

test('missing, altered, miscounted, unsafe and dangling shards fail closed', () => {
  const split = separateDisaMapCitations(document);
  const files = store(split);
  const load = (path) => files.get(path);
  const history = split.main.citation_history;
  assert.throws(() => restoreDisaMapCitations(split.main, () => { throw Error('Missing shard'); }), /Missing shard/);
  assert.throws(() => restoreDisaMapCitations(split.main, () => Buffer.from('{}\n')), /altered DISA citation shard/);
  const miscount = { ...history, shards: history.shards.map((shard) => ({ ...shard, citation_count: shard.citation_count + 1 })) };
  assert.throws(() => restoreDisaMapCitations({ ...split.main, citation_history: miscount }, load), /citation count mismatch/);
  const unsafe = { ...history, shards: [{ ...history.shards[0], path: '../outside.json' }] };
  assert.throws(() => restoreDisaMapCitations({ ...split.main, citation_history: unsafe }, load), /shard path/);
  assert.throws(() => restoreDisaMapCitations({ ...split.main, relationships: split.main.relationships.slice(1) }, load), /Dangling/);
});

test('a map with nothing to move is stored unchanged', () => {
  const plain = { relationships: [{ source_id: 'V-1', target_id: 'CCI-1' }] };
  assert.deepEqual(separateDisaMapCitations(plain).main, plain);
  assert.equal(restoreDisaMapCitations(plain, () => assert.fail()), plain);
});

test('writing stores compact files, drops stale shards and reads back the full map', () => {
  const root = mkdtempSync(join(tmpdir(), 'disa-map-'));
  try {
    mkdirSync(join(root, DISA_MAP_CITATION_DIRECTORY), { recursive: true });
    writeFileSync(join(root, DISA_MAP_CITATION_DIRECTORY, 'U_SRG-STIG_Library_April_2026.json'), '{}\n');
    writeDisaMap(root, document);
    const text = readFileSync(join(root, DISA_MAP_PATH), 'utf8');
    assert.equal(text, `${JSON.stringify(JSON.parse(text))}\n`, 'main map is compact');
    assert.deepEqual(readdirSync(join(root, DISA_MAP_CITATION_DIRECTORY)).sort(), ['U_SRG-STIG_Library_July_2026.json', 'standalone-packages.json']);
    assert.equal(disaMapSupportingPaths(root).length, 2);
    assert.equal(JSON.stringify(readDisaMap(root)), JSON.stringify(document));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
