import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { closeOwnedEditors } from './lifecycle.test.js';
import { history, observe, replaceSource, until } from './session-checks.js';
import { validateMessage } from '@rdlc/report-model/protocol';
import { FailingFileSystem } from './failing-file-system.js';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { WindowClipboard } from '../../apps/vscode-extension/src/clipboard.js';
import { memory, open, view } from './clipboard.test.js';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import { activateHistoryTarget } from '../../apps/vscode-extension/src/editor-provider.js';
import { SidebarHostContext } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import type { NativeIntent } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import type {
  ActionOutcomeMessage,
  HostMessage,
  NativeActionMessage,
} from '@rdlc/report-model/protocol';

export async function run(): Promise<void> {
  await nativeRequestLifecycle();
  await sourceNavigationRaces();
  await nativeDesignerHistory();
  await clipboardViewRace();
  await groupSynchronization();
  await ambiguousIndependentChange();
  await independentViewNudge();
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/textboxes/supported.rdlc'),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-sync-')), 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    document.uri,
    'rdlcCode.designer',
    { viewColumn: vscode.ViewColumn.One },
  );
  await vscode.commands.executeCommand(
    'vscode.openWith',
    document.uri,
    'rdlcCode.designer',
    { viewColumn: vscode.ViewColumn.Two },
  );
  assert.equal(
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          tab.input instanceof vscode.TabInputCustom &&
          tab.input.uri.toString() === document.uri.toString(),
      ).length,
    2,
  );
  await vscode.commands.executeCommand('rdlcCode.openSource');
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    document.uri.toString(),
  );
  const a = observe(document);
  const b = observe(document);
  try {
    const targetId = a.intent('target', '').targetId;
    const layoutRequest = {
      protocol: 2,
      kind: 'edit',
      requestId: 'direct-noop',
      baseVersion: document.version,
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: [targetId],
        dxPt: 0,
        dyPt: 0,
        unit: 'pt',
      },
    };
    const volume = new FailingFileSystem(Buffer.from(source));
    const registration = vscode.workspace.registerFileSystemProvider(
      'rdlc-direct-readonly',
      volume,
      { isReadonly: true },
    );
    const readonlyDocument = await vscode.workspace.openTextDocument(
      vscode.Uri.parse('rdlc-direct-readonly:/report.rdlc'),
    );
    let readonlyApplies = 0;
    const readonlyView = observe(readonlyDocument, async () => {
      readonlyApplies++;
      return true;
    });
    try {
      const target = readonlyView.intent('readonly-target', '');
      readonlyView.session.receive({
        ...layoutRequest,
        requestId: 'readonly-layout',
        baseVersion: readonlyDocument.version,
        payload: {
          ...layoutRequest.payload,
          targetIds: [target.targetId],
          dxPt: 5,
        },
      });
      await until(
        () => readonlyView.messages.some((m) => m.kind === 'editResult'),
        'Read-only layout refusal',
      );
      assert.ok(
        readonlyView.messages.some(
          (m) =>
            m.kind === 'editResult' &&
            !m.accepted &&
            m.reason === 'DOCUMENT_READ_ONLY',
        ),
      );
      // Contextual creation and native history get the same read-only refusal.
      readonlyView.session.receive({
        protocol: 2,
        kind: 'edit',
        requestId: 'readonly-create',
        baseVersion: readonlyDocument.version,
        operation: 'author',
        targetId: parse({
          uri: readonlyDocument.uri.toString(),
          version: readonlyDocument.version,
          source,
          eol: '\n',
        }).root!.id,
        payload: { action: 'createTextbox', left: '1in', top: '1in' },
      });
      // History issued while another operation is queued is refused as busy; wait first.
      await until(
        () =>
          readonlyView.messages.some(
            (m) => m.kind === 'editResult' && m.requestId === 'readonly-create',
          ),
        'Read-only creation refusal',
      );
      readonlyView.session.receive({
        protocol: 2,
        kind: 'history',
        requestId: 'readonly-undo',
        baseVersion: readonlyDocument.version,
        action: 'undo',
      });
      await until(
        () => readonlyView.messages.some((m) => m.kind === 'historyResult'),
        'Read-only history refusal',
      );
      assert.ok(
        readonlyView.messages.some(
          (m) =>
            m.kind === 'editResult' &&
            m.requestId === 'readonly-create' &&
            !m.accepted &&
            m.reason === 'DOCUMENT_READ_ONLY',
        ),
      );
      assert.ok(
        readonlyView.messages.some(
          (m) =>
            m.kind === 'historyResult' &&
            !m.accepted &&
            !m.changed &&
            /read-only/.test(m.reason ?? ''),
        ),
      );
      assert.equal(readonlyApplies, 0);
      assert.equal(readonlyDocument.getText(), source);
      assert.equal(readonlyDocument.isDirty, false);
    } finally {
      readonlyView.dispose();
      registration.dispose();
      volume.dispose();
    }
    const direct = observe(document, async () => {
      throw new Error('No-op must never apply');
    });
    try {
      direct.session.receive(layoutRequest);
      await until(
        () => direct.messages.some((m) => m.kind === 'editResult'),
        'Layout no-op',
      );
      assert.ok(
        direct.messages.some(
          (m) => m.kind === 'editResult' && m.accepted && !m.changed,
        ),
      );
      direct.session.receive(layoutRequest);
      await until(
        () => direct.messages.some((m) => m.kind === 'protocolError'),
        'Duplicate layout',
      );
      assert.equal(document.getText(), source);
    } finally {
      direct.dispose();
    }
    for (const [label, apply] of [
      ['refused-layout', async () => false],
      ['uncertain-layout', async () => true],
    ] as const) {
      const refused = observe(document, apply);
      try {
        refused.session.receive({
          ...layoutRequest,
          requestId: label,
          payload: { ...layoutRequest.payload, dxPt: 5, dyPt: 6 },
        });
        await until(
          () => refused.messages.some((m) => m.kind === 'editResult'),
          label,
        );
        assert.ok(
          refused.messages.some((m) => m.kind === 'editResult' && !m.accepted),
        );
        assert.equal(document.getText(), source);
      } finally {
        refused.dispose();
      }
    }
    let noOpApplies = 0;
    const noOp = observe(document, async () => {
      noOpApplies++;
      return false;
    });
    try {
      const version = document.version;
      const dirty = document.isDirty;
      const intent = {
        ...noOp.intent('geometric-no-op', ''),
        payload: { property: 'left', value: '18pt' },
      };
      noOp.session.receive(intent);
      await until(
        () => noOp.messages.some((message) => message.kind === 'editResult'),
        'Geometric no-op settles',
      );
      const result = noOp.messages.find(
        (message) => message.kind === 'editResult',
      );
      assert.ok(result?.kind === 'editResult' && result.accepted);
      assert.equal(result.changed, false);
      assert.equal(result.baseVersion, version);
      assert.equal(result.version, version);
      assert.deepEqual(result.mappings, [
        { sourceId: intent.targetId, resultId: intent.targetId },
      ]);
      assert.ok(validateMessage(result));
      assert.equal(noOpApplies, 0, 'No WorkspaceEdit for a geometric no-op');
      assert.equal(document.version, version);
      assert.equal(document.isDirty, dirty);
      assert.equal(document.getText(), source);
    } finally {
      noOp.dispose();
    }
    const first = a.intent('race-a', 'First view');
    const second = b.intent('race-b', 'Second view');
    a.session.receive(first);
    b.session.receive(second);
    await until(
      () =>
        a.messages.some((m) => m.kind === 'editResult') &&
        b.messages.some(
          (m) => m.kind === 'editResult' || m.kind === 'protocolError',
        ),
      'Both race requests settled',
    );
    assert.ok(document.getText().includes('First view'));
    assert.ok(!document.getText().includes('Second view'));
    assert.ok(!b.messages.some((m) => m.kind === 'editResult' && m.accepted));
    const accepted = a.messages.find(
      (message) => message.kind === 'editResult',
    );
    assert.ok(
      accepted?.kind === 'editResult' && accepted.accepted && accepted.changed,
    );
    assert.equal(accepted.baseVersion, first.baseVersion);
    assert.equal(accepted.version, document.version);
    assert.equal(accepted.mappings[0]?.sourceId, first.targetId);
    assert.ok(
      accepted.mappings[0]?.resultId?.startsWith(`${document.version}:`),
    );
    assert.ok(validateMessage(accepted));
    const after = document.getText();
    a.session.receive(first);
    await until(
      () => a.messages.some((m) => m.kind === 'protocolError'),
      'Duplicate refused',
    );
    assert.equal(document.getText(), after);
    const stale = {
      ...layoutRequest,
      requestId: 'delayed-layout',
      baseVersion: document.version,
      payload: {
        ...layoutRequest.payload,
        targetIds: [a.intent('current', '').targetId],
        dxPt: 3,
      },
    };
    await replaceSource(document, '<Report>');
    for (const view of [a, b]) {
      await until(
        () =>
          view.messages.some(
            (m) =>
              m.kind === 'snapshot' &&
              m.version === document.version &&
              m.projection.status === 'invalid-source',
          ),
        'Invalid source reaches every view',
      );
    }
    a.session.receive(stale);
    await replaceSource(document, source);
    await until(
      () =>
        b.messages.some(
          (m) =>
            m.kind === 'snapshot' &&
            m.version === document.version &&
            m.projection.status === 'editable',
        ),
      'Valid source restores capabilities',
    );
    assert.equal(document.getText(), source);
    for (const [label, apply] of [
      ['refused', async () => false],
      [
        'throwing',
        async () => {
          throw new Error('Host failure');
        },
      ],
      ['uncertain', async () => true],
    ] as const) {
      const refused = observe(document, apply);
      try {
        refused.session.receive(refused.intent(label, 'Not accepted'));
        await until(
          () => refused.messages.some((m) => m.kind === 'editResult'),
          label,
        );
        assert.ok(
          refused.messages.some((m) => m.kind === 'editResult' && !m.accepted),
        );
        assert.equal(document.getText(), source);
      } finally {
        refused.dispose();
      }
    }
    const interleaved = observe(document, async (edit) => {
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      const candidate = document.getText();
      await replaceSource(document, `${candidate}\n`);
      await replaceSource(document, candidate);
      return true;
    });
    try {
      interleaved.session.receive({
        ...layoutRequest,
        requestId: 'interleaved',
        baseVersion: document.version,
        payload: {
          ...layoutRequest.payload,
          targetIds: [interleaved.intent('current', '').targetId],
          dxPt: 5,
        },
      });
      await until(
        () => interleaved.messages.some((m) => m.kind === 'editResult'),
        'Intervening source changes settle',
      );
      assert.ok(
        interleaved.messages.some(
          (m) =>
            m.kind === 'editResult' &&
            !m.accepted &&
            m.reason === 'DOCUMENT_CHANGED_DURING_APPLY',
        ),
      );
      assert.ok(
        document.getText() !== source,
        'The authoritative source is published, not rolled back',
      );
    } finally {
      interleaved.dispose();
    }
    await replaceSource(document, source);
    const foreign = a.intent('foreign-id', 'Unsafe');
    const errors = a.messages.filter((m) => m.kind === 'protocolError').length;
    a.session.receive({ ...foreign, targetId: '999:foreign' });
    a.session.receive({
      ...foreign,
      requestId: 'wrong-version',
      baseVersion: document.version - 1,
    });
    await until(
      () =>
        a.messages.filter((m) => m.kind === 'protocolError').length ===
        errors + 2,
      'Foreign and stale IDs refused',
    );
    const count = a.messages.length;
    a.dispose();
    a.session.receive(a.intent('disposed', 'Must not apply'));
    await replaceSource(document, source.replace('Hello', 'Source view'));
    assert.equal(
      a.messages.length,
      count,
      'Disposed view has no listeners or queued writes',
    );
  } finally {
    a.dispose();
    b.dispose();
  }
}

