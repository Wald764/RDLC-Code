import type { XmlNode } from '@rdlc/report-model/syntax';
import type {
  EmbeddedImageDefinition,
  ImageItem,
  TextboxBounds,
} from '@rdlc/report-model/report';
import type {
  ImageFormat,
  ImagePixels,
  ImageReason,
  ImageSizing,
} from '@rdlc/report-model/images';
import {
  dimensionLimit,
  pixelLimit,
  rawImageLimit,
} from '@rdlc/report-model/images';
import {
  compactLength,
  decodeImageData,
  sniffFormat,
  walkJpeg,
  walkPng,
} from '@rdlc/report-model/image-data';
import { child, children, RDL_2016 } from './names.js';

export interface ImageProjectionOptions {
  /** SHA-256 of the decoded bytes, supplied by the host; `hash` is `null` without it. */
  readonly digest?: (bytes: Uint8Array) => string;
  /** False when the report is not editable: every item is then preservation-only. */
  readonly editable?: boolean;
}

export interface ImageProjection {
  readonly images: readonly ImageItem[];
  readonly embeddedImages: readonly EmbeddedImageDefinition[];
}

const tablixContainers = new Set([
  'Tablix',
  'TablixCell',
  'TablixRow',
  'TablixRows',
  'Table',
  'Matrix',
]);
const geometryNames = ['left', 'top', 'width', 'height'] as const;
const sizingModes: readonly ImageSizing[] = [
  'AutoSize',
  'Fit',
  'FitProportional',
  'Clip',
];

/** Literal RdlSize only; expression-valued geometry stays preservation-only. */
const size = /^-?\d+(?:\.\d+)?(?:pt|pc|in|mm|cm)$/;

function attribute(
  node: XmlNode,
  name: string,
): XmlNode['attributes'][number] | null {
  return (
    node.attributes.find(
      (candidate) =>
        candidate.expandedName.namespaceUri === '' &&
        candidate.expandedName.localName === name,
    ) ?? null
  );
}

const isExpression = (text: string) => text.trim().startsWith('=');

type DefinitionFacts = Omit<EmbeddedImageDefinition, 'references'>;

/**
 * Encoded length of exactly `rawImageLimit` bytes. A longer text cannot decode to a
 * permitted picture, so it is classified without decoding.
 */
const encodedLimit = Math.ceil(rawImageLimit / 3) * 4;

/**
 * A repeated name never resolves (the first definition owns it): the repeat is not
 * displayable, is never decoded or hashed, and reports `data-invalid`.
 */
function projectDefinition(
  node: XmlNode,
  options: ImageProjectionOptions,
  duplicate: boolean,
): DefinitionFacts | null {
  const nameAttribute = attribute(node, 'Name');
  if (!nameAttribute) return null;
  const mimeNode = child(node, 'MIMEType');
  const mimeText = mimeNode ? mimeNode.text.trim() : null;
  const mime = mimeText === null || isExpression(mimeText) ? null : mimeText;
  const raw = child(node, 'ImageData')?.text ?? '';
  const encodedSize = compactLength(raw);
  // `byteSize` stays null when the text is oversized: it is never decoded.
  const oversized = encodedSize > encodedLimit;
  const bytes = duplicate || oversized ? null : decodeImageData(raw);

  let format: ImageFormat | 'other' = 'other';
  let pixels: ImagePixels | null = null;
  let reason: ImageReason | null = null;
  if (duplicate) reason = 'data-invalid';
  else if (oversized) reason = 'too-large';
  else if (bytes === null) reason = 'data-invalid';
  else {
    format = sniffFormat(bytes);
    if (format === 'other') reason = 'format-unsupported';
    else {
      pixels = format === 'png' ? walkPng(bytes) : walkJpeg(bytes);
      if (pixels === null) reason = 'data-invalid';
      else if (bytes.length > rawImageLimit) reason = 'too-large';
      else if (
        Math.max(pixels.width, pixels.height) > dimensionLimit ||
        pixels.width * pixels.height > pixelLimit
      )
        reason = 'pixels-exceeded';
    }
  }
  // MS-RDL 2.2.10 also lists `image/x-png` among the ReportMIMEType values. Only
  // `image/png` and `image/jpeg` are written and displayed (FR-004), so any other
  // declared type, `image/x-png` included, is a `mime-mismatch`: the definition is
  // preserved as written and the item is geometry-only. An expression MIMEType is never
  // evaluated and reports `value-expression`. The format itself comes from the content.
  if (reason === null && format !== 'other') {
    if (mimeText !== null && isExpression(mimeText))
      reason = 'value-expression';
    else if (mime !== (format === 'png' ? 'image/png' : 'image/jpeg'))
      reason = 'mime-mismatch';
  }
  const displayable = reason === null;
  return {
    node,
    name: nameAttribute.value,
    nameRange: nameAttribute.valueRange,
    mime,
    format,
    encodedSize,
    byteSize: bytes === null ? null : bytes.length,
    pixels,
    hash: displayable && bytes && options.digest ? options.digest(bytes) : null,
    displayable,
    reason,
  };
}

