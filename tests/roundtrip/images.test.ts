import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import type { PatchPlan } from '@rdlc/report-model/editing';
import { applyPlan } from '@rdlc/xml-serializer/patches';
import { validatePicture } from '@rdlc/validation/images';
import type { ValidatedPicture } from '@rdlc/report-model/images';
import {
  planImageCreation,
  planTextboxIntent,
  type PlanOutcome,
} from '../../apps/vscode-extension/src/edit-controller.js';

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

// --- Unrelated edits never touch an image or a definition (US5, FR-023) ---

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/** A body textbox appended to the fixture: the "unrelated" item the edits act on. */
const note =
  '<Textbox Name="Note"><CanGrow>true</CanGrow><KeepTogether>true</KeepTogether>' +
  '<Paragraphs><Paragraph><TextRuns><TextRun><Value>Hello</Value><Style /></TextRun>' +
  '</TextRuns><Style /></Paragraph></Paragraphs><Top>6in</Top><Left>0.25in</Left>' +
  '<Height>0.25in</Height><Width>1in</Width></Textbox>';

/**
 * The committed `preserved.rdlc` has no unknown content of its own, so it is injected
 * here, never into the fixture: a foreign-namespace attribute (with its declaration)
 * and two unknown children on the preservation-only `ExternalPicture`.
 */
const injectedFragments = [
  '<Image Name="ExternalPicture" xmlns:y="urn:rdlc-code:injected" y:flag="1">',
  '<FutureThing level="3">kept</FutureThing>',
  '<y:Opaque keep="1">preserve</y:Opaque>',
];
function withUnknownContent(source: string): string {
  const open = '<Image Name="ExternalPicture">';
  const start = source.indexOf(open);
  assert.ok(start > 0);
  const close = source.indexOf('</Image>', start);
  return (
    source.slice(0, start) +
    injectedFragments[0] +
    source.slice(start + open.length, close) +
    `  ${injectedFragments[1]}\n          ${injectedFragments[2]}\n          ` +
    source.slice(close)
  );
}

function withNote(name: string): string {
  const fixture = readFileSync(`${directory}/${name}`, 'utf8');
  const source =
    name === 'preserved.rdlc' ? withUnknownContent(fixture) : fixture;
  const at = source.lastIndexOf('</ReportItems>');
  assert.ok(at > 0, name);
  return source.slice(0, at) + note + source.slice(at);
}

/** Every Image and EmbeddedImage element of a parsed report, by exact source span. */
function imageSpans(source: string): string[] {
  const syntax = parse(snapshotOf(source));
  const projection = projectReport(syntax);
  return [
    ...projection.images.map((item) => item.node),
    ...projection.embeddedImages.map((definition) => definition.node),
  ].map((node) => source.slice(node.range.start, node.range.end));
}

type Edit = (
  source: string,
) => Pick<Extract<PlanOutcome, { ok: true }>, 'plan' | 'candidate'>;

function outcomeOf(outcome: PlanOutcome) {
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome;
}

function intentEdit(
  source: string,
  pick: (projection: ReturnType<typeof projectReport>) => {
    operation: 'setProperty' | 'layout' | 'author';
    targetId?: string;
    payload: never;
  },
) {
  const snapshot = snapshotOf(source);
  const syntax = parse(snapshot);
  const projection = projectReport(syntax, { digest: sha256 });
  assert.equal(projection.status, 'editable');
  const { operation, targetId, payload } = pick(projection);
  return outcomeOf(
    planTextboxIntent(snapshot, syntax, projection, {
      requestId: 'unrelated',
      baseVersion: 1,
      operation,
      ...(targetId === undefined ? {} : { targetId }),
      payload,
    } as never),
  );
}

const edits: Record<string, Edit> = {
  'a textbox text edit': (source) =>
    intentEdit(source, (projection) => ({
      operation: 'setProperty',
      targetId: projection.textboxes.find((t) => t.name === 'Note')!.node.id,
      payload: { property: 'text', value: 'Edited <text> & more' } as never,
    })),
  'a move of a non-image item': (source) =>
    intentEdit(source, (projection) => ({
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: [
          projection.textboxes.find((t) => t.name === 'Note')!.node.id,
        ],
        dxPt: 12,
        dyPt: 6,
        unit: 'pt',
      } as never,
    })),
  'a textbox insert': (source) =>
    intentEdit(source, () => ({
      operation: 'author',
      targetId: parse(snapshotOf(source)).root!.id,
      payload: {
        action: 'createTextbox',
        left: '300pt',
        top: '400pt',
      } as never,
    })),
  'an image insert with a new definition': (source) => {
    const snapshot = snapshotOf(source);
    const syntax = parse(snapshot);
    const projection = projectReport(syntax, { digest: sha256 });
    const picture = validatePicture(
      new Uint8Array(readFileSync(`${directory}/pictures/progressive.jpg`)),
      'progressive.jpg',
      sha256,
    ) as ValidatedPicture;
    assert.equal(picture.format, 'jpeg');
    return outcomeOf(
      planImageCreation(
        snapshot,
        syntax,
        projection,
        { action: 'createImage', placement: 'default' },
        { picture, fileName: 'progressive.jpg' },
      ),
    );
  },
};

