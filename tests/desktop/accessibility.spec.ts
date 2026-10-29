/**
 * Feature 005 US6 (AT-07): keyboard-only journeys on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/accessibility.spec.ts::<title>`). Journeys use the real
 * workbench: the palette is driven by shortcut + typing + Enter, the native
 * tree by its own keys and Shift+F10 menu, the canvas and the inspector by
 * their own shortcuts. Region entry points (the Properties panel button, an
 * inspector field) are focused programmatically; every action after that
 * focus is real keyboard input. Assertions read the live accessible DOM (roles,
 * `aria-label`, `ariaSnapshot`, painted focus) and independently read the
 * report bytes from disk. Nothing here claims screen-reader speech output.
 */
import {
  test,
  expect,
  type Frame,
  type Locator,
  type Page,
} from 'playwright/test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  launchTrustedDesktop,
  openContextMenuWithKeyboard,
  type DesktopDriver,
} from './driver.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const NO_REPORT = 'Open or create a report to begin.';

/**
 * Select-all in a webview field, then wait until the selection really spans
 * the value. The workbench relays the shortcut into the webview asynchronously
 * (observed on macOS), so typing straight after the keypress can land before
 * the selection and lose the first character.
 */
async function selectAllInField(page: Page, field: Locator): Promise<void> {
  await page.keyboard.press(`${MOD}+a`);
  await expect
    .poll(() =>
      field.evaluate((element) => {
        const input = element as HTMLInputElement;
        return (
          input.value.length > 0 &&
          input.selectionStart === 0 &&
          input.selectionEnd === input.value.length
        );
      }),
    )
    .toBe(true);
}
const COMPONENT_KINDS = [
  'Textbox',
  'Table',
  'Image',
  'Line',
  'Chart',
  'Subreport',
  'Rectangle',
  'List',
  'Matrix',
  'Dataset',
  'Parameter',
] as const;
const PANES = ['Report Structure', 'Report Data', 'Components'] as const;

type Files = Record<
  string,
  string | { readonly fixture: string } | { readonly content: string }
>;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  readonly artifacts: string;
  path(name: string): string;
}

/** Resolve a manifest id to bytes on disk; the manifest stays the fixture oracle. */
async function fixturePath(root: string, id: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'tests/fixtures/manifest.json'), 'utf8'),
  ) as {
    fixtures: { id: string; path: string; capabilities: readonly string[] }[];
  };
  const entry = manifest.fixtures.find((fixture) => fixture.id === id);
  if (!entry) throw new Error(`Unknown manifest fixture id: ${id}`);
  if (!entry.capabilities.includes('source'))
    throw new Error(`Fixture ${id} cannot be opened as report source`);
  return resolve(root, 'tests/fixtures', entry.path);
}

/**
 * Fresh trusted window whose workspace folder is a temp copy of the given
 * fixtures. The profile belongs to the driver and is removed by its close;
 * the workspace copy is removed here in both the passing and failing cases.
 */
async function session(
  files: Files,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'accessibility',
  );
  await mkdir(artifacts, { recursive: true });
  await mkdir(resolve(root, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(
    resolve(root, '.vscode-test/sidebar-accessibility-'),
  );
  let driver: DesktopDriver | undefined;
  let failed = false;
  let failure: unknown;
  try {
    for (const [name, source] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      if (typeof source === 'string')
        await copyFile(resolve(root, 'tests/fixtures', source), target);
      else if ('fixture' in source)
        await copyFile(await fixturePath(root, source.fixture), target);
      else await writeFile(target, source.content);
    }
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
      artifacts,
      path: (name) => join(dir, name),
    });
  } catch (error) {
    failed = true;
    failure = error;
  }
  // Shutdown must never replace the journey's own error, and the temp
  // workspace must go in both cases: collect first, then report together.
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
      'Accessibility session and cleanup failed',
    );
  if (failed) throw failure;
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

const pane = (page: Page, label: string) =>
  page
    .locator('.pane')
    .filter({ has: page.locator('.pane-header', { hasText: label }) });

async function blur(page: Page, frame?: Frame): Promise<void> {
  if (frame)
    await frame
      .evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      })
      .catch(() => {});
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** Palette round trip driven only by the keyboard: shortcut, typing, Enter. */
async function palette(
  page: Page,
  command: string,
  frame?: Frame,
): Promise<void> {
  await blur(page, frame);
  await page
    .locator('.quick-input-widget:visible')
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => {});
  await page.keyboard.press(`${MOD}+Shift+P`);
  const input = page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.type(command, { delay: 10 });
  await chooseQuickResult(page, command);
}

