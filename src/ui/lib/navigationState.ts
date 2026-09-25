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
    // The Atlas never needs the monolithic graph: the territory sheet reads its own small index and
    // a focused record uses its neighborhood shard. These boundaries are enforced by the bootstrap
    // payload tests.
    (state.view === "matrix" &&
      (state.compareRun === "true" ||
        (state.intent === "item-mapping" &&
          Boolean(state.source) &&
          Boolean(state.items)))) ||
    (state.view === "templates" && Boolean(state.templateType))
  );
}
