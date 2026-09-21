/**
 * @typedef {import("./template-columns.mjs").ColumnDefinition} ColumnDefinition
 *
 * @typedef {Object} TextSection
 * @property {"text"} type
 * @property {string} heading
 * @property {string} content
 * @property {"program" | "interop" | "source"} [role] Source and program notes the workbook Read Me shows by role.
 *
 * @typedef {Object} TableSection
 * @property {"table"} type
 * @property {string} heading
 * @property {string[]} headers
 * @property {any[][]} rows
 * @property {ColumnDefinition[]} [columns] Per-column validation, group and required flags.
 *
 * @typedef {TextSection | TableSection} DocSection
 *
 * @typedef {Object} TemplateDocument
 * @property {string} title
 * @property {string} description
 * @property {DocSection[]} sections
 */

import {
  PRODUCT_DISCLAIMER as DISCLAIMER,
  STARTER_DOCUMENT_REVIEW_NOTICE,
} from '../shared/disclaimer.mjs';
import { CROSS_REF_CAP } from '../shared/dense-data.mjs';
import { stringify as stringifyYaml } from 'yaml';
import { dateField, listOf, tableSection, TEMPLATE_VOCAB, TRUE_FALSE, valuesFrom } from './template-columns.mjs';

/** Most IDs listed in one reference-sheet cell. Larger sets are counted, not listed. */
const REFERENCE_SHEET_CAP = 25;

const EVIDENCE_TYPE_HINT = "Policy | Procedure | Config screenshot | System report | Access review | Scan output | Interview | Architecture diagram | Change record | Training record | Incident record | Log sample | Inventory export | Exception memo";

/** @type {Record<string, { display_name: string, version: string }>} */
const SOURCE_FALLBACK = {
  "fedramp-2026-rules": { display_name: "FedRAMP Consolidated Rules for 2026", version: "2026.07.14.01" },
  "nist-oscal": { display_name: "NIST OSCAL Content", version: "2026-06-09" },
  "nist-800-53": { display_name: "SP 800-53 Rev. 5", version: "Revision 5" },
  "nist-800-171": { display_name: "SP 800-171 Rev. 3", version: "Revision 3" },
  "nist-csf-2": { display_name: "Cybersecurity Framework 2.0", version: "2.0" },
  "nist-ssdf": { display_name: "SP 800-218 SSDF", version: "1.1" },
  "disa-stig-library": { display_name: "DISA STIG Library", version: "2026-06-09" },
  "disa-cci-list": { display_name: "DISA CCI List", version: "2026-06-09" },
  "nist-800-37-rev2": { display_name: "NIST SP 800-37 Rev. 2", version: "2026-06-09" },
  "nist-sp-800-137": { display_name: "NIST SP 800-137", version: "2026-06-09" },
  "mitre-emass-api-v3-22": { display_name: "MITRE eMASS Client OpenAPI", version: "3.22" },
  "disa-stig-viewer-v1r7": { display_name: "DISA STIG Viewer 3.x User Guide", version: "V1R7" },
  "dcsa-hardware-list": { display_name: "DCSA Hardware List", version: "February 2020" },
  "dcsa-software-list": { display_name: "DCSA Software List", version: "February 2020" },
  "dod-ppsm-policy": { display_name: "DoDI 8551.01 PPSM", version: "public policy" },
  "disa-ppsm-training": { display_name: "DISA PPSM Registry Training", version: "public training" },
};

/**
 * How each artifact relates to the system it prepares information for.
 * Levels, and only these, are shown publicly:
 *   Verified interchange - actually tested with the destination.
 *   Field-aligned        - uses documented fields and values; import not verified.
 *   Concept-aligned      - same working concepts; not an interchange schema.
 * `fedramp` is added only when a FedRAMP program is the selected context.
 */
export const INTEROPERABILITY = {
  security_plan_starter: {
    level: "Concept-aligned",
    summary: "Follows NIST RMF and OSCAL SSP concepts. It is not an SSP schema.",
    basis: "NIST SP 800-37 Rev. 2 and the NIST OSCAL SSP model.",
    limit: "Working draft, not an official SSP, and not directly importable into another system.",
    fedramp: {
      basis: "The FedRAMP Certification Package Overview and Security Decision Record transition path.",
      limit: "Not a FedRAMP package.",
    },
  },
  implementation_statement_worksheet: {
    level: "Field-aligned",
    summary: "Uses MITRE eMASS API v3.22 control field names and values. Import into eMASS is not verified.",
    basis: "Public MITRE eMASS REST API v3.22 (5 Dec 2024) Controls fields.",
    limit: "Not an eMASS-generated import template and not directly importable; your eMASS instance may differ.",
  },
  evidence_expectation_matrix: {
    level: "Concept-aligned",
    summary: "Follows NIST SP 800-53A assessment concepts and DISA cross-references. It is not an interchange schema.",
    basis: "NIST SP 800-53A Rev. 5 and ingested DISA CCI and STIG/SRG cross-references.",
    limit: "Evidence expectations need assessor and organization validation.",
  },
  stig_evidence_checklist: {
    level: "Field-aligned",
    summary: "Uses the 12 CSV headers and values in the DISA STIG Viewer 3.x User Guide V1R7. Import into STIG Viewer is not verified.",
    basis: "DISA STIG Viewer 3.x User Guide V1R7 (13 Feb 2026), section 5.6.3. Rule and benchmark identifiers are as DISA published them.",
    limit: "The import updates a checklist that already exists in STIG Viewer. Open the CSV in your STIG Viewer version to check it. Control Atlas has not tested an import.",
  },
  inheritance_worksheet: {
    level: "Concept-aligned",
    summary: "Follows NIST RMF and OSCAL inheritance concepts. It is not an interchange schema.",
    basis: "NIST SP 800-37 Rev. 2 and OSCAL implemented-requirement inheritance concepts.",
    limit: "Does not replace a provider CRM/CIS or approve an inheritance decision.",
  },
  reciprocity_checklist: {
    level: "Concept-aligned",
    summary: "Follows NIST RMF authorization-package reuse concepts. It is not an interchange schema.",
    basis: "NIST SP 800-37 Rev. 2.",
    limit: "Does not grant reciprocity. The receiving Authorizing Official owns the reuse decision.",
    fedramp: {
      basis: "The current FedRAMP Certification Package Overview and Security Decision Record.",
      limit: "",
    },
  },
  poam_starter: {
    level: "Field-aligned",
    summary: "Uses MITRE eMASS API v3.22 POA&M field names and values. Import into eMASS is not verified.",
    basis: "Public MITRE eMASS REST API v3.22 (5 Dec 2024) POA&M fields, plus local tracking fields.",
    limit: "Not an eMASS-generated import template and not directly importable.",
    fedramp: {
      basis: "FedRAMP vulnerability-reporting boundaries.",
      limit: "Not a FedRAMP import template. Decide whether each action belongs to the provider or the agency before using it as a FedRAMP POA&M record.",
    },
  },
  assessment_planning_worksheet: {
    level: "Concept-aligned",
    summary: "Follows NIST SP 800-53A assessment planning and eMASS test-result concepts. It is not an interchange schema.",
    basis: "NIST SP 800-53A Rev. 5 methods and objectives, and the MITRE eMASS v3.22 test-results concept.",
    limit: "Neither a complete Security Assessment Plan nor an eMASS test-result import file.",
    fedramp: {
      basis: "Current FedRAMP rules do not require a separate SAP or SAR.",
      limit: "",
    },
  },
  conmon_calendar: {
    level: "Concept-aligned",
    summary: "Follows NIST continuous-monitoring concepts. It is not an interchange schema.",
    basis: "NIST SP 800-137 and NIST SP 800-37 Rev. 2.",
    limit: "Seeded cadences are planning defaults unless the row names a source. Confirm them against your program's rules and contracts.",
    fedramp: {
      basis: "FedRAMP Ongoing Certification Report and vulnerability-reporting rules.",
      limit: "Rule-specific effective dates, certification profile, and authorization conditions take precedence.",
    },
  },
  hardware_baseline: {
    level: "Field-aligned",
    summary: "Uses MITRE eMASS API v3.22 hardware-baseline field names and values. Import into eMASS is not verified.",
    basis: "Public MITRE eMASS REST API v3.22 (5 Dec 2024) hardware baseline fields, DCSA hardware-list guidance, plus local inventory fields.",
    limit: "Not an eMASS-generated import template and not directly importable.",
  },
  software_baseline: {
    level: "Field-aligned",
    summary: "Uses MITRE eMASS API v3.22 software-baseline field names. Import into eMASS is not verified.",
    basis: "Public MITRE eMASS REST API v3.22 (5 Dec 2024) software baseline fields, DCSA software-list guidance, plus local inventory fields.",
    limit: "Not an eMASS-generated import template and not directly importable.",
  },
  ppsm_preparation_worksheet: {
    level: "Concept-aligned",
    summary: "Collects information for the PPSM process. It is not the registry's form and not an interchange schema.",
    basis: "DoDI 8551.01 and the DISN Connection Process Guide section 2.7.3. The PPSM Registry's own entry fields are not public.",
    limit: "Collect and review here, then enter the data in the authorized PPSM workflow. Not a PPSM submission form, registry receipt, or import file.",
  },
};

const FEDRAMP_2026_CONTEXT = {
  security_plan_starter: [
    "Current rule connection: CPO-CSO-OVR says the Certification Package Overview replaces the historical Rev5 SSP, excluding appendices.",
    "Current package shape: FRC-CSO-PKG points to the Certification Package Overview, Security Decision Record (SDR-CSO-FRR), and an Ongoing Certification Report.",
    "Use this companion to organize working material, then move the final content into the applicable current rule and schema structure.",
  ],
  implementation_statement_worksheet: [
    "Current rule connection: SDR-CSO-FRR requires implementation, verification, validation, independent assessment, responses, and rule-specific artifacts for each applicable FedRAMP rule.",
    "Use stable rule IDs and the current Security Decision Record schema when this worksheet supports a FedRAMP package.",
  ],
  evidence_expectation_matrix: [
    "Current rule connection: SDR-CSO-FRR organizes evidence by applicable FedRAMP rule, while IVV rules govern independent verification and validation results.",
    "Treat evidence examples here as collection prompts; the applicable rule, class, assessor, and authorizing organization decide sufficiency.",
  ],
  inheritance_worksheet: [
    "Current transition: the legacy CRM/CIS workbook has no single current replacement template in the 2026 rules.",
    "Use current provider service scope, secure-configuration guidance, and responsibility material for the exact service, tier, region, and date; record shared and local actions separately.",
  ],
  reciprocity_checklist: [
    "Current rule connection: evaluate the current Certification Package Overview, Security Decision Record, assessment results, Ongoing Certification Report, and authorization conditions instead of assuming a legacy checklist defines completeness.",
    "The receiving organization still owns the reuse and risk decision.",
  ],
  poam_starter: [
    "Current FedRAMP boundary: provider-maintained vulnerability information is not automatically an agency POA&M.",
    "Providers report and maintain vulnerability data under VER rules and schemas. Agencies create POA&Ms only for agency-owned actions, agency-managed weaknesses, compensating controls, or agency risk decisions (VER-AGM-MAP).",
    "Before adding a row, identify the action owner and keep provider vulnerability reporting separate from the agency's plan of action.",
  ],
  assessment_planning_worksheet: [
    "Current transition: IVV-IAS-SUM states that FedRAMP does not require a separate SAP or SAR for either 20x or Rev5 certifications.",
    "Assessors supply assessment summaries; providers include results without inappropriate modification in the current package and Security Decision Record.",
  ],
  conmon_calendar: [
    "Current rule connection: CCM-OCR-AVL requires a quarterly Ongoing Certification Report, while VER rules and schemas govern vulnerability reporting.",
    "Use the rule-specific effective dates for the selected 20x or Rev5 profile. The legacy ConMon calendar is migration reference only.",
  ],
  hardware_baseline: [
    "Current rule connection: MAS-CSO-IIR requires machine-readable information-resource data, a human-readable explanation of how it was derived, and the code used to generate it.",
    "This workbook helps organize your inventory. It doesn't replace the system-generated scope evidence the rule requires.",
  ],
  software_baseline: [
    "Current rule connection: MAS-CSO-IIR requires machine-readable information-resource data, a human-readable explanation of how it was derived, and the code used to generate it.",
    "This workbook helps organize your inventory. It doesn't replace the system-generated scope evidence the rule requires.",
  ],
};

export const ENVIRONMENT_ARCHETYPES = [
  "Generic",
  "Cloud SaaS",
  "Platform service",
  "Enclave",
  "On-premises",
  "Hybrid",
  "Enterprise service",
];

/**
 * @param {any} options
 * @returns {(txt: string) => string}
 */
function placeholder(options) {
  return (txt) => (options.includePlaceholders !== false ? txt : "");
}

function cappedJoin(ids, limit) {
  if (ids.length <= limit) return ids.join("; ");
  return ids.slice(0, limit).join("; ") + ` + ${ids.length - limit} more`;
}

/**
 * Truncate a plain-language summary at a word boundary so it fits a table
 * cell without mid-word cuts.
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
function truncatePlain(text, max = 170) {
  const str = String(text || "").trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const clipped = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, "");
  return `${clipped}…`;
}

/**
 * @param {(string | { id: string })[]} sourceRefs
 * @param {any[]} sources
 * @returns {string[]}
 */
function resolveSourceLines(sourceRefs, sources) {
  const sourceMap = new Map((sources || []).map((s) => [s.id, s]));
  const lines = [];
  for (const ref of sourceRefs || []) {
    const id = typeof ref === "string" ? ref : ref.id;
    const src = sourceMap.get(id) || SOURCE_FALLBACK[id];
    if (src) {
      const name = src.display_name || src.name || id;
      const version = src.version || "unknown";
      const identityKind = src.metadata?.identity_kind;
      const role =
        identityKind === "ingestion"
          ? "ingestion provenance"
          : identityKind === "publication"
            ? "publication"
            : "source";
      lines.push(`${name} (${role}; version ${version})`);
    } else if (id) {
      lines.push(id);
    }
  }
  return lines;
}

