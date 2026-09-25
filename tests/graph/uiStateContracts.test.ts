import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  UI_WORKFLOW_STATES,
  resolveWorkflowState,
  shouldRenderControl,
  shouldDisableControl,
  filterDependentOptions,
} from "../../src/shared/state-contract.mjs";
import {
  PageHeader,
  EmptyState,
  StepIndicator,
  FilterBar,
  SourceProvenanceSummary,
  stepEyebrow,
} from "../../src/ui/lib/pagePrimitives";

test("UI_WORKFLOW_STATES covers all required standardized lifecycle states", () => {
  assert.deepEqual(UI_WORKFLOW_STATES, [
    "initial",
    "loading",
    "ready",
    "empty",
    "blocked",
    "unavailable",
    "error",
  ]);
});

test("resolveWorkflowState returns correct state for all lifecycle permutations", () => {
  assert.equal(
    resolveWorkflowState({ hasError: true }),
    "error",
    "Error must take highest precedence",
  );
  assert.equal(
    resolveWorkflowState({ isUnavailable: true }),
    "unavailable",
    "Unavailable takes precedence over loading/configuration",
  );
  assert.equal(
    resolveWorkflowState({ isLoading: true }),
    "loading",
    "Loading state takes precedence over configuration",
  );
  assert.equal(
    resolveWorkflowState({ hasPrerequisite: false }),
    "blocked",
    "Missing prerequisite yields blocked state",
  );
  assert.equal(
    resolveWorkflowState({ isConfigured: false }),
    "initial",
    "Unconfigured workflow yields initial state",
  );
  assert.equal(
    resolveWorkflowState({ isConfigured: true, hasResults: false }),
    "empty",
    "Configured workflow with 0 results yields empty state",
  );
  assert.equal(
    resolveWorkflowState({ isConfigured: true, hasResults: true }),
    "ready",
    "Configured workflow with results yields ready state",
  );
});

test("shouldRenderControl enforces state-appropriate control visibility", () => {
  // Error / unavailable state
  assert.equal(shouldRenderControl("error", "recovery"), true);
  assert.equal(shouldRenderControl("error", "action"), false);
  assert.equal(shouldRenderControl("unavailable", "navigation"), true);
  assert.equal(shouldRenderControl("unavailable", "results-filter"), false);

  // Loading state
  assert.equal(shouldRenderControl("loading", "status"), true);
  assert.equal(shouldRenderControl("loading", "action"), false);

  // Initial state
  assert.equal(shouldRenderControl("initial", "results-filter"), false);
  assert.equal(shouldRenderControl("initial", "action"), true);

  // Ready / empty state
  assert.equal(shouldRenderControl("ready", "action"), true);
  assert.equal(shouldRenderControl("ready", "results-filter"), true);
  assert.equal(shouldRenderControl("empty", "recovery"), true);
});

test("shouldDisableControl only disables when purpose is clear and completion is possible", () => {
  // If prerequisite is not visible or action cannot complete, should not disable (hide instead)
  assert.equal(
    shouldDisableControl({ isActionable: false, hasVisiblePrerequisite: false }),
    false,
  );
  assert.equal(
    shouldDisableControl({ isActionable: false, canComplete: false }),
    false,
  );

  // When prerequisite is visible and action can complete but is not ready: disable
  assert.equal(
    shouldDisableControl({ isActionable: false, hasVisiblePrerequisite: true, canComplete: true }),
    true,
  );

  // When ready and actionable: enable
  assert.equal(
    shouldDisableControl({ isActionable: true, hasVisiblePrerequisite: true, canComplete: true }),
    false,
  );
});

test("filterDependentOptions filters downstream selector options cleanly", () => {
  const allTargets = [
    { id: "csf-2", connectedTo: ["nist-800-53", "nist-800-171"] },
    { id: "cui-policy", connectedTo: ["nist-800-171"] },
    { id: "cmmc-2", connectedTo: [] },
  ];

  const forNist53 = filterDependentOptions(allTargets, (t) =>
    t.connectedTo.includes("nist-800-53"),
  );
  assert.deepEqual(forNist53.map((t) => t.id), ["csf-2"]);

  const forNist171 = filterDependentOptions(allTargets, (t) =>
    t.connectedTo.includes("nist-800-171"),
  );
  assert.deepEqual(forNist171.map((t) => t.id), ["csf-2", "cui-policy"]);

  // Edge cases
  assert.deepEqual(filterDependentOptions(null as any, () => true), []);
  assert.deepEqual(filterDependentOptions(allTargets, null as any), allTargets);
});

test("PageHeader automatically suppresses duplicate eyebrow when it matches title", () => {
  // Case 1: Duplicate eyebrow and title (e.g. "Atlas" & "Atlas")
  const duplicateMarkup = renderToStaticMarkup(
    React.createElement(PageHeader, {
      eyebrow: "Atlas",
      title: "Atlas",
      summary: "Start with a topic.",
    }),
  );
  assert.doesNotMatch(
    duplicateMarkup,
    /class="eyebrow page-header-eyebrow"/,
    "Duplicate eyebrow must be omitted",
  );
  assert.match(duplicateMarkup, /<h1>Atlas<\/h1>/);

  // Case 2: Distinct eyebrow providing real location/scope
  const distinctMarkup = renderToStaticMarkup(
    React.createElement(PageHeader, {
      eyebrow: "Practitioner guide",
      title: "Using FedRAMP Inheritance",
      summary: "Understanding inherited cloud controls.",
    }),
  );
  assert.match(
    distinctMarkup,
    /<span class="eyebrow page-header-eyebrow">Practitioner guide<\/span>/,
    "Distinct eyebrow must be preserved",
  );
  assert.match(distinctMarkup, /<h1>Using FedRAMP Inheritance<\/h1>/);
});

