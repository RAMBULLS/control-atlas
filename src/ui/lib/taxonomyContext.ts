import { TAXONOMY_TAG_BY_ID, TAXONOMY_CONTRACT } from "../../shared/taxonomy-contract.mjs";
import { taxonomyTagsForRecord } from "../../shared/record-taxonomy.mjs";
import type { ViewState } from "./viewState";

export const CANONICAL_DIMENSION_ORDER = [
  "organization", "program", "framework", "domain", "vendor_brand", "product",
  "asset_class", "technology", "environment", "tool", "topic", "artifact",
] as const;
export type CanonicalDimension = (typeof CANONICAL_DIMENSION_ORDER)[number];

const DIMENSION_DISPLAY_NAMES: Record<string, string> = {
  organization: "Organization", program: "Program", framework: "Framework",
  domain: "Security domain", vendor_brand: "Vendor", product: "Product",
  asset_class: "Asset", technology: "Technology", environment: "Environment",
  tool: "Tool", topic: "Topic", artifact: "Artifact",
};

export function dimensionDisplayName(dimensionId: string): string {
  return DIMENSION_DISPLAY_NAMES[dimensionId]
    || TAXONOMY_CONTRACT.dimensions.find((dimension: { id: string; label: string }) => dimension.id === dimensionId)?.label
    || "";
}

export type GovernedTaxonomyTag = {
  id: string;
  kind: string;
  label: string;
  provenance?: "publisher" | "referenced" | "inferred" | "atlas_evidence";
  basis?: { source_field?: string; rule?: string };
  assignment?: "direct" | "derived";
  origin_tag_id?: string;
  relationship_type?: string;
};
export type TaxonomyDimensionGroup = {
  dimensionId: string;
  label: string;
  tags: GovernedTaxonomyTag[];
};

function registeredTag(value: unknown): GovernedTaxonomyTag | null {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return null;
  const definition = TAXONOMY_TAG_BY_ID.get(value.id);
  if (!definition) return null;
  const tag = value as GovernedTaxonomyTag;
  return { ...tag, id: definition.id, kind: definition.dimension, label: definition.label };
}

function isDerived(tag: GovernedTaxonomyTag): boolean {
  return tag.assignment === "derived" || Boolean(tag.origin_tag_id);
}

/** Only registered identities may become tag-filter links. Equal labels are not equal IDs. */
export function groupTaxonomyByDimension(tags: GovernedTaxonomyTag[] | undefined | null): TaxonomyDimensionGroup[] {
  const unique = new Map<string, GovernedTaxonomyTag>();
  for (const value of Array.isArray(tags) ? tags : []) {
    const tag = registeredTag(value);
    if (!tag) continue;
    const existing = unique.get(tag.id);
    if (!existing || (isDerived(existing) && !isDerived(tag))) unique.set(tag.id, tag);
  }
  const groups = new Map<string, GovernedTaxonomyTag[]>();
  for (const tag of unique.values()) {
    const group = groups.get(tag.kind) || [];
    group.push(tag);
    groups.set(tag.kind, group);
  }
  const rank = new Map<string, number>(CANONICAL_DIMENSION_ORDER.map((dimension, index) => [dimension, index]));
  return [...groups.keys()]
    .sort((left, right) => (rank.get(left) ?? 100) - (rank.get(right) ?? 100) || left.localeCompare(right))
    .map((dimensionId) => ({ dimensionId, label: dimensionDisplayName(dimensionId), tags: groups.get(dimensionId)! }));
}