/**
 * Resolves a catalog/program id to its published name.
 * @param {string} framework
 * @param {any[]} sources
 * @returns {string}
 */
function resolveFrameworkName(framework, sources) {
  const match = (sources || []).find((source) => source.id === framework);
  const fallback = SOURCE_FALLBACK[framework];
  return match?.display_name || match?.name || fallback?.display_name || framework;
}

/**
 * @param {any} options
 * @returns {string}
 */
export function buildSourceMetadata(options) {
  const lines = [];
  if (options.framework) {
    // A generated document is a user-facing artifact, so it names the
    // publication the way the publisher does. The raw catalog id is only a
    // last resort, and it is at least accurate rather than invented.
    lines.push(
      `Catalog or program context: ${resolveFrameworkName(options.framework, options.sources)}`,
    );
  }
  lines.push(`Environment archetype: ${options.environment || "Not selected"}`);
  const refLines = resolveSourceLines(options.sourceRefs, options.sources);
  if (refLines.length) {
    lines.push("Reference sources:");
    for (const line of refLines) {
      lines.push(`- ${line}`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {TemplateDocument} doc
 * @param {any} options
 * @returns {TemplateDocument}
 */
function appendSourceMetadata(doc, options) {
  // A program's own rules appear only when that program is the selected
  // context. NIST 800-53 work does not get a FedRAMP section.
  const fedrampSelected = /^fedramp/i.test(String(options.framework || ""));
  const interop = INTEROPERABILITY[options.templateType];
  if (fedrampSelected) {
    const fedrampContext = FEDRAMP_2026_CONTEXT[options.templateType];
    if (fedrampContext) {
      doc.sections.push({
        type: "text",
        role: "program",
        heading: "Current FedRAMP 2026 Context",
        content: fedrampContext.join("\n"),
      });
    }
  }
  if (interop) {
    const fedramp = fedrampSelected ? interop.fedramp : null;
    const basis = [interop.basis, fedramp?.basis].filter(Boolean).join(" ");
    const limit = [interop.limit, fedramp?.limit].filter(Boolean).join(" ");
    doc.sections.push({
      type: "text",
      role: "interop",
      heading: "Compatibility and Use",
      content: [
        `Interoperability: ${interop.level}. ${interop.summary}`,
        `Basis: ${basis}`,
        `Limit: ${limit}`,
      ].join("\n"),
    });
  }
  doc.sections.push({
    type: "text",
    role: "source",
    heading: "Source Metadata",
    content: buildSourceMetadata(options),
  });
  return doc;
}

function blankRows(count, width, ph, values = []) {
  return Array.from({ length: count }, () =>
    Array.from({ length: width }, (_, index) => ph(values[index] || "")),
  );
}

const DASH = "—";

const BASELINE_LABELS = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  PRIVACY: "Privacy",
  "LI-SAAS": "Low-Impact SaaS",
};

function baselineLabel(baseline) {
  const key = String(baseline || "").toUpperCase();
  return BASELINE_LABELS[key] || String(baseline || "");
}

/**
 * One plain sentence saying which controls a worksheet covers. It names the
 * control baseline that was selected. It never states a system's impact level:
 * choosing a control baseline does not categorize a system.
 */
function scopeSentence(options, controls) {
  const name = resolveFrameworkName(options.framework, options.sources);
  const real = controls.filter((control) => control.nodeId);
  if (real.length === 0) return `Control scope: ${name}. No published controls were found.`;
  const enhancements = real.filter((control) => control.isEnhancement).length;
  const count = `${real.length} control${real.length === 1 ? "" : "s"}`;
  if (options.baseline) {
    return `Control scope: ${name}, selected control baseline ${baselineLabel(options.baseline)}. ${count}${enhancements ? `, including ${enhancements} enhancement${enhancements === 1 ? "" : "s"}` : ""}. The baseline is a control selection, not a statement of your system's impact level.`;
  }
  return `Control scope: ${name}, no baseline selected. ${count} (base controls only; enhancements are not included).`;
}

const titleCase = (value) => String(value || "").toLowerCase().replace(/^./, (ch) => ch.toUpperCase());

/** 800-53A context for one control from the accepted assessment-procedure record. */
function assessmentContext(index, controlNodeId) {
  const node = index?.assessmentByControl?.get(controlNodeId);
  if (!node) return null;
  const meta = node.metadata || {};
  const methods = (meta.assessment_methods || []).map(titleCase);
  const objectsByMethod = new Map();
  for (const detail of meta.assessment_method_details || []) {
    const method = titleCase(detail.method);
    const objects = (detail.objects || []).map((object) => String(object).trim()).filter(Boolean);
    if (objects.length) objectsByMethod.set(method, objects);
  }
  const objectives = (meta.assessment_objectives || [])
    .map((objective) => ({ label: String(objective.label || objective.id || "").trim(), prose: String(objective.prose || "").trim() }))
    .filter((objective) => objective.label || objective.prose);
  return { methods, objectsByMethod, objectives };
}

const WORKING_FIELDS = "Your working fields";
const SOURCE_CONTEXT = "From cited sources";

function generateProfessionalImplementationWorksheet(options, controls, crossRef) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.implementation_statement_worksheet;
  const headers = ["Control ID", "Control Title", "Family", "Type", "CCI Count", "STIG/SRG Rule Count", "Related CCIs", "implementationStatus", "controlDesignation", "responsibleEntities", "implementationNarrative", "commonControlProvider", "naJustification", "estimatedCompletionDate", "Evidence References", "slcmFrequency", "slcmMethod", "slcmReporting", "Review Notes"];
  const rows = controls.map((c) => {
    const refs = crossRef && c.nodeId ? crossRefForControl(crossRef, c.nodeId) : null;
    return [
      c.id,
      c.title,
      c.family || DASH,
      c.nodeId ? (c.isEnhancement ? "Enhancement" : "Control") : DASH,
      refs ? refs.cciIds.length : 0,
      refs ? refs.ruleCount : 0,
      refs && refs.cciIds.length ? cappedJoin(refs.cciIds, CROSS_REF_CAP) : DASH,
      ph("[Planned | Implemented | Inherited | Not Applicable | Manually Inherited]"),
      ph("[Common | System-Specific | Hybrid]"),
      ph("[Responsible organizations and roles]"),
      ph("[How the control is implemented: who, what mechanism, where, how often, and what record it leaves. 2,000 characters maximum in eMASS]"),
      ph("[DoD | Component | Enclave, when inherited]"),
      ph("[Required when Not Applicable]"),
      ph("[YYYY-MM-DD]"),
      ph("[Artifact IDs, paths, or links]"),
      ph("[How often the control is monitored]"),
      ph("[Automated | Semi-Automated | Manual | Undetermined]"),
      ph("[How results are reported]"),
      ph("[Reviewer, date, decision, and follow-up]"),
    ];
  });
  const source = (extra = {}) => ({ group: SOURCE_CONTEXT, ...extra });
  const spec = {
    "Control ID": source(),
    "Control Title": source({ width: 34 }),
    Family: source({ width: 24 }),
    Type: source({ width: 13 }),
    "CCI Count": source({ width: 10, help: "Number of DISA CCIs mapped to this control." }),
    "STIG/SRG Rule Count": source({ width: 12, help: "Number of STIG and SRG rules that reference this control's CCIs. See the Evidence Expectation Matrix for the rule IDs." }),
    "Related CCIs": source({ width: 30 }),
    implementationStatus: { group: "Statement", required: true, ...listOf(V.implementationStatus), help: "Your decision. Control Atlas does not fill this in." },
    controlDesignation: { group: "Statement", required: true, ...listOf(V.controlDesignation), help: "Required by eMASS." },
    responsibleEntities: { group: "Statement", width: 28 },
    implementationNarrative: { group: "Statement", required: true, width: 52, help: "Required by eMASS. Write it from your own system's facts." },
    commonControlProvider: { group: "Inheritance / N/A", ...listOf(V.commonControlProvider), help: "Only for Inherited controls." },
    naJustification: { group: "Inheritance / N/A", width: 30, help: "Required by eMASS when the status is Not Applicable." },
    estimatedCompletionDate: { group: "Plan and evidence", ...dateField({ help: "Enter a date, for example 2026-09-30. eMASS stores Unix time; convert when you enter it there." }) },
    "Evidence References": { group: "Plan and evidence", width: 30 },
    slcmFrequency: { group: "Monitoring (SLCM)", ...listOf(V.slcmFrequency) },
    slcmMethod: { group: "Monitoring (SLCM)", ...listOf(V.slcmMethod) },
    slcmReporting: { group: "Monitoring (SLCM)", width: 28 },
    "Review Notes": { group: "Review", width: 30 },
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Scope", content: scopeSentence(options, controls) },
    { type: "text", heading: "How to use", content: ["- White columns come from the cited sources. Fill the amber and blue columns yourself.", "- Control Atlas does not write statements and does not decide status, inheritance, Not Applicable, responsibility or evidence.", "- Write a testable narrative: who does what, with which mechanism, where, how often, and what record it leaves.", "- Headers in camelCase are eMASS API v3.22 field names. Title Case headers are local."].join("\n") },
    tableSection("Implementation Statements", headers, rows, spec),
  ];
  return appendSourceMetadata({ title: "Control Implementation Statement Worksheet", description: "Control-by-control worksheet for drafting implementation statements, with eMASS API v3.22 field names and values.", sections }, options);
}

function generateProfessionalEvidenceMatrix(options, controls, crossRef) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.evidence_expectation_matrix;
  const headers = ["Control ID", "Control Title", "Family", "800-53A Methods", "800-53A Objectives", "Examine Objects (800-53A)", "Related CCIs", "STIG/SRG Rule Count", "Related STIG/SRG (V-IDs)", "Related Rule IDs", "Evidence Type", "Artifact Name / ID", "Evidence Owner", "Collection Method", "Collection Cadence", "Evidence Date / Period", "Repository / Location", "Review Status", "Confidence", "Assessor Notes"];
  const objectRows = [];
  const objectiveRows = [];
  const referenceRows = [];
  const rows = controls.map((c) => {
    const refs = crossRef && c.nodeId ? crossRefForControl(crossRef, c.nodeId) : null;
    const assessment = crossRef && c.nodeId ? assessmentContext(crossRef, c.nodeId) : null;
    if (assessment) addAssessmentReference(c.id, assessment, objectRows, objectiveRows);
    if (refs) {
      referenceRows.push([
        c.id,
        c.title,
        refs.cciIds.length ? refs.cciIds.join("; ") : DASH,
        refs.ruleCount,
        refs.stigIds.length ? cappedJoin(refs.stigIds, REFERENCE_SHEET_CAP) : DASH,
        refs.ruleIds.length ? cappedJoin(refs.ruleIds, REFERENCE_SHEET_CAP) : DASH,
      ]);
    }
    const examine = assessment?.objectsByMethod.get("Examine");
    return [
      c.id,
      c.title,
      c.family || DASH,
      assessment && assessment.methods.length ? assessment.methods.join("; ") : DASH,
      assessment ? assessment.objectives.length : 0,
      examine ? truncatePlain(examine.join("; "), 240) : DASH,
      refs && refs.cciIds.length ? cappedJoin(refs.cciIds, CROSS_REF_CAP) : DASH,
      refs ? refs.ruleCount : 0,
      refs && refs.stigIds.length ? cappedJoin(refs.stigIds, CROSS_REF_CAP) : DASH,
      refs && refs.ruleIds.length ? cappedJoin(refs.ruleIds, CROSS_REF_CAP) : DASH,
      ph("[Evidence type]"),
      ph("[Stable artifact name or ID]"),
      ph("[Owner role]"),
      ph("[Export | Query | Screenshot | Interview | Observation]"),
      ph("[Continuous | Monthly | Quarterly | Annual | Event-driven]"),
      ph("[YYYY-MM-DD or a period]"),
      ph("[Repository, ticket, or approved link]"),
      ph("[Needed | Requested | Received | Reviewed | Accepted | Gap]"),
      ph("[High | Medium | Low]"),
      ph("[Scope, sufficiency, sample, exceptions, follow-up]"),
    ];
  });
  const source = (extra = {}) => ({ group: SOURCE_CONTEXT, ...extra });
  const work = (extra = {}) => ({ group: WORKING_FIELDS, ...extra });
  const spec = {
    "Control ID": source(),
    "Control Title": source({ width: 32 }),
    Family: source({ width: 22 }),
    "800-53A Methods": source({ width: 22, help: "Assessment methods NIST SP 800-53A lists for this control." }),
    "800-53A Objectives": source({ width: 11, help: "Number of assessment objectives. The full text is on the Assessment Objectives sheet." }),
    "Examine Objects (800-53A)": source({ width: 44, help: "Things 800-53A says an assessor examines for this control. A prompt, not a required list. Full list on the Assessment Objects sheet." }),
    "Related CCIs": source({ width: 28 }),
    "STIG/SRG Rule Count": source({ width: 12, help: "Number of STIG and SRG rules that reference this control's CCIs." }),
    "Related STIG/SRG (V-IDs)": source({ width: 28, help: "A sample. The Control Cross-References sheet lists more." }),
    "Related Rule IDs": source({ width: 30, help: "A sample of STIG rule IDs (SV-...). The STIG Viewer worksheet lists every rule for one STIG." }),
    "Evidence Type": work({ required: true, width: 22 }),
    "Artifact Name / ID": work({ required: true, width: 28 }),
    "Evidence Owner": work({ required: true, width: 20 }),
    "Collection Method": work({ ...listOf(V.collectionMethod, { strict: false }) }),
    "Collection Cadence": work({ ...listOf(V.cadence, { strict: false }) }),
    "Evidence Date / Period": work({ width: 20, help: "A date or a period, for example 2026-Q3." }),
    "Repository / Location": work({ width: 26 }),
    "Review Status": work({ ...listOf(V.reviewStatus) }),
    Confidence: work({ ...listOf(V.confidence), help: "Your own triage signal, not an assessor decision. Mark Low when scope, freshness or traceability is uncertain." }),
    "Assessor Notes": work({ width: 34 }),
  };
  const refSpec = (headers2, widths) => Object.fromEntries(headers2.map((h, i) => [h, { group: SOURCE_CONTEXT, width: widths[i] }]));
  const objectHeaders = ["Control ID", "Method", "Assessment objects (NIST SP 800-53A)"];
  const objectiveHeaders = ["Control ID", "Objective", "Assessment objective text (NIST SP 800-53A)"];
  const referenceHeaders = ["Control ID", "Control Title", "Related CCIs", "STIG/SRG Rule Count", "Related STIG/SRG (V-IDs)", "Related Rule IDs"];
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Scope", content: scopeSentence(options, controls) },
    { type: "text", heading: "How to use", content: ["- White columns come from NIST SP 800-53A and the DISA CCI and STIG data. Amber and blue columns are yours.", "- The examine objects and objectives are publisher content that prompts what to collect. They are not evidence requirements and do not show what an assessor will accept.", "- Name each artifact specifically (a file name, report title or record type). \"Screenshots\" is not an artifact.", "- Give each artifact an owner role, a collection method and a cadence so it stays current."].join("\n") },
    tableSection("Evidence Expectations", headers, rows, spec),
    tableSection("Assessment Objects", objectHeaders, objectRows, refSpec(objectHeaders, [14, 14, 110])),
    tableSection("Assessment Objectives", objectiveHeaders, objectiveRows, refSpec(objectiveHeaders, [14, 16, 110])),
    tableSection("Control Cross-References", referenceHeaders, referenceRows, refSpec(referenceHeaders, [14, 32, 60, 12, 50, 50])),
  ];
  return appendSourceMetadata({ title: "Evidence Expectation Matrix", description: "Evidence planning matrix. Publisher assessment context sits beside your own ownership, collection and review fields.", sections }, options);
}

