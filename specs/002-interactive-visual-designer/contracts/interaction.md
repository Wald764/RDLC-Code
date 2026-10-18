# Designer Interaction Contract

This extends the [001 editor contract](../../001-rdlc-vscode-editor/contracts/editor-protocol.md). It specifies authoring layout only, for the unchanged 2016/01 single-section profile in [spec.md](../spec.md).

## Selection and focus

- Selection is an ordered set of version-scoped body-item IDs and one primary member. Table cells remain a separate single-target selection mode; selecting a cell clears body selection and vice versa. Table frames and cells have separate labeled targets.
- Plain click replaces; Shift+click toggles; newly added members become primary. Removing the primary promotes the last remaining member. Blank click/Escape clears only after gesture/draft cancellation has been handled.
- Marquee begins on blank body space after the 3 CSS-pixel motion threshold and encloses complete known bounds. Shift+marquee adds members in document order. Select All includes body placeholders, so eligibility never silently filters a selection.
- Hit-testing uses descending effective ZIndex and descending source order on ties; absent ZIndex is zero. The accessible item list includes obscured items and items without bounds. Unknown bounds produce no fabricated rectangle.
- Single selection routes to existing textbox/table/cell controls. Multi-selection shows count, primary target, shared eligibility and blocking-member reasons; single-target mutation forms are unavailable.
- The item list supports keyboard membership toggles and explicit primary identification. All actions have labeled focusable controls; live status announces selection count, pending state, cancellation and refusal. Numeric property controls are the keyboard equivalent of resize handles.

## Preview and accepted state

Interaction states are `idle → preview → pending → idle`; preview can cancel directly to idle. A preview captures the accepted document version and immutable starting bounds. Rendering a preview never edits XML or changes native dirty state.

Pointer capture is established for manipulation. A drag below 3 CSS pixels is a click. Eight handles apply only to one eligible body item; move may apply to a complete eligible body selection. Relative offsets and opposite resize edges are fixed from the starting geometry. Invalid bounds remain visible as invalid preview; release refuses them rather than clamping/flipping.

Escape, capture loss, pointer cancellation, editor focus loss or any independent document version cancels preview, including accumulated key repeats. Document-change cancellation explains why. A valid release submits one intent. Pending status blocks further mutations until the result and authoritative snapshot reconcile; it does not block independent source changes. A failed or uncertain apply displays actual accepted state without retry.

Native Undo/Redo cancels a preview first, then uses the native document command. Save during preview saves accepted content only. No view-local undo history exists.

An unapplied form draft must be explicitly applied, discarded or retained by cancelling a conflicting selection/gesture. Track form dirtiness before focus leaves the field; existing blur/change handling must not silently commit while the conflict choice is pending. Applying waits for accepted state before starting a fresh action. Independent source changes cancel stale drafts with notice.

## Coordinates and navigation

Canonical interaction geometry is in points, body-relative. Existing scene CSS pixels use 96px/in; convert with 72pt/in. At zoom `z`, one point spans `z * 96 / 72` CSS pixels. Convert client coordinates using viewport position, scroll and page/body origin exactly once; device-pixel ratio is not an extra geometry multiplier.

Zoom is 25–400%; toolbar zoom preserves viewport center, pointer zoom preserves its report-space anchor. Fit Page/Body clamps the largest fitting zoom to that range. Overflow expands navigable view extent, never the report body/page. Space+drag pans; scrolling and Reveal Selection preserve report geometry and selection. Edge auto-scroll updates scroll before recomputing the same pointer anchor.

Per-view preferences survive hide/show through the VS Code webview state API: zoom, scroll, displayed unit, positive grid spacing and four independent grid/guide visibility/snapping booleans. Defaults are 100%, pt, 10pt, and all four booleans true. Preferences never enter XML, shared document history or another view.

## Placement rules

- Grid origin is body origin. Move snaps the selection union's top-left; resize snaps only dragged edges. Exact grid ties choose the smaller coordinate.
- Guide candidates are known sibling/body-boundary left/center/right and top/center/bottom lines; exclude selected items. Nearest guide within 6 CSS pixels wins per axis over grid. Ties prefer body boundary, earlier source order, then smaller target coordinate. Visible active guides label target and value. Visibility does not enable/disable snapping.
- Alt bypasses both snapping modes while held. Invalid grid input retains the last valid preference and explains the failure.
- Align uses the primary member's requested edge/center. Distribute requires at least three members, sorts by axis position/source order, fixes outer anchors and equalizes edge gaps; negative gaps refuse. Both ignore snapping.
- Arrow/Shift+arrow on the canvas moves exactly 1pt/10pt, ignoring snapping. Capture original geometry on keydown, accumulate repeat preview, submit once on keyup. Each nonrepeated press is its own operation. Do not intercept editable inputs, property forms or unrelated VS Code contexts.
- Geometry must be finite, positions nonnegative and dimensions positive. Overflow warns but remains editable/reachable. A no-op submits no document edit.

See [layout protocol](layout-protocol.md) for host enforcement and [clipboard](clipboard.md) for reuse actions.
