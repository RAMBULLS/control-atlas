import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_DIMENSION_ORDER,
  dimensionDisplayName,
  extractGovernedRecordTaxonomy,
  formatPlainLanguageProvenance,
  groupTaxonomyByDimension,
  type GovernedTaxonomyTag,
} from "../../src/ui/lib/taxonomyContext";
import { TAXONOMY_TAG_BY_ID } from "../../src/shared/taxonomy-contract.mjs";
import {
  PAGE_ROLES,
  recordPresentationContract,
} from "../../src/shared/record-presentation.mjs";

test("groupTaxonomyByDimension groups tags in canonical dimension order", () => {
  const sampleTags: GovernedTaxonomyTag[] = [
    { id: "domain.access-control", kind: "domain", label: "Access Control", provenance: "publisher" },
    { id: "asset.server", kind: "asset_class", label: "Server", provenance: "inferred" },
    { id: "organization.disa", kind: "organization", label: "DISA", provenance: "inferred" },
    { id: "program.stig", kind: "program", label: "STIG", provenance: "inferred" },
    { id: "vendor.microsoft", kind: "vendor_brand", label: "Microsoft", provenance: "inferred" },
    { id: "product.microsoft-windows", kind: "product", label: "Microsoft Windows", provenance: "inferred" },
  ];

  const grouped = groupTaxonomyByDimension(sampleTags);
  const dimensionIds = grouped.map((g) => g.dimensionId);

  // Expected canonical order: organization, program, vendor_brand, product, asset_class, domain
  assert.deepEqual(dimensionIds, [
    "organization",
    "program",
    "vendor_brand",
    "product",
    "asset_class",
    "domain",
  ]);

  // Labels match canonical short public dimension names
  assert.equal(grouped.find((g) => g.dimensionId === "organization")?.label, "Organization");
  assert.equal(grouped.find((g) => g.dimensionId === "program")?.label, "Program");
  assert.equal(grouped.find((g) => g.dimensionId === "vendor_brand")?.label, "Vendor");
  assert.equal(grouped.find((g) => g.dimensionId === "product")?.label, "Product");
  assert.equal(grouped.find((g) => g.dimensionId === "asset_class")?.label, "Asset");
  assert.equal(grouped.find((g) => g.dimensionId === "domain")?.label, "Security domain");
});

test("groupTaxonomyByDimension supports multiple values per dimension and deduplicates identical IDs", () => {
  const sampleTags: GovernedTaxonomyTag[] = [
    { id: "domain.access-control", kind: "domain", label: "Access Control", provenance: "publisher" },
    { id: "domain.audit-accountability", kind: "domain", label: "Audit and Accountability", provenance: "inferred" },
    { id: "domain.access-control", kind: "domain", label: "Access Control", provenance: "inferred" }, // duplicate
    { id: "asset.server", kind: "asset_class", label: "Server", provenance: "inferred" },
    { id: "asset.workstation", kind: "asset_class", label: "Workstation", provenance: "inferred" },
  ];

  const grouped = groupTaxonomyByDimension(sampleTags);
  const domainGroup = grouped.find((g) => g.dimensionId === "domain");
  const assetGroup = grouped.find((g) => g.dimensionId === "asset_class");

  assert.ok(domainGroup);
  assert.equal(domainGroup.tags.length, 2);
  assert.deepEqual(domainGroup.tags.map((t) => t.id), [
    "domain.access-control",
    "domain.audit-accountability",
  ]);
  // The first occurrence wins (publisher provenance retained)
  assert.equal(domainGroup.tags[0].provenance, "publisher");

  assert.ok(assetGroup);
  assert.equal(assetGroup.tags.length, 2);
  assert.deepEqual(assetGroup.tags.map((t) => t.id), [
    "asset.server",
    "asset.workstation",
  ]);
});

test("groupTaxonomyByDimension returns empty array when no governed tags exist", () => {
  assert.deepEqual(groupTaxonomyByDimension([]), []);
  assert.deepEqual(groupTaxonomyByDimension(undefined as any), []);
});

