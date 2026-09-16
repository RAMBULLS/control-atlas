import {
  isComparisonCapableEdge,
  mappingSourceIdsForEdge,
} from "../shared/compare-capability.mjs";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// build-framework-data.mjs omits evidence_ids from the emitted edge when it
// is exactly the mechanical `evidence:<edge-id-suffix>` pattern (every edge
// has exactly one evidence entry, sized 1:1 with the edge, i.e. genuinely
// redundant JSON — a real ~2.2 MiB budget win, not lost data). Derive it
// back here rather than storing it on all 28k+ edges.
function evidenceIdsFor(edge) {
  if (!edge) return [];
  if (edge.evidence_ids !== undefined) return edge.evidence_ids;
  return edge.id ? [`evidence:${edge.id.slice("edge:".length)}`] : [];
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SEARCH_INTENT_ALIASES = [
  {
    terms: [/\b(review|inspect|check)\b/i, /\baudit\s+logs?\b/i],
    query: "monitoring physical access",
  },
  {
    terms: [
      /\b(manage|managing|administer|control|review)\b/i,
      /\b(system\s+|user\s+)?accounts?\b/i,
    ],
    query: "account management",
  },
  {
    terms: [
      /\b(data|information)\b/i,
      /\b(stored|storage|at\s+rest)\b/i,
      /\b(protect|protection|secure|encrypt|encryption)\b/i,
    ],
    query: "protection information at rest",
  },
  {
    terms: [
      /\b(reuse|reusing|reused|invalidate|logout)\b/i,
      /\b(login\s+)?sessions?\b|\bsession\s+(token|identifier)s?\b/i,
    ],
    query: "invalidate session identifiers logout",
  },
  {
    terms: [
      /\bvulnerabilit(?:y|ies)\b|\bsecurity\s+(flaws?|weakness(?:es)?)\b/i,
      /\b(fix|fixing|remediate|remediation|scan|scanning|find)\b/i,
    ],
    query: "vulnerability monitoring scanning",
  },
  {
    terms: [
      /\b(security\s+|cyber\s+)?incident\b|\bbreach\b/i,
      /\b(happen|happens|respond|response|handle|handling|do)\b/i,
    ],
    query: "incident handling",
  },
  {
    terms: [/\b(mfa|2fa|two[- ]factor|multi[- ]factor)\b/i],
    query: "IA-2.1",
  },
  {
    terms: [/\bssp\b/i],
    query: "PL-2",
  },
  {
    terms: [
      /\b(in[- ]transit|transmission|tls|ssl)\b/i,
      /\b(encrypt|encryption|protect|security)\b/i,
    ],
    query: "transmission confidentiality and integrity",
  },
];

function expandLibrarySearchIntent(value) {
  const raw = String(value || "").trim();
  const alias = SEARCH_INTENT_ALIASES.find(({ terms }) =>
    terms.every((pattern) => pattern.test(raw)),
  );
  return alias?.query || raw;
}

function normalizeLibrarySearchQuery(value) {
  const expanded = expandLibrarySearchIntent(value)
    .replace(/poa\s*&\s*m/gi, "poam")
    .replace(/poa\s+and\s+m/gi, "poam")
    .replace(/\b([a-z]{2,4})[-\s]?0*(\d+)\s*\(\s*0*(\d+)\s*\)/gi, "$1-$2.$3")
    .replace(/\b([a-z]{2,4})[-\s]?0*(\d+)\.0*(\d+)\b/gi, "$1-$2.$3")
    .replace(/\b([a-z]{2,4})[-\s]0*(\d+)\b/gi, "$1-$2")
    .replace(/\b([a-z]{2,4})0+(\d+)\b/gi, "$1-$2");
  const terms = expanded.match(/[a-zA-Z0-9][a-zA-Z0-9.()-]*/g) || [];
  return terms
    .filter(
      (term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term.toLowerCase()),
    )
    .join(" ");
}

function librarySearchRankBoost(document, query) {
  const normalizedQuery = normalize(query);
  const title = document?.search_title || normalize(document?.title);
  const itemId = document?.search_item_id || normalize(document?.item_id);
  let boost = 0;
  if (title === normalizedQuery) boost += 10_000;
  else if (title.includes(normalizedQuery)) boost += 1_000;
  if (itemId === normalizedQuery) boost += 20_000;
  if (document?.object_type === "control") boost += 200;
  if (document?.catalog_id === "nist-800-53") boost += 50;
  return boost;
}

// Resolves aliases for practitioner notations and variations:
// - Leading zeros: "AC-02" -> "ac-2", "AC-02(01)" -> "ac-2.1"
// - Parentheses to dot: "AC-2(1)" / "AC-2 (1)" -> "ac-2.1"
// - Missing hyphens/spaces: "AC2", "AC 02" -> "ac-2"
// - Padded DISA CCI: "CCI-225", "CCI 225" -> "cci-000225"
// - ATT&CK slash to dot: "T1059/001" -> "t1059.001"
// - Authority prefixes: "NIST AC-02" -> "ac-2", "DISA CCI 123" -> "cci-000123"
export function resolveControlAliases(rawNeedle) {
  if (!rawNeedle || typeof rawNeedle !== "string") return [];
  const trimmed = rawNeedle.trim();
  if (!trimmed) return [];

  const aliases = new Set();
  aliases.add(trimmed.toLowerCase());

  const strippedPrefix = trimmed
    .replace(/^(?:nist\s*800-53|sp\s*800-53|nist|rev\s*5|disa|dod)\s+/i, "")
    .trim();
  if (strippedPrefix && strippedPrefix.toLowerCase() !== trimmed.toLowerCase()) {
    aliases.add(strippedPrefix.toLowerCase());
  }

  const candidateInputs = [trimmed, strippedPrefix].filter(Boolean);

  for (const input of candidateInputs) {
    // 1. DISA CCI normalization: "cci-123", "cci 123", "cci123", "cci-000123"
    const cciMatch = input.match(/^(?:cci[-\s]*)0*(\d{1,6})$/i);
    if (cciMatch) {
      const num = Number.parseInt(cciMatch[1], 10);
      if (!Number.isNaN(num) && num > 0) {
        aliases.add(`cci-${String(num).padStart(6, "0")}`);
      }
      continue;
    }

    // 2. MITRE ATT&CK sub-technique: "t1059/001", "t1059-001", "t1059 001", "t1059.001"
    const attackMatch = input.match(/^(t\d{4})[./\-\s](\d{3})$/i);
    if (attackMatch) {
      aliases.add(`${attackMatch[1].toLowerCase()}.${attackMatch[2]}`);
      continue;
    }

    // 3. NIST / Federal Control enhancements (do NOT add base control):
    // Parenthetical enhancements: "ac-02 (01)", "ac-2(1)", "ac-02(1)(a)"
    const parenMatch = input.match(/^([a-z]{2,4})[-\s]?0*(\d+)\s*\(\s*0*(\d+)\s*\)/i);
    if (parenMatch) {
      const family = parenMatch[1].toLowerCase();
      const controlNum = Number.parseInt(parenMatch[2], 10);
      const enhNum = Number.parseInt(parenMatch[3], 10);
      aliases.add(`${family}-${controlNum}.${enhNum}`);
      continue;
    }

    // Dot enhancements: "ac-02.01", "ac-2.01", "ac-2.1"
    const dotMatch = input.match(/^([a-z]{2,4})[-\s]?0*(\d+)\.0*(\d+)$/i);
    if (dotMatch) {
      const family = dotMatch[1].toLowerCase();
      const controlNum = Number.parseInt(dotMatch[2], 10);
      const enhNum = Number.parseInt(dotMatch[3], 10);
      aliases.add(`${family}-${controlNum}.${enhNum}`);
      continue;
    }

    // Base control IDs: "ac-02", "ac-2", "ac02", "ac2", "ac 02", "ac 2"
    const baseMatch = input.match(/^([a-z]{2,4})[-\s]?0*(\d+)$/i);
    if (baseMatch) {
      const family = baseMatch[1].toLowerCase();
      const controlNum = Number.parseInt(baseMatch[2], 10);
      aliases.add(`${family}-${controlNum}`);
      continue;
    }

    // 4. CSF style: e.g. "pr.ac-01", "pr.ac-1", "pr ac 1", "pr-ac-1"
    const csfMatch = input.match(/^([a-z]{2})[.\-\s]([a-z]{2})[-\s]?0*(\d+)$/i);
    if (csfMatch) {
      const func = csfMatch[1].toLowerCase();
      const cat = csfMatch[2].toLowerCase();
      const num = Number.parseInt(csfMatch[3], 10);
      aliases.add(`${func}.${cat}-${num}`);
      continue;
    }
  }

  return [...aliases];
}

function normalizeControlNotation(needle) {
  const aliases = resolveControlAliases(needle);
  return aliases.length > 1 ? aliases[1] : (aliases[0] || needle);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesLibraryFacet(document, filters = {}) {
  const catalogIds = Array.isArray(filters.catalog_ids)
    ? new Set(filters.catalog_ids)
    : null;
  const objectTypes = Array.isArray(filters.object_types)
    ? new Set(filters.object_types)
    : null;
  return (
    (!filters.object_type || document.object_type === filters.object_type) &&
    (!objectTypes?.size || objectTypes.has(document.object_type)) &&
    (!filters.source_class || document.source_class === filters.source_class) &&
    (!filters.control_family ||
      document.control_family === filters.control_family) &&
    (!filters.severity || document.severity === filters.severity) &&
    (!filters.catalog_id || document.catalog_id === filters.catalog_id) &&
    (!catalogIds?.size || catalogIds.has(document.catalog_id)) &&
    (!filters.publisher_name || document.publisher_name === filters.publisher_name) &&
    (!filters.connected_only || Number(document.published_connection_count || 0) > 0) &&
    matchesTaxonomyTagGroups(document.taxonomy_tags, filters.taxonomy_tag_groups)
  );
}

function taxonomyTagIds(tags) {
  return new Set((tags || []).map((tag) => typeof tag === "string" ? tag : tag?.id).filter(Boolean));
}

function matchesTaxonomyTagGroups(tags, groups = []) {
  if (!groups?.length) return true;
  const ids = taxonomyTagIds(tags);
  return groups.every((alternatives) => alternatives.some((id) => ids.has(id)));
}

function itemIdFor(node) {
  return node?.metadata?.item_id || node?.id || "";
}

function itemTitleFor(node) {
  return node?.metadata?.title || node?.label || itemIdFor(node);
}

function sourceRefLabel(ref) {
  const version = ref.source_version ? ` v${ref.source_version}` : "";
  const locator = ref.locator ? ` @ ${ref.locator}` : "";
  const quality = ref.evidence_quality ? ` [${ref.evidence_quality}]` : "";
  return `${ref.source_name}${version}${locator}${quality}`;
}

function exportJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exportMarkdownTable(headers, rows) {
  const headerRow = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) =>
      `| ${row.map((cell) => String(cell ?? "").replaceAll("\n", "<br>")).join(" | ")} |`,
  );
  return `${[headerRow, divider, ...body].join("\n")}\n`;
}

