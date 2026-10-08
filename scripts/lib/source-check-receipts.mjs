import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomically } from './write-json-atomically.mjs';

export function sourceCheckReceiptPath(taskId, sourceId) {
  if (![taskId, sourceId].every((id) => /^[a-z0-9-]+$/i.test(id))) throw new Error('Invalid source check receipt identity');
  return `.local/source-check-receipts/${taskId}--${sourceId}.json`;
}

export function resetSourceCheckReceipt(root, unit) {
  writeJsonAtomically(join(root, unit.checkReceiptPath), {
    schema_version: '1.0', task_id: unit.taskId, source_id: unit.sourceId,
    started_at: new Date().toISOString(), requests: [],
  });
}

// Opt-in, transaction-local receipts. Never retain headers, bodies or credentials.
// A response is evidence only after its body was consumed successfully; merely
// receiving headers cannot attest a truncated download or a local fallback.
export async function observePublisherResponse(response, { path, url, resolvedUrl = url, method = 'GET', now = () => new Date().toISOString() } = {}) {
  if (!path || method !== 'GET' || !response.ok) return response;
  const parsedUrl = new URL(url);
  const destination = new URL(resolvedUrl);
  if ([parsedUrl, destination].some((value) => value.username || value.password || value.href.length > 8192 ||
      [...value.searchParams.keys()].some((key) => /token|secret|password|signature|api.?key/i.test(key)))) return response;
  const cacheStatus = response.headers?.get?.('x-local-cache-status') || '';
  if (cacheStatus && !['miss', 'updated', 'revalidated', 'skip'].includes(cacheStatus)) return response;
  const append = (fields) => {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(receipt.requests) || receipt.requests.length >= 10000) throw new Error('Invalid or oversized source check receipt');
    receipt.requests.push({ url: parsedUrl.href, resolved_url: destination.href, checked_at: now(), method, http: response.status,
      validation: cacheStatus === 'revalidated' ? 'revalidated' : 'remote', ...fields });
    writeJsonAtomically(path, receipt);
  };
  // DISA's existing range-validation exception can reuse a size-verified local
  // archive after a successful publisher probe. Preserve that narrower scope.
  const range = /^bytes 0-0\/(\d+)$/.exec(response.headers?.get?.('content-range') || '');
  if (response.status === 206 && range && Number.isSafeInteger(Number(range[1]))) {
    try {
      const probe = await response.clone().arrayBuffer();
      if (probe.byteLength === 1) append({ scope: 'publisher_range_probe', total_byte_length: Number(range[1]) });
    } catch { /* A failed probe cannot attest the reused local archive. */ }
  }
  if (response.status !== 200) return response;
  const read = response.arrayBuffer.bind(response);
  const consume = async (convert) => {
    const bytes = await read();
    const value = convert(bytes);
    append({ scope: 'publisher_artifact_retrieval', sha256: `sha256:${createHash('sha256').update(Buffer.from(bytes)).digest('hex')}`, byte_length: bytes.byteLength });
    return value;
  };
  response.arrayBuffer = () => consume((bytes) => bytes);
  response.text = () => consume((bytes) => new TextDecoder().decode(bytes));
  response.json = () => consume((bytes) => JSON.parse(new TextDecoder().decode(bytes)));
  return response;
}

