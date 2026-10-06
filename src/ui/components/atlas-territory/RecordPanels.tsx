import type { ReactNode } from "react";
import { displayNameFor } from "../../../app/display-names.mjs";
import type { AtlasGraphSourceEdge } from "../../lib/atlasGraphModel";
import type { ResearchAnswer, ResearchRecord } from "../../lib/atlasResearchIndex";
import { officialSourceFor } from "../../lib/officialSource";
import type { TerritoryResearch } from "../../lib/useTerritoryResearch";
import { AppLink, type AppNavigate } from "../AppLink";

const relation = (edge: AtlasGraphSourceEdge) => displayNameFor("relationship_type", String(edge.relationship_type || "")) || String(edge.relationship_type || "connected to").replace(/_/g, " ");
const undirected = (edge: AtlasGraphSourceEdge) => edge.direction === "undirected" || edge.directed === false;
export const recordLabel = (records: Map<string, ResearchRecord>, id: string) => records.get(id)?.identity.label || id.slice(id.indexOf(":") + 1);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function ResearchNotice(props: { research: TerritoryResearch; what: string }) {
  const { research } = props;
  if (research.failed) return <p className="atl-warn" role="alert">{props.what} could not finish. This does not mean there is no connection. <button onClick={research.retry} type="button">Retry</button></p>;
  if (research.status === "loading" || research.working) return <p aria-live="polite" className="atl-note" role="status">Reading the published connections…</p>;
  return null;
}

export function RecordCard(props: {
  label: string; title: string; publication: string; areaLabel: string; degree: number | null; canTrace: boolean; tracing: boolean;
  onTrace: () => void; pin: ReactNode; fullList: ReactNode; openRecord: ReactNode; loading: boolean; missing?: boolean; notice?: ReactNode;
}) {
  if (props.missing) {
    return (
      <div className="atl-card">
        <p className="atl-eyebrow">Record</p>
        <h2>{props.label}</h2>
        <p>We could not find this record in the current data. The link may be mistyped or made with a different data version. Try the search box above.</p>
      </div>
    );
  }
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Record</p>
      <h2>{props.label}</h2>
      {props.loading ? <p className="atl-note" role="status">Loading the record…</p> : null}
      {props.title ? <p>{props.title}</p> : null}
      {props.notice}
      <dl>
        <dt>Where it sits</dt><dd>{props.areaLabel ? `${props.areaLabel} › ` : ""}{props.publication}</dd>
        {props.degree !== null ? <><dt>Published connections</dt><dd>{plural(props.degree, "connection")} in the current data</dd></> : null}
      </dl>
      <div className="atl-actions">
        {props.canTrace && !props.tracing ? <button className="atl-primary" onClick={props.onTrace} type="button">Trace upstream</button> : null}
        {props.pin}
        {props.openRecord}
        {props.fullList}
      </div>
    </div>
  );
}

export function TrailCard(props: {
  kind: "upstream" | "path"; research: TerritoryResearch; from: string; to?: string; pathIndex: number; onPath: (i: number) => void;
  selectedHop: number | null; onHop: (i: number) => void; onRecord: (id: string) => void; direction: "forward" | "either"; onDirection: (d: "forward" | "either") => void;
}) {
  const { research, kind, pathIndex } = props;
  const answer = research.answer;
  const result = answer?.result;
  const paths = result?.paths || [];
  const path = paths[pathIndex] || [];
  const label = (id: string) => recordLabel(research.records, id);
  const heading = kind === "upstream" ? `Upstream from ${label(props.from)}` : `${label(props.from)} to ${props.to ? label(props.to) : "…"}`;
  const pub = (id: string) => research.records.get(id)?.identity.publication || "";
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Research path{path.length ? ` · ${plural(path.length, "step")}` : ""}</p>
      <h2>{heading}</h2>
      <ResearchNotice research={research} what="The search" />
      {result?.status === "found" && path.length ? (
        <>
          {paths.length > 1 ? (
            <div aria-label="Routes" className="atl-types" role="group">
              {paths.map((p, i) => <button aria-pressed={i === pathIndex} key={i} onClick={() => props.onPath(i)} type="button">{i + 1}. {label(p[p.length - 1].to)}</button>)}
            </div>
          ) : null}
          <ol className="atl-steps">
            <li><button onClick={() => props.onRecord(path[0].from)} type="button"><b>{label(path[0].from)}</b><small>{pub(path[0].from)}</small></button></li>
            {path.map((hop, i) => (
              <li key={`${hop.edge.id}:${i}`}>
                <button aria-pressed={props.selectedHop === i} className="atl-steps__seg" onClick={() => props.onHop(i)} type="button">
                  {hop.traversal === "reverse" ? "↑" : "↓"} {relation(hop.edge)} <small>Open evidence</small>
                </button>
                <button onClick={() => props.onRecord(hop.to)} type="button"><b>{label(hop.to)}</b><small>{pub(hop.to)}</small></button>
              </li>
            ))}
          </ol>
          {result.moreShortestPaths ? <p className="atl-note">More equally short routes exist than are shown.</p> : null}
          <p className="atl-note">A path connects published statements. It is not a new direct mapping or proof of compliance.</p>
        </>
      ) : null}
      {result && result.status !== "found" ? (
        <p>
          {result.status === "invalid_selection" ? "One of these records is not in the connection data."
            : result.status === "incomplete" ? "The search reached its limit before it finished, so this is not a statement that no connection exists."
              : kind === "upstream" ? `No published connection leads from ${label(props.from)} to a control catalog within ${result.bounds.maxHops} steps.`
                : `No published path joins these within ${result.bounds.maxHops} steps${props.direction === "forward" ? " that follows the recorded direction" : ""}.`}
        </p>
      ) : null}
      {kind === "path" ? (
        <div className="atl-actions"><button aria-pressed={props.direction === "either"} onClick={() => props.onDirection(props.direction === "either" ? "forward" : "either")} type="button">Also follow links backwards</button></div>
      ) : null}
    </div>
  );
}

