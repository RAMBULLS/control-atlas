import { ATLAS_NEIGHBORHOOD_SHARD_COUNT, atlasNeighborhoodShardId } from "../../app/atlas-neighborhood.mjs";
import { RUNTIME_CACHE_VERSION } from "../../shared/runtime-cache-version.mjs";
import { expandLibrarySearchTransport } from "./librarySearchTransport";
import type { ViewState } from "./viewState";
const CACHE_VERSION = RUNTIME_CACHE_VERSION;
const artifactCache = new Map<string, Promise<unknown>>();
// A cold CDN fetch of a multi-megabyte artifact regularly needs more than four
// seconds, and the uncompressed fallback is strictly larger than the
// compressed file it replaces. The old budgets turned ordinary slow responses
// into "did not load" errors that a manual reload then fixed, because the
// second attempt hit a warm cache. Failing slowly is better than reporting a
// failure that is not real; the surface shows a loading state meanwhile.
const COMPRESSED_ARTIFACT_TIMEOUT_MS = 12_000;
const FALLBACK_ARTIFACT_TIMEOUT_MS = 25_000;
const JSON_WORKER_TIMEOUT_MS = 10_000;

export type RuntimeLoadErrorCode =
  | "artifact_timeout"
  | "artifact_unavailable"
  | "artifact_invalid"
  | "worker_timeout"
  | "worker_failure";

export class RuntimeLoadError extends Error {
  code: RuntimeLoadErrorCode;

  constructor(code: RuntimeLoadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeLoadError";
    this.code = code;
  }
}

export type ArtifactFetchOptions = {
  bypassCache?: boolean;
  compressedTimeoutMs?: number;
  fallbackTimeoutMs?: number;
  preferNativeEncoding?: boolean;
};

export function clearRuntimeArtifactCache(path?: string) {
  if (path) artifactCache.delete(path);
  else artifactCache.clear();
}

async function withDeadline<T>(
  timeoutMs: number,
  code: RuntimeLoadErrorCode,
  task: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = globalThis.setTimeout(() => {
      controller.abort();
      reject(new RuntimeLoadError(code, "The requested data took too long to load."));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([task(controller.signal), timeout]);
    settled = true;
    return value;
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
    // Cancel only when the request did not finish. Aborting unconditionally
    // also fired on the success path, cancelling a body that had already been
    // handed to the JSON worker and logging a spurious ERR_ABORTED.
    if (!settled) {
      controller.abort();
    }
  }
}

export type AtlasNeighborhoodNode = {
  id: string;
  node_type?: string;
  label?: string;
  parent_id?: string;
  source_id?: string;
  ancestor_path?: Array<{
    id: string;
    label: string;
    node_type: string;
    origin: "structural" | "organizing";
  }>;
  display_path?: Array<{
    id: string;
    label: string;
    node_type: string;
    origin: "structural" | "organizing" | "authority";
  }>;
  metadata?: {
    item_id?: string;
    publisher_item_id?: string;
    title?: string;
    description?: string;
    publication_date?: string;
    catalog_id?: string;
    family?: string;
    structural_child_count?: number;
    structural_descendant_record_count?: number;
    identity_category?: string;
    classification_provenance?: "publisher" | "referenced" | "inferred";
    related_categories?: Array<{
      code: string;
      label: string;
      provenance: "referenced" | "inferred";
      source_ref?: { locator?: string; source_id?: string };
    }>;
    check_text?: string;
    fix_text?: string;
    discussion?: string;
    implementation_examples?: string[];
    assessment_objectives?: Array<Record<string, unknown>>;
    assessment_method_details?: Array<Record<string, unknown>>;
    source_text_presentation?: Record<string, {
      version: 1;
      blocks: Array<
        | { kind: "paragraph" | "code"; start: number; end: number; language?: string }
        | { kind: "list"; ordered: boolean; items: Array<{ start: number; end: number }> }
      >;
    }>;
  };
};

export type AtlasNeighborhoodEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  relationship_class: "structural" | "applicability" | "correlation";
  provenance_class: string;
  publication_status: string;
  confidence: string;
  evidence_ids?: string[];
  source_refs?: Array<{
    source_id?: string;
    ref_type?: string;
    locator?: string;
  }>;
  rationale?: string;
  navigation_note?: string;
};

