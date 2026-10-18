# Bug Assessment: Every pointer release cancels the drag preview

- **Slug**: drag-preview-cancelled
- **Created**: 2026-10-18
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> Lors du déplacement d'un élément sur le canvas RDLC, le message `Preview cancelled; document unchanged.` apparaît systématiquement après le relâchement du clic, même lorsque la destination est valide.
>
> **Comportement attendu :** Le déplacement doit être validé et la nouvelle position enregistrée dans le document RDLC.

The user supplied the slug. No URL was supplied, so the URL trust policy does not apply. The user asked for a diagnosis only: no source, test or build file was changed.

## Symptom

Releasing a valid drag of a canvas item cancels the preview and sends no edit. The message is accurate: the document is really unchanged. Expected: the release submits one `layout` intent and the host applies the new position.

## Reproduction

Reproduced in a real Chromium (Chrome headless, driven through the DevTools protocol) against the production designer bundle `dist/designer/browser/main-3UKO5GUU.js`, built from `9a99ee7` plus the uncommitted Phase 6 changes. A fake `acquireVsCodeApi` recorded posted messages. The editable snapshot was the same shape as the designer specs' (`Title` textbox at 24,24 px). Scripts and logs are in the session scratchpad only; nothing was added to the repository.

1. Load the designer and post an editable snapshot containing one supported body textbox.
2. Press the mouse on the item, move 40×20 CSS px in ten steps, then release.
3. During the drag the feedback shows `Preview only — release to apply.` (the preview works).
4. On release the feedback shows `Preview cancelled; document unchanged.` and only `ready` was posted; no `edit` message.

Observed event order with logpoints in the bundle:

```
pointerdown item#0
gotpointercapture item#0
(pointermove × 10 → preview active)
pointerup item#0                ← finishGesture() is never called
lostpointercapture item#0
cancelGesture()  ← stack: captureLost
click item#0
feedback: "Preview cancelled; document unchanged."
posted: ["ready"]
```

Validation of the diagnosis: in a scratch copy of the same bundle, rebinding the window `pointerup` handler to call `finishGesture(event)` (then `releaseGuard()`) makes the identical drag post `{ action: 'move', targetIds: ['2:3'], dxPt: 32, dyPt: 18 }`. The feedback then shows `Applying edit — mutations are temporarily unavailable.`

## Suspected Code Paths

- `apps/designer/src/app/editor/editor.component.ts:1150–1155`: `releaseGuard()` is decorated with `@HostListener('window:pointerup')` and `@HostListener('window:pointercancel')`. Added in `9a99ee7` (US5, committed, not pushed to `origin/main`).
- `apps/designer/src/app/editor/editor.component.ts:620`: `finishGesture()` is `@HostListener('window:pointerup', ['$event'])`. It is the only path that clears the preview and calls `host.sendEdit()`.
- `apps/designer/src/app/editor/editor.component.ts:729–737`: `captureLost()` is bound to `window:pointercancel` and `window:lostpointercapture`. It calls `cancelGesture()` with its default message when the preview's pointer loses capture.
- Compiled `hostBindings` of `EditorComponent` in `dist/designer/browser/main-3UKO5GUU.js` keep exactly one handler per event: `("pointerup", () => r.releaseGuard())`, `("pointercancel", () => r.releaseGuard())`, `("lostpointercapture", s => r.captureLost(s))`. There is no `finishGesture` binding, and `captureLost` is lost for `pointercancel`.
- `apps/designer/src/app/editor/editor.component.spec.ts` (e.g. lines 153, 325, 487, 1061) calls `component.finishGesture(...)` directly and never dispatches a real `pointerup`. That is why 103 green designer tests did not detect it.

## Root Cause Hypothesis

**Confidence: high (reproduced and counter-verified).** Several `@HostListener` decorators for the same target and event (`window:pointerup`, `window:pointercancel`) are declared on different methods. In the compiled component only the last declared handler is bound for each event, so `releaseGuard()` silently replaced `finishGesture()` on `pointerup` and `captureLost()` on `pointercancel`. That the binding is keyed by event name is inferred from the compiled output; the binding list itself is observed.

The real browser sequence is then: `pointerup` → only `releaseGuard()` runs, so the preview stays active. Next, the browser implicitly releases pointer capture → `lostpointercapture` → `captureLost()` sees the still-active preview's pointer → `cancelGesture()` sets the default message `Preview cancelled; document unchanged.`. No intent is ever submitted, so the cancellation is real, not just a wrong message.

