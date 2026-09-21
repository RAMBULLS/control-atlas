# Control Atlas — Product Requirements Document

**Owner:** Product owner
**Last reviewed:** 2026-08-11
**Supersession:** Owner-approved product changes update this document directly; newer approved direction replaces conflicting text.

**Version:** 3.0
**Status:** Active
**Platform:** GitHub Pages (static)
**Codebase:** Repurposed from GovFrame Navigator

---

## The One Thing This Product Does

Control Atlas translates federal cybersecurity compliance into something a small team can actually use.

It takes frameworks, controls, STIGs, mappings, and RMF artifacts — and connects them into a plain-language model that answers three questions:

> **What does this mean? How does it connect? What do I do next?**

It does this using public data only, with no login, no evidence upload, and no organizational data stored.

The moat is consolidation, connection, and freshness. Federal GRC guidance is scattered across dozens of separate sites and takes months — sometimes years — to connect by hand. Control Atlas hosts the connective tissue in one place, kept reasonably current, so a newcomer never has to rediscover it themselves.

---

## Design Principle

**Build for translation, not complexity.**

Every feature should reduce the distance between complex security guidance and practical action. The product connects frameworks, controls, mappings, STIGs, MITRE techniques, and RMF artifacts into a shared plain-language model that small teams can understand, trust, and act on.

In practice this means:

- Plain operational language first. Formal source language second.
- No raw identifier in user-facing copy. Every `source_id`, `canonical_id`, or schema enum value rendered in a dropdown, filter, label, or selector must resolve through a `display_name` field.
- Show how things connect, not just that they exist.
- Every crosswalk traces back to an authoritative source.
- Mappings are decision support, not automation.
- Every surface moves the user from "What does this mean?" toward "What do I do next?"
- Designed for small teams without dedicated compliance staff.
- Rigorous without requiring the user to speak in framework jargon.

This principle governs every feature, every content decision, and every UX pattern in this document. When in doubt, ask: *does this reduce the distance between the guidance and the action, or does it add friction?*

## Translation-First Product Standard

Control Atlas is not a data explorer first. It is a public reference workbench that translates complex cybersecurity guidance into clear, traceable user action.

Future work must preserve this order:

1. User intent
2. Plain-language meaning
3. Visible relationships
4. Source trust
5. Recommended next action
6. Raw technical detail only on demand

---

## What This Is Not

Control Atlas is not a GRC tool, evidence processor, compliance scorer, eMASS replacement, or authorization workflow system.

It does not ingest evidence, connect to operational systems, store organizational data, determine compliance status, or recommend authorization decisions.

**Disclaimer (footer, About page, and all template exports):**

> Control Atlas is an open-source reference tool. It is not an official government system and does not make compliance, authorization, or risk decisions. All mappings and templates are reference aids based on public sources. Official decisions remain with the applicable Authorizing Official, agency, or program office.

---

## Users

**Primary user — the newcomer.** Someone new to federal cyber compliance — "get us compliant" or "get an ATO" just landed on their desk — who doesn't yet know how NIST, FedRAMP, CMMC, STIGs, and CCIs relate to each other, or to the work in front of them. Every surface must work for this person first: plain language, no assumed jargon, a clear next step.

**Secondary — practitioners.** Served by the same plain-language model — depth is available on demand, but never required, and never at the newcomer's expense:

- **ISSO / ISSM** — Needs to understand control relationships, build planning worksheets, explain inheritance and evidence expectations, and prepare for assessments.
- **Assessor / Auditor / SCA** — Needs to trace STIG/SRG/CCI/control relationships and understand baseline differences.
- **Engineer / System Integrator** — Needs to connect control language to real technical implementation.
- **Program Manager / Compliance Manager** — Needs process patterns, planning templates, and plain explanations of scope, reciprocity, and evidence expectations.
- **Contractor / CSP / Small Vendor** — Needs a starting point before engaging consultants.

Both groups share the same core problem: **compliance language doesn't connect to action.**

---

## Product Principles

1. **Translate, don't just display.** Every object, crosswalk, and pattern page should answer "so what?" — not just show that something exists.
2. **Plain language first.** Show the plain-language meaning before the formal source text. Never require users to already understand the jargon to use the tool.
3. **Connections over catalogs.** The value is in showing how controls, STIGs, CCIs, baselines, and patterns relate — not just listing them.
4. **Provenance is mandatory.** Every relationship traces to a public source or is labeled inferred. Trust level is always visible.
5. **Relationship meaning and trust are separate.** `relationship_type` = what the connection means. `provenance_class` = why to trust it.
6. **Client-side only.** Templates generate in the browser. Nothing leaves.
7. **No dark patterns.** No login wall, no telemetry on generated content, no hidden collection.
8. **Small-team default.** Assume no dedicated compliance staff. Write for the person wearing three hats at once.

