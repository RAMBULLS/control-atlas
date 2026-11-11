import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  DISA_PUBLIC_INVENTORY_URL, DISA_PUBLIC_REQUEST_FINGERPRINT,
  disaCanonicalHash, disaEvidenceHash, parseDisaPublicInventory, reconcileDisaPublicInventory,
} from './disa-public-inventory.mjs';

export const DISA_WITNESS_PATH = 'data/curated/disa/public-inventory-witness.json';
export const DISA_EVIDENCE_DIRECTORY = 'tmp/disa-cache/inventory';
const SHA = /^sha256:[a-f0-9]{64}$/;
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Read actual retained bytes in bounded chunks, never size alone. */
export function hashDisaFile(path) {
  if (!lstatSync(path).isFile()) throw new Error('DISA evidence must be a regular file');
  const fd = openSync(path, 'r'); const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024);
  let byteLength = 0;
  try {
    for (;;) { const size = readSync(fd, buffer, 0, buffer.length, null); if (!size) break; hash.update(buffer.subarray(0, size)); byteLength += size; }
  } finally { closeSync(fd); }
  return { checksum: `sha256:${hash.digest('hex')}`, byte_length: byteLength };
}

export function verifyRetainedDisaFile(path, accepted, expectedUrl) {
  if (accepted?.source_url !== expectedUrl || !SHA.test(accepted?.checksum || '') ||
      !validTime(accepted?.retrieval_timestamp) || !Number.isSafeInteger(accepted?.byte_length) || accepted.byte_length < 1) {
    throw new Error('No accepted DISA byte provenance for reuse');
  }
  const actual = hashDisaFile(path);
  if (actual.checksum !== accepted.checksum || actual.byte_length !== accepted.byte_length) throw new Error('Retained DISA bytes differ from accepted hash');
  return { ...actual, retrieval_timestamp: accepted.retrieval_timestamp,
    source_url: expectedUrl, acquisition: 'retained_hash_verified', verified_at: new Date().toISOString() };
}

export function disaInventoryReceipt(snapshot, reconciliation, rawPath, codeCommit) {
  const expectedPath = `${DISA_EVIDENCE_DIRECTORY}/${snapshot.response_checksum.slice(7)}.json`;
  if (!/^[a-f0-9]{40}$/.test(codeCommit || '') || rawPath !== expectedPath || reconciliation.inventory_checksum !== snapshot.inventory_checksum ||
      reconciliation.record_count !== snapshot.record_count) throw new Error('DISA inventory receipt does not bind evidence');
  return { scope: 'publisher_public_inventory_metadata', method: 'POST', http: 200, validation: 'remote',
    url: DISA_PUBLIC_INVENTORY_URL, resolved_url: DISA_PUBLIC_INVENTORY_URL,
    request_fingerprint: DISA_PUBLIC_REQUEST_FINGERPRINT, code_commit: codeCommit, checked_at: snapshot.observed_at,
    sha256: snapshot.response_checksum, byte_length: snapshot.response_byte_length,
    inventory_checksum: snapshot.inventory_checksum, record_count: snapshot.record_count,
    completeness: snapshot.completeness, reconciliation_checksum: disaCanonicalHash(reconciliation),
    raw_path: rawPath, witness_path: DISA_WITNESS_PATH,
    publisher_archive_bytes_retrieved: false, native_content_verified: false,
  };
}

