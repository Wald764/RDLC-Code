# Editor Integration Contract

**Status**: Phase 1 design; additive delta to [001 editor protocol](../../001-rdlc-vscode-editor/contracts/editor-protocol.md) and the existing implemented 002 pipeline.

## 1. Authority and change reach

The VS Code `TextDocument` is the sole durable report. Webview messages express fixed intents; the client cannot supply XML patches, file paths, arbitrary commands, executable expressions or remote resources. Existing edit, clipboard, diagnostics and `openSource` contracts retain their validation, per-document serialization and native history boundaries.

Affected contracts/types and consumers:

- `packages/report-model/src/{protocol,scene,report,syntax}.ts`: existing types; add structure DTO/history message unions in the existing shared protocol boundary.
- `packages/renderer/src/`: focused read-only hierarchy projector using existing accepted syntax/projection, with fixture tests; no parser/serializer semantic rewrite.
- `apps/vscode-extension/src/{protocol,document-session,editor-provider}.ts`: shape/binding validation, accepted projection publication, serialized fixed native-history operation and originating-panel activation.
- `apps/designer/src/app/editor/{host-adapter,selection,viewport,editor.component}.ts`: transport settlement, shared selection, validated per-view preferences and UI routing.

No compatibility claim is expanded by displaying syntax in Structure. Authoring remains RDL 2016/01 with one supported section and existing property-level capabilities.

## 2. Snapshot structure extension

