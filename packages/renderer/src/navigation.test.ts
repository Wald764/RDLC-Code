import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectNavigation } from './navigation.js';
import { projectStructure } from './structure.js';
import {
  validateAcceptedNavigation,
  type NavigationNode,
} from '@rdlc/report-model/navigation';

type ExpectedNode = {
  readonly key: string;
  readonly kind: string;
  /** Used by the legacy projectStructure oracle; projectNavigation always uses `kind`. */
  readonly structureKind?: string;
  readonly parent: string | null;
  readonly element: string;
  readonly ns?: string;
  readonly name: string | null;
  readonly open: string;
  readonly close?: string;
  readonly legacyOnly?: boolean;
  readonly preserved?: boolean;
  readonly opaque?: boolean;
  readonly details?: Record<string, unknown>;
};
type Expected = {
  readonly uri: string;
  readonly version: number;
  readonly namespace: string;
  readonly sourceOnlyNamespace: string;
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
  readonly parser: {
    readonly maxSourceCodeUnits: number;
    readonly maxElements: number;
    readonly maxDepth: number;
  };
  readonly transport: { readonly snapshotBytes: number };
};

const expected = JSON.parse(
  readFileSync('tests/fixtures/sidebar/structure.expected.json', 'utf8'),
) as Expected;
const boundaries = JSON.parse(
  readFileSync('tests/fixtures/sidebar/structure-boundaries.json', 'utf8'),
) as Boundaries;

const fixtureSource = () =>
  readFileSync('tests/fixtures/sidebar/structure.rdlc', 'utf8');
const openTagsBefore = (source: string, offset: number) =>
  (source.slice(0, offset).match(/<(?![!?/])/g) ?? []).length;

