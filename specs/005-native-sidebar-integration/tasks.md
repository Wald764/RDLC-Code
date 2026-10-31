# Tasks: Native VS Code Sidebar Integration

**Input**: Design documents in `specs/005-native-sidebar-integration/`: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) and [quickstart.md](quickstart.md).

**Tests**: Required explicitly by FR-032–034 and constitution VII. Write each phase's assertions before its production changes and confirm the relevant failure; use actual Desktop input where specified. Existing direct-session/browser-stub tests do not replace Desktop proof. All tasks start uncompleted; this file records work, not executed evidence.

**Organization**: Setup → shared foundation → six P1 story phases in specification order → cross-cutting completion. New file paths below are deliberate implementation destinations; retain existing package boundaries and test owners. No new runtime dependency, XML authoring semantics or serializer is authorized. `vendor/` remains read-only.

## Format and execution conventions

- Tasks use `- [ ] Tnnn [P?] [USn?] Description with exact file paths`.
- `[P]` identifies independent file work within the explicitly stated ready batch, not permission to bypass earlier prerequisites. Same-file edits and compile-consuming test runs are serialized.
- Shared constraints quoted from the data model/contracts are mandatory. Keep strict validators, builders, host/Angular consumers and fixture expectations synchronized.
- Reuse existing typed intents, draft guards, creation, validation, candidate verification, bounded atomic edits and native history. New native commands carry captured authority, never arbitrary patches/command strings.
- Required failed/unrun/blocked evidence keeps its case unvalidated. Native drag alone may be unavailable-with-evidence, with passing activation/fallback assertions. No human confirmation substitutes for automation.

## Phase 1: Setup (Shared Infrastructure)

**Execution-order adjustment approved by the user — 2026-10-25**: continue the
US1–US6 source implementation and available tests while T010–T012 remain open.
Respect shared source dependencies and story order; record implementation and
acceptance separately. External evidence blockers also leave story acceptance
tasks open, but do not block the next implemented slice. No mandatory validation
or release gate is weakened. See the corresponding amendment in `plan.md`.

**Purpose**: Establish traceability and a real Desktop runner without changing product behavior.

- [X] T001 Create `tests/desktop/coverage.json` mapping every US acceptance scenario, FR-001–034, all eleven spec edge cases, SC-001–010 and inherited regression rows to AT-01–09, fixture IDs, independent oracles and planned test IDs; define evidence records in `tests/desktop/evidence.ts` with provenance commit, versioned candidate input manifest/fingerprint/scoped patch digest, separate VSIX SHA-256, fixture hashes, environment/display/theme identity, outcomes and artifact links/digests under `contracts/desktop-validation.md`, enforcing “absent/unrun/failed mandatory assertions remain unvalidated.”
- [X] T002 Add exact root devDependency `playwright@1.64.1` in `package.json`, resolve `pnpm-lock.yaml` with pnpm 11.28.2/Node 24.22.0, and record Apache-2.0 test-only necessity in `specs/005-native-sidebar-integration/research.md`; use `playwright/test` assertions, retain existing provisioning, and keep the driver out of extension dependencies and production bundles.
- [X] T003 Implement `tests/desktop/driver.ts` and `tests/desktop/playwright.config.ts` to launch the actual `@vscode/test-electron`-provisioned binary in disposable development/installed-VSIX profiles, operate native workbench and real Angular webview by keyboard/pointer, observe accepted host XML independently, capture accessibility/focus/screenshots/traces, and clean up with bounded timeouts; record executable build/hash and never alter binary fuses or replace the designer with a stub.
- [X] T004 Add `tests/desktop/run-tests.ts` and root `package.json` commands `test:e2e` / `test:visual` implementing `--probe`, `--packaged`, `VSCODE_VERSION` and nonzero missing-evidence failures per `contracts/desktop-validation.md`; integrate with `scripts/compile.ts` / `scripts/build.ts` only as needed and preserve full build/package prerequisites and serial output-tree ownership.

**Checkpoint**: Commands launch the actual candidate; launch failure is recorded and investigated, never treated as a skipped success.

**Execution status — 2026-10-24**: T001–T004 implement the initial tooling, not
passing feature acceptance. The latest full unit run passes 166 Node assertions
and 204 Angular assertions; these include foundation regressions, not Desktop acceptance.
Real Windows minimum development/installed and stable installed probes reach native input,
Angular insertion, independent exact saved XML, native Undo, accessibility
capture and verified cleanup. The complete probe remains failed: required PNG
references are absent and mandatory security proof is incomplete. The native-drag
probe executes and records unavailable delivery on Windows; it does not validate
activation or compact-fallback acceptance. T005–T075 remain open;
no User Story or cross-platform bootstrap is validated. See `research.md` and
`evidence/driver-probe.json` for executed observations and limitations. The CDP
fallback is implemented but has not been exercised on a target requiring it.
Minimum 1.142.0 and stable 1.143.1 development extension-host suites pass; the
stable installed-VSIX host suite also passes. The latest minimum Desktop probe
fails bootstrap pixels and security and passes only conditional drag feasibility.
Independent targeted rereview was retried and failed on the configured model's
usage limit. Current diagnostic records remain historical, not same-candidate
acceptance evidence. Protocol migration, complete host dispatch wiring, lifecycle
coverage and all six story phases remain unfinished.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared accepted-state routing, closed contracts and proven automation primitives. Complete this phase before story implementation; story-specific inventories/actions remain in their phases.

- [X] T005 Add shared contract regression tests in `apps/vscode-extension/src/protocol.test.ts` and `apps/designer/src/app/editor/host-adapter.spec.ts` for closed native-action/accepted-selection/outcome families, wrong-session routing, malformed/extra fields, mixed modes, duplicate IDs, old sequences, correlated versions, both result/snapshot orders and rejected delivery; retain snapshot ≤8 MiB/131,072 JSON values, other messages ≤64 KiB/8,192 values, JSON depth ≤20 and 1,024 requests per session.
- [X] T006 Extend `packages/report-model/src/protocol.ts` and add `packages/report-model/src/navigation.ts` with accepted navigation/action/selection types, strict validators and matched protocol version updates; enforce “version-local XML target ID, optional parent ID, source ordinal/range, expanded XML name, declared name when present, kind, display label, opaque/incomplete reason, and command-specific capabilities/reasons,” flat parent-before-child nodes, optional bounds, and closed finite actions from `contracts/sidebar-bridge.md`; preserve existing exports/builders and make T005 pass as consumers are updated.
- [X] T007 Extract reusable accepted report evaluation into `apps/vscode-extension/src/report-evaluation.ts` from `apps/vscode-extension/src/document-session.ts`, preserving parser/profile/capability/source-ID facts, shared document queue and transport fallback; expose accepted change notifications for native consumers and source-only evaluation without opening a hidden designer or creating independent mutable report content; cover extraction equivalence in `apps/vscode-extension/src/report-evaluation.test.ts`.
- [X] T008 Implement `apps/vscode-extension/src/sidebar/context.ts` and its tests in `apps/vscode-extension/src/sidebar-context.test.ts`, wiring `editor-provider.ts` / `extension.ts` panel/tab/text/document events to document lifetime IDs, opaque view IDs, URI/version and context generation; enforce “no-report → loading → editable/source-only/invalid-source,” “Sidebar focus changes no context,” same-document optional associated view and immutable action capture; non-report activation clears context, and disposal terminates pending captures.
- [X] T009 Add bound host dispatch/outcome coordination in `apps/vscode-extension/src/document-session.ts` / `protocol.ts` and Angular ingestion in `apps/designer/src/app/editor/host-adapter.ts`, matching T005/T006; recheck original document/URI/version/view/generation/capability after awaits and failed `postMessage`, keep draft waiting outside the mutation queue, and carry native correlation through existing edit requests without auto-retry or a new mutation engine.
- [ ] T010 [P] Implement `tests/desktop/security-observer.ts` and `tests/desktop/security-observer.spec.ts` with separate trusted/restricted profiles, asserted host trust state, blocked outbound traffic plus host-process-tree/webview attempted-access observation and positive controls outside report journeys; observe local execution/resource/query/entity accesses too, sanitize logs, and fail unsupported mandatory platform capture rather than treating browser routing or static scans as sufficient.
- [ ] T011 Implement and execute `tests/desktop/bootstrap.spec.ts` against the existing 004 designer: real native-row input, Angular control insertion, independent exact XML and native Undo oracle, actual screenshot comparison, accessibility/announcement capture and observer positive controls; generate reproducible bootstrap references/metadata in `tests/desktop/baselines/bootstrap/` against explicit geometry/contrast oracles, fail missing comparisons, adapt a failing driver with recorded operation/version/error rather than changing product binaries, and record local passed/failed/blocked outcomes in `specs/005-native-sidebar-integration/evidence/driver-probe.json`.
- [ ] T012 Add bootstrap runs/artifacts to `.github/workflows/ci.yml` on Ubuntu 24.04 / Windows 2022 / macOS 14 × minimum 1.142.0 / stable, using Xvfb on Linux and frozen installs; execute the T011 probe on each available target, retain failures/unavailable CI execution explicitly in `specs/005-native-sidebar-integration/evidence/driver-probe.json`, and require all target capability evidence before claiming cross-platform automation validation.

