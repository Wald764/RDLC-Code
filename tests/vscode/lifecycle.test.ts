import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { history, observe, replaceSource, until } from './session-checks.js';
import { FailingFileSystem } from './failing-file-system.js';
import {
  resizeHandles,
  alignModes,
  type AuthoringIntent,
  type LayoutIntent,
} from '@rdlc/report-model/editing';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { toPoints } from '@rdlc/report-model/geometry';
import { WindowClipboard } from '../../apps/vscode-extension/src/clipboard.js';
import { memory, view } from './clipboard.test.js';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import {
  RdlcEditorProvider,
  activateHistoryTarget,
} from '../../apps/vscode-extension/src/editor-provider.js';
import { openActiveDesigner } from '../../apps/vscode-extension/src/commands/open-source.js';
import { SidebarHostContext } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import type { HostMessage } from '@rdlc/report-model/protocol';

async function directManipulation(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-direct-')), 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const view = observe(document);
  try {
    // Saving while the webview has not submitted an intent saves accepted content only.
    assert.equal(await document.save(), true);
    assert.equal(readFileSync(file, 'utf8'), source);
    for (const table of [false, true]) {
      for (const handle of ['move', ...resizeHandles] as const) {
        const snapshot = {
          uri: document.uri.toString(),
          version: document.version,
          source: document.getText(),
          eol: '\n' as const,
        };
        const report = projectReport(parse(snapshot));
        const item = table
          ? report.tables[0]!
          : report.textboxes.find((t) => t.context === 'body')!;
        const left = toPoints(item.bounds.left) ?? 0,
          top = toPoints(item.bounds.top) ?? 0;
        const width = table
          ? report.tables[0]!.columns.reduce(
              (s, c) => s + toPoints(c.width)!,
              0,
            )
          : toPoints(item.bounds.width)!;
        const height = table
          ? report.tables[0]!.rows.reduce((s, r) => s + toPoints(r.height)!, 0)
          : toPoints(item.bounds.height)!;
        const payload: LayoutIntent['payload'] =
          handle === 'move'
            ? {
                action: 'move',
                targetIds: [item.node.id],
                unit: 'pt',
                dxPt: 3,
                dyPt: 4,
              }
            : {
                action: 'resize',
                targetIds: [item.node.id],
                unit: 'pt',
                handle,
                ...(/[ew]/.test(handle)
                  ? { xPt: handle.includes('w') ? left + 1 : left + width + 5 }
                  : {}),
                ...(/[ns]/.test(handle)
                  ? { yPt: handle.includes('n') ? top + 1 : top + height + 5 }
                  : {}),
              };
        const requestId = `direct-${table}-${handle}`;
        view.session.receive({
          protocol: 2,
          kind: 'edit',
          requestId,
          baseVersion: snapshot.version,
          operation: 'layout',
          payload,
        });
        await until(
          () =>
            view.messages.some(
              (m) => m.kind === 'editResult' && m.requestId === requestId,
            ),
          requestId,
        );
        const result = view.messages.find(
          (m) => m.kind === 'editResult' && m.requestId === requestId,
        );
        assert.ok(
          result?.kind === 'editResult' && result.accepted && result.changed,
          JSON.stringify(result),
        );
        assert.equal(result.mappings[0]?.sourceId, item.node.id);
        const candidate = document.getText();
        assert.notEqual(candidate, snapshot.source);
        await history(document, 'undo', snapshot.source);
        assert.equal(
          document.getText(),
          snapshot.source,
          `One-step Undo ${requestId}`,
        );
        await history(document, 'redo', candidate);
        assert.equal(
          document.getText(),
          candidate,
          `One-step Redo ${requestId}`,
        );
        assert.equal(await document.save(), true);
        assert.equal(readFileSync(file, 'utf8'), candidate);
      }
    }
    const expected = document.getText();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    assert.equal(
      (await vscode.workspace.openTextDocument(file)).getText(),
      expected,
    );
  } finally {
    view.dispose();
  }
}

