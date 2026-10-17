import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type {
  PatchPlan,
  SourcePatch,
  TextboxProperty,
} from '@rdlc/report-model/editing';
import type { Textbox } from '@rdlc/report-model/report';
import { RDL_2016 } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';

/**
 * RDL 2016/01 property placement for newly authored elements. The schema uses
 * `xsd:choice`, so order is free; this table only makes insertion deterministic
 * and preserves the source order of every existing element.
 */
const textboxOrder = [
  'Style',
  'ActionInfo',
  'Top',
  'Left',
  'Height',
  'Width',
  'ZIndex',
  'Visibility',
  'ToolTip',
  'DocumentMapLabel',
  'Bookmark',
  'RepeatWith',
  'CustomProperties',
  'Paragraphs',
  'CanGrow',
  'CanShrink',
  'HideDuplicates',
  'ToggleImage',
  'UserSort',
  'KeepTogether',
  'DataElementName',
  'DataElementOutput',
  'DataElementStyle',
];
const styleOrder = [
  'BackgroundColor',
  'BackgroundGradientEndColor',
  'BackgroundGradientType',
  'BackgroundHatchType',
  'Border',
  'BottomBorder',
  'Color',
  'Direction',
  'FontFamily',
  'FontSize',
  'FontStyle',
  'FontWeight',
  'Format',
  'Language',
  'LeftBorder',
  'LineHeight',
  'PaddingBottom',
  'PaddingLeft',
  'PaddingRight',
  'PaddingTop',
  'RightBorder',
  'ShadowOffset',
  'ShadowType',
  'TextAlign',
  'TextDecoration',
  'TopBorder',
  'UnicodeBiDi',
  'VerticalAlign',
  'WritingMode',
];
const styleNames: Readonly<Record<string, string>> = {
  fontFamily: 'FontFamily',
  fontSize: 'FontSize',
  fontWeight: 'FontWeight',
  fontStyle: 'FontStyle',
  color: 'Color',
  textAlign: 'TextAlign',
};

export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function rdlPrefix(node: XmlNode): string {
  for (const [prefix, uri] of Object.entries(node.namespaces))
    if (uri === RDL_2016) return prefix;
  return '';
}
function rdlChild(node: XmlNode, name: string): XmlNode | null {
  return (
    node.children.find(
      (child) =>
        child.expandedName.namespaceUri === RDL_2016 &&
        child.expandedName.localName === name,
    ) ?? null
  );
}
function insertionOffset(
  parent: XmlNode,
  order: readonly string[],
  name: string,
): number {
  const index = order.indexOf(name);
  for (const child of parent.children) {
    if (child.expandedName.namespaceUri !== RDL_2016) continue;
    const position = order.indexOf(child.expandedName.localName);
    if (position >= 0 && position > index) return child.openRange.start;
  }
  if (parent.closeRange) return parent.closeRange.start;
  throw new Error('Cannot author into a self-closing element');
}

/** Plan the smallest source patch for one authored textbox property; never regenerate. */
export function planTextboxProperty(input: {
  readonly snapshot: DocumentSnapshot;
  readonly textbox: Textbox;
  readonly property: TextboxProperty;
  readonly value: string;
}): PatchPlan {
  const { snapshot, textbox, property, value } = input;
  const version = snapshot.version;
  const patches: SourcePatch[] = [];
  const namespaceDependencies: {
    nodeId: string;
    prefix: string;
    uri: string;
  }[] = [];
  const prefix = rdlPrefix(textbox.node);
  const qualified = (name: string) => (prefix ? `${prefix}:${name}` : name);
  const expected = (start: number, end: number) =>
    snapshot.source.slice(start, end);
  const replace = (start: number, end: number, replacement: string) =>
    patches.push({
      version,
      start,
      end,
      expected: expected(start, end),
      replacement,
    });
  const insert = (
    parent: XmlNode,
    order: readonly string[],
    name: string,
    inner: string,
  ) => {
    const offset = insertionOffset(parent, order, name);
    replace(
      offset,
      offset,
      `<${qualified(name)}>${inner}</${qualified(name)}>`,
    );
    if (
      !namespaceDependencies.some(
        (dependency) =>
          dependency.nodeId === parent.id && dependency.prefix === prefix,
      )
    )
      namespaceDependencies.push({
        nodeId: parent.id,
        prefix,
        uri: RDL_2016,
      });
  };
  const setElement = (element: XmlNode, name: string, inner: string) => {
    if (element.closeRange && element.children.length === 0)
      replace(element.openRange.end, element.closeRange.start, inner);
    else if (!element.closeRange)
      replace(
        element.openRange.start,
        element.openRange.end,
        `<${qualified(name)}>${inner}</${qualified(name)}>`,
      );
    else throw new Error('Cannot patch a structured value');
  };

  if (property === 'name') {
    if (!textbox.nameRange) throw new Error('Textbox has no Name attribute');
    replace(
      textbox.nameRange.start,
      textbox.nameRange.end,
      escapeAttribute(value),
    );
  } else if (property === 'text') {
    if (!textbox.value) throw new Error('Textbox value is preservation-only');
    replace(
      textbox.value.range.start,
      textbox.value.range.end,
      escapeText(value),
    );
  } else if (styleNames[property]) {
    const inner = escapeText(value);
    const name = styleNames[property]!;
    if (textbox.styleNode) {
      const element = rdlChild(textbox.styleNode, name);
      if (element) setElement(element, name, inner);
      else insert(textbox.styleNode, styleOrder, name, inner);
    } else {
      insert(
        textbox.node,
        textboxOrder,
        'Style',
        `<${qualified(name)}>${inner}</${qualified(name)}>`,
      );
    }
  } else {
    const name = property[0]!.toUpperCase() + property.slice(1);
    const element = rdlChild(textbox.node, name);
    if (element) setElement(element, name, escapeText(value));
    else insert(textbox.node, textboxOrder, name, escapeText(value));
  }

  return {
    version,
    patches,
    footprint: patches.map((patch) => ({
      start: patch.start,
      end: patch.end,
    })),
    namespaceDependencies,
  };
}