export function retrievalScope(url) {
  const parsed = new URL(url);
  if (/\/api\/versioner\/v1\/full\/\d{4}-\d{2}-\d{2}\//.test(parsed.pathname)) return 'pinned_edition_retrieval';
  if (parsed.hostname === 'raw.githubusercontent.com' && !['main', 'master', 'nist-pages'].includes(parsed.pathname.split('/')[3])) return 'pinned_edition_retrieval';
  return 'publisher_artifact_retrieval';
}

const OSCAL = 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/';
const CCI = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_CCI_List.zip';
const D3FEND = 'https://d3fend.mitre.org/ontologies/d3fend.json';
const D3FEND_MAP = 'https://d3fend.mitre.org/api/ontology/inference/d3fend-full-mappings.json';
const FRAMEWORK_CHECKS = [
  ['nist-800-53-rev5', ['nist-800-53'], `${OSCAL}SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json`],
  ['nist-800-171-rev3', ['nist-800-171'], `${OSCAL}SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json`],
  ['nist-csf-2', ['nist-csf-2'], `${OSCAL}CSF/v2.0/json/NIST_CSF_v2.0_catalog.json`, 'https://csrc.nist.gov/extensions/nudp/services/json/csf/download?olirids=all'],
  ['nist-ssdf-oscal', ['nist-ssdf', 'nist-ssdf-oscal'], `${OSCAL}SP800-218/ver1/json/NIST_SP800-218_ver1_catalog.json`],
  ['nist-800-172-rev3', ['nist-800-172-rev3'], `${OSCAL}SP800-172/rev3/json/NIST_SP800-172_rev3_catalog.json`],
  ['nist-800-171-rev2', ['nist-800-171-rev2'], 'https://csrc.nist.gov/files/pubs/sp/800/171/r2/upd1/final/docs/sp800-171r2-security-reqs.csv'],
  ['nist-ai-rmf-playbook', ['nist-ai-rmf-playbook'], 'https://airc.nist.gov/docs/playbook.json'],
];

function readOptional(root, path) {
  return existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), 'utf8')) : null;
}

