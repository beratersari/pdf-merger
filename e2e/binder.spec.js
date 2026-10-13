import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from '../www/vendor/pdf-lib.esm.min.js';
import { encryptedPdf } from '../testlib/encrypted-pdf.js';
import { uncompressedImagePdf } from '../testlib/image-pdf.js';

async function writeSample(file, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of pages) {
    const sheet = doc.addPage([page.width, page.height]);
    sheet.drawText(page.label, { x: 36, y: page.height / 2, size: 42, font });
  }
  fs.writeFileSync(file, await doc.save());
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => {
    dialog.accept();
  });
});

test('arranges pages and exports one PDF without leaving the computer', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-merger-'));
  const alpha = path.join(dir, 'alpha.pdf');
  const beta = path.join(dir, 'beta.pdf');
  await writeSample(alpha, [{ label: 'ALPHA', width: 220, height: 320 }]);
  await writeSample(beta, [
    { label: 'BETA-1', width: 240, height: 360 },
    { label: 'BETA-2', width: 260, height: 400 },
  ]);

  const leaked = [];
  page.on('request', (request) => {
    const url = request.url();
    // Local antivirus can inject its own script into Edge. That is outside this app.
    if (/kaspersky-labs\.com/i.test(url)) return;
    if (!url.startsWith('http://127.0.0.1:8899/')) leaked.push(url);
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      leaked.push(`${request.method()} ${url}`);
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'PDF Merger' })).toBeVisible();
  await expect(page.getByText('Your PDFs stay in this browser tab. They are not uploaded.')).toBeVisible();
  await page.locator('#file-input').setInputFiles([alpha, beta]);
  await expect(page.locator('.page-card')).toHaveCount(3);
  await expect(page.locator('.page-card[data-state="ready"]')).toHaveCount(3);

  const painted = await page.locator('.page-card canvas').first().evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] < 240 || pixels[index + 1] < 240 || pixels[index + 2] < 240) dark += 1;
    }
    return dark;
  });
  expect(painted).toBeGreaterThan(10);
  await page.screenshot({ path: 'test-results/binder-desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'Delete beta.pdf page 1', exact: true }).click();
  await expect(page.locator('.page-card')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.page-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Delete beta.pdf page 1', exact: true }).click();
  await expect(page.locator('.source-page')).toHaveText(['Page 1', 'Page 2']);

  await page.locator('.page-card').nth(1).locator('.page-check').check();
  await page.getByRole('button', { name: 'Move earlier', exact: true }).click();
  await expect(page.locator('.source-name')).toHaveText(['beta.pdf', 'alpha.pdf']);
  await expect(page.locator('.source-page')).toHaveText(['Page 2', 'Page 1']);

  await page.locator('.page-card').nth(1).dragTo(page.locator('.page-card').nth(0), {
    sourcePosition: { x: 90, y: 40 },
    targetPosition: { x: 12, y: 40 },
  });
  await expect(page.locator('.source-name')).toHaveText(['alpha.pdf', 'beta.pdf']);

  const alphaCanvas = page.locator('.page-card').first().locator('canvas');
  const beforeRotate = await alphaCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  await page.getByRole('button', { name: 'Rotate alpha.pdf page 1 clockwise', exact: true }).click();
  await expect(page.locator('.page-card').first()).toHaveAttribute('data-state', 'ready');
  const afterRotate = await alphaCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  expect(afterRotate).toEqual({ width: beforeRotate.height, height: beforeRotate.width });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 2 pages', exact: true }).click();
  const download = await downloadPromise;
  const exported = path.join(dir, 'merged.pdf');
  await download.saveAs(exported);

  const saved = await PDFDocument.load(fs.readFileSync(exported));
  expect(saved.getPageCount()).toBe(2);
  expect(saved.getPage(0).getSize()).toEqual({ width: 220, height: 320 });
  expect(saved.getPage(0).getRotation().angle).toBe(90);
  expect(saved.getPage(1).getSize()).toEqual({ width: 260, height: 400 });
  expect(saved.getPage(1).getRotation().angle).toBe(0);

  const locked = path.join(dir, 'locked.pdf');
  fs.writeFileSync(locked, encryptedPdf({ userPassword: 'secret' }));
  await page.locator('#file-input').setInputFiles(locked);
  await expect(page.getByRole('alert')).toContainText('password-protected');
  await expect(page.locator('.page-card')).toHaveCount(2);

  fs.writeFileSync(path.join(dir, 'notes.pdf'), 'not a pdf');
  await page.locator('#file-input').setInputFiles(path.join(dir, 'notes.pdf'));
  await expect(page.getByRole('alert')).toContainText('could not be read as a PDF');
  await expect(page.locator('.page-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep working', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Clear everything', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.locator('.page-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Clear everything', exact: true }).click();
  await expect(page.locator('.page-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Drop PDFs here' })).toBeVisible();

  await page.locator('#file-input').setInputFiles(exported);
  await expect(page.locator('.page-card[data-state="ready"]')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/exported-preview.png', fullPage: true });
  expect(leaked).toEqual([]);
});

test('narrow window still shows add and export', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Add PDFs', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Drop PDFs here' })).toBeVisible();
  await page.screenshot({ path: 'test-results/binder-narrow.png', fullPage: true });
});

