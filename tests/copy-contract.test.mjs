import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SITE_COPY,
  FIRST_PAINT_ROUTE_COPY,
  PROHIBITED_PRIMARY_SURFACE_PATTERNS,
  UI_COPY_CONTRACT,
  formatRecordCount,
  formatConnectionCount,
  formatRecordTypeLabel,
} from "../src/shared/site-copy.mjs";
import { provenanceDescriptionMap } from "../src/content/copy.mjs";

const read = (path) => readFileSync(path, "utf8");
const PUBLIC_COPY_FILES = [
  "src/shared/home-content.mjs",
  "src/shared/disclaimer.mjs",
  "src/app/help-data.mjs",
  "src/app/learn-content.mjs",
  "src/app/start-here-guide.mjs",
  "src/app/template-engine.mjs",
  "src/index.html",
  "src/main.tsx",
  "src/public/progressive-shell.js",
  "src/ui/components/SearchOverlay.tsx",
  "src/ui/components/SiteFooter.tsx",
  "src/ui/App.tsx",
  "src/ui/components/AtlasTree.tsx",
  "src/ui/pages/AboutPage.tsx",
  "src/ui/pages/AtlasMapPage.tsx",
  "src/ui/pages/CatalogDetailPage.tsx",
  "src/ui/pages/CommonsDetailPage.tsx",
  "src/ui/pages/CommonsPage.tsx",
  "src/ui/pages/ComparePage.tsx",
  "src/ui/pages/ExplorePage.tsx",
  "src/ui/pages/HomePage.tsx",
  "src/ui/pages/ObjectDetailPage.tsx",
  "src/ui/pages/PlaybooksPage.tsx",
  "src/ui/pages/SourcesPage.tsx",
  "src/ui/pages/StartHerePage.tsx",
  "src/ui/pages/TemplatesPage.tsx",
  "src/ui/lib/buildRouteState.ts",
  "src/ui/lib/catalogProfiles.ts",
  "src/ui/lib/pagePrimitives.tsx",
  "src/ui/lib/recordTitle.ts",
  "src/shared/product-identity.ts",
  "data/curated/authority-spine.json",
];

test("site copy keeps every approved anchor exact", () => {
  assert.equal(SITE_COPY.home.headline, "Make federal cybersecurity make sense.");
  assert.equal(SITE_COPY.home.definition, "Understand what applies, what it means, and what to do next.");
  assert.equal(SITE_COPY.product.searchPlaceholder, "Search by topic, title, or identifier.");
  assert.equal(SITE_COPY.product.definition, "Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.");
  assert.equal(SITE_COPY.product.boundary, "Use Control Atlas for research, not compliance or authorization decisions.");
  assert.deepEqual(
    SITE_COPY.home.destinations.map(({ label, description }) => [label, description]),
    [
      ["Start guided setup", "Answer two questions to find where to begin."],
      ["Browse the Atlas", "Start with a topic."],
      ["Search the Library", "Find a specific record."],
      ["Browse Resources", "Find tools, training, and guidance."],
    ],
  );
});

test("third-party federal-use provenance is described without changing its publisher", () => {
  assert.equal(
    provenanceDescriptionMap.federal_utilized,
    "Used in federal work but not published by a federal agency.",
  );
});

test("product-authored route copy excludes banned metaphor and generated guidance", () => {
  const copy = PUBLIC_COPY_FILES.map((path) => read(path)).join("\n");
  for (const pattern of PROHIBITED_PRIMARY_SURFACE_PATTERNS) {
    assert.doesNotMatch(copy, pattern);
  }
});

test("product-authored Resource collection summaries stay short and task-focused", () => {
  const dataset = JSON.parse(read("data/commons-resource-dataset.json"));
  for (const collection of dataset.collections) {
    assert.match(collection.summary, /^(?:Find|Check)\b/);
    assert.ok(
      collection.summary.trim().split(/\s+/).length <= 12,
      `${collection.id} summary is longer than one useful task sentence`,
    );
    assert.doesNotMatch(collection.summary, /(?:,[^,]+){2,}/);
  }
});

