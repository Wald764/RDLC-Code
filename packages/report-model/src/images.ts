/** Raw picture limit: 5 MiB of file data. */
export const rawImageLimit = 5 * 1024 * 1024;
/** Maximum width or height of a picture, in pixels. */
export const dimensionLimit = 16384;
/** Maximum width x height of a picture, in pixels. */
export const pixelLimit = 40_000_000;

export const IMAGE_FORMAT_UNSUPPORTED = 'IMAGE_FORMAT_UNSUPPORTED';
export const IMAGE_DATA_INVALID = 'IMAGE_DATA_INVALID';
export const IMAGE_TOO_LARGE = 'IMAGE_TOO_LARGE';
export const IMAGE_PIXELS_EXCEEDED = 'IMAGE_PIXELS_EXCEEDED';
export const IMAGE_REPORT_BUDGET = 'IMAGE_REPORT_BUDGET';
export const IMAGE_PROPERTY_INVALID = 'IMAGE_PROPERTY_INVALID';
export const IMAGE_RENAME_BLOCKED = 'IMAGE_RENAME_BLOCKED';
export const IMAGE_REMOVE_BLOCKED = 'IMAGE_REMOVE_BLOCKED';
export const IMAGE_TARGET_STALE = 'IMAGE_TARGET_STALE';
export const IMAGE_READ_FAILED = 'IMAGE_READ_FAILED';

export type ImageRefusalCode =
  | typeof IMAGE_FORMAT_UNSUPPORTED
  | typeof IMAGE_DATA_INVALID
  | typeof IMAGE_TOO_LARGE
  | typeof IMAGE_PIXELS_EXCEEDED
  | typeof IMAGE_REPORT_BUDGET
  | typeof IMAGE_PROPERTY_INVALID
  | typeof IMAGE_RENAME_BLOCKED
  | typeof IMAGE_REMOVE_BLOCKED
  | typeof IMAGE_TARGET_STALE
  | typeof IMAGE_READ_FAILED;

export type ImageReason =
  | 'format-unsupported'
  | 'data-invalid'
  | 'too-large'
  | 'pixels-exceeded'
  | 'mime-mismatch'
  | 'value-expression';

export type ImageSizing = 'AutoSize' | 'Fit' | 'FitProportional' | 'Clip';

export type ImageFormat = 'png' | 'jpeg';
export type ImageMime = 'image/png' | 'image/jpeg';

export interface ImagePixels {
  readonly width: number;
  readonly height: number;
}

export interface ValidatedPicture {
  readonly format: ImageFormat;
  readonly mime: ImageMime;
  readonly bytes: Uint8Array;
  readonly pixels: ImagePixels;
  /** SHA-256 of the bytes, as injected by the host. */
  readonly hash: string;
  /** File name without its extension. */
  readonly fileStem: string;
}

/** A refusal carries the file name only, never its content. */
export interface ImageRefusal {
  readonly code: ImageRefusalCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly fileName: string;
}

export interface ImageAsset {
  /** The picture hash. */
  readonly key: string;
  readonly mime: ImageMime;
  /** Base64 payload. */
  readonly data: string;
}
