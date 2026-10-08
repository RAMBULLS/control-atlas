# Control Atlas Architecture

- **Owner:** Forge
- **Status:** Canonical
- **Last reviewed:** 2026-08-12
- **Supersession:** Approved architecture changes replace the affected section here and update executable contracts in the same change.

## Product Identity

- Public product name: **Control Atlas**
- Campaign line: **Ctrl+Alt+Comply**
- Tagline: **The public map for federal cyber compliance.**
- Supporting line: Open-source reference workbench for mapping controls, tracing frameworks, and generating starter RMF/ATO templates - no login, no evidence upload, no organizational data required.

## Adopted Architecture

Control Atlas adopts a `src/`-based React + Vite static application and staged static deployment as its public-data-only baseline. The repository does not need a backend, database, or authentication layer to continue product delivery.

```text
Public Sources
  -> Discover
  -> Acquire
  -> Attest
  -> Parse
  -> Normalize
  -> Structure
  -> Relationships
  -> Presentation
  -> Reconcile
  -> Publish
  -> Static Web App
  -> Client-Side Search / Template Generation / Export
```

All catalogs and Resources entries use this same ordered ingestion contract. Format-specific behavior is confined to source adapters inside a stage; an adapter cannot bypass a stage. Each stage records `complete`, `not_applicable` with a concrete reason, or `failed`. Presentation therefore runs as part of ingestion for every displayable source instead of being a page-specific cleanup pass.

Record presentation is a validated semantic contract layer between runtime data and React composition. Each observed catalog/type key resolves explicitly to one of six page roles and declares field dispositions plus relationship-display policy. The UI uses one universal shell with role composers; it does not infer importance from graph degree or create a component per publisher type.

## Runtime Boundary

- GitHub Pages serves static HTML, CSS, JavaScript, and generated public-data bundles.
- Search, browsing, relationship comparison, and exports run in the browser.
- No backend, database, authentication, login, telemetry, or user, organization, or system data exists.
- No user uploads, evidence ingestion, runtime scan parsing, operational-system connections, or server-side template generation are allowed.
- Generated templates must remain local to the browser and must not be transmitted or stored.

## Translation-First Product Standard

Control Atlas is not a data explorer first. It is a public reference workbench that translates complex cybersecurity guidance into clear, traceable user action.

Future work must preserve this order:

1. User intent
2. Plain-language meaning
3. Visible relationships
4. Source trust
5. Recommended next action
6. Raw technical detail only on demand

## Adopted Contracts

The source registry remains `data/source-registry.json` at schema version `4.0`.

Generated runtime graph artifacts remain:

- `data/generated/sources.json`
- `data/generated/nodes.json`
- `data/generated/edges.json`
- `data/generated/evidence.json`
- `data/generated/graph-health.json`

The focused Atlas adds normalized read models generated from those canonical artifacts:

- `data/generated/atlas-neighborhood-manifest.json`
- `data/generated/atlas-neighborhood/*.json` (2048 deterministic self-contained incident-edge shards)

These are delivery optimizations, not a second relationship truth. Each stored edge remains canonical and incident to the selected record.

Every displayable relationship separates:

- `relationship_type`: what the relationship means
- `provenance_class`: why the relationship may be trusted
- `confidence`: strength of support
- evidence references: public-source support for the claim

Blocked relationships remain graph-health findings and never become displayable edges.

## Technology Baseline

- `src/` is the source-of-truth application tree and `tools/build-static-site.mjs` stages the deployable site into `dist/site`.
- React + Vite render the translation-first UI while existing runtime/data contracts remain reusable.
- The Atlas route uses React Flow and ELK only for the bounded area/publication overview, then switches to semantic DOM for publisher-native levels.
- Focused Atlas routes load the compact node index plus one incident-edge shard; they do not fetch monolithic `nodes`, `edges`, or `evidence` artifacts.
- React Flow + ELK remain lazy dependencies for bounded overview and local-connection diagrams; they never render an unbounded catalog as a generic graph.
- Tables, search, filters, and detail pages remain primary browsing models; visual relationships are supporting context, not a giant-canvas navigation system.
- GitHub Pages remains the deployment target.
- MiniSearch is the target search pattern.
- Zod + JSON Schema is the target validation pattern.
- AJV validates the application boundary and normalized output for OSCAL inputs; the official NIST OSCAL CLI remains an independent upstream-conformance gate.
- JSON/JSONL runtime bundles and YAML curated registry files are the target data format pattern.

## Component Boundaries

- `src/ui/`: translation-first page shell, reusable components, and query-state adapters.
- `src/app/`, `src/content/`, and `src/styles/`: reusable runtime/data helpers, shared content, and tokens.
- `scripts/`: fetch and orchestrate public-data refresh/build flows.
- `tools/importers/`, `tools/normalizers/`, `tools/validators/`, and `tools/relationship-builders/`: product pipeline modules for public data ingestion, normalization, validation, and relationship assembly.
- `data/source-registry.json`: canonical source registry file retained under the new public-facing Provenance Registry naming.
- `data/generated/`: ignored local/CI build output containing validated runtime bundles and build-governance artifacts. It is reconstructed from versioned canonical inputs and never committed.
- `src/app/runtime.mjs`: pure browser query and export APIs over static bundles.
- `dist/site/`: generated deploy surface used by Pages and public sync.
- `tests/`: graph, source, runtime, browser-contract, and product-boundary gates.

## Compatibility

The hosted repository, package metadata, workflow labels, and Pages path use Control Atlas. Existing runtime APIs and canonical graph artifacts remain stable; Atlas neighborhood artifacts are reproducible projections of them.
