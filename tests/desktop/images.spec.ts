/**
 * Feature 006 (embedded image authoring): the Image journeys on a real Desktop.
 *
 * Every test title is the executable assertion ID registered in coverage-006.json
 * (`tests/desktop/images.spec.ts::<title>`). Each test launches the real Desktop
 * binary in a disposable profile over a temp copy of manifest-listed fixtures,
 * drives the actual workbench and designer with real pointer and keyboard input,
 * and reads report bytes independently from disk. Expected sources are derived
 * from the fixture text and the picture files themselves, never from a production
 * parser, serializer or captured output.
 *
 * The file chooser is the real `showOpenDialog` integration: the profile enables
 * `files.simpleDialog.enable`, which renders it as a quick input, and
 * `chooseFile` types the absolute path of a fixture picture into it (research
 * R5). No test hook exists in the extension and no native OS dialog is driven.
 *
 * The default open associates `.rdlc` with the text editor, so every journey that
 * needs the canvas opens its own designer with `RDLC Code: Open Designer`.
 *
 * Pixel references for the sizing modes and the placeholder live in visual.spec.ts;
 * monitored offline and isolation journeys live in offline.spec.ts and
 * security-observer.spec.ts.
 */
import {
  test,
  expect,
  type Frame,
  type Locator,
  type Page,
} from 'playwright/test';
import { crc32 } from '@rdlc/report-model/image-data';
import { rawImageLimit } from '@rdlc/report-model/images';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  chooseFile,
  launchTrustedDesktop,
  openWorkspaceFile,
  setQuickInputText,
  type DesktopDriver,
} from './driver.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Drop point measured from the body origin: raw 262.5pt x 30pt, which the 10pt
 * grid snaps to 260pt x 30pt. Both are far from a grid boundary, so a one-pixel
 * pointer rounding cannot move the result.
 */
const DROP = { x: 350, y: 40 } as const;

/** Every sizing mode, as the inspector offers them. */
const SIZINGS = ['AutoSize', 'Fit', 'FitProportional', 'Clip'] as const;

// ---------------------------------------------------------------------------
// Session and workbench helpers (local, no shared framework)
// ---------------------------------------------------------------------------

type Files = Record<
  string,
  | { readonly fixture: string }
  | { readonly content: string }
  | { readonly bytes: Uint8Array }
>;

interface Ctx {
  readonly driver: DesktopDriver;
  readonly page: Page;
  readonly dir: string;
  readonly artifacts: string;
  path(name: string): string;
}

const root = (): string => process.env.RDLC_DESKTOP_ROOT ?? process.cwd();

const artifactDirectory = (): string =>
  resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'images',
  );

/** Resolve a manifest id to its fixture file; the manifest stays the oracle. */
async function fixturePath(id: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(resolve(root(), 'tests/fixtures/manifest.json'), 'utf8'),
  ) as {
    fixtures: { id: string; path: string; capabilities: readonly string[] }[];
  };
  const entry = manifest.fixtures.find((fixture) => fixture.id === id);
  if (!entry) throw new Error(`Unknown manifest fixture id: ${id}`);
  if (!entry.capabilities.includes('source'))
    throw new Error(`Fixture ${id} cannot be opened as report source`);
  return resolve(root(), 'tests/fixtures', entry.path);
}

const PICTURES = 'tests/fixtures/images/pictures';

/**
 * Fresh trusted window whose workspace folder is a temp copy of the given
 * reports plus the committed fixture pictures under `pictures/`. The profile
 * belongs to the driver and is removed by its close; the owned temp workspace
 * goes in both the passing and the failing case.
 */
