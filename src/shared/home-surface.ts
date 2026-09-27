/**
 * Build-time Home surface (issue 283). vite.config.ts computes it once with
 * src/shared/home-surface-build.ts and uses the same values for the static
 * first paint and for React, so the two never differ and Home fetches nothing
 * to render the Atlas map, the topics or the source changes.
 */
export type HomeTopic = { id: string; label: string; expansion: string; href: string };

export type HomeMapArea = {
  id: string;
  /** Area color token, e.g. --ca-area-governance. */
  token: string;
  d: string;
  empty: boolean;
  name: { x: number; y: number; lines: string[] };
};
export type HomeMap = {
  viewBox: string;
  coast: string;
  areas: HomeMapArea[];
  landmarks: { id: string; alias: string; x: number; y: number }[];
};

export type HomeSourceChange = {
  id: string;
  date: string;
  dateLabel: string;
  title: string;
  fact: string;
  href: string;
  view: string;
  patch: Record<string, unknown>;
  linkLabel: string;
};
export type HomePulse = {
  /** Newest source change per publication, newest first. */
  changes: HomeSourceChange[];
  /** Publications that changed on the newest change date; drives the phone row. */
  recent: { count: number; date: string; dateLabel: string } | null;
};

export type HomeSurface = {
  topics: HomeTopic[];
  /** The collapsed topic trigger: the first topics and how many more there are. */
  topicsHint: string;
  map: HomeMap;
  pulse: HomePulse;
};

declare global {
  var __HOME_SURFACE__: HomeSurface | undefined;
}

export const HOME_SURFACE: HomeSurface = globalThis.__HOME_SURFACE__ ?? {
  topics: [],
  topicsHint: "",
  map: { viewBox: "0 0 1 1", coast: "", areas: [], landmarks: [] },
  pulse: { changes: [], recent: null },
};
