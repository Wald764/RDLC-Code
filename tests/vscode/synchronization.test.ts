import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { observe, replaceSource, until } from './session-checks.js';
import { validateMessage } from '@rdlc/report-model/protocol';
import { FailingFileSystem } from './failing-file-system.js';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { WindowClipboard } from '../../apps/vscode-extension/src/clipboard.js';
import { memory, open, view } from './clipboard.test.js';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import { activateHistoryTarget } from '../../apps/vscode-extension/src/editor-provider.js';
import type { HostMessage } from '@rdlc/report-model/protocol';

export async function run(): Promise<void> {
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
        change === 'version' ? `<!-- external change -->\n${source}` : source,
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
