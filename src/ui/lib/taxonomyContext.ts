import { TAXONOMY_TAG_BY_ID, TAXONOMY_CONTRACT } from "../../shared/taxonomy-contract.mjs";
import { taxonomyTagsForRecord } from "../../shared/record-taxonomy.mjs";

export const CANONICAL_DIMENSION_ORDER = [
  "organization",
  "framework",
  "program",
  "vendor_brand",
  "product",
  "asset_class",
  "technology",
  "environment",
  "domain",
  "tool",
  "artifact",
  "topic",
] as const;

export type CanonicalDimension = (typeof CANONICAL_DIMENSION_ORDER)[number];

const DIMENSION_DISPLAY_NAMES: Record<string, string> = {
  organization: "Organization",
  framework: "Framework",
  program: "Program",
  vendor_brand: "Vendor",
  product: "Product",
  asset_class: "Asset",
  technology: "Technology",
  environment: "Environment",
  domain: "Security domain",
  tool: "Tool",
  artifact: "Artifact",
  topic: "Topic",
};

export function dimensionDisplayName(dimensionId: string): string {
  if (DIMENSION_DISPLAY_NAMES[dimensionId]) {
    return DIMENSION_DISPLAY_NAMES[dimensionId];
  }
  const fromContract = TAXONOMY_CONTRACT.dimensions.find((d: { id: string; label: string }) => d.id === dimensionId);
  if (fromContract?.label) {
    return fromContract.label;
  }
  return dimensionId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type GovernedTaxonomyTag = {
  id: string;
  kind: string;
  label: string;
  provenance?: "publisher" | "referenced" | "inferred";
  basis?: { source_field?: string; rule?: string };
  origin_tag_id?: string;
  relationship_type?: string;
};

export type TaxonomyDimensionGroup = {
  dimensionId: string;
  label: string;
  tags: GovernedTaxonomyTag[];
};

export function groupTaxonomyByDimension(
  tags: GovernedTaxonomyTag[] | undefined | null,
): TaxonomyDimensionGroup[] {
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  // Deduplicate tags by id, keeping first occurrence (which preserves publisher provenance)
  const seenIds = new Set<string>();
  const seenDimensionLabels = new Set<string>();
  const uniqueTags: GovernedTaxonomyTag[] = [];

  for (const tag of tags) {
    if (!tag || !tag.id || !tag.label) continue;
    // Disallow synthetic pseudo-tags
    if (tag.id.startsWith("kind:") || tag.id.startsWith("area:") || tag.id.startsWith("publication:")) {
      continue;
    }
    const resolvedDimension = tag.kind || TAXONOMY_TAG_BY_ID.get(tag.id)?.dimension || "topic";
    const dimLabelKey = `${resolvedDimension}:${tag.label.toLowerCase()}`;
    if (seenIds.has(tag.id) || seenDimensionLabels.has(dimLabelKey)) {
      continue;
    }
    seenIds.add(tag.id);
    seenDimensionLabels.add(dimLabelKey);
    uniqueTags.push({
      ...tag,
      kind: resolvedDimension,
    });
  }

  if (uniqueTags.length === 0) {
    return [];
  }

  // Group by dimension
  const groupsByDimension = new Map<string, GovernedTaxonomyTag[]>();
  for (const tag of uniqueTags) {
    const dim = tag.kind;
    const existing = groupsByDimension.get(dim);
    if (existing) {
      existing.push(tag);
    } else {
      groupsByDimension.set(dim, [tag]);
    }
  }

  // Order dimensions canonically
  const dimensionRank = new Map<string, number>(
    CANONICAL_DIMENSION_ORDER.map((dim, index) => [dim, index]),
  );

  const sortedDimensions = Array.from(groupsByDimension.keys()).sort((a, b) => {
    const rankA = dimensionRank.has(a) ? dimensionRank.get(a)! : 100;
    const rankB = dimensionRank.has(b) ? dimensionRank.get(b)! : 100;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });

  return sortedDimensions.map((dimensionId) => ({
    dimensionId,
    label: dimensionDisplayName(dimensionId),
    tags: groupsByDimension.get(dimensionId) || [],
  }));
}

export function formatPlainLanguageProvenance(tag: GovernedTaxonomyTag): string {
  if (tag.provenance === "publisher") {
    return `${tag.label} is assigned directly by the publisher.`;
  }
  const sourceField = tag.basis?.source_field || "";
  if (sourceField === "metadata.benchmark_title") {
    return `${tag.label} is shown because this publication benchmark identifies it.`;
  }
  if (sourceField === "catalog_id") {
    return `${tag.label} is shown because this belongs to the publication.`;
  }
  if (sourceField === "family") {
    return `${tag.label} is shown because the publisher groups this under ${tag.label}.`;
  }
  if (sourceField === "metadata.related_categories[]") {
    return `${tag.label} is shown because the publisher lists this category.`;
  }
  if (sourceField === "taxonomy-relationship") {
    return `${tag.label} is connected through related classifications.`;
  }
  if (sourceField === "technologyScopes" || sourceField.includes("compatibility")) {
    return `${tag.label} is shown based on documented technology scope and compatibility.`;
  }
  if (tag.origin_tag_id) {
    const origin = TAXONOMY_TAG_BY_ID.get(tag.origin_tag_id);
    return `${tag.label} is shown because of ${origin?.label || tag.origin_tag_id}.`;
  }
  return `${tag.label} is shown based on published source evidence.`;
}

export function extractGovernedRecordTaxonomy(input: {
  nodeTaxonomyTags?: any[];
  catalogId: string;
  metadata?: any;
  family?: string;
  relatedCategories?: any[];
}): GovernedTaxonomyTag[] {
  const nodeTags: GovernedTaxonomyTag[] = (input.nodeTaxonomyTags || [])
    .filter((t: any) => t && t.id && !t.id.startsWith("kind:") && !t.id.startsWith("area:") && !t.id.startsWith("publication:"))
    .map((t: any) => {
      const tagDef = TAXONOMY_TAG_BY_ID.get(t.id);
      return {
        id: t.id,
        kind: t.kind || tagDef?.dimension || "topic",
        label: t.label || tagDef?.label || t.id,
        provenance: t.provenance || "inferred",
        basis: t.basis,
        origin_tag_id: t.origin_tag_id,
        relationship_type: t.relationship_type,
      };
    });

  const catalogTags: GovernedTaxonomyTag[] = (taxonomyTagsForRecord({
    catalog_id: input.catalogId,
    metadata: input.metadata,
    family: input.family,
    related_categories: input.relatedCategories,
  }) || [])
    .filter((t: any) => t && t.id)

    .map((t: any) => {
      const tagDef = TAXONOMY_TAG_BY_ID.get(t.id);
      return {
        id: t.id,
        kind: t.kind || tagDef?.dimension || "topic",
        label: t.label || tagDef?.label || t.id,
        provenance: t.provenance || "inferred",
        basis: t.basis,
        origin_tag_id: t.origin_tag_id,
        relationship_type: t.relationship_type,
      };
    });

  return [...nodeTags, ...catalogTags];
}
