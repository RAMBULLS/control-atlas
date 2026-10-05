import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const HTTP_PATCH = Object.freeze({
  version: '4.3.0',
  upstreamSha256: 'ede1cc404a492fa348eb9d97a3007a0d72aa717bd22cd86a56bd0824c19729ca',
  patchedSha256: 'e8ec06da2e01aaef4db5db0995dd1c6b2c5b13f9bd7f2798e076146ad85051bd',
  originalBlock: `    evaluateRequest(req) {
        this._assertRequestHasHeaders(req);
`,
  patchedBlock: `    evaluateRequest(req) {
        this._assertRequestHasHeaders(req);

        // Control Atlas downstream fix for GHSA-ch52-4w7c-c8xp.
        // Revalidation prohibitions are distinct from ordinary expiry: a client
        // max-stale or stale-while-revalidate must not bypass these conditions.
        if (
            !this.storable() ||
            this._rescc['no-cache'] ||
            this._resHeaders.vary === '*' ||
            (this._isShared && (
                this._rescc['proxy-revalidate'] ||
                (this._resHeaders['set-cookie'] &&
                    !this._rescc.public && !this._rescc.immutable)
            ))
        ) {
            return this._evaluateRequestMissResult(req);
        }
`,
});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function targets(root) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages).filter(([path]) =>
    path === 'node_modules/http-cache-semantics' || path.endsWith('/node_modules/http-cache-semantics'));
  assert.ok(entries.length, 'HTTP cache patch target missing from lockfile');
  return entries.map(([path, record]) => {
    assert.equal(record.version, HTTP_PATCH.version, 'HTTP cache patch requires the pinned upstream version');
    const file = realpathSync(join(root, path, 'index.js'));
    const withinModules = relative(resolve(root, 'node_modules'), file);
    assert.ok(!isAbsolute(withinModules) && withinModules !== '..' && !withinModules.startsWith('../') && !withinModules.startsWith('..\\'), 'HTTP cache patch target escaped this installation');
    const manifest = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
    assert.equal(manifest.version, HTTP_PATCH.version, 'Installed HTTP cache version differs from lockfile');
    return file;
  });
}

export function applyDependencyPatches(root = ROOT) {
  for (const file of targets(root)) {
    const original = readFileSync(file);
    if (digest(original) === HTTP_PATCH.patchedSha256) continue;
    assert.equal(digest(original), HTTP_PATCH.upstreamSha256, 'Unexpected upstream HTTP cache bytes; refusing to patch');
    const source = original.toString('utf8');
    assert.equal(source.split(HTTP_PATCH.originalBlock).length, 2, 'Expected exactly one HTTP cache patch location');
    const patched = source.replace(HTTP_PATCH.originalBlock, HTTP_PATCH.patchedBlock);
    assert.equal(digest(patched), HTTP_PATCH.patchedSha256, 'HTTP cache patch output integrity mismatch');
    writeFileSync(file, patched);
  }
  return verifyDependencyPatches(root);
}

export function assertSafeCachePolicy(Policy) {
  const request = { url: 'https://cache.example/resource', method: 'GET', headers: { host: 'cache.example' } };
  const staleRequest = { ...request, headers: { ...request.headers, 'cache-control': 'max-stale=86400' } };
  for (const headers of [
    { 'cache-control': 'max-age=60', 'set-cookie': 'session=fixture' },
    { 'cache-control': 'max-age=60, proxy-revalidate' },
    { 'cache-control': 'max-age=60, no-cache' },
  ]) {
    const original = new Policy(request, { status: 200, headers }, { shared: true });
    for (const policy of [original, Policy.fromObject(original.toObject())]) {
      policy.now = () => policy._responseTime + 1000;
      assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), false, 'HTTP cache revalidation prohibition bypassed by max-stale');
      const result = policy.evaluateRequest(staleRequest);
      assert.equal(result.response, undefined);
      assert.equal(result.revalidation.synchronous, true);
    }
  }
}

export function verifyDependencyPatches(root = ROOT) {
  const files = targets(root);
  const require = createRequire(import.meta.url);
  for (const file of files) {
    assert.equal(digest(readFileSync(file)), HTTP_PATCH.patchedSha256, 'Unpatched or modified HTTP cache implementation; run npm ci with install scripts');
    assertSafeCachePolicy(require(file));
  }
  return files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(['--apply', '--check'].includes(process.argv[2]), 'Use --apply or --check');
  const count = process.argv[2] === '--apply' ? applyDependencyPatches() : verifyDependencyPatches();
  console.log(`Verified ${count} downstream HTTP cache patch target(s).`);
}
