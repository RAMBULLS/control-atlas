import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomically } from './write-json-atomically.mjs';

// The STIG/SRG-to-CCI map keeps every publisher citation ever recorded. GitHub
// refuses any single file over 100 MiB, so the map is stored as a main file that
// holds the current edition's citations plus checksummed shards that hold prior
// editions' citations. Readers restore the exact original document; nothing is
// dropped, reordered or inferred.

export const DISA_MAP_PATH = 'maps/stig-srg-to-cci.json';
export const DISA_MAP_CITATION_DIRECTORY = 'data/curated/disa/stig-srg-to-cci-citations';
// Stay well clear of GitHub's 100 MiB hard limit so a normal refresh never trips it.
export const DISA_MAP_FILE_BYTE_LIMIT = 90 * 1024 * 1024;

const checksum = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const SHARD_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const shardPath = (name) => `${DISA_MAP_CITATION_DIRECTORY}/${name}.json`;
const serialize = (document) => Buffer.from(`${JSON.stringify(document)}\n`);

/** Each prior compilation edition gets its own shard; standalone packages share one. */
export function disaCitationShardName(sourceUrl) {
  const base = String(sourceUrl || '').split('/').pop().replace(/\.zip$/i, '');
  return /^U_SRG-STIG_Library_[A-Za-z0-9_]+$/.test(base) ? base : 'standalone-packages';
}

const rowKey = (row, index) => row.atlas_connection_id || `#${index}`;
const derivedLocators = (citations) => citations.map((citation) => citation.locator);

export function separateDisaMapCitations(document) {
  if (!document || !Array.isArray(document.relationships)) return { main: document, shards: [] };
  const current = document.source_artifact || null;
  const shards = new Map();
  const seen = new Set();
  let derived = false;
  const relationships = document.relationships.map((row, index) => {
    if (!Array.isArray(row.source_citations)) return row;
    const key = rowKey(row, index);
    assert.ok(!seen.has(key), `Duplicate DISA connection key: ${key}`); seen.add(key);
    const out = {};
    for (const [field, value] of Object.entries(row)) {
      if (field === 'source_locators') {
        assert.ok(Array.isArray(value), 'DISA source_locators must be an array');
        // A null placeholder keeps the field's position; restore derives the array.
        if (JSON.stringify(value) === JSON.stringify(derivedLocators(row.source_citations))) { derived = true; out[field] = null; continue; }
        out[field] = value;
      } else if (field === 'source_citations') {
        const kept = [];
        value.forEach((citation, position) => {
          if (!current || citation?.source_url === current) { kept.push(citation); return; }
          const name = disaCitationShardName(citation?.source_url);
          if (!shards.has(name)) shards.set(name, new Map());
          const rows = shards.get(name);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push([position, citation]);
        });
        out[field] = kept;
      } else out[field] = value;
    }
    return out;
  });
  const main = { ...document, relationships };
  delete main.citation_history;
  const written = [...shards.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => {
    assert.ok(SHARD_NAME.test(name), `Invalid citation shard name: ${name}`);
    const shard = { schema_version: '1.0', map: DISA_MAP_PATH, shard: name, connections: Object.fromEntries(rows) };
    const bytes = serialize(shard);
    assert.ok(bytes.length < DISA_MAP_FILE_BYTE_LIMIT, `Citation shard ${name} is ${bytes.length} bytes; split it further`);
    return { ref: { path: shardPath(name), sha256: checksum(bytes), byte_length: bytes.length, connection_count: rows.size,
      citation_count: [...rows.values()].reduce((n, list) => n + list.length, 0) }, document: shard, bytes };
  });
  if (written.length || derived) {
    main.citation_history = { schema_version: '1.0', current_source_url: current, derived_fields: derived ? ['source_locators'] : [],
      shards: written.map((entry) => entry.ref) };
  }
  return { main, shards: written };
}

