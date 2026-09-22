import { isComparisonCapableEdge } from "./compare-capability.mjs";
import { RECORD_FACT_LABELS } from "./record-fact-labels.mjs";
import {
  CATALOG_RECORD_TYPES,
  NON_RECORD_NODE_TYPES,
  PAGE_ROLES,
  recordPresentationContract,
  SUPPORTED_RECORD_CONTRACT_KEYS,
} from "./record-presentation.mjs";

/**
 * Record acceptance: does each catalog x record-type pair earn a public page?
 *
 * The pair list is never written down here. It comes from the presentation
 * registry (CATALOG_RECORD_TYPES) and the corpus, so a new pair cannot ship
 * without someone recording a disposition for it. Dispositions are product
 * decisions and live in this file; everything else is derived.
 */

export const RECORD_DISPOSITIONS = Object.freeze({
  KEEP: "KEEP",
  REWORK: "REWORK",
  FOLD_INTO_PARENT: "FOLD INTO PARENT",
  SOURCE_ONLY: "SOURCE-ONLY",
  REMOVE_FROM_PUBLIC_DISCOVERY: "REMOVE FROM PUBLIC DISCOVERY",
});

export const REVIEW_STATUS = Object.freeze({
  PROVISIONAL: "provisional",
  ACCEPTED: "accepted",
});

const keep = (reason, review = {}) => ({ disposition: RECORD_DISPOSITIONS.KEEP, reason, ...review });
const rework = (reason, review = {}) => ({ disposition: RECORD_DISPOSITIONS.REWORK, reason, ...review });
const fold = (reason, review = {}) => ({ disposition: RECORD_DISPOSITIONS.FOLD_INTO_PARENT, reason, ...review });
const sourceOnly = (reason, review = {}) => ({ disposition: RECORD_DISPOSITIONS.SOURCE_ONLY, reason, ...review });
const remove = (reason, review = {}) => ({ disposition: RECORD_DISPOSITIONS.REMOVE_FROM_PUBLIC_DISCOVERY, reason, ...review });

/**
 * Per record type. Every entry starts provisional (decided from the repository
 * audit on issue 279) and moves to accepted only after its browser review is
 * recorded. Tier 1 types can change a product decision; Tier 2 need a pair
 * fixture and a spot check; Tier 3 are covered by the generated assertions.
 */
