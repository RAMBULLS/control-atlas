import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DISA_PUBLIC_INVENTORY_REQUEST, DISA_PUBLIC_INVENTORY_URL,
  DISA_PUBLIC_INVENTORY_MAX_BYTES, DISA_PUBLIC_REQUEST_FINGERPRINT, DISA_INITIAL_INVENTORY_BASELINE, disaInventoryBand, parseDisaPublicInventory, reconcileDisaPublicInventory,
} from '../scripts/lib/disa-public-inventory.mjs';

const base = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/';
const compilation = 'U_SRG-STIG_Library_October_2026.zip';
const options = (records = fixtures()) => ({ baselineCount: records.length,
  observedAt: '2026-11-11T01:50:35Z', requestFingerprint: DISA_PUBLIC_REQUEST_FINGERPRINT, resolvedUrl: DISA_PUBLIC_INVENTORY_URL });
const row = (id, filename, types = 'STIGs') => ({
  Name: `File-${id}`, FileName: filename, Classification: 'Unclassified',
  DocumentLibrary: 'STIGs', RawDocumentLibrary: 'STIGs', DownloadLink: `${base}${filename}`,
  DownloadType: types.replaceAll(';', ', '), RawDownloadType: types,
  Topic: 'Security Technical Implementation Guides (STIG)', UploadDate: '2026-10-26',
});
const response = (records) => Buffer.from(JSON.stringify({ returnValue: records, cacheable: true }));
const parse = (records) => parseDisaPublicInventory(response(records), options(records));
const fixtures = () => [row('001', compilation, 'STIGs;STIG Compilations'),
  row('002', 'U_Example_V1R1_STIG.zip'), row('003', 'U_Other_SRG_V2R1.zip')];

test('the immutable descriptor is the observed guest read-only method, with no generic caller-controlled POST', () => {
  assert.equal(DISA_PUBLIC_INVENTORY_REQUEST.url, DISA_PUBLIC_INVENTORY_URL);
  assert.equal(DISA_PUBLIC_INVENTORY_REQUEST.method, 'POST');
  assert.deepEqual(JSON.parse(DISA_PUBLIC_INVENTORY_REQUEST.body), {
    namespace: '', classname: '@udd/01pRw0000002mOj', method: 'getCyberDocumentCatalogByDocumentLibrary',
    isContinuation: false, params: { documentLibrary: 'STIGs' }, cacheable: false,
  });
  assert.equal(DISA_PUBLIC_INVENTORY_REQUEST.credentials, 'omit');
  assert.equal(DISA_PUBLIC_INVENTORY_REQUEST.redirect, 'error');
  assert.ok(Object.isFrozen(DISA_PUBLIC_INVENTORY_REQUEST));
  assert.ok(Object.isFrozen(DISA_PUBLIC_INVENTORY_REQUEST.headers));
  assert.throws(() => { DISA_PUBLIC_INVENTORY_REQUEST.url = `${base}`; }, TypeError);
});

test('complete response preserves exact fields and distinguishes inventory observation from retrieval', () => {
  const records = fixtures();
  const snapshot = parse(records);
  assert.equal(snapshot.record_count, 3);
  assert.deepEqual(snapshot.completeness, { ...disaInventoryBand(3), inventory_checksum: snapshot.inventory_checksum });
  assert.equal(snapshot.response_byte_length, Buffer.byteLength(response(records)));
  assert.deepEqual(snapshot.records, records);
  assert.equal(snapshot.publisher_archive_bytes_retrieved, false);
  assert.equal(snapshot.retrieved_at, undefined);
  assert.equal(snapshot.retrieval_timestamp, undefined);
});

