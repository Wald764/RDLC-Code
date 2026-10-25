import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectNavigation } from './navigation.js';
import {
  groupDataCategories,
  projectData,
  type DataCategories,
  type DataCategoryGroup,
  type DataCategoryKey,
} from './data.js';
import {
  validateAcceptedNavigation,
  type AcceptedNavigation,
  type NavigationNode,
} from '@rdlc/report-model/navigation';
import type { XmlSyntaxDocument } from '@rdlc/report-model/syntax';

/**
 * US3 T034 — Report Data projection contract (T033 fixtures, T036/T037 production).
 *
 * `packages/renderer/src/data.ts` owns the Data projector; `projectNavigation`
 * joins it to Structure through the shared accepted facts.
 *
 * Synthetic categories are presentation rows, per data-model.md: fixed count and
 * labels, synthetic stable keys and no XML target ID, range or mutation
 * capability. The closed wire envelope carries only `nodes`/`truncated`, so the
 * categories are asserted through the shared grouping helper the native view
 * (T038) consumes — the protocol is not widened to carry them.
 *
 * Isolated run: workspace imports resolve to the packages' existing `dist` build (see
 * scripts/compile.ts); renderer sources load from `.ts` through
 * %TEMP%/opencode/us1-ts-hooks.mjs. Re-run `pnpm test:unit`, which recompiles first,
 * before treating a green run as final.
 */

type ExpectedEntry = {
  readonly key: string;
  readonly kind: string;
  readonly category: string;
  readonly parent: string | null;
  readonly element: string;
  readonly ns?: string;
  readonly name: string | null;
  readonly open: string;
  readonly close?: string;
  readonly opaque?: boolean;
  readonly noDetails?: boolean;
  readonly details?: Record<string, unknown>;
  readonly authoring?: boolean;
};
type ExpectedFixture = {
  readonly path: string;
  readonly uri: string;
  readonly status: 'editable' | 'source-only';
  readonly entries: readonly ExpectedEntry[];
};
type Expected = {
  readonly version: number;
  readonly categories: readonly {
    readonly semantic: string;
    readonly label: string;
  }[];
  readonly allowedDetailKeys: readonly string[];
  readonly allowedOperations: readonly string[];
  readonly fixtures: Readonly<Record<string, ExpectedFixture>>;
  readonly secrets: Readonly<Record<string, readonly string[]>>;
};
type Boundaries = {
  readonly navigation: {
    readonly sharedEntryCap: number;
    readonly initialSplit: number;
  };
};

const expected = JSON.parse(
  readFileSync('tests/fixtures/sidebar/data.expected.json', 'utf8'),
) as Expected;
const boundaries = JSON.parse(
  readFileSync('tests/fixtures/sidebar/structure-boundaries.json', 'utf8'),
) as Boundaries;

const dataKinds = [
  'dataset',
  'field',
  'parameter',
  'embedded-image',
  'data-source',
];
const xmlTargetId = /^\d+:[1-9][0-9]*$/;
const normalize = (label: string) => label.replace(/\s+/g, '');
const fixtureKeys = ['supported', 'sourceOnly', 'empty', 'opaque'] as const;

const fixtureOf = (key: string): ExpectedFixture => {
  const fixture = expected.fixtures[key];
  assert.ok(fixture, `fixture ${key}`);
  return fixture;
};

function project(fixture: ExpectedFixture): {
  readonly source: string;
  readonly syntax: XmlSyntaxDocument;
  readonly navigation: AcceptedNavigation;
} {
  const source = readFileSync(`tests/fixtures/${fixture.path}`, 'utf8');
  const syntax = parse({
    uri: fixture.uri,
    version: expected.version,
    source,
    eol: '\n',
  });
  const report = projectReport(syntax);
  assert.equal(
    report.status,
    fixture.status,
    `${fixture.path}: fixture status`,
  );
  return { source, syntax, navigation: projectNavigation(syntax, report) };
}