export const RECORD_TYPE_DISPOSITIONS = Object.freeze({
  assessment_procedure: keep("Native procedure, objectives and methods; a clear practitioner job."),
  attack_technique: keep("Publisher-native threat record with tactics and citations.", { tier: 2 }),
  baseline: rework("Baseline membership is applicability, not structural containment.", { tier: 1 }),
  benchmark: keep("Real STIG/SRG publication container with version, date and findings.", { tier: 1 }),
  catalog: fold("The dedicated publication page already does this job; the raw catalog record duplicates it."),
  category: keep("Publisher hierarchy and browse hub.", { tier: 2 }),
  control: keep("Core practitioner record."),
  control_context: rework("Machine-style parameter notation must read as FedRAMP control context.", { tier: 1 }),
  control_enhancement: keep("Core practitioner record with parent control context."),
  definition: keep("Official FedRAMP term and definition."),
  defend_countermeasure: keep("Useful D3FEND defensive object.", { tier: 2 }),
  family: keep("Publisher browse hub; needs a fixture per catalog.", { tier: 2 }),
  function: keep("CSF publisher hierarchy.", { tier: 2 }),
  group: keep("Publisher-native grouping; SSDF, AI RMF and DoD RAI accepted separately.", { tier: 2 }),
  impact_category: rework("FIPS 199 levels matter for baseline selection, not for child containment.", { tier: 1 }),
  iot_capability_domain: keep("Native hierarchical browse object.", { tier: 2 }),
  iot_capability: keep("Native hierarchical browse object.", { tier: 2 }),
  iot_subcapability: keep("Native hierarchical browse object.", { tier: 2 }),
  iot_capability_element: keep("Substantive source content with publisher mappings.", { tier: 2 }),
  iot_capability_subelement: keep("Substantive source content with publisher mappings.", { tier: 2 }),
  key_security_indicator: keep("Substantive FedRAMP statement."),
  limb: remove("Control Atlas editorial geography, not a publisher record.", { tier: 1 }),
  mobile_threat: keep("Specialized record: origin, examples, CVEs, countermeasures.", { tier: 2 }),
  mobile_threat_category: keep("Useful browse container.", { tier: 2 }),
  policy: keep("NARA CUI publisher content is a real practitioner reference.", { tier: 1 }),
  policy_directive: sourceOnly("Governing material better served by Policy and directives / Sources.", { tier: 1 }),
  program: rework("CMMC levels need dependency and assessment context, not a generic container.", { tier: 1 }),
  regulation: sourceOnly("Governing source, not an ordinary Library record.", { tier: 1 }),
  requirement: keep("Core source record; accepted per catalog pair.", { tier: 1 }),
  rmf_step: keep("Practitioner navigation object and Atlas journey anchor."),
  rule: keep("FedRAMP 2026 rules are first-class requirements."),
  srg_requirement: keep("Core DISA record: Discussion, Check, Fix, native IDs."),
  statute: sourceOnly("Governing source, not an ordinary Library record.", { tier: 1 }),
  stig_rule: keep("Core DISA record; native-ID composition is appropriate."),
  tactic: keep("ATT&CK and D3FEND browse hierarchy.", { tier: 2 }),
  trunk: remove("Pure Control Atlas editorial root.", { tier: 1 }),
  zt_activity: keep("Rich DoD Zero Trust object: outcomes, end state, sequence."),
  zt_assessment_question: keep("Real Microsoft assessment question with answer options.", { tier: 2 }),
  zt_build: keep("NIST implementation artifact with architecture and instructions."),
  zt_capability: keep("DoD Zero Trust browse and implementation grouping."),
  zt_cloud_native_requirement: keep("Substantive NIST requirement."),
  zt_collaborator: fold("Official collaborator roster entry with no unique implementation content.", { tier: 1 }),
  zt_document: keep("Actual DoD publication with structured sections."),
  zt_logical_component: keep("NIST architecture component."),
  zt_mapping_contributor: fold("Mapping-workbook column value that duplicates an official collaborator.", { tier: 1 }),
  zt_mapping_document: sourceOnly("Workbook identity and counts; mapping evidence, not an ordinary record.", { tier: 1 }),
  zt_pillar: keep("DoD and Microsoft structural vocabulary; accepted per publisher.", { tier: 2 }),
  zt_product_component: keep("Vendor product implementation mapping with real targets.", { tier: 1 }),
  zt_publication: keep("NIST Zero Trust umbrella holds several real publications."),
  zt_reference_component: keep("Reference architecture function with mapping targets.", { tier: 1 }),
  zt_tenet: keep("Substantive publisher tenet."),
});

/** Catalog-specific decisions that differ from the type default. */
export const PAIR_DISPOSITION_OVERRIDES = Object.freeze({});

export function dispositionFor(catalogId, recordType) {
  const entry = PAIR_DISPOSITION_OVERRIDES[`${catalogId}:${recordType}`] || RECORD_TYPE_DISPOSITIONS[recordType];
  if (!entry) return null;
  return Object.freeze({
    tier: 3,
    status: REVIEW_STATUS.PROVISIONAL,
    ...entry,
  });
}

/**
 * Retirement: a pair whose disposition is FOLD, SOURCE-ONLY or REMOVE keeps its
 * graph node, edges, evidence and provenance, but is not a public record page.
 * Its old URL redirects to the destination that does the job, and it is left
 * out of Library search. The destination is per record type; a test requires
 * one for every retired pair and none for a pair that stays public.
 */
const RETIRED_DISPOSITIONS = new Set([
  RECORD_DISPOSITIONS.FOLD_INTO_PARENT,
  RECORD_DISPOSITIONS.SOURCE_ONLY,
  RECORD_DISPOSITIONS.REMOVE_FROM_PUBLIC_DISCOVERY,
]);

