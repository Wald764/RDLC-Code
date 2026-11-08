import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { pixelLimit, rawImageLimit } from '@rdlc/report-model/images';
import type { ImageItem } from '@rdlc/report-model/report';
import { parse } from './parser.js';
import { projectReport, RDL_2016 } from './project-report.js';
import { projectImages } from './project-images.js';

const fixture = (name: string) =>
  readFileSync(`tests/fixtures/images/${name}`, 'utf8');
const picture = (name: string) =>
  readFileSync(`tests/fixtures/images/pictures/${name}`);
const syntaxOf = (source: string) =>
  parse({ uri: 'fixture:images', version: 1, source, eol: '\n' });
const projectSource = (
  source: string,
  options?: Parameters<typeof projectImages>[1],
) => projectImages(syntaxOf(source).root, options);
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

const geometry = ['left', 'top', 'width', 'height'];
const editable = [
  'image',
  'name',
  ...geometry,
  'sizing',
  'value',
  'toolTip',
] as const;
const geometryOnly = ['name', ...geometry] as const;

const item = (items: readonly ImageItem[], name: string): ImageItem => {
  const found = items.find((candidate) => candidate.name === name);
  assert.ok(found, name);
  return found;
};

/** Everything but the XML node, which legitimately holds the source text. */
const withoutNodes = (value: unknown) =>
  JSON.stringify(value, (key, entry: unknown) =>
    key === 'node' ? undefined : entry,
  );

/** A valid logo.png padded with an ancillary chunk to exactly `total` bytes. */
const pngOfSize = (total: number): Buffer => {
  const png = picture('logo.png');
  const padding = Buffer.alloc(total - png.length - 12);
  const chunkType = Buffer.from('teXt');
  const lengthField = Buffer.alloc(4);
  lengthField.writeUInt32BE(padding.length);
  const crcField = Buffer.alloc(4);
  crcField.writeUInt32BE(crc32(Buffer.concat([chunkType, padding])));
  return Buffer.concat([
    png.subarray(0, png.length - 12),
    lengthField,
    chunkType,
    padding,
    crcField,
    png.subarray(png.length - 12),
  ]);
};

const wrap = (body: string, definitions = '') =>
  `<Report xmlns="${RDL_2016}"><ReportSections><ReportSection><Body><ReportItems>${body}</ReportItems><Height>2in</Height></Body><Width>6in</Width><Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth></Page></ReportSection></ReportSections>${definitions === '' ? '' : `<EmbeddedImages>${definitions}</EmbeddedImages>`}</Report>`;
const definition = (name: string, mime: string | null, data: string) =>
  `<EmbeddedImage Name="${name}">${mime === null ? '' : `<MIMEType>${mime}</MIMEType>`}<ImageData>${data}</ImageData></EmbeddedImage>`;
const logoData = picture('logo.png').toString('base64');
const embeddedItem = (name: string, value: string, extra = '') =>
  `<Image Name="${name}"><Source>Embedded</Source><Value>${value}</Value><MIMEType>image/png</MIMEType>${extra}<Top>0in</Top><Left>0in</Left><Height>1in</Height><Width>1in</Width></Image>`;

test('authored.rdlc definitions carry format, sizes, pixels and reference counts', () => {
  const source = fixture('authored.rdlc');
  const { embeddedImages } = projectSource(source);
  assert.deepEqual(
    embeddedImages.map((entry) => entry.name),
    ['logo', 'photo', 'unused'],
  );
  const [logo, photo, unused] = embeddedImages;
  assert.ok(logo && photo && unused);

  assert.equal(logo.format, 'png');
  assert.equal(logo.mime, 'image/png');
  assert.equal(logo.byteSize, picture('logo.png').length);
  assert.deepEqual(logo.pixels, { width: 120, height: 40 });
  assert.equal(logo.displayable, true);
  assert.equal(logo.reason, null);
  assert.deepEqual(logo.references, ['LogoAutoSize', 'LogoFit', 'Tagged']);

  assert.equal(photo.format, 'jpeg');
  assert.equal(photo.mime, 'image/jpeg');
  assert.equal(photo.byteSize, picture('photo.jpg').length);
  assert.deepEqual(photo.pixels, { width: 200, height: 150 });
  assert.equal(photo.displayable, true);
  assert.deepEqual(photo.references, ['PhotoFitProportional', 'PhotoClip']);

  assert.equal(unused.displayable, true);
  assert.deepEqual(unused.references, []);

  for (const entry of embeddedImages) {
    const data = /<ImageData>([^<]*)<\/ImageData>/.exec(
      source.slice(entry.node.range.start, entry.node.range.end),
    )![1]!;
    assert.equal(entry.encodedSize, data.replace(/\s+/g, '').length);
    assert.equal(
      source.slice(entry.nameRange.start, entry.nameRange.end),
      entry.name,
    );
  }
});

