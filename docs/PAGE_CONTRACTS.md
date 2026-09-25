# Control Atlas Page Contracts

- **Owner:** Product owner and Muse
- **Status:** Canonical
- **Last reviewed:** 2026-09-17
- **Supersession:** New owner-approved page direction replaces the affected section here and its tests in the same change.

Every route uses one of six shared jobs. A route renders one `<main>` and must not mount another page beneath it.

## Shared shell

The desktop header provides Start Here, Atlas, Library, Compare, Resources, Templates, and Search. Guides, Sources, and About remain available in the overflow menu. Compact navigation preserves every destination, with Compare before editorial links. Body content uses the shared spacing and width tokens. Interactive targets are at least 44 pixels, focus is visible, color is never the only signal, and layouts must reflow without page-level horizontal overflow.

## A. Landing

Home presents the product purpose, one primary search action, and concise entrances to Atlas, Library, and Resources. It does not duplicate legal, source, or provenance boilerplate already owned by About or the footer.

## B. Workspace

Library and Resources share search, visible desktop facets, a compact responsive filter drawer, result count, sorting, and incrementally rendered results. Empty search presents useful browse choices rather than the full corpus.

Library search semantics (`src/app/runtime.mjs`): every word typed must appear somewhere in a record's identifier, title, family, publication name, publisher or official text. An exact identifier, including spaced or zero-padded notation such as `ac 2` or `wn19 dc 000290`, resolves first. Identifier notation is tried before the query's own words, but it is only an aid: if it finds nothing, the search retries with the words as typed, so a query about a product and version (`windows server 2019`, `red hat 8`, `sp 800-53`) never becomes an empty page because it resembled an identifier. Bare numbers match whole numbers only. A query that contains the name of a publication (its governed source name) ranks that publication's records first. A genuine zero says so, keeps the query, and offers only recovery options counted against the real index: dropping one word, or clearing filters.

## C. Adaptive Explorer

Atlas is one route, `/atlas`, drawn as a territory sheet: nine areas laid out as one landmass, with each publication a named place inside its area. The design, its rules and its data are specified in [ATLAS_VNEXT_DESIGN.md](ATLAS_VNEXT_DESIGN.md); this section is the page contract.

The page has these parts and never shows an empty inspector:

1. **Atlas** — the title and, once something is selected, a breadcrumb (`Atlas › Area › Publication › Record`).
2. **Search** — one box for records and publications. An exact record identifier opens that record; a publication name or alias opens the publication; ambiguous text hands off to Library search; no match stays on the page with "Search all records" and "Browse the Library".
3. **Start with what you’re working on** — practitioner journeys (RMF & ATO, STIGs & SRGs, Zero Trust, CMMC & CUI, FedRAMP, Controls & baselines, Assessment & evidence, Threats & defenses, Working files). Each opens a card of real destinations: publications with the practitioner name first and the exact publication identity beside it, records, Compare pairs that have published connections, templates and task guides, resources, and the policy cited for those publications. A journey is Control Atlas navigation; it never draws a line or claims applicability. **Policy & directives** sits at the end of the row as a secondary link to the statutes, regulations and directives, grouped as the source register groups them, each with its source record, official text and the publications that cite it.
4. **Context** — narrow by Program, Product and Asset. Choices show as "Showing material for:" chips with Clear context; a publication is highlighted when some of its records match, never because it carries the choice itself.
5. **Layers** — only layers the data supports. Today that is Publisher. A layer changes styling and never moves a landmark.
6. **Share this view** — copies the canonical link and says "Link copied" only after the clipboard accepts it.
7. **Info** — what the map does and does not claim.
8. **Map** — the sheet itself, with a details panel that exists only when something is selected, a pin tray that exists only when something is pinned, and "Other publications · N".

