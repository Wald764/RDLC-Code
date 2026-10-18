import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TextboxProperty } from '@rdlc/report-model/editing';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { planTextboxIntent, correlateTargets } from './edit-controller.js';

const source = readFileSync('tests/fixtures/textboxes/supported.rdlc', 'utf8');

function plan(
  source: string,
  property: TextboxProperty,
  value: string,
  baseVersion = 1,
) {
  const snapshot = { uri: 'test:edit', version: 1, source, eol: '\n' as const };
  const syntax = parse(snapshot);
  const projection = projectReport(syntax);
  return planTextboxIntent(snapshot, syntax, projection, {
    requestId: 'test-edit',
    baseVersion,
    targetId: projection.textboxes[0]!.node.id,
    operation: 'setProperty',
    payload: { property, value },
  });
}

test('the shared planner refuses stale scalar edits before creating patches', () => {
  const outcome = plan(source, 'text', 'Stale value', 0);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.diagnostics[0]?.code, 'STALE_EDIT');
});

test('layout refuses a complete invalid set and retains independent-axis capabilities', () => {
  const snapshot = {
    uri: 'test:layout',
    version: 1,
    source: readFileSync(
      'tests/fixtures/interactive/optional-geometry.rdlc',
      'utf8',
    ),
    eol: '\n' as const,
  };
  const syntax = parse(snapshot),
    report = projectReport(syntax);
  const submit = (ids: string[], dxPt: number, dyPt: number) =>
    planTextboxIntent(snapshot, syntax, report, {
      operation: 'layout',
      requestId: 'guard',
      baseVersion: 1,
      payload: { action: 'move', targetIds: ids, dxPt, dyPt, unit: 'mm' },
    });
  const expression = report.textboxes.find(
    (t) => t.name === 'ExpressionWidth',
  )!;
  assert.equal(submit([expression.node.id], 1, 0).ok, false);
  assert.equal(
    submit([expression.node.id], 0, 1).ok,
    true,
    'Unknown width does not block safe Y movement',
  );
  assert.equal(
    submit([report.textboxes[0]!.node.id, expression.node.id], 1, 0).ok,
    false,
  );
  const tiny = report.textboxes.find((t) => t.name === 'Tiny')!;
  assert.equal(submit([tiny.node.id], 0.00001, 0.00001).ok, true);
  const badTable = readFileSync(
    'tests/fixtures/tables/grouped.rdlc',
    'utf8',
  ).replace(/<Width>[^<]+<\/Width>/, '<Width>999pt</Width>');
  const badSnapshot = { ...snapshot, source: badTable },
    badSyntax = parse(badSnapshot),
    badReport = projectReport(badSyntax);
  assert.equal(
    planTextboxIntent(badSnapshot, badSyntax, badReport, {
      operation: 'layout',
      requestId: 'inconsistent',
      baseVersion: 1,
      payload: {
        action: 'resize',
        targetIds: [badReport.tables[0]!.node.id],
        unit: 'pt',
        handle: 'e',
        xPt: 300,
      },
    }).ok,
    false,
  );
});

test('geometric scalar no-op preserves original lexemes and creates no patches', () => {
  const original = source.replace(
    '<Left>0.25in</Left>',
    '<Left>00.250in</Left>',
  );
  const outcome = plan(original, 'left', '18pt');
  assert.ok(outcome.ok);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.candidate, original);
  assert.equal(outcome.plan.patches.length, 0);
  assert.equal(plan(source, 'text', 'Hello & welcome').ok, true);
  const implicit = source.replace(/<Left>[^<]+<\/Left>/, '');
  const implicitOutcome = plan(implicit, 'left', '0pt');
  assert.ok(implicitOutcome.ok);
  assert.equal(implicitOutcome.changed, false);
  assert.equal(implicitOutcome.candidate, implicit);
});

