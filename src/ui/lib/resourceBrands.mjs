import { resolveIdentityByKey } from "../../shared/identity-registry.mjs";

const brand = ({
  key,
  ownerLabel = "",
  accessibleName = "",
  iconKey = "",
  initials = "",
  accent = "neutral",
  parentEcosystem = null,
  resourceIds = [],
  namePatterns = [],
  ownerPatterns = [],
  hosts = [],
}) => {
  const canonicalIdentity = resolveIdentityByKey(key);
  return Object.freeze({
    key,
    ownerLabel: canonicalIdentity?.label || ownerLabel,
    accessibleName: canonicalIdentity?.accessible_name || accessibleName,
    markKind: iconKey ? "icon" : "monogram",
    iconKey,
    initials: initials || canonicalIdentity?.fallback?.value || "",
    accent,
    parentEcosystem,
    canonicalIdentityKey: canonicalIdentity?.key || null,
    resourceIds: Object.freeze(resourceIds),
    namePatterns: Object.freeze(namePatterns),
    ownerPatterns: Object.freeze(ownerPatterns),
    hosts: Object.freeze(hosts),
  });
};

/**
 * One registry for the owner and ecosystem identities used across Resources.
 * Entries intentionally use bundled Tabler glyphs or plain-text monograms;
 * official seals and third-party image assets do not live here.
 */