**Checkpoint**: Shared types/routing are bounded and tested; real input, webview/capture/accessibility and security observation work in the reference environment. Missing mandatory automation remains blocking; conditional native drag is probed separately in US4.

**Execution status — 2026-10-24 (resume run)**: T005–T009 are complete at unit/host level:
the protocol budget edges, the 1,024-request cap, closed families/duplicates,
rejected delivery and delivery outside the mutation queue are covered. Independent
review FAIL findings were fixed red→green:
- generation no longer advances on the action's own content edit;
- every designer refusal settles once;
- stale selections/outcomes are ignored without blocking, while refusals always settle;
- native authorization is single-use.

The full local regression passes: Node 200, Vitest 223, compatibility 15,
roundtrip 61, acceptance 2, release 8, and the development and installed-VSIX host
suites 8/8 each.

T010–T012 remain open:
- Pixel comparison is scoped to the pinned Ubuntu 1.142.0 reference and recorded
  `unrun` elsewhere. No reference PNG exists yet; it must be generated with
  `--update-baselines` on that environment.
- The security observer is Linux-only (strace + iptables cgroup-scoped blocking,
  allowlist/denylist, canary, both profiles) and is unexecuted. Windows/macOS fail
  closed, with no host observer implemented, which keeps those CI entries red by
  design.
- Windows 1.142.0 development and installed probes pass launch, native input,
  Angular insertion, source, Undo, accessibility and cleanup. Native drag is
  unavailable-with-evidence.
- Workspace Trust uses an isolated `--shared-data-dir`. Previously, test profiles
  inherited the developer's real trusted folders. Trust state is now read through
  `workspace.isTrusted`. Restricted and trusted profiles resolve correctly on
  Windows, and functional specs grant trust through the real Workspace Trust
  editor.
- Open, outside the foundation: `structure.spec.ts` measured 212–299 ms against the
  200 ms selection bound (T023/T032).

**Execution status — 2026-10-24 (installed foundation recheck)**:
`pnpm build`, `pnpm package`, `pnpm typecheck` and `pnpm lint` pass.
The 64 targeted Desktop infrastructure unit tests and 11 package assertions pass.
`VSCODE_VERSION=1.142.0 pnpm test:e2e -- --probe --packaged` exits 1:
bootstrap functional input/XML/Undo/accessibility/cleanup pass, native drag records
unavailable delivery, and security fails on missing Windows host-tree capture and
host outbound blocking. Both actual host trust states and both profiles' webview
positive controls pass. Pixel comparison remains unrun outside the pinned Linux
reference environment; this is not visual acceptance. The tested VSIX SHA-256 is
`ac31a68c81adb828723c43ee9eaeaf6aec384256140575bb7ca5caf1a64ded36`.
See `evidence/driver-probe.json` `latestContinuation` for artifact hashes.
Both requested subagents failed before work with `Go usage limit exceeded`.
T010–T012 remain open; the blocking foundation checkpoint prevents advancing to
US1–US6 under this execution plan. No task/checklist completion was inferred from
historical or partial evidence, and no cross-platform CI run was executed.

**Bootstrap geometry continuation — 2026-10-24**: T011 now measures the inserted
Textbox's actual DOM bounds against an independent 96 × 24 CSS px / 20 pt origin
oracle at the fresh 100% zoom, and the runner requires its `geometry` capability.
Runner regressions failed twice before this gate and now pass 9/9. The installed
minimum Desktop bootstrap passes with actual dimensions 96 × 24 and body-relative
origin (26.65625, 26.65625) CSS px against (26.66667, 26.66667), tolerance 0.1 px.
The first attempt was interrupted by the external 180-second timeout; the retry
with a timeout longer than Playwright's own bound passes, including exact source,
Undo and cleanup. ESLint for the three changed test/runner files and the repository
format check pass; formatting-only fixes preserve the existing `CLAUDEM.md` text.
This is additional local bootstrap proof, not completion of T010–T012 or visual
acceptance. See `evidence/driver-probe.json` `bootstrapGeometryContinuation`.
After targeted independent review, the bootstrap explicitly checks 100% page
scale and runner tests import the required capability list instead of mirroring
it. Compilation, the 9 runner tests, scoped lint/format and the reviewed installed
Desktop bootstrap pass again (29.6 seconds). Reference pixels remain unrun.
The security subagent reports actual Windows ETW kernel-session and firewall-rule
attempts were denied for missing elevation, with no collector/rule left behind.
An ETL event consumer and verified Windows blocking backend are also absent, so
elevation alone cannot close T010. The Ubuntu investigation found no provisioned
local reference environment or PNG baselines; remote matrix execution is still
unrun. These diagnostics do not replace executable security/visual proof.
The Windows diagnostic change is limited to two requirement strings and explicit
unsupported branches; it adds no observer API, live privileged probe or capture
claim. The integrated infrastructure suite passes 65/65. Root lint passes;
typecheck and formatting pass when repeated serially after allocation failures.
A full installed probe also encountered VS Code CLI installation crashes before
journey execution during that failed run; those failures remain historical
failures, not replacements for the earlier functional bootstrap observations.

**Bounded workbench discovery correction — 2026-10-24**: the timed-out installed
run `run-b941cef8-e6e6-43fa-9b95-6178e3f62c50` left a trace with a pending
`.monaco-workbench` locator count in `driver.ts` `workbenchLocation`. Playwright's
`count()` did not inherit the configured default timeout. The shared Electron/CDP
discovery now wraps that call with the existing `withTimeout`, capped by one
second and the remaining discovery deadline. Two primitive transport regressions
were red before the fix and green afterward; all 67 infrastructure assertions pass
in the parent run, and targeted independent review reports PASS. Scoped lint and
formatting pass. No matching owned test Desktop processes remained after checking
the interrupted run's exact profile identities.

The post-fix installed probe completes in 1.7 minutes with exit 1, not a pass:
bootstrap fails waiting for the Workspace Trust editor's confirmation text;
native drag records unavailable delivery; security verifies both host trust
states and webview positive controls but fails the required Windows host capture
and blocking checks. This final candidate is not certified by earlier successful
bootstrap runs. T010–T012 and the foundation checkpoint remain open. Current
outcomes and artifact hashes are recorded in `evidence/driver-probe.json`
`latestExecution`; all later story phases remain blocked by this checkpoint.

**Targeted trust observation — 2026-10-24**: the security/driver subagent inspected
the actual Electron trace and observed the correct enabled Trust button being
clicked, with no subsequent confirmation dialog or reload. The failed run did
not record the public trust oracle after the timeout, so its cause remains
undetermined. A single isolated observation on the same installed VSIX/build and
a fresh profile succeeds: host `workspace.isTrusted` changes from false to true
after one real UI grant, with clean shutdown. No speculative retry, trust bypass
or product/driver change was introduced. This result does not invalidate the
earlier failure or close T010–T012; see `trustObservationContinuation` in the
diagnostic record for its retained artifact and digest.

## Phase 3: User Story 1 — Open the Native Report Workspace (Priority: P1, MVP)

**Goal**: Native entry, three report-aware views, useful empty states and a central designer with explicit compact fallback.

**Independent test**: Fresh installed profile, one Activity Bar activation before any report, New/Open, native hide/move/restore/restart and return to Explorer; assert correct labels/icon, no duplicate expanded Angular navigation and exact text equality. Covers US1.1–4, AT-01 and relevant AT-07/08, SC-001.

### Tests first

- [X] T013 [P] [US1] Add contribution/asset contract assertions in `tests/package/sidebar.test.ts` for container `rdlcCode`, views `rdlcCode.structure` / `rdlcCode.data` / `rdlcCode.components`, supplied `media/rdlc-activity.svg` bytes, retained public command IDs, welcome/actions and no Explorer replacement or shipped driver; verify packaged inventory through existing VSIX verification.
- [X] T014 [P] [US1] Write `tests/desktop/workspace.spec.ts` for fresh-profile activation before designer, actual three views/report labels, loading/no-report/invalid/source-only states, New/Open report, hide/move/restore/restart and working Explorer; assert source equality, host-owned placement and compact fallback reachability without forced reopening, and capture theme/focus evidence through existing driver primitives.

