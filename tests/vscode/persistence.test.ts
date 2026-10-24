import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { observe, replaceSource, until } from './session-checks.js';
import { FailingFileSystem } from './failing-file-system.js';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';

export async function run(): Promise<void> {
  await interactiveFailures();
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

const mixed = readFileSync(
  resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
  'utf8',
);

function move(document: vscode.TextDocument, requestId: string, dxPt = 5) {
  const report = projectReport(
    parse({
      uri: document.uri.toString(),
      version: document.version,
      source: document.getText(),
      eol: '\n',
    }),
  );
  return {
    protocol: 2,
    kind: 'edit',
    requestId,
    baseVersion: document.version,
    operation: 'layout',
    payload: {
      action: 'move',
      targetIds: [report.textboxes.find((t) => t.name === 'Front')!.node.id],
      dxPt,
      dyPt: 0,
      unit: 'pt',
    },
  };
}

/** Interactive edits keep native encoding/EOL, failed saves, uncertain applies and closes safe. */
async function interactiveFailures(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-interactive-persist-'));
  const file = join(directory, 'bom-crlf.rdlc');
  const crlf = mixed.replace(/\r?\n/g, '\r\n');
  writeFileSync(
    file,
    Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(crlf)]),
  );
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  const view = observe(document);
  try {
    view.session.receive(move(document, 'encoded-move'));
    await until(
      () => view.messages.some((m) => m.kind === 'editResult' && m.accepted),
      'Encoded layout move',
    );
    const accepted = document.getText();
    assert.notEqual(accepted, crlf);
    // Uncertain native apply: the host claims success but the document never changes.
    const uncertain = observe(document, async () => true);
    try {
      uncertain.session.receive(move(document, 'uncertain-move', 7));
      await until(
        () => uncertain.messages.some((m) => m.kind === 'editResult'),
        'Uncertain apply settles',
      );
      assert.ok(
        uncertain.messages.some(
          (m) =>
            m.kind === 'editResult' &&
            !m.accepted &&
            m.reason === 'DOCUMENT_CHANGED_DURING_APPLY',
        ),
      );
      assert.ok(
        uncertain.messages.some(
          (m) => m.kind === 'snapshot' && m.version === document.version,
        ),
        'Actual accepted state is published',
      );
      assert.equal(document.getText(), accepted, 'Accepted unsaved work kept');
      assert.equal(document.isDirty, true);
    } finally {
      uncertain.dispose();
    }
    assert.equal(await document.save(), true);
    const bytes = readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191], 'BOM kept');
    const saved = bytes.subarray(3).toString();
    assert.equal(saved, accepted);
    assert.ok(!/[^\r]\n/.test(saved), 'CRLF kept for every line');
  } finally {
    view.dispose();
  }

  const volume = new FailingFileSystem(Buffer.from(mixed));
  const registration = vscode.workspace.registerFileSystemProvider(
    'rdlc-interactive-failure',
    volume,
  );
  const failing = await vscode.workspace.openTextDocument(
    vscode.Uri.parse('rdlc-interactive-failure:/report.rdlc'),
  );
  const failingView = observe(failing);
  try {
    failingView.session.receive(move(failing, 'before-failed-save'));
    await until(
      () =>
        failingView.messages.some((m) => m.kind === 'editResult' && m.accepted),
      'Layout before failed save',
    );
    const pending = failing.getText();
    volume.failWrites = true;
    assert.equal(await failing.save(), false);
    assert.equal(failing.isDirty, true);
    assert.equal(failing.getText(), pending);
    assert.equal(Buffer.from(volume.bytes).toString(), mixed);
    // Closing a view while its apply is pending neither reports nor replays the edit.
    let release: (applied: boolean) => void = () => {};
    let applies = 0;
    const closing = observe(failing, () => {
      applies++;
      return new Promise<boolean>((resolve) => (release = resolve));
    });
    closing.session.receive(move(failing, 'closed-during-apply', 9));
    await until(() => applies === 1, 'Apply started');
    const before = closing.messages.length;
    closing.dispose();
    release(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(closing.messages.length, before);
    assert.equal(applies, 1, 'No retry after close');
    assert.equal(failing.getText(), pending);
    volume.failWrites = false;
    assert.equal(await failing.save(), true);
    assert.equal(Buffer.from(volume.bytes).toString(), pending);
  } finally {
    failingView.dispose();
    registration.dispose();
    volume.dispose();
  }
}
