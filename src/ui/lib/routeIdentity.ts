import type { AppView } from "./viewState";
import {
  isKnownBuildDocument,
  isKnownBuildTask,
  isValidBuildFormat,
  isValidBuildSourceContext,
} from "./buildRouteState";
import { TAXONOMY_TAG_BY_ID } from "../../shared/taxonomy-contract.mjs";

export type RouteIdentity = {
  path: string;
  label: string;
  title: string;
  contextLabel: string;
  analyticsName: string;
};

/**
 * The single user-facing name for every app state. Internal view keys remain
 * stable during the migration; they are never UI copy.
 */
const ROUTE_IDENTITIES: Record<AppView, RouteIdentity> = {
  home: { path: "/", label: "Home", title: "Home", contextLabel: "Home", analyticsName: "home" },
  "start-here": { path: "/start", label: "Start here", title: "Start here", contextLabel: "Start here", analyticsName: "start_here" },
  "atlas-map": { path: "/atlas", label: "Atlas", title: "Atlas", contextLabel: "Atlas", analyticsName: "atlas" },
  search: { path: "/library", label: "Library", title: "Library", contextLabel: "Library", analyticsName: "library" },
  "catalog-detail": { path: "/library/publication", label: "Library", title: "Library", contextLabel: "Library", analyticsName: "publication" },
  "library-detail": { path: "/record", label: "Record", title: "Record", contextLabel: "Record", analyticsName: "record_detail" },
  matrix: { path: "/compare", label: "Compare", title: "Compare", contextLabel: "Compare", analyticsName: "compare" },
  patterns: { path: "/guides", label: "Guides", title: "Guides", contextLabel: "Guides", analyticsName: "guides" },
  templates: { path: "/build", label: "Templates", title: "Templates", contextLabel: "Templates", analyticsName: "build" },
  sources: { path: "/sources", label: "Sources", title: "Sources", contextLabel: "Sources", analyticsName: "sources" },
  commons: { path: "/resources", label: "Resources", title: "Resources", contextLabel: "Resources", analyticsName: "resources" },
  "commons-detail": { path: "/resources/resource", label: "Resources", title: "Resource", contextLabel: "Resources", analyticsName: "resource_detail" },
  about: { path: "/about", label: "About", title: "About", contextLabel: "About", analyticsName: "about" },
  retired: { path: "/retired", label: "Retired identifier", title: "Retired identifier", contextLabel: "Retired identifier", analyticsName: "retired_identifier" },
  "not-found": { path: "/not-found", label: "Page not found", title: "Page not found", contextLabel: "Page not found", analyticsName: "not_found" },
};

const SELECTED_NAV_BY_VIEW: Record<AppView, AppView | null> = {
  home: null,
  "start-here": "start-here",
  "atlas-map": "atlas-map",
  // Search results are a state of Library, not a separate destination, so the
  // Library tab stays selected while a query is open.
  search: "search",
  "catalog-detail": "search",
  // A record has its own canonical /record route and is not itself a primary
  // navigation destination. Do not imply Library ownership based on how the
  // visitor arrived.
  "library-detail": null,
  matrix: "matrix",
  patterns: "patterns",
  templates: "templates",
  sources: "sources",
  commons: "commons",
  "commons-detail": "commons",
  about: "about",
  retired: "search",
  "not-found": null,
};

const RECOVERY_VIEW_BY_VIEW: Record<AppView, AppView> = {
  home: "home",
  "start-here": "start-here",
  "atlas-map": "atlas-map",
  search: "search",
  "catalog-detail": "catalog-detail",
  "library-detail": "catalog-detail",
  matrix: "matrix",
  patterns: "patterns",
  templates: "templates",
  sources: "sources",
  commons: "commons",
  "commons-detail": "commons",
  about: "about",
  retired: "catalog-detail",
  "not-found": "home",
};

export const CANONICAL_DESTINATION_VIEWS = Object.freeze([
  "home",
  "start-here",
  "search",
  "atlas-map",
  "catalog-detail",
  "library-detail",
  "matrix",
  "patterns",
  "templates",
  "commons",
  "sources",
  "about",
] satisfies AppView[]);

export const CANONICAL_DESTINATIONS = Object.freeze(
  CANONICAL_DESTINATION_VIEWS.map((view) => ({
    view,
    ...ROUTE_IDENTITIES[view],
  })),
);

