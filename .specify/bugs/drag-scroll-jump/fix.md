# Bug Fix: Keep canvas geometry and scroll stable during direct manipulation

- **Slug**: drag-scroll-jump
- **Fixed**: 2026-10-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The authoring panel now receives programmatic focus with `{ preventScroll: true }` when a new document version recreates it. This prevents the browser's focus-induced reveal of that offscreen panel while retaining the existing focus restart and stale-draft reset behavior.

Follow-up on 2026-10-18: informational messages now occupy a permanent, scrollable feedback slot above the canvas. The editor also opts out of browser scroll anchoring during form reconciliation. These structural changes prevent both the measured drag-time reflow and a separately measured post-acceptance scroll adjustment, without pointer offsets or scroll restoration.

The slug was supplied explicitly. The user confirmed proceeding despite the assessment's outstanding reproduction questions. Angular regression tests establish the accepted-gesture lifecycle, and an isolated rendered Chrome probe confirms the focus/scroll mechanism, including inside a disabled fieldset. A complete pointer-driven run inside the installed VS Code webview remains unverified.

## Changes

| File | Change | Notes |
| --- | --- | --- |
| `apps/designer/src/app/authoring/authoring.component.ts` | Modified focus options | One production-line change: initialization calls `focus({ preventScroll: true })`. |
| `apps/designer/src/app/editor/editor.component.spec.ts` | Added four regression cases; enriched direct-scene fixture | Move and southeast resize, each with snapshot-before-result and result-before-snapshot. Fixtures include real authoring state so the version-keyed subtree actually recreates. |
| `apps/designer/src/app/editor/lifecycle.spec.ts` | Updated existing lifecycle regression | Requires scroll-neutral focus while retaining form replacement, draft discard, usable focus, source-only behavior and source access assertions. |
| `apps/designer/src/app/editor/editor.component.html` | Grouped conditional feedback | A permanent status region contains host notices, pending state, gesture notices and outcomes. |
| `apps/designer/src/app/editor/editor.component.scss` | Stabilized feedback and scroll anchoring | A `5rem` feedback slot with internal overflow and keyboard focus styling; `overflow-anchor: none` on the editor prevents version-keyed forms from moving the viewport. |
| `tests/browser/drag-scroll-jump.mjs` | Added rendered-browser regression | Drives the production Angular application through Chromium CDP with a local mock host; no dependency added. |

Version-keyed form recreation, the bridge protocol, XML mutation, native history and the assessment file remain preserved. Existing unrelated working-tree changes were retained.

## Diff Highlights

```typescript
this.element.nativeElement.focus({ preventScroll: true });
```

The accepted-gesture tests spy on the actual authoring host initialization and require exactly one scroll-neutral focus call for the new version. Repeated same-version snapshots must not focus again or submit another mutation.

## Tests Added or Updated

- `apps/designer/src/app/editor/editor.component.spec.ts` — `uses scroll-neutral authoring focus after move, snapshot first: true/false`: starts and releases a valid changed move through `EditorComponent`, accepts the authoritative scene and correlated result in both orders, and verifies authoring subtree replacement, settled pending state, surviving mapped selection, accepted geometry, focus options and one submitted edit.
- `apps/designer/src/app/editor/editor.component.spec.ts` — corresponding `se` cases cover the shared lifecycle after a corner resize.
- `apps/designer/src/app/editor/lifecycle.spec.ts` — `recreates version-scoped forms and focus without committing an obsolete draft`: additionally requires `{ preventScroll: true }` on independent-version recreation. Existing assertions still verify that the previous draft is removed and focus reaches `rdlc-authoring`.
- Existing cancellation, invalid release, no-op, refusal, same-version snapshot and independent-version tests remain passing. These DOM tests do not measure rendered scroll offsets.

## Local Verification

Toolchain: isolated Node 24.22.0 / pnpm 11.28.2, using the pre-existing toolchain first in `PATH`. Browser probe: Google Chrome 155.0.8059.80 on Windows, headless, no external page or report-resource fetching.

| Command/check | Result |
| --- | --- |
| `pnpm --filter @rdlc/designer test` before the production change | Expected regression failure: five assertions failed because initialization called `focus()` with no options. Four accepted move/resize ordering cases and the existing lifecycle case failed; 31 tests passed. |
| `pnpm --filter @rdlc/designer test` after the change | PASS: 36 tests across five files; no failures or skips. |
| `pnpm lint` | PASS. |
| `pnpm typecheck` | PASS: root TypeScript and Angular type checking. |
| `pnpm --filter @rdlc/designer build` | PASS: production Angular build, entry `main-JAU5EUTI.js`. |
| Rendered Chrome focus probe | PASS: eight cases, asserting actual focus and scroll offsets with enabled/disabled fieldsets and zero/nonzero initial offsets. |
| `pnpm exec prettier --check` on the three changed TypeScript files | PASS. |
| `git -c core.autocrlf=false diff --check` on the three changed TypeScript files | PASS. |
| Repository-wide `git -c core.autocrlf=false diff --check` | FAIL on pre-existing `.claude/settings.json` lines 1–5 (CRLF/trailing-whitespace diagnostics); that unrelated file was not modified by this fix. |

