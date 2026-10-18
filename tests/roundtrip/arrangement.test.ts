import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alignModes, type LayoutIntent } from '@rdlc/report-model/editing';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { acceptedGeometry, validateLayout } from '@rdlc/validation/layout';
import {
  planTextboxIntent,
  correlateTargets,
} from '../../apps/vscode-extension/src/edit-controller.js';
import { verifyLayoutCandidate } from '../../apps/vscode-extension/src/verify-candidate.js';

const mixed = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
// Separate mixed-unit textboxes and the table on both axes to exercise real gaps.
const source = mixed
  .replace(
    '<Left>12pt</Left><Height>36pt</Height><Width>144pt</Width>',
    '<Left>240pt</Left><Height>36pt</Height><Width>144pt</Width>',
  )
  .replace('<Top>18pt</Top><Left>240pt', '<Top>160pt</Top><Left>240pt')
  .replace('<Top>1in</Top><Left>12pt', '<Top>320pt</Top><Left>480pt');
const snapshot = {
  uri: 'test:arrange',
  version: 1,
  source,
  eol: '\n' as const,
};
const syntax = parse(snapshot);
const report = projectReport(syntax);
const items = [
  report.textboxes.find((t) => t.name === 'Front')!,
  report.textboxes.find((t) => t.name === 'LaterTie')!,
  report.tables[0]!,
];
const targetIds = items.map((t) => t.node.id);

function run(payload: LayoutIntent['payload']) {
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'bulk',
    baseVersion: 1,
    operation: 'layout',
    payload,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const nextSyntax = parse({
    ...snapshot,
    version: 2,
    source: outcome.candidate,
  });
  const next = projectReport(nextSyntax);
  const changes = validateLayout(report, payload);
  assert.equal(verifyLayoutCandidate(syntax, nextSyntax, changes), true);
  assert.deepEqual(
    correlateTargets(syntax, nextSyntax, outcome.plan, targetIds).map(
      (m) => m.sourceId,
    ),
    targetIds,
  );
  // Reverse every declared patch: all bytes outside the footprint are identical.
  let restored = outcome.candidate;
  let delta = 0;
  const patches = outcome.plan.patches.map((p) => {
    const start = p.start + delta;
    delta += p.replacement.length - (p.end - p.start);
    return {
      ...p,
      start,
      end: start + p.replacement.length,
      original: source.slice(p.start, p.end),
    };
  });
  for (const patch of patches.reverse())
    restored =
      restored.slice(0, patch.start) +
      patch.original +
      restored.slice(patch.end);
  assert.equal(restored, source);
  const geometries = items.map((item) => {
    const table = item === items[2];
    const found = table
      ? next.tables[0]!
      : next.textboxes.find((t) => t.name === item.name)!;
    const geometry = acceptedGeometry(next, found, table);
    const old = acceptedGeometry(report, item, table);
    assert.equal(geometry.width.points, old.width.points);
    assert.equal(geometry.height.points, old.height.points);
    return Object.fromEntries(
      Object.entries(geometry).map(([k, v]) => [k, v.points]),
    ) as Record<'left' | 'top' | 'width' | 'height', number>;
  });
  const corrupted = parse({
    ...snapshot,
    source: outcome.candidate.replace('Group subtotal', 'CORRUPTED'),
  });
  assert.equal(verifyLayoutCandidate(syntax, corrupted, changes), false);
  return { outcome, geometries };
}

test('mixed textbox/table group movement preserves offsets, sizes, metadata and ordered mappings', () => {
  const { geometries } = run({
    action: 'move',
    targetIds,
    dxPt: 9,
    dyPt: 7,
    unit: 'pt',
  });
  geometries.forEach((g, i) => {
    const old = acceptedGeometry(report, items[i]!, i === 2);
    assert.ok(Math.abs(g.left - old.left.points! - 9) < 0.01);
    assert.ok(Math.abs(g.top - old.top.points! - 7) < 0.01);
  });
});

for (const mode of alignModes)
  test(`mixed arrangement aligns ${mode} to primary`, () => {
    const { geometries } = run({
      action: 'align',
      mode,
      primaryId: targetIds[1]!,
      targetIds,
      unit: 'pt',
    });
    const line = (g: (typeof geometries)[number]) =>
      mode === 'left'
        ? g.left
        : mode === 'center'
          ? g.left + g.width / 2
          : mode === 'right'
            ? g.left + g.width
            : mode === 'top'
              ? g.top
              : mode === 'middle'
                ? g.top + g.height / 2
                : g.top + g.height;
    geometries.forEach((g) =>
      assert.ok(Math.abs(line(g) - line(geometries[1]!)) < 0.01),
    );
  });

for (const axis of ['horizontal', 'vertical'] as const)
  test(`${axis} distribution fixes anchors and equalizes edge gaps`, () => {
    const { geometries: g } = run({
      action: 'distribute',
      axis,
      targetIds: [...targetIds].reverse(),
      unit: 'pt',
    });
    const position = axis === 'horizontal' ? 'left' : 'top';
    const size = axis === 'horizontal' ? 'width' : 'height';
    assert.equal(
      g[0]![position],
      acceptedGeometry(report, items[0]!, false)[position].points,
    );
    assert.equal(
      g[2]![position],
      acceptedGeometry(report, items[2]!, true)[position].points,
    );
    assert.ok(
      Math.abs(
        g[1]![position] -
          g[0]![position] -
          g[0]![size] -
          (g[2]![position] - g[1]![position] - g[1]![size]),
      ) < 0.01,
    );
  });

test('whole-selection no-op retains source lexemes and invalid members refuse before planning', () => {
  const noop = run({
    action: 'move',
    targetIds,
    dxPt: 0,
    dyPt: 0,
    unit: 'cm',
  }).outcome;
  assert.equal(noop.changed, false);
  assert.equal(noop.candidate, source);
  const unknown = report.textboxes.find((t) => t.name === 'UnknownWidth')!;
  const result = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'bad',
    baseVersion: 1,
    operation: 'layout',
    payload: {
      action: 'move',
      targetIds: [...targetIds, unknown.node.id],
      dxPt: 1,
      dyPt: 0,
      unit: 'pt',
    },
  });
  assert.equal(result.ok, false);
});

test('group movement materializes only required implicit dimensions and preserves unselected and table geometry', () => {
  const implicit = source.replace(
    '<Height>0.5in</Height><Width>2in</Width>',
    '',
  );
  const snapshot = {
    uri: 'test:implicit-group',
    version: 1,
    source: implicit,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot),
    report = projectReport(syntax);
  const targets = [
    report.textboxes.find((t) => t.name === 'Front')!,
    report.tables[0]!,
  ];
  const payload: LayoutIntent['payload'] = {
    action: 'move',
    targetIds: targets.map((t) => t.node.id),
    dxPt: 3,
    dyPt: 0,
    unit: 'mm',
  };
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'implicit-group',
    baseVersion: 1,
    operation: 'layout',
    payload,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const candidate = parse({
    ...snapshot,
    version: 2,
    source: outcome.candidate,
  });
  assert.equal(
    verifyLayoutCandidate(syntax, candidate, validateLayout(report, payload)),
    true,
  );
  const next = projectReport(candidate).textboxes.find(
    (t) => t.name === 'Front',
  )!;
  assert.ok(next.bounds.width?.endsWith('mm'));
  assert.equal(next.bounds.height, null);
  assert.ok(
    Math.abs(
      acceptedGeometry(projectReport(candidate), next, false).width.points! -
        acceptedGeometry(report, targets[0]!, false).width.points!,
    ) <= 0.01,
  );
});
