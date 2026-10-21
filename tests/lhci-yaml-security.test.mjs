import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import { applyLhciYamlPatch, LHCI_YAML_PATCH as PATCH, verifyLhciYamlPatch } from '../scripts/security/lhci-yaml-patch.mjs';

const require = createRequire(import.meta.url);
const installedFile = require.resolve('@lhci/utils/src/lighthouserc.js');
const upstream = readFileSync(installedFile, 'utf8').replace(PATCH.replacement, PATCH.original);
const sha256 = value => createHash('sha256').update(value).digest('hex');
// xmlbuilder2 already uses the same maintained parser. This lets the focused
// fixture run without changing a shared installation; CI also tests LHCI's
// actual installed dependency resolution below.
const yamlRequire = createRequire(require.resolve('xmlbuilder2'));
const yaml = yamlRequire('js-yaml');

function withFixture(callback) {
  const parent = resolve('.local/dependency-security-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'lhci-'));
  assert.equal(dirname(root), parent);
  try { callback(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function checkConfigurations(loader, root) {
  const config = { ci: { collect: { numberOfRuns: 3, url: ['https://example.test/'] }, assert: { assertions: { 'categories.performance': ['warn', { minScore: 0.9 }] } } } };
  const expected = { numberOfRuns: 3, url: ['https://example.test/'], assertions: { 'categories:performance': ['warn', { minScore: 0.9 }] } };
  for (const [extension, contents] of [
    ['yaml', yaml.dump(config)], ['json', JSON.stringify(config)],
    ['cjs', `module.exports = ${JSON.stringify(config)};`],
  ]) {
    const file = join(root, `lighthouserc.${extension}`);
    writeFileSync(file, contents);
    assert.deepEqual(loader.loadAndParseRcFile(file), expected);
  }
  const unsafe = join(root, 'unsafe.yaml');
  writeFileSync(unsafe, 'ci: !!js/function "function () { return 1; }"');
  assert.throws(() => loader.loadRcFile(unsafe), /unknown tag/);
  writeFileSync(unsafe, 'ci: [unterminated');
  assert.throws(() => loader.loadRcFile(unsafe), /unexpected end/);
}

test('focused LHCI fixture preserves YAML/JSON/JS configuration and rejects unsafe YAML', () => withFixture(root => {
  assert.equal(sha256(upstream), PATCH.upstreamSha256);
  assert.equal(yamlRequire('js-yaml/package.json').version, PATCH.yamlVersion);
  const installedRequire = createRequire(installedFile);
  const load = source => {
    const module = { exports: {} };
    compileFunction(source, ['require', 'module', 'exports'], { filename: installedFile })(
      name => name === 'js-yaml' ? yaml : installedRequire(name), module, module.exports);
    return module.exports;
  };
  const file = join(root, 'before.yaml');
  writeFileSync(file, 'ci: {}');
  assert.throws(() => load(upstream).loadRcFile(file), /safeLoad.*removed/);
  const patched = upstream.replace(PATCH.original, PATCH.replacement);
  assert.equal(sha256(patched), PATCH.patchedSha256);
  checkConfigurations(load(patched), root);
}));

test('focused LHCI integrity fixture is idempotent and rejects tampering, wrong versions and vulnerable graphs', () => withFixture(root => {
  const target = join(root, 'node_modules/@lhci/utils');
  mkdirSync(join(target, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules/js-yaml'), { recursive: true });
  const file = join(target, 'src/lighthouserc.js');
  const manifest = join(target, 'package.json');
  const lockFile = join(root, 'package-lock.json');
  const packages = { 'node_modules/@lhci/utils': { version: PATCH.version } };
  writeFileSync(file, upstream);
  writeFileSync(manifest, JSON.stringify({ version: PATCH.version }));
  writeFileSync(join(root, 'node_modules/js-yaml/package.json'), JSON.stringify({ version: PATCH.yamlVersion }));
  writeFileSync(lockFile, JSON.stringify({ packages }));
  assert.throws(() => verifyLhciYamlPatch(root), /Unpatched or modified/);
  assert.equal(applyLhciYamlPatch(root), 1);
  assert.equal(applyLhciYamlPatch(root), 1);
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// tamper\n');
  assert.throws(() => verifyLhciYamlPatch(root), /Unpatched or modified/);
  assert.throws(() => applyLhciYamlPatch(root), /Unexpected upstream/);
  packages['node_modules/sprintf-js'] = { version: '1.0.3' };
  writeFileSync(lockFile, JSON.stringify({ packages }));
  assert.throws(() => applyLhciYamlPatch(root), /must be absent/);
  delete packages['node_modules/sprintf-js'];
  packages['node_modules/@lhci/utils'].version = '0.15.2';
  writeFileSync(lockFile, JSON.stringify({ packages }));
  assert.throws(() => applyLhciYamlPatch(root), /pinned upstream version/);
}));

test('installed LHCI uses the upgraded parser with the verified compatibility patch', () => withFixture(root => {
  assert.ok(verifyLhciYamlPatch() > 0);
  const lhciRequire = createRequire(installedFile);
  assert.equal(lhciRequire('js-yaml/package.json').version, PATCH.yamlVersion);
  // A sibling override can detach utils from the CLI's existing Lighthouse
  // override, silently restoring its old vulnerable transitive dependency tree.
  const cliRequire = createRequire(require.resolve('@lhci/cli/package.json'));
  assert.equal(lhciRequire('lighthouse/package.json').version, '13.4.1');
  assert.equal(lhciRequire.resolve('lighthouse/package.json'), cliRequire.resolve('lighthouse/package.json'));
  checkConfigurations(lhciRequire(installedFile), root);
}));
