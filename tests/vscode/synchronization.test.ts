import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { observe, replaceSource, until } from './session-checks.js';
import { validateMessage } from '@rdlc/report-model/protocol';

export async function run(): Promise<void> {
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
    const stale = a.intent('delayed', 'Must not apply');
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
      interleaved.session.receive(
        interleaved.intent('interleaved', 'Interleaved source'),
      );
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
        document.getText().includes('Interleaved source'),
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
