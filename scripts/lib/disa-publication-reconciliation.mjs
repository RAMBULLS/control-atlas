// scripts/lib/disa-publication-reconciliation.mjs
// Pure module for DISA STIG/SRG publication-level discovery, classification,
// version comparison, inventory reconciliation, and record deduplication.

export const EXCLUSION_REASONS = Object.freeze({
  HISTORICAL_COMPILATION: 'historical_compilation_archive',
  AUTOMATION_CONTENT: 'automation_content',
  SCAP_BENCHMARK: 'scap_benchmark',
  TOOLING_OR_SPEC: 'tooling_or_specification',
  SUPPLEMENTAL_POLICY_DOC: 'supplemental_policy_or_doc',
  SUNSET_COMPILATION: 'sunset_compilation',
  DRAFT_PUBLICATION: 'draft_publication',
  RESTRICTED_CUI: 'restricted_cui_content',
  SUPERSEDED_RELEASE: 'superseded_by_newer_release',
  NON_ZIP_RESOURCE: 'non_zip_resource',
  UNRECOGNIZED_PACKAGE: 'unrecognized_package_pattern',
});

/**
 * Classify a zip filename from the DISA directory listing into its publication class.
 *
 * @param {string} filename
 * @returns {{ category: string, reason?: string, isCandidate: boolean }}
 */
export function classifyDisaZip(filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.zip')) {
    return { category: 'ignored', reason: EXCLUSION_REASONS.NON_ZIP_RESOURCE, isCandidate: false };
  }

  if (/Library/i.test(filename)) {
    return { category: 'compilation', reason: EXCLUSION_REASONS.HISTORICAL_COMPILATION, isCandidate: false };
  }
  if (/Ansible|Chef|PowerShell_DSC|cinc_cac/i.test(filename)) {
    return { category: 'automation', reason: EXCLUSION_REASONS.AUTOMATION_CONTENT, isCandidate: false };
  }
  if (/SCAP/i.test(filename)) {
    return { category: 'scap', reason: EXCLUSION_REASONS.SCAP_BENCHMARK, isCandidate: false };
  }
  if (/Automated%20Benchmarks|Automated-Benchmarks/i.test(filename)) {
    return { category: 'scap', reason: EXCLUSION_REASONS.SCAP_BENCHMARK, isCandidate: false };
  }
  if (/CKLB|JSON_SCHEMA|Remote_Scanning|RPM-GPG|OneDrive|CCI_List|STIGViewer|scc-|SCC_/i.test(filename)) {
    return { category: 'tooling', reason: EXCLUSION_REASONS.TOOLING_OR_SPEC, isCandidate: false };
  }
  if (/GPO_Package|Intune_Policy|Overview\.zip$/i.test(filename)) {
    return { category: 'supplemental', reason: EXCLUSION_REASONS.SUPPLEMENTAL_POLICY_DOC, isCandidate: false };
  }
  if (/Sunset/i.test(filename)) {
    return { category: 'sunset', reason: EXCLUSION_REASONS.SUNSET_COMPILATION, isCandidate: false };
  }
  if (/Draft/i.test(filename)) {
    return { category: 'draft', reason: EXCLUSION_REASONS.DRAFT_PUBLICATION, isCandidate: false };
  }
  if (/CUI/i.test(filename)) {
    return { category: 'cui', reason: EXCLUSION_REASONS.RESTRICTED_CUI, isCandidate: false };
  }

  return { category: 'candidate', isCandidate: true };
}

/**
 * Parse a candidate package filename into structured metadata.
 *
 * @param {string} filename
 * @returns {null | {
 *   filename: string,
 *   family: string,
 *   versionType: 'VR' | 'YM' | 'SPECIAL',
 *   versionMajor?: number,
 *   release?: number,
 *   year?: number,
 *   month?: number,
 *   versionStr: string,
 *   kind: 'stig' | 'srg',
 *   suffix?: string
 * }}
 */
