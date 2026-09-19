import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { areaCssVariables, AREA_PRESENTATIONS } from "../../lib/areaVisualLanguage";
import type { Pt } from "../../lib/atlasTerritoryGeography";
import { boundsOf, fitView, type TerritoryModel, type View } from "../../lib/atlasTerritoryModel";
import type { TerritoryRoute } from "../../lib/atlasTerritoryRoutes";
import { hitsRects, rectsOverlap, routeBetween, type Rect, type Routed } from "../../lib/atlasTerritoryRouting";
import type { TerritoryListed } from "../../lib/atlasTerritoryIndex";
import type { ContextMatch } from "../../lib/atlasTerritoryContext";

export type MapRecord = { id: string; code: string; catalogId: string; pinned: boolean; focused: boolean };
export type MapHop = { key: string; from: string; to: string; fromCatalog: string; toCatalog: string; label: string; selected: boolean };

export type MapActions = {
  selectDistrict: (id: string) => void;
  selectPublication: (id: string) => void;
  selectRoute: (key: string) => void;
  selectRecord: (id: string) => void;
  selectHop: (index: number) => void;
  openAuthority: () => void;
  closeInspector: () => void;
};

export type MapProps = {
  model: TerritoryModel;
  size: { w: number; h: number };
  focusAreaId: string | null;
  focusPublication: string | null;
  selectedRouteKey: string | null;
  revealed: readonly TerritoryRoute[];
  pins: readonly string[];
  /** Publications the current answer is about (path ends, shared ground); everything else dims. */
  active: ReadonlySet<string>;
  sharedLines: readonly (readonly [string, string])[];
  publisher: string;
  records: readonly MapRecord[];
  hops: readonly MapHop[];
  authority: readonly TerritoryListed[];
  inspectorInset: number;
  /** Publications containing records that match the chosen context; null when no context is on. Styling only. */
  context: ReadonlyMap<string, ContextMatch> | null;
};

