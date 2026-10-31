# GitHub Actions verification

Updated: 2026-10-18. **Normal production delivery is proven; T078 is closed by owner
acceptance for the current scope.** Its full negative scenario matrix is unrun and
waived for now. This record distinguishes observed hosted
outcomes from local regression tests and workflow configuration.

## Hosted observations

| Run                                                                          | Observed outcome                                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [39075054671](https://github.com/Wald764/RDLC-Code/actions/runs/39075054671) | Candidate f59bad8 passed quality, six Windows/Linux/macOS minimum/stable desktop jobs and Required checks.                                      |
| [39075357277](https://github.com/Wald764/RDLC-Code/actions/runs/39075357277) | Actual v0.1.0 validation, complete quality matrix, canonical artifact, both credential preflights and all three publishers passed on attempt 1. |
| [39069396319](https://github.com/Wald764/RDLC-Code/actions/runs/39069396319) | Probe authentication preflight failed on missing inherited Open VSX credentials; all publication destinations were skipped.                     |
| [39069610156](https://github.com/Wald764/RDLC-Code/actions/runs/39069610156) | Probe GitHub draft/assets uploaded; missing draft discovery failed the GitHub check and blocked downstream publishers.                          |
| [39069849589](https://github.com/Wald764/RDLC-Code/actions/runs/39069849589) | Probe partial-publication/visibility failure recovered on attempt 2 with the same artifact and no rebuild or duplicate upload.                  |
| [39076203081](https://github.com/Wald764/RDLC-Code/actions/runs/39076203081) | Fixed-identity retirement hid/unpublished the Marketplace probe and withdrew its Open VSX versions, checking unchanged production bytes.        |

The production tag was validated detached locally before push. GitHub readback
confirmed active main/tag rulesets and only `v*` deployment rules in both publisher
environments. The owner-selected solo policy permits direct pushes to main while
blocking force pushes/deletion; full release CI still gates publication. Open VSX
uses PAT mode, not OIDC. See [release-readiness.md](release-readiness.md) and
[release-010.md](release-010.md) for complete identities and acceptance boundaries.

## Configuration and local tests

Workflow/code inspection confirms read-only source/build stages, environment-scoped
publisher credentials, source-free publisher jobs, frozen installs, tag-scoped
noncancelling concurrency and 90-day canonical retention. Inspection does not prove
every rejection under a live attack or injected failure.

Local release/CLI tests cover missing/failed/stale evidence, tag/version/ancestry
rejection, configured/unconfigured/conflicting authentication, full destination
inventories, draft asset conflicts, failed-job discovery of prior uploads and
missing/expired provenance. These test results are not hosted failure injections.

## Quiet Desktop host

The Desktop driver (`tests/desktop/driver.ts`) launches VS Code with telemetry,
experiments, natural-language search, extension auto-update and recommendations,
npm/JSON-schema/TypeScript package fetching, cloud-changes resume and the built-in AI
features (`chat.disableAIFeatures`) switched off, and with the network-active built-in
extensions disabled (`GitHub.copilot-chat`, `TypeScriptTeam.jsts-chat-features`,
`vscode.github`, `vscode.github-authentication`, `vscode.microsoft-authentication`,
`vscode.tunnel-forwarding`, `vscode.npm`, `ms-vscode.js-debug-companion`,
`vscode.terminal-suggest`). Terminal suggestions and shell integration
(`terminal.integrated.suggest.enabled`, `terminal.integrated.shellIntegration.enabled`),
task auto-detection (`task.autoDetect`, `gulp|grunt|jake.autoDetect`) and the JavaScript
debugger auto-attach (`debug.javascript.autoAttachFilter`) are off as well, so the host
no longer probes `PATH` entries (docker, mvn, gradle) or the workspace in the background.
The Linux host observer therefore reports traffic and file probes caused by the product and the
journeys rather than by VS Code background features; its allowlists are not widened.
Workspace trust settings are unchanged. Journeys open workspace files through the test
harness command `RDLC Test: Open Requested File` (request and result files in the
harness' global storage, `openWorkspaceFile` in the driver) rather than Quick Open file
search, whose result row sometimes never appeared on macOS. Hiding the Chat view alters the secondary side
bar and the designer width, so the pixel references below must be regenerated after
this change.

## Regenerating the Desktop pixel references

`tests/desktop/baselines/` holds the only pixel references, valid for one pinned
environment: Ubuntu 24.04, VS Code 1.142.0 (build `6d62b1d5...`), a 1440x1000 display
at DPR 1, `en_US.UTF-8`, UTC and the fonts reported by `fc-list` after installing
`fontconfig fonts-dejavu-core locales`. Other OS and VS Code combinations never
compare pixels (`referenceEnvironmentReasons` in `tests/desktop/evidence.ts`):
`bootstrap.spec.ts` records "non-reference environment" there and does not use the
reference. The bootstrap reference captures only the designer root (`rdlc-editor`
inside the webview), never the whole window, because the Explorer tree and the
breadcrumb carry random fixture names and checkout-dependent folders.

| File under `tests/desktop/baselines/`               | Consumed by                                                    |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `bootstrap/bootstrap.png`                           | `bootstrap.spec.ts` in the Linux 1.142.0 `desktop` `core` jobs |
| `bootstrap/bootstrap.metadata.json`                 | `visual.spec.ts` (all three tests) in the `visual` job         |
| `themes/<theme>-{activitybar,sidebar,designer}.png` | `visual.spec.ts` `US6.2-themes` in the `visual` job            |
| `reference-environment.txt` (informational record)  | Humans only                                                    |

The metadata records the observed OS image id (`ubuntu-24.04`, from `/etc/os-release`,
not the runner `ImageVersion`), VS Code version, build and executable hash, locale,
timezone, display and the exact `fc-list` family list. A runner image update that
changes the installed font families, or a VS Code binary change, makes the
`visual` job fail on the metadata comparison; regenerate in that case.

To regenerate:

1. Run the manual **Desktop baselines** workflow (`.github/workflows/baselines.yml`,
   `workflow_dispatch`) on the branch. It repeats the provisioning of the `visual`
   job, runs `pnpm test:e2e --update-baselines` (bootstrap reference and metadata,
   with `RDLC_ALLOW_CI_BASELINE_UPDATE=1`), generates the theme references with
   Playwright `--update-snapshots=all`, uploads the `desktop-baselines` artifact and
   then re-runs `pnpm test:visual` in comparison mode as a stability check.
2. Download `desktop-baselines`, review the images, extract it so its files land at
   `tests/desktop/baselines/`, and commit them.

The workflow never commits or pushes, and `ci.yml` never updates references.
Generating on a developer machine is refused unless the platform and VS Code version
match the reference environment, and the fonts must match the recorded list.

## Measuring Desktop flakiness

The manual **Desktop flake hunt** workflow (`.github/workflows/flake-hunt.yml`,
`workflow_dispatch` and `workflow_call`, `contents: read`) measures how unstable each Desktop test
is. It repeats every test and reports failure rates; it never retries, never hides a
failure and never gates a merge when run manually (`ci.yml` only calls it in strict
mode, see the stability gate below). Retries stay 0, a flaky or failed test still fails
normal runs and the Linux skip rules are the same.

```sh
gh workflow run flake-hunt.yml -f repeat=5
gh workflow run flake-hunt.yml -f repeat=10 -f groups=core,context -f os=ubuntu-24.04
```

| Input    | Meaning                                                                   |
| -------- | ------------------------------------------------------------------------- |
| `repeat` | Repeats of every test, an integer from 1 to 10 (default 5).               |
| `groups` | Comma-separated `core`, `authoring`, `context`; empty runs all three.     |
| `os`     | Comma-separated `ubuntu-24.04`, `windows-2022`, `macos-15`; empty is all. |
| `specs`  | Comma-separated spec file names to restrict the run to; empty is all.     |

The matrix is the `desktop` job of `ci.yml` (OS x VS Code `1.142.0` and `stable` x
group) with the same pinned actions, provisioning and environment, plus a `mode`
dimension: one job per Playwright invocation, `probe-packaged` (`core` only),
`functional` and `packaged`. Each job runs `pnpm test:e2e <mode flags> --measure
--repeat-each=<repeat>`. The host suites (`pnpm test:vscode`, `pnpm test:package`) are
not Playwright runs and are not repeated. Jobs use `fail-fast: false` and the
`aggregate` job runs whatever the outcome.

Time budget per job (timeout 350 minutes, CI uses 120): up to 30 minutes of setup,
a run step limited to 300 minutes whose Playwright global timeout is 2 hours per
repeat capped at 290 minutes, then at least 20 minutes for the `always()` upload.
Tests cut short by the global timeout are reported as interrupted or never started.

The runner options behind it are also usable locally:

- `--measure` keeps the normal reports (`runner-status.json`, `playwright-report.json`
  in a fresh `run-<uuid>` folder per invocation) but records failing, flaky or skipped
  tests under `measurement` in the status instead of failing. The exit code is
  non-zero only for harness errors: a mandatory suite that is missing or no readable
  Playwright report. `measurement` also counts interrupted and never-started tests,
  absent suites and report-level errors, and sets `incomplete`. A measurement run is
  never `validated`.
- `--repeat-each=<n>` (1 to 10, requires `--measure`) is passed to Playwright as
  `--repeat-each`. Without `--measure` the option is refused.
- `--update-baselines` cannot be combined with either option. Default runs add no keys
  to `runner-status.json`.

Each job uploads `flake-results-<os>-<vscode>-<group>-<mode>` (the Playwright JSON
reports and runner statuses only). `aggregate` runs `scripts/flake-report.ts` over them
with the planned matrix. It uploads the `flake-report` artifact (`flake-report.md` and
`flake-report.json`, complete) and appends a truncated summary to the run (the top 25
unstable tests plus any incomplete environments, because a step summary is limited to
1 MiB). The aggregate job fails when any environment is incomplete or has no report;
test failures alone do not fail it.

Reading the report:

- One row per test title and environment (OS, VS Code, group, mode: `probe-packaged`,
  `functional` or `packaged`) with runs, passes, failures, failure rate and the first
  line of the first error, sorted by failure rate. A rate strictly between 0% and
  100% is a flaky test; 100% is a consistent failure; a timeout counts as a failure.
  Interrupted and skipped executions are not runs.
- "Tests that never ran" lists tests with no executed run, with the skip reason
  (for example the UNVALIDATED host-observer and macOS skips) or an interruption note.
- An **INCOMPLETE MEASUREMENT** banner lists environments with interrupted or
  never-started tests (for example a global timeout), report-level errors, or no
  report at all. Their rates are lower bounds only, and their rows are marked
  `INCOMPLETE`. Do not read a missing row as a pass.
- "Harness errors" appears when a job could not produce a result (missing suite or
  report).
- Rows only measure the repeats of one run; compare several runs before trusting a
  low rate, since `repeat` repeats within one job on one runner.

## Stability gate for changed desktop specs

Every pull request runs the **Stability gate** of `ci.yml`: each `tests/desktop/*.spec.ts`
file that the pull request adds or modifies is repeated 5 times, with retries disabled,
on the whole Desktop matrix. A single failure in any repeat blocks the pull request.

- `changed-specs` lists the files on a full-depth checkout
  (`scripts/desktop-matrix.ts changed`; it fetches the base if it is missing) with
  `git diff --name-only --diff-filter=ACMR origin/<base>...HEAD -- 'tests/desktop/*.spec.ts'`.
  It is empty outside pull requests.
- `stability` calls `flake-hunt.yml` as a reusable workflow (`workflow_call`) with
  `repeat: 5`, `specs: <changed files>` and `strict: true`. The matrix is the flake
  hunt's: Linux, Windows and macOS x VS Code `1.142.0` and `stable` x the group of the
  spec and the modes that include it (`functional` and `packaged`, plus `probe-packaged`
  for the specs of the capability probe). The spec to group assignment is
  `DESKTOP_GROUPS` and `requiredDesktopSuites` in `tests/desktop/run-tests.ts`, read by
  `scripts/desktop-matrix.ts`; nothing is duplicated. Each job gets
  `RDLC_DESKTOP_SPECS=<its specs>`, which restricts the run to those files (it requires
  `--measure`, and a spec outside the job's mode is refused). Linux provisioning
  (`strace`, `iptables` plus the `rdlc-desktop` cgroup for host blocking, `xvfb`, locale) is the flake hunt's, shared by both uses.
- Strict mode (`--strict`, with `--measure`) fails a job on any failing or flaky test,
  any skip other than the platform skips documented in
  `tests/desktop/host-observer-scope.ts`, any interrupted or never-started test, an
  absent spec file or a report-level error. The aggregate additionally fails on a
  missing report, and requires every measurement job to have succeeded
  (`flake-report --strict` exits 4 on a failing row). The manual flake hunt is unchanged:
  without `strict`, test failures stay data.
- When no spec changed, `changed-specs` still runs (about a minute), `stability` still
  runs and plans an empty matrix (every measurement job is skipped, within a couple of
  minutes), and succeeds, so it always reports a status. A changed spec in no
  `DESKTOP_GROUPS` entry fails planning, since CI would never run it. `visual.spec.ts`
  is the exception: it only runs in the pinned `visual` job (reference environment),
  which every pull request already runs once, so it is not repeated.
- Required check: `required` ("Required checks") now needs `changed-specs` and
  `stability` and fails unless both succeeded. Branch protection already requires
  "Required checks"; no new status check has to be added.
- The flake hunt also accepts `specs` when run manually, for example
  `gh workflow run flake-hunt.yml -f specs=data.spec.ts`.

Cost: a changed spec runs 5 times in up to 18 jobs for the `core` group (3 OS x 2
versions x 3 modes) and 12 for the others, each limited like the flake hunt jobs.

Limits:

- Capacity: each job keeps the flake hunt's Playwright global timeout of 2 hours per
  repeat, capped at 290 minutes. The unit is the whole spec file, so a changed
  `context.spec.ts` (or any large spec) repeats the entire file 5 times per environment
  and can reach the cap, in which case unfinished tests are interrupted and the gate
  fails as incomplete. Split a very long spec rather than raising the cap.
- Pushes to `main` and release calls of `ci.yml` are not gated: the gate needs a pull
  request base, so `changed-specs` is empty there and `stability` succeeds with nothing
  to measure. Only pull requests are protected.
- Strict reports also fail when a test ran fewer times than the declared repeats or was
  skipped for a reason other than the documented `UNVALIDATED` platform skips.

## Optional follow-ups accepted as unrun

- Exercise fork and same-repository PR secret isolation, without exposing secrets.
- Inject failures into each quality/evidence gate and prove no artifact upload.
- Exercise cold-cache and stale-lockfile behavior in hosted runs.
- Exercise invalid tag/version and missing/invalid optional-registry setup live.
- Demonstrate concurrent same-tag exclusion rather than only inspect concurrency.
- Inject each remaining partial-success/lost-response case and verify original
  artifact reuse; the observed Open VSX visibility recovery covers only one case.

Version preparation, scoped candidate acceptance and explicit publication already
occurred. The owner closed this extended verification task while retaining the
unrun follow-ups above. No new production publication is triggered by this update.