/** Explain the actual assignment, never turn an organization's derived tag into a publisher claim. */
export function formatPlainLanguageProvenance(tag: GovernedTaxonomyTag): string {
  const registered = registeredTag(tag);
  if (!registered) return "";
  const { label, kind } = registered;
  if (isDerived(registered)) {
    const origin = TAXONOMY_TAG_BY_ID.get(registered.origin_tag_id || "");
    if (!origin) return "";
    switch (registered.relationship_type) {
      case "operated_by": return `${origin.label} is operated by ${label}.`;
      case "developed_by": return `${origin.label} is developed by ${label}.`;
      case "published_by": return `${label} publishes ${origin.label}.`;
      case "part_of": return `${origin.label} is part of ${label}.`;
      default: return "";
    }
  }
  const field = registered.basis?.source_field;
  if (!field || !registered.basis?.rule) return "";
  if (kind === "organization" && ["catalog_id", "publisher"].includes(field)) return `${label} publishes this material.`;
  if (kind === "program" && ["catalog_id", "programs"].includes(field)) return `This material belongs to the ${label} program.`;
  if (kind === "domain" && registered.provenance === "publisher" && ["family", "metadata.related_categories[]"].includes(field)) {
    return `The publisher groups this under ${label}.`;
  }
  if (["metadata.benchmark_title", "metadata.identity_category", "family"].includes(field)) {
    if (kind === "asset_class") return `The publication identifies ${label.toLowerCase()} systems.`;
    if (kind === "product" || kind === "vendor_brand" || kind === "technology") return `This publication covers ${label}.`;
  }
  if (["technologyScopes", "compatibility.operatingSystems", "compatibility.environments"].includes(field)) {
    return `The resource lists ${label}.`;
  }
  return "";
}

export function extractGovernedRecordTaxonomy(input: {
  nodeTaxonomyTags?: unknown[];
  catalogId: string;
  metadata?: Record<string, unknown>;
  family?: string;
  relatedCategories?: unknown[];
}): GovernedTaxonomyTag[] {
  const candidates = [
    ...(input.nodeTaxonomyTags || []),
    ...taxonomyTagsForRecord({
      catalog_id: input.catalogId,
      metadata: input.metadata,
      family: input.family,
      related_categories: input.relatedCategories,
    }),
  ];
  return candidates.map(registeredTag).filter((tag): tag is GovernedTaxonomyTag => tag !== null);
}

export function extractOrderedRecordDiscoveryTags(tags: GovernedTaxonomyTag[] | undefined | null): GovernedTaxonomyTag[] {
  return groupTaxonomyByDimension(tags).flatMap((group) => group.tags);
}

export type ExploreRelatedPivot = {
  key: string;
  label: string;
  patch?: Partial<Extract<ViewState, { view: "search" }>>;
  href?: string;
};

export function buildExploreRelatedPivots(input: {
  tags?: GovernedTaxonomyTag[] | null;
  connectionGroups?: Array<{ catalogId: string; label: string; items?: Array<{ nodeId: string }> }>;
}): ExploreRelatedPivot[] {
  const tags = extractOrderedRecordDiscoveryTags(input.tags);
  const pivots: ExploreRelatedPivot[] = [];
  const first = (kind: string) => tags.find((tag) => tag.kind === kind);
  const add = (tag: GovernedTaxonomyTag | undefined, label: (tag: GovernedTaxonomyTag) => string) => {
    if (tag) pivots.push({ key: tag.id, label: label(tag), patch: { tags: [tag.id] } });
  };
  add(first("organization"), (tag) => `${isDerived(tag) ? "More about" : "More from"} ${tag.label}`);
  add(first("program"), (tag) => `More from ${tag.label}`);
  add(first("product") || first("vendor_brand"), (tag) => `Other ${tag.label} content`);
  const asset = first("asset_class");
  const technology = first("technology");
  if (asset && technology) {
    pivots.push({
      key: `${asset.id}:${technology.id}`,
      label: `${asset.label} ${technology.label.toLowerCase()} content`,
      patch: { tags: [asset.id, technology.id] },
    });
  } else {
    add(asset || technology, (tag) => `${tag.label} content`);
  }
  const seenCatalogs = new Set<string>();
  for (const group of input.connectionGroups || []) {
    if (pivots.length >= 5) break;
    if (!group.items?.length || seenCatalogs.has(group.catalogId)) continue;
    seenCatalogs.add(group.catalogId);
    pivots.push({
      key: `related:${group.catalogId}`,
      label: group.catalogId === "disa-cci" ? "Related CCIs" : `Related ${group.label}`,
      href: "#section-related-records",
    });
  }
  if (pivots.length < 5) add(first("domain") || first("framework"), (tag) => `Other ${tag.label} content`);
  return pivots.slice(0, 5);
}
