import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test, { before } from "node:test";
import { gzipSync } from "node:zlib";
import { RETIRED_RECORD_TYPES } from "../src/shared/record-acceptance.mjs";
import { parseCciXml } from "../tools/importers/cci-adapter.mjs";
import {
  parseOlirCsv,
  parseOlirExcel,
} from "../tools/relationship-builders/olir-adapter.mjs";
import {
  buildFrameworkData,
  cciClassificationLabel,
  lifecycleStatus,
  validateRecordPresentation,
} from "../scripts/build-framework-data.mjs";
import { readGeneratedCollection } from "../scripts/lib/generated-graph-artifacts.mjs";
import { evaluateTrunkReachability } from "../scripts/hierarchy-derivation.mjs";
import { atlasNeighborhoodShardId } from "../src/app/atlas-neighborhood.mjs";

const generated = (name) => readGeneratedCollection(".", name);
const sourceRegistry = JSON.parse(readFileSync("data/source-registry.json", "utf8"));
let buildResult;

before(() => {
  buildResult = buildFrameworkData();
});

test("CCI adapter preserves official bridge requirements and references", () => {
  const result = parseCciXml(
    readFileSync("tests/fixtures/cci/sample.xml", "utf8"),
  );
  assert.equal(result.records[0].id, "CCI-000015");
  assert.deepEqual(
    result.relationships.map((item) => item.target_id),
    ["AC-2.1"],
  );
  assert.ok(
    result.relationships.every(
      (item) => item.evidence_source === "disa-cci-nist-references",
    ),
  );
});

test("CCI classification is publisher-native and rejects unknown values", () => {
  assert.equal(cciClassificationLabel("policy"), "Policy");
  assert.equal(cciClassificationLabel("technical"), "Technical");
  assert.equal(
    cciClassificationLabel("policy,technical"),
    "Policy and Technical",
  );
  assert.throws(
    () => cciClassificationLabel("operational"),
    /Unsupported DISA CCI classification/,
  );
});

test("generated CCI records retain DISA classification and referenced NIST categories", () => {
  const nodes = generated("nodes").nodes;
  const expected = new Map([
    ["disa-cci:CCI-000001", "Policy"],
    ["disa-cci:CCI-000015", "Technical"],
    ["disa-cci:CCI-000099", "Policy and Technical"],
  ]);
  for (const [id, classification] of expected) {
    const node = nodes.find((entry) => entry.id === id);
    assert.equal(node?.metadata?.family, classification, id);
    assert.equal(node?.metadata?.classification_provenance, "publisher", id);
    assert.ok(node?.metadata?.description?.trim(), `${id} missing publisher text`);
    assert.ok(
      node?.metadata?.related_categories?.some(
        (category) =>
          category.code === "AC" &&
          category.label === "Access Control" &&
          category.provenance === "referenced",
      ),
      `${id} missing referenced Access Control category`,
    );
  }
});

test("every public record has an approved presentation profile and required source text", () => {
  assert.doesNotThrow(() => validateRecordPresentation(generated("nodes").nodes));
});

test("NIST Mobile uses publisher fields instead of adapter-generated threat prose", () => {
  const record = generated("nodes").nodes.find(
    (node) => node.id === "nist-mobile-threats:APP-0",
  );
  assert.ok(record, "APP-0 must remain in the Mobile Threat Catalogue");
  assert.equal(record.metadata.description, "");
  assert.equal(record.metadata.title, "Eavesdropping on Unencrypted App Traffic");
  assert.ok(record.metadata.countermeasures.length > 0);
});

test("NIST Mobile title-only records disclose publisher field availability instead of rendering empty", () => {
  const record = generated("nodes").nodes.find((node) => node.id === "nist-mobile-threats:CEL-10");
  assert.ok(record);
  assert.equal(record.metadata.description, "");
  assert.match(record.metadata.publisher_field_availability, /publishes a title/i);
  assert.equal(
    record.metadata.title,
    "Use of weaker, nonstandard handset authentication mechanism for consumer-grade femtocells",
  );
});

test("OLIR adapter preserves source and target identifiers", () => {
  const relationships = parseOlirCsv(
    readFileSync("tests/fixtures/olir/sample-crosswalk.csv", "utf8"),
  );
  assert.equal(relationships[0].source_id, "nist-800-53:AC-2");
  assert.equal(relationships[0].target_id, "csf-2:PR.AA-01");
});

