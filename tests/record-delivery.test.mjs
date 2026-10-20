import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { startRoutePrefetch, takeRouteResponse } from '../src/shared/route-prefetch.mjs';
import { atlasNeighborhoodShardId, ATLAS_NEIGHBORHOOD_SHARD_COUNT } from '../src/app/atlas-neighborhood.mjs';
import { externalizeOrbitalFonts, HOME_SHELL_MODULES, ORBITAL_FONT_HASHES, orbitalFontPreloads, planInteractiveDelivery, recordChunkGroups, RECORD_UI_MODULES, verifyRecordDelivery } from '../tools/record-delivery.mjs';

const require = createRequire(import.meta.url);
const css = readFileSync(require.resolve('orbital-archive-no-01/fonts.css'), 'utf8');
const progressiveShell = readFileSync(new URL('../src/public/progressive-shell.js', import.meta.url), 'utf8');
const root = '/workspace/control-atlas';
const fontAssets = () => Object.fromEntries([...externalizeOrbitalFonts(css).fonts].map(([digest, bytes]) => [
  `${digest}.woff2`, { type: 'asset', fileName: `${digest}.woff2`, source: bytes },
]));
const chunk = (fileName, modules, imports = []) => ({ type: 'chunk', fileName, name: fileName.replace(/\.js$/, ''), imports,
  code: 'export {};', isEntry: fileName === 'main.js',
  modules: Object.fromEntries(modules.map(id => [`${root}/${id}`, {}])) });
const bundle = () => ({
  'main.js': chunk('main.js', ['src/main.tsx']),
  'loader.js': chunk('loader.js', ['src/ui/lib/runtimeLoader.ts']),
  'record.js': chunk('record.js', ['src/ui/pages/ObjectDetailPage.tsx'], ['record-ui.js']),
  'compare.js': chunk('compare.js', ['src/ui/pages/ComparePage.tsx']),
  'record-ui.js': chunk('record-ui.js', ['src/ui/components/AppLink.tsx']),
  ...fontAssets(),
});

test('head delivery configures the parsed route shell before deferred modules, without waiting for DOMContentLoaded', () => {
  for (const hash of ['#/resources', '#/record/nist-800-53/AC-2', '#/']) {
    const listeners = new Map();
    const nodes = new Map();
    const element = () => ({ dataset: {}, hidden: false, textContent: '',
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, element());
        return nodes.get(selector);
      },
      toggleAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { this[name] = false; },
      remove() { this.removed = true; },
    });
    const root = element();
    let parsed = false;
    const document = {
      readyState: 'loading',
      getElementById: id => id === 'root' && parsed ? root : null,
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: name => listeners.delete(name),
    };
    runInNewContext(progressiveShell, { document, window: { location: { hash, origin: 'https://example.test' } }, URL, URLSearchParams });
    assert.equal(root.dataset.staticRouteKind, undefined);
    assert.deepEqual([...listeners.keys()], ['readystatechange']);
    listeners.get('readystatechange')();
    assert.equal(listeners.size, 1, 'loading events must not consume the initialization');
    parsed = true;
    document.readyState = 'interactive';
    listeners.get('readystatechange')();
    assert.equal(listeners.size, 0, 'the parser listener is removed after one initialization');
    if (hash === '#/') {
      assert.equal(nodes.get('[data-static-route]').removed, true);
      assert.equal(nodes.get('[data-static-search]').removed, true);
    } else {
      assert.equal(root.dataset.staticRouteKind, hash === '#/resources' ? 'resources' : 'record');
      assert.equal(nodes.get('[data-static-route-title]').textContent, hash === '#/resources' ? 'Resources' : 'AC-2');
      assert.equal(nodes.get('[data-static-resource-companions]').hidden, hash !== '#/resources');
    }
  }
});

