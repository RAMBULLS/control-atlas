import { createFederalGraphRuntime } from "../../app/runtime.mjs";
import { atlasSurfaceFor } from "./atlasTerritoryState";
import { atlasNeighborhoodShardId } from "../../app/atlas-neighborhood.mjs";
import { RUNTIME_CACHE_VERSION } from "../../shared/runtime-cache-version.mjs";
import type {
  CommonsResourceDataset,
  CommonsSearchIndex,
} from "./commonsTypes";
import type { ViewState } from "./viewState";
import type { AtlasSpine } from "./atlasDrilldown";
import type { AtlasSemanticProjectionArtifact } from "./atlasGraphProjection";
import { expandLibrarySearchTransport } from "./librarySearchTransport";

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

async function optionalArtifact<T>(path: string, fallback: T): Promise<T> {
  try {
    return (await fetchArtifact(path)) as T;
  } catch (error) {
    console.warn(`Optional Control Atlas data did not load: ${path}`, error);
    return fallback;
  }
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

export type TemplateRegistry = {
  templates?: Array<Record<string, unknown>>;
};

export type OfficialArtifactRegistry = {
  retrieved_on?: string;
  compatibility_levels?: string[];
  artifacts?: Array<Record<string, unknown>>;
};

export type ComplianceWorkflowRegistry = {
  retrieved_on?: string;
  workflows?: Array<Record<string, unknown>>;
};

export type ComplianceToolRegistry = {
  retrieved_on?: string;
  tools?: Array<Record<string, unknown>>;
};

export type FedrampTransitionIndex = {
  retrieved_on?: string;
  source?: Record<string, unknown>;
  interpretation_notice?: string;
  official_links?: Record<string, string>;
  milestones?: Array<Record<string, unknown>>;
  process_statuses?: Array<Record<string, unknown>>;
  current_artifact_rules?: Record<string, string[]>;
  legacy_mappings?: Array<Record<string, unknown>>;
  resolved_rules?: Array<Record<string, unknown>>;
  legacy_assets?: Array<Record<string, unknown>>;
};

export type LibrarySearchArtifact = {
  document_count?: number;
  facets?: {
    objectTypes: string[];
    publishers: string[];
    sourceClasses: string[];
    controlFamilies: string[];
    severities: string[];
  };
  browse_counts?: {
    object_types?: Record<string, number>;
    tags?: Record<string, number>;
  };
  indexed_transport?: {
    columns: unknown[][];
    fields: string[];
    format: "columns-v1";
  };
  documents: Array<Record<string, unknown>>;
};

export type AtlasNetworkArtifact = AtlasSemanticProjectionArtifact;

export type RuntimeBundle = {
  runtime: ReturnType<typeof createFederalGraphRuntime>;
  templateRegistry: TemplateRegistry;
  atlasNetwork?: AtlasNetworkArtifact;
  atlasSpine?: AtlasSpine;
  catalogSummaries?: Array<Record<string, any>>;
  catalogPublishedGroups?: Array<{
    name: string;
    path: string;
    record_count: number;
  }>;
  catalogRecordsReady?: boolean;
  officialArtifactRegistry?: OfficialArtifactRegistry;
  complianceWorkflowRegistry?: ComplianceWorkflowRegistry;
  complianceToolRegistry?: ComplianceToolRegistry;
  fedrampTransitionIndex?: FedrampTransitionIndex;
  commonsSearchIndex?: CommonsSearchIndex;
  commonsDataset?: CommonsResourceDataset;
  mappingSources?: Record<string, Array<{ value: string; label: string }>>;
  librarySearchReady: boolean;
  routeReady: boolean;
  graphReady: boolean;
};

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

type LibrarySearchBootstrap = {
  librarySearch: LibrarySearchArtifact;
};

export type RuntimeArtifactPlan = {
  atlasNetwork: boolean;
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

function isAtlasOrientationState(state: ViewState) {
  return (
    state.view === "atlas-map" &&
    atlasSurfaceFor(state) === "classic" &&
    !state.node &&
    (!state.atlasAxis ||
      (state.atlasAxis === "landscape" && !state.atlasFramework))
  );
}

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
  const fullGraph =
    Boolean(options.graphRequested) ||
    // Atlas area, publication, and native-group choices render from the compact
    // Atlas spine. Baseline and RMF choices still need the full graph; a focused
    // record uses one neighborhood shard. Keep this in step with
    // requiresFullGraph in navigationState.ts.
    (state.view === "atlas-map" &&
      !state.node &&
      Boolean(
        state.atlasBaseline ||
          state.atlasRmfStep ||
          state.sourceView === "rmf" ||
          state.relationshipView === "rmf",
      )) ||
    (state.view === "matrix" &&
      (state.compareRun === "true" ||
        (state.intent === "item-mapping" &&
          Boolean(state.source) &&
          Boolean(state.items)))) ||
    (state.view === "templates" && Boolean(state.templateType));
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
  if (state.view === "atlas-map" && atlasSurfaceFor(state) === "territory") {
    return { atlasNetwork: false, atlasSpine: false, catalogBootstrap: true, catalogId: "", catalogFamily: "",
      commons: false, fullGraph: false, librarySearch: atlasRecordFocused || Boolean(state.atlasResearch) || Boolean(options.librarySearchRequested) || Boolean(options.searchOverlayOpen), recordNodeId: atlasRecordFocused ? state.node : "",
      registries: false, sources: atlasRecordFocused || Boolean(state.atlasResearch) };
  }
  return {
    atlasNetwork: state.view === "atlas-map",
    atlasSpine: state.view === "atlas-map" || state.view === "library-detail",
    catalogBootstrap:
      state.view === "atlas-map" ||
      state.view === "library-detail" ||
      state.view === "catalog-detail" ||
      state.view === "matrix" ||
      state.view === "search" ||
      buildDetailRequested,
    catalogId:
      state.view === "catalog-detail"
        ? state.catalog
        : state.view === "atlas-map"
          ? state.atlasFramework
          : "",
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
      state.view === "atlas-map" ||
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
  const plan = runtimeArtifactPlan(state);
  const requests: Array<Promise<unknown>> = [];
  const add = (path: string) => requests.push(fetchArtifact(path));
  const atlasLanding = isAtlasOrientationState(state);

  if ((plan.librarySearch && !atlasLanding) || plan.fullGraph) {
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
  if (plan.atlasNetwork) {
    add(artifactPath("atlas-network.json"));
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

async function fetchCollection(path: string, key: string) {
  const artifact = await fetchArtifact(path);
  if (artifact.schema_version !== "1.0" || !Array.isArray(artifact[key])) {
    throw new Error(`Invalid ${key} graph artifact.`);
  }
  const shards = artifact.sharded_collection?.shards;
  if (Array.isArray(shards)) {
    const chunks = await Promise.all(
      shards.map((shard: { path?: string }) => {
        if (!shard.path) throw new Error(`Invalid ${key} graph shard.`);
        return fetchArtifact(artifactPath(shard.path));
      }),
    );
    return chunks.flatMap((chunk) => {
      if (!Array.isArray(chunk[key])) {
        throw new Error(`Invalid ${key} graph shard.`);
      }
      return chunk[key];
    });
  }
  return artifact[key];
}

function artifactPath(name: string) {
  return `./data/generated/${name}?v=${CACHE_VERSION}`;
}

/**
 * The half of the Atlas projection the landing does not need.
 *
 * `details` and `record_locations` are 21MB of the artifact's 30MB and answer
 * only a drilldown or an exact record search. Fetching them with the board put
 * 3.4MB on the wire to draw five cards, on the route the product now opens on.
 * The board loads without them and this fills them in behind it.
 */
export type AtlasNetworkDetails = Pick<
  AtlasNetworkArtifact,
  "details" | "record_locations"
>;

let atlasNetworkDetailsRequest: Promise<AtlasNetworkDetails> | null = null;

export function loadAtlasNetworkDetails(): Promise<AtlasNetworkDetails> {
  if (!atlasNetworkDetailsRequest) {
    atlasNetworkDetailsRequest = fetchArtifact(
      artifactPath("atlas-network-details.json"),
    ).then((artifact) => {
      const loaded = artifact as Partial<AtlasNetworkDetails> | null;
      return {
        details: loaded?.details || {},
        record_locations: loaded?.record_locations || {},
      } as AtlasNetworkDetails;
    }).catch((error) => {
      // Let a later drilldown ask again rather than caching the failure.
      atlasNetworkDetailsRequest = null;
      throw error;
    });
  }
  return atlasNetworkDetailsRequest;
}

export async function loadAtlasNeighborhood(
  nodeId: string,
): Promise<AtlasNeighborhoodRecord | null> {
  const manifestArtifact = (await fetchArtifact(
    artifactPath("atlas-neighborhood-manifest.json"),
  )) as { atlas_neighborhood_manifest?: { shard_count?: number } };
  const shardCount =
    manifestArtifact.atlas_neighborhood_manifest?.shard_count || 128;
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

export function selectAtlasStructuralPath(
  record: AtlasNeighborhoodRecord,
  branchContext: string,
): AtlasNeighborhoodRecord {
  const selected = branchContext
    ? record.structural_paths?.find((path) => path.some((hop) => hop.id === branchContext))
    : null;
  const structuralPath = selected || record.structural_path;
  if (structuralPath === record.structural_path) return record;
  return {
    ...record,
    center_node: {
      ...record.center_node,
      display_path: structuralPath.slice(0, -1),
    },
    structural_path: structuralPath,
  };
}

type LibrarySearchIndexChunk = {
  library_search_index?: { columns?: unknown[][]; format?: string };
};

export async function loadIndexedLibrarySearchColumns(
  fields: string[],
  shards: Array<{ path?: string }>,
  loadChunk: (path: string) => Promise<LibrarySearchIndexChunk>,
  fallbackColumns: unknown[][],
): Promise<unknown[][]> {
  if (!shards.length) return fallbackColumns;
  const chunks = await Promise.all(shards.map(async (shard) => {
    if (!shard.path) throw new Error("Invalid library search index shard.");
    const chunk = await loadChunk(shard.path);
    if (chunk.library_search_index?.format !== "columns-v1" || !Array.isArray(chunk.library_search_index.columns)) {
      throw new Error("Invalid library search index shard.");
    }
    return chunk.library_search_index.columns;
  }));
  return fields.map((_, fieldIndex) =>
    chunks.flatMap((columns) => columns[fieldIndex] || []),
  );
}

async function loadLibrarySearchBootstrap(): Promise<LibrarySearchBootstrap> {
  try {
    const [artifact, indexArtifact] = await Promise.all([
      fetchArtifact(artifactPath("library-search.json")),
      fetchArtifact(artifactPath("library-search-index.json"), {
        // Browser-native HTTP decoding is substantially cheaper than
        // DecompressionStream for this multi-megabyte columnar index.
        fallbackTimeoutMs: 20_000,
        preferNativeEncoding: true,
      }),
    ]) as [{
      library_search: LibrarySearchArtifact;
    }, {
      library_search_index?: {
        columns?: unknown[][];
        fields?: string[];
        format?: string;
      };
      sharded_collection?: {
        shards?: Array<{ path?: string }>;
      };
    }];
    const index = indexArtifact.library_search_index;
    if (index?.format !== "columns-v1" || !Array.isArray(index.columns) || !Array.isArray(index.fields)) {
      throw new Error("Invalid library search index.");
    }
    const indexColumns = await loadIndexedLibrarySearchColumns(
      index.fields,
      indexArtifact.sharded_collection?.shards || [],
      (path) => fetchArtifact(artifactPath(path), {
        fallbackTimeoutMs: 20_000,
        preferNativeEncoding: true,
      }) as Promise<LibrarySearchIndexChunk>,
      index.columns,
    );
    return {
      librarySearch: {
        ...artifact.library_search,
        documents: artifact.library_search.documents || [],
        indexed_transport: {
          columns: indexColumns,
          fields: index.fields,
          format: "columns-v1",
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load the library search artifact: ${message}`, {
      cause: error,
    });
  }
}

function createSearchRuntime(libraryBootstrap: LibrarySearchBootstrap) {
  const runtime = createFederalGraphRuntime({
    sources: [],
    nodes: [],
    edges: [],
    evidence: [],
    findings: [],
    librarySearch: libraryBootstrap.librarySearch,
  });
  return runtime;
}

export async function loadLibrarySearchPhase(): Promise<RuntimeBundle> {
  const [
    libraryBootstrap,
    templateRegistryRaw,
    officialArtifactRegistryRaw,
    complianceWorkflowRegistryRaw,
    complianceToolRegistryRaw,
    fedrampTransitionIndexRaw,
    commonsSearchIndexRaw,
    commonsDatasetRaw,
  ] = await Promise.all([
    loadLibrarySearchBootstrap(),
    optionalArtifact<TemplateRegistry>("./data/template-registry.json", { templates: [] }),
    optionalArtifact<OfficialArtifactRegistry>("./data/official-artifact-registry.json", { artifacts: [] }),
    optionalArtifact<ComplianceWorkflowRegistry>("./data/compliance-workflows.json", { workflows: [] }),
    optionalArtifact<ComplianceToolRegistry>("./data/compliance-tool-registry.json", { tools: [] }),
    optionalArtifact<FedrampTransitionIndex>("./data/fedramp-transition-index.json", {}),
    optionalArtifact<CommonsSearchIndex | null>("./data/generated/commons-search-index.json", null),
    optionalArtifact<CommonsResourceDataset | null>("./data/commons-resource-dataset.json", null),
  ]);
  const templateRegistry = templateRegistryRaw as TemplateRegistry;
  const runtime = createSearchRuntime(libraryBootstrap);

  return {
    runtime,
    templateRegistry,
    officialArtifactRegistry:
      officialArtifactRegistryRaw as OfficialArtifactRegistry,
    complianceWorkflowRegistry:
      complianceWorkflowRegistryRaw as ComplianceWorkflowRegistry,
    complianceToolRegistry: complianceToolRegistryRaw as ComplianceToolRegistry,
    fedrampTransitionIndex:
      fedrampTransitionIndexRaw as FedrampTransitionIndex,
    commonsSearchIndex: (commonsSearchIndexRaw as CommonsSearchIndex) || undefined,
    commonsDataset: (commonsDatasetRaw as CommonsResourceDataset) || undefined,
    librarySearchReady: true,
    routeReady: true,
    graphReady: false,
  };
}

export async function loadFullGraphPhase(
  libraryBootstrap: LibrarySearchBootstrap,
  templateRegistry: TemplateRegistry,
  officialArtifactRegistry: OfficialArtifactRegistry,
  complianceWorkflowRegistry: ComplianceWorkflowRegistry,
  complianceToolRegistry: ComplianceToolRegistry,
  fedrampTransitionIndex: FedrampTransitionIndex,
  commonsSearchIndex?: CommonsSearchIndex,
  commonsDataset?: CommonsResourceDataset,
  catalogSummaries: Array<Record<string, any>> = [],
  mappingSources: Record<string, Array<{ value: string; label: string }>> = {},
  atlasNetwork?: AtlasNetworkArtifact,
  atlasSpine?: AtlasSpine,
): Promise<RuntimeBundle> {
  const [sources, nodes, edges, evidence, findings] = await Promise.all([
    fetchCollection(artifactPath("sources.json"), "sources"),
    fetchCollection(artifactPath("nodes.json"), "nodes"),
    fetchCollection(artifactPath("edges.json"), "edges"),
    fetchCollection(artifactPath("evidence.json"), "evidence"),
    fetchCollection(artifactPath("graph-health.json"), "findings"),
  ]);

  const runtime = createFederalGraphRuntime({
    sources,
    nodes,
    edges,
    evidence,
    findings,
    librarySearch: libraryBootstrap.librarySearch,
  });

  return {
    runtime,
    templateRegistry,
    officialArtifactRegistry,
    complianceWorkflowRegistry,
    complianceToolRegistry,
    fedrampTransitionIndex,
    commonsSearchIndex,
    commonsDataset,
    catalogSummaries,
    mappingSources,
    atlasNetwork,
    atlasSpine,
    librarySearchReady: true,
    routeReady: true,
    graphReady: true,
  };
}

export async function loadRuntimeDataset(): Promise<RuntimeBundle> {
  const [
    libraryBootstrap,
    templateRegistryRaw,
    officialArtifactRegistryRaw,
    complianceWorkflowRegistryRaw,
    complianceToolRegistryRaw,
    fedrampTransitionIndexRaw,
    commonsSearchIndexRaw,
    commonsDatasetRaw,
  ] = await Promise.all([
    loadLibrarySearchBootstrap(),
    optionalArtifact<TemplateRegistry>("./data/template-registry.json", { templates: [] }),
    optionalArtifact<OfficialArtifactRegistry>("./data/official-artifact-registry.json", { artifacts: [] }),
    optionalArtifact<ComplianceWorkflowRegistry>("./data/compliance-workflows.json", { workflows: [] }),
    optionalArtifact<ComplianceToolRegistry>("./data/compliance-tool-registry.json", { tools: [] }),
    optionalArtifact<FedrampTransitionIndex>("./data/fedramp-transition-index.json", {}),
    optionalArtifact<CommonsSearchIndex | null>("./data/generated/commons-search-index.json", null),
    optionalArtifact<CommonsResourceDataset | null>("./data/commons-resource-dataset.json", null),
  ]);

  return loadFullGraphPhase(
    libraryBootstrap,
    templateRegistryRaw as TemplateRegistry,
    officialArtifactRegistryRaw as OfficialArtifactRegistry,
    complianceWorkflowRegistryRaw as ComplianceWorkflowRegistry,
    complianceToolRegistryRaw as ComplianceToolRegistry,
    fedrampTransitionIndexRaw as FedrampTransitionIndex,
    (commonsSearchIndexRaw as CommonsSearchIndex) || undefined,
    (commonsDatasetRaw as CommonsResourceDataset) || undefined,
  );
}

type CatalogBootstrap = {
  catalogs?: Array<Record<string, unknown>>;
  mapping_sources?: Record<
    string,
    Array<{ value: string; label: string }>
  >;
};

type AtlasSpineArtifact = {
  atlas_spine?: AtlasSpine;
};

function emptyLibraryBootstrap(): LibrarySearchBootstrap {
  return {
    librarySearch: {
      document_count: 0,
      documents: [],
    },
  };
}

function libraryFromNodes(nodes: Array<Record<string, any>>): LibrarySearchArtifact {
  return {
    document_count: nodes.length,
    documents: nodes.map((node) => ({
      id: node.id,
      item_id: node.metadata?.item_id || node.id,
      title: node.metadata?.title || node.label || node.id,
      description: node.metadata?.description || "",
      description_available: Boolean(node.metadata?.description),
      object_type: node.node_type || "",
      source_id: node.source_id || "",
      catalog_id: node.metadata?.catalog_id || "",
      control_family: node.metadata?.family || "",
      severity: node.metadata?.severity || "",
    })),
  };
}

async function loadRouteScopedPhase(
  plan: RuntimeArtifactPlan,
): Promise<{
  bundle: RuntimeBundle;
  libraryBootstrap: LibrarySearchBootstrap;
  templateRegistry: TemplateRegistry;
  officialArtifactRegistry: OfficialArtifactRegistry;
  complianceWorkflowRegistry: ComplianceWorkflowRegistry;
  complianceToolRegistry: ComplianceToolRegistry;
  fedrampTransitionIndex: FedrampTransitionIndex;
}> {
  const [
    libraryBootstrap,
    sourcesArtifact,
    catalogArtifact,
    atlasNetworkArtifact,
    atlasSpineArtifact,
    catalogRecordsArtifact,
    record,
    templateRegistryRaw,
    officialArtifactRegistryRaw,
    complianceWorkflowRegistryRaw,
    complianceToolRegistryRaw,
    fedrampTransitionIndexRaw,
    commonsSearchIndexRaw,
    commonsDatasetRaw,
  ] = await Promise.all([
    plan.librarySearch
      ? loadLibrarySearchBootstrap()
      : Promise.resolve(emptyLibraryBootstrap()),
    plan.sources || plan.fullGraph
      ? fetchArtifact(artifactPath("sources.json"))
      : Promise.resolve(null),
    plan.catalogBootstrap
      ? fetchArtifact(artifactPath("catalog-bootstrap.json"))
      : Promise.resolve(null),
    plan.atlasNetwork
      ? fetchArtifact(artifactPath("atlas-network.json"))
      : Promise.resolve(null),
    plan.atlasSpine
      ? fetchArtifact(artifactPath("atlas-spine.json"))
      : Promise.resolve(null),
    plan.catalogId
      ? fetchArtifact(
          artifactPath(`catalog-records/${encodeURIComponent(plan.catalogId)}.json`),
        )
      : Promise.resolve(null),
    plan.recordNodeId
      ? loadAtlasNeighborhood(plan.recordNodeId)
      : Promise.resolve(null),
    plan.registries
      ? optionalArtifact<TemplateRegistry>("./data/template-registry.json", { templates: [] })
      : Promise.resolve({ templates: [] }),
    plan.registries
      ? optionalArtifact<OfficialArtifactRegistry>("./data/official-artifact-registry.json", { artifacts: [] })
      : Promise.resolve({ artifacts: [] }),
    plan.registries
      ? optionalArtifact<ComplianceWorkflowRegistry>("./data/compliance-workflows.json", { workflows: [] })
      : Promise.resolve({ workflows: [] }),
    plan.registries
      ? optionalArtifact<ComplianceToolRegistry>("./data/compliance-tool-registry.json", { tools: [] })
      : Promise.resolve({ tools: [] }),
    plan.registries
      ? optionalArtifact<FedrampTransitionIndex>("./data/fedramp-transition-index.json", {})
      : Promise.resolve({}),
    plan.commons
      ? optionalArtifact<CommonsSearchIndex | null>("./data/generated/commons-search-index.json", null)
      : Promise.resolve(null),
    plan.commons
      ? optionalArtifact<CommonsResourceDataset | null>("./data/commons-resource-dataset.json", null)
      : Promise.resolve(null),
  ]);

  const sources =
    (sourcesArtifact as { sources?: Array<Record<string, unknown>> } | null)
      ?.sources || [];
  const catalogBootstrap =
    (
      catalogArtifact as
        | { catalog_bootstrap?: CatalogBootstrap }
        | null
    )?.catalog_bootstrap || {};
  const atlasSpine = (atlasSpineArtifact as AtlasSpineArtifact | null)
    ?.atlas_spine;
  const atlasNetwork = atlasNetworkArtifact as AtlasNetworkArtifact | null;
  if (plan.atlasSpine && !atlasSpine?.entries?.length) {
    throw new Error("Atlas spine artifact has no entries.");
  }
  if (plan.atlasNetwork && !atlasNetwork?.landscape?.nodes?.length) {
    throw new Error("Atlas semantic projection artifact has no landscape landmarks.");
  }
  const catalogRecords =
    (
      catalogRecordsArtifact as
        | {
            catalog_records?: {
              nodes?: Array<Record<string, any>>;
              published_groups?: Array<{
                name: string;
                path: string;
                record_count: number;
              }>;
              sharded_by?: string;
            };
          }
        | null
    )?.catalog_records;
  const catalogPublishedGroups = catalogRecords?.published_groups || [];
  const selectedPublishedGroup = catalogPublishedGroups.find(
    (group) => group.name === plan.catalogFamily,
  );
  const selectedCatalogRecordsArtifact = selectedPublishedGroup
    ? ((await fetchArtifact(
        artifactPath(`catalog-records/${selectedPublishedGroup.path}`),
      )) as { catalog_records?: { nodes?: Array<Record<string, any>> } })
    : null;
  const catalogNodes =
    selectedCatalogRecordsArtifact?.catalog_records?.nodes ||
    catalogRecords?.nodes ||
    [];
  const recordNodes = record?.nodes || [];
  const nodes = catalogNodes.length
    ? catalogNodes
    : recordNodes;
  const edges = record?.edges || [];
  const effectiveLibrary =
    plan.librarySearch || !nodes.length
      ? libraryBootstrap
      : { librarySearch: libraryFromNodes(nodes) };
  const runtime = createFederalGraphRuntime({
    sources,
    nodes,
    edges,
    evidence: [],
    findings: [],
    catalogs: catalogBootstrap.catalogs || [],
    librarySearch: effectiveLibrary.librarySearch,
  });
  const templateRegistry = templateRegistryRaw as TemplateRegistry;
  const officialArtifactRegistry =
    officialArtifactRegistryRaw as OfficialArtifactRegistry;
  const complianceWorkflowRegistry =
    complianceWorkflowRegistryRaw as ComplianceWorkflowRegistry;
  const complianceToolRegistry =
    complianceToolRegistryRaw as ComplianceToolRegistry;
  const fedrampTransitionIndex =
    fedrampTransitionIndexRaw as FedrampTransitionIndex;

  return {
    bundle: {
      runtime,
      templateRegistry,
      officialArtifactRegistry,
      complianceWorkflowRegistry,
      complianceToolRegistry,
      fedrampTransitionIndex,
      commonsSearchIndex:
        (commonsSearchIndexRaw as CommonsSearchIndex) || undefined,
      commonsDataset:
        (commonsDatasetRaw as CommonsResourceDataset) || undefined,
      mappingSources: catalogBootstrap.mapping_sources || {},
      catalogSummaries: catalogBootstrap.catalogs || [],
      atlasNetwork: atlasNetwork || undefined,
      atlasSpine,
      catalogPublishedGroups,
      catalogRecordsReady: plan.catalogId ? true : undefined,
      librarySearchReady: plan.librarySearch,
      routeReady: true,
      graphReady: false,
    },
    libraryBootstrap: effectiveLibrary,
    templateRegistry,
    officialArtifactRegistry,
    complianceWorkflowRegistry,
    complianceToolRegistry,
    fedrampTransitionIndex,
  };
}

async function loadCatalogShellPhase(
  plan: RuntimeArtifactPlan,
): Promise<RuntimeBundle> {
  const [sourcesArtifact, catalogArtifact, atlasNetworkArtifact, atlasSpineArtifact] = await Promise.all([
    fetchArtifact(artifactPath("sources.json")),
    fetchArtifact(artifactPath("catalog-bootstrap.json")),
    plan.atlasNetwork
      ? fetchArtifact(artifactPath("atlas-network.json"))
      : Promise.resolve(null),
    plan.atlasSpine
      ? fetchArtifact(artifactPath("atlas-spine.json"))
      : Promise.resolve(null),
  ]);
  const sources =
    (sourcesArtifact as { sources?: Array<Record<string, unknown>> }).sources ||
    [];
  const catalogBootstrap =
    (
      catalogArtifact as {
        catalog_bootstrap?: CatalogBootstrap;
      }
    ).catalog_bootstrap || {};
  const atlasSpine = (atlasSpineArtifact as AtlasSpineArtifact | null)
    ?.atlas_spine;
  const atlasNetwork = atlasNetworkArtifact as AtlasNetworkArtifact | null;
  if (plan.atlasSpine && !atlasSpine?.entries?.length) {
    throw new Error("Atlas spine artifact has no entries.");
  }
  if (plan.atlasNetwork && !atlasNetwork?.landscape?.nodes?.length) {
    throw new Error("Atlas semantic projection artifact has no landscape landmarks.");
  }

  return {
    runtime: createFederalGraphRuntime({
      sources,
      nodes: [],
      edges: [],
      evidence: [],
    }),
    templateRegistry: { templates: [] },
    mappingSources: catalogBootstrap.mapping_sources || {},
    catalogSummaries: catalogBootstrap.catalogs || [],
    atlasNetwork: atlasNetwork || undefined,
    atlasSpine,
    catalogRecordsReady: false,
    librarySearchReady: false,
    routeReady: true,
    graphReady: false,
  };
}

export async function loadRuntimeDatasetStaged(handlers: {
  onSearchReady: (bundle: RuntimeBundle) => void;
  onFullReady: (bundle: RuntimeBundle) => void;
  onError: (error: unknown) => void;
  state: ViewState;
  graphRequested?: boolean;
  searchOverlayOpen?: boolean;
  librarySearchRequested?: boolean;
  signal?: AbortSignal;
}) {
  try {
    if (handlers.signal?.aborted) return;
    const plan = runtimeArtifactPlan(handlers.state, {
      graphRequested: handlers.graphRequested,
      searchOverlayOpen: handlers.searchOverlayOpen,
      librarySearchRequested: handlers.librarySearchRequested,
    });
    if (plan.catalogId) {
      handlers.onSearchReady(await loadCatalogShellPhase(plan));
      if (handlers.signal?.aborted) return;
      const catalogPhase = await loadRouteScopedPhase(plan);
      if (handlers.signal?.aborted) return;
      handlers.onFullReady(catalogPhase.bundle);
      return;
    }
    if (
      handlers.state.view === "atlas-map" &&
      !handlers.state.node &&
      isAtlasOrientationState(handlers.state) &&
      !plan.fullGraph
    ) {
      const orientationPhase = await loadRouteScopedPhase({
        ...plan,
        librarySearch: false,
      });
      if (handlers.signal?.aborted) return;
      handlers.onSearchReady(orientationPhase.bundle);
      const searchPhase = await loadRouteScopedPhase(plan);
      if (handlers.signal?.aborted) return;
      handlers.onFullReady(searchPhase.bundle);
      return;
    }
    if (handlers.state.view === "library-detail" && plan.commons) {
      const officialPhase = await loadRouteScopedPhase({
        ...plan,
        commons: false,
      });
      if (handlers.signal?.aborted) return;
      handlers.onSearchReady(officialPhase.bundle);
      const contextualPhase = await loadRouteScopedPhase(plan);
      if (handlers.signal?.aborted) return;
      handlers.onFullReady(contextualPhase.bundle);
      return;
    }
    const routePhase = await loadRouteScopedPhase(plan);
    if (handlers.signal?.aborted) return;
    handlers.onSearchReady(routePhase.bundle);
    if (!plan.fullGraph) {
      return;
    }
    const libraryBootstrap = plan.librarySearch
      ? routePhase.libraryBootstrap
      : await loadLibrarySearchBootstrap();
    const fullBundle = await loadFullGraphPhase(
      libraryBootstrap,
      routePhase.templateRegistry,
      routePhase.officialArtifactRegistry,
      routePhase.complianceWorkflowRegistry,
      routePhase.complianceToolRegistry,
      routePhase.fedrampTransitionIndex,
      routePhase.bundle.commonsSearchIndex,
      routePhase.bundle.commonsDataset,
      routePhase.bundle.catalogSummaries || [],
      routePhase.bundle.mappingSources || {},
      routePhase.bundle.atlasNetwork,
      routePhase.bundle.atlasSpine,
    );
    if (handlers.signal?.aborted) return;
    handlers.onFullReady(fullBundle);
  } catch (error) {
    if (handlers.signal?.aborted) return;
    handlers.onError(error);
  }
}
