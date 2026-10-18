import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
          protocol: 1,
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
      protocol: 1,
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
      ['root', { action: 'createDataset', name: 'LifecycleData' }],
      ['dataset', { action: 'createField', name: 'Amount', type: 'decimal' }],
      [
        'root',
        {
          action: 'createTable',
          name: 'LifecycleTable',
          dataset: 'LifecycleData',
          field: 'Amount',
          width: '1in',
        },
      ],
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
        protocol: 1,
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
      protocol: 1,
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
    view.session.receive({ protocol: 1, kind: 'viewState', zoom: 2 });
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
      protocol: 1,
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
        protocol: 1,
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