test('resolved static graph batches interactive code while preserving Home, warm-up and lazy page boundaries', () => {
  const id = path => `${root}/${path}`;
  const imports = new Map([
    [id('src/main.tsx'), [id('src/shared/navigation-events.ts')]],
    [id('src/ui/App.tsx'), [id('src/shared/navigation-events.ts'), id('src/ui/lib/hashRoutes.ts'), id('src/ui/components/TopNav.tsx'), id('src/ui/lib/recordRouteModule.ts')]],
    [id('src/ui/lib/runtimeLoader.ts'), [id('src/app/runtime.mjs')]],
    [id('src/ui/lib/hashRoutes.ts'), [id('src/shared/navigation-events.ts')]],
    [id('src/ui/pages/ObjectDetailPage.tsx'), [id('node_modules/@tabler/icons-react/dist/esm/icons/IconBook2.mjs'), id('src/ui/components/RecordPublishedText.tsx')]],
    [id('src/ui/components/RecordPublishedText.tsx'), [id('src/ui/lib/publisherName.ts')]],
    [id('src/ui/pages/CommonsPage.tsx'), [id('src/ui/lib/commonsPresentation.ts'), id('src/ui/lib/publisherName.ts')]],
    [id('node_modules/react-dom/client.js'), [id('node_modules/react/index.js')]],
    [id('node_modules/@tabler/icons-react/dist/esm/icons/IconBook2.mjs'), [id('node_modules/react/index.js')]],
  ]);
  const ids = new Set([...imports.keys(), ...[...imports.values()].flat()]);
  const plan = planInteractiveDelivery(ids, key => ({ importedIds: imports.get(key) ?? [] }), root);
  const groups = recordChunkGroups(root, plan);
  const shell = groups.find(group => group.name === 'interactive-shell');
  const warmup = groups.find(group => group.name === 'data-warmup');
  const recordUi = groups.find(group => group.name === 'record-ui');
  const resourcesUi = groups.find(group => group.name === 'resources-ui');
  for (const path of ['src/ui/components/RecordPublishedText.tsx', 'src/ui/lib/publisherName.ts']) {
    assert.equal(recordUi.test(id(path)), true, path);
    assert.equal(resourcesUi.test(id(path)), false, 'shared support has one owner');
  }
  assert.equal(resourcesUi.test(id('src/ui/lib/commonsPresentation.ts')), true);
  for (const group of [recordUi, resourcesUi]) {
    for (const path of ['src/main.tsx', 'src/ui/App.tsx', 'src/ui/lib/runtimeLoader.ts', 'src/ui/lib/recordRouteModule.ts', 'src/ui/pages/ObjectDetailPage.tsx', 'src/ui/pages/CommonsPage.tsx', 'node_modules/react/index.js']) {
      assert.equal(group.test(id(path)), false, path);
    }
  }
  for (const path of ['src/ui/App.tsx', 'src/ui/components/TopNav.tsx', 'node_modules/@tabler/icons-react/dist/esm/icons/IconBook2.mjs']) assert.equal(shell.test(id(path)), true, path);
  assert.equal(groups.some(group => group.name === 'renderer'), false);
  for (const path of ['node_modules/react-dom/client.js', 'node_modules/react/index.js']) {
    assert.equal(shell.test(id(path)), true, path);
  }
  for (const path of ['src/main.tsx', 'src/shared/navigation-events.ts', 'src/ui/lib/runtimeLoader.ts', 'src/ui/lib/hashRoutes.ts', 'src/ui/lib/recordRouteModule.ts', 'src/ui/pages/ObjectDetailPage.tsx', 'src/ui/pages/ComparePage.tsx']) assert.equal(shell.test(id(path)), false, path);
  assert.equal(warmup.test(id('src/ui/lib/runtimeLoader.ts')), true);
  assert.equal(warmup.test(id('src/app/runtime.mjs')), true);
  assert.equal(warmup.test(id('src/shared/navigation-events.ts')), false);
  assert.equal(warmup.test(id('node_modules/react/index.js')), false);
  assert.throws(() => planInteractiveDelivery([], () => null, root), /missing/);
});

test('first-paint font hints reference only the exact emitted normal-face bytes', () => {
  const tags = orbitalFontPreloads(fontAssets());
  assert.equal(tags.length, 1);
  assert.ok(tags.every(tag => tag.attrs.rel === 'preload' && tag.attrs.as === 'font' && tag.attrs.crossorigin === 'anonymous'));
  assert.deepEqual(tags.map(tag => tag.attrs.href), [ORBITAL_FONT_HASHES[0]].map(digest => `./${digest}.woff2`));
  assert.throws(() => orbitalFontPreloads({}), /missing/);
});

