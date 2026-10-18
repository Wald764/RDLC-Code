import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  PasteCounter,
  runClipboard,
  WindowClipboard,
  type ClipboardHost,
  type ClipboardRequest,
} from './clipboard.js';

const source = readFileSync(
  'tests/fixtures/interactive/clipboard-dependencies.rdlc',
  'utf8',
);

function io() {
  const state = {
    text: 'plain text',
    writes: [] as string[],
    reads: 0,
    failWrite: false,
    failRead: false,
    /** Runs while the write/read is pending, e.g. an independent document change. */
    during: null as (() => void) | null,
    readText: async () => {
      state.reads++;
      state.during?.();
      if (state.failRead) throw new Error('denied');
      return state.text;
    },
    writeText: async (value: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      state.during?.();
      if (state.failWrite) throw new Error('denied');
      state.writes.push(value);
      state.text = value;
    },
  };
  return state;
}

function host(initial = source) {
  const document = { source: initial, version: 1, commits: 0 };
  const evaluate = () => {
    const snapshot = {
      uri: 'test:doc',
      version: document.version,
      source: document.source,
      eol: '\n' as const,
    };
    const syntax = parse(snapshot);
    return { snapshot, syntax, projection: projectReport(syntax) };
  };
  const port: ClipboardHost = {
    version: () => document.version,
    evaluate,
    commit: async (_plan, candidate, baseVersion, starts) => {
      if (document.version !== baseVersion)
        return {
          accepted: false,
          reason: 'STALE_EDIT',
          version: document.version,
          inserted: [],
        };
      document.source = candidate;
      document.version++;
      document.commits++;
      const after = evaluate();
      const inserted: string[] = [];
      const visit = (node: NonNullable<typeof after.syntax.root>) => {
        if (starts.includes(node.range.start)) inserted.push(node.id);
        node.children.forEach(visit);
      };
      visit(after.syntax.root!);
      return {
        accepted: true,
        reason: 'APPLIED',
        version: document.version,
        inserted,
      };
    },
  };
  const ids = (...names: string[]) =>
    names.map(
      (name) =>
        evaluate().projection.textboxes.find((t) => t.name === name)!.node.id,
    );
  return { document, port, ids, evaluate };
}

const request = (
  h: ReturnType<typeof host>,
  action: ClipboardRequest['action'],
  names: string[] = [],
  extra: Partial<ClipboardRequest> = {},
): ClipboardRequest => ({
  action,
  baseVersion: h.document.version,
  ...(names.length ? { targetIds: h.ids(...names) } : {}),
  ...extra,
});

test('token envelope validation is exact and bounded', async () => {
  const clipboard = new WindowClipboard(io());
  const token = (patch: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: 'rdlc-code/items',
      version: 1,
      window: clipboard.window,
      capture: '00000000-0000-4000-8000-000000000000',
      ...patch,
    });
  assert.match(clipboard.validate('plain text')!, /does not contain/);
  assert.match(clipboard.validate('<Textbox/>')!, /does not contain/);
  assert.match(clipboard.validate(token({ extra: 1 }))!, /does not contain/);
  assert.match(clipboard.validate(token({ version: 2 }))!, /format or version/);
  assert.match(
    clipboard.validate(token({ format: 'x' }))!,
    /format or version/,
  );
  assert.match(
    clipboard.validate(token({ capture: 'not-a-uuid' }))!,
    /malformed/,
  );
  assert.match(
    clipboard.validate(
      token({ window: '00000000-0000-4000-8000-000000000001' }),
    )!,
    /another window/,
  );
  assert.match(clipboard.validate(token())!, /no longer available/);
  assert.match(
    clipboard.validate(token({ pad: 'x'.repeat(1100) }))!,
    /does not contain/,
  );
});

test('copy installs only after a successful write; cut checks before writing', async () => {
  const fake = io();
  const clipboard = new WindowClipboard(fake);
  const h = host();
  const counter = new PasteCounter();
  fake.failWrite = true;
  let result = await runClipboard(
    clipboard,
    h.port,
    counter,
    request(h, 'copy', ['Title']),
  );
  assert.equal(result.reason, 'CLIPBOARD_WRITE_FAILED');
  assert.equal(clipboard.generation, 0);
  fake.failWrite = false;
  result = await runClipboard(
    clipboard,
    h.port,
    counter,
    request(h, 'copy', ['Title']),
  );
  assert.deepEqual(
    [result.accepted, result.changed, result.version],
    [true, false, 1],
  );
  assert.equal(clipboard.generation, 1);
  assert.equal(JSON.parse(fake.text).window, clipboard.window);
  const writes = fake.writes.length;
  result = await runClipboard(
    clipboard,
    h.port,
    counter,
    request(h, 'cut', ['Title', 'InternalReference']),
  );
  assert.equal(
    result.reason,
    'REFERENCE_IN_USE',
    'OutsideConsumer blocks Title',
  );
  assert.equal(
    fake.writes.length,
    writes,
    'refused cut never touches the clipboard',
  );
  assert.equal(h.document.commits, 0);
});