/** Exact entries, real source slices, closed metadata allowlist and sentinel exclusion. */
function assertEntries(
  key: string,
  fixture: ExpectedFixture,
  source: string,
  navigation: AcceptedNavigation,
): void {
  const nodes = navigation.data.nodes;
  assert.equal(
    validateAcceptedNavigation(navigation, expected.version, source.length),
    true,
    'closed navigation envelope still validates',
  );
  assert.equal(nodes.length, fixture.entries.length, 'entry count');
  const ids = new Map<string, string>();
  fixture.entries.forEach((entry, index) => {
    const node: NavigationNode | undefined = nodes[index];
    assert.ok(node, `${entry.key}: missing node`);
    assert.equal(node.kind, entry.kind, `${entry.key}: kind`);
    assert.equal(node.name, entry.name, `${entry.key}: name`);
    assert.ok(
      node.expandedName.endsWith(`}${entry.element}`),
      `${entry.key}: element ${node.expandedName}`,
    );
    if (entry.ns)
      assert.ok(
        node.expandedName.startsWith(`{${entry.ns}}`),
        `${entry.key}: foreign namespace retained`,
      );
    assert.match(
      node.id,
      xmlTargetId,
      `${entry.key}: version-local XML target id`,
    );
    assert.equal(
      source.slice(node.range.start, node.range.start + entry.open.length),
      entry.open,
      `${entry.key}: opening source slice`,
    );
    if (entry.close)
      assert.equal(
        source.slice(node.range.end - entry.close.length, node.range.end),
        entry.close,
        `${entry.key}: closing source slice`,
      );
    if (entry.parent === null) {
      assert.equal(node.parentId, null, `${entry.key}: top-level entry`);
    } else {
      const parentId = ids.get(entry.parent);
      assert.ok(parentId, `${entry.key}: parent ${entry.parent} seen first`);
      assert.equal(node.parentId, parentId, `${entry.key}: parent`);
      const parent =
        nodes[fixture.entries.findIndex((e) => e.key === entry.parent)];
      assert.ok(parent, `${entry.key}: parent node`);
      assert.ok(
        parent.range.start <= node.range.start &&
          node.range.end <= parent.range.end,
        `${entry.key}: range inside parent`,
      );
    }
    ids.set(entry.key, node.id);

    if (entry.noDetails) {
      assert.equal(node.details, undefined, `${entry.key}: no metadata`);
    } else {
      assert.ok(node.details, `${entry.key}: metadata present`);
      for (const detail of Object.keys(node.details))
        assert.ok(
          expected.allowedDetailKeys.includes(detail),
          `${entry.key}: metadata key ${detail} outside the allowlist`,
        );
      assert.deepEqual(node.details, entry.details, `${entry.key}: metadata`);
    }
  });

  const starts = nodes.map((node) => node.range.start);
  assert.deepEqual(
    starts,
    [...starts].sort((a, b) => a - b),
    'real source order',
  );
  assert.equal(new Set(starts).size, starts.length, 'one range per definition');
  assert.equal(new Set(ids.values()).size, ids.size, 'unique target ids');

  const serialized = JSON.stringify(navigation);
  const secrets = expected.secrets[key];
  assert.ok(secrets, `sentinels for ${key}`);
  for (const secret of secrets) {
    assert.ok(
      source.includes(secret),
      `${secret}: sentinel lives in the fixture`,
    );
    assert.ok(
      !serialized.includes(secret),
      `${secret}: leaked into the projection`,
    );
  }
  assert.equal(
    navigation.structure.nodes.some((node) => dataKinds.includes(node.kind)),
    false,
    'Structure keeps no duplicate data branch',
  );
}

/**
 * Capability facts, not copied output: inspection/source stay available, the
 * properties/author facts follow the existing field guards (a recognized type plus the
 * calculated-field refusal, see apps/vscode-extension/src/edit-controller.ts) and every
 * refusal carries a visible reason.
 */