function generateProfessionalInheritanceWorksheet(options, controls) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.inheritance_worksheet;
  const headers = ["Control ID", "Control Title", "Family", "Type", "Inheritance Decision", "Provider", "Provider Service / Component", "Provider Evidence", "Evidence Version / Date", "Evidence Freshness Status", "Local Responsibility", "Local Delta", "Validation Method", "Decision Basis", "Decision Owner", "Review Date", "Notes / Gaps"];
  const rows = controls.map((c) => [
    c.id,
    c.title,
    c.family || DASH,
    c.nodeId ? (c.isEnhancement ? "Enhancement" : "Control") : DASH,
    ph("[Fully Inherited | Hybrid | System-Specific | Not Applicable]"),
    ph("[Provider]"),
    ph("[Service or component]"),
    ph("[CRM/CIS, package, report, attestation, contract]"),
    ph("[Version and YYYY-MM-DD]"),
    ph("[Current | Aging | Expired | Unknown]"),
    ph("[What the local team implements, configures, monitors, or verifies]"),
    ph("[Difference from the provider baseline]"),
    ph("[Document review | Test | Interview | Attestation]"),
    ph("[Contract, package, agreement, or architecture decision]"),
    ph("[Accountable role]"),
    ph("[YYYY-MM-DD]"),
    ph("[Assumptions, limitations, evidence gaps]"),
  ]);
  const source = (extra = {}) => ({ group: SOURCE_CONTEXT, ...extra });
  const spec = {
    "Control ID": source(),
    "Control Title": source({ width: 34 }),
    Family: source({ width: 24 }),
    Type: source({ width: 13 }),
    "Inheritance Decision": { group: "Decision", required: true, ...listOf(V.decision), help: "Your decision. Control Atlas does not infer it from the framework, a cloud provider, or tags." },
    Provider: { group: "Decision", width: 22 },
    "Provider Service / Component": { group: "Decision", width: 26 },
    "Provider Evidence": { group: "Provider evidence", width: 30 },
    "Evidence Version / Date": { group: "Provider evidence", width: 20, help: "A version and a date, for example v2.1, 2026-06-30." },
    "Evidence Freshness Status": { group: "Provider evidence", ...listOf(V.freshness) },
    "Local Responsibility": { group: "Local responsibility", width: 34 },
    "Local Delta": { group: "Local responsibility", width: 30 },
    "Validation Method": { group: "Local responsibility", ...listOf(V.validationMethod, { strict: false }) },
    "Decision Basis": { group: "Review", required: true, width: 30 },
    "Decision Owner": { group: "Review", required: true, width: 20 },
    "Review Date": { group: "Review", ...dateField() },
    "Notes / Gaps": { group: "Review", width: 30 },
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Scope", content: scopeSentence(options, controls) },
    { type: "text", heading: "How to use", content: ["- Do not mark a control inherited only because a cloud or shared service is used.", "- Name the provider's assertion, its version and date, and the exact responsibility you keep.", "- Record local differences as deltas with their own evidence.", "- Revisit Aging, Expired or Unknown provider evidence before relying on it."].join("\n") },
    tableSection("Inheritance Decision Log", headers, rows, spec),
  ];
  return appendSourceMetadata({ title: "Inheritance Worksheet", description: "Decision log for inherited, hybrid, system-specific and not-applicable controls, with provider evidence and local responsibility.", sections }, options);
}

function generateProfessionalPOAM(options) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.poam_starter;
  const headers = [
    "externalUid", "status", "vulnerabilityDescription", "sourceIdentifyingVulnerability", "controlAcronym", "assessmentProcedure", "securityChecks", "Original Detection Date",
    "severity", "rawSeverity", "relevanceOfThreat", "likelihood", "impact", "impactDescription", "residualRiskLevel",
    "pocOrganization", "pocFirstName", "pocLastName", "pocEmail", "pocPhoneNumber",
    "resources", "Planned Remediation", "recommendations", "scheduledCompletionDate",
    "mitigations", "Risk Acceptance / Deviation Reference", "completionDate", "Evidence Needed for Closure", "comments", "Reviewer Notes",
  ];
  const hint = {
    externalUid: "[Stable ID you keep across updates]",
    status: "[Ongoing | Risk Accepted | Completed | Not Applicable]",
    vulnerabilityDescription: "[Plain-language weakness. 2,000 characters maximum in eMASS]",
    sourceIdentifyingVulnerability: "[Scan, assessment, audit, incident, or other source]",
    controlAcronym: "[Control ID]",
    assessmentProcedure: "[Assessment procedure]",
    securityChecks: "[STIG/SRG rules or other checks]",
    "Original Detection Date": "[YYYY-MM-DD]",
    severity: "[Very Low | Low | Moderate | High | Very High]",
    rawSeverity: "[Scanner severity]",
    relevanceOfThreat: "[Very Low | Low | Moderate | High | Very High]",
    likelihood: "[Very Low | Low | Moderate | High | Very High]",
    impact: "[Very Low | Low | Moderate | High | Very High]",
    impactDescription: "[Mission or business impact]",
    residualRiskLevel: "[Very Low | Low | Moderate | High | Very High]",
    pocOrganization: "[Accountable organization or office]",
    pocFirstName: "[First name]",
    pocLastName: "[Last name]",
    pocEmail: "[Email]",
    pocPhoneNumber: "[Phone]",
    resources: "[People, funding, tools, dependencies]",
    "Planned Remediation": "[Corrective action or compensating control]",
    recommendations: "[Recommended corrective action]",
    scheduledCompletionDate: "[YYYY-MM-DD]",
    mitigations: "[Current mitigations]",
    "Risk Acceptance / Deviation Reference": "[Approval memo, exception, or deviation ID]",
    completionDate: "[YYYY-MM-DD when completed]",
    "Evidence Needed for Closure": "[Retest or artifact required to close]",
    comments: "[Closure notes, blockers, decisions]",
    "Reviewer Notes": "[Reviewer, date, decision]",
  };
  const rows = Array.from({ length: 20 }, () => headers.map((header) => ph(hint[header] || "")));
  const eMassDate = "Enter a date, for example 2026-09-30. eMASS stores Unix time; convert when you enter it there.";
  const risk = (extra = {}) => ({ group: "Risk", ...listOf(V.riskLevel), ...extra });
  const spec = {
    externalUid: { group: "Identity", required: true, width: 18, help: "Your stable tracking ID. Keep it the same across updates and use it on the Milestones sheet." },
    status: { group: "Identity", required: true, ...listOf(V.status), help: "Required by eMASS." },
    vulnerabilityDescription: { group: "Identity", required: true, width: 44, help: "Required by eMASS. Describe the weakness only; keep risk and fixes in their own columns." },
    sourceIdentifyingVulnerability: { group: "Identity", required: true, width: 28, help: "Required by eMASS." },
    controlAcronym: { group: "Identity", width: 14 },
    assessmentProcedure: { group: "Identity", width: 22 },
    securityChecks: { group: "Identity", width: 24 },
    "Original Detection Date": { group: "Identity", ...dateField() },
    severity: risk(),
    rawSeverity: { group: "Risk", width: 16 },
    relevanceOfThreat: risk(),
    likelihood: risk({ help: "eMASS requires this for approved items." }),
    impact: risk(),
    impactDescription: { group: "Risk", width: 30 },
    residualRiskLevel: risk(),
    pocOrganization: { group: "Ownership", required: true, width: 26, help: "Required by eMASS." },
    pocFirstName: { group: "Ownership", width: 16 },
    pocLastName: { group: "Ownership", width: 16 },
    pocEmail: { group: "Ownership", width: 26 },
    pocPhoneNumber: { group: "Ownership", width: 16 },
    resources: { group: "Remediation", required: true, width: 30, help: "Required by eMASS." },
    "Planned Remediation": { group: "Remediation", width: 38 },
    recommendations: { group: "Remediation", width: 30 },
    scheduledCompletionDate: { group: "Remediation", required: true, ...dateField({ help: `Required by eMASS. ${eMassDate}` }) },
    mitigations: { group: "Decision / closure", width: 30 },
    "Risk Acceptance / Deviation Reference": { group: "Decision / closure", width: 28 },
    completionDate: { group: "Decision / closure", ...dateField({ help: "Required by eMASS for Completed items." }) },
    "Evidence Needed for Closure": { group: "Decision / closure", width: 30 },
    comments: { group: "Decision / closure", width: 34, help: "eMASS requires this for Completed and Risk Accepted items." },
    "Reviewer Notes": { group: "Decision / closure", width: 30 },
  };
  const milestoneHeaders = ["externalUid", "Milestone #", "Milestone description", "scheduledCompletionDate", "Completion Date", "Milestone Status", "Milestone Owner", "Notes"];
  const milestoneHint = { externalUid: "[POA&M externalUid]", "Milestone #": "[1, 2, 3 ...]", "Milestone description": "[What will be done. 2,000 characters maximum in eMASS]", scheduledCompletionDate: "[YYYY-MM-DD]", "Completion Date": "[YYYY-MM-DD]", "Milestone Status": "[Planned | In Progress | Complete | Blocked]", "Milestone Owner": "[Role or name]", Notes: "[Dependencies, blockers]" };
  const milestoneRows = Array.from({ length: 30 }, () => milestoneHeaders.map((header) => ph(milestoneHint[header] || "")));
  const milestoneSpec = {
    externalUid: { group: "Milestone", required: true, ...valuesFrom("POA&M Working Register", "externalUid"), help: "The POA&M this milestone belongs to. Pick from the register." },
    "Milestone #": { group: "Milestone", width: 11 },
    "Milestone description": { group: "Milestone", required: true, width: 52, help: "Required by eMASS." },
    scheduledCompletionDate: { group: "Milestone", required: true, ...dateField({ help: `Required by eMASS. ${eMassDate}` }) },
    "Completion Date": { group: "Milestone", ...dateField() },
    "Milestone Status": { group: "Milestone", ...listOf(V.milestoneStatus) },
    "Milestone Owner": { group: "Milestone", width: 22 },
    Notes: { group: "Milestone", width: 30 },
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "How to use", content: ["- Give each weakness a stable externalUid and keep it. Milestones join to the register by that ID.", "- Keep the weakness, its risk, the fix and the closure in their own columns. Header colors show the stage.", "- List each milestone as its own row on the Milestones sheet, with its own date. The last milestone should match scheduledCompletionDate.", "- Close an item only after the closure evidence or retest is reviewed. Record any risk acceptance or deviation reference.", "- Headers in camelCase are eMASS API v3.22 field names. Title Case headers are local."].join("\n") },
    tableSection("POA&M Working Register", headers, rows, spec, { freezeColumns: 2 }),
    tableSection("Milestones", milestoneHeaders, milestoneRows, milestoneSpec),
  ];
  return appendSourceMetadata({ title: "POA&M Working Register", description: "Weakness and remediation register with a separate milestones sheet, with eMASS API v3.22 field names and values.", sections }, options);
}

