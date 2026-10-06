import type {
  AtlasSpine,
  AtlasSpineEntry,
} from "./atlasSpine";

export const ATLAS_TRUNK_ID = "atlas:TRUNK";

export type AtlasSourceRef = {
  source_id?: string;
  ref_type?: string;
  locator?: string;
};

export type AtlasTreeOrigin = "authority" | "organizing" | "structural";

export type AtlasTreeNode = {
  id: string;
  itemId: string;
  label: string;
  blurb: string;
  nodeType: string;
  parentId: string | null;
  childCount: number;
  descendantRecordCount: number;
  level: "authority" | "trunk" | "area" | "publication" | "summary";
  mandate?: AtlasSpineEntry["mandate"];
  primaryAuthority?: string | null;
  alsoRequiredBy: string[];
  publicationType?: string;
  mandateNote?: string;
  sourceRefs: AtlasSourceRef[];
  rationale: string;
  groupingKey?: string;
};

export type AtlasTraceHop = {
  id: string;
  label: string;
  node_type: string;
  origin: AtlasTreeOrigin;
  rationale?: string;
  source_refs?: AtlasSourceRef[];
};

export type AtlasTreeModel = {
  nodes: AtlasTreeNode[];
  nodesById: Map<string, AtlasTreeNode>;
  childrenByParent: Map<string, AtlasTreeNode[]>;
  authorityNodes: AtlasTreeNode[];
  trunk: AtlasTreeNode;
  areas: AtlasTreeNode[];
  publications: AtlasTreeNode[];
};

export type AuthoritySpineEvidence = {
  instruments?: Array<{
    id: string;
    blurb?: string;
    source_refs?: AtlasSourceRef[];
  }>;
  publications?: Array<{
    catalog_id: string;
    mandate_note?: string;
    source_refs?: AtlasSourceRef[];
  }>;
};

const AUTHORITY_TYPES = new Set(["statute", "regulation", "policy_directive"]);
function itemId(id: string) {
  const separator = id.indexOf(":");
  return separator >= 0 ? id.slice(separator + 1) : id;
}

function lexicalNode(left: AtlasTreeNode, right: AtlasTreeNode) {
  return left.itemId.localeCompare(right.itemId, undefined, {
    numeric: true,
    sensitivity: "base",
  }) || left.id.localeCompare(right.id);
}

function levelFor(entry: AtlasSpineEntry): AtlasTreeNode["level"] {
  if (AUTHORITY_TYPES.has(entry.node_type) || entry.id.startsWith("authority:")) {
    return "authority";
  }
  if (entry.id === ATLAS_TRUNK_ID || entry.node_type === "trunk") return "trunk";
  if (entry.node_type === "limb") return "area";
  if (entry.node_type === "catalog") return "publication";
  return "summary";
}

export function buildAtlasTreeModel(
  spine: AtlasSpine,
  evidence: AuthoritySpineEvidence = {},
): AtlasTreeModel {
  if (!Array.isArray(spine?.entries) || spine.entries.length === 0) {
    throw new Error("Atlas spine artifact has no entries.");
  }

  const instrumentEvidence = new Map((evidence.instruments || []).map((entry) => [entry.id, entry]));
  const publicationEvidence = new Map((evidence.publications || []).map((entry) => [`${entry.catalog_id}:CATALOG`, entry]));
  const nodes = spine.entries.map((entry) => {
      const instrument = instrumentEvidence.get(entry.id);
      const publication = publicationEvidence.get(entry.id);
      return ({
    id: entry.id,
    itemId: itemId(entry.id),
    label: entry.label,
    blurb: entry.blurb,
    nodeType: entry.node_type,
    parentId: entry.parent_id,
    childCount: entry.child_count,
    descendantRecordCount: entry.descendant_record_count,
    level: levelFor(entry),
    mandate: entry.mandate,
    primaryAuthority: entry.primary_authority,
    alsoRequiredBy: [...(entry.also_required_by || [])].sort(),
    publicationType: entry.publication_type,
    mandateNote: entry.mandate_note,
    sourceRefs: [...(entry.source_refs || instrument?.source_refs || publication?.source_refs || [])],
    rationale: entry.rationale || instrument?.blurb || publication?.mandate_note || entry.blurb,
    groupingKey: entry.grouping_key,
      });
    }) satisfies AtlasTreeNode[];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const trunk = nodesById.get(ATLAS_TRUNK_ID);
  if (!trunk) throw new Error(`Atlas spine is missing ${ATLAS_TRUNK_ID}.`);

  const childrenByParent = new Map<string, AtlasTreeNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) || [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort(lexicalNode);
  for (const node of nodes) {
    if (node.level === "publication") {
      node.childCount = childrenByParent.get(node.id)?.length || 0;
    }
  }

  const authorityNodes = nodes.filter((node) => node.level === "authority").sort(lexicalNode);
  const areas = nodes.filter((node) => node.level === "area").sort(lexicalNode);
  const publications = nodes.filter((node) => node.level === "publication").sort(lexicalNode);
  if (areas.length !== 9) throw new Error(`Atlas spine must contain nine areas; found ${areas.length}.`);

  return { nodes, nodesById, childrenByParent, authorityNodes, trunk, areas, publications };
}

