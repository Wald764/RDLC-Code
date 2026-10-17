import * as vscode from 'vscode';

/** Deterministic disk-permission failure through the real VS Code document service. */
export class FailingFileSystem implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.emitter.event;
  failWrites = false;
  private modified = Date.now();
  constructor(public bytes: Uint8Array) {}
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }
  stat(): vscode.FileStat {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: this.modified,
      size: this.bytes.length,
    };
  }
  readFile(): Uint8Array {
    return this.bytes;
  }
  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    if (this.failWrites)
      throw vscode.FileSystemError.NoPermissions('Test volume is read-only');
    this.bytes = content;
    this.modified++;
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }
  readDirectory(): [string, vscode.FileType][] {
    return [];
  }
  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
  dispose(): void {
    this.emitter.dispose();
  }
}