---

## Information Architecture

Six sections. Each one answers a practitioner question.

| Section | The question it answers |
|---|---|
| **Start Here** | Where do I begin? |
| **Library** | What does this control / STIG / term mean and what connects to it? |
| **Compare** | What do these frameworks share, and where do they differ? |
| **Patterns** | How does this part of the process actually work? |
| **Templates** | What do I need to produce, and what should it look like? |
| **Sources** | Why should I trust this mapping? |

Navigation order reflects practitioner workflow, not alphabetical or architectural logic.

### Start Here
A short client-side question flow — system type, data sensitivity, operational environment — that outputs a plain-language starting point: which framework applies, which baseline fits, what templates to generate first, and which pattern pages to read. No data stored. No profile created. Output is a recommendation, not a determination.

### Library
Searchable public reference objects: NIST controls, FedRAMP baselines, DISA STIGs/SRGs, CCIs, MITRE ATT&CK techniques, D3FEND countermeasures, and the compliance glossary. Every object page leads with official source content or an honest absence state, then shows related objects and source-traceable relationships.

### Compare
How frameworks map to each other: NIST ↔ FedRAMP, STIG → CCI → NIST, ATT&CK → D3FEND → control, baseline-to-baseline comparisons. Every mapping shows relationship type, provenance class, and confidence. Inferred mappings are clearly labeled. Export to CSV/Markdown/JSON.

### Patterns
Plain-language explanations of the authorization and audit concepts practitioners get wrong most often: inheritance, reciprocity, ATO vs. ATC, shared responsibility, boundary scoping, evidence expectations, POA&M residual risk. Each page follows a consistent structure: what it is, where it breaks down, what good looks like, related controls, related templates.

### Templates
Blank planning templates generated locally in the browser. The selector leads with artifact type — practitioners arrive knowing what they need to produce, not which framework to invoke. Every generated template includes source metadata, a disclaimer, and plain-language prompts that explain what goes in each section and why.

### Sources
The trust register for every source in Control Atlas: source class, owner, version, last checked date, parser status, and license notes. Answers "why should I trust this mapping?" — not just "where did it come from?"

---

## Feature Requirements

### Start Here

A guided entry point for practitioners who don't know where to begin. Plain-language questions, no free-text input, no stored data.

**Question flow:**
- What kind of system are you working on? (Cloud SaaS / Platform service / Enclave / On-premises / Hybrid / Enterprise service)
- What's the data sensitivity? (Unclassified / CUI / Classified / Not sure)
- What's your operational environment? (Federal civilian / DoD / Contractor / CSP)

**Output:**
- Plain-language explanation of which frameworks apply and why
- Suggested baseline(s) with a one-sentence rationale for each
- Links to relevant Library objects, Pattern pages, and Templates
- Explicit label: "This is a reference recommendation. It is not a compliance determination."

**Acceptance criteria:**
- Completes in under 60 seconds
- No input stored or transmitted
- Output is actionable — links directly to next steps, not just a list of framework names

---

### Library Browser

Every object page leads with official source content. When no official narrative is published, the page says so plainly rather than substituting product-generated guidance.

**Object types:** NIST controls, control families, baselines/profiles, FedRAMP overlays, STIG rules, SRG requirements, CCIs, ATT&CK techniques, D3FEND countermeasures

**Each detail page shows:**
- Plain-language summary (what this means in practice)
- Formal title and source text
- Related objects (controls, STIGs, CCIs, templates)
- Provenance and source version
- "What to do next" — links to applicable templates and pattern pages
- Copyable stable deep link

**Search** supports IDs (`AC-2`, `V-220708`) and plain language (`account management`, `audit logging`). MiniSearch with field weighting. Accessible from every page.

**Acceptance criteria:**
- Searching `AC-2` shows a plain-language summary before the NIST control text
- Searching `account management` returns controls, STIGs, and glossary terms
- Every object has a stable deep link and copyable ID
- "What to do next" section present on every detail page

---

### Crosswalk Workbench

Shows how public sources relate. Every relationship has a type, a provenance class, a confidence level, and a plain-language rationale. Inferred relationships are always labeled.

**Relationship types:** `maps_to`, `supports`, `implements`, `overlaps`, `references`, `derived_from`, `supersedes`, `related_to`

**Provenance classes:** `official`, `federal_published`, `dod_published`, `nist_published`, `disa_published`, `fedramp_published`, `mitre_published`, `community_open_source`, `inferred`

**Confidence:** `high`, `medium`, `low`

