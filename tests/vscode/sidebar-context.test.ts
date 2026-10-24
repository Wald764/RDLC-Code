import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { SidebarHostContext } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import type {
  ActionOutcomeMessage,
  HostMessage,
  NativeActionMessage,
} from '@rdlc/report-model/protocol';
import { until } from './session-checks.js';

export async function run(): Promise<void> {
  const host = new SidebarHostContext();
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  const report = await vscode.workspace.openTextDocument({
    language: 'xml',
    content: source,
  });
  const session = new DocumentSession(report);
  const versions: number[] = [];
  const observation = session.onEvaluation((evaluation) =>
    versions.push(evaluation.snapshot.version),
  );
  // Untitled reports are recognized from their accepted Report syntax, not a guessed filename.
  try {
    await vscode.window.showTextDocument(report);
    const accepted = host.registry.context();
    assert.equal(accepted.state, 'editable');
    assert.equal(accepted.uri, report.uri.toString());
    assert.equal(
      accepted.viewId,
      null,
      'source inspection must not create a designer',
    );
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof vscode.TabInputCustom &&
            tab.input.uri.toString() === report.uri.toString(),
        ).length,
      0,
    );
    const captured = host.registry.capture('source-inspection', 'source', [
      host.evaluation!.sourceIds[0]!,
    ]);
    assert.ok(captured.ok);
    const authoredId = host.evaluation!.ids[0]!;
    const opaqueId = host.evaluation!.sourceIds.find(
      (id) => !host.evaluation!.ids.includes(id),
    );
    assert.ok(opaqueId, 'fixture contains syntax with source access only');
    await host.openSource(opaqueId);
    const sourceEditor = vscode.window.activeTextEditor!;
    assert.equal(sourceEditor.document.uri.toString(), report.uri.toString());
    assert.match(
      sourceEditor.document.getText(sourceEditor.selection),
      /^<ReportSections[\s>]/,
    );
    assert.equal(
      host.registry.context().viewId,
      null,
      'native Code XML does not open a designer',
    );
    const designer = vscode.window.createWebviewPanel(
      'rdlcTests.contextRegistration',
      'Context registration proof',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    );
    const association = host.register(report, designer, session);
    const viewId = host.registry.context().viewId;
    assert.ok(viewId, 'registration associates the same report designer');
    host.registry.focusView(viewId);
    assert.equal(
      host.registry.capture('author-real-target', 'author', [authoredId]).ok,
      true,
    );
    assert.deepEqual(
      host.registry.capture('author-preserved-target', 'author', [opaqueId]),
      { ok: false, reason: 'stale-target' },
    );
    const messages: HostMessage[] = [];
    assert.equal(session.isReady, false);
    const transport = session.onMessage((message) => messages.push(message));
    session.receive({ protocol: 2, kind: 'ready' });
    await until(
      () => messages.some((message) => message.kind === 'snapshot'),
      'native view handshake',
    );
    assert.equal(
      session.isReady,
      true,
      'readiness includes an accepted current snapshot',
    );
    const context = host.registry.context();
    let current = true;
    const delivery = await session.dispatchNativeAction(
      {
        protocol: 2,
        kind: 'nativeAction',
        requestId: 'stale-native-create',
        documentLifetimeId: context.documentId,
        uri: report.uri.toString(),
        baseVersion: report.version,
        viewId,
        contextGeneration: context.generation,
        capability: 'create',
        action: 'create',
        create: 'textbox',
        targetIds: [],
      },
      () => current,
      async () => {
        current = false;
        session.receive({
          protocol: 2,
          kind: 'edit',
          requestId: 'stale-native-edit',
          nativeRequestId: 'stale-native-create',
          baseVersion: report.version,
          targetId: authoredId,
          operation: 'author',
          payload: { action: 'createTextbox', left: '20pt', top: '20pt' },
        });
        return true;
      },
    );
    await until(
      () =>
        messages.some(
          (message) =>
            message.kind === 'editResult' &&
            message.requestId === 'stale-native-edit',
        ),
      'queued native refusal',
    );
    assert.equal(delivery.delivered, false);
    assert.equal(
      report.getText(),
      source,
      'queued stale native actions must not mutate accepted XML',
    );
    assert.equal(
      messages.some(
        (message) =>
          message.kind === 'editResult' &&
          message.requestId === 'stale-native-edit' &&
          !message.accepted &&
          !message.changed,
      ),
      true,
    );
    transport.dispose();
    association.dispose();
    designer.dispose();
    await vscode.window.showTextDocument(report);
    const editor = vscode.window.activeTextEditor!;
    assert.equal(
      await editor.edit((edit) =>
        edit.insert(new vscode.Position(0, 0), '<broken>'),
      ),
      true,
    );
    assert.equal(host.registry.context().state, 'invalid-source');
    assert.deepEqual(
      versions,
      [report.version],
      'one notification per accepted document change',
    );
    assert.equal(session.evaluation.snapshot.source, report.getText());
    assert.deepEqual(
      versions,
      [report.version],
      'reading accepted evaluation emits no duplicate',
    );
    assert.notEqual(host.registry.revalidate(captured.capture), null);
    const other = await vscode.workspace.openTextDocument({
      content: 'ordinary text',
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(other);
    assert.equal(host.registry.context().state, 'no-report');
    await vscode.window.showTextDocument(report);
    assert.equal(host.registry.context().documentId, accepted.documentId);
    assert.equal(host.registry.context().state, 'invalid-source');
    const panel = vscode.window.createWebviewPanel(
      'rdlcTests.contextDisposal',
      'Context disposal proof',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    );
    const registration = host.register(report, panel, session);
    host.dispose();
    assert.doesNotThrow(() => {
      registration.dispose();
      panel.dispose();
      host.refreshFocus();
      host.dispose();
    }, 'panel teardown must be safe after extension context disposal');
  } finally {
    observation.dispose();
    session.dispose();
    host.dispose();
    await vscode.window.showTextDocument(report);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
  await rejectedNativeDelivery(source);
  await deliveryOutsideMutationQueue(source);
  await correlatedEditRoundTrip(source);
  await renameAndReopen(source);
}

/** Every failed or invalidated delivery settles once with a refusal and never mutates or retries. */
async function rejectedNativeDelivery(source: string): Promise<void> {
  type Disturb = (
    session: DocumentSession,
    document: vscode.TextDocument,
  ) => unknown;
  const disposal = 'session is disposed during delivery';
  const cases: [string, Disturb | 'false' | 'throw', boolean][] = [
    ['postMessage resolves false', 'false', false],
    ['postMessage throws', 'throw', false],
    [
      'document version changes during delivery',
      (_session, document) => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), ' ');
        return vscode.workspace.applyEdit(edit);
      },
      true,
    ],
    [
      'context generation changes during delivery',
      (session) =>
        session.setViewIdentity({
          viewId: 'view-delivery',
          documentLifetimeId: 'life-delivery',
          contextGeneration: 1,
        }),
      true,
    ],
    [disposal, (session) => session.dispose(), true],
  ];
  for (const [label, disturb, accepts] of cases) {
    const document = await vscode.workspace.openTextDocument({
      language: 'xml',
      content: source,
    });
    const session = new DocumentSession(document);
    const messages: HostMessage[] = [];
    const outcomes: ActionOutcomeMessage[] = [];
    session.onMessage((message) => messages.push(message));
    session.onActionOutcome((outcome) => outcomes.push(outcome));
    try {
      assert.ok(
        session.setViewIdentity({
          viewId: 'view-delivery',
          documentLifetimeId: 'life-delivery',
          contextGeneration: 0,
        }),
      );
      session.receive({ protocol: 2, kind: 'ready' });
      await until(() => session.isReady, label + ': handshake');
      const action = {
        protocol: 2,
        kind: 'nativeAction',
        requestId: 'delivery-1',
        documentLifetimeId: 'life-delivery',
        uri: document.uri.toString(),
        baseVersion: document.version,
        viewId: 'view-delivery',
        contextGeneration: 0,
        capability: 'create',
        action: 'create',
        create: 'textbox',
        targetIds: [],
      };
      let deliveries = 0;
      const deliver = async () => {
        deliveries++;
        if (disturb === 'throw') throw new Error('webview disposed');
        if (disturb !== 'false') await disturb(session, document);
        return accepts;
      };
      const textAtStart = document.getText();
      const result = await session.dispatchNativeAction(
        action,
        () => true,
        deliver,
      );
      assert.equal(result.delivered, false, label);
      assert.ok(!result.delivered && result.reason.length > 0, label);
      assert.equal(deliveries, 1, label + ': delivered once');
      assert.equal(outcomes.length, 1, label + ': settles exactly once');
      assert.equal(outcomes[0]!.requestId, 'delivery-1');
      assert.equal(outcomes[0]!.status, 'refused', label);
      assert.ok((outcomes[0]!.reason ?? '').length > 0, label);
      // The only text change is the injected edit; the action itself never mutates.
      assert.equal(
        document.getText(),
        label.startsWith('document version') ? ' ' + textAtStart : textAtStart,
        label + ': no mutation',
      );
      assert.equal(
        messages.some((message) => message.kind === 'editResult'),
        false,
        label + ': no edit was produced',
      );
      if (label !== disposal) {
        // The request ID is terminal: no retry, no second outcome.
        const again = await session.dispatchNativeAction(
          action,
          () => true,
          deliver,
        );
        assert.equal(again.delivered, false, label + ': retry refused');
        assert.equal(deliveries, 1, label + ': no redelivery');
        session.cancelNativeAction('delivery-1', 'late cancel');
        assert.equal(outcomes.length, 1, label + ': still one outcome');
        assert.equal(
          messages.filter((message) => message.kind === 'nativeCancel').length,
          1,
          label + ': pending state cleared once',
        );
      }
    } finally {
      session.dispose();
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
    }
  }
}

