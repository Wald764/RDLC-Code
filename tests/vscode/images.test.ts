import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { validateMessage } from '@rdlc/report-model/protocol';
import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_READ_FAILED,
  IMAGE_REPORT_BUDGET,
  IMAGE_TOO_LARGE,
  rawImageLimit,
} from '@rdlc/report-model/images';
import { parse } from '@rdlc/xml-parser/parser';
import { sourceStringLengthBudget } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import type { ImageSource } from '../../apps/vscode-extension/src/image-import.js';
import { FailingFileSystem } from './failing-file-system.js';
import { history, replaceSource, until } from './session-checks.js';

type Result = Extract<HostMessage, { kind: 'editResult' }>;

const fixtures = resolve(__dirname, '../../../tests/fixtures/images');
const picture = (name: string) =>
  new Uint8Array(readFileSync(join(fixtures, 'pictures', name)));

interface Step {
  /** `cancelled`, or the chosen file. */
  file: 'cancelled' | { fileName: string; bytes: Uint8Array; size?: number };
  /** Runs while the file chooser is pending, e.g. to change the text. */
  during?: () => Promise<void>;
}

/** Scripted file chooser: records every call so gating and stat-before-read are visible. */
class FakeImageSource implements ImageSource {
  readonly calls: string[] = [];
  private readonly script: Step[] = [];
  private current: Exclude<Step['file'], 'cancelled'> | null = null;
  enqueue(step: Step | Step['file']): void {
    this.script.push(
      step === 'cancelled' || 'bytes' in step ? { file: step } : step,
    );
  }
  count(call: string): number {
    return this.calls.filter((entry) => entry === call).length;
  }
  async pick() {
    this.calls.push('pick');
    const step = this.script.shift();
    assert.ok(step, 'a file chooser was opened without a scripted answer');
    await step.during?.();
    if (step.file === 'cancelled') return 'cancelled' as const;
    this.current = step.file;
    return { uri: { token: step.file.fileName }, fileName: step.file.fileName };
  }
  async stat() {
    this.calls.push('stat');
    return this.current!.size ?? this.current!.bytes.length;
  }
  async read() {
    this.calls.push('read');
    return this.current!.bytes;
  }
}

async function open(source?: string): Promise<vscode.TextDocument> {
  const text = source ?? readFileSync(join(fixtures, 'blank.rdlc'), 'utf8');
  const file = join(mkdtempSync(join(tmpdir(), 'rdlc-image-')), 'report.rdlc');
  writeFileSync(file, text);
  return vscode.workspace.openTextDocument(file);
}

/** A designer view bound to a fake file chooser. */
function view(
  document: vscode.TextDocument,
  source: ImageSource,
  isTrusted?: () => boolean,
) {
  const session = new DocumentSession(
    document,
    undefined,
    undefined,
    undefined,
    undefined,
    source,
    isTrusted,
  );
  const messages: HostMessage[] = [];
  const listener = session.onMessage((message) => messages.push(message));
  session.receive({ protocol: 2, kind: 'ready' });
  let count = 0;
  const create = async (
    payload: Record<string, string> = { placement: 'default' },
    baseVersion = document.version,
  ): Promise<Result> => {
    const requestId = `image-${++count}-${Math.random().toString(36).slice(2, 8)}`;
    const targetId = parse({
      uri: document.uri.toString(),
      version: baseVersion,
      source: document.getText(),
      eol: '\n',
    }).root!.id;
    session.receive({
      protocol: 2,
      kind: 'edit',
      requestId,
      baseVersion,
      targetId,
      operation: 'author',
      payload: { action: 'createImage', ...payload },
    });
    await until(
      () =>
        messages.some(
          (m) => m.kind === 'editResult' && m.requestId === requestId,
        ),
      'createImage settles',
    );
    const result = messages.find(
      (m): m is Result => m.kind === 'editResult' && m.requestId === requestId,
    )!;
    assert.ok(validateMessage(result), 'result satisfies the shared protocol');
    return result;
  };
  return {
    session,
    messages,
    create,
    dispose() {
      listener.dispose();
      session.dispose();
    },
  };
}

