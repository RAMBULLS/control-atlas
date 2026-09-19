import type { ReactNode } from "react";
import type { ContextIndex, ContextMatch, ContextResult, ContextTerm } from "../../lib/atlasTerritoryContext";
import type { TerritoryModel } from "../../lib/atlasTerritoryModel";

const n = (value: number) => value.toLocaleString();
const records = (value: number) => `${n(value)} ${value === 1 ? "record" : "records"}`;

/** Choose what you are working with. Choices are record tags; nothing here claims applicability. */
export function ContextMenu(props: { context: ContextIndex; selected: readonly string[]; onToggle: (id: string) => void; onClear: () => void }) {
  return (
    <div aria-label="Context" className="atl-pop atl-pop--context" role="dialog">
      <p className="atl-note">Choose what you are working with. The map highlights publications that contain records associated with your choices. That does not mean the material applies to you.</p>
      {props.context.dimensions.map((dimension) => {
        const terms = props.context.terms.filter((t) => t.dimension === dimension.id);
        if (!terms.length) return null;
        return (
          <section aria-label={dimension.label} className="atl-context__group" key={dimension.id}>
            <h3>{dimension.label}</h3>
            <div className="atl-types">
              {terms.map((t) => (
                <button aria-pressed={props.selected.includes(t.id)} key={t.id} onClick={() => props.onToggle(t.id)} type="button">{t.label} · {n(t.records)}</button>
              ))}
            </div>
          </section>
        );
      })}
      {props.selected.length ? <button onClick={props.onClear} type="button">Clear context</button> : null}
    </div>
  );
}

/** The current context, always visible while it is on. */
export function ContextBar(props: { terms: readonly ContextTerm[]; onRemove: (id: string) => void; onClear: () => void; older: boolean }) {
  if (!props.terms.length && !props.older) return null;
  return (
    <section aria-label="Current context" className="atl-context">
      {props.terms.length ? (
        <>
          <span className="atl-context__lead">Showing material for:</span>
          <ul>{props.terms.map((t) => <li key={t.id}>{t.label} <button aria-label={`Remove ${t.label}`} onClick={() => props.onRemove(t.id)} type="button">×</button></li>)}</ul>
          <button onClick={props.onClear} type="button">Clear context</button>
        </>
      ) : null}
      {props.older ? <p className="atl-note atl-context__note">This link was made from an earlier version of the data, so results here may differ from what its sender saw.</p> : null}
    </section>
  );
}

function Breakdown(props: { terms: readonly ContextTerm[]; match: ContextMatch }) {
  return <ul className="atl-breakdown">{props.terms.map((t) => <li key={t.id}>{t.label} · {n(props.match.byTag[t.id] || 0)}</li>)}</ul>;
}

/** Which publications contain matching records, and why each matched. */
export function ContextResultsCard(props: {
  result: ContextResult; terms: readonly ContextTerm[]; model: TerritoryModel;
  onSelect: (id: string) => void; onRemove: (id: string) => void; onClear: () => void;
  viewRecords: (catalogId: string | null) => ReactNode;
}) {
  const { result, terms, model } = props;
  if (result.empty) {
    return (
      <div className="atl-card">
        <p className="atl-eyebrow">Context</p>
        <h2>No records match this context</h2>
        <p>No record carries every one of these choices together. Remove a choice to widen it.</p>
        <div className="atl-actions">
          {terms.map((t) => <button key={t.id} onClick={() => props.onRemove(t.id)} type="button">Clear {t.label}</button>)}
          <button onClick={props.onClear} type="button">Clear context</button>
        </div>
      </div>
    );
  }
  const rows = [...result.publications].sort(([a, x], [b, y]) => y.records - x.records || model.alias(a).localeCompare(model.alias(b)));
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Context · {records(result.total)}</p>
      <h2>Publications with matching records</h2>
      <p>Showing publications containing records associated with this context. A publication is highlighted because some of its records match. It does not mean the publication itself has these choices, that every record in it matches, or that it applies to you.</p>
      <ul className="atl-list">
        {rows.map(([id, match]) => (
          <li key={id}>
            <button onClick={() => props.onSelect(id)} type="button"><b>{model.alias(id)}</b><small>{records(match.records)} match</small></button>
            <Breakdown match={match} terms={terms} />
            <div className="atl-actions">{props.viewRecords(id)}</div>
          </li>
        ))}
      </ul>
      <div className="atl-actions">{rows.length > 1 ? props.viewRecords(null) : null}</div>
    </div>
  );
}

/** Shown inside a publication's details while a context is on. */
export function ContextMatchSection(props: { match: ContextMatch | undefined; terms: readonly ContextTerm[]; viewRecords: ReactNode }) {
  if (!props.terms.length) return null;
  return (
    <section aria-label="Matching this context" className="atl-source">
      <h3>Matching this context</h3>
      {props.match ? (
        <>
          <p>{records(props.match.records)} in this publication are associated with your choices.</p>
          <Breakdown match={props.match} terms={props.terms} />
          <div className="atl-actions">{props.viewRecords}</div>
        </>
      ) : <p>No records in this publication match this context.</p>}
    </section>
  );
}
