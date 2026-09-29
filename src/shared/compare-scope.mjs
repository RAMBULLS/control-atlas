/** Compare scope is about what the endpoints represent, not the size of a file. */
const IMPLEMENTATION_TYPES = new Set([
  "zt_reference_component", "zt_product_component", "zt_logical_component",
  "zt_build", "zt_collaborator", "zt_mapping_contributor", "zt_assessment_question",
]);

export function comparisonPairKey(source, target) {
  if (!source || !target || source === target) return "";
  return [source, target].sort().join("|");
}

export function comparisonScopeForNodes(nodes) {
  return nodes.some((node) => IMPLEMENTATION_TYPES.has(node.node_type))
    ? "implementation" : "frameworks";
}

export function comparisonScopeAllowed(scope, intent) {
  return intent === "item-mapping" || scope === (intent || "frameworks");
}

// Reversing columns does not reverse the publisher's assertion. These are
// display predicates only; every result also retains the native endpoints,
// predicate, qualifiers and source locators for inspection/export.
const INVERSE = Object.freeze({
  supports: "supported_by", supported_by: "supports",
  references: "referenced_by", referenced_by: "references",
  assesses: "assessed_by", assessed_by: "assesses",
  selects: "selected_by", selected_by: "selects",
  mitigates: "mitigated_by", mitigated_by: "mitigates",
  requires: "required_by", required_by: "requires",
  depends_on: "dependency_of", dependency_of: "depends_on",
  uses: "used_by", used_by: "uses", protects: "protected_by", protected_by: "protects",
  extends: "extended_by", extended_by: "extends", describes: "described_by", described_by: "describes",
  subset_of: "superset_of", superset_of: "subset_of", applies_to: "applied_by",
  maps_to: "maps_to", concept_crosswalk: "concept_crosswalk", equivalent: "equivalent",
});

export function orientedRelationshipType(type, reversed) {
  if (!reversed) return type;
  // An unknown directed predicate must not acquire an invented inverse.
  return INVERSE[type] || `inverse_of_${type}`;
}
