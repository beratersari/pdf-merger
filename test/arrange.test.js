import assert from 'node:assert/strict';
import test from 'node:test';
import {
  missingSourcePages,
  moveEarlier,
  moveLater,
  normalizeRotation,
  removeUids,
  reorder,
  rotateUids,
} from '../www/lib/arrange.js';

function page(uid, pageIndex = 0, rotation = 0) {
  return { uid, docId: 'doc', pageIndex, rotation };
}

test('moveEarlier slides one page toward the start', () => {
  const pages = [page('a'), page('b'), page('c')];
  const next = moveEarlier(pages, ['b']);
  assert.deepEqual(next.map((item) => item.uid), ['b', 'a', 'c']);
  assert.deepEqual(pages.map((item) => item.uid), ['a', 'b', 'c']);
});

test('moveEarlier slides a contiguous block by one place', () => {
  const pages = [page('a'), page('b'), page('c'), page('d')];
  const next = moveEarlier(pages, new Set(['c', 'd']));
  assert.deepEqual(next.map((item) => item.uid), ['a', 'c', 'd', 'b']);
});

test('moveEarlier leaves a page alone when it is already first', () => {
  const pages = [page('a'), page('b')];
  const next = moveEarlier(pages, ['a']);
  assert.deepEqual(next.map((item) => item.uid), ['a', 'b']);
});

test('moveLater slides a contiguous block by one place', () => {
  const pages = [page('a'), page('b'), page('c'), page('d')];
  const next = moveLater(pages, ['a', 'b']);
  assert.deepEqual(next.map((item) => item.uid), ['c', 'a', 'b', 'd']);
});

test('reorder places a later page before an earlier one', () => {
  const pages = [page('a'), page('b'), page('c'), page('d')];
  const next = reorder(pages, ['d'], 0);
  assert.deepEqual(next.map((item) => item.uid), ['d', 'a', 'b', 'c']);
});

test('reorder keeps a non-contiguous selection in its own order', () => {
  const pages = [page('a'), page('b'), page('c'), page('d')];
  const next = reorder(pages, ['a', 'c'], 4);
  assert.deepEqual(next.map((item) => item.uid), ['b', 'd', 'a', 'c']);
});

test('reorder dropping a page on itself does not change order', () => {
  const pages = [page('a'), page('b'), page('c')];
  const next = reorder(pages, ['b'], 1);
  assert.deepEqual(next.map((item) => item.uid), ['a', 'b', 'c']);
});

test('removeUids drops only the chosen pages', () => {
  const pages = [page('a', 0), page('b', 1), page('c', 2)];
  const next = removeUids(pages, ['b']);
  assert.deepEqual(next.map((item) => item.uid), ['a', 'c']);
});

test('rotateUids turns clockwise and wraps at 360', () => {
  const pages = [page('a', 0, 270), page('b', 1, 0)];
  const next = rotateUids(pages, ['a']);
  assert.equal(next[0].rotation, 0);
  assert.equal(next[1].rotation, 0);
  assert.equal(pages[0].rotation, 270);
});

test('normalizeRotation snaps to quarter turns', () => {
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation('nope'), 0);
});

test('missingSourcePages lists source pages that are not in the binder', () => {
  const pages = [page('keep', 0), { uid: 'other', docId: 'other-doc', pageIndex: 1, rotation: 0 }];
  pages[0].docId = 'doc';
  assert.deepEqual(missingSourcePages('doc', 3, pages), [1, 2]);
});
