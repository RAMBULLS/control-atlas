import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AtlasResearchEngine, validateResearchIndex, validateResearchManifest, type ResearchIndex } from "../../src/ui/lib/atlasResearchIndex";
import { normalizeResearchState, parseResearchPins } from "../../src/ui/lib/atlasResearchState";
import { normalizeViewState, serializeViewState } from "../../src/ui/lib/viewState";
import { parseHashLocation, serializeHashUrl } from "../../src/ui/lib/hashRoutes";
import { canonicalizeHashLocation } from "../../src/ui/lib/routeIdentity";
import { runtimeArtifactPlan } from "../../src/ui/lib/runtimeLoader";
import { requiresFullGraph } from "../../src/ui/lib/navigationState";

function fixture(): ResearchIndex {
  return { schemaVersion: 1, policyVersion: 1, generatedAt: "2026-09-16T00:00:00.000Z",
    sourceHashes: { nodes: "a".repeat(64), edges: "b".repeat(64) },
    nodes: ["a", "b", "c", "d"].map(id => ({ id, node_type: "control", lifecycle_status: "active",
      identity: { label: id, title: `${id} official title`, publication: "Fixture", catalogId: "fixture", itemId: id } })),
    edges: [["a", "b"], ["b", "c"]].map(([from,to],i) => ({ id: `edge-${i}`, source_node_id:from,target_node_id:to,
      relationship_type: "references", relationship_class: "correlation", authority_class: "publisher", publication_status:"published",
      status:"active", provenance_class:"federal_published", confidence:"direct", source_refs:[{source_id:"fixture",locator:`section:${i}`}]})),
  };
}
const manifest = {schemaVersion:1,policyVersion:1,generatedAt:"2026-09-16T00:00:00.000Z",sha256:"a".repeat(64),bytes:2000,nodeCount:4,edgeCount:2,inputNodeCount:4,inputEdgeCount:4};

test("research index validates versions, input coverage, counts and edge admission", () => {
  assert.equal(validateResearchManifest(manifest),manifest);
  assert.equal(validateResearchIndex(fixture(),manifest).edges.length,2);
  for (const change of [{policyVersion:2},{bytes:100*1024*1024},{nodeCount:3},{sha256:"bad"},{edgeCount:5}]) {
    assert.throws(()=>validateResearchManifest({...manifest,...change}));
  }
  for (const change of [{generatedAt:"2000-01-01"},{nodes:[]},{edges:[]}]) assert.throws(()=>validateResearchIndex({...fixture(),...change},manifest));
  const invalid=fixture();invalid.edges[0].authority_class="atlas";
  assert.throws(()=>validateResearchIndex(invalid,manifest),/Unadmitted/);
});

test("worker model returns original edges and all hop identities, not a transitive mapping", () => {
  const index=fixture();const engine=new AtlasResearchEngine(index);
  const answer=engine.path("a","c","forward",4);
  assert.equal(answer.result?.status,"found");
  assert.deepEqual(answer.edges,index.edges);
  assert.deepEqual(answer.nodes.map(n=>n.id),["a","c","b"]);
  assert.equal(engine.graph.size,2);
  assert.equal(engine.path("c","a","forward",4).result?.status,"not_found_within_bounds");
  assert.ok(engine.path("c","a","either",4).result?.paths[0].every(h=>h.traversal==="reverse"));
});

test("shared connections retain the original edges from each pin", () => {
  const answer=new AtlasResearchEngine(fixture()).shared(["a","c"]);
  assert.equal(answer.sharedTotal,1);assert.equal(answer.shared?.[0].nodeId,"b");
  assert.deepEqual(answer.shared?.[0].connections,[{pinId:"a",edgeIds:["edge-0"]},{pinId:"c",edgeIds:["edge-1"]}]);
  assert.throws(()=>new AtlasResearchEngine(fixture()).shared(["a","missing"]));
});

test("shared results are paginated rather than silently truncated", () => {
  const index=fixture();
  for(let n=0;n<50;n++){
    const id=`shared-${n.toString().padStart(2,"0")}`;index.nodes.push({...index.nodes[0],id});
    index.edges.push(...["a","c"].map(pin=>({...index.edges[0],id:`${pin}-${id}`,source_node_id:pin,target_node_id:id})));
  }
  const engine=new AtlasResearchEngine(index);const first=engine.shared(["a","c"]),second=engine.shared(["a","c"],40);
  assert.equal(first.sharedTotal,51);assert.equal(first.shared?.length,40);assert.equal(second.shared?.length,11);
  assert.equal(new Set([...first.shared!,...second.shared!].map(r=>r.nodeId)).size,51);
});

