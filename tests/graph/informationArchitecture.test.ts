import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LIBRARY_KINDS,
  USER_FILTER_EXCLUDED_TYPES,
  libraryKindForRawType,
  rawTypesForKind,
} from "../../src/ui/lib/informationArchitecture";
import {
  OVERFLOW_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  UTILITY_NAV_ITEMS,
} from "../../src/ui/lib/navigation";

test("primary navigation exposes the task destinations while Guides remains in overflow", () => {
  assert.deepEqual(
    PRIMARY_NAV_ITEMS.map(({ label, path }) => [label, path]),
    [
      ["Start here", "/start"],
      ["Atlas", "/atlas"],
      ["Library", "/library"],
      ["Compare", "/compare"],
      ["Resources", "/resources"],
    ],
  );
  assert.deepEqual(
    OVERFLOW_NAV_ITEMS.map(({ label, path }) => [label, path]),
    [
      ["Documents", "/build"],
      ["Guides", "/guides"],
      ["Sources", "/sources"],
      ["About", "/about"],
    ],
  );
  assert.deepEqual(UTILITY_NAV_ITEMS.map(({ label }) => label), ["Sources", "About"]);
  assert.equal(
    new Set([...PRIMARY_NAV_ITEMS, ...OVERFLOW_NAV_ITEMS].map(({ path }) => path)).size,
    9,
  );
});

test("Library uses the canonical two-tier taxonomy", () => {
  assert.deepEqual(
    LIBRARY_KINDS.map(({ label }) => label),
    [
      "Requirements",
      "Technical rules",
      "Threats & defenses",
      "Baselines & profiles",
      "Process & methods",
      "Tools & communities",
    ],
  );
  assert.equal(libraryKindForRawType("control"), "requirements");
  assert.equal(libraryKindForRawType("stig_rule"), "technical-rules");
  assert.equal(libraryKindForRawType("attack_technique"), "threats-defenses");
  assert.equal(libraryKindForRawType("baseline"), "baselines-profiles");
  assert.equal(libraryKindForRawType("assessment_procedure"), "process-methods");
  assert.equal(libraryKindForRawType("community_forum"), "tools-communities");
});

test("internal hierarchy nodes never become user-facing type refinements", () => {
  for (const excluded of ["limb", "trunk", "group", "function", "family", "category"]) {
    assert.equal(USER_FILTER_EXCLUDED_TYPES.has(excluded), true, excluded);
    assert.equal(libraryKindForRawType(excluded), "", excluded);
    assert.equal(LIBRARY_KINDS.some(({ id }) => rawTypesForKind(id).includes(excluded)), false, excluded);
  }
});

test("the permanent placement and page-job rules stay in canonical guidance", () => {
  const contributing = readFileSync("CONTRIBUTING.md", "utf8");
  for (const rule of [
    "New content becomes a Library facet value.",
    "A new content action becomes a record action or Library bulk mode.",
    "A new explanation becomes a Guide.",
    "A new provenance or trust surface belongs in Sources or the footer.",
    "Only a genuinely new product earns a primary navigation slot.",
  ]) {
    assert.match(contributing, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const contracts = readFileSync("docs/PAGE_CONTRACTS.md", "utf8");
  for (const pageJob of [
    "Landing",
    "Workspace",
    "Adaptive Explorer",
    "Record detail",
    "Directory",
    "Focused workbench",
  ]) assert.match(contracts, new RegExp(pageJob));
  assert.match(contracts, /A route renders one `<main>`/);
});
