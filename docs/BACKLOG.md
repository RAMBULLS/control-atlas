# Control Atlas Backlog

- **Owner:** Product owner
- **Status:** Canonical open work only
- **Last reviewed:** 2026-09-06
- **Supersession:** Add, close, or reprioritize items here; do not create another backlog or preserve completed rows.

| ID | Open outcome | Owner | Trigger |
| --- | --- | --- | --- |
| EXT-A11Y-001 | Hands-on NVDA plus VoiceOver or TalkBack verification | Human QA | Before any claim of assistive-technology conformance |
| EXT-DEVICE-001 | Physical iOS and Android phone verification | Human QA | Before any claim of physical-device coverage |
| EXT-SEC-001 | Independent penetration test | Product owner | Before a formal external security-assurance claim |
| TAX-RULES-001 | Record-level `tool`, `artifact`, and `topic` assignments remain blocked because the record source model exposes no governed fields supporting those claims. Do not infer them from prose. | Product owner | Before presenting those dimensions as record filters |
| TAX-INDEX-001 | Unified discovery still excludes Intel because no stable governed local Intel content model exists. Add Intel only after that model exists. | Product owner | Before claiming Intel is part of unified cross-content discovery |
| NAV-CONCEPT-001 | Coverage Tracks — the 800-53 control space as a fixed horizontal substrate with each framework a shaded track above it, so agreement between frameworks reads as lit columns. Drafted for the Atlas landscape; the pattern also answers Compare's "where do these two overlap". | Product owner | When Compare or a coverage surface is next revised |
| NAV-CONCEPT-002 | Align — sequence-alignment view with 800-53 as a centre spine and two frameworks in outer columns, so agreement and, more importantly, absence both read as structure. Drafted for framework comparison; directly applicable to Compare. | Product owner | When Compare is next revised |
| NAV-CONCEPT-003 | Rosetta Card — one record centre-stage surrounded by what every other publisher calls it, each name a door to that record. Drafted for the record altitude; applicable to record detail and to Library search results. | Product owner | When record detail or search results are next revised |
| ATLAS-VISUAL-001 | The Atlas map's visual model is open for a design cycle. It works and it is honest, but it still reads as a stock treemap to the product owner, and the question of whether quantity-as-rectangle-area is the right idiom for this surface at all has not been answered. Functionality was prioritised over this. | Product owner | Before the next Atlas design cycle |

Routine dependency, source-freshness, CI, Pages smoke, and comparative performance checks are operations, not backlog items.

## Navigation concepts held for other surfaces

NAV-CONCEPT-001 through -003 were drafted as alternatives to the Atlas landing and
are recorded here because they answer questions other surfaces also have. Feedback
on the first drafts: the treatments read as instrument panels, and a product called
Control Atlas should look like a map. Any revival should carry that correction —
cartographic rather than technical, and legible before it is dense.

## ATLAS-VISUAL-001 — what any replacement has to keep

The map today is a fixed-width column mosaic: columns never narrower than a
family name, each cell as tall as its share, so area stays proportional without
a squarified treemap's aspect-ratio lottery. It replaced that treemap because
the treemap chose the shape of every cell and the shapes it chose had no room —
half the cells inside SP 800-53 came out narrower than the word "Maintenance".

The open question is not truncation, which is fixed. It is whether encoding
quantity as rectangle area is the right idiom for this surface. Feedback on the
mosaic: it still reads as a treemap.

Constraints learned the expensive way. Any alternative has to keep all of them:

- No truncated names. This is what killed two previous drafts.
- Area may only encode a quantity whose units match across the cells compared.
  Records are not commensurable between frameworks; a STIG rule is not an
  800-53 control.
- Layout may not assert the curated dependency spine, or any other claim the
  published data cannot support. Relationship is shown by selection.
- Five or six groups before drilling, not twenty-eight at once.
- Every cell is a real focusable control with a readable accessible name and a
  44px target; no canvas.
- The whole picture fits the viewport at every width that draws it, and below
  480px it degrades to the stacked list.
- Rejected already: magnitude bars, plain text lists, cards joined by
  connectors, and stacking more than one idiom on a screen.