const project = (document: vscode.TextDocument) =>
  projectReport(
    parse({
      uri: document.uri.toString(),
      version: document.version,
      source: document.getText(),
      eol: '\n',
    }),
  );

/** The payload must appear nowhere except in the `imageAssets` message. */
function assertNoPayload(messages: readonly HostMessage[], bytes: Uint8Array) {
  const probe = Buffer.from(bytes).toString('base64').slice(0, 64);
  for (const message of messages.filter((m) => m.kind !== 'imageAssets'))
    assert.ok(!JSON.stringify(message).includes(probe), message.kind);
}

export async function run(): Promise<void> {
  await insertPngThenJpeg();
  await cancelLeavesNothing();
  await refusalCorpus();
  await oversizedFileIsNeverRead();
  await reportBudget();
  await deduplication();
  await gating();
  await staleSnapshot();
  await disposedDuringChooser();
  await nativeCreateAuthorization();
  await existingItemKeepsUnknownContent();
  await missingDefinitionIsGeometryOnly();
  await preservationOnlyRefusesMutation();
}

async function insertPngThenJpeg(): Promise<void> {
  const document = await open();
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    assert.equal(document.isDirty, false);
    source.enqueue({ fileName: 'logo.png', bytes: picture('logo.png') });
    const first = await designer.create();
    assert.deepEqual([first.accepted, first.changed], [true, true]);
    assert.equal(first.reason, 'APPLIED');
    assert.deepEqual(source.calls, ['pick', 'stat', 'read']);
    const afterPng = document.getText();
    assert.equal(document.isDirty, true, 'the document becomes dirty');

    source.enqueue({ fileName: 'photo.jpg', bytes: picture('photo.jpg') });
    const second = await designer.create();
    assert.deepEqual([second.accepted, second.changed], [true, true]);
    const afterJpeg = document.getText();
    const projection = project(document);
    assert.equal(projection.status, 'editable');
    assert.deepEqual(
      projection.embeddedImages.map((entry) => entry.name),
      ['logo', 'photo'],
    );
    assert.deepEqual(
      projection.images.map((entry) => [entry.name, entry.definition]),
      [
        ['Image1', 'logo'],
        ['Image2', 'photo'],
      ],
    );
    assert.equal(
      document.getText().match(/<EmbeddedImages>/g)?.length,
      1,
      'one EmbeddedImages collection',
    );
    // Unrelated bytes are unchanged: remove the inserted fragments and compare.
    assert.equal(
      document
        .getText()
        .replace(/<Image Name=.*?<\/Image>/gs, '')
        .replace(/<EmbeddedImages>.*<\/EmbeddedImages>/s, ''),
      original,
    );

    // The created item is named by the host so the designer can select it.
    const created = second.created!;
    assert.equal(created.name, 'Image2');
    const selected = projection.images.find((entry) => entry.name === 'Image2');
    assert.equal(created.id, selected!.node.id);
    const snapshot = [...designer.messages]
      .reverse()
      .find((m) => m.kind === 'snapshot');
    assert.ok(
      snapshot?.kind === 'snapshot' &&
        snapshot.scene?.items.some(
          (item) => item.id === created.id && item.kind === 'image',
        ),
      'the new image is in the published scene',
    );
    assertNoPayload(designer.messages, picture('logo.png'));
    assertNoPayload(designer.messages, picture('photo.jpg'));

    // One undo per insertion, and one redo per insertion.
    await history(document, 'undo', afterPng);
    await history(document, 'undo', original);
    await history(document, 'redo', afterPng);
    assert.equal(project(document).images.length, 1);
    await history(document, 'redo', afterJpeg);
  } finally {
    designer.dispose();
  }
}

