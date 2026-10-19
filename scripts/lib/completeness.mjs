// Completeness-gate classification (spec §1). Pure, dependency-free logic so
// it can be unit-tested in isolation from verify-manifests.mjs (which performs
// file IO and process.exit). verify-manifests.mjs imports these helpers.
//
// Completeness states:
//   reconciled  — an authoritative expected inventory was established (an
//                 integer resolved from an INDEPENDENT evidence locator), every
//                 exclusion carries a reason, all contributing artifacts are
//                 provenance-attested with real checksums, and
//                 expected === imported + excluded + missing with missing === 0.
//   partial     — expected inventory known, records still missing (missing > 0).
//   discovered  — records present, but no authoritative expected inventory yet.
//   unknown     — no records and no expectation.
//   quarantined — the primary evidence is quarantined (unverifiable, reasoned).

export const COMPLETENESS_STATES = ['reconciled', 'partial', 'discovered', 'unknown', 'quarantined'];

export function summarizeCompleteness(catalogs) {
  const states = Object.fromEntries(
    COMPLETENESS_STATES.map((state) => [
      state,
      catalogs.filter((catalog) => catalog.completeness_status === state).length,
    ]),
  );
  return {
    status: catalogs.length > 0 && catalogs.every((catalog) => catalog.completeness_status === 'reconciled')
      ? 'COMPLETE'
      : 'INCOMPLETE',
    states,
  };
}

// Resolve an authoritative expected count from an evidence locator of the form
// "relative/path.json#dotted.path.to.integer". `readJson` reads a repo-relative
// JSON file (or returns null). Returns an integer or null.
export function resolveExpectedLocator(locator, readJson) {
  if (typeof locator !== 'string' || !locator.includes('#')) return null;
  const [rel, path] = locator.split('#');
  const doc = readJson(rel.trim());
  if (!doc) return null;
  let node = doc;
  const parts = path.trim().split('.');
  while (parts.length) {
    if (!node || typeof node !== 'object') return null;
    let consumed = parts.length;
    while (consumed && !(parts.slice(0, consumed).join('.') in node)) consumed -= 1;
    if (!consumed) return null;
    node = node[parts.splice(0, consumed).join('.')];
  }
  return Number.isInteger(node) ? node : null;
}

// Pure per-catalog classification. `expected` is an integer or null.
// Returns { status, missing, errors[] } where errors are machine-readable codes
// the caller maps to human messages and pushes into the gate's error list.
export function classifyCatalog({ expected, imported, excluded, allChecksumsReal, primaryQuarantined, independentInventory = true }) {
  const errors = [];
  const hasExpected = Number.isInteger(expected);
  const missing = hasExpected ? expected - imported - excluded : null;

  let status;
  if (primaryQuarantined && imported === 0) {
    status = 'quarantined';
  } else if (!independentInventory) {
    if (hasExpected && expected !== imported + excluded) errors.push('regression-inventory-mismatch');
    return { status: imported > 0 ? 'discovered' : 'unknown', missing: null, errors };
  } else if (!hasExpected) {
    status = imported > 0 ? 'discovered' : 'unknown';
  } else if (missing < 0) {
    errors.push('inventory-over-count');
    status = 'partial';
  } else if (missing === 0 && allChecksumsReal) {
    status = 'reconciled';
  } else {
    status = 'partial';
  }

  // A `reconciled` label must be mathematically real (spec §1/§10).
  if (status === 'reconciled'
    && (!hasExpected || missing !== 0 || expected !== imported + excluded + missing)) {
    errors.push('reconciled-with-mismatched-inventory');
  }
  return { status, missing, errors };
}
