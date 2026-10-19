import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const CORE_CATALOGS = new Set([
  'cmmc-2', 'csf-2', 'nist-csf-1.1', 'cui-policy', 'disa-cci', 'disa-srg', 'disa-stig',
  'dod-zt', 'fips-199', 'fips-200', 'nist-800-37', 'nist-800-53', 'nist-800-53a',
  'nist-800-53b', 'nist-800-171-rev2', 'nist-800-171', 'nist-800-172', 'nist-zt',
  'microsoft-zt-maturity', 'nist-critical-software', 'nist-iot-cybersecurity', 'nist-ssdf',
]);
export const CONTEXT_CATALOGS = new Set(['fedramp-rev5', 'mitre-attack', 'mitre-attack-ics', 'mitre-d3fend', 'nist-mobile-threats']);
export const TYPE_FIELDS = [
  ['Relationship', 'relationship_type'], ['Class', 'relationship_class'], ['Assertion class', 'assertion_class'],
  ['Direction', 'directionality'], ['Publication status', 'publication_status'], ['Lifecycle', 'status'],
  ['Authority', 'authority_class'], ['Provenance', 'provenance_class'], ['Confidence', 'confidence'],
  ['Mapping model', 'mapping_model'], ['Publisher relationship', 'raw_relationship_type'], ['Inference rule', 'inference_rule_id'],
  ['Source artifact ID', 'source_artifact_id'],
];
export const COLUMNS = Object.freeze({
  Items: ['Catalog', 'Group', 'Control ID', 'Title', 'Description', 'Record type', 'Severity', 'Lifecycle', 'Published mappings', 'Candidate mappings', 'Atlas item ID', 'Group ID', 'Source ID', 'Source location'],
  Connections: ['From catalog', 'From item', 'Relationship', 'To catalog', 'To item', 'Class', 'Publication status', 'Rationale', 'Warning', 'Atlas connection ID', 'From Atlas item ID', 'To Atlas item ID', 'Relationship type ID', 'Source location'],
  Groups: ['Group ID', 'Catalog', 'Group', 'Publisher', 'Benchmark ID', 'Benchmark title', 'Benchmark edition', 'Publication ID', 'Publication edition', 'Source ID', 'Artifact IDs'],
  RelationshipTypes: ['Relationship type ID', ...TYPE_FIELDS.map(([name]) => name)],
  Sources: ['Source ID', 'Name', 'Publisher', 'Edition', 'Lifecycle', 'Official URL', 'Catalog URL', 'Publication ID', 'Record kind', 'Authority', 'Provenance', 'Retrieved at', 'SHA-256', 'Bytes', 'License or use', 'Source access status', 'Prior official URL', 'Archive URL', 'Source access note'],
  Citations: ['Owner kind', 'Owner Atlas ID', 'Source ID', 'Source location', 'Reference type', 'Evidence ID', 'Source edition', 'Retrieved at', 'SHA-256', 'Evidence quality', 'Publisher file URL', 'Native rule ID', 'Benchmark ID'],
  PublisherAssertions: ['Atlas connection ID', 'Publisher assertion ID', 'Publisher relationship', 'Qualifier', 'Source location'],
  ItemDetails: ['Atlas item ID', 'Field', 'Part', 'Text'],
});

/** Bounded traversal of every declared shard, with the same count checks as the canonical reader. */
export function* generatedRecords(root, name, inputs = new Map()) {
  const directory = resolve(root, 'data/generated');
  const load = (path) => {
    const absolute = resolve(directory, path);
    if (!absolute.startsWith(`${directory}${sep}`)) throw new Error(`Invalid ${name} shard path`);
    const bytes = readFileSync(absolute);
    const key = `data/generated/${path.replaceAll('\\', '/')}`; const identity = { bytes: bytes.length, sha256: digest(bytes) };
    if (inputs.has(key) && inputs.get(key).sha256 !== identity.sha256) throw new Error(`Canonical input changed during export: ${path}`);
    inputs.set(key, identity);
    return JSON.parse(bytes.toString('utf8'));
  };
  const manifest = load(`${name}.json`);
  if (!manifest.sharded_collection) {
    if (!Array.isArray(manifest[name])) throw new Error(`Missing canonical ${name}`);
    yield* manifest[name]; return;
  }
  const shards = manifest.sharded_collection.shards;
  if (!Array.isArray(shards) || !shards.length) throw new Error(`Missing ${name} shards`);
  const paths = new Set(); let count = 0;
  for (const shard of shards) {
    if (paths.has(shard.path)) throw new Error(`Duplicate ${name} shard`);
    paths.add(shard.path);
    const records = load(shard.path)[name];
    if (!Array.isArray(records) || records.length !== shard.record_count) throw new Error(`Invalid ${name} shard count: ${shard.path}`);
    count += records.length; yield* records;
  }
  if (count !== manifest.sharded_collection.record_count) throw new Error(`Incomplete ${name} shard total`);
}

