import { test, expect } from 'playwright/test';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchTrustedDesktop, type DesktopDriver } from './driver.js';
import {
  environmentFromDriver,
  referenceEnvironmentReasons,
  type EnvironmentIdentity,
} from './evidence.js';

function readOsRelease(): string {
  try {
    return readFileSync('/etc/os-release', 'utf8');
  } catch {
    return '';
  }
}

/** Installed font families as seen by fontconfig; empty when unavailable. */
function systemFonts(): string {
  try {
    const families = execFileSync('fc-list', [':', 'family'], {
      encoding: 'utf8',
      timeout: 10_000,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return [...new Set(families)].sort().join('; ');
  } catch {
    return '';
  }
}

test('bootstrap: real Desktop insertion, source oracle, Undo, semantics and pixels', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ??
      resolve(root, '.vscode-test/desktop-artifacts'),
    'bootstrap',
  );
  await mkdir(artifacts, { recursive: true });
  const workspace = await mkdtemp(
    resolve(root, '.vscode-test/desktop-fixture-'),
  );
  const fixture = join(workspace, 'bootstrap.rdlc');
  await copyFile(resolve(root, 'tests/fixtures/datasets/blank.rdlc'), fixture);
  const original = await readFile(fixture, 'utf8');
  // Independent expected source: no production parser, serializer or session is used.
  const inserted =
    '<Textbox Name="Textbox1"><Paragraphs><Paragraph><TextRuns><TextRun><Value></Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>20pt</Left><Top>20pt</Top><Width>1in</Width><Height>0.25in</Height></Textbox>';
  const expected = original.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems>${inserted}</ReportItems>`,
  );
  expect(expected).not.toBe(original);
  const capabilities: Record<string, string> = {
    launch: 'unrun',
    nativeInput: 'unrun',
    angular: 'unrun',
    geometry: 'unrun',
    source: 'unrun',
    undo: 'unrun',
    accessibility: 'unrun',
    screenshotComparison: 'unrun',
    cleanup: 'unrun',
  };
  // The security observer capability is derived by the runner from the same-run
  // security-observer spec; bootstrap never claims it.
  const updating = process.env.RDLC_DESKTOP_UPDATE_BASELINES === 'true';
  let environment: EnvironmentIdentity | undefined;
  let visualReasons: string[] = [];
  let screenshotReason: string | null = null;
  let driver: DesktopDriver | undefined;
  let error: string | undefined;
  let cleanupError: string | undefined;
  const failures: unknown[] = [];
  try {
    capabilities.launch = 'failed';
    driver = await launchTrustedDesktop({
      root,
      version: process.env.VSCODE_VERSION ?? '1.142.0',
      packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
      artifactDir: artifacts,
    });
    capabilities.launch = 'passed';
    capabilities.nativeInput = 'failed';
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.page.keyboard.press(`${modifier}+p`);
    await driver.page.keyboard.insertText(fixture);
    await driver.page
      .locator('.quick-input-widget:visible .monaco-list-row')
      .filter({ hasText: 'bootstrap.rdlc' })
      .first()
      .click();
    await expect(driver.page.locator('.quick-input-box input')).toBeHidden();
    const row = driver.page
      .getByRole('treeitem', { name: /bootstrap\.rdlc/ })
      .first();
    await expect(row).toBeVisible();
    await row.dblclick();
    capabilities.nativeInput = 'passed';
    capabilities.angular = 'failed';
    await driver.command('RDLC Code: Open Designer');
    const frame = await driver.designerFrame();
    const textbox = frame.locator('[data-card="Textbox"]');
    if (!(await textbox.isVisible()))
      await frame
        .getByRole('button', { name: 'Components', exact: true })
        .click();
    await expect(textbox).toBeVisible();
    await textbox.click();
    await expect(
      frame.getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue('Textbox1');
    capabilities.angular = 'passed';
    capabilities.geometry = 'failed';
    await expect(frame.locator('.page')).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
    const item = frame.locator('.body > .item[data-kind="textbox"]');
    await expect(item).toHaveCount(1);
    await expect(item).toBeVisible();
    const geometry = await item.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const body = element.parentElement!.getBoundingClientRect();
      return {
        left: bounds.left - body.left,
        top: bounds.top - body.top,
        width: bounds.width,
        height: bounds.height,
      };
    });
    // Independent CSS-pixel oracle: 96px/in and 72pt/in at the fresh 100% zoom.
    const expectedGeometry = {
      left: (20 * 96) / 72,
      top: (20 * 96) / 72,
      width: 96,
      height: 24,
    };
    await writeFile(
      join(artifacts, 'inserted-geometry.json'),
      `${JSON.stringify({ actual: geometry, expected: expectedGeometry, toleranceCssPx: 0.1 }, null, 2)}\n`,
    );
    for (const key of ['left', 'top', 'width', 'height'] as const)
      expect(
        Math.abs(geometry[key] - expectedGeometry[key]),
        key,
      ).toBeLessThanOrEqual(0.1);
    capabilities.geometry = 'passed';
    capabilities.source = 'failed';
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(expected);
    capabilities.source = 'passed';
    capabilities.undo = 'failed';
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    capabilities.undo = 'passed';
    capabilities.accessibility = 'failed';
    const semantics = await frame.locator('body').ariaSnapshot();
    expect(semantics).toContain('Report design surface');
    expect(semantics).toContain('Textbox');
    await writeFile(join(artifacts, 'designer-accessibility.yml'), semantics);
    capabilities.accessibility = 'passed';
    await driver.capture('bootstrap');
    environment = environmentFromDriver(
      driver.identity,
      readOsRelease(),
      systemFonts(),
    );
    visualReasons = referenceEnvironmentReasons(environment);
    if (visualReasons.length === 0) {
      // Pinned reference environment: a missing or different reference fails
      // (updateSnapshots stays 'none'); only an explicit --update-baselines run,
      // which the runner rejects in CI, may write it.
      capabilities.screenshotComparison = 'failed';
      await expect(driver.page).toHaveScreenshot(
        ['bootstrap', 'bootstrap.png'],
        { threshold: 0.1, maxDiffPixelRatio: 0.001 },
      );
      capabilities.screenshotComparison = 'passed';
      if (updating) {
        const baseline = resolve(
          root,
          'tests/desktop/baselines/bootstrap/bootstrap.png',
        );
        await writeFile(
          resolve(baseline, '../bootstrap.metadata.json'),
          `${JSON.stringify(
            {
              schemaVersion: 1,
              reference: 'tests/desktop/baselines/bootstrap/bootstrap.png',
              sha256: createHash('sha256')
                .update(await readFile(baseline))
                .digest('hex'),
              environment,
              vscode: {
                version: driver.identity.version,
                build: driver.identity.build,
                executableSha256: driver.identity.executableSha256,
              },
              driver: driver.identity['driver'],
              tolerances: { threshold: 0.1, maxDiffPixelRatio: 0.001 },
              generatedAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
        );
      }
    } else if (updating) {
      throw new Error(
        `--update-baselines refused: non-reference environment (${visualReasons.join('; ')})`,
      );
    } else {
      // No pixel reference exists for this environment: never a pass.
      screenshotReason = 'non-reference environment';
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    failures.push(caught);
  } finally {
    try {
      capabilities.cleanup = driver ? 'failed' : 'unrun';
      await driver?.close();
      await rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      capabilities.cleanup = driver ? 'passed' : 'unrun';
    } catch (caught) {
      cleanupError = caught instanceof Error ? caught.message : String(caught);
      failures.push(caught);
    } finally {
      await writeFile(
        join(artifacts, 'probe.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            fixture: {
              id: 'local-blank',
              sha256: createHash('sha256').update(original).digest('hex'),
            },
            oracle: {
              sha256: createHash('sha256').update(expected).digest('hex'),
              outsideFootprint:
                'exact source equality outside the single ReportItems insertion',
            },
            assertion:
              'tests/desktop/bootstrap.spec.ts::bootstrap: real Desktop insertion, source oracle, Undo, semantics and pixels',
            identity: driver?.identity ?? null,
            environment: environment ?? null,
            visual: {
              referenceEnvironment: !!environment && visualReasons.length === 0,
              eligible: capabilities.screenshotComparison === 'passed',
              status: screenshotReason
                ? 'unvalidated: non-reference environment'
                : capabilities.screenshotComparison,
              reasons: visualReasons,
              baselineGeneration: updating,
            },
            screenshotReason,
            capabilities,
            error: error ?? null,
            cleanupError: cleanupError ?? null,
            // Functional capabilities only; pixels gate the reference environment
            // alone and securityObserver is merged by the runner.
            validated: Object.entries(capabilities).every(
              ([key, value]) =>
                value ===
                (key === 'screenshotComparison' && screenshotReason
                  ? 'unrun'
                  : 'passed'),
            ),
          },
          null,
          2,
        )}\n`,
      );
    }
  }
  if (failures.length) throw failures[0];
});
