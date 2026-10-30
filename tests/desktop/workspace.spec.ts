/**
 * Feature 005 US1 (AT-01): the native RDLC Code workspace on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/workspace.spec.ts::<title>`). Each test starts a fresh
 * disposable profile, drives the workbench with real keyboard/pointer input and
 * reads the report files independently from disk. Views, placement and focus
 * belong to the host: the spec only moves/hides views through public commands
 * and menus, and asserts that the product never undoes or forces them.
 */
import { test, expect, type Locator } from 'playwright/test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  commandAvailable,
  launchTrustedDesktop,
  type DesktopDriver,
} from './driver.js';

type Page = DesktopDriver['page'];

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const VIEWS = ['Report Structure', 'Report Data', 'Components'] as const;
const NO_REPORT = 'Open or create a report to begin.';
const FIXTURE = {
  blank: 'datasets/blank.rdlc',
  textbox: 'textboxes/supported.rdlc',
  malformed: 'xml/malformed.rdlc',
  xml11: 'xml/unsupported-xml11.rdlc',
} as const;
const PARTS = {
  sidebar: '.part.sidebar',
  panel: '.part.panel',
  auxiliarybar: '.part.auxiliarybar',
} as const;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  path(name: string): string;
}

/** Fresh trusted window whose workspace folder is a temp copy of the given fixtures. */
async function session(
  files: Record<string, string | { content: string }>,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'workspace',
  );
  await mkdir(artifacts, { recursive: true });
  await mkdir(resolve(root, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(root, '.vscode-test/sidebar-workspace-'));
  for (const [name, source] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    if (typeof source === 'string')
      await copyFile(resolve(root, 'tests/fixtures', source), join(dir, name));
    else await writeFile(join(dir, name), source.content);
  }
  let driver: DesktopDriver | undefined;
  let failed = false;
  let failure: unknown;
  try {
    driver = await launchTrustedDesktop({
      root,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      artifactDir: artifacts,
      workspaceDir: dir,
    });
    await run({
      driver,
      page: driver.page,
      dir,
      path: (name) => join(dir, name),
    });
  } catch (error) {
    failed = true;
    failure = error;
  }
  // Shutdown must never replace the journey's own error, and the temp workspace
  // must go in both cases: collect first, then report everything together.
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
      'Workspace session and cleanup failed',
    );
  if (failed) throw failure;
  // Keep the driver's own shutdown report untouched when the journey passed.
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

const pane = (page: Page, label: string): Locator =>
  page
    .locator('.pane')
    .filter({ has: page.locator('.pane-header', { hasText: label }) });

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** Source bytes read independently of the product; later compared byte for byte. */
async function snapshot(ctx: Ctx, ...names: string[]) {
  return new Map(
    await Promise.all(
      names.map(
        async (name) => [name, await readFile(ctx.path(name))] as const,
      ),
    ),
  );
}

/** Zero view-only edits: bytes identical and no dirty tab. */
async function expectPristine(
  ctx: Ctx,
  original: Map<string, Buffer>,
): Promise<void> {
  for (const [name, bytes] of original)
    expect((await readFile(ctx.path(name))).equals(bytes), name).toBe(true);
  await expect(ctx.page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);
}

/** Theme class and focused element, attached to the report beside the driver capture. */
async function evidence(ctx: Ctx, name: string): Promise<void> {
  await ctx.driver.capture(name);
  const observed = await ctx.page.evaluate(() => {
    const active = document.activeElement;
    return {
      theme: document.querySelector('.monaco-workbench')?.className ?? '',
      focus: {
        tag: active?.tagName ?? null,
        label: active?.getAttribute('aria-label') ?? null,
        className: String(active?.getAttribute('class') ?? ''),
      },
    };
  });
  expect(observed.theme).toMatch(/\b(vs-dark|vs|hc-black|hc-light)\b/);
  await test.info().attach(`${name}-theme-focus`, {
    body: JSON.stringify(observed, null, 2),
    contentType: 'application/json',
  });
}

/** The RDLC Code Activity Bar item: one tab (its nested label shares the aria-label). */
const activityItem = (page: Page) =>
  page.locator('.activitybar').getByRole('tab', { name: /^RDLC Code/ });

