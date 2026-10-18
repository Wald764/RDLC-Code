import type { LayoutIntent } from '@rdlc/report-model/editing';
import type {
  ReportProjection,
  Table,
  Textbox,
} from '@rdlc/report-model/report';
import type { Bounds } from '@rdlc/report-model/scene';
import {
  resolveGeometry,
  toPoints,
  type ResolvedGeometry,
} from '@rdlc/report-model/geometry';

export interface LayoutChange {
  readonly item: Textbox | Table;
  readonly table: boolean;
  readonly original: ResolvedGeometry;
  readonly values: Partial<Bounds>;
}

export function acceptedGeometry(
  report: ReportProjection,
  item: Textbox | Table,
  table: boolean,
): ResolvedGeometry {
  const geometry = resolveGeometry(item.bounds, {
    width: table ? null : toPoints(report.section?.width ?? null),
    height: table ? null : toPoints(report.section?.height ?? null),
  });
  if (!table) return geometry;
  const target = item as Table;
  const derive = (key: 'width' | 'height', values: readonly string[]) => {
    if (item.bounds[key] !== null) return geometry[key];
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
    width: derive(
      'width',
      target.columns.map((c) => c.width),
    ),
    height: derive(
      'height',
      target.rows.map((r) => r.height),
    ),
  };
}

/** Derive only affected axes; unknown independent geometry need not block a safe edit. */
export function validateLayout(
  report: ReportProjection,
  payload: LayoutIntent['payload'],
): LayoutChange[] {
  if (report.status !== 'editable')
    throw new Error('Fix source diagnostics before editing visually.');
  if (
    payload.targetIds.length !== 1 ||
    !['move', 'resize'].includes(payload.action)
  )
    throw new Error('Select one body item for direct manipulation.');
  const id = payload.targetIds[0];
  const table = report.tables.find((t) => t.node.id === id);
  const item =
    table ??
    report.textboxes.find((t) => t.node.id === id && t.context === 'body');
  if (!item || (table && !table.structural))
    throw new Error(
      `${id}: select a supported body textbox or table; inspect the construct in source.`,
    );
  const original = acceptedGeometry(report, item, !!table);
  const values: { -readonly [K in keyof Bounds]?: number } = {};
  const known = (key: keyof Bounds) => {
    const value = original[key].points;
    if (value === null)
      throw new Error(
        `${id}: ${key} is unknown; replace expression/invalid geometry in source.`,
      );
    return value;
  };
  const set = (key: keyof Bounds, value: number) => {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      ((key === 'width' || key === 'height') && value === 0)
    )
      throw new Error(
        `${id}: positions must be nonnegative and dimensions positive; correct the proposed geometry.`,
      );
    if (value === known(key)) return;
    if (!table && !(item as Textbox).capabilities.includes(key))
      throw new Error(
        `${id}: ${key} is locked; inspect this property in source.`,
      );
    values[key] = value;
  };
  if (payload.action === 'move') {
    if (!Number.isFinite(payload.dxPt) || !Number.isFinite(payload.dyPt))
      throw new Error('Movement must be finite.');
    if (payload.dxPt !== 0) {
      known('width');
      set('left', known('left') + payload.dxPt);
    }
    if (payload.dyPt !== 0) {
      known('height');
      set('top', known('top') + payload.dyPt);
    }
  } else if (payload.action === 'resize') {
    const axis = (
      position: 'left' | 'top',
      size: 'width' | 'height',
      leading: boolean,
      coordinate: number | undefined,
    ) => {
      if (coordinate === undefined || !Number.isFinite(coordinate))
        throw new Error('A dragged edge coordinate is required.');
      const start = known(position),
        length = known(size);
      if (leading) {
        set(position, coordinate);
        set(size, start + length - coordinate);
      } else set(size, coordinate - start);
    };
    if (/[ew]/.test(payload.handle))
      axis('left', 'width', payload.handle.includes('w'), payload.xPt);
    if (/[ns]/.test(payload.handle))
      axis('top', 'height', payload.handle.includes('n'), payload.yPt);
  }
  if (table) {
    for (const [key, components] of [
      ['width', table.columns.map((c) => c.width)],
      ['height', table.rows.map((r) => r.height)],
    ] as const) {
      if (values[key] === undefined) continue;
      const sum = components.reduce((s, raw) => s + (toPoints(raw) ?? NaN), 0);
      if (
        !components.length ||
        components.some((raw) => !(toPoints(raw)! > 0)) ||
        Math.abs(sum - known(key)) > 0.01
      )
        throw new Error(
          `${id}: inconsistent table ${key}; correct row/column and outer dimensions in source.`,
        );
    }
  }
  return [{ item, table: !!table, original, values }];
}
