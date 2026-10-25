/**
 * Self-checks for the contrast maths: no Desktop, no screenshot, no fixture.
 *
 * The synthetic images are deliberately adversarial. They prove the property
 * the Desktop assertions depend on: an oracle that returns the farthest colour
 * in a box passes low-contrast text sitting next to a high-contrast decoy,
 * while the pinned oracle measures the element's own painted colour and fails.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import {
  CHANNEL_TOLERANCE,
  PNG_SIGNATURE,
  boundaryContrast,
  channelDistance,
  contrastRatio,
  decodePng,
  glyphContrast,
  hex,
  paintedOver,
  paint,
  textContrast,
  type Edges,
  type Image,
  type Measurement,
  type Rect,
} from './visual-contrast.js';

const FULL: Rect = { x: 0, y: 0, width: 40, height: 20 };

/** A synthetic screenshot: a solid surface waiting for painted blocks. */
function screenshot(width: number, height: number, colour = 0xffffff): Image {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data[pixel * 4] = (colour >> 16) & 255;
    data[pixel * 4 + 1] = (colour >> 8) & 255;
    data[pixel * 4 + 2] = colour & 255;
    data[pixel * 4 + 3] = 255;
  }
  return { width, height, data };
}

function block(image: Image, rect: Rect, colour: number): void {
  for (let y = rect.y; y < rect.y + rect.height; y++)
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const index = (y * image.width + x) * 4;
      image.data[index] = (colour >> 16) & 255;
      image.data[index + 1] = (colour >> 8) & 255;
      image.data[index + 2] = colour & 255;
    }
}

/** The acceptance condition: an observed pinned cluster and the minimum ratio. */
const certifies = (measurement: Measurement, minimum: number): boolean =>
  measurement.matched && measurement.ratio >= minimum;

/** A synthetic image exposes no computed glyph source: nothing is proven. */
const unproven = {
  paint: null,
  reason: 'a synthetic image exposes no computed glyph source',
} as const;

/** Minimal PNG writer: the decoder under test only claims to read these. */
function encodePng(width: number, height: number, rgb: number[]): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3;
      raw[row + 1 + x * 3] = rgb[source]!;
      raw[row + 2 + x * 3] = rgb[source + 1]!;
      raw[row + 3 + x * 3] = rgb[source + 2]!;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const name = Buffer.from(type, 'ascii');
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0, 0);
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('2:1 text beside a black decoy fails the pinned oracle while the farthest colour reads maximum', () => {
  const image = screenshot(FULL.width, FULL.height);
  block(image, { x: 4, y: 4, width: 20, height: 8 }, 0xb7b7b7); // 160 px of 2:1 text
  block(image, { x: 28, y: 10, width: 8, height: 8 }, 0x000000); // 64 px decoy

  // The farthest colour is only a diagnostic: it still reports the decoy.
  const farthest = glyphContrast(image, FULL, unproven);
  assert.equal(hex(farthest.foreground), '#000000');
  assert.ok(
    (farthest.diagnostic ?? 0) >= 4.5,
    `the farthest-colour diagnostic reaches ${(farthest.diagnostic ?? 0).toFixed(2)}:1`,
  );
  assert.equal(
    certifies(farthest, 4.5),
    false,
    'an unvalidated glyph never certifies',
  );

  const measured = textContrast(image, FULL, paint('#b7b7b7', 1));
  assert.equal(measured.matched, true);
  assert.equal(hex(measured.background), '#ffffff');
  assert.equal(hex(measured.foreground), '#b7b7b7');
  assert.ok(
    measured.ratio < 4.5,
    `2:1 text must stay below 4.5:1, measured ${measured.ratio.toFixed(2)}:1`,
  );
  assert.ok(
    Math.abs(measured.ratio - 2) < 0.06,
    `2:1 text measures ${measured.ratio.toFixed(3)}:1`,
  );

  // A colour nothing painted is reported, never adopted from the decoy.
  const unpainted = textContrast(image, FULL, paint('#123456', 1));
  assert.equal(unpainted.matched, false);
  assert.ok(unpainted.expected !== null);
  assert.ok(
    channelDistance(unpainted.foreground, unpainted.expected) >
      CHANNEL_TOLERANCE,
  );

  // A cluster below the support floor cannot speak for the text either: the
  // two painted pixels are reported as unsupported, not adopted as the text.
  const tiny = screenshot(10, 10);
  block(tiny, { x: 1, y: 1, width: 2, height: 1 }, 0xb7b7b7);
  const supported = textContrast(
    tiny,
    { x: 0, y: 0, width: 10, height: 10 },
    paint('#b7b7b7', 1),
  );
  assert.equal(supported.matched, false);
  assert.equal(hex(supported.foreground), '#ffffff');
  assert.ok(supported.expected !== null);
  assert.ok(
    channelDistance(supported.foreground, supported.expected) >
      CHANNEL_TOLERANCE,
  );
});