test('truncated, empty or swollen inventories and a missing accepted baseline fail closed', () => {
  const rows = fixtures();
  assert.throws(() => parseDisaPublicInventory(response(rows.slice(0, 1)), options()), /outside the accepted band/);
  assert.throws(() => parseDisaPublicInventory(response([]), options()), /outside the accepted band/);
  assert.throws(() => parseDisaPublicInventory(response([...rows, row('004', 'U_New_V1R1_STIG.zip')]), options()), /outside the accepted band/);
  for (const baselineCount of [undefined, 0, -1, 2.5, 2001]) {
    assert.throws(() => parseDisaPublicInventory(response(rows), { ...options(), baselineCount }), /baseline/);
  }
  assert.throws(() => parseDisaPublicInventory(response([]), options([])), /baseline/);
});

test('the accepted-count band is 90-125% of the last accepted count, starting from the recorded 417 rows', () => {
  assert.equal(DISA_INITIAL_INVENTORY_BASELINE, 417);
  assert.deepEqual(disaInventoryBand(417), { method: 'accepted_count_band', baseline_count: 417, minimum: 376, maximum: 521 });
  const many = (count) => [row('000', compilation, 'STIGs;STIG Compilations'),
    ...Array.from({ length: count - 1 }, (_, index) => row(String(index + 1).padStart(4, '0'), `U_Example${index}_V1R1_STIG.zip`))];
  for (const [count, accepted] of [[375, false], [376, true], [521, true], [522, false]]) {
    const parsed = () => parseDisaPublicInventory(response(many(count)), { ...options(), baselineCount: 417 });
    if (accepted) assert.equal(parsed().record_count, count); else assert.throws(parsed, /outside the accepted band/);
  }
});

test('a doubled slash after the publisher host stays inside the approved folder and keeps the literal link', () => {
  const literal = 'https://dl.dod.cyber.mil//wp-content/uploads/stigs/zip/U_Example_V1R1_STIG.zip';
  const records = fixtures(); records[1].DownloadLink = literal;
  const active = reconcileDisaPublicInventory(parse(records)).dispositions.find((entry) => entry.filename === 'U_Example_V1R1_STIG.zip');
  assert.equal(active.disposition, 'active_manual_candidate');
  assert.equal(active.url, literal);
  assert.equal(active.literal_url, literal);
  for (const url of ['https://dl.dod.cyber.mil//wp-content/uploads/stigs/pdf/U_Example_V1R1_STIG.zip',
    'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip//nested/U_Example_V1R1_STIG.zip']) {
    const outside = fixtures(); outside[1].DownloadLink = url;
    assert.throws(() => reconcileDisaPublicInventory(parse(outside)), /approved public archive/);
  }
});

test('unexpected envelope, malformed JSON, invalid UTF-8 and oversized response fail closed', () => {
  for (const raw of ['<html>Forbidden</html>', '{', JSON.stringify({ returnValue: fixtures() }),
    JSON.stringify({ returnValue: fixtures(), cacheable: false, error: ['failed'] })]) {
    assert.throws(() => parseDisaPublicInventory(Buffer.from(raw), options()), /Invalid|Incomplete/);
  }
  assert.throws(() => parseDisaPublicInventory(Buffer.from([0xff]), options()), /Invalid/);
  assert.throws(() => parseDisaPublicInventory(Buffer.alloc(DISA_PUBLIC_INVENTORY_MAX_BYTES + 1), options()), /byte bound/);
});

test('redirects and endpoint, host or query changes cannot establish a public inventory observation', () => {
  for (const resolvedUrl of [undefined, 'https://www.cyber.mil/',
    DISA_PUBLIC_INVENTORY_URL.replace('asGuest=true', 'asGuest=false'),
    DISA_PUBLIC_INVENTORY_URL.replace('www.cyber.mil', 'example.com')]) {
    assert.throws(() => parseDisaPublicInventory(response(fixtures()), { ...options(), resolvedUrl }), /endpoint/);
  }
});

