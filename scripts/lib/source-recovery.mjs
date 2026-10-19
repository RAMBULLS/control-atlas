import { parse } from 'node-html-parser';
import { createHash } from 'node:crypto';
import { assertOfficialSourceUrl } from './source-url-policy.mjs';

const sha = /^sha256:[a-f0-9]{64}$/;
const basename = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());

/** Acquisition is evidence collection, never approval of changed publisher content. */
export function classifyAcquiredSource(source, previous, candidate) {
  if (!sha.test(candidate?.sha256 || '') || !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 1) throw new Error('Acquisition requires actual byte evidence');
  const lastGood = previous?.status === 'ACQUIRED'
    ? Object.fromEntries(['path', 'sha256', 'bytes', 'url', 'retrieved_at'].map((key) => [key, previous[key]]))
    : previous?.last_good;
  // A retrieval receipt cannot override canonical acceptance evidence.
  const acceptedHash = source.registered_sha256 || lastGood?.sha256;
  const acceptedBytes = source.registered_sha256 ? source.registered_bytes : lastGood?.bytes;
  const changed = Boolean(acceptedHash && (acceptedHash !== candidate.sha256 || (acceptedBytes != null && acceptedBytes !== candidate.bytes)));
  return { status: changed ? 'CANDIDATE_CHANGED_BYTES' : 'ACQUIRED', ...(lastGood ? { last_good: lastGood } : {}),
    ...(changed ? { next_action: 'Parse/reconcile this candidate through the existing source transaction before canonical acceptance; last-good content and mappings remain unchanged.' } : {}) };
}

/** One bounded rediscovery attempt during explicit refresh; fetcher is injected for offline tests. */
export async function rediscoverSourceLocation(previous, inventoryUrl, fetchBytes, failedUrl = previous.url) {
  assertOfficialSourceUrl(inventoryUrl);
  const inventoryBytes = await fetchBytes(inventoryUrl, 512 * 1024);
  if (!Buffer.isBuffer(inventoryBytes) || !inventoryBytes.length || inventoryBytes.length > 512 * 1024) throw new Error('Official recovery inventory exceeds its byte bound or is empty');
  const discovery = discoverOfficialRelocations(inventoryBytes.toString('utf8'), inventoryUrl, [previous])[0];
  const inventory_evidence = { url: inventoryUrl, bytes: inventoryBytes.length, sha256: `sha256:${createHash('sha256').update(inventoryBytes).digest('hex')}` };
  if (discovery.status !== 'candidate_locator' || discovery.candidates[0].url === failedUrl) return { inventoryBytes, recovery: {
    source_id: previous.id, status: discovery.status === 'candidate_locator' ? 'unchanged_failed_locator' : discovery.status,
    retain_last_good: true, mutate_items: false, mutate_connections: false, lifecycle_currentness: 'UNKNOWN', discovery, inventory_evidence,
    next_action: 'Preserve accepted edition; resolve publisher location or format without guessing identity or lifecycle.' } };
  const url = discovery.candidates[0].url;
  const bytes = await fetchBytes(url, 32 * 1024 * 1024);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error('Recovered source exceeds its byte bound or is empty');
  const recovery = evaluateSourceRecovery(previous, { url, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes: bytes.length, discovery });
  return { bytes, inventoryBytes, recovery: { ...recovery, discovery, inventory_evidence } };
}

/** Discover literal publisher links; never synthesize a replacement URL. */
export function discoverOfficialRelocations(html, inventoryUrl, registered) {
  assertOfficialSourceUrl(inventoryUrl);
  const links = Array.isArray(html?.links) ? html.links : parse(html).querySelectorAll('a[href]').map((anchor) => ({
    title: anchor.text.trim(), url: new URL(anchor.getAttribute('href'), inventoryUrl).href,
  }));
  return registered.map((source) => {
    const matches = links.filter((link) => basename(link.url) === basename(source.url));
    const unique = [...new Map(matches.map((link) => [link.url, link])).values()];
    for (const match of unique) assertOfficialSourceUrl(match.url);
    return { source_id: source.id, prior_url: source.url, inventory_url: inventoryUrl,
      status: unique.length === 1 ? 'candidate_locator' : unique.length ? 'ambiguous_locator' : 'not_listed',
      candidates: unique };
  });
}

/** Access state and publisher lifecycle are independent; failures cannot retire data. */
export function evaluateSourceRecovery(previous, observation) {
  if (!previous?.id || !sha.test(previous.sha256 || '') || !Number.isSafeInteger(previous.bytes) || previous.bytes < 1) throw new Error('Recovery requires accepted source byte evidence');
  const retain = { source_id: previous.id, retain_last_good: true, mutate_items: false, mutate_connections: false, lifecycle: previous.lifecycle || 'unknown' };
  if (observation.publisher_lifecycle) {
    const event = observation.publisher_lifecycle;
    if (!['deprecated', 'superseded', 'retired'].includes(event.status) || !event.locator || !event.publisher_text || !sha.test(event.evidence_sha256 || '') || (event.status === 'superseded' && !event.replacement_source_id)) throw new Error('Publisher lifecycle change lacks explicit evidence or replacement identity');
    if (event.status === 'superseded' && !observation.known_source_ids?.includes(event.replacement_source_id)) throw new Error('Publisher replacement must resolve to a registered source identity');
    assertOfficialSourceUrl(event.source_url);
    return { ...retain, status: 'publisher_lifecycle_recorded', lifecycle: event.status, lifecycle_evidence: event };
  }
  if (observation.http_status && observation.http_status !== 200) return { ...retain,
    status: observation.http_status === 404 || observation.http_status === 410 ? 'removed_unconfirmed' : 'access_blocked',
    http_status: observation.http_status, next_action: 'rediscover_official_inventory_then_verify_candidate', lifecycle_currentness: 'UNKNOWN' };
  if (!sha.test(observation.sha256 || '') || !Number.isSafeInteger(observation.bytes) || observation.bytes < 1) throw new Error('Recovery candidate lacks actual downloaded byte evidence');
  const official = observation.discovery?.source_id === previous.id && observation.discovery?.status === 'candidate_locator' && observation.discovery?.candidates?.length === 1 && observation.discovery.candidates[0].url === observation.url;
  if (official) { assertOfficialSourceUrl(observation.url); assertOfficialSourceUrl(observation.discovery.inventory_url); }
  if (!official) return { ...retain, status: 'unverified_locator', next_action: 'establish_publisher_link_or_explicit_archival_disposition' };
  const same = observation.sha256 === previous.sha256 && observation.bytes === previous.bytes;
  return { ...retain, status: same ? 'verified_relocation' : 'changed_candidate',
    ...(same ? { accepted_url: observation.url } : { candidate_url: observation.url }),
    next_action: same ? 'reuse_existing_ids_and_captured_content' : 'parse_and_reconcile_edition_identity_and_assertions_before_acceptance',
    byte_evidence: { sha256: observation.sha256, bytes: observation.bytes }, inventory_url: observation.discovery.inventory_url };
}
