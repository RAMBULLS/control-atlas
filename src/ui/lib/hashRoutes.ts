import {
  normalizeViewState,
  parseViewState,
  serializeViewState,
  type AppView,
  type ViewState,
} from "./viewState";
import { canonicalizeHashLocation, routeIdentityFor } from "./routeIdentity";

/**
 * Map internal view keys to hash path segments (user-facing routes).
 * View key "atlas-map" -> user-facing "Explore" nav label (rename kept its
 * existing path — see docs/PAGE_CONTRACTS.md: "/explore" is already
 * the ExplorePage's own path). "catalog-detail" -> "Catalog", "patterns" ->
 * "Learn", "templates" -> "Build", and "commons"/"commons-detail" ->
 * "Resources". Internal view keys stay stable while every user-facing route
 * uses the current product vocabulary.
 */
const VIEW_TO_PATH: Record<AppView, string> = {
  home: routeIdentityFor("home").path,
  "start-here": routeIdentityFor("start-here").path,
  "atlas-map": routeIdentityFor("atlas-map").path,
  search: routeIdentityFor("search").path,
  "catalog-detail": routeIdentityFor("catalog-detail").path,
  "library-detail": routeIdentityFor("library-detail").path,
  matrix: routeIdentityFor("matrix").path,
  patterns: routeIdentityFor("patterns").path,
  templates: routeIdentityFor("templates").path,
  sources: routeIdentityFor("sources").path,
  commons: routeIdentityFor("commons").path,
  "commons-detail": routeIdentityFor("commons-detail").path,
  about: routeIdentityFor("about").path,
  retired: routeIdentityFor("retired").path,
  "not-found": routeIdentityFor("not-found").path,
};

const PATH_TO_VIEW: Record<string, AppView> = {
  "/": "home",
  "/start": "start-here",
  "/atlas": "atlas-map",
  "/library": "search",
  "/library/publication": "catalog-detail",
  "/record": "library-detail",
  "/compare": "matrix",
  "/guides": "patterns",
  "/build": "templates",
  "/sources": "sources",
  "/resources": "commons",
  "/resources/resource": "commons-detail",
  "/about": "about",
  "/retired": "retired",
  "/not-found": "not-found",
};

function routeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%3A", ":");
}

function readableQuery(params: URLSearchParams): string {
  return params.toString().replaceAll("%3A", ":");
}

function parseNodeIdFromPath(pathname: string): {
  basePath: string;
  nodeId: string;
  catalogId: string;
  resourceId: string;
  taskId: string;
  documentId: string;
  buildSection: "tasks" | "documents" | "";
} {
  const atlasMatch = pathname.match(/^\/atlas\/([^/]+)$/);
  if (atlasMatch) {
    return {
      basePath: "/atlas",
      nodeId: decodeURIComponent(atlasMatch[1]),
      catalogId: "",
      resourceId: "",
      taskId: "",
      documentId: "",
      buildSection: "",
    };
  }
  const compareMatch = pathname.match(/^\/compare\/([^/]+)$/);
  if (compareMatch) {
    return {
      basePath: "/compare",
      nodeId: "",
      catalogId: "",
      resourceId: "",
      taskId: "",
      documentId: "",
      buildSection: "",
    };
  }
  const catalogMatch = pathname.match(/^\/library\/publication\/([^/]+)$/);
  if (catalogMatch) {
    return {
      basePath: "/library/publication",
      nodeId: "",
      catalogId: decodeURIComponent(catalogMatch[1]),
      resourceId: "",
      taskId: "",
      documentId: "",
      buildSection: "",
    };
  }
  const recordMatch = pathname.match(/^\/record\/([^/]+)\/(.+)$/);
  if (recordMatch) {
    return {
      basePath: "/record",
      nodeId: `${decodeURIComponent(recordMatch[1])}:${decodeURIComponent(recordMatch[2])}`,
      catalogId: "",
      resourceId: "",
      taskId: "",
      documentId: "",
      buildSection: "",
    };
  }
  const resourceMatch = pathname.match(/^\/resources\/([^/]+)$/);
  if (resourceMatch) {
    return {
      basePath: "/resources/resource",
      nodeId: "",
      catalogId: "",
      resourceId: decodeURIComponent(resourceMatch[1]),
      taskId: "",
      documentId: "",
      buildSection: "",
    };
  }
  const taskMatch = pathname.match(/^\/build\/tasks\/([^/]+)$/);
  if (taskMatch) {
    return {
      basePath: "/build",
      nodeId: "",
      catalogId: "",
      resourceId: "",
      taskId: decodeURIComponent(taskMatch[1]),
      documentId: "",
      buildSection: "tasks",
    };
  }
  if (pathname === "/build/tasks") {
    return {
      basePath: "/build",
      nodeId: "",
      catalogId: "",
      resourceId: "",
      taskId: "",
      documentId: "",
      buildSection: "tasks",
    };
  }
  const documentMatch = pathname.match(/^\/build\/documents(?:\/([^/]+))?$/);
  if (documentMatch) {
    return {
      basePath: "/build",
      nodeId: "",
      catalogId: "",
      resourceId: "",
      taskId: "",
      documentId: documentMatch[1] ? decodeURIComponent(documentMatch[1]) : "",
      buildSection: "documents",
    };
  }
  return { basePath: pathname, nodeId: "", catalogId: "", resourceId: "", taskId: "", documentId: "", buildSection: "" };
}

