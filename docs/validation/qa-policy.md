# QA and release policy

Effective: 2026-11-07. This is the canonical description of how quality is checked,
classified and reported. It implements constitution v2.0.0 (principle VI and
workflow items 6-9) and refines, but never weakens, principle VII. Other documents
link here instead of repeating it.

## Principles

- Local QA is targeted. During development, run only the QA relevant to the modified
  code and its affected dependencies. The complete regression suite and Desktop
  validation belong to GitHub Actions and run locally only on explicit request.
- Classification is per check and per test, not per job. Any check or test that is
  not explicitly classified informational is critical (fail closed).
- A failure is never converted into a pass. Informational failures stay visible,
  are classified, and are accepted explicitly or fixed.

## QA levels and commands

| Command                       | Purpose                                                                                                                                                                                                                                                                                                                                    | Never does                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `pnpm qa:quick`               | Default local QA. Selects changed files (merge-base with `origin/main`, staged, unstaged, untracked), maps them to affected workspaces through the dependency graph, compiles once, runs only the affected `node --test` files and prettier/eslint on changed files. Unmapped paths broaden conservatively to all non-VS-Code unit suites. | VS Code launch, VSIX packaging, Desktop E2E |
| `pnpm qa:integration`         | Batch verification: full format, lint and typecheck, one compile, all unit, roundtrip, compatibility, acceptance and release suites, and `build`. Adds one extension-host VS Code run (`test:vscode`) only when the extension or a package it depends on is affected.                                                                      | Desktop E2E, visual tests, packaging        |
| `pnpm qa:release`             | Critical release checks locally: one compile, release tests, build, package (`package.js` verifies the VSIX contents) and static package tests. `--tag vX.Y.Z` also runs `validate-release.js` for that tag. It does not run `validate-release-config`, which needs the Entra and Open VSX environment and runs in GitHub Actions only.    | Desktop E2E, `validate-release-config`      |
| `pnpm qa:full --confirm-full` | Complete regression equivalent to CI, including packaging, `test:vscode`, `test:package`, all Desktop E2E groups and `test:visual`. Refuses to run without `--confirm-full`. Explicit user request only.                                                                                                                                   | Nothing                                     |

Every command supports `--plan`, which prints the selection and runs nothing.
`qa:quick` also accepts `--base <ref>`. Focused Desktop debugging remains possible
with a single Playwright spec, as described in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Classification

The single source is `tests/desktop/qa-classification.ts`, evaluated by
`scripts/qa-gate.ts`. Informational entries must carry a written justification.

### Blocking (critical)

| Area                                        | What blocks                                                                                                                                                                                                                       | Why                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| CI job `quality`                            | Format, lint, typecheck, unit, roundtrip, compatibility, acceptance reference, release tests, commit check, build.                                                                                                                | Cheap, deterministic, and they guard XML preservation, validation, and build integrity.      |
| Desktop cell steps                          | Build, package, VS Code provisioning, extension-host tests (`test:vscode`), package tests (`test:package`), driver and security probe (`test:e2e --probe --packaged`). A missing step result or report is blocking.               | Without them nothing else is trustworthy; a missing result is missing critical evidence.     |
| Desktop E2E tests                           | Functional and installed modes for bootstrap, workspace, structure, data, components, images, context, offline, security-observer and coverage specs, and all accessibility tests (keyboard operability US6.1/FR-027 and themes). | They cover essential authoring, data loss, native undo/redo, isolation and offline behavior. |
| Release                                     | Tag and version validation, main ancestry, canonical VSIX build, verification, digest and manifest, packaged probe and critical packaged E2E on the canonical VSIX, critical evidence IDs, `qa-summary`.                          | Published bytes must be traceable to the exact reviewed commit.                              |
| Critical assertions in informational suites | Remain blocking.                                                                                                                                                                                                                  | Classification is per test, not per job.                                                     |

### Informational (visible, not required)

Informational status is decided per test and per failure signature, never per file
or per job. A failure that does not match both the test and the signature below is
critical.

