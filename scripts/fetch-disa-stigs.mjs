#!/usr/bin/env node
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { promisify } from 'node:util';

import { parseDisaCompilationStream, parseDisaStandalonePackage } from '../tools/importers/disa-stig-adapter.mjs';
import {
  reconcilePublicationInventory,
  dedupeDisaRecords,
  dedupeDisaRelationships,
} from './lib/disa-publication-reconciliation.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { createStrictConditionalFetch, fetchDisaPublicInventoryBytes } from './lib/strict-conditional-fetch.mjs';
import { assertOfficialSourceUrl } from './lib/source-url-policy.mjs';
import { readDisaCatalog, writeDisaCatalog, attestDisaProjections } from './lib/disa-record-history.mjs';
import { verifyDisaSnapshot, mergeDisaSnapshot } from './lib/disa-refresh.mjs';
import { disaNativeInventories } from '../tools/importers/disa-native-inventory.mjs';

import { DISA_PUBLIC_INVENTORY_URL, parseDisaPublicInventory, reconcileDisaPublicInventory, disaCanonicalHash } from './lib/disa-public-inventory.mjs';
import { DISA_WITNESS_PATH, DISA_EVIDENCE_DIRECTORY, DISA_ACCEPTED_OUTPUT_PATHS, hashDisaFile, verifyRetainedDisaFile } from './lib/disa-source-acceptance.mjs';
import { recordDisaInventoryReceipt, recordDisaNativeAcceptance } from './lib/source-check-receipts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED_ARTIFACTS = {
  stig: join(ROOT, 'data', 'stig-rules.json'),
  srg: join(ROOT, 'data', 'srg-requirements.json'),
  relationships: join(ROOT, 'maps', 'stig-srg-to-cci.json'),
};

const DL_BASE = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/';

