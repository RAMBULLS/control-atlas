import { useMemo, useState } from "react";
import { Button } from "../components/lsm";
import { ListPagination } from "../components/ListPagination";
import { RecordLink } from "../components/RecordLink";
import { SourceRefList } from "../lib/compareHelpers";
import { activateCompareMode } from "../lib/compareModeState";
import { paginateCompareRows } from "../lib/comparePagination";
import { buildBaselineExportData, compareExportToCsv, filterBaselineRows, type BaselineResultRow } from "../lib/compareExport";
import { officialSourceFor } from "../lib/officialSource";
import { Field, MissionPage, PageHeader, SelectField } from "../lib/pagePrimitives";
import type { RuntimeBundle, ComparisonBaseline } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

const labelFor = (entry: ComparisonBaseline) =>
  `${entry.publication} — ${entry.name}${entry.version ? ` (${entry.version})` : ""}${entry.lifecycle_status ? ` · ${entry.lifecycle_status.replaceAll("_", " ")}` : ""}`;
const groupLabel = (group: string) => group === "shared" ? "Shared" : group === "only_a" ? "Only in A" : "Only in B";

export function BaselineComparison(props: {
  bundle: RuntimeBundle;
  state: Extract<ViewState, { view: "matrix" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (id: string) => void;
  onRetry?: () => void;
}) {
  const { bundle, state, onNavigate, onOpenNode, onRetry } = props;
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState("1");
  const options = Object.entries(bundle.comparisonBaselines || {}).map(([value, entry]) => ({ value, label: labelFor(entry) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const labelA = options.find((option) => option.value === state.source)?.label || "";
  const labelB = options.find((option) => option.value === state.target)?.label || "";
  const comparison = useMemo(() => bundle.runtime.buildBaselineComparison({ baseline_a: state.source, baseline_b: state.target }),
    [bundle.runtime, state.source, state.target]);
  const ready = state.compareRun === "true" && bundle.comparisonStatus === "ready" && labelA && labelB && comparison.baseline_a && comparison.baseline_b;
  const rows: BaselineResultRow[] = useMemo(() => ready
    ? (["only_a", "shared", "only_b"] as const).flatMap((key) => comparison[key].map((entry: Omit<BaselineResultRow, "group">) => ({ ...entry, group: key })))
    : [], [comparison, ready]);
  const filtered = useMemo(() => filterBaselineRows(rows, group, query), [rows, group, query]);
  const window = paginateCompareRows(filtered, page);
  const select = (side: "source" | "target", value: string) => {
    const next = { ...state, [side]: value, page: "", relationshipType: "", mappingSource: "" };
    onNavigate("matrix", { ...next, compareRun: next.source && next.target ? "true" : "" });
  };
  const exportCsv = () => {
    const data = buildBaselineExportData({ rows: filtered, labelA, labelB, resolveSource: (id) => bundle.runtime.getSource(id) });
    const url = URL.createObjectURL(new Blob([compareExportToCsv(data)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "control-atlas-baselines.csv";
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };
  return (
    <MissionPage className="compare-page" id="compare-workspace" maxWidth="workspace">
      <PageHeader primary title="Compare" eyebrow="PUBLISHED BASELINE SELECTIONS"
        summary="Find controls selected by both baselines and those selected by only one." />
      <div aria-label="Comparison mode" className="compare-mode-tabs" role="tablist">
        {([{ id: "frameworks", label: "Frameworks" }, { id: "implementation", label: "Implementation" },
          { id: "item-mapping", label: "Specific item" }, { id: "baselines", label: "Baselines" }] as const).map((mode) => (
          <button type="button" role="tab" className="compare-mode-tab" key={mode.id} aria-selected={mode.id === "baselines"}
            onClick={() => mode.id !== "baselines" && onNavigate("matrix", activateCompareMode(mode.id))}>{mode.label}</button>
        ))}
      </div>
      <section className="panel" aria-label="Choose baselines">
        <div className="compare-step-fields">
          <SelectField label="Baseline A" emptyLabel="Choose a baseline" options={options} value={state.source} onChange={(value) => select("source", value)} />
          <SelectField label="Baseline B" emptyLabel="Choose a baseline" options={options} value={state.target} onChange={(value) => select("target", value)} />
        </div>
        <p>Shared means the same control record is selected by both baselines. Selection does not establish identical parameters or requirements. A control absent from a baseline is not a compliance failure.</p>
        <p>Only baselines with published control selections are listed. Revision text changes and historical editions without full source content are not available in this comparison.</p>
        {state.source && state.target && state.compareRun !== "true" ? <Button type="button" onClick={() => onNavigate("matrix", { ...state, compareRun: "true" })}>Compare baselines</Button> : null}
        {!options.length ? <p role="status">No published baseline selections are available.</p> : null}
      </section>
      {state.compareRun === "true" && state.source && state.target && !ready && !["ready", "error", "unsupported"].includes(bundle.comparisonStatus || "") ? <p role="status">Loading complete baseline selections.</p> : null}
      {bundle.comparisonStatus === "unsupported" ? <p role="status">A selected baseline is unavailable. Choose from the published baselines above.</p> : null}
      {bundle.comparisonStatus === "error" ? <section role="alert" className="notice"><p>{bundle.comparisonError}</p><Button type="button" onClick={onRetry}>Try again</Button></section> : null}
      {ready ? <section className="panel" id="compare-results" aria-labelledby="baseline-results-heading">
        <h2 id="baseline-results-heading">Baseline selections</h2>
        <p><strong>A:</strong> {labelA}<br /><strong>B:</strong> {labelB}</p>
        <p>{comparison.only_a.length.toLocaleString()} only in A · {comparison.shared.length.toLocaleString()} shared · {comparison.only_b.length.toLocaleString()} only in B</p>
        <div className="compare-step-fields">
          <SelectField label="Result group" emptyLabel="All groups" value={group}
            options={[{ value: "only_a", label: "Only in A" }, { value: "shared", label: "Shared" }, { value: "only_b", label: "Only in B" }]}
            onChange={(value) => { setGroup(value); setPage("1"); }} />
          <Field label="Search results by ID or title"><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage("1"); }} /></Field>
        </div>
        <p role="status">{filtered.length.toLocaleString()} controls match. CSV includes every matching result and its sources.</p>
        <Button type="button" disabled={!filtered.length} onClick={exportCsv}>Download CSV</Button>
        {!filtered.length ? <p>No controls match these filters.</p> : null}
        <ul className="source-ref-list">
          {window.rows.map((row) => <li key={row.control_node.id} className="panel" data-baseline-result={row.group}>
            <span className="label">{groupLabel(row.group)}</span>
            <p><RecordLink nodeId={row.control_node.id} onOpenNode={onOpenNode}><strong>{row.control_node.metadata?.item_id}</strong> — {row.control_node.metadata?.title}</RecordLink></p>
            <details><summary>Selection evidence</summary>
              <SourceRefList refs={row.source_refs as Array<Record<string, string>>} />
              {[...new Set(row.source_refs.map((ref) => ref.source_id || ref.sourceId || ""))].map((id) => {
                const source = bundle.runtime.getSource(id);
                const url = officialSourceFor(source).url;
                return url ? <p key={id}><a href={url} target="_blank" rel="noreferrer">{source?.display_name || source?.name} — official source (opens in a new tab)</a></p> : null;
              })}
            </details>
          </li>)}
        </ul>
        <ListPagination label="Baseline results" noun="controls" {...window} total={filtered.length} onPageChange={(value) => setPage(String(value))} />
      </section> : null}
    </MissionPage>
  );
}