async function sourceNavigationRaces(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/textboxes/supported.rdlc'),
    'utf8',
  );
  for (const change of ['none', 'version', 'generation'] as const) {
    const document = await vscode.workspace.openTextDocument({
      language: 'xml',
      content: source,
    });
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    let editor: vscode.TextEditor | undefined;
    let opening = false;
    const session = new DocumentSession(
      document,
      undefined,
      undefined,
      undefined,
      async (uri) => {
        assert.equal(uri.toString(), document.uri.toString());
        editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        opening = true;
        await opened;
      },
    );
    session.setViewIdentity({
      viewId: 'source-view',
      documentLifetimeId: 'source-life',
      contextGeneration: 0,
    });
    let snapshots = 0;
    const subscription = session.onMessage((message) => {
      if (message.kind === 'snapshot') snapshots++;
    });
    try {
      session.receive({ protocol: 2, kind: 'ready' });
      await until(() => snapshots > 0, 'source-race handshake');
      const version = document.version;
      const target = session.evaluation.projection.textboxes[0]!.node;
      session.receive({
        protocol: 2,
        kind: 'openSource',
        version,
        targetId: target.id,
      });
      await until(() => opening, 'actual source editor opening boundary');
      if (change === 'version') {
        assert.equal(
          await editor!.edit((edit) =>
            edit.insert(
              new vscode.Position(0, 0),
              '<!-- external change -->\n',
            ),
          ),
          true,
        );
        editor!.selection = new vscode.Selection(0, 0, 0, 0);
      }
      if (change === 'generation')
        session.setViewIdentity({
          viewId: 'source-view',
          documentLifetimeId: 'source-life',
          contextGeneration: 1,
        });
      const before = snapshots;
      release();
      session.receive({ protocol: 2, kind: 'ready' });
      await until(() => snapshots > before, 'queued source opening completes');
      if (change === 'none')
        assert.equal(
          document.getText(editor!.selection),
          source.slice(target.range.start, target.range.end),
        );
      else
        assert.equal(
          editor!.selection.isEmpty,
          true,
          `${change} change refuses the old source range`,
        );
      assert.equal(
        document.getText(),
        // The editor normalizes the inserted newline to the document's EOL
        // (CRLF when the fixture is checked out with Windows line endings).
        change === 'version'
          ? `<!-- external change -->${document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'}${source}`
          : source,
      );
    } finally {
      release();
      subscription.dispose();
      session.dispose();
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
    }
  }
}