const toSources = { view: "sources", label: "the source record", patch: ({ sourceId }) => ({ source: sourceId }) };
const RETIREMENT_DESTINATIONS = Object.freeze({
  catalog: { view: "catalog-detail", label: "the publication page", patch: ({ catalogId }) => ({ catalog: catalogId }) },
  limb: { view: "atlas-map", label: "Atlas", patch: ({ id }) => ({ node: id }) },
  trunk: { view: "atlas-map", label: "Atlas", patch: ({ id }) => ({ node: id }) },
  policy_directive: toSources,
  regulation: toSources,
  statute: toSources,
  zt_mapping_document: toSources,
  zt_collaborator: { view: "search", label: "Library search", patch: ({ title }) => ({ query: title }) },
  zt_mapping_contributor: { view: "search", label: "Library search", patch: ({ title }) => ({ query: title }) },
});

export function isRetiredRecordPair(catalogId, recordType) {
  const entry = dispositionFor(catalogId, recordType);
  return Boolean(entry && RETIRED_DISPOSITIONS.has(entry.disposition));
}

/** Record types with no public page in any registered catalog. */
export const RETIRED_RECORD_TYPES = Object.freeze(new Set(
  [...new Set(SUPPORTED_RECORD_CONTRACT_KEYS.map((key) => key.split(":")[1]))]
    .filter((type) => SUPPORTED_RECORD_CONTRACT_KEYS
      .filter((key) => key.endsWith(`:${type}`))
      .every((key) => isRetiredRecordPair(...key.split(":")))),
));

/** True for record types whose retired page is Atlas itself, so Atlas must not link back to it. */
export function retiresIntoAtlas(recordType) {
  return RETIRED_RECORD_TYPES.has(recordType) && RETIREMENT_DESTINATIONS[recordType]?.view === "atlas-map";
}

export function retirementDestinationFor(recordType) {
  return RETIREMENT_DESTINATIONS[recordType] || null;
}

/** Where an old record URL goes, or null when the pair stays a public page. */
export function recordRetirement({ catalogId, recordType, id, sourceId = "", title = "" }) {
  if (!isRetiredRecordPair(catalogId, recordType)) return null;
  const destination = RETIREMENT_DESTINATIONS[recordType];
  if (!destination) return null;
  return Object.freeze({
    view: destination.view,
    label: destination.label,
    patch: Object.freeze(destination.patch({ catalogId, id, sourceId, title })),
  });
}

/**
 * The Templates page only offers catalogs that have a build context, so a
 * template handoff from any other catalog lands on a page with nothing
 * selected. Keep this in step with BUILD_SOURCE_CONTEXTS (a test enforces it).
 * SP 800-53B baselines hand off through the 800-53 control catalog.
 */
export const TEMPLATE_HANDOFF_FRAMEWORKS = Object.freeze({
  "nist-800-53": "nist-800-53",
  "nist-800-53b": "nist-800-53",
  "fedramp-rev5": "fedramp-rev5",
});

const COMPARABLE_ROLES = new Set([
  PAGE_ROLES.ATOMIC_RECORD,
  PAGE_ROLES.ASSESSMENT_QUESTION,
  PAGE_ROLES.IMPLEMENTATION_ARTIFACT,
]);

/**
 * One capability policy for every action a record page offers, used by the
 * header menu and the sidebar alike so they can never disagree.
 *
 *  - compare: only when the record has a published cross-publication mapping
 *    to compare (the same predicate the Compare workbench uses).
 *  - template: only where the Templates page can actually preselect the catalog.
 *  - atlas.header: promoted to the header only when there is something to
 *    explore (structure or connections). The sidebar link is always there.
 */
export function recordActionPolicy({
  catalogId,
  pageRole,
  hasItemId = true,
  comparableEdgeCount = 0,
  structuralChildCount = 0,
  connectionCount = 0,
}) {
  return Object.freeze({
    atlas: Object.freeze({ header: structuralChildCount > 0 || connectionCount > 0, rail: true }),
    compare: Boolean(hasItemId) && COMPARABLE_ROLES.has(pageRole) && comparableEdgeCount > 0,
    templateFramework: TEMPLATE_HANDOFF_FRAMEWORKS[catalogId] || null,
    share: true,
    report: true,
  });
}

/**
 * A container only shows an inventory when something is actually published
 * beneath it. Selection and dependency objects (baselines, impact levels,
 * program levels) have no structural children and must not render an empty
 * "Contained records" block.
 */
