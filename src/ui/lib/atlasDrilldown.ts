import { usesScaffoldStableId } from "./recordTitle";

export const NIST_FRAMEWORK_ID = "nist-800-53";
export const NIST_FRAMEWORK_LABEL = "NIST SP 800-53";
export const NIST_BASELINE_IDS = [
  "nist-800-53b:LOW",
  "nist-800-53b:MODERATE",
  "nist-800-53b:HIGH",
] as const;
export const RMF_STEP_IDS = [
  "nist-800-37:RMF-PREPARE",
  "nist-800-37:RMF-CATEGORIZE",
  "nist-800-37:RMF-SELECT",
  "nist-800-37:RMF-IMPLEMENT",
  "nist-800-37:RMF-ASSESS",
  "nist-800-37:RMF-AUTHORIZE",
  "nist-800-37:RMF-MONITOR",
] as const;

export type AtlasDrillNode = {
  id: string;
  node_type?: string;
  label?: string;
  parent_id?: string;
  ancestor_path?: Array<{ id: string }>;
  metadata?: {
    catalog_id?: string;
    item_id?: string;
    title?: string;
    description?: string;
    family?: string;
  };
};

export type AtlasDrillEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  relationship_class: string;
  publication_status: string;
};

export type AtlasSpineEntry = {
  id: string;
  node_type: string;
  label: string;
  blurb: string;
  parent_id: string | null;
  child_count: number;
  descendant_record_count: number;
  mandate?:
    | "statutory"
    | "contractual"
    | "federal_policy_or_regulatory_mandate"
    | "issued_without_federal_mandate";
  primary_authority?: string | null;
  also_required_by?: string[];
  publication_type?: string;
  mandate_note?: string;
  area_id?: string;
  source_refs?: Array<{
    source_id?: string;
    ref_type?: string;
    locator?: string;
  }>;
  rationale?: string;
  grouping_key?: string;
};

export type AtlasSpine = {
  entries: AtlasSpineEntry[];
};

export type AtlasRecordChoice = {
  id: string;
  itemId: string;
  label: string;
  description: string;
  nodeType: string;
};

export type AtlasFamilyChoice = AtlasRecordChoice & {
  records: AtlasRecordChoice[];
};

export type AtlasBaselineChoice = AtlasRecordChoice & {
  families: AtlasFamilyChoice[];
  recordCount: number;
};

export type AtlasRmfResult = AtlasRecordChoice & {
  relationshipType: string;
};

export type AtlasRmfStepChoice = AtlasRecordChoice & {
  results: AtlasRmfResult[];
};

export type AtlasFrameworkChoice = AtlasRecordChoice & {
  groupId: string;
  units: AtlasFamilyChoice[];
};

export type AtlasFrameworkGroup = {
  id: string;
  label: string;
  description: string;
  frameworks: AtlasFrameworkChoice[];
};

export type AtlasDrilldownModel = {
  baselines: AtlasBaselineChoice[];
  rmfSteps: AtlasRmfStepChoice[];
  frameworkGroups: AtlasFrameworkGroup[];
};

export type AtlasStructuralRowIdentity = {
  primary: string;
  secondary: string;
  accessibleName: string;
  usesPublisherLabel: boolean;
};

/** Use the initial projection for human identity while preserving stable route IDs. */
export function atlasStructuralRowIdentity(
  node: Pick<AtlasRecordChoice, "itemId" | "label" | "nodeType">,
  projectedLabel = "",
): AtlasStructuralRowIdentity {
  const usesPublisherLabel = usesScaffoldStableId(node.nodeType, node.itemId);
  const primary = usesPublisherLabel
    ? projectedLabel.trim() || node.label.trim() || node.itemId.trim()
    : node.itemId.trim() || projectedLabel.trim() || node.label.trim();
  const secondary = usesPublisherLabel || node.label.trim() === primary
    ? ""
    : node.label.trim();
  return {
    primary,
    secondary,
    accessibleName: [primary, secondary].filter(Boolean).join(" \u2014 "),
    usesPublisherLabel,
  };
}

function spineItemId(entry: AtlasSpineEntry) {
  if (entry.node_type === "catalog" && entry.id.endsWith(":CATALOG")) {
    return entry.id.slice(0, -":CATALOG".length);
  }
  const separator = entry.id.indexOf(":");
  return separator >= 0 ? entry.id.slice(separator + 1) : entry.id;
}

function spineUnit(entry: AtlasSpineEntry): AtlasFamilyChoice {
  return {
    id: entry.id,
    itemId: spineItemId(entry),
    label: entry.label,
    description: entry.blurb,
    nodeType: entry.node_type,
    records: [],
  };
}

export function buildAtlasBootstrapModel(spine: AtlasSpine): AtlasDrilldownModel {
  if (!Array.isArray(spine?.entries) || spine.entries.length === 0) {
    throw new Error("Atlas spine artifact has no entries.");
  }

  const entriesByParent = new Map<string, AtlasSpineEntry[]>();
  for (const entry of spine.entries) {
    if (!entry.parent_id) continue;
    const children = entriesByParent.get(entry.parent_id) || [];
    children.push(entry);
    entriesByParent.set(entry.parent_id, children);
  }
  const limbs = spine.entries.filter((entry) => entry.node_type === "limb");
  const catalogs = spine.entries.filter((entry) => entry.node_type === "catalog");

  return {
    baselines: [],
    rmfSteps: [],
    frameworkGroups: limbs.map((limb) => ({
      id: limb.id,
      label: limb.label,
      description: limb.blurb,
      frameworks: catalogs
        .filter((catalog) => catalog.area_id === limb.id)
        .map((catalog) => {
          const catalogId = spineItemId(catalog);
          return {
            id: catalogId,
            itemId: catalogId,
            label: catalog.label,
            description: catalog.blurb,
            nodeType: "catalog",
            groupId: limb.id,
            units: (entriesByParent.get(catalog.id) || []).map(spineUnit),
          };
        }),
    })),
  };
}

