import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { ImageScalarProperty } from '@rdlc/report-model/editing';
import type { ImageMime } from '@rdlc/report-model/images';
import type {
  EmbeddedImageDefinition,
  ImageItem,
  ReportSection,
} from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import {
  child,
  composePlans,
  element,
  insertChild,
  patchPlan,
  renameNode,
  setScalar,
  sourcePatch,
} from './structure.js';
import { escapeAttribute, escapeText } from './textboxes.js';

export interface CreateImageRequest {
  /** Absent when the item reuses an existing definition: nothing is then written for it. */
  readonly definition?: {
    readonly name: string;
    readonly mime: ImageMime;
    /** Base64 of the unmodified file bytes, written as one line. */
    readonly base64: string;
  };
  readonly item: {
    readonly name: string;
    /** The referenced definition name (`Value`). */
    readonly value: string;
    readonly top: string;
    readonly left: string;
    readonly height: string;
    readonly width: string;
  };
}

function definitionXml(
  parent: XmlNode,
  definition: NonNullable<CreateImageRequest['definition']>,
): string {
  return element(
    parent,
    'EmbeddedImage',
    element(parent, 'MIMEType', escapeText(definition.mime)) +
      element(parent, 'ImageData', escapeText(definition.base64)),
  ).replace('>', ` Name="${escapeAttribute(definition.name)}">`);
}

/** Schema order of research R1: Source, Value, Sizing, then Top, Left, Height, Width. */
function itemXml(parent: XmlNode, item: CreateImageRequest['item']): string {
  const e = (name: string, inner: string) =>
    element(parent, name, escapeText(inner));
  return element(
    parent,
    'Image',
    e('Source', 'Embedded') +
      e('Value', item.value) +
      e('Sizing', 'FitProportional') +
      e('Top', item.top) +
      e('Left', item.left) +
      e('Height', item.height) +
      e('Width', item.width),
  ).replace('>', ` Name="${escapeAttribute(item.name)}">`);
}

/**
 * One `EmbeddedImage` entry. `EmbeddedImages` is created as the last child of `Report`
 * when absent, otherwise the entry is appended.
 */
function planInsertDefinition(
  snapshot: DocumentSnapshot,
  root: XmlNode,
  definition: NonNullable<CreateImageRequest['definition']>,
): PatchPlan {
  const embedded = child(root, 'EmbeddedImages');
  return patchPlan(snapshot, [
    insertChild(
      snapshot,
      embedded ?? root,
      embedded
        ? definitionXml(embedded, definition)
        : element(root, 'EmbeddedImages', definitionXml(root, definition)),
    ),
  ]);
}

/**
 * A new body image item, plus its `EmbeddedImage` definition unless one is reused.
 * `EmbeddedImages` is created as the last child of `Report` when absent, otherwise the
 * entry is appended. The item goes at the end of `Body/ReportItems` (created when
 * absent), as for `planCreateTextbox`. Both insertions are one composed plan.
 */
export function planCreateImage(
  snapshot: DocumentSnapshot,
  root: XmlNode,
  section: ReportSection,
  request: CreateImageRequest,
): PatchPlan {
  const body = child(section.node, 'Body');
  if (!body) throw new Error('Missing Body.');
  const items = child(body, 'ReportItems');
  const plans: PatchPlan[] = [];
  if (request.definition)
    plans.push(planInsertDefinition(snapshot, root, request.definition));
  plans.push(
    patchPlan(snapshot, [
      insertChild(
        snapshot,
        items ?? body,
        items
          ? itemXml(items, request.item)
          : element(body, 'ReportItems', itemXml(body, request.item)),
      ),
    ]),
  );
  return composePlans(snapshot, plans);
}

/**
 * One scalar of an image item: `Sizing`, `Value` and `ToolTip` are replaced in place or
 * appended as the last child when absent (the `Image` content model is a free choice),
 * `Name` rewrites only the attribute value. An empty `ToolTip` removes the element, and
 * is an empty plan when there is none. A structured child is never rewritten: the
 * underlying `setScalar` refuses it. Unknown children and attributes are untouched.
 */