export function canonicalAtlasPath(model: AtlasTreeModel, nodeId: string) {
  const path: AtlasTreeNode[] = [];
  const seen = new Set<string>();
  let current = model.nodesById.get(nodeId);
  while (current) {
    if (seen.has(current.id)) throw new Error(`Atlas tree cycle at ${current.id}.`);
    seen.add(current.id);
    path.unshift(current);
    if (!current.parentId) break;
    current = model.nodesById.get(current.parentId);
  }
  return path;
}

export function catalogForNode(model: AtlasTreeModel, nodeId: string) {
  return canonicalAtlasPath(model, nodeId).find((node) => node.level === "publication") || null;
}

export function authorityChain(model: AtlasTreeModel, authorityId: string | null | undefined) {
  if (!authorityId) return [];
  const path = canonicalAtlasPath(model, authorityId);
  if (path.some((node) => node.level !== "authority")) {
    throw new Error(`Authority chain for ${authorityId} left the authority spine.`);
  }
  return path;
}

function hop(node: AtlasTreeNode, origin: AtlasTreeOrigin): AtlasTraceHop {
  return {
    id: node.id,
    label: node.label,
    node_type: node.nodeType,
    origin,
    rationale: node.rationale || undefined,
    source_refs: node.sourceRefs.length ? node.sourceRefs : undefined,
  };
}

export function atlasDisplayTrace(model: AtlasTreeModel, nodeId: string): AtlasTraceHop[] {
  const canonical = canonicalAtlasPath(model, nodeId);
  const publication = canonical.find((node) => node.level === "publication") || null;
  const authority = authorityChain(model, publication?.primaryAuthority).map((node) => hop(node, "authority"));
  return [
    ...authority,
    ...canonical.map((node) => hop(
      node,
      node.level === "trunk" || node.level === "area" ? "organizing" : "structural",
    )),
  ];
}

export function extendDisplayedAuthorityTrace(
  model: AtlasTreeModel,
  links: AtlasTraceHop[],
): AtlasTraceHop[] {
  const firstCanonical = links.findIndex((link) => link.origin !== "authority");
  const canonical = firstCanonical >= 0 ? links.slice(firstCanonical) : [];
  const publicationId = canonical.find((link) => model.nodesById.get(link.id)?.level === "publication")?.id;
  if (!publicationId) return links;
  const publication = model.nodesById.get(publicationId)!;
  const authority = authorityChain(model, publication.primaryAuthority).map((node) => hop(node, "authority"));
  return [...authority, ...canonical];
}

export function canonicalAncestryIsAuthorityFree(model: AtlasTreeModel) {
  return model.nodes
    .filter((node) => node.level !== "authority")
    .every((node) => canonicalAtlasPath(model, node.id).every((ancestor) => ancestor.level !== "authority"));
}
