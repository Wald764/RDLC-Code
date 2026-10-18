# Interactive Designer Validation Record

## Current status

Phase 1 setup (T001–T003) and Phase 2 foundation (T004–T013) completed on 2026-10-18. User stories and full-feature acceptance remain pending. Foundation success does not establish direct manipulation, clipboard operations or latency targets.

The [implementation ledger](../../specs/002-interactive-visual-designer/checklists/implementation.md) records baseline details, fixture provenance and all FR/SC task/test mappings. Procedures and the presentation-timing collection protocol are in the [validation guide](../../specs/002-interactive-visual-designer/quickstart.md).

## Setup evidence

| Field                          | Recorded value                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Checkout                       | `488cbd3a69ab26e3be6ede1f1b9a5310678eb364` plus local specification/Phase 1 changes; not an installed release candidate   |
| OS                             | Windows NT 10.0.26300.0                                                                                                   |
| Toolchain                      | Isolated Node 24.22.0 / pnpm 11.28.2; verified with `pnpm exec node --version`                                            |
| Frozen installation            | PASS; all 9 workspace projects up to date                                                                                 |
| Baseline                       | PASS: lint, typecheck, 44 Node unit tests, 14 Angular tests, 14 roundtrip tests, 10 compatibility tests, production build |
| Added fixtures                 | `tests/fixtures/interactive/{mixed,optional-geometry,clipboard-dependencies}.rdlc`                                        |
| Corpus                         | 15 entries (12 retained + 3 added), synthetic MIT provenance and existing MS-RDL citation paths                           |
| Fixture checks                 | Both manifest tests and assert-based parse/projection/token-reconstruction smoke check pass                               |
| Pre-existing baseline failures | None observed                                                                                                             |
| Installed VSIX identity        | Pending; no new VSIX built/installed for this phase                                                                       |

## Foundation evidence (T004–T013)

Checkout: `0ea7803d2da58bc4fb3aa029879656afd3983f63` plus the local foundation changes. Environment: Windows NT 10.0.26300.0, isolated Node 24.22.0 / pnpm 11.28.2, native development tests in VS Code 1.142.0. The existing wildcard report-model exports already expose the new geometry subpath. Ignore files were verified against the current Node/Angular workspace; no additions were necessary.

| Tasks           | Implementation and regression evidence                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T004–T006       | Shared point/CSS-pixel conversions and unit-preserving decimal formatting; all five units, tiny positive sizes, unchanged lexemes, missing versus expression geometry and 0.01pt tolerance in `packages/report-model/src/geometry.test.ts`.                                                                                                                                                                                      |
| T005, T007–T008 | Renderer tests cover derived textbox bounds, explicit/unknown geometry, axis-local eligibility, source-only mutation refusal, source order/ZIndex, preserved placeholders, distinct table frames/parent-linked cells and derived table sizes independent of position. The designer omits unknown hit rectangles and retains list access; existing forms remain compatible.                                                       |
| T009–T010       | Protocol tests cover all eight handles, six alignments, both distribution axes, complete bounded target sets, version-scoped IDs, strict result mappings, unknown keys, malformed numbers/units and existing message budgets. Layout is a transport foundation; its planning/capability activation belongs to the following stories and is explicitly refused until then.                                                        |
| T011–T012       | Serializer tests cover deterministic same-offset insertions, overlap/stale-plan refusal, namespace union/conflicts and exact outside-footprint equality. A real prefixed textbox test composes four absent properties while preserving comments, attribute quotes and CDATA.                                                                                                                                                     |
| T013            | Controller tests prove explicit/implicit scalar geometric no-ops, exact source spelling, deleted identities and source-offset correspondence after insertions shift sibling node ordinals. Native synchronization tests prove zero WorkspaceEdit calls/version/dirty/source changes for a no-op and validate accepted base/result versions and mappings. Existing queue, stale/duplicate guards and uncertain-apply checks pass. |

Tests were introduced before their implementations: geometry/scene and result production initially failed compilation for the missing contracts; protocol/result and composition tests then demonstrated the expected runtime failures before their validators/normalization were completed. One expanded identity test initially hit the existing opaque-reference refusal in its duplicated neighbor; removing that neighbor's opaque metadata isolated correspondence without weakening production guards.