test('definition hash is null without a digest and SHA-256 of the decoded bytes with one', () => {
  const source = fixture('authored.rdlc');
  for (const entry of projectSource(source).embeddedImages)
    assert.equal(entry.hash, null);
  const hashed = projectSource(source, { digest: sha256 }).embeddedImages;
  assert.equal(hashed[0]!.hash, sha256(picture('logo.png')));
  assert.equal(hashed[1]!.hash, sha256(picture('photo.jpg')));
});

test('authored.rdlc items are editable with the full capability set and exact sizing', () => {
  const source = fixture('authored.rdlc');
  const { images } = projectSource(source);
  assert.deepEqual(
    images.map((entry) => [entry.name, entry.sizing]),
    [
      ['LogoAutoSize', 'AutoSize'],
      ['LogoFit', 'Fit'],
      ['PhotoFitProportional', 'FitProportional'],
      ['PhotoClip', 'Clip'],
      ['Tagged', 'Fit'],
    ],
  );
  for (const entry of images) {
    assert.equal(entry.context, 'body');
    assert.equal(entry.source, 'Embedded');
    assert.equal(entry.reason, null);
    assert.deepEqual(entry.capabilities, editable, entry.name ?? '');
    assert.equal(entry.value?.kind, 'constant');
    assert.ok(entry.sizingRange);
    assert.equal(
      source.slice(entry.nameRange!.start, entry.nameRange!.end),
      entry.name,
    );
  }
  const logoFit = item(images, 'LogoFit');
  assert.equal(logoFit.definition, 'logo');
  assert.deepEqual(logoFit.value, { kind: 'constant', text: 'logo' });
  assert.deepEqual(logoFit.bounds, {
    left: '0.25in',
    top: '0.9in',
    width: '1.5in',
    height: '0.5in',
  });
  assert.equal(
    source.slice(logoFit.sizingRange!.start, logoFit.sizingRange!.end),
    '<Sizing>Fit</Sizing>',
  );
  assert.equal(
    source.slice(
      logoFit.boundsRanges.top!.start,
      logoFit.boundsRanges.top!.end,
    ),
    '<Top>0.9in</Top>',
  );
  assert.equal(item(images, 'PhotoClip').definition, 'photo');
  // Unknown children and foreign attributes never change the state.
  assert.equal(item(images, 'Tagged').definition, 'logo');
});

test('preserved.rdlc items map to the expected reason, state and definition', () => {
  const { images } = projectSource(fixture('preserved.rdlc'));
  const expected: Array<
    [
      string,
      ImageItem['context'],
      ImageItem['source'],
      ImageItem['reason'],
      readonly string[],
      string | null,
    ]
  > = [
    ['ExternalPicture', 'body', 'External', 'source-preserved', [], null],
    ['DatabasePicture', 'body', 'Database', 'source-preserved', [], null],
    ['ExpressionPicture', 'body', 'Embedded', 'value-expression', [], null],
    [
      'GifPicture',
      'body',
      'Embedded',
      'format-unsupported',
      geometryOnly,
      'spinner',
    ],
    [
      'BmpPicture',
      'body',
      'Embedded',
      'format-unsupported',
      geometryOnly,
      'bitmap',
    ],
    [
      'LegacyPngPicture',
      'body',
      'Embedded',
      'mime-mismatch',
      geometryOnly,
      'legacy',
    ],
    [
      'BrokenPicture',
      'body',
      'Embedded',
      'data-invalid',
      geometryOnly,
      'broken',
    ],
    [
      'GhostPicture',
      'body',
      'Embedded',
      'reference-missing',
      geometryOnly,
      null,
    ],
    ['CellPicture', 'table-cell', 'Embedded', 'source-preserved', [], 'logo'],
  ];
  assert.deepEqual(
    images.map((entry) => entry.name),
    expected.map((row) => row[0]),
  );
  for (const [
    name,
    context,
    source,
    reason,
    capabilities,
    definitionName,
  ] of expected) {
    const entry = item(images, name);
    assert.equal(entry.context, context, name);
    assert.equal(entry.source, source, name);
    assert.equal(entry.reason, reason, name);
    assert.deepEqual(entry.capabilities, capabilities, name);
    assert.equal(entry.definition, definitionName, name);
  }
  assert.equal(item(images, 'DatabasePicture').value?.kind, 'expression');
  assert.equal(item(images, 'ExpressionPicture').value?.kind, 'expression');
  assert.equal(item(images, 'ExternalPicture').value?.kind, 'constant');
  assert.equal(item(images, 'CellPicture').sizing, 'Fit');
});

