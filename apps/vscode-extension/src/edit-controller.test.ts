import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TextboxProperty } from '@rdlc/report-model/editing';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { planTextboxIntent } from './edit-controller.js';

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
