import * as vscode from 'vscode';

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