test('preserved.rdlc definitions report why they are not displayable', () => {
  const source = fixture('preserved.rdlc');
  const { embeddedImages } = projectSource(source, { digest: sha256 });
  const byName = (name: string) => {
    const found = embeddedImages.find((entry) => entry.name === name);
    assert.ok(found, name);
    return found;
  };
  assert.deepEqual(
    embeddedImages.map((entry) => entry.name),
    ['logo', 'spinner', 'bitmap', 'legacy', 'broken'],
  );
  const logo = byName('logo');
  assert.equal(logo.displayable, true);
  assert.deepEqual(logo.references, ['CellPicture']);

  const spinner = byName('spinner');
  assert.equal(spinner.format, 'other');
  assert.equal(spinner.displayable, false);
  assert.equal(spinner.reason, 'format-unsupported');
  assert.equal(spinner.byteSize, 43);
  assert.equal(spinner.pixels, null);
  assert.equal(spinner.hash, null);
  assert.deepEqual(spinner.references, ['GifPicture']);

  const bitmap = byName('bitmap');
  assert.equal(bitmap.format, 'other');
  assert.equal(bitmap.reason, 'format-unsupported');
  assert.deepEqual(bitmap.references, ['BmpPicture']);

  const legacy = byName('legacy');
  assert.equal(legacy.format, 'png');
  assert.equal(legacy.mime, 'image/x-png');
  assert.deepEqual(legacy.pixels, { width: 120, height: 40 });
  assert.equal(legacy.displayable, false);
  assert.equal(legacy.reason, 'mime-mismatch');
  assert.equal(legacy.hash, null);

  const broken = byName('broken');
  assert.equal(broken.format, 'other');
  assert.equal(broken.encodedSize, '!!not*base64!!'.length);
  assert.equal(broken.byteSize, null);
  assert.equal(broken.pixels, null);
  assert.equal(broken.displayable, false);
  assert.equal(broken.reason, 'data-invalid');
  assert.deepEqual(broken.references, ['BrokenPicture']);
});

test('Sizing defaults to AutoSize when absent and its range is then null', () => {
  const { images } = projectSource(
    wrap(
      embeddedItem('NoSizing', 'logo'),
      definition('logo', 'image/png', logoData),
    ),
  );
  assert.equal(images[0]!.sizing, 'AutoSize');
  assert.equal(images[0]!.sizingRange, null);
  assert.deepEqual(images[0]!.capabilities, editable);
});

test('an invalid or duplicated Sizing, Value, Source or ToolTip makes the item preservation-only', () => {
  const definitions = definition('logo', 'image/png', logoData);
  for (const extra of [
    '<Sizing>Stretch</Sizing>',
    '<Sizing>=Parameters!S.Value</Sizing>',
    '<Sizing>Fit</Sizing><Sizing>Clip</Sizing>',
    '<Source>Embedded</Source>',
    '<Value>logo</Value>',
    '<ToolTip>One</ToolTip><ToolTip>Two</ToolTip>',
  ]) {
    const { images } = projectSource(
      wrap(embeddedItem('Odd', 'logo', extra), definitions),
    );
    assert.deepEqual(images[0]!.capabilities, [], extra);
  }
});