/** Independent oracle: exact kind/name/label/parent and authored source slice per entry. */
function assertFrozenHierarchy(
  nodes: readonly NavigationNode[],
  entries: readonly ExpectedNode[],
  source: string,
  namespace: string,
): void {
  const keys = new Map<string, string>();
  entries.forEach((entry, index) => {
    const node = nodes[index];
    assert.ok(node, `${entry.key}: missing node`);
    assert.equal(node.kind, entry.kind, `${entry.key}: kind`);
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

function assertCapabilities(
  node: NavigationNode,
  entry: ExpectedNode,
  opaque: boolean,
): void {
  assert.equal(node.capabilities.length, 5, entry.key);
  for (const capability of node.capabilities) {
    const inspection = ['inspect', 'source', 'select'].includes(
      capability.operation,
    );
    if (inspection) {
      assert.equal(
        capability.eligible,
        true,
        `${entry.key}: ${capability.operation}`,
      );
      assert.equal(
        capability.reason,
        null,
        `${entry.key}: ${capability.operation} reason`,
      );
    } else {
      assert.equal(
        capability.eligible,
        !opaque,
        `${entry.key}: ${capability.operation}`,
      );
      assert.equal(
        capability.reason === null,
        capability.eligible,
        `${entry.key}: ${capability.operation} reason`,
      );
    }
  }
}

const ns =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const xml = `<Report xmlns="${ns}"><DataSets><DataSet Name="Orders"><Query><CommandText>SECRET_QUERY</CommandText></Query><Fields><Field Name="Id"><DataField>SECRET_BINDING</DataField></Field></Fields></DataSet></DataSets><ReportParameters><ReportParameter Name="Limit"><DefaultValue><Values><Value>SECRET_VALUE</Value></Values></DefaultValue></ReportParameter></ReportParameters><EmbeddedImages><EmbeddedImage Name="Logo"><ImageData>SECRET_IMAGE</ImageData></EmbeddedImage></EmbeddedImages><DataSources><DataSource Name="Source"><ConnectionProperties><ConnectString>SECRET_PASSWORD</ConnectString></ConnectionProperties></DataSource></DataSources><ReportSections><ReportSection><Body><ReportItems><Tablix Name="T"><TablixBody><TablixRows><TablixRow><TablixCells><TablixCell><CellContents><Textbox Name="Cell"/></CellContents></TablixCell></TablixCells></TablixRow></TablixRows></TablixBody><TablixRowHierarchy><TablixMembers><TablixMember><Group Name="G"/><TablixHeader><CellContents><Textbox Name="Header"/></CellContents></TablixHeader></TablixMember></TablixMembers></TablixRowHierarchy></Tablix></ReportItems></Body><Page><PageHeader><ReportItems><Textbox Name="Title"/></ReportItems></PageHeader></Page></ReportSection></ReportSections></Report>`;

test('native projections keep actual cell/member/header ancestry and separate data definitions', () => {
  const syntax = parse({
    uri: 'test:report',
    source: xml,
    version: 7,
    eol: '\n',
  });
  const result = projectNavigation(syntax, projectReport(syntax));
  assert.equal(validateAcceptedNavigation(result, 7, xml.length), true);
  assert.deepEqual(
    result.data.nodes.map((node) => [node.kind, node.name]),
    [
      ['dataset', 'Orders'],
      ['field', 'Id'],
      ['parameter', 'Limit'],
      ['embedded-image', 'Logo'],
      ['data-source', 'Source'],
    ],
  );
  assert.equal(result.data.nodes[1]?.parentId, result.data.nodes[0]?.id);
  assert.deepEqual(result.data.nodes[0]?.details, { hasQuery: true });
  assert.deepEqual(result.data.nodes[3]?.details, { hasPayload: true });
  assert.deepEqual(result.data.nodes[4]?.details, { source: 'inline' });
  assert.equal(
    result.structure.nodes.some((node) =>
      ['dataset', 'field'].includes(node.kind),
    ),
    false,
  );
  for (const [name, parentKind] of [
    ['Cell', 'table-cell'],
    ['G', 'member'],
    ['Header', 'member-header'],
    ['Title', 'header'],
  ]) {
    const node = result.structure.nodes.find((node) => node.name === name)!;
    assert.ok(node, name);
    assert.equal(
      result.structure.nodes.find((parent) => parent.id === node.parentId)
        ?.kind,
      parentKind,
      name,
    );
    assert.match(
      xml.slice(node.range.start, node.range.end),
      new RegExp(`Name="${name}"`),
    );
  }
  assert.doesNotMatch(JSON.stringify(result), /SECRET_/);
  for (const details of [
    { connectionString: 'SECRET_PASSWORD' },
    { type: 'SECRET_TYPE' },
    { hasQuery: 'SECRET_QUERY' },
    { mime: 'javascript:SECRET_SCRIPT' },
  ]) {
    const forged: unknown = {
      ...result,
      data: {
        ...result.data,
        nodes: [
          { ...result.data.nodes[0]!, details },
          ...result.data.nodes.slice(1),
        ],
      },
    };
    assert.equal(validateAcceptedNavigation(forged, 7, xml.length), false);
  }
  for (const projection of [result.structure, result.data]) {
    const seen = new Set<string>();
    for (const node of projection.nodes) {
      assert.ok(node.parentId === null || seen.has(node.parentId));
      assert.equal(seen.has(node.id), false);
      seen.add(node.id);
    }
  }
});

test('known source-only namespaces retain inspection without mutation capabilities', () => {
  const source = xml.replaceAll('/2016/01/', '/2008/01/');
  const syntax = parse({ uri: 'test:legacy', source, version: 2, eol: '\n' });
  const report = projectReport(syntax);
  assert.equal(report.status, 'source-only');
  const result = projectNavigation(syntax, report);
  assert.equal(result.data.nodes.length, 5);
  assert.ok(result.structure.nodes.some((node) => node.kind === 'table-cell'));
  assert.ok(
    [...result.structure.nodes, ...result.data.nodes].every((node) =>
      node.capabilities.every(
        (capability) =>
          ['inspect', 'source', 'select'].includes(capability.operation) ||
          !capability.eligible,
      ),
    ),
  );
});

test('native allocation shares 2000 entries fairly, transfers unused capacity and keeps parent-closed prefixes', () => {
  const source = `<Report xmlns="${ns}"><DataSets>${Array.from({ length: 1500 }, (_, i) => `<DataSet Name="D${i}"/>`).join('')}</DataSets><ReportSections><ReportSection><Body><ReportItems>${Array.from({ length: 1500 }, (_, i) => `<Textbox Name="T${i}"/>`).join('')}</ReportItems></Body></ReportSection></ReportSections></Report>`;
  const syntax = parse({ uri: 'test:budget', source, version: 1, eol: '\n' });
  const result = projectNavigation(syntax, projectReport(syntax));
  assert.equal(
    result.structure.nodes.length,
    boundaries.navigation.initialSplit,
  );
  assert.equal(result.data.nodes.length, boundaries.navigation.initialSplit);
  assert.equal(result.structure.truncated, true);
  assert.equal(result.data.truncated, true);
  const withoutData = parse({
    uri: 'test:budget',
    source: source.replace(/<DataSets>.*<\/DataSets>/, ''),
    version: 1,
    eol: '\n',
  });
  assert.equal(
    projectNavigation(withoutData, projectReport(withoutData)).structure.nodes
      .length,
    1504,
  );
});

test('sidebar navigation matches the frozen hierarchy with expanded names, source order and truthful capabilities', () => {
  const source = fixtureSource();
  const syntax = parse({
    uri: expected.uri,
    version: expected.version,
    source,
    eol: '\n',
  });
  const report = projectReport(syntax);
  assert.equal(report.status, 'editable');
  const before = JSON.stringify({ syntax, report });
  const navigation = projectNavigation(syntax, report);
  assert.equal(navigation.version, expected.version);
  assert.equal(navigation.structure.truncated, false);
  assert.equal(navigation.data.truncated, false);
  assert.equal(
    validateAcceptedNavigation(navigation, expected.version, source.length),
    true,
  );
  const entries = expected.structure.filter((entry) => !entry.legacyOnly);
  assertFrozenHierarchy(
    navigation.structure.nodes,
    entries,
    source,
    expected.namespace,
  );
  assertFrozenHierarchy(
    navigation.data.nodes,
    expected.data,
    source,
    expected.namespace,
  );
  for (const kind of [
    'dataset',
    'field',
    'parameter',
    'embedded-image',
    'data-source',
    'opaque',
    ...expected.absent,
  ])
    assert.equal(
      navigation.structure.nodes.some((node) => node.kind === kind),
      false,
      `structure excludes ${kind}`,
    );
  for (const name of expected.absentNames)
    assert.equal(
      navigation.structure.nodes.some((node) => node.name === name),
      false,
      `absent ${name}`,
    );
  assert.deepEqual(
    navigation.data.nodes.map((node) => [node.kind, node.name]),
    [
      ['dataset', 'Orders'],
      ['field', 'Label'],
    ],
    'data projection owns the data branch',
  );
  entries.forEach((entry, index) => {
    const node = navigation.structure.nodes[index]!;
    assert.equal(
      node.expandedName,
      `{${entry.ns ?? expected.namespace}}${entry.element}`,
      `${entry.key}: expandedName`,
    );
    assert.equal(
      node.sourceOrder,
      openTagsBefore(source, node.range.start),
      `${entry.key}: sourceOrder`,
    );
    if (index > 0)
      assert.ok(
        node.range.start > navigation.structure.nodes[index - 1]!.range.start,
        `${entry.key}: source order`,
      );
    if (entry.opaque === undefined) return;
    assert.equal(
      node.opaqueReason === null,
      !entry.opaque,
      `${entry.key}: opaqueReason`,
    );
    assertCapabilities(node, entry, entry.opaque);
  });
  expected.data.forEach((entry, index) => {
    const node = navigation.data.nodes[index]!;
    assert.equal(
      node.expandedName,
      `{${expected.namespace}}${entry.element}`,
      `${entry.key}: expandedName`,
    );
    assert.equal(
      node.sourceOrder,
      openTagsBefore(source, node.range.start),
      `${entry.key}: sourceOrder`,
    );
    if (entry.details) assert.deepEqual(node.details, entry.details, entry.key);
    if (entry.opaque === undefined) return;
    assert.equal(
      node.opaqueReason === null,
      !entry.opaque,
      `${entry.key}: opaqueReason`,
    );
    assertCapabilities(node, entry, entry.opaque);
  });
  assert.equal(
    JSON.stringify({ syntax, report }),
    before,
    'projection mutated its input',
  );
});

test('known source-only namespace keeps the frozen hierarchy with inspection-only capabilities', () => {
  const source = fixtureSource()
    .split(expected.namespace)
    .join(expected.sourceOnlyNamespace);
  const syntax = parse({
    uri: expected.uri,
    version: expected.version,
    source,
    eol: '\n',
  });
  const report = projectReport(syntax);
  assert.equal(report.status, 'source-only');
  assert.ok(
    report.diagnostics.some(
      (diagnostic) => diagnostic.code === 'REPORT_SOURCE_ONLY',
    ),
  );
  const navigation = projectNavigation(syntax, report);
  assert.equal(
    validateAcceptedNavigation(navigation, expected.version, source.length),
    true,
  );
  const entries = expected.structure.filter((entry) => !entry.legacyOnly);
  assertFrozenHierarchy(
    navigation.structure.nodes,
    entries,
    source,
    expected.sourceOnlyNamespace,
  );
  assertFrozenHierarchy(
    navigation.data.nodes,
    expected.data,
    source,
    expected.sourceOnlyNamespace,
  );
  for (const node of [
    ...navigation.structure.nodes,
    ...navigation.data.nodes,
  ]) {
    assert.ok(node.opaqueReason, node.label);
    for (const capability of node.capabilities) {
      const inspection = ['inspect', 'source', 'select'].includes(
        capability.operation,
      );
      assert.equal(
        capability.eligible,
        inspection,
        `${node.label}: ${capability.operation}`,
      );
      assert.equal(
        capability.reason === null,
        inspection,
        `${node.label}: ${capability.operation} reason`,
      );
    }
  }
});

test('shared entry cap truncates at entry 2,001 with a closed transport-sized envelope', () => {
  const { sharedEntryCap, firstOverflowingEntry } = boundaries.navigation;
  const build = (textboxes: number) =>
    `<Report xmlns="${ns}"><ReportSections><ReportSection><Body><ReportItems>` +
    Array.from(
      { length: textboxes },
      (_, index) => `<Textbox Name="T${index}"/>`,
    ).join('') +
    `</ReportItems></Body></ReportSection></ReportSections></Report>`;
  const project = (source: string) => {
    const syntax = parse({
      uri: 'fixture:sidebar-shared-cap',
      version: 7,
      source,
      eol: '\n',
    });
    return projectNavigation(syntax, projectReport(syntax));
  };
  const overhead = project(build(0)).structure.nodes.length;
  assert.ok(overhead > 0 && overhead < sharedEntryCap, 'structural overhead');
  const fits = build(sharedEntryCap - overhead);
  const fitsResult = project(fits);
  assert.equal(
    fitsResult.structure.truncated,
    false,
    `entry ${sharedEntryCap}`,
  );
  assert.equal(
    fitsResult.structure.nodes.length,
    sharedEntryCap,
    `entry ${sharedEntryCap}`,
  );
  assert.equal(validateAcceptedNavigation(fitsResult, 7, fits.length), true);
  const overflow = build(firstOverflowingEntry - overhead);
  const overflowResult = project(overflow);
  assert.equal(
    overflowResult.structure.truncated,
    true,
    `entry ${firstOverflowingEntry}`,
  );
  assert.equal(
    overflowResult.structure.nodes.length,
    sharedEntryCap,
    `entry ${firstOverflowingEntry}`,
  );
  assert.equal(
    validateAcceptedNavigation(overflowResult, 7, overflow.length),
    true,
  );
  assert.ok(
    JSON.stringify(overflowResult).length < boundaries.transport.snapshotBytes,
    'navigation envelope stays inside the snapshot transport budget',
  );
});

test('parser budget boundaries keep exhausted sources source-only and invent no nodes', () => {
  const { parser } = boundaries;
  const document = (source: string) =>
    parse({ uri: 'fixture:sidebar-parser', version: 7, source, eol: '\n' });
  const nested = (depth: number) =>
    '<Report>' +
    '<Item>'.repeat(depth - 1) +
    '</Item>'.repeat(depth - 1) +
    '</Report>';
  assert.equal(
    document(nested(parser.maxDepth)).status,
    'valid',
    'depth at the limit',
  );
  const exhausted = [
    document(nested(parser.maxDepth + 1)),
    document('<Report>' + '<b/>'.repeat(parser.maxElements) + '</Report>'),
    document(
      `<Report xmlns="${ns}">` +
        ' '.repeat(parser.maxSourceCodeUnits) +
        '</Report>',
    ),
  ];
  for (const syntax of exhausted) {
    assert.equal(syntax.status, 'source-only');
    const report = projectReport(syntax);
    const navigation = projectNavigation(syntax, report);
    assert.deepEqual(navigation.structure.nodes, []);
    assert.deepEqual(navigation.data.nodes, []);
    assert.equal(navigation.structure.truncated, false);
    assert.equal(navigation.data.truncated, false);
    assert.equal(projectStructure(syntax, report).nodes.length, 0);
  }
});
