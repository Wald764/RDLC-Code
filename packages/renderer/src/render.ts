import type { ReportProjection, Textbox } from '@rdlc/report-model/report';
import { RDL_2016 } from '@rdlc/report-model/report';
import type {
  DesignScene,
  DesignSceneItem,
  SceneTextStyle,
} from '@rdlc/report-model/scene';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { toPixels, geometryBounds, geometryOperations } from './geometry.js';
import { resolveGeometry, toPoints } from '@rdlc/report-model/geometry';
import { renderTable, tableGeometry } from './tables.js';

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

function rawBounds(node: XmlNode) {
  return {
    left: rdlChild(node, 'Left')?.text ?? null,
    top: rdlChild(node, 'Top')?.text ?? null,
    width: rdlChild(node, 'Width')?.text ?? null,
    height: rdlChild(node, 'Height')?.text ?? null,
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

  const items: DesignSceneItem[] = [];
  const reportItems = rdlChild(
    rdlChild(section.node, 'Body') ?? section.node,
    'ReportItems',
  );
  for (const [sourceOrder, child] of (reportItems?.children ?? []).entries()) {
    const priority = rdlChild(child, 'ZIndex')?.text.trim();
    const zIndex =
      priority &&
      /^\d+$/.test(priority) &&
      Number.isSafeInteger(Number(priority))
        ? Number(priority)
        : 0;
    const metadata = { sourceOrder, zIndex };
    const textbox = projection.textboxes.find(
      (textbox) => textbox.node.id === child.id && textbox.context === 'body',
    );
    if (textbox) {
      const editable =
        projection.status === 'editable' &&
        textbox.capabilities.includes('text');
      const geometry = resolveGeometry(textbox.bounds, {
        width: toPoints(section.width),
        height: toPoints(section.height),
      });
      const capabilities =
        projection.status === 'editable' ? textbox.capabilities : [];
      items.push({
        ...metadata,
        kind: 'textbox',
        id: textbox.node.id,
        bounds: geometryBounds(geometry),
        resolvedGeometry: geometry,
        operations: geometryOperations(
          geometry,
          capabilities,
          projection.status !== 'editable'
            ? 'Report is source-only; inspect source diagnostics.'
            : null,
        ),
        label: `${textbox.name ?? 'Textbox'}: ${preview(textbox)}`,
        placeholder: !editable,
        name: textbox.name,
        text: textbox.value ? textbox.value.text : null,
        geometry: textbox.bounds,
        style: textboxStyle(textbox),
        capabilities,
      });
      continue;
    }
    const table = projection.tables.find((table) => table.node.id === child.id);
    if (table?.structural) {
      const resolved = tableGeometry(table);
      const reason =
        projection.status === 'editable'
          ? null
          : 'Report is source-only; inspect source diagnostics.';
      const operations = geometryOperations(
        resolved,
        ['left', 'top', 'width', 'height'],
        reason,
      );
      const inconsistent = {
        eligible: false,
        reason:
          'Table outer size disagrees with its rows/columns; correct the dimensions in source before resizing.',
      };
      const width = table.columns.reduce(
        (sum, column) => sum + (toPoints(column.width) ?? NaN),
        0,
      );
      const height = table.rows.reduce(
        (sum, row) => sum + (toPoints(row.height) ?? NaN),
        0,
      );
      items.push({
        ...metadata,
        kind: 'table',
        id: table.node.id,
        bounds: geometryBounds(resolved),
        resolvedGeometry: resolved,
        geometry: table.bounds,
        label: table.name,
        name: table.name,
        placeholder: false,
        capabilities: [],
        operations: {
          ...operations,
          resizeX:
            resolved.width.points !== null &&
            Math.abs(resolved.width.points - width) > 0.01
              ? inconsistent
              : operations.resizeX,
          resizeY:
            resolved.height.points !== null &&
            Math.abs(resolved.height.points - height) > 0.01
              ? inconsistent
              : operations.resizeY,
        },
      });
      items.push(
        ...renderTable(table, projection.status === 'editable').map((cell) => ({
          ...cell,
          ...metadata,
        })),
      );
      continue;
    }
    const raw = rawBounds(child);
    const geometry = resolveGeometry(raw, { width: null, height: null });
    items.push({
      ...metadata,
      kind: 'preserved',
      id: child.id,
      bounds: geometryBounds(geometry),
      resolvedGeometry: geometry,
      operations: geometryOperations(
        geometry,
        [],
        'Unsupported construct; edit this item in source.',
      ),
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
