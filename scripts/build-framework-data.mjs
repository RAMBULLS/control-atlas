#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSourceTextPresentation,
  isValidSourceTextPresentation,
} from "../src/shared/source-text-presentation.mjs";
import { writeJsonAtomically } from "./lib/write-json-atomically.mjs";
import { generatedAt as reproducibleGeneratedAt } from "./lib/stable-generated-at.mjs";
import { validateGraphArtifacts } from "../tools/validators/federal-graph.mjs";
import { loadSourceRegistry } from "../tools/validators/source-registry.mjs";
import {
  ATLAS_NEIGHBORHOOD_SHARD_COUNT,
  buildAtlasNeighborhoodShards,
} from "../src/app/atlas-neighborhood.mjs";
import {
  catalogIdOf,
  defaultRelationshipClass,
  RELATIONSHIP_CLASSES,
} from "../src/app/structural-hierarchy.mjs";
import {
  ORGANIZING_STRUCTURE_SOURCE_ID,
  resolveCatalogPublicationIdentity,
  validateCatalogPublicationIdentity,
} from "../src/app/catalog-publication-identity.mjs";
import { buildConnectionInventory } from "../src/ui/lib/connectionInventory.mjs";
import {
  ancestorChain,
  buildAncestorGraph,
} from "../src/app/ancestor-path.mjs";
import {
  assertTrunkReachability,
  canonicalTrunkReachable,
  deriveEditorialSpine,
  deriveSyntheticCatalogs,
} from "./hierarchy-derivation.mjs";
import { createFederalGraphRuntime } from "../src/app/runtime.mjs";
import { validateAuthoritySpine } from "../src/app/authority-spine.mjs";
import { referencedNistFamilies } from "../src/shared/nist-families.mjs";
import { sourceNativeIdentityCategory } from "../src/shared/record-identity.mjs";
import { isComparisonCapableEdge } from "../src/shared/compare-capability.mjs";
import { RETIRED_RECORD_TYPES } from "../src/shared/record-acceptance.mjs";
import { controlContextLabel, CONTROL_CONTEXT_RELATIONSHIP_TYPE } from "../src/shared/record-control-context.mjs";
import {
  missingRequiredRecordFields,
  recordPresentationContract,
  SUPPORTED_RECORD_TYPES,
  undeclaredCapturedRecordFields,
} from "../src/shared/record-presentation.mjs";
import {
  assertionClassForEdge,
  assertionProfileId,
  normalizeProfileToken,
  recordProfileId,
} from "../src/shared/entity-profiles.mjs";
import {
  CATALOG_STRUCTURE_IDS,
  catalogStructureProfile,
  structurePathIsAllowed,
} from "../src/shared/catalog-structure.mjs";
import { TAXONOMY_CONTRACT } from "../src/shared/taxonomy-contract.mjs";
import { IDENTITY_REGISTRY } from "../src/shared/identity-registry.mjs";
import { taxonomyTagsForRecord } from "../src/shared/record-taxonomy.mjs";
import { repairKnownSourceEncoding } from "../src/shared/text-fidelity.mjs";
import {
  connectionEvidenceIdsForEdge,
  publisherStructureMembershipForEdge,
  resolveAtlasStructureRole,
  resolveNativeType,
  resolveObjectLayer,
  resolvePublicationId,
  sourceRecordEnvelopeForNode,
  validateCanonicalLayerAssignment,
  validateConnectionEvidenceIsolation,
  validateRelationshipEvidenceAttachment,
  validateNativeTypeAssignment,
  validatePublicationIdAssignment,
  validatePublisherStructureMembership,
  validateSourceFragment,
  validateSourceMaterialIdAssignment,
  validateSourceRecordEnvelope,
} from "../src/shared/data-trust-contracts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = join(ROOT, "data", "generated");
const RUNTIME_COLLECTIONS = [
  "sources",
  "nodes",
  "edges",
  "evidence",
  "graph-health",
  "atlas-spine",
];
const SHARDED_RUNTIME_COLLECTIONS = new Set(["nodes", "edges", "evidence"]);
const RUNTIME_COLLECTION_SHARD_COUNT = 64;
// Search is intentionally a bounded, on-demand payload rather than an
// initial-route payload. Sixteen chunks keep every compressed artifact under the
// public 300 KB budget while avoiding excessive request fan-out.
const LIBRARY_SEARCH_SHARD_COUNT = 16;
const LIBRARY_SEARCH_INDEX_FIELDS = [
  "id",
  "item_id",
  "title",
  "description_available",
  "official_text_preview",
  "object_type",
  "source_id",
  "source_name",
  "publisher_name",
  "catalog_id",
  "control_family",
  "identity_category",
  "taxonomy_tags",
  "published_connection_count",
  "published_cross_catalog_connection_count",
  "published_connection_catalog_count",
];
const GOVERNANCE_FILES = [
  "build-manifest.json",
  "source-manifests.json",
  "graph-diff-summary.json",
  "library-search.json",
  "atlas-neighborhood-manifest.json",
  "source-count-ledger.json",
  "ingestion-stage-ledger.json",
  "resource-ingestion-ledger.json",
  "catalog-source-inventory.json",
  "publication-identity-index.json",
  "publication-audit-report.json",
];
const ATLAS_NEIGHBORHOOD_DIR = join(GENERATED, "atlas-neighborhood");

const NON_RECORD_NODE_TYPES = new Set([
  "benchmark",
  "catalog",
  "category",
  "family",
  "function",
  "group",
  "limb",
  "policy_directive",
  "regulation",
  "statute",
  "tactic",
  "trunk",
]);
const SUPPORTED_RECORD_TYPE_SET = new Set(SUPPORTED_RECORD_TYPES);
const PUBLISHER_DERIVED_CATALOGS = new Set([
  "cmmc-2",
  "cui-policy",
  "dod-rai",
  "fedramp-rev5",
  "fips-199",
  "fips-200",
  "nist-800-37",
  "nist-800-53b",
]);

export function cciClassificationLabel(value = "") {
  const parts = [...new Set(String(value).split(",").map((part) => part.trim().toLocaleLowerCase()).filter(Boolean))];
  const unknown = parts.filter((part) => part !== "policy" && part !== "technical");
  if (unknown.length || parts.length === 0) {
    throw new Error(`Unsupported DISA CCI classification: ${value || "(missing)"}`);
  }
  if (parts.includes("policy") && parts.includes("technical")) return "Policy and Technical";
  return parts[0] === "policy" ? "Policy" : "Technical";
}

export function validateRecordPresentation(nodes) {
  const supported = new Set(SUPPORTED_RECORD_TYPES);
  const failures = [];
  for (const node of nodes) {
    if (!supported.has(node.node_type) && (NON_RECORD_NODE_TYPES.has(node.node_type) || node.metadata?.structural_group === true)) continue;
    if (!supported.has(node.node_type)) {
      failures.push(`${node.id}: missing presentation contract for ${node.node_type}`);
      continue;
    }
    const profile = recordPresentationContract(node.metadata?.catalog_id || "", node.node_type);
    const missing = missingRequiredRecordFields(profile, node.metadata || {});
    const undeclared = undeclaredCapturedRecordFields(profile, node.metadata || {});
    if (undeclared.length) missing.push(`field dispositions for ${undeclared.join(", ")}`);
    if (
      profile.hierarchy_fields.includes("family") &&
      !String(node.metadata?.family || "").trim()
    ) {
      missing.push("family");
    }
    for (const section of profile.sections.filter((entry) => entry.kind === "text")) {
      if (!profile.field_dispositions[section.field]) missing.push(`${section.field} disposition`);
      const value = node.metadata?.[section.field];
      if (!String(value || "").trim()) continue;
      const fieldPresentation = node.metadata?.source_text_presentation?.[section.field];
      if (!fieldPresentation && (node.metadata?.structural_group === true || node.node_type === "catalog" || node.node_type === "benchmark")) continue;
      if (!isValidSourceTextPresentation(value, fieldPresentation)) {
        missing.push(`${section.field} presentation`);
      }
    }
    if (missing.length) failures.push(`${node.id}: missing ${missing.join(", ")}`);
  }
  if (failures.length) {
    throw new Error(`Record presentation validation failed:\n${failures.slice(0, 25).join("\n")}`);
  }
}

const CATALOGS = [
  ["controls-800-53.json", "nist-800-53", "nist-oscal", "control"],
  [
    "800-53b-baselines.json",
    "nist-800-53b",
    "nist-800-53b-baselines",
    "baseline",
  ],
  ["fips-199.json", "fips-199", "nist-fips-199", "impact_category"],
  ["fips-200.json", "fips-200", "nist-fips-200", "requirement"],
  ["tasks-800-37.json", "nist-800-37", "nist-800-37-rev2", "rmf_step"],
  [
    "requirements-800-171-rev2.json",
    "nist-800-171-rev2",
    "nist-800-171-rev2",
    "requirement",
  ],
  ["requirements-800-171.json", "nist-800-171", "nist-oscal", "requirement"],
  [
    "requirements-800-172.json",
    "nist-800-172",
    "nist-800-172-rev3",
    "requirement",
  ],
  ["csf-subcategories.json", "csf-2", "nist-oscal", "requirement"],
  ["cmmc-practices.json", "cmmc-2", "dod-cmmc-rule", "program"],
  ["fedramp-baselines.json", "fedramp-rev5", "fedramp-rev5", "baseline"],
  ["fedramp-2026-catalog.json", "fedramp-2026", "fedramp-2026-rules", "requirement"],
  ["cui-policy.json", "cui-policy", "isoo-cui-regulation", "policy"],
  ["ccis.json", "disa-cci", "disa-cci-list", "requirement"],
  ["ai-rmf.json", "nist-ai-rmf", "nist-ai-rmf-playbook", "requirement"],
  ["ssdf.json", "nist-ssdf", "nist-ssdf-oscal", "requirement"],
  ["dod-rai.json", "dod-rai", "dod-rai-toolkit", "requirement"],
  ["dod-zt.json", "dod-zt", "dod-zt-reference-architecture-v2", "requirement"],
  ["nist-zt.json", "nist-zt", "nist-sp-800-207", "requirement"],
  ["microsoft-zt-maturity.json", "microsoft-zt-maturity", "microsoft-zero-trust-maturity-questionnaire-v1-1", "zt_assessment_question"],
  ["nist-iot-cybersecurity.json", "nist-iot-cybersecurity", "nist-iot-device-cybersecurity-requirement-catalogs", "iot_capability_element"],
  ["nist-mobile-threats.json", "nist-mobile-threats", "nist-mobile-threat-catalogue", "mobile_threat"],
  ["stig-rules.json", "disa-stig", "disa-stig-library", "stig_rule"],
  ["srg-requirements.json", "disa-srg", "disa-srg-library", "srg_requirement"],
  [
    "attack-techniques-enterprise.json",
    "mitre-attack",
    "mitre-attack-enterprise",
    "attack_technique",
  ],
  [
    "attack-techniques-ics.json",
    "mitre-attack-ics",
    "mitre-attack-ics",
    "attack_technique",
  ],
  [
    "d3fend-countermeasures.json",
    "mitre-d3fend",
    "mitre-d3fend-ontology",
    "defend_countermeasure",
  ],
];

/**
 * Declarative parent-tier table — the "branches" of the
 * roots > trunk > branches > twigs > leaves hierarchy.
 *
 * One row per catalog that publishes a grouping level between the catalog and its
 * records. Adding a catalog's tier is a ROW here, not another branch inside
 * buildNodes. Before this table, tier construction was gated behind
 * `catalogId === "nist-800-53"`, which left 88% of graph nodes with no parent even
 * though most catalogs carry their grouping value in the source data — measured in
 * docs/DATA_POLICY.md.
 *
 * Row contract:
 *   nodeType     node_type for the tier node
 *   idPrefix     id shape is `<catalogId>:<idPrefix>-<key>`
 *   key          (record) => stable id fragment; null/empty skips the record
 *   title        (record) => human title for the tier
 *   label        (key, title) => node label; omit to use the title verbatim
 *   description  (record, title) => tier node description
 *   edgeDataset  locator prefix for the membership edge id
 *   rationale    (record, title) => why this record belongs to this tier
 *
 * A record whose key or title is missing is left unparented rather than filed
 * under a guessed tier. Catalogs absent from this table have no grouping level in
 * their upstream data (disa-cci, mitre-d3fend) or need a vocabulary decision
 * first; neither case is served by inventing a tier here.
 */
export const CATALOG_TIERS = {
  "microsoft-zt-maturity": {
    nodeType: "zt_pillar",
    idPrefix: "PILLAR",
    key: (record) => slugKey(record.family),
    title: (record) => record.family,
    edgeDataset: "microsoft-zt-pillar-membership",
    rationale: (record, title) => `${record.id} is published on the ${title} worksheet.`,
  },
  "nist-800-53": {
    nodeType: "family",
    idPrefix: "FAMILY",
    key: (record) => familyCodeFromControlId(record.id),
    publisherItemId: (record) => familyCodeFromControlId(record.id),
    title: (record) => record.family,
    label: (key, title) => `${key} ${title} Family`,
    edgeDataset: "800-53-family-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} family in NIST SP 800-53 Rev. 5.`,
  },
  "nist-800-53a": {
    nodeType: "family",
    idPrefix: "FAMILY",
    key: (record) => familyCodeFromControlId(record.id),
    publisherItemId: (record) => familyCodeFromControlId(record.id),
    title: (record) => record.family,
    label: (key, title) => `${key} ${title} Family`,
    edgeDataset: "800-53a-family-membership",
    rationale: (record, title) =>
      `${record.id} is an assessment procedure in the ${title} family.`,
  },
  "nist-800-171": {
    nodeType: "family",
    idPrefix: "FAMILY",
    key: (record) => slugKey(record.family),
    title: (record) => record.family,
    edgeDataset: "800-171-family-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} family in NIST SP 800-171 Rev. 3.`,
  },
  "nist-800-171-rev2": {
    nodeType: "family",
    idPrefix: "FAMILY",
    key: (record) => slugKey(record.family),
    title: (record) => record.family,
    edgeDataset: "800-171-rev2-family-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} family in NIST SP 800-171 Rev. 2.`,
  },
  "nist-800-172": {
    nodeType: "family",
    idPrefix: "FAMILY",
    key: (record) => slugKey(record.family),
    title: (record) => record.family,
    edgeDataset: "800-172-family-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} family in NIST SP 800-172.`,
  },
  // DISA publishes STIGs and SRGs as XCCDF Benchmarks — tools/importers/
  // disa-stig-adapter.mjs parses `parsed.Benchmark` — so both use one node type.
  "disa-stig": {
    nodeType: "benchmark",
    idPrefix: "BENCHMARK",
    key: (record) => slugKey(record.metadata?.benchmark_id),
    publisherItemId: (record) => record.metadata?.benchmark_id,
    title: (record) => record.metadata?.benchmark_title,
    description: (record) => record.metadata?.benchmark_description,
    descriptionProvenance: "publisher",
    edgeDataset: "disa-stig-benchmark-membership",
    rationale: (record, title) =>
      `${record.id} is a rule in the ${title} benchmark.`,
  },
  "disa-srg": {
    nodeType: "benchmark",
    idPrefix: "BENCHMARK",
    key: (record) => slugKey(record.metadata?.benchmark_id),
    publisherItemId: (record) => record.metadata?.benchmark_id,
    title: (record) => record.metadata?.benchmark_title,
    description: (record) => record.metadata?.benchmark_description,
    descriptionProvenance: "publisher",
    edgeDataset: "disa-srg-benchmark-membership",
    rationale: (record, title) =>
      `${record.id} is a requirement in the ${title} security requirements guide.`,
  },
  // CSF 2.0 is two tiers deep (Function > Category > Subcategory). The
  // Category row below is the record's immediate parent; `parentTier`
  // declares Category's own parent (Function), resolved from the same
  // record via tools/normalizers/oscal-normalize.mjs's walkCsf, which
  // threads both grouping levels from the official OSCAL catalog's
  // `class: "function"` / `class: "category"` groups (previously discarded).
  "csf-2": {
    nodeType: "category",
    idPrefix: "CATEGORY",
    key: (record) => record.category_id,
    publisherItemId: (record) => record.category_id,
    title: (record) => record.category,
    edgeDataset: "csf-category-membership",
    rationale: (record, title) =>
      `${record.id} is a subcategory in the ${title} category of CSF 2.0.`,
    parentTier: {
      nodeType: "function",
      idPrefix: "FUNCTION",
      key: (record) => record.function_id,
      publisherItemId: (record) => record.function_id,
      title: (record) => record.function,
      edgeDataset: "csf-function-membership",
      rationale: (record, title) =>
        `The ${title} function of CSF 2.0 organizes this category.`,
    },
  },
  // Both ATT&CK domains and D3FEND publish a top-level tactic taxonomy
  // (kill-chain tactics for ATT&CK, Model/Harden/Detect/Isolate/Deceive/
  // Evict/Restore for D3FEND) — one shared node type, same precedent as
  // "benchmark" above. Names/ids resolved upstream in the adapters
  // (tools/importers/mitre-attack-adapter.mjs, mitre-d3fend-adapter.mjs)
  // since neither ingested snapshot carried them as a flat field.
  // Sub-techniques resolve a tactic tier key too (same as SP 800-53 control
  // enhancements resolve a family key above) — they get BOTH the tactic-tier
  // edge and, via addAttackSubtechniqueMembershipEdges below, a second edge
  // from their parent technique. That is the established shape for
  // enhancement-style child records in this graph, not a new convention.
  "mitre-attack": {
    nodeType: "tactic",
    idPrefix: "TACTIC",
    key: (record) => record.metadata?.tactic_id,
    publisherItemId: (record, membership) => membership?.id || record.metadata?.tactic_id,
    title: (record) => record.metadata?.tactic_title,
    edgeDataset: "mitre-attack-tactic-membership",
    rationale: (record, title) =>
      `${record.id} is a technique under the ${title} tactic in MITRE ATT&CK.`,
  },
  "mitre-attack-ics": {
    nodeType: "tactic",
    idPrefix: "TACTIC",
    key: (record) => record.metadata?.tactic_id,
    publisherItemId: (record, membership) => membership?.id || record.metadata?.tactic_id,
    title: (record) => record.metadata?.tactic_title,
    edgeDataset: "mitre-attack-ics-tactic-membership",
    rationale: (record, title) =>
      `${record.id} is a technique under the ${title} tactic in MITRE ATT&CK for ICS.`,
  },
  "mitre-d3fend": {
    nodeType: "tactic",
    idPrefix: "TACTIC",
    key: (record) => record.metadata?.tactic_id,
    publisherItemId: (record) => record.metadata?.tactic_id,
    title: (record) => record.metadata?.tactic_title,
    edgeDataset: "mitre-d3fend-tactic-membership",
    rationale: (record, title) =>
      `${record.id} is a defensive technique under the ${title} tactic in MITRE D3FEND.`,
  },
  // nist-ai-rmf (GOVERN-n/MAP-n/... categories), nist-ssdf (PO/PS/PW/RV
  // practice groups), and dod-rai (2 sections) each carry a real `family`
  // grouping value but naming the tier "family" would misrender as
  // "Control family: GOVERN-1" — owner decision 2026-07-25: one generic
  // "group" node type shared across all three, same precedent as
  // "benchmark"/"tactic" above. The tier node's own title still carries the
  // real category name; only the internal type tag is generic.
  "nist-ai-rmf": {
    nodeType: "group",
    idPrefix: "GROUP",
    key: (record) => slugKey(record.family),
    publisherItemId: (record) => record.family,
    title: (record) => record.family,
    edgeDataset: "nist-ai-rmf-group-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} group in the NIST AI RMF Playbook.`,
  },
  "nist-ssdf": {
    nodeType: "group",
    idPrefix: "GROUP",
    key: (record) => slugKey(record.family),
    title: (record) => record.family,
    edgeDataset: "nist-ssdf-group-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} practice group in the SSDF.`,
  },
  "dod-rai": {
    nodeType: "group",
    idPrefix: "GROUP",
    key: (record) => slugKey(record.family),
    title: (record) => record.family,
    edgeDataset: "dod-rai-group-membership",
    rationale: (record, title) =>
      `${record.id} is part of the ${title} section of the CDAO AI Assurance Toolkit.`,
  },
};

