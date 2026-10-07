import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRuntimeArtifactCache,
  compressedArtifactPath,
  fetchArtifact,
  loadRuntimeDatasetStaged,
  loadAtlasNeighborhood,
  preloadRuntimeArtifacts,
  loadIndexedLibrarySearchColumns,
  parseJsonResponseOffThread,
  runtimeArtifactPlan,
} from "../../src/ui/lib/runtimeLoader";
import type { RuntimeBundle } from "../../src/ui/lib/runtimeLoader";
import { atlasNeighborhoodShardId, buildAtlasNeighborhoodShards } from "../../src/app/atlas-neighborhood.mjs";
import { RUNTIME_CACHE_VERSION } from "../../src/shared/runtime-cache-version.mjs";
import { requiresFullGraph } from "../../src/ui/lib/navigationState";
import { normalizeViewState } from "../../src/ui/lib/viewState";
import { recordCommitToken, waitForRecordPaint } from "../../src/ui/lib/waitForRecordPaint";
import { createRecordRouteModuleCache } from "../../src/ui/lib/recordRouteModule";

test("record module warm-up shares pending and fulfilled imports with rendering", async () => {
  let resolveModule = (_module: object) => {};
  let loads = 0;
  const module = { ObjectDetailPage: () => null };
  const cache = createRecordRouteModuleCache(() => {
    loads += 1;
    return new Promise<object>(resolve => { resolveModule = resolve; });
  });
  assert.equal(cache.ready(), null);
  const preload = cache.load();
  assert.equal(cache.load(), preload);
  assert.equal(cache.ready(), null, "pending modules cannot bypass Suspense");
  resolveModule(module);
  assert.equal(await preload, module);
  assert.equal(cache.ready(), module, "a fulfilled module can render directly");
  assert.equal(cache.load(), preload);
  assert.equal(loads, 1);
});

test("a failed record module warm-up does not poison its recovery request", async () => {
  let loads = 0;
  const module = { ObjectDetailPage: () => null };
  const cache = createRecordRouteModuleCache(async () => {
    if (++loads === 1) throw new Error("Synthetic module failure");
    return module;
  });
  await assert.rejects(cache.load(), /Synthetic module failure/);
  assert.equal(cache.ready(), null);
  assert.equal(await cache.load(), module);
  assert.equal(cache.ready(), module);
  assert.equal(loads, 2);
});

test("record rendering acknowledgment binds visible runtime identity and bounds cleanup", async () => {
  const names = ["document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"];
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const runtime = {};
  const token = recordCommitToken(runtime);
  let visible = false;
  let failed = false;
  let disconnected = false;
  let notify = () => {};
  let nextFrame = 0;
  const frames = new Map<number, (time: number) => void>();
  const content = { dataset: { recordContent: "fixture:record", recordCommit: "stale" }, getClientRects: () => visible ? [{}] : [] };
  const workspace = { querySelector: (selector: string) => selector.includes("render-error") ? failed ? {} : null : content };
  const replacements = [
    { body: {}, getElementById: () => workspace },
    class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() { disconnected = true; } },
    (callback: (time: number) => void) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    (id: number) => frames.delete(id),
    () => ({ visibility: visible ? "visible" : "hidden" }),
  ];
  names.forEach((name, index) => Object.defineProperty(globalThis, name, { configurable: true, value: replacements[index] }));
  const advanceFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  };
  try {
    const controller = new AbortController();
    const pending = waitForRecordPaint("fixture:record", runtime, controller.signal);
    visible = true;
    notify();
    assert.equal(frames.size, 0, "a previous runtime cannot release supporting work");
    content.dataset.recordCommit = token;
    visible = false;
    notify();
    assert.equal(frames.size, 0, "hidden content is not a rendering acknowledgment");
    visible = true;
    notify();
    advanceFrame();
    content.dataset.recordCommit = "navigated-away";
    advanceFrame();
    assert.equal(disconnected, false, "runtime identity is rechecked after the paint opportunity");
    controller.abort();
    await pending;
    assert.equal(disconnected, true);
    assert.equal(frames.size, 0);

    disconnected = false;
    content.dataset.recordCommit = token;
    const committed = waitForRecordPaint("fixture:record", runtime, new AbortController().signal);
    advanceFrame();
    advanceFrame();
    await committed;
    assert.equal(disconnected, true);
    assert.equal(frames.size, 0);

    disconnected = false;
    failed = true;
    await assert.rejects(waitForRecordPaint("fixture:record", runtime, new AbortController().signal), /renderer could not load/);
    assert.equal(disconnected, true);
    assert.equal(frames.size, 0);

    disconnected = false;
    failed = false;
    await assert.rejects(waitForRecordPaint("fixture:record", runtime, new AbortController().signal, 10), /took too long/);
    assert.equal(disconnected, true, "a stalled lazy renderer or background frame is bounded");
    assert.equal(frames.size, 0);
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await waitForRecordPaint("fixture:record", runtime, alreadyAborted.signal);
    assert.equal(frames.size, 0);
  } finally {
    names.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});

