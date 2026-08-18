import {
  IconExternalLink,
  IconFileText,
} from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { Button } from "../components/lsm";
import {
  Badge,
  EmptyState,
  InspectorDrawer,
  PageHeader,
  copyText,
  sourceUsageSummary,
} from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import {
  buildPublicationRegister,
  type CatalogSummary,
  type PublicationRegisterRow,
} from "../lib/sourceRegister";
import type { ViewState } from "../lib/viewState";

const SOURCE_PAGE_SIZE = 25;

function CopyStableSourceId(props: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="ca-copy-wrap ca-source-id">
      <code>{props.id}</code>
      <button
        aria-label={`Copy source ID ${props.id}`}
        className={`ca-copy-btn ca-source-id__copy${
          copied ? " ca-copy-btn--copied" : ""
        }`}
        onClick={() => {
          void copyText(props.id).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          });
        }}
        type="button"
      >
        {copied ? "Copied" : "Copy ID"}
      </button>
      <span aria-live="polite" className="visually-hidden">
        {copied ? `Source ID ${props.id} copied` : ""}
      </span>
    </span>
  );
}

function EmptyPublicationInspector() {
  return (
    <article className="panel surface-blueprint source-inspector-card source-inspector-card--empty">
      <span className="label">SELECTED PUBLICATION</span>
      <h3 className="source-inspector-title" style={{ marginTop: 12 }}>
        Select a publication
      </h3>
      <p className="source-inspector-empty-desc" style={{ marginTop: 8 }}>
        Publisher, version, source files, and published crosswalks will appear here.
      </p>
    </article>
  );
}