function generateHardwareBaseline(options) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.hardware_baseline;
  const headers = [
    "Asset ID", "assetName", "componentType", "Hostname", "nickname", "manufacturer", "modelNumber", "serialNumber", "osIosFwVersion", "memorySizeType", "virtualAsset",
    "System / Authorization Boundary", "location", "criticalAsset",
    "assetIpAddress", "FQDN", "publicFacing", "publicFacingFqdn", "publicFacingIpAddress", "publicFacingUrls",
    "Asset Owner",
    "approvalStatus", "Lifecycle Status",
    "Discovery Source", "Last Verified", "Notes",
  ];
  const hint = {
    "Asset ID": "[Your stable asset ID]",
    assetName: "[Unique asset name]",
    componentType: "[For example Firewall, Web Server, Router, Workstation]",
    Hostname: "[Host name]",
    nickname: "[Friendly name]",
    manufacturer: "[Manufacturer, or Virtual]",
    modelNumber: "[Model, or Virtual]",
    serialNumber: "[Serial number, cloud resource ID, or Virtual]",
    osIosFwVersion: "[OS, IOS, or firmware version]",
    memorySizeType: "[Memory size and type]",
    virtualAsset: "[true | false]",
    "System / Authorization Boundary": "[System or boundary name]",
    location: "[Facility, building, region, or zone]",
    criticalAsset: "[true | false]",
    assetIpAddress: "[Internal IP address]",
    FQDN: "[Internal fully qualified domain name]",
    publicFacing: "[true | false]",
    publicFacingFqdn: "[Required when publicFacing is true]",
    publicFacingIpAddress: "[Required when publicFacing is true]",
    publicFacingUrls: "[Required when publicFacing is true]",
    "Asset Owner": "[Accountable role]",
    approvalStatus: "[Choose or enter an approval status]",
    "Lifecycle Status": "[Active | Spare | Maintenance | Retiring | Retired]",
    "Discovery Source": "[CMDB | Cloud API | Vulnerability scan | Network discovery | Manual | Other]",
    "Last Verified": "[YYYY-MM-DD]",
    Notes: "[Exceptions, dependencies, reconciliation notes]",
  };
  const rows = Array.from({ length: 20 }, () => headers.map((header) => ph(hint[header] || "")));
  const core = (extra = {}) => ({ group: "Core inventory", ...extra });
  const net = (extra = {}) => ({ group: "Network / exposure", ...extra });
  const spec = {
    "Asset ID": core({ required: true, width: 16, help: "Your stable ID for this asset. Keep it the same across updates." }),
    assetName: core({ required: true, width: 24, help: "Required by eMASS. One row per uniquely named asset." }),
    componentType: core({ required: true, width: 18 }),
    Hostname: core({ width: 20 }),
    nickname: core({ width: 18 }),
    manufacturer: core({ width: 18, help: "eMASS fills in Virtual for virtual assets." }),
    modelNumber: core({ width: 18 }),
    serialNumber: core({ width: 22, help: "Use a stable cloud resource ID where a serial number does not apply." }),
    osIosFwVersion: core({ width: 20 }),
    memorySizeType: core({ width: 16 }),
    virtualAsset: core({ ...listOf(TRUE_FALSE) }),
    "System / Authorization Boundary": { group: "System / boundary", width: 26 },
    location: { group: "System / boundary", width: 22 },
    criticalAsset: { group: "System / boundary", ...listOf(TRUE_FALSE) },
    assetIpAddress: net({ width: 16 }),
    FQDN: net({ width: 26 }),
    publicFacing: net({ ...listOf(TRUE_FALSE), help: "Choose true if the asset is reachable from outside the boundary. Then fill the three public-facing columns." }),
    publicFacingFqdn: net({ width: 26 }),
    publicFacingIpAddress: net({ width: 18 }),
    publicFacingUrls: net({ width: 28 }),
    "Asset Owner": { group: "Ownership", width: 20 },
    approvalStatus: { group: "Approval / lifecycle", ...listOf(V.approvalStatus, { strict: false }), width: 24, help: "eMASS lists seven default values and also accepts your own." },
    "Lifecycle Status": { group: "Approval / lifecycle", ...listOf(V.lifecycleStatus) },
    "Discovery Source": { group: "Source / verification", ...listOf(V.discoverySource, { strict: false }), width: 20 },
    "Last Verified": { group: "Source / verification", ...dateField({ help: "The date you last confirmed this row against its source." }) },
    Notes: { group: "Source / verification", width: 36 },
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "How to use", content: ["- One row per uniquely identifiable asset. Do not share a name across devices.", "- Reconcile owner, boundary, discovery source, last-verified date, lifecycle and approval status before an assessment.", "- If publicFacing is true, fill in the three public-facing columns.", "- Header colors group the columns: core inventory, system / boundary, network / exposure, ownership, approval / lifecycle, and source / verification.", "- Headers in camelCase are eMASS API v3.22 field names. Title Case headers are local."].join("\n") },
    tableSection("Hardware Baseline", headers, rows, spec, { freezeColumns: 2 }),
  ];
  return appendSourceMetadata({ title: "Hardware Baseline", description: "Hardware inventory for collecting, reconciling and reviewing assets, with eMASS API v3.22 field names and values.", sections }, options);
}

function generateSoftwareBaseline(options) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.software_baseline;
  const headers = [
    "Software ID", "softwareVendor", "softwareName", "version", "softwareType", "purpose", "softwareDependencies", "cryptographicHash",
    "Related Assets / Installation Scope", "parentSystem", "subsystem", "network", "hostingEnvironment", "location", "Software Owner", "criticalAsset",
    "approvalStatus", "approvalDate", "Authority / Approved Use", "Exception / Deviation Reference",
    "releaseDate", "maintenanceDate", "retirementDate", "endOfLifeSupportDate", "licenseOrContract", "licenseExpirationDate",
    "Discovery Source", "Last Verified", "Notes",
  ];
  const hint = {
    "Software ID": "[Your stable software record ID]",
    softwareVendor: "[Vendor]",
    softwareName: "[Product or package name]",
    version: "[Exact version or build]",
    softwareType: "[COTS | GOTS | Office Automation | Security | Server | Web Application, or your own]",
    purpose: "[Why the software is used]",
    softwareDependencies: "[Key packages, runtimes, or services]",
    cryptographicHash: "[Hash and algorithm, when controlled]",
    "Related Assets / Installation Scope": "[Asset IDs, device count, or enterprise-wide]",
    parentSystem: "[Parent system]",
    subsystem: "[Subsystem or component]",
    network: "[Network or enclave]",
    hostingEnvironment: "[On-premises, cloud, managed service, endpoint]",
    location: "[Facility, region, or logical location]",
    "Software Owner": "[Accountable role]",
    criticalAsset: "[true | false]",
    approvalStatus: "[Choose or enter an approval status]",
    approvalDate: "[YYYY-MM-DD]",
    "Authority / Approved Use": "[APL, baseline, waiver, or approval reference]",
    "Exception / Deviation Reference": "[Exception or deviation ID]",
    releaseDate: "[YYYY-MM-DD]",
    maintenanceDate: "[YYYY-MM-DD]",
    retirementDate: "[YYYY-MM-DD]",
    endOfLifeSupportDate: "[YYYY-MM-DD]",
    licenseOrContract: "[License, contract, or entitlement reference]",
    licenseExpirationDate: "[YYYY-MM-DD]",
    "Discovery Source": "[CMDB | Cloud API | Vulnerability scan | Network discovery | Manual | Other]",
    "Last Verified": "[YYYY-MM-DD]",
    Notes: "[Exceptions, vulnerabilities, upgrade or removal action]",
  };
  const rows = Array.from({ length: 20 }, () => headers.map((header) => ph(hint[header] || "")));
  const core = (extra = {}) => ({ group: "Core software inventory", ...extra });
  const scope = (extra = {}) => ({ group: "Scope / ownership", ...extra });
  const life = (extra = {}) => ({ group: "Approval / lifecycle", ...extra });
  const dateHelp = "Enter a date, for example 2026-09-30. eMASS stores Unix time; convert when you enter it there.";
  const spec = {
    "Software ID": core({ required: true, width: 16, help: "Your stable ID for this software record. Keep it the same across updates." }),
    softwareVendor: core({ required: true, width: 22, help: "Required by eMASS." }),
    softwareName: core({ required: true, width: 26, help: "Required by eMASS." }),
    version: core({ required: true, width: 16, help: "Required by eMASS. Give the exact version or build. List materially different versions on separate rows." }),
    softwareType: core({ ...listOf(V.softwareType, { strict: false }), width: 22, help: "eMASS lists six default values and also accepts your own." }),
    purpose: core({ width: 30 }),
    softwareDependencies: core({ width: 28 }),
    cryptographicHash: core({ width: 24 }),
    "Related Assets / Installation Scope": scope({ width: 30 }),
    parentSystem: scope({ width: 22 }),
    subsystem: scope({ width: 20 }),
    network: scope({ width: 18 }),
    hostingEnvironment: scope({ width: 22 }),
    location: scope({ width: 20 }),
    "Software Owner": scope({ width: 20 }),
    criticalAsset: scope({ ...listOf(TRUE_FALSE) }),
    approvalStatus: life({ ...listOf(V.approvalStatus, { strict: false }), width: 24, help: "eMASS lists seven default values and also accepts your own." }),
    approvalDate: life({ ...dateField({ help: `Leave blank when the status is Unapproved or In Progress; eMASS clears it. ${dateHelp}` }) }),
    "Authority / Approved Use": life({ width: 28 }),
    "Exception / Deviation Reference": life({ width: 24 }),
    releaseDate: life({ ...dateField({ help: dateHelp }) }),
    maintenanceDate: life({ ...dateField({ help: dateHelp }) }),
    retirementDate: life({ ...dateField({ help: dateHelp }) }),
    endOfLifeSupportDate: life({ ...dateField({ help: "Enter only a date you have from the vendor or your own records. Control Atlas does not supply vendor support dates." }) }),
    licenseOrContract: life({ width: 26 }),
    licenseExpirationDate: life({ ...dateField({ help: dateHelp }) }),
    "Discovery Source": { group: "Source / verification", ...listOf(V.discoverySource, { strict: false }), width: 20 },
    "Last Verified": { group: "Source / verification", ...dateField({ help: "The date you last confirmed this row against its source." }) },
    Notes: { group: "Source / verification", width: 36 },
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "How to use", content: ["- Record vendor, product and exact version or build. List materially different versions on separate rows.", "- Tie each row to the assets it runs on, an owner, an approval basis, a discovery source and a last-verified date.", "- Support and end-of-life dates are yours to enter from the vendor or your own records. Control Atlas does not fill them in.", "- Header colors group the columns: core inventory, scope / ownership, approval / lifecycle, and source / verification.", "- Headers in camelCase are eMASS API v3.22 field names. Title Case headers are local."].join("\n") },
    tableSection("Software Baseline", headers, rows, spec, { freezeColumns: 3 }),
  ];
  return appendSourceMetadata({ title: "Software Baseline", description: "Software inventory for collecting, reconciling and reviewing software, with eMASS API v3.22 field names and values.", sections }, options);
}

function addAssessmentReference(controlId, assessment, objectRows, objectiveRows) {
  for (const [method, objects] of assessment.objectsByMethod) objectRows.push([controlId, method, objects.join("; ")]);
  for (const objective of assessment.objectives) objectiveRows.push([controlId, objective.label || DASH, objective.prose || DASH]);
}

/** "Examine: a; b | Interview: c" cut at a word boundary. */
function objectsSummary(assessment, max) {
  const parts = [...assessment.objectsByMethod].map(([method, objects]) => `${method}: ${objects.join("; ")}`);
  return parts.length ? truncatePlain(parts.join(" | "), max) : DASH;
}

function generateProfessionalAssessmentPlan(options, controls, crossRef) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.assessment_planning_worksheet;
  const headers = ["Control ID", "Control Title", "Family", "Type", "Procedure Reference", "800-53A Methods", "800-53A Objectives", "Assessment Objects (NIST SP 800-53A)", "Related CCIs", "STIG/SRG Rule Count", "Assessment Scope", "Assessment Method", "Assessor Role", "Evidence to Request", "Sampling Approach", "Tool / Procedure", "Target Start", "Target Complete", "Status", "Result / Test Success", "Finding / POA&M Reference", "Evidence Location", "Review Notes"];
  const objectRows = [];
  const objectiveRows = [];
  const rows = controls.map((c) => {
    const refs = crossRef && c.nodeId ? crossRefForControl(crossRef, c.nodeId) : null;
    const assessment = crossRef && c.nodeId ? assessmentContext(crossRef, c.nodeId) : null;
    if (assessment) addAssessmentReference(c.id, assessment, objectRows, objectiveRows);
    return [
      c.id,
      c.title,
      c.family || DASH,
      c.nodeId ? (c.isEnhancement ? "Enhancement" : "Control") : DASH,
      assessment ? `NIST SP 800-53A ${c.id}` : DASH,
      assessment && assessment.methods.length ? assessment.methods.join("; ") : DASH,
      assessment ? assessment.objectives.length : 0,
      assessment ? objectsSummary(assessment, 260) : DASH,
      refs && refs.cciIds.length ? cappedJoin(refs.cciIds, CROSS_REF_CAP) : DASH,
      refs ? refs.ruleCount : 0,
      ph("[Requirement, components, location, population, exclusions]"),
      ph("[Examine | Interview | Test | Combination]"),
      ph("[Lead and supporting assessor roles]"),
      ph("[Specific artifacts and covered period]"),
      ph("[Population, sample size, selection basis]"),
      ph("[Procedure ID, scanner, script, or manual method]"),
      ph("[YYYY-MM-DD]"),
      ph("[YYYY-MM-DD]"),
      ph("[Planned | Ready | In Progress | Blocked | Complete]"),
      ph("[Pass | Fail | Inconclusive | Not Tested]"),
      ph("[Finding ID, externalUid, or N/A]"),
      ph("[Repository, ticket, or approved link]"),
      ph("[Constraints, deviations, retest, follow-up]"),
    ];
  });
  const source = (extra = {}) => ({ group: SOURCE_CONTEXT, ...extra });
  const plan = (extra = {}) => ({ group: "Plan", ...extra });
  const result = (extra = {}) => ({ group: "Result and follow-up", ...extra });
  const spec = {
    "Control ID": source(),
    "Control Title": source({ width: 32 }),
    Family: source({ width: 22 }),
    Type: source({ width: 13 }),
    "Procedure Reference": source({ width: 22, help: "The NIST SP 800-53A assessment procedure for this control." }),
    "800-53A Methods": source({ width: 22, help: "Assessment methods NIST SP 800-53A lists. Your chosen method goes in Assessment Method." }),
    "800-53A Objectives": source({ width: 11, help: "Number of assessment objectives. The full text is on the Assessment Objectives sheet." }),
    "Assessment Objects (NIST SP 800-53A)": source({ width: 48, help: "Publisher text. What 800-53A says an assessor examines, interviews or tests. The full list is on the Assessment Objects sheet." }),
    "Related CCIs": source({ width: 28 }),
    "STIG/SRG Rule Count": source({ width: 12, help: "Number of STIG and SRG rules that reference this control's CCIs." }),
    "Assessment Scope": plan({ required: true, width: 34 }),
    "Assessment Method": plan({ required: true, ...listOf(V.method), help: "Your choice. 800-53A lists the methods it defines for this control in the column to the left." }),
    "Assessor Role": plan({ width: 22 }),
    "Evidence to Request": plan({ width: 34 }),
    "Sampling Approach": plan({ width: 28 }),
    "Tool / Procedure": plan({ width: 28 }),
    "Target Start": plan({ ...dateField() }),
    "Target Complete": plan({ ...dateField() }),
    Status: result({ required: true, ...listOf(V.status) }),
    "Result / Test Success": result({ ...listOf(V.result), help: "Corresponds to the eMASS test-results success flag in concept only. This worksheet is not an eMASS import." }),
    "Finding / POA&M Reference": result({ width: 24 }),
    "Evidence Location": result({ width: 26 }),
    "Review Notes": result({ width: 34 }),
  };
  const refSpec = (headers2, widths) => Object.fromEntries(headers2.map((h, i) => [h, { group: SOURCE_CONTEXT, width: widths[i] }]));
  const objectHeaders = ["Control ID", "Method", "Assessment objects (NIST SP 800-53A)"];
  const objectiveHeaders = ["Control ID", "Objective", "Assessment objective text (NIST SP 800-53A)"];
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Scope", content: scopeSentence(options, controls) },
    { type: "text", heading: "How to use", content: ["- White columns are publisher content from NIST SP 800-53A and DISA data, shown as published. Control Atlas does not rewrite them and does not invent procedures.", "- Amber and blue columns are your plan: scope, method, assessor, sampling, schedule, result and follow-up.", "- The full objective text and object lists are on their own sheets, linked by control ID.", "- Some controls have no 800-53A record here. They show a dash, not invented content."].join("\n") },
    tableSection("Assessment Plan", headers, rows, spec),
    tableSection("Assessment Objects", objectHeaders, objectRows, refSpec(objectHeaders, [14, 14, 110])),
    tableSection("Assessment Objectives", objectiveHeaders, objectiveRows, refSpec(objectiveHeaders, [14, 16, 110])),
  ];
  return appendSourceMetadata({ title: "Assessment Planning Worksheet", description: "Assessment plan with NIST SP 800-53A methods, objects and objectives beside your scope, sampling, schedule and results.", sections }, options);
}

