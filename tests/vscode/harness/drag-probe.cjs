/* global require, exports, process, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- The test extension entry point uses VS Code's CommonJS loader. */
const vscode = require('vscode');
const {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
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
    // Deterministic file opening for the desktop driver: the driver writes
    // `open-request.json` ({ id, path, viewType? }) beside the harness' own
    // global storage, runs this fixed-title command, and reads the outcome
    // from `open-result.json`. It replaces Quick Open file search, whose
    // result row sometimes never appears. The editor opens in the active
    // group, as a regular (non-preview) tab, and takes focus, like Quick Open.
    vscode.commands.registerCommand('rdlcTests.openRequestedFile', async () => {
      const dir = context.globalStorageUri.fsPath;
      mkdirSync(dir, { recursive: true });
      // A failure to write the outcome must not surface as a command error:
      // the driver then reports its own timeout instead.
      const report = (result) => {
        try {
          writeFileSync(join(dir, 'open-result.json'), JSON.stringify(result));
        } catch {
          // The driver times out and names the missing result.
        }
      };
      let request;
      try {
        request = JSON.parse(
          readFileSync(join(dir, 'open-request.json'), 'utf8'),
        );
      } catch (error) {
        report({ id: null, ok: false, error: `unreadable request: ${error}` });
        return;
      }
      const { id, path, viewType } = request;
      try {
        const uri = vscode.Uri.file(path);
        const options = { preview: false, preserveFocus: false };
        if (viewType)
          await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            viewType,
            options,
          );
        else await vscode.commands.executeCommand('vscode.open', uri, options);
        // The tab group can lag the open command: poll briefly for the match.
        const describe = () => {
          const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
          const input = tab && tab.input;
          const opened = input && input.uri ? input.uri.fsPath : undefined;
          const actual = input && input.viewType ? input.viewType : 'text';
          let error;
          if (opened !== uri.fsPath)
            error = `active tab is ${opened ?? 'not a file editor'}`;
          else if (viewType && actual !== viewType)
            error = `active tab uses ${actual}, not ${viewType}`;
          return { opened, viewType: actual, error };
        };
        const deadline = Date.now() + 2_000;
        let state = describe();
        while (state.error && Date.now() < deadline) {
          await new Promise((done) => setTimeout(done, 50));
          state = describe();
        }
        const { error, ...seen } = state;
        report({ id, ok: !error, ...seen, ...(error ? { error } : {}) });
      } catch (error) {
        report({ id, ok: false, error: String(error) });
      }
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
