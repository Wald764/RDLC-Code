import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';

const fixture = resolve(
  __dirname,
  '../../../tests/fixtures/textboxes/supported-plus-opaque.rdlc',
);
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

export async function run(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-code-us1-'));
  const file = join(directory, 'report.rdlc');
  writeFileSync(file, readFileSync(fixture, 'utf8'));
  const uri = vscode.Uri.file(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const session = new DocumentSession(document);
  const messages: HostMessage[] = [];
  const subscription = session.onMessage((message) => messages.push(message));
  const snapshots = () =>
    messages.filter(
      (message): message is Extract<HostMessage, { kind: 'snapshot' }> =>
        message.kind === 'snapshot',
    );
  const results = () =>
    messages.filter(
      (message): message is Extract<HostMessage, { kind: 'editResult' }> =>
        message.kind === 'editResult',
    );
  const awaitResults = async (count: number, label: string) => {
    await waitFor(
      () =>
        results().length >= count ||
        messages.some((message) => message.kind === 'protocolError'),
      label,
    );
    const error = messages.find((message) => message.kind === 'protocolError');
    if (error && error.kind === 'protocolError')
      throw new Error(`protocolError while awaiting ${label}: ${error.reason}`);
  };

  try {
    session.receive({ protocol: 1, kind: 'ready' });
    await waitFor(() => snapshots().length > 0, 'initial snapshot');
    const first = snapshots().at(-1)!;
    const titleIndex = first.scene!.items.findIndex(
      (item) => item.name === 'Title',
    );
    const richIndex = first.scene!.items.findIndex(
      (item) => item.name === 'Rich',
    );
    assert.ok(titleIndex >= 0 && richIndex >= 0);
    // Item ids are scoped to a document version, so each intent re-resolves the
    // current id from the latest snapshot, like the design surface does.
    const currentId = (index: number) =>
      snapshots().at(-1)!.scene!.items[index]!.id;

    let sequence = 0;
    const edit = (targetId: string, property: string, value: string) => {
      sequence += 1;
      session.receive({
        protocol: 1,
        kind: 'edit',
        requestId: `us1-${sequence}`,
        baseVersion: document.version,
        targetId,
        operation: 'setProperty',
        payload: { property, value },
      });
    };

    edit(currentId(titleIndex), 'name', 'Heading');
    await awaitResults(1, 'rename result');
    assert.equal(results()[0]!.accepted, true, results()[0]!.reason);
    edit(currentId(titleIndex), 'text', 'Updated & safe');
    await awaitResults(2, 'text result');
    assert.equal(results()[1]!.accepted, true, results()[1]!.reason);
    edit(currentId(titleIndex), 'left', '0.5in');
    await awaitResults(3, 'geometry result');
    assert.equal(results()[2]!.accepted, true, results()[2]!.reason);

    const edited = document.getText();
    assert.ok(edited.includes('Name="Heading"'));
    assert.ok(edited.includes('Updated &amp; safe'));
    assert.ok(edited.includes('<Left>0.5in</Left>'));
    assert.ok(edited.includes('<x:Chart xmlns:x="urn:rdlc-code:extension"'));

    edit(currentId(richIndex), 'text', 'should not apply');
    await awaitResults(4, 'refusal result');
    assert.equal(results()[3]!.accepted, false);
    assert.equal(results()[3]!.diagnostics[0]?.code, 'CAPABILITY_BLOCKED');
    assert.equal(document.getText(), edited);

    await document.save();
    const reopened = await vscode.workspace.openTextDocument(uri);
    assert.equal(reopened.getText(), edited);

    const bytes = readFileSync(file, 'utf8');
    await document.save();
    assert.equal(readFileSync(file, 'utf8'), bytes);

    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      'rdlcCode.designer',
    );
    await delay(500);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    await delay(500);
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      uri.toString(),
    );
    assert.equal(vscode.window.activeTextEditor?.document.getText(), edited);
  } finally {
    subscription.dispose();
    session.dispose();
  }
}
