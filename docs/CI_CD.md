# Control Atlas CI/CD

- **Owner:** Nexus and Pixel
- **Status:** Canonical
- **Last reviewed:** 2026-09-29
- **Supersession:** Update this contract and the corresponding workflows or package scripts in the same change.

Control Atlas separates validation, source-refresh merging and deployment while
sharing one immutable site artifact.

## Workflow responsibilities

- `ci.yml` classifies changes once, runs independent quality gates, builds the site once, and publishes `site-build` for the exact commit SHA.
- `security.yml` runs dependency review, CodeQL, secret scanning, and repository hygiene without rebuilding the site.
- `deploy.yml` accepts only a successful `main` push CI run, verifies `release.json`, deploys that exact artifact, waits for the same SHA at the public edge, then runs production smoke and Lighthouse checks.
- `automerge-refresh.yml` runs after successful refresh PR CI or security
  completion. It loads merge tooling from `main`, requires both workflows to
  succeed for the current PR SHA, and merges only the admitted App-authored
  `automation/source-refresh` PR after path and branch-protection checks.

## Pull request graph

`Change map` determines which gates are required. Lint, types, unit tests, build, contracts, browser shards, accessibility, visual regression, Lighthouse, and workflow lint report independently. `Required CI` fails if any selected gate fails or is cancelled.

The final `checks` job mirrors `Required CI` for compatibility with the repository's existing protected-branch status context. It does not bypass or duplicate validation.

Routine checkout uses depth 1 and fetches only the comparison base SHA. Full history is reserved for the scheduled deep secret scan.

The deep secret scan retains all refs and full history. It disables rename
similarity detection so renamed files are scanned as complete additions, and
allows up to 20 minutes rather than the snapshot scan's three minutes. Timeout
or incomplete verification removes the report and fails the scan. Main-only
history incidents open on failure and close on a subsequent complete success;
candidate-branch runs cannot close production incidents.

## Change-map policy

- Runtime, style, data, dependency, and browser-test changes produce a site artifact and exercise the relevant browser gates.
- Data and dependency changes force a deterministic full build.
- Automation-only changes run automation lint, CI contracts, and actionlint
  without generated data, a site build, product tests, browser matrices, or
  unrelated security jobs.
- Documentation-only changes run hygiene and prose-style contracts without a
  product build.
- Audit evidence changes run the narrow evidence-integrity gate and do not deploy.
- Unknown paths fail closed as runtime code.

## Generated data ownership

`data/generated/` is derived build output. It is ignored by Git and reconstructed from versioned publisher snapshots, curated corrections, registries, schemas, maps, parsers, and generators.

`npm run generate:data` produces the complete derived data surface. CI caches it by canonical-input hash and publishes it as an immutable intermediate artifact. The site build and data-dependent tests consume that same artifact, while browser, accessibility, Lighthouse, and deployment consume the validated `site-build` artifact.

`npm run verify:generated-reproducibility` performs two clean generations and requires identical file counts, byte counts, and SHA-256 tree digests. Generation uses `CONTROL_ATLAS_GENERATED_AT`, `SOURCE_DATE_EPOCH`, or the latest versioned source-observation date, in that order, so output does not depend on a prior generated directory, an unrelated UI commit, or wall-clock time.

If generation changes the tracked `data/fedramp-2026-catalog.json` input, the
existing generated-data job preserves only that exact file, a scoped Git patch,
and a diagnostic receipt in a separate, short-lived Actions artifact. The
receipt binds the task head and checkout SHA, run and attempt, individual
generation-step outcomes, and old/new/patch, raw-source, and generator SHA-256
hashes. Capture runs after an attempted generation even if reproducibility or a
later generator fails; the reproducibility tool restores only `data/generated/`.
The artifact is diagnostic evidence, not an accepted catalog or successful
build. Failed steps remain failures, and the unchanged dirty-input guard still
rejects canonical writes. The artifact grants no publication or merge approval.
Review its exact bytes and provenance before committing the generated catalog
and rerunning all normal gates. Raw publisher snapshots still use the canonical
main-only source-refresh publication path.

Atomic JSON writers preserve identical files and mtimes. `npm run
build:site:incremental` preserves validated staged data and recompresses only
changed JSON while rebuilding application assets.

Scheduled refreshes persist an ignored HTTP cache between runs and issue strict
conditional requests. A 304 reuses previously cached bytes; network failure may
not return stale cached bytes during a required-fresh run. Every request and
redirect must satisfy the static publisher URL policy. GitHub access is limited
to admitted owner/repository pairs and endpoint paths.

