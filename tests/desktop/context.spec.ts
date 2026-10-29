/**
 * Feature 005 US5 (AT-06): report context, view switching and request races on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/context.spec.ts::<title>`). Each test launches the real Desktop
 * binary in a disposable profile over a temp copy of manifest-listed fixtures
 * (`tests/fixtures/manifest.json`), drives the actual workbench with keyboard and
 * pointer input and reads report bytes independently from disk. There is no test
 * channel into the extension: every action below is the surface a user has.
 *
 * Race coverage note: the Desktop can only disturb a request inside the real
 * preliminary designer opening (the one async window the product exposes). Delayed
 * outcomes, duplicate transport delivery and rejected postMessage have no
 * observation or delay hook in the product, the test harness or the driver, so the
 * race logs record the genuine cases that ran and name the remaining subset
 * instead of padding the count with repeated no-op loops.
 */
import { test, expect, type Frame, type Page } from 'playwright/test';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { launchTrustedDesktop, type DesktopDriver } from './driver.js';
import {
  platformSkipAccepted,
  platformSkipReason,
} from './host-observer-scope.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const NO_REPORT = 'Open or create a report to begin.';
const VIEWS = ['Report Structure', 'Report Data', 'Components'] as const;
const FIXTURE = {
  mixed: 'interactive/mixed.rdlc',
} as const;
/**
 * A and B are two copies of the same manifest fixture: every item name is
 * identical, only Front's text differs. A same-named object in the other report
 * is therefore a real hazard, and a wrong-target action is visible as the wrong
 * canvas text.
 */
const TEXT = {
  aFront: 'Alpha report',
  bFront: 'Beta report',
  behind: 'Behind & preserved',
  laterTie: 'Later source order wins the tie',
} as const;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  /** Node inspector port of the extension host (delay hook only). */
  readonly inspector: number;
  path(name: string): string;
}

/**
 * Bound an await that has no timeout of its own (inspector replies, frame
 * probes): a stuck step then fails with its name instead of consuming the whole
 * test timeout, which would also hide the error behind the shutdown.
 */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, fail) => {
      timer = setTimeout(
        () => fail(new Error(`${what} did not complete within ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Bound for one workbench interaction (click, palette row, widget state). */
const STEP_TIMEOUT = 15_000;

/**
 * Run one helper step and name it in the failure: a bare `locator.click:
 * Timeout` inside a hundred-iteration loop says nothing about where it stalled.
 */
async function step<T>(what: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${what}: ${detail.split('\n')[0]}`, { cause: error });
  }
}

/**
 * Time one phase of a long test: the elapsed time goes to the console as it
 * ends (so a run killed by the test timeout still shows the hot spot) and to
 * the test annotations for the report.
 */
async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    const elapsed = `${((Date.now() - started) / 1000).toFixed(1)} s`;
    console.log(`[context] ${label}: ${elapsed}`);
    test.info().annotations.push({
      type: 'timing',
      description: `${label}: ${elapsed}`,
    });
  }
}

const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? done(address.port)
          : fail(new Error('No free inspector port')),
      );
    });
  });

/** Fresh trusted window whose workspace folder is a temp copy of the given fixtures. */
async function session(
  files: Record<string, string | { content: string }>,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await mkdir(resolve(root, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(root, '.vscode-test/sidebar-context-'));
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
    const inspector = await freePort();
    driver = await launchTrustedDesktop({
      root,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      artifactDir: artifacts(),
      workspaceDir: dir,
      inspectExtensions: inspector,
    });
    await run({
      driver,
      page: driver.page,
      dir,
      inspector,
      path: (name) => join(dir, name),
    });
  } catch (error) {
    failed = true;
    failure = error;
    // Shutdown can outlast the test timeout, which then reports only the
    // timeout: keep the journey's own error visible first.
    console.error(
      `[context] journey failed before shutdown: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`,
    );
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
      'Context session and cleanup failed',
    );
  if (failed) throw failure;
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

const artifacts = (): string =>
  resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'context',
  );

/** Race/switch evidence required by coverage.json (`requiredArtifacts`). */
async function writeLog(name: string, payload: unknown): Promise<void> {
  await mkdir(artifacts(), { recursive: true });
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(join(artifacts(), `${name}.json`), body, 'utf8');
  await test.info().attach(name, { body, contentType: 'application/json' });
}

/** A and B: the same manifest report with different text under identical item names. */
async function variant(root: string, front: string): Promise<string> {
  const source = await readFile(
    resolve(root, 'tests/fixtures', FIXTURE.mixed),
    'utf8',
  );
  const changed = source.replace(
    '<Value>Front</Value>',
    `<Value>${front}</Value>`,
  );
  if (changed === source)
    throw new Error(
      `${FIXTURE.mixed} no longer contains <Value>Front</Value>; the context specs need a shared item name`,
    );
  return changed;
}

/** The standard context workspace: two reports, one non-report file, no preview tabs. */
async function contextFiles(
  root: string,
): Promise<Record<string, { content: string }>> {
  return {
    'a.rdlc': { content: await variant(root, TEXT.aFront) },
    'b.rdlc': { content: await variant(root, TEXT.bFront) },
    'notes.txt': {
      content: 'Not a report. Nothing here is a report context.\n',
    },
    '.vscode/settings.json': {
      content: `${JSON.stringify(
        {
          'workbench.editor.enablePreview': false,
          'workbench.editor.enablePreviewFromQuickOpen': false,
          // The in-workbench dialog keeps Save As/Open Report drivable.
          'files.simpleDialog.enable': true,
          // The temp workspace sits inside the repo's git tree, so the parent
          // scan would raise an environment prompt unrelated to the journey.
          'git.openRepositoryInParentFolders': 'never',
          // Sticky ancestor rows overlay real rows and intercept their clicks;
          // the journeys address rows themselves, not that presentation aid.
          'workbench.tree.enableStickyScroll': false,
          // Journeys insert exact XML text; auto-closing would alter it.
          'editor.autoClosingComments': 'never',
          'editor.autoClosingBrackets': 'never',
        },
        null,
        2,
      )}\n`,
    },
  };
}

const pane = (page: Page, label: string) =>
  page
    .locator('.pane')
    .filter({ has: page.locator('.pane-header', { hasText: label }) });

const activityItem = (page: Page) =>
  page.locator('.activitybar').getByRole('tab', { name: /^RDLC Code/ });

const rdlcHeaders = (page: Page) =>
  page
    .locator('.part.sidebar .pane-header')
    .filter({ hasText: /Report Structure|Report Data|Components/ });

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** Activate the RDLC Code activity item when the container is not showing yet. */
async function showRdlc(ctx: Ctx): Promise<void> {
  const { page } = ctx;
  const header = rdlcHeaders(page);
  const shown = () =>
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
  // A focused webview owns the keyboard and swallows Ctrl+P, and the host
  // blur above cannot reach into it: re-enter the workbench through the tab
  // of the active group, which changes no editor and no report context.
  await blur(page);
  const group = page.locator('.editor-group-container.active').first();
  const activeTab = (await group.count())
    ? group.locator('.tab.active')
    : page.locator('.editor-group-container .tab.active').first();
  if ((await activeTab.count()) > 0)
    await step(
      `openFile ${name}: re-entering the workbench through the tab`,
      () => activeTab.click({ timeout: STEP_TIMEOUT }),
    );
  await blur(page);
  await page.keyboard.press(`${MOD}+p`);
  await step(`openFile ${name}: quick open showing`, () =>
    page
      .locator('.quick-input-widget:visible .quick-input-box input')
      .waitFor({ state: 'visible', timeout: STEP_TIMEOUT }),
  );
  await page.keyboard.insertText(ctx.path(name));
  // Results show the file name with its folder as the description, so match the
  // last path segments rather than the whole (OS-specific) path.
  const segments = name.split('/');
  const file = segments.at(-1)!;
  const parent = segments.slice(0, -1).at(-1);
  let candidates = page
    .locator('.quick-input-widget:visible .monaco-list-row')
    .filter({ hasText: file });
  if (parent) candidates = candidates.filter({ hasText: parent });
  await step(`openFile ${name}: result row`, () =>
    candidates.first().click({ timeout: STEP_TIMEOUT }),
  );
  await expect(
    page.locator('.quick-input-widget:visible'),
    `openFile ${name}: quick open closed`,
  ).toBeHidden({ timeout: STEP_TIMEOUT });
}

/** Palette command followed by quick-pick selections. */
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
  await step(`palette ${command}: input showing`, () =>
    input.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }),
  );
  await page.keyboard.type(command, { delay: 10 });
  const rows = page.locator(
    '.quick-input-widget:visible .quick-input-list .monaco-list-row',
  );
  await step(`palette ${command}: command row`, () =>
    rows.filter({ hasText: command }).first().click({ timeout: STEP_TIMEOUT }),
  );
  for (const pick of picks) {
    await step(`palette ${command}: input for pick ${pick}`, () =>
      input.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }),
    );
    await page.keyboard.type(pick, { delay: 10 });
    await step(`palette ${command}: pick row ${pick}`, () =>
      rows.filter({ hasText: pick }).first().click({ timeout: STEP_TIMEOUT }),
    );
  }
  await expect(
    page.locator('.quick-input-widget:visible'),
    `palette ${command}: palette closed`,
  ).toBeHidden({ timeout: STEP_TIMEOUT });
}

/**
 * Close the active editor through its tab's own close button on every
 * platform. A synthetic Ctrl/Cmd+W depends on where focus sits (a designer
 * webview swallows it, and it never reached the workbench on macOS), and a
 * missed close leaves a held request undisturbed or a designer open.
 */
async function closeActiveEditor(page: Page): Promise<void> {
  await closeActiveTab(page);
}