/** T080: twenty mixed accepted operations, then twenty native Undos and Redos. */
async function mixedHistory(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  )
    .replace(
      '<Top>18pt</Top><Left>12pt</Left><Height>36pt</Height><Width>144pt</Width>',
      '<Top>160pt</Top><Left>240pt</Left><Height>36pt</Height><Width>144pt</Width>',
    )
    .replace('<Top>1in</Top><Left>12pt', '<Top>320pt</Top><Left>480pt');
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-mixed-')), 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const v = view(document, new WindowClipboard(memory()));
  const project = () =>
    projectReport(
      parse({
        uri: document.uri.toString(),
        version: document.version,
        source: document.getText(),
        eol: '\n',
      }),
    );
  const item = (name: string) => {
    const report = project();
    return (report.tables.find((t) => t.name === name) ??
      report.textboxes.find((t) => t.name === name))!;
  };
  const ids = (...names: string[]) => names.map((name) => item(name).node.id);
  const corner = (name: string) => {
    const bounds = item(name).bounds;
    return {
      x: (toPoints(bounds.left) ?? 0) + (toPoints(bounds.width) ?? 0),
      y: (toPoints(bounds.top) ?? 0) + (toPoints(bounds.height) ?? 0),
    };
  };
  let count = 0;
  const layout = async (
    payload: LayoutIntent['payload'],
    base = document.version,
    refusal = false,
  ) => {
    const requestId = `mixed-${++count}`;
    const errors = v.messages.filter((m) => m.kind === 'protocolError').length;
    v.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId,
      baseVersion: base,
      operation: 'layout',
      payload,
    });
    await until(
      () =>
        v.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === requestId,
        ) ||
        (refusal &&
          v.messages.filter((m) => m.kind === 'protocolError').length > errors),
      requestId,
    );
    const result = v.messages.find(
      (m) => m.kind === 'editResult' && m.requestId === requestId,
    );
    return result?.kind === 'editResult' ? result : undefined;
  };
  const text = { unit: 'pt' as const };
  /** Each accepted step yields its source and the names its result selects. */
  const steps: (() => Promise<string[]>)[] = [
    ...(['horizontal', 'vertical'] as const).map((axis) => async () => {
      const r = await layout({
        ...text,
        action: 'distribute',
        axis,
        targetIds: ids('Front', 'LaterTie', 'OrdersTable'),
      });
      assert.ok(r?.accepted && r.changed, JSON.stringify(r));
      return ['Front', 'LaterTie', 'OrdersTable'];
    }),
    ...(
      [
        [['Front', 'LaterTie', 'OrdersTable'], 9, 7],
        [['Front'], 3, 4],
        [['Behind'], 1, 0],
        [['Behind'], 0, 10],
      ] as const
    ).map(([names, dxPt, dyPt]) => async () => {
      const r = await layout({
        ...text,
        action: 'move',
        targetIds: ids(...names),
        dxPt,
        dyPt,
      });
      assert.ok(r?.accepted && r.changed, JSON.stringify(r));
      return [...names];
    }),
    ...(
      [
        ['Front', 'se', 6],
        ['Front', 'nw', -2],
        ['OrdersTable', 'se', 12],
        ['OrdersTable', 'e', -6],
      ] as const
    ).map(([name, handle, delta]) => async () => {
      const { x, y } = corner(name);
      const bounds = item(name).bounds;
      const r = await layout({
        ...text,
        action: 'resize',
        targetIds: ids(name),
        handle,
        xPt: handle === 'nw' ? (toPoints(bounds.left) ?? 0) - delta : x + delta,
        ...(handle === 'e'
          ? {}
          : {
              yPt:
                handle === 'nw'
                  ? (toPoints(bounds.top) ?? 0) - delta
                  : y + delta,
            }),
      });
      assert.ok(r?.accepted && r.changed, JSON.stringify(r));
      return [name];
    }),
    ...(['top', 'center', 'right', 'bottom'] as const).map(
      (mode) => async () => {
        const targetIds = ids('Front', 'LaterTie', 'OrdersTable');
        const r = await layout({
          ...text,
          action: 'align',
          mode,
          targetIds,
          primaryId: targetIds[1]!,
        });
        assert.ok(r?.accepted && r.changed, JSON.stringify(r));
        return ['Front', 'LaterTie', 'OrdersTable'];
      },
    ),
    ...['Front', 'Behind'].map((name) => async () => {
      const r = await v.send('duplicate', [name]);
      assert.ok(r.changed, r.reason);
      return [];
    }),
    async () => {
      assert.ok((await v.send('copy', ['Behind'])).accepted);
      const r = await v.send('paste');
      assert.ok(r.changed, r.reason);
      return [];
    },
    async () => {
      const r = await v.send('paste');
      assert.ok(r.changed, r.reason);
      return [];
    },
    async () => {
      const r = await v.send('cut', ['LaterTie']);
      assert.ok(r.changed, r.reason);
      assert.equal(r.removed.length, 1);
      return ['Front'];
    },
    async () => {
      const r = await layout({
        ...text,
        action: 'move',
        targetIds: ids('Front', 'OrdersTable'),
        dxPt: -4,
        dyPt: 2,
      });
      assert.ok(r?.accepted && r.changed, JSON.stringify(r));
      return ['Front', 'OrdersTable'];
    },
  ];
  assert.equal(steps.length, 20);
  /** Rejected, stale, cancelled and no-op requests: zero text/history change. */
  const inert = async () => {
    const before = document.getText();
    const noop = await layout({
      ...text,
      action: 'move',
      targetIds: ids('Front'),
      dxPt: 0,
      dyPt: 0,
    });
    assert.ok(noop?.accepted && !noop.changed, JSON.stringify(noop));
    const scene = v.messages.findLast(
      (m) => m.kind === 'snapshot' && m.version === document.version,
    );
    assert.ok(scene?.kind === 'snapshot');
    const preserved = scene.scene!.items.find((i) => i.kind === 'preserved')!;
    const locked = await layout(
      {
        ...text,
        action: 'align',
        mode: 'left',
        targetIds: [...ids('Front'), preserved.id],
        primaryId: ids('Front')[0]!,
      },
      document.version,
      true,
    );
    assert.equal(locked?.accepted ?? false, false, 'locked member refuses');
    const errors = v.messages.length;
    await layout(
      { ...text, action: 'move', targetIds: ids('Front'), dxPt: 1, dyPt: 1 },
      document.version - 1,
      true,
    );
    assert.ok(v.messages.length > errors, 'stale request settles');
    assert.equal((await v.send('copy', ['Front'])).changed, false);
    assert.equal(document.getText(), before);
  };
  const states = [{ source, selected: [] as string[] }];
  try {
    for (const [index, step] of steps.entries()) {
      const selected = await step();
      states.push({ source: document.getText(), selected });
      assert.notEqual(
        states[index]!.source,
        document.getText(),
        `Step ${index}`,
      );
      if (index % 5 === 4) await inert();
    }
    const names = (s: string) =>
      new Set(
        [
          ...projectReport(
            parse({ uri: 'x', version: 1, source: s, eol: '\n' }),
          ).textboxes,
          ...projectReport(
            parse({ uri: 'x', version: 1, source: s, eol: '\n' }),
          ).tables,
        ].map((i) => i.name),
      );
    // Selection survives by unambiguous structural name at each restored state.
    const check = (index: number, label: string) => {
      assert.equal(document.getText(), states[index]!.source, label);
      const present = names(states[index]!.source);
      for (const name of states[index]!.selected)
        assert.ok(present.has(name), `${label}: ${name} selectable`);
    };
    for (let index = 19; index >= 0; index--) {
      await history(document, 'undo', states[index]!.source);
      check(index, `Mixed undo ${index}`);
    }
    assert.equal(document.isDirty, false);
    for (let index = 1; index <= 20; index++) {
      await history(document, 'redo', states[index]!.source);
      check(index, `Mixed redo ${index}`);
    }
    assert.equal(await document.save(), true);
    assert.equal(readFileSync(file, 'utf8'), states[20]!.source);
  } finally {
    v.dispose();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
}

