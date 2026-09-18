/** Bounded, shareable research state. This is navigation state, never a mapping. */
export type AtlasResearchState = {
  atlasResearch: "" | "path" | "shared";
  atlasPins: string;
  atlasFrom: string;
  atlasTo: string;
  atlasDirection: "forward" | "either";
  atlasHops: string;
};

export function researchId(value: unknown): string {
  return typeof value === "string" && value.length <= 240 && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ? value.trim() : "";
}

export function parseResearchPins(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 1800) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(researchId).filter(Boolean))].slice(0, 6);
  } catch { return []; }
}

export function normalizeResearchState(input: Partial<Record<keyof AtlasResearchState, unknown>>): AtlasResearchState {
  const pins = parseResearchPins(input.atlasPins);
  const from = researchId(input.atlasFrom);
  const to = researchId(input.atlasTo);
  return {
    atlasResearch: input.atlasResearch === "shared" ? "shared" : input.atlasResearch === "path" ? "path" : "",
    atlasPins: pins.length ? JSON.stringify(pins) : "",
    atlasFrom: from,
    atlasTo: to,
    atlasDirection: input.atlasDirection === "either" ? "either" : "forward",
    atlasHops: /^[1-6]$/.test(String(input.atlasHops)) ? String(input.atlasHops) : "4",
  };
}