### Rendered browser evidence

The isolated HTML probe uses a programmatically focusable `rdlc-authoring` custom element below a 2,200px spacer, inside a fieldset. A 2,400px-wide spacer also permits nonzero horizontal scroll. It toggles the fieldset's disabled state and calls either default `focus()` or `focus({ preventScroll: true })` after setting initial scroll offsets. CSS sets `scroll-behavior: auto` and disables scroll anchoring to isolate focus behavior from layout shifts.

Chrome was run with `--headless --disable-gpu --disable-background-networking --disable-extensions --no-first-run --no-default-browser-check --dump-dom`, using an inline `data:text/html` page and an isolated profile inside this workspace. PowerShell parsed the emitted JSON and asserted eight results, successful focus, unchanged offsets with `preventScroll`, and a downward jump in the default-focus controls. The probe was not added as a dependency or a permanent test harness.

| Fieldset disabled | Focus call | Before `(x, y)` | After `(x, y)` | Focused element |
| --- | --- | --- | --- | --- |
| false | `focus()` | `(0, 0)` | `(0, 2023)` | `RDLC-AUTHORING` |
| false | `focus()` | `(80, 120)` | `(80, 2023)` | `RDLC-AUTHORING` |
| false | `focus({ preventScroll: true })` | `(0, 0)` | `(0, 0)` | `RDLC-AUTHORING` |
| false | `focus({ preventScroll: true })` | `(80, 120)` | `(80, 120)` | `RDLC-AUTHORING` |
| true | `focus()` | `(0, 0)` | `(0, 2023)` | `RDLC-AUTHORING` |
| true | `focus()` | `(80, 120)` | `(80, 2023)` | `RDLC-AUTHORING` |
| true | `focus({ preventScroll: true })` | `(0, 0)` | `(0, 0)` | `RDLC-AUTHORING` |
| true | `focus({ preventScroll: true })` | `(80, 120)` | `(80, 120)` | `RDLC-AUTHORING` |

This resolves the assessment's fieldset qualification for the tested Chrome runtime: disabling the ancestor fieldset does not prevent programmatic focus on this custom host or the associated default-focus scroll. Combined with the Angular accepted-gesture tests, it supports the proposed focus correction. It does not prove the user's complete VS Code reproduction or exclude smaller status-layout/scroll-anchoring effects there.

Raw browser DOM/JSON output and diagnostics are local generated artifacts at `dist/drag-scroll-focus-probe.stdout` and `dist/drag-scroll-focus-probe.stderr`. The isolated browser profiles are under `dist/drag-scroll-focus-probe*`. These ignored artifacts are not portable acceptance evidence.

Manual checks: no installed VS Code webview pointer/keyboard walkthrough was performed. No native/network-dependent suite, VSIX packaging or publication was run for this fix.

Pre- and post-fix hook checks read `.specify/extensions.yml`, which contains `hooks: {}`. No executable bug-fix hooks were registered.

## Deviations from Assessment

- Initial production scope followed the preferred one-line focus remediation. The follow-up expands scope to the editor template/styles and a rendered regression script because the assessment's secondary status-layout/scroll-anchoring hypothesis is now measured and confirmed; the assessment explicitly permits investigating this residual mechanism.
- Browser verification used an isolated rendered Chrome page for the focus mechanism, rather than the complete installed VS Code webview. Temporary browser profiles/output were written only under the workspace's ignored `dist/` directory; no production-file scope expansion was needed.
- Remaining complete-webview validation is retained as a follow-up instead of claiming that DOM tests or the isolated probe establish end-to-end viewport stability.

## Follow-up: Drag-time feedback reflow

The user confirmed updating this existing report while preserving the initial focus-fix history. The existing assessment was read in full and retained unchanged. The user's observed behavior supplies the missing drag-time reproduction context and explicitly requests structural feedback stabilization. No implementation phase was resumed.

### Root cause and red/green evidence

The editor was a grid with conditional paragraphs and `1rem` gaps before `.page`. With the initial focus correction already installed, an actual captured pointer drag in the built Angular application changed the body's document Y coordinate from **38 to 107 CSS pixels** when `Preview only` appeared. The pointer proposal still used its original document-space origin, so the canvas moved underneath it by **69 pixels**.

