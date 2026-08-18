export const SITE_COPY = Object.freeze({
  product: Object.freeze({
    definition:
      "Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.",
    boundary:
      "Use Control Atlas for research, not compliance or authorization decisions.",
    footer: "Free and open source. Not a government system.",
    searchPlaceholder: "Search by topic, title, or identifier.",
  }),
  home: Object.freeze({
    headline: "Make federal cybersecurity compliance make sense.",
    definition:
      "Understand what applies, what it means, and what to do next.",
    // Depth-0 Signal cover (first paint, before the Home surface). Composed as
    // the Orbital "editorial split, one invitation" landing recipe: eyebrow,
    // display headline with a signal word, lead, one action, and an archival
    // metadata aside.
    cover: Object.freeze({
      eyebrow: "Control Atlas / Ctrl + Alt + Learn",
      headlineLead: "Make federal compliance",
      headlineSignal: "make sense.",
      lead:
        "A free, public research tool that connects the requirements, controls, and guidance published by NIST, DISA, FedRAMP, MITRE, and CISA. Not a government system and not a GRC platform — a place to find what applies to your system and what to do next.",
      action: "Enter the Atlas",
      // KPI values are computed at build time from generated data (see
      // vite.config.ts renderStaticHome) — never hardcode counts here.
      metaTitle: "At a glance",
      freshnessLabel: "Source data",
      railLeft: "Find what applies · understand it · act on it",
      prompt: "Press Enter or select Enter the Atlas to start",
    }),
    destinations: Object.freeze([
      Object.freeze({
        id: "start-here",
        label: "Start guided setup",
        description: "Answer two questions to find where to begin.",
        view: "start-here",
        href: "#/start",
      }),
      Object.freeze({
        id: "atlas",
        label: "Browse the Atlas",
        description: "Start with a topic.",
        view: "atlas-map",
        href: "#/atlas",
      }),
      Object.freeze({
        id: "library",
        label: "Search the Library",
        description: "Find a specific record.",
        view: "search",
        href: "#/library",
      }),
      Object.freeze({
        id: "resources",
        label: "Browse Resources",
        description: "Find tools, training, and guidance.",
        view: "commons",
        href: "#/resources",
      }),
    ]),
  }),
  routes: Object.freeze({
    atlas: Object.freeze({
      title: "Atlas",
      purpose: "Start with a topic and work toward the details.",
    }),
    library: Object.freeze({
      title: "Library",
      purpose: "Search by identifier, title, or topic.",
    }),
    resources: Object.freeze({
      title: "Resources",
      purpose:
        "Find tools, training, and guidance for federal cybersecurity work.",
    }),
    guides: Object.freeze({
      title: "Guides",
      purpose:
        "Follow step-by-step guidance for common federal cybersecurity work.",
    }),
    compare: Object.freeze({
      title: "Compare",
      purpose: "See how frameworks connect using published crosswalks.",
    }),
    documents: Object.freeze({
      title: "Documents",
      purpose: "Choose what you need to produce.",
    }),
    sources: Object.freeze({
      title: "Sources",
      purpose: "Check publication ownership, version, and update status.",
    }),
    about: Object.freeze({
      title: "About",
      purpose: "Learn what Control Atlas covers and where its limits are.",
    }),
    start: Object.freeze({
      title: "Start here",
      purpose: "Not sure where to begin? Start here.",
    }),
  }),
});

/**
 * Route copy for static first-paint shell (T5.10).
 * Eyebrows that merely repeat the route title are omitted.
 */
export const FIRST_PAINT_ROUTE_COPY = Object.freeze({
  atlas: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.atlas.purpose, title: SITE_COPY.routes.atlas.title }),
  library: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.library.purpose, title: SITE_COPY.routes.library.title }),
  record: Object.freeze({ eyebrow: "", summary: "Read the published text and record details.", title: "Record" }),
  compare: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.compare.purpose, title: SITE_COPY.routes.compare.title }),
  documents: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.documents.purpose, title: SITE_COPY.routes.documents.title }),
  sources: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.sources.purpose, title: SITE_COPY.routes.sources.title }),
  start: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.start.purpose, title: SITE_COPY.routes.start.title }),
  guides: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.guides.purpose, title: SITE_COPY.routes.guides.title }),
  about: Object.freeze({ eyebrow: "", summary: SITE_COPY.routes.about.purpose, title: SITE_COPY.routes.about.title }),
});

/**
 * Prohibited primary-surface phrases and anti-patterns (T5.2).
 * These patterns must not appear in user-facing UI copy or primary task views.
 */
