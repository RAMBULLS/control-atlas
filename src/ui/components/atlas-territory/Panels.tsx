import type { ReactNode } from "react";
import { displayNameFor } from "../../../app/display-names.mjs";
import type { TerritoryListed, TerritoryIndexRoute } from "../../lib/atlasTerritoryIndex";
import type { TerritoryModel, Hit } from "../../lib/atlasTerritoryModel";
import type { RouteReveal } from "../../lib/atlasTerritoryRoutes";
import type { SharedGround } from "../../lib/atlasTerritoryShared";
import { AppLink, type AppNavigate } from "../AppLink";

export type RecordHit = { type: "record"; id: string; label: string; sub: string };
export type AnyHit = Hit | RecordHit;

const relation = (type: string) => displayNameFor("relationship_type", type) || type.replace(/_/g, " ");
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function Breadcrumb(props: { model: TerritoryModel; areaId: string | null; publicationId: string | null; label?: string }) {
  const { model, areaId, publicationId, label } = props;
  if (!areaId && !label) return null;
  return (
    <nav aria-label="Where you are" className="atl-crumb">
      <span>Atlas</span>
      {areaId ? <><i aria-hidden="true">›</i><span>{model.areaById.get(areaId)?.label}</span></> : null}
      {publicationId ? <><i aria-hidden="true">›</i><span>{model.alias(publicationId)}</span></> : null}
      {label ? <><i aria-hidden="true">›</i><b>{label}</b></> : null}
    </nav>
  );
}

export function SearchBox(props: {
  query: string; open: boolean; hits: readonly AnyHit[]; onQuery: (value: string) => void; onPick: (hit: AnyHit) => void; onClose: () => void; ready: boolean;
}) {
  const { query, open, hits, onQuery, onPick, onClose, ready } = props;
  return (
    <div className="atl-search" role="search">
      <label className="atl-sr" htmlFor="atlas-search">Search records and publications</label>
      <input
        aria-controls="atlas-results" aria-expanded={open} aria-haspopup="listbox" autoComplete="off" id="atlas-search"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && hits[0]) onPick(hits[0]); }}
        placeholder="Search a record or publication, e.g. V-205646" role="combobox" type="search" value={query}
      />
      {open ? (
        <ul className="atl-search__results" id="atlas-results" role="listbox">
          {hits.length ? hits.map((h) => (
            <li aria-selected="false" key={`${h.type}:${h.id}`} role="option"><button onClick={() => onPick(h)} type="button"><b>{h.label}</b><small>{h.sub}</small></button></li>
          )) : <li className="atl-search__none" role="presentation">{ready ? `Nothing matches “${query.trim()}”. Try a control number, a STIG ID, or a publication name.` : "Record search is still loading. Publications are searchable now."}</li>}
        </ul>
      ) : null}
    </div>
  );
}

