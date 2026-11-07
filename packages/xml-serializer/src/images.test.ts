import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { applyPlan } from './patches.js';
import { planCreateImage, type CreateImageRequest } from './images.js';

const snapshotOf = (source: string, version = 1) => ({
  uri: 'fixture:images',
  version,
  source,
  eol: '\n' as const,
});

function scopesOf(
  syntax: XmlSyntaxDocument,
): Record<string, Readonly<Record<string, string>>> {
  const scopes: Record<string, Readonly<Record<string, string>>> = {};
  const visit = (node: XmlNode) => {
    scopes[node.id] = node.namespaces;
    for (const child of node.children) visit(child);
  };
  if (syntax.root) visit(syntax.root);
  return scopes;
}

function apply(source: string, plan: PatchPlan): string {
  const snapshot = snapshotOf(source, plan.version);
  return applyPlan(snapshot, plan, scopesOf(parse(snapshot)));
}

/** The candidate differs from the source only inside the declared footprint. */
function assertOnlyFootprintChanged(
  source: string,
  plan: PatchPlan,
  candidate: string,
) {
  let rebuilt = '';
  let cursor = 0;
  for (const patch of plan.patches) {
    rebuilt += source.slice(cursor, patch.start) + patch.replacement;
    cursor = patch.end;
  }
  assert.equal(candidate, rebuilt + source.slice(cursor));
  for (const patch of plan.patches)
    assert.ok(
      plan.footprint.some(
        (range) => range.start <= patch.start && range.end >= patch.end,
      ),
    );
}

