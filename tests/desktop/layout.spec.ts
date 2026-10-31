/**
 * Feature 005 US6 (AT-08): gesture-safe layout and interface scaling on a
 * real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage.json
 * (`tests/desktop/layout.spec.ts::<title>`). Geometry is read continuously
 * with `requestAnimationFrame` from the live designer DOM while real pointer
 * and keyboard gestures run; the canvas origin is measured in the designer
 * frame's own coordinate space and converted to screen (device) pixels. No
 * screenshot or synthetic event stands in for a gesture, and a capability the
 * driver cannot produce is reported as an explicit coverage gap instead of
 * being asserted as covered.
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
import { dirname, join, resolve } from 'node:path';
import {
  launchTrustedDesktop,
  openContextMenuWithKeyboard,
  setQuickInputText,
  type DesktopDriver,
} from './driver.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const DRIFT_BUDGET_DEVICE_PX = 1;
const PLACEMENT_BUDGET_PT = 0.01;
const NUDGE_STEPS = 40;

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

interface FrameSample {
  readonly t: number;
  readonly left: number;
  readonly top: number;
  readonly dpr: number;
}

interface Scale {
  readonly dpr: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

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

/** Fresh trusted window over a temp copy of the fixtures, always cleaned up. */
async function session(
  files: Files,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'layout',
  );
  await mkdir(artifacts, { recursive: true });
  await mkdir(resolve(root, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(root, '.vscode-test/sidebar-layout-'));
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
      'Layout session and cleanup failed',
    );
  if (failed) throw failure;
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

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

/**
 * Run the quick-input row whose text actually contains `label`. The first row
 * is only a ranking (recency can win), so focus travels with ArrowDown until
 * the input's `aria-activedescendant` names that exact row before Enter.
 */
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
  await expect(target, `quick-input result ${label} ran`).toBeHidden();
}

/** Palette round trip plus the quick-pick selections some commands require. */
async function palettePicks(
  page: Page,
  command: string,
  picks: readonly string[] = [],
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
  await setQuickInputText(input, `>${command}`);
  await chooseQuickResult(page, command);
  for (const pick of picks) {
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await setQuickInputText(input, pick);
    await chooseQuickResult(page, pick);
  }
  await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
}

const palette = (page: Page, command: string, frame?: Frame) =>
  palettePicks(page, command, [], frame);

