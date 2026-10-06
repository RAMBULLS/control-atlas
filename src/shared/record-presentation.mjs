const section = (field, heading, kind = "text", disposition = "rendered_primary") =>
  Object.freeze({ field, heading, kind, disposition });

export const PAGE_ROLES = Object.freeze({
  ATOMIC_RECORD: "atomic_record",
  CONTAINER: "container",
  PUBLICATION_DOCUMENT: "publication_document",
  ENTITY_CONTRIBUTOR: "entity_contributor",
  ASSESSMENT_QUESTION: "assessment_question",
  IMPLEMENTATION_ARTIFACT: "implementation_artifact",
});

export const FIELD_DISPOSITIONS = Object.freeze({
  RENDERED_PRIMARY: "rendered_primary",
  RENDERED_SECONDARY: "rendered_secondary",
  SOURCE_METADATA: "source_metadata",
  RELATIONSHIP_EVIDENCE: "relationship_evidence",
  INTENTIONALLY_HIDDEN: "intentionally_hidden",
});

export const RELATIONSHIP_TREATMENTS = Object.freeze({
  PROMOTE: "PROMOTE",
  SUMMARIZE: "SUMMARIZE",
  COLLAPSE: "COLLAPSE",
  ATLAS_ONLY: "ATLAS_ONLY",
});

const commonFields = Object.freeze({
  catalog_id: {
    disposition: "intentionally_hidden",
    origin: "navigation",
    reason: "The governed publication display name is rendered instead of the raw catalog key.",
  },
  ingestion_source_id: { disposition: "source_metadata", origin: "source_metadata" },
  item_id: { disposition: "rendered_primary", origin: "navigation" },
  publisher_item_id: { disposition: "rendered_primary", origin: "publisher" },
  type: {
    disposition: "intentionally_hidden",
    origin: "derived",
    reason: "The semantic record type and page role replace the legacy adapter type token.",
  },
  object_layer: { disposition: "source_metadata", origin: "derived" },
  origin: { disposition: "source_metadata", origin: "derived" },
  native_type: { disposition: "source_metadata", origin: "publisher" },
  publication_id: { disposition: "relationship_evidence", origin: "navigation" },
  title: { disposition: "rendered_primary", origin: "publisher" },
  description: { disposition: "rendered_primary", origin: "publisher" },
  family: { disposition: "rendered_secondary", origin: "publisher" },
  source_locator: { disposition: "source_metadata", origin: "source_metadata" },
  publication_date: { disposition: "source_metadata", origin: "publisher" },
  references: { disposition: "rendered_secondary", origin: "publisher" },
  parent_id: { disposition: "rendered_secondary", origin: "publisher" },
  field_absence_reasons: { disposition: "source_metadata", origin: "derived" },
  benchmark_version: { disposition: "source_metadata", origin: "publisher" },
  benchmark_status_date: { disposition: "source_metadata", origin: "publisher" },
  description_provenance: { disposition: "source_metadata", origin: "source_metadata" },
  identity_category: { disposition: "source_metadata", origin: "publisher" },
  classification_provenance: { disposition: "source_metadata", origin: "source_metadata" },
  related_categories: { disposition: "relationship_evidence", origin: "publisher" },
  child_count: { disposition: "rendered_secondary", origin: "derived" },
  contributing_artifact_ids: { disposition: "source_metadata", origin: "source_metadata" },
  primary_artifact_id: { disposition: "source_metadata", origin: "source_metadata" },
  source_fragments: { disposition: "source_metadata", origin: "source_metadata" },
  source_refs: { disposition: "relationship_evidence", origin: "source_metadata" },
  authority_source_refs: { disposition: "relationship_evidence", origin: "source_metadata" },
  mandate: { disposition: "source_metadata", origin: "publisher" },
  mandate_note: { disposition: "source_metadata", origin: "publisher" },
  publication_type: { disposition: "source_metadata", origin: "publisher" },
  primary_authority: { disposition: "relationship_evidence", origin: "publisher" },
  also_required_by: { disposition: "relationship_evidence", origin: "publisher" },
  source_pages: { disposition: "source_metadata", origin: "source_metadata" },
  media: { disposition: "source_metadata", origin: "source_metadata" },
  related_build_codes: { disposition: "relationship_evidence", origin: "publisher" },
  superseded_by: { disposition: "relationship_evidence", origin: "publisher" },
  publisher_status: { disposition: "source_metadata", origin: "publisher" },
  publisher_mappings: { disposition: "relationship_evidence", origin: "publisher" },
  is_subtechnique: {
    disposition: "intentionally_hidden",
    origin: "derived",
    reason: "False adapter defaults are not presented; ATT&CK contracts override this with the publisher value.",
  },
  structural_group: {
    disposition: "intentionally_hidden",
    origin: "derived",
    reason: "The semantic container role and publisher hierarchy render this classification.",
  },
  atlas_structure_role: {
    disposition: "intentionally_hidden",
    origin: "derived",
    reason: "The trunk or limb page role and hierarchy render this organizing classification.",
  },
  taxonomy_tags: {
    disposition: "intentionally_hidden",
    origin: "navigation",
    reason: "Rendered through governed classification chips.",
  },
  source_text_presentation: {
    disposition: "intentionally_hidden",
    origin: "navigation",
    reason: "Exact source-text offsets are presentation metadata.",
  },
});