// Hash-bound integrity evidence, not a cryptographic signature. Receipt times
// must belong to this transaction; retained publisher retrieval dates stay old.
export function hasDisaNativeAcceptance(manifest, receipt, { startedAt, completedAt } = {}) {
  const start = Date.parse(startedAt); const end = Date.parse(completedAt);
  const attempt = Date.parse(receipt?.started_at); const proof = manifest?.native_acceptance;
  const inventory = manifest?.public_inventory?.receipt;
  const during = (value) => validTime(value) && Date.parse(value) >= attempt && Date.parse(value) <= end;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(attempt) || attempt < start || end < attempt ||
      receipt?.task_id !== 'fetch-disa-library' || receipt?.source_id !== 'fetch-disa-library' ||
      proof?.scope !== 'publisher_bytes_and_native_content' || !during(proof.verified_at) ||
      !SHA.test(proof.output_checksum || '') || !SHA.test(proof.native_checksum || '') ||
      inventory?.scope !== 'publisher_public_inventory_metadata' || inventory.method !== 'POST' || inventory.http !== 200 ||
      inventory.url !== DISA_PUBLIC_INVENTORY_URL || inventory.resolved_url !== DISA_PUBLIC_INVENTORY_URL ||
      inventory.request_fingerprint !== DISA_PUBLIC_REQUEST_FINGERPRINT || !during(inventory.checked_at) ||
      !SHA.test(inventory.sha256 || '') || !SHA.test(inventory.inventory_checksum || '') ||
      !SHA.test(inventory.completeness?.witness_checksum || '') ||
      inventory.completeness.inventory_checksum !== inventory.inventory_checksum ||
      !validTime(inventory.completeness.observed_at) || Date.parse(inventory.completeness.observed_at) > Date.parse(inventory.checked_at) ||
      !/^[a-f0-9]{40}$/.test(inventory.code_commit || '') || proof.code_commit !== inventory.code_commit ||
      proof.inventory_checksum !== inventory.inventory_checksum || proof.response_checksum !== inventory.sha256 ||
      !receipt.requests?.some((entry) => disaCanonicalHash(entry) === disaCanonicalHash(inventory)) ||
      !receipt.disa_native_acceptance || disaCanonicalHash(receipt.disa_native_acceptance) !== disaCanonicalHash(proof) ||
      manifest.publications?.failed_publications !== 0 || manifest.publications?.missing_publications !== 0 ||
      manifest.reconciliation?.failed_files !== 0 || !Array.isArray(proof.archives) || !proof.archives.length) return false;
  const packages = manifest.reconciliation.standalone_packages;
  if (manifest.public_inventory.reconciliation?.active_manual_candidates !== manifest.publications.expected_canonical_publications ||
      manifest.publications.expected_canonical_publications !== manifest.publications.represented_in_compilation + manifest.publications.standalone_ingested ||
      !Array.isArray(packages) || packages.length !== manifest.publications.standalone_ingested || proof.archives.length !== packages.length + 1) return false;
  const expected = [{ source_url: manifest.artifact_url, checksum: manifest.checksum, byte_length: manifest.byte_length,
    retrieval_timestamp: manifest.retrieval_timestamp }, ...packages];
  return expected.every((item, index) => {
    const archive = proof.archives[index];
    return archive && archive.source_url === item.source_url && archive.checksum === item.checksum && SHA.test(archive.checksum || '') &&
      archive.byte_length === item.byte_length && Number.isSafeInteger(archive.byte_length) && archive.byte_length > 0 &&
      archive.retrieval_timestamp === item.retrieval_timestamp && validTime(archive.retrieval_timestamp) && during(archive.verified_at) &&
      ['downloaded_publisher_bytes', 'retained_hash_verified'].includes(archive.acquisition) &&
      (archive.acquisition !== 'downloaded_publisher_bytes' || during(archive.retrieval_timestamp));
  });
}

/** Readers validate retained raw response/witness correspondence, native/output
 * hashes and exact archive ownership before treating a transaction as recovered. */
