import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { applyPlan } from './patches.js';
import {
  planCreateImage,
  planImageProperty,
  planRemoveDefinition,
  planRenameDefinition,
  planReplacePicture,
  type CreateImageRequest,
} from './images.js';

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

// --- US3: property and replace plans ---------------------------------------

const projectionOfSource = (source: string) => {
  const snapshot = snapshotOf(source);
  const syntax = parse(snapshot);
  const projection = projectReport(syntax);
  assert.ok(syntax.root);
  return { snapshot, syntax, projection, root: syntax.root };
};
const imageNamed = (source: string, name: string) => {
  const { snapshot, projection } = projectionOfSource(source);
  const image = projection.images.find((entry) => entry.name === name);
  assert.ok(image, name);
  return { snapshot, image };
};
const property = (
  source: string,
  name: string,
  key: 'sizing' | 'value' | 'toolTip' | 'name',
  value: string,
) => {
  const { snapshot, image } = imageNamed(source, name);
  const result = planImageProperty({ snapshot, image, property: key, value });
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  return { result, candidate };
};
const authored = () => load('authored.rdlc');

test('planImageProperty replaces an existing Sizing scalar in place', () => {
  const source = authored();
  const { result, candidate } = property(
    source,
    'LogoAutoSize',
    'sizing',
    'Clip',
  );
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]!.expected, 'AutoSize');
  assert.equal(
    candidate,
    source.replace('<Sizing>AutoSize</Sizing>', '<Sizing>Clip</Sizing>'),
  );
});

test('planImageProperty replaces Value and keeps unknown children byte-identical', () => {
  const source = authored();
  const { candidate } = property(source, 'Tagged', 'value', 'photo');
  assert.equal(
    candidate,
    source.replace(
      '<Value>logo</Value>\n            <MIMEType>image/png</MIMEType>\n            <Sizing>Fit</Sizing>\n            <Top>2.85in',
      '<Value>photo</Value>\n            <MIMEType>image/png</MIMEType>\n            <Sizing>Fit</Sizing>\n            <Top>2.85in',
    ),
  );
  assert.ok(candidate.includes('<x:Opaque keep="1">preserve</x:Opaque>'));
});

test('planImageProperty inserts an absent Sizing element as the last child', () => {
  const source = authored().replace(/\n\s*<Sizing>AutoSize<\/Sizing>/, '');
  const { result, candidate } = property(
    source,
    'LogoAutoSize',
    'sizing',
    'Fit',
  );
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]!.start, result.patches[0]!.end);
  assert.ok(candidate.includes('<Sizing>Fit</Sizing></Image>'));
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(
    projected.images.find((entry) => entry.name === 'LogoAutoSize')!.sizing,
    'Fit',
  );
});

test('planImageProperty inserts, replaces and removes the ToolTip', () => {
  const base = authored();
  const inserted = property(
    base,
    'LogoFit',
    'toolTip',
    'Company <logo> & more',
  );
  assert.ok(
    inserted.candidate.includes(
      '<ToolTip>Company &lt;logo&gt; &amp; more</ToolTip></Image>',
    ),
  );
  const projected = projectReport(parse(snapshotOf(inserted.candidate)));
  assert.equal(
    projected.images.find((entry) => entry.name === 'LogoFit')!.toolTip?.text,
    'Company <logo> & more',
  );

  const replaced = property(
    inserted.candidate,
    'LogoFit',
    'toolTip',
    '=Fields!A.Value',
  );
  assert.ok(replaced.candidate.includes('<ToolTip>=Fields!A.Value</ToolTip>'));
  assert.equal(replaced.result.patches.length, 1);

  const removed = property(replaced.candidate, 'LogoFit', 'toolTip', '');
  assert.equal(removed.candidate, base);
});

test('planImageProperty removing an absent ToolTip is an empty plan', () => {
  const { result, candidate } = property(authored(), 'LogoFit', 'toolTip', '');
  assert.equal(result.patches.length, 0);
  assert.equal(candidate, authored());
});