const onKey = (run: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); } };
const PIN = "M0,0 C-5,-9 -9,-13 -9,-19 a9,9 0 1 1 18,0 c0,6 -4,10 -9,19 z";
const d = (pts: readonly Pt[]) => `M${pts.map((p) => p.join(" ")).join("L")}Z`;
const centroid = (pts: readonly Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const scaled = (pts: readonly Pt[], k: number): string => {
  const c = centroid(pts);
  return `M${pts.map((p) => `${(c[0] + (p[0] - c[0]) * k).toFixed(1)} ${(c[1] + (p[1] - c[1]) * k).toFixed(1)}`).join("L")}Z`;
};
const styleFor = (areaId: string) => {
  const area = AREA_PRESENTATIONS.find((a) => a.id === areaId);
  return (area ? areaCssVariables(area) : {}) as CSSProperties;
};
const relationLabel = (types: readonly string[]) => types.join(" · ").replace(/_/g, " ");

export function TerritoryMap(props: MapProps & { actions: MapActions }) {
  const { model, size, focusAreaId, focusPublication, selectedRouteKey, revealed, pins, active, sharedLines, publisher, records, hops, authority, inspectorInset, context, actions } = props;
  const [hover, setHover] = useState<{ kind: "publication" | "district" | "route" | "shore"; id: string } | null>(null);
  const aspect = size.w / Math.max(1, size.h);
  const dimming = active.size > 0 || !!selectedRouteKey || hops.length > 0;
  const overview: View = model.geometry.overview;
  const pos = model.position;

  const target = useMemo<View>(() => {
    const usable = Math.max(0.5, (size.w - inspectorInset) / Math.max(1, size.h));
    const widen = (v: View): View => (inspectorInset ? { ...v, w: v.w * (size.w / (size.w - inspectorInset)) } : v);
    if (dimming && active.size) return widen(fitView(boundsOf([...active].map(pos), 190), usable));
    if (focusPublication && revealed.length) return widen(fitView(boundsOf([focusPublication, ...revealed.flatMap((r) => [r.a, r.b])].map(pos), 150), usable));
    if (focusAreaId) return widen(fitView(boundsOf(model.areaById.get(focusAreaId)!.polygon, 120), usable));
    return fitView(overview, aspect);
  }, [dimming, active, focusAreaId, focusPublication, revealed, aspect, inspectorInset, size.w, size.h, model, overview, pos]);

  const [view, setView] = useState<View>(target);
  const viewRef = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { viewRef.current = target; setView(target); return undefined; }
    const from = viewRef.current; const t0 = performance.now(); let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 460); const e = 1 - (1 - k) ** 3;
      const v = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      viewRef.current = v; setView(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y, target.w, target.h]);

  const u = view.w / Math.max(1, size.w);
  // Text is screen-constant, so on a narrow map it is scaled down to keep names inside their territories.
  const ut = u * Math.min(1, Math.max(0.72, size.w / 1100));
  const fontPx = 14 * ut;
  const viewRect: Rect = { x0: target.x, y0: target.y, x1: target.x + target.w, y1: target.y + target.h };
  const hoverPublication = hover?.kind === "publication" ? hover.id : null;
  const recordCatalogs = new Set(records.map((r) => r.catalogId));
  const pinned = new Set(pins.filter((p) => model.publicationById.has(p)));
  const connected = new Set(revealed.flatMap((r) => [r.a, r.b]).filter((id) => id !== focusPublication));

  const partnersOf = (id: string): Pt[] => {
    const out: Pt[] = [];
    for (const h of hops) { if (h.fromCatalog === id) out.push(pos(h.toCatalog)); if (h.toCatalog === id) out.push(pos(h.fromCatalog)); }
    if (selectedRouteKey) { const [a, b] = selectedRouteKey.split("|"); if (a === id) out.push(pos(b)); if (b === id) out.push(pos(a)); }
    return out;
  };
  const labelSide = (id: string): 1 | -1 => {
    const p = pos(id); const partners = partnersOf(id);
    if (!partners.length) {
      const w = model.alias(id).length * 0.6 * 14.5 + 30;
      const blocked = model.publications.some((o) => o.id !== id && Math.abs(pos(o.id)[1] - p[1]) < 22 && pos(o.id)[0] - p[0] > 0 && pos(o.id)[0] - p[0] < w);
      return p[0] > 1330 || blocked ? -1 : 1;
    }
    return partners.reduce((s, q) => s + (q[0] - p[0]), 0) / partners.length > 0 ? -1 : 1;
  };
  // With a publication open and little free map beside the inspector, name only what the view is about; the inspector lists the rest.
  const tight = (!!focusPublication || records.length > 0) && inspectorInset > 0 && size.w - inspectorInset < 720;
  const showName = (id: string) => (context ? context.has(id) : !tight && model.isMajor(id)) || (!tight && focusAreaId === model.areaOf(id).id) || hoverPublication === id || focusPublication === id
    || pinned.has(id) || active.has(id) || connected.has(id) || recordCatalogs.has(id);
  const labelRect = (id: string, lines = 1): Rect => {
    const p = pos(id); const side = labelSide(id);
    const w = model.alias(id).length * 0.6 * fontPx + 10 * u; const h = fontPx * (1.25 + (lines - 1) * 1.15);
    const x0 = side === 1 ? p[0] + 8 * u : p[0] - 8 * u - w;
    return { x0, y0: p[1] - fontPx * 0.75, x1: x0 + w, y1: p[1] - fontPx * 0.75 + h };
  };
  const nameRects: Rect[] = model.areas.map((a) => {
    const chars = Math.max(...a.name.lines.map((l) => l.length)); const focused = focusAreaId === a.id;
    const blurbW = a.blurb.length * 12.5 * 0.56 * ut;
    return { x0: a.name.x - 4 * u, y0: a.name.y - 26 * ut, x1: a.name.x + Math.max(chars * 19.5 * ut, focused ? blurbW : 0), y1: a.name.y + (a.name.lines.length - 1) * 27 * ut + (focused ? 26 * ut : 8 * ut) };
  });
  const avoid: Rect[] = [...[...active].map((id) => labelRect(id, recordCatalogs.has(id) ? 2 : 1)), ...nameRects];
  const labeledRects: Rect[] = [...model.publications.filter((p) => showName(p.id)).map((p) => labelRect(p.id, 1)), ...nameRects];
  const routeFor = (a: string, b: string): Routed => routeBetween(pos(a), pos(b), avoid, 12 * u, 30 * u, viewRect);
  const placeLabel = (g: Routed, text: string): Pt => {
    const mid = g.mid; const w = text.length * 0.62 * 12.5 * u + 6 * u; const gap = 16 * u;
    const cands: Pt[] = [
      [mid[0], mid[1] - gap], [mid[0], mid[1] + gap + 8 * u], [mid[0] + w / 2 + gap, mid[1] + 4 * u], [mid[0] - w / 2 - gap, mid[1] + 4 * u],
      [mid[0] + w / 2 + gap, mid[1] - gap], [mid[0] - w / 2 - gap, mid[1] - gap], [mid[0] + w / 2 + gap, mid[1] + gap + 8 * u], [mid[0] - w / 2 - gap, mid[1] + gap + 8 * u],
    ];
    for (const c of cands) {
      const r: Rect = { x0: c[0] - w / 2, x1: c[0] + w / 2, y0: c[1] - 14 * u, y1: c[1] + 6 * u };
      if (!avoid.some((a) => rectsOverlap(r, a)) && hitsRects(g.pts, [r]) === 0) return c;
    }
    return cands[0];
  };

  const hopRoutes = hops.map((h) => routeFor(h.fromCatalog, h.toCatalog));
  const publisherOn = !!publisher;
  const isHoverDistrict = (id: string) => (hover?.kind === "district" && hover.id === id) || (hoverPublication && model.areaOf(hoverPublication).id === id);

  return (
    <svg aria-label="Control Atlas territory map. Territories organize the material for navigation; they do not imply authority, applicability or equivalence." className={`terr${dimming ? " is-dimming" : ""}`} role="group" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
      <defs>
        <filter height="120%" id="terr-lift" width="120%" x="-10%" y="-10%"><feDropShadow dx="0" dy={5 * u} floodOpacity="0.55" style={{ floodColor: "var(--ca-surface-deep)" }} stdDeviation={9 * u} /></filter>
        <filter height="110%" id="terr-glow" width="110%" x="-5%" y="-5%"><feGaussianBlur stdDeviation={16 * u} /></filter>
        <marker id="terr-tip" markerHeight={10 * u} markerUnits="userSpaceOnUse" markerWidth={10 * u} orient="auto" refX="9" refY="5" viewBox="0 0 10 10"><path d="M0,1 L9,5 L0,9 Z" fill="context-stroke" /></marker>
      </defs>
      <rect className="terr__sea" height={view.h * 3} onClick={actions.closeInspector} width={view.w * 3} x={view.x - view.w} y={view.y - view.h} />
      <g aria-hidden="true" className="terr__grid">
        {Array.from({ length: 33 }, (_, i) => <line key={`v${i}`} x1={i * 50} x2={i * 50} y1={-100} y2={1100} />)}
        {Array.from({ length: 23 }, (_, i) => <line key={`h${i}`} x1={-100} x2={1700} y1={i * 50} y2={i * 50} />)}
      </g>
      <path aria-hidden="true" className="terr__glow" d={d(model.coast)} filter="url(#terr-glow)" />

      <g className="terr__districts">
        {model.areas.map((a, i) => {
          const isFocus = focusAreaId === a.id; const isHover = isHoverDistrict(a.id);
          return (
            <g className={`district${isFocus ? " is-focus" : ""}${isHover ? " is-hover" : ""}${a.empty ? " is-empty" : ""}${focusAreaId && !isFocus ? " is-other" : ""}`} data-district={a.id} key={a.id} style={{ ...styleFor(a.id), "--i": i } as CSSProperties}>
              <path aria-label={`${a.label} territory${a.empty ? ", no publications placed yet" : ""}. Zoom in.`} className="district__shape" d={d(a.polygon)} onClick={() => actions.selectDistrict(a.id)} onKeyDown={onKey(() => actions.selectDistrict(a.id))} onPointerEnter={() => setHover({ kind: "district", id: a.id })} onPointerLeave={() => setHover(null)} role="button" tabIndex={0} />
              <path aria-hidden="true" className="district__contour" d={scaled(a.polygon, 0.86)} />
              <path aria-hidden="true" className="district__contour district__contour--2" d={scaled(a.polygon, 0.7)} />
            </g>
          );
        })}
      </g>
      {focusAreaId ? <path aria-hidden="true" className="district__lift" d={d(model.areaById.get(focusAreaId)!.polygon)} filter="url(#terr-lift)" style={styleFor(focusAreaId)} /> : null}

      <g className="terr__names">
        {model.areas.map((a) => {
          const shown = focusAreaId === a.id || isHoverDistrict(a.id);
          const rest = a.empty && !shown;
          return (
            <g className={`dname${shown ? " is-shown" : ""}${a.empty ? " is-empty" : ""}`} key={a.id} style={styleFor(a.id)}>
              <text aria-hidden="true" className="dname__text" fontSize={25 * ut} strokeWidth={4 * ut} x={a.name.x} y={a.name.y}>
                {a.name.lines.map((l, i) => <tspan dy={i ? 27 * ut : 0} key={l} x={a.name.x}>{l}</tspan>)}
              </text>
              <text aria-hidden="true" className="dname__blurb" fontSize={12.5 * ut} strokeWidth={4 * ut} x={a.name.x} y={a.name.y + (a.name.lines.length - 1) * 27 * ut + 21 * ut}>{rest ? "No publications placed yet" : a.blurb}</text>
            </g>
          );
        })}
      </g>

      <g className="shore">
        <text aria-hidden="true" className="shore__label" fontSize={11.5 * ut} textAnchor="end" x={410} y={50}>AUTHORITY</text>
        {authority.map((a, i) => {
          const x = 430 + i * 40; const on = hover?.kind === "shore" && hover.id === a.id;
          return (
            <g aria-label={`Authority: ${a.name}. Open the authority list.`} className={`shore__item${on ? " is-hover" : ""}`} key={a.id} onClick={actions.openAuthority} onKeyDown={onKey(actions.openAuthority)} onPointerEnter={() => setHover({ kind: "shore", id: a.id })} onPointerLeave={() => setHover(null)} role="button" tabIndex={0}>
              <circle className="hit" cx={x} cy={44} r={24 * u} />
              <rect className="shore__mark" height={9 * u} transform={`rotate(45 ${x} 44)`} width={9 * u} x={x - 4.5 * u} y={44 - 4.5 * u} />
              {on ? <text className="shore__name" fontSize={12.5 * ut} strokeWidth={4 * ut} textAnchor="middle" x={x} y={22}>{a.name}</text> : null}
            </g>
          );
        })}
      </g>

      <g className="terr__routes">
        {hoverPublication && !focusPublication && !dimming ? model.routesFor(hoverPublication).map((r) => {
          const g = routeBetween(pos(r.from), pos(r.to), [], 10 * u, 26 * u);
          return <path className="route route--preview" d={g.d} key={r.key} markerEnd="url(#terr-tip)" strokeWidth={2.2 * u} />;
        }) : null}
        {revealed.map((r) => {
          const g = routeBetween(pos(r.from), pos(r.to), labeledRects, 12 * u, 28 * u, viewRect);
          const on = hover?.kind === "route" && hover.id === r.key;
          return (
            <g className={`route route--sel${on ? " is-hover" : ""}`} data-route={r.key} key={r.key}>
              <path className="route__line route--draw" d={g.d} markerEnd="url(#terr-tip)" pathLength={1} strokeWidth={(on ? 4.4 : 3.2) * u} />
              <path aria-label={`Published connection ${model.alias(r.from)} to ${model.alias(r.to)}. Open evidence.`} className="route__hit" d={g.d} onClick={() => actions.selectRoute(r.key)} onKeyDown={onKey(() => actions.selectRoute(r.key))} onPointerEnter={() => setHover({ kind: "route", id: r.key })} onPointerLeave={() => setHover(null)} role="button" strokeWidth={46 * u} tabIndex={0} />
              {on ? <text className="route__label route__label--on" fontSize={12.5 * ut} strokeWidth={4 * ut} textAnchor="middle" x={g.mid[0]} y={g.mid[1] - 9 * u}>{relationLabel(r.types)}</text> : null}
            </g>
          );
        })}
        {selectedRouteKey && model.routeByKey.has(selectedRouteKey) ? (() => {
          const r = model.routeByKey.get(selectedRouteKey)!; const g = routeFor(r.from, r.to);
          return (
            <g className="route route--focus" data-route={r.key} key={r.key}>
              <path className="route__halo" d={g.d} strokeWidth={11 * u} />
              <path className="route__line route--draw" d={g.d} markerEnd="url(#terr-tip)" pathLength={1} strokeWidth={5.2 * u} />
              <text className="route__label route__label--on" fontSize={12.5 * ut} strokeWidth={4 * ut} textAnchor="middle" x={g.mid[0]} y={g.mid[1] - 10 * u}>{relationLabel(r.types)}</text>
            </g>
          );
        })() : null}
        {sharedLines.map(([a, b]) => { const g = routeFor(a, b); return <path className="route route--shared route--draw" d={g.d} key={`${a}${b}`} pathLength={1} strokeWidth={4.4 * u} />; })}
        {hops.map((h, i) => {
          const g = hopRoutes[i]; const on = hover?.kind === "route" && hover.id === `hop${i}`;
          const at = placeLabel(g, h.label);
          return (
            <g className={`seg${h.selected ? " is-selected" : ""}${on ? " is-hover" : ""}`} data-seg={i} key={h.key}>
              <path className="route__halo" d={g.d} strokeWidth={(h.selected || on ? 15 : 12) * u} />
              <path className="route__line seg__line route--draw" d={g.d} markerEnd="url(#terr-tip)" pathLength={1} strokeWidth={(h.selected || on ? 6.4 : 5.2) * u} />
              <path aria-label={`Route segment ${h.label}. Open evidence.`} className="route__hit" d={g.d} onClick={() => actions.selectHop(i)} onKeyDown={onKey(() => actions.selectHop(i))} onPointerEnter={() => setHover({ kind: "route", id: `hop${i}` })} onPointerLeave={() => setHover(null)} role="button" strokeWidth={46 * u} tabIndex={0} />
              <text className="route__label route__label--on" fontSize={12.5 * ut} strokeWidth={4 * ut} textAnchor="middle" x={at[0]} y={at[1]}>{h.label}</text>
            </g>
          );
        })}
      </g>

      <g className="landmarks">
        {model.publications.map((l) => {
          const p = pos(l.id); const isActive = active.has(l.id); const major = model.isMajor(l.id);
          const matched = !!context && context.has(l.id);
          const dim = (dimming && !isActive) || (publisherOn && l.publisher !== publisher) || (!!context && !matched && !connected.has(l.id) && !pinned.has(l.id));
          const isPinned = pinned.has(l.id); const selected = focusPublication === l.id; const hov = hoverPublication === l.id;
          const label = showName(l.id) && (!dim || hov); const side = labelSide(l.id); const lift = selected || hov;
          const areaId = l.area;
          return (
            <g
              aria-label={`${model.alias(l.id)}, ${l.name}, ${l.publisher}, ${model.areaOf(l.id).label} territory${isPinned ? ", pinned" : ""}`}
              aria-pressed={selected}
              className={`lm${dim ? " is-dim" : ""}${isActive ? " is-active" : ""}${selected ? " is-selected" : ""}${hov ? " is-hover" : ""}${major ? " is-major" : ""}${matched ? " is-match" : ""}${publisherOn && !dim ? " is-layer" : ""}`}
              data-landmark={l.id}
              key={l.id}
              onClick={() => actions.selectPublication(l.id)}
              onKeyDown={onKey(() => actions.selectPublication(l.id))}
              onPointerEnter={() => setHover({ kind: "publication", id: l.id })}
              onPointerLeave={() => setHover(null)}
              role="button"
              style={styleFor(areaId)}
              tabIndex={0}
            >
              <circle className="lm__hit" cx={p[0]} cy={p[1]} r={24 * u} />
              <circle className="lm__ring" cx={p[0]} cy={p[1]} r={(lift ? 14 : 11) * u} />
              <circle className="lm__dot" cx={p[0]} cy={p[1]} r={(lift ? 8.2 : matched ? 7.4 : major ? 6.6 : 5.2) * u} />
              {label ? (
                <>
                  <text className="lm__name" fontSize={(major || lift ? 14.5 : 13.5) * ut} strokeWidth={4 * ut} textAnchor={side === 1 ? "start" : "end"} x={p[0] + side * 12 * u} y={p[1] + 4.5 * u}>{model.alias(l.id)}</text>
                  {matched && !recordCatalogs.has(l.id) ? <text className="lm__type lm__count" fontSize={11.5 * ut} strokeWidth={4 * ut} textAnchor={side === 1 ? "start" : "end"} x={p[0] + side * 12 * u} y={p[1] + 19 * u}>{context!.get(l.id)!.records.toLocaleString()} matching {context!.get(l.id)!.records === 1 ? "record" : "records"}</text>
                    : (!recordCatalogs.has(l.id) && !tight && (lift || (focusAreaId === areaId && !isActive))) ? <text className="lm__type" fontSize={11.5 * ut} strokeWidth={4 * ut} textAnchor={side === 1 ? "start" : "end"} x={p[0] + side * 12 * u} y={p[1] + 19 * u}>{l.kind}</text> : null}
                </>
              ) : null}
              {isPinned ? <g className="pin-anim"><path className="pin" d={PIN} transform={`translate(${p[0]} ${p[1] - 9 * u}) scale(${u * 0.95})`} /></g> : null}
            </g>
          );
        })}
      </g>

      <g className="records">
        {records.map((r) => {
          const p = pos(r.catalogId); const side = labelSide(r.catalogId); const areaId = model.publicationById.get(r.catalogId)?.area || "";
          return (
            <g aria-label={`Record ${r.code}${r.pinned ? ", pinned" : ""}`} className={`rec${r.focused ? " is-focused" : ""}`} data-record={r.id} key={r.id} onClick={() => actions.selectRecord(r.id)} onKeyDown={onKey(() => actions.selectRecord(r.id))} role="button" style={styleFor(areaId)} tabIndex={0}>
              <circle className="lm__hit" cx={p[0]} cy={p[1]} r={24 * u} />
              {r.focused ? <circle className="rec__pulse" cx={p[0]} cy={p[1]} r={17 * u} /> : null}
              <rect className="rec__mark" height={15 * u} transform={`rotate(45 ${p[0]} ${p[1]})`} width={15 * u} x={p[0] - 7.5 * u} y={p[1] - 7.5 * u} />
              <text className="rec__code" fontSize={14.5 * ut} strokeWidth={4 * ut} textAnchor={side === 1 ? "start" : "end"} x={p[0] + side * 12 * u} y={p[1] + 26 * u}>{r.code}</text>
              {r.pinned ? <g className="pin-anim"><path className="pin" d={PIN} transform={`translate(${p[0]} ${p[1] - 12 * u}) scale(${u * 0.95})`} /></g> : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Orientation only. Every fact on a phone is in the list; this shows where you are and lets you pick a territory. */
export function MiniMap(props: { model: TerritoryModel; focusAreaId: string | null; active: ReadonlySet<string>; onPick?: (areaId: string) => void; large?: boolean }) {
  const { model, focusAreaId, active, onPick, large } = props;
  const o = model.geometry.overview;
  const activeAreas = new Set([...active].map((id) => model.publicationById.get(id)?.area));
  return (
    <svg aria-hidden={onPick ? undefined : true} aria-label={onPick ? "Territories" : undefined} className={`mini${large ? " mini--large" : ""}`} role={onPick ? "group" : undefined} viewBox={`${o.x} ${o.y + 6} ${o.w} ${o.h - 52}`}>
      <path className="mini__coast" d={d(model.coast)} />
      {model.areas.map((a) => (
        <path
          aria-label={onPick ? `${a.label} territory` : undefined}
          className={`mini__d${focusAreaId === a.id || activeAreas.has(a.id) ? " is-on" : ""}${a.empty ? " is-empty" : ""}${onPick ? " is-button" : ""}`}
          d={d(a.polygon)} key={a.id} onClick={onPick ? () => onPick(a.id) : undefined} onKeyDown={onPick ? onKey(() => onPick(a.id)) : undefined}
          role={onPick ? "button" : undefined} style={styleFor(a.id)} tabIndex={onPick ? 0 : undefined}
        />
      ))}
      {large ? model.areas.map((a) => <text aria-hidden="true" className={`mini__name${a.empty ? " is-empty" : ""}`} key={a.id} style={styleFor(a.id)} x={a.name.x + 30} y={a.name.y}>{a.name.lines.join(" ")}</text>) : null}
      {[...active].map((id) => { const p = model.position(id); return <circle className="mini__pt" cx={p[0]} cy={p[1]} key={id} r={18} />; })}
    </svg>
  );
}
