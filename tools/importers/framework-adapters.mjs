import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relationDetails } from './zero-trust-workbook-adapter.mjs';

const AI_RMF_SOURCE = 'nist-ai-rmf-playbook';
const SSDF_SOURCE = 'nist-ssdf-oscal';
const FEDRAMP_SOURCE = 'fedramp-rev5';
const FIPS_199_SOURCE = 'nist-fips-199';
const FIPS_200_SOURCE = 'nist-fips-200';
const NIST_800_37_SOURCE = 'nist-800-37-rev2';
const NIST_800_53B_SOURCE = 'nist-800-53b-baselines';
const CMMC_SOURCE = 'dod-cmmc-rule';
const DOD_RAI_SOURCE = 'dod-rai-toolkit';
const DOD_ZT_RA_SOURCE = 'dod-zt-reference-architecture-v2';
const DOD_ZT_CAPABILITIES_SOURCE = 'dod-zt-capabilities';
const DOD_ZT_OVERLAYS_SOURCE = 'dod-zt-overlays-2024';
const NIST_ZT_SOURCE = 'nist-sp-800-207';
const NIST_ZT_IMPLEMENTATION_SOURCE = 'nist-sp-1800-35';
const MICROSOFT_ZT_SOURCE = 'microsoft-zero-trust-maturity-questionnaire-v1-1';
const NIST_IOT_SOURCE = 'nist-iot-device-cybersecurity-requirement-catalogs';
const NIST_MOBILE_THREAT_SOURCE = 'nist-mobile-threat-catalogue';
const ISOO_CUI_SOURCE = 'isoo-cui-regulation';
const NARA_CUI_SOURCE = 'nara-cui-registry';

function source(key, snapshotDate, locator) {
  return { key, snapshot_date: snapshotDate, locator };
}

function cleanText(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(' ');
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stableId(prefix, value) {
  const label = cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54);
  const digest = createHash('sha256').update(String(value)).digest('hex').slice(0, 10).toUpperCase();
  return `${prefix}-${label}-${digest}`;
}

export function parseAiRmfPlaybook(playbook, snapshotDate) {
  const records = (playbook || [])
    .filter((entry) => entry.title && entry.description)
    .map((entry) => ({
      id: cleanText(entry.title),
      type: 'ai-rmf-outcome',
      framework: 'ai-rmf',
      title: cleanText(entry.description),
      family: cleanText(entry.category || entry.type || 'AI RMF'),
      description: cleanText([
        entry.description,
        entry.section_about,
        entry.section_actions,
      ]),
      source: source(AI_RMF_SOURCE, snapshotDate, `playbook.json#${cleanText(entry.title)}`),
    }));
  return { schema_version: '1.0', source_key: AI_RMF_SOURCE, records };
}

function collectProse(parts = []) {
  return parts.flatMap((part) => [
    cleanText(part.prose),
    ...collectProse(part.parts || []),
  ]).filter(Boolean);
}

function walkSsdf(nodes, family, snapshotDate, records) {
  for (const node of nodes || []) {
    const nextFamily = node.controls?.length && !family ? cleanText(node.title) : family;
    if (node.controls?.length) {
      walkSsdf(node.controls, nextFamily, snapshotDate, records);
      continue;
    }
    if (!node.id) continue;
    const id = String(node.id).toUpperCase().replace(/-/g, '.');
    records.push({
      id,
      type: 'ssdf-task',
      framework: 'ssdf',
      title: cleanText(node.title) || id,
      family: nextFamily || 'SSDF',
      description: cleanText(collectProse(node.parts || [])) || cleanText(node.title),
      source: source(SSDF_SOURCE, snapshotDate, `NIST_SP800-218_ver1_catalog.json#${node.id}`),
    });
  }
}

export function parseSsdfCatalog(catalogJson, snapshotDate) {
  const records = [];
  walkSsdf(catalogJson.catalog?.groups, null, snapshotDate, records);
  return { schema_version: '1.0', source_key: SSDF_SOURCE, records };
}

function publicCatalog(sourceKey, snapshotDate, definitions) {
  return {
    schema_version: '1.0',
    source_key: sourceKey,
    records: definitions.map((record) => ({
      ...record,
      source: source(sourceKey, snapshotDate, record.locator),
      locator: undefined,
    })),
  };
}

export function buildFedrampPublicCatalog(snapshotDate, baselineMembership = null) {
  return publicCatalog(FEDRAMP_SOURCE, snapshotDate, [
    { id: 'LI-SAAS', type: 'fedramp-baseline', framework: 'fedramp', title: 'LI-SaaS Baseline', family: 'Rev. 5 Baselines', description: 'FedRAMP Tailored baseline for low-impact software-as-a-service offerings.', status: 'historical', locator: 'rev5/documents-templates/#LI-SaaS', metadata: { controls: baselineMembership?.['LI-SAAS'] || [] } },
    { id: 'LOW', type: 'fedramp-baseline', framework: 'fedramp', title: 'Low Baseline', family: 'Rev. 5 Baselines', description: 'FedRAMP Rev. 5 Low security control baseline.', status: 'historical', locator: 'rev5/documents-templates/#Low', metadata: { controls: baselineMembership?.['LOW'] || [] } },
    { id: 'MODERATE', type: 'fedramp-baseline', framework: 'fedramp', title: 'Moderate Baseline', family: 'Rev. 5 Baselines', description: 'FedRAMP Rev. 5 Moderate security control baseline.', status: 'historical', locator: 'rev5/documents-templates/#Moderate', metadata: { controls: baselineMembership?.['MODERATE'] || [] } },
    { id: 'HIGH', type: 'fedramp-baseline', framework: 'fedramp', title: 'High Baseline', family: 'Rev. 5 Baselines', description: 'FedRAMP Rev. 5 High security control baseline.', status: 'historical', locator: 'rev5/documents-templates/#High', metadata: { controls: baselineMembership?.['HIGH'] || [] } },
  ]);
}

