/**
 * Deterministic generator for the embedded image fixture corpus (feature 006).
 *
 * Run from the repository root: `node scripts/fixtures/generate-images.ts`.
 * It has no dependency (`node:zlib` deflates PNG data and CRC-32 is hand-written)
 * and the same inputs always produce the same bytes, so the committed outputs
 * can be regenerated and diffed.
 *
 * Writes to `tests/fixtures/images/pictures/`:
 *   logo.png         120x40 RGBA PNG
 *   photo.jpg        200x150 baseline JPEG (SOF0), minimal but structurally valid
 *   progressive.jpg  160x120 progressive JPEG (SOF2)
 *   spoofed.png      the JPEG bytes of photo.jpg under a .png name
 *   truncated.png    logo.png cut right before its IEND chunk
 *   bad-crc.png      logo.png with one IDAT data byte flipped (CRC mismatch)
 *   huge-dims.png    valid chunks and CRCs, IHDR 16385x10 (over the dimension limit)
 *   mega-pixels.png  valid chunks and CRCs, IHDR 8000x5001 (over the pixel limit)
 *   gif.gif          minimal 1x1 GIF89a
 * and the report `tests/fixtures/images/many.rdlc` (50 definitions, 50 items).
 *
 * `over-5mib.jpg` is NOT produced here: tests build it in memory or in a temporary
 * directory when needed (a JPEG larger than the raw image limit) and it is never
 * committed.
 *
 * The oversized fixtures deliberately pin values just beyond the limits defined by
 * `packages/report-model/src/images.ts` (`dimensionLimit` 16384, `pixelLimit`
 * 40_000_000); they are test inputs, not limit definitions.
 *
 * This file has no local imports on purpose, so it runs straight from source.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, as required by PNG)
// ---------------------------------------------------------------------------

const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable.push(c >>> 0);
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes)
    c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

function ihdr(width: number, height: number, colorType: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = colorType;
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return data;
}

/** Assemble a PNG from raw scanlines (each already prefixed with its filter byte). */
function png(
  width: number,
  height: number,
  colorType: number,
  raw: Buffer,
): Buffer {
  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr(width, height, colorType)),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 120x40 RGBA: horizontal red ramp, vertical green ramp, blue checker, alpha fade. */
export function buildLogoPng(): Buffer {
  const width = 120;
  const height = 40;
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * 4;
      raw[at] = Math.round((x * 255) / (width - 1));
      raw[at + 1] = Math.round((y * 255) / (height - 1));
      raw[at + 2] = ((x >> 3) + (y >> 3)) % 2 === 0 ? 200 : 40;
      raw[at + 3] = 255 - Math.round((x * 128) / (width - 1));
    }
  }
  return png(width, height, 6, raw);
}

/** Grayscale PNG of an all-zero image with an arbitrary declared size. */
function blankGrayPng(width: number, height: number): Buffer {
  return png(width, height, 0, Buffer.alloc((1 + width) * height));
}

/** Locate the first chunk of `type`; returns the offset of its data and length. */
function findChunk(
  file: Buffer,
  type: string,
): { data: number; length: number } {
  let offset = pngSignature.length;
  while (offset + 12 <= file.length) {
    const length = file.readUInt32BE(offset);
    if (file.toString('latin1', offset + 4, offset + 8) === type)
      return { data: offset + 8, length };
    offset += 12 + length;
  }
  throw new Error(`chunk ${type} not found`);
}

export function buildTruncatedPng(logo: Buffer): Buffer {
  const iend = findChunk(logo, 'IEND');
  return logo.subarray(0, iend.data - 8);
}

export function buildBadCrcPng(logo: Buffer): Buffer {
  const idat = findChunk(logo, 'IDAT');
  const copy = Buffer.from(logo);
  const at = idat.data + (idat.length >> 1);
  copy[at] = (copy[at] as number) ^ 0xff;
  return copy;
}

// ---------------------------------------------------------------------------
// JPEG (grayscale, single component, one-code Huffman tables)
// ---------------------------------------------------------------------------

function segment(marker: number, payload: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const soi = Buffer.from([0xff, 0xd8]);
const eoi = Buffer.from([0xff, 0xd9]);

const app0 = segment(
  0xe0,
  Buffer.from([
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01, // version 1.01
    0x00, // no density units
    0x00,
    0x01,
    0x00,
    0x01, // 1:1 aspect
    0x00,
    0x00, // no thumbnail
  ]),
);

const dqt = segment(
  0xdb,
  Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]), // table 0, 8-bit, all ones
);

/** A Huffman table with exactly one code (length 1, value `symbol`). */
function dht(tableClass: 0 | 1, symbol: number): Buffer {
  const counts = Buffer.alloc(16);
  counts[0] = 1;
  return segment(
    0xc4,
    Buffer.concat([
      Buffer.from([(tableClass << 4) | 0]),
      counts,
      Buffer.from([symbol]),
    ]),
  );
}

function sof(marker: 0xc0 | 0xc2, width: number, height: number): Buffer {
  const payload = Buffer.alloc(9);
  payload[0] = 8; // precision
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload[5] = 1; // one component
  payload[6] = 1; // component id
  payload[7] = 0x11; // 1x1 sampling
  payload[8] = 0; // quantization table 0
  return segment(marker, payload);
}

function sos(ss: number, se: number): Buffer {
  return segment(
    0xda,
    Buffer.from([
      1, // one component
      1, // component id
      0x00, // DC table 0, AC table 0
      ss,
      se,
      0x00, // Ah/Al
    ]),
  );
}

