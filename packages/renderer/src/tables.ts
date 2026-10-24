import type { Table } from '@rdlc/report-model/report';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import { toPixels } from './geometry.js';
import {
  resolveGeometry,
  toPoints,
  type ResolvedGeometry,
} from '@rdlc/report-model/geometry';

export function tableGeometry(table: Table): ResolvedGeometry {
  const geometry = resolveGeometry(table.bounds, { width: null, height: null });
  const dimension = (key: 'width' | 'height', values: readonly string[]) => {
    if (table.bounds[key] !== null) return geometry[key];
    const points = values.reduce((sum, raw) => {
      const value = toPoints(raw);
      return value !== null && value > 0 ? sum + value : NaN;
    }, 0);
    return {
      raw: null,
      unit: null,
      provenance:
        Number.isFinite(points) && points > 0
          ? ('derived' as const)
          : ('unknown' as const),
      points: Number.isFinite(points) && points > 0 ? points : null,
    };
  };
  return {
    ...geometry,
    width: dimension(
      'width',
      table.columns.map((column) => column.width),
    ),
    height: dimension(
      'height',
      table.rows.map((row) => row.height),
    ),
  };
}

/** Deterministic design grid, not records, pagination or evaluated expressions. */
export function renderTable(
  table: Table,
  editable = true,
): readonly DesignSceneItem[] {
  const result: DesignSceneItem[] = [];
  let top = table.bounds.top === null ? 0 : toPixels(table.bounds.top);
  for (const row of table.rows) {
    let left = table.bounds.left === null ? 0 : toPixels(table.bounds.left);
    const height = toPixels(row.height);
    for (const [index, cell] of row.cells.entries()) {
      const width = toPixels(table.columns[index]?.width ?? null);
      const textbox = cell.textbox;
      const total = table.totals.find((total) => total.cell === cell);
      result.push({
        id: textbox?.node.id ?? cell.node.id,
        kind: 'cell',
        parentTableId: table.node.id,
        xmlCellId: cell.node.id,
        bounds:
          left !== null &&
          top !== null &&
          width !== null &&
          width > 0 &&
          height !== null &&
          height > 0
            ? { left, top, width, height }
            : null,
        label: `${total?.kind === 'dataset' ? 'Dataset-wide total' : total ? 'Group subtotal' : table.name}: ${textbox?.value?.text ?? 'Preserved cell'}`,
        placeholder: !textbox?.value,
        name: textbox?.name ?? null,
        text: textbox?.value?.text ?? null,
        geometry: null,
        style: textbox?.style ?? null,
        capabilities: editable
          ? (textbox?.capabilities.filter(
              (capability) =>
                !['left', 'top', 'width', 'height'].includes(capability),
            ) ?? [])
          : [],
      });
      left = left !== null && width !== null ? left + width : null;
    }
    top = top !== null && height !== null ? top + height : null;
  }
  return result;
}
