export const PUBLISHER_UNIT_PROOF_PATH = 'data/curated/reference-catalogs/publisher-inventories.json';

export function resolvePublisherUnitProof(catalogId, manifest) {
  const proof = manifest?.catalogs?.[catalogId]; if (!proof) return null;
  if (typeof proof.scope !== 'string' || !proof.scope.trim() || !Number.isSafeInteger(proof.record_count) || proof.record_count < 1 ||
      !Array.isArray(proof.record_ids) || proof.record_ids.length !== proof.record_count || new Set(proof.record_ids).size !== proof.record_count ||
      proof.record_ids.some((id) => typeof id !== 'string' || !id) || !Array.isArray(proof.native_units) ||
      !Array.isArray(proof.source_evidence) || !proof.source_evidence.length) throw new Error(`Invalid independent publisher-unit proof: ${catalogId}`);
  const nativeIds = [...new Set(proof.native_units.map((unit) => unit.id))].sort();
  if (JSON.stringify(nativeIds) !== JSON.stringify([...proof.record_ids].sort())) throw new Error(`Native source units disagree with inventory identities: ${catalogId}`);
  if (proof.current_snapshot) {
    const current = proof.current_snapshot;
    if (!Array.isArray(current.record_ids) || current.record_ids.length !== current.record_count || new Set(current.record_ids).size !== current.record_count || current.record_ids.some((id) => !nativeIds.includes(id)) || !proof.source_evidence.some((source) => source.url === current.compilation_url && source.sha256 === current.checksum)) throw new Error(`Current/retained inventory boundary is invalid: ${catalogId}`);
  }
  for (const source of proof.source_evidence) {
    if (!/^https:\/\//.test(source.url || '') || !/^sha256:[a-f0-9]{64}$/.test(source.sha256 || '') || !Number.isSafeInteger(source.byte_length) || source.byte_length < 1 ||
      !['downloaded_publisher_bytes', 'complete_retained_publisher_page_capture'].includes(source.evidence_kind)) throw new Error(`Invalid publisher byte/capture evidence: ${catalogId}`);
    if (source.evidence_kind === 'complete_retained_publisher_page_capture' && !source.binary_reverification?.startsWith('UNKNOWN:')) throw new Error(`Historical capture must expose its binary reverification limit: ${catalogId}`);
  }
  return { expected_count: proof.record_count, excluded_count: 0, record_ids: proof.record_ids,
    evidence_class: proof.evidence_class || 'publisher_inventory', ...(proof.primary_extraction_status ? { primary_extraction_status: proof.primary_extraction_status } : {}),
    scope: proof.scope, source_evidence_kinds: [...new Set(proof.source_evidence.map((entry) => entry.evidence_kind))],
    evidence_locator: `${PUBLISHER_UNIT_PROOF_PATH}#catalogs.${catalogId}.record_count` };
}