const contract = ({
  role,
  sections,
  required = [],
  optional = [],
  facts = [],
  fields = {},
  hierarchy = ["parent_id", "family"],
  selections = [],
}) => {
  const sectionFields = Object.fromEntries(
    sections.map((entry) => [
      entry.field,
      {
        disposition: entry.disposition,
        origin: entry.field === "publisher_field_availability" ? "derived" : "publisher",
      },
    ]),
  );
  return Object.freeze({
    page_role: role,
    identity_fields: Object.freeze(["item_id", "publisher_item_id", "title"]),
    hierarchy_fields: Object.freeze(hierarchy),
    sections: Object.freeze(sections),
    metadata_facts: Object.freeze(facts),
    selections: Object.freeze(selections.map((entry) => Object.freeze({ ...entry }))),
    required_fields: Object.freeze(required),
    optional_fields: Object.freeze(optional),
    field_dispositions: Object.freeze({ ...commonFields, ...sectionFields, ...fields }),
    relationship_policy: Object.freeze({
      structural_treatment: RELATIONSHIP_TREATMENTS.ATLAS_ONLY,
      same_catalog_treatment: RELATIONSHIP_TREATMENTS.ATLAS_ONLY,
      default_treatment: role === PAGE_ROLES.ATOMIC_RECORD
        ? RELATIONSHIP_TREATMENTS.COLLAPSE
        : RELATIONSHIP_TREATMENTS.SUMMARIZE,
    }),
    prohibited_synthetic_presentation: Object.freeze([
      "relationship-count-derived importance",
      "invented implementation guidance",
      "unverified official deep links",
    ]),
  });
};

const atomic = (sections, required = [], optional = [], extra = {}) =>
  contract({ role: PAGE_ROLES.ATOMIC_RECORD, sections, required, optional, ...extra });
const container = (sections, required = [], optional = [], extra = {}) =>
  contract({ role: PAGE_ROLES.CONTAINER, sections, required, optional, ...extra });
const publication = (sections, required = [], optional = [], extra = {}) =>
  contract({ role: PAGE_ROLES.PUBLICATION_DOCUMENT, sections, required, optional, ...extra });

const authorityPublication = (heading) =>
  contract({
    role: PAGE_ROLES.PUBLICATION_DOCUMENT,
    sections: [section("description", heading)],
    required: ["title", "description"],
    hierarchy: ["parent_id"],
  });

