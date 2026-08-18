import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compareHelpers = readFileSync("src/ui/lib/compareHelpers.tsx", "utf8");
const tokens = readFileSync("styles/tokens.css", "utf8");
const baseCss = readFileSync("styles/base.css", "utf8");
const componentsCss = readFileSync("styles/components.css", "utf8");
const surfacesCss = readFileSync("styles/surfaces.css", "utf8");
const buttonComponent = readFileSync(
  "src/ui/components/lsm/Button.tsx",
  "utf8",
);
const provenanceBadge = readFileSync(
  "src/ui/components/ProvenanceBadge.tsx",
  "utf8",
);
const accessibleTerm = readFileSync(
  "src/ui/components/AccessibleTerm.tsx",
  "utf8",
);

test("acronyms expose their meaning on hover, focus, and tap without changing the visible identity", () => {
  assert.match(accessibleTerm, /<abbr/);
  assert.match(accessibleTerm, /title=\{props\.explanation\}/);
  assert.match(accessibleTerm, /data-tooltip=\{props\.explanation\}/);
  assert.match(accessibleTerm, /tabIndex=\{0\}/);
  assert.doesNotMatch(accessibleTerm, /aria-label=\{props\.explanation\}/);
});

test("provenance badges always render text labels alongside tone classes", () => {
  const provenanceTerm = readFileSync(
    "src/ui/components/ProvenanceTerm.tsx",
    "utf8",
  );
  assert.match(compareHelpers, /function PublicationStatusBadge/);
  assert.match(compareHelpers, /Candidate mapping/);
  assert.match(compareHelpers, /Published mapping/);
  assert.match(compareHelpers, /function ProvenanceBadge/);
  assert.match(compareHelpers, /ProvenanceTerm/);
  assert.match(provenanceBadge, /entry\.label/);
  assert.match(provenanceTerm, /displayNameFor\("provenance_class"/);
});

test("provenance tokens stay distinct from Orbital action and status meanings", () => {
  // 2026-08-03: this used to pin --ca-prov-fedramp to --lsm-dust. That value
  // was one way to satisfy the rule this test is named for, but it also meant
  // DISA, FedRAMP and community all rendered colourless, which the owner
  // rejected. Enforce the rule itself: a publisher hue may never reuse an
  // action (teal) or status (rust/fault) token.
  for (const publisher of ["disa", "fedramp", "community", "mitre"]) {
    const value = tokens.match(
      new RegExp(
        `--ca-prov-${publisher}:\\s*var\\((--lsm-[a-z-]+)\\)`,
        "i",
      ),
    );
    assert.ok(value, `--ca-prov-${publisher} must be defined`);
    assert.ok(
      !["--lsm-teal", "--lsm-rust", "--lsm-fault"].includes(value[1]),
      `--ca-prov-${publisher} reuses the action/status token ${value[1]}`,
    );
  }
  assert.match(tokens, /--ca-accent:\s*var\(--lsm-teal\)/i);
  assert.match(tokens, /--ca-primary:\s*var\(--ca-accent\)/i);
  assert.match(tokens, /--ca-warning:\s*var\(--lsm-rust\)/i);
  assert.match(tokens, /--ca-danger:\s*var\(--lsm-fault\)/i);
  assert.doesNotMatch(tokens, /(?:7c3aed|d8b4fe|6366f1)/i);
});

test("relationship graph surfaces include accessible table fallback and provenance legend", () => {
  const explorer = readFileSync(
    "src/ui/components/RelationshipExplorer.tsx",
    "utf8",
  );
  const table = readFileSync(
    "src/ui/components/RelationshipGraphTable.tsx",
    "utf8",
  );
  assert.match(explorer, /Explore/);
  assert.match(explorer, /role="tablist"/);
  assert.match(explorer, /Map legend/);
  assert.match(table, /aria-label="Relationship table"/);
  assert.match(table, /ProvenanceBadge/);
  assert.match(table, /Showing \{visibleRows\.length/);
  assert.match(table, /Show 50 more/);
});

test("compare view state and provenance term support accessible descriptions", () => {
  const viewState = readFileSync("src/ui/lib/viewState.ts", "utf8");
  const provenanceTerm = readFileSync(
    "src/ui/components/ProvenanceTerm.tsx",
    "utf8",
  );
  assert.match(viewState, /compareView/);
  assert.match(provenanceTerm, /aria-describedby/);
  assert.match(provenanceTerm, /visually-hidden/);
});

test("full PRD provenance color tokens are defined", () => {
  for (const token of [
    "--ca-prov-official",
    "--ca-prov-dod",
    "--ca-prov-nist",
    "--ca-prov-disa",
    "--ca-prov-fedramp",
    "--ca-prov-mitre",
    "--ca-prov-community",
    "--ca-prov-inferred",
    "--ca-prov-deprecated",
  ]) {
    assert.match(tokens, new RegExp(`${token}:`));
  }
});

test("reduced motion preferences disable transitions and animations", () => {
  assert.match(baseCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(baseCss, /animation-duration: 0\.01ms !important/);
  assert.match(baseCss, /transition-duration: 0\.01ms !important/);
});

test("hash router shim redirects legacy view query params", () => {
  const hashRoutes = readFileSync("src/ui/lib/hashRoutes.ts", "utf8");
  assert.match(hashRoutes, /applyLegacyQueryRedirect/);
  assert.match(hashRoutes, /serializeHashLocation/);
});

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  );
}

function relativeLuminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

function contrastRatio(foreground, background) {
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function tokenValue(name, seen = new Set()) {
  assert.ok(!seen.has(name), `Circular token reference at ${name}`);
  seen.add(name);
  const valueMatch = tokens.match(
    new RegExp(`${name}:\\s*([^;]+);`, "i"),
  );
  assert.ok(valueMatch, `Missing ${name}`);
  const value = valueMatch[1].trim();
  const hexMatch = value.match(/^#[0-9a-f]{6}$/i);
  if (hexMatch) return hexMatch[0];
  const aliasMatch = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  assert.ok(aliasMatch, `${name} must resolve to a solid color token`);
  return tokenValue(aliasMatch[1], seen);
}

test("primary actions use one authored AA contrast pair", () => {
  assert.ok(
    contrastRatio(
      tokenValue("--ca-on-primary"),
      tokenValue("--ca-action-primary"),
    ) >= 4.5,
    "Primary action text must meet 4.5:1",
  );
  assert.ok(
    contrastRatio(
      tokenValue("--ca-on-primary"),
      tokenValue("--ca-action-primary-hover"),
    ) >= 4.5,
    "Primary action hover text must meet 4.5:1",
  );
  assert.match(buttonComponent, /primary:\s*"ca-button-primary"/);
  assert.match(
    componentsCss,
    /\.ca-button-primary\s*\{[^}]*background:\s*var\(--ca-action-primary\)[^}]*color:\s*var\(--ca-on-primary\)/s,
  );
});

test("secondary text and provenance badge text meet WCAG AA contrast", () => {
  const surface = tokenValue("--ca-surface");
  assert.ok(
    contrastRatio(tokenValue("--ca-text-subtle"), surface) >= 4.5,
    "Secondary text must meet 4.5:1 on cards",
  );

  for (const token of [
    "--ca-prov-official-text",
    "--ca-prov-dod-text",
    "--ca-prov-nist-text",
    "--ca-prov-disa-text",
    "--ca-prov-fedramp-text",
    "--ca-prov-mitre-text",
    "--ca-prov-community-text",
    "--ca-prov-inferred-text",
    "--ca-prov-deprecated-text",
    "--ca-prov-active-text",
  ]) {
    assert.ok(
      contrastRatio(tokenValue(token), surface) >= 4.5,
      `${token} must meet 4.5:1 on cards`,
    );
    assert.match(componentsCss, new RegExp(`color:\\s*var\\(${token}\\)`));
  }
});

test("search and glossary dialogs expose accessible control names", () => {
  const searchOverlay = readFileSync(
    "src/ui/components/SearchOverlay.tsx",
    "utf8",
  );
  const glossaryDrawer = readFileSync(
    "src/ui/components/GlossaryDrawer.tsx",
    "utf8",
  );
  assert.match(searchOverlay, /aria-label="Search Control Atlas"/);
  assert.match(glossaryDrawer, /aria-label="Close glossary"/);
  assert.match(glossaryDrawer, /<Dialog\.Title>Glossary<\/Dialog\.Title>/);
  assert.match(glossaryDrawer, /htmlFor="glossary-search"/);
  assert.match(glossaryDrawer, /id="glossary-search"/);
});

test("Template B Home exposes one search, governed destinations, and labelled governed-tag navigation", () => {
  const homePage = readFileSync("src/ui/pages/HomePage.tsx", "utf8");
  assert.match(homePage, /data-template="B"/);
  assert.match(homePage, /className="home-search home-search-trigger"/);
  assert.match(homePage, /onClick=\{onOpenSearch\}/);
  assert.match(homePage, /Search Control Atlas/);
  assert.match(homePage, /HOME_DESTINATIONS\.map/);
  assert.match(homePage, /aria-label="Choose a Control Atlas destination"/);
  assert.match(homePage, /aria-labelledby="home-tag-heading"/);
  assert.match(homePage, /HOME_TAG_GROUPS\.map/);
  assert.match(homePage, /home-tag-galaxies/);
  assert.match(homePage, /aria-label=\{`\$\{tag\.label\}, \$\{tag\.count\.toLocaleString\(\)\} records`\}/);
  assert.equal((homePage.match(/onOpenSearch/g) || []).length >= 2, true);
  assert.doesNotMatch(homePage, /home-ecosystem-authorities|home-start-here/);
  assert.doesNotMatch(homePage, /RMF|Risk Management Framework/);
  assert.doesNotMatch(homePage, /Choose a starting point/);
});

test("high-density task surfaces bound results and name download actions", () => {
  const comparePage = readFileSync("src/ui/pages/ComparePage.tsx", "utf8");
  const templatesPage = readFileSync("src/ui/pages/TemplatesPage.tsx", "utf8");
  const startHere = readFileSync("src/ui/pages/StartHerePage.tsx", "utf8");
  assert.match(comparePage, /relationshipPageSize = 25/);
  assert.match(comparePage, /Showing \{/);
  assert.match(comparePage, /View evidence/);
  assert.match(templatesPage, /Download \$\{selectedTemplate\.display_name\}/);
  assert.match(templatesPage, /template-essential-options/);
  assert.match(startHere, /What are you trying to do\?/);
  assert.match(startHere, /Search the Library/);
});

test("Compare choices are native buttons and About cards form named heading regions", () => {
  const comparePage = readFileSync("src/ui/pages/ComparePage.tsx", "utf8");
  const aboutPage = readFileSync("src/ui/pages/AboutPage.tsx", "utf8");
  const primitives = readFileSync("src/ui/lib/pagePrimitives.tsx", "utf8");

  assert.doesNotMatch(comparePage, /aria-label="Comparison modes"[\s\S]*role="tablist"/);
  assert.doesNotMatch(comparePage, /aria-selected=\{false\}/);
  assert.match(aboutPage, /<SummaryCard headingLevel=\{2\} title="What It Is">/);
  assert.match(aboutPage, /<SummaryCard headingLevel=\{2\} title="About the Project">/);
  assert.match(primitives, /aria-labelledby=\{props\.headingLevel \? titleId : undefined\}/);
  assert.match(primitives, /aria-label=\{props\.headingLevel \? undefined : props\.title\}/);
});

test("Build overview exposes Tasks, Starter documents, and Resources as equal lanes", () => {
  const buildPage = readFileSync("src/ui/pages/TemplatesPage.tsx", "utf8");
  const buildState = readFileSync("src/ui/lib/buildRouteState.ts", "utf8");
  assert.match(buildPage, /className="build-lane-grid"/);
  assert.match(buildPage, /BUILD_LANES\.map/);
  assert.match(buildState, /label: "Tasks"/);
  assert.match(buildState, /label: "Starter documents"/);
  assert.match(buildState, /label: "Resources"/);
  assert.doesNotMatch(buildPage, /Choose a task first/);
});

test("compact icon and chip controls retain 44 pixel touch targets", () => {
  const block = surfacesCss.match(/\.icon-button,\s*\.chip\s*\{([^}]*)\}/);
  assert.ok(block, "Missing shared icon and chip control rule");
  assert.match(block[1], /min-height:\s*44px;/);
  assert.match(block[1], /min-width:\s*44px;/);

  const homeTagLink = surfacesCss.match(/\.home-tag-link\s*\{([^}]*)\}/);
  assert.ok(homeTagLink, "Missing Home governed tag link rule");
  assert.match(homeTagLink[1], /min-height:\s*var\(--ca-touch-target\);/);
});

test("sticky surfaces and in-page jumps share one header-safe offset", () => {
  const topNav = readFileSync("src/ui/components/TopNav.tsx", "utf8");
  assert.match(tokens, /--ca-header-height:\s*0px;/);
  assert.match(
    tokens,
    /--ca-header-safe-offset:\s*calc\(var\(--ca-header-height\) \+ var\(--ca-space-4\)\);/,
  );
  assert.match(topNav, /ResizeObserver/);
  assert.match(topNav, /--ca-header-height/);
  assert.match(surfacesCss, /scroll-padding-top:\s*var\(--ca-header-safe-offset\);/);
  assert.match(surfacesCss, /:where\(main \[id\], \.header-offset-target\)/);

  for (const selector of [
    ".page-sidebar",
    ".catalog-filter-bar",
  ]) {
    const escaped = selector.replace(".", "\\.");
    assert.match(
      surfacesCss,
      new RegExp(
        `${escaped}\\s*\\{[^}]*top:\\s*var\\(--ca-header-safe-offset\\);`,
      ),
      `${selector} must clear the shared header offset`,
    );
  }
});

test("connection transparency distinguishes inventory from completeness", () => {
  // CATL coverage blocker: low-coverage catalogs stay visible but must be
  // labelled so users do not read a missing link as proof of no relationship.
  const catalogCoverage = readFileSync(
    "src/ui/lib/catalogCoverage.ts",
    "utf8",
  );
  const sourcesPage = readFileSync("src/ui/pages/SourcesPage.tsx", "utf8");
  const explorePage = readFileSync("src/ui/pages/ExplorePage.tsx", "utf8");

  // isLowCatalogCoverage flags any catalog at or below the 75% coverage
  // threshold (inclusive, so an exactly-75% catalog still gets flagged).
  assert.match(catalogCoverage, /export function isLowCatalogCoverage/);
  assert.match(catalogCoverage, /coverage\.pct\s*<=\s*75/);

  // SourcesPage is a factual trust register and never presents a traffic-light
  // completeness judgment.
  assert.match(sourcesPage, /buildPublicationRegister/);
  assert.match(sourcesPage, /Publication/);
  assert.match(sourcesPage, /Publisher/);
  assert.match(sourcesPage, /Version \/ current through/);
  assert.match(sourcesPage, /Status/);
  assert.doesNotMatch(sourcesPage, /Preview \/ low coverage/);
  assert.doesNotMatch(sourcesPage, /data-level=/);
  assert.doesNotMatch(sourcesPage, /catalog\.pct/);

  // ExplorePage result cards derive coverage per document and surface a
  // "Limited coverage" badge so absence of a link is not over-trusted.
  assert.match(explorePage, /catalogCoverageForId\(catalogCoverage/);
  assert.match(explorePage, /Limited coverage/);
});
