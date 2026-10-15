import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser.js';
import { projectReport, RDL_2016 } from './project-report.js';

const section =
  '<ReportSection><Body><Height>2in</Height></Body><Width>6in</Width><Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth></Page></ReportSection>';
const project = (source: string) =>
  projectReport(parse({ uri: 'fixture:test', version: 3, source, eol: '\n' }));
test('RDL 2016 section owns width; foreign XML is preserved in place', () => {
  const source = `<Report xmlns="${RDL_2016}" xmlns:x="urn:x"><Width>99in</Width><ReportSections>${section}</ReportSections><x:Unknown value="opaque"/></Report>`;
  const result = project(source);
  assert.equal(result.status, 'editable');
  assert.equal(result.section?.width, '6in');
  assert.equal(result.section?.height, '2in');
  assert.ok(
    result.preserved.some((p) =>
      source.slice(p.range.start, p.range.end).includes('x:Unknown'),
    ),
  );

  assert.equal(result.section?.page?.width, '8.5in');
});
test('an empty MustUnderstand list does not invent a required default prefix', () => {
  const prefixedSection = section.replace(/(<\/?)/g, '$1r:');
  assert.equal(
    project(
      `<r:Report xmlns:r="${RDL_2016}" MustUnderstand=" "><r:ReportSections>${prefixedSection}</r:ReportSections></r:Report>`,
    ).status,
    'editable',
  );
});
test('wrong namespace/root, missing/duplicate sections and unknown required semantics remain source-only', () => {
  for (const source of [
    `<Report xmlns="old"><ReportSections>${section}</ReportSections></Report>`,
    `<Other xmlns="${RDL_2016}"/>`,
    `<Report xmlns="${RDL_2016}"/>`,
    `<Report xmlns="${RDL_2016}"><ReportSections>${section}${section}</ReportSections></Report>`,
    `<Report xmlns="${RDL_2016}" xmlns:x="urn:required" MustUnderstand="x"><ReportSections>${section}</ReportSections></Report>`,
    `<Report xmlns="${RDL_2016}" MustUnderstand="missing"><ReportSections>${section}</ReportSections></Report>`,
  ])
    assert.equal(project(source).status, 'source-only', source);
  assert.equal(project('<Report>').status, 'invalid-source');
});
