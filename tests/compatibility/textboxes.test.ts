import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';

const project = (path: string) => {
  const source = readFileSync(`tests/fixtures/textboxes/${path}`, 'utf8');
  const projection = projectReport(
    parse({ uri: `fixture:${path}`, version: 1, source, eol: '\n' }),
  );
  return { source, projection };
};

test('supported textbox projects exactly one paragraph/run value with editable properties', () => {
  const { source, projection } = project('supported.rdlc');
  assert.equal(projection.status, 'editable');
  const textbox = projection.textboxes[0];
  assert.ok(textbox);
  assert.equal(textbox.context, 'body');
  assert.equal(textbox.name, 'Title');
  assert.equal(textbox.value?.text, 'Hello & welcome');
  assert.deepEqual(textbox.bounds, {
    left: '0.25in',
    top: '0.25in',
    width: '3in',
    height: '0.5in',
  });
  assert.deepEqual(textbox.style, {
    fontFamily: 'Segoe UI',
    fontSize: '14pt',
    fontWeight: 'Bold',
    fontStyle: null,
    color: null,
    textAlign: null,
  });
  for (const capability of [
    'name',
    'text',
    'left',
    'top',
    'width',
    'height',
    'style',
  ])
    assert.ok(textbox.capabilities.includes(capability), capability);
  assert.equal(
    source.slice(textbox.value!.range.start, textbox.value!.range.end),
    'Hello &amp; welcome',
  );
});

test('rich text and expression geometry stay preservation-only while the item stays visible', () => {
  const { projection } = project('supported-plus-opaque.rdlc');
  const [title, rich, dynamic] = projection.textboxes;
  assert.ok(title && rich && dynamic);
  assert.deepEqual(
    rich.capabilities.filter((capability) => capability !== 'textbox'),
    ['name', 'left', 'top', 'width', 'height'],
  );
  assert.equal(rich.value, null);
  assert.equal(dynamic.value?.text, '=Fields!Label.Value');
  assert.ok(!dynamic.capabilities.includes('width'));
  assert.ok(dynamic.capabilities.includes('height'));
  assert.ok(title.capabilities.includes('text'));
});

test('another RDL version stays source-only with no projected textboxes', () => {
  const { projection } = project('unsupported-profile.rdlc');
  assert.equal(projection.status, 'source-only');
  assert.equal(projection.section, null);
  assert.equal(projection.textboxes.length, 0);
});

test('multiple paragraphs or TextRuns containers remain preservation-only placeholders', () => {
  const { source } = project('supported.rdlc');
  for (const rich of [
    source.replace(
      '</Paragraphs>',
      '<Paragraph><TextRuns><TextRun><Value>Second</Value></TextRun></TextRuns></Paragraph></Paragraphs>',
    ),
    source.replace(
      '</Paragraph>',
      '<TextRuns><TextRun><Value>Second</Value></TextRun></TextRuns></Paragraph>',
    ),
  ]) {
    const projection = projectReport(
      parse({ uri: 'test:rich', version: 1, source: rich, eol: '\n' }),
    );
    assert.equal(projection.textboxes[0]!.value, null);
    assert.equal(projection.textboxes[0]!.capabilities.includes('text'), false);
    assert.equal(renderScene(projection).items[0]!.placeholder, true);
  }
});