const MAPS = [
  ["800-53-to-csf.json", "nist-800-53", "csf-2", "nist-olir-csf2-to-sp800-53"],
  [
    "800-53-to-800-171.json",
    "nist-800-171",
    "nist-800-53",
    "nist-800-171-oscal-mappings",
  ],
  [
    "800-171-to-csf.json",
    "nist-800-171",
    "csf-2",
    "nist-olir-csf2-to-sp800-171",
  ],
  ["cci-to-800-53.json", "disa-cci", "nist-800-53", "disa-cci-nist-references"],
  // CCIs that DISA's own list never re-mapped past Rev 3/4, resolved through
  // NIST's published Rev 4 -> Rev 5 correspondences. See
  // scripts/fetch-800-53-rev4-rev5-crosswalk.mjs for what each edge is based on.
  [
    "cci-to-800-53-rev4.json",
    "disa-cci",
    "nist-800-53",
    "nist-800-53-rev4-rev5-crosswalk",
  ],
  [
    "stig-srg-to-cci.json",
    "disa-stig",
    "disa-cci",
    "disa-stig-srg-cci-references",
  ],
  [
    "800-53-to-dod-zt-overlays.json",
    "nist-800-53",
    "dod-zt",
    "dod-zt-overlays-2024",
  ],
  [
    "attack-to-d3fend.json",
    "mitre-attack",
    "mitre-d3fend",
    "mitre-d3fend-mappings",
  ],
  [
    "d3fend-to-800-53.json",
    "mitre-d3fend",
    "nist-800-53",
    "mitre-d3fend-mappings",
  ],
];

const CATALOG_SUMMARIES = new Map([
  [
    "nist-800-53",
    {
      sourceId: "nist-800-53",
      title: "SP 800-53 Rev. 5 Catalog",
    },
  ],
  [
    "csf-2",
    {
      sourceId: "nist-csf-2",
      title: "CSF 2.0 Catalog",
    },
  ],
  [
    "disa-stig",
    {
      sourceId: "disa-stig-library",
      title: "DISA STIG Catalog",
    },
  ],
  [
    "disa-srg",
    {
      sourceId: "disa-srg-library",
      title: "DISA SRG Catalog",
    },
  ],
  [
    "mitre-attack",
    {
      sourceId: "mitre-attack-enterprise",
      title: "MITRE ATT&CK Enterprise Catalog",
    },
  ],
  [
    "mitre-attack-ics",
    {
      sourceId: "mitre-attack-ics",
      title: "MITRE ATT&CK ICS Catalog",
    },
  ],
  [
    "mitre-d3fend",
    {
      sourceId: "mitre-d3fend-ontology",
      title: "MITRE D3FEND Catalog",
    },
  ],
  [
    "nist-ai-rmf",
    {
      sourceId: "nist-ai-rmf-playbook",
      title: "NIST AI RMF Playbook Catalog",
    },
  ],
  [
    "nist-ssdf",
    {
      sourceId: "nist-ssdf",
      title: "NIST SSDF Catalog",
    },
  ],
  [
    "dod-rai",
    {
      sourceId: "dod-rai-toolkit",
      title: "DoD Responsible AI Catalog",
    },
  ],
  [
    "nist-800-171-rev2",
    {
      sourceId: "nist-800-171-rev2",
      title: "SP 800-171 Rev. 2 Catalog",
    },
  ],
  [
    "nist-800-171",
    {
      sourceId: "nist-800-171",
      title: "SP 800-171 Rev. 3 Catalog",
    },
  ],
  [
    "nist-800-172",
    {
      sourceId: "nist-800-172-rev3",
      title: "SP 800-172 Rev. 3 Catalog",
    },
  ],
  [
    "cmmc-2",
    {
      sourceId: "dod-cmmc-rule",
      title: "CMMC 2.0 Catalog",
    },
  ],
  [
    "cui-policy",
    {
      sourceId: "isoo-cui-regulation",
      title: "CUI Program Catalog",
    },
  ],
  [
    "fedramp-2026",
    {
      sourceId: "fedramp-2026-rules",
      title: "FedRAMP Consolidated Rules for 2026",
    },
  ],
  [
    "dod-zt",
    {
      sourceId: "dod-zt-reference-architecture-v2",
      title: "DoD Zero Trust Catalog",
    },
  ],
  [
    "nist-zt",
    {
      sourceId: "nist-sp-800-207",
      title: "NIST Zero Trust Catalog",
    },
  ],
  [
    "microsoft-zt-maturity",
    {
      sourceId: "microsoft-zero-trust-maturity-questionnaire-v1-1",
      title: "Microsoft Zero Trust Maturity Questionnaire",
    },
  ],
  [
    "nist-iot-cybersecurity",
    {
      sourceId: "nist-iot-device-cybersecurity-requirement-catalogs",
      title: "NIST IoT Device Cybersecurity Requirement Catalog",
    },
  ],
  [
    "nist-mobile-threats",
    {
      sourceId: "nist-mobile-threat-catalogue",
      title: "NIST Mobile Threat Catalogue",
    },
  ],
]);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const nodeId = (catalogId, recordId) => recordId.startsWith(`${catalogId}:`) ? recordId : `${catalogId}:${recordId}`;
const identifier = (value) => String(value).replace(/[^A-Za-z0-9:_-]+/g, "-");

// OLIR-style mapping files zero-pad SP 800-53 control IDs and write
// enhancements in paren notation ("AC-01", "CM-07(02)", "AC-02.3"), while
// ingested catalog nodes use unpadded dot notation ("AC-1", "CM-7.2",
// "AC-2.3"). Normalize at the mapping read site so endpoints resolve against
// the node set; anything that is not an 800-53-style control ID (CSF
// "GV.OC-03", CCI "CCI-000015", 800-171 "3.1.1") passes through unchanged.
export function normalizeControlId(recordId) {
  const match = String(recordId ?? "").match(
    /^([A-Za-z]{2})-0*(\d+)(?:\.0*(\d+)|\(0*(\d+)\))?$/,
  );
  if (!match) return recordId;
  const enhancement = match[3] ?? match[4];
  return `${match[1]}-${match[2]}${enhancement != null ? `.${enhancement}` : ""}`;
}

function relationshipId(prefix, sourceNodeId, targetNodeId, relationshipType) {
  return identifier(
    `${prefix}:${relationshipType}:${sourceNodeId}:${targetNodeId}`,
  );
}

/**
 * Catalogs whose publisher states the requirement instead of naming it, so the
 * statement *is* the title.
 *
 * NIST CSF 2.0 subcategories have no short name, which is why
 * `tools/importers/csf-reference-tool-adapter.mjs` asserts that NIST's own
 * Reference Tool title equals our description. The normalized snapshot stores
 * the identifier in `title`, so 106 of 135 CSF records rendered their id twice
 * ("GV.OC-03 GV.OC-03") wherever a title was shown - most visibly on every row
 * of the 800-53-to-CSF crosswalk, one of the most-used mappings in federal
 * practice.
 *
 * Deliberately narrow. DISA CCI records also carry their identifier as their
 * title, but their bare-id label is an existing decision (see the label comment
 * below), and 5,138 long labels would also fight the Atlas rule that a cell is
 * never narrower than its own name.
 */
const STATEMENT_TITLED_CATALOGS = new Set(["csf-2"]);

/**
 * The publisher's title for a record, never its identifier repeated back.
 * Falls back to the statement only where that is what the publisher titles the
 * record with, and only when the stored title adds nothing over the id.
 */
function publisherTitleFor(record, catalogId) {
  const title = String(record.title || "").trim();
  const id = String(record.id || "").trim();
  if (title && title !== id) return record.title;
  if (!STATEMENT_TITLED_CATALOGS.has(catalogId)) return record.title || "";
  const description = String(record.description || "").trim();
  return description || record.title || "";
}

function nodeType(defaultType, recordId) {
  return defaultType === "control" && String(recordId).includes(".")
    ? "control_enhancement"
    : defaultType;
}

function familyCodeFromControlId(recordId) {
  return String(recordId || "").match(/^([A-Z]{2})-/)?.[1] || null;
}

/** Stable, id-safe fragment for a tier key derived from free text. */
function slugKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return (
    text
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase() || null
  );
}

/**
 * Resolve a record's parent tier from CATALOG_TIERS, or null when the catalog has
 * no tier or this record does not carry the grouping value. Never guesses.
 */
function tierFor(catalogId, record) {
  const tier = CATALOG_TIERS[catalogId];
  if (!tier) return null;
  const key = tier.key(record);
  const title = tier.title(record);
  if (!key || !title) return null;
  return {
    tier,
    key,
    title,
    nodeId: nodeId(catalogId, `${tier.idPrefix}-${key}`),
    itemId: `${tier.idPrefix}-${key}`,
    publisherItemId: tier.publisherItemId?.(record) || null,
  };
}

function tierMembershipsFor(catalogId, record) {
  const tier = CATALOG_TIERS[catalogId];
  if (!tier) return [];
  if ((catalogId === "mitre-attack" || catalogId === "mitre-attack-ics")
    && Array.isArray(record.metadata?.tactic_memberships)) {
    return record.metadata.tactic_memberships.map((membership) => ({
      tier,
      key: membership.id,
      title: membership.title,
      nodeId: nodeId(catalogId, `${tier.idPrefix}-${membership.id}`),
      itemId: `${tier.idPrefix}-${membership.id}`,
      publisherItemId: tier.publisherItemId?.(record, membership) || null,
    }));
  }
  const resolved = tierFor(catalogId, record);
  return resolved ? [resolved] : [];
}

/**
 * Resolve a tier's own parent tier (e.g. CSF Category's parent Function),
 * when the catalog's CATALOG_TIERS row declares one via `parentTier`. Most
 * catalogs are one tier deep and have none.
 */
function parentTierFor(catalogId, record, tier) {
  const parent = tier.parentTier;
  if (!parent) return null;
  const key = parent.key(record);
  const title = parent.title(record);
  if (!key || !title) return null;
  return {
    tier: parent,
    key,
    title,
    nodeId: nodeId(catalogId, `${parent.idPrefix}-${key}`),
    itemId: `${parent.idPrefix}-${key}`,
    publisherItemId: parent.publisherItemId?.(record) || null,
  };
}

/** The outermost tier a record's chain resolves to — what hangs off the catalog. */
function normalize53BBaselineId(value) {
  const label = String(value || "").toUpperCase();
  if (label.includes("PRIVACY")) return "PRIVACY";
  if (label.includes("MODERATE")) return "MODERATE";
  if (label.includes("HIGH")) return "HIGH";
  if (label.includes("LOW")) return "LOW";
  return null;
}

function assessmentNodeId(recordId) {
  return nodeId("nist-800-53a", recordId);
}

// §8 merged provenance: some catalogs derive from the SAME underlying official
// file as another (e.g. 800-53A assessment procedures are embedded in the
// 800-53 rev5 OSCAL catalog; the 800-171 catalog and its OSCAL mapping are one
// file; the CCI-to-NIST references are the CCI list). Node/edge provenance must
// cite the ONE artifact that carries real evidence, not a redundant twin.
const ARTIFACT_ALIASES = {
  'artifact-nist-800-53a-assessment-procedures': 'artifact-nist-800-53',
  'artifact-nist-800-171': 'artifact-nist-800-171-oscal-mappings',
  'artifact-disa-cci-nist-references': 'artifact-disa-cci-list',
};
function aliasArtifact(id) {
  return ARTIFACT_ALIASES[id] || id;
}

// spec §3: every node stores publication_source_id, artifact_ids, and
// provenance_assertions[]. Shared by pushEligibleNode (regular catalog
// content) and the organizing-spine's trunk/limb/synthetic-catalog nodes
// (applyOrganizingSpine) so neither path ships a node with no provenance.
function attachNodeProvenance(node, sourceId, registry) {
  const source = registry.byId.get(sourceId);
  const defaultArtifactId = aliasArtifact(`artifact-${sourceId}`);
  const sourceBundle = registry.catalogSourceBundles
    .find((bundle) => bundle.catalog_id === node.metadata?.catalog_id);
  const bundleSourceArtifactId = sourceBundle?.primary_artifact_ids?.[0]
    || sourceBundle?.mapping_source_ids?.[0]
    || sourceBundle?.enrichment_artifact_ids?.[0];
  const primaryArtifactId = aliasArtifact(
    node.metadata?.primary_artifact_id ||
      node.metadata?.contributing_artifact_ids?.[0] ||
      (registry.byId.has(defaultArtifactId) ? defaultArtifactId : bundleSourceArtifactId) ||
      defaultArtifactId,
  );
  node.publication_source_id = sourceId;
  node.artifact_ids = node.artifact_ids || [...new Set([
    primaryArtifactId,
    ...(node.metadata?.contributing_artifact_ids || []).map(aliasArtifact),
    ...(node.metadata?.enrichment_artifact_ids || []).map(aliasArtifact),
  ])];
  node.provenance_assertions = node.provenance_assertions || [
    {
      authority_class: source?.authority_class || "publisher",
      publication_source_id: sourceId,
      artifact_id: primaryArtifactId,
      source_locator: node.metadata?.source_locator || `${sourceId}#${node.id}`,
      version: source?.version || "1.0",
      snapshot_date: source?.retrieved_at || "2026-08-05",
    },
  ];
  // Phase 1 canonical layer contract (src/shared/data-trust-contracts.mjs):
  // every node gets its objectLayer/atlasStructureRole/nativeType/publicationId
  // stamped here, the single choke point every node construction path runs
  // through, so no path can ship a node the contract hasn't classified.
  node.metadata.object_layer = resolveObjectLayer(node);
  const structureRole = resolveAtlasStructureRole(node);
  if (structureRole) node.metadata.atlas_structure_role = structureRole;
  node.metadata.native_type = resolveNativeType(node);
  node.metadata.publication_id = resolvePublicationId(node);
  node.metadata.origin = node.metadata.object_layer === "atlas_structure"
    ? "atlas_editorial"
    : PUBLISHER_DERIVED_CATALOGS.has(node.metadata.catalog_id)
      ? "publisher_derived"
      : "publisher_normalized";
  node.entity_kind = "content_record";
  node.profile_id = recordProfileId(node.node_type);
  node.source_material_id = primaryArtifactId;
  const sourceLocator = node.metadata?.source_locator || `${sourceId}#${node.id}`;
  const sourceReference = `${primaryArtifactId}#${sourceLocator}`;
  node.source_refs = [sourceReference];
  const presentationFields = recordPresentationContract(
    node.metadata?.catalog_id || "",
    node.node_type,
  ).sections.map((section) => section.field);
  node.metadata.source_text_presentation ||= {};
  for (const field of presentationFields) {
    const value = node.metadata?.[field];
    if (
      String(value || "").trim() &&
      !node.metadata.source_text_presentation[field]
    ) {
      node.metadata.source_text_presentation[field] = buildSourceTextPresentation(value);
    }
  }
  const materialFields = [...new Set(["title", ...presentationFields])];
  node.claim_evidence = materialFields
    .filter((field) => {
      const value = node.metadata?.[field];
      return Array.isArray(value) ? value.length > 0 : Boolean(String(value || "").trim());
    })
    .map((field) => ({
      entity_id: node.id,
      field_path: `/metadata/${field}`,
      origin: node.metadata.origin,
      evidence_refs: node.metadata.origin === "atlas_editorial" ? [] : [sourceReference],
      ...(node.metadata.origin === "publisher_derived"
        ? { transformation: "Deterministic projection from the cited publisher artifact." }
        : node.metadata.origin === "atlas_editorial"
          ? { transformation: "Control Atlas structural context." }
          : {}),
      review_status: "reviewed",
    }));
  return node;
}

function attachEntityProfilesAndEvidenceIntegrity(graph, registry) {
  const edgeByEvidenceId = new Map();
  for (const edge of graph.edges) {
    edge.relationship_type = normalizeProfileToken(edge.relationship_type);
    edge.status = edge.status || "active";
    edge.authority_class = edge.authority_class || (edge.publication_status === "editorial" ? "atlas_editorial" : "publisher");
    edge.entity_kind = "assertion";
    edge.profile_id = assertionProfileId(edge.relationship_type);
    edge.assertion_class = assertionClassForEdge(edge);
    for (const evidenceId of connectionEvidenceIdsForEdge(edge)) edgeByEvidenceId.set(evidenceId, edge);
  }
  for (const evidence of graph.evidence) {
    const edge = edgeByEvidenceId.get(evidence.id);
    const artifact = edge?.source_artifact_id ? registry.byId.get(edge.source_artifact_id) : null;
    const source = registry.byId.get(evidence.source_id);
    if (!evidence.checksum) {
      evidence.checksum = artifact?.checksum || artifact?.sha256 || source?.checksum || source?.sha256 || null;
    }
    if (!evidence.checksum) {
      evidence.integrity_status = evidence.evidence_quality === "editorial" ? "editorial" : "locator_only";
    }
    if (!evidence.source_version) {
      evidence.source_version = artifact?.version || source?.version || `retrieved:${String(evidence.retrieved_at || "unknown").slice(0, 10)}`;
      evidence.version_basis = artifact?.version || source?.version ? "publisher_or_artifact" : "retrieval_snapshot";
    }
  }
}

function pushEligibleNode(state, registry, node, sourceId) {
  const source = registry.byId.get(sourceId);
  if (!source?.graph_eligible) {
    state.findings.push({
      id: `finding:ineligible-node:${node.id}`,
      finding_type: "ineligible_source_node",
      severity: "warning",
      source_id: sourceId,
      subject_id: node.id,
      message: `Node ${node.id} was not published because its defining source is not graph eligible.`,
    });
    return;
  }
  if (node.metadata) {
    const presentation = {};
    if (SUPPORTED_RECORD_TYPE_SET.has(node.node_type)) {
      const profile = recordPresentationContract(node.metadata.catalog_id || "", node.node_type);
      for (const section of profile.sections.filter((entry) => entry.kind === "text")) {
        if (String(node.metadata[section.field] || "").trim()) {
          presentation[section.field] = buildSourceTextPresentation(node.metadata[section.field]);
        }
      }
    }
    if (Object.keys(presentation).length) node.metadata.source_text_presentation = presentation;
  }
  attachNodeProvenance(node, sourceId, registry);
  state.nodes.push(node);
}

function buildAssessmentNode(record, ingestionSourceId) {
  const assessment = record.metadata?.assessment;
  if (!assessment?.source_key) return null;
  const taxonomyTags = taxonomyTagsForRecord({
    catalog_id: "nist-800-53a",
    family: record.family || "",
  });
  return {
    id: assessmentNodeId(record.id),
    node_type: "assessment_procedure",
    label: `${record.id} Assessment Procedure`,
    source_id: assessment.source_key,
    lifecycle_status: record.status === "deprecated" ? "deprecated" : "active",
    // W1.3a: the assessment procedure is generated from this same control/
    // enhancement record, so record.id IS its parent's item_id by construction
    // — no join needed, no risk of a stale match.
    metadata: {
      catalog_id: "nist-800-53a",
      ingestion_source_id: ingestionSourceId,
      source_locator: `${record.source?.locator || `controls-800-53.json#${record.id}`}#assessment`,
      item_id: record.id,
      title: `${record.title || record.id} Assessment Procedure`,
      description: assessment.procedure_text || "",
      family: record.family || "",
      taxonomy_tags: taxonomyTags,
      type: "assessment_procedure",
      assessment_methods: assessment.methods.map((entry) => entry.method),
      assessment_method_details: assessment.methods,
      assessment_objects: assessment.objects,
      assessment_objectives: assessment.objectives,
      procedure_text: assessment.procedure_text || "",
      nist_control: record.id,
      references: null,
    },
  };
}