async function nativeDesignerHistory(): Promise<void> {
  const type = 'rdlcCode.historyProof';
  const views: {
    panel: vscode.WebviewPanel;
    session: DocumentSession;
    messages: HostMessage[];
  }[] = [];
  const registration = vscode.window.registerCustomEditorProvider(
    type,
    {
      resolveCustomTextEditor(document, panel) {
        panel.webview.html =
          '<html><body>Native history targeting proof</body></html>';
        const session = new DocumentSession(
          document,
          undefined,
          undefined,
          () => activateHistoryTarget(document, panel, type),
        );
        const messages: HostMessage[] = [];
        session.onMessage((message) => messages.push(message));
        panel.onDidDispose(() => session.dispose());
        views.push({ panel, session, messages });
        session.receive({ protocol: 2, kind: 'ready' });
      },
    },
    {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true },
    },
  );
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const dir = mkdtempSync(join(tmpdir(), 'rdlc-history-'));
  const aFile = join(dir, 'a.rdlc'),
    bFile = join(dir, 'b.rdlc');
  writeFileSync(aFile, source);
  writeFileSync(bFile, source);
  const a = await vscode.workspace.openTextDocument(aFile),
    b = await vscode.workspace.openTextDocument(bFile);
  try {
    await vscode.commands.executeCommand('vscode.openWith', a.uri, type, {
      viewColumn: vscode.ViewColumn.One,
    });
    await vscode.commands.executeCommand('workbench.action.keepEditor');
    await vscode.commands.executeCommand('workbench.action.splitEditor');
    await until(
      () =>
        views.length >= 2 &&
        views.every((v) => v.messages.some((m) => m.kind === 'snapshot')),
      `Two real history designer panels (initial views ${views.length}, messages ${JSON.stringify(views.map((v) => v.messages.map((m) => m.kind)))})`,
    );
    const first = views[0]!;
    const texts = [source];
    for (let i = 0; i < 20; i++) {
      const syntax = parse({
        uri: a.uri.toString(),
        version: a.version,
        source: a.getText(),
        eol: '\n',
      });
      const report = projectReport(syntax);
      const textbox = report.textboxes.find(
        (t) => t.context === 'body' && t.capabilities.includes('text'),
      )!;
      const requestId = `mixed-history-${i}`;
      first.session.receive({
        protocol: 2,
        kind: 'edit',
        requestId,
        baseVersion: a.version,
        ...(i % 5 === 2
          ? {
              operation: 'author',
              targetId: syntax.root!.id,
              payload: { action: 'createDataset' },
            }
          : i % 5 === 3
            ? {
                operation: 'author',
                targetId: report.tables.find((t) => t.structural)!.node.id,
                payload: {
                  action: 'setColumnWidth',
                  column: '0',
                  width: `${72 + i}pt`,
                },
              }
            : {
                targetId: textbox.node.id,
                operation: 'setProperty',
                payload:
                  i % 2
                    ? { property: 'left', value: `${20 + i}pt` }
                    : { property: 'text', value: `Title ${i}` },
              }),
      });
      await until(
        () =>
          first.messages.some(
            (m) => m.kind === 'editResult' && m.requestId === requestId,
          ),
        requestId,
      );
      const result = first.messages.find(
        (m) => m.kind === 'editResult' && m.requestId === requestId,
      );
      assert.ok(
        result?.kind === 'editResult' && result.accepted && result.changed,
        JSON.stringify(result),
      );
      texts.push(a.getText());
    }
    await vscode.window.showTextDocument(b, vscode.ViewColumn.Three);
    await replaceSource(b, source + '\n<!-- Unrelated B -->');
    const exactB = b.getText();
    // Simulate returning to the originating designer, not opening its source text editor.
    first.panel.reveal(vscode.ViewColumn.One, false);
    await until(
      () => first.panel.active,
      'Originating designer active after B',
    );
    for (const action of ['undo', 'redo'] as const) {
      const expected =
        action === 'undo' ? texts.slice(0, -1).reverse() : texts.slice(1);
      for (const [i, text] of expected.entries()) {
        const requestId = `native-${action}-${i}`;
        first.session.receive({
          protocol: 2,
          kind: 'history',
          requestId,
          baseVersion: a.version,
          action,
        });
        await until(
          () =>
            first.messages.some(
              (m) => m.kind === 'historyResult' && m.requestId === requestId,
            ),
          requestId,
        );
        const result = first.messages.find(
          (m) => m.kind === 'historyResult' && m.requestId === requestId,
        );
        assert.ok(
          result?.kind === 'historyResult' && result.accepted && result.changed,
          JSON.stringify(result),
        );
        await until(
          () =>
            a.getText() === text &&
            views.every((v) =>
              v.messages.some(
                (m) => m.kind === 'snapshot' && m.version === a.version,
              ),
            ),
          'A-only native history and split refresh',
        );
        assert.equal(b.getText(), exactB);
      }
      if (action === 'undo') {
        first.session.receive({
          protocol: 2,
          kind: 'history',
          requestId: 'empty-history',
          baseVersion: a.version,
          action: 'undo',
        });
        await until(
          () =>
            first.messages.some(
              (m) =>
                m.kind === 'historyResult' && m.requestId === 'empty-history',
            ),
          'Empty history settles',
        );
        const result = first.messages.find(
          (m) => m.kind === 'historyResult' && m.requestId === 'empty-history',
        );
        assert.ok(
          result?.kind === 'historyResult' &&
            result.accepted &&
            !result.changed,
        );
        assert.equal(a.getText(), source);
        assert.equal(b.getText(), exactB);
        for (const requestId of ['pending-history-1', 'pending-history-2'])
          first.session.receive({
            protocol: 2,
            kind: 'history',
            requestId,
            baseVersion: a.version,
            action: 'undo',
          });
        await until(
          () =>
            first.messages.some(
              (m) =>
                m.kind === 'historyResult' &&
                m.requestId === 'pending-history-2',
            ),
          'Concurrent history request settles',
        );
        const pending = first.messages.find(
          (m) =>
            m.kind === 'historyResult' && m.requestId === 'pending-history-2',
        );
        assert.ok(
          pending?.kind === 'historyResult' &&
            !pending.accepted &&
            !pending.changed,
        );
        const errors = first.messages.filter(
          (m) => m.kind === 'protocolError',
        ).length;
        first.session.receive({
          protocol: 2,
          kind: 'history',
          requestId: 'stale-history',
          baseVersion: a.version - 1,
          action: 'redo',
        });
        await until(
          () =>
            first.messages.filter((m) => m.kind === 'protocolError').length >
            errors,
          'Stale native history refused',
        );
        assert.equal(a.getText(), source);
        assert.equal(b.getText(), exactB);
      }
    }
    assert.equal(await a.save(), true);
    assert.equal(readFileSync(aFile, 'utf8'), texts.at(-1));
    assert.equal(
      (await vscode.workspace.openTextDocument(aFile)).getText(),
      texts.at(-1),
    );
    await replaceSource(a, '<Report');
    await until(
      () =>
        views.every((v) =>
          v.messages.some(
            (m) =>
              m.kind === 'snapshot' &&
              m.version === a.version &&
              m.projection.status === 'invalid-source',
          ),
        ),
      'Source-only snapshot published',
    );
    first.session.receive({
      protocol: 2,
      kind: 'history',
      requestId: 'source-only-history',
      baseVersion: a.version,
      action: 'undo',
    });
    await until(
      () =>
        first.messages.some(
          (m) =>
            m.kind === 'historyResult' && m.requestId === 'source-only-history',
        ),
      'Source-only native history',
    );
    assert.equal(a.getText(), texts.at(-1));
    assert.equal(b.getText(), exactB);
    const version = a.version;
    await vscode.window.showTextDocument(b, vscode.ViewColumn.Three);
    first.session.receive({
      protocol: 2,
      kind: 'history',
      requestId: 'inactive-history',
      baseVersion: version,
      action: 'undo',
    });
    await until(
      () =>
        first.messages.some(
          (m) =>
            m.kind === 'historyResult' && m.requestId === 'inactive-history',
        ),
      'Inactive target refused',
    );
    assert.equal(a.version, version);
    assert.equal(b.getText(), exactB);
    const refused = first.messages.find(
      (m) => m.kind === 'historyResult' && m.requestId === 'inactive-history',
    );
    assert.ok(
      refused?.kind === 'historyResult' &&
        !refused.accepted &&
        !refused.changed,
    );
  } finally {
    for (const v of views) {
      v.session.dispose();
      v.panel.dispose();
    }
    registration.dispose();
  }
}

async function groupSynchronization(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-group-sync-')),
    'report.rdlc',
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const a = observe(document),
    b = observe(document);
  try {
    const report = projectReport(
      parse({
        uri: document.uri.toString(),
        version: document.version,
        source,
        eol: '\n',
      }),
    );
    const ids = [
      report.textboxes.find((t) => t.name === 'Front')!.node.id,
      report.textboxes.find((t) => t.name === 'LaterTie')!.node.id,
      report.tables[0]!.node.id,
    ];
    await until(
      () => a.messages.some((m) => m.kind === 'snapshot'),
      'Initial group scene',
    );
    const scene = a.messages.find((m) => m.kind === 'snapshot');
    assert.ok(scene?.kind === 'snapshot');
    const locked = scene.scene!.items.find(
      (i) => i.kind === 'preserved' && i.bounds,
    )!.id;
    const base = {
      protocol: 2,
      kind: 'edit',
      baseVersion: document.version,
      operation: 'layout',
    };
    const invalid = [
      {
        action: 'move',
        targetIds: [...ids, locked],
        dxPt: 3,
        dyPt: 4,
        unit: 'pt',
      },
      { action: 'move', targetIds: ids, dxPt: -1000, dyPt: 0, unit: 'pt' },
      { action: 'distribute', targetIds: ids, axis: 'horizontal', unit: 'pt' },
    ];
    for (const [index, payload] of invalid.entries()) {
      const version = document.version;
      const requestId = `invalid-group-${index}`;
      const errors = a.messages.filter(
        (m) => m.kind === 'protocolError',
      ).length;
      a.session.receive({ ...base, requestId, payload });
      await until(
        () =>
          a.messages.some(
            (m) => m.kind === 'editResult' && m.requestId === requestId,
          ) ||
          a.messages.filter((m) => m.kind === 'protocolError').length > errors,
        requestId,
      );
      assert.ok(
        a.messages.some(
          (m) =>
            m.kind === 'editResult' && m.requestId === requestId && !m.accepted,
        ) ||
          a.messages.filter((m) => m.kind === 'protocolError').length > errors,
      );
      assert.equal(document.getText(), source);
      assert.equal(document.version, version);
      assert.equal(document.isDirty, false);
    }
    const payload = {
      action: 'move',
      targetIds: ids,
      dxPt: 3,
      dyPt: 4,
      unit: 'pt',
    };
    a.session.receive({ ...base, requestId: 'group-a', payload });
    b.session.receive({ ...base, requestId: 'group-b-stale', payload });
    await until(
      () =>
        a.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === 'group-a',
        ) &&
        b.messages.some(
          (m) =>
            m.kind === 'protocolError' ||
            (m.kind === 'editResult' && m.requestId === 'group-b-stale'),
        ),
      'Group race settles',
    );
    assert.ok(
      a.messages.some(
        (m) =>
          m.kind === 'editResult' && m.requestId === 'group-a' && m.accepted,
      ),
    );
    assert.ok(
      !b.messages.some(
        (m) =>
          m.kind === 'editResult' &&
          m.requestId === 'group-b-stale' &&
          m.accepted,
      ),
    );
    await vscode.commands.executeCommand('undo');
    assert.equal(
      document.getText(),
      source,
      'Refused groups add no Undo steps',
    );
  } finally {
    a.dispose();
    b.dispose();
  }
}

