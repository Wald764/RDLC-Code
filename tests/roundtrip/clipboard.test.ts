import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SizeUnit } from '@rdlc/report-model/geometry';
import { toPoints } from '@rdlc/report-model/geometry';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { acceptedGeometry } from '@rdlc/validation/layout';
import {
  buildCapture,
  planCut,
  planPaste,
} from '../../apps/vscode-extension/src/clipboard.js';

const fixture = (name: string) =>
  readFileSync(`tests/fixtures/interactive/${name}.rdlc`, 'utf8');
const dependencies = fixture('clipboard-dependencies');

function load(source: string, version = 1) {
  const snapshot = { uri: 'test:clip', version, source, eol: '\n' as const };
  const syntax = parse(snapshot);
  return { snapshot, syntax, projection: projectReport(syntax) };
}
function ids(current: ReturnType<typeof load>, names: readonly string[]) {
  return names.map(
    (name) =>
      (
        current.projection.tables.find((t) => t.name === name) ??
        current.projection.textboxes.find((t) => t.name === name)
      )?.node.id ?? `missing:${name}`,
  );
}
function copy(source: string, names: readonly string[]) {
  const built = buildCapture(load(source), ids(load(source), names));
  assert.ok(built.ok, JSON.stringify(!built.ok && built.diagnostics));
  return built.capture;
}
/** Paste and prove outside-footprint equality plus exact single-step restoration. */
function paste(
  destination: string,
  capture: ReturnType<typeof copy>,
  offset = 10,
  unit: SizeUnit = 'pt',
) {
  const current = load(destination);
  const planned = planPaste(current, capture, offset, unit);
  assert.ok(planned.ok, JSON.stringify(!planned.ok && planned.diagnostics));
  const [patch] = planned.plan.patches;
  assert.equal(planned.plan.patches.length, 1, 'one insertion patch');
  assert.equal(
    planned.candidate.slice(0, patch!.start) +
      planned.candidate.slice(patch!.start + patch!.replacement.length),
    destination.slice(0, patch!.start) + destination.slice(patch!.end),
    'outside-footprint text is identical',
  );
  // Undo of the single native edit is the exact inverse patch.
  assert.equal(
    planned.candidate.slice(0, patch!.start) +
      patch!.expected +
      planned.candidate.slice(patch!.start + patch!.replacement.length),
    destination,
  );
  const next = load(planned.candidate, 2);
  const roots = planned.starts.map(
    (start) =>
      next.projection.tables.find((t) => t.node.range.start === start) ??
      next.projection.textboxes.find((t) => t.node.range.start === start)!,
  );
  return { ...planned, next, roots, patch: patch! };
}
const text = (
  source: string,
  item: { node: { range: { start: number; end: number } } },
) => source.slice(item.node.range.start, item.node.range.end);
const geometry = (
  current: ReturnType<typeof load>,
  item: ReturnType<typeof paste>['roots'][number],
) => acceptedGeometry(current.projection, item, 'columns' in item);