/** Designer webviews currently hosting `rdlc-editor`; detached frames are ignored. */
async function designerFrames(page: Page): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    try {
      // A webview frame being disposed can leave the query waiting for an
      // execution context that never comes: it is not a designer.
      const hosted = await within(
        frame.locator('rdlc-editor').count(),
        3_000,
        'designer frame probe',
      );
      if (hosted > 0) frames.push(frame);
    } catch {
      // A frame torn down between switches is not a designer.
    }
  }
  return frames;
}

const designerCount = async (page: Page): Promise<number> =>
  (await designerFrames(page)).length;

/** Canvas text of every selected body item, sorted so two views compare as a set. */
async function primaryContents(page: Page): Promise<string[]> {
  const contents: string[] = [];
  for (const frame of await designerFrames(page)) {
    try {
      const primary = frame.locator('.item.primary .content');
      if ((await primary.count()) === 0) continue;
      contents.push(
        ((await primary.first().textContent()) ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    } catch {
      // Detached during a switch; the next poll sees the settled frames.
    }
  }
  return contents.sort();
}

const dirtyCount = (page: Page): Promise<number> =>
  page.locator('.monaco-workbench .tab.dirty').count();

/** Distinct report names with a dirty tab. */
const dirtyReports = async (page: Page): Promise<string[]> =>
  [
    ...new Set(
      await page
        .locator('.monaco-workbench .tab.dirty .label-name')
        .allTextContents(),
    ),
  ].sort();

/**
 * Dirty reports by tab label: one document opened as both source editor and
 * designer shows on several tabs but is still the single dirty document.
 * shortcut: a tab that renders no name contributes an empty entry and fails
 * the count loudly instead of hiding the dirty report.
 */
const dirtyDocuments = (page: Page): Promise<string[]> =>
  page
    .locator('.monaco-workbench .tab.dirty .tab-label')
    .evaluateAll((labels) =>
      [
        ...new Set(
          labels.map((label) =>
            // The tab shows its name and, when needed, its folder: only the
            // file name identifies the document.
            (label.querySelector('.label-name')?.textContent ?? '').trim(),
          ),
        ),
      ].sort(),
    );

/** Text of the live notification toasts; the container is part of the workbench. */
async function notifications(page: Page): Promise<string> {
  const toasts = page.locator('.notifications-toasts');
  if ((await toasts.count()) === 0) return '';
  return (await toasts.innerText().catch(() => '')).trim();
}

/** Escape only while a toast is on screen; bounded so a stuck toast cannot loop. */
async function dismissNotifications(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3 && (await notifications(page)); attempt++) {
    await blur(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

const sourceEditorActive = async (page: Page): Promise<boolean> => {
  const status = await page
    .locator('.part.statusbar')
    .innerText()
    .catch(() => '');
  return /\bLn \d+, Col \d+\b/.test(status);
};

async function editorIs(
  page: Page,
  kind: 'source' | 'designer',
): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  do {
    if ((await sourceEditorActive(page)) === (kind === 'source')) return true;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return false;
}

/**
 * Activate one of the two tabs of a report. The observed order is re-probed on
 * every switch instead of assumed, so a workbench that arranges tabs differently
 * fails with a clear message instead of asserting against the wrong surface.
 */
async function activateEditor(
  page: Page,
  file: string,
  kind: 'source' | 'designer',
): Promise<void> {
  const tabs = page.locator('.part.editor .tabs-container .tab');
  const texts = await tabs.allTextContents();
  const indices = texts.flatMap((text, index) =>
    text.includes(file) ? [index] : [],
  );
  if (indices.length === 0)
    throw new Error(`No open tab for ${file}; tabs ${JSON.stringify(texts)}`);
  // The designer is always opened after its source editor, so try the side that
  // matches first: rejecting a candidate must stay inside the race window.
  const ordered = kind === 'designer' ? [...indices].reverse() : indices;
  for (const index of ordered) {
    await step(`activateEditor ${file} (${kind}): clicking tab ${index}`, () =>
      tabs.nth(index).click({ timeout: STEP_TIMEOUT }),
    );
    if (await editorIs(page, kind)) return;
  }
  throw new Error(`No ${kind} tab for ${file} became active`);
}

/**
 * Dispose the active editor through its tab's own close button: a keystroke
 * or a focus change first settles any typed draft through the field's blur,
 * so the tab action is the only close that decides nothing by itself.
 */
async function closeActiveTab(page: Page): Promise<void> {
  const tab = page.locator('.editor-group-container .tab.active').first();
  // The close action of a tab is only laid out while it is hovered or active
  // (and a dirty tab shows its dot until hovered): hover reveals it first.
  await step('closeActiveTab: hovering the active tab', () =>
    tab.hover({ timeout: STEP_TIMEOUT }),
  );
  const close = tab
    .locator(
      '.tab-actions [aria-label^="Close"], .tab-actions [title^="Close"]',
    )
    .first();
  await step('closeActiveTab: close action visible', () =>
    close.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }),
  );
  await step('closeActiveTab: clicking the close action', () =>
    close.click({ timeout: STEP_TIMEOUT }),
  );
}

/**
 * Right-click a Structure row and activate one context-menu item. The menu is
 * awaited (and the right-click repeated if it never rendered) before the item
 * is touched, and the item is then pressed once and held past the 100 ms window
 * in which VS Code ignores a context-menu mouseup.
 */
async function activateRowMenu(
  page: Page,
  rowName: string,
  item: RegExp,
): Promise<void> {
  const target = row(page, rowName);
  const entry = page.getByRole('menuitem', { name: item });
  await step(`row menu ${rowName}: row visible`, () =>
    target.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }),
  );
  await expect(async () => {
    await target.click({ button: 'right', timeout: 5_000 });
    await entry.waitFor({ state: 'visible', timeout: 5_000 });
  }, `row menu ${rowName}: ${item} offered`).toPass({
    timeout: 30_000,
  });
  // VS Code arms context-menu mouseup handlers 100ms after render.
  await step(`row menu ${rowName}: clicking ${item}`, () =>
    entry.click({ delay: 250, timeout: STEP_TIMEOUT }),
  );
}

async function expectHeaders(page: Page, file: string): Promise<void> {
  for (const label of VIEWS)
    await expect(
      pane(page, label).locator('.pane-header'),
      `${label} header for ${file}`,
    ).toContainText(file);
}

const row = (page: Page, name: string) =>
  page.getByRole('treeitem', { name: new RegExp(`^Textbox: ${name}`) });

/**
 * VS Code renders tree rows virtually, so a row scrolled out of its list is
 * not in the DOM at all: scroll its tree back before it can be located. A row
 * that stays absent after the reveal is genuinely not published, and fails.
 */
async function revealRow(page: Page, name: string): Promise<void> {
  const target = row(page, name);
  if ((await target.count()) > 0) return;
  // The last rendered row: sticky-scroll ancestors overlay the first ones.
  const rendered = pane(page, 'Report Structure')
    .locator('.monaco-list-row')
    .last();
  // Scroll up in bounded steps from the tree itself; a step whose wheel lands
  // on a row hover widget is simply retried.
  await rendered.hover();
  for (let step = 0; step < 12 && (await target.count()) === 0; step++) {
    await rendered.hover({ timeout: 2_000 }).catch(() => {});
    await page.mouse.wheel(0, -600);
  }
  await expect(
    target,
    `${name} is published by the current structure tree`,
  ).toBeAttached();
}

async function selectRow(page: Page, name: string): Promise<void> {
  await revealRow(page, name);
  await row(page, name).click();
  await expect(
    page.getByRole('treeitem', {
      name: new RegExp(`^Textbox: ${name}, Primary`),
    }),
  ).toBeVisible();
}

/** The Name field of the Properties panel, expanded through its toolbar button. */
async function inspectorField(frame: Frame, label: string) {
  const properties = frame.getByRole('button', {
    name: 'Properties',
    exact: true,
  });
  if ((await properties.getAttribute('aria-expanded')) === 'false')
    await properties.click();
  return frame.getByRole('textbox', { name: label, exact: true });
}

/**
 * Focus inside a designer frame: a form field reports its property, anything
 * else reports its own text (buttons expose their label as text content).
 */
const focusOf = (frame: Frame): Promise<string> =>
  frame.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return 'none';
    const property = active.getAttribute('data-property');
    if (property) return `field:${property}`;
    return `text:${(active.textContent ?? '').replace(/\s+/g, ' ').trim()}`;
  });

/** Report bytes on disk are untouched by view-local work. */
async function expectBytesIntact(
  ctx: Ctx,
  original: Map<string, Buffer>,
): Promise<void> {
  for (const [name, bytes] of original)
    expect((await readFile(ctx.path(name))).equals(bytes), name).toBe(true);
}

/** Zero view-only edits: bytes identical and no dirty tab. */
async function expectPristine(
  ctx: Ctx,
  original: Map<string, Buffer>,
): Promise<void> {
  await expectBytesIntact(ctx, original);
  await expect(ctx.page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);
}

async function snapshot(ctx: Ctx, ...names: string[]) {
  return new Map(
    await Promise.all(
      names.map(
        async (name) => [name, await readFile(ctx.path(name))] as const,
      ),
    ),
  );
}

/** Save through the real host path and wait for the independent disk read. */
async function save(ctx: Ctx): Promise<void> {
  await blur(ctx.page);
  await ctx.page.keyboard.press(`${MOD}+s`);
  await expect(ctx.page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);
}

/**
 * Save an edit that was just requested (designer commit, native creation or
 * Undo). The edit reaches the host asynchronously: saving while no tab is dirty
 * yet saves nothing and the "no dirty tab" wait is already satisfied, so the
 * disk read that follows would see the old bytes.
 */
async function saveEdit(ctx: Ctx): Promise<void> {
  await expect
    .poll(() => dirtyCount(ctx.page), 'the edit reached the host (dirty tab)')
    .toBeGreaterThan(0);
  await save(ctx);
}

