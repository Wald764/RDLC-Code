import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  IMAGE_PROPERTY_INVALID,
  IMAGE_REMOVE_BLOCKED,
  IMAGE_RENAME_BLOCKED,
  IMAGE_TARGET_STALE,
} from '@rdlc/report-model/images';
import type { NavigationNode } from '@rdlc/report-model/navigation';
import { validateMessage } from '@rdlc/report-model/protocol';
import { evaluateReport } from './report-evaluation.js';
import {
  checkImageCommand,
  embeddedImageSummary,
  imageNameProblem,
  imageRoute,
  structureContextValue,
} from './sidebar/actions.js';
import { planTextboxIntent, type PlanOutcome } from './edit-controller.js';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const read = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}`, 'utf8');
const evaluate = (source: string, version = 1) =>
  evaluateReport(
    { uri: 'test:definitions', version, source, eol: '\n' },
    { digest },
  );

function author(
  state: ReturnType<typeof evaluate>,
  payload: Record<string, string>,
  overrides: Record<string, unknown> = {},
): PlanOutcome {
  return planTextboxIntent(state.snapshot, state.syntax, state.projection, {
    requestId: 'r',
    baseVersion: state.snapshot.version,
    targetId: state.syntax.root!.id,
    operation: 'author',
    payload,
    ...overrides,
  } as never);
}
const rename = (definition: string, newName: string) => ({
  action: 'renameEmbeddedImage',
  definition,
  newName,
});
const remove = (definition: string) => ({
  action: 'removeEmbeddedImage',
  definition,
});
const refused = (outcome: PlanOutcome) => {
  assert.equal(outcome.ok, false);
  return outcome.ok ? [] : outcome.diagnostics;
};
const codes = (outcome: PlanOutcome) =>
  refused(outcome).map((entry) => entry.code);

test('renameEmbeddedImage rewrites the definition and every constant reference in one plan', () => {
  const state = evaluate(read('authored.rdlc'));
  const outcome = author(state, rename('logo', 'brand'));
  assert.ok(outcome.ok);
  assert.equal(outcome.changed, true);
  // The Name attribute plus one Value per referencing item: still one plan.
  assert.equal(outcome.plan.patches.length, 4);
  assert.ok(outcome.candidate.includes('<EmbeddedImage Name="brand">'));
  assert.equal(outcome.candidate.match(/<Value>brand<\/Value>/g)?.length, 3);
  assert.ok(!outcome.candidate.includes('<Value>logo</Value>'));
  // The picture payloads and the other items stay byte-identical.
  for (const name of ['photo', 'unused']) {
    const text = (source: string) =>
      source.slice(
        source.indexOf(`<EmbeddedImage Name="${name}">`),
        source.indexOf('</EmbeddedImage>', source.indexOf(`Name="${name}"`)),
      );
    assert.equal(text(outcome.candidate), text(state.snapshot.source));
  }
});

test('renaming to the current name is accepted and changes nothing', () => {
  const outcome = author(
    evaluate(read('authored.rdlc')),
    rename('logo', 'logo'),
  );
  assert.ok(outcome.ok);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.plan.patches.length, 0);
});

test('a new definition name must be CLS-compliant and unique among the embedded images', () => {
  const state = evaluate(read('authored.rdlc'));
  for (const newName of ['photo', 'unused', '', '1x', 'has space', 'a<b']) {
    const outcome = author(state, rename('logo', newName));
    assert.deepEqual(codes(outcome), [IMAGE_PROPERTY_INVALID], newName);
    // The message names the rule, never the submitted text.
    if (newName)
      assert.ok(!refused(outcome)[0]!.message.includes(newName), newName);
  }
  // An image item may already use the name: the namespaces are separate.
  assert.ok(author(state, rename('logo', 'LogoFit')).ok);
});

test('rename and removal are refused when an expression could name the definition', () => {
  const state = evaluate(read('preserved.rdlc'));
  for (const [payload, code] of [
    [rename('logo', 'brand'), IMAGE_RENAME_BLOCKED],
    [remove('bitmap'), IMAGE_REMOVE_BLOCKED],
  ] as const) {
    const outcome = author(state, payload);
    assert.ok(codes(outcome).every((entry) => entry === code));
    const listing = refused(outcome).map((entry) => entry.message);
    assert.ok(
      listing.some((message) => message.includes('"ExpressionPicture"')),
      'the blocking item is named',
    );
    assert.ok(refused(outcome).every((entry) => entry.itemId !== undefined));
  }
});

test('removal of a referenced definition lists the referencing items; an unused one is one patch', () => {
  const state = evaluate(read('authored.rdlc'));
  const blocked = author(state, remove('logo'));
  assert.deepEqual(codes(blocked), Array(3).fill(IMAGE_REMOVE_BLOCKED));
  assert.deepEqual(
    refused(blocked).map((entry) => entry.itemId),
    ['LogoAutoSize', 'LogoFit', 'Tagged'].map(
      (name) => state.projection.images.find((i) => i.name === name)!.node.id,
    ),
  );
  const outcome = author(state, remove('unused'));
  assert.ok(outcome.ok);
  assert.equal(outcome.plan.patches.length, 1);
  assert.equal(outcome.candidate.includes('Name="unused"'), false);
  assert.ok(outcome.candidate.includes('<EmbeddedImages>'));
});

test('removing the last definition removes the whole EmbeddedImages collection', () => {
  const source = read('authored.rdlc')
    .replace(/<Image Name="[\s\S]*?<\/Image>\s*/g, '')
    .replace(
      /<EmbeddedImage Name="(logo|photo)">[\s\S]*?<\/EmbeddedImage>\s*/g,
      '',
    );
  const state = evaluate(source);
  assert.deepEqual(
    state.projection.embeddedImages.map((entry) => entry.name),
    ['unused'],
  );
  const outcome = author(state, remove('unused'));
  assert.ok(outcome.ok);
  assert.equal(outcome.plan.patches.length, 1);
  assert.ok(!outcome.candidate.includes('<EmbeddedImages'));
  assert.equal(
    evaluate(outcome.candidate, 2).projection.embeddedImages.length,
    0,
  );
});

test('definition edits refuse a missing definition, a stale version and a foreign target', () => {
  const state = evaluate(read('authored.rdlc'));
  assert.deepEqual(codes(author(state, remove('ghost'))), [IMAGE_TARGET_STALE]);
  assert.deepEqual(codes(author(state, rename('ghost', 'x'))), [
    IMAGE_TARGET_STALE,
  ]);
  assert.equal(
    author(state, remove('unused'), { baseVersion: 99 }).ok,
    false,
    'stale version',
  );
  assert.equal(
    author(state, remove('unused'), {
      targetId: state.projection.images[0]!.node.id,
    }).ok,
    false,
    'only the report is a valid target',
  );
});

test('insert reuses an existing displayable definition without any new definition', () => {
  const state = evaluate(read('authored.rdlc'));
  const outcome = author(state, {
    action: 'createImage',
    placement: 'default',
    definition: 'unused',
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.candidate.match(/<EmbeddedImage /g)?.length, 3);
  const next = evaluate(outcome.candidate, 2).projection;
  assert.equal(next.images.length, state.projection.images.length + 1);
  assert.deepEqual(
    next.embeddedImages.find((entry) => entry.name === 'unused')!.references,
    [outcome.created!.name],
  );
});

test('no refusal or diagnostic carries picture data', () => {
  const state = evaluate(read('authored.rdlc'));
  const payloads = [
    ...state.snapshot.source.matchAll(/<ImageData>([^<]{40,})</g),
  ].map((match) => match[1]!.trim().slice(0, 40));
  assert.ok(payloads.length >= 3);
  const outcomes = [
    author(state, remove('logo')),
    author(state, rename('logo', 'photo')),
    author(state, remove('ghost')),
    author(evaluate(read('preserved.rdlc')), rename('logo', 'x')),
  ];
  for (const outcome of outcomes)
    for (const payload of payloads)
      assert.ok(!JSON.stringify(outcome).includes(payload));
});

test('the typed intents are valid native author actions and accepted client edits', () => {
  const state = evaluate(read('authored.rdlc'));
  const nodes = state.navigation.data.nodes;
  const node = (name: string) => nodes.find((entry) => entry.name === name)!;
  const context = { root: state.syntax.root, report: state.projection };
  for (const [command, name, newName] of [
    ['insert', 'unused', undefined],
    ['rename', 'unused', 'spare'],
    ['remove', 'unused', undefined],
  ] as const) {
    const route = imageRoute(node(name), command, context, newName);
    assert.deepEqual(route.targetIds, [state.syntax.root!.id]);
    assert.ok(
      validateMessage({
        protocol: 2,
        kind: 'nativeAction',
        requestId: `native-${command}`,
        documentLifetimeId: 'document-1',
        uri: 'file:///images.rdlc',
        baseVersion: 1,
        viewId: 'view-1',
        contextGeneration: 1,
        capability: 'author',
        targetIds: route.targetIds,
        ...route.intent,
      }),
      `${command} is a valid native action`,
    );
    assert.ok(
      validateMessage({
        protocol: 2,
        kind: 'edit',
        requestId: `edit-${command}`,
        baseVersion: 1,
        targetId: route.targetIds[0],
        operation: 'author',
        payload: (route.intent as { payload: unknown }).payload,
      }),
      `${command} is a valid client edit`,
    );
    assert.ok(
      author(
        state,
        (route.intent as unknown as { payload: Record<string, string> })
          .payload,
      ).ok,
    );
  }
  // Unknown fields never pass the closed native vocabulary.
  assert.equal(
    validateMessage({
      protocol: 2,
      kind: 'nativeAction',
      requestId: 'native-forged',
      documentLifetimeId: 'document-1',
      uri: 'file:///images.rdlc',
      baseVersion: 1,
      viewId: 'view-1',
      contextGeneration: 1,
      capability: 'author',
      targetIds: ['1:1'],
      action: 'author',
      payload: {
        action: 'createImage',
        placement: 'default',
        definition: 'unused',
        path: '/etc/passwd',
      },
    }),
    null,
  );
});

test('the sidebar guards list the blocking items before anything is dispatched', () => {
  const state = evaluate(read('authored.rdlc'));
  const context = { root: state.syntax.root, report: state.projection };
  const node = (name: string): NavigationNode =>
    state.navigation.data.nodes.find((entry) => entry.name === name)!;
  assert.throws(
    () => checkImageCommand(node('logo'), 'remove', context),
    /"LogoAutoSize".*"LogoFit".*"Tagged"/s,
  );
  assert.deepEqual(checkImageCommand(node('logo'), 'rename', context), {
    name: 'logo',
    rootId: state.syntax.root!.id,
  });
  const mixed = evaluate(read('preserved.rdlc'));
  const mixedContext = { root: mixed.syntax.root, report: mixed.projection };
  const mixedNode = (name: string) =>
    mixed.navigation.data.nodes.find((entry) => entry.name === name)!;
  assert.throws(
    () => checkImageCommand(mixedNode('logo'), 'rename', mixedContext),
    /expression/,
  );
  // A definition that cannot be shown cannot be inserted.
  assert.throws(
    () => checkImageCommand(mixedNode('spinner'), 'insert', mixedContext),
    /not a displayable PNG or JPEG/,
  );
  assert.throws(
    () =>
      checkImageCommand(
        state.navigation.structure.nodes[0]!,
        'insert',
        context,
      ),
    /Choose an embedded image/,
  );
  // A source-only report offers no image command.
  const broken = evaluate(read('authored.rdlc') + '<');
  assert.throws(
    () =>
      checkImageCommand(node('unused'), 'remove', {
        root: broken.syntax.root,
        report: broken.projection,
      }),
    /editable report/,
  );
  assert.equal(imageNameProblem('brand', 'logo', context), null);
  assert.equal(imageNameProblem('logo', 'logo', context), null);
  assert.match(imageNameProblem('photo', 'logo', context)!, /unique/);
  assert.ok(!imageNameProblem('a b', 'logo', context)!.includes('a b'));
});

test('definition rows expose format, size, pixels and reference counts, never payload text', () => {
  const state = evaluate(read('authored.rdlc'));
  const rows = state.navigation.data.nodes.filter(
    (node) => node.kind === 'embedded-image',
  );
  const summaries = Object.fromEntries(
    rows.map((node) => [node.name, embeddedImageSummary(node)]),
  );
  assert.match(
    summaries.logo!,
    /^PNG · \d+x\d+ px · [\d.]+ (B|KB) · 3 references$/,
  );
  assert.match(summaries.photo!, /^JPEG · .* · 2 references$/);
  assert.match(summaries.unused!, /· 0 references$/);
  const spinner = evaluate(read('preserved.rdlc')).navigation.data.nodes.find(
    (node) => node.name === 'spinner',
  )!;
  assert.match(
    embeddedImageSummary(spinner),
    /^Other format \(not displayable\)/,
  );
  const payloads = [
    ...state.snapshot.source.matchAll(/<ImageData>([^<]{40,})</g),
  ].map((match) => match[1]!.trim().slice(0, 40));
  for (const row of rows)
    for (const text of [
      row.label,
      embeddedImageSummary(row),
      JSON.stringify(row.details),
    ])
      for (const payload of payloads) assert.ok(!text.includes(payload));
});

test('context values gate Insert, Rename and Remove per definition and per image item', () => {
  const state = evaluate(read('authored.rdlc'));
  const value = (node: NavigationNode) =>
    structureContextValue(node, undefined, state.scene, true);
  const definition = (name: string) =>
    state.navigation.data.nodes.find((entry) => entry.name === name)!;
  assert.equal(
    value(definition('logo')),
    'dataEmbeddedImage.displayable dataEmbeddedImage.referenced',
  );
  assert.equal(
    value(definition('unused')),
    'dataEmbeddedImage.displayable dataEmbeddedImage.unreferenced',
  );
  const mixed = evaluate(read('preserved.rdlc'));
  const mixedValue = (name: string) =>
    structureContextValue(
      mixed.navigation.data.nodes.find((entry) => entry.name === name)!,
      undefined,
      mixed.scene,
      true,
    );
  assert.equal(mixedValue('spinner'), 'dataEmbeddedImage.referenced');
  assert.equal(mixedValue('broken'), 'dataEmbeddedImage.referenced');
  // Authored image items follow the capability state of the other body items.
  const item = (
    source: ReturnType<typeof evaluate>,
    name: string,
  ): NavigationNode =>
    source.navigation.structure.nodes.find((entry) => entry.name === name)!;
  assert.equal(value(item(state, 'LogoFit')), 'rdlcCode.body');
  const mixedItem = (name: string) =>
    structureContextValue(item(mixed, name), undefined, mixed.scene);
  assert.equal(mixedItem('GhostPicture'), 'rdlcCode.body', 'geometry-only');
  for (const name of ['ExternalPicture', 'ExpressionPicture', 'CellPicture'])
    assert.equal(mixedItem(name), 'rdlcCode.source', name);
});

/** Gauge elements naming `logo` and `photo` while no Image item references anything. */
const gaugeOnly = () =>
  read('authored.rdlc').replace(
    /<Image Name="[^>]*>[\s\S]*<\/Image>\s*<\/ReportItems>/,
    '<GaugePanel Name="Dial"><LinearGauges><LinearGauge Name="Level"><LinearPointers><LinearPointer><PointerImage><Source>Embedded</Source><Value>logo</Value></PointerImage></LinearPointer></LinearPointers></LinearGauge></LinearGauges><StateIndicators><StateIndicator Name="Light"><IndicatorImage><Source>Embedded</Source><Value>logo</Value></IndicatorImage></StateIndicator></StateIndicators></GaugePanel></ReportItems>',
  );

test('image elements other than Image items keep a definition referenced and block its edits', () => {
  const state = evaluate(gaugeOnly());
  assert.equal(state.projection.images.length, 0);
  const row = (name: string) =>
    state.navigation.data.nodes.find((entry) => entry.name === name)!;
  assert.equal(
    structureContextValue(row('logo'), undefined, state.scene, true),
    'dataEmbeddedImage.displayable dataEmbeddedImage.referenced',
  );
  assert.match(embeddedImageSummary(row('logo')), /· 2 references$/);
  assert.equal(
    structureContextValue(row('unused'), undefined, state.scene, true),
    'dataEmbeddedImage.displayable dataEmbeddedImage.unreferenced',
  );
  for (const [payload, code] of [
    [remove('logo'), IMAGE_REMOVE_BLOCKED],
    [rename('logo', 'brand'), IMAGE_RENAME_BLOCKED],
  ] as const) {
    const outcome = author(state, payload);
    assert.deepEqual(codes(outcome), [code, code]);
    const messages = refused(outcome).map((entry) => entry.message);
    assert.match(messages[0]!, /The PointerImage of "Level"/);
    assert.match(messages[1]!, /The IndicatorImage of "Light"/);
  }
  const context = { root: state.syntax.root, report: state.projection };
  assert.throws(
    () => checkImageCommand(row('logo'), 'remove', context),
    /PointerImage of "Level".*IndicatorImage of "Light"/,
  );
  assert.ok(author(state, remove('unused')).ok);
});

test('a rename that would capture a reference to a missing definition is refused', () => {
  const source = read('authored.rdlc').replace(
    '<Image Name="PhotoClip">',
    '<Image Name="Dangling"><Source>Embedded</Source><Value>brand</Value></Image><Image Name="PhotoClip">',
  );
  const state = evaluate(source);
  const outcome = author(state, rename('unused', 'brand'));
  assert.deepEqual(codes(outcome), [IMAGE_RENAME_BLOCKED]);
  assert.match(refused(outcome)[0]!.message, /"Dangling"/);
  assert.ok(!refused(outcome)[0]!.message.includes('brand'));
  assert.ok(author(state, rename('unused', 'fresh')).ok);
  const node = state.navigation.data.nodes.find(
    (entry) => entry.name === 'unused',
  )!;
  assert.throws(
    () =>
      imageRoute(
        node,
        'rename',
        { root: state.syntax.root, report: state.projection },
        'brand',
      ),
    /"Dangling"/,
  );
});

test('definition names are limited to 256 characters by the edit and the input box', () => {
  const state = evaluate(read('authored.rdlc'));
  assert.ok(author(state, rename('unused', 'n'.repeat(256))).ok);
  assert.deepEqual(codes(author(state, rename('unused', 'n'.repeat(257)))), [
    IMAGE_PROPERTY_INVALID,
  ]);
  const context = { root: state.syntax.root, report: state.projection };
  assert.equal(imageNameProblem('n'.repeat(256), 'unused', context), null);
  const problem = imageNameProblem('n'.repeat(257), 'unused', context);
  assert.ok(problem && !problem.includes('nnnnnnnnnn'));
});

test('definition rows of a report that is not editable keep their facts but no image commands', () => {
  const source = read('authored.rdlc').replace(
    '</ReportSections>',
    '<ReportSection><Body><ReportItems/><Height>1in</Height></Body><Width>6in</Width><Page/></ReportSection></ReportSections>',
  );
  const state = evaluate(source);
  assert.notEqual(state.projection.status, 'editable');
  assert.ok(state.projection.embeddedImages.length > 0);
  const rows = state.navigation.data.nodes.filter(
    (entry) => entry.kind === 'embedded-image',
  );
  assert.equal(rows.length, 3);
  // FR-021 and US4.2: inspection facts stay available; only authoring is withheld.
  const expected: Record<string, [string, number, RegExp]> = {
    logo: ['png', 3, /^PNG · \d+x\d+ px · [\d.]+ (B|KB) · 3 references$/],
    photo: ['jpeg', 2, /^JPEG · .* · 2 references$/],
    unused: ['png', 0, /· 0 references$/],
  };
  for (const node of rows) {
    const [format, references, summary] = expected[node.name ?? '']!;
    assert.equal(node.details?.format, format, node.name ?? '');
    assert.equal(node.details?.references, references, node.name ?? '');
    assert.equal(node.details?.displayable, true, node.name ?? '');
    assert.match(embeddedImageSummary(node), summary, node.name ?? '');
    assert.equal(
      structureContextValue(node, undefined, state.scene, false),
      'rdlcCode.source',
      node.name ?? '',
    );
  }
});
