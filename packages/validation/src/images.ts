import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_PROPERTY_INVALID,
  IMAGE_REMOVE_BLOCKED,
  IMAGE_RENAME_BLOCKED,
  IMAGE_TOO_LARGE,
  dimensionLimit,
  pixelLimit,
  rawImageLimit,
  embeddedImageNameMaxLength,
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
import {
  RDL_2016,
  type EmbeddedImageDefinition,
  type ImageItem,
} from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import {
  findImageElementReferences,
  mayBeEmbedded,
} from '@rdlc/report-model/image-references';
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
  // The stem is cut before the numeric suffix is appended so the final name
  // never exceeds the CLS length cap; a cut never leaves a trailing '_'.
  const fit = (suffix: string): string =>
    `${stem.slice(0, embeddedImageNameMaxLength - suffix.length).replace(/_+$/, '')}${suffix}`;
  let candidate = fit('');
  for (let n = 1; existingDefinitionNames.includes(candidate); n++)
    candidate = fit(`_${n}`);
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

/** Why an image reference stops a rename or a removal. */
export type DefinitionBlockerKind =
  /** A constant `Value` naming the definition: blocks removal only (rename rewrites it). */
  | 'reference'
  /** An expression `Value` that could evaluate to the definition name. */
  | 'expression'
  /** A reference in a form that cannot be rewritten safely. */
  | 'unsafe'
  /** A `BackgroundImage` of another element, which this feature never rewrites. */
  | 'background'
  /**
   * Another image element (`PointerImage`, `IndicatorImage`, `MapMarkerImage`...) that
   * could name the definition and that this feature never rewrites.
   */
  | 'element'
  /** Rename only: the item already points at the requested name, which has no definition. */
  | 'capture';

export interface DefinitionBlocker {
  readonly kind: DefinitionBlockerKind;
  /** The referencing element: an `Image` item, or the owner of another image element. */
  readonly node: XmlNode;
  readonly name: string | null;
  /** Local name of the image element behind an `element` blocker, such as `PointerImage`. */
  readonly element?: string;
}

const rdlChild = (node: XmlNode, name: string): readonly XmlNode[] =>
  node.children.filter(
    (entry) =>
      entry.expandedName.namespaceUri === RDL_2016 &&
      entry.expandedName.localName === name,
  );

const nameOf = (node: XmlNode): string | null =>
  node.attributes.find(
    (attribute) =>
      attribute.expandedName.namespaceUri === '' &&
      attribute.expandedName.localName === 'Name',
  )?.value ?? null;

/**
 * Image items whose constant `Value` names the definition and that can be rewritten
 * by a scalar patch: `Source` is Embedded and `Source`/`Value` each appear once.
 */
export function rewritableReferences(
  images: readonly ImageItem[],
  name: string,
): readonly ImageItem[] {
  return images.filter(
    (image) =>
      image.source === 'Embedded' &&
      image.value?.kind === 'constant' &&
      image.value.text === name &&
      rdlChild(image.node, 'Value').length === 1 &&
      rdlChild(image.node, 'Source').length === 1,
  );
}

/**
 * Everything that stops a definition from being renamed (`rename`) or removed
 * (`remove`), in source order. A constant reference is rewritten by a rename and so only
 * blocks a removal. A reference that could name the definition but is not a rewritable
 * constant always blocks: an expression `Value` (its result is never evaluated here), a
 * constant behind an unknown or repeated `Source`/`Value`, a structured `Value`, and any
 * other image element (`BackgroundImage`, `PointerImage`, `IndicatorImage`,
 * `MapMarkerImage`...) that points at it, because only `Image` items are ever rewritten.
 * External and Database images never name an embedded definition.
 *
 * With `capturing` (a rename to a name that has no definition yet), an item that already
 * references that name by constant also blocks: the rename would silently give it a
 * picture.
 */
export function findDefinitionBlockers(input: {
  readonly operation: 'rename' | 'remove';
  readonly root: XmlNode | null;
  readonly images: readonly ImageItem[];
  readonly name: string;
  readonly capturing?: string;
}): readonly DefinitionBlocker[] {
  const { operation, root, images, name, capturing } = input;
  const rewritable = new Set(rewritableReferences(images, name));
  const blockers: DefinitionBlocker[] = [];
  for (const image of images) {
    const named = nameOf(image.node);
    if (rewritable.has(image)) {
      if (operation === 'remove')
        blockers.push({ kind: 'reference', node: image.node, name: named });
    } else if (mayBeEmbedded(image.source)) {
      const values = rdlChild(image.node, 'Value');
      if (image.value?.kind === 'expression')
        blockers.push({ kind: 'expression', node: image.node, name: named });
      else if (
        (image.value?.kind === 'constant' && image.value.text === name) ||
        values.length > 1 ||
        (values.length === 1 && image.value === null)
      )
        blockers.push({ kind: 'unsafe', node: image.node, name: named });
    }
    if (
      capturing !== undefined &&
      mayBeEmbedded(image.source) &&
      image.value?.kind === 'constant' &&
      image.value.text === capturing
    )
      blockers.push({ kind: 'capture', node: image.node, name: named });
  }
  for (const reference of findImageElementReferences(root)) {
    const owner = reference.owner;
    const element = reference.node.expandedName.localName;
    const at = {
      node: owner ?? reference.node,
      name: owner ? nameOf(owner) : null,
      element,
    };
    if (!mayBeEmbedded(reference.source)) continue;
    if (reference.value.kind !== 'constant' || reference.value.text === name)
      blockers.push({
        kind: element === 'BackgroundImage' ? 'background' : 'element',
        ...at,
      });
    else if (capturing !== undefined && reference.value.text === capturing)
      blockers.push({ kind: 'capture', ...at });
  }
  return blockers.sort((a, b) => a.node.range.start - b.node.range.start);
}