export const RESOURCE_BRAND_REGISTRY = Object.freeze({
  reddit: brand({
    key: "reddit",
    ownerLabel: "Reddit",
    accessibleName: "Reddit community",
    iconKey: "reddit",
    accent: "community",
    namePatterns: ["reddit /r/"],
    ownerPatterns: ["reddit"],
    hosts: ["reddit.com"],
  }),
  fedramp: brand({
    key: "fedramp",
    initials: "FR",
    accent: "federal",
    namePatterns: ["fedramp"],
    ownerPatterns: ["fedramp"],
    hosts: ["fedramp.gov"],
  }),
  nist: brand({
    key: "nist",
    accent: "federal",
    namePatterns: ["nist ", "national institute of standards and technology"],
    ownerPatterns: ["nist", "national institute of standards and technology"],
    hosts: ["nist.gov"],
  }),
  cisa: brand({
    key: "cisa",
    accent: "federal",
    namePatterns: ["cisa "],
    ownerPatterns: ["cisa", "cybersecurity and infrastructure security agency"],
    hosts: ["cisa.gov"],
  }),
  disa: brand({
    key: "disa",
    accent: "defense",
    namePatterns: ["disa ", "stig viewer", "scap compliance checker"],
    ownerPatterns: ["disa", "defense information systems agency"],
    hosts: ["disa.mil", "cloud.mil"],
  }),
  dod_cyber_exchange: brand({
    key: "dod_cyber_exchange",
    ownerLabel: "DoD Cyber Exchange",
    accessibleName: "Department of Defense Cyber Exchange",
    initials: "DCX",
    accent: "defense",
    parentEcosystem: "Department of Defense",
    namePatterns: ["dod cyber exchange", "cyber exchange"],
    ownerPatterns: ["disa cyber exchange", "dod cyber exchange"],
    hosts: ["cyber.mil"],
  }),
  dod_cio: brand({
    key: "dod_cio",
    ownerLabel: "DoD CIO",
    accessibleName: "Department of Defense Chief Information Officer",
    initials: "CIO",
    accent: "defense",
    parentEcosystem: "Department of Defense",
    namePatterns: ["dod cio"],
    ownerPatterns: ["dod cio", "department of defense chief information officer"],
    hosts: ["dodcio.defense.gov"],
  }),
  iron_bank: brand({
    key: "iron_bank",
    ownerLabel: "Iron Bank",
    accessibleName: "Platform One Iron Bank",
    initials: "IB",
    accent: "platform",
    parentEcosystem: "Platform One",
    resourceIds: ["tool-platform-one-ironbank"],
    namePatterns: ["iron bank", "ironbank"],
    ownerPatterns: ["iron bank"],
  }),
  platform_one: brand({
    key: "platform_one",
    ownerLabel: "Platform One",
    accessibleName: "Department of Defense Platform One",
    initials: "P1",
    accent: "platform",
    parentEcosystem: "Department of Defense",
    namePatterns: ["platform one", "platform 1", "big bang", "party bus", "collabtools", "repo one"],
    ownerPatterns: ["platform one", "platform 1"],
    hosts: ["p1.dso.mil"],
  }),
  common_criteria: brand({
    key: "common_criteria",
    ownerLabel: "Common Criteria",
    accessibleName: "Common Criteria Recognition Arrangement",
    initials: "CC",
    accent: "assurance",
    namePatterns: ["common criteria"],
    ownerPatterns: ["common criteria"],
    hosts: ["commoncriteriaportal.org"],
  }),
  niap: brand({
    key: "niap",
    ownerLabel: "NIAP",
    accessibleName: "National Information Assurance Partnership",
    initials: "NIAP",
    accent: "assurance",
    namePatterns: ["niap ", "niap common criteria", "ccevs"],
    ownerPatterns: ["niap", "national information assurance partnership"],
    hosts: ["niap-ccevs.org"],
  }),
  tenable: brand({
    key: "tenable",
    ownerLabel: "Tenable",
    accessibleName: "Tenable",
    initials: "T",
    accent: "commercial",
    namePatterns: ["tenable ", "nessus audit"],
    ownerPatterns: ["tenable"],
    hosts: ["tenable.com"],
  }),
  github: brand({
    key: "github",
    ownerLabel: "GitHub",
    accessibleName: "GitHub source-code repository",
    iconKey: "github",
    accent: "source",
    ownerPatterns: ["github"],
    hosts: ["github.com", "github.io", "githubusercontent.com"],
  }),
  mattermost: brand({
    key: "mattermost",
    ownerLabel: "Mattermost",
    accessibleName: "Mattermost collaboration service",
    initials: "MM",
    accent: "community",
    namePatterns: ["mattermost", "chatops"],
    ownerPatterns: ["mattermost"],
  }),
  slack: brand({
    key: "slack",
    ownerLabel: "Slack",
    accessibleName: "Slack community",
    iconKey: "slack",
    accent: "community",
    namePatterns: ["slack workspace", "slack community"],
    ownerPatterns: ["slack"],
    hosts: ["slack.com"],
  }),
  cis: brand({
    key: "cis",
    ownerLabel: "CIS",
    accessibleName: "Center for Internet Security",
    initials: "CIS",
    accent: "assurance",
    namePatterns: ["cis benchmarks", "cis workbench", "center for internet security"],
    ownerPatterns: ["center for internet security", "cis workbench"],
    hosts: ["cisecurity.org"],
  }),
  microsoft: brand({
    key: "microsoft",
    iconKey: "microsoft",
    accent: "commercial",
    namePatterns: ["microsoft ", "powerstig"],
    ownerPatterns: ["microsoft"],
    hosts: ["microsoft.com"],
  }),
  mitre: brand({
    key: "mitre",
    accent: "research",
    namePatterns: ["mitre ", "heimdall", "security automation framework"],
    ownerPatterns: ["mitre"],
    hosts: ["mitre.org"],
  }),
  dcsa: brand({
    key: "dcsa",
    accent: "defense",
    namePatterns: ["dcsa ", "nisp cybersecurity office"],
    ownerPatterns: ["dcsa", "defense counterintelligence and security agency"],
    hosts: ["dcsa.mil"],
  }),
  cyber_ab: brand({
    key: "cyber_ab",
    ownerLabel: "The Cyber AB",
    accessibleName: "The Cyber AB",
    initials: "CAB",
    accent: "assurance",
    namePatterns: ["the cyber ab", "cyber ab marketplace"],
    ownerPatterns: ["the cyber ab"],
  }),
  project_spectrum: brand({
    key: "project_spectrum",
    ownerLabel: "Project Spectrum",
    accessibleName: "Project Spectrum",
    initials: "PS",
    accent: "defense",
    namePatterns: ["project spectrum"],
    ownerPatterns: ["project spectrum"],
  }),
});

const BRAND_MATCH_ORDER = Object.freeze([
  "reddit",
  "iron_bank",
  "platform_one",
  "niap",
  "common_criteria",
  "dod_cyber_exchange",
  "dod_cio",
  "disa",
  "fedramp",
  "nist",
  "cisa",
  "tenable",
  "mattermost",
  "slack",
  "cis",
  "microsoft",
  "mitre",
  "dcsa",
  "cyber_ab",
  "project_spectrum",
  "github",
]);

const fallback = ({ key, label, iconKey, accent = "neutral" }) =>
  Object.freeze({
    key,
    ownerLabel: label,
    accessibleName: `${label} identity`,
    markKind: "icon",
    iconKey,
    initials: "",
    accent,
    parentEcosystem: null,
    source: "fallback",
  });

