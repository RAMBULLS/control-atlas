import { selectedNavFor } from "./routeIdentity";
import type { ViewState } from "./viewState";

export function activeNavForState(state: ViewState): ViewState["view"] | null {
  return selectedNavFor(state.view);
}

export function isStaticViewWithoutBundle(view: ViewState["view"]) {
  return (
    view === "about" ||
    view === "home" ||
    view === "patterns" ||
    view === "start-here" ||
    view === "search" ||
    view === "not-found"
  );
}

export function requiresFullGraph(state: ViewState) {
  return (
    // The Atlas landing uses the compact Atlas-spine artifact. Baseline and
    // RMF choices still need the monolithic graph; Atlas area,
    // publication, and native-group choices read from atlas-spine.json. A
    // focused record uses its neighborhood shard. These boundaries are
    // enforced by the bootstrap payload tests.
    (state.view === "atlas-map" &&
      !state.atlasResearch &&
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
    (state.view === "templates" && Boolean(state.templateType))
  );
}