const load = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}`, 'utf8');
const plan = (source: string, request: CreateImageRequest) => {
  const snapshot = snapshotOf(source);
  const syntax = parse(snapshot);
  const projection = projectReport(syntax);
  assert.ok(syntax.root && projection.section);
  const result = planCreateImage(
    snapshot,
    syntax.root,
    projection.section,
    request,
  );
  return { result, candidate: apply(source, result), projection };
};

const pngBase64 = readFileSync(
  'tests/fixtures/images/pictures/logo.png',
).toString('base64');
const item = {
  name: 'Image1',
  value: 'logo',
  top: '0.5in',
  left: '1in',
  height: '0.75in',
  width: '1.5in',
};
const definition = {
  name: 'logo',
  mime: 'image/png' as const,
  base64: pngBase64,
};

const itemXml = (name: string, value: string) =>
  `<Image Name="${name}"><Source>Embedded</Source><Value>${value}</Value>` +
  `<Sizing>FitProportional</Sizing><Top>0.5in</Top><Left>1in</Left>` +
  `<Height>0.75in</Height><Width>1.5in</Width></Image>`;
const definitionXml = (name: string, mime: string, base64: string) =>
  `<EmbeddedImage Name="${name}"><MIMEType>${mime}</MIMEType>` +
  `<ImageData>${base64}</ImageData></EmbeddedImage>`;

test('creates EmbeddedImages as the last child of Report when it is absent', () => {
  const source = load('blank.rdlc');
  const { result, candidate } = plan(source, { definition, item });
  assertOnlyFootprintChanged(source, result, candidate);
  const closing = '</Report>';
  assert.ok(
    candidate
      .trimEnd()
      .endsWith(
        `<EmbeddedImages>${definitionXml('logo', 'image/png', pngBase64)}</EmbeddedImages>${closing}`,
      ),
  );
  assert.equal(candidate.match(/<EmbeddedImages>/g)?.length, 1);
  assert.ok(candidate.includes(itemXml('Image1', 'logo') + '</ReportItems>'));
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(projected.status, 'editable');
  assert.deepEqual(
    projected.embeddedImages.map((entry) => entry.name),
    ['logo'],
  );
  assert.deepEqual(
    projected.images.map((entry) => [entry.name, entry.definition]),
    [['Image1', 'logo']],
  );
});

test('appends to an existing EmbeddedImages and keeps existing entries byte-identical', () => {
  const source = load('collision.rdlc');
  const second = { ...definition, name: 'logo_1' };
  const { result, candidate } = plan(source, {
    definition: second,
    item: { ...item, value: 'logo_1' },
  });
  assertOnlyFootprintChanged(source, result, candidate);
  const existing = source.slice(
    source.indexOf('<EmbeddedImage Name="logo">'),
    source.indexOf('</EmbeddedImage>') + '</EmbeddedImage>'.length,
  );
  assert.ok(candidate.includes(existing));
  assert.ok(
    candidate.includes(
      definitionXml('logo_1', 'image/png', pngBase64) + '</EmbeddedImages>',
    ),
  );
  assert.equal(candidate.match(/<EmbeddedImages>/g)?.length, 1);
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.deepEqual(
    projected.embeddedImages.map((entry) => entry.name),
    ['logo', 'logo_1'],
  );
});

test('a reused definition writes only the item', () => {
  const source = load('collision.rdlc');
  const { result, candidate } = plan(source, {
    item: { ...item, value: 'logo' },
  });
  assertOnlyFootprintChanged(source, result, candidate);
  assert.equal(result.patches.length, 1);
  assert.equal(
    candidate,
    source.replace(
      '</ReportItems>',
      itemXml('Image1', 'logo') + '</ReportItems>',
    ),
  );
  assert.equal(candidate.match(/<EmbeddedImage /g)?.length, 1);
});

test('the item XML matches the contract with FitProportional sizing', () => {
  const { candidate } = plan(load('blank.rdlc'), { definition, item });
  const inserted = candidate.slice(
    candidate.indexOf('<Image '),
    candidate.indexOf('</Image>') + '</Image>'.length,
  );
  assert.equal(inserted, itemXml('Image1', 'logo'));
  assert.ok(inserted.includes('<Sizing>FitProportional</Sizing>'));
  const order = ['Source', 'Value', 'Sizing', 'Top', 'Left', 'Height', 'Width'];
  assert.deepEqual(
    order.map((name) => inserted.indexOf(`<${name}>`)),
    order.map((name) => inserted.indexOf(`<${name}>`)).sort((a, b) => a - b),
  );
});

test('creates Body/ReportItems when it is absent', () => {
  const source = load('blank.rdlc').replace(
    /<ReportItems>[\s\S]*<\/ReportItems>\s*/,
    '',
  );
  assert.ok(!source.includes('ReportItems'));
  const { result, candidate } = plan(source, { definition, item });
  assertOnlyFootprintChanged(source, result, candidate);
  assert.ok(
    candidate.includes(
      `<ReportItems>${itemXml('Image1', 'logo')}</ReportItems>`,
    ),
  );
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(projected.status, 'editable');
  assert.equal(projected.images[0]?.context, 'body');
});

test('the result is one composed plan whose footprint covers every patch', () => {
  const source = load('blank.rdlc');
  const { result } = plan(source, { definition, item });
  assert.equal(result.version, 1);
  assert.equal(result.patches.length, 2);
  assert.equal(result.footprint.length, 2);
  assert.deepEqual(
    result.patches.map((patch) => patch.start),
    [...result.patches.map((patch) => patch.start)].sort((a, b) => a - b),
  );
  for (const patch of result.patches) {
    assert.equal(patch.version, 1);
    assert.equal(patch.expected, source.slice(patch.start, patch.end));
  }
});

test('names and values are escaped and payload characters are never altered', () => {
  const { candidate } = plan(load('blank.rdlc'), {
    definition: { ...definition, name: 'a&b' },
    item: { ...item, value: 'a&b' },
  });
  assert.ok(candidate.includes('<EmbeddedImage Name="a&amp;b">'));
  assert.ok(candidate.includes('<Value>a&amp;b</Value>'));
  assert.ok(candidate.includes(`<ImageData>${pngBase64}</ImageData>`));
});

test('duplicate EmbeddedImages is preservation-only and refuses the plan', () => {
  const source = load('collision.rdlc').replace(
    '</Report>',
    '<EmbeddedImages></EmbeddedImages></Report>',
  );
  const snapshot = snapshotOf(source);
  const syntax = parse(snapshot);
  const projection = projectReport(syntax);
  assert.ok(syntax.root && projection.section);
  assert.throws(() =>
    planCreateImage(snapshot, syntax.root!, projection.section!, {
      definition,
      item,
    }),
  );
});
