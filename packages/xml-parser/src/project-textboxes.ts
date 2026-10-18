import type { XmlNode } from '@rdlc/report-model/syntax';
import type {
  ReportSection,
  Textbox,
  TextboxBounds,
  TextboxStyle,
} from '@rdlc/report-model/report';
import { children, RDL_2016 } from './names.js';

const tablixContainers = new Set([
  'Tablix',
  'TablixCell',
  'TablixRow',
  'TablixRows',
  'Table',
  'Matrix',
]);
const geometryNames = ['left', 'top', 'width', 'height'] as const;

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

function text(node: XmlNode | null): string | null {
  return node ? node.text : null;
}

function next(node: XmlNode, name: string): XmlNode | null {
  return children(node, name)[0] ?? null;
}

function readStyle(style: XmlNode | null): TextboxStyle {
  return {
    fontFamily: text(style ? next(style, 'FontFamily') : null),
    fontSize: text(style ? next(style, 'FontSize') : null),
    fontWeight: text(style ? next(style, 'FontWeight') : null),
    fontStyle: text(style ? next(style, 'FontStyle') : null),
    color: text(style ? next(style, 'Color') : null),
    textAlign: text(style ? next(style, 'TextAlign') : null),
  };
}

function hasRunStyle(node: XmlNode): boolean {
  if (
    (node.expandedName.localName === 'TextRun' ||
      node.expandedName.localName === 'Paragraph') &&
    next(node, 'Style')
  )
    return true;
  return node.children.some(hasRunStyle);
}

export function projectTextboxes(
  section: ReportSection | null,
): readonly Textbox[] {
  if (!section) return [];
  const result: Textbox[] = [];
  const body = next(section.node, 'Body');
  const bodyItems = body ? next(body, 'ReportItems') : null;
  const visit = (node: XmlNode, inTablix: boolean, parent: XmlNode | null) => {
    if (
      node.expandedName.namespaceUri === RDL_2016 &&
      node.expandedName.localName === 'Textbox'
    )
      result.push(
        projectTextbox(
          node,
          inTablix ? 'table-cell' : parent === bodyItems ? 'body' : 'preserved',
        ),
      );
    const nested =
      inTablix ||
      (node.expandedName.namespaceUri === RDL_2016 &&
        tablixContainers.has(node.expandedName.localName));
    for (const child of node.children) visit(child, nested, node);
  };
  visit(section.node, false, null);
  return result;
}

function projectTextbox(node: XmlNode, context: Textbox['context']): Textbox {
  const capabilities: string[] = ['textbox'];
  const nameAttribute = attribute(node, 'Name');
  if (nameAttribute) capabilities.push('name');

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
  for (const key of geometryNames) {
    const element = next(node, capitalise(key));
    bounds[key] = text(element);
    boundsRanges[key] = element ? element.range : null;
    const insertable = node.closeRange !== null;
    if (insertable && (!element || size.test(element.text.trim())))
      capabilities.push(key);
  }

  const paragraphs = children(node, 'Paragraphs');
  const paragraphNodes =
    paragraphs.length === 1 ? children(paragraphs[0]!, 'Paragraph') : [];
  const paragraph = paragraphNodes.length === 1 ? paragraphNodes[0]! : null;
  const textRunContainers = paragraph ? children(paragraph, 'TextRuns') : [];
  const textRuns =
    textRunContainers.length === 1 ? textRunContainers[0]! : null;
  const run = textRuns ? children(textRuns, 'TextRun') : [];
  const valueNodes =
    run.length === 1 && run[0] ? children(run[0], 'Value') : [];
  const valueNode = valueNodes.length === 1 ? valueNodes[0]! : null;
  const value =
    valueNode?.closeRange && valueNode.children.length === 0
      ? {
          node: valueNode,
          range: {
            start: valueNode.openRange.end,
            end: valueNode.closeRange.start,
          },
          text: valueNode.text,
        }
      : null;
  if (value) capabilities.push('text');

  const styleNode = next(node, 'Style');
  if (!hasRunStyle(node)) capabilities.push('style');

  return {
    node,
    context,
    name: nameAttribute ? nameAttribute.value : null,
    nameRange: nameAttribute ? nameAttribute.valueRange : null,
    bounds,
    boundsRanges,
    value,
    style: readStyle(styleNode),
    styleNode,
    capabilities: context === 'preserved' ? [] : capabilities,
  };
}

function capitalise(name: string): string {
  return name[0]!.toUpperCase() + name.slice(1);
}
