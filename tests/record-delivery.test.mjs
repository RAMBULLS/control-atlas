import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { startRoutePrefetch, takeRouteResponse, waitForStaticRoutePaint, warmOrbitalFonts } from '../src/shared/route-prefetch.mjs';
import { recordBootstrapSources } from '../src/shared/record-source-bootstrap.mjs';
import { decompressArtifactResponse } from '../src/shared/gzip-response.mjs';
import { buildRouteChoices } from '../src/shared/build-route-choices.mjs';
import { atlasNeighborhoodShardId, ATLAS_NEIGHBORHOOD_SHARD_COUNT } from '../src/app/atlas-neighborhood.mjs';
import { externalizeOrbitalFonts, inlineArrivalDelivery, inlineOrbitalFontStyles, HOME_SHELL_MODULES, ORBITAL_FONT_HASHES, planInteractiveDelivery, recordChunkGroups, RECORD_UI_MODULES, verifyRecordDelivery } from '../tools/record-delivery.mjs';

const require = createRequire(import.meta.url);
const css = readFileSync(require.resolve('orbital-archive-no-01/fonts.css'), 'utf8');
const progressiveShell = readFileSync(new URL('../src/public/progressive-shell.js', import.meta.url), 'utf8');
const root = '/workspace/control-atlas';

test('native and installed fallback gzip decoders retain complete artifact bytes', async () => {
  assert.equal(typeof DecompressionStream, 'function');
  const native = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  const bytes = Buffer.from(JSON.stringify({ fixture: ['Complete publisher text', { evidence: 'Exact reference', unknown: null }] }));
  try {
    for (const fallback of [false, true]) {
      if (fallback) Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: undefined });
      const response = await decompressArtifactResponse(new Response(new Uint8Array(gzipSync(bytes))));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
  } finally {
    if (native) Object.defineProperty(globalThis, 'DecompressionStream', native);
    else Reflect.deleteProperty(globalThis, 'DecompressionStream');
  }
});