| Check                                                                                   | Informational only when                                                                                                                                                                                                                               | Justification                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `visual.spec.ts`, `layout.spec.ts`                                                      | The failure is a screenshot, pixel or layout-measurement mismatch. A source-byte, no-edit, crash, timeout or unrecognized failure in these files is critical.                                                                                         | Rendering and layout differences without data or security impact.                  |
| Contrast tests (FR-028, SC-006-contrast), which live in `visual.spec.ts`                | The failure is a screenshot or pixel mismatch. Contrast remains an acceptance requirement: a recorded mismatch keeps the feature from FULLY VALIDATED.                                                                                                | Cosmetic rendering, but still mandatory acceptance evidence.                       |
| `native-drag.spec.ts`                                                                   | The outcome is the documented capability-unavailable result. Any other failure (source bytes, no edit, crash, timeout, unrecognized) is critical.                                                                                                     | Native custom-MIME drag delivery is already recorded as unavailable with evidence. |
| `SC-003-timing` in `structure.spec.ts`                                                  | The failure is the latency budget (at least 95 of 100 within budget). Any other failure of that test, and every other `structure.spec.ts` test, is critical.                                                                                          | Runner speed is not a product defect. Correctness and race tests stay critical.    |
| `SC-006-timing` in `images.spec.ts` (`image-latency-budget`)                            | The failure is a latency budget only (selection and move feedback within 100 ms, a 5 MiB picture shown within 1 s). Any other failure of that test (item count, displayed picture, source bytes), and every other `images.spec.ts` test, is critical. | Runner speed is not a product defect. Correctness and race tests stay critical.    |
| `US-IMG-*` image cases in `visual.spec.ts` (sizing modes, placeholder)                  | The failure is a screenshot or pixel mismatch, like the other `visual.spec.ts` cases. Missing baselines, source-byte, no-edit, crash, timeout or unrecognized failures stay critical.                                                                 | Rendering differences without data or security impact.                             |
| CI job `visual` ("Pinned visual references")                                            | The job's failing tests are all informational under the rules above.                                                                                                                                                                                  | Reference-environment pixels do not prove a data or security fault.                |
| Platform skips allowlisted in `tests/desktop/host-observer-scope.ts` (`PLATFORM_SKIPS`) | Always. They are recorded as UNVALIDATED, prevent FULLY VALIDATED and never block. Any other skip blocks.                                                                                                                                             | Documented platform limits of the observer.                                        |

`accessibility.spec.ts` has no informational rule: all its tests, keyboard
operability and themes alike, are critical. The contrast tests are not in that file.

Stability evidence follows the same per-test rule. The `changed-specs` job is
critical: its failure means missing stability evidence. The `stability` job results
are classified per test: a critical test that fails or flakes under the strict
5-times repeat blocks the merge, while a failure that is informational under the
rules above does not.

Known limitation: Playwright stops a test at its first failed assertion. When an
informational signature fails (for example a screenshot diff), any later assertion in
the same test, such as source-byte equality, does not execute in that run, so the run
gives no evidence for it. The test is listed as informational, never as passed. It
prevents FULLY VALIDATED, and a release needs an explicit exception for it. Reviewers
accepting an exception must check that the waived test's unexecuted critical
assertions are covered elsewhere or re-run green.

### Other blocking conditions

The gate also blocks on an unexplained derived-job failure, a runner exit code that is
non-zero without any failing test, an incomplete report, and any skip that
`tests/desktop/host-observer-scope.ts` does not allow.

### Release-readiness evidence

Critical evidence IDs must be `passed`: preservation, compatibility, lifecycle,
isolation, keyboard, licenses, v1, v3, v4, v5, v6, v8, github-auth,
marketplace-auth, recovery, github-actions and the `openvsx-*` records. Only three
IDs are non-critical and may instead be `accepted-failure`, which requires an
`issue` URL and a `reason` and prevents FULLY VALIDATED:

- `cross-os`: cross-platform breadth beyond the Linux gate (the desktop matrix on
  every OS and on the minimum and stable VS Code versions).
- `v2`: the same matrix breadth as `cross-os` (all desktop jobs on minimum and
  stable).
