import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';

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

test('whole tables and cells keep their existing, separate capabilities', () => {
  const source = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
  const report = projectReport(
    parse({ uri: 'fixture:mixed', source, version: 1, eol: '\n' }),
  );
  const scene = renderScene(report);
  const table = scene.items.find((i) => i.kind === 'table')!;
  assert.equal(report.tables[0]!.structural, true);
  assert.equal(table.operations!.moveX.eligible, true);
  assert.deepEqual(table.capabilities, []);
  const cells = scene.items.filter((i) => i.kind === 'cell');
  assert.ok(cells.length > 0);
  for (const cell of cells) {
    assert.equal(cell.parentTableId, table.id);
    assert.equal(cell.operations, undefined, 'cells have no handles');
    assert.ok(
      !cell.capabilities?.some((c) =>
        ['left', 'top', 'width', 'height'].includes(c),
      ),
    );
  }
  assert.ok(cells.some((c) => c.capabilities?.includes('text')));
  // Group and total authoring stay available on the structural table.
  assert.ok(report.tables[0]!.groups.length > 0);
  assert.ok(report.tables[0]!.totals.length > 0);
});