const rdlcHeaders = (page: Page) =>
  page
    .locator('.part.sidebar .pane-header')
    .filter({ hasText: /Report Structure|Report Data|Components/ });

/**
 * Activate the RDLC Code Activity Bar item (idempotent: a second click would hide the side bar).
 * A single remaining view hides its pane header, so views are detected by attachment, not visibility.
 */
async function showRdlc(ctx: Ctx): Promise<void> {
  const { page } = ctx;
  const header = rdlcHeaders(page);
  const shown = () =>
    // Views restore asynchronously (reload, reset): give them a moment before toggling the side bar.
    header
      .first()
      .waitFor({ state: 'attached', timeout: 5_000 })
      .then(() => page.locator('.part.sidebar').isVisible())
      .catch(() => false);
  if (await shown()) return;
  const item = activityItem(page);
  await expect(item).toHaveCount(1);
  await item.click();
  await expect(page.locator('.part.sidebar')).toBeVisible();
  await expect(header.first()).toBeAttached();
}

async function openFile(ctx: Ctx, name: string): Promise<void> {
  const { page } = ctx;
  await blur(page);
  await page.keyboard.press(`${MOD}+p`);
  await page.keyboard.insertText(ctx.path(name));
  await page
    .locator('.quick-input-widget:visible .monaco-list-row')
    .filter({ hasText: name })
    .first()
    .click();
  await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
}

async function openDesigner(ctx: Ctx) {
  await ctx.driver.command('RDLC Code: Open Designer');
  return ctx.driver.designerFrame();
}

/** Palette command followed by quick-pick selections (View: Move View needs two). */
async function palette(
  page: Page,
  command: string,
  ...picks: string[]
): Promise<void> {
  await blur(page);
  await page.keyboard.press(`${MOD}+Shift+P`);
  const input = page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await input.waitFor({ state: 'visible' });
  await page.keyboard.type(command, { delay: 10 });
  const rows = page.locator(
    '.quick-input-widget:visible .quick-input-list .monaco-list-row',
  );
  await rows.filter({ hasText: command }).first().click();
  for (const pick of picks) {
    await page.waitForTimeout(500);
    await input.waitFor({ state: 'visible' });
    await page.keyboard.type(pick, { delay: 10 });
    await rows.filter({ hasText: pick }).first().click();
  }
  await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
}

/** Window reload through the public command ("restart"): a marker proves the old page is gone. */
async function reload(page: Page): Promise<void> {
  const marker = '__rdlcBeforeReload';
  await page.evaluate((key) => {
    (globalThis as unknown as Record<string, boolean>)[key] = true;
  }, marker);
  await blur(page);
  await page.keyboard.press(`${MOD}+Shift+P`);
  await page
    .locator('.quick-input-widget:visible .quick-input-box input')
    .waitFor({ state: 'visible' });
  await page.keyboard.type('Developer: Reload Window', { delay: 10 });
  await page
    .locator('.quick-input-widget:visible .quick-input-list .monaco-list-row')
    .filter({ hasText: 'Developer: Reload Window' })
    .first()
    .click();
  await expect
    .poll(
      () =>
        page
          .evaluate(
            (key) =>
              !(globalThis as unknown as Record<string, boolean>)[key] &&
              !!document.querySelector('.monaco-workbench .part.statusbar'),
            marker,
          )
          .catch(() => false),
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(true);
}

/** Part (container location) that holds each native view, or `hidden`. */
async function placement(page: Page): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const label of VIEWS) {
    const found: string[] = [];
    for (const [name, selector] of Object.entries(PARTS))
      if (
        (await page
          .locator(selector)
          .locator('.pane-header')
          .filter({ hasText: label })
          .count()) > 0
      )
        found.push(name);
    result[label] = found.join('+') || 'hidden';
  }
  return result;
}

const everywhere = (where: string) =>
  Object.fromEntries(VIEWS.map((label) => [label, where]));

/** Host-owned visibility toggle through the container title context menu (a pane header shows only that view's actions). */
async function toggleView(page: Page, label: string): Promise<void> {
  await page
    .locator('.part.sidebar .composite.title')
    .click({ button: 'right' });
  const item = page
    .getByRole('menuitemcheckbox', { name: label })
    .or(page.getByRole('menuitem', { name: label }))
    .first();
  await item.hover();
  await page.waitForTimeout(250);
  await item.click();
  await expect(item).toBeHidden();
}

