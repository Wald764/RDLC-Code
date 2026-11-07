import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_TOO_LARGE,
  dimensionLimit,
  pixelLimit,
  rawImageLimit,
} from '@rdlc/report-model/images';
import type {
  ImageMime,
  ImageRefusal,
  ValidatedPicture,
} from '@rdlc/report-model/images';
import {
  crc32,
  decodeImageData,
  sniffFormat,
  walkJpeg,
  walkPng,
} from '@rdlc/report-model/image-data';

// The platform-neutral byte walkers live in report-model so that xml-parser can
// share them without depending on validation; re-exported for existing callers.
export { crc32, decodeImageData, sniffFormat, walkJpeg, walkPng };

function refusal(
  code: ImageRefusal['code'],
  fileName: string,
  limit?: number,
  actual?: number,
): ImageRefusal {
  return limit === undefined
    ? { code, fileName }
    : { code, limit, actual: actual as number, fileName };
}

/**
 * Strips directories (after the last '/' or '\\') and the last extension.
 * An extension-only name such as '.png' yields an empty stem.
 */
function stemOf(fileName: string): string {
  const base = fileName.slice(
    Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1,
  );
  const dot = base.lastIndexOf('.');
  return dot < 0 ? base : base.slice(0, dot);
}

/**
 * Validates in contract order: signature, structure, size, then pixels.
 * `fileName` may be a base name or a path ('/' or '\\' separated); it is only
 * echoed in refusals and used for `fileStem`. Refusals never include bytes.
 */
export function validatePicture(
  bytes: Uint8Array,
  fileName: string,
  digest: (bytes: Uint8Array) => string,
): ValidatedPicture | ImageRefusal {
  const format = sniffFormat(bytes);
  if (format === 'other') return refusal(IMAGE_FORMAT_UNSUPPORTED, fileName);
  const pixels = format === 'png' ? walkPng(bytes) : walkJpeg(bytes);
  if (pixels === null) return refusal(IMAGE_DATA_INVALID, fileName);
  if (bytes.length > rawImageLimit)
    return refusal(IMAGE_TOO_LARGE, fileName, rawImageLimit, bytes.length);
  const largest = Math.max(pixels.width, pixels.height);
  if (largest > dimensionLimit)
    return refusal(IMAGE_PIXELS_EXCEEDED, fileName, dimensionLimit, largest);
  const total = pixels.width * pixels.height;
  if (total > pixelLimit)
    return refusal(IMAGE_PIXELS_EXCEEDED, fileName, pixelLimit, total);
  const mime: ImageMime = format === 'png' ? 'image/png' : 'image/jpeg';
  return {
    format,
    mime,
    bytes,
    pixels,
    hash: digest(bytes),
    fileStem: stemOf(fileName),
  };
}

/**
 * Picks a free EmbeddedImage definition name from the file name: the base name
 * without its extension, reduced to a letter-first ASCII identifier, then the
 * first free of stem, stem_1, stem_2... (case-sensitive). `fileName` may be a
 * base name or a path ('/' or '\\' separated); only its last segment is used.
 */
export function allocateDefinitionName(
  fileName: string,
  existingDefinitionNames: readonly string[],
): string {
  const stem =
    stemOf(fileName)
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^[^A-Za-z]+/, '')
      .replace(/_+$/, '') || 'Image';
  let candidate = stem;
  for (let suffix = 1; existingDefinitionNames.includes(candidate); suffix++)
    candidate = `${stem}_${suffix}`;
  return candidate;
}
