import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSize, pixelsToPoints } from '@rdlc/report-model/geometry';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { planTextboxIntent } from '../../apps/vscode-extension/src/edit-controller.js';

const mixed = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
const zooms = [0.25, 0.5, 1, 2, 4];

function project(source: string) {
  const snapshot = {
    uri: 'test:precision',
    version: 1,
    source,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  return { snapshot, syntax, report: projectReport(syntax) };
}
function position(source: string, name: string) {
  const textbox = project(source).report.textboxes.find(
    (t) => t.name === name,
  )!;
  return {
    left: parseSize(textbox.bounds.left)!,
    top: parseSize(textbox.bounds.top)!,
  };
}
function move(source: string, name: string, dxPt: number, dyPt: number) {
  const { snapshot, syntax, report } = project(source);
  const target = report.textboxes.find((t) => t.name === name)!;
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'precision',
    baseVersion: 1,
    operation: 'layout',
    payload: {
      action: 'move',
      targetIds: [target.node.id],
      unit: 'pt',
      dxPt,
      dyPt,
    },
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.candidate;
}

test('equivalent drags resolve to the same report-space move at every zoom', () => {
  const candidates = zooms.map((zoom) => {
    // The designer divides screen pixels by zoom once, then converts 96px/in → pt.
    const screen = { x: 12 * zoom, y: (22 / 3) * zoom };
    return move(
      mixed,
      'Front',
      pixelsToPoints(screen.x / zoom),
      pixelsToPoints(screen.y / zoom),
    );
  });
  for (const candidate of candidates) {
    const { left, top } = position(candidate, 'Front');
    assert.ok(Math.abs(left.points - 21) <= 0.01, left.raw);
    assert.ok(Math.abs(top.points - 23.5) <= 0.01, top.raw);
    // Changed explicit values keep their source units.
    assert.equal(left.unit, 'pt');
    assert.equal(top.unit, 'in');
  }
  assert.equal(new Set(candidates).size, 1);
});

test('1pt and 10pt nudges are exact and keep mixed source units', () => {
  const once = position(move(mixed, 'Behind', 1, 0), 'Behind');
  assert.equal(once.left.unit, 'pc');
  assert.ok(Math.abs(once.left.points - 13) <= 0.01, once.left.raw);
  const shifted = move(mixed, 'Behind', 0, 10);
  assert.equal(position(shifted, 'Behind').top.raw, '28pt');
  // Only the nudged axis changes; the untouched lexeme stays byte-for-byte.
  assert.ok(shifted.includes('<Left>1pc</Left>'));
});

test('100 forward and backward nudges drift by at most 0.01pt', () => {
  const start = position(mixed, 'Behind');
  let source = mixed;
  for (let i = 0; i < 100; i++) source = move(source, 'Behind', 1, 1);
  const far = position(source, 'Behind');
  assert.ok(Math.abs(far.left.points - (start.left.points + 100)) <= 0.01);
  for (let i = 0; i < 100; i++) source = move(source, 'Behind', -1, -1);
  const end = position(source, 'Behind');
  assert.ok(Math.abs(end.left.points - start.left.points) <= 0.01);
  assert.ok(Math.abs(end.top.points - start.top.points) <= 0.01);
  assert.equal(end.left.unit, 'pc');
  assert.equal(end.top.unit, 'pt');
});
