import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { validateMessage } from '@rdlc/report-model/protocol';
import { projectStructure } from '@rdlc/renderer/structure';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';

type Snapshot = Extract<HostMessage, { kind: 'snapshot' }>;

const namespace =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const page =
  '<Page><PageWidth>8.5in</PageWidth><PageHeight>11in</PageHeight>' +
  '<TopMargin>0in</TopMargin><RightMargin>0in</RightMargin>' +
  '<BottomMargin>0in</BottomMargin><LeftMargin>0in</LeftMargin></Page>';

/** Generated in memory and bounded; these budgets never commit a huge fixture. */
const report = (inner: string): string =>
  `<Report xmlns="${namespace}">${inner}</Report>`;
const dataSets = (count: number): string =>
  `<DataSets>${Array.from(
    { length: count },
    (_, index) =>
      `<DataSet Name="D${index}"><Fields><Field Name="F${index}"><DataField>F${index}</DataField></Field></Fields></DataSet>`,
  ).join('')}</DataSets>`;
const body = (items: string): string =>
  `<ReportSections><ReportSection><Width>8.5in</Width>${page}` +
  `<Body><Height>11in</Height>${items}</Body></ReportSection></ReportSections>`;
const textboxes = (count: number): string =>
  `<ReportItems>${Array.from(
    { length: count },
    (_, index) => `<Textbox Name="T${index}"/>`,
  ).join('')}</ReportItems>`;

const delay = (milliseconds: number) =>
  new Promise((done) => setTimeout(done, milliseconds));
const waitFor = async (predicate: () => boolean, label: string) => {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}`);
    await delay(25);
  }
};

interface Opened {
  readonly document: vscode.TextDocument;
  readonly session: DocumentSession;
  readonly subscription: vscode.Disposable;
  readonly snapshot: Snapshot;
}

/** The real host session over a real document: no transport double is involved. */
async function publish(label: string, source: string): Promise<Opened> {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-code-us2-'));
  const file = join(directory, `${label}.rdlc`);
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(file),
  );
  const session = new DocumentSession(document);
  const messages: HostMessage[] = [];
  const subscription = session.onMessage((message) => messages.push(message));
  session.receive({ protocol: 2, kind: 'ready' });
  await waitFor(
    () => messages.some((message) => message.kind === 'snapshot'),
    `${label} snapshot`,
  );
  const snapshot = messages.find(
    (message): message is Snapshot => message.kind === 'snapshot',
  )!;
  return { document, session, subscription, snapshot };
}

function assertParentClosed(
  label: string,
  nodes: readonly { id: string; parentId: string | null }[],
): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    assert.ok(
      node.parentId === null || seen.has(node.parentId),
      `${label} keeps a parent-before-child prefix`,
    );
    seen.add(node.id);
  }
}

export async function run(): Promise<void> {
  const opened: Opened[] = [];
  try {
    // A report whose Structure, Structure navigation and Data navigation each want the
    // whole envelope: the host must trim all three together and keep scene/authoring.
    const trimming = await publish(
      'trimming',
      report(dataSets(1200) + body('')),
    );
    opened.push(trimming);
    const snapshot = trimming.snapshot;
    assert.ok(
      validateMessage(snapshot),
      'the published snapshot satisfies the shared protocol',
    );
    assert.equal(
      trimming.document.version,
      snapshot.version,
      'the snapshot reports the accepted document version',
    );
    const evaluation = trimming.session.evaluation;
    const complete = projectStructure(evaluation.syntax, evaluation.projection);
    const untrimmed =
      complete.nodes.length +
      evaluation.navigation.structure.nodes.length +
      evaluation.navigation.data.nodes.length;
    assert.ok(
      untrimmed > 2000,
      `the accepted report needs whole-envelope trimming (${untrimmed})`,
    );

    const structure = snapshot.structure!;
    const navigation = snapshot.navigation!;
    const published =
      structure.nodes.length +
      navigation.structure.nodes.length +
      navigation.data.nodes.length;
    assert.ok(
      published > 0 && published <= 2000,
      `the shared 2,000-entry envelope holds (${published})`,
    );
    assert.ok(
      structure.nodes.length < complete.nodes.length,
      'Structure yields entries to the whole-envelope trim',
    );
    assert.equal(structure.truncated, true, 'Structure states its truncation');
    assert.equal(
      navigation.structure.truncated,
      true,
      'Structure navigation states its truncation',
    );
    assert.equal(
      navigation.data.truncated,
      true,
      'Data navigation states its truncation',
    );
    assert.ok(snapshot.scene, 'the scene survives trimming');
    assert.ok(snapshot.authoring, 'authoring survives trimming');
    assertParentClosed('structure', structure.nodes);
    assertParentClosed('navigation structure', navigation.structure.nodes);
    assertParentClosed('navigation data', navigation.data.nodes);

    // A report whose scene alone exceeds the transport budget cannot be trimmed into
    // validity: the host keeps the documented source-only fallback instead.
    const falling = await publish('fallback', report(body(textboxes(2500))));
    opened.push(falling);
    const fallback = falling.snapshot;
    assert.ok(
      validateMessage(fallback),
      'the fallback snapshot satisfies the shared protocol',
    );
    assert.equal(fallback.scene, null, 'the oversized scene is not published');
    assert.equal(fallback.authoring, undefined, 'authoring follows the scene');
    assert.deepEqual(fallback.structure, { nodes: [], truncated: true });
    assert.deepEqual(fallback.navigation, {
      version: fallback.version,
      structure: { nodes: [], truncated: true },
      data: { nodes: [], truncated: true },
    });
    assert.equal(fallback.projection.status, 'source-only');
    assert.ok(
      fallback.projection.diagnostics.some(
        (diagnostic) => diagnostic.code === 'TRANSPORT_BUDGET',
      ),
      'the fallback states the transport budget it exceeded',
    );
  } finally {
    for (const entry of opened) {
      entry.subscription.dispose();
      entry.session.dispose();
    }
  }
}
