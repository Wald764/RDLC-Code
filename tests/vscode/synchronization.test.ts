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

export async function run(): Promise<void> {
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
      protocol: 1,
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
      protocol: 1,
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
      protocol: 1,
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
      protocol: 1,
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
      protocol: 1,
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