async function chooseQuickResult(page: Page, label: string): Promise<void> {
  const input = page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  const rows = page.locator(
    '.quick-input-widget:visible .quick-input-list .monaco-list-row',
  );
  const target = rows.filter({ hasText: label }).first();
  await expect(target, `quick-input result ${label}`).toBeVisible();
  const targetId = await target.getAttribute('id');
  for (let index = 0; index < (await rows.count()); index++) {
    if ((await input.getAttribute('aria-activedescendant')) === targetId) break;
    await input.press('ArrowDown');
  }
  await expect(input).toHaveAttribute('aria-activedescendant', targetId!);
  await input.press('Enter');
  // Commands may replace the palette with an input box or another picker.
  await expect(target).toBeHidden();
}

/** Quick Open with the keyboard only: shortcut, path, Enter. */
async function openReport(ctx: Ctx, name: string): Promise<void> {
  await blur(ctx.page);
  await ctx.page.keyboard.press(`${MOD}+p`);
  await ctx.page.keyboard.insertText(ctx.path(name));
  // Results arrive asynchronously; Enter before the file is listed picks nothing.
  await expect(
    ctx.page
      .locator('.quick-input-widget:visible .monaco-list-row')
      .filter({ hasText: name })
      .first(),
  ).toBeVisible();
  await ctx.page.keyboard.press('Enter');
  await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
}

async function openDesigner(ctx: Ctx): Promise<Frame> {
  await palette(ctx.page, 'RDLC Code: Open Designer');
  return ctx.driver.designerFrame();
}

const sidebarTree = (page: Page) =>
  page.locator('.part.sidebar [role="tree"]:focus-within');

/**
 * The label of the row that currently owns keyboard focus in a native tree,
 * however the host exposes it: focused row, active-descendant, or the host's
 * focused/selected row markers.
 */
async function activeTreeRow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const row =
      (active?.getAttribute('role') === 'treeitem' ? active : null) ??
      (() => {
        const owned = active?.getAttribute('aria-activedescendant');
        const byId = owned ? document.getElementById(owned) : null;
        const tree = active?.closest('[role="tree"]') ?? null;
        return (
          byId ??
          tree?.querySelector(
            '.monaco-list-row.focused, .monaco-list-row[aria-selected="true"]',
          ) ??
          null
        );
      })();
    if (!row) return null;
    return (
      row.getAttribute('aria-label') ??
      row.textContent?.replace(/\s+/g, ' ').trim() ??
      null
    );
  });
}

/** `aria-expanded` of the row that currently owns keyboard focus. */
async function focusedRowAttribute(
  page: Page,
  attribute: string,
): Promise<string | null> {
  return page.evaluate((name) => {
    const active = document.activeElement as HTMLElement | null;
    const tree = active?.closest('[role="tree"]') ?? null;
    const row =
      (active?.getAttribute('role') === 'treeitem' ? active : null) ??
      tree?.querySelector(
        '.monaco-list-row.focused, .monaco-list-row[aria-selected="true"]',
      ) ??
      null;
    return row?.getAttribute(name) ?? null;
  }, attribute);
}

/**
 * Walk the tree with ArrowDown until the focused row matches; the journey is
 * real keyboard navigation, never a synthetic click on the target row.
 */
async function focusRow(
  page: Page,
  pattern: RegExp,
  steps = 60,
): Promise<string> {
  // A known start makes the walk deterministic from any previous position.
  await page.keyboard.press('Home');
  for (let step = 0; step < steps; step++) {
    const label = await activeTreeRow(page);
    if (label && pattern.test(label)) return label;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`No focused tree row matched ${String(pattern)}`);
}

/** Painted focus of the focused native row, read from computed styles. */
async function paintedFocus(page: Page): Promise<{
  focusVisible: boolean;
  focusedBackground: string;
  siblingBackground: string;
  outlined: boolean;
} | null> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const tree = active?.closest('[role="tree"]') ?? null;
    const focused =
      (active && active.getAttribute('role') === 'treeitem' ? active : null) ??
      tree?.querySelector(
        '.monaco-list-row.focused, .monaco-list-row[aria-selected="true"]',
      );
    if (!focused) return null;
    const sibling =
      focused
        .closest('.monaco-list')
        ?.querySelector(
          '.monaco-list-row:not(.focused):not([aria-selected="true"])',
        ) ?? focused;
    const style = getComputedStyle(focused);
    const siblingStyle = getComputedStyle(sibling);
    return {
      focusVisible: active?.matches(':focus-visible') ?? false,
      focusedBackground: style.backgroundColor,
      siblingBackground: siblingStyle.backgroundColor,
      outlined:
        parseFloat(style.outlineWidth) > 0 &&
        !['none', 'hidden'].includes(style.outlineStyle) &&
        !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.outlineColor) &&
        style.outline !== siblingStyle.outline,
    };
  });
}

/** The focused row of the native context menu, or null when no menu is open. */
async function activeMenuItem(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const item = active?.closest(
      '[role="menuitem"], [role="menuitemcheckbox"]',
    );
    if (!item) return null;
    return (
      item.getAttribute('aria-label') ??
      item.textContent?.replace(/\s+/g, ' ').trim() ??
      null
    );
  });
}

