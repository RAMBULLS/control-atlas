# Atlas vNext — the territory sheet

- **Owner:** Product owner and Muse
- **Status:** Implemented on PR #261 as the first production delivery of Atlas vNext; #260 remains the umbrella program and stays open. Awaiting owner acceptance; not merged or deployed.
- **Last reviewed:** 2026-09-19
- **Supersession:** Replaces docs/ATLAS_RESEARCH.md (folded in below) and the landing, decomposition-column and "Find a connection" designs. Page-level rules live in docs/PAGE_CONTRACTS.md section C.

## What this is

Atlas is one sheet: nine areas laid out as a single landmass, with each publication a named place inside its area. A line means published records connect two places. Everything else is navigation. Neighboring areas imply no authority, applicability, equivalence, dependency or hierarchy, and no line is ever drawn from adjacency, a shared publisher, a shared kind, or the editorial dependency spine.

The approved reference is the "Territory Edition" prototype. The prototype branch is not merged; only its concepts were ported, onto the production data, route state, research engine, evidence components and tests.

## Governed geography

`data/curated/atlas-territory-geography.json` (version `territory-1`) is the only source of position.

- Territories are polygons on a shared vertex mesh, so neighbours share identical borders.
- Every landmark has an explicit **slot id** (`territory.<area>.slot.<nn>`) and an `assignments` entry mapping its catalog id to that slot. Position never comes from array order, counts, filters, layers or view state.
- A new publication takes a free reserved slot; no existing coordinate moves. A full territory is reported instead of guessed at. Changing any coordinate is a deliberate revision: bump the version and the fingerprint in `tests/graph/atlasTerritoryGeography.test.ts` together.
- Each publication has a reviewed short **alias** (for example "SP 800-53 Rev. 5", "ATT&CK Enterprise") and a **major** flag. Major landmarks are an explicit reviewed list, not derived from counts. Names are never shortened by character count.
- `validateTerritoryGeometry` enforces: exactly the canonical areas, shared borders, one slot per mapped publication inside its own territory, unique aliases, no truncation.

Empty territories (Operations, Knowledge today) are drawn muted and carry no name at rest.

## Semantic zoom

At overview only major landmarks are named. Selecting a territory zooms to it and names every publication in it. Selecting a publication draws its routes. Selecting a record places it at its publication. The view tween is skipped under `prefers-reduced-motion`. Sizes are screen-constant, so labels stay readable at every zoom.

Routes are transit-style: octilinear segments, the variant that crosses the fewest labels, rounded corners, an arrow following the recorded direction.

## Data

| Artifact | Built | Size | Loaded when |
| --- | --- | --- | --- |
| `atlas-territory/<sha>.json` + manifest | with the site, from published connections and record tags | 20 KB | every Atlas view |
| `atlas-research/<sha>.json` | with the site, same admission rule | 67 MB (2.8 MB gz) | in a worker, when a record is focused or a record-level question is asked |
| `library-search` shards | existing | 54 MB (3.4 MB gz) | when the reader focuses the search box |

The 11 MB relationship network and the hierarchy spine are not loaded for the sheet.

The territory index admits an edge only if the research policy admits it (`isAtlasResearchEdge`: published, publisher authority, not inferred, a relationship class of correlation or applicability, an exact source locator). It records per publication pair: total, direction counts, relationship types, and one sample connection with its source and locator. It is validated against its manifest on load and refuses a snapshot built for a different geography version.

The research index keeps original admitted edge objects, verifies its SHA-256 and counts in the worker, and never returns a result from a partial or invalid index. A download, integrity or worker failure is shown as a failure ("This does not mean there is no connection") with Retry, never as an empty result. Hop, node and edge budgets stop a search and are reported as limits, not as absence.

## Behavior