/** Explorer is a separate native contribution: show it, see the files, open one, see its menu. */
async function explorerWorks(ctx: Ctx, names: string[]): Promise<void> {
  const { page } = ctx;
  await ctx.driver.command('View: Show Explorer');
  for (const name of names) {
    const row = page
      .locator('.part.sidebar [role="treeitem"]')
      .filter({ hasText: name })
      .first();
    await expect(row, `Explorer lists ${name}`).toBeVisible();
  }
  const first = page
    .locator('.part.sidebar [role="treeitem"]')
    .filter({ hasText: names[0]! })
    .first();
  await first.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^Rename/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await first.click();
  await expect(
    page.locator('.tabs-container .tab').filter({ hasText: names[0]! }).first(),
  ).toBeVisible();
}

/** A view's title action: icon-less commands only render after the header is hovered. */
async function titleAction(
  page: Page,
  view: string,
  title: string,
): Promise<Locator> {
  const target = pane(page, view);
  await target.locator('.pane-header').hover();
  return target.getByLabel(title, { exact: true }).first();
}

/** New/Open Report in the no-report state: viewsWelcome buttons are required (contract native-workspace.md). */
function reportAction(
  page: Page,
  title: 'New Report' | 'Open Report',
): Locator {
  return pane(page, 'Report Structure').getByRole('button', {
    name: title,
    exact: true,
  });
}

async function expectNoReportState(ctx: Ctx): Promise<void> {
  for (const label of VIEWS)
    await expect(
      pane(ctx.page, label).getByText(NO_REPORT),
      `${label} no-report message`,
    ).toBeVisible();
}

async function expectNoNativeFocus(page: Page): Promise<void> {
  await expect(
    page.locator(
      Object.values(PARTS)
        .map((part) => `${part} [role="tree"]:focus-within`)
        .join(', '),
    ),
  ).toHaveCount(0);
}

const designerFrames = (page: Page) =>
  page
    .frames()
    .filter(
      (frame) =>
        frame.url().includes('index.html') &&
        frame.url().includes('vscode-webview'),
    ).length;

/** The Name field of the Properties panel, which is collapsed until its toolbar button is used. */
async function inspectorName(frame: Awaited<ReturnType<typeof openDesigner>>) {
  const properties = frame.getByRole('button', {
    name: 'Properties',
    exact: true,
  });
  if ((await properties.getAttribute('aria-expanded')) === 'false')
    await properties.click();
  return frame.getByRole('textbox', { name: 'Name', exact: true });
}

const textboxRow = (page: Page) =>
  page.getByRole('treeitem', { name: /^Textbox: Title/ }).first();

test('US1.1-container-before-designer', async () => {
  await session({ 'native-workspace.rdlc': FIXTURE.blank }, async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'native-workspace.rdlc');
    const explorerBefore = await readdir(ctx.dir);
    expect(designerFrames(page)).toBe(0);
    await expect(activityItem(page)).toHaveCount(1);
    // One Activity Bar activation, no report opened yet.
    await showRdlc(ctx);
    const headers = await page
      .locator('.part.sidebar .pane-header')
      .allTextContents();
    expect(
      VIEWS.map((view) => headers.findIndex((text) => text.includes(view))),
    ).toEqual([0, 1, 2]);
    expect(headers).toHaveLength(3);
    await expectNoReportState(ctx);
    await expect(
      pane(page, 'Components').getByRole('treeitem', {
        name: /^Textbox, Unavailable\./,
      }),
    ).toBeVisible();
    await expect(reportAction(page, 'New Report')).toBeVisible();
    await expect(reportAction(page, 'Open Report')).toBeVisible();
    expect(designerFrames(page)).toBe(0);
    await evidence(ctx, 'workspace-us1-1');
    // Explorer is unchanged by the RDLC activation.
    await explorerWorks(ctx, explorerBefore);
    await expect(rdlcHeaders(page)).toHaveCount(0);
    await expectPristine(ctx, original);
    expect(await readdir(ctx.dir)).toEqual(explorerBefore);
  });
});

