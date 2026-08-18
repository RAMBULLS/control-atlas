import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const atlasTree = readFileSync("src/ui/components/AtlasTree.tsx", "utf8");
const sourcesPage = readFileSync("src/ui/pages/SourcesPage.tsx", "utf8");
const atlasPage = readFileSync("src/ui/pages/AtlasMapPage.tsx", "utf8");
const explorePage = readFileSync("src/ui/pages/ExplorePage.tsx", "utf8");
const aboutPage = readFileSync("src/ui/pages/AboutPage.tsx", "utf8");
const objectDetailPage = readFileSync("src/ui/pages/ObjectDetailPage.tsx", "utf8");
const routeIdentity = readFileSync("src/ui/lib/routeIdentity.ts", "utf8");

test("the Atlas canvas uses the locked slim purpose line without a competing intro", () => {
  const explanation =
    "Federal cybersecurity material is spread across separate laws, agencies, and publications that were never organized together. Publishers wrote their own documents; Control Atlas drew the lines between them.";

  assert.equal(atlasTree.split(explanation).length - 1, 0);
  assert.match(atlasPage, /<h1 [^>]*id="page-title"[^>]*>\{?SITE_COPY\.routes\.atlas\.title\}?<\/h1>|<MissionPageHeader[^>]*title=\{SITE_COPY\.routes\.atlas\.title\}/);
  assert.match(atlasPage, /SITE_COPY\.routes\.atlas\.purpose/);
  assert.doesNotMatch(
    atlasTree,
    /The roots show why the work exists; the canopy shows where the work lives\./,
  );
});

test("orientation names all four mandate kinds", () => {
  assert.match(atlasTree, /statutory/);
  assert.match(atlasTree, /contractual/);
  assert.match(atlasTree, /federal_policy_or_regulatory_mandate/);
  assert.match(atlasTree, /issued_without_federal_mandate/);
});

test("curated organization is positively attributed to Control Atlas", () => {
  assert.match(aboutPage, /Control Atlas structure/);
  assert.match(aboutPage, /How Control Atlas organizes topics connects federal authority/);
  assert.doesNotMatch(aboutPage, /Not a publisher source|never a publisher/i);
  assert.doesNotMatch(sourcesPage, /Not a publisher source|never a publisher/i);
});

test("Atlas names the product surface consistently", () => {
  assert.match(explorePage, /label: "Map", value: "map"/);
  assert.match(objectDetailPage, /See connections/);
  assert.match(atlasPage, /<h1 [^>]*id="page-title"[^>]*>\{?SITE_COPY\.routes\.atlas\.title\}?<\/h1>|<MissionPageHeader[^>]*title=\{SITE_COPY\.routes\.atlas\.title\}/);
  assert.match(routeIdentity, /label: "Atlas"/);
  assert.doesNotMatch(atlasTree, /Federal cybersecurity, from authority to action/);
});

test("Atlas map copy does not imply progression or visitor applicability", () => {
  const atlasTree = readFileSync(new URL("../../src/ui/components/AtlasTree.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(atlasTree, /\b(?:locks?|unlocks?|prerequisites?|completion|progression|applies to you|applicable to you)\b/i);
});



