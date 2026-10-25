import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync('apps/vscode-extension/package.json', 'utf8'),
);
const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
type Entry = { command: string };
const commandIds = manifest.contributes.commands.map(
  (entry: Entry) => entry.command,
);

// Independent oracle: contributes.commands of `git show a9998ad:apps/vscode-extension/package.json`.
const retainedCommands = [
  'rdlcCode.newReport',
  'rdlcCode.openDesigner',
  'rdlcCode.openSource',
];
// contracts/native-workspace.md: activate, properties, source, filter, clear filter, plus Open Report.
const sidebarCommands = [
  'openReport',
  'activate',
  'properties',
  'source',
  'filter',
  'clearFilter',
].map((id) => `rdlcCode.sidebar.${id}`);
// T031: finite structure context actions, all routed through existing handlers.
const structureActions = ['delete', 'table', 'group'].map(
  (id) => `rdlcCode.sidebar.${id}`,
);
// T040: finite Data actions, all routed through the existing dataset/field forms.
const dataActions = [
  'dataEdit',
  'dataAddField',
  'dataRename',
  'dataDelete',
  'dataAddDataset',
].map((id) => `rdlcCode.sidebar.${id}`);
// Committed in fac6b25 (supplied activity icon); any byte change must be deliberate.
const activitySvgSha256 =
  '5edf5dcf6c5155ecde4efc9dbb977aa9421cf28f89e64f7fce17d1aec0bdca9e';

test('the native report workspace contributes three local views without replacing Explorer', () => {
  assert.deepEqual(manifest.contributes.viewsContainers.activitybar, [
    { id: 'rdlcCode', title: 'RDLC Code', icon: 'media/rdlc-activity.svg' },
  ]);
  assert.deepEqual(Object.keys(manifest.contributes.viewsContainers), [
    'activitybar',
  ]);
  assert.deepEqual(
    manifest.contributes.views.rdlcCode.map(
      (view: { id: string; name: string }) => [view.id, view.name],
    ),
    [
      ['rdlcCode.structure', 'Report Structure'],
      ['rdlcCode.data', 'Report Data'],
      ['rdlcCode.components', 'Components'],
    ],
  );
  // The only contributed view container is ours; no Explorer (or other host container) view is added.
  assert.deepEqual(Object.keys(manifest.contributes.views), ['rdlcCode']);
  assert.equal(manifest.contributes.views.explorer, undefined);
});

test('retained public commands and new sidebar commands are all contributed', () => {
  for (const command of [
    ...retainedCommands,
    ...sidebarCommands,
    ...structureActions,
    ...dataActions,
  ])
    assert.ok(commandIds.includes(command), command);
  assert.equal(new Set(commandIds).size, commandIds.length, 'duplicate IDs');
});

test('menus only offer contributed commands and never move or reset host views', () => {
  const menus = manifest.contributes.menus as Record<
    string,
    { command: string }[]
  >;
  // Menu context keys are presentation only; a menu entry must target a command
  // the extension actually registers (contracts/native-workspace.md).
  for (const [menu, entries] of Object.entries(menus))
    for (const entry of entries)
      assert.ok(
        commandIds.includes(entry.command),
        `${menu}: ${entry.command}`,
      );
  // Placement, ordering, visibility and restoration stay host-owned: no
  // activation/refresh path may contribute a view move or reset.
  assert.doesNotMatch(
    JSON.stringify(menus),
    /workbench\.action\.(?:resetViewLocations|moveView|moveActiveView|resetPanelAlignment)/,
  );
});

test('structure context actions are presented narrowly and carry no delete acknowledgement', () => {
  const context = (
    manifest.contributes.menus as Record<
      string,
      { command: string; when?: string }[]
    >
  )['view/item/context']!;
  const conditions = (command: string) =>
    context
      .filter((entry) => entry.command === command)
      .map((entry) => entry.when ?? '');
  // Opening the existing confirmation form does not require clipboard eligibility.
  const deleteConditions = conditions('rdlcCode.sidebar.delete');
  assert.equal(deleteConditions.length, 1);
  assert.ok(deleteConditions[0]!.includes('view == rdlcCode.structure'));
  const pattern = /viewItem =~ \/(.+)\//.exec(deleteConditions[0]!)?.[1];
  assert.ok(pattern);
  const visible = new RegExp(pattern);
  for (const value of [
    'rdlcCode.body',
    'rdlcCode.body.table',
    'rdlcCode.editable.table',
  ])
    assert.ok(visible.test(value), value);
  for (const value of [
    'rdlcCode.source',
    'rdlcCode.group',
    'rdlcCode.editable',
  ])
    assert.equal(visible.test(value), false, value);
  // Table and group rows expose only their owning existing forms.
  for (const condition of conditions('rdlcCode.sidebar.table'))
    assert.ok(condition.includes('/\\.table$/'), condition);
  assert.deepEqual(conditions('rdlcCode.sidebar.group'), [
    'viewItem == rdlcCode.group',
  ]);
  // Source stays reachable for every row state, including source-only and groups.
  assert.ok(
    conditions('rdlcCode.sidebar.source').some(
      (condition) =>
        condition.includes('group') && condition.includes('source'),
    ),
  );
  // The contained-XML acknowledgement lives in the existing designer form, never in the host manifest.
  assert.doesNotMatch(
    JSON.stringify(manifest.contributes),
    /delete-contained-content|confirm/i,
  );
});