test('installed fallback rejects unavailable gzip contents rather than inventing data', async () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  try {
    Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: undefined });
    await assert.rejects(decompressArtifactResponse(new Response(new Uint8Array([1, 2, 3]))));
  } finally {
    if (native) Object.defineProperty(globalThis, 'DecompressionStream', native);
    else Reflect.deleteProperty(globalThis, 'DecompressionStream');
  }
});
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
    [id('src/ui/lib/hashRoutes.ts'), [id('src/shared/navigation-events.ts'), id('data/template-registry.json'), id('data/compliance-workflows.json')]],
    [id('src/ui/pages/ObjectDetailPage.tsx'), [id('node_modules/@tabler/icons-react/dist/esm/icons/IconBook2.mjs'), id('src/ui/components/RecordPublishedText.tsx')]],
    [id('src/ui/components/RecordPublishedText.tsx'), [id('src/ui/lib/publisherName.ts')]],
    [id('src/ui/pages/CommonsPage.tsx'), [id('src/ui/lib/commonsPresentation.ts'), id('src/ui/lib/publisherName.ts')]],
    [id('node_modules/react-dom/client.js'), [id('node_modules/react/index.js')]],
    [id('node_modules/@tabler/icons-react/dist/esm/icons/IconBook2.mjs'), [id('node_modules/react/index.js')]],
  ]);
  const ids = new Set([...imports.keys(), ...[...imports.values()].flat()]);
  const plan = planInteractiveDelivery(ids, key => ({ importedIds: imports.get(key) ?? [] }), root);
  // Exercise the real Vite hook without running a site build. A correct helper
  // plan is insufficient if the configuration drops a new cohort on the floor.
  const config = ts.createSourceFile('vite.config.ts', readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let initializer;
  let hook;
  const visit = node => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(config) === 'interactiveDelivery')) initializer = node;
    if (ts.isMethodDeclaration(node) && node.name.getText(config) === 'buildEnd') hook = node;
    ts.forEachChild(node, visit);
  };
  visit(config);
  assert.ok(initializer && hook, 'the actual Vite delivery initializer and hook must exist');
  const context = { rootDir: root, planInteractiveDelivery, result: null,
    graph: { getModuleIds: () => ids.values(), getModuleInfo: key => ({ importedIds: imports.get(key) ?? [] }) } };
  const code = `${initializer.getText(config)}\n(function (${hook.parameters.map(parameter => parameter.getText(config)).join(', ')}) ${hook.body.getText(config)}).call(graph);\nresult = interactiveDelivery;`;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  for (const key of ['interactive', 'warmup', 'renderer', 'recordSupport', 'resourceSupport']) {
    assert.ok(context.result[key] instanceof Set || context.result[key]?.[Symbol.iterator], key);
    assert.deepEqual([...context.result[key]], [...plan[key]], `Vite must retain the resolved ${key} cohort`);
  }
  const groups = recordChunkGroups(root, plan);
  const shell = groups.find(group => group.name === 'interactive-shell');
  const warmup = groups.find(group => group.name === 'data-warmup');
  const renderer = groups.find(group => group.name === 'renderer');
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
  for (const path of ['node_modules/react-dom/client.js', 'node_modules/react/index.js']) {
    assert.equal(shell.test(id(path)), false, path);
    assert.equal(renderer.test(id(path)), true, path);
  }
  for (const path of ['data/template-registry.json', 'data/compliance-workflows.json']) {
    for (const group of [warmup, shell, recordUi, resourcesUi]) assert.equal(group.test(id(path)), false, path);
  }
  for (const path of ['src/main.tsx', 'src/shared/navigation-events.ts', 'src/ui/lib/runtimeLoader.ts', 'src/ui/lib/hashRoutes.ts', 'src/ui/lib/recordRouteModule.ts', 'src/ui/pages/ObjectDetailPage.tsx', 'src/ui/pages/ComparePage.tsx']) assert.equal(shell.test(id(path)), false, path);
  assert.equal(warmup.test(id('src/ui/lib/runtimeLoader.ts')), true);
  assert.equal(warmup.test(id('src/app/runtime.mjs')), true);
  assert.equal(warmup.test(id('src/shared/navigation-events.ts')), false);
  assert.equal(warmup.test(id('node_modules/react/index.js')), false);
  assert.throws(() => planInteractiveDelivery([], () => null, root), /missing/);
});

test('first-paint fonts retain every declaration and warm their actual faces without new bytes', async () => {
  const external = externalizeOrbitalFonts(css);
  const html = inlineOrbitalFontStyles('<title>Control Atlas</title>', external.css);
  const inline = html.match(/<style data-orbital-fonts>([\s\S]*?)<\/style>/)[1];
  assert.equal(inline.replace(/\.\/fonts\/([a-f0-9]{64})\.woff2/g, './$1.woff2?no-inline'), external.css);
  assert.equal((inline.match(/@font-face/g) || []).length, 5);
  assert.throws(() => inlineOrbitalFontStyles('<title>Control Atlas</title>', '</style>'), /end tag/);
  assert.throws(() => inlineOrbitalFontStyles('<title>Control Atlas</title>', ''), /Incomplete/);
  const loads = [];
  warmOrbitalFonts({ fonts: { load: face => { loads.push(face); return face.startsWith('700') ? Promise.reject(new Error('fixture font retrieval failure')) : Promise.resolve([]); } } });
  warmOrbitalFonts({});
  await Promise.resolve();
  assert.deepEqual(loads, ['400 1em "IBM Plex Mono"', '600 1em "IBM Plex Mono"', '600 1em "Oswald"', '700 1em "Oswald"']);
});

