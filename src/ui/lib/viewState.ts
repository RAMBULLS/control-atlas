import { normalizeResearchState } from "./atlasResearchState";

export type AppView =
  | "home"
  | "atlas-map"
  | "search"
  | "catalog-detail"
  | "library-detail"
  | "matrix"
  | "patterns"
  | "templates"
  | "sources"
  | "commons"
  | "commons-detail"
  | "start-here"
  | "about"
  | "retired"
  | "not-found";

export type CompareCrosswalk =
  | "intent"
  | "relationships"
  | "stig-chain"
  | "baseline-compare"
  | "threat-chain";

export type RelationshipViewMode = "path" | "map" | "list" | "purpose" | "rmf";

export type CompareViewMode = "map" | "list";

export type SourceLayerMode =
  | "publication"
  | "connection"
  | "ingestion"
  | "organization";

const SOURCE_LAYER_MODES = new Set<SourceLayerMode>([
  "publication",
  "connection",
  "ingestion",
  "organization",
]);

/** A layer is a publisher choice only: "publisher:<name>". Anything else is dropped. */
export function normalizeAtlasLayer(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.startsWith("publisher:") && text.length > 10 && text.length <= 130 && ![...text].some((c) => c.charCodeAt(0) < 32) ? text : "";
}

function sourceLayerMode(value: unknown): SourceLayerMode {
  return SOURCE_LAYER_MODES.has(value as SourceLayerMode)
    ? (value as SourceLayerMode)
    : "publication";
}

export type ViewState =
  | { view: "home" }
  | {
      view: "atlas-map";
      atlasResearch?: string;
      atlasPins?: string;
      atlasFrom?: string;
      atlasTo?: string;
      atlasDirection?: string;
      atlasHops?: string;
      node: string;
      atlasParent: string;
      atlasAxis: string;
      atlasLimb: string;
      atlasFramework: string;
      atlasBenchmark: string;
      atlasBaseline: string;
      atlasFamily: string;
      atlasRmfStep: string;
      /**
       * Where the reader crossed from one framework into another, oldest
       * first. Structural ancestry is already recoverable from the scope
       * parameters; a pivot is not, because the framework left behind is not
       * an ancestor of the one arrived at. Encoded as
       * `ecosystem|publication|node` triples joined by `~`.
       */
      atlasPivotTrail: string;
      /**
       * How the unscoped Atlas groups itself: "" by what each document is,
       * "publishers" by who issues it, "job" by what you are trying to get
       * done. Three questions about the same 28 publications, none of which
       * claims one framework outranks another.
       *
       * The landing used to draw all 28 at once as a dependency hierarchy,
       * which put SP 800-53 at the top of everything — five unlike documents
       * placed as peers because nothing else here happens to build on them.
       * Grouping first shows five or six things and says something true on
       * every screen; the dependency picture moves one level down, inside a
       * group, where it is honest.
       *
       * The publisher lens is also the only place the authority groups appear,
       * since statutes and directives carry no crosswalks.
       */
      atlasLanding: string;
      /** The group opened within the current lens, if any. */
      atlasLensFamily: string;
      /** Territory map layer: "" or "publisher:<publisher name>". */
      atlasLayer: string;
      relationshipView: string;
      relationshipType: string;
      provenance: string;
      confidence: string;
      nodeType: string;
      includeCandidates: string;
      relationshipSearch: string;
      atlasStage: string;
      relationshipGroup: string;
      sourceView: string;
      showSupportingReferences: string;
      showDraftOrLegacy: string;
      showRegistryOnly: string;
    }
  | {
      view: "search";
      query: string;
      filter: string;
      publisher: string;
      kind: string;
      objectType: string;
      sourceClass: string;
      controlFamily: string;
      severity: string;
      connectedOnly: string;
      sort: string;
      viewMode: "list" | "map";
      collection: string;
      area: string;
      tags: string[];
    }
  | {
      view: "catalog-detail";
      catalog: string;
      query: string;
      family: string;
      browseAll: string;
      type: string;
      area: string;
      publisher: string;
      lifecycle: string;
      page: string;
    }
  | {
      view: "library-detail";
      node: string;
      relationshipView?: string;
      relationshipType?: string;
      provenance?: string;
      confidence?: string;
      nodeType?: string;
      includeCandidates?: string;
      relationshipSearch?: string;
    }
  | {
      view: "matrix";
      crosswalk: CompareCrosswalk;
      source: string;
      target: string;
      items: string;
      relationshipType: string;
      provenance: string;
      confidence: string;
      includeCandidates: string;
      chainCatalog: string;
      chainBenchmark: string;
      chainItem: string;
      baselineA: string;
      baselineB: string;
      intent: string;
      compareView: string;
      mappingSource: string;
      compareRun: string;
      page: string;
    }
  | {
      view: "patterns";
      pattern: string;
    }
  | {
      view: "templates";
      buildSection: "tasks" | "documents";
      task: string;
      templateType: string;
      framework: string;
      format: string;
      environment: string;
      baseline: string;
      controlFamily: string;
      category: string;
      query: string;
    }
  | {
      view: "sources";
      layer: SourceLayerMode;
      query: string;
      source: string;
      publisher: string;
      provenance: string;
      eligibility: string;
      lifecycle: string;
      access: string;
    }
  | {
      view: "commons";
      query: string;
      lane: string;
      framework: string;
      lifecycle: string;
      audience: string;
      accessType: string;
      resourceType: string;
      category: string;
      collection: string;
      owner: string;
      costType: string;
      sort: string;
      showAll: string;
      viewMode: "list" | "map";
    }
  | {
      view: "commons-detail";
      id: string;
      query: string;
      resourceType: string;
      collection: string;
      owner: string;
      sort: string;
      showAll: string;
      viewMode: "list" | "map";
    }
  | { view: "start-here"; goal: string; context: string }
  | {
      view: "about";
    }
  | {
      view: "retired";
      query: string;
    }
  | {
      view: "not-found";
    };