function darkestCorner(corners) {
  return ['nw', 'ne', 'se', 'sw'].reduce((best, key) => (corners[key] < corners[best] ? key : best));
}

function clockwiseCorner(name) {
  const order = ['nw', 'ne', 'se', 'sw'];
  return order[(order.indexOf(name) + 1) % 4];
}

async function cornerMeans(canvas) {
  return canvas.evaluate((node) => {
    const context = node.getContext('2d');
    const { width, height } = node;
    const sample = (x, y) => {
      const pixels = context.getImageData(x, y, 8, 8).data;
      let total = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        total += pixels[index] + pixels[index + 1] + pixels[index + 2];
      }
      return total / ((pixels.length / 4) * 3);
    };
    const inset = Math.max(8, Math.round(Math.min(width, height) * 0.08));
    return {
      nw: sample(inset, inset),
      ne: sample(width - inset - 8, inset),
      se: sample(width - inset - 8, height - inset - 8),
      sw: sample(inset, height - inset - 8),
    };
  });
}

async function clearBinder(page) {
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Clear everything', exact: true }).click();
  await expect(page.locator('.page-card')).toHaveCount(0);
}

test('exports a smaller picture PDF from the compress option', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-merger-compress-'));
  const scan = path.join(dir, 'scan.pdf');
  fs.writeFileSync(scan, await uncompressedImagePdf({ imageWidth: 400, imageHeight: 500 }));
  const originalSize = fs.statSync(scan).size;
  expect(originalSize).toBeGreaterThan(500_000);

  const leaked = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/kaspersky-labs\.com/i.test(url)) return;
    if (!url.startsWith('http://127.0.0.1:8899/')) leaked.push(url);
    if (request.method() !== 'GET' && request.method() !== 'HEAD') leaked.push(`${request.method()} ${url}`);
  });

  await page.goto('/');
  await page.locator('#file-input').setInputFiles(scan);
  await expect(page.locator('.page-card[data-state="ready"]')).toHaveCount(1);
  const originalMark = darkestCorner(await cornerMeans(page.locator('.page-card canvas')));

  await page.getByRole('button', { name: 'Export options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Export compressed' })).toBeFocused();
  await expect(page.getByText('text cannot be selected')).toBeVisible();
  await page.screenshot({ path: 'test-results/compress-menu.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#export-menu')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export options', exact: true })).toBeFocused();

  const losslessPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 1 page', exact: true }).click();
  const lossless = await losslessPromise;
  const losslessPath = path.join(dir, 'lossless.pdf');
  await lossless.saveAs(losslessPath);
  expect(fs.statSync(losslessPath).size).toBeGreaterThan(originalSize * 0.5);

  await page.getByRole('button', { name: 'Export options', exact: true }).click();
  const compressedPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export compressed' }).click();
  const compressed = await compressedPromise;
  const compressedPath = path.join(dir, 'small.pdf');
  await compressed.saveAs(compressedPath);
  const compressedSize = fs.statSync(compressedPath).size;
  expect(compressedSize).toBeLessThan(originalSize / 3);

  const saved = await PDFDocument.load(fs.readFileSync(compressedPath));
  expect(saved.getPageCount()).toBe(1);
  expect(Math.round(saved.getPage(0).getSize().width)).toBe(612);
  expect(Math.round(saved.getPage(0).getSize().height)).toBe(792);
  expect(saved.getPage(0).getRotation().angle).toBe(0);
  await expect(page.getByRole('status')).toContainText('picture');

  await clearBinder(page);
  await page.locator('#file-input').setInputFiles(compressedPath);
  await expect(page.locator('.page-card[data-state="ready"]')).toHaveCount(1);
  expect(darkestCorner(await cornerMeans(page.locator('.page-card canvas')))).toBe(originalMark);

  await clearBinder(page);
  await page.locator('#file-input').setInputFiles(scan);
  await expect(page.locator('.page-card[data-state="ready"]')).toHaveCount(1);
  const canvas = page.locator('.page-card canvas');
  const beforeRotate = await canvas.evaluate((node) => ({ width: node.width, height: node.height }));
  await page.getByRole('button', { name: 'Rotate scan.pdf page 1 clockwise', exact: true }).click();
  await expect(page.locator('.page-card')).toHaveAttribute('data-state', 'ready');
  const afterRotate = await canvas.evaluate((node) => ({ width: node.width, height: node.height }));
  expect(afterRotate).toEqual({ width: beforeRotate.height, height: beforeRotate.width });

  await page.getByRole('button', { name: 'Export options', exact: true }).click();
  const rotatedPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export compressed' }).click();
  const rotated = await rotatedPromise;
  const rotatedPath = path.join(dir, 'turned.pdf');
  await rotated.saveAs(rotatedPath);
  const turned = await PDFDocument.load(fs.readFileSync(rotatedPath));
  expect(Math.round(turned.getPage(0).getSize().width)).toBe(792);
  expect(Math.round(turned.getPage(0).getSize().height)).toBe(612);
  expect(turned.getPage(0).getRotation().angle).toBe(0);

  await clearBinder(page);
  await page.locator('#file-input').setInputFiles(rotatedPath);
  await expect(page.locator('.page-card[data-state="ready"]')).toHaveCount(1);
  expect(darkestCorner(await cornerMeans(page.locator('.page-card canvas')))).toBe(clockwiseCorner(originalMark));
  expect(leaked).toEqual([]);
});