const BASE_CONTRACTS = {
  assessment_procedure: contract({
    role: PAGE_ROLES.ASSESSMENT_QUESTION,
    sections: [
      section("procedure_text", "Assessment Procedure"),
      section("assessment_objectives", "Objectives", "objectives"),
      section("assessment_method_details", "Methods", "methods"),
    ],
    required: ["procedure_text", "assessment_objectives", "assessment_method_details"],
    fields: {
      assessment_methods: {
        disposition: "intentionally_hidden",
        origin: "derived",
        reason: "The complete method objects are rendered.",
      },
      assessment_objects: {
        disposition: "intentionally_hidden",
        origin: "derived",
        reason: "Objects are rendered within method entries.",
      },
      nist_control: { disposition: "relationship_evidence", origin: "publisher" },
    },
  }),
  attack_technique: atomic([section("description", "Technique Description")], ["description"], [], {
    // MITRE publishes every tactic a technique belongs to, and 195 of 874
    // techniques carry more than one. Stating tactics[0] under a heading
    // reading "Published facts" under-scopes threat coverage, so the panel
    // renders the full membership list instead of the derived primary.
    facts: ["tactic_memberships", "is_subtechnique"],
    fields: {
      tactic_id: { disposition: "rendered_secondary", origin: "publisher" },
      tactic_title: { disposition: "rendered_secondary", origin: "publisher" },
      tactic_memberships: { disposition: "rendered_secondary", origin: "publisher" },
      is_subtechnique: { disposition: "source_metadata", origin: "publisher" },
      // Resolved publisher references, consumed inline by the description
      // renderer rather than shown as a fact of their own.
      citations: { disposition: "source_metadata", origin: "publisher" },
      parent_technique_id: { disposition: "rendered_secondary", origin: "publisher" },
    },
  }),
  baseline: container([section("description", "Baseline")], ["description"], [], {
    selections: [{
      relationship_type: "selects",
      heading: "Selected controls",
      note: "The controls this baseline selects, as the publisher published them.",
    }],
  }),
  benchmark: container([section("description", "Benchmark Summary")], [], ["description"], {
    facts: ["benchmark_version", "benchmark_status_date", "child_count", "severity_distribution"],
    fields: {
      benchmark_version: { disposition: "source_metadata", origin: "publisher" },
      benchmark_status_date: { disposition: "source_metadata", origin: "publisher" },
      child_count: { disposition: "rendered_secondary", origin: "derived" },
      severity_distribution: { disposition: "rendered_secondary", origin: "derived" },
    },
  }),
  catalog: publication([section("description", "Publication Summary")], [], ["description"]),
  category: container([section("description", "Category Summary")], [], ["description"]),
  control: atomic(
    [
      section("description", "Control Statement"),
      section("discussion", "Discussion", "text", "rendered_secondary"),
    ],
    ["description"],
    ["discussion"],
    {
      fields: {
        related_controls: { disposition: "relationship_evidence", origin: "publisher" },
        assessment_objectives: { disposition: "rendered_secondary", origin: "publisher" },
        assessment_method_details: { disposition: "rendered_secondary", origin: "publisher" },
        nist_800_53b_baselines: { disposition: "relationship_evidence", origin: "publisher" },
        baselines: { disposition: "relationship_evidence", origin: "publisher" },
      },
    },
  ),
  control_context: atomic([section("description", "Parameters and guidance", "control_parameters")], ["description"]),
  control_enhancement: atomic(
    [
      section("description", "Control Statement"),
      section("discussion", "Discussion", "text", "rendered_secondary"),
    ],
    ["description"],
    ["discussion"],
    {
      fields: {
        related_controls: { disposition: "relationship_evidence", origin: "publisher" },
        assessment_objectives: { disposition: "rendered_secondary", origin: "publisher" },
        assessment_method_details: { disposition: "rendered_secondary", origin: "publisher" },
        nist_800_53b_baselines: { disposition: "relationship_evidence", origin: "publisher" },
      },
    },
  ),
  definition: atomic([section("description", "Published Definition")], ["description"]),
  defend_countermeasure: atomic([section("description", "Countermeasure Description")], ["description"], [], {
    facts: ["tactic_title"],
    fields: {
      tactic_id: { disposition: "rendered_secondary", origin: "publisher" },
      tactic_title: { disposition: "rendered_secondary", origin: "publisher" },
    },
  }),
  family: container([section("description", "Family Summary")], [], ["description"]),
  function: container([section("description", "Function Summary")], [], ["description"]),
  group: container([section("description", "Group Summary")], [], ["description"]),
  impact_category: container([section("description", "Impact Category")], ["description"], [], {
    selections: [{
      relationship_type: "selects",
      heading: "Selected baseline",
      note: "The baseline this impact level selects, as the publisher published it.",
    }],
  }),
  iot_capability: container([section("description", "Capability")], [], ["description"]),
  iot_capability_domain: container([section("description", "Capability Domain")], [], ["description"]),
  iot_capability_element: atomic(
    [
      section("description", "Capability Element"),
      section("publisher_mappings", "Publisher Mappings", "publisher_mappings", "relationship_evidence"),
    ],
    [],
    ["description", "publisher_mappings"],
  ),
  iot_capability_subelement: atomic(
    [
      section("description", "Capability Sub-Element"),
      section("publisher_mappings", "Publisher Mappings", "publisher_mappings", "relationship_evidence"),
    ],
    [],
    ["description", "publisher_mappings"],
  ),
  iot_subcapability: container([section("description", "Sub-Capability")], [], ["description"]),
  key_security_indicator: atomic([section("description", "Indicator Statement")], ["description"]),
  limb: container(
    [section("description", "Control Atlas Area")],
    ["title", "description"],
    [],
    { hierarchy: ["parent_id"] },
  ),
  mobile_threat: atomic(
    [
      section("threat_origin", "Published Origin"),
      section("exploit_examples", "Exploit Examples", "list"),
      section("cve_examples", "CVE Examples", "list"),
      section("countermeasures", "Possible Countermeasures", "countermeasures"),
      section("publisher_field_availability", "Publisher Field Availability", "text", "rendered_secondary"),
    ],
    ["title"],
    ["threat_origin", "exploit_examples", "cve_examples", "countermeasures", "publisher_field_availability"],
  ),
  mobile_threat_category: container([section("description", "Threat Category")], ["description"]),
  policy: atomic([section("description", "Policy Statement")], ["description"]),
  policy_directive: authorityPublication("Authority Summary"),
  program: container([section("description", "Program Level")], ["description"], [], {
    selections: [{
      relationship_type: "requires",
      heading: "Requirements",
      note: "The requirements this level requires, as the publisher published them.",
    }],
  }),
  regulation: authorityPublication("Authority Summary"),
  requirement: atomic(
    [
      section("description", "Requirement"),
      section("discussion", "Discussion", "text", "rendered_secondary"),
      section("implementation_examples", "Implementation Examples", "list", "rendered_secondary"),
    ],
    ["description"],
    ["discussion", "implementation_examples"],
    { fields: { informative_references: { disposition: "rendered_secondary", origin: "publisher" } } },
  ),
  rmf_step: atomic([section("description", "RMF Step")], ["description"]),
  rule: atomic(
    [
      section("description", "Rule Statement"),
      section("discussion", "Following Information", "text", "rendered_secondary"),
    ],
    ["description"],
    ["discussion"],
  ),
  srg_requirement: null,
  statute: authorityPublication("Authority Summary"),
  stig_rule: null,
  tactic: container([section("description", "Tactic Summary")], [], ["description"]),
  trunk: container(
    [section("description", "Control Atlas Scope")],
    ["title", "description"],
    [],
    { hierarchy: [] },
  ),
  zt_activity: atomic(
    [section("description", "Activity")],
    ["description"],
    ["outcomes", "end_state", "predecessors", "successors", "pillar", "activity_type", "duration", "responsibility", "operational_technology"],
    {
      facts: ["pillar", "activity_type", "duration", "responsibility", "operational_technology"],
      fields: {
        pillar: { disposition: "rendered_secondary", origin: "publisher" },
        activity_type: { disposition: "rendered_secondary", origin: "publisher" },
        duration: { disposition: "rendered_secondary", origin: "publisher" },
        responsibility: { disposition: "rendered_secondary", origin: "publisher" },
        operational_technology: { disposition: "rendered_secondary", origin: "publisher" },
      },
    },
  ),
  zt_assessment_question: contract({
    role: PAGE_ROLES.ASSESSMENT_QUESTION,
    sections: [section("description", "Assessment Guidance"), section("answer_options", "Answer Options", "list")],
    required: ["description", "answer_options"],
    fields: {
      publisher_default_answer: { disposition: "source_metadata", origin: "publisher" },
      question_number: { disposition: "rendered_primary", origin: "publisher" },
      pillar: { disposition: "rendered_secondary", origin: "publisher" },
      category: { disposition: "rendered_secondary", origin: "publisher" },
      link_label: { disposition: "source_metadata", origin: "publisher" },
    },
    facts: ["pillar", "category"],
  }),
  zt_build: contract({
    role: PAGE_ROLES.IMPLEMENTATION_ARTIFACT,
    sections: [
      section("description", "Implementation Summary"),
      section("architecture_sections", "Architecture", "structured"),
      section("implementation_sections", "Implementation Guide", "structured"),
    ],
    required: ["description", "architecture_sections", "implementation_sections"],
    fields: { implementation_guide_url: { disposition: "source_metadata", origin: "publisher" } },
  }),
  zt_capability: container([section("description", "Capability")], ["description"]),
  zt_cloud_native_requirement: atomic([section("description", "Cloud-Native Zero Trust Requirement")], ["description"]),
  zt_collaborator: contract({
    role: PAGE_ROLES.ENTITY_CONTRIBUTOR,
    sections: [section("publisher_context", "Participation Context")],
    required: ["title", "publisher_context"],
  }),
  zt_document: publication(
    [section("description", "Document Summary"), section("document_sections", "Publisher Overview", "structured")],
    ["description", "document_sections"],
  ),
  zt_logical_component: contract({
    role: PAGE_ROLES.IMPLEMENTATION_ARTIFACT,
    sections: [section("description", "Logical Component")],
    required: ["description"],
    optional: ["component_class"],
    facts: ["component_class"],
    fields: { component_class: { disposition: "rendered_secondary", origin: "publisher" } },
  }),
  zt_mapping_contributor: contract({
    role: PAGE_ROLES.ENTITY_CONTRIBUTOR,
    sections: [section("publisher_field", "Mapping Workbook Field")],
    required: ["title", "publisher_field"],
  }),
  zt_mapping_document: publication([section("description", "Mapping Workbook")], ["description"]),
  zt_pillar: container([section("description", "Pillar Summary")], [], ["description"]),
  zt_product_component: contract({
    role: PAGE_ROLES.IMPLEMENTATION_ARTIFACT,
    sections: [
      section("description", "Implemented Function"),
      section("mapping_targets", "Publisher Mapping Targets", "mapping_targets", "relationship_evidence"),
    ],
    required: ["description"],
    optional: ["mapping_targets", "collaborator", "product", "architecture_component", "mapping_count"],
    facts: ["collaborator", "product", "architecture_component", "mapping_count"],
    fields: {
      collaborator: { disposition: "rendered_secondary", origin: "publisher" },
      product: { disposition: "rendered_secondary", origin: "publisher" },
      architecture_component: { disposition: "rendered_secondary", origin: "publisher" },
      mapping_count: { disposition: "rendered_secondary", origin: "derived" },
    },
  }),
  zt_publication: publication([section("description", "Publication Summary")], ["description"], ["structured_content"], {
    fields: { structured_content: { disposition: "source_metadata", origin: "publisher" } },
  }),
  zt_reference_component: contract({
    role: PAGE_ROLES.IMPLEMENTATION_ARTIFACT,
    sections: [
      section("description", "Reference Architecture Function"),
      section("mapping_targets", "Publisher Mapping Targets", "mapping_targets", "relationship_evidence"),
    ],
    required: ["description"],
    optional: ["mapping_targets", "architecture_component", "mapping_count"],
    facts: ["architecture_component", "mapping_count"],
    fields: {
      architecture_component: { disposition: "rendered_secondary", origin: "publisher" },
      mapping_count: { disposition: "rendered_secondary", origin: "derived" },
    },
  }),
  zt_tenet: atomic([section("description", "Tenet")], ["description"]),
};

