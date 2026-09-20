/**
 * @typedef {{ kind: "list", values: string[], strict: boolean } | { kind: "date" }} ColumnValidation
 * @typedef {Object} ColumnDefinition
 * @property {string} header
 * @property {string} group
 * @property {boolean} required
 * @property {string} help
 * @property {number} width
 * @property {ColumnValidation | null} validation
 * @typedef {{ group?: string, required?: boolean, help?: string, width?: number, validation?: ColumnValidation | null }} ColumnSpecEntry
 */

/**
 * Column definitions for generated workbook tables.
 *
 * Every controlled value, date rule, required flag and group belongs to ONE
 * table of ONE artifact. Nothing is looked up by header name alone, so a
 * "Status" column on one workbook can never inherit another workbook's list.
 */

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const serial = (year, month, day) =>
  Math.round((Date.UTC(year, month - 1, day) - EXCEL_EPOCH_UTC) / 86400000);

/** Dates outside 2000-01-01..2099-12-31 are treated as typing mistakes. */
export const DATE_MIN_SERIAL = serial(2000, 1, 1);
export const DATE_MAX_SERIAL = serial(2099, 12, 31);

/**
 * Controlled vocabularies, keyed by artifact then by purpose. Each entry says
 * where its values come from. Values that are Control Atlas working states
 * (not a publisher vocabulary) are marked "working".
 */
export const TEMPLATE_VOCAB = Object.freeze({
  stig_evidence_checklist: Object.freeze({
    // DISA STIG Viewer 3.x User Guide V1R7 (13 Feb 2026), section 5.6.3.2, Table 5-1.
    status: Object.freeze(["Not Reviewed", "Open", "Not a Finding", "Not Applicable"]),
    severityOverride: Object.freeze(["Low", "Medium", "High"]),
    technologyArea: Object.freeze([
      "None", "Application Review", "Boundary Security", "CDS Admin Review",
      "CDS Technical Review", "Database Review", "Domain Name System (DNS)",
      "Exchange Server", "Host Based System Security (HBSS)", "Internal Network",
      "Mobility", "Releasable Networks (REL)", "Traditional Security", "Unix OS",
      "VVOIP Review", "Web Review", "Windows OS", "Other Review", "Workstation",
      "Member Server", "Domain Controller",
    ]),
  }),
  implementation_statement_worksheet: Object.freeze({
    // MITRE eMASS REST API v3.22 (5 Dec 2024), Controls endpoint fields.
    implementationStatus: Object.freeze(["Planned", "Implemented", "Inherited", "Not Applicable", "Manually Inherited"]),
    controlDesignation: Object.freeze(["Common", "System-Specific", "Hybrid"]),
  }),
  poam_starter: Object.freeze({
    // MITRE eMASS REST API v3.22, POA&M endpoint fields.
    status: Object.freeze(["Ongoing", "Risk Accepted", "Completed", "Not Applicable"]),
    riskLevel: Object.freeze(["Very Low", "Low", "Moderate", "High", "Very High"]),
  }),
  hardware_baseline: Object.freeze({
    // MITRE eMASS REST API v3.22, hardware baseline approvalStatus. eMASS
    // states custom values are allowed, so this list is a suggestion.
    approvalStatus: Object.freeze([
      "Approved - DISA UC APL", "Approved - FIPS 140-2", "Approved - NIAP CCVES",
      "Approved - NSA Crypto", "Approved - NSA CSfC", "In Progress", "Unapproved",
    ]),
    lifecycleStatus: Object.freeze(["Active", "Spare", "Maintenance", "Retiring", "Retired"]), // working
  }),
  evidence_expectation_matrix: Object.freeze({
    confidence: Object.freeze(["High", "Medium", "Low"]), // working
    reviewStatus: Object.freeze(["Needed", "Requested", "Received", "Reviewed", "Accepted", "Gap"]), // working
  }),
  inheritance_worksheet: Object.freeze({
    decision: Object.freeze(["Fully Inherited", "Hybrid", "System-Specific", "Not Applicable"]), // working
    freshness: Object.freeze(["Current", "Aging", "Expired", "Unknown"]), // working
  }),
  reciprocity_checklist: Object.freeze({
    status: Object.freeze(["Not Started", "In Review", "Sufficient", "Gap", "Not Applicable"]), // working
    disposition: Object.freeze(["Accept", "Accept with Conditions", "Supplement", "Reassess", "Reject"]), // working
  }),
  assessment_planning_worksheet: Object.freeze({
    method: Object.freeze(["Examine", "Interview", "Test", "Combination"]),
    status: Object.freeze(["Planned", "Ready", "In Progress", "Blocked", "Complete"]), // working
    result: Object.freeze(["Pass", "Fail", "Inconclusive", "Not Tested"]), // working
  }),
  conmon_calendar: Object.freeze({
    status: Object.freeze(["Planned", "In Progress", "Complete", "Late", "Blocked"]), // working
  }),
  ppsm_preparation_worksheet: Object.freeze({
    // Working states for this worksheet only. They are NOT PPSM Registry states.
    reviewStatus: Object.freeze(["Draft", "Owner Review", "Security Review", "Ready for Registry", "Entered in Registry", "Rework"]),
    exposure: Object.freeze(["None", "DoD external", "Internet", "Partner"]), // working
    requestedAction: Object.freeze(["Register", "Update", "Retire", "Validate"]), // working
  }),
});

export const TRUE_FALSE = Object.freeze(["true", "false"]);

/**
 * @param {readonly string[]} values
 * @param {{strict?: boolean, help?: string}} [opts]
 * @returns {ColumnSpecEntry}
 */
export function listOf(values, opts = {}) {
  const unique = new Set(values);
  if (!values.length || unique.size !== values.length || values.some((v) => !String(v).trim())) {
    throw new Error("A controlled-value list needs unique, non-empty values.");
  }
  return { validation: { kind: "list", values: [...values], strict: opts.strict !== false }, help: opts.help };
}

/**
 * A real calendar date field. Do not use for fields that allow periods or ranges.
 * @param {{help?: string}} [opts]
 * @returns {ColumnSpecEntry}
 */
export function dateField(opts = {}) {
  return { validation: { kind: "date" }, help: opts.help ?? "Enter a date, for example 2026-09-30." };
}

/**
 * @param {string[]} headers
 * @param {Record<string, ColumnSpecEntry>} [spec]
 * @returns {ColumnDefinition[]}
 */
export function defineColumns(headers, spec = {}) {
  for (const key of Object.keys(spec)) {
    if (!headers.includes(key)) {
      throw new Error(`Column spec names "${key}", which is not a header of this table.`);
    }
  }
  return headers.map((header) => {
    const entry = spec[header] || {};
    return {
      header,
      group: entry.group || "",
      required: entry.required === true,
      help: entry.help || "",
      width: entry.width || 0,
      validation: entry.validation || null,
    };
  });
}

/**
 * Build a table section that carries its own column definitions.
 * @param {string} heading
 * @param {string[]} headers
 * @param {any[][]} rows
 * @param {Record<string, ColumnSpecEntry>} [spec]
 * @returns {{ type: "table", heading: string, headers: string[], rows: any[][], columns: ColumnDefinition[] }}
 */
export function tableSection(heading, headers, rows, spec) {
  return { type: /** @type {"table"} */ ("table"), heading, headers, rows, columns: defineColumns(headers, spec) };
}