test('planImageProperty refuses a structured ToolTip instead of rewriting it', () => {
  const source = authored().replace(
    '<Source>Embedded</Source>\n            <Value>logo</Value>\n            <MIMEType>image/png</MIMEType>\n            <Sizing>Fit</Sizing>\n            <Top>0.9in',
    '<Source>Embedded</Source>\n            <Value>logo</Value>\n            <ToolTip><x:Rich/></ToolTip>\n            <Sizing>Fit</Sizing>\n            <Top>0.9in',
  );
  const { snapshot, image } = imageNamed(source, 'LogoFit');
  assert.throws(() =>
    planImageProperty({ snapshot, image, property: 'toolTip', value: 'x' }),
  );
});

test('planImageProperty renames only the Name attribute value', () => {
  const source = authored();
  const { result, candidate } = property(source, 'Tagged', 'name', 'A&B');
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]!.expected, 'Tagged');
  assert.equal(
    candidate,
    source.replace('<Image Name="Tagged"', '<Image Name="A&amp;B"'),
  );
});

const replacementBase64 = readFileSync(
  'tests/fixtures/images/pictures/photo.jpg',
).toString('base64');

test('planReplacePicture item scope writes a new definition and repoints this item only', () => {
  const source = authored();
  const { snapshot, image, root } = (() => {
    const found = imageNamed(source, 'LogoFit');
    return { ...found, root: projectionOfSource(source).root };
  })();
  const result = planReplacePicture(snapshot, root, {
    scope: 'item',
    image,
    value: 'photo_1',
    definition: {
      name: 'photo_1',
      mime: 'image/jpeg',
      base64: replacementBase64,
    },
  });
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  assert.equal(result.patches.length, 2);
  assert.ok(
    candidate.includes(
      definitionXml('photo_1', 'image/jpeg', replacementBase64) +
        '</EmbeddedImages>',
    ),
  );
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(projected.status, 'editable');
  const byName = new Map(projected.images.map((entry) => [entry.name, entry]));
  assert.equal(byName.get('LogoFit')!.definition, 'photo_1');
  assert.equal(byName.get('LogoAutoSize')!.definition, 'logo');
  assert.equal(byName.get('Tagged')!.definition, 'logo');
  // The existing definitions are untouched.
  const logo = source.slice(
    source.indexOf('<EmbeddedImage Name="logo">'),
    source.indexOf('</EmbeddedImage>') + '</EmbeddedImage>'.length,
  );
  assert.ok(candidate.includes(logo));
});

test('planReplacePicture item scope onto an existing definition only repoints Value', () => {
  const source = authored();
  const { snapshot, image } = imageNamed(source, 'LogoFit');
  const result = planReplacePicture(snapshot, projectionOfSource(source).root, {
    scope: 'item',
    image,
    value: 'unused',
  });
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]!.expected, 'logo');
  assert.equal(
    projectReport(parse(snapshotOf(candidate))).images.find(
      (entry) => entry.name === 'LogoFit',
    )!.definition,
    'unused',
  );
});

test('planReplacePicture all scope rewrites ImageData and MIMEType in place', () => {
  const source = authored();
  const { snapshot, projection, root } = projectionOfSource(source);
  const definition = projection.embeddedImages.find(
    (entry) => entry.name === 'logo',
  )!;
  const result = planReplacePicture(snapshot, root, {
    scope: 'all',
    definition,
    mime: 'image/jpeg',
    base64: replacementBase64,
  });
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  assert.equal(result.patches.length, 2);
  assert.equal(candidate.match(/<EmbeddedImage /g)?.length, 3);
  const projected = projectReport(parse(snapshotOf(candidate)));
  const logo = projected.embeddedImages.find((entry) => entry.name === 'logo')!;
  assert.equal(logo.mime, 'image/jpeg');
  assert.equal(logo.format, 'jpeg');
  assert.equal(logo.displayable, true);
  assert.deepEqual(logo.references, ['LogoAutoSize', 'LogoFit', 'Tagged']);
  // Items are not touched at all.
  const items = (text: string) =>
    text.slice(text.indexOf('<ReportItems>'), text.indexOf('</ReportItems>'));
  assert.equal(items(candidate), items(source));
  // Sibling definitions stay byte-identical.
  const photo = source.slice(
    source.indexOf('<EmbeddedImage Name="photo">'),
    source.indexOf('</EmbeddedImage>', source.indexOf('Name="photo"')) +
      '</EmbeddedImage>'.length,
  );
  assert.ok(candidate.includes(photo));
});