const disaContract = atomic(
  [section("description", "Discussion"), section("check_text", "Check"), section("fix_text", "Fix")],
  ["description", "check_text", "fix_text"],
  [],
  {
    facts: ["vuln_id", "rule_id", "stig_id", "benchmark_title", "benchmark_version", "benchmark_status_date", "severity"],
    fields: Object.fromEntries(
      [
        "vuln_id",
        "rule_id",
        "stig_id",
        "benchmark_id",
        "benchmark_title",
        "benchmark_version",
        "benchmark_status_date",
        "severity",
      ]
        .map((field) => [
          field,
          {
            disposition: field.includes("version") || field.includes("date") ? "source_metadata" : "rendered_primary",
            origin: "publisher",
          },
        ])
        .concat([["published_cci_references", { disposition: "relationship_evidence", origin: "publisher" }]]),
    ),
  },
);
BASE_CONTRACTS.srg_requirement = disaContract;
BASE_CONTRACTS.stig_rule = disaContract;
Object.freeze(BASE_CONTRACTS);

export const CATALOG_RECORD_TYPES = Object.freeze({
  "atlas-authority-spine": ["policy_directive", "regulation", "statute"],
  "atlas-organizing-spine": ["limb", "trunk"],
  "cmmc-2": ["catalog", "program"],
  "csf-2": ["catalog", "category", "function", "requirement"],
  "cui-policy": ["catalog", "policy"],
  "disa-cci": ["catalog", "requirement"],
  "disa-srg": ["benchmark", "catalog", "srg_requirement"],
  "disa-stig": ["benchmark", "catalog", "stig_rule"],
  "dod-rai": ["catalog", "group", "requirement"],
  "dod-zt": ["catalog", "zt_activity", "zt_capability", "zt_document", "zt_pillar", "zt_tenet"],
  "fedramp-2026": ["catalog", "control_context", "definition", "key_security_indicator", "rule"],
  "fedramp-rev5": ["baseline", "catalog"],
  "fips-199": ["catalog", "impact_category"],
  "fips-200": ["catalog", "requirement"],
  "microsoft-zt-maturity": ["catalog", "zt_assessment_question", "zt_pillar"],
  "mitre-attack": ["attack_technique", "catalog", "tactic"],
  "mitre-attack-ics": ["attack_technique", "catalog", "tactic"],
  "mitre-d3fend": ["catalog", "defend_countermeasure", "tactic"],
  "nist-800-171": ["catalog", "family", "requirement"],
  "nist-800-171-rev2": ["catalog", "family", "requirement"],
  "nist-800-172": ["catalog", "family", "requirement"],
  "nist-800-37": ["catalog", "rmf_step"],
  "nist-800-53": ["catalog", "control", "control_enhancement", "family"],
  "nist-800-53a": ["assessment_procedure", "catalog", "family"],
  "nist-800-53b": ["baseline", "catalog"],
  "nist-ai-rmf": ["catalog", "group", "requirement"],
  "nist-iot-cybersecurity": ["catalog", "iot_capability", "iot_capability_domain", "iot_capability_element", "iot_capability_subelement", "iot_subcapability"],
  "nist-mobile-threats": ["catalog", "mobile_threat", "mobile_threat_category"],
  "nist-ssdf": ["catalog", "group", "requirement"],
  "nist-zt": ["catalog", "zt_build", "zt_cloud_native_requirement", "zt_collaborator", "zt_logical_component", "zt_mapping_contributor", "zt_mapping_document", "zt_product_component", "zt_publication", "zt_reference_component", "zt_tenet"],
});