export async function run(): Promise<void> {
  await sourceOnlyOpening();
  await editorSessionInit();
  await mvpTextboxJourney();
  await guardedHistoryTargets('\n');
  await guardedHistoryTargets('\r\n');
  await mixedHistory();
  await directManipulation();
  await arrangement();
  await nudging();
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/textboxes/supported.rdlc'),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-life-')), 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const view = observe(document);
  const states = [source];
  try {
    for (let index = 1; index <= 20; index++) {
      view.session.receive(view.intent(`lifecycle-${index}`, `Edit ${index}`));
      await until(
        () =>
          view.messages.filter((m) => m.kind === 'editResult').length === index,
        `Edit ${index}`,
      );
      assert.ok(
        view.messages.some(
          (m) =>
            m.kind === 'editResult' &&
            m.requestId === `lifecycle-${index}` &&
            m.accepted,
        ),
      );
      states.push(document.getText());
    }
    assert.equal(document.isDirty, true);
    for (let index = 19; index >= 0; index--) {
      await history(document, 'undo', states[index]!);
      assert.equal(document.getText(), states[index], `Undo ${index}`);
    }
    assert.equal(document.isDirty, false);
    for (let index = 1; index <= 20; index++) {
      await history(document, 'redo', states[index]!);
      assert.equal(document.getText(), states[index], `Redo ${index}`);
    }
    assert.equal(await document.save(), true);
    assert.equal(document.isDirty, false);
    assert.equal(readFileSync(file, 'utf8'), states[20]);
    const structural = [document.getText()];
    const actions: readonly [string, AuthoringIntent['payload']][] = [
      ['root', { action: 'createDataset' }],
      ['dataset', { action: 'createField', name: 'Amount', type: 'decimal' }],
      ['root', { action: 'createTable', left: '0in', top: '0in' }],
      ['table', { action: 'setTableDataset', dataset: 'DataSet1' }],
      ['table', { action: 'addColumn', field: 'Amount', width: '1in' }],
      [
        'table',
        {
          action: 'addGroup',
          name: 'LifecycleGroup',
          expression: '=Fields!Amount.Value',
        },
      ],
      [
        'table',
        {
          action: 'addTotal',
          field: 'Amount',
          scope: 'LifecycleGroup',
          column: '0',
        },
      ],
    ];
    for (const [index, [target, payload]] of actions.entries()) {
      const snapshot = view.messages.findLast((m) => m.kind === 'snapshot');
      assert.ok(snapshot?.kind === 'snapshot' && snapshot.authoring);
      const state = snapshot.authoring;
      const requestId = `structural-${index}`;
      view.session.receive({
        protocol: 2,
        kind: 'edit',
        requestId,
        baseVersion: document.version,
        targetId:
          target === 'root'
            ? state.id
            : target === 'dataset'
              ? state.datasets[0]!.id
              : state.tables[0]!.id,
        operation: 'author',
        payload,
      });
      await until(
        () =>
          view.messages.some(
            (m) => m.kind === 'editResult' && m.requestId === requestId,
          ),
        requestId,
      );
      assert.ok(
        view.messages.some(
          (m) =>
            m.kind === 'editResult' && m.requestId === requestId && m.accepted,
        ),
      );
      structural.push(document.getText());
    }
    for (let index = actions.length - 1; index >= 0; index--) {
      await history(document, 'undo', structural[index]!);
      assert.equal(
        document.getText(),
        structural[index],
        `Structural undo ${index}`,
      );
    }
    for (let index = 1; index <= actions.length; index++) {
      await history(document, 'redo', structural[index]!);
      assert.equal(
        document.getText(),
        structural[index],
        `Structural redo ${index}`,
      );
    }
    assert.equal(await document.save(), true);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const reopened = await vscode.workspace.openTextDocument(file);
    assert.equal(reopened.getText(), structural.at(-1));
    await vscode.window.showTextDocument(reopened);
    await replaceSource(
      reopened,
      reopened.getText().replace('Edit 20', 'Explicitly discarded'),
    );
    assert.equal(reopened.isDirty, true);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
    assert.equal(
      (await vscode.workspace.openTextDocument(file)).getText(),
      structural.at(-1),
    );
  } finally {
    view.dispose();
  }
  const volume = new FailingFileSystem(Buffer.from(source));
  const registration = vscode.workspace.registerFileSystemProvider(
    'rdlc-failure',
    volume,
  );
  const failed = await vscode.workspace.openTextDocument(
    vscode.Uri.parse('rdlc-failure:/pending.rdlc'),
  );
  const failureView = observe(failed);
  try {
    failureView.session.receive(
      failureView.intent('before-failed-save', 'Pending after failure'),
    );
    await until(
      () =>
        failureView.messages.some((m) => m.kind === 'editResult' && m.accepted),
      'Pending change',
    );
    const pending = failed.getText();
    volume.failWrites = true;
    assert.equal(
      await failed.save(),
      false,
      'Permission failure is reported by the native save service',
    );
    assert.equal(failed.isDirty, true);
    assert.equal(failed.getText(), pending);
    assert.equal(Buffer.from(volume.bytes).toString(), source);
    volume.failWrites = false;
    assert.equal(await failed.save(), true);
    assert.equal(Buffer.from(volume.bytes).toString(), pending);
  } finally {
    failureView.dispose();
    registration.dispose();
    volume.dispose();
  }
}

