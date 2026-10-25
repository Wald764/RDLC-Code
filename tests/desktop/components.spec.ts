/**
 * Feature 005 US4 (AT-05/06): the native Components toolbox and the compact
 * designer fallback on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/components.spec.ts::<title>`). Each test launches the real
 * Desktop binary in a disposable profile over a temp workspace copy of
 * manifest-listed fixtures, drives the actual workbench with real pointer and
 * keyboard input, and reads report bytes independently from disk. Expected
 * sources are hand-written literals of 004's creation defaults — never a
 * production parser, serializer or captured output.
 *
 * Quick Open associates `.rdlc` with the text editor, so every journey that
 * needs the canvas opens its own designer with `RDLC Code: Open Designer`; the
 * product's default editor association is never changed here, and the
 * source-focus auto-opening path stays owned by context.spec.ts.
 *
 * Native TreeView custom-MIME drag remains unavailable (native-drag.spec.ts
 * owns that evidence): no substitute drag controller is exercised or
 * implemented here — only activation, the recorded unavailability, and 004's
 * real HTML drag through the compact fallback.
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
import { launchTrustedDesktop, type DesktopDriver } from './driver.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const BLANK = 'datasets/blank.rdlc';
const MALFORMED = 'xml/malformed.rdlc';
const SOURCE_ONLY = 'textboxes/unsupported-profile.rdlc';

/** Catalog order; exactly three kinds are creatable. */
const ALL_KINDS = [
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
const UNAVAILABLE_KINDS = [
  'Image',
  'Line',
  'Chart',
  'Subreport',
  'Rectangle',
  'List',
  'Matrix',
  'Parameter',
] as const;

const REASON = (label: string): string =>
  `${label} authoring is unavailable. Existing content is preserved; use Code XML.`;
const NOT_EDITABLE = 'Open an editable report to insert components.';
const DRAG_NOTE =
  'Native drag is unavailable. Activate Textbox, Table or Dataset to insert; use the compact designer fallback for drag.';
const FILTER_PROMPT =
  'Native drag is unavailable; activate a supported item to insert.';
const STALE =
  'This report item is stale. Activate its current row and try again.';

/**
 * Drop point measured from the body origin: raw 262.5pt × 30pt, which the
 * 10pt grid snaps to 260pt × 30pt. Both are far from a grid boundary and from
 * a body-edge guide, so a one-pixel pointer rounding cannot move the result.
 */
const DROP = { x: 350, y: 40 } as const;

// ---------------------------------------------------------------------------
// Independent expected sources (004 creation defaults, hand-written literals)
// ---------------------------------------------------------------------------

const textboxXml = (name: string, left = '20pt', top = '20pt'): string =>
  `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value></Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>${left}</Left><Top>${top}</Top><Width>1in</Width><Height>0.25in</Height></Textbox>`;

const cellXml = (name: string): string =>
  `<TablixCell><CellContents><Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value></Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>`;

/** Unbound static table: two 1in columns, two 0.25in rows, four cells, no DataSetName. */
const tableXml = (name: string, left = '20pt', top = '20pt'): string =>
  `<Tablix Name="${name}"><TablixBody><TablixColumns><TablixColumn><Width>1in</Width></TablixColumn><TablixColumn><Width>1in</Width></TablixColumn></TablixColumns><TablixRows><TablixRow><Height>0.25in</Height><TablixCells>${cellXml('Cell')}${cellXml('Cell1')}</TablixCells></TablixRow><TablixRow><Height>0.25in</Height><TablixCells>${cellXml('Cell2')}${cellXml('Cell3')}</TablixCells></TablixRow></TablixRows></TablixBody><TablixColumnHierarchy><TablixMembers><TablixMember></TablixMember><TablixMember></TablixMember></TablixMembers></TablixColumnHierarchy><TablixRowHierarchy><TablixMembers><TablixMember></TablixMember><TablixMember></TablixMember></TablixMembers></TablixRowHierarchy><Left>${left}</Left><Top>${top}</Top><Width>2in</Width><Height>0.5in</Height></Tablix>`;

/** Empty local dataset: declarations only, never a query, field or canvas item. */
const datasetXml = (name: string): string =>
  `<DataSet Name="${name}"><CaseSensitivity>Auto</CaseSensitivity></DataSet>`;

/**
 * After binding, exactly two spans appear: DataSetName directly before the
 * Tablix close tag and one detail member inside the last row member.
 */
const tableXmlBound = (name: string, dataset: string): string =>
  tableXml(name)
    .replace(
      '</TablixMember></TablixMembers></TablixRowHierarchy>',
      `<Group Name="${name}Details"></Group></TablixMember></TablixMembers></TablixRowHierarchy>`,
    )
    .replace('</Tablix>', `<DataSetName>${dataset}</DataSetName></Tablix>`);

/** One body insertion at the end of ReportItems, byte-exact everywhere else. */
const withReportItem = (source: string, xml: string): string => {
  const next = source.replace('</ReportItems>', `${xml}</ReportItems>`);
  expect(next, 'the independent expectation differs from the fixture').not.toBe(
    source,
  );
  return next;
};

/** One dataset insertion, byte-exact everywhere else (no geometry by construction). */
const withDataSet = (source: string, xml: string): string => {
  const next = source.includes('</DataSets>')
    ? source.replace('</DataSets>', `${xml}</DataSets>`)
    : source.replace('</Report>', `<DataSets>${xml}</DataSets></Report>`);
  expect(next, 'the independent expectation differs from the fixture').not.toBe(
    source,
  );
  return next;
};

/**
 * Preserved neighbours for the naming cases: Textbox1 and Textbox3 leave the
 * gap Textbox2 (lowest free number wins) and DataSet1 is already taken.
 */
async function collisions(root: string): Promise<string> {
  const blank = await readFile(resolve(root, 'tests/fixtures', BLANK), 'utf8');
  const preserved = (name: string): string =>
    `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${name}</Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>2in</Left><Top>2in</Top><Width>1in</Width><Height>0.25in</Height></Textbox>`;
  const items = blank.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems>${preserved('Textbox1')}${preserved('Textbox3')}</ReportItems>`,
  );
  expect(items).not.toBe(blank);
  const next = withDataSet(items, datasetXml('DataSet1'));
  return next;
}

// ---------------------------------------------------------------------------
// Session and workbench helpers (local, no shared framework)
// ---------------------------------------------------------------------------

type Files = Record<string, string | { readonly content: string }>;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  path(name: string): string;
}

/**
 * Fresh trusted window whose workspace folder is a temp copy of the given
 * fixtures. The profile belongs to the driver and is removed by its close;
 * the owned temp workspace goes in both the passing and the failing case.
 */
async function session(
  files: Files,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'components',
  );
  await mkdir(artifacts, { recursive: true });
  await mkdir(resolve(root, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(root, '.vscode-test/sidebar-components-'));
  let driver: DesktopDriver | undefined;
  let failed = false;
  let failure: unknown;
  try {
    for (const [name, source] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      if (typeof source === 'string')
        await copyFile(resolve(root, 'tests/fixtures', source), target);
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
      'Components session and cleanup failed',
    );
  if (failed) throw failure;
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

/**
 * Escape a literal for a RegExp. String `hasText` filters are case-insensitive
 * substrings, which would match this spec's own `sidebar-components-*` temp
 * workspace folder name through the Explorer's pane header: pane lookups are
 * anchored, case-sensitive title matches instead.
 */
const literal = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pane = (page: Page, label: string): Locator =>
  page.locator('.pane').filter({
    has: page
      .locator('.pane-header')
      .filter({ hasText: new RegExp(`^${literal(label)}`) }),
  });

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

const bytes = (ctx: Ctx, name: string): Promise<string> =>
  readFile(ctx.path(name), 'utf8');

const dirtyTabs = (page: Page): Locator =>
  page.locator('.monaco-workbench .tab.dirty');

const editorTabs = (page: Page): Locator =>
  page.locator('.part.editor .tabs-container .tab');

async function openFile(ctx: Ctx, name: string): Promise<void> {
  await blur(ctx.page);
  await ctx.page.keyboard.press(`${MOD}+p`);
  await ctx.page.keyboard.insertText(ctx.path(name));
  await ctx.page
    .locator('.quick-input-widget:visible .monaco-list-row')
    .filter({ hasText: name })
    .first()
    .click();
  await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
}

/** Quick Open leaves a text editor: a canvas journey opens its own designer. */
async function openDesigner(ctx: Ctx): Promise<Frame> {
  await ctx.driver.command('RDLC Code: Open Designer');
  return ctx.driver.designerFrame();
}

/**
 * Reveal the RDLC container, wait until the target view is actually rendered,
 * then focus it. The reveal and the focus are separate host round trips: a
 * single "Focus on X View" that also has to create the view loses focus in this
 * host (invalid-source run), so visibility is the readiness gate, never mere
 * attachment. The focus assertion itself is unchanged.
 */
async function focusView(ctx: Ctx, view: string): Promise<void> {
  const header = pane(ctx.page, view).locator('.pane-header');
  if (!(await header.isVisible().catch(() => false)))
    await ctx.driver.command('View: Show RDLC Code');
  await expect(header).toBeVisible();
  await ctx.driver.command(`Focus on ${view} View`);
  await expect(header).toHaveCount(1);
  await expect(
    ctx.page.locator('.part.sidebar [role="tree"]:focus-within'),
  ).toHaveCount(1);
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

/** Native filter: accept (or cancel, discarding the edit) through the title action. */
async function runFilter(
  ctx: Ctx,
  query: string,
  cancel = false,
): Promise<void> {
  await (
    await titleAction(ctx.page, 'Components', 'RDLC Code: Filter Components')
  ).click();
  const input = ctx.page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await expect(input).toBeVisible();
  await input.fill(query);
  await input.press(cancel ? 'Escape' : 'Enter');
  await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
}

/** The query the input box pre-fills: retained filter, or the cancelled edit. */
async function filterValue(ctx: Ctx): Promise<string> {
  await (
    await titleAction(ctx.page, 'Components', 'RDLC Code: Filter Components')
  ).click();
  const input = ctx.page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await expect(input).toBeVisible();
  const value = await input.inputValue();
  await input.press('Escape');
  await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
  return value;
}

const insertRow = (page: Page, label: string): Locator =>
  page.getByRole('treeitem', { name: new RegExp(`^${label}, Insert`) });

/** The accessible name of an unavailable row carries its exact reason. */
const unavailableRow = (page: Page, label: string, why: string): Locator =>
  page.getByRole('treeitem', {
    name: new RegExp(`^${label}, Unavailable\\. ${literal(why)}`),
  });

const messages = (page: Page, view: string, text: string): Promise<void> =>
  expect(pane(page, view)).toContainText(text);

/**
 * Label of the row that owns keyboard focus in a native tree, however the host
 * exposes it: the focused row, aria-activedescendant, or the focused/selected
 * row marker.
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

/** Walk the focused native tree with Home/ArrowDown: real keyboard navigation. */
async function focusRow(
  page: Page,
  pattern: RegExp,
  steps = 60,
): Promise<string> {
  await page.keyboard.press('Home');
  for (let step = 0; step < steps; step++) {
    const label = await activeTreeRow(page);
    if (label && pattern.test(label)) return label;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`No focused tree row matched ${String(pattern)}`);
}

async function save(ctx: Ctx): Promise<void> {
  await blur(ctx.page);
  await ctx.page.keyboard.press(`${MOD}+s`);
}

/**
 * Every row the focused native list really visits, from End (which learns the
 * true last row and scrolls the list) to Home and down again. The native list
 * virtualizes rows, so the rendered DOM never holds all eleven kinds at once;
 * keyboard traversal is the only inventory that sees every row.
 */
async function walkRows(page: Page, steps = 60): Promise<string[]> {
  await page.keyboard.press('End');
  const last = await activeTreeRow(page);
  await page.keyboard.press('Home');
  const labels: string[] = [];
  for (let step = 0; step < steps; step++) {
    const label = await activeTreeRow(page);
    if (label === null) break;
    labels.push(label);
    if (label === last) break;
    await page.keyboard.press('ArrowDown');
  }
  return labels;
}

const COMPONENT_ROW = new RegExp(
  `^(${ALL_KINDS.join('|')}), (Insert|Unavailable)\\.`,
);

/** Component rows among the walked labels, in the order the list shows them. */
const componentRows = (
  labels: readonly string[],
): { kind: string; state: string }[] =>
  labels.flatMap((label) => {
    const match = COMPONENT_ROW.exec(label);
    return match ? [{ kind: match[1]!, state: match[2]! }] : [];
  });

/** Focus the Components view and return every row label it actually visits. */
async function walkComponents(ctx: Ctx): Promise<string[]> {
  await focusView(ctx, 'Components');
  return walkRows(ctx.page);
}

/** The eleven kinds, three insertable and eight refused, read row by row. */
async function expectFullInventory(ctx: Ctx): Promise<string[]> {
  const labels = await walkComponents(ctx);
  const rows = componentRows(labels);
  expect(rows, 'keyboard inventory of component rows').toHaveLength(11);
  expect(
    rows
      .filter((row) => row.state === 'Insert')
      .map((row) => row.kind)
      .sort(),
    'creatable kinds',
  ).toEqual(['Dataset', 'Table', 'Textbox']);
  expect(
    rows
      .filter((row) => row.state === 'Unavailable')
      .map((row) => row.kind)
      .sort(),
    'refused kinds',
  ).toEqual([...UNAVAILABLE_KINDS].sort());
  return labels;
}

/**
 * Reveal a native row without activating it: wheel the Components list first
 * (the native list only renders rows near the viewport, so the target row may
 * not exist yet), then bring it into view. Hovering and scrolling never fire
 * the row's activation command.
 */
async function revealRow(ctx: Ctx, row: Locator): Promise<void> {
  const list = pane(ctx.page, 'Components').locator('[role="tree"]');
  for (const delta of [160, -160]) {
    for (let step = 0; step < 40 && (await row.count()) === 0; step++) {
      await list.hover();
      await ctx.page.mouse.wheel(0, delta);
    }
  }
  if (await row.count())
    await row.scrollIntoViewIfNeeded().catch(() => {
      // A row that vanished again is reported by the caller's own click wait.
    });
}

/** Pointer activation: reveal the row, then click it — one real mouse insertion. */
async function pointerActivate(ctx: Ctx, row: Locator): Promise<void> {
  await revealRow(ctx, row);
  await row.click();
}

const undo = (frame: Frame): Promise<void> =>
  frame.getByRole('button', { name: 'Undo', exact: true }).click();

const redo = (frame: Frame): Promise<void> =>
  frame.getByRole('button', { name: 'Redo', exact: true }).click();

/** The one accessible acceptance announcement of a creation. */
const createdNotice = (frame: Frame, name: string): Locator =>
  frame.locator('.feedback').getByText(`Created ${name}.`, { exact: true });

/** Text of the live notification toasts; the container is part of the workbench. */
async function notifications(page: Page): Promise<string> {
  const toasts = page.locator('.notifications-toasts');
  if ((await toasts.count()) === 0) return '';
  return (await toasts.innerText().catch(() => '')).trim();
}

/** Designer webviews currently hosting `rdlc-editor`; detached frames are ignored. */
async function designerCount(page: Page): Promise<number> {
  let count = 0;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    count += await frame
      .locator('rdlc-editor')
      .count()
      .catch(() => 0);
  }
  return count;
}

/** Zero report text or history change: exact bytes on disk and no dirty tab. */
async function expectSource(
  ctx: Ctx,
  name: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(() => bytes(ctx, name), { message: `${name} bytes` })
    .toBe(expected);
  await expect(dirtyTabs(ctx.page), `${name}: no dirty tab`).toHaveCount(0);
}

/** The explicit compact designer fallback: the catalog cards inside the canvas. */
async function compactCatalog(frame: Frame): Promise<void> {
  const card = frame.locator('[data-card="Textbox"]');
  const tab = frame.getByRole('tab', { name: 'Components', exact: true });
  if (!(await card.isVisible()) && !(await tab.isVisible()))
    await frame
      .getByRole('button', { name: 'Components', exact: true })
      .click();
  if (await tab.isVisible()) await tab.click();
  await expect(card).toBeVisible();
}

/**
 * Real HTML5 drag: pointer down on the source, travel, optional Alt/Escape,
 * release at `at` relative to the target's own border box. The body carries an
 * outline, never a border, so its border box origin is the content origin the
 * drop converts back to.
 */
async function drag(
  ctx: Ctx,
  source: Locator,
  target: Locator,
  at: { x: number; y: number },
  options: { readonly alt?: boolean; readonly escape?: boolean } = {},
): Promise<{ x: number; y: number }> {
  const from = await source.boundingBox();
  const box = await target.boundingBox();
  if (!from || !box) throw new Error('Drag geometry is unavailable.');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await ctx.page.mouse.move(start.x, start.y);
  await ctx.page.mouse.down();
  await ctx.page.mouse.move(start.x + 12, start.y, { steps: 5 });
  if (options.alt) await ctx.page.keyboard.down('Alt');
  await ctx.page.mouse.move(box.x + at.x, box.y + at.y, { steps: 20 });
  if (options.escape) await ctx.page.keyboard.press('Escape');
  await ctx.page.mouse.up();
  if (options.alt) await ctx.page.keyboard.up('Alt');
  return box;
}

/** Raw drop point in pt from the measured body origin; client points are integers. */
const rawPoints = (
  box: { x: number; y: number },
  at: { x: number; y: number },
): { left: number; top: number } => ({
  left: ((Math.round(box.x + at.x) - box.x) * 72) / 96,
  top: ((Math.round(box.y + at.y) - box.y) * 72) / 96,
});

const ptValue = (source: string, tag: 'Left' | 'Top'): number => {
  const match = new RegExp(`<${tag}>([0-9.]+)pt</${tag}>`).exec(source);
  expect(match, `${tag} in pt`).not.toBeNull();
  return Number(match![1]);
};

// ---------------------------------------------------------------------------
// US4.2 — pointer activation inserts exactly one item
// ---------------------------------------------------------------------------

test('US4.2-insert-once', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    const created = withReportItem(original, textboxXml('Textbox1'));
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    const tabs = await editorTabs(ctx.page).count();
    await focusView(ctx, 'Components');

    // Real mouse activation: exactly one item, no naming or binding form.
    await insertRow(ctx.page, 'Textbox').click();
    await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
    await expect(editorTabs(ctx.page)).toHaveCount(tabs);
    const name = frame.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Textbox1');
    await expect(name).toBeFocused();
    await expect(
      frame.locator('.body > .item[data-kind="textbox"]'),
    ).toHaveCount(1);
    await expect(createdNotice(frame, 'Textbox1')).toHaveCount(1);

    // Post-acceptance selection agrees between canvas and native Structure.
    await expect(frame.locator('.item.primary')).toHaveCount(1);
    await focusView(ctx, 'Report Structure');
    await expect(
      ctx.page.getByRole('treeitem', { name: /^Textbox: Textbox1, Primary/ }),
    ).toBeVisible();

    // Exact source: one insertion, byte-exact outside it.
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);

    // One history entry: a single Undo removes it, one Redo restores it.
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
    await redo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

    // Keyboard activation inserts the identical source (Enter path, FR-017).
    await focusView(ctx, 'Components');
    await focusRow(ctx.page, /^Textbox, Insert/);
    await ctx.page.keyboard.press('Enter');
    await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);
    await undo(frame);
    await save(ctx);
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-us4-2-insert-once');
  });
});

// ---------------------------------------------------------------------------
// US4.2 — unbound table defaults
// ---------------------------------------------------------------------------

test('US4.2-table-defaults', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    const created = withReportItem(original, tableXml('Table1'));
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    const tabs = await editorTabs(ctx.page).count();
    await focusView(ctx, 'Components');

    await insertRow(ctx.page, 'Table').click();
    await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
    await expect(editorTabs(ctx.page)).toHaveCount(tabs);
    const name = frame.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Table1');
    await expect(name).toBeFocused();
    await expect(createdNotice(frame, 'Table1')).toHaveCount(1);
    await expect(frame.locator('.item.primary')).toHaveCount(1);
    await focusView(ctx, 'Report Structure');
    await expect(
      ctx.page.getByRole('treeitem', { name: /^Tablix: Table1, Primary/ }),
    ).toBeVisible();

    // Exact source: two columns, two rows, four cells, and no binding.
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);
    const saved = await bytes(ctx, 'report.rdlc');
    expect(saved).not.toContain('<DataSetName>');
    expect(saved.match(/<TablixColumn>/g)).toHaveLength(2);
    expect(saved.match(/<Width>1in<\/Width>/g)).toHaveLength(2);
    expect(saved.match(/<TablixRow>/g)).toHaveLength(2);
    expect(saved.match(/<Height>0.25in<\/Height>/g)).toHaveLength(2);
    expect(saved.match(/<TablixCell>/g)).toHaveLength(4);

    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
    await redo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-us4-2-table-defaults');
  });
});

// ---------------------------------------------------------------------------
// US4.3 — dataset activation: one definition, no geometry, data focus
// ---------------------------------------------------------------------------

test('US4.3-dataset-insert', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    const created = withDataSet(original, datasetXml('DataSet1'));
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    const tabs = await editorTabs(ctx.page).count();
    await focusView(ctx, 'Components');

    await pointerActivate(ctx, insertRow(ctx.page, 'Dataset'));
    await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
    await expect(editorTabs(ctx.page)).toHaveCount(tabs);
    await expect(createdNotice(frame, 'DataSet1')).toHaveCount(1);
    // No canvas rectangle and no geometry: the body keeps zero items, and the
    // byte-exact expectation below is the whole report change.
    await expect(frame.locator('.body > .item')).toHaveCount(0);

    // The data/inspector target owns the new definition and takes focus.
    const datasetName = frame.getByRole('textbox', { name: 'Dataset name' });
    await expect(datasetName).toHaveValue('DataSet1');
    await expect(datasetName).toBeFocused();

    // Selected in Report Data, without a canvas rectangle.
    await focusView(ctx, 'Report Data');
    await expect(
      ctx.page.getByRole('treeitem', { name: /^DataSet: DataSet1, Selected/ }),
    ).toBeVisible();

    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
    await redo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(created);
    await undo(frame);
    await save(ctx);
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-us4-3-dataset-insert');
  });
});

// ---------------------------------------------------------------------------
// US4.4 — filtering: case-insensitive, category context, cancel, clear, restore
// ---------------------------------------------------------------------------

test('US4.4-filtering', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    await openFile(ctx, 'report.rdlc');
    await focusView(ctx, 'Components');

    // Exactly eleven kinds: three with an activation command, eight truthful
    // reasons. Read row by row — the rendered DOM never holds all eleven.
    await expectFullInventory(ctx);

    // Case-insensitive and trimmed, with the matching category context kept.
    await runFilter(ctx, '  tAbL  ');
    const filtered = await walkComponents(ctx);
    expect(
      componentRows(filtered).map((row) => `${row.kind} ${row.state}`),
      'the single matching row',
    ).toEqual(['Table Insert']);
    expect(
      filtered.some((label) => /^Report items/.test(label)),
      'the matching category context is kept',
    ).toBe(true);
    expect(
      filtered.some((label) => /^(Containers|Data)(,|$)/.test(label)),
      'categories without a match are dropped',
    ).toBe(false);

    // Cancelling the filter keeps the previous query and discards the edit.
    await runFilter(ctx, 'matrix', true);
    await expect(insertRow(ctx.page, 'Table')).toBeVisible();
    await expect(
      unavailableRow(ctx.page, 'Matrix', REASON('Matrix')),
    ).toHaveCount(0);
    expect(await filterValue(ctx)).toBe('  tAbL  ');
    await expect(
      await titleAction(ctx.page, 'Components', 'RDLC Code: Clear Filter'),
    ).toBeVisible();

    // A filtered unavailable match stays identifiable with its exact reason.
    await runFilter(ctx, 'parameter');
    await expect(
      unavailableRow(ctx.page, 'Parameter', REASON('Parameter')),
    ).toBeVisible();

    // No results: an explicit row and a Clear Filter path back to all eleven.
    await runFilter(ctx, 'no matching component');
    await expect(
      ctx.page.getByRole('treeitem', {
        name: 'No components match. Use Clear Filter.',
      }),
    ).toBeVisible();
    await (
      await titleAction(ctx.page, 'Components', 'RDLC Code: Clear Filter')
    ).click();
    await expectFullInventory(ctx);

    // Filtering and clearing change no report text and no history.
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-us4-4-filtering');
  });
});

// ---------------------------------------------------------------------------
// US4.5 — all eight unavailable kinds: exact reason, zero mutation
// ---------------------------------------------------------------------------

test('US4.5-unavailable-kinds', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    const tabs = await editorTabs(ctx.page).count();
    await focusView(ctx, 'Components');

    for (const label of UNAVAILABLE_KINDS) {
      await runFilter(ctx, label.toLowerCase());
      const row = unavailableRow(ctx.page, label, REASON(label));
      await expect(row, `${label} reason`).toBeVisible();
      await pointerActivate(ctx, row);
      await ctx.page.keyboard.press('Enter');
      // Pointer and keyboard entry points both change nothing.
      await expectSource(ctx, 'report.rdlc', original);
      await expect(editorTabs(ctx.page)).toHaveCount(tabs);
      await expect(frame.locator('.body > .item')).toHaveCount(0);
      expect(await designerCount(ctx.page)).toBe(1);
    }

    // The capability split, read row by row: the native list never renders all
    // eleven kinds at once, so a count over the rendered snapshot is not the
    // inventory.
    await runFilter(ctx, '');
    await expectFullInventory(ctx);
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-us4-5-unavailable-kinds');
  });
});

// ---------------------------------------------------------------------------
// US4.5 — ineligible states and the direct command refuse with an exact reason
// ---------------------------------------------------------------------------

test('US4.5-refusals', async () => {
  await session(
    { 'invalid.rdlc': MALFORMED, 'source-only.rdlc': SOURCE_ONLY },
    async (ctx) => {
      const invalid = await bytes(ctx, 'invalid.rdlc');
      const sourceOnly = await bytes(ctx, 'source-only.rdlc');

      // Invalid source: the real state settles first (the view message is the
      // host's own report), then focus, then the actual row states — every
      // kind is unavailable here, the three creators included.
      await openFile(ctx, 'invalid.rdlc');
      await focusView(ctx, 'Components');
      await messages(
        ctx.page,
        'Components',
        'Invalid XML. Open Code XML to repair this report.',
      );
      const invalidRows = componentRows(await walkComponents(ctx));
      expect(invalidRows, 'invalid-source inventory').toHaveLength(11);
      expect(
        invalidRows.filter((row) => row.state === 'Insert'),
        'no kind stays creatable on invalid XML',
      ).toEqual([]);
      const invalidRow = unavailableRow(ctx.page, 'Textbox', NOT_EDITABLE);
      await revealRow(ctx, invalidRow);
      await expect(invalidRow).toBeVisible();
      await invalidRow.click();
      await ctx.page.keyboard.press('Enter');
      await expect(
        ctx.page.locator('.quick-input-widget:visible'),
      ).toBeHidden();
      await expectSource(ctx, 'invalid.rdlc', invalid);
      expect(await designerCount(ctx.page)).toBe(0);

      // Source-only report: inspection only, no visual insertion.
      await openFile(ctx, 'source-only.rdlc');
      await focusView(ctx, 'Components');
      await messages(
        ctx.page,
        'Components',
        'Source-only report. Inspection and Code XML are available.',
      );
      const sourceRow = unavailableRow(ctx.page, 'Textbox', NOT_EDITABLE);
      await revealRow(ctx, sourceRow);
      await expect(sourceRow).toBeVisible();
      await sourceRow.click();
      await ctx.page.keyboard.press('Enter');
      await expectSource(ctx, 'source-only.rdlc', sourceOnly);
      expect(await designerCount(ctx.page)).toBe(0);

      // A direct invocation without a captured row refuses with the readable reason.
      await ctx.driver.command('RDLC Code: Activate Report Item');
      await expect
        .poll(() => notifications(ctx.page), { timeout: 20_000 })
        .toContain(STALE);
      await expectSource(ctx, 'source-only.rdlc', sourceOnly);
      expect(await designerCount(ctx.page)).toBe(0);

      // No report: the state stays accessible and still refuses to insert.
      await ctx.driver.command('View: Close All Editors');
      await messages(
        ctx.page,
        'Components',
        'Open or create a report to begin.',
      );
      const noReportRow = unavailableRow(ctx.page, 'Textbox', NOT_EDITABLE);
      await revealRow(ctx, noReportRow);
      await expect(noReportRow).toBeVisible();
      await noReportRow.click();
      await expectSource(ctx, 'source-only.rdlc', sourceOnly);
      await expectSource(ctx, 'invalid.rdlc', invalid);
      expect(await designerCount(ctx.page)).toBe(0);
      await ctx.driver.capture('components-us4-5-refusals');
    },
  );
});

// ---------------------------------------------------------------------------
// US4.6 — activation stays complete; the fallback never forces a native view
// ---------------------------------------------------------------------------

test('US4.6-activation-fallback', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    const made = {
      Textbox: withReportItem(original, textboxXml('Textbox1')),
      Table: withReportItem(original, tableXml('Table1')),
      Dataset: withDataSet(original, datasetXml('DataSet1')),
    };
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    await focusView(ctx, 'Components');

    // All three kinds activate from the native toolbox, one Undo between them.
    const created = {
      Textbox: ['Textbox1', made.Textbox],
      Table: ['Table1', made.Table],
      Dataset: ['DataSet1', made.Dataset],
    } as const;
    for (const label of ['Textbox', 'Table', 'Dataset'] as const) {
      await pointerActivate(ctx, insertRow(ctx.page, label));
      await expect(createdNotice(frame, created[label][0])).toHaveCount(1);
      await save(ctx);
      await expect
        .poll(() => bytes(ctx, 'report.rdlc'))
        .toBe(created[label][1]);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
    }

    // The native row offers no drag path: a real pointer drag inserts nothing.
    await revealRow(ctx, insertRow(ctx.page, 'Textbox'));
    await drag(
      ctx,
      insertRow(ctx.page, 'Textbox'),
      frame.locator('.body'),
      DROP,
    );
    await expectSource(ctx, 'report.rdlc', original);
    expect(await designerCount(ctx.page)).toBe(1);

    // The compact fallback stays reachable with the native views hidden, and
    // using it never reopens them.
    await ctx.driver.command('View: Toggle Primary Side Bar Visibility');
    await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
    await compactCatalog(frame);
    await frame.locator('[data-card="Table"]').click();
    const name = frame.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Table1');
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(made.Table);
    await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
    await undo(frame);
    await save(ctx);
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-us4-6-activation-fallback');
  });
});

// ---------------------------------------------------------------------------
// FR-016 — lowest-free names, no creation form, unbound table, one native Undo
// ---------------------------------------------------------------------------

test('FR-016-create', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(
    { 'report.rdlc': { content: await collisions(root) } },
    async (ctx) => {
      const original = await bytes(ctx, 'report.rdlc');
      expect(original).toContain('Name="Textbox3"');
      expect(original).toContain('Name="DataSet1"');
      const textboxMade = withReportItem(original, textboxXml('Textbox2'));
      const tableMade = withReportItem(original, tableXml('Table1'));
      const datasetMade = withDataSet(original, datasetXml('DataSet2'));
      await openFile(ctx, 'report.rdlc');
      const frame = await openDesigner(ctx);
      const tabs = await editorTabs(ctx.page).count();
      await focusView(ctx, 'Components');

      // Lowest free number fills the gap (Textbox1 + Textbox3 → Textbox2).
      await pointerActivate(ctx, insertRow(ctx.page, 'Textbox'));
      await expect(
        ctx.page.locator('.quick-input-widget:visible'),
      ).toBeHidden();
      await expect(editorTabs(ctx.page)).toHaveCount(tabs);
      const name = frame.getByRole('textbox', { name: 'Name', exact: true });
      await expect(name).toHaveValue('Textbox2');
      await expect(name).toBeFocused();
      await expect(createdNotice(frame, 'Textbox2')).toHaveCount(1);
      await focusView(ctx, 'Report Structure');
      await expect(
        ctx.page.getByRole('treeitem', { name: /^Textbox: Textbox2, Primary/ }),
      ).toBeVisible();
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(textboxMade);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

      // No prompt: the table keeps the preserved names and stays unbound.
      await focusView(ctx, 'Components');
      await pointerActivate(ctx, insertRow(ctx.page, 'Table'));
      await expect(
        ctx.page.locator('.quick-input-widget:visible'),
      ).toBeHidden();
      await expect(editorTabs(ctx.page)).toHaveCount(tabs);
      await expect(name).toHaveValue('Table1');
      await expect(createdNotice(frame, 'Table1')).toHaveCount(1);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(tableMade);
      expect(await bytes(ctx, 'report.rdlc')).not.toContain('<DataSetName>');
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

      // Dataset numbers past the preserved DataSet1 without any data access.
      await focusView(ctx, 'Components');
      await pointerActivate(ctx, insertRow(ctx.page, 'Dataset'));
      await expect(
        ctx.page.locator('.quick-input-widget:visible'),
      ).toBeHidden();
      await expect(editorTabs(ctx.page)).toHaveCount(tabs);
      await expect(createdNotice(frame, 'DataSet2')).toHaveCount(1);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(datasetMade);
      await undo(frame);
      await save(ctx);
      await expectSource(ctx, 'report.rdlc', original);
      await ctx.driver.capture('components-fr-016-create');
    },
  );
});

// ---------------------------------------------------------------------------
// FR-017 — keyboard activation equals pointer activation and focuses its target
// ---------------------------------------------------------------------------

/**
 * The host may or may not activate a tree item on Space; probe the real key
 * instead of assuming it, then assert whichever branch the workbench takes.
 * The probe reads the buffer (a dirty tab), not the disk: creation never
 * touches the file until it is saved.
 * shortcut: a four-second bounded poll — a slower host is reported as "Space
 * does not activate" rather than as an insertion.
 */
async function spaceActivates(ctx: Ctx): Promise<boolean> {
  expect(await dirtyTabs(ctx.page).count(), 'the report starts clean').toBe(0);
  await ctx.page.keyboard.press('Space');
  try {
    await expect
      .poll(() => dirtyTabs(ctx.page).count(), { timeout: 4_000 })
      .toBeGreaterThan(0);
    return true;
  } catch {
    return false;
  }
}

test('FR-017-keyboard', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    const textboxMade = withReportItem(original, textboxXml('Textbox1'));
    const datasetMade = withDataSet(original, datasetXml('DataSet1'));
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    await focusView(ctx, 'Components');

    // Enter on the focused row inserts exactly what the pointer path inserts.
    await focusRow(ctx.page, /^Textbox, Insert/);
    await ctx.page.keyboard.press('Enter');
    await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();
    const name = frame.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Textbox1');
    await expect(name).toBeFocused();
    await expect(createdNotice(frame, 'Textbox1')).toHaveCount(1);
    await expect(frame.locator('.feedback #report-refusal')).toHaveCount(0);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(textboxMade);
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

    // Space: whatever the host supports, the outcome is exact either way.
    await focusView(ctx, 'Components');
    await focusRow(ctx.page, /^Textbox, Insert/);
    if (await spaceActivates(ctx)) {
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(textboxMade);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
    } else {
      await expectSource(ctx, 'report.rdlc', original);
      expect(await designerCount(ctx.page)).toBe(1);
    }

    // Keyboard dataset creation focuses the data/inspector target, once.
    await focusView(ctx, 'Components');
    await focusRow(ctx.page, /^Dataset, Insert/);
    await ctx.page.keyboard.press('Enter');
    await expect(createdNotice(frame, 'DataSet1')).toHaveCount(1);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(datasetMade);
    await expect(frame.locator('.feedback #report-refusal')).toHaveCount(0);
    const datasetName = frame.getByRole('textbox', { name: 'Dataset name' });
    await expect(datasetName).toHaveValue('DataSet1');
    await expect(datasetName).toBeFocused();
    await undo(frame);
    await save(ctx);
    await expectSource(ctx, 'report.rdlc', original);
    await ctx.driver.capture('components-fr-017-keyboard');
  });
});

// ---------------------------------------------------------------------------
// FR-018 — instructions replace the drag affordance; 004 HTML drag still runs
// ---------------------------------------------------------------------------

test('FR-018-fallback', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    await openFile(ctx, 'report.rdlc');
    const frame = await openDesigner(ctx);
    const tabs = await editorTabs(ctx.page).count();
    await focusView(ctx, 'Components');

    // The limitation is stated instead of a drag affordance.
    await messages(ctx.page, 'Components', DRAG_NOTE);
    await (
      await titleAction(ctx.page, 'Components', 'RDLC Code: Filter Components')
    ).click();
    await expect(ctx.page.locator('.quick-input-widget:visible')).toContainText(
      FILTER_PROMPT,
    );
    await ctx.page.keyboard.press('Escape');
    await expect(ctx.page.locator('.quick-input-widget:visible')).toBeHidden();

    // Dragging the native row itself inserts nothing: no substitute controller.
    await revealRow(ctx, insertRow(ctx.page, 'Textbox'));
    await drag(
      ctx,
      insertRow(ctx.page, 'Textbox'),
      frame.locator('.body'),
      DROP,
    );
    await expectSource(ctx, 'report.rdlc', original);
    expect(await designerCount(ctx.page)).toBe(1);

    // Existing 004 HTML drag, through the compact fallback with native views hidden.
    await ctx.driver.command('View: Toggle Primary Side Bar Visibility');
    await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
    await compactCatalog(frame);
    const transform = await frame
      .locator('.page')
      .evaluate((element) => getComputedStyle(element).transform);
    const scroll = await frame
      .locator('.viewport')
      .evaluate((element) => [element.scrollLeft, element.scrollTop]);

    // Snapped drop: the grid owns the position, the default size is untouched.
    await drag(
      ctx,
      frame.locator('[data-card="Textbox"]'),
      frame.locator('.body'),
      DROP,
    );
    const snapped = withReportItem(
      original,
      textboxXml('Textbox1', '260pt', '30pt'),
    );
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(snapped);
    await expect(editorTabs(ctx.page)).toHaveCount(tabs);
    const name = frame.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Textbox1');
    await expect(frame.locator('.item.primary')).toHaveCount(1);
    await expect(frame.locator('.page')).toHaveCSS('transform', transform);
    expect(
      await frame
        .locator('.viewport')
        .evaluate((element) => [element.scrollLeft, element.scrollTop]),
    ).toEqual(scroll);
    // Focus did not escape into the (hidden) native surface.
    expect(
      await ctx.page.evaluate(
        () => document.activeElement?.closest('.part.sidebar') ?? null,
      ),
    ).toBeNull();
    await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

    // Alt bypasses snapping: the same point lands on its raw coordinate.
    const box = await drag(
      ctx,
      frame.locator('[data-card="Textbox"]'),
      frame.locator('.body'),
      DROP,
      { alt: true },
    );
    // The drop's edit is asynchronous: wait for it before saving and reading.
    await expect(
      ctx.page.locator('.monaco-workbench .tab.dirty'),
    ).not.toHaveCount(0);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).not.toBe(original);
    const alt = await bytes(ctx, 'report.rdlc');
    const raw = rawPoints(box, DROP);
    expect(
      Math.abs(ptValue(alt, 'Left') - raw.left),
      'Alt drop keeps the raw point (≤1 device pixel)',
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(ptValue(alt, 'Top') - raw.top),
      'Alt drop keeps the raw point (≤1 device pixel)',
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(ptValue(alt, 'Left') - 260)).toBeGreaterThan(1);
    await undo(frame);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

    // Cancelled drops (release outside the body, Escape mid-drag) create nothing.
    await drag(
      ctx,
      frame.locator('[data-card="Textbox"]'),
      frame.locator('.page'),
      { x: 10, y: 10 },
    );
    await expectSource(ctx, 'report.rdlc', original);
    await drag(
      ctx,
      frame.locator('[data-card="Textbox"]'),
      frame.locator('.body'),
      DROP,
      { escape: true },
    );
    await expectSource(ctx, 'report.rdlc', original);
    await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
    await ctx.driver.capture('components-fr-018-fallback');
  });
});

// ---------------------------------------------------------------------------
// SC-004 — three real creations, each one Undo/Redo step, then save and reopen
// ---------------------------------------------------------------------------

test('SC-004-insert-history', async () => {
  await session({ 'report.rdlc': BLANK }, async (ctx) => {
    const original = await bytes(ctx, 'report.rdlc');
    const textboxMade = withReportItem(original, textboxXml('Textbox1'));
    const tableMade = withReportItem(original, tableXml('Table1'));
    const datasetMade = withDataSet(original, datasetXml('DataSet1'));
    await openFile(ctx, 'report.rdlc');
    let frame = await openDesigner(ctx);
    await focusView(ctx, 'Components');

    // Each insertion is exactly one accepted edit and one Undo/Redo step.
    for (const [label, expected, notice] of [
      ['Textbox', textboxMade, 'Textbox1'],
      ['Table', tableMade, 'Table1'],
      ['Dataset', datasetMade, 'DataSet1'],
    ] as const) {
      await pointerActivate(ctx, insertRow(ctx.page, label));
      await expect(createdNotice(frame, notice)).toHaveCount(1);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(expected);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
      await redo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(expected);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);
      await focusView(ctx, 'Components');
    }

    // Leave one accepted creation in place: save, close, reopen.
    await pointerActivate(ctx, insertRow(ctx.page, 'Dataset'));
    await expect(createdNotice(frame, 'DataSet1')).toHaveCount(1);
    await save(ctx);
    await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(datasetMade);
    await ctx.driver.command('View: Close All Editors');
    await expect(editorTabs(ctx.page)).toHaveCount(0);
    await openFile(ctx, 'report.rdlc');
    expect(await bytes(ctx, 'report.rdlc')).toBe(datasetMade);
    frame = await openDesigner(ctx);
    await focusView(ctx, 'Report Data');
    await expect(
      ctx.page.getByRole('treeitem', { name: /^DataSet: DataSet1/ }),
    ).toBeVisible();

    // A refused insertion still changes zero report text and zero history.
    await focusView(ctx, 'Components');
    await runFilter(ctx, 'image');
    const row = unavailableRow(ctx.page, 'Image', REASON('Image'));
    await expect(row).toBeVisible();
    await row.click();
    await ctx.page.keyboard.press('Enter');
    await expectSource(ctx, 'report.rdlc', datasetMade);
    await ctx.driver.command('RDLC Code: Activate Report Item');
    await expect
      .poll(() => notifications(ctx.page), { timeout: 20_000 })
      .toContain(STALE);
    await expectSource(ctx, 'report.rdlc', datasetMade);
    await ctx.driver.capture('components-sc-004-insert-history');
  });
});

// ---------------------------------------------------------------------------
// REG-04 (creation subset) — default position, in-designer drop, rename, selection
// ---------------------------------------------------------------------------

test('REG-04-creation', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(
    { 'report.rdlc': { content: await collisions(root) } },
    async (ctx) => {
      const original = await bytes(ctx, 'report.rdlc');
      await openFile(ctx, 'report.rdlc');
      const frame = await openDesigner(ctx);
      const tabs = await editorTabs(ctx.page).count();
      // The in-designer fallback journey: native views hidden, never reopened.
      await ctx.driver.command('View: Toggle Primary Side Bar Visibility');
      await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
      await compactCatalog(frame);

      // Default position/dimensions with the lowest free name, then selection.
      await frame.locator('[data-card="Textbox"]').click();
      const name = frame.getByRole('textbox', { name: 'Name', exact: true });
      await expect(name).toHaveValue('Textbox2');
      await expect(editorTabs(ctx.page)).toHaveCount(tabs);
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      const clicked = withReportItem(original, textboxXml('Textbox2'));
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(clicked);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

      // The same catalog drop path (004 HTML drag) keeps the snapped position.
      await drag(
        ctx,
        frame.locator('[data-card="Textbox"]'),
        frame.locator('.body'),
        DROP,
      );
      const dropped = withReportItem(
        original,
        textboxXml('Textbox2', '260pt', '30pt'),
      );
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(dropped);
      await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

      // Post-result rename through the existing Name property, one more step.
      await frame.locator('[data-card="Textbox"]').click();
      await expect(name).toHaveValue('Textbox2');
      await name.fill('Renamed');
      await name.press('Enter');
      const renamed = clicked.replace('Name="Textbox2"', 'Name="Renamed"');
      expect(renamed).not.toBe(clicked);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(renamed);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(clicked);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(original);

      // Unbound static table through the same fallback, then bound afterwards
      // in the existing inspector: one DataSetName and one detail member.
      await frame.locator('[data-card="Table"]').click();
      await expect(name).toHaveValue('Table1');
      const tableMade = withReportItem(original, tableXml('Table1'));
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(tableMade);
      expect(await bytes(ctx, 'report.rdlc')).not.toContain('<DataSetName>');
      await frame
        .getByRole('combobox', { name: 'Dataset' })
        .selectOption('DataSet1');
      await frame.getByRole('button', { name: 'Bind dataset' }).click();
      const bound = withReportItem(
        original,
        tableXmlBound('Table1', 'DataSet1'),
      );
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(bound);
      await undo(frame);
      await save(ctx);
      await expect.poll(() => bytes(ctx, 'report.rdlc')).toBe(tableMade);
      await undo(frame);
      await save(ctx);
      await expectSource(ctx, 'report.rdlc', original);
      await expect(ctx.page.locator('.part.sidebar')).toBeHidden();
      await ctx.driver.capture('components-reg-04-creation');
    },
  );
});