// Record types that never appear as ordinary Library search documents: they are
// structure, navigation or source objects. Shared by the data build and the
// record acceptance matrix so "is it searchable" has one answer.
export const NON_RECORD_NODE_TYPES = Object.freeze(new Set([
  "benchmark",
  "catalog",
  "category",
  "family",
  "function",
  "group",
  "limb",
  "policy_directive",
  "regulation",
  "statute",
  "tactic",
  "trunk",
]));

const PRESENTATION_SCOPE_BY_TYPE = Object.freeze({
  limb: "atlas-organizing-spine",
  policy_directive: "atlas-authority-spine",
  regulation: "atlas-authority-spine",
  statute: "atlas-authority-spine",
  trunk: "atlas-organizing-spine",
});

export const SUPPORTED_RECORD_TYPES = Object.freeze(Object.keys(BASE_CONTRACTS));
export const SUPPORTED_RECORD_CONTRACT_KEYS = Object.freeze(
  Object.entries(CATALOG_RECORD_TYPES).flatMap(([catalogId, types]) =>
    types.map((recordType) => `${catalogId}:${recordType}`),
  ),
);
const supportedKeys = new Set(SUPPORTED_RECORD_CONTRACT_KEYS);

const CATALOG_OVERRIDES = Object.freeze({
  "csf-2:requirement": [
    section("description", "Outcome"),
    section("implementation_examples", "Implementation Examples", "list", "rendered_secondary"),
    section("informative_references", "Informative References", "list", "rendered_secondary"),
  ],
  "disa-cci:requirement": [
    section("description", "Requirement"),
    section("references", "Publisher References", "references", "rendered_secondary"),
  ],
  "dod-rai:requirement": [section("description", "Guidance")],
  "dod-zt:zt_activity": [
    section("description", "Activity"),
    section("outcomes", "Published Outcomes"),
    section("end_state", "Published End State"),
    section("predecessors", "Predecessor Activities", "list", "rendered_secondary"),
    section("successors", "Successor Activities", "list", "rendered_secondary"),
  ],
  "nist-ai-rmf:requirement": [section("description", "Action")],
  "nist-ssdf:requirement": [section("description", "Practice")],
});

