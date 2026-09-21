import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadRecordAcceptanceMatrix } from "../tools/record-acceptance-matrix.mjs";
import { RECORD_FACT_LABELS } from "../src/shared/record-fact-labels.mjs";
import {
  createRecordMatrixAccumulator,
  dispositionFor,
  RECORD_DISPOSITIONS,
  RECORD_TYPE_DISPOSITIONS,
  recordActionPolicy,
  recordShowsChildInventory,
  registeredRecordPairs,
  REVIEW_STATUS,
  TEMPLATE_HANDOFF_FRAMEWORKS,
  unlabeledPublishedFacts,
} from "../src/shared/record-acceptance.mjs";
import {
  CATALOG_RECORD_TYPES,
  NON_RECORD_NODE_TYPES,
  PAGE_ROLES,
  SUPPORTED_RECORD_TYPES,
} from "../src/shared/record-presentation.mjs";

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
