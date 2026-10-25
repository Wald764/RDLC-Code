import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStructure } from '@rdlc/renderer/structure';
import { validateMessage } from '@rdlc/report-model/protocol';
import { evaluateReport, type ReportEvaluation } from './report-evaluation.js';

const namespace =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const page =
  '<Page><PageWidth>8.5in</PageWidth><PageHeight>11in</PageHeight>' +
  '<TopMargin>0in</TopMargin><RightMargin>0in</RightMargin>' +
  '<BottomMargin>0in</BottomMargin><LeftMargin>0in</LeftMargin></Page>';

/** Budget documents are generated in memory and stay bounded; nothing huge is committed. */
const report = (inner: string): string =>
  `<Report xmlns="${namespace}">${inner}</Report>`;
const dataSets = (count: number, withField: boolean): string =>
  `<DataSets>${Array.from({ length: count }, (_, index) =>
    withField
      ? `<DataSet Name="D${index}"><Fields><Field Name="F${index}"><DataField>F${index}</DataField></Field></Fields></DataSet>`
      : `<DataSet Name="D${index}"/>`,
  ).join('')}</DataSets>`;
const body = (items: string): string =>
  `<ReportSections><ReportSection><Width>8.5in</Width>${page}` +
  `<Body><Height>11in</Height>${items}</Body></ReportSection></ReportSections>`;
const textboxes = (count: number): string =>
  `<ReportItems>${Array.from(
    { length: count },
    (_, index) => `<Textbox Name="T${index}"/>`,
  ).join('')}</ReportItems>`;
const nestedRectangles = (count: number): string => {
  let items = '';
  for (let index = count - 1; index >= 0; index -= 1)
    items = `<Rectangle Name="R${index}"><ReportItems>${items}</ReportItems></Rectangle>`;
  return report(body(`<ReportItems>${items}</ReportItems>`));
};

const evaluate = (source: string): ReportEvaluation =>
  evaluateReport({
    uri: 'test:navigation-budget',
    version: 1,
    source,
    eol: '\n',
  });

interface Entry {
  readonly id: string;
  readonly parentId: string | null;
}

/** No missing parent: a truncated prefix must stay a usable prefix. */
function assertParentClosed(label: string, nodes: readonly Entry[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    assert.ok(
      node.parentId === null || seen.has(node.parentId),
      `${label} keeps a parent-before-child prefix`,
    );
    seen.add(node.id);
  }
}

function assertAuthored(
  label: string,
  evaluation: ReportEvaluation,
  nodes: readonly Entry[],
): void {
  const sourceIds = new Set(evaluation.sourceIds);
  for (const node of nodes)
    assert.ok(
      sourceIds.has(node.id),
      `${label} emits only parsed source nodes`,
    );
}

function depthOf(nodes: readonly Entry[]): number {
  const depths = new Map<string, number>();
  let deepest = 0;
  for (const node of nodes) {
    const depth =
      node.parentId === null ? 1 : (depths.get(node.parentId) ?? 99) + 1;
    depths.set(node.id, depth);
    if (depth > deepest) deepest = depth;
  }
  return deepest;
}

const envelopeOf = (evaluation: ReportEvaluation) => ({
  protocol: 2,
  kind: 'snapshot',
  version: evaluation.snapshot.version,
  sourceLength: evaluation.snapshot.source.length,
  projection: {
    status: evaluation.projection.status,
    capabilities: evaluation.projection.capabilities,
    diagnostics: evaluation.projection.diagnostics,
  },
  structure: projectStructure(evaluation.syntax, evaluation.projection),
  navigation: evaluation.navigation,
  scene: evaluation.scene,
  authoring: null,
});

const envelopeSize = (message: ReturnType<typeof envelopeOf>): number =>
  message.structure.nodes.length +
  message.navigation.structure.nodes.length +
  message.navigation.data.nodes.length;

test('the protocol rejects individually bounded projections exceeding the shared envelope', () => {
  // Both Structure projections retain only report hierarchy after the Data migration.
  const evaluation = evaluate(report(dataSets(1200, true) + body('')));
  const message = envelopeOf(evaluation);

  assert.equal(message.structure.nodes.length, 4);
  assert.equal(message.structure.truncated, false);
  // Navigation Structure only emits four entries here, so Data transfers their
  // unused share into its own budget instead of stopping at 1,000.
  assert.equal(message.navigation.structure.nodes.length, 4);
  assert.equal(message.navigation.structure.truncated, false);
  assert.equal(message.navigation.data.nodes.length, 1996);
  assert.equal(message.navigation.data.truncated, true);
  assert.equal(envelopeSize(message), 2004);
  assert.equal(
    validateMessage(message),
    null,
    'the shared envelope rejects an untrimmed snapshot',
  );

  for (const projection of [
    message.structure,
    message.navigation.structure,
    message.navigation.data,
  ]) {
    assertParentClosed('untrimmed projection', projection.nodes);
    assertAuthored('untrimmed projection', evaluation, projection.nodes);
  }
});

test('the fair initial split spends 1,000 entries each and transfers unused capacity', () => {
  const both = evaluate(report(dataSets(1500, false) + body(textboxes(1500))));
  assert.deepEqual(
    [both.navigation.structure.nodes.length, both.navigation.data.nodes.length],
    [1000, 1000],
  );
  assert.equal(both.navigation.structure.truncated, true);
  assert.equal(both.navigation.data.truncated, true);
  assert.equal(envelopeOf(both).structure.nodes.length, 1504);

  // Without data definitions the whole envelope moves to Structure.
  const structureOnly = evaluate(report(body(textboxes(1500))));
  const free = envelopeOf(structureOnly);
  assert.equal(free.navigation.structure.nodes.length, 1504);
  assert.equal(free.navigation.structure.truncated, false);
  assert.equal(free.navigation.data.nodes.length, 0);
  assert.equal(free.navigation.data.truncated, false);
  assert.equal(free.structure.nodes.length, 1504);
  assert.equal(free.structure.truncated, false);

  for (const evaluation of [both, structureOnly]) {
    for (const [label, nodes] of [
      ['structure', evaluation.navigation.structure.nodes],
      ['data', evaluation.navigation.data.nodes],
    ] as const) {
      assertParentClosed(label, nodes);
      assertAuthored(label, evaluation, nodes);
    }
  }
  assert.ok(
    depthOf(structureOnly.navigation.structure.nodes) <= 32,
    'every emitted chain fits 32 levels',
  );
});

test('both projections stop at 32 emitted levels and say so per projection', () => {
  const evaluation = evaluate(nestedRectangles(40));
  const structure = projectStructure(evaluation.syntax, evaluation.projection);

  assert.equal(structure.nodes.length, 32);
  assert.equal(structure.truncated, true);
  assert.equal(depthOf(structure.nodes), 32);

  const navigation = evaluation.navigation.structure;
  assert.equal(navigation.nodes.length, 32);
  assert.equal(navigation.truncated, true);
  assert.equal(depthOf(navigation.nodes), 32);

  // The Data projection is untouched by the depth limit and reports its own state.
  assert.equal(evaluation.navigation.data.nodes.length, 0);
  assert.equal(evaluation.navigation.data.truncated, false);

  for (const [label, projection] of [
    ['structure', structure],
    ['navigation', navigation],
  ] as const) {
    assertParentClosed(label, projection.nodes);
    assertAuthored(label, evaluation, projection.nodes);
  }
  assert.ok(
    validateMessage(envelopeOf(evaluation)),
    'a depth-limited snapshot still validates as a whole',
  );
});
