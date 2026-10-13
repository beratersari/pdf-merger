import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory } from '../www/lib/history.js';

function page(uid, pageIndex = 0, rotation = 0) {
  return { uid, docId: 'doc', pageIndex, rotation };
}

test('history undo and redo restore page edits without sharing objects', () => {
  const history = createHistory(2);
  const first = [page('a', 0, 0)];
  history.push(first);
  first[0].rotation = 90;
  history.push([page('b')]);
  history.push([page('c')]);
  const undone = history.undo([page('d')]);
  assert.equal(undone[0].uid, 'c');
  const undoneAgain = history.undo(undone);
  assert.equal(undoneAgain[0].uid, 'b');
  assert.equal(history.undo(undoneAgain), null);
  const redone = history.redo(undoneAgain);
  assert.equal(redone[0].uid, 'c');
});

test('a new edit clears pages that were waiting to be redone', () => {
  const history = createHistory();
  history.push([page('a')]);
  history.undo([page('b')]);
  history.push([page('c')]);
  assert.equal(history.canRedo, false);
});
