import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderTable } from './tables.js';

test('table design grid uses declared row/column dimensions and explicit total labels', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const report = projectReport(
    parse({ uri: 'test:table', source, version: 1, eol: '\n' }),
  );
  const scene = renderTable(report.tables[0]!);
  assert.equal(scene.length, 6);
  assert.deepEqual(scene[1]!.bounds, {
    left: 96,
    top: 0,
    width: 96,
    height: 28.799999999999997,
  });
  assert.ok(scene[3]!.label.startsWith('Group subtotal:'));
  assert.ok(scene[5]!.label.startsWith('Dataset-wide total:'));
  assert.ok(scene[5]!.text!.startsWith('=Sum'));
});

test('table frame sizes derive independently of position and inconsistent explicit sizes cannot resize', async () => {
  const { renderScene } = await import('./render.js');
  const fixture = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const render = (source: string) =>
    renderScene(
      projectReport(
        parse({ uri: 'test:table-size', source, version: 1, eol: '\n' }),
      ),
    ).items.find((item) => item.kind === 'table')!;
  const positioned = fixture
    .replace('<Width>2in</Width><Height>0.9in</Height>', '')
    .replace('<Left>0in</Left>', '<Left>1in</Left>')
    .replace('<Top>0in</Top>', '<Top>1in</Top>');
  const frame = render(positioned);
  assert.equal(frame.bounds?.width, 192);
  assert.equal(frame.resolvedGeometry?.width.provenance, 'derived');
  const inconsistent = render(
    positioned.replace('</Tablix>', '<Width>10in</Width></Tablix>'),
  );
  assert.equal(inconsistent.bounds?.width, 960);
  assert.equal(inconsistent.operations?.resizeX.eligible, false);
});

test('whole table frames are distinct from parent-linked cell identities', async () => {
  const { renderScene } = await import('./render.js');
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const report = projectReport(
    parse({ uri: 'test:frame', source, version: 1, eol: '\n' }),
  );
  const items = renderScene(report).items;
  const frame = items.find((item) => item.kind === 'table')!;
  assert.equal(frame.id, report.tables[0]!.node.id);
  assert.equal(frame.bounds?.width, 192);
  const cells = items.filter((item) => item.kind === 'cell');
  assert.equal(cells.length, 6);
  assert.ok(
    cells.every(
      (cell) => cell.parentTableId === frame.id && cell.id !== frame.id,
    ),
  );
});
