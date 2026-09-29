import assert from "node:assert/strict";
import test from "node:test";

import {
  isComparisonCapableEdge,
  mappingSourceIdsForEdge,
} from "../src/shared/compare-capability.mjs";

function edge(overrides = {}) {
  return {
    publication_status: "published",
    relationship_type: "maps_to",
    relationship_class: "correlation",
    source_refs: [{ source_id: "some-source" }],
    ...overrides,
  };
}

test("isComparisonCapableEdge requires publication_status published", () => {
  assert.equal(isComparisonCapableEdge(edge({ publication_status: "candidate" })), false);
  assert.equal(isComparisonCapableEdge(edge({ publication_status: "editorial" })), false);
  assert.equal(isComparisonCapableEdge(edge()), true);
});

test("isComparisonCapableEdge excludes issued_under (a legal-authority pointer, not a crosswalk)", () => {
  assert.equal(
    isComparisonCapableEdge(
      edge({ relationship_type: "issued_under", relationship_class: undefined }),
    ),
    false,
  );
});

test("isComparisonCapableEdge requires the correlation class (default-derived when absent)", () => {
  assert.equal(
    isComparisonCapableEdge(edge({ relationship_class: "structural" })),
    false,
  );
  assert.equal(
    isComparisonCapableEdge(edge({ relationship_class: "organizing" })),
    false,
  );
  // No explicit class stamped: derived from relationship_type via
  // defaultRelationshipClass, which falls through to "correlation" for an
  // ordinary mapping type like "maps_to".
  assert.equal(
    isComparisonCapableEdge(edge({ relationship_class: undefined })),
    true,
  );
});

test("isComparisonCapableEdge rejects a missing/null edge", () => {
  assert.equal(isComparisonCapableEdge(null), false);
  assert.equal(isComparisonCapableEdge(undefined), false);
});

test("mappingSourceIdsForEdge dedupes and accepts either source_id or sourceId spelling", () => {
  assert.deepEqual(
    mappingSourceIdsForEdge(
      edge({
        source_refs: [
          { source_id: "a" },
          { sourceId: "a" },
          { source_id: "b" },
          {},
        ],
      }),
    ).sort(),
    ["a", "b"],
  );
  assert.deepEqual(mappingSourceIdsForEdge(edge({ source_refs: [] })), []);
  assert.deepEqual(mappingSourceIdsForEdge(edge({ source_refs: undefined })), []);
});


test("unknown predicates cannot become comparison capability through the default correlation class", () => {
  assert.equal(isComparisonCapableEdge(edge({ relationship_type: "unreviewed_relation", relationship_class: undefined })), false);
});
