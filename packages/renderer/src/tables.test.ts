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