for (const name of ['authored.rdlc', 'preserved.rdlc'])
  for (const [label, edit] of Object.entries(edits))
    test(`${name}: ${label} leaves every Image and EmbeddedImage byte-identical`, () => {
      const source = withNote(name);
      const before = imageSpans(source);
      assert.ok(before.length > 0);
      const { plan, candidate } = edit(source);
      assert.notEqual(candidate, source, 'the edit changed the report');

      // The candidate is the source with only the declared patches applied.
      let expected = '';
      let cursor = 0;
      for (const patch of [...plan.patches].sort((a, b) => a.start - b.start)) {
        expected += source.slice(cursor, patch.start) + patch.replacement;
        cursor = patch.end;
      }
      assert.equal(candidate, expected + source.slice(cursor));

      // No patch overlaps an image item or a definition (insertions may only abut one).
      const projection = projectReport(parse(snapshotOf(source)));
      for (const range of [
        ...projection.images.map((item) => item.node.range),
        ...projection.embeddedImages.map((definition) => definition.node.range),
      ])
        for (const patch of plan.patches)
          assert.ok(
            patch.end <= range.start || patch.start >= range.end,
            `patch ${patch.start}-${patch.end} overlaps ${range.start}-${range.end}`,
          );

      // Every original element, with its unknown children and foreign attributes, survives
      // verbatim and in the same order among the survivors.
      const after = imageSpans(candidate);
      assert.deepEqual(
        after.filter((span) => before.includes(span)),
        before,
      );
      for (const span of before) assert.ok(candidate.includes(span));
    });

test('authored.rdlc keeps its unknown children and foreign attribute after every unrelated edit', () => {
  const source = withNote('authored.rdlc');
  for (const [label, edit] of Object.entries(edits)) {
    const { candidate } = edit(source);
    for (const fragment of [
      '<Image Name="Tagged" x:flag="1">',
      '<FutureThing level="2">kept</FutureThing>',
      '<x:Opaque keep="1">preserve</x:Opaque>',
      'xmlns:x="urn:rdlc-code:extension"',
    ])
      assert.ok(candidate.includes(fragment), `${label}: ${fragment}`);
    const reparsed = projectReport(parse(snapshotOf(candidate, 2)));
    assert.equal(reparsed.status, 'editable', label);
    const tagged = reparsed.images.find((item) => item.name === 'Tagged')!;
    assert.equal(tagged.definition, 'logo', label);
    assert.ok(tagged.capabilities.includes('image'), label);
  }
});

test('preserved.rdlc keeps the reason and state of every preserved item after every unrelated edit', () => {
  const source = withNote('preserved.rdlc');
  const original = projectReport(parse(snapshotOf(source)));
  for (const [label, edit] of Object.entries(edits)) {
    const reparsed = projectReport(
      parse(snapshotOf(edit(source).candidate, 2)),
    );
    assert.deepEqual(
      reparsed.images
        .filter((item) => original.images.some((o) => o.name === item.name))
        .map((item) => [item.name, item.reason, item.capabilities]),
      original.images.map((item) => [
        item.name,
        item.reason,
        item.capabilities,
      ]),
      label,
    );
  }
});

test('preserved.rdlc keeps injected unknown children and foreign attributes after every unrelated edit', () => {
  const source = withNote('preserved.rdlc');
  const before = projectReport(parse(snapshotOf(source)));
  assert.equal(before.status, 'editable');
  const external = before.images.find(
    (item) => item.name === 'ExternalPicture',
  )!;
  assert.deepEqual(external.capabilities, [], 'still preservation-only');
  for (const fragment of injectedFragments)
    assert.ok(source.includes(fragment), fragment);
  for (const [label, edit] of Object.entries(edits)) {
    const { candidate } = edit(source);
    for (const fragment of injectedFragments)
      assert.ok(candidate.includes(fragment), `${label}: ${fragment}`);
    const after = projectReport(parse(snapshotOf(candidate, 2)));
    assert.equal(after.status, 'editable', label);
    const kept = after.images.find((item) => item.name === 'ExternalPicture')!;
    assert.equal(
      candidate.slice(kept.node.range.start, kept.node.range.end),
      source.slice(external.node.range.start, external.node.range.end),
      label,
    );
  }
});