function PublicationInspector(props: {
  publication: PublicationRegisterRow;
  onClose: () => void;
}) {
  const { publication, onClose } = props;
  const isAuthority = publication.id.startsWith("authority-");
  const allSupplemental = [
    ...publication.sourceMaterials.enrichment,
    ...publication.sourceMaterials.supplemental,
  ];
  const historicalItems = allSupplemental.filter((item) => item.isHistorical);
  const supplementalItems = allSupplemental.filter((item) => !item.isHistorical);
  const primaryAndSupplemental = [
    ...publication.sourceMaterials.primary,
    ...supplementalItems,
    ...historicalItems,
  ];
  const sourceFilesCount = primaryAndSupplemental.length;

  const coverageText = publication.catalogCounts
    ? `${publication.catalogCounts.normalized_records.toLocaleString()} normalized records indexed in Search & Explore`
    : isAuthority
      ? "Statutory / regulatory reference document"
      : publication.coverageSummary || "—";

  return (
    <InspectorDrawer
      ariaLabel={`Details for ${publication.officialTitle}`}
      eyebrow="SELECTED PUBLICATION"
      id="source-inspector-detail"
      isOpen={true}
      onClose={onClose}
      title={publication.officialTitle}
    >
      <div className="source-inspector-content">
        {publication.familyName ? (
          <div className="source-inspector-family">
            <span className="source-family-pill">
              Part of {publication.familyName}
            </span>
          </div>
        ) : null}

        <article aria-label="Source status summary" className="source-status-overview">
          <div className="system-stat">
            <span>Publisher</span>
            <strong>{publication.publisher.value || "—"}</strong>
          </div>

          <div className="system-stat">
            <span>Version / current through</span>
            <strong>{publication.version.value || "—"}</strong>
          </div>

          <div className="system-stat">
            <span>Status</span>
            <div>
              <Badge
                tone={
                  publication.lifecycle.value === "active"
                    ? "success"
                    : "warning"
                }
              >
                {displayNameFor("lifecycle_status", publication.lifecycle.value || "")}
              </Badge>
            </div>
          </div>

          <div className="system-stat">
            <span>Last checked</span>
            <strong>{publication.verifiedAt.value || "—"}</strong>
          </div>

          <div className="system-stat">
            <span>Control Atlas coverage</span>
            <strong>{coverageText}</strong>
          </div>

          {publication.reviews.map((review) => (
            <div className="system-stat" key={review.catalogId}>
              <span>
                {publication.reviews.length > 1
                  ? `${review.publicationName} review`
                  : "Currentness review"}
              </span>
              <strong>
                {displayNameFor(
                  "source_currentness_review",
                  review.upstreamCurrentnessReview,
                )} · <time dateTime={review.reviewedAt}>{review.reviewedAt}</time>
              </strong>
            </div>
          ))}
        </article>

        {publication.officialLink ? (
          <a
            className="button"
            href={publication.officialLink}
            rel="noopener noreferrer"
            style={{ marginTop: 8, width: "100%" }}
            target="_blank"
          >
            <span>
              {publication.publisher.value
                ? `Open official ${publication.publisher.value} publication`
                : "Open official publication"}
            </span>
            <IconExternalLink aria-hidden="true" size={14} />
          </a>
        ) : null}

        {sourceFilesCount > 0 ? (
          <details className="source-inspector-section" open>
            <summary>
              <strong>Source files ({sourceFilesCount})</strong>
            </summary>
            <ul className="source-material-list">
              {primaryAndSupplemental.map((item) => (
                <li className="source-material-item" key={item.id}>
                  <div className="source-material-header">
                    <IconFileText aria-hidden="true" size={16} />
                    <strong className="source-material-title">
                      {item.displayTitle}
                    </strong>
                    <span className="format-badge">
                      {displayNameFor("format", item.format)}
                    </span>
                    {item.isCommunity ? (
                      <span className="support-badge">Community source</span>
                    ) : null}
                    {item.isHistorical ? (
                      <span className="support-badge">Historical, superseded</span>
                    ) : null}
                  </div>
                  <div className="source-material-meta">
                    {item.retrievedAt ? (
                      <span>
                        Retrieved{" "}
                        <time dateTime={item.retrievedAt}>{item.retrievedAt}</time>
                      </span>
                    ) : null}
                    {typeof item.recordCount === "number" && item.recordCount > 0 ? (
                      <span>{item.recordCount.toLocaleString()} records</span>
                    ) : null}
                  </div>
                  {item.url ? (
                    <a
                      className="source-material-link"
                      href={item.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span>Open source file</span>
                      <IconExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {publication.connectionEvidence.length > 0 ? (
          <details className="source-inspector-section" open>
            <summary>
              <strong>
                Published crosswalks ({publication.connectionEvidence.length})
              </strong>
            </summary>
            <ul className="source-material-list">
              {publication.connectionEvidence.map((item) => (
                <li className="source-material-item" key={item.id}>
                  <div className="source-material-header">
                    <strong className="source-material-title">
                      {item.displayTitle}
                    </strong>
                    <span className="format-badge">
                      {displayNameFor("format", item.format)}
                    </span>
                  </div>
                  <div className="source-material-meta">
                    <span>Published by {item.publisher}</span>
                    {typeof item.relationshipCount === "number" &&
                    item.relationshipCount > 0 ? (
                      <span>
                        {item.relationshipCount.toLocaleString()} published links
                      </span>
                    ) : null}
                  </div>
                  {item.url ? (
                    <a
                      className="source-material-link"
                      href={item.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span>Open crosswalk file</span>
                      <IconExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {publication.sourceMaterials.reference.length > 0 ? (
          <details className="source-inspector-section">
            <summary>
              <strong>
                Reference material ({publication.sourceMaterials.reference.length})
              </strong>
            </summary>
            <ul className="source-material-list">
              {publication.sourceMaterials.reference.map((item) => (
                <li className="source-material-item" key={item.id}>
                  <div className="source-material-header">
                    <IconFileText aria-hidden="true" size={16} />
                    <strong className="source-material-title">
                      {item.displayTitle}
                    </strong>
                    <span className="support-badge">Reference only</span>
                    {item.isCommunity ? (
                      <span className="support-badge">Community source</span>
                    ) : null}
                  </div>
                  {item.url ? (
                    <a
                      className="source-material-link"
                      href={item.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span>View reference page</span>
                      <IconExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details className="source-inspector-provenance">
          <summary>Technical details & field provenance</summary>
          <div className="source-inspector-provenance-body">
            <div className="source-inspector-id-block">
              <span className="source-inspector-label">Stable Source ID</span>
              <CopyStableSourceId id={publication.id} />
            </div>
            <p className="source-usage-text">
              {sourceUsageSummary(publication.rawSource || {})}
            </p>
            <ul className="source-provenance-list">
              <li>
                <strong>Provenance class:</strong>{" "}
                <span>{publication.provenance || "Official source"}</span>
              </li>
              <li>
                <strong>Eligibility status:</strong>{" "}
                <span>{publication.eligibility || "Eligible"}</span>
              </li>
              <li>
                <strong>Access status:</strong>{" "}
                <span>{publication.access || "Public"}</span>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </InspectorDrawer>
  );
}

export function SourcesPage(props: {
  bundle: RuntimeBundle;
  state: Extract<ViewState, { view: "sources" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { bundle, state, onNavigate } = props;
  const [queryDraft, setQueryDraft] = useState(state.query || "");
  const debounceTimerRef = useRef<number | null>(null);

  const allSources = bundle.runtime.dataset.sources;
  const sourceCatalogs = useMemo(
    () => bundle.runtime.getCatalogs() as CatalogSummary[],
    [bundle.runtime],
  );

  const allPublicationRows = useMemo(
    () => buildPublicationRegister(allSources, sourceCatalogs),
    [allSources, sourceCatalogs],
  );

  const filteredPublicationRows = useMemo(
    () =>
      buildPublicationRegister(allSources, sourceCatalogs, {
        query: state.query,
        publisher: state.publisher,
        lifecycle: state.lifecycle,
      }),
    [allSources, sourceCatalogs, state.lifecycle, state.publisher, state.query],
  );

  const options = useMemo(() => {
    const sortedDistinct = (values: Array<string | null>) =>
      [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    return {
      publishers: sortedDistinct(allPublicationRows.map((r) => r.publisher.value)),
      lifecycleStatuses: sortedDistinct(
        allPublicationRows.map((r) => r.lifecycle.value),
      ),
    };
  }, [allPublicationRows]);

  const publisherOptions = options.publishers.map((value) => ({
    value,
    label: value,
  }));
  const statusOptions = options.lifecycleStatuses
    .map((value) => ({
      value,
      label: displayNameFor("lifecycle_status", value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  const [visibleLimit, setVisibleLimit] = useState(SOURCE_PAGE_SIZE);
  const firstNewRowRef = useRef<HTMLTableRowElement | null>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerIdRef = useRef<string | null>(null);

  const visibleRows = filteredPublicationRows.slice(0, visibleLimit);

  const selectedPublicationRow = useMemo(() => {
    if (!state.source) return null;
    return (
      allPublicationRows.find(
        (pub) =>
          pub.id === state.source ||
          pub.associatedSourceIds?.includes(state.source) ||
          pub.sourceMaterials.primary.some((m) => m.id === state.source) ||
          pub.sourceMaterials.enrichment.some((m) => m.id === state.source) ||
          pub.sourceMaterials.supplemental.some((m) => m.id === state.source) ||
          pub.sourceMaterials.reference.some((m) => m.id === state.source) ||
          pub.connectionEvidence.some((e) => e.id === state.source),
      ) || null
    );
  }, [allPublicationRows, state.source]);

  const hasActiveFilters = Boolean(
    state.query || state.publisher || state.lifecycle,
  );

  useEffect(() => {
    setQueryDraft(state.query || "");
  }, [state.query]);

  const handleQueryChange = (nextQuery: string) => {
    setQueryDraft(nextQuery);
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      onNavigate("sources", { ...state, query: nextQuery });
    }, 200);
  };

  useEffect(() => {
    const publisherIsUnavailable =
      Boolean(state.publisher) && !options.publishers.includes(state.publisher);
    const lifecycleIsUnavailable =
      Boolean(state.lifecycle) &&
      !options.lifecycleStatuses.includes(state.lifecycle);
    if (!publisherIsUnavailable && !lifecycleIsUnavailable) return;
    onNavigate("sources", {
      ...state,
      publisher: publisherIsUnavailable ? "" : state.publisher,
      lifecycle: lifecycleIsUnavailable ? "" : state.lifecycle,
    });
  }, [onNavigate, options, state]);

  useEffect(() => {
    setVisibleLimit(SOURCE_PAGE_SIZE);
  }, [state.lifecycle, state.publisher, state.query]);

  const lastActiveSourceRef = useRef(state.source || "");
  useEffect(() => {
    if (state.source) {
      lastActiveSourceRef.current = state.source;
    } else if (lastActiveSourceRef.current) {
      const triggerId = activeTriggerIdRef.current || lastActiveSourceRef.current;
      window.setTimeout(() => {
        document.getElementById(`source-trigger-${triggerId}`)?.focus();
      }, 50);
      lastActiveSourceRef.current = "";
    }
  }, [state.source]);

  const handleSelectPublication = (
    publicationId: string,
    event?: MouseEvent<HTMLButtonElement>,
  ) => {
    if (event) {
      activeTriggerRef.current = event.currentTarget;
    }
    activeTriggerIdRef.current = publicationId;
    lastActiveSourceRef.current = publicationId;
    onNavigate("sources", {
      ...state,
      source: publicationId,
    });
  };

  const handleCloseInspector = () => {
    const triggerId = activeTriggerIdRef.current || state.source;
    onNavigate("sources", {
      ...state,
      source: "",
    });
    window.setTimeout(() => {
      if (triggerId) {
        document.getElementById(`source-trigger-${triggerId}`)?.focus();
      }
    }, 50);
  };

  const handleResetFilters = () => {
    onNavigate("sources", {
      ...state,
      query: "",
      publisher: "",
      lifecycle: "",
    });
  };

  const publicationCount = allPublicationRows.length;
  const eyebrow = `SOURCE REGISTER / ${publicationCount} PUBLICATIONS`;

  return (
    <div
      className="sources-page ca-mission-page"
      data-visual-identity="provenance-ledger"
    >
      <PageHeader
        eyebrow={eyebrow}
        primary
        summary={SITE_COPY.routes.sources.purpose}
        title={SITE_COPY.routes.sources.title}
      />

      {state.source && !selectedPublicationRow ? (
        <div className="source-not-found-banner" role="alert">
          <div>
            <p>
              Requested source ID <code>{state.source}</code> is not in the
              public publication register.
            </p>
          </div>
          <Button
            onClick={handleCloseInspector}
            type="button"
            variant="secondary"
          >
            Clear selection
          </Button>
        </div>
      ) : null}

      <div className="sources-workspace grid queue-layout">
        <article className="panel surface-scanline sources-table-panel">
          {/* S2 Toolbar: compact admin toolbar */}
          <div className="admin-tools source-admin-tools">
            <input
              aria-label="Search publications"
              id="source-search"
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder="Search title, publisher, version, or ID"
              type="search"
              value={queryDraft}
            />

            {publisherOptions.length >= 2 ? (
              <select
                aria-label="Publisher"
                className="source-filter-select"
                onChange={(event) =>
                  onNavigate("sources", { ...state, publisher: event.target.value })
                }
                value={state.publisher || ""}
              >
                <option value="">All publishers</option>
                {publisherOptions.map((option) => (
                  <option key={`pub-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}

            {statusOptions.length >= 2 ? (
              <select
                aria-label="Status"
                className="source-filter-select"
                onChange={(event) =>
                  onNavigate("sources", { ...state, lifecycle: event.target.value })
                }
                value={state.lifecycle || ""}
              >
                <option value="">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={`status-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}

            {hasActiveFilters ? (
              <Button
                onClick={handleResetFilters}
                type="button"
                variant="secondary-quiet"
              >
                Reset filters
              </Button>
            ) : null}

            <p aria-live="polite" className="source-register-total">
              {filteredPublicationRows.length} publications
            </p>
          </div>

          {/* S3 Measurement rail */}
          <div className="calibration-rail">
            <span>
              SHOWING 1–{Math.min(visibleLimit, filteredPublicationRows.length)} / {filteredPublicationRows.length}
            </span>
          </div>

          {/* S5 & S6 Table */}
          {filteredPublicationRows.length === 0 ? (
            <EmptyState
              actionLabel="Clear publication filters"
              className="source-register-empty"
              message="Clear the search, publisher, or status filters to return to the full publication register."
              onAction={handleResetFilters}
              title="No publications match these filters."
            />
          ) : (
            <div className="table-scroll">
              <table
                aria-label="Control Atlas publication register"
                className="table source-table"
                id="source-register-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Publication</th>
                    <th scope="col">Publisher</th>
                    <th scope="col">Version / current through</th>
                    <th scope="col">Last checked</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => {
                    const isSelected =
                      state.source === row.id ||
                      selectedPublicationRow?.id === row.id;
                    const materialCount =
                      row.sourceMaterials.primary.length +
                      row.sourceMaterials.enrichment.length +
                      row.sourceMaterials.supplemental.length +
                      row.sourceMaterials.reference.length;
                    const mappingCount = row.connectionEvidence.length;

                    return (
                      <tr
                        aria-selected={isSelected ? "true" : undefined}
                        className={`source-register-row${
                          isSelected ? " source-register-row--selected" : ""
                        }`}
                        key={row.id}
                        ref={
                          index === Math.max(0, visibleLimit - SOURCE_PAGE_SIZE)
                            ? firstNewRowRef
                            : undefined
                        }
                      >
                        <td className="source-col-publication">
                          <div className="source-title-cell">
                            <button
                              aria-expanded={isSelected}
                              className="source-title-link"
                              id={`source-trigger-${row.id}`}
                              onClick={(e) => handleSelectPublication(row.id, e)}
                              type="button"
                            >
                              {row.displayTitle}
                            </button>
                            {materialCount > 0 || mappingCount > 0 ? (
                              <span
                                className="source-attached-pill"
                                title={`${materialCount} source file${
                                  materialCount === 1 ? "" : "s"
                                }, ${mappingCount} crosswalk${
                                  mappingCount === 1 ? "" : "s"
                                }`}
                              >
                                {materialCount > 0
                                  ? `${materialCount} source file${
                                      materialCount === 1 ? "" : "s"
                                    }`
                                  : ""}
                                {materialCount > 0 && mappingCount > 0 ? " · " : ""}
                                {mappingCount > 0
                                  ? `${mappingCount} crosswalk${
                                      mappingCount === 1 ? "" : "s"
                                    }`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                          {/* Mobile-only summary line for compact scan (S9) */}
                          <div className="source-mobile-meta">
                            <span>{row.publisher.value || "—"}</span>
                            <span> · </span>
                            <span>{row.version.value || "—"}</span>
                            <span> · </span>
                            <span className="source-mobile-status">
                              {displayNameFor(
                                "lifecycle_status",
                                row.lifecycle.value || "",
                              )}
                            </span>
                          </div>
                        </td>

                        <td className="source-col-publisher">
                          {row.publisher.value || "—"}
                        </td>

                        <td className="source-col-version">
                          {row.version.value || "—"}
                        </td>

                        <td className="source-col-checked">
                          {row.verifiedAt.value || "—"}
                        </td>

                        <td className="source-col-status">
                          <Badge
                            tone={
                              row.lifecycle.value === "active"
                                ? "success"
                                : "warning"
                            }
                          >
                            {displayNameFor(
                              "lifecycle_status",
                              row.lifecycle.value || "",
                            )}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filteredPublicationRows.length > visibleRows.length ? (
            <div className="source-register-more">
              <Button
                onClick={() => {
                  setVisibleLimit((current) =>
                    Math.min(current + SOURCE_PAGE_SIZE, filteredPublicationRows.length),
                  );
                  window.requestAnimationFrame(() =>
                    firstNewRowRef.current?.focus(),
                  );
                }}
                type="button"
                variant="secondary"
              >
                Show{" "}
                {Math.min(
                  SOURCE_PAGE_SIZE,
                  filteredPublicationRows.length - visibleRows.length,
                )}{" "}
                more publications
              </Button>
            </div>
          ) : null}
        </article>

        {/* S4, S7, S8 Scoped Publication Inspector */}
        <aside className="work-stack sources-inspector-pane">
          {selectedPublicationRow ? (
            <PublicationInspector
              onClose={handleCloseInspector}
              publication={selectedPublicationRow}
            />
          ) : (
            <div className="sources-inspector-empty-desktop">
              <EmptyPublicationInspector />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

