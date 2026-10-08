# Control Atlas Data and Publisher-Structure Policy

- **Owner:** Forge and Sentinel
- **Status:** Canonical
- **Last reviewed:** 2026-08-28
- **Supersession:** Approved source or schema changes update this document, schemas, migration code, and reconciliation tests together.

## Boundary

Control Atlas ingests only lawfully usable public material. It does not accept user, organization, system, asset, scan, finding, or evidence data. Importers run at build time; the browser consumes deterministic static bundles.

Use discovery in this order: official documented API, stable official JSON, official page data, official download artifact, and explicitly invoked rendered discovery last. Required-fresh work may not silently fall back to stale data.

Every included source records owner, version, canonical URL, access status, lifecycle, use or license notes, retrieval method, provenance, checksum, byte length, and actual record count where available. Unknown upstream facts are `null` with a reason, never estimates.

## Shared ingestion lifecycle

Every catalog artifact and every Resource entry uses the same ordered lifecycle: discover, acquire, attest, parse, normalize, structure, relationships, presentation, reconcile, and publish. A source-specific adapter may combine operations, but it cannot remove a stage. Each stage must end as `complete`, `not_applicable` with a concrete reason, or `failed`.

Format-specific behavior stays inside adapters. Prefer structured official inputs such as APIs, JSON, STIX, OSCAL, XML, Excel, or CSV over extracting the same facts from PDF or prose. PDF, HTML, README, and manually reviewed locator adapters still emit the same normalized contracts and stage evidence. A manually curated external locator may mark byte acquisition and parsing not applicable, but it must still pass source attestation, normalization, presentation, reconciliation, and publication checks.

The catalog ledger covers acquired artifacts and publisher catalogs. The Resource ledger covers every Commons entry, including source-backed overview text, an explicit compatibility disposition, and attributable media or an explicit unavailable reason. `npm run verify:ingestion` must pass both ledgers.

## Containment versus relationships

Each publication has one `CatalogStructureProfile` in `src/shared/catalog-structure.mjs`. Every record has one or more acyclic containment paths rooted in its own publication. Multiple paths are allowed only when the publisher explicitly assigns the same record to multiple structural parents, such as an ATT&CK technique used by more than one tactic. Examples:

- DISA STIG: catalog → benchmark → V-ID.
- MITRE ATT&CK: catalog → tactic → technique → sub-technique.
- NIST SP 800-53: catalog → family → control → enhancement.
- NIST SP 800-53A: catalog → family → assessment procedure.

Containment is publisher-native ownership only. Baselines, applicability, assessment targets, CCIs, crosswalks, mappings, references, implementation aids, evidence expectations, and Control Atlas organization remain typed relationships. They cannot supply `parent`, `ancestors`, structural level, or depth.

Four relationship classes remain distinct:

- `structural`: publisher containment; the only class used for breadcrumbs.
- `applicability`: selections, baselines, and overlays.
- `correlation`: mappings, assessments, implementations, references, and crosswalks.
- `organizing`: Control Atlas editorial navigation above publications.

Official published relationships are visually and semantically distinct from inferred suggestions or editorial guidance.

Resource lifecycle replacements use globally unique canonical Atlas entity IDs. A replacement may resolve to another Resource or to a Publication in the source registry; the UI must preserve that distinction and route to the owning surface. The legacy top-level `supersededBy` field remains a synchronized compatibility alias for the first canonical `lifecycle.replacedBy` ID and must never disagree with it.

An archived or retired upstream project may stay in the directory only when it is represented as legacy: an explicit lifecycle status, an accurate maintenance and official status, and a warning that names what a practitioner must not rely on it for. Silence serves nobody, because a searcher who finds nothing assumes the project is still maintained. Microsoft StigRepo is the current example. The operator-ecosystem specification directed a flat reject; Control Atlas keeps it as `lifecycle.status: archived` with `officialStatus: publisher archived` and a do-not-rely warning, which is the same inclusion gate's legacy allowance. A legacy record must never carry an active lifecycle, a maintained status, or a default collection placement.

## Source presentation

Presentation is a required ingestion stage, not a browser-only cleanup. Every generated record type has a declared presentation profile. Publisher strings remain untouched. `StructuredContentBlock` stores presentation-only offsets for paragraphs, ordered lists, unordered lists, and exact code or configuration. Explicit upstream markup wins. Deterministic detection is permitted only at high confidence; ambiguity stays prose. Copy operations use the exact source slice, not visually reconstructed text. Content without a record page must carry an explicit not-applicable presentation outcome in its ingestion ledger.

Every displayable `catalog_id:record_type` pair has an explicit semantic presentation contract; there is no generic fallback. Contracts classify each substantive captured field as `rendered_primary`, `rendered_secondary`, `source_metadata`, `relationship_evidence`, or `intentionally_hidden`. An intentionally hidden field requires a concrete reason. Required publisher fields, contract shape, and catalog/type coverage are build-time validation boundaries.