async function cancelLeavesNothing(): Promise<void> {
  const document = await open();
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    const version = document.version;
    source.enqueue('cancelled');
    const result = await designer.create();
    assert.equal(result.accepted, false);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.changed, false);
    assert.equal(document.getText(), original);
    assert.equal(document.version, version);
    assert.equal(document.isDirty, false);
    assert.deepEqual(source.calls, ['pick']);
    // No history entry: the next insertion is the first and only undo step.
    source.enqueue({ fileName: 'logo.png', bytes: picture('logo.png') });
    assert.equal((await designer.create()).accepted, true);
    await history(document, 'undo', original);
  } finally {
    designer.dispose();
  }
}

async function refusalCorpus(): Promise<void> {
  const document = await open();
  const original = document.getText();
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    const version = document.version;
    const corpus: [string, string][] = [
      ['gif.gif', IMAGE_FORMAT_UNSUPPORTED],
      ['bad-crc.png', IMAGE_DATA_INVALID],
      ['truncated.png', IMAGE_DATA_INVALID],
      ['huge-dims.png', IMAGE_PIXELS_EXCEEDED],
      ['mega-pixels.png', IMAGE_PIXELS_EXCEEDED],
    ];
    for (const [name, code] of corpus) {
      source.enqueue({ fileName: name, bytes: picture(name) });
      const result = await designer.create();
      assert.equal(result.accepted, false, name);
      assert.equal(result.cancelled, undefined, name);
      assert.equal(result.reason, code, name);
      assert.equal(result.diagnostics[0]?.code, code, name);
      assert.ok(result.diagnostics[0]!.message.includes(name), name);
      assert.equal(document.getText(), original, name);
      assert.equal(document.version, version, name);
      assert.equal(document.isDirty, false, name);
      assertNoPayload(designer.messages, picture(name));
    }
    // A read failure names the file only, never the error text.
    const failing: ImageSource = {
      pick: async () => ({ uri: 1, fileName: 'gone.png' }),
      stat: async () => {
        throw new Error('ENOENT /private/path/gone.png');
      },
      read: async () => new Uint8Array(),
    };
    const broken = view(document, failing);
    try {
      const result = await broken.create();
      assert.equal(result.reason, IMAGE_READ_FAILED);
      assert.ok(!JSON.stringify(result).includes('/private/path'));
      assert.equal(document.getText(), original);
    } finally {
      broken.dispose();
    }
  } finally {
    designer.dispose();
  }
}

async function oversizedFileIsNeverRead(): Promise<void> {
  const document = await open();
  const original = document.getText();
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    // Generated at test time, never committed: a valid JPEG header followed by padding.
    const overLimit = new Uint8Array(rawImageLimit + 1);
    overLimit.set(picture('photo.jpg'));
    source.enqueue({ fileName: 'over-5mib.jpg', bytes: overLimit });
    const result = await designer.create();
    assert.equal(result.accepted, false);
    assert.equal(result.reason, IMAGE_TOO_LARGE);
    assert.match(result.diagnostics[0]!.message, /5\.00 MiB/);
    assert.deepEqual(source.calls, ['pick', 'stat'], 'readFile is not called');
    assert.equal(document.getText(), original);
  } finally {
    designer.dispose();
  }
}

async function reportBudget(): Promise<void> {
  const base = readFileSync(join(fixtures, 'blank.rdlc'), 'utf8');
  // Just under the 16 MiB parse budget, so only the new picture can exceed it.
  const room = 4096;
  const filler = 'x'.repeat(sourceStringLengthBudget - base.length - room - 7);
  const padded = base.replace('</Report>', `<!--${filler}--></Report>`);
  assert.ok(padded.length < sourceStringLengthBudget);
  const document = await open(padded);
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    const version = document.version;
    source.enqueue({ fileName: 'logo.png', bytes: picture('logo.png') });
    const result = await designer.create();
    assert.equal(result.accepted, false);
    assert.equal(result.reason, IMAGE_REPORT_BUDGET);
    assert.equal(document.version, version);
    assert.equal(document.getText().length, padded.length);
    assertNoPayload(designer.messages, picture('logo.png'));
  } finally {
    designer.dispose();
  }
}