/** Most blocking items one refusal spells out; the rest are summarized by count. */
const maxListedBlockers = 20;

/**
 * Guard for renaming or removing an embedded image definition (FR-022). Returns
 * `IMAGE_RENAME_BLOCKED` or `IMAGE_REMOVE_BLOCKED` with one diagnostic per blocking item
 * (its `itemId` is the item's node, `message` names it), or none when the mutation is
 * safe. A definition name that does not resolve to exactly one entry is refused too.
 * Messages carry authored names only, never picture data (FR-025).
 */
export function validateDefinitionMutation(input: {
  readonly operation: 'rename' | 'remove';
  readonly root: XmlNode | null;
  readonly definitions: readonly EmbeddedImageDefinition[];
  readonly images: readonly ImageItem[];
  readonly name: string;
  /** Rename only: the requested name, checked for items it would silently capture. */
  readonly newName?: string;
}): readonly Diagnostic[] {
  const { operation, name } = input;
  const code =
    operation === 'rename' ? IMAGE_RENAME_BLOCKED : IMAGE_REMOVE_BLOCKED;
  const verb = operation === 'rename' ? 'renamed' : 'removed';
  const blocked = (
    range: SourceRange,
    message: string,
    itemId?: string,
  ): Diagnostic => ({
    code,
    category: 'preservation-risk',
    severity: 'error',
    range,
    message,
    correctiveAction:
      operation === 'rename'
        ? 'Update the listed items in the source editor, then rename the embedded image.'
        : 'Remove or repoint the listed items first, then remove the embedded image.',
    blockedOperations: ['requested-edit'],
    ...(itemId === undefined ? {} : { itemId }),
    property: 'name',
  });
  const matches = input.definitions.filter((entry) => entry.name === name);
  if (matches.length !== 1)
    return [
      blocked(
        matches[0]?.node.range ?? input.root?.range ?? { start: 0, end: 0 },
        matches.length === 0
          ? `Embedded image "${name}" no longer exists.`
          : `Embedded image "${name}" is defined more than once and cannot be ${verb} safely.`,
      ),
    ];
  const blockers = findDefinitionBlockers({
    operation,
    root: input.root,
    images: input.images,
    name,
    // A name that already has a definition is refused by the name rule instead.
    ...(operation === 'rename' &&
    input.newName !== undefined &&
    input.newName !== name &&
    !input.definitions.some((entry) => entry.name === input.newName)
      ? { capturing: input.newName }
      : {}),
  });
  const listed = blockers.slice(0, maxListedBlockers).map((blocker) => {
    const label =
      blocker.name === null ? 'An unnamed item' : `"${blocker.name}"`;
    const reason = {
      reference: `${label} still references embedded image "${name}".`,
      expression: `${label} has an expression Value that could name embedded image "${name}".`,
      unsafe: `${label} references embedded image "${name}" in a form that cannot be rewritten safely.`,
      background: `The background image of ${label} could reference embedded image "${name}".`,
      element: `The ${blocker.element ?? 'image'} of ${label} could reference embedded image "${name}".`,
      capture: `${label} already references an embedded image under the requested new name, which has no definition; renaming would attach it to this one.`,
    }[blocker.kind];
    return blocked(
      blocker.node.range,
      `Embedded image "${name}" cannot be ${verb}: ${reason}`,
      blocker.node.id,
    );
  });
  if (blockers.length > maxListedBlockers)
    listed.push(
      blocked(
        matches[0]!.node.range,
        `Embedded image "${name}" cannot be ${verb}: ${blockers.length - maxListedBlockers} more items block it.`,
      ),
    );
  return listed;
}

/**
 * New definition name: a CLS-compatible identifier of 1 to 256 characters
 * (rsInvalidEmbeddedImageNameLength, MS-RDL 6.40), unique among the names of the
 * report's embedded images (`existingNames` excludes the definition being renamed).
 * The diagnostic names the rule, never the submitted text.
 */
export function validateDefinitionName(input: {
  readonly newName: string;
  readonly existingNames: readonly string[];
  readonly range: SourceRange;
}): readonly Diagnostic[] {
  return input.newName.length >= 1 &&
    input.newName.length <= embeddedImageNameMaxLength &&
    validateName(input.newName, input.existingNames)
    ? []
    : [
        {
          code: IMAGE_PROPERTY_INVALID,
          category: 'invalid-value',
          severity: 'error',
          range: input.range,
          message: `Use a unique, CLS-compatible name of 1 to ${embeddedImageNameMaxLength} characters among the embedded images of this report.`,
          correctiveAction: 'Choose a different name for the embedded image.',
          blockedOperations: ['requested-edit'],
          property: 'name',
        },
      ];
}
