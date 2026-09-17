# Control Atlas Page Contracts

- **Owner:** Product owner and Muse
- **Status:** Canonical
- **Last reviewed:** 2026-08-14
- **Supersession:** New owner-approved page direction replaces the affected section here and its tests in the same change.

Every route uses one of six shared jobs. A route renders one `<main>` and must not mount another page beneath it.

## Shared shell

The desktop header provides Start Here, Atlas, Library, Compare, Resources, Templates, and Search. Guides, Sources, and About remain available in the overflow menu. Compact navigation preserves every destination, with Compare before editorial links. Body content uses the shared spacing and width tokens. Interactive targets are at least 44 pixels, focus is visible, color is never the only signal, and layouts must reflow without page-level horizontal overflow.

## A. Landing

Home presents the product purpose, one primary search action, and concise entrances to Atlas, Library, and Resources. It does not duplicate legal, source, or provenance boilerplate already owned by About or the footer.

## B. Workspace

Library and Resources share search, visible desktop facets, a compact responsive filter drawer, result count, sorting, and incrementally rendered results. Empty search presents useful browse choices rather than the full corpus.

## C. Adaptive Explorer

Atlas is one map over one route and one navigation state, all semantic DOM. No
canvas renderer and no flow-graph bundle loads before a visitor asks for a
relationship view.

The map column is roughly seventy per cent of the width and the detail panel
thirty, stacking below 1100px. Everything is drawn the same way at every depth:
a cell per thing, its area the quantity it holds, a trail above it for the way
back. Opening something never leaves the page — the map goes a level deeper and
the panel becomes about what was opened.

- Groups: the landing. Three lenses group the same frameworks by what each
  document is (`atlasLanding=""`), who issues it (`publishers`), or what the
  reader is trying to get done (`job`), five to eight groups each. Anything a
  lens cannot file is named beneath the map rather than dropped.
- Frameworks: the members of one group.
- Families: what one framework contains.
- Records: where every child holds one record, area says nothing, so the panel
  lists them and each one opens.

Three rules the drawing must keep:

- Area may only encode a quantity whose units are the same across the cells
  being compared. What frameworks hold is not comparable between them — a STIG
  rule is not an 800-53 control — so groups are sized by how many frameworks
  they hold, and contents take over one level down.
- Layout may not assert a claim the data cannot support. The curated dependency
  spine is hand-written because crosswalks carry no direction, so it appears as
  a sentence in the panel and never as the shape of the map. Relationship is
  shown by selection: choosing a cell lights the ones it genuinely crosswalks
  to and dims the rest.
- Every count is stated in the word its publisher uses — controls in SP 800-53,
  techniques in ATT&CK, rules in a STIG, baselines in FedRAMP — taken from
  `catalogProfiles`' `recordLabel`. "Records" and "publications" are this
  repository's vocabulary, not the reader's, and never reach a cell or a panel
  heading. `tests/graph/atlasUnits` fails if a catalog arrives without a noun.

The map is columns of a fixed width, never narrower than a family name, each
cell as tall as its share. Width is constant, so height carries the quantity
and area still reads true, without the aspect-ratio lottery a squarified
treemap runs — that lottery dealt half the cells inside SP 800-53 narrower than
the word "Maintenance" while giving the largest 500px of empty paint. Nothing
is ever cut mid-word.

Two consequences the drawing owns:

- A cell is never shorter than its own name or than a 44px touch target. Below
  that floor its height is a minimum, not a quantity, so those cells are drawn
  flat with a dotted edge — the same way a dashed edge already means "nothing
  published beneath this". Read the number on a floored cell, not its size.
- Room the encoding buys gets spent. A cell with height to spare names what is
  inside it, so a reader can see that "Control catalogs" means 800-53, 800-53A
  and 800-171 without opening it.

The map's height is what the viewport has left below it, so the whole picture
is on screen rather than running past the fold.

Publisher-native columns remain addressable by URL beneath the map
(`atlasLimb`, `atlasFramework`, `atlasFamily` without a lens group) and render
publication-native levels and immediate children.

## D. Record detail

Every supported catalog/type resolves to one of six roles: atomic record, container, publication/document, entity/contributor, assessment/question, or implementation artifact. All roles share identity, official source action, source facts, publisher hierarchy, and a bounded relationship handoff; role composers control only the source-native middle of the page.

Six concepts remain strictly separated across all record details:
1. **Record identity:** What exact item this is (publisher-native or governed stable ID) with official title and canonical breadcrumb.
2. **Record discovery tags:** One compact wrapping row of clickable discovery tags directly beneath the title block, hashtag-style (`#DISA`, `#STIG`, `#Microsoft`, etc.), canonically ordered by internal taxonomy dimensions without visible dimension rows, table scaffolding, or dimension headings. Clicking a tag filters the Library using stable taxonomy identifiers.
3. **Primary section navigation:** Compact jump navigation (`Overview`, `Discussion`, `Check`, `Fix`, `References`, `Related records` as applicable) allowing quick movement through long source material.
4. **Published/source-native content:** Primary content authored by the publisher (or container structure/inventory depending on role).
5. **Governed relationships:** Evidence-backed cross-publication mappings and references under **"Related records"**, with compact counts (never stretched across the section), counterpart cards, evidence disclosures, bounded samples, and Atlas handoff. Empty relationship sections disappear.
6. **Utility side rail (desktop):** Exactly four ordered sections:
   - **About this record:** Factual metadata (record type, publisher, publication/benchmark title preserving full publisher title, version/release, status, freshness, and source details).
   - **In this publication:** Publication navigation (view publication, browse all rules/records, open in publisher).
   - **Explore related:** Plain practitioner discovery pivots (more from publisher, more from program, other product content, asset class content, related CCIs/controls). Strictly free of internal data-model jargon (`facets`, `taxonomy`, `governed context`, `provenance`, `classification`).
   - **Do more:** Useful next actions (view in Atlas, add to Compare, share this record with copy confirmation, report an issue).

Compact flow and DOM order:
On compact viewports and single-column collapse, document order follows a natural linear reading sequence without CSS `order` tricks. The four side-rail sections appear strictly after primary source content and Related records:
Breadcrumb -> Title -> Wrapping tags -> Primary actions -> Section nav -> Source content -> Related records -> About this record -> In this publication -> Explore related -> Do more.

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

Compare, Templates, and other task flows present scope, working controls, results, and next action in that order. Dense controls progressively disclose on compact screens.

## Responsive verification widths

All page contracts are checked at 320, 375, 390, 768, 1024, and 1440 pixels. Required assertions cover visible primary content, document height, useful-space utilization, DOM size, overflow, focus order, keyboard operation, and preserved back/forward and deep-link state. Atlas mobile is list-first; it never presents a shrunken canvas as the only way to reach evidence.
