import { EncryptedPDFError, PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';
import { normalizeRotation } from './arrange.js';

async function loadDocument(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = String(error?.message || '');
    if (
      error instanceof EncryptedPDFError
      || error?.name === 'EncryptedPDFError'
      || /is encrypted/i.test(message)
    ) {
      throw new Error('This PDF is password-protected. Remove the password, then add it again.');
    }
    throw new Error('This file could not be read as a PDF.');
  }
}

export async function mergeBinder(documents, pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Add at least one page before exporting.');
  }

  const loaded = new Map();
  const out = await PDFDocument.create();

  for (const page of pages) {
    if (!page || typeof page.docId !== 'string' || !Number.isInteger(page.pageIndex)) {
      throw new Error('A page is outside the file.');
    }
    let src = loaded.get(page.docId);
    if (!src) {
      const bytes = documents instanceof Map ? documents.get(page.docId) : undefined;
      if (!bytes) throw new Error('A page refers to a file that is no longer loaded.');
      src = await loadDocument(bytes);
      loaded.set(page.docId, src);
    }
    if (page.pageIndex < 0 || page.pageIndex >= src.getPageCount()) {
      throw new Error('A page is outside the file.');
    }

    let copied;
    try {
      [copied] = await out.copyPages(src, [page.pageIndex]);
    } catch {
      throw new Error('A page could not be copied into the export.');
    }
    const rotation = normalizeRotation((copied.getRotation().angle || 0) + (page.rotation || 0));
    copied.setRotation(degrees(rotation));
    out.addPage(copied);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  out.setProducer('PDF Merger (local)');
  out.setCreator('PDF Merger (local)');
  return out.save();
}
