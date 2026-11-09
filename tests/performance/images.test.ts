import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';
import { validatePicture } from '@rdlc/validation/images';
import { rawImageLimit } from '@rdlc/report-model/images';
import { validateMessage } from '@rdlc/report-model/protocol';
import { planImageCreation } from '../../apps/vscode-extension/src/edit-controller.js';
import { evaluateReport } from '../../apps/vscode-extension/src/report-evaluation.js';
import {
  ImageAssetCache,
  sendImageAssets,
} from '../../apps/vscode-extension/src/image-assets.js';

/**
 * SC-006 budgets for the 50-picture fixture, recorded here (T089). They bound the pure
 * packages only (no webview, no host), so they hold the shared-runner noise with a wide
 * margin. Measured on the development machine: projection about 2 ms (the repeated runs
 * are answered from remembered payload facts; the first, cold, run took about 27 ms),
 * scene about 1 ms. The cold cost of a large payload is pinned by the host-stage tests
 * below. The best of `runs` repetitions is compared, so one scheduling hiccup cannot fail the
 * test while a real algorithmic regression still does.
 */
const budgets = {
  fixtureBytesAtLeast: 1_000_000,
  images: 50,
  runs: 5,
  projectionMs: 1_000,
  sceneMs: 100,
} as const;

const source = readFileSync('tests/fixtures/images/many.rdlc', 'utf8');
const snapshot = {
  uri: 'fixture:many',
  version: 1,
  source,
  eol: '\n' as const,
};
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/** Best (smallest) wall-clock time of `runs` executions, in milliseconds. */
function best<T>(operation: () => T): { value: T; ms: number } {
  let ms = Infinity;
  let value!: T;
  for (let run = 0; run < budgets.runs; run += 1) {
    const start = performance.now();
    value = operation();
    ms = Math.min(ms, performance.now() - start);
  }
  return { value, ms };
}

test('many.rdlc is the multi-megabyte, 50-picture fixture the budgets assume', () => {
  assert.ok(Buffer.byteLength(source) >= budgets.fixtureBytesAtLeast);
  assert.equal(source.match(/<Image /g)?.length, budgets.images);
});

test('SC-006: projecting and rendering 50 embedded pictures stays within the recorded budget', () => {
  const syntax = parse(snapshot);
  assert.equal(syntax.status, 'valid');
  const projected = best(() => projectReport(syntax, { digest }));
  const projection = projected.value;
  assert.equal(projection.status, 'editable');
  assert.equal(projection.images.length, budgets.images);
  const rendered = best(() => renderScene(projection));
  const scene = rendered.value;
  assert.ok(scene);
  const pictures = scene.items.filter((item) => item.kind === 'image');
  assert.equal(pictures.length, budgets.images);
  for (const item of pictures)
    assert.equal(item.display?.state, 'picture', item.label);
  console.log(
    `images perf: projection ${projected.ms.toFixed(1)} ms, scene ${rendered.ms.toFixed(1)} ms (budgets ${budgets.projectionMs}/${budgets.sceneMs} ms)`,
  );
  assert.ok(
    projected.ms <= budgets.projectionMs,
    `projection ${projected.ms} ms exceeds ${budgets.projectionMs} ms`,
  );
  assert.ok(
    rendered.ms <= budgets.sceneMs,
    `scene ${rendered.ms} ms exceeds ${budgets.sceneMs} ms`,
  );
});

