/** Old guide links resolve to the surface that now owns their job. */
export const GUIDE_REDIRECTS = Object.freeze({
  "understanding-rmf": { path: "/atlas?atlasJourney=rmf", view: "atlas-map", patch: { atlasJourney: "rmf" } },
  "hierarchy-and-relationships": { path: "/atlas", view: "atlas-map", patch: {} },
  "source-truth-and-notes": { path: "/sources", view: "sources", patch: {} },
  "search-eligibility-and-ranking": { path: "/library", view: "search", patch: {} },
  "read-a-record": { path: "/library", view: "search", patch: {} },
  "published-mappings-in-compare": { path: "/compare", view: "matrix", patch: {} },
  "starter-documents-and-judgment": { path: "/build", view: "templates", patch: {} },
} as const);
