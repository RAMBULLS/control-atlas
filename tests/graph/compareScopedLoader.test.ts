import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildComparisonArtifacts } from "../../scripts/lib/compare-artifacts.mjs";
import { createFederalGraphRuntime, aggregateRelationshipRows } from "../../src/app/runtime.mjs";
import { comparisonPairKey, comparisonScopeAllowed } from "../../src/shared/compare-scope.mjs";
import { clearRuntimeArtifactCache, loadComparePhase, loadRuntimeDatasetStaged, mapBounded, runtimeArtifactPlan, type RuntimeBundle } from "../../src/ui/lib/runtimeLoader";
import { normalizeViewState } from "../../src/ui/lib/viewState";
import { parseHashLocation } from "../../src/ui/lib/hashRoutes";
import { buildCompareExportData, CROSSWALK_COLUMNS } from "../../src/ui/lib/compareExport";
import { buildBaselineExportData, compareExportToCsv, filterBaselineRows, type BaselineResultRow } from "../../src/ui/lib/compareExport";

const source = { id: "nist-mapping", name: "NIST mapping", display_name: "NIST mapping", version: "2025", owner: "NIST", provenance_class: "federal_published" };
const nodes = [
  { id: "nist-zt:COMPONENT", node_type: "zt_reference_component", label: "Policy Engine", source_id: source.id,
    metadata: { catalog_id: "nist-zt", item_id: "COMPONENT", title: "Policy Engine", source_fragments: [{ text: "DO NOT SEND THIS WHOLE CHAPTER" }] } },
  { id: "csf-2:PR.AA-01", node_type: "requirement", label: "Identity outcome", source_id: source.id,
    metadata: { catalog_id: "csf-2", item_id: "PR.AA-01", title: "Identity outcome" } },
];
const edge = {
  id: "edge:component-support", source_node_id: nodes[0].id, target_node_id: nodes[1].id,
  relationship_type: "supports", relationship_class: "correlation", publication_status: "published",
  confidence: "direct", provenance_class: "federal_published", rationale: "Publisher explanation.",
  raw_relationship_type: "Supports (integral to) PR.AA-01", evidence_ids: ["evidence:component-support"],
  publisher_assertions: [{ mapping_id: "row-1", locator: "Workbook!C2", relationship: "Supports (integral to) PR.AA-01", property: "integral to" }],
  source_refs: [{ source_id: source.id, locator: "Workbook!C2" }],
};
const graph = { sources: [source], nodes, edges: [edge], evidence: [{ id: "evidence:component-support", source_id: source.id, locator: "Workbook!C2", source_version: "2025" }] };
const projection = buildComparisonArtifacts(graph);
const catalogs = [{ id: "csf-2", name: "CSF 2.0" }, { id: "nist-zt", name: "NIST Zero Trust" }];
function bundle(): RuntimeBundle {
  return { runtime: createFederalGraphRuntime({ sources: [source], nodes: [], edges: [], evidence: [], catalogs }),
    templateRegistry: {}, catalogSummaries: catalogs, comparisonPairs: projection.manifest,
    comparisonItems: projection.itemManifest, graphReady: false, routeReady: true, librarySearchReady: false };
}
const state = (patch = {}) => normalizeViewState("matrix", {
  crosswalk: "relationships", source: "csf-2", target: "nist-zt", compareRun: "true", intent: "implementation", ...patch,
}) as Extract<ReturnType<typeof normalizeViewState>, { view: "matrix" }>;
const load = async (path: string) => JSON.parse(projection.files.get(path)!);