/**
 * Projects `EmbeddedImage` definitions (MS-RDL 2.306) and `Image` items (MS-RDL 2.12).
 * Only facts derived from the report text are produced; nothing is fetched, resolved
 * from a path or evaluated, and the payload itself never leaves this function.
 */
export function projectImages(
  root: XmlNode | null,
  options: ImageProjectionOptions = {},
): ImageProjection {
  if (
    !root ||
    root.expandedName.namespaceUri !== RDL_2016 ||
    root.expandedName.localName !== 'Report'
  )
    return { images: [], embeddedImages: [] };

  const byName = new Map<string, DefinitionFacts>();
  const definitions: DefinitionFacts[] = [];
  const repeats = new Set<DefinitionFacts>();
  for (const node of children(root, 'EmbeddedImages').flatMap((container) =>
    children(container, 'EmbeddedImage'),
  )) {
    const name = attribute(node, 'Name')?.value;
    const definition = projectDefinition(
      node,
      options,
      name !== undefined && byName.has(name),
    );
    if (!definition) continue;
    definitions.push(definition);
    if (byName.has(definition.name)) repeats.add(definition);
    else byName.set(definition.name, definition);
  }

  const containers = children(root, 'ReportSections');
  const sections = containers.flatMap((node) =>
    children(node, 'ReportSection'),
  );
  const body =
    containers.length === 1 && sections.length === 1
      ? child(sections[0]!, 'Body')
      : null;
  const bodyItems = body ? child(body, 'ReportItems') : null;

  const images: ImageItem[] = [];
  const visit = (node: XmlNode, inTablix: boolean, parent: XmlNode | null) => {
    if (
      node.expandedName.namespaceUri === RDL_2016 &&
      node.expandedName.localName === 'Image'
    )
      images.push(
        projectItem(
          node,
          inTablix
            ? 'table-cell'
            : parent !== null && parent === bodyItems
              ? 'body'
              : 'preserved',
          byName,
          options.editable !== false,
        ),
      );
    const nested =
      inTablix ||
      (node.expandedName.namespaceUri === RDL_2016 &&
        tablixContainers.has(node.expandedName.localName));
    for (const next of node.children) visit(next, nested, node);
  };
  visit(root, false, null);

  const references = new Map<string, string[]>();
  // An unnamed item still counts, under its node id, so removal checks stay safe.
  for (const item of images)
    if (item.value?.kind === 'constant')
      references.set(item.value.text, [
        ...(references.get(item.value.text) ?? []),
        item.name ?? item.node.id,
      ]);
  return {
    images,
    embeddedImages: definitions.map((definition) => ({
      ...definition,
      references: repeats.has(definition)
        ? []
        : (references.get(definition.name) ?? []),
    })),
  };
}