test('ToolTip is read as inert text and flagged when it is an expression', () => {
  const definitions = definition('logo', 'image/png', logoData);
  const [literal, dynamic, none] = projectSource(
    wrap(
      embeddedItem('A', 'logo', '<ToolTip>Company logo</ToolTip>') +
        embeddedItem('B', 'logo', '<ToolTip>=Fields!Tip.Value</ToolTip>') +
        embeddedItem('C', 'logo'),
      definitions,
    ),
  ).images;
  assert.deepEqual(literal!.toolTip, {
    text: 'Company logo',
    expression: false,
  });
  assert.deepEqual(dynamic!.toolTip, {
    text: '=Fields!Tip.Value',
    expression: true,
  });
  assert.equal(none!.toolTip, null);
});

test('nested, absent-closing and non-editable-report items never gain capabilities', () => {
  const definitions = definition('logo', 'image/png', logoData);
  const nested = projectSource(
    wrap(
      `<Rectangle Name="Box"><ReportItems>${embeddedItem('Inner', 'logo')}</ReportItems></Rectangle>`,
      definitions,
    ),
  ).images;
  assert.equal(nested[0]!.context, 'preserved');
  assert.deepEqual(nested[0]!.capabilities, []);

  const selfClosing = projectSource(
    wrap('<Image Name="Empty"/>', definitions),
  ).images;
  assert.deepEqual(selfClosing[0]!.capabilities, []);
  assert.equal(selfClosing[0]!.value, null);
  assert.equal(selfClosing[0]!.source, null);

  const readOnly = projectSource(
    wrap(embeddedItem('Locked', 'logo'), definitions),
    { editable: false },
  ).images;
  assert.deepEqual(readOnly[0]!.capabilities, []);
});

test('definition reasons follow content, limits and MIME, never the declared MIME alone', () => {
  const huge = picture('huge-dims.png').toString('base64');
  const mega = picture('mega-pixels.png').toString('base64');
  const cases: Array<[string, string | null, string, string, boolean]> = [
    ['huge', 'image/png', huge, 'pixels-exceeded', false],
    ['mega', 'image/png', mega, 'pixels-exceeded', false],
    [
      'trunc',
      'image/png',
      picture('truncated.png').toString('base64'),
      'data-invalid',
      false,
    ],
    [
      'crc',
      'image/png',
      picture('bad-crc.png').toString('base64'),
      'data-invalid',
      false,
    ],
    [
      'spoof',
      'image/png',
      picture('spoofed.png').toString('base64'),
      'mime-mismatch',
      false,
    ],
    [
      'gif',
      'image/gif',
      picture('gif.gif').toString('base64'),
      'format-unsupported',
      false,
    ],
    [
      'prog',
      'image/jpeg',
      picture('progressive.jpg').toString('base64'),
      '',
      true,
    ],
    ['nomime', null, logoData, 'mime-mismatch', false],
    ['exprmime', '=Fields!M.Value', logoData, 'value-expression', false],
    ['jpg', 'image/jpg', logoData, 'mime-mismatch', false],
  ];
  const { embeddedImages } = projectSource(
    wrap(
      '',
      cases.map(([name, mime, data]) => definition(name, mime, data)).join(''),
    ),
    { digest: sha256 },
  );
  assert.equal(embeddedImages.length, cases.length);
  for (const [name, , , reason, displayable] of cases) {
    const entry = embeddedImages.find((candidate) => candidate.name === name)!;
    assert.equal(entry.displayable, displayable, name);
    assert.equal(entry.reason, displayable ? null : reason, name);
    assert.equal(entry.hash === null, !displayable, name);
  }
  const mine = embeddedImages.find((entry) => entry.name === 'mega')!;
  assert.ok(mine.pixels!.width * mine.pixels!.height > pixelLimit);
  assert.equal(
    embeddedImages.find((entry) => entry.name === 'exprmime')!.mime,
    null,
  );
  assert.equal(
    embeddedImages.find((entry) => entry.name === 'nomime')!.mime,
    null,
  );
  assert.equal(
    embeddedImages.find((entry) => entry.name === 'spoof')!.format,
    'jpeg',
  );
});

