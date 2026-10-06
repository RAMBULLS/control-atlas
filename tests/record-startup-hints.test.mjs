import test from 'node:test';
import assert from 'node:assert/strict';
import { recordStartupHints } from '../tools/record-startup-hints.mjs';

function fixture() {
  return {
    'assets/record-artifacts.js': {
      type: 'chunk', fileName: 'assets/record-artifacts.js',
      facadeModuleId: '/project/src/ui/lib/runtimeArtifacts.ts',
      exports: ['preloadRuntimeArtifacts'],
    },
    'assets/record-routes.js': {
      type: 'chunk', fileName: 'assets/record-routes.js',
      facadeModuleId: '/project/src/ui/lib/hashRoutes.ts',
      exports: ['parseHashLocation'],
    },
    'assets/record-reader.js': {
      type: 'chunk', fileName: 'assets/record-reader.js',
      facadeModuleId: '/project/src/ui/lib/publisherRecordReader.ts',
      exports: ['startPublisherRecordReader'],
    },
    'assets/other-page.js': { type: 'chunk', fileName: 'assets/other-page.js' },
  };
}
test('record startup binds acquisition and reading to actual emitted public facades', () => {
  assert.deepEqual(recordStartupHints(fixture()), {
    artifacts: './assets/record-artifacts.js', routes: './assets/record-routes.js',
    reader: './assets/record-reader.js', styles: [],
  });
});
test('record startup handles Windows module identifiers without storing machine paths', () => {
  const bundle = fixture();
  for (const chunk of Object.values(bundle)) if (chunk.facadeModuleId) {
    chunk.facadeModuleId = chunk.facadeModuleId.replaceAll('/', '\\');
  }
  assert.equal(recordStartupHints(bundle).artifacts, './assets/record-artifacts.js');
});
test('record startup rejects missing facades and private or minified exports', () => {
  const missing = fixture();
  delete missing['assets/record-routes.js'];
  assert.throws(() => recordStartupHints(missing), /module is absent/);
  const privateExport = fixture();
  privateExport['assets/record-routes.js'].exports = ['p'];
  assert.throws(() => recordStartupHints(privateExport), /no public parseHashLocation/);
});
test('record startup rejects external, escaping and injected emitted paths', () => {
  for (const filename of ['https://example.invalid/script.js', '../outside.js', 'assets/<script>.js']) {
    const bundle = fixture();
    const chunk = bundle['assets/record-routes.js'];
    delete bundle['assets/record-routes.js'];
    chunk.fileName = filename;
    bundle[filename] = chunk;
    assert.throws(() => recordStartupHints(bundle), /invalid emitted chunk/);
  }
});
test('record startup rejects an emitted filename that does not bind to the facade', () => {
  const bundle = fixture();
  bundle['assets/record-routes.js'].fileName = 'assets/other-page.js';
  assert.throws(() => recordStartupHints(bundle), /invalid emitted chunk/);
});

test('reader static closure resolves every dependency and every emitted stylesheet', () => {
  const bundle = fixture();
  bundle['assets/record-reader.js'].imports = ['assets/reader-shared.js'];
  bundle['assets/reader-shared.js'] = { type: 'chunk', fileName: 'assets/reader-shared.js', viteMetadata: { importedCss: new Set(['assets/record.css']) } };
  bundle['assets/record.css'] = { type: 'asset', fileName: 'assets/record.css' };
  assert.deepEqual(recordStartupHints(bundle).styles, ['./assets/record.css']);
  delete bundle['assets/record.css'];
  assert.throws(() => recordStartupHints(bundle), /invalid stylesheet/);
  delete bundle['assets/reader-shared.js'];
  assert.throws(() => recordStartupHints(bundle), /absent static dependency/);
});

test('reader static closure fails closed on framework, page or icon dependencies', () => {
  for (const module of ['/project/node_modules/react/index.js', '/project/node_modules/react-dom/client.js', '/project/node_modules/@tabler/icons-react/dist/icon.js', '/project/src/ui/App.tsx', '/project/src/ui/pages/ObjectDetailPage.tsx']) {
    const bundle = fixture();
    bundle['assets/record-reader.js'].moduleIds = [module];
    assert.throws(() => recordStartupHints(bundle), /requires the interactive framework/);
  }
});