test('copies complete subtrees in source order with internal remapping and literal annotations', () => {
  const capture = copy(dependencies, [
    'ExternalReference',
    'Title',
    'InternalReference',
  ]);
  assert.deepEqual(
    capture.roots.map((r) => r.identities[0]!.name),
    ['Title', 'InternalReference', 'ExternalReference'],
    'source order, not selection order',
  );
  assert.ok(Object.isFrozen(capture.roots[0]), 'immutable host snapshot');
  const first = paste(dependencies, capture);
  assert.deepEqual(
    first.roots.map((r) => r.name),
    ['Title1', 'InternalReference1', 'ExternalReference1'],
  );
  const [title, internal, external] =
    first.roots as typeof first.next.projection.textboxes;
  assert.equal(internal!.value!.text, '=ReportItems!Title1.Value');
  assert.equal(
    external!.value!.text,
    '=ReportItems!Outside.Value',
    'external retained',
  );
  assert.match(
    text(first.candidate, title!),
    /<x:Opaque keep="1"><!\[CDATA\[ReportItems!Title\.Value\]\]> &amp; literal annotation<\/x:Opaque>/,
    'annotation preserved byte-for-byte and never rewritten',
  );
  assert.equal(title!.bounds.left, '22pt');
  assert.equal(title!.bounds.top, '22pt');
  assert.equal(title!.bounds.width, '144pt', 'explicit size lexeme unchanged');
  // Second paste of the same generation offsets 20pt and allocates fresh names.
  const second = paste(first.candidate, capture, 20);
  assert.deepEqual(
    second.roots.map((r) => r.name),
    ['Title2', 'InternalReference2', 'ExternalReference2'],
  );
  assert.equal(second.roots[0]!.bounds.left, '32pt');
  assert.equal(
    (second.roots[1] as (typeof second.next.projection.textboxes)[number])
      .value!.text,
    '=ReportItems!Title2.Value',
  );
});

test('a grouped table copy renames cells, groups and group scopes but retains its dataset', () => {
  const mixed = fixture('mixed');
  const result = paste(mixed, copy(mixed, ['OrdersTable']));
  const table = result
    .roots[0] as (typeof result.next.projection.tables)[number];
  assert.equal(table.name, 'OrdersTable1');
  assert.ok(table.structural, table.blockedReason ?? '');
  assert.equal(table.dataset, 'Orders');
  assert.deepEqual(
    table.groups.map((g) => g.name),
    ['ByLabel1', 'Details1'],
  );
  const cells = table.rows.flatMap((row) =>
    row.cells.map((cell) => cell.textbox!),
  );
  assert.deepEqual(
    cells.map((cell) => cell.name),
    [
      'LabelCell1',
      'AmountCell1',
      'GroupLabel1',
      'GroupAmount1',
      'TotalLabel1',
      'TotalAmount1',
    ],
  );
  assert.equal(cells[3]!.value!.text, '=Sum(Fields!Amount.Value, "ByLabel1")');
  assert.equal(cells[5]!.value!.text, '=Sum(Fields!Amount.Value, "Orders")');
  const bounds = geometry(result.next, table);
  assert.equal(bounds.width.points, 144);
  assert.equal(bounds.left.points, 22);
  assert.ok(
    Math.abs(bounds.top.points! - 82) <= 0.01,
    'unit-preserving 1in + 10pt',
  );
});

test('maps operands through entities, CDATA and ToggleItem; Unicode names fall back safely', () => {
  const entity = paste(
    dependencies,
    copy(dependencies, ['Title', 'EntityReference']),
  );
  const copied = text(entity.candidate, entity.roots[1]!);
  assert.match(copied, /<ToggleItem>Title1<\/ToggleItem>/);
  assert.match(copied, /=ReportItems!Title1\.Value &amp; "!"/);
  const unicode = paste(
    dependencies,
    copy(dependencies, ['Café', 'Référence']),
  );
  assert.deepEqual(
    unicode.roots.map((r) => r.name),
    ['Textbox', 'Textbox1'],
  );
  assert.match(
    text(unicode.candidate, unicode.roots[1]!),
    /<!\[CDATA\[=ReportItems!Textbox\.Value & "<cdata>"\]\]>/,
  );
  // Alone, the ToggleItem target is an external textbox that survives.
  const alone = paste(dependencies, copy(dependencies, ['EntityReference']));
  assert.match(
    text(alone.candidate, alone.roots[0]!),
    /<ToggleItem>Title<\/ToggleItem>/,
  );
});

