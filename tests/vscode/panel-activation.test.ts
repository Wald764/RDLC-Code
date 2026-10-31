import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { closeOwnedEditors } from './lifecycle.test.js';
import { until } from './session-checks.js';
import { activateHistoryTarget } from '../../apps/vscode-extension/src/panel-activation.js';

const type = 'rdlcTests.panelActivation';

/** A panel whose ownership flags the test controls and whose reveals are recorded. */
interface ControlledPanel {
  readonly panel: vscode.WebviewPanel;
  readonly reveals: unknown[][];
  state: { active: boolean };
}

function stubPanel(active: boolean): ControlledPanel {
  const state = { active };
  const reveals: unknown[][] = [];
  const panel = {
    get active() {
      return state.active;
    },
    visible: true,
    viewColumn: vscode.ViewColumn.One,
    reveal: (...args: unknown[]) => void reveals.push(args),
  } as unknown as vscode.WebviewPanel;
  return { panel, reveals, state };
}

const pause = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

export async function run(): Promise<void> {
  const source = readFileSync(
    resolve(__dirname, '../../../tests/fixtures/datasets/blank.rdlc'),
    'utf8',
  );
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-panel-activation-'));
  const file = join(directory, 'report.rdlc');
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  const real: vscode.WebviewPanel[] = [];
  const registration = vscode.window.registerCustomEditorProvider(
    type,
    {
      resolveCustomTextEditor(_document, panel) {
        panel.webview.html = '<html><body>Panel activation proof</body></html>';
        real.push(panel);
      },
    },
    { supportsMultipleEditorsPerDocument: true },
  );
  let failure: unknown;
  let failed = false;
  try {
    await inactivePanelIsNeverRevealed(document);
    await lapsedRequestIsNeverRevealed(document);
    await panelBecomingActiveIsAwaited(document, real);
  } catch (error) {
    failed = true;
    failure = error;
  }
  const cleanup: unknown[] = [];
  try {
    registration.dispose();
  } catch (error) {
    cleanup.push(error);
  }
  cleanup.push(...(await closeOwnedEditors(directory)));
  try {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    cleanup.push(error);
  }
  if (failed && cleanup.length)
    throw new AggregateError(
      [failure, ...cleanup],
      'panelActivation and cleanup failed',
    );
  if (failed) throw failure;
  if (cleanup.length)
    throw new AggregateError(cleanup, 'panelActivation cleanup failed');
}

async function inactivePanelIsNeverRevealed(
  document: vscode.TextDocument,
): Promise<void> {
  const stub = stubPanel(false);
  const result = await activateHistoryTarget(document, stub.panel, type);
  assert.equal(result, false, 'a panel that never becomes active is refused');
  assert.equal(stub.reveals.length, 0, 'an inactive panel is never revealed');
}

async function lapsedRequestIsNeverRevealed(
  document: vscode.TextDocument,
): Promise<void> {
  // The request lapses while the panel is awaited: it is checked only once the
  // panel is active, right before the reveal.
  const stub = stubPanel(false);
  let checks = 0;
  const pending = activateHistoryTarget(document, stub.panel, type, () => {
    checks++;
    return false;
  });
  await pause(100);
  assert.equal(checks, 0, 'the request is not checked while the panel waits');
  stub.state.active = true;
  assert.equal(await pending, false, 'a lapsed request is refused');
  assert.equal(checks, 1, 'the request is checked once the panel is active');
  assert.equal(stub.reveals.length, 0, 'a lapsed request never reveals');
}

async function panelBecomingActiveIsAwaited(
  document: vscode.TextDocument,
  real: vscode.WebviewPanel[],
): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', document.uri, type, {
    viewColumn: vscode.ViewColumn.One,
  });
  await until(() => real.length === 1, 'the real custom editor resolves');
  const actual = real[0]!;
  await until(
    () => actual.active && actual.visible,
    'the real custom editor tab is active',
  );
  // The real tab backs the workbench-side checks; only the activity flag the
  // activation waits on is held back and released by the test.
  let released = false;
  const reveals: unknown[][] = [];
  const gated = {
    get active() {
      return released && actual.active;
    },
    get visible() {
      return actual.visible;
    },
    get viewColumn() {
      return actual.viewColumn;
    },
    reveal: (...args: unknown[]) => {
      reveals.push(args);
      (actual.reveal as (...a: unknown[]) => void)(...args);
    },
  } as unknown as vscode.WebviewPanel;
  let wanted = 0;
  let settled: boolean | undefined;
  const pending = activateHistoryTarget(document, gated, type, () => {
    wanted++;
    return true;
  }).then((value) => (settled = value));
  await pause(150);
  assert.equal(settled, undefined, 'activation waits for the panel');
  assert.equal(reveals.length, 0, 'nothing is revealed while waiting');
  released = true;
  await pending;
  assert.equal(settled, true, 'activation resolves once the panel is active');
  assert.equal(wanted, 1, 'the request is checked once');
  assert.equal(reveals.length, 1, 'the active panel is revealed once');
}
