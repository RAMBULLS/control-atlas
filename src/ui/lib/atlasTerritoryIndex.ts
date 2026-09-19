import { isAtlasResearchEdge } from "./atlasResearch";
import type { AtlasGraphSourceEdge } from "./atlasGraphModel";
import { catalogDisplayNameFor, catalogProfileFor } from "./catalogProfiles";
import { areaPresentationForCatalog } from "./areaVisualLanguage";
import type { TerritoryRoute } from "./atlasTerritoryRoutes";

export const TERRITORY_INDEX_VERSION = 1;
export const TERRITORY_INDEX_MAX_BYTES = 256 * 1024;

export type TerritoryPublication = {
  id: string; name: string; publisher: string; kind: string; area: string; records: number;
};
export type TerritoryListed = { id: string; name: string; publisher: string };
export type TerritoryEvidenceSample = {
  edgeId: string; relationshipType: string; relationshipClass: string; from: string; to: string;
  lifecycle: string; locator: string; sourceName: string; sourceVersion: string;
};
export type TerritoryIndexRoute = TerritoryRoute & {
  readonly aToB: number; readonly bToA: number; readonly sample: TerritoryEvidenceSample;
};
export type TerritoryIndex = {
  schemaVersion: number;
  generatedAt: string;
  geometryVersion: string;
  publications: TerritoryPublication[];
  routes: TerritoryIndexRoute[];
  authority: TerritoryListed[];
  other: TerritoryListed[];
};
export type TerritoryManifest = {
  schemaVersion: number; generatedAt: string; sha256: string; bytes: number;
  publicationCount: number; routeCount: number; admittedEdgeCount: number;
};

type Row = Record<string, any>;
export type TerritoryBuildInput = {
  generatedAt: string;
  geometryVersion: string;
  /** Catalog ids that own a landmark (tree-spine catalogLimbs plus syntheticCatalogs). */
  catalogIds: readonly string[];
  identities: readonly Row[];
  nodes: readonly Row[];
  edges: readonly Row[];
  sources: readonly Row[];
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Publication-level routes from published record connections only. Admission is the same rule
 * the research engine applies, so a route drawn here is a route a record-level trace can follow.
 * Adjacent territories, shared kinds or shared publishers never create a route.
 */
export function buildTerritoryIndex(input: TerritoryBuildInput): { index: TerritoryIndex; admittedEdgeCount: number } {
  const identityByCatalog = new Map<string, Row>();
  for (const i of input.identities) if (i.catalog_id) identityByCatalog.set(i.catalog_id, i);
  const mapped = new Set(input.catalogIds);
  const catalogOf = new Map<string, string>(input.nodes.map((n) => [n.id, n.metadata?.catalog_id || ""]));
  const sources = new Map<string, Row>(input.sources.map((s) => [s.id, s]));

  const publications: TerritoryPublication[] = input.catalogIds.map((id) => {
    const identity = identityByCatalog.get(id);
    const area = areaPresentationForCatalog(id);
    if (!identity || !area) throw new Error(`Publication ${id} needs an identity and a Control Atlas area.`);
    return {
      id, name: catalogDisplayNameFor(id, identity.name), publisher: identity.publisher || "",
      kind: catalogProfileFor(id).publicationKind, area: area.id,
      records: identity.catalog_counts?.normalized_records || 0,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const admitted = input.edges.filter((e) => isAtlasResearchEdge(e as AtlasGraphSourceEdge, false)).sort((a, b) => a.id.localeCompare(b.id));
  const pairs = new Map<string, { a: string; b: string; total: number; aToB: number; bToA: number; types: Set<string>; edge: Row }>();
  for (const edge of admitted) {
    const from = catalogOf.get(edge.source_node_id) || "";
    const to = catalogOf.get(edge.target_node_id) || "";
    if (!from || !to || from === to || !mapped.has(from) || !mapped.has(to)) continue;
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = pairKey(a, b);
    const route = pairs.get(key) || { a, b, total: 0, aToB: 0, bToA: 0, types: new Set<string>(), edge };
    route.total += 1;
    if (from === a) route.aToB += 1; else route.bToA += 1;
    route.types.add(edge.relationship_type || "unspecified");
    pairs.set(key, route);
  }
  const routes: TerritoryIndexRoute[] = [...pairs.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([key, r]) => {
    const ref = (r.edge.source_refs || [])[0] || {};
    const src = sources.get(ref.source_id) || {};
    const forward = r.aToB >= r.bToA;
    return {
      key, a: r.a, b: r.b, from: forward ? r.a : r.b, to: forward ? r.b : r.a,
      bidirectional: r.aToB > 0 && r.bToA > 0, total: r.total, aToB: r.aToB, bToA: r.bToA, types: [...r.types].sort(),
      sample: {
        edgeId: r.edge.id, relationshipType: r.edge.relationship_type || "", relationshipClass: r.edge.relationship_class || "",
        from: r.edge.source_node_id, to: r.edge.target_node_id, lifecycle: r.edge.lifecycle_status || r.edge.status || "",
        locator: r.edge.source_locator || ref.locator || "", sourceName: src.display_name || src.name || "", sourceVersion: src.version || "",
      },
    };
  });

  const unmapped = input.identities.filter((i) => !i.catalog_id).sort((a, b) => a.id.localeCompare(b.id));
  const listed = (i: Row): TerritoryListed => ({ id: i.id, name: i.name, publisher: i.publisher || "" });
  return {
    admittedEdgeCount: admitted.length,
    index: {
      schemaVersion: TERRITORY_INDEX_VERSION, generatedAt: input.generatedAt, geometryVersion: input.geometryVersion,
      publications, routes,
      authority: unmapped.filter((i) => String(i.id).startsWith("authority-")).map(listed),
      other: unmapped.filter((i) => !String(i.id).startsWith("authority-")).map(listed),
    },
  };
}

export function validateTerritoryManifest(value: unknown): TerritoryManifest {
  const m = value as TerritoryManifest;
  if (!m || m.schemaVersion !== TERRITORY_INDEX_VERSION || !/^[a-f0-9]{64}$/.test(m.sha256 || "")
    || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > TERRITORY_INDEX_MAX_BYTES) throw new Error("Territory data is not available for this release.");
  return m;
}

export function validateTerritoryIndex(value: unknown, manifest: TerritoryManifest, catalogIds: readonly string[] = []): TerritoryIndex {
  const idx = value as TerritoryIndex;
  if (!idx || idx.schemaVersion !== manifest.schemaVersion || idx.generatedAt !== manifest.generatedAt
    || !Array.isArray(idx.publications) || !Array.isArray(idx.routes) || !Array.isArray(idx.authority) || !Array.isArray(idx.other)
    || idx.publications.length !== manifest.publicationCount || idx.routes.length !== manifest.routeCount) throw new Error("Territory data does not match its release.");
  const known = new Set(idx.publications.map((p) => p.id));
  for (const id of catalogIds) if (!known.has(id)) throw new Error(`Territory data is missing publication ${id}.`);
  for (const r of idx.routes) if (!known.has(r.a) || !known.has(r.b) || r.a >= r.b || r.key !== `${r.a}|${r.b}` || r.total < 1) throw new Error("Territory data holds an invalid route.");
  return idx;
}
