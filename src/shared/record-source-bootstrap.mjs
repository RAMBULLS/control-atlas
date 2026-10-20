/** Read the complete register only when it matches every admitted source id. */
export function recordBootstrapSources(bootstrap, sourceId = '', neighborhood) {
  if (bootstrap.record_bootstrap !== undefined && bootstrap.record_bootstrap !== 'catalog-bootstrap-record.json') {
    throw new Error('Record bootstrap source register capability is invalid.');
  }
  if (bootstrap.record_source_delivery !== undefined && bootstrap.record_source_delivery !== 'neighborhood-v1') {
    throw new Error('Record bootstrap source register capability is invalid.');
  }
  if (bootstrap.record_source_delivery === 'neighborhood-v1') {
    if (bootstrap.record_bootstrap !== 'catalog-bootstrap-record.json' || bootstrap.sources !== undefined || bootstrap.source_records !== undefined) {
      throw new Error('Record bootstrap source register capability is invalid.');
    }
    const globalIds = bootstrap.source_ids;
    if (!Array.isArray(globalIds) || globalIds.some(id => typeof id !== 'string' || !id) || new Set(globalIds).size !== globalIds.length) {
      throw new Error('Record bootstrap source register index is invalid.');
    }
    const declared = neighborhood?.source_ids;
    const required = neighborhood?.expected_source_ids;
    if (!Array.isArray(declared) || !Array.isArray(required) || !Array.isArray(neighborhood?.sources)) {
      throw new Error('Record bootstrap source register is incomplete.');
    }
    const admitted = new Set(globalIds);
    const expected = new Set(required);
    if (expected.size !== required.length || declared.length !== expected.size ||
        declared.some(id => typeof id !== 'string' || !admitted.has(id) || !expected.has(id)) ||
        new Set(declared).size !== declared.length) {
      throw new Error('Record bootstrap source register scope is incomplete.');
    }
    // Reuse the exact identity/completeness checks for every full source object.
    return recordBootstrapSources({ source_ids: declared, sources: neighborhood.sources }, sourceId);
  }
  if (bootstrap.sources === undefined) {
    if (bootstrap.record_bootstrap) throw new Error('Record bootstrap source register is incomplete.');
    return null;
  }
  const ids = bootstrap.source_ids ?? (bootstrap.source_records && Object.keys(bootstrap.source_records));
  if (!Array.isArray(bootstrap.sources) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    throw new Error('Record bootstrap source register is invalid.');
  }
  const admitted = new Set(ids);
  if (admitted.size !== ids.length) throw new Error('Record bootstrap source register index is duplicated.');
  const seen = new Set();
  for (const source of bootstrap.sources) {
    if (!source || typeof source.id !== 'string' || !admitted.has(source.id) || seen.has(source.id)) {
      throw new Error('Record bootstrap source register identity does not match.');
    }
    seen.add(source.id);
  }
  if (seen.size !== admitted.size || (sourceId && !seen.has(sourceId))) {
    throw new Error('Record bootstrap source register is incomplete.');
  }
  return bootstrap.sources;
}