test("baseline selections load complete same-catalog sets with both citations and safe filtered exports", async () => {
  const baselineNodes = ["a", "b"].map((id) => ({ id, node_type: "baseline", source_id: source.id, metadata: { catalog_id: "baselines", item_id: id, title: id } }));
  const controls = Array.from({ length: 31 }, (_, i) => ({ id: `controls:${i}`, node_type: "control", source_id: source.id,
    metadata: { catalog_id: "controls", item_id: `C-${i}`, title: i === 0 ? " =unsafe" : `Control ${i}` } }));
  const selections = baselineNodes.flatMap((baseline) => controls.filter((_, i) => baseline.id === "a" ? i < 30 : i > 0).map((control) => ({
    ...edge, id: `edge:${baseline.id}-${control.id}`, source_node_id: baseline.id, target_node_id: control.id,
    relationship_type: "selects", relationship_class: "applicability", evidence_ids: [`evidence:${baseline.id}-${control.id}`],
  })));
  const projected = buildComparisonArtifacts({ sources: [source], nodes: [...baselineNodes, ...controls], edges: selections,
    evidence: selections.map((selection) => ({ id: selection.evidence_ids[0], source_id: source.id, locator: selection.id })) }, 4096);
  const baselineBundle = { ...bundle(), comparisonBaselines: projected.baselineManifest };
  const transport = async (path: string) => JSON.parse(projected.files.get(path)!);
  const loaded = await loadComparePhase(state({ intent: "baselines", source: "a", target: "b" }), baselineBundle, undefined, transport);
  assert.equal(loaded.comparisonStatus, "ready");
  assert.equal(loaded.graphReady, false);
  const comparison = loaded.runtime.buildBaselineComparison({ baseline_a: "a", baseline_b: "b" });
  assert.equal(comparison.shared.length, 29);
  assert.equal(comparison.only_a.length, 1); assert.equal(comparison.only_b.length, 1);
  assert.equal(comparison.shared[0].source_refs.length, 2);
  const reverse = loaded.runtime.buildBaselineComparison({ baseline_a: "b", baseline_b: "a" });
  assert.deepEqual(reverse.only_a, comparison.only_b);
  assert.deepEqual(reverse.only_b, comparison.only_a);
  const same = await loadComparePhase(state({ intent: "baselines", source: "a", target: "a" }), baselineBundle, undefined, transport);
  assert.equal(same.runtime.buildBaselineComparison({ baseline_a: "a", baseline_b: "a" }).shared.length, 30);
  const rows: BaselineResultRow[] = (["shared", "only_a", "only_b"] as const).flatMap((group) => comparison[group].map((entry: any) => ({ ...entry, group })));
  const filtered = filterBaselineRows(rows, "shared", "Control");
  assert.equal(filtered.length, 29, "filters cover more than the visible page");
  const data = buildBaselineExportData({ rows: filtered, labelA: "Baseline A", labelB: "Baseline B",
    resolveSource: () => ({ ...source, catalog_browse_url: "https://example.gov/baselines" }) });
  assert.equal(data.crosswalk.length, 30);
  assert.match(data.crosswalk[1][8], /edge:a-/); assert.match(data.crosswalk[1][8], /edge:b-/);
  assert.match(compareExportToCsv(data), /https:\/\/example.gov\/baselines/);
  for (const prefix of ["=", "+", "-", "@", " \t="]) {
    const injection = buildBaselineExportData({ rows: [{ ...rows[0], control_node: { ...rows[0].control_node, metadata: { title: `${prefix}formula` } } }],
      labelA: "A", labelB: "B", resolveSource: () => source });
    assert.ok(compareExportToCsv(injection).includes(`"'${prefix}formula"`));
  }
  assert.deepEqual(filterBaselineRows(rows, "shared", "not a control"), []);
  const incomplete = await loadComparePhase(state({ intent: "baselines", source: "a", target: "b" }), baselineBundle, undefined, async (path) => {
    const value = await transport(path); if (value.edges) value.edges = []; return value;
  });
  assert.equal(incomplete.comparisonStatus, "error");
  const unsupported = await loadComparePhase(state({ intent: "baselines", source: "unknown", target: "b" }), baselineBundle, undefined, () => { throw Error("must not load"); });
  assert.equal(unsupported.comparisonStatus, "unsupported");
  const cancelled = new AbortController();
  await assert.rejects(loadComparePhase(state({ intent: "baselines", source: "a", target: "b" }), baselineBundle, cancelled.signal, async (path) => {
    const value = await transport(path); cancelled.abort(); return value;
  }), /cancelled/);
});

