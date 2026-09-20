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
import { dateField, listOf, tableSection, TEMPLATE_VOCAB, TRUE_FALSE } from './template-columns.mjs';

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
    basis: "DISA STIG Viewer 3.x User Guide V1R7 (13 Feb 2026), section 5.6.3.",
    limit: "Open the CSV in your STIG Viewer version to check it. Control Atlas has not tested an import.",
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
    summary: "Collects the information the PPSM process asks for. It is not an interchange schema.",
    basis: "DoDI 8551.01 and public DISA PPSM Registry training.",
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

function generateProfessionalImplementationWorksheet(options, controls) {
  const ph = placeholder(options);
  const headers = ["acronym", "Control Title", "implementationStatus", "controlDesignation", "responsibleEntities", "implementationNarrative", "commonControlProvider", "naJustification", "estimatedCompletionDate", "Evidence References", "slcmFrequency", "slcmMethod", "slcmReporting", "Review Notes"];
  const rows = controls.map((c) => [c.id, c.title, ph("[Planned | Implemented | Inherited | Not Applicable | Manually Inherited]"), ph("[Common | System-Specific | Hybrid]"), ph("[Responsible organizations and roles]"), ph("[Implementation, operation, scope, cadence, and result; 2,000 chars max for eMASS alignment]"), ph("[DoD | Component | Enclave, when inherited]"), ph("[Required when Not Applicable]"), ph("[YYYY-MM-DD; eMASS API uses Unix time]"), ph("[Artifact IDs, paths, or links]"), ph("[Constantly | Daily | Weekly | Monthly | Quarterly | Semi-Annually | Annually | Every Two Years | Every Three Years | Undetermined]"), ph("[Automated | Semi-Automated | Manual | Undetermined]"), ph("[How results are reported]"), ph("[Reviewer, date, decision, and follow-up]")]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Completion Standard", content: ["- Write a testable narrative: who performs the action, what mechanism is used, where it applies, when it runs, and what record it creates.", "- Separate inherited provider behavior from the customer or system team's residual responsibility.", "- Cite evidence by stable identifier and record the evidence review cadence.", "- Fields using camelCase mirror public eMASS API v3.22 control schema names for preparation only."].join("\n") },
    tableSection("Implementation Statements", headers, rows, {
      implementationStatus: listOf(TEMPLATE_VOCAB.implementation_statement_worksheet.implementationStatus),
      controlDesignation: listOf(TEMPLATE_VOCAB.implementation_statement_worksheet.controlDesignation),
      estimatedCompletionDate: dateField({ help: "Enter a date, for example 2026-09-30. eMASS stores Unix time; convert when you enter it there." }),
    }),
  ];
  return appendSourceMetadata({ title: "Control Implementation Statement Worksheet", description: "Operational drafting and review worksheet with public eMASS API v3.22-aligned preparation fields.", sections }, options);
}

