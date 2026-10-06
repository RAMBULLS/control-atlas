import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readGeneratedCollection } from "../scripts/lib/generated-graph-artifacts.mjs";
import { loadRecordAcceptanceMatrix } from "../tools/record-acceptance-matrix.mjs";
import { RECORD_FACT_LABELS } from "../src/shared/record-fact-labels.mjs";
import {
  CONTENT_SHAPES,
  createRecordMatrixAccumulator,
  dispositionFor,
  isRetiredRecordPair,
  RECORD_DISPOSITIONS,
  RECORD_TYPE_DISPOSITIONS,
  recordActionPolicy,
  recordRetirement,
  RETIRED_RECORD_TYPES,
  recordShowsChildInventory,
  registeredRecordPairs,
  REVIEW_STATUS,
  shapeDispositionIssue,
  TEMPLATE_HANDOFF_FRAMEWORKS,
  unlabeledPublishedFacts,
} from "../src/shared/record-acceptance.mjs";
import {
  CATALOG_RECORD_TYPES,
  NON_RECORD_NODE_TYPES,
  PAGE_ROLES,
  SUPPORTED_RECORD_TYPES,
} from "../src/shared/record-presentation.mjs";

const PRESENTATION_SCOPE = { limb: "atlas-organizing-spine", trunk: "atlas-organizing-spine", policy_directive: "atlas-authority-spine", regulation: "atlas-authority-spine", statute: "atlas-authority-spine" };

// The pair list is derived from the registry. Nothing below hard-codes how many
// pairs, catalogs or types exist, so a new publication cannot silently bypass
// review and a corpus refresh cannot break the suite.

test("every registered catalog x type pair has a recorded disposition", () => {
  const missing = registeredRecordPairs()
    .filter((pair) => !dispositionFor(pair.catalogId, pair.recordType))
    .map((pair) => pair.key);
  assert.deepEqual(missing, [], `Add a disposition in src/shared/record-acceptance.mjs for: ${missing.join(", ")}`);
});

test("dispositions name only real record types and use the allowed outcomes", () => {
  const allowed = new Set(Object.values(RECORD_DISPOSITIONS));
  for (const [type, entry] of Object.entries(RECORD_TYPE_DISPOSITIONS)) {
    assert.ok(SUPPORTED_RECORD_TYPES.includes(type), `${type} is not a supported record type`);
    assert.ok(allowed.has(entry.disposition), `${type} has an invalid disposition`);
    assert.ok(entry.reason && entry.reason.length > 10, `${type} needs a stated reason`);
    if (entry.tier !== undefined) assert.ok([1, 2, 3].includes(entry.tier), `${type} has an invalid tier`);
  }
  const acceptedStatuses = new Set(Object.values(REVIEW_STATUS));
  for (const pair of registeredRecordPairs()) {
    assert.ok(acceptedStatuses.has(dispositionFor(pair.catalogId, pair.recordType).status));
  }
});

test("every record type declares a content shape", () => {
  const validShapes = new Set(Object.values(CONTENT_SHAPES));
  for (const [type, entry] of Object.entries(RECORD_TYPE_DISPOSITIONS)) {
    assert.ok(entry.shape, `${type} has no content shape`);
    assert.ok(validShapes.has(entry.shape), `${type} has an invalid content shape`);
  }
});

test("a fragment can never stand alone, and a reference is always SOURCE-ONLY", () => {
  // This is the permanent guard against another control_context: a type that
  // only means something attached to a parent must FOLD or REMOVE, and a
  // governing document served through Sources must never be an ordinary KEEP.
  const abundant = { maxChars: 5000, maxChildren: 5, maxEdges: 5, maxSelected: 5 };
  assert.match(
    shapeDispositionIssue(CONTENT_SHAPES.FRAGMENT, RECORD_DISPOSITIONS.KEEP, abundant),
    /SHAPE_DISPOSITION_MISMATCH/,
  );
  assert.match(
    shapeDispositionIssue(CONTENT_SHAPES.FRAGMENT, RECORD_DISPOSITIONS.REWORK, abundant),
    /SHAPE_DISPOSITION_MISMATCH/,
  );
  assert.equal(shapeDispositionIssue(CONTENT_SHAPES.FRAGMENT, RECORD_DISPOSITIONS.FOLD_INTO_PARENT, abundant), null);
  assert.equal(shapeDispositionIssue(CONTENT_SHAPES.FRAGMENT, RECORD_DISPOSITIONS.REMOVE_FROM_PUBLIC_DISCOVERY, abundant), null);
  assert.match(
    shapeDispositionIssue(CONTENT_SHAPES.REFERENCE, RECORD_DISPOSITIONS.KEEP, abundant),
    /SHAPE_DISPOSITION_MISMATCH/,
  );
  assert.equal(shapeDispositionIssue(CONTENT_SHAPES.REFERENCE, RECORD_DISPOSITIONS.SOURCE_ONLY, abundant), null);
});

