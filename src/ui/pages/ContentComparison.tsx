import { useMemo, useState } from "react";
import { buildContentRows, buildMappingInventoryRows, comparisonFields, filterContentRows, hasComparisonValue } from "../../shared/content-comparison.mjs";
import { recordPresentationContract } from "../../shared/record-presentation.mjs";
import { Button } from "../components/lsm";
import { ListPagination } from "../components/ListPagination";
import { RecordLink } from "../components/RecordLink";
import { PublisherCitationProvider, SourceSectionContent } from "../components/RecordPublishedText";
import { SourceRefList } from "../lib/compareHelpers";
import { activateCompareMode, COMPARE_MODES } from "../lib/compareModeState";
import { paginateCompareRows } from "../lib/comparePagination";
import { buildContentExportData, compareExportToCsv } from "../lib/compareExport";
import { officialSourceFor, officialSourceActionLabel } from "../lib/officialSource";
import { Field, MissionPage, PageHeader, SelectField } from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

const LABELS: Record<string, string> = { shared: "Shared identifier, same content", different: "Shared identifier, different content",
  only_a: "Only in A", only_b: "Only in B", unavailable: "Content or alignment unavailable", mapped: "Published mapping" };
const identifier = (node: any) => node.metadata.publisher_item_id || node.metadata.item_id;
const fieldHeading = (node: any, field: string) => recordPresentationContract(node.metadata.catalog_id, node.node_type)
  .sections.find((entry: any) => entry.field === field)?.heading || (field === "title" ? "Title" : field.replaceAll("_", " "));