function projectItem(
  node: XmlNode,
  context: ImageItem['context'],
  definitions: ReadonlyMap<string, DefinitionFacts>,
  reportEditable: boolean,
): ImageItem {
  const nameAttribute = attribute(node, 'Name');
  const insertable = node.closeRange !== null;

  const bounds: { -readonly [K in keyof TextboxBounds]: string | null } = {
    left: null,
    top: null,
    width: null,
    height: null,
  };
  const boundsRanges: Record<
    'left' | 'top' | 'width' | 'height',
    XmlNode['range'] | null
  > = { left: null, top: null, width: null, height: null };
  const geometry: string[] = [];
  for (const key of geometryNames) {
    const element = child(node, key[0]!.toUpperCase() + key.slice(1));
    bounds[key] = element ? element.text : null;
    boundsRanges[key] = element ? element.range : null;
    if (insertable && (!element || size.test(element.text.trim())))
      geometry.push(key);
  }

  const sourceNodes = children(node, 'Source');
  const valueNodes = children(node, 'Value');
  const sizingNodes = children(node, 'Sizing');
  const toolTipNodes = children(node, 'ToolTip');
  const duplicated = [sourceNodes, valueNodes, sizingNodes, toolTipNodes].some(
    (nodes) => nodes.length > 1,
  );

  const sourceNode = sourceNodes[0] ?? null;
  const sourceText = sourceNode ? sourceNode.text.trim() : null;
  const source: ImageItem['source'] =
    sourceText === null
      ? null
      : isExpression(sourceText)
        ? 'expression'
        : sourceText === 'Embedded' ||
            sourceText === 'External' ||
            sourceText === 'Database'
          ? sourceText
          : null;

  const valueNode = valueNodes[0] ?? null;
  const value: ImageItem['value'] =
    valueNode && valueNode.children.length === 0
      ? isExpression(valueNode.text)
        ? { kind: 'expression' }
        : { kind: 'constant', text: valueNode.text }
      : null;

  const sizingNode = sizingNodes[0] ?? null;
  const sizingText = sizingNode ? sizingNode.text.trim() : null;
  const declaredSizing = sizingModes.find((mode) => mode === sizingText);
  const sizing: ImageSizing = declaredSizing ?? 'AutoSize';
  const sizingValid = sizingNode === null || declaredSizing !== undefined;

  const toolTipNode = toolTipNodes[0] ?? null;
  const toolTip: ImageItem['toolTip'] =
    toolTipNode && toolTipNode.children.length === 0
      ? { text: toolTipNode.text, expression: isExpression(toolTipNode.text) }
      : null;

  const definition =
    source === 'Embedded' && value?.kind === 'constant'
      ? (definitions.get(value.text) ?? null)
      : null;

  let reason: ImageItem['reason'] = null;
  if (source !== 'Embedded') reason = 'source-preserved';
  else if (value === null) reason = 'source-preserved';
  else if (value.kind === 'expression') reason = 'value-expression';
  else if (definition === null) reason = 'reference-missing';
  else reason = definition.reason;

  const authorable =
    reportEditable &&
    context === 'body' &&
    insertable &&
    !duplicated &&
    sizingValid &&
    source === 'Embedded' &&
    value?.kind === 'constant';
  const named = nameAttribute ? ['name'] : [];
  // A structured ToolTip has no inert text to edit, so the capability is withheld.
  const toolTipEditable = toolTipNode === null || toolTip !== null;
  const capabilities: string[] = !authorable
    ? []
    : definition?.displayable
      ? [
          'image',
          ...named,
          ...geometry,
          'sizing',
          'value',
          ...(toolTipEditable ? ['toolTip'] : []),
        ]
      : [...named, ...geometry];

  return {
    node,
    name: nameAttribute ? nameAttribute.value : null,
    nameRange: nameAttribute ? nameAttribute.valueRange : null,
    context,
    bounds,
    boundsRanges,
    source,
    value,
    sizing,
    sizingRange: sizingNode ? sizingNode.range : null,
    toolTip,
    definition: definition ? definition.name : null,
    capabilities,
    reason: reason ?? (capabilities.length === 0 ? 'source-preserved' : null),
  };
}
