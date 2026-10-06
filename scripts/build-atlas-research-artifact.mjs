import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGeneratedCollection } from "./lib/generated-graph-artifacts.mjs";
import { isAtlasResearchEdge } from "../src/ui/lib/atlasResearch.ts";
import { RESEARCH_INDEX_VERSION, RESEARCH_POLICY_VERSION, RESEARCH_MAX_BYTES } from "../src/ui/lib/atlasResearchIndex.ts";
import { recordIdentityPresentationFor } from "../src/ui/lib/recordTitle.ts";
import { catalogDisplayNameFor } from "../src/ui/lib/catalogProfiles.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output) throw new Error("Expected --output <generated directory>.");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function collection(name) {
  const manifest = JSON.parse(readFileSync(join(root, "data/generated", `${name}.json`), "utf8"));
  const loaded = readGeneratedCollection(root, name);
  const rows = loaded?.[name];
  if (!Array.isArray(rows) || !rows.length
    || (manifest.sharded_collection && rows.length !== manifest.sharded_collection.record_count)) {
    throw new Error(`Incomplete ${name} collection; do not publish research coverage.`);
  }
  return { rows, generatedAt: manifest.generated_at, hash: hash(JSON.stringify(rows)) };
}
const nodes = collection("nodes");
const edges = collection("edges");
if (nodes.generatedAt !== edges.generatedAt) throw new Error("Mixed research snapshots.");
const seen = new Set();
const projected = nodes.rows.map(node => {
  if (seen.has(node.id)) throw new Error(`Duplicate record: ${node.id}`);
  seen.add(node.id);
  const md = node.metadata || {};
  const catalogId = md.catalog_id || "";
  const identity = recordIdentityPresentationFor({ publisher: "", catalogId,
    publicationName: catalogDisplayNameFor(catalogId), family: md.family || "",
    itemId: md.item_id || node.label || "", title: md.title || "", objectType: node.node_type || "", metadata: md });
  return {
    id: node.id, node_type: node.node_type, source_id: node.source_id, lifecycle_status: node.lifecycle_status,
    metadata: { catalog_id: catalogId, item_id: md.item_id, stig_id: md.stig_id, rule_id: md.rule_id },
    identity: { label: identity.stableIdIsGenerated ? identity.primary : md.publisher_item_id || md.item_id || identity.primary,
      title: identity.secondary || "", publication: catalogDisplayNameFor(catalogId), catalogId, itemId: md.item_id || "" },
  };
}).sort((a, b) => a.id.localeCompare(b.id));
const edgeIds = new Set();
const admitted = edges.rows.filter(edge => {
  if (edgeIds.has(edge.id)) throw new Error(`Duplicate connection: ${edge.id}`);
  edgeIds.add(edge.id);
  if (!seen.has(edge.source_node_id) || !seen.has(edge.target_node_id)) throw new Error(`Dangling connection: ${edge.id}`);
  return isAtlasResearchEdge(edge, true);
}).sort((a, b) => a.id.localeCompare(b.id));
const index = { schemaVersion: RESEARCH_INDEX_VERSION, policyVersion: RESEARCH_POLICY_VERSION,
  generatedAt: nodes.generatedAt, sourceHashes: { nodes: nodes.hash, edges: edges.hash }, nodes: projected, edges: admitted };
const text = JSON.stringify(index) + "\n";
const bytes = Buffer.byteLength(text);
if (bytes > RESEARCH_MAX_BYTES) throw new Error("Research data exceeds its bounded transfer budget.");
const sha256 = hash(text);
const dir = resolve(output);
mkdirSync(join(dir, "atlas-research"), { recursive: true });
writeFileSync(join(dir, "atlas-research", `${sha256}.json`), text);
writeFileSync(join(dir, "atlas-research-manifest.json"), JSON.stringify({ schemaVersion: RESEARCH_INDEX_VERSION,
  policyVersion: RESEARCH_POLICY_VERSION, generatedAt: nodes.generatedAt, sha256, bytes,
  nodeCount: projected.length, edgeCount: admitted.length, inputNodeCount: nodes.rows.length, inputEdgeCount: edges.rows.length }) + "\n");
console.log(`Research index: ${projected.length} records, ${admitted.length} original published connections, ${bytes} bytes; sha256 ${sha256}.`);
