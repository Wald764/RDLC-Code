import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';

test('table projection reconciles per-row cells, static columns and hierarchy leaves', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const report = projectReport(
    parse({ uri: 'fixture:table', source, version: 1, eol: '\n' }),
  );
  const table = report.tables[0]!;
  assert.equal(table.structural, true, table.blockedReason ?? '');
  assert.equal(table.columns.length, 2);
  assert.equal(table.rows.length, 3);
  assert.ok(table.rows.every((row) => row.cells.length === 2));
  assert.deepEqual(
    table.groups.map((group) => group.name),
    ['ByLabel', 'Details'],
  );
  assert.deepEqual(
    table.totals.map((total) => [total.kind, total.scope]),
    [
      ['group', 'ByLabel'],
      ['dataset', 'Orders'],
    ],
  );
  for (const variant of [
    source.replace('<CellContents>', '<CellContents><ColSpan>2</ColSpan>'),
    source.replace(
      '<TablixColumnHierarchy>',
      '<TablixColumnHierarchy><Group Name="Matrix"/>',
    ),
  ]) {
    const projected = projectReport(
      parse({ uri: 'fixture:opaque', source: variant, version: 1, eol: '\n' }),
    );
    assert.equal(projected.tables[0]!.structural, false);
  }
});