export function validateDisaAcceptanceEvidence(root, manifest, receipt, times) {
  if (!hasDisaNativeAcceptance(manifest, receipt, times)) throw new Error('DISA metadata alone cannot establish byte/native acceptance');
  const entry = manifest.public_inventory.receipt;
  if (entry.raw_path !== `${DISA_EVIDENCE_DIRECTORY}/${entry.sha256.slice(7)}.json` || entry.witness_path !== DISA_WITNESS_PATH) throw new Error('Invalid DISA evidence ownership');
  const read = (path) => { if (!lstatSync(join(root, path)).isFile()) throw new Error('DISA evidence must be a regular file'); return readFileSync(join(root, path)); };
  const bytes = read(entry.raw_path); const witness = read(entry.witness_path);
  const snapshot = parseDisaPublicInventory(bytes, { witnessBytes: witness, observedAt: entry.checked_at,
    resolvedUrl: entry.resolved_url, requestFingerprint: entry.request_fingerprint });
  if (snapshot.response_checksum !== entry.sha256 || snapshot.response_byte_length !== entry.byte_length ||
      snapshot.inventory_checksum !== entry.inventory_checksum || snapshot.record_count !== entry.record_count ||
      disaCanonicalHash(snapshot.completeness) !== disaCanonicalHash(entry.completeness) ||
      disaEvidenceHash(witness) !== entry.completeness.witness_checksum) throw new Error('DISA consumed evidence checksum mismatch');
  const retained = manifest.public_inventory.reconciliation;
  if (!Array.isArray(retained?.dispositions)) throw new Error('DISA lifecycle reconciliation missing');
  // Recompute every disposition and field from consumed raw rows. Accepted
  // filename coverage remains informational, never archive/native evidence.
  const reconciliation = reconcileDisaPublicInventory(snapshot, {
    acceptedCompilationFiles: retained.dispositions.filter((row) => row.accepted_filename_coverage === 'compilation_manifest').map((row) => row.filename),
    acceptedStandaloneFiles: retained.dispositions.filter((row) => row.accepted_filename_coverage === 'standalone_manifest').map((row) => row.filename),
  });
  if (disaCanonicalHash(retained) !== entry.reconciliation_checksum ||
      disaCanonicalHash(reconciliation) !== entry.reconciliation_checksum ||
      manifest.compilation_url !== reconciliation.compilation_url || manifest.artifact_url !== reconciliation.compilation_url) {
    throw new Error('DISA lifecycle reconciliation mismatch');
  }
  for (const pkg of manifest.reconciliation.standalone_packages) {
    if (!reconciliation.dispositions.some((row) => row.disposition === 'active_manual_candidate' && row.filename === pkg.filename && row.url === pkg.source_url)) {
      throw new Error('DISA standalone URL is not selected by the complete public inventory');
    }
  }
  const proof = manifest.native_acceptance;
  if (hashDisaFile(join(root, DISA_EVIDENCE_DIRECTORY, 'native.json')).checksum !== proof.native_checksum) throw new Error('DISA native proof checksum mismatch');
  const paths = ['data/stig-rules.json', 'data/srg-requirements.json', 'maps/stig-srg-to-cci.json',
    'data/curated/disa/stig-previous-editions.json', 'data/curated/disa/srg-previous-editions.json'];
  const outputs = paths.map((path) => ({ path, ...hashDisaFile(join(root, path)) }));
  if (disaCanonicalHash(outputs) !== proof.output_checksum) throw new Error('DISA accepted output checksum mismatch');
  for (const [index, archive] of proof.archives.entries()) {
    const filename = manifest.reconciliation.standalone_packages[index - 1]?.filename;
    if (index && (typeof filename !== 'string' || !/^U_[^/\\]+\.zip$/i.test(filename) || filename.includes('..'))) throw new Error('Invalid DISA cache filename');
    const path = index ? `tmp/disa-cache/standalone/${filename}` : 'tmp/disa-cache/compilation.zip';
    const actual = hashDisaFile(join(root, path));
    if (actual.checksum !== archive.checksum || actual.byte_length !== archive.byte_length) throw new Error('DISA accepted archive checksum mismatch');
  }
  return true;
}

export const DISA_ACCEPTED_OUTPUT_PATHS = Object.freeze(['data/stig-rules.json', 'data/srg-requirements.json',
  'maps/stig-srg-to-cci.json', 'data/curated/disa/stig-previous-editions.json', 'data/curated/disa/srg-previous-editions.json']);
