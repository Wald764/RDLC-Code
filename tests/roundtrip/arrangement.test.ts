import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alignModes, type LayoutIntent } from '@rdlc/report-model/editing';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { acceptedGeometry, validateLayout } from '@rdlc/validation/layout';
import { validateImageCapability } from '@rdlc/validation/images';
import {
  buildCapture,
  planCut,
} from '../../apps/vscode-extension/src/clipboard.js';
import {
  planTextboxIntent,
  correlateTargets,
} from '../../apps/vscode-extension/src/edit-controller.js';
import { verifyLayoutCandidate } from '../../apps/vscode-extension/src/verify-candidate.js';

const mixed = readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8');
// Separate mixed-unit textboxes and the table on both axes to exercise real gaps.
const source = mixed
  .replace(
    '<Left>12pt</Left><Height>36pt</Height><Width>144pt</Width>',
    '<Left>240pt</Left><Height>36pt</Height><Width>144pt</Width>',
  )
  .replace('<Top>18pt</Top><Left>240pt', '<Top>160pt</Top><Left>240pt')
  .replace('<Top>1in</Top><Left>12pt', '<Top>320pt</Top><Left>480pt');
const snapshot = {
  uri: 'test:arrange',
  version: 1,
  source,
  eol: '\n' as const,
};
const syntax = parse(snapshot);
const report = projectReport(syntax);
const items = [
  report.textboxes.find((t) => t.name === 'Front')!,
  report.textboxes.find((t) => t.name === 'LaterTie')!,
  report.tables[0]!,
];
const targetIds = items.map((t) => t.node.id);

function run(payload: LayoutIntent['payload']) {
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'bulk',
    baseVersion: 1,
    operation: 'layout',
    payload,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const nextSyntax = parse({
    ...snapshot,
    version: 2,
    source: outcome.candidate,
  });
  const next = projectReport(nextSyntax);
  const changes = validateLayout(report, payload);
  assert.equal(verifyLayoutCandidate(syntax, nextSyntax, changes), true);
  assert.deepEqual(
    correlateTargets(syntax, nextSyntax, outcome.plan, targetIds).map(
      (m) => m.sourceId,
    ),
    targetIds,
  );
  // Reverse every declared patch: all bytes outside the footprint are identical.
  let restored = outcome.candidate;
  let delta = 0;
  const patches = outcome.plan.patches.map((p) => {
    const start = p.start + delta;
    delta += p.replacement.length - (p.end - p.start);
    return {
      ...p,
      start,
      end: start + p.replacement.length,
      original: source.slice(p.start, p.end),
    };
  });
  for (const patch of patches.reverse())
    restored =
      restored.slice(0, patch.start) +
      patch.original +
      restored.slice(patch.end);
  assert.equal(restored, source);
  const geometries = items.map((item) => {
    const table = item === items[2];
    const found = table
      ? next.tables[0]!
      : next.textboxes.find((t) => t.name === item.name)!;
    const geometry = acceptedGeometry(next, found, table);
    const old = acceptedGeometry(report, item, table);
    assert.equal(geometry.width.points, old.width.points);
    assert.equal(geometry.height.points, old.height.points);
    return Object.fromEntries(
      Object.entries(geometry).map(([k, v]) => [k, v.points]),
    ) as Record<'left' | 'top' | 'width' | 'height', number>;
  });
  const corrupted = parse({
    ...snapshot,
    source: outcome.candidate.replace('Group subtotal', 'CORRUPTED'),
  });
  assert.equal(verifyLayoutCandidate(syntax, corrupted, changes), false);
  return { outcome, geometries };
}

test('mixed textbox/table group movement preserves offsets, sizes, metadata and ordered mappings', () => {
  const { geometries } = run({
    action: 'move',
    targetIds,
    dxPt: 9,
    dyPt: 7,
    unit: 'pt',
  });
  geometries.forEach((g, i) => {
    const old = acceptedGeometry(report, items[i]!, i === 2);
    assert.ok(Math.abs(g.left - old.left.points! - 9) < 0.01);
    assert.ok(Math.abs(g.top - old.top.points! - 7) < 0.01);
  });
});

for (const mode of alignModes)
  test(`mixed arrangement aligns ${mode} to primary`, () => {
    const { geometries } = run({
      action: 'align',
      mode,
      primaryId: targetIds[1]!,
      targetIds,
      unit: 'pt',
    });
    const line = (g: (typeof geometries)[number]) =>
      mode === 'left'
        ? g.left
        : mode === 'center'
          ? g.left + g.width / 2
          : mode === 'right'
            ? g.left + g.width
            : mode === 'top'
              ? g.top
              : mode === 'middle'
                ? g.top + g.height / 2
                : g.top + g.height;
    geometries.forEach((g) =>
      assert.ok(Math.abs(line(g) - line(geometries[1]!)) < 0.01),
    );
  });

