import {
  missingSourcePages,
  moveEarlier,
  moveLater,
  normalizeRotation,
  removeUids,
  reorder,
  rotateUids,
} from './lib/arrange.js';
import { createHistory } from './lib/history.js';
import { COMPRESS_JPEG_QUALITY, compressBinder, planCompressedRender } from './lib/compress.js';
import { mergeBinder } from './lib/merge.js';
import { displayName, safePdfName } from './lib/names.js';
import * as pdfjs from './vendor/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const cMapUrl = new URL('./vendor/cmaps/', import.meta.url).href;
const standardFontDataUrl = new URL('./vendor/standard_fonts/', import.meta.url).href;

const documents = new Map();
const history = createHistory();
let pages = [];
let selected = new Set();
let anchorUid = null;
let dragging = false;
let draggingUids = [];
let fileDragDepth = 0;
let adding = false;
let exporting = false;
let exportKind = null;
let confirmAction = null;
let previouslyFocused = null;

const fileInput = document.querySelector('#file-input');
const fileList = document.querySelector('#file-list');
const fileEmpty = document.querySelector('#file-empty');
const clearButton = document.querySelector('#clear-button');
const exportForm = document.querySelector('#export-form');
const exportName = document.querySelector('#export-name');
const exportButton = document.querySelector('#export-button');
const exportOptions = document.querySelector('#export-options');
const exportMenu = document.querySelector('#export-menu');
const exportCompressed = document.querySelector('#export-compressed');
const exportActions = document.querySelector('.export-actions');
const pageList = document.querySelector('#page-list');
const empty = document.querySelector('#empty');
const summary = document.querySelector('#binder-summary');
const statusEl = document.querySelector('#status');
const errors = document.querySelector('#errors');
const dropOverlay = document.querySelector('#drop-overlay');
const confirmRoot = document.querySelector('#confirm');
const confirmTitle = document.querySelector('#confirm-title');
const confirmText = document.querySelector('#confirm-text');
const confirmCancel = document.querySelector('#confirm-cancel');
const confirmOk = document.querySelector('#confirm-ok');
const undoButton = document.querySelector('#undo-button');
const redoButton = document.querySelector('#redo-button');
const selectAllButton = document.querySelector('#select-all-button');
const rotateSelectedButton = document.querySelector('#rotate-selected-button');
const moveEarlierButton = document.querySelector('#move-earlier-button');
const moveLaterButton = document.querySelector('#move-later-button');
const deleteSelectedButton = document.querySelector('#delete-selected-button');

const jobs = [];
let activeJobs = 0;

function enqueue(task) {
  jobs.push(task);
  pump();
}

function pump() {
  if (exporting) return;
  while (activeJobs < 1 && jobs.length > 0) {
    const task = jobs.shift();
    activeJobs += 1;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => {
        activeJobs -= 1;
        // Let clicks and scrolling run between page rasters.
        setTimeout(pump, 0);
      });
  }
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const card = entry.target;
    card.dataset.visible = entry.isIntersecting ? '1' : '0';
    if (!entry.isIntersecting) continue;
    const page = pages.find((item) => item.uid === card.dataset.uid);
    if (page) requestThumb(card, page);
  }
}, { rootMargin: '400px' });

function setStatus(message) {
  statusEl.textContent = message;
}

function showError(message) {
  const item = document.createElement('div');
  item.className = 'error-item';
  const text = document.createElement('p');
  text.textContent = message;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => item.remove());
  item.append(text, dismiss);
  errors.append(item);
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function summaryText() {
  if (pages.length === 0) return 'No pages yet.';
  const files = new Set(pages.map((page) => page.docId)).size;
  const pageWord = pages.length === 1 ? 'page' : 'pages';
  const fileWord = files === 1 ? 'file' : 'files';
  return `${pages.length} ${pageWord} from ${files} ${fileWord} will export in this order.`;
}

function commit(next) {
  history.push(pages);
  pages = next;
  render();
}

