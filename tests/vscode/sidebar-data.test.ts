import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dataCommandActions,
  dataCreateCommand,
  imageCommandActions,
} from '../../apps/vscode-extension/src/sidebar/views.js';
import { history } from './session-checks.js';
import {
  ForbiddenImageSource,
  withNativeViews,
  type NativeHarness,
  type NativeRow,
} from './sidebar-harness.js';

interface Manifest {
  readonly contributes: {
    readonly commands: readonly { readonly command: string }[];
    readonly menus: Readonly<
      Record<
        string,
        readonly { readonly command: string; readonly when?: string }[]
      >
    >;
  };
}

/**
 * US3 wiring regression: the five native Data commands declared in
 * package.json are exactly the ones the sidebar registers, and their menu
 * scopes stay limited to the Data view. Handler behavior (capability guard,
 * existing form route, no authoring payload) is covered by
 * `apps/vscode-extension/src/sidebar-actions.test.ts`.
 */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('Wald764.rdlc-code');
  assert.ok(extension, 'the installed or development extension is discovered');
  await extension.activate();
  const manifest = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../apps/vscode-extension/package.json'),
      'utf8',
    ),
  ) as Manifest;
  const contributed = manifest.contributes.commands
    .map((entry) => entry.command)
    .filter((id) => id.startsWith('rdlcCode.sidebar.data'));
  const registered = [
    ...Object.keys(dataCommandActions),
    dataCreateCommand,
  ].map((id) => `rdlcCode.sidebar.${id}`);
  assert.deepEqual(
    [...registered].sort(),
    [...contributed].sort(),
    'every contributed Data command is registered, and nothing extra',
  );
  const commands = await vscode.commands.getCommands(true);
  for (const id of contributed)
    assert.ok(
      commands.includes(id),
      `${id} is registered in the live Extension Host`,
    );

  const title = manifest.contributes.menus['view/title'] ?? [];
  assert.ok(
    title.some(
      (entry) =>
        entry.command === `rdlcCode.sidebar.${dataCreateCommand}` &&
        /view == rdlcCode\.data/.test(entry.when ?? ''),
    ),
    'dataset creation stays a Data view title action',
  );
  const itemContext = manifest.contributes.menus['view/item/context'] ?? [];
  for (const id of Object.keys(dataCommandActions)) {
    const entry = itemContext.find(
      (candidate) => candidate.command === `rdlcCode.sidebar.${id}`,
    );
    assert.ok(entry, `${id} has a row menu entry`);
    assert.match(
      entry.when ?? '',
      /view == rdlcCode\.data/,
      `${id} never appears outside the Data view`,
    );
  }

  await imageCommandWiring(manifest, commands);
  await imageRowsAndMetadata();
  await imageInsert();
  await imageRename();
  await imageRemove();
}

const fixtures = resolve(__dirname, '../../../tests/fixtures/images');
const authored = () => readFileSync(resolve(fixtures, 'authored.rdlc'), 'utf8');

/** The Report Data and Structure rows by node kind and name. */
async function row(
  harness: NativeHarness,
  view: 'structure' | 'data',
  kind: string,
  name: string,
): Promise<NativeRow> {
  const found = (await harness.rows(view)).find(
    (entry) => entry.node?.kind === kind && entry.node.name === name,
  );
  assert.ok(found, `${view}: ${kind} ${name}`);
  return found;
}
const definitionRow = (harness: NativeHarness, name: string) =>
  row(harness, 'data', 'embedded-image', name);

const embeddedNames = (text: string) =>
  [...text.matchAll(/<EmbeddedImage Name="([^"]+)"/g)].map((match) => match[1]);
const payloadProbes = (text: string) =>
  [...text.matchAll(/<ImageData>([^<]{40,})</g)].map((match) =>
    match[1]!.trim().slice(0, 40),
  );
