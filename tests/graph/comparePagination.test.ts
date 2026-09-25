import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPARE_COMPACT_INLINE_TARGET_LIMIT,
  COMPARE_COMPACT_QUERY,
  COMPARE_INLINE_TARGET_LIMIT,
  COMPARE_PAGE_SIZE,
  paginateCompareRows,
} from "../../src/ui/lib/comparePagination";
import { parseHashLocation, serializeHashLocation } from "../../src/ui/lib/hashRoutes";

test("Compare uses bounded fixed windows that replace rather than accumulate", () => {
  const rows = Array.from({ length: 60 }, (_, index) => `row-${index + 1}`);
  const first = paginateCompareRows(rows, "");
  const second = paginateCompareRows(rows, "2");
  const last = paginateCompareRows(rows, "3");

  assert.equal(COMPARE_PAGE_SIZE, 25, "a page is a bounded window of the answer");
  // Rows up to the limit show every target inline; past it a virtualized window
  // shows them all. A small preview limit would return the "Show N more" click
  // #281 removed; a huge one would mount thousands of entries per page.
  assert.ok(
    COMPARE_INLINE_TARGET_LIMIT >= 25 && COMPARE_INLINE_TARGET_LIMIT <= 100,
    "the inline limit is chosen from measured render cost, not a preview size",
  );
  // Phones: 25 titled targets made ~3,400px rows; 8 keeps an inline row within
  // ~1.5 viewports (1,266px at 844px tall). Larger rows use the window.
  assert.equal(COMPARE_COMPACT_INLINE_TARGET_LIMIT, 8);
  assert.equal(COMPARE_COMPACT_QUERY, "(max-width: 599px)");
  assert.deepEqual(first.rows, rows.slice(0, 25));
  assert.deepEqual(second.rows, rows.slice(25, 50));
  assert.deepEqual(last.rows, rows.slice(50, 60));
  assert.deepEqual(
    [second.start, second.end, second.page, second.pageCount, second.valid],
    [26, 50, 2, 3, true],
  );
});

test("Compare reports invalid page requests while showing the nearest bounded window", () => {
  const rows = Array.from({ length: 60 }, (_, index) => index + 1);
  assert.deepEqual(
    paginateCompareRows(rows, "999"),
    {
      end: 60,
      page: 3,
      pageCount: 3,
      requestedPage: "999",
      rows: rows.slice(50),
      start: 51,
      valid: false,
    },
  );
  assert.equal(paginateCompareRows(rows, "not-a-page").page, 1);
  assert.equal(paginateCompareRows(rows, "not-a-page").valid, false);
});

test("Compare page state round-trips through the public hash URL", () => {
  const state = parseHashLocation(
    "/compare/relationships",
    "?intent=frameworks&source=nist-800-53&target=disa-cci&compareRun=true&page=2",
  );
  assert.equal(state.view, "matrix");
  if (state.view !== "matrix") return;
  assert.equal(state.page, "2");
  assert.equal(
    serializeHashLocation(state),
    "/compare/relationships?source=nist-800-53&target=disa-cci&intent=frameworks&compareRun=true&page=2",
  );
});