/**
 * FedRAMP cadences that a cited rule states outright. They apply only when a
 * FedRAMP program is selected. tests/template-wave2.test.mjs re-reads
 * data/fedramp-2026-rules.json to prove each rule ID and timeframe still exist.
 */
export const FEDRAMP_CONMON_RULES = Object.freeze([
  { ruleId: "CCM-OCR-AVL", activity: "Ongoing Certification Report", cadence: "Every 3 months", deliverable: "Ongoing Certification Report to all necessary parties", timeframe: "every 3 months" },
  { ruleId: "VER-TFR-MHR", activity: "Vulnerability detection and response report", cadence: "At least monthly", deliverable: "Vulnerability detection and response activity report", timeframe: "at least monthly" },
  { ruleId: "VDR-TFR-NMV", activity: "Verify non-machine-based information resources", cadence: "At least once every 3 months", deliverable: "Verification and validation record", timeframe: "at least once every 3 months" },
  { ruleId: "IVV-CSF-MCA", activity: "Independent assessment of applicable Rev5 controls", cadence: "Every 3 years", deliverable: "Independent assessment covering all applicable Rev5 controls over the period", timeframe: "every 3 years" },
]);

/**
 * How each seeded cadence is classified. `source_required` is reserved for a
 * cadence a primary source states for the selected context. No generic
 * NIST or DoD row qualifies today: SP 800-53 leaves these frequencies to the
 * organization. They are planning defaults and are shown as such.
 */
export const CONMON_BASIS_LABELS = Object.freeze({
  source_required: "Source requirement",
  program_specific: "Program-specific requirement",
  planning_default: "Planning default",
});

function generateProfessionalConMonCalendar(options) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.conmon_calendar;
  const fedrampSelected = /^fedramp/i.test(String(options.framework || ""));
  const headers = ["Activity", "Control References", "Cadence Basis", "Source / Program Cadence", "Cadence Source", "Planning Default (suggestion)", "Organization-Selected Cadence", "Deliverable / Evidence", "Collection Method", "Owner", "Reviewer / Recipient", "Evidence Location", "Next Due", "Completed Date", "Status", "Result / Threshold", "Escalation / Follow-up", "Notes"];
  const generic = [
    ["Vulnerability scanning", "RA-5", "Authenticated scan results and remediation intake", "Approved scanner", "Monthly"],
    ["Account and privilege review", "AC-2; AC-6", "Review record and access removals", "Identity report plus owner attestation", "Quarterly"],
    ["Configuration compliance review", "CM-6", "STIG or configuration results and exceptions", "Automated scan plus manual validation", "Quarterly"],
    ["Audit log review", "AU-6", "Review record, alerts, and escalations", "SIEM query and analyst review", "Weekly"],
    ["Asset inventory reconciliation", "CM-8", "Hardware and software delta and disposition", "Inventory export and source reconciliation", "Quarterly"],
    ["POA&M review", "CA-5", "Updated milestones, overdue actions, and decisions", "Register review", "Monthly"],
    ["Contingency plan exercise", "CP-4", "Exercise results and corrective actions", "Tabletop or functional exercise", "Annual"],
    ["Incident response exercise", "IR-3", "Exercise record and lessons learned", "Tabletop or functional exercise", "Annual"],
    ["Security training review", "AT-2", "Completion and delinquency report", "Learning-system report", "Annual"],
    ["Control assessment and penetration test", "CA-2; CA-8", "Assessment results and findings", "Independent assessment", "Annual"],
  ];
  const tail = () => [ph("[Role]"), ph("[Reviewer or reporting recipient]"), ph("[Repository or approved link]"), ph("[YYYY-MM-DD]"), ph("[YYYY-MM-DD]"), ph("[Planned | In Progress | Complete | Late | Blocked]"), ph("[Result and threshold breach]"), ph("[Ticket, POA&M, incident, or risk decision]"), ph("[Scope, dependencies, exceptions]")];
  const rows = [];
  if (fedrampSelected) {
    for (const rule of FEDRAMP_CONMON_RULES) {
      rows.push([rule.activity, DASH, CONMON_BASIS_LABELS.program_specific, rule.cadence, `FedRAMP ${rule.ruleId}`, DASH, ph("[Your cadence, at least as often as the rule]"), rule.deliverable, ph("[How the deliverable is produced]"), ...tail()]);
    }
  }
  for (const [activity, refs, deliverable, method, frequency] of generic) {
    rows.push([activity, refs, CONMON_BASIS_LABELS.planning_default, DASH, DASH, frequency, ph("[Your cadence]"), deliverable, method, ...tail()]);
  }
  const src = (extra = {}) => ({ group: "Expected cadence (from a source)", ...extra });
  const mine = (extra = {}) => ({ group: "Your schedule", ...extra });
  const spec = {
    Activity: { group: "Activity", width: 34 },
    "Control References": { group: "Activity", width: 16 },
    "Cadence Basis": src({ width: 24, help: "Program-specific requirement: a cited rule states it. Planning default: only our suggestion; no source requires it." }),
    "Source / Program Cadence": src({ width: 22, help: "Only filled in when a cited rule states the cadence." }),
    "Cadence Source": src({ width: 20 }),
    "Planning Default (suggestion)": src({ width: 20, help: "A starting suggestion. NIST SP 800-53 leaves these frequencies to the organization." }),
    "Organization-Selected Cadence": mine({ required: true, ...listOf(V.cadence, { strict: false }), width: 22, help: "Your cadence. It must be at least as often as any program cadence." }),
    "Deliverable / Evidence": { group: "Activity", width: 36 },
    "Collection Method": { group: "Activity", width: 28 },
    Owner: mine({ required: true, width: 18 }),
    "Reviewer / Recipient": mine({ width: 22 }),
    "Evidence Location": mine({ width: 24 }),
    "Next Due": mine({ ...dateField() }),
    "Completed Date": mine({ ...dateField() }),
    Status: mine({ ...listOf(V.status) }),
    "Result / Threshold": mine({ width: 26 }),
    "Escalation / Follow-up": mine({ width: 26 }),
    Notes: mine({ width: 28 }),
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "How to read the cadences", content: ["- Cadence Basis says where a cadence comes from. Program-specific means a cited rule states it. Planning default means it is only our suggestion.", "- No NIST or DoD source used here requires the planning defaults. SP 800-53 leaves those frequencies to the organization. Confirm them against your program, contract and authorization terms.", "- Choose your own cadence in Organization-Selected Cadence. If a program rule applies, yours must be at least as often as the rule.", fedrampSelected ? "- FedRAMP rows are from the FedRAMP Consolidated Rules for 2026. Check each rule's effective date and your certification class." : "- No program is selected, so no program cadence rows are included."].join("\n") },
    tableSection("Monitoring Delivery Schedule", headers, rows, spec, { freezeColumns: 1 }),
  ];
  return appendSourceMetadata({ title: "Continuous Monitoring Delivery Calendar", description: "Monitoring schedule that separates cadences a source states from planning suggestions and from the cadence your organization selects.", sections }, options);
}

const SEVERITY_LABELS = { high: "High (CAT I)", medium: "Medium (CAT II)", low: "Low (CAT III)" };

function ruleSort(a, b) {
  const key = (rule) => String(rule.metadata?.stig_id || rule.metadata?.vuln_id || rule.metadata?.item_id || "");
  return key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: "base" }) ||
    String(a.metadata?.rule_id || "").localeCompare(String(b.metadata?.rule_id || ""), undefined, { numeric: true });
}

/**
 * The published STIG benchmark and its rules. Fails closed: a worksheet built
 * around a STIG is meaningless without one.
 */