test("the owner's exact framework deep link is rejected before component mapping downloads", async () => {
  const request = parseHashLocation("/compare/relationships", "?source=csf-2&target=nist-zt&intent=frameworks&compareRun=true");
  assert.equal(request.view, "matrix");
  const loaded: string[] = [];
  const result = await loadComparePhase(request as ReturnType<typeof state>, bundle(), undefined, async (path) => { loaded.push(path); return load(path); });
  assert.equal(result.comparisonStatus, "scope-mismatch");
  assert.deepEqual(loaded, []);
  assert.equal(runtimeArtifactPlan(request).fullGraph, false);
  assert.equal(runtimeArtifactPlan(request).librarySearch, false);
});

test("the implementation handoff loads only that pair, retaining complete source evidence", async () => {
  const loaded: string[] = [];
  const result = await loadComparePhase(state(), bundle(), undefined, async (path) => { loaded.push(path); return load(path); });
  assert.equal(result.comparisonStatus, "ready");
  assert.equal(result.graphReady, false, "scoped readiness is not full-graph readiness");
  assert.ok(loaded.every((path) => path.startsWith("compare-data/")));
  const rows = result.runtime.buildRelationshipRows({ source_catalog: "csf-2", target_catalog: "nist-zt", comparisons_only: true }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].relationship_type, "supported_by");
  assert.equal(rows[0].published_relationship_type, "supports");
  assert.equal(rows[0].published_source_id, nodes[0].id);
  assert.equal(rows[0].published_target_id, nodes[1].id);
  assert.equal(rows[0].source_refs[0].locator, "Workbook!C2");
  assert.equal(rows[0].publisher_assertions[0].property, "integral to");
  const exported = buildCompareExportData({ rows: aggregateRelationshipRows(rows), sourceCatalog: catalogs[0], targetCatalog: catalogs[1],
    resolveSource: () => source, buildLabel: "test", generatedAt: "2026-01-01" });
  assert.equal(exported.crosswalk[1][CROSSWALK_COLUMNS.indexOf("Published Source ID")], nodes[0].id);
  assert.equal(exported.crosswalk[1][CROSSWALK_COLUMNS.indexOf("Relationship")], "supported_by");
  assert.match(exported.crosswalk[1][CROSSWALK_COLUMNS.indexOf("Publisher Relationship Text")], /integral to/);
});

test("an unknown or same-catalog pair never starts a comparison download", async () => {
  for (const patch of [{ target: "unknown" }, { target: "csf-2" }]) {
    const result = await loadComparePhase(state(patch), bundle(), undefined, async () => { throw Error("must not fetch"); });
    assert.equal(result.comparisonStatus, "unsupported");
  }
});

test("failed or incomplete mapping data is an error, never a zero-result success; retry recovers", async () => {
  let fail = true;
  const transport = async (path: string) => { if (fail) throw Error("network failure"); return load(path); };
  const broken = await loadComparePhase(state(), bundle(), undefined, transport);
  assert.equal(broken.comparisonStatus, "error");
  fail = false;
  assert.equal((await loadComparePhase(state(), bundle(), undefined, transport)).comparisonStatus, "ready");
  const incomplete = await loadComparePhase(state(), bundle(), undefined, async (path) => {
    const value = await load(path); if (value.edges) value.edges = []; return value;
  });
  assert.equal(incomplete.comparisonStatus, "error");
});

test("specific-item targets resolve from the item index without a graph download", async () => {
  const loaded: string[] = [];
  const result = await loadComparePhase(state({ intent: "item-mapping", items: "PR.AA-01", target: "", compareRun: "" }), bundle(), undefined, async (path) => { loaded.push(path); return load(path); });
  assert.equal(result.comparisonStatus, "idle");
  assert.equal(loaded.length, 1);
  assert.deepEqual(result.comparisonItemTargets?.[nodes[1].id], ["nist-zt"]);
});

test("transport concurrency is bounded and original ordering is retained", async () => {
  let active = 0, max = 0;
  const out = await mapBounded(Array.from({ length: 17 }, (_, i) => i), async (i) => {
    active++; max = Math.max(active, max); await new Promise((resolve) => setTimeout(resolve, 1)); active--; return i;
  });
  assert.equal(max, 4);
  assert.deepEqual(out, Array.from({ length: 17 }, (_, i) => i));
});