function searchState(): ViewState {
  return {
    view: "search",
    query: "",
    filter: "",
    publisher: "",
    kind: "",
    objectType: "",
    sourceClass: "",
    controlFamily: "",
    severity: "",
    connectedOnly: "",
    sort: "relevance",
    viewMode: "list",
    collection: "",
    area: "",
    tags: [],
  };
}

function atlasMapState(): Extract<ViewState, { view: "atlas-map" }> {
  return {
    view: "atlas-map",
    ...normalizeResearchState({}),
    node: "",
    atlasParent: "",
    atlasAxis: "",
    atlasLimb: "",
    atlasFramework: "",
    atlasBenchmark: "",
    atlasBaseline: "",
    atlasFamily: "",
    atlasRmfStep: "",
    atlasPivotTrail: "",
    atlasLanding: "",
    atlasLensFamily: "",
    atlasLayer: "",
    relationshipView: "",
    relationshipType: "",
    provenance: "",
    confidence: "",
    nodeType: "",
    includeCandidates: "",
    relationshipSearch: "",
    atlasStage: "",
    relationshipGroup: "",
    sourceView: "default",
    showSupportingReferences: "",
    showDraftOrLegacy: "",
    showRegistryOnly: "",
  };
}

function compareState(): Extract<ViewState, { view: "matrix" }> {
  return {
    view: "matrix",
    crosswalk: "intent",
    source: "",
    target: "",
    items: "",
    relationshipType: "",
    provenance: "",
    confidence: "",
    includeCandidates: "",
    chainCatalog: "",
    chainBenchmark: "",
    chainItem: "",
    baselineA: "",
    baselineB: "",
    intent: "",
    compareView: "list",
    mappingSource: "",
    compareRun: "",
    page: "",
  };
}

function normalizeCompareView(value: string): CompareViewMode | "" {
  if (value === "map") return "map";
  if (value === "list") return "list";
  return "";
}

/**
 * "" is the kind lens. It is the default rather than a named value so that
 * links written before the other two lenses existed still open on a survey,
 * and so the common case leaves no parameter in the URL at all.
 */
function normalizeAtlasLanding(value: string): string {
  if (value === "publishers") return "publishers";
  if (value === "job") return "job";
  return "";
}

