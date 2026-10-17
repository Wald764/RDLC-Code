import type { ReportProjection, Textbox } from '@rdlc/report-model/report';
import { RDL_2016 } from '@rdlc/report-model/report';
import type {
  Bounds,
  DesignScene,
  SceneTextStyle,
} from '@rdlc/report-model/scene';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { toPixels } from './geometry.js';
import { renderTable } from './tables.js';

const defaultPage = { width: 8.5 * 96, height: 11 * 96 };
const labelLength = 40;

function rdlChild(node: XmlNode, name: string): XmlNode | null {
  return (
    node.children.find(
      (child) =>
        child.expandedName.namespaceUri === RDL_2016 &&
        child.expandedName.localName === name,
    ) ?? null
  );
}

function boundsOf(node: XmlNode): Bounds {
  return {
    left: toPixels(rdlChild(node, 'Left')?.text ?? null) ?? 0,
    top: toPixels(rdlChild(node, 'Top')?.text ?? null) ?? 0,
    width: toPixels(rdlChild(node, 'Width')?.text ?? null) ?? 0,
    height: toPixels(rdlChild(node, 'Height')?.text ?? null) ?? 0,
  };
}

function textboxStyle(textbox: Textbox): SceneTextStyle {
  return {
    fontFamily: textbox.style.fontFamily,
    fontSize: textbox.style.fontSize,
    fontWeight: textbox.style.fontWeight,
    fontStyle: textbox.style.fontStyle,
    color: textbox.style.color,
    textAlign: textbox.style.textAlign,
  };
}

function preview(textbox: Textbox): string {
  if (!textbox.value) return 'Unsupported textbox content';
  const text = textbox.value.text.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return 'Empty text';
  return text.length > labelLength ? `${text.slice(0, labelLength)}…` : text;
}

/**
 * Pure authoring scene: geometry, labels and unevaluated authored strings only.
 * No HTML, scripts, resource URLs or evaluated report values.
 */
export function renderScene(projection: ReportProjection): DesignScene {
  const section = projection.section;
  const page = section?.page;
  const scene: DesignScene = {
    version: projection.version,
    page: {
      left: 0,
      top: 0,
      width: toPixels(page?.width ?? null) ?? defaultPage.width,
      height: toPixels(page?.height ?? null) ?? defaultPage.height,
    },
    body: {
      left: 0,
      top: 0,
      width: toPixels(section?.width ?? null) ?? 0,
      height: toPixels(section?.height ?? null) ?? 0,
    },
    items: [],
  };
  if (!section) return scene;

  const items = [];
  for (const textbox of projection.textboxes) {
    if (textbox.context === 'table-cell') continue;
    const editable =
      textbox.context === 'body' && textbox.capabilities.includes('text');
    items.push({
      id: textbox.node.id,
      bounds: boundsOf(textbox.node),
      label: `${textbox.name ?? 'Textbox'}: ${preview(textbox)}`,
      placeholder: !editable,
      name: textbox.name,
      text: textbox.value ? textbox.value.text : null,
      geometry: textbox.bounds,
      style: textboxStyle(textbox),
      capabilities: textbox.capabilities,
    });
  }

  const reportItems = rdlChild(
    rdlChild(section.node, 'Body') ?? section.node,
    'ReportItems',
  );
  for (const child of reportItems?.children ?? []) {
    const table = projection.tables.find((table) => table.node.id === child.id);
    if (table?.structural) {
      items.push(...renderTable(table));
      continue;
    }
    if (
      child.expandedName.namespaceUri === RDL_2016 &&
      child.expandedName.localName === 'Textbox'
    )
      continue;
    items.push({
      id: child.id,
      bounds: boundsOf(child),
      label: `${child.expandedName.localName} (unsupported)`,
      placeholder: true,
      name: null,
      text: null,
      geometry: null,
      style: null,
      capabilities: [],
    });
  }

  return { ...scene, items };
}