export const PROHIBITED_PRIMARY_SURFACE_PATTERNS = Object.freeze([
  // Registry implementation narration
  /recorded by (?:the )?source registry/i,
  /inherited from (?:the )?parent publication/i,
  /source registry layer/i,
  /raw registry entries/i,
  /source-count ledger/i,

  // Schema and internal pipeline terminology rendered to users
  /canonical graph/i,
  /runtime projection/i,
  /canonical records/i,
  /immediate children/i,

  // Redundant reassurance, placeholder instructions, or advice fallbacks
  /tell control atlas/i,
  /already represented in (?:the )?Atlas/i,
  /being reviewed before public launch/i,
  /assign an implementation owner/i,
  /how to satisfy it/i,
  /what you need to do/i,
  /complete the comparison scope first/i,

  // Banned navigation/metaphor copy
  /see the landscape/i,
  /navigate the terrain/i,
  /drill (?:in|down|into)/i,
  /move the work forward/i,
  /published structure/i,
  /source-backed/i,

  // Compliance claim overreach
  /\b(?:proves?|ensures?|guarantees?|achieves?) compliance\b/i,

  // Encoding artifacts
  /[\u00c2\u00c3]|\u00e2\u20ac/,
]);

/**
 * Canonical product UI copy contract (T5.1).
 */
export const UI_COPY_CONTRACT = Object.freeze({
  actions: Object.freeze({
    enterAtlas: "Enter the Atlas",
    showMappings: "Show mappings",
    resetFilters: "Reset filters",
    choosePublication: "Choose publication",
    viewSource: "View official source",
    searchLibrary: "Search the Library",
    downloadTemplate: "Download starter document",
    backToGuides: "Back to Guides",
    backToStart: "Back to start",
    changeComparison: "Change comparison",
    seeConnections: "See connections",
  }),
  stateMessages: Object.freeze({
    initial: "Choose options to begin.",
    loading: "Loading data…",
    ready: "Results ready.",
    empty: "No matching records found.",
    blocked: "Complete required selections to proceed.",
    unavailable: "This comparison or record is not available in the current dataset.",
    error: "An error occurred while loading this view.",
  }),
  helperText: Object.freeze({
    compareMappingSource: "Optional. Leave blank to see every published mapping for this pair, or choose one cited source.",
    compareItems: "Optional. Leave blank to compare every published mapping, or specify a control (for example, AC-2).",
    compareFilterReset: "Reset filters to view all published mappings for this pair.",
  }),
  provenance: Object.freeze({
    official: "Official source",
    published: "Published mapping",
    supporting: "Supporting reference",
    notRecorded: "Not recorded",
    notChecked: "Not checked",
    notApplicable: "Not applicable",
  }),
});

/**
 * Formats a record count into a clean, human-readable string.
 * @param {number} count
 * @returns {string} e.g. "1 record", "324 records"
 */
export function formatRecordCount(count) {
  const n = typeof count === "number" ? count : 0;
  return `${n.toLocaleString()} ${n === 1 ? "record" : "records"}`;
}

/**
 * Formats connection count into human-readable product text.
 * @param {number} count
 * @param {number} [groupCount]
 * @returns {string}
 */
export function formatConnectionCount(count, groupCount) {
  const n = typeof count === "number" ? count : 0;
  const connText = `${n.toLocaleString()} ${n === 1 ? "published connection" : "published connections"}`;
  if (groupCount != null && groupCount > 0) {
    return `${connText} across ${groupCount.toLocaleString()} ${groupCount === 1 ? "group" : "groups"}`;
  }
  return connText;
}

/**
 * Resolves a source-faithful user-facing label for record types (T5.1).
 * @param {string} [nodeType]
 * @param {string} [nativeType]
 * @returns {string}
 */
export function formatRecordTypeLabel(nodeType = "", nativeType = "") {
  const key = (nativeType || nodeType || "").toLowerCase().trim();
  const MAP = {
    control: "Control",
    control_enhancement: "Control Enhancement",
    enhancement: "Control Enhancement",
    family: "Control Family",
    requirement: "Requirement",
    stig_rule: "STIG Rule",
    srg_requirement: "SRG Requirement",
    cci: "CCI",
    "disa-cci": "CCI",
    assessment_procedure: "Assessment Procedure",
    attack_technique: "ATT&CK Technique",
    technique: "ATT&CK Technique",
    tactic: "ATT&CK Tactic",
    defend_countermeasure: "D3FEND Countermeasure",
    countermeasure: "D3FEND Countermeasure",
    benchmark: "Benchmark",
    catalog: "Catalog",
    group: "Group",
    baseline: "Baseline",
    policy: "Policy",
    statute: "Statute",
    regulation: "Regulation",
    policy_directive: "Policy Directive",
    "csf-subcategory": "CSF Subcategory",
    "csf-category": "CSF Category",
    "ssdf-task": "SSDF Task",
    "fips-200-requirement": "FIPS 200 Requirement",
    "ai-rmf-outcome": "AI RMF Outcome",
    "rai-toolkit-principle": "Responsible AI Principle",
    "rai-shield-activity": "Responsible AI Activity",
    zt_activity: "Zero Trust Activity",
    zt_pillar: "Zero Trust Pillar",
    zt_tenet: "Zero Trust Tenet",
    zt_capability: "Zero Trust Capability",
    iot_capability_element: "IoT Capability Element",
  };
  return MAP[key] || key.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