export const RESOURCE_TYPE_FALLBACKS = Object.freeze({
  government_portal: fallback({ key: "government_portal", label: "Government portal", iconKey: "government", accent: "federal" }),
  tool: fallback({ key: "tool", label: "Tool", iconKey: "tool", accent: "source" }),
  template: fallback({ key: "template", label: "Template", iconKey: "template" }),
  dataset: fallback({ key: "dataset", label: "Dataset", iconKey: "dataset" }),
  documentation: fallback({ key: "documentation", label: "Documentation", iconKey: "documentation" }),
  training: fallback({ key: "training", label: "Training", iconKey: "training" }),
  marketplace: fallback({ key: "marketplace", label: "Marketplace", iconKey: "marketplace", accent: "commercial" }),
  community: fallback({ key: "community", label: "Community or forum", iconKey: "community", accent: "community" }),
  repository: fallback({ key: "repository", label: "Source-code repository", iconKey: "repository", accent: "source" }),
  restricted_service: fallback({ key: "restricted_service", label: "Restricted service", iconKey: "restricted", accent: "defense" }),
  resource: fallback({ key: "resource", label: "External resource", iconKey: "resource" }),
});

const TYPE_LABELS = Object.freeze({
  catalog: "Catalog",
  community_forum: "Community or forum",
  dataset: "Dataset",
  documentation: "Documentation",
  historical_reference: "Historical reference",
  instruction: "Guidance",
  marketplace: "Marketplace",
  matrix: "Matrix",
  policy: "Policy",
  portal: "Portal",
  repository: "Source-code repository",
  restricted_service: "Restricted service",
  service: "Service",
  specification: "Specification",
  template: "Template",
  tool: "Tool",
  training: "Training",
});

const ACCESS_LABELS = Object.freeze({
  public: "Public",
  free_account: "Free account required",
  commercial_account: "Commercial account required",
  commercial_account_required: "Commercial account required",
  customer_only: "Commercial account required",
  paid: "Commercial account required",
  cac: "CAC required",
  cac_or_piv: "CAC required",
  cac_required: "CAC required",
  dod_network: "DoD network required",
  dod_network_required: "DoD network required",
  invitation: "Invitation required",
  invitation_required: "Invitation required",
  membership: "Access varies",
  restricted: "Access varies",
  varies: "Access varies",
  unknown: "Access varies",
  access_varies: "Access varies",
});

const FIELD_LABELS = Object.freeze({
  active: "Active",
  archived: "Archived",
  community: "Community",
  commercial: "Commercial",
  general_it: "General IT",
  manual_restricted: "Manual restricted review",
  manual_review: "Manual review",
  no_cost: "No cost",
  official_repository: "Official repository",
  open_source: "Open source",
  public_url: "Public URL",
});

const APPROVED_ACRONYMS = Object.freeze({
  "3pao": "3PAO",
  api: "API",
  ciso: "CISO",
  cmmc: "CMMC",
  cui: "CUI",
  disa: "DISA",
  disn: "DISN",
  devsecops: "DevSecOps",
  dod: "DoD",
  fedramp: "FedRAMP",
  hr: "HR",
  inspec: "InSpec",
  isso: "ISSO",
  issm: "ISSM",
  it: "IT",
  oscal: "OSCAL",
  pmo: "PMO",
  sca: "SCA",
  scap: "SCAP",
  siem: "SIEM",
  soc: "SOC",
  stig: "STIG",
  url: "URL",
});

