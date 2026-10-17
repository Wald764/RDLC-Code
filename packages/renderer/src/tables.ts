import type { Table } from '@rdlc/report-model/report';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import { toPixels } from './geometry.js';

/** Deterministic design grid, not records, pagination or evaluated expressions. */
export function renderTable(table: Table): readonly DesignSceneItem[] {
  const result: DesignSceneItem[] = [];
  let top = toPixels(table.bounds.top) ?? 0;
  for (const row of table.rows) {
    let left = toPixels(table.bounds.left) ?? 0;
    const height = toPixels(row.height) ?? 24;
    for (const [index, cell] of row.cells.entries()) {
      const width = toPixels(table.columns[index]?.width ?? null) ?? 96;
      const textbox = cell.textbox;
      const total = table.totals.find((total) => total.cell === cell);
      result.push({
        id: textbox?.node.id ?? cell.node.id,
        bounds: { left, top, width, height },
        label: `${total?.kind === 'dataset' ? 'Dataset-wide total' : total ? 'Group subtotal' : table.name}: ${textbox?.value?.text ?? 'Preserved cell'}`,
        placeholder: !textbox?.value,
        name: textbox?.name ?? null,
        text: textbox?.value?.text ?? null,
        geometry: null,
        style: textbox?.style ?? null,
        capabilities:
          textbox?.capabilities.filter(
            (capability) =>
              !['left', 'top', 'width', 'height'].includes(capability),
          ) ?? [],
      });
      left += width;
    }
    top += height;
  }
  return result;
}
