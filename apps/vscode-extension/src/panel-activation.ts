import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { validateMessage } from '@rdlc/report-model/protocol';

/** How long the workbench may take to settle on the revealed panel. */
const SETTLE_TIMEOUT_MS = 2_000;
const SETTLE_POLL_MS = 25;
/**
 * The DOM focus attestation has its own budget for the reads that follow the
 * settle phase, which keeps its whole shared deadline. The overall bound of a
 * history activation is therefore `SETTLE_TIMEOUT_MS + FOCUS_PROBE_TIMEOUT_MS`.
 */
const FOCUS_PROBE_TIMEOUT_MS = 1_000;

/** Where an activation stopped, for diagnostics only. */
export interface ActivationReport {
  /** `active`: panel never active; `wanted`: request lapsed; `probe`: DOM focus
   *  not attested; `settle`: tab never settled after the focus handoff;
   *  `done`: accepted. */
  readonly phase: 'active' | 'wanted' | 'probe' | 'settle' | 'done';
  /** Answers read from the webview, in order. */
  readonly probes: readonly ProbeAnswer[];
}
export type ProbeAnswer = 'focused' | 'unfocused' | 'unanswered';

export interface HistoryActivationOptions {
  /**
   * The request itself says the designer owned DOM focus when the user issued
   * it (see `HistoryRequestMessage.focused`): no probe round trip is needed.
   */
  readonly attested?: boolean;
  /** Told where the activation stopped and what the webview answered; for diagnostics only. */
  readonly report?: (report: ActivationReport) => void;
}

/**
 * Asks the webview whether its designer frame owns DOM focus. Undo and redo are
 * routed by the workbench from DOM focus alone: a code editor holding text focus
 * (or a focused text input) takes the command before the custom editor does,
 * whatever the active tab says. The extension host cannot read DOM focus, so the
 * webview attests it. A webview that answers `false`, never answers or is gone
 * is not the owner. Only an answer carrying this probe's own ID counts. Resolves
 * within `timeoutMs`.
 */
function probeFocus(
  panel: vscode.WebviewPanel,
  timeoutMs: number,
): Promise<ProbeAnswer> {
  const probeId = `focus-${randomUUID()}`;
  return new Promise<ProbeAnswer>((resolve) => {
    let done = false;
    // Both handlers only run asynchronously, after `timer` and `listener` exist.
    const finish = (value: ProbeAnswer): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      listener.dispose();
      resolve(value);
    };
    const timer = setTimeout(
      () => finish('unanswered'),
      Math.max(timeoutMs, 0),
    );
    const listener = panel.webview.onDidReceiveMessage((input: unknown) => {
      const message = validateMessage(input);
      if (message?.kind === 'focusProbeResult' && message.probeId === probeId)
        finish(message.focused ? 'focused' : 'unfocused');
    });
    panel.webview
      .postMessage({ protocol: 2, kind: 'focusProbe', probeId })
      .then(
        (delivered) => {
          if (!delivered) finish('unanswered');
        },
        () => finish('unanswered'),
      );
  });
}

/**
 * Brings the designer panel to the front and waits until the workbench reports
 * it as the active custom tab. Used where only the focus handoff matters.
 */
export function activateDesignerPanel(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  viewType = 'rdlcCode.designer',
  stillWanted?: () => boolean,
): Promise<boolean> {
  return activate(document, panel, viewType, stillWanted, 'none');
}

/**
 * A panel reveal alone is insufficient: verify the real active custom tab and
 * URI. The workbench applies a reveal and a focus command asynchronously (macOS
 * can lag behind them), so the check is awaited until it holds: a history
 * command sent while the previously active editor still owns the workbench would
 * undo that editor's document instead.
 *
 * The same applies to the request itself: a click inside the webview can reach
 * the host before the workbench has marked the panel active. The panel is first
 * awaited until it becomes active on its own; it is never revealed or focused
 * while inactive, so a document the user is not working in is never targeted.
 * Both phases share one overall deadline; the DOM focus attestation that
 * follows has its own (`FOCUS_PROBE_TIMEOUT_MS`).
 *
 * `stillWanted` is re-checked once the panel is active, right before the reveal
 * and focus: the wait can be long, and a caller whose reason to take focus has
 * lapsed meanwhile must not have it taken late.
 *
 * Active tab and panel state still do not decide where the workbench sends
 * `undo`: DOM focus does, and it can stay in another document's code editor
 * (observed on macOS) while the panel reports active. A history target is
 * therefore accepted only once the webview itself attests that it owns DOM
 * focus (see `probeFocus`); otherwise the request is refused, never run. The
 * attestation is read once the tab settled, after the host's own reveal and
 * focus command.
 *
 * A history request issued by a trusted gesture in the designer already says
 * so (`options.attested`): the designer is the only party that can observe it,
 * and the click-to-undo latency matters, so no probe is made. `options.report`
 * receives where the activation stopped; it is diagnostics only.
 */
export function activateHistoryTarget(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  viewType = 'rdlcCode.designer',
  stillWanted?: () => boolean,
  options: HistoryActivationOptions = {},
): Promise<boolean> {
  return activate(
    document,
    panel,
    viewType,
    stillWanted,
    options.attested === true ? 'attested' : 'probe',
    options.report,
  );
}

async function activate(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  viewType: string,
  stillWanted: (() => boolean) | undefined,
  domFocus: 'none' | 'attested' | 'probe',
  report?: (report: ActivationReport) => void,
): Promise<boolean> {
  const probes: ProbeAnswer[] = [];
  const stop = (phase: ActivationReport['phase']): boolean => {
    report?.({ phase, probes: [...probes] });
    return phase === 'done';
  };
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  const sleep = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  const owned = (): boolean =>
    panel.active &&
    panel.visible &&
    panel.viewColumn !== undefined &&
    !document.isClosed;
  while (!owned()) {
    if (document.isClosed || Date.now() >= deadline) return stop('active');
    await sleep();
  }
  if (stillWanted && !stillWanted()) return stop('wanted');
  panel.reveal(panel.viewColumn, false);
  await vscode.commands.executeCommand(
    'workbench.action.focusActiveEditorGroup',
  );
  const settled = (): boolean => {
    const group = vscode.window.tabGroups.activeTabGroup;
    const tab = group.activeTab;
    return (
      panel.active &&
      panel.visible &&
      !document.isClosed &&
      group.viewColumn === panel.viewColumn &&
      tab?.input instanceof vscode.TabInputCustom &&
      tab.input.viewType === viewType &&
      tab.input.uri.toString() === document.uri.toString()
    );
  };
  while (!settled()) {
    if (Date.now() >= deadline) return stop('settle');
    await sleep();
  }
  if (domFocus !== 'probe') return stop('done');
  // DOM focus moves asynchronously after the focus command: read it (a probe
  // changes nothing) until the webview owns it or the probe budget, started
  // once the tab settled, passes. A webview that never answers is not asked
  // again: it has no listener.
  const probeDeadline = Date.now() + FOCUS_PROBE_TIMEOUT_MS;
  for (;;) {
    const answer = await probeFocus(panel, probeDeadline - Date.now());
    probes.push(answer);
    if (answer === 'focused') break;
    if (answer === 'unanswered' || Date.now() >= probeDeadline)
      return stop('probe');
    await sleep();
  }
  // The workbench may have moved on while the webview answered.
  return stop(settled() ? 'done' : 'settle');
}