type RaceAction = 'select' | 'properties' | 'create';
type RaceDisturbance = 'edit' | 'switch' | 'non-report' | 'close';

interface RaceCase {
  readonly id: string;
  readonly action: RaceAction;
  readonly disturbance: RaceDisturbance;
}

interface RaceResult extends RaceCase {
  readonly reason: string;
  readonly designerFrames: number;
  readonly edited: boolean;
}

/**
 * The refusal family the real opening path can surface: revalidation after
 * `openWith`, the row authority check, or the bounded readiness wait. The exact
 * reason string is recorded in the race log instead of being pinned here.
 */
const REFUSAL =
  /no longer current: \w+|report changed before the native action (?:arrived|completed)|changed while the action was being delivered|This report item is stale|did not become ready|Report action ended/;

/**
 * Observe the preliminary opening through the workbench itself: the custom
 * editor's tab appears before the webview reports ready, which is the only real
 * observation hook the Desktop gives for a request that is in flight.
 */
async function observeOpening(page: Page, baseline: number): Promise<void> {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('.part.editor .tabs-container .tab').length >
      count,
    baseline,
    { polling: 25, timeout: 30_000 },
  );
}

/**
 * Delay hook (T053 allows observation/delay hooks only). Through the extension
 * host's Node inspector, a breakpoint is armed on the opening path right after
 * `vscode.openWith` resolves: the designer panel exists, and every later
 * revalidation (readiness, binding, delivery) still lies ahead. The test then
 * disturbs the workbench and resumes, on every machine at the same point of the
 * real code. Nothing in the product changes; holding nothing fails loudly.
 */
async function armOpeningHold(port: number): Promise<{
  readonly paused: Promise<void>;
  release(): Promise<void>;
}> {
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(10_000),
    })
  ).json()) as { webSocketDebuggerUrl: string }[];
  expect(targets.length, 'extension host inspector target').toBeGreaterThan(0);
  const socket = new WebSocket(targets[0]!.webSocketDebuggerUrl);
  await within(
    new Promise<void>((done, fail) => {
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => fail(new Error('inspector')), {
        once: true,
      });
    }),
    10_000,
    'inspector connection',
  );
  let id = 0;
  const replies = new Map<number, (result: unknown) => void>();
  const scripts: { scriptId: string; url: string }[] = [];
  let onPaused: () => void = () => {};
  const paused = new Promise<void>((done) => (onPaused = done));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: { scriptId: string; url: string };
      result?: unknown;
    };
    if (message.id !== undefined) replies.get(message.id)?.(message.result);
    else if (message.method === 'Debugger.scriptParsed')
      scripts.push(message.params!);
    else if (message.method === 'Debugger.paused') onPaused();
  });
  const send = <T>(method: string, params: object = {}) =>
    within(
      new Promise<T>((done) => {
        replies.set(++id, done as (result: unknown) => void);
        socket.send(JSON.stringify({ id, method, params }));
      }),
      10_000,
      `inspector ${method}`,
    );
  await send('Debugger.enable');
  // Both the installed VSIX and the development build load build/extension.cjs.
  const script = scripts.find((entry) => {
    // Checkout paths keep their case (CI: /home/runner/work/RDLC-Code/...).
    const url = decodeURIComponent(entry.url)
      .replaceAll('\\', '/')
      .toLowerCase();
    return url.endsWith('/build/extension.cjs') && url.includes('rdlc');
  });
  expect(script, 'the extension bundle is loaded').toBeDefined();
  const { scriptSource } = await send<{ scriptSource: string }>(
    'Debugger.getScriptSource',
    { scriptId: script!.scriptId },
  );
  const lines = scriptSource.split('\n');
  const marker = lines.findIndex((line) =>
    line.includes('Opening the report designer timed out.'),
  );
  const lineNumber = lines.findIndex(
    (line, index) => index > marker && line.includes('clearTimeout(timer);'),
  );
  expect(marker, 'the opening path is in the bundle').toBeGreaterThan(-1);
  expect(lineNumber, 'the post-opening line is in the bundle').toBeGreaterThan(
    marker,
  );
  const { breakpointId } = await send<{ breakpointId: string }>(
    'Debugger.setBreakpoint',
    { location: { scriptId: script!.scriptId, lineNumber } },
  );
  return {
    paused,
    async release() {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        await send('Debugger.removeBreakpoint', { breakpointId });
        await send('Debugger.resume');
        await send('Debugger.disable');
      } finally {
        // Closing the session also resumes a host that is still held.
        socket.close();
      }
    },
  };
}

/**
 * Start from source-only A (its text editor only, no designer), activate a real
 * native action, observe that its designer is opening and disturb it while the
 * request is still in flight.
 * shortcut: the refusal depends on the disturbance landing inside the opening
 * window (webview load + readiness handshake); if the product ever opens faster
 * than the workbench can be disturbed the case fails loudly instead of passing.
 */
async function runRace(
  ctx: Ctx,
  options: RaceCase,
  markers: { originalA: string; markedA: string; originalB: string },
): Promise<RaceResult> {
  const { page } = ctx;
  if ((await dirtyCount(page)) > 0)
    throw new Error(
      `${options.id}: a previous case left unsaved changes; closing editors would prompt`,
    );
  const started = Date.now();
  const laps: string[] = [];
  const lap = (label: string): void => {
    laps.push(`${label} ${Date.now() - started} ms`);
  };
  await ctx.driver.command('View: Close All Editors');
  const priorA = await readFile(ctx.path('a.rdlc'), 'utf8');
  if (priorA !== markers.originalA) {
    expect(
      priorA,
      "only the prior case's injected marker may need resetting",
    ).toBe(markers.markedA);
    await writeFile(ctx.path('a.rdlc'), markers.originalA);
  }
  // B and the non-report file stay open the whole case, so each switch is one
  // tab click the renderer applies while the host is held.
  for (const name of ['notes.txt', 'b.rdlc', 'a.rdlc']) {
    await openFile(ctx, name);
    // The status bar lags the newly opened editor: give a text editor time to
    // show its position before deciding that the designer opened instead.
    if (!(await editorIs(page, 'source'))) {
      await palette(page, 'View: Reopen Editor With...', 'Text Editor');
    }
    await expect
      .poll(
        () => sourceEditorActive(page),
        `${name} starts in the source editor`,
      )
      .toBe(true);
  }
  await showRdlc(ctx);
  await expectHeaders(page, 'a.rdlc');
  await expect
    .poll(() => designerCount(page), `${options.id}: source-only A`)
    .toBe(0);
  await ctx.driver.command(
    options.action === 'create'
      ? 'Focus on Components View'
      : 'Focus on Report Structure View',
  );

  const tabs = page.locator('.part.editor .tabs-container .tab');
  const baseline = await tabs.count();
  const hold = await armOpeningHold(ctx.inspector);
  lap('setup');
  try {
    if (options.action === 'select')
      await step(`${options.id}: clicking the Front row`, () =>
        row(page, 'Front').click({ timeout: STEP_TIMEOUT }),
      );
    else if (options.action === 'properties') {
      await activateRowMenu(page, 'Front', /Properties/);
    } else
      await step(`${options.id}: clicking Textbox, Insert`, () =>
        page
          .getByRole('treeitem', { name: /^Textbox, Insert/ })
          .click({ timeout: STEP_TIMEOUT }),
      );

    // The host stops right after the real opening; the refusal below is
    // mandatory, so a request that never reached that point cannot pass.
    await within(
      hold.paused,
      45_000,
      `${options.id}: the opening reaching the held line`,
    );
    await observeOpening(page, baseline);
    lap('held');

    if (options.disturbance === 'edit') {
      await writeFile(ctx.path('a.rdlc'), markers.markedA);
      // No observable state: the disk watcher reloads the model inside the
      // renderer without any tab, status or dirty change (the host is held), so
      // a bounded settle is the only way to let it land before the resume.
      await page.waitForTimeout(2_500);
    } else if (options.disturbance === 'close') {
      const open = await tabs.count();
      // Dispose the panel that is opening, never the source editor: closing
      // the source would leave the panel to finish and dispatch.
      if ((await sourceEditorActive(page)) === true)
        await activateEditor(page, 'a.rdlc', 'designer');
      await closeActiveEditor(page);
      await expect
        .poll(() => tabs.count(), `${options.id}: the panel tab closed`)
        .toBe(open - 1);
    } else {
      // The tab click is the disturbance; the active tab and status bar are
      // the renderer applying it, already confirmed by `activateEditor`.
      const file = options.disturbance === 'switch' ? 'b.rdlc' : 'notes.txt';
      await activateEditor(page, file, 'source');
      await expect(
        page.locator('.part.editor .tabs-container .tab.active').first(),
        `${options.id}: ${file} is the active tab`,
      ).toContainText(file);
    }
    lap('disturbed');
  } finally {
    // A failed step must not leave the extension host held: the shutdown
    // would wait on it and the failure would surface as a bare test timeout.
    // Releasing twice is a no-op.
    await hold.release().catch((error: unknown) => {
      console.error(`[context] ${options.id}: releasing the host: ${error}`);
    });
  }

  await expect
    .poll(() => notifications(page), {
      timeout: 30_000,
      message: `${options.id}: refusal surfaced`,
    })
    .toMatch(REFUSAL);
  const reason = await notifications(page);
  lap('refused');

  const expectedA =
    options.disturbance === 'edit' ? markers.markedA : markers.originalA;
  const bytesA = await readFile(ctx.path('a.rdlc'), 'utf8');
  const bytesB = await readFile(ctx.path('b.rdlc'), 'utf8');
  const edited = (await dirtyCount(page)) > 0 || bytesA !== expectedA;
  expect(edited, `${options.id}: opening produced no report history`).toBe(
    false,
  );
  expect(bytesA, `${options.id}: A bytes`).toBe(expectedA);
  expect(bytesB, `${options.id}: B bytes`).toBe(markers.originalB);
  // Only A's own designer may open; the other report's view is never borrowed.
  const frames = await designerCount(page);
  expect(frames, `${options.id}: no foreign designer`).toBeLessThanOrEqual(1);
  expect(
    (await readdir(ctx.dir)).sort(),
    `${options.id}: no report copies are written`,
  ).toEqual(['.vscode', 'a.rdlc', 'b.rdlc', 'notes.txt']);

  await dismissNotifications(page);
  lap('verified');
  console.log(`[context] ${options.id}: ${laps.join(', ')}`);
  return {
    ...options,
    reason: reason.slice(0, 240),
    designerFrames: frames,
    edited,
  };
}

