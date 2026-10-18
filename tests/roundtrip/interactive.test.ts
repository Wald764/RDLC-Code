import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resizeHandles, type LayoutIntent } from '@rdlc/report-model/editing';
import { toPoints, resolveGeometry } from '@rdlc/report-model/geometry';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { planTextboxIntent } from '../../apps/vscode-extension/src/edit-controller.js';

const fixture = (name: string) =>
  readFileSync(`tests/fixtures/${name}.rdlc`, 'utf8');
type Action = LayoutIntent['payload'] extends infer P
  ? P extends LayoutIntent['payload']
    ? Omit<P, 'targetIds' | 'unit'>
    : never
  : never;
function layout(source: string, table: boolean, action: Action) {
  const snapshot = {
    uri: 'test:layout',
    version: 1,
    source,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const report = projectReport(syntax);
  const target = table
    ? report.tables[0]!
    : report.textboxes.find((t) => t.context === 'body')!;
  assert.ok(target);
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'direct',
    baseVersion: 1,
    operation: 'layout',
    payload: {
      ...action,
      targetIds: [target.node.id],
      unit: 'pt',
    } as LayoutIntent['payload'],
  });
  return { outcome, report, target, snapshot };
}

for (const table of [false, true]) {
  for (const handle of resizeHandles) {
    test(`${table ? 'table' : 'textbox'} ${handle} resize fixes opposite edges and preserves content`, () => {
      const source = fixture(table ? 'tables/grouped' : 'textboxes/supported');
      const before = layout(source, table, {
        action: 'move',
        dxPt: 0,
        dyPt: 0,
      } as LayoutIntent['payload']);
      const raw = before.target.bounds;
      const width = table
        ? before.report.tables[0]!.columns.reduce(
            (s, c) => s + toPoints(c.width)!,
            0,
          )
        : toPoints(raw.width)!;
      const height = table
        ? before.report.tables[0]!.rows.reduce(
            (s, r) => s + toPoints(r.height)!,
            0,
          )
        : toPoints(raw.height)!;
      const left = toPoints(raw.left) ?? 0,
        top = toPoints(raw.top) ?? 0;
      const xPt = handle.includes('w') ? left + 1 : left + width + 5;
      const yPt = handle.includes('n') ? top + 1 : top + height + 5;
      const { outcome } = layout(source, table, {
        action: 'resize',
        handle,
        ...(/[ew]/.test(handle) ? { xPt } : {}),
        ...(/[ns]/.test(handle) ? { yPt } : {}),
      } as LayoutIntent['payload']);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      const next = projectReport(
        parse({ ...before.snapshot, source: outcome.candidate }),
      );
      const item = table ? next.tables[0]! : next.textboxes[0]!;
      const bounds = item.bounds;
      assert.ok(
        Math.abs(
          (toPoints(bounds.left) ?? 0) - (handle.includes('w') ? xPt : left),
        ) < 0.01,
      );
      assert.ok(
        Math.abs(
          (toPoints(bounds.top) ?? 0) - (handle.includes('n') ? yPt : top),
        ) < 0.01,
      );
      const nextWidth = table
        ? next.tables[0]!.columns.reduce((s, c) => s + toPoints(c.width)!, 0)
        : toPoints(bounds.width)!;
      const nextHeight = table
        ? next.tables[0]!.rows.reduce((s, r) => s + toPoints(r.height)!, 0)
        : toPoints(bounds.height)!;
      assert.ok(
        Math.abs(
          nextWidth -
            (handle.includes('w')
              ? width - 1
              : handle.includes('e')
                ? width + 5
                : width),
        ) < 0.01,
      );
      assert.ok(
        Math.abs(
          nextHeight -
            (handle.includes('n')
              ? height - 1
              : handle.includes('s')
                ? height + 5
                : height),
        ) < 0.01,
      );
      assert.deepEqual(
        next.textboxes.map((t) => t.value?.text),
        before.report.textboxes.map((t) => t.value?.text),
      );
      let expected = source;
      for (const patch of [...outcome.plan.patches].reverse())
        expected =
          expected.slice(0, patch.start) +
          patch.replacement +
          expected.slice(patch.end);
      assert.equal(outcome.candidate, expected);
    });
  }
}

