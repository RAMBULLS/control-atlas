import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyChangedPaths } from "../tools/classify-change-scope.mjs";
import { reviewSelection, reviewSelectionForChangeMap, UI_REVIEW_ROUTES } from "../tools/ui-review-routes.mjs";

/**
 * The UI review gate: which changes need a person to look, and the properties
 * that make the approval mean something.
 */

const read = (path) => readFileSync(path, "utf8");
const ids = (selection) => selection.routes.map((route) => route.id);

test("every review route has a real hash path and a title someone can read", () => {
  const seen = new Set();
  for (const route of UI_REVIEW_ROUTES) {
    assert.ok(!seen.has(route.id), `Duplicate review route id ${route.id}`);
    seen.add(route.id);
    assert.match(route.path, /^\/#\//, `${route.id} is not a hash route`);
    assert.ok(route.title.length > 3, `${route.id} has no title`);
    assert.ok(route.owners.length > 0, `${route.id} has no owning source paths`);
  }
});

test("the review set covers the publication states that render differently", () => {
  // A sparse publication, a historical one and a thousand-row one fail in
  // different ways. Reviewing only the flagship proves the flagship.
  for (const required of [
    "publication-800-53",
    "publication-800-37",
    "publication-disa-stig",
    "publication-cmmc",
    "publication-fedramp-current",
    "publication-fedramp-historical",
    "publication-d3fend",
    "publication-sparse",
    "sources-publications",
    "sources-policy",
    "sources-inspector",
    "policy-detail",
  ]) {
    assert.ok(UI_REVIEW_ROUTES.some((route) => route.id === required), `Review set is missing ${required}`);
  }
});

test("data-only, docs-only, CI-only and backend changes need no visual review", () => {
  const cases = {
    "source refresh": ["data/generated/sources.json", "data/source-registry.json"],
    docs: ["docs/PAGE_CONTRACTS.md", "README.md"],
    CI: [".github/workflows/ci.yml", "tools/classify-change-scope.mjs"],
    tests: ["tests/e2e/publication-trust.spec.mjs", "tests/graph/sourceRegister.test.ts"],
    importers: ["scripts/fetch-disa-stigs.mjs", "scripts/build-framework-data.mjs"],
  };
  for (const [label, paths] of Object.entries(cases)) {
    const selection = reviewSelection(paths);
    assert.equal(selection.material, false, `${label} should not require visual review, got ${ids(selection)}`);
  }
});

test("shared modules that render visible words are not backend changes", () => {
  // src/shared holds the taxonomy tags, brand strings and copy contract that
  // become words on a page. Classifying them as backend is how a copy change
  // reaches production without anyone reading it.
  for (const path of ["src/shared/taxonomy-contract.mjs", "src/shared/site-copy.mjs", "src/app/display-names.mjs"]) {
    assert.equal(reviewSelection([path]).material, true, `${path} should require visual review`);
  }
});

test("a change to one page selects that page and not the whole product", () => {
  const selection = reviewSelection(["src/ui/pages/HomePage.tsx"]);
  assert.deepEqual(ids(selection), ["home"]);
  assert.equal(selection.reason, "route-scoped");
});

test("a change to the publication surface selects every publication state", () => {
  const selection = reviewSelection(["src/ui/components/PublicationOverview.tsx"]);
  assert.ok(ids(selection).includes("publication-sparse"));
  assert.ok(ids(selection).includes("publication-fedramp-historical"));
  assert.ok(!ids(selection).includes("home"), "a publication-only change must not drag Home in");
});

test("a shared component or stylesheet reviews a bounded sample, not all routes", () => {
  const selection = reviewSelection(["styles/components.css"]);
  assert.equal(selection.material, true);
  assert.match(selection.reason, /^shared-ui/);
  assert.ok(selection.routes.length >= 6, "a shared change must sample more than one layout family");
  assert.ok(
    selection.routes.length < UI_REVIEW_ROUTES.length,
    "a shared change must not capture every route; that is a sweep nobody looks at",
  );
});

test("an unmapped public source file fails closed into review", () => {
  const selection = reviewSelection(["src/ui/pages/SomeBrandNewPage.tsx"]);
  assert.equal(selection.material, true);
  assert.match(selection.reason, /unmapped:src\/ui\/pages\/SomeBrandNewPage\.tsx/);
});

test("an unusable diff reviews the sample rather than silently reviewing nothing", () => {
  const selection = reviewSelectionForChangeMap({ changedPaths: [], reason: "base-unavailable" });
  assert.equal(selection.material, true);
  assert.ok(selection.routes.length > 0);
});

test("evidence-only runs skip the gate, matching the change-map classifier", () => {
  const changeMap = classifyChangedPaths(["artifacts/audits/a.json"]);
  assert.equal(changeMap.evidenceOnly, true);
  assert.equal(reviewSelectionForChangeMap(changeMap).material, false);
});

test("the approval workflow resets on a new commit and never trusts a non-admin", () => {
  const workflow = read(".github/workflows/ui-review-approval.yml");

  // Fires on the events that can change either the head or the approval.
  for (const event of ["synchronize", "labeled", "unlabeled", "opened", "reopened"]) {
    assert.match(workflow, new RegExp(`\\b${event}\\b`), `approval gate does not react to ${event}`);
  }
  // A new commit withdraws approval.
  assert.match(workflow, /github\.event\.action == 'synchronize'/);
  assert.match(workflow, /--remove-label "\$APPROVAL_LABEL"/);
  // Approval is checked against the current head and must come from an admin.
  assert.match(workflow, /permission" \) *!= *"admin"|\[ "\$permission" != "admin" \]/);
  assert.match(workflow, /collaborators\/\$approver\/permission/);
  // The gate must never run pull request code.
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head/);
});

test("CI captures both viewports and both page extents, and claims nothing about design", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /ui-review:\n\s+name: UI review renders/);
  // Selected by the change map, and only when there is a build to look at.
  assert.match(ci, /needs\.changes\.outputs\.ui_review_required == 'true'/);
  // The artifact is named for the head it shows. On a pull_request event
  // github.sha is the merge commit, which is not the commit anyone approves.
  assert.match(ci, /name: ui-review-.*pull_request\.head\.sha/);
  // The summary must not read as approval.
  assert.match(ci, /is not visual or copy approval/);
  // And the required gate waits on it.
  assert.match(ci, /needs: \[changes, .*ui-review\]/);

  const capture = read("tools/capture-ui-review.mjs");
  assert.match(capture, /width: 1440/);
  assert.match(capture, /width: 390/);
  assert.match(capture, /fullPage: true/);
  assert.match(capture, /__viewport\.png/);
});
