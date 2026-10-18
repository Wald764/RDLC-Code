# Bug Assessment: Canvas scroll jumps after releasing a drag

- **Slug**: drag-scroll-jump
- **Created**: 2026-10-18
- **Source**: pasted text
- **Verdict**: likely valid, needs reproduction
- **Severity**: medium

## Report (verbatim or summarized)

> Lors du déplacement d'un élément sur le canvas RDLC, le relâchement du clic provoque un défilement vertical involontaire vers le bas. Le scroll doit rester stable après le déplacement. Analyser la cause et proposer une correction. slug=drag-scroll-jump

The user supplied the slug explicitly. No URL was supplied; URL host classification and fetching are not applicable.

## Symptom

Releasing a dragged report item unexpectedly scrolls the designer downward. Accepting a move should update the item's geometry while preserving the current viewport scroll offsets, without revealing an unrelated authoring panel.

## Reproduction

The following procedure is derived from the report and current UI structure; it has not been executed in a rendered webview during this assessment.

1. Open an editable RDLC report in the designer, with a supported body textbox. `tests/fixtures/interactive/mixed.rdlc` is an existing suitable candidate fixture, not a confirmed reproduction fixture.
2. Keep the canvas visible and the authoring panel below it outside the viewport. Record the scrolling element, its horizontal/vertical offsets, and the focused element.
3. Drag the textbox by more than the existing 3-CSS-pixel threshold to a valid changed position, then release the pointer.
4. Wait for the accepted snapshot and edit result. Compare scroll offsets and focus before release, after snapshot rendering, and after result reconciliation. The reported failure is an unsolicited downward scroll; the expected result is unchanged offsets and an accepted move.