test('namespace closure declares only missing bindings and preserves rebinding', () => {
  const namespaces = fixture('clipboard-namespaces');
  const result = paste(dependencies, copy(namespaces, ['Prefixed', 'Rebound']));
  const [prefixed, rebound] = result.roots.map((r) =>
    text(result.candidate, r),
  );
  assert.match(
    prefixed!,
    /^<r:Textbox xmlns:r="http:\/\/schemas\.microsoft\.com\/sqlserver\/reporting\/2016\/01\/reportdefinition" Name="Prefixed">/,
  );
  assert.match(
    prefixed!,
    /<e:Opaque xmlns:e="urn:rdlc-code:extension" keep='1'>local <!\[CDATA\[binding\]\]><\/e:Opaque>/,
  );
  assert.ok(
    rebound!.startsWith(
      '<Textbox xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" Name="Rebound">',
    ),
  );
  assert.equal(
    (result.roots[1] as (typeof result.next.projection.textboxes)[number])
      .value!.text,
    '=ReportItems!Prefixed.Value',
    'free names are kept across documents',
  );
  // Default-namespace content into a prefix-only report gains default and x bindings.
  const back = paste(namespaces, copy(dependencies, ['Title']));
  const title = text(back.candidate, back.roots[0]!);
  assert.match(
    title,
    /^<Textbox xmlns="http:\/\/schemas\.microsoft\.com\/sqlserver\/reporting\/2016\/01\/reportdefinition" xmlns:x="urn:rdlc-code:extension" Name="Title">/,
  );
  assert.equal(back.roots[0]!.node.expandedName.localName, 'Textbox');
});

test('missing and self-closing destination ReportItems reuse structural insertion', () => {
  const namespaces = fixture('clipboard-namespaces');
  const capture = copy(dependencies, ['Outside']);
  const items = /<r:ReportItems>[\s\S]*<\/r:ReportItems>/;
  for (const destination of [
    namespaces.replace(items, '<r:ReportItems/>'),
    namespaces.replace(items, ''),
  ]) {
    const result = paste(destination, capture);
    assert.equal(result.roots[0]!.name, 'Outside');
    assert.equal((result.roots[0] as { context?: string }).context, 'body');
  }
});

test('captured physical sizes survive bodies of different sizes; materialize only when needed', () => {
  const optional = fixture('optional-geometry');
  const capture = copy(optional, [
    'ImplicitBoth',
    'ImplicitWidth',
    'ImplicitHeight',
    'DefaultPosition',
  ]);
  const captured = capture.roots.map((r) => r.bounds);
  const check = (destination: string, offset: number, unit: SizeUnit) => {
    const result = paste(destination, capture, offset, unit);
    result.roots.forEach((root, i) => {
      const actual = geometry(result.next, root);
      assert.ok(
        Math.abs(actual.width.points! - captured[i]!.width) <= 0.01,
        root.name!,
      );
      assert.ok(
        Math.abs(actual.height.points! - captured[i]!.height) <= 0.01,
        root.name!,
      );
      assert.ok(
        Math.abs(actual.left.points! - captured[i]!.left - offset) <= 0.01,
      );
    });
    return result;
  };
  // Same body: moving changes derivation, so derived sizes materialize in the display unit.
  const same = check(optional, 10, 'mm');
  const box = (r: (typeof same.roots)[number]) =>
    r as (typeof same.next.projection.textboxes)[number];
  assert.match(box(same.roots[0]!).bounds.width!, /mm$/);
  assert.equal(
    box(same.roots[1]!).bounds.height,
    '12.7mm',
    'explicit lexeme kept',
  );
  assert.equal(
    box(same.roots[2]!).bounds.width,
    '2.00in',
    'explicit lexeme kept',
  );
  assert.equal(
    box(same.roots[3]!).bounds.left,
    '10mm'.replace('10mm', box(same.roots[3]!).bounds.left!),
  );
  assert.ok(
    Math.abs(toPoints(box(same.roots[3]!).bounds.left)! - 10) <= 0.01,
    'absent Left inserted',
  );
  assert.equal(check(optional, 20, 'pt').roots.length, 4, 'repeated paste');
  check(fixture('clipboard-namespaces'), 10, 'pt'); // narrower/shorter body
  check(dependencies, 10, 'cm'); // wider body
  // A body where derivation still matches leaves absent dimensions absent.
  const matching = optional
    .replace('<Width>6in</Width><Page/>', '<Width>442pt</Width><Page/>')
    .replace('<Height>4in</Height></Body>', '<Height>298pt</Height></Body>');
  const kept = check(matching, 10, 'pt');
  assert.equal(box(kept.roots[0]!).bounds.width, null);
  assert.equal(box(kept.roots[0]!).bounds.height, null);
});

