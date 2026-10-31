import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { closeOwnedEditors } from './lifecycle.test.js';
import { until } from './session-checks.js';
import {
  focusProbeHtml,
  focusProbeWebviewOptions,
} from './focus-probe-webview.js';
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
        panel.webview.options = focusProbeWebviewOptions;
        panel.webview.html = focusProbeHtml('Panel activation proof');
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
    await historyNeedsTheWebviewToOwnDomFocus(document, real);
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
    webview: actual.webview,
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

/**
 * A real, active, revealed designer tab whose webview is replaced by a scripted
 * one: the workbench-side checks hold, only the DOM focus attestation varies.
 */
async function withFocusAnswers(
  document: vscode.TextDocument,
  real: vscode.WebviewPanel[],
  answer: (probeIndex: number) => boolean | undefined,
  /** Also deliver an attestation for another probe ID before each answer. */
  stale = false,
): Promise<{ result: boolean; probes: number; elapsed: number }> {
  const actual = real[0]!;
  await until(
    () => actual.active && actual.visible,
    'the real custom editor tab is active',
  );
  const answers = new vscode.EventEmitter<unknown>();
  let probes = 0;
  const webview = {
    onDidReceiveMessage: answers.event,
    postMessage: async (message: { kind: string; probeId: string }) => {
      assert.equal(message.kind, 'focusProbe');
      const focused = answer(probes++);
      if (stale)
        setTimeout(
          () =>
            answers.fire({
              protocol: 2,
              kind: 'focusProbeResult',
              probeId: `stale-${message.probeId}`,
              focused: true,
            }),
          5,
        );
      if (focused !== undefined)
        setTimeout(
          () =>
            answers.fire({
              protocol: 2,
              kind: 'focusProbeResult',
              probeId: message.probeId,
              focused,
            }),
          10,
        );
      return true;
    },
  };
  const panel = {
    get active() {
      return actual.active;
    },
    get visible() {
      return actual.visible;
    },
    get viewColumn() {
      return actual.viewColumn;
    },
    webview,
    reveal: (...args: unknown[]) =>
      (actual.reveal as (...a: unknown[]) => void)(...args),
  } as unknown as vscode.WebviewPanel;
  const started = Date.now();
  const result = await activateHistoryTarget(document, panel, type);
  answers.dispose();
  return { result, probes, elapsed: Date.now() - started };
}

async function historyNeedsTheWebviewToOwnDomFocus(
  document: vscode.TextDocument,
  real: vscode.WebviewPanel[],
): Promise<void> {
  // The workbench routes undo by DOM focus: a panel that is active and the
  // active tab, but whose webview does not own DOM focus, is never a target.
  const never = await withFocusAnswers(document, real, () => false);
  assert.equal(never.result, false, 'a webview without DOM focus is refused');
  assert.ok(never.probes >= 1, 'the webview was asked');
  const silent = await withFocusAnswers(document, real, () => undefined);
  assert.equal(silent.result, false, 'a webview that never answers is refused');
  assert.equal(silent.probes, 1, 'an unanswered probe is not repeated');
  assert.ok(
    silent.elapsed < 4_000,
    `refusal is bounded (${silent.elapsed} ms)`,
  );
  // Focus lands asynchronously after the focus command: it is awaited, not assumed.
  // An attestation for another probe (stale or foreign) proves nothing.
  const stale = await withFocusAnswers(document, real, () => undefined, true);
  assert.equal(stale.result, false, 'a wrong probe ID is ignored');
  const staleFalse = await withFocusAnswers(document, real, () => false, true);
  assert.equal(staleFalse.result, false, 'a wrong probe ID never outvotes');
  const late = await withFocusAnswers(document, real, (i) => i >= 2);
  assert.equal(late.result, true, 'focus arriving later is accepted');
  assert.equal(late.probes, 3, 'the webview is read until it owns focus');
  const owned = await withFocusAnswers(document, real, () => true);
  assert.equal(owned.result, true, 'a webview owning DOM focus is accepted');
  assert.equal(owned.probes, 1);
  // The real scripted webview answers from its own frame.
  const actual = real[0]!;
  assert.equal(
    await activateHistoryTarget(document, actual, type),
    true,
    'the real webview owns DOM focus after activation',
  );
  // And it tells the truth once a code editor takes DOM focus: the same
  // panel stays visible in its group, yet is no longer the focus owner.
  const other = join(dirname(document.uri.fsPath), 'other.rdlc');
  writeFileSync(other, document.getText());
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(other),
    vscode.ViewColumn.Two,
  );
  // The workbench moves DOM focus asynchronously: poll for the answer.
  let focused = true;
  const deadline = Date.now() + 10_000;
  while (focused && Date.now() < deadline) {
    focused = await probeRealWebview(actual);
    if (focused) await pause(25);
  }
  assert.equal(
    focused,
    false,
    'the designer webview does not own DOM focus while a code editor does',
  );
}

let realProbes = 0;
function probeRealWebview(panel: vscode.WebviewPanel): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probeId = `real-probe-${realProbes++}`;
    const timer = setTimeout(() => {
      listener.dispose();
      reject(new Error('the real webview never answered the focus probe'));
    }, 10_000);
    const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
      const answer = message as {
        kind?: string;
        probeId?: string;
        focused?: boolean;
      };
      if (answer.kind !== 'focusProbeResult' || answer.probeId !== probeId)
        return;
      clearTimeout(timer);
      listener.dispose();
      resolve(answer.focused === true);
    });
    void panel.webview.postMessage({
      protocol: 2,
      kind: 'focusProbe',
      probeId,
    });
  });
}
