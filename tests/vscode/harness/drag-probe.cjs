/* global require, exports, process */
/* eslint-disable @typescript-eslint/no-require-imports -- The test extension entry point uses VS Code's CommonJS loader. */
const vscode = require('vscode');
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const mime = 'application/vnd.rdlc-code.native-drag-probe';

exports.activate = (context) => {
  const row = { label: 'Textbox drag probe' };
  context.subscriptions.push(
    // Authoritative trust signal for the desktop driver: the public API value,
    // written beside the harness' own global storage (never the product's).
    vscode.commands.registerCommand('rdlcTests.reportWorkspaceTrust', () => {
      const dir = context.globalStorageUri.fsPath;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'workspace-trust.json'),
        JSON.stringify({ isTrusted: vscode.workspace.isTrusted }),
      );
      return vscode.workspace.isTrusted;
    }),
    vscode.commands.registerCommand('rdlcTests.showNativeDrag', async () => {
      await vscode.commands.executeCommand(
        'setContext',
        'rdlcTests.nativeDragEnabled',
        true,
      );
      await vscode.commands.executeCommand('rdlcTests.nativeDrag.focus');
    }),
    vscode.window.createTreeView('rdlcTests.nativeDrag', {
      treeDataProvider: {
        getChildren: (parent) => (parent ? [] : [row]),
        getTreeItem: () => new vscode.TreeItem(row.label),
      },
      dragAndDropController: {
        dragMimeTypes: [mime],
        dropMimeTypes: [],
        handleDrag: (items, transfer, token) => {
          if (
            token.isCancellationRequested ||
            items.length !== 1 ||
            items[0] !== row
          )
            return;
          transfer.set(
            mime,
            new vscode.DataTransferItem('rdlc-native-probe-v1'),
          );
          const log = process.env.RDLC_NATIVE_DRAG_LOG;
          if (log)
            appendFileSync(
              log,
              JSON.stringify({ event: 'handleDrag', mime }) + '\n',
            );
        },
      },
    }),
  );
};
