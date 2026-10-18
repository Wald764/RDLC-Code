import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from './patches.js';
import type { PatchPlan } from '@rdlc/report-model/editing';
import { patchPlan, sourcePatch, composePlans } from './structure.js';
import { planTextboxProperty } from './textboxes.js';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { RDL_2016 } from '@rdlc/report-model/report';

const source = '<a>😀old</a>';
const snapshot = {
  uri: 'fixture:patch',
  version: 2,
  source,
  eol: '\n' as const,
};
const plan: PatchPlan = {
  version: 2,
  footprint: [{ start: 5, end: 8 }],
  namespaceDependencies: [],
  patches: [
    {
      version: 2,
      start: 5,
      end: 8,
      expected: 'old',
      replacement: 'new &amp; safe',
    },
  ],
};
test('applies only sorted declared UTF-16 footprints without regenerating source', () => {
  assert.equal(applyPlan(snapshot, plan, {}), '<a>😀new &amp; safe</a>');
  assert.equal(applyPlan(snapshot, { ...plan, patches: [] }, {}), source);
});

test('compound insertion normalization preserves caller order and namespace unions', () => {
  const dependency = { nodeId: '2:1', prefix: 'p', uri: 'required' };
  const a = patchPlan(
    snapshot,
    [sourcePatch(snapshot, { start: 5, end: 5 }, '<p:Left>1pt</p:Left>')],
    [dependency],
  );
  const b = patchPlan(
    snapshot,
    [sourcePatch(snapshot, { start: 5, end: 5 }, '<p:Width>2pt</p:Width>')],
    [{ ...dependency, nodeId: '2:2' }],
  );
  const composed = composePlans(snapshot, [a, b]);
  assert.equal(composed.patches.length, 1);
  assert.equal(composed.namespaceDependencies.length, 2);
  assert.equal(
    applyPlan(snapshot, composed, {
      '2:1': { p: 'required' },
      '2:2': { p: 'required' },
    }),
    '<a>😀<p:Left>1pt</p:Left><p:Width>2pt</p:Width>old</a>',
  );
  assert.throws(() =>
    applyPlan(snapshot, composed, { '2:1': { p: 'required' } }),
  );
  assert.throws(() => composePlans(snapshot, [{ ...a, version: 1 }]));
  assert.throws(() =>
    patchPlan(snapshot, [
      plan.patches[0]!,
      { ...plan.patches[0]!, start: 6, expected: 'ld' },
    ]),
  );
  assert.throws(() =>
    composePlans(snapshot, [
      a,
      { ...b, namespaceDependencies: [{ ...dependency, uri: 'different' }] },
    ]),
  );
  const unchanged = patchPlan(snapshot, [
    sourcePatch(snapshot, { start: 5, end: 8 }, 'old'),
  ]);
  assert.equal(unchanged.patches.length, 0);
  assert.equal(applyPlan(snapshot, unchanged, {}), source);
});

test('several absent textbox properties compose at one offset without losing lexical source or namespace proof', () => {
  const source = `<r:Report xmlns:r="${RDL_2016}"><r:ReportSections><r:ReportSection><r:Body><r:ReportItems><r:Textbox Name='A'><!--keep--><r:Paragraphs><r:Paragraph><r:TextRuns><r:TextRun><r:Value><![CDATA[A&B]]></r:Value></r:TextRun></r:TextRuns></r:Paragraph></r:Paragraphs></r:Textbox></r:ReportItems><r:Height>2in</r:Height></r:Body><r:Width>6in</r:Width><r:Page/></r:ReportSection></r:ReportSections></r:Report>`;
  const snapshot = {
    uri: 'test:compound',
    version: 2,
    source,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const textbox = projectReport(syntax).textboxes[0]!;
  const plans = (['top', 'left', 'height', 'width'] as const).map((property) =>
    planTextboxProperty({ snapshot, textbox, property, value: '1pt' }),
  );
  const plan = composePlans(snapshot, plans);
  assert.equal(plan.patches.length, 1);
  assert.deepEqual(plan.namespaceDependencies, [
    { nodeId: textbox.node.id, prefix: 'r', uri: RDL_2016 },
  ]);
  assert.throws(() => applyPlan(snapshot, plan, {}));
  const result = applyPlan(snapshot, plan, {
    [textbox.node.id]: textbox.node.namespaces,
  });
  assert.equal(
    result,
    source.replace(
      '<r:Paragraphs>',
      '<r:Top>1pt</r:Top><r:Left>1pt</r:Left><r:Height>1pt</r:Height><r:Width>1pt</r:Width><r:Paragraphs>',
    ),
  );
  assert.equal(
    projectReport(parse({ ...snapshot, source: result })).textboxes[0]?.value
      ?.text,
    'A&B',
  );
});
test('rejects stale, overlapping, out-of-footprint, changed expected text, invalid ranges and namespaces', () => {
  for (const bad of [
    { ...plan, version: 1 },
    { ...plan, patches: [plan.patches[0]!, plan.patches[0]!] },
    { ...plan, footprint: [] },
    { ...plan, patches: [{ ...plan.patches[0]!, expected: 'bad' }] },
    { ...plan, patches: [{ ...plan.patches[0]!, start: 5.1 }] },
    { ...plan, patches: [{ ...plan.patches[0]!, start: -1 }] },
    { ...plan, patches: [{ ...plan.patches[0]!, version: 1 }] },
    {
      ...plan,
      namespaceDependencies: [{ nodeId: '2:1', prefix: 'p', uri: 'required' }],
    },
  ])
    assert.throws(() => applyPlan(snapshot, bad, {}));
});
