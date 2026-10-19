const profile = (catalogId, label, paths, options = {}) => Object.freeze({
  catalogId,
  label,
  paths: Object.freeze(paths.map((path) => Object.freeze([...path]))),
  multiParentNodeTypes: Object.freeze([...(options.multiParentNodeTypes || [])]),
});

/**
 * Publisher-native containment contracts. These paths describe ownership only;
 * mappings, baselines, assessment targets, and other cross-publication links
 * belong to the relationship layer and must never appear here.
 */
export const CATALOG_STRUCTURE_PROFILES = Object.freeze({
  "nist-csf-1.1": profile("nist-csf-1.1", "NIST CSF 1.1", [["catalog", "function", "category", "requirement"]]),
  "nist-critical-software": profile("nist-critical-software", "NIST Critical Software Security Measures", [["catalog", "group", "requirement"]]),
  "cmmc-2": profile("cmmc-2", "CMMC 2.0", [["catalog", "program"]]),
  "csf-2": profile("csf-2", "NIST CSF 2.0", [["catalog", "function", "category", "requirement"]]),
  "cui-policy": profile("cui-policy", "CUI Program", [
    ["catalog", "policy"],
    ["catalog", "policy", "policy"],
  ]),
  "disa-cci": profile("disa-cci", "DISA CCI", [["catalog", "requirement"]]),
  "disa-srg": profile("disa-srg", "DISA SRG", [["catalog", "benchmark", "srg_requirement"]]),
  "disa-stig": profile("disa-stig", "DISA STIG", [["catalog", "benchmark", "stig_rule"]]),
  "dod-rai": profile("dod-rai", "DoD AI Assurance", [["catalog", "group", "requirement"]]),
  "dod-zt": profile("dod-zt", "DoD Zero Trust", [
    ["catalog", "zt_pillar", "zt_capability", "zt_activity"],
    ["catalog", "zt_tenet"],
    ["catalog", "zt_document"],
    ["catalog", "requirement"],
  ]),
  "nist-zt": profile("nist-zt", "NIST Zero Trust", [
    ["catalog", "zt_publication", "zt_tenet"],
    ["catalog", "zt_publication", "zt_logical_component"],
    ["catalog", "zt_publication", "zt_cloud_native_requirement"],
    ["catalog", "zt_publication", "zt_build"],
    ["catalog", "zt_publication", "zt_reference_component"],
    ["catalog", "zt_publication", "zt_mapping_document"],
    ["catalog", "zt_publication", "zt_collaborator"],
    ["catalog", "zt_publication", "zt_mapping_contributor", "zt_product_component"],
  ]),
  "microsoft-zt-maturity": profile("microsoft-zt-maturity", "Microsoft Zero Trust Maturity Questionnaire", [
    ["catalog", "zt_pillar", "zt_assessment_question"],
  ]),
  "nist-iot-cybersecurity": profile("nist-iot-cybersecurity", "NIST IoT Device Cybersecurity", [
    ["catalog", "iot_capability_domain", "iot_capability", "iot_subcapability", "iot_capability_element"],
    ["catalog", "iot_capability_domain", "iot_capability", "iot_subcapability", "iot_capability_element", "iot_capability_subelement"],
  ]),
  "nist-mobile-threats": profile("nist-mobile-threats", "NIST Mobile Threat Catalogue", [
    ["catalog", "mobile_threat_category", "mobile_threat"],
  ]),
  "fedramp-rev5": profile("fedramp-rev5", "FedRAMP Rev. 5", [["catalog", "baseline"]]),
  "fedramp-2026": profile("fedramp-2026", "FedRAMP Consolidated Rules for 2026", [
    ["catalog", "control_context"],
    ["catalog", "definition"],
    ["catalog", "rule"],
    ["catalog", "key_security_indicator"],
  ]),
  "fips-199": profile("fips-199", "FIPS 199", [["catalog", "impact_category"]]),
  "fips-200": profile("fips-200", "FIPS 200", [["catalog", "requirement"]]),
  "mitre-attack": profile("mitre-attack", "MITRE ATT&CK Enterprise", [
    ["catalog", "tactic", "attack_technique"],
    ["catalog", "tactic", "attack_technique", "attack_technique"],
  ], { multiParentNodeTypes: ["attack_technique"] }),
  "mitre-attack-ics": profile("mitre-attack-ics", "MITRE ATT&CK for ICS", [
    ["catalog", "tactic", "attack_technique"],
    ["catalog", "tactic", "attack_technique", "attack_technique"],
  ], { multiParentNodeTypes: ["attack_technique"] }),
  "mitre-d3fend": profile("mitre-d3fend", "MITRE D3FEND", [["catalog", "tactic", "defend_countermeasure"]]),
  "nist-800-171": profile("nist-800-171", "NIST SP 800-171 Rev. 3", [["catalog", "family", "requirement"]]),
  "nist-800-171-rev2": profile("nist-800-171-rev2", "NIST SP 800-171 Rev. 2", [["catalog", "family", "requirement"]]),
  "nist-800-172": profile("nist-800-172", "NIST SP 800-172", [["catalog", "family", "requirement"]]),
  "nist-800-37": profile("nist-800-37", "NIST SP 800-37", [["catalog", "rmf_step"]]),
  "nist-800-53": profile("nist-800-53", "NIST SP 800-53 Rev. 5", [
    ["catalog", "family", "control"],
    ["catalog", "family", "control", "control_enhancement"],
  ]),
  "nist-800-53a": profile("nist-800-53a", "NIST SP 800-53A", [["catalog", "family", "assessment_procedure"]]),
  "nist-800-53b": profile("nist-800-53b", "NIST SP 800-53B", [["catalog", "baseline"]]),
  "nist-ai-rmf": profile("nist-ai-rmf", "NIST AI RMF", [["catalog", "group", "requirement"]]),
  "nist-ssdf": profile("nist-ssdf", "NIST SSDF", [["catalog", "group", "requirement"]]),
});

export const CATALOG_STRUCTURE_IDS = Object.freeze(Object.keys(CATALOG_STRUCTURE_PROFILES));

export function catalogStructureProfile(catalogId) {
  return CATALOG_STRUCTURE_PROFILES[catalogId] || null;
}

export function structurePathIsAllowed(catalogId, nodeTypes) {
  const declared = catalogStructureProfile(catalogId)?.paths || [];
  return declared.some((path) =>
    nodeTypes.length <= path.length && nodeTypes.every((nodeType, index) => nodeType === path[index]),
  );
}
