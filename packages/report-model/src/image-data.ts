import type { ImageFormat, ImagePixels } from './images.js';

// Platform-neutral: no Node, Buffer or DOM dependency.

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crcTable: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

/** Unsigned CRC-32 (IEEE 802.3), as used by PNG chunks. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    crc =
      (crcTable[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Classifies by content signature only, never by file extension. */
export function sniffFormat(bytes: Uint8Array): ImageFormat | 'other' {
  if (
    bytes.length >= pngSignature.length &&
    pngSignature.every((value, index) => bytes[index] === value)
  )
    return 'png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'jpeg';
  return 'other';
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}
function readU16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
}

/**
 * Walks every PNG chunk: IHDR first, IEND last, every CRC valid.
 * Returns the IHDR dimensions, or null when the structure is invalid.
 */
export function walkPng(bytes: Uint8Array): ImagePixels | null {
  if (sniffFormat(bytes) !== 'png') return null;
  let offset = pngSignature.length;
  let pixels: ImagePixels | null = null;
  for (let first = true; ; first = false) {
    if (offset + 12 > bytes.length) return null;
    const length = readU32(bytes, offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) return null;
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      readU32(bytes, end - 4)
    )
      return null;
    if (first) {
      if (type !== 'IHDR' || length !== 13) return null;
      pixels = {
        width: readU32(bytes, offset + 8),
        height: readU32(bytes, offset + 12),
      };
      if (pixels.width === 0 || pixels.height === 0) return null;
    } else if (type === 'IHDR') return null;
    offset = end;
    if (type === 'IEND') return length === 0 ? pixels : null;
  }
}

/**
 * Generic JPEG marker walk: SOI, segments in any order, the first SOF
 * (SOF0-SOF15 except DHT/JPG/DAC) giving the dimensions, entropy-coded data
 * skipped after each SOS, and a mandatory trailing EOI.
 *
 * Per the contract wording (SOI, a SOF, EOI), a file made of SOI + SOF + EOI
 * with no SOS scan is accepted; only a missing SOF or EOI is refused.
 */
export function walkJpeg(bytes: Uint8Array): ImagePixels | null {
  if (sniffFormat(bytes) !== 'jpeg') return null;
  let offset = 2;
  let pixels: ImagePixels | null = null;
  for (;;) {
    if (offset >= bytes.length || bytes[offset] !== 0xff) return null;
    while (bytes[offset + 1] === 0xff) offset++; // fill bytes
    if (offset + 2 > bytes.length) return null;
    const marker = bytes[offset + 1] as number;
    offset += 2;
    if (marker === 0xd9) return pixels;
    if (marker === 0x00 || marker === 0xd8) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = readU16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      pixels === null
    ) {
      if (length < 8) return null;
      pixels = {
        width: readU16(bytes, offset + 5),
        height: readU16(bytes, offset + 3),
      };
      if (pixels.width === 0 || pixels.height === 0) return null;
    }
    offset += length;
    if (marker === 0xda)
      // Entropy-coded data: 0xFF00 is stuffing and RSTn stay inside the scan.
      while (offset < bytes.length) {
        if (bytes[offset] === 0xff) {
          const next = bytes[offset + 1];
          if (next === undefined) return null;
          if (next !== 0x00 && (next < 0xd0 || next > 0xd7)) break;
          offset += 2;
        } else offset++;
      }
  }
}

const base64Alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Sextet value per ASCII code, or -1 for a character outside the alphabet. */
const base64Lookup: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < base64Alphabet.length; index++)
    table[base64Alphabet.charCodeAt(index)] = index;
  return table;
})();

/** XML whitespace only: space, tab, CR and LF. */
const isXmlSpace = (code: number) =>
  code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;

/** Length of `text` once XML whitespace is removed, without building the stripped string. */
export function compactLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++)
    if (!isXmlSpace(text.charCodeAt(i))) length++;
  return length;
}

/**
 * Decodes RDL base64 text in a single pass: XML whitespace (space, tab, CR, LF)
 * anywhere is ignored, other whitespace such as NBSP or U+FEFF is refused; the
 * standard alphabet with correct padding is required. Returns null otherwise.
 */
export function decodeImageData(text: string): Uint8Array | null {
  const out = new Uint8Array(Math.ceil((text.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  let characters = 0;
  let padding = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isXmlSpace(code)) continue;
    characters++;
    if (code === 0x3d) {
      if (++padding > 2) return null;
      continue;
    }
    const value = code < 128 ? (base64Lookup[code] as number) : -1;
    if (padding > 0 || value < 0) return null;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (accumulator >> bits) & 0xff;
      accumulator &= (1 << bits) - 1;
    }
  }
  if (characters === 0 || characters % 4 !== 0) return null;
  return written === out.length ? out : out.slice(0, written);
}
