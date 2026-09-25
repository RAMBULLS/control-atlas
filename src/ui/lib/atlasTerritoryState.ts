import { parseResearchPins } from "./atlasResearchState";
import { normalizeContextIds } from "./atlasTerritoryContext";
import { normalizeJourneyId } from "./atlasJourneyIds";
import { normalizeAtlasContext, normalizeAtlasDataset, type ViewState } from "./viewState";

type AtlasViewState = Extract<ViewState, { view: "atlas-map" }>;

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
  /** Governed tag ids chosen as context. */
  context?: readonly string[];
  /** Dataset a shared view was made from. */
  dataset?: string;
  /** Practitioner journey id; Control Atlas navigation, never a relationship. */
  journey?: string;
  /** "list" opens a focused record's full connection list. */
  list?: boolean;
  /** Relationship type filter for that list. */
  listType?: string;
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
    atlasContext: normalizeAtlasContext([...(target.context || [])]),
    atlasDataset: normalizeAtlasDataset(target.dataset || ""),
    atlasJourney: normalizeJourneyId(target.journey),
    relationshipView: target.node && target.list ? "list" : "",
    relationshipType: target.node && target.list ? target.listType || "" : "",
  };
}

/** The territory target a state currently describes, so a change can keep everything else. */
export function territoryTargetOf(state: Partial<AtlasViewState>): TerritoryTarget {
  return {
    limb: state.atlasLimb || "", framework: state.atlasFramework || "", node: state.node || "",
    pins: parseResearchPins(state.atlasPins), mode: territoryModeOf(state),
    from: state.atlasFrom || "", to: state.atlasTo || "", publisher: (state.atlasLayer || "").replace(/^publisher:/, ""),
    context: normalizeContextIds(state.atlasContext || ""),
    dataset: state.atlasDataset || "",
    journey: state.atlasJourney || "",
    list: !!state.node && state.relationshipView === "list",
    listType: state.relationshipType || "",
  };
}

/** True when something the reader added (pins, path, layer) could be cleared. */
export function territoryHasWork(state: Partial<AtlasViewState>): { pins: boolean; path: boolean; layer: boolean; focus: boolean; context: boolean } {
  return {
    pins: parseResearchPins(state.atlasPins).length > 0,
    path: territoryModeOf(state) === "path" || territoryModeOf(state) === "upstream",
    layer: !!state.atlasLayer,
    context: normalizeContextIds(state.atlasContext || "").length > 0,
    focus: territoryFocusOf(state).kind !== "overview",
  };
}

/**
 * Contextual clear actions. Each returns a complete target that changes only what its name says and
 * keeps everything else (focus, pins, path, context, layer, source dataset) exactly as it was.
 * There is deliberately no action that clears the whole scene.
 */
export type ClearableTarget = TerritoryTarget & { direction?: "forward" | "either" };

/** Return to the geographic overview: leaves focus, the journey, the connection list and any path or shared-ground presentation. Keeps pins, context, layer and dataset. */
export const overviewTarget = (t: ClearableTarget): ClearableTarget => ({
  ...t, limb: "", framework: "", node: "", mode: "explore", from: "", to: "", direction: "forward", journey: "", list: false, listType: "",
});

/** Remove the research path (mode, endpoints, direction). Keeps focus, pins, context, layer and dataset. */
export const clearPathTarget = (t: ClearableTarget): ClearableTarget => ({
  ...t, mode: t.mode === "shared" ? t.mode : "explore", from: "", to: "", direction: "forward",
});

/** Remove pins, and leave shared-ground mode because it needs pins. Keeps everything else. */
export const clearPinsTarget = (t: ClearableTarget): ClearableTarget => ({
  ...t, pins: [], mode: t.mode === "shared" ? "explore" : t.mode,
});

/** Remove the Program/Product/Asset context only. */
export const clearContextTarget = (t: ClearableTarget): ClearableTarget => ({ ...t, context: [] });

/** Turn the publisher layer off. */
export const clearLayerTarget = (t: ClearableTarget): ClearableTarget => ({ ...t, publisher: "" });

/** Which clear actions apply right now. Irrelevant ones are not shown. */
export function territoryClearActions(state: Partial<AtlasViewState>): { overview: boolean; path: boolean; pins: boolean; context: boolean; layer: boolean } {
  const work = territoryHasWork(state);
  const mode = territoryModeOf(state);
  return {
    overview: work.focus || mode !== "explore",
    path: work.path,
    pins: work.pins,
    context: work.context,
    layer: work.layer,
  };
}