async function openReport(ctx: Ctx, name: string): Promise<void> {
  await blur(ctx.page);
  await ctx.page.keyboard.press(`${MOD}+p`);
  const quickOpen = ctx.page.locator(
    '.quick-input-widget:visible .quick-input-box input',
  );
  await quickOpen.waitFor({ state: 'visible' });
  await setQuickInputText(quickOpen, ctx.path(name));
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

/* ------------------------------------------------------------------ *
 * Continuous frame sampling (requestAnimationFrame, never endpoints)
 * ------------------------------------------------------------------ */

async function startSampling(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const holder = window as unknown as {
      __rdlcOriginSamples?: {
        running: boolean;
        samples: FrameSample[];
      };
    };
    if (holder.__rdlcOriginSamples?.running) return;
    const state = { running: true, samples: [] as FrameSample[] };
    holder.__rdlcOriginSamples = state;
    const tick = () => {
      if (!state.running) return;
      const target = document.querySelector('.canvas-frame');
      if (target) {
        const rect = target.getBoundingClientRect();
        state.samples.push({
          t: performance.now(),
          left: rect.left,
          top: rect.top,
          dpr: window.devicePixelRatio,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function sampleCount(frame: Frame): Promise<number> {
  return frame.evaluate(
    () =>
      (window as unknown as { __rdlcOriginSamples?: { samples: unknown[] } })
        .__rdlcOriginSamples?.samples.length ?? 0,
  );
}

async function stopSampling(frame: Frame): Promise<FrameSample[]> {
  return frame.evaluate(() => {
    const state = (
      window as unknown as {
        __rdlcOriginSamples?: { running: boolean; samples: FrameSample[] };
      }
    ).__rdlcOriginSamples;
    if (!state) return [];
    state.running = false;
    return state.samples;
  });
}

/** Maximum unintended origin displacement of a sample slice, in device px. */
function drift(
  samples: readonly FrameSample[],
  from = 0,
  to = samples.length,
): { readonly devicePx: number; readonly count: number } {
  const slice = samples.slice(from, to);
  if (!slice.length) return { devicePx: 0, count: 0 };
  const base = slice[0]!;
  let maximum = 0;
  for (const sample of slice)
    maximum =
      Math.max(
        maximum,
        Math.abs(sample.left - base.left),
        Math.abs(sample.top - base.top),
      ) * sample.dpr;
  return { devicePx: maximum, count: slice.length };
}

/** Body-relative point of the primary item, in CSS pixels. */
async function primaryBounds(
  frame: Frame,
): Promise<{ left: number; top: number }> {
  return frame.locator('.item.primary').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const body = element.parentElement!.getBoundingClientRect();
    return { left: bounds.left - body.left, top: bounds.top - body.top };
  });
}

async function acceptedGeometry(frame: Frame): Promise<string> {
  const text = await frame
    .locator('p[aria-label="Accepted item geometry"]')
    .textContent();
  return text?.replace(/\s+/g, ' ').trim() ?? '';
}

/** LaterTie covers Front in this fixture; use the real pointer's topmost target. */
const topItem = (frame: Frame) => frame.locator('.item[data-item="2"]');

/** Compact status text may collapse; check accessibility and record its actual box. */
async function readStatus(
  frame: Frame,
  label: string,
): Promise<{ message: string; box: { width: number; height: number } | null }> {
  await expect(
    frame.locator('rdlc-editor'),
    `${label}: the designer is live in its frame`,
  ).toBeVisible();
  await expect(
    frame.locator('footer.status'),
    `${label}: the status row stays rendered`,
  ).toBeVisible();
  const status = frame.locator('.status-text');
  await expect(status, `${label}: one status region`).toHaveCount(1);
  await expect(
    status,
    `${label}: the status region announces itself`,
  ).toHaveAttribute('role', 'status');
  const message =
    (await status.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
  expect(message, `${label}: the status message is populated`).not.toBe('');
  expect(
    await frame.locator('footer.status').ariaSnapshot(),
    `${label}: the status message stays accessible`,
  ).toContain(message);
  const box = await status.boundingBox();
  return { message, box: box && { width: box.width, height: box.height } };
}

const dirtyCount = (page: Page) =>
  page.locator('.monaco-workbench .tab.dirty').count();

const viewportScroll = (frame: Frame) =>
  frame
    .locator('.viewport')
    .evaluate((element) => [element.scrollLeft, element.scrollTop] as const);

/* ------------------------------------------------------------------ *
 * Actual window resize and actual interface scale
 * ------------------------------------------------------------------ */

const readScale = (page: Page): Promise<Scale> =>
  page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));

async function observedScale(
  page: Page,
  base: Scale,
): Promise<{ scale: number; viewportScale: number }> {
  const current = await readScale(page);
  return {
    scale: current.dpr / base.dpr,
    viewportScale: base.innerWidth / current.innerWidth,
  };
}

/**
 * Resize the host viewport through Playwright or the public window API.
 * `method` distinguishes viewport emulation from window.resizeTo and stays
 * null when neither changes the viewport, which the caller reports as a
 * coverage gap rather than a pass.
 */
async function resizeWindow(
  page: Page,
  delta: number,
): Promise<{ before: Scale; after: Scale; method: string | null }> {
  const before = await readScale(page);
  let method: string | null = 'page.setViewportSize';
  try {
    await page.setViewportSize({
      width: before.innerWidth + delta,
      height: before.innerHeight,
    });
  } catch {
    method = null;
  }
  let after = await readScale(page);
  if (after.innerWidth === before.innerWidth) {
    method = 'window.resizeTo';
    await page
      .evaluate(() => {
        window.resizeTo(window.outerWidth + delta, window.outerHeight);
      })
      .catch(() => {});
    after = await readScale(page);
  }
  if (after.innerWidth === before.innerWidth) method = null;
  return { before, after, method };
}

/** Write `window.zoomLevel` into the disposable profile's own user settings. */
async function setUserZoom(
  profileDir: string,
  zoomLevel: number,
): Promise<void> {
  const file = join(profileDir, 'User', 'settings.json');
  await mkdir(dirname(file), { recursive: true });
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(file, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    // A fresh profile has no user settings file yet.
  }
  settings['window.zoomLevel'] = zoomLevel;
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

const wait = async (
  page: Page,
  base: Scale,
  wanted: number,
  timeoutMs: number,
) => {
  const deadline = Date.now() + timeoutMs;
  let reading = await observedScale(page, base);
  while (Date.now() < deadline && Math.abs(reading.scale - wanted) > 0.005) {
    await new Promise<void>((done) => setTimeout(done, 250));
    reading = await observedScale(page, base);
  }
  return reading;
};

/**
 * Reach `target` interface scale and prove it from the live window: the device
 * pixel ratio and the viewport must both show it. The zoom-level mapping is
 * measured with a real zoom step, never assumed; if no public mechanism lands
 * on the exact target the caller reports a coverage gap.
 */
async function reachScale(
  ctx: Ctx,
  target: number,
): Promise<{ scale: number; viewportScale: number; level: number }> {
  const { page } = ctx;
  const base = await readScale(page);
  await palette(page, 'View: Zoom In');
  await expect
    .poll(async () => (await readScale(page)).dpr, {
      message: 'View: Zoom In changes the observed device pixel ratio',
    })
    .not.toBe(base.dpr);
  const perLevel = (await readScale(page)).dpr / base.dpr;
  await palette(page, 'View: Zoom Out');
  await expect
    .poll(async () => (await readScale(page)).dpr, {
      message: 'View: Zoom Out restores the observed baseline',
    })
    .toBe(base.dpr);

  const observed: number[] = [];
  const level = Math.log(target) / Math.log(perLevel);
  await setUserZoom(ctx.driver.profileDir, level);
  let reading = await wait(page, base, target, 15_000);
  observed.push(reading.scale);
  if (Math.abs(reading.scale - target) > 0.005) {
    // Fall back to the public zoom commands and record what they can reach.
    for (let step = 0; step < 6; step++) {
      await palette(page, 'View: Zoom In');
      reading = await wait(page, base, target, 2_000);
      observed.push(reading.scale);
      if (Math.abs(reading.scale - target) <= 0.005) break;
    }
  }
  if (Math.abs(reading.scale - target) > 0.005)
    throw new Error(
      `coverage gap: the driver cannot reach exactly ${target * 100}% interface scale. ` +
        `Observed scales: ${observed.map((value) => value.toFixed(4)).join(', ')} ` +
        `(one View: Zoom In step measured ${perLevel.toFixed(4)}; window.zoomLevel ${level.toFixed(4)} was written to the profile).`,
    );
  expect(
    Math.abs(reading.viewportScale - target),
    'the viewport and the device pixel ratio agree on the observed scale',
  ).toBeLessThanOrEqual(0.01);
  return { ...reading, level };
}

async function restoreScale(ctx: Ctx, base: Scale): Promise<number> {
  await setUserZoom(ctx.driver.profileDir, 0);
  let reading = await wait(ctx.page, base, 1, 15_000);
  if (Math.abs(reading.scale - 1) > 0.005) {
    // The settings path did not land: walk back with the public commands.
    for (
      let step = 0;
      step < 6 && Math.abs(reading.scale - 1) > 0.005;
      step++
    ) {
      await palette(ctx.page, 'View: Zoom Out');
      reading = await wait(ctx.page, base, 1, 2_000);
    }
  }
  return reading.scale;
}

/* ------------------------------------------------------------------ *
 * Real gestures
 * ------------------------------------------------------------------ */

/** Drag the native side bar's real sash; reports the observed width change. */
async function resizeNativeSidebar(
  page: Page,
  delta: number,
): Promise<{ before: number; after: number }> {
  const sidebar = await page.locator('.part.sidebar').boundingBox();
  expect(sidebar, 'the native side bar reports bounds').not.toBeNull();
  const x = sidebar!.x + sidebar!.width;
  const y = sidebar!.y + sidebar!.height / 2;
  // Proximity first: the native sash arms its hit area on hover.
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 12 });
  await page.mouse.up();
  const after = await page.locator('.part.sidebar').boundingBox();
  expect(after).not.toBeNull();
  return { before: sidebar!.width, after: after!.width };
}

/** Real marquee drag over empty body space. */
async function marquee(page: Page, frame: Frame): Promise<void> {
  const body = await frame.locator('.body').boundingBox();
  expect(body, 'the report body reports bounds').not.toBeNull();
  const x = body!.x + body!.width - 12;
  const y = body!.y + body!.height - 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 64, y - 40, { steps: 8 });
  await page.mouse.up();
}

/** Real movement drag of the primary item by `dx` body-relative pixels. */
async function dragPrimary(frame: Frame, dx: number): Promise<void> {
  const item = frame.locator('.item.primary');
  await expect(item).toHaveCount(1);
  const box = await item.boundingBox();
  const body = await frame.locator('.body').boundingBox();
  expect(box).not.toBeNull();
  expect(body).not.toBeNull();
  const relative = await primaryBounds(frame);
  await item.dragTo(frame.locator('.body'), {
    targetPosition: {
      x: relative.left + box!.width / 2 + dx,
      y: relative.top + box!.height / 2,
    },
  });
}

/** Real resize gesture on the primary item's south-east handle. */
async function resizePrimary(
  page: Page,
  frame: Frame,
  offset: number,
): Promise<void> {
  const handle = frame.locator('.handle[data-handle="se"]');
  await expect(handle).toHaveCount(1);
  // The handle is re-rendered while the host applies the previous commit, and
  // is disabled until that edit settles: measure it once it is laid out.
  await expect(handle).toBeVisible();
  await expect(handle).toBeEnabled();
  const box = await handle.boundingBox();
  expect(box, 'the resize handle has a layout box').not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + offset,
    box!.y + box!.height / 2 + offset,
    { steps: 6 },
  );
  await page.mouse.up();
}