export function buildFips199Catalog(snapshotDate) {
  return publicCatalog(FIPS_199_SOURCE, snapshotDate, [
    {
      id: 'FIPS-199-LOW',
      type: 'fips-199-impact-category',
      framework: 'fips-199',
      title: 'Low Impact',
      family: 'Security Categorization',
      description: 'Potential impact is low when a loss of confidentiality, integrity, or availability could be expected to have a limited adverse effect on organizational operations, organizational assets, or individuals.',
      locator: 'fips-199#low-impact',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53b', target_id: 'LOW', relationship_type: 'selects' },
        ],
      },
    },
    {
      id: 'FIPS-199-MODERATE',
      type: 'fips-199-impact-category',
      framework: 'fips-199',
      title: 'Moderate Impact',
      family: 'Security Categorization',
      description: 'Potential impact is moderate when a loss of confidentiality, integrity, or availability could be expected to have a serious adverse effect on organizational operations, organizational assets, or individuals.',
      locator: 'fips-199#moderate-impact',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53b', target_id: 'MODERATE', relationship_type: 'selects' },
        ],
      },
    },
    {
      id: 'FIPS-199-HIGH',
      type: 'fips-199-impact-category',
      framework: 'fips-199',
      title: 'High Impact',
      family: 'Security Categorization',
      description: 'Potential impact is high when a loss of confidentiality, integrity, or availability could be expected to have a severe or catastrophic adverse effect on organizational operations, organizational assets, or individuals.',
      locator: 'fips-199#high-impact',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53b', target_id: 'HIGH', relationship_type: 'selects' },
        ],
      },
    },
  ]);
}