const RESTRICTED_ACCESS = new Set([
  "commercial_account",
  "commercial_account_required",
  "customer_only",
  "paid",
  "cac",
  "cac_or_piv",
  "cac_required",
  "dod_network",
  "dod_network_required",
  "invitation",
  "invitation_required",
  "membership",
  "restricted",
  "varies",
  "unknown",
]);

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function resourceHost(resource) {
  try {
    return new URL(resource?.canonicalUrl || "").hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(host, candidate) {
  return host === candidate || host.endsWith(`.${candidate}`);
}

function patternMatches(value, patterns) {
  return patterns.some((pattern) => value.includes(pattern));
}

function subredditName(resource) {
  const combined = `${resource?.name || ""} ${resource?.canonicalUrl || ""}`;
  const match = combined.match(/(?:reddit\s+)?\/?r\/([a-z0-9_-]+)/i);
  return match?.[1] || "";
}

function registryIdentity(entry, resource) {
  const subreddit = entry.key === "reddit" ? subredditName(resource) : "";
  return Object.freeze({
    ...entry,
    ownerLabel: subreddit ? `r/${subreddit}` : entry.ownerLabel,
    accessibleName: subreddit
      ? `Reddit r/${subreddit} community`
      : entry.accessibleName,
    variantKey: subreddit ? `subreddit:${subreddit.toLowerCase()}` : entry.key,
    source: "registry",
  });
}

function fallbackKeyFor(resource) {
  const accessType = normalizedText(resource?.accessType);
  const type = normalizedText(resource?.resourceType);
  const host = resourceHost(resource);

  if (RESTRICTED_ACCESS.has(accessType)) return "restricted_service";
  if (type === "community_forum" || type === "community") return "community";
  if (resource?.repositoryUrl || hostMatches(host, "github.com")) return "repository";
  if (type === "tool") return "tool";
  if (type === "template") return "template";
  if (type === "dataset") return "dataset";
  if (["documentation", "instruction", "policy", "specification", "historical_reference"].includes(type)) return "documentation";
  if (type === "training") return "training";
  if (type === "marketplace") return "marketplace";
  if (type === "restricted_service") return "restricted_service";
  if (type === "portal" || resource?.resourceLane === "official") return "government_portal";
  return "resource";
}

export function resourceBrandIdentity(resource) {
  const explicitKey = normalizedText(resource?.brandKey).replaceAll("-", "_");
  if (explicitKey && RESOURCE_BRAND_REGISTRY[explicitKey]) {
    return registryIdentity(RESOURCE_BRAND_REGISTRY[explicitKey], resource);
  }

  const id = normalizedText(resource?.id);
  for (const key of BRAND_MATCH_ORDER) {
    const entry = RESOURCE_BRAND_REGISTRY[key];
    if (entry.resourceIds.includes(id)) return registryIdentity(entry, resource);
  }

  const name = normalizedText(`${resource?.name || ""} ${resource?.shortName || ""}`);
  for (const key of BRAND_MATCH_ORDER) {
    const entry = RESOURCE_BRAND_REGISTRY[key];
    if (patternMatches(name, entry.namePatterns)) return registryIdentity(entry, resource);
  }

  const owner = normalizedText(`${resource?.publisher || ""} ${resource?.maintainer || ""}`);
  for (const key of BRAND_MATCH_ORDER) {
    const entry = RESOURCE_BRAND_REGISTRY[key];
    if (patternMatches(owner, entry.ownerPatterns)) return registryIdentity(entry, resource);
  }

  const host = resourceHost(resource);
  for (const key of BRAND_MATCH_ORDER) {
    const entry = RESOURCE_BRAND_REGISTRY[key];
    if (entry.hosts.some((candidate) => hostMatches(host, candidate))) {
      return registryIdentity(entry, resource);
    }
  }

  return RESOURCE_TYPE_FALLBACKS[fallbackKeyFor(resource)];
}

export function resourceTypeLabel(resourceType) {
  const normalized = normalizedText(resourceType);
  if (TYPE_LABELS[normalized]) return TYPE_LABELS[normalized];
  if (!normalized) return "Resource";
  return normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function resourceOriginLabel(resourceLane) {
  return {
    official: "Official publisher",
    open_source: "Open-source project",
    practitioner: "Practitioner resource",
    commercial: "Vendor resource",
    legacy: "Historical resource",
  }[resourceLane] || "Resource";
}

export function resourceAccessLabel(resource) {
  const accessType = normalizedText(resource?.accessType);
  if (!accessType) return "";
  if (
    accessType === "public" &&
    (resource?.accountRequired === true || resource?.authenticationRequired === true)
  ) {
    return "Access varies";
  }
  return ACCESS_LABELS[accessType] || "";
}

export function resourceFieldLabel(value) {
  const normalized = normalizedText(value);
  if (!normalized) return "";
  if (FIELD_LABELS[normalized]) return FIELD_LABELS[normalized];
  return normalized
    .split(/([ _-]+)/)
    .filter(Boolean)
    .map((part) => {
      if (/^[ _-]+$/.test(part)) return part.includes("-") ? "-" : " ";
      return APPROVED_ACRONYMS[part] || `${part[0].toUpperCase()}${part.slice(1)}`;
    })
    .join("")
    .replaceAll(/\s+/g, " ");
}