/** Open Shift+F10's real context menu and walk it with the arrow keys only. */
async function menuTo(page: Page, match: RegExp): Promise<void> {
  await openContextMenuWithKeyboard(page);
  const context = page.locator('.context-view');
  const items = context
    .getByRole('menuitem')
    .or(context.getByRole('menuitemcheckbox'));
  await items.first().waitFor({ state: 'visible', timeout: 10_000 });
  for (let step = 0; step < 16; step++) {
    const label = await activeMenuItem(page);
    if (label && match.test(label)) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`No context-menu item matched ${String(match)}`);
}

/** Escape a regex literal for use inside a RegExp constructor. */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('US4.4-filter-clear', async () => {
  await session({ 'filter.rdlc': { fixture: 'local-blank' } }, async (ctx) => {
    const { page } = ctx;
    // Keyboard activation of the view container and of the Components view.
    await palette(page, 'View: Show RDLC Code');
    await palette(page, 'Focus on Components View');
    await expect(sidebarTree(page)).toHaveCount(1);
    // Filter through the public command; the quick input is typed, not clicked.
    await palette(page, 'RDLC Code: Filter Components');
    const input = page.locator(
      '.quick-input-widget:visible .quick-input-box input',
    );
    await input.waitFor({ state: 'visible' });
    await page.keyboard.type('no matching component', { delay: 10 });
    await input.press('Enter');
    await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
    await expect(
      page.getByRole('treeitem', {
        name: 'No components match. Use Clear Filter.',
      }),
    ).toBeVisible();
    // The accessible tree itself carries the empty result, not only pixels.
    expect(await page.locator('.part.sidebar').ariaSnapshot()).toContain(
      'No components match. Use Clear Filter.',
    );
    await expect(
      page.getByRole('treeitem', { name: /^Textbox, Insert/ }),
    ).toHaveCount(0);
    // Clear Filter restores the full eleven-kind inventory.
    await palette(page, 'RDLC Code: Clear Filter');
    await palette(page, 'Focus on Components View');
    const reached = new Set<string>();
    for (const kind of COMPONENT_KINDS) {
      await focusRow(page, new RegExp(`^${kind}, `));
      await expect(
        page.getByRole('treeitem', { name: new RegExp(`^${kind}, `) }),
        `${kind} row after Clear Filter`,
      ).toBeVisible();
      reached.add(kind);
    }
    expect([...reached]).toEqual(COMPONENT_KINDS);
    await ctx.driver.capture('us4-4-filter-clear');
  });
});