**Views:**
- STIG → CCI → NIST relationship table
- Baseline comparator (NIST Low/Moderate/High vs. FedRAMP Low/Moderate/High)
- Full relationship table with filter by type, provenance, and confidence

**Export:** CSV, Markdown, JSON — with provenance metadata included in export

**Acceptance criteria:**
- User can trace a STIG rule to its NIST control in three clicks
- Official and inferred mappings are visually distinct with text labels (not color alone)
- Baseline delta view shows which controls appear in one baseline but not the other, with source versions stated
- Any exported file includes provenance metadata

---

### Pattern Library

Plain-language explanations of the authorization and audit concepts practitioners get wrong most often. No jargon gates. Every page connects to related controls, templates, and glossary terms.

**Page structure (consistent across all patterns):**
1. What this is — one paragraph, plain language
2. Where it breaks down — the most common failure modes
3. What good looks like — practical, observable signals
4. Do / Don't — concrete guidance
5. Related controls and STIGs
6. Related templates
7. Sources and limitations

**Topics:**
- RMF lifecycle
- ATO vs. ATC
- ATO vs. FedRAMP authorization
- Reciprocity — what it is and why it usually fails
- Control inheritance
- Common control provider model
- Shared responsibility (CSP and enterprise service patterns)
- Boundary and scope
- Body of Evidence reuse
- POA&M and residual risk
- Continuous monitoring cadence
- Evidence expectation patterns

**Acceptance criteria:**
- Every page uses plain language in the first paragraph before introducing formal terminology
- Every page links to at least one template and one glossary term
- No page makes an authorization recommendation or asks for organizational data

---

### Compliance Artifact and Template Nexus

Control Atlas connects the work a practitioner needs to do with the authoritative source, official artifact, usable companion, compatible format, supporting tool, validation evidence, and next action. Official current resources appear first; official legacy resources and Control Atlas companions are labeled separately. The generator remains local to the browser and leads with **what you need to produce**, not which framework to invoke.

**Templates:**
1. Security Plan Starter
2. Control Implementation Statement Worksheet
3. Evidence Expectation Matrix
4. Inheritance Worksheet
5. Reciprocity Checklist
6. POA&M Starter
7. Assessment Planning Worksheet
8. Continuous Monitoring Calendar
9. Hardware Baseline
10. Software Baseline

**Output formats:** Word and Excel as supported by each artifact. Every starter document is visible in an in-browser preview before download.

**Selector flow:** Artifact type → Framework/baseline → Environment archetype → Optional includes

**Environment archetypes:** Generic, Cloud SaaS, Platform service, Enclave, On-premises, Hybrid, Enterprise service

**Every generated template includes:**
- Plain-language prompts explaining what belongs in each section
- Source and version metadata
- Direct references to the corresponding official resources
- A visible interoperability classification, evidence basis, and limitation
- Required disclaimer
- No pre-filled organizational data

**Artifact and workflow catalog:** Each family explains what the artifact is, when it is used, who typically owns it, official current and legacy resources, related frameworks, compatible tools and formats, inputs, validation checks, related artifacts, and the next action. Compatibility is labeled as officially specified, Control Atlas round-trip verified, schema-aligned, community reference, historical, or unverified.

**Privacy:** All generation is client-side. Nothing is transmitted or persisted.

**Acceptance criteria:**
- User reaches an authoritative resource or generated companion in three interactions or fewer
- Every template field has a plain-language prompt, not just a label
- Generated file includes disclaimer, source metadata, and an interoperability limitation
- Official resources appear before Control Atlas companions for the same artifact family
- No user input is stored or transmitted

---

### Template Specifications

**Security Plan Starter** — Sections: title page placeholder, document metadata, disclaimer, system overview prompt, authorization boundary prompt, environment prompt, data types prompt, user roles prompt, interconnections prompt, control baseline table with implementation prompts, inheritance prompts, evidence expectation table, revision history, source metadata. No real system or org data.

**Evidence Expectation Matrix** — Columns: Control ID, Title, Family, Related STIG/SRG, Related CCI, Evidence type, Example artifact names, Suggested owner role, Review cadence, Notes, Source, Confidence. Evidence types: Policy, Procedure, Configuration screenshot, System-generated report, Access review, Scan output, Interview, Architecture diagram, Change record, Training record, Incident record, Log sample, Inventory export, Exception memo.

**POA&M Starter** — Columns: Weakness ID, Discovery source, Related control, Related STIG/SRG, Weakness description, Risk statement, Severity, Planned remediation, Milestone, Completion date, Responsible role, Status, Deviation reference, Risk acceptance reference, Evidence needed for closure, Notes. Blank — no generated findings.

