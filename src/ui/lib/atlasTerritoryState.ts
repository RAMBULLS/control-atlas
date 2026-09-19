import { parseResearchPins } from "./atlasResearchState";
import type { ViewState } from "./viewState";

type AtlasViewState = Extract<ViewState, { view: "atlas-map" }>;

export type AtlasSurface = "territory" | "classic";

/**
 * The territory sheet is the default Atlas surface. A URL that carries a scope from the earlier
 * hierarchy, benchmark, baseline, RMF or relationship-filter views keeps opening that view so
 * saved and shared links still resolve. `landscape` is the earlier name for "no lens" and
 * `atlasLanding` only ever grouped the overview, so both open the territory sheet.
 */
export function atlasSurfaceFor(state: Partial<AtlasViewState>): AtlasSurface {
  // A research question is always answered on the territory sheet, whatever older scope rides along.
  if (state.atlasResearch) return "territory";
  const legacyScope =
    (state.atlasAxis && state.atlasAxis !== "landscape")
    || state.atlasFamily || state.atlasBenchmark || state.atlasBaseline || state.atlasRmfStep
    || state.atlasLensFamily || state.atlasParent || state.atlasStage || state.atlasPivotTrail
    || state.sourceView === "purpose" || state.sourceView === "rmf" || state.sourceView === "rmf-lifecycle"
    || state.relationshipView || state.relationshipType || state.relationshipGroup
    || state.provenance || state.confidence || state.nodeType || state.includeCandidates || state.relationshipSearch;
  return legacyScope ? "classic" : "territory";
}

export type TerritoryFocus =
  | { kind: "overview" }
  | { kind: "territory"; id: string }
  | { kind: "publication"; id: string }
  | { kind: "record"; id: string };

export function territoryFocusOf(state: Partial<AtlasViewState>): TerritoryFocus {
  if (state.node) return { kind: "record", id: state.node };
  if (state.atlasFramework) return { kind: "publication", id: state.atlasFramework };
  if (state.atlasLimb) return { kind: "territory", id: state.atlasLimb };
  return { kind: "overview" };
}

export type TerritoryMode = "explore" | "path" | "upstream" | "shared";
export function territoryModeOf(state: Partial<AtlasViewState>): TerritoryMode {
  const mode = state.atlasResearch;
  if (mode === "path" || mode === "upstream" || mode === "shared") return mode;
  return "explore";
}

export type TerritoryTarget = {
  limb?: string;
  framework?: string;
  node?: string;
  pins?: readonly string[];
  mode?: TerritoryMode;
  from?: string;
  to?: string;
  /** Publisher name for the Publisher layer; empty for no layer. */
  publisher?: string;
};

/**
 * A complete, explicit atlas-map patch for a territory target. Navigation replaces route state, so
 * every field a target does not name is cleared; computed path hops are never written to the URL.
 */
export function territoryPatch(target: TerritoryTarget = {}): Partial<AtlasViewState> {
  const pins = [...(target.pins || [])].slice(0, 6);
  const mode = target.mode && target.mode !== "explore" ? target.mode : "";
  return {
    node: target.node || "",
    atlasLimb: target.limb || "",
    atlasFramework: target.framework || "",
    atlasPins: pins.length ? JSON.stringify(pins) : "",
    atlasResearch: mode,
    atlasFrom: mode && target.from ? target.from : "",
    atlasTo: mode === "path" && target.to ? target.to : "",
    atlasLayer: target.publisher ? `publisher:${target.publisher}` : "",
  };
}

/** The territory target a state currently describes, so a change can keep everything else. */
export function territoryTargetOf(state: Partial<AtlasViewState>): TerritoryTarget {
  return {
    limb: state.atlasLimb || "", framework: state.atlasFramework || "", node: state.node || "",
    pins: parseResearchPins(state.atlasPins), mode: territoryModeOf(state),
    from: state.atlasFrom || "", to: state.atlasTo || "", publisher: (state.atlasLayer || "").replace(/^publisher:/, ""),
  };
}

/** True when something the reader added (pins, path, layer) could be cleared. */
export function territoryHasWork(state: Partial<AtlasViewState>): { pins: boolean; path: boolean; layer: boolean; focus: boolean } {
  return {
    pins: parseResearchPins(state.atlasPins).length > 0,
    path: territoryModeOf(state) === "path" || territoryModeOf(state) === "upstream",
    layer: !!state.atlasLayer,
    focus: territoryFocusOf(state).kind !== "overview",
  };
}