export function recordShowsChildInventory({ pageRole, structuralChildCount }) {
  if (structuralChildCount <= 0) return false;
  return pageRole === PAGE_ROLES.CONTAINER || pageRole === PAGE_ROLES.PUBLICATION_DOCUMENT;
}

export function unlabeledPublishedFacts(contract) {
  return contract.metadata_facts.filter((field) => !RECORD_FACT_LABELS[field]);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

/** Every pair the registry declares, resolved through the real contract lookup. */
export function registeredRecordPairs() {
  return SUPPORTED_RECORD_CONTRACT_KEYS.map((key) => {
    const [catalogId, recordType] = key.split(":");
    const contract = recordPresentationContract(catalogId, recordType);
    return { key, catalogId, recordType, contract };
  });
}

/**
 * Streaming accumulator so the corpus (tens of thousands of nodes) is never
 * held as objects: addNode() for every node, then addEdge() for every edge,
 * then finish(). Only per-node counters and per-pair picks are kept.
 */
export function createRecordMatrixAccumulator() {
  const pairs = new Map(registeredRecordPairs().map((pair) => [pair.key, {
    ...pair,
    count: 0,
    nodes: new Map(),
    sources: new Map(),
  }]));
  const pairOfNode = new Map();
  const unsupported = new Map();

  const addNode = (node) => {
    const type = node.node_type;
    const catalogId = node.metadata?.catalog_id || "";
    let contract;
    try {
      contract = recordPresentationContract(catalogId, type);
    } catch {
      if (!NON_RECORD_NODE_TYPES.has(type) && node.metadata?.structural_group !== true) {
        unsupported.set(`${catalogId}:${type}`, (unsupported.get(`${catalogId}:${type}`) || 0) + 1);
      }
      return;
    }
    const key = `${contract.catalog_id}:${type}`;
    const pair = pairs.get(key);
    if (!pair) {
      unsupported.set(key, (unsupported.get(key) || 0) + 1);
      return;
    }
    const metadata = { ...node.metadata, description: node.metadata?.description || "" };
    const populatedSections = contract.sections.filter((entry) => hasValue(metadata[entry.field])).length;
    const populatedFacts = contract.metadata_facts.filter((field) => hasValue(metadata[field])).length;
    pair.count += 1;
    pair.sources.set(node.source_id || "", (pair.sources.get(node.source_id || "") || 0) + 1);
    pair.nodes.set(node.id, {
      id: node.id,
      density: populatedSections + populatedFacts,
      populatedSections,
      populatedFacts,
      lifecycle: String(node.lifecycle_status || "active"),
      itemId: node.metadata?.item_id || "",
      edges: 0,
      comparable: 0,
      children: 0,
      selected: 0,
    });
    pairOfNode.set(node.id, key);
  };

  const addEdge = (edge) => {
    if (edge.publication_status !== "published") return;
    const structural = edge.relationship_class === "structural";
    const comparable = isComparisonCapableEdge(edge);
    const source = pairs.get(pairOfNode.get(edge.source_node_id))?.nodes.get(edge.source_node_id);
    const target = pairs.get(pairOfNode.get(edge.target_node_id))?.nodes.get(edge.target_node_id);
    if (structural) {
      if (source) source.children += 1;
      return;
    }
    const sourcePair = pairs.get(pairOfNode.get(edge.source_node_id));
    if (source && sourcePair.contract.selections.some((entry) => entry.relationship_type === edge.relationship_type)) source.selected += 1;
    for (const side of [source, target]) {
      if (!side) continue;
      side.edges += 1;
      if (comparable) side.comparable += 1;
    }
  };

  /**
   * @param {{ sourceLabel?: (sourceId: string) => string, searchIncluded?: (recordType: string) => boolean }} [options]
   */
  const finish = ({ sourceLabel = () => "", searchIncluded = (type) => !NON_RECORD_NODE_TYPES.has(type) && !RETIRED_RECORD_TYPES.has(type) } = {}) => {
    const rows = [...pairs.values()].map((pair) => {
      const nodes = [...pair.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
      const pick = (predicate, rank) => nodes.filter(predicate).sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))[0] || null;
      const dense = pick(() => true, (n) => n.density);
      // Only a record thinner than the representative is a useful sparse example.
      const sparse = pick((n) => n.density < (dense?.density ?? 0), (n) => -n.density);
      const historical = nodes.find((n) => n.lifecycle !== "active") || null;
      const connected = pick((n) => n.edges > 0, (n) => n.edges);
      const unconnected = nodes.find((n) => n.edges === 0) || null;
      const representative = dense;
      const disposition = dispositionFor(pair.catalogId, pair.recordType);
      const unlabeled = unlabeledPublishedFacts(pair.contract);
      const containerNodes = pair.contract.page_role === PAGE_ROLES.CONTAINER ? nodes : [];
      const emptyContainers = containerNodes.filter((n) => n.children === 0).length;
      const issues = [];
      if (!disposition) issues.push("NO_DISPOSITION");
      if (!representative) issues.push("NO_REPRESENTATIVE_RECORD");
      if (unlabeled.length) issues.push(`UNLABELED_FACTS:${unlabeled.join(",")}`);
      if (emptyContainers > 0) issues.push(`EMPTY_CONTAINERS:${emptyContainers}/${containerNodes.length}`);
      if (pair.contract.selections.length && !nodes.some((n) => n.selected > 0)) issues.push("SELECTION_SPEC_UNUSED");
      const hardFailure = issues.some((issue) => /^(NO_DISPOSITION|NO_REPRESENTATIVE_RECORD|UNLABELED_FACTS|SELECTION_SPEC_UNUSED)/.test(issue));
      const acceptance = !disposition ? "UNREVIEWED"
        : hardFailure ? "BLOCKED"
        : disposition.status === REVIEW_STATUS.ACCEPTED ? "ACCEPTED" : "PROVISIONAL";
      const topSource = [...pair.sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      return {
        pair: pair.key,
        catalog_id: pair.catalogId,
        record_type: pair.recordType,
        page_role: pair.contract.page_role,
        record_count: pair.count,
        representative_id: representative?.id || null,
        sparse_id: sparse?.id || null,
        historical_id: historical?.id || null,
        most_connected_id: connected?.id || null,
        unconnected_id: unconnected?.id || null,
        publisher: sourceLabel(topSource),
        library_search_included: searchIncluded(pair.recordType),
        standalone_route: !isRetiredRecordPair(pair.catalogId, pair.recordType),
        redirects_to: retirementDestinationFor(pair.recordType)?.view || null,
        sections_declared: pair.contract.sections.map((entry) => entry.heading),
        sections_populated: representative?.populatedSections ?? 0,
        facts_declared: [...pair.contract.metadata_facts],
        facts_populated: representative?.populatedFacts ?? 0,
        structural_children: representative?.children ?? 0,
        empty_container_records: emptyContainers,
        related_connections: representative?.edges ?? 0,
        selection_records: nodes.reduce((total, n) => total + n.selected, 0),
        actions: representative ? recordActionPolicy({
          catalogId: pair.catalogId,
          pageRole: pair.contract.page_role,
          hasItemId: Boolean(representative.itemId),
          comparableEdgeCount: representative.comparable,
          structuralChildCount: representative.children,
          connectionCount: representative.edges,
        }) : null,
        disposition: disposition?.disposition || null,
        disposition_reason: disposition?.reason || "",
        review_tier: disposition?.tier ?? null,
        review_status: disposition?.status || null,
        acceptance,
        issues,
      };
    });
    return { rows, unsupported: Object.fromEntries(unsupported) };
  };

  return { addNode, addEdge, finish };
}

export function summarizeRecordMatrix(rows) {
  const count = (field) => rows.reduce((acc, row) => ({ ...acc, [row[field]]: (acc[row[field]] || 0) + 1 }), {});
  return {
    pairs: rows.length,
    catalogs: new Set(rows.map((row) => row.catalog_id)).size,
    record_types: new Set(rows.map((row) => row.record_type)).size,
    with_representative: rows.filter((row) => row.representative_id).length,
    by_disposition: count("disposition"),
    by_acceptance: count("acceptance"),
  };
}

export { CATALOG_RECORD_TYPES };
