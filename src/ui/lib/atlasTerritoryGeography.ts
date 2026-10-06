import geometryJson from "../../../data/curated/atlas-territory-geography.json";

/**
 * Control Atlas territory geography contract (data/curated/atlas-territory-geography.json).
 *
 * This is navigation geography only. Adjacency and proximity never imply a published
 * relationship, authority, applicability, equivalence, dependency, mapping or legal
 * precedence; relationships are drawn only as evidence-backed routes.
 *
 * A landmark's position comes from an explicit slot id, never from array order, filters,
 * layers or counts. A new publication takes a free reserved slot; existing coordinates
 * change only when the geography version is deliberately revised.
 */
export type Pt = readonly [number, number];
export type TerritorySlot = { readonly id: string; readonly at: Pt };
export type TerritoryDefinition = {
  readonly id: string;
  readonly key: string;
  readonly ring: readonly string[];
  readonly name: { readonly x: number; readonly y: number; readonly lines: readonly string[] };
  readonly slots: readonly TerritorySlot[];
};
export type LandmarkPresentation = { readonly alias: string; readonly major: boolean };
export type TerritoryGeometry = {
  readonly version: string;
  readonly world: { readonly w: number; readonly h: number };
  readonly overview: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly vertices: Readonly<Record<string, Pt>>;
  readonly jogs: Readonly<Record<string, readonly Pt[]>>;
  readonly coast: readonly string[];
  readonly territories: readonly TerritoryDefinition[];
  readonly assignments: Readonly<Record<string, string>>;
  readonly presentation: Readonly<Record<string, LandmarkPresentation>>;
};

export const TERRITORY_GEOMETRY = geometryJson as unknown as TerritoryGeometry;
export const TERRITORY_GEOMETRY_VERSION = TERRITORY_GEOMETRY.version;

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Polygon for a ring of vertex names, including the jog points on each edge. */
export function ringPolygon(geometry: TerritoryGeometry, names: readonly string[]): Pt[] {
  const out: Pt[] = [];
  names.forEach((a, i) => {
    const b = names[(i + 1) % names.length];
    out.push(geometry.vertices[a]);
    const jog = geometry.jogs[edgeKey(a, b)];
    if (jog) out.push(...(a < b ? jog : [...jog].reverse()));
  });
  return out;
}

export function territoryPolygon(geometry: TerritoryGeometry, territoryId: string): Pt[] {
  const t = geometry.territories.find((x) => x.id === territoryId);
  if (!t) throw new Error(`Unknown territory ${territoryId}`);
  return ringPolygon(geometry, t.ring);
}
export const coastPolygon = (geometry: TerritoryGeometry): Pt[] => ringPolygon(geometry, geometry.coast);

export function slotPosition(geometry: TerritoryGeometry, slotId: string): Pt | null {
  for (const t of geometry.territories) for (const s of t.slots) if (s.id === slotId) return s.at;
  return null;
}
/** The only way a landmark gets a coordinate: its explicitly assigned slot. */
export function landmarkPosition(geometry: TerritoryGeometry, catalogId: string, assignments: Readonly<Record<string, string>> = geometry.assignments): Pt | null {
  const slot = assignments[catalogId];
  return slot ? slotPosition(geometry, slot) : null;
}
export const presentationFor = (geometry: TerritoryGeometry, catalogId: string): LandmarkPresentation | null => geometry.presentation[catalogId] || null;

/** First free reserved slot in a territory (by slot id order), or null when the territory is full. */
export function assignFreeSlot(geometry: TerritoryGeometry, territoryId: string, assignments: Readonly<Record<string, string>> = geometry.assignments): string | null {
  const t = geometry.territories.find((x) => x.id === territoryId);
  if (!t) return null;
  const taken = new Set(Object.values(assignments));
  return [...t.slots].map((s) => s.id).sort().find((id) => !taken.has(id)) || null;
}

