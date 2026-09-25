import {
  IconExternalLink,
  IconFileText,
} from "@tabler/icons-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { Button, ButtonLink } from "../components/lsm";
import {
  Badge,
  EmptyState,
  MissionPage,
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
import {
  formatSourceDate,
  sourceFieldAbsenceDisplayName,
} from "../lib/sourcePresentation";
import { officialSourceActionLabel, OFFICIAL_PUBLICATION_VERBS, type SourceActionVerbs } from "../lib/officialSource";
import { practitionerNameForCatalog } from "../lib/publicationIdentity";
import { AppLink } from "../components/AppLink";
import {
  FreshnessValue,
  LifecycleStatus,
  LimitationList,
  publisherLine,
  SourceDates,
  VersionValue,
} from "../components/PublicationTrust";

type Navigate = (view: ViewState["view"], patch?: Partial<ViewState>) => void;

const OFFICIAL_TEXT_VERBS: SourceActionVerbs = {
  view: "Read the official text",
  download: "Download the official text",
};

/** Said wherever an authority relationship is shown, in the same words. */
const POLICY_BASIS_NOTE =
  "Recorded in the Control Atlas authority record with a cited source. It does not state legal precedence or whether it applies to you.";

const SOURCE_PAGE_SIZE = 25;

function SourceFieldText(props: {
  field: { value: string | null; state: string; reason: string };
  notApplicable?: string;
}) {
  if (props.field.value) return <>{props.field.value}</>;
  return (
    <span className="source-field-absence" title={props.field.reason}>
      {sourceFieldAbsenceDisplayName(props.field.state, props.notApplicable)}
    </span>
  );
}

/** Enough to show the register's shape without becoming a second filter list. */
const PUBLISHER_BAND_LIMIT = 8;
/** A chip for two rows is not navigation; the dropdown already covers the tail. */
const PUBLISHER_BAND_MINIMUM = 3;

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

function useCompactSourceInspector() {
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1200 : false,
  );

  useEffect(() => {
    const update = () => setIsCompact(window.innerWidth < 1200);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isCompact;
}

/** More source files than this start collapsed, so a file inventory never pushes the trust story off a phone screen. */
const OPEN_INVENTORY_LIMIT = 4;

function PublicationInspectorContent(props: {
  publication: PublicationRegisterRow;
  heading: ReactNode;
  close?: ReactNode;
  onNavigate: Navigate;
  policyNameFor: (sourceId: string) => string;
}) {
  const { publication, heading, close, onNavigate, policyNameFor } = props;
  const { trust } = publication;
  const isPolicy = publication.kind === "policy";
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
  const sourceRoles = [
    ["Primary", publication.sourceMaterials.primary.length],
    ["Enrichment", publication.sourceMaterials.enrichment.length],
    ["Supplemental", publication.sourceMaterials.supplemental.length],
    ["Reference", publication.sourceMaterials.reference.length],
  ]
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([role]) => String(role))
    .join(", ");

  const coverageText = publication.catalogCounts
    ? `${publication.catalogCounts.normalized_records.toLocaleString()} records indexed`
    : isPolicy
      ? publication.citedBy.length
        ? `Recorded as the basis for ${publication.citedBy.length} publication${publication.citedBy.length === 1 ? "" : "s"}`
        : "Held as a source record"
      : "Held as a source record; no records indexed";

  return (
    <>
      <header className="source-inspector-header">
        <div>
          <span className="label">{isPolicy ? "POLICY DOCUMENT" : "SELECTED PUBLICATION"}</span>
          {heading}
          {trust.showsOfficialTitle ? (
            <p className="source-inspector-official" data-official-title="">
              <span className="source-inspector-label">Official title</span> {trust.officialTitle}
            </p>
          ) : null}
          <p className="source-inspector-publisher">
            {trust.publisher ? <><span className="source-inspector-label">{isPolicy ? "Issued by" : "Published by"}</span> {publisherLine(trust)}</> : <SourceFieldText field={publication.publisher} />}
          </p>
        </div>
        {close}
      </header>

      <div className="source-inspector-content">
        {trust.summary ? <p className="source-inspector-summary">{trust.summary}</p> : null}

        <section aria-label="Source status summary" className="source-status-overview">
          <div className="system-stat">
            <span>Version / current through</span>
            <strong><VersionValue showDetail version={trust.version} /></strong>
          </div>

          <div className="system-stat">
            <span>Status</span>
            <div><LifecycleStatus lifecycle={trust.lifecycle} /></div>
          </div>

          <div className="system-stat">
            <span>Source freshness</span>
            <strong><FreshnessValue freshness={trust.freshness} /></strong>
          </div>

          <div className="system-stat">
            <span>Control Atlas coverage</span>
            <strong>{coverageText}</strong>
          </div>
        </section>

        {trust.lifecycle.note ? <p className="source-coverage-basis">{trust.lifecycle.note}</p> : null}

        <div className="source-inspector-actions">
          {trust.official.url ? (
            <ButtonLink
              className="source-inspector-official-link"
              href={trust.official.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span>{isPolicy ? officialSourceActionLabel(trust.official, OFFICIAL_TEXT_VERBS) : officialSourceActionLabel(trust.official, OFFICIAL_PUBLICATION_VERBS)}</span>
              <span className="visually-hidden"> for {trust.officialTitle} (opens in a new tab)</span>
              <IconExternalLink aria-hidden="true" size={14} />
            </ButtonLink>
          ) : null}
          {publication.catalogId ? (
            <AppLink onNavigate={onNavigate} patch={{ catalog: publication.catalogId } as Partial<ViewState>} variant="secondary" view="catalog-detail">
              Open the publication page
            </AppLink>
          ) : null}
        </div>

        <section aria-labelledby={`source-dates-${publication.id}`} className="source-inspector-block">
          <h3 id={`source-dates-${publication.id}`}>Dates</h3>
          <SourceDates trust={trust} />
        </section>

        {trust.limitations.length ? (
          <section aria-labelledby={`source-limits-${publication.id}`} className="source-inspector-block">
            <h3 id={`source-limits-${publication.id}`}>Known limitations</h3>
            <LimitationList limitations={trust.limitations} />
          </section>
        ) : null}

        {trust.coverageNote ? (
          <p className="source-coverage-basis">
            <strong>Coverage basis:</strong> {trust.coverageNote}
          </p>
        ) : null}

        {isPolicy && publication.citedBy.length ? (
          <section aria-labelledby={`source-cited-${publication.id}`} className="source-inspector-block">
            <h3 id={`source-cited-${publication.id}`}>Recorded as the basis for</h3>
            <ul className="source-basis-list">
              {publication.citedBy.map((catalogId) => (
                <li key={catalogId}>
                  <AppLink onNavigate={onNavigate} patch={{ catalog: catalogId } as Partial<ViewState>} view="catalog-detail">
                    {practitionerNameForCatalog(catalogId)}
                  </AppLink>
                </li>
              ))}
            </ul>
            <p className="source-basis-note">{POLICY_BASIS_NOTE}</p>
          </section>
        ) : null}

        {!isPolicy && publication.recordedBasis.length ? (
          <section aria-labelledby={`source-basis-${publication.id}`} className="source-inspector-block">
            <h3 id={`source-basis-${publication.id}`}>Recorded policy basis</h3>
            <ul className="source-basis-list">
              {publication.recordedBasis.map((sourceId) => (
                <li key={sourceId}>
                  <AppLink onNavigate={onNavigate} patch={{ source: sourceId, layer: "policy" } as Partial<ViewState>} view="sources">
                    {policyNameFor(sourceId)}
                  </AppLink>
                </li>
              ))}
            </ul>
            <p className="source-basis-note">{POLICY_BASIS_NOTE}</p>
          </section>
        ) : null}

        {sourceFilesCount > 0 ? (
          <details className="source-inspector-section" open={sourceFilesCount <= OPEN_INVENTORY_LIMIT}>
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
                    {item.version ? <span>Version {item.version}</span> : null}
                    {item.retrievedAt ? (
                      <span>
                        Retrieved{" "}
                        <time dateTime={item.retrievedAt}>{formatSourceDate(item.retrievedAt)}</time>
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
                      <span className="visually-hidden"> {item.displayTitle} (opens in a new tab)</span>
                      <IconExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {publication.connectionEvidence.length > 0 ? (
          <details className="source-inspector-section" open={publication.connectionEvidence.length <= OPEN_INVENTORY_LIMIT}>
            <summary>
              <strong>
                Published crosswalk evidence ({publication.connectionEvidence.length})
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
                      <span className="visually-hidden"> {item.displayTitle} (opens in a new tab)</span>
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
                      <span className="visually-hidden"> {item.displayTitle} (opens in a new tab)</span>
                      <IconExternalLink aria-hidden="true" size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details className="source-inspector-provenance">
          <summary>Technical details</summary>
          <div className="source-inspector-provenance-body">
            <div className="source-inspector-id-block">
              <span className="source-inspector-label">Stable Source ID</span>
              <CopyStableSourceId id={publication.id} />
            </div>
            <p className="source-usage-text">
              {sourceUsageSummary(publication.rawSource || {})}
            </p>
            <ul className="source-provenance-list">
              {sourceRoles ? <li>
                <strong>Source roles:</strong> <span>{sourceRoles}</span>
              </li> : null}
              {publication.provenance ? <li>
                <strong>Provenance class:</strong>{" "}
                <span>{displayNameFor("provenance_class", publication.provenance)}</span>
              </li> : null}
              {publication.eligibility ? <li>
                <strong>Eligibility status:</strong>{" "}
                <span>{displayNameFor("eligibility_status", publication.eligibility)}</span>
              </li> : null}
              <li>
                <strong>Access status:</strong>{" "}
                <span>{displayNameFor("access_status", publication.access || "public")}</span>
              </li>
              {primaryAndSupplemental.filter((item) => item.checksum).map((item) => (
                <li key={`sha-${item.id}`}>
                  <strong>{item.displayTitle}:</strong>{" "}
                  <span className="source-checksum" title={item.checksum || ""}>SHA-256 {String(item.checksum).replace(/^sha256:/i, "").slice(0, 12)}…</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </>
  );
}

function PublicationInspector(props: {
  publication: PublicationRegisterRow;
  onClose: () => void;
  onNavigate: Navigate;
  policyNameFor: (sourceId: string) => string;
}) {
  const isCompact = useCompactSourceInspector();
  const title = props.publication.trust.practitionerName;

  useEffect(() => {
    if (!isCompact) return undefined;
    const app = document.getElementById("app");
    if (!app) return undefined;
    const wasInert = app.hasAttribute("inert");
    const previousAriaHidden = app.getAttribute("aria-hidden");
    app.setAttribute("inert", "");
    app.setAttribute("aria-hidden", "true");
    return () => {
      if (!wasInert) app.removeAttribute("inert");
      if (previousAriaHidden === null) app.removeAttribute("aria-hidden");
      else app.setAttribute("aria-hidden", previousAriaHidden);
    };
  }, [isCompact]);

  if (isCompact) {
    return (
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        open
      >
        <Dialog.Portal>
          <Dialog.Overlay className="source-inspector-dialog-backdrop" />
          <Dialog.Content
            aria-describedby={undefined}
            aria-label={`Details for ${title}`}
            aria-modal="true"
            className="source-inspector source-inspector--modal panel surface-blueprint"
            id="source-inspector-detail"
            onCloseAutoFocus={(event) => {
              // Sources owns focus restoration because route state can remount
              // the trigger. Prevent Radix's later default autofocus from
              // racing and overriding handleCloseInspector's resolved target.
              event.preventDefault();
            }}
          >
            <PublicationInspectorContent
              close={
                <button
                  aria-label="Close inspector"
                  className="source-inspector-close"
                  onClick={props.onClose}
                  type="button"
                >
                  Close
                </button>
              }
              heading={<Dialog.Title className="source-inspector-title">{title}</Dialog.Title>}
              onNavigate={props.onNavigate}
              policyNameFor={props.policyNameFor}
              publication={props.publication}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <article
      aria-label={`Details for ${title}`}
      className="source-inspector source-inspector--inline panel surface-blueprint"
      id="source-inspector-detail"
    >
      <PublicationInspectorContent
        close={
          <button
            aria-label="Close publication details"
            className="source-inspector-close"
            onClick={props.onClose}
            type="button"
          >
            Close
          </button>
        }
        heading={<h2 className="source-inspector-title">{title}</h2>}
        onNavigate={props.onNavigate}
        policyNameFor={props.policyNameFor}
        publication={props.publication}
      />
    </article>
  );
}

function inRegisterView(row: PublicationRegisterRow, view: "publication" | "policy") {
  return view === "policy" ? row.kind === "policy" : row.kind !== "policy";
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
  // The bootstrap summaries carry each catalog's source review; the runtime's
  // own catalog list does not, so review facts are merged from them by id.
  const sourceCatalogs = useMemo(() => {
    const reviews = new Map((bundle.catalogSummaries || []).map((entry: any) => [entry.id, entry.source_review]));
    return (bundle.runtime.getCatalogs() as CatalogSummary[]).map((catalog) =>
      catalog.source_review || !reviews.get(catalog.id) ? catalog : { ...catalog, source_review: reviews.get(catalog.id) },
    );
  }, [bundle.runtime, bundle.catalogSummaries]);

  const registerRows = useMemo(
    () => buildPublicationRegister(allSources, sourceCatalogs),
    [allSources, sourceCatalogs],
  );
  // Two views of one register: the publications Control Atlas indexes, and the
  // statutes, regulations, orders and directives behind them (Policy & directives).
  const selectedPublicationRow = useMemo(() => {
    if (!state.source) return null;
    return (
      registerRows.find(
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
  }, [registerRows, state.source]);
  // A link to a policy document opens the Policy & directives view it belongs to.
  const registerView: "publication" | "policy" =
    state.layer === "policy" || selectedPublicationRow?.kind === "policy" ? "policy" : "publication";
  const inView = (row: PublicationRegisterRow) => inRegisterView(row, registerView);
  const allPublicationRows = useMemo(
    () => registerRows.filter((row) => inRegisterView(row, registerView)),
    [registerRows, registerView],
  );
  const viewCounts = useMemo(() => ({
    publication: registerRows.filter((row) => row.kind !== "policy").length,
    policy: registerRows.filter((row) => row.kind === "policy").length,
  }), [registerRows]);

  const matchingRows = useMemo(
    () =>
      buildPublicationRegister(allSources, sourceCatalogs, {
        query: state.query,
        publisher: state.publisher,
        lifecycle: state.lifecycle,
      }),
    [allSources, sourceCatalogs, state.lifecycle, state.publisher, state.query],
  );
  const filteredPublicationRows = useMemo(() => {
    const rows = matchingRows.filter((row) => inRegisterView(row, registerView));
    return registerView === "policy"
      ? [...rows].sort((left, right) => left.trust.role.localeCompare(right.trust.role) || left.trust.practitionerName.localeCompare(right.trust.practitionerName))
      : rows;
  }, [matchingRows, registerView]);
  const otherViewMatches = state.query
    ? matchingRows.filter((row) => !inView(row)).length
    : 0;
  const policyNameFor = (sourceId: string) =>
    registerRows.find((row) => row.id === sourceId)?.trust.practitionerName || sourceId;

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

  /**
   * The register is one flat list of 192 entries behind a publisher dropdown,
   * so the shape of it — who publishes what, and how much — was invisible
   * until you opened the select. These bands put the largest publishers up
   * front as one-click filters and keep the dropdown for the long tail.
   */
  const publisherBands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allPublicationRows) {
      const name = row.publisher.value;
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ count, value }))
      .filter((band) => band.count >= PUBLISHER_BAND_MINIMUM)
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
      .slice(0, PUBLISHER_BAND_LIMIT);
  }, [allPublicationRows]);
  const statusOptions = options.lifecycleStatuses
    .map((value) => ({
      value,
      label: displayNameFor("lifecycle_status", value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  const [visibleLimit, setVisibleLimit] = useState(SOURCE_PAGE_SIZE);
  const firstNewRowRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeTriggerIdRef = useRef<string | null>(null);

  const visibleRows = filteredPublicationRows.slice(0, visibleLimit);


  const hasActiveFilters = Boolean(
    state.query || state.publisher || state.lifecycle,
  );

  useLayoutEffect(() => {
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

  const handleQueryCommit = (nextQuery = queryDraft) => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    onNavigate("sources", { ...state, query: nextQuery });
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

  const handleSelectPublication = (
    publicationId: string,
    event?: MouseEvent<HTMLButtonElement>,
  ) => {
    if (event) {
      activeTriggerRef.current = event.currentTarget;
    }
    activeTriggerIdRef.current = publicationId;
    onNavigate("sources", {
      ...state,
      source: publicationId,
    });
  };

  const handleCloseInspector = () => {
    const triggerId = activeTriggerIdRef.current || selectedPublicationRow?.id || "";
    const rememberedTrigger = activeTriggerRef.current;
    onNavigate("sources", {
      ...state,
      source: "",
    });
    if (!triggerId) return;

    // Route state may remount Sources before the dialog's own close-autofocus
    // phase runs. Keep this closure outside that lifecycle and wait until the
    // modal has released the app's inert boundary before restoring focus.
    let attempts = 0;
    const restoreTriggerFocus = () => {
      const app = document.getElementById("app");
      const trigger = rememberedTrigger?.isConnected
        ? rememberedTrigger
        : document.getElementById(`source-trigger-${triggerId}`);
      if (trigger instanceof HTMLElement && !app?.hasAttribute("inert") && !trigger.closest("[inert]")) {
        // App route orientation also focuses on the next frame. Restore the
        // originating control after that route-level focus has settled so the
        // dialog contract remains deterministic under concurrent browser load.
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const settledTrigger = rememberedTrigger?.isConnected
              ? rememberedTrigger
              : document.getElementById(`source-trigger-${triggerId}`);
            // The route transition marks the workspace inert for a moment;
            // focus() inside an inert subtree is silently ignored, so wait it out.
            if (
              settledTrigger instanceof HTMLElement &&
              !settledTrigger.closest("[inert]")
            ) {
              settledTrigger.focus({ preventScroll: true });
              if (document.activeElement !== settledTrigger) {
                attempts += 1;
                if (attempts < 20) window.setTimeout(restoreTriggerFocus, 50);
              }
            } else {
              attempts += 1;
              if (attempts < 20) window.setTimeout(restoreTriggerFocus, 50);
            }
          });
        });
        return;
      }
      attempts += 1;
      if (attempts < 20) {
        window.setTimeout(restoreTriggerFocus, 50);
      }
    };
    window.setTimeout(restoreTriggerFocus, 0);
  };

  const handleResetFilters = () => {
    onNavigate("sources", {
      ...state,
      query: "",
      publisher: "",
      lifecycle: "",
    });
  };

  const publicationCount = viewCounts.publication;
  const policyCount = viewCounts.policy;
  const eyebrow = `SOURCE REGISTER / ${publicationCount} PUBLICATIONS / ${policyCount} POLICY DOCUMENTS`;
  const switchView = (layer: "publication" | "policy") =>
    onNavigate("sources", { ...state, layer, publisher: "", lifecycle: "", source: "" });

  return (
    <MissionPage
      className="sources-page"
      data-visual-identity="provenance-ledger"
      maxWidth="workspace"
    >
      <PageHeader
        eyebrow={eyebrow}
        primary
        summary="Who published each source Control Atlas uses, which edition it holds, and how recently it was checked."
        title={SITE_COPY.routes.sources.title}
      />

      <p className="source-register-boundary">
        {registerView === "policy"
          ? `${policyCount.toLocaleString()} statutes, regulations, orders and directives that Control Atlas's authority record cites as the basis for publications. Each keeps its official title, issuer and official text. Listing here does not state legal precedence or whether one applies to you.`
          : `${publicationCount.toLocaleString()} publisher publications that anchor searchable records or published connections. Supporting files and crosswalks appear inside each publication.`}
      </p>

      <nav aria-label="Source register views" className="source-register-views">
        <button aria-pressed={registerView === "publication"} onClick={() => switchView("publication")} type="button">
          Publications<small>{publicationCount.toLocaleString()}</small>
        </button>
        <button aria-pressed={registerView === "policy"} onClick={() => switchView("policy")} type="button">
          Policy &amp; directives<small>{policyCount.toLocaleString()}</small>
        </button>
      </nav>

      {state.source && !selectedPublicationRow ? (
        <div className="source-not-found-banner" role="alert">
          <div>
            <h2>Publication not found</h2>
            <p>This link points to a publication that is not in the current public register.</p>
          </div>
          <Button
            onClick={handleCloseInspector}
            type="button"
            variant="secondary"
          >
            Return to the publication register
          </Button>
        </div>
      ) : null}

      <div className={`sources-workspace grid queue-layout${selectedPublicationRow ? " sources-workspace--inspecting" : ""}`}>
        <section aria-label="Publication register" className="sources-table-panel panel surface-scanline">
          {/* S2 Toolbar: compact admin toolbar */}
          <div className="admin-tools source-admin-tools">
            <input
              aria-label="Search publications"
              id="source-search"
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleQueryCommit(event.currentTarget.value);
                }
              }}
              placeholder={registerView === "policy" ? "Search citation, title, or issuer" : "Search title, publisher, version, or ID"}
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

            {hasActiveFilters && filteredPublicationRows.length > 0 ? (
              <Button
                onClick={handleResetFilters}
                type="button"
                variant="secondary-quiet"
              >
                Reset filters
              </Button>
            ) : null}

          </div>

          {publisherBands.length > 1 ? (
            <nav aria-label="Publishers" className="workspace-result-groups" data-group-count={publisherBands.length}>
              <button
                aria-pressed={!state.publisher}
                className="workspace-result-group"
                onClick={() => onNavigate("sources", { ...state, publisher: "" })}
                type="button"
              >
                All publishers<small>{allPublicationRows.length.toLocaleString()}</small>
              </button>
              {publisherBands.map((band) => (
                <button
                  aria-pressed={state.publisher === band.value}
                  className="workspace-result-group"
                  key={band.value}
                  onClick={() => onNavigate("sources", {
                    ...state,
                    publisher: state.publisher === band.value ? "" : band.value,
                  })}
                  type="button"
                >
                  {band.value}<small>{band.count.toLocaleString()}</small>
                </button>
              ))}
            </nav>
          ) : null}

          {/* S3 Measurement rail */}
          <div aria-live="polite" className="calibration-rail">
            <span>
              {filteredPublicationRows.length === 0
                ? "0 publications"
                : `Showing 1–${Math.min(visibleLimit, filteredPublicationRows.length)} of ${filteredPublicationRows.length}`}
            </span>
          </div>

          {otherViewMatches > 0 ? (
            <p className="source-other-view-hint">
              <button className="link-button" onClick={() => onNavigate("sources", { ...state, layer: registerView === "policy" ? "publication" : "policy", publisher: "", lifecycle: "" })} type="button">
                {otherViewMatches} {otherViewMatches === 1 ? "match" : "matches"} in {registerView === "policy" ? "Publications" : "Policy & directives"}
              </button>
            </p>
          ) : null}

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
                aria-label={registerView === "policy" ? "Policy and directives register" : "Control Atlas publication register"}
                className="table source-table"
                id="source-register-table"
              >
                <thead>
                  <tr>
                    <th scope="col">{registerView === "policy" ? "Document" : "Publication"}</th>
                    <th scope="col">{registerView === "policy" ? "Issued by" : "Publisher"}</th>
                    <th scope="col">Version / current through</th>
                    <th scope="col">Source freshness</th>
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
                      row.sourceMaterials.supplemental.length;
                    const mappingCount = row.connectionEvidence.length;

                    return (
                      <tr
                        aria-selected={isSelected ? "true" : undefined}
                        className={`source-register-row${
                          isSelected ? " source-register-row--selected" : ""
                        }`}
                        key={row.id}
                      >
                        <td className="source-col-publication">
                          <div className="source-title-cell">
                            <button
                              aria-expanded={isSelected}
                              className="source-title-link"
                              id={`source-trigger-${row.id}`}
                              onClick={(e) => handleSelectPublication(row.id, e)}
                              ref={
                                index === Math.max(0, visibleLimit - SOURCE_PAGE_SIZE)
                                  ? firstNewRowRef
                                  : undefined
                              }
                              type="button"
                            >
                              {row.trust.practitionerName}
                            </button>
                            {row.trust.showsOfficialTitle ? (
                              <span className="source-official-title">{row.trust.officialTitle}</span>
                            ) : null}
                            {registerView === "policy" && row.trust.role ? (
                              <span className="source-policy-group">{row.trust.role}</span>
                            ) : null}
                            {row.publisher.value ? (
                              <span className="source-mobile-publisher">{row.publisher.value}</span>
                            ) : null}
                            <div className="source-mobile-meta">
                              <span>{row.trust.version.label}</span>
                              <span> · </span>
                              <LifecycleStatus lifecycle={row.trust.lifecycle} />
                            </div>
                            {materialCount > 0 || mappingCount > 0 ? (
                              <span
                                className="source-attached-pill"
                                title={`${materialCount} source file${
                                  materialCount === 1 ? "" : "s"
                                }, ${mappingCount} crosswalk${
                                  mappingCount === 1 ? "" : "s"
                                }`}
                              >
                                {materialCount > 0 ? (
                                  <>
                                    <span className="source-attachment-count--desktop">
                                      {materialCount} source file{materialCount === 1 ? "" : "s"}
                                    </span>
                                    <span className="source-attachment-count--mobile">
                                      {materialCount} file{materialCount === 1 ? "" : "s"}
                                    </span>
                                  </>
                                ) : null}
                                {materialCount > 0 && mappingCount > 0 ? " · " : ""}
                                {mappingCount > 0
                                  ? `${mappingCount} crosswalk${
                                      mappingCount === 1 ? "" : "s"
                                    }`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                        </td>

                        <td className="source-col-publisher">
                          <SourceFieldText field={row.publisher} />
                        </td>

                        <td className="source-col-version">
                          <VersionValue version={row.trust.version} />
                        </td>

                        <td className="source-col-checked">
                          <FreshnessValue freshness={row.trust.freshness} />
                        </td>

                        <td className="source-col-status">
                          <LifecycleStatus lifecycle={row.trust.lifecycle} />
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
        </section>

        {/* S4, S7, S8 Scoped Publication Inspector */}
        {selectedPublicationRow ? (
          <aside className="work-stack sources-inspector-pane">
            <PublicationInspector
              onClose={handleCloseInspector}
              onNavigate={onNavigate}
              policyNameFor={policyNameFor}
              publication={selectedPublicationRow}
            />
          </aside>
        ) : null}
      </div>
    </MissionPage>
  );
}