test('US6.1-keyboard-journey', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  // Real report source plus enough body rows to keep the tree scrollable, so
  // the obscured-target step selects a row that is not on screen yet.
  const base = await readFile(
    await fixturePath(root, 'interactive-mixed'),
    'utf8',
  );
  const extra = Array.from(
    { length: 40 },
    (_, i) =>
      `<Textbox Name="Scroll${i}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Row ${i}</Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>${(i % 6) + 1}in</Left><Top>${Math.floor(i / 6) + 1}in</Top><Width>1in</Width><Height>0.25in</Height></Textbox>`,
  ).join('');
  const journey = base.replace('<ReportItems>', `<ReportItems>${extra}`);
  expect(journey).not.toBe(base);
  await session({ 'journey.rdlc': { content: journey } }, async (ctx) => {
    const { page } = ctx;
    const original = await readFile(ctx.path('journey.rdlc'));
    await palette(page, 'View: Show RDLC Code');
    await openReport(ctx, 'journey.rdlc');
    const frame = await openDesigner(ctx);

    // 1. Focus the native tree through the public focus alias.
    await palette(page, 'Focus on Report Structure View');
    await expect(sidebarTree(page)).toHaveCount(1);
    await page.keyboard.press('Home');
    await expect.poll(() => activeTreeRow(page)).not.toBeNull();
    const startLabel = await activeTreeRow(page);
    expect(
      startLabel,
      'the focused tree row exposes an accessible name',
    ).not.toBeNull();

    // 2. Arrow navigation moves focus through the real tree, and Enter
    // activates the focused row: primary selection on both surfaces.
    const activated = await focusRow(page, /^Textbox: Scroll0\b/);
    expect(activated).not.toBe(startLabel);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('treeitem', {
        name: `Textbox: Scroll0, Primary, 1 selected`,
      }),
    ).toBeVisible();
    await expect(
      frame.locator('.item.primary'),
      'exactly one primary canvas item',
    ).toHaveCount(1);
    await expect(frame.locator('.status-text')).toContainText(
      'Primary: Scroll0',
    );
    await expect(sidebarTree(page)).toHaveCount(1);
    // Focus stays on the row that was activated.
    expect((await activeTreeRow(page))?.startsWith('Textbox: Scroll0')).toBe(
      true,
    );

    // 3. Expansion: the root row collapses with Left and reopens with Right.
    await page.keyboard.press('Home');
    const expandedBefore = await focusedRowAttribute(page, 'aria-expanded');
    expect(expandedBefore, 'the root row is collapsible').not.toBeNull();
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => focusedRowAttribute(page, 'aria-expanded'))
      .toBe('false');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => focusedRowAttribute(page, 'aria-expanded'))
      .toBe(expandedBefore);

    // 4. Obscured target: the tree is virtualized, so some rows are off
    // screen; End scrolls them into view and reveals the last row inside
    // the side bar viewport.
    const sidebarBox = await page.locator('.part.sidebar').boundingBox();
    expect(sidebarBox).not.toBeNull();
    const finalRow = sidebarTree(page)
      .locator('.monaco-list-rows')
      .getByRole('treeitem', { name: /^Chart(?:,|$)/ });
    await expect(
      finalRow,
      'the final row starts outside the rendered window',
    ).toBeHidden();
    await page.keyboard.press('End');
    await expect(
      finalRow,
      'End reveals the previously obscured final row',
    ).toBeVisible();
    const lastLabel = await activeTreeRow(page);
    expect(
      lastLabel,
      'End reaches a row with an accessible name',
    ).not.toBeNull();
    const revealed = page.getByRole('treeitem', { name: lastLabel! }).first();
    await expect(revealed).toBeVisible();
    const rowBox = await revealed.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.y).toBeGreaterThanOrEqual(sidebarBox!.y - 1);
    expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(
      sidebarBox!.y + sidebarBox!.height + 1,
    );

    // 5. Shift+F10 opens the real native context menu; Escape restores focus.
    // Reactivate the target row first so the canvas primary is unambiguous.
    await focusRow(page, /^Textbox: Scroll0\b/);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('treeitem', {
        name: 'Textbox: Scroll0, Primary, 1 selected',
      }),
    ).toBeVisible();
    const menuAnchor = await activeTreeRow(page);
    await menuTo(page, /^RDLC Code: Properties$/);
    await expect(
      page.locator('.context-view').getByRole('menuitem').first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('.context-view').getByRole('menuitem').first(),
    ).toBeHidden();
    expect(await activeTreeRow(page)).toBe(menuAnchor);

    // 6. Shift+F10 -> Properties reaches the inspector with the keyboard.
    await menuTo(page, /^RDLC Code: Properties$/);
    await page.keyboard.press('Enter');
    const properties = frame.getByRole('button', {
      name: 'Properties',
      exact: true,
    });
    await expect(properties).toBeVisible();
    if ((await properties.getAttribute('aria-expanded')) === 'false') {
      await properties.focus();
      await page.keyboard.press('Enter');
    }
    const nameField = frame.getByRole('textbox', {
      name: 'Name',
      exact: true,
    });
    await expect(nameField).toBeVisible();
    await expect(nameField).toBeFocused();
    expect(await nameField.inputValue()).toBe('Scroll0');

    // 7. Field editing commits exactly once and only the accepted value.
    await selectAllInField(page, nameField);
    await page.keyboard.type('RenamedByKeyboard', { delay: 5 });
    expect(await nameField.inputValue()).toBe('RenamedByKeyboard');
    await page.keyboard.press('Enter');
    await expect(nameField).toHaveValue('RenamedByKeyboard');
    // Save the accepted edit before independently reading its bytes from disk.
    await page.keyboard.press(`${MOD}+s`);
    await expect
      .poll(() => readFile(ctx.path('journey.rdlc'), 'utf8'))
      .toContain('<Textbox Name="RenamedByKeyboard"');
    const renamed = await readFile(ctx.path('journey.rdlc'), 'utf8');
    expect(
      renamed.replace(
        '<Textbox Name="RenamedByKeyboard"',
        '<Textbox Name="Scroll0"',
      ),
    ).toBe(original.toString('utf8'));
    await expect(nameField).toHaveValue('RenamedByKeyboard');
    // Status line and native row announce the new primary, once.
    await expect(frame.locator('.status-text')).toContainText(
      'Primary: RenamedByKeyboard',
    );
    await expect(
      page.getByRole('treeitem', {
        name: 'Textbox: RenamedByKeyboard, Primary, 1 selected',
      }),
    ).toBeVisible();
    expect(
      (await page.getByRole('treeitem').allTextContents()).filter((text) =>
        text.includes('RenamedByKeyboard'),
      ),
    ).toHaveLength(1);

    // 8. The independently saved bytes remain the accepted rename.
    await expect
      .poll(() => readFile(ctx.path('journey.rdlc'), 'utf8'))
      .toBe(renamed);

    // 9. Return: Escape leaves the inspector field and gives focus back to
    // the authoring canvas (T064 focus return), with the canvas usable.
    await nameField.focus();
    await page.keyboard.press('Escape');
    await expect
      .poll(
        () => frame.evaluate(() => document.activeElement?.className ?? ''),
        {
          message: 'focus returns to the authoring canvas after the journey',
        },
      )
      .toContain('viewport');
    await expect(
      frame.getByRole('group', { name: /Authoring layout canvas/ }),
    ).toBeVisible();

    // Evidence: full-window capture, frame bounds and the accessible tree.
    await page.screenshot({
      path: join(ctx.artifacts, 'us6-1-keyboard-journey.png'),
    });
    const frameBounds = await frame.locator('rdlc-editor').boundingBox();
    expect(
      frameBounds,
      'the designer frame reports real bounds',
    ).not.toBeNull();
    await writeFile(
      join(ctx.artifacts, 'focus-tree.json'),
      `${JSON.stringify(
        {
          assertion:
            'tests/desktop/accessibility.spec.ts::US6.1-keyboard-journey',
          focus: await page.evaluate(() => ({
            tag: document.activeElement?.tagName.toLowerCase() ?? null,
            label: document.activeElement?.getAttribute('aria-label') ?? null,
          })),
          frameBounds,
          windowScreenshot: 'us6-1-keyboard-journey.png',
          accessibleTree: await page.locator('.part.sidebar').ariaSnapshot(),
          designerAccessibleTree: await frame
            .locator('rdlc-editor')
            .ariaSnapshot(),
        },
        null,
        2,
      )}\n`,
    );
    await ctx.driver.capture('us6-1-keyboard-journey');
  });
});