function buildCatalogSummaryNode(
  catalogId,
  publicationSourceId,
  ingestionSourceId,
  summary,
) {
  return {
    id: nodeId(catalogId, "CATALOG"),
    node_type: "catalog",
    label: summary.title,
    source_id: publicationSourceId,
    lifecycle_status: "active",
    metadata: {
      catalog_id: catalogId,
      ingestion_source_id: ingestionSourceId,
      item_id: "CATALOG",
      title: summary.title,
      family: "Catalog",
      baselines: null,
      nist_800_53b_baselines: null,
      nist_control: null,
      type: "catalog_summary",
      references: null,
    },
  };
}

function nodeSeverity(record) {
  return record.severity || record.cat || record.metadata?.severity || null;
}

export function lifecycleStatus(record) {
  if (record.status === "withdrawn") return "withdrawn";
  if (record.status === "deprecated") return "deprecated";
  return "active";
}

/** Add a resolved tier's node to the dedup map, once per distinct tier node id. */
function registerTierNode(
  tierNodes,
  catalogId,
  resolved,
  publicationSourceId,
  ingestionSourceId,
  record,
) {
  if (!resolved) return;
  const { tier, key, title, nodeId: tierNodeId, itemId, publisherItemId } = resolved;
  const existing = tierNodes.get(tierNodeId);
  if (existing) {
    existing.metadata.child_count = (existing.metadata.child_count || 0) + 1;
    const severity = nodeSeverity(record);
    if (severity) {
      existing.metadata.severity_distribution ||= {};
      existing.metadata.severity_distribution[severity] =
        (existing.metadata.severity_distribution[severity] || 0) + 1;
    }
    return;
  }
  const initialSeverity = nodeSeverity(record);
  const benchmarkVersion = record.source?.version || null;
  const benchmarkStatusDate = record.source?.snapshot_date || null;
  tierNodes.set(tierNodeId, {
    id: tierNodeId,
    node_type: tier.nodeType,
    label: tier.label ? tier.label(key, title) : title,
    source_id: publicationSourceId,
    lifecycle_status: "active",
    metadata: {
      catalog_id: catalogId,
      ingestion_source_id: ingestionSourceId,
      item_id: itemId,
      ...(publisherItemId ? { publisher_item_id: publisherItemId } : {}),
      title,
      ...(tier.description ? { description: tier.description(record, title) } : {}),
      ...(tier.descriptionProvenance ? { description_provenance: tier.descriptionProvenance } : {}),
      ...(tier.nodeType === "benchmark"
        ? {
            benchmark_version: benchmarkVersion,
            benchmark_status_date: benchmarkStatusDate,
            field_absence_reasons: {
              ...(benchmarkVersion ? {} : { benchmark_version: "The publisher source did not provide a benchmark version or release." }),
              ...(benchmarkStatusDate ? {} : { benchmark_status_date: "The publisher source did not provide a benchmark status date." }),
            },
            child_count: 1,
            severity_distribution: initialSeverity ? { [initialSeverity]: 1 } : {},
          }
        : {}),
      family: title,
      structural_group: true,
      baselines: null,
      nist_800_53b_baselines: null,
      nist_control: null,
      type: tier.nodeType === "family" ? "control_family" : tier.nodeType,
      references: null,
    },
  });
}

function buildNodes(registry) {
  const state = { nodes: [], findings: [] };
  const tierNodes = new Map();
  for (const [filename, catalogId, defaultSourceId, defaultType] of CATALOGS) {
    const path = join(ROOT, "data", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    for (const record of document.records || []) {
      const ingestionSourceId = record.source?.key || defaultSourceId;
      const identity = resolveCatalogPublicationIdentity({
        catalogId,
        ingestionSourceId,
        sourceById: registry.byId,
      });
      const id = nodeId(catalogId, record.id);
      if (!identity) {
        state.findings.push({
          id: `finding:missing-publication-identity:${id}`,
          finding_type: "missing_publication_identity",
          severity: "error",
          source_id: ingestionSourceId,
          subject_id: id,
          message: `Node ${id} was not published because its exact publication identity is unavailable.`,
        });
        continue;
      }
      const sourceId = identity.publicationSourceId;
      const resolvedTier = tierFor(catalogId, record);
      const primaryClassification = catalogId === "disa-cci"
        ? cciClassificationLabel(record.type)
        : resolvedTier?.title || record.family || record.group || "";
      const relatedCategories = catalogId === "disa-cci"
        ? referencedNistFamilies(record.references).map((family) => ({
            ...family,
            provenance: "referenced",
            source_ref: {
              locator: record.source?.locator || "",
              source_id: ingestionSourceId,
            },
          }))
        : [];
      const identityCategory = sourceNativeIdentityCategory({
        benchmarkId: record.metadata?.benchmark_id,
        benchmarkTitle: record.metadata?.benchmark_title,
        catalogId,
        family: primaryClassification,
      });
      const taxonomyTags = taxonomyTagsForRecord({
        ...record,
        catalog_id: catalogId,
        related_categories: relatedCategories,
      });
      const publisherTitle = publisherTitleFor(record, catalogId);
      pushEligibleNode(
        state,
        registry,
        {
          id,
          node_type: SUPPORTED_RECORD_TYPE_SET.has(record.type) && (
            /^(?:zt_|iot_|mobile_)/.test(record.type) || catalogId === "fedramp-2026"
          )
            ? record.type
            : nodeType(defaultType, record.id),
          // DISA CCI records carry their own identifier as the title, so the
          // naive "<id> <title>" join printed "CCI-000015 CCI-000015" on every
          // one of them (breadcrumbs, search results, Atlas labels).
          label:
            publisherTitle && !String(publisherTitle).startsWith(String(record.id))
              ? `${record.id} ${publisherTitle}`
              : String(publisherTitle || record.id),
          source_id: sourceId,
          lifecycle_status: lifecycleStatus(record),
          metadata: {
            catalog_id: catalogId,
            ingestion_source_id: ingestionSourceId,
            source_locator: record.source?.locator || `${filename}#${record.id}`,
            item_id: record.id,
            title: publisherTitle || record.id,
            // The NIST Mobile Threat Catalogue publishes a title plus
            // structured origin/examples/countermeasures. Older normalized
            // snapshots used a generated sentence when ThreatOrigin was
            // absent; never emit that adapter prose as publisher text.
            description:
              catalogId === "nist-mobile-threats" && record.type === "mobile_threat"
                ? ""
                : repairKnownSourceEncoding(record.description || ""),
            // The catalogue legitimately has three title-only entries. Surface
            // that source coverage explicitly instead of rendering an empty
            // record or inventing explanatory publisher prose.
            ...(catalogId === "nist-mobile-threats" && record.type === "mobile_threat" &&
            !record.metadata?.threat_origin &&
            !record.metadata?.exploit_examples?.length &&
            !record.metadata?.cve_examples?.length &&
            !record.metadata?.countermeasures?.length
              ? {
                  publisher_field_availability:
                    "NIST publishes a title for this threat but no origin, exploit example, CVE example, or possible countermeasure field.",
                }
              : {}),
            ...(record.publish_date
              ? { publication_date: record.publish_date }
              : {}),
            // A record's grouping label IS its parent tier's title — prefer it
            // over the raw record.family, which for some catalogs (e.g. ATT&CK)
            // is a machine slug ("command-and-control") kept for matching, not
            // display. Catalogs whose tier title already equals record.family
            // (800-53, 800-171, AI-RMF, SSDF, ...) see no change; STIG/SRG,
            // whose raw record.family is empty, keep resolving through the tier.
            family: primaryClassification,
            ...(taxonomyTags.length
              ? { taxonomy_tags: taxonomyTags }
              : {}),
            ...(identityCategory !== primaryClassification
              ? { identity_category: identityCategory }
              : {}),
            ...(catalogId === "disa-cci"
              ? {
                  classification_provenance: "publisher",
                  related_categories: relatedCategories,
                }
              : {}),
            severity: nodeSeverity(record),
            baselines:
              record.fedramp_baselines || record.metadata?.baselines || null,
            nist_800_53b_baselines:
              record.metadata?.nist_800_53b_baselines || null,
            nist_control: record.nist_control || null,
            type: record.type || null,
            references: record.references || null,
            check_text: record.check_text ? repairKnownSourceEncoding(record.check_text) : null,
            fix_text: record.fix_text ? repairKnownSourceEncoding(record.fix_text) : null,
            vuln_id: record.vuln_id || null,
            rule_id: record.rule_id || null,
            stig_id: record.stig_id || null,
            benchmark_id: record.metadata?.benchmark_id || null,
            benchmark_title: record.metadata?.benchmark_title || null,
            benchmark_version: record.source?.version || null,
            benchmark_status_date: record.source?.snapshot_date || null,
            published_cci_references: (record.metadata?.relationships || [])
              .filter((relationship) => relationship.target_catalog === "disa-cci")
              .map((relationship) => relationship.target_id),
            field_absence_reasons: Object.fromEntries([
              ["vuln_id", record.vuln_id, "The publisher source did not provide a Vuln ID."],
              ["rule_id", record.rule_id, "The publisher source did not provide a Rule ID."],
              ["stig_id", record.stig_id, "The publisher source did not provide a STIG ID."],
              ["benchmark_title", record.metadata?.benchmark_title, "The publisher source did not provide a benchmark title."],
              ["benchmark_version", record.source?.version, "The publisher source did not provide a benchmark version or release."],
              ["benchmark_status_date", record.source?.snapshot_date, "The publisher source did not provide a benchmark status date."],
            ].filter(([, value]) => !value).map(([field, , reason]) => [field, reason])),
            superseded_by: record.metadata?.superseded_by || null,
            discussion: record.metadata?.discussion || null,
            related_controls: record.metadata?.related_controls || null,
            tactic_id: record.metadata?.tactic_id || null,
            tactic_title: record.metadata?.tactic_title || null,
            tactic_memberships: record.metadata?.tactic_memberships || null,
            is_subtechnique: record.metadata?.is_subtechnique || false,
            // Resolved "(Citation: <key>)" references, so the record can render
            // the publisher's own source instead of MITRE's internal key.
            citations: record.metadata?.citations || null,
            parent_technique_id: record.metadata?.parent_technique_id || null,
            implementation_examples: record.metadata?.implementation_examples || null,
            informative_references: record.metadata?.informative_references || null,
            parent_id: record.metadata?.parent_id || null,
            source_fragments: record.metadata?.source_fragments || null,
            structured_content: record.metadata?.structured_content || null,
            document_sections: record.metadata?.document_sections || null,
            architecture_sections: record.metadata?.architecture_sections || null,
            implementation_sections: record.metadata?.implementation_sections || null,
            media: record.metadata?.media || null,
            related_build_codes: record.metadata?.related_build_codes || null,
            implementation_guide_url: record.metadata?.implementation_guide_url || null,
            source_pages: record.metadata?.source_pages || null,
            answer_options: record.metadata?.answer_options || null,
            publisher_default_answer: record.metadata?.publisher_default_answer || null,
            link_label: record.metadata?.link_label || null,
            question_number: record.metadata?.question_number || null,
            category: record.metadata?.category || null,
            pillar: record.metadata?.pillar || null,
            component_class: record.metadata?.component_class || null,
            threat_origin: record.metadata?.threat_origin || null,
            exploit_examples: record.metadata?.exploit_examples || null,
            cve_examples: record.metadata?.cve_examples || null,
            countermeasures: record.metadata?.countermeasures || null,
            publisher_context: record.metadata?.publisher_context || null,
            publisher_field: record.metadata?.publisher_field || null,
            publisher_status: record.metadata?.publisher_status || null,
            publisher_mappings: record.metadata?.publisher_mappings || null,
            collaborator: record.metadata?.collaborator || null,
            product: record.metadata?.product || null,
            architecture_component: record.metadata?.architecture_component || null,
            mapping_count: record.metadata?.mapping_count || null,
            mapping_targets: record.metadata?.mapping_targets || null,
            outcomes: record.metadata?.outcomes || null,
            end_state: record.metadata?.end_state || null,
            predecessors: record.metadata?.predecessors || null,
            successors: record.metadata?.successors || null,
            responsibility: record.metadata?.responsibility || null,
            activity_type: record.metadata?.activity_type || null,
            duration: record.metadata?.duration || null,
            operational_technology: record.metadata?.operational_technology || null,
            primary_artifact_id: record.metadata?.primary_artifact_id || null,
            contributing_artifact_ids: record.metadata?.contributing_artifact_ids || null,
            enrichment_artifact_ids: record.metadata?.enrichment_artifact_ids || null,
            // Duplicated onto the control's own node (not just the separate
            // assessment_procedure node buildAssessmentNode below emits) so a
            // viewer sees it without a full-graph fetch: atlas-neighborhood
            // shards only carry a compact id/type/title tuple for counterpart
            // nodes (src/app/atlas-neighborhood.mjs compactNode), so the
            // assessment_procedure counterpart's rich metadata is invisible
            // from the control's own record page. The control itself is
            // always the shard's center_node, which keeps full metadata.
            assessment_objectives: record.metadata?.assessment?.objectives || null,
            assessment_method_details: record.metadata?.assessment?.methods || null,
          },
        },
        sourceId,
      );

      if (catalogId === "nist-800-53") {
        const assessmentNode = buildAssessmentNode(record, ingestionSourceId);
        if (assessmentNode) {
          pushEligibleNode(
            state,
            registry,
            assessmentNode,
            assessmentNode.source_id,
          );
          registerTierNode(
            tierNodes,
            "nist-800-53a",
            tierFor("nist-800-53a", record),
            assessmentNode.source_id,
            ingestionSourceId,
            record,
          );
        }

      }

      for (const membership of tierMembershipsFor(catalogId, record)) {
        registerTierNode(
          tierNodes,
          catalogId,
          membership,
          sourceId,
          ingestionSourceId,
          record,
        );
        registerTierNode(
          tierNodes,
          catalogId,
          parentTierFor(catalogId, record, membership.tier),
          sourceId,
          ingestionSourceId,
          record,
        );
      }
    }

    const summary = CATALOG_SUMMARIES.get(catalogId);
    if (summary && (document.records || []).length) {
      const identity = resolveCatalogPublicationIdentity({
        catalogId,
        ingestionSourceId: defaultSourceId,
        sourceById: registry.byId,
      });
      if (!identity) continue;
      pushEligibleNode(
        state,
        registry,
        buildCatalogSummaryNode(
          catalogId,
          identity.publicationSourceId,
          identity.ingestionSourceId,
          summary,
        ),
        summary.sourceId,
      );
    }
  }

  for (const tierNode of tierNodes.values()) {
    pushEligibleNode(state, registry, tierNode, tierNode.source_id);
  }

  return {
    nodes: state.nodes.sort((a, b) => a.id.localeCompare(b.id)),
    findings: state.findings,
  };
}

function addPublishedEdge(state, registry, nodeIds, payload) {
  const source = registry.byId.get(payload.sourceId);
  if (
    !source?.graph_eligible ||
    !nodeIds.has(payload.sourceNodeId) ||
    !nodeIds.has(payload.targetNodeId)
  ) {
    state.findings.push({
      id: `finding:blocked-relationship:${payload.subjectId}`,
      finding_type: "blocked_relationship",
      severity: "warning",
      source_id: payload.sourceId,
      subject_id: payload.subjectId,
      message: `Relationship ${payload.subjectId} was blocked because its source or endpoint is not graph eligible.`,
    });
    return;
  }

  const edgeId = `edge:${payload.subjectId}`;
  const relationshipType = normalizeProfileToken(payload.relationshipType);
  const evidenceLocators = [...new Set(
    (payload.evidenceLocators?.length ? payload.evidenceLocators : [payload.locator || `${payload.sourceId}#relationship`])
      .filter(Boolean),
  )];
  const evidenceIds = evidenceLocators.map((_, index) =>
    index === 0 ? `evidence:${payload.subjectId}` : `evidence:${payload.subjectId}:${index + 1}`,
  );
  const publicationStatus = payload.publicationStatus || "published";
  const provenanceClass = payload.provenanceClass || source.provenance_class;

  let rationaleVal = payload.rationale || "";
  let warningVal = payload.warning || null;
  let ruleIdVal = payload.inferenceRuleId || null;

  if (publicationStatus === "candidate" || provenanceClass === "inferred") {
    if (!ruleIdVal) ruleIdVal = "inferred-mapping-rule";
    if (!warningVal)
      warningVal = "Candidate relationship inferred from adjacent metadata.";
    if (!rationaleVal) {
      rationaleVal = `Inferred relationship between ${payload.sourceNodeId} and ${payload.targetNodeId}.`;
    }
  }

  const sourceRefs = payload.sourceRefs || evidenceLocators.map((locator) => ({
    source_id: payload.sourceId,
    ref_type: payload.evidenceQuality || "primary",
    locator,
  }));

  evidenceLocators.forEach((locator, index) => {
    state.evidence.push({
      id: evidenceIds[index],
      source_id: payload.sourceId,
      source_version: payload.sourceVersion || source.version,
      locator,
      retrieved_at: payload.retrievedAt || source.retrieved_at,
      checksum: payload.checksum || source.checksum,
      evidence_quality: payload.evidenceQuality || "primary",
      ingestion_source_id: payload.ingestionSourceId || payload.sourceId,
    });
  });

  state.edges.push({
    id: edgeId,
    source_node_id: payload.sourceNodeId,
    target_node_id: payload.targetNodeId,
    relationship_type: relationshipType,
    raw_relationship_type: payload.rawRelationshipType || payload.relationshipType,
    relationship_class:
      payload.relationshipClass ||
      defaultRelationshipClass(relationshipType),
    mapping_model:
      payload.mappingModel ||
      payload.relationshipClass ||
      defaultRelationshipClass(relationshipType),
    source_artifact_id: aliasArtifact(payload.sourceArtifactId || `artifact-${payload.sourceId}`),
    source_locator: payload.locator || `${payload.sourceId}#relationship`,
    status: payload.status || "active",
    authority_class: payload.authorityClass || source?.authority_class || "publisher",
    provenance_class: provenanceClass,
    confidence:
      payload.confidence ||
      (publicationStatus === "candidate" ? "inferred_high" : "direct"),
    publication_status: publicationStatus,
    evidence_ids: evidenceIds,
    display_label:
      payload.displayLabel ||
      `${payload.sourceNodeId} ${payload.relationshipType} ${payload.targetNodeId}`,
    warning: warningVal,
    inference_rule_id: ruleIdVal,
    rationale: rationaleVal,
    source_refs: sourceRefs,
  });
}

function addDocumentRelationshipEdges(state, registry, nodeIds) {
  for (const [filename, catalogId, defaultSourceId] of CATALOGS) {
    const path = join(ROOT, "data", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    for (const record of document.records || []) {
      const ingestionSourceId = record.source?.key || defaultSourceId;
      const identity = resolveCatalogPublicationIdentity({
        catalogId,
        ingestionSourceId,
        sourceById: registry.byId,
      });
      if (!identity) continue;
      for (const relationship of record.metadata?.relationships || []) {
        const sourceNodeId = nodeId(catalogId, record.id);
        const targetNodeId = nodeId(
          relationship.target_catalog,
          relationship.target_id,
        );
        const subjectId = relationshipId(
          filename.replace(".json", ""),
          sourceNodeId,
          targetNodeId,
          relationship.relationship_type || "references",
        );
        addPublishedEdge(state, registry, nodeIds, {
          subjectId,
          sourceId: relationship.source_id || identity.publicationSourceId,
          ingestionSourceId,
          sourceNodeId,
          targetNodeId,
          relationshipType: relationship.relationship_type || "references",
          rawRelationshipType: relationship.raw_relationship_type,
          locator: relationship.source_locator || `${record.source?.locator || `${filename}#${record.id}`}->${relationship.target_catalog}:${relationship.target_id}`,
          evidenceLocators: relationship.source_locators,
          retrievedAt: record.source?.snapshot_date,
          rationale:
            relationship.rationale ||
            record.description ||
            document.provenance ||
            "",
        });
      }
    }
  }
}

function addExplicitParentHierarchyEdges(
  state,
  registry,
  nodeIds,
  catalogId,
  filename,
  defaultSourceId,
  defaultSourceArtifactId,
) {
  const path = join(ROOT, "data", filename);
  if (!existsSync(path)) return;
  const document = readJson(path);
  for (const record of document.records || []) {
    const parentId = record.metadata?.parent_id;
    if (!parentId) continue;
    const sourceNodeId = parentId === "CATALOG" ? `${catalogId}:CATALOG` : nodeId(catalogId, parentId);
    const targetNodeId = nodeId(catalogId, record.id);
    addPublishedEdge(state, registry, nodeIds, {
      subjectId: relationshipId(`${catalogId}-explicit-parent`, sourceNodeId, targetNodeId, "contains"),
      sourceId: record.source?.key || defaultSourceId,
      sourceArtifactId:
        record.source?.artifact_id ||
        record.metadata?.contributing_artifact_ids?.[0] ||
        defaultSourceArtifactId,
      sourceNodeId,
      targetNodeId,
      relationshipType: "contains",
      relationshipClass: RELATIONSHIP_CLASSES.structural,
      confidence: "direct",
      locator: record.source?.locator || `${filename}#${record.id}`,
      retrievedAt: record.source?.snapshot_date,
      rationale: `${record.id} is published beneath ${parentId} in the ${catalogId} source structure.`,
    });
  }
}

/**
 * Join every record to its parent tier with a structural `contains` edge.
 * Driven entirely by CATALOG_TIERS, so a catalog
 * gains its branch level by adding a row, not by editing this function.
 */
function addTierMembershipEdges(state, registry, nodeIds) {
  for (const [filename, catalogId, defaultSourceId] of CATALOGS) {
    if (!CATALOG_TIERS[catalogId]) continue;
    const path = join(ROOT, "data", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    for (const record of document.records || []) {
      const ingestionSourceId = record.source?.key || defaultSourceId;
      const identity = resolveCatalogPublicationIdentity({
        catalogId,
        ingestionSourceId,
        sourceById: registry.byId,
      });
      if (!identity) continue;
      const memberships = tierMembershipsFor(catalogId, record);
      if (!memberships.length) continue;
      // Enhancement-style children have a more specific publisher-native
      // parent. Do not also attach them directly to the outer grouping tier.
      if (catalogId === "nist-800-53" && String(record.id).includes(".")) continue;
      if (
        (catalogId === "mitre-attack" || catalogId === "mitre-attack-ics") &&
        record.metadata?.parent_technique_id
      ) continue;
      for (const { tier, title, nodeId: sourceNodeId } of memberships) {
        const targetNodeId = nodeId(catalogId, record.id);
        const subjectId = relationshipId(tier.edgeDataset, sourceNodeId, targetNodeId, "contains");
        addPublishedEdge(state, registry, nodeIds, {
          subjectId,
          sourceId: identity.publicationSourceId,
          ingestionSourceId,
          sourceNodeId,
          targetNodeId,
          relationshipType: "contains",
          relationshipClass: RELATIONSHIP_CLASSES.structural,
          confidence: "derived",
          locator: record.source?.locator || `${filename}#${record.id}`,
          retrievedAt: record.source?.snapshot_date,
          rationale: tier.rationale(record, title),
        });
      }
    }
  }
}

/**
 * Join a tier to ITS parent tier (e.g. CSF Category -> Function) for catalogs
 * whose CATALOG_TIERS row declares `parentTier`. Most catalogs are one tier
 * deep and have none, so this is a no-op for them.
 */
function addTierParentEdges(state, registry, nodeIds) {
  const seen = new Set();
  for (const [filename, catalogId, defaultSourceId] of CATALOGS) {
    const tier = CATALOG_TIERS[catalogId];
    if (!tier?.parentTier) continue;
    const path = join(ROOT, "data", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    for (const record of document.records || []) {
      const ingestionSourceId = record.source?.key || defaultSourceId;
      const identity = resolveCatalogPublicationIdentity({
        catalogId,
        ingestionSourceId,
        sourceById: registry.byId,
      });
      if (!identity) continue;
      const resolved = tierFor(catalogId, record);
      if (!resolved) continue;
      const parent = parentTierFor(catalogId, record, resolved.tier);
      if (!parent) continue;
      const subjectId = relationshipId(
        parent.tier.edgeDataset,
        parent.nodeId,
        resolved.nodeId,
        "contains",
      );
      if (seen.has(subjectId)) continue;
      seen.add(subjectId);
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: identity.publicationSourceId,
        ingestionSourceId,
        sourceNodeId: parent.nodeId,
        targetNodeId: resolved.nodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || `${filename}#${record.id}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: parent.tier.rationale(record, parent.title),
      });
    }
  }
}

/**
 * Every catalog that declares a CATALOG_TIERS row gets its outermost tier
 * (the parent tier when one is declared, else the tier itself) linked to the
 * catalog's own summary node, so nothing hangs disconnected above the tree —
 * this enforces docs/DATA_POLICY.md's
 * "family (20) has no parent itself" finding for every tiered catalog, not
 * only SP 800-53.
 */
function addTierToCatalogEdges(state, registry, nodeIds) {
  const seen = new Set();
  for (const [filename, catalogId, defaultSourceId] of CATALOGS) {
    if (!CATALOG_TIERS[catalogId]) continue;
    const catalogNodeId = nodeId(catalogId, "CATALOG");
    if (!nodeIds.has(catalogNodeId)) continue;
    const path = join(ROOT, "data", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    for (const record of document.records || []) {
      const ingestionSourceId = record.source?.key || defaultSourceId;
      const identity = resolveCatalogPublicationIdentity({
        catalogId,
        ingestionSourceId,
        sourceById: registry.byId,
      });
      if (!identity) continue;
      const tops = tierMembershipsFor(catalogId, record).map((resolved) =>
        parentTierFor(catalogId, record, resolved.tier) || resolved);
      if (!tops.length) continue;
      for (const top of tops) {
        const subjectId = relationshipId(
        `${catalogId}-catalog-membership`,
        catalogNodeId,
        top.nodeId,
        "contains",
        );
        if (seen.has(subjectId)) continue;
        seen.add(subjectId);
        addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: identity.publicationSourceId,
        ingestionSourceId,
        sourceNodeId: catalogNodeId,
        targetNodeId: top.nodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || `${filename}#${record.id}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: `${top.title} is organized under the ${catalogId} catalog.`,
        });
      }
    }
  }
}

function baseControlIdFromEnhancementId(recordId) {
  const id = String(recordId || "");
  const dotIndex = id.indexOf(".");
  return dotIndex === -1 ? null : id.slice(0, dotIndex);
}

function addEnhancementMembershipEdges(state, registry, nodeIds) {
  const path = join(ROOT, "data", "controls-800-53.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  const recordIds = new Set(
    (document.records || []).map((record) => record.id),
  );
  const existingEdgeIds = new Set(state.edges.map((edge) => edge.id));
  for (const record of document.records || []) {
    if (!String(record.id).includes(".")) continue;
    const baseId = baseControlIdFromEnhancementId(record.id);
    if (!baseId || !recordIds.has(baseId)) continue;
    const sourceNodeId = nodeId("nist-800-53", baseId);
    const targetNodeId = nodeId("nist-800-53", record.id);
    const subjectId = relationshipId(
      "800-53-enhancement-membership",
      sourceNodeId,
      targetNodeId,
      "contains",
    );
    if (existingEdgeIds.has(`edge:${subjectId}`)) continue;
    addPublishedEdge(state, registry, nodeIds, {
      subjectId,
      sourceId: "nist-800-53",
      ingestionSourceId: record.source?.key || "nist-oscal",
      sourceNodeId,
      targetNodeId,
      relationshipType: "contains",
      relationshipClass: RELATIONSHIP_CLASSES.structural,
      confidence: "derived",
      locator: record.source?.locator || `controls-800-53.json#${record.id}`,
      retrievedAt: record.source?.snapshot_date,
      rationale: `${record.id} is a control enhancement of ${baseId} in SP 800-53 Rev. 5.`,
    });
  }
}

/**
 * Nest ATT&CK sub-techniques (e.g. T1055.001) under their parent technique
 * (T1055) — the same enhancement-of-a-base-record pattern as SP 800-53
 * above, driven by `metadata.parent_technique_id`
 * (tools/importers/mitre-attack-adapter.mjs), not string-splitting the id
 * here, since the STIX bundle's own `x_mitre_is_subtechnique` flag is the
 * authoritative signal.
 */
function addAttackSubtechniqueMembershipEdges(state, registry, nodeIds) {
  for (const [filename, catalogId, defaultSourceId] of [
    ["attack-techniques-enterprise.json", "mitre-attack", "mitre-attack-enterprise"],
    ["attack-techniques-ics.json", "mitre-attack-ics", "mitre-attack-ics"],
  ]) {
    const path = join(ROOT, "data", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    const recordIds = new Set((document.records || []).map((record) => record.id));
    for (const record of document.records || []) {
      const parentId = record.metadata?.parent_technique_id;
      if (!parentId || !recordIds.has(parentId)) continue;
      const sourceNodeId = nodeId(catalogId, parentId);
      const targetNodeId = nodeId(catalogId, record.id);
      const subjectId = relationshipId(
        `${catalogId}-subtechnique-membership`,
        sourceNodeId,
        targetNodeId,
        "contains",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: record.source?.key || defaultSourceId,
        sourceNodeId,
        targetNodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || `${filename}#${record.id}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: `${record.id} is a sub-technique of ${parentId}.`,
      });
    }
  }
}

function addBaselineMembershipEdges(state, registry, nodeIds) {
  const path = join(ROOT, "data", "controls-800-53.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  for (const record of document.records || []) {
    const baselineIds = [
      ...new Set(
        (record.metadata?.nist_800_53b_baselines || [])
          .map(normalize53BBaselineId)
          .filter(Boolean),
      ),
    ];
    for (const baselineId of baselineIds) {
      const sourceNodeId = nodeId("nist-800-53b", baselineId);
      const targetNodeId = nodeId("nist-800-53", record.id);
      const subjectId = relationshipId(
        "800-53b-membership",
        sourceNodeId,
        targetNodeId,
        "selects",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: "nist-800-53b-baselines",
        sourceNodeId,
        targetNodeId,
        relationshipType: "selects",
        relationshipClass: RELATIONSHIP_CLASSES.applicability,
        locator: `sp800-53b#${baselineId}:${record.id}`,
        rationale: `NIST SP 800-53B ${baselineId} baseline membership includes ${record.id}.`,
      });
    }
  }
}

/**
 * FedRAMP control context (issue 279) folds into the SP 800-53 control it
 * annotates rather than staying a standalone page, so the control's own page
 * needs a real edge to find it - a raw id lookup alone only works when the
 * corpus is fully loaded, which a record page's own neighborhood is not.
 */
function addControlContextEdges(state, registry, nodeIds) {
  const path = join(ROOT, "data", "fedramp-2026-catalog.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  for (const record of document.records || []) {
    if (record.type !== "control_context") continue;
    const targetLabel = controlContextLabel(record.id);
    if (!targetLabel) continue;
    const sourceNodeId = nodeId("fedramp-2026", record.id);
    const targetNodeId = nodeId("nist-800-53", targetLabel);
    const subjectId = relationshipId("fedramp-2026-control-context", sourceNodeId, targetNodeId, CONTROL_CONTEXT_RELATIONSHIP_TYPE);
    addPublishedEdge(state, registry, nodeIds, {
      subjectId,
      sourceId: record.source?.key || "fedramp-2026-rules",
      sourceNodeId,
      targetNodeId,
      relationshipType: CONTROL_CONTEXT_RELATIONSHIP_TYPE,
      relationshipClass: RELATIONSHIP_CLASSES.correlation,
      locator: record.source?.locator || `fedramp-2026#${record.id}`,
      retrievedAt: record.source?.snapshot_date,
      rationale: `FedRAMP publishes ${record.id} as parameters and guidance for ${targetLabel}.`,
    });
  }
}

function addFedrampMembershipEdges(state, registry, nodeIds) {
  const path = join(ROOT, "data", "fedramp-baselines.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  for (const record of document.records || []) {
    const sourceNodeId = nodeId("fedramp-rev5", record.id);
    for (const controlId of record.metadata?.controls || []) {
      const targetNodeId = nodeId("nist-800-53", controlId);
      const subjectId = relationshipId(
        "fedramp-membership",
        sourceNodeId,
        targetNodeId,
        "selects",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: record.source?.key || "fedramp-rev5",
        sourceNodeId,
        targetNodeId,
        relationshipType: "selects",
        relationshipClass: RELATIONSHIP_CLASSES.applicability,
        locator: `${record.source?.locator || `fedramp#${record.id}`}:${controlId}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: `${record.title} includes ${controlId} in the published FedRAMP Rev. 5 baseline membership.`,
      });
    }
  }
}