/**
 * The harness plays the designer for a real DocumentSession registered in the sidebar
 * context: a native creation and a native mutation each send one correlated edit through
 * the real queue and applyWorkspaceEdit. The host's own edit must settle each action once,
 * promptly, and must not advance the context generation the designer compares.
 */
async function correlatedEditRoundTrip(source: string): Promise<void> {
  const host = new SidebarHostContext();
  const document = await vscode.workspace.openTextDocument({
    language: 'xml',
    content: source,
  });
  const session = new DocumentSession(document);
  const messages: HostMessage[] = [];
  const outcomes: ActionOutcomeMessage[] = [];
  const created: string[] = [];
  const subscriptions = [
    session.onMessage((message) => {
      messages.push(message);
      if (message.kind !== 'editResult') return;
      const nativeId = message.requestId.replace(/^edit-/, '');
      if (message.created) created.push(message.created.id);
      // The designer settles the captured action from its correlated edit result.
      session.receive({
        protocol: 2,
        kind: 'actionOutcome',
        requestId: nativeId,
        baseVersion: message.baseVersion,
        resultVersion: message.version,
        ...(message.accepted
          ? { status: 'accepted' }
          : { status: 'refused', reason: message.reason }),
        selectionSequence: 0,
      });
    }),
    session.onActionOutcome((outcome) => outcomes.push(outcome)),
  ];
  const panel = {
    active: false,
    visible: false,
    viewColumn: undefined,
    onDidChangeViewState: () => new vscode.Disposable(() => undefined),
    webview: {
      postMessage: async (input: unknown) => {
        const action = input as NativeActionMessage;
        const author = action.action === 'author';
        void Promise.resolve().then(() =>
          session.receive({
            protocol: 2,
            kind: 'edit',
            requestId: `edit-${action.requestId}`,
            nativeRequestId: action.requestId,
            baseVersion: action.baseVersion,
            targetId: author
              ? action.targetIds[0]!
              : session.evaluation.syntax.root!.id,
            operation: 'author',
            payload: author
              ? action.payload
              : { action: 'createTextbox', left: '20pt', top: '20pt' },
          }),
        );
        return true;
      },
    },
  } as unknown as vscode.WebviewPanel;
  let registration: vscode.Disposable | undefined;
  try {
    await vscode.window.showTextDocument(document);
    registration = host.register(document, panel, session);
    session.receive({ protocol: 2, kind: 'ready' });
    await until(() => session.isReady, 'round trip: handshake');
    const run = async (
      label: string,
      intent: Parameters<SidebarHostContext['dispatch']>[0],
      targetIds: readonly string[] = [],
    ): Promise<ActionOutcomeMessage> => {
      const baseVersion = document.version;
      const generation = host.registry.context().generation;
      const first = messages.length;
      const started = Date.now();
      const outcome = await host.dispatch(intent, targetIds);
      assert.ok(
        Date.now() - started < 10_000,
        label + ': settled well before the 30 s host timeout',
      );
      assert.equal(
        outcome.status,
        'accepted',
        `${label}: ${outcome.reason ?? ''}`,
      );
      assert.equal(outcome.baseVersion, baseVersion, label);
      assert.ok(outcome.resultVersion > baseVersion, label);
      assert.equal(document.version, baseVersion + 1, label + ': one edit');
      const seen = messages.slice(first);
      const snapshotAt = seen.findIndex(
        (message) =>
          message.kind === 'snapshot' && message.version > baseVersion,
      );
      const resultAt = seen.findIndex(
        (message) => message.kind === 'editResult',
      );
      assert.ok(
        snapshotAt >= 0 && snapshotAt < resultAt,
        label + ': the host publishes the new snapshot before the edit result',
      );
      // A designer comparing view bindings must never see the host's own edit as a context change.
      for (const message of seen)
        if (message.kind === 'snapshot' && message.viewBinding)
          assert.equal(
            message.viewBinding.contextGeneration,
            generation,
            label + ': snapshot binding keeps the captured generation',
          );
      assert.equal(host.registry.context().generation, generation, label);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        outcomes.filter((entry) => entry.requestId === outcome.requestId)
          .length,
        1,
        label + ': exactly one outcome',
      );
      assert.equal(
        messages.some((message) => message.kind === 'protocolError'),
        false,
        label + ': no protocol error',
      );
      return outcome;
    };
    await run('native creation', { action: 'create', create: 'textbox' });
    assert.equal(created.length, 1);
    assert.match(document.getText(), /<Textbox /);
    await run(
      'native mutation',
      {
        action: 'author',
        payload: {
          action: 'deleteTextbox',
          confirm: 'delete-contained-content',
        },
      },
      [created[0]!],
    );
    assert.equal(document.getText(), source, 'create then delete restores XML');

    // Stale or duplicate bridge messages are ignored: no protocol error blocks the designer.
    const settled = outcomes.at(-1)!;
    const version = document.version;
    const selection = {
      protocol: 2,
      kind: 'acceptedSelection',
      version,
      viewId: host.registry.context().viewId,
      sequence: 2,
      selection: { mode: 'empty' },
    };
    const received = outcomes.length;
    const errors = () =>
      messages.filter((message) => message.kind === 'protocolError').length;
    session.receive(selection);
    assert.equal(session.currentSelection?.sequence, 2);
    session.receive(selection);
    session.receive({ ...selection, sequence: 1 });
    session.receive({ ...selection, sequence: 3, version: version - 1 });
    session.receive({ ...settled });
    session.receive({
      ...settled,
      status: 'refused',
      reason: 'Conflicting duplicate',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(errors(), 0, 'stale and duplicate messages post no error');
    assert.equal(session.currentSelection?.sequence, 2);
    assert.equal(outcomes.length, received, 'duplicates report nothing new');
    session.receive({ ...selection, sequence: 3, version: version + 5 });
    await until(() => errors() === 1, 'malformed selection still reports');
  } finally {
    for (const subscription of subscriptions) subscription.dispose();
    registration?.dispose();
    session.dispose();
    host.dispose();
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}

/** Bridge delivery must never wait behind a pending document mutation (draft waiting deadlock). */
async function deliveryOutsideMutationQueue(source: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: 'xml',
    content: source,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let blocked = false;
  const session = new DocumentSession(document, async (edit, metadata) => {
    blocked = true;
    await gate;
    return vscode.workspace.applyEdit(edit, metadata);
  });
  try {
    assert.ok(
      session.setViewIdentity({
        viewId: 'view-queue',
        documentLifetimeId: 'life-queue',
        contextGeneration: 0,
      }),
    );
    session.receive({ protocol: 2, kind: 'ready' });
    await until(() => session.isReady, 'queue case: handshake');
    const targetId = session.evaluation.ids[0]!;
    session.receive({
      protocol: 2,
      kind: 'edit',
      requestId: 'queued-edit',
      baseVersion: document.version,
      targetId,
      operation: 'author',
      payload: { action: 'createTextbox', left: '20pt', top: '20pt' },
    });
    await until(() => blocked, 'a mutation is waiting in the document queue');
    const timeout = Symbol('blocked behind the document queue');
    const result = await Promise.race([
      session.dispatchNativeAction(
        {
          protocol: 2,
          kind: 'nativeAction',
          requestId: 'queue-select',
          documentLifetimeId: 'life-queue',
          uri: document.uri.toString(),
          baseVersion: document.version,
          viewId: 'view-queue',
          contextGeneration: 0,
          capability: 'select',
          action: 'select',
          targetIds: [targetId],
          primaryId: targetId,
          additive: false,
        },
        () => true,
        async () => true,
      ),
      new Promise<symbol>((resolve) => setTimeout(resolve, 3000, timeout)),
    ]);
    assert.notEqual(result, timeout, 'delivery waited for the mutation queue');
    assert.equal((result as { delivered: boolean }).delivered, true);
  } finally {
    release();
    session.dispose();
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}

async function renameAndReopen(source: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'rdlc-sidebar-rename-'));
  const oldUri = vscode.Uri.file(join(directory, 'original.rdlc'));
  const newUri = vscode.Uri.file(join(directory, 'renamed.rdlc'));
  const host = new SidebarHostContext();
  try {
    await writeFile(oldUri.fsPath, source);
    const document = await vscode.workspace.openTextDocument(oldUri);
    await vscode.window.showTextDocument(document);
    const lifetime = host.registry.context().documentId;
    const capture = host.registry.capture('before-rename', 'source', [
      host.evaluation!.sourceIds[0]!,
    ]);
    assert.ok(capture.ok);
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(oldUri, newUri);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    const renamed = await vscode.workspace.openTextDocument(newUri);
    await vscode.window.showTextDocument(renamed);
    assert.equal(host.registry.context().uri, newUri.toString());
    assert.equal(host.registry.context().state, 'editable');
    assert.equal(renamed.getText(), source);
    assert.equal(renamed.isDirty, false);
    assert.notEqual(
      host.registry.revalidate(capture.capture),
      null,
      'a real filesystem rename invalidates the old captured URI',
    );
    await writeFile(oldUri.fsPath, source);
    const reopened = await vscode.workspace.openTextDocument(oldUri);
    await vscode.window.showTextDocument(reopened);
    assert.notEqual(
      host.registry.context().documentId,
      lifetime,
      'the old URI reopens as a new document lifetime',
    );
    assert.equal(host.registry.context().viewId, null);
    assert.equal(reopened.getText(), source);
    assert.notEqual(host.registry.revalidate(capture.capture), null);
  } finally {
    host.dispose();
    for (const uri of [oldUri, newUri]) {
      const document = vscode.workspace.textDocuments.find(
        (document) =>
          !document.isClosed && document.uri.toString() === uri.toString(),
      );
      if (document) {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand(
          'workbench.action.revertAndCloseActiveEditor',
        );
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}
