import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const imageScene = (name: string, status?: 'source-only') => {
  const source = readFileSync(`tests/fixtures/images/${name}`, 'utf8');
  const projection = projectReport(
    parse({ uri: `fixture:${name}`, version: 1, source, eol: '\n' }),
    { digest: sha256 },
  );
  return renderScene(status ? { ...projection, status } : projection);
};
const imageItem = (design: ReturnType<typeof renderScene>, name: string) => {
  const found = design.items.find((item) => item.name === name);
  assert.ok(found, name);
  assert.equal(found.kind, 'image');
  return found;
};

test('authored images render as picture items keyed by the definition hash', () => {
  const design = imageScene('authored.rdlc');
  const logoHash = sha256(
    readFileSync('tests/fixtures/images/pictures/logo.png'),
  );
  const logo = imageItem(design, 'LogoAutoSize');
  assert.deepEqual(logo.display, {
    state: 'picture',
    assetKey: logoHash,
    pixels: { width: 120, height: 40 },
  });
  assert.equal(logo.sizing, 'AutoSize');
  assert.equal(logo.placeholder, false);
  assert.deepEqual(logo.metadata, {
    format: 'png',
    pixels: { width: 120, height: 40 },
    encodedSize: logo.metadata!.encodedSize,
  });
  assert.ok(logo.metadata!.encodedSize! > 0);
  assert.deepEqual(logo.bounds, { left: 24, top: 24, width: 144, height: 48 });
  assert.ok(logo.capabilities?.includes('image'));
  assert.ok(logo.capabilities?.includes('sizing'));
  assert.ok(logo.operations?.moveX.eligible);
  assert.deepEqual(
    ['LogoAutoSize', 'LogoFit', 'PhotoFitProportional', 'PhotoClip'].map(
      (name) => imageItem(design, name).sizing,
    ),
    ['AutoSize', 'Fit', 'FitProportional', 'Clip'],
  );
  const photo = imageItem(design, 'PhotoClip');
  assert.equal(photo.display?.state, 'picture');
  assert.equal(photo.metadata?.format, 'jpeg');
  // Items sharing a definition share one asset key.
  assert.equal(
    (imageItem(design, 'LogoFit').display as { assetKey: string }).assetKey,
    logoHash,
  );
});

test('image items keep their body order and z-order like other items', () => {
  const design = imageScene('authored.rdlc');
  assert.deepEqual(
    design.items.map((item) => item.sourceOrder),
    design.items.map((_, index) => index),
  );
  assert.ok(design.items.every((item) => item.kind === 'image'));
});

test('preserved images render placeholder items carrying the projection reason', () => {
  const design = imageScene('preserved.rdlc');
  const reasons = Object.fromEntries(
    design.items
      .filter((item) => item.kind === 'image')
      .map((item) => [
        item.name,
        item.display?.state === 'placeholder' ? item.display.reason : null,
      ]),
  );
  assert.deepEqual(reasons, {
    ExternalPicture: 'source-preserved',
    DatabasePicture: 'source-preserved',
    ExpressionPicture: 'value-expression',
    GifPicture: 'format-unsupported',
    BmpPicture: 'format-unsupported',
    LegacyPngPicture: 'mime-mismatch',
    BrokenPicture: 'data-invalid',
    GhostPicture: 'reference-missing',
  });
  for (const item of design.items.filter((entry) => entry.kind === 'image')) {
    assert.equal(item.placeholder, true);
    // The accessible name is the item name only; the reason is shown separately.
    assert.equal(item.label, item.name);
  }
  assert.equal(imageItem(design, 'GifPicture').metadata?.format, 'other');
  assert.deepEqual(imageItem(design, 'GhostPicture').metadata, {
    format: null,
    pixels: null,
    encodedSize: null,
  });
  // The nested picture stays inside its table; only body roots become image items.
  assert.equal(
    design.items.some((item) => item.name === 'CellPicture'),
    false,
  );
});

test('a source-only report disables every image mutation', () => {
  const design = imageScene('authored.rdlc', 'source-only');
  for (const item of design.items) {
    assert.deepEqual(item.capabilities, []);
    assert.ok(
      Object.values(item.operations!).every(
        (operation) => !operation.eligible && operation.reason,
      ),
    );
  }
});