function sameOrder(left, right) {
  return left.length === right.length && left.every((page, index) => page.uid === right[index].uid);
}

function renderToolbar() {
  const hasSelection = selected.size > 0;
  const allSelected = pages.length > 0 && pages.every((page) => selected.has(page.uid));
  const busy = exporting;
  undoButton.disabled = busy || !history.canUndo;
  redoButton.disabled = busy || !history.canRedo;
  selectAllButton.disabled = busy || pages.length === 0;
  selectAllButton.textContent = allSelected ? 'Clear selection' : 'Select all';
  rotateSelectedButton.disabled = busy || !hasSelection;
  moveEarlierButton.disabled = busy || !hasSelection;
  moveLaterButton.disabled = busy || !hasSelection;
  deleteSelectedButton.disabled = busy || !hasSelection;
  clearButton.disabled = busy || (documents.size === 0 && pages.length === 0);
  fileInput.disabled = adding || busy;
  exportButton.disabled = busy || pages.length === 0;
  exportOptions.disabled = busy || pages.length === 0;
  if (busy) exportButton.textContent = exportKind === 'compressed' ? 'Compressing…' : 'Exporting…';
  else if (pages.length === 0) exportButton.textContent = 'Export PDF';
  else exportButton.textContent = `Export ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`;
  document.body.classList.toggle('is-exporting', busy);
  document.body.setAttribute('aria-busy', adding || busy ? 'true' : 'false');
  if (busy || pages.length === 0) closeExportMenu(false);
}

