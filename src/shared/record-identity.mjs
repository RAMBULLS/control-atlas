export function benchmarkIdentityCategory(benchmarkTitle = "", benchmarkId = "") {
  const title = String(benchmarkTitle).trim();
  const parenthetical = title.match(/\(([A-Z][A-Z0-9&/-]{1,12})\)/);
  if (parenthetical) return parenthetical[1];
  const leadingAcronym = title.match(/^([A-Z][A-Z0-9&/-]{1,12})(?:\s|$)/);
  if (leadingAcronym) return leadingAcronym[1];
  const conciseTitle = title
    .replace(/\s+Security Technical Implementation Guide$/i, "")
    .replace(/\s+Security Requirements Guide$/i, "")
    .trim();
  if (conciseTitle) return conciseTitle;
  return String(benchmarkId)
    .replace(/_(?:STIG|SRG)$/i, "")
    .replaceAll("_", " ")
    .trim();
}

// ATT&CK techniques belong to every tactic MITRE lists for them - 195 of 874
// carry more than one - and `family` is only the first of that list. Putting it
// in the record identity states a classification the publisher did not make:
// T1078 would read "MITRE Stealth T1078" while MITRE names it "Valid Accounts"
// and files it under four tactics. The identity stays publisher + official ID,
// and the full tactic membership is a published fact on the record instead.
const MULTI_TACTIC_CATALOGS = ["mitre-attack", "mitre-attack-ics"];

export function sourceNativeIdentityCategory({ catalogId = "", family = "", benchmarkTitle = "", benchmarkId = "" } = {}) {
  if (MULTI_TACTIC_CATALOGS.includes(catalogId)) return "";
  return ["disa-stig", "disa-srg"].includes(catalogId)
    ? benchmarkIdentityCategory(benchmarkTitle, benchmarkId) || family
    : family;
}