### Implementation

- [X] T015 [US1] Contribute the activity container, three named native views, welcome content and `rdlcCode.sidebar.*` command/menu registrations in `apps/vscode-extension/package.json` / `src/extension.ts`, using existing `rdlcCode.newReport`, `rdlcCode.openDesigner`, `rdlcCode.openSource` and a local Open Report picker; verify activation is independent of resolving a custom editor and dispose all registrations.
- [X] T016 [US1] Implement the three provider shells in `apps/vscode-extension/src/sidebar/views.ts` against T008 accepted context, exposing `getChildren` / `getTreeItem` / `getParent`, report descriptions, truthful empty/loading/error/source-only recovery and bounded refresh; keep not-yet-populated inventories explicit, leave placement/ordering/visibility entirely host-owned and never move/reset/focus views on refresh.
- [X] T017 [US1] Update `apps/designer/src/app/editor/viewport.ts`, `editor.component.ts` and `editor.component.html` to default absent navigation preferences to compact/closed, expose a labeled explicit fallback retaining existing structure/data/catalog and HTML drag, preserve explicit user preferences and inspector/toolbar/status, and defer elective fallback toggling during gestures; cover migration/toggle behavior in `editor.component.spec.ts`.
- [X] T018 [US1] Update exact asset inventory/assertions in `scripts/verify-vsix.ts` and `tests/package/sidebar.test.ts` to retain the supplied activity SVG and all local designer resources while excluding Desktop tooling; build/package and verify the installed artifact activates the same native shell.
- [ ] T019 [US1] Run US1 package/component/Desktop assertions via root commands, generate scoped reproducible references in `tests/desktop/baselines/workspace/` against explicit layout/contrast oracles and compare actual native shell states, recording AT-01 plus US1 keyboard/visual state evidence in `specs/005-native-sidebar-integration/evidence/us1.json`; require native movement/restoration and zero view-only edits before marking this MVP slice complete.

## Phase 4: User Story 2 — Navigate the Actual Report Structure (Priority: P1)

**Continuation — 2026-10-25**: T013 package/contribution assertions pass on the
rebuilt VSIX (8 package tests including exact contents). T017 has 227 passing
Angular tests in the delegated run; mutation checks demonstrate that the new
compact-default and gesture-deferral assertions detect regressions. The parent
also passes 51 protocol/context/evaluation tests and 76 existing
roundtrip/compatibility tests against that compiled build. The installed US1
Desktop suite finishes with seven passes, four failures and a worker teardown
timeout; T019 remains open. `evidence/us1.json` retains its report digest and
individual failures without treating cleanup errors as successful assertions.
These are diagnostic
outcomes, not same-candidate feature acceptance: subsequent source/assertion and
fixture work requires fresh compilation and applicable validation. The rebuilt
VSIX SHA-256 is `74477418d01cf24b42a9b57ec5552202165e46b4678f7a4ec3338f0e0a8ded0f`.

**US1 rerun — 2026-10-25**: The fresh installed Windows 1.142.0 run passes all
11 workspace tests in 6.6 minutes, including the four previously failing cases,
with command exit 0 and no worker teardown timeout. The original failed report
remains retained; `evidence/us1.json` adds the new report and digest separately.
The tested VSIX is `ba424ee98e015d97ce503595c79f8ac7103eacd122d016d4d7e713026ea99c0a`.
The complete installed Extension Host run is also confirmed with explicit native
exit propagation (12 suites, runner and shell exit 0; see `evidence/us5.json`).
T019 and foundation acceptance remain open for the applicable same-candidate,
cross-platform, security and visual requirements.

For T024, a source-isolated regression reproduces missing actual table members
and groups in the legacy fallback projection. Its shared projector now retains
table bodies, members, groups and member headers while preserving legacy data
consumers. Review also identified unreachable legacy `TableGroup`/`Grouping`:
both projections now expose its real named definition in known source-only
namespaces without granting authoring. Nine source-isolated hierarchy/Structure/
navigation tests pass, including existing native dataset exclusion, and root
`pnpm typecheck` passes. The follow-up review withdraws the dataset-exclusion
finding and confirms source-only guard safety. Details and red-before outcomes
are retained in `evidence/us2.json`; it explicitly remains ineligible for
acceptance. Root compiled/host checks of this later change are pending. T020/T021 fixture/budget
work and T031 guarded native actions are delegated with separate file ownership.

**Goal**: Truthful hierarchy, two-way accepted selection, known-bounds centering, guarded context actions and exact current XML access.

**Independent test**: Grouped table/real header/footer/nested preserved/overlapping-offscreen fixture; navigate by pointer/keyboard and canvas, mixed body selection, cells/groups/source, refresh and ambiguity. Assert exact ancestry/ranges, membership/primary, unchanged zoom/text and no focus bounce. Covers US2.1–6, AT-02/03/07, SC-002/003.

### Fixtures and tests first

- [X] T020 [US2] Add `tests/fixtures/sidebar/structure.rdlc`, `structure-boundaries.json` and independent expected hierarchy/source slices in `tests/fixtures/sidebar/structure.expected.json`, registering them in `tests/fixtures/manifest.json`; cover actual table body/rows/cells/row-column members/groups/member headers, nested preserved/foreign content, absent sections, duplicate/unnamed targets, known source-only namespaces, 2,000/2,001 entries, emitted depth 32 overflow and parser/transport boundaries.
- [X] T021 [P] [US2] Extend `packages/renderer/src/structure.test.ts` and add `apps/vscode-extension/src/navigation-budget.test.ts` asserting T020 real ancestry/order/expanded names/ranges, no runtime/fake nodes, opaque limitations and no edits; test “shared 2,000-entry cap, 32 emitted levels per projection, fair initial split with unused-capacity transfer and whole-envelope trimming,” including parent-closed prefixes and both projections' visible truncation.
- [X] T022 [P] [US2] Extend `apps/designer/src/app/editor/selection.spec.ts`, `viewport.spec.ts` and `editor.component.spec.ts` with exclusive modes/primary membership, XML-cell versus rendered-child identity, Apply/Discard/Cancel, no stale replay, both result orders, no echo, unknown/zero/oversized bounds and clamped-center geometry; ensure selection outside displayed navigation remains valid.
- [X] T023 [P] [US2] Write `tests/desktop/structure.spec.ts` for actual native/canvas/inspector agreement, body multi-selection cues, preserved/group/cell menus, exact current source and stale refusal, source/Undo/reload refresh and unambiguous expansion; collect 100 real input-to-visible selection samples with ≥95 within 200ms, ≤1 CSS px center error at unchanged zoom and zero document/focus-loop effects.

### Implementation

- [X] T024 [US2] Extend `packages/renderer/src/structure.ts` and `src/index.ts` to emit actual table body/hierarchy/member/group/member-header relationships and source order with expanded XML names, truthful capability/opaque states and tested source-only namespace inspection; keep unknown syntax opaque, do not loosen `packages/xml-parser/src/names.ts` authoring helpers, and preserve legacy data-selection consumers until US3 migration while excluding datasets from the native Structure view.
- [X] T025 [US2] Implement shared Structure/Data envelope allocation in `apps/vscode-extension/src/document-session.ts` / `report-evaluation.ts`: start with up to 1,000 authored nodes each, transfer unused capacity within total 2,000, then halve both nonempty parent-closed prefixes until the whole snapshot validates; retain inherited scene/authoring transport fallback, explicit per-projection incomplete states, 16 MiB XML byte/code-unit checks, 100,000 elements/256 parser levels and existing message budgets without silent increases.
- [X] T026 [US2] Update `apps/designer/src/app/editor/selection.ts` and shared validation in `packages/report-model/src/protocol.ts` to enforce “Exclusive modes: empty; ordered unique body-ID set with primary member; one cell; one structural/data target,” “XML cell identity and rendered child textbox identity remain distinct,” optional accepted bounds and version/view-bound monotonic selection sequences; accept omitted canvas targets without fabricating navigation rows.
- [X] T027 [US2] Route native selection/properties/context requests through existing `selectTree`, `held`, draft and pending handlers in `apps/designer/src/app/editor/editor.component.ts` / `host-adapter.ts`; publish accepted selection/outcomes, restore it on cancel/refusal, terminate original action on Apply, revalidate Discard and async waits, and dedupe delivery without adding edits or queue deadlocks.
- [X] T028 [US2] Populate Structure and safe expansion/selection reconciliation in `apps/vscode-extension/src/sidebar/views.ts`, using accepted mappings or unique expanded-type/name/ancestry; expose Selected/Primary/count and pending/refused accessible cues despite readonly native selection, reveal ancestors with `focus: false`, preserve unrelated expansion, and enforce “Do not persist pending actions, drafts or version-local IDs.”
- [X] T029 [US2] Add clamped known-bounds centering at unchanged zoom in `apps/designer/src/app/editor/viewport.ts` and call it from native navigation in `editor.component.ts`, applying body/page offsets once and reachable scroll limits; unknown/data/structural/zero bounds do not scroll or create rectangles, and oversized targets use reachable-center behavior.
- [X] T030 [US2] Fix current-range source navigation at shared `apps/vscode-extension/src/document-session.ts` `openSource` and affected `src/commands/open-source.ts` callers; resolve host syntax by captured target ID, recheck original document/version/view after opening source, refuse stale/disposed targets and add the async-race regression in `tests/vscode/synchronization.test.ts` without accepting client-provided ranges.
- [X] T031 [US2] Implement finite structure context actions in `apps/vscode-extension/src/sidebar/actions.ts` and `apps/vscode-extension/package.json`, reusing existing properties/source/clipboard/duplicate/delete/table/group handlers through T027; guard capabilities at execution, retain source-aware deletion acknowledgements/reference safeguards, and make preserved targets inspect/source-only with accessible reasons.
- [ ] T032 [US2] Run projection/protocol/Angular/host/Desktop US2 checks and save source equality, current-range, timing arrays and membership/focus assertions in `specs/005-native-sidebar-integration/evidence/us2.json`; require T023 thresholds and every US2 acceptance scenario before closing the story.

