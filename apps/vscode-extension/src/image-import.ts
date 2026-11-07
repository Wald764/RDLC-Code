import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import { parseSize, toPoints } from '@rdlc/report-model/geometry';
import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_READ_FAILED,
  IMAGE_TOO_LARGE,
  dimensionLimit,
  rawImageLimit,
} from '@rdlc/report-model/images';
import type {
  ImagePixels,
  ImageRefusal,
  ValidatedPicture,
} from '@rdlc/report-model/images';
import type { PatchPlan } from '@rdlc/report-model/editing';
import {
  sourceByteBudget,
  sourceStringLengthBudget,
} from '@rdlc/xml-parser/parser';
import { validatePicture } from '@rdlc/validation/images';

/**
 * Where a picture comes from. The host owns every file access: the webview never names
 * a path or URI. `uri` is an opaque token that only the source that issued it
 * interprets, so a fake source can be used without VS Code. The VS Code implementation
 * lives in `image-source.ts`.
 */
export interface ImageSource {
  pick(): Promise<{ uri: unknown; fileName: string } | 'cancelled'>;
  stat(uri: unknown): Promise<number>;
  read(uri: unknown): Promise<Uint8Array>;
}

/**
 * Terminal or intermediate states of an `ImageImportRequest` (data-model.md). Every
 * state other than an accepted edit leaves the report and the history unchanged.
 */
export type ImportOutcome =
  | { readonly state: 'cancelled' }
  | { readonly state: 'refused'; readonly refusal: ImageRefusal }
  | {
      readonly state: 'validated';
      readonly picture: ValidatedPicture;
      /** The chosen file's name; used for the definition name and in refusals. */
      readonly fileName: string;
    };

const MiB = 1024 * 1024;
const mebibytes = (bytes: number): string => `${(bytes / MiB).toFixed(2)} MiB`;

/**
 * requested -> cancelled | refused(read-failed) | read -> validated | refused. Sizes are
 * checked with `stat` before the file is read, so an oversized file is never loaded.
 * No error text, path or content is carried: a refusal names the file only.
 */
export async function runImport(
  source: ImageSource,
  digest: (bytes: Uint8Array) => string,
): Promise<ImportOutcome> {
  let picked: Awaited<ReturnType<ImageSource['pick']>>;
  try {
    picked = await source.pick();
  } catch {
    return {
      state: 'refused',
      refusal: { code: IMAGE_READ_FAILED, fileName: '' },
    };
  }
  if (picked === 'cancelled') return { state: 'cancelled' };
  const { uri, fileName } = picked;
  const failed = (): ImportOutcome => ({
    state: 'refused',
    refusal: { code: IMAGE_READ_FAILED, fileName },
  });
  let size: number;
  try {
    size = await source.stat(uri);
  } catch {
    return failed();
  }
  if (!Number.isFinite(size) || size < 0) return failed();
  if (size > rawImageLimit)
    return {
      state: 'refused',
      refusal: {
        code: IMAGE_TOO_LARGE,
        limit: rawImageLimit,
        actual: size,
        fileName,
      },
    };
  let bytes: Uint8Array;
  try {
    bytes = await source.read(uri);
  } catch {
    return failed();
  }
  const result = validatePicture(bytes, fileName, digest);
  return 'code' in result
    ? { state: 'refused', refusal: result }
    : { state: 'validated', picture: result, fileName };
}