test('result identities follow source offsets across inserted nodes, not ordinals', () => {
  const sibling = source
    .match(/<Textbox\b[\s\S]*?<\/Textbox>/)![0]
    .replaceAll('Title', 'Other')
    .replace(' rd:DefaultName="Other"', '')
    .replace(/<x:Opaque\b[^>]*>[\s\S]*?<\/x:Opaque>/, '');
  const original = source
    .replace(/<Left>[^<]+<\/Left>/, '')
    .replace('</ReportItems>', `${sibling}</ReportItems>`);
  const snapshot = {
    uri: 'test:correlation',
    version: 1,
    source: original,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const report = projectReport(syntax);
  const target = report.textboxes[0]!.node.id;
  const siblingId = report.textboxes[1]!.node.id;
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    operation: 'setProperty',
    requestId: 'map',
    baseVersion: 1,
    targetId: target,
    payload: { property: 'left', value: '1in' },
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.changed, true);
  const accepted = parse({
    ...snapshot,
    version: 2,
    source: outcome.candidate,
  });
  assert.deepEqual(
    correlateTargets(syntax, accepted, outcome.plan, [target, siblingId]),
    [
      {
        sourceId: target,
        resultId: projectReport(accepted).textboxes[0]!.node.id,
      },
      {
        sourceId: siblingId,
        resultId: projectReport(accepted).textboxes[1]!.node.id,
      },
    ],
  );
  assert.notEqual(
    siblingId.split(':')[1],
    projectReport(accepted).textboxes[1]!.node.id.split(':')[1],
  );
  assert.deepEqual(
    correlateTargets(syntax, accepted, outcome.plan, ['1:99999']),
    [],
  );
  const removed = planTextboxIntent(snapshot, syntax, report, {
    operation: 'author',
    requestId: 'delete',
    baseVersion: 1,
    targetId: target,
    payload: { action: 'deleteTextbox', confirm: 'delete-contained-content' },
  });
  assert.ok(removed.ok);
  assert.deepEqual(
    correlateTargets(
      syntax,
      parse({ ...snapshot, version: 2, source: removed.candidate }),
      removed.plan,
      [target],
    ),
    [{ sourceId: target, resultId: null }],
  );
});

test('rename refuses referenced textboxes and opaque dependencies, but allows safe renames and unrelated edits', () => {
  for (const [content, code] of [
    ['<Value>=ReportItems!Title.Value</Value>', 'REFERENCE_IN_USE'],
    [
      '<Value>=reportitems!Title.Value + Code.Run()</Value>',
      'REFERENCE_IN_USE',
    ],
    ['<Value>=ReportItems("Title").Value</Value>', 'REFERENCES_OPAQUE'],
    ['<Value>=Code.UnknownDependency()</Value>', 'REFERENCES_OPAQUE'],
    ['<ToggleItem>Title</ToggleItem>', 'REFERENCE_IN_USE'],
    ['<RepeatWith>Title</RepeatWith>', 'REFERENCE_IN_USE'],
    ['<x:Opaque binding="=ReportItems!Title.Value"/>', 'REFERENCE_IN_USE'],
  ]) {
    const dependent = source.replace('</Body>', `${content}</Body>`);
    const outcome = plan(dependent, 'name', 'Heading');
    assert.equal(outcome.ok, false, content);
    if (!outcome.ok) assert.equal(outcome.diagnostics[0]?.code, code, content);
    assert.equal(plan(dependent, 'left', '1in').ok, true, content);
  }
  for (const expression of [
    '=Fields!Title.Value',
    '=ReportItems!Other.Value',
    '="ReportItems!Title.Value"',
  ]) {
    const dependent = source.replace(
      '</Body>',
      `<Value>${expression}</Value></Body>`,
    );
    assert.equal(plan(dependent, 'name', 'Heading').ok, true, expression);
  }
  const renamed = plan(source, 'name', 'Heading');
  assert.equal(renamed.ok, true);
  if (renamed.ok) assert.ok(renamed.candidate.includes('Name="Heading"'));
});

test('invalid named colors and multi-paragraph text edits are refused by the host pipeline', () => {
  const color = plan(source, 'color', 'DefinitelyNotAColor');
  assert.equal(color.ok, false);
  if (!color.ok) assert.equal(color.diagnostics[0]?.code, 'COLOR_INVALID');
  const rich = source.replace(
    '</Paragraphs>',
    '<Paragraph><TextRuns><TextRun><Value>Second paragraph</Value></TextRun></TextRuns></Paragraph></Paragraphs>',
  );
  const outcome = plan(rich, 'text', 'Replacement');
  assert.equal(outcome.ok, false);
  if (!outcome.ok)
    assert.equal(outcome.diagnostics[0]?.code, 'CAPABILITY_BLOCKED');
});
