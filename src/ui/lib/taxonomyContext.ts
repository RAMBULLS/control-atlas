import { TAXONOMY_TAG_BY_ID, TAXONOMY_CONTRACT } from "../../shared/taxonomy-contract.mjs";
import { taxonomyTagsForRecord } from "../../shared/record-taxonomy.mjs";

export const CANONICAL_DIMENSION_ORDER = [
  "organization",
  "program",
  "framework",
  "domain",
  "vendor_brand",
  "product",
  "asset_class",
  "technology",
  "environment",
  "tool",
  "topic",
  "artifact",
] as const;

export type CanonicalDimension = (typeof CANONICAL_DIMENSION_ORDER)[number];

const DIMENSION_DISPLAY_NAMES: Record<string, string> = {
  organization: "Organization",
  program: "Program",
  framework: "Framework",
  domain: "Security domain",
  vendor_brand: "Vendor",
  product: "Product",
  asset_class: "Asset",
  technology: "Technology",
  environment: "Environment",
  tool: "Tool",
  topic: "Topic",
  artifact: "Artifact",
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
  const dim = tag.kind || TAXONOMY_TAG_BY_ID.get(tag.id)?.dimension || "";
  const label = tag.label;

  if (dim === "organization" || tag.id.startsWith("org.")) {
    return `${label} publishes this material.`;
  }
  if (dim === "program" || tag.id.startsWith("program.")) {
    if (tag.id === "program.stig") {
      return "This record is part of a STIG.";
    }
    return `This record is part of the ${label} program.`;
  }
  if (dim === "product" || tag.id.startsWith("product.")) {
    return `This publication covers ${label}.`;
  }
  if (dim === "asset_class" || tag.id.startsWith("asset.")) {
    return `This publication is for ${label}.`;
  }
  if (dim === "domain" || tag.id.startsWith("domain.")) {
    return `The publisher places this under ${label}.`;
  }
  if (dim === "framework" || tag.id.startsWith("framework.")) {
    return `This record belongs to ${label}.`;
  }
  if (dim === "vendor_brand" || tag.id.startsWith("vendor.")) {
    return `This publication covers ${label} products.`;
  }
  if (dim === "technology" || tag.id.startsWith("tech.")) {
    return `This publication covers ${label.toLowerCase()} technology.`;
  }
  if (dim === "environment" || tag.id.startsWith("env.")) {
    return `This material applies to ${label.toLowerCase()} environments.`;
  }
  if (dim === "tool" || tag.id.startsWith("tool.")) {
    return `This material references the ${label} tool.`;
  }

  if (tag.origin_tag_id) {
    const origin = TAXONOMY_TAG_BY_ID.get(tag.origin_tag_id);
    if (origin?.label) {
      return `${label} is included because this covers ${origin.label}.`;
    }
  }

  return `This publication relates to ${label}.`;
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

export function extractOrderedRecordDiscoveryTags(
  tags: GovernedTaxonomyTag[] | undefined | null,
): GovernedTaxonomyTag[] {
  const groups = groupTaxonomyByDimension(tags);
  return groups.flatMap((group) => group.tags);
}

export type ExploreRelatedPivot = {
  key: string;
  label: string;
  patch?: Record<string, any>;
  href?: string;
};

export function buildExploreRelatedPivots(input: {
  tags?: GovernedTaxonomyTag[] | null;
  connectionGroups?: Array<{
    catalogId: string;
    label: string;
    items?: Array<{ nodeId: string }>;
  }>;
}): ExploreRelatedPivot[] {
  const pivots: ExploreRelatedPivot[] = [];
  const tags = input.tags || [];

  // 1. Organization pivot
  const orgTag = tags.find((t) => t.kind === "organization" || t.id.startsWith("organization."));
  if (orgTag) {
    pivots.push({
      key: `org-${orgTag.id}`,
      label: `More from ${orgTag.label}`,
      patch: { tags: [orgTag.id] },
    });
  }

  // 2. Program pivot
  const progTag = tags.find((t) => t.kind === "program" || t.id.startsWith("program."));
  if (progTag) {
    pivots.push({
      key: `prog-${progTag.id}`,
      label: `More from ${progTag.label}`,
      patch: { tags: [progTag.id] },
    });
  }

  // 3. Product or Vendor pivot
  const prodTag = tags.find((t) => t.kind === "product" || t.id.startsWith("product."));
  if (prodTag) {
    pivots.push({
      key: `prod-${prodTag.id}`,
      label: `Other ${prodTag.label} content`,
      patch: { tags: [prodTag.id] },
    });
  } else {
    const vendorTag = tags.find((t) => t.kind === "vendor_brand" || t.id.startsWith("vendor."));
    if (vendorTag) {
      pivots.push({
        key: `vendor-${vendorTag.id}`,
        label: `Other ${vendorTag.label} content`,
        patch: { tags: [vendorTag.id] },
      });
    }
  }

  // 4. Asset / Technology combined or single pivot
  const assetTag = tags.find((t) => t.kind === "asset_class" || t.id.startsWith("asset."));
  const techTag = tags.find((t) => t.kind === "technology" || t.id.startsWith("technology."));
  if (assetTag && techTag) {
    pivots.push({
      key: `asset-tech-${assetTag.id}-${techTag.id}`,
      label: `${assetTag.label} ${techTag.label.toLowerCase()} content`,
      patch: { tags: [assetTag.id, techTag.id] },
    });
  } else if (assetTag) {
    pivots.push({
      key: `asset-${assetTag.id}`,
      label: `${assetTag.label} content`,
      patch: { tags: [assetTag.id] },
    });
  } else if (techTag) {
    pivots.push({
      key: `tech-${techTag.id}`,
      label: `${techTag.label} content`,
      patch: { tags: [techTag.id] },
    });
  }

  // 5. Related correlation counterpart link (e.g. Related CCIs)
  if (input.connectionGroups && input.connectionGroups.length > 0) {
    for (const group of input.connectionGroups) {
      if (pivots.length >= 5) break;
      const groupLabel = group.catalogId === "disa-cci" ? "Related CCIs" : `Related ${group.label}`;
      pivots.push({
        key: `rel-${group.catalogId}`,
        label: groupLabel,
        href: "#section-related-records",
      });
    }
  }

  // 6. Security Domain or Framework fallback if space permits
  if (pivots.length < 5) {
    const domainTag = tags.find((t) => t.kind === "domain" || t.id.startsWith("domain."));
    if (domainTag && !pivots.some((p) => p.key.startsWith("domain-"))) {
      pivots.push({
        key: `domain-${domainTag.id}`,
        label: `Other ${domainTag.label} content`,
        patch: { tags: [domainTag.id] },
      });
    }
  }

  return pivots.slice(0, 5);
}