test('early route requests reuse exact cached responses and preserve Home and mirror paths', async () => {
  const config = { modules: ['assets/data-warmup.js', 'assets/interactive-shell.js'], routeModules: { record: ['assets/record.js', 'assets/interactive-shell.js'], resources: ['assets/resources.js'] }, version: 'fixture', shardCount: ATLAS_NEIGHBORHOOD_SHARD_COUNT };
  const links = [], requests = [];
  const environment = { location: { hash: '#/' }, document: {
    currentScript: { src: 'https://example.test/control-atlas/progressive-shell-delivery.js' },
    createElement: () => ({}), head: { appendChild: link => links.push(link) },
  }, fetch: async url => { requests.push(url); return new Response('fixture'); } };
  startRoutePrefetch(config, environment);
  assert.equal(links.length, 0);
  assert.equal(requests.length, 0);
  environment.location.hash = '#/record/nist-800-53/AC-2';
  startRoutePrefetch(config, environment);
  assert.deepEqual(requests, [
    'https://example.test/control-atlas/data/generated/catalog-bootstrap.json.gz?v=fixture',
    `https://example.test/control-atlas/data/generated/atlas-neighborhood/${atlasNeighborhoodShardId('nist-800-53:AC-2')}.json.gz?v=fixture`,
  ]);
  assert.ok(links.every(link => link.rel === 'modulepreload' && link.crossOrigin === 'anonymous'));
  assert.equal(links.length, 3, 'the selected route closure is hinted without duplicate shared modules');
  assert.equal(links.at(-1).href, 'https://example.test/control-atlas/assets/record.js');
  const responses = [...environment.__ATLAS_ROUTE_PREFETCH__.values()];
  startRoutePrefetch(config, environment);
  assert.equal(requests.length, 2);
  assert.equal(await (await responses[0]).text(), 'fixture');
  environment.location.hash = '#/resources';
  startRoutePrefetch(config, environment);
  assert.equal(links.at(-1).href, 'https://example.test/control-atlas/assets/resources.js');
  assert.equal(requests.at(-1), 'https://example.test/control-atlas/data/generated/commons-search-index.json.gz');
  await Promise.all(environment.__ATLAS_ROUTE_PREFETCH__.values());
  environment.location.hash = '#/record/%invalid/AC-2';
  startRoutePrefetch(config, environment);
  assert.equal(requests.length, 3);
});

test('early responses retain the consuming loader deadline after their headers resolve', async () => {
  let aborts = 0;
  let failBody;
  const body = new ReadableStream({ start(controller) { failBody = () => controller.error(new Error('body aborted')); } });
  const response = Object.assign(Promise.resolve(new Response(body)), { abort: () => { aborts += 1; failBody(); } });
  const pending = new Map([['fixture', response]]);
  const controller = new AbortController();
  assert.equal(takeRouteResponse(pending, 'missing', controller.signal), null);
  assert.equal(takeRouteResponse(pending, 'fixture', controller.signal), response);
  assert.equal(pending.size, 0);
  const reading = (await response).text();
  controller.abort();
  await assert.rejects(reading, /body aborted/);
  assert.equal(aborts, 1);
  const expired = new AbortController();
  expired.abort();
  let expiredAborts = 0;
  const already = Object.assign(Promise.resolve(new Response('fixture')), { abort: () => { expiredAborts += 1; } });
  takeRouteResponse(new Map([['fixture', already]]), 'fixture', expired.signal);
  assert.equal(expiredAborts, 1);
});