test('SC-006: the payload is never copied into the scene', () => {
  const projection = projectReport(parse(snapshot), { digest });
  const scene = renderScene(projection);
  assert.ok(scene);
  const serialized = JSON.stringify(scene);
  const payloads = [...source.matchAll(/<ImageData>([^<]+)<\/ImageData>/g)].map(
    (match) => (match[1] ?? '').trim(),
  );
  assert.equal(payloads.length, budgets.images);
  for (const payload of payloads) {
    assert.ok(payload.length > 64);
    // Neither the whole payload nor any 64-character window of it may appear.
    assert.ok(!serialized.includes(payload.slice(0, 64)));
    assert.ok(!serialized.includes(payload.slice(-64)));
  }
  assert.ok(!serialized.includes('iVBORw0KGgo'), 'PNG base64 signature leaked');
  // Pictures are keyed by digest only: the scene (about 56 KB here, geometry and keys)
  // stays an order of magnitude below the payload it describes.
  const payloadChars = payloads.reduce(
    (sum, payload) => sum + payload.length,
    0,
  );
  assert.ok(serialized.length < payloadChars / 10);
});

/**
 * SC-006 host stages (the part of the 1 s budget the host owns): a 5 MiB picture on the
 * 50-picture report. The 5 MiB payload is new on every run (a different padding byte),
 * so its facts are computed, not remembered; the fifty existing pictures are answered
 * from remembered facts, as they are for every edit of an open report. Before the
 * bulk-text reader path, the payload facts and the binary asset message these stages
 * added up to about 1.7 s on the development machine (plan 750 ms, evaluate 775 ms,
 * assets 120 ms); now about 0.2-0.4 s (plan 100-180, evaluate 80-105, assets 2).
 * Each bound is at least 2.5x the worst local measurement, so a slow shared runner does
 * not fail, and the plan, evaluate and total bounds still sit below the old figures, so
 * an algorithmic regression (a per-character reader over the payload, a second decode
 * of every picture) does. The best of `runs` is compared.
 */
const hostBudgets = {
  runs: 5,
  validateMs: 100,
  planMs: 500,
  evaluateMs: 300,
  assetsMs: 100,
  totalMs: 1_000,
  /** Cold parse + projection of a pretty-printed, line-wrapped 5 MiB payload. */
  wrappedMs: 500,
} as const;

/** A valid 1 x 1 PNG padded with a private chunk to `size`; `fill` makes each one unique. */
function paddedPng(size: number, fill: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const pixel = chunk('IDAT', deflateSync(Buffer.from([0, 0x20, 0x60, 0xa0])));
  const end = chunk('IEND', Buffer.alloc(0));
  const fixed =
    signature.length + chunk('IHDR', header).length + pixel.length + end.length;
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('prVt', Buffer.alloc(size - fixed - 12, fill)),
    pixel,
    end,
  ]);
}

const createRequest: Parameters<typeof planImageCreation>[3] = {
  action: 'createImage',
  placement: 'default',
  left: '0.25in',
  top: '0.25in',
};

