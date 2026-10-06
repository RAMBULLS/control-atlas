import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { RUNTIME_CACHE_VERSION } from './src/shared/runtime-cache-version.mjs';
import { HOME_CONTENT, HOME_TOOLS } from './src/shared/home-content.mjs';
import { FIRST_PAINT_ROUTE_COPY, SITE_COPY } from './src/shared/site-copy.mjs';
import {
  buildAtlasBrandSignals,
  countLibraryTaxonomyTags,
  deriveAtlasScopeMetrics,
} from './src/shared/brand-signals.mjs';
import { HOME_LIBRARY_DISCOVERY } from './src/ui/lib/homeTagConstellation.ts';
import { JOURNEYS } from './src/ui/lib/atlasJourneys.ts';
import { TERRITORY_GEOMETRY } from './src/ui/lib/atlasTerritoryGeography.ts';
import { AREA_PRESENTATIONS } from './src/ui/lib/areaVisualLanguage.ts';
import { serializeHashUrl } from './src/ui/lib/hashRoutes.ts';
import { normalizeViewState } from './src/ui/lib/viewState.ts';
import { buildHomeSurface } from './src/shared/home-surface-build.ts';
import type { HomeSurface } from './src/shared/home-surface.ts';
import { RECORD_STARTUP_ENTRIES, recordStartupHints } from './tools/record-startup-hints.mjs';
import { orbitalFontAssetsPlugin } from './tools/orbital-font-assets.mjs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

function readGeneratedJson(relativePath: string) {
  return JSON.parse(readFileSync(resolve(rootDir, 'data/generated', relativePath), 'utf8'));
}

// These three artifacts are the count authorities for presentation. The
// helper validates their internal totals and fails the build instead of
// publishing a plausible-looking zero when an input is missing or malformed.
const librarySearchIndex = readGeneratedJson('library-search-index.json');
const connectionInventory = readGeneratedJson('connection-inventory.json');
const publicationIdentityIndex = readGeneratedJson('publication-identity-index.json');
const librarySearchShards = librarySearchIndex.sharded_collection.shards.map(
  (shard: { path: string }) => readGeneratedJson(shard.path),
);
const atlasScopeMetrics = deriveAtlasScopeMetrics({
  librarySearchIndex,
  connectionInventory,
  publicationIdentityIndex,
});
const atlasBrandSignals = buildAtlasBrandSignals({
  publicationIdentityIndex,
  tagCounts: countLibraryTaxonomyTags(librarySearchIndex, librarySearchShards),
  capabilities: {
    search: atlasScopeMetrics.records > 0,
    sources: atlasScopeMetrics.publications > 0,
    compare: atlasScopeMetrics.connections > 0,
    connections: atlasScopeMetrics.connections > 0,
    guides: Boolean(SITE_COPY.routes.guides?.title),
  },
});
if (atlasBrandSignals.length === 0) {
  throw new Error('Atlas presentation has no eligible brand signals.');
}
const longestBrandSignal = atlasBrandSignals.reduce(
  (longest: string, signal: { label: string }) =>
    signal.label.length > longest.length ? signal.label : longest,
  '',
);
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
});

// Home (#283): topics, the Atlas map and source changes, computed once and used
// by both the static first paint below and React (via the define). Pulse is
// built from accepted lifecycle evidence by scripts/build-pulse-artifact.mjs,
// which build:site runs before this config.
let pulseArtifact;
try {
  pulseArtifact = readGeneratedJson('pulse.json');
} catch {
  throw new Error('data/generated/pulse.json is missing: run `node --import tsx scripts/build-pulse-artifact.mjs --output data/generated` (build:site does this).');
}
const homeSurface: HomeSurface = buildHomeSurface({
  journeys: JOURNEYS,
  journeyHref: (id) => serializeHashUrl(normalizeViewState('atlas-map', { atlasJourney: id })),
  shownTopics: HOME_CONTENT.atlas.shownTopics,
  geometry: TERRITORY_GEOMETRY,
  areaTokens: Object.fromEntries(AREA_PRESENTATIONS.map((area) => [area.id, area.token])),
  pulse: pulseArtifact,
});
const homeMetrics = `${atlasScopeMetrics.compact.records} records · ${atlasScopeMetrics.compact.publications} source publications`;

