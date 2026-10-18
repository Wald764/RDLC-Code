import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectStructure } from './structure.js';

test('structure joins actual table/data syntax without mutating accepted input', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const syntax = parse({
    uri: 'fixture:grouped-table-scoped-totals',
    version: 7,
    source,
    eol: '\n',
  });
  const report = projectReport(syntax);
  const before = JSON.stringify({ syntax, report });
  const structure = projectStructure(syntax, report);
  assert.equal(structure.truncated, false);
  for (const kind of [
    'report',
    'sections',
    'section',
    'body',
    'table',
    'row',
    'cell',
    'textbox',
    'dataset',
    'field',
  ])
    assert.ok(
      structure.nodes.some((n) => n.kind === kind),
      kind,
    );
  for (const n of structure.nodes) {
    assert.ok(n.id.startsWith('7:'));
    assert.ok(n.range.end <= source.length);
    if (n.parentId) assert.ok(structure.nodes.some((p) => p.id === n.parentId));
  }
  assert.equal(JSON.stringify({ syntax, report }), before);
  assert.equal(projectStructure(syntax, report, 2).truncated, true);
  assert.equal(projectStructure(syntax, report, 0).nodes.length, 0);
});

test('source-only sections and preserved nesting stay honest; malformed syntax invents nothing', () => {
  const ns =
    'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
  const source = `<Report xmlns="${ns}"><ReportSections><ReportSection><Body><ReportItems><Rectangle Name="Box"><ReportItems><Textbox Name="Nested"/></ReportItems></Rectangle><Chart Name="Opaque"><Anything/></Chart></ReportItems></Body></ReportSection><ReportSection><Body/></ReportSection></ReportSections></Report>`;
  const syntax = parse({
    uri: 'fixture:nested',
    version: 1,
    source,
    eol: '\n',
  });
  const result = projectStructure(syntax, projectReport(syntax));
  assert.equal(result.nodes.filter((n) => n.kind === 'section').length, 2);
  assert.ok(result.nodes.find((n) => n.name === 'Nested')?.preservedReason);
  assert.ok(
    result.nodes
      .find((n) => n.name === 'Opaque')
      ?.preservedReason?.includes('Chart'),
  );
  assert.ok(!result.nodes.some((n) => n.label === 'Anything'));
  const invalid = parse({
    uri: 'fixture:invalid',
    version: 1,
    source: '<Report>',
    eol: '\n',
  });
  assert.deepEqual(projectStructure(invalid, projectReport(invalid)).nodes, []);
});

test('deep preserved containment truncates at 32 levels without fabricating bounds or children', () => {
  const source =
    '<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"><ReportSections><ReportSection><Body><ReportItems>' +
    '<Rectangle><ReportItems>'.repeat(40) +
    '<Textbox Name="Deep"/>' +
    '</ReportItems></Rectangle>'.repeat(40) +
    '</ReportItems></Body></ReportSection></ReportSections></Report>';
  const syntax = parse({ uri: 'fixture:deep', version: 1, source, eol: '\n' });
  const structure = projectStructure(syntax, projectReport(syntax));
  assert.equal(structure.truncated, true);
  assert.equal(structure.nodes.length, 32);
  assert.ok(!structure.nodes.some((n) => n.name === 'Deep' || 'bounds' in n));
});
