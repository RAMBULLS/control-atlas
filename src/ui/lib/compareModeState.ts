import type { CompareCrosswalk, ViewState } from "./viewState";

export type CompareModeId =
  | "frameworks"
  | "item-mapping";

type CompareState = Extract<ViewState, { view: "matrix" }>;

export const COMPARE_MODES = Object.freeze([
  {
    id: "frameworks",
    label: "Frameworks",
    crosswalk: "relationships",
    // "mappingSource" is deliberately absent here: it is never a mandatory
    // user choice. resolveMappingSource below decides, from the pair's real
    // evidence, whether it auto-selects (exactly one source), defaults to
    // "all" (multiple sources, no filter chosen), or blocks readiness (zero
    // sources, or a stale value that no longer resolves). See T3.6/T3.7.
    required: ["source", "target"],
  },
  {
    id: "item-mapping",
    label: "Specific item",
    crosswalk: "relationships",
    required: ["source", "items", "target"],
  },
] as const);

export type CompareStep = {
  id: string;
  label: string;
  description?: string;
};

export const COMPARE_MODE_STEPS: Record<CompareModeId, readonly CompareStep[]> = {
  frameworks: [
    { id: "source", label: "01 / Source", description: "Choose a framework" },
    { id: "target", label: "02 / Target", description: "Choose framework to compare" },
    { id: "results", label: "03 / Results", description: "Review published mappings" },
  ],
  "item-mapping": [
    { id: "item", label: "01 / Item", description: "Choose publication & item" },
    { id: "target", label: "02 / Target", description: "Choose target framework" },
    { id: "results", label: "03 / Results", description: "Review published mappings" },
  ],
};

export function getCompareSteps(modeId: CompareModeId): readonly CompareStep[] {
  return COMPARE_MODE_STEPS[modeId] || [];
}

export function getCompareCurrentStep(
  modeId: CompareModeId,
  state: CompareState,
): number {
  switch (modeId) {
    case "frameworks":
      if (state.compareRun === "true" && state.source && state.target) return 3;
      if (state.source) return 2;
      return 1;
    case "item-mapping":
      if (state.compareRun === "true" && state.source && state.items && state.target) return 3;
      if (state.source && state.items) return 2;
      return 1;
    default:
      return 1;
  }
}

export function compareModeForState(state: CompareState) {
  return (
    COMPARE_MODES.find((mode) => mode.id === state.intent) ||
    COMPARE_MODES.find((mode) => mode.crosswalk === state.crosswalk) ||
    COMPARE_MODES.find((mode) => mode.crosswalk === (state as any).workbench) ||
    COMPARE_MODES.find((mode) => mode.id === (state as any).workbench) ||
    (state.source || state.target ? COMPARE_MODES.find((mode) => mode.id === "frameworks") : null) ||
    null
  );
}

export function activateCompareMode(modeId: CompareModeId): Partial<CompareState> {
  const mode = COMPARE_MODES.find((entry) => entry.id === modeId);
  if (!mode) return { crosswalk: "intent", intent: "", compareRun: "" };
  return {
    crosswalk: mode.crosswalk as CompareCrosswalk,
    intent: mode.id,
    source: "",
    target: "",
    items: "",
    mappingSource: "",
    chainCatalog: "",
    chainBenchmark: "",
    chainItem: "",
    baselineA: "",
    baselineB: "",
    compareRun: "",
  };
}

const MODES_WITH_MAPPING_SOURCE = new Set(["frameworks", "item-mapping"]);

export type MappingSourceResolution =
  // No mapping source has any evidence for this pair yet (scope incomplete,
  // or — for a stale deep link — the pair no longer has one at all).
  | { status: "none" }
  // Exactly one source: never a user decision, resolved automatically.
  | { status: "auto"; value: string }
  // Multiple sources, no filter chosen: show every published mapping.
  | { status: "all" }
  // Multiple sources, a valid filter chosen: narrow to that one source.
  | { status: "filtered"; value: string }
  // A mappingSource value is set but is not one of the pair's real sources
  // (stale deep link) — never silently treated as ready.
  | { status: "invalid" };

export function resolveMappingSource(
  eligibleMappingSources: readonly string[],
  currentValue: string,
): MappingSourceResolution {
  if (!eligibleMappingSources.length) return { status: "none" };
  if (eligibleMappingSources.length === 1) {
    return { status: "auto", value: eligibleMappingSources[0] };
  }
  if (!currentValue) return { status: "all" };
  if (!eligibleMappingSources.includes(currentValue)) return { status: "invalid" };
  return { status: "filtered", value: currentValue };
}

export function nextMissingCompareInput(
  state: CompareState,
  eligibleMappingSources?: readonly string[],
): string {
  const mode = compareModeForState(state);
  if (!mode) return "comparison type";
  for (const field of mode.required) {
    if (!state[field]) return field;
  }
  if (MODES_WITH_MAPPING_SOURCE.has(mode.id) && eligibleMappingSources) {
    const resolution = resolveMappingSource(
      eligibleMappingSources,
      state.mappingSource,
    );
    if (resolution.status === "none") {
      return "a published mapping between these publications";
    }
    if (resolution.status === "invalid") {
      return "a valid published mapping source";
    }
  }
  return "";
}

export function compareConfigurationReady(
  state: CompareState,
  eligibleMappingSources?: readonly string[],
): boolean {
  return nextMissingCompareInput(state, eligibleMappingSources) === "";
}