function addAssessmentEdges(state, registry, nodeIds) {
  const path = join(ROOT, "data", "controls-800-53.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  for (const record of document.records || []) {
    const sourceId = record.metadata?.assessment?.source_key;
    if (!sourceId) continue;
    const sourceNodeId = assessmentNodeId(record.id);
    const targetNodeId = nodeId("nist-800-53", record.id);
    const subjectId = relationshipId(
      "800-53a-assessment",
      sourceNodeId,
      targetNodeId,
      "assesses",
    );
    addPublishedEdge(state, registry, nodeIds, {
      subjectId,
      sourceId,
      sourceNodeId,
      targetNodeId,
      relationshipType: "assesses",
      locator: `sp800-53a#${record.id}`,
      rationale: `NIST SP 800-53A assessment procedures for ${record.id} assess the corresponding control.`,
      displayLabel: `${sourceNodeId} assesses ${targetNodeId}`,
    });
  }
}

function addAssessmentHierarchyEdges(state, registry, nodeIds, nodes) {
  for (const procedure of nodes.filter(
    (node) => node.node_type === "assessment_procedure" && catalogIdOf(node) === "nist-800-53a",
  )) {
    const familyCode = familyCodeFromControlId(procedure.metadata?.item_id);
    if (!familyCode) continue;
    const familyNodeId = `nist-800-53a:FAMILY-${familyCode}`;
    const sourceId = procedure.source_id;
    const ingestionSourceId = procedure.metadata?.ingestion_source_id || sourceId;
    addPublishedEdge(state, registry, nodeIds, {
      subjectId: relationshipId(
        "800-53a-family-membership",
        familyNodeId,
        procedure.id,
        "contains",
      ),
      sourceId,
      ingestionSourceId,
      sourceNodeId: familyNodeId,
      targetNodeId: procedure.id,
      relationshipType: "contains",
      relationshipClass: RELATIONSHIP_CLASSES.structural,
      confidence: "derived",
      locator: `sp800-53a#${procedure.metadata?.item_id || procedure.id}`,
      rationale: `${procedure.metadata?.item_id || procedure.id} is an assessment procedure in the ${familyCode} family.`,
    });
  }
}

function addCmmcProgramEdges(state, registry, nodeIds, nodes) {
  const path = join(ROOT, "data", "cmmc-practices.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  const rev2Requirements = nodes.filter(
    (node) =>
      node.metadata?.catalog_id === "nist-800-171-rev2" &&
      node.node_type === "requirement",
  );
  for (const record of document.records || []) {
    const sourceNodeId = nodeId("cmmc-2", record.id);
    if (record.metadata?.requires_800_171_rev === "rev2") {
      for (const requirement of rev2Requirements) {
        const subjectId = relationshipId(
          "cmmc-level2",
          sourceNodeId,
          requirement.id,
          "requires",
        );
        addPublishedEdge(state, registry, nodeIds, {
          subjectId,
          sourceId: record.source?.key || "dod-cmmc-rule",
          sourceNodeId,
          targetNodeId: requirement.id,
          relationshipType: "requires",
          confidence: "derived",
          locator: record.source?.locator || "32-CFR-170.14(c)(3)",
          retrievedAt: record.source?.snapshot_date,
          rationale: `${record.title} uses the 110 requirements in NIST SP 800-171 Rev. 2.`,
        });
      }
    }
    if (record.metadata?.requires_800_172) {
      for (const targetNodeId of [
        "nist-800-171-rev2:CATALOG",
        "nist-800-172:CATALOG",
      ]) {
        const subjectId = relationshipId(
          "cmmc-level3",
          sourceNodeId,
          targetNodeId,
          "depends_on",
        );
        addPublishedEdge(state, registry, nodeIds, {
          subjectId,
          sourceId: record.source?.key || "dod-cmmc-rule",
          sourceNodeId,
          targetNodeId,
          relationshipType: "depends_on",
          confidence: "derived",
          locator: record.source?.locator || "32-CFR-170.14(c)(4)",
          retrievedAt: record.source?.snapshot_date,
          rationale: `${record.title} depends on SP 800-171 Rev. 2 and SP 800-172 requirement context.`,
        });
      }
    }
  }

  // Every CMMC level is a real child of the CMMC 2.0 program, regardless of
  // which external requirement set it also `requires` — Level 1 requires
  // only the 15 FAR 52.204-21 basic safeguarding requirements, a catalog
  // this app does not ingest, so it was the one level with no edge at all
  // (isolated) before this. Parenting all three under the catalog fixes
  // that honestly instead of fabricating a link to an uningested source.
  const catalogNodeId = "cmmc-2:CATALOG";
  for (const record of document.records || []) {
    const targetNodeId = nodeId("cmmc-2", record.id);
    const subjectId = relationshipId(
      "cmmc-program-membership",
      catalogNodeId,
      targetNodeId,
      "contains",
    );
    addPublishedEdge(state, registry, nodeIds, {
      subjectId,
      sourceId: record.source?.key || "dod-cmmc-rule",
      sourceNodeId: catalogNodeId,
      targetNodeId,
      relationshipType: "contains",
      relationshipClass: RELATIONSHIP_CLASSES.structural,
      confidence: "derived",
      locator: record.source?.locator || "32-CFR-170.14",
      retrievedAt: record.source?.snapshot_date,
      rationale: `${record.title} is one of the three CMMC 2.0 program levels.`,
    });
  }
}

function addDodZeroTrustHierarchyEdges(state, registry, nodeIds) {
  const path = join(ROOT, "data", "dod-zt.json");
  if (!existsSync(path)) return;
  const document = readJson(path);
  for (const record of document.records || []) {
    if (record.type === "zt_overlay_catalog") {
      // The overlay reference document itself (source of the 799 SP 800-53
      // <-> ZT capability `supports` mappings below) — a sibling of the
      // tenets, not a container for the capabilities it documents.
      const catalogNodeId = "dod-zt:CATALOG";
      const targetNodeId = nodeId("dod-zt", record.id);
      const subjectId = relationshipId(
        "dod-zt-overlay-catalog-membership",
        catalogNodeId,
        targetNodeId,
        "contains",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: record.source?.key || "dod-zt-overlays-2024",
        sourceNodeId: catalogNodeId,
        targetNodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || `dod-zt.json#${record.id}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: `${record.title} is part of the DoD Zero Trust reference material.`,
      });
      continue;
    }
    if (record.type === "zt_tenet") {
      // Tenets are cross-cutting principles that apply across every pillar in
      // the DoD Zero Trust Reference Architecture, not a subdivision of any
      // one pillar (no source field ties a specific tenet to specific
      // pillars) — so "tenet includes pillar" would fabricate a containment
      // relationship the data doesn't support. What the audit actually
      // measured as the bug is that tenets had zero edges at all; the honest
      // fix is parenting them to the catalog as their own sibling
      // collection, alongside (not above) the pillars.
      const catalogNodeId = "dod-zt:CATALOG";
      const targetNodeId = nodeId("dod-zt", record.id);
      const subjectId = relationshipId(
        "dod-zt-tenet-membership",
        catalogNodeId,
        targetNodeId,
        "contains",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: record.source?.key || "dod-zt-reference-architecture-v2",
        sourceNodeId: catalogNodeId,
        targetNodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || `dod-zt.json#${record.id}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: `${record.id} is one of the foundational tenets of the DoD Zero Trust model.`,
      });
      continue;
    }
    if (record.type === "zt_pillar" || record.type === "zt_document") {
      const catalogNodeId = "dod-zt:CATALOG";
      const targetNodeId = nodeId("dod-zt", record.id);
      const subjectId = relationshipId(
        "dod-zt-catalog-membership",
        catalogNodeId,
        targetNodeId,
        "contains",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: record.source?.key || "dod-zt-reference-architecture-v2",
        sourceNodeId: catalogNodeId,
        targetNodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || `dod-zt.json#${record.id}`,
        retrievedAt: record.source?.snapshot_date,
        rationale: `${record.title} is part of the native DoD Zero Trust structure.`,
      });
      continue;
    }
    if (record.type !== "zt_capability" && record.type !== "zt_activity")
      continue;
    const parentId =
      record.type === "zt_capability"
        ? record.metadata?.pillar_id
        : record.metadata?.capability_id;
    if (!parentId) continue;
    const sourceNodeId = nodeId("dod-zt", parentId);
    const targetNodeId = nodeId("dod-zt", record.id);
    const subjectId = relationshipId(
      "dod-zt-hierarchy",
      sourceNodeId,
      targetNodeId,
      "contains",
    );
    addPublishedEdge(state, registry, nodeIds, {
      subjectId,
      sourceId: record.source?.key || "dod-zt-reference-architecture-v2",
      sourceNodeId,
      targetNodeId,
      relationshipType: "contains",
      relationshipClass: RELATIONSHIP_CLASSES.structural,
      confidence: "derived",
      locator: record.source?.locator || `dod-zt.json#${record.id}`,
      retrievedAt: record.source?.snapshot_date,
      rationale: `${parentId} includes ${record.id} in the DoD Zero Trust model.`,
    });
  }
}