| Check                     | Result                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`               | PASS                                                                                                                                         |
| `pnpm typecheck`          | PASS; root TypeScript and Angular                                                                                                            |
| `pnpm test:unit`          | PASS; 58 Node and 14 Angular tests; the subsequently added real compound textbox regression also passes in the focused 4-test serializer run |
| `pnpm test:roundtrip`     | PASS; 14 tests                                                                                                                               |
| `pnpm test:compatibility` | PASS; 10 tests                                                                                                                               |
| `pnpm build`              | PASS; extension and Angular production output                                                                                                |
| `pnpm test:vscode`        | PASS; all six native development suites, including the new no-op/result checks                                                               |

No new dependency, vendor change or installed-release claim. The checklist gate files remain read-only. Full installed/packaged, cross-platform and timed acceptance below remains pending for the user stories and final phase.

## Pending installed and timed evidence

All entries are **Pending**, not passed or waived. Record actual candidate commit/VSIX SHA-256, fixture, OS/VS Code version, procedure and result per run. Keep failed/unavailable evidence explicit. E01–E08 are stable ledger references, not additional acceptance requirements.

| ID  | Evidence required                                                                                                                                                                                                                                                                                | Tasks / criteria                                      | Status                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------- |
| E01 | All eight textbox/table handles, fixed edges, proportional totals, mixed/implicit sizes, overflow, cancellation/no-op/refusal and native Undo. Timed selection → diagonal drag → corner resize → alignment → duplicate → save/reopen in ≤3 minutes without source edits/typed coordinates.       | T026, T084; FR-005–FR-010; SC-001                     | Pending                                   |
| E02 | Click/Shift/marquee/list selection, primary, obscured/unknown items, mixed moves, six alignments/two distributions, locked/invalid/negative-gap refusal and selection survival.                                                                                                                  | T035; FR-001–FR-004, FR-015                           | Pending                                   |
| E03 | Equivalent geometry at 25/50/100/200/400%, scroll/nondefault display scaling, snapping/Alt, independent view preferences, 100 forward/backward nudges. Separate real presented-frame latency series at 100/200%, including 20-item moves.                                                        | T059, T082, T084; SC-004–SC-005                       | Pending                                   |
| E04 | Draft Apply/Discard/Cancel, limitation/source access and baseline forms; independent changes during preview/pending; uncertain/read-only apply, failed Save/Save As and close cancellation preserve accepted unsaved content.                                                                    | T045; FR-009, FR-022–FR-025                           | Pending                                   |
| E05 | Installed keyboard-only selection, all alignments/distributions, nudge, numerical sizing, clipboard, zoom, Reveal Selection, Undo/Redo and Save; labels/live feedback/visible usable focus; ordinary input shortcuts.                                                                            | T083; FR-026; SC-006                                  | Pending separately on Windows/macOS/Linux |
| E06 | Newly built installed VSIX, offline trusted/untrusted local workspaces, every new workflow; no report-triggered network/resource/data/code/expression activity; unsupported-source access.                                                                                                       | T081, T083; FR-025; SC-008                            | Pending separately on Windows/macOS/Linux |
| E07 | Positive same/cross-document subtree reuse plus every refusal: grouped/mixed content, unique nested names/references, namespace/metadata proof, omitted sizes across destination bodies, offsets/reveal, clipboard failures/races, unchanged Duplicate clipboard and exact one-step restoration. | T079; FR-017–FR-021, FR-024; SC-007                   | Pending                                   |
| E08 | Twenty mixed accepted operations, twenty native Undos/Redos, exact whole-source/selection each step; zero extra steps for stale/refused/no-op/cancelled cases; split views, persistence, encoding/EOL and lexical footprints.                                                                    | T080, T085–T086; FR-008, FR-023–FR-024; SC-002–SC-003 | Pending                                   |

### Performance run record (E03 / SC-005)

| Field                                                             | Value                       |
| ----------------------------------------------------------------- | --------------------------- |
| Candidate commit / VSIX SHA-256                                   | Pending                     |
| CPU / RAM / OS / display scaling / VS Code                        | Pending                     |
| Fixture identity, ≤1 MiB and 100 selectable body items            | Pending T082 fixture        |
| Installed-driver invocation / raw collector exports               | Pending T082 implementation |
| Monotonic clock alignment / trace and presented-frame references  | Pending                     |
| 100% feedback series, ≥95/100 ≤50ms per applicable series         | Pending                     |
| 200% feedback series, ≥95/100 ≤50ms per applicable series         | Pending                     |
| 100% accepted-edit series including 20-item moves, ≥95/100 ≤200ms | Pending                     |
| 200% accepted-edit series including 20-item moves, ≥95/100 ≤200ms | Pending                     |
| Slow, failed and unresolved sample exports                        | Pending; retain these runs  |

DOM mutation, host completion and animation callbacks alone are not painted-result evidence. Synthetic records test only the collector/validator, never satisfy acceptance.

## Final automated gates

Phase 2 final checks passed: `pnpm format:check` and `git diff --check`; T004–T013 are marked complete. The post-implementation hooks check found no `.specify/extensions.yml`. No vendor, dependency or lockfile changes were introduced.

Phase 1 final checks passed: `pnpm format:check`, `git diff --check`, complete 27-FR/8-SC ledger coverage and T001–T003 completion markers. No vendor files changed; no extension hooks file was present.

T085 will record lint, typecheck, unit, roundtrip, compatibility, build, acceptance, native, package and installed-package results in validation-guide order, followed by format checking. Setup ran only the baseline subset and fixture checks above; full-feature/packaged acceptance is pending.

## Boundaries

These fixtures/records do not expand report versions or construct support. The native XML document remains authoritative. External RDLC execution, populated rendering and pagination fidelity remain unverified, separate from authored layout correctness. Missing installed/platform/keyboard/offline/real timing evidence blocks full feature acceptance.
