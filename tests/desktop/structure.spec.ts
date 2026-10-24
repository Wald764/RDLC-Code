import { test, expect } from 'playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchTrustedDesktop } from './driver.js';

test('structure: 100 real native selections agree with canvas and retain zoom and exact source', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const artifacts = resolve(
    process.env.RDLC_DESKTOP_ARTIFACT_DIR ?? '.vscode-test/desktop-artifacts',
    'structure',
  );
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(
    resolve(root, '.vscode-test/sidebar-structure-'),
  );
  const fixture = join(directory, 'native-structure.rdlc');
  const blank = await readFile(
    resolve(root, 'tests/fixtures/datasets/blank.rdlc'),
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
  await writeFile(fixture, original);
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
      .filter({ hasText: 'native-structure.rdlc' })
      .first()
      .click();
    await expect(
      driver.page.locator('.quick-input-widget:visible'),
    ).toBeHidden();
    await driver.command('Focus on Report Structure View');
    await driver.page
      .getByRole('treeitem', { name: /^Textbox: First/ })
      .click();
    const frame = await driver.designerFrame();
    const initialPrimary = driver.page.getByRole('treeitem', {
      name: /^Textbox: First, Primary/,
    });
    await expect(initialPrimary).toBeVisible();
    expect(await initialPrimary.getAttribute('aria-label')).toBe(
      'Textbox: First, Primary, 1 selected',
    );
    await driver.page.evaluate(() => {
      type Action = {
        id: number;
        target: string;
        start: number;
        nativeAt?: number;
      };
      const probe = { next: 0, actions: [] as Action[] };
      Object.assign(window, { __rdlcNativeSelectionProbe: probe });
      const check = () => {
        const action = probe.actions.find((entry) => !entry.nativeAt);
        if (!action) return;
        const expected = `Textbox: ${action.target}, Primary, 1 selected`;
        const row = [...document.querySelectorAll('[role="treeitem"]')].find(
          (element) => element.getAttribute('aria-label') === expected,
        );
        if (row && row.getClientRects().length > 0)
          action.nativeAt = Date.now();
      };
      document.addEventListener(
        'pointerdown',
        (event) => {
          const text =
            (event.target as Element | null)
              ?.closest('[role="treeitem"]')
              ?.getAttribute('aria-label') ?? '';
          const target = text.includes('Second')
            ? 'Second'
            : text.includes('First')
              ? 'First'
              : null;
          if (target)
            probe.actions.push({
              id: ++probe.next,
              target,
              start: Date.now(),
            });
        },
        true,
      );
      new MutationObserver(check).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label', 'class'],
      });
    });
    await frame.evaluate(() => {
      const states: { target: string; at: number }[] = [];
      Object.assign(window, { __rdlcCanvasSelectionProbe: states });
      const read = () => {
        const primary = document.querySelector('.item.primary');
        if (primary?.getClientRects().length)
          states.push({
            target: primary.textContent?.trim() ?? '',
            at: Date.now(),
          });
      };
      new MutationObserver(read).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      read();
    });
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const name = i % 2 === 0 ? 'Second' : 'First';
      await driver.page
        .getByRole('treeitem', { name: new RegExp(`^Textbox: ${name}`) })
        .click();
      await expect(
        driver.page.getByRole('treeitem', {
          name: new RegExp(`^Textbox: ${name}, Primary, 1 selected$`),
        }),
      ).toBeVisible();
      await expect(frame.locator('.selection-frame')).toHaveCount(1);
      await expect(frame.locator('.item.primary .content')).toHaveText(name);
      const action = await driver.page.evaluate((id) => {
        const probe = (
          window as unknown as {
            __rdlcNativeSelectionProbe: {
              actions: {
                id: number;
                target: string;
                start: number;
                nativeAt?: number;
              }[];
            };
          }
        ).__rdlcNativeSelectionProbe;
        return probe.actions.find((entry) => entry.id === id);
      }, i + 1);
      expect(action?.target).toBe(name);
      expect(action?.nativeAt).toBeDefined();
      const canvasAt = await frame.evaluate(
        ({ start, target }) => {
          const states = (
            window as unknown as {
              __rdlcCanvasSelectionProbe: { target: string; at: number }[];
            }
          ).__rdlcCanvasSelectionProbe;
          return states.find(
            (state) => state.at >= start && state.target === target,
          )?.at;
        },
        { start: action!.start, target: name },
      );
      expect(canvasAt).toBeDefined();
      samples.push(Math.max(action!.nativeAt!, canvasAt!) - action!.start);
      await expect(
        frame.getByRole('spinbutton', { name: 'Zoom percent' }),
      ).toHaveValue('100');
    }
    await writeFile(
      join(artifacts, 'selection-timings.json'),
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
    await driver.page
      .getByRole('treeitem', { name: /^Textbox: Second/ })
      .click({ modifiers: [modifier] });
    await expect(
      driver.page.getByRole('treeitem', {
        name: /^Textbox: Second, Primary, 2 selected$/,
      }),
    ).toBeVisible();
    await expect(
      driver.page.getByRole('treeitem', {
        name: /^Textbox: First, Selected, 2 selected$/,
      }),
    ).toBeVisible();
    await expect(frame.locator('.item.selected')).toHaveCount(2);
    await driver.page.keyboard.press(`${modifier}+s`);
    expect(await readFile(fixture, 'utf8')).toBe(original);
    await driver.capture('native-structure-selection');
    expect(samples.filter((time) => time <= 200).length).toBeGreaterThanOrEqual(
      95,
    );
  } finally {
    await driver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
