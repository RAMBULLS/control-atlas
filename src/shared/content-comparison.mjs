import { NON_RECORD_NODE_TYPES, recordPresentationContract } from './record-presentation.mjs';
import { RETIRED_RECORD_TYPES } from './record-acceptance.mjs';

export function isComparisonRecord(node) {
  return Boolean(node.metadata?.catalog_id && node.metadata?.item_id) &&
    !NON_RECORD_NODE_TYPES.has(node.node_type) && !RETIRED_RECORD_TYPES.has(node.node_type) &&
    node.metadata?.structural_group !== true;
}

export function hasComparisonValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== 'object' || Object.keys(value).length > 0;
}

/** Same publisher fields used by record pages; never compare editorial notes. */
export function comparisonFields(node) {
  const contract = recordPresentationContract(node.metadata.catalog_id, node.node_type);
  return [...new Set(['title', ...contract.sections.map((entry) => entry.field), ...contract.metadata_facts])]
    .filter((field) => contract.field_dispositions[field]?.origin === 'publisher');
}

export function projectComparisonRecord(node) {
  const metadata = node.metadata;
  const fields = [...comparisonFields(node), 'catalog_id', 'item_id', 'publisher_item_id', 'family',
    'source_locator', 'field_absence_reasons', 'publisher_status', 'citations', 'source_text_presentation'];
  return { id: node.id, node_type: node.node_type, label: node.label, source_id: node.source_id,
    publication_source_id: node.publication_source_id, artifact_ids: node.artifact_ids,
    source_refs: node.source_refs,
    metadata: Object.fromEntries([...new Set(fields)].filter((field) => metadata[field] != null)
      .map((field) => [field, metadata[field]])) };
}

const canonical = (value) => JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
export const contentIdentity = (node) => `${node.node_type}|${node.metadata.publisher_item_id || node.metadata.item_id}`;

export function compareRecordContent(a, b) {
  const fields = [...new Set([...comparisonFields(a), ...comparisonFields(b)])];
  const changed = fields.filter((field) => canonical(a.metadata[field] ?? null) !== canonical(b.metadata[field] ?? null));
  const missing = [a, b].some((node) => {
    const contract = recordPresentationContract(node.metadata.catalog_id, node.node_type);
    const primary = contract.sections.filter((entry) => entry.disposition === 'rendered_primary');
    return !primary.length || primary.some((entry) => !hasComparisonValue(node.metadata[entry.field])) ||
      contract.required_fields.some((field) => !hasComparisonValue(node.metadata[field]));
  });
  return { group: missing ? 'unavailable' : changed.length ? 'different' : 'shared', changed };
}

/** Identifier alignment is literal, never a crosswalk or semantic continuity. */
export function buildContentRows(a, b, selectedA = '', selectedB = '') {
  if (selectedA || selectedB) {
    const left = a.find((node) => node.id === selectedA), right = b.find((node) => node.id === selectedB);
    return left && right ? [{ id: `${left.id}|${right.id}`, a: left, b: right, ...compareRecordContent(left, right), alignment: 'Explicit record selection' }] : [];
  }
  const byKey = (nodes) => {
    const map = new Map();
    for (const node of nodes) { const key = contentIdentity(node); map.set(key, [...(map.get(key) || []), node]); }
    return map;
  };
  const left = byKey(a), right = byKey(b);
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((key) => {
    const aa = left.get(key) || [], bb = right.get(key) || [];
    if (aa.length === 1 && bb.length === 1) return [{ id: `${aa[0].id}|${bb[0].id}`, a: aa[0], b: bb[0], ...compareRecordContent(aa[0], bb[0]), alignment: 'Same record type and publisher identifier; semantic continuity not established' }];
    const ambiguous = aa.length > 1 || bb.length > 1;
    return [...aa.map((node) => ({ id: `a:${node.id}`, a: node, b: null, group: ambiguous ? 'unavailable' : 'only_a', changed: [], alignment: ambiguous ? 'Repeated identifier; select exact records to compare' : 'Identifier only in A' })),
      ...bb.map((node) => ({ id: `b:${node.id}`, a: null, b: node, group: ambiguous ? 'unavailable' : 'only_b', changed: [], alignment: ambiguous ? 'Repeated identifier; select exact records to compare' : 'Identifier only in B' }))];
  });
}

/** Complete membership is assessed before display filters, across all pair sources. */
export function buildMappingInventoryRows(a, b, mappings) {
  const left = new Map(a.map((node) => [node.id, node])), right = new Map(b.map((node) => [node.id, node]));
  const mappedA = new Set(), mappedB = new Set();
  const rows = mappings.flatMap((mapping) => {
    const aa = left.get(mapping.from_id), bb = right.get(mapping.to_id);
    if (!aa || !bb) return [];
    mappedA.add(aa.id); mappedB.add(bb.id);
    return [{ id: mapping.edge_id, a: aa, b: bb, group: 'mapped', changed: [],
      alignment: mapping.relationship_type, source_refs: mapping.source_refs, mapping }];
  });
  return [...rows,
    ...a.filter((node) => !mappedA.has(node.id)).map((node) => ({ id: `a:${node.id}`, a: node, b: null, group: 'only_a', changed: [], alignment: 'No published mapping to a public record in the other inventory' })),
    ...b.filter((node) => !mappedB.has(node.id)).map((node) => ({ id: `b:${node.id}`, a: null, b: node, group: 'only_b', changed: [], alignment: 'No published mapping to a public record in the other inventory' }))];
}

export function filterContentRows(rows, group, query) {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((row) => (!group || row.group === group) && (!needle || [row.a, row.b].some((node) => node &&
    [node.metadata.item_id, node.metadata.publisher_item_id, node.metadata.title].some((value) => String(value || '').toLocaleLowerCase().includes(needle)))));
}
