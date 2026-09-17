import assert from "node:assert/strict";
import test from "node:test";

import { TAXONOMY_TAG_BY_ID } from "../../src/shared/taxonomy-contract.mjs";
import {
  buildExploreRelatedPivots,
  CANONICAL_DIMENSION_ORDER,
  dimensionDisplayName,
  extractGovernedRecordTaxonomy,
  extractOrderedRecordDiscoveryTags,
  formatPlainLanguageProvenance,
  groupTaxonomyByDimension,
  type GovernedTaxonomyTag,
} from "../../src/ui/lib/taxonomyContext";
import { PAGE_ROLES, recordPresentationContract } from "../../src/shared/record-presentation.mjs";

function tag(id: string, extra: Partial<GovernedTaxonomyTag> = {}): GovernedTaxonomyTag {
  const definition = TAXONOMY_TAG_BY_ID.get(id);
  assert.ok(definition, `Fixture must use a registered taxonomy ID: ${id}`);
  return { id, kind: definition.dimension, label: definition.label, ...extra };
}

const recordTags = () => [
  tag("organization.disa", { provenance: "inferred", basis: { source_field: "catalog_id", rule: "catalog-publisher" } }),
  tag("program.stig", { provenance: "inferred", basis: { source_field: "catalog_id", rule: "catalog-program" } }),
  tag("vendor.microsoft"), tag("product.microsoft-windows"), tag("asset.server"), tag("technology.operating-system"),
];

test("detail dimensions retain the owner-approved internal order", () => {
  assert.deepEqual([...CANONICAL_DIMENSION_ORDER], [
    "organization", "program", "framework", "domain", "vendor_brand", "product",
    "asset_class", "technology", "environment", "tool", "topic", "artifact",
  ]);
  assert.equal(dimensionDisplayName("vendor_brand"), "Vendor");
  assert.equal(dimensionDisplayName("asset_class"), "Asset");
  assert.equal(dimensionDisplayName("domain"), "Security domain");
});

test("grouping is deterministic across dimensions and retains stable IDs", () => {
  const input = [tag("asset.server"), tag("domain.access-control"), tag("organization.disa"), tag("program.stig")];
  const result = groupTaxonomyByDimension(input);
  assert.deepEqual(result.map((group) => group.dimensionId), ["organization", "program", "domain", "asset_class"]);
  assert.deepEqual(result.flatMap((group) => group.tags.map((value) => value.id)), ["organization.disa", "program.stig", "domain.access-control", "asset.server"]);
});

test("flat discovery presentation has no synthetic type, area, or publication tags", () => {
  const extracted = extractGovernedRecordTaxonomy({
    catalogId: "disa-stig",
    nodeTaxonomyTags: [
      { id: "kind:STIG rule", kind: "kind", label: "STIG rule" },
      { id: "area:Implementation", kind: "area", label: "Implementation" },
      { id: "publication:Windows Server 2019", kind: "publication", label: "Windows Server 2019" },
      ...recordTags(),
    ],
  });
  const flat = extractOrderedRecordDiscoveryTags(extracted);
  assert.deepEqual(flat.map((value) => value.id), recordTags().map((value) => value.id));
  assert.ok(flat.every((value) => TAXONOMY_TAG_BY_ID.has(value.id)));
});

test("unknown IDs are not promoted into plausible-looking filter links", () => {
  const unknown = { id: "tech.operating-system", kind: "technology", label: "Operating system" };
  assert.deepEqual(groupTaxonomyByDimension([unknown]), []);
  assert.deepEqual(buildExploreRelatedPivots({ tags: [unknown] }), []);
});

test("canonical registry controls the tag label and dimension", () => {
  const result = extractOrderedRecordDiscoveryTags([{ id: "asset.server", kind: "organization", label: "DISA" }]);
  assert.equal(result[0].kind, "asset_class");
  assert.equal(result[0].label, "Server");
});

test("multiple values survive and only duplicate identities are collapsed", () => {
  const result = extractOrderedRecordDiscoveryTags([tag("asset.server"), tag("asset.workstation"), tag("asset.server")]);
  assert.deepEqual(result.map((value) => value.id), ["asset.server", "asset.workstation"]);
});

