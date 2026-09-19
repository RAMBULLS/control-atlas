import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseResearchPins } from "../lib/atlasResearchState";
import { buildTerritoryModel, searchPublications, type TerritoryModel } from "../lib/atlasTerritoryModel";
import type { TerritoryIndex } from "../lib/atlasTerritoryIndex";
import { loadTerritoryIndex } from "../lib/atlasTerritoryLoader";
import { revealRoutes } from "../lib/atlasTerritoryRoutes";
import { MAX_PINS, addPin, compareHandoff, removePin, sharedGround } from "../lib/atlasTerritoryShared";
import { territoryFocusOf, territoryHasWork, territoryModeOf, territoryPatch, territoryTargetOf, type TerritoryTarget } from "../lib/atlasTerritoryState";
import { recordIdentityPresentationFor } from "../lib/recordTitle";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";
import { AppLink } from "../components/AppLink";
import { MiniMap, TerritoryMap, type MapActions } from "../components/atlas-territory/TerritoryMap";
import {
  AuthorityPanel, Breadcrumb, HelpPanel, LayersMenu, OtherPanel, PinButton, PinTray, PublicationCard, RouteCard, SearchBox, SharedCard, TerritoryCard,
  type AnyHit,
} from "../components/atlas-territory/Panels";
import "../../../styles/atlas-territory.css";

