import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 as zlibCrc32, deflateSync } from 'node:zlib';
import {
  IMAGE_DATA_INVALID,
  IMAGE_PROPERTY_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_TOO_LARGE,
  dimensionLimit,
  embeddedImageNameMaxLength,
  pixelLimit,
  rawImageLimit,
} from '@rdlc/report-model/images';
import type { ImageRefusal, ValidatedPicture } from '@rdlc/report-model/images';
import {
  IMAGE_REMOVE_BLOCKED,
  IMAGE_RENAME_BLOCKED,
} from '@rdlc/report-model/images';
import {
  allocateDefinitionName,
  findDefinitionBlockers,
  validateDefinitionMutation,
  validateDefinitionName,
  validateImageCapability,
  validateImageProperty,
  crc32,
  decodeImageData,
  sniffFormat,
  validatePicture,
  walkJpeg,
  walkPng,
} from './images.js';
import { validateName } from './validate.js';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';

// Assumed contract (T009): validatePicture returns `ValidatedPicture | ImageRefusal`
// (a refusal is recognized by its `code` property); `digest` maps bytes to a hash string.

const picturesDirectory = 'tests/fixtures/images/pictures';
const picture = (name: string): Buffer =>
  readFileSync(`${picturesDirectory}/${name}`);
const digest = (bytes: Uint8Array): string => `digest:${bytes.length}`;

function isRefusal(
  result: ValidatedPicture | ImageRefusal,
): result is ImageRefusal {
  return 'code' in result;
}
function accepted(
  result: ValidatedPicture | ImageRefusal,
  context: string,
): ValidatedPicture {
  assert.ok(!isRefusal(result), `${context}: unexpected refusal`);
  return result;
}
function refused(
  result: ValidatedPicture | ImageRefusal,
  context: string,
): ImageRefusal {
  assert.ok(isRefusal(result), `${context}: expected a refusal`);
  return result;
}

// --- in-test builders (independent of the module under test) ---------------

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(zlibCrc32(body))]);
}
/** A grayscale 8-bit PNG with valid chunks and CRCs and an all-zero image. */
function syntheticPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk(
      'IDAT',
      deflateSync(Buffer.alloc((1 + width) * height), { level: 1 }),
    ),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function pngDimensions(file: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}
/** Offset of the first SOF0/SOF2 marker (0xFF, 0xC0|0xC2) of a JPEG. */
function sofOffset(jpeg: Uint8Array): number {
  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    assert.equal(jpeg[offset], 0xff);
    const marker = jpeg[offset + 1] as number;
    if (marker === 0xc0 || marker === 0xc2) return offset;
    offset +=
      2 + (((jpeg[offset + 2] as number) << 8) | (jpeg[offset + 3] as number));
  }
  throw new Error('no SOF marker');
}
function jpegWithDimensions(
  base: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const copy = Buffer.from(base);
  const sof = sofOffset(copy);
  copy.writeUInt16BE(height, sof + 5);
  copy.writeUInt16BE(width, sof + 7);
  return copy;
}
/** Insert COM segments right after SOI so the file is exactly `size` bytes. */
function padJpeg(base: Uint8Array, size: number): Buffer {
  let remaining = size - base.length;
  assert.ok(remaining >= 4, 'base JPEG is larger than the requested size');
  const segments: Buffer[] = [];
  while (remaining > 0) {
    const take = remaining <= 0xffff ? remaining : 0xfff0;
    const comment = Buffer.alloc(take);
    comment[0] = 0xff;
    comment[1] = 0xfe;
    comment.writeUInt16BE(take - 2, 2);
    segments.push(comment);
    remaining -= take;
  }
  return Buffer.concat([base.subarray(0, 2), ...segments, base.subarray(2)]);
}

const photo = (): Buffer => picture('photo.jpg');

const pngSignatureBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
function ihdrChunk(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return pngChunk('IHDR', header);
}
function pngFile(...chunks: Buffer[]): Buffer {
  return Buffer.concat([pngSignatureBytes, ...chunks]);
}

/** A JPEG segment: 0xFF, marker, big-endian length (payload + 2), payload. */
function jpegSegment(marker: number, payload: readonly number[]): Buffer {
  return Buffer.from([
    0xff,
    marker,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 0xff,
    ...payload,
  ]);
}
function jpegSof(marker: number, width: number, height: number): Buffer {
  return jpegSegment(marker, [
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  ]);
}
const jpegSoi = Buffer.from([0xff, 0xd8]);
const jpegEoi = Buffer.from([0xff, 0xd9]);
const jpegSos = jpegSegment(0xda, [1, 1, 0, 0, 63, 0]);
/** SOI, the given parts in order, then EOI unless `eoi` is false. */
function jpegFile(parts: readonly Uint8Array[], eoi = true): Buffer {
  return Buffer.concat([jpegSoi, ...parts, ...(eoi ? [jpegEoi] : [])]);
}

// --- fixtures --------------------------------------------------------------

test('accepted fixtures report format, mime, pixels, hash and stem', () => {
  const cases = [
    ['logo.png', 'png', 'image/png', { width: 120, height: 40 }, 'logo'],
    ['photo.jpg', 'jpeg', 'image/jpeg', { width: 200, height: 150 }, 'photo'],
    [
      'progressive.jpg',
      'jpeg',
      'image/jpeg',
      { width: 160, height: 120 },
      'progressive',
    ],
    // Format comes from the content, never from the extension.
    [
      'spoofed.png',
      'jpeg',
      'image/jpeg',
      { width: 200, height: 150 },
      'spoofed',
    ],
  ] as const;
  for (const [name, format, mime, pixels, fileStem] of cases) {
    const bytes = picture(name);
    const seen: Uint8Array[] = [];
    const result = accepted(
      validatePicture(bytes, name, (input: Uint8Array) => {
        seen.push(input);
        return `sha:${name}`;
      }),
      name,
    );
    assert.equal(result.format, format, name);
    assert.equal(result.mime, mime, name);
    assert.deepEqual(result.pixels, pixels, name);
    assert.equal(result.hash, `sha:${name}`, name);
    assert.equal(result.fileStem, fileStem, name);
    assert.ok(result.bytes instanceof Uint8Array, name);
    assert.deepEqual(Buffer.from(result.bytes), bytes, `${name}: unmodified`);
    assert.equal(seen.length, 1, `${name}: digest called once`);
    assert.deepEqual(Buffer.from(seen[0] as Uint8Array), bytes, name);
  }
});

