# Bug Verification: Cross-platform Electron test assertions

- **Slug**: ci-github-failure
- **Tested**: 2026-10-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The original Windows clipboard assertion no longer fails: explicit LF and CRLF cases pass in both development and installed-VSIX Electron runs. All local regression and static checks pass, but the original macOS reproduction and the complete GitHub desktop matrix were not exercised, so cross-platform CI recovery remains unverified.

Slug resolution was explicit (`slug=ci-github-failure`). The assessment and fix report were read in full. No source files were modified during verification. `.specify/extensions.yml` contains `hooks: {}`, with no pre/post-verification hooks to execute.

## Checks Performed

Environment: Windows, Node `v24.22.0`, Corepack-managed pnpm `11.28.2`, cached VS Code `1.142.0`. Electron commands used `VSCODE_VERSION=1.142.0`, with `TEMP` and `TMP` set to the existing workspace `.vscode-test/tmp` directory. Checks used existing dependencies, generated bundles and VSIX; no install, download, remote workflow dispatch or full rebuild was required.

| Check | Command / Action | Result | Notes |
| --- | --- | --- | --- |
| Reproduction (Windows, post-fix) | `corepack pnpm test:vscode` | pass | Exit 0. All seven suites pass; clipboard includes explicit LF/CRLF stale-paste checks and exact restoration by one Undo. |
| Updated history regression tests | Same development Electron run | pass | Mixed twenty-step history, structural/property history, direct manipulation, nudging and arrangement tests pass with bounded exact-state waits. |
| Installed package regression | `corepack pnpm test:package` | pass | Exit 0. Five package tests pass, zero fail; VSIX installs successfully and all seven packaged Electron suites pass. |
| Formatting | `corepack pnpm format:check` | pass | Exit 0; all matched files use Prettier style. |
| Lint | `corepack pnpm lint` | pass | Exit 0. |
| Root TypeScript | `corepack pnpm exec tsc -p tsconfig.json --noEmit` | pass | Exit 0; executes the first stage of the configured typecheck script. |
| Designer TypeScript | `corepack pnpm --filter @rdlc/designer typecheck` | pass | Exit 0; `ngc -p tsconfig.app.json --noEmit`. Executed separately because the composite script's nested bare `pnpm` is unavailable on this shell's PATH. |
| Diff whitespace | `git diff --check` | pass | Exit 0. |
| Current-source bundle equivalence | In-memory `esbuild.build({write:false})` for clipboard/lifecycle, compared with existing bundles using `esbuild.transform({minifyWhitespace:true})` | pass | Exit 0. Both executed test bundles match current source after formatting normalization. Includes their imported shared history helper. |
| macOS arm64 reproduction | Electron suites with `VSCODE_VERSION=stable` on macOS | not-run | This host is Windows. Successful Windows history tests cannot prove the macOS timing hypothesis. |
| Linux matrix | Development and packaged Electron runs on Ubuntu | not-run | No Linux execution environment used. |
| Floating stable resolution / fresh installation | Version lookup, downloads and `pnpm install --frozen-lockfile` | skipped | Network-dependent checks; cached pinned VS Code and installed dependencies were used instead. |
| Full remote CI and aggregate gate | Six desktop matrix entries and `Required checks` | not-run | Local uncommitted fix has not been submitted to GitHub CI during this verification. |

### Bundle preflight detail

An initial byte-for-byte bundle comparison exited 1 because the helper's final formatting changed emitted whitespace. A follow-up comparison parsed both outputs with esbuild and normalized whitespace; both bundles matched. This is a resolved artifact-formatting mismatch, not a failing regression test. No generated bundle or source was rewritten for this check.

## Output Excerpts

Development Electron run:

```text
PASS activation.test.cjs
PASS clipboard.test.cjs
PASS existing-report.test.cjs
PASS lifecycle.test.cjs
PASS new-report.test.cjs
PASS persistence.test.cjs
PASS synchronization.test.cjs
Exit code: 0
Command exit status: 0
```

Installed-package run:

```text
tests 5
pass 5
fail 0
Extension 'rdlc-code-0.1.0.vsix' was successfully installed.
PASS clipboard.test.cjs
PASS lifecycle.test.cjs
```

All seven packaged Electron suites reported `PASS`; the package command exited 0.

Static checks and bundle preflight:

```text
All matched files use Prettier code style!
PASS current-source bundle (ignoring formatting): clipboard.test.ts
PASS current-source bundle (ignoring formatting): lifecycle.test.ts
```

## Residual Risks

- The assessment's macOS stable failure was not reproduced post-fix on macOS. Whether bounded document synchronization resolves it remains inconclusive.
- GitHub runner differences, a fresh checkout/install and the floating `stable` version were not exercised. The local cached release matches the pinned matrix version and the stable release observed during assessment.
- Windows passing both complete Electron modes answers the assessment's question about later Windows failures locally: none appeared after the original clipboard assertion was corrected.
- Waiting for exact text still fails if one command does not reach the expected state; no command retries or weaker preservation comparisons were introduced. A macOS timeout must prompt investigation of command routing/document events and undo boundaries.

## Recommendation

Hold closure pending the full GitHub CI run for the submitted fix, especially macOS arm64, with all six desktop entries, packaged tests and `Required checks` successful. The Windows defect is locally resolved and no local regressions were observed. If macOS still fails, capture its exact-state timeout and surrounding document-change evidence, then rerun `/speckit.bug.assess` rather than weakening the history checks.
