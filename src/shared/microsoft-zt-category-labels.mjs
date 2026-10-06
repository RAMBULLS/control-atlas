/**
 * Microsoft's Zero Trust Maturity Questionnaire workbook tags some questions
 * with a "Category" column authored in French. The category is a short,
 * unambiguous IT/security term (not guidance prose), so it is translated for
 * display rather than shown untranslated. The French value is standard
 * cybersecurity vocabulary; nothing here adds meaning the publisher did not
 * put in the column.
 *
 * A test requires every distinct category value in the corpus to have an
 * entry here, so a data refresh that introduces a new value fails loudly
 * instead of leaking untranslated French onto the page.
 */
export const MICROSOFT_ZT_CATEGORY_TRANSLATIONS = Object.freeze({
  "App PaaS: Dev sécurisé": "App PaaS: Secure development",
  "Applications legacy": "Legacy applications",
  "Applications SaaS": "SaaS applications",
  "Applications SaaS/Protection menaces": "SaaS applications / Threat protection",
  "Chiffrement": "Encryption",
  "Classification": "Classification",
  "DLP": "DLP",
  "SSO et accès conditionnel": "SSO and conditional access",
});

export function translateMicrosoftZtCategory(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  return MICROSOFT_ZT_CATEGORY_TRANSLATIONS[raw] || raw;
}
