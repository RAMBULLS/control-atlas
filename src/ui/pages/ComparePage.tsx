import * as Accordion from "@radix-ui/react-accordion";
import { IconFilter } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { aggregateRelationshipRows } from "../../app/runtime.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { CompareResultsPanel } from "../components/CompareResultsPanel";
import { CatalogVersionChip } from "../components/CatalogVersionChip";
import {
  parseCatalogItemIds,
  ProvenanceBadge,
  SourceRefList,
} from "../lib/compareHelpers";
import { buildCrosswalkCompareGraph } from "../lib/buildCompareGraph";
import {
  activateCompareMode,
  compareConfigurationReady,
  getCompareCurrentStep,
  getCompareSteps,
  resolveMappingSource,
} from "../lib/compareModeState";
import {
  Field,
  PageHeader,
  SelectField,
} from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";
import { Button } from "../components/lsm";
import { AppLink } from "../components/AppLink";
import { TaxonomyTagLinks } from "../components/ContextualTaxonomyLinks";

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

function relationshipTagIds(row: any) {
  const fromTags = row.from_taxonomy_tags || [];
  const toTags = row.targets
    ? row.targets.flatMap((t: any) => t.to_taxonomy_tags || [])
    : row.to_taxonomy_tags || [];
  return [
    ...fromTags.map((tag: any) => tag.id || tag),
    ...toTags.map((tag: any) => tag.id || tag),
  ].filter(Boolean);
}

function DisclosurePanel(props: {
  value: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Accordion.Item className="disclosure-item" value={props.value}>
      <Accordion.Header className="disclosure-header">
        <Accordion.Trigger className="disclosure-trigger">
          <span aria-hidden="true" className="disclosure-chevron">▾</span>
          <span>{props.title}</span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="disclosure-content">
        {props.children}
      </Accordion.Content>
    </Accordion.Item>
  );
}