export function parseCandidateFilename(filename) {
  const classification = classifyDisaZip(filename);
  if (!classification.isCandidate) return null;

  const vrMatch = filename.match(/^U_(.+)_V(\d+)R(\d+)(?:_([A-Za-z0-9-_]+))?\.zip$/i);
  if (vrMatch) {
    const rawFamily = vrMatch[1];
    const versionMajor = parseInt(vrMatch[2], 10);
    const release = parseInt(vrMatch[3], 10);
    const suffix = vrMatch[4] || '';
    let kind = 'stig';
    if (/SRG/i.test(suffix) || /SRG/i.test(rawFamily) || /SRR/i.test(suffix) || /SRR/i.test(rawFamily)) {
      kind = 'srg';
    }
    return {
      filename,
      family: rawFamily,
      versionType: 'VR',
      versionMajor,
      release,
      versionStr: `V${versionMajor}R${release}`,
      kind,
      suffix,
    };
  }

  const ymMatch = filename.match(/^U_(.+)_Y(\d+)M(\d+)(?:_([A-Za-z0-9-_]+))?\.zip$/i);
  if (ymMatch) {
    const rawFamily = ymMatch[1];
    const year = parseInt(ymMatch[2], 10);
    const month = parseInt(ymMatch[3], 10);
    const suffix = ymMatch[4] || '';
    let kind = 'stig';
    if (/SRG/i.test(suffix) || /SRG/i.test(rawFamily) || /SRR/i.test(suffix) || /SRR/i.test(rawFamily)) {
      kind = 'srg';
    }
    return {
      filename,
      family: rawFamily,
      versionType: 'YM',
      year,
      month,
      versionStr: `Y${year}M${month < 10 ? `0${month}` : month}`,
      kind,
      suffix,
    };
  }

  if (filename === 'U_Ivanti_MI_Sentry_9-x_STIG.zip') {
    return {
      filename,
      family: 'Ivanti_MI_Sentry_9-x',
      versionType: 'SPECIAL',
      versionMajor: 1,
      release: 0,
      versionStr: 'V1R0',
      kind: 'stig',
      suffix: '',
    };
  }

  return null;
}

/**
 * Compare two candidate versions in the same family.
 * Returns positive if a is newer than b, negative if older, 0 if equal.
 */
export function compareDisaVersions(a, b) {
  if (a.versionType === 'VR' && b.versionType === 'VR') {
    return (a.versionMajor - b.versionMajor) || (a.release - b.release);
  }
  if (a.versionType === 'YM' && b.versionType === 'YM') {
    return (a.year - b.year) || (a.month - b.month);
  }
  return a.versionStr.localeCompare(b.versionStr);
}

/**
 * Group all filenames found on the DISA server and select the current canonical package per family.
 * Older packages of the same family are categorized as superseded.
 */
export function groupAndSelectCurrentPublications(allFilenames) {
  const candidates = [];
  const excludedByRule = [];

  for (const filename of allFilenames) {
    const classification = classifyDisaZip(filename);
    if (!classification.isCandidate) {
      excludedByRule.push({ filename, reason: classification.reason });
      continue;
    }
    const parsed = parseCandidateFilename(filename);
    if (!parsed) {
      excludedByRule.push({ filename, reason: EXCLUSION_REASONS.UNRECOGNIZED_PACKAGE });
      continue;
    }
    candidates.push(parsed);
  }

  // Group by family + kind
  const families = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.family}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(candidate);
  }

  const currentPublications = [];
  const supersededPublications = [];

  for (const [key, items] of families) {
    // Sort newest first
    items.sort((a, b) => compareDisaVersions(b, a));
    const current = items[0];
    currentPublications.push(current);

    for (let i = 1; i < items.length; i += 1) {
      supersededPublications.push({
        filename: items[i].filename,
        family: items[i].family,
        kind: items[i].kind,
        versionStr: items[i].versionStr,
        reason: EXCLUSION_REASONS.SUPERSEDED_RELEASE,
        supersededBy: current.filename,
      });
    }
  }

  // Sort deterministically by filename
  currentPublications.sort((a, b) => a.filename.localeCompare(b.filename));
  supersededPublications.sort((a, b) => a.filename.localeCompare(b.filename));
  excludedByRule.sort((a, b) => a.filename.localeCompare(b.filename));

  return {
    currentPublications,
    supersededPublications,
    excludedByRule,
    totalDiscovered: allFilenames.length,
  };
}