The analysis requested by the report finds no synchronization, version, validation or event-ordering defect. The preview's version matches the snapshot, the geometry is valid, and the host is never reached.

**Introduced by**: commit `9a99ee7` (US5 draft conflicts), committed locally and not yet pushed. The uncommitted Phase 6 changes did not cause it, but they depend on the same handler: pan end, marquee end and edge-scroll release all finish in `finishGesture()`.

**Same root cause, inferred from the same binding list and not separately reproduced:**

- Every pointer gesture that completes in `finishGesture()` is broken: textbox/table move, all eight resize handles, the table move grip, marquee selection (cancelled instead of applied) and Space+drag pan (the pan state is cleared only by `cancelGesture`, via capture loss).
- A plain click on an item probably also shows `Preview cancelled; document unchanged.`. `startGesture()` creates an inactive preview that only `finishGesture()` would clear, so `lostpointercapture` cancels it. Selection still changes, via the `click` handler.
- `pointercancel` never reaches `captureLost()`. Cancellation still happens through the subsequent `lostpointercapture` in Chromium, so this is a latent robustness loss, not a separate visible symptom.
- Keyboard nudges, align/distribute, property forms and the `pointerGuard` draft protection still work. `releaseGuard()` does run, which keeps the US5 draft-conflict behavior intact.

## Proposed Remediation

**Preferred**: Bind each window event to exactly one handler and call the other behaviors from it. Remove the two `@HostListener` decorators from `releaseGuard()`. Call `this.releaseGuard()` at the start of `finishGesture()` and at the start of `captureLost()` (or have one `pointercancel` handler call both `captureLost(event)` and `releaseGuard()`). Ordering is safe: `releaseGuard()` only schedules `pointerGuard = false` in a `setTimeout`, so it still releases after the click that follows `pointerup`. That is the US5 requirement.

**Alternatives**:

- Keep `releaseGuard()` as a listener but register it imperatively (`addEventListener` in the constructor, removed on destroy), like the existing capture-phase `pointerdown`/`submit` listeners. This works but spreads window listeners across two mechanisms.
- Rename `releaseGuard`'s events (for example capture-phase document listeners). Still two registration styles for one event, and easy to collide again; not recommended.

**Files likely to change**:

- `apps/designer/src/app/editor/editor.component.ts`: single owner per window pointer event; `releaseGuard()` called from `finishGesture()` and the cancel path.
- `apps/designer/src/app/editor/editor.component.spec.ts`: real-event regression tests.

**Tests to add or update**:

- A designer spec that dispatches real `PointerEvent`s (`pointerdown` on the item, `pointermove`/`pointerup` on `window`) through the DOM instead of calling component methods. Assert exactly one `edit` with the expected `dxPt/dyPt` and no `Preview cancelled` notice. Repeat for one resize handle and for a marquee.
- A spec that dispatches a real `pointercancel` on `window` during a preview and asserts the cancellation notice and no edit (proves `captureLost` is bound again).
- A spec that the draft `pointerGuard` is still released after `pointerup` (US5 regression): a property `change` immediately after release in a later task is committed.
- Guard against recurrence: a spec asserting that a real `pointerup` reaches both behaviors (the gesture submits and the guard releases). Optionally, a lint-style unit check that no two `@HostListener`s on the component share an event name.
- Recommended manual check: drag, resize and marquee in the installed VSIX (E01/E02). The original miss came from jsdom tests that bypass event dispatch.

## Risks & Considerations

- The fix touches the shared gesture-ending path, so re-run the full designer suite, and in particular the US5 draft-conflict tests (`pointerGuard` timing) and the Phase 6 pan/snap/nudge tests.
- Phase 6 evidence in `docs/validation/interactive-designer.md` and the US1/US2/US5 checkpoints were automated-only. Their "move/resize/marquee works" claims did not hold in a real browser from `9a99ee7` onward. The fix should note this in the evidence record rather than silently relying on earlier passes.
- No protocol, host, document or persistence change is needed; the host side was never reached.
- Security/performance: none.

## Open Questions

- [NEEDS CLARIFICATION: Was the installed extension tested at the US1 checkpoint (`9680dbb`) and did moves work then? The code analysis says yes, since `releaseGuard` did not exist yet, but there is no user-side confirmation.]
- [NEEDS CLARIFICATION: Should the fix land as a separate `:bug:` commit on top of `9a99ee7` before the uncommitted Phase 6 work is committed, or together with Phase 6?]
