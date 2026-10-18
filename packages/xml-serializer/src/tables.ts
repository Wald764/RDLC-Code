import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type {
  AuthoringIntent,
  PatchPlan,
  SourcePatch,
} from '@rdlc/report-model/editing';
import type { ReportSection, Table } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import {
  child,
  element,
  insertChild,
  patchPlan,
  renameNode,
  setScalar,
  sourcePatch,
} from './structure.js';
import { escapeAttribute, escapeText } from './textboxes.js';
import { textboxXml } from './authoring.js';
import {
  formatSize,
  toPoints,
  type SizeUnit,
} from '@rdlc/report-model/geometry';
import type { Bounds } from '@rdlc/report-model/scene';

/** Scale every design component once, retaining units and absent outer dimensions. */
export function planTableGeometry(
  snapshot: DocumentSnapshot,
  table: Table,
  values: Partial<Bounds>,
  unit: SizeUnit,
): PatchPlan {
  const patches: SourcePatch[] = [];
  for (const [key, name, components] of [
    [
      'width',
      'Width',
      table.columns.map((c) => ({ node: c.node, raw: c.width })),
    ],
    [
      'height',
      'Height',
      table.rows.map((r) => ({ node: r.node, raw: r.height })),
    ],
  ] as const) {
    const desired = values[key];
    if (desired === undefined) continue;
    const total = components.reduce((sum, c) => sum + toPoints(c.raw)!, 0);
    let used = 0;
    for (const [index, component] of components.entries()) {
      const value =
        index === components.length - 1
          ? desired - used
          : (toPoints(component.raw)! * desired) / total;
      const formatted = formatSize(value, component.raw, unit, 'dimension');
      used += toPoints(formatted)!;
      if (formatted !== component.raw)
        patches.push(setScalar(snapshot, component.node, name, formatted));
    }
    if (table.bounds[key] !== null)
      patches.push(
        setScalar(
          snapshot,
          table.node,
          name,
          formatSize(desired, table.bounds[key], unit, 'dimension'),
        ),
      );
  }
  return patchPlan(snapshot, patches);
}