export function parseHashLocation(pathname: string, search: string): ViewState {
  const canonical = canonicalizeHashLocation(`${pathname}${search}`);
  const [normalizedPath, canonicalSearch = ""] = canonical.canonicalPath.split("?", 2);
  const { basePath, nodeId, catalogId, resourceId, taskId, documentId, buildSection } = parseNodeIdFromPath(normalizedPath);
  // Root resolves to home; any other unrecognized path is an honest not-found
  // rather than silently rendering home.
  const view =
    PATH_TO_VIEW[basePath] ?? (basePath === "/" ? "home" : "not-found");

  const params = new URLSearchParams(canonicalSearch);

  if (view === "library-detail" && nodeId) {
    params.set("node", nodeId);
  }
  if (view === "atlas-map" && nodeId) {
    params.set("node", nodeId);
  }
  const compareMatch = normalizedPath.match(/^\/compare\/([^/]+)$/);
  if (view === "matrix" && compareMatch) {
    params.set("crosswalk", decodeURIComponent(compareMatch[1]));
  }
  if (view === "catalog-detail" && catalogId) {
    params.set("catalog", catalogId);
  }
  if (view === "commons-detail" && resourceId) {
    params.set("id", resourceId);
  }
  if (view === "templates") {
    if (taskId) params.set("task", taskId);
    if (documentId) params.set("templateType", documentId);
    if (buildSection) params.set("buildSection", buildSection);
  }

  if (view !== "home" && !(view === "search" && params.get("view") === "map")) {
    params.set("view", legacyViewParam(view));
  }

  return parseViewState(`?${params.toString()}`);
}

function legacyViewParam(view: AppView): string {
  return view;
}

export function serializeHashLocation(state: ViewState): string {
  const query = serializeViewState(state).replace(/^\?/, "");
  const params = new URLSearchParams(query);
  params.delete("view");
  if (state.view === "search" && state.viewMode === "map") {
    params.set("view", "map");
  }

  if (state.view === "library-detail" && state.node) {
    const [catalog, item] = state.node.includes(":")
      ? state.node.split(":", 2)
      : ["item", state.node];
    return `/record/${encodeURIComponent(catalog)}/${encodeURIComponent(item || state.node)}`;
  }

  if (state.view === "atlas-map" && state.node) {
    params.delete("node");
    const qs = readableQuery(params);
    return `/atlas/${routeSegment(state.node)}${qs ? `?${qs}` : ""}`;
  }

  if (state.view === "matrix") {
    params.delete("crosswalk");
    params.delete("workbench");
    const qs = readableQuery(params);
    const mode = state.crosswalk === "intent" ? "" : `/${state.crosswalk}`;
    return `/compare${mode}${qs ? `?${qs}` : ""}`;
  }

  if (state.view === "catalog-detail" && state.catalog) {
    params.delete("catalog");
    const qs = readableQuery(params);
    return `/library/publication/${encodeURIComponent(state.catalog)}${qs ? `?${qs}` : ""}`;
  }

  if (state.view === "commons-detail" && state.id) {
    params.delete("id");
    const qs = readableQuery(params);
    return `/resources/${encodeURIComponent(state.id)}${qs ? `?${qs}` : ""}`;
  }

  if (state.view === "catalog-detail" && !state.catalog) {
    return "/library";
  }

  if (state.view === "commons") {
    const qs = readableQuery(params);
    return `/resources${qs ? `?${qs}` : ""}`;
  }

  if (state.view === "templates") {
    params.delete("templateType");
    params.delete("task");
    params.delete("buildSection");
    const qs = readableQuery(params);
    if (state.templateType) {
      return `/build/documents/${encodeURIComponent(state.templateType)}${qs ? `?${qs}` : ""}`;
    }
    // The document browser is the default Templates state, so it owns the bare
    // /build path. /build/documents stays a supported inbound alias.
    if (state.buildSection === "documents") {
      return `/build${qs ? `?${qs}` : ""}`;
    }
    if (state.task) {
      params.delete("framework");
      params.delete("format");
      params.delete("environment");
      params.delete("baseline");
      params.delete("controlFamily");
      return `/build/tasks/${routeSegment(state.task)}`;
    }
    if (state.buildSection === "tasks") {
      return `/build/tasks${qs ? `?${qs}` : ""}`;
    }
  }

  const path = VIEW_TO_PATH[state.view] ?? "/";
  const qs = readableQuery(params);
  return `${path}${qs ? `?${qs}` : ""}`;
}

/** Full hash URL for copy/share (includes leading #). */
export function serializeHashUrl(state: ViewState): string {
  return `#${serializeHashLocation(state)}`;
}

function inferRecordType(catalogId: string): string {
  const nodeTypeHints: Record<string, string> = {
    "nist-800-53": "control",
    "fedramp-rev5": "baseline",
    "disa-stig": "stig_rule",
    "disa-cci": "cci",
    "mitre-attack": "attack_technique",
    "mitre-d3fend": "defend_countermeasure",
  };
  return nodeTypeHints[catalogId] || catalogId;
}

export { inferRecordType };

export function navigateToView(
  navigate: (to: string, options?: { replace?: boolean }) => void,
  view: AppView,
  patch: Partial<ViewState> = {},
  options?: { replace?: boolean },
) {
  const state = normalizeViewState(view, patch);
  navigate(serializeHashLocation(state), options);
}

export function applyLegacyQueryRedirect(): boolean {
  const { search, hash } = window.location;
  if (!search || hash.replace(/^#\/?/, "").length > 0) {
    return false;
  }
  const params = new URLSearchParams(search);
  const hasRetiredMode = params.has("mode");
  if (!params.get("view") && !params.get("q") && !hasRetiredMode) {
    return false;
  }
  const state = parseViewState(search);
  const target = serializeHashUrl(state);
  window.history.replaceState(null, "", `${window.location.pathname}${target}`);
  return true;
}