function normalizeRelationshipView(value: string): RelationshipViewMode | "" {
  if (value === "path") return "path";
  if (value === "list" || value === "table") return "list";
  if (value === "map") return "map";
  if (value === "purpose") return "purpose";
  if (value === "rmf") return "rmf";
  return "";
}

function canonicalViewParam(view: string): AppView {
  if (view === "explore") return "search";
  if (view === "playbooks") return "patterns";
  return view as AppView;
}

export function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(search);
  const query = params.get("q") || "";

  const rawView = params.get("view");
  const view = rawView ? canonicalViewParam(rawView) : "home";

  if (view === "retired" || (!rawView && /^[A-Z]{3}-\d{4}-\d+$/i.test(query))) {
    return { view: "retired", query };
  }

  if (view === "home") {
    return { view: "home" };
  }

  if (view === "atlas-map") {
    return {
      view,
      ...normalizeResearchState(Object.fromEntries(params)),
      node: params.get("node") || "",
      atlasParent: params.get("atlasParent") || "",
      atlasAxis: params.get("atlasAxis") || "",
      atlasLimb: params.get("atlasLimb") || "",
      atlasFramework: params.get("atlasFramework") || "",
      atlasBenchmark: params.get("atlasBenchmark") || "",
      atlasBaseline: params.get("atlasBaseline") || "",
      atlasFamily: params.get("atlasFamily") || "",
      atlasRmfStep: params.get("atlasRmfStep") || "",
      atlasPivotTrail: params.get("atlasPivotTrail") || "",
      // Which of the three lenses the landing is grouped by. "" is the kind
      // lens and stays the default, so every URL written before the other two
      // existed still opens on a survey rather than on nothing.
      atlasLanding: normalizeAtlasLanding(params.get("atlasLanding") || ""),
      atlasLensFamily: params.get("atlasLensFamily") || "",
      atlasLayer: normalizeAtlasLayer(params.get("atlasLayer") || ""),
      // Empty means "the default for this state" — Connections when a record
      // is focused, the board otherwise (AtlasMapPage.atlasView decides). It is
      // deliberately not forced to "path": serializing a default the user never
      // chose raced with their first click and overwrote it.
      relationshipView: normalizeRelationshipView(
        params.get("relationshipView") || "",
      ),
      relationshipType: params.get("relationshipType") || "",
      provenance: params.get("provenance") || "",
      confidence: params.get("confidence") || "",
      nodeType: params.get("type") || params.get("nodeType") || "",
      includeCandidates: params.get("includeCandidates") || "",
      relationshipSearch: params.get("relationshipSearch") || "",
      atlasStage: params.get("atlasStage") || "",
      relationshipGroup: params.get("relationshipGroup") || "",
      sourceView:
        params.get("sourceView") === "purpose" || params.get("sourceView") === "rmf"
          ? params.get("sourceView") || "default"
          : "default",
      showSupportingReferences: params.get("showSupportingReferences") || "",
      showDraftOrLegacy: params.get("showDraftOrLegacy") || "",
      showRegistryOnly: params.get("showRegistryOnly") || "",
    };
  }

  if (view === "library-detail") {
    return {
      view,
      node: params.get("node") || "",
      relationshipView: params.get("relationshipView") || "",
      relationshipType: params.get("relationshipType") || "",
      provenance: params.get("provenance") || "",
      confidence: params.get("confidence") || "",
      nodeType: params.get("nodeType") || "",
      includeCandidates: params.get("includeCandidates") || "",
      relationshipSearch: params.get("relationshipSearch") || "",
    };
  }

  if (view === "catalog-detail") {
    return {
      view,
      catalog: params.get("catalog") || params.get("framework") || "",
      query: params.get("q") || "",
      family: params.get("family") || "",
      browseAll: params.get("browseAll") === "true" ? "true" : "",
      type: params.get("type") || "",
      area: params.get("area") || "",
      publisher: params.get("publisher") || "",
      lifecycle: params.get("lifecycle") || "",
      page: params.get("page") || "",
    };
  }

  if (view === "matrix") {
    const state = compareState();
    return {
      ...state,
      crosswalk:
        ((params.get("crosswalk") || params.get("workbench")) as CompareCrosswalk) ||
        "intent",
      source: params.get("source") || "",
      target: params.get("target") || "",
      items: params.get("items") || "",
      relationshipType: params.get("relationshipType") || "",
      provenance: params.get("provenance") || "",
      confidence: params.get("confidence") || "",
      includeCandidates: params.get("includeCandidates") || "",
      chainCatalog: params.get("chainCatalog") || "",
      chainBenchmark: params.get("chainBenchmark") || "",
      chainItem: params.get("chainItem") || "",
      baselineA: params.get("baselineA") || "",
      baselineB: params.get("baselineB") || "",
      intent: params.get("intent") || "",
      compareView:
        normalizeCompareView(params.get("compareView") || "") || "list",
      mappingSource: params.get("mappingSource") || "",
      compareRun: params.get("compareRun") === "true" ? "true" : "",
      page: params.get("page") || "",
    };
  }

  if (view === "patterns") {
    return { view, pattern: params.get("pattern") || "" };
  }

  if (view === "templates") {
    return {
      view,
      buildSection:
        params.get("buildSection") === "tasks" ? "tasks" : "documents",
      task: params.get("task") || "",
      templateType: params.get("templateType") || "",
      framework: params.get("framework") || "",
      format: params.get("format") || "",
      environment: params.get("environment") || "",
      baseline: params.get("baseline") || "",
      controlFamily: params.get("controlFamily") || "",
      category: params.get("category") || "",
      query: params.get("q") || "",
    };
  }

  if (view === "sources") {
    return {
      view,
      layer: sourceLayerMode(params.get("layer")),
      query: params.get("q") || "",
      source: params.get("source") || "",
      publisher: params.get("publisher") || "",
      provenance: params.get("provenance") || "",
      eligibility: params.get("eligibility") || "",
      lifecycle: params.get("lifecycle") || "",
      access: params.get("access") || "",
    };
  }

  if (view === "commons") {
    return {
      view,
      query: params.get("q") || params.get("query") || "",
      lane: "all",
      framework: "",
      lifecycle: "",
      audience: "",
      accessType: "",
      resourceType: params.get("resourceType") || "",
      category: "",
      collection: params.get("collection") || "",
      owner: params.get("owner") || "",
      costType: "",
      sort: params.get("sort") || "relevance",
      showAll: params.get("showAll") === "true" ? "true" : "",
      viewMode: params.get("viewMode") === "map" ? "map" : "list",
    };
  }

  if (view === "commons-detail") {
    return {
      view,
      id: params.get("id") || "",
      query: params.get("q") || params.get("query") || "",
      resourceType: params.get("resourceType") || "",
      collection: params.get("collection") || "",
      owner: params.get("owner") || "",
      sort: params.get("sort") || "relevance",
      showAll: params.get("showAll") === "true" ? "true" : "",
      viewMode: params.get("viewMode") === "map" ? "map" : "list",
    };
  }

  if (view === "start-here") {
    return {
      view,
      goal: params.get("goal") || "",
      context: params.get("context") || "",
    };
  }

  if (view === "about") {
    return { view: "about" };
  }

  if (view === "not-found") {
    return { view: "not-found" };
  }

  return {
    view: "search",
    query,
    filter: params.get("filter") || "",
    publisher: params.get("publisher") || "",
    kind: params.get("kind") || "",
    objectType: "",
    sourceClass: "",
    controlFamily: "",
    severity: "",
    connectedOnly: params.get("connectedOnly") === "true" ? "true" : "",
    sort: ["relevance", "identifier", "title", "publication"].includes(params.get("sort") || "")
      ? params.get("sort") || "relevance"
      : "relevance",
    viewMode: params.get("view") === "map" ? "map" : "list",
    collection: "",
    area: params.get("area") || "",
    tags: [...new Set(params.getAll("tag").filter(Boolean))].sort(),
  };
}