test('refused fixtures carry the expected code and the file name', () => {
  const cases = [
    ['gif.gif', IMAGE_FORMAT_UNSUPPORTED],
    ['truncated.png', IMAGE_DATA_INVALID],
    ['bad-crc.png', IMAGE_DATA_INVALID],
    ['huge-dims.png', IMAGE_PIXELS_EXCEEDED],
    ['mega-pixels.png', IMAGE_PIXELS_EXCEEDED],
  ] as const;
  for (const [name, code] of cases) {
    const refusal = refused(validatePicture(picture(name), name, digest), name);
    assert.equal(refusal.code, code, name);
    assert.equal(refusal.fileName, name, name);
  }
});

test('oversized fixtures stay tied to the limit constants', () => {
  const huge = pngDimensions(picture('huge-dims.png'));
  assert.equal(huge.width, dimensionLimit + 1);
  const mega = pngDimensions(picture('mega-pixels.png'));
  assert.ok(mega.width <= dimensionLimit);
  assert.ok(mega.height <= dimensionLimit);
  assert.ok(mega.width * mega.height > pixelLimit);
  // Both fixtures are small files: only the pixel rules can refuse them.
  assert.ok(picture('huge-dims.png').length <= rawImageLimit);
  assert.ok(picture('mega-pixels.png').length <= rawImageLimit);
});

test('pixel refusals report which limit was exceeded', () => {
  const huge = refused(
    validatePicture(picture('huge-dims.png'), 'huge-dims.png', digest),
    'huge',
  );
  assert.equal(huge.limit, dimensionLimit);
  assert.equal(huge.actual, dimensionLimit + 1);
  const mega = pngDimensions(picture('mega-pixels.png'));
  const result = refused(
    validatePicture(picture('mega-pixels.png'), 'mega-pixels.png', digest),
    'mega',
  );
  assert.equal(result.limit, pixelLimit);
  assert.equal(result.actual, mega.width * mega.height);
});

test('a JPEG truncated before EOI or cut inside a segment is invalid data', () => {
  const bytes = photo();
  assert.equal(bytes[bytes.length - 2], 0xff);
  assert.equal(bytes[bytes.length - 1], 0xd9);
  for (const cut of [
    bytes.subarray(0, bytes.length - 2),
    bytes.subarray(0, 20),
  ]) {
    const refusal = refused(validatePicture(cut, 'cut.jpg', digest), 'cut');
    assert.equal(refusal.code, IMAGE_DATA_INVALID);
  }
});

test('empty and unrecognized content is an unsupported format', () => {
  for (const bytes of [
    new Uint8Array(0),
    Buffer.from('not an image at all'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  ]) {
    const refusal = refused(validatePicture(bytes, 'x.png', digest), 'x');
    assert.equal(refusal.code, IMAGE_FORMAT_UNSUPPORTED);
  }
});

// --- limits ----------------------------------------------------------------

test('rawImageLimit: exactly the limit passes, one byte more is refused', () => {
  const exact = padJpeg(photo(), rawImageLimit);
  assert.equal(exact.length, rawImageLimit);
  const ok = accepted(validatePicture(exact, 'big.jpg', digest), 'exact');
  assert.equal(ok.bytes.length, rawImageLimit);
  assert.deepEqual(ok.pixels, { width: 200, height: 150 });

  const over = padJpeg(photo(), rawImageLimit + 1);
  assert.equal(over.length, rawImageLimit + 1);
  const refusal = refused(validatePicture(over, 'big.jpg', digest), 'over');
  assert.equal(refusal.code, IMAGE_TOO_LARGE);
  assert.equal(refusal.limit, rawImageLimit);
  assert.equal(refusal.actual, rawImageLimit + 1);
  assert.equal(refusal.fileName, 'big.jpg');
});

test('dimensionLimit: exactly the limit passes, one more is refused (PNG)', () => {
  for (const [width, height] of [
    [dimensionLimit, 1],
    [1, dimensionLimit],
  ] as const) {
    const ok = accepted(
      validatePicture(syntheticPng(width, height), 'edge.png', digest),
      `${width}x${height}`,
    );
    assert.deepEqual(ok.pixels, { width, height });
  }
  for (const [width, height] of [
    [dimensionLimit + 1, 1],
    [1, dimensionLimit + 1],
  ] as const) {
    const refusal = refused(
      validatePicture(syntheticPng(width, height), 'edge.png', digest),
      `${width}x${height}`,
    );
    assert.equal(refusal.code, IMAGE_PIXELS_EXCEEDED);
    assert.equal(refusal.limit, dimensionLimit);
    assert.equal(refusal.actual, dimensionLimit + 1);
  }
});

test('dimensionLimit: exactly the limit passes, one more is refused (JPEG)', () => {
  const ok = accepted(
    validatePicture(
      jpegWithDimensions(photo(), dimensionLimit, 1),
      'edge.jpg',
      digest,
    ),
    'jpeg exact',
  );
  assert.deepEqual(ok.pixels, { width: dimensionLimit, height: 1 });
  for (const [width, height] of [
    [dimensionLimit + 1, 1],
    [1, dimensionLimit + 1],
  ] as const) {
    const refusal = refused(
      validatePicture(
        jpegWithDimensions(photo(), width, height),
        'edge.jpg',
        digest,
      ),
      `jpeg ${width}x${height}`,
    );
    assert.equal(refusal.code, IMAGE_PIXELS_EXCEEDED);
  }
});

test('pixelLimit: exactly the limit passes, more is refused, dimensions within limit', () => {
  // Smallest divisor of pixelLimit giving a width within dimensionLimit.
  let height = Math.ceil(pixelLimit / dimensionLimit);
  while (pixelLimit % height !== 0) height++;
  const width = pixelLimit / height;
  assert.ok(width <= dimensionLimit && width + 1 <= dimensionLimit);
  assert.equal(width * height, pixelLimit);

  const ok = accepted(
    validatePicture(syntheticPng(width, height), 'mp.png', digest),
    'exact pixels',
  );
  assert.deepEqual(ok.pixels, { width, height });

  // pixelLimit + 1 has no factorization within the dimension limit, so use the
  // smallest rectangle above it: one extra column.
  const refusal = refused(
    validatePicture(syntheticPng(width + 1, height), 'mp.png', digest),
    'over pixels',
  );
  assert.equal(refusal.code, IMAGE_PIXELS_EXCEEDED);
  assert.equal(refusal.limit, pixelLimit);
  assert.equal(refusal.actual, (width + 1) * height);
  assert.ok((refusal.actual as number) > pixelLimit);
});

// --- check order (contracts/image-import.md) -------------------------------

test('checks run in order: signature, structure, size, then pixels', () => {
  const oversize = rawImageLimit + 1024;
  // 1. signature before size: a huge non-image is an unsupported format.
  const garbage = Buffer.alloc(oversize, 0x41);
  assert.equal(
    refused(validatePicture(garbage, 'a.png', digest), 'garbage').code,
    IMAGE_FORMAT_UNSUPPORTED,
  );
  // 2. structure before size: an oversized PNG-signature file with no chunks.
  const signatureOnly = Buffer.alloc(oversize, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    signatureOnly,
  );
  assert.equal(
    refused(validatePicture(signatureOnly, 'b.png', digest), 'sig').code,
    IMAGE_DATA_INVALID,
  );
  // 3. size before pixels: oversized and over the dimension limit.
  const both = padJpeg(
    jpegWithDimensions(photo(), dimensionLimit + 1, 1),
    oversize,
  );
  assert.equal(
    refused(validatePicture(both, 'c.jpg', digest), 'both').code,
    IMAGE_TOO_LARGE,
  );
});

// --- payload leak rule (FR-025) --------------------------------------------

test('refusals carry only code, limit, actual and fileName and never content', () => {
  const inputs: Array<[string, Uint8Array]> = [
    ['gif.gif', picture('gif.gif')],
    ['truncated.png', picture('truncated.png')],
    ['bad-crc.png', picture('bad-crc.png')],
    ['huge-dims.png', picture('huge-dims.png')],
    ['mega-pixels.png', picture('mega-pixels.png')],
    ['over.jpg', padJpeg(photo(), rawImageLimit + 1)],
  ];
  for (const [name, bytes] of inputs) {
    const refusal = refused(validatePicture(bytes, name, digest), name);
    const allowed = new Set(['code', 'limit', 'actual', 'fileName']);
    for (const key of Object.keys(refusal))
      assert.ok(allowed.has(key), `${name}: unexpected key ${key}`);
    assert.equal(typeof refusal.code, 'string');
    assert.equal(refusal.fileName, name);
    const json = JSON.stringify(refusal);
    const buffer = Buffer.from(bytes);
    for (const start of [0, 8, 24, 64])
      for (const length of [16, 32]) {
        if (start + length > buffer.length) continue;
        const slice = buffer.subarray(start, start + length);
        assert.ok(
          !json.includes(slice.toString('base64')),
          `${name}: base64 payload leaked`,
        );
        assert.ok(
          !json.includes(slice.toString('hex')),
          `${name}: hex payload leaked`,
        );
      }
    assert.ok(json.length < 400, `${name}: refusal unexpectedly large`);
  }
});

// --- sniffFormat / crc32 ---------------------------------------------------

test('sniffFormat classifies by content signature', () => {
  assert.equal(sniffFormat(picture('logo.png')), 'png');
  assert.equal(sniffFormat(picture('photo.jpg')), 'jpeg');
  assert.equal(sniffFormat(picture('progressive.jpg')), 'jpeg');
  assert.equal(sniffFormat(picture('spoofed.png')), 'jpeg');
  assert.equal(sniffFormat(picture('gif.gif')), 'other');
  assert.equal(sniffFormat(new Uint8Array(0)), 'other');
  assert.equal(sniffFormat(Uint8Array.of(0x89, 0x50, 0x4e)), 'other');
});

test('crc32 is the unsigned IEEE 802.3 checksum', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const sample = picture('logo.png');
  assert.equal(crc32(sample), zlibCrc32(sample));
});

