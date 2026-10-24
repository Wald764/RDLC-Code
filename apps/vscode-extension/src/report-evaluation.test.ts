import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DocumentSnapshot } from '@rdlc/report-model/document';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  evaluateReport,
  snapshotOf,
  syntaxNodes,
  type ReportDocument,
} from './report-evaluation.js';

function snapshot(source: string, version = 1): DocumentSnapshot {
  return { uri: 'test:report', version, source, eol: '\n' };
}

/** The pre-extraction document-session formula, used as the equivalence oracle. */
function legacyIds(
  syntax: ReturnType<typeof parse>,
  projection: ReturnType<typeof projectReport>,
) {
  return [
    ...(syntax.root ? [syntax.root.id] : []),
    ...projection.textboxes.map((textbox) => textbox.node.id),
    ...projection.datasets.flatMap((dataset) => [
      dataset.node.id,
      ...dataset.fields.map((field) => field.node.id),
    ]),
    ...projection.tables.flatMap((table) => [
      table.node.id,
      ...table.groups.map((group) => group.node.id),
    ]),
  ];
}

test('snapshotOf preserves the accepted host identity and line endings', () => {
  const document: ReportDocument & { eol: number } = {
    uri: { toString: () => 'file:///report.rdlc' },
    version: 12,
    eol: 2,
    getText: () => '<Report/>',
  };
  assert.deepEqual(snapshotOf(document), {
    uri: 'file:///report.rdlc',
    version: 12,
    source: '<Report/>',
    eol: '\r\n',
  });
  document.eol = 1;
  assert.equal(snapshotOf(document).eol, '\n');
});

test('editable evaluation keeps parser, profile and capability facts', () => {
  const source = readFileSync(
    'tests/fixtures/textboxes/supported.rdlc',
    'utf8',
  );
  const input = Object.freeze(snapshot(source, 5));
  const syntax = parse(input);
  const projection = projectReport(syntax);
  const evaluation = evaluateReport(input);

  assert.equal(evaluation.snapshot, input);
  assert.equal(evaluation.syntax.status, 'valid');
  assert.equal(evaluation.syntax.root?.id, syntax.root?.id);
  assert.deepEqual(evaluation.projection, projection);
  assert.equal(evaluation.projection.status, 'editable');
  assert.deepEqual(evaluation.capabilities, [
    'setProperty',
    'author',
    'layout',
    'clipboard',
  ]);
  assert.deepEqual(evaluation.ids, legacyIds(syntax, projection));
  assert.deepEqual(
    evaluation.sourceIds,
    syntaxNodes(syntax.root).map((node) => node.id),
  );
  assert.equal(evaluation.sourceIds[0], syntax.root?.id);
  assert.equal(new Set(evaluation.ids).size, evaluation.ids.length);
  assert.ok(evaluation.ids.every((id) => evaluation.sourceIds.includes(id)));
  assert.equal(input.source, source);
});

test('table, dataset, field and group identities match the legacy evaluation', () => {
  const input = snapshot(
    readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8'),
  );
  const evaluation = evaluateReport(input);
  const syntax = parse(input);
  const projection = projectReport(syntax);

  assert.equal(evaluation.projection.status, 'editable');
  assert.deepEqual(evaluation.ids, legacyIds(syntax, projection));
  for (const dataset of projection.datasets)
    assert.ok(
      evaluation.ids.includes(dataset.node.id),
      `dataset ${dataset.name} is navigable`,
    );
  for (const table of projection.tables) {
    assert.ok(evaluation.ids.includes(table.node.id));
    for (const group of table.groups)
      assert.ok(evaluation.ids.includes(group.node.id));
  }
  assert.ok(evaluation.sourceIds.length > evaluation.ids.length);
});

test('source-only reports are evaluated without capabilities or mutation', () => {
  const source = readFileSync(
    'tests/fixtures/textboxes/unsupported-profile.rdlc',
    'utf8',
  );
  const input = Object.freeze(snapshot(source));
  const evaluation = evaluateReport(input);

  assert.equal(evaluation.projection.status, 'source-only');
  assert.deepEqual(evaluation.capabilities, []);
  assert.equal(evaluation.syntax.root?.id, evaluation.sourceIds[0]);
  assert.ok(
    evaluation.ids.every((id) => evaluation.sourceIds.includes(id)),
    'source-only identity lists stay consistent',
  );
  assert.equal(input.source, source);
});

test('invalid source stays inspectable and creates no report content', () => {
  const source = readFileSync('tests/fixtures/xml/malformed.rdlc', 'utf8');
  const evaluation = evaluateReport(snapshot(source));

  assert.equal(evaluation.syntax.status, 'invalid-source');
  assert.equal(evaluation.syntax.root, null);
  assert.equal(evaluation.projection.status, 'invalid-source');
  assert.deepEqual(evaluation.capabilities, []);
  assert.deepEqual(evaluation.ids, []);
  assert.deepEqual(evaluation.sourceIds, []);
  assert.equal(evaluation.snapshot.source, source);
});

test('evaluation is repeatable and traversal handles an empty document', () => {
  const source = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
  const input = snapshot(source, 3);
  const first = evaluateReport(input);
  const second = evaluateReport(input);

  assert.deepEqual(second.ids, first.ids);
  assert.deepEqual(second.sourceIds, first.sourceIds);
  assert.deepEqual(second.capabilities, first.capabilities);
  assert.deepEqual(syntaxNodes(null), []);
});