for (const axis of ['horizontal', 'vertical'] as const)
  test(`${axis} distribution fixes anchors and equalizes edge gaps`, () => {
    const { geometries: g } = run({
      action: 'distribute',
      axis,
      targetIds: [...targetIds].reverse(),
      unit: 'pt',
    });
    const position = axis === 'horizontal' ? 'left' : 'top';
    const size = axis === 'horizontal' ? 'width' : 'height';
    assert.equal(
      g[0]![position],
      acceptedGeometry(report, items[0]!, false)[position].points,
    );
    assert.equal(
      g[2]![position],
      acceptedGeometry(report, items[2]!, true)[position].points,
    );
    assert.ok(
      Math.abs(
        g[1]![position] -
          g[0]![position] -
          g[0]![size] -
          (g[2]![position] - g[1]![position] - g[1]![size]),
      ) < 0.01,
    );
  });

test('whole-selection no-op retains source lexemes and invalid members refuse before planning', () => {
  const noop = run({
    action: 'move',
    targetIds,
    dxPt: 0,
    dyPt: 0,
    unit: 'cm',
  }).outcome;
  assert.equal(noop.changed, false);
  assert.equal(noop.candidate, source);
  const unknown = report.textboxes.find((t) => t.name === 'UnknownWidth')!;
  const result = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'bad',
    baseVersion: 1,
    operation: 'layout',
    payload: {
      action: 'move',
      targetIds: [...targetIds, unknown.node.id],
      dxPt: 1,
      dyPt: 0,
      unit: 'pt',
    },
  });
  assert.equal(result.ok, false);
});