async function session(
  files: Files,
  run: (ctx: Ctx) => Promise<void>,
): Promise<void> {
  const base = root();
  const artifacts = artifactDirectory();
  await mkdir(artifacts, { recursive: true });
  await mkdir(resolve(base, '.vscode-test'), { recursive: true });
  const dir = await mkdtemp(resolve(base, '.vscode-test/images-'));
  let driver: DesktopDriver | undefined;
  let failed = false;
  let failure: unknown;
  try {
    await mkdir(join(dir, 'pictures'), { recursive: true });
    for (const name of await readdir(resolve(base, PICTURES)))
      await copyFile(
        resolve(base, PICTURES, name),
        join(dir, 'pictures', name),
      );
    for (const [name, source] of Object.entries(files)) {
      const target = join(dir, name);
      await mkdir(dirname(target), { recursive: true });
      if ('fixture' in source)
        await copyFile(await fixturePath(source.fixture), target);
      else if ('content' in source) await writeFile(target, source.content);
      else await writeFile(target, source.bytes);
    }
    driver = await launchTrustedDesktop({
      root: base,
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
      'Images session and cleanup failed',
    );
  if (failed) throw failure;
  if (shutdown.length === 1) throw shutdown[0];
  if (shutdown.length)
    throw new AggregateError(shutdown, 'Desktop shutdown failed');
}

const literal = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Anchored, case-sensitive pane lookup (a plain substring would match the temp folder name). */
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

const bytes = (ctx: Ctx, name = 'report.rdlc'): Promise<string> =>
  readFile(ctx.path(name), 'utf8');

const dirtyTabs = (page: Page): Locator =>
  page.locator('.monaco-workbench .tab.dirty');

async function openFile(ctx: Ctx, name = 'report.rdlc'): Promise<void> {
  await openWorkspaceFile(ctx.driver, ctx.path(name));
}

/** Open the active report's designer; only valid while it is the only designer. */
async function openDesigner(ctx: Ctx): Promise<Frame> {
  await ctx.driver.command('RDLC Code: Open Designer');
  return ctx.driver.designerFrame();
}

/** Open a report and its designer. */
async function openReport(ctx: Ctx, name = 'report.rdlc'): Promise<Frame> {
  await openFile(ctx, name);
  return openDesigner(ctx);
}

/**
 * The one designer frame that is visible and shows `selector`. With two reports
 * open the retained frame of the other one is hidden, so `designerFrame()` would
 * be ambiguous.
 */
async function visibleDesigner(page: Page, selector: string): Promise<Frame> {
  let shown: Frame | null = null;
  await expect
    .poll(
      async () => {
        shown = null;
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          if (
            await frame
              .locator(selector)
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            shown = frame;
            return true;
          }
        }
        return false;
      },
      { message: `a visible designer shows ${selector}`, timeout: 45_000 },
    )
    .toBe(true);
  return shown!;
}

/**
 * Reveal the RDLC container, wait until the target view is rendered, then focus
 * it. The reveal and the focus are separate host round trips: visibility is the
 * readiness gate, never mere attachment.
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

const insertRow = (page: Page, label: string): Locator =>
  page.getByRole('treeitem', { name: new RegExp(`^${label}, Insert`) });

/** A native tree row of a view; the accessible name may carry a Primary/Selected cue. */
const treeRow = (page: Page, view: string, label: string): Locator =>
  pane(page, view)
    .locator('.monaco-list-rows')
    .getByRole('treeitem', { name: new RegExp(`^${literal(label)}(?:,|$)`) });

const undo = (frame: Frame): Promise<void> =>
  frame.getByRole('button', { name: 'Undo', exact: true }).click();

const redo = (frame: Frame): Promise<void> =>
  frame.getByRole('button', { name: 'Redo', exact: true }).click();

/** A toolbar action of the designer (Copy, Paste, Duplicate). */
const toolbar = (frame: Frame, name: string): Locator =>
  frame.getByRole('button', { name, exact: true });

/** The accessible acceptance announcement of a creation. */
const createdNotice = (frame: Frame, name: string): Locator =>
  frame.locator('.feedback').getByText(`Created ${name}.`, { exact: true });

async function save(ctx: Ctx): Promise<void> {
  await blur(ctx.page);
  await ctx.page.keyboard.press(`${MOD}+s`);
}

/**
 * Save while the editor is dirty until the report on disk satisfies `accept`.
 * An edit is applied asynchronously, so an immediate save can still see the old
 * document; saving a clean editor is a no-op. The last text read is returned.
 */
async function savedUntil(
  ctx: Ctx,
  accept: (text: string) => boolean,
  message: string,
  name = 'report.rdlc',
): Promise<string> {
  let last = '';
  await expect
    .poll(
      async () => {
        last = await bytes(ctx, name);
        if (accept(last)) return true;
        if ((await dirtyTabs(ctx.page).count()) > 0) await save(ctx);
        return false;
      },
      { message, timeout: 45_000 },
    )
    .toBe(true);
  return last;
}

/** Exact bytes on disk after a save. */
const savedAs = (
  ctx: Ctx,
  expected: string,
  message: string,
  name = 'report.rdlc',
): Promise<string> =>
  savedUntil(ctx, (text) => text === expected, message, name);

/** Zero report text or history change: exact bytes and no dirty tab. */
async function expectUnchanged(
  ctx: Ctx,
  expected: string,
  name = 'report.rdlc',
): Promise<void> {
  await expect
    .poll(() => bytes(ctx, name), { message: `${name} bytes` })
    .toBe(expected);
  await expect(dirtyTabs(ctx.page), `${name}: no dirty tab`).toHaveCount(0);
}

/** Show the inspector (Properties) when the narrow window starts with it hidden. */
async function showProperties(frame: Frame): Promise<void> {
  const toggle = frame.getByRole('button', { name: 'Properties', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

// ---------------------------------------------------------------------------
// Designer helpers
// ---------------------------------------------------------------------------

/** One image item of the canvas by its item name. */
const imageItem = (frame: Frame, name: string): Locator =>
  frame.locator(`.item[data-kind="image"][aria-label="Image ${name}"]`);

const primaryImage = (frame: Frame): Locator =>
  frame.locator('.item.primary[data-kind="image"]');

const inspector = (frame: Frame): Locator =>
  frame.locator('form[aria-label="Image properties"]');

/** An inspector field by its `data-property`. */
const field = (frame: Frame, property: string): Locator =>
  inspector(frame).locator(`[data-property="${property}"]`);

/** A picture item that is really decoded and painted, not a placeholder. */
async function expectDecoded(item: Locator): Promise<void> {
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('data-image-state', 'picture');
  await expect
    .poll(
      () =>
        item
          .locator('img')
          .first()
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      { message: 'the picture is decoded' },
    )
    .toBe(true);
}

/** Select one item by a real click and wait for the accepted primary. */
async function selectImage(frame: Frame, name: string): Promise<void> {
  await imageItem(frame, name).click();
  await expect(frame.locator('.item.primary')).toHaveCount(1);
  await expect(primaryImage(frame)).toHaveAttribute(
    'aria-label',
    `Image ${name}`,
  );
}

/** Click the native Image row and answer the file chooser with a fixture picture. */
async function importPicture(
  ctx: Ctx,
  file: string,
  options: { readonly beforeAccept?: () => void } = {},
): Promise<void> {
  await focusView(ctx, 'Components');
  await insertRow(ctx.page, 'Image').click();
  await chooseFile(ctx.page, ctx.path(`pictures/${file}`), options);
}

/** The compact designer fallback: the catalog cards inside the canvas. */
async function compactCatalog(frame: Frame): Promise<void> {
  const card = frame.locator('[data-card="Image"]');
  const tab = frame.getByRole('tab', { name: 'Components', exact: true });
  if (await card.isVisible()) return;
  if (!(await tab.isVisible()))
    await frame
      .getByRole('button', { name: 'Components', exact: true })
      .click();
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(card).toBeVisible();
}

/**
 * Real HTML5 drag: pointer down on the source, travel, release at `at` relative
 * to the target's own border box.
 */
async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  at: { x: number; y: number },
): Promise<void> {
  const from = await source.boundingBox();
  const box = await target.boundingBox();
  if (!from || !box) throw new Error('Drag geometry is unavailable.');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y, { steps: 5 });
  await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 20 });
  await page.mouse.up();
}