const noPayload = (probes: readonly string[], ...texts: unknown[]) => {
  for (const text of texts)
    for (const probe of probes)
      assert.ok(!String(JSON.stringify(text)).includes(probe));
};

/** The three image commands are contributed, registered live and scoped to Report Data. */
async function imageCommandWiring(
  manifest: Manifest,
  commands: readonly string[],
): Promise<void> {
  const contributed = manifest.contributes.commands
    .map((entry) => entry.command)
    .filter((id) => id.startsWith('rdlcCode.sidebar.image'));
  assert.deepEqual(
    Object.keys(imageCommandActions)
      .map((id) => `rdlcCode.sidebar.${id}`)
      .sort(),
    [...contributed].sort(),
    'every contributed image command is registered, and nothing extra',
  );
  assert.deepEqual([...contributed].sort(), [
    'rdlcCode.sidebar.imageInsert',
    'rdlcCode.sidebar.imageRemove',
    'rdlcCode.sidebar.imageRename',
  ]);
  for (const id of contributed)
    assert.ok(commands.includes(id), `${id} is registered in the live host`);
  const itemContext = manifest.contributes.menus['view/item/context'] ?? [];
  for (const id of contributed) {
    const entry = itemContext.find((candidate) => candidate.command === id);
    assert.ok(entry, `${id} has a row menu entry`);
    assert.match(entry.when ?? '', /view == rdlcCode\.data/, id);
    assert.match(entry.when ?? '', /dataEmbeddedImage/, id);
  }
}

/** Structure lists image items; Data lists definitions with metadata and no payload. */
async function imageRowsAndMetadata(): Promise<void> {
  const source = authored();
  const probes = payloadProbes(source);
  assert.ok(probes.length >= 3);
  await withNativeViews(source, async (harness) => {
    const items = (await harness.rows('structure')).filter(
      (entry) => entry.node?.kind === 'image',
    );
    assert.deepEqual(
      items.map((entry) => entry.node!.name),
      [
        'LogoAutoSize',
        'LogoFit',
        'PhotoFitProportional',
        'PhotoClip',
        'Tagged',
      ],
      'image items in source order',
    );
    for (const entry of items) {
      const item = await harness.item('structure', entry);
      assert.equal((item.iconPath as vscode.ThemeIcon).id, 'file-media');
      assert.equal(item.contextValue, 'rdlcCode.body', entry.label);
      noPayload(probes, item.label, item.description, item.tooltip);
    }

    const expected: Record<string, [string, string]> = {
      logo: [
        'dataEmbeddedImage.displayable dataEmbeddedImage.referenced',
        '3 references',
      ],
      photo: [
        'dataEmbeddedImage.displayable dataEmbeddedImage.referenced',
        '2 references',
      ],
      unused: [
        'dataEmbeddedImage.displayable dataEmbeddedImage.unreferenced',
        '0 references',
      ],
    };
    for (const [name, [contextValue, count]] of Object.entries(expected)) {
      const item = await harness.item(
        'data',
        await definitionRow(harness, name),
      );
      assert.equal((item.iconPath as vscode.ThemeIcon).id, 'file-media', name);
      assert.equal(item.contextValue, contextValue, name);
      assert.match(
        String(item.description),
        /^(PNG|JPEG) · \d+x\d+ px · /,
        name,
      );
      assert.ok(
        String(item.description).endsWith(count),
        `${name}: ${item.description}`,
      );
      assert.match(String(item.tooltip), /references: \d+/);
      noPayload(
        probes,
        item.label,
        item.description,
        item.tooltip,
        item.accessibilityInformation,
      );
    }
    // The projection that feeds the views carries no payload either.
    noPayload(probes, harness.host.evaluation!.navigation);
  });
}