async function mvpTextboxJourney(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-mvp-')), 'title.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  const observed = observe(document);
  try {
    const root = parse({
      uri: document.uri.toString(),
      version: document.version,
      source,
      eol: '\n',
    }).root!;
    observed.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId: 'mvp-title',
      baseVersion: document.version,
      targetId: root.id,
      operation: 'author',
      payload: { action: 'createTextbox', left: '0in', top: '0in' },
    });
    await until(
      () =>
        observed.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === 'mvp-title',
        ),
      'MVP Title creation',
    );
    const creation = observed.messages.find(
      (m) => m.kind === 'editResult' && m.requestId === 'mvp-title',
    );
    assert.ok(
      creation?.kind === 'editResult' && creation.created?.name === 'Textbox1',
      JSON.stringify(creation),
    );
    for (const [property, value] of Object.entries({
      name: 'Title',
      text: 'Quarterly report',
      left: '12pt',
      top: '24pt',
      width: '3in',
      height: '0.5in',
      fontFamily: 'Arial',
      fontSize: '18pt',
      color: '#123456',
    })) {
      const requestId = `mvp-${property}`;
      observed.session.receive({
        ...observed.intent(requestId, value),
        payload: { property, value },
      });
      await until(
        () =>
          observed.messages.some(
            (m) => m.kind === 'editResult' && m.requestId === requestId,
          ),
        requestId,
      );
      const result = observed.messages.find(
        (m) => m.kind === 'editResult' && m.requestId === requestId,
      );
      assert.ok(
        result?.kind === 'editResult' && result.accepted,
        JSON.stringify(result),
      );
    }
    const accepted = document.getText();
    observed.session.receive({
      ...observed.intent('mvp-invalid-width', ''),
      payload: { property: 'width', value: '-1in' },
    });
    await until(
      () =>
        observed.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === 'mvp-invalid-width',
        ),
      'MVP invalid size refusal',
    );
    assert.equal(document.getText(), accepted);
    const projected = projectReport(
      parse({
        uri: document.uri.toString(),
        version: document.version,
        source: accepted,
        eol: '\n',
      }),
    );
    assert.equal(projected.textboxes.length, 1);
    assert.equal(projected.textboxes[0]!.name, 'Title');
    assert.equal(projected.textboxes[0]!.style.color, '#123456');
    assert.equal(await document.save(), true);
    assert.equal(readFileSync(file, 'utf8'), accepted);
    await vscode.window.showTextDocument(document);
    const tabs = () =>
      vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs.filter(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === document.uri.toString(),
        ),
      );
    assert.ok(tabs().length > 0);
    assert.equal(await vscode.window.tabGroups.close(tabs()), true);
    assert.equal(tabs().length, 0);
    const reopened = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(reopened);
    assert.equal(tabs().length, 1);
    assert.equal(reopened.getText(), accepted);
  } finally {
    observed.dispose();
  }
}

async function guardedHistoryTargets(eol: '\n' | '\r\n'): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/textboxes/supported.rdlc'),
    'utf8',
  ).replace(/\r?\n/g, eol);
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-history-guards-')),
    'report.rdlc',
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  const independentChange =
    source +
    (document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') +
    '<!-- Independent source change -->';
  for (const mode of ['unverifiable', 'activation-race'] as const) {
    const messages: HostMessage[] = [];
    const session = new DocumentSession(
      document,
      undefined,
      undefined,
      mode === 'activation-race'
        ? async () => {
            await replaceSource(document, independentChange);
            return true;
          }
        : undefined,
    );
    session.onMessage((message) => messages.push(message));
    session.receive({ protocol: 2, kind: 'ready' });
    await until(
      () => messages.some((m) => m.kind === 'snapshot'),
      'History guard ready',
    );
    const before = document.version;
    session.receive({
      protocol: 2,
      kind: 'history',
      requestId: mode,
      baseVersion: before,
      action: 'undo',
    });
    await until(() => messages.some((m) => m.kind === 'historyResult'), mode);
    const result = messages.find((m) => m.kind === 'historyResult');
    assert.ok(result?.kind === 'historyResult' && !result.accepted);
    assert.equal(result.changed, mode === 'activation-race');
    assert.equal(
      document.getText(),
      mode === 'activation-race' ? independentChange : source,
    );
    const count = messages.length;
    session.dispose();
    session.receive({
      protocol: 2,
      kind: 'history',
      requestId: 'disposed-history',
      baseVersion: document.version,
      action: 'undo',
    });
    assert.equal(messages.length, count);
  }
}

