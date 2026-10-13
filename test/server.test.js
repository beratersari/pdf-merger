import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { startServer } from '../server.mjs';

function request({ port, method = 'GET', path = '/', host, origin }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(host ? { host } : {}),
          ...(origin ? { origin } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    if (method === 'POST') req.write(Buffer.from('%PDF-1.7 not-really'));
    req.end();
  });
}

test('server listens only on loopback and does not accept uploads', async (t) => {
  await assert.rejects(() => startServer({ host: '0.0.0.0', port: 0 }), /127\.0\.0\.1/);
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const { port } = server.address();
  assert.equal(server.address().address, '127.0.0.1');

  const home = await request({ port, host: `127.0.0.1:${port}` });
  assert.equal(home.status, 200);
  assert.match(home.body.toString('utf8'), /Your PDFs stay in this browser tab/);
  assert.match(home.headers['content-security-policy'], /default-src 'none'/);
  assert.match(home.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');

  const posted = await request({ port, method: 'POST', path: '/api/documents', host: `127.0.0.1:${port}` });
  assert.equal(posted.status, 405);

  const evil = await request({ port, host: 'evil.example' });
  assert.equal(evil.status, 403);

  const foreign = await request({
    port,
    host: `127.0.0.1:${port}`,
    origin: 'http://evil.example',
  });
  assert.equal(foreign.status, 403);

  const escaped = await request({ port, path: '/../server.mjs', host: `127.0.0.1:${port}` });
  assert.equal(escaped.status, 404);
  const encoded = await request({
    port,
    path: '/vendor/%2e%2e/%2e%2e/server.mjs',
    host: `127.0.0.1:${port}`,
  });
  assert.equal(encoded.status, 404);
  assert.doesNotMatch(encoded.body.toString('utf8'), /startServer/);
});
