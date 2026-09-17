import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { packIndex, publicSnapshot } from "../src/ui/atlas/model.mjs";
import { REGIONS, LANDMARK_ORDER } from "../src/ui/atlas/geography.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function writeJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const data = Buffer.from(JSON.stringify(value) + "\n");
  writeFileSync(path, data); writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
  return { bytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length, sha256: createHash("sha256").update(data).digest("hex") };
}
export function buildAtlasWorkbench({ nodes, edges, sources, taxonomy, catalogAreas, generatedAt, output }) {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const tagMap = new Map(taxonomy.terms.map((term) => [term.id, term]));
  const regionByArea = new Map(REGIONS.map((region) => [region.area, region.id]));
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw new Error("Atlas index refuses duplicate records.");
  const catalogs = new Map(nodes.filter((node) => node.node_type === "catalog").map((node) => [node.metadata?.catalog_id, node]));
  const recordRows = nodes.map((node) => {
    const m = node.metadata || {}, publication = m.catalog_id || "", source = sourceMap.get(node.source_id);
    const substantive = { ...m }; delete substantive.source_text_presentation;
    return { id: node.id, item: m.publisher_item_id || m.item_id || node.label || node.id, title: m.title || node.label || node.id, type: node.node_type, publication, source: node.source_id || "", region: regionByArea.get(catalogAreas[publication]) || (m.object_layer === "authority_document" ? "authority" : "unplaced"), context: m.benchmark_title || m.family || "", lifecycle: node.lifecycle_status || "", version: m.benchmark_version || source?.version || "", tags: (m.taxonomy_tags || []).map((tag) => tag.id).filter((id) => tagMap.has(id)), digest: digest({ type: node.node_type, label: node.label, metadata: substantive, lifecycle: node.lifecycle_status || null, version: m.benchmark_version || source?.version || null }) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const evidence = Array.from({ length: 64 }, () => ({}));
  const stableKeys = new Set();
  const edgeRows = edges.map((edge) => {
    if (!ids.has(edge.source_node_id) || !ids.has(edge.target_node_id)) throw new Error(`Unresolved assertion ${edge.id}`);
    const identity = [edge.source_node_id, edge.target_node_id, edge.relationship_type, edge.relationship_class, edge.source_artifact_id, edge.source_locator, [...(edge.source_refs || [])].sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))))];
    // Preserve parallel assertions. Exact duplicates are an integrity failure,
    // not something the UI may silently collapse.
    const key = digest(identity);
    if (stableKeys.has(key)) throw new Error(`Duplicate logical assertion ${edge.id}`);
    stableKeys.add(key);
    const shard = parseInt(digest(edge.id).slice(0, 2), 16) % 64;
    evidence[shard][edge.id] = edge;
    return { id: edge.id, key, source: edge.source_node_id, target: edge.target_node_id, type: edge.relationship_type, class: edge.relationship_class, publicationStatus: edge.publication_status || "", status: edge.status || "", authority: edge.authority_class || "", provenance: edge.provenance_class || "", confidence: edge.confidence || "", evidenceCount: (edge.source_refs || []).length, shard, digest: digest({ ...edge, id: undefined }) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const usedTags = new Set(recordRows.flatMap((node) => node.tags));
  const tags = taxonomy.terms.filter((term) => usedTags.has(term.id)).map(({ id, label, dimension }) => ({ id, label, dimension }));
  const snapshot = digest({ nodes: recordRows.map(({ id, digest }) => [id, digest]), edges: [...edgeRows].sort((a, b) => a.key.localeCompare(b.key)).map(({ key, digest }) => [key, digest]) });
  const payload = { schema: 1, snapshot, generatedAt, nodes: recordRows, edges: edgeRows, tags };
  const dir = dirname(output);
  const indexPath = `atlas-workbench/index-${snapshot.slice(0, 16)}.json`;
  const indexInfo = writeJSON(join(dir, indexPath), packIndex(payload));
  const snapshotPath = `atlas-workbench/snapshot-${snapshot.slice(0, 16)}.json`;
  const snapshotInfo = writeJSON(join(dir, snapshotPath), publicSnapshot(payload));
  if (indexInfo.gzipBytes > 3000000) throw new Error("Atlas query index exceeds its 3 MB compressed budget.");
  const proofFiles = evidence.map((records, number) => {
    const path = `atlas-workbench/evidence-${snapshot.slice(0, 16)}-${number}.json`;
    return { path, ...writeJSON(join(dir, path), { schema: 1, snapshot, records }) };
  });
  const publications = [...catalogs.entries()].map(([id, node]) => {
    const source = sourceMap.get(node.source_id), m = node.metadata || {};
    return { id, node: node.id, label: m.title || node.label, region: regionByArea.get(catalogAreas[id]) || "unplaced", publisher: source?.publisher || source?.owner || "", source: node.source_id, lifecycle: node.lifecycle_status || "", version: source?.version || "", count: recordRows.filter((row) => row.publication === id && row.type !== "catalog").length, mapped: LANDMARK_ORDER.includes(id) };
  });
  const sourceRows = sources.map((source) => ({ id: source.id, title: source.display_name || source.name, publisher: source.publisher || source.owner || "", version: source.version || "", lifecycle: source.lifecycle_status || "", lastChecked: source.last_checked || "", retrieved: source.retrieved_at || "", access: source.access_status || "", artifact: source.artifact_url || "", browse: source.catalog_browse_url || "" }));
  const manifest = { schema: 1, snapshot, generatedAt, counts: { records: recordRows.length, assertions: edgeRows.length }, regions: REGIONS, publications, tags, sources: sourceRows, index: { path: indexPath, ...indexInfo }, evidence: proofFiles, snapshotFile: { path: snapshotPath, ...snapshotInfo }, history: { available: false, reason: "This build does not contain an earlier record-level snapshot. A previously saved public snapshot may be compared on this device." } };
  writeJSON(output, manifest);
  return manifest;
}
function collection(root, name) {
  const manifest = JSON.parse(readFileSync(join(root, `${name}.json`), "utf8"));
  const rows = manifest.sharded_collection ? manifest.sharded_collection.shards.flatMap((shard) => JSON.parse(readFileSync(join(root, shard.path), "utf8"))[name]) : manifest[name];
  if (manifest.sharded_collection && rows.length !== manifest.sharded_collection.record_count) throw new Error(`${name} count mismatch`);
  return { rows, generatedAt: manifest.generated_at };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const generated = join(root, "data/generated");
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("--output <path> is required");
  const n = collection(generated, "nodes"), e = collection(generated, "edges");
  if (n.generatedAt !== e.generatedAt) throw new Error("Atlas refuses mixed-snapshot graph inputs.");
  const tree = JSON.parse(readFileSync(join(root, "data/curated/tree-spine.json"), "utf8"));
  const result = buildAtlasWorkbench({ nodes: n.rows, edges: e.rows, sources: JSON.parse(readFileSync(join(generated, "sources.json"), "utf8")).sources, taxonomy: JSON.parse(readFileSync(join(generated, "taxonomy-registry.json"), "utf8")), catalogAreas: { ...tree.catalogLimbs, ...Object.fromEntries(tree.syntheticCatalogs.map((catalog) => [catalog.catalog_id, catalog.limb])) }, generatedAt: n.generatedAt, output: resolve(process.argv[outputIndex + 1]) });
  console.log(`Built Atlas workbench ${result.snapshot.slice(0, 12)}: ${result.counts.records} records, ${result.counts.assertions} assertions; ${result.index.gzipBytes} compressed query bytes.`);
}
