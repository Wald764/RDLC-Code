import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';

/**
 * SC-006 budgets for the 50-picture fixture, recorded here (T089). They bound the pure
 * packages only (no webview, no host), so they hold the shared-runner noise with a wide
 * margin. Measured on the development machine: projection about 27 ms, scene about 1 ms.
 * The best of `runs` repetitions is compared, so one scheduling hiccup cannot fail the
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