## Phase 5: User Story 3 — Inspect and Author Report Data (Priority: P1)

**Installed diagnostic continuation — 2026-10-25**: Individual Windows scenarios
US2.1–US2.6 have passed across retained diagnostic packages, including the final
cell identity and context-menu/source-range checks. This is not same-candidate
story acceptance: SC-003 still records 0/100 within 200ms (212–263ms), and a later
US5.1 rerun refuses a stale row at switch 9. An earlier US5.1 run completes all
hundred switches plus exact history checks but fails exporting its incomplete
430MB trace. Preserve both results. Trace export now has its own bounded
120-second deadline; startup stays at 15 seconds. Two launch attempts fail before
startup during observed system commit exhaustion; execution resumes after memory
is restored. See `evidence/us2.json` and `evidence/us5.json` for reports/digests.

Data inventory, inspect-only, guarded deletion/reference refusal, selection and
scoped-action scenarios have passed individually. Components Textbox, default
Table, Dataset creation and unavailable/refusal scenarios also pass individually;
remaining creation/fallback/history journeys are still required. Native Duplicate
now supplies the protocol's existing `pt` default and passes the real-validator
regression. A new native Properties focus regression fails on the Hide panel
button before the fix and passes afterward (240 delegated Angular tests). Fresh
typecheck/build/package and scoped parent lint pass; real keyboard confirmation
is in progress on VSIX
`3619d426ec38a12b98926d01f5d4de182cb9a571881271247f22b19738b27496`.
The expanded host lifecycle suite still fails on its opening-path test, although
its prior Windows cleanup error is resolved. No acceptance checkbox is closed by
these partial results.

**Latest verification — 2026-10-25**: The source-only/session-init host journeys
now use declared test-owned editor contributions and the exported opening
implementation on the harness API instance. All twelve development host suites
pass, including the fifty-three injected race cases; all twelve installed host
suites also pass with native and shell exit 0. The new overlay focus fallback
passes the delegated 241-test Angular run. Fresh build/package, 368 compiled
checks and the complete installed US6.1 keyboard journey pass on VSIX
`a32f2aa5bc29cc9728dc303ecfede75ca09dcf6bce21320d6c764a4f33120394`.
FR-017, FR-018, SC-004 insertion history and REG-04 creation pass individually;
US4.6's successive activation and US3.2's accepted field selection still fail.
The expanded SC-005 fifty-opening run is in progress. These host-injected races
and individual Desktop successes do not close T053, cross-platform acceptance,
the intermittent stale-row refusal or the failed 200ms timing gate.

**Native row publication verification — 2026-10-25**: Fresh build/package and
all twelve development host suites pass on candidate
`d533f2fa0bb8d0bde715bf2ac0463a9a378f948ba710b9f1844b58fec90d05e2`.
Installed US4.6 passes with direct successive pointer activation after Undo,
without a focus detour. Installed US3.2 also passes its complete seven-field-type
CRUD, exact source/history and save/reopen journey with byte-derived inventory
readiness. FR-027 still fails: after an invalid-name refusal, Name is not focused
for fifteen seconds. The earlier first-letter loss is no longer hidden by a DOM
focus command. Its expected focus behavior is under investigation. A separate
US5.1 hundred-switch run is in progress against this candidate; no reliable
switching or same-candidate acceptance is claimed yet.

**Same-candidate Data/Components run — 2026-10-25**: All eighteen installed
journeys (twelve Components and six Data) pass together in 7.7 minutes with exit
0 on `d533f2fa0bb8d0bde715bf2ac0463a9a378f948ba710b9f1844b58fec90d05e2`.
The separate context test finds a stale Components pane title because unchanged
toolbox rows no longer trigger a child fetch. A title-publication follow-up and
automatic focus recovery after pending field edits are delivered; the fresh
host run finds an initial-description publication assertion still failing.
All three first layout journeys fail before final measurement: two click an
intentionally obscured fixture item, and scaling stops on a hidden status text.
Their corrections and genuine installed verification remain pending.

**Focus and switching verification — 2026-10-25**: Candidate
`69e8fd3b52e09e32dff12e9fa3d4ebd6573dd2013d08ce5bb22a9f5b6386d2df`
passes all twelve development host suites. Installed US5.1 completes all hundred
switches and exports a valid trace (5,018 ZIP entries, all CRC checks pass).
Installed FR-027 also passes in a separate exit-0 run after its test follows the
compact overlay's real dismissal/reopen behavior and tracks focused controls
inside the webview. Automatic post-refusal focus restoration and complete draft
typing are verified. Historical failures remain retained; the fifty in-flight
Desktop races, failed latency threshold, reference visuals and cross-platform
gates stay open.

**Broader installed verification — 2026-10-25**: On the same `69e8fd3b…6386d2df`
candidate, the Data/Components/accessibility aggregate passes 23/24; the final
theme assertion passes in a separate exit-0 rerun after exact keyboard result
selection and High Contrast outline checks. Thus all twenty-four assertions have
individual same-candidate passes, not one passing aggregate. The next fifteen
context scenarios pass four and fail eleven; retained reports distinguish wrong
test preconditions from unresolved context/selection and opening-race evidence.
All five corrected layout scenarios are now executing separately. No acceptance
checkbox is closed by these additional partial results.

**Scaling verification — 2026-10-25**: Installed FR-028 and US6.2 pass their real
100/200-percent interface-scale assertions on `69e8fd3b…6386d2df`. The status
region remains in the accessibility snapshot and its actual box is recorded.
The three stability cases still fail on command/menu targeting or an unproven
live gesture before resize; no frame-drift or cancellation success is claimed.
The layout owner is investigating these cases while the current workspace and
Structure suites run against the same package.

**Workspace/Structure and review follow-up — 2026-10-25**: All eleven installed
Workspace scenarios and seven of twelve Structure scenarios pass on
`69e8fd3b…6386d2df`. SC-003 now records 50/100 samples within 200ms (min 21,
median 144, p95 237, max 254ms), still below the unchanged 95/100 requirement.
Reveal, capability, refusal-selector and unknown-bound edge failures remain under
investigation. All twelve installed host suites pass on that candidate. The
independent review finds a connected-but-hidden pending-focus recovery gap;
its viewport fallback passes the delegated 243-test Angular run. A fresh build
and package `983ddfbf7c6996f59bb34eb3754342cbb571cf5c2f08c6be4164f5c6703aa9a5`
pass, and its complete installed accessibility suite is in progress.

**Reviewed focus candidate — 2026-10-25**: The complete six-scenario installed
accessibility suite passes together with exit 0 in 2.6 minutes on
`983ddfbf…703aa9a5`; all twelve installed host suites also pass with native and
command exit 0. This includes the corrected theme selection and functional
focus checks. Data/Components are running on that candidate to check the focus
change against their authoring flows. The hidden-control pending-resize case
itself is an Angular regression; no separate Desktop injection is claimed.