function resolveStigBenchmark(dataset, stig) {
  const wanted = String(stig || "").trim();
  if (!wanted) {
    throw new Error("Choose a STIG to prepare this worksheet. No document was generated.");
  }
  const nodes = dataset?.nodes || [];
  const benchmark = nodes.find(
    (node) =>
      node.node_type === "benchmark" &&
      node.metadata?.catalog_id === "disa-stig" &&
      (node.metadata?.item_id === wanted || node.id === wanted),
  );
  if (!benchmark) {
    throw new Error(`"${wanted}" is not a published STIG. No document was generated.`);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rules = [];
  for (const edge of dataset?.edges || []) {
    if (edge.relationship_type !== "contains" || edge.source_node_id !== benchmark.id) continue;
    const child = byId.get(edge.target_node_id);
    if (child?.node_type === "stig_rule") rules.push(child);
  }
  if (rules.length === 0) {
    throw new Error(`"${benchmark.metadata?.title || wanted}" has no published rules. No document was generated.`);
  }
  rules.sort(ruleSort);
  return { benchmark, rules };
}

/** The 12 headers the STIG Viewer 3.x User Guide V1R7 requires, in the guide's order. */
export const STIG_VIEWER_CSV_HEADERS = Object.freeze(["Benchmark ID", "Rule ID", "Status", "Comments", "Finding Details", "Severity Override", "Severity Override Reason", "FQDN", "IP Address", "MAC Address", "Host Name", "Technology Area"]);

function generateProfessionalSTIGWorksheet(options, stigContext, crossRef) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.stig_evidence_checklist;
  const { benchmark, rules } = stigContext;
  const meta = benchmark.metadata || {};
  const benchmarkId = String(meta.publisher_item_id || rules[0]?.metadata?.benchmark_id || "");
  const targetHeaders = ["FQDN", "IP Address", "MAC Address", "Host Name", "Technology Area"];
  const targetRow = targetHeaders.map((header) => ph(`[${header === "Technology Area" ? "Choose a Technology Area" : header}]`));
  const targetCell = (index) => ({ formula: `IF(Target!$${String.fromCharCode(65 + index)}$2="","",Target!$${String.fromCharCode(65 + index)}$2)` });
  const importRows = rules.map((rule) => [
    benchmarkId,
    String(rule.metadata?.rule_id || ""),
    "",
    "",
    "",
    "",
    "",
    ...targetHeaders.map((_, index) => targetCell(index)),
  ]);
  const cciFor = (rule) => (crossRef ? [...(crossRef.ruleToCci.get(rule.id) || [])].map((id) => crossRef.byId.get(id)?.metadata?.item_id || id) : []);
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const referenceHeaders = ["Rule ID", "Vuln ID", "STIG ID", "Severity", "Rule Title", "CCIs", "Related NIST 800-53 Controls"];
  const referenceRows = rules.map((rule) => {
    const ccis = cciFor(rule).sort(natural);
    const controlIds = new Set();
    for (const cci of crossRef?.ruleToCci.get(rule.id) || []) {
      for (const control of crossRef.cciToControl.get(cci) || []) controlIds.add(crossRef.byId.get(control)?.metadata?.item_id || control);
    }
    return [
      String(rule.metadata?.rule_id || ""),
      String(rule.metadata?.vuln_id || rule.metadata?.item_id || ""),
      String(rule.metadata?.stig_id || DASH),
      SEVERITY_LABELS[String(rule.metadata?.severity || "").toLowerCase()] || DASH,
      String(rule.metadata?.title || rule.label || ""),
      ccis.length ? ccis.join("; ") : DASH,
      controlIds.size ? [...controlIds].sort(natural).join("; ") : DASH,
    ];
  });
  const noteHeaders = ["Rule ID", "Evidence Artifact", "Validation Method", "Evidence Owner", "Evidence Date", "Review Notes"];
  const noteRows = rules.map((rule) => [String(rule.metadata?.rule_id || ""), ph("[Artifact name or ID]"), ph("[Export | Screenshot | Query | Interview]"), ph("[Owner role]"), ph("[YYYY-MM-DD]"), ph("[Scope, sufficiency, follow-up]")]);
  const severityCounts = { high: 0, medium: 0, low: 0 };
  for (const rule of rules) {
    const key = String(rule.metadata?.severity || "").toLowerCase();
    if (key in severityCounts) severityCounts[key] += 1;
  }
  const scope = `STIG: ${meta.title || benchmark.label}, ${meta.benchmark_version || "version not recorded"}${meta.benchmark_status_date ? ` (${meta.benchmark_status_date})` : ""}. Benchmark ID: ${benchmarkId}. ${rules.length} rules: ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low. Rule IDs, titles and severities are as DISA published them.`;
  const target = (extra = {}) => ({ group: "Target (one per file)", width: 26, ...extra });
  const importGroup = (extra = {}) => ({ group: "Viewer CSV columns", ...extra });
  const importSpec = {
    "Benchmark ID": importGroup({ width: 28, help: "Filled in from the STIG you chose. STIG Viewer checks it against the checklist." }),
    "Rule ID": importGroup({ width: 24, help: "Filled in from the STIG you chose. Do not edit." }),
    Status: importGroup({ ...listOf(V.status), help: "Leave blank for Not Reviewed. STIG Viewer rejects other values." }),
    Comments: importGroup({ width: 34 }),
    "Finding Details": importGroup({ width: 38 }),
    "Severity Override": importGroup({ ...listOf(V.severityOverride), help: "Only with an authorized override. STIG Viewer needs a reason when this is set." }),
    "Severity Override Reason": importGroup({ width: 34 }),
    FQDN: importGroup({ width: 24, help: "Comes from the Target sheet. Fill it in there, once." }),
    "IP Address": importGroup({ width: 18, help: "Comes from the Target sheet." }),
    "MAC Address": importGroup({ width: 18, help: "Comes from the Target sheet." }),
    "Host Name": importGroup({ width: 20, help: "Comes from the Target sheet." }),
    "Technology Area": importGroup({ width: 24, help: "Comes from the Target sheet." }),
  };
  const reference = (extra = {}) => ({ group: "Rule reference (DISA)", ...extra });
  const referenceSpec = {
    "Rule ID": reference({ width: 24 }),
    "Vuln ID": reference({ width: 12 }),
    "STIG ID": reference({ width: 16 }),
    Severity: reference({ width: 16 }),
    "Rule Title": reference({ width: 70 }),
    CCIs: reference({ width: 36 }),
    "Related NIST 800-53 Controls": reference({ width: 36 }),
  };
  const noteSpec = {
    "Rule ID": { group: "Rule reference (DISA)", width: 24 },
    "Evidence Artifact": { group: "Your evidence notes", width: 30 },
    "Validation Method": { group: "Your evidence notes", ...listOf(V.validationMethod, { strict: false }) },
    "Evidence Owner": { group: "Your evidence notes", width: 20 },
    "Evidence Date": { group: "Your evidence notes", ...dateField() },
    "Review Notes": { group: "Your evidence notes", width: 34 },
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Selected STIG", content: scope },
    { type: "text", heading: "How to use", content: [
      "- Enter the target once on the Target sheet. STIG Viewer needs the same target values in every row of one CSV, so this file covers one target. For another target, make another copy.",
      "- On the import sheet, fill in Status, Comments and Finding Details for the rules you assessed. Leave Status blank for Not Reviewed. Control Atlas does not fill in any result.",
      "- Set Severity Override only for an authorized override, with a reason, and only to Low, Medium or High.",
      "- To make the CSV: open the import sheet, then File > Save As > CSV. Excel saves only that sheet, with the 12 headers and the target values filled down. Keep evidence notes on their own sheet; they never go in the CSV.",
      "- In STIG Viewer, open the checklist for this STIG and use Import > Import STIG Viewer CSV. The import updates a checklist that already exists and matches on Rule ID. Control Atlas has not tested an import.",
    ].join("\n") },
    tableSection("Target", targetHeaders, [targetRow], {
      FQDN: target({ help: "Fully qualified domain name of the assessed target." }),
      "IP Address": target(),
      "MAC Address": target(),
      "Host Name": target(),
      "Technology Area": target({ ...listOf(V.technologyArea), width: 30, help: "One of the 21 values STIG Viewer accepts." }),
    }, { freezeColumns: 0 }),
    tableSection("STIG Viewer CSV Import Rows", [...STIG_VIEWER_CSV_HEADERS], importRows, importSpec, { freezeColumns: 2 }),
    tableSection("Evidence Working Notes", noteHeaders, noteRows, noteSpec),
    tableSection("STIG Rule Reference", referenceHeaders, referenceRows, referenceSpec),
  ];
  return appendSourceMetadata({ title: "STIG Viewer CSV Preparation Worksheet", description: `Working file for one STIG: ${meta.title || benchmark.label}. Its rules are listed with the 12 STIG Viewer CSV columns, plus separate evidence notes.`, sections }, options);
}

function generatePPSMPreparationWorksheet(options) {
  const ph = placeholder(options);
  const V = TEMPLATE_VOCAB.ppsm_preparation_worksheet;
  const headers = [
    "Network", "PPSM Tracking Identifier", "Service Name", "Protocol", "Transport", "Port / Range",
    "Category Assurance List Category", "VA / CLSA Reference", "Enterprise or Core Service Provider", "DMZ Whitelist Needed",
    "Record ID", "System / Boundary", "Mission or Business Need", "Source Zone / Address", "Destination Zone / Address", "Direction", "Purpose / Data Flow", "Public / External Exposure", "Encryption / Authentication", "Service Owner", "Technical POC", "Related Devices / Software", "Requested Action",
    "Review Status", "Reviewer", "Last Verified", "Risk / Exception", "Notes",
  ];
  const hint = {
    Network: "[NIPRNet | SIPRNet]",
    "PPSM Tracking Identifier": "[The tracking ID, once the registry gives one]",
    "Service Name": "[Service or application]",
    Protocol: "[Protocol name or number]",
    Transport: "[TCP | UDP | other]",
    "Port / Range": "[Single port or range]",
    "Category Assurance List Category": "[The category the Category Assurance List gives]",
    "VA / CLSA Reference": "[Vulnerability assessment or CLSA reference]",
    "Enterprise or Core Service Provider": "[Provider, if this is an enterprise or core service]",
    "DMZ Whitelist Needed": "[Yes | No | Not sure]",
    "Record ID": "[Your stable local ID]",
    "System / Boundary": "[System or authorization boundary]",
    "Mission or Business Need": "[Why the communication is necessary]",
    "Source Zone / Address": "[Zone, subnet, FQDN, or address]",
    "Destination Zone / Address": "[Zone, subnet, FQDN, or address]",
    Direction: "[Inbound | Outbound | Bidirectional | Internal]",
    "Purpose / Data Flow": "[Information exchanged and operational purpose]",
    "Public / External Exposure": "[None | DoD external | Internet | Partner]",
    "Encryption / Authentication": "[TLS, IPsec, mutual auth, certificates, or N/A]",
    "Service Owner": "[Accountable role]",
    "Technical POC": "[Technical contact or role]",
    "Related Devices / Software": "[Hardware and software baseline IDs]",
    "Requested Action": "[Register | Update | Retire | Validate]",
    "Review Status": "[Collecting | In review | Ready to enter | Entered in registry | Needs rework]",
    Reviewer: "[Reviewer role]",
    "Last Verified": "[YYYY-MM-DD]",
    "Risk / Exception": "[Risk, deviation, or exception reference]",
    Notes: "[Dependencies, restrictions, reviewer comments]",
  };
  const rows = Array.from({ length: 20 }, () => headers.map((header) => ph(hint[header] || "")));
  const reg = (extra = {}) => ({ group: "Registry information", ...extra });
  const cat = (extra = {}) => ({ group: "Assessment and category", ...extra });
  const local = (extra = {}) => ({ group: "Local working context", ...extra });
  const review = (extra = {}) => ({ group: "Review", ...extra });
  const spec = {
    Network: reg({ ...listOf(V.network, { strict: false }), width: 14, help: "The DISN guide names the NIPRNet and SIPRNet versions of the PPSM Registry." }),
    "PPSM Tracking Identifier": reg({ width: 22, help: "A DISN connection request needs a valid PPSM Tracking Identifier. Record it here after you enter the data in the registry." }),
    "Service Name": reg({ required: true, width: 24 }),
    Protocol: reg({ required: true, width: 16 }),
    Transport: reg({ ...listOf(V.transport, { strict: false }), width: 12 }),
    "Port / Range": reg({ required: true, width: 14 }),
    "Category Assurance List Category": cat({ width: 26, help: "Use the category the Category Assurance List gives for this service. Control Atlas does not assign it." }),
    "VA / CLSA Reference": cat({ width: 24, help: "A service needs a vulnerability assessment or a Component Local Services Assessment." }),
    "Enterprise or Core Service Provider": cat({ width: 26, help: "For an enterprise or core service, the provider registers it, not the receiving organization." }),
    "DMZ Whitelist Needed": cat({ ...listOf(V.yesNo), width: 14, help: "A system that must cross both the NIPRNet and the Internet may need a NIPRNet DMZ Whitelist entry." }),
    "Record ID": local({ required: true, width: 16 }),
    "System / Boundary": local({ width: 24 }),
    "Mission or Business Need": local({ width: 34 }),
    "Source Zone / Address": local({ width: 24 }),
    "Destination Zone / Address": local({ width: 24 }),
    Direction: local({ ...listOf(V.direction), width: 14 }),
    "Purpose / Data Flow": local({ width: 34 }),
    "Public / External Exposure": local({ ...listOf(V.exposure), width: 18 }),
    "Encryption / Authentication": local({ width: 28 }),
    "Service Owner": local({ width: 18 }),
    "Technical POC": local({ width: 20 }),
    "Related Devices / Software": local({ width: 26 }),
    "Requested Action": local({ ...listOf(V.requestedAction) }),
    "Review Status": review({ required: true, ...listOf(V.reviewStatus), width: 20 }),
    Reviewer: review({ width: 18 }),
    "Last Verified": review({ ...dateField() }),
    "Risk / Exception": review({ width: 26 }),
    Notes: review({ width: 32 }),
  };
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Workflow", content: "Collect here, then review, then enter the data in the authorized PPSM workflow. This worksheet does not replace the PPSM Registry or your Component's PPSM Technical Advisory Group (TAG) representative." },
    { type: "text", heading: "How to use", content: ["- Blue-green and orange columns are what public DoD guidance says the registration covers: the ports, protocols and services, the tracking identifier, the vulnerability assessment or CLSA, and the Category Assurance List.", "- The Local working context columns are information a reviewer usually needs. They are not PPSM Registry fields. The registry's own entry fields are not public, so check each one in the registry.", "- Use exact boundary, zone, address and device references. Have the service owner and a security reviewer check each row before anyone enters it.", "- This is not a PPSM submission form, a registry receipt or an import file."].join("\n") },
    tableSection("PPSM Preparation Register", headers, rows, spec, { freezeColumns: 3 }),
  ];
  return appendSourceMetadata({ title: "PPSM Preparation Worksheet", description: "Collect and review ports, protocols and services information before entering it in the authorized PPSM workflow.", sections }, options);
}

function generateProfessionalSecurityPlan(options, controls) {
  const ph = placeholder(options);
  const env = options.environment || "Not selected";
  const controlsByFamily = new Map();
  for (const control of controls) {
    const family = control.family || String(control.id).split("-")[0] || "Unclassified";
    const group = controlsByFamily.get(family) || [];
    group.push(control);
    controlsByFamily.set(family, group);
  }
  const familyRows = [...controlsByFamily.entries()].map(([family, familyControls]) => {
    const visibleIds = familyControls.slice(0, 8).map((control) => control.id);
    const remaining = familyControls.length - visibleIds.length;
    return [
      family,
      String(familyControls.length),
      `${visibleIds.join(", ")}${remaining > 0 ? `, plus ${remaining} more` : ""}`,
      "Use the Implementation Statement Worksheet for control-by-control narratives, evidence, ownership, and status.",
    ];
  });
  const inheritanceHeaders = ["Control ID", "Inheritance Type", "Provider", "Provider Evidence", "Evidence Date", "Decision Basis"];
  const inheritanceRows = blankRows(10, inheritanceHeaders.length, ph, ["[Control ID]", "[Fully inherited | Hybrid]", "[Provider]", "[CRM/CIS, package, attestation]", "[YYYY-MM-DD]", "[Agreement or review basis]"]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Document Purpose", content: "Use this companion to organize an SSP draft, expose missing decisions, and prepare content for the official system- or program-specific SSP." },
    { type: "text", heading: "Document Control", content: ph("System name | System identifier | Boundary name | Version | Prepared date | Prepared by role | Document owner | Approver role | Classification / handling | Next review date") },
    { type: "text", heading: "System and Authorization Context", content: ph(`Environment: ${env} | Mission/business purpose | Users | Operating organization | System owner | Information owner | Authorization type | Impact level | Overlays`) },
    { type: "text", heading: "Authorization Boundary", content: ph("Describe in-scope components, facilities, networks, cloud services, endpoints, external services, trust boundaries, and explicit exclusions. Reference current architecture and data-flow diagrams.") },
    { type: "text", heading: "Information and Data", content: ph("Information types | C-I-A impact values | CUI categories | PII/PHI | classification | data owners | retention and disposal") },
    { type: "text", heading: "Roles, Access, and Interconnections", content: ph("Roles and privileges | authentication | access approvals and reviews | separation of duties | connected systems | ports/protocols/services | data flows | agreements") },
    { type: "text", heading: "Selected Control Scope", content: `${controls.length} published control record${controls.length === 1 ? "" : "s"} are in the selected scope. This starter keeps the plan narrative compact and summarizes that selection by family. Use the separate Implementation Statement Worksheet for the complete control-by-control working register; do not treat this index as implementation evidence.` },
    { type: "table", heading: "Control Family Index", headers: ["Control Family", "Selected Records", "Compact ID Index", "Detailed Work Location"], rows: familyRows },
    { type: "text", heading: "Control Narrative Handoff", content: [`- Draft each selected control in the Implementation Statement Worksheet: role, mechanism, location, trigger or cadence, and result.`, `- Cite stable evidence names or identifiers. Useful evidence includes: ${EVIDENCE_TYPE_HINT}.`, "- Separate inherited provider behavior from residual local responsibility.", "- Record Not Applicable decisions with a reviewable rationale and approval basis.", "- Reconcile planned work and known gaps with the POA&M register, then bring approved summaries into the official SSP or package."].join("\n") },
    { type: "table", heading: "Inheritance Summary", headers: inheritanceHeaders, rows: inheritanceRows },
    { type: "text", heading: "Revision and Approval History", content: ph("Version | Date | Author role | Reviewer role | Approval status | Summary of changes | Next review") },
  ];
  return appendSourceMetadata({ title: "System Security Plan (SSP) Starter", description: "Compact narrative companion for organizing system context, selected control scope, inheritance, and ownership before completing an official SSP.", sections }, options);
}

