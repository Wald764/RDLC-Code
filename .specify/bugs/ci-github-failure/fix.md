# Bug Fix: Cross-platform Electron test assertions

- **Slug**: ci-github-failure
- **Fixed**: 2026-10-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Clipboard refusal tests now cover explicit LF and CRLF documents and expect the newline convention of the open document. Clipboard and lifecycle history tests wait for the extension-host document to reach the exact expected state after each single native Undo/Redo command.

## Changes

| File | Change | Notes |
| --- | --- | --- |
| `tests/vscode/clipboard.test.ts` | Modified tests and fixture loader | Run cut/refusal coverage with both EOL conventions, assert the requested document EOL, derive the expected appended newline from `document.eol`, and assert a stale paste is rejected without changes or inserted IDs. Synchronize native history checks. |
| `tests/vscode/lifecycle.test.ts` | Modified history checks | Wait for each exact expected state in mixed, property, structural, direct-manipulation, nudge and arrangement Undo/Redo sequences. Existing equality, selection, dirty-state and save assertions remain. |
| `tests/vscode/session-checks.ts` | Added shared `history()` helper | Execute one Undo/Redo command, then use the existing ten-second bounded `until()` helper to await exact document content. No command retries or fixed sleeps. |

## Tests Added or Updated

- `tests/vscode/clipboard.test.ts::cutAndRefusals` — runs once with LF and once with CRLF, including the clipboard-read race; checks `STALE_EDIT`, `accepted=false`, `changed=false`, no inserted IDs, exact text with only the independent newline, and restoration by one Undo.
- `tests/vscode/clipboard.test.ts::sameAndCrossDocument` — waits for every intermediate Undo/Redo state, including consecutive commands.
- `tests/vscode/lifecycle.test.ts::mixedHistory` — preserves twenty accepted operations and exactly twenty Undos and twenty Redos, with exact-state synchronization before the existing checks.
- `tests/vscode/lifecycle.test.ts::run` — synchronizes property and structural history assertions while retaining dirty/save behavior checks.
- `tests/vscode/lifecycle.test.ts::directManipulation`, `nudging`, `arrangement` — use the same single-command synchronization consistently.

## Local Verification

Environment: Windows, Node `v24.22.0`, pnpm `11.28.2` invoked through Corepack, cached VS Code `1.142.0`. Electron commands set `VSCODE_VERSION=1.142.0`; this uses the existing cached distribution without requiring a version lookup/download. `TEMP` and `TMP` were directed to `.vscode-test/tmp` inside the workspace for Electron execution.

- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — root TypeScript compilation passed; the composite command then failed because its nested bare `pnpm` executable is not on this shell's PATH. Completed the remaining existing check with `corepack pnpm --filter @rdlc/designer typecheck` — passed (`ngc -p tsconfig.app.json --noEmit`). Both configured typechecking stages therefore passed.
- `corepack pnpm build` — passed; compiled TypeScript, built the designer/extension and bundled all Electron suites.
- `corepack pnpm test:vscode` — passed, exit code 0. All seven Electron suites passed: activation, clipboard (including explicit LF/CRLF cases), existing-report, lifecycle, new-report, persistence and synchronization.
- `corepack pnpm package` — passed; generated and verified `dist/rdlc-code-0.1.0.vsix`.
- `corepack pnpm test:package` — passed, exit code 0: five package tests passed, zero failed; VSIX installation succeeded; all seven packaged Electron suites passed. Output retained locally in ignored `.vscode-test/ci-github-failure-package.log`.
- `corepack pnpm format:check` — initially identified helper formatting; passed after correcting it. The final change was whitespace-only.
- `git diff --check` — passed.

Expected simulated filesystem permission/save-conflict errors appeared in the Electron logs, and their corresponding suites passed.

## Deviations from Assessment

No implementation scope expansion was required. The full Linux/macOS/Windows GitHub matrix was not executed locally: this environment provides Windows only, and no commit, push or remote workflow rerun was requested. Consequently, the macOS timing hypothesis remains pending CI confirmation, despite successful exact-state history checks in both local Windows modes.

## Follow-ups

- Run `/speckit.bug.test slug=ci-github-failure`.
- After submitting the changes, require the full six-entry desktop CI matrix, packaged tests and `Required checks` to pass.
- If a macOS exact-state wait times out, investigate editor routing and document-change versions/reasons around that single command as prescribed by the assessment; do not add command retries or weaken history assertions.

No extension pre/post-fix hooks are registered in `.specify/extensions.yml` (`hooks: {}`).
