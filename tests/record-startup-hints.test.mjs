import test from 'node:test';
import assert from 'node:assert/strict';
import { recordStartupHints } from '../tools/record-startup-hints.mjs';

const modules = [
  'src/ui/App.tsx', 'src/ui/pages/ObjectDetailPage.tsx',
  'src/ui/lib/runtimeLoader.ts', 'src/ui/lib/runtimeArtifacts.ts',
  'src/ui/lib/hashRoutes.ts', 'src/ui/lib/recordPageLoader.ts',
  'node_modules/react-dom/client.js',
];
function fixture() {
  return {
    'assets/record.js': {
      type: 'chunk', fileName: 'assets/record.js',
      modules: Object.fromEntries(modules.map(module => [`/project/${module}`, {}])),
      imports: ['assets/shared.js'], dynamicImports: ['assets/other-route.js'],
      viteMetadata: { importedCss: new Set(['assets/record.css']) },
    },
    'assets/shared.js': { type: 'chunk', fileName: 'assets/shared.js', modules: {}, imports: ['assets/record.js'] },
    'assets/other-route.js': { type: 'chunk', fileName: 'assets/other-route.js', modules: {}, imports: [] },
    'assets/record.css': { type: 'asset', fileName: 'assets/record.css' },
  };
}
test('record hints follow only emitted static imports, deduplicate cycles and retain CSS', () => {
  assert.deepEqual(recordStartupHints(fixture()), {
    modules: ['./assets/record.js', './assets/shared.js'], styles: ['./assets/record.css'],
  });
});
test('record hints resolve Windows module identifiers without storing machine paths', () => {
  const bundle = fixture();
  bundle['assets/record.js'].modules = Object.fromEntries(modules.map(module => [`/project/${module}`.replaceAll('/', '\\'), {}]));
  assert.equal(recordStartupHints(bundle).modules.length, 2);
});
test('record hints collect split owning chunks and their shared dependency once', () => {
  const bundle = fixture();
  bundle['assets/bootstrap.js'] = {
    ...bundle['assets/record.js'], fileName: 'assets/bootstrap.js',
    modules: { ...bundle['assets/record.js'].modules },
  };
  delete bundle['assets/bootstrap.js'].modules['/project/src/ui/pages/ObjectDetailPage.tsx'];
  bundle['assets/record.js'].modules = { '/project/src/ui/pages/ObjectDetailPage.tsx': {} };
  assert.deepEqual(recordStartupHints(bundle), {
    modules: ['./assets/bootstrap.js', './assets/record.js', './assets/shared.js'], styles: ['./assets/record.css'],
  });
});
test('record hints reject absent startup modules and missing emitted dependencies', () => {
  const missingModule = fixture();
  delete missingModule['assets/record.js'].modules['/project/src/ui/App.tsx'];
  assert.throws(() => recordStartupHints(missingModule), /module is absent/);
  const missingChunk = fixture();
  delete missingChunk['assets/shared.js'];
  assert.throws(() => recordStartupHints(missingChunk), /invalid emitted chunk/);
});
test('record hints reject external, escaping and injected chunk paths', () => {
  for (const filename of ['https://example.invalid/script.js', '../outside.js', 'assets/<script>.js']) {
    const bundle = fixture();
    bundle['assets/record.js'].imports = [filename];
    bundle[filename] = { type: 'chunk', fileName: filename, modules: {}, imports: [] };
    assert.throws(() => recordStartupHints(bundle), /invalid emitted chunk/);
  }
});
test('record hints reject missing or invalid CSS while leaving CSS-free chunks valid', () => {
  const bundle = fixture();
  delete bundle['assets/record.css'];
  assert.throws(() => recordStartupHints(bundle), /invalid emitted stylesheet/);
  delete bundle['assets/record.js'].viteMetadata;
  assert.deepEqual(recordStartupHints(bundle).styles, []);
});