export function normalizeViewState(
  view: AppView,
  state: Partial<ViewState> = {},
): ViewState {
  if (view === "home") {
    return { view: "home" };
  }

  if (view === "atlas-map") {
    const incoming = state as Extract<ViewState, { view: "atlas-map" }>;
    return {
      ...atlasMapState(),
      ...incoming,
      ...normalizeResearchState(incoming),
      view,
    };
  }

  if (view === "library-detail") {
    return {
      view,
      node:
        (state as Extract<ViewState, { view: "library-detail" }>).node || "",
      relationshipView:
        (state as Extract<ViewState, { view: "library-detail" }>)
          .relationshipView || "",
      relationshipType:
        (state as Extract<ViewState, { view: "library-detail" }>)
          .relationshipType || "",
      provenance:
        (state as Extract<ViewState, { view: "library-detail" }>).provenance ||
        "",
      confidence:
        (state as Extract<ViewState, { view: "library-detail" }>).confidence ||
        "",
      nodeType:
        (state as Extract<ViewState, { view: "library-detail" }>).nodeType ||
        "",
      includeCandidates:
        (state as Extract<ViewState, { view: "library-detail" }>)
          .includeCandidates || "",
      relationshipSearch:
        (state as Extract<ViewState, { view: "library-detail" }>)
          .relationshipSearch || "",
    };
  }

  if (view === "catalog-detail") {
    const incoming = state as Extract<ViewState, { view: "catalog-detail" }>;
    return {
      view,
      catalog: incoming.catalog || "",
      query: incoming.query || "",
      family: incoming.family || "",
      browseAll: incoming.browseAll === "true" ? "true" : "",
      type: incoming.type || "",
      area: incoming.area || "",
      publisher: incoming.publisher || "",
      lifecycle: incoming.lifecycle || "",
      page: incoming.page || "",
    };
  }

  if (view === "matrix") {
    const incoming = state as Extract<ViewState, { view: "matrix" }>;
    return {
      ...compareState(),
      ...incoming,
      view,
      crosswalk: incoming.crosswalk || (incoming as any).workbench || "intent",
    };
  }

  if (view === "patterns") {
    return {
      view,
      pattern:
        (state as Extract<ViewState, { view: "patterns" }>).pattern || "",
    };
  }

  if (view === "templates") {
    const incoming = state as Extract<ViewState, { view: "templates" }>;
    return {
      view,
      buildSection:
        incoming.buildSection === "tasks" ? "tasks" : "documents",
      task: incoming.task || "",
      templateType: incoming.templateType || "",
      framework: incoming.framework || "",
      format: incoming.format || "",
      environment: incoming.environment || "",
      baseline: incoming.baseline || "",
      controlFamily: incoming.controlFamily || "",
      category: incoming.category || "",
      query: incoming.query || "",
    };
  }

  if (view === "sources") {
    const incoming = state as Extract<ViewState, { view: "sources" }>;
    return {
      view,
      layer: sourceLayerMode(incoming.layer),
      query: incoming.query || "",
      source: incoming.source || "",
      publisher: incoming.publisher || "",
      provenance: incoming.provenance || "",
      eligibility: incoming.eligibility || "",
      lifecycle: incoming.lifecycle || "",
      access: incoming.access || "",
    };
  }

  if (view === "commons") {
    const incoming = state as Extract<ViewState, { view: "commons" }>;
    return {
      view,
      query: incoming.query || "",
      lane: "all",
      framework: "",
      lifecycle: "",
      audience: "",
      accessType: "",
      resourceType: incoming.resourceType || "",
      category: "",
      collection: incoming.collection || "",
      owner: incoming.owner || "",
      costType: "",
      sort: incoming.sort || "relevance",
      showAll: incoming.showAll === "true" ? "true" : "",
      viewMode: incoming.viewMode === "map" ? "map" : "list",
    };
  }

  if (view === "commons-detail") {
    const incoming = state as Extract<ViewState, { view: "commons-detail" }>;
    return {
      view,
      id: incoming.id || "",
      query: incoming.query || "",
      resourceType: incoming.resourceType || "",
      collection: incoming.collection || "",
      owner: incoming.owner || "",
      sort: incoming.sort || "relevance",
      showAll: incoming.showAll === "true" ? "true" : "",
      viewMode: incoming.viewMode === "map" ? "map" : "list",
    };
  }

  if (view === "start-here") {
    const incoming = state as Extract<ViewState, { view: "start-here" }>;
    return {
      view,
      goal: incoming.goal || "",
      context: incoming.context || "",
    };
  }

  if (view === "about") {
    return { view: "about" };
  }

  if (view === "not-found") {
    return { view: "not-found" };
  }

  if (view === "retired") {
    return {
      view,
      query: (state as Extract<ViewState, { view: "retired" }>).query || "",
    };
  }

  const base = searchState();
  const incoming = state as Extract<ViewState, { view: "search" }>;
  return {
    ...base,
    ...incoming,
    view: "search",
    objectType: "",
    sourceClass: "",
    controlFamily: "",
    severity: "",
    collection: "",
    tags: Array.isArray(incoming.tags) ? [...new Set(incoming.tags.filter(Boolean))].sort() : [],
  };
}

