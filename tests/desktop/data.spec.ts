/**
 * Feature 005 US3 (AT-04): the native Report Data view and the existing guarded
 * dataset form on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/data.spec.ts::<title>`). Each test launches the real Desktop
 * binary in a disposable profile over a temp copy of manifest-listed fixtures,
 * drives the native Data tree, its context menus, the command palette and the
 * existing dataset form with real keyboard/pointer input, and reads report bytes
 * independently from disk.
 *
 * Nothing patches a document to simulate an operation, opens a test channel into
 * the extension, or fabricates a selection, a canvas bound, a history step or an
 * execution: every mutation is one accepted native action, every expected byte
 * string is the frozen fixture plus the exact serializer contract, and every
 * refusal is the product's own accessible reason. Payload/secret exclusion is
 * asserted on the sidebar's own DOM here; monitored network, query and resource
 * execution belongs to `offline.spec.ts`.
 */
import { test, expect, type Frame, type Page } from 'playwright/test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launchTrustedDesktop, type DesktopDriver } from './driver.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const STALE =
  'This report item is stale. Activate its current row and try again.';

/** One field per designer type: name, `fieldTypes` key and its exact TypeName. */
const SEVEN_TYPES = [
  ['FText', 'text', 'System.String'],
  ['FBoolean', 'Boolean', 'System.Boolean'],
  ['FInt32', 'Int32', 'System.Int32'],
  ['FInt64', 'Int64', 'System.Int64'],
  ['FDecimal', 'decimal', 'System.Decimal'],
  ['FDouble', 'double', 'System.Double'],
  ['FDateTime', 'date/time', 'System.DateTime'],
] as const;

/** Query, mapping, type, expression and opaque metadata carried by preserved.rdlc. */
const PRESERVED_PAYLOADS = [
  'SELECT untouched',
  'application_column',
  'Custom.Money',
  '=Fields!Known.Value',
  'opaque',
] as const;

interface OracleEntry {
  readonly element: string;
  readonly name: string | null;
  readonly category: string;
  /** Expected properties/author eligibility; absent means the oracle decides nothing. */
  readonly authoring?: boolean;
}
interface Oracle {
  readonly categories: readonly {
    readonly semantic: string;
    readonly label: string;
  }[];
  readonly fixtures: Readonly<
    Record<
      string,
      { readonly path: string; readonly entries: readonly OracleEntry[] }
    >
  >;
  readonly secrets: Readonly<Record<string, readonly string[]>>;
}

type Files = Record<string, { readonly fixture: string }>;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  readonly artifacts: string;
  path(name: string): string;
}

const root = (): string => process.env.RDLC_DESKTOP_ROOT ?? process.cwd();

const artifacts = (): string =>
  resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'data',
  );

/** Resolve a manifest id to bytes; the manifest stays the fixture oracle. */
async function fixturePath(base: string, id: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(resolve(base, 'tests/fixtures/manifest.json'), 'utf8'),
  ) as {
    fixtures: { id: string; path: string; capabilities: readonly string[] }[];
  };
  const entry = manifest.fixtures.find((fixture) => fixture.id === id);
  if (!entry) throw new Error(`Unknown manifest fixture id: ${id}`);
  if (!entry.capabilities.includes('source'))
    throw new Error(`Fixture ${id} cannot be opened as report source`);
  return resolve(base, 'tests/fixtures', entry.path);
}

/**
 * Fresh trusted window whose workspace folder is a temp copy of the given
 * fixtures. The profile belongs to the driver and is removed by its close; the
 * workspace copy is removed here in both the passing and failing cases, and
 * shutdown errors never replace the journey's own failure.
 */