Selection is URL state, so refresh, back, forward and shared links all restore it (`atlasLimb` area, `atlasFramework` publication, `node` record, `atlasJourney` journey, `relationshipView=list` a record's full connection list, `atlasPins`, `atlasResearch` = `path`, `shared` or `upstream`, `atlasFrom`, `atlasTo`, `atlasDirection`, `atlasLayer`, `atlasContext`, `atlasDataset`). A computed path is never written to the URL, only its endpoints. Links from the retired classic Atlas are translated on arrival (`routeIdentity.ts`): `atlasBenchmark`, a record-id `atlasBaseline` or `atlasFamily` open that record; `atlasFamily=group:<catalog>:n` opens the publication; `atlasRmfStep` opens the RMF journey (and the step record when it names one); `relationshipView=list` (or `table`) on a record opens its full connection list; everything that only described how the old board was drawn is dropped.

Rules the drawing must keep:

- Position is navigation only. A landmark's place comes from its explicit slot id in the governed geography file, never from counts, filters, layers, array order or view state. Neighboring territories imply no authority, applicability, equivalence, dependency or hierarchy.
- A line means published records connect two places, and every line opens the evidence behind it. Nothing is drawn from the editorial dependency spine, from shared publishers, or from adjacency.
- A hub shows a bounded, deterministic set of its relationships first (the four with the most published record connections), states how many more exist, offers relationship-type choices and "Show all N", and always lists the complete set in its details.
- Empty territories are drawn muted and carry no name at rest. Names are never shortened by character count; a short name is a reviewed alias.
- Shared ground is stated honestly: all, some, and none. "Nothing is shared" is an answer, not an error. Compare is offered only for exactly two publications; otherwise it is absent, not disabled.
- Motion is decoration and is removed under `prefers-reduced-motion`.

On a phone the page is list first: the territories and the selected item's facts are lists, and a small tappable map shows where you are. Nothing the map shows is available only on the map.

The relationship network (11 MB) and the hierarchy spine do not load for the sheet. It reads a 15 KB publication index built with the site; the connection index used for record traces (67 MB, 2.8 MB compressed) loads in a worker only when a record is focused or a record-level question is asked.

## D. Record detail

Every supported catalog/type resolves to one of six roles: atomic record, container, publication/document, entity/contributor, assessment/question, or implementation artifact. All roles share identity, official source action, source facts, publisher hierarchy, and a bounded relationship handoff; role composers control only the source-native middle of the page.

The owner-approved record mockup for issue #254 governs this composition:

1. **Identity and actions:** Canonical breadcrumb, publisher-native identity, and publisher-authored title. STIG rules and SRG requirements use the native finding identifier alone as the detail H1 (for example, `V-205646`); their full official finding title remains immediately below. The breadcrumb names the area, publisher, concise benchmark, and finding without repeating the umbrella DISA catalog. Full benchmark identity and publisher hierarchy remain available. Qualified identities in Library/Atlas, generated titles, and other record roles are unchanged. On desktop, the primary source, connections, and secondary-action controls form a compact cluster beside the identity. The utility rail begins alongside the identity, not beneath the entire header.
2. **Discovery tags:** One compact wrapping strip of clickable pill tags with decorative dimension glyphs. No literal hash prefixes, visible dimension rows, or explanatory heading. Records and Resources share this tag grammar. Only registered stable IDs produce tag filters. Record kind, Atlas area, and publication titles remain facts/navigation, never synthetic tags.
3. **Section navigation:** Visible source sections determine the jump controls. A jump scrolls and moves focus within the current record; it must not replace the hash-router record URL. Absent sections have no jump control.
4. **Source content and hierarchy:** Preserve complete publisher text, source-native fields, and the role-specific structure. For STIG/SRG Overview, show finding identifiers and severity. The full benchmark title/version belong to the rail, not a duplicate Overview fact. Omit the repeated `Publisher source` line for normalized publisher records; retain explicit attribution for Atlas editorial or publisher-derived material and all missing-source warnings.
5. **Related records:** Render inline-visible evidence-backed relationships, compact counts, counterpart navigation, source evidence, bounded samples, and an Atlas handoff. Structural parents/children remain separate. Atlas-only relationships do not create a fake zero-count panel; Atlas navigation remains available.
6. **Utility rail:** The following supported sections occur in this order. Omit a section only when no real content or valid destination supports it; never fabricate material to fill four cards.
   - **About this record:** Record type, publisher, full benchmark identity where present, version, lifecycle, freshness, and source details. On benchmark-backed STIG/SRG findings, move the benchmark date and compilation-level publication into an initially closed **View source details** disclosure, retaining both exact values and the link to the source register. Do not hide publication identity for other roles or findings without a benchmark. Benchmark and source compilation remain distinct facts. Additional explanations distinguish direct evidence from derived discovery associations; an organization's derived tag never becomes a publisher claim.
   - **In this publication:** Publication navigation and browsing scoped to the actual publication/benchmark. Link labels use publisher-native record nouns. Do not repeat the primary official-source destination under a second label.
   - **Explore related:** Useful source-supported discovery pivots and actual relationship handoffs. Labels are plain language; technical data-model terminology stays internal. Tag combinations retain existing AND/OR semantics. In-page relationship handoffs preserve the current record route.
   - **Do more:** Supported Atlas, comparison, sharing, and reporting actions. The card uses a restrained existing orange accent. A comparison opener is labeled "Compare this record", not an unsupported promise to add to a tray. Sharing copies the canonical record link and confirms success only after the clipboard write succeeds; failure is explained without false confirmation.

At 900px and below, the rail becomes four compact accessible disclosures after primary content and Related records. They are closed initially on compact screens and expanded initially on desktop; each uses one copy of its content. Keyboard and touch operation, visible focus, breakpoint changes, and record changes are verified. Mobile actions follow the tag strip and do not split ordinary words mid-word.

Compact DOM order is: breadcrumb → identity → wrapping tags → primary actions → section navigation → source content → Related records → About this record → In this publication → Explore related → Do more. Do not simulate this using CSS `order` or duplicate desktop/mobile content.

- Atomic records lead with official content, then implementation or assessment material and important governed relationships, followed by the utility rail sections.
- Containers lead with publisher description when one exists, hierarchy, child inventory, counts/facets, external governed relationships, followed by the utility rail sections. Missing optional publisher prose is an honest absence, not a record error.
- Publications/documents lead with publisher/version/status, summary, structure/content, contained objects, related publications, and utility sections.
- Entities/contributors lead with publisher context, participation, important related records, and utility sections.
- Assessments/questions lead with subject, procedure/question, objectives/options, methods, related requirement, and utility sections.
- Implementation artifacts lead with what they implement, architecture/function, guidance, mappings, and utility sections.

Commands and exact configuration render as copyable snippets. Explicit sequences render as ordered lists; independent actions render as bullets; ambiguous source text remains prose. `Related records` is grouped by publication and relationship type. Structural parents and children never appear in it. Presentation policy may promote, summarize, collapse, or route valid relationships to Atlas only; the underlying graph remains exhaustive.

Publisher-native identifiers remain identity-led in record headings and browse results. When Control Atlas generates a stable record key, the publisher-authored title becomes the primary identity and the human record type plus governed publication name supplies nearby context. The generated key remains unchanged in routes and data, and appears only as a labeled, copyable `Control Atlas stable ID` detail rather than primary or accessible copy.

## E. Directory

Guides and other small curated directories use typed entries, a clear sequence or grouping, and direct destinations. They do not invent another search-workspace pattern.

## F. Focused workbench

Compare, Templates, and other task flows present scope, working controls, results, and next action in that order.

Compare results lead with the answer: what is compared, the exact count of published mappings, then the mappings. Search, connection type and crosswalk source share one compact toolbar; taxonomy context is a collapsed inline disclosure with a one-line summary, never a wall of tags ahead of the rows, and there is no collapsed drawer at the foot of the page. A page holds a bounded window of source records (`COMPARE_PAGE_SIZE`), a record shows its first few targets with the rest one click away, and counts, evidence and exports always cover every matching mapping; the export note says so. On a phone each row is scannable (source, target, relationship, evidence cue) without repeated column labels. Choosing the target in the page runs the comparison. A link that only names a source and a target waits for one explained action ("Show published mappings"), because results download the full connection graph; links that carry `compareRun=true`, including the Atlas and Library handoffs, land on the result. A pair with no published mappings says "No published mappings were found between these selections." and offers change source, change target and clear filters. Dense controls progressively disclose on compact screens.

## Responsive verification widths

All page contracts are checked at 320, 375, 390, 768, 1024, and 1440 pixels. Required assertions cover visible primary content, document height, useful-space utilization, DOM size, overflow, focus order, keyboard operation, and preserved back/forward and deep-link state. Atlas mobile is list-first; it never presents a shrunken canvas as the only way to reach evidence.

The record acceptance matrix is part of the required browser gate, not only an optional local command. New record screenshots are captured as review-only visual evidence alongside existing committed pixel baselines; capturing an image is not itself an assertion that it matches the approved mockup. Review those images before accepting a record-layout change.

## Templates (working files)

Templates are working files for a practitioner's job. They are not a catalog of things Control Atlas can generate.

- **Entrance.** Files are grouped by the job to be done (for example "Build hardware and software baselines"), not by RMF stage. Each card says what the file is for and what it does not replace. The local navigation offers only the two views of this section, By task and All working files; Resources stays in the main navigation.
- **Steps.** The step bar reads Choose, Set up, Review & download. Each step is a visible panel on the page, and the bar follows the real state: step 3 lights up only when the file is ready to download.
- **Context and basis.** "Selected context" is what the reader chose (for example SP 800-53 Rev. 5 and the Moderate baseline). "Artifact basis" is what the file is built on, taken from the template's own `provenance.basis`. Public copy is never chosen by the position of an entry in `source_refs`.
- **Interoperability labels.** Only three are allowed: Verified interchange (tested with the destination), Field-aligned (documented fields and values, import not verified), Concept-aligned (same working concepts, not an interchange schema). Nothing is called compatible unless it is Verified interchange. The registry validator enforces this.
- **Program text.** A program's rules and sources (for example FedRAMP) appear in a file only when that program is the selected context.
- **Validation is per artifact.** Every dropdown, date rule, required flag and column group is declared for one table of one artifact in `src/app/template-columns.mjs`. Nothing is looked up by header name alone. Long lists live on a hidden `_Lists` sheet.
- **One notice.** A generated file carries one short notice, not the long product disclaimer plus the review notice.
- **No inferred decisions.** A control baseline selects controls. It is never turned into a statement about a system's impact level. Files do not fill in implementation status, inheritance, Not Applicable, assessment results, findings, cadences or vendor lifecycle dates.
- **Tasks.** Every task in `data/compliance-workflows.json` that names companion templates names real ones, and every template is reachable from at least one task. A task with no template is guidance only. `tests/template-wave3.test.mjs` checks this.