/** An independent edit that makes identity ambiguous never lets a stale target replay. */
/** A nudge in one view is one shared document step; the other view only sees the snapshot. */
async function independentViewNudge(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-views-')), 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const first = observe(document),
    second = observe(document);
  try {
    const behind = projectReport(
      parse({
        uri: document.uri.toString(),
        version: document.version,
        source,
        eol: '\n',
      }),
    ).textboxes.find((t) => t.name === 'Behind')!.node.id;
    first.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId: 'view-a-nudge',
      baseVersion: document.version,
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: [behind],
        unit: 'pt',
        dxPt: 10,
        dyPt: 0,
      },
    });
    await until(
      () =>
        first.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === 'view-a-nudge',
        ),
      'view A result',
    );
    await until(
      () =>
        second.messages.some(
          (m) => m.kind === 'snapshot' && m.version === document.version,
        ),
      'view B snapshot',
    );
    assert.equal(
      second.messages.some((m) => m.kind === 'editResult'),
      false,
      'results stay with the requesting view',
    );
    await vscode.commands.executeCommand('undo');
    assert.equal(document.getText(), source, 'one shared native step');
  } finally {
    first.dispose();
    second.dispose();
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}

async function ambiguousIndependentChange(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-ambiguous-')),
    'report.rdlc',
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const view = observe(document);
  try {
    await until(
      () => view.messages.some((m) => m.kind === 'snapshot'),
      'Initial snapshot',
    );
    const front = projectReport(
      parse({
        uri: document.uri.toString(),
        version: document.version,
        source,
        eol: '\n',
      }),
    ).textboxes.find((t) => t.name === 'Front')!.node.id;
    const stale = {
      protocol: 2,
      kind: 'edit',
      requestId: 'stale-ambiguous',
      baseVersion: document.version,
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: [front],
        dxPt: 4,
        dyPt: 0,
        unit: 'pt',
      },
    };
    // Independent edit: an earlier sibling now shares the same name.
    const independent = source.replace(
      '<Textbox Name="Behind">',
      '<Textbox Name="Front">',
    );
    assert.notEqual(independent, source);
    await replaceSource(document, independent);
    await until(
      () =>
        view.messages.some(
          (m) => m.kind === 'snapshot' && m.version === document.version,
        ),
      'Independent snapshot published',
    );
    const errors = view.messages.filter(
      (m) => m.kind === 'protocolError',
    ).length;
    view.session.receive(stale);
    await until(
      () =>
        view.messages.filter((m) => m.kind === 'protocolError').length >
          errors ||
        view.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === stale.requestId,
        ),
      'Stale target settles',
    );
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(
      !view.messages.some(
        (m) =>
          m.kind === 'editResult' &&
          m.requestId === stale.requestId &&
          m.accepted,
      ),
    );
    assert.equal(document.getText(), independent, 'No replay or compensation');
  } finally {
    view.dispose();
  }
}