function ContentDetails({ row, bundle, onOpenNode }: { row: any; bundle: RuntimeBundle; onOpenNode: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Compared fields and sources</summary>
    {open ? <><div className="compare-step-fields">{(["a", "b"] as const).map((side) => {
      const node = row[side];
      if (!node) return <section key={side}><h3>{side.toUpperCase()}</h3><p>No aligned record in this inventory.</p></section>;
      const source = bundle.runtime.getSource(node.source_id);
      const official = officialSourceFor(source);
      const contract = recordPresentationContract(node.metadata.catalog_id, node.node_type);
      return <section key={side} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <h3>{side.toUpperCase()}: <RecordLink nodeId={node.id} onOpenNode={onOpenNode}>{identifier(node)}</RecordLink></h3>
        <p>{source?.display_name || source?.name} · {source?.version || "Version not stated"} · {source?.lifecycle_status || "Status not stated"}</p>
        {official.url ? <p><a href={official.url} target="_blank" rel="noreferrer">{officialSourceActionLabel(official)} (opens in a new tab)</a></p> : <p>Official source URL unavailable.</p>}
        {node.metadata.source_locator ? <p>Locator: {node.metadata.source_locator}</p> : null}
        {comparisonFields(node).map((field: string) => {
          const section = contract.sections.find((entry: any) => entry.field === field);
          const value = node.metadata[field];
          return <div key={field}><h4>{fieldHeading(node, field)}{row.changed.includes(field) ? " · differs" : ""}</h4>
            {!hasComparisonValue(value) ? <p>Not available in the imported source.</p> : section
              ? <PublisherCitationProvider citations={node.metadata.citations || {}}><SourceSectionContent kind={section.kind} value={value} presentation={node.metadata.source_text_presentation?.[field]} /></PublisherCitationProvider>
              : <p style={{ whiteSpace: "pre-wrap" }}>{typeof value === "string" ? value : JSON.stringify(value)}</p>}</div>;
        })}
      </section>;
    })}</div>{row.mapping ? <section><h3>Publisher mapping</h3>
      <p>{row.mapping.published_source_id} · {row.mapping.published_relationship_type} · {row.mapping.published_target_id}</p>
      {(row.mapping.publisher_assertions || []).map((assertion: any, index: number) => <p key={index}>{assertion.relationship}{assertion.property ? ` · ${assertion.property}` : ""}{assertion.locator ? ` (${assertion.locator})` : ""}</p>)}
      {row.mapping.raw_relationship_type ? <p>{row.mapping.raw_relationship_type}</p> : null}
      {row.mapping.rationale ? <p>{row.mapping.rationale}</p> : null}{row.mapping.warning ? <p>{row.mapping.warning}</p> : null}
    </section> : null}{row.source_refs?.length ? <SourceRefList refs={row.source_refs} /> : null}</> : null}
  </details>;
}

export function ContentComparison(props: {
  bundle: RuntimeBundle; state: Extract<ViewState, { view: "matrix" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (id: string) => void; onRetry?: () => void;
}) {
  const { bundle, state, onNavigate, onOpenNode, onRetry } = props;
  const [query, setQuery] = useState(""), [group, setGroup] = useState(""), [page, setPage] = useState("1");
  const [basis, setBasis] = useState("content"), [itemA, setItemA] = useState(""), [itemB, setItemB] = useState("");
  const catalogs = bundle.runtime.getCatalogs();
  const options = catalogs.filter((catalog: any) => bundle.comparisonContent?.[catalog.id]).map((catalog: any) => {
    const source = bundle.runtime.getSource(catalog.source_id);
    return { value: catalog.id, label: `${catalog.name}${source?.version ? ` (${source.version})` : ""}${source?.lifecycle_status ? ` · ${source.lifecycle_status.replaceAll("_", " ")}` : ""}` };
  })
    .sort((a: any, b: any) => a.label.localeCompare(b.label));
  const labelA = options.find((entry: any) => entry.value === state.source)?.label || "";
  const labelB = options.find((entry: any) => entry.value === state.target)?.label || "";
  const ready = state.compareRun === "true" && bundle.comparisonStatus === "ready" && labelA && labelB;
  const a = useMemo(() => ready ? bundle.runtime.getNodes({ catalog_id: state.source }) : [], [ready, bundle.runtime, state.source]);
  const b = useMemo(() => ready ? bundle.runtime.getNodes({ catalog_id: state.target }) : [], [ready, bundle.runtime, state.target]);
  const resolve = (nodes: any[], value: string) => {
    const exact = nodes.find((node) => node.id === value.trim());
    const matches = exact ? [exact] : nodes.filter((node) => identifier(node) === value.trim());
    return matches.length === 1 ? matches[0].id : "";
  };
  const selectedA = resolve(a, itemA), selectedB = resolve(b, itemB);
  const explicit = Boolean(itemA || itemB);
  const completeRows = useMemo(() => basis === "mappings"
    ? buildMappingInventoryRows(a, b, bundle.comparisonInventoryMappings || []) : buildContentRows(a, b), [a, b, basis, bundle.comparisonInventoryMappings]);
  const rows = basis === "content" && explicit ? (selectedA && selectedB ? buildContentRows(a, b, selectedA, selectedB) : []) : completeRows;
  const filtered = filterContentRows(rows, group, query);
  const window = paginateCompareRows(filtered, page);
  const select = (side: "source" | "target", value: string) => {
    const next = { ...state, [side]: value, page: "", mappingSource: "", relationshipType: "", items: "" };
    onNavigate("matrix", { ...next, compareRun: next.source && next.target ? "true" : "" });
  };
  const exportCsv = () => {
    const data = buildContentExportData({ rows: filtered, labelA, labelB, countA: a.length, countB: b.length,
      basis: basis === "mappings" ? "All published mappings in this pair" : "Literal publisher fields; identifier alignment or explicit selection",
      inventorySourcesA: [...new Set<string>(a.map((node: any) => node.source_id))], inventorySourcesB: [...new Set<string>(b.map((node: any) => node.source_id))],
      resolveSource: (id) => bundle.runtime.getSource(id) });
    const url = URL.createObjectURL(new Blob([compareExportToCsv(data)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "control-atlas-content.csv";
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };
  const totals = Object.entries(LABELS).map(([key, label]) => ({ key, label, count: completeRows.filter((row: any) => row.group === key).length })).filter((entry) => entry.count);
  return <MissionPage className="compare-page" id="compare-workspace" maxWidth="workspace">
    <PageHeader primary title="Compare" eyebrow="PUBLISHED CONTENT & INVENTORIES" summary="Select two publications to compare their text and records." />
    <div aria-label="Comparison mode" className="compare-mode-tabs" role="tablist">{COMPARE_MODES.map((mode) =>
      <button type="button" role="tab" className="compare-mode-tab" key={mode.id} aria-selected={mode.id === "content"}
        onClick={() => mode.id !== "content" && onNavigate("matrix", activateCompareMode(mode.id))}>{mode.label}</button>)}</div>
    <section className="panel" aria-label="Choose publication content">
      <div className="compare-step-fields"><SelectField label="Publication A" emptyLabel="Choose a publication" options={options} value={state.source} onChange={(value) => select("source", value)} />
        <SelectField label="Publication B" emptyLabel="Choose a publication" options={options} value={state.target} onChange={(value) => select("target", value)} /></div>
      <p>Matching IDs across editions do not prove they describe the same requirement. Missing text stays unavailable.</p>
      <details><summary>How this comparison works</summary>
      <p>Only imported publication editions are listed. Unavailable historical snapshots cannot be compared.</p>
      <p>Identifier alignment compares the same record type and publisher ID. Matching IDs across editions do not prove they describe the same requirement. Only in B means new to this selected inventory; only in A means missing from it, not withdrawn or noncompliant.</p>
      <p>Content comparison preserves the literal title, published sections and facts shown on each record page. Differences are not compliance, applicability or equivalence decisions. Missing source content remains unavailable.</p>
      </details>
      {state.source && state.target && state.compareRun !== "true" ? <Button type="button" onClick={() => onNavigate("matrix", { ...state, compareRun: "true" })}>Compare content</Button> : null}
    </section>
    {state.compareRun === "true" && !ready && !["ready", "error", "unsupported"].includes(bundle.comparisonStatus || "") ? <p role="status">Loading complete selected inventories.</p> : null}
    {bundle.comparisonStatus === "unsupported" ? <p role="status">A selected edition has no supported content inventory. Choose an available publication above.</p> : null}
    {bundle.comparisonStatus === "error" ? <section role="alert" className="notice"><p>{bundle.comparisonError}</p><Button type="button" onClick={onRetry}>Try again</Button></section> : null}
    {ready ? <section className="panel" id="compare-results" aria-labelledby="content-results-heading">
      <h2 id="content-results-heading">Content comparison</h2><p>A: {labelA} · {a.length.toLocaleString()} records<br />B: {labelB} · {b.length.toLocaleString()} records</p>
      <SelectField label="Comparison basis" emptyLabel="" value={basis} options={[{ value: "content", label: "Identifiers and literal content" }, ...(bundle.comparisonMappingAvailable ? [{ value: "mappings", label: "Complete published mapping inventory" }] : [])]}
        onChange={(value) => { setBasis(value); setGroup(""); setPage("1"); }} />
      {basis === "mappings" ? <p>Every imported record is included. Only in A or B means no published mapping to a public record in the other inventory across this pair's available sources. A published mapping retains its relationship meaning and does not imply equivalence.</p>
        : <details><summary>Compare two specific records</summary><div className="compare-step-fields">{[{ side: "A", value: itemA, set: setItemA }, { side: "B", value: itemB, set: setItemB }].map((item) =>
          <Field key={item.side} label={`Exact record ${item.side} (optional)`}><input type="search" value={item.value} placeholder="Publisher ID or full record ID"
            onChange={(event) => { item.set(event.target.value); setPage("1"); setGroup(""); }} /></Field>)}</div></details>}
      {basis === "content" && explicit && (!selectedA || !selectedB) ? <p role="status">Enter one exact record on each side. For repeated publisher IDs, use the full record ID from its record link.</p> : null}
      <p data-content-totals>Complete inventory totals: {totals.map((entry) => `${entry.count.toLocaleString()} ${entry.label.toLowerCase()}`).join(" · ")}</p>
      <div className="compare-step-fields"><SelectField label="Result group" emptyLabel="All groups" value={group}
        options={Object.entries(LABELS).filter(([key]) => basis === "mappings" ? ["mapped", "only_a", "only_b"].includes(key) : key !== "mapped").map(([value, label]) => ({ value, label }))}
        onChange={(value) => { setGroup(value); setPage("1"); }} />
        <Field label="Search results by ID or title"><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage("1"); }} /></Field></div>
      <p role="status">{filtered.length.toLocaleString()} results match. CSV includes all matching results, compared fields, sources and inventory totals.</p>
      <Button type="button" disabled={!filtered.length} onClick={exportCsv}>Download CSV</Button>
      {!filtered.length ? <p>No records match these selections and filters.</p> : null}
      <ul className="source-ref-list">{window.rows.map((row: any) => <li key={row.id} className="panel" data-content-result={row.group}>
        <span className="label">{explicit && basis === "content" && ["shared", "different"].includes(row.group) ? (row.group === "shared" ? "Same compared content" : "Different compared content") : LABELS[row.group]}</span>
        <p>{row.a ? `A: ${identifier(row.a)} — ${row.a.metadata.title}` : "A: no aligned record"}<br />{row.b ? `B: ${identifier(row.b)} — ${row.b.metadata.title}` : "B: no aligned record"}</p>
        <p>{row.alignment}{row.changed.length ? ` · Different fields: ${row.changed.map((field: string) => fieldHeading(row.a || row.b, field)).join(", ")}` : ""}</p>
        <ContentDetails row={row} bundle={bundle} onOpenNode={onOpenNode} />
      </li>)}</ul>
      <ListPagination label="Content results" noun="results" {...window} total={filtered.length} onPageChange={(value) => setPage(String(value))} />
    </section> : null}
  </MissionPage>;
}
