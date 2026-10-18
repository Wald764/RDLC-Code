import type { AuthoringIntent } from '@rdlc/report-model/editing';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { ReportProjection, Table } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { analyze } from '@rdlc/expressions/analyze';
import {
  authoringError,
  validateDataMutation,
  validateDatasetName,
} from './datasets.js';
import { length } from './validate.js';
import { reportItemNames } from './textboxes.js';

/** Creation position: explicit-unit RdlSize values, finite and nonnegative. */
export function validatePosition(
  root: XmlNode,
  left: string,
  top: string,
): readonly Diagnostic[] {
  return [left, top].every((value) => (length(value)?.pixels ?? -1) >= 0)
    ? []
    : [
        authoringError(
          root,
          'Drop position must be a nonnegative size with an explicit unit.',
        ),
      ];
}

export function validateTableAction(
  root: XmlNode,
  report: ReportProjection,
  table: Table | null,
  targetId: string,
  payload: AuthoringIntent['payload'],
  /** Raw source for removals: opaque content then blocks only where it spells the name. */
  source?: string,
): readonly Diagnostic[] {
  const fail = (message: string) => [
    authoringError(table?.node ?? root, message),
  ];
  if (payload.action === 'createTable') {
    if (targetId !== root.id)
      return fail('Select the report to create a table.');
    return validatePosition(root, payload.left, payload.top);
  }
  if (!table?.structural)
    return fail(table?.blockedReason ?? 'Select a supported table.');
  if (payload.action === 'renameTable') {
    const names = validateDatasetName(
      root,
      payload.name,
      reportItemNames(root).filter((name) => name !== table.name),
    );
    return names.length
      ? names
      : validateDataMutation(root, table.node, 'report-item', table.name);
  }
  if (payload.action === 'setTableDataset')
    return report.datasets.some((dataset) => dataset.name === payload.dataset)
      ? []
      : fail('Select an existing local dataset.');
  const found = report.datasets.find(
    (dataset) => dataset.name === table.dataset,
  );
  // Layout and deletion work on unbound tables; data actions need an explicit binding.
  if (
    !found &&
    ![
      'setTableProperty',
      'setColumnWidth',
      'setRowHeight',
      'deleteTable',
      'removeColumn',
    ].includes(payload.action)
  )
    return fail('Bind the table to a dataset first.');
  const dataset = found!;
  if (payload.action === 'setTableProperty') {
    if (!['left', 'top', 'width', 'height'].includes(payload.property))
      return fail('Choose a table position or dimension.');
    const pixels = length(payload.value)?.pixels;
    if (
      pixels === undefined ||
      (payload.property === 'left' || payload.property === 'top'
        ? pixels < 0
        : pixels <= 0)
    )
      return fail('Use nonnegative positions and positive table dimensions.');
    if (payload.property === 'width' || payload.property === 'height')
      return fail(
        'Resize tables through explicit column widths and row dimensions to preserve grid consistency.',
      );
  }
  if (
    payload.action === 'deleteTable' &&
    payload.confirm !== 'delete-contained-content'
  )
    return fail('Confirm deletion of this table and all contained XML.');
  if (
    'field' in payload &&
    !dataset.fields.some((field) => field.name === payload.field && field.type)
  )
    return fail('Select an existing field with a supported type.');
  if ('width' in payload && !((length(payload.width)?.pixels ?? 0) > 0))
    return fail('Column width must be a positive RdlSize.');
  if ('height' in payload && !((length(payload.height)?.pixels ?? 0) > 0))
    return fail('Row height must be a positive RdlSize.');
  if (
    'column' in payload &&
    (!/^\d+$/.test(payload.column) ||
      Number(payload.column) >= (table?.columns.length ?? 0))
  )
    return fail('Select a current column.');
  if (payload.action === 'removeColumn' && table!.columns.length <= 1)
    return fail('A table requires at least one column.');
  if (payload.action === 'addGroup' || payload.action === 'changeGroup') {
    const group = table!.groups.find((group) => group.node.id === targetId);
    if (payload.action === 'changeGroup' && !group)
      return fail('Select a current row group.');
    if (
      payload.action === 'addGroup' &&
      table!.groups.filter((group) => group.expressions.length === 0).length !==
        1
    )
      return fail('Adding a row group requires one unambiguous detail member.');
    const names = validateDatasetName(
      root,
      payload.name,
      reportItemNames(root).filter((name) => name !== group?.name),
    );
    if (names.length) return names;
    if (!payload.expression.startsWith('='))
      return fail('Use an unevaluated grouping expression beginning with =.');
    const analysis = analyze(payload.expression);
    if (
      analysis.classification !== 'expression' ||
      !analysis.complete ||
      analysis.references.some(
        (reference) =>
          reference.kind !== 'field' ||
          !dataset.fields.some((field) => field.name === reference.name),
      )
    )
      return fail(
        'Use a supported unevaluated expression referencing fields in this dataset.',
      );
    if (group && group.name !== payload.name)
      return validateDataMutation(root, group.node, 'group', group.name);
  }
  if (payload.action === 'removeGroup') {
    const group = table!.groups.find((group) => group.node.id === targetId);
    if (!group || group.expressions.length === 0)
      return fail('Select a non-detail row group.');
    return validateDataMutation(root, group.node, 'group', group.name, source);
  }
  if ('scope' in payload) {
    if (
      payload.scope !== dataset.name &&
      !table!.groups.some(
        (group) => group.name === payload.scope && group.expressions.length,
      )
    )
      return fail('Select explicit dataset-wide or row-group scope.');
    const field = dataset.fields.find((field) => field.name === payload.field);
    if (
      !field ||
      !['Int32', 'Int64', 'decimal', 'double'].includes(field.type ?? '')
    )
      return fail('Sum requires a declared numeric field.');
  }
  if ('row' in payload) {
    const row = /^\d+$/.test(payload.row)
      ? table!.rows[Number(payload.row)]
      : null;
    if (
      !row ||
      (payload.action !== 'setRowHeight' &&
        !row.cells.some((cell) =>
          table!.totals.some((total) => total.cell === cell),
        ))
    )
      return fail('Select a static total row.');
  }
  return [];
}