test("reverse result filters use the displayed inverse while preserving the native assertion", () => {
  const runtime = createFederalGraphRuntime(graph);
  const forward = runtime.buildRelationshipRows({ source_catalog: "nist-zt", target_catalog: "csf-2", relationship_type: "supports" }).rows;
  const reverse = runtime.buildRelationshipRows({ source_catalog: "csf-2", target_catalog: "nist-zt", relationship_type: "supported_by" }).rows;
  assert.equal(forward.length, 1); assert.equal(reverse.length, 1);
  assert.equal(forward[0].edge_id, reverse[0].edge_id);
  assert.equal(forward[0].published_source_id, reverse[0].published_source_id);
  assert.deepEqual(forward[0].source_refs, reverse[0].source_refs);
  assert.equal(comparisonPairKey("csf-2", "nist-zt"), comparisonPairKey("nist-zt", "csf-2"));
  assert.equal(comparisonScopeAllowed("implementation", "frameworks"), false);
  assert.equal(comparisonScopeAllowed("implementation", "item-mapping"), true);
});

test("Compare result admission excludes authority, structural, candidate and uncited rows", () => {
  const runtime = createFederalGraphRuntime({ ...graph, edges: [edge,
    { ...edge, id: "authority", relationship_type: "issued_under" },
    { ...edge, id: "structure", relationship_type: "contains", relationship_class: "structural" },
    { ...edge, id: "candidate", publication_status: "candidate" },
    { ...edge, id: "uncited", source_refs: [] },
  ] });
  const rows = runtime.buildRelationshipRows({ source_catalog: "csf-2", target_catalog: "nist-zt", comparisons_only: true }).rows;
  assert.deepEqual(rows.map((row: any) => row.edge_id), [edge.id]);
});

test("actual corpus: the exact deep link loads metadata only; admitted NIST pair is bounded", async () => {
  const catalog = JSON.parse(readFileSync("data/generated/catalog-bootstrap.json", "utf8"));
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  clearRuntimeArtifactCache();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const path = String(input).split("?")[0].replace(/^\.\//, ""); requested.push(path);
    if (path.endsWith(".gz")) return new Response("", { status: 404 });
    return new Response(readFileSync(path), { status: 200 });
  }) as typeof fetch;
  try {
    let ready: RuntimeBundle | undefined;
    await loadRuntimeDatasetStaged({ state: state({ intent: "frameworks" }), onSearchReady: () => {}, onFullReady: (next) => { ready = next; }, onError: (error) => { throw error; } });
    assert.equal(ready?.comparisonStatus, "scope-mismatch");
    assert.ok(requested.every((path) => /\/(catalog-bootstrap|sources)\.json(?:\.gz)?$/.test(path)), requested.join("\n"));
    requested.length = 0;
    await loadRuntimeDatasetStaged({ state: state(), onSearchReady: () => {}, onFullReady: (next) => { ready = next; }, onError: (error) => { throw error; } });
    assert.equal(ready?.comparisonStatus, "ready");
    assert.ok(requested.every((path) => path.includes("/compare-data/")));
    const pair = catalog.catalog_bootstrap.comparison_pairs["csf-2|nist-zt"];
    const rows = ready!.runtime.buildRelationshipRows({ source_catalog: "csf-2", target_catalog: "nist-zt", comparisons_only: true }).rows;
    assert.equal(rows.length, pair.edge_count);
    assert.ok(rows.every((row: any) => row.source_refs.length));
    const header = JSON.parse(readFileSync(`data/generated/${pair.path}`, "utf8"));
    assert.ok(header.chunks.every((chunk: any) => chunk.bytes <= 512 * 1024));
  } finally { globalThis.fetch = originalFetch; clearRuntimeArtifactCache(); }
});


test("a malformed pair cannot promote an unregistered mapping source", async () => {
  const result = await loadComparePhase(state(), bundle(), undefined, async (path) => {
    const value = await load(path);
    if (value.edges) value.edges[0].source_refs = [{ source_id: "not-in-the-register" }];
    return value;
  });
  assert.equal(result.comparisonStatus, "error");
});


