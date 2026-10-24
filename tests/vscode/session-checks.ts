import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';

export async function until(
  check: () => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), label);
}

export async function history(
  document: vscode.TextDocument,
  command: 'undo' | 'redo',
  expected: string,
): Promise<void> {
  await vscode.commands.executeCommand(command);
  // Native commands can finish before the extension-host document receives the change.
  await until(
    () => document.getText() === expected,
    `${command} document sync`,
  );
}

export function observe(
  document: vscode.TextDocument,
  apply?: typeof vscode.workspace.applyEdit,
) {
  const session = new DocumentSession(document, apply);
  const messages: HostMessage[] = [];
  const listener = session.onMessage((message) => messages.push(message));
  session.receive({ protocol: 2, kind: 'ready' });
  const intent = (requestId: string, value: string) => {
    const syntax = parse({
      uri: document.uri.toString(),
      version: document.version,
      source: document.getText(),
      eol: '\n',
    });
    return {
      protocol: 2,
      kind: 'edit',
      requestId,
      baseVersion: document.version,
      targetId: projectReport(syntax).textboxes[0]!.node.id,
      operation: 'setProperty',
      payload: { property: 'text', value },
    };
  };
  return {
    session,
    messages,
    intent,
    dispose() {
      listener.dispose();
      session.dispose();
    },
  };
}

export async function replaceSource(
  document: vscode.TextDocument,
  source: string,
) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    ),
    source,
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}
