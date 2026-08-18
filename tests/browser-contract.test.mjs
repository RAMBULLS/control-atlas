import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { HOME_CONTENT, HOME_DESTINATIONS } from '../src/shared/home-content.mjs';
import { SITE_COPY } from '../src/shared/site-copy.mjs';

const html = readFileSync('src/index.html', 'utf8');
const css = readFileSync('styles/tokens.css', 'utf8');
const orbitalCss = readFileSync('styles/orbital.css', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

const mainEntrypoint = existsSync('src/main.tsx') ? readFileSync('src/main.tsx', 'utf8') : '';
const reactApp = existsSync('src/ui/App.tsx') ? readFileSync('src/ui/App.tsx', 'utf8') : '';
const router = existsSync('src/ui/lib/hashRoutes.ts')
  ? readFileSync('src/ui/lib/hashRoutes.ts', 'utf8')
  : existsSync('src/ui/lib/viewState.ts')
    ? readFileSync('src/ui/lib/viewState.ts', 'utf8')
    : '';
const runtimeLoader = existsSync('src/ui/lib/runtimeLoader.ts')
  ? readFileSync('src/ui/lib/runtimeLoader.ts', 'utf8')
  : '';
const relationshipExplorer = existsSync('src/ui/components/RelationshipExplorer.tsx')
  ? readFileSync('src/ui/components/RelationshipExplorer.tsx', 'utf8')
  : '';
const relationshipGraph = existsSync('src/ui/components/RelationshipGraph.tsx')
  ? readFileSync('src/ui/components/RelationshipGraph.tsx', 'utf8')
  : '';
const graphLayout = existsSync('src/ui/lib/graphLayout.ts')
  ? readFileSync('src/ui/lib/graphLayout.ts', 'utf8')
  : '';

test('tracked product and documentation files forbid the obsolete public hostname', () => {
  const obsoleteUrl = ['https://', 'ash', 'bryant.github.io/control-atlas'].join('');
  const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml']);
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((path) => textExtensions.has(path.slice(path.lastIndexOf('.'))))
    .filter((path) => existsSync(path));
  const offenders = trackedFiles.filter((path) => readFileSync(path, 'utf8').includes(obsoleteUrl));

  assert.deepEqual(offenders, [], `obsolete public hostname found in: ${offenders.join(', ')}`);
});

test('shell identifies Control Atlas and progressively boots the React workspace', () => {
  assert.match(html, /Control Atlas/);
  assert.match(html, /name="application-name" content="Control Atlas"/);
  assert.match(html, /CONTROL_ATLAS_PRODUCT_DESCRIPTION/);
  assert.equal(SITE_COPY.product.definition, 'Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.');
  assert.match(html, /id="root"/);
  assert.ok(existsSync('src/main.tsx'), 'src/main.tsx must exist');
  assert.ok(existsSync('src/ui/App.tsx'), 'src/ui/App.tsx must exist');
  assert.match(mainEntrypoint, /createRoot/);
  assert.match(mainEntrypoint, /StrictMode/);
  assert.match(mainEntrypoint, /import\('react'\)/);
  assert.match(mainEntrypoint, /import\('react-dom\/client'\)/);
  assert.doesNotMatch(mainEntrypoint, /from ['"]react['"]/);
  assert.doesNotMatch(mainEntrypoint, /from ['"]react-dom\/client['"]/);
  assert.match(html, /data-view="home"/);
  assert.match(html, /data-static-home hidden/);
  assert.match(html, /data-app-ready="false"/);
  assert.match(mainEntrypoint, /setAttribute\('data-app-ready', 'true'\)/);
  assert.match(
    mainEntrypoint,
    /\['true', 'partial', 'error'\]\.includes\(app\.dataset\.appReady/,
  );
  assert.equal(packageJson.dependencies['react-router'], undefined);
});

test('shell exposes direct task navigation and keeps Guides in overflow', () => {
  assert.doesNotMatch(html, /btn-toggle-mode/);
  assert.doesNotMatch(html, /Plain labels/);
  assert.doesNotMatch(html, /Technical labels/);
  const navigation = readFileSync('src/ui/lib/navigation.ts', 'utf8');
  const routeIdentity = readFileSync('src/ui/lib/routeIdentity.ts', 'utf8');
  assert.match(navigation, /PRIMARY_NAV_ITEMS/);
  assert.match(navigation, /routeIdentityFor/);
  assert.match(routeIdentity, /label: "Atlas"/);
  assert.match(routeIdentity, /label: "Library"/);
  assert.match(routeIdentity, /label: "Resources"/);
  assert.match(routeIdentity, /label: "Guides"/);
  assert.match(routeIdentity, /Sources/);
  assert.match(routeIdentity, /About/);
  const staticPrimaryNav = html.match(/<nav aria-label="Primary navigation"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(staticPrimaryNav, /#\/start[\s\S]*#\/atlas[\s\S]*#\/library[\s\S]*#\/compare[\s\S]*#\/resources/);
  assert.match(navigation, /PRIMARY_SECTION_LABEL = "Explore Control Atlas"/);
  assert.match(navigation, /PRIMARY_NAV_ITEMS[\s\S]*view: "start-here"[\s\S]*view: "atlas-map"[\s\S]*view: "search"[\s\S]*view: "matrix"[\s\S]*view: "commons"/);
  assert.doesNotMatch(
    navigation.match(/PRIMARY_NAV_ITEMS:[\s\S]*?\n\];/)?.[0] || "",
    /view: "patterns"/,
  );
  assert.match(navigation, /OVERFLOW_NAV_ITEMS[\s\S]*DOCUMENTS_NAV_ITEM[\s\S]*GUIDES_NAV_ITEM/);
  assert.match(navigation, /UTILITY_NAV_ITEMS[\s\S]*view: "sources"[\s\S]*view: "about"/);
  assert.doesNotMatch(navigation, /The framework/);
  assert.doesNotMatch(navigation, /NAV_GROUPS/);
  assert.doesNotMatch(navigation, /Crosswalks/);
});

test('frontend foundation uses React, Vite, TypeScript, and Radix primitives', () => {
  assert.equal(typeof packageJson.dependencies.react, 'string');
  assert.equal(typeof packageJson.dependencies['react-dom'], 'string');
  assert.equal(typeof packageJson.devDependencies.vite, 'string');
  assert.equal(typeof packageJson.devDependencies['@vitejs/plugin-react'], 'string');
  assert.equal(typeof packageJson.dependencies['@radix-ui/react-accordion'], 'string');
  assert.ok(existsSync('vite.config.ts'), 'vite.config.ts must exist');
  assert.ok(existsSync('src/ui/lib/viewState.ts'), 'src/ui/lib/viewState.ts must exist');
});

test('brand identity is immediate, animated, and does not use an entrance gate', () => {
  const app = readFileSync('src/ui/App.tsx', 'utf8');
  const brand = readFileSync('src/ui/components/BrandLockup.tsx', 'utf8');
  const rotation = readFileSync('src/shared/brand-rotation.ts', 'utf8');
  assert.doesNotMatch(app, /BrandEntranceOverlay/);
  assert.match(brand, /BRAND_ACTIONS/);
  // The rotation timers live in the shared module now: one ticker drives every
  // flourish so Ctrl+Alt+<word> resolves against a single displayed word.
  assert.match(brand, /subscribeBrandRotation/);
  for (const featureWord of [
    "Trace",
    "Explore",
    "Crosswalk",
    "Browse",
    "Draft",
    "Find",
    "Verify",
    "Reconcile",
    "Learn",
  ]) {
    assert.match(rotation, new RegExp(`"${featureWord}"`));
  }
  assert.doesNotMatch(
    rotation,
    /word: "(?:Approve|Comply|Authorize|Inherit|Baseline|Assess|Audit|Recommend|Secure|Simplify|Clarify|Demystify)"/,
  );
  assert.match(rotation, /BRAND_ROTATION_INTERVAL_MS = 2400/);
  assert.match(rotation, /BRAND_ROTATION_SETTLE_MS = 8000/);
  assert.match(brand, /brand-key">Ctrl/);
  assert.match(rotation, /BRAND_ROTATION_SETTLE_MS/);
  assert.match(rotation, /setTimeout/);
  assert.match(rotation, /setInterval/);
  assert.doesNotMatch(brand, /classList/);
  // The shortcut the keycap advertises is wired to the one global listener.
  assert.match(app, /BRAND_SURFACE_VIEWS/);
  assert.match(app, /activeBrandAction/);
  assert.match(html, /class="brand-key">Ctrl/);
  assert.match(html, /class="brand-key">Alt/);
  assert.match(html, /data-brand-word>Explore/);
  assert.match(mainEntrypoint, /prefers-reduced-motion: reduce/);
  assert.match(mainEntrypoint, /BRAND_WORDS/);
  assert.match(mainEntrypoint, /addEventListener\('change', onBrandMotionChange\)/);
  assert.equal(typeof packageJson.dependencies['@xyflow/react'], 'string');
  assert.equal(typeof packageJson.dependencies.elkjs, 'string');
  assert.equal(packageJson.dependencies.cytoscape, undefined);
  assert.equal(packageJson.dependencies['react-force-graph-2d'], undefined);
  assert.match(relationshipExplorer, /lazy\(\(\) => import\(/);
  assert.match(relationshipExplorer, /useClusteredGraph/);
  assert.match(relationshipGraph, /from "@xyflow\/react"/);
  assert.match(relationshipGraph, /import\("elkjs\/lib\/elk\.bundled\.js"\)/);
  assert.match(relationshipGraph, /<ReactFlow/);
  assert.match(relationshipGraph, /<MiniMap/);
  assert.match(relationshipGraph, /<Controls/);
  assert.match(relationshipGraph, /elk\s*\.\s*layout/);
});

test('route transitions use the canonical Control Atlas mark', () => {
  const transitionMarkup = html.match(
    /<span aria-hidden="true" class="brand-icon-mark route-transition__mark">[\s\S]*?<\/span>/,
  )?.[0];

  assert.ok(transitionMarkup, 'the route transition must render the brand mark');
  assert.match(transitionMarkup, /M 61\.2 61\.2 A 30 30 0 1 1 61\.2 18\.8/);
  assert.match(transitionMarkup, /M 31 31 L 53 40 L 43 43 L 40 53 Z/);
  assert.doesNotMatch(html, /route-transition__circuit/);
  assert.match(orbitalCss, /\.route-transition__mark[\s\S]*route-transition-mark-pulse/);
  assert.match(orbitalCss, /prefers-reduced-motion: reduce[\s\S]*\.route-transition__mark/);
});

test('map foundation uses the approved React Flow and ELK stack', () => {
  for (const dependency of [
    '@xyflow/react',
    'elkjs',
  ]) {
    assert.equal(
      typeof packageJson.dependencies[dependency],
      'string',
      `${dependency} must be installed`,
    );
  }

  for (const prohibited of [
    'cytoscape',
    'cytoscape-fcose',
    'cytoscape-dagre',
    'cytoscape-popper',
    'yfiles',
    'react-force-graph-2d',
    '@popperjs/core',
    'tippy.js',
    'cytoscape-navigator',
    'cytoscape-expand-collapse',
    'cytoscape-cola',
    'cytoscape-cose-bilkent',
    'cytoscape-elk',
    'cytoscape-automove',
    'cytoscape-cxtmenu',
  ]) {
    assert.equal(packageJson.dependencies[prohibited], undefined);
    assert.equal(packageJson.devDependencies[prohibited], undefined);
  }
});

test('graph implementation references are documented', () => {
  assert.ok(existsSync('src/ui/graph/GRAPH_REFERENCES.md'));
  const references = readFileSync('src/ui/graph/GRAPH_REFERENCES.md', 'utf8');
  for (const link of [
    'https://reactflow.dev/',
    'https://reactflow.dev/learn',
    'https://github.com/xyflow/xyflow',
    'https://github.com/kieler/elkjs',
    'https://attack.mitre.org/',
    'https://github.com/mitre-attack/attack-stix-data',
    'https://d3fend.mitre.org/',
    'https://d3fend.mitre.org/resources/',
    'https://github.com/usnistgov/oscal-content',
    'https://www.nist.gov/cyberframework',
    'https://csrc.nist.gov/projects/olir',
  ]) {
    assert.ok(references.includes(link), `missing graph reference: ${link}`);
  }
});

test('static artifact loading caches requests and scopes initial data by route', () => {
  assert.match(runtimeLoader, /new Map<.*Promise/);
  assert.match(runtimeLoader, /artifactCache\.get/);
  assert.match(runtimeLoader, /artifactCache\.set/);
  assert.match(runtimeLoader, /runtimeArtifactPlan/);
  assert.match(runtimeLoader, /catalog-bootstrap\.json/);
  assert.match(runtimeLoader, /catalog-records/);
  assert.match(reactApp, /requiresFullGraph\(viewState\)/);
  assert.match(
    reactApp,
    /viewState\.catalog}:\$\{viewState\.family \|\| "all"}/,
    'switching a publisher-native group must trigger its scoped artifact load',
  );
});

test('secondary route pages are lazy loaded behind a suspense fallback', () => {
  assert.match(reactApp, /lazy\(\(\) =>\s*import\("\.\/pages\/AtlasMapPage"\)/);
  assert.match(reactApp, /lazy\(\(\) =>\s*import\("\.\/pages\/ComparePage"\)/);
  assert.match(reactApp, /lazy\(\(\) =>\s*import\("\.\/pages\/ObjectDetailPage"\)/);
  assert.match(reactApp, /<Suspense/);
  assert.match(reactApp, /fallback=\{<LoadingStatusPanel/);
});

test('persistent footer uses the approved short disclaimer', () => {
  const footer = readFileSync('src/ui/components/SiteFooter.tsx', 'utf8');
  const identity = readFileSync('src/shared/product-identity.ts', 'utf8');
  assert.match(footer, /PRODUCT_FOOTER_NOTICE/);
  assert.match(identity, /SITE_COPY\.product\.footer/);
  assert.equal(SITE_COPY.product.footer, 'Free and open source. Not a government system.');
  assert.match(html, /Free and open source\. Not a government system\./);
});

test('query-string deep link compatibility moves into typed React adapters', () => {
  assert.ok(existsSync('src/ui/lib/hashRoutes.ts'), 'src/ui/lib/hashRoutes.ts must exist');
  assert.match(router, /parseViewState/);
  assert.match(router, /serializeHashLocation/);
  assert.match(router, /serializeHashUrl/);
  assert.match(router, /applyLegacyQueryRedirect/);
});

test('path-style legacy URLs stop at the static not-found page instead of redirecting', () => {
  const redirectPage = readFileSync('src/public/404.html', 'utf8');
  assert.match(redirectPage, /<title>Page not found \| Control Atlas<\/title>/);
  assert.match(redirectPage, /current link/);
  assert.doesNotMatch(redirectPage, /<script/);
  assert.doesNotMatch(redirectPage, /l\.replace\(/);
});

test('Orbital Archive visual system remains active in the shared stylesheet', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /fonts\.gstatic\.com/);
  assert.match(css, /--lsm-orbit:\s*#11181e/i);
  assert.match(css, /--lsm-graphite:\s*#253139/i);
  assert.match(css, /--lsm-slate:\s*#2d3a42/i);
  assert.match(css, /--lsm-relay:\s*#54bcd9/i);
  assert.match(css, /--lsm-gold:\s*#cbae67/i);
  assert.match(css, /--lsm-orange:\s*#cb7248/i);
  assert.match(css, /--lsm-signal:\s*#7eb79e/i);
  assert.match(css, /--lsm-rust:\s*#c97a60/i);
  assert.match(css, /--lsm-fault:\s*#ea7468/i);
  assert.match(css, /Oswald/);
  assert.match(css, /Inter/);
  assert.match(css, /IBM Plex Mono/);
  assert.doesNotMatch(css, /#[a-f\d]{0,2}(?:7c3aed|d8b4fe|6366f1)/i);
  assert.match(mainEntrypoint, /styles\/orbital\.css/);
  assert.match(orbitalCss, /\.orbital-context/);
  assert.match(orbitalCss, /\.landing-signal-grid/);
});

test('all route contexts and user-facing styles stay inside the Orbital system', () => {
  const contextBar = readFileSync(
    'src/ui/components/OrbitalContextBar.tsx',
    'utf8',
  );
  for (const view of [
    'home',
    'start-here',
    'atlas-map',
    'search',
    'catalog-detail',
    'library-detail',
    'matrix',
    'patterns',
    'templates',
    'sources',
    'commons',
    'commons-detail',
    'about',
    'retired',
    'not-found',
  ]) {
    assert.match(contextBar, new RegExp(`case "${view}"`));
  }

  const implementationFiles = [
    ...readdirSync('src/ui', { recursive: true })
      .map((path) => String(path))
      .filter((path) => /\.(?:css|ts|tsx)$/.test(path))
      .map((path) => readFileSync(`src/ui/${path}`, 'utf8')),
    ...readdirSync('styles')
      .filter((path) => path.endsWith('.css'))
      .map((path) => readFileSync(`styles/${path}`, 'utf8')),
  ].join('\n');
  assert.doesNotMatch(
    implementationFiles,
    /(?:purple|violet|pink|magenta|#(?:7c3aed|d8b4fe|6366f1|4f46e5|a5b4fc))/i,
  );
});

test('shared shell exposes visible search access and valid intent-card markup', () => {
  const topNav = readFileSync('src/ui/components/TopNav.tsx', 'utf8');
  const templatesPage = readFileSync('src/ui/pages/TemplatesPage.tsx', 'utf8');
  const intentCard = readFileSync('src/ui/components/QuickIntentCard.tsx', 'utf8');
  assert.match(topNav, /onClick=\{onOpenSearch\}/);
  assert.match(topNav, /aria-label="Open search"/);
  assert.match(topNav, /<nav aria-label="Primary navigation"/);
  assert.match(topNav, /PRIMARY_NAV_ITEMS\.map/);
  assert.match(topNav, /<AppLink/);
  assert.doesNotMatch(topNav, /<Tabs/);
  assert.match(templatesPage, /className="build-start-layout"/);
  assert.match(templatesPage, /className="build-resource-rail"/);
  assert.doesNotMatch(intentCard, /<h[1-6]>/);
});

test('landing page states what the product is before asking for action', () => {
  const homePage = readFileSync('src/ui/pages/HomePage.tsx', 'utf8');
  const homeContent = readFileSync('src/shared/home-content.mjs', 'utf8');
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  assert.match(homePage, /HOME_CONTENT\.definition/);
  assert.match(homeContent, /SITE_COPY\.home/);
  assert.equal(HOME_CONTENT.headline, 'Make federal cybersecurity compliance make sense.');
  assert.equal(HOME_CONTENT.definition, 'Understand what applies, what it means, and what to do next.');
  assert.match(homePage, /aria-label="Search Control Atlas"/);
  assert.match(homePage, /data-template="B"/);
  assert.match(html, /CONTROL_ATLAS_HOME/);
  assert.match(viteConfig, /renderStaticHome\(\)/);
  assert.match(viteConfig, /\.replace\('<!-- CONTROL_ATLAS_HOME -->'/);
  assert.equal(HOME_DESTINATIONS.length, 4);
  assert.deepEqual(HOME_DESTINATIONS.map(({ label }) => label), [
    'Start guided setup', 'Browse the Atlas', 'Search the Library', 'Browse Resources',
  ]);
  assert.doesNotMatch(homePage, /home-ecosystem-authorities/);
  assert.match(homePage, /HOME_TAG_GROUPS\.map/);
  assert.match(homePage, /home-tag-galaxies/);
  assert.match(homePage, /data-record-count/);
  assert.match(homePage, /More records, bigger tag\./);
});

test('Guides implement the numbered Template F directory contract', () => {
  const playbooksPage = readFileSync('src/ui/pages/PlaybooksPage.tsx', 'utf8');
  assert.match(playbooksPage, /data-template="F"/);
  assert.match(playbooksPage, /data-page-template="directory"/);
  assert.match(playbooksPage, /practitionerGuides\.map\(\(article, index\)/);
  assert.match(playbooksPage, /className="guide-card"/);
  assert.match(playbooksPage, /Step \{String\(index \+ 1\)\.padStart\(2, "0"\)\}/);
  assert.match(playbooksPage, /<BucketTag area=\{presentation\.area\}/);
  assert.match(playbooksPage, /const \{ Icon \} = presentation/);
});

test('skip links focus the workspace without turning the target into an application route', () => {
  assert.match(html, /data-skip-workspace href="#workspace"/);
  assert.match(html, /id="workspace" tabindex="-1"/);
  assert.match(mainEntrypoint, /event\.preventDefault\(\)/);
  assert.match(mainEntrypoint, /querySelector<HTMLElement>\('#workspace'\)\?\.focus\(\)/);
  assert.match(reactApp, /document\.getElementById\("workspace"\)\?\.focus\(\)/);
  assert.match(reactApp, /<main id="workspace" tabIndex=\{-1\}>/);
});

test('mounted record surfaces render official descriptions rather than synthetic translations', () => {
  const detailPage = readFileSync('src/ui/pages/ObjectDetailPage.tsx', 'utf8');
  const surfaces = [detailPage, readFileSync('src/ui/pages/CatalogDetailPage.tsx', 'utf8'), readFileSync('src/ui/pages/AtlasMapPage.tsx', 'utf8'), readFileSync('src/ui/pages/ExplorePage.tsx', 'utf8'), readFileSync('src/ui/components/SearchOverlay.tsx', 'utf8')].join('\n');
  assert.match(detailPage, /recordPresentationProfile/);
  assert.match(detailPage, /data-source-text="published"/);
  assert.doesNotMatch(surfaces, /No narrative description was published for this record/);
  assert.doesNotMatch(surfaces, /plain_language_summary|plain_action/);
});

test('concise DISA CCI records orient the user before the publisher requirement', () => {
  const detail = readFileSync('src/ui/pages/ObjectDetailPage.tsx', 'utf8');
  const startHere = detail.indexOf('CCI records deliberately publish a concise requirement');
  const sourceExcerpt = detail.indexOf('Source excerpt from');
  assert.ok(startHere >= 0, 'CCI records need an explicit source-first orientation');
  assert.ok(sourceExcerpt > startHere, 'CCI orientation must appear before the terse publisher requirement');
  assert.match(detail, /Explore connections/);
  assert.match(detail, /Compare this CCI/);
  assert.match(detail, /props\.kind === "references"/);
  assert.match(detail, /Evidence-backed connected records/);
  assert.match(detail, /Explore all connections in Atlas/);
});

test('Catalog controls stay anchored to the records section', () => {
  const catalogPage = readFileSync('src/ui/pages/CatalogDetailPage.tsx', 'utf8');
  const surfaces = readFileSync('styles/surfaces.css', 'utf8');
  assert.match(catalogPage, /aria-label="Catalog record controls"/);
  assert.match(catalogPage, /className="catalog-record-toolbar"/);
  assert.match(catalogPage, />Published group</);
  assert.match(catalogPage, /Search records/);
  assert.match(catalogPage, /Search \$\{catalog\.tier_label_plural/);
  assert.match(catalogPage, /data-published-tier/);
  assert.match(catalogPage, /className="catalog-source-link"/);
  assert.match(surfaces, /\.catalog-record-toolbar\s*\{/);
  assert.match(surfaces, /\.catalog-source-link\s*\{[^}]*justify-self:\s*start;/s);
});

test('result-affecting controls have one visible workbench owner', () => {
  const primitives = readFileSync('src/ui/lib/pagePrimitives.tsx', 'utf8');
  const catalog = readFileSync('src/ui/pages/CatalogDetailPage.tsx', 'utf8');
  const compare = readFileSync('src/ui/pages/ComparePage.tsx', 'utf8');
  const compareResults = readFileSync(
    'src/ui/components/CompareResultsPanel.tsx',
    'utf8',
  );
  const resources = readFileSync('src/ui/pages/CommonsPage.tsx', 'utf8');
  const workspaceTemplate = readFileSync('src/ui/components/WorkspaceTemplate.tsx', 'utf8');
  const sources = readFileSync('src/ui/pages/SourcesPage.tsx', 'utf8');
  const record = readFileSync('src/ui/pages/ObjectDetailPage.tsx', 'utf8');
  const surfaces = readFileSync('styles/surfaces.css', 'utf8');

  assert.match(primitives, /export function WorkbenchControlSurface/);
  assert.match(primitives, /aria-controls=\{props\.targetId\}/);
  assert.match(primitives, /data-controls-for=\{props\.targetId\}/);
  assert.match(primitives, /workbench-controls-title/);
  assert.match(surfaces, /\.workbench-controls\s*\{[^}]*border:/s);

  for (const [source, target] of [
    [catalog, 'catalog-inventory-results'],
  ]) {
    assert.match(source, new RegExp(`targetId="${target}"`));
    assert.match(source, new RegExp(`id="${target}"`));
    assert.match(source, /data-control-results/);
  }
  assert.match(resources, /resultsId="resources-results"/);
  assert.match(workspaceTemplate, /id=\{props\.resultsId\}/);
  assert.match(resources, /data-control-results/);

  assert.match(catalog, /targetId="catalog-record-results"/);
  assert.match(
    catalog,
    /data-control-results id="catalog-record-results"/,
  );

  assert.match(compare, /targetId="compare-workspace"/);
  assert.match(compare, /data-control-results[^>]*id="compare-workspace"/);
  assert.doesNotMatch(compare, /function (?:Field|SelectField)\(/);
  assert.match(compareResults, /aria-label="Comparison result controls"/);
  assert.match(record, /buildRecordConnectionGroups/);
  assert.doesNotMatch(record, /RelationshipExplorer|SelectField/);
});

test('Build stays locally coherent while Resources owns resource discovery', () => {
  const localNav = readFileSync('src/ui/components/BuildLocalNav.tsx', 'utf8');
  const buildRouteState = readFileSync('src/ui/lib/buildRouteState.ts', 'utf8');
  const buildPage = readFileSync('src/ui/pages/TemplatesPage.tsx', 'utf8');
  const resourcesPage = readFileSync('src/ui/pages/CommonsPage.tsx', 'utf8');
  const resourceDetail = readFileSync('src/ui/pages/CommonsDetailPage.tsx', 'utf8');
  assert.match(localNav, /aria-label="Build sections"/);
  assert.match(localNav, /aria-current/);
  assert.match(localNav, /BUILD_LANES/);
  assert.match(buildRouteState, /label: "Tasks"/);
  assert.match(buildRouteState, /label: "Starter documents"/);
  assert.match(buildRouteState, /label: "Resources"/);
  assert.match(buildPage, /<BuildLocalNav/);
  assert.doesNotMatch(resourcesPage, /BuildLocalNav/);
  assert.doesNotMatch(resourceDetail, /BuildLocalNav/);
  assert.match(resourcesPage, /title="Resources"/);
  assert.doesNotMatch(
    resourceDetail,
    /<AppLink[^>]+view="commons"[^>]*>.*(?:Back|Return to Resources).*<\/AppLink>/s,
  );
});

test('route interactions keep canonical context and synchronize visible state', () => {
  const searchOverlay = readFileSync('src/ui/components/SearchOverlay.tsx', 'utf8');
  const atlasMap = readFileSync('src/ui/pages/AtlasMapPage.tsx', 'utf8');
  const explore = readFileSync('src/ui/pages/ExplorePage.tsx', 'utf8');
  assert.match(searchOverlay, /onOpenNode\(nodeId\)/);
  assert.match(atlasMap, /loadAtlasNeighborhood\(nodeId\)/);
  assert.match(atlasMap, /buildAtlasGroups\(record, filters\)/);
  assert.match(atlasMap, /buildAtlasRows\(record, filters\)/);
  // The Path/Map/List tabs were folded into one record workspace: Connections
  // is always rendered and relationshipView now decides which supporting panel
  // is open, so every existing deep link still resolves.
  assert.match(atlasMap, /relationshipView: hierarchyOpen \? "map" : "path"/);
  assert.match(atlasMap, /relationshipView: listOpen \? "map" : "list"/);
  assert.doesNotMatch(atlasMap, /role="tablist"/);
  assert.match(atlasMap, /buildStructuralChildren\(record\)/);
  assert.match(atlasMap, /relationshipGroup/);
  assert.doesNotMatch(atlasMap, /RelationshipExplorer/);
  assert.match(explore, /<WorkspaceTemplate/);
  assert.match(explore, /rows\.slice\(0, visibleCount\)/);
  assert.match(explore, /recordIdentityPresentationFor/);
  assert.match(explore, /catalogDisplayNameFor/);
  assert.match(explore, /areaPresentationForCatalog/);
  assert.match(explore, /data-result-class="published-record"/);
  assert.doesNotMatch(explore, /searchExploreResources|searchResourceDocuments/);
  assert.match(searchOverlay, /Search Control Atlas/);
  assert.match(searchOverlay, /Records \(\{results\.libraryResults\.length\}\)/);
  assert.match(searchOverlay, /Tools and resources/);
  assert.match(searchOverlay, /Communities/);
  assert.match(searchOverlay, /document\.resourceType === "community_forum"/);
  assert.match(searchOverlay, /resourceTypeLabel\(doc\.resourceType\)/);
  assert.match(searchOverlay, /resourceAccessLabel\(doc\)/);
  assert.doesNotMatch(searchOverlay, /doc\.resourceLane\.replaceAll/);
  assert.doesNotMatch(searchOverlay, />\{doc\.resourceType\}</);
  assert.match(explore, /SITE_COPY\.routes\.library\.purpose/);
  assert.match(explore, /Browse the Library/);
  assert.match(explore, /Nothing matches these filters\./);
  assert.match(explore, /No records found\./);
});

test('template options use collapsed progressive disclosure and associated hints', () => {
  const templatesPage = readFileSync('src/ui/pages/TemplatesPage.tsx', 'utf8');
  assert.doesNotMatch(templatesPage, /defaultValue="options"/);
  assert.match(templatesPage, /<h2>\{selectedTemplate\.display_name\}<\/h2>/);
  assert.match(templatesPage, /hint="Which control catalog/);
  assert.match(templatesPage, /hint="Where the system runs/);
  // CATL-09: Format help is per-template/per-format, not a single generic
  // "Markdown, CSV, or JSON" string.
  assert.match(templatesPage, /FORMAT_HELP\[activeFormat\]/);
  assert.doesNotMatch(templatesPage, /Markdown, CSV, or JSON/);
  assert.match(templatesPage, /return "Starter document"/);
  assert.doesNotMatch(templatesPage, /Search companions by name or purpose/);
});

test('Guides remain explanatory while product help is consolidated into About', () => {
  const playbooksPage = readFileSync('src/ui/pages/PlaybooksPage.tsx', 'utf8');
  assert.match(playbooksPage, /Control Atlas explanation/);
  assert.match(playbooksPage, /Official references/);
  assert.match(playbooksPage, /Limitations/);
  assert.doesNotMatch(playbooksPage, /learnArticles\.map/);
  const glossary = readFileSync('src/ui/components/GlossaryDrawer.tsx', 'utf8');
  const about = readFileSync('src/ui/pages/AboutPage.tsx', 'utf8');
  assert.doesNotMatch(glossary, /learnArticles\.map|<Dialog\.Title>Help|>Help</);
  assert.match(about, /PRODUCT_DEFINITION/);
  assert.match(about, /PRODUCT_DECISION_BOUNDARY/);
  assert.doesNotMatch(playbooksPage, /Recommended for new users|No public playbooks are available yet/);
});
