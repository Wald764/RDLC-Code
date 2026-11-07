import type { DesignSceneItem } from '@rdlc/report-model/scene';

/** Why an image item shows a placeholder instead of a picture. */
export type ImagePlaceholderReason = Extract<
  NonNullable<DesignSceneItem['display']>,
  { state: 'placeholder' }
>['reason'];

/**
 * Plain-language label per placeholder reason. Exhaustive on purpose: a new host
 * reason fails type checking here until it has wording, and the wording can be
 * refined in place without touching the template.
 */
export const imagePlaceholderLabels: Readonly<
  Record<ImagePlaceholderReason, string>
> = {
  'format-unsupported': 'Unsupported image format',
  'data-invalid': 'Image data is invalid',
  'too-large': 'Image is too large',
  'pixels-exceeded': 'Image has too many pixels',
  'mime-mismatch': 'Image type does not match its data',
  'value-expression': 'Image value is an expression',
  'source-preserved': 'Image source is preserved as written',
  'reference-missing': 'Embedded image not found',
};

/** Shown while a referenced picture's asset has not arrived or is still decoding. */
export const imagePendingLabel = 'Loading image…';