export type AtlasNeighborhoodRecord = {
  center_node: AtlasNeighborhoodNode;
  nodes: AtlasNeighborhoodNode[];
  edges: AtlasNeighborhoodEdge[];
  structural_path: Array<{
    id: string;
    label: string;
    node_type: string;
    origin: "structural" | "organizing" | "authority";
  }>;
  structural_paths?: Array<Array<{
    id: string;
    label: string;
    node_type: string;
    origin: "structural" | "organizing" | "authority";
  }>>;
  published_connection_count: number;
  candidate_connection_count: number;
};

type AtlasNeighborhoodShardRecord = {
  center_node?: Record<string, unknown>;
  nodes: Array<[string, string, string, string, string, string, string, string, string, number, number]>;
  edges: Array<[
    string,
    string,
    string,
    string,
    "structural" | "applicability" | "correlation",
    string,
    string,
    string,
    Array<[string, string, string]>,
  ]>;
  structural_path: string[];
  structural_paths?: string[][];
  published_connection_count: number;
  candidate_connection_count: number;
};

export type RuntimeArtifactPlan = {
  atlasSpine: boolean;
  catalogBootstrap: boolean;
  catalogFamily: string;
  catalogId: string;
  commons: boolean;
  fullGraph: boolean;
  librarySearch: boolean;
  recordNodeId: string;
  registries: boolean;
  sources: boolean;
};

export function runtimeArtifactPlan(
  state: ViewState,
  options: {
    graphRequested?: boolean;
    searchOverlayOpen?: boolean;
    /** The territory sheet asks for record search only when the reader reaches for it. */
    librarySearchRequested?: boolean;
  } = {},
): RuntimeArtifactPlan {
  // Templates now lands directly on the document browser, so every visit needs
  // the small template registries to render the list at all.
  const buildDetailRequested = state.view === "templates";
  // The contextual resource module is secondary material beside a chosen task
  // or document, so its index stays off the arrival path.
  const buildContextRequested =
    state.view === "templates" &&
    (state.buildSection === "tasks" ||
      Boolean(state.task) ||
      Boolean(state.templateType));
  // Compare uses content-addressed pair shards even when a previous view had
  // requested the full graph. That request must never leak across the boundary.
  const fullGraph = state.view !== "matrix" && (
    Boolean(options.graphRequested) ||
    (state.view === "templates" && Boolean(state.templateType))
  );
  // A real record is in focus on the Atlas route — not the landing board and
  // not one of the synthetic structural nodes the drill-down uses.
  const atlasRecordFocused =
    state.view === "atlas-map" &&
    Boolean(state.node) &&
    state.node !== "foundation" &&
    state.node !== "landscape" &&
    !state.node.startsWith("hierarchy:");
  // The territory sheet draws from its own small index. It needs neither the 11 MB relationship
  // network nor the hierarchy spine; a focused record adds only its own neighborhood shard.
  if (state.view === "atlas-map") {
    return { atlasSpine: false, catalogBootstrap: true, catalogId: "", catalogFamily: "",
      commons: Boolean(options.searchOverlayOpen), fullGraph: false, librarySearch: atlasRecordFocused || Boolean(state.atlasResearch) || Boolean(options.librarySearchRequested) || Boolean(options.searchOverlayOpen), recordNodeId: atlasRecordFocused ? state.node : "",
      registries: false, sources: atlasRecordFocused || Boolean(state.atlasResearch) || Boolean(options.searchOverlayOpen) };
  }
  return {
    atlasSpine: state.view === "library-detail",
    catalogBootstrap:
      state.view === "library-detail" ||
      state.view === "catalog-detail" ||
      state.view === "matrix" ||
      state.view === "search" ||
      buildDetailRequested,
    catalogId: state.view === "catalog-detail" ? state.catalog : "",
    catalogFamily:
      state.view === "catalog-detail" ? state.family : "",
    commons:
      state.view === "commons" ||
      state.view === "commons-detail" ||
      state.view === "library-detail" ||
      state.view === "search" ||
      buildContextRequested ||
      Boolean(options.searchOverlayOpen),
    fullGraph,
    librarySearch:
      state.view === "search" ||
      state.view === "retired" ||
      Boolean(options.searchOverlayOpen),
    recordNodeId:
      state.view === "library-detail" || atlasRecordFocused ? state.node : "",
    registries:
      state.view === "search" ||
      buildDetailRequested ||
      Boolean(options.searchOverlayOpen),
    sources:
      state.view === "sources" ||
      state.view === "commons-detail" ||
      state.view === "catalog-detail" ||
      state.view === "library-detail" ||
      state.view === "matrix" ||
      state.view === "search" ||
      // A focused Atlas record shows the publisher's own source link, which
      // needs sources.json. The Atlas board (no focused record) still skips
      // it — the landing and drill-down columns never name a source.
      atlasRecordFocused ||
      buildDetailRequested ||
      Boolean(options.searchOverlayOpen),
  };
}