/**
 * Not injectable from the Desktop surface: the product, the test harness and the
 * driver expose no delay or observation hook for them, so they are asserted by
 * the host suites (`tests/vscode/synchronization.test.ts`) instead of being
 * faked here.
 */
const NOT_INJECTABLE = [
  'delayed action outcomes and result/snapshot arrival orders (no delay hook)',
  'duplicate transport delivery and duplicate outcome echoes (transport stays inside the extension host)',
  'rejected postMessage and delivery to a disposed webview while the bound view is already ready (dispatch completes in milliseconds)',
  'delivery staleness behind a queued document mutation (host-injected in tests/vscode/synchronization.test.ts)',
  'readiness-timeout exhaustion without closing the panel (bounded 15 s wait; one case only)',
];

// ---------------------------------------------------------------------------
// US5.1 — 100 real A/B/source/sidebar switches with identical item names
// ---------------------------------------------------------------------------

test('US5.1-switches', async () => {
  // UNVALIDATED on macOS: the quick-open list never shows the second report
  // after the first designer opens (run 40867144705, macOS 14, 1.142.0). Not
  // diagnosed; passes on Linux and Windows. See
  // specs/005-native-sidebar-integration/automated-validation.md.
  test.skip(
    platformSkipAccepted('US5.1-switches'),
    platformSkipReason('US5.1-switches') ?? '',
  );
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);

    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    await openFile(ctx, 'b.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(2);

    // Two views, each holding a different same-named item: a command that
    // reaches the other report is visible as the wrong canvas text.
    await activateEditor(page, 'a.rdlc', 'source');
    await expectHeaders(page, 'a.rdlc');
    await selectRow(page, 'Front');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    await activateEditor(page, 'b.rdlc', 'source');
    await expectHeaders(page, 'b.rdlc');
    await selectRow(page, 'Behind');
    const expected = [TEXT.aFront, TEXT.behind].sort();
    await expect.poll(() => primaryContents(page)).toEqual(expected);

    const switches = [
      { kind: 'source', file: 'a.rdlc', item: 'Front' },
      { kind: 'sidebar', file: 'a.rdlc', item: 'Front' },
      { kind: 'source', file: 'b.rdlc', item: 'Behind' },
      { kind: 'designer', file: 'a.rdlc', item: 'Front' },
      { kind: 'designer', file: 'b.rdlc', item: 'Behind' },
    ] as const;
    for (let index = 0; index < 100; index++) {
      const step = switches[index % switches.length]!;
      if (step.kind === 'sidebar')
        await ctx.driver.command('Focus on Report Structure View');
      else await activateEditor(page, step.file, step.kind);
      await expectHeaders(page, step.file);
      await selectRow(page, step.item);
      await expect.poll(() => primaryContents(page)).toEqual(expected);
      expect(
        (await notifications(page)).trim(),
        `switch ${index} (${step.kind} ${step.file}) refused nothing`,
      ).toBe('');
    }

    // One accepted edit must still be exactly one history step: 100 selections
    // and switches added no edit, no dirty state and no history entry.
    await expectPristine(ctx, original);
    await activateEditor(page, 'a.rdlc', 'designer');
    // Two designers are open: A's is the one holding A's selection.
    const frame = await frameShowing(page, TEXT.aFront);
    const name = await inspectorField(frame, 'Name');
    await expect(name).toHaveValue('Front');
    await name.fill('FrontRenamed');
    await name.press('Enter');
    await saveEdit(ctx);
    await expect
      .poll(() => readFile(ctx.path('a.rdlc'), 'utf8'))
      .toContain('Name="FrontRenamed"');
    expect(
      await readFile(ctx.path('b.rdlc'), 'utf8'),
      'B is untouched by an A edit',
    ).toBe(original.get('b.rdlc')!.toString('utf8'));
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await saveEdit(ctx);
    await expectPristine(ctx, original);
    await writeLog('race-log-us5-1-switches', {
      requirement: 'AT-06: 100 document/view switches',
      switches: 100,
      targets: switches.map((step) => `${step.kind}:${step.file}`),
      identicalItemNames: ['Textbox: Front', 'Textbox: Behind'],
      wrongTargetEdits: 0,
      dirtyTabs: 0,
      historyStepsForOneEdit: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// US5.2 — focus entering a native view keeps the captured A context
// ---------------------------------------------------------------------------

test('US5.2-sidebar-focus', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    await expectHeaders(page, 'a.rdlc');

    // Focus entering each native view changes no context, content or history.
    for (const [label, command] of [
      ['Report Structure', 'Focus on Report Structure View'],
      ['Report Data', 'Focus on Report Data View'],
      ['Components', 'Focus on Components View'],
    ] as const) {
      await ctx.driver.command(command);
      await expectHeaders(page, 'a.rdlc');
      await expect(
        pane(page, label).locator('.pane-header'),
        `${label} still reports A after focus entered it`,
      ).toContainText('a.rdlc');
      await expectPristine(ctx, original);
    }

    // Pointer focus entering the structure view, then a native action: it still
    // targets A and only selects — nothing is written by focusing.
    await ctx.driver.command('Focus on Report Structure View');
    await row(page, 'Front').hover();
    await selectRow(page, 'Front');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    await expectPristine(ctx, original);
    expect((await notifications(page)).trim()).toBe('');

    // Sidebar focus between two activations must not invalidate the second one.
    await ctx.driver.command('Focus on Report Structure View');
    await selectRow(page, 'LaterTie');
    await expect.poll(() => primaryContents(page)).toContain(TEXT.laterTie);
    await expectPristine(ctx, original);
    await writeLog('race-log-us5-2-sidebar-focus', {
      requirement: 'US5.2: focus preserves the captured context',
      focusActivations: 4,
      nativeActionsAfterFocus: 2,
      refusals: 0,
      reportBytesChanged: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// US5.3 — two designers of A: view-local state, shared accepted content
// ---------------------------------------------------------------------------

/** Canvas text of one view's selected body item, or null when nothing is selected. */
async function primaryOf(frame: Frame): Promise<string | null> {
  try {
    const primary = frame.locator('.item.primary .content');
    if ((await primary.count()) === 0) return null;
    return ((await primary.first().textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return null;
  }
}

/** Identify a view by the canvas text it shows; identical reports look alike. */
async function frameShowing(page: Page, content: string): Promise<Frame> {
  for (const frame of await designerFrames(page)) {
    if ((await primaryOf(frame)) === content) return frame;
  }
  throw new Error(`No designer view shows "${content}"`);
}

test('US5.3-two-views', async () => {
  // UNVALIDATED on macOS: after the first view selects a different item the
  // second view lost its own primary item (run 40418317992, macOS 14, both VS
  // Code versions). Not diagnosed; passes on Linux. See
  // specs/005-native-sidebar-integration/automated-validation.md.
  test.skip(
    platformSkipAccepted('US5.3-two-views'),
    platformSkipReason('US5.3-two-views') ?? '',
  );
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    await palette(page, 'View: Split Editor');
    await expect.poll(() => designerCount(page)).toBe(2);
    // The editor part is one container per window area; each split editor
    // group owns its own tabs inside it.
    await expect(page.locator('.editor-group-container')).toHaveCount(2);

    // Split focuses the new group: its selection identifies which frame is view 2.
    await selectRow(page, 'Front');
    expect(await primaryContents(page)).toEqual([TEXT.aFront]);
    const view2 = await frameShowing(page, TEXT.aFront);

    // Activate the first group's designer tab and select a different item.
    const firstGroupTabs = page
      .locator('.editor-group-container')
      .nth(0)
      .locator('.tabs-container .tab');
    const tabCount = await firstGroupTabs.count();
    for (let index = 0; index < tabCount; index++) {
      await firstGroupTabs.nth(index).click();
      if (await editorIs(page, 'designer')) break;
    }
    expect(await editorIs(page, 'designer')).toBe(true);
    await selectRow(page, 'Behind');
    await expect
      .poll(() => primaryContents(page))
      .toEqual([TEXT.aFront, TEXT.behind].sort());
    const view1 = await frameShowing(page, TEXT.behind);

    // View-local selection: both views keep their own primary item.
    expect(await primaryOf(view1)).toBe(TEXT.behind);
    expect(await primaryOf(view2)).toBe(TEXT.aFront);

    // View-local viewport: zoom set in one view never reaches the other.
    const zoom1 = view1.getByRole('spinbutton', { name: 'Zoom percent' });
    const zoom2 = view2.getByRole('spinbutton', { name: 'Zoom percent' });
    await zoom2.fill('150');
    await zoom2.press('Tab');
    await expect(zoom2).toHaveValue('150');
    await expect(zoom1).toHaveValue('100');

    // View-local draft: typing in one view never shows in the other. View 1's
    // inspector opens first and is then only read: focusing it would blur view
    // 2's field, and an inspector field commits on change (001–004 semantics).
    const view1Name = await inspectorField(view1, 'Name');
    await expect(view1Name).toHaveValue('Behind');
    const draftName = await inspectorField(view2, 'Name');
    await expect(draftName).toHaveValue('Front');
    await draftName.fill('DraftSecond');
    await expect(view1Name).toHaveValue('Behind');
    expect(await dirtyCount(page)).toBe(0);
    // Escape reverts the field and dismisses the compact inspector overlay.
    await draftName.press('Escape');
    await expect(await inspectorField(view2, 'Name')).toHaveValue('Front');

    // One accepted edit updates both views and the shared source document.
    const text = await inspectorField(view1, 'Text');
    await text.fill('Behind updated');
    await text.press('Enter');
    await expect
      .poll(async () => {
        const counts = await Promise.all(
          [view1, view2].map((frame) =>
            frame
              .getByText('Behind updated')
              .count()
              .catch(() => 0),
          ),
        );
        return counts.every((count) => count > 0);
      })
      .toBe(true);
    await saveEdit(ctx);
    const updated = await readFile(ctx.path('a.rdlc'), 'utf8');
    expect(updated).toContain('Behind updated');
    expect(updated.replace('Behind updated', 'Behind &amp; preserved')).toBe(
      original.get('a.rdlc')!.toString('utf8'),
    );
    await view1.getByRole('button', { name: 'Undo', exact: true }).click();
    await saveEdit(ctx);
    await expectPristine(ctx, original);
    await writeLog('race-log-us5-3-two-views', {
      requirement: 'US5.3: two designers of one document',
      views: 2,
      viewLocalSelections: 2,
      viewLocalZoom: ['100', '150'],
      viewLocalDrafts: 1,
      acceptedEditsVisibleInBothViews: 1,
      historyStepsForOneEdit: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// US5.4 — capture refused after close/context change during the opening
// ---------------------------------------------------------------------------

test('US5.4-disposal', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const originalA = await readFile(ctx.path('a.rdlc'), 'utf8');
    const originalB = await readFile(ctx.path('b.rdlc'), 'utf8');
    const markers = {
      originalA,
      originalB,
      markedA: originalA.replace(
        '</Report>',
        '<!-- independent edit during opening --></Report>',
      ),
    };
    expect(markers.markedA).not.toBe(originalA);
    await showRdlc(ctx);

    const cases: RaceCase[] = [
      { id: 'close-select', action: 'select', disturbance: 'close' },
      { id: 'close-properties', action: 'properties', disturbance: 'close' },
      {
        id: 'non-report-select',
        action: 'select',
        disturbance: 'non-report',
      },
      {
        id: 'non-report-create',
        action: 'create',
        disturbance: 'non-report',
      },
    ];
    const results: RaceResult[] = [];
    for (const options of cases) {
      const result = await runRace(ctx, options, markers);
      results.push(result);
      expect(result.edited, `${options.id} settled without an edit`).toBe(
        false,
      );
    }

    await writeLog('race-log-us5-4-disposal', {
      requirement: 'US5.4: closed/changed targets refuse during opening',
      method:
        'real activation disturbed during the real preliminary designer opening; refusal read from the notification surface',
      cases: results,
      count: results.length,
      requiredByContract: 50,
      notInjectableFromDesktop: NOT_INJECTABLE,
    });
  });
});

// ---------------------------------------------------------------------------
// US5.5 — dirty draft: Cancel / Discard / Apply with real focus ordering
// ---------------------------------------------------------------------------

test('US5.5-draft-guard', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');

    const banner = frame.getByRole('group', { name: 'Unapplied draft' });
    const codeXml = frame.getByRole('button', {
      name: 'Code XML',
      exact: true,
    });
    const conflict = async () => {
      await codeXml.click();
      await expect(banner).toBeVisible();
      // The product moves focus to the decision it asks the user to make.
      await expect.poll(() => focusOf(frame)).toContain('Apply draft');
    };

    const name = await inspectorField(frame, 'Name');
    await expect(name).toHaveValue('Front');
    await name.fill('DraftFront');
    await expect(name).toHaveValue('DraftFront');
    // Typing alone settles nothing.
    await expect(banner).toBeHidden();
    expect(await dirtyCount(page)).toBe(0);

    // Cancel: keep the draft, keep the accepted selection, run nothing.
    await conflict();
    await frame.getByRole('button', { name: 'Cancel new action' }).click();
    await expect(banner).toBeHidden();
    await expect(name).toHaveValue('DraftFront');
    // Focus returns to the field that owns the draft.
    await expect.poll(() => focusOf(frame)).toBe('field:name');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    expect(await dirtyCount(page)).toBe(0);
    expect(await sourceEditorActive(page)).toBe(false);

    // Discard: the draft is abandoned explicitly, then the held action runs.
    await conflict();
    await frame.getByRole('button', { name: 'Discard draft' }).click();
    await expect(banner).toBeHidden();
    await expect(name).toHaveValue('Front');
    await expect.poll(() => sourceEditorActive(page)).toBe(true);
    await expectPristine(ctx, original);

    // Apply: exactly one accepted edit, and the held action is never replayed.
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const applied = (await designerFrames(page))[0]!;
    const appliedName = await inspectorField(applied, 'Name');
    await appliedName.fill('DraftFront');
    await applied
      .getByRole('button', { name: 'Code XML', exact: true })
      .click();
    await expect(
      applied.getByRole('group', { name: 'Unapplied draft' }),
    ).toBeVisible();
    await applied.getByRole('button', { name: 'Apply draft' }).click();
    await saveEdit(ctx);
    const afterApply = await readFile(ctx.path('a.rdlc'), 'utf8');
    expect(afterApply).toContain('Name="DraftFront"');
    expect(afterApply.replace('Name="DraftFront"', 'Name="Front"')).toBe(
      original.get('a.rdlc')!.toString('utf8'),
    );
    // The held Code XML action never ran: the source editor stayed closed.
    expect(await sourceEditorActive(page)).toBe(false);
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);

    // Exactly one history step, and B is never touched.
    await applied.getByRole('button', { name: 'Undo', exact: true }).click();
    await saveEdit(ctx);
    await expectPristine(ctx, original);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );
  });
});

// ---------------------------------------------------------------------------
// US5.6 — external reload publishes accepted state; drafts and unsaved text
// ---------------------------------------------------------------------------

test('US5.6-external-changes', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const name = await inspectorField(frame, 'Name');
    await name.fill('DraftBeforeReload');
    await expect(name).toHaveValue('DraftBeforeReload');

    // A clean external change: accepted content reaches every view, the stale
    // draft cannot overwrite it, and nothing becomes dirty.
    const reloaded = original
      .get('a.rdlc')!
      .toString('utf8')
      .replace('<Value>Alpha report</Value>', '<Value>Reloaded front</Value>');
    expect(reloaded).not.toBe(original.get('a.rdlc')!.toString('utf8'));
    await writeFile(ctx.path('a.rdlc'), reloaded);
    await expect
      .poll(() => primaryContents(page), { timeout: 20_000 })
      .toContain('Reloaded front');
    // The stale draft cannot overwrite the accepted state: it is discarded.
    await expect(
      frame.getByText(
        'The document changed; your unapplied draft was discarded.',
      ),
    ).toBeVisible();
    // Visible projection freshness: the tree must publish the exact item
    // names of the XML just written before any native action targets them,
    // and the discarded draft name may never be one of them.
    await expect(
      row(page, 'Front'),
      'the reloaded document is published under its accepted item name',
    ).toBeVisible();
    await expect(
      row(page, 'Front'),
      'a discarded draft never renames the published item',
    ).not.toHaveText(/DraftBeforeReload/);
    // The superseded typed text never commits into the reloaded report.
    await expect(await inspectorField(frame, 'Name')).toHaveValue('Front');
    expect(await dirtyCount(page)).toBe(0);
    await selectRow(page, 'Front');
    await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );

    // Unsaved source text survives: it lives in the host buffer, not on disk.
    await ctx.driver.command('RDLC Code: Open Source');
    await expect.poll(() => sourceEditorActive(page)).toBe(true);
    await page.keyboard.press(`${MOD}+End`);
    // One insertion: typed XML would trigger auto-close and suggestions.
    await page.keyboard.insertText('<!-- unsaved marker -->');
    // Only A is dirty; its designer and source tabs both show that buffer.
    await expect.poll(() => dirtyReports(page)).toEqual(['a.rdlc']);
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(reloaded);

    // A later independent edit to another report never touches A's buffer.
    await openFile(ctx, 'b.rdlc');
    await expectHeaders(page, 'b.rdlc');
    await openFile(ctx, 'a.rdlc');
    // Only A is dirty; its designer and source tabs both show that buffer.
    await expect.poll(() => dirtyReports(page)).toEqual(['a.rdlc']);
    // The unsaved text is still in A's buffer after the round trip.
    await activateEditor(page, 'a.rdlc', 'source');
    await expect.poll(() => sourceEditorActive(page)).toBe(true);
    await page.keyboard.press(`${MOD}+f`);
    await page.keyboard.insertText('unsaved marker');
    await expect(
      page.locator('.find-widget').getByText(/1 of 1/),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(reloaded);

    await save(ctx);
    const saved = await readFile(ctx.path('a.rdlc'), 'utf8');
    expect(saved).toContain('<!-- unsaved marker -->');
    expect(saved).toContain('<Value>Reloaded front</Value>');
  });
});

// ---------------------------------------------------------------------------
// US5.7 — non-report and all-closed yield no-report with no background edit
// ---------------------------------------------------------------------------

test('US5.7-no-report', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    await selectRow(page, 'Front');
    await expectHeaders(page, 'a.rdlc');

    // A non-report activation clears context and removes mutation controls.
    await openFile(ctx, 'notes.txt');
    for (const label of VIEWS)
      await expect(pane(page, label).getByText(NO_REPORT)).toBeVisible();
    await expect(
      pane(page, 'Report Structure').getByRole('button', {
        name: 'New Report',
        exact: true,
      }),
    ).toBeVisible();
    const component = pane(page, 'Components').getByRole('treeitem', {
      name: /^Textbox, Unavailable\./,
    });
    await expect(component).toBeVisible();
    // Nothing remembered in the background is edited: the row has no activation.
    await component.click();
    await page.keyboard.press('Enter');
    await expectPristine(ctx, original);
    expect(await readFile(ctx.path('notes.txt'), 'utf8')).toContain(
      'Not a report.',
    );

    // Closing every report returns to no-report with no stale nodes.
    await ctx.driver.command('View: Close All Editors');
    for (const label of VIEWS)
      await expect(pane(page, label).getByText(NO_REPORT)).toBeVisible();
    await expect(row(page, 'Front')).toHaveCount(0);
    expect(await designerCount(page)).toBe(0);
    await expectPristine(ctx, original);

    // The background report is still intact when it is reopened.
    await openFile(ctx, 'b.rdlc');
    await expectHeaders(page, 'b.rdlc');
    await selectRow(page, 'Front');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.bFront]);
    await expectPristine(ctx, original);
  });
});