export function LayersMenu(props: { publishers: readonly string[]; publisher: string; onPublisher: (value: string) => void }) {
  return (
    <div aria-label="Layers" className="atl-pop atl-pop--layers" role="dialog">
      <label htmlFor="layer-publisher">Publisher</label>
      <select id="layer-publisher" onChange={(e) => props.onPublisher(e.target.value)} value={props.publisher}>
        <option value="">All publishers</option>
        {props.publishers.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <p className="atl-note">A layer changes how the map is drawn. It never moves a landmark.</p>
    </div>
  );
}

export function AuthorityPanel({ items }: { items: readonly TerritoryListed[] }) {
  return (
    <div aria-label="Authority documents" className="atl-pop atl-pop--authority" role="region">
      <h2>Authority · {items.length}</h2>
      <p className="atl-note">Statutes, regulations and directives. They publish no crosswalks, so no routes lead to them. They are context, not missing publications.</p>
      <ul>{items.map((a) => <li key={a.id}>{a.name}<small>{a.publisher}</small></li>)}</ul>
    </div>
  );
}

export function OtherPanel({ items }: { items: readonly TerritoryListed[] }) {
  return (
    <div aria-label="Other publications" className="atl-pop atl-pop--other" role="dialog">
      <h2>Other publications · {items.length}</h2>
      <p className="atl-note">Not yet placed in a territory.</p>
      <ul>{items.map((p) => <li key={p.id}>{p.name}<small>{p.publisher}</small></li>)}</ul>
    </div>
  );
}

export const HelpPanel = () => (
  <div aria-label="About this map" className="atl-pop atl-pop--help" role="dialog">
    <h2>About this map</h2>
    <p>Territories organize Control Atlas material for navigation. Neighboring territories do not imply authority, applicability, equivalence, dependency or hierarchy.</p>
    <p>A line means published records connect two places. Every line opens the evidence behind it.</p>
    <p className="atl-note">At overview the map names a reviewed set of major publications. Select a territory to see all of its publications.</p>
  </div>
);

export function PinTray(props: {
  pins: readonly string[]; label: (id: string) => string; onUnpin: (id: string) => void; onClear: () => void;
  canShare: boolean; onShare: () => void; canTrace: boolean; onTrace: () => void; traceLabel: string; compare: ReactNode;
}) {
  const { pins } = props;
  if (!pins.length) return null;
  return (
    <section aria-label="Pinned" className="atl-tray">
      <div className="atl-tray__row">
        <b>Pinned · {pins.length}</b>
        <ul>{pins.map((id) => <li key={id}>{props.label(id)} <button aria-label={`Unpin ${props.label(id)}`} onClick={() => props.onUnpin(id)} type="button">×</button></li>)}</ul>
      </div>
      <div className="atl-tray__actions">
        {props.canShare ? <button onClick={props.onShare} type="button">Find shared connections</button> : null}
        {props.canTrace ? <button onClick={props.onTrace} type="button">{props.traceLabel}</button> : null}
        {props.compare}
        {pins.length < 2 ? <small>Pin one more to find what they share.</small> : null}
        <button onClick={props.onClear} type="button">Clear pins</button>
      </div>
    </section>
  );
}

export function PinButton(props: { pinned: boolean; label: string; full: boolean; onToggle: () => void }) {
  if (!props.pinned && props.full) return <small className="atl-note">Six pins is the limit. Unpin one to add another.</small>;
  return <button aria-pressed={props.pinned} onClick={props.onToggle} type="button">{props.pinned ? `Unpin ${props.label}` : `Pin ${props.label}`}</button>;
}

export function TerritoryCard(props: { model: TerritoryModel; areaId: string; onSelect: (id: string) => void }) {
  const a = props.model.areaById.get(props.areaId)!;
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Territory</p>
      <h2>{a.label}</h2>
      <p>{a.blurb}</p>
      {a.publicationIds.length
        ? <ul className="atl-chips">{a.publicationIds.map((id) => <li key={id}><button onClick={() => props.onSelect(id)} type="button">{props.model.alias(id)}</button></li>)}</ul>
        : <p className="atl-note">No publications are placed here yet.</p>}
    </div>
  );
}

export function PublicationCard(props: {
  model: TerritoryModel; id: string; reveal: RouteReveal; types: readonly string[]; onToggleType: (type: string) => void; onShowAll: () => void;
  onRoute: (key: string) => void; pin: ReactNode; onNavigate: AppNavigate;
}) {
  const { model, id, reveal } = props;
  const p = model.publicationById.get(id)!;
  const total = reveal.all.length;
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Publication</p>
      <h2>{model.alias(id)}</h2>
      {model.alias(id) !== p.name ? <p>{p.name}</p> : null}
      <dl>
        <dt>Publisher</dt><dd>{p.publisher} · {p.kind}</dd>
        <dt>Where it sits</dt><dd>{model.areaOf(id).label} territory</dd>
        {p.records ? <dt>Records</dt> : null}{p.records ? <dd>{p.records.toLocaleString()}</dd> : null}
        <dt>Published connections</dt>
        <dd>{total ? `${plural(total, "other publication")} share published connections with this one.` : "No published relationship is currently available between this and other mapped publications."}</dd>
      </dl>
      {total ? (
        <>
          {reveal.typeCounts.length > 1 ? (
            <div aria-label="Relationship types" className="atl-types" role="group">
              {reveal.typeCounts.map((t) => <button aria-pressed={props.types.includes(t.type)} key={t.type} onClick={() => props.onToggleType(t.type)} type="button">{relation(t.type)} · {t.count}</button>)}
            </div>
          ) : null}
          <p className="atl-note">{reveal.expanded ? `Showing all ${plural(reveal.matching.length, "connection")} on the map.` : `Showing ${reveal.visible.length} of ${reveal.matching.length} on the map, the ones with the most published record connections.`}</p>
          {!reveal.expanded ? <button onClick={props.onShowAll} type="button">Show all {reveal.matching.length}</button> : null}
          <ul className="atl-chips">{reveal.matching.map((r) => { const other = r.a === id ? r.b : r.a; return <li key={r.key}><button onClick={() => props.onRoute(r.key)} type="button">{model.alias(other)}</button></li>; })}</ul>
        </>
      ) : null}
      <div className="atl-actions">
        {props.pin}
        <AppLink onNavigate={props.onNavigate} patch={{ catalog: id }} view="catalog-detail">Open in the Library</AppLink>
      </div>
    </div>
  );
}

