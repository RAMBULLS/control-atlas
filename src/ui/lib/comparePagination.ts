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

// Targets listed inline per source record. The rest sit behind an inline "Show N more targets"
// disclosure in the same row, so one busy record cannot dominate the page. Nothing is dropped:
// counts, evidence and exports still cover every target.
export const COMPARE_TARGET_PREVIEW = 5;
