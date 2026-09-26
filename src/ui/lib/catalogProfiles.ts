import { areaPresentationForCatalog } from "./areaVisualLanguage";
import { catalogStructureProfile } from "../../shared/catalog-structure.mjs";

export type CatalogProfile = {
  synopsis: string;
  recordLabel: string;
  publicationKind: string;
  area: string;
};

// Canonical publication-kind classification (docs/DATA_POLICY.md). Primary grouping on Catalog used to be
// the raw record-type enum below ("STIG rules", "identifiers"), which reads
// as a schema dump, not a map a newcomer can use to tell FedRAMP from a
// STIG. "Policy and regulation" is one addition beyond the fix spec's nine
// example kinds — CUI marking policy is not a control catalog, risk
// framework, or any of the other eight, and mislabeling it would be worse
// than naming a tenth kind for the one publication that needs it.
const PUBLICATION_KINDS: Record<string, string> = {
  "nist-800-53": "Control catalog",
  "nist-800-53a": "Control catalog",
  "nist-800-171": "Control catalog",
  "nist-800-171-rev2": "Control catalog",
  "nist-800-172": "Control catalog",
  "nist-800-53b": "Control-selection method",
  "nist-800-37": "Risk framework",
  "fips-199": "Risk framework",
  "fips-200": "Risk framework",
  "nist-ai-rmf": "Risk framework",
  "dod-rai": "Risk framework",
  "csf-2": "Outcome framework",
  "fedramp-rev5": "Authorization program",
  "fedramp-2026": "Authorization program",
  "cmmc-2": "Certification program",
  "disa-stig": "Implementation standard",
  "disa-srg": "Implementation standard",
  "disa-cci": "Implementation standard",
  "nist-ssdf": "Implementation standard",
  "dod-zt": "Implementation standard",
  "nist-zt": "Architecture and implementation guide",
  "microsoft-zt-maturity": "Assessment tool",
  "nist-iot-cybersecurity": "Capability catalog",
  "nist-mobile-threats": "Threat knowledge base",
  "mitre-attack": "Threat knowledge base",
  "mitre-attack-ics": "Threat knowledge base",
  "mitre-d3fend": "Defensive knowledge base",
  "cui-policy": "Policy and regulation",
};

export function catalogAreaFor(catalogId: string): string {
  return areaPresentationForCatalog(catalogId)?.label || "";
}

export function catalogDisplayNameFor(
  catalogId: string,
  candidateName = "",
): string {
  const candidate = String(candidateName || "").trim();
  if (candidate && candidate !== catalogId) return candidate;
  return catalogStructureProfile(catalogId)?.label || candidate || catalogId;
}

const RECORD_LABELS: Record<string, string> = {
  "nist-800-171-rev2": "Requirements",
  "nist-800-171": "Requirements",
  "nist-800-53": "Controls",
  "fedramp-rev5": "Baselines",
  "fedramp-2026": "Rules and definitions",
  "disa-stig": "STIG rules",
  "disa-srg": "SRG requirements",
  "disa-cci": "Identifiers",
  "nist-800-53a": "Assessment procedures",
  "nist-800-53b": "Baselines",
  "nist-800-37": "Tasks",
  "nist-800-172": "Requirements",
  "csf-2": "Outcomes",
  "fips-199": "Categorization records",
  "fips-200": "Requirements",
  "cmmc-2": "Program records",
  "cui-policy": "Program records",
  "dod-zt": "Activities",
  "nist-zt": "Principles, components, and builds",
  "microsoft-zt-maturity": "Assessment questions",
  "nist-iot-cybersecurity": "Capabilities and elements",
  "nist-mobile-threats": "Mobile threats",
  "dod-rai": "Guidance records",
  "nist-ai-rmf": "Practices",
  "nist-ssdf": "Practices",
  "mitre-attack": "Techniques",
  "mitre-attack-ics": "Techniques",
  "mitre-d3fend": "Countermeasures",
};

// One sentence per catalog: who it binds and when it applies. Not how the data
// got here — every record already carries its publisher and retrieval date in
// the source register, so restating "loaded from the cited publisher source"
// on every catalog said nothing.
const SYNOPSES: Record<string, string> = {
  "nist-800-53":
    "A catalog of security and privacy controls for information systems and organizations.",
  "nist-800-53b":
    "Control baselines for low-, moderate-, and high-impact systems, with tailoring guidance.",
  "fedramp-rev5":
    "FedRAMP control baselines and parameters for cloud service authorization.",
  "fedramp-2026":
    "Current FedRAMP rules, definitions, and key security indicators with publisher-stated effective dates and applicability.",
  "nist-800-171":
    "Requirements for protecting Controlled Unclassified Information in nonfederal systems and organizations.",
  "nist-800-171-rev2":
    "Revision 2 requirements for protecting Controlled Unclassified Information in nonfederal systems and organizations.",
  "nist-800-172":
    "Enhanced requirements for protecting Controlled Unclassified Information from advanced persistent threats.",
  "csf-2":
    "Cybersecurity outcomes organized by function, category, and subcategory.",
  "cmmc-2":
    "The Department of Defense program for assessing contractor cybersecurity requirements.",
  "cui-policy":
    "Federal policy for identifying, marking, safeguarding, and handling Controlled Unclassified Information.",
  "nist-ssdf":
    "Secure software development practices organized by outcome.",
  "nist-ai-rmf":
    "Actions for managing risk across an artificial intelligence system's life cycle.",
  "dod-rai":
    "CDAO guidance and self-assessment activities for assuring artificial intelligence across its lifecycle.",
  "nist-800-37":
    "The Risk Management Framework process for managing security and privacy risk.",
  "fips-200":
    "Minimum security requirements for federal information and information systems.",
  "fips-199":
    "Standards for categorizing federal information and systems by potential impact.",
  "disa-cci":
    "Identifiers for individual security requirements and their referenced controls.",
  "disa-srg":
    "Security requirements for classes of technology.",
  "disa-stig":
    "Configuration rules for specific technologies, with discussion, check, and fix text.",
  "nist-800-53a":
    "Assessment procedures for NIST SP 800-53 controls.",
  "mitre-attack":
    "Documented adversary tactics and techniques for enterprise environments.",
  "mitre-attack-ics":
    "Documented adversary tactics and techniques for industrial control systems.",
  "mitre-d3fend":
    "Defensive cybersecurity techniques and their relationships to offensive techniques.",
  "dod-zt":
    "Department of Defense zero trust capabilities, activities, and target outcomes.",
  "nist-zt":
    "NIST zero trust principles, logical components, and the 19 SP 1800-35 example implementations.",
  "microsoft-zt-maturity":
    "Microsoft assessment questions across six zero trust pillars, informed by NIST and CISA guidance.",
  "nist-iot-cybersecurity":
    "NIST technical and manufacturer capabilities for securing Internet of Things devices.",
  "nist-mobile-threats":
    "NIST mobile threats with exploit examples, CVE references, and possible countermeasures.",
};

export function catalogProfileFor(
  catalogId: string,
  _catalogName = "this catalog",
): CatalogProfile {
  return {
    synopsis: SYNOPSES[catalogId] || "",
    recordLabel: RECORD_LABELS[catalogId] || "Records",
    publicationKind: PUBLICATION_KINDS[catalogId] || "Publication",
    area: catalogAreaFor(catalogId),
  };
}
