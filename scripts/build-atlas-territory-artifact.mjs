import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGeneratedCollection } from "./lib/generated-graph-artifacts.mjs";
import { buildTerritoryIndex, TERRITORY_INDEX_MAX_BYTES, TERRITORY_INDEX_VERSION } from "../src/ui/lib/atlasTerritoryIndex.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output) throw new Error("Expected --output <generated directory>.");
const read = file => JSON.parse(readFileSync(join(root, file), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

const nodes = readGeneratedCollection(root, "nodes").nodes;
const edges = readGeneratedCollection(root, "edges").edges;
if (!nodes?.length || !edges?.length) throw new Error("Incomplete graph collections; do not publish territory data.");
const spine = read("data/curated/tree-spine.json");
const geometry = read("data/curated/atlas-territory-geography.json");
const { index, admittedEdgeCount } = buildTerritoryIndex({
  generatedAt: read("data/generated/edges.json").generated_at,
  geometryVersion: geometry.version,
  catalogIds: [...Object.keys(spine.catalogLimbs), ...spine.syntheticCatalogs.map(c => c.catalog_id)],
  identities: read("data/generated/publication-identity-index.json").identities,
  sources: read("data/source-registry.json").sources,
  nodes, edges,
});
const text = JSON.stringify(index) + "\n";
const bytes = Buffer.byteLength(text);
if (bytes > TERRITORY_INDEX_MAX_BYTES) throw new Error("Territory data exceeds its bounded transfer budget.");
const sha256 = hash(text);
const dir = resolve(output);
mkdirSync(join(dir, "atlas-territory"), { recursive: true });
writeFileSync(join(dir, "atlas-territory", `${sha256}.json`), text);
writeFileSync(join(dir, "atlas-territory-manifest.json"), JSON.stringify({ schemaVersion: TERRITORY_INDEX_VERSION,
  generatedAt: index.generatedAt, sha256, bytes, publicationCount: index.publications.length, routeCount: index.routes.length, admittedEdgeCount }) + "\n");
console.log(`Territory index: ${index.publications.length} publications, ${index.routes.length} routes from ${admittedEdgeCount} published connections, ${bytes} bytes; sha256 ${sha256}.`);
