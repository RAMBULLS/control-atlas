import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { displayNameFor } from "../../app/display-names.mjs";
import { parseResearchPins } from "../lib/atlasResearchState";
import { buildTerritoryModel, searchPublications, type TerritoryModel } from "../lib/atlasTerritoryModel";
import type { TerritoryIndex } from "../lib/atlasTerritoryIndex";
import { loadTerritoryIndex } from "../lib/atlasTerritoryLoader";
import { revealRoutes } from "../lib/atlasTerritoryRoutes";
import { MAX_PINS, addPin, compareHandoff, removePin, sharedGround } from "../lib/atlasTerritoryShared";
import { territoryFocusOf, territoryHasWork, territoryModeOf, territoryPatch, territoryTargetOf, type TerritoryTarget } from "../lib/atlasTerritoryState";
import { resolveAtlasSearchTransition } from "../lib/atlasSearch";
import { catalogDisplayNameFor } from "../lib/catalogProfiles";
import { recordIdentityPresentationFor } from "../lib/recordTitle";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import { useTerritoryResearch, type ResearchRequest } from "../lib/useTerritoryResearch";
import type { ViewState } from "../lib/viewState";
import { AppLink } from "../components/AppLink";
import { MiniMap, TerritoryMap, type MapActions, type MapHop, type MapRecord } from "../components/atlas-territory/TerritoryMap";
import {
  AuthorityPanel, Breadcrumb, HelpPanel, LayersMenu, OtherPanel, PinButton, PinTray, PublicationCard, RouteCard, SearchBox, SharedCard, TerritoryCard,
  type AnyHit,
} from "../components/atlas-territory/Panels";
import { EvidenceCard, RecordCard, RecordSharedCard, ResearchNotice, TrailCard, recordLabel } from "../components/atlas-territory/RecordPanels";
import "../../../styles/atlas-territory.css";

type AtlasState = Extract<ViewState, { view: "atlas-map" }>;
type Navigate = (view: ViewState["view"], patch?: Partial<ViewState>) => void;
type Menu = "layers" | "authority" | "other" | "help" | "";
type Described = { label: string; title: string; publication: string; catalogId: string };

const MAX_TRAIL_HOPS = 4;
const relationName = (type: string) => displayNameFor("relationship_type", type) || type.replace(/_/g, " ");
const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

