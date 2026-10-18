import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { Textbox, Table } from '@rdlc/report-model/report';
import type { Bounds } from '@rdlc/report-model/scene';
import {
  formatSize,
  type ResolvedGeometry,
  type SizeUnit,
} from '@rdlc/report-model/geometry';
import { composePlans, patchPlan, setScalar } from './structure.js';
import { planTextboxProperty } from './textboxes.js';
import { planTableGeometry } from './tables.js';

export interface GeometryChange {
  readonly item: Textbox | Table;
  readonly table: boolean;
  readonly original: ResolvedGeometry;
  readonly values: Partial<Bounds>;
}

export function planLayout(
  snapshot: DocumentSnapshot,
  changes: readonly GeometryChange[],
  unit: SizeUnit,
): PatchPlan {
  const plans: PatchPlan[] = [];
  for (const change of changes) {
    const { item, original } = change;
    const values = { ...change.values };
    if (!change.table) {
      if (values.left !== undefined && original.width.provenance === 'derived')
        values.width ??= original.width.points!;
      if (values.top !== undefined && original.height.provenance === 'derived')
        values.height ??= original.height.points!;
    }
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      const value = values[key];
      if (value === undefined) continue;
      if (change.table && (key === 'width' || key === 'height')) continue;
      const formatted = formatSize(
        value,
        item.bounds[key],
        unit,
        key === 'width' || key === 'height' ? 'dimension' : 'position',
      );
      plans.push(
        change.table
          ? patchPlan(snapshot, [
              setScalar(
                snapshot,
                item.node,
                key === 'left' ? 'Left' : 'Top',
                formatted,
              ),
            ])
          : planTextboxProperty({
              snapshot,
              textbox: item as Textbox,
              property: key,
              value: formatted,
            }),
      );
    }
    if (change.table)
      plans.push(planTableGeometry(snapshot, item as Table, values, unit));
  }
  return composePlans(snapshot, plans);
}