export function compactNode(node, sources) {
  const m = node.metadata || {}; const source = sources.get(node.source_id) || {};
  const group = [m.catalog_id || '', m.family || '', m.benchmark_id || '', m.benchmark_title || '', m.benchmark_version || '', m.publication_id || node.publication_source_id || '', source.version || '', node.source_id || '', (node.artifact_ids || []).join('; ')];
  const details = [];
  for (const field of ['outcomes', 'end_state', 'pillar', 'responsibility', 'activity_type', 'duration', 'predecessors', 'successors', 'countermeasures', 'unresolved_mappings', 'source_warnings', 'current_snapshot_presence']) {
    if (m[field] !== undefined && m[field] !== null) flattenDetails(node.id, field.replaceAll('_', ' '), m[field], details);
  }
  if (m.previous_editions?.length) flattenDetails(node.id, 'previous editions', m.previous_editions.map((entry) => ({ benchmark_id: entry.metadata?.benchmark_id || '', edition: entry.source?.version || '', rule_id: entry.rule_id || '', source_location: entry.source?.locator || '' })), details);
  if (node.warnings || m.warnings) flattenDetails(node.id, 'warning', node.warnings || m.warnings, details);
  return { id: node.id, catalog: m.catalog_id || '', nativeId: m.publisher_item_id || m.item_id || '',
    title: m.title || node.label || '', description: m.description || '', type: m.native_type || node.node_type || '',
    lifecycle: node.lifecycle_status || '', severity: m.severity || '', sourceId: node.source_id || '',
    sourceLocation: m.source_locator || '', refs: node.source_refs || [], artifactIds: node.artifact_ids || [],
    publicationId: node.publication_source_id || '', groupId: `group:${digest(JSON.stringify(group))}`,
    groupRow: ['', group[0], group[1], source.owner || '', group[2], group[3], group[4], group[5], group[6], group[7], group[8]], details };
}

export function itemLabel(item) {
  if (!item.title || item.title === item.nativeId) return item.nativeId;
  // Long generated publisher-unit keys remain in Items; use their captured titles for reading.
  return item.nativeId && item.nativeId.length <= 60 ? `${item.nativeId} — ${item.title}` : item.title;
}
export const readableTerm = (term) => String(term || '').replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());

export function sourceRecoveryColumns(source, sources) {
  const recovery = source.metadata?.source_recovery || [...sources.values()].find((entry) => entry.publication_source_id === source.id && entry.metadata?.source_recovery)?.metadata.source_recovery;
  if (!recovery) return ['', '', '', ''];
  if (recovery.status === 'verified_relocation') return ['Verified official relocation', recovery.prior_url || '', '', 'Recovered official bytes exactly match the retained checksum and length.'];
  if (recovery.status === 'archive_content_verified') return ['Archive content verified; publisher location unconfirmed', source.artifact_url || '', recovery.archival_corroboration?.url || '', 'Official URLs return 404; all 383 page texts match the retained official capture. Publisher retirement or replacement is unconfirmed.'];
  return [readableTerm(recovery.status), recovery.prior_url || '', '', recovery.next_action || ''];
}