test('planReplacePicture all scope refuses a structured ImageData', () => {
  const source = authored().replace(
    /<ImageData>[^<]*<\/ImageData>/,
    '<ImageData><x:Odd/></ImageData>',
  );
  const { snapshot, projection, root } = projectionOfSource(source);
  const definition = projection.embeddedImages[0]!;
  assert.throws(() =>
    planReplacePicture(snapshot, root, {
      scope: 'all',
      definition,
      mime: 'image/png',
      base64: pngBase64,
    }),
  );
});

// --- US4: definition rename and removal -------------------------------------

const referencesOf = (
  projection: ReturnType<typeof projectReport>,
  name: string,
) =>
  projection.images.filter(
    (entry) =>
      entry.source === 'Embedded' &&
      entry.value?.kind === 'constant' &&
      entry.value.text === name,
  );

test('planRenameDefinition renames the definition and every constant reference in one composed plan', () => {
  const source = authored();
  const { snapshot, projection } = projectionOfSource(source);
  const definition = projection.embeddedImages.find(
    (entry) => entry.name === 'logo',
  )!;
  const references = referencesOf(projection, 'logo');
  assert.equal(references.length, 3);
  const result = planRenameDefinition({
    snapshot,
    definition,
    newName: 'brand',
    references,
  });
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  // One patch for the Name attribute and one per referencing Value.
  assert.equal(result.patches.length, 4);
  assert.ok(candidate.includes('<EmbeddedImage Name="brand">'));
  assert.ok(!candidate.includes('<EmbeddedImage Name="logo">'));
  assert.equal(candidate.match(/<Value>brand<\/Value>/g)?.length, 3);
  assert.ok(!candidate.includes('<Value>logo</Value>'));
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(projected.status, 'editable');
  assert.deepEqual(
    projected.embeddedImages.map((entry) => entry.name),
    ['brand', 'photo', 'unused'],
  );
  assert.deepEqual(projected.embeddedImages[0]!.references, [
    'LogoAutoSize',
    'LogoFit',
    'Tagged',
  ]);
  assert.deepEqual(
    projected.images.map((entry) => [entry.name, entry.definition]),
    [
      ['LogoAutoSize', 'brand'],
      ['LogoFit', 'brand'],
      ['PhotoFitProportional', 'photo'],
      ['PhotoClip', 'photo'],
      ['Tagged', 'brand'],
    ],
  );
  // Untouched XML is byte-identical: payloads, other items, unknown children.
  const payload = (text: string, name: string) =>
    text.slice(
      text.indexOf(`<EmbeddedImage Name="${name}">`),
      text.indexOf('</EmbeddedImage>', text.indexOf(`Name="${name}"`)),
    );
  assert.equal(payload(candidate, 'photo'), payload(source, 'photo'));
  assert.equal(payload(candidate, 'unused'), payload(source, 'unused'));
  assert.ok(candidate.includes('<FutureThing level="2">kept</FutureThing>'));
  assert.ok(candidate.includes('<x:Opaque keep="1">preserve</x:Opaque>'));
  // The payload bytes of the renamed definition are untouched too.
  assert.equal(
    payload(candidate, 'brand').replace('Name="brand"', 'Name="logo"'),
    payload(source, 'logo'),
  );
});

test('planRenameDefinition of an unreferenced definition is a single patch', () => {
  const source = authored();
  const { snapshot, projection } = projectionOfSource(source);
  const result = planRenameDefinition({
    snapshot,
    definition: projection.embeddedImages.find(
      (entry) => entry.name === 'unused',
    )!,
    newName: 'spare',
    references: [],
  });
  assert.equal(result.patches.length, 1);
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  assert.equal(
    candidate,
    source.replace(
      '<EmbeddedImage Name="unused">',
      '<EmbeddedImage Name="spare">',
    ),
  );
});

test('planRenameDefinition escapes the new name in the attribute and the Value', () => {
  const source = authored();
  const { snapshot, projection } = projectionOfSource(source);
  const result = planRenameDefinition({
    snapshot,
    definition: projection.embeddedImages.find(
      (entry) => entry.name === 'photo',
    )!,
    newName: 'a&b',
    references: referencesOf(projection, 'photo'),
  });
  const candidate = apply(source, result);
  assert.ok(candidate.includes('<EmbeddedImage Name="a&amp;b">'));
  assert.equal(candidate.match(/<Value>a&amp;b<\/Value>/g)?.length, 2);
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.deepEqual(projected.embeddedImages[1]!.name, 'a&b');
  assert.deepEqual(projected.embeddedImages[1]!.references.length, 2);
});