test("formatPlainLanguageProvenance produces human-readable text without developer terms", () => {
  const publisherTag: GovernedTaxonomyTag = {
    id: "domain.access-control",
    kind: "domain",
    label: "Access Control",
    provenance: "publisher",
  };
  const benchmarkTag: GovernedTaxonomyTag = {
    id: "asset.server",
    kind: "asset_class",
    label: "Server",
    provenance: "inferred",
    basis: { source_field: "metadata.benchmark_title", rule: "rule-stig-server" },
  };
  const catalogTag: GovernedTaxonomyTag = {
    id: "organization.disa",
    kind: "organization",
    label: "DISA",
    provenance: "inferred",
    basis: { source_field: "catalog_id", rule: "disa-catalog" },
  };

  const pubText = formatPlainLanguageProvenance(publisherTag);
  const benchText = formatPlainLanguageProvenance(benchmarkTag);
  const catText = formatPlainLanguageProvenance(catalogTag);

  // Prohibited internal/developer terms
  for (const text of [pubText, benchText, catText]) {
    assert.doesNotMatch(text, /atlas_evidence|source_field|rule-stig|disa-catalog|inferred|provenance|basis/i);
  }

  assert.match(pubText, /publisher/i);
  assert.match(benchText, /benchmark/i);
  assert.match(catText, /publication/i);
});

test("dimensionDisplayName handles all canonical dimensions consistently", () => {
  for (const dim of CANONICAL_DIMENSION_ORDER) {
    const label = dimensionDisplayName(dim);
    assert.ok(label, `Missing label for dimension ${dim}`);
    assert.notEqual(label, dim, `Dimension ${dim} has unformatted raw key label`);
  }
});

test("representative records across all six PAGE_ROLES have valid presentation contracts", () => {
  const roleRepresentatives = [
    { catalogId: "disa-stig", recordType: "stig_rule", role: PAGE_ROLES.ATOMIC_RECORD },
    { catalogId: "nist-800-53", recordType: "control", role: PAGE_ROLES.ATOMIC_RECORD },
    { catalogId: "disa-cci", recordType: "requirement", role: PAGE_ROLES.ATOMIC_RECORD },
    { catalogId: "nist-800-53", recordType: "family", role: PAGE_ROLES.CONTAINER },
    { catalogId: "mitre-attack", recordType: "tactic", role: PAGE_ROLES.CONTAINER },
    { catalogId: "csf-2", recordType: "catalog", role: PAGE_ROLES.PUBLICATION_DOCUMENT },
    { catalogId: "nist-zt", recordType: "zt_collaborator", role: PAGE_ROLES.ENTITY_CONTRIBUTOR },
    { catalogId: "nist-800-53a", recordType: "assessment_procedure", role: PAGE_ROLES.ASSESSMENT_QUESTION },
    { catalogId: "microsoft-zt-maturity", recordType: "zt_assessment_question", role: PAGE_ROLES.ASSESSMENT_QUESTION },
    { catalogId: "nist-zt", recordType: "zt_build", role: PAGE_ROLES.IMPLEMENTATION_ARTIFACT },
  ];

  for (const rep of roleRepresentatives) {
    const profile = recordPresentationContract(rep.catalogId, rep.recordType);
    assert.equal(profile.page_role, rep.role, `${rep.catalogId}:${rep.recordType} expected role ${rep.role}`);
    assert.ok(profile.sections.length > 0, `${rep.catalogId}:${rep.recordType} must have sections`);
    assert.ok(profile.relationship_policy, `${rep.catalogId}:${rep.recordType} must have relationship policy`);
  }
});

