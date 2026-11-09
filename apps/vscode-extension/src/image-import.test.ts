import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_READ_FAILED,
  IMAGE_REPORT_BUDGET,
  IMAGE_TARGET_STALE,
  IMAGE_TOO_LARGE,
  dimensionLimit,
  imageReasonLabel,
  pixelLimit,
  rawImageLimit,
} from '@rdlc/report-model/images';
import { parse } from '@rdlc/xml-parser/parser';
import {
  sourceByteBudget,
  sourceStringLengthBudget,
} from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  computeImageSize,
  defaultImagePosition,
  exceedsParseBudget,
  minimumImagePt,
  refusalDiagnostic,
  runImport,
  type ImageSource,
} from './image-import.js';
import {
  checkImageCreation,
  checkImageReplacement,
  imageFailureMessage,
  planImageCreation,
  planImageReplacement,
  planTextboxIntent,
} from './edit-controller.js';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const pictures = 'tests/fixtures/images/pictures';
const picture = (name: string) =>
  new Uint8Array(readFileSync(`${pictures}/${name}`));
const report = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}`, 'utf8');

/** Records the calls so the stat-before-read order and the absence of reads can be asserted. */
function fake(
  options: {
    file?: { fileName: string; bytes?: Uint8Array; size?: number };
    pick?: 'cancelled' | 'throw';
    stat?: 'throw';
    read?: 'throw';
  } = {},
) {
  const calls: string[] = [];
  const source: ImageSource = {
    async pick() {
      calls.push('pick');
      if (options.pick === 'cancelled' || !options.file) return 'cancelled';
      if (options.pick === 'throw') throw new Error('C:\\secret\\dialog.png');
      return {
        uri: { secret: 'file:///home/me/secret.png' },
        fileName: options.file.fileName,
      };
    },
    async stat() {
      calls.push('stat');
      if (options.stat === 'throw')
        throw new Error('ENOENT /home/me/secret.png');
      return options.file!.size ?? options.file!.bytes!.length;
    },
    async read() {
      calls.push('read');
      if (options.read === 'throw')
        throw new Error('EACCES /home/me/secret.png');
      return options.file!.bytes!;
    },
  };
  return { source, calls };
}

test('a cancelled chooser stops before any file access', async () => {
  const { source, calls } = fake({ pick: 'cancelled' });
  assert.deepEqual(await runImport(source, digest), { state: 'cancelled' });
  assert.deepEqual(calls, ['pick']);
});

test('a valid picture is stat-ed, read and validated in that order', async () => {
  const bytes = picture('logo.png');
  const { source, calls } = fake({ file: { fileName: 'logo.png', bytes } });
  const outcome = await runImport(source, digest);
  assert.deepEqual(calls, ['pick', 'stat', 'read']);
  assert.equal(outcome.state, 'validated');
  if (outcome.state !== 'validated') return;
  assert.equal(outcome.fileName, 'logo.png');
  assert.equal(outcome.picture.mime, 'image/png');
  assert.equal(outcome.picture.fileStem, 'logo');
  assert.equal(outcome.picture.hash, digest(bytes));
});

test('stat refuses an oversized file without calling readFile', async () => {
  const { source, calls } = fake({
    file: {
      fileName: 'over-5mib.jpg',
      bytes: picture('photo.jpg'),
      size: rawImageLimit + 1,
    },
  });
  const outcome = await runImport(source, digest);
  assert.deepEqual(calls, ['pick', 'stat']);
  assert.deepEqual(outcome, {
    state: 'refused',
    refusal: {
      code: IMAGE_TOO_LARGE,
      limit: rawImageLimit,
      actual: rawImageLimit + 1,
      fileName: 'over-5mib.jpg',
    },
  });
});

test('a file of exactly the limit is still read', async () => {
  const { source, calls } = fake({
    file: {
      fileName: 'edge.png',
      bytes: picture('logo.png'),
      size: rawImageLimit,
    },
  });
  const outcome = await runImport(source, digest);
  assert.deepEqual(calls, ['pick', 'stat', 'read']);
  assert.equal(outcome.state, 'validated');
});

test('read failures name the file only and never carry error text or paths', async () => {
  for (const failure of [{ stat: 'throw' }, { read: 'throw' }] as const) {
    const { source } = fake({
      file: { fileName: 'logo.png', bytes: picture('logo.png') },
      ...failure,
    });
    const outcome = await runImport(source, digest);
    assert.deepEqual(outcome, {
      state: 'refused',
      refusal: { code: IMAGE_READ_FAILED, fileName: 'logo.png' },
    });
    assert.ok(!JSON.stringify(outcome).includes('secret'));
  }
  const { source } = fake({
    file: { fileName: 'logo.png', bytes: picture('logo.png') },
    pick: 'throw',
  });
  const outcome = await runImport(source, digest);
  assert.equal(
    outcome.state === 'refused' && outcome.refusal.code,
    IMAGE_READ_FAILED,
  );
  assert.ok(!JSON.stringify(outcome).includes('secret'));
});

test('the refusal corpus maps to the contract codes', async () => {
  const corpus: [string, string][] = [
    ['gif.gif', IMAGE_FORMAT_UNSUPPORTED],
    ['bad-crc.png', IMAGE_DATA_INVALID],
    ['truncated.png', IMAGE_DATA_INVALID],
    ['huge-dims.png', IMAGE_PIXELS_EXCEEDED],
    ['mega-pixels.png', IMAGE_PIXELS_EXCEEDED],
  ];
  for (const [name, code] of corpus) {
    const { source, calls } = fake({
      file: { fileName: name, bytes: picture(name) },
    });
    const outcome = await runImport(source, digest);
    assert.equal(
      outcome.state === 'refused' && outcome.refusal.code,
      code,
      name,
    );
    assert.ok(outcome.state === 'refused' && outcome.refusal.fileName === name);
    assert.deepEqual(calls, ['pick', 'stat', 'read']);
  }
});

test('the content decides the format, not the extension', async () => {
  const { source } = fake({
    file: { fileName: 'spoofed.png', bytes: picture('spoofed.png') },
  });
  const outcome = await runImport(source, digest);
  assert.equal(outcome.state, 'validated');
  if (outcome.state === 'validated')
    assert.equal(outcome.picture.mime, 'image/jpeg');
});

test('refusal diagnostics state the file name and limits and never bytes', () => {
  const bytes = picture('logo.png');
  const encoded = Buffer.from(bytes).toString('base64');
  const texts: string[] = [];
  for (const refusal of [
    {
      code: IMAGE_TOO_LARGE,
      limit: rawImageLimit,
      actual: rawImageLimit + 1,
      fileName: 'big.jpg',
    },
    {
      code: IMAGE_PIXELS_EXCEEDED,
      limit: dimensionLimit,
      actual: 20000,
      fileName: 'wide.png',
    },
    {
      code: IMAGE_PIXELS_EXCEEDED,
      limit: pixelLimit,
      actual: pixelLimit + 1,
      fileName: 'mega.png',
    },
    { code: IMAGE_FORMAT_UNSUPPORTED, fileName: 'gif.gif' },
    { code: IMAGE_DATA_INVALID, fileName: 'bad.png' },
    { code: IMAGE_READ_FAILED, fileName: 'gone.png' },
  ] as const) {
    const diagnostic = refusalDiagnostic(refusal);
    assert.equal(diagnostic.code, refusal.code);
    assert.ok(diagnostic.message.includes(refusal.fileName));
    texts.push(JSON.stringify(diagnostic));
  }
  assert.match(texts[0]!, /5\.00 MiB/);
  assert.match(texts[0]!, /5\.00 MiB/);
  assert.match(texts[1]!, /16384 px/);
  for (const text of texts) {
    assert.ok(!text.includes(encoded.slice(0, 64)));
    assert.ok(!text.includes('/home'));
  }
});

test('the size is the natural pixel size at 96 DPI in inches', () => {
  assert.deepEqual(computeImageSize({ width: 96, height: 96 }, '0in', '6in'), {
    width: '1in',
    height: '1in',
  });
  assert.deepEqual(computeImageSize({ width: 192, height: 96 }, '1in', '6in'), {
    width: '2in',
    height: '1in',
  });
  assert.deepEqual(
    computeImageSize({ width: 200, height: 100 }, '0.25in', '6in'),
    {
      width: '2.0833in',
      height: '1.0417in',
    },
  );
});

test('the width scales down to bodyWidth minus left keeping the aspect ratio', () => {
  assert.deepEqual(
    computeImageSize({ width: 960, height: 480 }, '1in', '6in'),
    { width: '5in', height: '2.5in' },
  );
  // Units of the body width and of the position need not match.
  assert.deepEqual(
    computeImageSize({ width: 960, height: 480 }, '2.54cm', '432pt'),
    { width: '5in', height: '2.5in' },
  );
  // An unknown body width leaves the natural size.
  assert.deepEqual(computeImageSize({ width: 960, height: 480 }, '1in', null), {
    width: '10in',
    height: '5in',
  });
});

test('each dimension keeps a one pixel floor', () => {
  const floor = `${+(minimumImagePt / 72).toFixed(4)}in`;
  assert.deepEqual(
    computeImageSize({ width: 960, height: 480 }, '6in', '6in'),
    {
      width: floor,
      height: floor,
    },
  );
  assert.deepEqual(
    computeImageSize({ width: 960, height: 480 }, '7in', '6in'),
    {
      width: floor,
      height: floor,
    },
  );
  assert.deepEqual(computeImageSize({ width: 1, height: 1 }, '0in', '6in'), {
    width: floor,
    height: floor,
  });
});

test('the default spot steps down while an item sits on it', () => {
  assert.deepEqual(defaultImagePosition([]), { left: '0.25in', top: '0.25in' });
  assert.deepEqual(
    defaultImagePosition([
      { left: '0.25in', top: '0.25in' },
      { left: '18pt', top: '18pt' },
      { left: '0.5in', top: '0.75in' },
      { left: null, top: null },
    ]),
    { left: '0.5in', top: '0.5in' },
  );
});

test('the parse budget counts string length and UTF-8 bytes exactly', () => {
  const patch = (replacement: string) => ({
    patches: [{ version: 1, start: 1, end: 1, expected: '', replacement }],
  });
  const exact = 'x'.repeat(sourceStringLengthBudget - 1);
  assert.equal(exceedsParseBudget('a', patch(exact)), false);
  assert.equal(exceedsParseBudget('a', patch(exact + 'x')), true);
  // Few UTF-16 units but more than the byte budget.
  const wide = '\u20ac'.repeat(Math.ceil(sourceByteBudget / 3) + 1);
  assert.ok(wide.length < sourceStringLengthBudget);
  assert.equal(exceedsParseBudget('a', patch(wide)), true);
  // Replacing text frees its length.
  assert.equal(
    exceedsParseBudget('x'.repeat(100), {
      patches: [
        {
          version: 1,
          start: 0,
          end: 100,
          expected: 'x'.repeat(100),
          replacement: 'y',
        },
      ],
    }),
    false,
  );
});

// planImageCreation: the latest-snapshot half of the import.
function evaluate(source: string, version = 1) {
  const snapshot = { uri: 'test:image', version, source, eol: '\n' as const };
  const syntax = parse(snapshot);
  return { snapshot, syntax, projection: projectReport(syntax, { digest }) };
}
async function imported(name: string) {
  const { source } = fake({ file: { fileName: name, bytes: picture(name) } });
  const outcome = await runImport(source, digest);
  assert.equal(outcome.state, 'validated');
  if (outcome.state !== 'validated') throw new Error('unreachable');
  return { picture: outcome.picture, fileName: outcome.fileName };
}
const create = (payload: Record<string, string> = { placement: 'default' }) =>
  ({ action: 'createImage', placement: 'default', ...payload }) as {
    action: 'createImage';
    placement: string;
  };
function accepted(outcome: ReturnType<typeof planImageCreation>) {
  assert.equal(outcome.ok, true, JSON.stringify(!outcome.ok && outcome));
  if (!outcome.ok) throw new Error('unreachable');
  return outcome;
}

test('a new picture adds one definition and one FitProportional item', async () => {
  const state = evaluate(report('blank.rdlc'));
  const file = await imported('logo.png');
  const outcome = accepted(
    planImageCreation(
      state.snapshot,
      state.syntax,
      state.projection,
      create(),
      file,
    ),
  );
  assert.deepEqual(outcome.created, { element: 'Image', name: 'Image1' });
  assert.equal(outcome.plan.patches.length, 2);
  const next = projectReport(
    parse({ ...state.snapshot, source: outcome.candidate }),
    { digest },
  );
  assert.equal(next.embeddedImages.length, 1);
  assert.equal(next.embeddedImages[0]!.name, 'logo');
  assert.equal(next.embeddedImages[0]!.hash, file.picture.hash);
  const item = next.images[0]!;
  assert.equal(item.name, 'Image1');
  assert.equal(item.definition, 'logo');
  assert.equal(item.sizing, 'FitProportional');
  // The Title textbox already sits on the 0.25in default spot.
  assert.equal(item.bounds.left, '0.5in');
  assert.equal(item.bounds.top, '0.5in');
  const size = computeImageSize(file.picture.pixels, '0.5in', '6in');
  assert.equal(item.bounds.width, size.width);
  assert.equal(item.bounds.height, size.height);
});

test('a drop uses the given position; an invalid position is refused', async () => {
  const state = evaluate(report('blank.rdlc'));
  const file = await imported('photo.jpg');
  const outcome = accepted(
    planImageCreation(
      state.snapshot,
      state.syntax,
      state.projection,
      create({ placement: 'drop', left: '2in', top: '1.5in' }),
      file,
    ),
  );
  const next = projectReport(
    parse({ ...state.snapshot, source: outcome.candidate }),
  );
  assert.equal(next.images[0]!.bounds.left, '2in');
  assert.equal(next.images[0]!.bounds.top, '1.5in');
  assert.equal(next.embeddedImages[0]!.mime, 'image/jpeg');
  const refused = planImageCreation(
    state.snapshot,
    state.syntax,
    state.projection,
    create({ placement: 'drop', left: '-1in', top: '1in' }),
    file,
  );
  assert.equal(refused.ok, false);
});

test('inserting the same picture twice reuses the definition', async () => {
  const first = evaluate(report('blank.rdlc'));
  const file = await imported('logo.png');
  const one = accepted(
    planImageCreation(
      first.snapshot,
      first.syntax,
      first.projection,
      create(),
      file,
    ),
  );
  const second = evaluate(one.candidate, 2);
  const two = accepted(
    planImageCreation(
      second.snapshot,
      second.syntax,
      second.projection,
      create(),
      file,
    ),
  );
  assert.equal(two.plan.patches.length, 1);
  assert.deepEqual(two.created, { element: 'Image', name: 'Image2' });
  const next = projectReport(
    parse({ ...second.snapshot, source: two.candidate }),
  );
  assert.equal(next.embeddedImages.length, 1);
  assert.deepEqual(
    next.images.map((entry) => entry.definition),
    ['logo', 'logo'],
  );
  assert.equal(
    two.candidate.split(Buffer.from(file.picture.bytes).toString('base64'))
      .length - 1,
    1,
  );
});

test('a different picture with a taken stem gets the next free definition name', async () => {
  const state = evaluate(report('collision.rdlc'));
  const file = await imported('logo.png');
  const outcome = accepted(
    planImageCreation(
      state.snapshot,
      state.syntax,
      state.projection,
      create(),
      file,
    ),
  );
  const next = projectReport(
    parse({ ...state.snapshot, source: outcome.candidate }),
  );
  assert.deepEqual(
    next.embeddedImages.map((entry) => entry.name),
    ['logo', 'logo_1'],
  );
  assert.equal(
    next.images.find((entry) => entry.name !== 'Existing')!.definition,
    'logo_1',
  );
});

test('an existing displayable definition is referenced without writing it', () => {
  const state = evaluate(report('collision.rdlc'));
  const outcome = accepted(
    planImageCreation(
      state.snapshot,
      state.syntax,
      state.projection,
      create({ definition: 'logo' }),
    ),
  );
  assert.equal(outcome.plan.patches.length, 1);
  const next = projectReport(
    parse({ ...state.snapshot, source: outcome.candidate }),
  );
  assert.equal(next.embeddedImages.length, 1);
  assert.equal(next.images.length, 2);
});

test('a missing or undisplayable definition is refused', () => {
  const state = evaluate(report('collision.rdlc'));
  const missing = planImageCreation(
    state.snapshot,
    state.syntax,
    state.projection,
    create({ definition: 'nope' }),
  );
  assert.equal(!missing.ok && missing.diagnostics[0]?.code, IMAGE_TARGET_STALE);
  // A real picture in an unsupported format: its base64 must never reach a message.
  const gif = Buffer.from(picture('gif.gif')).toString('base64');
  const broken = evaluate(
    report('collision.rdlc').replace(
      /<ImageData>[^<]*<\/ImageData>/,
      `<ImageData>${gif}</ImageData>`,
    ),
  );
  const refused = planImageCreation(
    broken.snapshot,
    broken.syntax,
    broken.projection,
    create({ definition: 'logo' }),
  );
  assert.equal(!refused.ok && refused.diagnostics[0]?.code !== undefined, true);
  // The message names the reason in words, and never the payload.
  const reason = broken.projection.embeddedImages[0]!.reason!;
  assert.ok(
    !refused.ok &&
      refused.diagnostics[0]!.message.includes(imageReasonLabel(reason)),
  );
  const message = refused.ok ? '' : refused.diagnostics[0]!.message;
  for (let at = 0; at + 24 <= gif.length; at += 12)
    assert.ok(!message.includes(gif.slice(at, at + 24)), `slice ${at}`);
});

test('exactly one of a file or a definition is required', async () => {
  const state = evaluate(report('collision.rdlc'));
  const file = await imported('logo.png');
  for (const outcome of [
    planImageCreation(state.snapshot, state.syntax, state.projection, create()),
    planImageCreation(
      state.snapshot,
      state.syntax,
      state.projection,
      create({ definition: 'logo' }),
      file,
    ),
  ])
    assert.equal(outcome.ok, false);
});

test('a source-only report refuses before planning', async () => {
  const state = evaluate(report('blank.rdlc'));
  const outcome = planImageCreation(
    state.snapshot,
    state.syntax,
    { ...state.projection, status: 'source-only' },
    create(),
    await imported('logo.png'),
  );
  assert.equal(!outcome.ok && outcome.diagnostics[0]?.code, 'SOURCE_ONLY');
});

test('a candidate over the 16 MiB budget is refused before verification', async () => {
  // Pad with a comment so only the new picture can tip the report over the budget.
  const base = report('blank.rdlc');
  const room = 4096;
  const filler = 'x'.repeat(sourceStringLengthBudget - base.length - room - 7);
  const source = base.replace('</Report>', `<!--${filler}--></Report>`);
  assert.ok(source.length < sourceStringLengthBudget);
  const state = evaluate(source);
  assert.equal(state.projection.status, 'editable');
  const file = await imported('logo.png');
  const outcome = planImageCreation(
    state.snapshot,
    state.syntax,
    state.projection,
    create(),
    file,
  );
  assert.equal(
    !outcome.ok && outcome.diagnostics[0]?.code,
    IMAGE_REPORT_BUDGET,
  );
  const text = JSON.stringify(outcome);
  assert.ok(
    !text.includes(
      Buffer.from(file.picture.bytes).toString('base64').slice(0, 64),
    ),
  );
  assert.match(text, /logo\.png/);
});

test('createImage through the shared planner needs a definition and the current version', () => {
  const state = evaluate(report('collision.rdlc'));
  const intent = (baseVersion: number, definition?: string) => ({
    requestId: 'r',
    baseVersion,
    targetId: state.syntax.root!.id,
    operation: 'author' as const,
    payload: {
      action: 'createImage' as const,
      placement: 'default',
      ...(definition ? { definition } : {}),
    },
  });
  const stale = planTextboxIntent(
    state.snapshot,
    state.syntax,
    state.projection,
    intent(0, 'logo'),
  );
  assert.equal(!stale.ok && stale.diagnostics[0]?.code, 'STALE_EDIT');
  const noFile = planTextboxIntent(
    state.snapshot,
    state.syntax,
    state.projection,
    intent(1),
  );
  assert.equal(noFile.ok, false);
  const ok = planTextboxIntent(
    state.snapshot,
    state.syntax,
    state.projection,
    intent(1, 'logo'),
  );
  assert.equal(ok.ok && ok.created?.element, 'Image');
});

test('the pre-chooser check refuses a stale, source-only or misdirected request', () => {
  const state = evaluate(report('blank.rdlc'));
  const intent = (
    overrides: Record<string, unknown> = {},
    payload: Record<string, string> = {},
  ) =>
    ({
      requestId: 'r',
      baseVersion: 1,
      targetId: state.syntax.root!.id,
      operation: 'author',
      payload: { action: 'createImage', placement: 'default', ...payload },
      ...overrides,
    }) as Parameters<typeof checkImageCreation>[3];
  const check = (
    request: Parameters<typeof checkImageCreation>[3],
    projection = state.projection,
  ) =>
    checkImageCreation(state.snapshot, state.syntax, projection, request).map(
      (entry) => entry.code,
    );
  assert.deepEqual(check(intent()), []);
  assert.deepEqual(check(intent({ baseVersion: 0 })), ['STALE_EDIT']);
  assert.deepEqual(
    check(intent(), { ...state.projection, status: 'source-only' }),
    ['SOURCE_ONLY'],
  );
  assert.equal(check(intent({ targetId: '9:9' })).length, 1);
  assert.equal(
    check(intent({}, { placement: 'drop', left: '-1in', top: '1in' })).length,
    1,
  );
});

test('a planning failure surfaces a fixed message and never underlying error text', async () => {
  // Duplicate EmbeddedImages makes the serializer throw; its text must not be surfaced.
  const state = evaluate(
    report('collision.rdlc').replace(
      '</Report>',
      '<EmbeddedImages></EmbeddedImages></Report>',
    ),
  );
  const file = await imported('photo.jpg');
  const outcome = planImageCreation(
    state.snapshot,
    state.syntax,
    state.projection,
    create(),
    file,
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.diagnostics[0]?.message, imageFailureMessage);
  const text = JSON.stringify(outcome);
  assert.ok(!text.includes('Duplicate'));
  assert.ok(
    !text.includes(
      Buffer.from(file.picture.bytes).toString('base64').slice(0, 32),
    ),
  );
});

// --- US3: property intents and picture replacement -------------------------

const authored = () => evaluate(report('authored.rdlc'));
const imageIn = (state: ReturnType<typeof evaluate>, name: string) =>
  state.projection.images.find((entry) => entry.name === name)!;
function property(
  state: ReturnType<typeof evaluate>,
  name: string,
  key: string,
  value: string,
  overrides: Record<string, unknown> = {},
) {
  return planTextboxIntent(state.snapshot, state.syntax, state.projection, {
    requestId: 'r',
    baseVersion: state.snapshot.version,
    targetId: imageIn(state, name).node.id,
    operation: 'author',
    payload: { action: 'setImageProperty', property: key, value },
    ...overrides,
  } as never);
}
const codes = (outcome: ReturnType<typeof property>) =>
  outcome.ok ? [] : outcome.diagnostics.map((entry) => entry.code);

test('setImageProperty plans one scalar patch per property and verifies the result', () => {
  const state = authored();
  for (const [key, value] of [
    ['sizing', 'Clip'],
    ['value', 'photo'],
    ['toolTip', 'Hello'],
    ['name', 'Brand'],
  ] as const) {
    const outcome = property(state, 'LogoFit', key, value);
    assert.equal(outcome.ok && outcome.changed, true, key);
    assert.equal(outcome.ok && outcome.plan.patches.length, 1, key);
  }
  // Same value: accepted, nothing to write.
  const same = property(state, 'LogoFit', 'sizing', 'Fit');
  assert.equal(same.ok && same.changed, false);
  assert.equal(same.ok && same.plan.patches.length, 0);
});

test('setImageProperty refuses invalid values with IMAGE_PROPERTY_INVALID', () => {
  const state = authored();
  for (const [key, value] of [
    ['sizing', 'Stretch'],
    ['value', 'nowhere'],
    ['name', 'LogoAutoSize'],
    ['name', 'not valid'],
  ] as const)
    assert.deepEqual(
      codes(property(state, 'LogoFit', key, value)),
      ['IMAGE_PROPERTY_INVALID'],
      `${key}=${value}`,
    );
  assert.deepEqual(
    codes(property(state, 'LogoFit', 'left', '1in')),
    ['IMAGE_PROPERTY_INVALID'],
    'geometry is not an image property',
  );
});

test('setImageProperty refuses a removed target, a stale version and blocked capabilities', () => {
  const state = authored();
  assert.deepEqual(
    codes(property(state, 'LogoFit', 'sizing', 'Fit', { targetId: '1:99999' })),
    ['IMAGE_TARGET_STALE'],
  );
  assert.deepEqual(
    codes(property(state, 'LogoFit', 'sizing', 'Fit', { baseVersion: 0 })),
    ['STALE_EDIT'],
  );
  const preserved = evaluate(report('preserved.rdlc'));
  assert.deepEqual(
    codes(property(preserved, 'GhostPicture', 'sizing', 'Fit')),
    ['CAPABILITY_BLOCKED'],
  );
  assert.deepEqual(
    codes(property(preserved, 'ExternalPicture', 'name', 'Other')),
    ['CAPABILITY_BLOCKED'],
  );
  // Geometry-only items keep `name`: the capability guard lets it through (the existing
  // reference analysis may still refuse a rename in a report with opaque expressions).
  assert.ok(
    !codes(property(preserved, 'GhostPicture', 'name', 'Ghost2')).includes(
      'CAPABILITY_BLOCKED',
    ),
  );
});

test('renaming an image used by an expression is refused', () => {
  const source = report('authored.rdlc').replace(
    '<Height>3.5in</Height>',
    '<Height>3.5in</Height><Visibility><Hidden>=ReportItems!LogoFit.Value = 1</Hidden></Visibility>',
  );
  const state = evaluate(source);
  const outcome = property(state, 'LogoFit', 'name', 'Other');
  assert.equal(outcome.ok, false);
});

const replacement = (
  state: ReturnType<typeof evaluate>,
  name: string,
  scope: string,
  overrides: Record<string, unknown> = {},
) =>
  ({
    requestId: 'r',
    baseVersion: state.snapshot.version,
    targetId: imageIn(state, name).node.id,
    operation: 'author',
    payload: { action: 'replaceImagePicture', scope },
    ...overrides,
  }) as Parameters<typeof checkImageReplacement>[3];

test('the replace gate runs before the chooser and names every refusal', () => {
  const state = authored();
  const check = (request: Parameters<typeof checkImageReplacement>[3]) =>
    checkImageReplacement(
      state.snapshot,
      state.syntax,
      state.projection,
      request,
    ).map((entry) => entry.code);
  assert.deepEqual(check(replacement(state, 'LogoFit', 'item')), []);
  assert.deepEqual(
    check(replacement(state, 'LogoFit', 'all', { baseVersion: 0 })),
    ['STALE_EDIT'],
  );
  assert.deepEqual(
    check(replacement(state, 'LogoFit', 'all', { targetId: '1:99999' })),
    [IMAGE_TARGET_STALE],
  );
  const preserved = evaluate(report('preserved.rdlc'));
  for (const name of ['GhostPicture', 'ExternalPicture', 'ExpressionPicture'])
    assert.deepEqual(
      checkImageReplacement(
        preserved.snapshot,
        preserved.syntax,
        preserved.projection,
        replacement(preserved, name, 'item'),
      ).map((entry) => entry.code),
      ['CAPABILITY_BLOCKED'],
      name,
    );
});

test('item scope adds a definition, repoints one item and reuses identical pictures', async () => {
  const state = authored();
  const file = await imported('progressive.jpg');
  const outcome = planImageReplacement(
    state.snapshot,
    state.syntax,
    state.projection,
    replacement(state, 'LogoFit', 'item'),
    file,
  );
  assert.ok(outcome.ok && outcome.changed);
  if (!outcome.ok) return;
  assert.equal(outcome.plan.patches.length, 2);
  const next = projectReport(
    parse({ ...state.snapshot, source: outcome.candidate }),
    { digest },
  );
  assert.deepEqual(
    next.images.map((entry) => [entry.name, entry.definition]),
    [
      ['LogoAutoSize', 'logo'],
      ['LogoFit', 'progressive'],
      ['PhotoFitProportional', 'photo'],
      ['PhotoClip', 'photo'],
      ['Tagged', 'logo'],
    ],
  );
  // An identical picture reuses the existing definition, writing only Value.
  const logo = await imported('logo.png');
  const reuse = planImageReplacement(
    state.snapshot,
    state.syntax,
    state.projection,
    replacement(state, 'PhotoClip', 'item'),
    logo,
  );
  assert.ok(reuse.ok && reuse.changed);
  assert.equal(reuse.ok && reuse.plan.patches.length, 1);
  // The picture it already shows is a no-op.
  const same = planImageReplacement(
    state.snapshot,
    state.syntax,
    state.projection,
    replacement(state, 'LogoFit', 'item'),
    logo,
  );
  assert.ok(same.ok && !same.changed);
});

test('all scope rewrites the definition in place and an identical picture is a no-op', async () => {
  const state = authored();
  const file = await imported('progressive.jpg');
  const outcome = planImageReplacement(
    state.snapshot,
    state.syntax,
    state.projection,
    replacement(state, 'LogoFit', 'all'),
    file,
  );
  assert.ok(outcome.ok && outcome.changed);
  if (!outcome.ok) return;
  assert.equal(outcome.plan.patches.length, 2);
  const next = projectReport(
    parse({ ...state.snapshot, source: outcome.candidate }),
    { digest },
  );
  const definition = next.embeddedImages.find(
    (entry) => entry.name === 'logo',
  )!;
  assert.equal(definition.hash, file.picture.hash);
  assert.equal(definition.mime, 'image/jpeg');
  assert.equal(next.embeddedImages.length, 3);
  const logo = await imported('logo.png');
  const same = planImageReplacement(
    state.snapshot,
    state.syntax,
    state.projection,
    replacement(state, 'LogoFit', 'all'),
    logo,
  );
  assert.ok(same.ok && !same.changed);
});

test('a replacement locates its target by name in a later version, or reports it stale', async () => {
  const state = authored();
  const file = await imported('progressive.jpg');
  const original = replacement(state, 'LogoFit', 'item');
  const later = evaluate(
    report('authored.rdlc').replace(
      '<Height>3.5in</Height>',
      '<Height>4in</Height>',
    ),
    5,
  );
  const found = planImageReplacement(
    later.snapshot,
    later.syntax,
    later.projection,
    original,
    file,
    { name: 'LogoFit', definition: 'logo' },
  );
  assert.ok(found.ok && found.changed);
  const removed = evaluate(
    report('authored.rdlc').replace(
      /<Image Name="LogoFit">[\s\S]*?<\/Image>/,
      '',
    ),
    5,
  );
  const stale = planImageReplacement(
    removed.snapshot,
    removed.syntax,
    removed.projection,
    original,
    file,
    { name: 'LogoFit', definition: 'logo' },
  );
  assert.equal(!stale.ok && stale.diagnostics[0]?.code, IMAGE_TARGET_STALE);
  const unnamed = planImageReplacement(
    later.snapshot,
    later.syntax,
    later.projection,
    original,
    file,
  );
  assert.equal(!unnamed.ok && unnamed.diagnostics[0]?.code, IMAGE_TARGET_STALE);
});

test('a stale target is never relocated by name alone when the definition differs', async () => {
  const state = authored();
  const file = await imported('progressive.jpg');
  // Same name, now pointing at another definition: an unrelated item reused the name.
  const reused = evaluate(
    report('authored.rdlc').replace(
      /(<Image Name="LogoFit">[\s\S]*?<Value>)logo(<\/Value>)/,
      '$1photo$2',
    ),
    5,
  );
  assert.equal(
    reused.projection.images.find((entry) => entry.name === 'LogoFit')
      ?.definition,
    'photo',
  );
  for (const scope of ['item', 'all'] as const) {
    const outcome = planImageReplacement(
      reused.snapshot,
      reused.syntax,
      reused.projection,
      replacement(state, 'LogoFit', scope),
      file,
      { name: 'LogoFit', definition: 'logo' },
    );
    assert.equal(
      !outcome.ok && outcome.diagnostics[0]?.code,
      IMAGE_TARGET_STALE,
      scope,
    );
  }
  // Same name and same definition still relocates, for both scopes.
  const unchanged = evaluate(report('authored.rdlc'), 5);
  for (const scope of ['item', 'all'] as const) {
    const outcome = planImageReplacement(
      unchanged.snapshot,
      unchanged.syntax,
      unchanged.projection,
      replacement(state, 'LogoFit', scope),
      file,
      { name: 'LogoFit', definition: 'logo' },
    );
    assert.ok(outcome.ok && outcome.changed, scope);
  }
});

test('a replacement over the 16 MiB budget is refused and never echoes the payload', async () => {
  // Pad with a comment so only the new picture can tip the report over the budget.
  const base = report('authored.rdlc');
  const room = 64;
  const filler = 'x'.repeat(sourceStringLengthBudget - base.length - room - 7);
  const fat = evaluate(base.replace('</Report>', `<!--${filler}--></Report>`));
  assert.equal(fat.projection.status, 'editable');
  const file = await imported('progressive.jpg');
  const outcome = planImageReplacement(
    fat.snapshot,
    fat.syntax,
    fat.projection,
    replacement(fat, 'LogoFit', 'item'),
    file,
  );
  assert.equal(
    !outcome.ok && outcome.diagnostics[0]?.code,
    IMAGE_REPORT_BUDGET,
  );
  assert.ok(
    !JSON.stringify(outcome).includes(
      Buffer.from(file.picture.bytes).toString('base64').slice(0, 32),
    ),
  );
});
