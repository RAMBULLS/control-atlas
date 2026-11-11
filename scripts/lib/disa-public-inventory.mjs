import { createHash } from 'node:crypto';
import {
  classifyDisaZip,
  parseCandidateFilename,
} from './disa-publication-reconciliation.mjs';

export const DISA_PUBLIC_LIBRARY_URL = 'https://www.cyber.mil/stigs/downloads/';
export const DISA_PUBLIC_INVENTORY_URL = 'https://www.cyber.mil/webruntime/api/apex/execute?language=en-US&asGuest=true&htmlEncode=false';

// Observed in the public Document Library view, LDS engine and LWR transport.
// This is a descriptor, not an HTTP client or permission to allow generic POST.
// No caller-controlled URL, Apex method, class, body or credentials are accepted.
export const DISA_PUBLIC_INVENTORY_REQUEST = Object.freeze({
  url: DISA_PUBLIC_INVENTORY_URL,
  method: 'POST',
  headers: Object.freeze({ 'Content-Type': 'application/json; charset=utf-8' }),
  body: JSON.stringify({
    namespace: '', classname: '@udd/01pRw0000002mOj',
    method: 'getCyberDocumentCatalogByDocumentLibrary', isContinuation: false,
    params: { documentLibrary: 'STIGs' }, cacheable: false,
  }),
  credentials: 'omit', redirect: 'error',
});
export const DISA_PUBLIC_INVENTORY_MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 2000;
const PACKAGE_BASE = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/';
const FIELDS = ['Name', 'FileName', 'Classification', 'DocumentLibrary', 'RawDocumentLibrary',
  'DownloadLink', 'DownloadType', 'RawDownloadType', 'Topic', 'UploadDate'];
export const disaEvidenceHash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const hash = disaEvidenceHash;
export const DISA_PUBLIC_REQUEST_FINGERPRINT = hash(`${DISA_PUBLIC_INVENTORY_REQUEST.method}\n${DISA_PUBLIC_INVENTORY_URL}\n${DISA_PUBLIC_INVENTORY_REQUEST.body}`);
export const disaCanonicalHash = (value) => hash(JSON.stringify(ordered(value)));
export const disaInventoryHash = (rows) => disaCanonicalHash([...rows].sort((a, b) => a.Name.localeCompare(b.Name)));
export const disaUiTuple = (row) => [row.FileName, row.DownloadType, row.UploadDate, row.DownloadLink, row.Classification];
const tokens = (value) => value.split(';').map((item) => item.trim());
const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const containsControl = (value) => [...value].some((character) => {
  const code = character.codePointAt(0);
  return code <= 31 || code === 127;
});