test("a standalone type needs real text, children or connections on at least one axis", () => {
  const nothing = { maxChars: 0, maxChildren: 0, maxEdges: 0, maxSelected: 0 };
  for (const shape of [CONTENT_SHAPES.CONTENT, CONTENT_SHAPES.HIERARCHY, CONTENT_SHAPES.SELECTION]) {
    assert.match(shapeDispositionIssue(shape, RECORD_DISPOSITIONS.KEEP, nothing), /NO_SUBSTANCE/, shape);
    // Any single axis is enough - a type does not have to be exclusively
    // narrative or exclusively a hierarchy (dod-zt:zt_pillar is real prose;
    // microsoft-zt-maturity:zt_pillar is a pure container - same type name).
    assert.equal(shapeDispositionIssue(shape, RECORD_DISPOSITIONS.KEEP, { ...nothing, maxChars: 40 }), null, `${shape} chars`);
    assert.equal(shapeDispositionIssue(shape, RECORD_DISPOSITIONS.KEEP, { ...nothing, maxChildren: 1 }), null, `${shape} children`);
    assert.equal(shapeDispositionIssue(shape, RECORD_DISPOSITIONS.KEEP, { ...nothing, maxEdges: 1 }), null, `${shape} edges`);
    assert.equal(shapeDispositionIssue(shape, RECORD_DISPOSITIONS.KEEP, { ...nothing, maxSelected: 1 }), null, `${shape} selections`);
  }
  // A record just under the character floor with nothing else is still thin.
  assert.match(shapeDispositionIssue(CONTENT_SHAPES.CONTENT, RECORD_DISPOSITIONS.KEEP, { ...nothing, maxChars: 39 }), /NO_SUBSTANCE/);
});

test("control_context is a fragment: FOLD, not a standalone page", () => {
  const entry = dispositionFor("fedramp-2026", "control_context");
  assert.equal(entry.shape, CONTENT_SHAPES.FRAGMENT);
  assert.equal(entry.disposition, RECORD_DISPOSITIONS.FOLD_INTO_PARENT);
  assert.equal(isRetiredRecordPair("fedramp-2026", "control_context"), true);
});

test("the generated matrix reports content_shape and max_content_chars for every pair", () => {
  const accumulator = createRecordMatrixAccumulator();
  accumulator.addNode({
    id: "nist-zt:MAPPING-CONTRIBUTOR-TEST", node_type: "zt_mapping_contributor", source_id: "src", lifecycle_status: "active",
    metadata: { catalog_id: "nist-zt", item_id: "MAPPING-CONTRIBUTOR-TEST", title: "Test Contributor", publisher_field: "d".repeat(500) },
  });
  const { rows } = accumulator.finish();
  const row = rows.find((entry) => entry.pair === "nist-zt:zt_mapping_contributor");
  assert.equal(row.content_shape, CONTENT_SHAPES.FRAGMENT);
  assert.ok(row.max_content_chars >= 500);
  // Correctly dispositioned (FOLD, not standalone), so the shape/disposition
  // pairing is sound even though this record happens to carry real text.
  assert.deepEqual(row.issues, []);
  assert.equal(row.acceptance, "PROVISIONAL");
});

