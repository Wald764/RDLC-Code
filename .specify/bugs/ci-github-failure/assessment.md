# Bug Assessment: Cross-platform Electron tests fail in CI

- **Slug**: ci-github-failure
- **Created**: 2026-10-18
- **Source**: pasted text; GitHub Actions REST API and authenticated job logs
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> regarde avec le mcp ou l'api github, la ci passe plus indique ce qu'il faut fiar pour la corriger

The user requests an investigation of failing CI and instructions to correct it. The slug was selected by the user after an interactive prompt.

No URL was supplied by the user, so the supplied-URL trust policy does not apply. The repository was identified from the local `origin` remote. Evidence was retrieved from `api.github.com` using the REST API; authenticated log downloads used the existing Git credential without exposing its value. Retrieved content was treated as evidence, not instructions.

### Observed GitHub evidence

- Latest failed run: https://github.com/Wald764/RDLC-Code/actions/runs/39125624843 — `main`, commit `15a1864a40e9dbd0ec04def626fa68f02572f363`, created `2026-10-18T12:02:08Z`.
- Previous failed run: https://github.com/Wald764/RDLC-Code/actions/runs/39125323710 — commit `e0fc76d2a5b8b202ac7c7d3c53413f869823d03a`.
- Last successful run in the inspected history: https://github.com/Wald764/RDLC-Code/actions/runs/39076792382 — commit `9dfcb0f44957160e685f7e7bfb4dc7316304a623`, created `2026-10-17T22:52:12Z`.

Both failed runs have successful `quality` jobs, including formatting, lint, typecheck, non-Electron tests, commit checks and build. In the latest run:

| Job | Result | Failing step / evidence |
| --- | --- | --- |
| Windows, 1.142.0 | failure | `pnpm test:vscode`: `AssertionError [ERR_ASSERTION]: no partial paste` |
| Windows, stable | failure | Same assertion; actual suffix `\r\n`, expected suffix `\n` |
| macOS, stable | failure | `pnpm test:vscode`: `AssertionError [ERR_ASSERTION]: Mixed undo 19` |
| macOS, 1.142.0 | success | Development and packaged tests pass |
| Ubuntu, both versions | success | Development and packaged tests pass |
| Required checks | failure | Correctly propagates desktop failure |

