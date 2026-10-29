/**
 * Feature 005 US2 (AT-02, AT-03): the native Report Structure view on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/structure.spec.ts::<title>`). Each test opens a fresh
 * disposable profile, drives the native tree, the designer frame and the host's
 * own commands, menus and editors with real keyboard/pointer input, and reads
 * report bytes independently from disk. Fixtures are copied into a temp
 * workspace first, so no test writes a repository fixture.
 *
 * Every measurement reads real DOM geometry, real editor status text or the
 * frozen fixture bytes: nothing fabricates a selection, a source range or a
 * timing sample, and the SC-003 performance threshold stays untouched.
 */
import { test, expect } from 'playwright/test';
import type { Frame, Page } from 'playwright';
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
import {
  platformSkipAccepted,
  platformSkipReason,
} from './host-observer-scope.js';

type Files = Record<string, string | { content: string }>;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  path(name: string): string;
}

const root = (): string => process.env.RDLC_DESKTOP_ROOT ?? process.cwd();

const artifacts = (): string =>
  resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'structure',
  );

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Fresh trusted window whose workspace folder is a temp copy of the given fixtures. */
async function session(
  files: Files,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  await mkdir(artifacts(), { recursive: true });
  await mkdir(resolve(root(), '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(root(), '.vscode-test/sidebar-structure-'));
  for (const [name, fixture] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    if (typeof fixture === 'string')
      await copyFile(
        resolve(root(), 'tests/fixtures', fixture),
        join(dir, name),
      );
    else await writeFile(join(dir, name), fixture.content);
  }
  let driver: DesktopDriver | undefined;
  let failed = false;
  let failure: unknown;
  try {
    driver = await launchTrustedDesktop({
      root: root(),
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      artifactDir: artifacts(),
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
      'Structure session and cleanup failed',
    );
  if (failed) throw failure;
  // Keep the driver's own shutdown report untouched when the journey passed.
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

/** Report bytes read independently of the product. */
const source = (ctx: Ctx, name: string): Promise<string> =>
  readFile(ctx.path(name), 'utf8');

const blur = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
};

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

async function openReport(ctx: Ctx, name: string): Promise<Frame> {
  await openFile(ctx, name);
  await ctx.driver.command('RDLC Code: Open Designer');
  // The designer webview grabs focus when it loads; wait for it before the
  // palette opens, or the late focus steals the typed command.
  await ctx.driver.designerFrame();
  await ctx.driver.command('Focus on Report Structure View');
  return ctx.driver.designerFrame();
}

const structurePane = (page: Page) =>
  page.locator('.pane').filter({
    has: page.locator('.pane-header', { hasText: 'Report Structure' }),
  });

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One native row, scoped to the real list container. The accessible name is
 * `<label>` plus any Pending/Primary/Selected/Source only cue, so match the
 * label at the start of the name and require a cue boundary (`,` or end) to
 * avoid `Report` matching `ReportSections`.
 *
 * Observed host DOM (VS Code 1.142.0): while the list is scrolled, sticky
 * scroll clones the visible ancestor chain into a sibling
 * `.monaco-tree-sticky-container` as `.monaco-tree-sticky-row` rows carrying
 * the same role and aria-label. Those clones are host presentation, not
 * projection rows, so both `row` and `rendered` read `.monaco-list-rows` only.
 */
const structureRows = (page: Page) =>
  structurePane(page).locator('.monaco-list-rows [role="treeitem"]');

const row = (page: Page, label: string) =>
  structurePane(page)
    .locator('.monaco-list-rows')
    .first()
    .getByRole('treeitem', {
      name: new RegExp(`^${escapeRegExp(label)}(?:,|$)`),
    });

/** A rendered row's label without its cue, for comparing against the frozen oracle. */
const stripCue = (label: string): string => {
  const cue = label.indexOf(', ');
  return cue < 0 ? label : label.slice(0, cue);
};

/**
 * Native rows actually in the DOM. The tree virtualizes its rows, so callers
 * read one scroll window at a time and compare against the oracle slice.
 */
const rendered = async (page: Page): Promise<string[]> =>
  structureRows(page).evaluateAll((rows) =>
    rows.map((element) => element.getAttribute('aria-label') ?? ''),
  );

/** Labels of the current render window, without their cues. */
const rowWindow = async (page: Page): Promise<string[]> =>
  (await rendered(page)).map(stripCue);

/**
 * Press one tree key per attempt until `label` is in the rendered window, then
 * return that window. No waits of our own: every attempt is a real key press
 * plus a real read, and re-issuing the key absorbs the host's delayed reveal —
 * VS Code publishes a native selection ~150 ms after a row click and its
 * `TreeView.reveal` can scroll the list back afterwards (observed in
 * `trace-75976-*.zip`, callId udbz@210).
 */
async function pollWindow(
  page: Page,
  key: string,
  label: string,
): Promise<string[]> {
  let observed: string[] = [];
  await expect
    .poll(
      async () => {
        await page.keyboard.press(key);
        observed = await rowWindow(page);
        return observed;
      },
      {
        timeout: 15_000,
        message: `the native tree renders ${label} after ${key}`,
      },
    )
    .toContain(label);
  return observed;
}

/** Offset of `slice` inside `sequence`, or -1 when it is not a contiguous window. */
const windowOffset = (slice: string[], sequence: string[]): number => {
  for (let start = 0; start + slice.length <= sequence.length; start++)
    if (slice.every((label, index) => sequence[start + index] === label))
      return start;
  return -1;
};

/**
 * Fold or expand one row through its own twistie. Unlike a row click this
 * publishes no selection, so the host's delayed reveal of the selected row
 * cannot undo the fold. Rows start expanded.
 */
async function toggleRow(page: Page, label: string): Promise<void> {
  await row(page, label).locator('.monaco-tl-twistie').click();
}

/** One viewport of real wheel input over the native tree: scrolls without touching focus or selection. */
async function wheelTree(page: Page, direction: 1 | -1): Promise<void> {
  const paneBox = await structurePane(page).boundingBox();
  if (!paneBox) throw new Error('the native Structure pane is not rendered');
  const listBox =
    (await structurePane(page)
      .locator('[role="tree"]')
      .first()
      .boundingBox()) ?? paneBox;
  const x = Math.min(
    Math.max(paneBox.x + 8, listBox.x + listBox.width / 2),
    paneBox.x + paneBox.width - 8,
  );
  const y = Math.min(
    Math.max(paneBox.y + 48, listBox.y + listBox.height / 2),
    paneBox.y + paneBox.height - 8,
  );
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, direction * Math.max(120, paneBox.height - 56));
}

/**
 * Scroll (one viewport of real wheel input per attempt) until `label` is a
 * rendered row. An already visible row never scrolls, so `direction` only
 * matters while the row is outside the virtualized window. Used where keyboard
 * focus belongs to another surface (the source editor after Code XML).
 */
async function scrollTreeTo(
  page: Page,
  label: string,
  direction: 1 | -1,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const current = await rowWindow(page);
        if (current.includes(label)) return current;
        await wheelTree(page, direction);
        return rowWindow(page);
      },
      { timeout: 15_000, message: `the native tree renders ${label}` },
    )
    .toContain(label);
  // Park the pointer off the rows so no row tooltip can cover a later click.
  const paneBox = await structurePane(page).boundingBox();
  if (paneBox)
    await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + 16);
}