test('US1.1-new-open-report', async () => {
  await session(
    {
      'opened.rdlc': FIXTURE.textbox,
      // Open Report uses the host file picker; the in-workbench dialog keeps it drivable.
      '.vscode/settings.json': {
        content: JSON.stringify({ 'files.simpleDialog.enable': true }),
      },
    },
    async (ctx) => {
      const { page } = ctx;
      const original = await snapshot(ctx, 'opened.rdlc');
      const files = await readdir(ctx.dir);
      await showRdlc(ctx);
      await expectNoReportState(ctx);
      await reportAction(page, 'Open Report').click();
      const input = page.locator(
        '.quick-input-widget:visible .quick-input-box input',
      );
      await input.waitFor({ state: 'visible' });
      await input.fill(ctx.path('opened.rdlc'));
      await input.press('Enter');
      await ctx.driver.designerFrame();
      for (const label of VIEWS)
        await expect(pane(page, label).locator('.pane-header')).toContainText(
          'opened.rdlc',
        );
      await expect(textboxRow(page)).toBeVisible();
      await expectPristine(ctx, original);
      // The driver captures one designer at a time: capture before a second opens.
      await evidence(ctx, 'workspace-us1-1-new-open');
      // New Report creates an untitled report through the retained command.
      // A report is open: welcome is gone, the Structure title action remains.
      await (
        await titleAction(page, 'Report Structure', 'RDLC Code: New Report')
      ).click();
      await expect(
        page.locator('.tabs-container .tab').filter({ hasText: /Untitled/ }),
      ).toBeVisible();
      for (const label of VIEWS)
        await expect(pane(page, label).locator('.pane-header')).toContainText(
          /Untitled/,
        );
      expect(await readdir(ctx.dir)).toEqual(files);
    },
  );
});

test('FR-001-activation', async () => {
  await session({ 'activation.rdlc': FIXTURE.blank }, async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'activation.rdlc');
    // Keyboard path: the generated container command, with Explorer showing first.
    await ctx.driver.command('View: Show Explorer');
    await ctx.driver.command('View: Show RDLC Code');
    for (const label of VIEWS)
      await expect(pane(page, label).locator('.pane-header')).toBeVisible();
    // Providers are live and the public commands exist before any designer.
    await expect(
      pane(page, 'Components').getByRole('treeitem', {
        name: /^Textbox, Unavailable\./,
      }),
    ).toBeVisible();
    for (const id of [
      'RDLC Code: New Report',
      'RDLC Code: Open Report',
      'RDLC Code: Open Designer',
      'RDLC Code: Open Source',
    ])
      expect(await commandAvailable(page, id), id).toBe(true);
    expect(designerFrames(page)).toBe(0);
    await expectPristine(ctx, original);
  });
});

