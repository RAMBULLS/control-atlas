// Catalog output ownership is explicit; unknown files cannot acquire a baseline.
export const CATALOG_REFRESH_PROFILES = Object.freeze({
  'cmmc-2': 'cmmc-practices', 'csf-2': 'csf-subcategories', 'cui-policy': 'cui-policy',
  'disa-cci': 'ccis', 'disa-srg': 'srg-requirements', 'disa-stig': 'stig-rules',
  'dod-rai': 'dod-rai', 'dod-zt': 'dod-zt', 'fedramp-rev5': 'fedramp-baselines',
  'fedramp-2026': 'fedramp-2026-catalog', 'fips-199': 'fips-199', 'fips-200': 'fips-200',
  'microsoft-zt-maturity': 'microsoft-zt-maturity', 'mitre-attack': 'attack-techniques-enterprise',
  'mitre-attack-ics': 'attack-techniques-ics', 'mitre-d3fend': 'd3fend-countermeasures',
  'nist-800-171': 'requirements-800-171', 'nist-800-171-rev2': 'requirements-800-171-rev2',
  'nist-800-172': 'requirements-800-172', 'nist-800-37': 'tasks-800-37',
  'nist-800-53': 'controls-800-53', 'nist-800-53b': '800-53b-baselines',
  'nist-ai-rmf': 'ai-rmf', 'nist-iot-cybersecurity': 'nist-iot-cybersecurity',
  'nist-mobile-threats': 'nist-mobile-threats', 'nist-ssdf': 'ssdf', 'nist-zt': 'nist-zt',
});

// Published relationship sets a refresh can rewrite, with the direction they are
// published in (source catalog -> target catalog). Their accepted changes are
// recorded in the change log beside catalog changes.
export const RELATIONSHIP_SET_ENDPOINTS = Object.freeze({
  'maps/800-53-to-csf.json': Object.freeze(['nist-800-53', 'csf-2']),
  'maps/800-53-to-800-171.json': Object.freeze(['nist-800-171', 'nist-800-53']),
  'maps/800-171-to-csf.json': Object.freeze(['nist-800-171', 'csf-2']),
  'maps/cci-to-800-53.json': Object.freeze(['disa-cci', 'nist-800-53']),
  'maps/stig-srg-to-cci.json': Object.freeze(['disa-stig', 'disa-cci']),
  'maps/attack-to-d3fend.json': Object.freeze(['mitre-attack', 'mitre-d3fend']),
  'maps/d3fend-to-800-53.json': Object.freeze(['mitre-d3fend', 'nist-800-53']),
});
export const REFRESHED_RELATIONSHIP_SETS = Object.freeze(Object.keys(RELATIONSHIP_SET_ENDPOINTS));

export const INDEPENDENT_REFRESH_CATALOGS = new Set([
  'disa-cci',
  'csf-2', 'fedramp-2026', 'mitre-attack', 'mitre-attack-ics', 'mitre-d3fend',
  'nist-800-171', 'nist-800-171-rev2', 'nist-800-172', 'nist-800-53', 'nist-ai-rmf', 'nist-ssdf',
]);

export const catalogPath = (id) => {
  if (!Object.hasOwn(CATALOG_REFRESH_PROFILES, id)) throw new Error(`Unknown refresh catalog: ${id}`);
  return `data/${CATALOG_REFRESH_PROFILES[id]}.json`;
};

// Publisher-side reconciliation a fetcher must satisfy for a large change to be
// corroborated without a versioned publisher document. Paths are read from a
// manifest the fetch wrote; every `zero` field must be 0 and the parts must
// add up to the publisher's expected total.
const DISA_RECONCILIATION = Object.freeze({
  file: 'data/disa-artifact-manifest.json',
  zero: ['publications.failed_publications', 'publications.missing_publications', 'reconciliation.failed_files'],
  sum: {
    total: 'publications.expected_canonical_publications',
    parts: ['publications.represented_in_compilation', 'publications.standalone_ingested'],
  },
});
export const PUBLISHER_RECONCILIATION = Object.freeze({
  'disa-stig': DISA_RECONCILIATION,
  'disa-srg': DISA_RECONCILIATION,
});

export function publisherReconciled(rule, manifest) {
  if (!rule) return false;
  const field = (path) => path.split('.').reduce((value, key) => value?.[key], manifest);
  if (!rule.zero.every((path) => field(path) === 0)) return false;
  const total = field(rule.sum.total);
  return Number.isSafeInteger(total) && total > 0 &&
    rule.sum.parts.reduce((sum, path) => sum + (Number.isSafeInteger(field(path)) ? field(path) : NaN), 0) === total;
}
