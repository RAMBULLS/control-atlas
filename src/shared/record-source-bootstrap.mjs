/** Read the complete register only when it matches every admitted source id. */
export function recordBootstrapSources(bootstrap, sourceId = '') {
  if (bootstrap.record_bootstrap !== undefined && bootstrap.record_bootstrap !== 'catalog-bootstrap-record.json') {
    throw new Error('Record bootstrap source register capability is invalid.');
  }
  if (bootstrap.sources === undefined) {
    if (bootstrap.record_bootstrap) throw new Error('Record bootstrap source register is incomplete.');
    return null;
  }
  if (!Array.isArray(bootstrap.sources) || !bootstrap.source_records || typeof bootstrap.source_records !== 'object') {
    throw new Error('Record bootstrap source register is invalid.');
  }
  const admitted = new Set(Object.keys(bootstrap.source_records));
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