/** Insert adds an item for an existing definition without opening the file chooser. */
async function imageInsert(): Promise<void> {
  const source = authored();
  const chooser = new ForbiddenImageSource();
  await withNativeViews(
    source,
    async (harness) => {
      const { document } = harness;
      const before = document.version;
      const run = await harness.call(
        'rdlcCode.sidebar.imageInsert',
        await definitionRow(harness, 'unused'),
      );
      assert.deepEqual(run.warnings, []);
      assert.equal(run.infos.length, 1);
      assert.equal(chooser.calls, 0, 'no file chooser, no stat, no read');
      assert.equal(document.version, before + 1, 'one edit');
      const text = document.getText();
      assert.equal(text.match(/<Image /g)?.length, 6);
      assert.deepEqual(embeddedNames(text), ['logo', 'photo', 'unused']);
      assert.equal(text.match(/<Value>unused<\/Value>/g)?.length, 1);
      // One native Undo removes the item; Redo restores it.
      await vscode.window.showTextDocument(document);
      await history(document, 'undo', source);
      await vscode.window.showTextDocument(document);
      await history(document, 'redo', text);
    },
    chooser,
  );
  // A definition that is not a displayable picture cannot be inserted.
  // Fixtures may be checked out with CRLF: the whitespace between the tags is kept.
  const gif = source.replace(
    /<MIMEType>image\/png<\/MIMEType>(\s*)<ImageData>/,
    '<MIMEType>image/gif</MIMEType>$1<ImageData>',
  );
  assert.notEqual(gif, source);
  await withNativeViews(gif, async (harness) => {
    const version = harness.document.version;
    const run = await harness.call(
      'rdlcCode.sidebar.imageInsert',
      await definitionRow(harness, 'logo'),
    );
    assert.equal(run.warnings.length, 1);
    assert.match(run.warnings[0]!, /not a displayable PNG or JPEG/);
    assert.equal(harness.document.version, version, 'nothing was written');
  });
}