test('a low-contrast glyph beside a black decoy never certifies the icon requirement', () => {
  const image = screenshot(FULL.width, FULL.height);
  block(image, { x: 4, y: 4, width: 20, height: 8 }, 0xb7b7b7); // 2:1 glyph
  block(image, { x: 28, y: 10, width: 8, height: 8 }, 0x000000); // decoy

  // Paint proven by computed style: the pinned glyph decides, not the decoy.
  const proven = glyphContrast(image, FULL, {
    paint: paint('#b7b7b7', 1),
    reason: null,
  });
  assert.equal(proven.matched, true);
  assert.equal(hex(proven.foreground), '#b7b7b7');
  assert.ok(
    (proven.diagnostic ?? 0) >= 3,
    'the decoy still inflates the diagnostic',
  );
  assert.equal(
    certifies(proven, 3),
    false,
    'a 2:1 glyph cannot satisfy the 3:1 essential requirement',
  );

  // Paint not provable: explicitly unvalidated, so the maximum contrast the
  // farthest colour reports cannot certify it either.
  const unvalidated = glyphContrast(image, FULL, unproven);
  assert.equal(unvalidated.matched, false);
  assert.equal(unvalidated.ratio, 0);
  assert.equal(unvalidated.expected, null);
  assert.equal(typeof unvalidated.reason, 'string');
  assert.ok((unvalidated.diagnostic ?? 0) >= 20);
  assert.equal(certifies(unvalidated, 3), false);

  // A proven glyph that really reaches the requirement does certify.
  const strong = screenshot(20, 20);
  block(strong, { x: 5, y: 5, width: 10, height: 5 }, 0x595959);
  const accepted = glyphContrast(
    strong,
    { x: 0, y: 0, width: 20, height: 20 },
    { paint: paint('#595959', 1), reason: null },
  );
  assert.equal(accepted.reason, null);
  assert.equal(certifies(accepted, 3), true);
});

test('known 4.5:1 and 7:1 pairs measure their documented ratio', () => {
  assert.equal(contrastRatio(0x000000, 0xffffff), 21);

  for (const pair of [
    { foreground: 0x767676, minimum: 4.5, ceiling: 4.6 },
    { foreground: 0x595959, minimum: 7, ceiling: 7.1 },
  ]) {
    const image = screenshot(20, 20);
    block(image, { x: 5, y: 5, width: 10, height: 5 }, pair.foreground);
    const measured = textContrast(
      image,
      { x: 0, y: 0, width: 20, height: 20 },
      paint(hex(pair.foreground), 1),
    );
    assert.equal(measured.matched, true);
    assert.equal(measured.foreground, pair.foreground);
    assert.equal(measured.ratio, contrastRatio(pair.foreground, 0xffffff));
    assert.ok(measured.ratio >= pair.minimum, `${hex(pair.foreground)} passes`);
    assert.ok(
      measured.ratio < pair.ceiling,
      `${hex(pair.foreground)} must not be inflated: ${measured.ratio}`,
    );
  }

  // Compositing happens on gamma-encoded channels, as the browser does it.
  assert.equal(paintedOver(paint('rgba(0, 0, 0, 0.5)', 1), 0xffffff), 0x808080);
  assert.equal(paintedOver(paint('#000000', 0.5), 0xffffff), 0x808080);
  assert.equal(paintedOver(paint('rgb(255, 0, 0)', 0.5), 0x000000), 0x800000);
  assert.equal(paint('rgb(0, 0, 0)', 0.5).alpha, 0.5);
  assert.equal(paint('color(srgb 0 0 0 / 50%)', 1).alpha, 0.5);

  // Unknown colour syntax and impossible opacity fail closed.
  assert.throws(() => paint('hsl(0, 0%, 0%)', 1));
  assert.throws(() => paint('#fff', 2));
});