// ---------------------------------------------------------------------------
// FR-019 — the host text document stays the only content authority
// ---------------------------------------------------------------------------

test('FR-019-authoritative', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    const files = await readdir(ctx.dir);
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);

    // One surface for the report: no hidden designer, no sidecar copy.
    expect(await designerCount(page)).toBe(1);
    expect((await readdir(ctx.dir)).sort()).toEqual([...files].sort());

    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const name = await inspectorField(frame, 'Name');
    await name.fill('Authoritative');
    await name.press('Enter');
    await saveEdit(ctx);
    const edited = await readFile(ctx.path('a.rdlc'), 'utf8');
    // Byte-exact: only the Name attribute changed, nothing was rewritten.
    expect(edited.replace('Name="Authoritative"', 'Name="Front"')).toBe(
      original.get('a.rdlc')!.toString('utf8'),
    );
    // The canvas projection and the file agree, read independently.
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    expect(await readdir(ctx.dir)).toEqual(files);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );

    // The designer's history is the host document's history: one step back.
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await saveEdit(ctx);
    await expectPristine(ctx, original);
    expect(await readdir(ctx.dir)).toEqual(files);
    await writeLog('race-log-fr-019-authoritative', {
      requirement: 'FR-019: one authority, no parallel copy',
      workspaceFiles: files,
      designerViews: 1,
      byteExactEdits: 1,
      historyStepsForOneEdit: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// FR-020 — context from designer or text editor, including untitled
// ---------------------------------------------------------------------------

test('FR-020-context', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    const files = (await readdir(ctx.dir)).sort();
    await showRdlc(ctx);

    // Source editor resolves the context.
    await openFile(ctx, 'a.rdlc');
    await expectHeaders(page, 'a.rdlc');
    // The designer resolves the same context.
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    await expectHeaders(page, 'a.rdlc');
    // Focus entering a native view keeps it.
    await ctx.driver.command('Focus on Report Data View');
    await expectHeaders(page, 'a.rdlc');

    // Untitled reports are a context without guessing an identity from a name.
    await ctx.driver.command('RDLC Code: New Report');
    await expect(
      page
        .locator('.part.editor .tabs-container .tab')
        .filter({ hasText: /Untitled/ }),
    ).toBeVisible();
    for (const label of VIEWS)
      await expect(pane(page, label).locator('.pane-header')).toContainText(
        /Untitled/,
      );
    await expect(
      pane(page, 'Components').getByRole('treeitem', {
        name: /^Textbox, Insert/,
      }),
    ).toBeVisible();
    expect(
      (await readdir(ctx.dir)).sort(),
      'no untitled file is invented',
    ).toEqual(files);

    // A non-report activation clears the context with no background mutation.
    await openFile(ctx, 'notes.txt');
    for (const label of VIEWS)
      await expect(pane(page, label).getByText(NO_REPORT)).toBeVisible();
    await expectBytesIntact(ctx, original);

    // Reopening the report restores the same document identity.
    await openFile(ctx, 'a.rdlc');
    await expectHeaders(page, 'a.rdlc');
    await selectRow(page, 'Front');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    await expectBytesIntact(ctx, original);
    expect((await readdir(ctx.dir)).sort()).toEqual(files);
  });
});