[NEEDS CLARIFICATION: The user's report fixture, VS Code/OS versions, webview viewport size, initial scroll offsets, jump distance, and whether the jump occurs immediately on pointerup or after the accepted snapshot are unknown.]

## Suspected Code Paths

- `apps/designer/src/app/editor/editor.component.ts:219–266`, `finishGesture()` — pointerup clears the preview, releases capture, and submits one layout request. There is no explicit scroll write in this path.
- `apps/vscode-extension/src/document-session.ts:315–345`, `applyEdit()` — after native application, publishes authoritative state before emitting the correlated result. A changed accepted edit advances the document version.
- `apps/designer/src/app/editor/host-adapter.ts:63–85`, `ingest()` — installs a newer snapshot in the signal consumed by the template. Repeated same-version snapshots are ignored.
- `apps/designer/src/app/editor/editor.component.html:156–168` — the authoring subtree is inside `@for (snapshot of [host.snapshot()]; track snapshot?.version)`. A new version changes the key, recreating the subtree and rerunning its initialization hook.
- `apps/designer/src/app/authoring/authoring.component.ts:23,40–42` — the host is programmatically focusable through `tabindex="-1"`; `ngAfterViewInit()` unconditionally calls `this.element.nativeElement.focus()` without `{ preventScroll: true }`.
- `apps/designer/src/app/editor/editor.component.html:21–26,111–168` — the authoring panel follows the page canvas, item list, and selected-item properties in document flow. Revealing its focused host can scroll downward away from the canvas.
- `apps/designer/src/app/editor/lifecycle.spec.ts:191–237` — an existing test explicitly expects focus to move to `rdlc-authoring` when a new independent version recreates forms, but asserts neither focus options nor scroll stability.

## Root Cause Hypothesis

**Confidence: medium for the reported jump; high for the underlying code path.** The strongest suspect is a focus-induced browser scroll after an accepted edit, rather than an explicit scroll in the drag geometry logic. Pointer release submits the move, a newer snapshot changes the template's version key, and Angular recreates `AuthoringComponent`. Its unconditional initialization `focus()` uses the browser's default scroll-into-view behavior. Because the focused authoring host is below the canvas, that focus can explain the observed downward jump.

There is an important timing qualification: the authoring component is inside a fieldset disabled while a mutation is pending. The native host normally publishes the snapshot before the edit result. Whether that fieldset suppresses this programmatic focus at initialization must be checked in Chromium; the current independent-version focus test does not reproduce this pending-layout sequence. Both snapshot/result delivery orders must therefore be tested before treating the hypothesis as a confirmed reproduction.

A secondary candidate is layout/scroll anchoring: pending, gesture, and outcome messages are conditionally inserted above the page (`editor.component.html:2–19`), while the grid has a `1rem` gap (`editor.component.scss:1–3`). These transitions can change document flow. They are plausible contributors to a smaller displacement, not demonstrated causes of the reported jump. The pointer anchor also reads current window scroll (`editor.component.ts:180–181,197–198`); it does not itself set scroll offsets.

## Proposed Remediation

**Preferred**: First reproduce and instrument the accepted-drag lifecycle. If the authoring initialization focus causes the jump, change that existing focus call to `focus({ preventScroll: true })`. This is the smallest targeted correction: it retains the existing keyboard-focus restart behavior while preventing that call from asking the browser to reveal the offscreen panel. Verify the result in the real VS Code webview, not only a DOM test environment.

Keep the version-keyed form recreation and the existing stale-draft protection. Removing the `track snapshot?.version` boundary merely to avoid focus would change lifecycle semantics and could reintroduce obsolete drafts. Do not compensate with unconditional `window.scrollTo()` after every snapshot: that can fight intentional scrolling and unrelated source updates, and would address the symptom rather than the focus request.

If browser evidence shows focus is suppressed by the pending fieldset or the jump persists after the targeted correction, investigate the conditional status blocks and scroll anchoring separately. Stabilizing the status region's layout is appropriate only if measurements establish that it contributes. Do not silently expand this fix into viewport, zoom, or auto-scroll implementation.

**Files likely to change**:

- `apps/designer/src/app/authoring/authoring.component.ts` — pass `preventScroll` at the existing programmatic focus site, if confirmed.
- `apps/designer/src/app/editor/lifecycle.spec.ts` — assert scroll-neutral focus options while retaining existing form-reset and usable-focus expectations; cover accepted moves with authoring state.
- `apps/designer/src/app/editor/editor.component.spec.ts` — extend the pointer-release/accepted-snapshot scenario to include an offscreen authoring panel and correlated results, where suitable.
- `apps/designer/src/app/authoring/authoring.component.spec.ts` — optionally place the focused component-level assertion here instead of duplicating it in lifecycle tests.

**Tests to add or update**:

- Spy on the authoring host's focus call during recreation and require `{ preventScroll: true }`; preserve the existing assertion that independent-version form drafts are discarded and focus remains usable.
- Exercise a valid non-no-op pointer drag through release and authoritative acceptance with non-null authoring state. Cover snapshot-before-result and result-before-snapshot, with the actual pending fieldset behavior.
- In a rendered Chromium/VS Code webview with enough content to scroll, record `document.scrollingElement`/window offsets and any actual scrollable ancestor before release and after both messages settle. Require unchanged horizontal and vertical offsets while confirming the requested geometry and surviving selection.
- Repeat from a nonzero initial scroll position, with the authoring panel offscreen. Include resize as an adjacent workflow using the same version/focus lifecycle.
- Check cancellation, invalid release, no-op and refusal: they must not introduce a new scroll jump. Also check initial mounting and an independent source update so the existing focus/draft workflow remains usable.
- If residual movement is reproduced, isolate status-block insertion/removal with focus-induced scrolling disabled before proposing a layout correction.

DOM/jsdom assertions can prove that the focus options are supplied, but cannot establish the absence of a real rendered-page scroll. Native host-only session tests likewise do not drive pointer input or browser focus/scroll behavior.

## Risks & Considerations

- **Severity rationale**: medium usability regression in a core editing workflow. Losing the current canvas viewport disrupts repeated positioning and can hide the selected item. The identified mechanism does not demonstrate XML corruption or data loss.
- **Blast radius**: any newer editable snapshot that recreates the authoring panel may be affected, including resizes, property edits and independent source changes; only drag release is user-reported.
- **Accessibility**: preserving focus with `preventScroll` retains the current focus policy, but may leave focus in an offscreen panel. Test keyboard usability; returning focus to the surviving canvas item after an own layout edit would be a separate, broader focus-policy change.
- **API and persistence**: the proposed focus-option change needs no bridge/schema/API changes, migration, dependency, or report XML edit.
- **Performance/security**: no new scrolling loop, timers, resource access or data execution is needed. Avoid a global scroll-restoration mechanism.
- **Evidence limits**: this assessment is based on targeted source and test inspection. No source files were modified and no browser/native reproduction or tests were run during assessment. Installed/manual evidence for the prior US1 implementation was already explicitly pending.

## Open Questions

- [NEEDS CLARIFICATION: Does `document.activeElement` become `rdlc-authoring` when the reported jump occurs?]
- [NEEDS CLARIFICATION: Does the jump happen on every accepted move, or only the first move/particular reports or viewport sizes?]
- [NEEDS CLARIFICATION: Which element actually scrolls, and what are its before/after offsets?]
- [NEEDS CLARIFICATION: In the affected webview, is initialization focus suppressed while the authoring fieldset is disabled, and what is the observed snapshot/result order?]

## Assessment Workflow

- Only `.specify/bugs/drag-scroll-jump/assessment.md` was written for this assessment.
- `.specify/extensions.yml` contains `hooks: {}`; no pre-assessment hooks are registered.
- Suggested next command: `/speckit.bug.fix slug=drag-scroll-jump`.
