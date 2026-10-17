import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { validateTableAction } from './tables.js';

test('table authoring rejects dangling fields/scopes, bad dimensions, columns and group renames with totals', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const syntax = parse({
    uri: 'test:validation',
    source,
    version: 1,
    eol: '\n',
  });
  const report = projectReport(syntax);
  const table = report.tables[0]!;
  for (const payload of [
    { action: 'addColumn', field: 'Missing', width: '1in' },
    { action: 'addColumn', field: 'Amount', width: '0in' },
    { action: 'removeColumn', column: 'NaN' },
    { action: 'addTotal', field: 'Amount', column: '0', scope: 'Missing' },
    { action: 'addTotal', field: 'Label', column: '0', scope: 'Orders' },
  ] as const)
    assert.ok(
      validateTableAction(syntax.root!, report, table, table.node.id, payload)
        .length > 0,
    );
  assert.equal(
    validateTableAction(syntax.root!, report, table, table.node.id, {
      action: 'addColumn',
      field: 'Amount',
      width: '1in',
    }).length,
    0,
  );
  assert.ok(
    validateTableAction(syntax.root!, report, table, table.groups[0]!.node.id, {
      action: 'changeGroup',
      name: 'Renamed',
      expression: '=Fields!Label.Value',
    }).length > 0,
  );
});