function generateProfessionalEvidenceMatrix(options, controls, crossRef) {
  const ph = placeholder(options);
  const headers = ["Control ID", "Control Title", "Evidence Type", "Artifact Name / ID", "Evidence Owner", "Collection Method", "Collection Cadence", "Evidence Date / Period", "Repository / Location", "Confidence", "Review Status", "Assessor Notes"];
  const referenceRows = [];
  const rows = controls.map((c) => {
    const refs = crossRef && c.nodeId ? crossRefForControl(crossRef, c.nodeId) : null;
    referenceRows.push([
      c.id,
      c.title,
      refs?.cciIds.length ? cappedJoin(refs.cciIds, CROSS_REF_CAP) : "N/A",
      refs?.stigIds.length ? cappedJoin(refs.stigIds, CROSS_REF_CAP) : "N/A",
    ]);
    return [c.id, c.title, ph("[Evidence type]"), ph("[Stable artifact name or ID]"), ph("[Owner role]"), ph("[Export | Query | Screenshot | Interview | Observation]"), ph("[Continuous | Monthly | Quarterly | Annual | Event-driven]"), ph("[YYYY-MM-DD or period]"), ph("[Repository, ticket, or approved link]"), ph("[High | Medium | Low]"), ph("[Needed | Requested | Received | Reviewed | Accepted | Gap]"), ph("[Scope, sufficiency, sample, exceptions, follow-up]")];
  });
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Evidence Quality Standard", content: [`- Use specific, reproducible artifacts. Candidate types: ${EVIDENCE_TYPE_HINT}.`, "- Record owner, cadence, covered period, collection method, and location so another reviewer can retrieve the same evidence.", "- Confidence is a triage signal, not an assessor decision. Mark Low when scope, freshness, integrity, or traceability is uncertain.", "- Use Assessor Notes to record sampling, exceptions, corroboration, and required follow-up."].join("\n") },
    tableSection("Evidence Expectations", headers, rows, {
      Confidence: listOf(TEMPLATE_VOCAB.evidence_expectation_matrix.confidence),
      "Review Status": listOf(TEMPLATE_VOCAB.evidence_expectation_matrix.reviewStatus),
    }),
    { type: "table", heading: "Control Cross-Reference Index", headers: ["Control ID", "Control Title", "Related CCIs", "Related STIG/SRG"], rows: referenceRows },
  ];
  return appendSourceMetadata({ title: "Evidence Expectation Matrix", description: "Evidence planning and readiness matrix with ownership, freshness, confidence, and assessor-facing review notes.", sections }, options);
}

