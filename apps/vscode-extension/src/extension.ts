import * as vscode from 'vscode';
import { RdlcEditorProvider } from './editor-provider.js';
import { windowClipboard } from './document-session.js';
import { SidebarHostContext } from './sidebar/host-context.js';
import { SidebarViews } from './sidebar/views.js';
import { newReport } from './commands/new-report.js';
import {
  openActiveDesigner,
  openActiveSource,
} from './commands/open-source.js';

export function activate(context: vscode.ExtensionContext): void {
  const sidebar = new SidebarHostContext();
  const views = new SidebarViews(sidebar);
  context.subscriptions.push(
    sidebar,
    views,
    vscode.commands.registerCommand('rdlcCode.newReport', newReport),
    vscode.window.registerCustomEditorProvider(
      'rdlcCode.designer',
      new RdlcEditorProvider(context.extensionUri, sidebar),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      },
    ),
    vscode.commands.registerCommand('rdlcCode.openSource', openActiveSource),
    vscode.commands.registerCommand(
      'rdlcCode.openDesigner',
      openActiveDesigner,
    ),
    // Captures never outlive the window session or reach disk.
    { dispose: () => windowClipboard.dispose() },
  );
}