/**
 * Start route-scoped data requests while the React route modules are still
 * downloading. fetchArtifact owns the shared promise cache, so the staged
 * loader consumes these exact requests instead of starting a second fetch.
 */
export async function preloadRuntimeArtifacts(state: ViewState) {
  const completePlan = runtimeArtifactPlan(state);
  const plan = state.view === "library-detail"
    ? { ...completePlan, atlasSpine: false, commons: false }
    : completePlan;
  const requests: Array<Promise<unknown>> = [];
  const add = (path: string) => requests.push(fetchArtifact(path));
  if (plan.librarySearch || plan.fullGraph) {
    add(artifactPath("library-search.json"));
  }
  if (plan.sources || plan.fullGraph) {
    add(artifactPath("sources.json"));
  }
  if (plan.catalogBootstrap) {
    add(artifactPath("catalog-bootstrap.json"));
  }
  if (plan.atlasSpine) {
    add(artifactPath("atlas-spine.json"));
  }
  // A catalog route first paints from sources + catalog-bootstrap. Its larger
  // record shard starts after that shell is ready instead of competing with
  // the files needed for orientation.
  if (plan.recordNodeId) {
    requests.push(loadAtlasNeighborhood(plan.recordNodeId));
  }
  if (plan.registries) {
    add("./data/template-registry.json");
    add("./data/official-artifact-registry.json");
    add("./data/compliance-workflows.json");
    add("./data/compliance-tool-registry.json");
    add("./data/fedramp-transition-index.json");
  }
  if (plan.commons && state.view !== "library-detail") {
    add("./data/generated/commons-search-index.json");
    add("./data/commons-resource-dataset.json");
  }
  if (plan.fullGraph) {
    add(artifactPath("nodes.json"));
    add(artifactPath("edges.json"));
    add(artifactPath("evidence.json"));
    add(artifactPath("graph-health.json"));
  }

  await Promise.allSettled(requests);
}

