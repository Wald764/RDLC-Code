import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Capture, CaptureRoot } from '@rdlc/report-model/clipboard';
import { RDL_2016 } from '@rdlc/report-model/report';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import {
  allocateNames,
  inertAnnotation,
  nameIndex,
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
      ['Título', 'Textbox'],
    ],
  );
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
