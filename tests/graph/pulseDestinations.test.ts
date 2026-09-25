import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import geometry from "../../data/curated/atlas-territory-geography.json";
import treeSpine from "../../data/curated/tree-spine.json";
import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";
import { RELATIONSHIP_SET_ENDPOINTS } from "../../scripts/lib/catalog-refresh-profiles.mjs";
import { buildPulseArtifact } from "../../scripts/build-pulse-artifact.mjs";
import { buildTerritoryIndex } from "../../src/ui/lib/atlasTerritoryIndex";
import { normalizeJourneyId } from "../../src/ui/lib/atlasJourneyIds";
import { canonicalizeHashLocation } from "../../src/ui/lib/routeIdentity";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const registry = read("data/source-registry.json");
const catalogs = new Set(read("data/generated/catalog-bootstrap.json").catalog_bootstrap.catalogs.map((c: any) => c.id));
const templates = new Set(read("data/template-registry.json").templates.map((t: any) => t.name));
const { index: territory } = buildTerritoryIndex({
  generatedAt: "t", datasetId: "0123456789ab", geometryVersion: geometry.version,
  catalogIds: [...Object.keys(treeSpine.catalogLimbs), ...treeSpine.syntheticCatalogs.map((c) => c.catalog_id)],
  identities: read("data/generated/publication-identity-index.json").identities, taxonomy: read("data/generated/taxonomy-registry.json"),
  sources: registry.sources, registryPublications: registry.publications,
  nodes: readGeneratedCollection(process.cwd(), "nodes").nodes, edges: readGeneratedCollection(process.cwd(), "edges").edges,
});
const routeKeys = new Set(territory.routes.map((r) => r.key));
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pulse = buildPulseArtifact();

test("the Pulse artifact is rebuilt byte for byte from the same accepted inputs", () => {
  assert.equal(JSON.stringify(buildPulseArtifact()), JSON.stringify(pulse));
  assert.match(pulse.dataset.dataset_id, /^[a-f0-9]{12}$/);
  for (const path of ["data/source-change-log.json", "data/source-baselines.json", "data/product-release-log.json"]) {
    assert.match(pulse.inputs[path], /^sha256:[a-f0-9]{64}$/, `${path} is recorded as an input`);
  }
});

test("every Pulse destination is a canonical route to something that exists", () => {
  assert.ok(pulse.events.length > 0, "the accepted corpus and release log carry real events");
  for (const event of pulse.events) {
    const { href, view, patch } = event.destination as { href: string; view: string; patch: Record<string, string> };
    const canonical = canonicalizeHashLocation(href);
    assert.equal(canonical.requiresReplace, false, `${event.id}: ${href} is not canonical`);
    assert.equal(canonical.recoveryMessage, "", `${event.id}: ${href} drops settings`);
    if (view === "catalog-detail") assert.ok(catalogs.has(patch.catalog), `${event.id}: publication ${patch.catalog} does not exist`);
    if (view === "atlas-map" && patch.atlasJourney) assert.equal(normalizeJourneyId(patch.atlasJourney), patch.atlasJourney, `${event.id}: journey`);
    if (view === "templates" && patch.templateType) assert.ok(templates.has(patch.templateType), `${event.id}: template ${patch.templateType}`);
    if (view === "matrix") assert.ok(routeKeys.has(pairKey(patch.source, patch.target)), `${event.id}: no published route joins ${patch.source} and ${patch.target}`);
  }
});

test("every recorded relationship set joins two publications through a published route, in its published direction", () => {
  for (const [path, [from, to]] of Object.entries(RELATIONSHIP_SET_ENDPOINTS)) {
    assert.ok(catalogs.has(from) && catalogs.has(to), `${path}: ${from} and ${to} are publications`);
    assert.ok(routeKeys.has(pairKey(from, to)), `${path}: a Compare destination for ${from} and ${to} would have no route`);
    // Sets that name their catalogs per relationship must publish from the declared source side
    // (the STIG/SRG set also carries SRG requirements; the ATT&CK set also carries ATT&CK for ICS).
    const sourceSide = new Set([from, ...(from === "disa-stig" ? ["disa-srg"] : []), ...(from === "mitre-attack" ? ["mitre-attack-ics"] : [])]);
    for (const r of read(path).relationships) if (r.source_catalog) assert.ok(sourceSide.has(r.source_catalog), `${path}: ${r.source_catalog} is not on the ${from} side`);
  }
});

test("real accepted evidence produces several event types, and quarantined sources are never events", () => {
  const types = new Set(pulse.events.map((e: any) => e.type));
  assert.ok(types.size >= 3, `expected several event types, got ${[...types]}`);
  const quarantined = new Set(pulse.quarantine.map((q: any) => q.refresh_source_id));
  for (const event of pulse.events) assert.ok(!quarantined.has(event.subject.id));
  for (const item of pulse.withheld) assert.ok(item.reason, "every withheld entry states why");
});
