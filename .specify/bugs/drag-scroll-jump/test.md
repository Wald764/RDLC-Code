# Bug Verification: Stable canvas geometry and scroll during direct manipulation

- **Slug**: drag-scroll-jump
- **Tested**: 2026-10-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified
- **Status**: closed
- **Closed**: 2026-10-18

## Summary

Neither the drag-time feedback reflow nor the release/acceptance scroll jump reproduces in the rendered production Angular designer under automated Chromium pointer input. All executed regression and static checks pass. Following the initial partial verification, the user confirmed that the fix works and explicitly authorized closure on 2026-10-18 ("tu peux cloturer c'est bon"). The result is verified based on the automated evidence and that user confirmation; detailed manual zoom/keyboard coverage was not reported.

The slug was supplied explicitly. Both prerequisite reports were read in full; no existing verification report was overwritten. This verification changes no source code and does not resume the implementation workflow.

## Checks Performed

Environment: Windows, isolated Node 24.22.0 / pnpm 11.28.2 toolchain selected through `PATH`, Chrome 155.0.8059.80. Browser checks use the existing production assets under `dist/designer/browser`, built in the preceding fix workflow, and a loopback-only mock VS Code bridge. No fresh production build or VSIX packaging was performed in this verification run.

| Check | Command / Action | Result | Notes |
| --- | --- | --- | --- |
| Automated post-fix reproduction | `node tests/browser/drag-scroll-jump.mjs` with `CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe` | pass | Exit 0; 16 rendered cases, real pointer input and capture, canvas position and window scroll measured through preview, release and acceptance. |
| New/updated focus and lifecycle regressions; existing designer suite | `pnpm --filter @rdlc/designer test` | pass | Exit 0; 36 tests in five files, including accepted move/resize message ordering and version-scoped form focus/draft reset. |
| Existing packaged extension checks | `node --test dist/tests/package/*.test.js` | pass | Exit 0; 4 tests. Checks existing VSIX identity/assets and packaged webview restrictions; does not install or operate the extension. |
| Lint | `pnpm lint` | pass | Exit 0; no diagnostics. |
| Root and Angular type checking | `pnpm typecheck` | pass | Exit 0; TypeScript and Angular compilation checks. |
| Scoped whitespace check | `git -c core.autocrlf=false diff --check -- apps/designer/src/app/authoring/authoring.component.ts apps/designer/src/app/editor/editor.component.html apps/designer/src/app/editor/editor.component.scss apps/designer/src/app/editor/editor.component.spec.ts apps/designer/src/app/editor/lifecycle.spec.ts` | pass | Exit 0; no diagnostics. |
| Assessment reproduction inside installed VS Code | Open affected RDLC report, drag/resize with authoring panel offscreen, measure offsets around accepted messages | not-run | No installed-webview pointer/keyboard session was performed. Chromium's mocked bridge does not establish native-host end-to-end behavior. |
| User acceptance | User confirms the fix works and authorizes closure | pass | Confirmed on 2026-10-18: "tu peux cloturer c'est bon". No detailed manual measurements were supplied; the agent did not perform the installed-webview walkthrough. |
| Installed VS Code zoom and keyboard accessibility | Repeat gestures at the user's zoom; navigate authoring controls and scrollable feedback by keyboard | not-run | DPR emulation is not VS Code zoom validation; focus assertions do not constitute a full keyboard walkthrough. |
| Native/network-dependent acceptance suites | Full VS Code acquisition/launch and native-host suites | skipped | Broader environment-dependent checks are outside this targeted verification; no new downloads or expensive suites were requested. |

### Rendered reproduction coverage

The 16-case matrix crosses move/southeast resize, device scale factors 1/2, initial vertical scroll 0/120 (horizontal scroll 0/80), and snapshot-before-result/result-before-snapshot ordering. The canvas has sufficient height to keep the authoring panel outside the viewport.

Assertions cover:

- Stable body document origin and window X/Y offsets when selecting, showing `Preview only`, entering pending state, and reconciling each accepted message.
- Initial pointer offset retained by the move preview; resize dimensions reflect CSS-pixel deltas correctly.
- Intentional 24-pixel scrolling during a captured gesture is included once in report-space geometry, with the expected submitted point payload.
- Selection mapping and focus on the recreated authoring host survive acceptance.
- Cancellation, invalid release, accepted no-op, refusal, long informational feedback and independent document snapshots preserve canvas/viewport stability.

All cases retain body document Y **134 CSS pixels**. After the deliberate scroll, window Y **24** or **144** remains stable through release and reconciliation. The stable checks compare horizontal offsets as well, with a tolerance of less than **0.05 CSS pixels**. The deliberate scroll is part of the test stimulus, not an unsolicited scroll jump.

## Output Excerpts

Rendered Chromium regression:

```json
{
  "browser": "Chrome/155.0.8059.80",
  "status": "PASS"
}
```

All 16 emitted case entries report `bodyDocumentY: 134` and `scrollAfter: 24` or `144`, depending on initial scroll.

Designer suite:

```text
Test Files  5 passed (5)
Tests       36 passed (36)
```

Package suite:

```text
tests 4
pass 4
fail 0
cancelled 0
skipped 0
```

Static checks:

```text
$ eslint .
$ tsc -p tsconfig.json --noEmit && pnpm --filter @rdlc/designer typecheck
$ ngc -p tsconfig.app.json --noEmit
```

These commands completed with exit status 0. No failing assertion or regression was observed in this verification run. The pre-fix failures recorded in `fix.md` were historical evidence and were not rerun by reverting source during verification.

## Residual Risks

- The agent did not exercise the exact affected RDLC report or installed VS Code/Electron webview. User acceptance supplements the synthetic-scene browser harness; detailed manual reproduction steps and measurements were not supplied.
- DPR 1/2 coverage does not validate the user's VS Code zoom, zoom changes during a gesture or transformed/nested-scroll canvases.
- Programmatic focus remains assigned to an offscreen authoring host by the existing focus policy. Automated focus assertions pass, but keyboard usability and feedback scrolling need an installed-webview walkthrough.
- Disabling scroll anchoring on the editor intentionally suppresses automatic viewport compensation for other layout changes in that subtree. The tested independent snapshot remains stable; other report layouts are not exhaustively covered.
- The production assets and VSIX were reused from the preceding successful build/package workflow. Current source was exercised by the designer tests and type checker, but no new packaging or native acceptance run was performed here.

## Recommendation

Close the bug based on passing automated checks and explicit user acceptance on 2026-10-18. The bug-related hold on `/speckit.implement` is lifted; no implementation phase is resumed by this closure. The detailed zoom/keyboard limitations above remain recorded rather than being treated as completed checks.

## Extension Hooks

Pre-verification and post-verification checks read `.specify/extensions.yml`: `hooks: {}`. No `before_bug_test` or `after_bug_test` hooks are registered.
