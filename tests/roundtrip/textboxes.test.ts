import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport, RDL_2016 } from '@rdlc/xml-parser/project-report';
import { applyPlan } from '@rdlc/xml-serializer/patches';
import { planTextboxProperty } from '@rdlc/xml-serializer/textboxes';

const snapshotOf = (source: string, version = 1) => ({
  uri: 'fixture:textboxes',
  version,
  source,
  eol: '\n' as const,
});

function scopesOf(
  syntax: XmlSyntaxDocument,
): Record<string, Readonly<Record<string, string>>> {
  const scopes: Record<string, Readonly<Record<string, string>>> = {};
  const visit = (node: XmlNode) => {
    scopes[node.id] = node.namespaces;
    for (const child of node.children) visit(child);
  };
  if (syntax.root) visit(syntax.root);
  return scopes;
}

function apply(source: string, plan: PatchPlan): string {
  const snapshot = snapshotOf(source, plan.version);
  return applyPlan(snapshot, plan, scopesOf(parse(snapshot)));
}

/** Every authored plan here is one patch; the candidate must differ only there. */
function assertSinglePatch(source: string, plan: PatchPlan, candidate: string) {
  assert.equal(plan.patches.length, 1);
  const patch = plan.patches[0]!;
  assert.equal(
    candidate,
    source.slice(0, patch.start) + patch.replacement + source.slice(patch.end),
  );
}

const supported = readFileSync(
  'tests/fixtures/textboxes/supported.rdlc',
  'utf8',
);
const projectSupported = () => {
  const snapshot = snapshotOf(supported);
  const syntax = parse(snapshot);
  return { snapshot, syntax, projection: projectReport(syntax) };
};

test('an empty plan keeps the fixture byte-exact', () => {
  assert.equal(
    applyPlan(
      snapshotOf(supported),
      { version: 1, patches: [], footprint: [], namespaceDependencies: [] },
      {},
    ),
    supported,
  );
});

test('authored text is XML-escaped while foreign attributes, children and bindings stay in place', () => {
  const { snapshot, projection } = projectSupported();
  const textbox = projection.textboxes[0]!;
  const plan = planTextboxProperty({
    snapshot,
    textbox,
    property: 'text',
    value: 'Goodbye <world> & "friends"',
  });
  const candidate = apply(supported, plan);
  assertSinglePatch(supported, plan, candidate);
  assert.ok(candidate.includes('Goodbye &lt;world&gt; &amp; "friends"'));
  assert.ok(candidate.includes('rd:DefaultName="Title"'));
  assert.ok(candidate.includes('<x:Opaque keep="1">preserve</x:Opaque>'));
  assert.ok(candidate.includes('xmlns:x="urn:rdlc-code:extension"'));
  assert.equal(
    projectReport(parse({ ...snapshot, source: candidate })).textboxes[0]!
      .value!.text,
    'Goodbye <world> & "friends"',
  );
});

test('renaming patches only the Name attribute and surfaces the new value', () => {
  const { snapshot, projection } = projectSupported();
  const plan = planTextboxProperty({
    snapshot,
    textbox: projection.textboxes[0]!,
    property: 'name',
    value: 'Heading',
  });
  const candidate = apply(supported, plan);
  assertSinglePatch(supported, plan, candidate);
  assert.ok(candidate.includes('Name="Heading"'));
  assert.equal(
    projectReport(parse({ ...snapshot, source: candidate })).textboxes[0]!.name,
    'Heading',
  );
});

test('a missing style property is inserted inside the existing Style element', () => {
  const { snapshot, projection } = projectSupported();
  const plan = planTextboxProperty({
    snapshot,
    textbox: projection.textboxes[0]!,
    property: 'color',
    value: '#112233',
  });
  const candidate = apply(supported, plan);
  assertSinglePatch(supported, plan, candidate);
  assert.ok(candidate.includes('<Color>#112233</Color>'));
  assert.equal(
    projectReport(parse({ ...snapshot, source: candidate })).textboxes[0]!.style
      .color,
    '#112233',
  );
});

test('a missing textbox property is inserted using version-specific ordering', () => {
  const inline = `<Report xmlns="${RDL_2016}"><ReportSections><ReportSection><Body><ReportItems><Textbox Name="T"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Hi</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></ReportItems><Height>2in</Height></Body><Width>6in</Width><Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth></Page></ReportSection></ReportSections></Report>`;
  const snapshot = snapshotOf(inline);
  const syntax = parse(snapshot);
  const textbox = projectReport(syntax).textboxes[0]!;
  const plan = planTextboxProperty({
    snapshot,
    textbox,
    property: 'width',
    value: '2in',
  });
  assert.deepEqual(plan.namespaceDependencies, [
    { nodeId: textbox.node.id, prefix: '', uri: RDL_2016 },
  ]);
  const candidate = apply(inline, plan);
  assertSinglePatch(inline, plan, candidate);
  assert.ok(candidate.includes('<Width>2in</Width><Paragraphs>'));
  assert.equal(parse({ ...snapshot, source: candidate }).status, 'valid');
  assert.equal(
    projectReport(parse({ ...snapshot, source: candidate })).textboxes[0]!
      .bounds.width,
    '2in',
  );
});

test('controlled edits refuse to rewrite rich text or expression geometry', () => {
  const opaque = readFileSync(
    'tests/fixtures/textboxes/supported-plus-opaque.rdlc',
    'utf8',
  );
  const snapshot = snapshotOf(opaque);
  const projection = projectReport(parse(snapshot));
  const rich = projection.textboxes.find((textbox) => textbox.name === 'Rich')!;
  const dynamic = projection.textboxes.find(
    (textbox) => textbox.name === 'Dynamic',
  )!;
  assert.throws(() =>
    planTextboxProperty({
      snapshot,
      textbox: rich,
      property: 'text',
      value: 'x',
    }),
  );
  // Expression geometry is blocked by the capability gate, not silently rewritten.
  assert.ok(!dynamic.capabilities.includes('width'));
});