/** Held-repeat nudges arrive as one accumulated move; navigation never reaches the host. */
async function nudging(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-nudge-')), 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const view = observe(document);
  const nudge = async (requestId: string, targetId: string, dxPt: number) => {
    view.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId,
      baseVersion: document.version,
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: [targetId],
        unit: 'pt',
        dxPt,
        dyPt: 0,
      },
    });
    await until(
      () =>
        view.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === requestId,
        ),
      requestId,
    );
    const result = view.messages.find(
      (m) => m.kind === 'editResult' && m.requestId === requestId,
    );
    assert.ok(result?.kind === 'editResult', requestId);
    return result;
  };
  try {
    const behind = () =>
      projectReport(
        parse({
          uri: document.uri.toString(),
          version: document.version,
          source: document.getText(),
          eol: '\n',
        }),
      ).textboxes.find((t) => t.name === 'Behind')!;
    // Navigation/preferences have no host channel: the closed protocol refuses them.
    const version = document.version;
    view.session.receive({ protocol: 2, kind: 'viewState', zoom: 2 });
    await until(
      () => view.messages.some((m) => m.kind === 'protocolError'),
      'view state refused',
    );
    assert.equal(document.version, version);
    assert.equal(document.isDirty, false);
    // Seven held repeats: one move, one native Undo step.
    const held = await nudge('held', behind().node.id, 7);
    assert.ok(held.accepted && held.changed, JSON.stringify(held));
    const once = document.getText();
    const heldId = held.mappings[0]!.resultId!;
    // Consecutive presses retarget through the result mapping, not reselection.
    const second = await nudge('second', heldId, 1);
    assert.ok(second.accepted, JSON.stringify(second));
    assert.equal(second.mappings[0]?.sourceId, heldId);
    assert.equal(
      second.mappings[0]?.resultId,
      behind().node.id,
      'selection survives the accepted nudge',
    );
    const twice = document.getText();
    await history(document, 'undo', once);
    assert.equal(document.getText(), once, 'each press is one Undo step');
    await history(document, 'undo', source);
    assert.equal(document.getText(), source, 'held repeat is one Undo step');
    await history(document, 'redo', once);
    await history(document, 'redo', twice);
    assert.equal(document.getText(), twice);
    // A nudge captured before native Undo/Redo is stale and never replays.
    const refusals = () =>
      view.messages.filter(
        (m) =>
          m.kind === 'protocolError' ||
          (m.kind === 'editResult' && m.requestId === 'stale'),
      ).length;
    const before = refusals();
    view.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId: 'stale',
      baseVersion: held.version,
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: [heldId],
        unit: 'pt',
        dxPt: 1,
        dyPt: 0,
      },
    });
    await until(() => refusals() > before, 'stale nudge refused');
    assert.equal(document.getText(), twice);
  } finally {
    view.dispose();
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}

async function arrangement(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  )
    .replace(
      '<Top>18pt</Top><Left>12pt</Left><Height>36pt</Height><Width>144pt</Width>',
      '<Top>160pt</Top><Left>240pt</Left><Height>36pt</Height><Width>144pt</Width>',
    )
    .replace('<Top>1in</Top><Left>12pt', '<Top>320pt</Top><Left>480pt');
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-arrange-')),
    'report.rdlc',
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const view = observe(document);
  try {
    for (const action of [
      'move',
      ...alignModes,
      'horizontal',
      'vertical',
    ] as const) {
      const report = projectReport(
        parse({
          uri: document.uri.toString(),
          version: document.version,
          source: document.getText(),
          eol: '\n',
        }),
      );
      const targetIds = [
        report.textboxes.find((t) => t.name === 'Front')!.node.id,
        report.textboxes.find((t) => t.name === 'LaterTie')!.node.id,
        report.tables[0]!.node.id,
      ];
      const common = { targetIds, unit: 'pt' as const };
      const payload: LayoutIntent['payload'] =
        action === 'move'
          ? { ...common, action, dxPt: 9, dyPt: 7 }
          : action === 'horizontal' || action === 'vertical'
            ? { ...common, action: 'distribute', axis: action }
            : {
                ...common,
                action: 'align',
                mode: action,
                primaryId: targetIds[1]!,
              };
      const requestId = `arrange-${action}`;
      view.session.receive({
        protocol: 2,
        kind: 'edit',
        requestId,
        baseVersion: document.version,
        operation: 'layout',
        payload,
      });
      await until(
        () =>
          view.messages.some(
            (m) => m.kind === 'editResult' && m.requestId === requestId,
          ),
        requestId,
      );
      const result = view.messages.find(
        (m) => m.kind === 'editResult' && m.requestId === requestId,
      );
      assert.ok(
        result?.kind === 'editResult' && result.accepted && result.changed,
        JSON.stringify(result),
      );
      assert.deepEqual(
        result.mappings.map((m) => m.sourceId),
        targetIds,
      );
      const scene = view.messages.findLast(
        (m) => m.kind === 'snapshot' && m.version === result.version,
      );
      assert.ok(scene?.kind === 'snapshot');
      assert.ok(
        result.mappings.every((m) =>
          scene.scene?.items.some((i) => i.id === m.resultId),
        ),
      );
      const candidate = document.getText();
      assert.notEqual(candidate, source);
      await history(document, 'undo', source);
      assert.equal(document.getText(), source, `One-step group Undo ${action}`);
      await history(document, 'redo', candidate);
      assert.equal(
        document.getText(),
        candidate,
        `One-step group Redo ${action}`,
      );
      await history(document, 'undo', source);
      assert.equal(document.getText(), source);
    }
  } finally {
    view.dispose();
  }
}

/**
 * Close every editor this test owns and prove each one is gone before the
 * temporary directory is removed: a surviving tab keeps the platform file
 * watcher on that directory and the removal fails with EPERM on Windows.
 * Every owned document is reverted through the promptless revert-and-close
 * command, so nothing can pause on an unsaved-changes dialog.
 */