test("complete content inventories preserve literal fields, missing text, sources and all unmatched records", async () => {
  const { buildContentRows, buildMappingInventoryRows, filterContentRows } = await import("../../src/shared/content-comparison.mjs");
  const { buildContentExportData } = await import("../../src/ui/lib/compareExport");
  const records = (catalog: string, start: number) => Array.from({ length: 31 }, (_, offset) => {
    const i = start + offset;
    return { id: `${catalog}:${i}`, node_type: "requirement", source_id: source.id, metadata: {
      catalog_id: catalog, item_id: String(i), title: i === 4 ? " =unsafe" : `Requirement ${i}`,
      description: catalog === "nist-800-171" && i === 1 ? "" : `Exact statement ${i}${catalog === "nist-800-171" && i === 2 ? " " : ""}`,
      source_locator: `Official table row ${i}`,
    } };
  });
  const a = records("nist-800-171-rev2", 0), b = records("nist-800-171", 1);
  const mapping = { ...edge, id: "edge:content", source_node_id: a[0].id, target_node_id: b[30].id, evidence_ids: ["evidence:content"] };
  const projected = buildComparisonArtifacts({ sources: [source], nodes: [...a, ...b], edges: [mapping],
    evidence: [{ id: "evidence:content", source_id: source.id, locator: "Crosswalk row" }] }, 4096, true);
  const contentBundle = { ...bundle(), comparisonContent: projected.contentManifest, comparisonPairs: projected.manifest };
  const transport = async (path: string) => JSON.parse(projected.files.get(path)!);
  const request = state({ intent: "content", source: "nist-800-171-rev2", target: "nist-800-171" });
  const loaded = await loadComparePhase(request, contentBundle, undefined, transport);
  assert.equal(loaded.comparisonStatus, "ready");
  assert.equal(loaded.runtime.getNodes().length, 62);
  const rows = buildContentRows(loaded.runtime.getNodes({ catalog_id: request.source }), loaded.runtime.getNodes({ catalog_id: request.target }));
  assert.equal(rows.filter((row: any) => row.group === "only_a").length, 1);
  assert.equal(rows.filter((row: any) => row.group === "only_b").length, 1);
  assert.equal(rows.filter((row: any) => row.group === "unavailable").length, 1, "blank Rev. 3 text is unavailable, not withdrawn");
  assert.equal(rows.filter((row: any) => row.group === "different").length, 1, "whitespace is preserved");
  assert.equal(rows.filter((row: any) => row.group === "shared").length, 28);
  assert.equal(buildContentRows(a, a).length, 31);
  assert.ok(buildContentRows(a, a).every((row: any) => row.group === "shared"));
  assert.equal(buildContentRows(a, b, a[0].id, b[30].id)[0].alignment, "Explicit record selection");
  assert.equal(buildContentRows(a, [...b, { ...b[0], id: "another-b" }]).filter((row: any) => row.group === "unavailable").length, 3, "repeated identifiers are never overwritten or aligned silently");
  assert.equal(buildContentRows(b, a).filter((row: any) => row.group === "only_a")[0].a.id, b[30].id);
  const mapped = buildMappingInventoryRows(a, b, loaded.comparisonInventoryMappings);
  assert.equal(mapped.filter((row: any) => row.group === "mapped").length, 1);
  assert.equal(mapped.filter((row: any) => row.group === "only_a").length, 30);
  assert.equal(mapped.filter((row: any) => row.group === "only_b").length, 30);
  assert.equal(mapped.find((row: any) => row.group === "mapped").source_refs[0].locator, "Crosswalk row");
  const shared = filterContentRows(rows, "shared", "");
  const csv = compareExportToCsv(buildContentExportData({ rows: shared, labelA: "Rev. 2", labelB: "Rev. 3", countA: a.length, countB: b.length,
    basis: "Literal fields", resolveSource: () => ({ ...source, catalog_browse_url: "https://example.gov/publication" }) }));
  assert.equal(csv.split("\r\n").length, 29, "export includes every filtered row beyond one page");
  assert.ok(csv.includes('"\' =unsafe"'));
  // Read complete quoted CSV cells; a substring anywhere in the file cannot
  // prove that every record retains both exact source URLs.
  const csvRows = csv.slice(1).split("\r\n").map((line) =>
    Array.from(line.matchAll(/"((?:[^"]|"")*)"(?=,|$)/g), ([, cell]) => cell.replaceAll('""', '"')));
  const [header, ...exportedRows] = csvRows;
  const sourceColumns = ["A official URL", "B official URL"].map((name) => header.indexOf(name));
  assert.ok(sourceColumns.every((index) => index >= 0));
  assert.equal(exportedRows.length, shared.length);
  for (const row of exportedRows) {
    assert.equal(row.length, header.length);
    for (const index of sourceColumns) assert.equal(row[index], "https://example.gov/publication");
  }
  assert.ok(csv.includes("Official table row"));
  assert.deepEqual(filterContentRows(rows, "", "no-such-record"), []);
  const unsupported = await loadComparePhase({ ...request, target: "unavailable-revision" }, contentBundle, undefined, async () => { throw Error("must not load"); });
  assert.equal(unsupported.comparisonStatus, "unsupported");
  for (const corruption of ["missing", "duplicate", "source", "catalog"]) {
    const broken = await loadComparePhase(request, contentBundle, undefined, async (path) => {
      const payload = await transport(path);
      if (payload.records?.length > 1) {
        if (corruption === "missing") payload.records.pop();
        if (corruption === "duplicate") payload.records[1] = payload.records[0];
        if (corruption === "source") payload.records[0].source_id = "unknown";
        if (corruption === "catalog") payload.records[0].metadata.catalog_id = "wrong";
      }
      return payload;
    });
    assert.equal(broken.comparisonStatus, "error", corruption);
  }
  const cancelled = new AbortController();
  await assert.rejects(loadComparePhase(request, contentBundle, cancelled.signal, async (path) => {
    const payload = await transport(path); cancelled.abort(); return payload;
  }), /cancelled/);
  const brokenMapping = await loadComparePhase(request, contentBundle, undefined, async (path) => {
    const payload = await transport(path); if (payload.edges) payload.edges = []; return payload;
  });
  assert.equal(brokenMapping.comparisonStatus, "error", "missing mapping data cannot become unmatched inventory");
});

