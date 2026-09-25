import { publicationsCitingPolicy, recordedBasisFor } from "./publicationIdentity";

/**
 * Practitioner journeys: "start with what you're working on".
 *
 * A journey is Control Atlas-authored navigation. It gathers destinations that already exist in
 * the product (publications on the map, records, Compare pairs, templates, task guides, resources,
 * source records) under the name a practitioner uses for the work. It is not a publisher mapping,
 * not an applicability or equivalence claim and never a graph edge: journeys draw no routes, and a
 * Compare pair is offered only where a published route already joins the two publications.
 *
 * Every id below is checked against the corpus in tests/graph/atlasJourneys.test.ts.
 */

export type JourneyPublication = {
  /** Catalog id of a publication placed on the map. */
  readonly id: string;
  /** Practitioner name for the part this publication plays in the work. The official title stays visible beside it. */
  readonly role: string;
};
export type JourneyStep = { readonly label: string; readonly nodeId: string };
export type JourneyResource = { readonly id: string; readonly label: string };
export type JourneyCollection = { readonly id: string; readonly label: string };
export type JourneySource = { readonly id: string; readonly label: string; readonly role: string };
export type JourneyPolicy = { readonly id: string; readonly basis: string };

export type Journey = {
  readonly id: string;
  /** What practitioners call it. */
  readonly label: string;
  /** The spelled-out name, when the label is an abbreviation. */
  readonly expansion: string;
  readonly summary: string;
  /** Words a practitioner types for this work; used by Atlas search. Lowercase. */
  readonly keywords: readonly string[];
  readonly publications: readonly JourneyPublication[];
  /** Records a reader can open on the map, in the publisher's own order. */
  readonly steps?: { readonly heading: string; readonly items: readonly JourneyStep[] };
  /** Candidate Compare pairs. Offered only where a published route joins the pair. */
  readonly compare: readonly (readonly [string, string])[];
  /** Task guide ids (data/compliance-workflows.json). */
  readonly tasks: readonly string[];
  /** Template names (data/template-registry.json). */
  readonly templates: readonly string[];
  readonly collections: readonly JourneyCollection[];
  readonly resources: readonly JourneyResource[];
  /** Publications Control Atlas holds as source records but has not placed on the map. */
  readonly sources: readonly JourneySource[];
  /** Policy beyond what authority-spine.json records for the listed publications, each with its basis. */
  readonly extraPolicy: readonly JourneyPolicy[];
};