export async function closeOwnedEditors(directory: string): Promise<unknown[]> {
  const problems: unknown[] = [];
  // Compare on the unique temporary directory name: the host may expose the
  // short or the long form of the parent path, and both must still match.
  const marker = `/${basename(directory).toLowerCase()}/`;
  const inside = (uri: vscode.Uri): boolean =>
    uri.scheme === 'file' &&
    uri.fsPath.toLowerCase().replace(/\\/g, '/').includes(marker);
  const tabs = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        const input = tab.input;
        return (
          (input instanceof vscode.TabInputText ||
            input instanceof vscode.TabInputCustom) &&
          inside(input.uri)
        );
      });
  // One pass closes one generation of editors. A document can own several
  // (source tab and designer tab, or a source tab per group), so repeat until
  // nothing is left instead of assuming a single close removed everything.
  const deadline = Date.now() + 5000;
  let survivors = tabs();
  let passes = 0;
  while (survivors.length > 0 && passes < 5 && Date.now() < deadline) {
    passes++;
    for (const tab of survivors)
      if (tab.input instanceof vscode.TabInputCustom) {
        try {
          await vscode.window.tabGroups.close([tab], true);
        } catch (error) {
          problems.push(error);
        }
      }
    for (const entry of vscode.workspace.textDocuments.filter((document) =>
      inside(document.uri),
    )) {
      if (entry.isClosed) continue;
      try {
        await vscode.window.showTextDocument(entry);
        await vscode.commands.executeCommand(
          'workbench.action.revertAndCloseActiveEditor',
        );
      } catch (error) {
        problems.push(error);
      }
    }
    survivors = tabs();
    if (survivors.length > 0)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  while (survivors.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    survivors = tabs();
  }
  if (survivors.length > 0)
    problems.push(
      new Error(
        `Editors are still open after close: ${survivors
          .map((tab) => tab.label)
          .join(', ')}`,
      ),
    );
  return problems;
}

/**
 * Narrow interception of this extension instance's command API: only the
 * product's `vscode.openWith` for one document is redirected to the test's
 * owned viewType, so the product's own open implementation runs while the
 * panel it opens stays observable. VS Code hands every extension its own API
 * object, so this sees only calls made through this test's instance — the
 * production extension's own `rdlcCode.openDesigner` command is deliberately
 * not involved. Every other command is delegated untouched and `restore()`
 * puts the original back.
 */
function interceptDesignerOpen(
  uri: vscode.Uri,
  ownedViewType: string,
): { readonly requests: string[]; restore(): void } {
  const commands = vscode.commands as {
    executeCommand: typeof vscode.commands.executeCommand;
  };
  const delegate = commands.executeCommand;
  const requests: string[] = [];
  const intercepted = (command: string, ...args: unknown[]) => {
    if (command === 'vscode.openWith' && String(args[0]) === uri.toString()) {
      requests.push(String(args[1]));
      return delegate('vscode.openWith', uri, ownedViewType, ...args.slice(2));
    }
    return delegate(command, ...args);
  };
  try {
    commands.executeCommand =
      intercepted as typeof vscode.commands.executeCommand;
  } catch (error) {
    throw new Error(
      `This extension's command API cannot be intercepted: ${String(error)}`,
    );
  }
  if (commands.executeCommand === delegate)
    throw new Error(
      "This extension's command API did not accept the interceptor.",
    );
  return {
    requests,
    restore: () => {
      commands.executeCommand = delegate;
    },
  };
}

/**
 * T052: editable A starts with only its source editor. Inspection and Code XML
 * stay host-side, an explicit Angular-dependent action opens A's own designer
 * exactly once through the existing public custom-editor path, and a disposed
 * panel is never rebound over its replacement.
 */