test('group movement materializes only required implicit dimensions and preserves unselected and table geometry', () => {
  const implicit = source.replace(
    '<Height>0.5in</Height><Width>2in</Width>',
    '',
  );
  const snapshot = {
    uri: 'test:implicit-group',
    version: 1,
    source: implicit,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot),
    report = projectReport(syntax);
  const targets = [
    report.textboxes.find((t) => t.name === 'Front')!,
    report.tables[0]!,
  ];
  const payload: LayoutIntent['payload'] = {
    action: 'move',
    targetIds: targets.map((t) => t.node.id),
    dxPt: 3,
    dyPt: 0,
    unit: 'mm',
  };
  const outcome = planTextboxIntent(snapshot, syntax, report, {
    requestId: 'implicit-group',
    baseVersion: 1,
    operation: 'layout',
    payload,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const candidate = parse({
    ...snapshot,
    version: 2,
    source: outcome.candidate,
  });
  assert.equal(
    verifyLayoutCandidate(syntax, candidate, validateLayout(report, payload)),
    true,
  );
  const next = projectReport(candidate).textboxes.find(
    (t) => t.name === 'Front',
  )!;
  assert.ok(next.bounds.width?.endsWith('mm'));
  assert.equal(next.bounds.height, null);
  assert.ok(
    Math.abs(
      acceptedGeometry(projectReport(candidate), next, false).width.points! -
        acceptedGeometry(report, targets[0]!, false).width.points!,
    ) <= 0.01,
  );
});

// ---- Image items (feature 006, US2) ----

const imageFixture = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}.rdlc`, 'utf8');
function loadImages(name: string) {
  const source = imageFixture(name);
  const snapshot = {
    uri: `test:images-${name}`,
    version: 1,
    source,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const report = projectReport(syntax);
  return { source, snapshot, syntax, report, projection: report };
}
const embeddedImagesOf = (source: string) =>
  /<EmbeddedImages>[\s\S]*<\/EmbeddedImages>/.exec(source)![0];
/** Text of the Image element at `name`, with the four geometry elements removed. */
const withoutGeometry = (xml: string) =>
  xml.replace(/\s*<(Top|Left|Height|Width)>[^<]*<\/\1>/g, '');
const imageXml = (current: ReturnType<typeof loadImages>, name: string) => {
  const node = current.report.images.find((i) => i.name === name)!.node;
  return current.source.slice(node.range.start, node.range.end);
};

function layoutImages(
  current: ReturnType<typeof loadImages>,
  payload: LayoutIntent['payload'],
) {
  const outcome = planTextboxIntent(
    current.snapshot,
    current.syntax,
    current.report,
    { requestId: 'image', baseVersion: 1, operation: 'layout', payload },
  );
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const nextSyntax = parse({
    ...current.snapshot,
    version: 2,
    source: outcome.candidate,
  });
  assert.equal(
    verifyLayoutCandidate(
      current.syntax,
      nextSyntax,
      validateLayout(current.report, payload),
    ),
    true,
    'independent layout verification accepts the candidate',
  );
  // One plan; every patch is inside an Image element and only writes geometry.
  for (const patch of outcome.plan.patches) {
    assert.ok(
      current.report.images.some(
        (i) =>
          i.node.range.start <= patch.start && patch.end <= i.node.range.end,
      ),
      'patch stays inside an Image element',
    );
    assert.match(
      patch.replacement,
      /^[-0-9.a-z]+$|^(<(Top|Left|Height|Width)>[-0-9.a-z]+<\/\2>)+$/,
    );
  }
  assert.equal(
    embeddedImagesOf(outcome.candidate),
    embeddedImagesOf(current.source),
    'EmbeddedImages stays byte-identical',
  );
  return { outcome, next: projectReport(nextSyntax) };
}

test('an editable image moves by changing only Top and Left', () => {
  const current = loadImages('authored');
  const image = current.report.images.find((i) => i.name === 'LogoFit')!;
  const { outcome, next } = layoutImages(current, {
    action: 'move',
    targetIds: [image.node.id],
    dxPt: 9,
    dyPt: 7,
    unit: 'pt',
  });
  assert.equal(outcome.changed, true);
  const moved = next.images.find((i) => i.name === 'LogoFit')!;
  const before = acceptedGeometry(current.report, image, false);
  const after = acceptedGeometry(next, moved, false);
  assert.ok(Math.abs(after.left.points! - before.left.points! - 9) < 0.01);
  assert.ok(Math.abs(after.top.points! - before.top.points! - 7) < 0.01);
  assert.equal(after.width.points, before.width.points);
  assert.equal(after.height.points, before.height.points);
  assert.equal(
    withoutGeometry(
      outcome.candidate.slice(moved.node.range.start, moved.node.range.end),
    ),
    withoutGeometry(imageXml(current, 'LogoFit')),
    'Source, Value, Sizing and every other child are untouched',
  );
  assert.equal(
    next.images.filter((i) => i.name !== 'LogoFit').length,
    current.report.images.length - 1,
  );
});

test('an editable image resizes by changing only Width and Height', () => {
  const current = loadImages('authored');
  const image = current.report.images.find((i) => i.name === 'PhotoClip')!;
  const geometry = acceptedGeometry(current.report, image, false);
  const { next } = layoutImages(current, {
    action: 'resize',
    targetIds: [image.node.id],
    handle: 'se',
    xPt: geometry.left.points! + geometry.width.points! + 20,
    yPt: geometry.top.points! + geometry.height.points! + 10,
    unit: 'pt',
  });
  const resized = next.images.find((i) => i.name === 'PhotoClip')!;
  const after = acceptedGeometry(next, resized, false);
  assert.ok(
    Math.abs(after.width.points! - geometry.width.points! - 20) < 0.01 &&
      Math.abs(after.height.points! - geometry.height.points! - 10) < 0.01,
  );
  assert.equal(after.left.points, geometry.left.points);
  assert.equal(after.top.points, geometry.top.points);
  assert.equal(resized.bounds.left, image.bounds.left);
  assert.equal(resized.bounds.top, image.bounds.top);
});

test('images take part in mixed selections, alignment and distribution', () => {
  const current = loadImages('authored');
  const names = ['LogoAutoSize', 'LogoFit', 'PhotoClip'];
  const ids = names.map(
    (name) => current.report.images.find((i) => i.name === name)!.node.id,
  );
  layoutImages(current, {
    action: 'align',
    mode: 'right',
    primaryId: ids[0]!,
    targetIds: ids,
    unit: 'pt',
  });
  layoutImages(current, {
    action: 'distribute',
    axis: 'vertical',
    targetIds: ids,
    unit: 'pt',
  });
});

test('geometry-only images move and resize, and every other edit stays blocked', () => {
  const current = loadImages('preserved');
  for (const name of ['GhostPicture', 'GifPicture', 'BrokenPicture']) {
    const image = current.report.images.find((i) => i.name === name)!;
    assert.deepEqual(image.capabilities, [
      'name',
      'left',
      'top',
      'width',
      'height',
    ]);
    const { next } = layoutImages(current, {
      action: 'move',
      targetIds: [image.node.id],
      dxPt: 5,
      dyPt: 0,
      unit: 'pt',
    });
    const moved = next.images.find((i) => i.name === name)!;
    assert.ok(
      Math.abs(
        acceptedGeometry(next, moved, false).left.points! -
          acceptedGeometry(current.report, image, false).left.points! -
          5,
      ) < 0.01,
      name,
    );
    assert.equal(moved.reason, image.reason, 'the placeholder reason is kept');
    layoutImages(current, {
      action: 'resize',
      targetIds: [image.node.id],
      handle: 's',
      yPt:
        acceptedGeometry(current.report, image, false).top.points! +
        acceptedGeometry(current.report, image, false).height.points! +
        4,
      unit: 'pt',
    });
    for (const property of ['image', 'value', 'sizing'] as const)
      assert.equal(
        validateImageCapability(image, property)[0]?.code,
        'CAPABILITY_BLOCKED',
        `${name}: ${property}`,
      );
    assert.deepEqual(validateImageCapability(image, 'top'), []);
  }
});

test('preservation-only images are refused with the existing layout diagnostic', () => {
  const current = loadImages('preserved');
  for (const name of [
    'ExternalPicture',
    'DatabasePicture',
    'ExpressionPicture',
    'CellPicture',
  ]) {
    const image = current.report.images.find((i) => i.name === name)!;
    assert.deepEqual(image.capabilities, []);
    const outcome = planTextboxIntent(
      current.snapshot,
      current.syntax,
      current.report,
      {
        requestId: 'locked',
        baseVersion: 1,
        operation: 'layout',
        payload: {
          action: 'move',
          targetIds: [image.node.id],
          dxPt: 5,
          dyPt: 5,
          unit: 'pt',
        },
      },
    );
    assert.equal(outcome.ok, false, name);
    assert.equal(!outcome.ok && outcome.diagnostics[0]!.code, 'LAYOUT_REFUSED');
  }
});

test('deleting an image removes only the Image element and keeps every definition', () => {
  const current = loadImages('authored');
  const image = current.report.images.find((i) => i.name === 'LogoFit')!;
  const built = buildCapture(current, [image.node.id]);
  assert.ok(built.ok, JSON.stringify(!built.ok && built.diagnostics));
  const cut = planCut(current, built.capture, built.nodes);
  assert.ok(cut.ok, JSON.stringify(!cut.ok && cut.diagnostics));
  assert.equal(cut.plan.patches.length, 1, 'one patch for one undo step');
  assert.equal(
    cut.candidate,
    current.source.slice(0, image.node.range.start) +
      current.source.slice(image.node.range.end),
    'only the Image element is removed',
  );
  assert.equal(
    embeddedImagesOf(cut.candidate),
    embeddedImagesOf(current.source),
    'EmbeddedImages stays byte-identical',
  );
  const next = projectReport(
    parse({ ...current.snapshot, version: 2, source: cut.candidate }),
  );
  assert.equal(next.images.length, current.report.images.length - 1);
  assert.ok(next.embeddedImages.some((d) => d.name === 'logo'));
  // Removing the last reference keeps the definition too.
  const only = loadImages('collision');
  const existing = only.report.images[0]!;
  const lone = buildCapture(only, [existing.node.id]);
  assert.ok(lone.ok);
  const loneCut = planCut(only, lone.capture, lone.nodes);
  assert.ok(loneCut.ok);
  assert.equal(
    embeddedImagesOf(loneCut.candidate),
    embeddedImagesOf(only.source),
  );
  assert.deepEqual(
    projectReport(
      parse({ ...only.snapshot, version: 2, source: loneCut.candidate }),
    ).embeddedImages.map((d) => [d.name, d.references]),
    [['logo', []]],
  );
});

test('geometry-only images can be deleted, preservation-only images are refused', () => {
  const current = loadImages('preserved');
  const ghost = current.report.images.find((i) => i.name === 'GhostPicture')!;
  const built = buildCapture(current, [ghost.node.id]);
  assert.ok(built.ok, JSON.stringify(!built.ok && built.diagnostics));
  assert.deepEqual(built.capture.images, [], 'no definition is invented');
  const cut = planCut(current, built.capture, built.nodes);
  assert.ok(cut.ok, JSON.stringify(!cut.ok && cut.diagnostics));
  assert.equal(
    cut.candidate,
    current.source.slice(0, ghost.node.range.start) +
      current.source.slice(ghost.node.range.end),
  );
  for (const name of ['ExternalPicture', 'CellPicture']) {
    const locked = current.report.images.find((i) => i.name === name)!;
    const refused = buildCapture(current, [locked.node.id]);
    assert.equal(refused.ok, false, name);
    assert.equal(
      !refused.ok && refused.diagnostics[0]!.code,
      'SELECTION_UNSUPPORTED',
    );
  }
});

function deleteImage(
  current: ReturnType<typeof loadImages>,
  name: string,
  confirm = 'delete-contained-content',
) {
  const image = current.report.images.find((i) => i.name === name)!;
  return {
    image,
    outcome: planTextboxIntent(
      current.snapshot,
      current.syntax,
      current.report,
      {
        requestId: 'delete-image',
        baseVersion: 1,
        operation: 'author',
        targetId: image.node.id,
        payload: { action: 'deleteImage', confirm },
      },
    ),
  };
}

test('deleteImage removes only the Image element in one plan, keeping every definition', () => {
  const current = loadImages('authored');
  const { image, outcome } = deleteImage(current, 'LogoFit');
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(outcome.plan.patches.length, 1, 'one plan, one undo step');
  assert.equal(
    outcome.candidate,
    current.source.slice(0, image.node.range.start) +
      current.source.slice(image.node.range.end),
  );
  assert.equal(
    embeddedImagesOf(outcome.candidate),
    embeddedImagesOf(current.source),
  );
  // Even the last reference leaves the definition in place.
  const only = loadImages('collision');
  const last = deleteImage(only, 'Existing');
  assert.ok(last.outcome.ok);
  assert.equal(
    embeddedImagesOf(last.outcome.candidate),
    embeddedImagesOf(only.source),
  );
  assert.deepEqual(
    projectReport(
      parse({ ...only.snapshot, version: 2, source: last.outcome.candidate }),
    ).embeddedImages.map((d) => [d.name, d.references]),
    [['logo', []]],
  );
});

test('deleteImage needs the confirmation and is refused for preservation-only images', () => {
  const authoredImages = loadImages('authored');
  assert.equal(deleteImage(authoredImages, 'LogoFit', '').outcome.ok, false);
  const preserved = loadImages('preserved');
  for (const name of ['GhostPicture', 'GifPicture']) {
    const { image, outcome } = deleteImage(preserved, name);
    assert.ok(outcome.ok, `${name} (geometry-only) can be deleted`);
    assert.equal(
      outcome.candidate,
      preserved.source.slice(0, image.node.range.start) +
        preserved.source.slice(image.node.range.end),
    );
  }
  for (const name of [
    'ExternalPicture',
    'DatabasePicture',
    'ExpressionPicture',
    'CellPicture',
  ]) {
    const { outcome } = deleteImage(preserved, name);
    assert.equal(outcome.ok, false, name);
    assert.equal(
      !outcome.ok && outcome.diagnostics[0]!.code,
      'AUTHORING_BLOCKED',
    );
  }
});

test('an image with absent Height and Width materializes them on move, as xsd:choice allows', () => {
  // MS-RDL 2.12: Image content is an unbounded xsd:choice, so child order is free and
  // appending the missing geometry after the existing children is schema-valid.
  const stripped = imageFixture('authored').replace(
    /(<Image Name="LogoFit">[\s\S]*?)\s*<Height>0\.5in<\/Height>\s*<Width>1\.5in<\/Width>/,
    '$1',
  );
  const snapshot = {
    uri: 'test:images-implicit',
    version: 1,
    source: stripped,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const report = projectReport(syntax);
  const image = report.images.find((i) => i.name === 'LogoFit')!;
  assert.equal(image.bounds.height, null);
  assert.equal(image.bounds.width, null);
  assert.ok(image.capabilities.includes('height'));
  const before = acceptedGeometry(report, image, false);
  const current = {
    source: stripped,
    snapshot,
    syntax,
    report,
    projection: report,
  };
  const { next, outcome } = layoutImages(current, {
    action: 'move',
    targetIds: [image.node.id],
    dxPt: 6,
    dyPt: 4,
    unit: 'pt',
  });
  const moved = next.images.find((i) => i.name === 'LogoFit')!;
  const after = acceptedGeometry(next, moved, false);
  assert.equal(after.width.points, before.width.points);
  assert.equal(after.height.points, before.height.points);
  assert.ok(moved.bounds.height !== null && moved.bounds.width !== null);
  const text = outcome.candidate.slice(
    moved.node.range.start,
    moved.node.range.end,
  );
  assert.ok(
    text.indexOf('<Sizing>') < text.indexOf('<Height>') &&
      text.indexOf('<Sizing>') < text.indexOf('<Width>'),
    'existing children keep their order; the new geometry follows them',
  );
});
