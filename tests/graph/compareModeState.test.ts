import assert from "node:assert/strict";
import test from "node:test";

import {
  activateCompareMode,
  compareConfigurationReady,
  COMPARE_MODES,
  getCompareCurrentStep,
  getCompareSteps,
  nextMissingCompareInput,
  resolveMappingSource,
} from "../../src/ui/lib/compareModeState";
import {
  buildCompareUrl,
  normalizeViewState,
  parseViewState,
  serializeViewState,
} from "../../src/ui/lib/viewState";
import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";
import { createFederalGraphRuntime } from "../../src/app/runtime.mjs";

test("each Compare mode has distinct required input state after one activation", () => {
  assert.equal(COMPARE_MODES.length, 2);
  for (const mode of COMPARE_MODES) {
    const state = normalizeViewState("matrix", {
      view: "matrix",
      ...activateCompareMode(mode.id),
    });
    assert.equal(state.view, "matrix");
    assert.equal(state.intent, mode.id);
    assert.equal(compareConfigurationReady(state), false);
    assert.ok(nextMissingCompareInput(state));
  }
});

test("a pair with exactly one mapping source auto-resolves without a user choice", () => {
  const state = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("frameworks"),
    source: "nist-800-53",
    target: "csf-2",
  });
  assert.equal(state.view, "matrix");
  // Single eligible source: ready immediately, mappingSource left unset in
  // state (auto-resolution is a derived render-time fact, not a URL write).
  assert.equal(
    compareConfigurationReady(state, ["nist-olir-csf2-to-sp800-53"]),
    true,
  );
  assert.deepEqual(
    resolveMappingSource(["nist-olir-csf2-to-sp800-53"], ""),
    { status: "auto", value: "nist-olir-csf2-to-sp800-53" },
  );
});

test("a pair with zero mapping sources is never ready, even with source and target chosen", () => {
  const state = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("frameworks"),
    source: "nist-800-53",
    target: "csf-2",
  });
  assert.equal(compareConfigurationReady(state, []), false);
  assert.equal(
    nextMissingCompareInput(state, []),
    "a published mapping between these publications",
  );
  assert.deepEqual(resolveMappingSource([], ""), { status: "none" });
});

test("a pair with multiple mapping sources defaults to all without forcing a filter", () => {
  const eligible = ["source-a", "source-b"];
  const state = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("frameworks"),
    source: "nist-800-53",
    target: "csf-2",
  });
  assert.equal(compareConfigurationReady(state, eligible), true);
  assert.deepEqual(resolveMappingSource(eligible, ""), { status: "all" });
  assert.deepEqual(resolveMappingSource(eligible, "source-a"), {
    status: "filtered",
    value: "source-a",
  });
  assert.equal(
    compareConfigurationReady({ ...state, mappingSource: "source-a" }, eligible),
    true,
  );
});

test("a stale mapping-source deep link is never silently treated as ready", () => {
  const eligible = ["source-a", "source-b"];
  const state = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("frameworks"),
    source: "nist-800-53",
    target: "csf-2",
    mappingSource: "forged-source",
  });
  assert.equal(compareConfigurationReady(state, eligible), false);
  assert.equal(
    nextMissingCompareInput(state, eligible),
    "a valid published mapping source",
  );
  assert.deepEqual(resolveMappingSource(eligible, "forged-source"), {
    status: "invalid",
  });
});



test("item mappings require a named published structure before resolving an identifier", () => {
  const state = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("item-mapping"),
    items: "AC-2",
  });
  assert.equal(nextMissingCompareInput(state, ["nist-olir"]), "source");
  assert.equal(
    compareConfigurationReady(
      { ...state, source: "nist-800-53", target: "csf-2" },
      ["nist-olir"],
    ),
    true,
  );
});

test("T3.11: matrix URL state round-trips through parse/serialize for every field, single-source and multi-source alike", () => {
  const singleSourceUrl = buildCompareUrl({
    crosswalk: "relationships",
    intent: "frameworks",
    source: "nist-800-171",
    target: "csf-2",
    compareRun: "true",
  });
  // The auto-resolved single-source case never appears in the URL (T3.11) —
  // it is a deterministic function of source+target, not stored state.
  assert.ok(!singleSourceUrl.includes("mappingSource="));
  const parsedSingle = parseViewState(singleSourceUrl);
  assert.equal(parsedSingle.view, "matrix");
  assert.equal((parsedSingle as any).source, "nist-800-171");
  assert.equal((parsedSingle as any).target, "csf-2");
  assert.equal((parsedSingle as any).compareRun, "true");

  const multiSourceUrl = buildCompareUrl({
    crosswalk: "relationships",
    intent: "frameworks",
    source: "nist-800-53",
    target: "csf-2",
    mappingSource: "source-a",
    compareRun: "true",
    relationshipType: "maps_to",
    provenance: "federal_published",
    confidence: "direct",
    includeCandidates: "true",
  });
  const parsed = parseViewState(multiSourceUrl);
  assert.equal(parsed.view, "matrix");
  const reserialized = serializeViewState(
    normalizeViewState("matrix", parsed),
  );
  // A second parse/serialize pass changes nothing further — the URL is a
  // fixed point, so refresh/back/forward/shared links are stable.
  assert.equal(reserialized, multiSourceUrl);
});