export function pointInPolygon(p: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Structural rules of the contract. Returns a list of problems (empty when valid).
 * `catalogTerritory` maps every mapped catalog id to its canonical territory id
 * (tree-spine catalogLimbs + syntheticCatalogs); `territoryIds` are the canonical areas.
 */
export function validateTerritoryGeometry(
  geometry: TerritoryGeometry,
  catalogTerritory: Readonly<Record<string, string>>,
  territoryIds: readonly string[],
): string[] {
  const problems: string[] = [];
  if (!geometry.version) problems.push("geometry has no version");
  if (JSON.stringify(geometry.territories.map((t) => t.id).sort()) !== JSON.stringify([...territoryIds].sort())) problems.push("territories must be exactly the canonical Control Atlas areas");

  const edgeUse = new Map<string, { from: string; to: string }[]>();
  const noteEdges = (label: string, names: readonly string[]) => names.forEach((a, i) => {
    const b = names[(i + 1) % names.length];
    for (const n of [a, b]) if (!geometry.vertices[n]) problems.push(`${label} uses unknown vertex ${n}`);
    edgeUse.set(edgeKey(a, b), [...(edgeUse.get(edgeKey(a, b)) || []), { from: a, to: b }]);
  });
  geometry.territories.forEach((t) => noteEdges(t.id, t.ring));
  const coastEdges = new Set(geometry.coast.map((a, i) => edgeKey(a, geometry.coast[(i + 1) % geometry.coast.length])));
  for (const [key, uses] of edgeUse) {
    const shouldBeShared = !coastEdges.has(key);
    if (shouldBeShared && uses.length !== 2) problems.push(`border ${key} must be shared by exactly two territories (found ${uses.length})`);
    if (!shouldBeShared && uses.length !== 1) problems.push(`coast edge ${key} must belong to exactly one territory (found ${uses.length})`);
    if (uses.length === 2 && !(uses[0].from === uses[1].to && uses[0].to === uses[1].from)) problems.push(`border ${key} must run in opposite directions in its two territories`);
  }

  const slotOwner = new Map<string, string>();
  for (const t of geometry.territories) {
    const polygon = ringPolygon(geometry, t.ring);
    for (const s of t.slots) {
      if (slotOwner.has(s.id)) problems.push(`duplicate slot id ${s.id}`);
      slotOwner.set(s.id, t.id);
      if (!s.id.startsWith(`territory.${t.key}.slot.`)) problems.push(`slot ${s.id} must be named territory.${t.key}.slot.NN`);
      if (!pointInPolygon(s.at, polygon)) problems.push(`slot ${s.id} lies outside its territory`);
    }
  }

  const used = new Map<string, string>();
  for (const [catalog, territory] of Object.entries(catalogTerritory)) {
    const slot = geometry.assignments[catalog];
    if (!slot) { problems.push(`mapped publication ${catalog} has no assigned slot; give it a free reserved slot`); continue; }
    if (slotOwner.get(slot) !== territory) problems.push(`${catalog} is assigned ${slot}, which is outside its territory ${territory}`);
    if (used.has(slot)) problems.push(`slot ${slot} is assigned to both ${used.get(slot)} and ${catalog}`);
    used.set(slot, catalog);
    const p = geometry.presentation[catalog];
    if (!p || !p.alias) problems.push(`${catalog} needs a reviewed short display alias`);
    else if (/[…]|\.\.\.$/.test(p.alias)) problems.push(`${catalog} alias must be a deliberate short name, not a truncation`);
  }
  for (const catalog of Object.keys(geometry.assignments)) if (!catalogTerritory[catalog]) problems.push(`assignment for unmapped publication ${catalog}`);
  const aliases = Object.values(geometry.presentation).map((p) => p.alias);
  if (new Set(aliases).size !== aliases.length) problems.push("display aliases must be unique");
  if (!Object.values(geometry.presentation).some((p) => p.major)) problems.push("at least one reviewed major landmark is required");
  return problems;
}
