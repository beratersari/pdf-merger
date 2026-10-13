import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts, degrees } from '../www/vendor/pdf-lib.esm.min.js';
import { encryptedPdf } from '../testlib/encrypted-pdf.js';
import { mergeBinder } from '../www/lib/merge.js';

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of pages) {
    const sheet = doc.addPage([page.width, page.height]);
    if (page.rotation) sheet.setRotation(degrees(page.rotation));
    sheet.drawText(page.label, { x: 24, y: page.height - 72, size: 24, font });
  }
  return doc.save();
}

async function sizes(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const size = page.getSize();
    return { width: size.width, height: size.height, rotation: page.getRotation().angle };
  });
}

test('mergeBinder exports only the requested pages in binder order', async () => {
  const documents = new Map([
    ['a', await makePdf([
      { label: 'A1', width: 200, height: 300 },
      { label: 'A2', width: 220, height: 340 },
    ])],
    ['b', await makePdf([
      { label: 'B1', width: 260, height: 380 },
    ])],
  ]);
  const bytes = await mergeBinder(documents, [
    { docId: 'b', pageIndex: 0, rotation: 0 },
    { docId: 'a', pageIndex: 1, rotation: 0 },
  ]);
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.deepEqual(await sizes(bytes), [
    { width: 260, height: 380, rotation: 0 },
    { width: 220, height: 340, rotation: 0 },
  ]);
});

test('mergeBinder can place the same source page twice with different rotations', async () => {
  const documents = new Map([
    ['a', await makePdf([{ label: 'TOP', width: 300, height: 400, rotation: 90 }])],
  ]);
  const bytes = await mergeBinder(documents, [
    { docId: 'a', pageIndex: 0, rotation: 0 },
    { docId: 'a', pageIndex: 0, rotation: 90 },
  ]);
  assert.deepEqual(await sizes(bytes), [
    { width: 300, height: 400, rotation: 90 },
    { width: 300, height: 400, rotation: 180 },
  ]);
});

test('mergeBinder rejects an empty binder, a missing file, and a bad page', async () => {
  const documents = new Map([
    ['a', await makePdf([{ label: 'A', width: 200, height: 200 }])],
  ]);
  await assert.rejects(() => mergeBinder(documents, []), /at least one page/);
  await assert.rejects(
    () => mergeBinder(documents, [{ docId: 'missing', pageIndex: 0, rotation: 0 }]),
    /no longer loaded/,
  );
  await assert.rejects(
    () => mergeBinder(documents, [{ docId: 'a', pageIndex: 3, rotation: 0 }]),
    /outside the file/,
  );
});

test('mergeBinder rejects a password-protected PDF', async () => {
  const documents = new Map([['locked', encryptedPdf({ userPassword: 'secret' })]]);
  await assert.rejects(
    () => mergeBinder(documents, [{ docId: 'locked', pageIndex: 0, rotation: 0 }]),
    /password-protected/,
  );
});