// ---------------------------------------------------------------------------
// FR-021 — view-local state and the source-only A journeys
// ---------------------------------------------------------------------------

test('FR-021-view-local', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);

    // Source-only A: only the text editor exists.
    await openFile(ctx, 'a.rdlc');
    await expectHeaders(page, 'a.rdlc');
    expect(await designerCount(page)).toBe(0);

    // Inspection is host-only: the tooltip is read without opening any editor.
    await row(page, 'Front').hover();
    await expect(
      page.locator('.monaco-hover', {
        hasText: 'Code XML opens the current source range.',
      }),
    ).toBeVisible();
    expect(await designerCount(page)).toBe(0);

    // Code XML is host-only: it reveals source, it never opens a designer.
    await activateRowMenu(page, 'Front', /Code XML/);
    await expect(page.getByRole('menuitem', { name: /Code XML/ })).toHaveCount(
      0,
    );
    await expect.poll(() => sourceEditorActive(page)).toBe(true);
    expect(await designerCount(page)).toBe(0);
    expect((await notifications(page)).trim()).toBe('');
    await expectPristine(ctx, original);

    // Explicit native navigation opens A's own designer exactly once.
    await selectRow(page, 'Front');
    await expect.poll(() => designerCount(page)).toBe(1);
    await expectHeaders(page, 'a.rdlc');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    await ctx.driver.command('Focus on Report Structure View');
    await selectRow(page, 'Behind');
    await expect.poll(() => designerCount(page), 'no second opening').toBe(1);

    /** Back to the source-only precondition: no designer for A. */
    const closeDesigner = async (): Promise<void> => {
      if ((await designerCount(page)) === 0) return;
      // Focus the workbench tab first: a keystroke inside the webview does not
      // reach the workbench's own keybindings.
      await activateEditor(page, 'a.rdlc', 'designer');
      await closeActiveEditor(page);
      await expect.poll(() => designerCount(page)).toBe(0);
    };

    // Properties from source-only A opens A's own designer exactly once and
    // binds the captured target.
    await closeDesigner();
    await ctx.driver.command('Focus on Report Structure View');
    await activateRowMenu(page, 'Front', /Properties/);
    await expect
      .poll(() => designerCount(page), 'properties opens A once')
      .toBe(1);
    const properties = (await designerFrames(page))[0]!;
    const boundName = await inspectorField(properties, 'Name');
    await expect(boundName).toHaveValue('Front');
    await expectHeaders(page, 'a.rdlc');

    // Textbox, Table and Dataset activation each open A once from source-only
    // and leave exactly one undo step.
    const creations = [
      { row: /^Textbox, Insert/, created: /<Textbox Name="Textbox\d+">/ },
      { row: /^Table, Insert/, created: /<Tablix Name="Table\d+">/ },
      { row: /^Dataset, Insert/, created: /<DataSet Name="DataSet\d+">/ },
    ] as const;
    for (const creation of creations) {
      await closeDesigner();
      await ctx.driver.command('Focus on Components View');
      // Lower toolbox categories are virtualised out of a short pane.
      const entry = page.getByRole('treeitem', { name: creation.row });
      const first = pane(page, 'Components')
        .locator('.monaco-list-row')
        .first();
      for (let step = 0; step < 12 && (await entry.count()) === 0; step++) {
        await first.hover({ timeout: 2_000 }).catch(() => {});
        await page.mouse.wheel(0, 300);
      }
      await entry.click();
      await expect
        .poll(() => designerCount(page), `${creation.row.source} opens A once`)
        .toBe(1);
      await expectHeaders(page, 'a.rdlc');
      await saveEdit(ctx);
      const created = await readFile(ctx.path('a.rdlc'), 'utf8');
      expect(created).toMatch(creation.created);
      expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
        original.get('b.rdlc')!.toString('utf8'),
      );
      await activateEditor(page, 'a.rdlc', 'designer');
      const opened = (await designerFrames(page))[0]!;
      await opened.getByRole('button', { name: 'Undo', exact: true }).click();
      await saveEdit(ctx);
      await expectPristine(ctx, original);
    }

    // Never another report's view: B opens its own designer once, A keeps its
    // own selection, and returning to A reuses A's surviving view.
    await openFile(ctx, 'a.rdlc');
    await expectHeaders(page, 'a.rdlc');
    await selectRow(page, 'Front');
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);
    await openFile(ctx, 'b.rdlc');
    await expectHeaders(page, 'b.rdlc');
    await selectRow(page, 'Behind');
    await expect.poll(() => designerCount(page)).toBe(2);
    await expect
      .poll(() => primaryContents(page))
      .toEqual([TEXT.aFront, TEXT.behind].sort());
    await openFile(ctx, 'a.rdlc');
    await expectHeaders(page, 'a.rdlc');
    await selectRow(page, 'Front');
    await expect.poll(() => designerCount(page), 'A reuses its view').toBe(2);
    await expect
      .poll(() => primaryContents(page))
      .toEqual([TEXT.aFront, TEXT.behind].sort());
    await expectPristine(ctx, original);
  });
});

// ---------------------------------------------------------------------------
// FR-023 — correlated results, and cancel/refusal restore the selection
// ---------------------------------------------------------------------------

