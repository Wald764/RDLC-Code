import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ActionOutcomeMessage,
  HostMessage,
} from '@rdlc/report-model/protocol';
import { validateMessage } from '@rdlc/report-model/protocol';
import type {
  AuthoringIntent,
  LayoutIntent,
  TextboxProperty,
} from '@rdlc/report-model/editing';
import type { ReportProjection } from '@rdlc/report-model/report';
import { toPoints } from '@rdlc/report-model/geometry';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import { history, until } from './session-checks.js';

type EditResult = Extract<HostMessage, { kind: 'editResult' }>;

/** One accepted operation resolved against the current projection of the document. */
interface Context {
  readonly report: ReportProjection;
  readonly root: string;
  readonly box: (name: string) => string;
  readonly table: () => string;
  readonly dataset: (name: string) => string;
}

type EditBody =
  | {
      readonly targetId: string;
      readonly operation: 'setProperty';
      readonly payload: {
        readonly property: TextboxProperty;
        readonly value: string;
      };
    }
  | {
      readonly targetId: string;
      readonly operation: 'author';
      readonly payload: AuthoringIntent['payload'];
    }
  | { readonly operation: 'layout'; readonly payload: LayoutIntent['payload'] };

function contextOf(report: ReportProjection, root: string): Context {
  const box = (name: string) => {
    const found = report.textboxes.find((textbox) => textbox.name === name);
    assert.ok(found, `textbox ${name}`);
    return found.node.id;
  };
  const table = () => {
    const found = report.tables[0];
    assert.ok(found, 'report table');
    return found.node.id;
  };
  const dataset = (name: string) => {
    const found = report.datasets.find((entry) => entry.name === name);
    assert.ok(found, `dataset ${name}`);
    return found.node.id;
  };
  return { report, root, box, table, dataset };
}

/**
 * Twenty mixed accepted operations: textbox, page, data, table and layout
 * intents, each dispatched as a typed edit through the real session.
 */
const steps: ((context: Context) => EditBody)[] = [
  (c) => ({
    targetId: c.box('Front'),
    operation: 'setProperty',
    payload: { property: 'text', value: 'Front updated' },
  }),
  (c) => ({
    targetId: c.box('Front'),
    operation: 'setProperty',
    payload: { property: 'left', value: '16pt' },
  }),
  (c) => ({
    targetId: c.box('Behind'),
    operation: 'setProperty',
    payload: { property: 'name', value: 'Rear' },
  }),
  (c) => ({
    targetId: c.box('LaterTie'),
    operation: 'setProperty',
    payload: { property: 'height', value: '40pt' },
  }),
  (c) => ({
    targetId: c.box('Front'),
    operation: 'setProperty',
    payload: { property: 'fontSize', value: '14pt' },
  }),
  (c) => ({
    targetId: c.root,
    operation: 'author',
    payload: { action: 'createTextbox', left: '1in', top: '3in' },
  }),
  (c) => ({
    targetId: c.root,
    operation: 'author',
    payload: { action: 'setPage', property: 'bodyHeight', value: '5in' },
  }),
  (c) => ({
    targetId: c.root,
    operation: 'author',
    payload: { action: 'createDataset' },
  }),
  (c) => ({
    targetId: c.dataset('DataSet1'),
    operation: 'author',
    payload: { action: 'createField', name: 'Region', type: 'text' },
  }),
  (c) => ({
    targetId: c.root,
    operation: 'author',
    payload: { action: 'createTable', left: '2in', top: '3in' },
  }),
  (c) => ({
    targetId: c.table(),
    operation: 'author',
    payload: { action: 'setRowHeight', row: '0', height: '30pt' },
  }),
  (c) => ({
    targetId: c.table(),
    operation: 'author',
    payload: { action: 'addColumn', field: 'Label', width: '1in' },
  }),
  (c) => ({
    targetId: c.table(),
    operation: 'author',
    payload: { action: 'setColumnWidth', column: '0', width: '80pt' },
  }),
  (c) => ({
    targetId: c.table(),
    operation: 'author',
    payload: {
      action: 'addGroup',
      name: 'ByRegion',
      expression: '=Fields!Amount.Value',
    },
  }),
  (c) => ({
    targetId: c.table(),
    operation: 'author',
    payload: {
      action: 'addTotal',
      field: 'Amount',
      scope: 'ByRegion',
      column: '1',
    },
  }),
  (c) => ({
    targetId: c.table(),
    operation: 'author',
    payload: { action: 'setTableProperty', property: 'left', value: '20pt' },
  }),
  (c) => ({
    operation: 'layout',
    payload: {
      action: 'move',
      targetIds: [c.box('Front'), c.box('LaterTie')],
      unit: 'pt',
      dxPt: 9,
      dyPt: 7,
    },
  }),
  (c) => {
    const bounds = c.report.textboxes.find(
      (entry) => entry.name === 'Front',
    )!.bounds;
    const right = (toPoints(bounds.left) ?? 0) + (toPoints(bounds.width) ?? 0);
    return {
      operation: 'layout',
      payload: {
        action: 'resize',
        targetIds: [c.box('Front')],
        unit: 'pt',
        handle: 'e',
        xPt: right + 6,
      },
    };
  },
  (c) => ({
    operation: 'layout',
    payload: {
      action: 'align',
      targetIds: [c.box('Front'), c.box('LaterTie'), c.table()],
      unit: 'pt',
      mode: 'left',
      primaryId: c.box('LaterTie'),
    },
  }),
  (c) => ({
    operation: 'layout',
    payload: {
      action: 'align',
      targetIds: [c.box('Front'), c.box('LaterTie'), c.table()],
      unit: 'pt',
      mode: 'top',
      primaryId: c.box('Front'),
    },
  }),
];

