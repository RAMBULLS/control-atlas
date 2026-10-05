import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { applyDependencyPatches, assertSafeCachePolicy, HTTP_PATCH, verifyDependencyPatches } from '../scripts/security/dependency-patches.mjs';
import { assertAuditReport } from '../scripts/security/npm-audit.mjs';

const require = createRequire(import.meta.url);
const Policy = require('http-cache-semantics');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const request = { url: 'https://cache.example/resource', method: 'GET', headers: { host: 'cache.example' } };
const staleRequest = { ...request, headers: { ...request.headers, 'cache-control': 'max-stale=86400' } };

test('scanner errors and incomplete audit reports cannot become a passing security gate', () => {
  const complete = { vulnerabilities: {}, metadata: { vulnerabilities: {} } };
  assert.doesNotThrow(() => assertAuditReport(complete, 0));
  assert.doesNotThrow(() => assertAuditReport(complete, 1));
  assert.throws(() => assertAuditReport({ error: { code: 'ENETUNREACH' } }, 1), /scanner error/);
  assert.throws(() => assertAuditReport({}, 0), /report is missing/);
  assert.throws(() => assertAuditReport({ vulnerabilities: {} }, 0), /summary is missing/);
  assert.throws(() => assertAuditReport(complete, null), /complete normally/);
});

test('installed HTTP cache patch rejects prohibited reuse before and after serialization', () => {
  assert.ok(verifyDependencyPatches() > 0);
  assertSafeCachePolicy(Policy);
  for (const shared of [false, true]) {
    for (const headers of [
      { 'cache-control': 'max-age=60, no-cache, stale-while-revalidate=3600' },
      { 'cache-control': 'max-age=60, no-store' },
      { 'cache-control': 'max-age=60', vary: '*' },
    ]) {
      const policy = new Policy(request, { status: 200, headers }, { shared });
      policy.now = () => policy._responseTime + 1000;
      assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), false);
      assert.equal(policy.evaluateRequest(staleRequest).response, undefined);
    }
  }
});

test('ordinary expiry, explicit public/immutable cookies and private-cache responses retain valid reuse', () => {
  for (const [shared, headers] of [
    [true, { 'cache-control': 'max-age=60, public' }],
    [true, { 'cache-control': 'max-age=60, public', 'set-cookie': 'session=fixture' }],
    [true, { 'cache-control': 'max-age=60, immutable', 'set-cookie': 'session=fixture' }],
    [false, { 'cache-control': 'max-age=60', 'set-cookie': 'session=fixture' }],
    [false, { 'cache-control': 'max-age=60, proxy-revalidate' }],
    [true, { 'cache-control': 'max-age=0, public' }],
  ]) {
    const original = new Policy(request, { status: 200, headers }, { shared });
    for (const policy of [original, Policy.fromObject(original.toObject())]) {
      policy.now = () => policy._responseTime + 61000;
      assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), true);
      assert.equal(policy.evaluateRequest(staleRequest).response.status, 200);
    }
  }
});

test('exact unpatched upstream bytes fail the behavior regression and integrity gate; patching is idempotent', () => {
  const parent = resolve('.local/dependency-security-fixtures');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'http-'));
  assert.equal(dirname(root), parent);
  try {
    const target = join(root, 'node_modules/http-cache-semantics');
    mkdirSync(target, { recursive: true });
    const installed = readFileSync(require.resolve('http-cache-semantics'), 'utf8');
    const upstream = installed.replace(HTTP_PATCH.patchedBlock, HTTP_PATCH.originalBlock);
    assert.equal(sha256(upstream), HTTP_PATCH.upstreamSha256);
    writeFileSync(join(target, 'index.js'), upstream);
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'http-cache-semantics', version: '4.3.0' }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/http-cache-semantics': { version: '4.3.0' } } }));
    const moduleUrl = pathToFileURL(resolve('scripts/security/dependency-patches.mjs')).href;
    const regression = `import {createRequire} from 'node:module'; import {assertSafeCachePolicy} from ${JSON.stringify(moduleUrl)}; const require=createRequire(import.meta.url); assertSafeCachePolicy(require(${JSON.stringify(join(target, 'index.js'))}));`;
    const failed = spawnSync(process.execPath, ['--input-type=module', '-e', regression], { encoding: 'utf8', timeout: 5000 });
    assert.equal(failed.error, undefined);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /HTTP cache revalidation prohibition bypassed/);
    assert.throws(() => verifyDependencyPatches(root), /Unpatched or modified/);
    assert.equal(applyDependencyPatches(root), 1);
    assert.equal(applyDependencyPatches(root), 1);
    assert.equal(verifyDependencyPatches(root), 1);
    const passed = spawnSync(process.execPath, ['--input-type=module', '-e', regression], { encoding: 'utf8', timeout: 5000 });
    assert.equal(passed.status, 0, passed.stderr);
    writeFileSync(join(target, 'index.js'), readFileSync(join(target, 'index.js'), 'utf8') + '\n// changed\n');
    assert.throws(() => verifyDependencyPatches(root), /Unpatched or modified/);
    assert.throws(() => applyDependencyPatches(root), /Unexpected upstream/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