function formatBuildDate(value: string | undefined) {
  return value ? DATE_FORMATTER.format(new Date(value)) : 'local development build';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

/** Must match HomeAtlasMap in HomePage.tsx exactly. */
function renderHomeMap() {
  const { map } = homeSurface;
  const area = (token: string) => `style="--ca-area-color-on-dark: var(${token}-on-dark)"`;
  const areas = map.areas.map((a) => `<path class="home-map__area${a.empty ? ' is-empty' : ''}" d="${a.d}" ${area(a.token)}></path>`).join('');
  const names = map.areas.map((a) => `<text class="home-map__name${a.empty ? ' is-empty' : ''}" x="${a.name.x}" y="${a.name.y}" ${area(a.token)}>${a.name.lines.map((line, index) => `<tspan dy="${index ? 34 : 0}" x="${a.name.x}">${escapeHtml(line)}</tspan>`).join('')}</text>`).join('');
  const marks = map.landmarks.map((l) => `<g class="home-map__landmark"><circle class="home-map__ring" cx="${l.x}" cy="${l.y}" r="13"></circle><circle class="home-map__point" cx="${l.x}" cy="${l.y}" r="6"></circle><text class="home-map__alias" x="${l.x + 20}" y="${l.y + 8}">${escapeHtml(l.alias)}</text></g>`).join('');
  return `<svg aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet" viewBox="${map.viewBox}"><path class="home-map__coast" d="${map.coast}"></path>${areas}${names}${marks}</svg>`;
}

// Must match HomePage.tsx exactly: any difference here is a visible swap when
// React takes over the pre-rendered shell. tests/e2e/home-atlas-pulse.spec.mjs
// compares the two.
function renderStaticHome() {
  const arrow = '<span aria-hidden="true">→</span>';
  const link = (href: string, className: string, body: string, extra = '') =>
    `<a class="${className}" data-route="${escapeHtml(href)}" href="${escapeHtml(href)}"${extra}>${body}</a>`;
  const libraryItems = HOME_LIBRARY_DISCOVERY.map((item) => {
    const params = new URLSearchParams();
    if (item.patch.kind) params.set('kind', item.patch.kind);
    for (const tag of item.patch.tags || []) params.append('tag', tag);
    return `<li>${link(`#/library?${params.toString()}`, 'home-library__item', `<span class="home-library__question">${escapeHtml(item.question)}</span><span class="home-library__label">${escapeHtml(item.label)}</span><span class="home-library__description">${escapeHtml(item.description)}</span><span class="home-library__count">${item.count.toLocaleString('en-US')} records ${arrow}</span>`)}</li>`;
  }).join('');
  const tools = HOME_TOOLS.map((tool) => `<li>${link(tool.href, 'home-tool', `<strong class="home-tool__label">${escapeHtml(tool.label)}</strong><span class="home-tool__description">${escapeHtml(tool.description)}</span><span class="home-tool__action">${escapeHtml(tool.action)} ${arrow}</span>`)}</li>`).join('');
  const topics = homeSurface.topics.map((topic) => `<li>${link(topic.href, 'home-topics__link', escapeHtml(topic.label), topic.expansion ? ` title="${escapeHtml(topic.expansion)}"` : '')}</li>`).join('');
  const { changes, recent } = homeSurface.pulse;
  const pulseBody = changes.length
    ? `<ol class="home-pulse__list">${changes.map((change) => `<li class="home-pulse__change"><time datetime="${change.date}">${escapeHtml(change.dateLabel)}</time><strong>${escapeHtml(change.title)}</strong>${change.fact ? `<p>${escapeHtml(change.fact)}</p>` : ''}${link(change.href, 'home-pulse__open', `${escapeHtml(change.linkLabel)} ${arrow}`)}</li>`).join('')}</ol>`
    : `<p class="home-pulse__quiet">${escapeHtml(HOME_CONTENT.pulse.quiet)}</p>`;
  const pulseRow = recent
    ? link('#/sources', 'home-pulse-row', `<span class="home-pulse-row__label">${escapeHtml(HOME_CONTENT.pulse.compactLabel)}</span><span class="home-pulse-row__text">${recent.count} ${recent.count === 1 ? 'publication' : 'publications'} · <time datetime="${recent.date}">${escapeHtml(recent.dateLabel)}</time></span>${arrow}`)
    : '';
  const coverFreshness = formatBuildDate(globalThis.process.env.VITE_CONTROL_ATLAS_SOURCE_DATA_DATE);
  // Depth-0 Signal cover, part of the static first paint (React does not boot on
  // Home). Hidden by default so no-JS users see the Home underneath; main.tsx
  // reveals it, gates it to once per session, and wires dismissal.
  const cover = SITE_COPY.home.cover;
  const coverMeta = [
    `<div><span>Records</span><strong>${escapeHtml(atlasScopeMetrics.compact.records)}</strong></div>`,
    `<div><span>Connections</span><strong>${escapeHtml(atlasScopeMetrics.compact.connections)}</strong></div>`,
    `<div><span>Publications</span><strong>${escapeHtml(atlasScopeMetrics.compact.publications)}</strong></div>`,
    `<div><span>${escapeHtml(cover.freshnessLabel)}</span><strong>${escapeHtml(coverFreshness)}</strong></div>`,
  ].join('');
  // Orbital landing recipe: editorial split (copy + archival metadata aside)
  // over a plotted flight plan, closed by a calibration rail. The geometry is
  // decorative, so it stays aria-hidden and outside the reading corridor.
  const coverFlightPlan = `<svg class="signal-cover__flightplan" viewBox="0 0 760 430" aria-hidden="true" focusable="false"><g fill="none" stroke-linecap="round"><path d="M32 392C182 144 422 58 752 146" stroke="var(--lsm-grid-line)" opacity=".52"/><path d="M80 420C252 238 482 186 746 232" stroke="var(--lsm-gold)" opacity=".6"/><path d="M180 440C340 326 536 294 728 318" stroke="var(--lsm-gold)" stroke-dasharray="8 10" opacity=".44"/><path d="M476 306C572 260 650 248 734 252" stroke="var(--lsm-orange)" opacity=".56"/><circle cx="540" cy="214" r="7" stroke="var(--lsm-grid-line)"/><path d="M540 194v40M520 214h40" stroke="var(--lsm-dust)" opacity=".3"/></g><circle cx="540" cy="214" r="3" fill="var(--lsm-bone)"/><circle cx="670" cy="258" r="5" fill="var(--lsm-orange)"/></svg>`;
  const signalCover = `<div class="signal-cover" data-signal-cover hidden role="dialog" aria-modal="true" aria-label="Control Atlas introduction"><section class="signal-cover__hero">${coverFlightPlan}<div class="signal-cover__copy"><p class="signal-cover__eyebrow">${escapeHtml(cover.eyebrow)}</p><h1 class="signal-cover__headline">${escapeHtml(cover.headlineLead)}<br><span class="signal-cover__signal-word">${escapeHtml(cover.headlineSignal)}</span></h1><p class="signal-cover__lead">${escapeHtml(cover.lead)}</p><p class="signal-cover__actions"><button class="signal-cover__action" data-signal-cover-enter type="button">${escapeHtml(cover.action)}</button></p></div><aside class="signal-cover__meta"><p aria-hidden="true" class="signal-cover__brand-signature"><span>Ctrl</span><b>+</b><span>Alt</span><b>+</b><span class="signal-cover__brand-signal"><i>${escapeHtml(longestBrandSignal)}</i><strong data-signal-cover-word>${escapeHtml(atlasBrandSignals[0].label)}</strong></span></p><span class="signal-cover__meta-title">${escapeHtml(cover.metaTitle)}</span>${coverMeta}</aside></section><div class="signal-cover__rail"><span>${escapeHtml(cover.railLeft)}</span><span class="signal-cover__prompt">${escapeHtml(cover.prompt)}</span></div></div>`;
  const atlas = HOME_CONTENT.atlas;
  const library = HOME_CONTENT.library;
  return `${signalCover}<section class="home-entry" aria-labelledby="home-title" data-template="B" data-visual-identity="universal-front-door">
    <div class="home-hero">
      <div class="home-wrap home-hero__grid">
        <div class="home-hero__identity">
          <h1 id="home-title">${escapeHtml(HOME_CONTENT.headline)}</h1>
          <p class="home-lead">${escapeHtml(HOME_CONTENT.lead)}</p>
          <form class="home-search" data-home-search role="search">
            <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="20"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
            <input aria-label="Search Control Atlas" name="query" placeholder="${escapeHtml(HOME_CONTENT.searchPlaceholder)}" type="search">
            <button class="home-search-submit" type="submit">Search</button>
          </form>
          <p class="home-metrics">${escapeHtml(homeMetrics)}</p>
        </div>
        <div class="home-atlas">
          ${link('#/atlas', 'home-map', renderHomeMap(), ' aria-hidden="true" tabindex="-1"')}
          <div class="home-atlas__caption">
            <p class="home-eyebrow">${escapeHtml(atlas.eyebrow)}</p>
            <h2 class="home-atlas__heading">${escapeHtml(atlas.heading)}</h2>
            <div class="home-atlas__actions">
              ${link('#/atlas', 'home-atlas__open', `${escapeHtml(atlas.action)} ${arrow}`)}
              <details class="home-topics" data-home-topics>
                <summary>${escapeHtml(homeSurface.topicsHint)} <span aria-hidden="true">▾</span></summary>
                <nav aria-label="${escapeHtml(atlas.topicsLabel)}" class="home-topics__panel"><ul>${topics}</ul></nav>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
    <nav aria-label="Tools" class="home-tools"><ul class="home-wrap">${tools}</ul></nav>
    <section aria-labelledby="home-library-heading" class="home-library">
      <div class="home-wrap">
        <div class="home-library__main">
          <div class="home-library__head"><div><p class="home-eyebrow">${escapeHtml(library.eyebrow)}</p><h2 id="home-library-heading">${escapeHtml(library.heading)}</h2><p>${escapeHtml(library.lead)}</p></div>${link('#/library', 'home-library__all', `${escapeHtml(library.all)} ${arrow}`)}</div>
          <ul class="home-library__list">${libraryItems}</ul>
          ${pulseRow}
        </div>
        <aside aria-labelledby="home-pulse-heading" class="home-pulse">
          <h2 id="home-pulse-heading">${escapeHtml(HOME_CONTENT.pulse.heading)}</h2>
          ${pulseBody}
          ${link('#/sources', 'home-pulse__all', `${escapeHtml(HOME_CONTENT.pulse.all)} ${arrow}`)}
        </aside>
      </div>
    </section>
  </section>`;
}

function getBuildSha(): string {
  if (globalThis.process.env.VITE_CONTROL_ATLAS_BUILD_SHA) {
    return globalThis.process.env.VITE_CONTROL_ATLAS_BUILD_SHA;
  }
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'development';
  }
}

