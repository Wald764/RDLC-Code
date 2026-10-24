import { test, expect } from 'playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchTrustedDesktop } from './driver.js';

test('data: native field selection edits all seven existing types with exact XML and one Undo', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'data',
  );
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(resolve(root, '.vscode-test/sidebar-data-'));
  const fixture = join(directory, 'native-data.rdlc');
  const blank = await readFile(
    resolve(root, 'tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  const original = blank.replace(
    '</Report>',
    '<DataSets><DataSet Name="Orders"><Fields><Field Name="Id"><DataField>Id</DataField><rd:TypeName xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">System.Int64</rd:TypeName></Field></Fields></DataSet></DataSets></Report>',
  );
  await writeFile(fixture, original);
  const types = [
    ['text', 'System.String'],
    ['Boolean', 'System.Boolean'],
    ['Int32', 'System.Int32'],
    ['Int64', 'System.Int64'],
    ['decimal', 'System.Decimal'],
    ['double', 'System.Double'],
    ['date/time', 'System.DateTime'],
  ] as const;
  const driver = await launchTrustedDesktop({
    root,
    version: process.env.VSCODE_VERSION ?? '1.142.0',
    packaged: process.env.RDLC_DESKTOP_PACKAGED === 'true',
    artifactDir: artifacts,
  });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  try {
    await driver.page.keyboard.press(`${modifier}+p`);
    await driver.page.keyboard.insertText(fixture);
    await driver.page
      .locator('.quick-input-widget:visible .monaco-list-row')
      .filter({ hasText: 'native-data.rdlc' })
      .first()
      .click();
    await expect(
      driver.page.locator('.quick-input-widget:visible'),
    ).toBeHidden();
    await driver.command('Focus on Report Data View');
    await driver.page.getByRole('treeitem', { name: /^Field: Id/ }).click();
    await driver.page
      .getByRole('treeitem', { name: /^Field: Id, Selected/ })
      .click({ button: 'right' });
    await driver.page.keyboard.press('End');
    await driver.page.keyboard.press('Enter');
    await expect(
      driver.page.getByRole('menuitem', { name: /Properties/ }),
    ).toBeHidden();
    const frame = await driver.designerFrame();
    const fieldType = frame.getByRole('combobox', {
      name: 'Field type',
      exact: true,
    });
    await expect(fieldType).toHaveValue('Int64');
    await expect(frame.locator('.selection-frame')).toHaveCount(0);
    const initialScroll = await frame
      .locator('.viewport')
      .evaluate((element) => [element.scrollLeft, element.scrollTop]);
    let previous = 'System.Int64';
    let expected = original;
    for (const [label, type] of types) {
      await fieldType.selectOption(label);
      await frame
        .getByRole('button', { name: 'Set type', exact: true })
        .click();
      await expect(fieldType).toHaveValue(label);
      const next = expected.replace(
        `>${previous}</rd:TypeName>`,
        `>${type}</rd:TypeName>`,
      );
      expect(next).not.toBe(expected);
      await driver.page.keyboard.press(`${modifier}+s`);
      await expect.poll(() => readFile(fixture, 'utf8')).toBe(next);
      await frame.getByRole('button', { name: 'Undo', exact: true }).click();
      await driver.page.keyboard.press(`${modifier}+s`);
      await expect.poll(() => readFile(fixture, 'utf8')).toBe(expected);
      await frame.getByRole('button', { name: 'Redo', exact: true }).click();
      await driver.page.keyboard.press(`${modifier}+s`);
      await expect.poll(() => readFile(fixture, 'utf8')).toBe(next);
      // History clears ambiguous local selection; explicitly choose the current native field again.
      await driver.command('Focus on Report Data View');
      await driver.page.getByRole('treeitem', { name: /^Field: Id/ }).click();
      await driver.page
        .getByRole('treeitem', { name: /^Field: Id, Selected/ })
        .click({ button: 'right' });
      await driver.page.keyboard.press('End');
      await driver.page.keyboard.press('Enter');
      await expect(
        driver.page.getByRole('menuitem', { name: /Properties/ }),
      ).toBeHidden();
      await expect(fieldType).toHaveValue(label);
      await expect(frame.locator('.selection-frame')).toHaveCount(0);
      expect(
        await frame
          .locator('.viewport')
          .evaluate((element) => [element.scrollLeft, element.scrollTop]),
      ).toEqual(initialScroll);
      previous = type;
      expected = next;
    }
    await driver.capture('native-seven-field-types');
  } finally {
    await driver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
