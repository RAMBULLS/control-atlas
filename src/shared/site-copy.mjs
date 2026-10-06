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
    headline: "Make federal cybersecurity make sense.",
    definition:
      "Understand what applies, what it means, and what to do next.",
    // The Home lead (issue 283). U+2060 keeps the dash on the line with "guidance",
    // so a narrow screen never starts a line with it.
    lead:
      "Controls, STIGs, frameworks, and federal guidance⁠—connected so you can trace where requirements come from, see how they relate, and know what to do next.",
    searchPlaceholder: "Search by topic, title, or ID",
    // Depth-0 Signal cover (first paint, before the Home surface). Composed as
    // the Orbital "editorial split, one invitation" landing recipe: eyebrow,
    // display headline with a signal word, lead, one action, and an archival
    // metadata aside.
    cover: Object.freeze({
      eyebrow: "Control Atlas",
      headlineLead: "Make federal cybersecurity",
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
    // Home (issue 283, owner-approved layout and copy). Journeys come from
    // src/ui/lib/atlasJourneys.ts and source changes from the Pulse artifact,
    // both at build time; nothing here names a journey or a count.
    atlas: Object.freeze({
      eyebrow: "Atlas",
      heading: "See how federal cybersecurity fits together.",
      action: "Open the Atlas",
      // Accessible name of the journey list. The trigger shows the first
      // journeys, so there is no visible heading.
      topicsLabel: "Atlas topics",
      shownTopics: 3,
    }),
    tools: Object.freeze([
      Object.freeze({
        id: "compare",
        label: "Compare",
        description: "Follow published crosswalks between frameworks and controls.",
        action: "Compare frameworks",
        view: "matrix",
        href: "#/compare",
      }),
      Object.freeze({
        id: "templates",
        label: "Templates",
        description: "Working files for RMF, authorization, assessment, and DoD cyber work.",
        action: "Find a template",
        view: "templates",
        href: "#/build",
      }),
      Object.freeze({
        id: "resources",
        label: "Resources",
        description: "Tools, training, references, and guidance worth keeping close.",
        action: "Browse resources",
        view: "commons",
        href: "#/resources",
      }),
    ]),
    library: Object.freeze({
      eyebrow: "Library",
      heading: "Browse the Library",
      lead: "Find controls, baselines, assessment procedures, STIGs, threats, and more.",
      all: "All records",
    }),
    pulse: Object.freeze({
      heading: "Recent source changes",
      all: "All sources",
      compactLabel: "Source changes",
      quiet: "No recent source changes.",
    }),
  }),
  routes: Object.freeze({
    atlas: Object.freeze({
      title: "Atlas",
      purpose: "See how federal cybersecurity fits together: the publications, who issues them, and the work they support.",
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
        "Plan authorization, assessment, remediation, and monitoring with cited steps and clear handoffs.",
    }),
    compare: Object.freeze({
      title: "Compare",
      purpose: "See how frameworks connect using published crosswalks.",
    }),
    documents: Object.freeze({
      title: "Templates",
      purpose: "Working files for RMF and DoD cybersecurity tasks. Pick the job, set up the file, download it.",
    }),
    sources: Object.freeze({
      title: "Sources",
      purpose: "Check publication ownership, version, and update status.",
    }),
    about: Object.freeze({
      title: "About",
      purpose: "Find the federal sources behind your cybersecurity work and a clear path from research to action.",
    }),
    start: Object.freeze({
      title: "Start here",
      purpose: "Find the federal cybersecurity topic and publisher source that match your question.",
    }),
  }),
});

/**
 * Route copy for static first-paint shell (T5.10).
 * Eyebrows that merely repeat the route title are omitted.
 */
export const FIRST_PAINT_ROUTE_COPY = Object.freeze({
  atlas: Object.freeze({ eyebrow: "THE WHOLE LANDSCAPE", summary: SITE_COPY.routes.atlas.purpose, title: SITE_COPY.routes.atlas.title }),
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

  // Process and meta narration. Public copy describes the publisher's material
  // and the reader's next step; it never narrates our review, our releases or
  // the page itself. See "Public copy" in docs/PAGE_CONTRACTS.md. This list
  // grew out of the Home copy withdrawn in issue 283 and the publication and
  // Sources pass in issue 284: a fence around copy we have shipped once,
  // not a general prose grader.
  /\b(?:until|unless) it passes review\b/i,
  /\bpasses? (?:our|its|the) (?:own )?review\b/i,
  /\bnothing appears here until\b/i,
  /\bcontrol atlas has (?:accepted|approved|validated|verified|reviewed)\b/i,
  /\b(?:home|this page|the page) (?:now )?shows\b/i,
  /\bthis page now\b/i,
  /\bnew in control atlas\b/i,
  /\bwe (?:shipped|built|added|released|rebuilt)\b/i,
  /\bthis feature\b/i,
  /\bis being reviewed\b/i,
  /\bheld for review\b/i,

  // Interface narration. Copy names the subject, the practitioner's job and the
  // payoff; it does not describe the interface, how a page is arranged, or the
  // reader's "work" in the abstract. These match the phrasing, not the verb:
  // "Explore the Atlas" and "Browse controls and requirements" stay legal.
  // See "Public copy" in docs/PAGE_CONTRACTS.md.
  /\bwhat you(?:'|’)?re (?:working on|trying to get done)/i,
  /\bstart with what you\b/i,
  /\bways to work\b/i,
  /\bthis (?:page|section|panel|screen|view) (?:lets|helps|is where|lists|shows)\b/i,
  /\buse this (?:page|section|panel|screen|view|tool|map) to\b/i,
  /\b(?:grouped|organi[sz]ed|sorted) by the question/i,
  /\bcontrol atlas (?:accepted|reviewed|organi[sz]ed|grouped|approved|validated)\b/i,

  // Build and test machinery named on a public surface
  /\b(?:ci|continuous integration) (?:run|job|check|pipeline)\b/i,
  /\bbuild (?:artifact|pipeline|step)\b/i,
  /\btest suite\b/i,
  /\bworkflow run\b/i,
  /\bquarantine[ds]?\b/i,

  // Implementation vocabulary leaking out of technical-details views
  /\bdataset identity\b/i,
  /\bin this data ?set\b/i,
  /\bnormalized (?:from|records|into)\b/i,
  /\bvalidator\b/i,
  /\bdeterministic (?:atlas )?projections?\b/i,
  /\bcommitted .{0,24}capture\b/i,

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
    downloadTemplate: "Download template",
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
    control_context: "Control Context",
    definition: "Definition",
    family: "Control Family",
    requirement: "Requirement",
    rule: "Rule",
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
    key_security_indicator: "Key Security Indicator",
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