export function EvidenceCard(props: {
  edge: AtlasGraphSourceEdge; records: Map<string, ResearchRecord>; getSource: (id: string) => any; onNavigate: AppNavigate; onBack?: () => void;
}) {
  const { edge, records } = props;
  const refs = Array.isArray(edge.source_refs) ? edge.source_refs.filter((r) => r && typeof r === "object") : [];
  const dir = undirected(edge);
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Why connected</p>
      <h2>{recordLabel(records, edge.source_node_id)} {dir ? "↔" : "→"} {recordLabel(records, edge.target_node_id)}</h2>
      {typeof edge.rationale === "string" && edge.rationale ? <p>{edge.rationale}</p> : null}
      <dl>
        <dt>Relationship</dt><dd>{relation(edge)}{edge.relationship_class ? ` (published ${edge.relationship_class})` : ""}</dd>
        <dt>Direction</dt><dd>{dir ? "No direction specified by this connection" : "The arrow follows the recorded source connection"}</dd>
        <dt>Status</dt><dd>{String(edge.lifecycle_status || edge.status || "Not recorded")}</dd>
        {typeof edge.source_locator === "string" && edge.source_locator ? <><dt>Exact location</dt><dd className="atl-wrap">{edge.source_locator}</dd></> : null}
      </dl>
      {refs.map((ref, i) => {
        const source = typeof ref.source_id === "string" ? props.getSource(ref.source_id) : null;
        const official = officialSourceFor(source);
        const version = typeof ref.source_version === "string" ? ref.source_version : "";
        return (
          <section className="atl-source" key={`${ref.source_id}:${i}`}>
            <h3>{source?.display_name || source?.name || "Source details unavailable"}</h3>
            <dl>
              {version || source?.version ? <><dt>{version ? "Cited version" : "Registered version"}</dt><dd>{version || source.version}</dd></> : null}
              {typeof ref.locator === "string" && ref.locator !== edge.source_locator ? <><dt>Exact location</dt><dd className="atl-wrap">{ref.locator}</dd></> : null}
            </dl>
            {source?.id ? <AppLink onNavigate={props.onNavigate} patch={{ source: source.id }} view="sources">View source details</AppLink> : null}
            {/^https?:\/\//.test(official.url) ? <a href={official.url} rel="noopener noreferrer" target="_blank">{official.isDownload ? "Download official source" : "View official source"}</a> : null}
          </section>
        );
      })}
      {!refs.length ? <p className="atl-note">The source file is recorded, but its publication details are unavailable here.</p> : null}
      {props.onBack ? <div className="atl-actions"><button onClick={props.onBack} type="button">Back to path</button></div> : null}
    </div>
  );
}

export function RecordSharedCard(props: {
  pins: readonly string[]; research: TerritoryResearch; answer: ResearchAnswer | null; onRecord: (id: string) => void; onEdge: (edgeId: string) => void;
}) {
  const { research, answer } = props;
  const label = (id: string) => recordLabel(research.records, id);
  const pub = (id: string) => research.records.get(id)?.identity.publication || "";
  const all = answer?.shared || [];
  const some = answer?.some || [];
  const row = (r: { nodeId: string; connections: Array<{ pinId: string; edgeIds: string[] }> }) => (
    <li key={r.nodeId}>
      <button onClick={() => props.onRecord(r.nodeId)} type="button"><b>{label(r.nodeId)}</b><small>{pub(r.nodeId)}</small></button>
      <div className="atl-types">{r.connections.map((c) => <button key={c.pinId} onClick={() => props.onEdge(c.edgeIds[0])} type="button">With {label(c.pinId)} · {plural(c.edgeIds.length, "link")}</button>)}</div>
    </li>
  );
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Shared ground · {props.pins.length} pinned</p>
      <h2>{props.pins.map(label).join(", ")}</h2>
      <ResearchNotice research={research} what="The search" />
      {answer && !all.length && !some.length ? <p><b>Nothing is shared</b> in the published connections we have. No record has a published link to {props.pins.length > 2 ? "two or more of" : "both"} these records.</p> : null}
      {all.length ? <><p>Connected to every pin · {(answer?.sharedTotal || all.length).toLocaleString()}</p><ul className="atl-list">{all.map(row)}</ul></> : null}
      {some.length ? <><p>Connected to some</p><ul className="atl-list">{some.map(row)}</ul></> : null}
      <p className="atl-note">A shared connection does not mean the records are equivalent.</p>
    </div>
  );
}