function publicUrl(literal) {
  if (literal !== literal.trim() || (containsControl(literal) || literal.includes("\\")) || /%(?:2e|2f|5c|25)/i.test(literal.split(/[?#]/)[0])) {
    throw new Error('Ambiguous DISA publisher URL');
  }
  let url;
  try { url = new URL(literal); } catch { throw new Error('Invalid DISA publisher URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      url.href !== literal.replaceAll(' ', '%20') || /\/(?:\.|\.\.)(?:\/|$)/.test(literal)) {
    throw new Error('Invalid DISA publisher URL');
  }
  return url;
}

function filename(row) {
  const path = publicUrl(row.DownloadLink).pathname;
  let value;
  try { value = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)); }
  catch { throw new Error('Invalid DISA filename encoding'); }
  if (!value || (value.includes('/') || value.includes('\\') || containsControl(value))) throw new Error('Invalid DISA filename');
  return value;
}

function packageUrl(row) {
  const url = publicUrl(row.DownloadLink);
  const suffix = url.href.slice(PACKAGE_BASE.length);
  if (!url.href.startsWith(PACKAGE_BASE) || url.href !== `${url.origin}${url.pathname}` || !suffix || suffix.includes('/') ||
      !url.pathname.endsWith('.zip')) throw new Error('DISA package is outside the approved public archive location');
  return url.href;
}

/** A retained all-page UI witness binds every row, not just a matching count.
 * Historical witness time is never rewritten by a later identical API response.
 * Changed inventory requires a new independently reviewed full-page witness.
 */
export function parseDisaPublicInventory(raw, { witnessBytes, observedAt, resolvedUrl,
  requestFingerprint } = {}) {
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error('A DISA inventory observation time is required');
  }
  if (resolvedUrl !== DISA_PUBLIC_INVENTORY_URL || requestFingerprint !== DISA_PUBLIC_REQUEST_FINGERPRINT) {
    throw new Error('DISA inventory endpoint or request fingerprint changed or redirected');
  }
  if (!Buffer.isBuffer(raw) || !Buffer.isBuffer(witnessBytes)) throw new Error('Consumed response bytes and retained UI witness bytes are required');
  const bytes = raw;
  if (!bytes.length || bytes.length > DISA_PUBLIC_INVENTORY_MAX_BYTES || !witnessBytes.length ||
      witnessBytes.length > DISA_PUBLIC_INVENTORY_MAX_BYTES) throw new Error('DISA inventory exceeds its byte bound');
  let payload; let witness;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    payload = JSON.parse(decoder.decode(bytes)); witness = JSON.parse(decoder.decode(witnessBytes));
  } catch { throw new Error('Invalid DISA public inventory JSON or witness'); }
  if (witness?.schema_version !== '1.0' || witness.source_page !== DISA_PUBLIC_LIBRARY_URL ||
      witness.request_fingerprint !== DISA_PUBLIC_REQUEST_FINGERPRINT ||
      !Number.isFinite(Date.parse(witness.observed_at)) || Date.parse(witness.observed_at) > Date.parse(observedAt) ||
      !Number.isSafeInteger(witness.record_count) || witness.record_count < 1 || witness.record_count > MAX_RECORDS ||
      !Array.isArray(witness.pages) || !witness.pages.length || witness.pages.length > MAX_RECORDS) {
    throw new Error('An independent complete DISA UI witness is required');
  }
  const expectedCount = witness.record_count;
  if (!payload || typeof payload !== 'object' || payload.error || typeof payload.cacheable !== 'boolean' ||
      !Array.isArray(payload.returnValue) || payload.returnValue.length !== expectedCount) {
    throw new Error('Incomplete or unexpected DISA public inventory response');
  }
  const ids = new Set();
  const urls = new Set();
  const filenames = new Set();
  const records = payload.returnValue.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        FIELDS.some((key) => typeof record[key] !== 'string' || !record[key].trim()) ||
        Object.values(record).some((value) => typeof value !== 'string' || value.length > 8192) ||
        !/^File-\d+$/.test(record.Name) || !validDate(record.UploadDate) ||
        !tokens(record.RawDocumentLibrary).includes('STIGs') || record.Classification !== 'Unclassified') {
      throw new Error('Invalid or non-public DISA inventory record');
    }
    const url = publicUrl(record.DownloadLink).href;
    const name = filename(record);
    if (ids.has(record.Name) || urls.has(url) || filenames.has(name)) {
      throw new Error('Duplicate or ambiguous DISA inventory identity');
    }
    ids.add(record.Name); urls.add(url); filenames.add(name);
    // Preserve all publisher fields, including exact literal links and lifecycle.
    return { ...record };
  }).sort((a, b) => a.Name.localeCompare(b.Name));
  const ui = [];
  for (const [index, page] of witness.pages.entries()) {
    if (page.number !== index + 1 || page.start !== ui.length + 1 || page.total !== expectedCount ||
        !Array.isArray(page.rows) || !page.rows.length || page.end !== ui.length + page.rows.length ||
        page.has_next !== (index < witness.pages.length - 1) ||
        page.rows.some((tuple) => !Array.isArray(tuple) || tuple.length !== 5 || tuple.some((v) => typeof v !== 'string'))) {
      throw new Error('Incomplete or discontinuous DISA UI pages');
    }
    ui.push(...page.rows);
  }
  const sortedTuples = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  if (ui.length !== expectedCount || new Set(ui.map((row) => row[3])).size !== ui.length ||
      JSON.stringify(sortedTuples(ui)) !== JSON.stringify(sortedTuples(records.map(disaUiTuple))) ||
      witness.inventory_checksum !== disaInventoryHash(records)) {
    throw new Error('DISA inventory changed or differs from full UI witness; new completeness evidence required');
  }
  return {
    schema_version: '1.0', scope: 'publisher_public_inventory_metadata',
    source_page: DISA_PUBLIC_LIBRARY_URL, request_url: DISA_PUBLIC_INVENTORY_URL,
    observed_at: observedAt, request_fingerprint: requestFingerprint,
    completeness: { method: 'all_rendered_public_library_pages', witness_checksum: hash(witnessBytes),
      observed_at: witness.observed_at, inventory_checksum: witness.inventory_checksum, page_count: witness.pages.length },
    record_count: records.length, independent_count: expectedCount,
    response_checksum: hash(bytes), response_byte_length: bytes.length,
    inventory_checksum: hash(JSON.stringify(ordered(records))), records,
    publisher_archive_bytes_retrieved: false,
  };
}