/** Rename rewrites the definition and every constant reference in one undo step. */
async function imageRename(): Promise<void> {
  const source = authored();
  const probes = payloadProbes(source);
  await withNativeViews(source, async (harness) => {
    const { document } = harness;
    const logo = await definitionRow(harness, 'logo');

    // The input box validates the name with the report's own rule.
    const cancelled = await harness.call('rdlcCode.sidebar.imageRename', logo, [
      undefined,
    ]);
    assert.deepEqual(cancelled.warnings, []);
    assert.equal(document.getText(), source, 'a cancelled box writes nothing');
    const validate = cancelled.inputs[0]!.options.validateInput!;
    assert.equal(validate('brand'), null);
    assert.equal(validate('logo'), null, 'the current name stays acceptable');
    for (const bad of ['photo', 'unused', '', '1x', 'has space'])
      assert.equal(typeof validate(bad), 'string', JSON.stringify(bad));
    assert.ok(!String(validate('photo')).includes('photo'));
    const unchanged = await harness.call('rdlcCode.sidebar.imageRename', logo, [
      'logo',
    ]);
    assert.deepEqual(unchanged.warnings, []);
    assert.equal(document.getText(), source, 'the same name writes nothing');

    const before = document.version;
    const run = await harness.call('rdlcCode.sidebar.imageRename', logo, [
      'brand',
    ]);
    assert.deepEqual(run.warnings, []);
    assert.equal(document.version, before + 1, 'one edit, one undo step');
    const renamed = document.getText();
    assert.deepEqual(embeddedNames(renamed), ['brand', 'photo', 'unused']);
    assert.equal(renamed.match(/<Value>brand<\/Value>/g)?.length, 3);
    assert.ok(!renamed.includes('<Value>logo</Value>'));
    assert.ok(renamed.includes('<FutureThing level="2">kept</FutureThing>'));
    assert.equal(renamed.match(/<Value>photo<\/Value>/g)?.length, 2);
    noPayload(probes, run);
    await vscode.window.showTextDocument(document);
    await history(document, 'undo', source);
    await vscode.window.showTextDocument(document);
    await history(document, 'redo', renamed);
    await vscode.window.showTextDocument(document);
    await history(document, 'undo', source);
  });

  // An expression Value that could name the definition blocks the rename and lists the item.
  const expression = source.replace(
    '</ReportItems>',
    '<Image Name="Dynamic"><Source>Embedded</Source><Value>=Parameters!Which.Value</Value><Sizing>Fit</Sizing><Top>3.5in</Top><Left>2in</Left><Height>0.5in</Height><Width>1in</Width></Image></ReportItems>',
  );
  await withNativeViews(expression, async (harness) => {
    const version = harness.document.version;
    const run = await harness.call(
      'rdlcCode.sidebar.imageRename',
      await definitionRow(harness, 'logo'),
      ['brand'],
    );
    assert.equal(run.inputs.length, 0, 'refused before the name is asked');
    assert.equal(run.warnings.length, 1);
    assert.match(run.warnings[0]!, /"Dynamic"/);
    assert.match(run.warnings[0]!, /expression/);
    assert.equal(harness.document.version, version);
    assert.equal(harness.document.getText(), expression);

    // The host edit path enforces the same guard when the command is bypassed.
    const rootId = harness.host.evaluation!.syntax.root!.id;
    const requestId = 'forced-rename';
    harness.session.receive({
      protocol: 2,
      kind: 'edit',
      requestId,
      baseVersion: harness.document.version,
      targetId: rootId,
      operation: 'author',
      payload: {
        action: 'renameEmbeddedImage',
        definition: 'logo',
        newName: 'brand',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const result = harness.messages.find(
      (message) =>
        message.kind === 'editResult' && message.requestId === requestId,
    );
    assert.ok(result && result.kind === 'editResult');
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'IMAGE_RENAME_BLOCKED');
    assert.ok(
      result.diagnostics.some((entry) => entry.message.includes('"Dynamic"')),
    );
    assert.equal(harness.document.getText(), expression);
  });
}

/** Remove succeeds for an unreferenced definition and lists the references otherwise. */
async function imageRemove(): Promise<void> {
  const source = authored();
  await withNativeViews(source, async (harness) => {
    const { document } = harness;
    const blocked = await harness.call(
      'rdlcCode.sidebar.imageRemove',
      await definitionRow(harness, 'logo'),
    );
    assert.equal(blocked.warnings.length, 1);
    for (const name of ['LogoAutoSize', 'LogoFit', 'Tagged'])
      assert.ok(blocked.warnings[0]!.includes(`"${name}"`), name);
    assert.equal(document.getText(), source, 'a referenced definition stays');

    const before = document.version;
    const run = await harness.call(
      'rdlcCode.sidebar.imageRemove',
      await definitionRow(harness, 'unused'),
    );
    assert.deepEqual(run.warnings, []);
    assert.equal(document.version, before + 1, 'one edit, one undo step');
    const removed = document.getText();
    assert.deepEqual(embeddedNames(removed), ['logo', 'photo']);
    assert.equal(removed.match(/<Image /g)?.length, 5);
    await vscode.window.showTextDocument(document);
    await history(document, 'undo', source);
    await vscode.window.showTextDocument(document);
    await history(document, 'redo', removed);
    await vscode.window.showTextDocument(document);
    await history(document, 'undo', source);
  });

  // Removing the last definition drops the whole, now empty, EmbeddedImages collection.
  const single = source
    .replace(/<Image Name="[\s\S]*?<\/Image>\s*/g, '')
    .replace(
      /<EmbeddedImage Name="(logo|photo)">[\s\S]*?<\/EmbeddedImage>\s*/g,
      '',
    );
  await withNativeViews(single, async (harness) => {
    const run = await harness.call(
      'rdlcCode.sidebar.imageRemove',
      await definitionRow(harness, 'unused'),
    );
    assert.deepEqual(run.warnings, []);
    assert.ok(!harness.document.getText().includes('<EmbeddedImages'));
    await vscode.window.showTextDocument(harness.document);
    await history(harness.document, 'undo', single);
  });
}
