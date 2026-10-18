# Interactive Designer Validation Record

## Current status

Phase 1 setup (T001–T003) completed on 2026-10-18. Interactive foundation, stories and feature acceptance remain pending. Baseline success does not establish the new controls, clipboard operations or latency targets.

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

Phase 1 final checks passed: `pnpm format:check`, `git diff --check`, complete 27-FR/8-SC ledger coverage and T001–T003 completion markers. No vendor files changed; no extension hooks file was present.

T085 will record lint, typecheck, unit, roundtrip, compatibility, build, acceptance, native, package and installed-package results in validation-guide order, followed by format checking. Setup ran only the baseline subset and fixture checks above; full-feature/packaged acceptance is pending.

## Boundaries

These fixtures/records do not expand report versions or construct support. The native XML document remains authoritative. External RDLC execution, populated rendering and pagination fidelity remain unverified, separate from authored layout correctness. Missing installed/platform/keyboard/offline/real timing evidence blocks full feature acceptance.