const REQUIRED_FIELD_OVERRIDES = Object.freeze({
  "nist-800-171:requirement": [],
  "nist-800-172:requirement": [],
});

export function recordPresentationContract(catalogId, nodeType) {
  const resolvedCatalogId = PRESENTATION_SCOPE_BY_TYPE[nodeType] || catalogId;
  const key = `${resolvedCatalogId || ""}:${nodeType}`;
  if (!supportedKeys.has(key)) throw new Error(`Missing record presentation contract for ${key}`);
  const base = BASE_CONTRACTS[nodeType];
  const sections = Object.freeze(CATALOG_OVERRIDES[key] || base.sections);
  const requiredFields = Object.freeze(REQUIRED_FIELD_OVERRIDES[key] || base.required_fields);
  const optionalFields = Object.freeze(
    REQUIRED_FIELD_OVERRIDES[key]
      ? [...new Set([...base.optional_fields, ...base.required_fields])]
      : base.optional_fields,
  );
  const fieldDispositions = Object.freeze({
    ...base.field_dispositions,
    ...Object.fromEntries(
      sections.map((entry) => [
        entry.field,
        {
          disposition: entry.disposition,
          origin: "publisher",
        },
      ]),
    ),
  });
  return Object.freeze({
    ...base,
    catalog_id: resolvedCatalogId,
    record_type: nodeType,
    sections,
    required_fields: requiredFields,
    optional_fields: optionalFields,
    field_dispositions: fieldDispositions,
  });
}