function renderFiles() {
  fileEmpty.hidden = documents.size > 0;
  fileList.replaceChildren();
  for (const doc of documents.values()) {
    const inBinder = pages.filter((page) => page.docId === doc.id).length;
    const item = document.createElement('li');
    item.className = 'file-item';
    const name = document.createElement('p');
    name.className = 'file-name';
    name.textContent = doc.name;
    const meta = document.createElement('p');
    meta.className = 'file-meta';
    meta.textContent = `${inBinder} of ${doc.pageCount} kept · ${formatBytes(doc.byteLength)}`;
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore pages';
    restore.disabled = inBinder === doc.pageCount;
    restore.addEventListener('click', () => restorePages(doc.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove file';
    remove.addEventListener('click', () => confirmRemoveFile(doc.id));
    actions.append(restore, remove);
    const glyph = document.createElement('span');
    glyph.className = 'file-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = 'PDF';
    const body = document.createElement('div');
    body.className = 'file-body';
    body.append(name, meta, actions);
    item.append(glyph, body);
    fileList.append(item);
  }
}

function createCard(page) {
  const item = document.createElement('li');
  item.className = 'page-card';
  item.draggable = true;
  item.dataset.uid = page.uid;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const fallback = document.createElement('p');
  fallback.className = 'thumb-fallback';
  fallback.textContent = 'Preview unavailable';
  thumb.append(canvas, fallback);

  const label = document.createElement('label');
  label.className = 'page-select';
  const box = document.createElement('input');
  box.className = 'page-check';
  box.type = 'checkbox';
  const text = document.createElement('span');
  const source = document.createElement('span');
  source.className = 'source-name';
  const origin = document.createElement('span');
  origin.className = 'source-page';
  const position = document.createElement('span');
  position.className = 'binder-pos';
  const turn = document.createElement('span');
  turn.className = 'page-turn';
  turn.hidden = true;
  const meta = document.createElement('span');
  meta.className = 'page-meta';
  meta.append(origin, position, turn);
  text.append(source, meta);
  label.append(box, text);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const rotate = document.createElement('button');
  rotate.type = 'button';
  rotate.className = 'rotate';
  rotate.textContent = 'Rotate';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete';
  remove.textContent = 'Delete';
  actions.append(rotate, remove);

  item.append(thumb, label, actions);
  observer.observe(item);
  return item;
}

function updateCard(card, page, index) {
  const doc = documents.get(page.docId);
  const name = doc?.name ?? 'Unknown file';
  const sourcePage = page.pageIndex + 1;
  card.querySelector('.source-name').textContent = name;
  card.querySelector('.source-page').textContent = `Page ${sourcePage}`;
  card.querySelector('.binder-pos').textContent = `Position ${index + 1}`;
  const turn = card.querySelector('.page-turn');
  const rotation = normalizeRotation(page.rotation);
  turn.hidden = rotation === 0;
  turn.textContent = rotation === 0 ? '' : `${rotation}° clockwise`;
  const box = card.querySelector('.page-check');
  box.checked = selected.has(page.uid);
  card.classList.toggle('is-selected', selected.has(page.uid));
  card.querySelector('.rotate').setAttribute('aria-label', `Rotate ${name} page ${sourcePage} clockwise`);
  card.querySelector('.delete').setAttribute('aria-label', `Delete ${name} page ${sourcePage}`);
  card.dataset.rotation = String(normalizeRotation(page.rotation));
  if (card.dataset.visible === '1') requestThumb(card, page);
}

function renderPages() {
  const existing = new Map([...pageList.children].map((card) => [card.dataset.uid, card]));
  const fragment = document.createDocumentFragment();
  pages.forEach((page, index) => {
    const card = existing.get(page.uid) ?? createCard(page);
    updateCard(card, page, index);
    fragment.append(card);
  });
  for (const [uid, card] of existing) {
    if (!pages.some((page) => page.uid === uid)) observer.unobserve(card);
  }
  pageList.replaceChildren(fragment);
}

function render() {
  summary.textContent = summaryText();
  empty.hidden = pages.length > 0;
  pageList.hidden = pages.length === 0;
  renderFiles();
  renderPages();
  renderToolbar();
}

function clearDropMarkers() {
  pageList.classList.remove('is-drop-end');
  for (const card of pageList.querySelectorAll('.page-card')) {
    card.classList.remove('is-drop-before', 'is-drop-after');
  }
}

// One raster per source page. User rotation only copies that bitmap, so
// turning a page does not parse or paint the PDF again.
const MAX_PREVIEWS = 40;
const previews = new Map();

function previewKey(docId, pageIndex) {
  return `${docId}:${pageIndex}`;
}

function releasePreview(entry) {
  if (!entry) return;
  if (entry.renderTask) {
    try {
      entry.renderTask.cancel();
    } catch {
      // The raster finished before cancel landed.
    }
    entry.renderTask = null;
  }
  if (entry.canvas) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = null;
  }
}

function touchPreview(key) {
  const entry = previews.get(key);
  if (!entry) return;
  previews.delete(key);
  previews.set(key, entry);
}

function evictPreviews() {
  for (const [key, entry] of previews) {
    if (previews.size <= MAX_PREVIEWS) break;
    if (entry.status === 'loading') continue;
    releasePreview(entry);
    previews.delete(key);
  }
}

function releaseDocumentPreviews(docId) {
  const prefix = `${docId}:`;
  for (const [key, entry] of previews) {
    if (!key.startsWith(prefix)) continue;
    releasePreview(entry);
    previews.delete(key);
  }
}

function releaseAllPreviews() {
  for (const entry of previews.values()) releasePreview(entry);
  previews.clear();
}

function paintRotated(canvas, source, rotation) {
  const quarter = normalizeRotation(rotation) / 90;
  const swap = quarter % 2 === 1;
  const width = swap ? source.height : source.width;
  const height = swap ? source.width : source.height;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.save();
  if (quarter === 1) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (quarter === 2) {
    context.translate(width, height);
    context.rotate(Math.PI);
  } else if (quarter === 3) {
    context.translate(0, height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, 0, 0);
  context.restore();
}

function showPreview(card, page) {
  const key = previewKey(page.docId, page.pageIndex);
  const preview = previews.get(key);
  const rotation = String(normalizeRotation(page.rotation));
  if (!preview || preview.status === 'loading') {
    card.dataset.pendingRotation = rotation;
    if (card.dataset.state !== 'ready') card.dataset.state = 'loading';
    return;
  }
  if (preview.status === 'error' || !preview.canvas) {
    card.dataset.state = 'error';
    return;
  }
  touchPreview(key);
  paintRotated(card.querySelector('canvas'), preview.canvas, page.rotation);
  card.dataset.state = 'ready';
  card.dataset.drawnRotation = rotation;
}

function paintCardsForPreview(key) {
  for (const page of pages) {
    if (previewKey(page.docId, page.pageIndex) !== key) continue;
    const card = pageList.querySelector(`[data-uid="${page.uid}"]`);
    if (!card || card.dataset.visible !== '1') continue;
    showPreview(card, page);
  }
}

function requestThumb(card, page) {
  const rotation = String(normalizeRotation(page.rotation));
  if (card.dataset.drawnRotation === rotation && card.dataset.state === 'ready') return;
  const key = previewKey(page.docId, page.pageIndex);
  const preview = previews.get(key);
  if (preview?.status === 'ready' || preview?.status === 'error') {
    showPreview(card, page);
    return;
  }
  card.dataset.pendingRotation = rotation;
  if (card.dataset.state !== 'ready') card.dataset.state = 'loading';
  if (preview?.status === 'loading') return;
  const entry = { status: 'loading', canvas: null, renderTask: null };
  previews.set(key, entry);
  evictPreviews();
  enqueue(() => renderBasePreview(key, page.docId, page.pageIndex, entry));
}

async function renderBasePreview(key, docId, pageIndex, entry) {
  let pdfPage = null;
  try {
    const doc = documents.get(docId);
    if (!doc || previews.get(key) !== entry) return;
    pdfPage = await doc.pdf.getPage(pageIndex + 1);
    if (!documents.has(docId) || previews.get(key) !== entry) return;
    const unscaled = pdfPage.getViewport({ scale: 1 });
    const longEdge = Math.max(unscaled.width, unscaled.height, 1);
    const viewport = pdfPage.getViewport({ scale: Math.min(1.25, 480 / longEdge) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Preview unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = pdfPage.render({
      canvasContext: context,
      viewport,
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    });
    entry.renderTask = task;
    try {
      await task.promise;
    } finally {
      if (entry.renderTask === task) entry.renderTask = null;
    }
    if (!documents.has(docId) || previews.get(key) !== entry) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    entry.status = 'ready';
    entry.canvas = canvas;
    paintCardsForPreview(key);
  } catch (error) {
    if (error?.name === 'RenderingCancelledException' || previews.get(key) !== entry) return;
    entry.status = 'error';
    paintCardsForPreview(key);
  } finally {
    pdfPage?.cleanup();
  }
}

function loadErrorMessage(error) {
  const name = error?.name || '';
  const message = String(error?.message || '');
  if (name === 'PasswordException' || /password/i.test(message)) {
    return 'This PDF is password-protected. Remove the password, then add it again.';
  }
  return 'This file could not be read as a PDF.';
}

async function addOne(file) {
  const name = displayName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('This file is empty.');
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    throw new Error(loadErrorMessage(error));
  }
  if (pdf.numPages < 1) {
    await pdf.destroy();
    throw new Error('This PDF has no pages.');
  }
  const id = crypto.randomUUID();
  documents.set(id, {
    id,
    name,
    byteLength: bytes.byteLength,
    pageCount: pdf.numPages,
    bytes,
    pdf,
  });
  const added = [];
  for (let index = 0; index < pdf.numPages; index += 1) {
    added.push({ uid: crypto.randomUUID(), docId: id, pageIndex: index, rotation: 0 });
  }
  commit(pages.concat(added));
  const pageWord = pdf.numPages === 1 ? 'page' : 'pages';
  const large = bytes.byteLength > 40 * 1024 * 1024 ? ' Large file, so previews may take a moment.' : '';
  setStatus(`Added ${name}, ${pdf.numPages} ${pageWord}.${large}`);
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0 || adding || exporting) return;
  adding = true;
  renderToolbar();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const name = displayName(file.name);
    setStatus(`Opening ${index + 1} of ${files.length}: ${name}`);
    try {
      await addOne(file);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'This file could not be opened.';
      showError(`${name}: ${reason}`);
    }
  }
  adding = false;
  render();
  const pageWord = pages.length === 1 ? 'page' : 'pages';
  setStatus(`${pages.length} ${pageWord} in the binder. Nothing leaves this computer.`);
}

function restorePages(docId) {
  if (exporting) return;
  const doc = documents.get(docId);
  if (!doc) return;
  const missing = missingSourcePages(docId, doc.pageCount, pages);
  if (missing.length === 0) return;
  const added = missing.map((pageIndex) => ({
    uid: crypto.randomUUID(),
    docId,
    pageIndex,
    rotation: 0,
  }));
  commit(pages.concat(added));
  const pageWord = added.length === 1 ? 'page' : 'pages';
  setStatus(`Restored ${added.length} ${pageWord} from ${doc.name}.`);
}

function dropDocument(docId) {
  if (exporting) return null;
  const doc = documents.get(docId);
  if (!doc) return;
  releaseDocumentPreviews(docId);
  documents.delete(docId);
  doc.pdf.destroy().catch(() => {});
  pages = pages.filter((page) => page.docId !== docId);
  selected = new Set([...selected].filter((uid) => pages.some((page) => page.uid === uid)));
  history.clear();
  render();
  return doc.name;
}

function confirmRemoveFile(docId) {
  const doc = documents.get(docId);
  if (!doc) return;
  openConfirm({
    title: `Remove ${doc.name}?`,
    text: 'Pages from this file leave the binder. Undo history is cleared.',
    confirmLabel: 'Remove file',
    onConfirm: () => {
      const name = dropDocument(docId);
      if (name) setStatus(`Removed ${name}. Undo history was cleared.`);
    },
  });
}

function clearWorkspace() {
  if (exporting) return;
  releaseAllPreviews();
  for (const doc of documents.values()) doc.pdf.destroy().catch(() => {});
  documents.clear();
  pages = [];
  selected = new Set();
  anchorUid = null;
  history.clear();
  errors.replaceChildren();
  render();
  setStatus('Workspace cleared. Nothing leaves this computer.');
}

function openConfirm({ title, text, confirmLabel, onConfirm }) {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  confirmOk.textContent = confirmLabel;
  confirmAction = onConfirm;
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  confirmRoot.hidden = false;
  confirmCancel.focus();
}

function closeConfirm() {
  confirmRoot.hidden = true;
  confirmAction = null;
  if (previouslyFocused?.isConnected) previouslyFocused.focus();
  previouslyFocused = null;
}

function deleteUids(uids) {
  if (exporting) return;
  const list = [...uids];
  if (list.length === 0) return;
  const focusIndex = pages.findIndex((page) => page.uid === list[0]);
  for (const uid of list) selected.delete(uid);
  commit(removeUids(pages, list));
  const pageWord = list.length === 1 ? 'page' : 'pages';
  setStatus(`Removed ${list.length} ${pageWord}.`);
  const cards = [...pageList.querySelectorAll('.page-card')];
  const next = cards[focusIndex] || cards[focusIndex - 1];
  next?.querySelector('.page-check')?.focus();
}

function rotateUidsNow(uids, status) {
  if (exporting || uids.length === 0) return;
  const next = rotateUids(pages, uids);
  history.push(pages);
  pages = next;
  const wanted = new Set(uids);
  for (const card of pageList.querySelectorAll('.page-card')) {
    if (!wanted.has(card.dataset.uid)) continue;
    const page = pages.find((item) => item.uid === card.dataset.uid);
    if (!page) continue;
    card.dataset.rotation = String(normalizeRotation(page.rotation));
    if (card.dataset.visible === '1') requestThumb(card, page);
  }
  renderToolbar();
  setStatus(status);
}

function moveSelected(direction) {
  if (exporting || selected.size === 0) return;
  const next = direction < 0 ? moveEarlier(pages, selected) : moveLater(pages, selected);
  if (sameOrder(pages, next)) {
    setStatus(direction < 0 ? 'Those pages are already at the start.' : 'Those pages are already at the end.');
    return;
  }
  commit(next);
  setStatus('Moved the selected pages.');
}

function undo() {
  if (exporting) return;
  const previous = history.undo(pages);
  if (!previous) return;
  pages = previous;
  selected = new Set([...selected].filter((uid) => pages.some((page) => page.uid === uid)));
  render();
  setStatus('Undid the last change.');
}

function redo() {
  if (exporting) return;
  const next = history.redo(pages);
  if (!next) return;
  pages = next;
  selected = new Set([...selected].filter((uid) => pages.some((page) => page.uid === uid)));
  render();
  setStatus('Redid the last change.');
}

fileInput.addEventListener('change', () => {
  const chosen = fileInput.files;
  if (chosen && chosen.length > 0) addFiles(chosen);
  fileInput.value = '';
});

clearButton.addEventListener('click', () => {
  if (documents.size === 0 && pages.length === 0) return;
  openConfirm({
    title: 'Clear the workspace?',
    text: 'This removes every file and page from the binder.',
    confirmLabel: 'Clear everything',
    onConfirm: clearWorkspace,
  });
});

confirmCancel.addEventListener('click', closeConfirm);
confirmOk.addEventListener('click', () => {
  const action = confirmAction;
  closeConfirm();
  action?.();
});
confirmRoot.addEventListener('mousedown', (event) => {
  if (event.target === confirmRoot) closeConfirm();
});
confirmRoot.addEventListener('keydown', (event) => {
  if (confirmRoot.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeConfirm();
    return;
  }
  if (event.key !== 'Tab') return;
  const buttons = [confirmCancel, confirmOk];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
selectAllButton.addEventListener('click', () => {
  if (exporting || pages.length === 0) return;
  const allSelected = pages.every((page) => selected.has(page.uid));
  selected = allSelected ? new Set() : new Set(pages.map((page) => page.uid));
  anchorUid = pages[0]?.uid ?? null;
  render();
});
rotateSelectedButton.addEventListener('click', () => {
  const count = selected.size;
  rotateUidsNow([...selected], `Rotated ${count} ${count === 1 ? 'page' : 'pages'} clockwise.`);
});
moveEarlierButton.addEventListener('click', () => moveSelected(-1));
moveLaterButton.addEventListener('click', () => moveSelected(1));
deleteSelectedButton.addEventListener('click', () => deleteUids(selected));

pageList.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('button');
  const card = target?.closest('.page-card');
  if (button && card) {
    const uid = card.dataset.uid;
    if (button.classList.contains('rotate')) {
      rotateUidsNow([uid], 'Rotated 1 page clockwise.');
    } else if (button.classList.contains('delete')) {
      deleteUids([uid]);
    }
    return;
  }
  const box = target?.closest('.page-check');
  if (!box || !event.shiftKey || !anchorUid) return;
  event.preventDefault();
  const uid = box.closest('.page-card')?.dataset.uid;
  const start = pages.findIndex((page) => page.uid === anchorUid);
  const end = pages.findIndex((page) => page.uid === uid);
  if (start < 0 || end < 0) return;
  const [from, to] = start < end ? [start, end] : [end, start];
  selected = new Set(pages.slice(from, to + 1).map((page) => page.uid));
  render();
});

pageList.addEventListener('change', (event) => {
  const box = event.target instanceof Element ? event.target.closest('.page-check') : null;
  if (!box) return;
  const uid = box.closest('.page-card')?.dataset.uid;
  if (!uid) return;
  if (box.checked) selected.add(uid);
  else selected.delete(uid);
  anchorUid = uid;
  render();
});

pageList.addEventListener('dragstart', (event) => {
  if (exporting) {
    event.preventDefault();
    return;
  }
  const origin = event.target instanceof Element ? event.target : null;
  if (!origin || origin.closest('button, input, label')) {
    event.preventDefault();
    return;
  }
  const card = origin.closest('.page-card');
  if (!card) return;
  const uid = card.dataset.uid;
  const chosen = selected.has(uid) ? selected : new Set([uid]);
  draggingUids = pages.map((page) => page.uid).filter((item) => chosen.has(item));
  dragging = true;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', 'pages');
  card.classList.add('is-dragging');
});

pageList.addEventListener('dragend', () => {
  dragging = false;
  draggingUids = [];
  clearDropMarkers();
  for (const card of pageList.querySelectorAll('.page-card')) card.classList.remove('is-dragging');
});

pageList.addEventListener('dragover', (event) => {
  if (!dragging) return;
  event.preventDefault();
  const card = event.target instanceof Element ? event.target.closest('.page-card') : null;
  clearDropMarkers();
  if (!card) {
    pageList.classList.add('is-drop-end');
    return;
  }
  const rect = card.getBoundingClientRect();
  const before = event.clientX < rect.left + rect.width / 2;
  card.classList.add(before ? 'is-drop-before' : 'is-drop-after');
});

pageList.addEventListener('drop', (event) => {
  if (!dragging || exporting) return;
  event.preventDefault();
  const moving = draggingUids.slice();
  const card = event.target instanceof Element ? event.target.closest('.page-card') : null;
  let insertBefore = pages.length;
  if (card) {
    const index = pages.findIndex((page) => page.uid === card.dataset.uid);
    const rect = card.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    insertBefore = index < 0 ? pages.length : (before ? index : index + 1);
  }
  dragging = false;
  draggingUids = [];
  clearDropMarkers();
  const next = reorder(pages, moving, insertBefore);
  if (sameOrder(pages, next)) return;
  commit(next);
  setStatus('Reordered pages.');
});

function isFileDrag(event) {
  return [...event.dataTransfer.types].includes('Files');
}

window.addEventListener('dragenter', (event) => {
  if (dragging || !isFileDrag(event)) return;
  fileDragDepth += 1;
  dropOverlay.hidden = false;
});

window.addEventListener('dragover', (event) => {
  if (dragging || !isFileDrag(event)) return;
  event.preventDefault();
});

window.addEventListener('dragleave', (event) => {
  if (dragging || !isFileDrag(event)) return;
  fileDragDepth -= 1;
  if (fileDragDepth <= 0) {
    fileDragDepth = 0;
    dropOverlay.hidden = true;
  }
});

window.addEventListener('drop', (event) => {
  if (dragging || exporting || !isFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  dropOverlay.hidden = true;
  addFiles(event.dataTransfer.files);
});

document.addEventListener('keydown', (event) => {
  if (!confirmRoot.hidden) return;
  if (event.key === 'Escape' && !exportMenu.hidden) {
    event.preventDefault();
    closeExportMenu(true);
    return;
  }
  if (exporting) return;
  const typing = event.target instanceof HTMLTextAreaElement
    || (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox');
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
    if (typing) return;
    event.preventDefault();
    undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
    if (typing) return;
    event.preventDefault();
    redo();
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && selected.size > 0) {
    event.preventDefault();
    deleteUids(selected);
  }
});

function closeExportMenu(restoreFocus) {
  if (exportMenu.hidden) return;
  const focusInside = exportMenu.contains(document.activeElement);
  exportMenu.hidden = true;
  exportOptions.setAttribute('aria-expanded', 'false');
  if (restoreFocus || focusInside) {
    if (!exportOptions.disabled) exportOptions.focus();
    else exportName.focus();
  }
}

function openExportMenu() {
  if (exportOptions.disabled || exporting || pages.length === 0) return;
  exportMenu.hidden = false;
  exportOptions.setAttribute('aria-expanded', 'true');
  exportCompressed.focus();
}

function waitForPreviewIdle() {
  if (activeJobs === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (activeJobs === 0) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('A page could not be compressed.'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/jpeg', quality);
  });
}

let compressCanvas = null;

async function renderCompressedFrame(doc, page) {
  if (!doc?.pdf) throw new Error('A page refers to a file that is no longer loaded.');
  let pdfPage = null;
  if (!compressCanvas) compressCanvas = document.createElement('canvas');
  const canvas = compressCanvas;
  try {
    try {
      pdfPage = await doc.pdf.getPage(page.pageIndex + 1);
    } catch (error) {
      if (/invalid page/i.test(String(error?.message || ''))) throw new Error('A page is outside the file.');
      throw new Error('A page could not be compressed.');
    }
    const plan = planCompressedRender(pdfPage, page.rotation);
    canvas.width = plan.pixelWidth;
    canvas.height = plan.pixelHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('A page could not be compressed.');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in context) context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({
      canvasContext: context,
      viewport: plan.viewport,
      annotationMode: pdfjs.AnnotationMode.ENABLE,
      background: '#ffffff',
    }).promise;
    const jpeg = await canvasToJpeg(canvas, COMPRESS_JPEG_QUALITY);
    return { jpeg, width: plan.pageWidth, height: plan.pageHeight };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    pdfPage?.cleanup();
  }
}

function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sourceByteLength(list) {
  const ids = new Set(list.map((page) => page.docId));
  let total = 0;
  for (const id of ids) total += documents.get(id)?.byteLength || 0;
  return total;
}

async function runExport(kind) {
  if (exporting || pages.length === 0) return;
  exporting = true;
  exportKind = kind;
  closeExportMenu(false);
  renderToolbar();
  const list = pages.map((page) => ({
    docId: page.docId,
    pageIndex: page.pageIndex,
    rotation: page.rotation,
  }));
  const sourceLength = sourceByteLength(list);
  setStatus(kind === 'compressed' ? 'Compressing the PDF in this tab…' : 'Building the PDF in this tab…');
  try {
    const docs = new Map([...documents].map(([id, doc]) => [id, doc.bytes]));
    let bytes;
    if (kind === 'compressed') {
      await waitForPreviewIdle();
      bytes = await compressBinder(docs, list, async (_bytes, page, index) => {
        const count = list.length;
        setStatus(`Compressing page ${index + 1} of ${count}…`);
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        return renderCompressedFrame(documents.get(page.docId), page);
      });
    } else {
      bytes = await mergeBinder(docs, list);
    }
    const name = safePdfName(exportName.value);
    exportName.value = name;
    downloadBytes(bytes, name);
    const pageWord = list.length === 1 ? 'page' : 'pages';
    if (kind === 'compressed') {
      const size = formatBytes(bytes.byteLength);
      const smaller = bytes.byteLength < sourceLength * 0.9;
      setStatus(smaller
        ? `Exported a smaller copy as ${name} (${size}). Text in that file is part of the picture.`
        : `Exported ${name} (${size}). Those pages were already compact. Text in that file is part of the picture.`);
    } else {
      setStatus(`Exported ${list.length} ${pageWord} as ${name}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed.';
    showError(message);
    setStatus(kind === 'compressed' ? 'Compress failed.' : 'Export failed.');
  } finally {
    exporting = false;
    exportKind = null;
    if (compressCanvas) {
      compressCanvas.width = 0;
      compressCanvas.height = 0;
    }
    renderToolbar();
    pump();
  }
}

exportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runExport('original');
});

exportOptions.addEventListener('click', () => {
  if (exportMenu.hidden) openExportMenu();
  else closeExportMenu(false);
});

exportCompressed.addEventListener('click', () => {
  runExport('compressed');
});

exportMenu.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    exportCompressed.focus();
  }
});

document.addEventListener('pointerdown', (event) => {
  if (exportMenu.hidden) return;
  const target = event.target;
  if (target instanceof Node && exportActions.contains(target)) return;
  closeExportMenu(false);
});

window.addEventListener('beforeunload', (event) => {
  if (pages.length === 0) return;
  event.preventDefault();
  event.returnValue = '';
});

render();
