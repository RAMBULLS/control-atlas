import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalogCoverage = readFileSync("src/ui/lib/catalogCoverage.ts", "utf8");
const journeyPanels = readFileSync("src/ui/components/atlas-territory/JourneyPanels.tsx", "utf8");
const journeys = readFileSync("src/ui/lib/atlasJourneys.ts", "utf8");
const sourcesPage = readFileSync("src/ui/pages/SourcesPage.tsx", "utf8");
const atlasPage = readFileSync("src/ui/pages/AtlasTerritoryPage.tsx", "utf8");
const explorePage = readFileSync("src/ui/pages/ExplorePage.tsx", "utf8");
const aboutPage = readFileSync("src/ui/pages/AboutPage.tsx", "utf8");
const objectDetailPage = readFileSync("src/ui/pages/ObjectDetailPage.tsx", "utf8");
const routeIdentity = readFileSync("src/ui/lib/routeIdentity.ts", "utf8");

test("the Atlas sheet has one plain title and no competing intro", () => {
  const explanation =
    "Federal cybersecurity material is spread across separate laws, agencies, and publications that were never organized together. Publishers wrote their own documents; Control Atlas drew the lines between them.";
  assert.equal(atlasPage.split(explanation).length - 1, 0);
  assert.match(atlasPage, /<h1[^>]*id="atl-title">Atlas<\/h1>/);
  assert.doesNotMatch(atlasPage, /The roots show why the work exists; the canopy shows where the work lives\./);
});

test("publication mandates keep all four mandate kinds", () => {
  assert.match(catalogCoverage, /statutory/);
  assert.match(catalogCoverage, /contractual/);
  assert.match(catalogCoverage, /federal_policy_or_regulatory_mandate/);
  assert.match(catalogCoverage, /issued_without_federal_mandate/);
});

test("policy documents stay available but secondary, and are described without implied precedence", () => {
  assert.match(journeyPanels, /Policy &amp; directives/);
  assert.doesNotMatch(atlasPage, /Authority · \{index\.authority\.length\}/);
  assert.doesNotMatch(journeyPanels, /\b(?:highest|supreme|controlling|overrides?|outranks?)\b/i);
});

test("the practitioner story preserves publisher authority in plain language", () => {
  assert.match(aboutPage, /Follow it back to the source/);
  assert.match(aboutPage, /does not replace NIST, DISA, DoD, FedRAMP, MITRE/);
  assert.match(aboutPage, /get back to the official source/);
  assert.doesNotMatch(aboutPage, /organizing spine|Control Atlas overlay|publisher hierarchy|provenance|confidence|trust register/i);
  assert.doesNotMatch(aboutPage, /Not a publisher source|never a publisher/i);
  assert.doesNotMatch(sourcesPage, /Not a publisher source|never a publisher/i);
});

test("Atlas names the product surface consistently", () => {
  assert.match(explorePage, /label: "Map", value: "map"/);
  assert.match(objectDetailPage, /See connections/);
  assert.match(atlasPage, /<h1[^>]*id="atl-title">Atlas<\/h1>/);
  assert.match(routeIdentity, /label: "Atlas"/);
  assert.doesNotMatch(atlasPage, /Federal cybersecurity, from authority to action/);
});

test("Atlas map and journey copy does not imply progression or visitor applicability", () => {
  for (const source of [atlasPage, journeyPanels, journeys]) {
    assert.doesNotMatch(source, /\b(?:locks?|unlocks?|prerequisites?|completion|progression|applies to you|applicable to you)\b/i);
  }
});
