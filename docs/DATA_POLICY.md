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

`data/source-review-manifest.json` is the governed source-review register for every publication profile. Automated source comparison and AI-assisted engineering review are accepted; no human-review prerequisite applies. Its JSON Schema is validated with the repository's existing AJV 2020 runtime. The generator requires an exact match with the catalog coverage inventory, at least three source-linked samples per profile, official currentness sources, and explicit dispositions for semantic content, locator-only content, and upstream currency. Acceptance requires actual source, identity, content, relationship and edition checks appropriate to the claim. A reviewed sample proves only the named comparison; it does not promote structural or count reconciliation into whole-corpus semantic proof.

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

## Portable reference export and completeness

Full prior DISA native editions and distinct captured text variants remain in checksum-verified supporting JSON files under `data/curated/disa/`. The catalog's `record_history` descriptor records the path, actual SHA-256, byte length, item count and retained capture count (`edition_count`). Readers restore complete captured records; this storage split neither creates new item IDs nor drops prior text. A changed capture within the same named edition remains explicit; a retrieval-date change alone creates no duplicate. Manifest validation rejects missing, altered, dangling or mismatched supporting history.

DISA discovery runs weekly. Unchanged directory content within the accepted quarter reuses the last verified archive; a directory change, new UTC quarter or explicit `--require-fresh` forces archive acquisition and native reconciliation. This follows DISA's quarterly compilation policy while detecting listed out-of-cycle publications. An inventory check records its own scope and date and never advances the date on retained publisher bytes. In-place upstream changes that do not alter the directory can remain undetected until the next quarter or explicit fresh acquisition. Sparse accepted history does not establish a learned publication cadence.

`npm run export:reference` exports complete canonical nodes, edges, sources and supporting reference content to the two reference CSVs and a package README. It does not refresh sources, filter to browser-visible records, infer mappings or convert paths into direct edges. Multiple citations remain on one connection row. Nested content and references without canonical connection IDs remain explicit JSON or documented package inventory rather than fabricated graph objects. `npm run verify:reference-export` independently parses every CSV field and checks the ZIP entries against the canonical data.

`npm run verify:reference-relationships` reconciles normalized catalog assertions, mapping-file rows and retained Zero Trust/IoT workbook assertions against native graph endpoints, predicates and source citations. Known unresolved publisher assertions require a source-linked disposition; missing endpoints and silently dropped assertions fail. NIST's IoT draft workbook cites `PT.PT-1`, which is absent from CSF 1.1. Keep the original cell and unresolved disposition rather than guessing a replacement. Draft and historical source status remain separate from whether an assertion has been publicly published.

Integrity, snapshot regression, publisher inventory completeness and relationship reconciliation are separate results. Reviewed snapshot equality and retained native count totals without independent identities cannot establish publisher completeness. Independent native identity inventories establish coverage only for their declared content scope and edition. They do not prove ingestion of every publisher document or the latest release. Export fidelity can pass with these limits explicitly recorded in the package; it must never be described as proof that every upstream source is complete.

Source recovery preserves stable source, item and connection identities. During explicit refresh/recovery, discover literal links from official inventories before accepting a moved locator. Byte-identical recovered sources can reuse accepted captured content. Changed bytes or formats remain candidates until the existing parser, edition, identity and assertion reconciliation gates pass. Ambiguous links, unsupported formats and failed acquisition remain visible; last-good content is retained with its original evidence and freshness limits. Browser discovery/retrieval belongs to explicit refresh/recovery, never ordinary builds or unit tests.

`npm run acquire:reference-inventories -- <catalog-or-source-id> --require-fresh` revalidates the selected source instead of reusing its evidence snapshot. Downloads use content-addressed local paths. Changed bytes return a visible candidate disposition and retain the last-good receipt; failed retrieval retains last-good evidence without claiming a fresh success. `npm run sync:reference-source-recovery` validates captured official-link discovery and actual recovered bytes before updating locators. These commands extend the existing explicit acquisition/reconciliation lifecycle; they add no scheduler or publication authority.

If explicit acquisition fails for a source with an established official recovery inventory, it makes one bounded rediscovery attempt against that inventory. Each inventory is requested at most once per command. Only a unique literal publisher link can become a candidate; an unchanged failed link is not requested again. The raw discovery snapshot, checksum and recovery decision are retained. Byte-identical recovery reuses the accepted identity; changed bytes stop as candidates. Missing or renamed files, ambiguous links, inaccessible inventories and unsupported formats remain visible for source-specific resolution. This mechanism does not infer replacement identities or rewrite mappings.

Access and lifecycle are separate. HTTP403,404,410 or absence from a library cannot establish deprecation, retirement or replacement. Those transitions require an explicit attributable publisher statement; a replacement must resolve to a registered source identity. Prior editions and assertions remain accessible, and no replacement implies a new control mapping. Public archival copies retain their actual host, checksum and comparison method and never masquerade as current publisher bytes. The DoD CIO relocation and the unavailable original overlays binary are regression cases for these boundaries.
