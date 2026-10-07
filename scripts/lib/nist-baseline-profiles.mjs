import { createHash } from 'node:crypto';
import { normalize80053Id } from '../../tools/normalizers/oscal-normalize.mjs';

export const BASELINE_NAMES = ['LOW', 'MODERATE', 'HIGH', 'PRIVACY'];
export const BASELINE_DIRECTORY = 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/';
export const BASELINE_INVENTORY_URL = 'https://api.github.com/repos/usnistgov/oscal-content/contents/nist.gov/SP800-53/rev5/json?ref=main';
export const BASELINE_REVISION_URL = 'https://api.github.com/repos/usnistgov/oscal-content/commits/main';
const filename = (name) => `NIST_SP-800-53_rev5_${name}-baseline_profile.json`;
export const baselineUrls = BASELINE_NAMES.map((name) => `${BASELINE_DIRECTORY}${filename(name)}`);
export const byteEvidence = (bytes) => ({
  sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  byte_length: bytes.length,
});
export const gitBlobSha = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function parseBaselineProfile(document, url) {
  const profile = document.profile;
  const label = profile?.metadata?.title;
  if (typeof label !== 'string' || !label.trim()) throw new Error(`Missing baseline title: ${url}`);
  if (!Array.isArray(profile.imports) || !profile.imports.length) throw new Error(`NIST 800-53B profile has no imports: ${url}`);
  // Only explicit selectors are supported. Do not approximate other OSCAL semantics.
  if (profile.modify !== undefined || profile.merge?.['as-is'] !== true || Object.keys(profile.merge).length !== 1) {
    throw new Error(`Unsupported baseline profile merge or modification: ${url}`);
  }
  const controls = new Set();
  const importUrls = new Set();
  for (const entry of profile.imports) {
    const includes = entry['include-controls'];
    if (entry['include-all'] || entry['exclude-controls'] || !Array.isArray(includes) || !includes.length) {
      throw new Error(`NIST 800-53B profile requires explicit include-controls: ${url}`);
    }
    if (typeof entry.href !== 'string' || !entry.href) throw new Error(`Missing baseline import locator: ${url}`);
    const locators = entry.href.startsWith('#')
      ? profile['back-matter']?.resources?.find((resource) => resource.uuid === entry.href.slice(1))?.rlinks
        ?.filter((link) => link['media-type'] === 'application/oscal.catalog+json').map((link) => link.href)
      : [entry.href];
    if (!locators || locators.length !== 1) throw new Error(`Ambiguous baseline JSON catalog locator: ${url}`);
    importUrls.add(new URL(locators[0], url).href);
    for (const include of includes) {
      const ids = include['with-ids'];
      if (Object.keys(include).some((key) => key !== 'with-ids') || !Array.isArray(ids) || !ids.length) {
        throw new Error(`NIST 800-53B profile requires explicit control identities: ${url}`);
      }
      for (const id of ids) {
        if (typeof id !== 'string' || !/^[a-z]{2}-\d+(?:\.\d+)?$/i.test(id)) throw new Error(`Invalid baseline control identity: ${id}`);
        const canonical = normalize80053Id(id);
        if (controls.has(canonical)) throw new Error(`Duplicate baseline control identity: ${canonical}`);
        controls.add(canonical);
      }
    }
  }
  return { label, control_ids: [...controls].sort(), import_urls: [...importUrls].sort(),
    publisher_version: profile.metadata.version ?? null,
    ...(profile.metadata.version == null ? { publisher_version_reason: 'Publisher profile does not declare a version' } : {}),
    publisher_last_modified: profile.metadata['last-modified'] ?? null,
    ...(profile.metadata['last-modified'] == null ? { publisher_last_modified_reason: 'Publisher profile does not declare last-modified' } : {}),
  };
}