export function collectSourceChecks({ registry, report, activeStartedAt, readReceipt, hydration = null, baselines = null, disa = null, observations = [] }) {
  const checks = new Map();
  const start = Date.parse(report?.started_at);
  // Only the currently executing refresh may mint dates. Committed pipeline
  // summaries and old receipts are not substitutes for a current transaction.
  if (report?.status !== 'running' || activeStartedAt !== report.started_at || !Number.isFinite(start)) return checks;
  const sources = new Set([...(registry.publications || []), ...(registry.sources || [])].map((entry) => entry.id));
  const units = new Map();
  for (const unit of report.results || []) {
    if (unit.status !== 'accepted' || ![unit.taskId, unit.sourceId].every((id) => typeof id === 'string' && /^[a-z0-9-]+$/i.test(id)) ||
        unit.checkReceiptPath !== sourceCheckReceiptPath(unit.taskId, unit.sourceId)) continue;
    const receipt = readReceipt(unit.checkReceiptPath);
    const completed = Date.parse(unit.completed_at);
    const attemptStart = Date.parse(receipt?.started_at);
    if (receipt?.task_id !== unit.taskId || receipt?.source_id !== unit.sourceId || !Number.isFinite(completed) || !Number.isFinite(attemptStart) || attemptStart < start || completed < attemptStart) continue;
    const requests = (receipt.requests || []).filter((request) => {
      const time = Date.parse(request.checked_at);
      return time >= attemptStart && time <= completed && request.method === 'GET' && request.http >= 200 && request.http < 300 &&
        ['remote', 'revalidated'].includes(request.validation) &&
        ((request.scope === 'publisher_range_probe' && request.http === 206) || (request.scope === 'publisher_artifact_retrieval' && request.http === 200 && /^sha256:[a-f0-9]{64}$/.test(request.sha256 || '') && request.byte_length > 0));
    });
    units.set(`${unit.taskId}:${unit.sourceId}`, requests);
  }
  const requestsFor = (task, source = task) => units.get(`${task}:${source}`) || [];
  const match = (requests, url, checksum = null) => requests.find((entry) => entry.url === url && entry.scope === 'publisher_artifact_retrieval' && (!checksum || entry.sha256 === checksum));
  const add = (sourceId, requests, scope = 'publisher_artifact_retrieval') => {
    if (!sources.has(sourceId) || !requests.length || requests.some((entry) => !entry)) return;
    const evidence = { scope, checked_at: requests.map((entry) => entry.checked_at).sort()[0],
      requests: requests.map(({ url, resolved_url, checked_at, http, validation, sha256, byte_length, scope: requestScope, total_byte_length }) => ({
        url, ...(resolved_url ? { resolved_url } : {}), checked_at, http, validation, ...(sha256 ? { sha256, byte_length } : {}),
        ...(requestScope === 'publisher_range_probe' ? { scope: requestScope, total_byte_length } : {}),
      })) };
    const previous = checks.get(sourceId);
    if (!previous || (previous.scope === 'pinned_edition_retrieval' && scope !== previous.scope) ||
        (previous.scope === scope && evidence.checked_at > previous.checked_at)) checks.set(sourceId, evidence);
  };
  const requireUrls = (ids, task, source, urls, scope) => {
    const requests = requestsFor(task, source);
    const required = urls.map((url) => match(requests, url));
    for (const id of ids) add(id, required, scope);
  };

  // Canonical aliases are deliberately explicit. A mapping to a publication or
  // a shared catalog bundle is not proof that its own publisher was checked.
  for (const [unit, ids, ...urls] of FRAMEWORK_CHECKS) requireUrls(ids, 'fetch-framework-catalogs', unit, urls);
  if (['nist-800-53', 'nist-800-171', 'nist-csf-2'].every((id) => checks.has(id))) {
    const evidence = ['nist-800-53', 'nist-800-171', 'nist-csf-2'].flatMap((id) => checks.get(id).requests);
    add('nist-oscal', evidence);
  }
  requireUrls(['disa-cci-list', 'disa-cci-nist-references'], 'fetch-ccis', 'fetch-ccis', [CCI]);
  requireUrls(['nist-800-171-oscal-mappings'], 'fetch-olir-mappings', 'fetch-olir-mappings', [`${OSCAL}SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json`]);
  requireUrls(['nist-olir-csf2-to-sp800-53'], 'fetch-olir-mappings', 'fetch-olir-mappings', ['https://csrc.nist.gov/csrc/media/projects/olir/documents/submissions/Cybersecurity_Framework_v2-0_Concept_Crosswalk_800-53_5_2_0_draft.xlsx']);
  requireUrls(['fedramp-2026-rules'], 'fetch-fedramp-rules', 'fetch-fedramp-rules', [
    'https://raw.githubusercontent.com/FedRAMP/rules/main/fedramp-consolidated-rules.json',
    'https://raw.githubusercontent.com/FedRAMP/rules/main/schemas/fedramp-consolidated-rules.schema.json',
    'https://www.fedramp.gov/legacy/',
  ]);

  // Four profiles, the exact discovered publisher commit, and its live
  // revision lookup are all required. A normalized baseline is not a check.
  if (baselines?.profiles?.length === 4 && baselines.discovery?.profiles?.length === 4) {
    requireUrls(['nist-800-53b-baselines'], 'fetch-framework-catalogs', 'nist-800-53-rev5', [
      baselines.discovery.revision_discovery?.url, baselines.discovery.url, ...baselines.profiles.map((entry) => entry.url),
    ], 'publisher_revision_retrieval');
  }

  const hydrationById = new Map((hydration?.results || []).map((entry) => [entry.id, entry]));
  const byPublication = new Map();
  for (const artifact of registry.artifacts || []) {
    const group = byPublication.get(artifact.publication_source_id) || [];
    group.push(artifact);
    byPublication.set(artifact.publication_source_id, group);
  }
  const hydrationCheck = (artifact) => {
    const receipt = hydrationById.get(artifact.id);
    if (receipt?.status !== 'OK' || receipt.carried_forward_from || receipt.carried_forward_reason ||
        receipt.sha256 !== artifact.sha256 || receipt.url !== artifact.artifact_url || receipt.http !== 200) return null;
    return match(requestsFor('hydrate-artifacts', artifact.id), receipt.url, receipt.sha256);
  };
  for (const [sourceId, artifacts] of byPublication) {
    // Whole-publication checks need every owned artifact, not one lucky page.
    const requests = artifacts.map(hydrationCheck);
    if (requests.every(Boolean)) {
      const scope = requests.some((entry) => retrievalScope(entry.url) === 'pinned_edition_retrieval') ? 'pinned_edition_retrieval' : 'publisher_artifact_retrieval';
      // FedRAMP's full three-file contract above must not be reduced to one JSON.
      if (sourceId !== 'fedramp-2026-rules') add(sourceId, requests, scope);
    }
  }

  const nistZeroTrustRequests = requestsFor('fetch-nist-zero-trust');
  const buildArtifacts = byPublication.get('nist-sp-1800-35') || [];
  if (buildArtifacts.length) add('nist-sp-1800-35', [
    match(nistZeroTrustRequests, 'https://api.github.com/repos/usnistgov/zero-trust-architecture/branches/nist-pages'),
    ...buildArtifacts.map((artifact) => match(nistZeroTrustRequests, artifact.artifact_url, artifact.sha256)),
  ], 'publisher_revision_retrieval');

  const mitreRequests = requestsFor('fetch-mitre');
  for (const sourceId of ['mitre-attack-enterprise', 'mitre-attack-ics', 'mitre-d3fend-ontology']) {
    const artifact = hydrationById.get(`artifact-${sourceId}`);
    const request = artifact && match(mitreRequests, artifact.url, artifact.sha256);
    const discovery = sourceId.startsWith('mitre-attack-')
      ? match(mitreRequests, 'https://api.github.com/repos/mitre-attack/attack-stix-data/releases/latest')
      : match(mitreRequests, 'https://d3fend.mitre.org/api/version.json');
    add(sourceId, [request, discovery], 'publisher_revision_retrieval');
  }
  const mappings = hydrationById.get('artifact-mitre-d3fend-mappings');
  const ontology = hydrationById.get('artifact-mitre-d3fend-ontology');
  add('mitre-d3fend-mappings', [match(mitreRequests, D3FEND_MAP, mappings?.sha256 || 'missing'), match(mitreRequests, D3FEND, ontology?.sha256 || 'missing')]);

  const disaRequests = requestsFor('fetch-disa-library');
  const probe = disaRequests.find((entry) => entry.url === disa?.artifact_url && entry.scope === 'publisher_range_probe' && entry.total_byte_length === disa.byte_length);
  const discovered = match(disaRequests, disa?.discovery_source);
  if (Date.parse(disa?.retrieval_timestamp) >= start && disa?.publications?.failed_publications === 0 &&
      disa.publications.missing_publications === 0 && disa.reconciliation?.failed_files === 0) {
    const standalone = disa.reconciliation.standalone_packages;
    if (Array.isArray(standalone) && standalone.length === disa.publications.standalone_ingested) {
      const packages = standalone.map((entry) => match(disaRequests, new URL(entry.filename, disa.discovery_source).href, entry.checksum));
      for (const id of ['disa-stig-library', 'disa-srg-library', 'disa-stig-srg-cci-references']) add(id, [discovered, probe, ...packages], 'publisher_range_probe');
    }
  }
  for (const observation of observations) {
    if (observation.available !== true || !(Date.parse(observation.observed_at) >= start)) continue;
    add(observation.source_id, [match(requestsFor('observe-disa-sources'), observation.url)], 'publisher_page_observation');
  }
  return checks;
}

export function loadSourceChecks(root, registry) {
  if (!process.env.CONTROL_ATLAS_REFRESH_STARTED_AT) return new Map();
  return collectSourceChecks({ registry, activeStartedAt: process.env.CONTROL_ATLAS_REFRESH_STARTED_AT,
    report: readOptional(root, '.local/source-refresh-results.json'),
    readReceipt: (path) => readOptional(root, path),
    hydration: readOptional(root, 'data/artifact-hydration-manifest.json'),
    baselines: readOptional(root, 'data/nist-800-53b-profile-manifest.json'),
    disa: readOptional(root, 'data/disa-artifact-manifest.json'),
    observations: readOptional(root, 'data/stig-source-observations.json')?.observations || [],
  });
}