export function missingRequiredRecordFields(contractValue, metadata = {}) {
  return contractValue.required_fields.filter((field) => {
    const value = metadata[field];
    return Array.isArray(value) ? value.length === 0 : !String(value || "").trim();
  });
}

function hasCapturedValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function undeclaredCapturedRecordFields(contractValue, metadata = {}) {
  return Object.entries(metadata)
    .filter(([field, value]) => hasCapturedValue(value) && !contractValue.field_dispositions[field])
    .map(([field]) => field)
    .sort();
}

export function relationshipTreatmentFor({
  recordContract,
  counterpartContract,
  recordCatalogId,
  counterpartCatalogId,
  relationshipType,
  relationshipClass,
}) {
  if (relationshipClass === "structural" || recordCatalogId === counterpartCatalogId) {
    return relationshipClass === "structural"
      ? recordContract.relationship_policy.structural_treatment
      : recordContract.relationship_policy.same_catalog_treatment;
  }
  if (recordCatalogId === "csf-2" && ["disa-stig", "disa-srg"].includes(counterpartCatalogId)) {
    return RELATIONSHIP_TREATMENTS.ATLAS_ONLY;
  }
  if (relationshipType === "assesses" || counterpartContract.page_role === PAGE_ROLES.ASSESSMENT_QUESTION) {
    return RELATIONSHIP_TREATMENTS.PROMOTE;
  }
  if (["disa-stig", "disa-srg"].includes(recordCatalogId) && counterpartCatalogId === "disa-cci") {
    return RELATIONSHIP_TREATMENTS.PROMOTE;
  }
  return recordContract.relationship_policy.default_treatment;
}
