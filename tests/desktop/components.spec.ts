import { test, expect } from 'playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchTrustedDesktop } from './driver.js';

test('components: native filter/cancel/unavailable rows and automatic unbound table preserve one-step history', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'components',
  );
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(
    resolve(root, '.vscode-test/sidebar-components-'),
  );
  const fixture = join(directory, 'native-components.rdlc');
  const original = await readFile(
    resolve(root, 'tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  await writeFile(fixture, original);
  const driver = await launchTrustedDesktop({
    root,
    version: process.env.VSCODE_VERSION ?? '1.142.0',
    packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
    artifactDir: artifacts,
  });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const filter = async (query: string, cancel = false) => {
    await driver.page.getByText('Components', { exact: true }).first().hover();
    await driver.page
      .getByLabel('RDLC Code: Filter Components', { exact: true })
      .click();
    const input = driver.page.locator(
      '.quick-input-widget:visible .quick-input-box input',
    );
    await input.fill(query);
    await input.press(cancel ? 'Escape' : 'Enter');
    await expect(
      driver.page.locator('.quick-input-widget:visible'),
    ).toBeHidden();
  };
  try {
    await driver.page.keyboard.press(`${modifier}+p`);
    await driver.page.keyboard.insertText(fixture);
    await driver.page
      .locator('.quick-input-widget:visible .monaco-list-row')
      .filter({ hasText: 'native-components.rdlc' })
      .first()
      .click();
    await expect(
      driver.page.locator('.quick-input-widget:visible'),
    ).toBeHidden();
    await driver.command('Focus on Components View');
    await filter('no matching component');
    await expect(
      driver.page.getByRole('treeitem', {
        name: 'No components match. Use Clear Filter.',
      }),
    ).toBeVisible();
    await driver.page.getByText('Components', { exact: true }).first().hover();
    await driver.page
      .getByLabel('RDLC Code: Clear Filter', { exact: true })
      .click();
    await expect(
      driver.page.getByRole('treeitem', { name: /^Textbox, Insert/ }),
    ).toBeVisible();
    for (const name of [
      'Image',
      'Line',
      'Chart',
      'Subreport',
      'Rectangle',
      'List',
      'Matrix',
      'Parameter',
    ]) {
      await filter(name);
      const row = driver.page.getByRole('treeitem', {
        name: new RegExp(`^${name}, Unavailable\\.`),
      });
      await expect(row).toBeVisible();
      await row.click();
      await driver.page.keyboard.press('Enter');
      expect(await readFile(fixture, 'utf8')).toBe(original);
    }
    await filter('  tAbL  ');
    await expect(
      driver.page.getByRole('treeitem', { name: /^Table, Insert/ }),
    ).toBeVisible();
    await expect(
      driver.page.getByRole('treeitem', { name: /^Textbox, Insert/ }),
    ).toHaveCount(0);
    await filter('Textbox', true);
    await expect(
      driver.page.getByRole('treeitem', { name: /^Table, Insert/ }),
    ).toBeVisible();
    await driver.page.getByRole('treeitem', { name: /^Table, Insert/ }).click();
    const frame = await driver.designerFrame();
    await expect(
      frame.getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue('Table1');
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).not.toBe(original);
    const created = await readFile(fixture, 'utf8');
    const table = created.match(
      /<Tablix Name="Table1">[\s\S]*?<\/Tablix>/,
    )?.[0];
    expect(table).toBeTruthy();
    expect(created.replace(table!, '')).toBe(original);
    expect(table!.match(/<TablixColumn>/g)).toHaveLength(2);
    expect(table!.match(/<Width>1in<\/Width>/g)).toHaveLength(2);
    expect(table!.match(/<TablixRow>/g)).toHaveLength(2);
    expect(table!.match(/<Height>0.25in<\/Height>/g)).toHaveLength(2);
    expect(table!.match(/<TablixCell>/g)).toHaveLength(4);
    expect(table).not.toContain('<DataSetName>');
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    await frame.getByRole('button', { name: 'Redo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(created);
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    await driver.command('View: Toggle Primary Side Bar Visibility');
    await expect(driver.page.locator('.part.sidebar')).toBeHidden();
    await frame
      .getByRole('button', { name: 'Components', exact: true })
      .click();
    const card = frame.locator('[data-card="Textbox"]');
    await expect(card).toBeVisible();
    await card.dragTo(frame.locator('.body'), {
      targetPosition: { x: 350, y: 80 },
    });
    await expect(
      frame.getByRole('textbox', { name: 'Name', exact: true }),
    ).toHaveValue('Textbox1');
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).not.toBe(original);
    const dragged = await readFile(fixture, 'utf8');
    const textbox = dragged.match(
      /<Textbox Name="Textbox1">[\s\S]*?<\/Textbox>/,
    )?.[0];
    expect(textbox).toBeTruthy();
    expect(textbox).toContain('<Width>1in</Width><Height>0.25in</Height>');
    expect(dragged.replace(textbox!, '')).toBe(original);
    await expect(driver.page.locator('.part.sidebar')).toBeHidden();
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await driver.page.keyboard.press(`${modifier}+s`);
    await expect.poll(() => readFile(fixture, 'utf8')).toBe(original);
    await driver.capture('native-filter-and-table');
  } finally {
    await driver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
