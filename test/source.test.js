import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function filesUnder(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

test('app code does not call out to the network', () => {
  const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  assert.doesNotMatch(server, /0\.0\.0\.0/);
  assert.match(server, /127\.0\.0\.1/);
  assert.doesNotMatch(server, /\bfetch\s*\(/);

  const appDir = path.join(root, 'www');
  const sources = filesUnder(appDir).filter((file) => {
    const rel = path.relative(appDir, file);
    return !rel.startsWith(`vendor${path.sep}`) && !rel.startsWith('vendor/');
  });
  assert.ok(sources.some((file) => file.endsWith('app.js')));
  const allowedUrls = new Set(['http://www.w3.org/2000/svg']);
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    const urls = text.match(/https?:\/\/[^\s"'`)>]+/g) || [];
    for (const url of urls) {
      assert.ok(allowedUrls.has(url), `${path.relative(root, file)} references ${url}`);
    }
    assert.doesNotMatch(text, /innerHTML|insertAdjacentHTML|document\.write|eval\s*\(/);
  }
});
