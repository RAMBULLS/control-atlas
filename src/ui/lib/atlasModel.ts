import { groupRelationships } from "../../app/relationship-groups.mjs";
import type {
  AtlasNeighborhoodEdge,
  AtlasNeighborhoodNode,
  AtlasNeighborhoodRecord,
} from "./runtimeLoader";

export type AtlasFilterState = {
  relationshipType: string;
  provenance: string;
  confidence: string;
  nodeType: string;
  includeCandidates: boolean;
  search: string;
};

export type AtlasRelationshipRow = {
  edge: AtlasNeighborhoodEdge;
  counterpart: AtlasNeighborhoodNode;
  itemId: string;
  title: string;
};

export type AtlasConnectionGroup = {
  id: string;
  label: string;
  description: string;
  placement: "upstream" | "lateral" | "downstream";
  lens: AtlasRelationshipLensId;
  items: AtlasRelationshipRow[];
};

export type AtlasRelationshipLensId =
  | "structure"
  | "applicability"
  | "correlation"
  | "implementation"
  | "assessment-evidence"
  | "process-artifacts"
  | "cross-framework"
  | "threat-defense";

export const ATLAS_RELATIONSHIP_LENSES: Array<{
  id: AtlasRelationshipLensId;
  label: string;
  description: string;
}> = [
  {
    id: "structure",
    label: "Structure",
    description: "Publisher-defined parents and children in this framework.",
  },
  {
    id: "applicability",
    label: "Applicability",
    description: "Baselines, profiles, and overlays that select or modify scope.",
  },
  {
    id: "correlation",
    label: "Correlation",
    description:
      "CCIs and other mapping junctions that connect this record without becoming a parent or an implementation.",
  },
  {
    id: "implementation",
    label: "Implementation and technical requirements",
    description: "SRGs, STIGs, rules, and other published implementation connections.",
  },
  {
    id: "assessment-evidence",
    label: "Assessment and evidence",
    description: "Published assessment procedures and expected evidence connections.",
  },
  {
    id: "process-artifacts",
    label: "Process and artifacts",
    description: "RMF activities, required work products, and supporting artifacts.",
  },
  {
    id: "cross-framework",
    label: "Cross-framework mappings",
    description: "Mappings and overlaps that connect this record to another framework.",
  },
  {
    id: "threat-defense",
    label: "Threat and defensive relationships",
    description: "Threat techniques, mitigations, and defensive countermeasures.",
  },
];

const GROUP_META: Record<
  string,
  {
    placement: AtlasConnectionGroup["placement"];
    lens: AtlasRelationshipLensId;
    rank: number;
  }
> = {
  baseControl: { placement: "upstream", lens: "structure", rank: 0 },
  enhancements: { placement: "downstream", lens: "structure", rank: 1 },
  nistBaseline: { placement: "upstream", lens: "applicability", rank: 2 },
  fedrampBaseline: { placement: "upstream", lens: "applicability", rank: 3 },
  // CCIs are correlation junctions, not implementation children — they may
  // mediate an implementation path but are never the implementation itself.
  disa: { placement: "downstream", lens: "correlation", rank: 4 },
  assessment: { placement: "downstream", lens: "assessment-evidence", rank: 5 },
  stig: { placement: "downstream", lens: "implementation", rank: 6 },
  csf: { placement: "lateral", lens: "cross-framework", rank: 7 },
  sp171: { placement: "lateral", lens: "cross-framework", rank: 8 },
  nistControl: { placement: "lateral", lens: "cross-framework", rank: 9 },
  mitre: { placement: "lateral", lens: "threat-defense", rank: 10 },
  other: { placement: "lateral", lens: "cross-framework", rank: 11 },
};

function counterpartFor(
  record: AtlasNeighborhoodRecord,
  edge: AtlasNeighborhoodEdge,
) {
  const counterpartId =
    edge.source_node_id === record.center_node.id
      ? edge.target_node_id
      : edge.source_node_id;
  return record.nodes.find((node) => node.id === counterpartId) || null;
}

