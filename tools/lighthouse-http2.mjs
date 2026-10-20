import { createHash, X509Certificate } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runProcessSync } from './lib/process-runner.mjs';

export function http2LighthouseConfig(original, cwd, spki) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(spki)) throw new Error('Invalid localhost certificate pin.');
  const config = structuredClone(original);
  const collect = config.ci.collect;
  if (collect.startServerCommand !== 'npm run serve:static' ||
      collect.url.some(url => new URL(url).origin !== 'http://localhost:4317') ||
      /ignore-certificate-errors/.test(collect.settings.chromeFlags)) throw new Error('Unexpected Lighthouse server configuration.');
  collect.startServerCommand += ' -- --http2';
  collect.url = collect.url.map(url => url.replace(/^http:/, 'https:'));
  collect.settings.configPath = resolve(cwd, collect.settings.configPath);
  collect.settings.chromeFlags += ` --ignore-certificate-errors-spki-list=${spki}`;
  return config;
}

export function prepareLighthouseHttp2(config, cwd) {
  const directory = join(cwd, '.lighthouseci/tls');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = join(directory, 'localhost.key');
  const cert = join(directory, 'localhost.crt');
  try {
    runProcessSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
      '-keyout', key, '-out', cert], { cwd, stdio: 'pipe', timeout: 30_000, label: 'Ephemeral localhost TLS certificate' });
    chmodSync(key, 0o600);
    const certificate = new X509Certificate(readFileSync(cert));
    if (certificate.checkHost('localhost') !== 'localhost') throw new Error('Invalid localhost certificate.');
    const spki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const path = join(cwd, '.lighthouseci/http2-config.json');
    writeFileSync(path, JSON.stringify(http2LighthouseConfig(config, cwd, spki)));
    return { path, cleanup() { rmSync(directory, { recursive: true, force: true }); rmSync(path, { force: true }); } };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function assertHttp2Report(report) {
  const origin = new URL(report.requestedUrl).origin;
  const items = report.audits?.['network-requests']?.details?.items;
  const transferred = items?.filter(item => item.transferSize > 0 && new URL(item.url).origin === origin);
  if (!transferred?.some(item => item.resourceType === 'Document') || transferred.some(item => item.protocol !== 'h2')) {
    throw new Error('Measured localhost document and transferred assets must use HTTP/2.');
  }
  return { protocol: 'h2', transferredRequests: transferred.length };
}