test('FR-003-state-labels', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const blank = await readFile(await fixturePath(root, 'local-blank'), 'utf8');
  const textbox = (name: string) =>
    `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${name}</Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>1in</Left><Top>1in</Top><Width>1in</Width><Height>0.25in</Height></Textbox>`;
  const big = blank.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems>${Array.from({ length: 2100 }, (_, i) => textbox(`T${i}`)).join('')}</ReportItems>`,
  );
  expect(big).not.toBe(blank);
  await session(
    {
      'empty.rdlc': { fixture: 'local-blank' },
      'supported.rdlc': { fixture: 'textbox-supported' },
      'invalid.rdlc': { fixture: 'malformed' },
      'source-only.rdlc': { fixture: 'unsupported-xml11' },
      'big.rdlc': { content: big },
    },
    async (ctx) => {
      const { page } = ctx;
      await palette(page, 'View: Show RDLC Code');
      // No report: the welcome state is reachable and named.
      for (const label of PANES)
        await expect(
          pane(page, label).getByText(NO_REPORT),
          `${label} no-report message`,
        ).toBeVisible();
      expect(await page.locator('.part.sidebar').ariaSnapshot()).toContain(
        NO_REPORT,
      );

      // Empty categories: each category states that it holds no definitions.
      await openReport(ctx, 'empty.rdlc');
      await expect(
        page.getByRole('treeitem', { name: 'No definitions.' }),
      ).toHaveCount(4);
      expect(await page.locator('.part.sidebar').ariaSnapshot()).toContain(
        'No definitions.',
      );

      // No match: the filter result is an explicit, named state.
      await palette(page, 'RDLC Code: Filter Components');
      const input = page.locator(
        '.quick-input-widget:visible .quick-input-box input',
      );
      await input.waitFor({ state: 'visible' });
      await page.keyboard.type('definitely no component', { delay: 10 });
      await input.press('Enter');
      await expect(
        page.getByRole('treeitem', {
          name: 'No components match. Use Clear Filter.',
        }),
      ).toBeVisible();
      await palette(page, 'RDLC Code: Clear Filter');

      // Invalid source: no stale actionable row survives the state change.
      await openReport(ctx, 'supported.rdlc');
      await expect(
        page.getByRole('treeitem', { name: /^Textbox: Title/ }).first(),
      ).toBeVisible();
      await openReport(ctx, 'invalid.rdlc');
      for (const label of PANES)
        await expect(
          pane(page, label).getByText(
            'Invalid XML. Open Code XML to repair this report.',
          ),
          `${label} invalid message`,
        ).toBeVisible();
      for (const label of ['Report Structure', 'Report Data'])
        await expect(pane(page, label).getByRole('treeitem')).toHaveCount(0);
      expect(await page.locator('.part.sidebar').ariaSnapshot()).toContain(
        'Invalid XML. Open Code XML to repair this report.',
      );

      // Source-only: inspection stays offered; empty Data categories carry no XML authority.
      await openReport(ctx, 'source-only.rdlc');
      for (const label of PANES)
        await expect(
          pane(page, label).getByText(
            'Source-only report. Inspection and Code XML are available.',
          ),
          `${label} source-only message`,
        ).toBeVisible();
      await expect(
        pane(page, 'Report Structure').getByRole('treeitem'),
      ).toHaveCount(0);
      const dataRows = pane(page, 'Report Data')
        .locator('.monaco-list-rows')
        .getByRole('treeitem');
      await expect(dataRows).toHaveCount(8);
      await expect(
        dataRows.filter({ hasText: /^No definitions\.$/ }),
      ).toHaveCount(4);
      for (const category of [
        'Datasets / Fields',
        'Parameters',
        'Embedded Images',
        'Data Sources',
      ])
        await expect(
          dataRows.filter({ hasText: new RegExp(`^${category}\\s*$`) }),
        ).toHaveCount(1);

      // Truncated projection: the incomplete state names its own next action.
      await openReport(ctx, 'big.rdlc');
      await palette(page, 'Focus on Report Structure View');
      await page.keyboard.press('End');
      await expect(
        page.getByRole('treeitem', {
          name: 'Navigation incomplete. Inspect Code XML for the complete report.',
        }),
      ).toBeVisible();

      const accessibleTree = await page.locator('.part.sidebar').ariaSnapshot();
      // One report at a time: the driver captures a single designer.
      await palette(page, 'View: Close All Editors');
      await ctx.driver.capture('fr-003-state-labels');
      await writeFile(
        join(ctx.artifacts, 'fr-003-state-labels.json'),
        `${JSON.stringify(
          {
            assertion:
              'tests/desktop/accessibility.spec.ts::FR-003-state-labels',
            accessibleTree,
            states: [
              'no-report',
              'empty',
              'no-match',
              'invalid',
              'source-only',
              'truncated',
            ],
            loadingState:
              'host-synchronous; asserted by tests/vscode/sidebar-loading.test.ts::FR-003-loading',
          },
          null,
          2,
        )}\n`,
      );
    },
  );
});

test('FR-027-keyboard', async () => {
  await session(
    { 'keyboard.rdlc': { fixture: 'textbox-supported' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await readFile(ctx.path('keyboard.rdlc'));
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'keyboard.rdlc');
      const frame = await openDesigner(ctx);

      // Reachable by keyboard: container command, then the focus alias.
      await palette(page, 'Focus on Report Structure View');
      await expect(sidebarTree(page)).toHaveCount(1);
      await page.keyboard.press('Home');
      await expect.poll(() => activeTreeRow(page)).not.toBeNull();
      const firstRow = await activeTreeRow(page);
      expect(firstRow, 'the tree exposes a focused row').not.toBeNull();

      // Visible focus: the focused row is focus-visible and painted apart
      // from an unfocused sibling (a real style difference, no colour guess).
      const focus = await paintedFocus(page);
      expect(focus, 'the native tree paints its focused row').not.toBeNull();
      expect(focus!.focusVisible).toBe(true);
      expect(focus!.focusedBackground).not.toBe(focus!.siblingBackground);

      // Readable selection and primary state on both surfaces.
      const target = await focusRow(page, /^Textbox: Title\b/);
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('treeitem', {
          name: 'Textbox: Title, Primary, 1 selected',
        }),
      ).toBeVisible();
      await expect(frame.locator('.status-text')).toContainText(
        'Primary: Title',
      );
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      expect(target.startsWith('Textbox: Title')).toBe(true);

      // Refusal state: an invalid name is refused, announced once, and the
      // report bytes stay untouched.
      const properties = frame.getByRole('button', {
        name: 'Properties',
        exact: true,
      });
      if ((await properties.getAttribute('aria-expanded')) === 'false') {
        await properties.focus();
        await page.keyboard.press('Enter');
      }
      const nameField = frame.getByRole('textbox', {
        name: 'Name',
        exact: true,
      });
      await expect(nameField).toBeVisible();
      const accepted = await nameField.inputValue();
      expect(accepted).toBe('Title');
      await nameField.focus();
      await selectAllInField(page, nameField);
      await page.keyboard.type('9 not a valid name!', { delay: 5 });
      await page.keyboard.press('Enter');
      const refusal = frame.locator('#report-refusal');
      await expect(refusal).toBeVisible();
      expect(await refusal.count(), 'the refusal is announced once').toBe(1);
      await expect(refusal).toContainText('Not applied');
      await expect(refusal).toContainText('The report is unchanged');
      await expect(nameField).toHaveAttribute(
        'aria-describedby',
        'textbox-refusal',
      );
      expect(await readFile(ctx.path('keyboard.rdlc'))).toEqual(original);

      // Escape restores the accepted value without committing anything.
      await expect(nameField).toBeFocused();
      await selectAllInField(page, nameField);
      await expect(nameField).toBeFocused();
      await page.keyboard.type('DraftThatNeverCommits', { delay: 5 });
      expect(await nameField.inputValue()).toBe('DraftThatNeverCommits');
      await page.keyboard.press('Escape');
      await expect(frame.locator('input[data-property="name"]')).toHaveValue(
        accepted,
      );
      if ((await properties.getAttribute('aria-expanded')) === 'false') {
        await properties.focus();
        await page.keyboard.press('Enter');
      }
      await expect(nameField).toHaveValue(accepted);

      // Normal field shortcuts stay field-local: arrows move the caret, the
      // canvas item does not nudge, and clipboard cut/paste round-trips.
      const itemBox = await frame.locator('.item.primary').boundingBox();
      expect(itemBox).not.toBeNull();
      await nameField.focus();
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.press('ArrowRight');
      // Relayed into the webview asynchronously, like the clipboard keys.
      await expect
        .poll(() =>
          nameField.evaluate(
            (element) => (element as HTMLInputElement).selectionStart,
          ),
        )
        .toBe(accepted.length);
      expect(await frame.locator('.item.primary').boundingBox()).toEqual(
        itemBox,
      );
      await page.keyboard.press(`${MOD}+a`);
      // The workbench relays clipboard shortcuts into the webview
      // asynchronously, so each result is awaited rather than read once.
      await page.keyboard.press(`${MOD}+x`);
      await expect(nameField).toHaveValue('');
      await page.keyboard.press(`${MOD}+v`);
      await expect(nameField).toHaveValue(accepted);
      await page.keyboard.press(`${MOD}+z`);
      expect(await readFile(ctx.path('keyboard.rdlc'))).toEqual(original);
      expect(await frame.locator('.item.primary').boundingBox()).toEqual(
        itemBox,
      );

      // No trap: Tab keeps moving focus between different elements, and the
      // palette is still reachable with the keyboard afterwards.
      const tags: string[] = [];
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        tags.push(
          JSON.stringify(
            await Promise.all(
              [page, frame].map((context) =>
                context.evaluate(() => {
                  if (!document.hasFocus()) return null;
                  const active = document.activeElement;
                  return active &&
                    !['BODY', 'HTML', 'IFRAME'].includes(active.tagName)
                    ? [...document.querySelectorAll('*')].indexOf(active)
                    : null;
                }),
              ),
            ),
          ),
        );
      }
      expect(tags.every((tag) => tag !== '[null,null]')).toBe(true);
      expect(new Set(tags).size, 'focus keeps moving').toBeGreaterThan(1);
      await palette(page, 'Focus on Report Structure View', frame);
      await expect(sidebarTree(page)).toHaveCount(1);

      await ctx.driver.capture('fr-027-keyboard');
      await writeFile(
        join(ctx.artifacts, 'focus-tree-fr-027.json'),
        `${JSON.stringify(
          {
            assertion: 'tests/desktop/accessibility.spec.ts::FR-027-keyboard',
            focus: await paintedFocus(page),
            accessibleTree: await page.locator('.part.sidebar').ariaSnapshot(),
          },
          null,
          2,
        )}\n`,
      );
    },
  );
});

test('EDGE-10-long-labels', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const blank = await readFile(await fixturePath(root, 'local-blank'), 'utf8');
  const longName = `LongLabel${'X'.repeat(240)}`;
  const longLabelReport = blank.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems><Textbox Name="${longName}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Long label</Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>1in</Left><Top>1in</Top><Width>2in</Width><Height>0.25in</Height></Textbox></ReportItems>`,
  );
  expect(longLabelReport).not.toBe(blank);
  // Query text, connection and column identifiers are the payloads that must
  // never reach labels, tooltips or the accessible tree.
  const secrets = ['SELECT untouched', 'application_column', 'Untouched'];
  await session(
    {
      'long-label.rdlc': { content: longLabelReport },
      'preserved.rdlc': { fixture: 'local-preserved-metadata' },
      'seven-types.rdlc': { fixture: 'local-seven-types' },
    },
    async (ctx) => {
      const { page } = ctx;
      await palette(page, 'View: Show RDLC Code');
      // A very long authored name stays fully available to assistive
      // technology while the row itself stays compact in the side bar.
      await openReport(ctx, 'long-label.rdlc');
      await palette(page, 'Focus on Report Structure View');
      const row = page
        .getByRole('treeitem', { name: new RegExp(`^Textbox: ${longName}`) })
        .first();
      await expect(row).toBeVisible();
      const accessibleName = await row.getAttribute('aria-label');
      expect(accessibleName).toContain(longName);
      expect(accessibleName!.length).toBeGreaterThan(longName.length);
      const sidebarBox = await page.locator('.part.sidebar').boundingBox();
      const rowBox = await row.boundingBox();
      expect(sidebarBox).not.toBeNull();
      expect(rowBox).not.toBeNull();
      expect(
        rowBox!.width,
        'the long row stays inside the side bar instead of widening it',
      ).toBeLessThanOrEqual(sidebarBox!.width + 1);

      // Data definitions keep their full names, and no query or connection
      // payload reaches labels, tooltips or the accessible tree.
      await openReport(ctx, 'preserved.rdlc');
      await palette(page, 'Focus on Report Data View');
      await expect(page.getByRole('treeitem').first()).toBeVisible();
      const accessible = await page.locator('.part.sidebar').ariaSnapshot();
      expect(accessible).toContain('Existing');
      const tooltips = await page
        .locator('.monaco-workbench [title]')
        .evaluateAll((elements) =>
          elements
            .map((element) => element.getAttribute('title') ?? '')
            .filter(Boolean),
        );
      const checked = [...tooltips, accessible];
      for (const secret of secrets)
        for (const text of checked)
          expect(text, `payload ${secret} stays out of the UI`).not.toContain(
            secret,
          );

      // The seven typed fields keep their full accessible names too.
      await openReport(ctx, 'seven-types.rdlc');
      await palette(page, 'Focus on Report Data View');
      const sevenTypes = await page.locator('.part.sidebar').ariaSnapshot();
      expect(sevenTypes).toContain('Orders');

      // One report at a time: the driver captures a single designer.
      await palette(page, 'View: Close All Editors');
      await ctx.driver.capture('edge-10-long-labels');
      await writeFile(
        join(ctx.artifacts, 'payload-exclusion-log.json'),
        `${JSON.stringify(
          {
            assertion:
              'tests/desktop/accessibility.spec.ts::EDGE-10-long-labels',
            checked,
            checkedCount: checked.length,
            longLabelLength: longName.length,
            accessibleNameLength: accessibleName!.length,
            excluded: secrets,
          },
          null,
          2,
        )}\n`,
      );
    },
  );
});