export async function fetchArtifact(path: string, options: ArtifactFetchOptions = {}) {
  const cached = options.bypassCache ? undefined : artifactCache.get(path);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    // Only a rejected compressed fetch used to take the whole artifact down
    // with it: the .then() never ran, so the uncompressed fallback never got
    // its turn. Under load that intermittently left Resources reporting an
    // empty directory. Any failure of the compressed path now falls through.
    // Search payloads are intentionally handled off the main thread. The
    // columnar index avoids eager record expansion, and this keeps parsing its
    // bounded chunks from delaying route paint.
    const parseOffThread = path.includes("library-search");
    if (!options.preferNativeEncoding) {
      try {
        return await withDeadline(
          options.compressedTimeoutMs ?? COMPRESSED_ARTIFACT_TIMEOUT_MS,
          "artifact_timeout",
          async (signal) => {
            const response = await fetch(compressedArtifactPath(path), { signal });
            if (!response.ok || typeof DecompressionStream === "undefined" || !response.body) {
              throw new RuntimeLoadError("artifact_unavailable", "The compressed data is unavailable.");
            }
            const ds = new DecompressionStream("gzip");
            const decompressedStream = response.body.pipeThrough(ds);
            const decompressedResponse = new Response(decompressedStream);
            return parseOffThread
              ? await parseJsonResponseOffThread(decompressedResponse)
              : await decompressedResponse.json();
          },
        );
      } catch {
        // Compressed fetch or decompression failed; use the uncompressed file.
      }
    }
    try {
      return await withDeadline(
        options.fallbackTimeoutMs ?? FALLBACK_ARTIFACT_TIMEOUT_MS,
        "artifact_timeout",
        async (signal) => {
          const fallbackResponse = await fetch(path, { signal });
          if (!fallbackResponse.ok) {
            throw new RuntimeLoadError(
              "artifact_unavailable",
              "The requested public data is unavailable.",
            );
          }
          try {
            return parseOffThread
              ? await parseJsonResponseOffThread(fallbackResponse)
              : await fallbackResponse.json();
          } catch (error) {
            if (error instanceof RuntimeLoadError) throw error;
            throw new RuntimeLoadError(
              "artifact_invalid",
              "The requested public data could not be read.",
              { cause: error },
            );
          }
        },
      );
    } catch (error) {
      if (error instanceof RuntimeLoadError) throw error;
      throw new RuntimeLoadError(
        "artifact_unavailable",
        "The requested public data is unavailable.",
        { cause: error },
      );
    }
  })();
  artifactCache.set(path, request);

  try {
    return await request;
  } catch (error) {
    artifactCache.delete(path);
    throw error;
  }
}

export async function parseJsonResponseOffThread(
  response: Response,
  timeoutMs = JSON_WORKER_TIMEOUT_MS,
) {
  const bytes = await response.arrayBuffer();
  if (typeof Worker === "undefined") {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const worker = new Worker(
    new URL("../workers/jsonParseWorker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new RuntimeLoadError(
        "worker_timeout",
        "The search index took too long to prepare.",
      )));
    }, timeoutMs);
    worker.addEventListener("message", async (event: MessageEvent<
      | { ok: true; value: unknown }
      | { message: string; ok: false }
    >) => {
      const result = event.data;
      if (result.ok === true) {
        try {
          const value = await expandLibrarySearchTransport(result.value);
          finish(() => resolve(value));
        } catch (error) {
          finish(() => reject(new RuntimeLoadError(
            "worker_failure",
            "The search index could not be prepared.",
            { cause: error },
          )));
        }
      } else {
        finish(() => reject(new RuntimeLoadError(
          "worker_failure",
          (result as { message: string; ok: false }).message
            || "The search index could not be prepared.",
        )));
      }
    }, { once: true });
    worker.addEventListener("error", (event) => {
      finish(() => reject(new RuntimeLoadError(
        "worker_failure",
        event.message || "The search index could not be prepared.",
      )));
    }, { once: true });
    worker.addEventListener("messageerror", () => {
      finish(() => reject(new RuntimeLoadError(
        "worker_failure",
        "The search index returned an unreadable response.",
      )));
    }, { once: true });
    worker.postMessage({ bytes }, [bytes]);
  });
}

export function compressedArtifactPath(path: string) {
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) {
    return `${path}.gz`;
  }
  return `${path.slice(0, queryIndex)}.gz${path.slice(queryIndex)}`;
}

export function artifactPath(name: string) {
  return `./data/generated/${name}?v=${CACHE_VERSION}`;
}

