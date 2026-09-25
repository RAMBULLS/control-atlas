import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { RUNTIME_CACHE_VERSION } from './src/shared/runtime-cache-version.mjs';
import { HOME_CONTENT, HOME_DESTINATIONS } from './src/shared/home-content.mjs';
import { FIRST_PAINT_ROUTE_COPY, SITE_COPY } from './src/shared/site-copy.mjs';
import {
  buildAtlasBrandSignals,
  countLibraryTaxonomyTags,
  deriveAtlasScopeMetrics,
} from './src/shared/brand-signals.mjs';
import { HOME_LIBRARY_DISCOVERY } from './src/ui/lib/homeTagConstellation.ts';

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

function formatBuildDate(value: string | undefined) {
  return value ? DATE_FORMATTER.format(new Date(value)) : 'local development build';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function renderStaticHome() {
  const libraryDiscovery = HOME_LIBRARY_DISCOVERY.map((item) => {
    const params = new URLSearchParams();
    if (item.patch.kind) params.set('kind', item.patch.kind);
    for (const tag of item.patch.tags || []) params.append('tag', tag);
    const href = `#/library?${params.toString()}`;
    // Must match HomePage.tsx exactly: any difference here is a visible swap
    // when React takes over the pre-rendered shell.
    return `<li><a class="home-library-kpi" data-route="${href}" href="${href}"><span class="home-library-kpi__question">${escapeHtml(item.question)}</span><strong class="home-library-kpi__label">${escapeHtml(item.label)}</strong><small class="home-library-kpi__description">${escapeHtml(item.description)}</small><span class="home-library-kpi__footer"><span class="home-library-kpi__count">${item.count.toLocaleString('en-US')} records</span><span aria-hidden="true">→</span></span></a></li>`;
  }).join('');
  const destinations = HOME_DESTINATIONS.map((destination) => `
    <a class="home-secondary-action" data-route="${destination.href}" href="${destination.href}">
      <span><strong>${escapeHtml(destination.label)}</strong><small>${escapeHtml(destination.description)}</small></span>
      <span aria-hidden="true" class="home-secondary-arrow">→</span>
    </a>`).join('');
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
  return `${signalCover}<section class="home-entry" aria-labelledby="home-title" data-template="B" data-visual-identity="universal-front-door">
    <div class="home-hero">
      <div class="home-hero-lead">
        <header class="home-entry-header">
          <h1 id="home-title">${escapeHtml(HOME_CONTENT.headline)}</h1>
          <p class="home-product-identity">${escapeHtml(HOME_CONTENT.definition)}</p>
          <p class="home-breadth">${escapeHtml(HOME_CONTENT.breadth)}</p>
        </header>
        <form class="home-search" data-home-search role="search">
          <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="20"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
          <input aria-label="Search Control Atlas" name="query" placeholder="${escapeHtml(HOME_CONTENT.searchPlaceholder)}" type="search">
          <button class="home-search-submit" type="submit">Search</button>
        </form>
        <p class="atlas-scope-strip">${escapeHtml(atlasScopeMetrics.compact.records)} searchable records <span aria-hidden="true">·</span> ${escapeHtml(atlasScopeMetrics.compact.connections)} connections <span aria-hidden="true">·</span> ${escapeHtml(atlasScopeMetrics.compact.publications)} source publications</p>
      </div>
    </div>
    <nav aria-label="Choose a Control Atlas destination" class="home-secondary-grid">${destinations}</nav>
    <nav aria-labelledby="home-library-heading" class="home-library-discovery">
      <div class="home-library-discovery__heading"><div><p class="eyebrow">BROWSE THE LIBRARY</p><h2 id="home-library-heading">Start with what you came to find.</h2></div><a class="home-library-discovery__all" data-route="#/library" href="#/library">Browse everything <span aria-hidden="true">→</span></a></div>
      <ul class="home-library-kpis">${libraryDiscovery}</ul>
    </nav>
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
  },
  plugins: [
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