// Synthetic publisher fixtures exercise staging without network or generated data.
function recordStageFixture() {
  const id = "nist-800-53:AC-2";
  const source = { id: "fixture-source", owner: "Fixture publisher", title: "Fixture publication" };
  const nodes = [
    { id, node_type: "control", source_id: source.id, metadata: { catalog_id: "nist-800-53", item_id: "AC-2", title: "Account management", description: "Complete fixture publisher text." } },
    { id: "fixture:baseline", node_type: "baseline", source_id: source.id, metadata: { item_id: "Fixture baseline" } },
  ];
  const edge = { id: "fixture:selection", source_node_id: nodes[1].id, target_node_id: id,
    relationship_type: "selects", relationship_class: "applicability", publication_status: "published",
    provenance_class: "federal_published", confidence: "direct",
    source_refs: [{ source_id: source.id, ref_type: "primary", locator: "Fixture row 1" }] };
  const shards = buildAtlasNeighborhoodShards({ nodes, edges: [edge] }, 8);
  const requests: string[] = [];
  const fetchFixture = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requests.push(url);
    if (url.includes(".json.gz")) return new Response("", { status: 404 });
    let body: unknown;
    if (url.includes("atlas-neighborhood-manifest")) body = { atlas_neighborhood_manifest: { shard_count: 8 } };
    else if (url.includes("atlas-neighborhood/")) {
      if (!url.includes(`atlas-neighborhood/${atlasNeighborhoodShardId(id, 8)}.json`)) {
        return new Response("", { status: 404 });
      }
      body = { atlas_neighborhood_shard: shards.find(shard => shard.shard_id === atlasNeighborhoodShardId(id, 8)) };
    }
    else if (url.includes("catalog-bootstrap")) body = { catalog_bootstrap: { catalogs: [{ id: "nist-800-53", name: "Fixture publication" }] } };
    else if (url.includes("sources.json")) body = { sources: [source] };
    else if (url.includes("library-search-index")) body = { library_search_index: { format: "columns-v1", fields: ["id"], columns: [] } };
    else if (url.includes("library-search.json")) body = { library_search: { documents: [] } };
    else if (url.includes("commons-search-index")) body = { resources: [] };
    else if (url.includes("commons-resource-dataset")) body = { resources: [] };
    else throw new Error(`Unexpected fixture request: ${url}`);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { id, edge, source, requests, fetchFixture, state: normalizeViewState("library-detail", { node: id }) };
}