/** A diagnostic for an import refusal; it carries the file name and limits, never bytes. */
export function refusalDiagnostic(
  refusal: ImageRefusal,
  range: Diagnostic['range'] = { start: 0, end: 0 },
): Diagnostic {
  const name = refusal.fileName ? `"${refusal.fileName}"` : 'The selected file';
  let message: string;
  let correctiveAction = 'Choose a different picture.';
  switch (refusal.code) {
    case IMAGE_FORMAT_UNSUPPORTED:
      message = `${name} is not a PNG or JPEG picture.`;
      correctiveAction = 'Choose a PNG or JPEG file.';
      break;
    case IMAGE_DATA_INVALID:
      message = `${name} is damaged or truncated and cannot be used as a picture.`;
      break;
    case IMAGE_TOO_LARGE:
      message = `${name} is ${mebibytes(refusal.actual ?? 0)}; the limit is ${mebibytes(refusal.limit ?? rawImageLimit)}.`;
      correctiveAction = 'Choose a smaller picture.';
      break;
    case IMAGE_PIXELS_EXCEEDED:
      message =
        refusal.limit === dimensionLimit
          ? `${name} has a side of ${refusal.actual} px; the limit is ${refusal.limit} px.`
          : `${name} has ${refusal.actual} pixels; the limit is ${refusal.limit}.`;
      correctiveAction = 'Choose a picture with fewer pixels.';
      break;
    case IMAGE_READ_FAILED:
      message = `${name} could not be read.`;
      correctiveAction =
        'Check that the file exists and is readable, then retry.';
      break;
    default:
      message = `${name} cannot be inserted.`;
  }
  return {
    code: refusal.code,
    category: 'invalid-value',
    severity: 'error',
    range,
    message,
    correctiveAction,
    blockedOperations: ['requested-edit'],
  };
}

/** One pixel at 96 DPI, the smallest natural picture; also the floor of each dimension. */
export const minimumImagePt = 72 / 96;
const pointsPerInch = 72;
/** Default creation spot: 0.25in from the body corner, one 0.25in step while taken. */
const defaultStepPt = 18;

const inches = (points: number): string =>
  `${+(points / pointsPerInch).toFixed(4)}in`;

/**
 * The natural pixel size at 96 DPI, in inches like the textbox creation size. The width
 * is scaled down to `bodyWidth - left` keeping the aspect ratio; each dimension has a
 * floor of one pixel so the size stays positive.
 */
export function computeImageSize(
  pixels: ImagePixels,
  left: string,
  bodyWidth: string | null,
): { readonly width: string; readonly height: string } {
  let width = (pixels.width * 72) / 96;
  let height = (pixels.height * 72) / 96;
  const bodyPt = toPoints(bodyWidth);
  const leftPt = toPoints(left);
  if (bodyPt !== null && leftPt !== null) {
    const available = Math.max(0, bodyPt - leftPt);
    if (width > available) {
      height *= available / width;
      width = available;
    }
  }
  return {
    width: inches(Math.max(width, minimumImagePt)),
    height: inches(Math.max(height, minimumImagePt)),
  };
}

/**
 * Fallback default spot for requests that carry no coordinates (e.g. the native
 * sidebar). The designer normally sends its own textbox default spot (visible body
 * corner plus grid step, occupied check) with `placement: 'default'`, and that wins.
 * Here: 0.25in, and items already sitting on it push the new one down a 0.25in step.
 */
export function defaultImagePosition(
  occupied: readonly { left: string | null; top: string | null }[],
): { readonly left: string; readonly top: string } {
  const taken = (spot: number) =>
    occupied.some(
      (item) =>
        Math.abs((parseSize(item.left)?.points ?? NaN) - spot) < 0.01 &&
        Math.abs((parseSize(item.top)?.points ?? NaN) - spot) < 0.01,
    );
  let spot = defaultStepPt;
  for (let step = 0; step < 50 && taken(spot); step++) spot += defaultStepPt;
  return { left: inches(spot), top: inches(spot) };
}

/**
 * Whether the candidate text would exceed the 16 MiB visual parsing budget (string
 * length and UTF-8 bytes), computed from the plan so a refused import never builds,
 * parses or verifies the candidate.
 */
export function exceedsParseBudget(
  source: string,
  plan: Pick<PatchPlan, 'patches'>,
  sourceBytes = new TextEncoder().encode(source).length,
): boolean {
  const encoder = new TextEncoder();
  let length = source.length;
  let bytes = sourceBytes;
  for (const patch of plan.patches) {
    length += patch.replacement.length - (patch.end - patch.start);
    bytes +=
      encoder.encode(patch.replacement).length -
      encoder.encode(patch.expected).length;
  }
  return length > sourceStringLengthBudget || bytes > sourceByteBudget;
}