test('US1.2-active-report-labels', async () => {
  await session({ 'labelled.rdlc': FIXTURE.textbox }, async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'labelled.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'labelled.rdlc');
    const frame = await openDesigner(ctx);
    for (const label of VIEWS)
      await expect(pane(page, label).locator('.pane-header')).toContainText(
        'labelled.rdlc',
      );
    await expect(textboxRow(page)).toBeVisible();
    await expectNoNativeFocus(page);
    // Central designer is visible and operable; Angular navigation is collapsed by default.
    await expect(frame.locator('rdlc-editor')).toBeVisible();
    await expect(
      frame.getByRole('button', { name: 'Undo', exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByRole('button', { name: 'Components', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(
      frame.getByRole('tablist', { name: 'Navigation panels' }),
    ).toBeHidden();
    await expect(frame.locator('#components-panel')).toBeHidden();
    await expect(frame.locator('#structure-panel')).toBeHidden();
    // Selecting through the native Structure view reaches the canvas/inspector.
    await textboxRow(page).click();
    await expect(frame.locator('.status-text')).toContainText('Primary: Title');
    await expect(await inspectorName(frame)).toHaveValue('Title');
    await evidence(ctx, 'workspace-us1-2');
    await expectPristine(ctx, original);
  });
});

test('US1.3-view-placement', async () => {
  await session(
    { 'placement.rdlc': FIXTURE.textbox, 'second.rdlc': FIXTURE.blank },
    async (ctx) => {
      const { page } = ctx;
      const original = await snapshot(ctx, 'placement.rdlc', 'second.rdlc');
      await showRdlc(ctx);
      await openFile(ctx, 'placement.rdlc');
      await openDesigner(ctx);
      await expect(textboxRow(page)).toBeVisible();
      expect(await placement(page)).toEqual(everywhere('sidebar'));
      // Move: Components leaves the side bar for the Panel through View: Move View.
      await palette(page, 'View: Move View', 'Components', 'New Panel Entry');
      const moved = { ...everywhere('sidebar'), Components: 'panel' };
      await expect.poll(() => placement(page)).toEqual(moved);
      await expect(
        page
          .locator('.part.panel')
          .getByRole('treeitem', { name: /^Textbox, Insert/ }),
      ).toBeVisible();
      // Refreshes (context switches back and forth) never reset the moved view.
      await openFile(ctx, 'second.rdlc');
      await expectNoNativeFocus(page);
      await openFile(ctx, 'placement.rdlc');
      expect(await placement(page)).toEqual(moved);
      // Hide: a hidden view stays hidden across a context change.
      await toggleView(page, 'Report Data');
      const hidden = { ...moved, 'Report Data': 'hidden' };
      await expect.poll(() => placement(page)).toEqual(hidden);
      await openFile(ctx, 'second.rdlc');
      expect(await placement(page)).toEqual(hidden);
      // The driver captures the visible designer: bring it back first.
      await openFile(ctx, 'placement.rdlc');
      await openDesigner(ctx);
      expect(await placement(page)).toEqual(hidden);
      await evidence(ctx, 'workspace-us1-3-moved-hidden');
      // Restart: placement and visibility survive a window reload.
      await reload(page);
      await showRdlc(ctx);
      await expect.poll(() => placement(page)).toEqual(hidden);
      // Restore: show Data again, then reset every location. With a single view left in the
      // container there is no per-view toggle menu; the host's view focus command reveals it.
      await ctx.driver.command('Focus on Report Data View');
      await expect.poll(() => placement(page)).toEqual(moved);
      await palette(page, 'View: Reset View Locations');
      await showRdlc(ctx);
      await expect.poll(() => placement(page)).toEqual(everywhere('sidebar'));
      await expectPristine(ctx, original);
    },
  );
});

test('FR-002-view-movement', async () => {
  await session(
    { 'movement.rdlc': FIXTURE.textbox, 'other.rdlc': FIXTURE.blank },
    async (ctx) => {
      const { page } = ctx;
      const original = await snapshot(ctx, 'movement.rdlc', 'other.rdlc');
      await showRdlc(ctx);
      await openFile(ctx, 'movement.rdlc');
      await openDesigner(ctx);
      // Move Report Structure to the Secondary Side Bar; Explorer and RDLC remain independent.
      await palette(
        page,
        'View: Move View',
        'Report Structure',
        'New Secondary Side Bar Entry',
      );
      const moved = {
        ...everywhere('sidebar'),
        'Report Structure': 'auxiliarybar',
      };
      await expect.poll(() => placement(page)).toEqual(moved);
      await expect(
        page.locator('.part.auxiliarybar').getByRole('treeitem', {
          name: /^Textbox: Title/,
        }),
      ).toBeVisible();
      await explorerWorks(ctx, ['movement.rdlc', 'other.rdlc']);
      await showRdlc(ctx);
      // Context churn must not relocate it or steal focus.
      await openFile(ctx, 'other.rdlc');
      await openFile(ctx, 'movement.rdlc');
      await expectNoNativeFocus(page);
      expect(await placement(page)).toEqual(moved);
      // Restart keeps the host-chosen location.
      await reload(page);
      await showRdlc(ctx);
      await expect.poll(() => placement(page)).toEqual(moved);
      await explorerWorks(ctx, ['movement.rdlc']);
      await palette(page, 'View: Reset View Locations');
      await showRdlc(ctx);
      await expect.poll(() => placement(page)).toEqual(everywhere('sidebar'));
      await expectPristine(ctx, original);
      await evidence(ctx, 'workspace-fr-002');
    },
  );
});

test('SC-001-clean-profile', async () => {
  await session({ 'clean.rdlc': FIXTURE.textbox }, async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'clean.rdlc');
    await showRdlc(ctx);
    await expect.poll(() => placement(page)).toEqual(everywhere('sidebar'));
    await openFile(ctx, 'clean.rdlc');
    await expect(
      pane(page, 'Components').locator('.pane-header'),
    ).toContainText('clean.rdlc');
    // Hide and restore each view; Explorer stays functional after every change.
    for (const label of VIEWS) {
      await showRdlc(ctx);
      await toggleView(page, label);
      await expect
        .poll(() => placement(page))
        .toEqual({ ...everywhere('sidebar'), [label]: 'hidden' });
      await explorerWorks(ctx, ['clean.rdlc']);
      await showRdlc(ctx);
      await toggleView(page, label);
      await expect.poll(() => placement(page)).toEqual(everywhere('sidebar'));
    }
    await evidence(ctx, 'workspace-sc-001');
    await expectPristine(ctx, original);
  });
});

test('US1.4-explorer-independent', async () => {
  await session(
    { 'explorer.rdlc': FIXTURE.textbox, 'sibling.rdlc': FIXTURE.blank },
    async (ctx) => {
      const { page } = ctx;
      const original = await snapshot(ctx, 'explorer.rdlc', 'sibling.rdlc');
      const files = await readdir(ctx.dir);
      await explorerWorks(ctx, files);
      await showRdlc(ctx);
      await openFile(ctx, 'explorer.rdlc');
      await expect(
        pane(page, 'Report Structure').locator('.pane-header'),
      ).toContainText('explorer.rdlc');
      // Back to Explorer: real tree, no RDLC panes mixed in, report still open in the editor.
      await explorerWorks(ctx, files);
      await expect(rdlcHeaders(page)).toHaveCount(0);
      await evidence(ctx, 'workspace-us1-4-explorer');
      // RDLC views are independently available again, still for the same report.
      await showRdlc(ctx);
      for (const label of VIEWS)
        await expect(pane(page, label).locator('.pane-header')).toContainText(
          'explorer.rdlc',
        );
      expect(await readdir(ctx.dir)).toEqual(files);
      await expectPristine(ctx, original);
    },
  );
});

test('FR-003-state-coverage', async () => {
  const textbox = (name: string) =>
    `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${name}</Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>1in</Left><Top>1in</Top><Width>1in</Width><Height>0.25in</Height></Textbox>`;
  const blank = await readFile(
    resolve(
      process.env.RDLC_DESKTOP_ROOT ?? process.cwd(),
      'tests/fixtures',
      FIXTURE.blank,
    ),
    'utf8',
  );
  // Over the 2000-node presentation budget: a generated variant of the blank fixture.
  const big = blank.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems>${Array.from({ length: 2100 }, (_, i) => textbox(`T${i}`)).join('')}</ReportItems>`,
  );
  expect(big).not.toBe(blank);
  await session(
    {
      'empty.rdlc': FIXTURE.blank,
      'supported.rdlc': FIXTURE.textbox,
      'invalid.rdlc': FIXTURE.malformed,
      'source-only.rdlc': FIXTURE.xml11,
      'big.rdlc': { content: big },
    },
    async (ctx) => {
      const { page } = ctx;
      const names = [
        'empty.rdlc',
        'supported.rdlc',
        'invalid.rdlc',
        'source-only.rdlc',
        'big.rdlc',
      ];
      const original = await snapshot(ctx, ...names);
      await showRdlc(ctx);
      // No report.
      await expectNoReportState(ctx);
      await expect(reportAction(page, 'New Report')).toBeVisible();
      await expect(reportAction(page, 'Open Report')).toBeVisible();
      // Loading resolves synchronously on the host: covered by tests/vscode/sidebar-loading.test.ts::FR-003-loading.
      await openFile(ctx, 'big.rdlc');
      // Wait for the 2100-node report to be loaded and its editor to own
      // focus before moving focus: a focus command that lands first is taken
      // back by the opening editor and End then moves the editor caret instead
      // of the (virtualized) tree.
      const structure = pane(page, 'Report Structure');
      await expect(structure.locator('.pane-header')).toContainText('big.rdlc');
      await expect(
        structure.getByRole('treeitem', { name: 'Textbox: T0' }),
      ).toBeVisible();
      await expect(
        page.locator('.monaco-workbench .tab.active', { hasText: 'big.rdlc' }),
      ).toBeVisible();
      await ctx.driver.command('Focus on Report Structure View');
      await expect(structure.locator('[role="tree"]:focus-within')).toHaveCount(
        1,
      );
      await page.keyboard.press('End');
      await expect(
        page.getByRole('treeitem', {
          name: 'Navigation incomplete. Inspect Code XML for the complete report.',
        }),
      ).toBeVisible();
      await expect(
        await titleAction(page, 'Report Structure', 'RDLC Code: Open Source'),
      ).toBeVisible();
      // Empty categories and no filter results.
      await openFile(ctx, 'empty.rdlc');
      await expect(
        pane(page, 'Report Data').getByRole('treeitem', {
          name: 'No definitions.',
        }),
      ).toHaveCount(4);
      await (
        await titleAction(page, 'Components', 'RDLC Code: Filter Components')
      ).click();
      const input = page.locator(
        '.quick-input-widget:visible .quick-input-box input',
      );
      await input.fill('no matching component');
      await input.press('Enter');
      await expect(
        page.getByRole('treeitem', {
          name: 'No components match. Use Clear Filter.',
        }),
      ).toBeVisible();
      await (
        await titleAction(page, 'Components', 'RDLC Code: Clear Filter')
      ).click();
      await expect(
        page.getByRole('treeitem', { name: /^Textbox, Insert/ }),
      ).toBeVisible();
      // Invalid source: the previous valid snapshot must not stay actionable.
      await openFile(ctx, 'supported.rdlc');
      await expect(textboxRow(page)).toBeVisible();
      await openFile(ctx, 'invalid.rdlc');
      for (const label of VIEWS)
        await expect(
          pane(page, label).getByText(
            'Invalid XML. Open Code XML to repair this report.',
          ),
        ).toBeVisible();
      await expect(textboxRow(page)).toHaveCount(0);
      for (const label of ['Report Structure', 'Report Data'])
        await expect(pane(page, label).getByRole('treeitem')).toHaveCount(0);
      await expect(
        await titleAction(page, 'Report Structure', 'RDLC Code: Open Source'),
      ).toBeVisible();
      await expect(
        pane(page, 'Components').getByRole('treeitem', {
          name: /^Textbox, Unavailable\./,
        }),
      ).toBeVisible();
      // Source-only: inspection and Code XML, no visual insertion.
      await openFile(ctx, 'source-only.rdlc');
      for (const label of VIEWS)
        await expect(
          pane(page, label).getByText(
            'Source-only report. Inspection and Code XML are available.',
          ),
        ).toBeVisible();
      await expect(textboxRow(page)).toHaveCount(0);
      await expect(
        await titleAction(page, 'Report Structure', 'RDLC Code: Open Source'),
      ).toBeVisible();
      await expect(
        pane(page, 'Components').getByRole('treeitem', {
          name: /^Textbox, Unavailable\./,
        }),
      ).toBeVisible();
      await evidence(ctx, 'workspace-fr-003-source-only');
      // Closing every report returns to the no-report state with nothing stale.
      await ctx.driver.command('View: Close All Editors');
      await expectNoReportState(ctx);
      await expect(textboxRow(page)).toHaveCount(0);
      await expectPristine(ctx, original);
    },
  );
});

test('FR-004-fallback', async () => {
  await session({ 'fallback.rdlc': FIXTURE.textbox }, async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'fallback.rdlc');
    const source = original.get('fallback.rdlc')!.toString('utf8');
    await showRdlc(ctx);
    await openFile(ctx, 'fallback.rdlc');
    const frame = await openDesigner(ctx);
    const access = frame.getByRole('button', {
      name: 'Components',
      exact: true,
    });
    await expect(access).toHaveAttribute('aria-expanded', 'false');
    // Hidden native views: the compact fallback is reachable and does not reopen them.
    await ctx.driver.command('View: Toggle Primary Side Bar Visibility');
    await expect(page.locator('.part.sidebar')).toBeHidden();
    await access.click();
    await expect(access).toHaveAttribute('aria-expanded', 'true');
    const card = frame.locator('[data-card="Textbox"]');
    await expect(card).toBeVisible();
    await expect(page.locator('.part.sidebar')).toBeHidden();
    await card.dragTo(frame.locator('.body'), {
      targetPosition: { x: 350, y: 80 },
    });
    await expect(
      frame.getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue('Textbox1');
    await page.keyboard.press(`${MOD}+s`);
    // Poll until the save settles on the complete document (source plus the
    // inserted textbox): a bare "differs from source" can match a truncated
    // mid-write read.
    const insertedTextbox = /<Textbox Name="Textbox1">[\s\S]*?<\/Textbox>/;
    await expect
      .poll(async () => {
        const saved = await readFile(ctx.path('fallback.rdlc'), 'utf8');
        return insertedTextbox.test(saved)
          ? saved.replace(insertedTextbox, '')
          : null;
      })
      .toBe(source);
    const dragged = await readFile(ctx.path('fallback.rdlc'), 'utf8');
    expect(dragged).toMatch(insertedTextbox);
    expect(dragged.replace(insertedTextbox, '')).toBe(source);
    await expect(page.locator('.part.sidebar')).toBeHidden();
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.keyboard.press(`${MOD}+s`);
    await expect
      .poll(() => readFile(ctx.path('fallback.rdlc'), 'utf8'))
      .toBe(source);
    await evidence(ctx, 'workspace-fr-004-hidden');
    // Moved native views: showing the fallback leaves their location alone.
    await ctx.driver.command('View: Toggle Primary Side Bar Visibility');
    await showRdlc(ctx);
    await palette(page, 'View: Move View', 'Components', 'New Panel Entry');
    const moved = { ...everywhere('sidebar'), Components: 'panel' };
    await expect.poll(() => placement(page)).toEqual(moved);
    await access.click();
    await expect(access).toHaveAttribute('aria-expanded', 'false');
    await access.click();
    await expect(access).toHaveAttribute('aria-expanded', 'true');
    await expect(card).toBeVisible();
    expect(await placement(page)).toEqual(moved);
    await palette(page, 'View: Reset View Locations');
    await expectPristine(ctx, original);
  });
});

test('EDGE-08-disposal', async () => {
  await session({ 'disposal.rdlc': FIXTURE.textbox }, async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'disposal.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'disposal.rdlc');
    await openDesigner(ctx);
    await expect(textboxRow(page)).toBeVisible();
    // Hide + move, then close the report: listeners go with it and nothing stale remains.
    await toggleView(page, 'Report Data');
    await palette(page, 'View: Move View', 'Components', 'New Panel Entry');
    const placed = {
      'Report Structure': 'sidebar',
      'Report Data': 'hidden',
      Components: 'panel',
    };
    await expect.poll(() => placement(page)).toEqual(placed);
    await ctx.driver.command('View: Close All Editors');
    await expect(
      pane(page, 'Report Structure').getByText(NO_REPORT),
    ).toBeVisible();
    await expect(textboxRow(page)).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: /Pending/ })).toHaveCount(
      0,
    );
    expect(await placement(page)).toEqual(placed);
    // An inspector edit settles when its field loses focus (any workbench command does that); a reload must never write the report.
    await openFile(ctx, 'disposal.rdlc');
    const frame = await openDesigner(ctx);
    await textboxRow(page).click();
    const name = await inspectorName(frame);
    await expect(name).toHaveValue('Title');
    await name.fill('DraftOnly');
    // Leaving the field (as any workbench command does) is what settles it; observe that.
    await page.locator('.tabs-container .tab.active').click();
    await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(1);
    await reload(page);
    await expect.poll(() => placement(page)).toEqual(placed);
    await expect(page.getByRole('treeitem', { name: /Pending/ })).toHaveCount(
      0,
    );
    await expect(page.getByText('DraftOnly')).toHaveCount(0);
    // The settled edit stays a host-restored working copy (hot exit): the report file itself is never written.
    expect(
      (await readFile(ctx.path('disposal.rdlc'))).equals(
        original.get('disposal.rdlc')!,
      ),
    ).toBe(true);
    await palette(page, 'View: Reset View Locations');
  });
});
