import { artifactPath, fetchArtifact, loadAtlasNeighborhood, runtimeArtifactPlan, type RuntimeArtifactPlan } from "./runtimeArtifacts";
export { clearRuntimeArtifactCache, compressedArtifactPath, fetchArtifact, loadAtlasNeighborhood, parseJsonResponseOffThread, preloadRuntimeArtifacts, runtimeArtifactPlan, RuntimeLoadError } from "./runtimeArtifacts";
export type { ArtifactFetchOptions, AtlasNeighborhoodNode, AtlasNeighborhoodEdge, AtlasNeighborhoodRecord, RuntimeArtifactPlan, RuntimeLoadErrorCode } from "./runtimeArtifacts";
import { comparisonPairKey, comparisonScopeAllowed } from "../../shared/compare-scope.mjs";
import { isComparisonCapableEdge, mappingSourceIdsForEdge } from "../../shared/compare-capability.mjs";
import { createFederalGraphRuntime } from "../../app/runtime.mjs";
import type {
  CommonsResourceDataset,
  CommonsSearchIndex,
} from "./commonsTypes";
import type { ViewState } from "./viewState";
import type { AtlasSpine } from "./atlasSpine";

async function optionalArtifact<T>(path: string, fallback: T): Promise<T> {
  try {
    return (await fetchArtifact(path)) as T;
  } catch (error) {
    console.warn(`Optional Control Atlas data did not load: ${path}`, error);
    return fallback;
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


export type ComparisonPair = {
  scope: "frameworks" | "implementation";
  edge_count: number;
  path: string;
  bytes: number;
};

export type RuntimeBundle = {
  runtime: ReturnType<typeof createFederalGraphRuntime>;
  templateRegistry: TemplateRegistry;
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
  comparisonPairs?: Record<string, ComparisonPair>;
  comparisonItems?: Record<string, string>;
  comparisonItemTargets?: Record<string, string[]>;
  comparisonStatus?: "idle" | "ready" | "unsupported" | "scope-mismatch" | "error";
  comparisonError?: string;
  librarySearchReady: boolean;
  routeReady: boolean;
  graphReady: boolean;
};

type LibrarySearchBootstrap = {
  librarySearch: LibrarySearchArtifact;
};

async function fetchCollection(path: string, key: string) {
  const artifact = await fetchArtifact(path);
  if (artifact.schema_version !== "1.0" || !Array.isArray(artifact[key])) {
    throw new Error(`Invalid ${key} graph artifact.`);
  }
  const shards = artifact.sharded_collection?.shards;
  if (Array.isArray(shards)) {
    const chunks = await mapBounded(
      shards, async (shard: { path?: string }) => {
        if (!shard.path) throw new Error(`Invalid ${key} graph shard.`);
        return fetchArtifact(artifactPath(shard.path));
      },
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
  comparison_pairs?: Record<string, ComparisonPair>;
  comparison_items?: Record<string, string>;
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
  if (plan.atlasSpine && !atlasSpine?.entries?.length) {
    throw new Error("Atlas spine artifact has no entries.");
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
      comparisonPairs: catalogBootstrap.comparison_pairs,
      comparisonItems: catalogBootstrap.comparison_items || {},
      catalogSummaries: catalogBootstrap.catalogs || [],
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
  const [sourcesArtifact, catalogArtifact, atlasSpineArtifact] = await Promise.all([
    fetchArtifact(artifactPath("sources.json")),
    fetchArtifact(artifactPath("catalog-bootstrap.json")),
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
  if (plan.atlasSpine && !atlasSpine?.entries?.length) {
    throw new Error("Atlas spine artifact has no entries.");
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
    comparisonPairs: catalogBootstrap.comparison_pairs,
    comparisonItems: catalogBootstrap.comparison_items || {},
    catalogSummaries: catalogBootstrap.catalogs || [],
    atlasSpine,
    catalogRecordsReady: false,
    librarySearchReady: false,
    routeReady: true,
    graphReady: false,
  };
}

export async function loadRuntimeDatasetStaged(handlers: {
  onSearchReady: (bundle: RuntimeBundle) => void;
  onRecordRendered?: (bundle: RuntimeBundle) => Promise<void>;
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
    if (handlers.state.view === "library-detail" && plan.commons) {
      const officialPhase = await loadRouteScopedPhase({
        ...plan,
        atlasSpine: false,
        commons: false,
      });
      if (handlers.signal?.aborted) return;
      handlers.onSearchReady(officialPhase.bundle);
      await handlers.onRecordRendered?.(officialPhase.bundle);
      if (handlers.signal?.aborted) return;
      const contextualPhase = await loadRouteScopedPhase(plan);
      if (handlers.signal?.aborted) return;
      handlers.onFullReady(contextualPhase.bundle);
      return;
    }
    const routePhase = await loadRouteScopedPhase(plan);
    if (handlers.signal?.aborted) return;
    handlers.onSearchReady(routePhase.bundle);
    if (handlers.state.view === "matrix") {
      const comparison = await loadComparePhase(handlers.state, routePhase.bundle, handlers.signal);
      if (!handlers.signal?.aborted) handlers.onFullReady(comparison);
      return;
    }
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
      routePhase.bundle.atlasSpine,
    );
    if (handlers.signal?.aborted) return;
    handlers.onFullReady(fullBundle);
  } catch (error) {
    if (handlers.signal?.aborted) return;
    handlers.onError(error);
  }
}


/** A small concurrency window prevents all graph/pair shards competing at once. */
export async function mapBounded<T, R>(items: T[], task: (item: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency limit");
  const out: R[] = new Array(items.length);
  let cursor = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const index = cursor++;
      if (index >= items.length) return;
      try { out[index] = await task(items[index]); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return out;
}

/** Load only an admitted pair; failures leave the selection controls usable. */
export async function loadComparePhase(
  state: Extract<ViewState, { view: "matrix" }>,
  bundle: RuntimeBundle,
  signal?: AbortSignal,
  load: (path: string) => Promise<any> = (path) => fetchArtifact(artifactPath(path)),
): Promise<RuntimeBundle> {
  const base: RuntimeBundle = { ...bundle, comparisonStatus: "idle", comparisonError: "", graphReady: false };
  const checkedLoad = async (path: string) => {
    if (signal?.aborted) throw new Error("Comparison cancelled");
    if (!/^compare-data\/[a-zA-Z0-9_.-]+\.json$/.test(path) || path.includes("..")) {
      throw new Error("Invalid comparison artifact path");
    }
    return load(path);
  };
  try {
    // Exact-item target choices have their own small index. Merely typing an
    // item must not download all crosswalks to discover eligible destinations.
    if (state.intent === "item-mapping" && state.source && state.items.trim()) {
      const path = bundle.comparisonItems?.[state.source];
      if (path) {
        const index = await checkedLoad(path);
        if (index.catalog !== state.source || !index.items || typeof index.items !== "object") throw new Error("Invalid item mapping index");
        base.comparisonItemTargets = index.items;
      } else base.comparisonItemTargets = {};
    }
    if (state.compareRun !== "true" || !state.source || !state.target) return base;
    if (!bundle.comparisonPairs) throw new Error("Missing comparison capability metadata");
    const key = comparisonPairKey(state.source, state.target);
    const entry = bundle.comparisonPairs?.[key];
    if (!entry || entry.edge_count < 1) return { ...base, comparisonStatus: "unsupported" };
    if (!comparisonScopeAllowed(entry.scope, state.intent)) return { ...base, comparisonStatus: "scope-mismatch" };
    const header = await checkedLoad(entry.path);
    if (header.schema_version !== 1 || header.pair?.join("|") !== key || header.scope !== entry.scope
      || header.edge_count !== entry.edge_count || !Array.isArray(header.chunks) || !header.chunks.length) {
      throw new Error("Invalid comparison header");
    }
    const chunks = await mapBounded(header.chunks as Array<{ path: string; edge_count: number }>, async (part) => {
      const chunk = await checkedLoad(part.path);
      if (chunk.pair?.join("|") !== key || chunk.scope !== entry.scope || !Array.isArray(chunk.edges)
        || chunk.edges.length !== part.edge_count || !Array.isArray(chunk.nodes) || !Array.isArray(chunk.evidence)) {
        throw new Error("Invalid comparison chunk");
      }
      return chunk;
    });
    const nodes = new Map<string, any>(), edges = new Map<string, any>(), evidence = new Map<string, any>();
    for (const chunk of chunks) {
      for (const node of chunk.nodes) nodes.set(node.id, node);
      for (const item of chunk.evidence) evidence.set(item.id, item);
      for (const edge of chunk.edges) {
        if (edges.has(edge.id)) throw new Error("Duplicate comparison relationship");
        edges.set(edge.id, edge);
      }
    }
    if (edges.size !== entry.edge_count || nodes.size !== header.node_count) throw new Error("Incomplete comparison");
    const sourceIds = new Set(bundle.runtime.getSources().map((source: any) => source.id));
    for (const edge of edges.values()) {
      const refs = mappingSourceIdsForEdge(edge);
      if (!refs.length || refs.some((id: string) => !sourceIds.has(id))) throw new Error("Unresolved comparison source");
      const a = nodes.get(edge.source_node_id)?.metadata?.catalog_id;
      const b = nodes.get(edge.target_node_id)?.metadata?.catalog_id;
      if (comparisonPairKey(a, b) !== key || !isComparisonCapableEdge(edge)) throw new Error("Unrelated comparison relationship");
      for (const id of edge.evidence_ids || [`evidence:${edge.id.slice(5)}`]) {
        if (!evidence.has(id)) throw new Error("Comparison source evidence missing");
      }
    }
    const runtime = createFederalGraphRuntime({
      sources: bundle.runtime.getSources(), catalogs: bundle.catalogSummaries || [],
      nodes: [...nodes.values()], edges: [...edges.values()], evidence: [...evidence.values()], findings: [],
    });
    return { ...base, runtime, comparisonStatus: "ready" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ...base, comparisonStatus: "error", comparisonError: "These mappings could not be loaded. Try again, or choose another publication." };
  }
}
