import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import type { AuthoringIntent } from '@rdlc/report-model/editing';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { planAuthoringIntent } from '../../apps/vscode-extension/src/edit-controller.js';
import { projectStructure } from '@rdlc/renderer/structure';
import { projectNavigation } from '@rdlc/renderer/navigation';
import { RDL_2016 } from '@rdlc/report-model/report';

function author(
  source: string,
  target: (report: ReturnType<typeof projectReport>) => string,
  payload: AuthoringIntent['payload'],
) {
  const snapshot = {
    uri: 'test:author',
    version: 1,
    source,
    eol: '\n' as const,
  };
  const syntax = parse(snapshot);
  const report = projectReport(syntax);
  return planAuthoringIntent(snapshot, syntax, report, {
    requestId: 'author-1',
    baseVersion: 1,
    targetId: target(report),
    operation: 'author',
    payload,
  });
}
const dataset = (report: ReturnType<typeof projectReport>) =>
  report.datasets[0]!.node.id;

/** Walk parsed source so a snapshot ID is proven to address real XML. */
function sourceNode(node: XmlNode, id: string): XmlNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = sourceNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Data targets come from the accepted Data snapshot: exactly one dataset with
 * that name, whose ID addresses real RDL source in its Data scope.
 */
function dataTarget(
  syntax: ReturnType<typeof parse>,
  projection: ReturnType<typeof projectReport>,
  name: string | null,
) {
  const root = syntax.root;
  assert.ok(root, 'report parses a root');
  const matches = projectNavigation(syntax, projection).data.nodes.filter(
    (node) => node.kind === 'dataset' && node.name === name,
  );
  assert.equal(
    matches.length,
    1,
    `one accepted Data dataset named ${name ?? '<unnamed>'}`,
  );
  const target = matches[0]!;
  assert.equal(target.parentId, null, 'a dataset is a top-level Data target');
  const parsed = sourceNode(root, target.id);
  assert.ok(parsed, `Data ID ${target.id} addresses a parsed source node`);
  assert.equal(parsed.expandedName.namespaceUri, RDL_2016);
  assert.equal(parsed.expandedName.localName, 'DataSet');
  assert.equal(
    parsed.attributes.find(
      (attribute) => attribute.expandedName.localName === 'Name',
    )?.value,
    name,
  );
  return target;
}