test("OLIR adapter parses workbook rows from official-style crosswalk sheets", async () => {
  const buffer = readFileSync("tests/fixtures/olir/sample-crosswalk.xlsx");
  const relationships = await parseOlirExcel(buffer);
  assert.equal(relationships.length, 1);
  assert.equal(relationships[0].source_id, "AC-2");
  assert.equal(relationships[0].target_id, "PR.AA-01");
  assert.match(relationships[0].why, /Sample comment/);
});

test("federal graph build emits graph contract counts", () => {
  assert.ok(buildResult.sources >= 51);
  assert.ok(buildResult.nodes > 9000);
  assert.ok(buildResult.edges > 12000);
  assert.ok(buildResult.evidence >= buildResult.edges);
  assert.equal(buildResult.findings, 0);
});

test("authority nodes and issued-under relationships emit outside canonical organizes", () => {
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;
  const authorityNodes = nodes.filter((node) =>
    ["statute", "regulation", "policy_directive"].includes(node.node_type),
  );
  assert.equal(authorityNodes.length, 18);
  const issuedUnder = edges.filter(
    (edge) => edge.relationship_type === "issued_under",
  );
  assert.equal(issuedUnder.length, 37);
  assert.ok(
    issuedUnder.every(
      (edge) =>
        edge.relationship_class === "organizing" &&
        Array.isArray(edge.source_refs) &&
        edge.source_refs.length > 0,
    ),
  );
  assert.equal(
    edges.filter(
      (edge) =>
        edge.relationship_type === "organizes" &&
        (edge.source_node_id.startsWith("authority:") ||
          edge.target_node_id.startsWith("authority:")),
    ).length,
    0,
  );
  const incomingOrganizes = new Map();
  for (const edge of edges.filter(
    (entry) => entry.relationship_type === "organizes",
  )) {
    incomingOrganizes.set(
      edge.target_node_id,
      (incomingOrganizes.get(edge.target_node_id) || 0) + 1,
    );
  }
  assert.ok([...incomingOrganizes.values()].every((count) => count === 1));
});

test("runtime Atlas spine carries full L0-L3 structure and L4 summaries", () => {
  const artifact = generated("atlas-spine");
  const entries = artifact.atlas_spine.entries;
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    for (const field of [
      "id",
      "node_type",
      "label",
      "blurb",
      "parent_id",
      "child_count",
      "descendant_record_count",
    ]) {
      assert.ok(field in entry, `${entry.id} missing ${field}`);
    }
  }
  const catalogEntries = entries.filter((entry) => entry.node_type === "catalog");
  assert.equal(catalogEntries.length, 28);
  const publicationsByArea = new Map();
  for (const entry of catalogEntries) {
    publicationsByArea.set(
      entry.area_id,
      (publicationsByArea.get(entry.area_id) || 0) + 1,
    );
    assert.equal(typeof entry.mandate, "string");
    assert.ok("primary_authority" in entry);
    assert.ok(Array.isArray(entry.also_required_by));
    assert.ok(entry.publication_type);
    assert.ok(entry.mandate_note);
  }
  assert.equal(publicationsByArea.get("atlas:LIMB-COMPLIANCE"), 12);
  assert.equal(publicationsByArea.get("atlas:LIMB-GOVERNANCE"), 3);
  assert.equal(publicationsByArea.get("atlas:LIMB-IMPLEMENTATION"), 3);
  assert.ok((publicationsByArea.get("atlas:LIMB-RISK") || 0) > 0);
  assert.ok((publicationsByArea.get("atlas:LIMB-ASSESSMENT") || 0) > 0);
  const assessmentCatalog = catalogEntries.find(
    (entry) => entry.id === "nist-800-53a:CATALOG",
  );
  assert.ok(assessmentCatalog.child_count > 0);
  const assessmentFamilies = entries.filter(
    (entry) =>
      entry.parent_id === assessmentCatalog.id && entry.node_type === "family",
  );
  assert.equal(assessmentFamilies.length, assessmentCatalog.child_count);
  assert.ok(assessmentFamilies.every((entry) => entry.child_count > 0));
  assert.ok(
    entries.some(
      (entry) => entry.child_count !== entry.descendant_record_count,
    ),
    "child_count and descendant_record_count must remain distinct measures",
  );
  const buildManifest = generated("build-manifest");
  assert.ok(buildManifest.build_manifest.runtime_artifacts.includes("atlas-spine.json"));
  const catalogBootstrap = generated("catalog-bootstrap").catalog_bootstrap.catalogs;
  for (const catalog of catalogEntries) {
    const catalogId = catalog.id.slice(0, -":CATALOG".length);
    assert.equal(
      catalog.descendant_record_count,
      catalogBootstrap.find((entry) => entry.id === catalogId)?.leaf_record_count,
      `${catalogId} Atlas and bootstrap record counts must reconcile`,
    );
  }
});

