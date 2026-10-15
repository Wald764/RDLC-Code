import * as vscode from 'vscode';
import assert from 'node:assert/strict';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('rdlc-code.rdlc-code');
  assert.ok(extension, 'Extension must be discovered');
  await extension.activate();
  assert.ok(extension.isActive);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('rdlcCode.openSource'));
  assert.ok(commands.includes('rdlcCode.openDesigner'));
  const document = await vscode.workspace.openTextDocument({
    content: '<Report/>',
    language: 'xml',
  });
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('rdlcCode.openSource');
  assert.equal(vscode.window.activeTextEditor?.document.getText(), '<Report/>');
}