function generateProfessionalSTIGWorksheet(options) {
  const ph = placeholder(options);
  const headers = ["Benchmark ID", "Rule ID", "Status", "Comments", "Finding Details", "Severity Override", "Severity Override Reason", "FQDN", "IP Address", "MAC Address", "Host Name", "Technology Area"];
  const rows = blankRows(20, headers.length, ph, ["[Benchmark ID]", "[SV-..._rule]", "[Not Reviewed | Open | Not a Finding | Not Applicable]", "[Implementation context or reviewer remarks]", "[Observed condition and test result]", "[Low | Medium | High]", "[Authorized justification for override]", "[Fully qualified domain name]", "[IP address]", "[MAC address]", "[Host name]", "[Choose a Technology Area]"]);
  const evidenceHeaders = ["Rule ID", "Evidence Artifact", "Validation Method", "Evidence Owner", "Evidence Date", "Review Notes"];
  const evidenceRows = blankRows(20, evidenceHeaders.length, ph, ["[SV-..._rule]", "[Artifact name or ID]", "[Export | Screenshot | Query | Interview]", "[Owner role]", "[YYYY-MM-DD]", "[Scope, sufficiency, follow-up]"]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Import Contract", content: "The first table preserves the exact 12 CSV headers documented by the DISA STIG Viewer 3.x User Guide V1R7. Keep the header names and order unchanged. Save only the first table as CSV for import, then validate it in the target STIG Viewer version." },
    { type: "text", heading: "Field Guide", content: ["- Benchmark ID: benchmark identifier expected by the target checklist.", "- Rule ID: STIG rule identifier, normally the SV-..._rule value.", "- Status: use only values accepted by the target viewer and benchmark workflow.", "- Comments: implementation context or reviewer remarks; Finding Details: observed condition and test result.", "- Severity Override and Reason: populate together only when an authorized override applies.", "- FQDN, IP Address, MAC Address, Host Name, and Technology Area identify the assessed target.", "- Keep evidence references in the second table so the import table remains contract-clean."].join("\n") },
    tableSection("STIG Viewer CSV Import Rows", headers, rows, {
      Status: listOf(TEMPLATE_VOCAB.stig_evidence_checklist.status),
      "Severity Override": listOf(TEMPLATE_VOCAB.stig_evidence_checklist.severityOverride),
      "Technology Area": listOf(TEMPLATE_VOCAB.stig_evidence_checklist.technologyArea),
    }),
    tableSection("Evidence Working Notes", evidenceHeaders, evidenceRows, {
      "Evidence Date": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "STIG Viewer CSV Preparation Worksheet", description: "STIG Viewer CSV columns from the V1R7 user guide, paired with separate evidence working notes.", sections }, options);
}

function generateProfessionalInheritanceWorksheet(options, controls) {
  const ph = placeholder(options);
  const headers = ["Control ID", "Control Title", "Inheritance Decision", "Provider", "Provider Service / Component", "Provider Evidence", "Evidence Version / Date", "Evidence Freshness Status", "Local Responsibility", "Local Delta", "Validation Method", "Decision Basis", "Decision Owner", "Review Date", "Notes / Gaps"];
  const rows = controls.map((c) => [c.id, c.title, ph("[Fully Inherited | Hybrid | System-Specific | Not Applicable]"), ph("[Provider]"), ph("[Service or component]"), ph("[CRM/CIS, package, report, attestation, contract]"), ph("[Version and YYYY-MM-DD]"), ph("[Current | Aging | Expired | Unknown]"), ph("[What the local team implements, configures, monitors, or verifies]"), ph("[Difference from provider baseline]"), ph("[Document review | Test | Interview | Attestation]"), ph("[Contract, package, agreement, or architecture decision]"), ph("[Accountable role]"), ph("[YYYY-MM-DD]"), ph("[Assumptions, limitations, evidence gaps]")]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Decision Standard", content: ["- Do not mark a control inherited solely because a cloud or shared service is used.", "- Identify the provider assertion, its version and date, and the exact responsibility retained locally.", "- Record local configuration or operating differences as deltas with separate evidence.", "- Revisit aging, expired, or unknown provider evidence before relying on it in an authorization package."].join("\n") },
    tableSection("Inheritance Decision Log", headers, rows, {
      "Inheritance Decision": listOf(TEMPLATE_VOCAB.inheritance_worksheet.decision),
      "Evidence Freshness Status": listOf(TEMPLATE_VOCAB.inheritance_worksheet.freshness),
      "Review Date": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "Inheritance Worksheet", description: "Decision log for provider claims, local responsibilities, evidence freshness, deltas, and review ownership.", sections }, options);
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

function generateProfessionalPOAM(options) {
  const ph = placeholder(options);
  const headers = ["externalUid", "status", "vulnerabilityDescription", "sourceIdentifyingVulnerability", "controlAcronym", "assessmentProcedure", "securityChecks", "severity", "rawSeverity", "relevanceOfThreat", "likelihood", "impact", "impactDescription", "residualRiskLevel", "pocOrganization", "Point of Contact", "resources", "Planned Remediation", "Milestones with Completion Dates", "Original Detection Date", "scheduledCompletionDate", "completionDate", "recommendations", "mitigations", "Evidence Needed for Closure", "Risk Acceptance / Deviation Reference", "comments"];
  const rows = blankRows(20, headers.length, ph, ["[Stable external tracking ID]", "[Ongoing | Risk Accepted | Completed | Not Applicable]", "[Plain-language weakness; 2,000 chars max for eMASS alignment]", "[Scan, assessment, audit, incident, or other source]", "[Control acronym]", "[Assessment procedure]", "[STIG/SRG rules or checks]", "[Very Low | Low | Moderate | High | Very High]", "[Scanner severity]", "[Very Low | Low | Moderate | High | Very High]", "[Very Low | Low | Moderate | High | Very High]", "[Very Low | Low | Moderate | High | Very High]", "[Mission/business impact]", "[Very Low | Low | Moderate | High | Very High]", "[Accountable organization]", "[Role or contact]", "[People, funding, tools, dependencies]", "[Corrective action or compensating control]", "[Milestone | owner | target date | status; repeat as needed]", "[YYYY-MM-DD]", "[YYYY-MM-DD; eMASS API uses Unix time]", "[YYYY-MM-DD when completed]", "[Recommended corrective action]", "[Current mitigations]", "[Retest or artifact required to close]", "[Approval memo, exception, or deviation ID]", "[Decision rationale, closure notes, or blockers]"]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Operating Rules", content: ["- Assign a stable externalUid and preserve it across updates.", "- Describe the observed weakness separately from risk, remediation, and mitigation.", "- Break remediation into dated milestones with owners; reconcile the final milestone with scheduledCompletionDate.", "- Close only after the required evidence or retest is reviewed. Record approval references for risk acceptance or deviations.", "- camelCase headers mirror public eMASS API v3.22 POA&M fields where available; companion headers add operational detail."].join("\n") },
    tableSection("POA&M Working Register", headers, rows, {
      status: listOf(TEMPLATE_VOCAB.poam_starter.status),
      severity: listOf(TEMPLATE_VOCAB.poam_starter.riskLevel),
      relevanceOfThreat: listOf(TEMPLATE_VOCAB.poam_starter.riskLevel),
      likelihood: listOf(TEMPLATE_VOCAB.poam_starter.riskLevel),
      impact: listOf(TEMPLATE_VOCAB.poam_starter.riskLevel),
      residualRiskLevel: listOf(TEMPLATE_VOCAB.poam_starter.riskLevel),
      "Original Detection Date": dateField(),
      scheduledCompletionDate: dateField({ help: "Enter a date, for example 2026-09-30. eMASS stores Unix time; convert when you enter it there." }),
      completionDate: dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "POA&M Working Register", description: "Operational weakness and remediation register with public eMASS API v3.22-aligned preparation fields.", sections }, options);
}

function generateProfessionalAssessmentPlan(options, controls) {
  const ph = placeholder(options);
  const headers = ["Control ID", "Control Title", "Assessment Objective / Scope", "Assessment Method", "Assessor Role", "Evidence to Request", "Sampling Approach", "Tool / Procedure", "Target Start", "Target Complete", "Status", "Result / Test Success", "Finding / POA&M Reference", "Evidence Location", "Review Notes"];
  const rows = controls.map((c) => [c.id, c.title, ph("[Requirement, component, location, population, exclusions]"), ph("[Examine | Interview | Test | combination]"), ph("[Lead and supporting assessor roles]"), ph("[Specific artifacts and covered period]"), ph("[Population, sample size, selection basis]"), ph("[Procedure ID, scanner, script, or manual method]"), ph("[YYYY-MM-DD]"), ph("[YYYY-MM-DD]"), ph("[Planned | Ready | In Progress | Blocked | Complete]"), ph("[Pass | Fail | Inconclusive | Not Tested]"), ph("[Finding ID, externalUid, or N/A]"), ph("[Repository, ticket, or approved link]"), ph("[Constraints, deviations, retest, follow-up]")]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Planning Standard", content: ["- Define the assessment objective, in-scope components, covered period, exclusions, and sampling before scheduling work.", "- Tie each method to a procedure, tool, or repeatable manual step and identify the requested evidence.", "- Record the assessor role, dates, status, result, evidence location, and finding or POA&M reference.", "- Result / Test Success corresponds conceptually to the public eMASS v3.22 test-results success flag; this worksheet is not an API payload."].join("\n") },
    tableSection("Assessment Plan", headers, rows, {
      "Assessment Method": listOf(TEMPLATE_VOCAB.assessment_planning_worksheet.method),
      Status: listOf(TEMPLATE_VOCAB.assessment_planning_worksheet.status),
      "Result / Test Success": listOf(TEMPLATE_VOCAB.assessment_planning_worksheet.result),
      "Target Start": dateField(),
      "Target Complete": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "Assessment Planning Worksheet", description: "Assessment work plan covering scope, methods, evidence, sampling, tooling, ownership, schedule, results, and follow-up.", sections }, options);
}

function generateProfessionalConMonCalendar(options) {
  const ph = placeholder(options);
  const headers = ["Activity", "Control References", "Deliverable / Evidence", "Collection Method", "Frequency", "Owner", "Reviewer / Recipient", "Evidence Location", "Next Due", "Completed Date", "Status", "Result / Threshold", "Escalation / Follow-up", "Notes"];
  const activities = [
    ["Vulnerability scanning", "RA-5", "Authenticated scan results and remediation intake", "Approved scanner", "Monthly"],
    ["Account and privilege review", "AC-2; AC-6", "Review record and access removals", "Identity report plus owner attestation", "Quarterly"],
    ["Configuration compliance review", "CM-6", "STIG/configuration results and exceptions", "Automated scan plus manual validation", "Quarterly"],
    ["Audit log review", "AU-6", "Review record, alerts, and escalations", "SIEM query and analyst review", "Weekly"],
    ["Asset inventory reconciliation", "CM-8", "Hardware/software delta and disposition", "Inventory export and source reconciliation", "Quarterly"],
    ["POA&M review", "CA-5", "Updated milestones, overdue actions, and decisions", "Register review", "Monthly"],
    ["Contingency plan exercise", "CP-4", "Exercise results and corrective actions", "Tabletop or functional exercise", "Annual"],
    ["Incident response exercise", "IR-3", "Exercise record and lessons learned", "Tabletop or functional exercise", "Annual"],
    ["Security training review", "AT-2", "Completion and delinquency report", "Learning-system report", "Annual"],
    ["Control assessment / penetration test", "CA-2; CA-8", "Assessment results and findings", "Independent assessment", "Annual"],
  ];
  const rows = activities.map(([activity, refs, deliverable, method, frequency]) => [activity, refs, deliverable, method, frequency, ph("[Owner role]"), ph("[Reviewer or reporting recipient]"), ph("[Repository or approved link]"), ph("[YYYY-MM-DD]"), ph("[YYYY-MM-DD]"), ph("[Planned | In Progress | Complete | Late | Blocked]"), ph("[Result and threshold breach]"), ph("[Ticket, POA&M, incident, or risk decision]"), ph("[Scope, dependencies, exceptions]")]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Operating Guidance", content: "Reconcile example frequencies to the approved ConMon strategy. Name the deliverable, collection method, owner, reviewer, repository, due date, completion date, result threshold, and escalation path. A calendar entry is complete only when its evidence and follow-up are recorded." },
    tableSection("Monitoring Delivery Schedule", headers, rows, {
      Status: listOf(TEMPLATE_VOCAB.conmon_calendar.status),
      "Next Due": dateField(),
      "Completed Date": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "Continuous Monitoring Delivery Calendar", description: "Operating calendar connecting monitoring work to deliverables, evidence, review, reporting, and escalation.", sections }, options);
}

function generateHardwareBaseline(options) {
  const ph = placeholder(options);
  const headers = ["assetName", "componentType", "nickname", "assetIpAddress", "publicFacing", "publicFacingFqdn", "publicFacingIpAddress", "publicFacingUrls", "virtualAsset", "manufacturer", "modelNumber", "serialNumber", "osIosFwVersion", "memorySizeType", "location", "approvalStatus", "criticalAsset", "Asset Owner", "Environment / Boundary", "Discovery Source", "Last Verified", "Lifecycle Status", "Notes"];
  const rows = blankRows(20, headers.length, ph, ["[Required: unique asset name]", "[Server | workstation | network | appliance | mobile | other]", "[Friendly name]", "[Internal IP address]", "[true | false]", "[Required when publicFacing=true]", "[Required when publicFacing=true]", "[Required when publicFacing=true]", "[true | false]", "[Manufacturer or Virtual]", "[Model or Virtual]", "[Serial, cloud resource ID, or Virtual]", "[OS, IOS, or firmware version]", "[Memory size/type]", "[Facility, region, zone, or logical location]", "[Choose or enter an approval status]", "[true | false]", "[Accountable role]", "[Boundary or environment]", "[CMDB | cloud API | scan | manual]", "[YYYY-MM-DD]", "[Active | Spare | Maintenance | Retiring | Retired]", "[Exceptions, dependencies, reconciliation notes]"]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Baseline Standard", content: ["- Record one uniquely identifiable asset per row; do not use a shared name for multiple devices.", "- Populate the public-facing detail fields whenever publicFacing is true.", "- Use stable cloud resource IDs where serial numbers do not apply.", "- Reconcile owner, boundary, discovery source, verification date, lifecycle, and approval status before assessment use.", "- camelCase headers mirror public eMASS API v3.22 hardware-baseline fields; title-case headers are Control Atlas operating fields."].join("\n") },
    tableSection("Hardware Baseline", headers, rows, {
      publicFacing: listOf(TRUE_FALSE),
      virtualAsset: listOf(TRUE_FALSE),
      criticalAsset: listOf(TRUE_FALSE),
      approvalStatus: listOf(TEMPLATE_VOCAB.hardware_baseline.approvalStatus, { strict: false }),
      "Lifecycle Status": listOf(TEMPLATE_VOCAB.hardware_baseline.lifecycleStatus),
      "Last Verified": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "Hardware Baseline", description: "Assessment-ready asset inventory with public eMASS API v3.22-aligned preparation fields and local operating context.", sections }, options);
}

function generateSoftwareBaseline(options) {
  const ph = placeholder(options);
  const headers = ["softwareVendor", "softwareName", "version", "softwareType", "parentSystem", "subsystem", "network", "hostingEnvironment", "softwareDependencies", "cryptographicHash", "approvalStatus", "approvalDate", "releaseDate", "maintenanceDate", "retirementDate", "endOfLifeSupportDate", "criticalAsset", "location", "Software Owner", "Installation Scope / Count", "License / Contract", "Authority / Approved Use", "Discovery Source", "Last Verified", "Notes"];
  const rows = blankRows(20, headers.length, ph, ["[Required: vendor]", "[Required: product or package name]", "[Required: exact version/build]", "[OS | application | library | firmware | SaaS | tool | other]", "[Parent system]", "[Subsystem or component]", "[Network or enclave]", "[On-prem | cloud | managed service | endpoint]", "[Key packages, runtimes, or services]", "[Hash and algorithm when controlled]", "[Approved | Unapproved | In Progress]", "[YYYY-MM-DD; eMASS API uses Unix time]", "[YYYY-MM-DD]", "[YYYY-MM-DD]", "[YYYY-MM-DD]", "[YYYY-MM-DD]", "[true | false]", "[Facility, region, or logical location]", "[Accountable role]", "[Devices, users, instances, or enterprise]", "[License, contract, or entitlement reference]", "[APL, baseline, waiver, or approval reference]", "[CMDB | package manager | cloud API | scan | manual]", "[YYYY-MM-DD]", "[Exceptions, vulnerabilities, upgrade or removal action]"]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Baseline Standard", content: ["- Record vendor, product, and exact version/build; separate materially different versions.", "- Identify installation scope, dependencies, hosting environment, owner, approval basis, and discovery source.", "- Track maintenance, retirement, and end-of-support dates so unsupported software becomes actionable before assessment.", "- camelCase headers mirror public eMASS API v3.22 software-baseline fields; title-case headers are Control Atlas operating fields."].join("\n") },
    tableSection("Software Baseline", headers, rows, {
      criticalAsset: listOf(TRUE_FALSE),
      approvalDate: dateField({ help: "Enter a date, for example 2026-09-30. eMASS stores Unix time; convert when you enter it there." }),
      releaseDate: dateField(),
      maintenanceDate: dateField(),
      retirementDate: dateField(),
      endOfLifeSupportDate: dateField({ help: "Enter only a date you have from the vendor or your own records." }),
      "Last Verified": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "Software Baseline", description: "Assessment-ready software inventory with public eMASS API v3.22-aligned preparation fields and lifecycle context.", sections }, options);
}

function generatePPSMPreparationWorksheet(options) {
  const ph = placeholder(options);
  const headers = ["Record ID", "System / Boundary", "Mission or Business Need", "Service Name", "Protocol", "Port / Range", "Transport", "Source Zone / Address", "Destination Zone / Address", "Direction", "Purpose / Data Flow", "Public / External Exposure", "Encryption / Authentication", "Service Owner", "Technical POC", "Related Devices / Software", "Existing PPSM / Approval Reference", "Requested Action", "Review Status", "Risk / Exception", "Last Verified", "Notes"];
  const rows = blankRows(20, headers.length, ph, ["[Stable local ID]", "[System or authorization boundary]", "[Why the communication is necessary]", "[Service or application]", "[Protocol name/number]", "[Single port or range]", "[TCP | UDP | SCTP | other]", "[Zone, subnet, FQDN, or address]", "[Zone, subnet, FQDN, or address]", "[Inbound | Outbound | Bidirectional | Internal]", "[Information exchanged and operational purpose]", "[None | DoD external | Internet | Partner]", "[TLS, IPsec, mutual auth, certificates, or N/A]", "[Accountable role]", "[Technical contact or role]", "[Baseline asset IDs]", "[Registry number, receipt, CLSA/BUS, firewall rule, or N/A]", "[Register | Update | Retire | Validate]", "[Draft | Owner Review | Security Review | Ready for Registry | Entered in Registry | Rework]", "[Risk, deviation, or exception reference]", "[YYYY-MM-DD]", "[Dependencies, restrictions, reviewer comments]"]);
  /** @type {DocSection[]} */
  const sections = [
    { type: "text", heading: "Preparation Guidance", content: ["- Start with the mission need and data flow, then identify protocol, port, transport, endpoints, direction, and protections.", "- Use exact boundary, zone, address, device, and software references instead of generic labels.", "- Record existing registry, receipt, firewall, CLSA/BUS, or exception references when available.", "- Have the service owner and security reviewer validate the row before authorized registry entry.", "- This worksheet does not reproduce a restricted registry export and cannot be imported into PPSM."].join("\n") },
    tableSection("PPSM Preparation Register", headers, rows, {
      "Public / External Exposure": listOf(TEMPLATE_VOCAB.ppsm_preparation_worksheet.exposure),
      "Requested Action": listOf(TEMPLATE_VOCAB.ppsm_preparation_worksheet.requestedAction),
      "Review Status": listOf(TEMPLATE_VOCAB.ppsm_preparation_worksheet.reviewStatus),
      "Last Verified": dateField(),
    }),
  ];
  return appendSourceMetadata({ title: "PPSM Preparation Worksheet", description: "Local preparation register for ports, protocols, services, data flows, exposure, protections, ownership, and approval tracking.", sections }, options);
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
 * @returns {{ controlToCci: Map<string, Set<string>>, cciToStig: Map<string, Set<string>>, byId: Map<string, any> }}
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
      }
    }
  }

  return { controlToCci, cciToStig, byId };
}

/**
 * Resolve the real CCI numbers and STIG/SRG rule IDs cross-referenced by a
 * control node, using the index from {@link buildControlCrossRefIndex}.
 *
 * @param {ReturnType<typeof buildControlCrossRefIndex>} index
 * @param {string} controlNodeId
 * @returns {{ cciIds: string[], stigIds: string[] }}
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
  return {
    cciIds: sortIds(cciNodeIds.map(idOf)),
    stigIds: sortIds([...stigNodeIds].map(idOf)),
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
      }));
    }
  }
  if (controls.length === 0) {
    controls = [{ nodeId: null, id: "[Control ID]", title: "[Control Title]", family: "[Family]" }];
  }

  // Cross-reference data belongs in the dedicated evidence matrix, not the
  // compact SSP narrative starter. Build it only for that working matrix.
  const needsCrossRef = normalized.templateType === "evidence_expectation_matrix";
  const crossRef = needsCrossRef ? buildControlCrossRefIndex(dataset) : null;

  let doc;
  switch (normalized.templateType) {
    case "security_plan_starter":
      doc = generateProfessionalSecurityPlan(normalized, controls);
      break;
    case "implementation_statement_worksheet":
      doc = generateProfessionalImplementationWorksheet(normalized, controls);
      break;
    case "evidence_expectation_matrix":
      doc = generateProfessionalEvidenceMatrix(normalized, controls, crossRef);
      break;
    case "stig_evidence_checklist":
      doc = generateProfessionalSTIGWorksheet(normalized);
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
      doc = generateProfessionalAssessmentPlan(normalized, controls);
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