test("direct evidence takes precedence over a derived duplicate independent of input order", () => {
  const direct = tag("organization.disa", { provenance: "publisher", basis: { source_field: "publisher", rule: "exact-publisher" } });
  const derived = tag("organization.disa", { assignment: "derived", origin_tag_id: "program.stig", relationship_type: "operated_by" });
  for (const input of [[derived, direct], [direct, derived]]) {
    assert.equal(extractOrderedRecordDiscoveryTags(input)[0].provenance, "publisher");
  }
});

test("empty and malformed inputs do not create a discovery section", () => {
  assert.deepEqual(groupTaxonomyByDimension(undefined), []);
  assert.deepEqual(groupTaxonomyByDimension(null), []);
  assert.deepEqual(groupTaxonomyByDimension([]), []);
});

test("an organization reached through a tool is not falsely called the material's publisher", () => {
  const derived = tag("organization.disa", {
    assignment: "derived", provenance: "inferred", origin_tag_id: "tool.emass", relationship_type: "operated_by",
    basis: { source_field: "taxonomy-relationship", rule: "derived-operated_by" },
  });
  const text = formatPlainLanguageProvenance(derived);
  assert.equal(text, "eMASS is operated by DISA.");
  assert.doesNotMatch(text, /publishes this material/);
  assert.equal(buildExploreRelatedPivots({ tags: [derived] })[0].label, "More about DISA");
});

test("missing evidence does not produce a generic publisher or applicability claim", () => {
  assert.equal(formatPlainLanguageProvenance(tag("organization.disa")), "");
  assert.equal(formatPlainLanguageProvenance(tag("environment.cloud")), "");
  assert.equal(formatPlainLanguageProvenance(tag("organization.disa", { assignment: "derived", origin_tag_id: "missing.term" })), "");
});

test("direct explanations name the evidence without internal terminology", () => {
  const examples = [
    [tag("organization.disa", { basis: { source_field: "catalog_id", rule: "catalog-publisher" } }), "DISA publishes this material."],
    [tag("program.stig", { basis: { source_field: "catalog_id", rule: "catalog-program" } }), "This material belongs to the STIG program."],
    [tag("domain.access-control", { provenance: "publisher", basis: { source_field: "family", rule: "exact-publisher-family" } }), "The publisher groups this under Access Control."],
  ] as const;
  for (const [value, expected] of examples) {
    const text = formatPlainLanguageProvenance(value);
    assert.equal(text, expected);
    assert.doesNotMatch(text, /taxonomy|facets|atlas_evidence|source_field|provenance|governed context/);
  }
});

test("discovery pivots retain stable single- and cross-dimension filters", () => {
  const result = buildExploreRelatedPivots({ tags: recordTags(), connectionGroups: [
    { catalogId: "disa-cci", label: "DISA CCI", items: [{ nodeId: "disa-cci:CCI-000185" }] },
  ] });
  assert.equal(result.length, 5);
  assert.deepEqual(result.find((pivot) => pivot.label === "Server operating system content")?.patch?.tags, ["asset.server", "technology.operating-system"]);
  assert.equal(result.find((pivot) => pivot.label === "Related CCIs")?.href, "#section-related-records");
  assert.ok(result.every((pivot) => pivot.patch?.tags?.length || pivot.href));
});

test("empty relationship groups cannot manufacture a related-record jump", () => {
  const result = buildExploreRelatedPivots({ tags: [], connectionGroups: [{ catalogId: "disa-cci", label: "DISA CCI", items: [] }] });
  assert.deepEqual(result, []);
});

test("all six record roles retain their source-specific presentation contract", () => {
  const representatives = [
    ["disa-stig", "stig_rule", PAGE_ROLES.ATOMIC_RECORD],
    ["nist-800-53", "family", PAGE_ROLES.CONTAINER],
    ["csf-2", "catalog", PAGE_ROLES.PUBLICATION_DOCUMENT],
    ["nist-zt", "zt_collaborator", PAGE_ROLES.ENTITY_CONTRIBUTOR],
    ["nist-800-53a", "assessment_procedure", PAGE_ROLES.ASSESSMENT_QUESTION],
    ["nist-zt", "zt_build", PAGE_ROLES.IMPLEMENTATION_ARTIFACT],
  ];
  for (const [catalog, type, role] of representatives) {
    const contract = recordPresentationContract(catalog, type);
    assert.equal(contract.page_role, role);
    assert.ok(contract.sections.length);
    assert.ok(contract.relationship_policy);
  }
});