async function sourceOnlyOpening(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
    'utf8',
  );
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-open-once-'));
  const file = join(directory, 'a.rdlc');
  const otherFile = join(directory, 'b.rdlc');
  const notesFile = join(directory, 'notes.txt');
  writeFileSync(file, source);
  writeFileSync(otherFile, source);
  writeFileSync(notesFile, 'plain notes, never a report\n');
  const document = await vscode.workspace.openTextDocument(file);
  const other = await vscode.workspace.openTextDocument(otherFile);
  const notes = await vscode.workspace.openTextDocument(notesFile);
  await vscode.window.showTextDocument(document);

  const owned = 'rdlcTests.sourceOnlyOpening';
  const host = new SidebarHostContext();
  // Owned so cleanup can dispose the real panels before removing the directory.
  const resolved: vscode.WebviewPanel[] = [];
  let registration: vscode.Disposable | null = null;
  let restoreCommands: (() => void) | null = null;
  let failed = false;
  let failure: unknown;
  try {
    const extension = vscode.extensions.all.find(
      (entry) => entry.packageJSON.name === 'rdlc-code',
    );
    assert.ok(
      extension,
      'the development extension ships the packaged designer',
    );
    const inner = new RdlcEditorProvider(extension.extensionUri, host);
    let resolveFailure: unknown;
    registration = vscode.window.registerCustomEditorProvider(
      owned,
      {
        resolveCustomTextEditor(target, panel) {
          resolved.push(panel);
          try {
            inner.resolveCustomTextEditor(target, panel);
          } catch (error) {
            // Recorded for the assertion below, still rethrown for VS Code.
            resolveFailure = error;
            throw error;
          }
        },
      },
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
      },
    );
    // The product's own open path; only the panel's viewType is redirected.
    const open = interceptDesignerOpen(document.uri, owned);
    restoreCommands = open.restore;
    const marker = `/${basename(directory).toLowerCase()}/`;
    const inside = (uri: vscode.Uri): boolean =>
      uri.scheme === 'file' &&
      uri.fsPath.toLowerCase().replace(/\\/g, '/').includes(marker);
    const designers = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => {
          const input = tab.input;
          return (
            input instanceof vscode.TabInputCustom &&
            input.viewType === owned &&
            inside(input.uri)
          );
        });
    const facts = () => {
      const evaluation = host.evaluation;
      assert.ok(evaluation, 'the host keeps the active report evaluation');
      return evaluation;
    };
    const documentId = host.registry.context().documentId;
    const terminated: {
      requestId: string;
      reason: string;
    }[] = [];
    assert.equal(host.registry.context().state, 'editable');
    assert.ok(documentId, 'A has a document lifetime');
    assert.equal(host.registry.context().viewId, null);
    assert.equal(designers().length, 0, 'A starts with only its source editor');

    // Host-only inspection and Code XML open no designer and stay unbound.
    const inspected = host.registry.capture('host-inspect', 'inspect', [
      facts().sourceIds[0]!,
    ]);
    assert.ok(inspected.ok);
    assert.equal(inspected.capture.viewId, null);
    const opaque = facts().sourceIds.find((id) => !facts().ids.includes(id));
    assert.ok(opaque, 'the fixture has source-only syntax');
    await host.openSource(opaque);
    assert.equal(designers().length, 0, 'Code XML opens no designer');
    assert.equal(host.registry.context().viewId, null, 'source stays unbound');
    host.registry.settle(inspected.capture);

    // A mutation refused while the source is broken opens nothing either.
    await replaceSource(document, '<Report');
    await until(
      () => host.registry.context().state === 'invalid-source',
      'the host accepts the broken source',
    );
    assert.deepEqual(host.registry.capture('refused-create', 'create', []), {
      ok: false,
      reason: 'invalid-source',
    });
    assert.equal(designers().length, 0, 'a refused capture opens nothing');
    await replaceSource(document, source);
    await until(
      () => host.registry.context().state === 'editable',
      'the host accepts the valid source again',
    );

    // The restored source is byte-identical and clean, so the explicit open
    // is the only thing this step does to A.
    assert.equal(
      document.getText(),
      source,
      'the restored source is byte-identical',
    );
    assert.equal(await document.save(), true, 'A saves back to its own bytes');
    assert.equal(
      document.isDirty,
      false,
      'A is clean before the explicit open',
    );
    const text = document.getText();
    const version = document.version;

    // The product's exported open implementation, called with this test's own
    // command API instance so the only rewritten argument is the panel's
    // viewType. The `rdlcCode.openDesigner` command itself is registered in
    // the production extension's API instance and is not exercised here.
    await vscode.window.showTextDocument(document);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      document.uri.toString(),
      'A is the active source editor before the explicit open',
    );
    await openActiveDesigner();
    assert.deepEqual(
      open.requests,
      ['rdlcCode.designer'],
      'the product implementation asks to open A exactly once',
    );
    await until(
      () => resolved.length >= 1,
      'the existing editor provider resolves',
    );
    assert.equal(
      resolveFailure,
      undefined,
      `the existing editor provider resolved cleanly: ${String(resolveFailure)}`,
    );
    assert.equal(
      resolved.length,
      1,
      'the existing editor provider resolves exactly once',
    );
    await until(
      () => designers().length === 1,
      'exactly one owned designer tab for A',
    );
    assert.equal(document.getText(), text, 'opening writes no report history');
    assert.equal(document.version, version, 'opening writes no report version');

    // Read the association back from A's own source editor: the product's own
    // viewType would claim the panel tab, this test's one cannot.
    await vscode.window.showTextDocument(document);
    await until(
      () => host.registry.context().viewId !== null,
      'A binds its own opened panel',
    );
    const opened = host.registry.context().viewId!;
    assert.equal(
      host.registry.context().documentId,
      documentId,
      'the same document lifetime survives the open',
    );

    // A later action reuses the surviving panel instead of opening another.
    const reused = host.registry.capture('reuse-select', 'select', [
      facts().sourceIds[0]!,
    ]);
    assert.ok(reused.ok);
    assert.equal(reused.capture.viewId, opened, 'the capture carries the view');
    assert.deepEqual(host.registry.bind(reused.capture, opened), {
      ok: false,
      reason: 'already-bound',
    });
    host.registry.settle(reused.capture);
    assert.deepEqual(
      open.requests,
      ['rdlcCode.designer'],
      'reuse issues no second open',
    );
    assert.equal(designers().length, 1, 'reuse opens nothing');

    // Disposal during use terminates the bound authority with no replacement.
    const stop = host.registry.onDidTerminate((event) =>
      terminated.push({
        requestId: event.capture.requestId,
        reason: event.reason,
      }),
    );
    const pending = host.registry.capture('before-close', 'select', [
      facts().sourceIds[0]!,
    ]);
    assert.ok(pending.ok);
    assert.equal(pending.capture.viewId, opened);
    resolved[0]!.dispose();
    await until(
      () => designers().length === 0,
      'the disposed panel closes its tab',
    );
    // Back on A's source editor: the panel is gone, so is its association.
    await vscode.window.showTextDocument(document);
    await until(
      () => host.registry.context().viewId === null,
      'the disposed panel unbinds',
    );
    assert.deepEqual(
      terminated.map((event) => `${event.requestId}:${event.reason}`),
      ['before-close:view-disposed'],
    );
    assert.equal(host.registry.revalidate(pending.capture), 'disposed-view');
    stop();

    // A second explicit open creates a fresh panel; the dead capture stays dead.
    await vscode.window.showTextDocument(document);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      document.uri.toString(),
      'A is the active source editor before the second open',
    );
    await openActiveDesigner();
    assert.deepEqual(
      open.requests,
      ['rdlcCode.designer', 'rdlcCode.designer'],
      'each explicit open issues one request',
    );
    await until(
      () => resolved.length === 2,
      'the reopened panel resolves once',
    );
    await vscode.window.showTextDocument(document);
    await until(
      () => host.registry.context().viewId !== null,
      'the reopened panel registers',
    );
    const reopened = host.registry.context().viewId!;
    assert.notEqual(reopened, opened, 'a disposed panel is never reused');
    assert.deepEqual(host.registry.bind(pending.capture, reopened), {
      ok: false,
      reason: 'already-bound',
    });
    assert.equal(host.registry.revalidate(pending.capture), 'disposed-view');

    // A source, A designer, B and non-report focus never cross authority.
    host.registry.focusView(reopened);
    assert.equal(host.registry.context().viewId, reopened);
    host.registry.focusDocument(documentId!);
    assert.equal(
      host.registry.context().viewId,
      reopened,
      'source keeps the last surviving designer of A',
    );
    await vscode.window.showTextDocument(other);
    assert.notEqual(host.registry.context().documentId, documentId);
    assert.equal(
      host.registry.context().viewId,
      null,
      'B never borrows A\u2019s view',
    );
    await vscode.window.showTextDocument(notes);
    assert.equal(host.registry.context().state, 'no-report');
    await vscode.window.showTextDocument(document);
    const restored = host.registry.context();
    assert.equal(restored.documentId, documentId);
    assert.equal(restored.viewId, reopened, 'A reclaims its own designer');
    assert.equal(designers().length, 1, 'routing opens nothing');
    assert.equal(open.requests.length, 2, 'routing never reopens A');
    assert.equal(document.getText(), text, 'routing writes no report history');
  } catch (error) {
    failed = true;
    failure = error;
  }
  // The journey's own error must never be replaced by cleanup, and the temp
  // directory must go in both cases: collect first, then report together.
  const cleanup: unknown[] = [];
  if (restoreCommands) {
    try {
      restoreCommands();
    } catch (error) {
      cleanup.push(error);
    }
  }
  try {
    registration?.dispose();
    host.dispose();
  } catch (error) {
    cleanup.push(error);
  }
  // A live WebviewPanel keeps its document open, and that keeps the platform
  // file watcher on the directory; dispose the owned panels before removing it.
  for (const panel of resolved) {
    try {
      panel.dispose();
    } catch (error) {
      cleanup.push(error);
    }
  }
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
      'sourceOnlyOpening and cleanup failed',
    );
  if (failed) throw failure;
  if (cleanup.length === 1) throw cleanup[0];
  if (cleanup.length)
    throw new AggregateError(cleanup, 'sourceOnlyOpening cleanup failed');
}