**T031 corrective follow-up — native Duplicate envelope**: The shared native
clipboard helper omits the mandatory unit for Duplicate. The host therefore
rejects its envelope before mutation. Add the existing point-unit default in
that helper and validate its captured envelope with the real protocol validator;
retain the current body-membership and capability refusals. The correction is
implemented: its real-validator regression fails before the fix, then all ten
native action source tests pass with the existing `pt` default. Fresh compiled
and installed checks remain required; this does not grant whole-story acceptance.

**Integrated execution — 2026-10-25**: A fresh serialized build passes, followed
by 247 compiled Node unit tests, 166 compiled roundtrip/compatibility/release/
Desktop-infrastructure tests and 15 package assertions. The complete real
development Extension Host run passes all 12 suites, including Data command
registration, the 20-operation native Undo/Redo history, loading and transport
budget regressions. Installed host output also reports all 12 suites and Electron
exit 0, but the PowerShell wrapper reports 1 after native stderr redirection;
both outcomes are retained in `evidence/us5.json`. The candidate VSIX digest is
`ba424ee98e015d97ce503595c79f8ac7103eacd122d016d4d7e713026ea99c0a`.
T036/T037 implementation is complete. Source-only fallback and optional-navigation
selection review corrections are still being integrated, and all story acceptance
tasks remain open. T054 also remains open: invalid `filter`/`expand` protocol
messages prove refusal, not actual native view-only history behavior.

**Goal**: Complete bounded inert data inventory and native access to existing guarded dataset/field forms and commands.

**Independent test**: Inventory dataset/field/parameter/image/source fixtures, create/edit/rename/remove eligible local definitions across seven field types, refuse referenced/opaque changes, save/reopen and inspect preserved source. No data selection scroll/rectangle or execution. Covers US3.1–5, AT-04/06/09, SC-002/008/009.

### Fixtures and tests first

- [X] T033 [US3] Add `tests/fixtures/sidebar/data.rdlc`, `data-source-only.rdlc`, `data.expected.json` and malicious/opaque/empty-category cases under `tests/fixtures/sidebar/`, registering them in `tests/fixtures/manifest.json`; include calculated/custom/mapped fields, missing/duplicate names, known/opaque references and sentinel image/query/connection secrets with independent expected definitions/source slices.
- [X] T034 [P] [US3] Add `packages/renderer/src/data.test.ts` for exact category contents/source order/capabilities in supported and source-only syntax, missing/opaque definitions, independent/joint truncation and namespace lookalikes; assert “Categories have synthetic UI keys but no XML target ID, range or mutation capability” and metadata exclusion of all sentinel payloads/secrets.
- [X] T035 [P] [US3] Write `tests/desktop/data.spec.ts` and extend `tests/compatibility/datasets.test.ts` for native menu → actual existing inspector creation/edit/rename/delete/type changes using all seven `fieldTypes`, save/reopen exact definitions, known/opaque-reference refusal, forged unsupported commands and accepted dataset/field selection with no canvas scrolling/rectangle; preserve native single-step Undo assertions.

### Implementation

- [X] T036 [US3] Implement `packages/renderer/src/data.ts`, exporting it through `src/index.ts`, as a bounded read-only syntax projector joined to existing dataset/field facts: enforce “Data kinds are dataset, field, parameter, embedded image, data source and opaque definition,” “Fields are children of their actual dataset” and fixed synthetic category limits; unknown collection children remain source-accessible opaque nodes, not new authoring types.
- [X] T037 [US3] Attach command-specific data capability/reason facts and the exact inert allowlist in `packages/renderer/src/data.ts` using existing `packages/validation/src/datasets.ts` guards: “recognized field/parameter type, validated boolean flags, calculated/mapped/unsupported classification, bounded image MIME/payload-present flag, dataset query-present flag and source inline/shared status”; enforce “No decoding, evaluation or resource access occurs” and exclude raw XML, expressions, query text, credentials and external-reference contents.
- [X] T038 [US3] Populate Report Data in `apps/vscode-extension/src/sidebar/views.ts` from accepted T036/T025 snapshots, with Datasets/Fields, Parameters, Embedded Images and Data Sources, real identities/full accessible names/source/details and truthful editable/preservation-only statuses; truncated empty inventory must say incomplete rather than “no definitions,” and no dataset branch may appear in native Structure.
- [X] T039 [US3] Migrate dataset navigation/creation selection from Structure to Data in `apps/designer/src/app/editor/selection.ts`, `host-adapter.ts`, `editor.component.ts`, `contextual-inspector.component.ts` and `structure-tree.component.ts`, updating `tests/compatibility/datasets.test.ts` and relevant Angular builders/tests; keep compact fallback data access, and enforce “Unique unnamed report/section/body nodes may preserve expansion only” while deleted/ambiguous data targets clear selection with feedback.
- [X] T040 [US3] Add data properties/add/edit/rename/delete routing to `apps/vscode-extension/src/sidebar/actions.ts` and existing Angular dataset forms in `apps/designer/src/app/datasets/datasets.component.ts`, honoring draft/pending/reference/preservation guards and typed intents; parameter/image/source/calculated or unsupported operations remain inspect/source-only and direct forged mutation requests refuse atomically.
- [ ] T041 [US3] Run US3 projection/compatibility/Angular/host/installed Desktop checks, including sanitized observer evidence for inert inspection, exact source preservation and single-step Undo/save/reopen, recording all US3.1–5 outcomes in `specs/005-native-sidebar-integration/evidence/us3.json`.

## Phase 6: User Story 4 — Insert Existing Components from the Sidebar (Priority: P1)

**Goal**: Searchable native eleven-kind toolbox; existing automatic Textbox/unbound Table/Dataset creation, guarded focus/results and honest drag capability.

**Independent test**: Filter/clear, activate each supported kind by pointer/keyboard, verify independent XML/defaults/naming and one Undo/Redo, bind the new table later, attempt all eight unavailable kinds and prove actual compact-fallback drag. Covers US4.1–6, AT-05/06/07, SC-004.

### Tests and probe first

- [X] T042 [P] [US4] Add canonical catalog/filter/capability contract tests in `packages/report-model/src/components.test.ts` and extend `apps/designer/src/app/editor/components-catalog.component.spec.ts` for “Exactly eleven kinds, three creatable,” Report items/Containers/Data categorization, case-insensitive label matches/category context, unavailable reasons, cancelled filter retention and no-results Clear Filter.
- [X] T043 [P] [US4] Write `tests/desktop/components.spec.ts` for real mouse/Enter and host-supported Space activation, automatic lowest-free names including preserved collisions, Textbox 1in × 0.25in, unbound two-column/two-row Table defaults, Dataset no geometry, associated viewport/grid placement, Name/data focus, one announcement and one Undo/Redo; test later rename/binding, all eight unavailable kinds and stale/read-only/pending/invalid/source-only/direct-command refusal with exact text/history equality.
- [X] T044 [P] [US4] Implement and run the public-API native-tree → Angular custom-MIME feasibility probe in `tests/desktop/native-drag.spec.ts`, integrating probe-only contributions through `tests/vscode/harness/package.json`; record actual transfer/cancellation/binary/OS evidence in `specs/005-native-sidebar-integration/evidence/native-drag.json`, with no URI smuggling/private workbench APIs, and distinguish unavailable-with-evidence from failed mandatory automation.

### Implementation

