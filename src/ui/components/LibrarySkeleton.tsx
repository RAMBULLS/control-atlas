import { Panel } from "./lsm";

export function LibrarySkeleton() {
  return (
    <Panel aria-busy="true" aria-label="Loading library" className="skeleton-container">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-line wide" />
      <div className="skeleton-block skeleton-line" />
      <div className="skeleton-search" />
      {/* The hydrated Library puts a filter rail beside the results. Without a
          placeholder for it the result column was laid out full width and then
          narrowed, so every card shifted sideways once at hydration. */}
      <div className="skeleton-workspace">
        <div className="skeleton-rail">
          {[1, 2, 3, 4].map((index) => (
            <div className="skeleton-block skeleton-line" key={index} />
          ))}
        </div>
        <div className="grid gap-[16px]">
          {[1, 2, 3, 4, 5].map((index) => (
            <article className="p-[16px] border border-[var(--ca-border)] rounded-[3px] bg-[var(--ca-surface)] skeleton-card" key={index}>
              <div className="skeleton-block skeleton-line wide" />
              <div className="skeleton-block skeleton-line" />
              <div className="skeleton-block skeleton-line short" />
            </article>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/**
 * Compare's results, while they are being built.
 *
 * The flow measured 5.8 seconds from "Show published mappings" to the first
 * row, showing only the words "Loading the comparison." for all of it - after
 * an explicit button press, at the moment of highest expectation in a
 * three-step wizard. Library already had the right pattern; this is that
 * pattern shaped like a comparison table.
 */
export function CompareSkeleton() {
  return (
    <Panel aria-busy="true" aria-label="Building the comparison" className="skeleton-container">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-line wide" />
      <p className="skeleton-note">
        Building the comparison across every mapped record. This takes a few seconds.
      </p>
      <div className="grid gap-[8px]">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
          <div className="skeleton-compare-row" key={index}>
            <div className="skeleton-block skeleton-line short" />
            <div className="skeleton-block skeleton-line wide" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function DetailConnectionsSkeleton() {
  return (
    <Panel aria-busy="true" title="Loading connections">
      <p className="mb-[24px]">
        Search results are ready. Full connection maps and detail views finish
        loading in the background.
      </p>
      <div className="grid gap-[16px]">
        {[1, 2].map((index) => (
          <div className="p-[16px] border border-[var(--ca-border)] rounded-[3px] bg-[var(--ca-surface)] skeleton-card" key={index}>
            <div className="skeleton-block skeleton-line wide" />
            <div className="skeleton-block skeleton-line" />
          </div>
        ))}
      </div>
    </Panel>
  );
}
