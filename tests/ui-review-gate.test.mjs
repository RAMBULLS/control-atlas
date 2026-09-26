import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyChangedPaths } from "../tools/classify-change-scope.mjs";
import {
  APPROVAL_LABEL,
  APPROVAL_RECORD_NAME,
  approvalDecision,
  canRecordApproval,
  findApprovalRecord,
} from "../tools/ui-review-approval.mjs";
import { reviewSelection, reviewSelectionForChangeMap, UI_REVIEW_ROUTES } from "../tools/ui-review-routes.mjs";

/**
 * The UI review gate: which changes need a person to look, and the properties
 * that make an approval mean something.
 */

const read = (path) => readFileSync(path, "utf8");
const ids = (selection) => selection.routes.map((route) => route.id);

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** A recorded approval, as the check-runs API reports it. */
const record = (headSha, overrides = {}) => ({
  name: APPROVAL_RECORD_NAME,
  conclusion: "success",
  head_sha: headSha,
  completed_at: "2026-09-26T12:00:00Z",
  app: { slug: "github-actions" },
  output: { title: "Approved by owner" },
  ...overrides,
});

// ---------------------------------------------------------------- route set

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
    "publication-800-53", "publication-800-37", "publication-disa-stig", "publication-cmmc",
    "publication-fedramp-current", "publication-fedramp-historical", "publication-d3fend",
    "publication-sparse", "sources-publications", "sources-policy", "sources-inspector", "policy-detail",
  ]) {
    assert.ok(UI_REVIEW_ROUTES.some((route) => route.id === required), `Review set is missing ${required}`);
  }
});

// ------------------------------------------------------------- materiality

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
  assert.ok(selection.routes.length < UI_REVIEW_ROUTES.length, "a shared change must not capture every route");
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

// ------------------------------------------------- who may record approval

test("a repository administrator can approve", () => {
  const verdict = canRecordApproval({ login: "BackslashBryant", type: "User" }, "admin");
  assert.equal(verdict.allowed, true);
  assert.match(verdict.reason, /approved-by:BackslashBryant/);
});

test("a non-admin cannot approve, whatever else they can do", () => {
  for (const permission of ["write", "maintain", "triage", "read", "none", ""]) {
    const verdict = canRecordApproval({ login: "someone", type: "User" }, permission);
    assert.equal(verdict.allowed, false, `${permission} must not approve`);
    assert.match(verdict.reason, /approver-permission/);
  }
});

test("a bot cannot approve even holding an admin token", () => {
  // This is the case the label alone could not defend: an agent with write or
  // admin access applying its own approval label.
  for (const actor of [
    { login: "github-actions[bot]", type: "Bot" },
    { login: "github-actions", type: "User" },
    { login: "dependabot[bot]", type: "Bot" },
    { login: "some-app[bot]", type: "User" },
    { login: "claude", type: "Bot" },
  ]) {
    const verdict = canRecordApproval(actor, "admin");
    assert.equal(verdict.allowed, false, `${actor.login} must not approve`);
    assert.match(verdict.reason, /approval-from-bot/);
  }
  assert.equal(canRecordApproval(null, "admin").allowed, false);
  assert.equal(canRecordApproval({ login: "" }, "admin").allowed, false);
});

// --------------------------------------------------- the approval decision

test("an administrator's approval of a commit passes the gate on that commit", () => {
  const verdict = approvalDecision({
    requiresReview: true, headSha: SHA_A, hasLabel: true, checkRuns: [record(SHA_A)],
  });
  assert.equal(verdict.approved, true);
  assert.equal(verdict.reason, "approved-for-this-head");
});

test("an approval of an earlier commit does not approve a newer one, label or not", () => {
  // The case the whole design exists for. The label survived — perhaps the
  // synchronize run lost a race, perhaps someone re-added it — and the gate
  // must still fail because nobody looked at this commit.
  for (const hasLabel of [true, false]) {
    const verdict = approvalDecision({
      requiresReview: true, headSha: SHA_B, hasLabel, checkRuns: [record(SHA_A)],
    });
    assert.equal(verdict.approved, false, `stale approval must not pass (label=${hasLabel})`);
    assert.equal(verdict.reason, "approval-is-for-another-commit");
    assert.match(verdict.detail, /does not carry over/);
  }
});

test("no approval at all fails, and says so differently from a stale one", () => {
  const verdict = approvalDecision({ requiresReview: true, headSha: SHA_A, hasLabel: true, checkRuns: [] });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, "not-approved");
});

test("withdrawing the label withdraws approval even though the record remains", () => {
  const verdict = approvalDecision({
    requiresReview: true, headSha: SHA_A, hasLabel: false, checkRuns: [record(SHA_A)],
  });
  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, "approval-withdrawn");
});