test("generated content inventory reconciles exactly to all public source records", async () => {
  const { readGeneratedCollection } = await import("../../scripts/lib/generated-graph-artifacts.mjs");
  const { isComparisonRecord, projectComparisonRecord } = await import("../../src/shared/content-comparison.mjs");
  const read = (path: string) => JSON.parse(readFileSync(`data/generated/${path}`, "utf8"));
  const manifest = read("catalog-bootstrap.json").catalog_bootstrap.comparison_content;
  const graphRecords = readGeneratedCollection(".", "nodes").nodes.filter(isComparisonRecord);
  const expected = new Map(graphRecords.map((node: any) => [node.id, projectComparisonRecord(node)]));
  const actual = new Map();
  for (const [catalog, entry] of Object.entries(manifest) as Array<[string, any]>) {
    const header = read(entry.path);
    const emitted = header.chunks.flatMap((part: any) => {
      assert.ok(part.bytes <= 512 * 1024);
      const chunk = read(part.path);
      assert.equal(chunk.catalog, catalog); assert.equal(chunk.records.length, part.record_count);
      return chunk.records;
    });
    assert.equal(emitted.length, entry.record_count);
    for (const record of emitted) {
      assert.equal(actual.has(record.id), false);
      assert.equal(record.metadata.catalog_id, catalog);
      assert.deepEqual(record, expected.get(record.id));
      actual.set(record.id, record);
    }
  }
  assert.equal(actual.size, expected.size);
  assert.ok(manifest["nist-800-171"] && manifest["nist-800-171-rev2"]);
  assert.equal(manifest["nist-800-53-rev4"], undefined);
  assert.equal(manifest["csf-1.1"], undefined);
});


test("content comparison excludes derived presentation fields and preserves native mapping assertions", async () => {
  const { comparisonFields, buildMappingInventoryRows } = await import("../../src/shared/content-comparison.mjs");
  assert.equal(comparisonFields({ node_type: "mobile_threat", metadata: { catalog_id: "nist-mobile-threats" } }).includes("publisher_field_availability"), false);
  assert.equal(comparisonFields(nodes[0]).includes("mapping_count"), false);
  const mapping = { edge_id: "mapping", from_id: nodes[0].id, to_id: nodes[1].id, relationship_type: "supported_by",
    published_source_id: nodes[1].id, published_target_id: nodes[0].id, published_relationship_type: "supports",
    raw_relationship_type: "Supports (integral to)", publisher_assertions: [{ relationship: "Supports (integral to)", locator: "C2" }], warning: "Qualified mapping" };
  assert.deepEqual(buildMappingInventoryRows([nodes[0]], [nodes[1]], [mapping])[0].mapping, mapping);
});