for (const earlyFailure of [false, true]) {
test(`record cohort overlaps its manifest without premature admission (${earlyFailure ? "early rejection and retry" : "shared request"})`, async () => {
  const originalFetch = globalThis.fetch;
  const id = "nist-800-53:AC-2";
  const node = { id, node_type: "control", source_id: "fixture-source", metadata: {
    catalog_id: "nist-800-53", item_id: "AC-2", title: "Fixture account management",
    description: "Complete fixture publisher text.",
  } };
  const shardId = atlasNeighborhoodShardId(id);
  const shards = buildAtlasNeighborhoodShards({ nodes: [node], edges: [] });
  let releaseManifest = () => {};
  const manifestReady = new Promise<void>(resolve => { releaseManifest = resolve; });
  let cohortStarted = () => {};
  const cohortReady = new Promise<void>(resolve => { cohortStarted = resolve; });
  let rejectCohort = earlyFailure;
  let cohortRequests = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes(".json.gz")) return new Response("", { status: 404 });
    if (url.includes("atlas-neighborhood-manifest")) {
      await manifestReady;
      return new Response(JSON.stringify({ atlas_neighborhood_manifest: { shard_count: 2048 } }));
    }
    assert.ok(url.includes(`atlas-neighborhood/${shardId}.json`));
    cohortRequests += 1;
    cohortStarted();
    return rejectCohort ? new Response("", { status: 503 }) : new Response(JSON.stringify({
      atlas_neighborhood_shard: shards.find(shard => shard.shard_id === shardId),
    }));
  }) as typeof fetch;
  clearRuntimeArtifactCache();
  try {
    let settled = false;
    const record = loadAtlasNeighborhood(id);
    // Observe rejection immediately, as a real staged-loader caller does.
    const outcome = record.then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    await cohortReady;
    assert.equal(settled, false, "downloaded bytes are not admitted before the manifest");
    releaseManifest();
    const result = await outcome;
    if (earlyFailure) {
      assert.ok("error" in result);
      rejectCohort = false;
      const retry = await loadAtlasNeighborhood(id);
      assert.equal(retry?.center_node.metadata.description, node.metadata.description);
      assert.equal(cohortRequests, 2, "the rejected request is evicted for a fresh retry");
    } else {
      assert.ok("value" in result);
      assert.equal(result.value?.center_node.metadata.description, node.metadata.description);
      const again = await loadAtlasNeighborhood(id);
      assert.equal(again?.center_node.id, id);
      assert.equal(cohortRequests, 1, "matched cohort bytes are consumed from the shared cache");
    }
  } finally {
    releaseManifest();
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});
}

