import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  MICROSOFT_ZT_CATEGORY_TRANSLATIONS,
  translateMicrosoftZtCategory,
} from "../src/shared/microsoft-zt-category-labels.mjs";

test("translates the known French category tags to plain English", () => {
  assert.equal(translateMicrosoftZtCategory("SSO et accès conditionnel"), "SSO and conditional access");
  assert.equal(translateMicrosoftZtCategory("Chiffrement"), "Encryption");
  assert.equal(translateMicrosoftZtCategory("DLP"), "DLP");
  assert.equal(translateMicrosoftZtCategory(""), "");
  assert.equal(translateMicrosoftZtCategory(null), "");
});

test("every category value in the corpus has a translation entry", () => {
  const dir = join("data", "generated", "graph-data", "nodes");
  const seen = new Set();
  for (const file of readdirSync(dir)) {
    for (const node of JSON.parse(readFileSync(join(dir, file), "utf8")).nodes) {
      if (node.metadata?.catalog_id === "microsoft-zt-maturity" && node.metadata?.category) {
        seen.add(node.metadata.category);
      }
    }
  }
  assert.ok(seen.size > 0, "the corpus should carry at least one category value to check");
  const untranslated = [...seen].filter((value) => !(value in MICROSOFT_ZT_CATEGORY_TRANSLATIONS));
  assert.deepEqual(untranslated, [], `add a translation for: ${untranslated.join(", ")}`);
});

test("no translated value still contains French diacritics or partial-French tokens", () => {
  for (const english of Object.values(MICROSOFT_ZT_CATEGORY_TRANSLATIONS)) {
    assert.ok(!/[àâçéèêëîïôûùüÿœæ]/i.test(english), `"${english}" still reads as French`);
  }
});