test('SC-006-keyboard-themes', async () => {
  const themes: readonly {
    readonly label: string;
    readonly workbench: RegExp;
    readonly webview: RegExp;
  }[] = [
    { label: 'Light+', workbench: /\bvs\b/, webview: /\bvscode-light\b/ },
    { label: 'Dark+', workbench: /\bvs-dark\b/, webview: /\bvscode-dark\b/ },
    {
      label: 'High Contrast',
      workbench: /\bhc-black\b/,
      webview: /\bvscode-high-contrast\b/,
    },
    {
      label: 'High Contrast Light',
      workbench: /\bhc-light\b/,
      webview: /\bvscode-high-contrast-light\b/,
    },
  ];
  await session(
    { 'themes.rdlc': { fixture: 'textbox-supported' } },
    async (ctx) => {
      const { page } = ctx;
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'themes.rdlc');
      const frame = await openDesigner(ctx);
      const observed: { theme: string; workbench: string; webview: string }[] =
        [];
      for (const theme of themes) {
        await palette(page, 'Preferences: Color Theme', frame);
        const input = page.locator(
          '.quick-input-widget:visible .quick-input-box input',
        );
        await input.waitFor({ state: 'visible' });
        await page.keyboard.type(theme.label, { delay: 10 });
        await chooseQuickResult(page, theme.label);
        await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
        await expect
          .poll(
            async () =>
              (await page.locator('.monaco-workbench').getAttribute('class')) ??
              '',
          )
          .toMatch(theme.workbench);
        // The designer webview observes the same theme through its host class.
        await expect
          .poll(
            async () =>
              (await frame.locator('body').getAttribute('class')) ?? '',
          )
          .toMatch(theme.webview);
        observed.push({
          theme: theme.label,
          workbench:
            (await page.locator('.monaco-workbench').getAttribute('class')) ??
            '',
          webview: (await frame.locator('body').getAttribute('class')) ?? '',
        });

        // The same keyboard journey completes in this theme: focus, navigate,
        // activate, read primary, painted focus, then back to the palette.
        await palette(page, 'Focus on Report Structure View', frame);
        await expect(sidebarTree(page)).toHaveCount(1);
        await page.keyboard.press('Home');
        await expect.poll(() => activeTreeRow(page)).not.toBeNull();
        const row = await activeTreeRow(page);
        expect(
          row,
          `${theme.label}: the tree exposes a focused row`,
        ).not.toBeNull();
        const moved = await focusRow(page, /^Textbox: /);
        expect(moved).not.toBe(row);
        await page.keyboard.press('Enter');
        const plain = moved.replace(/,.*$/, '');
        await expect(
          page.getByRole('treeitem', {
            name: new RegExp(`^${escape(plain)}, Primary, 1 selected$`),
          }),
          `${theme.label}: primary selection`,
        ).toBeVisible();
        await expect(frame.locator('.item.primary')).toHaveCount(1);
        const painted = await paintedFocus(page);
        expect(painted, `${theme.label}: focus stays painted`).not.toBeNull();
        expect(painted!.focusVisible).toBe(true);
        expect(
          painted!.focusedBackground !== painted!.siblingBackground ||
            painted!.outlined,
          `${theme.label}: focus has a distinct background or visible outline`,
        ).toBe(true);
        // No trap: the palette is still reachable with the keyboard.
        await palette(page, 'Focus on Report Structure View', frame);
        await expect(sidebarTree(page)).toHaveCount(1);
      }
      expect(observed).toHaveLength(themes.length);
      await ctx.driver.capture('sc-006-keyboard-themes');
      await writeFile(
        join(ctx.artifacts, 'focus-tree-sc-006.json'),
        `${JSON.stringify(
          {
            assertion:
              'tests/desktop/accessibility.spec.ts::SC-006-keyboard-themes',
            themes: observed,
            accessibleTree: await page.locator('.part.sidebar').ariaSnapshot(),
          },
          null,
          2,
        )}\n`,
      );
    },
  );
});