/**
 * Hold a real canvas gesture, resize the host viewport while the pointer is
 * still down, release, and prove that nothing was committed: no new dirty tab,
 * the accepted geometry string is unchanged, the item sits where it started
 * and the report bytes are untouched. The live movement is read on the
 * product's preview overlay: a move gesture keeps the item on its accepted
 * bounds until release and draws the proposal on `.preview`.
 */
async function assertCancelledResize(
  source: Buffer,
  ctx: Ctx,
  frame: Frame,
): Promise<{ method: string | null; afterSamples: number }> {
  const { page } = ctx;
  const item = frame.locator('.item.primary');
  await expect(item).toHaveCount(1);
  // The canvas may recenter its scroll on a host resize, so the accepted place
  // is read relative to the report body, not in client coordinates.
  const bodyRelativeX = async () => {
    const [own, body] = [
      await item.boundingBox(),
      await frame.locator('.body').boundingBox(),
    ];
    return own && body ? own.x - body.x : Number.NaN;
  };
  // A host layout change may have scrolled it out of the webview; pressing
  // its off-screen box would land on workbench chrome instead.
  await item.scrollIntoViewIfNeeded();
  const beforeOffset = await bodyRelativeX();
  const beforeBox = await item.boundingBox();
  const beforeAccepted = await acceptedGeometry(frame);
  const beforeDirty = await dirtyCount(page);
  expect(beforeBox).not.toBeNull();
  expect(beforeAccepted).not.toBe('');

  await page.mouse.move(
    beforeBox!.x + beforeBox!.width / 2,
    beforeBox!.y + beforeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeBox!.x + beforeBox!.width / 2 + 40,
    beforeBox!.y + beforeBox!.height / 2 + 24,
    { steps: 8 },
  );
  const preview = frame.locator('.preview');
  await expect(
    preview,
    'the held pointer really runs a live move gesture',
  ).toHaveCount(1);
  const duringBox = await preview.boundingBox();
  expect(duringBox).not.toBeNull();
  expect(
    Math.abs(duringBox!.x - beforeBox!.x) +
      Math.abs(duringBox!.y - beforeBox!.y),
    'the live preview follows the pointer before the resize',
  ).toBeGreaterThan(4);

  const resize = await resizeWindow(page, 160);
  if (!resize.method) {
    await page.mouse.up();
    throw new Error(
      'coverage gap: neither page.setViewportSize nor window.resizeTo changed the live window, ' +
        'so host viewport resize cancellation cannot be exercised from this driver.',
    );
  }
  // The webview learns of the resize through a ResizeObserver, asynchronously.
  // Releasing before it ran would commit the move instead of cancelling it
  // (observed on Linux 1.142.0), so the cancellation must be seen first.
  await expect(
    preview,
    'the host resize withdraws the held gesture before the pointer is released',
  ).toHaveCount(0);
  await page.mouse.up();
  await expect(
    preview,
    'the cancelled preview is withdrawn instead of applied',
  ).toHaveCount(0);
  await expect
    .poll(bodyRelativeX, {
      timeout: 10_000,
      message: 'the cancelled preview returns the item to its accepted place',
    })
    .toBeCloseTo(beforeOffset, 0);

  expect(await dirtyCount(page), 'no edit was committed').toBe(beforeDirty);
  expect(await acceptedGeometry(frame)).toBe(beforeAccepted);
  expect(
    (await readFile(ctx.path('gesture.rdlc'))).equals(source),
    'the report bytes are untouched by the cancelled preview',
  ).toBe(true);
  return { method: resize.method, afterSamples: await sampleCount(frame) };
}