- [X] T045 [US4] Extract the existing canonical catalog into `packages/report-model/src/components.ts` and consume it from `apps/designer/src/app/editor/components-catalog.component.ts`, retaining exactly Textbox/Table/Dataset creatability and Image/Line/Chart/Subreport/Rectangle/List/Matrix/Parameter unavailable reasons; keep category/icon/filter-label/capability facts shared rather than duplicate catalogs or introduce insertion engines.
- [X] T046 [US4] Populate Components in `apps/vscode-extension/src/sidebar/views.ts` and add title filter/clear actions in `apps/vscode-extension/package.json` / `src/sidebar/actions.ts`; filter via native input case-insensitively over labels, retain matching category context and unavailable rows, preserve prior filter on cancel, expose Clear Filter on zero results and ensure filter/expansion changes no report text/history.
- [X] T047 [US4] Route captured component activation through `apps/vscode-extension/src/sidebar/actions.ts` and existing `EditorComponent.create`, `defaultSpot` / `creationSpot` in `apps/designer/src/app/editor/editor.component.ts`; use only the associated view, opening/readiness-checking/binding the captured editable document's designer first when source focus has none, under `contracts/sidebar-bridge.md` and the T055 lifecycle contract. Establish this preliminary path before US4 acceptance; T055 closes its integrated races rather than postponing basic routing. Retain automatic names/default dimensions/placement, unbound Table and existing typed creation intents, with no naming/binding prompt or host-computed second placement path.
- [X] T048 [US4] Carry native creation correlation through `apps/designer/src/app/editor/host-adapter.ts` / `editor.component.ts` and `apps/vscode-extension/src/sidebar/views.ts` so either snapshot/result order selects the created current target once, focuses Name or data inspector appropriately and announces acceptance/refusal once; stale/disposed/draft-cancelled requests restore accepted cues and never duplicate creation or synthesize Dataset geometry.
- [X] T049 [US4] Apply the recorded drag decision in `apps/vscode-extension/src/sidebar/views.ts` and `tests/desktop/native-drag.spec.ts`: default to no drag controller/affordance with activation instructions; only if T044 establishes supported delivery, reuse existing 004 drop handling and require real 25/50/100/200/400% zoom, scroll, snapping/Alt, preview/cancel/resize/stale/outside-body tests with ≤0.01pt error before enabling/advertising it; otherwise retain explicit unavailable evidence without implementing a substitute.
- [X] T050 [US4] Extend `tests/desktop/components.spec.ts` to perform actual 004 HTML drag from the explicit compact fallback with native views hidden/moved, preserving transforms/snapping/Alt/naming/cancel/focus and no forced native reopening; enforce activation/fallback completeness regardless of native drag availability.
- [ ] T051 [US4] Run catalog/Angular/host/installed Desktop creation and fallback suites, recording every US4.1–6 outcome, exact XML/history and conditional drag status in `specs/005-native-sidebar-integration/evidence/us4.json`; unsupported native drag is never reported as a passed drag test.

## Phase 7: User Story 5 — Switch Reports without Losing Work (Priority: P1)

**Goal**: Prove and close lifecycle/race gaps across multiple documents/views, drafts, source, host history and failures using the shared foundation.

**Independent test**: A/B identical object names, two designers of A plus A XML; 100 context switches, 50 delayed/stale/duplicate/closed-target cases, all draft decisions and 20 mixed edits with exact individual Undo/Redo. Covers US5.1–7, AT-03/06/09, SC-005/008.

### Tests first

- [X] T052 [P] [US5] Extend `tests/vscode/synchronization.test.ts` / `lifecycle.test.ts` and `apps/vscode-extension/src/sidebar-context.test.ts` for source/custom/sidebar/non-report focus, split A views versus B with identical names, untitled/Save As/reopened URI, close/replacement/readiness, source invalid→valid, delayed refresh/outcome/selection and rejected transport; assert original document lifetime/view/version authority after every asynchronous boundary. Start editable A with only its source editor and no designer: host-only inspection/source opens none; explicit Angular-dependent actions open/register/await/bind A once; edit/close/Save As, A→B/non-report switches, failed/timed-out readiness and disposal during opening refuse without replacement, duplicate dispatch or mutation. Cover existing same-document view reuse and source-only mutation refusal per `contracts/sidebar-bridge.md`.
- [X] T053 [P] [US5] Write `tests/desktop/context.spec.ts` for 100 actual A/B/two-A/source/sidebar switches and 50 delayed/stale/duplicate/disposed requests, genuine dirty inspector Apply/Discard/Cancel including cross-surface blur ordering, external clean reload/dirty conflict, save/apply failure/cancel and non-report/all-closed no-report states; independently assert zero wrong-target edits, view-local selection/viewport/drafts and no lost unsaved text. Add real source-editor-only A journeys with no designer: inspection/Code XML opens none; native navigation/properties and Textbox/Table/Dataset activation open the correct designer once, preserve existing defaults/focus/draft guards and retain one Undo step per accepted creation. Exercise T052 opening races using real actions with observation/delay hooks only; assert accessible refusal, no opening-only history and no edits to B.
- [X] T054 [P] [US5] Extend `tests/roundtrip/authoring.test.ts` and add `tests/vscode/sidebar-history.test.ts` with ≥12 manifest-listed reports, exact outside-footprint/unrelated-parent-content/namespace equality and twenty mixed accepted operations individually undone/redone to exact expected states; navigation/filter/expansion/refused/no-op/cancelled actions create no dirty state or history, and uncertainty refuses without compensating edits.

### Implementation and closure

- [X] T055 [US5] Complete lifecycle invalidation in `apps/vscode-extension/src/sidebar/context.ts` / `editor-provider.ts` and preliminary action routing in `sidebar/actions.ts` for actual host Save As/untitled/reopen/tab/panel transitions. For an editable report focused in source with no surviving designer, keep inspection/source actions host-only; explicit visual/properties/authoring actions requiring Angular open that captured report via the existing public custom-editor path, register/await readiness and accepted snapshot with a bounded wait, then bind once and dispatch through existing 001–004 handlers. Follow `contracts/sidebar-bridge.md` for expected opening activation versus unrelated context changes; recheck original lifetime/URI/version/context/target/capability after every await, refuse unsupported mutations before opening and terminate on failure/timeout/change/closure/disposal without retry or replacement. Reuse a surviving same-document view with its local viewport/selection/draft guards, never another report's view; make T052/T053 pass with no opening-only content/history change.
- [X] T056 [US5] Close remaining captured-authority races in `apps/vscode-extension/src/sidebar/actions.ts`, `document-session.ts` and `protocol.ts`, enforcing “Every asynchronous boundary revalidates,” “One terminal result per request; duplicate delivery is idempotent” and “No retries onto independent edits”; recheck inside the existing mutation queue, reject read-only/ambiguous/incompatible contexts and settle failed delivery/disposal/bounded-wait exhaustion with reasons.
- [X] T057 [US5] Complete accepted-state/draft/preview reconciliation in `apps/designer/src/app/editor/host-adapter.ts` / `editor.component.ts` for independent source edits, Undo/Redo, external reload/conflicts and async outcomes; preserve “Apply ends the original action; only its correlated accepted mutation can authorize a newer result version,” retain Cancel drafts/selection and revalidate Discard without implicit blur commits or queue deadlock.
- [X] T058 [US5] Complete per-view versus per-document refresh in `apps/vscode-extension/src/document-session.ts` / `sidebar/views.ts` and Angular `selection.ts`, broadcasting accepted content to both A views while keeping selection/viewport/drafts local; clear stale actionable nodes on invalid source and preserve cross-version state only through accepted mappings or unique expanded-type/name/ancestry, never ordinal/range/name alone.
- [X] T059 [US5] Execute T054 native history/preservation assertions after all mutation routes are integrated, closing faults only in existing `apps/vscode-extension/src/edit-controller.ts`, `verify-candidate.ts`, `packages/validation/src/datasets.ts` or `packages/xml-serializer/src/patches.ts` when regression evidence requires it; retain typed atomic bounded edits, exact prior Undo text and normal dirty/save/conflict recovery without whole-document rewrite or filesystem overwrite paths.
- [ ] T060 [US5] Run host/Angular/roundtrip/installed Desktop US5 suites and record switch/race counts, exact twenty-state histories, ≥12-report preservation and all US5.1–7 results in `specs/005-native-sidebar-integration/evidence/us5.json`; keep unexecuted platform cases visibly unvalidated.

## Phase 8: User Story 6 — Use a Stable, Accessible Offline Workspace (Priority: P1)

**Goal**: Full keyboard/focus/theme/scaling support, gesture-safe stable layout and monitored offline/trust behavior across the integrated journeys.

**Independent test**: Run US1–5 keyboard-only in all four reference themes at 100%/200% scaling; compare actual Desktop visuals/contrast, sample 100 canvas interactions/native resizes and run installed journeys with monitored blocked networking in trusted/restricted profiles. Covers US6.1–4, AT-07–09, SC-006/007/009.

### Tests first

- [X] T061 [P] [US6] Write `tests/desktop/accessibility.spec.ts` for keyboard-only activation/tree expansion/obscured selection/Shift+F10 actual menus/insertion/rename/field editing/save/return, visible focus and restoration after deletion/refusal/menu close; assert actual accessible names/roles/selection-primary-count/status/once-only announcements and all empty/loading/no-match/invalid/source-only/truncated/long-label states, preserving normal field clipboard/arrows/history shortcuts without claiming screen-reader speech proof.
- [X] T062 [P] [US6] Write `tests/desktop/visual.spec.ts` and `tests/desktop/layout.spec.ts` for actual icon/container/three views/selection/cues/errors/inspector/canvas comparisons plus composited contrast and continuous frame samples over 100 drag/resize/marquee/nudge interactions; cover native view movement/resizing, fallback, narrow layouts and 100%/200% interface scaling with ≤1 screen-pixel unintended origin drift and zero commits after unavoidable resize cancellation.
- [X] T063 [P] [US6] Write `tests/desktop/offline.spec.ts` and extend `tests/package/offline.test.ts` to execute every installed supported journey against malicious definitions in real trusted/restricted profiles, provisioning before blocking and observing host/webview attempts with T010 positive controls; assert zero report-triggered network/query/entity/code/expression/resource execution and exact preserved source, rather than just blocked responses/static CSP.