test('the boundary band follows the computed border widths and never adopts a decoy', () => {
  const image = screenshot(30, 30);
  const border = 0xb7b7b7;
  block(image, { x: 0, y: 0, width: 30, height: 4 }, border);
  block(image, { x: 0, y: 26, width: 30, height: 4 }, border);
  block(image, { x: 0, y: 0, width: 4, height: 30 }, border);
  block(image, { x: 26, y: 0, width: 4, height: 30 }, border);
  block(image, { x: 10, y: 0, width: 6, height: 4 }, 0x000000); // decoy in the band

  const frame: Rect = { x: 0, y: 0, width: 30, height: 30 };
  const edge = { width: 4, paint: paint('#b7b7b7', 1) };
  const edges: Edges = {
    top: edge,
    right: edge,
    bottom: edge,
    left: edge,
  };

  const measured = boundaryContrast(image, frame, edges);
  assert.equal(measured.matched, true);
  assert.equal(measured.edge, 'top');
  assert.equal(hex(measured.foreground), '#b7b7b7');
  assert.equal(measured.pixels, 120, 'the real 4px band, not a fixed 2px one');
  assert.equal(measured.cluster, 96, 'the decoy is measured as the decoy');
  assert.ok(
    measured.ratio < 3,
    `a 2:1 boundary must fail the 3:1 requirement, measured ${measured.ratio.toFixed(2)}:1`,
  );

  // The farthest colour on the same band is diagnostic evidence only.
  const farthest = glyphContrast(
    image,
    { x: 0, y: 0, width: 30, height: 4 },
    unproven,
  );
  assert.equal(hex(farthest.foreground), '#000000');
  assert.ok((farthest.diagnostic ?? 0) >= 3);
  assert.equal(certifies(farthest, 3), false);

  const flat: Edges = {
    top: { width: 0, paint: paint('#b7b7b7', 1) },
    right: { width: 0, paint: paint('#b7b7b7', 1) },
    bottom: { width: 0, paint: paint('#b7b7b7', 1) },
    left: { width: 0, paint: paint('#b7b7b7', 1) },
  };
  const absent = boundaryContrast(image, frame, flat);
  assert.equal(absent.matched, false);
  assert.equal(absent.pixels, 0, 'no border measures no boundary');

  // The band spans the whole pixels a fractional box can paint onto, so a
  // border rendered one row below its layout box is still observed.
  const shifted = screenshot(30, 30);
  block(shifted, { x: 0, y: 1, width: 30, height: 4 }, border);
  const fractional = boundaryContrast(
    shifted,
    { x: 0, y: 0.4, width: 30, height: 30 },
    {
      top: { width: 4, paint: paint('#b7b7b7', 1) },
      right: { width: 0, paint: paint('#b7b7b7', 1) },
      bottom: { width: 0, paint: paint('#b7b7b7', 1) },
      left: { width: 0, paint: paint('#b7b7b7', 1) },
    },
  );
  assert.equal(fractional.matched, true);
  assert.equal(hex(fractional.foreground), '#b7b7b7');
  assert.equal(fractional.cluster, 120);
  assert.equal(fractional.pixels, 150, 'rows 0 to 4 of the envelope');
});

test('a truncated or foreign screenshot fails closed instead of decoding', () => {
  const png = encodePng(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const missingScanline = encodePng(2, 1, [255, 0, 0, 0, 255, 0]);
  missingScanline.writeUInt32BE(3, 16);
  missingScanline.writeUInt32BE(
    crc32(missingScanline.subarray(12, 29)) >>> 0,
    29,
  );
  assert.throws(() => decodePng(missingScanline), /scanline/i);
  const image = decodePng(png);
  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  assert.equal(image.data.length, 16);
  assert.equal(
    hex((image.data[0]! << 16) | (image.data[1]! << 8) | image.data[2]!),
    '#ff0000',
  );
  assert.equal(
    hex((image.data[12]! << 16) | (image.data[13]! << 8) | image.data[14]!),
    '#ffffff',
  );

  for (const damaged of [
    png.subarray(0, png.length - 12), // the IEND chunk is gone
    png.subarray(0, png.length - 3), // the last chunk is cut mid-record
    png.subarray(0, 20), // the header is cut short
    png.subarray(0, 8), // the signature alone
    Buffer.from('not a png at all'),
  ])
    assert.throws(
      () => decodePng(damaged),
      /PNG/,
      `decoding ${damaged.length} bytes must throw`,
    );
});