// Legacy HTML parsing helpers remain for historical fixtures only. Discovery
// below never requests the access-denied legacy directory.
const MONTH_ORDER = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
function compilationSortKey(filename) {
  const match = filename.match(/Library_(?:(\d{4})_(\d{2})|([A-Za-z]+)_(\d{4}))/);
  if (!match) return [0, 0];
  if (match[1]) return [Number(match[1]), Number(match[2])];
  const month = MONTH_ORDER[match[3].toLowerCase()] || 0;
  return [Number(match[4]), month];
}
export function findLatestDisaLibraryUrl(directoryHtml) {
  const files = [...String(directoryHtml).matchAll(/href=["']([^"']*Library[^"']*\.zip)["']/gi)]
    .map((match) => match[1])
    .filter((file) => !file.includes('/'));
  if (!files.length) return null;
  const [latest] = [...new Set(files)].sort((a, b) => {
    const [ay, am] = compilationSortKey(a);
    const [by, bm] = compilationSortKey(b);
    return by - ay || bm - am;
  });
  return `${DL_BASE}${latest}`;
}

function checksum(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function findOfficialDisaCompilationUrl(html) {
  const matches = [...String(html).matchAll(/https:\/\/dl\.dod\.cyber\.mil\/[^\s"']*\/U_[^\s"']*STIG[^\s"']*Library[^\s"']*\.zip/gi)]
    .map((match) => match[0])
    .sort();
  return matches[0] || null;
}

export function extractDisaZipUrlsFromHtml(html) {
  const matches = [...String(html).matchAll(/href=["']([^"']+\.zip)["']/gi)]
    .map((match) => match[1])
    .filter((href) => !href.includes('/') || /^https:\/\/dl\.dod\.cyber\.mil\/wp-content\/uploads\/stigs\/zip\//i.test(href))
    .map((href) => (/^https?:\/\//i.test(href) ? href : `${DL_BASE}${href}`));
  return [...new Set(matches)];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

// Reuse requires actual accepted hashes and dates. Size/HEAD equality is not
// byte proof. The source transaction owns the whole cache, including history.
async function fetchAndParseCompilation(compilationUrl, fetchImpl, options = {}) {
  const cacheDir = join(ROOT, 'tmp', 'disa-cache'); mkdirSync(cacheDir, { recursive: true });
  const archivePath = join(cacheDir, 'compilation.zip');
  let evidence;
  if (!options.requireFresh && existsSync(archivePath)) {
    const accepted = options.accepted;
    evidence = verifyRetainedDisaFile(archivePath, { ...accepted, source_url: accepted?.artifact_url }, compilationUrl);
  } else {
    const tmpPath = `${archivePath}.${Date.now()}.part`;
    try {
      await downloadCompilation(compilationUrl, tmpPath, fetchImpl);
      const actual = hashDisaFile(tmpPath);
      if (existsSync(archivePath)) {
        const history = join(cacheDir, 'history'); mkdirSync(history, { recursive: true });
        const prior = hashDisaFile(archivePath); const retained = join(history, `${prior.checksum.slice(7)}.zip`);
        if (!existsSync(retained)) copyFileSync(archivePath, retained);
      }
      renameSync(tmpPath, archivePath);
      evidence = { ...actual, source_url: compilationUrl, retrieval_timestamp: new Date().toISOString(),
        verified_at: new Date().toISOString(), acquisition: 'downloaded_publisher_bytes' };
    } finally { rmSync(tmpPath, { force: true }); }
  }
  const parsed = await parseDisaCompilationStream(archivePath, {
    artifactUrl: compilationUrl, sourceKeys: { stig: 'disa-stig-library', srg: 'disa-srg-library' },
    selectedPublicationFilenames: options.selectedPublicationFilenames,
  });
  if (parsed.checksum !== evidence.checksum) throw new Error('DISA compilation changed during parsing');
  return { ...parsed, sourceArtifact: compilationUrl, checksum: evidence.checksum,
    byteLength: evidence.byte_length, retrievalTimestamp: evidence.retrieval_timestamp, archiveEvidence: evidence, fallbackMode: null };
}

async function fetchAndParseStandalonePackages(standaloneNeeded, fetchImpl, options = {}) {
  const cacheDir = join(ROOT, 'tmp', 'disa-cache', 'standalone');
  mkdirSync(cacheDir, { recursive: true });

  const limit = options.concurrency || 6;
  const successes = [];
  const failures = [];
  const stigs = [];
  const srgs = [];
  const relationshipSeeds = [];

  const results = await mapConcurrent(standaloneNeeded, limit, async (pkg) => {
    const url = pkg.url;
    if (!url || new URL(url).href !== url) throw new Error('Missing exact public inventory package URL');
    const cachedFile = join(cacheDir, pkg.filename);
    try {
      let buffer; let evidence;
      if (existsSync(cachedFile) && !options.requireFresh) {
        const prior = options.accepted?.reconciliation?.standalone_packages?.find((entry) => entry.filename === pkg.filename);
        evidence = verifyRetainedDisaFile(cachedFile, prior, url);
        buffer = readFileSync(cachedFile);
      } else {
        const response = await fetchImpl(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} fetching ${url}`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
        if (existsSync(cachedFile) && checksum(readFileSync(cachedFile)) !== checksum(buffer)) {
          const history = join(cacheDir, 'history'); mkdirSync(history, { recursive: true });
          const priorHash = checksum(readFileSync(cachedFile)).slice(7);
          const snapshot = join(history, `${priorHash}.zip`);
          if (!existsSync(snapshot)) copyFileSync(cachedFile, snapshot);
        }
        writeFileSync(cachedFile, buffer);
        evidence = { source_url: url, checksum: checksum(buffer), byte_length: buffer.length,
          retrieval_timestamp: new Date().toISOString(), verified_at: new Date().toISOString(), acquisition: 'downloaded_publisher_bytes' };
      }

      const parsed = parseDisaStandalonePackage(buffer, {
        artifactUrl: url,
        hintKind: pkg.kind,
        publicationFilename: pkg.filename,
      });

      if (parsed.failed.length > 0 || parsed.stigRecords.length + parsed.srgRecords.length === 0) {
        throw new Error(`Failed to parse benchmark XML: ${parsed.failed.map((f) => f.reason).join('; ')}`);
      }

      return { success: true, pkg, parsed, evidence };
    } catch (err) {
      return { success: false, pkg, error: err.message };
    }
  });

  for (const res of results) {
    if (res.success) {
      successes.push({
        ...res.evidence,
        filename: res.pkg.filename,
        family: res.pkg.family,
        kind: res.pkg.kind,
        versionStr: res.pkg.versionStr,
        stigRecords: res.parsed.stigRecords.length,
        srgRecords: res.parsed.srgRecords.length,
        checksum: res.parsed.checksum,
        xccdf_files: res.parsed.inventory.filter((entry) => entry.status === 'ingested').length,
      });
      stigs.push(...res.parsed.stigRecords);
      srgs.push(...res.parsed.srgRecords);
      relationshipSeeds.push(...res.parsed.relationshipSeeds);
    } else {
      failures.push({
        filename: res.pkg.filename,
        family: res.pkg.family,
        kind: res.pkg.kind,
        reason: res.error,
      });
    }
  }

  return {
    successes,
    failures,
    stigs,
    srgs,
    relationshipSeeds,
  };
}

const RANGE_BYTES = process.platform === 'win32' ? 2 * 1024 * 1024 : 8 * 1024 * 1024;
const RANGE_RETRIES = 6;
// Ranged downloads already retry per range with their own waits. One request per
// attempt here keeps a persistent outage from multiplying into dozens of requests.
const strictConditionalFetch = createStrictConditionalFetch({ retry: { attempts: 1 } });
const execFileAsync = promisify(execFile);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchRange(url, start, end, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= RANGE_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (response.status !== 206) {
        const error = new Error(`expected HTTP 206 for ${start}-${end}, received ${response.status}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) error.code = 'DISA_ACCESS_REJECTED';
        throw error;
      }
      const range = response.headers?.get?.('content-range') || '';
      const match = range.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
      if (!match || Number(match[1]) !== start || Number(match[2]) !== end) {
        throw new Error(`DISA range response did not match requested bytes: ${range || 'missing Content-Range'}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== end - start + 1) {
        throw new Error(`DISA range body length ${bytes.length} did not match ${end - start + 1} requested bytes`);
      }
      return { bytes, totalBytes: Number(match[3]) };
    } catch (error) {
      if (error.code === 'DISA_ACCESS_REJECTED') throw error;
      lastError = error;
      if (attempt < RANGE_RETRIES) await wait(attempt * 2_000);
    }
  }
  throw lastError;
}

export async function fetchRangeWithCurl(url, start, end, destination, options = {}) {
  const approvedUrl = assertOfficialSourceUrl(url).href;
  const runCurl = options.execFileImpl || execFileAsync;
  const rangePath = `${destination}.${start}.part`;
  let lastError;
  try {
    for (let attempt = 1; attempt <= RANGE_RETRIES; attempt += 1) {
      try {
        const { stdout } = await runCurl('curl.exe', [
          '--disable', '--fail', '--silent', '--show-error',
          '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '0',
          '--range', `${start}-${end}`,
          '--output', rangePath,
          '--write-out', '%{http_code}\n%{url_effective}',
          approvedUrl,
        ], { timeout: 60_000 });
        const [status, effectiveUrl] = String(stdout).trim().split(/\r?\n/);
        if (status !== '206' || effectiveUrl !== approvedUrl) {
          const error = new Error('DISA curl rejected redirect, non-range response, or changed effective URL');
          error.code = 'DISA_EGRESS_REJECTED';
          throw error;
        }
        const bytes = readFileSync(rangePath);
        if (bytes.length !== end - start + 1) {
          throw new Error(`DISA curl range body length ${bytes.length} did not match ${end - start + 1} requested bytes`);
        }
        return bytes;
      } catch (error) {
        if (error.code === 'DISA_EGRESS_REJECTED') throw error;
        lastError = error;
        if (attempt < RANGE_RETRIES) await wait(attempt * 2_000);
      }
    }
    throw lastError;
  } finally {
    rmSync(rangePath, { force: true });
  }
}

// Some DISA CDN responses terminate before Node can finish a single 352 MB
// body. Range retrieval keeps every request bounded and verifies each response
// before appending it. Servers that do not support ranges retain the ordinary
// streaming path for compatibility with injected test fetchers.
async function downloadCompilation(url, destination, fetchImpl) {
  const probe = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
  const contentRange = probe.headers?.get?.('content-range') || '';
  const rangeMatch = contentRange.match(/^bytes\s+0-0\/(\d+)$/i);
  const output = createWriteStream(destination);
  try {
    if (probe.status === 206 && rangeMatch) {
      const totalBytes = Number(rangeMatch[1]);
      for (let start = 0; start < totalBytes; start += RANGE_BYTES) {
        const end = Math.min(totalBytes - 1, start + RANGE_BYTES - 1);
        const range = process.platform === 'win32'
          ? { bytes: await fetchRangeWithCurl(url, start, end, destination), totalBytes }
          : await fetchRange(url, start, end, fetchImpl);
        if (range.totalBytes !== totalBytes) {
          throw new Error(`DISA range total changed during download (${totalBytes} != ${range.totalBytes})`);
        }
        if (!output.write(range.bytes)) await once(output, 'drain');
      }
    } else {
      if (!probe.ok) throw new Error(`DISA compilation fetch failed: ${probe.status} ${url}`);
      await pipeline(Readable.from(probe.body), output);
      return;
    }
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function discoverAndFetchAll(fetchImpl, options = {}) {
  if (!process.env.CONTROL_ATLAS_SOURCE_CHECK_RECEIPT || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) {
    throw new Error('DISA refresh requires a current hosted source transaction receipt and code commit');
  }
  // The witness is independently captured and reviewed. Never derive its count
  // or digest from this response, and never guess a fallback inventory endpoint.
  const witnessBytes = readFileSync(join(ROOT, DISA_WITNESS_PATH));
  if (JSON.parse(witnessBytes).fixture_only === true) throw new Error('Test fixtures are not an admitted production DISA witness');
  const response = await fetchDisaPublicInventoryBytes(options.inventoryFetchImpl ? { fetchImpl: options.inventoryFetchImpl } : {});
  const snapshot = parseDisaPublicInventory(response.bytes, { ...response, witnessBytes });
  const acceptedPath = join(ROOT, 'data/disa-artifact-manifest.json');
  const accepted = existsSync(acceptedPath) ? readJson(acceptedPath) : null;
  const observation = reconcileDisaPublicInventory(snapshot, {
    acceptedCompilationFiles: [...new Set((accepted?.reconciliation?.inventory_details || []).map((entry) => entry.entryPath.match(/^([^/]+\.zip)/i)?.[1]).filter(Boolean))],
    acceptedStandaloneFiles: (accepted?.reconciliation?.standalone_packages || []).map((entry) => entry.filename),
  });
  const rawPath = `${DISA_EVIDENCE_DIRECTORY}/${snapshot.response_checksum.slice(7)}.json`;
  mkdirSync(join(ROOT, DISA_EVIDENCE_DIRECTORY), { recursive: true }); writeFileSync(join(ROOT, rawPath), response.bytes);
  const inventoryReceipt = recordDisaInventoryReceipt(process.env.CONTROL_ATLAS_SOURCE_CHECK_RECEIPT, {
    ...response, raw: response.bytes, witnessBytes, reconciliation: observation, rawPath,
  });
  if (options.inventoryCheck) throw new Error('DISA complete inventory observed; metadata-only outcome retains source quarantine pending archive byte and native acceptance');
  const currentPublications = observation.dispositions.filter((entry) => entry.disposition === 'active_manual_candidate');
  const compilationUrl = observation.compilation_url;
  const compilationResult = await fetchAndParseCompilation(compilationUrl, fetchImpl, { ...options, accepted,
    selectedPublicationFilenames: currentPublications.map((entry) => entry.filename) });
  const compilationInnerZips = new Set(
    (compilationResult.inventory || [])
      .map((e) => e.entryPath.match(/^([^/]+\.zip)/i)?.[1])
      .filter(Boolean),
  );

  const reconciliation = reconcilePublicationInventory(
    currentPublications,
    compilationInnerZips,
  );

  for (const publication of reconciliation.representedInCompilation) {
    if (!compilationResult.inventory.some((entry) => entry.status === 'ingested' && entry.recordCount > 0 &&
        entry.entryPath.startsWith(`${publication.filename}/`))) {
      throw new Error(`Selected DISA publication has no ingested native rules: ${publication.filename}`);
    }
  }

  let standaloneResult = { successes: [], failures: [], stigs: [], srgs: [], relationshipSeeds: [] };
  if (reconciliation.standaloneNeeded.length > 0 && !options.skipStandalone) {
    standaloneResult = await fetchAndParseStandalonePackages(
      reconciliation.standaloneNeeded.map((entry) => ({ ...entry, url: currentPublications.find((candidate) => candidate.filename === entry.filename).url })),
      fetchImpl,
      { ...options, accepted },
    );
  }

  const allStigs = dedupeDisaRecords([...compilationResult.stig.records, ...standaloneResult.stigs]);
  const allSrgs = dedupeDisaRecords([...compilationResult.srg.records, ...standaloneResult.srgs]);

  const combinedSeeds = [...compilationResult.relationships.relationships];
  for (const seed of standaloneResult.relationshipSeeds) {
    combinedSeeds.push({
      ...seed,
      source_catalog: seed.source_catalog,
      source_id: seed.source_id,
      target_catalog: seed.target_catalog,
      target_id: seed.target_id,
      relationship_type: seed.relationship_type,
      source_locator: seed.source_locator,
      why: `The official DISA ${seed.source_catalog === 'disa-stig' ? 'STIG' : 'SRG'} content references ${seed.target_id}.`,
      evidence_source: 'disa-stig-srg-cci-references',
    });
  }
  const uniqueRelationships = dedupeDisaRelationships(combinedSeeds);
  uniqueRelationships.sort((a, b) => a.source_id.localeCompare(b.source_id) || a.target_id.localeCompare(b.target_id));

  const totalExcludedArchives = observation.excluded_records;
  const missingCount = reconciliation.standaloneNeeded.length - standaloneResult.successes.length;

  return {
    ...compilationResult,
    publicInventory: { receipt: inventoryReceipt, reconciliation: observation },
    stig: {
      ...compilationResult.stig,
      records: allStigs,
    },
    srg: {
      ...compilationResult.srg,
      records: allSrgs,
    },
    relationships: {
      ...compilationResult.relationships,
      relationships: uniqueRelationships,
    },
    compilationStigCount: compilationResult.stig.records.length,
    compilationSrgCount: compilationResult.srg.records.length,
    standaloneStigCount: standaloneResult.stigs.length,
    standaloneSrgCount: standaloneResult.srgs.length,
    standaloneSuccesses: standaloneResult.successes,
    discoveredUrls: snapshot.record_count,
    publications: {
      total_discovered_archives: snapshot.record_count,
      expected_canonical_publications: currentPublications.length,
      represented_in_compilation: reconciliation.representedInCompilation.length,
      standalone_ingested: standaloneResult.successes.length,
      excluded_archives: totalExcludedArchives,
      failed_publications: standaloneResult.failures.length,
      missing_publications: missingCount,
    },
    failedPublications: standaloneResult.failures,
  };
}

function writeDisaArtifactManifest(result, outputRoot = ROOT) {
  const inventory = result.inventory || [];
  const count = (status) => inventory.filter((entry) => entry.status === status).length;
  const publications = result.publications || {
    total_discovered_archives: 0,
    expected_canonical_publications: 0,
    represented_in_compilation: 0,
    standalone_ingested: 0,
    excluded_archives: 0,
    failed_publications: 0,
    missing_publications: 0,
  };
  const manifest = {
    schema_version: '2.0',
    discovery_source: DISA_PUBLIC_INVENTORY_URL,
    public_inventory: result.publicInventory,
    compilation_url: result.sourceArtifact,
    artifact_url: result.sourceArtifact,
    byte_length: result.byteLength,
    retrieval_timestamp: result.retrievalTimestamp,
    checksum: result.checksum,
    publications,
    reconciliation: {
      discovered_urls: result.discoveredUrls ?? null,
      compilation_entries: inventory.length,
      ingested_files: count('ingested') + (result.standaloneSuccesses || []).reduce((sum, pkg) => sum + pkg.xccdf_files, 0),
      compilation_ingested_files: count('ingested'),
      standalone_ingested_files: (result.standaloneSuccesses || []).reduce((sum, pkg) => sum + pkg.xccdf_files, 0),
      excluded_files: count('excluded'),
      failed_files: count('failed') + (publications.failed_publications || 0),
      ignored_files: count('ignored'),
      stig_records_parsed: result.stig.records.length,
      srg_records_parsed: result.srg.records.length,
      cci_relationships: result.relationships.relationships.length,
      compilation_stig_records: result.compilationStigCount ?? result.stig.records.length,
      compilation_srg_records: result.compilationSrgCount ?? result.srg.records.length,
      standalone_stig_records: result.standaloneStigCount ?? 0,
      standalone_srg_records: result.standaloneSrgCount ?? 0,
      standalone_packages: result.standaloneSuccesses || [],
      inventory_details: inventory,
    },
  };
  writeJsonAtomically(join(outputRoot, 'data', 'disa-artifact-manifest.json'), manifest);
  return manifest;
}

export async function fetchDisaStigs(options = {}) {
  const requireFresh = options.requireFresh || process.env.CONTROL_ATLAS_REQUIRE_FRESH_FETCH === '1';
  const fetchImpl = options.fetchImpl || strictConditionalFetch;
  if (options.compilationUrl || process.env.DISA_STIG_COMPILATION_URL) {
    throw new Error('DISA compilation overrides cannot replace complete public inventory discovery');
  }
  // No silent committed-snapshot fallback can mark this failed source accepted.
  return discoverAndFetchAll(fetchImpl, { ...options, requireFresh });
}

async function main() {
  const requireFresh = process.argv.includes('--require-fresh') || process.env.CONTROL_ATLAS_REQUIRE_FRESH_FETCH === '1';
  const requestedOutput = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
  const outputRoot = requestedOutput ? resolve(ROOT, requestedOutput) : ROOT;
  if (requestedOutput && !outputRoot.startsWith(`${resolve(ROOT, '.local-agent/reference-export')}${sep}`)) throw new Error('Candidate output must remain in the existing local reference-export task area');
  let result = await fetchDisaStigs({ requireFresh, inventoryCheck: process.argv.includes('--inventory-check') && !process.argv.includes('--require-fresh') });
  if (requestedOutput) writeJsonAtomically(join(outputRoot, 'retrieval-diagnostics.json'), { fallback_mode: result.fallbackMode || null,
    publications: result.publications || null, failed_publications: result.failedPublications || [], failed_files: result.failed || [] });
  if (result.fallbackMode && requireFresh) {
    throw new Error(`DISA refresh required a live upstream fetch but used ${result.fallbackMode}`);
  }
  if ((result.publications?.failed_publications > 0 || result.publications?.missing_publications > 0 || result.failed?.length) && requireFresh) {
    throw new Error(`DISA refresh failed: ${result.publications.failed_publications} publication(s) failed`);
  }
  if (!requestedOutput && !result.fallbackMode) {
    const previous = { stig: readDisaCatalog(ROOT, 'stig'), srg: readDisaCatalog(ROOT, 'srg'), relationships: JSON.parse(readFileSync(COMMITTED_ARTIFACTS.relationships)) };
    const manifest = writeDisaArtifactManifest(result, outputRoot);
    const native = await disaNativeInventories(ROOT, manifest);
    verifyDisaSnapshot(result, native, new Set(JSON.parse(readFileSync(join(ROOT, 'data/ccis.json'))).records.map((row) => row.id)));
    const merged = mergeDisaSnapshot(previous, result, JSON.parse(readFileSync(join(ROOT, 'data/curated/reference-catalogs/publisher-inventories.json'))), native, manifest);
    result = merged.result;
    writeJsonAtomically(join(ROOT, DISA_EVIDENCE_DIRECTORY, 'native.json'), native);
    result.nativeVerifiedAt = new Date().toISOString();
    writeJsonAtomically(join(ROOT, 'data/curated/reference-catalogs/publisher-inventories.json'), merged.proofs);
    writeDisaCatalog(ROOT, 'stig', result.stig); writeDisaCatalog(ROOT, 'srg', result.srg);
  } else {
    writeJsonAtomically(join(outputRoot, 'data', 'stig-rules.json'), result.stig);
    writeJsonAtomically(join(outputRoot, 'data', 'srg-requirements.json'), result.srg);
  }
  writeJsonAtomically(join(outputRoot, 'maps', 'stig-srg-to-cci.json'), result.relationships, { space: 0 });
  if (!result.fallbackMode && requestedOutput) writeDisaArtifactManifest(result, outputRoot);
  if (!result.fallbackMode && !requestedOutput) {
    const path = join(ROOT, 'data/disa-artifact-manifest.json'); const manifest = readJson(path);
    manifest.native_acceptance = { scope: 'publisher_bytes_and_native_content', code_commit: result.publicInventory.receipt.code_commit, verified_at: result.nativeVerifiedAt,
      inventory_checksum: result.publicInventory.receipt.inventory_checksum, response_checksum: result.publicInventory.receipt.sha256,
      native_checksum: hashDisaFile(join(ROOT, DISA_EVIDENCE_DIRECTORY, 'native.json')).checksum,
      output_checksum: disaCanonicalHash(DISA_ACCEPTED_OUTPUT_PATHS.map((entry) => ({ path: entry, ...hashDisaFile(join(ROOT, entry)) }))),
      archives: [result.archiveEvidence, ...(result.standaloneSuccesses || []).map(({ source_url, checksum, byte_length, retrieval_timestamp, verified_at, acquisition }) =>
        ({ source_url, checksum, byte_length, retrieval_timestamp, verified_at, acquisition }))],
    };
    recordDisaNativeAcceptance(process.env.CONTROL_ATLAS_SOURCE_CHECK_RECEIPT, manifest);
    writeJsonAtomically(path, manifest); attestDisaProjections(ROOT, manifest);
  }
  if (result.fallbackMode) {
    console.log(`DISA fetch fallback: ${result.fallbackMode}`);
  }
  if (result.failed?.length) {
    console.log(`${result.failed.length} archive entr${result.failed.length === 1 ? 'y' : 'ies'} failed to parse: ${result.failed.map((f) => `${f.entryPath} (${f.reason})`).join(', ')}`);
  }
  if (result.failedPublications?.length) {
    console.log(`${result.failedPublications.length} standalone publication(s) failed: ${result.failedPublications.map((f) => `${f.filename} (${f.reason})`).join(', ')}`);
  }
  console.log(`Wrote ${result.stig.records.length} STIG rules, ${result.srg.records.length} SRG requirements, and ${result.relationships.relationships.length} DISA CCI references`);
  if (result.publications) {
    console.log(`Publication reconciliation: ${result.publications.expected_canonical_publications} expected (${result.publications.represented_in_compilation} compilation + ${result.publications.standalone_ingested} standalone, ${result.publications.failed_publications} failed, ${result.publications.missing_publications} missing)`);
  }
}

if (process.argv[1]?.includes('fetch-disa-stigs.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