export const JOURNEYS: readonly Journey[] = Object.freeze([
  {
    id: "rmf",
    label: "RMF & ATO",
    expansion: "Risk Management Framework and authorization to operate",
    summary: "Getting a system to an authorization decision and keeping it there. SP 800-37 defines the process; the publications below cover each step.",
    keywords: ["rmf", "risk management framework", "ato", "authorization to operate", "authorization package", "authorize", "800-37", "categorize", "categorization", "emass"],
    publications: [
      { id: "nist-800-37", role: "RMF process" },
      { id: "fips-199", role: "System categorization" },
      { id: "fips-200", role: "Minimum security requirements" },
      { id: "nist-800-53", role: "Control catalog" },
      { id: "nist-800-53b", role: "Control baselines" },
      { id: "nist-800-53a", role: "Assessment procedures" },
    ],
    steps: {
      heading: "RMF steps",
      items: [
        { label: "Prepare", nodeId: "nist-800-37:RMF-PREPARE" },
        { label: "Categorize", nodeId: "nist-800-37:RMF-CATEGORIZE" },
        { label: "Select", nodeId: "nist-800-37:RMF-SELECT" },
        { label: "Implement", nodeId: "nist-800-37:RMF-IMPLEMENT" },
        { label: "Assess", nodeId: "nist-800-37:RMF-ASSESS" },
        { label: "Authorize", nodeId: "nist-800-37:RMF-AUTHORIZE" },
        { label: "Monitor", nodeId: "nist-800-37:RMF-MONITOR" },
      ],
    },
    compare: [["nist-800-53", "nist-800-53b"], ["nist-800-53", "nist-800-53a"]],
    tasks: ["build-authorization-package", "write-control-implementations", "organize-continuous-monitoring"],
    templates: ["security_plan_starter", "poam_starter", "conmon_calendar"],
    collections: [],
    resources: [
      { id: "service-dod-rmf-knowledge-service", label: "DoD RMF Knowledge Service" },
      { id: "tool-mitre-emass-client", label: "MITRE eMASS Client" },
      { id: "template-i-assure-ssp-worksheet", label: "I-Assure RMF artifact templates" },
    ],
    sources: [],
    extraPolicy: [{ id: "authority-dodi-8510-01", basis: "Its official title is Risk Management Framework for DoD Systems." }],
  },
  {
    id: "stig",
    label: "STIGs & SRGs",
    expansion: "Security Technical Implementation Guides and Security Requirements Guides",
    summary: "DISA's configuration requirements for specific products and technologies. CCIs tie each STIG and SRG requirement back to SP 800-53 controls.",
    keywords: ["stig", "stigs", "srg", "srgs", "cci", "ccis", "checklist", "ckl", "scap", "hardening", "configuration", "benchmark", "disa"],
    publications: [
      { id: "disa-stig", role: "STIGs" },
      { id: "disa-srg", role: "Security requirements guides" },
      { id: "disa-cci", role: "CCIs" },
      { id: "nist-800-53", role: "Control catalog" },
    ],
    compare: [["disa-cci", "nist-800-53"], ["disa-cci", "disa-stig"]],
    tasks: ["run-stig-assessment", "establish-system-baselines"],
    templates: ["evidence_expectation_matrix", "software_baseline", "hardware_baseline"],
    collections: [{ id: "stig-configuration-automation", label: "STIG and configuration automation" }],
    resources: [
      { id: "portal-dod-stig-srg", label: "DISA STIG and SRG portal" },
      { id: "tool-disa-scap-compliance-checker", label: "DISA SCAP Compliance Checker" },
      { id: "tool-stig-manager", label: "STIG Manager" },
    ],
    sources: [],
    extraPolicy: [],
  },
  {
    id: "zero-trust",
    label: "Zero Trust",
    expansion: "",
    summary: "The DoD and NIST zero trust architectures, plus a maturity questionnaire. The DoD reference architecture publishes links to SP 800-53 controls.",
    keywords: ["zero trust", "zt", "zta", "ztra", "800-207", "pillars", "zero-trust"],
    publications: [
      { id: "dod-zt", role: "DoD reference architecture" },
      { id: "nist-zt", role: "Zero trust architecture" },
      { id: "microsoft-zt-maturity", role: "Maturity questionnaire" },
    ],
    compare: [["dod-zt", "nist-800-53"]],
    tasks: [],
    templates: [],
    collections: [],
    resources: [],
    sources: [
      { id: "nist-sp-1800-35", label: "NIST SP 1800-35", role: "Implementation examples" },
      { id: "nist-sp-800-207a", label: "NIST SP 800-207A", role: "Cloud-native access control" },
    ],
    extraPolicy: [],
  },
  {
    id: "cmmc-cui",
    label: "CMMC & CUI",
    expansion: "Cybersecurity Maturity Model Certification and Controlled Unclassified Information",
    summary: "Protecting CUI on contractor systems: the CUI program, the SP 800-171 requirements, and CMMC levels and assessments.",
    keywords: ["cmmc", "cui", "dfars", "7012", "7021", "800-171", "171", "fci", "dib", "contractor", "sprs", "c3pao", "controlled unclassified information"],
    publications: [
      { id: "cmmc-2", role: "CMMC program" },
      { id: "nist-800-171-rev2", role: "CUI security requirements" },
      { id: "nist-800-171", role: "CUI security requirements" },
      { id: "nist-800-172", role: "Enhanced CUI requirements" },
      { id: "cui-policy", role: "CUI program" },
    ],
    compare: [["nist-800-171", "nist-800-53"]],
    tasks: ["create-update-poam"],
    templates: [],
    collections: [{ id: "cmmc-defense-industrial-base", label: "CMMC and the defense industrial base" }],
    resources: [
      { id: "portal-dod-cmmc-documentation", label: "DoD CMMC resources and documentation" },
      { id: "official-cui-registry", label: "NARA CUI Registry" },
      { id: "service-sprs-cyber-reports", label: "SPRS" },
      { id: "portal-project-spectrum", label: "Project Spectrum" },
    ],
    sources: [],
    extraPolicy: [],
  },
  {
    id: "fedramp",
    label: "FedRAMP",
    expansion: "Federal Risk and Authorization Management Program",
    summary: "Authorizing cloud services: the current FedRAMP rules, the Rev. 5 baselines still in transition, and continuous monitoring.",
    keywords: ["fedramp", "cloud", "csp", "cso", "20x", "marketplace", "p-ato", "jab", "conmon", "ksi"],
    publications: [
      { id: "fedramp-2026", role: "Current FedRAMP rules" },
      { id: "fedramp-rev5", role: "Rev. 5 baselines" },
      { id: "nist-800-53", role: "Control catalog" },
    ],
    compare: [],
    tasks: ["evaluate-inheritance", "prepare-reciprocity-review", "organize-continuous-monitoring"],
    templates: ["security_plan_starter", "inheritance_worksheet", "conmon_calendar", "reciprocity_checklist"],
    collections: [{ id: "reciprocity-authorization-reuse", label: "Reciprocity and authorization reuse" }],
    resources: [
      { id: "official-fedramp-marketplace", label: "FedRAMP Marketplace" },
      { id: "official-fedramp-20x", label: "FedRAMP 20x" },
      { id: "template-fedramp-ssp-rev5", label: "FedRAMP Rev. 5 SSP Template" },
      { id: "template-fedramp-poam-rev5", label: "FedRAMP POA&M Template" },
    ],
    sources: [],
    extraPolicy: [],
  },
  {
    id: "controls",
    label: "Controls & baselines",
    expansion: "",
    summary: "The SP 800-53 controls, the baselines that select them, and the frameworks that map to them.",
    keywords: ["controls", "control", "baseline", "baselines", "800-53", "800-53b", "low", "moderate", "high", "overlay", "tailoring", "control family", "csf", "cybersecurity framework"],
    publications: [
      { id: "nist-800-53", role: "Control catalog" },
      { id: "nist-800-53b", role: "Control baselines" },
      { id: "fips-200", role: "Minimum security requirements" },
      { id: "csf-2", role: "Cybersecurity outcomes" },
      { id: "nist-800-171", role: "CUI security requirements" },
    ],
    compare: [["nist-800-53", "nist-800-53b"], ["csf-2", "nist-800-53"], ["nist-800-171", "nist-800-53"]],
    tasks: ["write-control-implementations", "evaluate-inheritance"],
    templates: ["implementation_statement_worksheet", "inheritance_worksheet"],
    collections: [],
    resources: [{ id: "official-nist-oscal", label: "NIST OSCAL Standard" }],
    sources: [],
    extraPolicy: [],
  },
  {
    id: "assessment",
    label: "Assessment & evidence",
    expansion: "",
    summary: "Plan an assessment, match evidence to each control, and track findings to closure.",
    keywords: ["assessment", "assess", "assessor", "sca", "evidence", "sar", "sap", "poam", "poa&m", "findings", "800-53a", "test", "audit"],
    publications: [
      { id: "nist-800-53a", role: "Assessment procedures" },
      { id: "nist-800-53", role: "Control catalog" },
      { id: "disa-stig", role: "STIG checks" },
      { id: "disa-cci", role: "CCIs" },
    ],
    compare: [["nist-800-53", "nist-800-53a"]],
    tasks: ["prepare-security-assessment", "run-stig-assessment", "create-update-poam"],
    templates: ["assessment_planning_worksheet", "evidence_expectation_matrix", "poam_starter"],
    collections: [{ id: "implementation-assessment-tools", label: "Implementation and assessment tools" }],
    resources: [
      { id: "tool-mitre-heimdall", label: "Heimdall Visualizer" },
      { id: "tool-mitre-saf-cli", label: "MITRE SAF CLI" },
      { id: "service-disa-acas", label: "DISA Assured Compliance Assessment Solution (ACAS)" },
    ],
    sources: [],
    extraPolicy: [],
  },
  {
    id: "threats",
    label: "Threats & defenses",
    expansion: "",
    summary: "What adversaries do, how to counter it, and where those countermeasures map to SP 800-53 controls.",
    keywords: ["threat", "threats", "attack", "att&ck", "ttp", "ttps", "technique", "techniques", "d3fend", "countermeasure", "defense", "defenses", "kev", "vulnerability", "mitre", "ics"],
    publications: [
      { id: "mitre-attack", role: "Adversary techniques" },
      { id: "mitre-attack-ics", role: "ICS adversary techniques" },
      { id: "mitre-d3fend", role: "Defensive countermeasures" },
      { id: "nist-mobile-threats", role: "Mobile threats" },
    ],
    compare: [["mitre-attack", "mitre-d3fend"], ["mitre-d3fend", "nist-800-53"]],
    tasks: [],
    templates: [],
    collections: [
      { id: "threat-intelligence-investigation", label: "Threat intelligence and investigation" },
      { id: "vulnerability-management-prioritization", label: "Vulnerability management and prioritization" },
    ],
    resources: [
      { id: "tool-mitre-attack-navigator", label: "MITRE ATT&CK Navigator" },
      { id: "official-cisa-kev-catalog", label: "CISA KEV Catalog" },
      { id: "dataset-mitre-d3fend-json", label: "MITRE D3FEND JSON" },
    ],
    sources: [],
    extraPolicy: [],
  },
  {
    id: "working-files",
    label: "Working files",
    expansion: "",
    summary: "Templates and step-by-step guides for SSPs, implementation statements, assessment plans, POA&Ms, baselines and ConMon calendars.",
    keywords: ["template", "templates", "working files", "ssp", "poam", "poa&m", "worksheet", "documents", "deliverables", "artifacts", "security plan"],
    publications: [],
    compare: [],
    tasks: ["build-authorization-package", "write-control-implementations", "prepare-security-assessment", "create-update-poam", "establish-system-baselines", "organize-continuous-monitoring"],
    templates: [
      "security_plan_starter", "implementation_statement_worksheet", "inheritance_worksheet", "assessment_planning_worksheet", "evidence_expectation_matrix",
      "poam_starter", "conmon_calendar", "reciprocity_checklist", "hardware_baseline", "software_baseline",
    ],
    collections: [],
    resources: [
      { id: "template-fedramp-ssp-rev5", label: "FedRAMP Rev. 5 SSP Template" },
      { id: "template-fedramp-poam-rev5", label: "FedRAMP POA&M Template" },
      { id: "tool-gsa-oscal-ssp-word", label: "GSA OSCAL Word Gen" },
    ],
    sources: [],
    extraPolicy: [],
  },
] satisfies Journey[]);

