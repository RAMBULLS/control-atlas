import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import treeSpine from "../../data/curated/tree-spine.json";
import geometry from "../../data/curated/atlas-territory-geography.json";
import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";
import { TERRITORY_GEOMETRY, landmarkPosition, territoryPolygon } from "../../src/ui/lib/atlasTerritoryGeography";
import { buildTerritoryIndex } from "../../src/ui/lib/atlasTerritoryIndex";
import { buildTerritoryModel } from "../../src/ui/lib/atlasTerritoryModel";
import {
  MAX_CONTEXT_TAGS, evaluateContext, normalizeContextIds, orderedSelection, toggleContext,
} from "../../src/ui/lib/atlasTerritoryContext";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const nodes = readGeneratedCollection(process.cwd(), "nodes").nodes;
const edges = readGeneratedCollection(process.cwd(), "edges").edges;
const catalogIds = [...Object.keys(treeSpine.catalogLimbs), ...treeSpine.syntheticCatalogs.map((c) => c.catalog_id)];
const { index } = buildTerritoryIndex({
  generatedAt: "t", datasetId: "0123456789ab", geometryVersion: geometry.version, catalogIds, nodes, edges,
  identities: read("data/generated/publication-identity-index.json").identities, sources: read("data/source-registry.json").sources, registryPublications: read("data/source-registry.json").publications,
  taxonomy: read("data/generated/taxonomy-registry.json"),
});
const ctx = index.context;
const STIG = "program.stig"; const WINDOWS = "product.microsoft-windows"; const SERVER = "asset.server";

// Independent count, straight from the records, using the Library's own rule.
const tagIds = (n: any) => new Set<string>((n.metadata?.taxonomy_tags || []).map((t: any) => (typeof t === "string" ? t : t.id)));
const directCount = (groups: string[][], catalog?: string) => nodes.filter((n: any) => (!catalog || n.metadata?.catalog_id === catalog)
  && catalogIds.includes(n.metadata?.catalog_id) && groups.every((g) => g.some((id) => tagIds(n).has(id)))).length;

test("only program, product and asset are offered, and only values that at least one record carries", () => {
  assert.deepEqual(ctx.dimensions.map((d) => d.label), ["Program", "Product", "Asset"]);
  assert.ok(ctx.terms.length > 0 && ctx.terms.every((t) => t.records > 0), "unavailable values are suppressed");
  for (const id of [STIG, WINDOWS, SERVER]) assert.ok(ctx.terms.some((t) => t.id === id), id);
  assert.ok(ctx.terms.every((t) => ["program", "product", "asset_class"].includes(t.dimension)));
});

test("STIG + Microsoft Windows + Server matches exactly the records that carry all three, counted from the records", () => {
  const r = evaluateContext(ctx, [STIG, WINDOWS, SERVER]);
  assert.equal(r.active, true);
  assert.equal(r.empty, false);
  assert.equal(r.total, directCount([[STIG], [WINDOWS], [SERVER]]));
  assert.ok(r.total > 0);
  for (const [catalog, m] of r.publications) assert.equal(m.records, directCount([[STIG], [WINDOWS], [SERVER]], catalog), catalog);
  assert.deepEqual([...r.publications.keys()], ["disa-stig"], "only DISA STIG holds records with all three");
});

test("a match is a record match, not a publication assignment: only some of the publication's records match", () => {
  const r = evaluateContext(ctx, [STIG, WINDOWS, SERVER]);
  const stigRecords = index.publications.find((p) => p.id === "disa-stig")!.records;
  assert.ok(r.publications.get("disa-stig")!.records < stigRecords, "not every record in the publication matches");
  assert.ok(index.publications.every((p) => !("tags" in p)), "publications carry no tag assignments in the index");
});

test("within one dimension choices widen (OR); across dimensions they narrow (AND)", () => {
  const windows = evaluateContext(ctx, [WINDOWS]).total;
  const windowsOrRhel = evaluateContext(ctx, [WINDOWS, "product.red-hat-enterprise-linux"]).total;
  assert.ok(windowsOrRhel > windows, "adding a second product widens");
  assert.equal(windowsOrRhel, directCount([[WINDOWS, "product.red-hat-enterprise-linux"]]));
  const windowsServer = evaluateContext(ctx, [WINDOWS, SERVER]).total;
  assert.ok(windowsServer <= windows, "adding another dimension narrows");
  assert.equal(windowsServer, directCount([[WINDOWS], [SERVER]]));
});

test("per-choice numbers come from the matching records", () => {
  const r = evaluateContext(ctx, [STIG, WINDOWS, SERVER]);
  const m = r.publications.get("disa-stig")!;
  assert.equal(m.byTag[STIG], m.records, "every matching record carries the program");
  assert.equal(m.byTag[WINDOWS], m.records);
  assert.equal(m.byTag[SERVER], m.records);
  const two = evaluateContext(ctx, [WINDOWS, "product.red-hat-enterprise-linux"]).publications.get("disa-stig")!;
  assert.ok(two.byTag[WINDOWS] > 0 && two.byTag[WINDOWS] <= two.records);
});

test("an impossible combination is an empty result, not an error and not a claim", () => {
  const zero = evaluateContext(ctx, ["program.cmmc", WINDOWS]);
  assert.equal(zero.empty, true);
  assert.equal(zero.active, true);
  assert.equal(zero.total, 0);
  assert.equal(zero.publications.size, 0);
  assert.equal(evaluateContext(ctx, []).active, false);
});

test("landmark and territory coordinates are identical before and after context filtering", () => {
  const model = buildTerritoryModel(index);
  const snapshot = () => JSON.stringify({
    landmarks: index.publications.map((p) => [p.id, landmarkPosition(TERRITORY_GEOMETRY, p.id), model.position(p.id)]),
    territories: model.areas.map((a) => [a.id, territoryPolygon(TERRITORY_GEOMETRY, a.id), a.name]),
  });
  const before = snapshot();
  for (const selection of [[STIG], [STIG, WINDOWS, SERVER], ["program.cmmc", WINDOWS], []]) {
    evaluateContext(ctx, selection);
    assert.equal(snapshot(), before, `coordinates changed for ${selection.join("+") || "no context"}`);
  }
  assert.equal(Object.keys(TERRITORY_GEOMETRY.assignments).length, 28);
});

test("URL values are bounded, de-duplicated and stripped of anything that is not a tag id", () => {
  assert.deepEqual(normalizeContextIds("program.stig,program.stig,<script>,product.microsoft-windows"), ["program.stig", "product.microsoft-windows"]);
  assert.deepEqual(normalizeContextIds("program.stig,product.unknown", new Set(ctx.terms.map((t) => t.id))), ["program.stig"]);
  const many = Array.from({ length: 30 }, (_, i) => `asset.item-${i}`);
  assert.equal(normalizeContextIds(many).length, MAX_CONTEXT_TAGS);
  assert.deepEqual(normalizeContextIds(undefined), []);
});

test("choices toggle on and off and read back in a stable order", () => {
  let sel: string[] = [];
  sel = toggleContext(sel, SERVER); sel = toggleContext(sel, STIG); sel = toggleContext(sel, WINDOWS);
  assert.deepEqual(orderedSelection(ctx, sel).map((t) => t.label), ["STIG", "Microsoft Windows", "Server"]);
  assert.deepEqual(toggleContext(sel, STIG).sort(), [SERVER, WINDOWS].sort());
});