function useNarrow(maxWidth: number) {
  const query = `(max-width: ${maxWidth - 1}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

function useTerritoryIndex() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ index: TerritoryIndex | null; error: boolean }>({ index: null, error: false });
  useEffect(() => {
    let live = true;
    setState({ index: null, error: false });
    loadTerritoryIndex().then((index) => live && setState({ index, error: false }), () => live && setState({ index: null, error: true }));
    return () => { live = false; };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

export function AtlasTerritoryPage(props: { state: AtlasState; bundle: RuntimeBundle; onNavigate: Navigate; onOpenNode: (nodeId: string) => void }) {
  const { state, bundle, onNavigate } = props;
  const { index, error, retry } = useTerritoryIndex();
  const model = useMemo(() => (index ? buildTerritoryModel(index) : null), [index]);
  if (error) return <section className="atl-status" role="alert"><h1>The Atlas could not load</h1><p>The map data did not arrive. Check your connection and try again.</p><button onClick={retry} type="button">Try again</button></section>;
  if (!index || !model) return <section aria-busy="true" className="atl-status" role="status"><h1>Loading the Atlas</h1></section>;
  return <TerritorySheet bundle={bundle} index={index} model={model} onNavigate={onNavigate} state={state} />;
}

function TerritorySheet(props: { state: AtlasState; bundle: RuntimeBundle; index: TerritoryIndex; model: TerritoryModel; onNavigate: Navigate }) {
  const { state, bundle, index, model, onNavigate } = props;
  const narrow = useNarrow(760);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [offset, setOffset] = useState(122);
  const [size, setSize] = useState({ w: 1200, h: 640 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);

  // Fit the sheet to whatever chrome sits above it, so the map never scrolls the page.
  useLayoutEffect(() => {
    const fit = () => { const el = sheetRef.current; if (el && !narrow) setOffset(Math.round(el.getBoundingClientRect().top + window.scrollY + 12)); };
    fit();
    window.addEventListener("resize", fit);
    const raf = requestAnimationFrame(fit);
    return () => { window.removeEventListener("resize", fit); cancelAnimationFrame(raf); };
  });

  const [menu, setMenu] = useState<Menu>("");
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [closedFor, setClosedFor] = useState("");
  const [notice, setNotice] = useState("");
  const [pathIndex, setPathIndex] = useState(0);
  const [edgeId, setEdgeId] = useState("");
  const [noMatch, setNoMatch] = useState("");
  const focusRef = useRef<HTMLElement>(null);
  // On a phone the evidence sits below the list; bring it into view and move focus to it.
  useEffect(() => { if (narrow && edgeId) { focusRef.current?.focus({ preventScroll: true }); focusRef.current?.scrollIntoView({ block: "start" }); } }, [narrow, edgeId]);

  const focus = territoryFocusOf(state);
  const mode = territoryModeOf(state);
  const target = territoryTargetOf(state);
  const pins = parseResearchPins(state.atlasPins);
  const publisher = model.publishers.includes(target.publisher || "") ? target.publisher || "" : "";
  const work = territoryHasWork(state);
  const isPublication = (id: string) => model.publicationById.has(id);
  const direction: "forward" | "either" = state.atlasDirection === "either" ? "either" : "forward";

  const go = useCallback((next: TerritoryTarget & { direction?: "forward" | "either" }) => {
    setMenu("");
    onNavigate("atlas-map", { ...territoryPatch(next), atlasDirection: next.direction === "either" ? "either" : "" });
  }, [onNavigate]);
  const keep = (change: TerritoryTarget & { direction?: "forward" | "either" }) => ({ ...target, direction, ...change });

  // ---- publication level (answered from the published-route index) ----
  const focusPublication = focus.kind === "publication" && isPublication(focus.id) ? focus.id : null;
  const pubPath = mode === "path" && !!target.from && !!target.to && isPublication(target.from) && isPublication(target.to);
  const selectedRoute = pubPath ? model.routeByKey.get(target.from! < target.to! ? `${target.from}|${target.to}` : `${target.to}|${target.from}`) || null : null;
  const pubPins = pins.filter(isPublication);
  const recordPins = pins.filter((p) => !isPublication(p));
  const ground = useMemo(() => sharedGround(model.routes, pubPins), [model, pubPins.join("|")]);
  const sharing = mode === "shared" && pubPins.length >= 2 && recordPins.length === 0;

  const reveal = useMemo(() => revealRoutes(focusPublication ? model.routesFor(focusPublication) : [], { types, showAll }), [model, focusPublication, types, showAll]);
  useEffect(() => { setTypes([]); setShowAll(false); }, [focusPublication]);

  // ---- record level (answered by the lazily loaded research worker) ----
  const focusRecord = focus.kind === "record" ? focus.id : "";
  const controlCatalogs = useMemo(() => model.publications.filter((p) => p.kind === "Control catalog").map((p) => p.id), [model]);
  const recordShared = mode === "shared" && recordPins.length >= 2 && pubPins.length === 0;
  const request: ResearchRequest | null = useMemo(() => {
    if (mode === "upstream" && target.from && !isPublication(target.from)) return { kind: "upstream", from: target.from, catalogs: controlCatalogs, maxHops: MAX_TRAIL_HOPS };
    if (mode === "path" && !pubPath && target.from && target.to) return { kind: "path", from: target.from, to: target.to, direction, maxHops: MAX_TRAIL_HOPS };
    if (recordShared) return { kind: "shared", pins: recordPins };
    return null;
  }, [mode, target.from, target.to, pubPath, direction, controlCatalogs, recordShared, recordPins.join("|")]);
  const recordIds = [...new Set([focusRecord, target.from || "", target.to || "", ...recordPins].filter((id) => id && !isPublication(id)))];
  const research = useTerritoryResearch(!!focusRecord || !!request || recordPins.length > 0, request, recordIds);
  const answer = research.answer;
  const requestKey = request ? JSON.stringify(request) : "";
  useEffect(() => { setPathIndex(0); setEdgeId(""); }, [requestKey]);

  const describe = useCallback((id: string): Described | null => {
    const known = research.records.get(id);
    if (known) return { label: known.identity.label, title: known.identity.title, publication: known.identity.publication, catalogId: known.identity.catalogId };
    const node = bundle.runtime.getNode(id);
    if (!node) return null;
    const md = node.metadata || {}; const catalogId = md.catalog_id || "";
    const ident = recordIdentityPresentationFor({ publisher: "", catalogId, publicationName: catalogDisplayNameFor(catalogId), family: md.family || "", itemId: md.item_id || node.label || "", title: md.title || "", objectType: node.node_type || "", metadata: md });
    return { label: ident.stableIdIsGenerated ? ident.primary : md.publisher_item_id || md.item_id || ident.primary, title: ident.secondary || "", publication: catalogDisplayNameFor(catalogId), catalogId };
  }, [research.records, bundle]);
  const label = (id: string) => (isPublication(id) ? model.alias(id) : describe(id)?.label || recordLabel(research.records, id));
  const catalogOfRecord = (id: string) => describe(id)?.catalogId || "";

  const paths = answer && (answer.kind === "upstream" || answer.kind === "path") ? answer.result?.paths || [] : [];
  const trail = paths[Math.min(pathIndex, Math.max(0, paths.length - 1))] || [];
  const selectedHop = edgeId ? trail.findIndex((h) => h.edge.id === edgeId) : -1;
  const evidenceEdge = edgeId ? answer?.edges.find((e) => e.id === edgeId) || null : null;

  const mapRecords: MapRecord[] = useMemo(() => {
    const ids: string[] = [];
    if (focusRecord) ids.push(focusRecord);
    if (trail.length) ids.push(trail[0].from, ...trail.map((h) => h.to));
    ids.push(...recordPins);
    if (recordShared && answer?.kind === "shared") ids.push(...(answer.shared || []).slice(0, 8).map((r) => r.nodeId), ...(answer.some || []).slice(0, 4).map((r) => r.nodeId));
    return [...new Set(ids)].flatMap((id) => {
      const catalogId = catalogOfRecord(id);
      return model.publicationById.has(catalogId) ? [{ id, code: label(id), catalogId, pinned: recordPins.includes(id), focused: id === focusRecord }] : [];
    });
  }, [focusRecord, trail, recordPins.join("|"), recordShared, answer, model, describe]);
  const hops: MapHop[] = useMemo(() => trail.flatMap((h, i) => {
    const a = catalogOfRecord(h.from); const b = catalogOfRecord(h.to);
    return a && b && a !== b && model.publicationById.has(a) && model.publicationById.has(b)
      ? [{ key: h.edge.id, from: h.from, to: h.to, fromCatalog: a, toCatalog: b, label: relationName(String(h.edge.relationship_type || "")), selected: selectedHop === i }] : [];
  }), [trail, selectedHop, model, describe]);

  const focusPublicationOfRecord = focusRecord ? catalogOfRecord(focusRecord) : "";
  const focusAreaId = focus.kind === "territory" && model.areaById.has(focus.id) ? focus.id
    : focusPublication ? model.areaOf(focusPublication).id
      : focusPublicationOfRecord && isPublication(focusPublicationOfRecord) ? model.areaOf(focusPublicationOfRecord).id : null;

  const tracing = (mode === "upstream" || (mode === "path" && !pubPath)) && !!target.from;
  // Where the reader is, for the breadcrumb and the phone layout. The map itself keeps its own focus rules.
  const contextCatalog = focusPublication || (tracing || recordShared ? catalogOfRecord(target.from || recordPins[0] || "") : "") || (selectedRoute ? selectedRoute.a : "") || (sharing ? pubPins[0] : "");
  const contextAreaId = focusAreaId || (contextCatalog && isPublication(contextCatalog) ? model.areaOf(contextCatalog).id : null);

  const active = useMemo(() => {
    const s = new Set<string>();
    if (selectedRoute) { s.add(selectedRoute.a); s.add(selectedRoute.b); }
    if (sharing) { pubPins.forEach((p) => s.add(p)); ground.all.forEach((p) => s.add(p)); ground.some.forEach((x) => s.add(x.id)); }
    if (trail.length || (recordShared && mapRecords.length)) mapRecords.forEach((r) => s.add(r.catalogId));
    return s;
  }, [selectedRoute, sharing, ground, pubPins.join("|"), trail, recordShared, mapRecords]);
  const sharedLines = useMemo(() => (sharing
    ? [...ground.all, ...ground.some.map((x) => x.id)].flatMap((id) => pubPins.filter((p) => model.routeByKey.has(p < id ? `${p}|${id}` : `${id}|${p}`)).map((p) => [p, id] as const))
      .concat(ground.direct.map((r) => [r.a, r.b] as const))
    : []), [sharing, ground, model, pubPins.join("|")]);

  // ---- what the details panel shows ----
  const cardKey = evidenceEdge ? `edge:${evidenceEdge.id}` : selectedRoute ? `route:${selectedRoute.key}` : sharing ? "shared" : recordShared ? "rshared"
    : tracing ? `trail:${target.from}` : focusRecord ? `rec:${focusRecord}` : focusPublication ? `pub:${focusPublication}` : focusAreaId ? `area:${focusAreaId}` : "";
  const inspectorOpen = !!cardKey && closedFor !== cardKey;
  useEffect(() => { setClosedFor(""); }, [cardKey]);

  const handoff = compareHandoff(recordPins.length === 0 ? pubPins : [], new Set(model.publicationById.keys()));
  const directRoute = pubPins.length === 2 && recordPins.length === 0 ? ground.direct[0] || null : null;

  const [hits, setHits] = useState<AnyHit[]>([]);
  const libraryReady = Boolean(bundle.librarySearchReady);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const publications = searchPublications(model, q, 4);
    let records: AnyHit[] = [];
    if (libraryReady) {
      records = bundle.runtime.searchLibrary(q).slice(0, 5).map((doc: any) => {
        const id = recordIdentityPresentationFor({ publisher: "", catalogId: doc.catalog_id || "", publicationName: doc.catalog_name || "", family: doc.family || "", itemId: doc.item_id || "", title: doc.title || "", objectType: doc.object_type || "", metadata: doc });
        return { type: "record" as const, id: doc.id, label: doc.item_id || id.primary, sub: `Record · ${model.publicationById.has(doc.catalog_id) ? model.alias(doc.catalog_id) : doc.catalog_name || "Publication"}${doc.title ? ` · ${doc.title}` : ""}` };
      });
    }
    setHits([...records.slice(0, 1), ...publications, ...records.slice(1)].slice(0, 7));
  }, [query, model, libraryReady, bundle]);

  const pick = (hit: AnyHit) => {
    setQuery(""); setMenu("");
    if (hit.type === "publication") go({ limb: model.areaOf(hit.id).id, framework: hit.id, pins, publisher });
    else go({ node: hit.id, pins, publisher });
  };
  const togglePin = (id: string) => {
    if (pins.includes(id)) {
      const next = removePin(pins, id);
      go(keep({ pins: next, mode: next.length < 2 && mode === "shared" ? "explore" : target.mode }));
      return;
    }
    if (pins.length && isPublication(pins[0]) !== isPublication(id)) { setNotice("Pin publications together or records together. Clear the pins to switch."); return; }
    const next = addPin(pins, id);
    if (!next) { setNotice("Six pins is the limit. Unpin one to add another."); return; }
    setNotice(`Pinned ${label(id)}.`);
    go(keep({ pins: next }));
  };

  const submitSearch = () => {
    const q = query.trim();
    if (q.length < 2) return;
    const exact = searchPublications(model, q, 1).find((h) => model.alias(h.id).toLowerCase() === q.toLowerCase() || model.publicationById.get(h.id)!.name.toLowerCase() === q.toLowerCase());
    if (exact) { pick(exact); return; }
    if (!libraryReady) { if (hits[0]) pick(hits[0]); return; }
    const transition = resolveAtlasSearchTransition(bundle.runtime, q);
    setNotice(transition.announcement);
    if (transition.kind === "focus") { setQuery(""); go({ node: transition.nodeId, pins, publisher }); return; }
    if (transition.kind === "search") {
      if (hits.some((h) => h.type === "publication")) { pick(hits.find((h) => h.type === "publication")!); return; }
      onNavigate("search", { query: q });
      return;
    }
    if (hits.length) { pick(hits[0]); return; }
    setNoMatch(q);
  };
  const goRecord = (id: string) => go({ node: id, pins, publisher });
  const actions: MapActions = {
    selectDistrict: (id) => go({ limb: id, pins, publisher }),
    selectPublication: (id) => go({ limb: model.areaOf(id).id, framework: id, pins, publisher }),
    selectRoute: (key) => { const r = model.routeByKey.get(key)!; go({ pins, publisher, mode: "path", from: r.from, to: r.to }); },
    selectRecord: goRecord,
    selectHop: (i) => { const h = hops[i]; if (h) setEdgeId(h.key); },
    openAuthority: () => setMenu((m) => (m === "authority" ? "" : "authority")),
    closeInspector: () => { setClosedFor(cardKey); setMenu(""); },
  };

  const overview = () => go({ pins, publisher });
  const reset = () => go({});
  const inspectorInset = inspectorOpen && !narrow ? 372 : 0;
  const toggleMenu = (m: Menu) => setMenu((cur) => (cur === m ? "" : m));
  const zoomed = focus.kind !== "overview" || !!selectedRoute || sharing || recordShared || tracing;

  const pinControl = (id: string) => <PinButton full={pins.length >= MAX_PINS} label={label(id)} onToggle={() => togglePin(id)} pinned={pins.includes(id)} />;
  const getSource = (id: string) => bundle.runtime.getSource(id);
  const focusInfo = focusRecord ? describe(focusRecord) : null;
  const inspector = evidenceEdge ? (
    <EvidenceCard edge={evidenceEdge} getSource={getSource} onBack={() => setEdgeId("")} onNavigate={onNavigate} records={research.records} />
  ) : selectedRoute ? <RouteCard model={model} route={selectedRoute} />
    : sharing ? <SharedCard ground={ground} model={model} onRoute={(key) => actions.selectRoute(key)} onSelect={actions.selectPublication} pins={pubPins} />
    : recordShared ? <RecordSharedCard answer={answer} onEdge={setEdgeId} onRecord={goRecord} pins={recordPins} research={research} />
    : tracing ? (
      <TrailCard direction={direction} from={target.from!} kind={mode === "upstream" ? "upstream" : "path"} onDirection={(d) => go(keep({ direction: d }))} onHop={(i) => setEdgeId(trail[i].edge.id)} onPath={setPathIndex}
        onRecord={goRecord} pathIndex={pathIndex} research={research} selectedHop={selectedHop >= 0 ? selectedHop : null} to={target.to} />
    ) : focusRecord ? (
      <RecordCard areaLabel={focusInfo && isPublication(focusInfo.catalogId) ? model.areaOf(focusInfo.catalogId).label : ""} canTrace={!!focusInfo && research.status !== "error"} degree={research.degree.get(focusRecord) ?? null}
        openRecord={<AppLink onNavigate={onNavigate} patch={{ node: focusRecord }} view="library-detail">Open the full record</AppLink>}
        notice={research.failed ? <ResearchNotice research={research} what="Connection data" /> : null}
        fullList={<AppLink onNavigate={onNavigate} patch={{ node: focusRecord, relationshipView: "list" }} view="atlas-map">Full connection list</AppLink>}
        label={focusInfo?.label || recordLabel(research.records, focusRecord)} loading={!focusInfo} onTrace={() => go({ node: focusRecord, pins, publisher, mode: "upstream", from: focusRecord })}
        pin={pinControl(focusRecord)} publication={focusInfo?.publication || ""} title={focusInfo?.title || ""} tracing={false} />
    ) : focusPublication ? (
      <PublicationCard id={focusPublication} model={model} onNavigate={onNavigate} onRoute={actions.selectRoute} onShowAll={() => setShowAll(true)}
        onToggleType={(t) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))} pin={pinControl(focusPublication)} reveal={reveal} types={types} />
    ) : focusAreaId ? <TerritoryCard areaId={focusAreaId} model={model} onSelect={actions.selectPublication} /> : null;

  const compare = handoff ? (
    <AppLink className="atl-linkbtn" onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "frameworks", source: handoff.source, target: handoff.target, compareRun: "true" } as Partial<ViewState>} view="matrix">Compare {model.alias(handoff.source)} and {model.alias(handoff.target)}</AppLink>
  ) : null;
  const tray = (
    <PinTray
      canShare={pins.length >= 2} canTrace={!!directRoute || (recordPins.length === 2 && pubPins.length === 0)} compare={compare} label={label}
      onClear={() => go(keep({ pins: [], mode: mode === "shared" ? "explore" : target.mode }))}
      onShare={() => go(keep({ mode: "shared" }))}
      onTrace={() => { if (directRoute) actions.selectRoute(directRoute.key); else go({ pins, publisher, mode: "path", from: recordPins[0], to: recordPins[1], direction }); }}
      onUnpin={togglePin} pins={pins} traceLabel={directRoute ? "Open route evidence" : "Trace path"}
    />
  );
  const status = <p aria-live="polite" className={notice.startsWith("Pin publications") || notice.startsWith("Six") ? "atl-warn" : "atl-sr"} role="status">{notice}</p>;
  const menus = (
    <>
      {menu === "layers" ? <LayersMenu onPublisher={(value) => go(keep({ publisher: value }))} publisher={publisher} publishers={model.publishers} /> : null}
      {menu === "authority" ? <AuthorityPanel items={index.authority} /> : null}
      {menu === "other" ? <OtherPanel items={index.other} /> : null}
      {menu === "help" ? <HelpPanel /> : null}
    </>
  );
  const crumbLabel = evidenceEdge ? "Why connected" : selectedRoute ? "Published connection" : sharing || recordShared ? "Shared ground" : tracing ? "Research path" : focusRecord ? label(focusRecord) : undefined;
  const crumbPublication = focusPublication || (focusRecord && isPublication(focusPublicationOfRecord) ? focusPublicationOfRecord : null);
  const crumb = <Breadcrumb areaId={contextAreaId} label={crumbLabel} model={model} publicationId={crumbPublication} />;
  const search = <SearchBox hits={hits} noMatch={noMatch} onClose={() => { setQuery(""); setNoMatch(""); }} onNavigate={onNavigate} onPick={pick} onQuery={(value) => { setNoMatch(""); setQuery(value); }} onSubmit={submitSearch} open={query.trim().length >= 2} query={query} ready={libraryReady} />;

  if (narrow) {
    const area = contextAreaId ? model.areaById.get(contextAreaId)! : null;
    return (
      <section aria-labelledby="atl-title" className="atl atl--mobile" data-route-content-ready="true">
        <header className="atl-m-head" data-route-primary-header="true"><h1 id="atl-title">Atlas</h1>{zoomed || work.pins || work.layer ? <button onClick={reset} type="button">Reset</button> : null}</header>
        {search}
        <div className="atl-m-row">
          <button aria-expanded={menu === "layers"} onClick={() => toggleMenu("layers")} type="button">Layers</button>
          <button aria-expanded={menu === "authority"} onClick={() => toggleMenu("authority")} type="button">Authority · {index.authority.length}</button>
          <button aria-expanded={menu === "other"} onClick={() => toggleMenu("other")} type="button">Other · {index.other.length}</button>
        </div>
        {menus}
        <section aria-labelledby="atl-where" className="atl-m-sec">
          <h2 id="atl-where">{area ? `Current area · ${area.label}` : "Territories"}</h2>
          <div className={`atl-m-district${area ? "" : " atl-m-district--rest"}`}>
            <MiniMap active={active} focusAreaId={contextAreaId} large={!area} model={model} onPick={(id) => actions.selectDistrict(id)} />
            <div>{area ? <p>{area.blurb}</p> : <p>Pick a territory, or search for something you know.</p>}{crumb}</div>
          </div>
          {!area ? <ul className="atl-list">{model.areas.map((a) => <li key={a.id}><button onClick={() => actions.selectDistrict(a.id)} type="button"><b>{a.label}</b><small>{a.empty ? "No publications placed yet" : a.blurb}</small></button></li>)}</ul> : null}
        </section>
        {inspector ? <section aria-labelledby="atl-focus-h" className="atl-m-sec" id="atl-focus" ref={focusRef} tabIndex={-1}><h2 id="atl-focus-h">Focused</h2>{inspector}</section> : null}
        {pins.length ? <section aria-labelledby="atl-pins" className="atl-m-sec"><h2 id="atl-pins">Pinned</h2>{tray}</section> : null}
        {area && !focusPublication && !focusRecord && !selectedRoute && !sharing && !tracing ? (
          <section aria-labelledby="atl-near" className="atl-m-sec">
            <h2 id="atl-near">In {area.label}</h2>
            <ul className="atl-list">{area.publicationIds.map((id) => { const n = model.routesFor(id).length; return <li key={id}><button onClick={() => actions.selectPublication(id)} type="button"><b>{model.alias(id)}</b><small>{model.publicationById.get(id)!.kind} · {n ? plural(n, "published connection") : "no published connection to other mapped publications"}</small></button></li>; })}</ul>
          </section>
        ) : null}
        {status}
      </section>
    );
  }

  return (
    <section aria-labelledby="atl-title" className="atl" data-route-content-ready="true" ref={sheetRef} style={{ ["--atl-offset" as string]: `${offset}px` }}>
      <header className="atl-top" data-route-primary-header="true">
        <h1 className="atl-mark" id="atl-title">Atlas</h1>
        {search}
        {crumb}
        <div className="atl-top__right">
          <button aria-expanded={menu === "authority"} onClick={() => toggleMenu("authority")} type="button">Authority · {index.authority.length}</button>
          <button aria-expanded={menu === "layers"} onClick={() => toggleMenu("layers")} type="button">Layers{work.layer ? " · on" : ""}</button>
          <button aria-expanded={menu === "help"} aria-label="About this map" className="atl-icon" onClick={() => toggleMenu("help")} type="button">i</button>
        </div>
        {menu === "layers" || menu === "help" ? menus : null}
      </header>
      <div className="atl-map" ref={wrapRef}>
        <TerritoryMap
          actions={actions} active={active} authority={index.authority} focusAreaId={focusAreaId} focusPublication={focusPublication} hops={hops} inspectorInset={inspectorInset} model={model}
          pins={pubPins} publisher={publisher} records={mapRecords} revealed={sharing || selectedRoute || tracing ? [] : reveal.visible} selectedRouteKey={selectedRoute?.key || null} sharedLines={sharedLines} size={size}
        />
        <div className="atl-map__actions">
          {zoomed ? <button className="atl-pill" onClick={overview} type="button">◂ Atlas overview</button> : null}
          {zoomed || work.pins || work.layer ? <button className="atl-pill" onClick={reset} type="button">Reset</button> : null}
        </div>
        {menu === "authority" || menu === "other" ? menus : null}
        <button aria-expanded={menu === "other"} className="atl-pill atl-pill--other" onClick={() => toggleMenu("other")} type="button">Other publications · {index.other.length}</button>
        {inspectorOpen && inspector ? (
          <aside aria-label="Details" className="atl-inspector">
            <button aria-label="Close details" className="atl-inspector__close" onClick={actions.closeInspector} type="button">×</button>
            {inspector}
          </aside>
        ) : null}
        {tray}
        {status}
      </div>
    </section>
  );
}
