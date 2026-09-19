import type { TerritoryRoute } from "./atlasTerritoryRoutes";

export const MIN_PINS = 2;
export const MAX_PINS = 6;

export type SharedGround = {
  /** Publications with a published route to every pin. */
  readonly all: readonly string[];
  /** Publications with a published route to at least two, but not every, pin. */
  readonly some: readonly { readonly id: string; readonly pins: readonly string[] }[];
  /** Publications with a published route to exactly one pin. */
  readonly unique: Readonly<Record<string, readonly string[]>>;
  /** Published routes running directly between two pins. */
  readonly direct: readonly TerritoryRoute[];
  /** True when nothing is shared and no pins are directly connected. This is an answer, not a failure. */
  readonly none: boolean;
};

const neighborsOf = (routes: readonly TerritoryRoute[], id: string) =>
  new Set(routes.filter((r) => r.a === id || r.b === id).map((r) => (r.a === id ? r.b : r.a)));

/**
 * Publication-level shared ground for pinned publications, from published routes only.
 * Being neighbours on the map, sharing a publisher or sharing a kind is never evidence.
 */
export function sharedGround(routes: readonly TerritoryRoute[], pins: readonly string[]): SharedGround {
  const unique = [...new Set(pins)];
  const pinSet = new Set(unique);
  const neighbors = new Map(unique.map((p) => [p, neighborsOf(routes, p)]));
  const counts = new Map<string, string[]>();
  for (const [pin, set] of neighbors) for (const id of set) if (!pinSet.has(id)) counts.set(id, [...(counts.get(id) || []), pin]);
  const all: string[] = [];
  const some: { id: string; pins: string[] }[] = [];
  const only: Record<string, string[]> = Object.fromEntries(unique.map((p) => [p, []]));
  for (const [id, via] of [...counts].sort(([x], [y]) => x.localeCompare(y))) {
    if (via.length === unique.length && unique.length >= MIN_PINS) all.push(id);
    else if (via.length >= 2) some.push({ id, pins: via });
    else only[via[0]].push(id);
  }
  const direct = routes.filter((r) => pinSet.has(r.a) && pinSet.has(r.b));
  return { all, some, unique: only, direct, none: all.length === 0 && some.length === 0 && direct.length === 0 };
}

/** Compare is offered only for exactly two publications with a supported handoff. */
export function compareHandoff(pins: readonly string[], publicationIds: ReadonlySet<string>): { source: string; target: string } | null {
  if (pins.length !== 2 || !pins.every((p) => publicationIds.has(p)) || pins[0] === pins[1]) return null;
  return { source: pins[0], target: pins[1] };
}

/** Add a pin without exceeding the limit; returns null when the tray is full. */
export function addPin(pins: readonly string[], id: string): string[] | null {
  if (pins.includes(id)) return [...pins];
  return pins.length >= MAX_PINS ? null : [...pins, id];
}
export const removePin = (pins: readonly string[], id: string): string[] => pins.filter((p) => p !== id);