export async function loadAtlasNeighborhood(
  nodeId: string,
): Promise<AtlasNeighborhoodRecord | null> {
  const manifestArtifact = (await fetchArtifact(
    artifactPath("atlas-neighborhood-manifest.json"),
  )) as { atlas_neighborhood_manifest?: { shard_count?: number } };
  const shardCount =
    manifestArtifact.atlas_neighborhood_manifest?.shard_count || ATLAS_NEIGHBORHOOD_SHARD_COUNT;
  const shardId = atlasNeighborhoodShardId(nodeId, shardCount);
  const shardArtifact = (await fetchArtifact(
    artifactPath(`atlas-neighborhood/${shardId}.json`),
  )) as {
    atlas_neighborhood_shard?: {
      records?: Record<string, AtlasNeighborhoodShardRecord>;
    };
  };
  const shardRecord =
    shardArtifact.atlas_neighborhood_shard?.records?.[nodeId] || null;
  if (!shardRecord) return null;
  const nodeById = new Map<string, AtlasNeighborhoodNode>(
    (shardRecord.nodes || []).map(
      ([
        id,
        nodeType,
        itemId,
        title,
        catalogId,
        sourceId,
        family,
        parentId,
        description,
        structuralChildCount,
        structuralDescendantRecordCount,
      ]) => [
        id,
        {
          id,
          node_type: nodeType,
          source_id: sourceId,
          parent_id: parentId || undefined,
          metadata: {
            item_id: itemId,
            title,
            description,
            catalog_id: catalogId,
            family,
            structural_child_count: structuralChildCount,
            structural_descendant_record_count: structuralDescendantRecordCount,
          },
        } satisfies AtlasNeighborhoodNode,
      ],
    ),
  );
  const centerNode =
    (shardRecord.center_node as AtlasNeighborhoodNode | undefined) ||
    nodeById.get(nodeId);
  if (!centerNode) return null;
  const counterpartIds = new Set<string>();
  const edges = shardRecord.edges.map((compactEdge) => {
    const [
      id,
      sourceNodeId,
      targetNodeId,
      relationshipType,
      relationshipClass,
      provenanceClass,
      publicationStatus,
      confidence,
      compactSourceRefs,
    ] = compactEdge;
    const edge: AtlasNeighborhoodEdge = {
      id,
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      relationship_type: relationshipType,
      relationship_class: relationshipClass,
      provenance_class: provenanceClass,
      publication_status: publicationStatus,
      confidence,
      source_refs: compactSourceRefs.map(
        ([sourceId, refType, locator]) => ({
          source_id: sourceId,
          ref_type: refType,
          locator,
        }),
      ),
    };
    counterpartIds.add(
      edge.source_node_id === nodeId
        ? edge.target_node_id
        : edge.source_node_id,
    );
    return edge;
  });
  const decodeStructuralPath = (path: string[]) => path.flatMap((id) => {
    const node = nodeById.get(id);
    if (!node) return [];
    const origin =
      node.node_type === "statute" ||
      node.node_type === "regulation" ||
      node.node_type === "policy_directive"
        ? "authority"
        : node.node_type === "trunk" || node.node_type === "limb"
          ? "organizing"
          : "structural";
    return [{
      id,
      label: node.metadata?.title || id,
      node_type: node.node_type || "",
      origin,
    }];
  }) satisfies AtlasNeighborhoodRecord["structural_path"];
  const structuralPath = decodeStructuralPath(shardRecord.structural_path || []);
  const structuralPaths = (shardRecord.structural_paths?.length
    ? shardRecord.structural_paths
    : [shardRecord.structural_path || []])
    .map(decodeStructuralPath)
    .filter((path) => path.length > 0);
  centerNode.display_path = structuralPath.slice(0, -1);
  const nodes = [
    centerNode,
    ...[...counterpartIds]
      .flatMap((id) => {
        const node = nodeById.get(id);
        return node ? [node] : [];
      }),
  ];
  return {
    center_node: centerNode,
    nodes,
    edges,
    // Trunk/limb hops in this chain are Control Atlas's own organizing
    // scaffold (applyOrganizingSpine in build-framework-data.mjs), never
    // publisher-declared containment — every other hop (catalog/family/...)
    // is genuine structural parentage. The shard only stores bare ids here,
    // so origin is derived from node_type rather than carried from the
    // build-time ancestor_path (which isn't present on shard nodes).
    structural_path: structuralPath,
    structural_paths: structuralPaths,
    published_connection_count: shardRecord.published_connection_count,
    candidate_connection_count: shardRecord.candidate_connection_count,
  };
}
