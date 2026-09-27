import { useEffect, useRef, type CSSProperties } from "react";
import { IconSearch } from "@tabler/icons-react";

import { HOME_CONTENT, HOME_TOOLS } from "../../shared/home-content.mjs";
import { HOME_SURFACE, type HomeMap } from "../../shared/home-surface";
import { ATLAS_SCOPE_METRICS } from "../../shared/atlas-presentation";
import { AppLink } from "../components/AppLink";
import { connectHomeDisclosure } from "../lib/homeDisclosure";
import { HOME_LIBRARY_DISCOVERY } from "../lib/homeTagConstellation";
import type { ViewState } from "../lib/viewState";

type HomePageProps = {
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenSearch: () => void;
};

const Arrow = () => <span aria-hidden="true">→</span>;

/** Must match renderHomeMap() in vite.config.ts exactly. */
function HomeAtlasMap({ map }: { map: HomeMap }) {
  const areaStyle = (token: string) => ({ "--ca-area-color-on-dark": `var(${token}-on-dark)` }) as CSSProperties;
  return (
    <svg aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet" viewBox={map.viewBox}>
      <path className="home-map__coast" d={map.coast} />
      {map.areas.map((area) => (
        <path className={`home-map__area${area.empty ? " is-empty" : ""}`} d={area.d} key={area.id} style={areaStyle(area.token)} />
      ))}
      {map.areas.map((area) => (
        <text className={`home-map__name${area.empty ? " is-empty" : ""}`} key={area.id} style={areaStyle(area.token)} x={area.name.x} y={area.name.y}>
          {area.name.lines.map((line, index) => <tspan dy={index ? 34 : 0} key={line} x={area.name.x}>{line}</tspan>)}
        </text>
      ))}
      {map.landmarks.map((landmark) => (
        <g className="home-map__landmark" key={landmark.id}>
          <circle className="home-map__ring" cx={landmark.x} cy={landmark.y} r={13} />
          <circle className="home-map__point" cx={landmark.x} cy={landmark.y} r={6} />
          <text className="home-map__alias" x={landmark.x + 20} y={landmark.y + 8}>{landmark.alias}</text>
        </g>
      ))}
    </svg>
  );
}

