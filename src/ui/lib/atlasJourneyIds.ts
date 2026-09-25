/**
 * Journey ids, kept apart from the journey data so URL parsing stays in the small shell bundle.
 * tests/graph/atlasJourneys.test.ts requires this list to match JOURNEYS exactly.
 */
export const JOURNEY_IDS: readonly string[] = Object.freeze([
  "rmf", "stig", "zero-trust", "cmmc-cui", "fedramp", "controls", "assessment", "threats", "working-files",
]);
const KNOWN = new Set(JOURNEY_IDS);
export const normalizeJourneyId = (value: string | undefined | null): string => (value && KNOWN.has(value) ? value : "");