test('the raw size limit is exact and oversized text is classified without decoding', () => {
  // One report per picture: together they would exceed the 16 MiB parse budget.
  const project = (total: number) =>
    projectSource(
      wrap(
        '',
        definition('p', 'image/png', pngOfSize(total).toString('base64')),
      ),
      { digest: sha256 },
    ).embeddedImages[0]!;

  const edge = project(rawImageLimit);
  assert.equal(edge.displayable, true);
  assert.equal(edge.byteSize, rawImageLimit);
  assert.equal(edge.hash?.length, 64);

  // One byte over still decodes, so its exact size is known.
  const over = project(rawImageLimit + 1);
  assert.equal(over.reason, 'too-large');
  assert.equal(over.byteSize, rawImageLimit + 1);
  assert.equal(over.displayable, false);
  assert.equal(over.hash, null);

  // An encoded length beyond the limit is never decoded: size and structure unknown.
  const big = project(rawImageLimit + 4096);
  assert.equal(big.reason, 'too-large');
  assert.equal(big.byteSize, null);
  assert.equal(big.format, 'other');
  assert.equal(big.pixels, null);
  assert.equal(big.hash, null);
  assert.ok(big.encodedSize > Math.ceil(rawImageLimit / 3) * 4);
});

test('projected output and diagnostics never contain image payload', () => {
  for (const name of ['authored.rdlc', 'preserved.rdlc']) {
    const source = fixture(name);
    const syntax = syntaxOf(source);
    const result = projectImages(syntax.root, { digest: sha256 });
    const projection = projectReport(syntax, { digest: sha256 });
    const payloads = result.embeddedImages
      .map((entry) =>
        /<ImageData>([^<]*)<\/ImageData>/
          .exec(source.slice(entry.node.range.start, entry.node.range.end))![1]!
          .replace(/\s+/g, ''),
      )
      .filter((text) => text.length >= 48)
      .flatMap((text) => {
        const middle = (text.length - 24) >> 1;
        return [
          text.slice(0, 24),
          text.slice(middle, middle + 24),
          text.slice(text.length - 24),
        ];
      });
    assert.ok(payloads.length > 0);
    const output =
      withoutNodes(result) +
      withoutNodes(projection.diagnostics) +
      withoutNodes(projection.images) +
      withoutNodes(projection.embeddedImages);
    for (const payload of payloads) assert.ok(!output.includes(payload), name);
  }
});

test('an expression Source is preservation-only whatever its definition', () => {
  const { images } = projectSource(
    wrap(
      '<Image Name="Dynamic"><Source>=Parameters!Kind.Value</Source><Value>logo</Value><MIMEType>image/png</MIMEType><Top>0in</Top><Left>0in</Left><Height>1in</Height><Width>1in</Width></Image>',
      definition('logo', 'image/png', logoData),
    ),
  );
  assert.equal(images[0]!.source, 'expression');
  assert.equal(images[0]!.definition, null);
  assert.equal(images[0]!.reason, 'source-preserved');
  assert.deepEqual(images[0]!.capabilities, []);
});

test('an Image in a page header stays preserved even with a displayable definition', () => {
  const source = wrap('', definition('logo', 'image/png', logoData)).replace(
    '</PageWidth></Page>',
    `</PageWidth><PageHeader><ReportItems>${embeddedItem('Header', 'logo')}</ReportItems></PageHeader></Page>`,
  );
  const { images, embeddedImages } = projectSource(source);
  assert.equal(images.length, 1);
  assert.equal(images[0]!.context, 'preserved');
  assert.equal(images[0]!.definition, 'logo');
  assert.deepEqual(images[0]!.capabilities, []);
  assert.equal(images[0]!.reason, 'source-preserved');
  // It still references the definition, so removal checks see it.
  assert.deepEqual(embeddedImages[0]!.references, ['Header']);
});