test('contextual structure targets build a bound table and reopen exact local definitions and scoped expressions', () => {
  let source = readFileSync(
    'tests/fixtures/datasets/blank.rdlc',
    'utf8',
  ).replace('</Report>', '<!--keep contextual authoring metadata--></Report>');
  const apply = (
    kind: 'report' | 'dataset' | 'table',
    name: string | null,
    payload: AuthoringIntent['payload'],
  ) => {
    const syntax = parse({
      uri: 'test:context',
      version: 1,
      source,
      eol: '\n',
    });
    const projection = projectReport(syntax);
    const unchanged = syntax.snapshot.source;
    const structure = projectStructure(syntax, projection);
    // Datasets and fields left the legacy Structure projection; Data owns them now.
    assert.ok(
      !structure.nodes.some(
        (node) => node.kind === 'dataset' || node.kind === 'field',
      ),
      'legacy Structure excludes data definitions',
    );
    const target =
      kind === 'dataset'
        ? dataTarget(syntax, projection, name)
        : structure.nodes.find(
            (node) => node.kind === kind && node.name === name,
          );
    assert.ok(target, `${kind} target ${name ?? '<report>'}`);
    assert.equal(syntax.snapshot.source, unchanged);
    const outcome = author(source, () => target.id, payload);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return;
    for (const patch of outcome.plan.patches)
      assert.ok(patch.start >= 0 && patch.end <= source.length);
    source = outcome.candidate;
    assert.ok(source.includes('<!--keep contextual authoring metadata-->'));
  };
  apply('report', null, { action: 'createDataset' });
  apply('dataset', 'DataSet1', { action: 'renameDataset', name: 'Sales' });
  for (const [name, type] of [
    ['Label', 'text'],
    ['Amount', 'decimal'],
    ['Date', 'date/time'],
  ] as const)
    apply('dataset', 'Sales', { action: 'createField', name, type });
  apply('report', null, { action: 'createTable', left: '0in', top: '0in' });
  apply('table', 'Table1', { action: 'renameTable', name: 'SalesTable' });
  apply('table', 'SalesTable', { action: 'setTableDataset', dataset: 'Sales' });
  apply('table', 'SalesTable', {
    action: 'addColumn',
    field: 'Label',
    width: '1in',
  });
  apply('table', 'SalesTable', {
    action: 'addColumn',
    field: 'Amount',
    width: '1in',
  });
  apply('table', 'SalesTable', {
    action: 'addGroup',
    name: 'ByLabel',
    expression: '=Fields!Label.Value',
  });
  apply('table', 'SalesTable', {
    action: 'addTotal',
    field: 'Amount',
    scope: 'ByLabel',
    column: '1',
  });
  const reopened = projectReport(
    parse({ uri: 'test:reopened', version: 20, source, eol: '\n' }),
  );
  assert.deepEqual(
    reopened.datasets[0]!.fields.map((field) => [field.name, field.type]),
    [
      ['Label', 'text'],
      ['Amount', 'decimal'],
      ['Date', 'date/time'],
    ],
  );
  assert.equal(reopened.tables[0]!.dataset, 'Sales');
  assert.deepEqual(reopened.tables[0]!.groups[0]!.expressions, [
    '=Fields!Label.Value',
  ]);
  assert.ok(
    source.includes('=Sum(Fields!Amount.Value, &quot;ByLabel&quot;)') ||
      source.includes('=Sum(Fields!Amount.Value, "ByLabel")'),
  );
  const unchanged = source;
  assert.equal(author(source, dataset, { action: 'deleteDataset' }).ok, false);
  assert.equal(source, unchanged);
});

