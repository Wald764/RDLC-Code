import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import type { PatchPlan } from '@rdlc/report-model/editing';
import { applyPlan } from '@rdlc/xml-serializer/patches';

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

const directory = 'tests/fixtures/images';
const fixtures = readdirSync(directory).filter((name) =>
  name.endsWith('.rdlc'),
);

test('the image fixture corpus is present', () => {
  assert.deepEqual(fixtures.sort(), [
    'authored.rdlc',
    'blank.rdlc',
    'collision.rdlc',
    'many.rdlc',
    'preserved.rdlc',
  ]);
});

for (const name of fixtures) {
  test(`${name}: open and save without an edit is byte-identical`, () => {
    const source = readFileSync(`${directory}/${name}`, 'utf8');
    const snapshot = snapshotOf(source);
    const syntax = parse(snapshot);
    assert.equal(syntax.status, 'valid');
    const projection = projectReport(syntax);
    assert.equal(projection.status, 'editable');
    assert.equal(
      applyPlan(
        snapshot,
        { version: 1, patches: [], footprint: [], namespaceDependencies: [] },
        scopesOf(syntax),
      ),
      source,
    );
    assert.equal(snapshot.source, source);
  });

  test(`${name}: projecting leaves the text unchanged and keeps exactly the non-authorable items preserved`, () => {
    const source = readFileSync(`${directory}/${name}`, 'utf8');
    const snapshot = snapshotOf(source);
    const syntax = parse(snapshot);
    const first = projectReport(syntax);
    const second = projectReport(syntax);
    // Projection is a pure read of the syntax tree: repeatable, no mutation.
    assert.equal(snapshot.source, source);
    assert.equal(syntax.snapshot.source, source);
    assert.deepEqual(
      second.images.map((item) => [item.name, item.capabilities]),
      first.images.map((item) => [item.name, item.capabilities]),
    );
    const preserved = new Set(first.preserved.map((region) => region.nodeId));
    for (const item of first.images)
      assert.equal(
        preserved.has(item.node.id),
        item.capabilities.length === 0,
        String(item.name),
      );
    // Every definition stays an opaque region, never detached for regeneration.
    for (const definition of first.embeddedImages)
      assert.ok(preserved.has(definition.node.id), definition.name);
    // Every preserved region is the exact source span of its node.
    const spans = new Map<string, string>();
    const collect = (node: XmlNode) => {
      spans.set(node.id, source.slice(node.range.start, node.range.end));
      for (const child of node.children) collect(child);
    };
    collect(syntax.root!);
    for (const region of first.preserved)
      assert.equal(
        source.slice(region.range.start, region.range.end),
        spans.get(region.nodeId),
      );
  });

  test(`${name}: patching each projected name range changes only that span`, () => {
    const source = readFileSync(`${directory}/${name}`, 'utf8');
    const snapshot = snapshotOf(source);
    const syntax = parse(snapshot);
    const projection = projectReport(syntax);
    const ranges = [
      ...projection.images.flatMap((item) => item.nameRange ?? []),
      ...projection.embeddedImages.map((definition) => definition.nameRange),
    ];
    assert.equal(
      ranges.length,
      projection.images.length + projection.embeddedImages.length,
    );
    const plan = (replacement: (original: string) => string): PatchPlan => ({
      version: 1,
      patches: ranges.map((range) => {
        const expected = source.slice(range.start, range.end);
        return {
          version: 1,
          start: range.start,
          end: range.end,
          expected,
          replacement: replacement(expected),
        };
      }),
      footprint: ranges,
      namespaceDependencies: [],
    });
    // Identity patches through the real patch applier reproduce the bytes.
    assert.equal(
      applyPlan(
        snapshot,
        plan((original) => original),
        scopesOf(syntax),
      ),
      source,
    );
    // A real edit of every name range touches those spans and nothing else.
    const edited = applyPlan(
      snapshot,
      plan((original) => `${original}Z`),
      scopesOf(syntax),
    );
    let expected = '';
    let cursor = 0;
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
      expected += `${source.slice(cursor, range.end)}Z`;
      cursor = range.end;
    }
    assert.equal(edited, expected + source.slice(cursor));
    const reparsed = projectReport(parse(snapshotOf(edited, 2)));
    assert.deepEqual(
      reparsed.images.map((item) => item.name),
      projection.images.map((item) => `${item.name}Z`),
    );
    assert.deepEqual(
      reparsed.embeddedImages.map((definition) => definition.name),
      projection.embeddedImages.map((definition) => `${definition.name}Z`),
    );
  });

  test(`${name}: every Image and EmbeddedImage is projected over its exact source span`, () => {
    const source = readFileSync(`${directory}/${name}`, 'utf8');
    const projection = projectReport(parse(snapshotOf(source)));
    assert.equal(
      projection.images.length,
      (source.match(/<Image[ >]/g) ?? []).length,
    );
    assert.equal(
      projection.embeddedImages.length,
      (source.match(/<EmbeddedImage[ >]/g) ?? []).length,
    );
    for (const entry of projection.images)
      assert.ok(
        source
          .slice(entry.node.range.start, entry.node.range.end)
          .startsWith(`<Image Name="${entry.name}"`),
        String(entry.name),
      );
    for (const entry of projection.embeddedImages) {
      const text = source.slice(entry.node.range.start, entry.node.range.end);
      assert.ok(text.startsWith(`<EmbeddedImage Name="${entry.name}"`));
      assert.ok(text.endsWith('</EmbeddedImage>'));
    }
  });
}

test('many.rdlc keeps 50 definitions and 50 items in source order', () => {
  const source = readFileSync(`${directory}/many.rdlc`, 'utf8');
  const projection = projectReport(parse(snapshotOf(source)));
  assert.equal(projection.images.length, 50);
  assert.equal(projection.embeddedImages.length, 50);
  const starts = projection.embeddedImages.map(
    (entry) => entry.node.range.start,
  );
  assert.deepEqual(
    starts,
    [...starts].sort((a, b) => a - b),
  );
});
