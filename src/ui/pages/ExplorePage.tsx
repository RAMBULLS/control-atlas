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
import { AtlasTag } from "../components/AtlasTag";
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
import { selectLibraryResultTags } from "../lib/libraryResultTags";
import { queryDiscoveryIndex } from "../../shared/discovery-index.mjs";
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

const PRIMARY_TAXONOMY_DIMENSION_IDS = [
  "asset_class",
  "domain",
  "vendor_brand",
  "program",
] as const;

// The tray keeps its own label copy so a selected record stays legible after
// the user changes the query or filters and its row leaves the result list.
type SelectedRecord = {
  id: string;
  identity: string;
  publication: string;
};

// Compare's "item-mapping" mode needs intent + source + items + target; a link
// carrying only `items` lands in Frameworks mode with empty selectors, which is
// what made Library Compare a dead end. Derive the whole handoff from the
// selection: the first catalog is the source, the second is the target, and the
// items are the selected records belonging to the source catalog.
function compareHandoffFor(selected: SelectedRecord[]) {
  const catalogs: string[] = [];
  for (const entry of selected) {
    const catalog = entry.id.split(":")[0];
    if (catalog && !catalogs.includes(catalog)) catalogs.push(catalog);
  }
  const source = catalogs[0] || "";
  const target = catalogs[1] || "";
  const items = selected
    .filter((entry) => entry.id.startsWith(`${source}:`))
    .map((entry) => entry.id)
    .join(",");
  return {
    catalogs,
    patch: {
      crosswalk: "relationships",
      intent: "item-mapping",
      source,
      target,
      items,
      // Only auto-run when the pair is fully determined. With one catalog there
      // is no target yet, so the user lands on the target step instead of on an
      // unrunnable "results" state.
      compareRun: target ? "true" : "",
    },
  };
}

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

