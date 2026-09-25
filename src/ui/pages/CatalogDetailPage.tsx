import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { useLayoutEffect, useMemo, useState } from "react";
import { RETIRED_RECORD_TYPES } from "../../shared/record-acceptance.mjs";

import { Button } from "../components/lsm/Button";
import { AppLink } from "../components/AppLink";
import {
  paginateCatalogRecords,
  publicationSourceForCatalog,
} from "../lib/catalogInventory";
import { catalogDisplayNameFor, catalogProfileFor } from "../lib/catalogProfiles";
import { PageHeader, WorkbenchControlSurface } from "../lib/pagePrimitives";
import { recordIdentityPresentationFor } from "../lib/recordTitle";
import { taxonomyTagsForRecord } from "../../shared/record-taxonomy.mjs";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";
import { datasetCheckedThroughFor, publicationTrustFor } from "../lib/publicationIdentity";
import { publicationIdentityFor } from "../lib/sourceRegister";
import { PublicationOverview } from "../components/PublicationOverview";
import { inlineLabel, PUBLICATION_NON_LEAF_NODE_TYPES } from "../lib/publicationActions";

const PAGE_SIZE = 100;
const NON_LEAF_NODE_TYPES = PUBLICATION_NON_LEAF_NODE_TYPES;

type CatalogState = Extract<ViewState, { view: "catalog-detail" }>;

