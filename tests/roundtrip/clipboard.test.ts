import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import type { SizeUnit } from '@rdlc/report-model/geometry';
import { toPoints } from '@rdlc/report-model/geometry';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { captureBudget } from '@rdlc/report-model/clipboard';
import { rawImageLimit } from '@rdlc/report-model/images';
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
        current.projection.textboxes.find((t) => t.name === name) ??
        current.projection.images.find((t) => t.name === name)
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
      next.projection.textboxes.find((t) => t.node.range.start === start) ??
      next.projection.images.find((t) => t.node.range.start === start)!,
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
    ['Textbox1', 'Textbox2'],
  );
  assert.match(
    text(unicode.candidate, unicode.roots[1]!),
    /<!\[CDATA\[=ReportItems!Textbox1\.Value & "<cdata>"\]\]>/,
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

// ---- Image items and their embedded definitions (feature 006, US2) ----

const images = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}.rdlc`, 'utf8');
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const authored = images('authored');
const definitionNames = (source: string) =>
  [...source.matchAll(/<EmbeddedImage Name="([^"]*)"/g)].map((m) => m[1]);
const embeddedImages = (source: string) =>
  /<EmbeddedImages>[\s\S]*?<\/EmbeddedImages>/.exec(source)?.[0] ?? '';

/** Apply one plan and prove the exact inverse of every patch restores the original. */
function applyAndInvert(source: string, plan: ReturnType<typeof planPaste>) {
  assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.diagnostics));
  let restored = plan.candidate;
  let delta = 0;
  const spans = plan.plan.patches.map((patch) => {
    const start = patch.start + delta;
    delta += patch.replacement.length - (patch.end - patch.start);
    return { start, end: start + patch.replacement.length, patch };
  });
  for (const { start, end, patch } of spans.reverse())
    restored = restored.slice(0, start) + patch.expected + restored.slice(end);
  assert.equal(restored, source, 'the inverse patches restore the report');
  return load(plan.candidate, 2);
}

test('copying images captures each referenced definition once with its exact source and hash', () => {
  const current = load(authored);
  const logo = readFileSync('tests/fixtures/images/pictures/logo.png');
  const capture = copy(authored, ['LogoAutoSize', 'LogoFit', 'PhotoClip']);
  assert.deepEqual(
    capture.images.map((entry) => [entry.name, entry.mime]),
    [
      ['logo', 'image/png'],
      ['photo', 'image/jpeg'],
    ],
  );
  assert.equal(capture.images[0]!.hash, sha256(logo));
  for (const entry of capture.images) {
    const definition = current.projection.embeddedImages.find(
      (d) => d.name === entry.name,
    )!;
    assert.equal(
      entry.xml,
      authored.slice(definition.node.range.start, definition.node.range.end),
    );
    assert.equal(
      entry.xml.slice(entry.nameRange.start, entry.nameRange.end),
      entry.name,
    );
  }
  assert.ok(
    capture.size >= capture.images.reduce((n, e) => n + e.xml.length, 0),
    'requirements count toward the capture size',
  );
  assert.deepEqual(
    copy(authored, ['LogoFit']).images.map((e) => e.name),
    ['logo'],
  );
  // A foreign attribute on the item keeps the existing textbox-precedent refusal.
  const tagged = buildCapture(current, ids(current, ['Tagged']));
  assert.equal(
    !tagged.ok && tagged.diagnostics[0]!.code,
    'DEPENDENCY_UNPROVEN',
  );
});

test('a same-report paste or duplicate writes no definition and keeps the same Value', () => {
  const capture = copy(authored, ['LogoAutoSize', 'PhotoClip']);
  const pasted = paste(authored, capture);
  assert.equal(pasted.plan.patches.length, 1);
  assert.equal(embeddedImages(pasted.candidate), embeddedImages(authored));
  assert.deepEqual(definitionNames(pasted.candidate), [
    'logo',
    'photo',
    'unused',
  ]);
  assert.equal(pasted.roots.length, 2);
  const next = pasted.next.projection;
  assert.equal(next.images.length, 7);
  assert.deepEqual(
    next.embeddedImages.map((d) => [d.name, d.references.length]),
    [
      ['logo', 4],
      ['photo', 3],
      ['unused', 0],
    ],
  );
  const names = next.images.map((i) => i.name);
  assert.equal(new Set(names).size, names.length, 'item names stay unique');
  const copies = next.images.slice(-2);
  assert.deepEqual(
    copies.map((i) => [
      i.value?.kind === 'constant' && i.value.text,
      i.definition,
    ]),
    [
      ['logo', 'logo'],
      ['photo', 'photo'],
    ],
  );
  assert.ok(copies.every((i) => i.capabilities.includes('image')));
  // Duplicate is the same path with the standard 10 pt offset.
  const duplicate = paste(authored, copy(authored, ['PhotoClip']), 10);
  assert.equal(duplicate.plan.patches.length, 1);
  assert.equal(embeddedImages(duplicate.candidate), embeddedImages(authored));
});

test('a cross-report paste inserts the definition once, in the same plan', () => {
  const blank = images('blank');
  const capture = copy(authored, ['LogoAutoSize', 'LogoFit']);
  assert.equal(capture.images.length, 1, 'two items, one definition');
  const planned = planPaste(load(blank), capture, 10, 'pt');
  const next = applyAndInvert(blank, planned);
  assert.ok(planned.ok);
  assert.equal(planned.plan.patches.length, 2, 'items and one definition');
  assert.deepEqual(definitionNames(planned.candidate), ['logo']);
  assert.match(
    planned.candidate,
    /<\/ReportSections>\s*<EmbeddedImages><EmbeddedImage Name="logo">/,
  );
  const [definition] = next.projection.embeddedImages;
  assert.equal(definition!.displayable, true);
  assert.equal(definition!.name, 'logo');
  assert.deepEqual(definition!.references, ['LogoAutoSize', 'LogoFit']);
  const logo = readFileSync('tests/fixtures/images/pictures/logo.png');
  assert.equal(
    sha256(
      Buffer.from(
        /<ImageData>([^<]*)<\/ImageData>/.exec(planned.candidate)![1]!,
        'base64',
      ),
    ),
    sha256(logo),
    'the payload arrives byte for byte',
  );
  // Each reported start offset is an inserted Image element.
  assert.deepEqual(
    planned.starts.map(
      (start) =>
        next.projection.images.find((i) => i.node.range.start === start)?.name,
    ),
    ['LogoAutoSize', 'LogoFit'],
  );
  assert.deepEqual(
    next.projection.images.map((i) => i.reason),
    [null, null],
  );
  // The report text outside the footprint is untouched.
  assert.ok(
    planned.candidate.includes(blank.slice(0, blank.indexOf('<Body>'))),
  );
});

test('candidate offsets stay exact when EmbeddedImages precedes the body', () => {
  const blank = images('blank').replace(
    '<ReportSections>',
    '<EmbeddedImages><EmbeddedImage Name="other"><MIMEType>image/png</MIMEType><ImageData>AAAA</ImageData></EmbeddedImage></EmbeddedImages><ReportSections>',
  );
  const planned = planPaste(load(blank), copy(authored, ['LogoFit']), 10, 'pt');
  const next = applyAndInvert(blank, planned);
  assert.ok(planned.ok);
  assert.equal(planned.plan.patches.length, 2);
  assert.deepEqual(definitionNames(planned.candidate), ['other', 'logo']);
  assert.deepEqual(
    planned.starts.map(
      (start) =>
        next.projection.images.find((i) => i.node.range.start === start)?.name,
    ),
    ['LogoFit'],
  );
});

test('a repeated paste into the same report reuses the carried definition', () => {
  const blank = images('blank');
  const capture = copy(authored, ['LogoFit']);
  const first = planPaste(load(blank), capture, 10, 'pt');
  assert.ok(first.ok);
  const again = planPaste(load(first.candidate, 2), capture, 20, 'pt');
  assert.ok(again.ok, JSON.stringify(!again.ok && again.diagnostics));
  assert.equal(again.plan.patches.length, 1);
  assert.deepEqual(definitionNames(again.candidate), ['logo']);
});

test('identical content under another name is reused and the Value follows it', () => {
  const logo = load(authored).projection.embeddedImages[0]!;
  const definition = authored
    .slice(logo.node.range.start, logo.node.range.end)
    .replace('Name="logo"', 'Name="brand"');
  const destination = images('blank').replace(
    '</Report>',
    `<EmbeddedImages>${definition}</EmbeddedImages></Report>`,
  );
  const planned = planPaste(
    load(destination),
    copy(authored, ['LogoFit']),
    10,
    'pt',
  );
  const next = applyAndInvert(destination, planned);
  assert.ok(planned.ok);
  assert.equal(planned.plan.patches.length, 1);
  assert.deepEqual(definitionNames(planned.candidate), ['brand']);
  assert.equal(
    next.projection.images[0]!.value?.kind === 'constant' &&
      next.projection.images[0]!.value.text,
    'brand',
  );
});

test('a name collision with different content renames the definition and rewrites the Value', () => {
  const collision = images('collision');
  const capture = copy(authored, ['LogoAutoSize', 'LogoFit', 'PhotoClip']);
  const planned = planPaste(load(collision), capture, 10, 'pt');
  const next = applyAndInvert(collision, planned);
  assert.ok(planned.ok);
  assert.equal(planned.plan.patches.length, 2);
  assert.deepEqual(definitionNames(planned.candidate), [
    'logo',
    'logo_1',
    'photo',
  ]);
  assert.ok(
    planned.candidate.includes(
      embeddedImages(collision).replace('</EmbeddedImages>', ''),
    ),
    'the existing logo definition is byte-identical',
  );
  const byName = new Map(next.projection.images.map((i) => [i.name, i]));
  const value = (name: string) => {
    const v = byName.get(name)?.value;
    return v?.kind === 'constant' ? v.text : null;
  };
  assert.equal(value('Existing'), 'logo', 'the existing item is untouched');
  assert.equal(value('LogoAutoSize'), 'logo_1');
  assert.equal(value('LogoFit'), 'logo_1');
  assert.equal(value('PhotoClip'), 'photo');
  assert.ok(
    [...byName.values()].every(
      (i) => i.definition !== null && i.reason === null,
    ),
    'no pasted item is left dangling',
  );
  // Only the pasted constants changed relative to the captured source.
  const pasted = planned.candidate.slice(
    next.projection.images.find((i) => i.name === 'LogoAutoSize')!.node.range
      .start,
    next.projection.images.find((i) => i.name === 'LogoAutoSize')!.node.range
      .end,
  );
  assert.ok(pasted.includes('<Value>logo_1</Value>'));
  assert.ok(!pasted.includes('<Value>logo</Value>'));
});

test('an item whose definition is missing still pastes as geometry-only without inventing one', () => {
  const preserved = images('preserved');
  const capture = copy(preserved, ['GhostPicture', 'BrokenPicture']);
  assert.deepEqual(
    capture.images.map((entry) => entry.name),
    ['broken'],
    'only the definition that exists is carried',
  );
  const blank = images('blank');
  const planned = planPaste(
    load(blank),
    copy(preserved, ['GhostPicture']),
    10,
    'pt',
  );
  const next = applyAndInvert(blank, planned);
  assert.ok(planned.ok);
  assert.equal(planned.plan.patches.length, 1);
  assert.deepEqual(definitionNames(planned.candidate), []);
  assert.deepEqual(
    next.projection.images.map((i) => [
      i.reason,
      i.definition,
      i.capabilities.includes('image'),
      i.capabilities.includes('left'),
    ]),
    [['reference-missing', null, false, true]],
  );
});

test('non-displayable definitions travel with their items and stay non-displayable', () => {
  const preserved = images('preserved');
  const source = load(preserved);
  const cases = [
    ['GifPicture', 'spinner', 'format-unsupported'],
    ['BmpPicture', 'bitmap', 'format-unsupported'],
    ['LegacyPngPicture', 'legacy', 'mime-mismatch'],
    ['BrokenPicture', 'broken', 'data-invalid'],
  ] as const;
  const blank = images('blank');
  for (const [item, definition, reason] of cases) {
    const capture = copy(preserved, [item]);
    const [required] = capture.images;
    assert.equal(required?.name, definition);
    assert.equal(required?.hash, null, 'no picture hash without a picture');
    assert.match(required!.identity, /^xml:[0-9a-f]{64}$/);
    const planned = planPaste(load(blank), capture, 10, 'pt');
    const next = applyAndInvert(blank, planned);
    assert.ok(planned.ok);
    assert.equal(planned.plan.patches.length, 2, item);
    assert.deepEqual(definitionNames(planned.candidate), [definition]);
    const [carried] = next.projection.embeddedImages;
    assert.equal(carried!.displayable, false);
    assert.equal(carried!.reason, reason);
    assert.deepEqual(
      next.projection.images.map((i) => [i.definition, i.reason]),
      [[definition, reason]],
      'the item stays geometry-only',
    );
    assert.equal(
      source.projection.embeddedImages.find((d) => d.name === definition)!
        .encodedSize,
      carried!.encodedSize,
      'the payload arrives unchanged',
    );
    // Back into the source report: identical content is reused, nothing is written.
    const same = planPaste(source, capture, 10, 'pt');
    assert.ok(same.ok);
    assert.equal(same.plan.patches.length, 1, `${item} same report`);
  }
});

test('a hashless definition is reused only on an exact match, else renamed', () => {
  const preserved = images('preserved');
  const capture = copy(preserved, ['GifPicture']);
  const blank = images('blank');
  const target = (inner: string) =>
    blank.replace(
      '</Report>',
      `<EmbeddedImages><EmbeddedImage Name="spinner">${inner}</EmbeddedImage></EmbeddedImages></Report>`,
    );
  const gif = load(preserved).projection.embeddedImages.find(
    (d) => d.name === 'spinner',
  )!.node;
  const exact = /<EmbeddedImage[^>]*>([\s\S]*)<\/EmbeddedImage>/.exec(
    preserved.slice(gif.range.start, gif.range.end),
  )![1]!;
  const reused = planPaste(load(target(exact)), capture, 10, 'pt');
  assert.ok(reused.ok);
  assert.equal(reused.plan.patches.length, 1, 'an exact match is reused');
  const other = target(
    '<MIMEType>image/gif</MIMEType><ImageData>R0lGODlhAQABAAAAACw=</ImageData>',
  );
  const renamed = planPaste(load(other), capture, 10, 'pt');
  const next = applyAndInvert(other, renamed);
  assert.ok(renamed.ok);
  assert.deepEqual(definitionNames(renamed.candidate), [
    'spinner',
    'spinner_1',
  ]);
  assert.equal(
    next.projection.images[0]!.value?.kind === 'constant' &&
      next.projection.images[0]!.value.text,
    'spinner_1',
  );
});

test('a dangling reference never takes the name of a renamed definition', () => {
  const dangling = authored.replace(
    '</ReportItems>',
    `<Image Name="Dangling"><Source>Embedded</Source><Value>logo_1</Value><Sizing>Fit</Sizing><Top>3.5in</Top><Left>0.25in</Left><Height>0.5in</Height><Width>1.5in</Width></Image></ReportItems>`,
  );
  const capture = copy(dangling, ['LogoFit', 'Dangling']);
  assert.deepEqual(
    capture.images.map((e) => e.name),
    ['logo'],
  );
  const collision = images('collision');
  const planned = planPaste(load(collision), capture, 10, 'pt');
  const next = applyAndInvert(collision, planned);
  assert.ok(planned.ok, JSON.stringify(!planned.ok && planned.diagnostics));
  assert.deepEqual(definitionNames(planned.candidate), ['logo', 'logo_2']);
  const byName = new Map(next.projection.images.map((i) => [i.name, i]));
  const value = (name: string) => {
    const v = byName.get(name)?.value;
    return v?.kind === 'constant' ? v.text : null;
  };
  assert.equal(value('LogoFit'), 'logo_2');
  assert.equal(value('Dangling'), 'logo_1', 'the dangling Value is untouched');
  assert.equal(byName.get('Dangling')!.reason, 'reference-missing');
  assert.equal(byName.get('Dangling')!.definition, null);
});

test('pasting a dangling image reference over a different same-named definition is refused', () => {
  const preserved = images('preserved');
  const capture = copy(preserved, ['GhostPicture']);
  const target = images('blank').replace(
    '</Report>',
    '<EmbeddedImages><EmbeddedImage Name="ghost"><MIMEType>image/png</MIMEType><ImageData>iVBORw0KGgo=</ImageData></EmbeddedImage></EmbeddedImages></Report>',
  );
  const refused = planPaste(load(target), capture, 10, 'pt');
  assert.equal(refused.ok, false);
  const [diagnostic] = !refused.ok ? refused.diagnostics : [];
  assert.equal(diagnostic?.code, 'IMAGE_DEFINITION_CONFLICT');
  assert.match(diagnostic!.message, /GhostPicture/);
  assert.match(diagnostic!.message, /ghost/);
  assert.ok(!diagnostic!.message.includes('iVBORw0KGgo'), 'no payload');
  // The same capture pastes fine where the name is free, and into its own report.
  assert.ok(planPaste(load(images('blank')), capture, 10, 'pt').ok);
  assert.ok(planPaste(load(preserved), capture, 10, 'pt').ok);
});

test('renaming a definition leaves a textbox whose text mentions it untouched', () => {
  const note = images('blank')
    .match(/<Textbox Name="Title">[\s\S]*?<\/Textbox>/)![0]
    .replace('Name="Title"', 'Name="Note"')
    .replace('No embedded images', 'logo');
  const source = authored.replace('</ReportItems>', `${note}</ReportItems>`);
  const capture = copy(source, ['LogoFit', 'Note']);
  const collision = images('collision');
  const planned = planPaste(load(collision), capture, 10, 'pt');
  const next = applyAndInvert(collision, planned);
  assert.ok(planned.ok, JSON.stringify(!planned.ok && planned.diagnostics));
  const pasted = next.projection.textboxes.find((t) => t.name === 'Note')!;
  assert.equal(pasted.value?.text, 'logo');
  assert.equal(
    next.projection.images.find((i) => i.name === 'LogoFit')!.value?.kind ===
      'constant' &&
      (
        next.projection.images.find((i) => i.name === 'LogoFit')!.value as {
          text: string;
        }
      ).text,
    'logo_1',
  );
});

/** The RDL namespace bound to `r:` instead of being the default, on every element. */
const prefixedRdl = (xml: string) =>
  xml
    .replace(/xmlns="(http:\/\/schemas[^"]*)"/, 'xmlns:r="$1"')
    .replace(/<(\/?)([A-Z][A-Za-z]*)/g, '<$1r:$2');

test('definitions follow the namespace prefix rule: equal prefixes paste, mismatches are refused', () => {
  const source = prefixedRdl(authored);
  const destination = prefixedRdl(images('blank'));
  assert.equal(load(source).projection.status, 'editable');
  assert.equal(load(destination).projection.status, 'editable');
  const capture = copy(source, ['LogoFit']);
  assert.match(capture.images[0]!.xml, /^<r:EmbeddedImage /);
  const planned = planPaste(load(destination), capture, 10, 'pt');
  const next = applyAndInvert(destination, planned);
  assert.ok(planned.ok, JSON.stringify(!planned.ok && planned.diagnostics));
  assert.equal(next.projection.embeddedImages[0]!.displayable, true);
  assert.equal(next.projection.images[0]!.definition, 'logo');

  // Prefixed capture into a default-namespace report, and the reverse, are refused.
  for (const [from, to] of [
    [source, images('blank')],
    [authored, destination],
  ] as const) {
    const refused = planPaste(load(to), copy(from, ['LogoFit']), 10, 'pt');
    assert.equal(refused.ok, false);
    const [diagnostic] = !refused.ok ? refused.diagnostics : [];
    assert.equal(diagnostic?.code, 'PASTE_REFUSED');
    assert.ok(!diagnostic!.message.includes('iVBORw0KGgo'), 'no payload');
  }
});

test('preservation-only images are not copied', () => {
  const preserved = images('preserved');
  const current = load(preserved);
  for (const name of ['ExternalPicture', 'ExpressionPicture', 'CellPicture']) {
    const built = buildCapture(current, ids(current, [name]));
    assert.equal(built.ok, false, name);
    assert.equal(
      !built.ok && built.diagnostics[0]!.code,
      'SELECTION_UNSUPPORTED',
    );
  }
});

/** A valid PNG padded to `size` bytes with one ancillary chunk, distinct per `seed`. */
function paddedPng(size: number, seed: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.alloc(size - 100, seed)),
    chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('image definitions count toward captureBudget and are refused with the budget error', () => {
  const big = [paddedPng(4_900_000, 1), paddedPng(4_900_000, 2)];
  assert.ok(big.every((png) => png.length < rawImageLimit));
  let next = 0;
  // The padded pictures are PNG, so the jpeg definition must declare PNG too.
  const source = authored
    .replaceAll('image/jpeg', 'image/png')
    .replace(
      /<ImageData>[^<]*<\/ImageData>/g,
      () =>
        `<ImageData>${big[next++]?.toString('base64') ?? 'AAAA'}</ImageData>`,
    );
  const current = load(source);
  assert.ok(
    current.projection.embeddedImages.slice(0, 2).every((d) => d.displayable),
    'both oversized-for-the-clipboard definitions are valid pictures',
  );
  const one = buildCapture(current, ids(current, ['LogoAutoSize']));
  assert.ok(one.ok, JSON.stringify(!one.ok && one.diagnostics[0]));
  assert.ok(one.capture.size > 6_000_000 && one.capture.size <= captureBudget);
  const both = buildCapture(
    current,
    ids(current, ['LogoAutoSize', 'PhotoClip']),
  );
  assert.equal(both.ok, false);
  assert.equal(!both.ok && both.diagnostics[0]!.code, 'CAPTURE_TOO_LARGE');
  assert.equal(
    !both.ok && both.diagnostics[0]!.message,
    'The selection exceeds the 8 MiB clipboard budget; copy fewer items.',
  );
  assert.ok(
    !both.ok &&
      !JSON.stringify(both.diagnostics).includes(
        /<ImageData>([^<]{64})/.exec(source)![1]!,
      ),
    'no payload in the diagnostics',
  );
});