test("EmptyState renders accessible status and actionable recovery", () => {
  let clicked = false;
  const markup = renderToStaticMarkup(
    React.createElement(EmptyState, {
      title: "No matching records",
      message: "Try adjusting your search terms or clearing active filters.",
      actionLabel: "Reset filters",
      onAction: () => { clicked = true; },
      tone: "default",
    }),
  );

  assert.match(markup, /role="status"/);
  assert.match(markup, /<h3 class="empty-state-title">No matching records<\/h3>/);
  assert.match(markup, /<p class="empty-state-message">Try adjusting your search terms or clearing active filters.<\/p>/);
  assert.match(markup, /<button.*?>Reset filters<\/button>/);
});

test("StepIndicator renders ordered, non-interactive progress with done, current and future steps", () => {
  const steps = [
    { id: "mode", label: "Select Mode" },
    { id: "source", label: "Choose Source" },
    { id: "results", label: "Review Mappings" },
  ];

  const markup = renderToStaticMarkup(
    React.createElement(StepIndicator, {
      steps,
      currentStep: 2,
    }),
  );

  assert.match(markup, /<nav aria-label="Step progress" class="staged-flow-steps"><ol class="step-list"/);
  assert.match(markup, /--step-count:3;--step-progress:0.5/, "the line is drawn from the real position");
  assert.match(markup, /class="step-item is-done"/, "Step 1 should be done");
  assert.match(markup, /aria-current="step" class="step-item is-current"/, "Step 2 is the current step");
  assert.match(markup, /class="step-item is-future"/, "Step 3 is still ahead");
  assert.equal((markup.match(/aria-current=/g) || []).length, 1, "exactly one current step");
  // State is carried by more than color: a check mark and hidden text for done.
  assert.match(markup, /<svg[^>]*tabler-icon-check/, "done steps show a check mark");
  assert.match(markup, /<span class="visually-hidden"> \(done\)<\/span>/);
  // Steps are status, not controls.
  assert.doesNotMatch(markup, /<(a|button)\b/);
});

test("StepIndicator supports any step count and draws the outcome step without a number", () => {
  const steps = [
    { id: "a", label: "One" },
    { id: "b", label: "Two" },
    { id: "c", label: "Three" },
    { id: "d", label: "Four" },
    { id: "plan", label: "Your plan", outcome: true },
  ];
  const first = renderToStaticMarkup(React.createElement(StepIndicator, { steps, currentStep: 1 }));
  const last = renderToStaticMarkup(React.createElement(StepIndicator, { steps, currentStep: 5 }));

  assert.match(first, /--step-count:5;--step-progress:0"/);
  assert.match(last, /--step-progress:1"/);
  assert.match(last, /class="step-item is-current is-outcome"/);
  assert.equal((last.match(/class="step-number"/g) || []).length, 4, "the outcome is not numbered");
});

test("stepEyebrow derives a panel label from the same step definitions", () => {
  const steps = [
    { id: "choose", label: "Choose" },
    { id: "set-up", label: "Set up" },
    { id: "plan", label: "Your plan", outcome: true },
  ];
  assert.equal(stepEyebrow(steps, "set-up"), "02 / Set up");
  assert.equal(stepEyebrow(steps, "plan"), "Your plan");
  assert.equal(stepEyebrow(steps, "missing"), "");
});

test("FilterBar renders controls container and clear action when filters are active", () => {
  const withActive = renderToStaticMarkup(
    React.createElement(FilterBar, {
      activeCount: 3,
      onReset: () => {},
      resetLabel: "Clear all filters",
      children: React.createElement("input", { placeholder: "Search..." }),
    }),
  );
  assert.match(withActive, /<button class="filter-bar-reset".*?>Clear all filters<\/button>/);

  const withoutActive = renderToStaticMarkup(
    React.createElement(FilterBar, {
      activeCount: 0,
      onReset: () => {},
      children: React.createElement("input", { placeholder: "Search..." }),
    }),
  );
  assert.doesNotMatch(withoutActive, /filter-bar-reset/);
});

test("SourceProvenanceSummary formats publisher metadata concisely", () => {
  const markup = renderToStaticMarkup(
    React.createElement(SourceProvenanceSummary, {
      owner: "NIST",
      version: "Rev. 5",
      lastChecked: "2026-08-01",
      officialUrl: "https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final",
    }),
  );
  assert.match(markup, /<span class="source-provenance-owner">NIST<\/span>/);
  assert.match(markup, /<span class="source-provenance-version"> · Rev. 5<\/span>/);
  assert.match(markup, /<span class="source-provenance-checked"> · Checked 2026-08-01<\/span>/);
  assert.match(markup, /href="https:\/\/csrc.nist.gov\/publications\/detail\/sp\/800-53\/rev-5\/final"/);
});
