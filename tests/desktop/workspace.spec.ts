import { test, expect } from 'playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launchTrustedDesktop } from './driver.js';

test('workspace: native container activates before a designer and inserts through the captured source document', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'workspace',
  );
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(
    resolve(root, '.vscode-test/sidebar-workspace-'),
  );
  const fixture = join(directory, 'native-workspace.rdlc');
  await copyFile(resolve(root, 'tests/fixtures/datasets/blank.rdlc'), fixture);
  const original = await readFile(fixture, 'utf8');
  const inserted =
    '<Textbox Name="Textbox1"><Paragraphs><Paragraph><TextRuns><TextRun><Value></Value></TextRun></TextRuns></Paragraph></Paragraphs><Left>20pt</Left><Top>20pt</Top><Width>1in</Width><Height>0.25in</Height></Textbox>';
  const expected = original.replace(
    '<ReportItems></ReportItems>',
    `<ReportItems>${inserted}</ReportItems>`,
  );
  const driver = await launchTrustedDesktop({
    root,
    version: process.env.VSCODE_VERSION ?? '1.142.0',
    packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
    artifactDir: artifacts,
  });
  try {
    const activity = driver.page
      .locator('.activitybar [aria-label^="RDLC Code"]')
      .first();
    await expect(activity).toBeVisible();
    await activity.click();
    for (const label of ['Report Structure', 'Report Data', 'Components'])
      await expect(
        driver.page.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    await expect(
      driver.page
        .getByText('Open or create a report to begin.', { exact: true })
        .first(),
    ).toBeVisible();
    expect(
      driver.page
        .frames()
        .some(
          (frame) =>
            frame.url().includes('index.html') &&
            frame.url().includes('vscode-webview'),
        ),
    ).toBe(false);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await driver.page.keyboard.press(`${modifier}+p`);
    await driver.page.keyboard.insertText(fixture);
    await driver.page
      .locator('.quick-input-widget:visible .monaco-list-row')
      .filter({ hasText: 'native-workspace.rdlc' })
      .first()
      .click();
    await expect(
      driver.page.locator('.quick-input-widget:visible'),
    ).toBeHidden();
    await expect(
      driver.page.getByText('Report Structure', { exact: true }).first(),
    ).toBeVisible();
    const textbox = driver.page.getByRole('treeitem', {
      name: /^Textbox, Insert/,
    });
    await expect(textbox).toBeVisible();
    await textbox.click();
    const frame = await driver.designerFrame();
    await expect(
      frame.getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue('Textbox1');
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(expected);
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    await driver.command('Focus on Components View');
    await driver.page.keyboard.press('End');
    await driver.page.keyboard.press('ArrowUp');
    await driver.page.keyboard.press('Enter');
    await expect(
      frame.getByRole('textbox', { name: 'Dataset name', exact: true }),
    ).toHaveValue('DataSet1');
    await driver.page.keyboard.press(`${modifier}+s`);
    const datasetSource = original.replace(
      '</Report>',
      '<DataSets><DataSet Name="DataSet1"><CaseSensitivity>Auto</CaseSensitivity></DataSet></DataSets></Report>',
    );
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(datasetSource);
    await expect(
      driver.page.getByRole('treeitem', { name: /^DataSet: DataSet1/ }),
    ).toBeVisible();
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    await driver.capture('native-workspace');
  } finally {
    await driver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