test('planRenameDefinition refuses a reference whose Value is structured', () => {
  const source = authored().replace(
    '<Value>logo</Value>',
    '<Value><x:Odd/></Value>',
  );
  const { snapshot, projection } = projectionOfSource(source);
  const definition = projection.embeddedImages.find(
    (entry) => entry.name === 'logo',
  )!;
  // The structured Value is not a constant reference, so a caller passing it anyway is refused.
  assert.throws(() =>
    planRenameDefinition({
      snapshot,
      definition,
      newName: 'brand',
      references: [projection.images[0]!],
    }),
  );
});

test('planRemoveDefinition produces a single removal and leaves everything else byte-identical', () => {
  const source = authored();
  const { snapshot, projection, root } = projectionOfSource(source);
  const unused = projection.embeddedImages.find(
    (entry) => entry.name === 'unused',
  )!;
  const result = planRemoveDefinition(snapshot, root, unused);
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]!.replacement, '');
  assert.deepEqual(
    [result.patches[0]!.start, result.patches[0]!.end],
    [unused.node.range.start, unused.node.range.end],
  );
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  assert.equal(
    candidate,
    source.slice(0, unused.node.range.start) +
      source.slice(unused.node.range.end),
  );
  assert.equal(candidate.match(/<EmbeddedImages>/g)?.length, 1);
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(projected.status, 'editable');
  assert.deepEqual(
    projected.embeddedImages.map((entry) => entry.name),
    ['logo', 'photo'],
  );
  assert.equal(projected.images.length, 5);
});

test('planRemoveDefinition of the last definition removes the empty EmbeddedImages container', () => {
  const created = plan(load('blank.rdlc'), { definition, item }).candidate;
  // Drop the only item so that the definition is unreferenced.
  const source = created.replace(itemXml('Image1', 'logo'), '');
  const { snapshot, projection, root } = projectionOfSource(source);
  assert.equal(projection.embeddedImages.length, 1);
  const result = planRemoveDefinition(
    snapshot,
    root,
    projection.embeddedImages[0]!,
  );
  assert.equal(result.patches.length, 1);
  const candidate = apply(source, result);
  assertOnlyFootprintChanged(source, result, candidate);
  assert.ok(!candidate.includes('<EmbeddedImage'));
  assert.equal(
    candidate,
    source.replace(/<EmbeddedImages>[\s\S]*<\/EmbeddedImages>/, ''),
    'only the container goes',
  );
  const projected = projectReport(parse(snapshotOf(candidate)));
  assert.equal(projected.status, 'editable');
  assert.deepEqual(projected.embeddedImages, []);
});

test('planRemoveDefinition keeps the container when other definitions remain', () => {
  const source = authored();
  const { snapshot, projection, root } = projectionOfSource(source);
  const result = planRemoveDefinition(
    snapshot,
    root,
    projection.embeddedImages.find((entry) => entry.name === 'logo')!,
  );
  const candidate = apply(source, result);
  assert.ok(candidate.includes('<EmbeddedImages>'));
  assert.deepEqual(
    projectReport(parse(snapshotOf(candidate))).embeddedImages.map(
      (entry) => entry.name,
    ),
    ['photo', 'unused'],
  );
});

test('planRemoveDefinition refuses to drop a container that holds unknown content', () => {
  const source = authored()
    .replace(/<EmbeddedImage Name="photo">[\s\S]*?<\/EmbeddedImage>\s*/, '')
    .replace(
      /<EmbeddedImage Name="unused">[\s\S]*?<\/EmbeddedImage>/,
      '<x:Keep/>',
    );
  const { snapshot, projection, root } = projectionOfSource(source);
  assert.deepEqual(
    projection.embeddedImages.map((entry) => entry.name),
    ['logo'],
  );
  assert.throws(() =>
    planRemoveDefinition(snapshot, root, projection.embeddedImages[0]!),
  );
});
