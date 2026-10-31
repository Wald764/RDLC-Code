import { test, expect } from 'playwright/test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  launchTrustedDesktop,
  setQuickInputText,
  type DesktopDriver,
} from './driver.js';

const mime = 'application/vnd.rdlc-code.native-drag-probe';

test('native drag: observe public TreeView custom MIME delivery and cancellation', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'native-drag',
  );
  await mkdir(artifacts, { recursive: true });
  const workspace = await mkdtemp(resolve(root, '.vscode-test/native-drag-'));
  const fixture = join(workspace, 'native-drag.rdlc');
  await copyFile(resolve(root, 'tests/fixtures/datasets/blank.rdlc'), fixture);
  const original = await readFile(fixture, 'utf8');
  const log = join(artifacts, 'host-drag.jsonl');
  const previousLog = process.env.RDLC_NATIVE_DRAG_LOG;
  process.env.RDLC_NATIVE_DRAG_LOG = log;
  let driver: DesktopDriver | undefined;
  let failure: unknown;
  let result: Record<string, unknown> = { status: 'failed', validated: false };
  try {
    // This public-API feasibility probe needs test-only contributions, never shipped in the VSIX.
    driver = await launchTrustedDesktop({
      root,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      artifactDir: artifacts,
    });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.page.keyboard.press(`${modifier}+p`);
    const quickOpen = driver.page.locator(
      '.quick-input-widget:visible .quick-input-box input',
    );
    await quickOpen.waitFor({ state: 'visible' });
    await setQuickInputText(quickOpen, fixture);
    await driver.page
      .locator('.quick-input-widget:visible .monaco-list-row')
      .filter({ hasText: 'native-drag.rdlc' })
      .first()
      .click();
    await driver.command('RDLC Code: Open Designer');
    const frame = await driver.designerFrame();
    await driver.command('RDLC Test: Show Native Drag Probe');
    const row = driver.page.getByRole('treeitem', {
      name: 'Textbox drag probe',
      exact: true,
    });
    await expect(row).toBeVisible();
    // Observe the actual Angular frame; no synthetic DataTransfer or dispatchEvent.
    await frame.evaluate((type) => {
      const events: { event: string; types: string[]; value: string }[] = [];
      (
        window as unknown as { nativeDragProbe: typeof events }
      ).nativeDragProbe = events;
      for (const event of ['dragenter', 'dragover', 'drop']) {
        document.addEventListener(
          event,
          (raw) => {
            const drag = raw as DragEvent;
            const types = [...(drag.dataTransfer?.types ?? [])];
            events.push({
              event,
              types,
              value:
                event === 'drop'
                  ? (drag.dataTransfer?.getData(type) ?? '')
                  : '',
            });
            if (types.includes(type)) drag.preventDefault();
          },
          true,
        );
      }
    }, mime);
    const origin = await row.boundingBox();
    const target = await frame.locator('rdlc-editor').boundingBox();
    expect(origin).not.toBeNull();
    expect(target).not.toBeNull();
    const drag = async (cancel: boolean) => {
      await driver!.page.mouse.move(
        origin!.x + origin!.width / 2,
        origin!.y + origin!.height / 2,
      );
      await driver!.page.mouse.down();
      await driver!.page.mouse.move(
        origin!.x + origin!.width / 2 + 12,
        origin!.y + origin!.height / 2,
        { steps: 5 },
      );
      await driver!.page.mouse.move(
        target!.x + target!.width / 2,
        target!.y + target!.height / 2,
        { steps: 30 },
      );
      if (cancel) await driver!.page.keyboard.press('Escape');
      await driver!.page.mouse.up();
    };
    const readHostEvents = async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event: string });
    await writeFile(log, '');
    await drag(true);
    await expect
      .poll(
        async () =>
          (await readHostEvents()).filter(
            (event) => event.event === 'handleDrag',
          ).length,
      )
      .toBeGreaterThanOrEqual(1);
    const cancelledHostEvents = await readHostEvents();
    const cancelled = await frame.evaluate(
      () =>
        (window as unknown as { nativeDragProbe: unknown[] }).nativeDragProbe,
    );
    expect(
      cancelled.some((event) => (event as { event: string }).event === 'drop'),
    ).toBe(false);
    await writeFile(log, '');
    await frame.evaluate(() => {
      (
        window as unknown as { nativeDragProbe: unknown[] }
      ).nativeDragProbe.length = 0;
    });
    await drag(false);
    await expect
      .poll(
        async () =>
          (await readHostEvents()).filter(
            (event) => event.event === 'handleDrag',
          ).length,
      )
      .toBeGreaterThanOrEqual(1);
    const events = await frame.evaluate(
      () =>
        (
          window as unknown as {
            nativeDragProbe: {
              event: string;
              types: string[];
              value: string;
            }[];
          }
        ).nativeDragProbe,
    );
    const hostEvents = await readHostEvents();
    const delivered = events.some(
      (event) =>
        event.event === 'drop' &&
        event.types.includes(mime) &&
        event.value === 'rdlc-native-probe-v1',
    );
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    await driver.capture('native-drag');
    result = {
      status: delivered ? 'transfer-observed' : 'unavailable',
      validated: false,
      reason: delivered
        ? 'Custom MIME reached Angular; full zoom/placement/drop contract remains unvalidated.'
        : 'Public TreeView handleDrag ran, but the custom MIME did not reach an Angular drop.',
      identity: driver.identity,
      fixture: {
        id: 'local-blank',
        sha256: createHash('sha256').update(original).digest('hex'),
      },
      sourceUnchanged: true,
      hostEvents,
      cancelledHostEvents,
      cancelled,
      events,
      productionDragEnabled: false,
    };
  } catch (error) {
    result = {
      status: 'failed',
      validated: false,
      identity: driver?.identity ?? null,
      error: error instanceof Error ? error.message : String(error),
    };
    failure = error;
  } finally {
    try {
      await driver?.close();
    } catch (error) {
      result = {
        ...result,
        status: 'failed',
        validated: false,
        cleanupError: error instanceof Error ? error.message : String(error),
      };
      failure = failure
        ? new AggregateError(
            [failure, error],
            'Native drag probe and cleanup failed',
          )
        : error;
    }
    if (previousLog === undefined) delete process.env.RDLC_NATIVE_DRAG_LOG;
    else process.env.RDLC_NATIVE_DRAG_LOG = previousLog;
    try {
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      result = { ...result, status: 'failed', cleanupError: String(error) };
      failure = failure
        ? new AggregateError(
            [failure, error],
            'Native drag probe and fixture cleanup failed',
          )
        : error;
    }
    try {
      await writeFile(
        join(artifacts, 'probe.json'),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    } catch (error) {
      failure = failure
        ? new AggregateError(
            [failure, error],
            'Native drag probe and evidence write failed',
          )
        : error;
    }
  }
  if (failure) throw failure;
});
