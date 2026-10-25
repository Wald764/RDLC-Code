import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectStructure } from './structure.js';

type ExpectedNode = {
  readonly key: string;
  readonly kind: string;
  /** Overrides `kind` where projectStructure's legacy vocabulary still differs. */
  readonly structureKind?: string;
  readonly parent: string | null;
  readonly element: string;
  readonly ns?: string;
  readonly name: string | null;
  readonly open: string;
  readonly close?: string;
  /**
   * Retired from `projectStructure`; the frozen oracle keeps it for the Data
   * projection.
   */
  readonly legacyOnly?: boolean;
  readonly preserved?: boolean;
  readonly opaque?: boolean;
};
type Expected = {
  readonly uri: string;
  readonly version: number;
  readonly namespace: string;
  readonly absent: readonly string[];
  readonly absentNames: readonly string[];
  readonly structure: readonly ExpectedNode[];
  readonly data: readonly ExpectedNode[];
};
type Boundaries = {
  readonly navigation: {
    readonly sharedEntryCap: number;
    readonly initialSplit: number;
    readonly emittedLevels: number;
    readonly firstOverflowingEntry: number;
  };
};
type ProjectedNode = {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly name: string | null;
  readonly label: string;
  readonly range: { readonly start: number; readonly end: number };
};

const expected = JSON.parse(
  readFileSync('tests/fixtures/sidebar/structure.expected.json', 'utf8'),
) as Expected;
const boundaries = JSON.parse(
  readFileSync('tests/fixtures/sidebar/structure-boundaries.json', 'utf8'),
) as Boundaries;

const reportNamespace = expected.namespace;
const fixture = () =>
  readFileSync('tests/fixtures/sidebar/structure.rdlc', 'utf8');
const fixtureReport = (source: string) => {
  const syntax = parse({
    uri: expected.uri,
    version: expected.version,
    source,
    eol: '\n',
  });
  return { syntax, report: projectReport(syntax) };
};

/** Independent oracle: exact kind/name/label/parent and authored source slice per entry. */
function assertFrozenHierarchy(
  nodes: readonly ProjectedNode[],
  entries: readonly ExpectedNode[],
  source: string,
  namespace: string,
): void {
  const keys = new Map<string, string>();
  entries.forEach((entry, index) => {
    const node = nodes[index];
    assert.ok(node, `${entry.key}: missing node`);
    assert.equal(
      node.kind,
      entry.structureKind ?? entry.kind,
      `${entry.key}: kind`,
    );
    assert.equal(node.name, entry.name, `${entry.key}: name`);
    assert.equal(
      node.label,
      entry.name ? `${entry.element}: ${entry.name}` : entry.element,
      `${entry.key}: label`,
    );
    const open = entry.open.split(expected.namespace).join(namespace);
    const slice = source.slice(node.range.start, node.range.end);
    if (entry.close) {
      assert.ok(slice.startsWith(open), `${entry.key}: opening tag ${open}`);
      assert.ok(
        slice.endsWith(entry.close),
        `${entry.key}: closing tag ${entry.close}`,
      );
    } else assert.equal(slice, open, `${entry.key}: source slice`);
    assert.ok(
      node.range.start >= 0 &&
        node.range.end > node.range.start &&
        node.range.end <= source.length,
      `${entry.key}: range ${JSON.stringify(node.range)}`,
    );
    assert.equal(keys.has(node.id), false, `${entry.key}: duplicate node id`);
    keys.set(node.id, entry.key);
  });
  assert.equal(nodes.length, entries.length, 'emitted node count');
  entries.forEach((entry, index) => {
    const parent = nodes[index]!.parentId;
    assert.equal(
      parent === null ? null : (keys.get(parent) ?? `<unprojected ${parent}>`),
      entry.parent,
      `${entry.key}: parent`,
    );
  });
}