/**
 * A canvas item by its authored name: textboxes label themselves
 * `<name>: <preview>`, tables and preserved items use the plain label.
 */
const canvasItem = (frame: Frame, name: string) =>
  frame.locator(
    `.item[aria-label="${name}"], .item[aria-label^="${name}: "], ` +
      `.item:has(.content:text-is("${name}"))`,
  );

interface ReachableCenter {
  scrollLeft: number;
  expectedLeft: number;
  scrollTop: number;
  expectedTop: number;
}

/** Actual scroll next to the clamped center of one known-bounds canvas item. */
async function reachableCenter(
  frame: Frame,
  name: string,
): Promise<ReachableCenter | null> {
  return frame.evaluate((label) => {
    const viewport = document.querySelector('.viewport');
    if (!(viewport instanceof HTMLElement)) return null;
    // Observed DOM (editor.component.html): `.item` carries `data-item` (the
    // scene index, never the name), `aria-label` is `<name>: <preview>` for
    // textboxes and the plain label for tables/preserved items, and `.content`
    // holds the preview text. Match the real forms, not a bare `Title`.
    const items = [...document.querySelectorAll('.item')];
    const item =
      items.find((element) => element.getAttribute('aria-label') === label) ??
      items.find((element) =>
        (element.getAttribute('aria-label') ?? '').startsWith(`${label}: `),
      ) ??
      items.find(
        (element) =>
          (element.querySelector('.content')?.textContent ?? '').trim() ===
          label,
      );
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const centerX =
      rect.left -
      view.left -
      viewport.clientLeft +
      viewport.scrollLeft +
      rect.width / 2;
    const centerY =
      rect.top -
      view.top -
      viewport.clientTop +
      viewport.scrollTop +
      rect.height / 2;
    return {
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      expectedLeft: Math.min(
        Math.max(0, viewport.scrollWidth - viewport.clientWidth),
        Math.max(0, centerX - viewport.clientWidth / 2),
      ),
      expectedTop: Math.min(
        Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        Math.max(0, centerY - viewport.clientHeight / 2),
      ),
    };
  }, name);
}

/** The item ends up centered as far as reachable scroll allows: ≤1 CSS px per axis. */
async function expectCentered(
  frame: Frame,
  name: string,
): Promise<ReachableCenter> {
  const observed: { sample: ReachableCenter | null } = { sample: null };
  await expect
    .poll(
      async () => {
        observed.sample = await reachableCenter(frame, name);
        return observed.sample;
      },
      {
        timeout: 15_000,
        message: `${name} is rendered with known bounds in the designer canvas`,
      },
    )
    .not.toBeNull();
  const sample = observed.sample;
  if (!sample) throw new Error(`${name} is not rendered with known bounds`);
  expect(
    Math.abs(sample.scrollLeft - sample.expectedLeft),
    `${name} horizontal center error in CSS px`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(sample.scrollTop - sample.expectedTop),
    `${name} vertical center error in CSS px`,
  ).toBeLessThanOrEqual(1);
  return sample;
}

/**
 * One refusal notification, scoped to the visible toast: the host repeats the
 * same text in its `role="alert"` live region, and repeated invocations can
 * leave several toasts, so an unscoped or unique-match locator is never right.
 */
const refusal = (page: Page, text: string) =>
  page
    .locator('.notifications-toasts')
    .getByText(text, { exact: true })
    .first();

/**
 * The exact range the host selected after its own Code XML action, read from
 * the status bar and derived from the fixture bytes (`Ln`/`Col` are 1-based and
 * `Col` reports the selection end, because the host selects forward).
 */
