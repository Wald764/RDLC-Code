import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type {
  Capture,
  CaptureRoot,
  EmbeddedImageRequirement,
} from '@rdlc/report-model/clipboard';
import { RDL_2016 } from '@rdlc/report-model/report';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  allocateNames,
  inertAnnotation,
  nameIndex,
  reconcileImages,
  validateDestination,
} from './clipboard.js';

const fixture = readFileSync(
  'tests/fixtures/interactive/clipboard-dependencies.rdlc',
  'utf8',
);
const load = (source: string) => {
  const syntax = parse({ uri: 'test:', version: 1, source, eol: '\n' });
  return { syntax, report: projectReport(syntax) };
};
function capture(
  identities: CaptureRoot['identities'],
  references: CaptureRoot['references'] = [],
  datasets: Capture['datasets'] = [],
): Capture {
  const root = { identities, references } as Partial<CaptureRoot>;
  return {
    id: 'c',
    schema: RDL_2016,
    profile: 'rdlc-code/interactive',
    formatVersion: 1,
    roots: [root as CaptureRoot],
    datasets,
    images: [],
    size: 0,
  };
}
const id = (
  name: string,
  element = 'Textbox',
  kind: 'report-item' | 'group' = 'report-item',
) => ({ kind, element, name, range: { start: 0, end: 0 } });

test('classifies only the documented inert annotation shape', () => {
  const decide = (xml: string) => {
    const source = `<r xmlns:x="urn:rdlc-code:extension" xmlns:y="urn:other">${xml}</r>`;
    const root = parse({ uri: 'test:', version: 1, source, eol: '\n' }).root!;
    return inertAnnotation(root.children[0]!, source);
  };
  assert.equal(decide('<x:Opaque keep="1">preserve</x:Opaque>'), true);
  assert.equal(
    decide('<x:Opaque keep="1">ReportItems!Title.Value</x:Opaque>'),
    true,
    'reference-looking annotation text stays a literal',
  );
  assert.equal(
    decide('<x:Opaque keep="1"><![CDATA[a]]> &amp; b<!-- c --></x:Opaque>'),
    true,
  );
  assert.equal(
    decide('<z:Opaque xmlns:z="urn:rdlc-code:extension" keep="1"/>'),
    true,
    'expanded names, not prefixes',
  );
  for (const refused of [
    '<x:Opaque keep="1" target="Title">t</x:Opaque>',
    '<x:Opaque keep="1"><x:Nested/></x:Opaque>',
    '<x:Opaque keep="1"><?pi data?></x:Opaque>',
    '<x:Opaque keep="0">t</x:Opaque>',
    '<x:Opaque x:keep="1">t</x:Opaque>',
    '<y:Opaque keep="1">t</y:Opaque>',
    '<x:Chart keep="1">t</x:Chart>',
  ])
    assert.equal(decide(refused), false, refused);
});

test('typed name index and deterministic collision-free allocation', () => {
  const { syntax } = load(fixture);
  const index = nameIndex(syntax.root);
  assert.equal(index.items.get('Title'), 'Textbox');
  assert.ok(index.datasets.has('Orders'));
  assert.equal(index.items.has('Label'), false, 'fields are not report items');
  const names = allocateNames(
    capture([
      id('Title'),
      id('Fresh'),
      id('Table9', 'Tablix'),
      id('Orders', 'Group', 'group'),
      id('Título'),
    ]),
    {
      ...index,
      items: new Map([
        ...index.items,
        ['Table', 'Tablix'],
        ['Table9', 'Tablix'],
        ['Título', 'Textbox'],
      ]),
    },
  );
  assert.deepEqual(
    [...names],
    [
      ['Title', 'Title1'],
      ['Fresh', 'Fresh'],
      ['Table9', 'Table1'],
      ['Orders', 'Orders1'],
      ['Título', 'Textbox1'],
    ],
  );
  // Copies follow the creation series even when the bare stem is free.
  const series = allocateNames(capture([id('Textbox2')]), {
    items: new Map([
      ['Textbox1', 'Textbox'],
      ['Textbox2', 'Textbox'],
    ]),
    groups: new Set(),
    datasets: new Set(),
  });
  assert.deepEqual([...series.values()], ['Textbox3']);
  const nested = allocateNames(capture([id('A1'), id('A2'), id('A')]), {
    items: new Map([
      ['A1', 'Textbox'],
      ['A2', 'Textbox'],
      ['A', 'Textbox'],
    ]),
    groups: new Set(),
    datasets: new Set(),
  });
  assert.deepEqual([...nested.values()], ['A3', 'A4', 'A5']);
});

