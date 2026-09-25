/**
 * Build-time Home surface: the Atlas journeys (from src/ui/lib/atlasJourneys.ts) and the
 * bounded Pulse slice (from data/generated/pulse.json). vite.config.ts computes it once and
 * uses the same values for the static first paint and for React, so the two never differ
 * and Home never fetches journey or Pulse data at runtime.
 */
export type HomeJourneyLink = { id: string; label: string; expansion: string; href: string };
export type HomePulseEvent = {
  id: string;
  type: string;
  typeLabel: string;
  date: string;
  dateKind: "accepted" | "shipped";
  dateLabel: string;
  title: string;
  summary: string;
  destination: { label: string; view: string; patch: Record<string, unknown>; href: string };
};
export type HomePulse = {
  datasetId: string;
  quiet: boolean;
  latestLabel: string;
  checkedLabel: string;
  events: HomePulseEvent[];
};
export type HomeSurface = { journeys: HomeJourneyLink[]; pulse: HomePulse };

declare global {
  var __HOME_SURFACE__: HomeSurface | undefined;
}

export const HOME_SURFACE: HomeSurface = globalThis.__HOME_SURFACE__ ?? {
  journeys: [],
  pulse: { datasetId: "", quiet: true, latestLabel: "", checkedLabel: "", events: [] },
};
