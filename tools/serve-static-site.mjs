#!/usr/bin/env node

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { gzipSync } from 'node:zlib';

const ROOT = join(process.cwd(), 'dist', 'site');
const PORT = Number(process.env.PORT || 4317);
const testServer = process.env.CONTROL_ATLAS_PLAYWRIGHT_SERVER === '1';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.gz', 'application/gzip'],
  ['.woff2', 'font/woff2'],
]);
const compressibleTypes = new Set(['.css', '.html', '.js', '.json', '.mjs']);
const gzipCache = new Map();

function compressedFile(filePath) {
  // Keyed by content identity, not just path. A rebuild replaces index.html in
  // place, and a path-only cache kept serving the pre-rebuild bytes to every
  // gzip-capable client — so browsers and Playwright loaded an index.html
  // naming chunk hashes that no longer existed, while a plain curl of the same
  // URL looked correct. Every test failed on an app that never booted.
  const stats = statSync(filePath);
  const key = `${filePath}:${stats.mtimeMs}:${stats.size}`;
  const cached = gzipCache.get(key);
  if (cached) return cached;
  // GitHub Pages/CDN keeps encoded asset variants warm. Cache the local
  // release server's equivalent after its first request so Lighthouse measures
  // transfer/render behavior instead of repeatedly benchmarking zlib.
  const compressed = gzipSync(readFileSync(filePath));
  gzipCache.set(key, compressed);
  return compressed;
}

const handler = (request, response) => {
  if (testServer && request.url?.split('?')[0] === '/__control-atlas-test-shutdown') {
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    if ('closeAllConnections' in server) server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1_000).unref();
    return;
  }
  const rawPath = request.url.split('?')[0];
  const requestPath = rawPath === '/' ? '/index.html' : rawPath;
  const filePath = normalize(join(ROOT, requestPath));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    // Mirror GitHub Pages: unknown paths serve 404.html (which redirects
    // path-style deep links into the HashRouter) with a 404 status.
    const notFoundPage = join(ROOT, '404.html');
    if (existsSync(notFoundPage)) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      createReadStream(notFoundPage).pipe(response);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const extension = extname(filePath);
  // Pages uses a ten-minute cache lifetime. Content-addressed fonts can share
  // that response across declared weights; HTML and rebuildable assets stay fresh.
  const pinnedFont = extension === '.woff2' && /^\/fonts\/[a-f0-9]{64}\.woff2$/.test(requestPath);
  const useGzip =
    compressibleTypes.has(extension) &&
    /(?:^|,)\s*gzip(?:\s*;|\s*,|\s*$)/i.test(request.headers['accept-encoding'] || '');
  response.writeHead(200, {
    'content-type': contentTypes.get(extname(filePath)) || 'application/octet-stream',
    'cache-control': pinnedFont ? 'max-age=600' : 'no-store',
    ...(useGzip
      ? { 'content-encoding': 'gzip', vary: 'Accept-Encoding' }
      : {}),
  });
  if (useGzip) {
    response.end(compressedFile(filePath));
  } else {
    createReadStream(filePath).pipe(response);
  }
};

const http2 = process.argv.includes('--http2');
const server = http2 ? createSecureServer({
  allowHTTP1: true,
  key: readFileSync(join(process.cwd(), '.lighthouseci/tls/localhost.key')),
  cert: readFileSync(join(process.cwd(), '.lighthouseci/tls/localhost.crt')),
}, handler) : createServer(handler);

server.listen(PORT, 'localhost', () => {
  console.log(`Control Atlas static site available at ${http2 ? 'https' : 'http'}://localhost:${PORT}`);
});
