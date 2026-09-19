import { type CSSProperties } from "react";
import {
  IconBuildingBank,
  IconMap2,
  IconTargetArrow,
  IconTopologyStar3,
  IconRoute,
} from "@tabler/icons-react";

import { parseHashLocation, serializeHashUrl } from "../lib/hashRoutes";
import { areaPresentationForCatalog } from "../lib/areaVisualLanguage";
import { ATLAS_LENS_ENTRIES, type AtlasLensEntry } from "../lib/atlasLensEntries";

type AtlasLensBarProps = {
  /** The publication currently in scope, if any. */
  activePublicationId: string;
  /** True once any scope is set, so the way back is offered. */
  scoped: boolean;
  /** Which survey the unscoped Atlas is showing: "" or "publishers". */
  landing: string;
  onPick: (entry: AtlasLensEntry) => void;
  onWholeLandscape: () => void;
  onLandingChange: (landing: string) => void;
};

/**
 * The doors into the landscape, named the way practitioners name them.
 *
 * These sit above the map rather than inside it, and only once the reader is
 * inside something: from there they are the way across to another framework
 * without going home first. On the landing they were a shortcut past a
 * survey that already answers the same question, so they were repeating what
 * was on screen and delaying it. "Whole Atlas" appears only when there is
 * something to come back from, and is named apart from the map's own "All
 * groups" so two controls on one screen never share a name.
 */
export function AtlasLensBar(props: AtlasLensBarProps) {
  const {
    activePublicationId,
    scoped,
    landing,
    onPick,
    onWholeLandscape,
    onLandingChange,
  } = props;

  // A real link preserves browser/new-tab behavior and the map's return scope.
  const hash = typeof window === "undefined" ? "/atlas" : window.location.hash.slice(1);
  const split = hash.indexOf("?");
  const current = parseHashLocation(split < 0 ? hash : hash.slice(0, split), split < 0 ? "" : hash.slice(split));
  const researchHref = current.view === "atlas-map" ? serializeHashUrl({ ...current,
    atlasResearch: "path", atlasFrom: current.node || current.atlasFrom,
    atlasPins: current.atlasPins || (current.node ? JSON.stringify([current.node]) : ""),
  }) : "#/atlas?atlasResearch=path";

  return (
    <nav aria-label="Ways into the Atlas" className="atlas-lens-bar">
      {/* These earn their room once the reader is inside something: from there
          they are the way across to another framework without going home
          first. On the landing they duplicated the map below them. */}
      {scoped ? (
        <>
          <p className="atlas-lens-bar__lede">Start from</p>
          <ul>
            {ATLAS_LENS_ENTRIES.map((entry) => {
              const area = areaPresentationForCatalog(entry.publicationId);
              const active = entry.publicationId === activePublicationId;
              return (
                <li key={entry.id}>
                  <button
                    aria-current={active ? "true" : undefined}
                    className="atlas-lens-bar__entry"
                    onClick={() => onPick(entry)}
                    style={
                      {
                        "--ca-area-color": `var(${area?.token || "--ca-area-operations"})`,
                      } as CSSProperties
                    }
                    title={`${entry.label} — ${entry.blurb}`}
                    type="button"
                  >
                    <span aria-hidden="true" className="atlas-lens-bar__dot" />
                    {/* Label only. These render once the reader is inside
                        something, where they are a way across rather than a
                        menu to be read; spelling all seven out wrapped the bar
                        onto a second row. The blurb stays on the title. */}
                    <span className="atlas-lens-bar__label">{entry.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {scoped ? (
        <button
          className="atlas-lens-bar__reset"
          onClick={onWholeLandscape}
          type="button"
        >
          <IconMap2 aria-hidden="true" size={15} stroke={1.9} />
          Whole Atlas
        </button>
      ) : (
        // Three questions about the same 28 publications: what each document
        // is, who issues it, and what you are trying to get done. None of them
        // ranks one framework above another, which the old single landscape
        // did by accident — it drew all 28 at once and put whatever nothing
        // else built on at the top.
        //
        // The publisher lens is also where the statutes and directives live:
        // authority carries no crosswalks, so it cannot appear on a map drawn
        // from them.
        <div aria-label="Group the Atlas by" className="atlas-lens-bar__survey" role="group">
          <button
            aria-pressed={landing === ""}
            onClick={() => onLandingChange("")}
            title="Group by what each document is — control catalogs, risk frameworks, threat knowledge, and so on"
            type="button"
          >
            <IconTopologyStar3 aria-hidden="true" size={15} stroke={1.8} />
            By kind
          </button>
          <button
            aria-pressed={landing === "publishers"}
            onClick={() => onLandingChange("publishers")}
            title="Group by who issues it — NIST, DISA, MITRE, DoD, and the rest"
            type="button"
          >
            <IconBuildingBank aria-hidden="true" size={15} stroke={1.8} />
            By publisher
          </button>
          <button
            aria-pressed={landing === "job"}
            onClick={() => onLandingChange("job")}
            title="Group by what you are trying to get done — pick controls, assess, harden, and so on"
            type="button"
          >
            <IconTargetArrow aria-hidden="true" size={15} stroke={1.8} />
            By job
          </button>
        </div>
      )}
      <a className="atlas-lens-bar__reset" href={researchHref}>
        <IconRoute aria-hidden="true" size={15} stroke={1.8} /> Find a connection
      </a>
    </nav>
  );
}
