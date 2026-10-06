import treeSpine from "../../../data/curated/tree-spine.json";
import {
  TERRITORY_GEOMETRY, coastPolygon, landmarkPosition, territoryPolygon, type Pt, type TerritoryGeometry,
} from "./atlasTerritoryGeography";
import type { TerritoryIndex, TerritoryIndexRoute, TerritoryPublication } from "./atlasTerritoryIndex";

export type TerritoryArea = {
  id: string; key: string; label: string; blurb: string;
  polygon: Pt[]; name: { x: number; y: number; lines: readonly string[] };
  publicationIds: string[]; empty: boolean;
};
export type TerritoryModel = {
  geometry: TerritoryGeometry;
  areas: TerritoryArea[];
  areaById: Map<string, TerritoryArea>;
  coast: Pt[];
  publications: TerritoryPublication[];
  publicationById: Map<string, TerritoryPublication>;
  routes: TerritoryIndexRoute[];
  routeByKey: Map<string, TerritoryIndexRoute>;
  publishers: string[];
  alias: (id: string) => string;
  isMajor: (id: string) => boolean;
  position: (id: string) => Pt;
  routesFor: (id: string) => TerritoryIndexRoute[];
  areaOf: (id: string) => TerritoryArea;
};

export function buildTerritoryModel(index: TerritoryIndex, geometry: TerritoryGeometry = TERRITORY_GEOMETRY): TerritoryModel {
  const publicationById = new Map(index.publications.map((p) => [p.id, p]));
  const spine = new Map(treeSpine.limbs.map((l) => [l.id, l]));
  const areas: TerritoryArea[] = geometry.territories.map((t) => {
    const limb = spine.get(t.id);
    const publicationIds = index.publications.filter((p) => p.area === t.id).map((p) => p.id);
    return { id: t.id, key: t.key, label: limb?.label || t.id, blurb: limb?.blurb || "", polygon: territoryPolygon(geometry, t.id),
      name: t.name, publicationIds, empty: publicationIds.length === 0 };
  });
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const routeByKey = new Map(index.routes.map((r) => [r.key, r]));
  const alias = (id: string) => geometry.presentation[id]?.alias || publicationById.get(id)?.name || id;
  return {
    geometry, areas, areaById, coast: coastPolygon(geometry),
    publications: index.publications, publicationById, routes: index.routes, routeByKey,
    publishers: [...new Set(index.publications.map((p) => p.publisher).filter(Boolean))].sort(),
    alias,
    isMajor: (id) => !!geometry.presentation[id]?.major,
    position: (id) => {
      const p = landmarkPosition(geometry, id);
      if (!p) throw new Error(`Publication ${id} has no assigned slot.`);
      return p;
    },
    routesFor: (id) => index.routes.filter((r) => r.a === id || r.b === id),
    areaOf: (id) => areaById.get(publicationById.get(id)!.area)!,
  };
}

export type Hit = { type: "publication"; id: string; label: string; sub: string; strong?: boolean };

/** Publication search over names, reviewed aliases, publishers and kinds. Records use the library index. */
export function searchPublications(model: TerritoryModel, query: string, limit = 5): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const score = (p: TerritoryPublication) => {
    const alias = model.alias(p.id).toLowerCase(); const name = p.name.toLowerCase();
    if (alias === q || name === q || p.id === q) return 0;
    const boundary = (t: string) => t.startsWith(q) && !/[a-z0-9]/.test(t.charAt(q.length));
    if (boundary(alias) || boundary(name)) return 1;
    if (alias.startsWith(q) || name.startsWith(q)) return 1.5;
    if (alias.includes(q) || name.includes(q)) return 2;
    if (p.publisher.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q)) return 3;
    return 99;
  };
  return model.publications.map((p) => ({ p, s: score(p) })).filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || model.alias(a.p.id).localeCompare(model.alias(b.p.id))).slice(0, limit)
    .map(({ p, s }) => ({ type: "publication" as const, id: p.id, strong: s <= 1, label: model.alias(p.id),
      sub: `${p.kind} · ${p.publisher} · ${model.areaOf(p.id).label}` }));
}

export type View = { x: number; y: number; w: number; h: number };
export const fitView = (r: View, aspect: number): View => {
  let { x, y, w, h } = r;
  if (w / h < aspect) { const nw = h * aspect; x -= (nw - w) / 2; w = nw; } else { const nh = w / aspect; y -= (nh - h) / 2; h = nh; }
  return { x, y, w, h };
};
export const boundsOf = (pts: readonly Pt[], pad: number, minW = 460, minH = 300): View => {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs) - pad; let x1 = Math.max(...xs) + pad; let y0 = Math.min(...ys) - pad; let y1 = Math.max(...ys) + pad;
  if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
  if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