function setIfValue(params: URLSearchParams, key: string, value: string) {
  if (value) {
    params.set(key, value);
  }
}

export function serializeViewState(state: ViewState): string {
  const params = new URLSearchParams();

  if (state.view === "home") {
    setIfValue(params, "view", "home");
  } else if (state.view === "atlas-map") {
    params.set("view", "atlas-map");
    const research = normalizeResearchState(state);
    setIfValue(params, "atlasResearch", research.atlasResearch);
    setIfValue(params, "atlasPins", research.atlasPins);
    setIfValue(params, "atlasFrom", research.atlasFrom);
    setIfValue(params, "atlasTo", research.atlasTo);
    if (research.atlasDirection === "either") params.set("atlasDirection", "either");
    if (research.atlasHops !== "4") params.set("atlasHops", research.atlasHops);
    setIfValue(params, "node", state.node);
    setIfValue(params, "atlasParent", state.atlasParent);
    setIfValue(params, "atlasAxis", state.atlasAxis);
    setIfValue(params, "atlasLimb", state.atlasLimb);
    setIfValue(params, "atlasFramework", state.atlasFramework);
    setIfValue(params, "atlasBenchmark", state.atlasBenchmark);
    setIfValue(params, "atlasBaseline", state.atlasBaseline);
    setIfValue(params, "atlasFamily", state.atlasFamily);
    setIfValue(params, "atlasRmfStep", state.atlasRmfStep);
    setIfValue(params, "atlasPivotTrail", state.atlasPivotTrail);
    setIfValue(params, "atlasLanding", state.atlasLanding);
    setIfValue(params, "atlasLensFamily", state.atlasLensFamily);
    setIfValue(params, "atlasLayer", normalizeAtlasLayer(state.atlasLayer));
    if (state.relationshipView === "path") {
      params.set("relationshipView", "path");
    } else if (state.relationshipView === "map") {
      params.set("relationshipView", "map");
    } else if (state.relationshipView === "list") {
      params.set("relationshipView", "list");
    } else if (state.relationshipView === "purpose") {
      params.set("relationshipView", "purpose");
    } else if (state.relationshipView === "rmf") {
      params.set("relationshipView", "rmf");
    }
    setIfValue(params, "relationshipType", state.relationshipType);
    setIfValue(params, "provenance", state.provenance);
    setIfValue(params, "confidence", state.confidence);
    setIfValue(params, "type", state.nodeType);
    setIfValue(params, "includeCandidates", state.includeCandidates);
    setIfValue(params, "relationshipSearch", state.relationshipSearch);
    setIfValue(params, "atlasStage", state.atlasStage);
    setIfValue(params, "relationshipGroup", state.relationshipGroup);
    if (state.sourceView === "purpose" || state.sourceView === "rmf") {
      params.set("sourceView", state.sourceView);
    }
    setIfValue(
      params,
      "showSupportingReferences",
      state.showSupportingReferences,
    );
    setIfValue(params, "showDraftOrLegacy", state.showDraftOrLegacy);
    setIfValue(params, "showRegistryOnly", state.showRegistryOnly);
  } else if (state.view === "search") {
    setIfValue(params, "view", "search");
    setIfValue(params, "q", state.query);
    setIfValue(params, "filter", state.filter);
    setIfValue(params, "publisher", state.publisher);
    setIfValue(params, "kind", state.kind);
    setIfValue(params, "connectedOnly", state.connectedOnly);
    if (state.sort !== "relevance") setIfValue(params, "sort", state.sort);
    if (state.viewMode === "map") setIfValue(params, "view", "map");
    setIfValue(params, "area", state.area);
    for (const tag of [...new Set(state.tags)].sort()) params.append("tag", tag);
  } else if (state.view === "catalog-detail") {
    params.set("view", state.view);
    setIfValue(params, "catalog", state.catalog);
    setIfValue(params, "q", state.query);
    setIfValue(params, "family", state.family);
    setIfValue(params, "browseAll", state.browseAll);
    setIfValue(params, "type", state.type);
    setIfValue(params, "area", state.area);
    setIfValue(params, "publisher", state.publisher);
    setIfValue(params, "lifecycle", state.lifecycle);
    setIfValue(params, "page", state.page);
  } else if (state.view === "library-detail") {
    params.set("view", state.view);
    setIfValue(params, "node", state.node);
    if (state.relationshipView === "map") {
      params.set("relationshipView", "map");
    } else if (
      state.relationshipView === "list" ||
      state.relationshipView === "table"
    ) {
      params.set("relationshipView", "list");
    }
    setIfValue(params, "relationshipType", state.relationshipType || "");
    setIfValue(params, "provenance", state.provenance || "");
    setIfValue(params, "confidence", state.confidence || "");
    setIfValue(params, "nodeType", state.nodeType || "");
    setIfValue(params, "includeCandidates", state.includeCandidates || "");
    setIfValue(params, "relationshipSearch", state.relationshipSearch || "");
  } else if (state.view === "matrix") {
    params.set("view", state.view);
    setIfValue(params, "crosswalk", state.crosswalk);
    setIfValue(params, "source", state.source);
    setIfValue(params, "target", state.target);
    setIfValue(params, "items", state.items);
    setIfValue(params, "relationshipType", state.relationshipType);
    setIfValue(params, "intent", state.intent);
    setIfValue(params, "mappingSource", state.mappingSource);
    setIfValue(params, "compareRun", state.compareRun);
    setIfValue(params, "page", state.page);
  } else if (state.view === "patterns") {
    params.set("view", "patterns");
    setIfValue(params, "pattern", state.pattern);
  } else if (state.view === "templates") {
    params.set("view", state.view);
    setIfValue(
      params,
      "buildSection",
      state.buildSection === "documents" ? "" : state.buildSection,
    );
    setIfValue(params, "task", state.task);
    setIfValue(params, "templateType", state.templateType);
    setIfValue(params, "framework", state.framework);
    setIfValue(params, "format", state.format);
    setIfValue(params, "environment", state.environment);
    setIfValue(params, "baseline", state.baseline);
    setIfValue(params, "controlFamily", state.controlFamily);
    setIfValue(params, "category", state.category);
    setIfValue(params, "q", state.query);
  } else if (state.view === "sources") {
    params.set("view", state.view);
    if (state.layer !== "publication") setIfValue(params, "layer", state.layer);
    setIfValue(params, "q", state.query);
    setIfValue(params, "source", state.source);
    setIfValue(params, "publisher", state.publisher);
    setIfValue(params, "provenance", state.provenance);
    setIfValue(params, "eligibility", state.eligibility);
    setIfValue(params, "lifecycle", state.lifecycle);
    setIfValue(params, "access", state.access);
  } else if (state.view === "commons") {
    params.set("view", state.view);
    setIfValue(params, "q", state.query);
    setIfValue(params, "resourceType", state.resourceType);
    setIfValue(params, "collection", state.collection);
    setIfValue(params, "owner", state.owner);
    if (state.sort && state.sort !== "relevance") setIfValue(params, "sort", state.sort);
    setIfValue(params, "showAll", state.showAll);
    if (state.viewMode === "map") setIfValue(params, "viewMode", "map");
  } else if (state.view === "commons-detail") {
    params.set("view", state.view);
    setIfValue(params, "id", state.id);
    setIfValue(params, "q", state.query);
    setIfValue(params, "resourceType", state.resourceType);
    setIfValue(params, "collection", state.collection);
    setIfValue(params, "owner", state.owner);
    if (state.sort && state.sort !== "relevance") setIfValue(params, "sort", state.sort);
    setIfValue(params, "showAll", state.showAll);
    if (state.viewMode === "map") setIfValue(params, "viewMode", "map");
  } else if (state.view === "start-here") {
    params.set("view", state.view);
    setIfValue(params, "goal", state.goal);
    setIfValue(params, "context", state.context);
  } else if (state.view === "about") {
    params.set("view", state.view);
  } else if (state.view === "retired") {
    params.set("view", state.view);
    setIfValue(params, "q", state.query);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export type AtlasMapUrlOptions = {
  node?: string;
  atlasParent?: string;
  atlasAxis?: string;
  atlasLimb?: string;
  atlasFramework?: string;
  atlasBenchmark?: string;
  atlasBaseline?: string;
  atlasFamily?: string;
  atlasRmfStep?: string;
  atlasPivotTrail?: string;
  atlasLanding?: string;
  atlasLensFamily?: string;
  atlasLayer?: string;
  sourceView?: "default" | "purpose" | "rmf";
  relationshipView?: RelationshipViewMode;
  relationshipType?: string;
  provenance?: string;
  confidence?: string;
  nodeType?: string;
  includeCandidates?: boolean;
  relationshipSearch?: string;
  atlasStage?: string;
  relationshipGroup?: string;
};

export type CompareUrlOptions = Partial<
  Extract<ViewState, { view: "matrix" }>
> & {
  compareView?: CompareViewMode;
};

export function buildCompareUrl(options: CompareUrlOptions = {}): string {
  const state = normalizeViewState("matrix", {
    ...compareState(),
    ...options,
    view: "matrix",
    compareView: options.compareView || "list",
  }) as Extract<ViewState, { view: "matrix" }>;
  return serializeViewState(state);
}

export function buildAtlasMapUrl(options: AtlasMapUrlOptions = {}): string {
  const state = normalizeViewState("atlas-map", {
    view: "atlas-map",
    node: options.node || "",
    atlasParent: options.atlasParent || "",
    atlasAxis: options.atlasAxis || "",
    atlasLimb: options.atlasLimb || "",
    atlasFramework: options.atlasFramework || "",
    atlasBenchmark: options.atlasBenchmark || "",
    atlasBaseline: options.atlasBaseline || "",
    atlasFamily: options.atlasFamily || "",
    atlasRmfStep: options.atlasRmfStep || "",
    atlasPivotTrail: options.atlasPivotTrail || "",
    atlasLanding: normalizeAtlasLanding(options.atlasLanding || ""),
    atlasLensFamily: options.atlasLensFamily || "",
    atlasLayer: normalizeAtlasLayer(options.atlasLayer || ""),
    sourceView: options.sourceView || "default",
    relationshipView: options.relationshipView || "",
    relationshipType: options.relationshipType || "",
    provenance: options.provenance || "",
    confidence: options.confidence || "",
    nodeType: options.nodeType || "",
    includeCandidates: options.includeCandidates ? "true" : "",
    relationshipSearch: options.relationshipSearch || "",
    atlasStage: options.atlasStage || "",
    relationshipGroup: options.relationshipGroup || "",
  }) as Extract<ViewState, { view: "atlas-map" }>;
  return serializeViewState(state);
}

export function nodeIdFromItemId(
  runtime: { searchLibrary: (query: string) => Array<{ id: string; item_id?: string }> },
  itemId: string,
): string | null {
  const match =
    runtime
      .searchLibrary(itemId)
      .find((entry) => entry.item_id === itemId) ||
    runtime.searchLibrary(itemId)[0];
  return match?.id ?? null;
}