function addCuiPolicyEdges(state, registry, nodeIds) {
  const relationships = [
    {
      subjectId: "issue12-171r2-cui-basic",
      sourceId: "nist-800-171-rev2",
      sourceNodeId: "nist-800-171-rev2:CATALOG",
      targetNodeId: "cui-policy:CUI-BASIC",
      relationshipType: "protects",
      confidence: "inferred",
      locator: "abstract",
      rationale:
        "SP 800-171 Rev. 2 protects the confidentiality of CUI in nonfederal systems where no category-specific handling controls are prescribed.",
    },
    {
      subjectId: "issue12-171r3-cui-basic",
      sourceId: "nist-800-171",
      ingestionSourceId: "nist-oscal",
      sourceNodeId: "nist-800-171:CATALOG",
      targetNodeId: "cui-policy:CUI-BASIC",
      relationshipType: "protects",
      confidence: "inferred",
      locator: "abstract",
      rationale:
        "SP 800-171 Rev. 3 protects the confidentiality of CUI in nonfederal systems where no category-specific handling controls are prescribed.",
    },
    {
      subjectId: "issue12-172-cui-program",
      sourceId: "nist-800-172-rev3",
      sourceNodeId: "nist-800-172:CATALOG",
      targetNodeId: "cui-policy:CUI-PROGRAM",
      relationshipType: "supports",
      confidence: "inferred",
      locator: "abstract",
      rationale:
        "SP 800-172 Rev. 3 provides enhanced security requirements for protecting CUI associated with critical programs or high value assets.",
    },
  ];

  for (const relationship of relationships) {
    addPublishedEdge(state, registry, nodeIds, relationship);
  }

  // Every CUI designation is a real child of the CUI Program catalog. Basic
  // and Program already carry a specific `protects`/`supports` edge above;
  // Specified has no single catalog that governs it in this app's ingested
  // set (each CUI Specified category cites its own separate law/regulation),
  // so without this it was the one designation with zero edges at all.
  //
  // Real NARA registry categories (type cui-category, spec §7) nest one
  // level deeper, under whichever designation anchor
  // (CUI-BASIC/CUI-SPECIFIED/CUI-PROGRAM) their own registry data resolved
  // to (metadata.parent_designation) — not flatly under the catalog root.
  const path = join(ROOT, "data", "cui-policy.json");
  if (existsSync(path)) {
    const document = readJson(path);
    const catalogNodeId = "cui-policy:CATALOG";
    for (const record of document.records || []) {
      const targetNodeId = nodeId("cui-policy", record.id);
      const isCategory = record.type === "cui-category";
      const sourceNodeId = isCategory
        ? nodeId("cui-policy", record.metadata?.parent_designation || "CUI-PROGRAM")
        : catalogNodeId;
      const subjectId = relationshipId(
        "cui-policy-program-membership",
        sourceNodeId,
        targetNodeId,
        "contains",
      );
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId: record.source?.key || "isoo-cui-regulation",
        sourceNodeId,
        targetNodeId,
        relationshipType: "contains",
        relationshipClass: RELATIONSHIP_CLASSES.structural,
        confidence: "derived",
        locator: record.source?.locator || "32-CFR-2002",
        retrievedAt: record.source?.snapshot_date,
        rationale: isCategory
          ? `${record.title} is a NARA CUI Registry category classified ${record.metadata?.designation || "unresolved"} under ${record.metadata?.parent_designation || "CUI Program"}.`
          : `${record.title} is one of the designation categories in the CUI Program.`,
      });
    }
  }
}

/**
 * W1.2/W1.3d — the `nist-800-53:CATALOG` node's structural parent, derived
 * from the already-published CSF<->800-53 OLIR correlation edges (no new
 * source: see docs/DATA_POLICY.md for why a catalog's
 * "zero edges" premise was disproven). The individual control<->subcategory
 * correlation stays `maps_to` per docs/DATA_POLICY.md — one
 * control maps to dozens of subcategories across every function, so no
 * single function can honestly "contain" a control. What CAN take a single
 * structural parent is the catalog as a whole: the CSF Function that the
 * plurality of its controls' correlation edges point to.
 */
function buildEdges(registry, nodes) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const state = { edges: [], evidence: [], findings: [] };

  for (const [
    filename,
    sourceCatalog,
    targetCatalog,
    defaultSourceId,
  ] of MAPS) {
    const path = join(ROOT, "maps", filename);
    if (!existsSync(path)) continue;
    const document = readJson(path);
    for (const [index, relationship] of (
      document.relationships || []
    ).entries()) {
      const sourceNodeId = resolveMapEndpointNodeId(
        relationship.source_catalog || sourceCatalog,
        relationship.source_id,
        nodeIds,
      );
      const targetNodeId = resolveMapEndpointNodeId(
        relationship.target_catalog || targetCatalog,
        relationship.target_id,
        nodeIds,
      );
      const sourceId =
        relationship.evidence_source || document.source_key || defaultSourceId;
      const subjectId = `${filename.replace(".json", "")}:${index + 1}`;
      addPublishedEdge(state, registry, nodeIds, {
        subjectId,
        sourceId,
        sourceNodeId,
        targetNodeId,
        relationshipType: relationship.relationship_type || "maps_to",
        // A map file may declare how strong its own mapping is. Only the Rev 4
        // crosswalk does today: its edges compose two published documents rather
        // than restating one, so they are "derived", not "direct".
        confidence: relationship.confidence,
        sourceVersion: document.source_version,
        locator:
          relationship.source_locator ||
          `${document.source_key || sourceId}#relationship`,
        retrievedAt: document.snapshot_date,
        checksum: document.checksum,
        rationale: relationship.why || document.provenance || "",
      });
    }
  }
  addDocumentRelationshipEdges(state, registry, nodeIds);
  addTierMembershipEdges(state, registry, nodeIds);
  addTierParentEdges(state, registry, nodeIds);
  addTierToCatalogEdges(state, registry, nodeIds);
  addEnhancementMembershipEdges(state, registry, nodeIds);
  addAttackSubtechniqueMembershipEdges(state, registry, nodeIds);
  addBaselineMembershipEdges(state, registry, nodeIds);
  addFedrampMembershipEdges(state, registry, nodeIds);
  addControlContextEdges(state, registry, nodeIds);
  addAssessmentEdges(state, registry, nodeIds);
  addAssessmentHierarchyEdges(state, registry, nodeIds, nodes);
  addCmmcProgramEdges(state, registry, nodeIds, nodes);
  addDodZeroTrustHierarchyEdges(state, registry, nodeIds);
  addExplicitParentHierarchyEdges(state, registry, nodeIds, "nist-zt", "nist-zt.json", "nist-sp-800-207");
  addExplicitParentHierarchyEdges(
    state,
    registry,
    nodeIds,
    "nist-iot-cybersecurity",
    "nist-iot-cybersecurity.json",
    "nist-iot-device-cybersecurity-requirement-catalogs",
    "artifact-nist-iot-requirements-80053-mapping-draft",
  );
  addExplicitParentHierarchyEdges(state, registry, nodeIds, "nist-mobile-threats", "nist-mobile-threats.json", "nist-mobile-threat-catalogue");
  addCuiPolicyEdges(state, registry, nodeIds);
  return state;
}

function attachPublisherStructuralOrder(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nextByParent = new Map();
  for (const edge of edges) {
    if (edge.relationship_class !== RELATIONSHIP_CLASSES.structural) continue;
    const child = nodesById.get(edge.target_node_id);
    const parent = nodesById.get(edge.source_node_id);
    const publicationId = child?.metadata?.catalog_id || parent?.metadata?.catalog_id || "";
    const key = `${publicationId}\u0000${edge.source_node_id}`;
    const order = nextByParent.get(key) || 0;
    edge.publisher_order = order;
    nextByParent.set(key, order + 1);
  }
}

export function validateDataTrustContracts(nodes, edges) {
  const failures = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.metadata?.item_id && !NON_RECORD_NODE_TYPES.has(node.node_type) && node.metadata?.structural_group !== true) {
      const envelope = sourceRecordEnvelopeForNode(node);
      for (const failure of validateSourceRecordEnvelope(envelope)) {
        failures.push(`${node.id}: SourceRecordEnvelope ${failure}`);
      }
    }
    for (const fragment of node.metadata?.source_fragments || []) {
      for (const failure of validateSourceFragment(fragment)) {
        failures.push(`${node.id}: SourceFragment ${failure}`);
      }
    }
    for (const failure of validateCanonicalLayerAssignment(node)) {
      failures.push(`${node.id}: CanonicalLayer ${failure}`);
    }
    for (const failure of validateNativeTypeAssignment(node)) {
      failures.push(`${node.id}: NativeType ${failure}`);
    }
    for (const failure of validatePublicationIdAssignment(node)) {
      failures.push(`${node.id}: PublicationId ${failure}`);
    }
    for (const failure of validateSourceMaterialIdAssignment(node)) {
      failures.push(`${node.id}: SourceMaterialId ${failure}`);
    }
  }
  const nodeIds = new Set(nodesById.keys());
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const edge of edges) {
    if (edge.relationship_class === RELATIONSHIP_CLASSES.structural) {
      const membership = publisherStructureMembershipForEdge(edge, nodesById);
      for (const failure of validatePublisherStructureMembership(membership)) {
        failures.push(`${edge.id}: PublisherStructureMembership ${failure}`);
      }
    }
    for (const failure of validateConnectionEvidenceIsolation(edge, nodeIds, edgeIds)) {
      failures.push(`${edge.id}: ConnectionEvidence ${failure}`);
    }
    for (const failure of validateRelationshipEvidenceAttachment(edge)) {
      failures.push(`${edge.id}: RelationshipEvidence ${failure}`);
    }
  }
  return failures;
}

/**
 * OLIR mappings can name a publisher-native grouping concept rather than a
 * leaf record. Preserve that distinction: an 800-53 family or CSF category
 * must resolve to its real grouping node, never become a blocked leaf lookup
 * or a made-up control-to-control mapping.
 */
function resolveMapEndpointNodeId(catalogId, rawId, nodeIds) {
  const itemId = normalizeControlId(rawId);
  const leafNodeId = nodeId(catalogId, itemId);
  if (nodeIds.has(leafNodeId)) return leafNodeId;

  if (catalogId === "nist-800-53" && /^[A-Z]{2}$/.test(itemId)) {
    const familyNodeId = nodeId(catalogId, `FAMILY-${itemId}`);
    if (nodeIds.has(familyNodeId)) return familyNodeId;
  }

  if (catalogId === "csf-2" && /^[A-Z]{2}\.[A-Z]{2}$/.test(itemId)) {
    const categoryNodeId = nodeId(catalogId, `CATEGORY-${itemId}`);
    if (nodeIds.has(categoryNodeId)) return categoryNodeId;
  }

  return leafNodeId;
}

function artifact(collection, values, generatedAt) {
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    [collection]: values,
  };
}

export function buildTaxonomyCoverage(nodes, catalogs) {
  const catalogNames = new Map(catalogs.map((catalog) => [catalog.id, catalog.name]));
  const taxonomyTagById = new Map(TAXONOMY_CONTRACT.tags.map((tag) => [tag.id, tag]));
  const identityByKey = new Map(IDENTITY_REGISTRY.map((identity) => [identity.key, identity]));
  const byCatalog = new Map();
  const byRecordType = new Map();
  const byDimension = new Map(
    TAXONOMY_CONTRACT.dimensions.map((dimension) => [
      dimension.id,
      {
        dimension: dimension.id,
        label: dimension.label,
        record_count: 0,
        applicable_record_count: 0,
        not_applicable_record_count: 0,
        unreviewed_record_count: 0,
        tag_assignments: 0,
      },
    ]),
  );
  const bySourceField = new Map();
  const bySourceBasis = new Map();
  const byAssignmentLayer = new Map();
  const byRule = new Map();
  const byNotApplicableBasis = new Map();
  const assignedTagIds = new Set();
  const identityAssignedRecordIds = new Set();
  const fallbackAssignedRecordIds = new Set();
  const unresolvedLegacyLabels = new Map();
  let identityTagAssignments = 0;
  let fallbackTagAssignments = 0;
  const records = nodes.filter(
    (node) =>
      node.metadata?.catalog_id &&
      node.node_type !== "catalog" &&
      node.node_type !== "benchmark",
  );

  for (const node of records) {
    const catalogId = node.metadata.catalog_id;
    const tags = node.metadata?.taxonomy_tags || [];
    const catalog = byCatalog.get(catalogId) || {
      catalog_id: catalogId,
      catalog_name: catalogNames.get(catalogId) || catalogId,
      record_count: 0,
      tagged_record_count: 0,
      tag_assignments: 0,
      dimensions: {},
    };
    catalog.record_count += 1;
    if (tags.length) catalog.tagged_record_count += 1;
    byCatalog.set(catalogId, catalog);

    const recordType = byRecordType.get(node.node_type) || {
      record_type: node.node_type,
      record_count: 0,
      tagged_record_count: 0,
      tag_assignments: 0,
      dimensions: {},
    };
    recordType.record_count += 1;
    if (tags.length) recordType.tagged_record_count += 1;
    byRecordType.set(node.node_type, recordType);

    const dimensionsSeen = new Set();
    for (const tag of tags) {
      const dimension = tag.kind;
      assignedTagIds.add(tag.id);
      const dimensionEntry = byDimension.get(dimension);
      if (dimensionEntry) {
        dimensionEntry.tag_assignments += 1;
      }
      dimensionsSeen.add(dimension);
      catalog.tag_assignments += 1;
      recordType.tag_assignments += 1;
      const sourceField = tag.basis?.source_field || "unrecorded";
      const sourceFieldEntry = bySourceField.get(sourceField) || {
        source_field: sourceField,
        record_ids: new Set(),
        tag_assignments: 0,
      };
      sourceFieldEntry.record_ids.add(node.id);
      sourceFieldEntry.tag_assignments += 1;
      bySourceField.set(sourceField, sourceFieldEntry);

      const assignmentProvenance = tag.provenance || "unrecorded";
      const taxonomyLayer = TAXONOMY_CONTRACT.assignment_provenance_layers[assignmentProvenance] || "unrecorded";
      const assignmentLayerEntry = byAssignmentLayer.get(taxonomyLayer) || {
        taxonomy_layer: taxonomyLayer,
        record_ids: new Set(),
        tag_assignments: 0,
      };
      assignmentLayerEntry.record_ids.add(node.id);
      assignmentLayerEntry.tag_assignments += 1;
      byAssignmentLayer.set(taxonomyLayer, assignmentLayerEntry);

      const rule = tag.basis?.rule || "unrecorded";
      const ruleEntry = byRule.get(rule) || {
        rule,
        record_ids: new Set(),
        tag_assignments: 0,
      };
      ruleEntry.record_ids.add(node.id);
      ruleEntry.tag_assignments += 1;
      byRule.set(rule, ruleEntry);

      const governedTag = taxonomyTagById.get(tag.id);
      if (!governedTag || governedTag.label !== tag.label) {
        const legacyKey = `${tag.id}|${tag.label || ""}`;
        const legacyEntry = unresolvedLegacyLabels.get(legacyKey) || {
          tag_id: tag.id,
          observed_label: tag.label || "",
          expected_label: governedTag?.label || null,
          record_ids: new Set(),
        };
        legacyEntry.record_ids.add(node.id);
        unresolvedLegacyLabels.set(legacyKey, legacyEntry);
      }
      const identity = governedTag?.identity_key
        ? identityByKey.get(governedTag.identity_key)
        : null;
      if (identity) {
        identityTagAssignments += 1;
        identityAssignedRecordIds.add(node.id);
        if (identity.verification_status === "fallback_only") {
          fallbackTagAssignments += 1;
          fallbackAssignedRecordIds.add(node.id);
        }
      }

      const basisKey = [taxonomyLayer, assignmentProvenance, sourceField, tag.basis?.rule || "unrecorded"].join("|");
      const basisEntry = bySourceBasis.get(basisKey) || {
        taxonomy_layer: taxonomyLayer,
        assignment_provenance: assignmentProvenance,
        source_field: sourceField,
        rule: tag.basis?.rule || "unrecorded",
        record_ids: new Set(),
        tag_assignments: 0,
      };
      basisEntry.record_ids.add(node.id);
      basisEntry.tag_assignments += 1;
      bySourceBasis.set(basisKey, basisEntry);
    }

    for (const dimension of TAXONOMY_CONTRACT.dimensions) {
      const explicitDecision = node.metadata?.taxonomy_dimension_states?.[dimension.id];
      const hasExplicitNotApplicable = explicitDecision?.state === "not_applicable" &&
        explicitDecision.source_field && explicitDecision.rule;
      const state = dimensionsSeen.has(dimension.id)
        ? "applicable"
        : hasExplicitNotApplicable
          ? "not_applicable"
          : "unreviewed";
      const key = `${state}_record_count`;
      const dimensionEntry = byDimension.get(dimension.id);
      dimensionEntry.record_count += 1;
      dimensionEntry[key] += 1;

      const catalogDimension = catalog.dimensions[dimension.id] || {
        applicable_record_count: 0,
        not_applicable_record_count: 0,
        unreviewed_record_count: 0,
        tag_assignments: 0,
      };
      catalogDimension[key] += 1;
      catalogDimension.tag_assignments += tags.filter((tag) => tag.kind === dimension.id).length;
      catalog.dimensions[dimension.id] = catalogDimension;

      const recordTypeDimension = recordType.dimensions[dimension.id] || {
        applicable_record_count: 0,
        not_applicable_record_count: 0,
        unreviewed_record_count: 0,
        tag_assignments: 0,
      };
      recordTypeDimension[key] += 1;
      recordTypeDimension.tag_assignments += tags.filter((tag) => tag.kind === dimension.id).length;
      recordType.dimensions[dimension.id] = recordTypeDimension;

      if (state === "not_applicable") {
        const basisKey = [dimension.id, explicitDecision.source_field, explicitDecision.rule].join("|");
        const basisEntry = byNotApplicableBasis.get(basisKey) || {
          dimension: dimension.id,
          source_field: explicitDecision.source_field,
          rule: explicitDecision.rule,
          record_ids: new Set(),
        };
        basisEntry.record_ids.add(node.id);
        byNotApplicableBasis.set(basisKey, basisEntry);
      }
    }
  }

  const decisionCounts = [...byDimension.values()].reduce((summary, dimension) => ({
    applicable: summary.applicable + dimension.applicable_record_count,
    not_applicable: summary.not_applicable + dimension.not_applicable_record_count,
    unreviewed: summary.unreviewed + dimension.unreviewed_record_count,
  }), { applicable: 0, not_applicable: 0, unreviewed: 0 });
  const totalTagAssignments = [...byDimension.values()]
    .reduce((total, dimension) => total + dimension.tag_assignments, 0);
  const percentage = (count, total) => total ? Number(((count / total) * 100).toFixed(2)) : 0;
  const identityLinkedTerms = TAXONOMY_CONTRACT.tags.filter((tag) => tag.identity_key);
  const unresolvedIdentityTerms = identityLinkedTerms.filter(
    (tag) => !identityByKey.has(tag.identity_key),
  );
  const officialMarkIdentities = IDENTITY_REGISTRY.filter(
    (identity) => identity.verification_status === "verified" && identity.asset_path,
  );
  const fallbackIdentities = IDENTITY_REGISTRY.filter(
    (identity) => identity.verification_status === "fallback_only",
  );

  return {
    contract_version: TAXONOMY_CONTRACT.version,
    record_count: records.length,
    tagged_record_count: records.filter((node) => (node.metadata?.taxonomy_tags || []).length > 0).length,
    record_dimension_decision_count: records.length * TAXONOMY_CONTRACT.dimensions.length,
    decision_counts: decisionCounts,
    assignment_layers: [...byAssignmentLayer.values()]
      .map((entry) => ({
        taxonomy_layer: entry.taxonomy_layer,
        record_count: entry.record_ids.size,
        tag_assignments: entry.tag_assignments,
        assignment_percentage: percentage(entry.tag_assignments, totalTagAssignments),
      }))
      .sort((left, right) => left.taxonomy_layer.localeCompare(right.taxonomy_layer)),
    rules: [...byRule.values()]
      .map((entry) => ({
        rule: entry.rule,
        record_count: entry.record_ids.size,
        tag_assignments: entry.tag_assignments,
      }))
      .sort((left, right) => right.tag_assignments - left.tag_assignments || left.rule.localeCompare(right.rule)),
    identity_coverage: {
      taxonomy_term_count: TAXONOMY_CONTRACT.tags.length,
      identity_linked_term_count: identityLinkedTerms.length,
      unresolved_identity_term_count: unresolvedIdentityTerms.length,
      unresolved_identity_term_ids: unresolvedIdentityTerms.map((tag) => tag.id).sort(),
      assigned_term_count: assignedTagIds.size,
      assigned_identity_term_count: [...assignedTagIds]
        .filter((tagId) => taxonomyTagById.get(tagId)?.identity_key)
        .length,
      identity_tag_assignment_count: identityTagAssignments,
      identity_record_count: identityAssignedRecordIds.size,
    },
    mark_coverage: {
      identity_count: IDENTITY_REGISTRY.length,
      official_mark_count: officialMarkIdentities.length,
      fallback_identity_count: fallbackIdentities.length,
      fallback_tag_assignment_count: fallbackTagAssignments,
      fallback_record_count: fallbackAssignedRecordIds.size,
      official_mark_percentage: percentage(officialMarkIdentities.length, IDENTITY_REGISTRY.length),
    },
    unresolved_legacy_labels: [...unresolvedLegacyLabels.values()]
      .map((entry) => ({
        tag_id: entry.tag_id,
        observed_label: entry.observed_label,
        expected_label: entry.expected_label,
        record_count: entry.record_ids.size,
      }))
      .sort((left, right) => left.tag_id.localeCompare(right.tag_id)),
    catalogs: [...byCatalog.values()].sort((left, right) => left.catalog_id.localeCompare(right.catalog_id)),
    record_types: [...byRecordType.values()].sort((left, right) => left.record_type.localeCompare(right.record_type)),
    dimensions: [...byDimension.values()],
    source_fields: [...bySourceField.values()]
      .map((entry) => ({
        source_field: entry.source_field,
        record_count: entry.record_ids.size,
        tag_assignments: entry.tag_assignments,
      }))
      .sort((left, right) => right.tag_assignments - left.tag_assignments || left.source_field.localeCompare(right.source_field)),
    source_basis: [...bySourceBasis.values()]
      .map((entry) => ({
        taxonomy_layer: entry.taxonomy_layer,
        assignment_provenance: entry.assignment_provenance,
        source_field: entry.source_field,
        rule: entry.rule,
        record_count: entry.record_ids.size,
        tag_assignments: entry.tag_assignments,
      }))
      .sort((left, right) => right.tag_assignments - left.tag_assignments || left.rule.localeCompare(right.rule)),
    not_applicable_source_basis: [...byNotApplicableBasis.values()]
      .map((entry) => ({
        dimension: entry.dimension,
        source_field: entry.source_field,
        rule: entry.rule,
        record_count: entry.record_ids.size,
      }))
      .sort((left, right) => right.record_count - left.record_count || left.rule.localeCompare(right.rule)),
  };
}

