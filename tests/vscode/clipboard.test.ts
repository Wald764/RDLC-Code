import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { validateMessage } from '@rdlc/report-model/protocol';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import { WindowClipboard } from '../../apps/vscode-extension/src/clipboard.js';
import { history, until } from './session-checks.js';

type Result = Extract<HostMessage, { kind: 'clipboardResult' }>;

export function memory() {
  const state = {
    text: '',
    writes: 0,
    failWrite: false,
    failRead: false,
    during: null as (() => Promise<void>) | null,
    async readText() {
      const during = state.during;
      state.during = null;
      await during?.();
      if (state.failRead) throw new Error('denied');
      return state.text;
    },
    async writeText(value: string) {
      const during = state.during;
      state.during = null;
      await during?.();
      if (state.failWrite) throw new Error('denied');
      state.writes++;
      state.text = value;
    },
  };
  return state;
}

export async function open(
  fixture: string,
  eol?: '\n' | '\r\n',
): Promise<vscode.TextDocument> {
  const source = readFileSync(
    resolve(__dirname, `../../../tests/fixtures/interactive/${fixture}.rdlc`),
    'utf8',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-clip-')), 'report.rdlc');
  writeFileSync(file, eol ? source.replace(/\r?\n/g, eol) : source);
  return vscode.workspace.openTextDocument(file);
}

/** A designer view: one session, ready handshake and typed clipboard requests. */
export function view(
  document: vscode.TextDocument,
  clipboard?: WindowClipboard,
) {
  const session = new DocumentSession(document, undefined, clipboard);
  const messages: HostMessage[] = [];
  const listener = session.onMessage((message) => messages.push(message));
  session.receive({ protocol: 2, kind: 'ready' });
  let count = 0;
  const ids = (...names: string[]) => {
    const projection = projectReport(
      parse({
        uri: document.uri.toString(),
        version: document.version,
        source: document.getText(),
        eol: '\n',
      }),
    );
    return names.map(
      (name) =>
        (projection.tables.find((t) => t.name === name) ??
          projection.textboxes.find((t) => t.name === name))!.node.id,
    );
  };
  const send = async (
    action: 'copy' | 'cut' | 'paste' | 'duplicate',
    names: string[] = [],
  ): Promise<Result> => {
    const requestId = `clip-${action}-${++count}-${Math.random().toString(36).slice(2, 8)}`;
    session.receive({
      protocol: 2,
      kind: 'clipboard',
      requestId,
      baseVersion: document.version,
      action,
      ...(action === 'paste' ? {} : { targetIds: ids(...names) }),
      ...(action === 'paste' || action === 'duplicate' ? { unit: 'pt' } : {}),
    });
    await until(
      () =>
        messages.some(
          (m) => m.kind === 'clipboardResult' && m.requestId === requestId,
        ),
      `${action} settles`,
    );
    const result = messages.find(
      (m): m is Result =>
        m.kind === 'clipboardResult' && m.requestId === requestId,
    )!;
    assert.ok(validateMessage(result), 'result satisfies the shared protocol');
    return result;
  };
  return {
    session,
    messages,
    send,
    dispose() {
      listener.dispose();
      session.dispose();
    },
  };
}

export async function run(): Promise<void> {
  await sameAndCrossDocument();
  await crossLineEndings('\n', '\r\n');
  await crossLineEndings('\r\n', '\n');
  await cutAndRefusals('\n');
  await cutAndRefusals('\r\n');
  await realClipboard();
}

async function sameAndCrossDocument(): Promise<void> {
  const clipboard = new WindowClipboard(memory());
  const source = await open('clipboard-dependencies');
  const original = source.getText();
  await vscode.window.showTextDocument(source);
  const a = view(source, clipboard);
  try {
    const copy = await a.send('copy', [
      'Title',
      'InternalReference',
      'DatasetTotal',
    ]);
    assert.deepEqual([copy.accepted, copy.changed], [true, false]);
    assert.equal(source.getText(), original, 'Copy never edits');
    const pasted = await a.send('paste');
    assert.ok(pasted.changed, pasted.reason);
    assert.equal(pasted.inserted.length, 3);
    const afterPaste = source.getText();
    const duplicated = await a.send('duplicate', ['Outside']);
    assert.ok(duplicated.changed);
    const afterDuplicate = source.getText();
    await history(source, 'undo', afterPaste);
    assert.equal(source.getText(), afterPaste, 'one Undo per duplicate');
    await history(source, 'undo', original);
    assert.equal(source.getText(), original, 'one Undo per paste');
    await history(source, 'redo', afterPaste);
    await history(source, 'redo', afterDuplicate);
    assert.equal(source.getText(), afterDuplicate);
    await history(source, 'undo', afterPaste);
    await history(source, 'undo', original);
  } finally {
    a.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
  // The retained snapshot survives source closure and reaches a compatible report.
  const destination = await open('mixed');
  const before = destination.getText();
  await vscode.window.showTextDocument(destination);
  const b = view(destination, clipboard);
  try {
    const pasted = await b.send('paste');
    assert.ok(pasted.changed, pasted.reason);
    const names = projectReport(
      parse({ uri: 'x', version: 1, source: destination.getText(), eol: '\n' }),
    ).textboxes.map((t) => t.name);
    for (const name of ['Title', 'InternalReference', 'DatasetTotal'])
      assert.ok(
        names.includes(name),
        `free name ${name} kept across documents`,
      );
    await history(destination, 'undo', before);
    assert.equal(destination.getText(), before);
  } finally {
    b.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

/** Pasting between reports with different line endings writes the target's line endings. */
async function crossLineEndings(
  from: '\n' | '\r\n',
  to: '\n' | '\r\n',
): Promise<void> {
  const clipboard = new WindowClipboard(memory());
  // Indent the copied textbox over several lines, as authoring tools save reports.
  const fixture = readFileSync(
    resolve(
      __dirname,
      '../../../tests/fixtures/interactive/clipboard-dependencies.rdlc',
    ),
    'utf8',
  ).replace(/\r?\n/g, from);
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-eol-')), 'report.rdlc');
  writeFileSync(
    file,
    fixture.replace(/<Textbox Name="Title">[\s\S]*?<\/Textbox>/, (xml) =>
      xml.replace(/></g, `>${from}      <`),
    ),
  );
  const source = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(source);
  const a = view(source, clipboard);
  try {
    const copy = await a.send('copy', ['Title']);
    assert.ok(copy.accepted, copy.reason);
  } finally {
    a.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
  const destination = await open('mixed', to);
  const before = destination.getText();
  await vscode.window.showTextDocument(destination);
  const b = view(destination, clipboard);
  try {
    const pasted = await b.send('paste');
    assert.ok(pasted.accepted && pasted.changed, pasted.reason);
    const foreign = to === '\r\n' ? /[^\r]\n/ : /\r/;
    assert.ok(
      !foreign.test(destination.getText()),
      `pasted text uses only the destination line endings`,
    );
    await history(destination, 'undo', before);
    assert.equal(destination.getText(), before, 'one Undo per paste');
  } finally {
    b.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

async function cutAndRefusals(eol: '\n' | '\r\n'): Promise<void> {
  const io = memory();
  const clipboard = new WindowClipboard(io);
  const document = await open('clipboard-dependencies', eol);
  assert.equal(
    document.eol,
    eol === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF,
  );
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const v = view(document, clipboard);
  try {
    const refused = await v.send('cut', ['Title', 'InternalReference']);
    assert.equal(refused.accepted, false);
    assert.equal(io.writes, 0, 'refused Cut leaves the clipboard untouched');
    const cut = await v.send('cut', ['InternalReference', 'ExternalReference']);
    assert.ok(cut.changed, cut.reason);
    assert.equal(cut.removed.length, 2);
    await history(document, 'undo', original);
    assert.equal(
      document.getText(),
      original,
      'one Undo restores the whole Cut',
    );
    for (const [label, setup, reason] of [
      ['plain text', () => (io.text = 'plain text'), 'CLIPBOARD_UNAVAILABLE'],
      [
        'oversized',
        () => (io.text = 'x'.repeat(2048)),
        'CLIPBOARD_UNAVAILABLE',
      ],
      [
        'foreign window',
        () =>
          (io.text = JSON.stringify({
            ...JSON.parse(io.text || '{}'),
            window: '00000000-0000-4000-8000-000000000000',
          })),
        'CLIPBOARD_UNAVAILABLE',
      ],
      ['read failure', () => (io.failRead = true), 'CLIPBOARD_READ_FAILED'],
    ] as const) {
      await v.send('copy', ['Outside']);
      setup();
      const result = await v.send('paste');
      io.failRead = false;
      assert.equal(result.reason, reason, label);
      assert.equal(document.getText(), original, label);
    }
    io.failWrite = true;
    const failed = await v.send('copy', ['Outside']);
    assert.equal(failed.reason, 'CLIPBOARD_WRITE_FAILED');
    io.failWrite = false;
    await v.send('copy', ['Outside']);
    // An independent change during the clipboard read makes the paste stale.
    io.during = async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(
        document.uri,
        document.positionAt(document.getText().length),
        '\n',
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);
    };
    const stale = await v.send('paste');
    assert.equal(stale.reason, 'STALE_EDIT');
    assert.equal(stale.accepted, false);
    assert.equal(stale.changed, false);
    assert.deepEqual(stale.inserted, []);
    const newline = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    assert.equal(document.getText(), original + newline, 'no partial paste');
    await history(document, 'undo', original);
    assert.equal(document.getText(), original);
  } finally {
    v.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

async function realClipboard(): Promise<void> {
  const saved = await vscode.env.clipboard.readText();
  const document = await open('clipboard-dependencies');
  await vscode.window.showTextDocument(document);
  const v = view(document);
  try {
    assert.ok((await v.send('copy', ['Outside'])).accepted);
    const token = JSON.parse(await vscode.env.clipboard.readText()) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(token).sort(), [
      'capture',
      'format',
      'version',
      'window',
    ]);
    assert.equal(token.format, 'rdlc-code/items');
    const pasted = await v.send('paste');
    assert.ok(pasted.changed, pasted.reason);
  } finally {
    v.dispose();
    await vscode.env.clipboard.writeText(saved);
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}
