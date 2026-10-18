import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSize,
  toPoints,
  pointsToPixels,
  pixelsToPoints,
  formatSize,
  resolveGeometry,
} from './geometry.js';

test('all RdlSize units share point and CSS pixel conversions', () => {
  for (const raw of ['72pt', '6pc', '1in', '25.4mm', '2.54cm']) {
    assert.ok(Math.abs(toPoints(raw)! - 72) < 1e-12, raw);
    assert.equal(pointsToPixels(toPoints(raw)!), 96);
  }
  assert.equal(pixelsToPoints(96), 72);
  assert.equal(parseSize(' 01.250in ')?.raw, ' 01.250in ');
  for (const raw of [null, '=Fields!X.Value', '1px', 'Infinitypt', '1e3pt'])
    assert.equal(parseSize(raw), null);
});

test('formatting preserves units and unchanged lexemes with positive quantization', () => {
  assert.equal(formatSize(90, ' 01.250in ', 'pt', 'dimension'), ' 01.250in ');
  for (const raw of ['1pt', '1pc', '1in', '1mm', '1cm']) {
    for (const value of [1e-12, 0.00001, 1.23456789, 12345.6789]) {
      const formatted = formatSize(value, raw, 'pt', 'dimension');
      assert.equal(parseSize(formatted)?.unit, parseSize(raw)?.unit);
      assert.ok(toPoints(formatted)! > 0);
      assert.ok(Math.abs(toPoints(formatted)! - value) <= 0.01);
    }
  }
  assert.equal(formatSize(72, null, 'mm', 'dimension'), '25.4mm');
  for (const value of [0, -1, Infinity, NaN])
    assert.throws(() => formatSize(value, null, 'pt', 'dimension'));
  assert.throws(() => formatSize(-1, null, 'pt', 'position'));
});

test('missing sizes derive from the container but expression sizes stay unknown', () => {
  const geometry = resolveGeometry(
    { left: '1in', top: null, width: null, height: '=H' },
    { width: 432, height: 144 },
  );
  assert.deepEqual(geometry.width, {
    raw: null,
    unit: null,
    provenance: 'derived',
    points: 360,
  });
  assert.equal(geometry.height.provenance, 'unknown');
  assert.equal(geometry.height.points, null);
  assert.equal(geometry.top.points, 0);
  assert.equal(
    resolveGeometry(
      { left: '=X', top: null, width: null, height: null },
      { width: 432, height: 144 },
    ).width.points,
    null,
  );
});
