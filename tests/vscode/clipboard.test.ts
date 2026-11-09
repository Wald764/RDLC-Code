import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, deflateSync } from 'node:zlib';
import { rawImageLimit } from '@rdlc/report-model/images';
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
  directory = 'interactive',
  transform: (source: string) => string = (source) => source,
): Promise<vscode.TextDocument> {
  const source = transform(
    readFileSync(
      resolve(
        __dirname,
        `../../../tests/fixtures/${directory}/${fixture}.rdlc`,
      ),
      'utf8',
    ),
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
          projection.textboxes.find((t) => t.name === name) ??
          projection.images.find((t) => t.name === name))!.node.id,
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
  await imageDefinitions();
  await imageDelete();
  await imageBudget();
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

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const definitions = (document: vscode.TextDocument) =>
  projectReport(
    parse({
      uri: document.uri.toString(),
      version: document.version,
      source: document.getText(),
      eol: '\n',
    }),
  );
const valueOf = (
  projection: ReturnType<typeof definitions>,
  name: string,
): string | null => {
  const value = projection.images.find((i) => i.name === name)?.value;
  return value?.kind === 'constant' ? value.text : null;
};

/** Image items carry their embedded definitions across reports, as one undo step each. */
async function imageDefinitions(): Promise<void> {
  const logo = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/images/pictures/logo.png'),
  );
  const clipboard = new WindowClipboard(memory());
  const source = await open('authored', undefined, 'images');
  await vscode.window.showTextDocument(source);
  const a = view(source, clipboard);
  const authoredText = source.getText();
  try {
    const copied = await a.send('copy', ['LogoAutoSize', 'LogoFit']);
    assert.deepEqual([copied.accepted, copied.changed], [true, false]);
    assert.equal(source.getText(), authoredText, 'Copy never edits');
    // Same document: the item keeps its Value and no definition is written.
    const same = await a.send('paste');
    assert.ok(same.changed, same.reason);
    const afterSame = source.getText();
    assert.equal(definitions(source).embeddedImages.length, 3);
    assert.equal(
      afterSame.match(/<EmbeddedImage /g)?.length,
      3,
      'a same-report paste writes no definition',
    );
    const duplicated = await a.send('duplicate', ['PhotoClip']);
    assert.ok(duplicated.changed, duplicated.reason);
    assert.equal(source.getText().match(/<EmbeddedImage /g)?.length, 3);
    await history(source, 'undo', afterSame);
    await history(source, 'undo', authoredText);
    assert.equal(source.getText(), authoredText, 'one Undo per operation');
    // Re-copy so the retained capture is the one used below.
    assert.ok((await a.send('copy', ['LogoAutoSize', 'LogoFit'])).accepted);
  } finally {
    a.dispose();
  }

  // authored -> blank: the definition is inserted once, in the same undo step.
  const blank = await open('blank', undefined, 'images');
  const blankText = blank.getText();
  await vscode.window.showTextDocument(blank);
  const b = view(blank, clipboard);
  try {
    const pasted = await b.send('paste');
    assert.ok(pasted.changed, pasted.reason);
    assert.equal(pasted.inserted.length, 2);
    const after = blank.getText();
    const projection = definitions(blank);
    assert.deepEqual(
      projection.embeddedImages.map((d) => [d.name, d.displayable]),
      [['logo', true]],
    );
    assert.equal(after.match(/<EmbeddedImage /g)?.length, 1);
    assert.equal(
      sha256(
        Buffer.from(
          /<ImageData>([^<]*)<\/ImageData>/.exec(after)![1]!,
          'base64',
        ),
      ),
      sha256(logo),
    );
    assert.deepEqual(
      projection.images.map((i) => i.reason),
      [null, null],
    );
    await history(blank, 'undo', blankText);
    assert.equal(
      blank.getText(),
      blankText,
      'one Undo removes the items and the definition',
    );
    await history(blank, 'redo', after);
    await history(blank, 'undo', blankText);
  } finally {
    b.dispose();
  }

  // authored -> collision: a different `logo` exists, so the copy becomes logo_1.
  const collision = await open('collision', undefined, 'images');
  const collisionText = collision.getText();
  await vscode.window.showTextDocument(collision);
  const c = view(collision, clipboard);
  try {
    const pasted = await c.send('paste');
    assert.ok(pasted.changed, pasted.reason);
    const projection = definitions(collision);
    assert.deepEqual(
      projection.embeddedImages.map((d) => d.name),
      ['logo', 'logo_1'],
    );
    assert.equal(valueOf(projection, 'Existing'), 'logo');
    assert.equal(valueOf(projection, 'LogoAutoSize'), 'logo_1');
    assert.equal(valueOf(projection, 'LogoFit'), 'logo_1');
    assert.ok(
      projection.images.every(
        (i) => i.definition !== null && i.reason === null,
      ),
    );
    await history(collision, 'undo', collisionText);
    assert.equal(collision.getText(), collisionText, 'one Undo per paste');
  } finally {
    c.dispose();
  }
  for (const document of [collision, blank, source]) {
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}

function paddedPng(size: number, seed: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.alloc(size - 100, seed)),
    chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Two large definitions push the capture past captureBudget; the existing error applies. */
async function imageBudget(): Promise<void> {
  const big = [paddedPng(4_900_000, 1), paddedPng(4_900_000, 2)];
  assert.ok(big.every((png) => png.length < rawImageLimit));
  let next = 0;
  const io = memory();
  const clipboard = new WindowClipboard(io);
  const document = await open('authored', undefined, 'images', (text) =>
    text
      .replaceAll('image/jpeg', 'image/png')
      .replace(
        /<ImageData>[^<]*<\/ImageData>/g,
        () =>
          `<ImageData>${big[next++]?.toString('base64') ?? 'AAAA'}</ImageData>`,
      ),
  );
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const v = view(document, clipboard);
  try {
    const refused = await v.send('copy', ['LogoAutoSize', 'PhotoClip']);
    assert.equal(refused.accepted, false);
    assert.equal(refused.reason, 'CAPTURE_TOO_LARGE');
    assert.equal(io.writes, 0, 'a refused copy leaves the clipboard untouched');
    assert.equal(
      refused.diagnostics[0]?.message,
      'The selection exceeds the 8 MiB clipboard budget; copy fewer items.',
    );
    assert.ok(
      !JSON.stringify(refused.diagnostics).includes(
        /<ImageData>([^<]{64})/.exec(original)![1]!,
      ),
      'no payload in the diagnostics',
    );
    const duplicate = await v.send('duplicate', ['LogoAutoSize', 'PhotoClip']);
    assert.equal(duplicate.reason, 'CAPTURE_TOO_LARGE');
    assert.equal(document.getText(), original);
    const single = await v.send('copy', ['LogoAutoSize']);
    assert.ok(single.accepted, 'one large image fits captureBudget');
    assert.equal(io.writes, 1, 'only the accepted copy wrote the token');
  } finally {
    v.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

/** Delete is its own authoring action: one undo step, no clipboard write, definitions kept. */
async function imageDelete(): Promise<void> {
  const io = memory();
  const document = await open('authored', undefined, 'images');
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const v = view(document, new WindowClipboard(io));
  const send = async (name: string, confirm: string) => {
    const requestId = `delete-${name}-${Math.random().toString(36).slice(2, 8)}`;
    const projection = definitions(document);
    v.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId,
      baseVersion: document.version,
      targetId: projection.images.find((i) => i.name === name)!.node.id,
      operation: 'author',
      payload: { action: 'deleteImage', confirm },
    });
    await until(
      () =>
        v.messages.some(
          (m) => m.kind === 'editResult' && m.requestId === requestId,
        ),
      'deleteImage settles',
    );
    return v.messages.find(
      (m): m is Extract<HostMessage, { kind: 'editResult' }> =>
        m.kind === 'editResult' && m.requestId === requestId,
    )!;
  };
  try {
    const refused = await send('LogoFit', '');
    assert.equal(refused.accepted, false);
    assert.equal(
      document.getText(),
      original,
      'unconfirmed delete changes nothing',
    );
    const deleted = await send('LogoFit', 'delete-contained-content');
    assert.ok(deleted.accepted && deleted.changed, deleted.reason);
    const after = document.getText();
    const projection = definitions(document);
    assert.equal(projection.images.length, 4);
    assert.ok(!projection.images.some((i) => i.name === 'LogoFit'));
    assert.deepEqual(
      projection.embeddedImages.map((d) => d.name),
      ['logo', 'photo', 'unused'],
      'definitions are kept',
    );
    assert.equal(io.writes, 0, 'delete never writes the clipboard');
    await history(document, 'undo', original);
    assert.equal(document.getText(), original, 'one Undo restores the image');
    await history(document, 'redo', after);
    await history(document, 'undo', original);
  } finally {
    v.dispose();
  }
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}
