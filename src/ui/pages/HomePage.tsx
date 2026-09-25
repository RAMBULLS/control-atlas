import {
  IconArrowRight,
  IconBooks,
  IconRocket,
  IconSearch,
  IconUsersGroup,
} from "@tabler/icons-react";

import { HOME_CONTENT, HOME_DESTINATIONS } from "../../shared/home-content.mjs";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { ATLAS_SCOPE_METRICS } from "../../shared/atlas-presentation";
import { HOME_SURFACE } from "../../shared/home-surface";
import { AppLink } from "../components/AppLink";
import { HOME_LIBRARY_DISCOVERY } from "../lib/homeTagConstellation";
import type { ViewState } from "../lib/viewState";

type HomePageProps = {
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenSearch: () => void;
};

const DESTINATION_ICONS = {
  "start-here": IconRocket,
  library: IconBooks,
  resources: IconUsersGroup,
} as const;

const ATLAS = SITE_COPY.home.atlas;
const PULSE = SITE_COPY.home.pulse;

/** "What changed": the bounded Pulse slice computed at build time. Markup matches renderStaticHome in vite.config.ts. */
function HomePulse({ onNavigate }: Pick<HomePageProps, "onNavigate">) {
  const pulse = HOME_SURFACE.pulse;
  return (
    <section
      aria-labelledby="home-pulse-heading"
      className="home-pulse"
      data-dataset-id={pulse.datasetId}
      data-pulse-quiet={String(pulse.quiet)}
    >
      <div className="home-pulse__heading">
        <h2 id="home-pulse-heading">{PULSE.heading}</h2>
        <p>{PULSE.intro}</p>
      </div>
      {pulse.events.length === 0 ? (
        <p className="home-pulse__empty">{PULSE.empty}</p>
      ) : pulse.quiet ? (
        <p className="home-pulse__quiet">
          {PULSE.quietLead} {pulse.latestLabel}. {PULSE.checkedLead} {pulse.checkedLabel}.
        </p>
      ) : null}
      {pulse.events.length ? (
        <ol className="home-pulse__list">
          {pulse.events.map((event) => (
            <li className="home-pulse__event" data-pulse-type={event.type} key={event.id}>
              <article aria-labelledby={`pulse-${event.id}`}>
                <p className="home-pulse__meta">
                  <span className="home-pulse__type">{event.typeLabel}</span>
                  <time dateTime={event.date}>{event.dateLabel}</time>
                </p>
                <h3 className="home-pulse__title" id={`pulse-${event.id}`}>{event.title}</h3>
                <p className="home-pulse__summary">{event.summary}</p>
                <AppLink
                  className="home-pulse__action"
                  onNavigate={onNavigate}
                  patch={event.destination.patch as Partial<ViewState>}
                  view={event.destination.view as ViewState["view"]}
                >
                  {event.destination.label}
                  <span className="home-sr"> for {event.title}</span>{" "}
                  <IconArrowRight aria-hidden="true" size={16} stroke={2} />
                </AppLink>
              </article>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function HomePage({ onNavigate, onOpenSearch }: HomePageProps) {
  return (
    <section
      aria-labelledby="home-title"
      className="home-entry"
      data-template="B"
      data-visual-identity="universal-front-door"
    >
      <div className="home-hero home-atlas" data-home-flagship="atlas">
        <div className="home-hero-lead">
          <header className="home-entry-header">
            <p className="eyebrow home-atlas__eyebrow">{ATLAS.eyebrow}</p>
            <h1 id="home-title">{ATLAS.headline}</h1>
            <p className="home-product-identity">{HOME_CONTENT.definition}</p>
            <p className="home-breadth">{ATLAS.lead}</p>
          </header>

          <p className="home-atlas__actions">
            <AppLink className="home-atlas__open" onNavigate={onNavigate} view="atlas-map">
              {ATLAS.action} <IconArrowRight aria-hidden="true" size={18} stroke={2} />
            </AppLink>
          </p>

          <nav aria-labelledby="home-journeys-heading" className="home-journeys">
            <h2 className="home-journeys__heading" id="home-journeys-heading">{ATLAS.journeysHeading}</h2>
            <ul className="home-journeys__list">
              {HOME_SURFACE.journeys.map((journey) => (
                <li key={journey.id}>
                  <AppLink
                    className="home-journey"
                    onNavigate={onNavigate}
                    patch={{ atlasJourney: journey.id } as Partial<ViewState>}
                    view="atlas-map"
                  >
                    {journey.label}
                  </AppLink>
                </li>
              ))}
            </ul>
          </nav>

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

          {ATLAS_SCOPE_METRICS ? (
            <p className="atlas-scope-strip">
              {ATLAS_SCOPE_METRICS.compact.records} searchable records
              <span aria-hidden="true"> · </span>
              {ATLAS_SCOPE_METRICS.compact.connections} connections
              <span aria-hidden="true"> · </span>
              {ATLAS_SCOPE_METRICS.compact.publications} source publications
            </p>
          ) : null}
        </div>
      </div>

      <HomePulse onNavigate={onNavigate} />

      <nav aria-label="Choose a Control Atlas destination" className="home-secondary-grid">
        {HOME_DESTINATIONS.map((destination) => {
          const Icon = DESTINATION_ICONS[destination.id as keyof typeof DESTINATION_ICONS];
          return (
            <AppLink
              className="home-secondary-action"
              key={destination.id}
              onNavigate={onNavigate}
              view={destination.view as ViewState["view"]}
            >
              <Icon aria-hidden="true" size={20} stroke={1.7} />
              <span>
                <strong>{destination.label}</strong>
                <small>{destination.description}</small>
              </span>
              <IconArrowRight aria-hidden="true" className="home-secondary-arrow" size={16} stroke={2} />
            </AppLink>
          );
        })}
      </nav>

      <nav aria-labelledby="home-library-heading" className="home-library-discovery">
        <div className="home-library-discovery__heading">
          <div>
            <p className="eyebrow">BROWSE THE LIBRARY</p>
            <h2 id="home-library-heading">Start with what you came to find.</h2>
          </div>
          <AppLink className="home-library-discovery__all" onNavigate={onNavigate} view="search">
            Browse everything
            <IconArrowRight aria-hidden="true" size={16} stroke={2} />
          </AppLink>
        </div>
        <ul className="home-library-kpis">
          {HOME_LIBRARY_DISCOVERY.map((item) => (
            <li key={item.id}>
              <AppLink
                className="home-library-kpi"
                onNavigate={onNavigate}
                patch={item.patch}
                view="search"
              >
                <span className="home-library-kpi__question">{item.question}</span>
                <strong className="home-library-kpi__label">{item.label}</strong>
                <small className="home-library-kpi__description">{item.description}</small>
                <span className="home-library-kpi__footer">
                  <span className="home-library-kpi__count">
                    {item.count.toLocaleString("en-US")} records
                  </span>
                  <IconArrowRight aria-hidden="true" size={16} stroke={2} />
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