/** Pack `blocks * bitsPerBlock` zero bits, pad with ones, byte-stuff any 0xFF. */
function zeroBitsEntropy(blocks: number, bitsPerBlock: number): Buffer {
  const bits = blocks * bitsPerBlock;
  const bytes = Buffer.alloc(Math.ceil(bits / 8), 0);
  const pad = bytes.length * 8 - bits;
  if (pad > 0) bytes[bytes.length - 1] = (1 << pad) - 1;
  const out: number[] = [];
  for (const byte of bytes) {
    out.push(byte);
    if (byte === 0xff) out.push(0x00);
  }
  return Buffer.from(out);
}

function blockCount(width: number, height: number): number {
  return Math.ceil(width / 8) * Math.ceil(height / 8);
}

/** Baseline JPEG: every block is DC diff 0 plus EOB, a flat mid-gray picture. */
export function buildBaselineJpeg(width: number, height: number): Buffer {
  return Buffer.concat([
    soi,
    app0,
    dqt,
    sof(0xc0, width, height),
    dht(0, 0x00), // DC: category 0 -> code "0"
    dht(1, 0x00), // AC: EOB -> code "0"
    sos(0, 63),
    zeroBitsEntropy(blockCount(width, height), 2),
    eoi,
  ]);
}

/** Progressive JPEG: a DC scan (Ss=0,Se=0) followed by an AC scan (EOB0 per block). */
export function buildProgressiveJpeg(width: number, height: number): Buffer {
  const blocks = blockCount(width, height);
  return Buffer.concat([
    soi,
    app0,
    dqt,
    sof(0xc2, width, height),
    dht(0, 0x00),
    sos(0, 0),
    zeroBitsEntropy(blocks, 1), // DC diff 0 -> "0"
    dht(1, 0x00),
    sos(1, 63),
    zeroBitsEntropy(blocks, 1), // EOB0 -> "0"
    eoi,
  ]);
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

/** Minimal 1x1 GIF89a with a two-entry global color table. */
export function buildGif(): Buffer {
  return Buffer.from([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // "GIF89a"
    0x01,
    0x00,
    0x01,
    0x00, // 1x1
    0x80,
    0x00,
    0x00, // global color table, 2 entries
    0x00,
    0x00,
    0x00,
    0xff,
    0xff,
    0xff, // black, white
    0x21,
    0xf9,
    0x04,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // graphic control extension
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // image descriptor
    0x02,
    0x02,
    0x44,
    0x01,
    0x00, // LZW data
    0x3b, // trailer
  ]);
}

// ---------------------------------------------------------------------------
// many.rdlc
// ---------------------------------------------------------------------------

export const manyCount = 50;

export function buildManyReport(logo: Buffer): string {
  const base64 = logo.toString('base64');
  const pad = (n: number) => String(n).padStart(2, '0');
  const definitions = Array.from(
    { length: manyCount },
    (_, i) => `    <EmbeddedImage Name="image${pad(i + 1)}">
      <MIMEType>image/png</MIMEType>
      <ImageData>${base64}</ImageData>
    </EmbeddedImage>`,
  ).join('\n');
  const items = Array.from(
    { length: manyCount },
    (_, i) => `          <Image Name="Picture${pad(i + 1)}">
            <Source>Embedded</Source>
            <Value>image${pad(i + 1)}</Value>
            <MIMEType>image/png</MIMEType>
            <Sizing>FitProportional</Sizing>
            <Top>${(i * 0.5).toFixed(2)}in</Top>
            <Left>0.25in</Left>
            <Height>0.4in</Height>
            <Width>1.2in</Width>
          </Image>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Synthetic image fixture generated by scripts/fixtures/generate-images.ts; MIT; MS-RDL 2.12, 2.305, 2.306 -->
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner" xmlns:x="urn:rdlc-code:extension">
  <ReportSections>
    <ReportSection>
      <Body>
        <ReportItems>
${items}
        </ReportItems>
        <Height>${(manyCount * 0.5 + 0.5).toFixed(2)}in</Height>
      </Body>
      <Width>6in</Width>
      <Page>
        <PageHeight>11in</PageHeight>
        <PageWidth>8.5in</PageWidth>
        <LeftMargin>1in</LeftMargin>
        <TopMargin>1in</TopMargin>
        <RightMargin>1in</RightMargin>
        <BottomMargin>1in</BottomMargin>
      </Page>
    </ReportSection>
  </ReportSections>
  <EmbeddedImages>
${definitions}
  </EmbeddedImages>
</Report>
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generate(fixtureRoot = 'tests/fixtures/images'): string[] {
  const pictures = join(fixtureRoot, 'pictures');
  mkdirSync(pictures, { recursive: true });
  const logo = buildLogoPng();
  const photo = buildBaselineJpeg(200, 150);
  const files: [string, Buffer | string][] = [
    [join(pictures, 'logo.png'), logo],
    [join(pictures, 'photo.jpg'), photo],
    [join(pictures, 'progressive.jpg'), buildProgressiveJpeg(160, 120)],
    [join(pictures, 'spoofed.png'), photo],
    [join(pictures, 'truncated.png'), buildTruncatedPng(logo)],
    [join(pictures, 'bad-crc.png'), buildBadCrcPng(logo)],
    [join(pictures, 'huge-dims.png'), blankGrayPng(16385, 10)],
    [join(pictures, 'mega-pixels.png'), blankGrayPng(8000, 5001)],
    [join(pictures, 'gif.gif'), buildGif()],
    [join(fixtureRoot, 'many.rdlc'), buildManyReport(logo)],
  ];
  for (const [path, content] of files) writeFileSync(path, content);
  return files.map(([path]) => path);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const path of generate()) console.log(path);
}
