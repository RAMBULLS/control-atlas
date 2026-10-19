import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const adapters = Object.entries(lock.packages).filter(([path]) =>
  path === 'node_modules/get-uri' || path.endsWith('/node_modules/get-uri'));
assert.deepEqual(adapters.map(([, record]) => record.version).sort(), ['6.0.5', '8.0.1']);
const payload = 'function FindProxyForURL() { return "DIRECT"; }\n';
const ordinaryListing = `-rw-r--r-- 1 owner group ${Buffer.byteLength(payload)} Jan 1 2026 source.pac\r\n`;

async function fixture(t, options = {}) {
  const sockets = new Set();
  const servers = new Set();
  const commands = [];
  const control = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 fixture FTP ready\r\n');
    let buffer = '';
    let dataSocket;
    let dataConnected;
    let sequence = Promise.resolve();
    async function passive() {
      const server = net.createServer();
      servers.add(server);
      dataConnected = once(server, 'connection').then(([connection]) => {
        dataSocket = connection;
        sockets.add(connection);
        connection.on('close', () => sockets.delete(connection));
        connection.on('error', () => {});
        return connection;
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = server.address().port;
      return port;
    }
    async function respond(line) {
      const verb = line.split(' ')[0].toUpperCase();
      commands.push(verb);
      if (verb === 'USER') socket.write('331 fixture password required\r\n');
      else if (verb === 'PASS') socket.write(options.authFailure ? '530 fixture login rejected\r\n' : '230 logged in\r\n');
      else if (verb === 'FEAT') socket.write(`211-Features\r\n UTF8\r\n${options.mlsd ? ' MLST type*;size*;modify*;\r\n' : ''}211 End\r\n`);
      else if (verb === 'MDTM') socket.write(options.missing ? '550 file unavailable\r\n' : options.fallback ? '502 MDTM unsupported\r\n' : '213 20260101000000\r\n');
      else if (verb === 'SIZE') socket.write(`213 ${Buffer.byteLength(payload)}\r\n`);
      else if (verb === 'MLSD' && !options.mlsd) socket.write('502 MLSD unsupported\r\n');
      else if (verb === 'EPSV') {
        if (options.foreignTransferHost) socket.write('502 EPSV unsupported\r\n');
        else socket.write(`229 Entering Extended Passive Mode (|||${await passive()}|)\r\n`);
      } else if (verb === 'PASV') {
        const port = await passive();
        socket.write(`227 Entering Passive Mode (${options.foreignTransferHost ? '192,0,2,123' : '127,0,0,1'},${port >> 8},${port & 255})\r\n`);
      } else if (verb === 'LIST' || verb === 'RETR' || verb === 'MLSD') {
        socket.write('150 data connection opening\r\n');
        const transfer = dataSocket || await dataConnected;
        dataSocket = undefined;
        const bytes = verb === 'RETR' ? payload : verb === 'MLSD'
          ? `type=file;size=${Buffer.byteLength(payload)};modify=20260101000000; source.pac\r\n`
          : options.listing || ordinaryListing;
        transfer.end(bytes, () => socket.write('226 transfer complete\r\n'));
      } else if (verb === 'QUIT') socket.end('221 goodbye\r\n');
      else socket.write('200 command accepted\r\n');
    }
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        sequence = sequence.then(() => respond(line)).catch(() => socket.destroy());
      }
    });
  });
  servers.add(control);
  control.listen(0, '127.0.0.1');
  await once(control, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([...servers].map(server => new Promise(resolveClose => server.close(resolveClose))));
  });
  return { url: `ftp://fixture:fixture@127.0.0.1:${control.address().port}/source.pac`, port: control.address().port, commands };
}