test('SC-006: the host stages of a 5 MiB import stay within the recorded budgets', () => {
  const baseline = evaluateReport(snapshot, { digest });
  assert.equal(baseline.projection.status, 'editable');
  /** A cache for a webview that already holds the fifty pictures of the report. */
  const holdingBaseline = () => {
    const cache = new ImageAssetCache();
    cache.markSent(
      baseline.projection.embeddedImages.map((definition) => ({
        key: definition.hash ?? '',
        mime: 'image/png' as const,
        data: new Uint8Array(0),
      })),
    );
    return cache;
  };
  const stage = {
    validate: Infinity,
    plan: Infinity,
    evaluate: Infinity,
    assets: Infinity,
  };
  let total = Infinity;
  for (let run = 0; run < hostBudgets.runs; run += 1) {
    const big = paddedPng(rawImageLimit - 1024, 0x41 + run);
    assert.ok(big.length < rawImageLimit);
    const mark: number[] = [performance.now()];
    const lap = () => {
      mark.push(performance.now());
      return mark.at(-1)! - mark.at(-2)!;
    };

    // 1. The chosen file: signature, chunk walk, size, pixels, digest.
    const picture = validatePicture(big, 'big.png', digest);
    assert.ok(!('code' in picture), 'the picture validates');
    stage.validate = Math.min(stage.validate, lap());

    // 2. Plan and verify the candidate (parses the original and the candidate once each).
    const outcome = planImageCreation(
      snapshot,
      baseline.syntax,
      baseline.projection,
      createRequest,
      { picture, fileName: 'big.png' },
    );
    assert.ok(outcome.ok, 'the plan is accepted');
    stage.plan = Math.min(stage.plan, lap());

    // 3. The document change: parse, project, scene and navigation of the new text.
    const next = evaluateReport(
      { ...snapshot, version: 2, source: outcome.candidate },
      { digest },
    );
    assert.equal(next.projection.embeddedImages.length, budgets.images + 1);
    stage.evaluate = Math.min(stage.evaluate, lap());

    // 4. The picture for the designer: only the new key is offered, one validated message.
    const messages: unknown[] = [];
    sendImageAssets(
      holdingBaseline(),
      { status: 'editable', embeddedImages: next.projection.embeddedImages },
      (message) => messages.push(message),
    );
    stage.assets = Math.min(stage.assets, lap());
    assert.equal(messages.length, 1);
    const message = messages[0] as {
      assets: { key: string; data: Uint8Array }[];
    };
    assert.deepEqual(
      message.assets.map((asset) => asset.key),
      [picture.hash],
    );
    assert.ok(validateMessage(message));
    assert.deepEqual(Buffer.from(message.assets[0]!.data), big);
    total = Math.min(total, mark.at(-1)! - mark[0]!);
  }
  console.log(
    `images host perf: validate ${stage.validate.toFixed(1)}, plan ${stage.plan.toFixed(1)}, evaluate ${stage.evaluate.toFixed(1)}, assets ${stage.assets.toFixed(1)}, total ${total.toFixed(1)} ms (budgets ${hostBudgets.validateMs}/${hostBudgets.planMs}/${hostBudgets.evaluateMs}/${hostBudgets.assetsMs}/${hostBudgets.totalMs} ms)`,
  );
  assert.ok(
    stage.validate <= hostBudgets.validateMs,
    `validate ${stage.validate} ms`,
  );
  assert.ok(stage.plan <= hostBudgets.planMs, `plan ${stage.plan} ms`);
  assert.ok(
    stage.evaluate <= hostBudgets.evaluateMs,
    `evaluate ${stage.evaluate} ms`,
  );
  assert.ok(stage.assets <= hostBudgets.assetsMs, `assets ${stage.assets} ms`);
  assert.ok(total <= hostBudgets.totalMs, `total ${total} ms`);
});

test('SC-006: a pretty-printed, line-wrapped 5 MiB payload is read within the recorded budget', () => {
  // The shape other tools write: indent, CRLF line breaks every 76 characters. Cold:
  // each run carries a payload nothing has seen before.
  let best = Infinity;
  for (let run = 0; run < hostBudgets.runs; run += 1) {
    const big = paddedPng(rawImageLimit - 1024, 0x61 + run);
    const wrapped = big
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n          ');
    const text = source.replace(
      '</EmbeddedImages>',
      `<EmbeddedImage Name="Wrapped"><MIMEType>image/png</MIMEType><ImageData>\r\n          ${wrapped}\r\n        </ImageData></EmbeddedImage></EmbeddedImages>`,
    );
    const started = performance.now();
    const syntax = parse({ ...snapshot, source: text });
    const projection = projectReport(syntax, { digest });
    best = Math.min(best, performance.now() - started);
    assert.equal(syntax.status, 'valid');
    const definition = projection.embeddedImages.at(-1)!;
    assert.ok(definition.displayable);
    assert.equal(definition.byteSize, big.length);
    assert.equal(definition.hash, digest(big));
    assert.equal(definition.encodedSize, Math.ceil(big.length / 3) * 4);
  }
  console.log(
    `images wrapped perf: parse + project ${best.toFixed(1)} ms (budget ${hostBudgets.wrappedMs} ms)`,
  );
  assert.ok(best <= hostBudgets.wrappedMs, `wrapped ${best} ms`);
});
