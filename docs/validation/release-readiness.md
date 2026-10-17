# Release readiness

Status: **blocked**, release preparation in progress. Updated: 2026-10-18.

Root and extension versions remain 0.1.0. No reviewed version-prepared candidate
has been accepted. This file deliberately has no passed JSON record; the release
validator must reject it rather than assume absent evidence passes.

Operator reports now cover the manual lifecycle walkthrough, isolation, keyboard,
performance and Linux checks. On 2026-10-18 the owner removed detailed timing
records, five-author usability acceptance, independent contributor reproduction
and interactive macOS acceptance from initial-release prerequisites. These are
not claimed as executed tests. The three-OS automated CI matrix remains mandatory.
The remaining candidate-bound evidence still needs final verification before a
passed readiness record and stable tag can be created.

## Release preparation observations (2026-10-18)

The operator confirms isolation and keyboard/performance checks as satisfactory
and reports Linux working. No Mac is available for an operator-run interactive
check. These statements are reported results, not captured timing samples or
instrumented isolation traces; no such data has been invented.

Hosted CI run [39070643650](https://github.com/Wald764/RDLC-Code/actions/runs/39070643650)
passed on the tested source commit `bc992a957e03bc759119ba794d80944c0ce0293f`.
Its quality job, all six desktop jobs (Windows, Linux and macOS, each on VS Code
1.142.0 and stable) and Required checks succeeded. Desktop jobs build, package and
run development and installed-VSIX suites. This supplies automated macOS evidence
without a local Mac; it does not establish interactive macOS acceptance.

Initial authenticated GitHub API inspection returned no repository rulesets and
reported `main` as unprotected. At the owner's request, three active rulesets were
then created and read back through the API:

- `protect-main` (25321470): target `refs/heads/main`, no bypass, no deletion or
  force pushes. At the owner's subsequent request, PR and required-status-check
  rules were removed to permit direct pushes while working solo. CI still runs
  after pushes, and release quality/evidence gates remain mandatory.
- `release-tag-creation` (25321471): target `refs/tags/v*`, creation restricted
  with an Always bypass only for Repository admin.
- `release-tag-immutability` (25321474): target `refs/tags/v*`, updates and
  deletions restricted, no bypass.

The effective branch-rules endpoint confirmed the two remaining `main` rules. No live
ref mutation was attempted to test rejection. Administrators can still edit the
rulesets. A failing push can now reach `main`; the maintainer must fix CI failures
before releasing. Tag creation/immutability rules were not changed.

The inert tagged probe has proven GitHub, Marketplace and Open VSX publication
and one failed-job recovery using the original artifact; see
[publishing-auth.md](publishing-auth.md). Both publisher environments were observed
to permit only `v*` tags. Production editor publication, the complete protection
settings audit and Open VSX OIDC remain unproven.

## Local editor VSIX verification

On 2026-10-17, source commit `bc992a957e03bc759119ba794d80944c0ce0293f` was
built and packaged on Windows x64 using Node 24.22.0, pnpm 11.28.2,
TypeScript 6.0.3, Angular 22.2.3 and vsce 3.7.1.

- Package: `dist/rdlc-code-0.1.0.vsix`, 98,507 bytes.
- SHA-256: `f8eaebc8b338e214befc79a4981e81f876d947e5d1c1067a5289211b09beda1b`.
- Unit tests: 44 Node and 14 Angular tests passed.
- Roundtrip / compatibility: 14 / 10 tests passed.
- Acceptance-record validator: 1 synthetic test passed; no real timing samples.
- Release tooling: 8 tests passed.
- Production build, packaging, lint and typecheck: exit 0.
- Actual package inventory/static isolation: 4 tests passed.
- Installed VSIX in an isolated profile, VS Code 1.142.0 (declared minimum and
  current stable): all six Electron suites passed: activation, existing-report,
  lifecycle, new-report, persistence and synchronization.

Read-only-volume and external-modification save errors were expected assertions
in the passing suites. Workspace Trust was disabled by the existing runner;
these results do not supply untrusted-workspace runtime isolation evidence.
The digest identifies this local build only; rebuilding may change ZIP timestamps.
No stable release tag was created and no production extension was published.

### Next interactive check

Operator feedback on 2026-10-18: the user confirmed that the manual walkthrough
below is satisfactory after receiving this exact VSIX path. This is reported
acceptance of the proposed creation/edit/undo/save/reopen/source/lifecycle
walkthrough, not independently observed per-action evidence. The user did not
provide separate VS Code/OS versions, timings or logs. It does not establish
keyboard-only, instrumented isolation, five-author usability or multi-OS results.

Install the exact VSIX above through VS Code's **Extensions: Install from VSIX**
command, preferably in a separate profile. Use **RDLC Code: New Report** to
create a report, add and edit content, undo/redo, save, close and reopen it.
Also open an existing report with **RDLC Code: Open Designer**, make a small edit
and verify preservation through **RDLC Code: Open Source**. Exercise native
save/discard/cancel choices on a disposable copy. Record the package digest,
VS Code/OS versions, actions and observed failures before accepting the manual
lifecycle check. Keyboard-only acceptance, real measurements, usability,
instrumented isolation, independent reproduction and multi-OS coverage still
follow their dedicated validation records.

Follow `docs/releases.md` to prepare the candidate and its single machine-readable
readiness record only after actual acceptance. Do not replace these blockers
with synthetic test outcomes or treat a local VSIX as publication approval.