test('duplicate native IDs, URLs and candidate filenames are rejected', () => {
  const cases = [
    [...fixtures(), { ...row('004', 'U_New_V1R1_STIG.zip'), Name: 'File-002' }],
    [...fixtures(), row('004', 'U_Example_V1R1_STIG.zip')],
    [...fixtures(), { ...row('004', 'U_Example_V1R1_STIG.zip'), DownloadLink: 'https://example.com/U_Example_V1R1_STIG.zip' }],
  ];
  for (const records of cases) assert.throws(() => parse(records), /Duplicate/);
});

test('unclassified status, native fields, valid dates and STIG library membership are required', () => {
  for (const change of [{ Classification: 'CUI' }, { Name: '' }, { UploadDate: '2026-02-30' },
    { RawDocumentLibrary: 'Other' }, { DownloadType: '' }]) {
    const records = fixtures(); records[1] = { ...records[1], ...change };
    assert.throws(() => parse(records), /non-public/);
  }
  const records = fixtures(); records[1].RawDocumentLibrary = 'Other;STIGs';
  assert.equal(parse(records).record_count, 3);
});

test('URL validation rejects credentials, ambiguous paths, fragments and non-HTTPS without requesting them', () => {
  for (const url of ['http://dl.dod.cyber.mil/a.zip', 'https://user:secret@dl.dod.cyber.mil/a.zip',
    `${base}U_A%2fB_V1R1_STIG.zip`, `${base}U_A%2520B_V1R1_STIG.zip`, `${base}U_A_V1R1_STIG.zip#fragment`]) {
    const records = fixtures(); records[1].DownloadLink = url;
    assert.throws(() => parse(records), /publisher URL/);
  }
});

test('literal and encoded C0 and DEL characters remain forbidden in publisher paths', () => {
  for (const code of [...Array(32).keys(), 127]) {
    for (const character of [String.fromCodePoint(code), `%${code.toString(16).padStart(2, '0')}`]) {
      const records = fixtures();
      records[1].DownloadLink = `${base}U_Example${character}_V1R1_STIG.zip`;
      assert.throws(() => parse(records), /publisher URL|filename/);
    }
  }
});

test('publisher field order and row order do not change inventory checksum, changed metadata does', () => {
  const first = parse(fixtures());
  const reversed = fixtures().reverse().map((record) => Object.fromEntries(Object.entries(record).reverse()));
  const reordered = parse(reversed);
  assert.equal(first.inventory_checksum, reordered.inventory_checksum);
  assert.notEqual(first.response_checksum, reordered.response_checksum);
  const changed = fixtures(); changed[1].UploadDate = '2026-11-06';
  assert.notEqual(first.inventory_checksum, parse(changed).inventory_checksum);
});

test('newest manual edition is chosen before explicit Sunset, without resurrecting an older unmarked edition', () => {
  const records = [row('001', compilation), row('002', 'U_SLES_12_V3R4_STIG.zip'),
    row('003', 'U_SLES_12_V3R5_STIG.zip', 'STIGs;Sunset')];
  const result = reconcileDisaPublicInventory(parse(records));
  assert.equal(result.active_manual_candidates, 0);
  assert.equal(result.exclusion_reasons.publisher_sunset, 1);
  assert.equal(result.exclusion_reasons.superseded_by_newer_release, 1);
  const old = result.dispositions.find((entry) => entry.publisher_id === 'File-002');
  assert.equal(old.reason, 'superseded_by_newer_release');
  assert.equal(old.superseded_by, 'U_SLES_12_V3R5_STIG.zip');
  assert.equal(result.dispositions.find((entry) => entry.publisher_id === 'File-003').reason, 'publisher_sunset');
});