Record pages apply `PROMOTE`, `SUMMARIZE`, `COLLAPSE`, or `ATLAS_ONLY` treatments to valid correlation edges. This policy governs practitioner relevance only. It never changes the stored edge, relationship direction/classification, provenance, or evidence. Structural containment remains a separate hierarchy and child-inventory input.

## Semantic and currentness review

`data/source-review-manifest.json` is the governed human-review register for every publication profile. Its JSON Schema is validated with the repository's existing AJV 2020 runtime. The generator requires an exact match with the catalog coverage inventory, at least three source-linked samples per profile, official currentness sources, and explicit dispositions for semantic content, locator-only content, and upstream currency. A reviewed sample proves only the named comparison; it does not promote structural or count reconciliation into whole-corpus semantic proof.

The disposition vocabulary is intentionally bounded:

- Semantic: `reviewed_no_known_mismatch`, `remediation_required`, or `blocked`.
- Locator-only: `none`, `justified`, `remediation_required`, or `blocked`.
- Currentness: `current_as_checked`, `refresh_required`, `superseded`, or `blocked`.

Known remediation remains in the generated audit and must not be converted to a passing state merely to satisfy a gate. Publisher landing pages establish publication identity; direct structured artifacts establish parser input. When those are different, both are retained and labeled.

`last_checked` is the source registry's check date. It is not interchangeable with `retrieved_at` or the governed publication review's `reviewed_at`. Product trust surfaces keep the three evidence classes under separate labels, make a missing source check date explicit on source detail, and show the bounded currentness disposition from the publication review without backfilling that date.

The platform gate considered OSCAL assessment-results for this register, but rejected it because that model represents system assessment findings rather than publication-source review. JSON Schema 2020-12 plus AJV is the existing MIT-licensed, maintained, repository-native validation path and avoids a semantically false OSCAL document.

## Reconciliation gates

Builds fail on invalid or abbreviated checksums, byte or record-count disagreement, missing discovery artifacts, duplicate releases or canonical IDs, missing containment parents, undeclared duplicate parents, cycles, undeclared levels, foreign-catalog ancestors, invalid structured-content offsets, or relationship edges appearing in ancestry. `verify:discovery`, `verify:manifests`, AJV internal-schema validation, and the independent NIST OSCAL check remain separate scopes.


## Zero Trust mapping scope and source preservation

Zero Trust is not one interchangeable framework. DoD activities and overlays, NIST architectural tenets and example builds, collaborator product functions, and Microsoft's maturity questionnaire retain their own publishers, record types, versions and hierarchy. DoD enterprise and operational-technology activities remain distinct. NIST CSF 1.1 mappings must not be relabelled as CSF 2.0. A product in an official example is not an endorsement or a compliance determination.

For the NIST SP 1800-35 workbooks, parse the leading relationship clause(s), including `Supports`, `Is supported by` / `Supported by`, and `Equivalent`. Preserve the publisher's `example of`, `integral to`, and `precedes` properties and all original cells/locators. Compound assertions remain compound. Shorthand without an explicit resolved predicate stays in the retained source data as unresolved; do not default it to `supports` or fabricate an edge. Regeneration changes derived semantics, not publisher text or retrieval dates.

The generated `compare-data/` files are disposable projections of eligible graph edges, not a second source of mapping truth. Their manifest records endpoint scope. Compare validates scope before payload loading and preserves native direction when presenting a reversed view. Tests reconcile every pair's edges and source evidence to the generated graph.


## Literal content and complete inventory comparisons

Compare's Content & revisions mode projects the existing public-record set,
excluding structural and retired records. It retains each record's exact title,
published sections and facts from its governed record-presentation contract,
with source identity, edition, lifecycle, and locators. It does not compare
editorial notes or infer uncaptured source text. Chunk counts, unique record IDs,
catalog membership and source resolution must reconcile before results appear.

Automatic alignment uses record type and publisher identifier, never a claim
of semantic continuity between editions or equivalence between publications.
Repeated identifiers require explicit record selection. Missing primary text is
unavailable, not withdrawn. Only-in-A/B groups describe the selected inventories,
not compliance or a publisher's formal change classification. Historical editions
without imported content are unsupported.

The published-mapping inventory uses every eligible mapping in the selected
pair, before display filters, and lists records without a mapping to a public
record in the other inventory. Mappings retain their publisher relationship and
sources; they are not content equality. CSV includes every filtered result,
complete inventory totals, compared fields, source URLs and locators. Pagination
bounds rendering only. Content projections reuse the bounded compare-data
transport and are disposable views of governed records, not a new source registry.
