import {
  IconGitCompare,
  IconList,
  IconMap,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { LibraryAtlasMap, type LibraryMapItem } from "../components/LibraryAtlasMap";
import { AppLink } from "../components/AppLink";
import { BucketTag } from "../components/TaxonomyTag";
import {
  CheckboxFacet,
  TagFacet,
  TypeaheadFacet,
  WorkspaceTemplate,
} from "../components/WorkspaceTemplate";
import { Button } from "../components/lsm";
import {
  AREA_PRESENTATIONS,
  areaPresentationForCatalog,
} from "../lib/areaVisualLanguage";
import { buildCatalogCoverageList, catalogCoverageForId, isLowCatalogCoverage } from "../lib/catalogCoverage";
import { catalogDisplayNameFor } from "../lib/catalogProfiles";
import { LIBRARY_KINDS, libraryKindForRawType, libraryKindLabel, rawTypesForKind } from "../lib/informationArchitecture";
import {
  TAXONOMY_CONTRACT,
  TAXONOMY_TAG_BY_ID,
} from "../../shared/taxonomy-contract.mjs";
import {
  recordIdentityPresentationFor,
  recordPublisherName,
} from "../lib/recordTitle";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import {
  connectionSummary,
  MarkedSearchText,
  searchPreviewText,
} from "../lib/searchPresentation";
import type { ViewState } from "../lib/viewState";

type SearchState = Extract<ViewState, { view: "search" }>;

function taxonomyTagGroups(selected: string[]) {
  const groups = new Map<string, string[]>();
  for (const id of selected) {
    const definition = TAXONOMY_TAG_BY_ID.get(id);
    if (!definition) continue;
    const values = groups.get(definition.dimension) || [];
    values.push(id);
    groups.set(definition.dimension, values);
  }
  return [...groups.values()];
}

function matchReasonFor(document: any, query: string): string {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return "Matches active filters";
  const itemId = String(document.item_id || document.id || "").toLocaleLowerCase();
  const title = String(document.title || "").toLocaleLowerCase();
  if (itemId === needle) return "Exact identifier";
  if (title === needle) return "Exact title";
  if (itemId.startsWith(needle)) return "Identifier match";
  if (title.includes(needle)) return "Title match";
  return "Text match";
}

const RELEVANCE_ORDER: Record<string, number> = {
  "Exact identifier": 0,
  "Exact title": 1,
  "Identifier match": 2,
  "Title match": 3,
  "Text match": 4,
  "Matches active filters": 5,
};

export function ExplorePage(props: {
  bundle: RuntimeBundle;
  graphReady: boolean;
  state: SearchState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (nodeId: string) => void;
  onRequestFullGraph: () => void;
  onOpenGlossary: (termId?: string) => void;
}) {
  const { bundle, graphReady, state, onNavigate, onRequestFullGraph } = props;
  const resultsRef = useRef<HTMLUListElement>(null);
  const [queryDraft, setQueryDraft] = useState(state.query);
  const [detailsReady, setDetailsReady] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const connectedOnly = state.connectedOnly === "true";
  const hasFilters = Boolean(state.filter || state.publisher || state.kind || state.area || state.tags.length || connectedOnly);
  const searchStarted = Boolean(state.query.trim() || hasFilters);
  const runtimeCatalogs = useMemo(() => bundle.runtime.getCatalogs(), [bundle.runtime]);
  const libraryFacets = useMemo(() => bundle.runtime.getLibraryFacets(), [bundle.runtime]);
  const libraryBrowseCounts = useMemo(
    () => (bundle.runtime as any).getLibraryBrowseCounts?.() || { object_types: {}, tags: {} },
    [bundle.runtime],
  );
  const catalogNames = useMemo(
    () => new Map<string, string>(runtimeCatalogs.map((catalog: any) => [
      String(catalog.id),
      catalogDisplayNameFor(String(catalog.id), String(catalog.name || "")),
    ])),
    [runtimeCatalogs],
  );
  const catalogCoverage = useMemo(
    () => buildCatalogCoverageList(runtimeCatalogs, 1),
    [runtimeCatalogs],
  );
  const selectedAreaCatalogIds = useMemo(
    () => state.area
      ? runtimeCatalogs
        .filter((catalog: any) => areaPresentationForCatalog(catalog.id)?.id === state.area)
        .map((catalog: any) => String(catalog.id))
      : [],
    [runtimeCatalogs, state.area],
  );

  useEffect(() => setQueryDraft(state.query), [state.query]);

  useEffect(() => {
    setDetailsReady(false);
    setVisibleCount(searchStarted ? 25 : 0);
    if (!searchStarted) return;
    const frame = window.requestAnimationFrame(() => setDetailsReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [searchStarted, state.area, state.connectedOnly, state.filter, state.kind, state.publisher, state.query, state.sort]);

  const baseLibraryFilters = useMemo(() => ({
    catalog_id: state.filter || undefined,
    catalog_ids: selectedAreaCatalogIds,
    connected_only: connectedOnly,
    object_types: state.kind ? [...rawTypesForKind(state.kind)] : [],
    publisher_name: state.publisher || undefined,
  }), [connectedOnly, selectedAreaCatalogIds, state.filter, state.kind, state.publisher]);

  const documents = useMemo(() => {
    if (!searchStarted) return [];
    return bundle.runtime.searchLibrary(state.query, {
      ...baseLibraryFilters,
      taxonomy_tag_groups: taxonomyTagGroups(state.tags),
    });
  }, [baseLibraryFilters, bundle.runtime, searchStarted, state.query, state.tags]);

  const resultContext = useMemo(() => {
    if (!searchStarted) return { result_count: 0, tags: {} as Record<string, number> };
    return (bundle.runtime as any).getLibraryTagContext?.(state.query, {
      ...baseLibraryFilters,
      taxonomy_tag_groups: taxonomyTagGroups(state.tags),
    }) || { result_count: documents.length, tags: {} };
  }, [baseLibraryFilters, bundle.runtime, documents.length, searchStarted, state.query, state.tags]);

  const rows = useMemo(() => {
    const prepared = documents.map((document: any) => {
      const relationshipCount = Number(document.published_connection_count || 0);
      const crossFrameworkCount = Number(document.published_cross_catalog_connection_count || 0);
      const crossFrameworkCatalogCount = Number(document.published_connection_catalog_count || 0);
      const itemId = String(document.item_id || document.id || "");
      const source = bundle.runtime.getSource(document.source_id);
      const publisher = recordPublisherName(
        document.publisher_name,
        source?.owner,
        source?.publisher,
      );
      const publication = catalogNames.get(document.catalog_id) ||
        catalogDisplayNameFor(document.catalog_id, document.catalog_name || "");
      const identity = recordIdentityPresentationFor({
        publisher,
        catalogId: document.catalog_id || "",
        publicationName: publication,
        family: document.control_family || "",
        itemId,
        title: String(document.title || ""),
        objectType: document.object_type || "",
        metadata: { identity_category: document.identity_category || "" },
      });
      return {
        accessibleName: identity.accessibleName,
        area: areaPresentationForCatalog(document.catalog_id),
        crossFrameworkCatalogCount,
        crossFrameworkCount,
        document,
        identifier: itemId,
        identity: identity.primary,
        lowCoverage: isLowCatalogCoverage(catalogCoverageForId(catalogCoverage, document.catalog_id)),
        matchReason: matchReasonFor(document, state.query),
        publication,
        publisher,
        relationshipCount,
        sortTitle: identity.secondary || identity.primary,
        title: identity.secondary,
      };
    });
    const by = (key: "identifier" | "sortTitle" | "publication") => (left: any, right: any) =>
      String(left[key]).localeCompare(String(right[key]), undefined, { numeric: true, sensitivity: "base" });
    if (state.sort === "identifier") return prepared.sort(by("identifier"));
    if (state.sort === "title") return prepared.sort(by("sortTitle"));
    if (state.sort === "publication") return prepared.sort(by("publication"));
    return prepared.sort((left: any, right: any) =>
      (RELEVANCE_ORDER[left.matchReason] ?? 9) - (RELEVANCE_ORDER[right.matchReason] ?? 9) || by("sortTitle")(left, right));
  }, [bundle.runtime, catalogCoverage, catalogNames, documents, state.query, state.sort]);

  const publishers = libraryFacets.publishers || [];
  const topCatalogs = useMemo(() => runtimeCatalogs
    .map((catalog: any) => ({
      ...catalog,
      publisher: recordPublisherName(
        catalog.display_group,
        catalog.source_id ? bundle.runtime.getSource(catalog.source_id)?.owner : "",
        catalog.display_group,
      ),
    }))
    .filter((catalog: any) => catalog.leaf_record_count > 0)
    .sort((left: any, right: any) => right.leaf_record_count - left.leaf_record_count || left.name.localeCompare(right.name))
    .slice(0, 6), [bundle.runtime, runtimeCatalogs]);
  const areaCounts = useMemo(() => AREA_PRESENTATIONS.map((area) => ({
    ...area,
    count: runtimeCatalogs
      .filter((catalog: any) => areaPresentationForCatalog(catalog.id)?.id === area.id)
      .reduce((total: number, catalog: any) => total + Number(catalog.leaf_record_count || 0), 0),
  })).filter((area) => area.count > 0), [runtimeCatalogs]);
  const kindCounts = useMemo(() => LIBRARY_KINDS.map((kind) => ({
    ...kind,
    count: Object.entries(libraryBrowseCounts.object_types || {})
      .filter(([rawType]) => libraryKindForRawType(rawType) === kind.id)
      .reduce((total, [, count]) => total + Number(count), 0),
  })).filter((kind) => kind.count > 0), [libraryBrowseCounts]);
  const tagFacetOptions = useMemo(() => TAXONOMY_CONTRACT.dimensions.map((dimension) => {
    const selectedOutsideDimension = state.tags.filter((id) => TAXONOMY_TAG_BY_ID.get(id)?.dimension !== dimension.id);
    const contextualCounts = searchStarted
      ? ((bundle.runtime as any).getLibraryTagContext?.(state.query, {
          ...baseLibraryFilters,
          taxonomy_tag_groups: taxonomyTagGroups(selectedOutsideDimension),
        })?.tags || {})
      : libraryBrowseCounts.tags || {};
    const options = TAXONOMY_CONTRACT.tags
      .filter((tag) => tag.dimension === dimension.id)
      .map((tag) => ({
        aliases: tag.aliases,
        count: Number(contextualCounts[tag.id] || 0),
        label: tag.label,
        value: tag.id,
      }))
      .filter((tag) => tag.count > 0)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    return { ...dimension, options };
  }), [baseLibraryFilters, bundle.runtime, libraryBrowseCounts, searchStarted, state.query, state.tags]);

  const mapItems: LibraryMapItem[] = useMemo(() => state.viewMode !== "map" ? [] : rows.slice(0, 75).map((row: any) => ({
    id: row.document.id,
    kind: displayNameFor("object_type", row.document.object_type),
    label: row.identity,
    group: row.publication,
    destination: { view: "library-detail" as const, patch: { node: row.document.id } },
  })), [rows, state.viewMode]);

  const activeFilters = [
    state.filter && { key: "filter", label: catalogNames.get(state.filter) || state.filter },
    state.publisher && { key: "publisher", label: state.publisher },
    state.kind && { key: "kind", label: libraryKindLabel(state.kind) },
    state.area && { key: "area", label: AREA_PRESENTATIONS.find((area) => area.id === state.area)?.label || state.area },
    ...state.tags.flatMap((id) => {
      const tag = TAXONOMY_TAG_BY_ID.get(id);
      return tag ? [{ key: "tags" as const, label: tag.label, tagId: id }] : [];
    }),
    connectedOnly && { key: "connectedOnly", label: "Has connections" },
  ].filter(Boolean) as Array<{ key: keyof SearchState; label: string; tagId?: string }>;

  const clearFilters = () => onNavigate("search", {
    area: "",
    connectedOnly: "",
    filter: "",
    kind: "",
    publisher: "",
    tags: [],
  });
  const switchView = (viewMode: string) => {
    const scrollY = window.scrollY;
    onNavigate("search", { viewMode: viewMode === "map" ? "map" : "list" });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" })));
  };
  const renderFacets = (scope: "desktop" | "mobile") => (
    <div className="workspace-facet-controls" data-facet-set="publisher,kind,publication,area,tags,connections">
      <TypeaheadFacet
        id={`library-${scope}-publication`}
        label="Publication"
        onChange={(filter) => onNavigate("search", { filter })}
        options={runtimeCatalogs.map((catalog: any) => ({ label: catalog.name, value: catalog.id }))}
        value={state.filter}
      />
      <CheckboxFacet
        label="Content kind"
        onChange={(kind) => onNavigate("search", { kind })}
        options={kindCounts.map((kind) => ({ count: kind.count, label: kind.label, textLabel: kind.label, value: kind.id }))}
        value={state.kind}
      />
      <CheckboxFacet
        label="Area"
        onChange={(area) => onNavigate("search", { area })}
        options={areaCounts.map((area) => ({
          count: area.count,
          label: <BucketTag area={area.id}>{area.label}</BucketTag>,
          textLabel: area.label,
          value: area.id,
        }))}
        value={state.area}
      />
      <details className="workspace-advanced-facets">
        <summary>Advanced filters</summary>
        <TypeaheadFacet
          id={`library-${scope}-publisher`}
          label="Publisher"
          onChange={(publisher) => onNavigate("search", { publisher })}
          options={publishers.map((publisher) => ({ label: publisher, value: publisher }))}
          value={state.publisher}
        />
        {tagFacetOptions.map((dimension) => (
          <TagFacet
            key={dimension.id}
            label={dimension.label}
            onChange={(tags) => onNavigate("search", {
              tags: [
                ...state.tags.filter((id) => TAXONOMY_TAG_BY_ID.get(id)?.dimension !== dimension.id),
                ...tags,
              ].sort(),
            })}
            options={dimension.options}
            selected={state.tags.filter((id) => TAXONOMY_TAG_BY_ID.get(id)?.dimension === dimension.id)}
          />
        ))}
        <label className="workspace-boolean-facet">
          <input
            checked={connectedOnly}
            onChange={(event) => {
              onNavigate("search", { connectedOnly: event.target.checked ? "true" : "" });
              if (event.target.checked && !graphReady) onRequestFullGraph();
            }}
            type="checkbox"
          />
          <span>Has published connections</span>
        </label>
      </details>
      {activeFilters.length ? <button className="workspace-clear-filters" onClick={clearFilters} type="button">Clear all filters</button> : null}
    </div>
  );

  return (
    <WorkspaceTemplate
      activeFilters={activeFilters.length ? (
        <div aria-label="Active filters" className="active-filter-row">
          {activeFilters.map((filter) => (
            <button
              className="active-filter-chip"
              key={filter.tagId || filter.key}
              onClick={() => filter.tagId
                ? onNavigate("search", { tags: state.tags.filter((id) => id !== filter.tagId) })
                : onNavigate("search", { [filter.key]: "" })}
              type="button"
            >
              {filter.label}<IconX aria-hidden="true" size={13} />
            </button>
          ))}
          <button className="clear-filter-link" onClick={clearFilters} type="button">Clear all</button>
        </div>
      ) : null}
      compareControl={(
        <>
          <Button
            aria-pressed={compareMode}
            onClick={() => {
              setCompareMode((value) => !value);
              setSelectedRecords([]);
              if (state.viewMode === "map") switchView("list");
            }}
            type="button"
            variant="secondary"
          >
            <IconGitCompare aria-hidden="true" size={17} />Compare
          </Button>
          {compareMode && selectedRecords.length >= 2 ? (
            <AppLink onNavigate={onNavigate} patch={{ crosswalk: "relationships", items: selectedRecords.join(",") }} variant="primary" view="matrix">
              Compare {selectedRecords.length}
            </AppLink>
          ) : null}
        </>
      )}
      facetLabel="Library filters"
      onClearQuery={() => {
        setQueryDraft("");
        onNavigate("search", { query: "" });
      }}
      onQueryDraftChange={setQueryDraft}
      onSearch={() => {
        onNavigate("search", { query: queryDraft.trim() });
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            document.getElementById("library-results")?.focus();
          });
        });
      }}
      onSortChange={(sort) => onNavigate("search", { sort })}
      onViewChange={switchView}
      purpose={SITE_COPY.routes.library.purpose}
      queryDraft={queryDraft}
      renderFacets={renderFacets}
      resultCountLabel={resultContext.result_count > rows.length
        ? `Showing ${rows.length.toLocaleString()} of ${resultContext.result_count.toLocaleString()} results`
        : `${resultContext.result_count.toLocaleString()} result${resultContext.result_count === 1 ? "" : "s"}`}
      resultsId="library-results"
      searchLabel="Filter results by ID, title, or topic"
      searchPlaceholder={SITE_COPY.product.searchPlaceholder}
      showResultBar={searchStarted}
      sortLabel="Sort Library results"
      sortOptions={[
        { label: "Relevance", value: "relevance" },
        { label: "Identifier", value: "identifier" },
        { label: "Publication", value: "publication" },
        { label: "Title", value: "title" },
      ]}
      sortValue={state.sort || "relevance"}
      title="Library"
      viewLabel="Library view"
      viewOptions={[
        { icon: <IconList aria-hidden="true" size={16} />, label: "List", value: "list" },
        { icon: <IconMap aria-hidden="true" size={16} />, label: "Map", value: "map" },
      ]}
      viewValue={state.viewMode}
    >
      {!searchStarted ? (
        <section aria-labelledby="library-browse-heading" className="workspace-browse-state" data-browse-state="library">
          <h2 id="library-browse-heading">Browse the Library</h2>
          <section aria-labelledby="top-publications-heading">
            <h3 id="top-publications-heading">Top publications</h3>
            <div className="workspace-browse-grid">
              {topCatalogs.map((catalog: any) => (
                <button className="workspace-browse-card" key={catalog.id} onClick={() => onNavigate("catalog-detail", { catalog: catalog.id })} type="button">
                  <strong>{catalog.name}</strong>
                  <span>{catalog.publisher}</span>
                  <small>{catalog.leaf_record_count.toLocaleString()} records</small>
                </button>
              ))}
            </div>
          </section>
          <section aria-labelledby="browse-area-heading">
            <h3 id="browse-area-heading">Browse by area</h3>
            <div className="workspace-area-grid">
              {areaCounts.map((area) => (
                <button className="workspace-area-card" key={area.id} onClick={() => onNavigate("search", { area: area.id })} type="button">
                  <BucketTag area={area.id}>{area.label}</BucketTag>
                  <small>{area.count.toLocaleString()} records</small>
                </button>
              ))}
            </div>
          </section>
          <section aria-labelledby="browse-kind-heading">
            <h3 id="browse-kind-heading">Content kinds</h3>
            <div className="workspace-kind-list">
              {kindCounts.map((kind) => (
                <button key={kind.id} onClick={() => onNavigate("search", { kind: kind.id })} type="button">
                  <span>{kind.label}</span><small>{kind.count.toLocaleString()}</small>
                </button>
              ))}
            </div>
          </section>
        </section>
      ) : state.viewMode === "map" ? (
        <LibraryAtlasMap items={mapItems} onNavigate={onNavigate} />
      ) : (
        <ul aria-busy={visibleCount > 0 && !detailsReady} aria-label="Search results" className="workspace-result-list" ref={resultsRef} tabIndex={-1}>
          {connectedOnly && !graphReady ? <li className="notice-inline" role="status">Loading connection data for this filter…</li> : null}
          {rows.slice(0, visibleCount).map((row: any) => {
            const recordType = displayNameFor("object_type", row.document.object_type);
            const selected = selectedRecords.includes(row.document.item_id);
            return (
              <li key={row.document.id}>
                <article className="workspace-result-row" data-published-connection-count={row.relationshipCount} data-published-mapping-count={row.crossFrameworkCount} data-record-id={row.document.id} data-result-class="published-record">
                  {compareMode ? (
                    <label className="workspace-result-select">
                      <input
                        aria-label={`Select ${row.accessibleName} for comparison`}
                        checked={selected}
                        onChange={() => setSelectedRecords((items) => selected ? items.filter((id) => id !== row.document.item_id) : [...items, row.document.item_id])}
                        type="checkbox"
                      />
                    </label>
                  ) : null}
                  <AppLink
                    aria-label={`Open ${row.accessibleName}`}
                    className="workspace-result-row__link"
                    onNavigate={onNavigate}
                    patch={{ node: row.document.id }}
                    view="library-detail"
                  >
                    <div className="workspace-result-row__meta">
                      <span className="workspace-kind-tag">{recordType}</span>
                      <span>{row.publication}</span>
                    </div>
                    <h3><MarkedSearchText query={state.query} text={row.identity} /></h3>
                    {row.title ? <p className="workspace-result-row__official-name"><MarkedSearchText query={state.query} text={row.title} /></p> : null}
                    {detailsReady ? <p className="workspace-result-row__snippet"><MarkedSearchText query={state.query} text={searchPreviewText(row.document)} /></p> : null}
                    {detailsReady ? (
                      <div className="workspace-result-row__signals">
                        <span>{connectionSummary(row.crossFrameworkCount, row.crossFrameworkCatalogCount)}</span>
                        <BucketTag area={row.area.id}>{row.area.label}</BucketTag>
                        {row.lowCoverage ? <span className="workspace-coverage-note">Limited coverage</span> : null}
                      </div>
                    ) : null}
                  </AppLink>
                </article>
              </li>
            );
          })}
          {visibleCount > 0 && rows.length > visibleCount ? (
            <li className="workspace-result-list__action"><Button onClick={() => setVisibleCount((count) => count + 25)} type="button" variant="secondary">Show 25 more</Button></li>
          ) : null}
          {rows.length === 0 ? (
            <li><section className="empty-state"><h2>{hasFilters ? "Nothing matches these filters." : "No records found."}</h2><p>{hasFilters ? "Clear one and try again." : "Try another identifier or keyword."}</p><Button onClick={() => onNavigate("search", { area: "", connectedOnly: "", filter: "", kind: "", publisher: "", query: "", sort: "relevance", viewMode: "list" })} type="button" variant="primary">{hasFilters ? "Clear filters" : "Clear search"}</Button></section></li>
          ) : null}
        </ul>
      )}
    </WorkspaceTemplate>
  );
}