// --- adversarial JPEG walker -----------------------------------------------

test('walkJpeg accepts byte stuffing and RSTn markers inside a scan', () => {
  const scan = Buffer.from([
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0x00, 0xff, 0xd7, 0x78,
  ]);
  const file = jpegFile([jpegSof(0xc0, 30, 20), jpegSos, scan]);
  assert.deepEqual(walkJpeg(file), { width: 30, height: 20 });
  assert.ok(!isRefusal(validatePicture(file, 's.jpg', digest)));
  // A real marker after the scan data ends the scan and is walked as a segment.
  const second = jpegFile([
    jpegSof(0xc0, 30, 20),
    jpegSos,
    scan,
    jpegSegment(0xfe, [1, 2, 3]),
    jpegSos,
    scan,
  ]);
  assert.deepEqual(walkJpeg(second), { width: 30, height: 20 });
});

test('walkJpeg accepts FF fill bytes before a marker', () => {
  const fill = Buffer.from([0xff, 0xff, 0xff]);
  const scan = Buffer.from([0x12, 0x34]);
  const between = jpegFile([
    fill,
    jpegSof(0xc0, 30, 20).subarray(1),
    jpegSos,
    scan,
  ]);
  assert.deepEqual(walkJpeg(between), { width: 30, height: 20 });
  // Fill bytes between the scan data and EOI.
  const beforeEoi = Buffer.concat([
    jpegSoi,
    jpegSof(0xc0, 30, 20),
    jpegSos,
    scan,
    fill,
    jpegEoi,
  ]);
  assert.deepEqual(walkJpeg(beforeEoi), { width: 30, height: 20 });
  assert.ok(!isRefusal(validatePicture(beforeEoi, 'f.jpg', digest)));
});

test('walkJpeg refuses a stray lone FF at end of file', () => {
  const lone = Buffer.from([0xff]);
  assert.equal(
    walkJpeg(Buffer.concat([jpegSoi, jpegSof(0xc0, 30, 20), lone])),
    null,
  );
  assert.equal(
    walkJpeg(
      Buffer.concat([
        jpegSoi,
        jpegSof(0xc0, 30, 20),
        jpegSos,
        Buffer.from([1, 2]),
        lone,
      ]),
    ),
    null,
  );
  assert.equal(walkJpeg(Buffer.from([0xff, 0xd8, 0xff])), null);
  const refusal = refused(
    validatePicture(
      Buffer.concat([jpegSoi, jpegSof(0xc0, 30, 20), lone]),
      'lone.jpg',
      digest,
    ),
    'lone',
  );
  assert.equal(refusal.code, IMAGE_DATA_INVALID);
});

