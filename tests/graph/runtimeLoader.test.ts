import assert from "node:assert/strict";
import test from "node:test";

import {
  clearRuntimeArtifactCache,
  compressedArtifactPath,
  fetchArtifact,
  loadIndexedLibrarySearchColumns,
  parseJsonResponseOffThread,
  runtimeArtifactPlan,
  selectAtlasStructuralPath,
} from "../../src/ui/lib/runtimeLoader";
import { requiresFullGraph } from "../../src/ui/lib/navigationState";
import { normalizeViewState } from "../../src/ui/lib/viewState";

test("Atlas selects the publisher path identified by branch context", () => {
  const tacticA = { id: "attack:tactic-a", node_type: "tactic", label: "Tactic A", metadata: {} };
  const tacticB = { id: "attack:tactic-b", node_type: "tactic", label: "Tactic B", metadata: {} };
  const catalog = { id: "attack:catalog", node_type: "catalog", label: "ATT&CK", metadata: {} };
  const technique = { id: "attack:T1000", node_type: "attack_technique", label: "Technique", metadata: {} };
  const record = {
    center_node: { ...technique, display_path: [catalog, tacticA] },
    nodes: [catalog, tacticA, tacticB, technique],
    edges: [],
    structural_path: [catalog, tacticA, technique],
    structural_paths: [
      [catalog, tacticA, technique],
      [catalog, tacticB, technique],
    ],
    published_connection_count: 0,
    candidate_connection_count: 0,
  };

  const selected = selectAtlasStructuralPath(record, "attack:tactic-b");
  assert.deepEqual(selected.structural_path.map((node) => node.id), [
    "attack:catalog",
    "attack:tactic-b",
    "attack:T1000",
  ]);
  assert.deepEqual(selected.center_node.display_path?.map((node) => node.id), [
    "attack:catalog",
    "attack:tactic-b",
  ]);
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
    true,
    "record pages load their existing contextual Resources module",
  );
  assert.equal(
    recordDetail.catalogBootstrap,
    true,
    "record breadcrumbs use the same canonical publication identity as Atlas",
  );
  assert.equal(
    recordDetail.atlasSpine,
    true,
    "record rails extend primary authority through the shared authority spine",
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

  const atlasLanding = runtimeArtifactPlan(normalizeViewState("atlas-map"));
  assert.equal(atlasLanding.recordNodeId, "");
  assert.equal(atlasLanding.atlasSpine, false, "the territory sheet draws from its own small index, not the hierarchy spine");
  assert.equal(atlasLanding.atlasNetwork, false);
  assert.equal(
    atlasLanding.librarySearch,
    false,
    "the territory sheet loads record search only when the reader reaches for the search box",
  );
  assert.equal(atlasLanding.fullGraph, false);

  const atlasPublicationChoice = runtimeArtifactPlan(
    normalizeViewState("atlas-map", {
      atlasAxis: "landscape",
      atlasLimb: "atlas:LIMB-COMPLIANCE",
    }),
  );
  assert.equal(
    atlasPublicationChoice.fullGraph,
    false,
    "opening an area keeps its publication list responsive from the catalog bootstrap",
  );

  for (const atlasState of [
    normalizeViewState("atlas-map", { atlasAxis: "framework" }),
    normalizeViewState("atlas-map", { atlasFramework: "nist-800-53" }),
    normalizeViewState("atlas-map", { atlasFamily: "nist-800-53:FAMILY-AC" }),
    normalizeViewState("atlas-map", {
      atlasFramework: "disa-stig",
      atlasBenchmark: "disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG",
    }),
  ]) {
    assert.equal(runtimeArtifactPlan(atlasState).fullGraph, false);
    assert.equal(requiresFullGraph(atlasState), false);
  }
  const selectedFramework = runtimeArtifactPlan(
    normalizeViewState("atlas-map", { atlasFramework: "nist-800-53" }),
  );
  assert.equal(selectedFramework.catalogId, "", "the territory sheet reads publication facts from its own index");
  assert.equal(selectedFramework.fullGraph, false);
  const classicFramework = runtimeArtifactPlan(
    normalizeViewState("atlas-map", { atlasAxis: "framework", atlasFramework: "nist-800-53" }),
  );
  assert.equal(classicFramework.catalogId, "nist-800-53");
  assert.equal(classicFramework.fullGraph, false);

  for (const atlasState of [
    normalizeViewState("atlas-map", { atlasBaseline: "nist-800-53b:MODERATE" }),
    normalizeViewState("atlas-map", { atlasRmfStep: "nist-800-37:RMF-SELECT" }),
  ]) {
    assert.equal(runtimeArtifactPlan(atlasState).fullGraph, true);
    assert.equal(requiresFullGraph(atlasState), true);
  }
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
    true,
  );
  const configuredItemCompare = normalizeViewState("matrix", {
    crosswalk: "relationships",
    intent: "item-mapping",
    source: "nist-800-171",
    items: "3.1.1",
  });
  assert.equal(
    runtimeArtifactPlan(configuredItemCompare).fullGraph,
    true,
    "specific-item target choices require the published relationship graph",
  );
  assert.equal(requiresFullGraph(configuredItemCompare), true);

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