test('image scenes carry no payload, data:, http, file: or blob: text', () => {
  for (const name of ['authored.rdlc', 'preserved.rdlc']) {
    const serialized = JSON.stringify(imageScene(name));
    for (const forbidden of ['data:', 'http', 'file:', 'blob:', 'base64'])
      assert.ok(!serialized.includes(forbidden), `${name}: ${forbidden}`);
    for (const file of ['logo.png', 'photo.jpg']) {
      const encoded = readFileSync(
        `tests/fixtures/images/pictures/${file}`,
      ).toString('base64');
      for (let at = 0; at + 24 <= encoded.length; at += 24)
        assert.ok(!serialized.includes(encoded.slice(at, at + 24)), file);
    }
  }
});

test('a displayable picture without a host digest degrades to a placeholder', () => {
  const source = readFileSync('tests/fixtures/images/authored.rdlc', 'utf8');
  const design = renderScene(
    projectReport(
      parse({ uri: 'fixture:nodigest', version: 1, source, eol: '\n' }),
    ),
  );
  assert.ok(
    design.items.every((item) => item.display?.state === 'placeholder'),
  );
});

test('an unnamed image labels itself with the generic fallback', () => {
  const source = readFileSync(
    'tests/fixtures/images/authored.rdlc',
    'utf8',
  ).replace('<Image Name="LogoFit">', '<Image>');
  const design = renderScene(
    projectReport(
      parse({ uri: 'fixture:unnamed', version: 1, source, eol: '\n' }),
      { digest: sha256 },
    ),
  );
  const unnamed = design.items.find((item) => item.name === null);
  assert.ok(unnamed);
  assert.equal(unnamed.kind, 'image');
  assert.equal(unnamed.label, 'Image');
});

/**
 * FR-024 rule for the scene: it carries no source text of an image at all. No `Value`,
 * `ToolTip` or expression text, no URL, no path and no payload; an item is its name,
 * bounds, sizing, a placeholder reason and metadata about the definition.
 */
test('rendering preserved.rdlc fetches nothing, resolves no path and evaluates no expression', () => {
  const fetched: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((...args: unknown[]) => {
    fetched.push(args);
    throw new Error('network access is forbidden');
  }) as typeof fetch;
  let design: ReturnType<typeof imageScene>;
  try {
    design = imageScene('preserved.rdlc');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(fetched, []);
  const strings: Array<[string, string]> = [];
  const collect = (value: unknown, path: string) => {
    if (typeof value === 'string') strings.push([path, value]);
    else if (typeof value === 'object' && value !== null)
      for (const [key, entry] of Object.entries(value))
        collect(entry, `${path}.${key}`);
  };
  collect(design, '$');
  assert.ok(strings.length > 0);
  for (const [where, text] of strings) {
    // No URL, no resolved path, no expression or evaluated text.
    assert.ok(!/(?:https?|file|data|blob):/i.test(text), `${where}: ${text}`);
    assert.ok(!text.includes('example.invalid'), where);
    assert.ok(!text.includes(process.cwd()), where);
    assert.ok(!text.includes('tests/fixtures'), where);
    assert.ok(!/^(?:[A-Za-z]:[\\/]|\.{0,2}\/|\\\\)/.test(text), where);
    for (const fragment of [
      'Fields!',
      'Parameters!',
      'IIf',
      'UseLogo',
      'Photo.Value',
    ])
      assert.ok(!text.includes(fragment), `${where}: ${fragment}`);
  }
  // The preserved items have no asset to load, so nothing could be fetched by the view.
  for (const name of [
    'ExternalPicture',
    'DatabasePicture',
    'ExpressionPicture',
    'GhostPicture',
  ]) {
    const item = imageItem(design, name);
    assert.equal(item.display?.state, 'placeholder', name);
    assert.deepEqual(
      Object.keys(item.display!).sort(),
      ['reason', 'state'],
      name,
    );
    assert.equal(item.label, name);
    assert.equal(item.text, undefined, name);
  }
  assert.equal(
    design.items.some(
      (item) => item.kind === 'image' && item.display?.state === 'picture',
    ),
    false,
    'no preserved item is displayed as a picture',
  );
});
