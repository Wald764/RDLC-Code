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
 *
 * The same applies to the request itself: a click inside the webview can reach
 * the host before the workbench has marked the panel active. The panel is first
 * awaited until it becomes active on its own; it is never revealed or focused
 * while inactive, so a document the user is not working in is never targeted.
 * Both phases share one overall deadline.
 *
 * `stillWanted` is re-checked once the panel is active, right before the reveal
 * and focus: the wait can be long, and a caller whose reason to take focus has
 * lapsed meanwhile must not have it taken late.
 */
export async function activateHistoryTarget(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  viewType = 'rdlcCode.designer',
  stillWanted?: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  const sleep = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  const owned = (): boolean =>
    panel.active &&
    panel.visible &&
    panel.viewColumn !== undefined &&
    !document.isClosed;
  while (!owned()) {
    if (document.isClosed || Date.now() >= deadline) return false;
    await sleep();
  }
  if (stillWanted && !stillWanted()) return false;
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
  while (!settled()) {
    if (Date.now() >= deadline) return false;
    await sleep();
  }
  return true;
}