test('walkJpeg takes dimensions from the real SOF, not DHT, JPG or DAC segments', () => {
  // Payloads that would read as 5x6 if mistaken for a SOF.
  const decoy = [8, 0, 6, 0, 5, 1, 1, 0x11, 0];
  const real = jpegSof(0xc2, 30, 20);
  for (const marker of [0xc4, 0xc8, 0xcc]) {
    assert.deepEqual(
      walkJpeg(jpegFile([jpegSegment(marker, decoy), real, jpegSos])),
      { width: 30, height: 20 },
      `marker 0x${marker.toString(16)} before SOF`,
    );
    // Without a real SOF they must not be accepted as one.
    assert.equal(
      walkJpeg(jpegFile([jpegSegment(marker, decoy), jpegSos])),
      null,
      `marker 0x${marker.toString(16)} alone`,
    );
  }
  // All of them in a row, then the first real SOF wins over a later one.
  assert.deepEqual(
    walkJpeg(
      jpegFile([
        jpegSegment(0xc4, decoy),
        jpegSegment(0xc8, decoy),
        jpegSegment(0xcc, decoy),
        jpegSof(0xc1, 30, 20),
        jpegSof(0xc0, 7, 9),
      ]),
    ),
    { width: 30, height: 20 },
  );
});

test('walkJpeg refuses a JPEG with no SOF, a zero dimension or no EOI', () => {
  const scan = Buffer.from([0x12, 0x34]);
  assert.equal(walkJpeg(jpegFile([])), null);
  assert.equal(walkJpeg(jpegFile([jpegSegment(0xfe, [1, 2])])), null);
  assert.equal(walkJpeg(jpegFile([jpegSos, scan])), null);
  assert.equal(walkJpeg(jpegFile([jpegSof(0xc0, 0, 20), jpegSos, scan])), null);
  assert.equal(walkJpeg(jpegFile([jpegSof(0xc0, 30, 0), jpegSos, scan])), null);
  // Missing EOI: after a scan, after a segment, and directly after SOF.
  assert.equal(
    walkJpeg(jpegFile([jpegSof(0xc0, 30, 20), jpegSos, scan], false)),
    null,
  );
  assert.equal(
    walkJpeg(jpegFile([jpegSof(0xc0, 30, 20), jpegSegment(0xfe, [1])], false)),
    null,
  );
  assert.equal(walkJpeg(jpegFile([jpegSof(0xc0, 30, 20)], false)), null);
  for (const bytes of [
    jpegFile([]),
    jpegFile([jpegSof(0xc0, 0, 20), jpegSos, scan]),
    jpegFile([jpegSof(0xc0, 30, 20), jpegSos, scan], false),
  ])
    assert.equal(
      refused(validatePicture(bytes, 'bad.jpg', digest), 'bad').code,
      IMAGE_DATA_INVALID,
    );
});

test('walkJpeg accepts SOI, SOF and EOI without a scan (contract wording)', () => {
  assert.deepEqual(walkJpeg(jpegFile([jpegSof(0xc0, 30, 20)])), {
    width: 30,
    height: 20,
  });
});

// --- adversarial PNG walker ------------------------------------------------

test('walkPng refuses IHDR that is not first or is duplicated', () => {
  const idat = pngChunk('IDAT', deflateSync(Buffer.alloc(3)));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  assert.equal(walkPng(pngFile(idat, ihdrChunk(2, 2), iend)), null);
  assert.equal(walkPng(pngFile(iend)), null);
  assert.equal(
    walkPng(pngFile(ihdrChunk(2, 2), ihdrChunk(2, 2), idat, iend)),
    null,
  );
  assert.equal(
    walkPng(pngFile(ihdrChunk(2, 2), idat, ihdrChunk(2, 2), iend)),
    null,
  );
  assert.deepEqual(walkPng(pngFile(ihdrChunk(2, 2), idat, iend)), {
    width: 2,
    height: 2,
  });
  const refusal = refused(
    validatePicture(pngFile(idat, ihdrChunk(2, 2), iend), 'x.png', digest),
    'order',
  );
  assert.equal(refusal.code, IMAGE_DATA_INVALID);
});

test('walkPng refuses IEND with a non-zero length', () => {
  const idat = pngChunk('IDAT', deflateSync(Buffer.alloc(3)));
  const file = pngFile(
    ihdrChunk(2, 2),
    idat,
    pngChunk('IEND', Buffer.from([0])),
  );
  assert.equal(walkPng(file), null);
  assert.equal(
    refused(validatePicture(file, 'x.png', digest), 'iend').code,
    IMAGE_DATA_INVALID,
  );
});

test('walkPng refuses absurd or out-of-buffer chunk lengths without throwing', () => {
  const tail = Buffer.concat([
    Buffer.from('IDAT', 'latin1'),
    Buffer.alloc(8, 1),
  ]);
  for (const length of [0xffffffff, 0x80000000, 0x7fffffff, 1000, 21]) {
    const file = pngFile(ihdrChunk(2, 2), u32(length), tail);
    assert.doesNotThrow(() => walkPng(file), `length ${length}`);
    assert.equal(walkPng(file), null, `length ${length}`);
    assert.equal(
      refused(validatePicture(file, 'x.png', digest), `length ${length}`).code,
      IMAGE_DATA_INVALID,
    );
  }
  // A first chunk whose length alone overruns the buffer.
  assert.equal(
    walkPng(pngFile(u32(0xffffffff), Buffer.from('IHDR', 'latin1'))),
    null,
  );
});

test('walkPng accepts trailing data after IEND (current behavior)', () => {
  const file = Buffer.concat([
    syntheticPng(3, 2),
    Buffer.from('trailing garbage'),
  ]);
  assert.deepEqual(walkPng(file), { width: 3, height: 2 });
  const ok = accepted(validatePicture(file, 't.png', digest), 'trailing');
  assert.deepEqual(ok.pixels, { width: 3, height: 2 });
});

// --- decodeImageData -------------------------------------------------------

test('decodeImageData ignores any whitespace inside base64', () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 256);
  const plain = Buffer.from(bytes).toString('base64');
  const wrap = (width: number, eol: string): string =>
    plain.match(new RegExp(`.{1,${width}}`, 'g'))!.join(eol);
  const variants = [
    plain,
    wrap(76, '\n'),
    wrap(64, '\r\n'),
    wrap(4, ' '),
    wrap(10, '\t'),
    `  \r\n${wrap(60, '\r\n')}\r\n  `,
    plain.split('').join(' '),
  ];
  for (const text of variants) {
    const decoded = decodeImageData(text);
    assert.ok(decoded !== null, JSON.stringify(text.slice(0, 20)));
    assert.deepEqual(Buffer.from(decoded), Buffer.from(bytes));
  }
});