function collectionFingerprint(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function loadBaselineCollections() {
  const baselineRoot = process.env.CONTROL_ATLAS_BASELINE_GENERATED_DIR;
  if (!baselineRoot) return {};
  const previous = {};
  for (const name of RUNTIME_COLLECTIONS) {
    const path = join(baselineRoot, `${name}.json`);
    if (!existsSync(path)) continue;
    const existing = readJson(path);
    previous[name] = existing.sharded_collection ? null : existing;
  }
  return previous;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function buildSourceManifests(graph) {
  const evidenceById = new Map(
    graph.evidence.map((entry) => [entry.id, entry]),
  );
  const nodeCounts = countBy(graph.nodes, (node) => node.source_id);
  const evidenceCounts = countBy(graph.evidence, (entry) => entry.source_id);
  const edgeCounts = countBy(
    graph.edges,
    (edge) => evidenceById.get(edge.evidence_ids[0])?.source_id || "",
  );
  const findingCounts = countBy(graph.findings, (entry) => entry.source_id);

  return graph.sources
    .map((source) => ({
      source_id: source.id,
      display_name: source.display_name,
      display_group: source.display_group,
      frameworks: source.metadata?.frameworks || [],
      owner: source.owner,
      version: source.version,
      sync_model: source.sync_model,
      last_checked: source.last_checked,
      last_imported: source.last_imported,
      hash: source.hash,
      stale_after_days: source.stale_after_days,
      retrieved_at: source.retrieved_at,
      artifact_url: source.artifact_url,
      artifact_type: source.artifact_type,
      checksum: source.checksum,
      access_status: source.access_status,
      lifecycle_status: source.lifecycle_status,
      graph_eligible: source.graph_eligible,
      node_count: nodeCounts.get(source.id) || 0,
      relationship_count: edgeCounts.get(source.id) || 0,
      evidence_count: evidenceCounts.get(source.id) || 0,
      finding_count: findingCounts.get(source.id) || 0,
    }))
    .sort((a, b) => a.source_id.localeCompare(b.source_id));
}

function createBuildManifest(graph) {
  return {
    kind: "build_manifest",
    runtime_artifacts: [
      ...RUNTIME_COLLECTIONS.map((name) => `${name}.json`),
      "library-search.json",
      "atlas-neighborhood-manifest.json",
      "atlas-neighborhood/",
      "catalog-bootstrap.json",
      "catalog-records/",
    ],
    governance_artifacts: GOVERNANCE_FILES,
    source_registry_path: "data/source-registry.json",
    source_registry_schema: "4.0",
    counts: {
      sources: graph.sources.length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      evidence: graph.evidence.length,
      findings: graph.findings.length,
    },
  };
}

function compactOfficialText(text, limit = 180) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(0, limit + 1);
  const lastBreak = candidate.lastIndexOf(" ");
  const boundary = lastBreak >= Math.floor(limit * 0.8) ? lastBreak : limit;
  return `${normalized.slice(0, boundary).trimEnd()}…`;
}

function buildLibraryDocuments(graph) {
  const sourceById = new Map(
    graph.sources.map((source) => [source.id, source]),
  );
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const publishedConnectionCounts = new Map();
  const publishedCrossCatalogConnectionCounts = new Map();
  const publishedConnectionCatalogs = new Map();
  for (const edge of graph.edges) {
    if (edge.publication_status && edge.publication_status !== "published") continue;
    for (const [nodeId, counterpartId] of [
      [edge.source_node_id, edge.target_node_id],
      [edge.target_node_id, edge.source_node_id],
    ]) {
      const center = nodeById.get(nodeId);
      const counterpart = nodeById.get(counterpartId);
      const centerCatalogId = center?.metadata?.catalog_id;
      const counterpartCatalogId = counterpart?.metadata?.catalog_id;
      publishedConnectionCounts.set(nodeId, (publishedConnectionCounts.get(nodeId) || 0) + 1);
      if (
        !centerCatalogId ||
        !counterpartCatalogId ||
        centerCatalogId === counterpartCatalogId ||
        !edge.relationship_type ||
        !edge.provenance_class
      ) continue;
      publishedCrossCatalogConnectionCounts.set(
        nodeId,
        (publishedCrossCatalogConnectionCounts.get(nodeId) || 0) + 1,
      );
      const catalogs = publishedConnectionCatalogs.get(nodeId) || new Set();
      catalogs.add(counterpartCatalogId);
      publishedConnectionCatalogs.set(nodeId, catalogs);
    }
  }
  // Retired record types keep their nodes, edges and evidence in the graph; they
  // are only left out of the Library search documents (issue 279).
  return graph.nodes.filter((node) => !NON_RECORD_NODE_TYPES.has(node.node_type) && !RETIRED_RECORD_TYPES.has(node.node_type)).map((node) => {
    const source = sourceById.get(node.source_id);
    const itemId = node.metadata?.item_id || node.id;
    const title = node.metadata?.title || node.label;
    const stigId = node.metadata?.stig_id;
    const desc = node.metadata?.description || "";
    const previewSource = stigId && desc ? `${stigId} - ${desc}` : (stigId || desc);
    return {
      id: node.id,
      item_id: itemId,
      title,
      description_available: Boolean(node.metadata?.description?.trim()),
      official_text_preview: compactOfficialText(previewSource),
      object_type: node.node_type,
      source_id: node.source_id,
      source_name: source?.display_name || source?.name || "",
      publisher_name: source?.display_group || source?.owner || "",
      source_class: source?.provenance_class || "",
      catalog_id: node.metadata?.catalog_id || "",
      control_family: node.metadata?.family || "",
      identity_category: node.metadata?.identity_category || "",
      classification_provenance: node.metadata?.classification_provenance,
      related_categories: node.metadata?.related_categories,
      taxonomy_tags: node.metadata?.taxonomy_tags || [],
      severity: node.metadata?.severity || "",
      published_connection_count: publishedConnectionCounts.get(node.id) || 0,
      published_cross_catalog_connection_count:
        publishedCrossCatalogConnectionCounts.get(node.id) || 0,
      published_connection_catalog_count:
        publishedConnectionCatalogs.get(node.id)?.size || 0,
    };
  });
}

function buildLibrarySearch(graph) {
  const documents = buildLibraryDocuments(graph);
  const facetValues = (field) =>
    [...new Set(documents.map((document) => document[field]).filter(Boolean))].sort();
  const countBy = (key) => Object.fromEntries(
    [...documents.reduce((counts, document) => {
      const value = document[key];
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  const tagCounts = new Map();
  for (const document of documents) {
    for (const tag of document.taxonomy_tags || []) {
      if (!tag?.id) continue;
      tagCounts.set(tag.id, (tagCounts.get(tag.id) || 0) + 1);
    }
  }
  return {
    document_count: documents.length,
    facets: {
      objectTypes: facetValues("object_type"),
      publishers: facetValues("publisher_name"),
      sourceClasses: facetValues("source_class"),
      controlFamilies: facetValues("control_family"),
      severities: facetValues("severity"),
    },
    browse_counts: {
      object_types: countBy("object_type"),
      tags: Object.fromEntries([...tagCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    },
    documents,
  };
}

function buildLibrarySearchIndex(librarySearch) {
  const documents = librarySearch.documents;
  return {
    document_count: documents.length,
    fields: LIBRARY_SEARCH_INDEX_FIELDS,
    columns: LIBRARY_SEARCH_INDEX_FIELDS.map((field) =>
      documents.map((document) => document[field]),
    ),
    format: "columns-v1",
  };
}

function buildDiffSummary(previous, collections, generatedAt) {
  const changedRuntimeArtifacts = RUNTIME_COLLECTIONS.filter((name) => {
    const previousCollection = previous[name];
    const currentCollection = collections[name];
    if (!previousCollection) return true;
    const previousPayload = JSON.stringify(
      previousCollection[runtimeCollectionKey(name)],
    );
    return previousPayload !== JSON.stringify(currentCollection);
  });

  return {
    kind: "graph_diff_summary",
    previous_generated_at: previous.sources?.generated_at || null,
    current_generated_at: generatedAt,
    changed_runtime_artifacts: changedRuntimeArtifacts,
    unchanged_runtime_artifacts: RUNTIME_COLLECTIONS.filter(
      (name) => !changedRuntimeArtifacts.includes(name),
    ),
  };
}

function runtimeCollectionKey(name) {
  if (name === "graph-health") return "findings";
  if (name === "atlas-spine") return "atlas_spine";
  return name;
}

function authorityCatalogIds(treeSpine) {
  return new Set([
    ...Object.keys(treeSpine.catalogLimbs || {}),
    ...(treeSpine.syntheticCatalogs || []).map((entry) => entry.catalog_id),
  ]);
}

function buildAuthorityNode(instrument) {
  return {
    id: instrument.id,
    node_type: instrument.node_type,
    label: instrument.label,
    source_id: instrument.source_id,
    lifecycle_status: "active",
    // These entries were verified by manual review against official primary
    // sources. No downloaded artifact bytes exist, so an empty artifact list
    // is more honest than inventing a checksum-backed artifact record.
    artifact_ids: [],
    metadata: {
      ingestion_source_id: instrument.source_id,
      item_id: instrument.id.slice("authority:".length),
      title: instrument.label,
      description: instrument.blurb,
      type: instrument.node_type,
      source_refs: instrument.source_refs,
      source_locator: instrument.source_refs[0]?.locator || "",
    },
  };
}

function pushAuthorityEdge(
  edgeState,
  registry,
  { subjectId, sourceNodeId, targetNodeId, sourceRefs, rationale },
) {
  const primaryReference = sourceRefs[0];
  const source = registry.byId.get(primaryReference.source_id);
  const evidenceId = `evidence:${subjectId}`;
  edgeState.evidence.push({
    id: evidenceId,
    source_id: primaryReference.source_id,
    source_version: source?.version || "",
    locator: primaryReference.locator,
    retrieved_at: source?.retrieved_at || null,
    checksum: source?.checksum || null,
    evidence_quality: "primary",
    ingestion_source_id: primaryReference.source_id,
  });
  edgeState.edges.push({
    id: `edge:${subjectId}`,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    relationship_type: "issued_under",
    relationship_class: RELATIONSHIP_CLASSES.organizing,
    provenance_class: source?.provenance_class || "federal_published",
    confidence: "direct",
    publication_status: "published",
    evidence_ids: [evidenceId],
    display_label: `${sourceNodeId} is issued under ${targetNodeId}`,
    warning: null,
    inference_rule_id: null,
    rationale,
    source_refs: sourceRefs,
  });
}

export function applyAuthoritySpine(nodeState, edgeState, registry) {
  const authoritySpine = readJson(
    join(ROOT, "data", "curated", "authority-spine.json"),
  );
  const treeSpine = readJson(join(ROOT, "data", "curated", "tree-spine.json"));
  const errors = validateAuthoritySpine(authoritySpine, {
    catalogIds: authorityCatalogIds(treeSpine),
    sourceIds: new Set(registry.sources.map((source) => source.id)),
  });
  if (errors.length) {
    throw new Error(`Invalid authority spine:\n- ${errors.join("\n- ")}`);
  }

  for (const instrument of authoritySpine.instruments) {
    nodeState.nodes.push(
      attachNodeProvenance(
        buildAuthorityNode(instrument),
        instrument.source_id,
        registry,
      ),
    );
    if (instrument.parent) {
      pushAuthorityEdge(edgeState, registry, {
        subjectId: `authority:instrument:${instrument.id}->${instrument.parent}`,
        sourceNodeId: instrument.id,
        targetNodeId: instrument.parent,
        sourceRefs: instrument.source_refs,
        rationale: `${instrument.label} declares ${instrument.parent} as its verified authority parent.`,
      });
    }
  }

  for (const publication of authoritySpine.publications) {
    const authorityIds = [
      ...(publication.primary_authority
        ? [publication.primary_authority]
        : []),
      ...publication.also_required_by,
    ];
    for (const authorityId of authorityIds) {
      pushAuthorityEdge(edgeState, registry, {
        subjectId: `authority:publication:${publication.catalog_id}->${authorityId}`,
        sourceNodeId: `${publication.catalog_id}:CATALOG`,
        targetNodeId: authorityId,
        sourceRefs: publication.source_refs,
        rationale: `${publication.catalog_id} is issued under ${authorityId}; this secondary relationship does not change canonical ownership.`,
      });
    }
  }

  return authoritySpine;
}

function attachAuthorityPublicationMetadata(nodes, authoritySpine) {
  const rootByCatalogId = new Map(
    nodes
      .filter((node) => node.node_type === "catalog")
      .map((node) => [catalogIdOf(node), node]),
  );
  for (const publication of authoritySpine.publications) {
    const root = rootByCatalogId.get(publication.catalog_id);
    if (!root) {
      throw new Error(
        `Authority publication ${publication.catalog_id} has no emitted catalog root`,
      );
    }
    Object.assign(root.metadata, {
      mandate: publication.mandate,
      primary_authority: publication.primary_authority,
      also_required_by: publication.also_required_by,
      publication_type: publication.publication_type,
      mandate_note: publication.mandate_note,
      authority_source_refs: publication.source_refs,
    });
  }
}

const ATLAS_SUMMARY_NODE_TYPES = new Set([
  "family",
  "benchmark",
  "category",
  "tactic",
  "group",
  "function",
]);

export function buildAtlasSpine(graph, authoritySpine, treeSpine) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ancestorGraph = buildAncestorGraph(graph.nodes, graph.edges);
  const canonicalChildrenByParent = new Map();
  for (const node of graph.nodes) {
    const chain = ancestorChain(node.id, ancestorGraph);
    if (chain.length < 2) continue;
    const parentId = chain.at(-2).id;
    const children = canonicalChildrenByParent.get(parentId) || [];
    children.push(node.id);
    canonicalChildrenByParent.set(parentId, children);
  }
  for (const children of canonicalChildrenByParent.values()) {
    children.sort((leftId, rightId) => {
      const left = nodeById.get(leftId);
      const right = nodeById.get(rightId);
      const leftKey = left?.metadata?.item_id || left?.label || leftId;
      const rightKey = right?.metadata?.item_id || right?.label || rightId;
      return leftKey.localeCompare(rightKey, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }

  const isLeafRecord = (node) =>
    node &&
    node.node_type !== "catalog" &&
    node.node_type !== "trunk" &&
    node.node_type !== "limb" &&
    !ATLAS_SUMMARY_NODE_TYPES.has(node.node_type) &&
    !RETIRED_RECORD_TYPES.has(node.node_type) &&
    !node.id.startsWith("authority:");
  const descendantRecordCount = (rootId) => {
    let count = 0;
    const stack = [...(canonicalChildrenByParent.get(rootId) || [])];
    const seen = new Set();
    while (stack.length) {
      const nodeId = stack.pop();
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      const node = nodeById.get(nodeId);
      if (isLeafRecord(node)) count += 1;
      stack.push(...(canonicalChildrenByParent.get(nodeId) || []));
    }
    return count;
  };
  const catalogLeafCount = (catalogId) =>
    graph.nodes.filter(
      (node) => node.metadata?.catalog_id === catalogId && isLeafRecord(node),
    ).length;
  const publicationByCatalogId = new Map(
    authoritySpine.publications.map((publication) => [
      publication.catalog_id,
      publication,
    ]),
  );
  const rootByCatalogId = new Map(
    graph.nodes
      .filter((node) => node.node_type === "catalog")
      .map((node) => [catalogIdOf(node), node]),
  );
  const catalogCounts = new Map(
    [...rootByCatalogId.keys()].map((catalogId) => [
      catalogId,
      catalogLeafCount(catalogId),
    ]),
  );

  const entries = [];
  const instrumentChildren = new Map(
    authoritySpine.instruments.map((instrument) => [instrument.id, []]),
  );
  for (const instrument of authoritySpine.instruments) {
    if (instrument.parent) {
      instrumentChildren.get(instrument.parent)?.push(instrument.id);
    }
  }
  for (const instrument of authoritySpine.instruments) {
    const issuedCatalogs = authoritySpine.publications.filter(
      (publication) =>
        publication.primary_authority === instrument.id ||
        publication.also_required_by.includes(instrument.id),
    );
    entries.push({
      id: instrument.id,
      node_type: instrument.node_type,
      label: instrument.label,
      blurb: instrument.blurb,
      parent_id: instrument.parent,
      child_count:
        (instrumentChildren.get(instrument.id)?.length || 0) +
        issuedCatalogs.length,
      descendant_record_count: issuedCatalogs.reduce(
        (total, publication) =>
          total + (catalogCounts.get(publication.catalog_id) || 0),
        0,
      ),
    });
  }

  const trunk = graph.nodes.find((node) => node.node_type === "trunk");
  if (!trunk) throw new Error("Atlas spine cannot find the canonical trunk");
  const totalCatalogRecords = [...catalogCounts.values()].reduce(
    (total, count) => total + count,
    0,
  );
  entries.push({
    id: trunk.id,
    node_type: trunk.node_type,
    label: trunk.metadata?.title || trunk.label,
    blurb: trunk.metadata?.description || "",
    parent_id: null,
    child_count: treeSpine.limbs.length,
    descendant_record_count: totalCatalogRecords,
  });

  for (const limb of treeSpine.limbs) {
    const catalogIds = [
      ...Object.entries(treeSpine.catalogLimbs),
      ...(treeSpine.syntheticCatalogs || []).map((entry) => [
        entry.catalog_id,
        entry.limb,
      ]),
    ]
      .filter(([, limbId]) => limbId === limb.id)
      .map(([catalogId]) => catalogId);
    entries.push({
      id: limb.id,
      node_type: "limb",
      label: limb.label,
      blurb: limb.blurb,
      parent_id: trunk.id,
      child_count: catalogIds.length,
      descendant_record_count: catalogIds.reduce(
        (total, catalogId) => total + (catalogCounts.get(catalogId) || 0),
        0,
      ),
    });
    for (const catalogId of catalogIds) {
      const root = rootByCatalogId.get(catalogId);
      const publication = publicationByCatalogId.get(catalogId);
      if (!root || !publication) {
        throw new Error(`Atlas spine cannot resolve catalog ${catalogId}`);
      }
      const summaryIds = canonicalChildrenByParent.get(root.id) || [];
      const membershipGroups = new Map();
      if (summaryIds.length === 0) {
        for (const node of graph.nodes.filter(
          (entry) =>
            entry.node_type !== "catalog" &&
            entry.metadata?.catalog_id === catalogId,
        )) {
          const family = node.metadata?.family || "All records";
          const members = membershipGroups.get(family) || [];
          members.push(node);
          membershipGroups.set(family, members);
        }
      }
      entries.push({
        id: root.id,
        node_type: "catalog",
        label: root.metadata?.title || root.label,
        blurb: root.metadata?.description || publication.mandate_note,
        parent_id: limb.id,
        child_count: summaryIds.length || membershipGroups.size,
        descendant_record_count: catalogCounts.get(catalogId) || 0,
        mandate: publication.mandate,
        primary_authority: publication.primary_authority,
        also_required_by: publication.also_required_by,
        publication_type: publication.publication_type,
        mandate_note: publication.mandate_note,
        area_id: limb.id,
      });
      for (const summaryId of summaryIds) {
        const summary = nodeById.get(summaryId);
        if (!summary) continue;
        const childIds = canonicalChildrenByParent.get(summaryId) || [];
        entries.push({
          id: summary.id,
          node_type: summary.node_type,
          label: summary.metadata?.title || summary.label || summary.id,
          blurb: summary.metadata?.description || "",
          parent_id: root.id,
          child_count: childIds.length,
          descendant_record_count: isLeafRecord(summary)
            ? 1 + descendantRecordCount(summaryId)
            : descendantRecordCount(summaryId),
        });
      }
      for (const [family, members] of [...membershipGroups.entries()].sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        entries.push({
          id: `membership:${catalogId}:${slugKey(family)}`,
          node_type: "family",
          label: family,
          blurb: `${members.length.toLocaleString()} records`,
          parent_id: root.id,
          child_count: members.length,
          descendant_record_count: members.length,
        });
      }
    }
  }

  return { entries };
}

// --- Class-4 organizing spine (Cybersecurity trunk + limbs) ---------------
// Owner directive 2026-07-31: "Everything must connect to the trunk. Period."
// This emits the trunk/limb/catalog spine (organizing edges, publication_status
// "editorial", never publisher-declared) plus structural backfill for orphans
// whose catalog root exists, then a HARD connectivity gate that fails the build
// if any node cannot reach the trunk over the full (undirected) edge set. CCIs
// and assessment procedures stay pure correlation junctions (docs/DATA_POLICY.md
// §4) — they reach the trunk through their existing correlation/assesses edges,
// not through new structural parents.

function buildStructureNode({ id, nodeType, label, description }) {
  return {
    id,
    node_type: nodeType,
    label,
    source_id: ORGANIZING_STRUCTURE_SOURCE_ID,
    lifecycle_status: "active",
    metadata: {
      ingestion_source_id: ORGANIZING_STRUCTURE_SOURCE_ID,
      item_id: id.split(":").pop(),
      title: label,
      description,
      type: nodeType,
    },
  };
}

function buildSyntheticCatalogNode(decl) {
  return {
    id: `${decl.catalog_id}:CATALOG`,
    node_type: "catalog",
    label: decl.label,
    source_id: decl.source_id,
    lifecycle_status: "active",
    metadata: {
      catalog_id: decl.catalog_id,
      ingestion_source_id: decl.source_id,
      item_id: "CATALOG",
      title: decl.label,
      description: decl.description,
      family: "Catalog",
      type: "catalog_summary",
      references: null,
    },
  };
}

function pushOrganizingEdge(edgeState, { subjectId, sourceNodeId, targetNodeId, rationale }) {
  const evidenceId = `evidence:${subjectId}`;
  edgeState.evidence.push({
    id: evidenceId,
    source_id: ORGANIZING_STRUCTURE_SOURCE_ID,
    source_version: "2026-07-31",
    locator: `tree-spine#${subjectId}`,
    retrieved_at: "2026-07-31",
    checksum: null,
    evidence_quality: "editorial",
    ingestion_source_id: ORGANIZING_STRUCTURE_SOURCE_ID,
  });
  edgeState.edges.push({
    id: `edge:${subjectId}`,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    relationship_type: "organizes",
    relationship_class: RELATIONSHIP_CLASSES.organizing,
    provenance_class: "control_atlas_derived",
    confidence: "derived",
    publication_status: "editorial",
    evidence_ids: [evidenceId],
    display_label: `${sourceNodeId} organizes ${targetNodeId}`,
    warning: null,
    inference_rule_id: null,
    rationale,
    source_refs: [
      {
        source_id: ORGANIZING_STRUCTURE_SOURCE_ID,
        ref_type: "editorial",
        locator: `tree-spine#${subjectId}`,
      },
    ],
  });
}

function pushStructuralBackfillEdge(edgeState, sourceById, { subjectId, parentNode, childNode, rationale }) {
  const source = sourceById.get(childNode.source_id);
  const provenance =
    source?.provenance_class && source.provenance_class !== "inferred"
      ? source.provenance_class
      : "federal_published";
  const evidenceId = `evidence:${subjectId}`;
  edgeState.evidence.push({
    id: evidenceId,
    source_id: childNode.source_id,
    source_version: source?.version || "",
    locator: `${childNode.source_id}#${childNode.id}`,
    retrieved_at: source?.retrieved_at || null,
    checksum: source?.checksum || null,
    evidence_quality: "primary",
    ingestion_source_id: childNode.metadata?.ingestion_source_id || childNode.source_id,
  });
  edgeState.edges.push({
    id: `edge:${subjectId}`,
    source_node_id: parentNode.id,
    target_node_id: childNode.id,
    relationship_type: "contains",
    relationship_class: RELATIONSHIP_CLASSES.structural,
    mapping_model: RELATIONSHIP_CLASSES.structural,
    source_artifact_id: childNode.artifact_ids?.[0] || aliasArtifact(`artifact-${childNode.source_id}`),
    source_locator: childNode.metadata?.source_locator || `${childNode.source_id}#${childNode.id}`,
    provenance_class: provenance,
    confidence: "direct",
    publication_status: "published",
    evidence_ids: [evidenceId],
    display_label: `${parentNode.id} contains ${childNode.id}`,
    warning: null,
    inference_rule_id: null,
    rationale,
    source_refs: [
      {
        source_id: childNode.source_id,
        ref_type: "primary",
        locator: `${childNode.source_id}#${childNode.id}`,
      },
    ],
  });
}

/**
 * Records carry their own path to the trunk. The record page loads a single
 * neighborhood shard, never the monolithic graph (enforced by
 * tests/e2e/bootstrap-payload.spec.mjs), so a runtime walk over the full edge
 * set could only ever produce a truncated chain there. Deriving it once at
 * build time costs ~300 bytes per node and lets "Where this sits" render the
 * complete chain from whatever artifact delivered the record.
 */
function attachAncestorPaths(nodes, edges) {
  const graph = buildAncestorGraph(nodes, edges);
  for (const node of nodes) {
    const chain = ancestorChain(node.id, graph);
    // The last link is the node itself; keep only its ancestors, root first.
    const ancestors = chain.slice(0, -1).map((link) => ({
      id: link.id,
      label: link.label,
      node_type: link.node_type,
      origin: link.origin,
    }));
    if (ancestors.length) node.ancestor_path = ancestors;
  }
}

export function validatePublisherNativeContainment(nodes, edges = []) {
  const failures = new Set();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentsByChild = new Map();
  for (const edge of edges) {
    if (edge.relationship_class !== RELATIONSHIP_CLASSES.structural) continue;
    const parents = parentsByChild.get(edge.target_node_id) || new Set();
    parents.add(edge.source_node_id);
    parentsByChild.set(edge.target_node_id, parents);
  }
  const catalogIds = new Set(
    nodes.map((node) => catalogIdOf(node)).filter(Boolean),
  );
  for (const catalogId of catalogIds) {
    if (!catalogStructureProfile(catalogId)) {
      failures.add(`${catalogId}: missing CatalogStructureProfile`);
    }
  }
  for (const profileId of CATALOG_STRUCTURE_IDS) {
    if (!catalogIds.has(profileId)) {
      failures.add(`${profileId}: profile has no emitted catalog`);
    }
  }

  for (const node of nodes) {
    const catalogId = catalogIdOf(node);
    if (!catalogId || node.node_type === "catalog") continue;
    const walk = (cursor, chain, visited) => {
      if (cursor.node_type === "catalog") {
        const rootId = `${catalogId}:CATALOG`;
        if (cursor.id !== rootId) {
          failures.add(`${node.id}: containment is not anchored at ${rootId}`);
          return;
        }
        const nativeTypes = [...chain].reverse().map((entry) => entry.node_type);
        if (!structurePathIsAllowed(catalogId, nativeTypes)) {
          failures.add(`${node.id}: undeclared structure ${nativeTypes.join(" > ")}`);
        }
        return;
      }

      const parentIds = [...(parentsByChild.get(cursor.id) || [])];
      if (!parentIds.length) {
        failures.add(`${cursor.id}: expected a containment parent, found 0`);
        return;
      }
      const permitsMultipleParents =
        catalogStructureProfile(catalogId)?.multiParentNodeTypes.includes(cursor.node_type) &&
        !cursor.metadata?.is_subtechnique &&
        parentIds.every((parentId) => nodesById.get(parentId)?.node_type === "tactic");
      if (parentIds.length > 1 && !permitsMultipleParents) {
        failures.add(`${cursor.id}: expected one containment parent, found ${parentIds.length}`);
        return;
      }

      for (const parentId of parentIds) {
        const parent = nodesById.get(parentId);
        if (!parent) {
          failures.add(`${cursor.id}: missing containment parent ${parentId}`);
          continue;
        }
        const parentCatalogId = catalogIdOf(parent);
        if (parentCatalogId && parentCatalogId !== catalogId) {
          failures.add(`${node.id}: foreign catalog ancestor ${parent.id}`);
          continue;
        }
        if (visited.has(parent.id)) {
          failures.add(`${node.id}: containment cycle through ${parent.id}`);
          continue;
        }
        walk(parent, [...chain, parent], new Set([...visited, parent.id]));
      }
    };
    walk(node, [node], new Set([node.id]));
  }
  return [...failures].sort();
}

function applyOrganizingSpine(nodeState, edgeState, registry) {
  const spine = readJson(join(ROOT, "data", "curated", "tree-spine.json"));
  const sourceById = registry.byId;
  const nodes = nodeState.nodes;

  // 1. Trunk + limb nodes (scaffold, no catalog_id — exempt from catalog identity).
  nodes.push(
    attachNodeProvenance(
      buildStructureNode({
        id: spine.trunk.id,
        nodeType: "trunk",
        label: spine.trunk.label,
        description:
          "The cybersecurity discipline itself — the single common ancestor every limb hangs from.",
      }),
      ORGANIZING_STRUCTURE_SOURCE_ID,
      registry,
    ),
  );
  for (const limb of spine.limbs) {
    nodes.push(
      attachNodeProvenance(
        buildStructureNode({
          id: limb.id,
          nodeType: "limb",
          label: limb.label,
          description: limb.blurb,
        }),
        ORGANIZING_STRUCTURE_SOURCE_ID,
        registry,
      ),
    );
  }

  // 2. Synthetic catalog wrappers (catalog_ids with content but no root node).
  const synthetic = deriveSyntheticCatalogs(nodes, spine, catalogIdOf);
  if (synthetic.empty.length) {
    throw new Error(
      `tree-spine syntheticCatalogs matched zero nodes: ${synthetic.empty.join(", ")}`,
    );
  }
  let nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const wrapper of synthetic.wrappers) {
    const decl = spine.syntheticCatalogs.find((entry) => entry.catalog_id === wrapper.catalogId);
    const catalogNode = attachNodeProvenance(buildSyntheticCatalogNode(decl), decl.source_id, registry);
    nodes.push(catalogNode);
    nodeById.set(catalogNode.id, catalogNode);
    pushOrganizingEdge(edgeState, {
      subjectId: `organizing:limb-catalog:${wrapper.catalogNodeId}`,
      sourceNodeId: wrapper.limbId,
      targetNodeId: wrapper.catalogNodeId,
      rationale: `${decl.label} is organized under ${wrapper.limbId} (synthetic catalog wrapper).`,
    });
    for (const childId of wrapper.childIds) {
      pushStructuralBackfillEdge(edgeState, sourceById, {
        subjectId: `structural:synthetic:${wrapper.catalogNodeId}:${childId}`,
        parentNode: catalogNode,
        childNode: nodeById.get(childId),
        rationale: `${decl.label} contains ${childId}.`,
      });
    }
  }

  // 3. Editorial spine over the real catalog roots (trunk->limb, limb->catalog).
  const realCatalogRoots = nodes.filter(
    (node) => node.node_type === "catalog" && spine.catalogLimbs[catalogIdOf(node)],
  );
  const { organizesEdges, unassigned } = deriveEditorialSpine(realCatalogRoots, spine, catalogIdOf);
  if (unassigned.length) {
    throw new Error(`catalog roots with no limb assignment: ${unassigned.join(", ")}`);
  }
  for (const edge of organizesEdges) {
    pushOrganizingEdge(edgeState, {
      subjectId: `organizing:spine:${edge.source_id}->${edge.target_id}`,
      sourceNodeId: edge.source_id,
      targetNodeId: edge.target_id,
      rationale:
        edge.source_id === spine.trunk.id
          ? `${edge.target_id} is a limb of the Cybersecurity trunk.`
          : `${edge.target_id} is a catalog organized under ${edge.source_id}.`,
    });
  }

  // 3.5 Junction canonical parents as organizing edges so the rail can walk them.
  // These stay OUT of structural ancestry — CCIs and procedures remain correlation
  // junctions (docs/DATA_POLICY.md); the organizing edge is a badged editorial
  // "where this sits" home, never a publisher containment claim.
  /* Cross-publication CCI and assessment links remain relationships. They are
     deliberately excluded from publisher-native containment. */
  // Cross-publication references stay in the relationship layer.
    // Parent -> child: the control/assessment objective is the parent, the CCI
    // remains related to it (docs/DATA_POLICY.md).


  // 4. Residual connectivity backfill — anything still unreachable from the trunk.
  const syntheticNonOwningCatalogs = new Set(
    (spine.syntheticCatalogs || [])
      .filter((decl) => decl.attachRecords === false)
      .map((decl) => decl.catalog_id),
  );
  const catalogRootByCatalogId = new Map();
  for (const node of nodes) {
    if (node.node_type === "catalog") catalogRootByCatalogId.set(catalogIdOf(node), node);
  }
  const canonicalBeforeBackfill = canonicalTrunkReachable(
    nodes,
    edgeState.edges,
    spine.trunk.id,
  );
  for (const node of nodes) {
    if (canonicalBeforeBackfill.has(node.id)) continue;
    const cid = catalogIdOf(node);
    const root = catalogRootByCatalogId.get(cid);
    // A catalog whose records are parented elsewhere (CCIs under the control
    // they cite, procedures under the control they assess) keeps a browsable
    // root that owns nothing. Filing a leftover under it is Control Atlas's
    // own decision, not a publisher containment claim, so it is an organizing
    // edge — the same class the rest of that catalog's filing uses.
    const rootOwnsRecords = !syntheticNonOwningCatalogs.has(cid);
    if (root && root.id !== node.id && rootOwnsRecords) {
      pushStructuralBackfillEdge(edgeState, sourceById, {
        subjectId: `structural:residual:${root.id}->${node.id}`,
        parentNode: root,
        childNode: node,
        rationale: `${node.id} attached to its catalog root ${root.id} (residual connectivity backfill).`,
      });
    } else if (root && root.id !== node.id) {
      pushOrganizingEdge(edgeState, {
        subjectId: `organizing:residual:${root.id}->${node.id}`,
        sourceNodeId: root.id,
        targetNodeId: node.id,
        rationale: `${node.id} filed under ${root.id} for reachability (editorial, non-structural).`,
      });
    } else if (spine.residualLimbs?.[cid]) {
      pushOrganizingEdge(edgeState, {
        subjectId: `organizing:residual:${spine.residualLimbs[cid]}->${node.id}`,
        sourceNodeId: spine.residualLimbs[cid],
        targetNodeId: node.id,
        rationale: `${node.id} (${cid}) filed under ${spine.residualLimbs[cid]} for reachability (editorial, non-structural).`,
      });
    }
  }

  // 5. Hard connectivity gate — every node must reach the trunk.
  const reachability = assertTrunkReachability(
    nodes,
    edgeState.edges,
    spine.trunk.id,
  );
  const organizingCount = edgeState.edges.filter(
    (edge) => edge.relationship_type === "organizes",
  ).length;
  console.log(
    `[organizing-spine] trunk+${spine.limbs.length} limbs, ${synthetic.wrappers.length} synthetic catalogs, ` +
      `${organizingCount} organizing edges; eligible ${reachability.eligibleNodeCount}/${reachability.totalNodeCount} ` +
      `(${reachability.exemptAuthorityNodeCount} authority exempt); ` +
      `undirected ${reachability.undirected.size}/${reachability.eligibleNodeCount}, ` +
      `canonical ${reachability.canonical.size}/${reachability.eligibleNodeCount} reach ${spine.trunk.id}.`,
  );
}

export function buildFrameworkData() {
  const registry = loadSourceRegistry(
    readJson(join(ROOT, "data", "source-registry.json")),
  );
  const nodeState = buildNodes(registry);
  const edgeState = buildEdges(registry, nodeState.nodes);
  const authoritySpine = applyAuthoritySpine(nodeState, edgeState, registry);
  applyOrganizingSpine(nodeState, edgeState, registry);
  attachPublisherStructuralOrder(nodeState.nodes, edgeState.edges);
  attachAuthorityPublicationMetadata(nodeState.nodes, authoritySpine);
  attachAncestorPaths(nodeState.nodes, edgeState.edges);
  const findings = [...nodeState.findings, ...edgeState.findings];
  const graph = {
    sources: registry.sources,
    nodes: nodeState.nodes,
    edges: edgeState.edges,
    evidence: edgeState.evidence,
    findings,
  };
  attachEntityProfilesAndEvidenceIntegrity(graph, registry);
  validateRecordPresentation(graph.nodes);
  const errors = [
    ...validateGraphArtifacts(graph),
    ...validateCatalogPublicationIdentity(graph.nodes, graph.sources),
    ...validatePublisherNativeContainment(graph.nodes, graph.edges),
    ...validateDataTrustContracts(graph.nodes, graph.edges),
  ];
  if (errors.length)
    throw new Error(`Invalid federal graph:\n- ${errors.join("\n- ")}`);

  // provenance_assertions is unread anywhere in src/ or the verify scripts —
  // publication_source_id + artifact_ids (kept) already satisfy "every node
  // resolves publication and artifact provenance"; the assertion object
  // itself is 100% derivable from those two fields plus the sources.json
  // the runtime already loads (~3 MiB across 11k+ nodes, genuinely dead).
  // metadata carries a wide, mostly-catalog-specific field set (baselines,
  // check_text, discussion, ...) so most records leave most of it null —
  // `field: null,` costs the same bytes as a real value. No consumer checks
  // key presence (all reads are `?.field` / `|| default`), so a missing key
  // and an explicit null are behaviorally identical — drop the nulls. Both
  // apply everywhere a node ships (nodes.json AND the atlas-neighborhood
  // shards/catalog-records copies) so every runtime view of "the same node"
  // stays byte-identical — tests/atlas-neighborhood.test.mjs asserts this.
  const stripNullMetadata = (metadata) => {
    if (!metadata) return metadata;
    const out = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null) out[key] = value;
    }
    return out;
  };
  const stripDeadNodeFields = ({ provenance_assertions, ...node }) => ({
    ...node,
    ...(node.metadata ? { metadata: stripNullMetadata(node.metadata) } : {}),
  });
  // ancestor_path rides along on the shard and catalog-record copies of a
  // node so the record page can draw its chain to the trunk from the one
  // artifact it loads. nodes.json alone omits it: anything reading that
  // file already has the whole graph, and carrying it there pushes the
  // artifact past the 20 MiB budget in scripts/check-data-size.mjs.
  // Stripped here, before the collections are compared with what is
  // already on disk, so an unchanged build keeps its generated_at.
  const strippedGraphNodes = graph.nodes.map(stripDeadNodeFields);
  const emittedNodes = strippedGraphNodes.map(
    ({ ancestor_path, ...node }) => node,
  );
  // display_label is fully derivable from source_node_id/relationship_type/
  // target_node_id and unread anywhere in src/ — dead weight on every edge.
  // warning/inference_rule_id are read via `edge.warning || ""` (runtime.mjs)
  // so omitting a null/falsy value is behaviorally identical to storing it.
  // raw_relationship_type duplicates relationship_type on the ~78% of edges
  // where an OLIR-style source never overrode it. None of this is dropping
  // real evidence — same 20 MiB budget concern as ancestor_path above.
  const derivableEvidenceId = (edge) => `evidence:${String(edge.id).slice("edge:".length)}`;
  const emittedEdges = graph.edges.map(
    ({ display_label, warning, inference_rule_id, raw_relationship_type, evidence_ids, ...edge }) => ({
      ...edge,
      ...(warning ? { warning } : {}),
      ...(inference_rule_id ? { inference_rule_id } : {}),
      ...(raw_relationship_type && raw_relationship_type !== edge.relationship_type
        ? { raw_relationship_type }
        : {}),
      ...(evidence_ids?.length === 1 && evidence_ids[0] === derivableEvidenceId(edge)
        ? {}
        : { evidence_ids }),
    }),
  );
  const treeSpine = readJson(join(ROOT, "data", "curated", "tree-spine.json"));
  const atlasSpine = buildAtlasSpine(graph, authoritySpine, treeSpine);
  const collections = {
    sources: graph.sources,
    nodes: emittedNodes,
    edges: emittedEdges,
    evidence: graph.evidence,
    "graph-health": graph.findings,
    "atlas-spine": atlasSpine,
  };
  const previousCollections = loadBaselineCollections();
  const generatedAt = reproducibleGeneratedAt();

  const sourceManifests = buildSourceManifests(graph);
  const buildManifest = createBuildManifest(graph);
  const diffSummary = buildDiffSummary(
    previousCollections,
    collections,
    generatedAt,
  );
  const librarySearch = buildLibrarySearch(graph);
  const librarySearchIndex = buildLibrarySearchIndex(librarySearch);
  const sourceById = new Map(graph.sources.map((source) => [source.id, source]));
  const sourceReviews = readJson(
    join(ROOT, "data", "source-review-manifest.json"),
  ).catalogs;
  const sourceReviewByCatalog = new Map(
    sourceReviews.map((review) => [review.catalog_id, review]),
  );
  if (sourceReviewByCatalog.size !== sourceReviews.length) {
    throw new Error("Source review manifest contains duplicate catalog IDs.");
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const evidenceById = new Map(
    graph.evidence.map((entry) => [entry.id, entry]),
  );
  const catalogs = createFederalGraphRuntime(graph)
    .getCatalogs()
    .map((catalog) => {
      const root =
        graph.nodes.find(
          (node) =>
            node.node_type === "catalog" &&
            node.metadata?.catalog_id === catalog.id,
        ) ||
        graph.nodes.find(
          (node) => node.metadata?.catalog_id === catalog.id,
        );
      const source = sourceById.get(root?.source_id);
      const sourceReview = sourceReviewByCatalog.get(catalog.id);
      if (!sourceReview) {
        throw new Error(`Catalog ${catalog.id} has no governed source review.`);
      }
      return {
        ...catalog,
        source_id: root?.source_id || "",
        source_version: source?.version || source?.source_version || "",
        source_review: {
          reviewed_at: sourceReview.reviewed_at,
          semantic_content_review: sourceReview.semantic_content_review,
          upstream_currentness_review:
            sourceReview.upstream_currentness_review,
        },
      };
    });
  const emittedCatalogIds = new Set(catalogs.map((catalog) => catalog.id));
  const unusedSourceReviews = sourceReviews.filter(
    (review) => !emittedCatalogIds.has(review.catalog_id),
  );
  if (unusedSourceReviews.length) {
    throw new Error(
      `Source reviews do not resolve to catalog profiles: ${unusedSourceReviews
        .map((review) => review.catalog_id)
        .join(", ")}`,
    );
  }
  const mappingSourcesByPair = new Map();
  for (const edge of graph.edges) {
    if (!isComparisonCapableEdge(edge)) continue;
    const sourceCatalog =
      nodeById.get(edge.source_node_id)?.metadata?.catalog_id || "";
    const targetCatalog =
      nodeById.get(edge.target_node_id)?.metadata?.catalog_id || "";
    if (!sourceCatalog || !targetCatalog || sourceCatalog === targetCatalog) {
      continue;
    }
    const sourceIds = new Set([
      ...(edge.source_refs || []).map((reference) => reference.source_id),
      ...(edge.evidence_ids || []).map(
        (evidenceId) => evidenceById.get(evidenceId)?.source_id,
      ),
    ]);
    for (const key of [
      `${sourceCatalog}|${targetCatalog}`,
      `${targetCatalog}|${sourceCatalog}`,
    ]) {
      const values = mappingSourcesByPair.get(key) || new Set();
      for (const sourceId of sourceIds) {
        if (sourceId) values.add(sourceId);
      }
      mappingSourcesByPair.set(key, values);
    }
  }
  const catalogBootstrap = {
    catalogs,
    mapping_sources: Object.fromEntries(
      [...mappingSourcesByPair.entries()].map(([key, sourceIds]) => [
        key,
        [...sourceIds]
          .map((sourceId) => {
            const source = sourceById.get(sourceId);
            return {
              value: sourceId,
              label: source?.display_name || source?.name || sourceId,
            };
          })
          .sort((left, right) => left.label.localeCompare(right.label)),
      ]),
    ),
  };
const catalogRecords = new Map();
  for (const node of strippedGraphNodes) {
    const catalogId = node.metadata?.catalog_id;
    if (!catalogId) continue;
    const records = catalogRecords.get(catalogId) || [];
    records.push(node);
    catalogRecords.set(catalogId, records);
  }

  mkdirSync(GENERATED, { recursive: true });
  for (const entry of readdirSync(GENERATED)) {
    const entryPath = join(GENERATED, entry);
    if (GOVERNANCE_FILES.includes(entry)) {
      continue;
    }
    // This sibling artifact is owned by build-commons-index.mjs. Framework
    // rebuilds must not erase another generator's committed output.
    if (entry === "commons-search-index.json" || entry === "source-semantic-audit.json" || entry === "taxonomy-registry.json" || entry === "discovery-index.json") {
      continue;
    }
    if (
      entry === "library-search" ||
      entry === "library-search-index" ||
      entry === "atlas-neighborhood" ||
      entry === "catalog-records" ||
      entry === "graph-data"
    ) {
      rmSync(entryPath, { recursive: true, force: true });
      continue;
    }
    if (entry.endsWith(".json")) {
      rmSync(entryPath, { force: true });
    }
  }
  for (const [name, values] of Object.entries(collections)) {
    const collection = runtimeCollectionKey(name);
    if (SHARDED_RUNTIME_COLLECTIONS.has(name)) {
      const shardDir = join(GENERATED, "graph-data", name);
      mkdirSync(shardDir, { recursive: true });
      const chunkSize = Math.ceil(values.length / RUNTIME_COLLECTION_SHARD_COUNT);
      const shards = [];
      for (let index = 0; index < values.length; index += chunkSize) {
        const shardId = String(shards.length).padStart(3, "0");
        const path = `graph-data/${name}/${shardId}.json`;
        const chunk = values.slice(index, index + chunkSize);
        writeFileSync(
          join(GENERATED, path),
          `${JSON.stringify(artifact(collection, chunk, generatedAt))}\n`,
          "utf8",
        );
        shards.push({ path, record_count: chunk.length });
      }
      const manifest = artifact(collection, [], generatedAt);
      manifest.sharded_collection = {
        collection,
        record_count: values.length,
        content_sha256: collectionFingerprint(values),
        shards,
      };
      writeFileSync(
        join(GENERATED, `${name}.json`),
        `${JSON.stringify(manifest)}\n`,
        "utf8",
      );
      continue;
    }
    const value = artifact(collection, values, generatedAt);
    writeFileSync(
      join(GENERATED, `${name}.json`),
      `${JSON.stringify(value)}\n`,
      "utf8",
    );
  }

  // The Sources page reports what the build actually loaded and connected.
  // Deriving it in the browser would force the monolithic graph onto a route
  // that otherwise needs none, so it is computed once here and shipped as a
  // few hundred bytes.
  writeFileSync(
    join(GENERATED, "connection-inventory.json"),
    `${JSON.stringify(
      artifact(
        "connection_inventory",
        buildConnectionInventory(graph.nodes, graph.edges),
        generatedAt,
      ),
      null,
      2,
    )}
`,
    "utf8",
  );

  writeFileSync(
    join(GENERATED, "taxonomy-coverage.json"),
    `${JSON.stringify(
      artifact(
        "taxonomy_coverage",
        buildTaxonomyCoverage(graph.nodes, catalogs),
        generatedAt,
      ),
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(GENERATED, "source-manifests.json"),
    `${JSON.stringify(artifact("source_manifests", sourceManifests, generatedAt), null, 2)}\n`,
    "utf8",
  );
  writeJsonAtomically(
    join(GENERATED, "build-manifest.json"),
    artifact("build_manifest", buildManifest, generatedAt),
  );
  writeFileSync(
    join(GENERATED, "graph-diff-summary.json"),
    `${JSON.stringify(artifact("graph_diff_summary", diffSummary, generatedAt), null, 2)}\n`,
    "utf8",
  );

  // Search remains comprehensive, but it is not an initial-route payload.
  // Split it into bounded static files so a reader opens only the search data
  // when they search, while preserving every record and its title.
  const librarySearchDir = join(GENERATED, "library-search");
  mkdirSync(librarySearchDir, { recursive: true });
  const searchChunkSize = Math.ceil(
    librarySearch.documents.length / LIBRARY_SEARCH_SHARD_COUNT,
  );
  const searchShards = [];
  for (let index = 0; index < librarySearch.documents.length; index += searchChunkSize) {
    const shardId = String(searchShards.length).padStart(3, "0");
    const path = `library-search/${shardId}.json`;
    const documents = librarySearch.documents.slice(index, index + searchChunkSize);
    writeFileSync(
      join(GENERATED, path),
      `${JSON.stringify(artifact("library_search", { documents }, generatedAt))}\n`,
      "utf8",
    );
    searchShards.push({ path, record_count: documents.length });
  }
  const librarySearchManifest = artifact(
    "library_search",
    { ...librarySearch, documents: [] },
    generatedAt,
  );
  librarySearchManifest.sharded_collection = {
    collection: "library_search",
    record_count: librarySearch.documents.length,
    shards: searchShards,
  };
  writeFileSync(
    join(GENERATED, "library-search.json"),
    `${JSON.stringify(librarySearchManifest)}\n`,
    "utf8",
  );
  const librarySearchIndexDir = join(GENERATED, "library-search-index");
  mkdirSync(librarySearchIndexDir, { recursive: true });
  const indexChunkSize = Math.ceil(
    librarySearchIndex.document_count / LIBRARY_SEARCH_SHARD_COUNT,
  );
  const indexShards = [];
  for (let offset = 0; offset < librarySearchIndex.document_count; offset += indexChunkSize) {
    const shardId = String(indexShards.length).padStart(3, "0");
    const path = `library-search-index/${shardId}.json`;
    const columns = librarySearchIndex.columns.map((column) =>
      column.slice(offset, offset + indexChunkSize),
    );
    writeFileSync(
      join(GENERATED, path),
      `${JSON.stringify(artifact("library_search_index", {
        columns,
        document_count: columns[0]?.length || 0,
        fields: LIBRARY_SEARCH_INDEX_FIELDS,
        format: "columns-v1",
      }, generatedAt))}\n`,
      "utf8",
    );
    indexShards.push({ path, record_count: columns[0]?.length || 0 });
  }
  const librarySearchIndexManifest = artifact("library_search_index", {
    columns: [],
    document_count: librarySearchIndex.document_count,
    fields: LIBRARY_SEARCH_INDEX_FIELDS,
    format: "columns-v1",
  }, generatedAt);
  librarySearchIndexManifest.sharded_collection = {
    collection: "library_search_index",
    record_count: librarySearchIndex.document_count,
    shards: indexShards,
  };
  writeFileSync(
    join(GENERATED, "library-search-index.json"),
    `${JSON.stringify(librarySearchIndexManifest)}\n`,
    "utf8",
  );

  writeFileSync(
    join(GENERATED, "catalog-bootstrap.json"),
    `${JSON.stringify(
      artifact("catalog_bootstrap", catalogBootstrap, generatedAt),
    )}\n`,
    "utf8",
  );

  const catalogRecordsDir = join(GENERATED, "catalog-records");
  mkdirSync(catalogRecordsDir, { recursive: true });
  for (const [catalogId, nodes] of catalogRecords) {
    // DISA publishes individual STIG/SRG benchmarks. Keep the catalog landing
    // page small and load one published benchmark at a time; a single complete
    // STIG record artifact is larger than the static-file budget and delays a
    // reader who only needs one publication.
    if (catalogId === "disa-stig" || catalogId === "disa-srg") {
      const groups = new Map();
      for (const node of nodes) {
        if (node.node_type === "catalog" || node.node_type === "benchmark") {
          continue;
        }
        const family = node.metadata?.family;
        if (!family) {
          throw new Error(`${catalogId} record ${node.id} has no published benchmark`);
        }
        const groupNodes = groups.get(family) || [];
        groupNodes.push(node);
        groups.set(family, groupNodes);
      }
      const catalogDir = join(catalogRecordsDir, catalogId);
      mkdirSync(catalogDir, { recursive: true });
      const groupPaths = new Set();
      const publishedGroups = [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, groupNodes]) => {
          const filename = `${slugKey(name)}.json`;
          if (groupPaths.has(filename)) {
            throw new Error(`${catalogId} published benchmark path collision: ${filename}`);
          }
          groupPaths.add(filename);
          const path = `${catalogId}/${filename}`;
          writeFileSync(
            join(catalogRecordsDir, path),
            `${JSON.stringify(
              artifact(
                "catalog_records",
                { catalog_id: catalogId, published_group: name, nodes: groupNodes },
                generatedAt,
              ),
            )}\n`,
            "utf8",
          );
          return { name, path, record_count: groupNodes.length };
        });
      writeFileSync(
        join(catalogRecordsDir, `${catalogId}.json`),
        `${JSON.stringify(
          artifact(
            "catalog_records",
            {
              catalog_id: catalogId,
              sharded_by: "published_benchmark",
              record_count: publishedGroups.reduce(
                (count, group) => count + group.record_count,
                0,
              ),
              published_groups: publishedGroups,
              nodes: [],
            },
            generatedAt,
          ),
        )}\n`,
        "utf8",
      );
      continue;
    }
    writeFileSync(
      join(catalogRecordsDir, `${catalogId}.json`),
      `${JSON.stringify(
        artifact(
          "catalog_records",
          { catalog_id: catalogId, nodes },
          generatedAt,
        ),
      )}\n`,
      "utf8",
    );
  }

  // Generate neighborhood shards only after the catalog records have been
  // serialized. Each structure is a complete view of the graph; retaining
  // both while serializing the largest DISA catalog can exceed a constrained
  // workstation's native allocation limit even though each artifact itself is
  // within its size budget.
  const atlasNeighborhoodShards = buildAtlasNeighborhoodShards({
    ...graph,
    nodes: strippedGraphNodes,
  });
  mkdirSync(ATLAS_NEIGHBORHOOD_DIR, { recursive: true });
  const atlasShardManifest = [];
  for (const shard of atlasNeighborhoodShards) {
    const shardPath = `atlas-neighborhood/${shard.shard_id}.json`;
    writeFileSync(
      join(GENERATED, shardPath),
      `${JSON.stringify(
        artifact(
          "atlas_neighborhood_shard",
          {
            shard_id: shard.shard_id,
            record_count: shard.record_count,
            records: shard.records,
          },
          generatedAt,
        ),
      )}\n`,
      "utf8",
    );
    atlasShardManifest.push({
      shard_id: shard.shard_id,
      record_count: shard.record_count,
      path: shardPath,
      bytes: statSync(join(GENERATED, shardPath)).size,
    });
  }
  writeJsonAtomically(
    join(GENERATED, "atlas-neighborhood-manifest.json"),
    artifact(
      "atlas_neighborhood_manifest",
      {
        shard_count: ATLAS_NEIGHBORHOOD_SHARD_COUNT,
        hash_algorithm: "fnv1a-32",
        records: graph.nodes.length,
        shards: atlasShardManifest,
      },
      generatedAt,
    ),
  );

  return {
    sources: graph.sources.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    evidence: graph.evidence.length,
    findings: graph.findings.length,
  };
}

if (process.argv[1]?.includes("build-framework-data.mjs")) {
  const result = buildFrameworkData();
  console.log(
    `Built federal graph: ${result.sources} sources, ${result.nodes} nodes, ${result.edges} edges, ${result.evidence} evidence records, ${result.findings} findings`,
  );
}