**Inheritance Worksheet** — Columns: Control ID, Title, Inheritance type, Common control provider, Provider responsibility, Customer responsibility, Shared notes, Evidence dependency, Artifact freshness concern, Local delta needed, Source, Notes.

**Reciprocity Checklist** — Sections: Granting package reference, Receiving org placeholder, Body of Evidence checklist, Boundary comparison prompts, Control delta prompts, POA&M review prompts, Risk acceptance prompts, Artifact freshness prompts, AO decision prompts, Local implementation prompts, Caveats.

**STIG Evidence Checklist** — Columns: STIG title, STIG ID, Rule ID, Vuln ID, Severity, Title, Check text summary, Fix text summary, CCI refs, Related controls, Evidence expectation, Validation method, N/A justification prompt, Deviation prompt, Notes.

---

### Glossary

Every term leads with a plain-language definition before citing the formal source. Terms link to related Library objects, Pattern pages, and Templates. Searchable from the main search bar.

**Minimum terms:** ATO, ATC, FedRAMP authorization, RMF, STIG, SRG, CCI, SAR, SAP, SSP, POA&M, BoE, reciprocity, inheritance, common control, shared responsibility, ISSO, ISSM, SCA, AO, AODR, boundary, overlay, baseline, profile, continuous monitoring

**Each entry:** Plain-language definition → Formal/source definition → Source citation or "practitioner consensus" label → Related Library objects → Related Pattern pages

**Acceptance criteria:**
- Searching "reciprocity" returns a plain-language definition, the pattern page link, and related templates
- Formally sourced terms (NIST, DISA) are visually distinct from practitioner-consensus terms
- Glossary is reachable from object detail pages inline

---

### Relationship Graph

Shows public relationships between controls, STIGs, CCIs, baselines, techniques, and defenses through three coordinated views: Path, Map, and List.

Path is the default and organizes the selected record into six working stages: Understand, Decide, Implement, Evidence, Assess, and Monitor. Map is an optional bounded neighborhood, not an open-ended canvas. List exposes the same filtered connections and source references in a dense accessible format.

Published connections are shown by default. Candidate relationships require an explicit user toggle. If the selected record has no published connections, the product says so and does not draw a map. No presentation-only projection may masquerade as a published relationship.

Desktop Path progresses horizontally; compact/mobile Path progresses vertically. Map uses upstream, lateral/equivalent, and downstream regions. The selected record plus six group summaries is the overview limit. Only one group may expand at once, with at most ten desktop or six compact records; overflow routes to List. Details occupy a separate column or appear below the view and never cover navigable content.

**Acceptance criteria:**
- User can open graph from any object detail page
- User can filter out inferred relationships
- Path, Map, and List derive from the same filtered edge set
- List is always available and accessible
- Map does not render when there are zero visible connections
- Opening a focused Atlas record does not require the monolithic graph bundle
- Edge colors have text/icon labels — color is never the sole differentiator

---

### Provenance Registry

The trust register for every source in Control Atlas. Answers "why should I trust this?" not just "where did it come from?"

**Displayed per source:** Name, owner, source class, status, version, URL, last checked date, parser status, license/use notes, deprecation warning if applicable

**Source classes:** `federal_authoritative`, `dod_authoritative`, `nist_authoritative`, `disa_authoritative`, `fedramp_authoritative`, `mitre_published`, `cisa_published`, `federal_utilized`, `community_open_source`, `inferred`, `deprecated`

**Acceptance criteria:**
- Every mapping in the product traces to a visible source record
- Deprecated sources show a clear warning with text label
- User can filter by source class
- Inferred mappings are labeled and include a rationale field

---

## Data Sources

| Priority | Source | Use |
|---|---|---|
| 1 | NIST OSCAL catalogs/baselines | Control catalog, baselines |
| 2 | DISA STIG/SRG public content | STIG/SRG browser, evidence prompts |
| 3 | CCI references | STIG/SRG → NIST bridge |
| 4 | FedRAMP baselines/templates | Baseline comparison, template structure |
| 5 | MITRE ATT&CK | Threat technique relationships |
| 6 | MITRE D3FEND | Defensive countermeasure relationships |
| 7 | ComplianceAsCode | SCAP/XCCDF pattern reference |
| 8 | PowerSTIG | Organizational setting/deviation concepts |
| 9 | STIG Manager | STIG assessment data model concepts |
| 10 | Vulnerator | Practitioner vocabulary reference |

**Rules:** Public sources at build time only. All source files versioned or hashed. Every normalized object retains source traceability. Every mapping shows whether it is official, published, community, or inferred. Inferred relationships require rationale. Build fails on missing required source fields.

---

## Data Model

### Node Schema