test('actual Vite build hook emits exactly four pinned font assets and keeps dev emission off', () => {
  const config = ts.createSourceFile('vite.config.ts', readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let plugin;
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(config) === 'name' && property.initializer.getText(config) === "'record-delivery-boundaries'")) plugin = node;
    ts.forEachChild(node, visit);
  };
  visit(config);
  assert.ok(plugin);
  const method = name => plugin.properties.find(property => ts.isMethodDeclaration(property) && property.name.getText(config) === name);
  for (const command of ['build', 'serve']) {
    const emitted = [];
    const context = { command, orbitalFonts: externalizeOrbitalFonts(css), graph: { emitFile: file => emitted.push(file) }, result: null };
    const hook = method('buildStart');
    runInNewContext(ts.transpileModule(`(function() ${hook.body.getText(config)}).call(graph);`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    assert.equal(emitted.length, command === 'build' ? 4 : 0);
    for (const asset of emitted) assert.equal(asset.fileName, `fonts/${createHash('sha256').update(asset.source).digest('hex')}.woff2`);
    for (const name of ['resolveId', 'load']) {
      const hook = method(name);
      runInNewContext(`result = (function(id) ${hook.body.getText(config)})(${JSON.stringify('\0control-atlas-inline-fonts.css')});`, context);
      assert.equal(context.result, name === 'resolveId' ? '\0control-atlas-inline-fonts.css' : '');
    }
  }
});

test('inline delivery admits only its exact bytes and starts the renderer first on mirror record routes', async () => {
  const current = bundle();
  current['renderer.js'] = chunk('renderer.js', ['node_modules/react/index.js']);
  current['data-warmup.js'] = { ...current['loader.js'], fileName: 'data-warmup.js', name: 'data-warmup' };
  delete current['loader.js'];
  current['interactive-shell.js'] = chunk('interactive-shell.js', ['src/ui/App.tsx']);
  current['resources-detail.js'] = chunk('resources-detail.js', ['src/ui/pages/CommonsDetailPage.tsx']);
  const html = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'; style-src \'self\' \'unsafe-inline\';"><title>Control Atlas</title><script src="./progressive-shell.js"></script>';
  const shell = 'window.controlAtlasSyncFirstPaintShell = () => {};';
  const output = inlineArrivalDelivery(html, current, root, { version: 'fixture', shardCount: ATLAS_NEIGHBORHOOD_SHARD_COUNT }, shell);
  const source = output.match(/<script data-arrival-delivery>([\s\S]*?)<\/script>/)[1];
  const digest = createHash('sha256').update(source).digest('base64');
  assert.ok(output.includes(`'sha256-${digest}'`));
  assert.doesNotMatch(output.match(/script-src [^;]+;/)[0], /unsafe-inline/);
  assert.doesNotMatch(output, /src="\.\/progressive-shell/);
  assert.throws(() => inlineArrivalDelivery(html, current, root, { version: 'fixture', shardCount: 8 }, '</script>'), /end tag/);
  for (const hash of ['#/', '#/resources', '#/record/nist-800-53/AC-2']) {
    const links = [], requests = [], fonts = [];
    const document = { currentScript: { src: '' }, baseURI: 'https://example.test/mirror/',
      fonts: { load: face => { fonts.push(face); return Promise.resolve([]); } },
      createElement: () => ({}), head: { appendChild: link => links.push(link) }, addEventListener: () => {} };
    const environment = { document, location: { hash }, fetch: async url => { requests.push(url); return new Response('fixture'); } };
    runInNewContext(source, { ...environment, globalThis: environment, window: {}, URL, AbortController, setTimeout, clearTimeout });
    await Promise.resolve();
    if (hash.startsWith('#/record/')) {
      assert.equal(fonts.length, 0, 'record CSS chooses its actually used faces without forced weight requests');
      assert.equal(links[0].href, 'https://example.test/mirror/renderer.js');
      assert.ok(requests.every(url => url.startsWith('https://example.test/mirror/data/')));
    } else { assert.equal(links.length, 0); assert.equal(requests.length, 0); assert.equal(fonts.length, 4); }
  }
});

test('actual Vite HTML hook returns iterable tags and the bound pinned font and CSP source', () => {
  const config = ts.createSourceFile('vite.config.ts', readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let handler;
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(config) === 'name' && property.initializer.getText(config) === "'record-delivery-boundaries'")) {
      const transform = node.properties.find(property => property.name.getText(config) === 'transformIndexHtml');
      handler = transform.initializer.properties.find(property => property.name.getText(config) === 'handler');
    }
    ts.forEachChild(node, visit);
  };
  visit(config);
  assert.ok(handler);
  const current = bundle();
  current['renderer.js'] = chunk('renderer.js', ['node_modules/react/index.js']);
  current['data-warmup.js'] = { ...current['loader.js'], fileName: 'data-warmup.js', name: 'data-warmup' };
  delete current['loader.js'];
  current['interactive-shell.js'] = chunk('interactive-shell.js', ['src/ui/App.tsx']);
  current['resources-detail.js'] = chunk('resources-detail.js', ['src/ui/pages/CommonsDetailPage.tsx']);
  const environment = { result: null, inlineArrivalDelivery, inlineOrbitalFontStyles, rootDir: root,
    RUNTIME_CACHE_VERSION: 'fixture', ATLAS_NEIGHBORHOOD_SHARD_COUNT,
    orbitalFonts: externalizeOrbitalFonts(css), context: { bundle: current },
    html: '<meta http-equiv="Content-Security-Policy" content="script-src \'self\';"><title>Control Atlas</title>',
    resolve: (...parts) => parts.join('/'),
    readFileSync: path => { assert.equal(path, `${root}/src/public/progressive-shell.js`); return progressiveShell; } };
  const execute = () => runInNewContext(`result = (function(_html, context) ${handler.body.getText(config)})(html, context);`, environment);
  execute();
  assert.ok(Array.isArray(environment.result.tags));
  assert.deepEqual([...environment.result.tags], [], 'Vite iterates tags even when only HTML was changed');
  assert.match(environment.result.html, /<style data-orbital-fonts>/);
  assert.match(environment.result.html, /<script data-arrival-delivery>/);
  assert.match(environment.result.html, /document\.fonts\.load/);
  environment.context = {};
  execute();
  assert.deepEqual([...environment.result], [], 'development retains its ordinary stylesheet');
});

