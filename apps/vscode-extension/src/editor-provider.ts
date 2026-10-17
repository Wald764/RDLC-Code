import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { DocumentSession } from './document-session.js';
import { createNonce, renderWebviewHtml } from './webview.js';

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
    const session = new DocumentSession(document);
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
