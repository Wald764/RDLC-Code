# Interactive Designer Implementation Evidence

## Phase 1: Setup (T001–T003)

Completed on 2026-10-18. Foundation and user stories remain pending. This is an implementation/evidence ledger, not a requirements-quality checklist; it intentionally uses tables rather than reviewer checkbox markers. Baseline passes are not interactive acceptance passes.

### T001: Reproducible baseline

- Checkout: `488cbd3a69ab26e3be6ede1f1b9a5310678eb364` plus existing local specification changes and Phase 1 additions; not a released/installed candidate.
- Environment: Windows NT 10.0.26300.0; Node 24.22.0; pnpm 11.28.2. These match `.node-version`, `package.json`'s Node `>=24.15.0 <25` and pinned package manager.
- The default workstation Node is 22.22.3. Verification uses the existing isolated `C:\Users\Alexandre\AppData\Local\Temp\opencode\rdlc-toolchain\node.exe` and an isolated pnpm launcher first in `PATH`. `pnpm exec node --version` confirms v24.22.0. Repository toolchain settings are unchanged.
- Final logs: `C:\Users\Alexandre\AppData\Local\Temp\opencode\interactive-phase1\`; these are local logs, not portable installed acceptance evidence.

| Command | Result | Details / log |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | All 9 workspace projects up to date; lockfile unchanged. |
| `pnpm lint` | PASS | Exit 0; `lint.log`. |
| `pnpm typecheck` | PASS | Root TypeScript and Angular compiler; `typecheck.log`. |
| `pnpm test:unit` | PASS | 44 Node + 14 Angular tests, no failures/skips; `test-unit.log`. |
| `pnpm test:roundtrip` | PASS | 14 tests, no failures/skips; `test-roundtrip.log`. |
| `pnpm test:compatibility` | PASS | 10 tests, no failures/skips; `test-compatibility.log`. |
| `pnpm build` | PASS | Domain/extension compilation and Angular production build; `build.log`. |

No pre-existing failure was observed. The initial run used the global pnpm launcher, which binds to the global Node executable; the recorded checks were repeated with the isolated launcher to eliminate that ambiguity. PowerShell renders native stderr announcements as `NativeCommandError` records in redirected logs; exit codes and test summaries pass.

### T002: Fixture and setup checks

| Fixture (repository-relative path) | Prepared coverage | Verified input properties |
| --- | --- | --- |
| `tests/fixtures/interactive/mixed.rdlc` | Overlapping textboxes with ZIndex/source ties; grouped table and subtotal/dataset totals; five units; safe annotation; locked rectangle, expression and unknown-bounds neighbors. | Valid editable projection; supported structural table with three rows and both total kinds; exact token reconstruction. |
| `tests/fixtures/interactive/optional-geometry.rdlc` | Both/one omitted dimensions, absent positions, expression-valued dimensions/position, tiny positive sizes, mixed explicit spellings; reusable for different-body clipboard sizing. | Eight textboxes; missing width remains null, expression width remains literal without width capability; exact token reconstruction. |
| `tests/fixtures/interactive/clipboard-dependencies.rdlc` | Internal Title reference when selected together, retained Outside reference, outside consumer blocking Title removal, typed Orders aggregate, literal lookalikes and isolated classified metadata. | Seven textboxes, one dataset, decoded ReportItems/aggregate operands, exact token reconstruction. |

The manifest retains all 12 existing entries and registers three synthetic MIT fixtures with cited MS-RDL paths, intended footprints and current projection diagnostics/capabilities. `consumerEvidence: null` does not claim interactive acceptance. T077 extends clipboard namespace/opaque inputs later; grouped-table input already exists in `mixed.rdlc`.

After registration, `node --test dist/tests/compatibility/manifest.test.js` passes both existing provenance/projection tests for all 15 entries. A Node assert-based smoke check confirmed the properties above. Its initial assertion used a nonexistent table `capabilities` field; correcting the check to the actual `structural`/`blockedReason` contract passed without product changes.

Ignore verification: `.gitignore` covers Node dependencies/outputs/logs/environment files and OS/editor temporaries; `eslint.config.ts` covers generated/dependency/coverage directories. `.prettierignore` now excludes interactive XML alongside the other lexical fixture directories. No Docker, Terraform, Helm or legacy ESLint configuration was found. The root workspace is private; existing VSIX packaging handles extension publication, so no npm publishing ignore file is needed.

## T003: Requirement coverage and evidence plan

Every row is **Pending**. Task and future test links describe planned coverage, not executed behavior. Installed/timed references E01–E08 resolve to [the validation record](../../../../docs/validation/interactive-designer.md#pending-installed-and-timed-evidence).

### Path keys

All paths are repository-relative:

- **M**: `tests/fixtures/interactive/mixed.rdlc`.
- **O**: `tests/fixtures/interactive/optional-geometry.rdlc`.
- **C**: `tests/fixtures/interactive/clipboard-dependencies.rdlc`.
- **L**: `tests/fixtures/xml/lexical.rdlc`, `tests/fixtures/textboxes/supported-plus-opaque.rdlc`.
- **F**: Future `tests/fixtures/interactive/{clipboard-namespaces,clipboard-opaque,performance-100}.rdlc` (T077/T082); not created yet.
- **geometry**: `packages/report-model/src/geometry.test.ts`.
- **scene**: `packages/renderer/src/{render,tables}.test.ts`.
- **host**: `apps/vscode-extension/src/{protocol,edit-controller,verify-candidate}.test.ts`.
- **designer**: `apps/designer/src/app/editor/{editor.component,lifecycle,selection,viewport,placement}.spec.ts` and the authoring/property tests specified in each task.
- **layout**: `packages/validation/src/layout.test.ts`, `packages/xml-serializer/src/patches.test.ts`.
- **roundtrip**: `tests/roundtrip/{interactive,arrangement,precision,clipboard}.test.ts`.
- **clipboard**: `packages/expressions/src/{analyze,references}.test.ts`, `packages/validation/src/clipboard.test.ts`, `apps/vscode-extension/src/clipboard.test.ts`.
- **native**: `tests/vscode/{lifecycle,synchronization,persistence,clipboard}.test.ts`.
- **compatibility**: `tests/compatibility/{textboxes,tables,datasets}.test.ts`.
- **installed**: `tests/package/{contents,offline}.test.ts` and packaged native checks.
- **performance**: `tests/performance/editor.test.ts`, future `tests/performance/measure-interactive.ts`.

| Requirement | Implementation / acceptance tasks | Fixtures | Automated coverage planned | Installed/timed gate | Status |
| --- | --- | --- | --- | --- | --- |
| FR-001 Selection | T027, T029–T030, T034–T035 | M, O | designer; native | E02, E05 | Pending |
| FR-002 Body/table/cell/placeholder identity | T005, T007–T008, T023, T041 | M, L | scene; host; designer; compatibility | E01, E02, E04 | Pending |
| FR-003 Drawing order/item list | T005, T008, T027, T030 | M | scene; designer | E02, E05 | Pending |
| FR-004 Selection continuity | T013, T015, T021, T033–T034, T040 | M, C | host; designer; native | E01, E02, E04 | Pending |
| FR-005 Preview/group move | T014–T018, T022–T024, T028, T031–T033 | M, O | host; designer; layout; roundtrip | E01, E02 | Pending |
| FR-006 Eight resize handles | T014–T020, T022–T026 | M, O | host; designer; roundtrip | E01, E05 | Pending |
| FR-007 Proportional table resizing | T014, T019–T020, T025–T026 | M | host; roundtrip; native | E01 | Pending |
| FR-008 Atomic operations/no-op | T009–T013, T020, T024–T025, T031–T034, T073–T074, T080 | M, O, C | host; layout; roundtrip; native | E01, E02, E07, E08 | Pending |
| FR-009 Cancellation/stale/pending | T015, T021, T024–T025, T036–T043, T063, T078 | M, O, C | host; designer; native | E01, E04, E07 | Pending |
| FR-010 Precise valid units/geometry | T004, T006, T014, T017–T020, T056 | M, O | geometry; host; roundtrip | E01, E03 | Pending |
| FR-011 Zoom/navigation | T046, T048–T052, T058–T059 | M, O | designer; native | E03, E05 | Pending |
| FR-012 Transforms/overflow/authoring label | T046, T049, T051–T052, T056 | M, O | designer; roundtrip | E03 | Pending |
| FR-013 Per-view preferences | T047–T050, T054, T057–T059 | M | designer; native | E03, E05 | Pending |
| FR-014 Grid/guides/Alt | T047, T053–T054, T056, T058–T059 | M, O | designer; roundtrip | E03 | Pending |
| FR-015 Alignment/distribution | T028, T031–T035 | M | layout; host; roundtrip; native | E02, E05 | Pending |
| FR-016 Atomic keyboard nudges | T048, T055–T059 | M, O | designer; roundtrip; native | E03, E05 | Pending |
| FR-017 Clipboard actions/shortcuts | T071–T076, T078–T079 | C, M | host; clipboard; designer; native | E05, E07 | Pending |
| FR-018 Complete compatible subtree reuse | T060–T070, T074, T077–T079 | C, M, O, F | clipboard; roundtrip; native | E07 | Pending |
| FR-019 Offsets/selected revealed copies | T074–T076, T078–T079 | C, M, O | clipboard; designer; roundtrip; native | E07 | Pending |
| FR-020 Unique identities/reference proof | T060–T070, T077–T079 | C, M, F | clipboard; host; roundtrip | E07 | Pending |
| FR-021 Safe acknowledged Cut | T061, T063, T067, T073, T078–T079 | C, M, F | clipboard; compatibility; native | E07, E08 | Pending |
| FR-022 Existing controls/property drafts | T036, T038–T042, T044–T045 | M, L | designer; compatibility; native | E04, E05 | Pending |
| FR-023 Native document lifecycle | T025, T034, T037, T043, T057, T078, T080 | M, O, C | host; native | E04, E08 | Pending |
| FR-024 Lexical/namespace preservation | T011–T012, T016, T018–T020, T032, T062, T069–T070, T077 | M, O, C, L, F | layout; roundtrip; host; native | E01, E07, E08 | Pending |
| FR-025 Unsupported/security/offline boundary | T009–T010, T041, T044–T045, T061, T063, T081, T083 | M, C, L, F | host; compatibility; clipboard; installed | E04, E06, E07 | Pending |
| FR-026 Keyboard/focus/announcements | T027, T030, T036, T042, T058, T075–T076, T083 | M, C | designer; installed | E05 | Pending |
| FR-027 Complete acceptance matrix | T002–T003, T026, T035, T045, T059, T079–T086 | M, O, C, L, F | All suites above | E01–E08 | Pending |
| SC-001 Three-minute workflow | T084, T086 | M | Supporting checks only; actual timed run required | E01 | Pending |
| SC-002 Exact changes/restoration | T011, T016, T025, T028, T034, T062, T070, T078, T080 | M, O, C, L, F | layout; roundtrip; host; native | E08 | Pending |
| SC-003 Twenty atomic Undo/Redo steps | T080, T085–T086 | M, O, C | native | E08 | Pending |
| SC-004 Zoom/unit/nudge precision | T004, T046–T047, T056–T059 | M, O | geometry; designer; roundtrip | E03 | Pending |
| SC-005 Presented-feedback latency | T082, T084–T086 | F | performance collector/validator; synthetic checks are not acceptance | E03 | Pending |
| SC-006 Keyboard-only workflow | T042, T058, T075–T076, T083 | M, C | designer; installed | E05 | Pending |
| SC-007 Clipboard preservation/refusal | T060–T079 | M, O, C, F | clipboard; roundtrip; host; native | E07 | Pending |
| SC-008 Installed offline inert workflows | T081, T083, T085–T086 | M, C, L, F | installed; packaged native | E06 | Pending |

Acceptance-matrix mapping: direct manipulation E01; group operations E02; precision/navigation E03; clipboard and clipboard geometry/metadata boundaries E07; preservation E08 plus roundtrip; document services E04/E08; offline/accessibility E05/E06. All remain unresolved until executed.

## Next checkpoint

T003 verification passed: all 27 FR rows and 8 SC rows are present, T001–T003 are marked complete, `pnpm format:check` and `git diff --check` pass, and no `vendor/` file changed. No extension hooks file was present at either execution boundary.

Phase 2 is T004–T013. Run the prescribed failure-first foundation tests before geometry, scene, protocol, patch-composition and result-correlation implementation. No interactive support is inferred from setup inputs or baseline passes.
