import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDashboardServer, isSafePath } from './http.mjs';
import { parseOptions } from './index.mjs';
import { fixture, NOW } from './test-fixture.mjs';

async function app(t, { missing = false, build = true } = {}) {
  const f = fixture(t);
  const distPath = join(f.directory, 'dist');
  if (build) {
    mkdirSync(distPath);
    mkdirSync(join(distPath, 'assets'));
    writeFileSync(join(distPath, 'index.html'), '<!doctype html><title>Local dashboard</title><div id="root"></div>');
    writeFileSync(join(distPath, 'assets', 'app.js'), 'console.log("local asset");');
    writeFileSync(join(distPath, '.env'), 'PRIVATE_DIST_SECRET');
    writeFileSync(join(f.directory, 'secret.txt'), 'PRIVATE_OUTSIDE_SECRET');
    symlinkSync(join(f.directory, 'secret.txt'), join(distPath, 'escape.txt'));
    symlinkSync(join(distPath, '.env'), join(distPath, 'hidden.txt'));
    symlinkSync(f.directory, join(distPath, 'outside'));
  }
  const dbPath = missing ? join(f.directory, 'missing.db') : f.path;
  const server = await createDashboardServer({ dbPath, distPath, now: () => NOW });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const port = server.address().port;
  const call = (path = '/api/dashboard', { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  return { ...f, server, port, call, dbPath };
}

test('GET/HEAD dashboard returns UTF-8 no-store JSON and security headers on loopback', async (t) => {
  const f = await app(t);
  assert.equal(f.server.address().address, '127.0.0.1');
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(response.json().summary.tokens.total, 410);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.ok(!response.body.includes('PRIVATE_'));
  const head = await f.call('/api/dashboard', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], response.headers['content-length']);
  assert.equal((await f.call('/api/dashboard?project=p1&model=other%2Fb')).json().summary.tokens.total, 110);
});

test('API validates queries and rejects unknown endpoints and all mutation/preflight methods', async (t) => {
  const f = await app(t);
  for (const path of ['/api/dashboard?range=invalid', '/api/dashboard?model=missing', '/api/dashboard?project=missing', '/api/dashboard?range=all&range=7d', '/api/dashboard?file=/etc/passwd']) {
    const response = await f.call(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.json().error.code, 'INVALID_QUERY');
  }
  for (const path of ['/api', '/api/', '/api/other', '/api/dashboard/']) {
    const response = await f.call(path, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 404, path);
    assert.equal(response.json().error.code, 'NOT_FOUND');
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await f.call('/api/dashboard', { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, 'GET, HEAD');
  }
});

test('cross-origin, same-site/different-origin, and DNS-rebinding requests are rejected', async (t) => {
  const f = await app(t);
  const origin = `http://127.0.0.1:${f.port}`;
  for (const headers of [
    { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'http://127.0.0.1:1' },
    { origin: `http://localhost:${f.port}` }, { host: `evil.example:${f.port}` }, { host: '127.0.0.1:1' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    { referer: 'https://evil.example/steal' }, { referer: 'invalid' },
  ]) {
    const response = await f.call('/api/dashboard', { headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.json().error.code, 'FORBIDDEN_ORIGIN');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await f.call('/api/dashboard', { headers: { origin, referer: `${origin}/`, 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await f.call('/api/dashboard', { headers: { host: `localhost:${f.port}`, origin: `http://localhost:${f.port}` } })).status, 200);
  assert.equal((await f.call('/assets/app.js', { headers: { origin: 'https://evil.example' } })).status, 403);
});

test('production serves static assets and HTML SPA routes without arbitrary file fallback', async (t) => {
  const f = await app(t);
  const index = await f.call('/');
  assert.equal(index.status, 200);
  assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(index.body, /Local dashboard/);
  const spa = await f.call('/sessions/session-123?tab=models', { headers: { accept: 'text/html,application/xhtml+xml' } });
  assert.equal(spa.status, 200);
  assert.equal(spa.body, index.body);
  const js = await f.call('/assets/app.js?v=1');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /javascript/);
  assert.match(js.body, /local asset/);
  const head = await f.call('/assets/app.js', { method: 'HEAD' });
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], js.headers['content-length']);
  for (const path of ['/missing.js', '/opencode.db', '/unknown', '/@fs/etc/passwd', '/escape.txt', '/hidden.txt', '/outside/secret.txt', '/assets']) {
    const response = await f.call(path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.body.includes('PRIVATE_'));
  }
  assert.equal((await f.call('/missing.js', { headers: { accept: 'text/html' } })).status, 404);
});

test('raw, encoded, malformed, dotfile, absolute and backslash traversal paths fail safely', async (t) => {
  const f = await app(t);
  for (const path of [
    '/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/%00', '/%ff', '/%', '/.env', '/%2egit/config',
    '//etc/passwd', 'http://evil.example/api/dashboard', '/api/../secret.txt',
  ]) {
    const response = await f.call(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.json().error.code, 'INVALID_PATH');
    assert.ok(!response.body.includes('PRIVATE_'));
  }
  const doubleEncoded = await f.call('/%252e%252e/secret.txt');
  assert.equal(doubleEncoded.status, 404);
});

test('development path guard allows Vite optimized dependencies, but not other dotfiles or traversal', () => {
  for (const path of ['/@vite/client', '/@react-refresh', '/src/main.tsx']) assert.equal(isSafePath(path, true), true);
  assert.equal(isSafePath('/node_modules/.vite/deps/react.js', true), true);
  assert.equal(isSafePath('/node_modules/.vite/deps/react.js'), false);
  for (const path of ['/node_modules/.vite/../../../secret', '/node_modules/.vite/.env', '/.vite/secret', '/.env', '/.git/config', '/@fs/etc/../passwd']) {
    assert.equal(isSafePath(path, true), false, path);
  }
});

test('missing sources return 200 empty DashboardData; schema errors return 503 DashboardData', async (t) => {
  const f = await app(t, { missing: true });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.equal(response.json().source.status, 'missing');
  assert.deepEqual(response.json().sessions, []);
  assert.equal(existsSync(f.dbPath), false);
  assert.equal((await f.call('/api/dashboard?model=stale%2Fmodel')).status, 400);
  assert.equal((await f.call('/api/dashboard?project=stale')).status, 400);
  const broken = await app(t);
  broken.db.exec('DROP TABLE message');
  const error = await broken.call();
  assert.equal(error.status, 503);
  assert.equal(error.json().source.status, 'error');
  assert.match(error.json().source.message, /OPENCODE_DB/);
  assert.equal(error.headers['cache-control'], 'no-store');
});

test('API works before a frontend build; HTML returns an actionable build error', async (t) => {
  const f = await app(t, { build: false });
  assert.equal((await f.call()).status, 200);
  const page = await f.call('/');
  assert.equal(page.status, 503);
  assert.match(page.json().error.message, /npm run build/);
  assert.equal((await f.call('/missing.js')).status, 404);
});

test('CLI accepts dev and port overrides but exposes no host option', () => {
  assert.deepEqual(parseOptions([], {}), { port: 3000, dev: false });
  assert.deepEqual(parseOptions(['--dev', '--port', '3001'], { PORT: '3002' }), { port: 3001, dev: true });
  assert.deepEqual(parseOptions(['--port=3100'], {}), { port: 3100, dev: false });
  assert.deepEqual(parseOptions([], { PORT: '3200' }), { port: 3200, dev: false });
  for (const args of [['--port'], ['--port='], ['--port', '0'], ['--port', '65536'], ['--port', '1.5'], ['--port', '-1'], ['--host', '0.0.0.0'], ['--other']]) {
    assert.throws(() => parseOptions(args, {}), Error);
  }
  assert.throws(() => parseOptions([], { PORT: 'bad' }), /integer/);
});