test('Draft and Sunset metadata are preserved as exclusions even when filenames do not mention lifecycle', () => {
  const records = [row('001', compilation), row('002', 'U_Example_V1R1_STIG.zip'),
    row('003', 'U_Example_V2R1_STIG.zip', 'STIGs;Draft STIGs/SRGs'),
    { ...row('004', 'U_Apple_V2R2_STIG.zip', 'Sunset'), DownloadLink: 'https://s3.us-gov-west-1.amazonaws.com/dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_Apple_V2R2_STIG.zip' }];
  const result = reconcileDisaPublicInventory(parse(records));
  assert.equal(result.active_manual_candidates, 0);
  assert.equal(result.exclusion_reasons.publisher_draft, 1);
  assert.equal(result.exclusion_reasons.publisher_sunset, 1);
  assert.equal(result.dispositions.find((entry) => entry.publisher_id === 'File-004').literal_url, records[3].DownloadLink);
});

test('active manuals and the selected compilation require existing approved direct public archive locations', () => {
  for (const url of ['https://s3.us-gov-west-1.amazonaws.com/dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_Example_V1R1_STIG.zip',
    `${base}U_Example_V1R1_STIG.zip?token=not-a-credential`, 'https://example.com/U_Example_V1R1_STIG.zip']) {
    const records = fixtures(); records[1].DownloadLink = url;
    assert.throws(() => reconcileDisaPublicInventory(parse(records)), /approved public archive/);
  }
});

test('a missing or ambiguous compilation does not fall back to a guessed directory or archive', () => {
  assert.throws(() => reconcileDisaPublicInventory(parse(fixtures().slice(1))), /compilation identity/);
  assert.throws(() => reconcileDisaPublicInventory(parse([...fixtures(), row('004', 'U_SRG-STIG_Library_July_2026.zip')])), /compilation identity/);
});

test('all rows receive a reasoned disposition and filename coverage never promotes archive or native-content freshness', () => {
  const records = [...fixtures(), row('004', 'U_Example_V1R2_STIG.zip'),
    row('005', 'U_Example_V1R2_STIG_SCAP.zip'), row('006', 'U_STIG_GPO_Package_October_2026 (2).zip')];
  const result = reconcileDisaPublicInventory(parse(records), {
    acceptedCompilationFiles: ['U_Example_V1R2_STIG.zip'], acceptedStandaloneFiles: ['U_Other_SRG_V2R1.zip'],
  });
  assert.equal(result.record_count, 6);
  assert.equal(result.active_manual_candidates, 2);
  assert.equal(result.excluded_records, 4);
  assert.equal(result.accepted_compilation_filenames, 1);
  assert.equal(result.accepted_standalone_filenames, 1);
  assert.equal(result.unrepresented_manual_filenames, 0);
  assert.equal(result.publisher_archive_bytes_retrieved, false);
  assert.equal(result.native_content_verified, false);
  assert.equal(result.source_promotion_permitted, false);
});

test('retained old-directory metadata and retrieval dates remain unchanged; changed discovery stays inventory-only', () => {
  const accepted = { discovery_source: base, retrieval_timestamp: '2026-10-28T15:41:39.615Z',
    checksum: `sha256:${'a'.repeat(64)}`, compilation_files: ['U_Example_V1R1_STIG.zip'],
    standalone_files: ['U_Other_SRG_V2R1.zip'], prior_failure: { http: 403 } };
  const before = structuredClone(accepted);
  const result = reconcileDisaPublicInventory(parse(fixtures()), {
    acceptedCompilationFiles: accepted.compilation_files, acceptedStandaloneFiles: accepted.standalone_files,
  });
  assert.deepEqual(accepted, before);
  assert.equal(result.retrieval_timestamp, undefined);
  assert.equal(result.source_promotion_permitted, false);
  const changed = fixtures(); changed[1] = row('002', 'U_Example_V1R2_STIG.zip');
  const candidate = reconcileDisaPublicInventory(parse(changed), { acceptedCompilationFiles: accepted.compilation_files });
  assert.equal(candidate.unrepresented_manual_filenames, 2);
  assert.equal(candidate.source_promotion_permitted, false);
  assert.deepEqual(accepted, before);
});

