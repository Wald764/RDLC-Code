import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ImageItem } from '@rdlc/report-model/report';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';

interface ManifestFixture {
  readonly id: string;
  readonly path: string;
  readonly status: 'supported' | 'unsupported';
  readonly capabilities: readonly string[];
  readonly expectedDiagnostics: readonly string[];
}

const manifest = JSON.parse(
  readFileSync('tests/fixtures/manifest.json', 'utf8'),
) as { fixtures: ManifestFixture[] };
const imageFixtures = manifest.fixtures.filter((fixture) =>
  fixture.path.startsWith('images/'),
);

type State = 'editable' | 'geometry-only' | 'preservation-only';
const stateOf = (item: ImageItem): State =>
  item.capabilities.includes('image')
    ? 'editable'
    : item.capabilities.length > 0
      ? 'geometry-only'
      : 'preservation-only';

/** Expected per-item state, by fixture path; unlisted fixtures are all editable. */
const states: Record<string, Record<string, State>> = {
  'images/preserved.rdlc': {
    ExternalPicture: 'preservation-only',
    DatabasePicture: 'preservation-only',
    ExpressionPicture: 'preservation-only',
    GifPicture: 'geometry-only',
    BmpPicture: 'geometry-only',
    LegacyPngPicture: 'geometry-only',
    BrokenPicture: 'geometry-only',
    GhostPicture: 'geometry-only',
    CellPicture: 'preservation-only',
  },
};

test('the manifest registers every image fixture', () => {
  assert.deepEqual(imageFixtures.map((fixture) => fixture.path).sort(), [
    'images/authored.rdlc',
    'images/blank.rdlc',
    'images/collision.rdlc',
    'images/many.rdlc',
    'images/preserved.rdlc',
  ]);
});

for (const fixture of imageFixtures) {
  test(`${fixture.id}: projection status and capabilities match the manifest`, () => {
    const projection = projectReport(
      parse({
        uri: `fixture:${fixture.path}`,
        version: 1,
        source: readFileSync(`tests/fixtures/${fixture.path}`, 'utf8'),
        eol: '\n',
      }),
    );
    assert.equal(fixture.status, 'supported');
    assert.equal(projection.status, 'editable');
    assert.deepEqual(projection.capabilities, fixture.capabilities);
    assert.deepEqual(
      projection.diagnostics.map((diagnostic) => diagnostic.code),
      fixture.expectedDiagnostics,
    );
    const expected = states[fixture.path];
    for (const item of projection.images) {
      const state = expected ? expected[item.name ?? ''] : 'editable';
      assert.ok(state, `${fixture.id}: unexpected item ${item.name}`);
      assert.equal(stateOf(item), state, `${fixture.id}: ${item.name}`);
    }
    if (expected)
      assert.deepEqual(
        projection.images.map((item) => item.name),
        Object.keys(expected),
      );
  });
}

test('every image fixture projects the definitions its items reference', () => {
  for (const fixture of imageFixtures) {
    const projection = projectReport(
      parse({
        uri: `fixture:${fixture.path}`,
        version: 1,
        source: readFileSync(`tests/fixtures/${fixture.path}`, 'utf8'),
        eol: '\n',
      }),
    );
    const names = new Set(projection.embeddedImages.map((entry) => entry.name));
    for (const item of projection.images)
      if (fixture.path !== 'images/preserved.rdlc')
        assert.ok(
          item.definition && names.has(item.definition),
          item.name ?? '',
        );
  }
});

const fixtureSource = (path: string) =>
  readFileSync(`tests/fixtures/${path}`, 'utf8');
const projectText = (source: string) =>
  projectReport(
    parse({ uri: 'fixture:inline', version: 1, source, eol: '\n' }),
  );
const geometryKeys = ['name', 'left', 'top', 'width', 'height'];

