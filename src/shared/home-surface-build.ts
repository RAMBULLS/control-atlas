/**
 * Builds the Home surface (see home-surface.ts) at build time. Imported only by
 * vite.config.ts and tests, never by the browser bundle.
 *
 * Every value comes from an existing authority: topics from the issue 282 journey
 * registry, the map from the Atlas territory geography, and source changes
 * from the Pulse artifact. Nothing is invented here, and the Pulse summaries
 * (which narrate our own acceptance) are never shown; each line is composed
 * from the event's recorded publication, counts and versions.
 */
import type { Pt, TerritoryGeometry } from "../ui/lib/atlasTerritoryGeography";
import { coastPolygon, landmarkPosition, ringPolygon } from "../ui/lib/atlasTerritoryGeography";
import type { HomePulse, HomeSourceChange, HomeSurface, HomeTopic } from "./home-surface";

type Journey = { id: string; label: string; expansion: string };
type PulseEvent = {
  id: string;
  type: string;
  date: string;
  timestamp: string;
  subject?: { kind: string; id: string; name: string };
  title: string;
  counts?: { previous_records?: number; current_records?: number; added?: number; removed?: number; changed?: number; superseded?: number };
  identity?: { publisher_version?: string; previous_publisher_version?: string };
  destination?: { label: string; view: string; patch: Record<string, unknown>; href: string };
};
type PulseArtifact = { events: PulseEvent[] };

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const n = (value: number) => value.toLocaleString("en-US");
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const d = (points: readonly Pt[]) => `M${points.map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join("L")}Z`;

/** The home line for one source change, or null when it has no publication subject or no destination. */
export function sourceChangeLine(event: PulseEvent, displayName = event.subject?.name): HomeSourceChange | null {
  const subject = event.subject;
  const destination = event.destination;
  if (subject?.kind !== "publication" || !destination?.href?.startsWith("#/")) return null;
  const c = event.counts || {};
  const name = displayName?.trim() || subject.name;
  // One event, one useful fact. Version changes do not also narrate ingestion
  // counts. Unknown event types do not fall back to pipeline-authored copy.
  let title: string;
  let fact = "";
  if (event.type === "publication_updated" && event.identity?.publisher_version) {
    title = `${name} updated`;
    const previous = event.identity.previous_publisher_version;
    fact = previous && previous !== event.identity.publisher_version
      ? `Version ${event.identity.publisher_version} replaces ${previous}.`
      : `Version ${event.identity.publisher_version}.`;
  } else if (event.type === "records_added" && isCount(c.added) && c.added > 0) {
    title = `${name}: ${n(c.added)} new records`;
    if (isCount(c.removed) && c.removed > 0) fact = `${n(c.removed)} records removed.`;
  } else if (event.type === "records_removed" && isCount(c.removed) && c.removed > 0) {
    title = `${name}: ${n(c.removed)} records removed`;
  } else if (event.type === "records_changed" && isCount(c.changed) && c.changed > 0) {
    title = `${name}: ${n(c.changed)} records revised`;
  } else if (event.type === "records_superseded" && isCount(c.superseded) && c.superseded > 0) {
    title = `${name}: ${n(c.superseded)} records superseded`;
  } else if (event.type === "snapshot_changed" && isCount(c.current_records) && isCount(c.previous_records)) {
    // A net count difference does not identify additions or removals. Both can
    // occur in the same snapshot. Preserve that uncertainty rather than invent
    // an itemized publisher change from two totals.
    if (c.current_records === c.previous_records) return null;
    title = `${name} updated`;
    fact = "The record count changed; individual changes are not available.";
  } else {
    return null;
  }
  return {
    id: event.id,
    date: event.date,
    dateLabel: SHORT_DATE.format(utc(event.date)),
    title,
    fact,
    href: destination.href,
    view: destination.view,
    patch: destination.patch,
    linkLabel: `Open ${name}`,
  };
}

/** Source changes only, newest change per publication, newest first. */
export function homePulse(pulse: PulseArtifact, limit = 2, displayNames: Readonly<Record<string, { alias: string }>> = {}): HomePulse {
  const seen = new Set<string>();
  const newestPerPublication: { event: PulseEvent; line: HomeSourceChange }[] = [];
  for (const event of [...pulse.events].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
    const line = sourceChangeLine(event, displayNames[event.subject?.id || ""]?.alias);
    if (!line || seen.has(event.subject!.id)) continue;
    seen.add(event.subject!.id);
    newestPerPublication.push({ event, line });
  }
  const latest = newestPerPublication[0]?.line.date;
  return {
    changes: newestPerPublication.slice(0, limit).map((entry) => entry.line),
    recent: latest
      ? { count: newestPerPublication.filter((entry) => entry.line.date === latest).length, date: latest, dateLabel: MONTH_DAY.format(utc(latest)) }
      : null,
  };
}

/** Static drawing of the Atlas overview: the same geometry the Atlas MiniMap draws. */
export function homeMap(geometry: TerritoryGeometry, areaTokens: Readonly<Record<string, string>>) {
  const occupiedSlots = new Set(Object.values(geometry.assignments));
  const o = geometry.overview;
  return {
    viewBox: `${o.x} ${o.y + 6} ${o.w} ${o.h - 52}`,
    coast: d(coastPolygon(geometry)),
    areas: geometry.territories.map((territory) => {
      const token = areaTokens[territory.id];
      if (!token) throw new Error(`Atlas area ${territory.id} has no color token.`);
      return {
        id: territory.id,
        token,
        d: d(ringPolygon(geometry, territory.ring)),
        empty: !territory.slots.some((slot) => occupiedSlots.has(slot.id)),
        name: { x: territory.name.x, y: territory.name.y, lines: [...territory.name.lines] },
      };
    }),
    landmarks: Object.entries(geometry.presentation)
      .filter(([, presentation]) => presentation.major)
      .flatMap(([id, presentation]) => {
        const at = landmarkPosition(geometry, id);
        return at ? [{ id, alias: presentation.alias, x: at[0], y: at[1] }] : [];
      }),
  };
}

export function buildHomeSurface(input: {
  journeys: readonly Journey[];
  journeyHref: (id: string) => string;
  shownTopics: number;
  geometry: TerritoryGeometry;
  areaTokens: Readonly<Record<string, string>>;
  pulse: PulseArtifact;
}): HomeSurface {
  const topics: HomeTopic[] = input.journeys.map((journey) => ({
    id: journey.id,
    label: journey.label,
    expansion: journey.expansion,
    href: input.journeyHref(journey.id),
  }));
  const shown = topics.slice(0, input.shownTopics).map((topic) => topic.label);
  const more = topics.length - shown.length;
  return {
    topics,
    topicsHint: [...shown, ...(more > 0 ? [`${more} more`] : [])].join(" · "),
    map: homeMap(input.geometry, input.areaTokens),
    pulse: homePulse(input.pulse, 2, input.geometry.presentation),
  };
}
