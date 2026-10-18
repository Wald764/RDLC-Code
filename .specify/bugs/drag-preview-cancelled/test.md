# Bug Verification: Every pointer release cancels the drag preview

- **Slug**: drag-preview-cancelled
- **Tested**: 2026-10-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified
- **Status**: closed
- **Closed**: 2026-10-18

## Summary

The original symptom no longer reproduces in a real Chromium against the rebuilt production bundle. A released move submits one `move` intent with no cancel notice. Resize, marquee and plain click, which the assessment had only inferred to be affected, also behave correctly. All lint, type, unit, roundtrip, compatibility and native VS Code suites pass. The user then confirmed the fix in the installed VS Code webview.

## Checks Performed

| Check | Command / Action | Result | Notes |
| --- | --- | --- | --- |
| Reproduction (post-fix): move | Headless Chrome via CDP, real mouse drag 40×20 px on an unselected textbox | pass | One `move` posted; feedback `Preview only…` → `Applying edit…`. Before the fix: only `ready` posted and `Preview cancelled; document unchanged.` |
| Move on preselected item | Same, after a first click | pass | One `move`, no cancel notice. |
| Resize handle | Click item, drag the `se` handle 40×20 px | pass | One `resize` (`xPt: 260`, `yPt: 72`; grid/guide snapping active by default). |
| Marquee | Drag from blank body space over two items | pass | Both enclosed items selected; no edit, no notice. |
| Plain click | Press/release without motion | pass | Item selected; no `Preview cancelled` notice (inferred symptom in the assessment, now confirmed absent). |
| Compiled bindings | Inspect `hostBindings` in `dist/designer/browser/main-EXXJPNMF.js` | pass | `pointerup → finishGesture`, `pointercancel → captureLost`, `lostpointercapture → captureLost`; `releaseGuard` is no longer bound. |
| New tests | `pnpm --filter @rdlc/designer test` (in `test:unit`) | pass | 108/108, including the five `real pointer event dispatch` cases. Failure-first was shown during the fix: 4 fail with the old decorators. |
| Regression: unit | `pnpm test:unit` | pass | 80 Node + 108 Angular. |
| Regression: roundtrip / compatibility | `pnpm test:roundtrip`, `pnpm test:compatibility` | pass | 48 and 13 tests. |
| Regression: build | `pnpm build` | pass | Same bundle hash as the fix build (`main-EXXJPNMF.js`). |
| Regression: native | `VSCODE_VERSION=1.142.0 pnpm test:vscode` | pass | All six suites. They drive the host session, not the webview bundle. |
| Lint / type-check | `pnpm lint`, `pnpm typecheck` | pass | Root TypeScript and Angular. |
| Legacy browser regression | `node tests/browser/drag-scroll-jump.mjs` | skipped | Known stale since Phase 6 (fails at the drag-time preview anchor, before any release; recorded in fix.md follow-ups). Not a result for this bug. |
| Installed VS Code webview | Manual drag in the installed VSIX | pass | Confirmed by the user after installation. |

## Output Excerpts

```
unselected edits [{"action":"move","targetIds":["2:3"],"unit":"pt","dxPt":32,"dyPt":18}] | feedback: Preview only — release to apply. | Applying edit — mutations are temporarily unavailable. | errors 0
resize     edits [{"action":"resize","targetIds":["2:3"],"unit":"pt","handle":"se","xPt":260,"yPt":72}] | errors 0
marquee    edits [] | selected ["0","1"] | feedback: (none) | errors 0
click      edits [] | selected ["0"] | feedback: (none) | errors 0

Tests  108 passed (108)            # designer
ℹ pass 80 / ℹ fail 0               # Node unit
PASS lifecycle.test.cjs … PASS synchronization.test.cjs   Exit code: 0
```

## Residual Risks

- The real-browser checks ran in headless Chrome with a mocked `acquireVsCodeApi`, not inside VS Code's webview iframe. VS Code focus handling around the webview is not covered.
- The Chromium driver used for these checks lives in the session scratchpad, not the repository. The committed browser regression (`tests/browser/drag-scroll-jump.mjs`) is stale for Phase 6 and not wired into any command. Only the jsdom real-event specs guard this bug going forward.
- Space+drag pan and the table move grip were not driven in Chromium. They share `finishGesture`/`captureLost` and the same binding fix.

## Closure

The user confirmed on 2026-10-18 that pointer manipulation works in the installed VSIX. The bug is closed.

## Recommendation

Closed after the user confirmed the fix in the installed VSIX (`dist/rdlc-code-0.1.0.vsix`, SHA-256 `57500208fa8ad568cc3ac6cc51114e2e8f2ab9e7b1218f6e80c46b76f96bc99b`). All automated and rendered-Chromium evidence shows the fix holds with no regressions. Follow-up: update `tests/browser/drag-scroll-jump.mjs` for Phase 6 and make it a documented command, so real-browser pointer checks run routinely.
