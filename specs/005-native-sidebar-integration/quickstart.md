# Quickstart: Native Sidebar Validation

This is a validation/run guide for implementation. The initial Desktop runner now exists; feature 005 is incomplete. Use the contracts for [native UI](contracts/native-workspace.md), [bridge](contracts/sidebar-bridge.md), [Desktop evidence](contracts/desktop-validation.md) and [data model](data-model.md); do not treat this guide as executed acceptance evidence.

## Prerequisites and existing baseline commands

- Local Desktop Windows/macOS/Linux; Node 24.22.0 and pnpm 11.28.2; access to dependency/VS Code downloads during provisioning.
- A disposable workspace/profile and the committed fixture corpus. Never use a personal VS Code profile for automated tests.
- Linux Desktop suites require Xvfb. Visual references require the fixed environment in the Desktop contract, including exact Desktop build/fonts/display/theme.
- Source checkout is currently `main`; setup resolves feature directory `specs/005-native-sidebar-integration`. Use the approved feature checkout for implementation.

From repository root, these commands exist now. Run sequentially because compile-triggering scripts replace compiled output trees:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:roundtrip
pnpm test:compatibility
pnpm build
pnpm test:acceptance
pnpm test:release
pnpm package
$env:VSCODE_VERSION = '1.142.0'
pnpm test:vscode
pnpm test:package
$env:VSCODE_VERSION = 'stable'
pnpm test:vscode
pnpm test:package
```

On Linux, prefix each Desktop invocation with `VSCODE_VERSION=1.142.0 xvfb-run -a` (then repeat with stable). Existing integration/package runs do not alone establish Desktop UI acceptance or restricted-workspace behavior.

## Desktop foundation commands

After full build/package, these commands invoke the initial runner. They currently fail closed on missing mandatory suites or reference images; they do not certify the native sidebar. Their implementation must conform to [desktop-validation.md](contracts/desktop-validation.md):

```powershell
$env:VSCODE_VERSION = '1.142.0'
pnpm test:e2e -- --probe
pnpm test:e2e
pnpm test:e2e -- --packaged
pnpm test:visual
$env:VSCODE_VERSION = 'stable'
pnpm test:e2e
pnpm test:e2e -- --packaged
```

Repeat functional/package runs on each supported OS; fixed-reference visual comparison runs only in its reference environment. A missing command, binary, observer, required assertion or baseline is a failure, not a skip/pass. Provision first, then block runtime networking. Separate real trusted/restricted profiles must verify actual host trust state.

Each invocation retains its own directory under `.vscode-test/desktop-artifacts/run-*/`,
including the Playwright JSON report and per-capability bootstrap results. The
root `runner-status.json` points to the most recent invocation; it is diagnostic
output, not candidate acceptance evidence. Reference creation is disabled during
validation. Missing security observation, native-drag probe or visual references
must be resolved before the mandatory bootstrap can pass.

## End-to-end validation scenarios and expected results

The runner drives all scenarios automatically; no manual walkthrough substitutes for assertions. Fixtures must be manifest-listed with independent expected XML/hierarchy/geometry, extending the inherited ≥12-report corpus with grouped/nested/preserved/data/unsupported/malicious/budget cases.

| Run / acceptance IDs | Automated actions | Required outcome |
| --- | --- | --- |
| Bootstrap / slice A | Launch actual Desktop/installed extension, operate existing 004 controls by real input, capture workbench/webview/accessibility, insert and Undo | Exactly expected source then exact prior source; recorded executable/driver/VSIX identity, real capture/positive-control capabilities; no stub designer |
| Native shell / AT-01 | Fresh profile → Activity Bar before report → New/Open report → hide/move/restore/restart views → Explorer | One container/three views, packaged supplied icon, truthful report/empty states, host placement respected, Explorer works and view-only source equality |
| Inventory/source / AT-02/04 | Expand actual sections/items/table hierarchy/groups and every data category; open exact source; load source-only/opaque/depth/entry/transport boundaries | Correct source order/ancestry/ranges and supported/preserved capabilities; explicit truncation/opaque states, no fake sections/runtime rows, no leaked payload/secrets or source changes |
| Selection/drafts / AT-03/07 | Alternate native/canvas, hidden/overlapping/cell/group/data/body multi-selection; Apply/Discard/Cancel draft; keyboard menus/focus return | Accepted membership/primary and inspector agree only in associated view; no loops/focus bounce; correct clamped center at unchanged zoom; cancel preserves draft, Apply never replays stale navigation |
| Creation/data / AT-04/05 | Pointer and keyboard activate Textbox/Table/Dataset; filter/clear all eleven kinds; rename/bind table, author all seven field types and blocked references | One automatic named insertion/no old form; unbound table/default size/placement; one Undo/Redo; dataset has no fake geometry; unsupported kinds/direct requests refuse without edits |
| Context/history / AT-06 | A/B same names, two A designers and A source; 100 switches, 50 delayed/duplicate/closed-target actions; Save As/untitled/reload/conflict/failure; 20 mixed edits with Undo/Redo | Zero wrong-report/view actions or lost accepted edits; per-view selection/preferences; exact source after each history step, zero history for view-only/refused/no-op |
| Drag/fallback / AT-05/08 | Record public-API native drag probe, test activation and explicit compact fallback; exercise actual existing HTML drag | Native dragging advertised only with complete coordinate/cancellation/staleness proof; otherwise unavailable-with-evidence and activation/fallback pass, ≤0.01pt placement |
| Keyboard/visual/layout / AT-07/08 | Every journey via keyboard, four host themes and 100%/200% scale; compare PNGs/semantics/contrast; sample 100 interactions/native resizes | Visible reachable focus/no traps, ≥4.5:1 text and ≥3:1 essential boundaries; required PNG diffs pass; ≤1px unintended drift; unavoidable resize cancels before rebase with zero gesture edits |
| Offline/trust/package / AT-09 | Installed journeys in monitored blocked-network trusted/restricted profiles; malicious expressions/entities/resources/image/source fixtures | Zero report-triggered execution/query/entity/resource/network attempts; positive control proves observation; preserved text/resources and exact VSIX contents; driver excluded |

Timing requires 100 real input-to-visible selection samples, ≥95 within 200ms, with raw sampling resolution and rendered proof. Every scenario maps to the full FR/scenario/edge/SC matrix in [automated-validation.md](automated-validation.md); this abbreviated run table does not remove any assertion or inherited regression obligation.

## Completion and artifacts

Root/CI checks must produce same-candidate assertion/evidence records, actual/expected/diff PNGs, traces/accessibility/focus records, timing/frame samples, current-range/race/history checks and sanitized network-attempt logs. Reference images are committed and never auto-accepted in CI. Missing/failed required evidence blocks validation.

Current CI schedules the installed bootstrap on the existing minimum/stable OS
matrix and uploads probe artifacts. These working-tree changes have not run in
GitHub Actions. The final CI contract additionally requires every implemented
functional/installed journey and a fixed visual job in the required aggregate;
that integration remains incomplete. Release checks must also certify the
canonical rebuilt VSIX digest before publication. See the Desktop contract for
record fields and tolerances.
