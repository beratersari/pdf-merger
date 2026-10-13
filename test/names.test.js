import assert from 'node:assert/strict';
import test from 'node:test';
import { safePdfName } from '../www/lib/names.js';

test('safePdfName adds a pdf extension and strips path characters', () => {
  assert.equal(safePdfName('quarterly report'), 'quarterly report.pdf');
  assert.equal(safePdfName('a/b\\c?.pdf'), 'a-b-c-.pdf');
  assert.equal(safePdfName('..\\secret.pdf'), '..-secret.pdf');
  assert.equal(safePdfName(' \n '), 'merged.pdf');
  assert.equal(safePdfName('.pdf'), 'merged.pdf');
});