test('decodeImageData refuses invalid base64 characters and impossible lengths', () => {
  for (const text of [
    'QUJD$EZH',
    '!!!!',
    'QUJD-EZH', // URL-safe alphabet is not RDL base64
    'QUJD_EZH',
    'data:image/png;base64,QUJD',
    'QUJDR', // length 1 modulo 4
  ])
    assert.equal(decodeImageData(text), null, text);
});

test('decodeImageData decodes every padding variant', () => {
  for (const [text, expected] of [
    ['QUJD', 'ABC'],
    ['QUI=', 'AB'],
    ['QQ==', 'A'],
    ['QUJDREU=', 'ABCDE'],
    ['QUJDREVG', 'ABCDEF'],
    ['QUJDRA==', 'ABCD'],
  ] as const) {
    const decoded = decodeImageData(text);
    assert.ok(decoded !== null, text);
    assert.equal(Buffer.from(decoded).toString('latin1'), expected, text);
  }
  const all = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (const size of [253, 254, 255, 256]) {
    const bytes = all.subarray(0, size);
    const decoded = decodeImageData(Buffer.from(bytes).toString('base64'));
    assert.ok(decoded !== null, `size ${size}`);
    assert.deepEqual(Buffer.from(decoded), Buffer.from(bytes));
  }
});

test('decodeImageData refuses misplaced or excessive padding', () => {
  for (const text of [
    'QQ==QQ==', // '=' in the middle
    'QUJD=REU', // '=' in the middle of a quantum
    'QQ=Q', // multiple of 4 with '=' before the last character
    'Q=QQ',
    '=QQQ',
    'QUI=QUI=',
    'Q===', // three paddings
    '====',
    'QQ=', // padding present but length not a multiple of 4
  ])
    assert.equal(decodeImageData(text), null, text);
});

test('decodeImageData strips only XML whitespace, not Unicode whitespace', () => {
  for (const space of ['\u00a0', '\ufeff', '\u2003', '\u000b', '\f']) {
    assert.equal(decodeImageData(`QU${space}JD`), null, JSON.stringify(space));
    assert.equal(decodeImageData(`QUJD${space}`), null, JSON.stringify(space));
  }
  const decoded = decodeImageData(' QU\tJ\r\nD ');
  assert.ok(decoded !== null);
  assert.equal(Buffer.from(decoded).toString('latin1'), 'ABC');
});

// --- allocateDefinitionName ------------------------------------------------

test('allocateDefinitionName uses the file stem then _1, _2 suffixes', () => {
  assert.equal(allocateDefinitionName('logo.png', []), 'logo');
  assert.equal(allocateDefinitionName('logo.png', ['logo']), 'logo_1');
  assert.equal(
    allocateDefinitionName('logo.png', ['logo', 'logo_1']),
    'logo_2',
  );
  assert.equal(allocateDefinitionName('logo.png', ['logo_1']), 'logo');
  assert.equal(
    allocateDefinitionName('logo.png', ['logo', 'logo_2']),
    'logo_1',
  );
  assert.equal(allocateDefinitionName('logo.JPEG', ['other']), 'logo');
  assert.equal(allocateDefinitionName('logo', []), 'logo');
});

test('allocateDefinitionName normalizes stems to letter-first ASCII identifiers', () => {
  const existing = ['Image', 'logo'];
  for (const fileName of [
    '2 my logo!.png',
    '123.png',
    'my logo.png',
    'a-b.c.png',
    '_hidden.png',
    'ça va.png',
  ]) {
    const name = allocateDefinitionName(fileName, existing);
    assert.match(name, /^[A-Za-z][A-Za-z0-9_]*$/, fileName);
    assert.ok(validateName(name, existing), fileName);
  }
});

test('allocateDefinitionName produces exact normalized names', () => {
  const expected: Array<[string, string]> = [
    ['2 my logo!.png', 'my_logo'],
    ['ça va.png', 'a_va'],
    ['123.png', 'Image'],
    ['_hidden.png', 'hidden'],
    ['a-b.c.png', 'a_b_c'],
    ['my logo.png', 'my_logo'],
  ];
  for (const [fileName, name] of expected)
    assert.equal(allocateDefinitionName(fileName, []), name, fileName);
  // 'Image' is taken in `existing`, so the numeric fallback gets a suffix.
  assert.equal(allocateDefinitionName('123.png', ['Image']), 'Image_1');
});

test('allocateDefinitionName falls back to Image for empty or non-ASCII stems', () => {
  for (const fileName of ['.png', '', '日本語.png', '!!!.png', '   .jpg'])
    assert.equal(allocateDefinitionName(fileName, []), 'Image', fileName);
  assert.equal(allocateDefinitionName('日本語.png', ['Image']), 'Image_1');
  assert.equal(allocateDefinitionName('.png', ['Image', 'Image_1']), 'Image_2');
});

test('file stems and definition names ignore directories before the extension', () => {
  const paths: Array<[string, string]> = [
    ['dir.x/logo.png', 'logo'],
    ['C:\\pics\\photo.jpg', 'photo'],
    ['a.b\\c.d/mixed.name.png', 'mixed_name'],
    ['dir.x/noext', 'noext'],
    ['/abs/path/logo.png', 'logo'],
  ];
  for (const [fileName, stem] of paths)
    assert.equal(allocateDefinitionName(fileName, []), stem, fileName);
  assert.equal(allocateDefinitionName('dir.x/logo.png', ['logo']), 'logo_1');
  for (const [fileName, fileStem] of [
    ['dir.x/spoofed.png', 'spoofed'],
    ['C:\\pics\\spoofed.png', 'spoofed'],
  ] as const) {
    const ok = accepted(
      validatePicture(picture('spoofed.png'), fileName, digest),
      fileName,
    );
    assert.equal(ok.fileStem, fileStem, fileName);
  }
});

test('allocateDefinitionName caps names at embeddedImageNameMaxLength', () => {
  const long = `${'a'.repeat(300)}.png`;
  const first = allocateDefinitionName(long, []);
  assert.equal(first, 'a'.repeat(embeddedImageNameMaxLength));
  const second = allocateDefinitionName(long, [first]);
  assert.equal(second, `${'a'.repeat(embeddedImageNameMaxLength - 2)}_1`);
  assert.ok(second.length <= embeddedImageNameMaxLength);
  const taken = [first];
  for (let n = 1; n <= 12; n++) {
    const next = allocateDefinitionName(long, taken);
    assert.ok(next.length <= embeddedImageNameMaxLength, next);
    assert.match(next, /^[A-Za-z][A-Za-z0-9_]*$/);
    assert.ok(!taken.includes(next), next);
    taken.push(next);
  }
  assert.equal(taken[10], `${'a'.repeat(embeddedImageNameMaxLength - 3)}_10`);
});