export function ComparePage(props: {
  bundle: RuntimeBundle;
  state: Extract<ViewState, { view: "matrix" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { bundle, state, onNavigate, onOpenNode } = props;
  const [relationshipPage, setRelationshipPage] = useState(1);
  const compareResultsRef = useRef<HTMLElement | null>(null);

  const catalogs = bundle.runtime.getCatalogs();

  const catalogsWithValidTarget = useMemo(() => {
    if (bundle.graphReady) {
      return new Set(
        catalogs
          .filter(
            (catalog: any) =>
              bundle.runtime.getConnectedCatalogs(catalog.id).length > 0,
          )
          .map((catalog: any) => catalog.id),
      );
    }
    const withTarget = new Set<string>();
    for (const key of Object.keys(bundle.mappingSources || {})) {
      const sources = bundle.mappingSources?.[key];
      if (!sources || !sources.length) continue;
      const [sourceCatalogId] = key.split("|");
      if (sourceCatalogId) withTarget.add(sourceCatalogId);
    }
    return withTarget;
  }, [bundle.runtime, bundle.mappingSources, bundle.graphReady, catalogs]);

  const pairCount = useMemo(() => {
    const pairKeys = new Set<string>();
    if (bundle.graphReady) {
      for (const catalog of catalogs) {
        const connected = bundle.runtime.getConnectedCatalogs(catalog.id);
        for (const target of connected) {
          const key = [catalog.id, target.id].sort().join("::");
          pairKeys.add(key);
        }
      }
    } else {
      for (const key of Object.keys(bundle.mappingSources || {})) {
        const [sourceId, targetId] = key.split("|");
        if (sourceId && targetId) {
          pairKeys.add([sourceId, targetId].sort().join("::"));
        }
      }
    }
    return pairKeys.size;
  }, [bundle.graphReady, bundle.mappingSources, bundle.runtime, catalogs]);

  const sourceCatalogOptions = useMemo(
    () =>
      catalogs
        .filter((catalog: any) => catalogsWithValidTarget.has(catalog.id))
        .sort((left: any, right: any) => left.name.localeCompare(right.name))
        .map((catalog: any) => ({ value: catalog.id, label: catalog.name })),
    [catalogs, catalogsWithValidTarget],
  );

  const connectedTargetOptions = useMemo(() => {
    if (bundle.graphReady) {
      return bundle.runtime
        .getConnectedCatalogs(state.source)
        .map((catalog: any) => ({
          value: catalog.id,
          label: `${catalog.name} (${catalog.connection_count.toLocaleString()} published connection${
            catalog.connection_count === 1 ? "" : "s"
          })`,
        }));
    }
    if (!state.source) return [];
    const targetIds = new Set<string>();
    for (const key of Object.keys(bundle.mappingSources || {})) {
      const sources = bundle.mappingSources?.[key];
      if (!sources || !sources.length) continue;
      const [sourceCatalogId, targetCatalogId] = key.split("|");
      if (sourceCatalogId === state.source && targetCatalogId) {
        targetIds.add(targetCatalogId);
      }
    }
    return catalogs
      .filter((catalog: any) => targetIds.has(catalog.id))
      .sort((left: any, right: any) => left.name.localeCompare(right.name))
      .map((catalog: any) => ({ value: catalog.id, label: catalog.name }));
  }, [bundle.runtime, bundle.mappingSources, bundle.graphReady, catalogs, state.source]);

  const activeModeId = state.intent === "item-mapping" ? "item-mapping" : "frameworks";
  const modeSteps = getCompareSteps(activeModeId);
  const currentStepNumber = getCompareCurrentStep(activeModeId, state);

  const relationshipNodeIds = useMemo(
    () => parseCatalogItemIds(state.items, state.source),
    [state.items, state.source],
  );

  const itemTargetOptions = useMemo(() => {
    if (!state.source || !state.items?.trim()) return connectedTargetOptions;
    const parsedIds = parseCatalogItemIds(state.items, state.source);
    if (!parsedIds.length) return connectedTargetOptions;
    if (bundle.graphReady) {
      const rows = bundle.runtime.buildRelationshipRows({
        source_catalog: state.source,
        node_ids: parsedIds,
        include_candidates: false,
      }).rows;
      const targetCatalogIds = new Set<string>();
      for (const row of rows) {
        for (const target of row.targets || []) {
          if (target.to_catalog_id) {
            targetCatalogIds.add(target.to_catalog_id);
          } else if (target.to_id) {
            const targetNode = bundle.runtime.getNode(target.to_id);
            if (targetNode?.catalog_id) {
              targetCatalogIds.add(targetNode.catalog_id);
            }
          }
        }
      }
      if (targetCatalogIds.size > 0) {
        return connectedTargetOptions.filter((opt) => targetCatalogIds.has(opt.value));
      }
      return [];
    }
    return connectedTargetOptions;
  }, [bundle, connectedTargetOptions, state.source, state.items]);

  const selectedCatalogVersion = useMemo(() => {
    const catalogId = state.source || state.target;
    if (!catalogId) return null;
    const catalog = catalogs.find((entry: any) => entry.id === catalogId);
    if (catalog?.source_version) {
      return catalog.source_version;
    }
    const sampleNode = bundle.runtime.getNodes({ catalog_id: catalogId })[0];
    const source = sampleNode
      ? bundle.runtime.getSource(sampleNode.source_id)
      : null;
    return source?.version || source?.source_version || null;
  }, [bundle.runtime, catalogs, state.source, state.target]);

  const relationshipRowsRaw = useMemo(() => {
    if (!state.source || !state.target) return null;
    return bundle.runtime.buildRelationshipRows({
      source_catalog: state.source,
      target_catalog: state.target,
      relationship_type: state.relationshipType,
      provenance_class: state.provenance,
      confidence: state.confidence,
      include_candidates: state.includeCandidates === "true",
      node_ids: activeModeId === "item-mapping" || state.items ? relationshipNodeIds : undefined,
    });
  }, [
    bundle.runtime,
    state.source,
    state.target,
    state.relationshipType,
    state.provenance,
    state.confidence,
    state.includeCandidates,
    activeModeId,
    state.items,
    relationshipNodeIds,
  ]);

  const mappingSourceOptions = useMemo(() => {
    if (!bundle.graphReady && state.source && state.target) {
      return (
        bundle.mappingSources?.[`${state.source}|${state.target}`] || []
      );
    }
    const sources = new Map<string, string>();
    for (const row of relationshipRowsRaw?.rows || []) {
      for (const reference of row.source_refs || []) {
        const sourceId = reference.source_id || reference.sourceId;
        if (!sourceId) continue;
        const source = bundle.runtime.getSource(sourceId);
        sources.set(
          sourceId,
          source?.display_name || source?.name || sourceId,
        );
      }
    }
    return [...sources.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [
    bundle.graphReady,
    bundle.mappingSources,
    bundle.runtime,
    relationshipRowsRaw,
    state.source,
    state.target,
  ]);

  const eligibleMappingSources = useMemo(
    () => mappingSourceOptions.map((option) => option.value),
    [mappingSourceOptions],
  );

  const mappingResolution = useMemo(
    () => resolveMappingSource(eligibleMappingSources, state.mappingSource),
    [eligibleMappingSources, state.mappingSource],
  );

  const effectiveMappingSource =
    mappingResolution.status === "auto" || mappingResolution.status === "filtered"
      ? mappingResolution.value
      : "";

  const relationshipRows = useMemo(() => {
    if (!relationshipRowsRaw) return null;
    if (!effectiveMappingSource) return relationshipRowsRaw;
    return {
      ...relationshipRowsRaw,
      rows: relationshipRowsRaw.rows.filter((row: any) =>
        (row.source_refs || []).some(
          (reference: any) =>
            (reference.source_id || reference.sourceId) ===
            effectiveMappingSource,
        ),
      ),
    };
  }, [relationshipRowsRaw, effectiveMappingSource]);

  const aggregatedRelationshipRows = useMemo(() => {
    if (!relationshipRows?.rows) return [];
    return aggregateRelationshipRows(relationshipRows.rows);
  }, [relationshipRows]);

  const hasComparisonScope = Boolean(
    (state.source && state.target) || state.items,
  );

  const relationshipPageSize = 25;
  const relationshipPageCount = Math.max(
    1,
    Math.ceil(aggregatedRelationshipRows.length / relationshipPageSize),
  );
  const visibleAggregatedRows = aggregatedRelationshipRows.slice(
    (relationshipPage - 1) * relationshipPageSize,
    relationshipPage * relationshipPageSize,
  );

  useEffect(() => {
    setRelationshipPage(1);
  }, [
    state.source,
    state.target,
    state.items,
    state.relationshipType,
    state.provenance,
    state.confidence,
    state.includeCandidates,
    state.mappingSource,
  ]);

  const pairHasAnyPublishedMapping =
    !bundle.graphReady
      ? true
      : state.source && state.target
        ? bundle.runtime.buildRelationshipRows({
            source_catalog: state.source,
            target_catalog: state.target,
            include_candidates: true,
          }).rows.length > 0
        : true;

  const relationshipFilterOptions = useMemo(() => {
    if (!state.source || !state.target) {
      return {
        types: [] as string[],
        provenances: [] as string[],
        confidences: [] as string[],
      };
    }
    const optionRows = bundle.runtime.buildRelationshipRows({
      source_catalog: state.source,
      target_catalog: state.target,
      include_candidates: true,
      node_ids: relationshipNodeIds,
    }).rows;
    return {
      types: [
        ...new Set(
          optionRows.map((row: any) => row.relationship_type).filter(Boolean),
        ),
      ].sort() as string[],
      provenances: [
        ...new Set(
          optionRows.map((row: any) => row.provenance_class).filter(Boolean),
        ),
      ].sort() as string[],
      confidences: [
        ...new Set(
          optionRows.map((row: any) => row.confidence).filter(Boolean),
        ),
      ].sort() as string[],
    };
  }, [bundle.runtime, relationshipNodeIds, state.source, state.target]);

  const compareView = state.compareView === "map" ? "map" : "list";

  const compareGraph = useMemo(
    () =>
      buildCrosswalkCompareGraph({
        crosswalk: "relationships",
        relationshipRows,
        sourceCatalog: state.source,
        targetCatalog: state.target,
      }),
    [
      relationshipRows,
      state.source,
      state.target,
    ],
  );

  function exportRows(format: "csv" | "markdown" | "json") {
    if (relationshipRows) {
      const content = bundle.runtime.exportRelationshipRows(
        aggregatedRelationshipRows.length ? aggregatedRelationshipRows : relationshipRows.rows,
        format,
      );
      const extension = format === "markdown" ? "md" : format;
      downloadTextFile(
        `control-atlas-compare.${extension}`,
        content,
        format === "json" ? "application/json" : "text/plain",
      );
    }
  }

  const sourceIsCurrentlyValid =
    !state.source ||
    sourceCatalogOptions.some((option) => option.value === state.source);
  const targetOptionsToCheck = activeModeId === "item-mapping" ? itemTargetOptions : connectedTargetOptions;
  const targetIsCurrentlyValid =
    !state.target ||
    targetOptionsToCheck.some((option) => option.value === state.target);

  const compareStateForReadiness = {
    ...state,
    intent: activeModeId,
    source: sourceIsCurrentlyValid ? state.source : "",
    target: targetIsCurrentlyValid ? state.target : "",
  };

  const compareReady = compareConfigurationReady(
    compareStateForReadiness,
    eligibleMappingSources,
  );

  const sourceCatalog = catalogs.find((c: any) => c.id === state.source);
  const targetCatalog = catalogs.find((c: any) => c.id === state.target);
  const eyebrow = `PUBLISHED CROSSWALKS / ${pairCount} COMPARABLE PAIRS`;

  return (
    <div
      className="compare-page ca-mission-page"
      data-control-results
      data-visual-identity="aligned-analysis-workbench"
      id="compare-workspace"
      /* targetId="compare-workspace" */
    >
      <PageHeader
        eyebrow={eyebrow}
        primary
        summary={SITE_COPY.routes.compare.purpose}
        title={SITE_COPY.routes.compare.title}
      />
      {selectedCatalogVersion ? (
        <CatalogVersionChip label="Active" version={selectedCatalogVersion} />
      ) : null}

      <div
        aria-label="Comparison mode"
        className="compare-mode-nav"
        role="tablist"
      >
        <button
          aria-selected={activeModeId === "frameworks"}
          className={`compare-mode-tab ${activeModeId === "frameworks" ? "active" : ""}`}
          onClick={() => {
            if (activeModeId !== "frameworks") {
              onNavigate("matrix", {
                crosswalk: "relationships",
                intent: "frameworks",
                source: "",
                target: "",
                items: "",
                mappingSource: "",
                compareRun: "",
              });
            }
          }}
          role="tab"
          type="button"
        >
          Frameworks
        </button>
        <button
          aria-selected={activeModeId === "item-mapping"}
          className={`compare-mode-tab ${activeModeId === "item-mapping" ? "active" : ""}`}
          onClick={() => {
            if (activeModeId !== "item-mapping") {
              onNavigate("matrix", {
                crosswalk: "relationships",
                intent: "item-mapping",
                source: "",
                target: "",
                items: "",
                mappingSource: "",
                compareRun: "",
              });
            }
          }}
          role="tab"
          type="button"
        >
          Specific item
        </button>
      </div>

      <nav
        aria-label="Step progress"
        className={`progress-trajectory progress-trajectory--step-${currentStepNumber}`}
      >
        {modeSteps.map((step, idx) => {
          const stepNum = idx + 1;
          const isDone = stepNum < currentStepNumber;
          const isActive = stepNum === currentStepNumber;
          return (
            <div
              className={`step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`.trim()}
              key={step.id}
            >
              {step.label}
            </div>
          );
        })}
      </nav>

      {currentStepNumber < 3 ? (
        <section
          aria-label="Compare configuration"
          className="compare-workspace-grid"
        >
          {activeModeId === "frameworks" ? (
            currentStepNumber === 1 ? (
              <>
                <article className="panel compare-stage-panel">
                  <span className="label">01 / SOURCE</span>
                  <h2 className="compare-step-title">Choose a framework</h2>
                  <p className="compare-step-desc">
                    Select a primary publication to begin comparison.
                  </p>
                  <div className="form-grid">
                    <div className="field full">
                      <SelectField
                        emptyLabel="Choose a primary publication"
                        label="Publication"
                        onChange={(source) =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "frameworks",
                            source,
                            target: "",
                            items: "",
                            mappingSource: "",
                            compareRun: "",
                          })
                        }
                        options={sourceCatalogOptions}
                        value={state.source}
                      />
                    </div>
                  </div>
                </article>

                <aside
                  aria-label="Current scope"
                  className="panel route-preview surface-blueprint compare-support-rail"
                >
                  <span className="label">CURRENT SCOPE</span>
                  <h3 className="support-rail-heading">Nothing selected yet</h3>
                  <p className="support-rail-text">
                    Only publications with a published crosswalk are available here.
                  </p>
                  <div className="system-stat">
                    <span>Comparable frameworks</span>
                    <strong>{catalogsWithValidTarget.size} publications</strong>
                  </div>
                  <div className="system-stat">
                    <span>Comparable pairs</span>
                    <strong>{pairCount} pairs</strong>
                  </div>
                </aside>
              </>
            ) : (
              <>
                <article className="panel compare-stage-panel">
                  <div className="step-context-bar">
                    <div className="step-context-info">
                      <span className="label">Source:</span>
                      <strong>{sourceCatalog?.name || state.source}</strong>
                    </div>
                    <Button
                      onClick={() =>
                        onNavigate("matrix", {
                          crosswalk: "relationships",
                          intent: "frameworks",
                          source: "",
                          target: "",
                          items: "",
                          mappingSource: "",
                          compareRun: "",
                        })
                      }
                      type="button"
                      variant="secondary"
                    >
                      Change
                    </Button>
                  </div>

                  <span className="label">02 / TARGET</span>
                  <h2 className="compare-step-title">
                    Choose a framework to compare with
                  </h2>
                  <p className="compare-step-desc">
                    Select a connected target publication with published crosswalks.
                  </p>

                  <div className="form-grid">
                    <div className="field full">
                      <SelectField
                        emptyLabel={
                          connectedTargetOptions.length
                            ? "Choose a target publication"
                            : "No published comparison is available"
                        }
                        hint={
                          !connectedTargetOptions.length
                            ? "No published mappings connect this publication to other frameworks."
                            : undefined
                        }
                        label="Publication B"
                        onChange={(target) =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "frameworks",
                            source: state.source,
                            target,
                            mappingSource: "",
                            compareRun: "",
                          })
                        }
                        options={connectedTargetOptions}
                        value={state.target}
                      />
                    </div>
                  </div>

                  {mappingResolution.status === "auto" ? (
                    <div className="mapping-source-row" style={{ marginTop: "var(--ca-space-3)" }}>
                      <span className="label">Mapping publication:</span>
                      <p className="field-value">
                        {mappingSourceOptions[0]?.label || ("value" in mappingResolution ? mappingResolution.value : "")}
                      </p>
                    </div>
                  ) : null}

                  {state.target && targetIsCurrentlyValid && compareReady ? (
                    <div className="actions" style={{ marginTop: "var(--ca-space-4)" }}>
                      <Button
                        onClick={() =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "frameworks",
                            source: state.source,
                            target: state.target,
                            compareRun: "true",
                          })
                        }
                        type="button"
                        variant="primary"
                      >
                        Show mappings
                      </Button>
                    </div>
                  ) : (
                    <p
                      className="generation-status tone-warning"
                      role="status"
                      style={{ marginTop: "var(--ca-space-4)" }}
                    >
                      Select a target publication to view published mappings.
                    </p>
                  )}
                </article>

                <aside
                  aria-label="Current scope"
                  className="panel route-preview surface-blueprint compare-support-rail"
                >
                  <span className="label">CURRENT SCOPE</span>
                  <div className="system-stat">
                    <span>Source</span>
                    <strong>{sourceCatalog?.name || state.source}</strong>
                  </div>
                  <div className="system-stat">
                    <span>Available crosswalks</span>
                    <strong>
                      {connectedTargetOptions.length} connected publication{connectedTargetOptions.length === 1 ? "" : "s"}
                    </strong>
                  </div>
                  {mappingResolution.status === "auto" ? (
                    <div className="system-stat">
                      <span>Mapping publication</span>
                      <strong className="field-value">
                        {mappingSourceOptions[0]?.label || ("value" in mappingResolution ? mappingResolution.value : "")}
                      </strong>
                    </div>
                  ) : null}
                  {connectedTargetOptions.length > 0 ? (
                    <div className="connected-targets-preview">
                      <span className="label">Connected frameworks</span>
                      <ul className="connected-targets-list">
                        {connectedTargetOptions.slice(0, 6).map((opt) => (
                          <li key={opt.value}>
                            <button
                              className="connected-target-chip"
                              onClick={() =>
                                onNavigate("matrix", {
                                  crosswalk: "relationships",
                                  intent: "frameworks",
                                  source: state.source,
                                  target: opt.value,
                                  mappingSource: "",
                                  compareRun: "",
                                })
                              }
                              type="button"
                            >
                              {opt.label.replace(/\s*\(\d+.*$/, "")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </aside>
              </>
            )
          ) : (
            currentStepNumber === 1 ? (
              <>
                <article className="panel compare-stage-panel">
                  <span className="label">01 / ITEM</span>
                  <h2 className="compare-step-title">
                    Choose a publication and control or rule
                  </h2>
                  <p className="compare-step-desc">
                    Enter the exact control or rule identifier to see its published mappings.
                  </p>
                  <div className="form-grid">
                    <div className="field">
                      <SelectField
                        emptyLabel="Choose a publication"
                        label="Publication"
                        onChange={(source) =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "item-mapping",
                            source,
                            target: "",
                            items: state.items,
                            mappingSource: "",
                            compareRun: "",
                          })
                        }
                        options={sourceCatalogOptions}
                        value={state.source}
                      />
                    </div>
                    <div className="field">
                      <Field label="Specific control or rule">
                        <input
                          onChange={(event) =>
                            onNavigate("matrix", {
                              crosswalk: "relationships",
                              intent: "item-mapping",
                              source: state.source,
                              target: "",
                              items: event.target.value,
                              mappingSource: "",
                              compareRun: "",
                            })
                          }
                          placeholder="For example, AC-2"
                          value={state.items}
                        />
                        <p className="field-hint">
                          Enter the exact control or rule identifier to see its published mappings.
                        </p>
                      </Field>
                    </div>
                  </div>
                  {state.source && state.items.trim() ? (
                    <div className="actions" style={{ marginTop: "var(--ca-space-4)" }}>
                      <Button
                        onClick={() =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "item-mapping",
                            source: state.source,
                            items: state.items,
                            target: "",
                            mappingSource: "",
                            compareRun: "",
                          })
                        }
                        type="button"
                        variant="primary"
                      >
                        Continue to target
                      </Button>
                    </div>
                  ) : null}
                </article>

                <aside
                  aria-label="Current scope"
                  className="panel route-preview surface-blueprint compare-support-rail"
                >
                  <span className="label">CURRENT SCOPE</span>
                  <h3 className="support-rail-heading">Specific item lookup</h3>
                  <p className="support-rail-text">
                    Trace a known control, requirement, or rule identifier across connected frameworks.
                  </p>
                  {state.source ? (
                    <div className="system-stat">
                      <span>Publication</span>
                      <strong>{sourceCatalog?.name || state.source}</strong>
                    </div>
                  ) : null}
                  {state.items ? (
                    <div className="system-stat">
                      <span>Control / Rule</span>
                      <strong>{state.items}</strong>
                    </div>
                  ) : null}
                </aside>
              </>
            ) : (
              <>
                <article className="panel compare-stage-panel">
                  <div className="step-context-bar">
                    <div className="step-context-info">
                      <span className="label">Item:</span>
                      <strong>
                        {state.items} ({sourceCatalog?.name || state.source})
                      </strong>
                    </div>
                    <Button
                      onClick={() =>
                        onNavigate("matrix", {
                          crosswalk: "relationships",
                          intent: "item-mapping",
                          source: state.source,
                          target: "",
                          items: "",
                          mappingSource: "",
                          compareRun: "",
                        })
                      }
                      type="button"
                      variant="secondary"
                    >
                      Change item
                    </Button>
                  </div>

                  <span className="label">02 / TARGET</span>
                  <h2 className="compare-step-title">
                    Choose a framework to compare with
                  </h2>
                  <p className="compare-step-desc">
                    Select a target publication containing published mappings for {state.items}.
                  </p>

                  <div className="form-grid">
                    <div className="field full">
                      <SelectField
                        emptyLabel={
                          itemTargetOptions.length
                            ? "Choose a target publication"
                            : "No published mappings found for this item"
                        }
                        hint={
                          !itemTargetOptions.length
                            ? `No published mappings connect ${state.items} to other frameworks.`
                            : undefined
                        }
                        label="Publication B"
                        onChange={(target) =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "item-mapping",
                            source: state.source,
                            items: state.items,
                            target,
                            mappingSource: "",
                            compareRun: "",
                          })
                        }
                        options={itemTargetOptions}
                        value={state.target}
                      />
                    </div>
                  </div>

                  {mappingResolution.status === "auto" ? (
                    <div className="mapping-source-row" style={{ marginTop: "var(--ca-space-3)" }}>
                      <span className="label">Mapping publication:</span>
                      <p className="field-value">
                        {mappingSourceOptions[0]?.label || ("value" in mappingResolution ? mappingResolution.value : "")}
                      </p>
                    </div>
                  ) : null}

                  {state.target && targetIsCurrentlyValid && compareReady ? (
                    <div className="actions" style={{ marginTop: "var(--ca-space-4)" }}>
                      <Button
                        onClick={() =>
                          onNavigate("matrix", {
                            crosswalk: "relationships",
                            intent: "item-mapping",
                            source: state.source,
                            items: state.items,
                            target: state.target,
                            compareRun: "true",
                          })
                        }
                        type="button"
                        variant="primary"
                      >
                        Show mappings
                      </Button>
                    </div>
                  ) : (
                    <p
                      className="generation-status tone-warning"
                      role="status"
                      style={{ marginTop: "var(--ca-space-4)" }}
                    >
                      Select a target publication to view published mappings.
                    </p>
                  )}
                </article>

                <aside
                  aria-label="Current scope"
                  className="panel route-preview surface-blueprint compare-support-rail"
                >
                  <span className="label">CURRENT SCOPE</span>
                  <div className="system-stat">
                    <span>Publication</span>
                    <strong>{sourceCatalog?.name || state.source}</strong>
                  </div>
                  <div className="system-stat">
                    <span>Control / Rule</span>
                    <strong>{state.items}</strong>
                  </div>
                  <div className="system-stat">
                    <span>Available targets</span>
                    <strong>
                      {itemTargetOptions.length} publication{itemTargetOptions.length === 1 ? "" : "s"}
                    </strong>
                  </div>
                  {mappingResolution.status === "auto" ? (
                    <div className="system-stat">
                      <span>Mapping publication</span>
                      <strong className="field-value">
                        {mappingSourceOptions[0]?.label || ("value" in mappingResolution ? mappingResolution.value : "")}
                      </strong>
                    </div>
                  ) : null}
                </aside>
              </>
            )
          )}
        </section>
      ) : (
        state.compareRun === "true" && aggregatedRelationshipRows.length ? (
          <section
            className="compare-results"
            id="compare-results"
            ref={compareResultsRef}
          >
            <div className="panel compare-results-head">
              <div className="compare-results-head-main">
                <div className="compare-results-identity">
                  <span className="label">03 / RESULTS</span>
                  <h2 className="compare-results-title">
                    {sourceCatalog?.name || state.source}
                    {state.items ? ` (${state.items})` : ""} ↔{" "}
                    {targetCatalog?.name || state.target}
                  </h2>
                  <p className="compare-results-count">
                    {aggregatedRelationshipRows.length.toLocaleString()} published mapping{aggregatedRelationshipRows.length === 1 ? "" : "s"} ({relationshipRows?.rows.length.toLocaleString()} total connection{relationshipRows?.rows.length === 1 ? "" : "s"})
                  </p>
                </div>
                <div className="compare-results-actions">
                  <Button
                    onClick={() =>
                      onNavigate("matrix", {
                        crosswalk: "relationships",
                        intent: activeModeId,
                        source: state.source,
                        items: state.items,
                        target: "",
                        compareRun: "",
                      })
                    }
                    type="button"
                    variant="secondary"
                  >
                    Change target
                  </Button>
                </div>
              </div>

              {mappingResolution.status === "auto" || (mappingSourceOptions.length === 1 && !state.mappingSource) ? (
                <div className="mapping-source-row">
                  <span className="label">Crosswalk source:</span>
                  <strong className="field-value">
                    {mappingSourceOptions[0]?.label || ("value" in mappingResolution ? mappingResolution.value : "")}
                  </strong>
                </div>
              ) : mappingSourceOptions.length > 1 ? (
                <div className="mapping-source-row mapping-source-row--filter">
                  <label className="field inline-field" htmlFor="mapping-source-filter">
                    <span className="label">Crosswalk source:</span>
                    <select
                      id="mapping-source-filter"
                      onChange={(e) =>
                        onNavigate("matrix", {
                          ...state,
                          mappingSource: e.target.value,
                        })
                      }
                      value={state.mappingSource}
                    >
                      <option value="">All published sources</option>
                      {mappingSourceOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <Accordion.Root className="accordion-root" collapsible type="single">
                <DisclosurePanel title="Refine results" value="refine">
                  <div className="filter-grid">
                    {activeModeId !== "item-mapping" ? (
                      <Field label="Specific control or rule (optional)">
                        <input
                          onChange={(event) =>
                            onNavigate("matrix", {
                              ...state,
                              items: event.target.value,
                            })
                          }
                          placeholder="For example, AC-2"
                          value={state.items}
                        />
                      </Field>
                    ) : null}
                    <SelectField
                      emptyLabel="All connection types"
                      label="Connection type"
                      onChange={(value) =>
                        onNavigate("matrix", {
                          ...state,
                          relationshipType: value,
                        })
                      }
                      options={relationshipFilterOptions.types.map((value) => ({
                        value,
                        label: displayNameFor("relationship_type", value),
                      }))}
                      value={state.relationshipType}
                    />
                    <SelectField
                      emptyLabel="All source bases"
                      label="Source basis"
                      onChange={(value) =>
                        onNavigate("matrix", {
                          ...state,
                          provenance: value,
                        })
                      }
                      options={relationshipFilterOptions.provenances.map(
                        (value) => ({
                          value,
                          label: displayNameFor("provenance_class", value),
                        }),
                      )}
                      value={state.provenance}
                    />
                    <SelectField
                      emptyLabel="All trust levels"
                      label="Trust level"
                      onChange={(value) =>
                        onNavigate("matrix", {
                          ...state,
                          confidence: value,
                        })
                      }
                      options={relationshipFilterOptions.confidences.map(
                        (value) => ({
                          value,
                          label: displayNameFor("confidence", value),
                        }),
                      )}
                      value={state.confidence}
                    />
                  </div>
                </DisclosurePanel>
              </Accordion.Root>

              <p className="compare-boundary">
                A published crosswalk shows a cited relationship; it does not by itself establish equivalence or compliance.
              </p>
            </div>

            <CompareResultsPanel
              bundle={bundle}
              compareView={compareView}
              graph={compareGraph}
              listContent={
                <section className="stack compare-mappings">
                  <h3 className="compare-mappings-title">
                    Mapping details
                    <span className="compare-mappings-count">
                      {aggregatedRelationshipRows.length.toLocaleString()} source record
                      {aggregatedRelationshipRows.length === 1 ? "" : "s"} ({relationshipRows?.rows.length.toLocaleString()} total connection
                      {relationshipRows?.rows.length === 1 ? "" : "s"})
                    </span>
                  </h3>
                  <p aria-live="polite" className="field-hint compare-range">
                    Showing {(relationshipPage - 1) * relationshipPageSize + 1}
                    –{Math.min(relationshipPage * relationshipPageSize, aggregatedRelationshipRows.length)} of {aggregatedRelationshipRows.length.toLocaleString()} source records
                  </p>
                  <div className="compare-table-scroll">
                    <table
                      aria-label="Relationship mappings"
                      className="detail-table"
                    >
                      <thead>
                        <tr>
                          <th scope="col">From</th>
                          <th scope="col">Mapped target items</th>
                          <th scope="col">Connection types</th>
                          <th scope="col">Source basis</th>
                          <th scope="col">Evidence & Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAggregatedRows.map((row: any) => {
                          const distinctTypes = [...new Set(row.targets.map((t: any) => t.relationship_type))];
                          const distinctProvenances = [...new Set(row.targets.map((t: any) => t.provenance_class))];
                          return (
                            <tr key={row.from_id || row.from_item_id}>
                              <td data-label="From">
                                <strong>{row.from_item_id}</strong>
                                <br />
                                <span className="muted">{row.from_title}</span>
                              </td>
                              <td data-label="Mapped target items">
                                <ul className="target-mapping-list">
                                  {row.targets.map((t: any) => (
                                    <li className="target-mapping-item" key={t.edge_id || `${row.from_id}-${t.to_id}`}>
                                      <div className="target-mapping-header">
                                        <strong>{t.to_item_id}</strong>
                                        <span className="target-mapping-chip">
                                          {displayNameFor("relationship_type", t.relationship_type)}
                                        </span>
                                      </div>
                                      <span className="target-item-title">{t.to_title}</span>
                                    </li>
                                  ))}
                                </ul>
                              </td>
                              <td data-label="Connection types">
                                <div className="badge-row">
                                  {distinctTypes.map((type: any) => (
                                    <span className="badge" key={type}>
                                      {displayNameFor("relationship_type", type)}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td data-label="Source basis">
                                <div className="badge-row">
                                  {distinctProvenances.map((prov: any) => (
                                    <ProvenanceBadge
                                      key={prov}
                                      provenanceClass={prov}
                                      publicationStatus="published"
                                    />
                                  ))}
                                </div>
                              </td>
                              <td data-label="Evidence & Details">
                                <details className="mapping-row-details">
                                  <summary>View evidence ({row.targets.length})</summary>
                                  <div className="stack">
                                    {row.targets.map((t: any, idx: number) => (
                                      <div className="target-evidence-block" key={t.edge_id || idx}>
                                        <p><strong>{t.to_item_id}</strong> ({displayNameFor("relationship_type", t.relationship_type)})</p>
                                        <dl>
                                          <div><dt>Trust level</dt><dd>{displayNameFor("confidence", t.confidence)}</dd></div>
                                          <div><dt>Official rationale</dt><dd>{t.rationale || "No public rationale recorded."}</dd></div>
                                          <div><dt>{t.navigation_note ? "Navigation note" : "Relationship explanation"}</dt><dd>{t.navigation_note || "No product-authored navigation note."}</dd></div>
                                          <div><dt>Source references</dt><dd><SourceRefList refs={t.source_refs} /></dd></div>
                                        </dl>
                                      </div>
                                    ))}
                                    {relationshipTagIds(row).length ? (
                                      <div>
                                        <dt>Related topics</dt>
                                        <dd>
                                          <TaxonomyTagLinks
                                            onNavigate={onNavigate}
                                            tagIds={relationshipTagIds(row)}
                                          />
                                        </dd>
                                      </div>
                                    ) : null}
                                  </div>
                                </details>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {relationshipPageCount > 1 ? (
                    <nav aria-label="Mapping result pages" className="pagination">
                      <Button variant="secondary" disabled={relationshipPage === 1} onClick={() => setRelationshipPage((page) => Math.max(1, page - 1))} type="button">Previous</Button>
                      <span>Page {relationshipPage} of {relationshipPageCount}</span>
                      <Button variant="secondary" disabled={relationshipPage === relationshipPageCount} onClick={() => setRelationshipPage((page) => Math.min(relationshipPageCount, page + 1))} type="button">Next</Button>
                    </nav>
                  ) : null}
                </section>
              }
              matrixCrosswalk="relationships"
              onExport={exportRows}
              onNavigate={onNavigate}
              onOpenNode={onOpenNode}
            />
          </section>
        ) : state.compareRun === "true" && hasComparisonScope ? (
          <section className="empty-state">
            <IconFilter aria-hidden="true" size={24} stroke={1.8} />
            <h2>
              {!state.source || !state.target
                ? `No published mapping found for ${state.items} yet.`
                : pairHasAnyPublishedMapping
                  ? "No public connections found for this comparison."
                  : `No published mapping is available for ${sourceCatalog?.name || state.source} ↔ ${targetCatalog?.name || state.target} yet.`}
            </h2>
            <p>
              {!state.source || !state.target
                ? "Pick a primary publication and a target publication above to compare this item against."
                : pairHasAnyPublishedMapping
                  ? "Try changing one catalog, removing filters, or searching for a specific control identifier."
                  : "This isn't a filter issue — the cited sources contain no official crosswalk between these two catalogs. Try a different framework pair."}
            </p>
            <div className="card-actions">
              {state.source && state.target && pairHasAnyPublishedMapping ? (
                <Button
                  onClick={() =>
                    onNavigate("matrix", {
                      crosswalk: "relationships",
                      intent: activeModeId,
                      source: state.source,
                      target: state.target,
                      items: activeModeId === "item-mapping" ? state.items : "",
                      relationshipType: "",
                      provenance: "",
                      confidence: "",
                      includeCandidates: "",
                      compareRun: "true",
                    })
                  }
                  type="button"
                  variant="primary"
                >
                  Reset filters
                </Button>
              ) : null}
              <Button
                onClick={() =>
                  onNavigate("matrix", {
                    crosswalk: "relationships",
                    intent: "frameworks",
                    source: "",
                    target: "",
                    items: "",
                    mappingSource: "",
                    compareRun: "",
                  })
                }
                type="button"
                variant={state.source && state.target && pairHasAnyPublishedMapping ? "secondary" : "primary"}
              >
                Choose another comparison
              </Button>
              <details>
                <summary>Check the data source</summary>
                <AppLink className="disclosure-actions" onNavigate={onNavigate} variant="secondary" view="sources">Review sources</AppLink>
              </details>
            </div>
          </section>
        ) : null
      )}
    </div>
  );
}
