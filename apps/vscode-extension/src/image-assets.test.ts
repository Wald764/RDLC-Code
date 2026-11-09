import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import {
  imageAssetsPerMessage,
  validateMessage,
  type ImageAssetsMessage,
} from '@rdlc/report-model/protocol';
import type { EmbeddedImageDefinition } from '@rdlc/report-model/report';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  ImageAssetCache,
  batchImageAssets,
  sendImageAssets,
} from './image-assets.js';

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const picture = (name: string) =>
  readFileSync(`tests/fixtures/images/pictures/${name}`);
const definitionsOf = (
  source: string,
  options: { digest?: (bytes: Uint8Array) => string } = { digest: sha256 },
): readonly EmbeddedImageDefinition[] =>
  projectReport(
    parse({ uri: 'fixture:assets', version: 1, source, eol: '\n' }),
    options,
  ).embeddedImages;
const fixture = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}`, 'utf8');

/** What the session does per batch: offer the missing assets, then record them sent. */
const take = (
  cache: ImageAssetCache,
  definitions: readonly EmbeddedImageDefinition[],
) => {
  const assets = cache.take(definitions);
  cache.markSent(assets);
  return assets;
};

test('each asset key is sent once per cache and again after a reset', () => {
  const cache = new ImageAssetCache();
  const definitions = definitionsOf(fixture('authored.rdlc'));
  // `logo` and `unused` hold the same bytes, so they share one key.
  assert.equal(definitions.length, 3);
  const first = take(cache, definitions);
  assert.deepEqual(
    first.map((asset) => asset.key).sort(),
    [sha256(picture('logo.png')), sha256(picture('photo.jpg'))].sort(),
  );
  assert.deepEqual(take(cache, definitions), []);
  cache.clear();
  assert.equal(take(cache, definitions).length, 2);
});

test('a second webview owns an independent cache', () => {
  const definitions = definitionsOf(fixture('authored.rdlc'));
  const one = new ImageAssetCache();
  const two = new ImageAssetCache();
  assert.equal(take(one, definitions).length, 2);
  assert.equal(take(two, definitions).length, 2);
  assert.equal(take(one, definitions).length, 0);
});

test('assets carry the validated mime and the exact decoded bytes, not base64', () => {
  const assets = new ImageAssetCache().take(
    definitionsOf(fixture('authored.rdlc')),
  );
  const byMime = new Map(assets.map((asset) => [asset.mime, asset]));
  assert.deepEqual([...byMime.keys()].sort(), ['image/jpeg', 'image/png']);
  assert.ok(
    Buffer.from(byMime.get('image/png')!.data as Uint8Array).equals(
      picture('logo.png'),
    ),
  );
  assert.ok(
    Buffer.from(byMime.get('image/jpeg')!.data as Uint8Array).equals(
      picture('photo.jpg'),
    ),
  );
  for (const asset of assets) {
    assert.deepEqual(Object.keys(asset).sort(), ['data', 'key', 'mime']);
    assert.ok(asset.data instanceof Uint8Array);
    // The transport sends the whole backing buffer: it must hold this picture only,
    // never the rest of a shared Buffer pool.
    const view = asset.data as Uint8Array;
    assert.equal(view.byteOffset, 0);
    assert.equal(view.buffer.byteLength, view.byteLength);
  }
});

test('only displayable definitions are sent, never rejected or unsupported ones', () => {
  const definitions = definitionsOf(fixture('preserved.rdlc'));
  assert.ok(definitions.some((definition) => !definition.displayable));
  const assets = new ImageAssetCache().take(definitions);
  // Only `logo` is displayable: gif, bmp, malformed and mime-mismatched are not.
  assert.deepEqual(
    assets.map((asset) => [asset.key, asset.mime]),
    [[sha256(picture('logo.png')), 'image/png']],
  );
  assert.deepEqual(
    new ImageAssetCache().take(definitionsOf(fixture('blank.rdlc'))),
    [],
  );
});

test('nothing is sent when the host supplied no digest', () => {
  assert.deepEqual(
    new ImageAssetCache().take(definitionsOf(fixture('authored.rdlc'), {})),
    [],
  );
});

test('only assets the webview has not received are sent after an edit', () => {
  const cache = new ImageAssetCache();
  const source = fixture('authored.rdlc');
  assert.equal(take(cache, definitionsOf(source)).length, 2);
  assert.equal(take(cache, definitionsOf(source)).length, 0);
  // Re-encode the unused definition as the JPEG: only `photo` bytes are already known,
  // so swap in progressive.jpg instead to introduce one new key.
  const progressive = picture('progressive.jpg').toString('base64');
  const edited = source.replace(
    /(<EmbeddedImage Name="unused">\s*<MIMEType>)image\/png(<\/MIMEType>\s*<ImageData>)[^<]*/,
    `$1image/jpeg$2${progressive}`,
  );
  assert.notEqual(edited, source);
  const added = take(cache, definitionsOf(edited));
  assert.deepEqual(
    added.map((asset) => asset.key),
    [sha256(picture('progressive.jpg'))],
  );
});

const editable = (embeddedImages: readonly EmbeddedImageDefinition[]) => ({
  status: 'editable' as const,
  embeddedImages,
});
const collect = (
  cache: ImageAssetCache,
  projection: Parameters<typeof sendImageAssets>[1],
  accept?: Parameters<typeof sendImageAssets>[3],
) => {
  const messages: ImageAssetsMessage[] = [];
  sendImageAssets(
    cache,
    projection,
    (message) => messages.push(message),
    accept,
  );
  return messages;
};
const keys = (messages: readonly ImageAssetsMessage[]) =>
  messages.flatMap((message) => message.assets.map((asset) => asset.key));

test('asset messages validate and carry no more than the budget allows', () => {
  const messages = collect(
    new ImageAssetCache(),
    editable(definitionsOf(fixture('authored.rdlc'))),
  );
  assert.equal(messages.length, 1);
  for (const message of messages) {
    assert.equal(message.protocol, 2);
    assert.equal(message.kind, 'imageAssets');
    assert.ok(validateMessage(message));
  }
  assert.deepEqual(
    collect(
      new ImageAssetCache(),
      editable(definitionsOf(fixture('blank.rdlc'))),
    ),
    [],
  );
  const mime = 'image/png' as const;
  const asset = (key: string, size: number) => ({
    key,
    mime,
    data: new Uint8Array(size),
  });
  const batches = batchImageAssets([
    asset('a', 3_000_000),
    asset('b', 3_000_000),
    asset('c', 3_000_000),
    asset('d', 10),
  ]);
  assert.deepEqual(
    batches.map((batch) => batch.map((entry) => entry.key)),
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  );
  assert.deepEqual(batchImageAssets([]), []);
});

test('batches never exceed the per-message asset count and lose nothing', () => {
  const tiny = Array.from(
    { length: imageAssetsPerMessage * 2 + 1 },
    (_, i) => ({
      key: `k${i}`,
      mime: 'image/png' as const,
      data: new Uint8Array(4),
    }),
  );
  const batches = batchImageAssets(tiny);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [imageAssetsPerMessage, imageAssetsPerMessage, 1],
  );
  assert.deepEqual(
    batches.flat().map((entry) => entry.key),
    tiny.map((entry) => entry.key),
  );
});

/** A valid one-pixel-class PNG definition per index, so every key is distinct. */
const manyDefinitions = (count: number) => {
  const definitions = Array.from(
    { length: count },
    (_, index) =>
      `<EmbeddedImage Name="p${index}"><MIMEType>image/png</MIMEType><ImageData>${pngWithTag(index)}</ImageData></EmbeddedImage>`,
  ).join('');
  return definitionsOf(
    fixture('blank.rdlc').replace(
      '</Report>',
      `<EmbeddedImages>${definitions}</EmbeddedImages></Report>`,
    ),
  );
};
const pngWithTag = (index: number) => {
  const logo = Buffer.from(picture('logo.png'));
  // Append a distinct ancillary chunk before IEND so the bytes, hash and CRCs differ.
  const type = Buffer.from('teXt');
  const body = Buffer.from(`n${index}`);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, body])));
  const iend = logo.length - 12;
  return Buffer.concat([
    logo.subarray(0, iend),
    length,
    type,
    body,
    crc,
    logo.subarray(iend),
  ]).toString('base64');
};

test('more assets than one message holds are all sent, none silently lost', () => {
  const definitions = manyDefinitions(imageAssetsPerMessage + 5);
  assert.equal(
    definitions.filter((entry) => entry.displayable).length,
    definitions.length,
  );
  const cache = new ImageAssetCache();
  const messages = collect(cache, editable(definitions));
  assert.equal(messages.length, 2);
  for (const message of messages) {
    assert.ok(message.assets.length <= imageAssetsPerMessage);
    assert.ok(validateMessage(message));
  }
  assert.equal(new Set(keys(messages)).size, definitions.length);
  assert.deepEqual(collect(cache, editable(definitions)), []);
});

test('a batch that fails validation stays unsent and is offered again', () => {
  const definitions = manyDefinitions(imageAssetsPerMessage + 5);
  const cache = new ImageAssetCache();
  let calls = 0;
  const first = collect(cache, editable(definitions), () => ++calls !== 1);
  // The first batch (256 assets) was dropped; the second was emitted and marked sent.
  assert.equal(first.length, 1);
  assert.equal(first[0]!.assets.length, 5);
  const retry = collect(cache, editable(definitions));
  assert.equal(retry.length, 1);
  assert.equal(retry[0]!.assets.length, imageAssetsPerMessage);
  assert.deepEqual(collect(cache, editable(definitions)), []);
});

test('the session wiring sends nothing for a non-editable report', () => {
  const definitions = definitionsOf(fixture('authored.rdlc'));
  const cache = new ImageAssetCache();
  for (const status of ['source-only', 'invalid-source'] as const)
    assert.deepEqual(
      collect(cache, { status, embeddedImages: definitions }),
      [],
    );
  // The gate does not consume keys: the report becoming editable still sends them.
  assert.equal(keys(collect(cache, editable(definitions))).length, 2);
});

test('after a webview reload (ready) the cleared cache sends everything again', () => {
  const definitions = definitionsOf(fixture('authored.rdlc'));
  const cache = new ImageAssetCache();
  assert.equal(keys(collect(cache, editable(definitions))).length, 2);
  assert.deepEqual(collect(cache, editable(definitions)), []);
  cache.clear(); // what DocumentSession does on `ready` and on dispose
  assert.equal(keys(collect(cache, editable(definitions))).length, 2);
});