/**
 * Reconcile current canonical publications against the compilation inventory.
 * Determines which publications are already covered by the compilation and which
 * must be fetched as standalone packages.
 *
 * @param {Array} currentPublications
 * @param {Set<string>} compilationInnerZips
 */
export function reconcilePublicationInventory(currentPublications, compilationInnerZips) {
  const representedInCompilation = [];
  const standaloneNeeded = [];

  for (const pub of currentPublications) {
    if (compilationInnerZips.has(pub.filename)) {
      representedInCompilation.push({
        filename: pub.filename,
        family: pub.family,
        kind: pub.kind,
        versionStr: pub.versionStr,
        status: 'represented_in_compilation',
      });
    } else {
      standaloneNeeded.push({
        filename: pub.filename,
        family: pub.family,
        kind: pub.kind,
        versionStr: pub.versionStr,
        status: 'standalone_needed',
      });
    }
  }

  return {
    expectedCount: currentPublications.length,
    representedInCompilation,
    standaloneNeeded,
  };
}

/**
 * Deduplicate records deterministically by native record key.
 * If the same rule/requirement appears from multiple packages,
 * keep the latest version.
 *
 * @param {Array} records
 * @returns {Array} deduplicated records
 */
export function dedupeDisaRecords(records) {
  const seen = new Map();

  for (const record of records) {
    const key = `${record.type}:${record.id}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, record);
      continue;
    }

    // If existing has a version and new has a version, compare
    const vNew = record.source?.version || '';
    const vOld = existing.source?.version || '';
    if (vNew.localeCompare(vOld, undefined, { numeric: true }) > 0) {
      seen.set(key, record);
    }
  }

  return [...seen.values()].sort((a, b) => {
    const benchA = a.metadata?.benchmark_id || '';
    const benchB = b.metadata?.benchmark_id || '';
    return benchA.localeCompare(benchB) || a.id.localeCompare(b.id);
  });
}

/** One native connection per pair, with every distinct publisher citation retained. */
export function dedupeDisaRelationships(relationships) {
  const unique = new Map();
  for (const relationship of relationships) {
    const key = JSON.stringify([relationship.source_catalog, relationship.source_id, relationship.target_catalog, relationship.target_id, relationship.relationship_type]);
    let entry = unique.get(key);
    if (!entry) { entry = { ...relationship, source_citations: [] }; unique.set(key, entry); }
    const native = { source_locator: relationship.source_locator, source_url: relationship.source_url || '', source_version: relationship.source_version || '',
      checksum: relationship.source_checksum || '', native_rule_id: relationship.native_rule_id || '', benchmark_id: relationship.benchmark_id || '' };
    if (!entry.source_citations.some((citation) => Object.keys(native).every((field) => citation[field] === native[field]))) entry.source_citations.push(native);
  }
  return [...unique.values()].map((entry) => {
    const base = { ...entry }; for (const field of ['source_url', 'source_version', 'source_checksum', 'native_rule_id', 'benchmark_id']) delete base[field];
    const citations = entry.source_citations.map((citation, index) => ({ ...citation, locator: index === 0 ? entry.source_locator : `${citation.source_url} | ${citation.source_locator}` }));
    return { ...base, source_locators: citations.map((citation) => citation.locator), source_citations: citations };
  });
}

/** Keep prior native editions and IDs; absence from a new snapshot never implies retirement. */
const ABSENT_RECORD_WARNING = 'Absent from the latest selected publisher snapshot; retained from its verified prior edition. Current applicability/lifecycle is UNKNOWN; no retirement is inferred.';
const ABSENT_CONNECTION_WARNING = 'Recorded in a verified prior publisher edition and retained; absent from the latest selected snapshot. No current applicability is inferred.';

export function preserveDisaRecordHistory(previous, current) {
  const captureKey = (record) => {
    const copy = { ...record, ...(record.source ? { source: { ...record.source } } : {}), ...(record.metadata ? { metadata: { ...record.metadata } } : {}) };
    if (copy.source) delete copy.source.snapshot_date;
    if (copy.metadata) {
      delete copy.metadata.previous_editions; delete copy.metadata.current_snapshot_presence;
      if (copy.metadata.source_warnings) {
        copy.metadata.source_warnings = copy.metadata.source_warnings.filter((warning) => warning !== ABSENT_RECORD_WARNING);
        if (!copy.metadata.source_warnings.length) delete copy.metadata.source_warnings;
      }
    }
    const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
    return JSON.stringify(ordered(copy));
  };
  const old = new Map(previous.map((record) => [record.id, record])); const next = new Map();
  for (const record of current) {
    if (next.has(record.id)) throw new Error(`Duplicate current DISA ID: ${record.id}`);
    const copy = structuredClone(record); const prior = old.get(record.id);
    if (copy.metadata?.source_warnings) copy.metadata.source_warnings = copy.metadata.source_warnings.filter((warning) => warning !== ABSENT_RECORD_WARNING);
    const history = [...new Map([...(prior?.metadata?.previous_editions || []), ...(record.metadata?.previous_editions || [])].map((entry) => [captureKey(entry), entry])).values()];
    if (prior && captureKey(prior) !== captureKey(record)) {
      const historical = structuredClone(prior); if (historical.metadata) delete historical.metadata.previous_editions;
      if (!history.some((entry) => captureKey(entry) === captureKey(historical))) history.push(historical);
    }
    copy.metadata = { ...copy.metadata, current_snapshot_presence: true, ...(history.length ? { previous_editions: history } : {}) };
    next.set(copy.id, copy);
  }
  for (const record of previous) if (!next.has(record.id)) {
    const copy = structuredClone(record); const warning = ABSENT_RECORD_WARNING;
    copy.metadata = { ...copy.metadata, current_snapshot_presence: false, source_warnings: [...new Set([...(copy.metadata?.source_warnings || []), warning])] };
    next.set(copy.id, copy);
  }
  return [...next.values()].sort((a,b) => a.id.localeCompare(b.id));
}

/** Stable legacy connection IDs survive inserted/new/withdrawn publisher rows. */
export function preserveDisaConnectionIds(previous, current, stem = 'stig-srg-to-cci') {
  const key = (row) => JSON.stringify([row.source_catalog,row.source_id,row.target_catalog,row.target_id,row.relationship_type]);
  const existing = new Map(); const used = new Set(); let maximum = previous.length;
  previous.forEach((row,index) => {
    const id = row.atlas_connection_id || `edge:${stem}:${index+1}`;
    if (!id.startsWith('edge:') || used.has(id) || existing.has(key(row))) throw new Error('Duplicate/invalid previous connection identity');
    maximum = Math.max(maximum, Number(id.match(/:(\d+)$/)?.[1]) || 0); used.add(id); existing.set(key(row),id);
  });
  const currentKeys = new Set(current.map(key));
  const seeds = [];
  for (const row of [...previous,...current]) for (const citation of row.source_citations?.length ? row.source_citations : [{ source_locator:row.source_locator }]) {
    seeds.push({ ...row, source_locator:citation.source_locator || citation.locator || row.source_locator, source_url:citation.source_url,
      source_version:citation.source_version, source_checksum:citation.checksum, native_rule_id:citation.native_rule_id, benchmark_id:citation.benchmark_id });
  }
  const merged = dedupeDisaRelationships(seeds).sort((a,b) => key(a).localeCompare(key(b)));
  for (const row of merged) {
    let id = existing.get(key(row)); if (!id) { do { id = `edge:${stem}:${++maximum}`; } while (used.has(id)); used.add(id); }
    row.atlas_connection_id = id; row.current_snapshot_presence = currentKeys.has(key(row));
    if (row.current_snapshot_presence && row.warning === ABSENT_CONNECTION_WARNING) delete row.warning;
    if (!row.current_snapshot_presence && !row.warning) row.warning = ABSENT_CONNECTION_WARNING;
  }
  return merged;
}