async function deduplication(): Promise<void> {
  const document = await open();
  const original = document.getText();
  await vscode.window.showTextDocument(document);
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    source.enqueue({ fileName: 'logo.png', bytes: picture('logo.png') });
    assert.equal((await designer.create()).accepted, true);
    const afterFirst = document.getText();
    source.enqueue({ fileName: 'logo.png', bytes: picture('logo.png') });
    assert.equal((await designer.create()).accepted, true);
    const projection = project(document);
    assert.equal(
      projection.embeddedImages.length,
      1,
      'the definition is reused',
    );
    assert.deepEqual(
      projection.images.map((entry) => entry.definition),
      ['logo', 'logo'],
    );
    assert.equal(document.getText().match(/<ImageData>/g)?.length, 1);
    await history(document, 'undo', afterFirst);
    await history(document, 'undo', original);
  } finally {
    designer.dispose();
  }
}

async function gating(): Promise<void> {
  const base = readFileSync(join(fixtures, 'blank.rdlc'), 'utf8');
  // A read-only file system never opens the chooser.
  const volume = new FailingFileSystem(Buffer.from(base));
  const registration = vscode.workspace.registerFileSystemProvider(
    'rdlc-image-readonly',
    volume,
    { isReadonly: true },
  );
  const readonlyDocument = await vscode.workspace.openTextDocument(
    vscode.Uri.parse('rdlc-image-readonly:/report.rdlc'),
  );
  const source = new FakeImageSource();
  const readonlyView = view(readonlyDocument, source);
  try {
    const result = await readonlyView.create();
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'DOCUMENT_READ_ONLY');
    assert.equal(source.count('pick'), 0, 'the file chooser is never invoked');
    assert.equal(readonlyDocument.getText(), base);
  } finally {
    readonlyView.dispose();
    registration.dispose();
  }

  // An untrusted workspace is refused the same way, through the injected trust predicate.
  const document = await open();
  const untrusted = new FakeImageSource();
  const designer = view(document, untrusted, () => false);
  try {
    const result = await designer.create();
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'WORKSPACE_UNTRUSTED');
    assert.equal(
      untrusted.count('pick'),
      0,
      'the file chooser is never invoked',
    );
    assert.equal(document.getText(), base);
    assert.equal(document.isDirty, false);
  } finally {
    designer.dispose();
  }
}

async function disposedDuringChooser(): Promise<void> {
  const document = await open();
  const original = document.getText();
  const source = new FakeImageSource();
  const designer = view(document, source);
  const version = document.version;
  source.enqueue({
    file: { fileName: 'logo.png', bytes: picture('logo.png') },
    during: async () => designer.session.dispose(),
  });
  const targetId = parse({
    uri: document.uri.toString(),
    version,
    source: original,
    eol: '\n',
  }).root!.id;
  designer.session.receive({
    protocol: 2,
    kind: 'edit',
    requestId: 'image-disposed',
    baseVersion: version,
    targetId,
    operation: 'author',
    payload: { action: 'createImage', placement: 'default' },
  });
  await until(() => source.count('read') === 1, 'the import finishes');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(document.getText(), original, 'no edit after dispose');
  assert.equal(document.version, version);
  assert.ok(
    !designer.messages.some(
      (m) => m.kind === 'editResult' && m.requestId === 'image-disposed',
    ),
  );
  designer.dispose();
}