test('every preserved item shows the placeholder reason of its source, value and definition', () => {
  const projection = projectText(fixtureSource('images/preserved.rdlc'));
  const expected: Record<string, [ImageItem['reason'], State]> = {
    ExternalPicture: ['source-preserved', 'preservation-only'],
    DatabasePicture: ['source-preserved', 'preservation-only'],
    ExpressionPicture: ['value-expression', 'preservation-only'],
    GifPicture: ['format-unsupported', 'geometry-only'],
    BmpPicture: ['format-unsupported', 'geometry-only'],
    LegacyPngPicture: ['mime-mismatch', 'geometry-only'],
    BrokenPicture: ['data-invalid', 'geometry-only'],
    GhostPicture: ['reference-missing', 'geometry-only'],
    CellPicture: ['source-preserved', 'preservation-only'],
  };
  assert.deepEqual(
    Object.fromEntries(
      projection.images.map((item) => [
        item.name,
        [item.reason, stateOf(item)],
      ]),
    ),
    expected,
  );
  // Every reason the task names is reached by at least one preserved item.
  const reasons = new Set(projection.images.map((item) => item.reason));
  for (const reason of [
    'source-preserved',
    'value-expression',
    'format-unsupported',
    'mime-mismatch',
    'data-invalid',
    'reference-missing',
  ] as const)
    assert.ok(reasons.has(reason), reason);
  // A geometry-only item keeps exactly the name and geometry keys.
  for (const item of projection.images)
    if (stateOf(item) === 'geometry-only')
      assert.deepEqual(item.capabilities, geometryKeys, String(item.name));
});

/** `authored.rdlc` with the `logo` definition's MIMEType replaced (or removed). */
function withLogoMime(mime: string | null): string {
  const source = fixtureSource('images/authored.rdlc');
  const logo = /(<EmbeddedImage Name="logo">\s*)<MIMEType>[^<]*<\/MIMEType>/;
  assert.match(source, logo);
  return source.replace(
    logo,
    mime === null ? '$1' : `$1<MIMEType>${mime}</MIMEType>`,
  );
}

const logoItems = ['LogoAutoSize', 'LogoFit', 'Tagged'];

// MS-RDL 2.2.10 also lists image/x-png among the ReportMIMEType values. This feature only writes and displays image/png and image/jpeg (FR-004), so
// a definition that declares anything else is preserved as written and shown as a
// placeholder with the `mime-mismatch` reason; the picture is never rewritten.
for (const [label, mime, reason] of [
  ['image/x-png on valid PNG data', 'image/x-png', 'mime-mismatch'],
  ['image/jpeg on PNG data', 'image/jpeg', 'mime-mismatch'],
  ['a missing MIMEType', null, 'mime-mismatch'],
  ['an expression MIMEType', '=Parameters!Mime.Value', 'value-expression'],
] as const)
  test(`${label} makes every referencing item geometry-only with reason ${reason}`, () => {
    const projection = projectText(withLogoMime(mime));
    const logo = projection.embeddedImages.find((d) => d.name === 'logo')!;
    assert.equal(logo.displayable, false);
    assert.equal(logo.reason, reason);
    assert.equal(logo.format, 'png', 'the format comes from the content');
    for (const item of projection.images) {
      if (!logoItems.includes(item.name ?? '')) {
        assert.equal(stateOf(item), 'editable', String(item.name));
        continue;
      }
      assert.equal(item.reason, reason, String(item.name));
      assert.equal(stateOf(item), 'geometry-only', String(item.name));
      assert.deepEqual(item.capabilities, geometryKeys);
    }
  });

test('an Image-level MIMEType is inert and never changes the state', () => {
  // MS-RDL 2.12.17: Image.MIMEType is ignored unless Source is Database.
  const source = fixtureSource('images/authored.rdlc').replace(
    /(<Image Name="LogoFit">[\s\S]*?)<MIMEType>image\/png<\/MIMEType>/,
    '$1<MIMEType>=Parameters!Mime.Value</MIMEType>',
  );
  const item = projectText(source).images.find((i) => i.name === 'LogoFit')!;
  assert.equal(stateOf(item), 'editable');
  assert.equal(item.reason, null);
});
