import { useEffect, useMemo, useState } from "react";
import { displayNameFor } from "../../../app/display-names.mjs";
import { ATLAS_RELATIONSHIP_LENSES, buildAtlasContextGroups, buildAtlasContextRows, type AtlasFilterState } from "../../lib/atlasModel";
import type { AtlasNeighborhoodRecord } from "../../lib/runtimeLoader";
import { RelationshipGraphTable } from "../RelationshipGraphTable";

type Status = "loading" | "ready" | "missing" | "error";

function useNeighborhood(nodeId: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ record: AtlasNeighborhoodRecord | null; status: Status }>({ record: null, status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ record: null, status: "loading" });
    import("../../lib/runtimeLoader")
      .then(({ loadAtlasNeighborhood }) => loadAtlasNeighborhood(nodeId))
      .then((record) => { if (live) setState({ record, status: record ? "ready" : "missing" }); })
      .catch(() => { if (live) setState({ record: null, status: "error" }); });
    return () => { live = false; };
  }, [nodeId, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

const relation = (type: string) => displayNameFor("relationship_type", type) || type.replace(/_/g, " ");

/**
 * Every published connection of one record, as a table: the same neighborhood data and the same
 * relationship classes the record's map view draws from. Direction is stated per row; nothing is
 * added, inferred or merged. Structural parent/child rows are the record's own decomposition and
 * stay on its record page.
 */
export function ConnectionList(props: {
  nodeId: string; label: string; type: string; onType: (type: string) => void; onBack: () => void; onOpenNode: (nodeId: string) => void;
}) {
  const { nodeId, label, type, onType } = props;
  const { record, status, retry } = useNeighborhood(nodeId);
  const all: AtlasFilterState = { relationshipType: "", provenance: "", confidence: "", nodeType: "", includeCandidates: false, search: "" };
  const everything = useMemo(() => (record ? buildAtlasContextRows(record, all) : []), [record]);
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of everything) counts.set(row.edge.relationship_type, (counts.get(row.edge.relationship_type) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [everything]);
  const chosen = types.some(([t]) => t === type) ? type : "";
  const filters = { ...all, relationshipType: chosen };
  const rows = useMemo(() => {
    if (!record) return [];
    // The class column uses the same relationship lens the record's connection groups use.
    const lensLabel = new Map(ATLAS_RELATIONSHIP_LENSES.map((l) => [l.id, l.label] as const));
    const byEdge = new Map<string, string>();
    for (const group of buildAtlasContextGroups(record, filters)) for (const item of group.items) byEdge.set(item.edge.id, lensLabel.get(group.lens) || "");
    return buildAtlasContextRows(record, filters).map((row) => ({ ...row, lensLabel: byEdge.get(row.edge.id) || undefined }));
  }, [record, chosen]);

  return (
    <section aria-labelledby="atl-conn-h" className="atl-connections" data-route-content-ready="true">
      <div className="atl-connections__head">
        <div>
          <p className="atl-eyebrow">Full connection list</p>
          <h2 id="atl-conn-h">All connections · {label}</h2>
        </div>
        <button onClick={props.onBack} type="button">Back to the map</button>
      </div>
      {status === "loading" ? <p aria-live="polite" className="atl-note" role="status">Loading connections…</p> : null}
      {status === "error" ? <div className="atl-warn" role="alert"><p>The connection data did not arrive.</p><button onClick={retry} type="button">Try again</button></div> : null}
      {status === "missing" ? <p className="atl-note">No connection data for {label}.</p> : null}
      {status === "ready" && !everything.length ? <p className="atl-note">No published connections for {label}.</p> : null}
      {status === "ready" && everything.length ? (
        <>
          <p className="atl-note">Published connections only.</p>
          {types.length > 1 ? (
            <div className="atl-connections__filter">
              <label htmlFor="atl-conn-type">Relationship</label>
              <select id="atl-conn-type" onChange={(e) => onType(e.target.value)} value={chosen}>
                <option value="">All relationships · {everything.length.toLocaleString()}</option>
                {types.map(([t, n]) => <option key={t} value={t}>{relation(t)} · {n.toLocaleString()}</option>)}
              </select>
            </div>
          ) : null}
          <RelationshipGraphTable centerNodeId={nodeId} conciseTrust onOpenNode={props.onOpenNode} rows={rows} />
        </>
      ) : null}
    </section>
  );
}