/** Real pointer gesture from the centre of `from` by `dx`, `dy` client pixels. */
async function pointerDrag(
  page: Page,
  from: Locator,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await from.boundingBox();
  if (!box) throw new Error('Pointer geometry is unavailable.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// Independent source oracles
// ---------------------------------------------------------------------------

type Edge = 'Left' | 'Top' | 'Width' | 'Height';
const EDGES: readonly Edge[] = ['Left', 'Top', 'Width', 'Height'];

/** A length in points; the units the designer and the fixtures write. */
function lengthPt(text: string): number {
  const match = /^(-?[0-9.]+)(pt|in|mm|cm|pc)$/.exec(text.trim());
  if (!match) throw new Error(`Unreadable length: ${text}`);
  const unit = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54, pc: 12 }[
    match[2] as 'pt'
  ];
  return Number(match[1]) * unit;
}

const itemBlock = (name: string): RegExp =>
  new RegExp(`<Image Name="${name}"[^>]*>[\\s\\S]*?</Image>`);

function blockOf(source: string, name: string): string {
  const block = itemBlock(name).exec(source)?.[0];
  if (!block) throw new Error(`No Image item named ${name}`);
  return block;
}

const withoutBlock = (source: string, name: string): string =>
  source.replace(blockOf(source, name), '');

function edgeOf(block: string, edge: Edge): string {
  const value = new RegExp(`<${edge}>([^<]*)</${edge}>`).exec(block)?.[1];
  if (value === undefined) throw new Error(`No ${edge} in ${block}`);
  return value;
}

/** One edge of one item, in points; NaN while the item or edge is unreadable. */
function edgePt(source: string, name: string, edge: Edge): number {
  try {
    return lengthPt(edgeOf(blockOf(source, name), edge));
  } catch {
    return Number.NaN;
  }
}

const squash = (source: string): string => source.replace(/>\s+</g, '><');

const imageCount = (source: string): number =>
  (source.match(/<Image /g) ?? []).length;
const dataCount = (source: string): number =>
  (source.match(/<ImageData>/g) ?? []).length;

/** The text of one block with the given child elements removed. */
const without = (block: string, ...tags: string[]): string =>
  block.replace(new RegExp(`<(${tags.join('|')})>[^<]*</\\1>`, 'g'), '');

/**
 * After an edit that may move or resize one item: the text outside the item is
 * byte-identical, the item keeps everything but the named edges (unknown
 * children, foreign attributes, order), and every other edge is unchanged.
 */
function expectOnlyEdges(
  before: string,
  after: string,
  name: string,
  changed: readonly Edge[],
): void {
  expect(withoutBlock(after, name), `${name}: text outside the item`).toBe(
    withoutBlock(before, name),
  );
  const [old, next] = [blockOf(before, name), blockOf(after, name)];
  expect(without(next, ...EDGES), `${name}: item body`).toBe(
    without(old, ...EDGES),
  );
  for (const edge of EDGES.filter((entry) => !changed.includes(entry)))
    expect(edgeOf(next, edge), `${name}: ${edge}`).toBe(edgeOf(old, edge));
}

interface Definition {
  readonly name: string;
  readonly mime: string;
  readonly base64: string;
}

/** The definition a picture file must produce, read from the committed file. */
async function definitionOf(file: string, name: string): Promise<Definition> {
  const data = await readFile(resolve(root(), PICTURES, file));
  return {
    name,
    mime: file.endsWith('.png') ? 'image/png' : 'image/jpeg',
    base64: data.toString('base64'),
  };
}

const definitionXml = (definition: Definition): string =>
  `<EmbeddedImage Name="${definition.name}"><MIMEType>${definition.mime}</MIMEType>` +
  `<ImageData>${definition.base64}</ImageData></EmbeddedImage>`;

/**
 * Remove an inserted item (and its new definition, whole collection or single
 * entry) from `text`. Null when the expected insertion is not there (yet), so a
 * poll can keep waiting; the item text is the Embedded/FitProportional contract.
 */
function stripInsertion(
  text: string,
  item: { readonly name: string; readonly value: string },
  definition?: Definition,
): { rest: string; geometry: Record<Edge, string> } | null {
  const match = new RegExp(
    `<Image Name="${item.name}"><Source>Embedded</Source><Value>${item.value}</Value>` +
      '<Sizing>FitProportional</Sizing><Top>([^<]+)</Top><Left>([^<]+)</Left>' +
      '<Height>([^<]+)</Height><Width>([^<]+)</Width></Image>',
  ).exec(text);
  if (!match) return null;
  let rest = text.replace(match[0], '');
  if (definition) {
    const entry = definitionXml(definition);
    const whole = `<EmbeddedImages>${entry}</EmbeddedImages>`;
    if (rest.includes(whole)) rest = rest.replace(whole, '');
    else if (rest.includes(entry)) rest = rest.replace(entry, '');
    else return null;
  }
  return {
    rest,
    geometry: {
      Top: match[1]!,
      Left: match[2]!,
      Height: match[3]!,
      Width: match[4]!,
    },
  };
}

/** Wait (saving) until `before` plus exactly this insertion is on disk. */
async function savedInsertion(
  ctx: Ctx,
  before: string,
  item: { readonly name: string; readonly value: string },
  definition?: Definition,
): Promise<{ text: string; geometry: Record<Edge, string> }> {
  let geometry: Record<Edge, string> | undefined;
  const text = await savedUntil(
    ctx,
    (candidate) => {
      const stripped = stripInsertion(candidate, item, definition);
      if (stripped?.rest !== before) return false;
      geometry = stripped.geometry;
      return true;
    },
    `${item.name} (${item.value}) is the only change on disk`,
  );
  return { text, geometry: geometry! };
}

// ---------------------------------------------------------------------------
// US1 - insert a picture, undo and redo it
// ---------------------------------------------------------------------------

test('US1-insert-undo', async () => {
  test.setTimeout(600_000);
  await session({ 'report.rdlc': { fixture: 'images-blank' } }, async (ctx) => {
    const { page } = ctx;
    const original = await bytes(ctx);
    const logo = await definitionOf('logo.png', 'logo');
    const photo = await definitionOf('photo.jpg', 'photo');
    const frame = await openReport(ctx);
    await focusView(ctx, 'Components');

    // Cancel: the chooser opens and is closed; no edit and no history entry.
    await insertRow(page, 'Image').click();
    const dialog = page.locator(
      '.quick-input-widget:visible .quick-input-box input',
    );
    await expect(dialog).toBeVisible();
    await dialog.press('Escape');
    await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
    await expectUnchanged(ctx, original);
    await expect(frame.locator('.item[data-kind="image"]')).toHaveCount(0);

    // One refusal: the reason and the file are named, the report is unchanged.
    const damaged = await readFile(resolve(root(), PICTURES, 'bad-crc.png'));
    await importPicture(ctx, 'bad-crc.png');
    const refusal = frame.locator('#report-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('bad-crc.png');
    await expect(refusal).toContainText('damaged or truncated');
    expect(
      (await refusal.textContent()) ?? '',
      'a refusal never carries picture data',
    ).not.toContain(damaged.toString('base64').slice(0, 48));
    await expectUnchanged(ctx, original);
    await expect(frame.locator('.item[data-kind="image"]')).toHaveCount(0);

    // PNG by click: the stopwatch is the SC-001 evidence (insert and position).
    const started = Date.now();
    await importPicture(ctx, 'logo.png');
    await expect(createdNotice(frame, 'Image1')).toHaveCount(1);
    await expect(primaryImage(frame)).toHaveCount(1);
    await expect(primaryImage(frame)).toHaveAttribute(
      'aria-label',
      'Image Image1',
    );
    await expectDecoded(primaryImage(frame));
    const shownMs = Date.now() - started;
    const first = await savedInsertion(
      ctx,
      original,
      { name: 'Image1', value: 'logo' },
      logo,
    );
    // The default size is the natural 120 x 40 px at 96 dpi: 90pt x 30pt.
    expect(lengthPt(first.geometry.Width)).toBeCloseTo(90, 0);
    expect(lengthPt(first.geometry.Height)).toBeCloseTo(30, 0);

    // Position it: one 10pt keyboard nudge to the right.
    await frame.locator('.viewport').focus();
    await page.keyboard.press('Shift+ArrowRight');
    const moved = await savedUntil(
      ctx,
      (text) =>
        Math.abs(
          edgePt(text, 'Image1', 'Left') - lengthPt(first.geometry.Left) - 10,
        ) < 0.5,
      'the picture moved 10pt to the right',
    );
    const positionedMs = Date.now() - started;
    expectOnlyEdges(first.text, moved, 'Image1', ['Left']);
    await mkdir(ctx.artifacts, { recursive: true });
    await writeFile(
      join(ctx.artifacts, 'sc-001-insert-position.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          assertion: 'tests/desktop/images.spec.ts::US1-insert-undo',
          criterion: 'SC-001',
          scope:
            'From the Image row click to the displayed picture, then to the keyboard nudge saved on disk, including automation waits.',
          budgetMs: 30_000,
          shownMs,
          positionedMs,
          within: positionedMs <= 30_000,
        },
        null,
        2,
      )}\n`,
    );

    // Undo, Undo, Redo: the nudge, then the item with its definition, one step each.
    await undo(frame);
    await savedAs(ctx, first.text, 'one Undo reverts the nudge only');
    await undo(frame);
    await savedAs(
      ctx,
      original,
      'one Undo removes the item and its new definition',
    );
    await redo(frame);
    await savedAs(ctx, first.text, 'one Redo restores both');
    await undo(frame);
    await savedAs(ctx, original, 'the report is back to its original bytes');

    // JPEG by click.
    await importPicture(ctx, 'photo.jpg');
    await expect(createdNotice(frame, 'Image1')).toHaveCount(1);
    await expectDecoded(primaryImage(frame));
    const jpeg = await savedInsertion(
      ctx,
      original,
      { name: 'Image1', value: 'photo' },
      photo,
    );

    // Drop from the compact catalog onto the body: the position is the drop,
    // the same picture content as `logo` adds a second definition and item.
    // Native views are hidden first, as in components.spec.ts, so the drop
    // coordinates are those of the compact designer.
    await ctx.driver.command('View: Toggle Primary Side Bar Visibility');
    await expect(page.locator('.part.sidebar')).toBeHidden();
    await compactCatalog(frame);
    await drag(
      page,
      frame.locator('[data-card="Image"]'),
      frame.locator('.body'),
      DROP,
    );
    await chooseFile(page, ctx.path('pictures/logo.png'));
    await expect(createdNotice(frame, 'Image2')).toHaveCount(1);
    await expectDecoded(primaryImage(frame));
    const dropped = await savedInsertion(
      ctx,
      jpeg.text,
      { name: 'Image2', value: 'logo' },
      logo,
    );
    expect(lengthPt(dropped.geometry.Left)).toBeCloseTo(260, -1);
    expect(lengthPt(dropped.geometry.Top)).toBeCloseTo(30, -1);
    expect(dropped.text.match(/<EmbeddedImages>/g)).toHaveLength(1);
    expect(dataCount(dropped.text)).toBe(2);

    // The drop is one undo step too.
    await undo(frame);
    await savedAs(ctx, jpeg.text, 'one Undo reverts the drop');
    await undo(frame);
    await savedAs(ctx, original, 'one Undo reverts the JPEG insertion');
    await ctx.driver.capture('images-us1-insert-undo');
  });
});

// ---------------------------------------------------------------------------
// US2 - select, move, resize, delete, copy, paste, duplicate
// ---------------------------------------------------------------------------

test('US2-manipulate', async () => {
  test.setTimeout(600_000);
  await session(
    {
      'report.rdlc': { fixture: 'images-authored' },
      'other.rdlc': { fixture: 'images-blank' },
    },
    async (ctx) => {
      const { page } = ctx;
      const original = await bytes(ctx);
      const otherOriginal = await bytes(ctx, 'other.rdlc');
      const frame = await openReport(ctx);
      await showProperties(frame);

      // Selection: handles, accessible names and multi-selection like any item.
      await selectImage(frame, 'LogoFit');
      await expect(frame.locator('.selection-frame')).toHaveCount(1);
      await expect(frame.locator('.selection-frame .handle')).toHaveCount(8);
      await expect(
        frame.getByRole('button', { name: 'Resize Image LogoFit se' }),
      ).toBeVisible();
      await imageItem(frame, 'LogoAutoSize').click({ modifiers: ['Shift'] });
      await expect(frame.locator('.item.selected')).toHaveCount(2);
      await selectImage(frame, 'LogoFit');

      // Keyboard move of an item that keeps unknown children and a foreign
      // attribute (US5.4): two nudges, one undo step each.
      await selectImage(frame, 'Tagged');
      const taggedLeft = edgePt(original, 'Tagged', 'Left');
      const taggedTop = edgePt(original, 'Tagged', 'Top');
      await frame.locator('.viewport').focus();
      await page.keyboard.press('Shift+ArrowRight');
      await expect
        .poll(async () => lengthPt(await field(frame, 'left').inputValue()))
        .toBeCloseTo(taggedLeft + 10, 1);
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(async () => lengthPt(await field(frame, 'top').inputValue()))
        .toBeCloseTo(taggedTop + 1, 1);
      const nudged = await savedUntil(
        ctx,
        (text) =>
          Math.abs(edgePt(text, 'Tagged', 'Left') - (taggedLeft + 10)) < 0.1 &&
          Math.abs(edgePt(text, 'Tagged', 'Top') - (taggedTop + 1)) < 0.1,
        'the keyboard moves reached disk',
      );
      expectOnlyEdges(original, nudged, 'Tagged', ['Left', 'Top']);
      const tagged = blockOf(nudged, 'Tagged');
      expect(tagged).toContain('x:flag="1"');
      expect(tagged).toContain('<FutureThing level="2">kept</FutureThing>');
      expect(tagged).toContain('<x:Opaque keep="1">preserve</x:Opaque>');
      expect(lengthPt(edgeOf(tagged, 'Left'))).toBeCloseTo(taggedLeft + 10, 1);
      expect(lengthPt(edgeOf(tagged, 'Top'))).toBeCloseTo(taggedTop + 1, 1);

      // Pointer move: a real drag of an item right, snapped by the grid.
      await selectImage(frame, 'LogoAutoSize');
      await pointerDrag(page, imageItem(frame, 'LogoAutoSize'), 60, 0);
      const dragged = await savedUntil(
        ctx,
        (text) =>
          text !== nudged &&
          lengthPt(edgeOf(blockOf(text, 'LogoAutoSize'), 'Left')) >
            lengthPt(edgeOf(blockOf(nudged, 'LogoAutoSize'), 'Left')) + 20,
        'the pointer move reached disk',
      );
      expectOnlyEdges(nudged, dragged, 'LogoAutoSize', ['Left', 'Top']);

      // Pointer resize: the south-east handle grows the item.
      await selectImage(frame, 'LogoFit');
      const handle = frame.locator('.handle[data-handle="se"]');
      await expect(handle).toBeEnabled();
      const grip = await handle.boundingBox();
      if (!grip) throw new Error('The resize handle has no layout box.');
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        grip.x + grip.width / 2 + 40,
        grip.y + grip.height / 2 + 30,
        { steps: 12 },
      );
      await page.mouse.up();
      const resized = await savedUntil(
        ctx,
        (text) =>
          text !== dragged &&
          lengthPt(edgeOf(blockOf(text, 'LogoFit'), 'Width')) >
            lengthPt(edgeOf(blockOf(dragged, 'LogoFit'), 'Width')) + 10,
        'the pointer resize reached disk',
      );
      expectOnlyEdges(dragged, resized, 'LogoFit', ['Width', 'Height']);

      // Keyboard resize: the Width field of the inspector.
      await selectImage(frame, 'PhotoFitProportional');
      const width = field(frame, 'width');
      await width.fill('2in');
      await width.press('Enter');
      const widened = await savedUntil(
        ctx,
        (text) =>
          Math.abs(
            lengthPt(edgeOf(blockOf(text, 'PhotoFitProportional'), 'Width')) -
              144,
          ) < 0.5,
        'the Width field resized the item',
      );
      expectOnlyEdges(resized, widened, 'PhotoFitProportional', ['Width']);

      // Every manipulation so far is one undo step: walk them back exactly.
      for (const previous of [resized, dragged, nudged]) {
        await undo(frame);
        await savedAs(ctx, previous, 'one Undo reverts one manipulation');
      }
      await undo(frame);
      await undo(frame);
      await savedAs(ctx, original, 'the two nudges revert one by one');
      await redo(frame);
      await redo(frame);
      await savedAs(ctx, nudged, 'Redo reapplies both nudges');
      await undo(frame);
      await undo(frame);
      await savedAs(ctx, original, 'the report is back to its original bytes');

      // Delete: the item goes, every definition stays (the confirmation names it).
      await selectImage(frame, 'PhotoClip');
      const removal = frame.locator('form[aria-label="Delete image"]');
      await removal.getByRole('checkbox').check();
      await removal.getByRole('button', { name: 'Delete image' }).click();
      const deleted = await savedUntil(
        ctx,
        (text) => !text.includes('Name="PhotoClip"'),
        'the deleted item left the report',
      );
      expect(squash(deleted)).toBe(
        squash(original.replace(blockOf(original, 'PhotoClip'), '')),
      );
      expect(deleted.match(/<EmbeddedImage /g)).toHaveLength(3);
      expect(dataCount(deleted)).toBe(3);
      await undo(frame);
      await savedAs(ctx, original, 'one Undo restores the deleted item');

      // Copy and paste, then duplicate: a unique name, the same definition, no new data.
      await selectImage(frame, 'LogoFit');
      await toolbar(frame, 'Copy').click();
      await toolbar(frame, 'Paste').click();
      const pasted = await savedUntil(
        ctx,
        (text) => imageCount(text) === imageCount(original) + 1,
        'the pasted item reached disk',
      );
      const names = [...pasted.matchAll(/<Image Name="([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(new Set(names).size, 'every item name is unique').toBe(
        names.length,
      );
      expect(dataCount(pasted), 'no picture data is duplicated').toBe(3);
      expect(pasted.match(/<Value>logo<\/Value>/g)).toHaveLength(
        (original.match(/<Value>logo<\/Value>/g) ?? []).length + 1,
      );
      await undo(frame);
      await savedAs(ctx, original, 'one Undo reverts the paste');
      await redo(frame);
      await savedAs(ctx, pasted, 'one Redo reapplies the paste');
      await undo(frame);
      await savedAs(ctx, original, 'the report is original again');

      await selectImage(frame, 'PhotoFitProportional');
      await toolbar(frame, 'Duplicate').click();
      const duplicated = await savedUntil(
        ctx,
        (text) => imageCount(text) === imageCount(original) + 1,
        'the duplicated item reached disk',
      );
      expect(dataCount(duplicated), 'no picture data is duplicated').toBe(3);
      expect(duplicated.match(/<Value>photo<\/Value>/g)).toHaveLength(
        (original.match(/<Value>photo<\/Value>/g) ?? []).length + 1,
      );
      await undo(frame);
      await savedAs(ctx, original, 'one Undo reverts the duplicate');

      // Cross-report paste: the definition travels once, with the item.
      await selectImage(frame, 'LogoFit');
      await toolbar(frame, 'Copy').click();
      const logoData = (await definitionOf('logo.png', 'logo')).base64;
      await openFile(ctx, 'other.rdlc');
      await ctx.driver.command('RDLC Code: Open Designer');
      const other = await visibleDesigner(page, '.item[data-kind="textbox"]');
      await toolbar(other, 'Paste').click();
      const carried = await savedUntil(
        ctx,
        (text) => text.includes('<EmbeddedImage Name="logo">'),
        'the pasted item and its definition reached the other report',
        'other.rdlc',
      );
      expect(carried.match(/<EmbeddedImage /g)).toHaveLength(1);
      expect(carried).toContain(`<ImageData>${logoData}</ImageData>`);
      expect(imageCount(carried)).toBe(1);
      expect(carried).toContain('<Value>logo</Value>');
      await undo(other);
      await savedAs(
        ctx,
        otherOriginal,
        'one Undo removes the pasted item and its definition',
        'other.rdlc',
      );
      await ctx.driver.capture('images-us2-manipulate');
    },
  );
});

// ---------------------------------------------------------------------------
// US3 - the inspector: sizing, the definition picker, ToolTip, replace scope
// ---------------------------------------------------------------------------

test('US3-inspector', async () => {
  test.setTimeout(600_000);
  await session(
    { 'report.rdlc': { fixture: 'images-authored' } },
    async (ctx) => {
      const original = await bytes(ctx);
      const frame = await openReport(ctx);
      await showProperties(frame);
      await selectImage(frame, 'LogoFit');
      const form = inspector(frame);

      // The fields, the picker choices and the read-only picture metadata.
      await expect(field(frame, 'name')).toHaveValue('LogoFit');
      await expect(field(frame, 'sizing')).toHaveValue('Fit');
      await expect(field(frame, 'value')).toHaveValue('logo');
      await expect(field(frame, 'left')).toHaveValue('0.25in');
      await expect(field(frame, 'width')).toHaveValue('1.5in');
      expect(
        (await field(frame, 'value').locator('option').allTextContents()).map(
          (text) => text.trim(),
        ),
      ).toEqual(expect.arrayContaining(['logo', 'photo', 'unused']));
      await expect(
        form.locator('select[data-property="sizing"] option'),
      ).toHaveText([...SIZINGS]);
      const metadata = form.locator('dl[aria-label="Picture metadata"]');
      await expect(metadata).toContainText('PNG');
      await expect(metadata).toContainText('120 × 40 px');
      await expect(metadata).toContainText('KiB');

      const states = [original];
      const next = async (
        message: string,
        accept: (text: string) => boolean,
      ): Promise<string> => {
        const text = await savedUntil(ctx, accept, message);
        states.push(text);
        return text;
      };

      // Sizing: the canvas follows each mode and only the Sizing text changes.
      await field(frame, 'sizing').selectOption('Clip');
      const clipped = await next('Sizing is Clip on disk', (text) =>
        blockOf(text, 'LogoFit').includes('<Sizing>Clip</Sizing>'),
      );
      expect(withoutBlock(clipped, 'LogoFit')).toBe(
        withoutBlock(original, 'LogoFit'),
      );
      expect(blockOf(clipped, 'LogoFit')).toBe(
        blockOf(original, 'LogoFit').replace(
          '<Sizing>Fit</Sizing>',
          '<Sizing>Clip</Sizing>',
        ),
      );
      await expect(imageItem(frame, 'LogoFit')).toHaveAttribute(
        'data-sizing',
        'Clip',
      );
      await field(frame, 'sizing').selectOption('AutoSize');
      const natural = await next('Sizing is AutoSize on disk', (text) =>
        blockOf(text, 'LogoFit').includes('<Sizing>AutoSize</Sizing>'),
      );
      expect(blockOf(natural, 'LogoFit')).toBe(
        blockOf(original, 'LogoFit').replace(
          '<Sizing>Fit</Sizing>',
          '<Sizing>AutoSize</Sizing>',
        ),
      );
      await expect(imageItem(frame, 'LogoFit')).toHaveAttribute(
        'data-sizing',
        'AutoSize',
      );

      // The definition picker: only the item's Value is repointed.
      await field(frame, 'value').selectOption('photo');
      const repointed = await next('Value is photo on disk', (text) =>
        blockOf(text, 'LogoFit').includes('<Value>photo</Value>'),
      );
      expect(withoutBlock(repointed, 'LogoFit')).toBe(
        withoutBlock(natural, 'LogoFit'),
      );
      expect(without(blockOf(repointed, 'LogoFit'), 'Value', 'MIMEType')).toBe(
        without(blockOf(natural, 'LogoFit'), 'Value', 'MIMEType'),
      );
      await expect(
        inspector(frame).locator('dl[aria-label="Picture metadata"]'),
      ).toContainText('JPEG');

      // ToolTip: plain text, then an expression, which stays inert text.
      await field(frame, 'toolTip').fill('Company logo');
      await field(frame, 'toolTip').press('Enter');
      const tipped = await next('ToolTip text is on disk', (text) =>
        blockOf(text, 'LogoFit').includes('<ToolTip>Company logo</ToolTip>'),
      );
      expect(withoutBlock(tipped, 'LogoFit')).toBe(
        withoutBlock(repointed, 'LogoFit'),
      );
      await field(frame, 'toolTip').fill('=Fields!Name.Value');
      await field(frame, 'toolTip').press('Enter');
      const expression = await next(
        'The ToolTip expression is on disk',
        (text) =>
          blockOf(text, 'LogoFit').includes(
            '<ToolTip>=Fields!Name.Value</ToolTip>',
          ),
      );
      await expect(
        frame.getByText(
          'This ToolTip is an expression. It is shown as text and never evaluated.',
        ),
      ).toBeVisible();
      expect(withoutBlock(expression, 'LogoFit')).toBe(
        withoutBlock(tipped, 'LogoFit'),
      );

      // Replace scope: photo now backs three items, so the choice is offered, and
      // "this item" repoints one Value onto the identical existing definition.
      await expect(
        form.getByRole('button', { name: 'Replace for all 3 items' }),
      ).toBeVisible();
      await form.getByRole('button', { name: 'Replace for this item' }).click();
      await chooseFile(ctx.page, ctx.path('pictures/logo.png'));
      const replaced = await next(
        'Only this item points at logo again',
        (text) => blockOf(text, 'LogoFit').includes('<Value>logo</Value>'),
      );
      expect(withoutBlock(replaced, 'LogoFit')).toBe(
        withoutBlock(expression, 'LogoFit'),
      );
      expect(replaced.match(/<EmbeddedImage /g)).toHaveLength(3);
      expect(dataCount(replaced)).toBe(3);
      expect(replaced.match(/<Value>photo<\/Value>/g)).toHaveLength(2);

      // Invalid values are refused with the product's reason and change nothing.
      await field(frame, 'name').fill('PhotoClip');
      await field(frame, 'name').press('Enter');
      await expect(
        frame.locator('#image-refusal, #report-refusal').first(),
      ).toBeVisible();
      await field(frame, 'width').fill('-1in');
      await field(frame, 'width').press('Enter');
      await expectUnchanged(ctx, replaced);

      // Every accepted edit above is exactly one undo step.
      for (const previous of states.slice(0, -1).reverse()) {
        await undo(frame);
        await savedAs(ctx, previous, 'one Undo reverts one inspector edit');
      }
      expect(states[0]).toBe(original);
      await ctx.driver.capture('images-us3-inspector');
    },
  );
});

// ---------------------------------------------------------------------------
// US4 - Report Structure and Report Data
// ---------------------------------------------------------------------------

/** Right-click a native row and activate one exact `RDLC Code:` menu title. */
async function activateMenu(
  page: Page,
  row: Locator,
  title: string,
): Promise<void> {
  // Select first: the cue only returns once the host accepted that selection,
  // and the product drops a click on a row whose authority is stale by design,
  // so the click and the cue converge together.
  await expect(async () => {
    await row.click({ timeout: 5_000 });
    await expect(row).toHaveAttribute('aria-label', /Selected/, {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await row.click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: title });
  await expect(item, `${title} is offered`).toHaveCount(1);
  // A held gesture clears the 100 ms window in which a menu item swallows a click.
  await item.click({ delay: 250 });
  await expect(item, `${title} ran: its context menu dismissed`).toHaveCount(0);
}

test('US4-views', async () => {
  test.setTimeout(600_000);
  await session(
    { 'report.rdlc': { fixture: 'images-authored' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await bytes(ctx);
      const frame = await openReport(ctx);

      // Report Structure: every image item in source order; activating one
      // selects and reveals it on the canvas.
      await focusView(ctx, 'Report Structure');
      const first = treeRow(page, 'Report Structure', 'Image: LogoAutoSize');
      const second = treeRow(page, 'Report Structure', 'Image: LogoFit');
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      const [above, below] = [
        await first.boundingBox(),
        await second.boundingBox(),
      ];
      expect(above && below && above.y < below.y, 'source order').toBe(true);
      await treeRow(page, 'Report Structure', 'Image: LogoFit').click();
      await expect(
        treeRow(page, 'Report Structure', 'Image: LogoFit'),
      ).toHaveAttribute('aria-label', /Primary/);
      await expect(primaryImage(frame)).toHaveAttribute(
        'aria-label',
        'Image LogoFit',
      );

      // Report Data: name, format, size and reference count, never the payload.
      await focusView(ctx, 'Report Data');
      const logoRow = treeRow(page, 'Report Data', 'EmbeddedImage: logo');
      const photoRow = treeRow(page, 'Report Data', 'EmbeddedImage: photo');
      const unusedRow = treeRow(page, 'Report Data', 'EmbeddedImage: unused');
      await expect(logoRow).toHaveAttribute('aria-label', /PNG.*3 references/);
      await expect(photoRow).toHaveAttribute(
        'aria-label',
        /JPEG.*2 references/,
      );
      await expect(unusedRow).toHaveAttribute('aria-label', /0 references/);
      const logoData = (await definitionOf('logo.png', 'logo')).base64;
      for (const row of [logoRow, photoRow, unusedRow])
        expect(
          (await row.getAttribute('aria-label')) ?? '',
          'a row never carries picture data',
        ).not.toContain(logoData.slice(0, 32));

      // Rename: every constant reference follows, in one undo step.
      const renamed = original
        .replaceAll('<Value>photo</Value>', '<Value>portrait</Value>')
        .replace(
          '<EmbeddedImage Name="photo">',
          '<EmbeddedImage Name="portrait">',
        );
      expect(renamed).not.toBe(original);
      await activateMenu(page, photoRow, 'RDLC Code: Rename Embedded Image');
      const name = page.locator(
        '.quick-input-widget:visible .quick-input-box input',
      );
      await expect(name).toBeVisible();
      await setQuickInputText(name, 'portrait');
      await name.press('Enter');
      await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
      await savedAs(ctx, renamed, 'the rename and its references are on disk');
      await expect(
        treeRow(page, 'Report Data', 'EmbeddedImage: portrait'),
      ).toBeVisible();
      await undo(frame);
      await savedAs(ctx, original, 'one Undo reverts the whole rename');
      await redo(frame);
      await savedAs(ctx, renamed, 'one Redo reapplies the whole rename');
      await undo(frame);
      await savedAs(ctx, original, 'the report is original again');

      // Remove: offered on every definition row. A referenced definition is
      // refused with its referencing items listed and nothing changes (FR-022);
      // an unreferenced one is removed as a single undo step.
      await treeRow(page, 'Report Data', 'EmbeddedImage: logo').click({
        button: 'right',
      });
      await expect(
        page.getByRole('menuitem', {
          name: 'RDLC Code: Rename Embedded Image',
        }),
      ).toHaveCount(1);
      await expect(
        page.getByRole('menuitem', {
          name: 'RDLC Code: Remove Embedded Image',
        }),
      ).toHaveCount(1);
      await page.keyboard.press('Escape');
      await activateMenu(
        page,
        treeRow(page, 'Report Data', 'EmbeddedImage: logo'),
        'RDLC Code: Remove Embedded Image',
      );
      const refusal = page.locator('.notifications-toasts');
      for (const item of ['LogoAutoSize', 'LogoFit', 'Tagged'])
        await expect(
          refusal.getByText(
            `"${item}" still references embedded image "logo".`,
          ),
          `the refusal lists ${item}`,
        ).toBeVisible();
      await savedAs(
        ctx,
        original,
        'a blocked removal leaves the bytes unchanged',
      );
      await expect(page.locator('.monaco-workbench .tab.dirty')).toHaveCount(0);
      await activateMenu(
        page,
        treeRow(page, 'Report Data', 'EmbeddedImage: unused'),
        'RDLC Code: Remove Embedded Image',
      );
      const removed = await savedUntil(
        ctx,
        (text) => !text.includes('<EmbeddedImage Name="unused">'),
        'the unused definition left the report',
      );
      expect(squash(removed)).toBe(
        squash(
          original.replace(
            /<EmbeddedImage Name="unused">[\s\S]*?<\/EmbeddedImage>/,
            '',
          ),
        ),
      );
      expect(imageCount(removed)).toBe(imageCount(original));
      await undo(frame);
      await savedAs(ctx, original, 'one Undo restores the removed definition');

      // Insert an existing definition: no file chooser, one new item.
      await activateMenu(
        page,
        treeRow(page, 'Report Data', 'EmbeddedImage: logo'),
        'RDLC Code: Insert Embedded Image',
      );
      const inserted = await savedUntil(
        ctx,
        (text) => imageCount(text) === imageCount(original) + 1,
        'the new item reached disk',
      );
      await expect(page.locator('.quick-input-widget:visible')).toBeHidden();
      expect(dataCount(inserted), 'no picture data is written').toBe(3);
      expect(inserted.match(/<Value>logo<\/Value>/g)).toHaveLength(
        (original.match(/<Value>logo<\/Value>/g) ?? []).length + 1,
      );
      await expect(frame.locator('.item[data-kind="image"]')).toHaveCount(6);
      await undo(frame);
      await savedAs(ctx, original, 'one Undo removes the inserted item');
      await ctx.driver.capture('images-us4-views');
    },
  );
});

// ---------------------------------------------------------------------------
// US5 - existing and unsupported images are preserved
// ---------------------------------------------------------------------------

/** What the placeholder of each preserved item must say, by its projection reason. */
const PRESERVED_REASONS: readonly (readonly [string, string])[] = [
  ['ExternalPicture', 'source-preserved'],
  ['DatabasePicture', 'source-preserved'],
  ['ExpressionPicture', 'value-expression'],
  ['GifPicture', 'format-unsupported'],
  ['BmpPicture', 'format-unsupported'],
  ['LegacyPngPicture', 'mime-mismatch'],
  ['BrokenPicture', 'data-invalid'],
  ['GhostPicture', 'reference-missing'],
];

test('US5-preserve', async () => {
  await session(
    { 'report.rdlc': { fixture: 'images-preserved' } },
    async (ctx) => {
      const { page } = ctx;
      const original = await bytes(ctx);
      const frame = await openReport(ctx);

      // Placeholders at the declared bounds, each naming its own reason, with
      // nothing fetched, resolved or evaluated.
      const images = frame.locator('.item[data-kind="image"]');
      await expect(images).toHaveCount(PRESERVED_REASONS.length);
      for (const [name, reason] of PRESERVED_REASONS) {
        const item = imageItem(frame, name);
        await expect(item).toHaveAttribute('data-image-state', 'placeholder');
        await expect(item.locator('.image-placeholder')).toHaveAttribute(
          'data-reason',
          reason,
        );
        await expect(item.locator('.image-placeholder')).not.toBeEmpty();
      }
      await expect(frame.locator('.item[data-kind="image"] img')).toHaveCount(
        0,
      );

      // An unrelated edit and a save: everything image-related stays byte-identical.
      await focusView(ctx, 'Components');
      await insertRow(page, 'Textbox').click();
      await expect(createdNotice(frame, 'Textbox1')).toHaveCount(1);
      const edited = await savedUntil(
        ctx,
        (text) => /<Textbox Name="Textbox1">[\s\S]*?<\/Textbox>/.test(text),
        'the unrelated textbox reached disk',
      );
      const block = /<Textbox Name="Textbox1">[\s\S]*?<\/Textbox>/.exec(
        edited,
      )![0];
      expect(
        edited.replace(block, ''),
        'only the new textbox differs from the preserved report',
      ).toBe(original);
      await expect(images).toHaveCount(PRESERVED_REASONS.length);
      await expect(frame.locator('.item[data-kind="image"] img')).toHaveCount(
        0,
      );
      await undo(frame);
      await savedAs(ctx, original, 'one Undo restores the preserved report');
      await ctx.driver.capture('images-us5-preserve');
    },
  );
});

// ---------------------------------------------------------------------------
// SC-006 - fifty embedded images stay interactive; a 5 MiB picture appears fast
// ---------------------------------------------------------------------------

/**
 * A valid 1 x 1 PNG padded to `size` bytes with one private ancillary chunk
 * (every decoder skips it), so the picture is as large as the product accepts.
 */
function paddedPng(size: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const pixel = chunk('IDAT', deflateSync(Buffer.from([0, 0x20, 0x60, 0xa0])));
  const frame = [chunk('IHDR', header), pixel, chunk('IEND', Buffer.alloc(0))];
  const fixed =
    signature.length + frame.reduce((sum, part) => sum + part.length, 0);
  // Twelve bytes of chunk framing (length, type, CRC) around the padding.
  const padding = Buffer.alloc(Math.max(0, size - fixed - 12), 0x41);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('prVt', padding),
    pixel,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Nearest-rank 95th percentile of a non-empty sample. */
const p95 = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
};

interface TimingProbe {
  starts: { id: string; t: number }[];
  states: { id: string; t: number }[];
  moves: number[];
  previews: number[];
}

test('SC-006-timing', async () => {
  test.setTimeout(600_000);
  // Just under the raw limit: the largest picture the product accepts.
  const big = paddedPng(rawImageLimit - 1024);
  expect(big.length).toBeLessThan(rawImageLimit);
  await session(
    {
      'report.rdlc': { fixture: 'images-many' },
      'pictures/big.png': { bytes: big },
    },
    async (ctx) => {
      const { page, driver } = ctx;
      const original = await bytes(ctx);
      const frame = await openReport(ctx);
      const items = frame.locator('.item[data-kind="image"]');
      await expect(items).toHaveCount(50);
      await expect(
        frame.locator('.item[data-kind="image"][data-image-state="picture"]'),
      ).toHaveCount(50);
      await expectDecoded(imageItem(frame, 'Picture01'));

      // Probe: input start and the first visible consequence, on the page's own
      // clock (the page is where the feedback is painted).
      await frame.evaluate(() => {
        const probe = { starts: [], states: [], moves: [], previews: [] };
        Object.assign(window, { __rdlcImageProbe: probe });
        let previewing = false;
        document.addEventListener(
          'pointerdown',
          (event) => {
            const item = (event.target as Element | null)?.closest('.item');
            if (item)
              (probe.starts as unknown[]).push({
                id: item.getAttribute('data-item') ?? '',
                t: performance.now(),
              });
          },
          true,
        );
        document.addEventListener(
          'pointermove',
          () => (probe.moves as number[]).push(performance.now()),
          true,
        );
        new MutationObserver(() => {
          const primary = document.querySelector('.item.primary');
          const id = primary?.getAttribute('data-item') ?? '';
          const states = probe.states as { id: string; t: number }[];
          if (primary && states.at(-1)?.id !== id)
            states.push({ id, t: performance.now() });
          const shown = document.querySelector('.preview') !== null;
          if (shown && !previewing)
            (probe.previews as number[]).push(performance.now());
          previewing = shown;
        }).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class', 'style'],
        });
      });
      const probe = (): Promise<TimingProbe> =>
        frame.evaluate(
          () =>
            (window as unknown as { __rdlcImageProbe: TimingProbe })
              .__rdlcImageProbe,
        );

      // Selection feedback: pointer down to the new primary item, 20 samples.
      const selection: number[] = [];
      for (let step = 0; step < 20; step++) {
        const index = step % 6;
        await page.waitForTimeout(200);
        await items.nth(index).click();
        await expect(frame.locator('.item.primary')).toHaveCount(1);
        await expect
          .poll(async () => (await probe()).starts.length, {
            message: `selection ${step + 1} was probed`,
          })
          .toBe(step + 1);
        const seen = await probe();
        const start = seen.starts.at(-1)!;
        const shown = seen.states.find(
          (state) => state.id === start.id && state.t >= start.t,
        );
        expect(shown, `selection ${step + 1} became primary`).toBeDefined();
        selection.push(shown!.t - start.t);
      }

      // Movement feedback: first pointer move to the drawn proposal, 10 samples.
      await frame.evaluate(() => {
        const seen = (window as unknown as { __rdlcImageProbe: TimingProbe })
          .__rdlcImageProbe;
        seen.moves.length = 0;
        seen.previews.length = 0;
      });
      const movement: number[] = [];
      for (let step = 0; step < 10; step++) {
        const item = items.nth(step % 6);
        await page.waitForTimeout(200);
        await pointerDrag(page, item, 30, 0);
        await expect(frame.locator('.preview')).toHaveCount(0);
        const seen = await probe();
        const drawn = seen.previews[step];
        expect(drawn, `move ${step + 1} drew its proposal`).toBeDefined();
        const before = seen.moves.filter((time) => time <= drawn!);
        expect(
          before.length,
          `move ${step + 1} had a pointer move`,
        ).toBeGreaterThan(0);
        movement.push(drawn! - Math.max(...before));
        // Each committed move must be applied before the next gesture starts.
        await expect(frame.locator('.item.primary')).toHaveCount(1);
        await page.waitForTimeout(300);
      }

      // A 5 MiB picture, from the user's answer to the painted picture.
      let accepted = 0;
      await importPicture(ctx, 'big.png', {
        beforeAccept: () => {
          accepted = Date.now();
        },
      });
      await frame.waitForFunction(
        () => {
          const image = document.querySelector<HTMLImageElement>(
            '.item.primary[aria-label="Image Image1"][data-image-state="picture"] img',
          );
          return !!image && image.complete && image.naturalWidth > 0;
        },
        undefined,
        { polling: 'raf', timeout: 30_000 },
      );
      const appeared = Date.now() - accepted;
      await expect(createdNotice(frame, 'Image1')).toHaveCount(1);
      await expect(items).toHaveCount(51);

      // Correctness first (critical): fifty pictures stayed displayed and the
      // import is exactly one item plus its definition.
      await expect(
        frame.locator('.item[data-kind="image"][data-image-state="picture"]'),
      ).toHaveCount(51);
      const imported = await savedUntil(
        ctx,
        (text) => (text.match(/<Image /g) ?? []).length === 51,
        'the 5 MiB import reached disk',
      );
      expect(dataCount(imported)).toBe(dataCount(original) + 1);
      await mkdir(ctx.artifacts, { recursive: true });
      await writeFile(
        join(ctx.artifacts, 'sc-006-timings.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            version: driver.identity.version,
            assertion: 'tests/desktop/images.spec.ts::SC-006-timing',
            fixture: 'images-many',
            selectionMs: selection,
            movementMs: movement,
            pictureMs: appeared,
            pictureBytes: big.length,
            budgetMs: { selection: 100, movement: 100, picture: 1000 },
          },
          null,
          2,
        )}\n`,
      );

      // The accepted bounds; runner speed is not a product defect (informational).
      const selectionP95 = p95(selection);
      const movementP95 = p95(movement);
      expect(selectionP95, 'selection p95 ms').toBeLessThanOrEqual(100);
      expect(movementP95, 'move p95 ms').toBeLessThanOrEqual(100);
      expect(appeared, '5 MiB picture ms').toBeLessThanOrEqual(1000);
    },
  );
});