- **Hub reveal.** A publication shows its four routes with the most published record connections first (ties by key: a count-based sample, not an importance ranking), says how many more exist, offers relationship-type choices and "Show all N", and its details always list the complete set.
- **Route evidence.** Every line opens "Why connected": relationship, direction, published source and version, example location, status.
- **Trace upstream.** From a record, follow recorded connections outward to the nearest records in publications whose governed kind is "Control catalog". Endpoints are discovered from the accepted graph; no control is named in code. Direction is forward by default; reverse traversal is an explicit, labeled choice. The flagship check is V-205646 → CCI-000185 → the accepted NIST endpoint, asserted in tests from the corpus.
- **Pins.** Two to six publications, or two to six records; not mixed. State is in the URL.
- **Shared ground.** Publications: connected to all, connected to some, only one, direct routes. Records: all and some, each with per-pin evidence. Zero is stated as an answer.
- **Context.** Narrow the sheet by Program, Product and Asset (for example STIG + Microsoft Windows + Server). The rule is the Library's own: choices within one dimension widen (OR), choices across dimensions narrow (AND). Values no record carries are not offered. Tags live on **records**, so context is a **record-match projection**: a publication is highlighted because some of its records carry the choices, with the number of matching records and a per-choice breakdown. It never means the publication has those choices, that every record in it matches, or that the material applies to the reader. Public copy says "Showing publications containing records associated with this context" and never uses internal vocabulary. Context only dims, highlights and counts: no coordinate, boundary or slot changes (a unit test and a browser test assert zero drift). Program is treated exactly like Product and Asset: the governed program assignments are recorded on records (derived from catalog scope by a governed rule), not on publications, so the record-match behavior applies and nothing is inferred from publisher or name. An impossible combination says "No records match this context" and offers to clear one choice or all. "View matching records" opens the Library with the same tags and the publication as its filter.
- **Share this view.** Copies the canonical URL and says "Link copied" only after the clipboard accepts it; a failure says "Copy failed. Use your browser's share menu." The URL holds only bounded state: focus, pins, path endpoints and settings, context, layer. A computed path is never serialized.
- **Change-view foundation.** Every shared link is stamped with `atlasDataset`, a 12-character identity of the accepted dataset (a digest of the node and edge collections). Opening a link from a different dataset keeps that identity through navigation and says plainly that results may differ. No comparison control exists; saved-view comparison is #262.
- **Compare.** Offered only for exactly two publication pins, as a link into the existing Compare with those two publications; otherwise absent, not disabled.
- **Layers.** Only Publisher, because it is the only layer with governed publication-level data. Product, security domain, lifecycle and change layers are not shown until their data exists.
- **Search.** Existing infrastructure: `resolveAtlasSearchTransition` for records, reviewed aliases for publications. An identifier opens the record; a publication name opens the publication; ambiguous text goes to Library search; no match stays on the page with recovery links.
- **Authority · N** and **Other publications · N** are visible lists.
- **Phone.** List first. The map becomes a small tappable orientation map; every fact is in the list; the selected item's details come right after the current area.

## URL state

`atlasLimb` (area), `atlasFramework` (publication), `node` (record), `atlasPins`, `atlasResearch` (`path`, `shared`, `upstream`), `atlasFrom`, `atlasTo`, `atlasDirection`, `atlasLayer` (`publisher:<name>`), `atlasContext` (comma-separated tag ids), `atlasDataset` (12 hex characters). A computed path is never serialized. Older scoped links (`atlasAxis=framework`, `atlasFamily`, `atlasBenchmark`, `atlasBaseline`, `atlasRmfStep`, `relationshipView`, relationship filters) keep opening the earlier workspace, which is also where "Full connection list" leads.

## Verification

- Unit: geography, routes, index, shared ground, state and URL, routing, research on the real corpus (`tests/graph/atlasTerritory*.test.ts`).
- Browser: `tests/e2e/atlas-territory.spec.mjs` covers overview, hub reveal, evidence, zero shared, Compare handoff, pins through refresh/back/forward, the publisher layer, search, the flagship trace, failure recovery, six widths, keyboard, reduced motion and accessibility.

## Measured (Chromium, local static build)

| Measure | Result |
| --- | --- |
| Overview ready (`.terr` drawn) | about 0.36 s; 311 KB transferred including the app shell |
| Overview data fetched | catalog bootstrap 4 KB, territory index (routes, evidence samples and context) 20 KB raw. No network, spine, research index or search shards |
| Territory route JS | 21 KB gzip (the replaced page was 94 KB gzip) |
| Territory focus, click to focused | 23 ms |
| Hub focus with routes drawn | 39 ms |
| Search: pick a record to it on the map | about 0.2 s (the first focus of the search box also fetches the 3.4 MB search shards) |
| Trace after record focus (worker already loaded) | about 1.6 s including the worker's first-use graph build |
| Path calculation in the worker | median 0.2 ms, max 1.7 ms; graph build 0.4 s |
| Cold trace from a URL | about 2.6 s including the 2.8 MB research index |

## Not done, on purpose

- **Saved-view and accepted-dataset change comparison** is deferred to #262 because the repository has no trustworthy retained history. There is no "Show changes" control and no invented baseline. #260 stays open until #262 is complete.
- Lifecycle and source-status layers are not built. Lifecycle appears only when governed lifecycle data supports it. Kind and job layers may return later only as non-geographic layers that earn a place.
- The earlier landing grammar (by kind, by publisher, by job) and the FedRAMP active/historical badges are intentionally not restored; Publisher remains a layer.
- Library map duplication (`LibraryAtlasMap`) is deferred until this design is accepted.
- The earlier workspace (decomposition columns, benchmark, baseline and RMF scoping, the full relationship workspace) stays for deep links. Removing it, and the components only it uses, is a separate cleanup once the owner accepts the sheet.