export function hydrateAtlasFrameworkRecords(
  model: AtlasDrilldownModel,
  nodes: AtlasDrillNode[],
): AtlasDrilldownModel {
  const directParentId = (node: AtlasDrillNode) =>
    node.ancestor_path?.at(-1)?.id || node.parent_id || "";
  const choicesByParent = new Map<string, AtlasRecordChoice[]>();
  for (const node of nodes) {
    const parentId = directParentId(node);
    if (!parentId) continue;
    const choices = choicesByParent.get(parentId) || [];
    choices.push(toChoice(node));
    choicesByParent.set(parentId, choices);
  }
  return {
    ...model,
    frameworkGroups: model.frameworkGroups.map((group) => ({
      ...group,
      frameworks: group.frameworks.map((framework) => ({
        ...framework,
        units: framework.units.map((unit) => {
          const records = unit.id.startsWith(`membership:${framework.id}:`)
            ? nodes
                .filter(
                  (node) =>
                    node.node_type !== "catalog" &&
                    node.metadata?.catalog_id === framework.id &&
                    (node.metadata?.family || "All records") === unit.label,
                )
                .map(toChoice)
            : choicesByParent.get(unit.id) || [];
          return {
            ...unit,
            records: records.sort(byItemId),
          };
        }),
      })),
    })),
  };
}

function toChoice(node: AtlasDrillNode): AtlasRecordChoice {
  const itemId = node.metadata?.item_id || node.id;
  return {
    id: node.id,
    itemId,
    label: node.metadata?.title || node.label || itemId,
    description: node.metadata?.description || "",
    nodeType: node.node_type || "",
  };
}

function counterpartId(edge: AtlasDrillEdge, nodeId: string) {
  return edge.source_node_id === nodeId
    ? edge.target_node_id
    : edge.source_node_id;
}

function byItemId(left: AtlasRecordChoice, right: AtlasRecordChoice) {
  return left.itemId.localeCompare(right.itemId, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function buildAtlasDrilldownModel(dataset: {
  nodes: AtlasDrillNode[];
  edges: AtlasDrillEdge[];
}): AtlasDrilldownModel {
  const nodesById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const publishedEdges = dataset.edges.filter(
    (edge) => edge.publication_status === "published",
  );
  const structuralChildrenByParent = new Map<string, string[]>();
  const selectedIdsByBaseline = new Map<string, string[]>();
  const incidentEdgesByNode = new Map<string, AtlasDrillEdge[]>();
  for (const edge of publishedEdges) {
    for (const nodeId of [edge.source_node_id, edge.target_node_id]) {
      const incident = incidentEdgesByNode.get(nodeId) || [];
      incident.push(edge);
      incidentEdgesByNode.set(nodeId, incident);
    }
    if (
      edge.relationship_class === "structural" &&
      edge.relationship_type === "contains"
    ) {
      const children = structuralChildrenByParent.get(edge.source_node_id) || [];
      children.push(edge.target_node_id);
      structuralChildrenByParent.set(edge.source_node_id, children);
    }
    if (
      edge.relationship_class === "applicability" &&
      edge.relationship_type === "selects"
    ) {
      const selected = selectedIdsByBaseline.get(edge.source_node_id) || [];
      selected.push(edge.target_node_id);
      selectedIdsByBaseline.set(edge.source_node_id, selected);
    }
  }
  const familyNodes = dataset.nodes
    .filter(
      (node) =>
        node.node_type === "family" &&
        node.metadata?.catalog_id === NIST_FRAMEWORK_ID,
    )
    .sort((left, right) =>
      (left.metadata?.item_id || left.id).localeCompare(
        right.metadata?.item_id || right.id,
      ),
    );

  const familyRecordIds = new Map(
    familyNodes.map((family) => [
      family.id,
      new Set(structuralChildrenByParent.get(family.id) || []),
    ]),
  );

  const baselines = NIST_BASELINE_IDS.map((baselineId) => {
    const baseline = nodesById.get(baselineId);
    if (!baseline) return null;
    const selectedIds = new Set(selectedIdsByBaseline.get(baselineId) || []);
    const families = familyNodes
      .map((family) => {
        const records = [...(familyRecordIds.get(family.id) || [])]
          .filter((id) => selectedIds.has(id))
          .map((id) => nodesById.get(id))
          .filter((node): node is AtlasDrillNode => Boolean(node))
          .map(toChoice)
          .sort(byItemId);
        return records.length
          ? {
              ...toChoice(family),
              records,
            }
          : null;
      })
      .filter((family): family is AtlasFamilyChoice => Boolean(family));
    return {
      ...toChoice(baseline),
      families,
      recordCount: families.reduce(
        (total, family) => total + family.records.length,
        0,
      ),
    };
  }).filter((baseline): baseline is AtlasBaselineChoice => Boolean(baseline));

  const rmfSteps = RMF_STEP_IDS.map((stepId) => {
    const step = nodesById.get(stepId);
    if (!step) return null;
    const results = (incidentEdgesByNode.get(stepId) || [])
      .map((edge) => {
        const node = nodesById.get(counterpartId(edge, stepId));
        return node
          ? {
              ...toChoice(node),
              relationshipType: edge.relationship_type,
            }
          : null;
      })
      .filter((result): result is AtlasRmfResult => Boolean(result))
      .sort(byItemId);
    return {
      ...toChoice(step),
      results,
    };
  }).filter((step): step is AtlasRmfStepChoice => Boolean(step));

  return { baselines, rmfSteps, frameworkGroups: [] };
}