test("a record nobody trusted is not an approval", () => {
  const rejected = [
    ["wrong name", record(SHA_A, { name: "some-other-check" })],
    ["not successful", record(SHA_A, { conclusion: "failure" })],
    ["still running", record(SHA_A, { conclusion: null, status: "in_progress" })],
    // A check run created by another app, or forged through one, is not a
    // record this base-branch workflow made.
    ["another app", record(SHA_A, { app: { slug: "some-other-app" } })],
    ["no app", record(SHA_A, { app: undefined })],
    ["different commit", record(SHA_B)],
  ];
  for (const [label, run] of rejected) {
    assert.equal(findApprovalRecord([run], SHA_A), null, `${label} must not count as an approval`);
    assert.equal(
      approvalDecision({ requiresReview: true, headSha: SHA_A, hasLabel: true, checkRuns: [run] }).approved,
      false,
      `${label} must not pass the gate`,
    );
  }
});

test("a change with no public UI passes without any approval", () => {
  const verdict = approvalDecision({
    requiresReview: false, headSha: SHA_A, hasLabel: false, checkRuns: [],
  });
  assert.equal(verdict.approved, true);
  assert.equal(verdict.reason, "no-public-ui-change");
});

test("an unresolvable head fails closed", () => {
  assert.equal(
    approvalDecision({ requiresReview: true, headSha: "", hasLabel: true, checkRuns: [record(SHA_A)] }).approved,
    false,
  );
});

// ----------------------------------------------------------- the workflows

test("the approval workflow binds approval to a commit and never trusts a non-admin", () => {
  const workflow = read(".github/workflows/ui-review-approval.yml");

  for (const event of ["synchronize", "labeled", "unlabeled", "opened", "reopened"]) {
    assert.match(workflow, new RegExp(`\\b${event}\\b`), `approval gate does not react to ${event}`);
  }
  // The decision is the tested module's, not inline shell.
  assert.match(workflow, /tools\/ui-review-approval\.mjs --can-record/);
  assert.match(workflow, /tools\/ui-review-approval\.mjs \\/);
  // Approval is recorded as a check run against the head commit.
  assert.match(workflow, /check-runs/);
  assert.match(workflow, /head_sha="\$HEAD_SHA"/);
  assert.match(workflow, /checks: write/);
  // The permission of whoever applied the label is looked up, not assumed.
  assert.match(workflow, /collaborators\/\$ACTOR\/permission/);
  // The label is still removed on a new commit, as convenience.
  assert.match(workflow, /github\.event\.action == 'synchronize'/);
  assert.match(workflow, /--remove-label "\$APPROVAL_LABEL"/);
  // And it must never run pull request code.
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head/);
  assert.doesNotMatch(workflow, /npm (?:ci|install)/);
  // The recording step only fires for the approval label itself.
  assert.match(workflow, /github\.event\.label\.name == 'visual-approved'/);
  assert.equal(APPROVAL_LABEL, "visual-approved");
});

test("CI captures both viewports and both page extents, and claims nothing about design", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /ui-review:\n\s+name: UI review renders/);
  assert.match(ci, /needs\.changes\.outputs\.ui_review_required == 'true'/);
  // Both artifacts are named for the head they show, not the merge commit.
  assert.match(ci, /name: ui-review-.*pull_request\.head\.sha/);
  assert.match(ci, /name: ui-review-summary-.*pull_request\.head\.sha/);
  // The concise set is built and pointed at first.
  assert.match(ci, /build-ui-review-summary\.mjs/);
  assert.match(ci, /Start here: \[ui-review-summary\]/);
  // The summary must not read as approval.
  assert.match(ci, /is not visual or copy approval/);
  assert.match(ci, /needs: \[changes, .*ui-review\]/);

  const capture = read("tools/capture-ui-review.mjs");
  assert.match(capture, /width: 1440/);
  assert.match(capture, /width: 390/);
  assert.match(capture, /fullPage: true/);
  assert.match(capture, /__viewport\.png/);
});

test("the concise review set covers both viewports and both extents for its routes", () => {
  const summary = read("tools/build-ui-review-summary.mjs");
  assert.match(summary, /"desktop-1440", "phone-390"/);
  assert.match(summary, /"viewport", "fullpage"/);
  for (const routeId of ["publication-800-53", "publication-cmmc", "publication-sparse",
    "sources-publications", "sources-policy", "sources-inspector"]) {
    assert.ok(summary.includes(`"${routeId}"`), `concise set is missing ${routeId}`);
    assert.ok(UI_REVIEW_ROUTES.some((route) => route.id === routeId), `${routeId} is not a review route`);
  }
});
