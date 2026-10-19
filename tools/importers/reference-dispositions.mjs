const sourceKey = (row) => row.source_fragments?.find((fragment) => fragment.source_key)?.source_key;
const rowNumber = (row) => Number(row.locator?.match(/[&?]row=(\d+)/)?.[1]);
const sameContext = (a, b) => ['mapping_kind', 'collaborator', 'architecture_component', 'component_function', 'product', 'target_id'].every((key) => a[key] === b[key]) && sourceKey(a) === sourceKey(b);

/** An explicit "already listed" note is a reference, not a fresh predicate.
 * All referenced directions remain on the earlier explicit assertions. In
 * particular, two opposing earlier assertions must never be reduced to one.
 */
export function resolveRedundantPublisherReference(row, mappings) {
  if (row.relationship_parse_status !== 'unresolved' || !/\b(already listed|same as previous row)\b/i.test(row.relationship)) return null;
  const previous = /same as previous row/i.test(row.relationship);
  const matches = mappings.filter((candidate) => candidate.relationship_parse_status === 'explicit' && sameContext(row, candidate)
    && rowNumber(candidate) < rowNumber(row) && (!previous || rowNumber(candidate) === rowNumber(row) - 1));
  if (!matches.length) return null;
  return {
    status: 'redundant_publisher_reference',
    reason: 'The publisher explicitly references already-listed mapping content. This row supplies no new predicate; the earlier native assertions retain their own directions and properties.',
    mapping_ids: matches.map((candidate) => candidate.id),
    source_locators: [row.locator, ...matches.map((candidate) => candidate.locator)],
  };
}

export function rejectInvalidPublisherIdentifier(mapping, officialIds, inventoryEvidence) {
  if (mapping.target_catalog !== 'nist-csf-1.1' || mapping.target_id !== 'PT.PT-1' || officialIds.has(mapping.target_id)) return null;
  if (!/^sha256:[a-f0-9]{64}$/.test(inventoryEvidence?.source_sha256 || '') || !inventoryEvidence?.record_ids?.length
    || inventoryEvidence.record_ids.length !== officialIds.size || inventoryEvidence.record_ids.some((id) => !officialIds.has(id))) throw new Error('Invalid-target disposition requires a complete attested official identifier inventory');
  return {
    status: 'rejected_invalid_publisher_identifier',
    reason: `The publisher cites ${mapping.target_id}, which is absent from the complete official CSF 1.1 identifier inventory. No replacement identifier or relationship is inferred.`,
    source_locator: mapping.source_locator,
    inventory_source: inventoryEvidence.source_url,
    inventory_source_sha256: inventoryEvidence.source_sha256,
  };
}
