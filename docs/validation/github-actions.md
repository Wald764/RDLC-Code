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