export async function fetchBaselineProfiles(fetchImpl, urls = baselineUrls) {
  const profiles = [];
  const labels = new Set();
  for (const url of urls) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`NIST 800-53B baseline fetch returned status ${response.status} for ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const parsed = parseBaselineProfile(JSON.parse(bytes.toString('utf8')), url);
    if (labels.has(parsed.label)) throw new Error(`Duplicate NIST 800-53B baseline label: ${parsed.label}`);
    labels.add(parsed.label);
    profiles.push({ url, ...byteEvidence(bytes), git_blob_sha: gitBlobSha(bytes), ...parsed });
  }
  return { profiles, membership: Object.fromEntries(profiles.map((profile) => [profile.label, profile.control_ids])) };
}

export async function discoverBaselineProfiles(fetchImpl) {
  // Resolve a publisher commit first so later CLI checks inspect these exact bytes.
  const revisionResponse = await fetchImpl(BASELINE_REVISION_URL);
  if (!revisionResponse.ok) throw new Error(`NIST baseline revision discovery returned HTTP ${revisionResponse.status}`);
  const revisionBytes = Buffer.from(await revisionResponse.arrayBuffer());
  const revision = JSON.parse(revisionBytes.toString('utf8')).sha;
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid NIST publisher commit');
  const inventoryUrl = BASELINE_INVENTORY_URL.replace('ref=main', `ref=${revision}`);
  const response = await fetchImpl(inventoryUrl);
  if (!response.ok) throw new Error(`NIST baseline discovery returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const inventory = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(inventory)) throw new Error('Invalid NIST baseline discovery inventory');
  const entries = inventory.filter((entry) => /^NIST_SP-800-53_rev5_.*-baseline_profile\.json$/.test(entry.name));
  const expected = BASELINE_NAMES.map(filename).sort();
  if (JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expected)) {
    throw new Error('NIST baseline discovered-versus-supported profile inventory differs');
  }
  for (const entry of entries) {
    if (entry.type !== 'file' || !/^[a-f0-9]{40}$/.test(entry.sha) || entry.download_url !== `${BASELINE_DIRECTORY.replace('/main/', `/${revision}/`)}${entry.name}`) {
      throw new Error(`Invalid NIST baseline inventory locator: ${entry.name}`);
    }
  }
  const catalogs = inventory.filter((entry) => entry.name === 'NIST_SP-800-53_rev5_catalog.json');
  if (catalogs.length !== 1 || catalogs[0].type !== 'file' || !/^[a-f0-9]{40}$/.test(catalogs[0].sha)
    || catalogs[0].download_url !== `${BASELINE_DIRECTORY.replace('/main/', `/${revision}/`)}${catalogs[0].name}`) throw new Error('Missing or invalid NIST catalog inventory');
  return { url: inventoryUrl, ...byteEvidence(bytes), publisher_commit: revision,
    revision_discovery: { url: BASELINE_REVISION_URL, ...byteEvidence(revisionBytes) },
    catalog: { url: catalogs[0].download_url, git_blob_sha: catalogs[0].sha },
    profiles: entries.map((entry) => ({ name: entry.name, url: entry.download_url, git_blob_sha: entry.sha })).sort((a, b) => a.name.localeCompare(b.name)) };
}