test("catalog bootstrap reports actual cross-catalog mapping coverage", () => {
  const catalogs = generated("catalog-bootstrap").catalog_bootstrap.catalogs;
  for (const catalog of catalogs) {
    assert.equal(
      typeof catalog.cross_catalog_connected_count,
      "number",
      `${catalog.id} missing cross_catalog_connected_count`,
    );
    assert.ok(catalog.cross_catalog_connected_count >= 0);
    assert.ok(catalog.cross_catalog_connected_count <= catalog.node_count);
  }
  const expected = new Map([
    ["nist-ai-rmf", 0],
    ["nist-ssdf", 0],
    ["dod-rai", 0],
    ["nist-800-172", 1],
    ["cui-policy", 2],
  ]);
  for (const [catalogId, count] of expected) {
    assert.equal(
      catalogs.find((catalog) => catalog.id === catalogId)
        ?.cross_catalog_connected_count,
      count,
    );
  }
});

test("issue 10 graph build emits FIPS, RMF, family, and 800-53B context for AC-2", () => {
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;

  const nodeIds = new Set(nodes.map((node) => node.id));
  assert.ok(nodeIds.has("fips-199:FIPS-199-MODERATE"));
  assert.ok(nodeIds.has("fips-200:AC"));
  assert.ok(nodeIds.has("nist-800-37:RMF-SELECT"));
  assert.ok(nodeIds.has("nist-800-53b:MODERATE"));
  assert.ok(nodeIds.has("nist-800-53:FAMILY-AC"));

  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "nist-800-53b:MODERATE" &&
        edge.target_node_id === "nist-800-53:AC-2" &&
        edge.relationship_type === "selects" &&
        edge.relationship_class === "applicability",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "fips-199:FIPS-199-MODERATE" &&
        edge.target_node_id === "nist-800-53b:MODERATE" &&
        edge.relationship_type === "selects",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "fips-200:AC" &&
        edge.target_node_id === "nist-800-53:FAMILY-AC" &&
        edge.relationship_type === "references",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "nist-800-37:RMF-SELECT" &&
        edge.target_node_id === "nist-800-53b:MODERATE" &&
        edge.relationship_type === "selects",
    ),
  );
});