test('allocateDefinitionName strips a trailing underscore left by the cut', () => {
  const max = embeddedImageNameMaxLength;
  const fileName = `${'a'.repeat(max - 1)}_b.png`;
  const first = allocateDefinitionName(fileName, []);
  assert.equal(first, 'a'.repeat(max - 1));
  assert.equal(
    allocateDefinitionName(fileName, [first]),
    `${'a'.repeat(max - 2)}_1`,
  );
});

test('allocateDefinitionName is case-sensitive', () => {
  assert.equal(allocateDefinitionName('logo.png', ['Logo']), 'logo');
  assert.equal(allocateDefinitionName('Logo.png', ['logo']), 'Logo');
  assert.equal(allocateDefinitionName('Logo.png', ['Logo']), 'Logo_1');
  assert.equal(allocateDefinitionName('logo.png', ['LOGO', 'Logo_1']), 'logo');
});

test('validateImageCapability allows what the projection allows and blocks the rest', () => {
  const projectionOf = (name: string) =>
    projectReport(
      parse({
        uri: `test:${name}`,
        version: 1,
        source: readFileSync(`tests/fixtures/images/${name}.rdlc`, 'utf8'),
        eol: '\n',
      }),
    ).images;
  const editable = projectionOf('authored')[0]!;
  for (const property of [
    'image',
    'name',
    'left',
    'top',
    'width',
    'height',
    'sizing',
    'value',
    'toolTip',
  ] as const)
    assert.deepEqual(validateImageCapability(editable, property), [], property);

  const preserved = projectionOf('preserved');
  const geometryOnly = preserved.find((i) => i.name === 'GhostPicture')!;
  for (const property of ['name', 'left', 'top', 'width', 'height'] as const)
    assert.deepEqual(validateImageCapability(geometryOnly, property), []);
  for (const property of ['image', 'sizing', 'value', 'toolTip'] as const) {
    const [blocked] = validateImageCapability(geometryOnly, property);
    assert.equal(blocked?.code, 'CAPABILITY_BLOCKED', property);
    assert.equal(blocked?.itemId, geometryOnly.node.id);
    assert.equal(blocked?.property, property);
    assert.deepEqual(blocked?.blockedOperations, ['requested-edit']);
  }
  const external = preserved.find((i) => i.name === 'ExternalPicture')!;
  for (const property of ['name', 'left', 'image'] as const)
    assert.equal(
      validateImageCapability(external, property)[0]?.code,
      'CAPABILITY_BLOCKED',
      property,
    );
});

test('validateImageProperty accepts the four sizing modes and refuses anything else', () => {
  const check = (value: string) =>
    validateImageProperty({
      property: 'sizing',
      value,
      range: { start: 3, end: 9 },
      existingNames: [],
      definitions: [],
    });
  for (const mode of ['AutoSize', 'Fit', 'FitProportional', 'Clip'])
    assert.deepEqual(check(mode), [], mode);
  for (const bad of ['', 'fit', 'Stretch', 'Fit ', 'Default']) {
    const [refusal] = check(bad);
    assert.equal(refusal?.code, IMAGE_PROPERTY_INVALID, JSON.stringify(bad));
    assert.equal(refusal?.property, 'sizing');
    assert.deepEqual(refusal?.range, { start: 3, end: 9 });
    assert.deepEqual(refusal?.blockedOperations, ['requested-edit']);
  }
});

test('validateImageProperty requires Value to name an existing displayable definition', () => {
  const definitions = [
    { name: 'logo', displayable: true },
    { name: 'broken', displayable: false },
  ];
  const check = (value: string) =>
    validateImageProperty({
      property: 'value',
      value,
      range: { start: 0, end: 0 },
      existingNames: [],
      definitions,
    });
  assert.deepEqual(check('logo'), []);
  for (const bad of ['broken', 'missing', 'Logo', '', '=Parameters!P.Value'])
    assert.equal(check(bad)[0]?.code, IMAGE_PROPERTY_INVALID, bad);
});

test('validateImageProperty reuses validateName for the item name', () => {
  const check = (value: string) =>
    validateImageProperty({
      property: 'name',
      value,
      range: { start: 0, end: 0 },
      existingNames: ['Taken', 'Other'],
      definitions: [],
    });
  for (const name of ['Fresh', '_x', 'Logo_2', 'Ünicode'])
    assert.equal(
      check(name).length === 0,
      validateName(name, ['Taken', 'Other']),
    );
  assert.deepEqual(check('Fresh'), []);
  for (const bad of ['Taken', '', '1Bad', 'has space', 'a-b'])
    assert.equal(check(bad)[0]?.code, IMAGE_PROPERTY_INVALID, bad);
});

test('validateImageProperty accepts any ToolTip text, expressions included, without evaluating it', () => {
  const check = (value: string) =>
    validateImageProperty({
      property: 'toolTip',
      value,
      range: { start: 0, end: 0 },
      existingNames: [],
      definitions: [],
    });
  for (const value of [
    '',
    'Company logo',
    '<b>&</b>',
    '=Fields!A.Value',
    '=1/0',
  ])
    assert.deepEqual(check(value), [], JSON.stringify(value));
});

test('validateImageProperty diagnostics never echo a payload-sized value', () => {
  const payload = 'iVBORw0KGgo+/=='.repeat(2000);
  const diagnostics = [
    ...validateImageProperty({
      property: 'sizing',
      value: payload,
      range: { start: 0, end: 0 },
      existingNames: [],
      definitions: [],
    }),
    ...validateImageProperty({
      property: 'value',
      value: payload,
      range: { start: 0, end: 0 },
      existingNames: [],
      definitions: [],
    }),
    ...validateImageProperty({
      property: 'name',
      value: payload,
      range: { start: 0, end: 0 },
      existingNames: [],
      definitions: [],
    }),
  ];
  assert.equal(diagnostics.length, 3);
  assert.ok(!JSON.stringify(diagnostics).includes('iVBORw0KGgo'));
});

// --- US4: definition rename and removal guards --------------------------------