// Unlike the legacy classifier, include lifecycle-marked manual filenames in
// version ordering. Unclear family/version schemes quarantine instead of reviving
// an older unmarked edition. Non-manual exclusions keep their established rules.
function selectManualEditions(rows) {
  const families = new Map();
  for (const { filename: name } of rows) {
    const classification = classifyDisaZip(name);
    if (!classification.isCandidate && !['draft', 'sunset'].includes(classification.category)) continue;
    if (classification.category === 'sunset' && /Compilation/i.test(name)) continue;
    let parsed = parseCandidateFilename(name);
    if (!parsed && /(?:STIG|SRG|SRR)/i.test(name)) {
      const match = /^U_(.+)_(V|Y)([0-9]+)(R|M)([0-9]+)(?:-([0-9]+))?(?:_([A-Za-z0-9_-]+))?\.zip$/i.exec(name);
      if (!match || /Draft|Sunset/i.test(match[1]) || !['VR', 'YM'].includes((match[2] + match[4]).toUpperCase())) {
        throw new Error(`Ambiguous lifecycle-marked DISA edition: ${name}`);
      }
      const scheme = (match[2] + match[4]).toUpperCase();
      parsed = { filename: name, family: match[1], versionType: scheme,
        kind: /SRG|SRR/i.test(`${match[1]} ${match[7] || ''}`) ? 'srg' : 'stig',
        versionStr: `${match[2]}${match[3]}${match[4]}${match[5]}`,
        ...(scheme === 'VR' ? { versionMajor: Number(match[3]), release: Number(match[5]) }
          : { year: Number(match[3]), month: Number(match[5]) }) };
    }
    if (!parsed) continue;
    const numbers = parsed.versionType === 'YM' ? [parsed.year, parsed.month] : [parsed.versionMajor, parsed.release];
    if (numbers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
        (parsed.versionType === 'YM' && (parsed.month < 1 || parsed.month > 12))) throw new Error('Invalid numeric DISA edition');
    const key = `${parsed.kind}:${parsed.family.toLowerCase()}`;
    const group = families.get(key) || []; group.push({ ...parsed, numbers }); families.set(key, group);
  }
  const selected = new Map(); const superseded = new Map();
  for (const group of families.values()) {
    if (new Set(group.map((entry) => entry.versionType)).size !== 1) throw new Error('Incomparable DISA version schemes');
    const editions = new Set();
    for (const entry of group) {
      const key = entry.numbers.join(':');
      if (editions.has(key)) throw new Error('Ambiguous equal numeric DISA editions with different filenames');
      editions.add(key);
    }
    group.sort((a, b) => b.numbers[0] - a.numbers[0] || b.numbers[1] - a.numbers[1]);
    selected.set(group[0].filename, group[0]);
    for (const entry of group.slice(1)) superseded.set(entry.filename, { ...entry, supersededBy: group[0].filename });
  }
  return { selected, superseded };
}

function lifecycleReason(row) {
  const types = tokens(row.RawDownloadType);
  if (types.includes('Sunset')) return 'publisher_sunset';
  if (types.includes('Draft STIGs/SRGs')) return 'publisher_draft';
  return null;
}

/**
 * Give every public row one disposition, without modifying accepted content.
 * Select the newest numeric manual edition BEFORE lifecycle exclusions. A
 * publisher-Sunset V3R5 must not resurrect an unmarked V3R4 of the same family.
 * Filename coverage below is not byte, edition-text or native-rule verification.
 */