async function writeRecord(
  ctx: Ctx,
  name: string,
  record: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    join(ctx.artifacts, name),
    `${JSON.stringify({ schemaVersion: 1, ...record }, null, 2)}\n`,
  );
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

test('FR-028-scaling', async () => {
  await session(
    { 'scaling.rdlc': { fixture: 'textbox-supported' } },
    async (ctx) => {
      const { page } = ctx;
      const base = await readScale(page);
      expect(base.dpr).toBeGreaterThan(0);
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'scaling.rdlc');
      const frame = await openDesigner(ctx);
      await expect(frame.locator('rdlc-editor')).toBeVisible();
      const canvasAt100 = await frame.locator('.canvas-frame').boundingBox();
      expect(canvasAt100).not.toBeNull();

      const at200 = await reachScale(ctx, 2);
      const statusAt200 = await readStatus(frame, '200%');
      await expect(page.locator('.part.sidebar')).toBeVisible();
      await expect(page.locator('.part.statusbar')).toBeVisible();
      const canvasAt200 = await frame.locator('.canvas-frame').boundingBox();
      expect(canvasAt200).not.toBeNull();
      // The report zoom is independent of the interface scale.
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');

      const restored = await restoreScale(ctx, base);
      expect(
        Math.abs(restored - 1),
        'the interface scale returns to the launched baseline',
      ).toBeLessThanOrEqual(0.005);
      await writeRecord(ctx, 'fr-028-scaling.json', {
        assertion: 'tests/desktop/layout.spec.ts::FR-028-scaling',
        baseline: base,
        observedAt200: at200,
        statusAt200,
        restoredScale: restored,
        canvasAt100,
        canvasAt200,
      });
      await ctx.driver.capture('fr-028-scaling');
    },
  );
});