const imagesFixture = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}`, 'utf8');

function guard(source: string, operation: 'rename' | 'remove', name: string) {
  const syntax = parse({ uri: 'fixture:guard', version: 1, source, eol: '\n' });
  const projection = projectReport(syntax);
  return {
    syntax,
    projection,
    diagnostics: validateDefinitionMutation({
      operation,
      root: syntax.root,
      definitions: projection.embeddedImages,
      images: projection.images,
      name,
    }),
  };
}

test('rename is allowed when every reference is a constant Embedded Value', () => {
  const source = imagesFixture('authored.rdlc');
  for (const name of ['logo', 'photo', 'unused'])
    assert.deepEqual(guard(source, 'rename', name).diagnostics, [], name);
});

test('removal is blocked while an item references the definition, listing every item', () => {
  const source = imagesFixture('authored.rdlc');
  const logo = guard(source, 'remove', 'logo');
  assert.deepEqual(
    logo.diagnostics.map((entry) => entry.code),
    [IMAGE_REMOVE_BLOCKED, IMAGE_REMOVE_BLOCKED, IMAGE_REMOVE_BLOCKED],
  );
  assert.deepEqual(
    logo.diagnostics.map((entry) => entry.itemId),
    ['LogoAutoSize', 'LogoFit', 'Tagged'].map(
      (name) => logo.projection.images.find((i) => i.name === name)!.node.id,
    ),
  );
  for (const [index, name] of ['LogoAutoSize', 'LogoFit', 'Tagged'].entries()) {
    assert.ok(logo.diagnostics[index]!.message.includes(`"${name}"`));
    assert.ok(logo.diagnostics[index]!.message.includes('"logo"'));
    assert.deepEqual(
      [
        logo.diagnostics[index]!.range.start,
        logo.diagnostics[index]!.range.end,
      ],
      [
        logo.projection.images.find((i) => i.name === name)!.node.range.start,
        logo.projection.images.find((i) => i.name === name)!.node.range.end,
      ],
    );
  }
  assert.deepEqual(guard(source, 'remove', 'unused').diagnostics, []);
});

test('an expression Value blocks rename and removal of every definition, naming the item', () => {
  const source = imagesFixture('preserved.rdlc');
  for (const operation of ['rename', 'remove'] as const) {
    const result = guard(source, operation, 'logo');
    const expression = result.diagnostics.find((entry) =>
      entry.message.includes('"ExpressionPicture"'),
    );
    assert.ok(expression, `${operation}: the expression item is listed`);
    assert.equal(
      expression.code,
      operation === 'rename' ? IMAGE_RENAME_BLOCKED : IMAGE_REMOVE_BLOCKED,
    );
    assert.match(expression.message, /expression/);
    // An unreferenced definition is blocked too: the expression could name it.
    assert.ok(
      guard(source, operation, 'bitmap').diagnostics.some((entry) =>
        entry.message.includes('"ExpressionPicture"'),
      ),
      `${operation}: bitmap`,
    );
  }
  // External and Database images never name an embedded definition.
  const without = source.replace(
    /<Image Name="ExpressionPicture">[\s\S]*?<\/Image>/,
    '',
  );
  assert.deepEqual(guard(without, 'rename', 'logo').diagnostics, []);
  assert.deepEqual(guard(without, 'rename', 'bitmap').diagnostics, []);
  // The constant reference from a table cell is rewritable for rename and blocks removal.
  assert.deepEqual(
    guard(without, 'remove', 'logo').diagnostics.map(
      (d) => d.message.match(/"(\w+)" still/)?.[1],
    ),
    ['CellPicture'],
  );
});

test('an unknown Source or a structured Value cannot be rewritten safely', () => {
  const source = imagesFixture('authored.rdlc');
  // Whitespace between the tags is captured so CRLF checkouts match too.
  const unknownSource = source.replace(
    /<Source>Embedded<\/Source>(\s*<Value>photo<\/Value>)/,
    '<Source>=IIf(True, "Embedded", "External")</Source>$1',
  );
  assert.notEqual(unknownSource, source);
  const rename = guard(unknownSource, 'rename', 'photo').diagnostics;
  assert.equal(rename.length, 1);
  assert.match(rename[0]!.message, /cannot be rewritten safely/);
  const structured = source
    .replace('<Value>unused</Value>', '<Value>unused</Value>')
    .replace('<Value>photo</Value>', '<Value><x:Odd/></Value>');
  assert.ok(
    guard(structured, 'rename', 'unused').diagnostics.some((d) =>
      /cannot be rewritten safely/.test(d.message),
    ),
    'a structured Value could hide any name',
  );
});

test('a BackgroundImage that could name the definition blocks and names its owner', () => {
  const source = imagesFixture('authored.rdlc').replace(
    '<Image Name="PhotoClip">',
    '<Image Name="PhotoClip"><Style><BackgroundImage><Source>Embedded</Source><Value>unused</Value></BackgroundImage></Style>',
  );
  for (const operation of ['rename', 'remove'] as const) {
    const result = guard(source, operation, 'unused').diagnostics;
    assert.equal(result.length, 1, operation);
    assert.match(result[0]!.message, /background image of "PhotoClip"/);
  }
  assert.deepEqual(guard(source, 'rename', 'logo').diagnostics, []);
  const external = source.replace(
    '<Source>Embedded</Source><Value>unused</Value>',
    '<Source>External</Source><Value>unused</Value>',
  );
  assert.deepEqual(guard(external, 'rename', 'unused').diagnostics, []);
});

test('unknown, repeated or missing definitions are blocked', () => {
  const source = imagesFixture('authored.rdlc');
  const missing = guard(source, 'remove', 'ghost').diagnostics;
  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.code, IMAGE_REMOVE_BLOCKED);
  const repeated = source.replace(
    '<EmbeddedImage Name="unused">',
    '<EmbeddedImage Name="photo">',
  );
  const result = guard(repeated, 'rename', 'photo').diagnostics;
  assert.equal(result.length, 1);
  assert.match(result[0]!.message, /more than once/);
});

test('a long list of blockers is capped and summarized', () => {
  const items = Array.from(
    { length: 25 },
    (_, index) =>
      `<Image Name="Many${index}"><Source>Embedded</Source><Value>unused</Value></Image>`,
  ).join('');
  const source = imagesFixture('authored.rdlc').replace(
    '<ReportItems>',
    `<ReportItems>${items}`,
  );
  const result = guard(source, 'remove', 'unused').diagnostics;
  assert.equal(result.length, 21);
  assert.match(result.at(-1)!.message, /5 more items/);
  assert.equal(result.at(-1)!.itemId, undefined);
});

test('blocker messages never carry picture data', () => {
  const source = imagesFixture('authored.rdlc');
  const logo = guard(source, 'remove', 'logo');
  const payloads = [...source.matchAll(/<ImageData>([^<]{40,})</g)].map(
    (match) => match[1]!.trim().slice(0, 40),
  );
  assert.ok(payloads.length >= 3);
  const text = JSON.stringify(logo.diagnostics);
  for (const payload of payloads) assert.ok(!text.includes(payload));
  assert.equal(
    findDefinitionBlockers({
      operation: 'remove',
      root: logo.syntax.root,
      images: logo.projection.images,
      name: 'logo',
    }).length,
    3,
  );
});

test('validateDefinitionName accepts a free CLS name and names the rule otherwise', () => {
  const range = { start: 0, end: 0 };
  assert.deepEqual(
    validateDefinitionName({
      newName: 'brand',
      existingNames: ['logo'],
      range,
    }),
    [],
  );
  for (const newName of ['logo', '', '1abc', 'has space', 'a<b']) {
    const result = validateDefinitionName({
      newName,
      existingNames: ['logo'],
      range,
    });
    assert.equal(result.length, 1, JSON.stringify(newName));
    assert.equal(result[0]!.code, IMAGE_PROPERTY_INVALID);
    assert.ok(!result[0]!.message.includes(newName) || newName === '');
  }
});

/** Gauge elements that name `logo` while no Image item of the report does. */
const gaugeFixture = () =>
  imagesFixture('authored.rdlc').replace(
    /<Image Name="[^>]*>[\s\S]*<\/Image>\s*<\/ReportItems>/,
    '<GaugePanel Name="Dial"><LinearGauges><LinearGauge Name="Level"><LinearPointers><LinearPointer><PointerImage><Source>Embedded</Source><Value>logo</Value></PointerImage></LinearPointer></LinearPointers></LinearGauge></LinearGauges><StateIndicators><StateIndicator Name="Light"><IndicatorImage><Source>Embedded</Source><Value>logo</Value></IndicatorImage></StateIndicator></StateIndicators></GaugePanel></ReportItems>',
  );

test('PointerImage and IndicatorImage block rename and removal like a BackgroundImage', () => {
  const source = gaugeFixture();
  assert.equal(
    guard(source, 'remove', 'photo').projection.images.length,
    0,
    'no Image item references anything',
  );
  for (const operation of ['rename', 'remove'] as const) {
    const result = guard(source, operation, 'logo').diagnostics;
    assert.equal(result.length, 2, operation);
    assert.match(result[0]!.message, /The PointerImage of "Level"/);
    assert.match(result[1]!.message, /The IndicatorImage of "Light"/);
    assert.ok(result.every((entry) => entry.itemId !== undefined));
    assert.ok(result.every((entry) => !entry.message.includes('iVBOR')));
  }
  assert.deepEqual(guard(source, 'remove', 'unused').diagnostics, []);
  // External and Database sources never name an embedded definition.
  for (const kind of ['External', 'Database'])
    assert.deepEqual(
      guard(
        source.replaceAll('<Source>Embedded', `<Source>${kind}`),
        'remove',
        'logo',
      ).diagnostics,
      [],
      kind,
    );
});

test('every image element blocks, and an expression Value always does', () => {
  const source = imagesFixture('authored.rdlc').replace(
    '<Image Name="PhotoClip">',
    '<Rectangle Name="Box"><CapImage><Source>Embedded</Source><Value>=Fields!P.Value</Value></CapImage></Rectangle><Image Name="PhotoClip">',
  );
  for (const operation of ['rename', 'remove'] as const)
    for (const name of ['logo', 'photo', 'unused'])
      assert.ok(
        guard(source, operation, name).diagnostics.some((entry) =>
          /The CapImage of "Box"/.test(entry.message),
        ),
        `${operation} ${name}`,
      );
});

test('findDefinitionBlockers reports image elements with their element name', () => {
  const syntax = parse({
    uri: 'fixture:blockers',
    version: 1,
    source: gaugeFixture(),
    eol: '\n',
  });
  const projection = projectReport(syntax);
  const blockers = findDefinitionBlockers({
    operation: 'rename',
    root: syntax.root,
    images: projection.images,
    name: 'logo',
  });
  assert.deepEqual(
    blockers.map((entry) => [entry.kind, entry.element, entry.name]),
    [
      ['element', 'PointerImage', 'Level'],
      ['element', 'IndicatorImage', 'Light'],
    ],
  );
});

test('a rename that would capture an item pointing at a missing definition is refused', () => {
  const source = imagesFixture('authored.rdlc').replace(
    '<Image Name="PhotoClip">',
    '<Image Name="Dangling"><Source>Embedded</Source><Value>brand</Value></Image><Rectangle Name="Box"><PointerImage><Source>Embedded</Source><Value>brand</Value></PointerImage></Rectangle><Image Name="PhotoClip">',
  );
  const syntax = parse({
    uri: 'fixture:capture',
    version: 1,
    source,
    eol: '\n',
  });
  const projection = projectReport(syntax);
  const run = (newName: string) =>
    validateDefinitionMutation({
      operation: 'rename',
      root: syntax.root,
      definitions: projection.embeddedImages,
      images: projection.images,
      name: 'unused',
      newName,
    });
  const result = run('brand');
  assert.equal(result.length, 2);
  assert.ok(result.every((entry) => entry.code === IMAGE_RENAME_BLOCKED));
  assert.match(result[0]!.message, /"Dangling" already references/);
  assert.match(result[1]!.message, /"Box" already references/);
  assert.ok(result.every((entry) => !entry.message.includes('brand')));
  assert.deepEqual(run('fresh'), []);
});

test('definition names are 1 to 256 characters', () => {
  const range = { start: 0, end: 0 };
  const check = (newName: string) =>
    validateDefinitionName({ newName, existingNames: [], range });
  assert.equal(embeddedImageNameMaxLength, 256);
  assert.deepEqual(check('a'.repeat(256)), []);
  const long = check('a'.repeat(257));
  assert.equal(long.length, 1);
  assert.equal(long[0]!.code, IMAGE_PROPERTY_INVALID);
  assert.ok(!long[0]!.message.includes('a'.repeat(20)));
  assert.equal(check('').length, 1);
});
