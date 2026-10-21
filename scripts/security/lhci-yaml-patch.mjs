import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// LHCI 0.15.1 still calls the js-yaml 3 API. Upgrade its parser to remove
// argparse 1 / sprintf-js (GHSA-hp3w-g68c-fv3c), retaining safe YAML loading.
// Remove this compatibility patch when upstream supports js-yaml 4.
export const LHCI_YAML_PATCH = Object.freeze({
  version: '0.15.1',
  yamlVersion: '4.3.2',
  upstreamSha256: '904e3eb32708ed0171dc17b1d11e0bebfd76765bd310af2060dc1b50d2f033fc',
  patchedSha256: '3f3bbc4e2b2f1b7b22ff2b8ed013322f3b7b5bfb7cf296fbb7605a6570b6e493',
  original: 'yaml.safeLoad(contents)',
  replacement: 'yaml.load(contents)',
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function targets(root) {
  const { packages } = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.ok(!Object.keys(packages).some(path => path.endsWith('node_modules/sprintf-js')),
    'Vulnerable sprintf-js must be absent from the dependency graph');
  const entries = Object.entries(packages).filter(([path]) => path.endsWith('node_modules/@lhci/utils'));
  assert.ok(entries.length, 'LHCI compatibility target missing from lockfile');
  return entries.map(([path, record]) => {
    assert.equal(record.version, LHCI_YAML_PATCH.version, 'LHCI compatibility patch requires the pinned upstream version');
    const file = realpathSync(join(root, path, 'src/lighthouserc.js'));
    const within = relative(resolve(root, 'node_modules'), file);
    assert.ok(!isAbsolute(within) && within !== '..' && !within.startsWith('../') && !within.startsWith('..\\'),
      'LHCI patch target escaped this installation');
    const require = createRequire(file);
    assert.equal(require('../package.json').version, LHCI_YAML_PATCH.version, 'Installed LHCI version differs from lockfile');
    assert.equal(require('js-yaml/package.json').version, LHCI_YAML_PATCH.yamlVersion, 'LHCI must resolve the upgraded YAML parser');
    return file;
  });
}

export function verifyLhciYamlPatch(root = ROOT) {
  const files = targets(root);
  for (const file of files) {
    assert.equal(digest(readFileSync(file)), LHCI_YAML_PATCH.patchedSha256,
      'Unpatched or modified LHCI configuration loader; run npm ci with install scripts');
  }
  return files.length;
}

export function applyLhciYamlPatch(root = ROOT) {
  for (const file of targets(root)) {
    const source = readFileSync(file, 'utf8');
    if (digest(source) === LHCI_YAML_PATCH.patchedSha256) continue;
    assert.equal(digest(source), LHCI_YAML_PATCH.upstreamSha256, 'Unexpected upstream LHCI bytes; refusing to patch');
    assert.equal(source.split(LHCI_YAML_PATCH.original).length, 2, 'Expected exactly one LHCI patch location');
    const patched = source.replace(LHCI_YAML_PATCH.original, LHCI_YAML_PATCH.replacement);
    assert.equal(digest(patched), LHCI_YAML_PATCH.patchedSha256, 'LHCI patch output integrity mismatch');
    writeFileSync(file, patched);
  }
  return verifyLhciYamlPatch(root);
}
