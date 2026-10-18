# Bug Fix: Every pointer release cancels the drag preview

- **Slug**: drag-preview-cancelled
- **Fixed**: 2026-10-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Each window pointer event now has exactly one `@HostListener` owner. `releaseGuard()` lost its duplicate `window:pointerup`/`window:pointercancel` decorators, which had replaced `finishGesture()` and `captureLost()` in the compiled component. It is now called from those two handlers instead, so a released gesture submits its edit again and the US5 draft guard still releases after the click.

The slug was supplied explicitly.

## Changes

| File | Change | Notes |
| --- | --- | --- |
| `apps/designer/src/app/editor/editor.component.ts` | modified | `releaseGuard()` is private with no decorators; `finishGesture()` and `captureLost()` call it first. `captureLost()` also cancels an active Space+drag pan on its pointer. A comment at `finishGesture` warns against a second listener for the same event. |
| `apps/designer/src/app/editor/editor.component.spec.ts` | added tests | New `real pointer event dispatch` suite: events go through the DOM, so host listener bindings are exercised. |
| `docs/validation/interactive-designer.md` | added note | Records that earlier automated pointer-workflow evidence did not hold in a rendered webview from `9a99ee7` until this fix. |

## Diff Highlights

```typescript
// One handler per window event: a second @HostListener for the same event replaces this one.
@HostListener('window:pointerup', ['$event'])
finishGesture(event: PointerEvent): void {
  this.releaseGuard();
  …
}

captureLost(event: PointerEvent): void {
  this.releaseGuard();
  if (preview, marquee or pan pointer) this.cancelGesture();
}

/** Called from the pointer end handlers, which own those window events. */
private releaseGuard(): void { setTimeout(() => (this.pointerGuard = false)); }
```

Compiled `hostBindings` after the fix: `pointerup → finishGesture`, `pointercancel → captureLost`, `lostpointercapture → captureLost`. Before: `pointerup → releaseGuard`, `pointercancel → releaseGuard`.

## Tests Added or Updated

`apps/designer/src/app/editor/editor.component.spec.ts`, suite `real pointer event dispatch`:

- `submits a released move instead of cancelling it on capture loss`: pointerdown on the item, window pointermove/pointerup, then the browser-like implicit `lostpointercapture` and `click`. Exactly one `move` (6pt, 3pt) and no cancel notice.
- `submits a released resize handle`: south-east handle, one `resize` with `xPt: 240`, `yPt: 57`.
- `applies a released marquee selection`: marquee from blank body space selects the two fully enclosed items.
- `a real pointercancel still cancels the preview without an edit`: proves `captureLost` is bound to `pointercancel` again.
- `releases the draft pointer guard after a real pointerup`: a property commit is blocked while the guard is armed and accepted after a real `pointerup` plus a tick (US5 regression).

Failure-first: with the old duplicate decorators temporarily restored, the first four fail (4 failed / 104 passed). The guard test passes either way because `releaseGuard` was bound before. With the fix, all 108 pass.

## Local Verification

- Commands run:
  - `pnpm lint`: pass.
  - `pnpm typecheck`: pass (root TypeScript and Angular).
  - `pnpm test:unit`: 80 Node + 108 Angular tests pass.
  - `pnpm build`: pass (`main-EXXJPNMF.js`).
  - `pnpm package`: `dist/rdlc-code-0.1.0.vsix`, SHA-256 `57500208fa8ad568cc3ac6cc51114e2e8f2ab9e7b1218f6e80c46b76f96bc99b`.
  - `pnpm format:check`, `git diff --check`: pass.
- Real Chromium (headless Chrome via CDP, the same session-scratchpad driver used for the assessment, against the rebuilt production bundle): a 40×20 px mouse drag on an unselected and on a preselected textbox now posts `{ action: 'move', targetIds: ['2:3'], dxPt: 32, dyPt: 18 }` (with default snapping). The feedback shows `Applying edit — mutations are temporarily unavailable.`; no console errors.
- `CHROME_PATH=… node tests/browser/drag-scroll-jump.mjs`: **fails** at its preview anchor assertion (`Horizontal pointer anchor drifted.`), during the drag and before any release. The cause is inferred from geometry, not instrumented: the script predates Phase 6. It expects an unsnapped preview (150pt + 6pt), but default grid snapping now places it at 160pt, and it assumes window scrolling rather than the new canvas viewport. It does not reach the release path this fix changes.
- Not run: `pnpm test:vscode` / `test:package`. The change is designer-only; the native suites drive the host session directly and do not load the webview bundle.
- Manual: not yet performed in the installed VS Code webview.

## Deviations from Assessment

- `captureLost()` additionally cancels on the pan's pointer (`this.pan?.pointerId`). Without it, a `pointercancel` during Space+drag would leave the pan active until the next `pointerup`. This is the same cancel path the assessment names; it is one extra condition.
- Not added: the optional lint-style check for duplicate `@HostListener` event names. The real-event suite catches the regression, and a comment at `finishGesture` documents the constraint.
- `docs/validation/interactive-designer.md` was not in "Files likely to change"; the note follows the assessment's risk item about earlier evidence.

## Follow-ups

- Update `tests/browser/drag-scroll-jump.mjs` for Phase 6: disable snapping through the webview state mock, and use the canvas viewport scroll instead of window scroll. Wire it into a documented command so real-browser pointer checks run routinely; it would have caught this bug.
- Manually verify move, all resize handles, the table grip, marquee and Space+drag pan in the installed VSIX (E01/E02).
- Commit this fix separately (`:bug: fix(designer): …`) or with Phase 6. This is still the assessment's open question.