test('unknown candidate package names are blockers rather than silently excluded manual content', () => {
  assert.throws(() => reconcileDisaPublicInventory(parse([...fixtures(), row('004', 'U_Unrecognized_Current_STIG.zip')])), /Ambiguous lifecycle-marked DISA edition/);
});

test('changing records after parsing invalidates the inventory proof before reconciliation', () => {
  const snapshot = parse(fixtures());
  snapshot.records[1].DownloadLink = `${base}U_Example_V9R9_STIG.zip`;
  assert.throws(() => reconcileDisaPublicInventory(snapshot), /complete parsed/);
});

for (const marker of ['Sunset', 'Draft', 'IDraft']) test(`filename ${marker} edition participates before exclusion`, () => {
  const records = [row('001', compilation), row('002', 'U_Example_V1R1_STIG.zip'), row('003', `U_Example_V2R1_${marker}_STIG.zip`)];
  const result = reconcileDisaPublicInventory(parse(records));
  assert.equal(result.active_manual_candidates, 0);
  assert.equal(result.dispositions.find((entry) => entry.publisher_id === 'File-002').reason, 'superseded_by_newer_release');
});

test('ambiguous lifecycle family, equal numeric editions and incomparable schemes quarantine', () => {
  for (const extra of ['U_Example_V1R1_Manual_STIG.zip', 'U_Example_Y2026M10_STIG.zip', 'U_Example_Sunset_V2R1_STIG.zip']) {
    assert.throws(() => reconcileDisaPublicInventory(parse([...fixtures(), row('004', extra)])), /Ambiguous|Incomparable/);
  }
});

test('a tampered or out-of-band completeness record cannot reach reconciliation', () => {
  for (const change of [(c) => { c.minimum = 1; }, (c) => { c.baseline_count = 2; }, (c) => { c.method = 'count_only'; }]) {
    const snapshot = parse(fixtures()); change(snapshot.completeness);
    assert.throws(() => reconcileDisaPublicInventory(snapshot), /complete parsed/);
  }
});

test('an identical later response keeps its checksum while each observation keeps its own time', () => {
  const raw = response(fixtures());
  const a = parseDisaPublicInventory(raw, options());
  const b = parseDisaPublicInventory(raw, { ...options(), observedAt: '2026-11-18T12:00:00Z' });
  assert.notEqual(a.observed_at, b.observed_at);
  assert.equal(a.response_checksum, b.response_checksum);
  assert.equal(a.inventory_checksum, b.inventory_checksum);
});

test('recorded complete 417-row API fixture reconciles all lifecycle and accepted filename coverage', () => {
  const read = (name) => readFileSync(new URL(`./fixtures/disa-public-inventory/${name}`, import.meta.url));
  const snapshot = parseDisaPublicInventory(read('response.json'), { baselineCount: DISA_INITIAL_INVENTORY_BASELINE,
    observedAt: '2026-11-11T01:50:35Z', requestFingerprint: DISA_PUBLIC_REQUEST_FINGERPRINT, resolvedUrl: DISA_PUBLIC_INVENTORY_URL });
  const coverage = JSON.parse(read('accepted-filenames.json'));
  const result = reconcileDisaPublicInventory(snapshot, { acceptedCompilationFiles: coverage.compilation, acceptedStandaloneFiles: coverage.standalone });
  assert.equal(snapshot.response_checksum, 'sha256:ea1597986b3af9cbb92db6db18acbc295eb229002383b4562459ce85c2429999');
  assert.equal(result.record_count, 417); assert.equal(result.active_manual_candidates, 192);
  assert.equal(result.excluded_records, 225); assert.equal(result.exclusion_reasons.publisher_sunset, 116);
  assert.equal(result.accepted_compilation_filenames, 183); assert.equal(result.accepted_standalone_filenames, 9);
  assert.equal(result.unrepresented_manual_filenames, 0);
  assert.equal(result.source_promotion_permitted, false); assert.equal(result.native_content_verified, false);
});