export function routeIdentityFor(view: AppView): RouteIdentity {
  return ROUTE_IDENTITIES[view];
}

export function selectedNavFor(view: AppView): AppView | null {
  return SELECTED_NAV_BY_VIEW[view];
}

export function recoveryViewFor(view: AppView): AppView {
  return RECOVERY_VIEW_BY_VIEW[view];
}

export type CanonicalRoute = {
  canonicalPath: string;
  requiresReplace: boolean;
  recoveryMessage: string;
};

const ATLAS_PARAMS = new Set([
  "node", "atlasAxis", "atlasLimb", "atlasFramework", "atlasBenchmark", "atlasBaseline", "atlasFamily",
  "atlasResearch", "atlasPins", "atlasFrom", "atlasTo", "atlasDirection", "atlasHops",
  "atlasRmfStep", "atlasPivotTrail", "atlasLanding", "atlasLensFamily", "atlasLayer", "atlasParent", "relationshipView", "relationshipType", "provenance",
  "confidence", "type", "nodeType", "includeCandidates", "relationshipSearch",
  "atlasStage", "relationshipGroup", "sourceView", "showSupportingReferences",
  "showDraftOrLegacy", "showRegistryOnly",
]);
const SEARCH_PARAMS = new Set(["q", "filter", "publisher", "kind", "connectedOnly", "sort", "view", "area", "tag"]);
const CATALOG_PARAMS = new Set(["q", "family", "browseAll", "type", "area", "publisher", "lifecycle", "page"]);
const DETAIL_PARAMS = new Set<string>();
const START_PARAMS = new Set(["goal", "context"]);
const COMPARE_PARAMS = new Set([
  "source", "target", "items", "relationshipType", "intent", "mappingSource", "compareRun", "page",
]);
const COMPARE_MODES = new Set(["intent", "relationships"]);
const RETIRED_COMPARE_MODES = new Set(["stig-chain", "baseline-compare", "threat-chain"]);
const OBSOLETE_COMPARE_PARAMS = [
  "includeCandidates", "chainCatalog", "chainBenchmark", "chainItem", "baselineA", "baselineB",
  "compareView", "provenance", "confidence",
] as const;
const LEARN_PARAMS = new Set(["pattern"]);
const BUILD_PARAMS = new Set(["templateType", "framework", "format", "environment", "baseline", "controlFamily", "category", "q"]);
const SOURCE_PARAMS = new Set(["layer", "q", "source", "publisher", "provenance", "eligibility", "lifecycle", "access"]);
const SOURCE_LAYERS = new Set(["publication", "connection", "ingestion", "organization"]);
const RESOURCE_PARAMS = new Set(["q", "resourceType", "collection", "owner", "sort", "showAll", "viewMode"]);
const RETIRED_PARAMS = new Set(["q"]);

