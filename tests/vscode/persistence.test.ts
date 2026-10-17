import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { replaceSource, until } from './session-checks.js';

export async function run(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/textboxes/supported.rdlc'),
    'utf8',
  );
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-persist-'));
  for (const encoding of ['utf8', 'utf8bom', 'utf16le'] as const) {
    const text = source.replace(/\r?\n/g, '\r\n');
    const bytes =
      encoding === 'utf16le'
        ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')])
        : Buffer.concat([
            encoding === 'utf8bom'
              ? Buffer.from([239, 187, 191])
              : Buffer.alloc(0),
            Buffer.from(text),
          ]);
    const file = join(directory, `${encoding}.rdlc`);
    writeFileSync(file, bytes);
    const document = await vscode.workspace.openTextDocument(file);
    assert.equal(document.getText(), text);
    assert.equal(document.eol, vscode.EndOfLine.CRLF);
    assert.equal(await document.save(), true);
    assert.deepEqual(readFileSync(file), bytes, `${encoding} no-op bytes`);
  }
  const file = join(directory, 'external.rdlc');
  // Temp fixtures are outside the workspace: explicitly enroll this directory in native watching.
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(directory, '*.rdlc'),
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const external = source.replace('Hello', 'External');
  await vscode.workspace.fs.writeFile(document.uri, Buffer.from(external));
  await until(() => document.getText() === external, 'Clean external reload');
  const pending = external.replace('External', 'Pending local');
  await replaceSource(document, pending);
  await vscode.workspace.fs.writeFile(document.uri, Buffer.from(source));
  assert.equal(document.getText(), pending);
  assert.equal(document.isDirty, true);
  assert.equal(
    readFileSync(file, 'utf8'),
    source,
    'No extension writer overwrites external content',
  );
  assert.equal(
    await document.save(),
    false,
    'Native conflict blocks overwriting a newer file',
  );
  assert.equal(document.getText(), pending);
  assert.equal(document.isDirty, true);
  assert.equal(readFileSync(file, 'utf8'), source);
  // Explicit native discard is safe after checking that dirty work was retained.
  await vscode.commands.executeCommand('workbench.action.files.revert');
  assert.equal(document.getText(), source);
  watcher.dispose();
}
