import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_PROPERTY_INVALID,
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
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { SourceRange } from '@rdlc/report-model/document';
import {
  imageScalarProperties,
  type ImageScalarProperty,
} from '@rdlc/report-model/editing';
import type { ImageItem } from '@rdlc/report-model/report';
import { validateName } from './validate.js';
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

export type ImageProperty =
  | 'image'
  | 'name'
  | 'left'
  | 'top'
  | 'width'
  | 'height'
  | 'sizing'
  | 'value'
  | 'toolTip';

/**
 * Capability guard run before planning a patch for an image item; keeps unsupported
 * content intact. A geometry-only item (missing or undisplayable definition) passes for
 * `name` and the geometry keys only; a preservation-only item passes for nothing.
 */
export function validateImageCapability(
  image: ImageItem,
  property: ImageProperty,
): readonly Diagnostic[] {
  if (image.capabilities.includes(property)) return [];
  return [
    {
      code: 'CAPABILITY_BLOCKED',
      category: 'unsupported',
      severity: 'error',
      range: image.node.range,
      message: `The ${property} property is preservation-only for this image.`,
      correctiveAction:
        'Edit this value in the source editor; the designer will not rewrite preserved content.',
      blockedOperations: ['requested-edit'],
      itemId: image.node.id,
      property,
    },
  ];
}

const sizingModes: readonly string[] = [
  'AutoSize',
  'Fit',
  'FitProportional',
  'Clip',
];

/**
 * Validates one authored image scalar. The diagnostics name the property and the rule,
 * never the submitted value, so nothing a caller pastes can reach a message (FR-025).
 * A ToolTip is free text, stored escaped and never evaluated; an expression is accepted
 * as the text it is. `existingNames` excludes the item's own current name.
 */
export function validateImageProperty(input: {
  readonly property: ImageScalarProperty;
  readonly value: string;
  readonly range: SourceRange;
  readonly existingNames: readonly string[];
  readonly definitions: readonly {
    readonly name: string;
    readonly displayable: boolean;
  }[];
}): readonly Diagnostic[] {
  const { property, value } = input;
  const invalid = (message: string): readonly Diagnostic[] => [
    {
      code: IMAGE_PROPERTY_INVALID,
      category: 'invalid-value',
      severity: 'error',
      range: input.range,
      message,
      correctiveAction:
        'Correct the authored value or inspect the item in source.',
      blockedOperations: ['requested-edit'],
      property,
    },
  ];
  if (!(imageScalarProperties as readonly string[]).includes(property))
    return invalid('This image property cannot be set this way.');
  switch (property) {
    case 'sizing':
      return sizingModes.includes(value)
        ? []
        : invalid('Use AutoSize, Fit, FitProportional or Clip for Sizing.');
    case 'value':
      return input.definitions.some(
        (definition) => definition.displayable && definition.name === value,
      )
        ? []
        : invalid(
            'Choose an embedded image of this report that can be displayed.',
          );
    case 'name':
      return validateName(value, input.existingNames)
        ? []
        : invalid(
            'Use a unique, CLS-compatible report-item name within this report.',
          );
    case 'toolTip':
      return [];
  }
}