async function session(
  files: Files,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const base = root();
  await mkdir(artifacts(), { recursive: true });
  await mkdir(resolve(base, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(base, '.vscode-test/sidebar-data-'));
  let driver: DesktopDriver | undefined;
  let failed = false;
  let failure: unknown;
  try {
    for (const [name, source] of Object.entries(files)) {
      await copyFile(await fixturePath(base, source.fixture), join(dir, name));
    }
    driver = await launchTrustedDesktop({
      root: base,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      artifactDir: artifacts(),
      workspaceDir: dir,
    });
    await run({
      driver,
      page: driver.page,
      dir,
      artifacts: artifacts(),
      path: (name) => join(dir, name),
    });
  } catch (error) {
    failed = true;
    failure = error;
  }
  const shutdown: unknown[] = [];
  if (driver) {
    try {
      await driver.close();
    } catch (error) {
      shutdown.push(error);
    }
  }
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    shutdown.push(error);
  }
  if (failed && shutdown.length)
    throw new AggregateError(
      [failure, ...shutdown],
      'Data session and cleanup failed',
    );
  if (failed) throw failure;
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

/** Report bytes read independently of the product. */
const source = (ctx: Ctx, name: string): Promise<string> =>
  readFile(ctx.path(name), 'utf8');

const dirtyTabs = (page: Page) => page.locator('.monaco-workbench .tab.dirty');

async function openFile(ctx: Ctx, name: string): Promise<void> {
  await ctx.page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await ctx.page.keyboard.press(`${MOD}+p`);
  await ctx.page.keyboard.insertText(ctx.path(name));
  await ctx.page
    .locator('.quick-input-widget:visible .monaco-list-row')
    .filter({ hasText: name })
    .first()
    .click();
  await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
}

/**
 * Quick Open resolves `.rdlc` to the text editor, so every journey that needs
 * the designer opens it explicitly through the host's own public command.
 */
async function openReport(ctx: Ctx, name: string): Promise<Frame> {
  await openFile(ctx, name);
  await ctx.driver.command('RDLC Code: Open Designer');
  // The designer webview grabs focus when it loads; wait for it before the
  // palette opens, or the late focus steals the typed command.
  await ctx.driver.designerFrame();
  await ctx.driver.command('Focus on Report Data View');
  return ctx.driver.designerFrame();
}

const dataPane = (page: Page) =>
  page
    .locator('.pane')
    .filter({ has: page.locator('.pane-header', { hasText: 'Report Data' }) });

const structurePane = (page: Page) =>
  page.locator('.pane').filter({
    has: page.locator('.pane-header', { hasText: 'Report Structure' }),
  });

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One native Data row; the accessible name may carry a Selected/Source only cue. */
const row = (page: Page, label: string) =>
  dataPane(page)
    .locator('.monaco-list-rows')
    .getByRole('treeitem', {
      name: new RegExp(`^${escapeRegExp(label)}(?:,|$)`),
    });

/** A rendered row's label without its cue, for comparing against the oracle. */
const stripCue = (label: string): string => {
  const cue = label.indexOf(', ');
  return (cue < 0 ? label : label.slice(0, cue)).trim();
};

/** Native rows actually in the DOM; the tree virtualizes, so callers walk windows. */
const rendered = (page: Page): Promise<string[]> =>
  dataPane(page)
    .locator('.monaco-list-rows [role="treeitem"]')
    .evaluateAll((rows) =>
      rows.map(
        (element) =>
          element.getAttribute('aria-label') ||
          (element.textContent ?? '').trim(),
      ),
    );

/** Offset of `slice` inside `sequence`, or -1 when it is not a contiguous window. */
const windowOffset = (slice: string[], sequence: string[]): number => {
  for (let start = 0; start + slice.length <= sequence.length; start++)
    if (slice.every((label, index) => sequence[start + index] === label))
      return start;
  return -1;
};

/** Right-click a native row and activate one exact `RDLC Code:` menu title. */
async function activateMenu(
  page: Page,
  label: string,
  title: string,
): Promise<void> {
  const target = row(page, label);
  // Select first: the cue only returns once the host accepted that selection,
  // so the menu's own action never races a still-pending native dispatch.
  // The product drops a click on a row whose authority is stale (tree rebuilt
  // after Undo/Redo or a mutation) by design, so the click and the cue converge
  // together; re-clicking an already selected row is idempotent.
  await expect(async () => {
    await target.click({ timeout: 5_000 });
    await expect(target, `${label} is selected`).toHaveAttribute(
      'aria-label',
      /Selected/,
      { timeout: 3_000 },
    );
  }).toPass({ timeout: 30_000 });
  await target.click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: title });
  await expect(item, `${title} is offered for ${label}`).toHaveCount(1);
  // Real pointer activation, held between mousedown and mouseup: the shipped
  // 1.142.0 build attaches a menu item's MOUSE_UP handler only 100 ms after the
  // item renders (`runOnceToEnableMouseUp = new Delayed(..., 100)` scheduled in
  // `render()`), so a click inside that window highlights the item and is then
  // silently swallowed — no command, menu still open. Measured traces: Data
  // `DataSet: Existing → Delete` and Structure `Group: Details → Code XML`
  // activate 21 ms / 0.5 ms after the right-click (ignored, menu left open),
  // while Structure `Table → Delete` fires 124 ms after (ran, toast shown).
  // One held gesture clears the window; no retry, no keyboard substitute.
  await item.click({ delay: 250 });
  // The platform dismisses its own menu when it runs the action, so a menu that
  // is still open proves the activation never happened: fail here instead of
  // force-opening the inspector to make a later assertion pass.
  await expect(item, `${title} ran: its context menu dismissed`).toHaveCount(0);
}