/** Scalar rows rather than JSON; long values split losslessly below Excel's cell limit. */
export function flattenDetails(id, field, value, rows) {
  if (Array.isArray(value)) { value.forEach((entry, index) => flattenDetails(id, `${field} [${index + 1}]`, entry, rows)); return; }
  if (value && typeof value === 'object') { for (const key of Object.keys(value).sort(ordinal)) flattenDetails(id, `${field}: ${key.replaceAll('_', ' ')}`, value[key], rows); return; }
  const text = value === null ? '' : String(value);
  let part = 1;
  for (let offset = 0; offset < text.length || (offset === 0 && !text.length);) {
    let end = Math.min(offset + 30000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    rows.push([id, field, part++, text.slice(offset, end)]); offset = end;
    if (!text.length) break;
  }
}

export function selectScope(nodes, edges, core = CORE_CATALOGS, context = CONTEXT_CATALOGS) {
  const selected = new Set([...nodes.values()].filter((node) => core.has(node.catalog)).map((node) => node.id));
  const coreIds = new Set(selected);
  for (const edge of edges) {
    if (!nodes.has(edge.source_node_id) || !nodes.has(edge.target_node_id)) throw new Error(`Unknown canonical endpoint: ${edge.id}`);
    if (!['correlation', 'applicability'].includes(edge.relationship_class)) continue;
    const from = nodes.get(edge.source_node_id); const to = nodes.get(edge.target_node_id);
    if (coreIds.has(from.id) && context.has(to.catalog)) selected.add(to.id);
    if (coreIds.has(to.id) && context.has(from.catalog)) selected.add(from.id);
  }
  // Include native grouping parents; containment never counts as a mapping.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) if (edge.relationship_class === 'structural' && selected.has(edge.target_node_id) && !selected.has(edge.source_node_id)) {
      const parent = nodes.get(edge.source_node_id);
      if (context.has(parent.catalog)) { selected.add(parent.id); changed = true; }
    }
  }
  return { selected, edges: edges.filter((edge) => selected.has(edge.source_node_id) && selected.has(edge.target_node_id)), coreIds };
}

export function relationshipType(edge) {
  const values = TYPE_FIELDS.map(([, key]) => edge[key] ?? (key === 'directionality' ? 'directed' : key === 'raw_relationship_type' ? edge.relationship_type : ''));
  return [`type:${digest(JSON.stringify(values))}`, ...values];
}

export function citationRow(kind, owner, ref) {
  if (typeof ref === 'string') {
    const boundary = ref.indexOf('#');
    return [kind, owner, boundary < 0 ? ref : ref.slice(0, boundary), boundary < 0 ? '' : ref.slice(boundary + 1), 'source reference', '', '', '', '', '', '', '', ''];
  }
  return [kind, owner, ref.source_id || '', ref.locator || '', ref.ref_type || 'source reference', ref.id || '', ref.source_version || '', ref.retrieved_at || '', ref.checksum || '', ref.evidence_quality || '', ref.source_url || '', ref.native_rule_id || '', ref.benchmark_id || ''];
}

export function validateCompactTables(tables) {
  const errors = []; const ids = new Map();
  for (const [name, rows] of Object.entries(tables)) {
    for (const row of rows) {
      if (row.length !== COLUMNS[name].length) errors.push(`${name}: wrong column count`);
      for (const value of row) if (value !== null && typeof value === 'object') errors.push(`${name}: structured cell`);
      if (row.some((value) => String(value ?? '').length > 32767)) errors.push(`${name}: Excel cell limit`);
    }
    if (['Items', 'Connections', 'Groups', 'RelationshipTypes', 'Sources'].includes(name)) {
      const index = name === 'Items' ? 10 : name === 'Connections' ? 9 : 0;
      const set = new Set(); for (const row of rows) { if (!row[index] || set.has(row[index])) errors.push(`${name}: duplicate or empty ID`); set.add(row[index]); }
      ids.set(name, set);
    }
  }
  for (const row of tables.Items) {
    if (!ids.get('Groups').has(row[11])) errors.push('Item group missing');
    if (row[12] && !ids.get('Sources').has(row[12])) errors.push('Item source missing');
  }
  for (const row of tables.Connections) {
    if (!ids.get('Items').has(row[10]) || !ids.get('Items').has(row[11])) errors.push('Connection endpoint missing');
    if (!ids.get('RelationshipTypes').has(row[12])) errors.push('Connection type missing');
  }
  for (const row of tables.Citations) {
    if (!ids.get(row[0] === 'item' ? 'Items' : 'Connections')?.has(row[1])) errors.push('Citation owner missing');
    if (!row[2] || !ids.get('Sources').has(row[2])) errors.push(`Citation source missing: ${row[2]}`);
  }
  for (const row of tables.PublisherAssertions) if (!ids.get('Connections').has(row[0])) errors.push('Publisher assertion connection missing');
  for (const row of tables.ItemDetails) if (!ids.get('Items').has(row[0])) errors.push('Item detail owner missing');
  return errors;
}
