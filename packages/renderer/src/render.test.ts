import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from './render.js';

const scene = (path: string) => {
  const source = readFileSync(`tests/fixtures/textboxes/${path}`, 'utf8');
  return renderScene(
    projectReport(
      parse({ uri: `fixture:${path}`, version: 1, source, eol: '\n' }),
    ),
  );
};

test('scene renders page/body bounds, geometry and unevaluated label text', () => {
  const design = scene('supported.rdlc');
  assert.equal(design.version, 1);
  assert.deepEqual(design.page, { left: 0, top: 0, width: 816, height: 1056 });
  assert.deepEqual(design.body, { left: 0, top: 0, width: 576, height: 192 });
  assert.equal(design.items.length, 1);
  const item = design.items[0]!;
  assert.equal(item.name, 'Title');
  assert.equal(item.placeholder, false);
  assert.equal(item.text, 'Hello & welcome');
  assert.ok(item.label.includes('Hello & welcome'));
  assert.deepEqual(item.geometry, {
    left: '0.25in',
    top: '0.25in',
    width: '3in',
    height: '0.5in',
  });
  assert.equal(item.style?.fontWeight, 'Bold');
  assert.ok(item.capabilities?.includes('text'));
});

test('unsupported items and preservation-only textboxes render as placeholders', () => {
  const design = scene('supported-plus-opaque.rdlc');
  assert.equal(design.items.length, 4);
  const byName = new Map(design.items.map((item) => [item.name, item]));
  assert.equal(byName.get('Title')!.placeholder, false);
  assert.equal(byName.get('Rich')!.placeholder, true);
  assert.equal(byName.get('Dynamic')!.placeholder, false);
  const unsupported = design.items.find((item) =>
    item.label.includes('unsupported'),
  );
  assert.ok(unsupported);
  assert.equal(unsupported.placeholder, true);
});

test('scenes carry no executable HTML, scripts, resource URLs or evaluated data', () => {
  const serialized = JSON.stringify(scene('supported-plus-opaque.rdlc'));
  for (const forbidden of [
    '<script',
    'javascript:',
    'http://',
    'https://',
    'url(',
  ])
    assert.ok(!serialized.includes(forbidden), forbidden);
});

test('optional geometry has truthful provenance, source order and unknown hit bounds', () => {
  const source = readFileSync(
    'tests/fixtures/interactive/optional-geometry.rdlc',
    'utf8',
  );
  const report = projectReport(
    parse({ uri: 'test:optional', version: 7, source, eol: '\n' }),
  );
  const design = renderScene(report);
  for (const item of design.items) {
    assert.ok(item.kind);
    assert.ok(Number.isInteger(item.sourceOrder));
    if (
      item.geometry?.width === null &&
      item.kind === 'textbox' &&
      item.resolvedGeometry?.left.points !== null
    )
      assert.equal(item.resolvedGeometry?.width.provenance, 'derived');
    if (item.geometry?.width?.startsWith('=')) {
      assert.equal(item.bounds, null);
      assert.equal(item.resolvedGeometry?.width.provenance, 'unknown');
    }
  }
  const implicit = design.items.find(
    (item) => item.kind === 'textbox' && item.geometry?.width === null,
  )!;
  assert.ok(implicit.bounds);
  assert.equal(implicit.bounds.width, design.body.width - implicit.bounds.left);
});

test('body order includes obscured placeholders and drawing priority without XML reordering', () => {
  const source = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
  const report = projectReport(
    parse({ uri: 'test:mixed', version: 1, source, eol: '\n' }),
  );
  const items = renderScene(report).items.filter(
    (item) => item.kind !== 'cell',
  );
  assert.deepEqual(
    items.map((item) => item.sourceOrder),
    items.map((_, index) => index),
  );
  assert.ok(items.some((item) => item.kind === 'table'));
  assert.ok(items.some((item) => item.placeholder));
  assert.ok(items.some((item) => item.zIndex! > 0));
});

test('unknown geometry disables dependent axes while source-only scenes disable every mutation', () => {
  const source = readFileSync(
    'tests/fixtures/textboxes/supported.rdlc',
    'utf8',
  ).replace('<Width>3in</Width>', '<Width>=Fields!Width.Value</Width>');
  const report = projectReport(
    parse({ uri: 'test:axes', source, version: 1, eol: '\n' }),
  );
  const item = renderScene(report).items[0]!;
  assert.equal(item.bounds, null);
  assert.equal(item.operations?.moveX.eligible, false);
  assert.equal(item.operations?.moveY.eligible, true);
  assert.ok(item.capabilities?.includes('text'));
  const locked = renderScene({ ...report, status: 'source-only' }).items[0]!;
  assert.deepEqual(locked.capabilities, []);
  assert.ok(
    Object.values(locked.operations!).every(
      (operation) => !operation.eligible && operation.reason,
    ),
  );
});