export async function run(): Promise<void> {
  await sidebarHistory();
}

/**
 * T054: twenty mixed accepted operations on a real host TextDocument, each
 * individually undone and redone to its exact recorded state. Navigation,
 * invalid-protocol, refused, no-op and cancelled actions create no dirty
 * state and no history entry, and uncertain requests refuse without any
 * compensating edit.
 */
async function sidebarHistory(): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../tests/fixtures/manifest.json'),
      'utf8',
    ),
  ) as { fixtures: readonly { readonly path: string }[] };
  assert.ok(
    manifest.fixtures.some(
      (fixture) => fixture.path === 'interactive/mixed.rdlc',
    ),
    'the history fixture is manifest-listed',
  );
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-sidebar-history-')),
    'report.rdlc',
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);

  // Navigation routes to the source-reveal boundary; the test observes it without opening another editor.
  let navigations = 0;
  const session = new DocumentSession(
    document,
    undefined,
    undefined,
    undefined,
    async (uri) => {
      assert.equal(uri.toString(), document.uri.toString());
      navigations++;
    },
  );
  const messages: HostMessage[] = [];
  const outcomes: ActionOutcomeMessage[] = [];
  const listeners = [
    session.onMessage((message) => messages.push(message)),
    session.onActionOutcome((outcome) => outcomes.push(outcome)),
  ];
  const eol = () =>
    document.eol === vscode.EndOfLine.CRLF
      ? ('\r\n' as const)
      : ('\n' as const);
  /** Fresh parse: node IDs and versions are scoped to the current document text. */
  const context = (): Context => {
    const syntax = parse({
      uri: document.uri.toString(),
      version: document.version,
      source: document.getText(),
      eol: eol(),
    });
    const root = syntax.root;
    assert.ok(root, 'editable report parses a root');
    return contextOf(projectReport(syntax), root.id);
  };
  try {
    assert.ok(
      session.setViewIdentity({
        viewId: 'history-view',
        documentLifetimeId: 'history-life',
        contextGeneration: 0,
      }),
      'the host binds one designer view for this document',
    );
    session.receive({ protocol: 2, kind: 'ready' });
    await until(() => session.isReady, 'sidebar history handshake');

    const errorCount = () =>
      messages.filter((message) => message.kind === 'protocolError').length;
    const results = () =>
      messages.filter((message) => message.kind === 'editResult').length;
    let sequence = 0;
    /** Navigation and refused, no-op and cancelled requests change nothing. */
    const inert = async (label: string): Promise<void> => {
      const text = document.getText();
      const version = document.version;
      const dirty = document.isDirty;
      const navigated = navigations;
      const settled = outcomes.length;
      const errors = errorCount();
      const editResults = results();
      const root = context();
      const bodyItem = root.report.textboxes.find(
        (textbox) => textbox.context === 'body',
      );
      assert.ok(bodyItem, `${label}: body item for a no-op move`);

      // Navigation: Code XML reveal settles before anything else runs.
      session.receive({
        protocol: 2,
        kind: 'openSource',
        version,
        targetId: root.root,
      });
      await until(
        () => navigations === navigated + 1,
        `${label}: source navigation reaches the reveal boundary`,
      );
      // Navigation: the accepted selection settles designer state only.
      sequence++;
      session.receive({
        protocol: 2,
        kind: 'acceptedSelection',
        version,
        viewId: 'history-view',
        sequence,
        selection: { mode: 'empty' },
      });
      assert.equal(
        session.currentSelection?.sequence,
        sequence,
        `${label}: accepted selection recorded`,
      );
      // These forged messages prove closed-protocol refusal, not native filter/expansion behavior.
      session.receive({ protocol: 2, kind: 'filter', query: 'textbox' });
      session.receive({ protocol: 2, kind: 'expand', targetId: root.root });
      // Refused: a capable target with an authored value that violates its rules.
      session.receive({
        protocol: 2,
        kind: 'edit',
        requestId: `${label}-refused`,
        baseVersion: version,
        targetId: root.root,
        operation: 'author',
        payload: { action: 'createTextbox', left: '-1in', top: '0in' },
      });
      // Uncertainty: stale and foreign requests refuse before any plan exists.
      session.receive({
        protocol: 2,
        kind: 'edit',
        requestId: `${label}-stale`,
        baseVersion: version - 1,
        targetId: root.root,
        operation: 'setProperty',
        payload: { property: 'text', value: 'stale' },
      });
      session.receive({
        protocol: 2,
        kind: 'edit',
        requestId: `${label}-foreign`,
        baseVersion: version,
        targetId: '999:9999',
        operation: 'setProperty',
        payload: { property: 'text', value: 'foreign' },
      });
      // No-op: an accepted zero-distance move.
      session.receive({
        protocol: 2,
        kind: 'edit',
        requestId: `${label}-noop`,
        baseVersion: version,
        operation: 'layout',
        payload: {
          action: 'move',
          targetIds: [bodyItem.node.id],
          unit: 'pt',
          dxPt: 0,
          dyPt: 0,
        },
      });
      // Cancelled: a captured native action settles once without a mutation.
      const cancelId = `${label}-cancel`;
      const delivery = await session.dispatchNativeAction(
        {
          protocol: 2,
          kind: 'nativeAction',
          requestId: cancelId,
          documentLifetimeId: 'history-life',
          uri: document.uri.toString(),
          baseVersion: version,
          viewId: 'history-view',
          contextGeneration: 0,
          capability: 'select',
          action: 'select',
          targetIds: [root.root],
          primaryId: root.root,
          additive: false,
        },
        () => true,
        async () => true,
      );
      assert.ok(delivery.delivered, `${label}: native action delivered once`);
      session.receive({
        protocol: 2,
        kind: 'actionOutcome',
        requestId: cancelId,
        baseVersion: version,
        resultVersion: version,
        status: 'cancelled',
        reason: 'The user dismissed the action.',
        selectionSequence: sequence,
      });

      await until(
        () =>
          results() >= editResults + 2 &&
          errorCount() >= errors + 4 &&
          outcomes.length >= settled + 1,
        `${label}: inert actions settle`,
      );
      assert.equal(outcomes.at(-1)?.status, 'cancelled', label);
      assert.equal(
        errorCount(),
        errors + 4,
        `${label}: closed protocol refusals`,
      );
      assert.equal(
        document.getText(),
        text,
        `${label}: navigation, filter, expansion, refusal, no-op and cancellation never change text`,
      );
      assert.equal(document.version, version, `${label}: no version change`);
      assert.equal(document.isDirty, dirty, `${label}: no dirty state`);
    };

    let count = 0;
    const edit = async (body: EditBody): Promise<EditResult> => {
      const requestId = `history-${++count}`;
      session.receive({
        protocol: 2,
        kind: 'edit',
        requestId,
        baseVersion: document.version,
        ...body,
      });
      await until(
        () =>
          messages.some(
            (message) =>
              message.kind === 'editResult' && message.requestId === requestId,
          ),
        requestId,
      );
      const result = messages.find(
        (message): message is EditResult =>
          message.kind === 'editResult' && message.requestId === requestId,
      );
      assert.ok(result, requestId);
      assert.ok(
        validateMessage(result),
        `${requestId}: result satisfies the shared protocol`,
      );
      return result;
    };

    const states: string[] = [document.getText()];
    assert.equal(states[0], source, 'the manifest fixture opens unchanged');
    for (const [index, step] of steps.entries()) {
      const result = await edit(step(context()));
      assert.ok(
        result.accepted && result.changed,
        `step ${index + 1}: ${result.reason}`,
      );
      states.push(document.getText());
      assert.notEqual(
        states[index + 1],
        states[index],
        `step ${index + 1} changed the document`,
      );
      if (index === 9) await inert('mid-sequence');
    }
    assert.equal(
      states.length,
      21,
      'twenty accepted states plus the opening source',
    );
    assert.equal(
      new Set(states).size,
      21,
      'no two recorded states are identical',
    );
    assert.equal(
      messages.filter(
        (message) =>
          message.kind === 'editResult' && message.accepted && message.changed,
      ).length,
      20,
      'twenty accepted mutating operations',
    );
    assert.equal(
      document.isDirty,
      true,
      'accepted operations dirty the document',
    );

    await vscode.window.showTextDocument(document);
    for (let index = 19; index >= 0; index--) {
      await history(document, 'undo', states[index]!);
      assert.equal(
        document.getText(),
        states[index],
        `Undo ${index + 1} restores state ${index}`,
      );
    }
    assert.equal(
      document.isDirty,
      false,
      'twenty Undos reach the file on disk',
    );

    // At the clean state the inert battery still creates no dirty state and no history.
    await inert('clean');
    const version = document.version;
    await vscode.commands.executeCommand('undo');
    assert.equal(
      document.getText(),
      states[0],
      'nothing is left to undo after the inert battery',
    );
    assert.equal(
      document.version,
      version,
      'the inert battery created no undo entry',
    );
    assert.equal(document.isDirty, false);

    await vscode.window.showTextDocument(document);
    for (let index = 1; index <= 20; index++) {
      await history(document, 'redo', states[index]!);
      assert.equal(
        document.getText(),
        states[index],
        `Redo ${index} restores state ${index}`,
      );
    }
    assert.equal(await document.save(), true);
    assert.equal(
      readFileSync(file, 'utf8'),
      states[20],
      'saved XML equals state 20',
    );
  } finally {
    for (const listener of listeners) listener.dispose();
    session.dispose();
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}
