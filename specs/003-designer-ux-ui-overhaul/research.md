# Research: Designer UX/UI Overhaul

**Date**: 2026-10-18 | **Status**: Phase 0 complete; technical choices resolved

## Method and evidence boundaries

Started from [spec.md](spec.md), [baseline-analysis.md](baseline-analysis.md), package manifests and the constitution. Two focused research delegates inspected disjoint host/model and presentation/interaction paths using bounded source reads. This is repository research, not executed UX research, browser benchmarking or native-history verification. No new external dependency or new report-format claim needs web research.

Format authority is inherited from [001 compatibility](../001-rdlc-vscode-editor/contracts/compatibility.md) and [002 targeted MS-RDL evidence](../002-interactive-visual-designer/baseline-analysis.md#targeted-ms-rdl-evidence): MS-RDL v20251031, §§2.3/2.5/2.6 for the report profile, §2.2.7 for units, §§2.16/2.23 for textbox/table geometry, §§2.325/2.328 for datasets/fields and §1.7 for extension preservation. The existing wider tablix wording ambiguity remains unresolved and outside this feature's claims. No vendor modification or exhaustive corpus read occurred.

## R1 — Retain the current editor and state owners

**Decision**: Refactor `EditorComponent` into the bounded five-zone grid. Initially keep canvas, toolbar/status, separators and overlay coordination in that component; add focused catalog, tree and contextual-inspector presentation children using the existing standalone/OnPush/input/output patterns.

**Rationale**: `apps/designer/src/app/editor/editor.component.ts` owns selection, drafts, accepted previews, capture, nudge/pan, navigation and command dispatch. Moving the canvas would move all these lifecycle dependencies for no extra requirement. Angular 22.2.3, TypeScript 6.0.3, SCSS and the existing domain packages already cover the work.

**Alternatives considered**: New designer application, global store, router or gesture service duplicate state; Angular Material/CDK or an icon library adds dependencies without a demonstrated need. Use native controls and original small local icons.

## R2 — Project a bounded read-only hierarchy from accepted syntax

**Decision**: Add a flat `structure` node list to accepted snapshots, projected alongside the scene from existing syntax and semantic metadata. Use real XML node IDs, source ranges and safely recognized structural relationships. Cap at 2,000 entries and 32 structural levels; report truncation explicitly. These are new presentation limits, not report/parser compatibility limits.

**Rationale**: `packages/report-model/src/scene.ts` is flat except table-cell parent links; `packages/renderer/src/render.ts` omits source-only structure. `report.ts` preserved regions are not unsupported-object inventory: `packages/xml-parser/src/project-report.ts` records preservation for many ordinary descendants. `syntax.ts` already has expanded names, parent/child IDs and UTF-16 ranges. A focused read-only projector in `packages/renderer/src/` can consume these existing models without client XML parsing or changing parser semantics. Flat transport avoids nested hierarchy violating the existing protocol depth limit of 20.

**Alternatives considered**: Scene-only tree misses data/sections/preserved containers; raw XML tree exposes irrelevant property nodes and implies false understanding; client XML parsing duplicates trust and format logic. A preserved-region tree misclassifies supported content. Keep opaque subtrees as labeled preservation-only entries.

## R3 — Extend shared selection without changing operation eligibility

**Decision**: Extend the existing selection with an exclusive structural/data target. Body multi-selection and exclusive cell selection retain their current semantics. Join tree IDs with scene/authoring IDs; structural-only targets never get invented geometry. Reconcile only explicit accepted mappings or unique identities in both versions; clear ambiguity.

**Rationale**: `editor/selection.ts` already owns membership, primary, accepted mapping and unique name/kind/parent reconciliation. Parser IDs in `packages/xml-parser/src/parser.ts` are `${version}:${count}`, not durable identities. Dataset identity is its unique name; field identity requires unique dataset plus field name in both snapshots. Unnamed structural entries cannot safely retain ordinal identity across independent changes.

**Alternatives considered**: Separate tree/inspector selection drifts from canvas; generic geometry targets accidentally authorize dataset/cell operations; persistent parser IDs or ordinals can select a different node after source changes.

## R4 — Route native history through the originating document-bound panel

**Decision**: Add fixed `history`/`historyResult` protocol messages with request ID, base/result version and `undo | redo`. Reuse the document session's per-document queue and binding guards. The provider activates and verifies the originating custom-editor panel/document before executing the literal native command; it refuses if the target cannot be established. Always acknowledge no-op/failure and publish actual accepted state.

**Rationale**: The current protocol has edit/source/clipboard, not history. Existing keyboard handling only cancels gestures on history keys. `document-session.ts` already serializes operations and applies native edits; `editor-provider.ts` owns the actual panel. A result settles pending state when native history emits no change event. A malformed/source-only current snapshot may still need native Undo; history eligibility must not simply reuse visual-editable status.

**Alternatives considered**: Reversing XML patches creates a competing history. Opening source to undo changes the user workflow. Executing against the last active text editor can undo another report. An unrestricted command-name message expands authority unnecessarily.

**DOM focus attestation**: The workbench routes native `undo` by DOM focus (a code editor with text focus, then a focused input or textarea, only then the custom editor), not by the active tab, and the extension host cannot read DOM focus. A panel can be the active tab while DOM focus stays in another document's code editor (observed on macOS), so history runs only on positive evidence from the designer: `HistoryRequestMessage.focused`, taken at the user's gesture, or else a `focusProbe` / `focusProbeResult` read once the tab settled. The designer's evidence is `document.hasFocus() || interactedSinceBlur`: `hasFocus()` is false whenever the OS window is unfocused (CI, Playwright) although DOM focus is in the frame, whereas a trusted `pointerdown`/`keydown` in the frame moves workbench DOM focus there independent of OS focus, and window `blur` fires when it leaves. It is taken at the gesture and carried in the request because VS Code's webview focus handoffs blur the frame (measured: a late one landed ~20 ms after an Undo click, and no `focus` event follows when the OS window is unfocused), and because a host round trip added ~30 ms of click-to-undo latency that made desktop journeys pressing Save right after Undo race and fail. The probe (own 1 s budget on top of the 2 s settle wait) serves requests without evidence. A post-condition guard reports `accepted=false` if another `file`/`untitled` document changed while this one did not. The gesture evidence expires: it counts only for `GESTURE_FOCUS_WINDOW_MS` (2 s) after the last trusted gesture and until a blur, so a gesture cannot vouch for focus after the user silently moved on; a request held behind a draft decision and replayed later carries the evidence taken at the user's first gesture instead of a fresh reading.

**Where native undo success is asserted**: the real-workbench success path of native undo (a real click on the designer's Undo button, real DOM focus routing, exact document text afterwards) is asserted by the desktop Playwright specs with real clicks: `components.spec.ts` (US4.2, SC-004 and the other creation journeys) and `bootstrap.spec.ts`, plus the history steps of `context.spec.ts`, `data.spec.ts` and `workspace.spec.ts`. The extension-host suite (`tests/vscode`, `nativeDesignerHistory`) cannot produce a trusted gesture: it asserts the success path only when the environment grants the scripted webview DOM focus, and otherwise asserts the refusal (`accepted=false`, nothing touched) and the misroute post-condition, so a green extension-host run on a platform without OS window focus does not prove native undo succeeds there.

**Validation obligation**: Panel activation alone is not proven to route native history correctly. Integration must demonstrate report A history after report B was last focused, split views, empty history, disposed/inactive panels, pending races and twenty individually undoable/redoable accepted edits. Failure blocks delivery of this workflow; it is not an unresolved design choice.

## R5 — Extend current per-view preference restoration

**Decision**: Extend `ViewState` in `editor/viewport.ts` and `HostAdapter`'s existing `getState()?.view` / `setState({ view })` boundary with panel preferred widths/visibility, left tab and a closed inspector-expansion map. Default missing/invalid fields independently. Preserve existing stored state compatibility through optional new fields; no schema-version service is required.

**Rationale**: Existing state already validates zoom, scroll, units, spacing and independent grid/guide choices. Compute effective widths from available space separately from stored wide-layout preferences. Separate webview state naturally isolates editor views, including split views of the same report.

**Alternatives considered**: Global extension settings, URI-keyed workspace store or report XML persistence mix independent views and/or alter report content. Persisting gestures, drafts, request IDs or version-scoped tree IDs risks restoring stale operations. Keep tree expansion and each tab's scroll positions live in the view; reconcile expansion safely without requiring durable parser IDs.

## R6 — Keep rulers and decoration outside coordinate geometry

**Decision**: Place ruler gutters outside the scroll viewport; derive ticks from existing zoom/scroll and scene body origin. Keep page at scroll-content `(0,0)`. Use outline/inset decoration rather than layout borders around body content. Add a small pure center-rebase helper next to current viewport math.

**Rationale**: `Frame`, `frame()` and `clientToBody()` already account for viewport client origin, border, scroll and body origin without device-pixel scaling. `directProposal()` derives from accepted bounds and immutable anchors. The current body's dashed border can visually offset children; real DOM verification must cover that during decoration changes. Existing `anchoredScroll` handles zoom, not differing old/new viewport sizes.

**Alternatives considered**: Padding the scroll content with rulers requires changing every transform and hit test. Device-pixel-ratio corrections double-apply scaling. Incremental gesture deltas accumulate error; retain accepted-state proposals.

## R7 — Make layout transitions explicit during manipulation

**Decision**: Coordinate responsive layout in editor state, not CSS breakpoints alone. An active manipulation includes pointer-down previews, drag/resize, marquee, nudge repeat and pan. Defer elective panel/responsive transitions. Observe outer workspace dimensions; unavoidable host resize calls existing `cancelGesture()` before rebasing/applying layout. Drain deferred transitions after completion/cancellation.

**Rationale**: No existing host-resize observer coordinates gesture cancellation. CSS alone would reflow during a gesture. Idle panel transitions preserve the report point at the old/new viewport center, unchanged zoom, subject to reachable scroll bounds; save actual browser-clamped scroll afterward. Feedback and draft messages use overlays/reserved fixed space.

**Alternatives considered**: Freezing all host resizing is impossible. Continuing on a changed origin commits wrong geometry. In-flow status/forms or width changes driven by inspector content violate the stable viewport contract.

## R8 — Reuse contextual controls and one draft guard

**Decision**: Keep existing property strings, capability checks and authoring payloads. Scope dataset/table forms to selected targets; reuse already-contextual `GroupsTotalsComponent`. Compact creation needs textbox name, dataset name, or table name/dataset/first field/width. Add expression affordances without evaluation or replacing opaque values. Use the existing `held`/Apply/Discard/Cancel machinery for selection, source and any transition that would unmount a draft.

**Rationale**: Existing components implement all supported actions but stack forms for every target. `openSource()` currently bypasses the draft guard, and authoring's unconditional mount focus would steal focus in contextual UI. Native `<details>` can preserve mounted draft controls. Initialize/expand/convert display units without submitting changes.

**Alternatives considered**: New forms with new mutation logic duplicate safeguards. Automatic submit/discard on navigation loses intent. Replaying a held version-specific action after Apply can target stale identities. Retain the existing safe default: Apply submits once and clears the held navigation; the user can navigate afterward. Discard explicitly executes the held action; Cancel retains the draft. For history, Apply never automatically undoes the freshly applied edit.

## R9 — Accessibility and theme behavior are part of each migrated control

**Decision**: Use host CSS font/color tokens with fallbacks and high-contrast/forced-colors treatment. Implement roving focus for toolbar/tabs/tree/menus, labeled separators with 10px arrow steps, native form semantics and focus return for dismissible surfaces. Scope canvas shortcuts to canvas interactions; never intercept normal field/tree/menu navigation.

**Rationale**: Current fixed colors and `system-ui` do not implement host theme behavior. Existing broad non-input Ctrl/Cmd+A handling must be narrowed for search/tree/menu contexts. Report-authored colors are data and must stay separate from themed editor chrome. Tooltips also appear on focus; unavailable actions expose reasons without requiring hover.

**Alternatives considered**: Color-only indicators, pointer-only menus or blanket autofocus violate the required journeys. Theme overlays must not rewrite authored report colors. Generic UI frameworks are unnecessary for this bounded control set.

## R10 — Use existing automation and record actual desktop acceptance

**Decision**: Extend current TestBed/Vitest/jsdom and Node suites for pure layout/ruler math, state restoration, selection/protocol validation, deferred resize, draft/focus transitions and contextual exclusivity. Use existing VS Code integration tests for actual history/lifecycle behavior. Record real installed-editor viewport, theme, screen-reader, inert/offline, timing and five-author acceptance evidence.

**Rationale**: There is no configured Playwright/axe/browser suite; lockfile optional peers are not installed test infrastructure. jsdom cannot prove CSS geometry, visual contrast, real browser scaling or screen-reader usability. `tests/vscode/run-tests.ts` disables Workspace Trust in its launch arguments, so trust behavior additionally requires a real restricted-workspace run. Its initial VS Code download may need network; offline product acceptance starts after installation/caching.

**Alternatives considered**: Adding a browser stack for this planning change is unnecessary. Passing existing automated budget tests is not a measured claim for SC-004–009. Source/spec review does not satisfy the five-author study or native-history routing proof.

## Resolution

All technical unknowns are resolved into the decisions above and the [Phase 1 contracts](contracts/editor-integration.md). Native routing, visual accuracy, contrast, usability and performance remain explicit implementation validation obligations, not claims of completed verification. No scope clarification or constitutional exception is required.
