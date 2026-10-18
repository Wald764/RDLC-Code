import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { alignModes, type LayoutIntent } from '@rdlc/report-model/editing';
import { validateLayout } from './layout.js';

const source = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
const report = projectReport(
  parse({ uri: 'test:bulk', version: 1, source, eol: '\n' }),
);
const body = report.textboxes.filter((t) => t.context === 'body').slice(0, 3);
const ids = body.map((t) => t.node.id);
const common = { targetIds: ids, unit: 'pt' as const };

test('group movement uses the complete ordered set and identical displacement', () => {
  const changes = validateLayout(report, {
    ...common,
    action: 'move',
    dxPt: 3,
    dyPt: 5,
  });
  assert.equal(changes.length, 3);
  changes.forEach((c, i) => {
    assert.equal(c.item.node.id, ids[i]);
    assert.equal(c.values.left, c.original.left.points! + 3);
    assert.equal(c.values.top, c.original.top.points! + 5);
    assert.equal(c.values.width, undefined);
  });
});

for (const mode of alignModes)
  test(`primary-relative ${mode} alignment and exact no-op`, () => {
    const changes = validateLayout(report, {
      ...common,
      action: 'align',
      mode,
      primaryId: ids[1]!,
    });
    assert.equal(changes.length, 3);
    assert.ok(changes.every((c) => Object.keys(c.values).length === 0));
  });

for (const mode of alignModes)
  test(`${mode} uses actual unequal sizes rather than a common top-left`, () => {
    const textboxes = body.map((item, i) => ({
      ...item,
      bounds: {
        left: `${100 + i * 100}pt`,
        top: `${100 + i * 100}pt`,
        width: `${10 + i * 10}pt`,
        height: `${20 + i * 10}pt`,
      },
    }));
    const varied = { ...report, textboxes };
    const changes = validateLayout(varied, {
      ...common,
      action: 'align',
      mode,
      primaryId: ids[1]!,
    });
    const horizontal = ['left', 'center', 'right'].includes(mode);
    const position = horizontal ? 'left' : 'top',
      size = horizontal ? 'width' : 'height';
    const factor = ['center', 'middle'].includes(mode)
      ? 0.5
      : ['right', 'bottom'].includes(mode)
        ? 1
        : 0;
    const primaryLine = 200 + factor * (horizontal ? 20 : 30);
    changes.forEach((c) =>
      assert.equal(
        (c.values[position] ?? c.original[position].points!) +
          factor * c.original[size].points!,
        primaryLine,
      ),
    );
    assert.deepEqual(changes[1]!.values, {});
  });

for (const axis of ['horizontal', 'vertical'] as const)
  test(`${axis} distribution breaks position ties by source order, not selection order`, () => {
    const textboxes = body.map((item, i) => ({
      ...item,
      bounds: {
        left: `${i === 2 ? 100 : 0}pt`,
        top: `${i === 2 ? 100 : 0}pt`,
        width: '1pt',
        height: '1pt',
      },
    }));
    const changes = validateLayout(
      { ...report, textboxes },
      { ...common, targetIds: [...ids].reverse(), action: 'distribute', axis },
    );
    const position = axis === 'horizontal' ? 'left' : 'top';
    assert.deepEqual(changes[0]!.values, {});
    assert.equal(changes[1]!.values[position], 50);
    assert.deepEqual(changes[2]!.values, {});
  });

test('bulk validation refuses duplicate/nonbody/locked/unknown targets, invalid primary and too few/negative-gap distributions', () => {
  const cell = report.textboxes.find((t) => t.context !== 'body')!;
  const unknown = report.textboxes.find((t) => t.name === 'UnknownWidth')!;
  const locked = report.section!.node;
  const invalid: LayoutIntent['payload'][] = [
    {
      ...common,
      action: 'move',
      dxPt: 1,
      dyPt: 0,
      targetIds: [ids[0]!, ids[0]!],
    },
    ...[cell.node.id, unknown.node.id, locked.id].map((id) => ({
      ...common,
      action: 'move' as const,
      dxPt: 1,
      dyPt: 0,
      targetIds: [ids[0]!, id],
    })),
    { ...common, action: 'align', mode: 'left', primaryId: 'missing' },
    {
      ...common,
      action: 'distribute',
      axis: 'horizontal',
      targetIds: ids.slice(0, 2),
    },
    { ...common, action: 'distribute', axis: 'vertical' },
    { ...common, action: 'move', dxPt: -1000, dyPt: 0 },
  ];
  invalid.forEach((payload) =>
    assert.throws(() => validateLayout(report, payload)),
  );
});

test('arithmetic round-off in already aligned decimal positions remains an exact no-op', () => {
  const textboxes = body.map((item) => ({
    ...item,
    bounds: { left: '0.1pt', top: '0.1pt', width: '0.2pt', height: '0.2pt' },
  }));
  for (const mode of alignModes) {
    const changes = validateLayout(
      { ...report, textboxes },
      { ...common, action: 'align', mode, primaryId: ids[1]! },
    );
    assert.ok(changes.every((c) => Object.keys(c.values).length === 0));
  }
});