test('dataset/field insertions preserve queries, calculated fields, metadata and namespace spelling', () => {
  const source = readFileSync('tests/fixtures/datasets/preserved.rdlc', 'utf8');
  const outcome = author(source, dataset, {
    action: 'createField',
    name: 'NewField',
    type: 'Int64',
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert.equal(outcome.plan.patches.length, 1);
  const patch = outcome.plan.patches[0]!;
  assert.equal(patch.start, patch.end);
  assert.equal(
    outcome.candidate.slice(0, patch.start),
    source.slice(0, patch.start),
  );
  assert.equal(
    outcome.candidate.slice(patch.start + patch.replacement.length),
    source.slice(patch.end),
  );
  const report = projectReport(
    parse({
      uri: 'test:new',
      source: outcome.candidate,
      version: 1,
      eol: '\n',
    }),
  );
  assert.equal(report.datasets[0]!.fields.at(-1)!.typeName, 'System.Int64');
  assert.equal(report.datasets[0]!.fields.at(-1)!.dataField, 'NewField');
});

test('referenced and opaque mutations are rejected atomically; unknown types are read-only', () => {
  const source = readFileSync('tests/fixtures/datasets/preserved.rdlc', 'utf8');
  const known = (r: ReturnType<typeof projectReport>) =>
    r.datasets[0]!.fields[0]!.node.id;
  const unknown = (r: ReturnType<typeof projectReport>) =>
    r.datasets[0]!.fields[2]!.node.id;
  for (const payload of [
    { action: 'renameField', name: 'Changed' },
    { action: 'deleteField' },
  ] as const)
    assert.equal(author(source, known, payload).ok, false);
  assert.equal(
    author(source, unknown, { action: 'setFieldType', type: 'text' }).ok,
    false,
  );
  assert.equal(
    author(
      source.replace('=Fields!Known.Value + 1', '=Code.Unknown()'),
      known,
      { action: 'renameField', name: 'Changed' },
    ).ok,
    false,
  );
});

test('blank report authoring covers page bounds, textbox deletion, all field types and group add/change/remove', () => {
  let source = readFileSync('tests/fixtures/datasets/blank.rdlc', 'utf8');
  const root = () =>
    parse({ uri: 'test:root', source, version: 1, eol: '\n' }).root!.id;
  const apply = (
    target: (report: ReturnType<typeof projectReport>) => string,
    payload: AuthoringIntent['payload'],
  ) => {
    const outcome = author(source, target, payload);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (outcome.ok) source = outcome.candidate;
  };
  apply(root, { action: 'createTextbox', left: '0in', top: '0in' });
  for (const [left, top] of [
    ['-1in', '0in'],
    ['1', '0in'],
    ['0in', 'NaNin'],
  ] as const)
    assert.equal(
      author(source, root, { action: 'createTextbox', left, top }).ok,
      false,
    );
  const box = (report: ReturnType<typeof projectReport>) =>
    report.textboxes[0]!.node.id;
  assert.equal(
    author(source, box, { action: 'deleteTextbox', confirm: '' }).ok,
    false,
  );
  apply(box, { action: 'deleteTextbox', confirm: 'delete-contained-content' });
  apply(root, { action: 'setPage', property: 'bodyHeight', value: '4in' });
  assert.equal(
    author(source, root, { action: 'setPage', property: 'left', value: '9in' })
      .ok,
    false,
  );
  apply(root, { action: 'createDataset' });
  const dataset = (report: ReturnType<typeof projectReport>) =>
    report.datasets[0]!.node.id;
  for (const [index, type] of [
    'text',
    'Boolean',
    'Int32',
    'Int64',
    'decimal',
    'double',
    'date/time',
  ].entries())
    apply(dataset, { action: 'createField', name: `Field${index}`, type });
  apply(root, { action: 'createTable', left: '1in', top: '1in' });
  const table = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.node.id;
  apply(table, { action: 'setTableDataset', dataset: 'DataSet1' });
  apply(table, {
    action: 'addGroup',
    name: 'ByField',
    expression: '=Fields!Field0.Value',
  });
  const group = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.groups[0]!.node.id;
  apply(group, {
    action: 'changeGroup',
    name: 'ByField2',
    expression: '=Fields!Field2.Value',
  });
  source = source.replace(
    '</Group><TablixMembers>',
    '</Group><!--preserved-group-sibling--><TablixMembers>',
  );
  apply(table, {
    action: 'addGroup',
    name: 'Nested',
    expression: '=Fields!Field2.Value',
  });
  apply(
    (report) =>
      report.tables[0]!.groups.find((group) => group.name === 'Nested')!.node
        .id,
    { action: 'removeGroup' },
  );
  apply(group, { action: 'removeGroup' });
  assert.ok(source.includes('<!--preserved-group-sibling-->'));
  apply(table, { action: 'deleteTable', confirm: 'delete-contained-content' });
  apply(dataset, { action: 'deleteDataset' });
  assert.ok(!source.includes('<DataSets>'));
  assert.ok(!source.includes('<Tablix'));
});

test('field metadata allocates a local noncolliding designer prefix without changing existing bindings', () => {
  const source = readFileSync(
    'tests/fixtures/datasets/local.rdlc',
    'utf8',
  ).replace(
    'xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner"',
    'xmlns:rd="urn:existing-binding"',
  );
  const outcome = author(source, dataset, {
    action: 'createField',
    name: 'NewDouble',
    type: 'double',
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert.ok(outcome.candidate.includes('xmlns:rd="urn:existing-binding"'));
  assert.ok(
    outcome.candidate.includes(
      '<rd1:TypeName xmlns:rd1="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">System.Double</rd1:TypeName>',
    ),
  );
  const patch = outcome.plan.patches[0]!;
  assert.equal(
    outcome.candidate.slice(0, patch.start),
    source.slice(0, patch.start),
  );
  assert.equal(
    outcome.candidate.slice(patch.start + patch.replacement.length),
    source.slice(patch.end),
  );
});

test('unreferenced dataset/field rename and removal retain untouched source exactly', () => {
  const source = readFileSync('tests/fixtures/datasets/local.rdlc', 'utf8');
  const renamed = author(source, dataset, {
    action: 'renameDataset',
    name: 'Renamed',
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  const removed = author(source, (r) => r.datasets[0]!.fields[0]!.node.id, {
    action: 'deleteField',
  });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  if (removed.ok) assert.ok(!removed.candidate.includes('Name="Label"'));
});

test('table columns, groups and scoped total rows are synchronized atomically', () => {
  const source = readFileSync('tests/fixtures/tables/grouped.rdlc', 'utf8');
  const table = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.node.id;
  for (const payload of [
    { action: 'setTableProperty', property: 'left', value: '0.5in' },
    { action: 'setColumnWidth', column: '0', width: '1.25in' },
    { action: 'setRowHeight', row: '0', height: '0.4in' },
    { action: 'addColumn', field: 'Amount', width: '0.5in' },
    { action: 'removeColumn', column: '0' },
    { action: 'addTotal', field: 'Amount', scope: 'Orders', column: '1' },
    { action: 'addTotal', field: 'Amount', scope: 'ByLabel', column: '1' },
    {
      action: 'changeTotal',
      field: 'Amount',
      scope: 'Orders',
      column: '0',
      row: '2',
    },
    {
      action: 'changeTotal',
      field: 'Amount',
      scope: 'ByLabel',
      column: '1',
      row: '2',
    },
    {
      action: 'changeTotal',
      field: 'Amount',
      scope: 'Orders',
      column: '1',
      row: '1',
    },
    { action: 'removeTotal', row: '2' },
  ] as const) {
    const outcome = author(source, table, payload);
    assert.equal(
      outcome.ok,
      true,
      `${payload.action}: ${JSON.stringify(outcome)}`,
    );
    if (outcome.ok) {
      const projected = projectReport(
        parse({
          uri: 'test:changed',
          source: outcome.candidate,
          version: 1,
          eol: '\n',
        }),
      );
      assert.equal(projected.tables[0]!.structural, true);
      assert.equal(projected.datasets[0]!.fields.length, 2);
    }
  }
  const group = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.groups[0]!.node.id;
  assert.equal(author(source, group, { action: 'removeGroup' }).ok, false);
  assert.equal(
    author(source, group, {
      action: 'changeGroup',
      name: 'Renamed',
      expression: '=Fields!Label.Value',
    }).ok,
    false,
  );
  assert.equal(
    author(
      source.replace('<CellContents>', '<CellContents><ColSpan>2</ColSpan>'),
      table,
      { action: 'addColumn', field: 'Amount', width: '1in' },
    ).ok,
    false,
  );
});

test('creation inserts one named item at the drop position and refusals leave text unchanged', () => {
  const blank = readFileSync('tests/fixtures/datasets/blank.rdlc', 'utf8');
  const root = (source: string) => () =>
    parse({ uri: 'test:root', source, version: 1, eol: '\n' }).root!.id;
  const created = author(blank, root(blank), {
    action: 'createTextbox',
    left: '1.5in',
    top: '12pt',
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  assert.deepEqual(created.created, { element: 'Textbox', name: 'Textbox1' });
  assert.equal(created.plan.patches.length, 1);
  const patch = created.plan.patches[0]!;
  assert.equal(
    created.candidate.slice(0, patch.start),
    blank.slice(0, patch.start),
  );
  assert.equal(
    created.candidate.slice(patch.start + patch.replacement.length),
    blank.slice(patch.end),
  );
  const box = projectReport(
    parse({ uri: 'test:c', source: created.candidate, version: 2, eol: '\n' }),
  ).textboxes[0]!;
  assert.deepEqual(
    [
      box.name,
      box.bounds.left,
      box.bounds.top,
      box.bounds.width,
      box.bounds.height,
    ],
    ['Textbox1', '1.5in', '12pt', '1in', '0.25in'],
  );
  // The next creation takes the lowest free number across report items.
  const second = author(created.candidate, root(created.candidate), {
    action: 'createTextbox',
    left: '0in',
    top: '0in',
  });
  assert.equal(second.ok && second.created?.name, 'Textbox2');
  for (const payload of [
    { action: 'createTextbox', left: '-1pt', top: '0in' },
    { action: 'createTable', left: '0in', top: 'abc' },
  ] as const) {
    const refused = author(blank, root(blank), payload);
    assert.equal(refused.ok, false);
  }
  const stale = author(blank, () => 'nope:1', {
    action: 'createTextbox',
    left: '0in',
    top: '0in',
  });
  assert.equal(stale.ok, false);
});

test('tables are created unbound and bound later with a detail group', () => {
  let source = readFileSync('tests/fixtures/datasets/blank.rdlc', 'utf8');
  const root = () =>
    parse({ uri: 'test:root', source, version: 1, eol: '\n' }).root!.id;
  const apply = (
    target: (report: ReturnType<typeof projectReport>) => string,
    payload: AuthoringIntent['payload'],
  ) => {
    const outcome = author(source, target, payload);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (outcome.ok) source = outcome.candidate;
    return outcome;
  };
  const made = apply(root, {
    action: 'createTable',
    left: '0.5in',
    top: '1in',
  });
  assert.deepEqual(made.ok && made.created, {
    element: 'Tablix',
    name: 'Table1',
  });
  let table = projectReport(
    parse({ uri: 'test:t', source, version: 2, eol: '\n' }),
  ).tables[0]!;
  assert.equal(table.structural, true, table.blockedReason ?? '');
  assert.equal(table.dataset, null);
  assert.equal(table.columns.length, 2);
  assert.equal(table.rows.length, 2);
  assert.deepEqual([table.bounds.left, table.bounds.top], ['0.5in', '1in']);
  assert.ok(!source.includes('DataSetName'));
  const id = (report: ReturnType<typeof projectReport>) =>
    report.tables[0]!.node.id;
  const before = source;
  assert.equal(
    author(source, id, { action: 'setTableDataset', dataset: 'Missing' }).ok,
    false,
  );
  assert.equal(
    author(source, id, { action: 'addColumn', field: 'X', width: '1in' }).ok,
    false,
  );
  assert.equal(source, before);
  apply(root, { action: 'createDataset' });
  apply((report) => report.datasets[0]!.node.id, {
    action: 'createField',
    name: 'Amount',
    type: 'decimal',
  });
  apply(id, { action: 'setTableDataset', dataset: 'DataSet1' });
  apply(id, { action: 'addColumn', field: 'Amount', width: '1in' });
  apply(id, { action: 'renameTable', name: 'Orders' });
  table = projectReport(parse({ uri: 'test:t', source, version: 9, eol: '\n' }))
    .tables[0]!;
  assert.equal(table.name, 'Orders');
  assert.equal(table.dataset, 'DataSet1');
  assert.equal(table.columns.length, 3);
  assert.equal(table.groups.length, 1);
});

test('opaque expressions block a dataset deletion only when they spell its name', () => {
  const blank = readFileSync('tests/fixtures/datasets/blank.rdlc', 'utf8');
  const root = (r: ReturnType<typeof projectReport>) =>
    r.textboxes.length >= 0 ? rootId : '';
  let rootId = '';
  const step = (
    source: string,
    target: (r: ReturnType<typeof projectReport>) => string,
    payload: AuthoringIntent['payload'],
  ) => {
    rootId = parse({ uri: 'test:o', source, version: 1, eol: '\n' }).root!.id;
    const outcome = author(source, target, payload);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    return outcome.ok ? outcome.candidate : source;
  };
  let source = step(blank, root, { action: 'createDataset' });
  source = step(source, root, {
    action: 'createTextbox',
    left: '0in',
    top: '0in',
  });
  const withText = (text: string) =>
    source
      .replace('<Value />', `<Value>${text}</Value>`)
      .replace('<Value></Value>', `<Value>${text}</Value>`);
  const unrelated = withText('=Code.Format(Now())');
  assert.notEqual(unrelated, source, 'opaque expression inserted');
  const deleted = author(unrelated, (r) => r.datasets[0]!.node.id, {
    action: 'deleteDataset',
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  const mentioning = withText('=Code.Lookup(&quot;DataSet1&quot;)');
  const refused = author(mentioning, (r) => r.datasets[0]!.node.id, {
    action: 'deleteDataset',
  });
  assert.equal(refused.ok, false);
  assert.equal(
    !refused.ok && refused.diagnostics[0]!.code,
    'REFERENCES_OPAQUE',
  );
});

/** Sorted namespace declarations: an accepted edit may never add, drop or rebind one. */
const namespaceDeclarations = (source: string): string[] =>
  (source.match(/xmlns(?::[\w.-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g) ?? []).sort();

/** The smallest source element containing every patch, resolved from our own parse. */
function editContainer(
  root: XmlNode,
  patches: readonly { readonly start: number; readonly end: number }[],
): { readonly node: XmlNode; readonly parent: XmlNode | null } {
  const nodes: XmlNode[] = [];
  const parents = new Map<string, XmlNode | null>([[root.id, null]]);
  const walk = (node: XmlNode): void => {
    nodes.push(node);
    for (const child of node.children) {
      parents.set(child.id, node);
      walk(child);
    }
  };
  walk(root);
  // Ranges are half-open: an empty insertion sits strictly inside its container.
  const covers = (node: XmlNode, patch: { start: number; end: number }) =>
    patch.start < patch.end
      ? patch.start >= node.range.start && patch.end <= node.range.end
      : patch.start > node.range.start && patch.start < node.range.end;
  const covering = nodes.filter((node) =>
    patches.every((patch) => covers(node, patch)),
  );
  assert.ok(covering.length > 0, 'the planned patch lies inside parsed source');
  const node = covering.reduce((best, candidate) =>
    candidate.range.end - candidate.range.start <
    best.range.end - best.range.start
      ? candidate
      : best,
  );
  return { node, parent: parents.get(node.id) ?? null };
}

/**
 * Every manifest-listed report keeps all source outside its one edited container
 * byte-exact, with unrelated parent content and namespace declarations untouched;
 * a capable report still refuses an invalid operation, and source-only or malformed
 * reports refuse authoring outright instead of growing a candidate.
 */
test('manifest reports preserve source outside the edit container, unrelated parent content and namespaces', () => {
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/manifest.json', 'utf8'),
  ) as { fixtures: { readonly id: string; readonly path: string }[] };
  assert.ok(
    manifest.fixtures.length >= 12,
    `manifest lists ${manifest.fixtures.length} reports`,
  );
  const sources = new Map<string, string>();
  let preserved = 0;
  let refused = 0;
  let uncertain = 0;
  for (const fixture of manifest.fixtures) {
    const path = resolve('tests/fixtures', fixture.path);
    const source = readFileSync(path, 'utf8');
    sources.set(path, source);
    const snapshot = {
      uri: `fixture:${fixture.id}`,
      version: 1,
      source,
      eol: '\n' as const,
    };
    const syntax = parse(snapshot);
    const projection = projectReport(syntax);
    assert.equal(syntax.snapshot.source, source, fixture.id);

    if (projection.status !== 'editable') {
      // Uncertainty refuses: no candidate, no plan, no compensating edit.
      const outcome = planAuthoringIntent(snapshot, syntax, projection, {
        requestId: `uncertain-${fixture.id}`,
        baseVersion: 1,
        targetId: syntax.root?.id ?? 'absent:1',
        operation: 'author',
        payload: { action: 'createTextbox', left: '0in', top: '0in' },
      });
      assert.ok(!outcome.ok, `${fixture.id}: source-only report refuses`);
      assert.ok(outcome.diagnostics.length > 0, fixture.id);
      assert.deepEqual(
        Object.keys(outcome).sort(),
        ['diagnostics', 'ok'],
        `${fixture.id}: refusal carries no candidate`,
      );
      uncertain++;
      continue;
    }
    const root = syntax.root;
    assert.ok(root, `${fixture.id}: editable report parses a root`);
    const author = (payload: AuthoringIntent['payload']) =>
      planAuthoringIntent(snapshot, syntax, projection, {
        requestId: `preserve-${fixture.id}`,
        baseVersion: 1,
        targetId: root.id,
        operation: 'author',
        payload,
      });

    const created = author({
      action: 'createTextbox',
      left: '0in',
      top: '0in',
    });
    assert.ok(created.ok, `${fixture.id}: ${JSON.stringify(created)}`);
    if (!created.ok) continue;
    assert.ok(created.changed, `${fixture.id}: creation changed the source`);
    const candidate = created.candidate;
    const patches = [...created.plan.patches].sort((a, b) => a.start - b.start);
    assert.ok(patches.length > 0, `${fixture.id}: creation plans a patch`);
    let covered = 0;
    for (const patch of patches) {
      assert.ok(
        patch.start >= covered && patch.end <= source.length,
        `${fixture.id}: sorted non-overlapping patches inside the source`,
      );
      covered = patch.end;
    }

    // Independent expected footprint: only our own edit container may differ.
    const { node: container, parent } = editContainer(root, patches);
    const delta = candidate.length - source.length;
    assert.equal(
      candidate.slice(0, container.range.start),
      source.slice(0, container.range.start),
      `${fixture.id}: bytes before the edited container`,
    );
    assert.equal(
      candidate.slice(container.range.end + delta),
      source.slice(container.range.end),
      `${fixture.id}: bytes after the edited container`,
    );
    for (const patch of patches)
      assert.ok(
        patch.start >= container.range.start &&
          patch.end <= container.range.end,
        `${fixture.id}: patch stays inside the edited container`,
      );
    assert.deepEqual(
      namespaceDeclarations(candidate),
      namespaceDeclarations(source),
      `${fixture.id}: namespace declarations`,
    );
    assert.ok(parent, `${fixture.id}: the edited container has a parent`);
    const unrelated = [
      ...container.children,
      ...parent.children.filter((child) => child.id !== container.id),
    ];
    assert.ok(
      unrelated.some((node) => node.range.end > node.range.start),
      `${fixture.id}: report has unrelated parent content`,
    );
    for (const node of unrelated) {
      const untouched = source.slice(node.range.start, node.range.end);
      if (!untouched) continue;
      assert.ok(
        candidate.includes(untouched),
        `${fixture.id}: unrelated ${node.expandedName.localName} stays byte-exact`,
      );
    }

    // The same capable fixture refuses an invalid operation with an empty footprint.
    const invalid = author({
      action: 'createTextbox',
      left: '-1in',
      top: '0in',
    });
    assert.ok(
      !invalid.ok,
      `${fixture.id}: capable report refuses a negative drop position`,
    );
    if (!invalid.ok) {
      assert.ok(invalid.diagnostics.length > 0, fixture.id);
      assert.deepEqual(
        Object.keys(invalid).sort(),
        ['diagnostics', 'ok'],
        `${fixture.id}: refusal carries no plan`,
      );
    }
    preserved++;
    refused++;
  }
  assert.ok(
    preserved >= 12,
    `${preserved} manifest-listed reports preserved exactly`,
  );
  assert.equal(
    refused,
    preserved,
    'every capable report also refused an invalid operation',
  );
  assert.ok(
    uncertain >= 1,
    `${uncertain} source-only reports refuse authoring`,
  );
  for (const [path, source] of sources)
    assert.equal(
      readFileSync(path, 'utf8'),
      source,
      `${path}: fixture source untouched`,
    );
});