test('expression geometry removes the geometry keys and keeps the name', () => {
  const item = (definitionName: string) =>
    `<Image Name="Dyn"><Source>Embedded</Source><Value>${definitionName}</Value><MIMEType>image/png</MIMEType><Top>=1</Top><Left>=1</Left><Height>=1</Height><Width>=1</Width></Image>`;
  const definitions = definition('logo', 'image/png', logoData);
  // Definition missing: geometry-only, and with no geometry key it is just the name.
  const missing = projectSource(wrap(item('ghost'), definitions)).images[0]!;
  assert.deepEqual(missing.capabilities, ['name']);
  assert.equal(missing.reason, 'reference-missing');
  assert.deepEqual(missing.bounds, {
    left: '=1',
    top: '=1',
    width: '=1',
    height: '=1',
  });
  // Displayable definition: the picture keys remain, the geometry keys never appear.
  const resolved = projectSource(wrap(item('logo'), definitions)).images[0]!;
  assert.deepEqual(resolved.capabilities, [
    'image',
    'name',
    'sizing',
    'value',
    'toolTip',
  ]);
});

test('an unnamed item still counts as a reference, under its node id', () => {
  const { images, embeddedImages } = projectSource(
    wrap(
      '<Image><Source>Embedded</Source><Value>logo</Value><MIMEType>image/png</MIMEType></Image>',
      definition('logo', 'image/png', logoData),
    ),
  );
  assert.equal(images[0]!.name, null);
  assert.ok(!images[0]!.capabilities.includes('name'));
  assert.deepEqual(embeddedImages[0]!.references, [images[0]!.node.id]);
});

test('a repeated definition name never resolves and is neither displayable nor hashed', () => {
  const { images, embeddedImages } = projectSource(
    wrap(
      embeddedItem('Uses', 'logo'),
      definition('logo', 'image/png', logoData) +
        definition('logo', 'image/png', logoData) +
        definition('other', 'image/png', logoData),
    ),
    { digest: sha256 },
  );
  assert.equal(embeddedImages.length, 3);
  const [first, repeat, other] = embeddedImages;
  assert.equal(first!.displayable, true);
  assert.equal(first!.hash, sha256(picture('logo.png')));
  assert.deepEqual(first!.references, ['Uses']);
  assert.equal(repeat!.name, 'logo');
  assert.equal(repeat!.displayable, false);
  assert.equal(repeat!.reason, 'data-invalid');
  assert.equal(repeat!.hash, null);
  assert.deepEqual(repeat!.references, []);
  assert.equal(other!.displayable, true);
  assert.equal(images[0]!.definition, 'logo');
});

test('projectReport exposes images and definitions and removes authorable items from preserved', () => {
  for (const [name, leaves, stays] of [
    [
      'authored.rdlc',
      [
        'LogoAutoSize',
        'LogoFit',
        'PhotoFitProportional',
        'PhotoClip',
        'Tagged',
      ],
      [],
    ],
    [
      'preserved.rdlc',
      [
        'GifPicture',
        'BmpPicture',
        'LegacyPngPicture',
        'BrokenPicture',
        'GhostPicture',
      ],
      [
        'ExternalPicture',
        'DatabasePicture',
        'ExpressionPicture',
        'CellPicture',
      ],
    ],
  ] as const) {
    const source = fixture(name);
    const projection = projectReport(syntaxOf(source));
    assert.equal(projection.status, 'editable');
    assert.ok(projection.embeddedImages.length > 0);
    const preservedIds = new Set(projection.preserved.map((p) => p.nodeId));
    for (const leaving of leaves) {
      const entry = item(projection.images, leaving);
      assert.ok(!preservedIds.has(entry.node.id), leaving);
      assert.ok(
        !projection.preserved.some(
          (p) =>
            p.range.start >= entry.node.range.start &&
            p.range.end <= entry.node.range.end,
        ),
        `${leaving}: no region inside the item`,
      );
    }
    for (const staying of stays)
      assert.ok(
        preservedIds.has(item(projection.images, staying).node.id),
        staying,
      );
    // Definitions are never detached; they stay preserved regions.
    for (const entry of projection.embeddedImages)
      assert.ok(preservedIds.has(entry.node.id), entry.name);
  }
});

