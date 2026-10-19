import { useEffect, useState } from "react";

import { displayNameFor } from "../../app/display-names.mjs";
import { ProvenanceTerm } from "./ProvenanceTerm";
import { ProvenanceBadge } from "../lib/compareHelpers";
import { relationshipExplanation } from "../lib/relationshipProvenance";
import { RecordLink } from "./RecordLink";
import { ListPagination } from "./ListPagination";
import { paginateRows } from "../lib/comparePagination";

type TableRow = {
  edge: {
    id?: string;
    source_node_id?: string;
    target_node_id?: string;
    relationship_type: string;
    relationship_class?: string;
    provenance_class: string;
    publication_status: string;
    confidence: string;
    evidence_ids?: string[];
    source_refs?: Array<{
      source_id?: string;
      ref_type?: string;
      locator?: string;
    }>;
    rationale?: string;
    navigation_note?: string;
  };
  counterpart: { id: string };
  itemId: string;
  title: string;
  // When set, overrides the class column with the same relationship-lens
  // label Map uses for this row, so the two views never disagree on what
  // class a record belongs to (e.g. a CCI reads "Correlation" in both).
  lensLabel?: string;
};

export function RelationshipGraphTable(props: {
  rows: TableRow[];
  onOpenNode: (nodeId: string) => void;
  conciseTrust?: boolean;
  centerNodeId?: string;
}) {
  const { rows, onOpenNode, conciseTrust = false, centerNodeId = "" } = props;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  if (!rows.length) {
    return (
      <p className="muted" id="relationship-table-empty">
        No connections match the current filters. Clear filters or include
        inferred links to see more.
      </p>
    );
  }

  const window = paginateRows(rows, String(page), 50);
  const visibleRows = window.rows;

  return (
    <div className="relationship-graph-table-wrap">
      <p className="relationship-graph-table__count" role="status">
        Showing connections {window.start.toLocaleString()}-{window.end.toLocaleString()} of {rows.length.toLocaleString()}.
      </p>
      <div className="compare-table-scroll">
        <table
        aria-label="Relationship table"
        className="detail-table relationship-graph-table"
      >
        <thead>
          <tr>
            <th scope="col">Connected item</th>
            <th scope="col">Connection</th>
            <th scope="col">Class and direction</th>
            <th scope="col">Evidence</th>
            <th scope="col">Trust level</th>
            <th scope="col">Relationship explanation</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ edge, counterpart, itemId, title, lensLabel }) => {
            const explanation = relationshipExplanation(edge);
            return (
              <tr
                data-record-connection-id={edge.id}
                key={`${edge.id || edge.relationship_type}-${counterpart.id}`}
              >
              <td data-label="Connected item">
                <RecordLink
                  className="link-action"
                  nodeId={counterpart.id}
                  onOpenNode={onOpenNode}
                >
                  <strong>{itemId}</strong> — {title}
                </RecordLink>
              </td>
              <td data-label="Connection">
                {displayNameFor("relationship_type", edge.relationship_type)}
              </td>
              <td data-label="Class and direction">
                <strong>
                  {lensLabel ||
                    (edge.relationship_class === "structural"
                      ? "Structure"
                      : edge.relationship_class === "applicability"
                        ? "Applicability"
                        : "Correlation")}
                </strong>
                <br />
                {centerNodeId && edge.source_node_id === centerNodeId
                  ? "From selected record"
                  : centerNodeId && edge.target_node_id === centerNodeId
                    ? "To selected record"
                    : "Connected records"}
              </td>
              <td data-label="Evidence">
                {conciseTrust ? (
                  <span
                    className={`badge tone-${edge.publication_status === "candidate" ? "warning" : "success"}`}
                  >
                    <ProvenanceTerm
                      kind="provenance"
                      value={edge.provenance_class}
                    />
                  </span>
                ) : (
                  <ProvenanceBadge
                    provenanceClass={edge.provenance_class}
                    publicationStatus={edge.publication_status}
                  />
                )}
              </td>
              <td data-label="Trust level">
                {displayNameFor("confidence", edge.confidence)}
              </td>
              <td data-label="Relationship explanation">
                {explanation ? <><strong>{explanation.label}:</strong> {explanation.text}</> : null}
                {edge.source_refs?.length ? (
                  <details className="relationship-source-refs">
                    <summary>
                      {edge.source_refs.length} source reference
                      {edge.source_refs.length === 1 ? "" : "s"}
                    </summary>
                    <ul>
                      {edge.source_refs.map((reference, index) => (
                        <li key={`${reference.source_id || "source"}-${index}`}>
                          <strong>
                            {reference.source_id
                              ? displayNameFor("source_id", reference.source_id)
                              : "Source"}
                          </strong>
                          {reference.locator ? ` — ${reference.locator}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </td>
            </tr>
            );
          })}
        </tbody>
        </table>
      </div>
      <ListPagination label="Connection pages" noun="connections" {...window} total={rows.length} onPageChange={setPage} />
    </div>
  );
}
