import {
  defaultRelationshipClass,
  RELATIONSHIP_CLASSES,
} from "../app/structural-hierarchy.mjs";

// Unknown relation names must not inherit comparison eligibility just because
// the generic hierarchy classifier falls back to "correlation". All admitted
// verbs remain publisher relationships, not claims of equivalence.
export const COMPARISON_RELATIONSHIP_TYPES = new Set([
  "maps_to", "concept_crosswalk", "references", "supports", "supported_by",
  "mitigates", "assesses", "requires", "uses", "applies_to", "describes",
  "depends_on", "protects", "equivalent", "subset_of", "superset_of",
]);

// --- Comparison capability predicate (Phase 3: Comparison Capability Engine)
// A cross-catalog edge only counts as evidence that two publications have a
// supported comparison when it is a published, correlation-class content
// mapping. `issued_under` defaults to the `correlation` class (it is not a
// structural, applicability, or organizing relationship type) but it is a
// legal-authority pointer ("this publication is issued under that mandate"),
// not a crosswalk, so it is excluded explicitly. Editorial edges (Control
// Atlas's own organizing spine) are excluded via `publication_status`.
// Both build-framework-data.mjs (catalog-bootstrap mapping_sources, computed
// ahead of the full graph loading in the browser) and runtime.mjs
// (getConnectedCatalogs/getCatalogs, computed once the full graph is
// resident) must resolve the identical answer for the identical edge, or a
// publication can look connected in one loading phase and unconnected in
// the other. This is the single source of truth for that predicate.
export function isComparisonCapableEdge(edge) {
  if (!edge || edge.publication_status !== "published") return false;
  if (!COMPARISON_RELATIONSHIP_TYPES.has(edge.relationship_type)) return false;
  const relationshipClass =
    edge.relationship_class || defaultRelationshipClass(edge.relationship_type);
  return relationshipClass === RELATIONSHIP_CLASSES.correlation;
}

// A capability-bearing edge is only real evidence of a supported comparison
// if it resolves to at least one named, citable mapping source. An edge that
// passes isComparisonCapableEdge but carries no resolvable source id is not
// something a UI can attribute a comparison to.
export function mappingSourceIdsForEdge(edge) {
  return [
    ...new Set(
      (edge?.source_refs || [])
        .map((reference) => reference.source_id || reference.sourceId)
        .filter(Boolean),
    ),
  ];
}

// Baseline membership is a publisher selection of canonical controls, never a
// crosswalk or a claim that two independently named requirements are equal.
export function isBaselineSelection(edge, from, to) {
  return edge?.publication_status === "published" &&
    edge.relationship_class === "applicability" && edge.relationship_type === "selects" &&
    ["baseline", "baseline_profile"].includes(from?.node_type) &&
    ["control", "control_enhancement"].includes(to?.node_type);
}