export function buildFips200Catalog(snapshotDate) {
  return publicCatalog(FIPS_200_SOURCE, snapshotDate, [
    { id: 'AC', type: 'fips-200-requirement', framework: 'fips-200', title: 'Access Control', family: 'Minimum Security Requirements', description: 'Limit information system access to authorized users, processes acting on behalf of authorized users, and devices.', locator: 'fips-200#access-control', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-AC', relationship_type: 'references' }] } },
    { id: 'AT', type: 'fips-200-requirement', framework: 'fips-200', title: 'Awareness and Training', family: 'Minimum Security Requirements', description: 'Ensure that managers and users understand and practice security responsibilities before authorizing access.', locator: 'fips-200#awareness-and-training', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-AT', relationship_type: 'references' }] } },
    { id: 'AU', type: 'fips-200-requirement', framework: 'fips-200', title: 'Audit and Accountability', family: 'Minimum Security Requirements', description: 'Create, protect, and retain information system audit records and provide accountability for actions affecting the system.', locator: 'fips-200#audit-and-accountability', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-AU', relationship_type: 'references' }] } },
    { id: 'CA', type: 'fips-200-requirement', framework: 'fips-200', title: 'Security Assessment and Authorization', family: 'Minimum Security Requirements', description: 'Assess security controls, determine residual risk, and authorize information systems before operation.', locator: 'fips-200#security-assessment-and-authorization', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-CA', relationship_type: 'references' }] } },
    { id: 'CM', type: 'fips-200-requirement', framework: 'fips-200', title: 'Configuration Management', family: 'Minimum Security Requirements', description: 'Establish and maintain baseline configurations and controlled changes to information systems.', locator: 'fips-200#configuration-management', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-CM', relationship_type: 'references' }] } },
    { id: 'CP', type: 'fips-200-requirement', framework: 'fips-200', title: 'Contingency Planning', family: 'Minimum Security Requirements', description: 'Establish, maintain, and test emergency response, backup, and recovery capabilities for information systems.', locator: 'fips-200#contingency-planning', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-CP', relationship_type: 'references' }] } },
    { id: 'IA', type: 'fips-200-requirement', framework: 'fips-200', title: 'Identification and Authentication', family: 'Minimum Security Requirements', description: 'Identify system users, processes, and devices and authenticate identities before allowing access.', locator: 'fips-200#identification-and-authentication', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-IA', relationship_type: 'references' }] } },
    { id: 'IR', type: 'fips-200-requirement', framework: 'fips-200', title: 'Incident Response', family: 'Minimum Security Requirements', description: 'Establish operational capabilities to respond to and recover from security incidents.', locator: 'fips-200#incident-response', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-IR', relationship_type: 'references' }] } },
    { id: 'MA', type: 'fips-200-requirement', framework: 'fips-200', title: 'Maintenance', family: 'Minimum Security Requirements', description: 'Perform timely and controlled maintenance on information systems and system components.', locator: 'fips-200#maintenance', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-MA', relationship_type: 'references' }] } },
    { id: 'MP', type: 'fips-200-requirement', framework: 'fips-200', title: 'Media Protection', family: 'Minimum Security Requirements', description: 'Protect information system media during transport, storage, access, and disposal.', locator: 'fips-200#media-protection', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-MP', relationship_type: 'references' }] } },
    { id: 'PE', type: 'fips-200-requirement', framework: 'fips-200', title: 'Physical and Environmental Protection', family: 'Minimum Security Requirements', description: 'Limit physical access to information systems and protect facilities and infrastructure from environmental hazards.', locator: 'fips-200#physical-and-environmental-protection', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-PE', relationship_type: 'references' }] } },
    { id: 'PL', type: 'fips-200-requirement', framework: 'fips-200', title: 'Planning', family: 'Minimum Security Requirements', description: 'Develop, document, and maintain security plans describing system boundaries, controls, and operating conditions.', locator: 'fips-200#planning', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-PL', relationship_type: 'references' }] } },
    { id: 'PS', type: 'fips-200-requirement', framework: 'fips-200', title: 'Personnel Security', family: 'Minimum Security Requirements', description: 'Ensure that individuals occupying positions of responsibility are trustworthy and meet established security criteria.', locator: 'fips-200#personnel-security', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-PS', relationship_type: 'references' }] } },
    { id: 'RA', type: 'fips-200-requirement', framework: 'fips-200', title: 'Risk Assessment', family: 'Minimum Security Requirements', description: 'Assess risk to organizational operations, assets, individuals, and other organizations resulting from system operation.', locator: 'fips-200#risk-assessment', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-RA', relationship_type: 'references' }] } },
    { id: 'SA', type: 'fips-200-requirement', framework: 'fips-200', title: 'System and Services Acquisition', family: 'Minimum Security Requirements', description: 'Integrate security into acquisition, development, and external service usage throughout the system lifecycle.', locator: 'fips-200#system-and-services-acquisition', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-SA', relationship_type: 'references' }] } },
    { id: 'SC', type: 'fips-200-requirement', framework: 'fips-200', title: 'System and Communications Protection', family: 'Minimum Security Requirements', description: 'Monitor, control, and protect organizational communications and system boundaries.', locator: 'fips-200#system-and-communications-protection', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-SC', relationship_type: 'references' }] } },
    { id: 'SI', type: 'fips-200-requirement', framework: 'fips-200', title: 'System and Information Integrity', family: 'Minimum Security Requirements', description: 'Identify, report, and correct information and information system flaws in a timely manner and protect against malicious code.', locator: 'fips-200#system-and-information-integrity', metadata: { relationships: [{ target_catalog: 'nist-800-53', target_id: 'FAMILY-SI', relationship_type: 'references' }] } },
  ]);
}

export function buildNist80053BBaselineCatalog(snapshotDate) {
  return publicCatalog(NIST_800_53B_SOURCE, snapshotDate, [
    { id: 'LOW', type: 'nist-800-53b-baseline', framework: 'nist-800-53b', title: 'Low Impact Baseline', family: 'NIST SP 800-53B Baselines', description: 'NIST SP 800-53B low impact baseline for federal information systems.', locator: 'sp800-53b#low' },
    { id: 'MODERATE', type: 'nist-800-53b-baseline', framework: 'nist-800-53b', title: 'Moderate Impact Baseline', family: 'NIST SP 800-53B Baselines', description: 'NIST SP 800-53B moderate impact baseline for federal information systems.', locator: 'sp800-53b#moderate' },
    { id: 'HIGH', type: 'nist-800-53b-baseline', framework: 'nist-800-53b', title: 'High Impact Baseline', family: 'NIST SP 800-53B Baselines', description: 'NIST SP 800-53B high impact baseline for federal information systems.', locator: 'sp800-53b#high' },
    { id: 'PRIVACY', type: 'nist-800-53b-baseline', framework: 'nist-800-53b', title: 'Privacy Baseline', family: 'NIST SP 800-53B Baselines', description: 'NIST SP 800-53B privacy baseline for federal information systems.', locator: 'sp800-53b#privacy' },
  ]);
}

export function buildRmfCatalog(snapshotDate) {
  return publicCatalog(NIST_800_37_SOURCE, snapshotDate, [
    {
      id: 'RMF-PREPARE',
      type: '800-37-step',
      framework: '800-37',
      title: 'Prepare',
      family: 'Risk Management Framework',
      description: 'Carry out essential activities to prepare the organization and system for managing security and privacy risk using the RMF.',
      locator: 'sp800-37#prepare',
      metadata: {
        relationships: [
          { target_catalog: 'fips-200', target_id: 'AC', relationship_type: 'references' },
        ],
      },
    },
    {
      id: 'RMF-CATEGORIZE',
      type: '800-37-step',
      framework: '800-37',
      title: 'Categorize',
      family: 'Risk Management Framework',
      description: 'Categorize the system and the information processed, stored, and transmitted by the system based on impact analysis.',
      locator: 'sp800-37#categorize',
      metadata: {
        relationships: [
          { target_catalog: 'fips-199', target_id: 'FIPS-199-LOW', relationship_type: 'uses' },
          { target_catalog: 'fips-199', target_id: 'FIPS-199-MODERATE', relationship_type: 'uses' },
          { target_catalog: 'fips-199', target_id: 'FIPS-199-HIGH', relationship_type: 'uses' },
        ],
      },
    },
    {
      id: 'RMF-SELECT',
      type: '800-37-step',
      framework: '800-37',
      title: 'Select',
      family: 'Risk Management Framework',
      description: 'Select an initial set of security and privacy controls for the system and tailor them as needed.',
      locator: 'sp800-37#select',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53b', target_id: 'LOW', relationship_type: 'selects' },
          { target_catalog: 'nist-800-53b', target_id: 'MODERATE', relationship_type: 'selects' },
          { target_catalog: 'nist-800-53b', target_id: 'HIGH', relationship_type: 'selects' },
          { target_catalog: 'nist-800-53b', target_id: 'PRIVACY', relationship_type: 'selects' },
        ],
      },
    },
    {
      id: 'RMF-IMPLEMENT',
      type: '800-37-step',
      framework: '800-37',
      title: 'Implement',
      family: 'Risk Management Framework',
      description: 'Implement the selected controls within the system and organization and document how they are deployed.',
      locator: 'sp800-37#implement',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53', target_id: 'FAMILY-AC', relationship_type: 'uses' },
        ],
      },
    },
    {
      id: 'RMF-ASSESS',
      type: '800-37-step',
      framework: '800-37',
      title: 'Assess',
      family: 'Risk Management Framework',
      description: 'Assess the implemented controls to determine if they are effective and producing the intended outcomes.',
      locator: 'sp800-37#assess',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53', target_id: 'FAMILY-AC', relationship_type: 'uses' },
        ],
      },
    },
    {
      id: 'RMF-AUTHORIZE',
      type: '800-37-step',
      framework: '800-37',
      title: 'Authorize',
      family: 'Risk Management Framework',
      description: 'Determine if the remaining risk is acceptable and authorize the system or common controls for operation.',
      locator: 'sp800-37#authorize',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53b', target_id: 'LOW', relationship_type: 'applies_to' },
          { target_catalog: 'nist-800-53b', target_id: 'MODERATE', relationship_type: 'applies_to' },
          { target_catalog: 'nist-800-53b', target_id: 'HIGH', relationship_type: 'applies_to' },
        ],
      },
    },
    {
      id: 'RMF-MONITOR',
      type: '800-37-step',
      framework: '800-37',
      title: 'Monitor',
      family: 'Risk Management Framework',
      description: 'Continuously monitor controls and system changes to maintain ongoing awareness of risk and security posture.',
      locator: 'sp800-37#monitor',
      metadata: {
        relationships: [
          { target_catalog: 'nist-800-53', target_id: 'FAMILY-AC', relationship_type: 'uses' },
        ],
      },
    },
  ]);
}

export function buildCmmcPublicCatalog(snapshotDate) {
  return publicCatalog(CMMC_SOURCE, snapshotDate, [
    { id: 'LEVEL-1', type: 'cmmc-level', framework: 'cmmc', title: 'CMMC Level 1', family: 'CMMC 2.0 Levels', description: 'Safeguarding Federal Contract Information using the 15 requirements in FAR 52.204-21.', locator: '32-CFR-170.14(c)(2)', metadata: { dependencies: ['FAR 52.204-21'] } },
    { id: 'LEVEL-2', type: 'cmmc-level', framework: 'cmmc', title: 'CMMC Level 2', family: 'CMMC 2.0 Levels', description: 'Protecting Controlled Unclassified Information using the 110 requirements in NIST SP 800-171 Revision 2.', locator: '32-CFR-170.14(c)(3)', metadata: { dependencies: ['NIST SP 800-171 Rev. 2'], requires_800_171_rev: 'rev2' } },
    { id: 'LEVEL-3', type: 'cmmc-level', framework: 'cmmc', title: 'CMMC Level 3', family: 'CMMC 2.0 Levels', description: 'Protecting Controlled Unclassified Information using selected NIST SP 800-172 requirements and DoD-defined parameters.', locator: '32-CFR-170.14(c)(4)', metadata: { dependencies: ['NIST SP 800-171 Rev. 2', 'NIST SP 800-172'], requires_800_172: true } },
  ]);
}

function cuiCategoryId(slug) {
  return `CATEGORY-${String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
}

// spec §7 — real NARA CUI Registry categories, subcategories, markings,
// authorities, Basic/Specified status, and sanctions, read from the manifest
// scripts/fetch-nara-cui-registry.mjs produces (real HTML-table extraction
// from archives.gov/cui/registry, not hand-authored). Falls back to an empty
// list (anchors only) if the manifest hasn't been fetched yet in this
// environment, so the catalog build never throws on a missing file.
function loadNaraCuiCategories(registryManifestPath) {
  if (!registryManifestPath) return [];
  try {
    const manifest = JSON.parse(readFileSync(registryManifestPath, 'utf8'));
    return (manifest.results || []).filter((entry) => entry.status === 'OK');
  } catch {
    return [];
  }
}

export function buildCuiPolicyCatalog(snapshotDate, registryManifestPath) {
  const anchors = [
    {
      id: 'CUI-PROGRAM',
      type: 'cui-policy',
      framework: 'cui-policy',
      title: 'CUI Program',
      family: 'Controlled Unclassified Information',
      description: 'The CUI Program is the executive branch-wide program to standardize CUI handling across federal agencies.',
      source: source(ISOO_CUI_SOURCE, snapshotDate, '32-cfr-part-2002#cui-program'),
    },
    {
      id: 'CUI-BASIC',
      type: 'cui-policy',
      framework: 'cui-policy',
      title: 'CUI Basic',
      family: 'Controlled Unclassified Information',
      description: 'CUI Basic covers information for which the underlying authority does not specify handling controls beyond the uniform CUI controls.',
      source: source(NARA_CUI_SOURCE, snapshotDate, 'registry/category-list#cui-basic'),
    },
    {
      id: 'CUI-SPECIFIED',
      type: 'cui-policy',
      framework: 'cui-policy',
      title: 'CUI Specified',
      family: 'Controlled Unclassified Information',
      description: 'CUI Specified covers information whose underlying authority provides specific handling or dissemination controls.',
      source: source(NARA_CUI_SOURCE, snapshotDate, 'registry/category-list#cui-specified'),
    },
  ];

  const categories = loadNaraCuiCategories(registryManifestPath).map((entry) => {
    // MIXED categories have at least one Basic-tier authority alongside
    // Specified ones; UNKNOWN means the detail page had no safeguarding-
    // authority table to classify from (real gap on NARA's page, not ours).
    const parentDesignation =
      entry.designation === 'CUI-SPECIFIED' ? 'CUI-SPECIFIED'
      : entry.designation === 'CUI-BASIC' || entry.designation === 'MIXED' ? 'CUI-BASIC'
      : 'CUI-PROGRAM';
    return {
      id: cuiCategoryId(entry.slug),
      type: 'cui-category',
      framework: 'cui-policy',
      title: entry.title,
      family: entry.grouping,
      description: entry.description || entry.title,
      source: source(NARA_CUI_SOURCE, snapshotDate, `registry/category-detail/${entry.slug}`),
      metadata: {
        parent_designation: parentDesignation,
        designation: entry.designation,
        banner_marking: entry.banner_marking,
        category_marking: entry.category_marking,
        alternative_banner_markings: entry.alternative_banner_markings,
        authorities: entry.authorities,
        detail_url: entry.detail_url,
        last_modified: entry.last_modified,
        sha256: entry.sha256,
        byte_length: entry.byte_length,
      },
    };
  });

  return {
    schema_version: '1.0',
    source_key: ISOO_CUI_SOURCE,
    records: [...anchors, ...categories],
  };
}

export function buildDodRaiPublicCatalog(snapshotDate) {
  return publicCatalog(DOD_RAI_SOURCE, snapshotDate, [
    { id: 'PRINCIPLE-MODULAR', type: 'rai-toolkit-principle', framework: 'dod-rai', title: 'Modular and Tailorable', family: 'Toolkit Focus Principles', description: 'Apply the toolkit in a modular and tailorable way.', locator: 'executive-summary#modular-and-tailorable' },
    { id: 'PRINCIPLE-RASCI', type: 'rai-toolkit-principle', framework: 'dod-rai', title: 'Aligned to RASCI Matrix', family: 'Toolkit Focus Principles', description: 'Align responsible AI activities with accountable roles.', locator: 'executive-summary#rasci-matrix' },
    { id: 'PRINCIPLE-HOLISTIC', type: 'rai-toolkit-principle', framework: 'dod-rai', title: 'Holistic', family: 'Toolkit Focus Principles', description: 'Assess responsible AI holistically across the lifecycle.', locator: 'executive-summary#holistic' },
    { id: 'PRINCIPLE-ETHICS', type: 'rai-toolkit-principle', framework: 'dod-rai', title: 'DoW AI Ethical Principles', family: 'Toolkit Focus Principles', description: 'Operationalize Department of War AI Ethical Principles.', locator: 'executive-summary#ethical-principles' },
    { id: 'PRINCIPLE-TOOLS', type: 'rai-toolkit-principle', framework: 'dod-rai', title: 'Tools List', family: 'Toolkit Focus Principles', description: 'Use a maintained list of supporting responsible AI tools.', locator: 'executive-summary#tools-list' },
    { id: 'SHIELD-SET', type: 'rai-shield-activity', framework: 'dod-rai', title: 'Set Foundations', family: 'SHIELD Activities', description: 'Set foundations for responsible AI.', locator: 'executive-summary#shield-set' },
    { id: 'SHIELD-HONE', type: 'rai-shield-activity', framework: 'dod-rai', title: 'Hone Operationalizations', family: 'SHIELD Activities', description: 'Hone responsible AI operationalizations.', locator: 'executive-summary#shield-hone' },
    { id: 'SHIELD-IMPROVE', type: 'rai-shield-activity', framework: 'dod-rai', title: 'Improve and Innovate', family: 'SHIELD Activities', description: 'Improve and innovate responsible AI practices.', locator: 'executive-summary#shield-improve' },
    { id: 'SHIELD-EVALUATE', type: 'rai-shield-activity', framework: 'dod-rai', title: 'Evaluate Status', family: 'SHIELD Activities', description: 'Evaluate responsible AI status.', locator: 'executive-summary#shield-evaluate' },
    { id: 'SHIELD-LOG', type: 'rai-shield-activity', framework: 'dod-rai', title: 'Log for Traceability', family: 'SHIELD Activities', description: 'Log responsible AI decisions and evidence for traceability.', locator: 'executive-summary#shield-log' },
    { id: 'SHIELD-DETECT', type: 'rai-shield-activity', framework: 'dod-rai', title: 'Detect via Continuous Monitoring', family: 'SHIELD Activities', description: 'Detect responsible AI concerns through continuous monitoring.', locator: 'executive-summary#shield-detect' },
  ]);
}

function capabilityRecordId(rawId) {
  return `CAP-${String(rawId).replace('.', '-')}`;
}

function activityRecordId(rawId) {
  return `ACT-${String(rawId).replace(/\./g, '-')}`;
}

export function buildDodZeroTrustCatalog(snapshotDate, curatedRoot) {
  const readJson = (filename) => JSON.parse(readFileSync(join(curatedRoot, filename), 'utf8'));
  const taxonomy = readJson('taxonomy.json');
  const capabilitiesDoc = readJson('capabilities.json');
  const activitiesDoc = readJson('activities.json');
  const records = [];

  for (const tenet of taxonomy.tenets) {
    records.push({
      id: tenet.id,
      type: 'zt_tenet',
      framework: 'dod-zt',
      title: tenet.title,
      family: 'Zero Trust Tenets',
      description: tenet.description,
      locator: tenet.locator,
      source: source(tenet.source_key || DOD_ZT_RA_SOURCE, snapshotDate, tenet.locator),
      metadata: { source_fragments: tenet.source_fragments || [] },
    });
  }

  for (const pillar of taxonomy.pillars) {
    records.push({
      id: pillar.id,
      type: 'zt_pillar',
      framework: 'dod-zt',
      title: pillar.title,
      family: pillar.family || 'Zero Trust Pillars',
      description: pillar.description,
      locator: pillar.locator,
      source: source(pillar.source_key || DOD_ZT_RA_SOURCE, snapshotDate, pillar.locator),
      metadata: {
        pillar_number: pillar.number || null,
        source_fragments: pillar.source_fragments || [],
      },
    });
  }

  for (const doc of taxonomy.documents.filter((entry) => entry.atlas_role === 'primary_publication')) {
    records.push({
      id: doc.id,
      type: 'zt_document',
      framework: 'dod-zt',
      title: doc.title,
      family: 'Zero Trust Documents',
      description: doc.description,
      locator: doc.locator,
      source: source(doc.source_key, snapshotDate, doc.locator),
      metadata: {
        atlas_role: doc.atlas_role,
        document_sections: doc.document_sections || [],
        source_fragments: doc.description_source_fragments || [],
        disambiguation: doc.disambiguation || null,
        relationships: (doc.relationships || []).map((relationship) => ({
          ...relationship,
          rationale: `${doc.title} references ${relationship.target_id}.`,
        })),
        page_count: doc.page_count,
        checksum: doc.checksum,
        source_url: doc.source_url,
      },
    });
  }

  for (const capability of capabilitiesDoc.records) {
    const id = capabilityRecordId(capability.id);
    records.push({
      id,
      type: 'zt_capability',
      framework: 'dod-zt',
      title: `${capability.id} ${capability.title}`,
      family: capability.pillar_name || capability.pillar_id,
      description: [capability.description, capability.outcome, capability.impact].filter(Boolean).join(' '),
      locator: capability.locator,
      source: source(capability.source_key || DOD_ZT_CAPABILITIES_SOURCE, snapshotDate, capability.locator),
      metadata: {
        capability_id: capability.id,
        pillar_id: capability.pillar_id,
        level: capability.level,
        outcome: capability.outcome,
        impact: capability.impact,
        associated_activities: capability.associated_activities || [],
        source_fragments: capability.source_fragments || [],
      },
    });
  }

  for (const activity of activitiesDoc.records) {
    const capabilityId = capabilityRecordId(activity.capability_id);
    records.push({
      id: activityRecordId(activity.id),
      type: 'zt_activity',
      framework: 'dod-zt',
      title: `${activity.id} ${activity.title}`,
      family: 'Zero Trust Activities',
      description: [activity.description, activity.outcomes, activity.end_state].filter(Boolean).join('\n\n'),
      locator: activity.locator,
      source: source(activity.source_key || DOD_ZT_CAPABILITIES_SOURCE, snapshotDate, activity.locator),
      metadata: {
        activity_id: activity.id,
        capability_id: capabilityId,
        level: activity.level,
        pillar: activity.pillar,
        responsibility: activity.responsibility || null,
        activity_type: activity.activity_type,
        duration: activity.duration || null,
        outcomes: activity.outcomes || null,
        end_state: activity.end_state || null,
        predecessors: activity.predecessors || [],
        successors: activity.successors || [],
        operational_technology: activity.operational_technology === true,
        source_fragments: activity.source_fragments || [],
      },
    });
  }

  return { schema_version: '1.0', source_key: DOD_ZT_RA_SOURCE, record_count: records.length, records };
}

function normalizedNistTarget(mapping) {
  if (mapping.mapping_kind === 'csf_2') {
    return {
      target_catalog: 'csf-2',
      target_id: /-\d+$/.test(mapping.target_id) ? mapping.target_id : `CATEGORY-${mapping.target_id}`,
    };
  }
  if (mapping.mapping_kind === 'sp_800_53') {
    const match = mapping.target_id.match(/^([A-Z]{2,3})-0*(\d+)(?:\(0*(\d+)\))?$/);
    if (!match) return null;
    return { target_catalog: 'nist-800-53', target_id: `${match[1]}-${match[2]}${match[3] ? `.${match[3]}` : ''}` };
  }
  return null;
}

function artifactIdsFromFragments(fragments = []) {
  return [...new Set(
    fragments
      .map((fragment) => fragment?.source_key)
      .filter(Boolean)
      .map((sourceKey) => `artifact-${sourceKey}`),
  )];
}

function nistBuildArtifactIds(build) {
  const prefix = `artifact-nist-sp-1800-35-${build.code.toLowerCase()}`;
  return [`${prefix}-architecture`, `${prefix}-guide`];
}

export function buildNistZeroTrustCatalog(snapshotDate, curatedRoot) {
  const readJson = (filename) => JSON.parse(readFileSync(join(curatedRoot, filename), 'utf8'));
  const core = readJson('sp800-207-core.json');
  const cloudNative = readJson('sp800-207a-core.json');
  const overview = readJson('sp1800-35-overview.json');
  const builds = readJson('sp1800-35-builds.json').records;
  const mappings = readJson('mappings.json').records;
  const workbookManifest = readJson('structured-source-manifest.json');
  const records = [
    {
      id: 'SP800-207',
      type: 'zt_publication',
      framework: 'nist-zt',
      title: core.overview.title,
      family: 'NIST Zero Trust Publications',
      description: core.overview.description,
      locator: core.overview.locator,
      source: source(NIST_ZT_SOURCE, snapshotDate, core.overview.locator),
      metadata: { parent_id: 'CATALOG', source_fragments: core.overview.source_fragments },
    },
  ];
  records.push({
    id: 'SP800-207A',
    type: 'zt_publication',
    framework: 'nist-zt',
    title: cloudNative.overview.title,
    family: 'NIST Zero Trust Publications',
    description: cloudNative.overview.description,
    locator: cloudNative.overview.locator,
    source: source('nist-sp-800-207a', snapshotDate, cloudNative.overview.locator),
    metadata: {
      parent_id: 'CATALOG',
      source_fragments: cloudNative.overview.source_fragments,
      primary_artifact_id: 'artifact-nist-sp-800-207a',
      relationships: [{
        target_catalog: 'nist-zt',
        target_id: 'SP800-207',
        relationship_type: 'extends',
        source_id: 'nist-sp-800-207a',
        source_locator: cloudNative.overview.locator,
        rationale: 'NIST SP 800-207A applies the SP 800-207 zero trust model to cloud-native applications in multi-location environments.',
      }],
    },
  });
  const abstractBlocks = overview.sections.flatMap((section) => section.structured_content)
    .filter((block) => block.type === 'paragraph' && /zero trust architecture/i.test(block.text || ''));
  records.push({
    id: 'SP1800-35',
    type: 'zt_publication',
    framework: 'nist-zt',
    title: 'NIST SP 1800-35 Implementing a Zero Trust Architecture',
    family: 'NIST Zero Trust Publications',
    description: abstractBlocks.slice(0, 2).map((block) => block.text).join(' '),
    locator: 'https://pages.nist.gov/zero-trust-architecture/',
    source: source(NIST_ZT_IMPLEMENTATION_SOURCE, snapshotDate, 'https://pages.nist.gov/zero-trust-architecture/'),
    metadata: {
      structured_content: abstractBlocks.slice(0, 2),
      parent_id: 'CATALOG',
      source_fragments: overview.sections.flatMap((section) => section.source_fragments)
        .filter((fragment) => abstractBlocks.some((block) => block.text === fragment.text)),
    },
  });

  for (const tenet of core.tenets) {
    records.push({
      id: tenet.id,
      type: 'zt_tenet',
      framework: 'nist-zt',
      title: tenet.title,
      family: 'SP 800-207 Tenets',
      description: tenet.description,
      locator: tenet.locator,
      source: source(NIST_ZT_SOURCE, snapshotDate, tenet.locator),
      metadata: { parent_id: 'SP800-207', tenet_number: tenet.number, source_fragments: tenet.source_fragments },
    });
  }
  for (const component of core.components) {
    records.push({
      id: component.id,
      type: 'zt_logical_component',
      framework: 'nist-zt',
      title: component.title,
      family: component.component_class === 'core' ? 'Core Logical Components' : 'Supporting Logical Components',
      description: component.description,
      locator: component.locator,
      source: source(NIST_ZT_SOURCE, snapshotDate, component.locator),
      metadata: { parent_id: 'SP800-207', component_class: component.component_class, source_fragments: component.source_fragments },
    });
  }
  for (const requirement of cloudNative.requirements) {
    records.push({
      id: `SP800207A-${requirement.id}`,
      type: 'zt_cloud_native_requirement',
      framework: 'nist-zt',
      title: `${requirement.id} ${requirement.title}`,
      family: requirement.id.startsWith('ID-SEG')
        ? 'Identity-Based Segmentation Policies'
        : requirement.id.startsWith('MON-CNA')
          ? 'Cloud-Native Monitoring Requirements'
          : 'Monitoring Data Uses',
      description: requirement.description,
      locator: requirement.locator,
      source: source('nist-sp-800-207a', snapshotDate, requirement.locator),
      metadata: {
        parent_id: 'SP800-207A',
        publisher_identifier: requirement.id,
        source_fragments: requirement.source_fragments,
        primary_artifact_id: 'artifact-nist-sp-800-207a',
      },
    });
  }
  for (const build of builds) {
    const summary = build.architecture_sections.flatMap((section) => section.structured_content)
      .find((block) => block.type === 'paragraph' && !/^Note$/.test(block.text || '') && !/supplementary material/.test(block.text || ''));
    records.push({
      id: build.id,
      type: 'zt_build',
      framework: 'nist-zt',
      title: build.title,
      family: 'SP 1800-35 Example Implementations',
      description: summary?.text || build.title,
      locator: build.architecture_url,
      source: source(NIST_ZT_IMPLEMENTATION_SOURCE, snapshotDate, build.architecture_url),
      metadata: {
        parent_id: 'SP1800-35',
        build_code: build.code,
        architecture_sections: build.architecture_sections,
        implementation_sections: build.implementation_sections,
        media: build.media,
        related_build_codes: build.related_build_codes,
        implementation_guide_url: build.implementation_guide_url,
        source_pages: build.source_pages,
        contributing_artifact_ids: nistBuildArtifactIds(build),
      },
    });
  }

  const collaboratorContext = overview.sections
    .flatMap((section) => section.source_fragments)
    .find((fragment) => /Technology Collaborators who participated in this project/.test(fragment.text || ''));
  if (!collaboratorContext) throw new Error('NIST SP 1800-35 technology collaborator context is missing');
  const collaboratorRoster = overview.sections.flatMap((section) => section.source_fragments)
    .filter((fragment) => {
      const match = /:block-(\d+)$/.exec(fragment.locator || '');
      return fragment.source_key === NIST_ZT_IMPLEMENTATION_SOURCE
        && match
        && Number(match[1]) >= 189
        && Number(match[1]) <= 212;
    });
  if (collaboratorRoster.length !== 24) {
    throw new Error(`Expected 24 NIST SP 1800-35 technology collaborators, found ${collaboratorRoster.length}`);
  }
  for (const collaborator of collaboratorRoster) {
    records.push({
      id: stableId('COLLABORATOR', collaborator.text),
      type: 'zt_collaborator',
      framework: 'nist-zt',
      title: collaborator.text,
      family: 'SP 1800-35 Technology Collaborators',
      description: collaboratorContext.text,
      locator: collaborator.locator,
      source: source(NIST_ZT_IMPLEMENTATION_SOURCE, snapshotDate, collaborator.locator),
      metadata: {
        parent_id: 'SP1800-35',
        publisher_context: collaboratorContext.text,
        source_fragments: [collaborator],
        contributing_artifact_ids: artifactIdsFromFragments([collaborator]),
      },
    });
  }

  const aggregate = new Map();
  for (const mapping of mappings) {
    const collaborator = mapping.collaborator;
    const key = collaborator
      ? `product\0${collaborator}\0${mapping.product}\0${mapping.architecture_component}\0${mapping.component_function}`
      : `reference\0${mapping.architecture_component}\0${mapping.component_function}`;
    if (!aggregate.has(key)) {
      aggregate.set(key, {
        collaborator,
        product: mapping.product,
        architecture_component: mapping.architecture_component,
        component_function: mapping.component_function,
        mappings: [],
        source_fragments: [],
      });
    }
    const entry = aggregate.get(key);
    entry.mappings.push(mapping);
    entry.source_fragments.push(...mapping.source_fragments);
  }
  const mappingContributors = new Map();
  for (const entry of aggregate.values()) {
    if (!entry.collaborator) continue;
    const id = stableId('MAPPING-CONTRIBUTOR', entry.collaborator);
    if (!mappingContributors.has(id)) mappingContributors.set(id, { id, name: entry.collaborator, fragment: entry.source_fragments[0] });
  }
  for (const contributor of mappingContributors.values()) {
    records.push({
      id: contributor.id,
      type: 'zt_mapping_contributor',
      framework: 'nist-zt',
      title: contributor.name,
      family: 'SP 1800-35 Mapping Workbook Contributors',
      description: contributor.fragment.text,
      locator: contributor.fragment.locator || 'https://pages.nist.gov/zero-trust-architecture/VolumeE/Mappings.html',
      source: source(NIST_ZT_IMPLEMENTATION_SOURCE, snapshotDate, 'https://pages.nist.gov/zero-trust-architecture/VolumeE/Mappings.html'),
      metadata: {
        parent_id: 'SP1800-35',
        publisher_field: 'Collaborator',
        source_fragments: [contributor.fragment],
        contributing_artifact_ids: artifactIdsFromFragments([contributor.fragment]),
      },
    });
  }
  for (const entry of aggregate.values()) {
    const valueKey = `${entry.collaborator || 'reference'}\0${entry.product || ''}\0${entry.architecture_component}\0${entry.component_function}`;
    const id = stableId(entry.collaborator ? 'PRODUCT-COMPONENT' : 'REFERENCE-COMPONENT', valueKey);
    const parentId = entry.collaborator ? stableId('MAPPING-CONTRIBUTOR', entry.collaborator) : 'SP1800-35';
    const relationshipByKey = new Map();
    const unresolvedMappings = [];
    for (const mapping of entry.mappings) {
      // Re-evaluate the retained publisher text as well as future workbook
      // fetches. This repairs historical parsed directions without altering
      // any original cell text, ID, locator, or content checksum.
      const parsed = relationDetails(mapping.relationship);
      if (parsed.relationship_parse_status === 'unresolved') {
        unresolvedMappings.push({ id: mapping.id, target_id: mapping.target_id,
          mapping_kind: mapping.mapping_kind, locator: mapping.locator,
          relationship: mapping.relationship, reason: 'No explicit relationship type in the publisher cell.' });
        continue;
      }
      const target = normalizedNistTarget(mapping);
      if (!target) continue;
      for (const clause of parsed.relationship_clauses) {
        const relationshipType = clause.relationship_type;
        const key = `${target.target_catalog}\0${target.target_id}\0${relationshipType}`;
        const sourceId = mapping.source_fragments.find((fragment) => fragment.field === 'relationship')?.source_key || mapping.source_fragments[0]?.source_key;
        const assertion = { mapping_id: mapping.id, locator: mapping.locator,
          relationship: parsed.raw_relationship_type, property: clause.property };
        const existing = relationshipByKey.get(key);
        if (existing) {
          if (!existing.source_locators.includes(mapping.locator)) existing.source_locators.push(mapping.locator);
          existing.publisher_assertions.push(assertion);
          if (mapping.relationship_explanation && !existing.rationales.includes(mapping.relationship_explanation)) {
            existing.rationales.push(mapping.relationship_explanation);
            existing.rationale = existing.rationales.join('\n\n');
          }
          continue;
        }
        relationshipByKey.set(key, {
          ...target,
          relationship_type: relationshipType,
          rationale: mapping.relationship_explanation,
          rationales: mapping.relationship_explanation ? [mapping.relationship_explanation] : [],
          source_id: sourceId,
          source_locator: mapping.locator,
          source_locators: [mapping.locator],
          raw_relationship_type: parsed.raw_relationship_type,
          publisher_assertions: [assertion],
        });
      }
    }
    const relationships = [...relationshipByKey.values()];
    records.push({
      id,
      type: entry.collaborator ? 'zt_product_component' : 'zt_reference_component',
      framework: 'nist-zt',
      title: entry.product ? `${entry.product} — ${entry.architecture_component}` : entry.architecture_component,
      family: entry.collaborator || 'SP 1800-35 Reference Architecture',
      description: entry.component_function,
      locator: entry.mappings[0].locator,
      source: source(NIST_ZT_IMPLEMENTATION_SOURCE, snapshotDate, entry.mappings[0].locator),
      metadata: {
        parent_id: parentId,
        collaborator: entry.collaborator,
        product: entry.product,
        architecture_component: entry.architecture_component,
        mapping_count: entry.mappings.length,
        mapping_targets: entry.mappings.map((mapping) => {
          const parsed = relationDetails(mapping.relationship);
          return { kind: mapping.mapping_kind, target_id: mapping.target_id,
            relationship_clauses: parsed.relationship_clauses,
            relationship_parse_status: parsed.relationship_parse_status };
        }),
        relationships,
        ...(unresolvedMappings.length ? { unresolved_mappings: unresolvedMappings } : {}),
        source_fragments: entry.source_fragments,
        contributing_artifact_ids: artifactIdsFromFragments(entry.source_fragments),
      },
    });
  }
  for (const workbook of workbookManifest.sources.filter((entry) => entry.mapping_kind)) {
    records.push({
      id: stableId('MAPPING-DOCUMENT', workbook.source_key),
      type: 'zt_mapping_document',
      framework: 'nist-zt',
      title: workbook.url.split('/').at(-1).replace(/\.xlsx$/i, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2'),
      family: 'SP 1800-35 Mapping Workbooks',
      description: `${workbook.parsed_records} published mapping rows across ${workbook.worksheets.length} worksheets.`,
      locator: workbook.url,
      source: source(workbook.source_key, snapshotDate, workbook.url),
      metadata: { parent_id: 'SP1800-35', checksum: workbook.sha256, byte_length: workbook.byte_length, worksheets: workbook.worksheets },
    });
  }
  return { schema_version: '1.0', source_key: NIST_ZT_SOURCE, records };
}

export function buildMicrosoftZeroTrustQuestionnaireCatalog(snapshotDate, curatedRoot) {
  const document = JSON.parse(readFileSync(join(curatedRoot, 'microsoft-questionnaire.json'), 'utf8'));
  const records = document.records.map((question) => ({
    id: question.id,
    type: 'zt_assessment_question',
    framework: 'microsoft-zt-maturity',
    title: question.question,
    family: question.pillar,
    description: question.more_information,
    locator: question.locator,
    source: source(MICROSOFT_ZT_SOURCE, snapshotDate, question.locator),
    metadata: {
      pillar: question.pillar,
      question_number: question.number,
      category: question.category,
      answer_options: question.answer_options,
      link_label: question.link_label,
      publisher_default_answer: question.publisher_default_answer,
      source_fragments: question.source_fragments,
    },
  }));
  return { schema_version: '1.0', source_key: MICROSOFT_ZT_SOURCE, records };
}

export function buildNistIoTRequirementCatalog(snapshotDate, curatedRoot) {
  const document = JSON.parse(readFileSync(join(curatedRoot, 'iot-requirements.json'), 'utf8'));
  const records = document.records.map((entry) => {
    const firstFragment = entry.source_fragments?.[0];
    const locator = firstFragment?.cell
      ? `https://pages.nist.gov/IoT-Device-Cybersecurity-Requirement-Catalogs/#sheet=${encodeURIComponent(firstFragment.sheet)}&cell=${firstFragment.cell}`
      : 'https://pages.nist.gov/IoT-Device-Cybersecurity-Requirement-Catalogs/';
    return {
      id: entry.id,
      type: entry.type,
      framework: 'nist-iot-cybersecurity',
      title: entry.title,
      family: entry.type === 'iot_capability_domain' ? entry.title : 'IoT Device Cybersecurity Capabilities',
      description: entry.description,
      locator,
      source: source(NIST_IOT_SOURCE, snapshotDate, locator),
      metadata: {
        parent_id: entry.parent_id,
        publisher_status: 'draft',
        publisher_mappings: entry.publisher_mappings,
        relationships: entry.relationships,
        source_fragments: entry.source_fragments,
        contributing_artifact_ids: artifactIdsFromFragments(entry.source_fragments),
      },
    };
  });
  return { schema_version: '1.0', source_key: NIST_IOT_SOURCE, records };
}

export function buildNistMobileThreatCatalog(snapshotDate, curatedRoot) {
  const document = JSON.parse(readFileSync(join(curatedRoot, 'mobile-threats.json'), 'utf8'));
  const records = document.records.map((entry) => ({
    id: entry.id,
    type: entry.type,
    framework: 'nist-mobile-threats',
    title: entry.title,
    family: entry.category || 'NIST Mobile Threat Catalogue',
    // Mobile threat titles and their structured publisher fields are the
    // official record content. Older snapshots included an adapter-generated
    // description for entries without ThreatOrigin; suppress it at the
    // presentation boundary so it cannot be mistaken for a publisher excerpt.
    description: entry.type === 'mobile_threat' ? '' : entry.description,
    locator: entry.locator || 'https://pages.nist.gov/mobile-threat-catalogue/',
    source: source(NIST_MOBILE_THREAT_SOURCE, snapshotDate, entry.locator || 'https://pages.nist.gov/mobile-threat-catalogue/'),
    metadata: {
      parent_id: entry.parent_id,
      threat_origin: entry.threat_origin || null,
      exploit_examples: entry.exploit_examples || [],
      cve_examples: entry.cve_examples || [],
      countermeasures: entry.countermeasures || [],
      source_fragments: entry.source_fragments || [],
    },
  }));
  return { schema_version: '1.0', source_key: NIST_MOBILE_THREAT_SOURCE, records };
}
