import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from '../www/vendor/pdf-lib.esm.min.js';
import { uncompressedImagePdf } from '../testlib/image-pdf.js';
import { mergeBinder } from '../www/lib/merge.js';
import {
  compressBinder,
  planCompressedRender,
  rasterSize,
} from '../www/lib/compress.js';

const TINY_JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
  'base64',
));

function stubPage(rotate) {
  const calls = [];
  return {
    calls,
    rotate,
    getViewport({ scale = 1, rotation = 0 }) {
      calls.push({ scale, rotation });
      const swap = rotation === 90 || rotation === 270;
      return {
        width: (swap ? 250 : 100) * scale,
        height: (swap ? 100 : 250) * scale,
      };
    },
  };
}

test('rasterSize keeps small pages near their size and caps the long edge', () => {
  const letter = rasterSize(612, 792);
  assert.equal(letter.scale, 2);
  assert.deepEqual([letter.width, letter.height], [1224, 1584]);

  const poster = rasterSize(2000, 3000);
  assert.ok(poster.scale < 1);
  assert.equal(Math.max(poster.width, poster.height), 1600);
  assert.equal(poster.height, 1600);
  assert.equal(poster.width, 1067);
});

test('planCompressedRender adds the binder rotation on top of the file rotation', () => {
  const sideways = stubPage(0);
  const turned = planCompressedRender(sideways, 90);
  assert.equal(turned.rotation, 90);
  assert.deepEqual(sideways.calls, [
    { scale: 1, rotation: 90 },
    { scale: 2, rotation: 90 },
  ]);
  assert.equal(turned.pageWidth, 250);
  assert.equal(turned.pageHeight, 100);
  assert.equal(turned.pixelWidth, 500);
  assert.equal(turned.pixelHeight, 200);

  const already = stubPage(270);
  const upright = planCompressedRender(already, 90);
  assert.equal(upright.rotation, 0);
  assert.equal(already.calls[0].rotation, 0);
  assert.equal(upright.pageWidth, 100);
  assert.equal(upright.pageHeight, 250);
});

test('compressBinder writes picture pages in binder order and drops the original image data', async () => {
  const fat = await uncompressedImagePdf();
  const documents = new Map([
    ['a', fat],
    ['b', await uncompressedImagePdf({ pageWidth: 200, pageHeight: 400, imageWidth: 40, imageHeight: 40 })],
  ]);
  const pages = [
    { docId: 'b', pageIndex: 0, rotation: 90 },
    { docId: 'a', pageIndex: 0, rotation: 0 },
  ];
  const seen = [];
  const compressed = await compressBinder(documents, pages, async (bytes, page) => {
    seen.push({ bytes, pageIndex: page.pageIndex, rotation: page.rotation });
    return page.docId === 'b'
      ? { jpeg: TINY_JPEG, width: 400, height: 200 }
      : { jpeg: TINY_JPEG, width: 612, height: 792 };
  });
  const copied = await mergeBinder(documents, [pages[1]]);

  assert.deepEqual(seen.map((item) => item.pageIndex), [0, 0]);
  assert.deepEqual(seen.map((item) => item.rotation), [90, 0]);
  assert.equal(seen[0].bytes, documents.get('b'));
  assert.ok(compressed.byteLength < copied.byteLength / 3);

  const saved = await PDFDocument.load(compressed);
  assert.equal(saved.getCreator(), 'PDF Merger (local)');
  assert.equal(saved.getPageCount(), 2);
  assert.deepEqual(saved.getPage(0).getSize(), { width: 400, height: 200 });
  assert.equal(saved.getPage(0).getRotation().angle, 0);
  assert.deepEqual(saved.getPage(1).getSize(), { width: 612, height: 792 });
  assert.ok(Buffer.from(compressed).includes(Buffer.from([0xff, 0xd8])));
});

test('compressBinder rejects an empty binder, a missing file, a bad page, and a bad picture', async () => {
  const documents = new Map([['a', await uncompressedImagePdf({ imageWidth: 8, imageHeight: 8 })]]);
  const page = { docId: 'a', pageIndex: 0, rotation: 0 };
  let renders = 0;
  const render = async () => {
    renders += 1;
    return { jpeg: TINY_JPEG, width: 10, height: 10 };
  };

  await assert.rejects(() => compressBinder(documents, [], render), /at least one page/);
  await assert.rejects(
    () => compressBinder(documents, [{ docId: 'missing', pageIndex: 0, rotation: 0 }], render),
    /no longer loaded/,
  );
  await assert.rejects(
    () => compressBinder(documents, [{ docId: 'a', pageIndex: -1, rotation: 0 }], render),
    /outside the file/,
  );
  await assert.rejects(
    () => compressBinder(documents, [page], async () => ({ jpeg: new Uint8Array([1, 2, 3, 4]), width: 10, height: 10 })),
    /could not be compressed/,
  );
  await assert.rejects(
    () => compressBinder(documents, [page], async () => {
      throw new Error('This PDF is password-protected. Remove the password, then add it again.');
    }),
    /password-protected/,
  );
  assert.equal(renders, 0);
});
