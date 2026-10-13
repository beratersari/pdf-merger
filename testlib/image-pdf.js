import {
  PDFDocument,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from '../www/vendor/pdf-lib.esm.min.js';

// A page whose picture is stored uncompressed, so a real recompress can shrink it.
export async function uncompressedImagePdf({
  pageWidth = 612,
  pageHeight = 792,
  imageWidth = 80,
  imageHeight = 100,
} = {}) {
  const data = new Uint8Array(imageWidth * imageHeight * 3);
  const markWidth = Math.max(1, Math.round(imageWidth * 0.2));
  const markHeight = Math.max(1, Math.round(imageHeight * 0.18));
  for (let y = 0; y < imageHeight; y += 1) {
    const tone = 210 + Math.round((y / Math.max(1, imageHeight - 1)) * 20);
    for (let x = 0; x < imageWidth; x += 1) {
      const offset = (y * imageWidth + x) * 3;
      const marked = x < markWidth && y < markHeight;
      data[offset] = marked ? 0 : tone;
      data[offset + 1] = marked ? 0 : tone;
      data[offset + 2] = marked ? 0 : tone;
    }
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([pageWidth, pageHeight]);
  const stream = doc.context.stream(data, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: imageWidth,
    Height: imageHeight,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  });
  const name = page.node.newXObject('Im', doc.context.register(stream));
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(pageWidth, 0, 0, pageHeight, 0, 0),
    drawObject(name),
    popGraphicsState(),
  );
  return doc.save({ useObjectStreams: false });
}