test('US6.2-interface-scaling', async () => {
  await session(
    { 'scaling.rdlc': { fixture: 'textbox-supported' } },
    async (ctx) => {
      const { page } = ctx;
      const base = await readScale(page);
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'scaling.rdlc');
      const frame = await openDesigner(ctx);

      const observe = async (label: string) => {
        const headers = await page
          .locator('.part.sidebar .pane-header')
          .allTextContents();
        const activityTabs = await page
          .locator('.activitybar')
          .getByRole('tab', { name: /^RDLC Code/ })
          .count();
        const frameBox = await frame.locator('rdlc-editor').boundingBox();
        const canvasBox = await frame.locator('.canvas-frame').boundingBox();
        const scale = await observedScale(page, base);
        expect(activityTabs, `${label}: the RDLC Code activity item`).toBe(1);
        for (const view of ['Report Structure', 'Report Data', 'Components'])
          expect(
            headers.some((text) => text.includes(view)),
            `${label}: ${view} keeps its pane header`,
          ).toBe(true);
        expect(frameBox, `${label}: designer frame bounds`).not.toBeNull();
        expect(frameBox!.width).toBeGreaterThan(0);
        expect(canvasBox, `${label}: canvas bounds`).not.toBeNull();
        expect(canvasBox!.width).toBeGreaterThan(0);
        const status = await readStatus(frame, label);
        await expect(
          frame.getByRole('spinbutton', { name: 'Zoom percent' }),
        ).toHaveValue('100');
        return { scale, headers, canvasBox, status };
      };

      const at100 = await observe('100%');
      expect(Math.abs(at100.scale.scale - 1)).toBeLessThanOrEqual(0.005);
      const at200 = await reachScale(ctx, 2);
      const observed200 = await observe('200%');
      expect(Math.abs(observed200.scale.scale - 2)).toBeLessThanOrEqual(0.005);
      const restored = await restoreScale(ctx, base);
      expect(Math.abs(restored - 1)).toBeLessThanOrEqual(0.005);

      await writeRecord(ctx, 'us6-2-interface-scaling.json', {
        assertion: 'tests/desktop/layout.spec.ts::US6.2-interface-scaling',
        baseline: base,
        at100,
        at200: { ...at200, observed: observed200 },
        restoredScale: restored,
      });
      await ctx.driver.capture('us6-2-interface-scaling');
    },
  );
});