/** Concurrent views share one document queue: one duplicate applies, the other is stale. */
async function clipboardViewRace(): Promise<void> {
  const io = memory();
  const clipboard = new WindowClipboard(io);
  const document = await open('clipboard-dependencies');
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const a = view(document, clipboard);
  const b = view(document, clipboard);
  try {
    const id = projectReport(
      parse({ uri: 'x', version: 1, source: original, eol: '\n' }),
    ).textboxes.find((t) => t.name === 'Outside')!.node.id;
    const request = (requestId: string) => ({
      protocol: 2,
      kind: 'clipboard',
      requestId,
      baseVersion: document.version,
      action: 'duplicate',
      targetIds: [id],
      unit: 'pt',
    });
    a.session.receive(request('race-dup-a'));
    b.session.receive(request('race-dup-b'));
    await until(
      () =>
        a.messages.some((m) => m.kind === 'clipboardResult') &&
        b.messages.some(
          (m) => m.kind === 'clipboardResult' || m.kind === 'protocolError',
        ),
      'Concurrent duplicates settle',
    );
    assert.ok(
      a.messages.some((m) => m.kind === 'clipboardResult' && m.changed),
    );
    assert.ok(
      !b.messages.some((m) => m.kind === 'clipboardResult' && m.accepted),
      'the stale view is refused, never retried',
    );
    assert.equal(io.writes, 0, 'Duplicate never touches the clipboard');
    await vscode.commands.executeCommand('undo');
    assert.equal(document.getText(), original);
  } finally {
    a.dispose();
    b.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

// ---------------------------------------------------------------------------
// T052/T056 — captured native request lifecycle.
//
// `tests/desktop/context.spec.ts` lists these request classes as
// NOT_INJECTABLE from the Desktop surface, so the host suite owns them: a real
// DocumentSession over a real TextDocument, the real shared mutation queue and
// the real WindowContextRegistry. The stub panel only plays the designer half
// of the bridge, and `webview.postMessage` is exactly the delivery boundary
// `SidebarHostContext.dispatch` awaits, so every disturbance lands on a real
// await instead of being simulated around it.
// ---------------------------------------------------------------------------

/** The finite native action families the sidebar routes. */
type NativeKind = 'select' | 'properties' | 'create' | 'clipboard';

interface Rig {
  host: SidebarHostContext;
  session: DocumentSession;
  document: vscode.TextDocument;
  original: string;
  messages: HostMessage[];
  outcomes: ActionOutcomeMessage[];
  viewId: string;
  documentId: string;
  deliveries: number;
  delivered: NativeActionMessage[];
  registration: vscode.Disposable | null;
  subscriptions: vscode.Disposable[];
}

interface RaceEnv {
  readonly source: string;
  readonly directory: string;
  readonly notes: vscode.TextDocument;
  readonly other: vscode.TextDocument;
  readonly otherSource: string;
  readonly otherVersion: number;
}

/** A real source change injected during delivery; never a fake document patch. */
const DISTURBED = '<!-- disturbed during delivery -->';
/** Save As moves the lifetime to another URI through the host's own transition. */
const SAVED_URI = 'file:///saved-as/renamed.rdlc';

function textboxCount(source: string): number {
  return projectReport(
    parse({ uri: 'file:///count.rdlc', version: 1, source, eol: '\n' }),
  ).textboxes.length;
}

function bodyTarget(rig: Rig) {
  const evaluation = rig.host.evaluation;
  assert.ok(evaluation, 'the host keeps the active report evaluation');
  const bodies = new Set(
    (evaluation.scene?.items ?? [])
      .filter((item) => item.kind !== 'cell')
      .map((item) => item.id),
  );
  const target = evaluation.navigation.structure.nodes.find(
    (node) =>
      bodies.has(node.id) &&
      evaluation.ids.includes(node.id) &&
      node.capabilities.some(
        (capability) =>
          capability.operation === 'properties' && capability.eligible,
      ),
  );
  assert.ok(target, 'the fixture has an authored, selectable body item');
  return target;
}

async function openRig(options: {
  readonly file: string;
  readonly ready: boolean;
  readonly apply?: typeof vscode.workspace.applyEdit;
  readonly onDeliver: (rig: Rig) => Promise<boolean>;
}): Promise<Rig> {
  const document = await vscode.workspace.openTextDocument(options.file);
  await vscode.window.showTextDocument(document);
  const host = new SidebarHostContext();
  const session = new DocumentSession(
    document,
    options.apply,
    new WindowClipboard(memory()),
  );
  const rig: Rig = {
    host,
    session,
    document,
    original: document.getText(),
    messages: [],
    outcomes: [],
    viewId: '',
    documentId: '',
    deliveries: 0,
    delivered: [],
    registration: null,
    subscriptions: [],
  };
  rig.subscriptions = [
    session.onMessage((message) => rig.messages.push(message)),
    session.onActionOutcome((outcome) => rig.outcomes.push(outcome)),
  ];
  // The designer half of the bridge: this is the transport the host awaits.
  const panel = {
    active: false,
    visible: false,
    viewColumn: undefined,
    onDidChangeViewState: () => new vscode.Disposable(() => undefined),
    webview: {
      postMessage: async (input: unknown) => {
        rig.deliveries++;
        rig.delivered.push(input as NativeActionMessage);
        return options.onDeliver(rig);
      },
    },
  } as unknown as vscode.WebviewPanel;
  rig.registration = host.register(document, panel, session);
  const context = host.registry.context();
  rig.viewId = context.viewId ?? '';
  rig.documentId = context.documentId ?? '';
  assert.ok(rig.viewId, 'the same-document designer view is registered');
  assert.ok(rig.documentId, 'the report lifetime is registered');
  if (options.ready) {
    session.receive({ protocol: 2, kind: 'ready' });
    await until(() => session.isReady, 'designer rig ready');
  }
  return rig;
}

async function closeRig(rig: Rig): Promise<void> {
  // The host marks itself disposed first, so its registration teardown can
  // never re-route a lifetime the scenario already invalidated.
  rig.host.dispose();
  rig.registration?.dispose();
  for (const subscription of rig.subscriptions) subscription.dispose();
  rig.session.dispose();
  await vscode.window.showTextDocument(rig.document);
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

function assertOtherUntouched(env: RaceEnv, label: string): void {
  assert.equal(env.other.getText(), env.otherSource, `${label}: other report`);
  assert.equal(env.other.version, env.otherVersion, `${label}: other version`);
}

/** The designer half of the bridge: answer one delivered action exactly once. */
async function react(rig: Rig, action: NativeActionMessage): Promise<void> {
  const settle = (
    resultVersion: number,
    selectionSequence: number,
    accepted: boolean,
    reason?: string,
  ) =>
    rig.session.receive({
      protocol: 2,
      kind: 'actionOutcome',
      requestId: action.requestId,
      baseVersion: action.baseVersion,
      resultVersion,
      ...(accepted
        ? { status: 'accepted' as const }
        : { status: 'refused' as const, reason: reason ?? 'Refused' }),
      selectionSequence,
    });
  if (action.action === 'select') {
    rig.session.receive({
      protocol: 2,
      kind: 'acceptedSelection',
      version: action.baseVersion,
      viewId: action.viewId,
      sequence: 1,
      requestId: action.requestId,
      selection: {
        mode: 'body',
        targetIds: [...action.targetIds],
        primaryId: action.primaryId,
      },
    });
    settle(action.baseVersion, 1, true);
    return;
  }
  if (action.action === 'properties') {
    settle(action.baseVersion, 0, true);
    return;
  }
  let echo: string;
  if (action.action === 'create') {
    echo = `edit-${action.requestId}`;
    rig.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId: echo,
      nativeRequestId: action.requestId,
      baseVersion: action.baseVersion,
      targetId: rig.session.evaluation.syntax.root!.id,
      operation: 'author',
      payload: { action: 'createTextbox', left: '20pt', top: '20pt' },
    });
  } else if (action.action === 'clipboard') {
    echo = `clip-${action.requestId}`;
    rig.session.receive({
      protocol: 2,
      kind: 'clipboard',
      requestId: echo,
      nativeRequestId: action.requestId,
      baseVersion: action.baseVersion,
      action: action.clipboard,
      targetIds: [...action.targetIds],
      ...(action.unit ? { unit: action.unit } : {}),
    });
  } else {
    throw new Error(`The harness does not play ${action.action} actions`);
  }
  await until(
    () =>
      rig.messages.some(
        (message) =>
          (message.kind === 'editResult' ||
            message.kind === 'clipboardResult') &&
          message.requestId === echo,
      ),
    `${action.action} settles through the shared queue`,
  );
  const result = rig.messages.find(
    (
      message,
    ): message is
      | Extract<HostMessage, { kind: 'editResult' }>
      | Extract<HostMessage, { kind: 'clipboardResult' }> =>
      (message.kind === 'editResult' || message.kind === 'clipboardResult') &&
      message.requestId === echo,
  );
  assert.ok(result, `${action.action} produced its result`);
  settle(result.version, 0, result.accepted, result.reason);
}

type RegistryExpectation =
  | 'unchanged'
  | 'no-report'
  | 'no-view'
  | 'retargeted'
  | 'synced'
  | 'auto';

interface Disturbance {
  readonly id: string;
  /** A bound session only answers the readiness loop after the handshake. */
  readonly ready: boolean;
  readonly apply?: typeof vscode.workspace.applyEdit;
  /** Runs before authority is captured; may set up a queued mutation. */
  readonly setup?: (rig: Rig) => Promise<void>;
  /** The delivery boundary. Absent means the designer must never receive. */
  readonly deliver?: (rig: Rig) => Promise<boolean>;
  /** Runs while the request waits inside the bounded readiness loop. */
  readonly duringWait?: (rig: Rig) => Promise<void>;
  readonly terminal: 'accepted' | 'error';
  readonly reason: RegExp;
  readonly deliveries: number;
  readonly outcomes: number;
  readonly cancels: number;
  readonly registry: RegistryExpectation;
}

async function lifecycleCase(options: {
  readonly file: string;
  readonly kind: NativeKind;
  readonly disturbance: Disturbance;
  readonly env: RaceEnv;
}): Promise<void> {
  const { kind, disturbance, env } = options;
  const label = `${kind}/${disturbance.id}`;
  const rig = await openRig({
    file: options.file,
    ready: disturbance.ready,
    ...(disturbance.apply ? { apply: disturbance.apply } : {}),
    onDeliver:
      disturbance.deliver ??
      (async () => {
        throw new Error(`${label}: the request must never be delivered`);
      }),
  });
  try {
    if (disturbance.setup) await disturbance.setup(rig);
    rig.host.refreshFocus();
    const before = rig.host.registry.context();
    const request = requestFor(rig, kind);
    const running = rig.host.dispatch(request.intent, request.targetIds).then(
      (outcome) => ({ ok: true as const, outcome }),
      (error) => ({ ok: false as const, error }),
    );
    if (disturbance.duringWait) await disturbance.duringWait(rig);
    const settled = await running;

    // One terminal result, one delivery, no protocol noise, no lost capture.
    assert.equal(rig.deliveries, disturbance.deliveries, `${label}: delivery`);
    assert.equal(
      rig.outcomes.length,
      disturbance.outcomes,
      `${label}: terminal`,
    );
    assert.equal(
      rig.messages.filter((message) => message.kind === 'protocolError').length,
      0,
      `${label}: no protocol error`,
    );
    assert.equal(
      rig.messages.filter((message) => message.kind === 'nativeCancel').length,
      disturbance.cancels,
      `${label}: pending state cleared once`,
    );
    assert.equal(
      rig.host.registry.pendingCount,
      0,
      `${label}: capture settled`,
    );
    assertOtherUntouched(env, label);

    if (settled.ok) {
      assert.equal(
        disturbance.terminal,
        'accepted',
        `${label}: not accepted — ${settled.outcome.status} ${settled.outcome.reason ?? ''}`,
      );
      assert.equal(settled.outcome.status, 'accepted', label);
      assert.equal(
        settled.outcome.resultVersion > settled.outcome.baseVersion,
        kind === 'create' || kind === 'clipboard',
        `${label}: only a mutation advances the result version`,
      );
    } else {
      const failure =
        settled.error instanceof Error
          ? settled.error.message
          : String(settled.error);
      assert.equal(
        disturbance.terminal,
        'error',
        `${label}: unexpected acceptance — ${failure}`,
      );
      assert.ok(disturbance.reason.test(failure), `${label}: ${failure}`);
    }

    // Exact text: the action itself may only ever produce its own one step.
    const mutates =
      disturbance.id === 'queued-mutation' ||
      (disturbance.id === 'delayed' &&
        (kind === 'create' || kind === 'clipboard'));
    if (disturbance.id === 'edit')
      assert.equal(
        rig.document.getText(),
        rig.original +
          (rig.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') +
          DISTURBED,
        `${label}: only the injected source change`,
      );
    else if (mutates) {
      assert.equal(
        textboxCount(rig.document.getText()),
        textboxCount(rig.original) + 1,
        `${label}: exactly one created item`,
      );
      await history(rig.document, 'undo', rig.original);
      assert.equal(
        rig.document.getText(),
        rig.original,
        `${label}: one Undo step reverses it`,
      );
    } else assert.equal(rig.document.getText(), rig.original, `${label}: text`);

    // Exact routing state for this disturbance.
    const expectation: Exclude<RegistryExpectation, 'auto'> =
      disturbance.registry === 'auto'
        ? mutates
          ? 'synced'
          : 'unchanged'
        : disturbance.registry;
    const context = rig.host.registry.context();
    if (expectation === 'unchanged')
      assert.deepEqual(context, before, `${label}: routing context`);
    else if (expectation === 'no-report')
      assert.deepEqual(
        context,
        {
          state: 'no-report',
          documentId: null,
          uri: null,
          version: 0,
          generation: before.generation + 1,
          viewId: null,
        },
        label,
      );
    else if (expectation === 'no-view')
      assert.deepEqual(context, { ...before, viewId: null }, label);
    else if (expectation === 'retargeted') {
      assert.equal(context.documentId, before.documentId, label);
      assert.equal(context.uri, SAVED_URI, label);
      assert.equal(context.state, 'loading', label);
      assert.equal(context.generation, before.generation + 1, label);
    } else {
      await until(
        () => rig.host.registry.context().version === rig.document.version,
        `${label}: registry tracks the accepted document`,
      );
      const synced = rig.host.registry.context();
      assert.equal(synced.state, 'editable', label);
      assert.equal(synced.documentId, before.documentId, label);
      assert.equal(synced.viewId, before.viewId, label);
      assert.equal(synced.generation, before.generation, label);
    }
  } finally {
    await closeRig(rig);
  }
}

function requestFor(
  rig: Rig,
  kind: NativeKind,
): { readonly intent: NativeIntent; readonly targetIds: readonly string[] } {
  const target = bodyTarget(rig);
  switch (kind) {
    case 'create':
      return { intent: { action: 'create', create: 'textbox' }, targetIds: [] };
    case 'properties':
      return { intent: { action: 'properties' }, targetIds: [target.id] };
    case 'select':
      return {
        intent: { action: 'select', primaryId: target.id, additive: false },
        targetIds: [target.id],
      };
    case 'clipboard':
      return {
        intent: { action: 'clipboard', clipboard: 'duplicate', unit: 'pt' },
        targetIds: [target.id],
      };
  }
}

async function nativeRequestLifecycle(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-native-races-'));
  const otherFile = join(directory, 'other.rdlc');
  writeFileSync(otherFile, source);
  const other = await vscode.workspace.openTextDocument(otherFile);
  const notesFile = join(directory, 'notes.txt');
  writeFileSync(notesFile, 'plain notes, never a report\n');
  const notes = await vscode.workspace.openTextDocument(notesFile);
  const env: RaceEnv = {
    source,
    directory,
    notes,
    other,
    otherSource: other.getText(),
    otherVersion: other.version,
  };

  // A typed mutation parked in the real shared queue while a native action
  // delivers: the queue wins, the native action must never replay onto it.
  const queued: { blocked: boolean; release: () => void } = {
    blocked: false,
    release: () => undefined,
  };
  let queuedBase = 0;
  const apply: typeof vscode.workspace.applyEdit = async (edit, metadata) => {
    queued.blocked = true;
    await new Promise<void>((resolve) => {
      queued.release = resolve;
    });
    return vscode.workspace.applyEdit(edit, metadata);
  };

  const refusal = {
    terminal: 'error' as const,
    reason: /report or designer changed while the action was being delivered/,
    deliveries: 1,
    outcomes: 1,
    cancels: 1,
  };

  const disturbances: Disturbance[] = [
    {
      ...refusal,
      id: 'edit',
      ready: true,
      registry: 'synced',
      deliver: async (rig) => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(
          rig.document.uri,
          rig.document.positionAt(rig.document.getText().length),
          (rig.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') +
            DISTURBED,
        );
        assert.equal(await vscode.workspace.applyEdit(edit), true);
        return true;
      },
    },
    {
      ...refusal,
      id: 'context',
      ready: true,
      registry: 'no-report',
      deliver: async (rig) => {
        assert.ok(
          rig.host.registry.context().documentId,
          'still captured before the switch',
        );
        await vscode.window.showTextDocument(notes);
        return true;
      },
    },
    {
      ...refusal,
      id: 'view-close',
      ready: true,
      registry: 'no-view',
      deliver: async (rig) => {
        assert.equal(rig.host.registry.disposeView(rig.viewId), true);
        return true;
      },
    },
    {
      ...refusal,
      id: 'document-close',
      ready: true,
      registry: 'no-report',
      deliver: async (rig) => {
        assert.equal(rig.host.registry.closeDocument(rig.documentId), true);
        return true;
      },
    },
    {
      ...refusal,
      id: 'save-as',
      ready: true,
      registry: 'retargeted',
      deliver: async (rig) => {
        rig.host.registry.retarget(
          rig.documentId,
          SAVED_URI,
          rig.document.version,
        );
        return true;
      },
    },
    {
      ...refusal,
      id: 'session-disposed',
      ready: true,
      cancels: 0,
      registry: 'unchanged',
      deliver: async (rig) => {
        rig.session.dispose();
        return true;
      },
    },
    {
      ...refusal,
      id: 'post-false',
      reason: /^The designer did not accept the action\.$/,
      ready: true,
      registry: 'unchanged',
      deliver: async () => false,
    },
    {
      ...refusal,
      id: 'post-throw',
      reason: /^The designer did not accept the action\.$/,
      ready: true,
      registry: 'unchanged',
      deliver: async () => {
        throw new Error('the webview was disposed during delivery');
      },
    },
    {
      ...refusal,
      id: 'queued-mutation',
      ready: true,
      apply,
      registry: 'synced',
      setup: async (rig) => {
        queued.blocked = false;
        queuedBase = rig.document.version;
        rig.session.receive({
          protocol: 2,
          kind: 'edit',
          requestId: 'queued-behind-the-bridge',
          baseVersion: rig.document.version,
          targetId: rig.session.evaluation.syntax.root!.id,
          operation: 'author',
          payload: { action: 'createTextbox', left: '40pt', top: '40pt' },
        });
        await until(
          () => queued.blocked,
          'a typed mutation waits inside the shared queue',
        );
      },
      deliver: async (rig) => {
        queued.release();
        await until(
          () => rig.document.version > queuedBase,
          'the queued mutation lands first',
        );
        return true;
      },
    },
    {
      id: 'delayed',
      ready: true,
      terminal: 'accepted',
      reason: /./,
      deliveries: 1,
      outcomes: 1,
      cancels: 0,
      registry: 'auto',
      deliver: async (rig) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const action = rig.delivered.at(-1);
        assert.ok(action, 'the delayed request reached the designer');
        await react(rig, action);
        return true;
      },
    },
    {
      id: 'readiness',
      ready: false,
      terminal: 'error',
      reason: /no longer current: stale-document/,
      deliveries: 0,
      outcomes: 0,
      cancels: 0,
      registry: 'no-report',
      duringWait: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await vscode.window.showTextDocument(notes);
      },
    },
  ];

  const kinds: NativeKind[] = ['select', 'properties', 'create', 'clipboard'];
  let index = 0;
  let failed = false;
  let failure: unknown;
  try {
    for (const kind of kinds)
      for (const disturbance of disturbances) {
        const file = join(directory, `race-${++index}.rdlc`);
        writeFileSync(file, source);
        await lifecycleCase({ file, kind, disturbance, env });
      }
    assert.equal(index, 44, 'the parameterized lifecycle matrix is complete');
    await readinessTimeout(env);
    await duplicateOutcomeEcho(env);
    await duplicateTransportDelivery(env);
    await resultBeforeSnapshot(env);
    await snapshotBeforeResult(env);
    await captureRefusedInvalidSource(env);
    await captureRefusedNonReport(env);
    await staleSelectionEcho(env);
    await concurrentDuplicateDispatch(env);
  } catch (error) {
    failed = true;
    failure = error;
  }
  // The journey's own error must never be replaced by cleanup, and the temp
  // directory must go in both cases: collect first, then report together.
  const cleanup: unknown[] = [];
  cleanup.push(...(await closeOwnedEditors(directory)));
  try {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    cleanup.push(error);
  }
  if (failed && cleanup.length)
    throw new AggregateError(
      [failure, ...cleanup],
      'nativeRequestLifecycle and cleanup failed',
    );
  if (failed) throw failure;
  if (cleanup.length === 1) throw cleanup[0];
  if (cleanup.length)
    throw new AggregateError(cleanup, 'nativeRequestLifecycle cleanup failed');
}

