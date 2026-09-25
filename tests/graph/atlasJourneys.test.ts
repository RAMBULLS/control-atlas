import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import geometry from "../../data/curated/atlas-territory-geography.json";
import authoritySpine from "../../data/curated/authority-spine.json";
import { JOURNEY_IDS, normalizeJourneyId } from "../../src/ui/lib/atlasJourneyIds";
import { JOURNEYS, policyForJourney, policyForPublication, publicationsCitingPolicy, searchJourneys } from "../../src/ui/lib/atlasJourneys";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const onMap = new Set(Object.keys(geometry.assignments));
const workflows = new Set(read("data/compliance-workflows.json").workflows.map((w: any) => w.workflow_id));
const templates = new Set(read("data/template-registry.json").templates.map((t: any) => t.name));
const commons = read("data/commons-resource-dataset.json");
const resources = new Map<string, any>(commons.resources.map((r: any) => [r.id, r]));
const collections = new Map<string, any>(commons.collections.map((c: any) => [c.id, c]));
const registry = read("data/source-registry.json");
const registered = new Set([...registry.publications, ...registry.sources].map((s: any) => s.id));
const rmfSteps = new Set(read("data/tasks-800-37.json").records.map((r: any) => `nist-800-37:${r.id}`));
const instruments = new Set((authoritySpine.instruments as any[]).map((i) => i.source_id));

test("journey ids used for URL parsing match the journey data exactly", () => {
  assert.deepEqual([...JOURNEY_IDS], JOURNEYS.map((j) => j.id));
  assert.equal(normalizeJourneyId("rmf"), "rmf");
  assert.equal(normalizeJourneyId("not-a-journey"), "");
});

test("every journey destination exists in the corpus; nothing is invented", () => {
  for (const j of JOURNEYS) {
    for (const p of j.publications) assert.ok(onMap.has(p.id), `${j.id}: ${p.id} is not a publication on the map`);
    for (const s of j.steps?.items || []) assert.ok(rmfSteps.has(s.nodeId), `${j.id}: step ${s.nodeId} is not a published record`);
    for (const id of j.tasks) assert.ok(workflows.has(id), `${j.id}: task ${id} does not exist`);
    for (const name of j.templates) assert.ok(templates.has(name), `${j.id}: template ${name} does not exist`);
    for (const r of j.resources) {
      const found = resources.get(r.id);
      assert.ok(found, `${j.id}: resource ${r.id} does not exist`);
      assert.ok([found.name, found.shortName].includes(r.label), `${j.id}: ${r.id} must use its recorded name, not "${r.label}"`);
    }
    for (const c of j.collections) assert.equal(collections.get(c.id)?.title, c.label, `${j.id}: collection ${c.id}`);
    for (const s of j.sources) assert.ok(registered.has(s.id), `${j.id}: source ${s.id} is not in the source register`);
    for (const e of j.extraPolicy) {
      assert.ok(registered.has(e.id), `${j.id}: policy ${e.id} is not in the source register`);
      assert.ok(e.basis.length > 10, `${j.id}: ${e.id} must state its basis`);
    }
    for (const [a, b] of j.compare) assert.ok(onMap.has(a) && onMap.has(b) && a !== b, `${j.id}: compare ${a}/${b}`);
    const destinations = j.publications.length + j.tasks.length + j.templates.length + j.resources.length + j.sources.length;
    assert.ok(destinations >= 3, `${j.id} needs real destinations`);
  }
});

test("governing policy comes only from the cited authority spine or a stated basis", () => {
  for (const j of JOURNEYS) {
    const stated = new Set(j.extraPolicy.map((e) => e.id));
    for (const entry of policyForJourney(j)) {
      assert.ok(instruments.has(entry.id) || stated.has(entry.id), `${j.id}: ${entry.id} has no recorded basis`);
      for (const cited of entry.cites) assert.ok(policyForPublication(cited).includes(entry.id));
    }
  }
  assert.deepEqual(publicationsCitingPolicy("authority-dodi-8500-01"), ["disa-cci", "disa-srg", "disa-stig"]);
  assert.ok(policyForPublication("nist-800-37").includes("authority-omb-circular-a-130"));
  assert.deepEqual(policyForPublication("mitre-attack"), [], "a publication issued without a mandate cites no policy");
});

test("practitioner words find the work without publication numbers", () => {
  const first = (q: string) => searchJourneys(q)[0]?.id;
  const expected: Record<string, string> = {
    RMF: "rmf", ATO: "rmf", STIG: "stig", STIGs: "stig", SRG: "stig", "Zero Trust": "zero-trust", ZT: "zero-trust", CMMC: "cmmc-cui", CUI: "cmmc-cui",
    FedRAMP: "fedramp", controls: "controls", baselines: "controls", assessment: "assessment", evidence: "assessment", "POA&M": "assessment",
    threats: "threats", "ATT&CK": "threats", templates: "working-files", "working files": "working-files",
  };
  for (const [q, id] of Object.entries(expected)) assert.equal(first(q), id, `"${q}" should open ${id}`);
  assert.ok(searchJourneys("RMF")[0].exact);
  assert.deepEqual(searchJourneys("x"), []);
});

test("journey copy never claims applicability, equivalence or precedence", () => {
  const text = JOURNEYS.flatMap((j) => [j.label, j.expansion, j.summary, ...j.publications.map((p) => p.role), ...j.sources.map((s) => s.role)]).join(" \n");
  assert.doesNotMatch(text, /\b(?:applies to (?:you|your)|required for you|you must|equivalent|supersedes|takes precedence|mandatory for)\b/i);
  const source = readFileSync("src/ui/components/atlas-territory/JourneyPanels.tsx", "utf8");
  assert.match(source, /Grouped by Control Atlas for navigation\. Not a publisher mapping\./);
});

test("the RMF journey leads with RMF but keeps SP 800-53 as a control catalog, never renamed RMF", () => {
  const rmf = JOURNEYS.find((j) => j.id === "rmf")!;
  assert.equal(rmf.publications[0].id, "nist-800-37");
  const sp53 = rmf.publications.find((p) => p.id === "nist-800-53")!;
  assert.doesNotMatch(sp53.role, /RMF/);
  assert.deepEqual(rmf.steps!.items.map((s) => s.label), ["Prepare", "Categorize", "Select", "Implement", "Assess", "Authorize", "Monitor"]);
});