test('US6.3-frame-stability', async () => {
  await session(
    { 'gesture.rdlc': { fixture: 'interactive-mixed' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await readFile(ctx.path('gesture.rdlc'));
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'gesture.rdlc');
      const frame = await openDesigner(ctx);
      await topItem(frame).click();
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      expect(await acceptedGeometry(frame)).not.toBe('');

      await startSampling(frame);
      const phases: Record<string, unknown> = {};

      // A. Native view movement through the public command (keyboard only).
      const fromA = await sampleCount(frame);
      await palettePicks(page, 'View: Move View', [
        'Components',
        'New Panel Entry',
      ]);
      await expect(
        page
          .locator('.part.panel .pane-header')
          .filter({ hasText: 'Components' }),
      ).toHaveCount(1);
      await page.waitForTimeout(500);
      await expect(
        frame.locator('.item.primary'),
        'moving a native view keeps the designer active',
      ).toBeVisible();
      phases.nativeViewMovement = { from: fromA, to: await sampleCount(frame) };

      // B. Native view resizing through the real side bar sash.
      const fromB = await sampleCount(frame);
      const width = await resizeNativeSidebar(page, -120);
      expect(
        Math.abs(width.after - width.before),
        'the native side bar really resized',
      ).toBeGreaterThan(32);
      await page.waitForTimeout(500);
      await expect(
        frame.locator('.item.primary'),
        'resizing the native side bar keeps the designer active',
      ).toBeVisible();
      phases.nativeViewResize = {
        from: fromB,
        to: await sampleCount(frame),
        observed: width,
      };

      // C. Unavoidable window resize in the middle of a live canvas gesture.
      // The preview must be cancelled before the frame is remeasured, so this
      // phase asserts commits, not origin stability.
      const fromC = await sampleCount(frame);
      const cancelled = await assertCancelledResize(original, ctx, frame);
      await page.waitForTimeout(500);

      const samples = await stopSampling(frame);
      expect(
        samples.length,
        'the frame series really sampled frames',
      ).toBeGreaterThanOrEqual(cancelled.afterSamples);
      for (const [phase, value] of Object.entries(phases)) {
        // Each phase is judged on its own frames: the later cancellation phase
        // deliberately recenters the canvas after a host resize.
        const { from, to } = value as { from: number; to: number };
        const entry = drift(samples, from, to);
        expect(
          entry.devicePx,
          `${phase}: unintended canvas origin drift within budget`,
        ).toBeLessThanOrEqual(DRIFT_BUDGET_DEVICE_PX);
        expect(entry.count).toBeGreaterThan(0);
        (value as { drift: unknown }).drift = entry;
      }
      phases.resizeCancellation = {
        from: fromC,
        method: cancelled.method,
        observedDrift: drift(samples, fromC),
        committed: false,
      };
      expect(
        (await readFile(ctx.path('gesture.rdlc'))).equals(original),
        'stability work never rewrites the report',
      ).toBe(true);

      await writeRecord(ctx, 'us6-3-frame-samples.json', {
        assertion: 'tests/desktop/layout.spec.ts::US6.3-frame-stability',
        budgetDevicePx: DRIFT_BUDGET_DEVICE_PX,
        phases,
        totalSamples: samples.length,
        samples,
      });
      await ctx.driver.capture('us6-3-frame-stability');
    },
  );
});

