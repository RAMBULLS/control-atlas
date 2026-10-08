import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { externalizeOrbitalFonts, ORBITAL_FONT_HASHES, recordChunkGroups, RECORD_UI_MODULES, verifyRecordDelivery } from '../tools/record-delivery.mjs';

const require = createRequire(import.meta.url);
const css = readFileSync(require.resolve('orbital-archive-no-01/fonts.css'), 'utf8');
const root = '/workspace/control-atlas';
const fontAssets = () => Object.fromEntries([...externalizeOrbitalFonts(css).fonts].map(([digest, bytes]) => [
  `${digest}.woff2`, { type: 'asset', fileName: `${digest}.woff2`, source: bytes },
]));
const chunk = (fileName, modules, imports = []) => ({ type: 'chunk', fileName, name: fileName.replace(/\.js$/, ''), imports,
  modules: Object.fromEntries(modules.map(id => [`${root}/${id}`, {}])) });
const bundle = () => ({
  'main.js': chunk('main.js', ['src/main.tsx']),
  'loader.js': chunk('loader.js', ['src/ui/lib/runtimeLoader.ts']),
  'record.js': chunk('record.js', ['src/ui/pages/ObjectDetailPage.tsx'], ['record-ui.js']),
  'compare.js': chunk('compare.js', ['src/ui/pages/ComparePage.tsx']),
  'record-ui.js': chunk('record-ui.js', ['src/ui/components/AppLink.tsx']),
  ...fontAssets(),
});

test('finite groups coalesce shared record UI and exact icons without capturing dependencies', () => {
  const [ui, icons] = recordChunkGroups(root);
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
  const [windowsUi, windowsIcons] = recordChunkGroups('C:\\work\\control-atlas');
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

test('emitted graph rejects UI in Home or data warm-up, merged pages, and changed font bytes', () => {
  const valid = bundle();
  const report = verifyRecordDelivery(valid, root);
  assert.equal(report.pages.length, 2);
  assert.equal(report.fontHashes.length, 4);
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
  const config = JSON.parse(readFileSync('.lighthouserc.ci.json', 'utf8'));
  assert.equal(config.ci.collect.numberOfRuns, 1);
  assert.equal(config.ci.collect.url.length, 3);
  assert.deepEqual(config.ci.assert.assertions['largest-contentful-paint'], ['error', { maxNumericValue: 2500 }]);
  assert.deepEqual(config.ci.assert.assertions['cumulative-layout-shift'], ['error', { maxNumericValue: 0.1 }]);
});
