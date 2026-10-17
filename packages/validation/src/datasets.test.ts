import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  isFieldType,
  validateDatasetName,
  validateDataMutation,
} from './datasets.js';

test('dataset names, seven-type allowlist and conservative dependency locations', () => {
  const source = readFileSync('tests/fixtures/datasets/local.rdlc', 'utf8');
  const root = parse({
    uri: 'test:types',
    version: 1,
    source,
    eol: '\n',
  }).root!;
  assert.equal(validateDatasetName(root, 'Orders', ['Orders']).length, 1);
  assert.equal(validateDatasetName(root, 'Orders2', ['Orders']).length, 0);
  assert.equal(isFieldType('System.String'), false);
  assert.equal(isFieldType('__proto__'), false);
  for (const type of [
    'text',
    'Boolean',
    'Int32',
    'Int64',
    'decimal',
    'double',
    'date/time',
  ])
    assert.equal(isFieldType(type), true);
  const withReference = source.replace(
    '</Report>',
    '<Hidden>=Fields!Label.Value</Hidden></Report>',
  );
  const syntax = parse({
    uri: 'test:references',
    version: 1,
    source: withReference,
    eol: '\n',
  });
  const dataset = projectReport(syntax).datasets[0]!;
  const errors = validateDataMutation(
    syntax.root!,
    dataset.fields[0]!.node,
    'field',
    'Label',
  );
  assert.equal(errors[0]!.code, 'REFERENCE_IN_USE');
  assert.ok(errors[0]!.range.start > dataset.node.range.end);
});