test('a cut stale after the clipboard await removes nothing but keeps a usable capture', async () => {
  const fake = io();
  const clipboard = new WindowClipboard(fake);
  const h = host();
  fake.during = () => {
    h.document.version++;
    fake.during = null;
  };
  const result = await runClipboard(
    clipboard,
    h.port,
    new PasteCounter(),
    request(h, 'cut', ['InternalReference']),
  );
  assert.equal(result.reason, 'STALE_EDIT');
  assert.equal(h.document.commits, 0);
  assert.ok((await clipboard.resolve()).ok);
  // A fresh cut applies one complete removal.
  const done = await runClipboard(
    clipboard,
    h.port,
    new PasteCounter(),
    request(h, 'cut', ['InternalReference', 'ExternalReference']),
  );
  assert.equal(done.changed, true);
  assert.equal(done.removed.length, 2);
  assert.equal(h.document.commits, 1);
});

test('per-view paste offsets advance only on success and reset with a new capture', async () => {
  const fake = io();
  const clipboard = new WindowClipboard(fake);
  const source1 = host();
  const view = new PasteCounter();
  const other = new PasteCounter();
  await runClipboard(
    clipboard,
    source1.port,
    view,
    request(source1, 'copy', ['Outside']),
  );
  const destination = host();
  const left = () =>
    destination
      .evaluate()
      .projection.textboxes.filter((t) => /^Outside[0-9]*$/.test(t.name ?? ''))
      .map((t) => t.bounds.left);
  const paste = (counter: PasteCounter) =>
    runClipboard(
      clipboard,
      destination.port,
      counter,
      request(destination, 'paste', [], { unit: 'pt' }),
    );
  assert.equal((await paste(view)).changed, true);
  // Source closure does not invalidate the retained snapshot.
  source1.document.source = '';
  assert.equal((await paste(view)).changed, true);
  assert.deepEqual(left(), ['180pt', '190pt', '200pt']);
  assert.equal(
    (await paste(other)).changed,
    true,
    'independent view starts at 10pt',
  );
  assert.deepEqual(left().at(-1), '190pt');
  fake.failRead = true;
  assert.equal((await paste(view)).reason, 'CLIPBOARD_READ_FAILED');
  fake.failRead = false;
  fake.during = () => {
    destination.document.version++;
    fake.during = null;
  };
  assert.equal((await paste(view)).reason, 'STALE_EDIT', 'recheck after read');
  assert.equal((await paste(view)).changed, true);
  assert.deepEqual(left().at(-1), '210pt', 'failures did not advance');
  await runClipboard(
    clipboard,
    destination.port,
    view,
    request(destination, 'copy', ['Outside']),
  );
  await paste(view);
  assert.deepEqual(left().at(-1), '190pt', 'new capture resets to 10pt');
  fake.text = 'foreign text';
  assert.equal((await paste(view)).reason, 'CLIPBOARD_UNAVAILABLE');
});

test('duplicate uses a transient capture and leaves the clipboard untouched', async () => {
  const fake = io();
  const clipboard = new WindowClipboard(fake);
  const h = host();
  for (let i = 0; i < 2; i++) {
    const result = await runClipboard(
      clipboard,
      h.port,
      new PasteCounter(),
      request(h, 'duplicate', ['Outside'], { unit: 'pt' }),
    );
    assert.equal(result.changed, true);
    assert.equal(result.inserted.length, 1);
  }
  assert.deepEqual(
    [fake.writes.length, fake.reads, clipboard.generation],
    [0, 0, 0],
  );
  assert.deepEqual(
    h
      .evaluate()
      .projection.textboxes.filter((t) => /^Outside[0-9]*$/.test(t.name ?? ''))
      .map((t) => t.bounds.left),
    ['180pt', '190pt', '190pt'],
  );
});

test('concurrent views serialize capture replacement so token and capture agree', async () => {
  const fake = io();
  const clipboard = new WindowClipboard(fake);
  const a = host();
  const b = host();
  const results = await Promise.all([
    runClipboard(
      clipboard,
      a.port,
      new PasteCounter(),
      request(a, 'copy', ['Title']),
    ),
    runClipboard(
      clipboard,
      b.port,
      new PasteCounter(),
      request(b, 'copy', ['Outside']),
    ),
  ]);
  assert.ok(results.every((r) => r.accepted));
  const resolved = await clipboard.resolve();
  assert.ok(resolved.ok);
  assert.equal(JSON.parse(fake.text).capture, resolved.capture.id);
  assert.equal(resolved.capture.roots[0]!.identities[0]!.name, 'Outside');
  clipboard.dispose();
  assert.equal(
    (await clipboard.resolve()).ok,
    false,
    'reload/dispose invalidates',
  );
});