test("FedRAMP Compare chunks, literal differences and CSV retain every bullet and note exactly", async () => {
  const { buildContentRows, compareRecordContent } = await import("../../src/shared/content-comparison.mjs");
  const { buildContentExportData } = await import("../../src/ui/lib/compareExport");
  const read = (path: string) => JSON.parse(readFileSync(`data/generated/${path}`, "utf8"));
  const catalog = JSON.parse(readFileSync("data/fedramp-2026-catalog.json", "utf8"));
  const entry = read("catalog-bootstrap.json").catalog_bootstrap.comparison_content["fedramp-2026"];
  const records = read(entry.path).chunks.flatMap((chunk: any) => read(chunk.path).records);
  const byId = new Map<string, any>(records.map((record: any) => [record.metadata.item_id, record]));
  for (const record of catalog.records.filter((item: any) => item.type === "rule")) {
    const compared = byId.get(record.id);
    assert.ok(compared, record.id);
    assert.equal(compared.metadata.discussion ?? null, record.discussion || null, record.id);
    assert.deepEqual(compared.metadata.following_information_bullets, record.metadata?.following_information_bullets, record.id);
    assert.equal(compared.metadata.source_locator, record.source.locator, record.id);
  }
  const selected = ["VER-EVA-EPA", "IEC-CSO-EFI"].map((id) => byId.get(id));
  const rows = buildContentRows(selected, selected);
  assert.ok(rows.every((row: any) => row.group === "shared"));
  const csv = compareExportToCsv(buildContentExportData({
    rows, labelA: "FedRAMP 2026", labelB: "FedRAMP 2026", countA: records.length, countB: records.length,
    basis: "Literal publisher fields", resolveSource: () => ({
      id: selected[0].source_id, display_name: "FedRAMP 2026", version: catalog.source_version,
      catalog_browse_url: "https://www.fedramp.gov/2026/",
    }),
  }));
  const [header, ...exported] = csv.slice(1).split("\r\n").map((line) =>
    Array.from(line.matchAll(/"((?:[^"]|"")*)"(?=,|$)/g), ([, cell]) => cell.replaceAll('""', '"')));
  assert.equal(exported.length, selected.length);
  for (const row of exported) {
    assert.equal(row.length, header.length);
    for (const side of ["A", "B"]) {
      const id = row[header.indexOf(`${side} ID`)];
      const expected = catalog.records.find((record: any) => record.id === id);
      const cell = JSON.parse(row[header.indexOf(`${side} compared fields and locators`)]);
      assert.deepEqual(cell.fields.following_information_bullets, expected.metadata.following_information_bullets, id);
      assert.equal(cell.fields.discussion, expected.discussion || null, id);
      assert.equal(cell.locator, expected.source.locator, id);
      assert.deepEqual(cell.source_refs, byId.get(id).source_refs || [], id);
    }
  }
  const changed = structuredClone(selected[0]);
  changed.metadata.following_information_bullets[0] += " ";
  assert.deepEqual(compareRecordContent(selected[0], changed).changed, ["following_information_bullets"]);
  const reordered = structuredClone(selected[0]);
  reordered.metadata.following_information_bullets.reverse();
  assert.deepEqual(compareRecordContent(selected[0], reordered).changed, ["following_information_bullets"]);
  const noteChanged = structuredClone(selected[1]);
  noteChanged.metadata.discussion += " ";
  assert.deepEqual(compareRecordContent(selected[1], noteChanged).changed, ["discussion"]);
  const sparse = byId.get("AFC-CSO-ACK");
  assert.equal(Object.hasOwn(sparse.metadata, "following_information_bullets"), false);
  assert.equal(compareRecordContent(sparse, sparse).group, "shared");
});
