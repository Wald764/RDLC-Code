import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, analyzeProperties } from './analyze.js';
import { readFileSync } from 'node:fs';

test('lexes literals, escaped strings, fields and explicit Sum scopes without execution', () => {
  assert.equal(analyze('Fields!No.Value').classification, 'literal');
  const result = analyze(
    '=Sum(Fields!Amount.Value, "Orders") + "Fields!Fake.Value ""quoted"""',
  );
  assert.ok(result.complete);
  assert.deepEqual(
    result.references.map((r) => [r.kind, r.name]),
    [
      ['field', 'Amount'],
      ['dataset', 'Orders'],
    ],
  );
  const text = '=Fields!😀.Value';
  assert.equal(analyze(text).complete, false);
  assert.equal(analyze('="Fields!Hidden.Value"').references.length, 0);
});
test('dynamic, unknown and malformed syntax is incomplete; static dependencies are still retained', () => {
  for (const text of [
    '=Fields(Parameters!X.Value).Value',
    '=Code.Run()',
    '=Fields!A.Value + Mystery()',
    '=Sum(Fields!A.Value, Parameters!Scope.Value)',
    '="unfinished',
    '=',
  ])
    assert.equal(analyze(text).complete, false, text);
  assert.equal(
    analyze('=Fields!A.Value + Code.Run()').references[0]?.name,
    'A',
  );
  assert.equal(analyze('='.padEnd(65538, 'x')).complete, false);
});
test('report-item references are distinct from fields and survive incomplete analysis', () => {
  const result = analyze('=ReportItems!Title.Value + Fields!Title.Value');
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.references.map((reference) => [reference.kind, reference.name]),
    [
      ['report-item', 'Title'],
      ['field', 'Title'],
    ],
  );
  const opaque = analyze('=reportitems!Title.Value + Code.Run()');
  assert.equal(opaque.complete, false);
  assert.equal(opaque.references[0]?.kind, 'report-item');
  assert.equal(analyze('="ReportItems!Title.Value"').references.length, 0);
});
test('known preserved/query expression properties and unknown extension semantics are conservative', () => {
  const fixture = JSON.parse(
    readFileSync('tests/fixtures/expressions/preserved.json', 'utf8'),
  ) as { properties: { name: string; value: string }[] };
  const result = analyzeProperties(fixture.properties.slice(0, 2));
  assert.deepEqual(
    result.references.map((r) => r.name),
    ['Flag', 'Sql'],
  );
  assert.equal(
    analyzeProperties([{ name: 'OpaqueExtension', value: 'custom' }]).complete,
    false,
  );
});
test('typed operands carry exact name ranges for ReportItems and Sum scopes only', () => {
  const text =
    '=ReportItems!Título.Value & Sum(Fields!Amount.Value, "ByLabel")';
  const result = analyze(text);
  assert.ok(result.complete);
  const [item, , scope] = result.references;
  assert.equal(item!.kind, 'report-item');
  assert.equal(
    text.slice(item!.nameRange!.start, item!.nameRange!.end),
    'Título',
  );
  assert.equal(scope!.name, 'ByLabel');
  assert.equal(
    text.slice(scope!.nameRange!.start, scope!.nameRange!.end),
    'ByLabel',
  );
  assert.equal(
    analyze('=Sum(Fields!A.Value, "By""Label")').references[1]!.nameRange,
    undefined,
  );
  // Scope kind stays syntactic; typed resolution happens against declared identities.
  assert.equal(
    analyze('=Sum(Fields!A.Value, "T")', ['T']).references[1]!.kind,
    'group',
  );
  assert.equal(
    analyze('=Sum(Fields!A.Value, "T")').references[1]!.kind,
    'dataset',
  );
  for (const opaque of [
    '=ReportItems("Title").Value',
    '=Scopes!Group.Value',
    '=Code.Lookup(ReportItems!Title.Value)',
    '=Count(Fields!A.Value, "Orders")',
  ])
    assert.equal(analyze(opaque).complete, false, opaque);
  assert.deepEqual(analyze('="ReportItems!Title.Value"').references, []);
});