test('finite groups coalesce shared record UI and exact icons without capturing dependencies', () => {
  const groups = recordChunkGroups(root);
  const ui = groups.find(group => group.name === 'record-ui');
  const icons = groups.find(group => group.name === 'record-icons');
  assert.ok(RECORD_UI_MODULES.every(path => ui.test(`${root}/${path}`)));
  assert.equal(ui.test(`${root}/src/ui/lib/taxonomyContext.ts`), true);
  assert.equal(icons.test(`${root}/node_modules/@tabler/icons-react/dist/esm/icons/IconBook2.mjs`), true);
  for (const path of [
    'src/main.tsx', 'src/ui/App.tsx', 'src/ui/lib/runtimeLoader.ts', 'src/ui/lib/recordRouteModule.ts',
    'src/app/runtime.mjs', 'src/shared/record-control-context.mjs',
    'src/ui/pages/ObjectDetailPage.tsx', 'src/ui/pages/ComparePage.tsx', 'src/ui/pages/TemplatesPage.tsx',
    'src/ui/lib/compareExport.ts', 'node_modules/react/index.js',
    'node_modules/@tabler/icons-react/dist/esm/createReactComponent.mjs',
    'node_modules/@tabler/icons-react/dist/esm/icons/IconHome.mjs',
    'node_modules/@xyflow/react/dist/esm/index.js',
  ]) {
    for (const group of [ui, icons]) assert.equal(group.test(`${root}/${path}`), false, path);
  }
  for (const group of [ui, icons]) {
    assert.equal(group.includeDependenciesRecursively, false);
    assert.equal(group.entriesAware, false);
    assert.equal(group.minShareCount, 1);
  }
  const windowsGroups = recordChunkGroups('C:\\work\\control-atlas');
  const windowsUi = windowsGroups.find(group => group.name === 'record-ui');
  const windowsIcons = windowsGroups.find(group => group.name === 'record-icons');
  assert.equal(windowsUi.test('C:\\work\\control-atlas\\src\\ui\\components\\AppLink.tsx'), true);
  assert.equal(windowsUi.test('C:\\work\\control-atlas\\src\\shared\\record-control-context.mjs'), false);
  assert.equal(windowsIcons.test('C:\\work\\control-atlas\\node_modules\\@tabler\\icons-react\\dist\\esm\\icons\\IconBook2.mjs'), true);
});

test('font delivery changes only URLs and preserves all five declarations and exact pinned bytes', () => {
  const result = externalizeOrbitalFonts(css);
  assert.equal(result.fonts.size, 4);
  assert.equal((result.css.match(/@font-face/g) || []).length, 5);
  assert.equal((result.css.match(/font-display:swap/g) || []).length, 5);
  const originalDeclarations = css.replace(/url\([^)]*\)/g, 'url(FONT)');
  const deliveredDeclarations = result.css.replace(/url\([^)]*\)/g, 'url(FONT)');
  assert.equal(deliveredDeclarations, originalDeclarations);
  const declared = [...result.css.matchAll(/\.\/([a-f0-9]{64})\.woff2\?no-inline/g)].map(match => match[1]);
  assert.deepEqual(declared, ORBITAL_FONT_HASHES);
  for (const [digest, bytes] of result.fonts) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2');
  }
  assert.throws(() => externalizeOrbitalFonts(css.replace(/base64,./, 'base64,!')), /changed/);
  assert.throws(() => externalizeOrbitalFonts(`${css}\n@font-face{src:url(data:font/woff2;base64,d09GMg==);}`), /changed/);
});

test('Home group contains only its finite non-React shell closure', () => {
  const home = recordChunkGroups(root).find(group => group.name === 'home-shell');
  assert.ok(HOME_SHELL_MODULES.every(path => home.test(`${root}/${path}`)));
  assert.equal(home.test('\0vite/preload-helper.js'), true);
  for (const path of [
    'src/main.tsx', 'src/ui/App.tsx', 'src/ui/pages/HomePage.tsx', 'src/ui/pages/ObjectDetailPage.tsx',
    'src/ui/lib/runtimeLoader.ts', 'src/app/runtime.mjs', 'node_modules/react/index.js',
    ...RECORD_UI_MODULES,
  ]) assert.equal(home.test(`${root}/${path}`), false, path);
  assert.equal(home.includeDependenciesRecursively, false);
  assert.equal(home.entriesAware, false);
  assert.equal(home.minShareCount, 1);
});