test('SC-007-stability', async () => {
  await session(
    { 'gesture.rdlc': { fixture: 'interactive-mixed' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await readFile(ctx.path('gesture.rdlc'));
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'gesture.rdlc');
      const frame = await openDesigner(ctx);
      const item = topItem(frame);
      await item.click();
      await expect(frame.locator('.item.primary')).toHaveCount(1);

      await startSampling(frame);
      // The unavoidable resize case first, on a clean document: zero commits
      // is only meaningful while nothing else is dirty.
      const cancelled = await assertCancelledResize(original, ctx, frame);
      expect(await dirtyCount(page)).toBe(0);

      const counts = { nudge: 0, marquee: 0, move: 0, resize: 0 };

      // 40 keyboard nudges: 40pt of retained movement, exactly.
      await frame.locator('.viewport').focus();
      // Each press is one committed nudge, and input arriving while an edit is
      // pending is refused by design: wait for every step to be applied.
      // Accepted pt geometry: rendered boxes are quantized to 1/64 px, which is
      // coarser than the 0.01pt placement budget.
      const acceptedLeft = async () =>
        Number(/left ([0-9.]+)pt/.exec(await acceptedGeometry(frame))?.[1]);
      const startLeft = await acceptedLeft();
      expect(startLeft, 'accepted left is published in pt').not.toBeNaN();
      const movedBy = async () => (await acceptedLeft()) - startLeft;
      for (let step = 0; step < NUDGE_STEPS; step++) {
        await page.keyboard.press('ArrowRight');
        counts.nudge++;
        await expect
          .poll(movedBy, { message: `nudge ${step + 1} applied` })
          .toBeCloseTo(step + 1, 2);
      }
      const movedPt = await movedBy();
      expect(
        Math.abs(movedPt - NUDGE_STEPS),
        `${NUDGE_STEPS} nudges retain ${NUDGE_STEPS}pt of movement`,
      ).toBeLessThanOrEqual(PLACEMENT_BUDGET_PT);

      // 30 marquee drags over empty body space.
      for (let step = 0; step < 30; step++) {
        await marquee(page, frame);
        counts.marquee++;
      }

      // 20 movement drags: 10 out and 10 back.
      await item.click();
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      for (let step = 0; step < 10; step++) {
        await dragPrimary(frame, 6);
        counts.move++;
      }
      for (let step = 0; step < 10; step++) {
        await dragPrimary(frame, -6);
        counts.move++;
      }

      // 10 handle resizes: 5 grow and 5 shrink.
      await item.click();
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      for (let step = 0; step < 5; step++) {
        await resizePrimary(page, frame, 6);
        counts.resize++;
      }
      for (let step = 0; step < 5; step++) {
        await resizePrimary(page, frame, -6);
        counts.resize++;
      }

      const total = Object.values(counts).reduce(
        (sum, value) => sum + value,
        0,
      );
      expect(total, 'the frame series covers 100 real interactions').toBe(100);
      await page.waitForTimeout(500);
      const samples = await stopSampling(frame);
      const series = drift(samples);
      expect(
        series.devicePx,
        'unintended canvas origin drift across 100 interactions',
      ).toBeLessThanOrEqual(DRIFT_BUDGET_DEVICE_PX);
      expect(series.count).toBeGreaterThan(100);
      expect(
        (await readFile(ctx.path('gesture.rdlc'))).equals(original),
        'the interaction series never rewrites the report on its own',
      ).toBe(true);

      await writeRecord(ctx, 'frame-samples.json', {
        assertion: 'tests/desktop/layout.spec.ts::SC-007-stability',
        budgetDevicePx: DRIFT_BUDGET_DEVICE_PX,
        placementBudgetPt: PLACEMENT_BUDGET_PT,
        counts,
        nudgedPt: movedPt,
        resizeMethod: cancelled.method,
        drift: series,
        samples,
      });
      await ctx.driver.capture('sc-007-stability');
    },
  );
});

