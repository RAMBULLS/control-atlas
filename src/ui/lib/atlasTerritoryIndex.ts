import { isAtlasResearchEdge } from "./atlasResearch";
import type { AtlasGraphSourceEdge } from "./atlasGraphModel";
import { catalogDisplayNameFor, catalogProfileFor } from "./catalogProfiles";
import { officialSourceFor } from "./officialSource";
import { areaPresentationForCatalog } from "./areaVisualLanguage";
import type { TerritoryRoute } from "./atlasTerritoryRoutes";
import { CONTEXT_DIMENSIONS, type ContextIndex, type ContextSignature } from "./atlasTerritoryContext";

export const TERRITORY_INDEX_VERSION = 3;
export const TERRITORY_INDEX_MAX_BYTES = 256 * 1024;

export type TerritoryPublication = {
  id: string; name: string; publisher: string; kind: string; area: string; records: number;
};
/**
 * A document Control Atlas holds but does not place on the map. `title` is the official title and `group` the
 * register group (United States Code, DoD Issuances, ...) as recorded in the source register; `url` is its
 * official publisher destination. Empty strings when the register records none; nothing here is synthesized.
 */
export type TerritoryListed = { id: string; name: string; publisher: string; title: string; group: string; url: string };
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
  /** Identity of the accepted dataset this index was built from; stamped on shared views. */
  datasetId: string;
  geometryVersion: string;
  context: ContextIndex;
  publications: TerritoryPublication[];
  routes: TerritoryIndexRoute[];
  authority: TerritoryListed[];
  other: TerritoryListed[];
};
export type TerritoryManifest = {
  schemaVersion: number; generatedAt: string; datasetId: string; sha256: string; bytes: number;
  publicationCount: number; routeCount: number; admittedEdgeCount: number;
};

type Row = Record<string, any>;
export type TerritoryBuildInput = {
  generatedAt: string;
  datasetId: string;
  geometryVersion: string;
  taxonomy: { terms: readonly Row[] };
  /** Catalog ids that own a landmark (tree-spine catalogLimbs plus syntheticCatalogs). */
  catalogIds: readonly string[];
  identities: readonly Row[];
  nodes: readonly Row[];
  edges: readonly Row[];
  sources: readonly Row[];
  /** Source-register publication records (official titles, register groups, publisher URLs). */
  registryPublications: readonly Row[];
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

  // Context: which records carry which governed tags, folded into one row per distinct combination.
  const contextDims = new Set<string>(CONTEXT_DIMENSIONS.map((d) => d.id));
  const contextTerms = input.taxonomy.terms.filter((t) => contextDims.has(t.dimension));
  const dimensionOf = new Map<string, string>(contextTerms.map((t) => [t.id, t.dimension]));
  const combos = new Map<string, ContextSignature>();
  const termRecords = new Map<string, number>();
  for (const node of input.nodes) {
    const catalog = node.metadata?.catalog_id || "";
    if (!mapped.has(catalog)) continue;
    const tags = [...new Set<string>((node.metadata?.taxonomy_tags || []).map((t: any) => (typeof t === "string" ? t : t?.id)).filter((id: string) => dimensionOf.has(id)))].sort();
    if (!tags.length) continue;
    for (const id of tags) termRecords.set(id, (termRecords.get(id) || 0) + 1);
    const key = catalog + "|" + tags.join(",");
    const row = combos.get(key) || { p: catalog, t: tags, n: 0 };
    row.n += 1;
    combos.set(key, row);
  }
  const context: ContextIndex = {
    dimensions: CONTEXT_DIMENSIONS.map((d) => ({ id: d.id, label: d.label })),
    // Only values that at least one record carries are offered.
    terms: contextTerms.filter((t) => termRecords.get(t.id)).map((t) => ({ id: t.id, label: t.label, dimension: t.dimension, records: termRecords.get(t.id)! }))
      .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.label.localeCompare(b.label)),
    signatures: [...combos.values()].sort((a, b) => (a.p + a.t.join()).localeCompare(b.p + b.t.join())),
  };

  const unmapped = input.identities.filter((i) => !i.catalog_id).sort((a, b) => a.id.localeCompare(b.id));
  const registry = new Map<string, Row>(input.registryPublications.map((r) => [r.id, r]));
  const listed = (i: Row): TerritoryListed => {
    const r = registry.get(i.id) || {};
    const title = String(r.name || "").trim();
    return {
      id: i.id, name: i.name, publisher: i.publisher || "", title: title && title !== i.name ? title : "",
      group: String(r.display_group || "").trim(), url: officialSourceFor(r, { allowArtifactFallback: true }).url,
    };
  };
  return {
    admittedEdgeCount: admitted.length,
    index: {
      schemaVersion: TERRITORY_INDEX_VERSION, generatedAt: input.generatedAt, datasetId: input.datasetId, geometryVersion: input.geometryVersion,
      context, publications, routes,
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
    || idx.datasetId !== manifest.datasetId || !/^[a-f0-9]{12}$/.test(idx.datasetId || "") || !Array.isArray(idx.context?.terms) || !Array.isArray(idx.context?.signatures)
    || !Array.isArray(idx.publications) || !Array.isArray(idx.routes) || !Array.isArray(idx.authority) || !Array.isArray(idx.other)
    || idx.publications.length !== manifest.publicationCount || idx.routes.length !== manifest.routeCount) throw new Error("Territory data does not match its release.");
  const known = new Set(idx.publications.map((p) => p.id));
  for (const id of catalogIds) if (!known.has(id)) throw new Error(`Territory data is missing publication ${id}.`);
  for (const r of idx.routes) if (!known.has(r.a) || !known.has(r.b) || r.a >= r.b || r.key !== `${r.a}|${r.b}` || r.total < 1) throw new Error("Territory data holds an invalid route.");
  return idx;
}