### Implementation and evidence

- [X] T064 [US6] Complete accessible native tree/menu descriptions, focus/primary/pending/refused cues and keyboard command behavior in `apps/vscode-extension/src/sidebar/views.ts` / `actions.ts`, plus focus return/once-only announcements/field isolation in `apps/designer/src/app/editor/editor.component.ts` / `contextual-inspector.component.ts`; make T061 pass through real accessible representations and painted-focus assertions.
- [X] T065 [US6] Apply theme-aware icons/control/selection/focus styles in `apps/vscode-extension/src/sidebar/views.ts` and `apps/designer/src/app/editor/editor.component.scss`, using the supplied activity SVG and actual host tokens without changing authored report colors; assert ≥4.5:1 normal text and ≥3:1 essential boundaries/focus/selection in Light+, Dark+, High Contrast and High Contrast Light at both interface scales.
- [X] T066 [US6] Complete gesture-safe layout handling in `apps/designer/src/app/editor/editor.component.ts` / `viewport.ts`, deferring elective inspector/fallback transitions and cancelling unavoidable native resize previews before frame remeasurement; preserve existing responsive panels/rulers/units/zoom/pointer anchoring/grid/guides/Alt and ≤0.01pt retained placement/movement, verified by T062 frame series rather than only endpoint screenshots.
- [ ] T067 [US6] Configure `tests/desktop/playwright.config.ts` and commit actual reference PNGs plus metadata in `tests/desktop/baselines/` for pinned Ubuntu 24.04 image revision/fonts, VS Code 1.142.0 build/hash, 1440 × 1000 display/DPR 1/English/UTC and separate 200% cases; exercise designer areas 1280 × 800, 1024 × 768, 640 × 480 and 400 × 600, enforce exact dimensions/color tolerance ≤0.1/mismatch ratio ≤0.001, no essential-state masks or CI auto-update, and deterministic missing-reference failure.
- [ ] T068 [US6] Audit and close any inertness/isolation regression demonstrated by T063 at `packages/renderer/src/data.ts`, `apps/vscode-extension/src/sidebar/views.ts` / `actions.ts` and `apps/vscode-extension/src/webview.ts` if applicable after locating its existing owner; retain current CSP/trust/parser protections and minimal dependencies, with no decoder/query/connection/resource-fetch path introduced for navigation and no secret/image/query payloads in logs/tooltips.
- [X] T069 [US6] Integrate all functional/installed `test:e2e` cases and fixed-environment `test:visual` into `.github/workflows/ci.yml` required aggregate and failure artifact uploads, preserving the existing six-entry OS/minimum/stable matrix, frozen lockfile and all inherited quality/package checks; use least permissions, fail missing required assertions/baselines/observers and keep stable functional runs separate from pinned screenshot references.
- [ ] T070 [US6] Execute keyboard, visual/layout and monitored offline/trust installed suites on applicable reference/platform environments, recording raw timing/frame/contrast/accessibility/network data, expected/actual/diff images and every US6.1–4 result in `specs/005-native-sidebar-integration/evidence/us6.json`; unresolved mandatory capture or comparison failures block validated delivery.

## Phase 9: Polish & Cross-Cutting Completion

**Purpose**: Same-candidate evidence, inherited non-regression and release gate integrity; no release publication is requested.

**T072 implementation diagnostic — 2026-10-25**: The new required
`tests/desktop/coverage.spec.ts` resolves declared `file::title` references
against actual nonempty test declarations in current candidate source, through
`coverage-assertions.ts`. Its unit regression rejects comment-only IDs, skipped
tests/suites, empty callbacks, missing files and unresolved titles. The first
repository scan reports 148 unresolved references; two US1 title mappings are
then corrected to their verified existing assertions. This is static discovery,
not execution or passing evidence. The coverage suite must fail while unresolved
references remain; T072 is open and no acceptance assertion is fabricated.

**T072 follow-up**: Independent title mapping reduces the next unresolved count
from 89 to 18; the parent reruns the resolver and confirms all 18 belong to the
Data/Components Desktop suites being authored. Only assertion references and
the native-drag exception's matching probe reference change; row identities,
oracles, fixture requirements and required artifacts are preserved. Candidate-
binding requirements reference real evidence-validation tests, not the static
title resolver. `coverage.spec.ts` remains red, and resolved titles still need
actual same-candidate execution and complete oracle coverage.

**T072 discovery follow-up**: With the six Data assertions and the current
Components declarations present, the parent resolver reports zero unresolved
references. This supersedes the static 18-reference diagnostic above, not the
runtime requirements: the coverage suite still needs execution, the authored
journeys need installed runs, and complete oracle/artifact/same-candidate
consistency remains open. No task is completed from title discovery alone.

- [X] T071 [P] Add workflow regression assertions in `tests/release/sidebar-gates.test.ts` for required E2E/visual aggregate dependencies, minimum/stable OS coverage, frozen installs, fail-closed missing evidence and canonical artifact digest handoff; update `.github/workflows/release.yml` so applicable installed E2E/security/visual checks certify the canonical rebuilt VSIX bytes before `release-artifact.js`, preserving `.github/workflows/publish.yml` same-artifact/version/non-overwrite rules.
- [X] T072 [P] Complete automatically checked coverage/evidence consistency in `tests/desktop/coverage.spec.ts` and `tests/desktop/evidence.ts`, requiring executable assertion IDs for every row of `tests/desktop/coverage.json`, versioned input manifest/fingerprint, separate VSIX/fixture/environment hashes and verified artifacts under `contracts/desktop-validation.md#candidate-fingerprint-and-evidence-invalidation`. Test evidence/status output exclusion without excluding assertions/fixtures/expected baselines/coverage/normative contracts; detect tracked/untracked input additions/deletions/changes before/after execution and aggregation, invalidate prior candidate eligibility and require all mandatory applicable gates for the new fingerprint. Test artifact tampering/missing results, environment changes and changed VSIX digests, preserving exact-canonical-artifact release checks; bookkeeping-only commits do not waive tagged-commit gates. Reject missing/unrun/failed mandatory cases and require native-drag probe plus passing activation/fallback when unavailable; generated evidence must never invalidate itself or become proof merely by existing.
- [ ] T073 Run the entire inherited and new regression matrix from `specs/005-native-sidebar-integration/quickstart.md` sequentially through root commands: format/lint/typecheck/unit/roundtrip/compatibility/build/acceptance/release/package/native/package/E2E/visual; include 001 data/page/text/table/group/totals, 002 eight handles/table resize/alignment/distribution/nudge/viewport/clipboard, 003 draft/responsive/inspector/status, 004 names/unbound binding/fallback/CRLF-LF fixes, and record actual outputs/artifact digests in `specs/005-native-sidebar-integration/evidence/regression.json`.
- [X] T074 Update `README.md`, `CONTRIBUTING.md` and `specs/005-native-sidebar-integration/quickstart.md` with implemented native entry points, filter/fallback/keyboard/source behavior, exact test prerequisites/commands and evidenced drag limitation/capability; retain explicit compatibility and offline boundaries and remove proposed-command wording only for commands that now exist and pass their contract.
- [ ] T075 Reconcile all task/AT/FR/scenario/edge/SC outcomes against the same tested candidate in `specs/005-native-sidebar-integration/automated-validation.md` and `evidence/summary.json`, recheck constitution 1.2.0/no vendor edits/runtime dependency leakage and canonical VSIX digest, and declare feature validated only when every mandatory assertion has executed/passed in applicable CI environments; report any remaining failure/unrun/technical blocker as unvalidated rather than checking it off.

**Completion run — 2026-10-25 (Windows, VS Code 1.142.0, installed VSIX)**:
every installed functional suite passes locally: Workspace 11/11, Structure
12/12, Data 6/6, Components 12/12, Context 17/17, Accessibility 6/6, Layout 5/5,
native-drag probe, bootstrap and coverage. Product corrections in this run:
- A user-folded native row stays folded across refreshes (US2.3).
- An accepted native outcome overtaken by an independent change settles once
  as a refusal instead of waiting out the host timeout (EDGE-08, US5.4).
