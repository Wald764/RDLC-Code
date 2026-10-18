import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { DocumentSession } from './document-session.js';
import { createNonce, renderWebviewHtml } from './webview.js';

/** A panel reveal alone is insufficient: verify the real active custom tab and URI. */
export async function activateHistoryTarget(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  viewType = 'rdlcCode.designer',
): Promise<boolean> {
  if (
    !panel.active ||
    !panel.visible ||
    panel.viewColumn === undefined ||
    document.isClosed
  )
    return false;
  panel.reveal(panel.viewColumn, false);
  await vscode.commands.executeCommand(
    'workbench.action.focusActiveEditorGroup',
  );
  const group = vscode.window.tabGroups.activeTabGroup;
  const tab = group.activeTab;
  return (
    panel.active &&
    panel.visible &&
    group.viewColumn === panel.viewColumn &&
    tab?.input instanceof vscode.TabInputCustom &&
    tab.input.viewType === viewType &&
    tab.input.uri.toString() === document.uri.toString()
  );
}

/** Custom editor host: source-preserving sessions over the packaged Angular surface. */
export class RdlcEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): void {
    const assets = vscode.Uri.joinPath(this.extensionUri, 'build', 'designer');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [assets],
    };
    const nonce = createNonce();
    panel.webview.html = renderWebviewHtml({
      index: readFileSync(
        vscode.Uri.joinPath(assets, 'index.html').fsPath,
        'utf8',
      ),
      assetsBase: panel.webview.asWebviewUri(assets).toString(),
      nonce,
      cspSource: panel.webview.cspSource,
    });
    const session = new DocumentSession(document, undefined, undefined, () =>
      activateHistoryTarget(document, panel),
    );
    const subscription = session.onMessage((message) => {
      void panel.webview.postMessage(message);
    });
    const receiver = panel.webview.onDidReceiveMessage((message) =>
      session.receive(message),
    );
    panel.onDidDispose(() => {
      receiver.dispose();
      subscription.dispose();
      session.dispose();
    });
  }
}