```yaml
control_atlas_node:
  id: string
  type: control | control_family | baseline | profile | stig_rule | srg_requirement | cci | attack_technique | defend_countermeasure | template | source
  canonical_id: string
  title: string
  description: string              # official source text or excerpt
  source_id: string
  source_class: string
  version: string
  status: active | deprecated | superseded | draft | unknown
  external_refs:
    - label: string
      url: string
  tags: [string]
  raw_ref: string
  normalized_at: string
```

> Record surfaces render official source content by default. A missing official narrative description is shown as an honest absence state; it is never replaced with generated guidance.

### Edge Schema

```yaml
control_atlas_edge:
  id: string
  from: string
  to: string
  relationship_type: maps_to | supports | implements | overlaps | references | derived_from | supersedes | related_to
  provenance_class: official | federal_published | dod_published | nist_published | disa_published | fedramp_published | mitre_published | community_open_source | inferred
  confidence: high | medium | low
  rationale: string                # published relationship rationale when supplied
  navigation_note: string          # product-authored browsing context when needed
  source_refs:
    - source_id: string
      ref_type: string
      locator: string
  created_by: parser | curator | inference_rule
  review_status: unreviewed | reviewed | disputed
  normalized_at: string
```

> A relationship explanation is labelled `Published rationale` when supplied by the publication, `Navigation note` when authored for product navigation, or as absent. A navigation note is not source text or an applicability result.

### Source Schema

```yaml
control_atlas_source:
  source_id: string
  name: string
  display_name: string
  display_group: string
  owner: string
  source_class: string
  source_url: string
  license_or_use: string
  version: string
  status: active | deprecated | superseded | draft
  formats: [xml | json | yaml | csv | xlsx | pdf | html]
  parser:
    name: string
    version: string
    status: implemented | planned | manual | not_applicable
  last_checked: string
  last_imported: string
  hash: string
  notes: string
```

### Template Schema

```yaml
control_atlas_template:
  template_id: string
  name: string
  display_name: string
  artifact_type: security_plan_starter | implementation_statement_worksheet | evidence_expectation_matrix | inheritance_worksheet | reciprocity_checklist | poam_starter | assessment_planning_worksheet | conmon_calendar | hardware_baseline | software_baseline
  supported_formats: [xlsx | docx]
  input_options: [framework | baseline | control_family | selected_controls | environment_archetype]
  source_refs: [source_id]
  official_resource_ids: [official_artifact_id]
  compatibility:
    classification: string
    claim: string
    limitations: string
  provenance:
    basis: string
    verified_interchange: boolean
  disclaimer_required: true
```

---

## UX Requirements

### General

- Fast static site. No login. No modals.
- Search accessible from every page. Supports IDs and plain language.
- Control IDs and STIG IDs are always copyable.
- Every object, mapping, and relationship shows provenance.
- Every graph has a table fallback.
- Plain-language content precedes formal source text on every surface.
- Templates reachable in three interactions or fewer.
- No language implying official authorization or certification.

### Homepage

**Depth 0 / Signal landing (top to bottom):**

1. **Product identity** — "Control Atlas" in `--ca-font-display`, with the `Ctrl+Alt+[word]` signature as a subordinate flourish.
2. **Product definition** — "Control Atlas brings the federal cybersecurity landscape together in one place—requirements, frameworks, controls, mappings, official guidance, tools, and practitioner resources—so you can see what applies, understand how it connects, and get to the next step faster."
3. **Trust boundary** — public reference data, no account, no uploaded system data, and no claim of official authorization.
4. **One primary action** — Start guided setup.
5. **Search workbench** — direct ID and plain-language lookup remains immediately available.
6. **Product entrances** — Atlas, Library, Start the work, and Tools and communities are visible without progressive-disclosure guesswork.

All non-home routes expose a shared context rail with Depth 1 / Mission or Depth 2 / Systems, the active task, current scope, and a return path for detail surfaces.

### Accessibility

- WCAG 2.1 AA minimum
- Full keyboard navigation
- Color is never the sole provenance or status indicator — text/icon labels always accompany color
- Dark theme contrast verified
- Screen-reader usable table views
- Graph table fallback required
- `prefers-reduced-motion` respected throughout

---

## Branding

### Name and Tagline

**Product name:** Control Atlas

**Hero tagline:** `Ctrl+Alt+[rotating word]` — signature hero element only. Not in the nav or header.

**Static subtagline:** Federal cybersecurity reference and practitioner workbench.

### Visual Direction

Control Atlas adapts Orbital Archive No. 01 v1.7.0 and its Lunar Signal Modernism system. Editorial Signal composition is reserved for Depth 0; operational Mission and Systems surfaces use restrained technical geometry, thin borders, coordinate grids, visible scope, and compact metadata. Relay Cyan marks interaction, Observatory Gold marks priority, Solar Orange is rare editorial signal, and fixed status colors retain their meanings. Purple, violet, pink, and magenta are outside the product palette.