test('early route requests reuse exact cached responses and preserve Home and mirror paths', async () => {
  const config = { modules: ['assets/data-warmup.js', 'assets/interactive-shell.js'], routeModules: { record: ['assets/record.js', 'assets/interactive-shell.js'], 'resource-detail': ['assets/resource-detail.js'] }, version: 'fixture', shardCount: ATLAS_NEIGHBORHOOD_SHARD_COUNT };
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
    'https://example.test/control-atlas/data/generated/catalog-bootstrap-record.json.gz?v=fixture',
    `https://example.test/control-atlas/data/generated/atlas-neighborhood/${atlasNeighborhoodShardId('nist-800-53:AC-2')}.json.gz?v=fixture`,
  ]);
  assert.ok(links.every(link => link.rel === 'modulepreload' && link.crossOrigin === 'anonymous'));
  assert.equal(links.length, 3, 'the selected route closure is hinted without duplicate shared modules');
  assert.equal(links.at(-1).href, 'https://example.test/control-atlas/assets/record.js');
  const responses = [...environment.__ATLAS_ROUTE_PREFETCH__.values()];
  startRoutePrefetch(config, environment);
  assert.equal(requests.length, 2);
  assert.equal(await (await responses[0]).text(), 'fixture');
  const priorLinks = links.length;
  environment.location.hash = '#/resources';
  startRoutePrefetch(config, environment);
  assert.equal(links.length, priorLinks, 'directory enhancement cannot compete with its existing first-paint masthead');
  assert.equal(requests.length, 2);
  environment.location.hash = '#/resources/resource/fixture';
  startRoutePrefetch(config, environment);
  assert.equal(links.at(-1).href, 'https://example.test/control-atlas/assets/resource-detail.js');
  await Promise.all(environment.__ATLAS_ROUTE_PREFETCH__.values());
  environment.location.hash = '#/record/%invalid/AC-2';
  startRoutePrefetch(config, environment);
  assert.equal(requests.length, 2);
});

