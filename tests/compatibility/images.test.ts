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
