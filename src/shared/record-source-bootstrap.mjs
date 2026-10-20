/** Read the complete register only when it matches every admitted source id. */
export function recordBootstrapSources(bootstrap, sourceId = '') {
  if (bootstrap.record_bootstrap !== undefined && bootstrap.record_bootstrap !== 'catalog-bootstrap-record.json') {
    throw new Error('Record bootstrap source register capability is invalid.');
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