test('structure joins actual table syntax without mutating accepted input', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const syntax = parse({
    uri: 'fixture:grouped-table-scoped-totals',
    version: 7,
    source,
    eol: '\n',
  });
  const report = projectReport(syntax);
  const before = JSON.stringify({ syntax, report });
  const structure = projectStructure(syntax, report);
  assert.equal(structure.truncated, false);
  for (const kind of [
    'report',
    'sections',
    'section',
    'body',
    'table',
    'row',
    'cell',
    'textbox',
  ])
    assert.ok(
      structure.nodes.some((n) => n.kind === kind),
      kind,
    );
  assert.deepEqual(
    structure.nodes.filter((n) => n.kind === 'dataset' || n.kind === 'field'),
    [],
    'datasets and fields are Data projection entries only',
  );
  for (const n of structure.nodes) {
    assert.ok(n.id.startsWith('7:'));
    assert.ok(n.range.end <= source.length);
    if (n.parentId) assert.ok(structure.nodes.some((p) => p.id === n.parentId));
  }
  assert.equal(JSON.stringify({ syntax, report }), before);
  assert.equal(projectStructure(syntax, report, 2).truncated, true);
  assert.equal(projectStructure(syntax, report, 0).nodes.length, 0);
});

test('source-only sections and preserved nesting stay honest; malformed syntax invents nothing', () => {
  const ns =
    'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
  const source = `<Report xmlns="${ns}"><ReportSections><ReportSection><Body><ReportItems><Rectangle Name="Box"><ReportItems><Textbox Name="Nested"/></ReportItems></Rectangle><Chart Name="Opaque"><Anything/></Chart></ReportItems></Body></ReportSection><ReportSection><Body/></ReportSection></ReportSections></Report>`;
  const syntax = parse({
    uri: 'fixture:nested',
    version: 1,
    source,
    eol: '\n',
  });
  const result = projectStructure(syntax, projectReport(syntax));
  assert.equal(result.nodes.filter((n) => n.kind === 'section').length, 2);
  assert.ok(result.nodes.find((n) => n.name === 'Nested')?.preservedReason);
  assert.ok(
    result.nodes
      .find((n) => n.name === 'Opaque')
      ?.preservedReason?.includes('Chart'),
  );
  assert.ok(!result.nodes.some((n) => n.label === 'Anything'));
  const invalid = parse({
    uri: 'fixture:invalid',
    version: 1,
    source: '<Report>',
    eol: '\n',
  });
  assert.deepEqual(projectStructure(invalid, projectReport(invalid)).nodes, []);
});

test('deep preserved containment truncates at the emitted-depth boundary without fabricating bounds or children', () => {
  const levels = boundaries.navigation.emittedLevels;
  const source =
    '<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"><ReportSections><ReportSection><Body><ReportItems>' +
    '<Rectangle><ReportItems>'.repeat(levels + 8) +
    '<Textbox Name="Deep"/>' +
    '</ReportItems></Rectangle>'.repeat(levels + 8) +
    '</ReportItems></Body></ReportSection></ReportSections></Report>';
  const syntax = parse({ uri: 'fixture:deep', version: 1, source, eol: '\n' });
  const structure = projectStructure(syntax, projectReport(syntax));
  assert.equal(structure.truncated, true);
  assert.equal(structure.nodes.length, levels);
  assert.ok(!structure.nodes.some((n) => n.name === 'Deep' || 'bounds' in n));
});