function generateProfessionalReciprocityChecklist(options) {
  const ph = placeholder(options);
  const headers = ["Review Item", "Artifact / Decision Reference", "Version / Date", "Owner", "Status", "Freshness / Scope Check", "Receiving-Environment Delta", "Risk / Gap", "Required Action", "Due Date", "Decision / Disposition", "Notes"];
  const items = ["Authorization decision and terms", "System Security Plan", "Security Assessment Plan", "Security Assessment Report", "POA&M and risk acceptances", "Authorization boundary and architecture", "Control baseline and overlays", "Control implementation and inheritance", "Evidence package and test results", "Continuous monitoring results", "Interconnections and data flows", "Privacy and information-type analysis"];
  const rows = items.map((item) => [item, ph("[Stable package reference]"), ph("[Version / YYYY-MM-DD]"), ph("[Owner role]"), ph("[Not Started | In Review | Sufficient | Gap | Not Applicable]"), ph("[Current? same scope? same impact?]"), ph("[What differs locally]"), ph("[Risk or missing information]"), ph("[Action needed before reuse decision]"), ph("[YYYY-MM-DD]"), ph("[Accept | Accept with Conditions | Supplement | Reassess | Reject]"), ph("[Decision rationale and follow-up]")]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Package Context", content: ph("Granting system and authorization ID | granting AO and decision date | receiving organization | receiving boundary | impact level | data types | intended reuse decision | review lead | target decision date") },
    { type: "text", heading: "Review Standard", content: "Confirm provenance, scope, freshness, control and environment deltas, open risk, and authorization terms. Assign every gap an owner, action, and due date. The receiving Authorizing Official retains the decision." },
    tableSection("Reciprocity Review", headers, rows, {
      Status: listOf(TEMPLATE_VOCAB.reciprocity_checklist.status),
      "Decision / Disposition": listOf(TEMPLATE_VOCAB.reciprocity_checklist.disposition),
      "Due Date": dateField(),
    }),
    { type: "text", heading: "Decision Record", content: ph("Decision | Conditions | Supplemental assessment required | Accepted residual risk | Decision authority | Decision date | Re-review trigger") },
  ];
  return appendSourceMetadata({ title: "Reciprocity Package Review", description: "Structured review of authorization-package provenance, scope, freshness, deltas, risk, and receiving-organization actions.", sections }, options);
}

