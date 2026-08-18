import {
  IconArrowRight,
  IconFlag,
  IconGitCompare,
  IconList,
  IconMap,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { useEffect, useMemo, useState } from "react";

import "../../../styles/resources.css";
import { AppLink } from "../components/AppLink";
import { CollectionIcon } from "../components/CollectionIcon";
import { LibraryAtlasMap, type LibraryMapItem } from "../components/LibraryAtlasMap";
import { ResourceTypeIcon } from "../components/ResourceTypeIcon";
import {
  CheckboxFacet,
  TypeaheadFacet,
  WorkspaceTemplate,
} from "../components/WorkspaceTemplate";
import { Button } from "../components/lsm";
import type { CommonsCollection, CommonsResource } from "../lib/commonsTypes";
import { resourceAccessLabel, resourceFieldLabel, resourceTypeLabel } from "../lib/resourceBrands.mjs";
import {
  filterDirectoryResources,
  searchDirectoryResources,
  sortDirectoryResources,
} from "../lib/resourcesDirectory.mjs";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

type CommonsState = Extract<ViewState, { view: "commons" }>;

const EMPTY_STATE: CommonsState = {
  view: "commons",
  query: "",
  lane: "all",
  framework: "",
  lifecycle: "",
  audience: "",
  accessType: "",
  resourceType: "",
  category: "",
  collection: "",
  owner: "",
  costType: "",
  sort: "relevance",
  showAll: "",
  viewMode: "list",
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function CommonsPage(props: {
  bundle: RuntimeBundle | null;
  viewState: ViewState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { bundle, viewState, onNavigate } = props;
  const state = viewState.view === "commons" ? viewState : EMPTY_STATE;
  const [queryDraft, setQueryDraft] = useState(state.query);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const directoryAvailable = Boolean(bundle?.commonsDataset);
  const resources = (bundle?.commonsDataset?.resources || []) as CommonsResource[];
  const collections = (bundle?.commonsDataset?.collections || []) as CommonsCollection[];
  const update = (patch: Partial<CommonsState>) => onNavigate("commons", { ...state, ...patch });

  useEffect(() => setQueryDraft(state.query), [state.query]);

  const filtered = useMemo(() => {
    const eligible = filterDirectoryResources(resources, {
      collection: state.collection,
      owner: state.owner,
      resourceType: state.resourceType,
    });
    return sortDirectoryResources(searchDirectoryResources(eligible, state.query), state.sort);
  }, [resources, state.collection, state.owner, state.query, state.resourceType, state.sort]);

  const resourceTypes = useMemo(() => unique(resources.map((resource) => resource.resourceType)), [resources]);
  const owners = useMemo(() => unique(resources.map((resource) => resource.publisher)), [resources]);
  const activeFilters = [
    state.collection && { key: "collection", label: collections.find((collection) => collection.id === state.collection)?.title || state.collection },
    state.resourceType && { key: "resourceType", label: resourceTypeLabel(state.resourceType) },
    state.owner && { key: "owner", label: state.owner },
  ].filter(Boolean) as Array<{ key: keyof CommonsState; label: string }>;
  const resultsVisible = Boolean(state.showAll || state.query.trim() || activeFilters.length);
  const selectedResources = resources.filter((resource) => selectedResourceIds.includes(resource.id));
  const collectionTitles = useMemo(() => new Map(collections.map((collection) => [collection.id, collection.title])), [collections]);
  const mapItems: LibraryMapItem[] = useMemo(() => state.viewMode !== "map" ? [] : filtered.map((resource) => ({
    id: resource.id,
    kind: resourceTypeLabel(resource.resourceType),
    label: resource.name,
    group: resource.featuredCollections?.map((id) => collectionTitles.get(id)).find(Boolean) || resource.publisher,
    destination: {
      view: "commons-detail" as const,
      patch: {
        view: "commons-detail" as const,
        id: resource.id,
        query: state.query,
        resourceType: state.resourceType,
        collection: state.collection,
        owner: state.owner,
        sort: state.sort,
        showAll: state.showAll,
        viewMode: state.viewMode,
      },
    },
  })), [collectionTitles, filtered, state.collection, state.owner, state.query, state.resourceType, state.showAll, state.sort, state.viewMode]);

  const reset = () => {
    setQueryDraft("");
    setCompareMode(false);
    setSelectedResourceIds([]);
    update({ ...EMPTY_STATE });
  };
  const switchView = (viewMode: string) => update({ viewMode: viewMode === "map" ? "map" : "list" });
  const renderFacets = (scope: "desktop" | "mobile") => (
    <div className="workspace-facet-controls" data-facet-set="collection,type,owner">
      <CheckboxFacet
        label="Collection"
        onChange={(collection) => update({ collection, showAll: collection ? "true" : state.showAll })}
        options={collections.map((collection) => ({
          count: collection.resourceIds.length,
          label: collection.title,
          textLabel: collection.title,
          value: collection.id,
        }))}
        value={state.collection}
      />
      <CheckboxFacet
        label="Type"
        onChange={(resourceType) => update({ resourceType })}
        options={resourceTypes.map((resourceType) => ({
          count: resources.filter((resource) => resource.resourceType === resourceType).length,
          label: resourceTypeLabel(resourceType),
          textLabel: resourceTypeLabel(resourceType),
          value: resourceType,
        }))}
        value={state.resourceType}
      />
      <TypeaheadFacet
        id={`resources-${scope}-owner`}
        label="Owner"
        onChange={(owner) => update({ owner })}
        options={owners.map((owner) => ({ label: owner, value: owner }))}
        value={state.owner}
      />
      {activeFilters.length ? <button className="workspace-clear-filters" onClick={() => update({ collection: "", owner: "", resourceType: "" })} type="button">Clear all filters</button> : null}
    </div>
  );

  if (!directoryAvailable) {
    return (
      <section className="workspace-template">
        <header className="page-header" data-route-primary-header="true"><div className="page-header-title"><h1>Resources</h1></div></header>
        <section className="empty-state" data-control-results id="resources-results">
          <h2>Resources did not load.</h2>
          <p>Reload the page to try again.</p>
          <Button onClick={() => window.location.reload()} type="button" variant="secondary">Reload page</Button>
        </section>
      </section>
    );
  }

  return (
    <WorkspaceTemplate
      activeFilters={activeFilters.length ? (
        <div aria-label="Active filters" className="active-filter-row">
          {activeFilters.map((filter) => (
            <button className="active-filter-chip" key={filter.key} onClick={() => update({ [filter.key]: "" })} type="button">
              {filter.label}<IconX aria-hidden="true" size={13} />
            </button>
          ))}
          <button className="clear-filter-link" onClick={() => update({ collection: "", owner: "", resourceType: "" })} type="button">Clear all</button>
        </div>
      ) : null}
      compareControl={(
        <button
          aria-pressed={compareMode}
          className={`workspace-compare-toggle ${compareMode ? "is-active" : ""}`}
          onClick={() => {
            setCompareMode((value) => !value);
            setSelectedResourceIds([]);
            if (state.viewMode === "map") switchView("list");
          }}
          type="button"
        >
          <IconGitCompare aria-hidden="true" size={15} />
          <span>{compareMode ? `Compare (${selectedResourceIds.length})` : "Compare"}</span>
        </button>
      )}
      facetLabel="Resource filters"
      onClearQuery={() => {
        setQueryDraft("");
        update({ query: "", showAll: activeFilters.length ? state.showAll : "" });
      }}
      onQueryDraftChange={setQueryDraft}
      onSearch={() => update({ query: queryDraft.trim(), showAll: queryDraft.trim() ? "true" : state.showAll })}
      onSortChange={(sort) => update({ sort })}
      onViewChange={switchView}
      purpose={SITE_COPY.routes.resources.purpose}
      queryDraft={queryDraft}
      renderFacets={renderFacets}
      resultCountLabel={`${filtered.length.toLocaleString()} result${filtered.length === 1 ? "" : "s"}`}
      resultsId="resources-results"
      searchLabel="Find resources"
      searchPlaceholder="Search by name, topic, or owner"
      showResultBar={resultsVisible}
      sortLabel="Sort Resource results"
      sortOptions={[
        { label: "Relevance", value: "relevance" },
        { label: "Name", value: "name" },
        { label: "Recently checked", value: "checked" },
      ]}
      sortValue={state.sort}
      title="Resources"
      viewLabel="Resources view"
      viewOptions={[
        { icon: <IconList aria-hidden="true" size={16} />, label: "List", value: "list" },
        { icon: <IconMap aria-hidden="true" size={16} />, label: "Map", value: "map" },
      ]}
      viewValue={state.viewMode}
    >
      {!resultsVisible ? (
        <section aria-labelledby="resource-collections-heading" className="workspace-browse-state" data-browse-state="resources">
          <div className="workspace-browse-heading">
            <div><h2 id="resource-collections-heading">Browse by Collection</h2></div>
            <button onClick={() => update({ showAll: "true" })} type="button">Browse all {resources.length} resources <IconArrowRight aria-hidden="true" size={16} /></button>
          </div>
          <div className="workspace-browse-grid">
            {collections.map((collection) => (
              <button className="workspace-browse-card workspace-browse-card--collection" key={collection.id} onClick={() => update({ collection: collection.id, showAll: "true" })} type="button">
                <CollectionIcon collectionId={collection.id} />
                <strong>{collection.title}</strong>
                <span>{collection.summary}</span>
                <small>{collection.resourceIds.length} resources</small>
              </button>
            ))}
          </div>
        </section>
      ) : state.viewMode === "map" ? (
        <LibraryAtlasMap
          ariaLabel="Map of Resource results"
          description="Results are grouped by collection or owner."
          emptyMessage="No resources match this view."
          eyebrow="Resource map"
          groupOverflowLabel="group"
          items={mapItems}
          onNavigate={onNavigate}
          overviewAction={null}
        />
      ) : filtered.length ? (
        <>
          {compareMode && selectedResources.length >= 2 ? (
            <section aria-labelledby="resource-comparison-heading" className="resource-comparison">
              <h2 id="resource-comparison-heading">Selected resources</h2>
              <div className="resource-comparison__scroll">
                <table>
                  <thead><tr><th scope="col">Field</th>{selectedResources.map((resource) => <th key={resource.id} scope="col">{resource.name}</th>)}</tr></thead>
                  <tbody>
                    <tr><th scope="row">Type</th>{selectedResources.map((resource) => <td key={resource.id}>{resourceTypeLabel(resource.resourceType)}</td>)}</tr>
                    <tr><th scope="row">Owner</th>{selectedResources.map((resource) => <td key={resource.id}>{resource.publisher}</td>)}</tr>
                    <tr><th scope="row">Access</th>{selectedResources.map((resource) => <td key={resource.id}>{resourceAccessLabel(resource)}</td>)}</tr>
                    <tr><th scope="row">Maintenance</th>{selectedResources.map((resource) => <td key={resource.id}>{resourceFieldLabel(resource.maintenanceStatus)}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          <ul aria-label="Resource results" className="workspace-result-list">
            {filtered.map((resource) => {
              const selected = selectedResourceIds.includes(resource.id);
              return (
                <li key={resource.id}>
                  <article className="workspace-result-row workspace-result-row--resource" data-resource-id={resource.id} data-result-class="resource">
                    {compareMode ? (
                      <label className="workspace-result-select">
                        <input
                          aria-label={`Select ${resource.name} for comparison`}
                          checked={selected}
                          onChange={() => setSelectedResourceIds((ids) => selected ? ids.filter((id) => id !== resource.id) : [...ids, resource.id])}
                          type="checkbox"
                        />
                      </label>
                    ) : null}
                    <AppLink
                      aria-label={`Open ${resource.name}`}
                      className="workspace-result-row__link"
                      onNavigate={onNavigate}
                      patch={{
                        view: "commons-detail",
                        id: resource.id,
                        query: state.query,
                        resourceType: state.resourceType,
                        collection: state.collection,
                        owner: state.owner,
                        sort: state.sort,
                        showAll: state.showAll,
                        viewMode: state.viewMode,
                      }}
                      view="commons-detail"
                    >
                      <div className="workspace-resource-row__identity"><ResourceTypeIcon resourceType={resource.resourceType} /></div>
                      <div className="workspace-result-row__content">
                        <div className="workspace-result-row__meta">
                          <span className="workspace-kind-tag">{resourceTypeLabel(resource.resourceType)}</span>
                          <span>{resource.publisher}</span>
                        </div>
                        <h3>{resource.name}</h3>
                        <p className="workspace-result-row__snippet">{resource.cardPurpose || resource.summary}</p>
                        <div className="workspace-result-row__signals">
                          <span>{resourceAccessLabel(resource)}</span>
                          <span>{resourceFieldLabel(resource.maintenanceStatus)}</span>
                        </div>
                      </div>
                    </AppLink>
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <section className="empty-state" data-control-results>
          <h2>No resources match.</h2>
          <p>Clear a filter or search by name, topic, or owner.</p>
          <button onClick={reset} type="button">Clear filters</button>
        </section>
      )}

      <section aria-label="Contribute to directory" className="resources-contribute-section">
        <div className="resources-contribute-card">
          <div className="resources-contribute-copy">
            <strong>Contribute to the directory</strong>
            <p>Know of a valuable tool, catalog, or community not listed here? Submit a resource or report a problem.</p>
          </div>
          <div className="resources-contribute-actions">
            <a href="https://github.com/BackslashBryant/control-atlas/issues/new?template=submit-resource.yml" rel="noopener noreferrer" target="_blank">
              <IconPlus aria-hidden="true" size={15} />
              <span>Submit resource</span>
            </a>
            <a href="https://github.com/BackslashBryant/control-atlas/issues/new?template=report-broken-link.yml" rel="noopener noreferrer" target="_blank">
              <IconFlag aria-hidden="true" size={15} />
              <span>Report a problem</span>
            </a>
          </div>
        </div>
      </section>
    </WorkspaceTemplate>
  );
}
