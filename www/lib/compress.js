import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';
import { normalizeRotation } from './arrange.js';

// pdf-lib copies embedded images unchanged, so a scanned page stays large.
// A compressed export paints each page to a JPEG and builds a new file.
export const COMPRESS_MAX_LONG_EDGE = 1600;
export const COMPRESS_MAX_SCALE = 2;
export const COMPRESS_JPEG_QUALITY = 0.72;

function nextTurn() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function rasterSize(pageWidth, pageHeight, limits = {}) {
  const maxLongEdge = limits.maxLongEdge ?? COMPRESS_MAX_LONG_EDGE;
  const maxScale = limits.maxScale ?? COMPRESS_MAX_SCALE;
  if (!(pageWidth > 0) || !(pageHeight > 0) || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
    throw new Error('A page has no size.');
  }
  if (!(maxLongEdge > 0) || !(maxScale > 0)) throw new Error('A page has no size.');
  const longEdge = Math.max(pageWidth, pageHeight);
  const scale = Math.min(maxScale, maxLongEdge / longEdge);
  return {
    scale,
    width: Math.max(1, Math.round(pageWidth * scale)),
    height: Math.max(1, Math.round(pageHeight * scale)),
  };
}

// pdf.js treats `rotation` as the whole page turn, replacing /Rotate.
// The binder stores only the extra clockwise turn, so add them first.
export function planCompressedRender(pdfPage, userRotation, limits) {
  const rotation = normalizeRotation((Number(pdfPage.rotate) || 0) + (Number(userRotation) || 0));
  const display = pdfPage.getViewport({ scale: 1, rotation });
  const fit = rasterSize(display.width, display.height, limits);
  const viewport = pdfPage.getViewport({ scale: fit.scale, rotation });
  return {
    rotation,
    pageWidth: display.width,
    pageHeight: display.height,
    pixelWidth: Math.max(1, Math.ceil(viewport.width)),
    pixelHeight: Math.max(1, Math.ceil(viewport.height)),
    viewport,
  };
}

function jpegBytes(value) {
  if (value instanceof Uint8Array && value.byteLength >= 4 && value[0] === 0xff && value[1] === 0xd8) {
    return value;
  }
  throw new Error('A page could not be compressed.');
}

async function appendCompressedPage(out, frame) {
  if (!frame) throw new Error('A page could not be compressed.');
  const jpeg = jpegBytes(frame.jpeg);
  if (!(frame.width > 0) || !(frame.height > 0) || !Number.isFinite(frame.width) || !Number.isFinite(frame.height)) {
    throw new Error('A page has no size.');
  }
  let image;
  try {
    image = await out.embedJpg(jpeg);
  } catch {
    throw new Error('A page could not be compressed.');
  }
  const page = out.addPage([frame.width, frame.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
  });
}

export async function compressBinder(documents, pages, renderPage, onProgress) {
  if (typeof renderPage !== 'function') {
    throw new Error('A page could not be compressed.');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Add at least one page before exporting.');
  }

  const out = await PDFDocument.create();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!page || typeof page.docId !== 'string' || !Number.isInteger(page.pageIndex) || page.pageIndex < 0) {
      throw new Error('A page is outside the file.');
    }
    const bytes = documents instanceof Map ? documents.get(page.docId) : undefined;
    if (!bytes) throw new Error('A page refers to a file that is no longer loaded.');
    if (typeof onProgress === 'function') onProgress(index, pages.length);
    await nextTurn();
    let frame;
    try {
      frame = await renderPage(bytes, page, index);
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
      throw new Error('A page could not be compressed.');
    }
    await appendCompressedPage(out, frame);
  }

  out.setProducer('PDF Merger (local)');
  out.setCreator('PDF Merger (local)');
  return out.save();
}