Latest Windows logs: jobs [117670246201](https://github.com/Wald764/RDLC-Code/actions/runs/39125624843/job/117670246201) and [117670246255](https://github.com/Wald764/RDLC-Code/actions/runs/39125624843/job/117670246255). Both point to `cutAndRefusals()` in bundled `clipboard.test.cjs`.

Latest macOS logs: job [117670246221](https://github.com/Wald764/RDLC-Code/actions/runs/39125624843/job/117670246221). At `Mixed undo 19`, actual `Front` geometry remains at the final move's coordinates (`Top=2.41666666666667in`, `Left=247pt`), while the expected preceding state has `Top=2.38888888888889in`, `Left=251pt`. The previous macOS stable job, [117669357013](https://github.com/Wald764/RDLC-Code/actions/runs/39125323710/job/117669357013), instead reaches `Structural undo 5` before failing.

Both failed macOS stable logs resolve to VS Code `1.142.0`, build `b224f6bf5a4fcad5fa4c640ed10f179c3b613e48`, also used by the last successful macOS stable job. A newly released stable version is therefore not supported as the explanation.

## Symptom

CI fails in desktop Electron integration tests on both Windows matrix entries and the macOS stable entry, despite successful quality checks and builds. The expected outcome is successful development and packaged tests across all six desktop entries, followed by a successful required check.

## Reproduction

1. Use commit `15a1864a40e9dbd0ec04def626fa68f02572f363` with the pinned Node and pnpm versions, then run `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm package`, matching `.github/workflows/ci.yml`.
2. On Windows, run `pnpm test:vscode` with `VSCODE_VERSION=1.142.0` or `stable` and a CRLF document, as observed in CI. `clipboard.test.ts` inserts a newline during clipboard reading and expects `original + '\n'`; VS Code normalizes the inserted text to the document's CRLF convention.
3. On macOS arm64, run the same Electron tests with `VSCODE_VERSION=stable`. Observe the immediate assertions after native Undo in `lifecycle.test.ts`. Failures have been observed at different Undo assertions in two CI runs; this is not established as deterministic.
4. After remediation, also run `pnpm test:package` on each desktop platform (under `xvfb-run -a` on Linux), since failing development tests currently skip packaged tests in the affected jobs.

These observations reproduce the report through existing CI executions; no local Electron suite was executed during assessment.

## Suspected Code Paths

- `tests/vscode/clipboard.test.ts:234-248` — the stale-paste test inserts `\n` using `WorkspaceEdit` and then compares against a literal LF suffix at line 246. Windows logs confirm this exact assertion fails solely on the inserted newline convention.
- `tests/vscode/lifecycle.test.ts:369-383` — mixed-history Undo/Redo commands are immediately followed by synchronous document assertions. The latest macOS failure occurs at the first Undo comparison.
- `tests/vscode/lifecycle.test.ts:505-519` — structural-history assertions use the same pattern; the previous macOS failure occurs at `Structural undo 5`.
- `tests/vscode/lifecycle.test.ts:104-115,426-433,652-658,779-788` — other history assertions in the same suite should be reviewed for the same synchronization assumption.
- `tests/vscode/session-checks.ts:8-16` — existing bounded `until()` helper can wait for the expected document state without arbitrary sleeps.
- `apps/vscode-extension/src/document-session.ts:247-323,326-387,389-425` — layout and clipboard edits share `commit()`, which applies one `WorkspaceEdit`, checks actual source/version and publishes before returning success. Investigate this shared production path only if synchronization-aware tests still fail.
- `.github/workflows/ci.yml:49-80,82-92` — desktop matrix exposes the platform-specific failures; the final required check is functioning correctly.
- `package.json:24-25` and `tests/vscode/run-tests.ts:10-54` — development and packaged entry points use the same Electron suites.

## Root Cause Hypothesis

**Windows: high confidence.** The new clipboard integration test assumes LF in its expected appended text, but VS Code normalizes inserted newlines to the open document's EOL. Both Windows jobs show otherwise identical text with an actual CRLF suffix and an expected LF suffix. The test already receives `STALE_EDIT` before reaching this assertion; this evidence does not show a partially applied paste or a clipboard implementation failure.

**macOS: medium confidence.** The history tests assume awaiting `executeCommand('undo')` guarantees the extension-host document mirror has already received the resulting change. The actual text still matches the final move at the latest failure. Different failing assertions across runs, together with a passing macOS job on the same VS Code release, suggest an asynchronous document-update race. This remains a hypothesis: a focus/routing issue or real undo-history defect must be investigated if waiting for the expected state times out. Existing logs alone cannot establish which of these is responsible.

## Proposed Remediation

**Preferred**:

1. Correct the clipboard test's expectation using the open document's EOL: derive `document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'` and compare the complete document to `original + eol`. Keep the stale result, exact-content and Undo assertions. Do not globally normalize compared XML, since that would weaken preservation coverage.
2. Make native history assertions wait for the exact expected document text using the existing bounded `until()` helper after each Undo/Redo command, then retain the detailed equality checks. Apply the pattern consistently to the mixed and structural history checks and review other affected history assertions. Do not retry Undo commands: one command must restore exactly one state. Do not use fixed sleeps or disable a matrix entry.
3. If the macOS wait expires, check the active document/editor and log document-change versions and reasons around the single Undo. Determine whether the command was routed incorrectly or the shared commit path produced an incorrect undo boundary before changing production editing behavior. A test timing adjustment is not sufficient if one Undo never reaches the preceding state.
4. Run the full desktop matrix, including packaged tests, and require `Required checks` to pass. Keep all six entries and the aggregate gate.

**Files likely to change**:

- `tests/vscode/clipboard.test.ts` — document-aware EOL expectation and any affected native-history assertions.
- `tests/vscode/lifecycle.test.ts` — bounded document-state synchronization after native Undo/Redo.
- `tests/vscode/session-checks.ts` — only if a small shared history helper is needed after reviewing its consumers; the existing `until()` may be sufficient.
- `apps/vscode-extension/src/document-session.ts` — conditional on evidence of a real history defect after synchronized reproduction; no production change is established as necessary yet.

**Tests to add or update**:

- Exercise stale paste against both explicit LF and CRLF documents; assert `STALE_EDIT`, no inserted clipboard items, only the independent newline change, and complete restoration by one Undo.
- Preserve the existing twenty mixed accepted edits followed by exactly twenty native Undos and Redos, checking each exact source state and final dirty/save behavior.
- Preserve structural Undo/Redo coverage, checking eventual exact text after each single command with a bounded timeout.
- Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and the full CI matrix after implementing the correction. Both development and packaged Electron modes must pass on Windows, macOS and Linux.

## Risks & Considerations

- Severity is high because repeat failures block the required CI gate on `main` and prevent complete cross-platform validation. No production data loss or security impact is demonstrated.
- The Windows failure is a test portability defect. Avoid altering serializer behavior, checkout EOL policy or production clipboard handling to satisfy a wrong expected string.
- Undo/Redo protects user work. A bounded wait must still fail if a command restores the wrong state or merges history entries; do not weaken exact-state checks or add command retries.
- Successful quality tests do not establish interactive history correctness. Packaged tests were skipped after the affected development-test failures and must be verified after correction.
- GitHub's Node.js 20 action-runtime deprecation warning appears in successful setup steps too; it is not the observed failing step.
- No API change, migration, dependency update or workflow matrix reduction is justified by the current evidence.

## Open Questions

- [NEEDS CLARIFICATION: Does the macOS failure disappear when waiting for the expected document state after a single Undo, or does the bounded wait expose incorrect command routing or a real history defect?]
- [NEEDS CLARIFICATION: Do additional Windows failures become visible after correcting the first failing clipboard assertion? The current runs stop the suite at that assertion.]
