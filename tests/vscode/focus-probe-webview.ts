import type { ActivationReport } from '../../apps/vscode-extension/src/panel-activation.js';

/**
 * Whether an activation was refused because the webview never owned DOM focus.
 * The designer attests focus from a trusted user gesture (or OS window focus);
 * an extension-host test can produce neither, and an environment without OS
 * window focus (CI, some platforms) leaves the scripted webview unfocused. That
 * is observed state, not a platform check: tests assert the safety outcome (the
 * request is refused and nothing is touched) instead of the success path.
 */
export function webviewNeverOwnedFocus(report?: ActivationReport): boolean {
  return (
    report?.phase === 'probe' &&
    // The webview answered (so the probe channel works) and never owned focus;
    // the probe cut short by the deadline is reported as unanswered.
    report.probes.includes('unfocused') &&
    report.probes.every(
      (answer) => answer === 'unfocused' || answer === 'unanswered',
    )
  );
}

/**
 * A minimal scripted webview that answers the host's DOM focus probe the way
 * the designer does (`document.hasFocus()` of its frame). It holds a focusable
 * control so it can really own DOM focus, like a designer the user clicked in.
 */
export const focusProbeWebviewOptions = { enableScripts: true } as const;

export function focusProbeHtml(label: string): string {
  return `<!DOCTYPE html><html><body><button id="control">${label}</button><script>
const api = acquireVsCodeApi();
addEventListener('message', (event) => {
  const message = event.data;
  if (message && message.kind === 'focusProbe')
    api.postMessage({
      protocol: 2,
      kind: 'focusProbeResult',
      probeId: message.probeId,
      focused: document.hasFocus(),
    });
});
</script></body></html>`;
}