export function HomePage({ onNavigate, onOpenSearch }: HomePageProps) {
  const topicsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => (topicsRef.current ? connectHomeDisclosure(topicsRef.current) : undefined), []);

  const { atlas, library, pulse: pulseCopy, start } = HOME_CONTENT;
  const { changes, recent } = HOME_SURFACE.pulse;
  const metrics = ATLAS_SCOPE_METRICS
    ? `${ATLAS_SCOPE_METRICS.compact.records} records · ${ATLAS_SCOPE_METRICS.compact.publications} source publications`
    : "";

  return (
    <section
      aria-labelledby="home-title"
      className="home-entry"
      data-template="B"
      data-visual-identity="universal-front-door"
    >
      <div className="home-hero">
        <div className="home-wrap home-hero__grid">
          <div className="home-hero__identity">
            <h1 id="home-title">{HOME_CONTENT.headline}</h1>
            <p className="home-lead">{HOME_CONTENT.lead}</p>
            <button
              aria-label="Search Control Atlas"
              className="home-search home-search-trigger"
              onClick={onOpenSearch}
              type="button"
            >
              <IconSearch aria-hidden="true" size={20} stroke={2} />
              <span>{HOME_CONTENT.searchPlaceholder}</span>
              <span className="home-search-trigger__action">Search</span>
            </button>
            {metrics ? <p className="home-metrics">{metrics}</p> : null}
          </div>
          <div className="home-atlas">
            <AppLink aria-hidden="true" className="home-map" onNavigate={onNavigate} tabIndex={-1} view="atlas-map">
              <HomeAtlasMap map={HOME_SURFACE.map} />
            </AppLink>
            <div className="home-atlas__caption">
              <p className="home-eyebrow">{atlas.eyebrow}</p>
              <h2 className="home-atlas__heading">{atlas.heading}</h2>
              <div className="home-atlas__actions">
                <AppLink className="home-atlas__open" onNavigate={onNavigate} view="atlas-map">
                  {atlas.action} <Arrow />
                </AppLink>
                <details className="home-topics" data-home-topics ref={topicsRef}>
                  <summary>{HOME_SURFACE.topicsHint} <span aria-hidden="true">▾</span></summary>
                  <nav aria-label={atlas.topicsLabel} className="home-topics__panel">
                    <ul>
                      {HOME_SURFACE.topics.map((topic) => (
                        <li key={topic.id}>
                          <AppLink
                            className="home-topics__link"
                            onNavigate={onNavigate}
                            patch={{ atlasJourney: topic.id } as Partial<ViewState>}
                            title={topic.expansion || undefined}
                            view="atlas-map"
                          >
                            {topic.label}
                          </AppLink>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </details>
              </div>
            </div>
          </div>
          <p className="home-start">
            {start.prompt}{" "}
            <AppLink className="home-start__link" onNavigate={onNavigate} view="start-here">
              {start.action} <Arrow />
            </AppLink>
          </p>
        </div>
      </div>

      <nav aria-label="Tools" className="home-tools">
        <ul className="home-wrap">
          {HOME_TOOLS.map((tool) => (
            <li key={tool.id}>
              <AppLink className="home-tool" onNavigate={onNavigate} view={tool.view as ViewState["view"]}>
                <strong className="home-tool__label">{tool.label}</strong>
                <span className="home-tool__description">{tool.description}</span>
                <span className="home-tool__action">{tool.action} <Arrow /></span>
              </AppLink>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="home-library-heading" className="home-library">
        <div className="home-wrap">
          <div className="home-library__main">
            <div className="home-library__head">
              <div>
                <p className="home-eyebrow">{library.eyebrow}</p>
                <h2 id="home-library-heading">{library.heading}</h2>
                <p>{library.lead}</p>
              </div>
              <AppLink className="home-library__all" onNavigate={onNavigate} view="search">
                {library.all} <Arrow />
              </AppLink>
            </div>
            <ul className="home-library__list">
              {HOME_LIBRARY_DISCOVERY.map((item) => (
                <li key={item.id}>
                  <AppLink className="home-library__item" onNavigate={onNavigate} patch={item.patch} view="search">
                    <span className="home-library__question">{item.question}</span>
                    <span className="home-library__label">{item.label}</span>
                    <span className="home-library__description">{item.description}</span>
                    <span className="home-library__count">{item.count.toLocaleString("en-US")} records <Arrow /></span>
                  </AppLink>
                </li>
              ))}
            </ul>
            {recent ? (
              <AppLink className="home-pulse-row" onNavigate={onNavigate} view="sources">
                <span className="home-pulse-row__label">{pulseCopy.compactLabel}</span>
                <span className="home-pulse-row__text">
                  {recent.count} {recent.count === 1 ? "publication" : "publications"} · <time dateTime={recent.date}>{recent.dateLabel}</time>
                </span>
                <Arrow />
              </AppLink>
            ) : null}
          </div>
          <aside aria-labelledby="home-pulse-heading" className="home-pulse">
            <h2 id="home-pulse-heading">{pulseCopy.heading}</h2>
            {changes.length ? (
              <ol className="home-pulse__list">
                {changes.map((change) => (
                  <li className="home-pulse__change" key={change.id}>
                    <time dateTime={change.date}>{change.dateLabel}</time>
                    <strong>{change.title}</strong>
                    {change.fact ? <p>{change.fact}</p> : null}
                    <AppLink
                      className="home-pulse__open"
                      onNavigate={onNavigate}
                      patch={change.patch as Partial<ViewState>}
                      view={change.view as ViewState["view"]}
                    >
                      {change.linkLabel} <Arrow />
                    </AppLink>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="home-pulse__quiet">{pulseCopy.quiet}</p>
            )}
            <AppLink className="home-pulse__all" onNavigate={onNavigate} view="sources">
              {pulseCopy.all} <Arrow />
            </AppLink>
          </aside>
        </div>
      </section>
    </section>
  );
}