function escapeCsv(val) {
  if (val == null) return '""';
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

// Markdown layout limits: pipe tables wider than ~6 columns are unreadable in
// any renderer, so wide sections are restructured (constant guidance columns
// become prose, varying columns are split across narrow keyed tables).
const MD_MAX_TABLE_COLUMNS = 6;
const MD_LONG_CELL_THRESHOLD = 80;
const MD_LONG_CHUNK_COLUMNS = 4;

/** Escape a value for use inside a markdown pipe-table cell. */
export function escapeMarkdownTableCell(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

/** Flatten a value to a single prose line. */
function mdProse(value) {
  return String(value ?? "").replace(/\n/g, " ").trim();
}

function mdTableBlock(headers, rows) {
  let out = `| ${headers.map(escapeMarkdownTableCell).join(" | ")} |\n`;
  out += `| ${headers.map(() => "---").join(" | ")} |\n`;
  for (const row of rows) {
    out += `| ${row.map(escapeMarkdownTableCell).join(" | ")} |\n`;
  }
  return `${out}\n`;
}

/**
 * Render a table section as markdown. Narrow tables pass through as one pipe
 * table. Wide tables (> {@link MD_MAX_TABLE_COLUMNS} columns) are
 * restructured for readability, deterministically:
 * - single-row starters (e.g. the 20-column POA&M) become a labelled field
 *   list — prose, no table;
 * - multi-row tables emit columns whose value is identical on every row
 *   (guidance/placeholder columns) as prose bullets above the tables, then
 *   split the varying columns into keyed tables of at most
 *   {@link MD_MAX_TABLE_COLUMNS} columns: identity/status columns first, then
 *   long prompt/detail columns in narrower chunks, each table repeating the
 *   first (key) column so rows stay correlated.
 */
function formatMarkdownTableSection(sec) {
  const headers = sec.headers || [];
  const rows = (sec.rows || []).map((r) => r || []);
  if (headers.length <= MD_MAX_TABLE_COLUMNS) {
    return mdTableBlock(headers, rows);
  }

  if (rows.length <= 1) {
    const row = rows[0] || [];
    let out = "";
    headers.forEach((h, i) => {
      out += `- **${mdProse(h)}:** ${mdProse(row[i])}\n`;
    });
    return `${out}\n`;
  }

  const constantIdx = [];
  const shortIdx = [];
  const longIdx = [];
  for (let i = 1; i < headers.length; i++) {
    const first = String(rows[0][i] ?? "");
    if (rows.every((r) => String(r[i] ?? "") === first)) {
      constantIdx.push(i);
      continue;
    }
    const maxLen = rows.reduce(
      (max, r) => Math.max(max, String(r[i] ?? "").length),
      String(headers[i] ?? "").length,
    );
    (maxLen > MD_LONG_CELL_THRESHOLD ? longIdx : shortIdx).push(i);
  }

  let out = "";
  for (const i of constantIdx) {
    out += `- **${mdProse(headers[i])}:** ${mdProse(rows[0][i])}\n`;
  }
  if (constantIdx.length > 0) out += "\n";

  const emitChunks = (indices, maxColumns) => {
    for (let start = 0; start < indices.length; start += maxColumns - 1) {
      const cols = [0, ...indices.slice(start, start + maxColumns - 1)];
      out += mdTableBlock(
        cols.map((i) => headers[i]),
        rows.map((r) => cols.map((i) => r[i])),
      );
    }
  };
  emitChunks(shortIdx, MD_MAX_TABLE_COLUMNS);
  emitChunks(longIdx, MD_LONG_CHUNK_COLUMNS);
  if (shortIdx.length === 0 && longIdx.length === 0) {
    // Everything but the key column was constant: still emit the key column.
    out += mdTableBlock([headers[0]], rows.map((r) => [r[0]]));
  }
  return out;
}

function formatMarkdown(doc) {
  let out = `# ${doc.title}\n\n${doc.description}\n\n> **Disclaimer:** ${DISCLAIMER}\n\n> **Review status:** ${STARTER_DOCUMENT_REVIEW_NOTICE}\n\n`;
  for (const sec of doc.sections) {
    out += `## ${sec.heading}\n\n`;
    if (sec.type === "text") {
      out += `${sec.content}\n\n`;
    } else if (sec.type === "table") {
      out += formatMarkdownTableSection(sec);
    }
  }
  return out;
}

function formatCsv(doc) {
  const table = doc.sections.find((s) => s.type === "table");
  // Data first: column headers land on row 1 so the export imports cleanly into
  // a spreadsheet without a manual header-row fix. Title, disclaimer, and the
  // text/metadata sections follow as `#`-prefixed footer comment lines.
  let out = "";
  if (table) {
    out += `${table.headers.map(escapeCsv).join(",")}\n`;
    for (const row of table.rows) {
      out += `${row.map(escapeCsv).join(",")}\n`;
    }
  } else {
    out += "Section,Content\n";
    for (const sec of doc.sections) {
      if (sec.type === "text") {
        out += `${escapeCsv(sec.heading)},${escapeCsv(sec.content)}\n`;
      }
    }
  }
  out += `# ${doc.title}\n`;
  out += `# Disclaimer: ${DISCLAIMER.replace(/\n/g, " ")}\n`;
  out += `# Review status: ${STARTER_DOCUMENT_REVIEW_NOTICE.replace(/\n/g, " ")}\n`;
  for (const sec of doc.sections) {
    if (sec.type === "text") {
      out += `# ${sec.heading}: ${String(sec.content).replace(/\n/g, " ")}\n`;
    }
  }
  return out;
}

function formatJson(doc) {
  const output = {
    title: doc.title,
    description: doc.description,
    disclaimer: DISCLAIMER,
    reviewStatus: STARTER_DOCUMENT_REVIEW_NOTICE,
    sections: doc.sections,
  };
  return JSON.stringify(output, null, 2);
}

function formatYaml(doc) {
  return stringifyYaml({
    title: doc.title,
    description: doc.description,
    disclaimer: DISCLAIMER,
    reviewStatus: STARTER_DOCUMENT_REVIEW_NOTICE,
    sections: doc.sections,
  });
}

/**
 * Central control-collection path shared by ALL templates. Filters to
 * control/control_enhancement nodes for the requested catalog and excludes
 * withdrawn controls (SP 800-53 lifecycle_status: 'withdrawn') so retired
 * control IDs (AC-13, SA-12, SA-13, ...) never appear in generated artifacts.
 *
 * @param {any[]} nodes
 * @param {string} catalogId
 * @returns {any[]}
 */
function collectCatalogControls(nodes, catalogId) {
  return (nodes || []).filter(
    (n) =>
      (n.node_type === "control" || n.node_type === "control_enhancement") &&
      n.metadata?.catalog_id === catalogId &&
      n.lifecycle_status !== "withdrawn",
  );
}

/**
 * When a selected framework catalog has no control/control_enhancement nodes
 * of its own (e.g. FedRAMP Rev. 5, whose catalog only carries `baseline`
 * nodes), resolve the member NIST 800-53 controls via the catalog's
 * baseline-membership edges instead of emitting a placeholder row.
 *
 * Edge shape observed in data/generated/edges.json: baseline nodes are
 * `${catalogId}:${baselineItemId}` (e.g. "fedramp-rev5:LOW"); each has an
 * applicability `selects` edge with `source_node_id` = the baseline node and
 * `target_node_id` = the member `nist-800-53:<CONTROL_ID>` control node.
 * Membership is unioned across every baseline node in the catalog.
 *
 * @param {any} dataset
 * @param {string} catalogId
 * @returns {any[]}
 */
function resolveControlsViaBaselineEdges(dataset, catalogId) {
  const nodes = dataset?.nodes || [];
  const edges = dataset?.edges || [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const baselineNodeIds = new Set(
    nodes
      .filter((n) => n.node_type === "baseline" && n.metadata?.catalog_id === catalogId)
      .map((n) => n.id),
  );
  if (baselineNodeIds.size === 0) return [];

  const memberNodeIds = new Set();
  for (const edge of edges) {
    if (
      edge.relationship_class !== "applicability" ||
      edge.relationship_type !== "selects"
    ) continue;
    if (baselineNodeIds.has(edge.source_node_id)) {
      memberNodeIds.add(edge.target_node_id);
    } else if (baselineNodeIds.has(edge.target_node_id)) {
      memberNodeIds.add(edge.source_node_id);
    }
  }

  const memberControls = [...memberNodeIds]
    .map((id) => nodeById.get(id))
    .filter(
      (n) =>
        n &&
        (n.node_type === "control" || n.node_type === "control_enhancement") &&
        n.lifecycle_status !== "withdrawn",
    );

  memberControls.sort((a, b) => {
    const aId = a.metadata?.item_id || a.id;
    const bId = b.metadata?.item_id || b.id;
    return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: "base" });
  });

  return memberControls;
}

/**
 * Build a control → CCI → STIG/SRG cross-reference index from the graph edges.
 *
 * The bridge is the DISA CCI list (STIG scope memory): a NIST 800-53 control
 * `maps_to` one or more `disa-cci:*` requirement nodes, and each STIG rule /
 * SRG requirement `references` the CCIs it satisfies. Walking control → CCI →
 * STIG lets a template cite the real rule IDs and CCI numbers instead of
 * leaving placeholder cells.
 *
 * @param {{ nodes?: any[], edges?: any[] }} dataset
 * @returns {{ controlToCci: Map<string, Set<string>>, cciToStig: Map<string, Set<string>>, ruleToCci: Map<string, Set<string>>, cciToControl: Map<string, Set<string>>, byId: Map<string, any>, assessmentByControl: Map<string, any> }}
 */
function buildControlCrossRefIndex(dataset) {
  const nodes = dataset?.nodes || [];
  const edges = dataset?.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isCci = (id) => typeof id === "string" && id.startsWith("disa-cci:");
  const isStigNode = (n) =>
    n && (n.node_type === "stig_rule" || n.node_type === "srg_requirement");

  /** @type {Map<string, Set<string>>} */
  const controlToCci = new Map();
  /** @type {Map<string, Set<string>>} */
  const cciToStig = new Map();
  /** @type {Map<string, Set<string>>} */
  const ruleToCci = new Map();
  /** @type {Map<string, Set<string>>} */
  const cciToControl = new Map();

  for (const edge of edges) {
    if (edge.relationship_type === "maps_to") {
      const { source_node_id: s, target_node_id: t } = edge;
      let cci;
      let ctrl;
      if (isCci(s)) {
        cci = s;
        ctrl = t;
      } else if (isCci(t)) {
        cci = t;
        ctrl = s;
      }
      if (cci && ctrl) {
        if (!controlToCci.has(ctrl)) controlToCci.set(ctrl, new Set());
        controlToCci.get(ctrl).add(cci);
        if (!cciToControl.has(cci)) cciToControl.set(cci, new Set());
        cciToControl.get(cci).add(ctrl);
      }
    } else if (edge.relationship_type === "references") {
      const { source_node_id: s, target_node_id: t } = edge;
      let cci;
      let stig;
      if (isCci(s) && isStigNode(byId.get(t))) {
        cci = s;
        stig = t;
      } else if (isCci(t) && isStigNode(byId.get(s))) {
        cci = t;
        stig = s;
      }
      if (cci && stig) {
        if (!cciToStig.has(cci)) cciToStig.set(cci, new Set());
        cciToStig.get(cci).add(stig);
        if (!ruleToCci.has(stig)) ruleToCci.set(stig, new Set());
        ruleToCci.get(stig).add(cci);
      }
    }
  }

  /** @type {Map<string, any>} */
  const assessmentByControl = new Map();
  for (const edge of edges) {
    if (edge.relationship_type !== "assesses") continue;
    const procedure = byId.get(edge.source_node_id);
    if (procedure?.node_type === "assessment_procedure") {
      assessmentByControl.set(edge.target_node_id, procedure);
    }
  }

  return { controlToCci, cciToStig, ruleToCci, cciToControl, byId, assessmentByControl };
}

/**
 * Resolve the real CCI numbers and STIG/SRG rule IDs cross-referenced by a
 * control node, using the index from {@link buildControlCrossRefIndex}.
 *
 * @param {ReturnType<typeof buildControlCrossRefIndex>} index
 * @param {string} controlNodeId
 * @returns {{ cciIds: string[], stigIds: string[], ruleIds: string[], ruleCount: number }}
 */
function crossRefForControl(index, controlNodeId) {
  const idOf = (nodeId) => index.byId.get(nodeId)?.metadata?.item_id || nodeId;
  const cciNodeIds = [...(index.controlToCci.get(controlNodeId) || [])];
  const stigNodeIds = new Set();
  for (const cci of cciNodeIds) {
    for (const stig of index.cciToStig.get(cci) || []) stigNodeIds.add(stig);
  }
  const sortIds = (arr) =>
    arr.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const ruleIds = new Set();
  for (const nodeId of stigNodeIds) {
    const ruleId = index.byId.get(nodeId)?.metadata?.rule_id;
    if (ruleId) ruleIds.add(String(ruleId));
  }
  return {
    cciIds: sortIds(cciNodeIds.map(idOf)),
    stigIds: sortIds([...stigNodeIds].map(idOf)),
    ruleIds: sortIds([...ruleIds]),
    ruleCount: stigNodeIds.size,
  };
}

/**
 * Collect the control node IDs that belong to a named baseline (Low / Moderate
 * / High / Privacy / LI-SaaS). Baseline membership lives in `baseline` nodes
 * (e.g. `nist-800-53b:LOW`, `fedramp-rev5:MODERATE`) linked to their member
 * controls with applicability `selects` edges. Baseline nodes are matched by item_id,
 * preferring the catalog that fits the selected source context so a NIST 800-53
 * template scopes to 800-53B membership rather than FedRAMP's.
 *
 * @param {{ nodes?: any[], edges?: any[] }} dataset
 * @param {string} baselineItemId
 * @param {string} sourceCatalogId
 * @returns {Set<string>}
 */
function collectBaselineMemberIds(dataset, baselineItemId, sourceCatalogId) {
  const nodes = dataset?.nodes || [];
  const edges = dataset?.edges || [];
  const target = String(baselineItemId).toUpperCase();

  const baselineNodes = nodes.filter(
    (n) =>
      n.node_type === "baseline" &&
      String(n.metadata?.item_id || "").toUpperCase() === target,
  );
  if (baselineNodes.length === 0) return new Set();

  // Prefer baseline nodes from the selected source context's catalog; otherwise fall back
  // to the canonical NIST SP 800-53B baselines.
  const sameCatalog = baselineNodes.filter(
    (n) => n.metadata?.catalog_id === sourceCatalogId,
  );
  const nist80053b = baselineNodes.filter(
    (n) => n.metadata?.catalog_id === "nist-800-53b",
  );
  const scoped =
    sameCatalog.length > 0 ? sameCatalog : nist80053b.length > 0 ? nist80053b : baselineNodes;
  const baselineNodeIds = new Set(scoped.map((n) => n.id));

  const members = new Set();
  for (const edge of edges) {
    if (
      edge.relationship_class !== "applicability" ||
      edge.relationship_type !== "selects"
    ) continue;
    if (baselineNodeIds.has(edge.source_node_id)) {
      members.add(edge.target_node_id);
    } else if (baselineNodeIds.has(edge.target_node_id)) {
      members.add(edge.source_node_id);
    }
  }
  return members;
}

/**
 * @param {any} node
 * @returns {string}
 */
function familyOf(node) {
  return node?.metadata?.family || node?.metadata?.control_family || "";
}

/**
 * @param {any} options
 * @param {{ nodes?: any[], edges?: any[], sources?: { sources?: any[] } }} dataset
 */
/**
 * Build the structured template document (title + description + typed
 * sections) without serializing it. Shared by the string formatters
 * (markdown/csv/json/yaml via {@link generateTemplate}) and the client-side
 * office serializers (xlsx/docx), so every format renders from one source of
 * truth.
 *
 * @param {any} options
 * @param {any} dataset
 * @returns {{ doc: any, templateType: string }}
 */
export function buildTemplateDocument(options, dataset) {
  const frameworkSourceId = options.framework
    ? dataset?.nodes?.find(
        (node) => node.metadata?.catalog_id === options.framework,
      )?.source_id
    : "";
  // A program's own sources are listed only when that program is selected;
  // a registry lists them for every template that can serve that program.
  const programSelected = /^fedramp/i.test(String(options.framework || ""));
  const sourceRefs = [
    frameworkSourceId,
    ...(options.sourceRefs || []),
  ].filter(
    (sourceId, index, values) =>
      sourceId &&
      values.indexOf(sourceId) === index &&
      (programSelected || !/^fedramp/i.test(String(sourceId))),
  );
  const normalized = {
    ...options,
    includeSourceFootnotes: true,
    includePlaceholders: options.includePlaceholders !== false,
    includeImplementationPrompts: options.includeImplementationPrompts !== false,
    includeEvidenceExpectations: options.includeEvidenceExpectations !== false,
    includeInheritancePrompts: options.includeInheritancePrompts !== false,
    includeReciprocityPrompts: options.includeReciprocityPrompts !== false,
    includeStigReferences: options.includeStigReferences === true,
    includeEnhancements: options.includeEnhancements === true,
    environment: options.environment || "",
    sourceRefs,
    sources: options.sources || dataset?.sources || [],
  };

  let controls = [];
  if (normalized.framework) {
    // Resolve the raw control nodes for the framework, either directly or (for
    // catalogs that only carry `baseline` nodes, e.g. fedramp-rev5) via
    // baseline-membership edges.
    let controlNodes = collectCatalogControls(dataset.nodes, normalized.framework);
    let resolvedViaBaselineEdges = false;
    if (controlNodes.length === 0) {
      controlNodes = resolveControlsViaBaselineEdges(dataset, normalized.framework);
      resolvedViaBaselineEdges = controlNodes.length > 0;
    }

    if (controlNodes.length === 0) {
      throw new Error(
        `No published control data is available for source context "${normalized.framework}". No document was generated.`,
      );
    } else {
      // Optional baseline filter (Low / Moderate / High / ...).
      let baselineApplied = false;
      if (normalized.baseline) {
        const memberIds = collectBaselineMemberIds(
          dataset,
          normalized.baseline,
          normalized.framework,
        );
        if (memberIds.size > 0) {
          controlNodes = controlNodes.filter((n) => memberIds.has(n.id));
          baselineApplied = true;
        } else {
          throw new Error(
            `Baseline "${normalized.baseline}" is not a published selection under source context "${normalized.framework}". No document was generated.`,
          );
        }
      }
      // Without a baseline scoping the set, the full catalog's ~900 control
      // enhancements (item_id "AC-2.1" style) drown the base controls — drop
      // them unless explicitly requested. A baseline (including catalogs
      // resolved via baseline-membership edges) legitimately names specific
      // enhancements, so its members pass through untouched.
      if (!baselineApplied && !resolvedViaBaselineEdges && !normalized.includeEnhancements) {
        controlNodes = controlNodes.filter(
          (n) => !String(n.metadata?.item_id || n.id).includes("."),
        );
      }
      // Optional control-family filter (matched case-insensitively against the
      // family name or the control ID prefix, e.g. "Access Control" or "AC").
      if (normalized.controlFamily) {
        const wanted = String(normalized.controlFamily).toLowerCase();
        controlNodes = controlNodes.filter((n) => {
          const fam = familyOf(n).toLowerCase();
          const prefix = String(n.metadata?.item_id || n.id)
            .split("-")[0]
            .toLowerCase();
          return fam === wanted || prefix === wanted || fam.includes(wanted);
        });
        if (controlNodes.length === 0) {
          throw new Error(
            `Control family "${normalized.controlFamily}" is not available under source context "${normalized.framework}". No document was generated.`,
          );
        }
      }

      // Natural (numeric-aware) order so control IDs read AC-1, AC-2, AC-10 —
      // not the lexicographic AC-1, AC-10, AC-2 of the raw catalog. Item IDs
      // already encode the family prefix, so this also keeps families grouped.
      controlNodes.sort((a, b) =>
        String(a.metadata?.item_id || a.id).localeCompare(
          String(b.metadata?.item_id || b.id),
          undefined,
          { numeric: true, sensitivity: "base" },
        ),
      );

      controls = controlNodes.map((n) => ({
        nodeId: n.id,
        id: n.metadata?.item_id || n.id,
        title: n.metadata?.title || n.label || n.id,
        family: familyOf(n),
        description: n.metadata?.description || "",
        isEnhancement:
          n.node_type === "control_enhancement" ||
          String(n.metadata?.item_id || n.id).includes("."),
      }));
    }
  }
  if (controls.length === 0) {
    controls = [{ nodeId: null, id: "[Control ID]", title: "[Control Title]", family: "[Family]" }];
  }

  // Cross-reference data belongs in the dedicated evidence matrix, not the
  // compact SSP narrative starter. Build it only for that working matrix.
  const needsCrossRef = [
    "evidence_expectation_matrix",
    "implementation_statement_worksheet",
    "assessment_planning_worksheet",
    "stig_evidence_checklist",
  ].includes(normalized.templateType);
  const crossRef = needsCrossRef ? buildControlCrossRefIndex(dataset) : null;

  let doc;
  switch (normalized.templateType) {
    case "security_plan_starter":
      doc = generateProfessionalSecurityPlan(normalized, controls);
      break;
    case "implementation_statement_worksheet":
      doc = generateProfessionalImplementationWorksheet(normalized, controls, crossRef);
      break;
    case "evidence_expectation_matrix":
      doc = generateProfessionalEvidenceMatrix(normalized, controls, crossRef);
      break;
    case "stig_evidence_checklist":
      doc = generateProfessionalSTIGWorksheet(normalized, resolveStigBenchmark(dataset, normalized.stig), crossRef);
      break;
    case "inheritance_worksheet":
      doc = generateProfessionalInheritanceWorksheet(normalized, controls);
      break;
    case "reciprocity_checklist":
      doc = generateProfessionalReciprocityChecklist(normalized);
      break;
    case "poam_starter":
      doc = generateProfessionalPOAM(normalized);
      break;
    case "assessment_planning_worksheet":
      doc = generateProfessionalAssessmentPlan(normalized, controls, crossRef);
      break;
    case "conmon_calendar":
      doc = generateProfessionalConMonCalendar(normalized);
      break;
    case "hardware_baseline":
      doc = generateHardwareBaseline(normalized);
      break;
    case "software_baseline":
      doc = generateSoftwareBaseline(normalized);
      break;
    case "ppsm_preparation_worksheet":
      doc = generatePPSMPreparationWorksheet(normalized);
      break;
    default:
      doc = generateProfessionalSecurityPlan(normalized, controls);
  }

  return {
    doc,
    templateType: normalized.templateType,
  };
}

/**
 * Compose the download filename for a generated template.
 *
 * @param {string} templateType
 * @param {string} extension
 * @returns {string}
 */
export function templateFilename(templateType, extension, now = new Date()) {
  // The viewer's calendar date, not UTC. This audience is US-based, so
  // toISOString() stamped every document generated after 20:00 Eastern with
  // tomorrow's date - and on a POA&M, dates are evidence.
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${templateType.replace(/_/g, "-")}-${date}.${extension}`;
}

/**
 * Serialize a template to one of the text/data formats (markdown, csv, json,
 * yaml). Office formats (xlsx/docx) are rendered client-side from
 * {@link buildTemplateDocument} — they do not flow through here because their
 * payload is binary, not a string.
 */
export function generateTemplate(options, dataset) {
  const { doc, templateType } = buildTemplateDocument(
    options,
    dataset,
  );

  let content;
  let extension;
  let mimeType;

  switch (options.format) {
    case "csv":
      content = formatCsv(doc);
      extension = "csv";
      mimeType = "text/csv";
      break;
    case "json":
      content = formatJson(doc);
      extension = "json";
      mimeType = "application/json";
      break;
    case "yaml":
      content = formatYaml(doc);
      extension = "yaml";
      mimeType = "text/yaml";
      break;
    case "markdown":
    default:
      content = formatMarkdown(doc);
      extension = "md";
      mimeType = "text/markdown";
      break;
  }

  return {
    content,
    filename: templateFilename(templateType, extension),
    mimeType,
  };
}
