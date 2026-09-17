import type { RuntimeBundle } from "./runtimeLoader";
import { catalogDisplayNameFor } from "./catalogProfiles";

const SECTION_TYPES = new Set([
  "benchmark",
  "category",
  "family",
  "function",
  "group",
  "section",
  "tactic",
  "zt_pillar",
]);

export type CanonicalBreadcrumb = {
  items: string[];
  text: string;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

export function canonicalBreadcrumbForNode(
  bundle: RuntimeBundle,
  nodeId: string,
  recordLabel?: string,
): CanonicalBreadcrumb {
  const node = bundle.runtime.getNode(nodeId);
  const document = bundle.runtime.getLibraryDocument(nodeId);
  if (!node || !document) return { items: [], text: "" };

  const catalog = bundle.runtime
    .getCatalogs()
    .find((entry: any) => entry.id === document.catalog_id);
  const source = bundle.runtime.getSource(node.source_id);
  const path = (node.ancestor_path || []) as Array<Record<string, unknown>>;
  const area = [...path].reverse().find((entry) => entry.node_type === "limb");
  const section = [...path]
    .reverse()
    .find((entry) => SECTION_TYPES.has(clean(entry.node_type)));
  const publisher =
    clean(document.publisher_name) ||
    clean(catalog?.display_group) ||
    clean(source?.publisher) ||
    clean(source?.owner) ||
    "Publisher unavailable";
  const publication = catalogDisplayNameFor(
    clean(document.catalog_id),
    clean(catalog?.name) || clean(document.catalog_name),
  );
  const record = clean(recordLabel) || clean(document.item_id) || clean(node.label) || node.id;
  const isTechnicalRule = ["stig_rule", "srg_requirement"].includes(node.node_type || document.object_type);
  // A finding's benchmark is the useful publication scope. Do not repeat the
  // umbrella DISA catalog as an extra hop; the full benchmark remains a fact.
  const benchmark = clean(node.metadata?.benchmark_short_title)
    || clean(node.metadata?.benchmark_title)
    || (clean(section?.node_type) === "benchmark" ? clean(section?.label) : "");
  const compactBenchmark = benchmark
    .replace(/Security Technical Implementation Guide\b/g, "STIG")
    .replace(/Security Requirements Guide\b/g, "SRG");
  const labels = isTechnicalRule && compactBenchmark
    ? [clean(area?.label), publisher, compactBenchmark, record]
    : [clean(area?.label), publisher, publication, clean(section?.label), record];
  const items = labels
    .filter(Boolean)
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  return { items, text: items.join(" › ") };
}