test("new record cohorts bypass a cached manifest from the previous deployment", async () => {
  const originalFetch = globalThis.fetch;
  const oldVersion = "20260928-compare-scope-1";
  const id = "nist-800-53:AC-2";
  const node = { id, node_type: "control", source_id: "fixture-source", metadata: {
    catalog_id: "nist-800-53", item_id: "AC-2", title: "Fixture account management",
    description: "Complete fixture publisher text.",
  } };
  const shards = buildAtlasNeighborhoodShards({ nodes: [node], edges: [] }, 512);
  const currentShardId = atlasNeighborhoodShardId(id, 512);
  assert.notEqual(currentShardId, atlasNeighborhoodShardId(id, 128));
  const manifestPath = "./data/generated/atlas-neighborhood-manifest.json";
  const staleCache = new Map([[`${manifestPath}?v=${oldVersion}`,
    { atlas_neighborhood_manifest: { shard_count: 128 } }]]);
  const requests: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input);
    requests.push(url);
    if (url.includes(".json.gz")) return new Response("", { status: 404 });
    const body = staleCache.get(url) ?? (url.includes("atlas-neighborhood-manifest")
      ? { atlas_neighborhood_manifest: { shard_count: 512 } }
      : { atlas_neighborhood_shard: shards.find(shard => url.includes(`/${shard.shard_id}.json`)) });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  clearRuntimeArtifactCache();
  try {
    const cached = await fetchArtifact(`${manifestPath}?v=${oldVersion}`);
    assert.equal(cached.atlas_neighborhood_manifest.shard_count, 128);
    const record = await loadAtlasNeighborhood(id);
    assert.equal(record?.center_node.metadata.description, node.metadata.description);
    assert.ok(requests.includes(`${manifestPath}?v=${RUNTIME_CACHE_VERSION}`));
    assert.ok(requests.includes(`./data/generated/atlas-neighborhood/${currentShardId}.json?v=${RUNTIME_CACHE_VERSION}`));
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("record first delivery preserves publisher content and edges through rendering", async () => {
  const originalFetch = globalThis.fetch;
  let releaseContext = (_value: unknown) => {};
  const context = new Promise(resolve => { releaseContext = resolve; });
  const fixture = recordStageFixture();
  clearRuntimeArtifactCache();
  globalThis.fetch = fixture.fetchFixture;
  const first: RuntimeBundle[] = [];
  const final: RuntimeBundle[] = [];
  const errors: unknown[] = [];
  try {
    await preloadRuntimeArtifacts(fixture.state);
    assert.ok(!fixture.requests.some(url => /atlas-spine|commons/.test(url)));
    const staged = loadRuntimeDatasetStaged({ state: fixture.state, onSearchReady: bundle => first.push(bundle),
      onRecordRendered: async () => { await context; },
      onFullReady: bundle => final.push(bundle), onError: error => errors.push(error) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(first.length, 1);
    assert.equal(final.length, 0);
    assert.equal(first[0].atlasSpine, undefined);
    assert.equal(first[0].runtime.getNode(fixture.id).metadata.description, "Complete fixture publisher text.");
    assert.equal(first[0].runtime.getSource(fixture.source.id).owner, fixture.source.owner);
    assert.equal(first[0].runtime.getEdgesForNode(fixture.id)[0].id, fixture.edge.id);
    releaseContext(undefined);
    await staged;
    assert.equal(final.length, 1);
    assert.equal(final[0].atlasSpine, undefined);
    assert.equal(final[0].recordContextReady, true);
    assert.ok(!fixture.requests.some(url => /atlas-spine/.test(url)), "record authority uses its existing curated data");
    assert.ok(!fixture.requests.some(url => /commons/.test(url)), "a closed-search record never requests unrelated Resources artifacts");
    assert.deepEqual(final[0].runtime.getNode(fixture.id), first[0].runtime.getNode(fixture.id));
    assert.deepEqual(final[0].runtime.getEdgesForNode(fixture.id), first[0].runtime.getEdgesForNode(fixture.id));
    assert.deepEqual(errors, []);
    clearRuntimeArtifactCache();
    fixture.requests.length = 0;
    let acknowledge = () => {};
    const acknowledgment = new Promise<void>(resolve => { acknowledge = resolve; });
    const searchedFirst: RuntimeBundle[] = [];
    const searchedFull: RuntimeBundle[] = [];
    const searched = loadRuntimeDatasetStaged({ state: fixture.state, searchOverlayOpen: true,
      onSearchReady: bundle => searchedFirst.push(bundle),
      onRecordRendered: () => acknowledgment,
      onFullReady: bundle => searchedFull.push(bundle), onError: error => errors.push(error) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(searchedFirst.length, 1);
    assert.equal(searchedFull.length, 0);
    assert.ok(!fixture.requests.some(url => /commons/.test(url)), "optional search context waits for matching record rendering");
    acknowledge();
    await searched;
    assert.equal(searchedFull.length, 1);
    assert.ok(fixture.requests.some(url => /commons-search-index/.test(url)));
    assert.ok(fixture.requests.some(url => /commons-resource-dataset/.test(url)));
    assert.equal(searchedFull[0].runtime, searchedFirst[0].runtime, "supporting context retains the accepted runtime identity");
    assert.deepEqual(searchedFull[0].runtime.getNode(fixture.id), searchedFirst[0].runtime.getNode(fixture.id));
    assert.deepEqual(searchedFull[0].runtime.getEdgesForNode(fixture.id), searchedFirst[0].runtime.getEdgesForNode(fixture.id));
    assert.deepEqual(errors, []);
  } finally {
    releaseContext({});
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("failed record render acknowledgment retains first content and a fresh retry recovers", async () => {
  const originalFetch = globalThis.fetch;
  let rendered = false;
  const fixture = recordStageFixture();
  clearRuntimeArtifactCache();
  globalThis.fetch = fixture.fetchFixture;
  const first: RuntimeBundle[] = [];
  const final: RuntimeBundle[] = [];
  const errors: unknown[] = [];
  const handlers = { state: fixture.state, onSearchReady: (bundle: RuntimeBundle) => first.push(bundle),
    onRecordRendered: async () => { if (!rendered) throw new Error("Fixture record rendering failed"); },
    onFullReady: (bundle: RuntimeBundle) => final.push(bundle), onError: (error: unknown) => errors.push(error) };
  try {
    await loadRuntimeDatasetStaged(handlers);
    assert.equal(first.length, 1);
    assert.equal(final.length, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /Fixture record rendering failed/);
    assert.equal(first[0].runtime.getNode(fixture.id).metadata.description, "Complete fixture publisher text.");
    rendered = true;
    clearRuntimeArtifactCache();
    await loadRuntimeDatasetStaged(handlers);
    assert.equal(first.length, 2);
    assert.equal(final.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("aborted record context emits no stale completion or recovery", async () => {
  const originalFetch = globalThis.fetch;
  const fixture = recordStageFixture();
  clearRuntimeArtifactCache();
  globalThis.fetch = fixture.fetchFixture;
  const controller = new AbortController();
  const final: unknown[] = [];
  const errors: unknown[] = [];
  try {
    await loadRuntimeDatasetStaged({ state: fixture.state, signal: controller.signal,
      onSearchReady: () => controller.abort(), onFullReady: bundle => final.push(bundle), onError: error => errors.push(error) });
    assert.deepEqual(final, []);
    assert.deepEqual(errors, []);
    assert.ok(!fixture.requests.some(url => /atlas-spine|commons/.test(url)));
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("compressed artifacts keep cache-busting parameters after the gzip extension", () => {
  assert.equal(
    compressedArtifactPath("./data/generated/nodes.json?v=2026-07-29"),
    "./data/generated/nodes.json.gz?v=2026-07-29",
  );
});

test("compressed artifacts without parameters append the gzip extension", () => {
  assert.equal(
    compressedArtifactPath("./data/template-registry.json"),
    "./data/template-registry.json.gz",
  );
});

test("Library index shards begin together and preserve manifest order", async () => {
  const started: string[] = [];
  const resolvers = new Map<string, (value: unknown) => void>();
  const result = loadIndexedLibrarySearchColumns(
    ["id", "title"],
    [{ path: "first.json" }, { path: "second.json" }],
    (path) => new Promise((resolve) => {
      started.push(path);
      resolvers.set(path, resolve);
    }) as Promise<any>,
    [],
  );
  await Promise.resolve();
  assert.deepEqual(started, ["first.json", "second.json"]);
  resolvers.get("second.json")?.({
    library_search_index: { format: "columns-v1", columns: [["second"], ["Second title"]] },
  });
  resolvers.get("first.json")?.({
    library_search_index: { format: "columns-v1", columns: [["first"], ["First title"]] },
  });
  assert.deepEqual(await result, [["first", "second"], ["First title", "Second title"]]);
});

test("Atlas global search includes resources and source publications only on request", () => {
  const state = normalizeViewState("atlas-map");
  const closed = runtimeArtifactPlan(state);
  assert.equal(closed.commons, false);
  assert.equal(closed.sources, false);
  const open = runtimeArtifactPlan(state, { searchOverlayOpen: true });
  assert.equal(open.commons, true);
  assert.equal(open.sources, true);
  assert.equal(open.librarySearch, true);
  assert.equal(open.fullGraph, false);
  assert.equal(open.atlasSpine, false);
  assert.equal(open.registries, false);
});

test("route bootstrap loads only the smallest faithful artifact scope", () => {
  const resources = runtimeArtifactPlan(normalizeViewState("commons"));
  assert.equal(resources.commons, true);
  assert.equal(resources.librarySearch, false);
  assert.equal(resources.fullGraph, false);

  const resourceDetail = runtimeArtifactPlan(
    normalizeViewState("commons-detail", { id: "legacy-diacap-transition" }),
  );
  assert.equal(
    resourceDetail.sources,
    true,
    "resource replacement links resolve publication targets from the source register",
  );
  assert.equal(resourceDetail.fullGraph, false);

  const recordDetail = runtimeArtifactPlan(
    normalizeViewState("library-detail"),
  );
  assert.equal(
    recordDetail.commons,
    false,
    "record pages do not consume Resources artifacts when search is closed",
  );
  assert.equal(
    recordDetail.catalogBootstrap,
    true,
    "record breadcrumbs use the same canonical publication identity as Atlas",
  );
  assert.equal(
    recordDetail.atlasSpine,
    false,
    "record rails resolve complete authority from existing curated data",
  );

  const globalSearch = runtimeArtifactPlan(normalizeViewState("search"));
  assert.equal(globalSearch.librarySearch, true);
  assert.equal(
    globalSearch.catalogBootstrap,
    true,
    "the results page needs catalog mapping coverage without the full graph",
  );
  assert.equal(
    globalSearch.commons,
    true,
    "the full results page includes the Resources directory",
  );

  const overlaySearch = runtimeArtifactPlan(normalizeViewState("home"), {
    searchOverlayOpen: true,
  });
  assert.equal(overlaySearch.librarySearch, true);
  assert.equal(
    overlaySearch.commons,
    true,
    "the global search overlay includes the Resources directory",
  );

  const sources = runtimeArtifactPlan(normalizeViewState("sources"));
  assert.equal(sources.sources, true);
  assert.equal(sources.librarySearch, false);
  assert.equal(sources.fullGraph, false);

  const catalog = runtimeArtifactPlan(normalizeViewState("catalog-detail"));
  assert.equal(catalog.catalogBootstrap, true);
  assert.equal(catalog.librarySearch, false);
  assert.equal(catalog.fullGraph, false);

  const record = runtimeArtifactPlan(
    normalizeViewState("library-detail", { node: "nist-800-53:AC-2" }),
  );
  assert.equal(record.recordNodeId, "nist-800-53:AC-2");
  assert.equal(record.fullGraph, false);
  assert.equal(runtimeArtifactPlan(
    normalizeViewState("library-detail", { node: "nist-800-53:AC-2" }),
    { searchOverlayOpen: true },
  ).commons, true, "explicit record search still loads Resources results");

  const atlasLanding = runtimeArtifactPlan(normalizeViewState("atlas-map"));
  assert.equal(atlasLanding.recordNodeId, "");
  assert.equal(atlasLanding.atlasSpine, false, "the territory sheet draws from its own small index, not the hierarchy spine");
  assert.equal(
    atlasLanding.librarySearch,
    false,
    "the territory sheet loads record search only when the reader reaches for the search box",
  );
  assert.equal(atlasLanding.fullGraph, false);

  // Every Atlas state is the territory sheet now: publications, journeys and records read its own small
  // index or one neighborhood shard, never the monolithic graph.
  for (const atlasState of [
    normalizeViewState("atlas-map", { atlasLimb: "atlas:LIMB-COMPLIANCE" }),
    normalizeViewState("atlas-map", { atlasFramework: "nist-800-53" }),
    normalizeViewState("atlas-map", { atlasJourney: "rmf" }),
    normalizeViewState("atlas-map", { node: "nist-800-53:AC-2", relationshipView: "list" }),
  ]) {
    assert.equal(runtimeArtifactPlan(atlasState).fullGraph, false);
    assert.equal(requiresFullGraph(atlasState), false);
    assert.equal(runtimeArtifactPlan(atlasState).atlasSpine, false);
  }
  const selectedFramework = runtimeArtifactPlan(
    normalizeViewState("atlas-map", { atlasFramework: "nist-800-53" }),
  );
  assert.equal(selectedFramework.catalogId, "", "the territory sheet reads publication facts from its own index");
});

test("expensive graph scope begins only after an explicit graph-dependent action", () => {
  const configuredCompare = normalizeViewState("matrix", {
    crosswalk: "relationships",
    source: "nist-800-53",
    target: "csf-2",
  });
  assert.equal(runtimeArtifactPlan(configuredCompare).fullGraph, false);
  assert.equal(
    runtimeArtifactPlan({ ...configuredCompare, compareRun: "true" }).fullGraph,
    false,
  );
  const configuredItemCompare = normalizeViewState("matrix", {
    crosswalk: "relationships",
    intent: "item-mapping",
    source: "nist-800-171",
    items: "3.1.1",
  });
  assert.equal(
    runtimeArtifactPlan(configuredItemCompare).fullGraph,
    false,
    "specific-item target choices use their small catalog index",
  );
  assert.equal(requiresFullGraph(configuredItemCompare), false);

  const build = normalizeViewState("templates");
  // Templates lands on the document browser rather than an interstitial, so
  // the small template registries are needed on arrival. The expensive graph
  // still waits for a chosen document.
  assert.equal(runtimeArtifactPlan(build).fullGraph, false);
  assert.equal(runtimeArtifactPlan(build).registries, true);
  assert.equal(runtimeArtifactPlan(build).commons, false);
  assert.equal(
    runtimeArtifactPlan({
      ...build,
      buildSection: "tasks",
    }).registries,
    true,
  );
  assert.equal(
    runtimeArtifactPlan({
      ...build,
      buildSection: "documents",
      templateType: "security_plan_starter",
    }).fullGraph,
    true,
  );
});

test("artifact loading falls back from compressed to uncompressed data", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  clearRuntimeArtifactCache();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith(".gz")) throw new TypeError("compressed fetch failed");
    return new Response(JSON.stringify({ ready: true }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await fetchArtifact("./fixture.json", {
        compressedTimeoutMs: 50,
        fallbackTimeoutMs: 50,
      }),
      { ready: true },
    );
    assert.deepEqual(requests, ["./fixture.json.gz", "./fixture.json"]);
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("artifact timeouts reject and evict the pending cache entry", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  clearRuntimeArtifactCache();
  globalThis.fetch = (() => {
    requests += 1;
    return new Promise<Response>(() => undefined);
  }) as typeof fetch;
  try {
    await assert.rejects(
      fetchArtifact("./never.json", {
        compressedTimeoutMs: 15,
        fallbackTimeoutMs: 15,
      }),
      (error: any) => error?.code === "artifact_timeout",
    );
    await assert.rejects(
      fetchArtifact("./never.json", {
        compressedTimeoutMs: 15,
        fallbackTimeoutMs: 15,
      }),
      (error: any) => error?.code === "artifact_timeout",
    );
    assert.equal(requests, 4, "a second call starts compressed and fallback requests again");
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("a rejected artifact request can succeed on a fresh retry", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  clearRuntimeArtifactCache();
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests < 4) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ recovered: true }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(fetchArtifact("./retry.json"));
    assert.deepEqual(await fetchArtifact("./retry.json"), { recovered: true });
    assert.equal(requests, 4);
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeArtifactCache();
  }
});

test("the JSON worker rejects and terminates when it never responds", async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let terminated = false;
  class SilentWorker {
    addEventListener() {}
    postMessage() {}
    terminate() { terminated = true; }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: SilentWorker,
  });
  try {
    await assert.rejects(
      parseJsonResponseOffThread(new Response("{}"), 15),
      (error: any) => error?.code === "worker_timeout",
    );
    assert.equal(terminated, true);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
    else delete (globalThis as any).Worker;
  }
});

test("the JSON worker isolates unreadable cross-thread messages", async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let terminated = false;
  class MessageErrorWorker {
    listeners = new Map<string, (event: any) => void>();
    addEventListener(type: string, listener: (event: any) => void) {
      this.listeners.set(type, listener);
    }
    postMessage() {
      queueMicrotask(() => this.listeners.get("messageerror")?.({}));
    }
    terminate() { terminated = true; }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: MessageErrorWorker,
  });
  try {
    await assert.rejects(
      parseJsonResponseOffThread(new Response("{}"), 100),
      (error: any) => error?.code === "worker_failure",
    );
    assert.equal(terminated, true);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
    else delete (globalThis as any).Worker;
  }
});
