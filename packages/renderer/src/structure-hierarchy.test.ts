import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectStructure } from './structure.js';
import { projectNavigation } from './navigation.js';

test('compact Structure retains table bodies, members and groups without duplicating Data', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const syntax = parse({
    uri: 'test:table-hierarchy',
    version: 4,
    source,
    eol: '\n',
  });
  const structure = projectStructure(syntax, projectReport(syntax));
  const byLabel = structure.nodes.find((node) => node.name === 'ByLabel');
  assert.equal(byLabel?.kind, 'group');
  const member = structure.nodes.find((node) => node.id === byLabel?.parentId);
  assert.equal(member?.kind, 'member');
  assert.match(
    source.slice(member!.range.start, member!.range.end),
    /^<TablixMember>/,
  );
  const table = structure.nodes.find((node) => node.name === 'OrdersTable')!;
  const body = structure.nodes.find((node) => node.kind === 'table-body')!;
  assert.equal(body.parentId, table.id);
  assert.equal(
    structure.nodes.find((node) => node.kind === 'row')?.parentId,
    body.id,
  );
  assert.equal(
    structure.nodes.some(
      (node) => node.kind === 'dataset' || node.kind === 'field',
    ),
    false,
  );
  assert.equal(structure.truncated, false);
});

test('member headers retain their real member and contained textbox ancestry', () => {
  const source =
    '<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"><ReportSections><ReportSection><Body><ReportItems><Tablix Name="T"><TablixRowHierarchy><TablixMembers><TablixMember><TablixHeader><CellContents><Textbox Name="Heading"/></CellContents></TablixHeader></TablixMember></TablixMembers></TablixRowHierarchy></Tablix></ReportItems></Body></ReportSection></ReportSections></Report>';
  const syntax = parse({
    uri: 'test:member-header',
    version: 2,
    source,
    eol: '\n',
  });
  const { nodes } = projectStructure(syntax, projectReport(syntax));
  const header = nodes.find((node) => node.kind === 'member-header')!;
  assert.equal(
    nodes.find((node) => node.name === 'Heading')?.parentId,
    header.id,
  );
  assert.equal(
    nodes.find((node) => node.id === header.parentId)?.kind,
    'member',
  );
  assert.equal(
    source.slice(header.range.start, header.range.end),
    '<TablixHeader><CellContents><Textbox Name="Heading"/></CellContents></TablixHeader>',
  );
});

test('legacy Table grouping remains source-only and inspectable in both projections', () => {
  // MS-RDL 2.80 / 2.85: TableGroup contains the actual named Grouping definition.
  const source =
    '<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2005/01/reportdefinition"><Body><ReportItems><Table Name="Legacy"><TableGroups><TableGroup><Grouping Name="ByCategory"><GroupExpressions><GroupExpression>=Fields!Category.Value</GroupExpression></GroupExpressions></Grouping></TableGroup></TableGroups></Table></ReportItems></Body></Report>';
  const syntax = parse({
    uri: 'test:legacy-table',
    version: 6,
    source,
    eol: '\n',
  });
  const report = projectReport(syntax);
  assert.notEqual(report.status, 'editable');
  const legacy = projectStructure(syntax, report);
  const group = legacy.nodes.find((node) => node.name === 'ByCategory')!;
  assert.equal(group.kind, 'group');
  assert.match(group.preservedReason!, /Source-only/);
  assert.equal(
    legacy.nodes.find((node) => node.id === group.parentId)?.name,
    'Legacy',
  );
  const native = projectNavigation(syntax, report).structure.nodes;
  const nativeGroup = native.find((node) => node.name === 'ByCategory')!;
  assert.equal(nativeGroup.kind, 'group');
  assert.equal(nativeGroup.id, group.id);
  assert.equal(
    nativeGroup.capabilities.find(
      (capability) => capability.operation === 'author',
    )?.eligible,
    false,
  );
  assert.equal(
    nativeGroup.capabilities.find(
      (capability) => capability.operation === 'source',
    )?.eligible,
    true,
  );
  assert.match(
    source.slice(group.range.start, group.range.end),
    /^<Grouping Name="ByCategory">/,
  );
});
