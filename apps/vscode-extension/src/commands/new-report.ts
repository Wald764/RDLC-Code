import * as vscode from 'vscode';
import { blankReport } from '../templates/blank-report.js';

export async function newReport(): Promise<vscode.TextDocument> {
  const initial = await vscode.workspace.openTextDocument({
    language: 'xml',
    content: blankReport,
  });
  await vscode.commands.executeCommand(
    'vscode.openWith',
    initial.uri,
    'rdlcCode.designer',
  );
  // View-type switches may replace the text model; return the live document.
  return vscode.workspace.openTextDocument(initial.uri);
}
