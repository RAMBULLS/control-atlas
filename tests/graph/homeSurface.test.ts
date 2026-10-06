import assert from "node:assert/strict";
import test from "node:test";

import { buildHomeSurface, homePulse, sourceChangeLine } from "../../src/shared/home-surface-build.ts";
import { PROHIBITED_PRIMARY_SURFACE_PATTERNS } from "../../src/shared/site-copy.mjs";
import { AREA_PRESENTATIONS } from "../../src/ui/lib/areaVisualLanguage.ts";
import { JOURNEYS } from "../../src/ui/lib/atlasJourneys.ts";
import { TERRITORY_GEOMETRY } from "../../src/ui/lib/atlasTerritoryGeography.ts";

const destination = (catalog: string) => ({
  label: `Open ${catalog}`,
  view: "catalog-detail",
  patch: { catalog },
  href: `#/library/publication/${catalog}`,
});
const event = (overrides: Record<string, unknown>) => ({
  id: "event",
  type: "records_added",
  date: "2026-01-10",
  timestamp: "2026-01-10T12:00:00.000Z",
  title: "Pipeline title",
  summary: "Control Atlas accepted a change.",
  subject: { kind: "publication", id: "pub-a", name: "Publication A" },
  counts: { previous_records: 10, current_records: 12, added: 2, removed: 0 },
  destination: destination("pub-a"),
  ...overrides,
});
const areaTokens = Object.fromEntries(AREA_PRESENTATIONS.map((area) => [area.id, area.token]));

test("Home source changes come only from publications, newest change per publication first", () => {
  const pulse = {
    events: [
      event({ id: "a-old", timestamp: "2026-01-09T00:00:00.000Z", date: "2026-01-09" }),
      event({ id: "a-new" }),
      event({ id: "b", subject: { kind: "publication", id: "pub-b", name: "Publication B" }, destination: destination("pub-b"), timestamp: "2026-01-10T08:00:00.000Z" }),
      event({ id: "c", subject: { kind: "publication", id: "pub-c", name: "Publication C" }, destination: destination("pub-c"), timestamp: "2026-01-08T00:00:00.000Z", date: "2026-01-08" }),
      event({ id: "feature", type: "feature_shipped", subject: { kind: "product", id: "control-atlas", name: "Control Atlas" }, timestamp: "2026-01-11T00:00:00.000Z", date: "2026-01-11" }),
      event({ id: "set", type: "relationships_changed", subject: { kind: "relationship_set", id: "x", name: "A to B" }, timestamp: "2026-01-12T00:00:00.000Z", date: "2026-01-12" }),
    ],
  };
  const home = homePulse(pulse);
  assert.deepEqual(home.changes.map((change) => change.id), ["a-new", "b"]);
  // Two publications changed on the newest source-change date; product and
  // relationship-set events never count.
  assert.deepEqual(home.recent, { count: 2, date: "2026-01-10", dateLabel: "Jan 10" });
});

test("Home composes each line from recorded counts and versions, never from the Pulse summary", () => {
  const added = sourceChangeLine(event({}))!;
  assert.equal(added.title, "Publication A: 2 new records");
  assert.equal(added.fact, "");
  const updated = sourceChangeLine(event({
    type: "publication_updated",
    identity: { publisher_version: "2026.2", previous_publisher_version: "2026.1" },
    counts: { previous_records: 10, current_records: 15, added: 5, removed: 0 },
  }))!;
  assert.equal(updated.title, "Publication A updated");
  assert.equal(updated.fact, "Version 2026.2 replaces 2026.1.");
  assert.doesNotMatch(updated.fact, /records|Was /);
  const grew = sourceChangeLine(event({ type: "snapshot_changed", counts: { previous_records: 10, current_records: 40 } }))!;
  assert.deepEqual([grew.title, grew.fact], ["Publication A updated", "The record count changed; individual changes are not available."]);
  const shrank = sourceChangeLine(event({ type: "snapshot_changed", counts: { previous_records: 40, current_records: 37 } }))!;
  assert.deepEqual([shrank.title, shrank.fact], ["Publication A updated", "The record count changed; individual changes are not available."]);
  const withRemovals = sourceChangeLine(event({ counts: { previous_records: 10, current_records: 11, added: 3, removed: 2 } }))!;
  assert.equal(withRemovals.fact, "2 records removed.");
  for (const line of [added, updated, grew]) {
    for (const text of [line.title, line.fact, line.linkLabel]) {
      assert.ok(!PROHIBITED_PRIMARY_SURFACE_PATTERNS.some((pattern) => pattern.test(text)), text);
      assert.doesNotMatch(text, /Control Atlas accepted|None removed|in the set/i);
    }
  }
  assert.equal(sourceChangeLine(event({ destination: { ...destination("pub-a"), href: "https://example.org" } })), null);
});

test("a quiet period shows no rows and no recent count", () => {
  assert.deepEqual(homePulse({ events: [] }), { changes: [], recent: null });
});

test("Home topics are the #282 journey registry, in registry order, behind one hint", () => {
  const surface = buildHomeSurface({
    journeys: JOURNEYS,
    journeyHref: (id) => `#/atlas?atlasJourney=${id}`,
    shownTopics: 3,
    geometry: TERRITORY_GEOMETRY,
    areaTokens,
    pulse: { events: [] },
  });
  assert.deepEqual(surface.topics.map((topic) => topic.id), JOURNEYS.map((journey) => journey.id));
  assert.equal(
    surface.topicsHint,
    `${JOURNEYS.slice(0, 3).map((journey) => journey.label).join(" · ")} · ${JOURNEYS.length - 3} more`,
  );
  // The map is the Atlas territory geometry: every area, each with its color token.
  assert.deepEqual(surface.map.areas.map((area) => area.id), TERRITORY_GEOMETRY.territories.map((territory) => territory.id));
  assert.ok(surface.map.areas.every((area) => area.token.startsWith("--ca-area-") && area.d.startsWith("M")));
  assert.ok(surface.map.landmarks.length > 0);
});

test("an Atlas area without a color token fails the build instead of drawing grey", () => {
  assert.throws(() => buildHomeSurface({
    journeys: JOURNEYS,
    journeyHref: (id) => id,
    shownTopics: 3,
    geometry: TERRITORY_GEOMETRY,
    areaTokens: {},
    pulse: { events: [] },
  }), /has no color token/);
});


test("Home source events use governed short names and never guess from a net delta", () => {
  const version = sourceChangeLine(event({
    type: "publication_updated",
    subject: { kind: "publication", id: "fedramp-2026", name: "FedRAMP Consolidated Rules for 2026" },
    identity: { publisher_version: "2026.09.13.02", previous_publisher_version: "2026.07.14.01" },
    counts: { added: 5, removed: 1 },
  }), "FedRAMP 2026")!;
  assert.equal(version.title, "FedRAMP 2026 updated");
  assert.equal(version.linkLabel, "Open FedRAMP 2026");
  assert.equal(version.fact, "Version 2026.09.13.02 replaces 2026.07.14.01.");
  assert.equal(sourceChangeLine(event({ type: "future_event" })), null);
  assert.equal(sourceChangeLine(event({ counts: { added: 0 } })), null);
  assert.equal(sourceChangeLine(event({ type: "snapshot_changed", counts: { previous_records: 8, current_records: 8 } })), null);
});