export function reconcileDisaPublicInventory(snapshot, {
  acceptedCompilationFiles = [], acceptedStandaloneFiles = [],
} = {}) {
  if (!snapshot || snapshot.scope !== 'publisher_public_inventory_metadata' ||
      !Array.isArray(snapshot.records) || snapshot.record_count !== snapshot.records.length ||
      snapshot.independent_count !== snapshot.record_count || snapshot.records.length < 1 ||
      snapshot.request_fingerprint !== DISA_PUBLIC_REQUEST_FINGERPRINT ||
      snapshot.completeness?.inventory_checksum !== snapshot.inventory_checksum ||
      snapshot.inventory_checksum !== hash(JSON.stringify(ordered(snapshot.records)))) {
    throw new Error('A complete parsed DISA public inventory is required');
  }
  const rows = snapshot.records.map((row) => ({ row, filename: filename(row) }));
  const { selected, superseded } = selectManualEditions(rows);
  const compilationFiles = new Set(acceptedCompilationFiles);
  const standaloneFiles = new Set(acceptedStandaloneFiles);
  if (![...compilationFiles, ...standaloneFiles].every((value) => typeof value === 'string')) {
    throw new Error('Accepted DISA filename inventories must contain strings');
  }
  const dispositions = rows.map(({ row, filename: name }) => {
    const base = { publisher_id: row.Name, filename: name, literal_url: row.DownloadLink,
      publisher_upload_date: row.UploadDate, publisher_download_types: row.RawDownloadType };
    const lifecycle = lifecycleReason(row);
    if (lifecycle) return { ...base, disposition: 'excluded', reason: lifecycle };
    const classification = classifyDisaZip(name);
    if (!classification.isCandidate) return { ...base, disposition: 'excluded', reason: classification.reason };
    const publication = selected.get(name);
    if (!publication) {
      const prior = superseded.get(name);
      if (!prior) throw new Error(`Unrecognized public manual DISA package: ${row.Name}`);
      return { ...base, disposition: 'excluded', reason: 'superseded_by_newer_release', superseded_by: prior.supersededBy };
    }
    return { ...base, disposition: 'active_manual_candidate', family: publication.family,
      kind: publication.kind, version: publication.versionStr, versionStr: publication.versionStr, url: packageUrl(row),
      accepted_filename_coverage: compilationFiles.has(name) ? 'compilation_manifest'
        : standaloneFiles.has(name) ? 'standalone_manifest' : 'not_in_accepted_manifest' };
  });
  const compilations = rows.filter(({ row, filename: name }) => !lifecycleReason(row) &&
    /^U_SRG-STIG_Library_(?:[A-Za-z]+_\d{4}|\d{4}_\d{2})\.zip$/.test(name));
  if (compilations.length !== 1) throw new Error('DISA public compilation identity is missing or ambiguous');
  const compilationUrl = packageUrl(compilations[0].row);
  const active = dispositions.filter((entry) => entry.disposition === 'active_manual_candidate');
  const excluded = dispositions.filter((entry) => entry.disposition === 'excluded');
  const represented = active.filter((entry) => entry.accepted_filename_coverage === 'compilation_manifest');
  const standalone = active.filter((entry) => entry.accepted_filename_coverage === 'standalone_manifest');
  const unrepresented = active.filter((entry) => entry.accepted_filename_coverage === 'not_in_accepted_manifest');
  if (active.length + excluded.length !== snapshot.record_count) throw new Error('DISA inventory disposition count mismatch');
  const reasons = Object.fromEntries([...new Set(excluded.map((entry) => entry.reason))].sort()
    .map((reason) => [reason, excluded.filter((entry) => entry.reason === reason).length]));
  return {
    scope: 'publisher_public_inventory_metadata', source_page: snapshot.source_page,
    observed_at: snapshot.observed_at, inventory_checksum: snapshot.inventory_checksum,
    compilation_url: compilationUrl, record_count: snapshot.record_count,
    active_manual_candidates: active.length, excluded_records: excluded.length,
    exclusion_reasons: reasons, accepted_compilation_filenames: represented.length,
    accepted_standalone_filenames: standalone.length, unrepresented_manual_filenames: unrepresented.length,
    dispositions, publisher_archive_bytes_retrieved: false,
    native_content_verified: false, source_promotion_permitted: false,
  };
}