function normalizedPath(input: string): { path: string; params: URLSearchParams } {
  const [rawPath, rawQuery = ""] = input.replace(/^#/, "").split("?", 2);
  const path = `/${rawPath.replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
  return { path: path === "" ? "/" : path, params: new URLSearchParams(rawQuery) };
}

function permittedParams(params: URLSearchParams, permitted: Set<string>): { params: URLSearchParams; discarded: boolean } {
  const next = new URLSearchParams();
  const tags = new Set<string>();
  let discarded = false;
  for (const [key, value] of params) {
    if (!permitted.has(key) || value.length > (key === "atlasPins" ? 1800 : 240)) {
      discarded = true;
      continue;
    }
    if (key === "relationshipView" && !["path", "map", "list", "purpose", "rmf"].includes(value)) {
      discarded = true;
      continue;
    }
    if (key === "sourceView" && !["purpose", "rmf"].includes(value)) {
      discarded = true;
      continue;
    }
    if (
      (key === "crosswalk" || key === "workbench") &&
      !["intent", "relationships", "stig-chain", "baseline-compare", "threat-chain"].includes(value)
    ) {
      discarded = true;
      continue;
    }
    if (
      ["browseAll", "showAll", "connectedOnly", "includeCandidates", "compareRun"].includes(key) &&
      value !== "true"
    ) {
      discarded = true;
      continue;
    }
    if (key === "intent" && !["frameworks", "item-mapping"].includes(value)) {
      discarded = true;
      continue;
    }
    if (key === "sort" && !["relevance", "identifier", "title", "publication", "name", "checked"].includes(value)) {
      discarded = true;
      continue;
    }
    if (key === "view" && value !== "map") {
      discarded = true;
      continue;
    }
    if (key === "viewMode" && value !== "map") {
      discarded = true;
      continue;
    }
    if (key === "page" && !/^[1-9]\d*$/.test(value)) {
      discarded = true;
      continue;
    }
    if (key === "tag") {
      if (!TAXONOMY_TAG_BY_ID.has(value)) {
        discarded = true;
        continue;
      }
      tags.add(value);
      continue;
    }
    next.set(key, value);
  }
  for (const tag of [...tags].sort()) next.append("tag", tag);
  return { params: next, discarded };
}

function withParams(path: string, params: URLSearchParams): string {
  // Colons are valid in hash-route path and query components. Keeping them
  // readable prevents public links from exposing percent-encoded record IDs.
  const query = params.toString().replaceAll("%3A", ":");
  return query ? `${path}?${query}` : path;
}

function routeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%3A", ":");
}

/**
 * Resolves every supported hash path into its one canonical URL. This is the
 * only compatibility table and is deliberately independent from rendering.
 */
/** Old public paths remain accepted while every new link uses the canonical IA. */
const PUBLIC_NAME_ALIASES: Readonly<Record<string, string>> = {
  "/explore": "/atlas",
  "/search": "/library",
  "/learn": "/guides",
  "/documents": "/build",
  "/help": "/about",
};

function resolvePublicNameAlias(path: string): string {
  const exact = PUBLIC_NAME_ALIASES[path];
  if (exact) return exact;
  for (const [alias, canonical] of Object.entries(PUBLIC_NAME_ALIASES)) {
    if (path.startsWith(`${alias}/`)) {
      return `${canonical}${path.slice(alias.length)}`;
    }
  }
  return path;
}

export function canonicalizeHashLocation(input: string): CanonicalRoute {
  const { path: initialPath, params: incoming } = normalizedPath(input);
  let path = resolvePublicNameAlias(initialPath);
  let params = incoming;
  let discarded = false;
  let recoveredRetiredCompare = false;

  if (path === "/catalog") {
    path = "/library";
  } else if (/^\/catalog\/[^/]+$/.test(path)) {
    path = path.replace(/^\/catalog/, "/library/publication");
  }

  // The startup shim owns pre-hash `?view=...` links. Preserve them until it
  // moves the full query into the HashRouter instead of discarding state first.
  if (path === "/" && (params.has("view") || params.has("q"))) {
    return { canonicalPath: withParams(path, params), requiresReplace: false, recoveryMessage: "" };
  }

  const legacyTemplate = path === "/build" ? params.get("templateType") || "" : "";
  if (legacyTemplate) {
    params.delete("templateType");
    if (isKnownBuildDocument(legacyTemplate)) {
      path = `/build/documents/${encodeURIComponent(legacyTemplate)}`;
    } else {
      discarded = true;
    }
  }

  // The document browser is the default Templates state and canonicalises to
  // the bare path; the longer form remains accepted.
  if (path === "/build/documents") {
    path = "/build";
  }

  if (path === "/build/resources") {
    path = "/resources";
  } else if (/^\/build\/resources\/[^/]+$/.test(path)) {
    path = path.replace(/^\/build\/resources/, "/resources");
  } else if (path === "/library" && params.get("kind") === "tools-communities") {
    path = "/resources";
    params.delete("kind");
  } else if (/^\/library\/resource\/[^/]+$/.test(path)) {
    path = path.replace(/^\/library\/resource/, "/resources");
  }

  // Public links keep identity in the path, not an encoded query value. The
  // old query shape remains a supported input and is rewritten on arrival.
  if (path === "/atlas" && params.get("node")) {
    path = `/atlas/${routeSegment(params.get("node") || "")}`;
    params.delete("node");
  }
  const atlasPath = path.match(/^\/atlas\/([^/]+)$/);
  if (atlasPath) {
    path = `/atlas/${routeSegment(decodeURIComponent(atlasPath[1]))}`;
  }

  if (path === "/compare") {
    const requestedCompareModes = [params.get("crosswalk"), params.get("workbench")]
      .filter((value): value is string => Boolean(value));
    const retiredModeRequested = requestedCompareModes.some((mode) =>
      RETIRED_COMPARE_MODES.has(mode)
    );
    const compareMode = requestedCompareModes[0] || "";
    params.delete("crosswalk");
    params.delete("workbench");
    if (retiredModeRequested) {
      recoveredRetiredCompare = true;
      discarded = true;
    } else if (compareMode && compareMode !== "intent") {
      if (COMPARE_MODES.has(compareMode)) {
        path = `/compare/${compareMode}`;
      } else {
        discarded = true;
      }
    } else if (compareMode && !COMPARE_MODES.has(compareMode)) {
      discarded = true;
    }
  }

  const comparePath = path.match(/^\/compare\/([^/]+)$/);
  if (comparePath) {
    const compareMode = decodeURIComponent(comparePath[1]);
    if (RETIRED_COMPARE_MODES.has(compareMode)) {
      path = "/compare";
      recoveredRetiredCompare = true;
      discarded = true;
    } else if (compareMode === "intent") {
      path = "/compare";
    } else if (!COMPARE_MODES.has(compareMode)) {
      path = "/compare";
      discarded = true;
    }
  }

  if (path === "/compare" || /^\/compare\/[^/]+$/.test(path)) {
    for (const key of OBSOLETE_COMPARE_PARAMS) {
      if (params.has(key)) {
        params.delete(key);
        recoveredRetiredCompare = true;
        discarded = true;
      }
    }
  }

  let permitted: Set<string> | null = null;
  if (path === "/atlas" || /^\/atlas\/[^/]+$/.test(path)) permitted = ATLAS_PARAMS;
  if (path === "/library") permitted = SEARCH_PARAMS;
  if (path === "/resources") permitted = RESOURCE_PARAMS;
  if (/^\/library\/publication\/[^/]+$/.test(path)) permitted = CATALOG_PARAMS;
  if (/^\/library\/resource\/[^/]+$/.test(path)) permitted = DETAIL_PARAMS;
  if (/^\/resources\/[^/]+$/.test(path)) permitted = RESOURCE_PARAMS;
  if (path.startsWith("/record/")) permitted = DETAIL_PARAMS;
  if (path === "/start") permitted = START_PARAMS;
  if (path === "/compare" || /^\/compare\/[^/]+$/.test(path)) permitted = COMPARE_PARAMS;
  if (path === "/guides") permitted = LEARN_PARAMS;
  if (path === "/build" || /^\/build\/(?:tasks(?:\/[^/]+)?|documents(?:\/[^/]+)?)$/.test(path)) permitted = BUILD_PARAMS;
  if (path === "/sources") permitted = SOURCE_PARAMS;
  if (path === "/retired") permitted = RETIRED_PARAMS;
  if (permitted) {
    const result = permittedParams(params, permitted);
    params = result.params;
    discarded ||= result.discarded;
  } else if (params.size > 0 && !path.startsWith("/catalog/")) {
    params = new URLSearchParams();
    discarded = true;
  }

  if (path === "/sources") {
    const layer = params.get("layer") || "";
    if (layer && !SOURCE_LAYERS.has(layer)) {
      params.delete("layer");
      discarded = true;
    }
  }

  const taskMatch = path.match(/^\/build\/tasks\/([^/]+)$/);
  if (taskMatch && !isKnownBuildTask(decodeURIComponent(taskMatch[1]))) {
    path = "/build";
    discarded = true;
  }
  const documentMatch = path.match(/^\/build\/documents\/([^/]+)$/);
  if (documentMatch) {
    const documentName = decodeURIComponent(documentMatch[1]);
    if (!isKnownBuildDocument(documentName)) {
      path = "/build/documents";
      discarded = true;
    } else {
      const format = params.get("format") || "";
      if (format && !isValidBuildFormat(documentName, format)) {
        params.delete("format");
        discarded = true;
      }
      const framework = params.get("framework") || "";
      if (!isValidBuildSourceContext(framework)) {
        params.delete("framework");
        discarded = true;
      }
    }
  }

  const canonicalPath = withParams(path, params);
  return {
    canonicalPath,
    requiresReplace: canonicalPath !== input.replace(/^#/, ""),
    recoveryMessage: recoveredRetiredCompare
      ? "This Compare link used a retired workflow. Start a published crosswalk here."
      : discarded
        ? "Some unsupported link settings were removed. You can continue from this page."
        : "",
  };
}
