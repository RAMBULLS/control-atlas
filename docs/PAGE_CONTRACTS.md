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

Compare, Templates, and other task flows present scope, working controls, results, and next action in that order. Dense controls progressively disclose on compact screens.

## Responsive verification widths

All page contracts are checked at 320, 375, 390, 768, 1024, and 1440 pixels. Required assertions cover visible primary content, document height, useful-space utilization, DOM size, overflow, focus order, keyboard operation, and preserved back/forward and deep-link state. Atlas mobile is list-first; it never presents a shrunken canvas as the only way to reach evidence.

The record acceptance matrix is part of the required browser gate, not only an optional local command. New record screenshots are captured as review-only visual evidence alongside existing committed pixel baselines; capturing an image is not itself an assertion that it matches the approved mockup. Review those images before accepting a record-layout change.