async function staleSnapshot(): Promise<void> {
  const document = await open();
  const source = new FakeImageSource();
  const designer = view(document, source);
  try {
    const baseVersion = document.version;
    const changed = document
      .getText()
      .replace('No embedded images', 'Edited while the chooser was open');
    assert.notEqual(changed, document.getText());
    source.enqueue({
      file: { fileName: 'logo.png', bytes: picture('logo.png') },
      during: () => replaceSource(document, changed),
    });
    const result = await designer.create({ placement: 'default' }, baseVersion);
    assert.equal(result.accepted, true);
    assert.equal(result.baseVersion, baseVersion);
    assert.ok(
      result.version > baseVersion + 1,
      'applied to the latest version',
    );
    assert.deepEqual(
      result.mappings,
      [],
      'ids of a stale version are not mapped',
    );
    const text = document.getText();
    assert.ok(text.includes('Edited while the chooser was open'));
    assert.equal(project(document).images.length, 1);
    assert.equal(result.created!.id, project(document).images[0]!.node.id);
  } finally {
    designer.dispose();
  }
}

/**
 * A native `create` authorizes exactly its own creation: `image` only a `createImage`
 * without an existing definition, and no other kind may reuse a `createImage` payload.
 */
async function nativeCreateAuthorization(): Promise<void> {
  const refusal = 'The native action no longer authorizes this operation.';
  const cases: {
    label: string;
    create: 'image' | 'textbox';
    payload: Record<string, string>;
    accepted: boolean;
  }[] = [
    {
      label: 'create:image with a createImage payload',
      create: 'image',
      payload: { action: 'createImage', placement: 'default' },
      accepted: true,
    },
    {
      label: 'create:image with a createTextbox payload',
      create: 'image',
      payload: { action: 'createTextbox', left: '20pt', top: '20pt' },
      accepted: false,
    },
    {
      label: 'create:textbox with a createImage payload',
      create: 'textbox',
      payload: { action: 'createImage', placement: 'default' },
      accepted: false,
    },
    {
      label: 'create:image with an existing definition',
      create: 'image',
      payload: {
        action: 'createImage',
        placement: 'default',
        definition: 'logo',
      },
      accepted: false,
    },
  ];
  for (const [index, entry] of cases.entries()) {
    const document = await open();
    const original = document.getText();
    const source = new FakeImageSource();
    const session = new DocumentSession(
      document,
      undefined,
      undefined,
      undefined,
      undefined,
      source,
    );
    const messages: HostMessage[] = [];
    const chooser: boolean[] = [];
    const subscriptions = [
      session.onMessage((message) => messages.push(message)),
      session.onImageChooser((event) => chooser.push(event.open)),
    ];
    try {
      assert.ok(
        session.setViewIdentity({
          viewId: 'view-native',
          documentLifetimeId: 'life-native',
          contextGeneration: 0,
        }),
      );
      session.receive({ protocol: 2, kind: 'ready' });
      await until(() => session.isReady, entry.label + ': handshake');
      const nativeRequestId = `native-image-${index}`;
      const delivery = await session.dispatchNativeAction(
        {
          protocol: 2,
          kind: 'nativeAction',
          requestId: nativeRequestId,
          documentLifetimeId: 'life-native',
          uri: document.uri.toString(),
          baseVersion: document.version,
          viewId: 'view-native',
          contextGeneration: 0,
          capability: 'create',
          action: 'create',
          create: entry.create,
          targetIds: [],
        },
        () => true,
        async () => true,
      );
      assert.equal(delivery.delivered, true, entry.label);
      if (entry.accepted)
        source.enqueue({ fileName: 'logo.png', bytes: picture('logo.png') });
      const requestId = `edit-${nativeRequestId}`;
      session.receive({
        protocol: 2,
        kind: 'edit',
        requestId,
        nativeRequestId,
        baseVersion: document.version,
        targetId: session.evaluation.syntax.root!.id,
        operation: 'author',
        payload: entry.payload,
      } as never);
      await until(
        () =>
          messages.some(
            (m) => m.kind === 'editResult' && m.requestId === requestId,
          ),
        entry.label + ': settles',
      );
      const result = messages.find(
        (m): m is Result =>
          m.kind === 'editResult' && m.requestId === requestId,
      )!;
      assert.equal(result.accepted, entry.accepted, entry.label);
      if (entry.accepted) {
        assert.equal(result.reason, 'APPLIED', entry.label);
        assert.deepEqual(chooser, [true, false], 'chooser enter and leave');
        assert.equal(source.count('pick'), 1);
      } else {
        assert.equal(result.reason, refusal, entry.label);
        assert.deepEqual(chooser, [], entry.label + ': chooser never opens');
        assert.equal(document.getText(), original, entry.label);
      }
    } finally {
      for (const subscription of subscriptions) subscription.dispose();
      session.dispose();
    }
  }
}

