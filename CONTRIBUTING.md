# Contributing to Control Atlas

## Product Identity

- Public product name: **Control Atlas**
- Protected brand item: **the rotating Ctrl+Alt flourish**, using real Control Atlas actions from `src/shared/brand-rotation.ts`
- Product definition: **Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.**
- Decision boundary: **Use Control Atlas for research, not compliance or authorization decisions.**

Control Atlas is a static, public-data-only reference workbench. Contributions must preserve that boundary and the active Control Atlas implementation baseline unless an ADR says otherwise.

No backend or user, organization, or system data may be introduced.

## Source-First Product Standard

Build for translation, not complexity.

Future work must preserve this order:

1. Exact publication identity and official source text
2. Publisher-declared hierarchy
3. Labeled, source-traceable relationships
4. Concrete retrieval, comparison, navigation, or document action
5. Product-authored notes and limitations
6. Raw technical detail on demand

No roadmap item may be accepted unless it identifies the user confusion it reduces and the action it enables.

## Permanent Placement Rule

Every addition has one home:

- New content becomes a Library facet value.
- A new content action becomes a record action or Library bulk mode.
- A new explanation becomes a Guide.
- A new provenance or trust surface belongs in Sources or the footer.

Only a genuinely new product earns a primary navigation slot. A new source,
publication, record type, resource collection, comparison, export, generator,
annotation, or explanation does not.

## Before Starting

1. Read `docs/README.md` and the canonical contracts relevant to the change.
2. Work on a branch, not `main`.
3. Prefer existing runtime, data, shell, and test patterns.
4. Use public, lawfully usable sources and document provenance.
5. Treat historical Issue 8-12 plans as implementation evidence, not the active backlog.
6. Keep default UI language plain and action-oriented; raw schema, registry, and graph terms belong only in advanced details, tests, or exports.

## Prohibited Contributions

Do not add backend services, authentication, user uploads, evidence or scan ingestion, operational-system integrations, user, organization, or system data storage, compliance scoring, real asset/package tracking, applicability or baseline selection, inheritance conclusions, authorization or ATO decisions, or stored generated templates.

## Verification

Before committing, run checks that cover the changed inputs and their risks:

- Use focused contract or unit checks for affected logic, plus applicable lint and type checks.
- For UI or runtime changes, verify the affected user journeys, accessibility and layout families.
- Reuse recorded evidence while its relevant inputs remain unchanged. Record the covered commit or tree, checks newly run, reused evidence and remaining release checks.
- Obtain independent review for consequential changes.

Run `npm run precommit` for broad or cross-cutting changes, uncertain impact, or final integration where focused evidence does not cover the risk. It remains available as the complete local suite; it is not required again solely because a narrowly verified change is ready to commit.

Local evidence does not replace release gates. Every required GitHub security, accessibility, source-integrity, behavior, visual and performance check must pass for the exact remote head before merge. Preserve their budgets and admission rules. Verify the remote checkout and the exact released commit.

Runtime/public-shell changes also require a fresh live GitHub Pages audit. Keep changes minimal, document data-contract changes, and verify the staged build plus deployed Pages output stay aligned.