export function planTable(
  snapshot: DocumentSnapshot,
  section: ReportSection,
  table: Table | null,
  targetId: string,
  payload: AuthoringIntent['payload'],
  names: readonly string[],
  binding: string,
  total: string,
): PatchPlan {
  const reportBody = child(section.node, 'Body');
  if (!reportBody) throw new Error('Missing Body.');
  const node = table?.node ?? child(reportBody, 'ReportItems') ?? reportBody;
  const e = (name: string, inner: string) => element(node, name, inner);
  const used = new Set(names);
  if (payload.action === 'createTable') used.add(payload.name);
  const name = (prefix: string) => {
    let value = prefix;
    let suffix = 0;
    while (used.has(value)) value = `${prefix}${++suffix}`;
    used.add(value);
    return value;
  };
  const cell = (value: string) =>
    e(
      'TablixCell',
      e(
        'CellContents',
        textboxXml(node, name('Cell'), escapeText(value), false),
      ),
    );
  const member = (inner = '') => e('TablixMember', inner);
  const row = (values: readonly string[]) =>
    e(
      'TablixRow',
      e('Height', '0.3in') + e('TablixCells', values.map(cell).join('')),
    );
  const raw = (node: XmlNode) =>
    snapshot.source.slice(node.range.start, node.range.end);
  if (payload.action === 'createTable') {
    const body = child(section.node, 'Body')!;
    const items = child(body, 'ReportItems');
    const columns = e(
      'TablixColumns',
      e('TablixColumn', e('Width', payload.width)),
    );
    const detail = e('Group', '').replace(
      '>',
      ` Name="${escapeAttribute(name(`${payload.name}Details`))}">`,
    );
    const inner =
      e('TablixBody', columns + e('TablixRows', row([binding]))) +
      e('TablixColumnHierarchy', e('TablixMembers', member())) +
      e('TablixRowHierarchy', e('TablixMembers', member(detail))) +
      e('DataSetName', escapeText(payload.dataset)) +
      e('Left', '0in') +
      e('Top', '0in') +
      e('Width', payload.width) +
      e('Height', '0.3in');
    const xml = e('Tablix', inner).replace(
      '>',
      ` Name="${escapeAttribute(payload.name)}">`,
    );
    return patchPlan(snapshot, [
      insertChild(
        snapshot,
        items ?? body,
        items ? xml : element(body, 'ReportItems', xml),
      ),
    ]);
  }
  if (!table) throw new Error('Missing table.');
  if (payload.action === 'deleteTable')
    return patchPlan(snapshot, [sourcePatch(snapshot, table.node.range, '')]);
  if (payload.action === 'setTableProperty')
    return patchPlan(snapshot, [
      setScalar(
        snapshot,
        table.node,
        payload.property[0]!.toUpperCase() + payload.property.slice(1),
        payload.value,
      ),
    ]);
  const body = child(node, 'TablixBody')!;
  const rows = child(body, 'TablixRows')!;
  const columns = child(body, 'TablixColumns')!;
  const columnMembers = child(
    child(node, 'TablixColumnHierarchy')!,
    'TablixMembers',
  )!;
  const rowMembers = child(
    child(node, 'TablixRowHierarchy')!,
    'TablixMembers',
  )!;
  const patches: SourcePatch[] = [];
  const pixels = (value: string) => {
    const unit = /(?:in|cm|mm|pt|pc)$/.exec(value)?.[0];
    const scales: Record<string, number> = {
      in: 96,
      cm: 96 / 2.54,
      mm: 96 / 25.4,
      pt: 96 / 72,
      pc: 16,
    };
    if (!unit) throw new Error('Unsupported dimension.');
    return parseFloat(value) * scales[unit]!;
  };
  const setWidth = (value: number) =>
    patches.push(setScalar(snapshot, node, 'Width', `${value / 96}in`));
  const setHeight = (value: number) =>
    patches.push(setScalar(snapshot, node, 'Height', `${value / 96}in`));
  if (payload.action === 'setColumnWidth') {
    const index = Number(payload.column);
    patches.push(
      setScalar(snapshot, table.columns[index]!.node, 'Width', payload.width),
    );
    setWidth(
      table.columns.reduce(
        (sum, column, at) =>
          sum + pixels(at === index ? payload.width : column.width),
        0,
      ),
    );
  } else if (payload.action === 'setRowHeight') {
    const index = Number(payload.row);
    patches.push(
      setScalar(snapshot, table.rows[index]!.node, 'Height', payload.height),
    );
    setHeight(
      table.rows.reduce(
        (sum, row, at) =>
          sum + pixels(at === index ? payload.height : row.height),
        0,
      ),
    );
  } else if (payload.action === 'addColumn') {
    patches.push(
      insertChild(
        snapshot,
        columns,
        e('TablixColumn', e('Width', payload.width)),
      ),
      insertChild(snapshot, columnMembers, member()),
    );
    for (const row of table.rows)
      patches.push(
        insertChild(snapshot, child(row.node, 'TablixCells')!, cell(binding)),
      );
    setWidth(
      table.columns.reduce((sum, column) => sum + pixels(column.width), 0) +
        pixels(payload.width),
    );
  } else if (payload.action === 'removeColumn') {
    const index = Number(payload.column);
    const column = table.columns[index]!;
    patches.push(
      sourcePatch(snapshot, column.node.range, ''),
      sourcePatch(snapshot, column.member.range, ''),
    );
    for (const row of table.rows)
      patches.push(sourcePatch(snapshot, row.cells[index]!.node.range, ''));
    setWidth(
      table.columns
        .filter((_, at) => at !== index)
        .reduce((sum, column) => sum + pixels(column.width), 0),
    );
  } else if (payload.action === 'addGroup') {
    const detail = table.groups.find((group) => group.expressions.length === 0);
    if (!detail) throw new Error('A supported detail member is required.');
    const group = e(
      'Group',
      e(
        'GroupExpressions',
        e('GroupExpression', escapeText(payload.expression)),
      ),
    ).replace('>', ` Name="${escapeAttribute(payload.name)}">`);
    patches.push(
      sourcePatch(
        snapshot,
        detail.member.range,
        member(group + e('TablixMembers', raw(detail.member))),
      ),
    );
  } else if (payload.action === 'changeGroup') {
    const group = table.groups.find((group) => group.node.id === targetId)!;
    patches.push(renameNode(snapshot, group.node, payload.name));
    const expressions = child(group.node, 'GroupExpressions');
    if (!expressions || group.expressions.length !== 1)
      throw new Error('Select a single-expression row group.');
    patches.push(
      setScalar(snapshot, expressions, 'GroupExpression', payload.expression),
    );
  } else if (payload.action === 'removeGroup') {
    const group = table.groups.find((group) => group.node.id === targetId)!;
    const members = child(group.member, 'TablixMembers');
    if (!members?.closeRange)
      throw new Error('Cannot unwrap this row group safely.');
    if ([group.member, members].some((node) => node.attributes.length))
      throw new Error(
        'Group namespace declarations or attributes require source editing before unwrapping.',
      );
    if (
      !group.member.closeRange ||
      group.member.children.some(
        (node) => node !== group.node && node !== members,
      )
    )
      throw new Error(
        'Additional group-member properties are preservation-only.',
      );
    let unwrapped = snapshot.source.slice(
      group.member.openRange.end,
      group.member.closeRange.start,
    );
    for (const range of [
      group.node.range,
      members.openRange,
      members.closeRange,
    ].sort((a, b) => b.start - a.start)) {
      unwrapped =
        unwrapped.slice(0, range.start - group.member.openRange.end) +
        unwrapped.slice(range.end - group.member.openRange.end);
    }
    patches.push(sourcePatch(snapshot, group.member.range, unwrapped));
  } else if (payload.action === 'addTotal') {
    const group = table.groups.find((group) => group.name === payload.scope);
    const members = group ? child(group.member, 'TablixMembers') : rowMembers;
    if (!members) throw new Error('Missing group member container.');
    const before = group
      ? table.rows
          .filter(
            (row) =>
              group.member.range.start <= row.member.range.start &&
              group.member.range.end >= row.member.range.end,
          )
          .at(-1)?.node.range.end
      : rows.closeRange?.start;
    if (before === undefined)
      throw new Error('Cannot determine footer placement.');
    const values = table.columns.map((_, index) =>
      index === Number(payload.column) ? total : '',
    );
    patches.push(
      sourcePatch(snapshot, { start: before, end: before }, row(values)),
      insertChild(snapshot, members, member(e('KeepWithGroup', 'Before'))),
    );
    setHeight(
      table.rows.reduce((sum, row) => sum + pixels(row.height), 0) + 0.3 * 96,
    );
  } else if (payload.action === 'changeTotal') {
    const selectedRow = table.rows[Number(payload.row)]!;
    const previous = table.totals.find((total) =>
      selectedRow.cells.includes(total.cell),
    );
    const updates: SourcePatch[] = [];
    for (const [index, cell] of selectedRow.cells.entries()) {
      const value = cell.textbox?.value;
      if (!value) throw new Error('Opaque total cell.');
      if (index !== Number(payload.column) && cell !== previous?.cell) continue;
      updates.push(
        sourcePatch(
          snapshot,
          value.range,
          escapeText(index === Number(payload.column) ? total : ''),
        ),
      );
    }
    if (previous?.scope === payload.scope) patches.push(...updates);
    else {
      const group = table.groups.find((group) => group.name === payload.scope);
      const members = group ? child(group.member, 'TablixMembers') : rowMembers;
      if (
        !members ||
        Object.entries(selectedRow.member.namespaces).some(
          ([prefix, uri]) => members.namespaces[prefix] !== uri,
        )
      )
        throw new Error(
          'Cannot move footer across different namespace scopes.',
        );
      const before = group
        ? table.rows
            .filter(
              (row) =>
                group.member.range.start <= row.member.range.start &&
                group.member.range.end >= row.member.range.end,
            )
            .at(-1)?.node.range.end
        : rows.closeRange?.start;
      if (before === undefined)
        throw new Error('Cannot determine new footer placement.');
      let moved = raw(selectedRow.node);
      for (const update of updates.sort((a, b) => b.start - a.start))
        moved =
          moved.slice(0, update.start - selectedRow.node.range.start) +
          update.replacement +
          moved.slice(update.end - selectedRow.node.range.start);
      patches.push(
        sourcePatch(snapshot, selectedRow.node.range, ''),
        sourcePatch(snapshot, selectedRow.member.range, ''),
        sourcePatch(snapshot, { start: before, end: before }, moved),
        insertChild(snapshot, members, raw(selectedRow.member)),
      );
    }
  } else if (payload.action === 'removeTotal') {
    const selectedRow = table.rows[Number(payload.row)]!;
    patches.push(
      sourcePatch(snapshot, selectedRow.node.range, ''),
      sourcePatch(snapshot, selectedRow.member.range, ''),
    );
    setHeight(
      table.rows
        .filter((row) => row !== selectedRow)
        .reduce((sum, row) => sum + pixels(row.height), 0),
    );
  } else throw new Error('Not a table action.');
  return patchPlan(snapshot, patches);
}