test("issue 11 graph build emits assessment context and governance artifacts for AC-2", () => {
  const sources = generated("sources").sources;
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;
  const evidence = generated("evidence").evidence;
  const buildManifest = generated("build-manifest");
  const sourceManifests = generated("source-manifests");
  const diffSummary = generated("graph-diff-summary");

  assert.ok(
    sources.some(
      (source) => source.id === "nist-800-53a-assessment-procedures",
    ),
  );
  const assessmentNode = nodes.find((node) => node.id === "nist-800-53a:AC-2");
  assert.ok(assessmentNode, "missing AC-2 assessment node");
  assert.equal(assessmentNode.node_type, "assessment_procedure");
  assert.ok(Array.isArray(assessmentNode.metadata.assessment_methods));
  assert.ok(Array.isArray(assessmentNode.metadata.assessment_objectives));
  assert.ok(Array.isArray(assessmentNode.metadata.assessment_objects));
  assert.match(
    assessmentNode.metadata.procedure_text,
    /account managers are assigned/i,
  );

  const assessmentEdge = edges.find(
    (edge) =>
      edge.source_node_id === "nist-800-53a:AC-2" &&
      edge.target_node_id === "nist-800-53:AC-2" &&
      edge.relationship_type === "assesses",
  );
  assert.ok(assessmentEdge, "missing AC-2 assesses edge");
  // build-framework-data.mjs omits evidence_ids when it's the mechanical
  // `evidence:<edge-id-suffix>` pattern — derive it back for this check.
  const assessmentEvidenceIds = assessmentEdge.evidence_ids !== undefined
    ? assessmentEdge.evidence_ids
    : [`evidence:${assessmentEdge.id.slice("edge:".length)}`];
  assert.ok(
    evidence.some((entry) => assessmentEvidenceIds.includes(entry.id)),
  );

  assert.ok(existsSync("data/generated/build-manifest.json"));
  assert.ok(existsSync("data/generated/source-manifests.json"));
  assert.ok(existsSync("data/generated/graph-diff-summary.json"));
  assert.ok(
    buildManifest.build_manifest.runtime_artifacts.includes(
      "graph-health.json",
    ),
  );
  assert.ok(
    buildManifest.build_manifest.governance_artifacts.includes(
      "build-manifest.json",
    ),
  );
  assert.ok(
    sourceManifests.source_manifests.some(
      (entry) => entry.source_id === "nist-800-53a-assessment-procedures",
    ),
  );
  const oscalSource = sources.find((source) => source.id === "nist-oscal");
  const oscalFreshness = sourceRegistry.freshness.sources.find(
    (entry) => entry.source_id === "nist-oscal",
  );
  assert.equal(oscalSource.sync_model, "auto_synced");
  assert.equal(oscalSource.last_checked, oscalFreshness.last_checked);
  assert.equal(oscalSource.stale_after_days, 45);
  const oscalManifest = sourceManifests.source_manifests.find(
    (entry) => entry.source_id === "nist-oscal",
  );
  assert.equal(oscalManifest.sync_model, "auto_synced");
  assert.equal(oscalManifest.last_checked, oscalFreshness.last_checked);
  assert.equal(oscalManifest.stale_after_days, 45);
  assert.equal(diffSummary.graph_diff_summary.kind, "graph_diff_summary");
});

test("issue 12 graph build emits Release 2 program context without a synthetic revision bridge", () => {
  const sources = generated("sources").sources;
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;

  const sourceIds = new Set(sources.map((source) => source.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const id of [
    "nist-800-171-rev2",
    "nist-800-172-rev3",
    "isoo-cui-regulation",
    "nara-cui-registry",
  ]) {
    assert.ok(sourceIds.has(id), `missing source ${id}`);
  }

  for (const id of [
    "nist-800-171-rev2:3.1.1",
    "nist-800-171-rev2:CATALOG",
    "nist-800-171:CATALOG",
    "nist-800-172:3.1.1E",
    "nist-800-172:CATALOG",
    "cui-policy:CUI-PROGRAM",
    "cui-policy:CUI-BASIC",
    "cui-policy:CUI-SPECIFIED",
  ]) {
    assert.ok(nodeIds.has(id), `missing node ${id}`);
  }

  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "fedramp-rev5:MODERATE" &&
        edge.target_node_id === "nist-800-53:AC-2" &&
        edge.relationship_type === "selects" &&
        edge.relationship_class === "applicability",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "cmmc-2:LEVEL-2" &&
        edge.target_node_id === "nist-800-171-rev2:3.1.1" &&
        edge.relationship_type === "requires",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "cmmc-2:LEVEL-3" &&
        edge.target_node_id === "nist-800-171-rev2:CATALOG" &&
        edge.relationship_type === "depends_on",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "cmmc-2:LEVEL-3" &&
        edge.target_node_id === "nist-800-172:CATALOG" &&
        edge.relationship_type === "depends_on",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "nist-800-171-rev2:CATALOG" &&
        edge.target_node_id === "cui-policy:CUI-BASIC" &&
        edge.relationship_type === "protects",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "nist-800-172:CATALOG" &&
        edge.target_node_id === "cui-policy:CUI-PROGRAM" &&
        edge.relationship_type === "supports",
    ),
  );
  assert.ok(
    !edges.some(
      (edge) =>
        edge.source_node_id === "cmmc-2:LEVEL-2" &&
        edge.target_node_id.startsWith("nist-800-171:") &&
        edge.relationship_type === "requires",
    ),
  );
  assert.ok(
    !edges.some(
      (edge) =>
        edge.source_node_id === "cmmc-2:LEVEL-2" &&
        edge.target_node_id === "nist-800-53:AC-2",
    ),
  );
});

