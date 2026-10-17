import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import type { AuthoringIntent } from '@rdlc/report-model/editing';
import { planAuthoringIntent } from '../../apps/vscode-extension/src/edit-controller.js';

function author(
  source: string,
  target: (report: ReturnType<typeof projectReport>) => string,
  payload: AuthoringIntent['payload'],
) {
  const snapshot = {
    uri: 'test:author',
    version: 1,
    source,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const report = projectReport(syntax);
  return planAuthoringIntent(snapshot, syntax, report, {
    requestId: 'author-1',
    baseVersion: 1,
    targetId: target(report),
    operation: 'author',
    payload,
  });
}
const dataset = (report: ReturnType<typeof projectReport>) =>
  report.datasets[0]!.node.id;

test('dataset/field insertions preserve queries, calculated fields, metadata and namespace spelling', () => {
  const source = readFileSync('tests/fixtures/datasets/preserved.rdlc', 'utf8');
  const outcome = author(source, dataset, {
    action: 'createField',
    name: 'NewField',
    type: 'Int64',
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert.equal(outcome.plan.patches.length, 1);
  const patch = outcome.plan.patches[0]!;
  assert.equal(patch.start, patch.end);
  assert.equal(
    outcome.candidate.slice(0, patch.start),
    source.slice(0, patch.start),
  );
  assert.equal(
    outcome.candidate.slice(patch.start + patch.replacement.length),
    source.slice(patch.end),
  );
  const report = projectReport(
    parse({
      uri: 'test:new',
      source: outcome.candidate,
      version: 1,
      eol: '\n',
    }),
  );
  assert.equal(report.datasets[0]!.fields.at(-1)!.typeName, 'System.Int64');
  assert.equal(report.datasets[0]!.fields.at(-1)!.dataField, 'NewField');
});

test('referenced and opaque mutations are rejected atomically; unknown types are read-only', () => {
  const source = readFileSync('tests/fixtures/datasets/preserved.rdlc', 'utf8');
  const known = (r: ReturnType<typeof projectReport>) =>
    r.datasets[0]!.fields[0]!.node.id;
  const unknown = (r: ReturnType<typeof projectReport>) =>
    r.datasets[0]!.fields[2]!.node.id;
  for (const payload of [
    { action: 'renameField', name: 'Changed' },
    { action: 'deleteField' },
  ] as const)
    assert.equal(author(source, known, payload).ok, false);
  assert.equal(
    author(source, unknown, { action: 'setFieldType', type: 'text' }).ok,
    false,
  );
  assert.equal(
    author(
      source.replace('=Fields!Known.Value + 1', '=Code.Unknown()'),
      known,
      { action: 'renameField', name: 'Changed' },
    ).ok,
    false,
  );
});

test('blank report authoring covers page bounds, textbox deletion, all field types and group add/change/remove', () => {
  let source = readFileSync('tests/fixtures/datasets/blank.rdlc', 'utf8');
  const root = () =>
    parse({ uri: 'test:root', source, version: 1, eol: '\n' }).root!.id;
  const apply = (
    target: (report: ReturnType<typeof projectReport>) => string,
    payload: AuthoringIntent['payload'],
  ) => {
    const outcome = author(source, target, payload);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (outcome.ok) source = outcome.candidate;
  };
  apply(root, { action: 'createTextbox', name: 'Heading' });
  assert.equal(
    author(source, root, { action: 'createTextbox', name: 'Heading' }).ok,
    false,
  );
  const box = (report: ReturnType<typeof projectReport>) =>
    report.textboxes[0]!.node.id;
  assert.equal(
    author(source, box, { action: 'deleteTextbox', confirm: '' }).ok,
    false,
  );
  apply(box, { action: 'deleteTextbox', confirm: 'delete-contained-content' });
  apply(root, { action: 'setPage', property: 'bodyHeight', value: '4in' });
  assert.equal(
    author(source, root, { action: 'setPage', property: 'left', value: '9in' })
      .ok,
    false,
  );
  apply(root, { action: 'createDataset', name: 'Orders' });
  const dataset = (report: ReturnType<typeof projectReport>) =>
    report.datasets[0]!.node.id;
  for (const [index, type] of [
    'text',
    'Boolean',
    'Int32',
    'Int64',
    'decimal',
    'double',
    'date/time',
  ].entries())
    apply(dataset, { action: 'createField', name: `Field${index}`, type });
  apply(root, {
    action: 'createTable',
    name: 'Cell',
    dataset: 'Orders',
    field: 'Field0',
    width: '1in',
  });
  const table = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.node.id;
  apply(table, {
    action: 'addGroup',
    name: 'ByField',
    expression: '=Fields!Field0.Value',
  });
  const group = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.groups[0]!.node.id;
  apply(group, {
    action: 'changeGroup',
    name: 'ByField2',
    expression: '=Fields!Field2.Value',
  });
  source = source.replace(
    '</Group><TablixMembers>',
    '</Group><!--preserved-group-sibling--><TablixMembers>',
  );
  apply(table, {
    action: 'addGroup',
    name: 'Nested',
    expression: '=Fields!Field2.Value',
  });
  apply(
    (report) =>
      report.tables[0]!.groups.find((group) => group.name === 'Nested')!.node
        .id,
    { action: 'removeGroup' },
  );
  apply(group, { action: 'removeGroup' });
  assert.ok(source.includes('<!--preserved-group-sibling-->'));
  apply(table, { action: 'deleteTable', confirm: 'delete-contained-content' });
  apply(dataset, { action: 'deleteDataset' });
  assert.ok(!source.includes('<DataSets>'));
  assert.ok(!source.includes('<Tablix'));
});

test('field metadata allocates a local noncolliding designer prefix without changing existing bindings', () => {
  const source = readFileSync(
    'tests/fixtures/datasets/local.rdlc',
    'utf8',
  ).replace(
    'xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner"',
    'xmlns:rd="urn:existing-binding"',
  );
  const outcome = author(source, dataset, {
    action: 'createField',
    name: 'NewDouble',
    type: 'double',
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert.ok(outcome.candidate.includes('xmlns:rd="urn:existing-binding"'));
  assert.ok(
    outcome.candidate.includes(
      '<rd1:TypeName xmlns:rd1="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">System.Double</rd1:TypeName>',
    ),
  );
  const patch = outcome.plan.patches[0]!;
  assert.equal(
    outcome.candidate.slice(0, patch.start),
    source.slice(0, patch.start),
  );
  assert.equal(
    outcome.candidate.slice(patch.start + patch.replacement.length),
    source.slice(patch.end),
  );
});

test('unreferenced dataset/field rename and removal retain untouched source exactly', () => {
  const source = readFileSync('tests/fixtures/datasets/local.rdlc', 'utf8');
  const renamed = author(source, dataset, {
    action: 'renameDataset',
    name: 'Renamed',
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  const removed = author(source, (r) => r.datasets[0]!.fields[0]!.node.id, {
    action: 'deleteField',
  });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  if (removed.ok) assert.ok(!removed.candidate.includes('Name="Label"'));
});

test('table columns, groups and scoped total rows are synchronized atomically', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const table = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.node.id;
  for (const payload of [
    { action: 'setTableProperty', property: 'left', value: '0.5in' },
    { action: 'setColumnWidth', column: '0', width: '1.25in' },
    { action: 'setRowHeight', row: '0', height: '0.4in' },
    { action: 'addColumn', field: 'Amount', width: '0.5in' },
    { action: 'removeColumn', column: '0' },
    { action: 'addTotal', field: 'Amount', scope: 'Orders', column: '1' },
    { action: 'addTotal', field: 'Amount', scope: 'ByLabel', column: '1' },
    {
      action: 'changeTotal',
      field: 'Amount',
      scope: 'Orders',
      column: '0',
      row: '2',
    },
    {
      action: 'changeTotal',
      field: 'Amount',
      scope: 'ByLabel',
      column: '1',
      row: '2',
    },
    {
      action: 'changeTotal',
      field: 'Amount',
      scope: 'Orders',
      column: '1',
      row: '1',
    },
    { action: 'removeTotal', row: '2' },
  ] as const) {
    const outcome = author(source, table, payload);
    assert.equal(
      outcome.ok,
      true,
      `${payload.action}: ${JSON.stringify(outcome)}`,
    );
    if (outcome.ok) {
      const projected = projectReport(
        parse({
          uri: 'test:changed',
          source: outcome.candidate,
          version: 1,
          eol: '\n',
        }),
      );
      assert.equal(projected.tables[0]!.structural, true);
      assert.equal(projected.datasets[0]!.fields.length, 2);
    }
  }
  const group = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.groups[0]!.node.id;
  assert.equal(author(source, group, { action: 'removeGroup' }).ok, false);
  assert.equal(
    author(source, group, {
      action: 'changeGroup',
      name: 'Renamed',
      expression: '=Fields!Label.Value',
    }).ok,
    false,
  );
  assert.equal(
    author(
      source.replace('<CellContents>', '<CellContents><ColSpan>2</ColSpan>'),
      table,
      { action: 'addColumn', field: 'Amount', width: '1in' },
    ).ok,
    false,
  );
});
