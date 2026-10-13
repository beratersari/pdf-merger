import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'www', 'vendor');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

copyFile(
  path.join(root, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.esm.min.js'),
  path.join(vendor, 'pdf-lib.esm.min.js'),
);
copyFile(
  path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs'),
  path.join(vendor, 'pdf.mjs'),
);
copyFile(
  path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs'),
  path.join(vendor, 'pdf.worker.mjs'),
);
fs.cpSync(path.join(root, 'node_modules', 'pdfjs-dist', 'cmaps'), path.join(vendor, 'cmaps'), {
  recursive: true,
});
fs.cpSync(
  path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts'),
  path.join(vendor, 'standard_fonts'),
  { recursive: true },
);
copyFile(
  path.join(root, 'node_modules', 'pdf-lib', 'LICENSE.md'),
  path.join(vendor, 'licenses', 'pdf-lib-LICENSE.md'),
);
copyFile(
  path.join(root, 'node_modules', 'pdfjs-dist', 'LICENSE'),
  path.join(vendor, 'licenses', 'pdfjs-LICENSE'),
);
