import { displayNameFor } from "../../app/display-names.mjs";
import { routeIdentityFor } from "./routeIdentity";
import { recordDisplayTitle, humanReadableEvidenceLocator, type TitledNode } from "./publisherRecordIdentity";
export * from "./publisherRecordIdentity";
const BASE_TITLE = "Control Atlas";

// Per-view suffixes for document.title (CATL-61). Wayfinding + honest browser
// history/bookmark labels; record pages use the official record name.
// "atlas-map" -> "Explore" (nav rename); the pre-existing "search"/"browse"
// view (a distinct, already-shipped full-text results page) is renamed away
// from its old "Explore" label to "Search results" so the two do not share a
// name — see the source-first record contract in docs/PAGE_CONTRACTS.md.
export function routeDocumentTitle(
  state: { view: string; node?: string; query?: string },
  node?: TitledNode | null,
  entityName = "",
): string {
  if (state.view === "home") {
    return `${BASE_TITLE} — Public reference for federal cyber requirements`;
  }
  if (state.view === "library-detail") {
    // A record id that resolves to nothing gets an honest title. It used to
    // fall back to the literal "Record", so a dead link sat in history,
    // bookmarks, and tab lists looking exactly like a real record - while the
    // page itself said "Record not found". The unknown-route view already
    // titles itself correctly; this now matches it.
    const recordName = entityName || recordDisplayTitle(node);
    if (!recordName) return `Record not found — ${BASE_TITLE}`;
    return `${recordName} — ${BASE_TITLE}`;
  }
  if (state.view === "commons-detail") {
    return `${entityName || routeIdentityFor("commons-detail").title} — ${BASE_TITLE}`;
  }
  if (state.view === "sources" && entityName) {
    return `${entityName} — ${BASE_TITLE}`;
  }
  const base = routeIdentityFor(state.view as import("./viewState").AppView).title;
  const label =
    state.view === "search" && state.query
      ? `${state.query} — ${base}`
      : base;
  return `${label} — ${BASE_TITLE}`;
}

// Friendly plural names for connection-impact summaries, keyed by node_type.
const TYPE_PLURALS: Record<string, [string, string]> = {
  control: ["NIST control", "NIST controls"],
  control_enhancement: ["control enhancement", "control enhancements"],
  requirement: ["CCI / requirement", "CCIs / requirements"],
  stig_rule: ["STIG rule", "STIG rules"],
  srg_requirement: ["SRG requirement", "SRG requirements"],
  benchmark: ["STIG / SRG benchmark", "STIG / SRG benchmarks"],
  baseline: ["baseline", "baselines"],
  program: ["program level", "program levels"],
  assessment_procedure: ["assessment procedure", "assessment procedures"],
  attack_technique: ["ATT&CK technique", "ATT&CK techniques"],
  defend_countermeasure: ["D3FEND countermeasure", "D3FEND countermeasures"],
  zt_activity: ["Zero Trust activity", "Zero Trust activities"],
  zt_capability: ["Zero Trust capability", "Zero Trust capabilities"],
  family: ["control family", "control families"],
  rmf_step: ["RMF step", "RMF steps"],
  impact_category: ["impact level", "impact levels"],
  function: ["CSF function", "CSF functions"],
  category: ["CSF category", "CSF categories"],
  tactic: ["tactic", "tactics"],
  group: ["group", "groups"],
};

/** English pluralization for the display-name fallback (avoids "categorys"). */
function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

export function friendlyTypePlural(nodeType: string, count: number): string {
  const entry = TYPE_PLURALS[nodeType];
  if (entry) return count === 1 ? entry[0] : entry[1];
  // Fall back to the hardened formatter for casing (no "impact categorys",
  // no lower-case "disa ccis") and pluralize the last word properly.
  const pretty = displayNameFor("node_type", nodeType);
  return count === 1 ? pretty : pluralize(pretty);
}

export type ImpactBreakdown = {
  total: number;
  byType: Array<{ nodeType: string; label: string; count: number }>;
};

/**
 * The "birds per stone" summary: how many related requirements this record
 * touches, broken down by kind, largest groups first.
 */
export function buildImpactBreakdown(
  centerNodeId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>,
  getNode: (id: string) => TitledNode | null | undefined,
): ImpactBreakdown {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const edge of edges) {
    const counterpartId =
      edge.source_node_id === centerNodeId
        ? edge.target_node_id
        : edge.source_node_id;
    if (seen.has(counterpartId)) continue;
    seen.add(counterpartId);
    const counterpart = getNode(counterpartId);
    const nodeType = counterpart?.node_type || "other";
    counts.set(nodeType, (counts.get(nodeType) ?? 0) + 1);
  }
  const byType = [...counts.entries()]
    .map(([nodeType, count]) => ({
      nodeType,
      count,
      label: friendlyTypePlural(nodeType, count),
    }))
    .sort((a, b) => b.count - a.count);
  return { total: seen.size, byType };
}

/**
 * Requirement frameworks a practitioner cross-maps against (the "overlays").
 * Same-framework detail (CCIs, STIGs, baselines, enhancements) and threat/
 * assessment catalogs are intentionally excluded — this is equivalence, not
 * implementation. Keyed by catalog_id → display label.
 */
const EQUIVALENCE_FRAMEWORKS: Record<string, string> = {
  "csf-2": "NIST CSF 2.0",
  "nist-800-171": "SP 800-171",
  "nist-800-171-rev2": "SP 800-171 Rev. 2",
  "nist-800-172": "SP 800-172",
  "cmmc-2": "CMMC 2.0",
  "nist-ai-rmf": "AI RMF",
  "nist-ssdf": "SSDF",
  "fips-200": "FIPS 200",
};

export type CrossFrameworkGroup = {
  catalogId: string;
  label: string;
  items: Array<{ nodeId: string; itemId: string }>;
};

export { buildRecordConnectionGroups, type RecordConnectionGroup } from './recordConnectionGroups';

/**
 * The focused control's equivalents in OTHER requirement frameworks, from real
 * published `maps_to` edges — "AC-17 in 800-53 is also CSF PR.AA-05 and 800-171
 * 3.1.12". Empty array when no cross-framework mapping is ingested (the honest
 * signal that coverage is partial), never a fabricated link.
 */
export function buildCrossFrameworkEquivalents(
  centerNodeId: string,
  edges: Array<{
    source_node_id: string;
    target_node_id: string;
    relationship_type?: string;
  }>,
  getNode: (id: string) => TitledNode | null | undefined,
): CrossFrameworkGroup[] {
  const groups = new Map<string, CrossFrameworkGroup>();
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.relationship_type && edge.relationship_type !== "maps_to") continue;
    const counterpartId =
      edge.source_node_id === centerNodeId
        ? edge.target_node_id
        : edge.target_node_id === centerNodeId
          ? edge.source_node_id
          : null;
    if (!counterpartId || seen.has(counterpartId)) continue;
    const counterpart = getNode(counterpartId);
    const catalogId = counterpart?.metadata?.catalog_id;
    const label = catalogId ? EQUIVALENCE_FRAMEWORKS[catalogId] : undefined;
    if (!catalogId || !label) continue;
    seen.add(counterpartId);
    if (!groups.has(catalogId)) {
      groups.set(catalogId, { catalogId, label, items: [] });
    }
    groups.get(catalogId)!.items.push({
      nodeId: counterpartId,
      itemId: counterpart?.metadata?.item_id || counterpartId,
    });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