function baselineState(base = {}) {
  return {
    ...base,
    view: "matrix",
    workbench: "relationships",
    source: "",
    target: "",
    items: "",
    relationshipType: "",
    provenance: "",
    confidence: "",
    includeCandidates: "",
    chainCatalog: "",
    chainBenchmark: "",
    chainItem: "",
    baselineA: "",
    baselineB: "",
  };
}

export function createFederalGraphRuntime(opts) { const res = _createFederalGraphRuntime(opts); globalThis.debugRuntime = res; return res; } function _createFederalGraphRuntime(dataset) {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const sourceById = new Map(
    dataset.sources.map((source) => [source.id, source]),
  );
  const evidenceById = new Map(
    dataset.evidence.map((entry) => [entry.id, entry]),
  );
  const edgeById = new Map(dataset.edges.map((edge) => [edge.id, edge]));
  const edgesBySource = new Map();
  for (const edge of dataset.edges) {
    const existing = edgesBySource.get(edge.source_node_id);
    if (existing) existing.push(edge);
    else edgesBySource.set(edge.source_node_id, [edge]);
  }
  const suppliedLibraryDocuments = dataset.librarySearch?.documents || [];
  const indexedLibraryTransport = dataset.librarySearch?.indexed_transport;
  const indexedLibraryFields = indexedLibraryTransport?.format === "columns-v1"
    && Array.isArray(indexedLibraryTransport.fields)
    && Array.isArray(indexedLibraryTransport.columns)
    && indexedLibraryTransport.fields.length === indexedLibraryTransport.columns.length
    ? indexedLibraryTransport.fields
    : [];
  const indexedLibraryColumns = indexedLibraryFields.length
    ? indexedLibraryTransport.columns
    : [];
  const indexedLibraryFieldIndex = new Map(
    indexedLibraryFields.map((field, index) => [field, index]),
  );
  const indexedLibraryDocumentCount = indexedLibraryColumns[0]?.length || 0;
  const indexedLibraryDocumentCache = new Map();
  const libraryDocuments =
    dataset.nodes.length === 0 ? suppliedLibraryDocuments : [];
  let libraryDocumentById =
    dataset.nodes.length === 0 ? null : new Map();

  function ingestLibrarySearch(searchArtifact) {
    if (!searchArtifact) return null;
    if (dataset.nodes.length === 0) return null;
    for (const document of searchArtifact.documents || []) {
      if (libraryDocumentById.has(document.id)) {
        continue;
      }
      const node = nodeById.get(document.id);
      const hydratedDocument = node?.metadata?.description
        ? { ...document, description: node.metadata.description }
        : document;
      libraryDocumentById.set(document.id, hydratedDocument);
      libraryDocuments.push(hydratedDocument);
    }
  }

  function getLibraryDocumentById(id) {
    if (!libraryDocumentById) {
      libraryDocumentById = new Map(
        libraryDocuments.map((document) => [document.id, document]),
      );
    }
    return libraryDocumentById.get(id) || null;
  }

  function indexedLibraryValue(index, field) {
    const fieldIndex = indexedLibraryFieldIndex.get(field);
    return fieldIndex === undefined ? undefined : indexedLibraryColumns[fieldIndex]?.[index];
  }

  function indexedLibraryDocument(index) {
    const cached = indexedLibraryDocumentCache.get(index);
    if (cached) return cached;
    const document = Object.fromEntries(indexedLibraryFields.map((field) => [
      field,
      indexedLibraryValue(index, field),
    ]));
    indexedLibraryDocumentCache.set(index, document);
    return document;
  }

  function indexedLibraryFacetMatches(index, filters = {}) {
    const catalogIds = Array.isArray(filters.catalog_ids)
      ? filters.catalog_ids
      : [];
    const objectTypes = Array.isArray(filters.object_types)
      ? filters.object_types
      : [];
    return (
      (!filters.object_type || indexedLibraryValue(index, "object_type") === filters.object_type) &&
      (!objectTypes.length || objectTypes.includes(indexedLibraryValue(index, "object_type"))) &&
      (!filters.source_class || indexedLibraryValue(index, "source_class") === filters.source_class) &&
      (!filters.control_family || indexedLibraryValue(index, "control_family") === filters.control_family) &&
      (!filters.severity || indexedLibraryValue(index, "severity") === filters.severity) &&
      (!filters.catalog_id || indexedLibraryValue(index, "catalog_id") === filters.catalog_id) &&
      (!catalogIds.length || catalogIds.includes(indexedLibraryValue(index, "catalog_id"))) &&
      (!filters.publisher_name || indexedLibraryValue(index, "publisher_name") === filters.publisher_name) &&
      (!filters.connected_only || Number(indexedLibraryValue(index, "published_connection_count") || 0) > 0) &&
      matchesTaxonomyTagGroups(indexedLibraryValue(index, "taxonomy_tags"), filters.taxonomy_tag_groups)
    );
  }

  function indexedLibraryRankBoost(index, query) {
    const title = normalize(indexedLibraryValue(index, "title"));
    const itemId = normalize(indexedLibraryValue(index, "item_id"));
    let boost = 0;
    if (title === query) boost += 10_000;
    else if (title.includes(query)) boost += 1_000;
    if (itemId === query) boost += 20_000;
    if (indexedLibraryValue(index, "object_type") === "control") boost += 200;
    if (indexedLibraryValue(index, "catalog_id") === "nist-800-53") boost += 50;
    return boost;
  }

  ingestLibrarySearch(dataset.librarySearch);
  // A catalog's declared node_type for its grouping tier (see CATALOG_TIERS
  // in scripts/build-framework-data.mjs) — used to split a catalog's total
  // node_count into "leaf records" vs "grouping tiers" instead of quoting one
  // mixed number, and to give the tier a plain-language name in the UI
  // instead of always calling it a "family". `function` is never a leaf
  // record's immediate parent (CSF nests Category under it), so it is
  // excluded from both counts here.
  const TIER_NODE_TYPES = new Set([
    "family",
    "benchmark",
    "category",
    "tactic",
    "group",
  ]);
  const NON_LEAF_NODE_TYPES = new Set([...TIER_NODE_TYPES, "function", "catalog"]);
  const TIER_TYPE_LABELS = {
    family: ["family", "families"],
    benchmark: ["benchmark", "benchmarks"],
    category: ["category", "categories"],
    tactic: ["tactic", "tactics"],
    group: ["group", "groups"],
  };
  // Plain-language overrides for catalogs whose shared "group" node_type
  // would otherwise read as vague — each name matches or plainly reflects
  // that framework's own published vocabulary (SSDF calls these "Practice
  // Groups"; AI RMF nests them under its four Functions; DoD AI Assurance's are
  // titled sections, not a named taxonomy).
  const CATALOG_TIER_LABEL_OVERRIDES = {
    "nist-ai-rmf": ["function area", "function areas"],
    "nist-ssdf": ["practice group", "practice groups"],
    "dod-rai": ["section", "sections"],
  };
  const CATALOG_DISPLAY_NAMES = {
    "cmmc-2": { name: "CMMC 2.0", group: "Other" },
    "csf-2": { name: "NIST CSF 2.0", group: "NIST" },
    "cui-policy": { name: "CUI Program", group: "Other" },
    "disa-cci": { name: "DISA CCI", group: "DISA" },
    "disa-srg": { name: "DISA SRG", group: "DISA" },
    "disa-stig": { name: "DISA STIG", group: "DISA" },
    "dod-rai": { name: "DoD AI Assurance", group: "DoD" },
    "dod-zt": { name: "DoD Zero Trust", group: "DoD" },
    "fedramp-rev5": { name: "FedRAMP Rev. 5", group: "Other" },
    "fedramp-2026": { name: "FedRAMP Consolidated Rules for 2026", group: "FedRAMP" },
    "fips-199": { name: "FIPS 199", group: "NIST" },
    "fips-200": { name: "FIPS 200", group: "NIST" },
    "nist-800-171": { name: "SP 800-171 Rev. 3", group: "NIST" },
    "nist-800-171-rev2": { name: "SP 800-171 Rev. 2", group: "NIST" },
    "nist-800-172": { name: "SP 800-172 Rev. 3", group: "NIST" },
    "nist-800-37": { name: "SP 800-37 Rev. 2", group: "NIST" },
    "nist-800-53": { name: "SP 800-53 Rev. 5", group: "NIST" },
    "nist-800-53a": { name: "SP 800-53A Rev. 5", group: "NIST" },
    "nist-800-53b": { name: "SP 800-53B", group: "NIST" },
    "nist-ai-rmf": { name: "AI RMF", group: "NIST" },
    "nist-ssdf": { name: "SSDF", group: "NIST" },
    "mitre-attack": { name: "MITRE ATT&CK", group: "MITRE" },
    "mitre-attack-ics": { name: "MITRE ATT&CK for ICS", group: "MITRE" },
    "mitre-d3fend": { name: "MITRE D3FEND", group: "MITRE" },
    // These four were missing, so pickers and labels fell back to the raw
    // catalog id ("nist-zt", "nist-iot-cybersecurity"). The names match
    // CATALOG_STRUCTURE_PROFILES exactly; tests/display-names.test.mjs fails
    // the build if the two tables drift apart again.
    "microsoft-zt-maturity": {
      name: "Microsoft Zero Trust Maturity Questionnaire",
      group: "Microsoft",
    },
    "nist-iot-cybersecurity": {
      name: "NIST IoT Device Cybersecurity",
      group: "NIST",
    },
    "nist-mobile-threats": { name: "NIST Mobile Threat Catalogue", group: "NIST" },
    "nist-zt": { name: "NIST Zero Trust", group: "NIST" },
  };

  // Nodes that participate in at least one published edge — used to report
  // honest per-catalog connectivity instead of implying full coverage.
  const connectedNodeIds = new Set();
  const crossCatalogConnectedNodeIds = new Set();
  for (const edge of dataset.edges) {
    if (edge.publication_status && edge.publication_status !== "published") {
      continue;
    }
    connectedNodeIds.add(edge.source_node_id);
    connectedNodeIds.add(edge.target_node_id);
    const sourceCatalog = nodeById.get(edge.source_node_id)?.metadata?.catalog_id;
    const targetCatalog = nodeById.get(edge.target_node_id)?.metadata?.catalog_id;
    if (
      sourceCatalog &&
      targetCatalog &&
      sourceCatalog !== targetCatalog &&
      isComparisonCapableEdge(edge)
    ) {
      crossCatalogConnectedNodeIds.add(edge.source_node_id);
      crossCatalogConnectedNodeIds.add(edge.target_node_id);
    }
  }
  const derivedCatalogs = [
    ...new Set(
      dataset.nodes.map((node) => node.metadata?.catalog_id).filter(Boolean),
    ),
  ]
    .sort()
    .map((id) => {
      const catalogNodes = dataset.nodes.filter(
        (node) => node.metadata?.catalog_id === id,
      );
      const catalogRoot = catalogNodes.find(
        (node) => node.node_type === "catalog",
      );
      const connectedCount = catalogNodes.filter((node) =>
        connectedNodeIds.has(node.id),
      ).length;
      const crossCatalogConnectedCount = catalogNodes.filter((node) =>
        crossCatalogConnectedNodeIds.has(node.id),
      ).length;
      const tierNode = catalogNodes.find((node) =>
        TIER_NODE_TYPES.has(node.node_type),
      );
      const tierType = tierNode?.node_type || null;
      const tierLabels = tierType
        ? CATALOG_TIER_LABEL_OVERRIDES[id] || TIER_TYPE_LABELS[tierType]
        : null;
      const leafRecordCount = catalogNodes.filter(
        (node) => !NON_LEAF_NODE_TYPES.has(node.node_type),
      ).length;
      const tierCount = tierType
        ? catalogNodes.filter((node) => node.node_type === tierType).length
        : 0;
      return {
        id,
        name: CATALOG_DISPLAY_NAMES[id]?.name || id,
        display_group: CATALOG_DISPLAY_NAMES[id]?.group || "Other",
        node_count: catalogNodes.length,
        // Plain-language split of node_count so a UI can say "603 rules
        // across 11 benchmarks" instead of one mixed "614 records" figure
        // that silently counts both the leaves and their grouping tiers.
        leaf_record_count: leafRecordCount,
        tier_count: tierCount,
        tier_label: tierLabels?.[0] || null,
        tier_label_plural: tierLabels?.[1] || null,
        connected_count: connectedCount,
        cross_catalog_connected_count: crossCatalogConnectedCount,
        mandate: catalogRoot?.metadata?.mandate,
        primary_authority: catalogRoot?.metadata?.primary_authority ?? null,
        also_required_by: catalogRoot?.metadata?.also_required_by || [],
        publication_type: catalogRoot?.metadata?.publication_type || "",
        mandate_note: catalogRoot?.metadata?.mandate_note || "",
        relationship_count: dataset.edges.filter(
          (edge) =>
            nodeById.get(edge.source_node_id)?.metadata?.catalog_id === id ||
            nodeById.get(edge.target_node_id)?.metadata?.catalog_id === id,
        ).length,
      };
    });
  const catalogs = Array.isArray(dataset.catalogs)
    ? dataset.catalogs
    : derivedCatalogs;
  // Comparison is an evidence-navigation task, not a free-form catalog
  // picker. Compute the published cross-catalog pairs once when the complete
  // graph is loaded so the UI can offer only pairs that have a real, cited
  // connection in this dataset. Direction is deliberately symmetric for
  // choosing a pair; individual rows retain their published direction.
  const publishedCatalogConnectionCounts = new Map();
  const catalogConnectionKey = (fromCatalog, toCatalog) =>
    `${fromCatalog}\u0000${toCatalog}`;
  for (const edge of dataset.edges) {
    if (!isComparisonCapableEdge(edge)) continue;
    if (!mappingSourceIdsForEdge(edge).length) continue;
    const fromCatalog = nodeById.get(edge.source_node_id)?.metadata?.catalog_id;
    const toCatalog = nodeById.get(edge.target_node_id)?.metadata?.catalog_id;
    if (!fromCatalog || !toCatalog || fromCatalog === toCatalog) continue;
    for (const [left, right] of [[fromCatalog, toCatalog], [toCatalog, fromCatalog]]) {
      const key = catalogConnectionKey(left, right);
      publishedCatalogConnectionCounts.set(
        key,
        (publishedCatalogConnectionCounts.get(key) || 0) + 1,
      );
    }
  }
  const sortNodesByItemId = (left, right) =>
    itemIdFor(left).localeCompare(itemIdFor(right)) ||
    left.id.localeCompare(right.id);
  const sortRowsByIds = (left, right) =>
    left.from_item_id.localeCompare(right.from_item_id) ||
    left.to_item_id.localeCompare(right.to_item_id);
  const resolveSourceRefs = (edge) =>
    evidenceIdsFor(edge)
      .map((id) => {
        const entry = evidenceById.get(id);
        const source = sourceById.get(entry?.source_id);
        if (!entry) return null;
        return {
          source_id: entry.source_id,
          source_name: source?.display_name || source?.name || entry.source_id,
          source_version: entry.source_version || "",
          locator: entry.locator || "",
          evidence_quality: entry.evidence_quality || "",
        };
      })
      .filter(Boolean);
  const relationshipOrientation = (edge, sourceCatalog, targetCatalog) => {
    const sourceNode = nodeById.get(edge.source_node_id);
    const targetNode = nodeById.get(edge.target_node_id);
    if (!sourceNode || !targetNode) return null;
    const sourceCatalogId = sourceNode.metadata?.catalog_id || "";
    const targetCatalogId = targetNode.metadata?.catalog_id || "";
    if (sourceCatalog && targetCatalog) {
      if (
        sourceCatalogId === sourceCatalog &&
        targetCatalogId === targetCatalog
      )
        return { fromNode: sourceNode, toNode: targetNode };
      if (
        targetCatalogId === sourceCatalog &&
        sourceCatalogId === targetCatalog
      )
        return { fromNode: targetNode, toNode: sourceNode };
      return null;
    }
    if (sourceCatalog) {
      if (sourceCatalogId === sourceCatalog)
        return { fromNode: sourceNode, toNode: targetNode };
      if (targetCatalogId === sourceCatalog)
        return { fromNode: targetNode, toNode: sourceNode };
      return null;
    }
    return { fromNode: sourceNode, toNode: targetNode };
  };
  const buildRelationshipRow = (edge, fromNode, toNode) => ({
    edge_id: edge.id,
    from_id: fromNode.id,
    from_item_id: itemIdFor(fromNode),
    from_title: itemTitleFor(fromNode),
    from_catalog_id: fromNode.metadata?.catalog_id || "",
    from_taxonomy_tags: fromNode.metadata?.taxonomy_tags || [],
    to_id: toNode.id,
    to_item_id: itemIdFor(toNode),
    to_title: itemTitleFor(toNode),
    to_catalog_id: toNode.metadata?.catalog_id || "",
    to_taxonomy_tags: toNode.metadata?.taxonomy_tags || [],
    relationship_type: edge.relationship_type,
    provenance_class: edge.provenance_class,
    confidence: edge.confidence,
    publication_status: edge.publication_status,
    rationale: edge.rationale || "",
    navigation_note: edge.navigation_note || "",
    warning: edge.warning || "",
    inference_rule_id: edge.inference_rule_id || "",
    source_refs: resolveSourceRefs(edge),
  });
  const visibleRelationshipRows = (request = {}) => {
    const requestedNodeIds = new Set(request.node_ids || []);
    const matchedEdges = dataset.edges
      .map((edge) => {
        const orientation = relationshipOrientation(
          edge,
          request.source_catalog,
          request.target_catalog,
        );
        if (!orientation) return null;
        if (
          requestedNodeIds.size &&
          !requestedNodeIds.has(orientation.fromNode.id)
        )
          return null;
        if (
          request.relationship_type &&
          edge.relationship_type !== request.relationship_type
        )
          return null;
        if (
          request.provenance_class &&
          edge.provenance_class !== request.provenance_class
        )
          return null;
        if (request.confidence && edge.confidence !== request.confidence)
          return null;
        return buildRelationshipRow(
          edge,
          orientation.fromNode,
          orientation.toNode,
        );
      })
      .filter(Boolean);
    const visibleRows = matchedEdges
      .filter(
        (row) =>
          request.include_candidates || row.publication_status === "published",
      )
      .sort(sortRowsByIds);
    const hiddenCandidateCount =
      matchedEdges.filter((row) => row.publication_status === "candidate")
        .length -
      visibleRows.filter((row) => row.publication_status === "candidate")
        .length;
    return {
      request,
      rows: visibleRows,
      summary: {
        total: matchedEdges.length,
        visible: visibleRows.length,
        hidden_candidate_count: Math.max(0, hiddenCandidateCount),
      },
    };
  };
  const aggregateRelationshipRows = (rows = []) => {
    const map = new Map();
    for (const row of rows) {
      const key = row.from_id || row.from_item_id;
      if (!map.has(key)) {
        map.set(key, {
          from_id: row.from_id,
          from_item_id: row.from_item_id,
          from_title: row.from_title,
          from_catalog_id: row.from_catalog_id,
          from_taxonomy_tags: row.from_taxonomy_tags || [],
          targets: [],
        });
      }
      const group = map.get(key);
      group.targets.push({
        edge_id: row.edge_id,
        to_id: row.to_id,
        to_item_id: row.to_item_id,
        to_title: row.to_title,
        to_catalog_id: row.to_catalog_id,
        to_taxonomy_tags: row.to_taxonomy_tags || [],
        relationship_type: row.relationship_type,
        provenance_class: row.provenance_class,
        confidence: row.confidence,
        publication_status: row.publication_status,
        rationale: row.rationale || "",
        navigation_note: row.navigation_note || "",
        warning: row.warning || "",
        inference_rule_id: row.inference_rule_id || "",
        source_refs: row.source_refs || [],
      });
    }
    return [...map.values()];
  };
  const stigCatalogNodes = (chainCatalog = "disa-stig", chainBenchmark) => {
    const catalogId = chainCatalog || "disa-stig";
    return dataset.nodes
      .filter(
        (node) =>
          node.metadata?.catalog_id === catalogId &&
          (node.node_type === "stig_rule" || node.node_type === "rule"),
      )
      .filter(
        (node) =>
          !chainBenchmark ||
          node.metadata?.benchmark_id === chainBenchmark ||
          node.source_id === chainBenchmark,
      )
      .sort(sortNodesByItemId);
  };
  const cciLinksForNode = (nodeId, includeCandidates = false) =>
    (edgesBySource.get(nodeId) || [])
      .filter(
        (edge) =>
          nodeById.get(edge.target_node_id)?.metadata?.catalog_id ===
            "disa-cci" &&
          (includeCandidates || edge.publication_status === "published"),
      )
      .map((edge) => ({
        cciNode: nodeById.get(edge.target_node_id),
        relationshipEdge: edge,
        sourceRefs: resolveSourceRefs(edge),
      }))
      .filter((entry) => entry.cciNode)
      .sort((left, right) => sortNodesByItemId(left.cciNode, right.cciNode));
  const nistLinksForCci = (cciId, includeCandidates = false) =>
    (edgesBySource.get(cciId) || [])
      .filter(
        (edge) =>
          nodeById.get(edge.target_node_id)?.metadata?.catalog_id ===
            "nist-800-53" &&
          (includeCandidates || edge.publication_status === "published"),
      )
      .map((edge) => ({
        nistNode: nodeById.get(edge.target_node_id),
        relationshipEdge: edge,
        sourceRefs: resolveSourceRefs(edge),
      }))
      .filter((entry) => entry.nistNode)
      .sort((left, right) => sortNodesByItemId(left.nistNode, right.nistNode));
  const chainDetailCache = new Map();
  const buildChainDetail = (node, includeCandidates = false) => {
    const cacheKey = `${node.id}:${includeCandidates ? "1" : "0"}`;
    if (chainDetailCache.has(cacheKey)) {
      return chainDetailCache.get(cacheKey);
    }
    const cciEntries = cciLinksForNode(node.id, includeCandidates);
    const nistEntries = [];
    const seenNistIds = new Set();
    for (const cciEntry of cciEntries) {
      const links = nistLinksForCci(cciEntry.cciNode.id, includeCandidates);
      for (const link of links) {
        if (!seenNistIds.has(link.nistNode.id)) {
          seenNistIds.add(link.nistNode.id);
          nistEntries.push({
            ...link,
            viaCciNode: cciEntry.cciNode,
          });
        }
      }
    }
    const result = {
      source_node: node,
      cci_entries: cciEntries,
      nist_entries: nistEntries,
      cci_nodes: cciEntries.map((e) => e.cciNode),
      nist_nodes: nistEntries.map((e) => e.nistNode),
      unmapped_cci_nodes: cciEntries
        .filter(
          (e) =>
            nistLinksForCci(e.cciNode.id, includeCandidates).length === 0,
        )
        .map((e) => e.cciNode),
    };
    chainDetailCache.set(cacheKey, result);
    return result;
  };
  const attackCatalogNodes = (chainCatalog) =>
    dataset.nodes
      .filter((node) => node.node_type === "attack_technique")
      .filter(
        (node) => !chainCatalog || node.metadata?.catalog_id === chainCatalog,
      )
      .sort(sortNodesByItemId);
  const d3fendLinksForAttack = (nodeId, includeCandidates = false) =>
    (edgesBySource.get(nodeId) || [])
      .filter(
        (edge) =>
          nodeById.get(edge.target_node_id)?.metadata?.catalog_id ===
            "mitre-d3fend" &&
          (includeCandidates || edge.publication_status === "published"),
      )
      .map((edge) => ({
        d3fendNode: nodeById.get(edge.target_node_id),
        relationshipEdge: edge,
        sourceRefs: resolveSourceRefs(edge),
      }))
      .filter((entry) => entry.d3fendNode)
      .sort((left, right) =>
        sortNodesByItemId(left.d3fendNode, right.d3fendNode),
      );
  const nistLinksForD3fend = (d3fendId, includeCandidates = false) =>
    (edgesBySource.get(d3fendId) || [])
      .filter(
        (edge) =>
          nodeById.get(edge.target_node_id)?.metadata?.catalog_id ===
            "nist-800-53" &&
          (includeCandidates || edge.publication_status === "published"),
      )
      .map((edge) => ({
        nistNode: nodeById.get(edge.target_node_id),
        relationshipEdge: edge,
        sourceRefs: resolveSourceRefs(edge),
      }))
      .filter((entry) => entry.nistNode)
      .sort((left, right) => sortNodesByItemId(left.nistNode, right.nistNode));
  const countThreatChainRow = (node, includeCandidates = false) => {
    const d3fendEdges = (edgesBySource.get(node.id) || []).filter(
      (edge) =>
        nodeById.get(edge.target_node_id)?.metadata?.catalog_id ===
          "mitre-d3fend" &&
        (includeCandidates || edge.publication_status === "published"),
    );
    const nistIds = new Set();
    let mappedD3fend = 0;
    for (const edge of d3fendEdges) {
      const nistEdges = (edgesBySource.get(edge.target_node_id) || []).filter(
        (nistEdge) =>
          nodeById.get(nistEdge.target_node_id)?.metadata?.catalog_id ===
            "nist-800-53" &&
          (includeCandidates || nistEdge.publication_status === "published"),
      );
      if (nistEdges.length) mappedD3fend += 1;
      for (const nistEdge of nistEdges) {
        nistIds.add(nistEdge.target_node_id);
      }
    }
    return {
      d3fend_count: d3fendEdges.length,
      nist_control_count: nistIds.size,
      unmapped_d3fend_count: d3fendEdges.length - mappedD3fend,
    };
  };
  const threatChainRowCache = new Map();
  const buildThreatChainDetail = (node, includeCandidates = false) => {
    const d3fendEntries = d3fendLinksForAttack(node.id, includeCandidates);
    const nistEntries = uniqueBy(
      d3fendEntries.flatMap((entry) =>
        nistLinksForD3fend(entry.d3fendNode.id, includeCandidates),
      ),
      (entry) => entry.nistNode.id,
    );
    const mappedD3fendIds = new Set(
      nistEntries.map((entry) => entry.relationshipEdge.source_node_id),
    );
    return {
      source_node: node,
      d3fend_entries: d3fendEntries,
      d3fend_nodes: d3fendEntries.map((entry) => entry.d3fendNode),
      nist_entries: nistEntries,
      nist_nodes: nistEntries.map((entry) => entry.nistNode),
      unmapped_d3fend_nodes: d3fendEntries
        .filter((entry) => !mappedD3fendIds.has(entry.d3fendNode.id))
        .map((entry) => entry.d3fendNode),
    };
  };
  const resolveSourceForNode = (node) => {
    if (!node) return null;
    const source = sourceById.get(node.source_id);
    if (!source) return null;
    return {
      id: source.id,
      name: source.name,
      version: source.version || "",
      retrieved_at: source.retrieved_at || "",
    };
  };
  const formatBaselineHeaderLine = (label, baselineNode, sourceMeta) => {
    const version = sourceMeta?.version ? ` v${sourceMeta.version}` : "";
    const title = baselineNode
      ? `${itemIdFor(baselineNode)} — ${itemTitleFor(baselineNode)}`
      : "";
    return `${label}: ${title} (${sourceMeta?.name || "Unknown source"}${version})`;
  };
  const baselineControlEntries = (baselineId) =>
    uniqueBy(
      dataset.edges
        .filter(
          (edge) =>
            edge.publication_status === "published" &&
            edge.relationship_class === "applicability" &&
            edge.relationship_type === "selects" &&
            edge.source_node_id === baselineId &&
            nodeById.get(edge.target_node_id)?.metadata?.catalog_id ===
              "nist-800-53",
        )
        .map((edge) => ({
          control_node: nodeById.get(edge.target_node_id),
          relationship_edge: edge,
          source_refs: resolveSourceRefs(edge),
        }))
        .filter((entry) => entry.control_node)
        .sort((left, right) =>
          sortNodesByItemId(left.control_node, right.control_node),
        ),
      (entry) => entry.control_node.id,
    );

  const edgeMatchesNeighborhoodFilters = (edge, filters = {}) => {
    if (
      filters.relationship_type &&
      edge.relationship_type !== filters.relationship_type
    )
      return false;
    if (
      filters.provenance_class &&
      edge.provenance_class !== filters.provenance_class
    )
      return false;
    if (filters.confidence && edge.confidence !== filters.confidence)
      return false;
    if (!filters.include_candidates && edge.publication_status !== "published")
      return false;
    return true;
  };

  const buildNeighborhood = (centerNodeId, options = {}) => {
    const {
      hops = 1,
      relationship_type: relationshipType,
      provenance_class: provenanceClass,
      confidence,
      node_type: nodeType,
      include_candidates: includeCandidates = false,
      maxNodes = 200,
    } = options;

    const centerNode = nodeById.get(centerNodeId);
    if (!centerNode) {
      return {
        centerNode: null,
        nodes: [],
        edges: [],
        stats: { total: 0, filtered: 0, truncated: false, nodeCount: 0 },
      };
    }

    const filterOpts = {
      relationship_type: relationshipType,
      provenance_class: provenanceClass,
      confidence,
      include_candidates: includeCandidates,
    };

    const visitedNodeIds = new Set([centerNodeId]);
    let frontier = [centerNodeId];
    const collectedEdges = [];

    for (let hop = 0; hop < hops; hop += 1) {
      const nextFrontier = [];
      for (const nodeId of frontier) {
        for (const edge of dataset.edges) {
          if (edge.source_node_id !== nodeId && edge.target_node_id !== nodeId)
            continue;
          collectedEdges.push(edge);
          const neighborId =
            edge.source_node_id === nodeId
              ? edge.target_node_id
              : edge.source_node_id;
          if (!visitedNodeIds.has(neighborId)) {
            visitedNodeIds.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }
      frontier = nextFrontier;
    }

    const uniqueEdges = uniqueBy(collectedEdges, (edge) => edge.id);
    const filteredEdges = uniqueEdges.filter((edge) =>
      edgeMatchesNeighborhoodFilters(edge, filterOpts),
    );

    let nodeIds = new Set([centerNodeId]);
    for (const edge of filteredEdges) {
      nodeIds.add(edge.source_node_id);
      nodeIds.add(edge.target_node_id);
    }

    if (nodeType) {
      const typeFiltered = new Set([centerNodeId]);
      for (const id of nodeIds) {
        if (id === centerNodeId) continue;
        const entry = nodeById.get(id);
        if (entry?.node_type === nodeType) typeFiltered.add(id);
      }
      nodeIds = typeFiltered;
    }

    let truncated = false;
    if (nodeIds.size > maxNodes) {
      truncated = true;
      const scores = new Map();
      for (const id of nodeIds) {
        if (id === centerNodeId) continue;
        const score = filteredEdges.filter(
          (edge) => edge.source_node_id === id || edge.target_node_id === id,
        ).length;
        scores.set(id, score);
      }
      const keepIds = [...scores.entries()]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .slice(0, maxNodes - 1)
        .map(([id]) => id);
      nodeIds = new Set([centerNodeId, ...keepIds]);
    }

    const finalEdges = filteredEdges.filter(
      (edge) =>
        nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id),
    );
    const nodes = [...nodeIds].map((id) => nodeById.get(id)).filter(Boolean);

    return {
      centerNode,
      nodes,
      edges: finalEdges,
      stats: {
        total: uniqueEdges.length,
        filtered: finalEdges.length,
        truncated,
        nodeCount: nodes.length,
      },
    };
  };

  const STARTER_GROUPS = [
    {
      key: "controls",
      label: "Controls",
      nodeTypes: ["control", "control_enhancement"],
    },
    {
      key: "baselines",
      label: "Baselines",
      nodeTypes: ["baseline", "baseline_profile"],
    },
    { key: "disa-ccis", label: "DISA CCIs", prefix: "disa-cci" },
    {
      key: "stig-srg",
      label: "STIG/SRG",
      match: (id) => id.includes("stig") || id.includes("srg"),
    },
    { key: "templates", label: "Templates", nodeTypes: ["template"] },
    { key: "playbooks", label: "Playbooks", nodeTypes: ["pattern"] },
    { key: "sources", label: "Sources", nodeTypes: ["source"] },
  ];

  const buildStarterMap = () => {
    const hub = {
      id: "starter:hub",
      node_type: "starter_hub",
      label: "Cybersecurity topics",
      metadata: {
        item_id: "Cybersecurity topics",
        title: "Cybersecurity topics",
      },
    };

    const nodes = [hub];
    const edges = [];

    for (const group of STARTER_GROUPS) {
      let count = 0;
      if (group.nodeTypes) {
        count = dataset.nodes.filter((node) =>
          group.nodeTypes.includes(node.node_type),
        ).length;
      } else if (group.prefix) {
        count = dataset.nodes.filter((node) =>
          node.id.startsWith(group.prefix),
        ).length;
      } else if (group.match) {
        count = dataset.nodes.filter((node) => group.match(node.id)).length;
      }

      const groupNode = {
        id: `starter:${group.key}`,
        node_type: "starter_group",
        label: group.label,
        metadata: {
          item_id: `${group.label} (${count})`,
          title: group.label,
          count,
          starterKey: group.key,
        },
      };

      nodes.push(groupNode);
      edges.push({
        id: `starter-edge:${group.key}`,
        source_node_id: hub.id,
        target_node_id: groupNode.id,
        relationship_type: "related_to",
        provenance_class: "federal_published",
        publication_status: "published",
        confidence: "high",
        navigation_note: "Starter group in the Atlas Map.",
      });
    }

    return {
      centerNode: hub,
      centerNodeId: hub.id,
      nodes,
      edges,
      stats: {
        total: edges.length,
        filtered: edges.length,
        truncated: false,
        nodeCount: nodes.length,
      },
    };
  };

  function compareLibraryMatches(left, right) {
    const leftId = left.index === undefined
      ? String(left.document.id)
      : String(indexedLibraryValue(left.index, "id"));
    const rightId = right.index === undefined
      ? String(right.document.id)
      : String(indexedLibraryValue(right.index, "id"));
    return left.score - right.score || right.rankBoost - left.rankBoost || leftId.localeCompare(rightId);
  }

  function indexedLibraryMatches(query, filters = {}) {
    const needle = normalize(query);
    const aliases = resolveControlAliases(needle);
    const primaryAlias = aliases.length > 1 ? aliases[1] : aliases[0];
    const searchNeedle = normalizeLibrarySearchQuery(
      primaryAlias && primaryAlias !== needle ? primaryAlias : query,
    ).toLowerCase();
    const searchTerms = searchNeedle.split(/\s+/).filter(Boolean);
    const exactMatches = [];
    const matches = [];
    for (let index = 0; index < indexedLibraryDocumentCount; index += 1) {
      if (!indexedLibraryFacetMatches(index, filters)) continue;
      const normalizedItemId = normalize(indexedLibraryValue(index, "item_id"));
      const normalizedId = normalize(indexedLibraryValue(index, "id"));
      const officialPreview = normalize(indexedLibraryValue(index, "official_text_preview"));
      const isStigNeedle = aliases.some((a) => /^[a-z0-9]{2,8}-[a-z0-9]{2,8}-[a-z0-9]{4,10}$/i.test(a));
      if (
        needle && (
          aliases.includes(normalizedItemId) ||
          aliases.includes(normalizedId) ||
          (isStigNeedle && aliases.some((a) => officialPreview.startsWith(a + " -") || officialPreview.startsWith(a + ":")))
        )
      ) {
        exactMatches.push({ index, rankBoost: 0, score: 0 });
        continue;
      }
      if (!needle) {
        matches.push({ index, rankBoost: 0, score: 0 });
        continue;
      }
      if (!searchTerms.length) continue;
      const title = normalize(indexedLibraryValue(index, "title"));
      const searchableText = [
        normalizedItemId,
        title,
        normalize(indexedLibraryValue(index, "control_family")),
        normalize(indexedLibraryValue(index, "source_name")),
        normalize(indexedLibraryValue(index, "publisher_name")),
        normalize(indexedLibraryValue(index, "official_text_preview")),
      ].join(" ");
      if (!searchTerms.every((term) => searchableText.includes(term))) continue;
      matches.push({
        index,
        rankBoost: indexedLibraryRankBoost(index, searchNeedle),
        score: aliases.some((a) => normalizedItemId.startsWith(a))
          ? 1
          : title.includes(searchNeedle)
            ? 2
            : 3,
      });
    }
    return exactMatches.length ? exactMatches : matches.sort(compareLibraryMatches);
  }

  function documentLibraryMatches(query, filters = {}) {
    const needle = normalize(query);
    const aliases = resolveControlAliases(needle);
    const candidates = libraryDocuments.filter((document) => matchesLibraryFacet(document, filters));
    if (!needle) {
      return candidates.map((document) => ({ document, rankBoost: 0, score: 0 }));
    }
    const isStigNeedle = aliases.some((a) => /^[a-z0-9]{2,8}-[a-z0-9]{2,8}-[a-z0-9]{4,10}$/i.test(a));
    const exactMatches = candidates.filter((document) => {
      const itemId = document.search_item_id || normalize(document.item_id);
      const id = document.search_id || normalize(document.id);
      const officialPreview = normalize(document.official_text_preview);
      return (
        aliases.includes(itemId) ||
        aliases.includes(id) ||
        (isStigNeedle && aliases.some((a) => officialPreview.startsWith(a + " -") || officialPreview.startsWith(a + ":")))
      );
    });
    if (exactMatches.length) {
      return exactMatches.map((document) => ({ document, rankBoost: 0, score: 0 }));
    }
    const primaryAlias = aliases.length > 1 ? aliases[1] : aliases[0];
    const searchNeedle = normalizeLibrarySearchQuery(
      primaryAlias && primaryAlias !== needle ? primaryAlias : query,
    ).toLowerCase();
    const searchTerms = searchNeedle.split(/\s+/).filter(Boolean);
    if (!searchTerms.length) return [];
    const matches = [];
    for (const document of candidates) {
      const itemId = document.search_item_id || normalize(document.item_id);
      const title = document.search_title || normalize(document.title);
      const searchableText = document.search_text || [
        itemId,
        title,
        normalize(document.control_family),
        normalize(document.source_name),
        normalize(document.publisher_name),
        normalize(document.official_text_preview),
      ].join(" ");
      if (!searchTerms.every((term) => searchableText.includes(term))) continue;
      matches.push({
        document,
        rankBoost: librarySearchRankBoost(document, searchNeedle),
        score: aliases.some((a) => itemId.startsWith(a))
          ? 1
          : title.includes(searchNeedle)
            ? 2
            : 3,
      });
    }
    return matches.sort(compareLibraryMatches);
  }

  function libraryMatches(query, filters = {}) {
    return indexedLibraryDocumentCount
      ? indexedLibraryMatches(query, filters)
      : documentLibraryMatches(query, filters);
  }

  function matchTaxonomyTags(match) {
    return match.index === undefined
      ? match.document.taxonomy_tags
      : indexedLibraryValue(match.index, "taxonomy_tags");
  }

  return {
    dataset,
    searchNodes(query, filters = {}) {
      const needle = normalize(query);
      if (!needle) return [];
      const aliases = resolveControlAliases(needle);
      const nodeMatchesFilter = (node) =>
        (!filters.catalog_id ||
          node.metadata?.catalog_id === filters.catalog_id) &&
        (!filters.node_type || node.node_type === filters.node_type);

      const exactMatches = dataset.nodes.filter((node) => {
        if (!nodeMatchesFilter(node)) return false;
        const itemId = normalize(node.metadata?.item_id);
        const id = normalize(node.id);
        const stigId = normalize(node.metadata?.stig_id);
        return aliases.includes(itemId) || aliases.includes(id) || (stigId && aliases.includes(stigId));
      });
      if (exactMatches.length > 0) {
        return exactMatches;
      }

      return dataset.nodes
        .filter(nodeMatchesFilter)
        .map((node) => {
          const itemId = normalize(node.metadata?.item_id);
          const stigId = normalize(node.metadata?.stig_id);
          const label = normalize(node.label);
          const description = normalize(node.metadata?.description);
          const score =
            aliases.includes(itemId) || (stigId && aliases.includes(stigId))
              ? 0
              : aliases.some((a) => itemId.startsWith(a)) || (stigId && aliases.some((a) => stigId.startsWith(a)))
                ? 1
                : label.includes(needle)
                  ? 2
                  : description.includes(needle)
                    ? 3
                    : 99;
          return { node, score };
        })
        .filter((entry) => entry.score < 99)
        .sort((a, b) => a.score - b.score || a.node.id.localeCompare(b.node.id))
        .slice(0, 100)
        .map((entry) => entry.node);
    },
    searchLibrary(query, filters = {}) {
      return libraryMatches(query, filters)
        .slice(0, 100)
        .map((match) => match.index === undefined
          ? match.document
          : indexedLibraryDocument(match.index));
    },
    getLibraryTagContext(query, filters = {}) {
      const matches = libraryMatches(query, filters);
      const tags = {};
      for (const match of matches) {
        for (const tag of matchTaxonomyTags(match) || []) {
          const id = typeof tag === "string" ? tag : tag?.id;
          if (id) tags[id] = (tags[id] || 0) + 1;
        }
      }
      return { result_count: matches.length, tags };
    },
    /**
     * Per-object-type counts for the CURRENT query, so the Library can lead
     * with the kinds a search actually found. The browse artifact's counts are
     * corpus-wide: showing them beside a query's results claimed thousands of
     * requirements while the search had returned a few hundred rules.
     */
    getLibraryKindContext(query, filters = {}) {
      const matches = libraryMatches(query, filters);
      const objectTypes = {};
      for (const match of matches) {
        const rawType = match.index === undefined
          ? match.document.object_type
          : indexedLibraryValue(match.index, "object_type");
        if (rawType) objectTypes[rawType] = (objectTypes[rawType] || 0) + 1;
      }
      return { result_count: matches.length, object_types: objectTypes };
    },
    getNode(id) {
      return nodeById.get(id) || null;
    },
    getLibraryDocument(id) {
      return getLibraryDocumentById(id);
    },
    getNodes(filters = {}) {
      return dataset.nodes.filter(
        (node) =>
          (!filters.catalog_id ||
            node.metadata?.catalog_id === filters.catalog_id) &&
          (!filters.node_type || node.node_type === filters.node_type),
      );
    },
    getEdgesForNode(id, options = {}) {
      return dataset.edges.filter(
        (edge) =>
          (edge.source_node_id === id || edge.target_node_id === id) &&
          (!options.publication_status ||
            edge.publication_status === options.publication_status),
      );
    },
    buildNeighborhood(centerNodeId, options = {}) {
      return buildNeighborhood(centerNodeId, options);
    },
    buildStarterMap() {
      return buildStarterMap();
    },
    getEvidenceForEdge(edgeId) {
      const edge = edgeById.get(edgeId);
      return evidenceIdsFor(edge)
        .map((id) => {
          const entry = evidenceById.get(id);
          return entry
            ? { ...entry, source: sourceById.get(entry.source_id) || null }
            : null;
        })
        .filter(Boolean);
    },
    getSource(id) {
      return sourceById.get(id) || null;
    },
    getSources(filters = {}) {
      return dataset.sources.filter(
        (source) =>
          (!filters.provenance_class ||
            source.provenance_class === filters.provenance_class) &&
          (!filters.eligibility_status ||
            source.eligibility_status === filters.eligibility_status) &&
          (!filters.lifecycle_status ||
            source.lifecycle_status === filters.lifecycle_status) &&
          (!filters.access_status ||
            source.access_status === filters.access_status) &&
          (filters.graph_eligible === undefined ||
            source.graph_eligible === filters.graph_eligible),
      );
    },
    getGraphHealth() {
      return dataset.findings;
    },
    getCatalogs() {
      return catalogs;
    },
    getConnectedCatalogs(catalogId) {
      if (!catalogId) return [];
      return catalogs
        .map((catalog) => ({
          catalog,
          connection_count:
            publishedCatalogConnectionCounts.get(
              catalogConnectionKey(catalogId, catalog.id),
            ) || 0,
        }))
        .filter(({ catalog, connection_count }) =>
          catalog.id !== catalogId && connection_count > 0,
        )
        .sort(
          (left, right) =>
            right.connection_count - left.connection_count ||
            left.catalog.name.localeCompare(right.catalog.name),
        )
        .map(({ catalog, connection_count }) => ({
          id: catalog.id,
          name: catalog.name,
          connection_count,
        }));
    },
    getLibraryFacets() {
      if (dataset.librarySearch?.facets) {
        return dataset.librarySearch.facets;
      }
      return {
        objectTypes: [
          ...new Set(
            libraryDocuments.map((entry) => entry.object_type).filter(Boolean),
          ),
        ].sort(),
        sourceClasses: [
          ...new Set(
            libraryDocuments.map((entry) => entry.source_class).filter(Boolean),
          ),
        ].sort(),
        controlFamilies: [
          ...new Set(
            libraryDocuments
              .map((entry) => entry.control_family)
              .filter(Boolean),
          ),
        ].sort(),
        severities: [
          ...new Set(
            libraryDocuments.map((entry) => entry.severity).filter(Boolean),
          ),
        ].sort(),
      };
    },
    getLibraryBrowseCounts() {
      return dataset.librarySearch?.browse_counts || {
        object_types: {},
        tags: {},
      };
    },
    buildRelationshipRows(request = {}) {
      return visibleRelationshipRows(request);
    },
    aggregateRelationshipRows(rows) {
      return aggregateRelationshipRows(rows);
    },
    buildAggregatedRelationshipRows(request = {}) {
      const flat = visibleRelationshipRows(request);
      const aggregated = aggregateRelationshipRows(flat.rows);
      return {
        request,
        rows: aggregated,
        flat_rows: flat.rows,
        summary: {
          ...flat.summary,
          source_record_count: aggregated.length,
        },
      };
    },
    exportRelationshipRows(rows, format = "csv") {
      if (rows.length > 0 && rows[0]?.targets) {
        return this.exportAggregatedRelationshipRows(rows, format);
      }
      if (format === "json") return exportJson(rows);
      if (format === "markdown") {
        return exportMarkdownTable(
          [
            "From ID",
            "To ID",
            "From tags",
            "To tags",
            "Relationship type",
            "Source basis",
            "Confidence",
            "Rationale",
            "Navigation note",
            "Source references",
          ],
          rows.map((row) => [
            row.from_item_id,
            row.to_item_id,
            row.from_taxonomy_tags.map((tag) => tag.id).join("; "),
            row.to_taxonomy_tags.map((tag) => tag.id).join("; "),
            row.relationship_type,
            row.provenance_class,
            row.confidence,
            row.rationale,
            row.navigation_note,
            row.source_refs.map(sourceRefLabel).join("; "),
          ]),
        );
      }
      const csvRows = [
        [
          "From ID",
          "To ID",
          "From tags",
          "To tags",
          "Relationship type",
          "Source basis",
          "Confidence",
          "Rationale",
          "Navigation note",
          "Source references",
        ],
      ];
      for (const row of rows) {
        csvRows.push([
          row.from_item_id,
          row.to_item_id,
          row.from_taxonomy_tags.map((tag) => tag.id).join(" | "),
          row.to_taxonomy_tags.map((tag) => tag.id).join(" | "),
          row.relationship_type,
          row.provenance_class,
          row.confidence,
          row.rationale,
          row.navigation_note,
          row.source_refs.map(sourceRefLabel).join(" | "),
        ]);
      }
      return csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    },
    exportAggregatedRelationshipRows(aggregatedRows, format = "csv") {
      if (format === "json") return exportJson(aggregatedRows);
      if (format === "markdown") {
        return exportMarkdownTable(
          [
            "From ID",
            "From Title",
            "Mapped Target IDs",
            "Mapped Target Titles",
            "Connection Types",
            "Source Bases",
            "Confidence Levels",
            "Source References",
          ],
          aggregatedRows.map((row) => [
            row.from_item_id,
            row.from_title,
            row.targets.map((t) => t.to_item_id).join("; "),
            row.targets.map((t) => t.to_title).join("; "),
            [...new Set(row.targets.map((t) => t.relationship_type))].join("; "),
            [...new Set(row.targets.map((t) => t.provenance_class))].join("; "),
            [...new Set(row.targets.map((t) => t.confidence))].join("; "),
            [...new Set(row.targets.flatMap((t) => (t.source_refs || []).map(sourceRefLabel)))].join("; "),
          ]),
        );
      }
      const csvRows = [
        [
          "From ID",
          "From Title",
          "Mapped Target IDs",
          "Mapped Target Titles",
          "Connection Types",
          "Source Bases",
          "Confidence Levels",
          "Source References",
        ],
      ];
      for (const row of aggregatedRows) {
        csvRows.push([
          row.from_item_id,
          row.from_title,
          row.targets.map((t) => t.to_item_id).join(" | "),
          row.targets.map((t) => t.to_title).join(" | "),
          [...new Set(row.targets.map((t) => t.relationship_type))].join(" | "),
          [...new Set(row.targets.map((t) => t.provenance_class))].join(" | "),
          [...new Set(row.targets.map((t) => t.confidence))].join(" | "),
          [...new Set(row.targets.flatMap((t) => (t.source_refs || []).map(sourceRefLabel)))].join(" | "),
        ]);
      }
      return csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    },
    buildStigChain(request = {}) {
      const includeCandidates = request.include_candidates || false;
      const allNodes = stigCatalogNodes(
        request.chain_catalog,
        request.chain_benchmark,
      );
      const rows = allNodes.map((node) => {
        const detail = buildChainDetail(node, includeCandidates);
        return {
          node_id: node.id,
          item_id: itemIdFor(node),
          title: itemTitleFor(node),
          benchmark_id: node.metadata?.benchmark_id || node.source_id,
          benchmark_title:
            node.metadata?.benchmark_title ||
            sourceById.get(node.source_id)?.name ||
            "",
          cci_count: detail.cci_nodes.length,
          nist_control_count: detail.nist_nodes.length,
          unmapped_cci_count: detail.unmapped_cci_nodes.length,
        };
      });
      const selectedNode = request.chain_item
        ? nodeById.get(request.chain_item) ||
          allNodes.find(
            (node) =>
              itemIdFor(node) === request.chain_item ||
              node.id === request.chain_item,
          )
        : null;
      const selectedChainNode = selectedNode
        ? nodeById.get(selectedNode.id || selectedNode.node_id)
        : nodeById.get(request.chain_item || "");
      return {
        request,
        rows,
        total_benchmark_records: allNodes.length,
        selected_chain: selectedChainNode
          ? buildChainDetail(selectedChainNode, includeCandidates)
          : null,
      };
    },
    exportStigChain(payload, format = "csv") {
      const rows = payload.selected_chain
        ? payload.selected_chain.cci_entries.map((entry) => ({
            source_item_id: itemIdFor(payload.selected_chain.source_node),
            cci_item_id: itemIdFor(entry.cciNode),
            cci_title: itemTitleFor(entry.cciNode),
            nist_item_ids: payload.selected_chain.nist_entries
              .filter(
                (nistEntry) =>
                  nistEntry.relationshipEdge.source_node_id ===
                  entry.cciNode.id,
              )
              .map((nistEntry) => itemIdFor(nistEntry.nistNode))
              .join("|"),
            source_refs: entry.sourceRefs.map(sourceRefLabel).join("; "),
          }))
        : payload.rows.map((row) => ({
            source_item_id: row.item_id,
            cci_count: row.cci_count,
            nist_control_count: row.nist_control_count,
            unmapped_cci_count: row.unmapped_cci_count,
            benchmark_title: row.benchmark_title,
          }));
      if (format === "json") return exportJson(rows);
      if (format === "markdown") {
        const headers = payload.selected_chain
          ? [
              "Source item",
              "CCI item",
              "CCI title",
              "NIST control IDs",
              "Source references",
            ]
          : [
              "Source item",
              "CCI count",
              "NIST control count",
              "Unmapped CCI count",
              "Benchmark",
            ];
        const markdownRows = payload.selected_chain
          ? rows.map((row) => [
              row.source_item_id,
              row.cci_item_id,
              row.cci_title,
              row.nist_item_ids,
              row.source_refs,
            ])
          : rows.map((row) => [
              row.source_item_id,
              row.cci_count,
              row.nist_control_count,
              row.unmapped_cci_count,
              row.benchmark_title,
            ]);
        return exportMarkdownTable(headers, markdownRows);
      }
      const csvRows = payload.selected_chain
        ? [
            [
              "Source item",
              "CCI item",
              "CCI title",
              "NIST control IDs",
              "Source references",
            ],
            ...rows.map((row) => [
              row.source_item_id,
              row.cci_item_id,
              row.cci_title,
              row.nist_item_ids,
              row.source_refs,
            ]),
          ]
        : [
            [
              "Source item",
              "CCI count",
              "NIST control count",
              "Unmapped CCI count",
              "Benchmark",
            ],
            ...rows.map((row) => [
              row.source_item_id,
              row.cci_count,
              row.nist_control_count,
              row.unmapped_cci_count,
              row.benchmark_title,
            ]),
          ];
      return csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    },
    buildThreatChain(request = {}) {
      const includeCandidates = request.include_candidates || false;
      const cacheKey = `${request.chain_catalog || ""}:${includeCandidates}`;
      let rows = threatChainRowCache.get(cacheKey);
      if (!rows) {
        rows = attackCatalogNodes(request.chain_catalog).map((node) => ({
          node_id: node.id,
          item_id: itemIdFor(node),
          title: itemTitleFor(node),
          domain:
            node.metadata?.attack_domain || node.metadata?.catalog_id || "",
          ...countThreatChainRow(node, includeCandidates),
        }));
        threatChainRowCache.set(cacheKey, rows);
      }
      const selectedNode = request.chain_item
        ? nodeById.get(request.chain_item) ||
          rows.find((row) => row.item_id === request.chain_item)
        : null;
      const selectedChainNode = selectedNode
        ? nodeById.get(selectedNode.id || selectedNode.node_id)
        : nodeById.get(request.chain_item || "");
      return {
        request,
        rows,
        selected_chain: selectedChainNode
          ? buildThreatChainDetail(selectedChainNode, includeCandidates)
          : null,
      };
    },
    exportThreatChain(payload, format = "csv") {
      const rows = payload.selected_chain
        ? payload.selected_chain.d3fend_entries.flatMap((entry) => {
            const relatedNist = payload.selected_chain.nist_entries.filter(
              (nistEntry) =>
                nistEntry.relationshipEdge.source_node_id ===
                entry.d3fendNode.id,
            );
            if (relatedNist.length === 0) {
              return [
                {
                  source_item_id: itemIdFor(payload.selected_chain.source_node),
                  d3fend_item_id: itemIdFor(entry.d3fendNode),
                  d3fend_title: itemTitleFor(entry.d3fendNode),
                  nist_item_ids: "",
                  source_refs: entry.sourceRefs.map(sourceRefLabel).join("; "),
                },
              ];
            }
            return relatedNist.map((nistEntry) => ({
              source_item_id: itemIdFor(payload.selected_chain.source_node),
              d3fend_item_id: itemIdFor(entry.d3fendNode),
              d3fend_title: itemTitleFor(entry.d3fendNode),
              nist_item_ids: itemIdFor(nistEntry.nistNode),
              source_refs: [...entry.sourceRefs, ...nistEntry.sourceRefs]
                .map(sourceRefLabel)
                .join("; "),
            }));
          })
        : payload.rows.map((row) => ({
            source_item_id: row.item_id,
            d3fend_count: row.d3fend_count,
            nist_control_count: row.nist_control_count,
            unmapped_d3fend_count: row.unmapped_d3fend_count,
            domain: row.domain,
          }));
      if (format === "json") return exportJson(rows);
      if (format === "markdown") {
        const headers = payload.selected_chain
          ? [
              "ATT&CK technique",
              "D3FEND countermeasure",
              "Countermeasure title",
              "NIST control IDs",
              "Source references",
            ]
          : [
              "ATT&CK technique",
              "D3FEND count",
              "NIST control count",
              "Unmapped D3FEND count",
              "Domain",
            ];
        const markdownRows = payload.selected_chain
          ? rows.map((row) => [
              row.source_item_id,
              row.d3fend_item_id,
              row.d3fend_title,
              row.nist_item_ids,
              row.source_refs,
            ])
          : rows.map((row) => [
              row.source_item_id,
              row.d3fend_count,
              row.nist_control_count,
              row.unmapped_d3fend_count,
              row.domain,
            ]);
        return exportMarkdownTable(headers, markdownRows);
      }
      const csvRows = payload.selected_chain
        ? [
            [
              "ATT&CK technique",
              "D3FEND countermeasure",
              "Countermeasure title",
              "NIST control IDs",
              "Source references",
            ],
            ...rows.map((row) => [
              row.source_item_id,
              row.d3fend_item_id,
              row.d3fend_title,
              row.nist_item_ids,
              row.source_refs,
            ]),
          ]
        : [
            [
              "ATT&CK technique",
              "D3FEND count",
              "NIST control count",
              "Unmapped D3FEND count",
              "Domain",
            ],
            ...rows.map((row) => [
              row.source_item_id,
              row.d3fend_count,
              row.nist_control_count,
              row.unmapped_d3fend_count,
              row.domain,
            ]),
          ];
      return csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    },
    buildBaselineComparison(request = {}) {
      const baselineA = nodeById.get(request.baseline_a) || null;
      const baselineB = nodeById.get(request.baseline_b) || null;
      const controlsA = baselineA ? baselineControlEntries(baselineA.id) : [];
      const controlsB = baselineB ? baselineControlEntries(baselineB.id) : [];
      const idsA = new Set(controlsA.map((entry) => entry.control_node.id));
      const idsB = new Set(controlsB.map((entry) => entry.control_node.id));
      return {
        request,
        baseline_a: baselineA,
        baseline_b: baselineB,
        baseline_a_source: resolveSourceForNode(baselineA),
        baseline_b_source: resolveSourceForNode(baselineB),
        shared: controlsA.filter((entry) => idsB.has(entry.control_node.id)),
        only_a: controlsA.filter((entry) => !idsB.has(entry.control_node.id)),
        only_b: controlsB.filter((entry) => !idsA.has(entry.control_node.id)),
      };
    },
    exportBaselineComparison(comparison, format = "csv") {
      const rows = [
        ...comparison.shared.map((entry) => ({
          section: "Shared controls",
          control_id: itemIdFor(entry.control_node),
          control_title: itemTitleFor(entry.control_node),
          source_refs: entry.source_refs.map(sourceRefLabel).join("; "),
        })),
        ...comparison.only_a.map((entry) => ({
          section: "Only in A",
          control_id: itemIdFor(entry.control_node),
          control_title: itemTitleFor(entry.control_node),
          source_refs: entry.source_refs.map(sourceRefLabel).join("; "),
        })),
        ...comparison.only_b.map((entry) => ({
          section: "Only in B",
          control_id: itemIdFor(entry.control_node),
          control_title: itemTitleFor(entry.control_node),
          source_refs: entry.source_refs.map(sourceRefLabel).join("; "),
        })),
      ];
      const headerLines = [
        formatBaselineHeaderLine(
          "Baseline A",
          comparison.baseline_a,
          comparison.baseline_a_source,
        ),
        formatBaselineHeaderLine(
          "Baseline B",
          comparison.baseline_b,
          comparison.baseline_b_source,
        ),
      ];
      if (format === "json") {
        return exportJson({
          baseline_a: comparison.baseline_a?.id || "",
          baseline_b: comparison.baseline_b?.id || "",
          baseline_a_source: comparison.baseline_a_source,
          baseline_b_source: comparison.baseline_b_source,
          rows,
        });
      }
      if (format === "markdown") {
        return `${headerLines.map((line) => `${line}\n`).join("\n")}${exportMarkdownTable(
          ["Section", "Control ID", "Control title", "Source references"],
          rows.map((row) => [
            row.section,
            row.control_id,
            row.control_title,
            row.source_refs,
          ]),
        )}`;
      }
      const csvRows = [
        [headerLines[0]],
        [headerLines[1]],
        [],
        ["Section", "Control ID", "Control title", "Source references"],
      ];
      for (const row of rows) {
        csvRows.push([
          row.section,
          row.control_id,
          row.control_title,
          row.source_refs,
        ]);
      }
      return csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    },
    buildRelationshipMatrix(request) {
      const sourceNodes = dataset.nodes.filter(
        (node) =>
          node.metadata?.catalog_id === request.source_catalog &&
          (!request.node_ids?.length || request.node_ids.includes(node.id)),
      );
      const rows = sourceNodes.map((node) => {
        const edges = dataset.edges.filter((edge) => {
          const counterpartId =
            edge.source_node_id === node.id
              ? edge.target_node_id
              : edge.target_node_id === node.id
                ? edge.source_node_id
                : null;
          return (
            counterpartId &&
            nodeById.get(counterpartId)?.metadata?.catalog_id ===
              request.target_catalog
          );
        });
        return {
          source_node_id: node.id,
          classification: edges.some(
            (edge) => edge.publication_status === "published",
          )
            ? "published"
            : edges.some((edge) => edge.publication_status === "candidate")
              ? "candidate"
              : "unmapped",
          edges,
        };
      });
      return {
        request,
        rows,
        summary: {
          total: rows.length,
          published: rows.filter((row) => row.classification === "published")
            .length,
          candidate: rows.filter((row) => row.classification === "candidate")
            .length,
          unmapped: rows.filter((row) => row.classification === "unmapped")
            .length,
        },
      };
    },
    buildRelationshipCsv(matrix) {
      const rows = [
        ["Source ID", "Relationship status", "Target IDs", "Evidence IDs"],
      ];
      for (const row of matrix.rows) {
        rows.push([
          nodeById.get(row.source_node_id)?.metadata?.item_id ||
            row.source_node_id,
          row.classification,
          row.edges
            .map((edge) => {
              const counterpartId =
                edge.source_node_id === row.source_node_id
                  ? edge.target_node_id
                  : edge.source_node_id;
              return (
                nodeById.get(counterpartId)?.metadata?.item_id || counterpartId
              );
            })
            .join("|"),
          row.edges.flatMap((edge) => evidenceIdsFor(edge)).join("|"),
        ]);
      }
      return rows.map((row) => row.map(csvCell).join(",")).join("\n");
    },
    getFederalContext(nodeId) {
      const node = nodeById.get(nodeId);
      if (!node) {
        return {
          baselineMembership: [],
          categorizationContext: [],
          minimumSecurityRequirements: [],
          rmfLifecycle: [],
          assessmentContext: [],
          fedrampBaselineContext: [],
          programRequirementContext: [],
          cmmcProgramContext: [],
          cuiPolicyContext: [],
        };
      }

      const directEdges = dataset.edges.filter(
        (edge) =>
          edge.publication_status === "published" &&
          (edge.source_node_id === nodeId || edge.target_node_id === nodeId),
      );
      const counterpartFor = (edge, currentId) =>
        nodeById.get(
          edge.source_node_id === currentId
            ? edge.target_node_id
            : edge.source_node_id,
        ) || null;

      const baselineMembership = uniqueBy(
        directEdges
          .filter(
            (edge) =>
              edge.relationship_class === "applicability" &&
              edge.relationship_type === "selects",
          )
          .map((membershipEdge) => ({
            baselineNode: counterpartFor(membershipEdge, nodeId),
            membershipEdge,
          }))
          .filter(
            (entry) =>
              entry.baselineNode?.node_type === "baseline" &&
              entry.baselineNode?.metadata?.catalog_id === "nist-800-53b",
          ),
        (entry) => entry.baselineNode.id,
      );

      const fedrampBaselineContext = uniqueBy(
        directEdges
          .filter(
            (edge) =>
              edge.relationship_class === "applicability" &&
              edge.relationship_type === "selects",
          )
          .map((membershipEdge) => ({
            baselineNode: counterpartFor(membershipEdge, nodeId),
            membershipEdge,
          }))
          .filter(
            (entry) =>
              entry.baselineNode?.node_type === "baseline" &&
              entry.baselineNode?.metadata?.catalog_id === "fedramp-rev5",
          ),
        (entry) => entry.baselineNode.id,
      );

      const familyMembership = uniqueBy(
        directEdges
          .filter(
            (edge) =>
              edge.relationship_class === "structural" &&
              edge.relationship_type === "contains",
          )
          .map((familyEdge) => ({
            familyNode: counterpartFor(familyEdge, nodeId),
            familyEdge,
          }))
          .filter((entry) => entry.familyNode?.node_type === "family"),
        (entry) => entry.familyNode.id,
      );

      const categorizationContext = uniqueBy(
        baselineMembership.flatMap((entry) =>
          dataset.edges
            .filter(
              (edge) =>
                edge.publication_status === "published" &&
                (edge.source_node_id === entry.baselineNode.id ||
                  edge.target_node_id === entry.baselineNode.id),
            )
            .map((categoryEdge) => ({
              categoryNode: counterpartFor(categoryEdge, entry.baselineNode.id),
              baselineNode: entry.baselineNode,
              categoryEdge,
              membershipEdge: entry.membershipEdge,
            }))
            .filter(
              (item) => item.categoryNode?.node_type === "impact_category",
            ),
        ),
        (entry) => `${entry.categoryNode.id}:${entry.baselineNode.id}`,
      );

      const minimumSecurityRequirements = uniqueBy(
        familyMembership.flatMap((entry) =>
          dataset.edges
            .filter(
              (edge) =>
                edge.publication_status === "published" &&
                (edge.source_node_id === entry.familyNode.id ||
                  edge.target_node_id === entry.familyNode.id),
            )
            .map((requirementEdge) => ({
              requirementNode: counterpartFor(
                requirementEdge,
                entry.familyNode.id,
              ),
              familyNode: entry.familyNode,
              requirementEdge,
              familyEdge: entry.familyEdge,
            }))
            .filter(
              (item) =>
                item.requirementNode?.metadata?.catalog_id === "fips-200",
            ),
        ),
        (entry) => `${entry.requirementNode.id}:${entry.familyNode.id}`,
      );

      const rmfLifecycle = uniqueBy(
        [
          ...baselineMembership.flatMap((entry) =>
            dataset.edges
              .filter(
                (edge) =>
                  edge.publication_status === "published" &&
                  (edge.source_node_id === entry.baselineNode.id ||
                    edge.target_node_id === entry.baselineNode.id),
              )
              .map((contextEdge) => ({
                stepNode: counterpartFor(contextEdge, entry.baselineNode.id),
                viaNode: entry.baselineNode,
                contextEdge,
                supportingEdge: entry.membershipEdge,
              }))
              .filter((item) => item.stepNode?.node_type === "rmf_step"),
          ),
          ...familyMembership.flatMap((entry) =>
            dataset.edges
              .filter(
                (edge) =>
                  edge.publication_status === "published" &&
                  (edge.source_node_id === entry.familyNode.id ||
                    edge.target_node_id === entry.familyNode.id),
              )
              .map((contextEdge) => ({
                stepNode: counterpartFor(contextEdge, entry.familyNode.id),
                viaNode: entry.familyNode,
                contextEdge,
                supportingEdge: entry.familyEdge,
              }))
              .filter((item) => item.stepNode?.node_type === "rmf_step"),
          ),
        ],
        (entry) => `${entry.stepNode.id}:${entry.viaNode.id}`,
      );

      const assessmentContext = uniqueBy(
        directEdges
          .filter((edge) => edge.relationship_type === "assesses")
          .map((assessmentEdge) => ({
            assessmentNode: counterpartFor(assessmentEdge, nodeId),
            assessmentEdge,
          }))
          .filter(
            (entry) =>
              entry.assessmentNode?.node_type === "assessment_procedure",
          ),
        (entry) => entry.assessmentNode.id,
      );

      const programCatalogs = new Set([
        "nist-800-171-rev2",
        "nist-800-171",
        "nist-800-172",
      ]);
      const programRequirementContext = uniqueBy(
        programCatalogs.has(node.metadata?.catalog_id)
          ? directEdges
              .map((relationshipEdge) => ({
                relatedNode: counterpartFor(relationshipEdge, nodeId),
                relationshipEdge,
              }))
              .filter(
                (entry) => entry.relatedNode?.metadata?.catalog_id === "cmmc-2",
              )
          : [],
        (entry) => entry.relatedNode.id,
      );

      const cmmcProgramContext = uniqueBy(
        node.metadata?.catalog_id === "cmmc-2"
          ? directEdges
              .map((relationshipEdge) => ({
                relatedNode: counterpartFor(relationshipEdge, nodeId),
                relationshipEdge,
              }))
              .filter((entry) =>
                programCatalogs.has(entry.relatedNode?.metadata?.catalog_id),
              )
          : [],
        (entry) => entry.relatedNode.id,
      );

      const cuiPolicyContext = uniqueBy(
        node.metadata?.catalog_id === "cui-policy"
          ? directEdges
              .map((relationshipEdge) => ({
                relatedNode: counterpartFor(relationshipEdge, nodeId),
                relationshipEdge,
              }))
              .filter((entry) =>
                programCatalogs.has(entry.relatedNode?.metadata?.catalog_id),
              )
          : programCatalogs.has(node.metadata?.catalog_id)
            ? directEdges
                .map((relationshipEdge) => ({
                  relatedNode: counterpartFor(relationshipEdge, nodeId),
                  relationshipEdge,
                }))
                .filter(
                  (entry) =>
                    entry.relatedNode?.metadata?.catalog_id === "cui-policy",
                )
            : [],
        (entry) => entry.relatedNode.id,
      );

      return {
        baselineMembership,
        categorizationContext,
        minimumSecurityRequirements,
        rmfLifecycle,
        assessmentContext,
        fedrampBaselineContext,
        programRequirementContext,
        cmmcProgramContext,
        cuiPolicyContext,
      };
    },
  };
}

export function getFederalContext(runtime, nodeId) {
  return runtime.getFederalContext(nodeId);
}

export function aggregateRelationshipRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = row.from_id || row.from_item_id;
    if (!map.has(key)) {
      map.set(key, {
        from_id: row.from_id,
        from_item_id: row.from_item_id,
        from_title: row.from_title,
        from_catalog_id: row.from_catalog_id,
        from_taxonomy_tags: row.from_taxonomy_tags || [],
        targets: [],
      });
    }
    const group = map.get(key);
    group.targets.push({
      edge_id: row.edge_id,
      to_id: row.to_id,
      to_item_id: row.to_item_id,
      to_title: row.to_title,
      to_catalog_id: row.to_catalog_id,
      to_taxonomy_tags: row.to_taxonomy_tags || [],
      relationship_type: row.relationship_type,
      provenance_class: row.provenance_class,
      confidence: row.confidence,
      publication_status: row.publication_status,
      rationale: row.rationale || "",
      navigation_note: row.navigation_note || "",
      warning: row.warning || "",
      inference_rule_id: row.inference_rule_id || "",
      source_refs: row.source_refs || [],
    });
  }
  return [...map.values()];
}

