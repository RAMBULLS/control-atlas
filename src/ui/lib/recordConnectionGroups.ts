import type { TitledNode } from './publisherRecordIdentity';

export type RecordConnectionGroup = {
  catalogId: string;
  label: string;
  relationshipType: string;
  items: Array<{
    nodeId: string;
    itemId: string;
    title: string;
    relationshipType: string;
    edgeId: string;
    provenanceClass: string;
    sourceRefs: Array<{
      sourceId: string;
      sourceName: string;
      sourceVersion: string;
      locator: string;
      evidenceQuality: string;
    }>;
  }>;
};

/**
 * Record-page connections are published, cross-catalog correlation links only.
 * Structural parent/child edges and same-publication relationships belong in
 * classification, never in the Connections count.
 */
export function buildRecordConnectionGroups(
  centerNodeId: string,
  centerCatalogId: string,
  edges: Array<{
    id?: string;
    source_node_id: string;
    target_node_id: string;
    relationship_type?: string;
    relationship_class?: string;
    publication_status?: string;
    provenance_class?: string;
    source_refs?: Array<{
      source_id?: string;
      source_name?: string;
      source_version?: string;
      locator?: string;
      evidence_quality?: string;
    }>;
  }>,
  getNode: (id: string) => TitledNode | null | undefined,
  catalogLabel: (catalogId: string) => string | null | undefined,
): RecordConnectionGroup[] {
  const groups = new Map<string, RecordConnectionGroup>();
  for (const [edgeIndex, edge] of edges.entries()) {
    if (edge.publication_status !== "published") continue;
    if (edge.relationship_class !== "correlation") continue;
    const counterpartId =
      edge.source_node_id === centerNodeId
        ? edge.target_node_id
        : edge.target_node_id === centerNodeId
          ? edge.source_node_id
          : null;
    if (!counterpartId) continue;
    const counterpart = getNode(counterpartId);
    const catalogId = counterpart?.metadata?.catalog_id?.trim();
    const itemId = counterpart?.metadata?.item_id?.trim();
    const title = counterpart?.metadata?.title?.trim();
    const groupLabel = catalogId ? catalogLabel(catalogId)?.trim() : "";
    const relationshipType = edge.relationship_type?.trim();
    const provenanceClass = edge.provenance_class?.trim();
    if (
      !counterpart ||
      !catalogId ||
      catalogId === centerCatalogId ||
      !itemId ||
      !title ||
      !groupLabel ||
      !relationshipType ||
      !provenanceClass
    ) continue;
    const groupId = `${catalogId}:${relationshipType}`;
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        catalogId,
        label: groupLabel,
        relationshipType,
        items: [],
      });
    }
    groups.get(groupId)!.items.push({
      nodeId: counterpartId,
      itemId,
      title,
      relationshipType,
      edgeId: edge.id || `${centerNodeId}:${counterpartId}:${relationshipType}:${edgeIndex}`,
      provenanceClass,
      sourceRefs: (edge.source_refs || [])
        .map((reference) => ({
          sourceId: reference.source_id?.trim() || "",
          sourceName: reference.source_name?.trim() || "",
          sourceVersion: reference.source_version?.trim() || "",
          locator: reference.locator?.trim() || "",
          evidenceQuality: reference.evidence_quality?.trim() || "",
        }))
        .filter((reference) => reference.sourceId || reference.sourceName),
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.itemId.localeCompare(b.itemId)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.relationshipType.localeCompare(b.relationshipType));
}