export function planImageProperty(input: {
  readonly snapshot: DocumentSnapshot;
  readonly image: ImageItem;
  readonly property: ImageScalarProperty;
  readonly value: string;
}): PatchPlan {
  const { snapshot, image, property, value } = input;
  if (property === 'name')
    return patchPlan(snapshot, [renameNode(snapshot, image.node, value)]);
  const name = { sizing: 'Sizing', value: 'Value', toolTip: 'ToolTip' }[
    property
  ];
  if (property === 'toolTip' && value === '') {
    const existing = child(image.node, name);
    if (existing?.children.length)
      throw new Error('Structured value is preservation-only.');
    return patchPlan(
      snapshot,
      existing ? [sourcePatch(snapshot, existing.range, '')] : [],
    );
  }
  return patchPlan(snapshot, [setScalar(snapshot, image.node, name, value)]);
}

export type ReplacePictureRequest =
  | {
      /** A new definition (omitted to reuse an identical existing one) and one repoint. */
      readonly scope: 'item';
      readonly image: ImageItem;
      /** The definition the item references afterwards. */
      readonly value: string;
      readonly definition?: NonNullable<CreateImageRequest['definition']>;
    }
  | {
      /** The referenced definition's picture is rewritten, whoever references it. */
      readonly scope: 'all';
      readonly definition: EmbeddedImageDefinition;
      readonly mime: ImageMime;
      readonly base64: string;
    };

/**
 * Replacing a picture. `item` scope inserts the new definition and repoints this item's
 * `Value`; every other item keeps its reference. `all` scope rewrites `MIMEType` and
 * `ImageData` of the one definition and writes nothing else. Both are one composed plan.
 */
export function planReplacePicture(
  snapshot: DocumentSnapshot,
  root: XmlNode,
  request: ReplacePictureRequest,
): PatchPlan {
  if (request.scope === 'all')
    return patchPlan(snapshot, [
      setScalar(snapshot, request.definition.node, 'MIMEType', request.mime),
      setScalar(snapshot, request.definition.node, 'ImageData', request.base64),
    ]);
  const plans: PatchPlan[] = [];
  if (request.definition)
    plans.push(planInsertDefinition(snapshot, root, request.definition));
  plans.push(
    patchPlan(snapshot, [
      setScalar(snapshot, request.image.node, 'Value', request.value),
    ]),
  );
  return composePlans(snapshot, plans);
}

/**
 * Renames an `EmbeddedImage` and repoints every constant reference to it: the `Name`
 * attribute of the definition plus the `Value` scalar of each given image item, as one
 * composed plan. The caller passes the references (`Source` Embedded with a constant
 * `Value` equal to the old name); a structured `Value` is refused by the scalar patch.
 * Payloads, other definitions and every other byte of the items are untouched.
 */
export function planRenameDefinition(input: {
  readonly snapshot: DocumentSnapshot;
  readonly definition: EmbeddedImageDefinition;
  readonly newName: string;
  readonly references: readonly ImageItem[];
}): PatchPlan {
  const { snapshot, definition, newName, references } = input;
  return composePlans(snapshot, [
    patchPlan(snapshot, [renameNode(snapshot, definition.node, newName)]),
    ...references.map((image) =>
      patchPlan(snapshot, [setScalar(snapshot, image.node, 'Value', newName)]),
    ),
  ]);
}

/**
 * Removes one `EmbeddedImage` as a single patch. When it is the only entry of its
 * `EmbeddedImages` collection, the whole collection goes instead, because MS-RDL 2.306
 * requires at least one entry in a present collection (2.305 makes the collection itself
 * optional). A collection that holds anything besides this definition is preservation-
 * only when emptied: the plan is refused rather than leaving an invalid collection or
 * dropping unknown content.
 */
export function planRemoveDefinition(
  snapshot: DocumentSnapshot,
  root: XmlNode,
  definition: EmbeddedImageDefinition,
): PatchPlan {
  const container = child(root, 'EmbeddedImages');
  if (!container || !container.children.includes(definition.node))
    throw new Error('The embedded image is not in the report collection.');
  const others = container.children.filter(
    (entry) => entry !== definition.node,
  );
  if (others.length === 0)
    return patchPlan(snapshot, [sourcePatch(snapshot, container.range, '')]);
  const entries = others.filter(
    (entry) =>
      entry.expandedName.namespaceUri ===
        definition.node.expandedName.namespaceUri &&
      entry.expandedName.localName === 'EmbeddedImage',
  );
  if (entries.length === 0)
    throw new Error('Unknown EmbeddedImages content is preservation-only.');
  return patchPlan(snapshot, [
    sourcePatch(snapshot, definition.node.range, ''),
  ]);
}