test('destination compatibility needs identical fields and compatible external targets', () => {
  const { syntax, report } = load(fixture);
  const orders = {
    name: 'Orders',
    fields: [
      { name: 'Amount', dataField: 'Amount', typeName: 'System.Decimal' },
    ],
  };
  assert.deepEqual(
    validateDestination(capture([id('X')], [], [orders]), syntax.root, report),
    [],
    'positive compatible reuse',
  );
  assert.deepEqual(
    validateDestination(
      capture([id('X')], [{ kind: 'textbox', name: 'Outside', range: null }]),
      syntax.root,
      report,
    ),
    [],
  );
  const code = (c: Capture, source = fixture) => {
    const loaded = load(source);
    return validateDestination(c, loaded.syntax.root, loaded.report)[0]?.code;
  };
  assert.equal(
    code(
      capture(
        [],
        [],
        [
          {
            ...orders,
            fields: [{ ...orders.fields[0]!, typeName: 'System.Int32' }],
          },
        ],
      ),
    ),
    'DATASET_INCOMPATIBLE',
  );
  assert.equal(
    code(
      capture([], [], [orders]),
      fixture.replace(
        '<DataField>Amount</DataField>',
        '<DataField>Total</DataField>',
      ),
    ),
    'DATASET_INCOMPATIBLE',
    'same dataset name, different field definition',
  );
  assert.equal(
    code(capture([], [], [{ name: 'Missing', fields: [] }])),
    'DATASET_MISSING',
  );
  assert.equal(
    code(capture([], [{ kind: 'data-region', name: 'Outside', range: null }])),
    'REFERENCE_UNRESOLVED',
    'a textbox is not a data region',
  );
  assert.equal(
    code(capture([], [{ kind: 'textbox', name: 'Nowhere', range: null }])),
    'REFERENCE_UNRESOLVED',
  );
  assert.equal(
    code(
      capture(
        [id('Inside')],
        [{ kind: 'textbox', name: 'Inside', range: null }],
      ),
    ),
    undefined,
  );
});

const requirement = (
  name: string,
  identity: string,
  mime = 'image/png',
): EmbeddedImageRequirement => ({
  name,
  // A hashless (undisplayable) definition has no picture hash, only an xml identity.
  hash: identity.startsWith('xml:') ? null : identity,
  identity,
  mime,
  xml: `<EmbeddedImage Name="${name}"><MIMEType>${mime}</MIMEType><ImageData>AAAA</ImageData></EmbeddedImage>`,
  nameRange: { start: 22, end: 22 + name.length },
});

test('reconcileImages reuses an identical definition without writing it', () => {
  const result = reconcileImages(
    [requirement('logo', 'h1')],
    [
      { name: 'other', identity: 'h2' },
      { name: 'logo', identity: 'h1' },
    ],
  );
  assert.deepEqual(result.reuse, ['logo']);
  assert.deepEqual(result.insert, []);
  assert.equal(result.rename.size, 0);
});

test('reconcileImages reuses identical content under another name and redirects the item', () => {
  const result = reconcileImages(
    [requirement('logo', 'h1')],
    [{ name: 'brand', identity: 'h1' }],
  );
  assert.deepEqual(result.reuse, ['logo']);
  assert.deepEqual(result.insert, []);
  assert.deepEqual([...result.rename], [['logo', 'brand']]);
  // A same-named identical definition wins over another identical one.
  const both = reconcileImages(
    [requirement('logo', 'h1')],
    [
      { name: 'brand', identity: 'h1' },
      { name: 'logo', identity: 'h1' },
    ],
  );
  assert.equal(both.rename.size, 0);
});