test("epic 2 graph build emits DISA STIG and SRG nodes plus official CCI references", () => {
  const sources = generated("sources").sources;
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;

  const sourceIds = new Set(sources.map((source) => source.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const id of [
    "disa-stig-library",
    "disa-srg-library",
    "disa-stig-srg-cci-references",
  ]) {
    assert.ok(sourceIds.has(id), `missing source ${id}`);
  }

  const stigNodes = nodes.filter((node) => node.id.startsWith("disa-stig:"));
  const srgNodes = nodes.filter((node) => node.id.startsWith("disa-srg:"));
  assert.ok(stigNodes.length > 0, "expected at least one disa-stig node");
  assert.ok(srgNodes.length > 0, "expected at least one disa-srg node");

  const stigCciEdge = edges.find(
    (edge) =>
      edge.source_node_id.startsWith("disa-stig:") &&
      edge.target_node_id.startsWith("disa-cci:") &&
      edge.relationship_type === "references",
  );
  assert.ok(
    stigCciEdge,
    "expected at least one disa-stig -> disa-cci references edge",
  );

  const srgCciEdge = edges.find(
    (edge) =>
      edge.source_node_id.startsWith("disa-srg:") &&
      edge.target_node_id.startsWith("disa-cci:") &&
      edge.relationship_type === "references",
  );
  assert.ok(
    srgCciEdge,
    "expected at least one disa-srg -> disa-cci references edge",
  );

  assert.ok(
    !edges.some(
      (edge) =>
        edge.source_node_id.startsWith("disa-stig:") &&
        edge.target_node_id === "nist-800-53:AC-2",
    ),
  );
});

test("epic 2 graph build emits a complete bounded library search artifact", () => {
  const artifact = generated("library-search");
  const edges = generated("edges").edges;
  const nodes = generated("nodes").nodes;
  const structuralTypes = new Set([
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
  // Retired record types (issue 279) stay in the graph but are not search records.
  const isSearchable = (type) => !structuralTypes.has(type) && !RETIRED_RECORD_TYPES.has(type);
  const publicRecordCount = nodes.filter((node) => isSearchable(node.node_type)).length;

  assert.equal(artifact.schema_version, "1.0");
  assert.equal(artifact.library_search.document_count, publicRecordCount);
  assert.ok(Array.isArray(artifact.library_search.documents));
  assert.ok(
    artifact.library_search.documents.every(
      (document) => isSearchable(document.object_type),
    ),
    "Library search must contain publisher records, not synthetic grouping nodes",
  );
  assert.ok(
    artifact.library_search.documents.every(
      (document) => !/^(?:Catalog summary for|Assessment procedures for)\b/i.test(document.official_text_preview || ""),
    ),
    "Library previews must come from publisher text, never generated filler",
  );
  assert.equal(
    artifact.library_search.serialized_index,
    undefined,
    "the complete document register is the search owner; a duplicate serialized index must not block startup",
  );
  assert.equal(
    existsSync(join("data", "generated", "library-search")),
    true,
    "full search records are delivered through bounded runtime shards",
  );
  const indexedSearchPath = join("data", "generated", "library-search-index.json");
  assert.equal(
    existsSync(indexedSearchPath),
    true,
    "the interactive search route has a result-only columnar index",
  );
  const indexedSearchArtifact = JSON.parse(readFileSync(indexedSearchPath, "utf8"));
  const indexedSearch = indexedSearchArtifact.library_search_index;
  assert.equal(indexedSearch.format, "columns-v1");
  assert.equal(indexedSearch.document_count, publicRecordCount);
  assert.equal(indexedSearch.columns.length, 0, "the manifest must not duplicate index columns");
  assert.equal(indexedSearchArtifact.sharded_collection.record_count, publicRecordCount);
  assert.equal(
    existsSync(join("data", "generated", "library-search-manifest.json")),
    false,
    "the shard scheduler manifest must not survive the global-index migration",
  );

  const ac2 = artifact.library_search.documents.find(
    (entry) => entry.id === "nist-800-53:AC-2",
  );
  assert.ok(ac2, "missing AC-2 library document");
  assert.equal(ac2.object_type, "control");
  assert.equal(ac2.source_id, "nist-800-53");
  assert.equal(
    ac2.source_name,
    "SP 800-53 Rev. 5",
    "library documents must carry a resolved source name so search-phase result cards can render it before sources.json loads",
  );
  assert.equal(
    ac2.publisher_name,
    "NIST",
    "every search document must carry the official publisher before sources.json loads",
  );
  assert.equal(
    ac2.published_connection_count,
    edges.filter((edge) =>
      edge.publication_status === "published" &&
      (edge.source_node_id === ac2.id || edge.target_node_id === ac2.id),
    ).length,
    "the search artifact must preserve the neighborhood's total published connection count",
  );
  const ac2Neighborhood = JSON.parse(readFileSync(
    join("data", "generated", "atlas-neighborhood", `${atlasNeighborhoodShardId(ac2.id)}.json`),
    "utf8",
  )).atlas_neighborhood_shard.records[ac2.id];
  assert.equal(
    ac2.published_connection_count,
    ac2Neighborhood.published_connection_count,
    "search and record-detail artifacts must keep the same total published connection count",
  );
  assert.equal(
    ac2.published_cross_catalog_connection_count,
    edges.filter((edge) => {
      if (
        edge.publication_status !== "published" ||
        !edge.relationship_type ||
        !edge.provenance_class
      ) return false;
      const counterpartId = edge.source_node_id === ac2.id
        ? edge.target_node_id
        : edge.target_node_id === ac2.id
          ? edge.source_node_id
          : "";
      if (!counterpartId) return false;
      const counterpart = nodes.find((node) => node.id === counterpartId);
      return Boolean(
        counterpart?.metadata?.catalog_id &&
        counterpart.metadata.catalog_id !== ac2.catalog_id,
      );
    }).length,
    "the search artifact must separately count only published cross-catalog mappings",
  );
  assert.equal(ac2.source_class, "federal_published");
  assert.equal(ac2.control_family, "Access Control");
  assert.ok(
    ac2.published_connection_catalog_count > 0,
    "search results with mappings must identify how many publications they connect to",
  );
  assert.equal(
    ac2.description_available,
    true,
    "search must disclose when published record text is available",
  );
  const officialDescription = nodes
    .find((entry) => entry.id === ac2.id)
    .metadata.description.replace(/\s+/g, " ")
    .trim();
  assert.ok(
    ac2.official_text_preview.length >= 120 &&
      ac2.official_text_preview.length <= 181,
    "search must carry a bounded excerpt of the official text",
  );
  assert.ok(
    officialDescription.startsWith(ac2.official_text_preview.replace(/…$/, "")),
    "the preview must be copied from the official record text",
  );
  assert.equal(
    ac2.description,
    undefined,
    "full published text belongs to the record payload, not the search bootstrap",
  );
  assert.equal(ac2.plain_language_summary, undefined);
  assert.ok(
    artifact.library_search.facets.publishers.includes("NIST"),
    "publisher must be available as a search facet",
  );
});

test("zero-padded OLIR mapping endpoints resolve to catalog nodes", () => {
  const edges = generated("edges").edges;
  const findings = generated("graph-health").findings;

  // maps/800-53-to-csf.json writes "AC-01"/"CM-07(02)"; ingested nodes use
  // "AC-1"/"CM-7.2". The build must normalize the notation, not block the
  // relationship.
  assert.ok(
    edges.some(
      (edge) =>
        edge.id.startsWith("edge:800-53-to-csf:") &&
        edge.source_node_id === "nist-800-53:AC-1" &&
        edge.target_node_id.startsWith("csf-2:"),
    ),
    "expected zero-padded AC-01 CSF mapping to resolve to nist-800-53:AC-1",
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.id.startsWith("edge:800-53-to-csf:") &&
        edge.source_node_id === "nist-800-53:CM-7.2",
    ),
    "expected paren enhancement CM-07(02) to resolve to nist-800-53:CM-7.2",
  );

  // Notation and publisher-native grouping IDs must both resolve. The OLIR
  // source includes bare 800-53 family IDs (CP/IR/PT) and CSF category IDs
  // (RC.RP/RS.MA); these map to genuine grouping nodes, not fabricated leaves.
  const blocked = findings.filter(
    (finding) => finding.finding_type === "blocked_relationship",
  );
  const p171Blocked = blocked.filter((finding) =>
    finding.subject_id.startsWith("800-53-to-800-171:"),
  );
  assert.equal(
    p171Blocked.length,
    0,
    "every SP 800-171 OLIR mapping was blocked only by control ID notation and must now resolve",
  );
  const csfBlocked = blocked.filter((finding) =>
    finding.subject_id.startsWith("800-53-to-csf:"),
  );
  assert.equal(
    csfBlocked.length,
    0,
    "every CSF OLIR endpoint must resolve to its leaf or publisher-native grouping node",
  );
  for (const [sourceNodeId, targetNodeId] of [
    ["nist-800-53:FAMILY-CP", "csf-2:PR.IR-03"],
    ["nist-800-53:FAMILY-IR", "csf-2:PR.IR-03"],
    ["nist-800-53:FAMILY-PT", "csf-2:GV.OC-03"],
    ["nist-800-53:CP-4", "csf-2:CATEGORY-RC.RP"],
    ["nist-800-53:CP-10", "csf-2:CATEGORY-RC.RP"],
    ["nist-800-53:IR-4", "csf-2:CATEGORY-RS.MA"],
    ["nist-800-53:IR-7", "csf-2:CATEGORY-RS.MA"],
    ["nist-800-53:IR-8", "csf-2:CATEGORY-RS.MA"],
    ["nist-800-53:IR-9", "csf-2:CATEGORY-RS.MA"],
  ]) {
    // spec §5: OLIR relationship models (Concept Crosswalk, Set Theory,
    // Supportive, Derived Relationship Mapping) are preserved as their real
    // type, not flattened to the generic "maps_to".
    assert.ok(
      edges.some(
        (edge) =>
          edge.source_node_id === sourceNodeId &&
          edge.target_node_id === targetNodeId &&
          edge.relationship_type !== "maps_to" &&
          edge.mapping_model === "correlation",
      ),
      `missing official OLIR grouping mapping ${sourceNodeId} -> ${targetNodeId}`,
    );
  }
});

test("complete library search bootstrap stays within its compressed transfer budget", () => {
  const artifactPath = join("data", "generated", "library-search.json");
  const compressedBytes = gzipSync(readFileSync(artifactPath), {
    level: 9,
  }).byteLength;

  assert.ok(
    compressedBytes <= 750_000,
    `complete search artifact exceeds 750 KB compressed: ${compressedBytes}`,
  );
});

test("dod-zt graph build emits pillars, capabilities, and overlay crosswalk edges", () => {
  const sources = generated("sources").sources;
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;

  const sourceIds = new Set(sources.map((source) => source.id));
  for (const id of [
    "dod-zt-reference-architecture-v2",
    "dod-zt-strategy",
    "dod-zt-overlays-2024",
    "dod-zt-capabilities",
    "dod-zt-execution-roadmap",
  ]) {
    assert.ok(sourceIds.has(id), `missing source ${id}`);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  assert.ok(nodeIds.has("dod-zt:CATALOG"));
  assert.ok(nodeIds.has("dod-zt:TENET-1"));
  assert.ok(nodeIds.has("dod-zt:PILLAR-1"));
  assert.ok(nodeIds.has("dod-zt:CAP-1-1"));
  assert.ok(nodeIds.has("dod-zt:ACT-1-1-1"));

  const ztNodes = nodes.filter(
    (node) => node.metadata?.catalog_id === "dod-zt",
  );
  assert.ok(
    ztNodes.filter((node) => node.node_type === "zt_tenet").length >= 5,
  );
  assert.ok(
    ztNodes.filter((node) => node.node_type === "zt_pillar").length >= 7,
  );
  assert.ok(
    ztNodes.filter((node) => node.node_type === "zt_capability").length >= 40,
  );

  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "dod-zt:PILLAR-1" &&
        edge.target_node_id === "dod-zt:CAP-1-1" &&
        edge.relationship_type === "contains" &&
        edge.relationship_class === "structural",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "nist-800-53:AC-2" &&
        edge.target_node_id.startsWith("dod-zt:CAP-") &&
        edge.relationship_type === "supports",
    ),
  );
  assert.ok(
    edges.some(
      (edge) =>
        edge.source_node_id === "dod-zt:DOC-OVERLAYS" &&
        edge.target_node_id === "dod-zt:DOC-RA" &&
        edge.relationship_type === "references",
    ),
  );

  const overlayIds = [
    "APP",
    "AUTO",
    "DATA",
    "DEVICE",
    "ENABLER",
    "NET",
    "USER",
    "VIS",
  ].map((suffix) => `dod-zt:OVERLAY-${suffix}`);
  const residualOverlayEdges = edges.filter(
    (edge) =>
      edge.source_node_id === "dod-zt:CATALOG" &&
      overlayIds.includes(edge.target_node_id) &&
      edge.relationship_type === "contains" &&
      edge.relationship_class === "structural",
  );
  assert.equal(residualOverlayEdges.length, 0);
  assert.ok(overlayIds.every((id) => !nodeIds.has(id)), "overlay appendices must not survive as empty structural records");

  const reachability = evaluateTrunkReachability(nodes, edges, "atlas:TRUNK");
  assert.deepEqual(reachability.undirectedOrphans, []);
  assert.deepEqual(reachability.canonicalOrphans, []);
  assert.equal(
    reachability.eligibleNodeCount + reachability.exemptAuthorityNodeCount,
    reachability.totalNodeCount,
  );
  assert.equal(reachability.undirected.size, reachability.eligibleNodeCount);
  assert.equal(reachability.canonical.size, reachability.eligibleNodeCount);
});

test("lifecycleStatus maps withdrawn and deprecated record statuses to node lifecycle_status", () => {
  assert.equal(lifecycleStatus({ status: "withdrawn" }), "withdrawn");
  assert.equal(lifecycleStatus({ status: "deprecated" }), "deprecated");
  assert.equal(lifecycleStatus({ status: undefined }), "active");
  assert.equal(lifecycleStatus({}), "active");
});

test("graph build derives structural control-enhancement edges with derived confidence", () => {
  const nodes = generated("nodes").nodes;
  const edges = generated("edges").edges;

  const enhancementNode = nodes.find(
    (node) => node.id === "nist-800-53:AC-2.1",
  );
  assert.ok(enhancementNode, "expected AC-2.1 node to exist");
  assert.equal(enhancementNode.node_type, "control_enhancement");

  const enhancementEdge = edges.find(
    (edge) =>
      edge.source_node_id === "nist-800-53:AC-2" &&
      edge.target_node_id === "nist-800-53:AC-2.1" &&
      edge.relationship_type === "contains" &&
      edge.relationship_class === "structural",
  );
  assert.ok(enhancementEdge, "expected AC-2 -> AC-2.1 structural edge");
  assert.equal(enhancementEdge.confidence, "derived");
  assert.match(enhancementEdge.rationale, /control enhancement of AC-2/);

  // Family-membership edges are structural ID-parsing, the same kind of
  // derivation as enhancement membership above, so they carry the same
  // 'derived' confidence rather than being rubber-stamped 'direct' (CATL-23).
  const familyEdge = edges.find(
    (edge) =>
      edge.source_node_id === "nist-800-53:FAMILY-AC" &&
      edge.target_node_id === "nist-800-53:AC-2" &&
      edge.relationship_type === "contains" &&
      edge.relationship_class === "structural",
  );
  assert.ok(familyEdge);
  assert.equal(familyEdge.confidence, "derived");

  // No duplicate enhancement edges after two consecutive builds.
  const edgesAfterRebuild = generated("edges").edges;
  const enhancementEdgeCount = edgesAfterRebuild.filter(
    (edge) =>
      edge.source_node_id === "nist-800-53:AC-2" &&
      edge.target_node_id === "nist-800-53:AC-2.1" &&
      edge.relationship_type === "contains" &&
      edge.relationship_class === "structural",
  ).length;
  assert.equal(
    enhancementEdgeCount,
    1,
    "expected exactly one AC-2 -> AC-2.1 structural edge, no duplicates",
  );
});

test("graph build removes the retired curated translation path", () => {
  assert.equal(existsSync("data/curated/plain-language/controls-800-53.json"), false);
  const nodes = generated("nodes").nodes;
  assert.ok(nodes.every((node) => node.plain_language_summary === undefined && node.metadata?.plain_action === undefined));
});
