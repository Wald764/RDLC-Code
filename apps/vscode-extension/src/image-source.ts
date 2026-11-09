import * as vscode from 'vscode';
import type { ImageSource } from './image-import.js';

/** The VS Code file chooser and file system. Only the host ever sees a path or URI. */
export const vscodeImageSource: ImageSource = {
  async pick() {
    const [uri] =
      (await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Images: ['png', 'jpg', 'jpeg'] },
      })) ?? [];
    if (!uri) return 'cancelled';
    const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    return { uri, fileName };
  },
  async stat(uri) {
    return (await vscode.workspace.fs.stat(uri as vscode.Uri)).size;
  },
  async read(uri) {
    return vscode.workspace.fs.readFile(uri as vscode.Uri);
  },
};
