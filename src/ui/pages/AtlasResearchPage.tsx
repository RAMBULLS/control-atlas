import { useEffect, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconPin, IconX } from "@tabler/icons-react";
import { displayNameFor } from "../../app/display-names.mjs";
import { AppLink } from "../components/AppLink";
import { AtlasResearchClient } from "../lib/atlasResearchClient";
import type { ResearchAnswer, ResearchManifest, ResearchRecord } from "../lib/atlasResearchIndex";
import { normalizeResearchState, parseResearchPins } from "../lib/atlasResearchState";
import type { AtlasGraphSourceEdge } from "../lib/atlasGraphModel";
import { officialSourceFor } from "../lib/officialSource";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";
import "../../../styles/atlas-research.css";

type AtlasState = Extract<ViewState, { view: "atlas-map" }>;
type Navigate = (view: ViewState["view"], patch?: Partial<ViewState>) => void;
const label = (node?: ResearchRecord) => node?.identity.label || "Record unavailable";
const relation = (edge: AtlasGraphSourceEdge) => displayNameFor("relationship_type", String(edge.relationship_type || ""));

function ResearchEvidence(props: { edge: AtlasGraphSourceEdge; nodes: Map<string, ResearchRecord>; bundle: RuntimeBundle; onNavigate: Navigate }) {
  const { edge, nodes, bundle, onNavigate } = props;
  const references = Array.isArray(edge.source_refs) ? edge.source_refs.filter(ref => ref && typeof ref === "object") : [];
  return <aside className="atlas-research__evidence" id="research-evidence" tabIndex={-1} aria-labelledby="research-evidence-heading" data-research-edge={edge.id}>
    <h2 id="research-evidence-heading">Why these connect</h2>
    <p className="atlas-research__assertion">
      <strong>{label(nodes.get(edge.source_node_id))}</strong>
      <span>{relation(edge)} {edge.direction === "undirected" || edge.directed === false ? "↔" : "→"}</span>
      <strong>{label(nodes.get(edge.target_node_id))}</strong>
    </p>
    {typeof edge.rationale === "string" && edge.rationale ? <p>{edge.rationale}</p> : null}
    <dl>
      <div><dt>Direction</dt><dd>{edge.direction === "undirected" || edge.directed === false ? "No direction specified by this connection" : "The arrow follows the recorded source connection"}</dd></div>
      <div><dt>Connection status</dt><dd>{String(edge.lifecycle_status || edge.status || "Not recorded")}</dd></div>
      {typeof edge.source_locator === "string" ? <div><dt>Exact location</dt><dd>{edge.source_locator}</dd></div> : null}
    </dl>
    {references.map((ref, index) => {
      const source = typeof ref.source_id === "string" ? bundle.runtime.getSource(ref.source_id) : null;
      const official = officialSourceFor(source);
      const version = typeof ref.source_version === "string" ? ref.source_version : "";
      return <section key={`${ref.source_id}:${index}`} className="atlas-research__source">
        <h3>{source?.display_name || source?.name || "Source details unavailable"}</h3>
        <dl>
          {version || source?.version ? <div><dt>{version ? "Cited version" : "Registered version"}</dt><dd>{version || source.version}</dd></div> : null}
          {typeof ref.locator === "string" && ref.locator !== edge.source_locator ? <div><dt>Exact location</dt><dd>{ref.locator}</dd></div> : null}
        </dl>
        {source?.id ? <AppLink onNavigate={onNavigate} patch={{ source: source.id }} view="sources">View source details</AppLink> : null}
        {/^https?:\/\//.test(official.url) ? <a href={official.url} target="_blank" rel="noopener noreferrer">{official.isDownload ? "Download official source" : "View official source"}</a> : null}
      </section>;
    })}
    {!references.length ? <p>The source file is recorded, but its publication details are unavailable here.</p> : null}
    <p className="atlas-research__note">A path connects published statements. It is not a new direct mapping or proof of compliance.</p>
  </aside>;
}

export function AtlasResearchPage(props: { state: AtlasState; bundle: RuntimeBundle; onNavigate: Navigate }) {
  const { state, bundle, onNavigate } = props;
  const selection = normalizeResearchState(state);
  const pins = parseResearchPins(selection.atlasPins);
  const client = useRef<AtlasResearchClient | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [manifest, setManifest] = useState<ResearchManifest | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ records: ResearchRecord[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [known, setKnown] = useState<Map<string, ResearchRecord>>(new Map());
  const [answerState, setAnswerState] = useState<{ key: string; answer: ResearchAnswer } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pathIndex, setPathIndex] = useState(0);
  const [edgeId, setEdgeId] = useState("");
  const [offset, setOffset] = useState(0);
  const patch = (change: Partial<AtlasState>) => onNavigate("atlas-map", change);
  const selectionKey = JSON.stringify([selection.atlasResearch, selection.atlasPins, selection.atlasFrom, selection.atlasTo, selection.atlasDirection, selection.atlasHops]);

  const requestKey = `${selectionKey}:${offset}:${attempt}`;
  const answer = answerState?.key === requestKey ? answerState.answer : null;

  useEffect(() => {
    let active = true;
    let session: AtlasResearchClient;
    try { session = new AtlasResearchClient(); }
    catch { setLoadState("error"); return; }
    client.current = session;
    setLoadState("loading"); setManifest(null); setAnswerState(null); setKnown(new Map()); setError("");
    session.request<ResearchManifest>({ kind: "load", url: new URL("./data/generated/atlas-research-manifest.json", window.location.href).href })
      .then(value => { if (active) { setManifest(value); setLoadState("ready"); } })
      .catch(() => { if (active) setLoadState("error"); });
    return () => { active = false; session.dispose(); client.current = null; };
  }, [attempt]);

  useEffect(() => {
    if (loadState !== "ready") return;
    let active = true;
    const ids = [...new Set([...pins, selection.atlasFrom, selection.atlasTo].filter(Boolean))];
    client.current!.request<ResearchRecord[]>({ kind: "records", ids }).then(records => {
      if (active) setKnown(new Map(records.map(node => [node.id, node])));
    }).catch(() => { if (active) setError("The selected records could not be loaded. Retry the connection data."); });
    return () => { active = false; };
  }, [loadState, selectionKey, attempt]);

  useEffect(() => {
    setSearch(null);
    if (loadState !== "ready" || query.trim().length < 2) { setSearching(false); return; }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      client.current!.request<{ records: ResearchRecord[]; total: number }>({ kind: "search", query })
        .then(value => { if (active) { setSearch(value); setSearching(false); } })
        .catch(() => { if (active) { setSearching(false); setError("Search could not finish. Retry the connection data."); } });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [query, loadState, attempt]);

  useEffect(() => { setOffset(0); }, [selectionKey]);
  useEffect(() => {
    setAnswerState(null); setError(""); setEdgeId(""); setPathIndex(0);
    if (loadState !== "ready") return;
    const shared = selection.atlasResearch === "shared";
    if (shared ? pins.length < 2 : !selection.atlasFrom || !selection.atlasTo) { setWorking(false); return; }
    let active = true;
    setWorking(true);
    const command = shared ? { kind: "shared" as const, pins, offset }
      : { kind: "path" as const, from: selection.atlasFrom, to: selection.atlasTo,
        direction: selection.atlasDirection, maxHops: Number(selection.atlasHops) };
    client.current!.request<ResearchAnswer>(command).then(value => {
      if (!active) return;
      setAnswerState({ key: requestKey, answer: value }); setWorking(false); setEdgeId(value.result?.paths[0]?.[0]?.edge.id || "");
    }).catch(() => { if (active) { setWorking(false); setError("The search could not finish. This does not mean there is no connection. Retry the connection data."); } });
    return () => { active = false; };
  }, [selectionKey, loadState, offset, attempt]);

  const nodes = new Map([...known, ...(answer?.nodes || []).map(node => [node.id, node] as const)]);
  const selectedEdge = answer?.edges.find(edge => edge.id === edgeId);
  const options = [...new Set([...pins, selection.atlasFrom, selection.atlasTo].filter(Boolean))];
  function add(node: ResearchRecord) {
    if (pins.includes(node.id)) { setNotice(`${node.identity.label} is already pinned.`); return; }
    if (pins.length >= 6) { setNotice("Six records are pinned. Remove one to add another."); return; }
    patch({ atlasPins: JSON.stringify([...pins, node.id]),
      ...(!selection.atlasFrom ? { atlasFrom: node.id } : !selection.atlasTo && selection.atlasFrom !== node.id ? { atlasTo: node.id } : {}) });
    setQuery(""); setNotice(`${node.identity.label} pinned.`);
  }
  function remove(id: string) {
    patch({ atlasPins: JSON.stringify(pins.filter(pin => pin !== id)),
      ...(selection.atlasFrom === id ? { atlasFrom: "" } : {}), ...(selection.atlasTo === id ? { atlasTo: "" } : {}) });
  }
  function inspectEdge(id: string) {
    setEdgeId(id);
    if (window.matchMedia("(max-width: 767px)").matches) {
      window.requestAnimationFrame(() => {
        const panel = document.getElementById("research-evidence");
        panel?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: "start", behavior: "auto" });
      });
    }
  }
  const path = answer?.result?.paths[pathIndex] || [];
  const edgeVariants = selectedEdge ? answer!.edges.filter(edge =>
    (edge.source_node_id === selectedEdge.source_node_id && edge.target_node_id === selectedEdge.target_node_id)
    || (edge.source_node_id === selectedEdge.target_node_id && edge.target_node_id === selectedEdge.source_node_id)) : [];

  return <section className="atlas-research" data-route-content-ready="true" aria-labelledby="atlas-research-title">
    <header className="atlas-research__header" data-route-primary-header="true">
      <div data-route-primary-copy="true"><p className="eyebrow">Atlas</p><h1 id="atlas-research-title">Find a connection</h1><p>Choose records. Follow their published links. Check each step.</p></div>
      <div className="atlas-research__actions">
        <AppLink onNavigate={onNavigate} patch={{ atlasResearch: "" }} view="atlas-map"><IconArrowLeft aria-hidden="true" size={16} /> Back to map</AppLink>
        {pins.length ? <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(window.location.href); setNotice("View link copied."); }
          catch { setNotice("Copy failed. Copy the address from your browser instead."); }
        }}>Share this view</button> : null}
      </div>
    </header>
    <p className="visually-hidden" role="status" aria-live="polite">{notice}</p>
    {loadState === "loading" ? <div className="atlas-research__loading" role="status">Loading published connections… You can return to the map while this loads.</div> : null}
    {loadState === "error" ? <div className="notice" role="alert"><h2>Connection data did not load</h2><p>No search was completed. Nothing here indicates that a connection is absent.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry connection data</button></div> : null}
    {loadState === "ready" ? <>
      <section className="atlas-research__selection" aria-label="Pinned research">
        <div className="atlas-research__search">
          <label htmlFor="research-query">Add a record</label>
          <input id="research-query" type="search" placeholder="Identifier or title" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} aria-describedby="research-query-help" />
          <small id="research-query-help">Search any record, then pin it. Keep up to six in view.</small>
          {searching ? <p role="status">Searching…</p> : null}
          {search ? <div className="atlas-research__search-results">
            <p role="status">{search.total ? `${search.total.toLocaleString()} matches${search.total > 8 ? "; showing the first 8. Keep typing to narrow them." : "."}` : "No records match. Try a different identifier or title."}</p>
            <ul>{search.records.map(node => <li key={node.id}><button type="button" onClick={() => add(node)} aria-label={`Pin ${node.identity.label} · ${node.identity.publication}`}>
              <strong>{node.identity.label}</strong><span>{node.identity.publication}</span>{node.identity.title ? <small>{node.identity.title}</small> : null}<IconPin aria-hidden="true" size={16} />
            </button></li>)}</ul>
          </div> : null}
        </div>
        <div className="atlas-research__pins">
          <h2>Pinned <span>{pins.length}/6</span></h2>
          {pins.length ? <ul>{pins.map(id => <li key={id}><div><strong>{label(nodes.get(id))}</strong><small>{nodes.get(id)?.identity.publication || "Choose a different record if it is no longer available."}</small></div><button type="button" onClick={() => remove(id)} aria-label={`Remove ${label(nodes.get(id))}`}><IconX aria-hidden="true" size={16} /></button></li>)}</ul> : <p>Pin a starting point and another record to explore the connection between them.</p>}
          {pins.length ? <button type="button" onClick={() => patch({ atlasPins: "", atlasFrom: "", atlasTo: "" })}>Clear pins</button> : null}
        </div>
      </section>
      <div className="atlas-research__modes" role="group" aria-label="Research view">
        <button type="button" aria-pressed={selection.atlasResearch !== "shared"} onClick={() => patch({ atlasResearch: "path" })}>Find a path</button>
        <button type="button" aria-pressed={selection.atlasResearch === "shared"} onClick={() => patch({ atlasResearch: "shared" })}>Shared connections</button>
      </div>
      {selection.atlasResearch !== "shared" ? <div className="atlas-research__controls">
        {(["atlasFrom", "atlasTo"] as const).map((key, i) => <label key={key}>{i === 0 ? "From" : "To"}<select value={selection[key]} onChange={event => patch({ [key]: event.target.value })}><option value="">Choose a pinned record</option>{options.map(id => <option key={id} value={id}>{label(nodes.get(id))} · {nodes.get(id)?.identity.publication || "Unavailable"}</option>)}</select></label>)}
        <button type="button" aria-label="Swap start and end" onClick={() => patch({ atlasFrom: selection.atlasTo, atlasTo: selection.atlasFrom })}>Swap</button>
        <label>Follow links<select value={selection.atlasDirection} onChange={event => patch({ atlasDirection: event.target.value as "forward" | "either" })}><option value="forward">In the recorded direction</option><option value="either">In either direction</option></select></label>
        <label>Search depth<select value={selection.atlasHops} onChange={event => patch({ atlasHops: event.target.value })}>{[1,2,3,4,5,6].map(n => <option value={String(n)} key={n}>Up to {n} {n === 1 ? "step" : "steps"}</option>)}</select></label>
      </div> : <p>Records with a published connection to every pin. Shared links do not mean the requirements are equivalent.</p>}
      {working ? <p role="status">Following published connections…</p> : null}
      {error ? <div className="notice" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry connection data</button></div> : null}
      {!working && !error && !answer ? <p className="atlas-research__empty">{selection.atlasResearch === "shared" ? "Pin at least two records to find their shared connections." : "Choose two different records to find a path."}</p> : null}
      {answer?.result && answer.result.status !== "found" ? <div className="atlas-research__empty" role="status"><h2>{answer.result.status === "invalid_selection" ? "Check the selected records" : answer.result.status === "incomplete" ? "Search limit reached" : "No path found within this search"}</h2><p>{answer.result.status === "invalid_selection" ? "Choose two different, available records. Historical records are not searched in this view."
        : answer.result.status === "incomplete" ? "The search stopped at its work limit. It did not establish that these records are unconnected. Try a closer endpoint."
        : `No path was found within ${selection.atlasHops} steps using ${selection.atlasDirection === "forward" ? "the recorded link direction" : "either direction"}. This covers the connections in Control Atlas, not every possible publisher mapping.`}</p></div> : null}
      {answer ? <div className="atlas-research__results">
        <div className="atlas-research__paths">
          {answer.result?.status === "found" ? <>
            <h2>{path.length} {path.length === 1 ? "step" : "steps"} from {label(nodes.get(selection.atlasFrom))} to {label(nodes.get(selection.atlasTo))}</h2>
            {answer.result.paths.length > 1 ? <div role="group" aria-label="Alternative paths" className="atlas-research__alternatives">{answer.result.paths.map((p, i) => <button type="button" key={i} aria-pressed={pathIndex === i} onClick={() => { setPathIndex(i); setEdgeId(p[0].edge.id); }}>Path {i+1}</button>)}</div> : null}
            <p>Select a connection to see its source.</p>
            <ol className="atlas-research__path" aria-label="Published connection path">
              <li className="atlas-research__waypoint"><AppLink onNavigate={onNavigate} patch={{ node: selection.atlasFrom }} view="library-detail"><strong>{label(nodes.get(selection.atlasFrom))}</strong><span>{nodes.get(selection.atlasFrom)?.identity.publication}</span></AppLink></li>
              {path.map((hop, i) => <li key={hop.edge.id}>
                <button className="atlas-research__hop" type="button" aria-pressed={edgeId === hop.edge.id} onClick={() => inspectEdge(hop.edge.id)} aria-label={`Step ${i+1}: ${label(nodes.get(hop.from))} — ${relation(hop.edge)} — ${label(nodes.get(hop.to))}. Show evidence`}>
                  {hop.traversal === "reverse" ? <IconArrowLeft aria-hidden="true" size={18} /> : <IconArrowRight aria-hidden="true" size={18} />}<span>{relation(hop.edge)}{hop.traversal === "reverse" ? <small>Following this link in reverse</small> : hop.traversal === "undirected" ? <small>Undirected connection</small> : null}</span>
                </button>
                <div className="atlas-research__waypoint"><AppLink onNavigate={onNavigate} patch={{ node: hop.to }} view="library-detail"><strong>{label(nodes.get(hop.to))}</strong><span>{nodes.get(hop.to)?.identity.publication}</span></AppLink>{!pins.includes(hop.to) && nodes.has(hop.to) ? <button type="button" onClick={() => add(nodes.get(hop.to)!)}>Pin {label(nodes.get(hop.to))}</button> : null}</div>
              </li>)}
            </ol>
            {answer.result.moreShortestPaths ? <p>More shortest paths exist; showing the first {answer.result.paths.length}.</p> : null}
            {answer.result.limitedBy ? <p>A valid path was found, but the work limit stopped the remaining search.</p> : null}
          </> : null}
          {answer.kind === "shared" ? <>
            <h2>{answer.sharedTotal?.toLocaleString()} shared connections</h2>
            {!answer.shared?.length ? <p>No record has a published link to every pin in the currently indexed connections.</p> : <ul className="atlas-research__shared">{answer.shared.map(row => <li key={row.nodeId}><AppLink onNavigate={onNavigate} patch={{ node: row.nodeId }} view="library-detail"><strong>{label(nodes.get(row.nodeId))}</strong><span>{nodes.get(row.nodeId)?.identity.publication}</span></AppLink><div>{row.connections.map(connection => <button type="button" key={connection.pinId} onClick={() => inspectEdge(connection.edgeIds[0])}>Connection with {label(nodes.get(connection.pinId))} · {connection.edgeIds.length} {connection.edgeIds.length === 1 ? "link" : "links"}</button>)}</div></li>)}</ul>}
            {(answer.sharedTotal || 0) > 40 ? <div className="atlas-research__actions"><p>Showing {offset+1}–{offset+(answer.shared?.length || 0)} of {answer.sharedTotal}</p><button type="button" disabled={!offset} onClick={() => setOffset(value => Math.max(0,value-40))}>Previous</button><button type="button" disabled={offset+40 >= answer.sharedTotal!} onClick={() => setOffset(value => value+40)}>Next</button></div> : null}
          </> : null}
        </div>
        {selectedEdge ? <div>
          {edgeVariants.length > 1 ? <label className="atlas-research__edge-choices">Published links between these records<select value={edgeId} onChange={event => setEdgeId(event.target.value)}>{edgeVariants.map((edge, i) => <option key={edge.id} value={edge.id}>{i+1}. {relation(edge)}</option>)}</select></label> : null}
          <ResearchEvidence edge={selectedEdge} nodes={nodes} bundle={bundle} onNavigate={onNavigate} />
        </div> : null}
      </div> : null}
      <details className="atlas-research__scope"><summary>About this search</summary><p>Results cover the published connections currently indexed in Control Atlas. Containment, editorial groupings, candidates, and inferred links are excluded. Historical records and connections are not searched. A missing path is not proof that no publisher mapping exists.</p><p>Data snapshot: {manifest?.generatedAt}. {manifest?.edgeCount.toLocaleString()} indexed connections. Each path search is bounded to 5,000 visited records and 25,000 examined connections.</p></details>
    </> : null}
  </section>;
}
