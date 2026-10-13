import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'www');

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.ttf', 'font/ttf'],
  ['.pfb', 'application/octet-stream'],
  ['.bcmap', 'application/octet-stream'],
]);

function securityHeaders(cacheControl) {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': cacheControl,
  };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvePublic(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { error: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { error: 400 };
  const stripped = decoded.replace(/^\/+/, '');
  if (stripped === '') return { file: path.join(ROOT, 'index.html') };
  const target = path.resolve(ROOT, stripped);
  if (!isInside(ROOT, target)) return { error: 404 };
  return { file: target };
}

function allowedHost(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function allowedOrigin(origin, port) {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function sendText(res, status, body, extra = {}) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    ...securityHeaders('no-store'),
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(payload.length),
    ...extra,
  });
  res.end(payload);
}

function cacheControlFor(file, ext) {
  if (ext === '.mjs' || ext === '.bcmap' || ext === '.ttf' || ext === '.pfb') {
    return 'public, max-age=86400';
  }
  if (path.basename(file) === 'pdf-lib.esm.min.js') return 'public, max-age=86400';
  return 'no-cache';
}

function handle(server, req, res) {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    req.resume();
    return;
  }
  if (!address || !allowedHost(req.headers.host || '', port)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!allowedOrigin(req.headers.origin, port)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/favicon.ico') {
    res.writeHead(204, securityHeaders('no-store'));
    res.end();
    return;
  }

  const resolved = resolvePublic(urlPath);
  if (resolved.error) {
    sendText(res, resolved.error, resolved.error === 400 ? 'Bad request' : 'Not found');
    return;
  }

  fs.stat(resolved.file, (error, stat) => {
    if (error || !stat.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(resolved.file).toLowerCase();
    const headers = {
      ...securityHeaders(cacheControlFor(resolved.file, ext)),
      'Content-Type': TYPES.get(ext) || 'application/octet-stream',
      'Content-Length': String(stat.size),
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(resolved.file);
    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'Could not read file');
      else res.destroy();
    });
    stream.pipe(res);
  });
}

export function startServer({ host = '127.0.0.1', port = 0 } = {}) {
  if (host !== '127.0.0.1') {
    return Promise.reject(new Error('PDF Merger only binds to 127.0.0.1'));
  }
  const server = http.createServer((req, res) => handle(server, req, res));
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.close(() => reject(error));
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

function openBrowser(url) {
  const child = spawn('cmd.exe', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function main() {
  const preferred = Number(process.env.PDF_MERGER_PORT || 8765);
  const start = Number.isInteger(preferred) && preferred > 0 && preferred < 65536 ? preferred : 8765;
  let server;
  let lastError;
  for (let port = start; port < start + 20; port += 1) {
    try {
      server = await startServer({ host: '127.0.0.1', port });
      break;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  if (!server) throw lastError ?? new Error('PDF Merger could not start.');
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`PDF Merger is running at ${url}`);
  console.log('PDFs stay in your browser tab. This window only serves the app.');
  console.log('Leave this window open while you work. Ctrl+C quits.');
  if (process.env.PDF_MERGER_NO_OPEN !== '1') openBrowser(url);
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'PDF Merger could not start.');
    process.exitCode = 1;
  });
}