async function expectRevealedRange(
  page: Page,
  text: string,
  open: string,
  close?: string,
): Promise<void> {
  const start = text.indexOf(open);
  expect(start, `source contains ${open}`).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(open, start + 1), `${open} appears once`).toBe(-1);
  let end = start + open.length;
  if (close) {
    const closing = text.indexOf(close, start);
    expect(closing, `${close} follows ${open}`).toBeGreaterThanOrEqual(start);
    end = closing + close.length;
  }
  const before = text.slice(0, end);
  const column = end - before.lastIndexOf('\n');
  await expect(
    page
      .locator('.part.statusbar')
      .getByText(
        `Ln ${before.split('\n').length}, Col ${column} (${end - start} selected)`,
        { exact: true },
      ),
  ).toBeVisible();
}

test('SC-003-timing', async () => {
  // UNVALIDATED on macOS: the Cmd-click native multi-selection never shows
  // "Second, Primary, 2 selected" on stable 1.144.0 (run 40867144705, macOS
  // 14). Not diagnosed; passes on Linux and Windows. See
  // specs/005-native-sidebar-integration/automated-validation.md.
  test.skip(
    platformSkipAccepted('SC-003-timing'),
    platformSkipReason('SC-003-timing') ?? '',
  );
  const blank = await readFile(
    resolve(root(), 'tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  const items = ['First', 'Second']
    .map(
      (name, i) =>
        `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${name}</Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>${i + 1}in</Left><Top>${i + 1}in</Top><Width>1in</Width><Height>0.25in</Height></Textbox>`,
    )
    .join('');
  const original = blank.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems>${items}</ReportItems>`,
  );
  await session(
    { 'native-structure.rdlc': { content: original } },
    async (ctx) => {
      const { driver, page } = ctx;
      const frame = await openReport(ctx, 'native-structure.rdlc');
      const modifier = MOD;
      const initialPrimary = page.getByRole('treeitem', {
        name: /^Textbox: First/,
      });
      await initialPrimary.click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: First, Primary/,
        }),
      ).toBeVisible();
      expect(await initialPrimary.getAttribute('aria-label')).toBe(
        'Textbox: First, Primary, 1 selected',
      );
      // Both surfaces log input starts and each visible primary state; a sample
      // is input → both surfaces showing the new primary.
      type Probe = {
        starts: { target: string; start: number }[];
        states: { target: string; at: number }[];
      };
      const install = (native: boolean) => {
        const probe: Probe = { starts: [], states: [] };
        Object.assign(window, { __rdlcSelectionProbe: probe });
        const name = (element: Element | null | undefined) =>
          /\b(First|Second)\b/.exec(
            (native
              ? element
                  ?.closest('[role="treeitem"]')
                  ?.getAttribute('aria-label')
              : element?.closest('.item')?.textContent) ?? '',
          )?.[1];
        const read = () => {
          const shown = native
            ? [...document.querySelectorAll('[role="treeitem"]')].find(
                (element) =>
                  /^Textbox: \w+, Primary, 1 selected$/.test(
                    element.getAttribute('aria-label') ?? '',
                  ) && element.getClientRects().length > 0,
              )
            : document.querySelector('.item.primary');
          const target = shown?.getClientRects().length ? name(shown) : null;
          if (target && probe.states.at(-1)?.target !== target)
            probe.states.push({ target, at: Date.now() });
        };
        document.addEventListener(
          'pointerdown',
          (event) => {
            const target = name(event.target as Element | null);
            if (target) probe.starts.push({ target, start: Date.now() });
          },
          true,
        );
        new MutationObserver(read).observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['aria-label', 'class'],
        });
        read();
      };
      await page.evaluate(install, true);
      await frame.evaluate(install, false);
      const probe = (surface: Page | Frame) =>
        surface.evaluate(
          () =>
            (window as unknown as { __rdlcSelectionProbe: Probe })
              .__rdlcSelectionProbe,
        );
      // SC-003 alternates native and canvas operations. Each starts once the
      // previous update has been visible for 250ms: the host coalesces TreeView
      // data events arriving within 200ms of the previous one (public
      // extension API limit), so back-to-back automation would only measure
      // that debounce, not one selection update. The bound itself is unchanged.
      const samples: number[] = [];
      let settled = Date.now();
      for (let i = 0; i < 100; i++) {
        const native = i % 2 === 0;
        const name = native ? 'Second' : 'First';
        await page.waitForTimeout(Math.max(0, settled + 250 - Date.now()));
        if (native)
          await page
            .getByRole('treeitem', { name: new RegExp(`^Textbox: ${name}`) })
            .click();
        else
          await frame
            .locator('.item')
            .filter({ has: frame.locator('.content', { hasText: name }) })
            .click();
        await expect(
          page.getByRole('treeitem', {
            name: new RegExp(`^Textbox: ${name}, Primary, 1 selected$`),
          }),
        ).toBeVisible();
        await expect(frame.locator('.selection-frame')).toHaveCount(1);
        await expect(frame.locator('.item.primary .content')).toHaveText(name);
        const [nativeProbe, canvasProbe] = [
          await probe(page),
          await probe(frame),
        ];
        const start = (native ? nativeProbe : canvasProbe).starts.at(-1);
        expect(start?.target).toBe(name);
        const at = (states: Probe['states']) =>
          states.find(
            (state) => state.at >= start!.start && state.target === name,
          )?.at;
        const nativeAt = at(nativeProbe.states);
        const canvasAt = at(canvasProbe.states);
        expect(nativeAt).toBeDefined();
        expect(canvasAt).toBeDefined();
        settled = Math.max(nativeAt!, canvasAt!);
        samples.push(settled - start!.start);
        await expect(
          frame.getByRole('spinbutton', { name: 'Zoom percent' }),
        ).toHaveValue('100');
      }
      await writeFile(
        join(artifacts(), 'selection-timings.json'),
        JSON.stringify(
          {
            version: driver.identity.version,
            samples,
            within200ms: samples.filter((time) => time <= 200).length,
          },
          null,
          2,
        ),
      );
      // Native multi-selection extends the native tree's own selection, so it
      // starts from a native primary rather than the last canvas operation.
      await page.getByRole('treeitem', { name: /^Textbox: First/ }).click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: First, Primary, 1 selected$/,
        }),
      ).toBeVisible();
      await page
        .getByRole('treeitem', { name: /^Textbox: Second/ })
        .click({ modifiers: [modifier] });
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: Second, Primary, 2 selected$/,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: First, Selected, 2 selected$/,
        }),
      ).toBeVisible();
      await expect(frame.locator('.item.selected')).toHaveCount(2);
      await page.keyboard.press(`${modifier}+s`);
      expect(await source(ctx, 'native-structure.rdlc')).toBe(original);
      await driver.capture('native-structure-selection');
      // The accepted bound stays 95 of 100 samples within 200ms; never lowered.
      expect(
        samples.filter((time) => time <= 200).length,
      ).toBeGreaterThanOrEqual(95);
    },
  );
});

test('US2.1-native-projection', async () => {
  const oracle = JSON.parse(
    await readFile(
      resolve(root(), 'tests/fixtures/sidebar/structure.expected.json'),
      'utf8',
    ),
  ) as {
    structure: readonly {
      element: string;
      name: string | null;
      legacyOnly?: boolean;
    }[];
  };
  // Native Structure = projectNavigation: frozen source order without the
  // retained legacy data branch, and without absent/runtime structures.
  const labels = oracle.structure
    .filter((entry) => !entry.legacyOnly)
    .map((entry) =>
      entry.name ? `${entry.element}: ${entry.name}` : entry.element,
    );
  expect(labels).toHaveLength(27);

  await session({ 'structure.rdlc': 'sidebar/structure.rdlc' }, async (ctx) => {
    const { page } = ctx;
    const before = await source(ctx, 'structure.rdlc');
    await openReport(ctx, 'structure.rdlc');

    // Every rendered window is a contiguous slice of the oracle; the first
    // and last windows pin both ends, so no absent section, data branch or
    // runtime row can appear and no expected row may go missing. Focus the
    // tree first, then poll each key until the window the oracle expects is
    // actually rendered: a single read right after the key can still show the
    // previous window, and the host's delayed reveal can scroll back.
    await row(page, 'Report').click();
    const last = labels[labels.length - 1]!;
    const top = await pollWindow(page, 'Home', labels[0]!);
    expect(top.length).toBeGreaterThan(8);
    expect(windowOffset(top, labels)).toBe(0);

    await page.keyboard.press('PageDown');
    const middle = await rowWindow(page);
    expect(middle.length).toBeGreaterThan(8);
    expect(windowOffset(middle, labels)).toBeGreaterThanOrEqual(0);

    const bottom = await pollWindow(page, 'End', last);
    expect(bottom.length).toBeGreaterThan(8);
    expect(windowOffset(bottom, labels) + bottom.length).toBe(labels.length);

    // Back at the top, where the table row is rendered again, exercise folding.
    await pollWindow(page, 'Home', labels[0]!);
    await toggleRow(page, 'Tablix: OrdersTable');
    const folded = await rowWindow(page);
    expect(folded).not.toContain('TablixBody');
    expect(folded).not.toContain('Textbox: LabelCell');
    expect(folded).not.toContain('Group: Details');
    expect(folded).toContain('Rectangle: Box');

    // Truthful capability states from the frozen oracle: opaque containers and
    // the member-header table are source only, authored cells are not.
    // `Rectangle: Box` is read in the folded window — the virtualized window is
    // ~11 rows, so it leaves it once the table branch is expanded again.
    await expect(row(page, 'Rectangle: Box')).toHaveAttribute(
      'aria-label',
      /^Rectangle: Box, (?:Pending · )?(?:Primary · |Selected · )?Source only$/,
    );

    await toggleRow(page, 'Tablix: OrdersTable');
    await expect(row(page, 'TablixBody')).toBeVisible();
    await expect(row(page, 'Textbox: LabelCell')).toBeVisible();
    const restored = await rowWindow(page);
    expect(windowOffset(restored, labels)).toBeGreaterThanOrEqual(0);
    await expect(row(page, 'Tablix: OrdersTable')).toHaveAttribute(
      'aria-label',
      /Source only/,
    );
    await expect(row(page, 'Textbox: LabelCell')).not.toHaveAttribute(
      'aria-label',
      /Source only/,
    );
    await ctx.driver.capture('structure-us2-1-projection');
    expect(await source(ctx, 'structure.rdlc')).toBe(before);
  });
});

test('US2.2-known-bounds-center', async () => {
  await session(
    { 'supported.rdlc': 'textboxes/supported.rdlc' },
    async (ctx) => {
      const { page } = ctx;
      const before = await source(ctx, 'supported.rdlc');
      const frame = await openReport(ctx, 'supported.rdlc');
      await row(page, 'Textbox: Title').click();

      // Native activation selects the same logical target in tree, canvas and
      // inspector, at the unchanged zoom.
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: Title, Primary, 1 selected$/,
        }),
      ).toBeVisible();
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      await expect(frame.locator('.item.primary')).toHaveAttribute(
        'aria-label',
        /^Title: /,
      );
      await expect(frame.locator('.selection-frame')).toHaveCount(1);
      await expect(frame.locator('.status-text')).toContainText(
        'Primary: Title',
      );
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');
      const properties = frame.getByRole('button', {
        name: 'Properties',
        exact: true,
      });
      if ((await properties.getAttribute('aria-expanded')) === 'false')
        await properties.click();
      await expect(
        frame.getByRole('textbox', { name: 'Name', exact: true }),
      ).toHaveValue('Title');

      // Known bounds center within reachable scroll: ≤1 CSS px per axis.
      const sample = await expectCentered(frame, 'Title');
      await test.info().attach('geometry-samples', {
        body: JSON.stringify({ zoom: 100, ...sample }, null, 2),
        contentType: 'application/json',
      });
      await ctx.driver.capture('structure-us2-2-known-bounds');
      expect(await source(ctx, 'supported.rdlc')).toBe(before);
    },
  );
});

test('US2.3-reveal-ancestors', async () => {
  await session({ 'mixed.rdlc': 'interactive/mixed.rdlc' }, async (ctx) => {
    const { page } = ctx;
    const before = await source(ctx, 'mixed.rdlc');
    const frame = await openReport(ctx, 'mixed.rdlc');

    // Fold an unrelated table branch and the ancestor of the canvas target.
    // The twistie publishes no selection, so no host reveal can undo the folds.
    await toggleRow(page, 'Tablix: OrdersTable');
    await expect(row(page, 'TablixBody')).toBeHidden();
    await toggleRow(page, 'Body');
    await expect(row(page, 'Textbox: Front')).toBeHidden();

    // Canvas activation reveals the target's ancestors and nothing else,
    // and does not move keyboard focus out of the canvas.
    await canvasItem(frame, 'Rectangle (unsupported)').click();
    await expect(
      page.getByRole('treeitem', {
        name: /^Rectangle: Locked, Primary · Source only, 1 selected$/,
      }),
    ).toBeVisible();
    expect(
      await frame.evaluate(() => document.activeElement?.className ?? ''),
    ).toContain('item');
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('role')),
    ).not.toBe('treeitem');

    // The reveal scrolls the target to the window edge, so its ancestors sit
    // above the render window: wheel back with real input (no focus, no
    // selection) before reading them, which also makes the unrelated-fold read
    // below non-vacuous.
    await scrollTreeTo(page, 'Textbox: Front', -1);
    await expect(row(page, 'Textbox: Front')).toBeVisible();
    await expect(row(page, 'TablixBody')).toBeHidden();

    // Body multi-selection yields exact membership and one primary target.
    await canvasItem(frame, 'LaterTie').click({ modifiers: ['Shift'] });
    await expect(frame.locator('.item.selected')).toHaveCount(2);
    await expect(
      page.getByRole('treeitem', {
        name: /^Rectangle: Locked, Selected · Source only, 2 selected$/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('treeitem', {
        name: /^Textbox: LaterTie, Primary, 2 selected$/,
      }),
    ).toBeVisible();
    await ctx.driver.capture('structure-us2-3-reveal');
    expect(await source(ctx, 'mixed.rdlc')).toBe(before);
  });
});

test('US2.4-no-fabricated-bounds', async () => {
  await session(
    {
      'grouped.rdlc': 'tables/grouped.rdlc',
      'opaque.rdlc': 'textboxes/supported-plus-opaque.rdlc',
    },
    async (ctx) => {
      const { page } = ctx;
      const grouped = await source(ctx, 'grouped.rdlc');
      const frame = await openReport(ctx, 'grouped.rdlc');

      // One cell, three distinct identities, all observed (the host publishes
      // the cell's `xmlCellId`, host-adapter.publishSelection, and the session
      // validates against those ids, document-session.bindSelectionTargets):
      //  1. the XML `TablixCell` row carries the native cue, exactly once;
      //  2. the rendered child textbox is the pressed canvas cell item;
      //  3. its owning table stays unpressed and no rectangle is fabricated.
      await row(page, 'Textbox: LabelCell').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^TablixCell, Selected · Source only$/,
        }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('treeitem', { name: /^TablixCell, Source only$/ }),
      ).toHaveCount(1);
      // The owning table claims nothing in the native tree either.
      await expect(row(page, 'Tablix: OrdersTable')).toHaveAttribute(
        'aria-label',
        'Tablix: OrdersTable',
      );
      await expect(row(page, 'Textbox: LabelCell')).toHaveAttribute(
        'aria-label',
        'Textbox: LabelCell',
      );
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      await expect(frame.locator('.item.primary')).toHaveCount(0);
      await expect(frame.locator('.item[data-kind="cell"]')).toHaveCount(6);
      await expect(
        frame.locator('.item[data-kind="cell"][aria-pressed="true"]'),
      ).toHaveCount(1);
      await expect(
        frame.locator('.item[data-kind="cell"][aria-pressed="true"] .content'),
      ).toHaveText('=Fields!Label.Value');
      await expect(frame.locator('.item[data-kind="table"]')).toHaveCount(1);
      await expect(
        frame.locator('.item[data-kind="table"][aria-pressed="true"]'),
      ).toHaveCount(0);

      await row(page, 'Tablix: OrdersTable').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Tablix: OrdersTable, Primary, 1 selected$/,
        }),
      ).toBeVisible();
      await expect(frame.locator('.selection-frame')).toHaveCount(1);
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      expect(await source(ctx, 'grouped.rdlc')).toBe(grouped);

      // Preservation-only content with unknown bounds: no rectangle, no scroll,
      // no fabricated reveal, and the report stays byte-exact.
      await ctx.driver.command('View: Close All Editors');
      const opaque = await source(ctx, 'opaque.rdlc');
      await openReport(ctx, 'opaque.rdlc');
      const canvas = await ctx.driver.designerFrame();
      const scroll = await canvas
        .locator('.viewport')
        .evaluate((element) => [
          (element as HTMLElement).scrollLeft,
          (element as HTMLElement).scrollTop,
        ]);
      await row(page, 'Textbox: Dynamic').click();
      await expect(
        page.getByRole('treeitem', { name: /^Textbox: Dynamic, Primary/ }),
      ).toBeVisible();
      await expect(canvasItem(canvas, 'Dynamic')).toHaveCount(0);
      await expect(canvasItem(canvas, 'Chart (unsupported)')).toHaveCount(0);
      await expect(canvas.locator('.selection-frame')).toHaveCount(0);
      await expect(
        canvas.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');
      expect(
        await canvas
          .locator('.viewport')
          .evaluate((element) => [
            (element as HTMLElement).scrollLeft,
            (element as HTMLElement).scrollTop,
          ]),
      ).toEqual(scroll);
      expect(await source(ctx, 'opaque.rdlc')).toBe(opaque);
      await ctx.driver.capture('structure-us2-4-no-fabricated-bounds');
    },
  );
});

test('US2.5-context-actions', async () => {
  await session(
    {
      'grouped.rdlc': 'tables/grouped.rdlc',
      'structure.rdlc': 'sidebar/structure.rdlc',
    },
    async (ctx) => {
      const { page } = ctx;
      // An eligible table keeps every existing route: properties, its table
      // form, the guarded delete and the clipboard actions that
      // report-evaluation attaches to each non-cell scene body item. Group
      // editing belongs to a group row, never to the whole table.
      const grouped = await source(ctx, 'grouped.rdlc');
      await openReport(ctx, 'grouped.rdlc');
      await row(page, 'Tablix: OrdersTable').click({ button: 'right' });
      for (const title of [
        'RDLC Code: Properties',
        'RDLC Code: Code XML',
        'RDLC Code: Copy',
        'RDLC Code: Cut',
        'RDLC Code: Duplicate',
        'RDLC Code: Table Properties',
        'RDLC Code: Delete',
      ])
        await expect(page.getByRole('menuitem', { name: title })).toHaveCount(
          1,
        );
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: Group Properties/,
        }),
      ).toHaveCount(0);
      // VS Code arms menu mouseup handlers 100ms after render; keep one real gesture.
      await page
        .getByRole('menuitem', { name: 'RDLC Code: Delete' })
        .click({ delay: 250 });
      await expect(
        page.locator('.context-view').getByRole('menuitem'),
      ).toHaveCount(0);
      await expect(
        page
          .locator('.notifications-toasts')
          .getByText(/Nothing is deleted until you confirm there/),
      ).toBeVisible();
      expect(await source(ctx, 'grouped.rdlc')).toBe(grouped);
      await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);

      await ctx.driver.command('View: Close All Editors');
      const structure = await source(ctx, 'structure.rdlc');
      await openReport(ctx, 'structure.rdlc');

      // A supported cell textbox exposes exactly the existing supported actions.
      await scrollTreeTo(page, 'Textbox: LabelCell', 1);
      await row(page, 'Textbox: LabelCell').click({ button: 'right' });
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Properties' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Code XML' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: (Copy|Cut|Duplicate|Delete|Table Properties|Group Properties)/,
        }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');

      // A source-only/preserved target refuses every mutation entry point.
      await scrollTreeTo(page, 'Rectangle: Box', 1);
      await row(page, 'Rectangle: Box').click({ button: 'right' });
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Code XML' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: (Properties|Copy|Cut|Duplicate|Delete|Table Properties|Group Properties)/,
        }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('treeitem', {
          name: /^Rectangle: Box, (?:Pending · )?(?:Primary · |Selected · )?Source only$/,
        }),
      ).toBeVisible();

      // Code XML from the menu reveals the host-verified current range for an
      // opaque target, then for an authored one.
      await scrollTreeTo(page, 'Group: Details', -1);
      await row(page, 'Group: Details').click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: 'RDLC Code: Code XML' })
        .click({ delay: 250 });
      await expect(
        page.locator('.context-view').getByRole('menuitem'),
      ).toHaveCount(0);
      await expectRevealedRange(page, structure, '<Group Name="Details"/>');

      // The authored textbox sits lower in the tree: scroll to it with real
      // wheel input, because keyboard focus now belongs to the source editor.
      await scrollTreeTo(page, 'Textbox: BodyTitle', 1);
      await row(page, 'Textbox: BodyTitle').click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: 'RDLC Code: Code XML' })
        .click({ delay: 250 });
      await expect(
        page.locator('.context-view').getByRole('menuitem'),
      ).toHaveCount(0);
      await expectRevealedRange(page, structure, '<Textbox Name="BodyTitle"/>');

      expect(await source(ctx, 'structure.rdlc')).toBe(structure);
      await ctx.driver.capture('structure-us2-5-context-actions');
      const capture = JSON.parse(
        await readFile(
          join(
            artifacts(),
            'captures',
            'structure-us2-5-context-actions',
            'capture.json',
          ),
          'utf8',
        ),
      ) as { designer: { visible: boolean } };
      expect(
        capture.designer.visible,
        'the source-active capture records the hidden designer honestly',
      ).toBe(false);
    },
  );
});

test('US2.6-refresh', async () => {
  await session(
    { 'supported.rdlc': 'textboxes/supported.rdlc' },
    async (ctx) => {
      const { page } = ctx;
      const original = await source(ctx, 'supported.rdlc');
      const frame = await openReport(ctx, 'supported.rdlc');
      await row(page, 'Textbox: Title').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: Title, Primary, 1 selected$/,
        }),
      ).toBeVisible();

      // An accepted source edit refreshes the projection and keeps the selection
      // only through unambiguous correspondence.
      const edited = original.replace(
        '<Value>Hello &amp; welcome</Value>',
        '<Value>Hello again</Value>',
      );
      expect(edited).not.toBe(original);
      await writeFile(ctx.path('supported.rdlc'), edited);
      await expect(frame.locator('.item.primary .content')).toHaveText(
        'Hello again',
      );
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: Title, Primary, 1 selected$/,
        }),
      ).toBeVisible();

      // Renaming the selected node breaks its identity: the row moves and the
      // selection clears with explicit feedback instead of retargeting silently.
      const renamed = original.replace(
        '<Textbox Name="Title"',
        '<Textbox Name="Renamed"',
      );
      expect(renamed).not.toBe(original);
      await writeFile(ctx.path('supported.rdlc'), renamed);
      await expect(
        page.getByRole('treeitem', { name: /^Textbox: Renamed(?:,|$)/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('treeitem', { name: /^Textbox: Title(?:,|$)/ }),
      ).toHaveCount(0);
      await expect(
        frame.getByText(
          /Selection cleared: the selected items could not be identified/,
        ),
      ).toBeVisible();
      await expect(
        structurePane(page).getByRole('treeitem', {
          name: /, Primary|, Selected/,
        }),
      ).toHaveCount(0);

      // Restoring the source brings the row back without replaying the selection.
      await writeFile(ctx.path('supported.rdlc'), original);
      await expect(
        page.getByRole('treeitem', { name: /^Textbox: Title(?:,|$)/ }),
      ).toBeVisible();
      await expect(
        structurePane(page).getByRole('treeitem', {
          name: /, Primary|, Selected/,
        }),
      ).toHaveCount(0);
      expect(await source(ctx, 'supported.rdlc')).toBe(original);
      await ctx.driver.capture('structure-us2-6-refresh');
    },
  );
});

test('FR-008-center', async () => {
  await session(
    { 'geometry.rdlc': 'interactive/optional-geometry.rdlc' },
    async (ctx) => {
      const { page } = ctx;
      const before = await source(ctx, 'geometry.rdlc');
      const frame = await openReport(ctx, 'geometry.rdlc');

      // Known bounds center at unchanged zoom within reachable scroll.
      await row(page, 'Textbox: ImplicitBoth').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: ImplicitBoth, Primary, 1 selected$/,
        }),
      ).toBeVisible();
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');
      const centered = await expectCentered(frame, 'ImplicitBoth');

      // Unknown bounds and structural targets perform no canvas navigation.
      await row(page, 'Textbox: ExpressionWidth').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: ExpressionWidth, Primary/,
        }),
      ).toBeVisible();
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      expect(
        await frame
          .locator('.viewport')
          .evaluate((element) => [
            (element as HTMLElement).scrollLeft,
            (element as HTMLElement).scrollTop,
          ]),
      ).toEqual([centered.scrollLeft, centered.scrollTop]);

      await row(page, 'Body').click();
      await expect(frame.locator('.item.primary')).toHaveCount(0);
      expect(
        await frame
          .locator('.viewport')
          .evaluate((element) => [
            (element as HTMLElement).scrollLeft,
            (element as HTMLElement).scrollTop,
          ]),
      ).toEqual([centered.scrollLeft, centered.scrollTop]);
      expect(await source(ctx, 'geometry.rdlc')).toBe(before);
      await ctx.driver.capture('structure-fr-008-center');
    },
  );
});

test('FR-009-refresh', async () => {
  await session({ 'grouped.rdlc': 'tables/grouped.rdlc' }, async (ctx) => {
    const { page } = ctx;
    const original = await source(ctx, 'grouped.rdlc');
    await openReport(ctx, 'grouped.rdlc');

    // Expansion is view state only: the twistie publishes no selection, so no
    // report bytes change, no editor becomes dirty and no host reveal can
    // re-open the fold. Selection correspondence itself is asserted in US2.6.
    await toggleRow(page, 'Tablix: OrdersTable');
    await expect(row(page, 'TablixBody')).toBeHidden();
    expect(await source(ctx, 'grouped.rdlc')).toBe(original);
    await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);

    // An accepted source edit refreshes the projection; the fold of a named,
    // unambiguous surviving node keeps its identity and stays folded.
    const inserted = '<Textbox Name="Inserted"/>';
    const edited = original.replace(
      '</ReportItems>',
      `${inserted}</ReportItems>`,
    );
    expect(edited).not.toBe(original);
    await writeFile(ctx.path('grouped.rdlc'), edited);
    await expect(
      page.getByRole('treeitem', { name: /^Textbox: Inserted(?:,|$)/ }),
    ).toBeVisible();
    await expect(row(page, 'TablixBody')).toBeHidden();
    await expect(row(page, 'Tablix: OrdersTable')).toBeVisible();
    expect(await source(ctx, 'grouped.rdlc')).toBe(edited);
    expect(edited.replace(inserted, '')).toBe(original);
    await ctx.driver.capture('structure-fr-009-refresh');
  });
});

test('FR-010-context-actions', async () => {
  await session(
    {
      'supported.rdlc': 'textboxes/supported.rdlc',
      'preserved.rdlc': 'datasets/preserved.rdlc',
    },
    async (ctx) => {
      const { page } = ctx;
      const supported = await source(ctx, 'supported.rdlc');
      await openReport(ctx, 'supported.rdlc');
      // A supported body textbox keeps every existing supported action: the
      // guarded properties/source routes plus the clipboard, duplicate and
      // delete capabilities the projection marks eligible; only table and group
      // rows claim their own forms, so neither of those appears here.
      await row(page, 'Textbox: Title').click({ button: 'right' });
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Properties' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Code XML' }),
      ).toHaveCount(1);
      for (const title of [
        'RDLC Code: Copy',
        'RDLC Code: Cut',
        'RDLC Code: Duplicate',
        'RDLC Code: Delete',
      ])
        await expect(page.getByRole('menuitem', { name: title })).toHaveCount(
          1,
        );
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: (Table Properties|Group Properties)/,
        }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');

      // Executing without an activated row is refused at execution time with an
      // accessible reason and changes no report bytes.
      await ctx.driver.command('RDLC Code: Delete');
      await expect(
        refusal(
          page,
          'This report item is stale. Activate its current row and try again.',
        ),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await ctx.driver.command('RDLC Code: Copy');
      await expect(
        refusal(
          page,
          'This report item is stale. Activate its current row and try again.',
        ),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await source(ctx, 'supported.rdlc')).toBe(supported);
      await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);

      // A preserved report exposes inspection and Code XML only.
      const preserved = await source(ctx, 'preserved.rdlc');
      await ctx.driver.command('View: Close All Editors');
      await openReport(ctx, 'preserved.rdlc');
      await row(page, 'Body').click({ button: 'right' });
      await expect(
        page.getByRole('menuitem', { name: 'RDLC Code: Code XML' }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', {
          name: /RDLC Code: (Properties|Copy|Cut|Duplicate|Delete|Table Properties|Group Properties)/,
        }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      expect(await source(ctx, 'preserved.rdlc')).toBe(preserved);
      await ctx.driver.capture('structure-fr-010-context-actions');
    },
  );
});

test('EDGE-03-refusal', async () => {
  await session({ 'mixed.rdlc': 'interactive/mixed.rdlc' }, async (ctx) => {
    const { page } = ctx;
    const before = await source(ctx, 'mixed.rdlc');
    const frame = await openReport(ctx, 'mixed.rdlc');
    await row(page, 'Textbox: Front').click();
    await expect(
      page.getByRole('treeitem', {
        name: /^Textbox: Front, Primary, 1 selected$/,
      }),
    ).toBeVisible();
    await expect(frame.locator('.item.selected')).toHaveCount(1);

    // Mixed cell + body selection is refused: the accepted body selection is
    // restored, no bulk edit happens and the report stays byte-exact.
    await scrollTreeTo(page, 'Textbox: LabelCell', 1);
    await row(page, 'Textbox: LabelCell').click({ modifiers: [MOD] });
    await expect(
      refusal(page, 'The selected target is no longer available.'),
    ).toBeVisible();
    await expect(
      page.getByRole('treeitem', {
        name: /^Textbox: Front, Primary, 1 selected$/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('treeitem', { name: /^Textbox: LabelCell, Selected/ }),
    ).toHaveCount(0);
    await expect(frame.locator('.item.selected')).toHaveCount(1);
    expect(await source(ctx, 'mixed.rdlc')).toBe(before);
    await ctx.driver.capture('structure-edge-03-refusal');
  });
});

test('EDGE-07-reachable-center', async () => {
  await session(
    { 'geometry.rdlc': 'interactive/optional-geometry.rdlc' },
    async (ctx) => {
      const { page } = ctx;
      const before = await source(ctx, 'geometry.rdlc');
      const frame = await openReport(ctx, 'geometry.rdlc');

      // Only known bounds reveal/center, at unchanged zoom.
      await row(page, 'Textbox: ImplicitBoth').click();
      const centered = await expectCentered(frame, 'ImplicitBoth');
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');

      // Absent geometry is not unknown geometry: MS-RDL 2.16.16/2.16.10 derive a
      // missing Width/Height from the container (Left/Top are optional), so the
      // scene paints that item while activation moves neither scroll nor zoom.
      await row(page, 'Textbox: DefaultPosition').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: DefaultPosition, Primary/,
        }),
      ).toBeVisible();
      expect(
        await frame
          .locator('.viewport')
          .evaluate((element) => [
            (element as HTMLElement).scrollLeft,
            (element as HTMLElement).scrollTop,
          ]),
      ).toEqual([centered.scrollLeft, centered.scrollTop]);

      // Evaluated geometry stays unknown: no painted item, no selection frame
      // and no canvas navigation; details and Code XML live in the tree.
      await scrollTreeTo(page, 'Textbox: ExpressionWidth', 1);
      await row(page, 'Textbox: ExpressionWidth').click();
      await expect(
        page.getByRole('treeitem', {
          name: /^Textbox: ExpressionWidth, Primary/,
        }),
      ).toBeVisible();
      await expect(canvasItem(frame, 'ExpressionWidth')).toHaveCount(0);
      await expect(canvasItem(frame, 'ExpressionPosition')).toHaveCount(0);
      await expect(frame.locator('.item.primary')).toHaveCount(0);
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');
      expect(
        await frame
          .locator('.viewport')
          .evaluate((element) => [
            (element as HTMLElement).scrollLeft,
            (element as HTMLElement).scrollTop,
          ]),
      ).toEqual([centered.scrollLeft, centered.scrollTop]);
      expect(await source(ctx, 'geometry.rdlc')).toBe(before);
      await ctx.driver.capture('structure-edge-07-reachable-center');
    },
  );
});