The Wednesday 07:17 UTC refresh isolates each source candidate and restores its
last accepted outputs on retrieval or validation failure. Other sources continue;
independent publisher inventories, baseline limits and final candidate checks
govern admission. Supplemental observations can record an explicit unavailable
state. A source cannot grant itself new authority or revise its acceptance policy.

An always-run alert step reads the source results when a report exists. It
deduplicates quarantine issues by source, reopens recurring failures and closes
only explicit accepted recoveries. After validation, a repository-scoped App
opens a ready data PR so independent CI and security workflows run. Automatic
merge requires the expected App identity, the exact tested SHA, allowed JSON
changes and a clean protected-branch merge state. It does not admit schema,
refresh-policy, refresh-contract, application or workflow changes. A failed gate
prevents publication; routine successful refreshes require no human approval.

## Browser policy

- Pull requests use Chromium with two functional shards, axe accessibility checks, and three deliberate visual snapshots.
- Nightly verification runs the complete functional suite in Chromium, Firefox, and WebKit.
- A manually dispatched nightly first runs `npm run precommit` on the hosted
  runner. Its one site build then feeds all six browser shards and accessibility.
  Scheduled sweeps retain their existing build and quality gates.
- Manual `nightly` dispatches may select `sweep_mode=reliability` to diagnose
  the bounded Compare and connection-list regression set in WebKit. This mode
  has a separate build name and concurrency group, runs no acceptance gate,
  never satisfies the scheduled sweep's coverage check, and cannot close alerts.
  Full mode remains the default and always runs for scheduled sweeps.
- Within manual reliability mode, `reliability_focus=atlas` runs the two Atlas
  pointer-selection regressions in Firefox, five times each, with zero retries
  and a ten-minute deadline. It retains failure traces and cannot qualify a
  release or close a scheduled incident. The default focus remains Compare.
- Every nightly browser shard and the accessibility suite write a unique blob
  report name and retain GitHub-readable failure output before reports merge.
- Complete browser shards have a 25-minute Playwright deadline and a 35-minute
  job deadline. A deadline fails the run; it cannot turn incomplete coverage
  into a pass. Per-test progress is logged alongside GitHub annotations and
  the retained blob report so a stalled browser can be diagnosed.
- Browser binaries are installed only for the engine each job needs. They are not cached until timing data justifies that complexity.

## Deployment guarantees

Production deployment never rebuilds routine releases. The deploy workflow downloads `site-build`, verifies that `release.json` matches the successful CI run SHA, and publishes through native GitHub Pages permissions. One bounded readiness job waits for that exact SHA at the public edge before production smoke and Lighthouse begin. It fails if the SHA does not appear within ten minutes, the publication window documented by [GitHub Pages](https://docs.github.com/en/pages/quickstart). Both production checks then test the verified release.


## Assurance checks and evidence boundaries

Assurance contract/schema checks reuse the existing automation and fast gates; search recall uses the generated-data unit gate, and registry-driven guide/template browser tests consume the immutable site in the existing browser gate. The affected-change planner retains these checks when their contract changes; it does not introduce a second dispatcher or waive full final acceptance.

Candidate analytics qualification is selected for builds, not one historical branch. The collector is intercepted and the runner API token is withheld from that harness. This tests consent behavior and payload exclusions without transmitting candidate data to production telemetry. It does not prove production collection or dashboard delivery.

Execution verification must independently read provider run and artifact identity before interpreting report assertions. Merely naming a run URL, completing deployment, or receiving a page URL is insufficient. Candidate and live evidence remain separate, and missing wiring or a missing report is `not_run`, never a passing coverage claim. Existing release/sweep/source incidents remain the sole operational incident machinery; no assurance schedule or parallel incident system is introduced.

## Native assurance result retention

Selected native invariant suites keep TAP output and additionally emit Node 22 test-runner facts through tools/assurance-node-reporter.mjs. The unit, fast and automation jobs preserve these JSON diagnostics on success or failure in separate immutable artifacts. Missing expected result output fails artifact retention; this does not replace any existing required gate.

Each invocation records both the requested PR head and the actual checkout SHA, run and attempt, job key, command, Node version, native test identities, outcomes and final counts. Runner metadata is a claim requiring independent provider verification. A JSON file, green job name or registered test alone cannot establish nine-promise acceptance. A skipped or failed required assertion, incomplete stream, duplicate identity or mismatched report digest remains unusable evidence.

This rebuilt native-reporting layer is separate from the missing unpublished implementation. Browser shard binding, the reviewed assertion inventory and actual-domain evidence remain required before aggregate assurance can pass. No source-refresh, Security, performance or production acceptance gate is removed or relaxed.