test('implicit dimensions materialize only on moved axes; no-op is byte exact', () => {
  const source = fixture('textboxes/supported')
    .replace(/<Width>[^<]+<\/Width>/, '')
    .replace(/<Height>[^<]+<\/Height>/, '');
  const { outcome, report, snapshot } = layout(source, false, {
    action: 'move',
    dxPt: 3,
    dyPt: 0,
  } as LayoutIntent['payload']);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const next = projectReport(parse({ ...snapshot, source: outcome.candidate }));
  assert.equal(next.textboxes[0]!.bounds.height, null);
  const old = resolveGeometry(report.textboxes[0]!.bounds, {
    width: toPoints(report.section!.width),
    height: toPoints(report.section!.height),
  });
  assert.ok(
    Math.abs(toPoints(next.textboxes[0]!.bounds.width)! - old.width.points!) <
      0.01,
  );
  const noop = layout(source, false, {
    action: 'move',
    dxPt: 0,
    dyPt: 0,
  } as LayoutIntent['payload']).outcome;
  assert.ok(noop.ok);
  assert.equal(noop.changed, false);
  assert.equal(noop.candidate, source);
});

test('negative positions, zero sizes and non-body targets refuse atomically; overflow is allowed', () => {
  const source = fixture('textboxes/supported');
  for (const action of [
    { action: 'move', dxPt: -10000, dyPt: 0 },
    { action: 'resize', handle: 'e', xPt: 18 },
  ])
    assert.equal(
      layout(source, false, action as LayoutIntent['payload']).outcome.ok,
      false,
    );
  assert.equal(
    layout(source, false, {
      action: 'move',
      dxPt: 10000,
      dyPt: 10000,
    } as LayoutIntent['payload']).outcome.ok,
    true,
  );
});

test('lexical markup, mixed units and line endings survive moves exactly outside geometry', () => {
  for (const eol of ['\n', '\r\n']) {
    const source = fixture('textboxes/supported')
      .replace(/\r?\n/g, eol)
      .replace('0.25in</Left>', '6.35mm</Left>')
      .replace(
        'Hello &amp; welcome',
        '<![CDATA[Hello & welcome]]><!--keep--><?keep value?>',
      );
    const { outcome } = layout(source, false, {
      action: 'move',
      dxPt: 9,
      dyPt: 0,
    } as LayoutIntent['payload']);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.equal(outcome.plan.patches.length, 1);
    const patch = outcome.plan.patches[0]!;
    assert.equal(
      outcome.candidate,
      source.slice(0, patch.start) +
        patch.replacement +
        source.slice(patch.end),
    );
    assert.match(patch.replacement, /mm$/);
  }
});

test('prefixed geometry insertions preserve rebound namespace neighbors and unknown children', () => {
  const source = fixture('interactive/optional-geometry')
    .replace('xmlns=', 'xmlns:r=')
    .replace(/<(\/?)([A-Z][A-Za-z]*)(?=[\s/>])/g, '<$1r:$2')
    .replace(
      '</r:Textbox>',
      '<x:Note xmlns:x="urn:note"><x:Width>opaque</x:Width></x:Note><!--retained--><?keep value?></r:Textbox>',
    );
  const { outcome, snapshot } = layout(source, false, {
    action: 'move',
    dxPt: 3,
    dyPt: 4,
  } as LayoutIntent['payload']);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const next = projectReport(parse({ ...snapshot, source: outcome.candidate }));
  assert.ok(next.textboxes[0]!.bounds.width?.endsWith('pt'));
  assert.match(outcome.candidate, /<r:Width>/);
  assert.match(
    outcome.candidate,
    /<x:Note xmlns:x="urn:note"><x:Width>opaque<\/x:Width><\/x:Note><!--retained--><\?keep value\?>/,
  );
});