The product should read like a public technical reference instrument, not a marketing site, aerospace simulation, or fake government portal.

### Design Tokens

```css
:root {
  --lsm-orbit: #11181E;
  --lsm-graphite: #253139;
  --lsm-slate: #2D3A42;
  --lsm-alloy: #37464F;
  --lsm-grid-line: #56656E;
  --lsm-dust: #B3BBC2;
  --lsm-bone: #E7E1D5;
  --lsm-relay: #54BCD9;
  --lsm-gold: #CBAE67;
  --lsm-orange: #E66A2C;
  --lsm-signal: #7EB79E;
  --lsm-rust: #C97A60;
  --lsm-fault: #EA7468;

  --ca-bg: var(--lsm-graphite);
  --ca-surface: var(--lsm-slate);
  --ca-surface-raised: var(--lsm-alloy);
  --ca-text: var(--lsm-bone);
  --ca-text-muted: var(--lsm-dust);
  --ca-primary: var(--lsm-relay);
  --ca-priority: var(--lsm-gold);

  --ca-font-display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --ca-font-body: Inter, system-ui, sans-serif;
  --ca-font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}
```

The complete canonical values and semantic provenance/status mappings live in `styles/tokens.css`. All provenance and status colors require accompanying text or icon labels.

---

## Technical Architecture

### Stack (Decisions, Not Options)

| Layer | Decision | Rationale |
|---|---|---|
| Base | Vite + React + TypeScript static app | Keeps full app control while preserving static public-data deployment |
| Atlas | Semantic DOM throughout: one area map at every depth — fixed-width columns of cells whose height is what they hold, absolutely positioned buttons rather than SVG shapes, sized to the viewport with a detail panel beside it | One way of seeing from the landing to a record, every cell focusable and readable by a screen reader, area only ever encoding a quantity whose units are the same across the cells being compared, and every count named in its publisher's own word rather than in "records" |
| Other relationship diagrams | React Flow + ELK.js, lazy | Retained for existing bounded detail and Compare surfaces pending separate review |
| Search | MiniSearch | Field-weighted, static-bundle-friendly, handles mixed ID/keyword queries |
| Validation | Zod (runtime) + JSON Schema export | TypeScript-native with schema portability |
| Data format | JSON/JSONL runtime, YAML for curated registry | Performance vs. human-readability split |
| Templates | Branded Word and Excel exports with an in-browser document preview | Usable working artifacts without a blind download |
| Analytics | None (MVP) | Privacy principle |
| Hosting | GitHub Pages | Already in use |
| CI/CD | GitHub Actions | Already in use |
| Security | CodeQL + Dependabot + npm audit + secret scanning | Supply chain baseline |
| SBOM | CycloneDX | GitHub-native |

Deviation from any decision above requires an ADR.

### Architecture Flow

```
Public Sources → Build-Time Importers → Raw Source Cache
→ Normalization Pipeline → Schema Validation (Zod)
→ Relationship Builder → Static Data Bundles (chunked JSON/JSONL)
→ Static Web App → Client-Side Search / Template Generation / Export
```

### Repository Structure

```
control-atlas/
  README.md
  LICENSE
  SECURITY.md
  CONTRIBUTING.md
  docs/
    adr/
    prd/
    architecture/
    data-sources/
  src/
    app/
    components/
    routes/
    templates/
    search/
    graph/
    styles/
  data/
    sources/registry/ raw/ normalized/ generated/
    schemas/
    fixtures/
  tools/
    importers/ normalizers/ validators/ relationship-builders/ exporters/
  tests/
    unit/ integration/ e2e/ fixtures/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    PULL_REQUEST_TEMPLATE.md
```

---

## SecDevOps

### CI/CD Pipeline

```
1.  Checkout
2.  Install dependencies
3.  npm audit
4.  License check
5.  Secret scan
6.  Lint + Prettier
7.  Type check
8.  Unit tests (Vitest)
9.  Schema validation (Zod)
10. Source registry validation
11. Relationship validation
12. Build static site
13. Accessibility smoke tests
14. Playwright E2E tests
15. Generate SBOM (CycloneDX)
16. Publish preview artifact
17. Deploy to GitHub Pages (protected branch only)
```

### Security Requirements

- No secrets in frontend
- No user data collection
- No generated artifact storage
- CSP defined
- No high/critical dependency vulnerabilities at release
- Static deployment reproducible from source
- Branch protection + required PR reviews

---

## Privacy