test("every published fact has a practitioner-facing label", () => {
  const leaks = registeredRecordPairs()
    .map((pair) => [pair.key, unlabeledPublishedFacts(pair.contract)])
    .filter(([, fields]) => fields.length)
    .map(([key, fields]) => `${key}: ${fields.join(", ")}`);
  assert.deepEqual(leaks, [], "These metadata_facts would print their raw schema key on the page");
  for (const [field, label] of Object.entries(RECORD_FACT_LABELS)) {
    assert.ok(label && label !== field && !/_/.test(label), `${field} label must read as plain language`);
  }
});

test("the search exclusion set only names types the registry knows", () => {
  const registered = new Set(Object.values(CATALOG_RECORD_TYPES).flat());
  for (const type of NON_RECORD_NODE_TYPES) assert.ok(registered.has(type), `${type} is excluded but not registered`);
});

test("the search exclusion set matches the one the data build applies", () => {
  // build-framework-data.mjs is a data-pipeline script, so it keeps its own copy
  // of this set. Compare source text so the two cannot drift apart.
  const source = readFileSync(new URL("../scripts/build-framework-data.mjs", import.meta.url), "utf8");
  const block = source.match(/const NON_RECORD_NODE_TYPES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, "NON_RECORD_NODE_TYPES not found in build-framework-data.mjs");
  const built = [...block[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual([...NON_RECORD_NODE_TYPES].sort(), built);
});

test("compare is offered only for a comparable role with a real mapping to compare", () => {
  const base = { catalogId: "nist-800-53", pageRole: PAGE_ROLES.ATOMIC_RECORD, hasItemId: true, comparableEdgeCount: 2 };
  assert.equal(recordActionPolicy(base).compare, true);
  assert.equal(recordActionPolicy({ ...base, comparableEdgeCount: 0 }).compare, false);
  assert.equal(recordActionPolicy({ ...base, pageRole: PAGE_ROLES.CONTAINER }).compare, false);
  assert.equal(recordActionPolicy({ ...base, pageRole: PAGE_ROLES.ENTITY_CONTRIBUTOR }).compare, false);
  assert.equal(recordActionPolicy({ ...base, hasItemId: false }).compare, false);
});

test("templates are offered only where the Templates page can preselect the catalog", () => {
  const policy = (catalogId) => recordActionPolicy({ catalogId, pageRole: PAGE_ROLES.ATOMIC_RECORD });
  assert.equal(policy("nist-800-53").templateFramework, "nist-800-53");
  assert.equal(policy("nist-800-53b").templateFramework, "nist-800-53");
  assert.equal(policy("fedramp-rev5").templateFramework, "fedramp-rev5");
  for (const catalogId of ["disa-stig", "mitre-attack", "nist-zt", "cmmc-2"]) {
    assert.equal(policy(catalogId).templateFramework, null, `${catalogId} has no template context`);
  }
  assert.ok(Object.keys(TEMPLATE_HANDOFF_FRAMEWORKS).length > 0);
});

test("Atlas is promoted to the header only when there is something to explore", () => {
  const policy = (patch) => recordActionPolicy({ catalogId: "disa-stig", pageRole: PAGE_ROLES.ATOMIC_RECORD, ...patch });
  assert.equal(policy({}).atlas.header, false);
  assert.equal(policy({ connectionCount: 3 }).atlas.header, true);
  assert.equal(policy({ structuralChildCount: 2 }).atlas.header, true);
  assert.equal(policy({}).atlas.rail, true, "the sidebar Atlas link is always available");
  assert.equal(policy({}).share, true);
  assert.equal(policy({}).report, true);
});

test("a container never shows an empty child inventory", () => {
  assert.equal(recordShowsChildInventory({ pageRole: PAGE_ROLES.CONTAINER, structuralChildCount: 0 }), false);
  assert.equal(recordShowsChildInventory({ pageRole: PAGE_ROLES.CONTAINER, structuralChildCount: 4 }), true);
  assert.equal(recordShowsChildInventory({ pageRole: PAGE_ROLES.PUBLICATION_DOCUMENT, structuralChildCount: 0 }), false);
  assert.equal(recordShowsChildInventory({ pageRole: PAGE_ROLES.PUBLICATION_DOCUMENT, structuralChildCount: 1 }), true);
  assert.equal(recordShowsChildInventory({ pageRole: PAGE_ROLES.ATOMIC_RECORD, structuralChildCount: 9 }), false);
});

test("the accumulator picks representatives and counts empty containers from real edges", () => {
  const accumulator = createRecordMatrixAccumulator();
  const node = (id, extra = {}) => ({
    id, node_type: "baseline", source_id: "src", lifecycle_status: "active",
    metadata: { catalog_id: "nist-800-53b", item_id: id.split(":")[1], title: id, description: "d".repeat(20), ...extra },
  });
  accumulator.addNode(node("nist-800-53b:LOW"));
  accumulator.addNode(node("nist-800-53b:HIGH", { child_count: 400 }));
  accumulator.addNode({ ...node("nist-800-53b:OLD"), lifecycle_status: "superseded" });
  accumulator.addEdge({ source_node_id: "nist-800-53b:HIGH", target_node_id: "nist-800-53b:LOW", relationship_class: "structural", publication_status: "published" });
  accumulator.addEdge({ source_node_id: "nist-800-53b:LOW", target_node_id: "x", relationship_class: "correlation", relationship_type: "maps_to", publication_status: "published", source_refs: [{ source_id: "s" }] });
  accumulator.addEdge({ source_node_id: "nist-800-53b:OLD", target_node_id: "x", relationship_class: "correlation", relationship_type: "maps_to", publication_status: "candidate" });
  const { rows } = accumulator.finish({ sourceLabel: () => "NIST" });
  const row = rows.find((entry) => entry.pair === "nist-800-53b:baseline");
  assert.equal(row.record_count, 3);
  assert.equal(row.representative_id, "nist-800-53b:HIGH", "the densest record represents the pair");
  assert.equal(row.historical_id, "nist-800-53b:OLD");
  assert.equal(row.most_connected_id, "nist-800-53b:LOW");
  assert.equal(row.empty_container_records, 2, "LOW and OLD publish no children");
  assert.ok(row.issues.some((issue) => issue.startsWith("EMPTY_CONTAINERS")));
  assert.equal(row.publisher, "NIST");
  const untouched = rows.find((entry) => entry.pair === "nist-800-53b:catalog");
  assert.equal(untouched.acceptance, "BLOCKED", "a registered pair with no record in the corpus must fail loudly");
  assert.ok(untouched.issues.includes("NO_REPRESENTATIVE_RECORD"));
});

test("a declared selection that no record in the pair uses fails the gate", () => {
  const baseline = (id) => ({
    id, node_type: "baseline", source_id: "src", lifecycle_status: "active",
    metadata: { catalog_id: "nist-800-53b", item_id: id.split(":")[1], title: id, description: "d".repeat(20) },
  });
  const rowFor = (edges) => {
    const accumulator = createRecordMatrixAccumulator();
    accumulator.addNode(baseline("nist-800-53b:HIGH"));
    accumulator.addNode({ id: "nist-800-53:AC-1", node_type: "control", source_id: "src", metadata: { catalog_id: "nist-800-53", item_id: "AC-1" } });
    for (const edge of edges) accumulator.addEdge({ publication_status: "published", relationship_class: "applicability", ...edge });
    return accumulator.finish().rows.find((entry) => entry.pair === "nist-800-53b:baseline");
  };
  const unused = rowFor([]);
  assert.ok(unused.issues.includes("SELECTION_SPEC_UNUSED"));
  assert.equal(unused.acceptance, "BLOCKED");
  const used = rowFor([{ source_node_id: "nist-800-53b:HIGH", target_node_id: "nist-800-53:AC-1", relationship_type: "selects" }]);
  assert.equal(used.selection_records, 1);
  assert.ok(!used.issues.includes("SELECTION_SPEC_UNUSED"));
});

test("selection specs name a heading and note in source-native words", () => {
  for (const pair of registeredRecordPairs()) {
    for (const entry of pair.contract.selections) {
      assert.ok(entry.relationship_type && entry.heading && entry.note, pair.key);
      assert.ok(!/_/.test(entry.heading), `${pair.key} heading must be plain language`);
    }
  }
});

test("the corpus matrix covers every registered pair with a real record and no undeclared types", () => {
  const { rows, unsupported, summary } = loadRecordAcceptanceMatrix();
  assert.equal(summary.pairs, registeredRecordPairs().length);
  assert.deepEqual(unsupported, {}, "The corpus holds a record type with no presentation contract");
  const blocked = rows.filter((row) => row.acceptance === "BLOCKED" || row.acceptance === "UNREVIEWED");
  assert.deepEqual(blocked.map((row) => `${row.pair}: ${row.issues.join(" | ")}`), []);
  for (const row of rows) {
    assert.ok(row.representative_id, `${row.pair} has no representative record`);
    assert.ok(row.publisher, `${row.pair} has no resolvable publisher`);
  }
});

test("retirement follows the recorded dispositions and every retired pair has a destination", () => {
  for (const pair of registeredRecordPairs()) {
    const entry = dispositionFor(pair.catalogId, pair.recordType);
    const retired = entry.disposition !== RECORD_DISPOSITIONS.KEEP && entry.disposition !== RECORD_DISPOSITIONS.REWORK;
    assert.equal(isRetiredRecordPair(pair.catalogId, pair.recordType), retired, pair.key);
    const target = recordRetirement({ catalogId: pair.catalogId, recordType: pair.recordType, id: `${pair.catalogId}:X`, sourceId: "s", title: "T" });
    assert.equal(Boolean(target), retired, `${pair.key}: ${retired ? "a retired pair needs a destination" : "a public pair must not redirect"}`);
    assert.equal(RETIRED_RECORD_TYPES.has(pair.recordType) && !retired, false, `${pair.key} is public but its type is retired elsewhere`);
  }
  assert.ok(RETIRED_RECORD_TYPES.size > 0);
});

test("retired destinations point at the right place", () => {
  const args = { id: "cmmc-2:CATALOG", catalogId: "cmmc-2", sourceId: "dod-cmmc-rule", title: "Appgate" };
  assert.deepEqual({ ...recordRetirement({ ...args, recordType: "catalog" }) }, { view: "catalog-detail", label: "the publication page", patch: { catalog: "cmmc-2" } });
  assert.equal(recordRetirement({ ...args, catalogId: "atlas-organizing-spine", recordType: "trunk" }).view, "atlas-map");
  assert.deepEqual({ ...recordRetirement({ ...args, catalogId: "atlas-authority-spine", recordType: "statute" }).patch }, { source: "dod-cmmc-rule" });
  assert.deepEqual({ ...recordRetirement({ ...args, catalogId: "nist-zt", recordType: "zt_collaborator" }).patch }, { query: "Appgate" });
  assert.equal(recordRetirement({ ...args, catalogId: "nist-800-53", recordType: "control" }), null);
});

test("every retired node in the corpus has a destination that exists, and is out of Library search", () => {
  const nodes = readGeneratedCollection(".", "nodes").nodes;
  const sourceIds = new Set(readGeneratedCollection(".", "sources").sources.map((source) => source.id));
  const problems = [];
  let retiredNodes = 0;
  for (const node of nodes) {
    const catalogId = node.metadata?.catalog_id || "";
    const type = node.node_type;
    let target;
    try {
      target = recordRetirement({ catalogId: PRESENTATION_SCOPE[type] || catalogId, recordType: type, id: node.id, sourceId: node.source_id || "", title: node.metadata?.title || "" });
    } catch { continue; }
    if (!target) continue;
    retiredNodes += 1;
    if (target.view === "sources" && !sourceIds.has(target.patch.source)) problems.push(`${node.id}: source ${target.patch.source} missing`);
    if (target.view === "search" && !String(target.patch.query || "").trim()) problems.push(`${node.id}: no title to search`);
    if (target.view === "catalog-detail" && !target.patch.catalog) problems.push(`${node.id}: no catalog`);
  }
  assert.ok(retiredNodes > 0);
  assert.deepEqual(problems.slice(0, 5), []);

  const documents = JSON.parse(readFileSync("data/generated/library-search.json", "utf8")).library_search.documents;
  const leaked = documents.filter((document) => RETIRED_RECORD_TYPES.has(document.object_type)).map((document) => document.id);
  assert.deepEqual(leaked.slice(0, 5), [], "retired record types must not appear in Library search");
  const nodeTypes = new Set(nodes.map((node) => node.node_type));
  for (const type of RETIRED_RECORD_TYPES) assert.ok(nodeTypes.has(type), `${type} nodes must stay in the graph`);
});
