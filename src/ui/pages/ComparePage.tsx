import * as Accordion from "@radix-ui/react-accordion";
import { useEffect, useId, useMemo, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { aggregateRelationshipRows } from "../../app/runtime.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { Button } from "../components/lsm";
import { AtlasTag } from "../components/AtlasTag";
import { RecordLink } from "../components/RecordLink";
import { parseCatalogItemIds, SourceRefList } from "../lib/compareHelpers";
import {
  buildCompareExportData,
  COMPARE_EXPORT_MIME_TYPES,
  compareExportToCsv,
  compareExportToXlsx,
  countCompareMappings,
  filterCompareRows,
} from "../lib/compareExport";
import {
  activateCompareMode,
  compareEmptyKind,
  getCompareCurrentStep,
  getCompareSteps,
  resolveMappingSource,
  type CompareModeId,
} from "../lib/compareModeState";
import { COMPARE_TARGET_PREVIEW, paginateCompareRows } from "../lib/comparePagination";
import { compareTaxonomyTags } from "../lib/compareTaxonomy.mjs";
import {
  Field,
  MissionPage,
  PageHeader,
  SelectField,
  StepIndicator,
} from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

type CompareState = Extract<ViewState, { view: "matrix" }>;
type SelectOption = { value: string; label: string };

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadBinaryFile(filename: string, content: Uint8Array, mimeType: string) {
  const bytes = content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Enough to show every connected publication without becoming a wall. */
const OPTION_LIST_LIMIT = 24;

function SearchablePublicationField(props: {
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  value: string;
  /** Overrides the default count line so the page can relate its own totals. */
  hint?: string;
}) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const selectedLabel =
    props.options.find((option) => option.value === props.value)?.label || "";
  const [query, setQuery] = useState(selectedLabel);

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const resolveValue = (candidate: string) =>
    props.options.find(
      (option) =>
        option.label.localeCompare(candidate, undefined, {
          sensitivity: "accent",
        }) === 0 || option.value === candidate,
    );

  const commit = (candidate: string) => {
    const match = resolveValue(candidate.trim());
    if (match && match.value !== props.value) props.onChange(match.value);
    return Boolean(match);
  };

  // While a choice is committed the query equals its label, so filtering on it
  // would collapse the list to the one already-chosen row.
  const needle = props.value && query === selectedLabel ? "" : query.trim().toLowerCase();
  const matches = needle
    ? props.options.filter((option) => option.label.toLowerCase().includes(needle))
    : props.options;
  const visibleOptions = matches.slice(0, OPTION_LIST_LIMIT);
  const hiddenCount = matches.length - visibleOptions.length;

  return (
    <>
    <Field label={props.label}>
      <input
        aria-autocomplete="list"
        autoComplete="off"
        id={inputId}
        list={listId}
        onBlur={() => {
          if (!query.trim()) {
            if (props.value) props.onChange("");
            return;
          }
          if (!commit(query)) setQuery(selectedLabel);
        }}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          if (!nextQuery) {
            if (props.value) props.onChange("");
            return;
          }
          commit(nextQuery);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (commit(query)) event.preventDefault();
        }}
        placeholder={props.placeholder}
        type="search"
        value={query}
      />
      <datalist id={listId}>
        {props.options.map((option) => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
      <p className="field-hint">
        {props.hint ||
          `Search ${props.options.length.toLocaleString()} publications with published crosswalks.`}
      </p>
    </Field>
      {/* A native datalist keeps every choice invisible until the user guesses
          a prefix. The first decision in the flow cannot be a guess, so the
          same options are also listed as real, clickable controls.
          These live outside <Field> on purpose: a <label> forwards any click
          inside it to its own control, which swallowed every option click. */}
      <ul className="compare-option-list">
        {visibleOptions.map((option) => (
          <li key={option.value}>
            <button
              aria-pressed={option.value === props.value}
              className="compare-option"
              onClick={() => props.onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          </li>
        ))}
        {hiddenCount > 0 ? (
          <li>
            <span className="compare-option-list__note">
              {hiddenCount.toLocaleString()} more match your search
            </span>
          </li>
        ) : null}
      </ul>
      {visibleOptions.length === 0 ? (
        <p className="compare-option-list__note" role="status">
          No publication matches “{query.trim()}”. Clear the box to see all
          {" "}
          {props.options.length.toLocaleString()}.
        </p>
      ) : null}
    </>
  );
}

function catalogName(catalogs: any[], catalogId: string) {
  return catalogs.find((catalog) => catalog.id === catalogId)?.name || catalogId;
}

function CompareScopeRail(props: {
  connectedCount: number;
  mappingCount: number;
  mappingSourceCount: number;
  mode: CompareModeId;
  sourceLabel: string;
  targetLabel: string;
}) {
  if (!props.sourceLabel) {
    return (
      <aside className="compare-flow-support panel surface-blueprint">
        <span className="label">CURRENT SCOPE</span>
        <h2>Nothing selected yet</h2>
        <p>Only publications with a published crosswalk are available here.</p>
      </aside>
    );
  }

  return (
    <aside className="compare-flow-support panel surface-blueprint">
      <span className="label">CURRENT SCOPE</span>
      <dl className="compare-scope-list">
        <div>
          <dt>Source</dt>
          <dd>{props.sourceLabel}</dd>
        </div>
        {props.mode === "frameworks" && !props.targetLabel ? (
          <div>
            <dt>Available crosswalks</dt>
            <dd>
              {props.connectedCount.toLocaleString()} connected publication
              {props.connectedCount === 1 ? "" : "s"}
            </dd>
          </div>
        ) : null}
        {props.targetLabel ? (
          <div>
            <dt>Target</dt>
            <dd>{props.targetLabel}</dd>
          </div>
        ) : null}
        {props.mappingCount > 0 ? (
          <div>
            <dt>Published mappings</dt>
            <dd>{props.mappingCount.toLocaleString()}</dd>
          </div>
        ) : null}
        {props.mappingSourceCount > 0 ? (
          <div>
            <dt>Crosswalk evidence</dt>
            <dd>
              {props.mappingSourceCount.toLocaleString()} published source
              {props.mappingSourceCount === 1 ? "" : "s"}
            </dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}

// Evidence content can be large (many source refs per mapping). Defer mounting
// the inner DOM until the user opens the disclosure so the initial render of
// a full crosswalk stays bounded — the summary label is always present, only
// the body is lazy.
function LazyEvidenceDetails({ targets }: { targets: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mapping-row-details"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        Evidence for {targets.length.toLocaleString()} mapping
        {targets.length === 1 ? "" : "s"}
      </summary>
      {open ? (
        <div className="mapping-evidence-list">
          {targets.map((target: any) => (
            <section
              aria-label={`Evidence for ${target.to_item_id}`}
              key={`evidence-${target.edge_id || target.to_id}`}
            >
              <strong>{target.to_item_id}</strong>
              <SourceRefList refs={target.source_refs} />
            </section>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function TargetItem({
  onOpenNode,
  target,
}: {
  onOpenNode: (nodeId: string) => void;
  target: any;
}) {
  return (
    <li className="target-mapping-item">
      <div>
        <span className="target-mapping-line">
          <RecordLink nodeId={target.to_id} onOpenNode={onOpenNode}>
            <strong>{target.to_item_id}</strong>
          </RecordLink>
          {target.relationship_type && target.relationship_type !== "maps_to" ? (
            <span className="target-mapping-relationship">
              {displayNameFor("relationship_type", target.relationship_type)}
            </span>
          ) : null}
        </span>
        <span className="target-item-title">{target.to_title}</span>
      </div>
    </li>
  );
}

export function ComparePage(props: {
  bundle: RuntimeBundle;
  state: CompareState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { bundle, state, onNavigate, onOpenNode } = props;
  const [resultQuery, setResultQuery] = useState("");
  const catalogs = bundle.runtime.getCatalogs();
  const mode: CompareModeId =
    state.intent === "item-mapping" ? "item-mapping" : "frameworks";

  const publishedPairEntries = useMemo(
    () =>
      Object.entries(bundle.mappingSources || {}).filter(
        ([key, sources]) => key.includes("|") && sources.length > 0,
      ),
    [bundle.mappingSources],
  );

  const pairCount = useMemo(
    () =>
      new Set(
        publishedPairEntries.map(([key]) => key.split("|").sort().join("|")),
      ).size,
    [publishedPairEntries],
  );

  const sourceCatalogOptions = useMemo(() => {
    const sourceIds = new Set(
      publishedPairEntries.map(([key]) => key.split("|")[0]).filter(Boolean),
    );
    return catalogs
      .filter((catalog: any) => sourceIds.has(catalog.id))
      .sort((left: any, right: any) => left.name.localeCompare(right.name))
      .map((catalog: any) => ({ value: catalog.id, label: catalog.name }));
  }, [catalogs, publishedPairEntries]);

  const frameworkTargetOptions = useMemo(() => {
    if (!state.source) return [];
    const targetIds = new Set(
      publishedPairEntries
        .filter(([key]) => key.split("|")[0] === state.source)
        .map(([key]) => key.split("|")[1])
        .filter(Boolean),
    );
    return catalogs
      .filter((catalog: any) => targetIds.has(catalog.id))
      .sort((left: any, right: any) => left.name.localeCompare(right.name))
      .map((catalog: any) => ({ value: catalog.id, label: catalog.name }));
  }, [catalogs, publishedPairEntries, state.source]);

  const relationshipNodeIds = useMemo(
    () => parseCatalogItemIds(state.items, state.source),
    [state.items, state.source],
  );

  const specificTargetOptions = useMemo(() => {
    if (!state.source || !state.items.trim()) return [];
    return frameworkTargetOptions.filter((option) =>
      bundle.runtime.buildRelationshipRows({
        include_candidates: false,
        node_ids: relationshipNodeIds,
        source_catalog: state.source,
        target_catalog: option.value,
      }).rows.length > 0,
    );
  }, [
    bundle.runtime,
    frameworkTargetOptions,
    relationshipNodeIds,
    state.items,
    state.source,
  ]);

  const targetOptions =
    mode === "item-mapping" ? specificTargetOptions : frameworkTargetOptions;

  const pairRelationshipRows = useMemo(() => {
    if (!state.source || !state.target) return null;
    return bundle.runtime.buildRelationshipRows({
      include_candidates: false,
      node_ids: mode === "item-mapping" ? relationshipNodeIds : [],
      source_catalog: state.source,
      target_catalog: state.target,
    });
  }, [
    bundle.runtime,
    mode,
    relationshipNodeIds,
    state.source,
    state.target,
  ]);

  const relationshipTypeOptions = useMemo(
    () =>
      [
        ...new Set<string>(
          (pairRelationshipRows?.rows || [])
            .map((row: any) => String(row.relationship_type || ""))
            .filter((value: string) => Boolean(value)),
        ),
      ]
        .sort()
        .map((value) => ({
          value,
          label: displayNameFor("relationship_type", value),
        })),
    [pairRelationshipRows],
  );

  const rawRelationshipRows = useMemo(() => {
    if (!pairRelationshipRows || !state.relationshipType) {
      return pairRelationshipRows;
    }
    return {
      ...pairRelationshipRows,
      rows: pairRelationshipRows.rows.filter(
        (row: any) => row.relationship_type === state.relationshipType,
      ),
    };
  }, [pairRelationshipRows, state.relationshipType]);

  const mappingSourceOptions = useMemo(() => {
    const sources = new Map<string, string>();
    for (const row of pairRelationshipRows?.rows || []) {
      for (const reference of row.source_refs || []) {
        const sourceId = reference.source_id || reference.sourceId;
        if (!sourceId) continue;
        const source = bundle.runtime.getSource(sourceId);
        sources.set(sourceId, source?.display_name || source?.name || sourceId);
      }
    }
    const runtimeOptions = [...sources.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
    if (runtimeOptions.length || !state.source || !state.target) {
      return runtimeOptions;
    }
    return [...(bundle.mappingSources?.[`${state.source}|${state.target}`] || [])]
      .map((option) => ({ value: option.value, label: option.label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [
    bundle.mappingSources,
    bundle.runtime,
    pairRelationshipRows,
    state.source,
    state.target,
  ]);

  const mappingResolution = resolveMappingSource(
    mappingSourceOptions.map((option) => option.value),
    state.mappingSource,
  );
  const effectiveMappingSource =
    mappingResolution.status === "auto" ||
    mappingResolution.status === "filtered"
      ? mappingResolution.value
      : "";
  const relationshipRows = useMemo(() => {
    if (!rawRelationshipRows || !effectiveMappingSource) return rawRelationshipRows;
    return {
      ...rawRelationshipRows,
      rows: rawRelationshipRows.rows.filter((row: any) =>
        (row.source_refs || []).some(
          (reference: any) =>
            (reference.source_id || reference.sourceId) === effectiveMappingSource,
        ),
      ),
    };
  }, [effectiveMappingSource, rawRelationshipRows]);

  const aggregatedRelationshipRows = useMemo(
    () => aggregateRelationshipRows(relationshipRows?.rows || []),
    [relationshipRows],
  );
  const visibleAggregatedRows = useMemo(
    () => filterCompareRows(aggregatedRelationshipRows, resultQuery),
    [aggregatedRelationshipRows, resultQuery],
  );
  const taxonomyComparison = useMemo(
    () => compareTaxonomyTags(aggregatedRelationshipRows),
    [aggregatedRelationshipRows],
  );
  const filteredMappingCount = countCompareMappings(aggregatedRelationshipRows);
  const visibleMappingCount = countCompareMappings(visibleAggregatedRows);
  const pageWindow = paginateCompareRows(visibleAggregatedRows, state.page);
  const pageRows = pageWindow.rows;


  useEffect(() => {
    setResultQuery("");
  }, [
    mode,
    state.items,
    state.mappingSource,
    state.relationshipType,
    state.source,
    state.target,
  ]);

  const sourceIsValid = sourceCatalogOptions.some(
    (option) => option.value === state.source,
  );
  const targetIsValid = targetOptions.some(
    (option) => option.value === state.target,
  );
  const itemIsReady = mode === "frameworks" || Boolean(state.items.trim());
  const comparisonReady =
    sourceIsValid &&
    targetIsValid &&
    itemIsReady &&
    mappingResolution.status !== "none" &&
    mappingResolution.status !== "invalid";
  // Choosing the target in the page is the request and sets compareRun. A link that only
  // names a source and target waits for an explicit action, because results download the
  // full connection graph (about 22 MB).
  const showResults = state.compareRun === "true" && comparisonReady;
  const scopeComplete = sourceIsValid && targetIsValid && itemIsReady;
  const currentStep = getCompareCurrentStep(mode, {
    ...state,
    compareRun: showResults ? "true" : "",
    intent: mode,
    source: sourceIsValid ? state.source : "",
    target: targetIsValid ? state.target : "",
  });
  const steps = getCompareSteps(mode);
  const sourceLabel = sourceIsValid
    ? catalogName(catalogs, state.source)
    : "";
  const targetLabel = targetIsValid
    ? catalogName(catalogs, state.target)
    : "";
  const sourceCatalog = catalogs.find((catalog: any) => catalog.id === state.source);
  const targetCatalog = catalogs.find((catalog: any) => catalog.id === state.target);

  const patchCompare = (patch: Partial<CompareState>) =>
    onNavigate("matrix", {
      crosswalk: "relationships",
      intent: mode,
      ...patch,
      page: Object.hasOwn(patch, "page") ? patch.page || "" : "",
    });

  const changeMode = (nextMode: CompareModeId) => {
    if (nextMode === mode && state.intent === nextMode) return;
    onNavigate("matrix", activateCompareMode(nextMode));
  };

  const selectSource = (source: string) => {
    patchCompare({
      compareRun: "",
      items: "",
      mappingSource: "",
      relationshipType: "",
      source,
      target: "",
    });
  };

  const resetToSource = () => {
    patchCompare({
      compareRun: "",
      items: "",
      mappingSource: "",
      relationshipType: "",
      source: "",
      target: "",
    });
  };

  // Clearing the target (not just a run flag) keeps re-choosing the same target possible.
  const changeTarget = () => {
    patchCompare({
      compareRun: "",
      mappingSource: "",
      relationshipType: "",
      target: "",
    });
  };

  const narrowed = Boolean(
    resultQuery.trim() ||
      state.relationshipType ||
      mappingResolution.status === "filtered",
  );
  const exportScope = `Exports all ${visibleMappingCount.toLocaleString()} ${visibleMappingCount === 1 ? "mapping" : "mappings"}${narrowed ? " matching your search and filters" : ""}, not just this page.`;
  const emptyKind = compareEmptyKind({
    pairRows: pairRelationshipRows?.rows.length ?? 0,
    searching: Boolean(resultQuery.trim()),
    visibleRows: visibleAggregatedRows.length,
  });

  const exportRows = async (format: "csv" | "xlsx") => {
    if (!sourceCatalog || !targetCatalog || !visibleAggregatedRows.length) return;
    const exportData = buildCompareExportData({
      buildLabel:
        import.meta.env.VITE_CONTROL_ATLAS_RELEASE_DATE ||
        "local development build",
      generatedAt: new Date().toISOString(),
      resolveSource: (sourceId) => bundle.runtime.getSource(sourceId),
      rows: visibleAggregatedRows,
      sourceCatalog,
      targetCatalog,
    });
    if (format === "csv") {
      downloadTextFile(
        "control-atlas-crosswalk.csv",
        compareExportToCsv(exportData),
        COMPARE_EXPORT_MIME_TYPES.csv,
      );
      return;
    }
    downloadBinaryFile(
      "control-atlas-crosswalk.xlsx",
      await compareExportToXlsx(exportData),
      COMPARE_EXPORT_MIME_TYPES.xlsx,
    );
  };

  const singleMappingSource = mappingSourceOptions.length === 1
    ? mappingSourceOptions[0]
    : null;

  return (
    <MissionPage
      className="compare-page flow-shell"
      data-visual-identity="staged-crosswalk-flow"
      id="compare-workspace"
      maxWidth="workspace"
    >
      <PageHeader
        eyebrow={`PUBLISHED CROSSWALKS / ${sourceCatalogOptions.length.toLocaleString()} CONNECTED PUBLICATIONS`}
        primary
        summary={SITE_COPY.routes.compare.purpose}
        title={SITE_COPY.routes.compare.title}
      />

      <div aria-label="Comparison mode" className="compare-mode-tabs" role="tablist">
        {[
          { id: "frameworks" as const, label: "Frameworks" },
          { id: "item-mapping" as const, label: "Specific item" },
        ].map((entry) => (
          <button
            aria-selected={mode === entry.id}
            className="compare-mode-tab"
            key={entry.id}
            onClick={() => changeMode(entry.id)}
            role="tab"
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <StepIndicator currentStep={currentStep} steps={[...steps]} />

      <section className="compare-flow-grid">
        <section
          aria-labelledby="compare-active-step"
          className="compare-flow-task panel"
        >
          {!showResults && currentStep === 1 ? (
            <>
              <span className="label">
                01 / {mode === "item-mapping" ? "ITEM" : "SOURCE"}
              </span>
              <h2 id="compare-active-step">
                {mode === "item-mapping"
                  ? "Choose an item"
                  : "Choose a framework"}
              </h2>
              <div className="compare-step-fields">
                <SearchablePublicationField
                  label="Publication"
                  onChange={selectSource}
                  hint={`${sourceCatalogOptions.length.toLocaleString()} publications are connected by ${pairCount.toLocaleString()} published crosswalks.`}
                  options={sourceCatalogOptions}
                  placeholder="Search published frameworks"
                  value={sourceIsValid ? state.source : ""}
                />
                {mode === "item-mapping" ? (
                  <Field label="Control / requirement / rule">
                    <input
                      onChange={(event) =>
                        patchCompare({
                          compareRun: "",
                          items: event.target.value,
                          mappingSource: "",
                          target: "",
                        })
                      }
                      placeholder="For example, AC-2"
                      value={state.items}
                    />
                    <p className="field-hint">
                      Enter the exact publisher identifier.
                    </p>
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}

          {!showResults && currentStep === 2 ? (
            <>
              <span className="label">02 / TARGET</span>
              <h2 id="compare-active-step">Choose a framework to compare with</h2>
              <p className="compare-preserved-context">
                <span>Source</span>
                <strong>{sourceLabel}</strong>
                {mode === "item-mapping" ? <code>{state.items}</code> : null}
              </p>
              {/* Step 1 picks a publication with an open, searchable list of
                  everything connected. Collapsing the same kind of choice into
                  a dropdown one step later made the reader unlearn the control
                  they had just used, and hid the most interesting answer in the
                  flow - which frameworks connect to mine - behind a click. */}
              <SearchablePublicationField
                hint={`${targetOptions.length.toLocaleString()} ${targetOptions.length === 1 ? "publication has" : "publications have"} a published crosswalk with ${sourceLabel}.`}
                label="Target publication"
                onChange={(target) =>
                  patchCompare({
                    compareRun: target ? "true" : "",
                    mappingSource: "",
                    relationshipType: "",
                    target,
                  })
                }
                options={targetOptions}
                placeholder="Search connected publications"
                value={targetIsValid ? state.target : ""}
              />
              {mode === "item-mapping" && !targetOptions.length ? (
                <p className="generation-status tone-warning" role="status">
                  No published item mapping is available for that identifier.
                </p>
              ) : null}
              {scopeComplete && !comparisonReady ? (
                <section className="empty-state compare-results-empty" role="status">
                  <h3>No published mappings were found between these selections.</h3>
                  <p>This reflects the published crosswalks in the current data.</p>
                  <div className="actions">
                    <Button onClick={changeTarget} type="button" variant="secondary">
                      Change target
                    </Button>
                    {state.relationshipType || state.mappingSource ? (
                      <Button
                        onClick={() => patchCompare({ mappingSource: "", relationshipType: "" })}
                        type="button"
                        variant="secondary"
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {comparisonReady && !showResults ? (
                <p className="field-hint compare-run-prompt">
                  This link names both publications but has not been run. Showing the mappings loads the full published connection data, which takes a few seconds.
                </p>
              ) : null}
              <div className="actions compare-step-actions">
                <Button onClick={resetToSource} type="button" variant="secondary">
                  Change source
                </Button>
                <Button
                  disabled={!comparisonReady}
                  onClick={() => patchCompare({ compareRun: "true" })}
                  type="button"
                  variant="primary"
                >
                  Show published mappings
                </Button>
              </div>
            </>
          ) : null}

          {showResults ? (
            <section
              className="compare-results-panel"
              data-control-results
              data-continuous-results
              id="compare-results"
            >
              <header className="compare-results-head">
                <div>
                  <span className="label">03 / RESULTS</span>
                  <h2 id="compare-active-step">
                    {sourceLabel} <span aria-hidden="true">↔</span>{" "}
                    {targetLabel}
                  </h2>
                </div>
                <Button onClick={changeTarget} type="button" variant="secondary">
                  Change target
                </Button>
              </header>

              <div className="compare-answer">
                <div className="compare-answer-count">
                  <p aria-live="polite" className="compare-mapping-total" role="status">
                    {resultQuery.trim()
                      ? `${visibleMappingCount.toLocaleString()} of ${filteredMappingCount.toLocaleString()} published mappings match`
                      : `${visibleMappingCount.toLocaleString()} published mapping${visibleMappingCount === 1 ? "" : "s"} across ${visibleAggregatedRows.length.toLocaleString()} source record${visibleAggregatedRows.length === 1 ? "" : "s"}`}
                  </p>
                  {singleMappingSource ? (
                    <p className="compare-crosswalk-source">
                      <span>Crosswalk source</span>
                      <strong>{singleMappingSource.label}</strong>
                    </p>
                  ) : null}
                </div>
                <div className="compare-export-actions">
                  <span className="field-label">Export crosswalk</span>
                  <div className="actions">
                    <Button
                      disabled={!visibleMappingCount}
                      onClick={() => exportRows("csv")}
                      type="button"
                      variant="secondary"
                    >
                      CSV
                    </Button>
                    <Button
                      disabled={!visibleMappingCount}
                      onClick={() => exportRows("xlsx")}
                      type="button"
                      variant="primary"
                    >
                      Excel workbook
                    </Button>
                  </div>
                  <small>{exportScope}</small>
                </div>
              </div>

              <div className="compare-refine-fields compare-results-toolbar">
                <Field label="Search results by ID or title">
                  <input
                    onChange={(event) => {
                      setResultQuery(event.target.value);
                      if (state.page) patchCompare({ page: "" });
                    }}
                    placeholder="Search source or target IDs and titles"
                    type="search"
                    value={resultQuery}
                  />
                </Field>
                {relationshipTypeOptions.length > 0 ? (
                  <SelectField
                    emptyLabel="All connection types"
                    label="Connection type"
                    onChange={(relationshipType) => patchCompare({ relationshipType })}
                    options={relationshipTypeOptions}
                    value={state.relationshipType}
                  />
                ) : null}
                {!singleMappingSource && mappingSourceOptions.length > 1 ? (
                  <SelectField
                    emptyLabel="All published sources"
                    label="Crosswalk source"
                    onChange={(mappingSource) => patchCompare({ mappingSource })}
                    options={mappingSourceOptions}
                    value={
                      mappingResolution.status === "filtered"
                        ? state.mappingSource
                        : ""
                    }
                  />
                ) : null}
              </div>

              <Accordion.Root className="accordion-root compare-taxonomy-accordion" collapsible type="single">
                <Accordion.Item className="disclosure-item" value="taxonomy">
                  <Accordion.Header className="disclosure-header">
                    <Accordion.Trigger className="disclosure-trigger">
                      <span aria-hidden="true" className="disclosure-chevron">▾</span>
                      <span>Taxonomy context</span>
                      <span className="compare-taxonomy-summary">
                        {taxonomyComparison.shared.length.toLocaleString()} shared · {taxonomyComparison.onlySource.length.toLocaleString()} only in {sourceLabel} · {taxonomyComparison.onlyTarget.length.toLocaleString()} only in {targetLabel}
                      </span>
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content className="disclosure-content">
                    <div className="compare-taxonomy-context">
                      <div>
                        <p>Tags summarize the mapped records in each publication; they do not add a new relationship.</p>
                      </div>
                      <div className="compare-taxonomy-groups">
                        {[
                          { id: "shared", label: "Shared tags", tags: taxonomyComparison.shared },
                          { id: "source", label: `Only in ${sourceLabel}`, tags: taxonomyComparison.onlySource },
                          { id: "target", label: `Only in ${targetLabel}`, tags: taxonomyComparison.onlyTarget },
                        ].map((group) => (
                          <section aria-labelledby={`compare-taxonomy-${group.id}`} key={group.id}>
                            <h4 id={`compare-taxonomy-${group.id}`}>{group.label}</h4>
                            {group.tags.length ? (
                              <div className="compare-taxonomy-tags">
                                {group.tags.map((tag: any) => (
                                  <AtlasTag key={tag.id} onNavigate={onNavigate} showType size="sm" tagId={tag.id} />
                                ))}
                              </div>
                            ) : <p className="muted">None</p>}
                          </section>
                        ))}
                      </div>
                    </div>
                  </Accordion.Content>
                </Accordion.Item>
              </Accordion.Root>

              {visibleAggregatedRows.length ? (
                <>
                  <div className="compare-table-scroll" data-continuous-scroll>
                    <table
                      aria-label="Published crosswalk mappings"
                      className="detail-table compare-results-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">From</th>
                          <th scope="col">Maps to</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row: any) => (
                          <tr key={row.from_id || row.from_item_id}>
                            <td data-label="From">
                              <RecordLink nodeId={row.from_id} onOpenNode={onOpenNode}>
                                <strong>{row.from_item_id}</strong>
                              </RecordLink>
                              <span className="compare-record-title">{row.from_title}</span>
                            </td>
                            <td data-label="Maps to">
                              <ul className="target-mapping-list">
                                {row.targets.slice(0, COMPARE_TARGET_PREVIEW).map((target: any) => (
                                  <TargetItem
                                    key={target.edge_id || `${row.from_id}-${target.to_id}`}
                                    onOpenNode={onOpenNode}
                                    target={target}
                                  />
                                ))}
                              </ul>
                              {row.targets.length > COMPARE_TARGET_PREVIEW ? (
                                <details className="target-more">
                                  <summary>
                                    Show {(row.targets.length - COMPARE_TARGET_PREVIEW).toLocaleString()} more {row.targets.length - COMPARE_TARGET_PREVIEW === 1 ? "target" : "targets"}
                                  </summary>
                                  <ul className="target-mapping-list">
                                    {row.targets.slice(COMPARE_TARGET_PREVIEW).map((target: any) => (
                                      <TargetItem
                                            key={target.edge_id || `${row.from_id}-${target.to_id}`}
                                        onOpenNode={onOpenNode}
                                        target={target}
                                      />
                                    ))}
                                  </ul>
                                </details>
                              ) : null}
                              <LazyEvidenceDetails targets={row.targets} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <nav aria-label="Mapping result pages" className="compare-pagination">
                    {!pageWindow.valid ? (
                      <p className="compare-page-recovery" role="alert">
                        That result page is not available. Showing page {pageWindow.page.toLocaleString()} of {pageWindow.pageCount.toLocaleString()}.
                      </p>
                    ) : null}
                    <p className="compare-pagination-caption">
                      Showing source records {pageWindow.start.toLocaleString()}–{pageWindow.end.toLocaleString()} of {visibleAggregatedRows.length.toLocaleString()}.
                      Page {pageWindow.page.toLocaleString()} of {pageWindow.pageCount.toLocaleString()}.
                    </p>
                    <div className="compare-pagination-actions">
                      <Button
                        disabled={pageWindow.page <= 1}
                        onClick={() => patchCompare({ page: pageWindow.page <= 2 ? "" : String(pageWindow.page - 1) })}
                        type="button"
                        variant="secondary"
                      >
                        Previous page
                      </Button>
                      <Button
                        disabled={pageWindow.page >= pageWindow.pageCount}
                        onClick={() => patchCompare({ page: String(pageWindow.page + 1) })}
                        type="button"
                        variant="secondary"
                      >
                        Next page
                      </Button>
                    </div>
                    <small>
                      Counts and exports cover all {visibleMappingCount.toLocaleString()} published mappings matching the current filters and search.
                    </small>
                  </nav>
                </>
              ) : emptyKind === "none" ? (
                <section className="empty-state compare-results-empty" role="status">
                  <h3>No published mappings were found between these selections.</h3>
                  <p>This reflects the published crosswalks in the current data.</p>
                  <div className="actions">
                    <Button onClick={changeTarget} type="button" variant="secondary">
                      Change target
                    </Button>
                    <Button onClick={resetToSource} type="button" variant="secondary">
                      Change source
                    </Button>
                    {state.relationshipType || state.mappingSource ? (
                      <Button
                        onClick={() => patchCompare({ mappingSource: "", relationshipType: "" })}
                        type="button"
                        variant="secondary"
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : (
                <section className="empty-state compare-results-empty">
                  <h3>
                    {emptyKind === "search"
                      ? "No published mappings match this search."
                      : "No published mappings match these filters."}
                  </h3>
                  <p>
                    {emptyKind === "search"
                      ? "Search another identifier or title to return to the current published crosswalk."
                      : "Clear the filters to return to every published mapping."}
                  </p>
                  <Button
                    onClick={() =>
                      emptyKind === "search"
                        ? setResultQuery("")
                        : patchCompare({ mappingSource: "", relationshipType: "" })
                    }
                    type="button"
                    variant="secondary"
                  >
                    {emptyKind === "search" ? "Clear search" : "Clear filters"}
                  </Button>
                </section>
              )}

              <p className="compare-decision-boundary" role="note">
                A published crosswalk shows a cited relationship; it does not by itself establish equivalence or compliance.
              </p>

            </section>
          ) : null}
        </section>

        <CompareScopeRail
          connectedCount={targetOptions.length}
          mappingCount={0}
          mappingSourceCount={0}
          mode={mode}
          sourceLabel={sourceLabel}
          targetLabel={targetLabel}
        />
      </section>
    </MissionPage>
  );
}