test("record page is contract-driven and contains no generic source or advice fallback", () => {
  const recordPage = read("src/ui/pages/ObjectDetailPage.tsx");
  assert.match(recordPage, /recordPresentationContract/);
  // The official-source action label now resolves through one shared module so
  // a download is never labelled "View". The record page must route through it
  // rather than hardcoding a label of its own.
  assert.match(recordPage, /officialSourceActionLabel/);
  assert.doesNotMatch(recordPage, /"View official source"/);
  assert.match(read("src/ui/lib/officialSource.ts"), /View official source/);
  assert.match(recordPage, /See connections/);
  assert.match(recordPage, /About (?:this|This) [rR]ecord/);
  assert.doesNotMatch(recordPage, />Official text</i);
  assert.doesNotMatch(recordPage, /What this is|What you need to do|How to satisfy it/i);
});

test("generation excludes structural scaffolding from public records", () => {
  const generator = read("scripts/build-framework-data.mjs");
  // Structural types are never public records. Retired record types (issue 279)
  // are excluded from search documents by the same filter.
  assert.match(generator, /filter\(\(node\) => !NON_RECORD_NODE_TYPES\.has\(node\.node_type\) && !RETIRED_RECORD_TYPES\.has\(node\.node_type\)\)/);
});

test("Home has one centralized React and first-paint copy source", () => {
  assert.match(read("src/ui/pages/HomePage.tsx"), /HOME_CONTENT/);
  assert.match(read("vite.config.ts"), /HOME_CONTENT/);
  assert.doesNotMatch(read("src/ui/pages/HomePage.tsx"), /Make federal cybersecurity make sense/);
  assert.doesNotMatch(read("vite.config.ts"), /Make federal cybersecurity make sense/);
});

test("FIRST_PAINT_ROUTE_COPY omits duplicate eyebrows that match the title", () => {
  for (const [routeKey, routeCopy] of Object.entries(FIRST_PAINT_ROUTE_COPY)) {
    if (routeCopy.eyebrow) {
      assert.notEqual(
        routeCopy.eyebrow.trim().toLowerCase(),
        routeCopy.title.trim().toLowerCase(),
        `Route ${routeKey} has eyebrow "${routeCopy.eyebrow}" matching title "${routeCopy.title}"`,
      );
    }
  }
});

test("UI copy contract formatters provide clean human-readable record types and formatted counts", () => {
  assert.equal(formatRecordTypeLabel("control"), "Control");
  assert.equal(formatRecordTypeLabel("disa-cci", "cci"), "CCI");
  assert.equal(formatRecordTypeLabel("csf-2", "csf-subcategory"), "CSF Subcategory");
  assert.equal(formatRecordTypeLabel("nist-ssdf", "ssdf-task"), "SSDF Task");
  assert.equal(formatRecordTypeLabel("stig_rule"), "STIG Rule");
  assert.equal(formatRecordTypeLabel("control_enhancement"), "Control Enhancement");

  assert.equal(formatRecordCount(1), "1 record");
  assert.equal(formatRecordCount(324), "324 records");

  assert.equal(formatConnectionCount(1), "1 published connection");
  assert.equal(formatConnectionCount(156, 8), "156 published connections across 8 groups");
});

test("UI copy contract state messages and action labels are non-empty and task-first", () => {
  for (const [key, action] of Object.entries(UI_COPY_CONTRACT.actions)) {
    assert.ok(typeof action === "string" && action.length > 0, `Action ${key} is empty`);
    assert.doesNotMatch(action, /[\u00c2\u00c3]|\u00e2\u20ac/);
  }
  for (const [key, message] of Object.entries(UI_COPY_CONTRACT.stateMessages)) {
    assert.ok(typeof message === "string" && message.length > 0, `State message ${key} is empty`);
    assert.doesNotMatch(message, /[\u00c2\u00c3]|\u00e2\u20ac/);
  }
});
