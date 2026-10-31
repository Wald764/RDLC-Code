import * as vscode from 'vscode';

/** How long the workbench may take to settle on the revealed panel. */
const SETTLE_TIMEOUT_MS = 2_000;
const SETTLE_POLL_MS = 25;

/**
 * A panel reveal alone is insufficient: verify the real active custom tab and
 * URI. The workbench applies a reveal and a focus command asynchronously (macOS
 * can lag behind them), so the check is awaited until it holds: a history
 * command sent while the previously active editor still owns the workbench would
 * undo that editor's document instead.
 */
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
  const settled = (): boolean => {
    const group = vscode.window.tabGroups.activeTabGroup;
    const tab = group.activeTab;
    return (
      panel.active &&
      panel.visible &&
      !document.isClosed &&
      group.viewColumn === panel.viewColumn &&
      tab?.input instanceof vscode.TabInputCustom &&
      tab.input.viewType === viewType &&
      tab.input.uri.toString() === document.uri.toString()
    );
  };
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (!settled()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
  return true;
}