/** The Properties panel can start hidden; its toolbar button shows it. */
async function showProperties(frame: Frame): Promise<void> {
  const toggle = frame.getByRole('button', { name: 'Properties', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** One real save, then the independent byte read; the document must end clean. */
async function saveAndExpect(
  ctx: Ctx,
  name: string,
  expected: string,
): Promise<void> {
  await ctx.page.keyboard.press(`${MOD}+s`);
  await expect
    .poll(() => readFile(ctx.path(name), 'utf8'), { timeout: 45_000 })
    .toBe(expected);
  await expect(dirtyTabs(ctx.page)).toHaveCount(0);
}

/**
 * One real history step: the tab must actually turn dirty (the step landed in
 * the document) before the next independent byte read.
 */
async function historyStep(
  ctx: Ctx,
  frame: Frame,
  action: 'Undo' | 'Redo',
  name: string,
  expected: string,
): Promise<void> {
  await frame.getByRole('button', { name: action, exact: true }).click();
  await expect(
    dirtyTabs(ctx.page),
    `${action} changed the document`,
  ).not.toHaveCount(0);
  await saveAndExpect(ctx, name, expected);
}

const loadOracle = async (): Promise<Oracle> =>
  JSON.parse(
    await readFile(
      resolve(root(), 'tests/fixtures/sidebar/data.expected.json'),
      'utf8',
    ),
  );

const definitionLabel = (entry: OracleEntry): string =>
  entry.name ? `${entry.element}: ${entry.name}` : entry.element;

/**
 * The native Data tree, row by row: one header per fixed category followed by
 * that owning collection's definitions in accepted source order; an empty
 * category carries its own "No definitions." row.
 */
function expectedLabels(oracle: Oracle, fixture: string): string[] {
  const entries = oracle.fixtures[fixture]!.entries;
  const labels: string[] = [];
  for (const category of oracle.categories) {
    labels.push(category.label);
    const own = entries.filter((entry) => entry.category === category.semantic);
    labels.push(...own.map(definitionLabel));
    if (!own.length) labels.push('No definitions.');
  }
  return labels;
}

const viewportScroll = (frame: Frame): Promise<number[]> =>
  frame
    .locator('.viewport')
    .evaluate((element) => [
      (element as HTMLElement).scrollLeft,
      (element as HTMLElement).scrollTop,
    ]);

test('US3.1-category-contents', async () => {
  const oracle = await loadOracle();
  const expected = expectedLabels(oracle, 'supported');
  // Four fixed category headers plus every supported-fixture definition.
  expect(expected).toHaveLength(30);

  await session(
    {
      'data.rdlc': { fixture: 'sidebar-data' },
      'empty.rdlc': { fixture: 'sidebar-data-empty' },
    },
    async (ctx) => {
      const { page } = ctx;
      const before = await source(ctx, 'data.rdlc');
      const emptyBytes = await source(ctx, 'empty.rdlc');
      await openReport(ctx, 'data.rdlc');

      // The view command focuses the tree without toggling a category closed.
      await page.keyboard.press('Home');
      await expect(
        dataPane(page).getByRole('treeitem', { name: 'Datasets / Fields' }),
      ).toBeVisible();

      // Every rendered window is a contiguous slice of the frozen oracle, so
      // order, nesting and completeness all hold without trusting the projector.
      const seen = new Set<string>();
      let covered = 0;
      for (
        let step = 0;
        step <= expected.length && covered < expected.length;
        step++
      ) {
        const window = await rendered(page);
        window.forEach((label) => seen.add(label));
        const start = windowOffset(window.map(stripCue), expected);
        expect(
          start,
          `native window ${JSON.stringify(window)} is a contiguous oracle slice`,
        ).toBeGreaterThanOrEqual(0);
        expect(start, 'the inventory never skips ahead').toBeLessThanOrEqual(
          covered,
        );
        covered = start + window.length;
        if (covered < expected.length) await page.keyboard.press('PageDown');
      }
      expect(covered, 'every oracle definition rendered in source order').toBe(
        expected.length,
      );

      // Truthful capability cues from the oracle's authoring flag.
      for (const entry of oracle.fixtures.supported!.entries) {
        const name = definitionLabel(entry);
        const labels = [...seen].filter((value) => stripCue(value) === name);
        expect(
          labels.length,
          `${name} rendered during the walk`,
        ).toBeGreaterThan(0);
        if (entry.authoring === undefined) continue;
        for (const label of labels)
          expect(
            /Source only/.test(label),
            `${label} authoring=${entry.authoring}`,
          ).toBe(!entry.authoring);
      }

      // No connection string, query, default value or image payload reaches the
      // sidebar, and a tooltip only carries the inert presence/status flags. The
      // walk ends on the last row, so the data source rows are rendered now and
      // Home brings the first dataset back for its own tooltip.
      const secrets = (text: string, where: string) => {
        for (const secret of oracle.secrets.supported!)
          expect(text, `${where} omits ${secret}`).not.toContain(secret);
      };
      const sidebarText = [await page.locator('.part.sidebar').innerText()];
      await row(page, 'DataSource: Local').hover();
      const sourceTooltip = page.locator('.monaco-hover:visible');
      await expect(sourceTooltip).toContainText('source: inline');
      secrets(await sourceTooltip.innerText(), 'the data source tooltip');
      await page.keyboard.press('Home');
      sidebarText.push(await page.locator('.part.sidebar').innerText());
      await row(page, 'DataSet: Sales').first().hover();
      const tooltip = page.locator('.monaco-hover:visible');
      await expect(tooltip).toContainText('hasQuery: true');
      secrets(await tooltip.innerText(), 'the dataset tooltip');
      for (const text of sidebarText) secrets(text, 'the sidebar');

      // Data definitions are not a Structure branch; the branch above it is
      // populated, so the empty counts are a real exclusion.
      await ctx.driver.command('Focus on Report Structure View');
      await expect(
        structurePane(page).getByRole('treeitem', { name: /^Textbox: Title/ }),
      ).toHaveCount(1);
      await expect(
        structurePane(page).getByRole('treeitem', { name: /^DataSet/ }),
      ).toHaveCount(0);
      await expect(
        structurePane(page).getByRole('treeitem', { name: /^Field: / }),
      ).toHaveCount(0);

      // An editable report without definitions says so in every category and
      // never reports an incomplete inventory it does not have.
      await ctx.driver.command('View: Close All Editors');
      await openReport(ctx, 'empty.rdlc');
      await expect(
        dataPane(page).getByRole('treeitem', { name: 'No definitions.' }),
      ).toHaveCount(4);
      await expect(
        dataPane(page).getByRole('treeitem', {
          name: /inventory incomplete|Navigation incomplete/,
        }),
      ).toHaveCount(0);
      expect(await source(ctx, 'empty.rdlc')).toBe(emptyBytes);
      expect(await source(ctx, 'data.rdlc')).toBe(before);
      await ctx.driver.capture('data-us3-1-category-contents');
    },
  );
});

test('US3.2-add-edit-delete', async () => {
  const fixture = await readFile(
    resolve(root(), 'tests/fixtures/datasets/local.rdlc'),
    'utf8',
  );
  await session(
    { 'data-crud.rdlc': { fixture: 'local-seven-types' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await source(ctx, 'data-crud.rdlc');
      expect(original, 'the workspace holds the frozen fixture bytes').toBe(
        fixture,
      );
      let frame = await openReport(ctx, 'data-crud.rdlc');
      let expected = original;

      /**
       * The native inventory must already show the last accepted mutation before
       * the next gesture. Rows carry the authority they were rebuilt with and the
       * product drops a click whose row predates the current document silently
       * (`sidebar/views.ts` selection guard: no dispatch, no message, no cue), so
       * a click inside that window never reaches the designer. In this
       * single-dataset fixture every field row exposes its sibling count, which is
       * exactly the `<Field ` count of the saved document on disk — that count is
       * the freshness oracle for every count-changing mutation, and the renamed
       * row's own label covers the one that changes no count. A rebuild that keeps
       * the row count (Undo/Redo) is invisible to this oracle, so `activateMenu`
       * also re-clicks until the host accepts the selection.
       */
      const inventoryShowsSavedFields = async (
        rowLabel: string,
      ): Promise<void> => {
        const fields =
          (await source(ctx, 'data-crud.rdlc')).match(/<Field /g) ?? [];
        expect(
          fields.length,
          'the saved document declares fields',
        ).toBeGreaterThan(0);
        await expect(
          row(page, rowLabel),
          `the native inventory lists all ${fields.length} saved fields`,
        ).toHaveAttribute('aria-setsize', String(fields.length));
      };

      // Add: one field per designer type through the native menu and the existing
      // creation form; each accepted creation is exactly one history step.
      for (const [name, key, typeName] of SEVEN_TYPES) {
        const previous = expected;
        await inventoryShowsSavedFields('Field: Label');
        await activateMenu(page, 'DataSet: Orders', 'RDLC Code: Add Field');
        const form = frame.getByRole('form', { name: 'Create field' });
        await expect(form).toBeVisible();
        await form.getByRole('textbox', { name: 'Field name' }).fill(name);
        await form
          .getByRole('combobox', { name: 'Field type' })
          .selectOption(key);
        await form
          .getByRole('button', { name: 'Add field', exact: true })
          .click();
        await expect(
          frame.getByRole('group', { name: `${name} — ${key}`, exact: true }),
        ).toBeVisible();
        const insertion = `<Field Name="${name}"><DataField>${name}</DataField><rd:TypeName>${typeName}</rd:TypeName></Field>`;
        const next = expected.replace('</Fields>', `${insertion}</Fields>`);
        expect(next, `${name} is a real source insertion`).not.toBe(expected);
        expected = next;
        await saveAndExpect(ctx, 'data-crud.rdlc', expected);
        await historyStep(ctx, frame, 'Undo', 'data-crud.rdlc', previous);
        await historyStep(ctx, frame, 'Redo', 'data-crud.rdlc', expected);
      }

      // Rename: the declared Name attribute only, DataField mapping untouched.
      // It runs first because the preceding additions change the inventory's
      // field count, so this activation has an observable freshness gate; every
      // later activation then follows a mutation the Data view itself renders.
      const beforeRename = expected;
      const renamed = expected.replace(
        '<Field Name="Label">',
        '<Field Name="Label2">',
      );
      expect(renamed, 'the rename is a real source edit').not.toBe(
        beforeRename,
      );
      await inventoryShowsSavedFields('Field: Label');
      await activateMenu(page, 'Field: Label', 'RDLC Code: Rename');
      const fieldName = frame.getByRole('textbox', {
        name: 'Field name',
        exact: true,
      });
      await expect(fieldName).toHaveValue('Label');
      await fieldName.fill('Label2');
      await frame
        .getByRole('button', { name: 'Rename field', exact: true })
        .click();
      await expect(
        frame.getByRole('group', { name: 'Label2 — text', exact: true }),
      ).toBeVisible();
      expected = renamed;
      await saveAndExpect(ctx, 'data-crud.rdlc', expected);
      await historyStep(ctx, frame, 'Undo', 'data-crud.rdlc', beforeRename);
      await historyStep(ctx, frame, 'Redo', 'data-crud.rdlc', expected);

      // Delete: the native Delete action reaches the existing form's own button,
      // and the field subtree leaves the document in one complete step. The rename
      // changed no count, so its own row is the freshness proof.
      const beforeDelete = expected;
      const deleted = expected.replace(
        '<Field Name="Active"><DataField>Active</DataField><rd:TypeName>System.Boolean</rd:TypeName></Field>',
        '',
      );
      expect(deleted, 'the delete removes exactly the field subtree').not.toBe(
        beforeDelete,
      );
      await expect(
        row(page, 'Field: Label2'),
        'the rename reached the native inventory',
      ).toBeVisible();
      await activateMenu(page, 'Field: Active', 'RDLC Code: Delete');
      const active = frame.getByRole('group', {
        name: 'Active — Boolean',
        exact: true,
      });
      await expect(active).toBeVisible();
      await frame
        .getByRole('button', { name: 'Delete field', exact: true })
        .click();
      await expect(active).toHaveCount(0);
      expected = deleted;
      await saveAndExpect(ctx, 'data-crud.rdlc', expected);
      await historyStep(ctx, frame, 'Undo', 'data-crud.rdlc', beforeDelete);
      await historyStep(ctx, frame, 'Redo', 'data-crud.rdlc', expected);

      // Edit: the native Edit Data action opens the same form for one field, and
      // one accepted type change stays one history step. The deletion dropped the
      // inventory's field count, which gates this last activation.
      const beforeEdit = expected;
      const edited = expected.replace(
        '<Field Name="Label2"><DataField>Label</DataField><rd:TypeName>System.String</rd:TypeName>',
        '<Field Name="Label2"><DataField>Label</DataField><rd:TypeName>System.Boolean</rd:TypeName>',
      );
      expect(edited, 'the renamed field really changes type').not.toBe(
        beforeEdit,
      );
      const scroll = await viewportScroll(frame);
      await inventoryShowsSavedFields('Field: Label2');
      await activateMenu(page, 'Field: Label2', 'RDLC Code: Edit Data');
      const fieldType = frame.getByRole('combobox', {
        name: 'Field type',
        exact: true,
      });
      await expect(fieldType).toHaveValue('text');
      await fieldType.selectOption('Boolean');
      await frame
        .getByRole('button', { name: 'Set type', exact: true })
        .click();
      await expect(fieldType).toHaveValue('Boolean');
      // A data target carries no canvas bounds: the edit draws no rectangle and
      // never moves the viewport.
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      expect(await viewportScroll(frame)).toEqual(scroll);
      expected = edited;
      await saveAndExpect(ctx, 'data-crud.rdlc', expected);
      await historyStep(ctx, frame, 'Undo', 'data-crud.rdlc', beforeEdit);
      await historyStep(ctx, frame, 'Redo', 'data-crud.rdlc', expected);

      // Save/reopen: the accepted definitions persist exactly in the native view
      // and in the existing form, and reopening edits nothing.
      await saveAndExpect(ctx, 'data-crud.rdlc', expected);
      await ctx.driver.command('View: Close All Editors');
      frame = await openReport(ctx, 'data-crud.rdlc');
      await showProperties(frame);
      expect(await source(ctx, 'data-crud.rdlc')).toBe(expected);
      await expect(row(page, 'Field: Label2')).toBeVisible();
      await expect(row(page, 'Field: Active')).toHaveCount(0);
      await inventoryShowsSavedFields('Field: Label2');
      await row(page, 'DataSet: Orders').click();
      await expect(
        frame.getByRole('heading', { name: 'Dataset: Orders', exact: true }),
      ).toBeVisible();
      for (const [name, key] of SEVEN_TYPES)
        await expect(
          frame.getByRole('group', { name: `${name} — ${key}`, exact: true }),
          `${name} persisted as ${key}`,
        ).toBeVisible();
      await expect(
        frame.getByRole('group', { name: 'Label2 — Boolean', exact: true }),
      ).toBeVisible();
      await expect(frame.getByRole('group', { name: /^Active —/ })).toHaveCount(
        0,
      );
      expect(await source(ctx, 'data-crud.rdlc')).toBe(expected);
      await expect(dirtyTabs(page)).toHaveCount(0);
      await ctx.driver.capture('data-us3-2-add-edit-delete');
    },
  );
});

test('US3.3-inspect-only', async () => {
  await session(
    { 'preserved.rdlc': { fixture: 'local-preserved-metadata' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await source(ctx, 'preserved.rdlc');
      const frame = await openReport(ctx, 'preserved.rdlc');
      await showProperties(frame);

      // Eligible versus preservation-only definitions, straight from the projection.
      await expect(row(page, 'DataSet: Existing')).toBeVisible();
      await expect(row(page, 'Field: Known')).not.toHaveAttribute(
        'aria-label',
        /Source only/,
      );
      await expect(row(page, 'Field: Calculated')).toHaveAttribute(
        'aria-label',
        /Source only/,
      );
      await expect(row(page, 'Field: Unknown')).toHaveAttribute(
        'aria-label',
        /Source only/,
      );

      // A preservation-only field exposes inspection only: the data form's own
      // entry points are absent from its real context menu, and its selection
      // never opens the dataset-scoped creation form.
      await row(page, 'Field: Calculated').click({ button: 'right' });
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Code XML' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: (Edit Data|Add Field|Rename|Delete|Properties)/,
        }),
      ).toHaveCount(0);
      await expect(
        frame.getByRole('form', { name: 'Create field' }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(row(page, 'Field: Calculated')).toHaveAttribute(
        'aria-label',
        /Source only/,
      );

      // Bounded textual metadata only: classification and the refusal reason, with
      // no DataField mapping, unknown type name, query text or expression.
      await row(page, 'Field: Unknown').hover();
      const tooltip = page.locator('.monaco-hover:visible');
      await expect(tooltip).toContainText('classification: unsupported');
      await expect(tooltip).toContainText(
        'Preservation-only content; inspect Code XML.',
      );
      await expect(tooltip).toContainText(
        'Code XML opens the current source range.',
      );
      const tooltipText = await tooltip.innerText();
      const checked = [
        await page.locator('.part.sidebar').innerText(),
        await page.locator('.part.sidebar').ariaSnapshot(),
        tooltipText,
      ];
      for (const payload of PRESERVED_PAYLOADS)
        for (const text of checked)
          expect(
            text,
            `payload ${payload} stays out of the sidebar`,
          ).not.toContain(payload);

      expect(await source(ctx, 'preserved.rdlc')).toBe(original);
      await expect(dirtyTabs(page)).toHaveCount(0);
      await writeFile(
        join(ctx.artifacts, 'payload-exclusion-log.json'),
        `${JSON.stringify(
          {
            assertion: 'tests/desktop/data.spec.ts::US3.3-inspect-only',
            checked,
            checkedCount: checked.length,
            excluded: PRESERVED_PAYLOADS,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await ctx.driver.capture('data-us3-3-inspect-only');
    },
  );
});

test('US3.4-reference-refusal', async () => {
  await session(
    {
      'existing.rdlc': { fixture: 'local-preserved-metadata' },
      'referenced.rdlc': { fixture: 'interactive-clipboard-dependencies' },
    },
    async (ctx) => {
      const { page } = ctx;

      // An unreferenced dataset deletes as one complete safe edit, then returns
      // through exactly one history step.
      const original = await source(ctx, 'existing.rdlc');
      let frame = await openReport(ctx, 'existing.rdlc');
      const expected = original.replace(
        /<r:DataSets>[\s\S]*?<\/r:DataSets>/,
        '',
      );
      expect(expected, 'the whole DataSets block is the removal').not.toBe(
        original,
      );
      await activateMenu(page, 'DataSet: Existing', 'RDLC Code: Delete');
      // The native properties route itself revealed the inspector and bound the
      // dataset; this test never force-opens the panel, so the heading and the
      // existing form are the proof that the menu action dispatched.
      await expect(
        frame.getByRole('heading', { name: 'Dataset: Existing', exact: true }),
      ).toBeVisible();
      await expect(
        frame.getByRole('group', { name: 'Existing', exact: true }),
      ).toBeVisible();
      await frame
        .getByRole('button', { name: 'Delete dataset', exact: true })
        .click();
      await expect(
        frame.getByRole('group', { name: 'Existing', exact: true }),
      ).toHaveCount(0);
      await expect(row(page, 'DataSet: Existing')).toHaveCount(0);
      await saveAndExpect(ctx, 'existing.rdlc', expected);
      await historyStep(ctx, frame, 'Undo', 'existing.rdlc', original);
      expect(await source(ctx, 'existing.rdlc')).toBe(original);

      // A referenced dataset refuses with the product's own reason and changes
      // nothing: zero partial source, the reference and the row both intact.
      const referenced = await source(ctx, 'referenced.rdlc');
      await ctx.driver.command('View: Close All Editors');
      frame = await openReport(ctx, 'referenced.rdlc');
      await activateMenu(page, 'DataSet: Orders', 'RDLC Code: Delete');
      await expect(
        frame.getByRole('group', { name: 'Orders', exact: true }),
      ).toBeVisible();
      await frame
        .getByRole('button', { name: 'Delete dataset', exact: true })
        .click();
      await expect(
        frame.getByText(/Not applied: dataset Orders is referenced here\./),
      ).toBeVisible();
      await expect(
        frame.getByText('(REFERENCE_IN_USE)', { exact: true }),
      ).toBeVisible();
      expect(await source(ctx, 'referenced.rdlc')).toBe(referenced);
      await expect(dirtyTabs(page)).toHaveCount(0);
      await expect(row(page, 'DataSet: Orders')).toBeVisible();
      expect(
        (await source(ctx, 'referenced.rdlc')).includes(
          '=Sum(Fields!Amount.Value, &quot;Orders&quot;)',
        ),
        'the accepted reference survived the refused deletion',
      ).toBe(true);
      await ctx.driver.capture('data-us3-4-reference-refusal');
    },
  );
});

test('US3.5-selection-agreement', async () => {
  await session(
    { 'data-crud.rdlc': { fixture: 'local-seven-types' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await source(ctx, 'data-crud.rdlc');
      const frame = await openReport(ctx, 'data-crud.rdlc');
      await showProperties(frame);
      const scroll = await viewportScroll(frame);

      // Accepted dataset selection agrees in Report Data and in the existing
      // inspector, and invents neither a canvas rectangle nor a scroll position.
      await row(page, 'DataSet: Orders').click();
      await expect(row(page, 'DataSet: Orders')).toHaveAttribute(
        'aria-label',
        /^DataSet: Orders.*Selected/,
      );
      await expect(
        frame.getByRole('heading', { name: 'Dataset: Orders', exact: true }),
      ).toBeVisible();
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      await expect(frame.locator('.item.primary')).toHaveCount(0);
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');
      expect(await viewportScroll(frame)).toEqual(scroll);

      // Creation: the native title command owns its own automatic defaults.
      const expected = original.replace(
        '</DataSets>',
        '<DataSet Name="DataSet1"><CaseSensitivity>Auto</CaseSensitivity></DataSet></DataSets>',
      );
      expect(expected, 'the creation is a real source insertion').not.toBe(
        original,
      );
      await ctx.driver.command('RDLC Code: New Dataset');
      await expect(frame.getByText('Created DataSet1.')).toBeVisible();
      await expect(row(page, 'DataSet: DataSet1')).toBeVisible();
      await expect(row(page, 'DataSet: DataSet1')).toHaveAttribute(
        'aria-label',
        /^DataSet: DataSet1.*Selected/,
      );
      await expect(
        frame.getByRole('heading', { name: 'Dataset: DataSet1', exact: true }),
      ).toBeVisible();
      await expect(
        frame.getByRole('form', { name: 'Create field' }),
      ).toBeVisible();
      await saveAndExpect(ctx, 'data-crud.rdlc', expected);
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      await expect(frame.locator('.item.primary')).toHaveCount(0);
      expect(await viewportScroll(frame)).toEqual(scroll);

      // One history step back and forward, each persisted exactly.
      await historyStep(ctx, frame, 'Undo', 'data-crud.rdlc', original);
      await historyStep(ctx, frame, 'Redo', 'data-crud.rdlc', expected);
      expect(await source(ctx, 'data-crud.rdlc')).toBe(expected);
      await ctx.driver.capture('data-us3-5-selection-agreement');
    },
  );
});

test('FR-010-data-actions', async () => {
  await session(
    { 'preserved.rdlc': { fixture: 'local-preserved-metadata' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await source(ctx, 'preserved.rdlc');
      const frame = await openReport(ctx, 'preserved.rdlc');

      // Forged palette invocations carry no captured row: the shared guard refuses
      // them with its accessible reason and opens no form, selection or edit.
      await ctx.driver.command('RDLC Code: Edit Data');
      await expect(page.getByText(STALE).first()).toBeVisible();
      await ctx.driver.command('RDLC Code: Add Field');
      await expect(page.getByText(STALE).first()).toBeVisible();
      await expect(
        frame.getByRole('heading', { name: 'Dataset: Existing', exact: true }),
      ).toHaveCount(0);
      await expect(
        frame.getByRole('form', { name: 'Create field' }),
      ).toHaveCount(0);
      expect(await source(ctx, 'preserved.rdlc')).toBe(original);
      await expect(dirtyTabs(page)).toHaveCount(0);

      // The real native menu: exact `RDLC Code:` titles, scoped to the row kind.
      await row(page, 'DataSet: Existing').click({ button: 'right' });
      for (const title of [
        'RDLC Code: Code XML',
        'RDLC Code: Edit Data',
        'RDLC Code: Add Field',
        'RDLC Code: Rename',
        'RDLC Code: Delete',
      ])
        await expect(
          page.getByRole('menuitem', { name: title }),
          title,
        ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: (Properties|Copy|Cut|Duplicate|Table Properties|Group Properties)/,
        }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');

      // A field row has no field creation entry; creation stays dataset-scoped.
      await row(page, 'Field: Known').click({ button: 'right' });
      for (const title of [
        'RDLC Code: Code XML',
        'RDLC Code: Edit Data',
        'RDLC Code: Rename',
      ])
        await expect(
          page.getByRole('menuitem', { name: title }),
          title,
        ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Add Field' }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(row(page, 'Field: Known')).toBeVisible();

      expect(await source(ctx, 'preserved.rdlc')).toBe(original);
      await expect(dirtyTabs(page)).toHaveCount(0);
      await ctx.driver.capture('data-fr-010-data-actions');
    },
  );
});
