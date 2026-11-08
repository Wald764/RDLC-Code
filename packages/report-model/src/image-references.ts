import { RDL_2016 } from './report.js';
import type { XmlNode } from './syntax.js';

/**
 * How an image-bearing element other than the `Image` report item names a picture.
 * `BackgroundImage` (MS-RDL 2.294), `MapMarkerImage` (2.248), `IndicatorImage` (2.208),
 * `CapImage` (2.202), `TopImage` (2.190), `PointerImage` (2.183), `FrameImage` (2.166),
 * `StateImage` and `GaugeImage` all carry a `Source` and a `Value` that can name an
 * `EmbeddedImage` when the source is Embedded.
 */
export interface ImageElementReference {
  /** The element: `BackgroundImage`, `PointerImage`... */
  readonly node: XmlNode;
  /** Nearest named ancestor: the item whose style or content holds the element. */
  readonly owner: XmlNode | null;
  /** Declared `Source`; `null` when absent or unrecognized. */
  readonly source: 'Embedded' | 'External' | 'Database' | 'expression' | null;
  /** First `Value`: a constant (trimmed), an expression, or structured content. */
  readonly value:
    | { readonly kind: 'constant'; readonly text: string }
    | { readonly kind: 'expression' }
    | { readonly kind: 'structured' };
}

const child = (node: XmlNode, name: string): XmlNode | undefined =>
  node.children.find(
    (entry) =>
      entry.expandedName.namespaceUri === RDL_2016 &&
      entry.expandedName.localName === name,
  );

const hasName = (node: XmlNode): boolean =>
  node.attributes.some(
    (attribute) =>
      attribute.expandedName.namespaceUri === '' &&
      attribute.expandedName.localName === 'Name',
  );

/**
 * Every RDL element whose local name ends with `Image` (the `Image` report item
 * excluded) and that has a `Value` child, in source order. The `Image` report item is
 * handled by the image projection instead.
 */
export function findImageElementReferences(
  root: XmlNode | null,
): readonly ImageElementReference[] {
  const found: ImageElementReference[] = [];
  const visit = (node: XmlNode, owner: XmlNode | null) => {
    if (
      node.expandedName.namespaceUri === RDL_2016 &&
      node.expandedName.localName !== 'Image' &&
      node.expandedName.localName.endsWith('Image')
    ) {
      const value = child(node, 'Value');
      if (value) {
        const declared = child(node, 'Source')?.text.trim() ?? null;
        const text = value.text.trim();
        found.push({
          node,
          owner,
          source:
            declared === null
              ? null
              : declared.startsWith('=')
                ? 'expression'
                : declared === 'Embedded' ||
                    declared === 'External' ||
                    declared === 'Database'
                  ? declared
                  : null,
          value:
            value.children.length > 0
              ? { kind: 'structured' }
              : text.startsWith('=')
                ? { kind: 'expression' }
                : { kind: 'constant', text },
        });
      }
    }
    const next = hasName(node) ? node : owner;
    for (const entry of node.children) visit(entry, next);
  };
  if (root) visit(root, null);
  return found;
}

/** An unknown, expression or Embedded `Source`: the picture may be an embedded one. */
export const mayBeEmbedded = (
  source: ImageElementReference['source'],
): boolean =>
  source === null || source === 'Embedded' || source === 'expression';