function declaredLensFor(
  items: Array<{ edge: AtlasNeighborhoodEdge }>,
  fallback: AtlasRelationshipLensId,
): AtlasRelationshipLensId {
  const classes = new Set(items.map(({ edge }) => edge.relationship_class));
  if (classes.size === 1 && classes.has("structural")) return "structure";
  if (classes.size === 1 && classes.has("applicability")) return "applicability";
  return fallback;
}

function declaredPlacementFor(
  record: AtlasNeighborhoodRecord,
  items: Array<{ edge: AtlasNeighborhoodEdge }>,
  fallback: AtlasConnectionGroup["placement"],
): AtlasConnectionGroup["placement"] {
  if (!items.length || items.some(({ edge }) => edge.relationship_class === "correlation")) {
    return fallback;
  }
  return items.every(
    ({ edge }) => edge.source_node_id === record.center_node.id,
  )
    ? "downstream"
    : items.every(({ edge }) => edge.target_node_id === record.center_node.id)
      ? "upstream"
      : fallback;
}

export function filterAtlasEdges(
  record: AtlasNeighborhoodRecord,
  filters: AtlasFilterState,
) {
  const needle = filters.search.trim().toLowerCase();
  return record.edges.filter((edge) => {
    if (!filters.includeCandidates && edge.publication_status !== "published") {
      return false;
    }
    if (
      filters.relationshipType &&
      edge.relationship_type !== filters.relationshipType
    ) {
      return false;
    }
    if (filters.provenance && edge.provenance_class !== filters.provenance) {
      return false;
    }
    if (filters.confidence && edge.confidence !== filters.confidence) {
      return false;
    }
    const counterpart = counterpartFor(record, edge);
    if (edge.relationship_class === "structural") {
      const type = counterpart?.node_type;
      if (
        type === "trunk" ||
        type === "limb" ||
        type === "catalog" ||
        type === "group" ||
        type === "family" ||
        type === "policy_directive"
      ) {
        return false;
      }
    }
    if (filters.nodeType && counterpart?.node_type !== filters.nodeType) {
      return false;
    }
    if (!needle) return true;
    const itemId = counterpart?.metadata?.item_id || counterpart?.id || "";
    const title = counterpart?.metadata?.title || counterpart?.label || "";
    return [itemId, title, edge.rationale || "", edge.navigation_note || ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function buildAtlasRows(
  record: AtlasNeighborhoodRecord,
  filters: AtlasFilterState,
): AtlasRelationshipRow[] {
  return filterAtlasEdges(record, filters)
    .map((edge) => {
      const counterpart = counterpartFor(record, edge);
      if (!counterpart) return null;
      return {
        edge,
        counterpart,
        itemId: counterpart.metadata?.item_id || counterpart.id,
        title:
          counterpart.metadata?.title ||
          counterpart.label ||
          counterpart.metadata?.item_id ||
          counterpart.id,
      };
    })
    .filter((row): row is AtlasRelationshipRow => Boolean(row))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

export type AtlasStructuralChild = {
  id: string;
  itemId: string;
  title: string;
  nodeType: string;
};

/**
 * Published structural children of the focused record — the "decomposes into"
 * list on Path. Structural edges are deliberately excluded from Map and List
 * (they are hierarchy, not connections), so Path is the only surface that can
 * show them, and without this it showed nothing but two breadcrumb lines.
 *
 * Never filtered by the connection filters: those scope relationships, and a
 * record's children are not relationships.
 */
export function buildStructuralChildren(
  record: AtlasNeighborhoodRecord,
): AtlasStructuralChild[] {
  const nodeById = new Map(record.nodes.map((node) => [node.id, node]));
  const centerId = record.center_node.id;
  const seen = new Set<string>();
  const children: AtlasStructuralChild[] = [];

  for (const edge of record.edges) {
    if (edge.relationship_class !== "structural") continue;
    if (edge.source_node_id !== centerId) continue;
    if (edge.target_node_id === centerId) continue;
    if (edge.publication_status !== "published") continue;
    if (seen.has(edge.target_node_id)) continue;
    const node = nodeById.get(edge.target_node_id);
    if (!node) continue;
    seen.add(edge.target_node_id);
    children.push({
      id: node.id,
      itemId: node.metadata?.item_id || node.id,
      title: node.metadata?.title || node.label || node.id,
      nodeType: node.node_type || "",
    });
  }

  // Natural order so AC-2(2) precedes AC-2(10) instead of sorting beside AC-2(1).
  return children.sort((left, right) =>
    left.itemId.localeCompare(right.itemId, undefined, { numeric: true }),
  );
}

export function buildAtlasGroups(
  record: AtlasNeighborhoodRecord,
  filters: AtlasFilterState,
): AtlasConnectionGroup[] {
  const nodeById = new Map(record.nodes.map((node) => [node.id, node]));
  const runtime = { getNode: (nodeId: string) => nodeById.get(nodeId) || null };
  const edges = filterAtlasEdges(record, filters);
  const groups = groupRelationships(edges, record.center_node.id, runtime) as Array<{
    id: string;
    label: string;
    description: string;
    items: Array<{ edge: AtlasNeighborhoodEdge; counterpart: AtlasNeighborhoodNode }>;
  }>;

  return groups
    .map((group) => {
      const meta = GROUP_META[group.id] || GROUP_META.other;
      return {
        id: group.id,
        label: group.label,
        description: group.description,
        placement: declaredPlacementFor(record, group.items, meta.placement),
        lens: declaredLensFor(group.items, meta.lens),
        items: group.items
          .map(({ edge, counterpart }) => ({
            edge,
            counterpart,
            itemId: counterpart.metadata?.item_id || counterpart.id,
            title:
              counterpart.metadata?.title ||
              counterpart.label ||
              counterpart.metadata?.item_id ||
              counterpart.id,
          }))
          .sort((left, right) => left.itemId.localeCompare(right.itemId)),
      };
    })
    .sort(
      (left, right) =>
        (GROUP_META[left.id]?.rank ?? 99) -
        (GROUP_META[right.id]?.rank ?? 99),
    );
}

export function atlasFilterOptions(record: AtlasNeighborhoodRecord) {
  const relationshipTypes = new Set<string>();
  const provenanceClasses = new Set<string>();
  const confidenceLevels = new Set<string>();
  const nodeTypes = new Set<string>();

  for (const edge of record.edges) {
    relationshipTypes.add(edge.relationship_type);
    provenanceClasses.add(edge.provenance_class);
    confidenceLevels.add(edge.confidence);
    const counterpart = counterpartFor(record, edge);
    if (counterpart?.node_type) nodeTypes.add(counterpart.node_type);
  }

  return {
    relationshipTypes: [...relationshipTypes].sort(),
    provenanceClasses: [...provenanceClasses].sort(),
    confidenceLevels: [...confidenceLevels].sort(),
    nodeTypes: [...nodeTypes].sort(),
  };
}

export function selectAtlasOverviewGroups(
  groups: AtlasConnectionGroup[],
  limit = 6,
) {
  if (groups.length <= limit) return groups;
  const selected: AtlasConnectionGroup[] = [];
  for (const placement of ["upstream", "lateral", "downstream"] as const) {
    const representative = groups.find(
      (group) => group.placement === placement,
    );
    if (representative) selected.push(representative);
  }
  for (const group of groups) {
    if (selected.length >= limit) break;
    if (!selected.includes(group)) selected.push(group);
  }
  return selected;
}

export function resolveAtlasRelationshipLens(
  groups: AtlasConnectionGroup[],
  requestedStage: string,
): AtlasRelationshipLensId {
  if (
    ATLAS_RELATIONSHIP_LENSES.some((lens) => lens.id === requestedStage)
  ) {
    return requestedStage as AtlasRelationshipLensId;
  }
  return (
    ATLAS_RELATIONSHIP_LENSES.find((lens) =>
      groups.some((group) => group.lens === lens.id && group.items.length > 0),
    )?.id || "structure"
  );
}
