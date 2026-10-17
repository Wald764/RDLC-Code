import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { observe, replaceSource, until } from './session-checks.js';
import { FailingFileSystem } from './failing-file-system.js';
import type { AuthoringIntent } from '@rdlc/report-model/editing';

export async function run(): Promise<void> {
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
      await vscode.commands.executeCommand('undo');
      assert.equal(document.getText(), states[index], `Undo ${index}`);
    }
    assert.equal(document.isDirty, false);
    for (let index = 1; index <= 20; index++) {
      await vscode.commands.executeCommand('redo');
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
      await vscode.commands.executeCommand('undo');
      assert.equal(
        document.getText(),
        structural[index],
        `Structural undo ${index}`,
      );
    }
    for (let index = 1; index <= actions.length; index++) {
      await vscode.commands.executeCommand('redo');
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