test("extractGovernedRecordTaxonomy excludes pseudo-tags for record facts (kind, area, publication)", () => {
  const extracted = extractGovernedRecordTaxonomy({
    catalogId: "disa-stig",
    nodeTaxonomyTags: [
      { id: "kind:STIG rule", kind: "kind", label: "STIG rule", provenance: "publisher" },
      { id: "area:Implementation", kind: "area", label: "Implementation", provenance: "inferred" },
      { id: "publication:Microsoft Windows Server 2019 Security Technical Implementation Guide", kind: "publication", label: "Microsoft Windows Server 2019 Security Technical Implementation Guide", provenance: "publisher" },
      { id: "asset.server", kind: "asset_class", label: "Server", provenance: "inferred" },
      { id: "vendor.microsoft", kind: "vendor_brand", label: "Microsoft", provenance: "inferred" },
    ],
  });

  // No synthetic pseudo-tags survive
  assert.ok(!extracted.some((t) => t.id.startsWith("kind:")));
  assert.ok(!extracted.some((t) => t.id.startsWith("area:")));
  assert.ok(!extracted.some((t) => t.id.startsWith("publication:")));

  // Only genuine governed taxonomy tags remain
  assert.ok(extracted.some((t) => t.id === "asset.server"));
  assert.ok(extracted.some((t) => t.id === "vendor.microsoft"));
  assert.ok(extracted.some((t) => t.id === "organization.disa")); // from catalog
  assert.ok(extracted.some((t) => t.id === "program.stig")); // from catalog
});

test("V-205646 regression: context groups into clean taxonomy dimensions without fact chips", () => {
  const nodeTags = [
    { id: "asset.server", kind: "asset_class", label: "Server", provenance: "inferred" },
    { id: "vendor.microsoft", kind: "vendor_brand", label: "Microsoft", provenance: "inferred" },
    { id: "product.microsoft-windows", kind: "product", label: "Microsoft Windows", provenance: "inferred" },
    { id: "technology.operating-system", kind: "technology", label: "Operating system", provenance: "inferred" },
  ];

  const allTags = extractGovernedRecordTaxonomy({
    catalogId: "disa-stig",
    nodeTaxonomyTags: nodeTags,
  });

  const grouped = groupTaxonomyByDimension(allTags);
  const dimensionIds = grouped.map((g) => g.dimensionId);

  // Canonical ordering for V-205646
  assert.deepEqual(dimensionIds, [
    "organization",
    "program",
    "vendor_brand",
    "product",
    "asset_class",
    "technology",
  ]);

  // Ensure no "kind" or "publication" dimensions exist
  assert.ok(!dimensionIds.includes("kind" as any));
  assert.ok(!dimensionIds.includes("publication" as any));
  assert.ok(!dimensionIds.includes("area" as any));
});

test("public copy guardrail: prohibited data-model jargon never appears in dimension names or provenance", () => {
  const prohibitedJargon = [
    "explore by context",
    "source-backed facets",
    "related in control atlas",
    "atlas_evidence",
    "source_field",
    "governed context",
    "taxonomy",
  ];

  for (const dim of CANONICAL_DIMENSION_ORDER) {
    const label = dimensionDisplayName(dim).toLowerCase();
    for (const jargon of prohibitedJargon) {
      assert.ok(!label.includes(jargon), `Dimension ${dim} label "${label}" contains prohibited jargon "${jargon}"`);
    }
  }

  const sampleTags: GovernedTaxonomyTag[] = [
    { id: "domain.access-control", kind: "domain", label: "Access Control", provenance: "publisher" },
    { id: "asset.server", kind: "asset_class", label: "Server", provenance: "inferred", basis: { source_field: "metadata.benchmark_title" } },
    { id: "organization.disa", kind: "organization", label: "DISA", provenance: "inferred", basis: { source_field: "catalog_id" } },
  ];

  for (const tag of sampleTags) {
    const text = formatPlainLanguageProvenance(tag).toLowerCase();
    for (const jargon of prohibitedJargon) {
      assert.ok(!text.includes(jargon), `Provenance text "${text}" contains prohibited jargon "${jargon}"`);
    }
  }
});

