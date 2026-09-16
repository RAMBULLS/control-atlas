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