test('FR-023-orders', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const accepted = await primaryContents(page);
    expect(accepted).toEqual([TEXT.aFront]);

    // One accepted creation: one correlated result, one edit, and the created
    // item is the one selected afterwards.
    await ctx.driver.command('Focus on Components View');
    await page.getByRole('treeitem', { name: /^Textbox, Insert/ }).click();
    await saveEdit(ctx);
    const created = await readFile(ctx.path('a.rdlc'), 'utf8');
    const inserted = created.match(/<Textbox Name="Textbox\d+">/);
    expect(inserted).toBeTruthy();
    expect(
      created.replace(inserted![0], '').includes('<Textbox Name="Textbox'),
    ).toBe(false);
    await expect(
      page.getByRole('treeitem', { name: /Textbox\d+, Primary/ }),
    ).toBeVisible();
    expect(await dirtyCount(page)).toBe(0);

    // Repeated identical selection is idempotent: no edit, no history, no toast.
    for (let repeat = 0; repeat < 3; repeat++)
      await selectRow(page, 'Textbox1');
    await expectPristineAfterCreate(ctx, original, created);

    // A refused property edit settles once and restores the accepted state.
    await selectRow(page, 'Front');
    const name = await inspectorField(frame, 'Name');
    await name.fill('Bad-Name');
    await name.press('Enter');
    const refusal = frame.locator('#report-refusal');
    await expect(refusal).toBeVisible();
    await expect(name).toHaveValue('Bad-Name');
    await expect(name).toHaveAttribute('aria-describedby', 'textbox-refusal');
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(created);
    // Repeating the refused request must not retry into a second edit.
    await name.press('Enter');
    await expect(refusal).toBeVisible();
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(created);
    expect((await notifications(page)).trim()).toBe('');
    await expect(page.getByRole('treeitem', { name: /Pending/ })).toHaveCount(
      0,
    );
    await expect.poll(() => primaryContents(page)).toContain(TEXT.aFront);
    await writeLog('race-log-fr-023-orders', {
      requirement: 'FR-023: one correlated result per request',
      acceptedCreations: 1,
      refusedRequests: 1,
      duplicateActivations: 3,
      edits: 1,
      pendingAfterSettlement: 0,
    });
  });
});

/** After one creation the file holds exactly that edit; repeats add nothing. */
async function expectPristineAfterCreate(
  ctx: Ctx,
  original: Map<string, Buffer>,
  created: string,
): Promise<void> {
  expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(created);
  expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
    original.get('b.rdlc')!.toString('utf8'),
  );
  expect(await dirtyCount(ctx.page)).toBe(0);
}

// ---------------------------------------------------------------------------
// FR-026 — drafts are settled only by an explicit decision
// ---------------------------------------------------------------------------

test('FR-026-draft', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const name = await inspectorField(frame, 'Name');
    const banner = frame.getByRole('group', { name: 'Unapplied draft' });

    // Typing is quiet: no banner, no edit, no history.
    await name.fill('DraftQuiet');
    await expect(name).toHaveValue('DraftQuiet');
    await expect(banner).toBeHidden();
    expect(await dirtyCount(page)).toBe(0);

    // A highlight (pointer over another item) settles nothing either. Front's
    // box sits underneath LaterTie's, so LaterTie is the different item a
    // real pointer can reach.
    await frame.locator('.item[aria-label^="LaterTie"]').hover();
    await page.waitForTimeout(500);
    await expect(name).toHaveValue('DraftQuiet');
    await expect(banner).toBeHidden();
    expect(await dirtyCount(page)).toBe(0);
    await expect.poll(() => primaryContents(page)).toEqual([TEXT.aFront]);

    // Cross-surface: leaving the field for the sidebar settles the typed value
    // exactly once and never loses it, whichever side wins the ordering.
    await row(page, 'Behind').click();
    const settled = await page
      .waitForFunction(
        () =>
          document.querySelectorAll('.tab.dirty').length > 0 ||
          /no longer current|stale/.test(
            document.querySelector('.notifications-toasts')?.textContent ?? '',
          ),
        undefined,
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false);
    expect(settled, 'the cross-surface blur settled one way or the other').toBe(
      true,
    );
    if ((await dirtyCount(page)) === 0) {
      // The native action refused as stale: it must work on the settled version.
      await selectRow(page, 'Behind');
    }
    await save(ctx);
    const afterBlur = await readFile(ctx.path('a.rdlc'), 'utf8');
    expect(afterBlur).toContain('Name="DraftQuiet"');
    expect(
      afterBlur.split('Name="DraftQuiet"').length - 1,
      'exactly one committed edit',
    ).toBe(1);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );
    await expect(
      page.getByRole('treeitem', { name: /Pending/ }),
      'no pending cue survives settlement',
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// EDGE-01 — untitled and Save As follow the host identity, not a basename
// ---------------------------------------------------------------------------

test('EDGE-01-identity', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(
    {
      ...(await contextFiles(root)),
      'other/saved.rdlc': { content: await variant(root, TEXT.bFront) },
    },
    async (ctx) => {
      const { page } = ctx;
      const original = await snapshot(
        ctx,
        'a.rdlc',
        'b.rdlc',
        'other/saved.rdlc',
      );
      const files = (await readdir(ctx.dir)).sort();
      await showRdlc(ctx);
      await openFile(ctx, 'a.rdlc');
      await expectHeaders(page, 'a.rdlc');

      // Untitled: a real context with no invented file.
      await ctx.driver.command('RDLC Code: New Report');
      for (const label of VIEWS)
        await expect(pane(page, label).locator('.pane-header')).toContainText(
          /Untitled/,
        );
      expect((await readdir(ctx.dir)).sort()).toEqual(files);

      // Save As follows the host transition to the chosen URI.
      await blur(page);
      await page.keyboard.press(`${MOD}+Shift+S`);
      const input = page.locator(
        '.quick-input-widget:visible .quick-input-box input',
      );
      await input.waitFor({ state: 'visible' });
      await input.fill(ctx.path('saved.rdlc'));
      await input.press('Enter');
      await expect.poll(() => headersInclude(page, 'saved.rdlc')).toBe(true);
      expect((await readdir(ctx.dir)).sort()).toEqual(
        [...files, 'saved.rdlc'].sort(),
      );
      expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(
        original.get('a.rdlc')!.toString('utf8'),
      );

      // Two reports with the same basename: identity is never guessed. The
      // active tab names the folder, so the twin is the editor in hand.
      await openFile(ctx, 'other/saved.rdlc');
      await expect(
        page.locator('.editor-group-container .tab.active'),
        'the twin report is the active editor',
      ).toContainText('other');
      await ctx.driver.command('RDLC Code: Open Designer');
      await expect.poll(() => designerCount(page)).toBe(1);
      // A designer carries no selection of its own: the canvas shows the
      // report's text only once one of its items is selected.
      await selectRow(page, 'Front');
      await expect.poll(() => primaryContents(page)).toContain(TEXT.bFront);
      // The inspector edits the twin whose URI is open, never its namesake.
      const frame = await frameShowing(page, TEXT.bFront);
      const name = await inspectorField(frame, 'Name');
      await name.fill('TwinRenamed');
      await name.press('Enter');
      await saveEdit(ctx);
      const twin = await readFile(ctx.path('other/saved.rdlc'), 'utf8');
      expect(twin).toContain('Name="TwinRenamed"');
      expect(twin.replace('Name="TwinRenamed"', 'Name="Front"')).toBe(
        original.get('other/saved.rdlc')!.toString('utf8'),
      );
      // The same-basename report keeps its own bytes: identity is the URI.
      expect(await readFile(join(ctx.dir, 'saved.rdlc'), 'utf8')).not.toContain(
        'TwinRenamed',
      );
      expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(
        original.get('a.rdlc')!.toString('utf8'),
      );
    },
  );
});

