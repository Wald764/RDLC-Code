import * as vscode from 'vscode';

/** Reveal the original source for the active report; the host never rewrites it. */
export function openActiveSource(): Thenable<unknown> {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri =
    input instanceof vscode.TabInputCustom
      ? input.uri
      : vscode.window.activeTextEditor?.document.uri;
  return uri
    ? vscode.commands.executeCommand('vscode.openWith', uri, 'default')
    : Promise.resolve();
}

export function openActiveDesigner(): Thenable<unknown> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || !document.fileName.endsWith('.rdlc')) {
    void vscode.window.showInformationMessage(
      'Open a .rdlc report to use the RDLC designer.',
    );
    return Promise.resolve();
  }
  return vscode.commands.executeCommand(
    'vscode.openWith',
    document.uri,
    'rdlcCode.designer',
  );
}
