import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  isFieldType,
  validateDatasetName,
  validateDataMutation,
  validateRemoval,
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

test('whole removal sets allow internal references and block outside or opaque ones', () => {
  const source = readFileSync(
    'tests/fixtures/interactive/clipboard-dependencies.rdlc',
    'utf8',
  );
  const load = (text: string) => {
    const syntax = parse({
      uri: 'test:cut',
      version: 1,
      source: text,
      eol: '\n',
    });
    const report = projectReport(syntax);
    return {
      root: syntax.root!,
      node: (name: string) =>
        report.textboxes.find((t) => t.name === name)!.node,
    };
  };
  const item = (name: string) => ({
    kind: 'report-item' as const,
    element: 'Textbox',
    name,
  });
  const doc = load(source);
  const remove = (names: string[]) =>
    validateRemoval(doc.root, names.map(doc.node), names.map(item), source);
  // The classified annotation inside Title is inert; references inside the set are safe.
  assert.deepEqual(remove(['InternalReference', 'ExternalReference']), []);
  assert.equal(
    remove(['Title', 'InternalReference'])[0]?.code,
    'REFERENCE_IN_USE',
    'OutsideConsumer still references Title',
  );
  assert.equal(
    remove(['Title', 'InternalReference', 'OutsideConsumer'])[0]?.code,
    'REFERENCE_IN_USE',
    'EntityReference still toggles and references Title',
  );
  assert.deepEqual(
    remove([
      'Title',
      'InternalReference',
      'OutsideConsumer',
      'EntityReference',
    ]),
    [],
  );
  // Opaque content blocks only when it spells a removed name (decoded or raw).
  const cut = (extra: string, name = 'LiteralLookalike') => {
    const text = source.replace('</ReportItems>', `${extra}</ReportItems>`);
    const other = load(text);
    return validateRemoval(
      other.root,
      [other.node(name)],
      [item(name)],
      text,
    )[0]?.code;
  };
  assert.equal(cut('<x:Chart keep="opaque"/>'), undefined);
  assert.equal(cut('<x:Chart ref="LiteralLookalike"/>'), 'REFERENCES_OPAQUE');
  assert.equal(
    cut('<x:Chart>Literal&#76;ookalike</x:Chart>'),
    'REFERENCES_OPAQUE',
  );
  assert.equal(
    cut('<Textbox Name="T" rd:DefaultName="LiteralLookalike"/>'),
    'REFERENCES_OPAQUE',
  );
  assert.equal(
    cut(
      '<Textbox Name="Dyn"><Value>=Code.Get("LiteralLookalike")</Value></Textbox>',
    ),
    'REFERENCES_OPAQUE',
  );
  assert.equal(
    cut('<Textbox Name="Dyn"><Value>=Code.Get("Other")</Value></Textbox>'),
    undefined,
  );
  // Without raw source (existing authoring deletes) any opaque content still blocks.
  const legacy = load(
    source.replace('</ReportItems>', '<x:Chart/></ReportItems>'),
  );
  assert.equal(
    validateDataMutation(
      legacy.root,
      legacy.node('LiteralLookalike'),
      'report-item',
      'LiteralLookalike',
    )[0]?.code,
    'REFERENCES_OPAQUE',
  );
});
