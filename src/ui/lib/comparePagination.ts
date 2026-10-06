// Source records per page. A page is a bounded window of the answer, not the whole answer:
// counts and exports always cover every matching mapping.
export const COMPARE_PAGE_SIZE = 25;

export type ComparePageWindow<T> = {
  end: number;
  page: number;
  pageCount: number;
  requestedPage: string;
  rows: T[];
  start: number;
  valid: boolean;
};

function parseRequestedPage(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

export function paginateCompareRows<T>(
  rows: readonly T[],
  requestedPage: string,
): ComparePageWindow<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / COMPARE_PAGE_SIZE));
  const parsedPage = requestedPage ? parseRequestedPage(requestedPage) : 1;
  const valid = parsedPage !== null && parsedPage <= pageCount;
  const page = Math.min(parsedPage || 1, pageCount);
  const startIndex = (page - 1) * COMPARE_PAGE_SIZE;
  const pageRows = rows.slice(startIndex, startIndex + COMPARE_PAGE_SIZE);

  return {
    end: pageRows.length ? startIndex + pageRows.length : 0,
    page,
    pageCount,
    requestedPage,
    rows: pageRows,
    start: pageRows.length ? startIndex + 1 : 0,
    valid,
  };
}

// Targets a source record renders inline, all at once. A record with more renders every
// target in a bounded, virtualized window instead, so nothing sits behind a reveal click and
// no page mounts thousands of entries.
//
// Measured for issue 281 across all 50 offered crosswalk directions (25 source records per page).
// Render cost did not decide it: next-page-to-paint stayed ~110-330ms at limits of 60 and
// 100 (fixed page-change work dominates), versus up to 537ms when every target sat in the DOM
// behind "Show N more" (8,928 entries / 62,774 table nodes on one DISA CCI -> STIG page).
// Row height did: at 60, titled targets made single rows 3,600px tall on desktop and 6,100px
// on a phone. 25 still renders 99.06% of all source records fully inline (60: 99.57%) and
// covers the busiest SP 800-53 -> CSF record, while rows beyond it get the bounded window.
// At 25 the heaviest page mounts 346 entries / 2,700 table nodes and next-page-to-paint is
// 281ms worst case across the seven measured crosswalks.
export const COMPARE_INLINE_TARGET_LIMIT = 25;

// Phones get a lower inline limit. At compact widths titled targets stack one per
// line, and 25 of them made single rows up to ~3,400px tall on a 320-390 x 844 phone.
// The goal is that an inline row stays within ~1.5 viewports (1,266px at 844px tall):
// 25 x 1,266 / 3,400 is ~9.3 targets, rounded down to a conservative 8. Rows with more
// targets go straight to the virtualized window, still with no reveal click.
export const COMPARE_COMPACT_INLINE_TARGET_LIMIT = 8;
export const COMPARE_COMPACT_QUERY = "(max-width: 599px)";