Control Atlas avoids privacy risk by not collecting the data that would create the risk. No login, no accounts, no org or system profiles, no evidence upload, no template content telemetry, no remote storage of generated content. UI preferences may be stored locally; generated template content must not be persisted by default. No analytics for MVP.

---

## Product Backlog

### Epic 0: GovFrame → Control Atlas Migration

Complete before any new feature work.

**Story 0.1 — Rename and rebrand**
- Repo renamed to `control-atlas`
- All GovFrame identity removed
- README reflects Control Atlas

**Story 0.2 — Apply design tokens**
- All tokens from the Branding section implemented
- Space Grotesk, Public Sans, JetBrains Mono loaded
- No GovFrame visual identity remains

**Story 0.3 — Extend node/edge schema**
- Node schema preserves official descriptions without a synthetic translation field
- Edge schema includes provenance, source references, and provenance-labelled explanation fields
- Build fails on invalid or missing required fields
- Existing GovFrame data migrated to new schema

**Story 0.4 — Update graph renderer**
- Edge colors use provenance tokens with text/icon labels
- Filter by relationship type, provenance, confidence
- Table fallback exists and passes accessibility check

**Story 0.5 — CI/CD pipeline**
- All pipeline stages from SecDevOps section implemented and green
- CodeQL, Dependabot, secret scanning enabled

---

### Epic 1: Data Backbone

**Story 1.1 — NIST OSCAL importer**
- Controls and baselines normalized as nodes with official descriptions where published
- Control-to-baseline edges created with provenance

**Story 1.2 — STIG/SRG importer**
- Rules normalized with severity, IDs, check/fix text, CCI refs, and official descriptions where published

**Story 1.3 — CCI mapping importer**
- CCI-to-control and STIG-to-CCI relationships with provenance class and confidence

**Story 1.4 — Relationship builder**
- Official mappings marked correctly
- Published mappings retain source references and published rationale where supplied; product navigation notes are labelled separately
- Build fails on malformed relationships

**Story 1.5 — Provenance registry seed**
- All 10 MVP sources entered with full schema compliance
- Zod schema validation passes

---

### Epic 2: Library + Search

**Story 2.1 — MiniSearch index**
- Built at compile time, field-weighted for identifiers, titles, and official descriptions
- Accessible from every page

**Story 2.2 — Object detail pages**
- Official description or source excerpt displayed with an honest absence state when unavailable
- Related objects, provenance, and source links on every page
- Stable deep links with copyable IDs

**Story 2.3 — Library filters**
- Filter by object type, source class, family/severity
- No page reload on filter change

---

### Epic 3: Compare

**Story 3.1 — Relationship table**
- Displays source references and labels published rationale separately from Navigation note
- Filter by type, provenance, confidence
- Export with provenance metadata included

**Story 3.2 — STIG → CCI → NIST crosswalk**
- Three-click trace from STIG rule to NIST control
- Inferred relationships labeled
- Export works

**Story 3.3 — Baseline comparator**
- Delta view for any two baselines
- Source versions stated in output
- Export to CSV and Markdown

---

### Epic 4: Template Factory

**Story 4.1 — Template engine**
- Client-side only; no transmission
- Selector leads with artifact type
- Word and Excel export both work, with a visible document preview before download
- Every output includes disclaimer and source metadata

**Story 4.2 — Security Plan Starter**
**Story 4.3 — Evidence Expectation Matrix**
**Story 4.4 — POA&M Starter**
**Story 4.5 — Inheritance Worksheet**
**Story 4.6 — Reciprocity Checklist**
**Story 4.7 — Assessment Planning Worksheet**
**Story 4.8 — Continuous Monitoring Calendar**
**Story 4.9 — Hardware Baseline**
**Story 4.10 — Software Baseline**
**Story 4.11 — Official artifact, workflow, and tool catalogs**
- Official resources precede Control Atlas companions
- Every compatibility claim carries an evidence level and limitation
- Workflows connect tasks to inputs, outputs, validation, and next actions

Each template story acceptance criteria: correct columns/sections per spec, plain-language prompts on every field, no user/org data required, download works.

---

### Epic 5: Patterns + Glossary + Start Here

**Story 5.1 — Pattern page template**
- Consistent structure: what it is, where it breaks down, what good looks like, do/don't, related controls/templates/sources
- Plain language in first paragraph before formal terms
- No authorization recommendations

**Story 5.2 — Inheritance pattern pages** (common control provider, CSP, enterprise service)
**Story 5.3 — Reciprocity pattern pages** (what it is, why it fails, generic checklist)
**Story 5.4 — RMF/ATO/ATC pattern pages** (distinguish ATO, ATC, FedRAMP, local risk acceptance)
**Story 5.5 — Evidence expectation patterns**
**Story 5.6 — Boundary and scope patterns**