test('sidebar structure fixture matches the frozen hierarchy and slices, without a data branch', () => {
  const source = fixture();
  const { syntax, report } = fixtureReport(source);
  assert.equal(report.status, 'editable');
  const before = JSON.stringify({ syntax, report });
  const structure = projectStructure(syntax, report);
  assert.equal(structure.truncated, false);
  const entries = expected.structure.filter((entry) => !entry.legacyOnly);
  assertFrozenHierarchy(structure.nodes, entries, source, expected.namespace);
  entries.forEach((entry, index) => {
    if (entry.preserved === undefined) return;
    const node = structure.nodes[index];
    assert.ok(node, entry.key);
    assert.equal(
      node.preservedReason !== null,
      entry.preserved,
      `${entry.key}: preservedReason`,
    );
  });
  assert.equal(
    JSON.stringify({ syntax, report }),
    before,
    'projection mutated its input',
  );
  for (const kind of expected.absent)
    assert.equal(
      structure.nodes.some((node) => node.kind === kind),
      false,
      kind,
    );
  for (const name of expected.absentNames)
    assert.equal(
      structure.nodes.some((node) => node.name === name),
      false,
      name,
    );
  assert.deepEqual(
    structure.nodes
      .filter((node) => node.kind === 'dataset' || node.kind === 'field')
      .map((node) => [node.kind, node.name]),
    [],
    'the retired legacy data-selection branch never returns to Structure',
  );
  assert.equal(
    structure.nodes.filter((node) => node.name === 'Duplicate').length,
    2,
    'duplicate targets stay identifiable',
  );
  assert.ok(
    structure.nodes.some(
      (node) => node.kind === 'textbox' && node.name === null,
    ),
    'unnamed target stays identifiable',
  );
});

test('sidebar structure fixture and companions are registered in the fixture manifest', () => {
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/manifest.json', 'utf8'),
  ) as {
    fixtures: {
      id: string;
      path: string;
      expected?: string;
      boundaries?: string;
      status: string;
      capabilities: string[];
      citations: string[];
    }[];
  };
  const entry = manifest.fixtures.find(
    (fixture) => fixture.id === 'sidebar-structure',
  );
  assert.ok(entry, 'sidebar-structure is registered');
  assert.equal(entry.path, 'sidebar/structure.rdlc');
  assert.equal(entry.expected, 'sidebar/structure.expected.json');
  assert.equal(entry.boundaries, 'sidebar/structure-boundaries.json');
  assert.equal(entry.status, 'supported');
  assert.ok(entry.citations.length >= 5, 'citations');
  for (const citation of entry.citations) {
    assert.ok(citation.startsWith('vendor/'), citation);
    assert.ok(existsSync(citation), citation);
  }
  for (const path of [entry.path, entry.expected, entry.boundaries]) {
    assert.ok(path, 'companion path registered');
    assert.ok(existsSync(resolve('tests/fixtures', path)), path);
  }
});

test('structure projection stops at the shared 2,000/2,001 entry boundary with a closed prefix', () => {
  const { sharedEntryCap, firstOverflowingEntry } = boundaries.navigation;
  const build = (textboxes: number) =>
    `<Report xmlns="${reportNamespace}"><ReportSections><ReportSection><Body><Height>1in</Height><ReportItems>` +
    Array.from(
      { length: textboxes },
      (_, index) => `<Textbox Name="T${index}"/>`,
    ).join('') +
    `</ReportItems></Body><Width>6.5in</Width><Page/></ReportSection></ReportSections></Report>`;
  const project = (source: string) => {
    const syntax = parse({
      uri: 'fixture:sidebar-structure-entries',
      version: 1,
      source,
      eol: '\n',
    });
    return projectStructure(syntax, projectReport(syntax));
  };
  const overhead = project(build(0)).nodes.length;
  assert.ok(overhead > 0 && overhead < sharedEntryCap, 'structural overhead');
  const fits = build(sharedEntryCap - overhead);
  const fitsResult = project(fits);
  assert.equal(fitsResult.truncated, false, 'entry ' + sharedEntryCap);
  assert.equal(
    fitsResult.nodes.length,
    sharedEntryCap,
    'entry ' + sharedEntryCap,
  );
  const overflow = build(firstOverflowingEntry - overhead);
  const overflowResult = project(overflow);
  assert.equal(
    overflowResult.truncated,
    true,
    'entry ' + firstOverflowingEntry,
  );
  assert.equal(
    overflowResult.nodes.length,
    sharedEntryCap,
    'entry ' + firstOverflowingEntry,
  );
  const ids = new Set(overflowResult.nodes.map((node) => node.id));
  for (const node of overflowResult.nodes) {
    assert.ok(node.range.end <= overflow.length, node.id);
    if (node.parentId)
      assert.ok(ids.has(node.parentId), `${node.id}: closed prefix`);
  }
});
