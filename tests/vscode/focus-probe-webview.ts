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