async function consume(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

for (const [path, record] of adapters) {
  const parentRequire = createRequire(join(resolve(path), 'package.json'));
  assert.equal(parentRequire('basic-ftp/package.json').version, '6.2.1');
  const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const entry = manifest.main || manifest.exports.default;
  const { getUri } = await import(pathToFileURL(resolve(path, entry)).href);

  test(`get-uri ${record.version} preserves MDTM download and not-modified handling`, { timeout: 8000 }, async t => {
    const ftp = await fixture(t);
    const stream = await getUri(ftp.url);
    assert.equal(await consume(stream), payload);
    assert.equal(stream.lastModified.toISOString(), '2026-01-01T00:00:00.000Z');
    await assert.rejects(getUri(ftp.url, { cache: stream }), { code: 'ENOTMODIFIED' });
    assert.equal(ftp.commands.filter(verb => verb === 'RETR').length, 1);
    assert.equal(ftp.commands.includes('LIST'), false);
  });

  test(`get-uri ${record.version} preserves UTC metadata list fallback and bytes`, { timeout: 8000 }, async t => {
    const ftp = await fixture(t, { fallback: true, mlsd: true });
    const stream = await getUri(ftp.url);
    assert.equal(await consume(stream), payload);
    assert.ok(ftp.commands.includes('MLSD'));
    assert.ok(ftp.commands.includes('RETR'));
  });

  test(`get-uri ${record.version} preserves rejection of Unix dates without UTC metadata`, { timeout: 8000 }, async t => {
    // basic-ftp 5.x and 6.x both preserve these dates as rawModifiedAt;
    // get-uri requires modifiedAt and does not infer the server's timezone.
    const ftp = await fixture(t, { fallback: true });
    await assert.rejects(getUri(ftp.url), { code: 'ENOTFOUND' });
    assert.ok(ftp.commands.includes('LIST'));
    assert.equal(ftp.commands.includes('RETR'), false);
  });

  test(`get-uri ${record.version} preserves missing-file and login errors`, { timeout: 8000 }, async t => {
    const missing = await fixture(t, { missing: true });
    await assert.rejects(getUri(missing.url), { code: 'ENOTFOUND' });
    assert.equal(missing.commands.includes('RETR'), false);
    const denied = await fixture(t, { authFailure: true });
    await assert.rejects(getUri(denied.url), error => error.code === 530);
    assert.equal(denied.commands.includes('RETR'), false);
  });

  test(`get-uri ${record.version} retains the secure separate-transfer-host default`, { timeout: 8000 }, async t => {
    const ftp = await fixture(t, { foreignTransferHost: true });
    const { Client } = parentRequire('basic-ftp');
    const client = new Client(1500);
    assert.equal(client.options.allowSeparateTransferHost, false);
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const host = typeof args[0] === 'object' ? args[0].host : args[1];
      assert.ok(!host || ['127.0.0.1', 'localhost', '::1'].includes(host), 'test forbids a connection outside loopback');
      return originalConnect.apply(this, args);
    };
    try {
      await client.access({ host: '127.0.0.1', port: ftp.port, user: 'fixture', password: 'fixture' });
      await assert.rejects(client.list(), /PASV returned another host/);
      assert.ok(ftp.commands.includes('PASV'));
      assert.equal(ftp.commands.includes('LIST'), false);
    } finally {
      net.Socket.prototype.connect = originalConnect;
      client.close();
    }
  });

  test(`get-uri ${record.version} serves an FTP PAC through its installed proxy-agent parent`, { timeout: 8000 }, async t => {
    const ftp = await fixture(t, { fallback: true, mlsd: true });
    const { ProxyAgent } = await import(pathToFileURL(parentRequire.resolve('proxy-agent')).href);
    const agent = new ProxyAgent({ getProxyForUrl: () => 'pac+' + ftp.url });
    const server = http.createServer((_request, response) => response.end('proxy compatibility fixture'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      agent.destroy();
      server.closeAllConnections();
      await new Promise(resolveClose => server.close(resolveClose));
    });
    const response = await new Promise((resolveResponse, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}/fixture`, { agent }, resolveResponse).on('error', reject);
    });
    assert.equal(await consume(response), 'proxy compatibility fixture');
    assert.ok(ftp.commands.includes('MLSD'));
    assert.ok(ftp.commands.includes('RETR'));
  });
}

test('Client.list handles the advisory malformed listing within a bounded child process', { timeout: 7000 }, async t => {
  const malformed = '-rw-r--r-- 1 ' + 'a '.repeat(32768) + '!\r\n';
  const ftp = await fixture(t, { listing: malformed + ordinaryListing });
  const entry = require.resolve('basic-ftp');
  const code = `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); const {Client}=require(${JSON.stringify(entry)}); const client=new Client(1500); await client.access({host:'127.0.0.1',port:${ftp.port},user:'fixture',password:'fixture'}); try { const files=await client.list(); if(!files.some(file=>file.name==='source.pac')) throw Error('legitimate entry missing'); console.log('parsed'); } catch(error) { if(/timeout/i.test(error.message)) throw error; console.log('rejected malformed listing'); } finally {client.close()}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const deadline = setTimeout(() => child.kill(), 2500);
  try {
    const [exitCode, signal] = await once(child, 'close');
    assert.equal(signal, null, 'malformed listing exceeded the child-process deadline');
    assert.equal(exitCode, 0, stderr);
    assert.match(stdout, /parsed|rejected malformed listing/);
    assert.ok(ftp.commands.includes('LIST'));
  } finally {
    clearTimeout(deadline);
  }
});