Add `structure: { nodes, truncated }` to the existing accepted snapshot, using the exact fields and validation in [data-model.md](../data-model.md#1-accepted-report-and-structure-projection). Producer and consumer are shipped together; update validator/fixtures with the shared type. Missing/invalid structure must not leave an endless loading state or enable guessed mutations: show the existing report/source state with an actionable limitation.

Projection rules:

1. Derive from the current accepted syntax and semantic projection in the host pipeline; never parse report XML again in the client.
2. Emit actual recognized report/section/body/table/row/cell/data relationships and safely identifiable preserved containers/sections. Do not enumerate arbitrary property XML as report objects.
3. Join scene/authoring records by actual node ID. A recognized node is not automatically editable; current capabilities remain decisive.
4. For unsupported containers, retain preservation-only inheritance. Unknown namespace/complex structures may be opaque labeled entries. No evaluated visibility, runtime rows, guessed bounds or fabricated missing nodes.
5. Build available structure for parsed source-only reports even when `authoring` or editable section projection is absent. Malformed input may have no usable hierarchy; diagnostics/source remain available.
6. Limit to 2,000 entries/32 structural levels and the remaining existing transport budget. Mark truncation with accessible source guidance. Stop at boundaries without dropping source or changing parser limits.

Validate closed keys/types, unique current-version IDs, valid source ranges, existing parents, acyclic relationships and limits. Existing overall limits remain authoritative: host snapshots 8 MiB/131,072 walked values, client messages 64 KiB/8,192 walked values, transport nesting depth 20. Keep hierarchy transport flat; structural depth is validated by parent links. If a valid bounded snapshot still cannot fit, retain the established diagnostic/source-only failure path rather than raising message limits.

## 3. Source navigation remains unchanged

Reuse existing `openSource` with current version and optional current `targetId`. The host resolves the target from its current source-target allowlist and syntax range. Structure metadata ranges are descriptive, not client-authorized navigation locations. No client URI/range is accepted as authority.

Route source actions through the UI draft guard before sending. Stale/deleted targets refuse or fall back through the existing safe source behavior; never select a new node merely because an ordinal matches.

## 4. Native document history

### Request

Add one closed client variant:

```text
protocol: 1
kind: history
requestId: existing bounded request-ID format
baseVersion: current accepted document version
action: undo | redo
```

No URI, node ID, arbitrary command ID or client-generated inverse edit is permitted. Apply existing handshake, size, duplicate/replay, version and disposal guards. Disable or refuse while another report operation is pending; never auto-retry stale history.

### Execution and result

1. UI cancels uncommitted manipulation, resolves draft conflicts, then submits. Normal input/textarea/contenteditable history stays native to the field and is not intercepted as report history.
2. Binding dispatches through the existing document session queue shared by all views of that report.
3. Provider establishes the originating panel using its real view column and verifies the active designer tab/document. Recheck base version after any asynchronous activation. An inactive/disposed/unverifiable target refuses before invoking history.
   Tab and panel state do not decide where the workbench routes `undo`; DOM focus does (a focused code editor or text input takes the command first), and only the designer can observe it. The history request therefore carries `focused` (optional boolean) taken when the user issued it, and the host runs history only on positive evidence:
   - The designer sets `focused = document.hasFocus() || interactedSinceBlur`. `document.hasFocus()` alone is false whenever the OS window is not focused (CI, automation) although workbench DOM focus is in the frame. A trusted (`event.isTrusted`) `pointerdown` or `keydown` captured in the frame moves workbench DOM focus there regardless of OS window focus, so `interactedSinceBlur` is set by such a gesture and cleared by window `blur`, which fires when workbench focus leaves the frame (another workbench element or another app). The evidence expires: a gesture counts only for 2 s (`GESTURE_FOCUS_WINDOW_MS`) and until a blur, and a request held behind a draft decision and replayed later carries the evidence taken at the user's first gesture. Scripted events never count.
   - The evidence is taken at the gesture, not later: VS Code also blurs the designer frame for its own focus handoffs (possibly late ones, from an earlier native insert), and a later read would disown focus the user demonstrably had. Carrying it in the request also adds no round trip to the click-to-undo latency (a sequential probe round trip made journeys that press Save right after Undo race and fail).
   - `focused: true`: the host skips the probe. The host's own reveal/focus command only focuses this panel's editor group, never a code editor.
   - `focused` absent or `false`: the host asks the webview once the tab settled, `{ protocol: 2, kind: 'focusProbe', probeId }` answered by `{ protocol: 2, kind: 'focusProbeResult', probeId, focused }` with the same `document.hasFocus() || interactedSinceBlur`, and re-reads until positive or a 1 s budget passes. The handshake is panel-level, outside the document protocol: it changes no state and the document session ignores the answer. Only an answer carrying the probe's own `probeId` counts; `focused: false`, no answer, a failed post or a disposed webview all refuse with the unverifiable-target reason.
   - Refusal happens before any history command runs. The overall activation bound is 3 s: the shared 2 s wait for the panel and the revealed tab, plus the 1 s probe budget.
4. Execute only the literal native `undo` or `redo` command. Do not route through Open Source or operate on the last focused unrelated text editor. As a last line of defence, if this document did not change while another `file` or `untitled` document did during the command, return `accepted=false` with an actionable reason, never success; nothing is reverted automatically.
5. Publish actual current accepted state and return a correlated `historyResult` even for no-op or failure.

Result fields: existing protocol envelope, `kind: historyResult`, `requestId`, `baseVersion`, `resultVersion`, `action`, boolean `accepted`, boolean `changed`, optional actionable `reason`. Accepted/no-op is `accepted=true, changed=false`; refusal before execution is `accepted=false, changed=false`. After attempted execution, `changed` reflects actual observed document-version change even if command completion fails. Actual document changes are always reflected by authoritative snapshots; a result never fabricates or rolls back document text.

Adapter settlement must tolerate snapshot/result arrival ordering, clear pending exactly once and ignore replay without executing twice. If native execution fails after an observed source change, publish that actual state and report failure honestly; do not infer unchanged text from a failed command. Native history eligibility considers actual document/focus/writability rules, not simply editable-scene status: source-only current text may still have valid undo history.

The provider strategy requires native integration proof. If activation cannot guarantee the correct document target, refuse the operation and treat the workflow as failing acceptance until targeting is corrected; no fallback to local undo stacks.

### Draft choices

Apply submits the local draft once and stops; the user may invoke history afterward. Discard explicitly clears the draft and continues the requested history action. Cancel leaves both draft and document intact. Never automatically undo an edit just accepted by Apply. External/native document updates retain existing stale-draft invalidation.

## 5. Per-view persistence

Continue `HostAdapter` restoration from `getState()?.view` and saving via `setState({ view })`; extend existing `ViewState` defaults/validation, not the host report protocol. Validate finite widths, booleans, closed tabs/section keys and existing viewport fields independently. Keep preferred wide dimensions separate from clamped effective dimensions.

Independent webviews, including two views of the same report, never overwrite each other's preferences. Hide/show and restoration use host-provided view lifetime where available. No global store, report mutation, undo entry or promise of cross-device restoration. No active gesture, draft, pending request or version-scoped target ID is restored as an edit.

## 6. Contract verification

- Protocol tests reject arbitrary history commands/URIs, malformed structure, cycles, duplicate IDs, stale requests, exceeded budgets and replay; source targets remain host-resolved.
- Projector tests cover actual table/cell/data hierarchy, preserved nested content, source-only multi-section reports, missing syntax, unknown bounds, truncation and zero input mutation.
- Adapter/component tests cover no-op/failure settlement, result/snapshot ordering, local-input history and all draft decisions.
- `tests/vscode/{lifecycle,synchronization}.test.ts` must prove A-only history after B was last focused, split-view refresh, stale/disposed/pending rejection and twenty mixed individually undoable/redoable edits.
- Roundtrip/compatibility fixtures prove hierarchy/view actions never alter report text and accepted mutations retain native atomic footprints and unknown-content preservation.
