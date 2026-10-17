import * as vscode from 'vscode';
import { RdlcEditorProvider } from './editor-provider.js';
import {
  openActiveDesigner,
  openActiveSource,
} from './commands/open-source.js';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'rdlcCode.designer',
      new RdlcEditorProvider(context.extensionUri),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('rdlcCode.openSource', openActiveSource),
    vscode.commands.registerCommand(
      'rdlcCode.openDesigner',
      openActiveDesigner,
    ),
  );
}