function assertCapabilities(
  fixture: ExpectedFixture,
  navigation: AcceptedNavigation,
): void {
  fixture.entries.forEach((entry, index) => {
    const node: NavigationNode | undefined = navigation.data.nodes[index];
    assert.ok(node, `${entry.key}: missing node`);
    const byOperation = new Map(
      node.capabilities.map((capability) => [capability.operation, capability]),
    );
    for (const capability of node.capabilities)
      assert.ok(
        expected.allowedOperations.includes(capability.operation),
        `${entry.key}: operation ${capability.operation}`,
      );
    for (const operation of ['inspect', 'source'] as const) {
      const capability = byOperation.get(operation);
      assert.equal(
        capability?.eligible,
        true,
        `${entry.key}: ${operation} available`,
      );
      assert.equal(
        capability?.reason ?? null,
        null,
        `${entry.key}: ${operation} reason`,
      );
    }
    if (entry.authoring === undefined) return;
    for (const operation of ['properties', 'author'] as const) {
      const capability = byOperation.get(operation);
      assert.ok(capability, `${entry.key}: ${operation} reported`);
      assert.equal(
        capability.eligible,
        entry.authoring,
        `${entry.key}: ${operation}`,
      );
      if (entry.authoring)
        assert.equal(
          capability.reason,
          null,
          `${entry.key}: no refusal reason`,
        );
      else assert.ok(capability.reason, `${entry.key}: visible refusal reason`);
    }
    if (entry.opaque)
      assert.ok(node.opaqueReason, `${entry.key}: opaque reason stated`);
  });
}

/**
 * Fixed synthetic categories: stable non-XML keys carrying no node identity,
 * range or capability, a complete partition of the inventory, and each entry
 * listed exactly once under the category its actual source collection proves.
 */
function assertCategories(
  fixture: ExpectedFixture,
  syntax: XmlSyntaxDocument,
  navigation: AcceptedNavigation,
): void {
  const { categories, unassigned }: DataCategories = groupDataCategories(
    navigation.data.nodes,
    syntax,
  );
  assert.equal(
    categories.length,
    expected.categories.length,
    'fixed category count',
  );
  const nodeIds = new Set(navigation.data.nodes.map((node) => node.id));
  const bySemantic = new Map<string, DataCategoryGroup>();
  for (const category of categories) {
    assert.deepEqual(
      Object.keys(category).sort(),
      ['key', 'label', 'nodes'],
      `category ${category.key} carries no identity, range or capability`,
    );
    assert.ok(category.key, 'synthetic UI key');
    assert.ok(
      !xmlTargetId.test(category.key),
      `key ${category.key} is not an XML id`,
    );
    assert.ok(
      !nodeIds.has(category.key),
      `key ${category.key} is not a node id`,
    );
    assert.ok(Array.isArray(category.nodes), 'members');
    assert.ok(normalize(category.label), 'label');
    const matches = expected.categories.filter(
      (candidate) => normalize(candidate.label) === normalize(category.label),
    );
    assert.equal(matches.length, 1, `category label ${category.label}`);
    const semantic = matches[0]!.semantic;
    assert.ok(!bySemantic.has(semantic), `unique label ${category.label}`);
    bySemantic.set(semantic, category);
  }
  assert.equal(
    bySemantic.size,
    expected.categories.length,
    'every category is present',
  );
  assert.deepEqual(
    unassigned,
    [],
    'every fixture definition belongs to a supported collection',
  );
  const grouped = categories.flatMap((category) =>
    category.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    [...grouped].sort(),
    [...nodeIds].sort(),
    'every definition appears exactly once',
  );
  assert.equal(
    new Set(grouped).size,
    grouped.length,
    'no definition in two categories',
  );
  for (const [semantic, category] of bySemantic) {
    const members = fixture.entries.flatMap((entry, index) => {
      const node = navigation.data.nodes[index];
      assert.ok(node, `${entry.key}: node for membership`);
      return entry.category === semantic ? [node.id] : [];
    });
    assert.deepEqual(
      category.nodes.map((node) => node.id),
      members,
      `${semantic}: contents in source order`,
    );
  }
}

test('Report Data lists every definition at its real source location with inert metadata', () => {
  for (const key of fixtureKeys) {
    const fixture = fixtureOf(key);
    const { source, navigation } = project(fixture);
    // The opaque fixture may legitimately report an incomplete inventory (see below).
    if (key !== 'opaque')
      assert.equal(
        navigation.data.truncated,
        false,
        `${key}: complete inventory`,
      );
    assertEntries(key, fixture, source, navigation);
  }
});

