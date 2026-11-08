import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dimensionLimit,
  imageReasonLabel,
  imageReasonLabels,
  pixelLimit,
  rawImageLimit,
  type ImagePlaceholderReason,
} from './images.js';

const reasons: readonly ImagePlaceholderReason[] = [
  'format-unsupported',
  'data-invalid',
  'too-large',
  'pixels-exceeded',
  'mime-mismatch',
  'value-expression',
  'source-preserved',
  'reference-missing',
];

test('every reason has distinct, human-readable text', () => {
  assert.deepEqual(Object.keys(imageReasonLabels).sort(), [...reasons].sort());
  const labels = reasons.map((reason) => imageReasonLabel(reason));
  assert.equal(new Set(labels).size, reasons.length);
  reasons.forEach((reason, index) => {
    const label = labels[index]!;
    assert.ok(label.length > 0 && label === label.trim());
    assert.match(label, /^[A-Z]/, label);
    // Never the machine reason itself.
    assert.ok(!label.includes(reason), label);
  });
});

test('limit wording comes from the limit constants', () => {
  assert.ok(
    imageReasonLabel('too-large').includes(
      `${rawImageLimit / (1024 * 1024)} MiB`,
    ),
  );
  const pixels = imageReasonLabel('pixels-exceeded');
  assert.ok(pixels.includes(String(dimensionLimit)));
  assert.ok(pixels.includes(`${pixelLimit / 1_000_000} megapixels`));
});

test('labels carry no URL, path, expression or payload text', () => {
  for (const reason of reasons) {
    const label = imageReasonLabel(reason);
    for (const forbidden of ['http', 'file:', 'data:', 'blob:', '=', 'base64'])
      assert.ok(!label.includes(forbidden), `${reason}: ${forbidden}`);
    assert.ok(label.length <= 80, `${reason}: placeholders stay short`);
  }
});
