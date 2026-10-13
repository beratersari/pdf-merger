# PDF Merger

A local page binder for Windows. Add several PDFs, reorder or delete pages, rotate a page if it is sideways, and export one PDF.

Your files stay in the browser tab. The small local server only delivers this app. It does not receive the PDFs, and the page does not send them anywhere.

## Start

Double-click `run.bat`, or run:

```
node server.mjs
```

Leave that window open while you work. It opens the app at `http://127.0.0.1:8765/`. If that port is busy, it tries the next one. Ctrl+C quits.

Node.js 20 or newer is required.

## Use

1. Add PDFs with the button, or drop them on the window.
2. Drag pages to reorder them. Select several to move, rotate, or delete them together.
3. Export PDF. The download is the merged file, with the original pages copied as they are. The arrow beside Export opens Export compressed, which writes a smaller file. Scanned pages shrink the most. Text in that copy is part of the picture and cannot be selected.

Removing a whole file, or clearing the workspace, drops those pages and clears undo. Closing the tab drops the files from memory.

## Third-party code

Page export uses [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). Page previews use [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Their licenses are in `www/vendor/licenses/`, next to the font licenses in `www/vendor/standard_fonts/`.