test('Report Data capability facts follow the existing field guards', () => {
  for (const key of ['supported', 'sourceOnly', 'opaque'] as const) {
    const fixture = fixtureOf(key);
    const { navigation } = project(fixture);
    assertCapabilities(fixture, navigation);
    if (key !== 'sourceOnly') continue;
    for (const node of navigation.data.nodes)
      assert.deepEqual(
        node.capabilities
          .filter(
            (capability) =>
              capability.operation === 'properties' ||
              capability.operation === 'author',
          )
          .map((capability) => capability.eligible),
        [false, false],
        `${node.label}: source-only stays inspection-only`,
      );
  }
});

test('Report Data lists every definition under a fixed synthetic category', () => {
  for (const key of fixtureKeys) {
    const fixture = fixtureOf(key);
    const { syntax, navigation } = project(fixture);
    assertCategories(fixture, syntax, navigation);
    if (key !== 'supported') continue;
    const { categories } = groupDataCategories(navigation.data.nodes, syntax);
    const datasets = categories.find(
      (category) =>
        normalize(category.label) === normalize('Datasets / Fields'),
    );
    assert.ok(datasets, 'datasets category');
    assert.equal(
      navigation.data.nodes
        .filter((node) => node.kind === 'field')
        .every((node) => datasets.nodes.some((entry) => entry.id === node.id)),
      true,
      'fields stay grouped with their dataset category',
    );
  }
});

test('an empty inventory stays empty while an unknown schema stays incomplete', () => {
  const fixture = fixtureOf('empty');
  const { navigation } = project(fixture);
  assert.equal(navigation.data.truncated, false, 'complete empty inventory');
  assert.equal(navigation.data.nodes.length, 0, 'no invented definition');

  const unknown = parse({
    uri: 'fixture:sidebar-data-unknown-namespace',
    version: expected.version,
    source:
      '<Report xmlns="http://example.invalid/2016/01/reportdefinition">' +
      '<DataSets><DataSet Name="Ghost"/></DataSets></Report>',
    eol: '\n',
  });
  const incomplete = projectNavigation(unknown, projectReport(unknown));
  assert.equal(
    incomplete.data.nodes.length,
    0,
    'no node from an unknown schema',
  );
  assert.equal(
    incomplete.data.truncated,
    true,
    'an unrecognized schema reports an incomplete inventory, not "no definitions"',
  );
});

test('foreign lookalikes never gain a supported definition and never vanish', () => {
  const fixture = fixtureOf('opaque');
  const { navigation } = project(fixture);
  for (const node of navigation.data.nodes)
    if (node.expandedName.startsWith('{urn:rdlc-code:ext}')) {
      assert.equal(
        node.kind,
        'opaque',
        `${node.label}: foreign lookalike stays opaque`,
      );
      assert.equal(node.details, undefined, `${node.label}: no metadata`);
      assert.equal(
        node.capabilities.find(
          (capability) => capability.operation === 'author',
        )?.eligible,
        false,
        `${node.label}: no authoring`,
      );
    }
  const lookalike = navigation.data.nodes.find(
    (node) => node.name === 'Lookalike',
  );
  assert.deepEqual(
    lookalike?.details,
    { hasQuery: false },
    'a foreign ext:Query lookalike is neither a query nor a source of metadata',
  );
  // A foreign collection must not vanish silently: list it as opaque or admit incomplete.
  assert.ok(
    navigation.data.truncated ||
      navigation.data.nodes.some((node) => node.name === 'ForeignRoot'),
    'foreign root collection stays visible as opaque or marks the inventory incomplete',
  );
});