export const journeyById = new Map(JOURNEYS.map((j) => [j.id, j]));

/** Policy documents recorded (with cited sources) as the basis for a publication, by source id. */
export const policyForPublication = recordedBasisFor;
export { publicationsCitingPolicy };

export type JourneyPolicyEntry = { id: string; basis: string; cites: string[] };
/**
 * Governing policy for a journey: only what the authority spine records for the journey's own
 * publications (each carries its own cited source), plus explicit additions that state their basis.
 */
export function policyForJourney(journey: Journey): JourneyPolicyEntry[] {
  const out = new Map<string, JourneyPolicyEntry>();
  for (const p of journey.publications) {
    for (const id of policyForPublication(p.id)) {
      const entry = out.get(id) || { id, basis: "", cites: [] };
      if (!entry.cites.includes(p.id)) entry.cites.push(p.id);
      out.set(id, entry);
    }
  }
  for (const extra of journey.extraPolicy) if (!out.has(extra.id)) out.set(extra.id, { id: extra.id, basis: extra.basis, cites: [] });
  return [...out.values()];
}

export type JourneyHit = { type: "journey"; id: string; label: string; sub: string; exact: boolean };

/** Journeys whose name or practitioner keywords match the query. Exact keyword or name matches come first. */
export function searchJourneys(query: string, limit = 2): JourneyHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const score = (j: Journey) => {
    const names = [j.label.toLowerCase(), j.expansion.toLowerCase(), ...j.keywords];
    if (names.includes(q)) return 0;
    if (names.some((n) => n.startsWith(q) || (q.length >= 3 && n.split(/[\s&]+/).some((w) => w === q)))) return 1;
    if (q.length >= 3 && names.some((n) => n.includes(q))) return 2;
    return 99;
  };
  return JOURNEYS.map((j) => ({ j, s: score(j) })).filter((x) => x.s < 99).sort((a, b) => a.s - b.s).slice(0, limit)
    .map(({ j, s }) => ({ type: "journey" as const, id: j.id, label: j.label, sub: `Start here · ${j.expansion || j.summary.split(".")[0]}`, exact: s === 0 }));
}
