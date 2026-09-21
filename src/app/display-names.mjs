/** @type {Record<string, Record<string, string>>} */
const DISPLAY_NAMES = {
  provenance_class: {
    mandated: 'Mandated source',
    federal_published: 'Published federal source',
    federal_program: 'Federal program',
    federal_utilized: 'Third-party source used in federal work',
    federal_referenced: 'Federal reference',
    third_party_published: 'Publisher source',
    inferred: 'Inferred',
    official: 'Official',
    dod_published: 'DoD published',
    nist_published: 'NIST published',
    disa_published: 'DISA published',
    fedramp_published: 'FedRAMP published',
    mitre_published: 'MITRE published',
    community_open_source: 'Community open source',
  },
  eligibility_status: {
    eligible: 'Shown in the Atlas',
    excluded: 'Not shown in the Atlas',
    limited: 'Limited use',
    pending_review: 'Pending review',
  },
  lifecycle_status: {
    active: 'Active',
    deprecated: 'Deprecated',
    draft: 'Draft',
  },
  access_status: {
    public: 'Publicly available',
    restricted: 'Restricted access',
    private: 'Private access',
  },
  relationship_type: {
    maps_to: 'Maps to',
    supports: 'Supports',
    implements: 'Implements',
    overlaps: 'Overlaps with',
    references: 'References',
    derived_from: 'Derived from',
    supersedes: 'Supersedes',
    related_to: 'Related to',
    includes: 'Includes',
    contains: 'Contains',
    selects: 'Selects',
    assesses: 'Assesses',
    requires: 'Requires',
    depends_on: 'Depends on',
    protects: 'Protects',
    mitigates: 'Mitigates',
    uses: 'Uses',
    provides_context_for: 'Provides context for',
    leads_to: 'Leads to',
    applies_to: 'Applies to',
    defines: 'Defines',
    issued_under: 'Issued under',
  },
  confidence: {
    direct: 'Direct match',
    derived: 'Derived match',
    inferred: 'Inferred',
    inferred_high: 'Strong inference',
    inferred_medium: 'Moderate inference',
    inferred_low: 'Weak inference',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  evidence_quality: {
    primary: 'Primary source',
    secondary: 'Supporting source',
    tertiary: 'Indirect source',
  },
  publication_status: {
    published: 'Published mapping',
    candidate: 'Candidate mapping',
  },
  object_type: {
    control: 'Control',
    control_enhancement: 'Control enhancement',
    assessment_procedure: 'Assessment procedure',
    baseline: 'Baseline',
    catalog: 'Catalog',
    family: 'Control family',
    benchmark: 'STIG / SRG benchmark',
    function: 'CSF function',
    category: 'CSF category',
    tactic: 'Tactic',
    group: 'Group',
    cci: 'CCI',
    stig_rule: 'STIG rule',
    srg_requirement: 'SRG requirement',
    capability: 'Capability',
    pillar: 'Pillar',
    program_requirement: 'Program requirement',
    attack_technique: 'ATT&CK technique',
    defend_countermeasure: 'D3FEND countermeasure',
    statute: 'Statute',
    regulation: 'Regulation',
    policy_directive: 'Policy directive',
    zt_collaborator: 'Technology collaborator',
    zt_mapping_contributor: 'Mapping workbook contributor',
    zt_mapping_document: 'Mapping workbook',
    zt_product_component: 'Product component',
    zt_reference_component: 'Reference architecture component',
    iot_capability_domain: 'IoT capability domain',
    iot_capability: 'IoT capability',
    iot_subcapability: 'IoT subcapability',
    iot_capability_element: 'IoT capability element',
    iot_capability_subelement: 'IoT capability subelement',
    mobile_threat_category: 'Mobile threat category',
  },
  retrieval_method: {
    // Artifact-specific update-method vocabulary (Schema 5.0 artifacts).
    api_import: 'API import',
    direct_file_import: 'Direct file import',
    official_structured_export: 'Official structured export',
    repository_snapshot: 'Repository snapshot',
    extracted_from_official_publication: 'Extracted from official publication',
    supplemental_mapping: 'Supplemental mapping',
    reconciliation_source: 'Reconciliation source',
    reference_only: 'Reference only',
    // Legacy source-registry vocabulary mapped onto the same labels.
    api: 'API import',
    download: 'Direct file import',
    import: 'Direct file import',
    committed_artifact: 'Repository snapshot',
    // `manual_review` / `manual` intentionally fall through to humanization
    // ("Manual review") until §7 re-derives them from real extraction.
  },
  artifact_type: {
    json: 'JSON data file',
    xml: 'XML document',
    pdf: 'PDF document',
    csv: 'CSV spreadsheet',
    xlsx: 'Excel workbook',
    oscal: 'OSCAL document',
  },
  source_currentness_review: {
    current_as_checked: 'Current as checked',
    refresh_required: 'Refresh required',
    superseded: 'Superseded',
    blocked: 'Review blocked',
  },
  source_semantic_review: {
    reviewed_no_known_mismatch: 'Reviewed; no known mismatch',
    remediation_required: 'Remediation required',
    blocked: 'Review blocked',
  },
  template_type: {
    security_plan_starter: 'Security Plan Starter',
    implementation_statement_worksheet: 'Implementation Statement Worksheet',
    evidence_expectation_matrix: 'Evidence Expectation Matrix',
    inheritance_worksheet: 'Inheritance Worksheet',
    reciprocity_checklist: 'Reciprocity Package Review',
    poam_starter: 'POA&M Working Register',
    assessment_planning_worksheet: 'Assessment Planning Worksheet',
    conmon_calendar: 'Continuous Monitoring Delivery Calendar',
    hardware_baseline: 'Hardware Baseline',
    software_baseline: 'Software Baseline',
  },
  node_type: {
    control: 'Control',
    control_enhancement: 'Control enhancement',
    assessment_procedure: 'Assessment procedure',
    baseline: 'Baseline',
    catalog: 'Catalog',
    family: 'Control family',
    benchmark: 'STIG / SRG benchmark',
    function: 'CSF function',
    category: 'CSF category',
    tactic: 'Tactic',
    group: 'Group',
    attack_technique: 'ATT&CK technique',
    defend_countermeasure: 'D3FEND countermeasure',
    requirement: 'CCI / requirement',
    srg_requirement: 'SRG requirement',
    stig_rule: 'STIG rule',
    impact_category: 'Impact level',
    policy: 'Policy',
    program: 'Program',
    rmf_step: 'RMF step',
    zt_activity: 'Zero Trust activity',
    zt_capability: 'Zero Trust capability',
    zt_document: 'Zero Trust document',
    zt_overlay_catalog: 'Zero Trust overlay reference',
    zt_pillar: 'Zero Trust pillar',
    zt_tenet: 'Zero Trust tenet',
    statute: 'Statute',
    regulation: 'Regulation',
    policy_directive: 'Policy directive',
    zt_collaborator: 'Technology collaborator',
    zt_mapping_contributor: 'Mapping workbook contributor',
    zt_mapping_document: 'Mapping workbook',
    zt_product_component: 'Product component',
    zt_reference_component: 'Reference architecture component',
    iot_capability_domain: 'IoT capability domain',
    iot_capability: 'IoT capability',
    iot_subcapability: 'IoT subcapability',
    iot_capability_element: 'IoT capability element',
    iot_capability_subelement: 'IoT capability subelement',
    mobile_threat_category: 'Mobile threat category',
  },
};

/**
 * Casing for acronyms and proper nouns that must never be lower-cased when a
 * slug value falls through to humanization (CATL-32/66/71/83). Keys are the
 * lower-cased token; values are the display form.
 * @type {Record<string, string>}
 */
const ACRONYMS = {
  cci: 'CCI',
  ccis: 'CCIs',
  disa: 'DISA',
  dod: 'DoD',
  nist: 'NIST',
  srg: 'SRG',
  stig: 'STIG',
  rmf: 'RMF',
  fedramp: 'FedRAMP',
  cui: 'CUI',
  csf: 'CSF',
  cmmc: 'CMMC',
  zt: 'Zero Trust',
  mitre: 'MITRE',
  attack: 'ATT&CK',
  d3fend: 'D3FEND',
  ato: 'ATO',
  atc: 'ATC',
  conmon: 'ConMon',
  oscal: 'OSCAL',
  poam: 'POA&M',
  api: 'API',
  json: 'JSON',
  xml: 'XML',
  pdf: 'PDF',
  csv: 'CSV',
  fips: 'FIPS',
  olir: 'OLIR',
  ssp: 'SSP',
  poc: 'POC',
  saas: 'SaaS',
};

/**
 * Humanize a slug/enum value: split on `_`/`-`/space, expand acronyms, and
 * sentence-case the rest so no raw schema string reaches the UI. E.g.
 * `zt_capability` → "Zero Trust capability", `disa_stig` → "DISA STIG".
 * @param {string} value
 * @returns {string}
 */
export function humanizeSlug(value) {
  const tokens = String(value)
    .split(/[_\-\s]+/)
    .filter(Boolean);
  if (tokens.length === 0) return String(value);
  return tokens
    .map((token, index) => {
      const lower = token.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(' ');
}

/**
 * @param {string} domain
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function displayNameFor(domain, value) {
  if (!value) return 'Unknown';
  const mapped = DISPLAY_NAMES[domain]?.[value];
  if (mapped) return mapped;
  return humanizeSlug(value);
}

/** @type {Record<string, { title: string, why: string }>} */
export const CONTEXT_SECTION_COPY = {
  'Baseline membership': {
    title: 'Baseline membership',
    why: 'Shows which published baselines include this control.',
  },
  'FedRAMP baseline context': {
    title: 'FedRAMP baseline context',
    why: 'Shows FedRAMP baseline membership when this control applies to cloud authorization.',
  },
  'Categorization context': {
    title: 'Categorization context',
    why: 'Shows how security categorization connects this control to impact levels.',
  },
  'Minimum security requirements': {
    title: 'Minimum security requirements',
    why: 'Links this control to minimum security requirements for its family.',
  },
  'RMF lifecycle': {
    title: 'RMF lifecycle',
    why: 'Places this item in the Risk Management Framework steps.',
  },
  'Assessment procedures': {
    title: 'Assessment procedures',
    why: 'Lists official assessment procedures tied to this control.',
  },
  'Program requirement context': {
    title: 'Program requirement context',
    why: 'Connects this item to program-specific requirements.',
  },
  'CMMC program context': {
    title: 'CMMC program context',
    why: 'Shows CMMC program links when they apply.',
  },
  'CUI policy context': {
    title: 'CUI policy context',
    why: 'Shows Controlled Unclassified Information policy connections.',
  },
  'Additional published relationships': {
    title: 'Additional published relationships',
    why: 'Other official connections not shown in the sections above.',
  },
};

/**
 * @param {string} title
 * @returns {string}
 */
export function contextSectionHeading(title) {
  const copy = CONTEXT_SECTION_COPY[title];
  if (!copy) return title;
  return `${copy.title} — ${copy.why}`;
}

/**
 * @param {Error | string} error
 * @returns {string}
 */
export function userFacingLoadError(error) {
  const message = typeof error === 'string' ? error : error.message;
  if (/Unable to load/i.test(message) || /Invalid .* artifact/i.test(message) || /graph/i.test(message)) {
    return 'The library data could not load. Check your connection and try again.';
  }
  if (/too long|timed out/i.test(message)) {
    return 'The public data took too long to load. Retry to start a fresh request.';
  }
  return 'Something went wrong while loading Control Atlas. Try again in a moment.';
}
