/** Editorial coordinates only. Neither position, distance nor area asserts authority. */
export const REGIONS = Object.freeze([
  { id: "governance", area: "atlas:LIMB-GOVERNANCE", label: "Governance", x: 6, y: 7, token: "governance" },
  { id: "risk", area: "atlas:LIMB-RISK", label: "Risk", x: 39, y: 7, token: "risk" },
  { id: "compliance", area: "atlas:LIMB-COMPLIANCE", label: "Controls & programs", x: 72, y: 7, token: "compliance" },
  { id: "architecture", area: "atlas:LIMB-ARCHITECTURE", label: "Architecture", x: 6, y: 39, token: "architecture" },
  { id: "implementation", area: "atlas:LIMB-IMPLEMENTATION", label: "Implementation", x: 39, y: 39, token: "implementation" },
  { id: "assessment", area: "atlas:LIMB-ASSESSMENT", label: "Assessment", x: 72, y: 39, token: "assessment" },
  { id: "operations", area: "atlas:LIMB-OPERATIONS", label: "Operations", x: 6, y: 71, token: "operations" },
  { id: "threat", area: "atlas:LIMB-THREAT", label: "Threats & defenses", x: 39, y: 71, token: "threats-defense" },
  { id: "knowledge", area: "atlas:LIMB-KNOWLEDGE", label: "Knowledge", x: 72, y: 71, token: "knowledge" },
]);
/** Stable slots within each publication region; filtering never repacks them. */
export const LANDMARK_ORDER = Object.freeze([
  "nist-800-37", "fips-200", "dod-rai", "fips-199", "nist-800-53", "nist-800-53b", "nist-800-171", "nist-800-171-rev2", "nist-800-172", "csf-2", "cmmc-2", "fedramp-2026", "fedramp-rev5", "cui-policy", "nist-ai-rmf", "nist-ssdf", "nist-zt", "dod-zt", "nist-iot-cybersecurity", "disa-stig", "disa-srg", "disa-cci", "nist-800-53a", "microsoft-zt-maturity", "mitre-attack", "mitre-attack-ics", "mitre-d3fend", "nist-mobile-threats",
]);
export function publicationPosition(publication, region, allPublications) {
  const group = allPublications.filter((entry) => entry.region === region).sort((a, b) => {
    const aRank = LANDMARK_ORDER.indexOf(a.id), bRank = LANDMARK_ORDER.indexOf(b.id);
    return (aRank < 0 ? 999 : aRank) - (bRank < 0 ? 999 : bRank) || a.id.localeCompare(b.id);
  });
  const slot = group.findIndex((entry) => entry.id === publication);
  return { column: slot % 2, row: Math.floor(slot / 2), slot };
}
