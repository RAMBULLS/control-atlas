import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_STARTING_POINTS,
  validateSourceStartingPoints,
} from "../src/ui/lib/source-navigator.mjs";
import {
  START_HERE_ACCEPTANCE_MATRIX,
  START_HERE_CONTEXTS,
  START_HERE_GOALS,
  startHereDestinationFor,
} from "../src/app/start-here-compatibility.mjs";

test("inherited bookmark keys never become product destinations", () => {
  for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    assert.equal(startHereDestinationFor(key, "federal"), "/atlas", key);
    assert.equal(startHereDestinationFor("assess", key), "/atlas?atlasJourney=assessment", key);
    assert.equal(startHereDestinationFor("tools", key), "/resources", key);
    assert.equal(startHereDestinationFor("document", key), "/build", key);
    assert.equal(startHereDestinationFor("understand", key), "/atlas", key);
  }
});

test("source navigator exposes fixed public starting points without a questionnaire", () => {
  assert.deepEqual(validateSourceStartingPoints(), []);
  assert.ok(
    SOURCE_STARTING_POINTS.every(
      (point) =>
        point.catalogId &&
        point.label &&
        point.inclusionReason &&
        !/^Listed because|^Control Atlas has/.test(point.inclusionReason),
    ),
  );
  assert.ok(
    SOURCE_STARTING_POINTS.some((point) => point.catalogId === "nist-800-53"),
  );
  assert.ok(
    SOURCE_STARTING_POINTS.some((point) => point.catalogId === "disa-stig"),
  );
});

test("source starting points reject duplicate or unexplained entries", () => {
  const [first] = SOURCE_STARTING_POINTS;
  const errors = validateSourceStartingPoints([
    first,
    { ...first },
    { catalogId: "missing-explanation", label: "", inclusionReason: "" },
  ]);
  assert.ok(errors.some((error) => /duplicate/.test(error)));
  assert.ok(errors.some((error) => /lacks identity or inclusion reason/.test(error)));
});

test("all 28 retired Start Here combinations have a reasoned product destination", () => {
  assert.equal(START_HERE_ACCEPTANCE_MATRIX.length, 28);
  const pairs = new Set();
  const paths = new Set();
  for (const row of START_HERE_ACCEPTANCE_MATRIX) {
    const pair = `${row.goalId}/${row.contextId}`;
    assert.ok(!pairs.has(pair), `duplicate ${pair}`);
    pairs.add(pair);
    assert.match(row.firstDestination, /^\/(?:atlas|library|build|resources)(?:\?|$)/);
    assert.equal(row.secondDestination, null);
    assert.ok(row.nextAction.length > 20, `${pair} lacks a concrete next action`);
    assert.ok(row.rationale.length > 80, `${pair} lacks a source/product rationale`);
    assert.doesNotMatch(row.rationale, /catalog exists|because it is listed/i);
    assert.equal(startHereDestinationFor(row.goalId, row.contextId), row.firstDestination);
    paths.add(row.firstDestination);
  }
  for (const [goalId] of START_HERE_GOALS) {
    for (const [contextId] of START_HERE_CONTEXTS) {
      assert.ok(pairs.has(`${goalId}/${contextId}`), `missing ${goalId}/${contextId}`);
    }
  }
  assert.ok(paths.size <= 9, "the audit should show why the questionnaire was consolidated");
  assert.equal(startHereDestinationFor("assess", "unsure"), "/atlas?atlasJourney=assessment");
  assert.equal(startHereDestinationFor("document", "unsure"), "/build");
  assert.equal(startHereDestinationFor("tools", "unsure"), "/resources");
  assert.equal(startHereDestinationFor("", ""), "/atlas");
});