test("record search ranks exact identifiers and keeps results bounded", () => {
  const index=fixture();index.nodes.push({...index.nodes[0],id:"qualified:alpha",identity:{...index.nodes[0].identity,label:"Alpha",itemId:"alpha"}});
  const engine=new AtlasResearchEngine(index);
  assert.equal(engine.search("alpha").records[0].id,"qualified:alpha");
  assert.equal(engine.search("qualified:alpha").records[0].id,"qualified:alpha");
  assert.deepEqual(engine.search("x"),{records:[],total:0});
  assert.equal(engine.search("zz-no-match").total,0);
});

test("malformed or excessive saved pins cannot expand work or inject controls", () => {
  for (const value of ["{bad", "null", "{}", "x".repeat(2000)]) assert.deepEqual(parseResearchPins(value),[]);
  assert.deepEqual(parseResearchPins(JSON.stringify(["a","a",null,"b","\u0000"," "])),["a","b"]);
  assert.equal(parseResearchPins(JSON.stringify([1,2,3,4,5,6,7,8].map(String))).length,6);
  const normalized=normalizeResearchState({atlasHops:"999",atlasFrom:"\u0000",atlasDirection:"bad",atlasResearch:"bad"});
  assert.equal(normalized.atlasHops,"4");assert.equal(normalized.atlasFrom,"");assert.equal(normalized.atlasResearch,"");
});

test("research state survives canonical URL serialization without corrupting the return map scope", () => {
  const state=normalizeViewState("atlas-map",{view:"atlas-map",atlasResearch:"path",atlasPins:'["disa-stig:V-205646","nist-800-53:IA-5.2"]',atlasFrom:"disa-stig:V-205646",atlasTo:"nist-800-53:IA-5.2",atlasDirection:"either",atlasHops:"2",atlasLanding:"publishers",atlasFramework:"disa-stig"});
  const hash=serializeHashUrl(state); const route=hash.slice(1); const i=route.indexOf("?"); const restored=parseHashLocation(route.slice(0,i),route.slice(i));
  assert.equal(restored.view,"atlas-map");
  for(const key of ["atlasPins","atlasFrom","atlasTo","atlasResearch","atlasDirection","atlasHops","atlasLanding","atlasFramework"]) assert.equal(restored[key],state[key]);
  assert.ok(hash.includes("atlasResearch=path"));
});

test("ordinary Atlas URLs never acquire research fields or load its graph", () => {
  const state=normalizeViewState("atlas-map",{view:"atlas-map"});
  assert.doesNotMatch(serializeViewState(state),/atlasResearch|atlasPins|atlasFrom|atlasTo|atlasDirection|atlasHops/);
  const source=readFileSync("src/ui/pages/AtlasMapPage.tsx","utf8");
  assert.doesNotMatch(source,/import .*atlasResearchClient|import .*atlasResearchIndex/);
  const research=normalizeViewState("atlas-map",{view:"atlas-map",atlasResearch:"path",atlasBaseline:"fedramp-rev5:HIGH",atlasRmfStep:"RMF-SELECT"});
  assert.equal(requiresFullGraph(research),false);
  const plan=runtimeArtifactPlan(research);
  assert.equal(plan.fullGraph,false);assert.equal(plan.atlasNetwork,false);assert.equal(plan.catalogId,"");assert.equal(plan.librarySearch,false);assert.equal(plan.sources,true);
});


test("six long but valid record pins survive the canonical URL boundary", () => {
  const pins = Array.from({length:6}, (_,i) => `nist-zt:PRODUCT-COMPONENT-${i}-${"A".repeat(100)}`);
  const state = normalizeViewState("atlas-map", {atlasResearch:"path", atlasPins:JSON.stringify(pins)});
  const url = serializeHashUrl(state);
  const canonical = canonicalizeHashLocation(url);
  const split = canonical.canonicalPath.indexOf("?");
  const restored = parseHashLocation(canonical.canonicalPath.slice(0,split),canonical.canonicalPath.slice(split));
  assert.equal(restored.view,"atlas-map");
  if (restored.view !== "atlas-map") throw new Error("Expected Atlas state.");
  assert.deepEqual(parseResearchPins(restored.atlasPins),pins);
});