type AtlasState = Extract<ViewState, { view: "atlas-map" }>;
type Navigate = (view: ViewState["view"], patch?: Partial<ViewState>) => void;
type Menu = "layers" | "authority" | "other" | "help" | "";

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

  const [menu, setMenu] = useState<Menu>("");
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [closedFor, setClosedFor] = useState("");
  const [notice, setNotice] = useState("");

  const focus = territoryFocusOf(state);
  const mode = territoryModeOf(state);
  const target = territoryTargetOf(state);
  const pins = parseResearchPins(state.atlasPins);
  const publisher = model.publishers.includes(target.publisher || "") ? target.publisher || "" : "";
  const work = territoryHasWork(state);
  const isPublication = (id: string) => model.publicationById.has(id);

  const go = useCallback((next: TerritoryTarget) => { setMenu(""); onNavigate("atlas-map", territoryPatch(next)); }, [onNavigate]);
  const keep = (change: TerritoryTarget) => ({ ...target, ...change });

  const focusPublication = focus.kind === "publication" && isPublication(focus.id) ? focus.id : null;
  const focusAreaId = focus.kind === "territory" && model.areaById.has(focus.id) ? focus.id
    : focusPublication ? model.areaOf(focusPublication).id : null;
  const selectedRoute = mode === "path" && target.from && target.to && isPublication(target.from) && isPublication(target.to)
    ? model.routeByKey.get(target.from < target.to ? `${target.from}|${target.to}` : `${target.to}|${target.from}`) || null : null;
  const pubPins = pins.filter(isPublication);
  const ground = useMemo(() => sharedGround(model.routes, pubPins), [model, pubPins.join("|")]);
  const sharing = mode === "shared" && pubPins.length >= 2;

  const reveal = useMemo(() => revealRoutes(focusPublication ? model.routesFor(focusPublication) : [], { types, showAll }), [model, focusPublication, types, showAll]);
  useEffect(() => { setTypes([]); setShowAll(false); }, [focusPublication]);

  const active = useMemo(() => {
    const s = new Set<string>();
    if (selectedRoute) { s.add(selectedRoute.a); s.add(selectedRoute.b); }
    if (sharing) { pubPins.forEach((p) => s.add(p)); ground.all.forEach((p) => s.add(p)); ground.some.forEach((x) => s.add(x.id)); }
    return s;
  }, [selectedRoute, sharing, ground, pubPins.join("|")]);
  const sharedLines = useMemo(() => (sharing
    ? [...ground.all, ...ground.some.map((x) => x.id)].flatMap((id) => pubPins.filter((p) => model.routeByKey.has(p < id ? `${p}|${id}` : `${id}|${p}`)).map((p) => [p, id] as const))
      .concat(ground.direct.map((r) => [r.a, r.b] as const))
    : []), [sharing, ground, model, pubPins.join("|")]);

  const cardKey = selectedRoute ? `route:${selectedRoute.key}` : sharing ? "shared" : focusPublication ? `pub:${focusPublication}` : focusAreaId ? `area:${focusAreaId}` : "";
  const inspectorOpen = !!cardKey && closedFor !== cardKey;
  useEffect(() => { setClosedFor(""); }, [cardKey]);

  const handoff = compareHandoff(pubPins.length === pins.length ? pubPins : [], new Set(model.publicationById.keys()));
  const directRoute = pubPins.length === 2 ? ground.direct[0] || null : null;
  const label = (id: string) => (isPublication(id) ? model.alias(id) : id);

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
    if (hit.type === "publication") go({ limb: model.areaOf(hit.id).id, framework: hit.id });
    else onNavigate("atlas-map", territoryPatch({ node: hit.id }));
  };
  const togglePin = (id: string) => {
    if (pins.includes(id)) { go(keep({ pins: removePin(pins, id), mode: pins.length - 1 < 2 && mode === "shared" ? "explore" : target.mode })); return; }
    const next = addPin(pins, id);
    if (!next) { setNotice("Six pins is the limit. Unpin one to add another."); return; }
    setNotice(`Pinned ${label(id)}.`);
    go(keep({ pins: next }));
  };

  const actions: MapActions = {
    selectDistrict: (id) => go({ limb: id, pins, publisher }),
    selectPublication: (id) => go({ limb: model.areaOf(id).id, framework: id, pins, publisher }),
    selectRoute: (key) => { const r = model.routeByKey.get(key)!; go({ pins, publisher, mode: "path", from: r.from, to: r.to }); },
    selectRecord: (id) => onNavigate("atlas-map", territoryPatch({ node: id })),
    selectHop: () => undefined,
    openAuthority: () => setMenu((m) => (m === "authority" ? "" : "authority")),
    closeInspector: () => { setClosedFor(cardKey); setMenu(""); },
  };

  const overview = () => go({ pins, publisher });
  const reset = () => go({});
  const inspectorInset = inspectorOpen && !narrow ? 372 : 0;
  const toggleMenu = (m: Menu) => setMenu((cur) => (cur === m ? "" : m));
  const zoomed = focus.kind !== "overview" || !!selectedRoute || sharing;

  const pinControl = (id: string) => <PinButton full={pins.length >= MAX_PINS} label={label(id)} onToggle={() => togglePin(id)} pinned={pins.includes(id)} />;
  const inspector = selectedRoute ? <RouteCard model={model} route={selectedRoute} />
    : sharing ? <SharedCard ground={ground} model={model} onRoute={(key) => actions.selectRoute(key)} onSelect={actions.selectPublication} pins={pubPins} />
    : focusPublication ? (
      <PublicationCard id={focusPublication} model={model} onNavigate={onNavigate} onRoute={actions.selectRoute} onShowAll={() => setShowAll(true)}
        onToggleType={(t) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))} pin={pinControl(focusPublication)} reveal={reveal} types={types} />
    ) : focusAreaId ? <TerritoryCard areaId={focusAreaId} model={model} onSelect={actions.selectPublication} /> : null;

  const compare = handoff ? (
    <AppLink className="atl-linkbtn" onNavigate={onNavigate} patch={{ crosswalk: "relationships", intent: "frameworks", source: handoff.source, target: handoff.target, compareRun: "true" } as Partial<ViewState>} view="matrix">Compare {model.alias(handoff.source)} and {model.alias(handoff.target)}</AppLink>
  ) : null;
  const tray = (
    <PinTray canShare={pubPins.length >= 2} canTrace={!!directRoute} compare={compare} label={label} onClear={() => go(keep({ pins: [], mode: mode === "shared" ? "explore" : target.mode }))} onShare={() => go(keep({ mode: "shared" }))}
      onTrace={() => directRoute && actions.selectRoute(directRoute.key)} onUnpin={togglePin} pins={pins} />
  );
  const status = <p aria-live="polite" className="atl-sr" role="status">{notice}</p>;
  const menus = (
    <>
      {menu === "layers" ? <LayersMenu onPublisher={(value) => onNavigate("atlas-map", territoryPatch(keep({ publisher: value })))} publisher={publisher} publishers={model.publishers} /> : null}
      {menu === "authority" ? <AuthorityPanel items={index.authority} /> : null}
      {menu === "other" ? <OtherPanel items={index.other} /> : null}
      {menu === "help" ? <HelpPanel /> : null}
    </>
  );
  const crumb = <Breadcrumb areaId={focusAreaId} label={selectedRoute ? "Published connection" : sharing ? "Shared ground" : undefined} model={model} publicationId={focusPublication} />;
  const search = <SearchBox hits={hits} onClose={() => setQuery("")} onPick={pick} onQuery={setQuery} open={query.trim().length >= 2} query={query} ready={libraryReady} />;

  if (narrow) {
    const area = focusAreaId ? model.areaById.get(focusAreaId)! : null;
    return (
      <section aria-labelledby="atl-title" className="atl atl--mobile">
        <header className="atl-m-head"><h1 id="atl-title">Atlas</h1>{zoomed || work.pins || work.layer ? <button onClick={reset} type="button">Reset</button> : null}</header>
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
            <MiniMap active={active} focusAreaId={focusAreaId} large={!area} model={model} onPick={(id) => actions.selectDistrict(id)} />
            <div>{area ? <p>{area.blurb}</p> : <p>Pick a territory, or search for something you know.</p>}{crumb}</div>
          </div>
          {!area ? <ul className="atl-list">{model.areas.map((a) => <li key={a.id}><button onClick={() => actions.selectDistrict(a.id)} type="button"><b>{a.label}</b><small>{a.empty ? "No publications placed yet" : a.blurb}</small></button></li>)}</ul> : null}
        </section>
        {inspector ? <section aria-labelledby="atl-focus" className="atl-m-sec"><h2 id="atl-focus">Focused</h2>{inspector}</section> : null}
        {pins.length ? <section aria-labelledby="atl-pins" className="atl-m-sec"><h2 id="atl-pins">Pinned</h2>{tray}</section> : null}
        {area && !focusPublication && !selectedRoute && !sharing ? (
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
    <section aria-labelledby="atl-title" className="atl">
      <header className="atl-top">
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
          actions={actions} active={active} authority={index.authority} focusAreaId={focusAreaId} focusPublication={focusPublication} hops={[]} inspectorInset={inspectorInset} model={model}
          pins={pubPins} publisher={publisher} records={[]} revealed={sharing || selectedRoute ? [] : reveal.visible} selectedRouteKey={selectedRoute?.key || null} sharedLines={sharedLines} size={size}
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

function plural(n: number, one: string) { return `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`; }
