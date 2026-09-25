// Builds data/generated/pulse.json from accepted lifecycle evidence only.
// Run with `node --import tsx` so destinations use the app's own route serializer.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELATIONSHIP_SET_ENDPOINTS } from "./lib/catalog-refresh-profiles.mjs";
import { observeRelationshipSet } from "./lib/source-change-evidence.mjs";
import { PRESENTATION_PATH, buildPulse } from "./lib/pulse.mjs";
import { readProductHistory } from "./lib/product-history.mjs";
import { datasetIdentity } from "./lib/dataset-identity.mjs";
import { serializeHashUrl } from "../src/ui/lib/hashRoutes.ts";
import { normalizeViewState } from "../src/ui/lib/viewState.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const INPUTS = [
  "data/source-change-log.json",
  "data/source-baselines.json",
  PRESENTATION_PATH,
  "data/source-registry.json",
  ...Object.keys(RELATIONSHIP_SET_ENDPOINTS),
];
/** The Pulse artifact for a repository checkout whose data/generated is built. */
export function buildPulseArtifact(root = ROOT, { head = process.env.CONTROL_ATLAS_COMMIT_SHA || "HEAD" } = {}) {
  const bytes = new Map(INPUTS.filter((path) => existsSync(join(root, path))).map((path) => [path, readFileSync(join(root, path))]));
  const json = (path) => (bytes.has(path) ? JSON.parse(bytes.get(path)) : null);
  const identities = JSON.parse(readFileSync(join(root, "data/generated/publication-identity-index.json"), "utf8")).identities;
  const publications = new Map(identities.filter((item) => item.catalog_id).map((item) => [item.catalog_id, { name: item.name, publisher: item.publisher }]));
  const servedSets = new Map(Object.keys(RELATIONSHIP_SET_ENDPOINTS).flatMap((path) => {
    const observed = observeRelationshipSet(json(path));
    return observed ? [[path, observed]] : [];
  }));
  const presentation = json(PRESENTATION_PATH);
  // Shipping facts come from the Git history of the commit being built, never from the presentation file.
  const history = readProductHistory(root, { head, tags: (presentation?.releases || []).map((entry) => entry.tag) });
  const pulse = buildPulse({
    changeLog: json("data/source-change-log.json"),
    baselines: json("data/source-baselines.json"),
    presentation,
    history,
    registry: json("data/source-registry.json"),
    publications,
    relationshipSets: RELATIONSHIP_SET_ENDPOINTS,
    servedSets,
    dataset: {
      dataset_id: datasetIdentity(root),
      source_data_generated_at: JSON.parse(readFileSync(join(root, "data/generated/sources.json"), "utf8")).generated_at,
    },
    inputs: Object.fromEntries([...bytes].map(([path, value]) => [path, `sha256:${createHash("sha256").update(value).digest("hex")}`])),
  });
  for (const event of pulse.events) {
    event.destination.href = serializeHashUrl(normalizeViewState(event.destination.view, event.destination.patch));
  }
  return pulse;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = process.argv.flatMap((arg, index, all) => (arg === "--output" && all[index + 1] ? [resolve(all[index + 1])] : []));
  if (!outputs.length) throw new Error("Expected --output <generated directory>.");
  const pulse = buildPulseArtifact();
  const text = `${JSON.stringify(pulse, null, 2)}\n`;
  for (const directory of outputs) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "pulse.json"), text);
  }
  console.log(`Pulse: ${pulse.events.length} events (${pulse.withheld.length} accepted log entries withheld with a reason); latest ${pulse.status.latest_event_date || "none"}.`);
}