test('data actions are scoped to Report Data rows and carry no authoring payload', () => {
  const menus = manifest.contributes.menus as Record<
    string,
    { command: string; when?: string; group?: string }[]
  >;
  const context = menus['view/item/context']!;
  const conditions = (command: string) =>
    context
      .filter((entry) => entry.command === command)
      .map((entry) => entry.when ?? '');

  for (const command of dataActions.filter(
    (id) => id !== 'rdlcCode.sidebar.dataAddDataset',
  )) {
    const entries = conditions(command);
    assert.equal(entries.length, 1, command);
    // Data entries never appear in Structure, and never for inspect/source-only rows.
    assert.ok(entries[0]!.includes('view == rdlcCode.data'), command);
    assert.ok(
      entries[0]!.includes('rdlcCode\\.(dataset|field)') ||
        entries[0]!.includes('viewItem == rdlcCode.dataset'),
      command,
    );
    assert.ok(!entries[0]!.includes('rdlcCode.source'), command);
    assert.doesNotMatch(entries[0]!, /author|payload|confirm/i, command);
  }
  // Only the owning dataset form owns the add-field control; field rows never claim it.
  assert.ok(
    conditions('rdlcCode.sidebar.dataAddField')[0]!.includes(
      'viewItem == rdlcCode.dataset',
    ),
  );
  // Dataset creation is a Report Data view title command on an open report.
  const title = menus['view/title']!.filter(
    (entry) => entry.command === 'rdlcCode.sidebar.dataAddDataset',
  );
  assert.equal(title.length, 1);
  assert.ok(title[0]!.when!.includes('view == rdlcCode.data'));
  assert.ok(title[0]!.when!.includes('rdlcCode.hasReport'));
  // Code XML stays reachable for every data row state, inspect/source-only included.
  assert.ok(
    conditions('rdlcCode.sidebar.source').some(
      (entry) =>
        entry.includes('dataset') &&
        entry.includes('field') &&
        entry.includes('source'),
    ),
  );
  // No contributed menu carries a typed authoring payload or an acknowledgement token.
  assert.doesNotMatch(
    JSON.stringify(menus),
    /author|payload|delete-contained-content/i,
  );
});

test('the activity icon is the supplied committed asset', () => {
  const icon = readFileSync('apps/vscode-extension/media/rdlc-activity.svg');
  assert.match(icon.toString('utf8'), /<svg/);
  assert.equal(sha256(icon), activitySvgSha256);
});

test('welcome content offers New Report and Open Report before any designer opens', () => {
  const welcome = (view: string) =>
    manifest.contributes.viewsWelcome.filter(
      (entry: { view: string }) => entry.view === view,
    );
  const structure = welcome('rdlcCode.structure');
  assert.equal(structure.length, 1);
  assert.match(structure[0].contents, /\(command:rdlcCode\.newReport\)/);
  assert.match(
    structure[0].contents,
    /\(command:rdlcCode\.sidebar\.openReport\)/,
  );
  const data = welcome('rdlcCode.data');
  assert.equal(data.length, 1);
  assert.match(data[0].contents, /\(command:rdlcCode\.sidebar\.openReport\)/);
  // Components always lists its (unavailable) entries, so a welcome could never render:
  // its no-report state is the tree message instead.
  assert.equal(welcome('rdlcCode.components').length, 0);
  // Welcome shows only while no report is active, never gated on an open custom editor.
  for (const entry of [...structure, ...data])
    assert.equal(entry.when, '!rdlcCode.hasReport');
  // The no-report sentence matches the Components message, so every view says the same thing.
  for (const entry of [...structure, ...data])
    assert.match(entry.contents, /^Open or create a report to begin\./);
  // Every welcome command link targets a contributed command.
  for (const entry of manifest.contributes.viewsWelcome)
    for (const [, id] of entry.contents.matchAll(/\(command:([^)]+)\)/g))
      assert.ok(commandIds.includes(id), id);
});

test('activation does not depend on resolving a custom editor', () => {
  // VS Code >= 1.74 derives onView:<id> and onCommand:<id> activation from contributions,
  // so providers register on activation without explicit onView entries.
  const [, major, minor] = /(\d+)\.(\d+)/
    .exec(manifest.engines.vscode)!
    .map(Number);
  assert.ok(major! > 1 || minor! >= 74, manifest.engines.vscode);
  assert.deepEqual(manifest.activationEvents, [
    'onCustomEditor:rdlcCode.designer',
  ]);
  assert.ok(manifest.contributes.views.rdlcCode.length > 0);
  // Welcome actions are contributed commands, which also activate the extension implicitly.
  for (const command of ['rdlcCode.newReport', 'rdlcCode.sidebar.openReport'])
    assert.ok(commandIds.includes(command), command);
});

test('no Desktop driver or harness is shipped through the manifest', () => {
  const driver =
    /playwright|tests\/desktop|tests\/vscode|harness|drag-probe|\.vscode-test/i;
  assert.equal(manifest.dependencies.playwright, undefined);
  assert.equal(manifest.files, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.doesNotMatch(
    JSON.stringify({
      dependencies: manifest.dependencies,
      main: manifest.main,
      activationEvents: manifest.activationEvents,
      contributes: manifest.contributes,
    }),
    driver,
  );
});