/**
 * The editor provider's own composition: one DocumentSession per explicit
 * open, an early accepted snapshot for that exact document version, and no
 * report text or history written by opening itself.
 */
async function editorSessionInit(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-session-init-'));
  const file = join(directory, 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const type = 'rdlcTests.sessionInit';
  const host = new SidebarHostContext();
  const resolved: string[] = [];
  const sessions: { session: DocumentSession; messages: HostMessage[] }[] = [];
  // Owned so cleanup can dispose the real panels before removing the directory.
  const panels: vscode.WebviewPanel[] = [];
  let registration: vscode.Disposable | null = null;
  let restoreCommands: (() => void) | null = null;
  let failed = false;
  let failure: unknown;
  try {
    registration = vscode.window.registerCustomEditorProvider(
      type,
      {
        resolveCustomTextEditor(target, panel) {
          resolved.push(target.uri.toString());
          panels.push(panel);
          panel.webview.html = '<html><body>Session init proof</body></html>';
          const session = new DocumentSession(
            target,
            undefined,
            undefined,
            () => activateHistoryTarget(target, panel, type),
          );
          const messages: HostMessage[] = [];
          session.onMessage((message) => messages.push(message));
          const sidebar = host.register(target, panel, session);
          panel.onDidDispose(() => {
            sidebar.dispose();
            session.dispose();
          });
          sessions.push({ session, messages });
          session.receive({ protocol: 2, kind: 'ready' });
        },
      },
      { supportsMultipleEditorsPerDocument: true },
    );
    const open = interceptDesignerOpen(document.uri, type);
    restoreCommands = open.restore;
    assert.equal(host.registry.context().state, 'editable');
    const text = document.getText();
    const version = document.version;
    // The product's exported open implementation on this test's own command
    // API instance; only the panel's viewType is redirected.
    await vscode.window.showTextDocument(document);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      document.uri.toString(),
      'the report is the active source editor before the explicit open',
    );
    await openActiveDesigner();
    assert.deepEqual(
      open.requests,
      ['rdlcCode.designer'],
      'the product implementation asks to open the report once',
    );
    await until(() => resolved.length === 1, 'one editor resolution');
    await until(() => sessions.length === 1, 'one session');
    // The panel tab took focus, so read the association from A's source editor.
    await vscode.window.showTextDocument(document);
    await until(
      () => host.registry.context().viewId !== null,
      'the session registers once',
    );
    await until(
      () =>
        sessions[0]!.messages.some(
          (message) =>
            message.kind === 'snapshot' && message.version === version,
        ),
      'the session publishes its accepted snapshot during init',
    );
    assert.equal(sessions[0]!.session.isReady, true, 'handshake completes');
    assert.equal(document.getText(), text, 'opening writes no report text');
    assert.equal(document.version, version, 'opening writes no history');
    await vscode.window.showTextDocument(document);
    await until(
      () => host.registry.context().viewId !== null,
      'A reclaims its own session',
    );
    assert.equal(
      resolved.length,
      1,
      'focus changes never re-resolve the editor',
    );
    assert.deepEqual(
      open.requests,
      ['rdlcCode.designer'],
      'focus changes never re-open the editor',
    );
  } catch (error) {
    failed = true;
    failure = error;
  }
  // The journey's own error must never be replaced by cleanup, and the temp
  // directory must go in both cases: collect first, then report together.
  const cleanup: unknown[] = [];
  if (restoreCommands) {
    try {
      restoreCommands();
    } catch (error) {
      cleanup.push(error);
    }
  }
  try {
    registration?.dispose();
    host.dispose();
  } catch (error) {
    cleanup.push(error);
  }
  // A live WebviewPanel keeps its document open, and that keeps the platform
  // file watcher on the directory; dispose the owned panels before removing it.
  for (const panel of panels) {
    try {
      panel.dispose();
    } catch (error) {
      cleanup.push(error);
    }
  }
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
      'editorSessionInit and cleanup failed',
    );
  if (failed) throw failure;
  if (cleanup.length === 1) throw cleanup[0];
  if (cleanup.length)
    throw new AggregateError(cleanup, 'editorSessionInit cleanup failed');
}
