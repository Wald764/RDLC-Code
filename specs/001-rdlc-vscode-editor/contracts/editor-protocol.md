# VS Code Editor and Webview Contract

## Public extension surface

- Planned custom-editor view type: `rdlcCode.designer`, selector `*.rdlc`, registered through `registerCustomEditorProvider` using `CustomTextEditorProvider`.
- Planned commands: `rdlcCode.newReport` creates an untitled supported template; `rdlcCode.openDesigner` opens the active report with the custom editor; `rdlcCode.openSource` opens the same URI as text. Create uses normal Save As; source access remains available for unsupported or malformed documents.
- Save, Save As, undo, redo and close use VS Code document commands and lifecycle, not parallel extension implementations.
- Target desktop local workspaces on Windows, macOS and Linux. Web and remote-workspace support are not claimed by this contract.

## Message envelope

Messages are JSON-compatible plain data, with a protocol version (`1`), message kind, and request ID for requests/replies. All document-bearing messages carry the host document version. Node IDs are scoped to that version. The host binds each webview to its own document URI; a message cannot choose a file path.

| Direction | Kind | Required payload | Host/UI behavior |
|---|---|---|---|
| Designer → host | `ready` | protocol version | Host sends current snapshot after assets initialize |
| Host → designer | `snapshot` | document version, projection/scene, capabilities, diagnostics | Replaces accepted state; cancels stale gestures; no raw report HTML |
| Designer → host | `edit` | request ID, base version, target ID where applicable, operation, typed values | Host validates and atomically applies or refuses |
| Host → designer | `editResult` | request ID, accepted/rejected status, reason code and diagnostics | Authoritative state arrives via document-change snapshot; no optimistic dirty state |
| Designer → host | `openSource` | optional validated target ID | Host opens the bound TextDocument and reveals a known range |
| Host → designer | `protocolError` | reason and supported version | Disable mutations until ready/version negotiation succeeds |

Duplicate request IDs are idempotently rejected or answered from the current-session result cache; never apply the same mutation twice. The host serializes edit requests per document, rechecks version immediately before applying, and never retries a stale edit against a new source automatically. If an intervening document change makes the result uncertain, publish the actual TextDocument state and require a fresh intent; do not report speculative success.

## Edit operations

- Page/body property changes; add/edit/delete textbox; supported formatting and text/expression changes.
- Create/edit/delete dataset and field, with reference guards and type allowlist.
- Create table; add/remove column; edit cell; add/change/remove row group; add/change/remove group or report total.
- Every structural action is one undoable WorkspaceEdit. Pointer gestures commit once on completion; keyboard/form changes have explicit commit boundaries.
- Selection, focus, zoom and in-progress forms are webview-local Signals, not XML edits. Source changes discard stale edit drafts with an explanation instead of silently applying them to another item.

Unknown message kinds, unexpected properties where dangerous, nonfinite numbers, excessive payloads, invalid operation/value combinations, unsupported capabilities and stale versions are refused. Renderer coordinates do not authorize filesystem or XML access. The host computes XML patches itself.

## Webview isolation and offline assets

- The packaged Angular build is loaded with `webview.asWebviewUri`; `localResourceRoots` includes only the packaged designer asset directory, not the report workspace.
- Restrictive CSP starts with `default-src 'none'`; allow scripts only by generated nonce and packaged chunks as required by the verified Angular build, styles through the webview source and a scoped runtime nonce, and local fonts/assets only where needed. Set `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'` and `form-action 'none'`.
- Supply Angular's `CSP_NONCE` for runtime component styles. No `unsafe-eval`, broad `unsafe-inline`, CDN resources, remote source maps, telemetry, remote fonts, dynamic report HTML or resource fetching.
- Angular is AOT-built and bundled for the VSIX; no development server is involved in installed workflows. Keep the VS Code API handle private to the host adapter, with no Node integration in the webview.
- Render report text with escaped text bindings. Never interpret report expressions, scripts, URLs, style strings or foreign XML as executable DOM.
- Core local editing declares and verifies support for untrusted workspaces without executing workspace tasks or report-supplied code.

## Lifecycle acceptance obligations

The official TextDocument owns dirty state, undo/redo, persistence and source synchronization. Multiple views observe the same versioned snapshot. Save failure and close cancellation retain pending work. Clean external changes reload; dirty external changes use VS Code's conflict resolution without forced overwrite. A malformed source snapshot disables visual writes, never source access. Test version races, split views and non-default encoding/EOL explicitly before claiming preservation guarantees.