test('static directory enhancement yields frame opportunities and has a background-tab deadline', async () => {
  const frames = new Map(), timers = new Map();
  let nextId = 0;
  const environment = {
    requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (callback, timeout) => { assert.equal(timeout, 1_000); const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const advanceFrame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  let ready = false;
  const paint = waitForStaticRoutePaint(environment).then(() => { ready = true; });
  advanceFrame();
  await Promise.resolve();
  assert.equal(ready, false);
  advanceFrame();
  await paint;
  assert.equal(ready, true);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  const background = waitForStaticRoutePaint(environment);
  const finish = [...timers.values()][0];
  finish();
  await background;
  assert.equal(frames.size, 0, 'the deadline cancels suspended frame callbacks');
  assert.equal(timers.size, 0);
});

test('static enhancement observes real content paint, buffered paint and deadline cleanup', async () => {
  for (const mode of ['pending', 'buffered', 'deadline']) {
    const frames = new Map(), timers = new Map();
    let nextId = 0, notify, disconnected = 0;
    class PaintObserver {
      static supportedEntryTypes = ['paint'];
      constructor(callback) { notify = callback; }
      observe(options) { assert.deepEqual(options, { type: 'paint', buffered: true }); }
      disconnect() { disconnected += 1; }
    }
    const environment = { PerformanceObserver: PaintObserver,
      performance: { getEntriesByName: name => { assert.equal(name, 'first-contentful-paint'); return mode === 'buffered' ? [{}] : []; } },
      requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
      cancelAnimationFrame: id => frames.delete(id),
      setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) };
    const paint = waitForStaticRoutePaint(environment);
    if (mode === 'deadline') {
      [...timers.values()][0](); await paint;
      notify({ getEntries: () => [{ name: 'first-contentful-paint' }] });
      assert.equal(frames.size, 0, 'late paint cannot revive an expired observer');
    } else {
      if (mode === 'pending') {
        assert.equal(frames.size, 0);
        notify({ getEntries: () => [{ name: 'first-paint' }] }); assert.equal(frames.size, 0);
        notify({ getEntries: () => [{ name: 'first-contentful-paint' }] });
      }
      for (let index = 0; index < 2; index += 1) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); }
      await paint;
    }
    assert.equal(timers.size, 0);
    assert.equal(frames.size, 0);
    assert.ok(mode === 'buffered' ? disconnected === 0 : disconnected > 0);
  }
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

test('cohort source registration requires all actual references and exact global admission', () => {
  const sources = [{ id: 'one', title: 'Full selected publisher text' }, { id: 'two', title: 'Full related publisher text' }];
  const bootstrap = { record_bootstrap: 'catalog-bootstrap-record.json', record_source_delivery: 'neighborhood-v1', source_ids: ['one', 'two', 'unrelated'] };
  const cohort = { source_ids: ['one', 'two'], expected_source_ids: ['one', 'two'], sources };
  assert.equal(recordBootstrapSources(bootstrap, 'one', cohort), sources);
  assert.deepEqual(recordBootstrapSources(bootstrap, '', { source_ids: [], expected_source_ids: [], sources: [] }), []);
  for (const invalid of [
    undefined,
    { ...cohort, sources: sources.slice(0, 1) },
    { ...cohort, source_ids: ['one'], sources: sources.slice(0, 1) },
    { ...cohort, source_ids: ['one', 'one'] },
    { ...cohort, source_ids: ['one', 'unrelated'] },
    { ...cohort, expected_source_ids: ['one', 'one'] },
    { ...cohort, sources: [sources[0], { id: 'unadmitted' }] },
  ]) assert.throws(() => recordBootstrapSources(bootstrap, 'one', invalid), /Record bootstrap source register/);
  assert.throws(() => recordBootstrapSources({ ...bootstrap, source_ids: ['one'] }, 'one', cohort), /scope/);
  assert.throws(() => recordBootstrapSources({ ...bootstrap, record_source_delivery: 'unrecognized' }, 'one', cohort), /capability/);
  for (const invalid of [{ ...bootstrap, record_bootstrap: undefined }, { ...bootstrap, sources }, { ...bootstrap, source_records: {} }]) {
    assert.throws(() => recordBootstrapSources(invalid, 'one', cohort), /capability/);
  }
});

test('atomic record bootstrap preserves every complete admitted source and legacy absence', () => {
  const sources = [{ id: 'one', title: 'Fixture', metadata: { currentness: null, reason: 'Not published' } }, { id: 'two', retained: ['full', 'metadata'] }];
  const bootstrap = { source_records: { one: 'one.json', two: 'two.json' }, sources };
  assert.equal(recordBootstrapSources(bootstrap, 'one'), sources);
  assert.equal(recordBootstrapSources(bootstrap, 'two')[1], sources[1]);
  assert.equal(recordBootstrapSources({ source_ids: ['one', 'two'], sources }, 'one'), sources);
  assert.equal(recordBootstrapSources({ source_records: bootstrap.source_records }, 'one'), null);
  for (const invalid of [
    { ...bootstrap, sources: {} },
    { sources, source_ids: ['one', 'one'] },
    { ...bootstrap, source_records: undefined },
    { ...bootstrap, sources: [sources[0]] },
    { ...bootstrap, sources: [sources[0], sources[0]] },
    { ...bootstrap, sources: [sources[0], { id: 'unadmitted' }] },
    { ...bootstrap, sources: undefined, record_bootstrap: 'catalog-bootstrap-record.json' },
    { ...bootstrap, record_bootstrap: 'unadmitted.json' },
  ]) assert.throws(() => recordBootstrapSources(invalid, 'one'), /Record bootstrap source register/);
  assert.throws(() => recordBootstrapSources(bootstrap, 'unadmitted'), /incomplete/);
});

test('compiled route choices preserve the real validator behavior without publication descriptions', () => {
  const templates = { templates: [{ name: 'Fixture form', supported_formats: ['xlsx', 'csv'], description: 'Not routing data' }] };
  const workflows = { workflows: [{ workflow_id: 'fixture-task', description: 'Not routing data' }] };
  const choices = buildRouteChoices(templates, workflows);
  assert.deepEqual(choices, { templates: [{ name: 'Fixture form', supported_formats: ['xlsx', 'csv'] }], workflowIds: ['fixture-task'] });
  const source = readFileSync(new URL('../src/ui/lib/buildRouteState.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = compiled => {
    const exports = {};
    const context = { exports, require: name => name.includes('template-registry') ? { __esModule: true, default: templates }
      : name.includes('compliance-workflows') ? { __esModule: true, default: workflows } : { buildRouteChoices },
    };
    if (compiled) {
      context.__CONTROL_ATLAS_BUILD_ROUTE_CHOICES__ = choices;
      context.__CONTROL_ATLAS_BUILD_ROUTE_CHOICES_COMPILED__ = true;
    }
    runInNewContext(code, context);
    return exports;
  };
  const baseline = run(false), compiled = run(true);
  for (const value of ['', 'Fixture form', 'unknown']) {
    assert.equal(compiled.isKnownBuildDocument(value), baseline.isKnownBuildDocument(value));
    for (const format of ['', 'csv', 'xlsx', 'unknown']) assert.equal(compiled.isValidBuildFormat(format, value), baseline.isValidBuildFormat(format, value));
  }
  for (const value of ['', 'fixture-task', 'unknown']) assert.equal(compiled.isKnownBuildTask(value), baseline.isKnownBuildTask(value));
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
    const descriptions = bundle();
    descriptions[name].modules[`${root}/data/compliance-workflows.json`] = { renderedLength: 100 };
    assert.throws(() => verifyRecordDelivery(descriptions, root), /includes full task descriptions/);
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
  assert.equal(config.ci.collect.numberOfRuns, 3);
  assert.equal(config.ci.collect.url.length, 3);
  assert.deepEqual(config.ci.assert.assertions['largest-contentful-paint'], ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }]);
  assert.deepEqual(config.ci.assert.assertions['total-blocking-time'], ['error', { maxNumericValue: 200, aggregationMethod: 'median' }]);
  assert.deepEqual(config.ci.assert.assertions['cumulative-layout-shift'], ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }]);
});