/** The bounded readiness wait exhausts without delivering, opening or mutating. */
async function readinessTimeout(env: RaceEnv): Promise<void> {
  const label = 'readiness-timeout';
  const file = join(env.directory, 'readiness-timeout.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: false,
    onDeliver: async () => {
      throw new Error(`${label}: an unready session must not deliver`);
    },
  });
  try {
    const request = requestFor(rig, 'create');
    const started = Date.now();
    let failure: unknown;
    try {
      await rig.host.dispatch(request.intent, request.targetIds);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error, `${label}: the wait refuses`);
    assert.match(failure.message, /did not become ready/, label);
    assert.ok(
      Date.now() - started >= 14_000,
      `${label}: the bounded 15 s wait really expired`,
    );
    assert.equal(rig.deliveries, 0, `${label}: never delivered`);
    assert.equal(rig.outcomes.length, 0, `${label}: nothing to settle`);
    assert.equal(
      rig.host.registry.pendingCount,
      0,
      `${label}: capture settled`,
    );
    assert.equal(rig.document.getText(), rig.original, `${label}: no mutation`);
    assert.equal(
      rig.messages.filter((message) => message.kind === 'protocolError').length,
      0,
      label,
    );
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** Identical and conflicting outcome echoes keep exactly one terminal result. */
async function duplicateOutcomeEcho(env: RaceEnv): Promise<void> {
  const label = 'duplicate-outcome-echo';
  const file = join(env.directory, 'outcome-echo.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async (current) => {
      const action = current.delivered.at(-1);
      assert.ok(action, 'the request reached the designer');
      await react(current, action);
      const accepted = current.outcomes.at(-1);
      assert.ok(accepted, 'the designer settles the request once');
      current.session.receive({ ...accepted });
      current.session.receive({ ...accepted });
      current.session.receive({
        ...accepted,
        status: 'refused',
        reason: 'Conflicting duplicate',
      });
      return true;
    },
  });
  try {
    const request = requestFor(rig, 'create');
    const outcome = await rig.host.dispatch(request.intent, request.targetIds);
    assert.equal(outcome.status, 'accepted', label);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(rig.outcomes.length, 1, `${label}: one terminal result`);
    assert.equal(rig.deliveries, 1, `${label}: one delivery`);
    assert.equal(
      rig.messages.filter((message) => message.kind === 'protocolError').length,
      0,
      `${label}: duplicates are silent`,
    );
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: settled`);
    assert.equal(
      textboxCount(rig.document.getText()),
      textboxCount(rig.original) + 1,
      `${label}: one created item`,
    );
    await history(rig.document, 'undo', rig.original);
    assert.equal(
      rig.document.getText(),
      rig.original,
      `${label}: one Undo step`,
    );
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** A repeated transport envelope never reaches the webview twice. */
async function duplicateTransportDelivery(env: RaceEnv): Promise<void> {
  const label = 'duplicate-transport-delivery';
  const file = join(env.directory, 'duplicate-transport.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async (current) => {
      const action = current.delivered.at(-1);
      assert.ok(action, 'the request reached the designer');
      const again = await current.session.dispatchNativeAction(
        action,
        () => true,
        async () => {
          throw new Error('the transport delivered the same envelope twice');
        },
      );
      assert.equal(again.delivered, false, `${label}: no second delivery`);
      assert.match(
        String(again.reason),
        /Duplicate request/,
        `${label}: idempotent`,
      );
      assert.equal(current.deliveries, 1, `${label}: still one delivery`);
      await react(current, action);
      return true;
    },
  });
  try {
    const request = requestFor(rig, 'create');
    const outcome = await rig.host.dispatch(request.intent, request.targetIds);
    assert.equal(outcome.status, 'accepted', label);
    assert.equal(rig.deliveries, 1, `${label}: one delivery`);
    assert.equal(rig.outcomes.length, 1, `${label}: one terminal result`);
    assert.equal(
      rig.messages.filter((message) => message.kind === 'protocolError').length,
      0,
      label,
    );
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: settled`);
    assert.equal(
      textboxCount(rig.document.getText()),
      textboxCount(rig.original) + 1,
      `${label}: one created item`,
    );
    await history(rig.document, 'undo', rig.original);
    assert.equal(
      rig.document.getText(),
      rig.original,
      `${label}: one Undo step`,
    );
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** Result-before-snapshot: a refused native edit settles with no history. */
async function resultBeforeSnapshot(env: RaceEnv): Promise<void> {
  const label = 'result-before-snapshot';
  const file = join(env.directory, 'result-first.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async (current) => {
      const action = current.delivered.at(-1);
      assert.ok(action, 'the request reached the designer');
      const echo = `edit-${action.requestId}`;
      current.session.receive({
        protocol: 2,
        kind: 'edit',
        requestId: echo,
        nativeRequestId: action.requestId,
        baseVersion: action.baseVersion,
        targetId: action.targetIds[0],
        operation: 'author',
        payload: { action: 'deleteTextbox', confirm: 'not-confirmed' },
      });
      await until(
        () =>
          current.messages.some(
            (message) =>
              message.kind === 'editResult' && message.requestId === echo,
          ),
        'the refused authoring edit settles',
      );
      const result = current.messages.find(
        (message): message is Extract<HostMessage, { kind: 'editResult' }> =>
          message.kind === 'editResult' && message.requestId === echo,
      );
      assert.ok(result && !result.accepted, `${label}: the edit is refused`);
      current.session.receive({
        protocol: 2,
        kind: 'actionOutcome',
        requestId: action.requestId,
        baseVersion: action.baseVersion,
        resultVersion: result.version,
        status: 'refused',
        reason: result.reason,
        selectionSequence: 0,
      });
      return true;
    },
  });
  try {
    const intent: NativeIntent = {
      action: 'author',
      payload: { action: 'deleteTextbox', confirm: 'not-confirmed' },
    };
    const targetIds = [bodyTarget(rig).id];
    const before = rig.messages.length;
    const outcome = await rig.host.dispatch(intent, targetIds);
    assert.equal(outcome.status, 'refused', label);
    assert.ok(outcome.reason, `${label}: an accessible reason`);
    const seen = rig.messages.slice(before);
    const resultAt = seen.findIndex((message) => message.kind === 'editResult');
    const snapshotAt = seen.findIndex((message) => message.kind === 'snapshot');
    assert.ok(resultAt >= 0, `${label}: the result arrived`);
    assert.ok(
      snapshotAt > resultAt,
      `${label}: result first, snapshot second (${resultAt} vs ${snapshotAt})`,
    );
    assert.equal(rig.outcomes.length, 1, `${label}: one terminal result`);
    assert.equal(
      rig.messages.filter((message) => message.kind === 'nativeCancel').length,
      0,
      `${label}: the settled action is not cancelled again`,
    );
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: settled`);
    assert.equal(rig.document.getText(), rig.original, `${label}: no history`);
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** Snapshot-before-result: an accepted creation publishes before its result. */
async function snapshotBeforeResult(env: RaceEnv): Promise<void> {
  const label = 'snapshot-before-result';
  const file = join(env.directory, 'snapshot-first.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async (current) => {
      const action = current.delivered.at(-1);
      assert.ok(action, 'the request reached the designer');
      await react(current, action);
      return true;
    },
  });
  try {
    const request = requestFor(rig, 'create');
    const before = rig.messages.length;
    const outcome = await rig.host.dispatch(request.intent, request.targetIds);
    assert.equal(outcome.status, 'accepted', label);
    assert.equal(outcome.resultVersion, outcome.baseVersion + 1, label);
    const seen = rig.messages.slice(before);
    const resultAt = seen.findIndex((message) => message.kind === 'editResult');
    const snapshotAt = seen.findIndex((message) => message.kind === 'snapshot');
    assert.ok(snapshotAt >= 0, `${label}: the accepted snapshot arrived`);
    assert.ok(
      resultAt > snapshotAt,
      `${label}: snapshot first, result second (${snapshotAt} vs ${resultAt})`,
    );
    assert.equal(rig.outcomes.length, 1, `${label}: one terminal result`);
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: settled`);
    assert.equal(
      textboxCount(rig.document.getText()),
      textboxCount(rig.original) + 1,
      `${label}: one created item`,
    );
    await history(rig.document, 'undo', rig.original);
    assert.equal(
      rig.document.getText(),
      rig.original,
      `${label}: one Undo step`,
    );
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** An invalid source refuses the capture before any await, open or delivery. */
async function captureRefusedInvalidSource(env: RaceEnv): Promise<void> {
  const label = 'capture-refused-invalid-source';
  const file = join(env.directory, 'invalid-source.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async () => {
      throw new Error(`${label}: a refused capture must never deliver`);
    },
  });
  try {
    const request = requestFor(rig, 'create');
    await replaceSource(rig.document, '<Report');
    await until(
      () => rig.host.registry.context().state === 'invalid-source',
      `${label}: the host accepts the broken source`,
    );
    await assert.rejects(
      () => rig.host.dispatch(request.intent, request.targetIds),
      /Report action is unavailable: invalid-source\./,
      label,
    );
    assert.equal(rig.deliveries, 0, `${label}: never delivered`);
    assert.equal(rig.outcomes.length, 0, `${label}: nothing to settle`);
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: no pending`);
    assert.equal(rig.document.getText(), '<Report', `${label}: no history`);
    assert.equal(rig.document.isDirty, true, label);
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** Explicit non-report focus refuses the capture before any await or delivery. */
async function captureRefusedNonReport(env: RaceEnv): Promise<void> {
  const label = 'capture-refused-non-report';
  const file = join(env.directory, 'non-report.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async () => {
      throw new Error(`${label}: a refused capture must never deliver`);
    },
  });
  try {
    const request = requestFor(rig, 'select');
    await vscode.window.showTextDocument(env.notes);
    rig.host.refreshFocus();
    assert.equal(rig.host.registry.context().state, 'no-report', label);
    await assert.rejects(
      () => rig.host.dispatch(request.intent, request.targetIds),
      /Report action is unavailable: no-report\./,
      label,
    );
    assert.equal(rig.deliveries, 0, `${label}: never delivered`);
    assert.equal(rig.outcomes.length, 0, `${label}: nothing to settle`);
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: no pending`);
    assert.equal(rig.document.getText(), rig.original, `${label}: no history`);
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** Stale and duplicate selection echoes never move accepted selection. */
async function staleSelectionEcho(env: RaceEnv): Promise<void> {
  const label = 'stale-selection-echo';
  const file = join(env.directory, 'selection-echo.rdlc');
  writeFileSync(file, env.source);
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async (current) => {
      const action = current.delivered.at(-1);
      assert.ok(action, 'the request reached the designer');
      await react(current, action);
      const accepted = current.session.currentSelection;
      assert.ok(accepted, 'the selection was accepted once');
      current.session.receive({ ...accepted });
      // A late echo from the previous document version carries ids this
      // version never issued, so it must be ignored before it can move
      // anything: empty selection validates at any version.
      current.session.receive({
        protocol: 2,
        kind: 'acceptedSelection',
        version: accepted.version - 1,
        viewId: accepted.viewId,
        sequence: 2,
        selection: { mode: 'empty' },
      });
      return true;
    },
  });
  try {
    const request = requestFor(rig, 'select');
    const outcome = await rig.host.dispatch(request.intent, request.targetIds);
    assert.equal(outcome.status, 'accepted', label);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const selection = rig.session.currentSelection;
    assert.ok(selection, `${label}: accepted selection survives`);
    assert.equal(
      selection.sequence,
      1,
      `${label}: the older sequence is ignored`,
    );
    assert.equal(
      selection.selection.mode,
      'body',
      `${label}: the accepted selection is never replaced by an echo`,
    );
    assert.equal(rig.outcomes.length, 1, `${label}: one terminal result`);
    assert.equal(
      rig.messages.filter((message) => message.kind === 'protocolError').length,
      0,
      `${label}: stale echoes are silent`,
    );
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: settled`);
    assert.equal(rig.document.getText(), rig.original, `${label}: no history`);
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}

/** Two concurrent dispatches: one accepted mutation, one refused, never both. */
async function concurrentDuplicateDispatch(env: RaceEnv): Promise<void> {
  const label = 'concurrent-duplicate-dispatch';
  const file = join(env.directory, 'concurrent.rdlc');
  writeFileSync(file, env.source);
  let firstDone = false;
  const rig = await openRig({
    file,
    ready: true,
    onDeliver: async (current) => {
      const action = current.delivered.at(-1);
      assert.ok(action, 'the request reached the designer');
      if (current.deliveries === 1) {
        await react(current, action);
        firstDone = true;
        return true;
      }
      await until(
        () => firstDone,
        'the accepted request settles before the second delivers',
      );
      return true;
    },
  });
  try {
    const request = requestFor(rig, 'create');
    const settle = (running: Promise<ActionOutcomeMessage>) =>
      running.then(
        (outcome) => ({ ok: true as const, outcome }),
        (error) => ({ ok: false as const, error }),
      );
    // Both captures happen before either delivery, so only one can still be
    // authorized when the shared queue applies the accepted mutation.
    const first = settle(rig.host.dispatch(request.intent, request.targetIds));
    const second = settle(rig.host.dispatch(request.intent, request.targetIds));
    const [a, b] = await Promise.all([first, second]);
    if (!a.ok)
      assert.fail(
        `${label}: the first request is rejected — ${
          a.error instanceof Error ? a.error.message : String(a.error)
        }`,
      );
    assert.equal(a.outcome.status, 'accepted', label);
    if (b.ok)
      assert.fail(
        `${label}: the second request must be refused, got ${b.outcome.status}`,
      );
    assert.match(
      b.error instanceof Error ? b.error.message : String(b.error),
      /report or designer changed while the action was being delivered/,
      `${label}: the refusal names the changed authority`,
    );
    assert.equal(rig.deliveries, 2, `${label}: each capture delivered once`);
    assert.equal(rig.outcomes.length, 2, `${label}: one result per request`);
    assert.equal(
      rig.outcomes.filter((outcome) => outcome.status === 'accepted').length,
      1,
      `${label}: exactly one accepted mutation`,
    );
    assert.equal(
      rig.messages.filter((message) => message.kind === 'protocolError').length,
      0,
      label,
    );
    assert.equal(rig.host.registry.pendingCount, 0, `${label}: both settled`);
    assert.equal(
      textboxCount(rig.document.getText()),
      textboxCount(rig.original) + 1,
      `${label}: exactly one created item`,
    );
    await history(rig.document, 'undo', rig.original);
    assert.equal(
      rig.document.getText(),
      rig.original,
      `${label}: one Undo step`,
    );
    assertOtherUntouched(env, label);
  } finally {
    await closeRig(rig);
  }
}