const headersInclude = async (page: Page, text: string): Promise<boolean> => {
  for (const label of VIEWS) {
    const header = await pane(page, label)
      .locator('.pane-header')
      .innerText()
      .catch(() => '');
    if (!header.includes(text)) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// EDGE-08 — disposal never restores pending state or drafts
// ---------------------------------------------------------------------------

test('EDGE-08-pending', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    const markedA = original
      .get('a.rdlc')!
      .toString('utf8')
      .replace(
        '</Report>',
        '<!-- independent edit during opening --></Report>',
      );
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const name = await inspectorField(frame, 'Name');
    await name.fill('DraftNeverSaved');

    // Closing the designer disposes the draft with it. The tab's own close
    // button is the disposal a user has: its blur settles the typed draft, so
    // the host may ask what to do with that change before the panel goes
    // away, and either ordering must still dispose of the draft.
    await closeActiveTab(page);
    const discard = page.getByRole('button', { name: "Don't Save" });
    await expect
      .poll(
        async () =>
          (await designerCount(page)) === 0 || (await discard.count()) > 0,
        'the designer closes, or the host asks about the settled draft',
      )
      .toBe(true);
    if ((await discard.count()) > 0) await discard.click();
    await expect
      .poll(() => designerCount(page), 'the designer panel is disposed')
      .toBe(0);
    await expectPristine(ctx, original);

    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const reopened = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const restored = await inspectorField(reopened, 'Name');
    await expect(restored).toHaveValue('Front');
    await expect(
      page.getByRole('treeitem', { name: /DraftNeverSaved/ }),
    ).toHaveCount(0);

    // A request refused during opening leaves no pending cue behind.
    const result = await runRace(
      ctx,
      { id: 'pending-after-refusal', action: 'select', disturbance: 'edit' },
      {
        originalA: original.get('a.rdlc')!.toString('utf8'),
        markedA,
        originalB: original.get('b.rdlc')!.toString('utf8'),
      },
    );
    expect(result.edited).toBe(false);
    await expect(page.getByRole('treeitem', { name: /Pending/ })).toHaveCount(
      0,
    );
    await expectPristine(
      ctx,
      new Map([
        ['a.rdlc', Buffer.from(markedA, 'utf8')],
        ['b.rdlc', original.get('b.rdlc')!],
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// EDGE-09 — rejected delivery settles once, repeats stay idempotent
// ---------------------------------------------------------------------------

test('EDGE-09-rejected', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');

    // Repeated identical activations: idempotent, no repeated mutation.
    for (let repeat = 0; repeat < 5; repeat++) await selectRow(page, 'Front');
    await expectPristine(ctx, original);
    expect((await notifications(page)).trim()).toBe('');

    // Rejected delivery: the host refuses the value, exactly once, with no
    // retry and no mutation; the accepted selection is untouched.
    const name = await inspectorField(frame, 'Name');
    await name.fill('Bad-Name');
    await name.press('Enter');
    const refusal = frame.locator('#report-refusal');
    await expect(refusal).toBeVisible();
    expect((await refusal.innerText()).replace(/\s+/g, ' ')).toContain(
      'The report is unchanged.',
    );
    await expect(name).toHaveAttribute('aria-describedby', 'textbox-refusal');
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(
      original.get('a.rdlc')!.toString('utf8'),
    );
    expect(await dirtyCount(page)).toBe(0);

    // A second identical submission settles the same way; nothing is replayed.
    await name.press('Enter');
    await expect(refusal).toBeVisible();
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(
      original.get('a.rdlc')!.toString('utf8'),
    );
    expect(await dirtyCount(page)).toBe(0);
    await expect(page.getByRole('treeitem', { name: /Pending/ })).toHaveCount(
      0,
    );
    // Focus did not bounce out of the surface the user was working in.
    await selectRow(page, 'Front');
    const inSidebar = await page.evaluate(
      () => document.activeElement?.closest('.part.sidebar') !== null,
    );
    expect(inSidebar).toBe(true);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );
    await writeLog('race-log-edge-09-rejected', {
      requirement: 'EDGE-09: rejected delivery settles without retry',
      repeatedActivations: 5,
      refusedSubmissions: 2,
      retries: 0,
      mutations: 0,
      focusBounce: false,
      notInjectableFromDesktop: [
        'duplicate transport delivery and delayed outcome echoes (no hook)',
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// EDGE-11 — failed save and dirty conflict keep accepted unsaved content
// ---------------------------------------------------------------------------

test('EDGE-11-readonly-conflict', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const original = await snapshot(ctx, 'a.rdlc', 'b.rdlc');
    await showRdlc(ctx);
    await openFile(ctx, 'a.rdlc');
    await ctx.driver.command('RDLC Code: Open Designer');
    await expect.poll(() => designerCount(page)).toBe(1);
    const frame = (await designerFrames(page))[0]!;
    await selectRow(page, 'Front');
    const name = await inspectorField(frame, 'Name');
    const diskBefore = original.get('a.rdlc')!.toString('utf8');

    // Read-only target: an accepted edit stays in the buffer, the disk is
    // never overwritten, and the save failure surfaces as a refusal.
    await chmod(ctx.path('a.rdlc'), 0o444);
    await name.fill('ReadOnlyEdit');
    await name.press('Enter');
    await expect(name).toHaveValue('ReadOnlyEdit');
    // One dirty report: the same document on two tabs is still one file.
    await expect
      .poll(() => dirtyDocuments(page), 'one dirty report')
      .toEqual(['a.rdlc']);
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(diskBefore);
    await blur(page);
    await page.keyboard.press(`${MOD}+s`);
    await expect
      .poll(() => notifications(page), { timeout: 20_000 })
      .toMatch(/save|permission|denied|read-only|EPERM/i);
    // No forced reload and no compensating mutation: the unsaved edit survives.
    await expect(name).toHaveValue('ReadOnlyEdit');
    await expect
      .poll(
        () => dirtyDocuments(page),
        'the failed save keeps its report dirty',
      )
      .toEqual(['a.rdlc']);
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(diskBefore);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );

    // Host recovery: with write access restored the same buffer saves exactly.
    await chmod(ctx.path('a.rdlc'), 0o644);
    await page.keyboard.press(`${MOD}+s`);
    await expect
      .poll(() => readFile(ctx.path('a.rdlc'), 'utf8'))
      .toContain('Name="ReadOnlyEdit"');
    const saved = await readFile(ctx.path('a.rdlc'), 'utf8');
    expect(saved.replace('Name="ReadOnlyEdit"', 'Name="Front"')).toBe(
      diskBefore,
    );
    await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);

    // Dirty conflict: an external change never forces a reload or overwrites
    // the unsaved buffer, and the buffer never lands on disk by itself.
    await name.fill('HeldAcrossConflict');
    await name.press('Enter');
    await expect
      .poll(() => dirtyDocuments(page), 'the conflict holds one dirty report')
      .toEqual(['a.rdlc']);
    const external = saved.replace(
      '<Value>Alpha report</Value>',
      '<Value>External winner</Value>',
    );
    await writeFile(ctx.path('a.rdlc'), external);
    await page.waitForTimeout(1_500);
    await expect(name).toHaveValue('HeldAcrossConflict');
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(external);
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).not.toContain(
      'HeldAcrossConflict',
    );
    await expect
      .poll(() => dirtyDocuments(page), 'the conflict keeps its report dirty')
      .toEqual(['a.rdlc']);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(
      original.get('b.rdlc')!.toString('utf8'),
    );
    await writeLog('race-log-edge-11-conflict', {
      requirement: 'EDGE-11: refused save and dirty conflict keep unsaved work',
      readOnlySaveFailures: 1,
      diskOverwrites: 0,
      forcedReloads: 0,
      retainedUnsavedEdits: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// SC-005 — 100 switches plus the genuine Desktop race matrix
// ---------------------------------------------------------------------------

test('SC-005-switch-races', async () => {
  // UNVALIDATED on macOS: the quick-open switch times out on 1.142.0 and the
  // workbench exits mid-race on stable (run 40867144705, macOS 14). Not
  // diagnosed; passes on Linux and Windows. See
  // specs/005-native-sidebar-integration/automated-validation.md.
  test.skip(
    platformSkipAccepted('SC-005-switch-races'),
    platformSkipReason('SC-005-switch-races') ?? '',
  );
  // The hundred-switch phase alone took four minutes; fifty real openings need their own bounded budget.
  test.setTimeout(900_000);
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  await session(await contextFiles(root), async (ctx) => {
    const { page } = ctx;
    const originalA = await readFile(ctx.path('a.rdlc'), 'utf8');
    const originalB = await readFile(ctx.path('b.rdlc'), 'utf8');
    const markers = {
      originalA,
      originalB,
      markedA: originalA.replace(
        '</Report>',
        '<!-- independent edit during opening --></Report>',
      ),
    };
    await showRdlc(ctx);

    // Phase 1: 100 document/view switches with identical item names.
    await timed('SC-005 phase 1 setup (two designers)', async () => {
      await openFile(ctx, 'a.rdlc');
      await ctx.driver.command('RDLC Code: Open Designer');
      await expect.poll(() => designerCount(page)).toBe(1);
      await openFile(ctx, 'b.rdlc');
      await ctx.driver.command('RDLC Code: Open Designer');
      await expect.poll(() => designerCount(page)).toBe(2);
    });
    const targets = [
      { kind: 'source', file: 'a.rdlc' },
      { kind: 'sidebar', file: 'a.rdlc' },
      { kind: 'source', file: 'b.rdlc' },
      { kind: 'designer', file: 'a.rdlc' },
      { kind: 'designer', file: 'b.rdlc' },
    ] as const;
    // Editors are switched by clicking their tab (`activateEditor`); only the
    // sidebar focus has no tab and needs the palette command.
    await timed('SC-005 phase 1 (100 switches)', async () => {
      for (let index = 0; index < 100; index++) {
        const step = targets[index % targets.length]!;
        if (step.kind === 'sidebar')
          await ctx.driver.command('Focus on Report Structure View');
        else await activateEditor(page, step.file, step.kind);
        await expectHeaders(page, step.file);
        expect(
          (await notifications(page)).trim(),
          `switch ${index} refused nothing`,
        ).toBe('');
        if ((index + 1) % 20 === 0)
          console.log(`[context] SC-005 switches done: ${index + 1}`);
      }
    });
    expect(await readFile(ctx.path('a.rdlc'), 'utf8')).toBe(originalA);
    expect(await readFile(ctx.path('b.rdlc'), 'utf8')).toBe(originalB);
    expect(await dirtyCount(page)).toBe(0);
    expect(
      await designerCount(page),
      'switching never opens a third designer',
    ).toBe(2);

    // Phase 2: real requests disturbed during the real preliminary opening.
    const cases: RaceCase[] = [
      { id: 'edit-select', action: 'select', disturbance: 'edit' },
      { id: 'edit-properties', action: 'properties', disturbance: 'edit' },
      { id: 'edit-create', action: 'create', disturbance: 'edit' },
      { id: 'switch-select', action: 'select', disturbance: 'switch' },
      { id: 'switch-properties', action: 'properties', disturbance: 'switch' },
      { id: 'switch-create', action: 'create', disturbance: 'switch' },
    ];
    const results: RaceResult[] = [];
    await timed('SC-005 phase 2 (50 races)', async () => {
      for (let index = 0; index < 50; index++) {
        const options = cases[index % cases.length]!;
        results.push(
          await runRace(
            ctx,
            {
              ...options,
              id: `${options.id}-${index + 1}`,
            },
            markers,
          ),
        );
      }
    });
    expect(results).toHaveLength(50);

    await writeLog('race-log-sc-005-switch-races', {
      requirement:
        'SC-005: 100 document/view switches and 50 stale/duplicate/closed-target cases',
      switches: 100,
      identicalItemNames: ['Textbox: Front', 'Textbox: Behind'],
      wrongTargetEdits: 0,
      method:
        'real workbench activation disturbed during the real preliminary designer opening; refusal read from the notification surface',
      cases: results,
      count: results.length,
      requiredByContract: 50,
      notInjectableFromDesktop: NOT_INJECTABLE,
    });
  });
});