test('refuses unclassified metadata and unprovable dependencies without changes', () => {
  const opaque = fixture('clipboard-opaque');
  const current = load(opaque);
  const refusal = (name: string) => {
    const built = buildCapture(current, ids(current, [name]));
    return built.ok ? 'OK' : built.diagnostics[0]!.code;
  };
  assert.equal(refusal('Plain'), 'OK');
  for (const [name, code] of [
    ['DesignerName', 'DEPENDENCY_UNPROVEN'],
    ['Targeted', 'DEPENDENCY_UNPROVEN'],
    ['Instruction', 'METADATA_UNCLASSIFIED'],
    ['Dynamic', 'DEPENDENCY_UNPROVEN'],
    ['CustomCode', 'DEPENDENCY_UNPROVEN'],
    ['UnscopedField', 'DEPENDENCY_UNPROVEN'],
    ['UntypedField', 'DATASET_UNPROVEN'],
    ['CalculatedField', 'DATASET_UNPROVEN'],
    ['ForeignScope', 'DEPENDENCY_UNPROVEN'],
  ])
    assert.equal(refusal(name!), code, name);
  // A table cell is not an independently copyable root.
  const mixed = load(fixture('mixed'));
  const cell = mixed.projection.textboxes.find((t) => t.name === 'LabelCell')!;
  assert.equal(
    (
      buildCapture(mixed, [cell.node.id]) as unknown as {
        diagnostics: { code: string }[];
      }
    ).diagnostics[0]!.code,
    'SELECTION_UNSUPPORTED',
  );
});

test('cross-document reuse requires compatible datasets and external targets', () => {
  const total = copy(dependencies, ['DatasetTotal']);
  assert.deepEqual(total.datasets, [
    {
      name: 'Orders',
      fields: [
        { name: 'Amount', dataField: 'Amount', typeName: 'System.Decimal' },
      ],
    },
  ]);
  // Positive: the mixed report declares an identical Orders.Amount.
  const mixed = fixture('mixed');
  assert.equal(paste(mixed, total).roots[0]!.name, 'DatasetTotal');
  const code = (destination: string, capture = total) => {
    const planned = planPaste(load(destination), capture, 10, 'pt');
    return planned.ok ? 'OK' : planned.diagnostics[0]!.code;
  };
  assert.equal(code(fixture('clipboard-namespaces')), 'DATASET_MISSING');
  assert.equal(
    code(mixed.replace('System.Decimal', 'System.Int32')),
    'DATASET_INCOMPATIBLE',
  );
  assert.equal(
    code(mixed, copy(dependencies, ['ExternalReference'])),
    'REFERENCE_UNRESOLVED',
  );
});

test('cut removes exactly the complete set after whole-set dependency checks', () => {
  const current = load(dependencies);
  const run = (names: string[]) => {
    const built = buildCapture(current, ids(current, names));
    assert.ok(built.ok);
    return planCut(current, built.capture, built.nodes);
  };
  const refused = run(['Title', 'InternalReference']);
  assert.equal(refused.ok, false);
  const cut = run(['InternalReference', 'ExternalReference']);
  assert.ok(cut.ok);
  let expected = dependencies;
  for (const name of ['ExternalReference', 'InternalReference']) {
    const node = current.projection.textboxes.find(
      (t) => t.name === name,
    )!.node;
    expected =
      expected.slice(0, node.range.start) + expected.slice(node.range.end);
  }
  assert.equal(cut.candidate, expected);
});