test('root opaque definitions group by their actual source collection, never a foreign lookalike name', () => {
  const namespace =
    'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
  const syntax = parse({
    uri: 'fixture:sidebar-data-mismatched-collection',
    version: expected.version,
    source:
      `<Report xmlns="${namespace}" xmlns:ext="urn:rdlc-code:ext">` +
      '<DataSets><ext:ReportParameter Name="ForeignParameter"/>' +
      '<ext:Widget Name="Weird"/></DataSets>' +
      '<DataSources><ext:Widget Name="SourceWidget"/></DataSources>' +
      '<ReportSections><ReportSection><Body><ReportItems><Textbox Name="Only"/></ReportItems>' +
      '<Height>1in</Height></Body><Width>6.5in</Width><Page/></ReportSection>' +
      '</ReportSections></Report>',
    eol: '\n',
  });
  const data = projectData(syntax, projectReport(syntax));
  const of = (name: string): string => {
    const node = data.nodes.find((entry) => entry.name === name);
    assert.ok(node, `${name} is projected`);
    return node.id;
  };
  const { categories, unassigned }: DataCategories = groupDataCategories(
    data.nodes,
    syntax,
  );
  const member = (key: DataCategoryKey): readonly string[] =>
    categories.find((entry) => entry.key === key)!.nodes.map((node) => node.id);
  const datasets = [of('ForeignParameter'), of('Weird')];
  assert.deepEqual(
    member('datasets'),
    datasets,
    'the owning DataSets collection decides, not the foreign local name',
  );
  assert.deepEqual(
    member('sources'),
    [of('SourceWidget')],
    'an unknown child of DataSources stays with its source collection',
  );
  assert.deepEqual(
    member('parameters'),
    [],
    'no lookalike borrows the Parameters category',
  );
  assert.deepEqual(unassigned, [], 'both collections prove ownership');
  for (const category of categories) {
    assert.ok(
      !xmlTargetId.test(category.key),
      `key ${category.key} is not an XML id`,
    );
    assert.equal(
      data.nodes.some((node) => node.id === category.key),
      false,
      `key ${category.key} is not a node id`,
    );
  }
});

test('the shared entry budget truncates Structure and Data independently', () => {
  const { sharedEntryCap, initialSplit } = boundaries.navigation;
  const namespace =
    'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
  const build = (datasets: number, textboxes: number) =>
    `<Report xmlns="${namespace}"><DataSets>${Array.from(
      { length: datasets },
      (_, index) => `<DataSet Name="D${index}"/>`,
    ).join(
      '',
    )}</DataSets><ReportSections><ReportSection><Body><ReportItems>${Array.from(
      { length: textboxes },
      (_, index) => `<Textbox Name="T${index}"/>`,
    ).join(
      '',
    )}</ReportItems><Height>1in</Height></Body><Width>6.5in</Width><Page/></ReportSection></ReportSections></Report>`;
  const budget = (source: string) => {
    const syntax = parse({
      uri: 'fixture:sidebar-data-budget',
      version: expected.version,
      source,
      eol: '\n',
    });
    return projectNavigation(syntax, projectReport(syntax));
  };
  const structureOnly = 4; // Report, ReportSections, ReportSection, Body
  const fitting = budget(build(sharedEntryCap - structureOnly, 0));
  assert.equal(
    fitting.structure.nodes.length,
    structureOnly,
    'structure stays small',
  );
  assert.equal(
    fitting.data.nodes.length,
    sharedEntryCap - structureOnly,
    'unused capacity transfers to Data and synthetic categories consume no authored slot',
  );
  assert.equal(fitting.data.truncated, false, 'nothing omitted');
  assert.equal(
    fitting.structure.nodes.length + fitting.data.nodes.length,
    sharedEntryCap,
    'shared cap used exactly',
  );

  const dataHeavy = budget(build(sharedEntryCap - structureOnly + 1, 0));
  assert.equal(dataHeavy.data.truncated, true, 'Data overflow is explicit');
  assert.equal(
    dataHeavy.structure.truncated,
    false,
    'Structure stays complete',
  );
  assert.ok(
    dataHeavy.structure.nodes.length + dataHeavy.data.nodes.length <=
      sharedEntryCap,
    'shared cap holds under Data overflow',
  );

  const structureHeavy = budget(build(2, sharedEntryCap));
  assert.equal(
    structureHeavy.structure.truncated,
    true,
    'Structure overflow is explicit',
  );
  assert.equal(structureHeavy.data.truncated, false, 'Data stays complete');
  assert.equal(
    structureHeavy.data.nodes.length,
    2,
    'Data keeps its definitions',
  );
  assert.ok(
    structureHeavy.structure.nodes.length + structureHeavy.data.nodes.length <=
      sharedEntryCap,
    'shared cap holds under Structure overflow',
  );

  const joint = budget(build(initialSplit + 1, initialSplit + 1));
  assert.equal(joint.structure.truncated, true, 'joint Structure truncation');
  assert.equal(joint.data.truncated, true, 'joint Data truncation');
  assert.ok(
    joint.structure.nodes.length + joint.data.nodes.length <= sharedEntryCap,
    'one shared cap for both projections',
  );
});
