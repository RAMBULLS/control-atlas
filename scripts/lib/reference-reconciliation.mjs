import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeProfileToken } from '../../src/shared/entity-profiles.mjs';
import { resolveRedundantPublisherReference, rejectInvalidPublisherIdentifier } from '../../tools/importers/reference-dispositions.mjs';

const key = (from, to, type) => JSON.stringify([from, to, normalizeProfileToken(type)]);
const normalizeControl = (id) => String(id).replace(/^([A-Z]{2,3})-0*(\d+)(?:\(0*(\d+)\)|\.0*(\d+))?$/, (_, family, base, a, b) => `${family}-${base}${a || b ? `.${a || b}` : ''}`);

/** Reconcile retained source assertions to native graph endpoints, predicates and citations. */
export function reconcileReferenceRelationships(root, graph, contracts) {
  const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIndex = new Map();
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  for (const edge of graph.edges) {
    const signature = key(edge.source_node_id, edge.target_node_id, edge.relationship_type);
    const matches = edgeIndex.get(signature) || []; matches.push(edge); edgeIndex.set(signature, matches);
  }
  const rows = []; const catalogRows = []; const errors = [];
  const record = (row) => { rows.push(row); if (row.status === 'missing') errors.push(`${row.input}: ${row.reason}`); };
  const check = ({ input, source, target, predicate, locators = [], sourceId, expectedId }) => {
    const candidates = expectedId ? [edgesById.get(expectedId)].filter(Boolean) : (edgeIndex.get(key(source, target, predicate)) || []);
    const matches = candidates.filter((edge) => edge.source_node_id === source && edge.target_node_id === target
      && edge.relationship_type === normalizeProfileToken(predicate)
      && locators.every((locator) => edge.source_refs?.some((ref) => ref.locator === locator && (!sourceId || ref.source_id === sourceId))));
    record({ input, source_node_id: source, target_node_id: target, predicate: normalizeProfileToken(predicate), source_id: sourceId || null,
      status: matches.length ? 'represented' : 'missing', connection_ids: matches.map((edge) => edge.id),
      ...(!matches.length ? { reason: !nodeIds.has(source) || !nodeIds.has(target) ? 'Canonical endpoint missing' : 'Native predicate, connection or source citation missing' } : {}),
    });
  };
  for (const [file, catalogId] of contracts.catalogs) {
    const document = read(`data/${file}`);
    let represented = 0;
    for (const item of document.records || []) {
      const source = `${catalogId}:${item.id}`;
      if (nodeIds.has(source)) represented += 1; else errors.push(`${file}#${item.id}: canonical item missing`);
      for (const [index, relationship] of (item.metadata?.relationships || []).entries()) {
        check({ input: `data/${file}#${item.id}/relationships/${index}`, source, target: `${relationship.target_catalog}:${relationship.target_id}`,
          predicate: relationship.relationship_type || 'references', locators: relationship.source_locators || (relationship.source_locator ? [relationship.source_locator] : []), sourceId: relationship.source_id });
      }
      for (const unresolved of item.metadata?.unresolved_mappings || []) {
        if (!unresolved.reason || !unresolved.target_catalog) continue; // NIST Zero Trust shorthand is reconciled against original workbook rows below.
        const matchingSource = (item.metadata?.publisher_mappings || []).some((mapping) => mapping.target_catalog === unresolved.target_catalog && mapping.target_id === unresolved.target_id && mapping.source_locator === unresolved.source_locator);
        if (!matchingSource) errors.push(`${file}#${item.id}: unresolved disposition has no matching publisher assertion`);
        const matches = edgeIndex.get(key(source, `${unresolved.target_catalog}:${unresolved.target_id}`, unresolved.relationship_type)) || [];
        if (matches.length) errors.push(`${file}#${item.id}: unresolved publisher assertion created a connection`);
        let status = 'unresolved';
        if (unresolved.source_disposition?.status === 'rejected_invalid_publisher_identifier') {
          const manifest = read('data/curated/reference-catalogs/source-manifest.json');
          const source = manifest.sources.find((entry) => entry.id === 'nist-csf-1.1');
          const expected = rejectInvalidPublisherIdentifier(unresolved, new Set(manifest.catalogs.csf11.record_ids), { source_url: source.url, source_sha256: source.sha256, record_ids: manifest.catalogs.csf11.record_ids });
          if (!expected || JSON.stringify(expected) !== JSON.stringify(unresolved.source_disposition)) errors.push(`${file}#${item.id}: invalid publisher rejection evidence`);
          else status = 'rejected_invalid_publisher_identifier';
        }
        record({ input: `data/${file}#${item.id}/unresolved/${unresolved.target_id}`, status, reason: unresolved.source_disposition?.reason || unresolved.reason, locator: unresolved.source_locator, connection_ids: [] });
      }
    }
    catalogRows.push({ catalog_id: catalogId, source_file: `data/${file}`, source_records: document.records.length, represented_records: represented });
  }
  const endpoint = (catalog, id) => {
    if (String(id).startsWith(`${catalog}:`)) return String(id);
    if (nodeIds.has(`${catalog}:${id}`)) return `${catalog}:${id}`;
    const native = normalizeControl(id); const direct = `${catalog}:${native}`;
    if (nodeIds.has(direct)) return direct;
    if (catalog === 'nist-800-53' && /^[A-Z]{2}$/.test(native)) return `${catalog}:FAMILY-${native}`;
    if (catalog === 'csf-2' && /^[A-Z]{2}\.[A-Z]{2}$/.test(native)) return `${catalog}:CATEGORY-${native}`;
    return direct;
  };
  for (const [file, sourceCatalog, targetCatalog, defaultSourceId] of contracts.maps) {
    if (!existsSync(join(root, 'maps', file))) continue;
    const document = read(`maps/${file}`);
    for (const [index, relationship] of (document.relationships || []).entries()) {
      check({ input: `maps/${file}#${index + 1}`, source: endpoint(relationship.source_catalog || sourceCatalog, relationship.source_id),
        target: endpoint(relationship.target_catalog || targetCatalog, relationship.target_id), predicate: relationship.relationship_type || 'maps_to',
        sourceId: relationship.evidence_source || document.source_key || defaultSourceId,
        locators: relationship.source_locators || (relationship.source_locator ? [relationship.source_locator] : []), expectedId: relationship.atlas_connection_id || `edge:${file.replace('.json', '')}:${index + 1}` });
    }
  }
  // Compare original workbook rows, not only the normalizer's own output.
  const rawMappings = read('data/curated/nist-zt/mappings.json').records;
  const assertions = new Map();
  for (const edge of graph.edges) for (const assertion of edge.publisher_assertions || []) {
    const list = assertions.get(assertion.mapping_id) || []; list.push({ edge, assertion }); assertions.set(assertion.mapping_id, list);
  }
  const rawSummary = {};
  for (const mapping of rawMappings) {
    const state = rawSummary[mapping.mapping_kind] ||= { source_rows: 0, represented_rows: 0, reference_rows: 0, unresolved_rows: 0 };
    state.source_rows += 1;
    const matches = assertions.get(mapping.id) || [];
    if (mapping.relationship_parse_status === 'unresolved') {
      if (matches.length) errors.push(`${mapping.id}: unresolved publisher shorthand created a graph assertion`);
      const expected = resolveRedundantPublisherReference(mapping, rawMappings);
      const normalized = graph.nodes.flatMap((node) => node.metadata?.unresolved_mappings || []).find((row) => row.id === mapping.id);
      const references = expected?.mapping_ids.flatMap((id) => assertions.get(id) || []) || [];
      const proven = expected && JSON.stringify(mapping.source_disposition) === JSON.stringify(expected)
        && JSON.stringify(normalized?.source_disposition) === JSON.stringify(expected)
        && expected.mapping_ids.every((id) => assertions.get(id)?.length);
      if (proven) state.reference_rows += 1;
      else { state.unresolved_rows += 1; errors.push(`${mapping.id}: publisher shorthand lacks a proven canonical disposition`); }
      record({ input: `data/curated/nist-zt/mappings.json#${mapping.id}`, status: proven ? 'redundant_publisher_reference' : 'unresolved', reason: proven ? expected.reason : 'Publisher cell has no explicit resolved predicate or validated reference disposition.', locator: mapping.locator, connection_ids: [...new Set(references.map(({ edge }) => edge.id))] });
    } else {
      const missingClauses = (mapping.relationship_clauses || []).filter((clause) => !matches.some(({ edge, assertion }) =>
        edge.relationship_type === clause.relationship_type && assertion.property === clause.property && assertion.locator === mapping.locator));
      if (!matches.length || missingClauses.length) errors.push(`${mapping.id}: explicit publisher clause missing from graph`);
      else state.represented_rows += 1;
    }
  }
  const retainedSnapshots = existsSync(join(root, 'maps/olir')) ? readdirSync(join(root, 'maps/olir')).filter((file) => file.endsWith('.json')).sort().map((file) => {
    const document = read(`maps/olir/${file}`);
    return { path: `maps/olir/${file}`, source_id: document.source_key || document.id || null,
      retained_rows: document.relationships?.length ?? document.records?.length ?? null,
      disposition: 'Supporting OLIR retrieval snapshot; not an additional canonical connection collection. No Atlas connection IDs are assigned by this snapshot.' };
  }) : [];
  const iotPath = 'data/curated/nist-structured-catalogs/iot-requirements.json';
  const iotSummary = { source_assertions: 0, represented_assertions: 0, rejected_assertions: 0, unresolved_assertions: 0 };
  if (existsSync(join(root, iotPath))) {
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const item of read(iotPath).records) for (const [index, mapping] of (item.publisher_mappings || []).entries()) {
      iotSummary.source_assertions += 1;
      const source = `nist-iot-cybersecurity:${item.id}`;
      const unresolved = nodeById.get(source)?.metadata?.unresolved_mappings?.find((entry) => entry.target_catalog === mapping.target_catalog && entry.target_id === mapping.target_id && entry.source_locator === mapping.source_locator && entry.reason);
      if (unresolved) {
        if (unresolved.source_disposition?.status === 'rejected_invalid_publisher_identifier') iotSummary.rejected_assertions += 1;
        else iotSummary.unresolved_assertions += 1;
        continue;
      }
      const before = errors.length;
      check({ input: `${iotPath}#${item.id}/publisher_mappings/${index}`, source, target: `${mapping.target_catalog}:${mapping.target_id}`, predicate: mapping.relationship_type,
        sourceId: mapping.source_id, locators: [mapping.source_locator] });
      if (errors.length === before) iotSummary.represented_assertions += 1;
    }
  }
  return { schema_version: '1.0', status: errors.length ? 'FAILED' : 'PASSED',
    counts: { catalog_records: catalogRows.reduce((n, row) => n + row.source_records, 0), asserted_relationship_rows: rows.filter((row) => ['represented', 'missing'].includes(row.status)).length,
      represented_relationship_rows: rows.filter((row) => row.status === 'represented').length, unresolved_source_rows: rows.filter((row) => row.status === 'unresolved').length,
      redundant_publisher_references: rows.filter((row) => row.status === 'redundant_publisher_reference').length,
      rejected_publisher_identifiers: rows.filter((row) => row.status === 'rejected_invalid_publisher_identifier').length, errors: errors.length },
    catalogs: catalogRows, zero_trust_workbooks: rawSummary, iot_workbooks: iotSummary, supporting_snapshots: retainedSnapshots, rows, errors };
}
