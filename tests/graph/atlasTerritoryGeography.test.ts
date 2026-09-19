import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import treeSpine from "../../data/curated/tree-spine.json";
import {
  TERRITORY_GEOMETRY, TERRITORY_GEOMETRY_VERSION, assignFreeSlot, landmarkPosition, pointInPolygon, territoryPolygon,
  validateTerritoryGeometry, type TerritoryGeometry,
} from "../../src/ui/lib/atlasTerritoryGeography";

const catalogTerritory: Record<string, string> = {
  ...(treeSpine.catalogLimbs as Record<string, string>),
  ...Object.fromEntries(treeSpine.syntheticCatalogs.map((c) => [c.catalog_id, c.limb])),
};
const territoryIds = treeSpine.limbs.map((l) => l.id);
const clone = (): { -readonly [K in keyof TerritoryGeometry]: TerritoryGeometry[K] } => JSON.parse(JSON.stringify(TERRITORY_GEOMETRY));
const positions = (g: TerritoryGeometry, catalogs = Object.keys(g.assignments)) =>
  Object.fromEntries(catalogs.sort().map((c) => [c, landmarkPosition(g, c)]));

// Changing any landmark coordinate is a deliberate geography revision: bump the version and this fingerprint together.
const POSITIONS_FINGERPRINT_TERRITORY_1 = "25beb0b82994630a04b9aef611028ba408aae9ce546ba6551dd4f201b271b6e9";
const fingerprint = (g: TerritoryGeometry) => createHash("sha256").update(JSON.stringify(positions(g))).digest("hex");

test("the geography is the reviewed version and satisfies every structural rule", () => {
  assert.equal(TERRITORY_GEOMETRY_VERSION, "territory-1");
  assert.deepEqual(validateTerritoryGeometry(TERRITORY_GEOMETRY, catalogTerritory, territoryIds), []);
});

test("every landmark coordinate matches the reviewed geography version", () => {
  assert.equal(fingerprint(TERRITORY_GEOMETRY), POSITIONS_FINGERPRINT_TERRITORY_1, "landmark coordinates changed without a geography version revision");
});

test("nine canonical territories form one landmass with shared borders", () => {
  assert.equal(TERRITORY_GEOMETRY.territories.length, 9);
  const problems = validateTerritoryGeometry(TERRITORY_GEOMETRY, catalogTerritory, territoryIds);
  assert.equal(problems.filter((p) => p.startsWith("border") || p.startsWith("coast")).length, 0);
});

test("landmark placement is by explicit slot id, not array position", () => {
  const before = positions(TERRITORY_GEOMETRY);
  const g = clone();
  const compliance = g.territories.find((t) => t.key === "compliance")!;
  compliance.slots = [{ id: "territory.compliance.slot.99", at: [600, 400] }, ...compliance.slots].reverse();
  assert.deepEqual(positions(g), before, "reordering or inserting slot definitions must not move an assigned landmark");
});

test("a new publication takes a free reserved slot and moves nothing that exists", () => {
  const g = clone();
  const before = positions(g);
  const slot = assignFreeSlot(g, "atlas:LIMB-COMPLIANCE");
  assert.ok(slot, "compliance must keep a free reserved slot");
  assert.equal(Object.values(g.assignments).includes(slot!), false);
  g.assignments = { ...g.assignments, "hypothetical-catalog": slot! };
  const after = positions(g, Object.keys(before));
  assert.deepEqual(after, before);
  assert.ok(pointInPolygon(landmarkPosition(g, "hypothetical-catalog")!, territoryPolygon(g, "atlas:LIMB-COMPLIANCE")));
});

test("inserting publications never reuses or shifts a slot; a full territory reports it instead of guessing", () => {
  const g = clone();
  const target = "atlas:LIMB-THREAT";
  let assignments: Record<string, string> = { ...g.assignments };
  const seen = new Set(Object.values(assignments));
  let added = 0;
  for (let slot = assignFreeSlot(g, target, assignments); slot; slot = assignFreeSlot(g, target, assignments)) {
    assert.equal(seen.has(slot), false, "a slot may be assigned once");
    seen.add(slot);
    assignments = { ...assignments, [`extra-${added}`]: slot };
    added += 1;
  }
  assert.ok(added >= 1, "the territory should have had at least one spare slot");
  assert.equal(assignFreeSlot(g, target, assignments), null, "no free slot means the geography must be revised");
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") { Object.values(value as object).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
test("landmark coordinates are a pure function of the reviewed geometry, with no view input", () => {
  const frozen = deepFreeze(clone());
  const a = positions(frozen);
  assert.deepEqual(positions(frozen), a);
  assert.deepEqual(a, positions(TERRITORY_GEOMETRY));
});

test("short display names are deliberate aliases, never truncations", () => {
  const p = TERRITORY_GEOMETRY.presentation;
  for (const [catalog, value] of Object.entries(p)) assert.equal(/…|\.\.\.$/.test(value.alias), false, catalog);
  assert.equal(p["nist-800-53"].alias, "SP 800-53 Rev. 5");
  assert.equal(p["csf-2"].alias, "CSF 2.0");
  assert.equal(p["mitre-attack"].alias, "ATT&CK Enterprise");
  assert.equal(p["disa-stig"].alias, "DISA STIG");
  assert.equal(p["nist-zt"].alias, "SP 800-207");
});

test("major landmarks are an explicit reviewed list, not derived from counts", () => {
  const major = Object.entries(TERRITORY_GEOMETRY.presentation).filter(([, v]) => v.major).map(([k]) => k).sort();
  assert.deepEqual(major, ["cmmc-2", "csf-2", "disa-stig", "fedramp-rev5", "fips-199", "mitre-attack", "nist-800-37", "nist-800-53", "nist-800-53a", "nist-zt"]);
});

test("the validator rejects the failure modes it exists to catch", () => {
  const unassigned = clone();
  delete (unassigned.assignments as Record<string, string>)["disa-stig"];
  assert.ok(validateTerritoryGeometry(unassigned, catalogTerritory, territoryIds).some((p) => p.includes("disa-stig has no assigned slot") || p.includes("mapped publication disa-stig")));
  const outside = clone();
  outside.territories.find((t) => t.key === "risk")!.slots = [{ id: "territory.risk.slot.01", at: [1500, 900] }];
  assert.ok(validateTerritoryGeometry(outside, catalogTerritory, territoryIds).some((p) => p.includes("outside its territory")));
  const gap = clone();
  (gap.territories.find((t) => t.key === "risk")!.ring as string[]).splice(2, 1, "n4");
  assert.ok(validateTerritoryGeometry(gap, catalogTerritory, territoryIds).some((p) => p.startsWith("border") || p.startsWith("coast")));
  const truncated = clone();
  (truncated.presentation as Record<string, { alias: string; major: boolean }>)["cmmc-2"] = { alias: "CMMC…", major: true };
  assert.ok(validateTerritoryGeometry(truncated, catalogTerritory, territoryIds).some((p) => p.includes("truncation")));
});