test("T3.12/T3.14: real-graph capability feeds the state machine end to end — a zero-source pair never becomes ready, a real pair does", () => {
  const runtime = createFederalGraphRuntime({
    sources: readGeneratedCollection(".", "sources").sources,
    nodes: readGeneratedCollection(".", "nodes").nodes,
    edges: readGeneratedCollection(".", "edges").edges,
    evidence: readGeneratedCollection(".", "evidence").evidence,
    findings: readGeneratedCollection(".", "graph-health").findings,
  });

  // Zero-source case: two catalogs with no published crosswalk between them
  // at all — verified disconnected via runtime.getConnectedCatalogs, not
  // assumed, since "no direct pair today" is a data fact that can shift.
  assert.equal(
    runtime
      .getConnectedCatalogs("cmmc-2")
      .some((target: any) => target.id === "csf-2"),
    false,
    "cmmc-2/csf-2 must stay disconnected for this fixture to test the zero-source path — if data changed, pick another genuinely disconnected pair",
  );
  const disconnectedRows = runtime.buildRelationshipRows({
    source_catalog: "cmmc-2",
    target_catalog: "csf-2",
    include_candidates: true,
  });
  const disconnectedSources = [
    ...new Set(
      disconnectedRows.rows.flatMap((row: any) =>
        (row.source_refs || []).map(
          (reference: any) => reference.source_id || reference.sourceId,
        ),
      ),
    ),
  ].filter(Boolean);
  const disconnectedState = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("frameworks"),
    source: "cmmc-2",
    target: "csf-2",
  });
  assert.equal(
    compareConfigurationReady(disconnectedState, disconnectedSources),
    false,
  );

  // Real, evidenced pair: nist-800-171 -> nist-800-53 (T3.13's SP 800-171
  // regression target) has exactly one mapping source, so it must auto-ready.
  const realRows = runtime.buildRelationshipRows({
    source_catalog: "nist-800-171",
    target_catalog: "nist-800-53",
    include_candidates: false,
  });
  assert.ok(realRows.rows.length > 0);
  const realSources = [
    ...new Set(
      realRows.rows.flatMap((row: any) =>
        (row.source_refs || []).map(
          (reference: any) => reference.source_id || reference.sourceId,
        ),
      ),
    ),
  ].filter(Boolean);
  assert.equal(realSources.length, 1);
  const realState = normalizeViewState("matrix", {
    view: "matrix",
    ...activateCompareMode("frameworks"),
    source: "nist-800-171",
    target: "nist-800-53",
  });
  assert.equal(compareConfigurationReady(realState, realSources), true);
  assert.deepEqual(resolveMappingSource(realSources, ""), {
    status: "auto",
    value: realSources[0],
  });
});

test("staged flow steps and current step index reflect progressive completion across framework crosswalk modes", () => {
  // 1. Frameworks mode
  const fwSteps = getCompareSteps("frameworks");
  assert.equal(fwSteps.length, 3);
  assert.equal(fwSteps[0].id, "source");
  assert.equal(fwSteps[1].id, "target");
  assert.equal(fwSteps[2].id, "results");

  const fwInit = normalizeViewState("matrix", { view: "matrix", ...activateCompareMode("frameworks") });
  assert.equal(getCompareCurrentStep("frameworks", fwInit), 1);
  assert.equal(getCompareCurrentStep("frameworks", { ...fwInit, source: "nist-800-53" }), 2);
  assert.equal(getCompareCurrentStep("frameworks", { ...fwInit, source: "nist-800-53", target: "csf-2" }), 2);
  assert.equal(getCompareCurrentStep("frameworks", { ...fwInit, source: "nist-800-53", target: "csf-2", compareRun: "true" }), 3);

  // 2. Item mapping mode
  const itemSteps = getCompareSteps("item-mapping");
  assert.equal(itemSteps.length, 3);
  assert.equal(itemSteps[0].id, "item");
  assert.equal(itemSteps[1].id, "target");
  assert.equal(itemSteps[2].id, "results");

  const itemInit = normalizeViewState("matrix", { view: "matrix", ...activateCompareMode("item-mapping") });
  assert.equal(getCompareCurrentStep("item-mapping", itemInit), 1);
  assert.equal(getCompareCurrentStep("item-mapping", { ...itemInit, source: "nist-800-53" }), 1);
  assert.equal(getCompareCurrentStep("item-mapping", { ...itemInit, source: "nist-800-53", items: "AC-2" }), 2);
  assert.equal(getCompareCurrentStep("item-mapping", { ...itemInit, source: "nist-800-53", items: "AC-2", target: "csf-2" }), 2);
  assert.equal(getCompareCurrentStep("item-mapping", { ...itemInit, source: "nist-800-53", items: "AC-2", target: "csf-2", compareRun: "true" }), 3);
});