export default defineConfig({
  base: './',
  root: resolve(rootDir, 'src'),
  define: {
    'globalThis.__ATLAS_BRAND_SIGNALS__': JSON.stringify(atlasBrandSignals),
    'globalThis.__ATLAS_SCOPE_METRICS__': JSON.stringify(atlasScopeMetrics),
    'globalThis.__HOME_SURFACE__': JSON.stringify(homeSurface),
  },
  plugins: [
    orbitalFontAssetsPlugin(rootDir),
    {
      name: 'control-atlas-record-startup-hints',
      apply: 'build',
      buildStart() {
        for (const entry of RECORD_STARTUP_ENTRIES) {
          this.emitFile({
            type: 'chunk', id: resolve(rootDir, entry.module),
            name: `record-${entry.key}`, preserveSignature: 'strict',
          });
        }
      },
      transformIndexHtml: {
        order: 'post',
        handler(_html, context) {
          if (!context.bundle) return;
          return [{
            tag: 'script',
            attrs: { id: 'control-atlas-record-modules', type: 'application/json' },
            children: JSON.stringify(recordStartupHints(context.bundle)),
            injectTo: 'head',
          }];
        },
      },
    },
    {
      name: 'control-atlas-runtime-cache-version',
      transformIndexHtml(html) {
        const buildSha = getBuildSha();
        return {
          html: html
            .replace('<!-- CONTROL_ATLAS_HOME -->', renderStaticHome())
            .replace(
              '<!-- CONTROL_ATLAS_COPY -->',
              `<script id="control-atlas-copy" type="application/json">${JSON.stringify(FIRST_PAINT_ROUTE_COPY).replace(/</g, '\\u003c')}</script>`,
            )
            .replaceAll('CONTROL_ATLAS_PRODUCT_DESCRIPTION', escapeHtml(SITE_COPY.product.definition))
            .replaceAll('CONTROL_ATLAS_BRAND_SIGNAL_INITIAL', escapeHtml(atlasBrandSignals[0].label))
            .replaceAll('CONTROL_ATLAS_BRAND_SIGNAL_SIZER', escapeHtml(longestBrandSignal))
            .replaceAll('CONTROL_ATLAS_RELEASE_DATE', escapeHtml(formatBuildDate(globalThis.process.env.VITE_CONTROL_ATLAS_RELEASE_DATE)))
            .replaceAll('CONTROL_ATLAS_SOURCE_DATA_DATE', escapeHtml(formatBuildDate(globalThis.process.env.VITE_CONTROL_ATLAS_SOURCE_DATA_DATE)))
            .replaceAll('CONTROL_ATLAS_BUILD_SHA', escapeHtml(buildSha))
            .replaceAll('CONTROL_ATLAS_CACHE_VERSION', escapeHtml(RUNTIME_CACHE_VERSION)),
          tags: [
            {
              tag: 'meta',
              attrs: {
                name: 'control-atlas-runtime-cache-version',
                content: RUNTIME_CACHE_VERSION,
              },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {
                name: 'control-atlas-build-sha',
                content: buildSha,
              },
              injectTo: 'head',
            },
          ],
        };
      },
    },
    tailwindcss(),
    react(),
  ],
  build: {
    outDir: resolve(rootDir, 'dist/site'),
    emptyOutDir: globalThis.process.env.CONTROL_ATLAS_REUSE_STAGED_DATA !== '1',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