**Story 5.7 — Glossary**
- Plain-language definition before formal source text for every term
- All minimum terms present
- Searchable from main bar
- Linked from object detail pages inline

**Story 5.8 — Start Here flow**
- Three questions, under 60 seconds
- Output is actionable: plain-language rationale + direct links to Library, Patterns, Templates
- No data stored or transmitted
- Output labeled as reference recommendation

---

### Epic 6: QA + Accessibility + Release

**Story 6.1 — E2E test suite (Playwright)**
- Coverage: homepage, Start Here, search, provenance registry, object detail, crosswalk, baseline comparison, template generation (all types), graph and table fallback

**Story 6.2 — Accessibility pass**
- Keyboard navigation complete
- Color never sole indicator — verified with text/icon labels
- Dark theme contrast passes
- Reduced motion tested

**Story 6.3 — Content review**
- All pattern pages reviewed for accuracy
- All template prompts reviewed for plain language
- All disclaimers verified
- No prohibited claims (compliance determination, authorization recommendation)

**Story 6.4 — Release candidate**
- All epics complete, CI green, no high/critical vulnerabilities, versioned tag created

---

## Roadmap

| Phase | Focus | Sprints |
|---|---|---|
| 0 | Migration, schema extension, CI | 1 |
| 1 | Data backbone, importers, normalization | 2–3 |
| 2 | Library, search, object pages | 2 |
| 3 | Compare, baseline comparator, export | 2 |
| 4 | Template Factory (all MVP templates) | 2–3 |
| 5 | Patterns, Glossary, Start Here | 2 |
| 6 | QA, accessibility, hardening, launch | 1 |

---

## MVP Acceptance Criteria

The MVP is done when:

1. Site deploys as a static site. No login, no backend.
2. Every object page leads with official source content or an honest absence state.
3. Every visible relationship explanation declares published rationale, Navigation note, or absence.
4. Start Here helps browse public sources without inferring a classification, baseline, or authorization path.
5. Library is searchable by ID, title, and official description from any page.
6. STIG → CCI → NIST trace is reachable in three clicks.
7. Baseline comparator works for NIST and FedRAMP baselines.
8. Template Factory generates all twelve artifact companions with plain-language field prompts and links each family to authoritative resources.
9. Generated templates include disclaimer and source metadata. Nothing leaves the browser.
10. Glossary covers all minimum terms with plain-language definitions.
11. Provenance registry is live. Every mapping traces to a source or is labeled inferred.
12. Color is never the sole provenance or status indicator — verified.
13. FedRAMP provenance color is teal, not blue.
14. Graph has accessible table fallback.
15. CI/CD green. No high/critical vulnerabilities. Accessibility checks pass.
16. No raw identifiers in UI text. Every schema enum, framework ID, or catalog slug resolves through a `display_name` mapping.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Scope creep into GRC/evidence tooling | High | Product boundary stated in README; non-goals explicit |
| Synthetic record guidance becomes stale or wrong | High | Default to official source content; require an approved reviewable provenance schema before adding guidance |
| Inferred mappings mistaken as official | High | Mandatory provenance labels with text — never color alone |
| Public source changes break importers | Medium | Schema validation, source snapshots, parser tests |
| Users assume templates guarantee compliance | High | Prominent disclaimers; plain-language limitation notes in every template |
| Large datasets slow the static site | Medium | Chunked JSON, MiniSearch static index, lazy loading |
| Graph unusable at scale | Medium | Object-local graph views; table fallback required before graph ships |
| Solo maintainer pace vs. scope | Medium | Shared Responsibility Matrix deferred; Start Here and Glossary are low-cost relative to value |

---

## README Summary


# Control Atlas

The public map for federal cyber compliance.

Control Atlas translates federal security frameworks, controls, STIGs, and
RMF artifacts into plain language — connecting what things mean, how they
relate, and what to do next. Built for small teams without dedicated
compliance staff.

Uses public NIST, DISA, FedRAMP, MITRE, and CISA data only.
No login. No evidence upload. No organizational data stored.

## What it does

- Translates controls, STIGs, and compliance terms into plain language
- Shows how frameworks, baselines, and requirements connect
- Traces every mapping back to its public source
- Generates blank RMF/ATO planning templates in your browser
- Guides you to the right starting point for your system type

## What it does not do

- Ingest evidence or process authorization packages
- Store organizational, system, or user data
- Connect to eMASS, STIG Manager, or any operational system
- Determine compliance status or recommend authorization decisions
- Replace an assessor, ISSO, or AO

## Not an official government system. All mappings and templates are
## reference aids based on public sources.
```
