import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { compactPublishedJson, COMPRESSED_JSON_DIRECTORIES, MAX_PUBLISHED_SITE_BYTES, verifyPublishedSite } from '../tools/lib/site-payload.mjs';
import { readGeneratedCollection } from '../scripts/lib/generated-graph-artifacts.mjs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const deployWorkflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const publicSyncTool = readFileSync('tools/sync-public.mjs', 'utf8');
const domSmoke = readFileSync('scripts/dom-smoke.mjs', 'utf8');
const staticSmoke = readFileSync('scripts/static-smoke.mjs', 'utf8');
const playwrightConfig = readFileSync('playwright.config.mjs', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const tailwindStyles = readFileSync('styles/tailwind.css', 'utf8');

const siteBuilder = existsSync('tools/build-static-site.mjs')
  ? readFileSync('tools/build-static-site.mjs', 'utf8')
  : '';
const frameworkBuilder = readFileSync('scripts/build-framework-data.mjs', 'utf8');

test('control atlas source of truth builds through Vite into the staged static output', () => {
  for (const path of [
    'src/index.html',
    'src/main.tsx',
    'src/ui/App.tsx',
    'src/ui/lib/viewState.ts',
    'styles/tokens.css',
    'styles/base.css',
    'styles/components.css',
    'tsconfig.app.json',
    'vite.config.ts',
    'tools/build-static-site.mjs',
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
  }

  assert.equal(packageJson.scripts['build:site'], 'node ./tools/build-static-site.mjs');
  assert.match(siteBuilder, /build-framework-data\.mjs/);
  assert.match(siteBuilder, /node_modules\/vite\/bin\/vite\.js/);
  assert.match(siteBuilder, /dist\/site/);
  assert.match(siteBuilder, /stagedGeneratedDataMatches/);
  assert.match(siteBuilder, /Reusing unchanged staged data/);
  assert.match(viteConfig, /CONTROL_ATLAS_REUSE_STAGED_DATA/);
  assert.match(packageJson.scripts.precommit, /npm run build:site/);
  assert.match(packageJson.scripts.precommit, /^npm run generate:data && npm run build:site:incremental && npm run verify:quality/,
    'the full precommit gate must generate clean-checkout prerequisites once before building the site');
  assert.match(ciWorkflow, /npm run build:site:incremental/);
  assert.match(ciWorkflow, /name:\s*site-build/);
  assert.match(ciWorkflow, /path:\s*dist\/site/);
  assert.match(deployWorkflow, /name:\s*site-build/);
  assert.doesNotMatch(deployWorkflow, /npm run build:site/);
  assert.match(viteConfig, /base:\s*'\.\/'/);
  assert.match(publicSyncTool, /dist-public/);
  assert.match(publicSyncTool, /dist\/site/);
});

test('framework rebuilds preserve the Commons generator output', () => {
  assert.match(frameworkBuilder, /entry === "commons-search-index\.json"/);
});

test('Commons Tailwind utilities are compiled without replacing Control Atlas global styles', () => {
  assert.ok(existsSync('styles/tailwind.css'), 'Commons utility stylesheet must exist');
  assert.ok(packageJson.devDependencies.tailwindcss, 'tailwindcss must be installed');
  assert.ok(packageJson.devDependencies['@tailwindcss/vite'], '@tailwindcss/vite must be installed');
  assert.match(viteConfig, /tailwindcss\(\)/);
  assert.match(readFileSync('src/main.tsx', 'utf8'), /styles\/tailwind\.css/);
  assert.match(tailwindStyles, /tailwindcss\/theme\.css/);
  assert.match(tailwindStyles, /tailwindcss\/utilities\.css/);
  assert.doesNotMatch(tailwindStyles, /tailwindcss\/preflight\.css/);
});

test('static smoke checks validate the Vite output instead of the legacy app bundle', () => {
  assert.match(domSmoke, /src\/main\.tsx/);
  assert.match(domSmoke, /src\/ui\/App\.tsx/);
  assert.match(domSmoke, /src\/index\.html/);
  assert.match(staticSmoke, /dist\/site\/index\.html/);
  assert.match(staticSmoke, /dist\/site\/assets\//);
  assert.doesNotMatch(staticSmoke, /dist\/site\/app\/app\.mjs/);
});

test('playwright e2e server stays on loopback for deterministic local browser access', () => {
  assert.match(playwrightConfig, /port = process\.env\.PLAYWRIGHT_PORT \?\? '4317'/);
  assert.match(playwrightConfig, /baseURL = `http:\/\/localhost:\$\{port\}`/);
  assert.match(playwrightConfig, /url:\s*baseURL/);
  assert.doesNotMatch(playwrightConfig, /networkInterfaces/);
  assert.match(readFileSync('tools/serve-static-site.mjs', 'utf8'), /listen\(PORT,\s*'localhost'/);
});

function publishedFixture(t) {
  const fixtureRoot = resolve('.local/site-payload-tests');
  mkdirSync(fixtureRoot, { recursive: true });
  const root = mkdtempSync(join(fixtureRoot, 'case-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(`${fixtureRoot}${sep}`));
    rmSync(root, { recursive: true, force: true });
  });
  const site = join(root, 'site');
  mkdirSync(site);
  const put = (path, bytes) => {
    const target = join(site, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  };
  return { root, site, put };
}

test('published packaging removes only byte-identical raw duplicates in its four payload families', t => {
  const { root, site, put } = publishedFixture(t);
  const bytes = Buffer.from(JSON.stringify({ fixture: 'Complete source text and evidence' }));
  const source = join(root, 'source-evidence.json');
  writeFileSync(source, bytes);
  for (const directory of COMPRESSED_JSON_DIRECTORIES) {
    put(`${directory}/one.json`, bytes);
    put(`${directory}/one.json.gz`, gzipSync(bytes));
  }
  put('data/generated/catalog-bootstrap.json', bytes);
  put('data/generated/library-search-index/one.json', bytes);
  assert.throws(() => verifyPublishedSite(site), /verified gzip/);
  assert.deepEqual(compactPublishedJson(site), { removedFiles: 4, removedBytes: 4 * bytes.length });
  for (const directory of COMPRESSED_JSON_DIRECTORIES) {
    assert.equal(existsSync(join(site, directory, 'one.json')), false);
    assert.equal(existsSync(join(site, directory, 'one.json.gz')), true);
  }
  assert.deepEqual(readFileSync(source), bytes);
  assert.deepEqual(readFileSync(join(site, 'data/generated/catalog-bootstrap.json')), bytes);
  assert.deepEqual(readFileSync(join(site, 'data/generated/library-search-index/one.json')), bytes);
  assert.equal(verifyPublishedSite(site).files, 6);
});

test('missing or changed compressed bytes fail before any staged raw input is removed', t => {
  for (const compressed of [null, gzipSync('{"fixture":"different"}'), Buffer.from('invalid gzip')]) {
    const { site, put } = publishedFixture(t);
    const original = Buffer.from('{"fixture":"exact"}');
    const directory = COMPRESSED_JSON_DIRECTORIES[0];
    put(`${directory}/a.json`, original);
    put(`${directory}/a.json.gz`, gzipSync(original));
    put(`${directory}/b.json`, original);
    if (compressed) put(`${directory}/b.json.gz`, compressed);
    assert.throws(() => compactPublishedJson(site));
    assert.deepEqual(readFileSync(join(site, directory, 'a.json')), original);
    assert.deepEqual(readFileSync(join(site, directory, 'b.json')), original);
  }
});

test('published byte budget counts actual files rather than compressed artifact ZIP size', t => {
  const { site, put } = publishedFixture(t);
  put('index.html', 'fixture');
  put('data/a.json.gz', gzipSync('{"fixture":true}'));
  const measured = Buffer.byteLength('fixture') + gzipSync('{"fixture":true}').length;
  assert.equal(MAX_PUBLISHED_SITE_BYTES, 1_000_000_000);
  assert.equal(verifyPublishedSite(site, measured).bytes, measured);
  assert.throws(() => verifyPublishedSite(site, measured - 1), /Published site exceeds/);
});

test('only explicit published collection reads accept compressed shards and retain count validation', t => {
  const { site, put } = publishedFixture(t);
  const chunk = { nodes: [{ id: 'synthetic:one' }] };
  const manifest = { nodes: [], sharded_collection: { record_count: 1, shards: [{ path: 'graph-data/one.json', record_count: 1 }] } };
  put('data/generated/nodes.json', JSON.stringify(manifest));
  put('data/generated/graph-data/one.json.gz', gzipSync(JSON.stringify(chunk)));
  assert.throws(() => readGeneratedCollection(site, 'nodes'), /ENOENT/);
  assert.deepEqual(readGeneratedCollection(site, 'nodes', { compressed: true }).nodes, chunk.nodes);
  manifest.sharded_collection.shards[0].record_count = 2;
  put('data/generated/nodes.json', JSON.stringify(manifest));
  assert.throws(() => readGeneratedCollection(site, 'nodes', { compressed: true }), /count/);
});