export function RouteCard(props: { model: TerritoryModel; route: TerritoryIndexRoute }) {
  const { model, route: r } = props; const s = r.sample;
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Why connected · publications</p>
      <h2>{model.alias(r.from)} → {model.alias(r.to)}</h2>
      <dl>
        <dt>Relationship</dt><dd>{r.types.map(relation).join(", ")}{s.relationshipClass ? ` (published ${s.relationshipClass})` : ""}</dd>
        <dt>Direction</dt><dd>{r.bidirectional ? `Published in both directions (${r.aToB.toLocaleString()} and ${r.bToA.toLocaleString()})` : `${model.alias(r.from)} → ${model.alias(r.to)}`}. {plural(r.total, "published record connection")}.</dd>
        {s.sourceName ? <><dt>Published in</dt><dd>{s.sourceName}{s.sourceVersion ? ` · ${s.sourceVersion}` : ""}</dd></> : null}
        <dt>Example location</dt><dd className="atl-wrap">{s.locator}</dd>
        <dt>Status</dt><dd>{s.lifecycle || "active"}</dd>
      </dl>
      <p className="atl-note">This line summarizes published records. It does not mean the two publications are equivalent.</p>
    </div>
  );
}

export function SharedCard(props: { model: TerritoryModel; pins: readonly string[]; ground: SharedGround; onSelect: (id: string) => void; onRoute: (key: string) => void }) {
  const { model, pins, ground } = props;
  const names = (ids: readonly string[]) => ids.map(model.alias).join(", ");
  return (
    <div className="atl-card">
      <p className="atl-eyebrow">Shared ground · {pins.length} pinned</p>
      <h2>{names(pins)}</h2>
      {ground.none ? <p><b>Nothing is shared.</b> No published route joins these directly, and no publication connects to more than one of them. That is an answer, not a failure to load.</p> : null}
      {ground.direct.length ? <><p>Published routes between them:</p><ul className="atl-chips">{ground.direct.map((r) => <li key={r.key}><button onClick={() => props.onRoute(r.key)} type="button">{model.alias(r.a)} · {model.alias(r.b)}</button></li>)}</ul></> : null}
      {ground.all.length ? <><p>Connected to every pin:</p><ul className="atl-chips">{ground.all.map((id) => <li key={id}><button onClick={() => props.onSelect(id)} type="button">{model.alias(id)}</button></li>)}</ul></> : null}
      {ground.some.length ? <><p>Connected to some:</p><ul className="atl-list">{ground.some.map((s) => <li key={s.id}><button onClick={() => props.onSelect(s.id)} type="button"><b>{model.alias(s.id)}</b><small>with {names(s.pins)}</small></button></li>)}</ul></> : null}
      {pins.some((p) => ground.unique[p]?.length) ? <details className="atl-inline"><summary>Connected to only one pin</summary>{pins.map((p) => ground.unique[p]?.length ? <p key={p}><b>{model.alias(p)}</b>: {names(ground.unique[p])}</p> : null)}</details> : null}
      <p className="atl-note">Territories that sit next to each other are neighbors for navigation only. A shared connection does not mean equivalence.</p>
    </div>
  );
}