Grouping all changing messages in the permanent feedback slot removed that reflow. The next rendered assertion exposed independent browser scroll anchoring on accepted-version reconciliation: window Y changed from **24 to 3 pixels**, while instrumented authoring focus received `{ preventScroll: true }` and itself left scroll unchanged (`3 -> 3`). Excluding the editor from automatic scroll anchoring removed this residual adjustment. There is no compensating `scrollTo`, fixed pointer correction or changed focus policy in production.

### Coordinate review

`startGesture` records `clientX/Y + window.scrollX/Y`; `moveGesture` subtracts that document-space origin and converts CSS pixels to points once. Proposals are always derived from accepted report geometry, not the previous preview. The page/body use untransformed CSS-pixel dimensions and absolutely positioned items. Stable body origin therefore preserves the pointer's initial offset. Intentional window scrolling is counted once; the test scrolls by 24 pixels during a gesture and verifies the resulting point payload and preview position.

The test checks actual `getBoundingClientRect()` coordinates and both horizontal/vertical window offsets. Device scale factors 1 and 2 verify that device pixels are not mistakenly treated as report-space pixels. These are **DPR checks, not an installed VS Code zoom test**. No custom canvas zoom/transform or nested canvas scroll container exists in the current editor; transformed canvases and a zoom change mid-gesture are outside this fix. Native browser zoom keeps `clientX/Y`, scroll offsets and layout in CSS pixels; the affected VS Code zoom settings still require manual verification.

### Follow-up regression coverage and local verification

- `tests/browser/drag-scroll-jump.mjs`: 16 rendered cases crossing move/southeast resize, device scale 1/2, zero/nonzero initial window scroll (including horizontal scroll), and both snapshot/result orders.
- Each case asserts stable body origin at selection, preview, pending and acceptance; real pointer capture; preview geometry; expected point payload; mapped selection; preserved authoring restart focus; cancellation; invalid release; accepted no-op; refusal; long wrapped feedback overflowing within its slot; and an independent source snapshot.
- Red before the layout fix: `Preview status insertion: bodyY changed 38 -> 107`.
- Red after the slot alone: `Authoritative acceptance/focus: scrollY changed 24 -> 3`.
- Green after both structural changes: **16/16 cases PASS**, Chrome **155.0.8059.80**. Body document Y remains **134**; deliberately scrolled Y **24/144** remains unchanged through release and reconciliation.
- `pnpm --filter @rdlc/designer test`: **36/36 PASS**, including the previous focus/draft lifecycle regressions.
- `pnpm --filter @rdlc/designer build`: **PASS**, production entry `main-XFC3EYBZ.js`.
- `pnpm lint`, `pnpm typecheck`, scoped Prettier and scoped `git -c core.autocrlf=false diff --check`: **PASS**. An initial lint failure for the browser script's `fetch` global was corrected before rerunning successfully.
- `pnpm build`, `pnpm package`, `node --test dist/tests/package/*.test.js`: **PASS**, **4/4** package tests. `dist/rdlc-code-0.1.0.vsix` now contains `main-XFC3EYBZ.js` and both structural corrections. This supersedes the earlier focus-only VSIX.
- Pre/post follow-up hook checks: `.specify/extensions.yml` still contains `hooks: {}`; no executable hooks are registered.

Run the rendered regression from the workspace root after building the designer, using Node 24 and a local Chromium executable:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tests/browser/drag-scroll-jump.mjs
```

The script serves only built assets over loopback, mocks the VS Code message bridge and writes isolated Chromium profiles under ignored `dist/`. It does not open the installed extension or exercise real native-host persistence. The feedback area reserves `5rem` even when empty; longer messages scroll internally and the region is keyboard focusable. Disabling editor scroll anchoring also means automatic viewport compensation is intentionally suppressed for unrelated layout changes in that subtree.

## Follow-ups

- Run `/speckit.bug.test slug=drag-scroll-jump`.
- In the affected VS Code webview, repeat a changed move and a resize with the authoring panel offscreen, starting at both zero and nonzero scroll positions. Record window/document/scrollable-ancestor offsets before release, after snapshot rendering, and after result reconciliation. Check accepted geometry, surviving selection and usable keyboard focus.
- Check cancelled/invalid/no-op/refused gestures and independent source updates in that rendered environment. Focus remains intentionally assigned to the existing authoring restart point; `preventScroll` does not make that point visible.
- Confirm the now-fixed status-region transitions in the installed VS Code webview, including user zoom settings and keyboard navigation to the scrollable feedback area. The Chromium regression covers the actual compiled Angular UI with a mocked bridge; it does not replace that final installed-extension check.