- `v7`: hosted-runner performance budgets and the pinned visual references.

`nonCriticalEvidence` in `scripts/validate-release.ts` is authoritative.

## Failure handling

1. Every failure is visible in the job result and in the QA summary.
2. Assertions and exit statuses are preserved. A failing test is never wrapped to
   exit 0, and no blanket `continue-on-error` is used in `ci.yml` or `release.yml`.
3. Diagnostics (reports, traces, screenshots, step outcomes) are uploaded as
   artifacts even when a step fails.
4. The gate writes `qa-summary.json` (candidate SHA, `blocking[]`, `informational[]`,
   `unvalidated[]`, status) to the step summary and the artifact `qa-summary-<sha>`.
   A missing or invalid summary is itself blocking.
5. Each accepted informational failure links to a GitHub issue or a documented
   exception.
6. A release accepts informational failures only through an explicit exception
   (see below). An unexpected failure is investigated and classified before any
   waiver; a confirmed flake is handled by re-running the failed jobs.

Exceptions never apply to critical checks: an exception targeting one is a
validation error.

### Release exceptions

`docs/validation/release-readiness.md` may carry an optional `qaExceptions` array
in its JSON record:

```json
{
  "id": "<check or test id>",
  "scope": "<os>/<vscode>",
  "issue": "https://github.com/Wald764/RDLC-Code/issues/N",
  "reason": "<text>",
  "acceptedBy": "<login>",
  "acceptedOn": "YYYY-MM-DD"
}
```

`scope` is optional. In release mode every informational failure must match an
exception; otherwise the release is not publishable.

## Outcomes

Outcomes are never interchangeable.

| Outcome         | Meaning                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MERGEABLE       | The `Required checks` status passed: no critical failure and no missing critical evidence. Informational failures may exist and are listed.                                                                                                                                                                               |
| PUBLISHABLE     | `release-gate` passed on the exact tagged commit: critical release gates passed, critical evidence passed, and every informational failure is covered by a documented exception. `publish.yml` refuses to publish unless `qa-status` is PUBLISHABLE or FULLY VALIDATED (the auth-test caller has a narrow separate path). |
| FULLY VALIDATED | Zero failures anywhere, zero applied exceptions, zero `accepted-failure` evidence, zero UNVALIDATED platform skips, and all mandatory acceptance evidence complete. Publishing with accepted warnings never yields it.                                                                                                    |

Missing or failed mandatory evidence blocks a feature from being declared FULLY
VALIDATED (constitution principle VII). It does not by itself block a merge or a
publication unless the check is critical.

## GitHub configuration

The only required status check is `Required checks` (job `required` in
`.github/workflows/ci.yml`, source GitHub Actions). Target ruleset `protect-main`:
deletion blocked, force pushes blocked, pull request required (0 approvals) and
`Required checks` required, with no bypass actors. Work happens on feature
branches merged through pull requests. See [releases.md](../releases.md) for the
release flow and the tag rulesets.

## Headless VS Code on Linux

On Linux, `pnpm qa:*` runs every step that opens a VS Code or Electron window
(`test:vscode`, the installed-VSIX host run, Desktop E2E and `test:visual`) under
`xvfb-run -a -s "-screen 0 WxHx24"` (1920x1080 for the extension host, 1440x1000 as in
CI for Desktop E2E and visual runs). The child environment drops `WAYLAND_DISPLAY`,
`XDG_SESSION_TYPE`, `EGL_PLATFORM` and `XAUTHORITY`. Without this, Electron opens on
the developer's own Wayland session: when it is locked, minimized or reached over RDP,
the window is unfocused, native undo does nothing ("undo document sync" failures) or
startup hangs, even under a plain `xvfb-run`. The printed step command shows the
wrapper. The wrapper is skipped when `CI` is set (workflows wrap themselves), on
macOS and Windows, and when `xvfb-run` is not installed (a one-line note is printed and
the run stays on the current display). Set `RDLC_QA_DISPLAY=native` to keep the current
display, for example to watch the window.
