import { csvRow } from '../../src/shared/csv.mjs';
import { connectionEvidenceIdsForEdge } from '../../src/shared/data-trust-contracts.mjs';

export { csvRow };
export const ITEM_COLUMNS = Object.freeze([
  ['AtlasItemId', 'Existing canonical Atlas node or Resource ID; import as Text.'],
  ['ItemKind', 'graph_node or resource; preserves the two existing reference collections.'],
  ['PublisherId', 'Existing publisher organization ID where recorded; blank when unavailable.'],
  ['PublisherItemId', 'Native publisher identifier, separate from Atlas identity.'],
  ['CatalogId', 'Canonical catalog identity; blank for a standalone Resource.'],
  ['PublicationId', 'Canonical defining publication/source identity.'],
  ['Edition', 'Recorded benchmark edition or defining publication version; blank means unavailable.'],
  ['NativeRecordType', 'Publisher-native record type where recorded, otherwise canonical node/resource type.'],
  ['Title', 'Captured title from the canonical item.'],
  ['CapturedText', 'Captured primary description; other captured fields remain in JSON.'],
  ['LifecycleStatus', 'Recorded item lifecycle, including superseded, draft, retired or active.'],
  ['Origin', 'Recorded publisher-normalized, publisher-derived, editorial or inferred origin.'],
  ['SourceId', 'Defining source ID; no new identity is generated.'],
  ['OfficialUrl', 'Recorded official catalog/document URL; evidence locators are separate.'],
  ['SourceLocator', 'Recorded page, sheet, row, section or other evidence locator.'],
  ['ParentIdsJson', 'Only canonical structural parents; baselines, mappings and editorial links are excluded.'],
  ['SourceReferencesJson', 'Original source references with their native shape.'],
  ['SourcesJson', 'Complete defining and cited source metadata resolved from canonical sources.'],
  ['CapturedContentJson', 'Complete canonical item metadata, or Resource captured fields.'],
  ['SupportingReferencesJson', 'Original normalized source record and Resource collections/evidence when applicable.'],
  ['WarningsJson', 'Recorded warnings; no warning is inferred.'],
  ['CanonicalRecordJson', 'Complete canonical input item. Preserves missing/null distinctions and nested fields.'],
]);
export const CONNECTION_COLUMNS = Object.freeze([
  ['AtlasConnectionId', 'Existing canonical connection ID; one row per ID.'],
  ['SourceAtlasItemId', 'Native source endpoint; joins to AtlasItemId.'],
  ['TargetAtlasItemId', 'Native target endpoint; joins to AtlasItemId.'],
  ['RelationshipType', 'Stored native predicate, with no display inversion or multi-hop expansion.'],
  ['RelationshipClass', 'structural, applicability, correlation or organizing.'],
  ['AssertionClass', 'Stored structural, published_mapping, publisher_derived, atlas_navigation or atlas_inferred class.'],
  ['Direction', 'Canonical source-to-target endpoint order; explicit directionality is retained when present.'],
  ['PublicationStatus', 'Stored published, candidate or editorial status; not a claim that the source edition is final.'],
  ['LifecycleStatus', 'Recorded relationship status.'],
  ['AuthorityClass', 'Recorded authority of the assertion.'],
  ['ProvenanceClass', 'Recorded publication or inference provenance.'],
  ['Confidence', 'Exact stored confidence value; no numeric score is invented.'],
  ['MappingModel', 'Recorded model, distinct from hierarchy and applicability.'],
  ['RawRelationshipType', 'Publisher relationship text/type where stored; canonical type when the redundant field was compacted.'],
  ['Rationale', 'Complete stored rationale.'],
  ['Warning', 'Stored warning, including inference warnings.'],
  ['InferenceRuleId', 'Recorded rule ID for candidate/inferred relationships.'],
  ['SourceArtifactId', 'Recorded supporting artifact ID.'],
  ['SourceLocator', 'Native relationship evidence locator.'],
  ['SourceReferencesJson', 'All citations together, without duplicating the connection row.'],
  ['PublisherAssertionsJson', 'All publisher clauses, qualifiers and mapping-row IDs, including compound assertions.'],
  ['EvidenceJson', 'Complete referenced publication-provenance evidence records.'],
  ['SourcesJson', 'Complete source metadata for defining and cited publication/artifact identities.'],
  ['CanonicalRecordJson', 'Complete canonical input connection.'],
]);
const json = (value) => JSON.stringify(value ?? null);
const unique = (items) => [...new Set(items.filter(Boolean))];
export function resolvedSources(ids, references, sourceById) {
  return unique([...ids, ...(references || []).map((ref) => typeof ref === 'string' ? ref.split('#')[0] : ref.source_id)])
    .map((id) => sourceById.get(id)).filter(Boolean);
}
export function referenceItemRow(item, context, kind = 'graph_node') {
  const metadata = item.metadata || {};
  const source = context.sourceById.get(item.source_id) || {};
  const refs = kind === 'resource' ? item.sourceRefs || item.sourceEvidence || [] : item.source_refs || [];
  const sources = resolvedSources([item.source_id, item.publication_source_id, item.source_material_id, ...(item.artifact_ids || [])], refs, context.sourceById);
  const supporting = kind === 'resource' ? {
    collections: context.collections.filter((collection) => collection.resourceIds?.includes(item.id)),
    evidence: context.resourceEvidence.filter((evidence) => (item.sourceRefs || []).includes(evidence.id) || (item.claimEvidence || []).some((claim) => claim.evidenceRefs?.includes(evidence.id))),
  } : context.originalById.get(item.id) || null;
  return [item.id, kind, item.publisher_id || source.publisher_id || '', metadata.publisher_item_id || metadata.item_id || '',
    metadata.catalog_id || '', metadata.publication_id || item.publication_source_id || item.source_id || '',
    metadata.benchmark_version || source.version || '', metadata.native_type || metadata.type || item.node_type || item.resourceType || '',
    metadata.title || item.name || item.title || item.label || '', metadata.description || item.summary || '',
    item.lifecycle_status || item.lifecycle?.status || '', metadata.origin || item.origin || '', item.source_id || '',
    item.canonicalUrl || source.catalog_browse_url || source.artifact_url || '', metadata.source_locator || '',
    json(unique(context.parents.get(item.id) || [])), json(refs), json(sources), json(kind === 'resource' ? item : metadata), json(supporting),
    json(item.warnings || metadata.warnings || metadata.source_warnings || []), json(item)];
}
export function referenceConnectionRow(edge, context) {
  const evidenceIds = connectionEvidenceIdsForEdge(edge);
  const evidence = evidenceIds.map((id) => {
    const entry = context.evidenceById.get(id);
    if (!entry) throw new Error(`${edge.id}: missing publication evidence ${id}`);
    return entry;
  });
  return [edge.id, edge.source_node_id, edge.target_node_id, edge.relationship_type, edge.relationship_class,
    edge.assertion_class || '', edge.directionality || 'directed', edge.publication_status, edge.status || '', edge.authority_class || '',
    edge.provenance_class, edge.confidence, edge.mapping_model || '', edge.raw_relationship_type || edge.relationship_type,
    edge.rationale || '', edge.warning || '', edge.inference_rule_id || '', edge.source_artifact_id || '', edge.source_locator || '',
    json(edge.source_refs || []), json(edge.publisher_assertions || []), json(evidence),
    json(resolvedSources([edge.source_artifact_id, ...evidence.map((entry) => entry.source_id)], edge.source_refs, context.sourceById)), json(edge)];
}
export function validateReferenceIdentity(nodes, edges, resources = []) {
  const errors = []; const itemIds = new Set(); const edgeIds = new Set();
  for (const item of [...nodes, ...resources]) {
    if (typeof item.id !== 'string' || !item.id) errors.push('Missing string item ID');
    else if (itemIds.has(item.id)) errors.push(`Duplicate item ID: ${item.id}`);
    itemIds.add(item.id);
  }
  for (const edge of edges) {
    if (typeof edge.id !== 'string' || !edge.id) errors.push('Missing string connection ID');
    else if (edgeIds.has(edge.id)) errors.push(`Duplicate connection ID: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!itemIds.has(edge.source_node_id) || !itemIds.has(edge.target_node_id)) errors.push(`Unknown endpoint: ${edge.id}`);
    if (edge.publication_status === 'published' && (edge.provenance_class === 'inferred' || edge.confidence?.startsWith('inferred_'))) errors.push(`Promoted inference: ${edge.id}`);
    if ((edge.assertion_class === 'atlas_navigation' || edge.authority_class === 'atlas_editorial') && edge.publication_status !== 'editorial') errors.push(`Promoted editorial connection: ${edge.id}`);
  }
  return errors;
}