export function verifyBaselineReconciliation(manifest, records) {
  if (manifest.schema_version !== '1.0' || manifest.profiles?.length !== 4 || manifest.discovery?.profiles?.length !== 4) throw new Error('Incomplete NIST baseline evidence');
  const urls = new Set();
  const labels = new Set();
  const catalogIds = new Set(records.map((record) => record.id));
  const revision = manifest.discovery.publisher_commit;
  if (!/^[a-f0-9]{40}$/.test(revision) || manifest.discovery.url !== BASELINE_INVENTORY_URL.replace('ref=main', `ref=${revision}`)
    || manifest.discovery.revision_discovery.url !== BASELINE_REVISION_URL
    || manifest.catalog.url !== `${BASELINE_DIRECTORY.replace('/main/', `/${revision}/`)}NIST_SP-800-53_rev5_catalog.json`
    || manifest.catalog.url !== manifest.discovery.catalog.url || manifest.catalog.git_blob_sha !== manifest.discovery.catalog.git_blob_sha) throw new Error('Invalid NIST baseline publisher revision binding');
  const expectedUrls = baselineUrls.map((url) => url.replace('/main/', `/${revision}/`));
  for (const profile of manifest.profiles) {
    const discovered = manifest.discovery.profiles.filter((entry) => entry.url === profile.url);
    if (!expectedUrls.includes(profile.url) || urls.has(profile.url) || labels.has(profile.label) || discovered.length !== 1 || discovered[0].git_blob_sha !== profile.git_blob_sha) throw new Error('NIST baseline discovery evidence mismatch');
    urls.add(profile.url); labels.add(profile.label);
    if (!Array.isArray(profile.control_ids) || !profile.control_ids.length || new Set(profile.control_ids).size !== profile.control_ids.length) throw new Error('Duplicate or empty NIST baseline selections');
    const assigned = records.filter((record) => record.metadata?.nist_800_53b_baselines?.includes(profile.label)).map((record) => record.id).sort();
    if (profile.control_ids.some((id) => !catalogIds.has(id)) || JSON.stringify(profile.control_ids) !== JSON.stringify(assigned)
      || profile.reconciliation?.discovered !== profile.control_ids.length || profile.reconciliation?.ingested !== assigned.length
      || profile.reconciliation?.missing?.length !== 0 || profile.reconciliation?.extra?.length !== 0) throw new Error(`NIST baseline reconciliation failed: ${profile.label}`);
    if (profile.import_urls?.length !== 1 || profile.import_urls[0] !== manifest.catalog.url) throw new Error('NIST baseline catalog edition locator mismatch');
    if (!profile.publisher_version || profile.publisher_version !== manifest.catalog.publisher_version) throw new Error('NIST baseline catalog edition version mismatch');
    for (const evidence of [profile, manifest.catalog, manifest.discovery, manifest.discovery.revision_discovery]) {
      if (!/^sha256:[a-f0-9]{64}$/.test(evidence.sha256) || !Number.isInteger(evidence.byte_length) || evidence.byte_length <= 0) throw new Error('Invalid NIST baseline byte evidence');
    }
  }
  const extraLabels = records.flatMap((record) => record.metadata?.nist_800_53b_baselines || []).filter((label) => !labels.has(label));
  if (extraLabels.length) throw new Error('Unknown ingested NIST baseline profile');
  return manifest.profiles.map((profile) => ({ label: profile.label, ...profile.reconciliation }));
}

export function verifyBaselineManifest(manifest, catalog) {
  const inventory = catalog.publisher_inventory;
  if (!inventory || manifest.catalog.retrieved_url !== inventory.source_url || manifest.catalog.sha256 !== inventory.source_sha256
    || manifest.catalog.byte_length !== inventory.source_byte_length || manifest.catalog.publisher_version !== inventory.publisher_version) {
    throw new Error('NIST baseline evidence differs from ingested catalog byte evidence');
  }
  return verifyBaselineReconciliation(manifest, catalog.records);
}

export function verifyBaselineProfileBytes(profile, bytes) {
  const evidence = byteEvidence(bytes);
  const parsed = parseBaselineProfile(JSON.parse(bytes.toString('utf8')), profile.url);
  if (evidence.sha256 !== profile.sha256 || evidence.byte_length !== profile.byte_length || gitBlobSha(bytes) !== profile.git_blob_sha
    || ['label', 'publisher_version', 'publisher_last_modified', 'control_ids', 'import_urls'].some((key) => JSON.stringify(parsed[key]) !== JSON.stringify(profile[key]))) {
    throw new Error(`NIST baseline publisher bytes differ from admitted profile evidence: ${profile.url}`);
  }
  return parsed;
}

export function verifyBaselineCatalogBytes(catalog, bytes) {
  const evidence = byteEvidence(bytes);
  const document = JSON.parse(bytes.toString('utf8'));
  if (!document.catalog || evidence.sha256 !== catalog.sha256 || evidence.byte_length !== catalog.byte_length
    || gitBlobSha(bytes) !== catalog.git_blob_sha || document.catalog.metadata?.version !== catalog.publisher_version) {
    throw new Error('NIST baseline imported catalog bytes differ from admitted edition evidence');
  }
}