export function restoreDisaMapCitations(document, loadBytes) {
  const ref = document?.citation_history;
  if (!ref) return document;
  assert.equal(ref.schema_version, '1.0', 'Unknown DISA citation history schema');
  assert.ok(Array.isArray(ref.shards) && Array.isArray(ref.derived_fields), 'Malformed DISA citation history');
  assert.ok(ref.derived_fields.every((field) => field === 'source_locators'), 'Unknown derived DISA field');
  const extra = new Map();
  for (const shardRef of ref.shards) {
    const name = shardRef.path?.slice(DISA_MAP_CITATION_DIRECTORY.length + 1, -'.json'.length);
    assert.ok(SHARD_NAME.test(name || '') && shardRef.path === shardPath(name), 'Invalid DISA citation shard path');
    const bytes = loadBytes(shardRef.path);
    assert.equal(bytes.length, shardRef.byte_length, `Missing or altered DISA citation shard bytes: ${shardRef.path}`);
    assert.equal(checksum(bytes), shardRef.sha256, `Missing or altered DISA citation shard checksum: ${shardRef.path}`);
    const shard = JSON.parse(bytes);
    assert.equal(shard.shard, name, 'Citation shard name mismatch');
    const rows = Object.entries(shard.connections || {});
    assert.equal(rows.length, shardRef.connection_count, 'Citation shard connection count mismatch');
    assert.equal(rows.reduce((n, [, list]) => n + list.length, 0), shardRef.citation_count, 'Citation shard citation count mismatch');
    for (const [key, list] of rows) {
      assert.ok(Array.isArray(list) && list.every((entry) => Array.isArray(entry) && Number.isInteger(entry[0]) && entry[0] >= 0), 'Malformed citation shard entry');
      extra.set(key, [...(extra.get(key) || []), ...list]);
    }
  }
  const used = new Set();
  const derive = ref.derived_fields.includes('source_locators');
  const relationships = document.relationships.map((row, index) => {
    if (!Array.isArray(row.source_citations)) return row;
    const key = rowKey(row, index);
    const prior = extra.get(key) || [];
    if (prior.length) used.add(key);
    const total = row.source_citations.length + prior.length;
    const citations = new Array(total);
    for (const [position, citation] of prior) {
      assert.ok(position < total && citations[position] === undefined, `Citation position conflict: ${key}`);
      citations[position] = citation;
    }
    let next = 0;
    for (let position = 0; position < total; position += 1) if (citations[position] === undefined) citations[position] = row.source_citations[next++];
    assert.equal(next, row.source_citations.length, `Citation restore mismatch: ${key}`);
    const out = { ...row, source_citations: citations };
    if (row.source_locators === null) {
      assert.ok(derive, `Unexpected null source_locators: ${key}`);
      out.source_locators = derivedLocators(citations);
    }
    return out;
  });
  for (const key of extra.keys()) assert.ok(used.has(key), `Dangling DISA citation history: ${key}`);
  const restored = { ...document, relationships };
  delete restored.citation_history;
  return restored;
}

export function readDisaMap(root, relative = DISA_MAP_PATH) {
  const path = join(root, relative);
  if (!existsSync(path)) return null;
  return restoreDisaMapCitations(JSON.parse(readFileSync(path)), (file) => readFileSync(join(root, file)));
}

/** Supporting files the main map references; empty when it holds everything. */
export function disaMapSupportingPaths(root, relative = DISA_MAP_PATH) {
  const path = join(root, relative);
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path)).citation_history?.shards || []).map((shard) => shard.path);
}

export function writeDisaMap(root, document) {
  const { main, shards } = separateDisaMapCitations(document);
  const mainBytes = serialize(main);
  assert.ok(mainBytes.length < DISA_MAP_FILE_BYTE_LIMIT, `DISA map main file is ${mainBytes.length} bytes; split it further`);
  const keep = new Set(shards.map((entry) => entry.ref.path.split('/').pop()));
  for (const entry of shards) writeJsonAtomically(join(root, entry.ref.path), entry.document, { space: 0 });
  writeJsonAtomically(join(root, DISA_MAP_PATH), main, { space: 0 });
  const directory = join(root, DISA_MAP_CITATION_DIRECTORY);
  if (existsSync(directory)) for (const file of readdirSync(directory)) if (file.endsWith('.json') && !keep.has(file)) rmSync(join(directory, file));
  return main;
}