test('reconcileImages inserts a definition whose name is free', () => {
  const required = requirement('logo', 'h1');
  const result = reconcileImages(
    [required],
    [{ name: 'photo', identity: 'h2' }],
  );
  assert.deepEqual(result.reuse, []);
  assert.deepEqual(result.insert, [required]);
  assert.equal(result.rename.size, 0);
  assert.deepEqual(reconcileImages([required], []).insert, [required]);
});

test('reconcileImages renames on a name collision with different content', () => {
  const required = requirement('logo', 'h1');
  const result = reconcileImages(
    [required],
    [{ name: 'logo', identity: 'h2' }],
  );
  assert.deepEqual(result.insert, [required]);
  assert.deepEqual([...result.rename], [['logo', 'logo_1']]);
  // Undisplayable, hashless targets still reserve their name.
  const reserved = reconcileImages(
    [required],
    [
      { name: 'logo', identity: null },
      { name: 'logo_1', identity: null },
    ],
  );
  assert.deepEqual([...reserved.rename], [['logo', 'logo_2']]);
});

test('reconcileImages keeps new names distinct and inserts identical content once', () => {
  const result = reconcileImages(
    [
      requirement('logo', 'h1'),
      requirement('logo_1', 'h2'),
      requirement('copy', 'h1'),
      requirement('photo', 'h3'),
    ],
    [
      { name: 'logo', identity: 'other' },
      { name: 'photo', identity: 'h3' },
    ],
  );
  assert.deepEqual(
    result.insert.map((entry) => entry.name),
    ['logo', 'logo_1'],
  );
  assert.deepEqual(
    [...result.rename],
    [
      ['logo', 'logo_2'],
      ['copy', 'logo_2'],
    ],
    'the second identical requirement follows the first insert',
  );
  assert.deepEqual(result.reuse, ['copy', 'photo']);
});

test('reconcileImages ignores a repeated requirement name', () => {
  const result = reconcileImages(
    [requirement('logo', 'h1'), requirement('logo', 'h1')],
    [],
  );
  assert.equal(result.insert.length, 1);
});

test('reconcileImages reuses a hashless definition only on an exact xml identity', () => {
  const same = requirement('spinner', 'xml:a', 'image/gif');
  assert.deepEqual(
    reconcileImages([same], [{ name: 'spinner', identity: 'xml:a' }]).reuse,
    ['spinner'],
  );
  const different = reconcileImages(
    [same],
    [{ name: 'spinner', identity: 'xml:b' }],
  );
  assert.deepEqual(different.insert, [same]);
  assert.deepEqual([...different.rename], [['spinner', 'spinner_1']]);
  // A displayable target never stands in for a hashless definition, or the reverse.
  assert.deepEqual(
    reconcileImages([same], [{ name: 'other', identity: 'h1' }]).insert,
    [same],
  );
});

test('reconcileImages never allocates a reserved dangling name', () => {
  const result = reconcileImages(
    [requirement('logo', 'h1')],
    [{ name: 'logo', identity: 'h2' }],
    ['logo_1'],
  );
  assert.deepEqual([...result.rename], [['logo', 'logo_2']]);
});

test('validateDestination refuses a dangling image reference this report would capture', () => {
  const imageRoot = (name: string) =>
    ({
      identities: [id('Ghost', 'Image')],
      references: [],
      embedded: { name, range: null },
    }) as unknown as CaptureRoot;
  const withRoot = (root: CaptureRoot, images: Capture['images'] = []) => ({
    ...capture([]),
    roots: [root],
    images,
  });
  const destination = load(
    readFileSync('tests/fixtures/images/collision.rdlc', 'utf8'),
  );
  const [refusal] = validateDestination(
    withRoot(imageRoot('logo')),
    destination.syntax.root,
    destination.report,
  );
  assert.equal(refusal?.code, 'IMAGE_DEFINITION_CONFLICT');
  assert.match(refusal!.message, /Ghost/);
  assert.match(refusal!.message, /logo/);
  // A name the target does not define, or one the capture carries, is fine.
  assert.deepEqual(
    validateDestination(
      withRoot(imageRoot('nothing')),
      destination.syntax.root,
      destination.report,
    ),
    [],
  );
  assert.deepEqual(
    validateDestination(
      withRoot(imageRoot('logo'), [requirement('logo', 'h1')]),
      destination.syntax.root,
      destination.report,
    ),
    [],
  );
});