const geometryElement = /\s*<(Top|Left|Height|Width)>[^<]*<\/\1>/g;
const withoutGeometry = (xml: string) => xml.replace(geometryElement, '');

/** The source text of one projected image item. */
function itemText(document: vscode.TextDocument, name: string): string {
  const found = project(document).images.find((entry) => entry.name === name);
  assert.ok(found, name);
  return document.getText().slice(found.node.range.start, found.node.range.end);
}

/** Sends a layout edit for the named images and waits for its result. */
async function layout(
  designer: ReturnType<typeof view>,
  document: vscode.TextDocument,
  names: readonly string[],
  payload: Record<string, unknown>,
): Promise<Result> {
  const projection = project(document);
  const targetIds = names.map(
    (name) => projection.images.find((entry) => entry.name === name)!.node.id,
  );
  const requestId = `layout-${Math.random().toString(36).slice(2, 10)}`;
  designer.session.receive({
    protocol: 2,
    kind: 'edit',
    requestId,
    baseVersion: document.version,
    operation: 'layout',
    payload: { targetIds, unit: 'pt', ...payload },
  } as never);
  await until(
    () =>
      designer.messages.some(
        (m) => m.kind === 'editResult' && m.requestId === requestId,
      ),
    'layout settles',
  );
  const result = designer.messages.find(
    (m): m is Result => m.kind === 'editResult' && m.requestId === requestId,
  )!;
  assert.ok(validateMessage(result), 'result satisfies the shared protocol');
  return result;
}

const embeddedImagesOf = (text: string) =>
  /<EmbeddedImages>[\s\S]*<\/EmbeddedImages>/.exec(text)![0];

/**
 * US5 scenario 4: an existing item with an unknown child element and a foreign attribute
 * moves and resizes like an authored one, and keeps both byte-identical.
 */
async function existingItemKeepsUnknownContent(): Promise<void> {
  const document = await open(
    readFileSync(join(fixtures, 'authored.rdlc'), 'utf8'),
  );
  await vscode.window.showTextDocument(document);
  const original = document.getText();
  const designer = view(document, new FakeImageSource());
  try {
    const before = itemText(document, 'Tagged');
    for (const fragment of [
      'x:flag="1"',
      '<FutureThing level="2">kept</FutureThing>',
      '<x:Opaque keep="1">preserve</x:Opaque>',
    ])
      assert.ok(before.includes(fragment), fragment);
    assert.ok(project(document).images.some((i) => i.name === 'Tagged'));

    const moved = await layout(designer, document, ['Tagged'], {
      action: 'move',
      dxPt: 9,
      dyPt: 7,
    });
    assert.deepEqual([moved.accepted, moved.changed], [true, true]);
    const afterMove = document.getText();
    assert.notEqual(itemText(document, 'Tagged'), before);
    assert.equal(
      withoutGeometry(itemText(document, 'Tagged')),
      withoutGeometry(before),
    );

    const geometry = project(document).images.find((i) => i.name === 'Tagged')!;
    assert.ok(geometry.capabilities.includes('image'), 'still editable');
    const resized = await layout(designer, document, ['Tagged'], {
      action: 'resize',
      handle: 'se',
      xPt: 400,
      yPt: 400,
    });
    assert.deepEqual([resized.accepted, resized.changed], [true, true]);
    const afterResize = document.getText();
    const tagged = itemText(document, 'Tagged');
    assert.equal(withoutGeometry(tagged), withoutGeometry(before));
    for (const fragment of [
      'x:flag="1"',
      '<FutureThing level="2">kept</FutureThing>',
      '<x:Opaque keep="1">preserve</x:Opaque>',
    ])
      assert.ok(tagged.includes(fragment), fragment);
    assert.equal(embeddedImagesOf(afterResize), embeddedImagesOf(original));
    // Every other item is byte-identical.
    for (const name of ['LogoAutoSize', 'LogoFit', 'PhotoClip'])
      assert.ok(afterResize.includes(itemTextOf(original, name)), name);

    await history(document, 'undo', afterMove);
    await history(document, 'undo', original);
  } finally {
    designer.dispose();
  }
}