- A stale inspector draft can no longer commit into a reloaded report.
  Chromium fires `change` when a rebuild removes a dirty focused field, so
  commits carry their version-local target and the field resets to accepted
  values (US5.6).

SC-003 now alternates native and canvas operations as specified. Each starts
250ms after the previous update is visible, past the host's 200ms TreeView
event coalescing; the result is 100/100 within 200ms (25–74ms). The 95/100
bound is unchanged.

The opening races (SC-005: 50 cases) use a test-only delay hook: the extension
host is paused through its Node inspector while the real opening is in flight.

CI splits the Desktop matrix into `core`, `authoring` and `context` jobs via
`RDLC_DESKTOP_GROUP`.

Still open, and not validated by this run:
- Visual comparisons need the pinned Ubuntu reference environment and images
  (T067). Offline and security observation need the Linux observer or an
  unimplemented elevated Windows backend (T010, T063 execution, T068).
- The cross-platform CI matrix has not run (T012).
- The acceptance and evidence tasks (T011, T019, T032, T041, T051, T060, T070,
  T073, T075) need same-candidate CI evidence.

Native drag remains unavailable-with-evidence (`evidence/native-drag.json`).

## Dependencies & Execution Order

### Phase and story graph

```text
Setup T001–T004
  └─ Foundation T005–T012
       └─ US1 T013–T019 (native shell MVP)
            └─ US2 T020–T032 (hierarchy + accepted bridge + source)
                 └─ US3 T033–T041 (Data inventory/inspector)
                      └─ US4 T042–T051 (all three creation kinds)
                           └─ US5 T052–T060 (integrated races/history)
                                └─ US6 T061–T070 (all-journey accessibility/visual/offline)
                                     └─ Completion T071–T075
```

All stories are P1, so specification order is the default serial execution order. Dependencies are real integration boundaries, not claims that every story can start from an empty baseline. Each story's checkpoint uses installed fixtures and prior completed capabilities, without waiting for later stories to prove its own assertions.

- **Foundation**: T005 tests precede T006–T009. T010 is independent security-observer work after Setup; T011 requires routing/transport and observer readiness, T012 exercises that bootstrap on CI targets. Conditional native drag is not a foundation requirement.
- **US1** needs the shared registry/runner, not extended hierarchy/data or native drag. Its MVP exposes truthful report-aware shells; it does not claim later authoring stories complete.
- **US2** requires US1 native surfaces and the shared protocol; T020 precedes T021–T023, which can be authored concurrently. T024 precedes T025; T026–T031 then integrate selection, source and context actions. Legacy data consumers stay viable until T039.
- **US3** requires the accepted bridge, source guards and allocation from US2. T033 precedes T034/T035. T036/T037 precede T038–T040; T039 must land with updated strict snapshots/builders and compatibility expectations, not leave a broken dataset-selection intermediate.
- **US4** requires US3 to validate Dataset post-creation selection as well as Textbox/Table. Catalog/filter-only development may overlap earlier read-only work after shared types agree, but T047–T051 wait for the accepted bridge and Data integration. T044 probe is independent of product insertion; T049 is explicitly conditional on its evidence.
- **US5** exercises integrated US1–4 routes. Essential action capture/stale refusal/draft checks already ship in Foundation/US2; this phase closes measured lifecycle races, not postpones basic safety until after authoring.
- **US6** verifies all earlier journeys. Security observation primitives are already foundational; final offline assertions cannot be replaced by those positive controls. T067 follows actual implemented UI states and repeatability proof; missing references fail.
- **Completion** requires all stories and same-candidate evidence. T071/T072 are separate-file work; T073 serializes compile/build/consumer suites. Included candidate input changes invalidate prior candidate eligibility and require all mandatory applicable gates before T075; environment/VSIX/artifact changes follow the Desktop contract. Evidence/status-only output updates do not invalidate themselves.

### Parallel execution examples per story

Run only the ready batch shown; these are task references, not extra checklist tasks.

| Story | Parallel batch | Why independent / join |
| --- | --- | --- |
| US1 | T013 package contract + T014 Desktop workspace assertions | Different files; both join before manifest/provider changes and T019 execution |
| US2 | After T020: T021 projector/budget assertions + T022 Angular selection/viewport assertions + T023 Desktop structure assertions | Different test owners and shared frozen fixture oracle; join before production edits |
| US3 | After T033: T034 data projection assertions + T035 real data workflow assertions | Different files; join before T036–T040 implementation |
| US4 | T042 catalog assertions + T043 Desktop activation assertions + T044 independent public-API drag probe | Separate files; probe may use its own disposable profile; no shared build-tree mutation |
| US5 | T052 host/context lifecycle assertions + T053 Desktop context assertions + T054 preservation/history assertions | Different test owners; join before lifecycle closure and serialize actual compiled runs |
| US6 | T061 accessibility assertions + T062 visual/layout assertions + T063 offline/package assertions | Separate files; runtime profiles/displays and network blocking must be isolated; join before integration fixes |

Additional parallel work: T010 alongside T005–T009 once Setup is ready; T071 alongside T072 after story completion. `[P]` marks authoring/file independence; do not run concurrent `compile.ts` rebuilds against suites reading removed output trees.

## Coverage and independent checkpoints

This table is a task map, not acceptance evidence. `tests/desktop/coverage.json` must enumerate each individual scenario/edge/oracle and its executed assertions; the existing [automated-validation.md](automated-validation.md) matrix remains authoritative.

| Scope | Primary tasks | Required automated checkpoint |
| --- | --- | --- |
| US1.1–4; FR-001–004; SC-001 | T013–T019 | AT-01 fresh profile/native layout/Explorer, zero view-only text changes, keyboard/icon states |
| US2.1–6; FR-005–011; SC-002/003 | T020–T032 | AT-02/03 exact source ancestry/current range, accepted selection/primary, 100 samples and safe refresh |
| US3.1–5; FR-010/012–014; SC-002/008/009 | T033–T041 | AT-04 seven field types/reference guards/save-reopen/inert inventory with no synthetic geometry |
| US4.1–6; FR-015–018; SC-004 | T042–T051 | AT-05 exactly-once automatic insertion, all unavailable states, one Undo, probe plus real fallback drag |
| US5.1–7; FR-019–026/031; SC-005/008 | T052–T060 plus T005–T009/T027 | AT-06 100 switches/50 races, exact 20-step native history and ≥12-report preservation |
| US6.1–4; FR-027–030; SC-006/007/009 | T061–T070 plus T010–T012 | AT-07–09 all-keyboard/themes/scales, contrast/visual/frame thresholds, monitored trusted/restricted offline |
| FR-032–034; SC-010; all inherited regression rows | T001/T004/T012/T069/T071–T075 | Required root/CI/canonical-VSIX gates and complete same-candidate evidence, no missing mandatory assertions |
| Untitled/Save As; hidden/moved/closed/reloaded views; failed apply/save/dirty conflicts | T014/T018/T030/T052–T060 | Exact host identity, lifetime invalidation, restoration and accepted unsaved source |
| Duplicate/absent/renamed identities; mixed modes; delayed echoes/rejected delivery | T005/T008/T020–T028/T039/T048/T052–T058 | Safe correspondence/exclusivity, accepted-state restoration and once-only results |
| Source-only/multiple sections; invalid/unsafe/parser budgets; opaque/truncated coverage | T020–T025/T033–T039/T058/T061/T063 | Inspectable actual syntax only, no stale nodes/unauthorized visual edits, explicit incomplete state |
| Unknown/zero/oversized bounds; long labels/expressions/embedded payloads/secrets | T022/T023/T029/T033–T038/T061–T068 | No guessed geometry, reachable center where known, full accessible names and no payload/execution leakage |

## Implementation Strategy

### MVP first

Complete Setup, Foundation and US1 (T001–T019), then execute its installed fresh-profile/native-placement/Explorer/compact-fallback checks. This is a native workspace-shell MVP, not completion of the six-story feature. Keep existing authoring reachable through the designer throughout.

### Incremental delivery

Add US2 structure/selection/source, US3 Data, US4 Components, US5 integrated lifecycle proof, then US6 all-journey accessibility/visual/offline. Test each checkpoint independently before advancing. Use the existing data forms/creation engine and smallest shared routing/projection extensions; do not add speculative native editors or alternate XML paths.

Every implementation slice must leave precise source, selection, pending/draft and fallback behavior working. Commit logical passing increments using repository gitmoji/type/scope conventions. Keep evidence truthful when the environment cannot run required CI/OS coverage; investigate automation gaps rather than substituting manual approval. Final feature validation requires T075's complete same-candidate automated evidence.