test('projectReport leaves unsupported profiles with no images and keeps hashes host-supplied', () => {
  const old = fixture('authored.rdlc').replace(RDL_2016, 'urn:other:profile');
  const projection = projectReport(syntaxOf(old));
  assert.equal(projection.status, 'source-only');
  assert.deepEqual(projection.images, []);
  assert.deepEqual(projection.embeddedImages, []);

  const plain = projectReport(syntaxOf(fixture('authored.rdlc')));
  assert.ok(plain.embeddedImages.every((entry) => entry.hash === null));
  const hashed = projectReport(syntaxOf(fixture('authored.rdlc')), {
    digest: sha256,
  });
  assert.ok(hashed.embeddedImages.every((entry) => entry.hash?.length === 64));
});

test('a report without EmbeddedImages projects empty collections', () => {
  const projection = projectReport(syntaxOf(fixture('blank.rdlc')));
  assert.equal(projection.status, 'editable');
  assert.deepEqual(projection.images, []);
  assert.deepEqual(projection.embeddedImages, []);
});

/** Every string in a value, skipping the XML nodes that legitimately hold the source. */
function stringsOf(value: unknown, path = '$'): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'node' ? [] : stringsOf(entry, `${path}.${key}`),
  );
}

/**
 * FR-024 rule for the projection of preserved images. Nothing is fetched, opened, resolved
 * from a path or evaluated. The only source text an image projection carries is inert: the
 * constant `Value` text and the `ToolTip` text, kept exactly as written and never
 * interpreted. An expression `Value` is `{kind:'expression'}` with no text at all.
 */
test('projecting preserved.rdlc fetches nothing, resolves no path and evaluates no expression', () => {
  const source = fixture('preserved.rdlc');
  const syntax = syntaxOf(source);
  const fetched: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((...args: unknown[]) => {
    fetched.push(args);
    throw new Error('network access is forbidden');
  }) as typeof fetch;
  let result: ReturnType<typeof projectImages>;
  let projection: ReturnType<typeof projectReport>;
  try {
    result = projectImages(syntax.root, { digest: sha256 });
    projection = projectReport(syntax, { digest: sha256 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(fetched, []);

  const outputs = [
    result,
    projection.images,
    projection.embeddedImages,
    projection.diagnostics,
  ];
  const strings = outputs.flatMap((output) => stringsOf(output));

  // No URL: the one literal URL of the fixture survives only as the inert constant text
  // of the External item, and is never a definition, a name or a diagnostic.
  const url = /(?:https?|file|data|blob):/i;
  const external = item(result.images, 'ExternalPicture');
  assert.equal(external.source, 'External');
  assert.deepEqual(
    [
      ...new Set(
        strings.filter(([, text]) => url.test(text)).map(([, t]) => t),
      ),
    ],
    ['http://example.invalid/pictures/logo.png'],
  );
  assert.equal(
    strings
      .filter(([, text]) => url.test(text))
      .every(([where]) => where.endsWith('.value.text')),
    true,
  );
  assert.equal(external.definition, null);
  assert.equal(external.reason, 'source-preserved');
  assert.deepEqual(projection.diagnostics, []);

  // No resolved path: no absolute, relative or working-directory path appears anywhere.
  for (const [where, text] of strings) {
    assert.ok(!text.includes(process.cwd()), where);
    assert.ok(!text.includes('tests/fixtures'), where);
    assert.ok(
      !/^(?:[A-Za-z]:[\\/]|\.{0,2}\/|\\\\)/.test(text),
      `${where}: ${text}`,
    );
  }

  // No evaluated expression: expression values keep no text and bind to no definition,
  // whatever the expression would have returned ("logo" or "photo" here).
  for (const name of ['DatabasePicture', 'ExpressionPicture']) {
    const entry = item(result.images, name);
    assert.deepEqual(entry.value, { kind: 'expression' }, name);
    assert.equal(entry.definition, null, name);
    assert.deepEqual(entry.capabilities, [], name);
  }
  for (const [where, text] of strings)
    for (const fragment of [
      'Fields!',
      'Parameters!',
      'IIf',
      'UseLogo',
      'Photo.Value',
    ])
      assert.ok(!text.includes(fragment), `${where}: ${fragment}`);
  assert.deepEqual(
    result.embeddedImages.find((entry) => entry.name === 'logo')!.references,
    ['CellPicture'],
    'no expression result adds a reference',
  );
});
