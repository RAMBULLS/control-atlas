import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { clearRuntimeArtifactCache, loadRuntimeDatasetStaged } from "../../src/ui/lib/runtimeLoader";
import { normalizeViewState } from "../../src/ui/lib/viewState";
import { atlasNeighborhoodShardId } from "../../src/app/atlas-neighborhood.mjs";

// Synthetic stage fixtures test scheduling and retention, not publisher evidence.
const nodeId = "nist-800-53:AC-2";
const node = { id: nodeId, node_type: "control", label: "AC-2", source_id: "nist", metadata: {
  catalog_id: "nist-800-53", item_id: "AC-2", title: "Test account management", description: "Complete test text", statement: "Complete test statement",
} };

for (const outcome of ["painted", "legacy-manifest", "cancelled", "renderer-failed"] as const) {
  test(`supporting record context follows source paint (${outcome})`, async () => {
    const original = globalThis.fetch;
    const requests: string[] = [];
    const stages: string[] = [];
    const controller = new AbortController();
    const errors: unknown[] = [];
    const complete = outcome === "painted" || outcome === "legacy-manifest";
    const shardCount = outcome === "legacy-manifest" ? 128 : 2048;
    clearRuntimeArtifactCache();
    globalThis.fetch = (async (input: any) => {
      const url = new URL(String(input), "https://fixture.invalid");
      const path = url.pathname.replace(/\.gz$/, "");
      requests.push(path);
      let payload: unknown;
      if (path.endsWith("sources.json")) payload = { sources: [{ id: "nist", owner: "Test publisher" }] };
      else if (path.endsWith("catalog-bootstrap.json")) payload = { catalog_bootstrap: { catalogs: [{ id: "nist-800-53", name: "Test catalog" }] } };
      else if (path.endsWith("atlas-neighborhood-manifest.json")) payload = { atlas_neighborhood_manifest: { shard_count: shardCount } };
      else if (path.includes("atlas-neighborhood/")) {
        assert.ok(path.endsWith(`/${atlasNeighborhoodShardId(nodeId, shardCount)}.json`), "the publisher artifact's declared cohort count controls the path");
        assert.ok(url.searchParams.get("v")?.includes("record-cohorts"), "new cohorts cannot reuse the previous cache namespace");
        payload = { atlas_neighborhood_shard: { records: { [nodeId]: { center_node: node, nodes: [], edges: [] } } } };
      }
      else if (path.endsWith("atlas-spine.json")) payload = { atlas_spine: { entries: [{ id: "test-context" }] } };
      else if (path.endsWith("commons-search-index.json")) payload = { resources: [{ id: "test-tool" }] };
      else if (path.endsWith("commons-resource-dataset.json")) payload = { resources: [{ id: "test-tool" }] };
      else assert.fail(`Unexpected request: ${path}`);
      const bytes = Buffer.from(JSON.stringify(payload));
      return new Response(url.pathname.endsWith(".gz") ? gzipSync(bytes) : bytes);
    }) as typeof fetch;
    try {
      await loadRuntimeDatasetStaged({ state: normalizeViewState("library-detail", { node: nodeId }), signal: controller.signal,
        onSearchReady: (bundle) => {
          stages.push("source");
          assert.equal(bundle.runtime.getNode(nodeId).metadata.statement, node.metadata.statement);
          assert.equal(bundle.atlasSpine, undefined);
          assert.equal(bundle.commonsDataset, undefined);
        },
        onRecordRendered: async () => {
          assert.equal(requests.some((path) => /atlas-spine|commons-/.test(path)), false);
          stages.push("paint");
          if (outcome === "cancelled") controller.abort();
          if (outcome === "renderer-failed") throw new Error("Synthetic renderer failure");
        },
        onFullReady: (bundle) => {
          stages.push("context");
          assert.equal(bundle.runtime.getNode(nodeId).metadata.statement, node.metadata.statement);
          assert.ok(bundle.atlasSpine?.entries?.length);
          assert.ok(bundle.commonsDataset);
        },
        onError: (error) => errors.push(error),
      });
      assert.deepEqual(stages, complete ? ["source", "paint", "context"] : ["source", "paint"]);
      assert.equal(requests.some((path) => /atlas-spine|commons-/.test(path)), complete);
      assert.equal(errors.length, outcome === "renderer-failed" ? 1 : 0);
    } finally { globalThis.fetch = original; clearRuntimeArtifactCache(); }
  });
}