test('Home emitted entry budget counts a facade and every shared module', () => {
  const current = bundle();
  current['main.js'].isEntry = false;
  current['entry.js'] = { ...chunk('entry.js', [], ['main.js']), isEntry: true };
  current['main.js'].imports.push('runtime.js');
  current['runtime.js'] = chunk('runtime.js', []);
  assert.equal(verifyRecordDelivery(current, root).homeEntryClosures[0].chunks.length, 3);
  current['main.js'].imports.push('presentation.js');
  current['presentation.js'] = chunk('presentation.js', ['src/shared/atlas-presentation.ts']);
  assert.throws(() => verifyRecordDelivery(current, root), /Home entry exceeds three module scripts/);
});

test('emitted graph rejects UI in Home or data warm-up, merged pages, and changed font bytes', () => {
  const valid = bundle();
  const report = verifyRecordDelivery(valid, root);
  assert.equal(report.pages.length, 2);
  assert.equal(report.fontHashes.length, 4);
  assert.deepEqual(report.homeEntryClosures[0], { entry: 'main.js', chunks: [{
    file: 'main.js', name: 'main', bytes: 10, imports: [], modules: ['src/main.tsx'],
  }] });
  const facade = bundle();
  facade['main.js'].isEntry = false;
  facade['entry.js'] = { ...chunk('entry.js', [], ['main.js']), isEntry: true };
  assert.deepEqual(verifyRecordDelivery(facade, root).homeEntryClosures[0].chunks.map(entry => entry.file), ['entry.js', 'main.js']);
  facade['entry.js'].imports.push('react.js');
  facade['react.js'] = chunk('react.js', ['node_modules/react/index.js']);
  assert.throws(() => verifyRecordDelivery(facade, root), /Home entry statically imports route UI or React/);
  for (const name of ['main.js', 'loader.js']) {
    const contaminated = bundle();
    contaminated[name].imports.push('record-ui.js');
    assert.throws(() => verifyRecordDelivery(contaminated, root), /statically imports route UI/);
    const react = bundle();
    react[name].imports.push('react.js');
    react['react.js'] = chunk('react.js', ['node_modules/react/index.js']);
    assert.throws(() => verifyRecordDelivery(react, root), /statically imports route UI/);
  }
  const merged = bundle();
  merged['record.js'].modules[`${root}/src/ui/pages/ComparePage.tsx`] = {};
  delete merged['compare.js'];
  assert.throws(() => verifyRecordDelivery(merged, root), /Page entries were coalesced/);
  const changed = bundle();
  delete changed[`${ORBITAL_FONT_HASHES[0]}.woff2`];
  assert.throws(() => verifyRecordDelivery(changed, root), /font asset was omitted/);
});

test('existing data preloader is queued before the record route import and every budget stays strict', () => {
  const main = readFileSync('src/main.tsx', 'utf8');
  const warm = main.slice(main.indexOf('function warmInteractiveRoute()'), main.indexOf('async function start()'));
  assert.ok(warm.indexOf("import('./ui/lib/runtimeLoader')") < warm.indexOf('recordRouteModule.load()'));
  assert.match(warm, /const dataModules = Promise\.all/);
  assert.ok(warm.indexOf("import('./ui/lib/runtimeLoader')") < warm.indexOf('void loadReactModules()'));
  assert.ok(warm.indexOf('void loadReactModules()') < warm.indexOf('preloader = await dataModules'));
  assert.match(warm, /void runtime\.preloadRuntimeArtifacts/);
  assert.doesNotMatch(warm, /await runtime\.preloadRuntimeArtifacts/);
  assert.doesNotMatch(main, /import \{ recordRouteModule \} from/);
  assert.match(main, /await warmInteractiveRoute\(\);[\s\S]*void bootReactApp\(\);/);
  const config = JSON.parse(readFileSync('.lighthouserc.ci.json', 'utf8'));
  assert.equal(config.ci.collect.numberOfRuns, 1);
  assert.equal(config.ci.collect.url.length, 3);
  assert.deepEqual(config.ci.assert.assertions['largest-contentful-paint'], ['error', { maxNumericValue: 2500 }]);
  assert.deepEqual(config.ci.assert.assertions['cumulative-layout-shift'], ['error', { maxNumericValue: 0.1 }]);
});