export function CatalogDetailPage(props: {
  bundle: RuntimeBundle;
  state: CatalogState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { bundle, state, onNavigate, onOpenNode } = props;
  const [queryDraft, setQueryDraft] = useState(state.query);
  useLayoutEffect(() => setQueryDraft(state.query), [state.query]);
  const catalogs =
    bundle.catalogSummaries?.length
      ? bundle.catalogSummaries
      : bundle.runtime.getCatalogs();
  const catalog = catalogs.find((entry: any) => entry.id === state.catalog);

  if (!state.catalog) {
    return (
      <CatalogInventory
        bundle={bundle}
        catalogs={catalogs}
        onNavigate={onNavigate}
        state={state}
      />
    );
  }

  if (!catalog) {
    return (
      <section className="notice">
        <h1>Publication not found</h1>
        <p>This publication is not available in the current public data set.</p>
        <AppLink onNavigate={onNavigate} variant="primary" view="search">
          Back to Library
        </AppLink>
      </section>
    );
  }

  const profile = catalogProfileFor(catalog.id, catalog.name);
  const source = publicationSourceForCatalog(bundle.runtime, catalog.id)
    || (catalog.source_id ? bundle.runtime.getSource(catalog.source_id) : null);
  const catalogName = catalogDisplayNameFor(catalog.id, catalog.name);
  const identityIndexEntry = publicationIdentityFor(source?.id || catalog.source_id || "");
  const trust = publicationTrustFor({
    source: source || { id: catalog.source_id || catalog.id, name: catalogName },
    catalogId: catalog.id,
    review: catalog.source_review,
    counts: identityIndexEntry?.catalog_counts,
    datasetCheckedThrough: datasetCheckedThroughFor(bundle.runtime.dataset?.sources || []),
  });
  const publicationTitle = trust.practitionerName;
  const publisherName = trust.publisher;
  const catalogAtlasTagIds = taxonomyTagsForRecord({ catalog_id: catalog.id })
    .filter((t: { kind?: string }) => ["organization", "framework", "program"].includes(t.kind ?? ""))
    .map((t: { id: string }) => t.id);
  const tierLabel = String(catalog.tier_label || "section").trim();
  const tierLabelPlural = String(
    catalog.tier_label_plural || `${tierLabel}s`,
  ).trim();
  const tierLabelHeading = `${tierLabel.charAt(0).toUpperCase()}${tierLabel.slice(1)}`;
  const records = bundle.runtime
    .getNodes({ catalog_id: catalog.id })
    .filter((record: any) => !NON_LEAF_NODE_TYPES.has(record.node_type) && !RETIRED_RECORD_TYPES.has(record.node_type));
  const publishedGroups = bundle.catalogPublishedGroups || [];
  const families = [
    ...new Set(
      publishedGroups.length
        ? publishedGroups.map((group) => group.name)
        : records.map((record: any) => record.metadata?.family).filter(Boolean),
    ),
  ].sort() as string[];
  const query = state.query.trim().toLowerCase();
  const matchingRecords = records.filter(
    (record: any) =>
      (!state.family || record.metadata?.family === state.family) &&
      (!query ||
        [
          record.metadata?.item_id,
          record.metadata?.title,
          record.metadata?.family,
          record.description,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))),
  );
  const tierGroups = publishedGroups.length
    ? publishedGroups.map((group) => ({
        name: group.name,
        count: group.record_count,
      }))
    : families.map((name) => ({
        name,
        count: records.filter(
          (record: any) => record.metadata?.family === name,
        ).length,
      }));
  const filteredTierGroups = query && !state.family
    ? tierGroups.filter((group) => group.name.toLowerCase().includes(query))
    : tierGroups;
  const showTierBrowser =
    families.length > 1 &&
    !state.family &&
    (publishedGroups.length > 0 || (state.browseAll !== "true" && !query));
  const requestedPage = Number.parseInt(state.page || "1", 10);
  const page = paginateCatalogRecords(
    matchingRecords,
    requestedPage,
    PAGE_SIZE,
  );
  const pageCount = page.pageCount;
  const pageIsValid = page.valid;
  const pageRecords = page.records;

  const update = (patch: Partial<CatalogState>) =>
    onNavigate("catalog-detail", { ...state, ...patch });

  return (
    <section className="catalog-detail-page" data-visual-identity="publisher-research-library">
      <AppLink
        className="back-link"
        onNavigate={onNavigate}
        view="search"
      >
        <IconArrowLeft aria-hidden="true" size={17} /> Back to Library
      </AppLink>

      <PublicationOverview
        bundle={bundle}
        catalog={catalog}
        catalogAtlasTagIds={catalogAtlasTagIds}
        onNavigate={onNavigate}
        records={records}
        recordLabel={profile.recordLabel}
        tierCount={families.length}
        tierLabel={tierLabel}
        tierLabelPlural={tierLabelPlural}
        trust={trust}
      />

      <section aria-labelledby="catalog-records-title" className="catalog-records">
        <div className="catalog-records-heading">
          <div>
            <h2 id="catalog-records-title" tabIndex={-1}>
              Browse {publicationTitle} {inlineLabel(profile.recordLabel)}
            </h2>
            <p>
              {showTierBrowser
                ? `${filteredTierGroups.length} ${tierLabelPlural}`
                : `${matchingRecords.length.toLocaleString()} matching records`}
            </p>
          </div>
        </div>
        <WorkbenchControlSurface
          className="catalog-detail-control-surface"
          label={`Filter ${publicationTitle} ${profile.recordLabel}`}
          targetId="catalog-record-results"
        >
          <form
            aria-label="Catalog record controls"
            className="catalog-record-toolbar"
            onSubmit={(event) => { event.preventDefault(); const query = queryDraft.trim(); if (query !== state.query) update({ query, browseAll: showTierBrowser ? "" : "true", page: "" }); }}
            role="search"
          >
            <div className="catalog-record-filters">
              {families.length > 1 && !showTierBrowser ? (
                <label className="catalog-record-filter">
                  <span>{tierLabelHeading}</span>
                  <select
                    aria-label={`Filter by ${tierLabel}`}
                    onChange={(event) =>
                      update({
                        family: event.target.value,
                        browseAll: "true",
                        page: "",
                      })
                    }
                    value={state.family}
                  >
                    <option value="">All {tierLabelPlural}</option>
                    {families.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="catalog-record-filter catalog-record-search-filter">
                <span>{showTierBrowser ? `Search ${tierLabelPlural}` : "Search records"}</span>
                <span className="catalog-search">
                  <IconSearch aria-hidden="true" size={18} />
                  <input
                    aria-label={showTierBrowser ? `Search ${publicationTitle} ${tierLabelPlural}` : `Search ${publicationTitle}`}
                    onChange={(event) => setQueryDraft(event.target.value)}
                    placeholder={showTierBrowser
                      ? `Search ${tierLabelPlural} in ${publicationTitle}`
                      : `Identifier or title in ${publicationTitle}`}
                    type="search"
                    value={queryDraft}
                  />
                </span>
              </label>
            </div>
            <Button type="submit" variant="secondary">{showTierBrowser ? `Search ${tierLabelPlural}` : "Search records"}</Button>
          </form>
        </WorkbenchControlSurface>

        <div data-control-results id="catalog-record-results">
          {bundle.catalogRecordsReady === false ? (
            <p className="notice-inline" role="status">
              Loading this publication's records…
            </p>
          ) : showTierBrowser ? (
            <>
              <div className="catalog-index-list">
                {filteredTierGroups.map((group) => (
                  <button
                    className="catalog-index-row"
                    data-published-tier={tierLabel}
                    key={group.name}
                    onClick={() =>
                      update({
                        family: group.name,
                        browseAll: "true",
                        page: "",
                      })
                    }
                    type="button"
                  >
                    <span>
                      <small>{tierLabelHeading}</small>
                      <strong>{group.name}</strong>
                    </span>
                    <span>
                      {group.count.toLocaleString()} {profile.recordLabel}
                    </span>
                  </button>
                ))}
              </div>
              {publishedGroups.length ? null : (
                <button
                  className="link-button"
                  onClick={() => update({ browseAll: "true", page: "" })}
                  type="button"
                >
                  Browse all {records.length.toLocaleString()} {profile.recordLabel}
                </button>
              )}
              {filteredTierGroups.length === 0 ? (
                <div className="empty-state">
                  <h3>No {tierLabelPlural} match this search.</h3>
                  <p>Try another {tierLabel} name.</p>
                  <Button onClick={() => update({ query: "", page: "" })} type="button" variant="secondary">
                    Clear {tierLabel} search
                  </Button>
                </div>
              ) : null}
            </>
          ) : !pageIsValid ? (
            <div className="empty-state">
              <h3>That result page is not available.</h3>
              <p>
                This filter has {pageCount} page{pageCount === 1 ? "" : "s"}.
              </p>
              <AppLink onNavigate={onNavigate} patch={{ ...state, page: String(pageCount) }} variant="secondary" view="catalog-detail">
                Open the last available page
              </AppLink>
            </div>
          ) : pageRecords.length ? (
            <>
              <ul className="catalog-record-list">
                {pageRecords.map((record: any) => {
                  const itemId = record.metadata?.item_id || record.id;
                  const title = record.metadata?.title || itemId;
                  const identity = recordIdentityPresentationFor({
                    publisher: publisherName,
                    catalogId: catalog.id,
                    publicationName: catalogName,
                    family: record.metadata?.family || "",
                    itemId,
                    title,
                    objectType: record.node_type || "",
                    metadata: record.metadata,
                  });
                  const primaryText = identity.stableIdIsGenerated
                    ? identity.primary
                    : itemId;
                  const supportingText = identity.stableIdIsGenerated
                    ? identity.context
                    : title !== itemId
                      ? title
                      : identity.secondary;
                  return (
                    <li key={record.id}><article className="catalog-record-row">
                      <h3><AppLink
                        aria-label={`Open ${identity.accessibleName}`}
                        className="catalog-record-title"
                        onNavigate={onNavigate}
                        patch={{ node: record.id }}
                        view="library-detail"
                      >
                        <strong>{primaryText}</strong>
                        {supportingText ? <span>{supportingText}</span> : null}
                      </AppLink></h3>
                      {record.description ? <p>{record.description}</p> : null}
                      {record.metadata?.family ? (
                        <small>{record.metadata.family}</small>
                      ) : null}
                    </article></li>
                  );
                })}
              </ul>
              <nav aria-label="Catalog result pages" className="catalog-pagination">
                {requestedPage === 1 ? <span aria-disabled="true" className="catalog-pagination-disabled">Previous</span> : <AppLink onNavigate={onNavigate} patch={{ ...state, page: requestedPage - 1 === 1 ? "" : String(requestedPage - 1) }} variant="secondary" view="catalog-detail">Previous</AppLink>}
                <span>
                  Page {requestedPage} of {pageCount} · showing{" "}
                  {(requestedPage - 1) * PAGE_SIZE + 1}–
                  {(requestedPage - 1) * PAGE_SIZE + pageRecords.length} of{" "}
                  {matchingRecords.length.toLocaleString()}
                </span>
                {requestedPage === pageCount ? <span aria-disabled="true" className="catalog-pagination-disabled">Next</span> : <AppLink onNavigate={onNavigate} patch={{ ...state, page: String(requestedPage + 1) }} variant="secondary" view="catalog-detail">Next</AppLink>}
              </nav>
            </>
          ) : (
            <div className="empty-state">
              <h3>No records match these filters.</h3>
              <p>Try an identifier, official title, {tierLabel}, or broader term.</p>
              <Button
                onClick={() =>
                  update({
                    query: "",
                    family: "",
                    browseAll: "",
                    page: "",
                  })
                }
                type="button"
                variant="secondary"
              >
                Clear catalog filters
              </Button>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function CatalogInventory(props: {
  bundle: RuntimeBundle;
  catalogs: any[];
  state: CatalogState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { bundle, catalogs, state, onNavigate } = props;
  const rows = useMemo(
    () =>
      catalogs.map((entry) => {
        const profile = catalogProfileFor(entry.id, entry.name);
        // The bootstrap entry names its source directly; the node-walk only
        // resolves once the full graph is loaded, so on this page it returned
        // null and the row fell back to display_group — which is a grouping
        // bucket, printing "Other" as the publisher of FedRAMP, CMMC, and CUI.
        const source =
          (entry.source_id ? bundle.runtime.getSource(entry.source_id) : null) ||
          publicationSourceForCatalog(bundle.runtime, entry.id);
        const trust = publicationTrustFor({ source: source || { id: entry.source_id || entry.id, name: entry.name }, catalogId: entry.id });
        return {
          entry,
          profile,
          trust,
          publicationTitle: trust.practitionerName,
          // Omit absent metadata instead of turning it into public copy.
          publisher: source?.owner ? trust.publisher : "",
          lifecycle: source?.lifecycle_status || "",
          lifecycleLabel: source?.lifecycle_status ? trust.lifecycle.label : "",
        };
      }),
    [bundle.runtime, catalogs],
  );
  const query = state.query.trim().toLowerCase();
  const eligible = rows.filter(
    (row) =>
      (!query ||
        [row.entry.id, row.entry.name, row.publicationTitle, row.trust.officialTitle, row.publisher, row.profile.recordLabel, row.profile.publicationKind]
          .some((value) => String(value).toLowerCase().includes(query))) &&
      (!state.type || row.profile.recordLabel === state.type) &&
      (!state.area || row.profile.area === state.area) &&
      (!state.publisher || row.publisher === state.publisher) &&
      (!state.lifecycle || row.lifecycle === state.lifecycle),
  );
  // W10: publication kind is the primary grouping — a newcomer can tell
  // FedRAMP (an authorization program) from a STIG (an implementation
  // standard) from this heading alone. Record type moves to its own
  // secondary filter below, not the section headers.
  const grouped = [
    ...new Set(eligible.map((row) => row.profile.publicationKind)),
  ]
    .sort()
    .map((label) => ({
      label,
      rows: eligible.filter((row) => row.profile.publicationKind === label),
    }));
  const update = (patch: Partial<CatalogState>) =>
    onNavigate("catalog-detail", { ...state, ...patch });

  return (
    <section className="panel catalog-index" data-visual-identity="publisher-research-library">
      <PageHeader
        primary
        summary="Browse official publications, then filter the records inside one publication."
        title="Library"
      />
      <h2 className="library-browse-heading">Browse publications</h2>
      <WorkbenchControlSurface
        className="catalog-inventory-control-surface"
        label="Filter publications"
        targetId="catalog-inventory-results"
      >
        <div className="catalog-inventory-controls">
        <label className="catalog-search">
          <IconSearch aria-hidden="true" size={18} />
          <input
            aria-label="Search the catalog inventory"
            onChange={(event) => update({ query: event.target.value })}
            placeholder="Publication, publisher, or record type"
            type="search"
            value={state.query}
          />
        </label>
        <InventorySelect
          label="Area"
          onChange={(area) => update({ area })}
          options={[...new Set(rows.map((row) => row.profile.area))]
            .filter(Boolean)
            .sort()}
          value={state.area}
        />
        <InventorySelect
          label="Publisher"
          onChange={(publisher) => update({ publisher })}
          options={[...new Set(rows.map((row) => row.publisher))]
            .filter(Boolean)
            .sort()}
          value={state.publisher}
        />
        <InventorySelect
          label="Record type (advanced)"
          onChange={(type) => update({ type })}
          options={[...new Set(rows.map((row) => row.profile.recordLabel))].sort()}
          value={state.type}
        />
        </div>
        <p className="catalog-inventory-total" aria-live="polite">
          {eligible.length} of {rows.length} publications
        </p>
      </WorkbenchControlSurface>
      <div data-control-results id="catalog-inventory-results">
        {grouped.map((group) => (
        <section className="catalog-index-group" key={group.label}>
          <h2 className="catalog-index-group-label">{group.label}</h2>
          <ul className="catalog-index-list">
            {group.rows.map(({ entry, profile, publicationTitle, trust, publisher, lifecycleLabel }) => (
              <li key={entry.id}><AppLink
                className="catalog-index-row"
                data-publication-row={entry.id}
                onNavigate={onNavigate}
                patch={{ ...emptyCatalogState(), catalog: entry.id }}
                view="catalog-detail"
              >
                <span>
                  <h3>{publicationTitle}</h3>
                  {trust.showsOfficialTitle ? <small className="catalog-index-row-official">{trust.officialTitle}</small> : null}
                  {profile.synopsis ? <small>{profile.synopsis}</small> : null}
                  {[publisher, profile.area, lifecycleLabel].filter(Boolean).length ? (
                    <small className="catalog-index-row-meta">
                      {[publisher, profile.area, lifecycleLabel].filter(Boolean).join(" · ")}
                    </small>
                  ) : null}
                </span>
                <span>
                  {(entry.leaf_record_count ?? entry.node_count).toLocaleString()}{" "}
                  {profile.recordLabel}
                </span>
              </AppLink></li>
            ))}
          </ul>
        </section>
        ))}
        {eligible.length === 0 ? (
          <div className="empty-state">
            <h2>No publications match these filters.</h2>
            <Button
              onClick={() => onNavigate("catalog-detail", emptyCatalogState())}
              type="button"
              variant="secondary"
            >
              Clear catalog filters
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InventorySelect(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{props.label}</span>
      <select
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      >
        <option value="">All</option>
        {props.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function emptyCatalogState(): Omit<CatalogState, "view"> {
  return {
    catalog: "",
    query: "",
    family: "",
    browseAll: "",
    type: "",
    area: "",
    publisher: "",
    lifecycle: "",
    page: "",
  };
}
