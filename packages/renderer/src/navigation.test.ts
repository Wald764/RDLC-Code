import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectNavigation } from './navigation.js';
import { validateAcceptedNavigation } from '@rdlc/report-model/navigation';

const ns =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const xml = `<Report xmlns="${ns}"><DataSets><DataSet Name="Orders"><Query><CommandText>SECRET_QUERY</CommandText></Query><Fields><Field Name="Id"><DataField>SECRET_BINDING</DataField></Field></Fields></DataSet></DataSets><ReportParameters><ReportParameter Name="Limit"><DefaultValue><Values><Value>SECRET_VALUE</Value></Values></DefaultValue></ReportParameter></ReportParameters><EmbeddedImages><EmbeddedImage Name="Logo"><ImageData>SECRET_IMAGE</ImageData></EmbeddedImage></EmbeddedImages><DataSources><DataSource Name="Source"><ConnectionProperties><ConnectString>SECRET_PASSWORD</ConnectString></ConnectionProperties></DataSource></DataSources><ReportSections><ReportSection><Body><ReportItems><Tablix Name="T"><TablixBody><TablixRows><TablixRow><TablixCells><TablixCell><CellContents><Textbox Name="Cell"/></CellContents></TablixCell></TablixCells></TablixRow></TablixRows></TablixBody><TablixRowHierarchy><TablixMembers><TablixMember><Group Name="G"/><TablixHeader><CellContents><Textbox Name="Header"/></CellContents></TablixHeader></TablixMember></TablixMembers></TablixRowHierarchy></Tablix></ReportItems></Body><Page><PageHeader><ReportItems><Textbox Name="Title"/></ReportItems></PageHeader></Page></ReportSection></ReportSections></Report>`;

test('native projections keep actual cell/member/header ancestry and separate data definitions', () => {
  const syntax = parse({
    uri: 'test:report',
    source: xml,
    version: 7,
    eol: '\n',
  });
  const result = projectNavigation(syntax, projectReport(syntax));
  assert.equal(validateAcceptedNavigation(result, 7, xml.length), true);
  assert.deepEqual(
    result.data.nodes.map((node) => [node.kind, node.name]),
    [
      ['dataset', 'Orders'],
      ['field', 'Id'],
      ['parameter', 'Limit'],
      ['embedded-image', 'Logo'],
      ['data-source', 'Source'],
    ],
  );
  assert.equal(result.data.nodes[1]?.parentId, result.data.nodes[0]?.id);
  assert.deepEqual(result.data.nodes[0]?.details, { hasQuery: true });
  assert.deepEqual(result.data.nodes[3]?.details, { hasPayload: true });
  assert.deepEqual(result.data.nodes[4]?.details, { source: 'inline' });
  assert.equal(
    result.structure.nodes.some((node) =>
      ['dataset', 'field'].includes(node.kind),
    ),
    false,
  );
  for (const [name, parentKind] of [
    ['Cell', 'table-cell'],
    ['G', 'member'],
    ['Header', 'member-header'],
    ['Title', 'header'],
  ]) {
    const node = result.structure.nodes.find((node) => node.name === name)!;
    assert.ok(node, name);
    assert.equal(
      result.structure.nodes.find((parent) => parent.id === node.parentId)
        ?.kind,
      parentKind,
      name,
    );
    assert.match(
      xml.slice(node.range.start, node.range.end),
      new RegExp(`Name="${name}"`),
    );
  }
  assert.doesNotMatch(JSON.stringify(result), /SECRET_/);
  for (const details of [
    { connectionString: 'SECRET_PASSWORD' },
    { type: 'SECRET_TYPE' },
    { hasQuery: 'SECRET_QUERY' },
    { mime: 'javascript:SECRET_SCRIPT' },
  ]) {
    const forged: unknown = {
      ...result,
      data: {
        ...result.data,
        nodes: [
          { ...result.data.nodes[0]!, details },
          ...result.data.nodes.slice(1),
        ],
      },
    };
    assert.equal(validateAcceptedNavigation(forged, 7, xml.length), false);
  }
  for (const projection of [result.structure, result.data]) {
    const seen = new Set<string>();
    for (const node of projection.nodes) {
      assert.ok(node.parentId === null || seen.has(node.parentId));
      assert.equal(seen.has(node.id), false);
      seen.add(node.id);
    }
  }
});

test('known source-only namespaces retain inspection without mutation capabilities', () => {
  const source = xml.replaceAll('/2016/01/', '/2008/01/');
  const syntax = parse({ uri: 'test:legacy', source, version: 2, eol: '\n' });
  const report = projectReport(syntax);
  assert.equal(report.status, 'source-only');
  const result = projectNavigation(syntax, report);
  assert.equal(result.data.nodes.length, 5);
  assert.ok(result.structure.nodes.some((node) => node.kind === 'table-cell'));
  assert.ok(
    [...result.structure.nodes, ...result.data.nodes].every((node) =>
      node.capabilities.every(
        (capability) =>
          ['inspect', 'source', 'select'].includes(capability.operation) ||
          !capability.eligible,
      ),
    ),
  );
});

test('native allocation shares 2000 entries fairly, transfers unused capacity and keeps parent-closed prefixes', () => {
  const source = `<Report xmlns="${ns}"><DataSets>${Array.from({ length: 1500 }, (_, i) => `<DataSet Name="D${i}"/>`).join('')}</DataSets><ReportSections><ReportSection><Body><ReportItems>${Array.from({ length: 1500 }, (_, i) => `<Textbox Name="T${i}"/>`).join('')}</ReportItems></Body></ReportSection></ReportSections></Report>`;
  const syntax = parse({ uri: 'test:budget', source, version: 1, eol: '\n' });
  const result = projectNavigation(syntax, projectReport(syntax));
  assert.equal(result.structure.nodes.length, 1000);
  assert.equal(result.data.nodes.length, 1000);
  assert.equal(result.structure.truncated, true);
  assert.equal(result.data.truncated, true);
  const withoutData = parse({
    uri: 'test:budget',
    source: source.replace(/<DataSets>.*<\/DataSets>/, ''),
    version: 1,
    eol: '\n',
  });
  assert.equal(
    projectNavigation(withoutData, projectReport(withoutData)).structure.nodes
      .length,
    1504,
  );
});