test('FR-029-stability', async () => {
  await session(
    { 'gesture.rdlc': { fixture: 'interactive-mixed' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await readFile(ctx.path('gesture.rdlc'));
      await palette(page, 'View: Show RDLC Code');
      await openReport(ctx, 'gesture.rdlc');
      const frame = await openDesigner(ctx);
      const item = topItem(frame);
      await item.click();
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      const acceptedBefore = await acceptedGeometry(frame);
      const scrollBefore = await viewportScroll(frame);
      expect(acceptedBefore).not.toBe('');

      await startSampling(frame);
      const fromMenu = await sampleCount(frame);

      // The canvas context menu is an overlay: it must not move the canvas.
      const body = await frame.locator('.body').boundingBox();
      expect(body).not.toBeNull();
      // The body can extend past the visible canvas (a short window clips it,
      // and a click there lands on the inspector or below the window): aim at
      // the bottom-right of the part of the body the viewport actually shows,
      // clear of the scrollbars.
      const visible = await frame.locator('.viewport').boundingBox();
      expect(visible).not.toBeNull();
      await page.mouse.click(
        Math.min(body!.x + body!.width, visible!.x + visible!.width) - 24,
        Math.min(body!.y + body!.height, visible!.y + visible!.height) - 24,
        {
          button: 'right',
        },
      );
      await expect(
        frame.getByRole('menu', { name: 'Canvas actions' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        frame.getByRole('menu', { name: 'Canvas actions' }),
      ).toBeHidden();
      const afterCanvasMenu = await sampleCount(frame);

      // The native Shift+F10 menu is host chrome: same origin requirement.
      // A real row has to own the keyboard focus first, and only the menu the
      // context view opens counts: a page-wide menuitem also matches the menu
      // bar's File entry, which never closes.
      await palette(page, 'Focus on Report Structure View', frame);
      await page.keyboard.press('Home');
      await expect(
        page.locator('.part.sidebar .monaco-list-row.focused').first(),
        'a sidebar row owns the keyboard focus',
      ).toBeVisible();
      await openContextMenuWithKeyboard(page);
      const contextMenu = page
        .locator('.context-view')
        .getByRole('menuitem')
        .first();
      await expect(contextMenu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(contextMenu).toBeHidden();
      const afterNativeMenu = await sampleCount(frame);

      // A refusal notice appears in the feedback region without rebasing.
      await item.click();
      await expect(frame.locator('.item.primary')).toHaveCount(1);
      // The compact inspector overlay closed with the menus; reopen it.
      const properties = frame.getByRole('button', {
        name: 'Properties',
        exact: true,
      });
      if ((await properties.getAttribute('aria-expanded')) === 'false')
        await properties.click();
      const nameField = frame.getByRole('textbox', {
        name: 'Name',
        exact: true,
      });
      await expect(nameField).toBeVisible();
      await nameField.focus();
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.type('9 not a valid name!', { delay: 5 });
      await page.keyboard.press('Enter');
      await expect(frame.locator('#report-refusal')).toBeVisible();
      const afterRefusal = await sampleCount(frame);

      // Zoom out and back: accepted placement and scroll must survive.
      const zoom = frame.getByRole('spinbutton', { name: 'Zoom percent' });
      await zoom.fill('150');
      await zoom.press('Enter');
      await blur(page, frame);
      await expect.poll(() => zoom.inputValue()).toBe('150');
      await expect(frame.locator('.page')).not.toHaveCSS(
        'transform',
        'matrix(1, 0, 0, 1, 0, 0)',
      );
      await zoom.fill('100');
      await zoom.press('Enter');
      await blur(page, frame);
      await expect.poll(() => zoom.inputValue()).toBe('100');
      await expect
        .poll(async () => await viewportScroll(frame), {
          message: 'the viewport scroll survives the zoom round trip',
        })
        .toEqual(scrollBefore);

      const samples = await stopSampling(frame);
      for (const [phase, from] of [
        ['canvas-menu', fromMenu],
        ['native-menu', afterCanvasMenu],
        ['refusal', afterNativeMenu],
        ['zoom-round-trip', afterRefusal],
        ['whole-series', fromMenu],
      ] as const) {
        const entry = drift(samples, from);
        expect(
          entry.devicePx,
          `${phase}: the canvas origin does not move`,
        ).toBeLessThanOrEqual(DRIFT_BUDGET_DEVICE_PX);
        expect(entry.count).toBeGreaterThan(0);
      }

      await expect(
        frame.locator('p[aria-label="Accepted item geometry"]'),
      ).toContainText(acceptedBefore.replace(/^Accepted geometry: /, ''));
      expect(await dirtyCount(page), 'a refused edit stays uncommitted').toBe(
        0,
      );
      expect(
        (await readFile(ctx.path('gesture.rdlc'))).equals(original),
        'menus, notices and zoom never rewrite the report',
      ).toBe(true);

      await writeRecord(ctx, 'fr-029-frame-samples.json', {
        assertion: 'tests/desktop/layout.spec.ts::FR-029-stability',
        budgetDevicePx: DRIFT_BUDGET_DEVICE_PX,
        acceptedBefore,
        scrollBefore,
        totalSamples: samples.length,
        samples,
      });
      await ctx.driver.capture('fr-029-stability');
    },
  );
});
