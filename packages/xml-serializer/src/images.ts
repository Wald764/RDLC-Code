import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { ImageMime } from '@rdlc/report-model/images';
import type { ReportSection } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import {
  child,
  composePlans,
  element,
  insertChild,
  patchPlan,
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
  if (request.definition) {
    const embedded = child(root, 'EmbeddedImages');
    const definition = request.definition;
    plans.push(
      patchPlan(snapshot, [
        insertChild(
          snapshot,
          embedded ?? root,
          embedded
            ? definitionXml(embedded, definition)
            : element(root, 'EmbeddedImages', definitionXml(root, definition)),
        ),
      ]),
    );
  }
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
