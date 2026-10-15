import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('rdlcCode.openSource', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document)
        await vscode.commands.executeCommand(
          'vscode.openWith',
          document.uri,
          'default',
        );
    }),
    vscode.commands.registerCommand('rdlcCode.openDesigner', async () => {
      await vscode.window.showInformationMessage(
        'RDLC editor foundations are installed. Visual editing is not available yet; use the source editor.',
      );
    }),
  );
}
