import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDashboard, QueryError } from './dashboard.mjs';

const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};

function sameOrigin(req, server) {
  const port = server.address()?.port;
  const host = req.headers.host;
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (port === 80) allowed.push('127.0.0.1', 'localhost');
  if (typeof host !== 'string' || !allowed.includes(host.toLowerCase())) return false;
  const origin = new URL(`http://${host.toLowerCase()}`).origin;
  if (req.headers.origin !== undefined && req.headers.origin !== origin) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  if (req.headers.referer) {
    try {
      if (new URL(req.headers.referer).origin !== origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function securityHeaders(res, dev, port) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self'${dev ? ` ws://127.0.0.1:${port} ws://localhost:${port}` : ''}`,
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '));
}

function send(req, res, status, body, type = 'application/json; charset=utf-8') {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(type.startsWith('application/json') ? JSON.stringify(body) : body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buffer.length });
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

function fail(req, res, status, code, message) {
  send(req, res, status, { error: { code, message } });
}

function inside(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Input is already URL-decoded; Vite needs its optimized dependency directory. */
export function isSafePath(path, dev = false) {
  const parts = path.split('/');
  return path.startsWith('/') && !path.startsWith('//') && !/[\\\x00-\x1f\x7f#]/.test(path)
    && !parts.some((part, index) => part.startsWith('.') && !(dev && part === '.vite' && parts[index - 1] === 'node_modules'));
}

async function staticFile(root, path) {
  try {
    const rootPath = await realpath(root);
    const filePath = await realpath(resolve(rootPath, `.${path}`));
    if (!inside(rootPath, filePath) || relative(rootPath, filePath).split(sep).some((part) => part.startsWith('.')) || !(await stat(filePath)).isFile()) return null;
    return { body: await readFile(filePath), type: MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}

/** The caller must listen on 127.0.0.1; index.mjs deliberately has no host option. */
export async function createDashboardServer({ dbPath, distPath = DEFAULT_DIST, dev = false, now } = {}) {
  let vite;
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else fail(req, res, 500, 'INTERNAL_ERROR', 'Unable to complete the request.');
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  async function handle(req, res) {
    securityHeaders(res, dev, server.address()?.port);
    if (!sameOrigin(req, server)) return fail(req, res, 403, 'FORBIDDEN_ORIGIN', 'Only same-origin loopback requests are allowed.');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return fail(req, res, 405, 'METHOD_NOT_ALLOWED', 'Only GET and HEAD are supported.');
    }
    if (req.url.length > 8192) return fail(req, res, 414, 'INVALID_URL', 'Request URL is too long.');
    let path;
    const queryIndex = req.url.indexOf('?');
    const rawPath = queryIndex < 0 ? req.url : req.url.slice(0, queryIndex);
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return fail(req, res, 400, 'INVALID_PATH', 'Invalid URL encoding.');
    }
    // Validate before URL parsing, which would silently normalize dot segments.
    if (!isSafePath(path, dev)) {
      return fail(req, res, 400, 'INVALID_PATH', 'Unsafe request path.');
    }
    if (path === '/api/dashboard') {
      try {
        const data = getDashboard({ dbPath, params: new URLSearchParams(queryIndex < 0 ? '' : req.url.slice(queryIndex + 1)), ...(now ? { now: now() } : {}) });
        return send(req, res, data.source.status === 'error' ? 503 : 200, data);
      } catch (error) {
        if (error instanceof QueryError) return fail(req, res, 400, 'INVALID_QUERY', error.message);
        throw error;
      }
    }
    if (path === '/api' || path.startsWith('/api/')) return fail(req, res, 404, 'NOT_FOUND', 'Unknown API endpoint.');
    if (vite) {
      // Vite's documented /@fs/ allow-list and HMR token checks remain enabled.
      return vite.middlewares(req, res, () => fail(req, res, 404, 'NOT_FOUND', 'Not found.'));
    }
    const file = await staticFile(distPath, path === '/' ? '/index.html' : path);
    if (file) return send(req, res, 200, file.body, file.type);
    // Only browser HTML navigations to extensionless routes get the SPA shell.
    const spaRoute = path === '/' || (!path.split('/').some((part) => part.includes('.')) && req.headers.accept?.split(',').some((type) => type.trim().split(';')[0] === 'text/html'));
    if (spaRoute) {
      const index = await staticFile(distPath, '/index.html');
      if (index) return send(req, res, 200, index.body, index.type);
      return fail(req, res, 503, 'FRONTEND_NOT_BUILT', 'Frontend build not found. Run npm run build, or start with --dev.');
    }
    return fail(req, res, 404, 'NOT_FOUND', 'Not found.');
  }

  server.on('upgrade', (req, socket) => {
    if (!dev || !sameOrigin(req, server)) socket.destroy();
  });
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      // Node 24 loads this TS config directly, avoiding generated config files
      // that would otherwise trigger an endless node --watch restart loop.
      configLoader: 'native',
      appType: 'spa',
      server: { middlewareMode: true, host: '127.0.0.1', allowedHosts: ['127.0.0.1', 'localhost'], cors: false, hmr: { server } },
    });
    server.on('close', () => { void vite.close().catch(() => {}); });
  }
  return server;
}