/** Below this many results the list is scannable and the kind band is noise. */
const GROUPING_THRESHOLD = 20;

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
  // Keyed by the qualified `catalog:item` record id, not the bare item id:
  // the same identifier exists in several catalogs (AC-2 is both an SP 800-53
  // control and an SP 800-53A assessment procedure), so a bare id collapsed
  // those rows into one selection and the comparison could never reach two.
  const [selectedRecords, setSelectedRecords] = useState<SelectedRecord[]>([]);
  const connectedOnly = state.connectedOnly === "true";
  const hasFilters = Boolean(state.filter || state.publisher || state.kind || state.area || state.tags.length || connectedOnly);
  const searchStarted = Boolean(state.query.trim() || hasFilters);
  // Tag-scoped results reach beyond publications, so the Library's own empty
  // state must not report "nothing" while tagged resources and templates exist.
  const crossContentEntries = useMemo(
    () => (state.tags.length > 0
      ? queryDiscoveryIndex(state.tags).filter((entry: any) => entry.content_type !== "record")
      : []),
    [state.tags],
  );
  const crossContentCount = crossContentEntries.length;
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

  /**
   * The kinds this query actually found, largest first. Corpus-wide counts
   * beside a search claimed thousands of requirements while the query had
   * returned a few hundred configuration rules.
   */
  const kindContext = useMemo(() => {
    if (!searchStarted) return null;
    // Counted without the kind filter, so choosing one narrows the results
    // without collapsing the band that offers the alternatives. Every other
    // active filter still applies.
    return (bundle.runtime as any).getLibraryKindContext?.(state.query, {
      ...baseLibraryFilters,
      object_types: [],
      taxonomy_tag_groups: taxonomyTagGroups(state.tags),
    }) || null;
  }, [baseLibraryFilters, bundle.runtime, searchStarted, state.query, state.tags]);

  /**
   * Recovery for a search that found nothing. Every option is counted against the
   * real index, so a suggestion is offered only when it would return records.
   */
  const emptyRecovery = useMemo(() => {
    if (!searchStarted || documents.length > 0) return null;
    const count = (query: string, filters: Record<string, unknown>) =>
      Number((bundle.runtime as any).getLibraryTagContext?.(query, filters)?.result_count || 0);
    const filters = { ...baseLibraryFilters, taxonomy_tag_groups: taxonomyTagGroups(state.tags) };
    const words = state.query.trim().split(/\s+/).filter(Boolean);
    const withoutWord = words.length < 2 ? [] : words
      .map((word, index) => {
        const query = words.filter((_, at) => at !== index).join(" ");
        return { word, query, count: count(query, filters) };
      })
      .filter((option) => option.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const withoutFilters = hasFilters && state.query.trim() ? count(state.query, {}) : 0;
    return { withoutWord, withoutFilters };
  }, [baseLibraryFilters, bundle.runtime, documents.length, hasFilters, searchStarted, state.query, state.tags]);

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
      const resultTags = selectLibraryResultTags({
        publication,
        publisher,
        taxonomyTags: document.taxonomy_tags || [],
        title: String(document.title || ""),
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
        resultTags,
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
  const kindCounts = useMemo(() => {
    const scoped = kindContext?.object_types as Record<string, number> | undefined;
    const corpus = (libraryBrowseCounts.object_types || {}) as Record<string, number>;
    const totalFor = (counts: Record<string, number>, kindId: string) =>
      Object.entries(counts)
        .filter(([rawType]) => libraryKindForRawType(rawType) === kindId)
        .reduce((total, [, count]) => total + Number(count), 0);
    // The set of kinds is fixed by the corpus so a filter never vanishes while
    // someone is typing; only the counts follow the query. Corpus-wide counts
    // beside a search were the misleading part — a kind reading zero for this
    // query is useful information, a kind that disappears is not.
    return LIBRARY_KINDS.filter((kind) => totalFor(corpus, kind.id) > 0).map((kind) => ({
      ...kind,
      count: scoped ? totalFor(scoped, kind.id) : totalFor(corpus, kind.id),
    }));
  }, [kindContext, libraryBrowseCounts]);
  /**
   * Shown above the results when a query spans more than one kind. Ordered by
   * how many of each the query found, so the dominant kind is named rather than
   * left to be inferred from scrolling.
   */
  const kindGroups = useMemo(() => {
    if (!kindContext || kindContext.result_count < GROUPING_THRESHOLD) return [];
    // A band chip reading zero is a dead end, so the band shows only kinds this
    // query actually found. The facet rail keeps the full, stable list.
    return kindCounts
      .filter((kind) => kind.count > 0)
      .sort((left, right) => right.count - left.count);
  }, [kindContext, kindCounts]);

  const tagFacetOptions = useMemo(
    () =>
      TAXONOMY_CONTRACT.dimensions
        .map((dimension) => {
          const selectedOutsideDimension = state.tags.filter(
            (id) => TAXONOMY_TAG_BY_ID.get(id)?.dimension !== dimension.id,
          );
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
            .sort(
              (left, right) =>
                right.count - left.count || left.label.localeCompare(right.label),
            );
          return { ...dimension, options };
        })
        .filter((dimension) => dimension.options.length > 0),
    [
      baseLibraryFilters,
      bundle.runtime,
      libraryBrowseCounts,
      searchStarted,
      state.query,
      state.tags,
    ],
  );
  const primaryTagFacetOptions = PRIMARY_TAXONOMY_DIMENSION_IDS.flatMap((dimensionId) => {
    const dimension = tagFacetOptions.find((candidate) => candidate.id === dimensionId);
    return dimension ? [dimension] : [];
  });
  const advancedTagFacetOptions = tagFacetOptions.filter(
    (dimension) => !PRIMARY_TAXONOMY_DIMENSION_IDS.includes(
      dimension.id as (typeof PRIMARY_TAXONOMY_DIMENSION_IDS)[number],
    ),
  );

  const mapItems: LibraryMapItem[] = useMemo(() => state.viewMode !== "map" ? [] : rows.slice(0, 75).map((row: any) => ({
    id: row.document.id,
    kind: displayNameFor("object_type", row.document.object_type),
    label: row.identity,
    group: row.publication,
    destination: { view: "library-detail" as const, patch: { node: row.document.id } },
  })), [rows, state.viewMode]);
  const visibleResultCount = Math.min(visibleCount, rows.length);
  // The cap is already stated at the foot of the list, but a reader who never
  // scrolls 100 rows only ever sees this header. Naming the way to the rest
  // here means the count never reads as "these are all of them".
  const resultCountLabel = resultContext.result_count > rows.length
    ? `${resultContext.result_count.toLocaleString()} matches · showing ${visibleResultCount.toLocaleString()} of the ${rows.length.toLocaleString()} most relevant · narrow with filters to reach the rest`
    : visibleResultCount < rows.length
      ? `${rows.length.toLocaleString()} results · showing ${visibleResultCount.toLocaleString()}`
      : `${rows.length.toLocaleString()} result${rows.length === 1 ? "" : "s"}`;

  const activeFilters = [
    state.filter && { key: "filter", label: catalogNames.get(state.filter) || state.filter },
    state.publisher && { key: "publisher", label: state.publisher },
    state.kind && { key: "kind", label: libraryKindLabel(state.kind) },
    state.area && { key: "area", label: AREA_PRESENTATIONS.find((area) => area.id === state.area)?.label || state.area },
    ...state.tags.flatMap((id) => {
      const tag = TAXONOMY_TAG_BY_ID.get(id);
      return tag ? [{ key: "tags" as const, label: tag.label, tagId: id }] : [];
    }),
    connectedOnly && { key: "connectedOnly", label: "Has published connections" },
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
  const advancedFiltersActive = Boolean(
    state.publisher || connectedOnly || state.tags.some((tagId) => {
      const dimensionId = TAXONOMY_TAG_BY_ID.get(tagId)?.dimension;
      return advancedTagFacetOptions.some((dimension) => dimension.id === dimensionId);
    }),
  );
  const renderTagFacet = (
    dimension: (typeof tagFacetOptions)[number],
    compact = false,
  ) => (
    <TagFacet
      compact={compact}
      dimensionId={dimension.id}
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
  );
  const renderFacets = (scope: "desktop" | "mobile") => (
    <div className="workspace-facet-controls" data-facet-set="publication,kind,area,asset_class,domain,vendor_brand,program">
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
      <div aria-label="Primary taxonomy filters" className="workspace-primary-taxonomy-facets" role="group">
        {primaryTagFacetOptions.map((dimension) => renderTagFacet(dimension, true))}
      </div>
      <details
        className="workspace-advanced-facets"
        data-advanced-facet-set="publisher,technology,product,framework,organization,environment,connections"
        open={advancedFiltersActive ? true : undefined}
      >
        <summary>Advanced filters</summary>
        <div className="workspace-advanced-facet-controls">
          <TypeaheadFacet
            id={`library-${scope}-publisher`}
            label="Publisher"
            onChange={(publisher) => onNavigate("search", { publisher })}
            options={publishers.map((publisher) => ({ label: publisher, value: publisher }))}
            value={state.publisher}
          />
          {advancedTagFacetOptions.map((dimension) => renderTagFacet(dimension))}
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
        </div>
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
              aria-label={`Remove ${filter.label} filter`}
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
      mobilePrimaryFilters={primaryTagFacetOptions.map((dimension) => renderTagFacet(dimension, true))}
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
        </>
      )}
      compareTray={compareMode ? (() => {
        const handoff = compareHandoffFor(selectedRecords);
        const [sourceCatalog, targetCatalog] = handoff.catalogs;
        const hint = selectedRecords.length === 0
          ? "Select records to compare. Published mappings run between two publications."
          : !targetCatalog
            ? `All from ${catalogDisplayNameFor(sourceCatalog)}. Add a record from another publication, or choose a target on the next step.`
            : handoff.catalogs.length > 2
              ? `Compares ${catalogDisplayNameFor(sourceCatalog)} to ${catalogDisplayNameFor(targetCatalog)}. Records from your other selected publications are not included.`
              : `Compares ${catalogDisplayNameFor(sourceCatalog)} to ${catalogDisplayNameFor(targetCatalog)}.`;
        return (
        <div aria-label="Comparison selection" className="compare-tray" role="region">
          <div className="compare-tray__status">
            <strong>{selectedRecords.length} selected</strong>
            <span className="compare-tray__hint">{hint}</span>
          </div>
          {selectedRecords.length > 0 ? (
            <ul className="compare-tray__items">
              {selectedRecords.map((entry) => (
                <li key={entry.id}>
                  <span className="compare-tray__chip">
                    <span className="compare-tray__chip-identity">{entry.identity}</span>
                    <span className="compare-tray__chip-publication">{entry.publication}</span>
                    <button
                      aria-label={`Remove ${entry.identity} from the comparison`}
                      className="compare-tray__remove"
                      onClick={() => setSelectedRecords((items) => items.filter((item) => item.id !== entry.id))}
                      type="button"
                    >
                      <IconX aria-hidden="true" size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="compare-tray__actions">
            {selectedRecords.length > 0 ? (
              <Button onClick={() => setSelectedRecords([])} type="button" variant="secondary">
                Clear
              </Button>
            ) : null}
            {selectedRecords.length >= 1 ? (
              <AppLink
                onNavigate={onNavigate}
                patch={handoff.patch}
                variant="primary"
                view="matrix"
              >
                Compare {selectedRecords.length}
              </AppLink>
            ) : null}
          </div>
        </div>
        );
      })() : null}
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
      resultCountLabel={resultCountLabel}
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
        <LibraryAtlasMap
          description={rows.length > mapItems.length
            ? `Showing the ${mapItems.length.toLocaleString()} most relevant loaded records, grouped by publication. Refine the query or filters to change this map.`
            : "The current Library query is grouped by publication. Open any record to see its details."}
          heading={rows.length > mapItems.length
            ? `${mapItems.length.toLocaleString()} of ${rows.length.toLocaleString()} loaded records mapped`
            : undefined}
          items={mapItems}
          onNavigate={onNavigate}
        />
      ) : (
        <>
        {kindGroups.length > 1 ? (
          <nav aria-label="Result kinds" className="workspace-result-groups" data-group-count={kindGroups.length}>
            <button
              aria-pressed={!state.kind}
              className="workspace-result-group"
              onClick={() => onNavigate("search", { kind: "" })}
              type="button"
            >
              All<small>{(kindContext?.result_count ?? resultContext.result_count).toLocaleString()}</small>
            </button>
            {kindGroups.map((kind) => (
              <button
                aria-pressed={state.kind === kind.id}
                className="workspace-result-group"
                key={kind.id}
                onClick={() => onNavigate("search", { kind: state.kind === kind.id ? "" : kind.id })}
                type="button"
              >
                {kind.label}<small>{kind.count.toLocaleString()}</small>
              </button>
            ))}
          </nav>
        ) : null}
        {/* Each result card titles itself with an h3. Without this heading the
            nearest one above was the page h1, so a screen-reader user paging by
            heading level met up to 100 cards nested under nothing. */}
        <h2 className="visually-hidden" id="workspace-results-heading">Search results</h2>
        <ul aria-busy={visibleCount > 0 && !detailsReady} aria-labelledby="workspace-results-heading" className="workspace-result-list" ref={resultsRef} tabIndex={-1}>
          {connectedOnly && !graphReady ? <li className="notice-inline" role="status">Loading connection data for this filter…</li> : null}
          {rows.slice(0, visibleCount).map((row: any) => {
            const recordType = displayNameFor("object_type", row.document.object_type);
            const selected = selectedRecords.some((entry) => entry.id === row.document.id);
            return (
              <li key={row.document.id}>
                <article className="workspace-result-row" data-published-connection-count={row.relationshipCount} data-published-mapping-count={row.crossFrameworkCount} data-record-id={row.document.id} data-result-class="published-record">
                  {compareMode ? (
                    <label className="workspace-result-select">
                      <input
                        aria-label={`Select ${row.accessibleName} for comparison`}
                        checked={selected}
                        onChange={() => setSelectedRecords((items) => selected
                          ? items.filter((entry) => entry.id !== row.document.id)
                          : [...items, { id: row.document.id, identity: row.identity, publication: row.publication }])}
                        type="checkbox"
                      />
                    </label>
                  ) : null}
                  <div className="workspace-result-row__body">
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
                      {detailsReady && searchPreviewText(row.document) ? <p className="workspace-result-row__snippet"><MarkedSearchText query={state.query} text={searchPreviewText(row.document)} /></p> : null}
                    </AppLink>
                    {detailsReady ? (
                      <div className="workspace-result-row__signals">
                        {connectionSummary(row.crossFrameworkCount, row.crossFrameworkCatalogCount) ? <span>{connectionSummary(row.crossFrameworkCount, row.crossFrameworkCatalogCount)}</span> : null}
                        <BucketTag area={row.area.id}>{row.area.label}</BucketTag>
                        {row.resultTags.length > 0 ? (
                          <span className="workspace-result-row__taxonomy">
                            {row.resultTags.map((tag: any) => (
                              <AtlasTag
                                ariaLabel={`Filter by ${tag.label}`}
                                key={tag.id}
                                onNavigate={onNavigate}
                                patch={{
                                  ...state,
                                  tags: state.tags.includes(tag.id)
                                    ? state.tags.filter((id) => id !== tag.id)
                                    : [...state.tags, tag.id],
                                }}
                                size="sm"
                                tagId={tag.id}
                              />
                            ))}
                          </span>
                        ) : null}
                        {row.lowCoverage ? <span className="workspace-coverage-note">Limited coverage</span> : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
          {visibleCount > 0 && rows.length > visibleCount ? (
            <li className="workspace-result-list__action"><Button onClick={() => setVisibleCount((count) => count + 25)} type="button" variant="secondary">Show 25 more</Button></li>
          ) : null}
          {visibleCount >= rows.length && resultContext.result_count > rows.length ? (
            <li className="workspace-result-list__scope-note">
              The {rows.length.toLocaleString()} most relevant matches are loaded. Narrow the query or filters to reach the remaining {(resultContext.result_count - rows.length).toLocaleString()}.
            </li>
          ) : null}
          {rows.length === 0 ? (
            <li>
              <section className="empty-state">
                {crossContentCount > 0 ? (
                  <>
                    <h2>No publications carry this tag yet.</h2>
                    <p>
                      {crossContentCount === 1
                        ? "One related item below is tagged this way."
                        : `${crossContentCount} related items below are tagged this way.`}
                    </p>
                  </>
                ) : (
                  <>
                    <h2>{hasFilters ? "Nothing matches these filters." : "No records found."}</h2>
                    <p>{hasFilters ? "Clear one and try again." : "Every word you type must appear in a record. Try another identifier or keyword."}</p>
                    {emptyRecovery && (emptyRecovery.withoutWord.length > 0 || emptyRecovery.withoutFilters > 0) ? (
                      <ul className="empty-state__options">
                        {emptyRecovery.withoutWord.map((option) => (
                          <li key={option.query}>
                            <button className="clear-filter-link" onClick={() => onNavigate("search", { query: option.query })} type="button">
                              Try without “{option.word}” · {option.count.toLocaleString()} {option.count === 1 ? "result" : "results"}
                            </button>
                          </li>
                        ))}
                        {emptyRecovery.withoutFilters > 0 ? (
                          <li>Without the filters, this search has {emptyRecovery.withoutFilters.toLocaleString()} {emptyRecovery.withoutFilters === 1 ? "result" : "results"}.</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </>
                )}
                <Button onClick={() => onNavigate("search", { area: "", connectedOnly: "", filter: "", kind: "", publisher: "", query: "", sort: "relevance", tags: [], viewMode: "list" })} type="button" variant="primary">{hasFilters ? "Clear filters" : "Clear search"}</Button>
              </section>
            </li>
          ) : null}
        </ul>
        {state.tags.length > 0 ? (() => {
          const crossContent = crossContentEntries;
          const groups = [
            { type: "catalog", label: "Catalogs" },
            { type: "guide", label: "Guides" },
            { type: "resource", label: "Resources" },
            { type: "template", label: "Templates" },
          ].map((group) => ({
            ...group,
            entries: crossContent.filter((entry: any) => entry.content_type === group.type),
          })).filter((group) => group.entries.length > 0);
          if (groups.length === 0) return null;
          return (
            <section className="cross-content-discovery" aria-label="Related content across Control Atlas">
              <h2>Also in Control Atlas</h2>
              {groups.map((group) => (
                <div key={group.type}>
                  <h3>{group.label} ({group.entries.length})</h3>
                  <ul className="cross-content-list">
                    {group.entries.slice(0, 8).map((entry: any) => (
                      <li key={entry.content_id}>
                        {entry.content_type === "resource" ? (
                          <AppLink onNavigate={onNavigate} patch={{ id: entry.content_id }} view="commons-detail">{entry.title}</AppLink>
                        ) : entry.content_type === "template" ? (
                          <AppLink onNavigate={onNavigate} patch={{ templateType: entry.template_name, buildSection: "documents" }} view="templates">{entry.title}</AppLink>
                        ) : entry.content_type === "catalog" ? (
                          <AppLink onNavigate={onNavigate} patch={{ catalog: entry.catalog_id }} view="catalog-detail">{entry.title}</AppLink>
                        ) : (
                          <AppLink onNavigate={onNavigate} patch={{ pattern: entry.content_id.replace(/^guide:/, "") }} view="patterns">{entry.title}</AppLink>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })() : null}
        </>
      )}
    </WorkspaceTemplate>
  );
}
