import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

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
