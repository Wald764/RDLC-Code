import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { fieldTypes } from '@rdlc/report-model/report';
import { blankReport } from '../../apps/vscode-extension/src/templates/blank-report.js';
import { projectStructure } from '@rdlc/renderer/structure';
import { projectNavigation } from '@rdlc/renderer/navigation';

test('blank template is the cited single-section fixture with no invented query/source metadata', () => {
  assert.equal(
    blankReport,
    readFileSync('tests/fixtures/datasets/blank.rdlc', 'utf8'),
  );
  const report = projectReport(
    parse({ uri: 'fixture:blank', source: blankReport, version: 1, eol: '\n' }),
  );
  assert.equal(report.status, 'editable');
  assert.equal(report.section?.width, '6.5in');
  assert.equal(report.section?.height, '2in');
  assert.equal(report.datasets.length, 0);
  assert.ok(!/Query|DataSource|CommandText/.test(blankReport));
});

test('query-free local dataset projects all seven exact designer type mappings', () => {
  const source = readFileSync('tests/fixtures/datasets/local.rdlc', 'utf8');
  const syntax = parse({ uri: 'fixture:local', version: 1, source, eol: '\n' });
  const report = projectReport(syntax);
  assert.equal(report.status, 'editable');
  assert.equal(report.datasets.length, 1);
  const dataset = report.datasets[0]!;
  assert.equal(dataset.name, 'Orders');
  assert.equal(dataset.query, null);
  assert.deepEqual(
    dataset.fields.map((field) => field.typeName),
    Object.values(fieldTypes),
  );
  for (const field of dataset.fields) {
    assert.equal(field.dataField, field.name);
    assert.equal(field.calculatedValue, null);
  }
  assert.equal(syntax.snapshot.source, source);
  const structure = projectStructure(syntax, report);
  assert.equal(
    structure.nodes.some(
      (node) => node.kind === 'dataset' || node.kind === 'field',
    ),
    false,
    'the retired legacy data branch never returns to Structure',
  );
  const navigation = projectNavigation(syntax, report);
  assert.equal(navigation.data.truncated, false);
  const definition = navigation.data.nodes.find(
    (node) => node.id === dataset.node.id,
  )!;
  assert.equal(definition.kind, 'dataset');
  assert.equal(definition.name, dataset.name);
  assert.deepEqual(
    navigation.data.nodes
      .filter(
        (node) => node.parentId === definition.id && node.kind === 'field',
      )
      .map((node) => node.id),
    dataset.fields.map((field) => field.node.id),
  );
  assert.equal(syntax.snapshot.source, source);
});

test('existing queries, calculated fields, foreign prefixes and unknown types remain source-bound', () => {
  const source = readFileSync('tests/fixtures/datasets/preserved.rdlc', 'utf8');
  const report = projectReport(
    parse({ uri: 'fixture:preserved', version: 1, source, eol: '\n' }),
  );
  const dataset = report.datasets[0]!;
  assert.ok(dataset.query);
  assert.equal(dataset.fields[0]!.dataField, 'application_column');
  assert.equal(dataset.fields[1]!.calculatedValue, '=Fields!Known.Value + 1');
  assert.equal(dataset.fields[2]!.type, null);
  assert.equal(dataset.fields[2]!.typeName, 'Custom.Money');
});