function itemTextOf(source: string, name: string): string {
  const found = projectReport(
    parse({ uri: 'fixture:text', version: 1, source, eol: '\n' }),
  ).images.find((entry) => entry.name === name)!;
  return source.slice(found.node.range.start, found.node.range.end);
}

/** An item whose definition is missing is geometry-only: it moves, and keeps its reason. */
async function missingDefinitionIsGeometryOnly(): Promise<void> {
  const document = await open(
    readFileSync(join(fixtures, 'preserved.rdlc'), 'utf8'),
  );
  await vscode.window.showTextDocument(document);
  const original = document.getText();
  const designer = view(document, new FakeImageSource());
  try {
    const ghost = project(document).images.find(
      (entry) => entry.name === 'GhostPicture',
    )!;
    assert.equal(ghost.reason, 'reference-missing');
    assert.deepEqual(ghost.capabilities, [
      'name',
      'left',
      'top',
      'width',
      'height',
    ]);
    const before = itemText(document, 'GhostPicture');
    const result = await layout(designer, document, ['GhostPicture'], {
      action: 'move',
      dxPt: 12,
      dyPt: 0,
    });
    assert.deepEqual([result.accepted, result.changed], [true, true]);
    const moved = document.getText();
    assert.notEqual(itemText(document, 'GhostPicture'), before);
    assert.equal(
      withoutGeometry(itemText(document, 'GhostPicture')),
      withoutGeometry(before),
    );
    assert.equal(embeddedImagesOf(moved), embeddedImagesOf(original));
    const after = project(document).images.find(
      (entry) => entry.name === 'GhostPicture',
    )!;
    assert.equal(after.reason, 'reference-missing');
    assert.equal(after.definition, null);
    await history(document, 'undo', original);
  } finally {
    designer.dispose();
  }
}

/** A preservation-only item refuses mutation with the existing layout diagnostic. */
async function preservationOnlyRefusesMutation(): Promise<void> {
  const document = await open(
    readFileSync(join(fixtures, 'preserved.rdlc'), 'utf8'),
  );
  await vscode.window.showTextDocument(document);
  const original = document.getText();
  const designer = view(document, new FakeImageSource());
  try {
    const version = document.version;
    for (const name of [
      'ExternalPicture',
      'DatabasePicture',
      'ExpressionPicture',
    ]) {
      assert.deepEqual(
        project(document).images.find((entry) => entry.name === name)!
          .capabilities,
        [],
        name,
      );
      const result = await layout(designer, document, [name], {
        action: 'move',
        dxPt: 5,
        dyPt: 5,
      });
      assert.equal(result.accepted, false, name);
      assert.equal(result.changed, false, name);
      assert.equal(result.reason, 'LAYOUT_REFUSED', name);
      assert.equal(result.diagnostics[0]?.code, 'LAYOUT_REFUSED', name);
      assert.match(result.diagnostics[0]!.message, /is locked/, name);
      assert.equal(document.getText(), original, name);
      assert.equal(document.version, version, name);
      assert.equal(document.isDirty, false, name);
    }
  } finally {
    designer.dispose();
  }
}
