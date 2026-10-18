# Tasks: Interactive Visual Designer

**Input**: Design documents in `specs/002-interactive-visual-designer/`: `plan.md`, `spec.md`, `baseline-analysis.md`, `research.md`, `data-model.md`, `contracts/interaction.md`, `contracts/layout-protocol.md`, `contracts/clipboard.md`, and `quickstart.md`.

**Prerequisites**: Existing released 001 editor and Constitution 1.1.0. Extend the TypeScript/Angular workspace and native document pipeline; use the current checkout and existing dependencies.

**Tests**: Required by FR-027 and the specification's acceptance matrix. Write the story's applicable regression tests first, observe the expected failure, then implement and pass them. Installed/timed evidence is a separate completion gate.

**Organization**: Setup → foundation → US1 (P1) → US2 (P1) → US5 (P1) → US3 (P2) → US4 (P2) → cross-cutting acceptance. Story numbers retain their specification identities; P1 stories precede P2 stories.

## Format: `[ID] [P?] [Story] Description`

- Every task has an unchecked checkbox, sequential ID and exact repository-relative paths.
- `[P]` means a task can run alongside another ready task touching different files, after the prerequisites stated for its phase or batch. It never overrides a dependency.
- `[USn]` appears only in user-story phases. Shared prerequisites and final acceptance have no story label.
- Paths naming new helpers/tests are intended additions, not claims that those files already exist. Keep helpers small and within existing package boundaries; update explicit exports/imports and all consumers when changing contracts.
- `vendor/` is read-only. Use the existing targeted MS-RDL citations in `baseline-analysis.md` and `research.md`; discover individual reference sections only when a concrete semantic question remains.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish reproducible tooling and reusable acceptance inputs without replacing the editor or adding dependencies.

- [X] T001 Validate Node >=24.15.0 <25 and pnpm 11.28.2 against `.node-version` and `package.json`, run `pnpm install --frozen-lockfile`, and record baseline lint/typecheck/unit/roundtrip/compatibility/build results in `specs/002-interactive-visual-designer/checklists/implementation.md` so pre-existing failures are distinguished from regressions.
- [X] T002 Create `tests/fixtures/interactive/mixed.rdlc`, `tests/fixtures/interactive/optional-geometry.rdlc`, and `tests/fixtures/interactive/clipboard-dependencies.rdlc` covering mixed body textboxes/grouped tables, overlapping ZIndex, locked/unknown-bounds neighbors, implicit/expression dimensions, mixed units, safe foreign metadata and internal/external dependencies; register provenance and applicable MS-RDL sections in `tests/fixtures/manifest.json` while retaining the existing at-least-12-file corpus.
- [X] T003 [P] Create the FR-001–FR-027/SC-001–SC-008 coverage and evidence skeleton in `specs/002-interactive-visual-designer/checklists/implementation.md` after T001, linking each requirement to the tasks below, fixture paths, automated checks and pending installed/timed evidence in `docs/validation/interactive-designer.md` without marking unexecuted acceptance as passed.

**Checkpoint**: Tooling works, baseline failures are recorded, and reusable fixture/provenance inputs exist.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish correct geometry, body/table identity, strict atomic transport and lexical patch composition before story implementation.

**Blocking gate**: Finish T004–T013 before any user-story implementation. Tests in this phase must fail for the intended missing behavior before the corresponding implementation.

- [X] T004 [P] Add unit/formatting tests in `packages/report-model/src/geometry.test.ts` for pt/pc/in/mm/cm, pt↔96px/in conversion, mixed source spellings, tiny positive dimensions, missing versus expression-valued properties and ≤0.01pt error without positive-to-zero rounding.
- [X] T005 [P] Add scene tests in `packages/renderer/src/render.test.ts` and `packages/renderer/src/tables.test.ts` for container-derived missing textbox sizes, explicit/derived/unknown bounds, table-frame versus cell identity, effective ZIndex/source ties, obscured placeholders and unknown bounds without invented rectangles.
- [X] T006 Implement shared pure parsing/conversion/unit-preserving formatting in `packages/report-model/src/geometry.ts` and reuse it from `packages/renderer/src/geometry.ts`; enforce "Coordinates must be finite, positions ≥ 0 and dimensions > 0" and "Preserve explicit units on changed properties; leave unchanged lexemes byte-for-byte", with "≤ 0.01pt error and positive quantization"; preserve existing package subpath imports through `packages/report-model/package.json`.
- [X] T007 Extend accepted scene geometry/identity contracts in `packages/report-model/src/scene.ts` and the projection inputs in `packages/xml-parser/src/project-textboxes.ts` and `packages/xml-parser/src/project-tables.ts` only as needed: "Version-scoped source node ID; body textbox, table frame or preservation-only item. Cells retain a distinct parent-table relation"; carry "Container order and parsed drawing priority, default zero; used for hit order, not XML reorder", "exact explicit source spellings/units and explicit/derived/unknown provenance per property", and "Per-property and per-operation eligibility with an affected construct/reason"; invalid/source-only projections cannot visually mutate.
- [X] T008 Correct accepted bounds and scene ordering in `packages/renderer/src/render.ts`, `packages/renderer/src/tables.ts`, and `packages/renderer/src/index.ts`: "Missing textbox width/height derives from container width/height minus Left/Top"; "A required unknown dimension disables dependent operations only"; "Placeholder entries without valid bounds remain in the item list without hit rectangles"; expose whole-body table frames alongside parent-linked cells and use real source order/effective ZIndex without XML changes.
- [X] T009 [P] Add closed layout/action/result validation tests in `apps/vscode-extension/src/protocol.test.ts` for move, resize, align and distribute payloads; malformed/duplicate IDs, unknown keys, invalid enums/units/numbers and message budgets; verify old scalar intents remain accepted and base/result versions, changed/no-op status and identity mappings validate strictly.
- [X] T010 Extend `EditIntent` in `packages/report-model/src/editing.ts`, shared envelope/scene validators in `packages/report-model/src/protocol.ts`, and host binding in `apps/vscode-extension/src/protocol.ts` with protocol-1 layout actions and correlated outcomes from `contracts/layout-protocol.md`; require "Native monotonically changing version; every mutation targets an exact base version", request IDs and complete bounded target sets, one of eight resize handles, six align modes, valid axes/units and primary membership; retain 64 KiB/8 MiB limits and forbid raw patches/XML/paths.
- [X] T011 [P] Add patch-composition regressions in `packages/xml-serializer/src/patches.test.ts` for several absent properties inserted at one offset, deterministic ordering, overlapping-edit refusal, stale plans and unioned namespace dependencies; assert exact outside-footprint equality and unchanged no-op source spelling.
- [X] T012 Normalize compound scalar patches in `packages/xml-serializer/src/patches.ts` and `packages/xml-serializer/src/structure.ts`, reusing namespace-aware primitives from `packages/xml-serializer/src/textboxes.ts`; coalesce legal same-offset insertions deterministically, preserve every namespace dependency, reject overlaps and expose one complete `PatchPlan` against the original source.
- [X] T013 Extend correlated result production through `apps/vscode-extension/src/edit-controller.ts` and `apps/vscode-extension/src/document-session.ts`, with regression assertions in `apps/vscode-extension/src/edit-controller.test.ts`: "Mapping entries refer only to source IDs in the base version and candidate IDs in the result version; deleted members have no surviving ID"; return actual accepted/result version and geometric no-op without `WorkspaceEdit`, retain one per-document apply queue, version/duplicate guards and candidate-equality checks, and keep existing scalar/public command callers compatible.

**Checkpoint**: Geometry is trustworthy; model/protocol/renderer/serializer tests pass; existing scalar editing still works. Host and designer contracts can carry atomic operations and proven identities.

## Phase 3: User Story 1 — Position and Size Items Directly (Priority: P1) — MVP

**Goal**: Drag supported body items and resize textboxes/tables from eight handles, with one host-validated native edit per accepted gesture.

**Independent test**: Open the mixed fixture, diagonally drag a textbox, resize its top-left corner, then move/resize the whole grouped table. Exercise every handle, Undo/Redo once per accepted operation, and save/reopen. Assert fixed edges, proportional table sizes, correct properties, retained selection and exact unrelated XML. Cancel/refuse/no-op must leave text and history unchanged.

### Tests for User Story 1

- [X] T014 [P] [US1] Add direct-layout tests in `apps/vscode-extension/src/edit-controller.test.ts` and `apps/vscode-extension/src/verify-candidate.test.ts` for all eight textbox/table handles, safe moves, implicit-size materialization, mixed units, totals, fixed edges, positive quantization, overflow, no-op and all-or-nothing capability refusal; reject candidates with wrong geometry or altered unrelated bindings/hierarchy even inside an allowed parent footprint.
- [X] T015 [P] [US1] Add pointer/selection-continuity tests in `apps/designer/src/app/editor/editor.component.spec.ts` and `apps/designer/src/app/editor/lifecycle.spec.ts` for 3-CSS-pixel click threshold, eight handles, immutable origins, invalid preview, pointer capture/release, cancellation, native Undo during preview, pending mutation lock, same-version snapshots and both snapshot/result delivery orders.
- [X] T016 [P] [US1] Add lexical direct-manipulation regressions in `tests/roundtrip/interactive.test.ts` covering optional properties, preserved unknown children, prefixed/rebound namespaces, CDATA/entities/comments/processing instructions, mixed units and CRLF/LF; compare exact no-op and outside-footprint text and intended-only changes within edited nodes.

### Implementation for User Story 1

- [X] T017 [US1] Implement host-derived single-item move/resize eligibility and geometry in `packages/validation/src/layout.ts` and `apps/vscode-extension/src/edit-controller.ts`; preserve table/cell distinction and safe unrelated property capabilities, refuse unknown-dependent axes, nonnegative-position/positive-size failures and inconsistent profiles, and report blocking target plus corrective action without clamping or implicitly resizing body/page.
- [X] T018 [US1] Implement complete textbox geometry plans in `packages/xml-serializer/src/layout.ts` using `packages/xml-serializer/src/textboxes.ts` and `packages/xml-serializer/src/structure.ts`; detect geometric no-op before formatting and enforce "For implicit textbox size, movement inserts only dimensions required to preserve the original accepted size, in the chosen display unit (pt by default)" while changing only intended edges/properties.
- [X] T019 [US1] Extend dedicated compound table planning in `packages/xml-serializer/src/tables.ts` and `packages/xml-serializer/src/layout.ts` to scale all affected rows/columns including totals, synchronize existing explicit outer sizes in their original units, keep absent outer dimensions derived and north/west opposite edges fixed, and use deterministic last-component residuals with positive proportional results; do not loop over scalar row/column setters.
- [X] T020 [US1] Wire one complete layout plan through `apps/vscode-extension/src/edit-controller.ts`, `apps/vscode-extension/src/verify-candidate.ts`, and `apps/vscode-extension/src/document-session.ts`; prove intended positions/dimensions, fixed edges, table sums/proportions and unchanged metadata/content, then verify/apply once under the existing versioned native queue and return parsed source-correspondence mappings rather than scene ordinals.
- [X] T021 [US1] Extend `apps/designer/src/app/editor/host-adapter.ts` with base/result version, changed status and target mapping retention plus one pending mutation coordinator: "Result/snapshot delivery may arrive in either order; resolve by request and version rather than arrival order"; handle repeated snapshots idempotently, later independent versions authoritatively and refusals without retry; preserve existing authoring senders.
- [X] T022 [US1] Add small pure direct-gesture calculations in `apps/designer/src/app/editor/manipulation.ts` using shared point conversion; retain "Immutable accepted version, members, primary and starting geometry", a "Pointer report-space anchor or original keydown state, independent of subsequent zoom/scroll", proposed axes/guides/warnings, blocking-target validity and a request ID created only at submission; keep "Starting bounds stay immutable during a gesture to avoid cumulative drift".
- [X] T023 [US1] Integrate single-body-item selection and move/eight-handle previews in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html`, and `apps/designer/src/app/editor/editor.component.scss`; use pointer capture, thresholded motion, accepted property routing, labeled handles/geometry, valid-release-only submission and nonblocking overflow warnings; retain existing table-cell selection and numerical resize controls.
- [X] T024 [US1] Complete cancellation/native command handling in `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/host-adapter.ts`: implement "idle → preview → pending → idle", "cancellation/refusal/no-op returns to idle with no native edit", "Pending state accepts no overlapping mutation, and never retries against a new version"; cancel on Escape, capture/focus loss, pointer cancellation or independent version with explanation, and cancel preview before native Undo/Redo while Save observes accepted state only.
- [X] T025 [US1] Add native direct-manipulation checks in `tests/vscode/lifecycle.test.ts` and `tests/vscode/synchronization.test.ts` proving single-step compound Undo/Redo, save-during-preview isolation, stale split-view submission refusal, duplicate request protection, read-only/native apply refusal and exact restored source without compensating overwrite of independent changes.
- [X] T026 [US1] Run focused model/renderer/serializer/controller/designer/roundtrip tests and the built native US1 scenarios using commands in `specs/002-interactive-visual-designer/quickstart.md`; record command outcomes and the direct-manipulation independent-test result in `specs/002-interactive-visual-designer/checklists/implementation.md` before declaring the MVP checkpoint passed.

**Execution evidence**: [Phase 3 validation record](../../docs/validation/interactive-designer.md#direct-manipulation-evidence-t014t026). Command outcomes are recorded there because checklist files are read-only under the implementation execution instructions. Automated US1 checks are complete; manual installed pointer/keyboard, cross-platform and timed acceptance remains explicitly pending.

**Checkpoint**: US1 is independently usable and safe. US5 later completes the broader draft/limitation/workflow acceptance; those obligations remain required for the full feature.

## Phase 4: User Story 2 — Arrange Several Items Together (Priority: P1)

**Goal**: Ordered multi-selection with primary identity, whole-selection moves, six alignments and two distributions; no partial mutation.

**Independent test**: Select two textboxes and a table through click, Shift-toggle, marquee and item-list controls. Group move, align left and distribute three nonoverlapping items; test all modes/axes and primary changes. A locked member or negative-gap distribution refuses the entire operation. One Undo restores each group command.

### Tests for User Story 2

- [X] T027 [P] [US2] Add ordered-selection/marquee tests in `apps/designer/src/app/editor/selection.spec.ts` and selection integration cases in `apps/designer/src/app/editor/editor.component.spec.ts` for primary promotion, exclusive cell mode, Select All including placeholders, complete-bound enclosure, Shift additions in source order, blank/Escape clear, obscured-item list access and unchanged XML.
- [X] T028 [P] [US2] Add bulk-layout tests in `packages/validation/src/layout.test.ts` and `tests/roundtrip/arrangement.test.ts` for identical group displacement, all six primary-relative alignments, both axis distributions, source-order ties, fixed outer anchors, preserved sizes/relative offsets, two-item/negative-gap refusal, one invalid or locked member and exact whole-selection no-op/footprints.

### Implementation for User Story 2

- [X] T029 [US2] Implement ordered version-local selection in `apps/designer/src/app/editor/selection.ts` and integrate it in `apps/designer/src/app/editor/editor.component.ts`: enforce "`version`, ordered unique `bodyItemIds`, `primaryId` (member or null), or an exclusive `cellTargetId`", "The primary is the last newly added member; removal promotes the last remaining member" and "Membership can include locked placeholders; operation eligibility is the intersection for all selected members, with reasons rather than a filtered subset".
- [X] T030 [US2] Add Shift-toggle, marquee, Select All/clear and accessible list membership controls in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html`, and `apps/designer/src/app/editor/editor.component.scss`; hit-test descending effective ZIndex/later source ties, marquee only wholly enclosed known body bounds, announce count/primary and use list/source access for unknown or obscured bounds without exposing cell-local bulk geometry.
- [X] T031 [US2] Extend host-authoritative multi-target geometry in `packages/validation/src/layout.ts` and `apps/vscode-extension/src/edit-controller.ts` for common displacement, six align modes relative to the primary and >=3-target distribution sorted by axis/source order; keep outer anchors, reject negative gaps/invalid members before any plan, ignore snapping for explicit commands and reuse the single complete plan/verification path.
- [X] T032 [US2] Extend `packages/xml-serializer/src/layout.ts` and `apps/vscode-extension/src/verify-candidate.ts` to compose all selected geometry against one original source and verify whole-set offsets, unchanged sizes, primary alignment/distribution constraints, implicit-size preservation and unchanged parent/source order; return ordered survival mappings for every selected member in one native result.
- [X] T033 [US2] Wire multi-item drag preview, primary/count/bulk toolbar and whole-set eligibility reasons in `apps/designer/src/app/editor/manipulation.ts`, `apps/designer/src/app/editor/editor.component.ts`, and `apps/designer/src/app/editor/editor.component.html`; hide single-target mutation forms during multi-selection, retain mappings only at the matching result version and expose no multi-selection resize handles.
- [X] T034 [US2] Extend native selection/arrangement checks in `tests/vscode/lifecycle.test.ts` and `tests/vscode/synchronization.test.ts` to prove one complete Undo/Redo for mixed textbox/table move, alignment and distribution, selection survival after acceptance and zero text/undo changes for a locked/invalid member or stale group submission.
- [X] T035 [US2] Run selection/designer, bulk validation/controller, arrangement roundtrip and built native arrangement checks, then record all independent-test modes and refusals in `specs/002-interactive-visual-designer/checklists/implementation.md`.

**Execution evidence**: [Phase 4 validation record](../../docs/validation/interactive-designer.md#selection-and-arrangement-evidence-t027t035). Checklist files remain read-only; T035 command outcomes and the automated independent scenario are recorded in the validation document. Installed manual pointer/keyboard and cross-platform acceptance remain pending.

**Checkpoint**: US1 and US2 work independently; every group command is all-or-nothing and preserves logical selection.

## Phase 5: User Story 5 — Understand Limits and Keep Existing Workflows (Priority: P1)

**Goal**: Explicit limitations/source access, trustworthy property drafts, safe independent-change reconciliation, native lifecycle and keyboard/focus feedback.

**Independent test**: Open supported/unsupported mixed content, rich text and expression geometry. Confirm truthful placeholders/list entries and source access, reuse existing single-target/table/cell forms, exercise draft Apply/Discard/Cancel, edit source in another view during preview/pending, and simulate Save/apply failure. Accepted unsaved content survives and keyboard focus remains usable.

### Tests for User Story 5

- [X] T036 [P] [US5] Add property-draft/focus/limitation regressions in `apps/designer/src/app/editor/editor.component.spec.ts`, `apps/designer/src/app/editor/lifecycle.spec.ts`, and `apps/designer/src/app/authoring/authoring.component.spec.ts` for draft dirtiness before blur, Apply/Discard/Cancel on selection/gesture changes, independent invalidation, source access, table/cell routing, locked capabilities and usable focus/live announcements after acceptance/refusal.
- [X] T037 [P] [US5] Extend `tests/vscode/persistence.test.ts` and `tests/vscode/synchronization.test.ts` for failed Save/Save As, close cancellation, encoding/EOL retention, own result/snapshot permutations, uncertain native apply and independent changes with ambiguous identities; assert previously accepted unsaved work survives and stale drafts/targets never replay.

### Implementation for User Story 5

- [X] T038 [US5] Add explicit draft tracking and Apply/Discard/Cancel coordination to `apps/designer/src/app/properties/textbox-properties.component.ts`, `apps/designer/src/app/tables/table-properties.component.ts`, and `apps/designer/src/app/tables/groups-totals.component.ts`; coordinate existing immediate change/blur behavior so a conflicting selection/gesture cannot silently overwrite or commit a draft and applying waits for the accepted snapshot before a fresh action.
- [X] T039 [US5] Route draft-conflicting authoring/selection/pointer actions through `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/authoring/authoring.component.ts`, and `apps/designer/src/app/editor/host-adapter.ts`; Cancel retains the draft/action state, Discard explicitly abandons it, Apply submits once, pending blocks mutation and independent versions invalidate stale drafts with notice.
- [X] T040 [US5] Finish accepted/independent selection reconciliation in `apps/designer/src/app/editor/selection.ts` and `apps/designer/src/app/editor/host-adapter.ts`: "Apply that mapping only to the matching snapshot; ordinal carry-over is forbidden" and "Independent changes/Undo/Redo may reconcile only an unambiguous structural identity (unique item name, kind and parent relationship); otherwise clear with notice. Name alone is not a durable ID"; discard outdated mappings rather than retargeting a newer version.
- [X] T041 [US5] Complete limitation/capability presentation and source navigation in `apps/designer/src/app/editor/editor.component.html`, `apps/designer/src/app/editor/editor.component.ts`, and `apps/designer/src/app/diagnostics/diagnostics.component.ts`; identify construct and refusal reason, keep unknown-bounds content in the list, suppress unsupported handles, expose existing table versus cell controls and retain safe unrelated property editing with authoritative property/canvas agreement.
- [X] T042 [US5] Add labeled keyboard-reachable actions, visible focus, selection/pending/invalid/limitation live status and focus return in `apps/designer/src/app/editor/editor.component.html` and `apps/designer/src/app/editor/editor.component.scss`; preserve numerical property resize and item-list marquee equivalents, and ensure existing forms and native commands retain their normal focus/editing behavior.
- [X] T043 [US5] Complete native failure/state publication integration in `apps/vscode-extension/src/document-session.ts` and `apps/designer/src/app/editor/host-adapter.ts` for refusal/read-only/uncertain apply and independent changes: publish actual accepted state, retain existing Save/Save As/conflict/dirty semantics and accepted unsaved content, never retry stale requests or overwrite independent content as compensation.
- [X] T044 [US5] Extend profile/regression tests in `tests/compatibility/textboxes.test.ts` and `tests/compatibility/tables.test.ts` to show unsupported neighbors do not block safe geometry, expression-valued properties remain unevaluated/locked only where dependent, preservation-only constructs never gain authoring rights and baseline textbox/dataset/table/group commands remain available within their existing profile.
- [X] T045 [US5] Run property/designer/authoring, compatibility and built persistence/synchronization checks; exercise the independent mixed-content/draft/failure scenario and record results in `specs/002-interactive-visual-designer/checklists/implementation.md`.

**Checkpoint**: All P1 stories are accepted; limitations, property drafts and document lifecycle are consistent across pointer and existing workflows.

## Phase 6: User Story 3 — Navigate and Place with Precision (Priority: P2)

**Goal**: Independent-of-zoom manipulation, navigable overflow, per-view preferences, deterministic grid/guides and atomic keyboard nudging.

**Independent test**: At 25%, 50%, 100%, 200% and 400%, with scrolling and nondefault display scaling, reveal an offscreen item, nudge 1pt/10pt, snap to sibling/grid, resize and compare report-space results within 0.01pt. Verify all navigation leaves content/history unchanged, 100 forward/backward nudges drift ≤0.01pt, held-key release commits once and forms retain normal keyboard behavior.

### Tests for User Story 3

- [ ] T046 [P] [US3] Add pure viewport tests in `apps/designer/src/app/editor/viewport.spec.ts` for client/scroll/body-origin conversion, toolbar-center and pointer-anchor zoom, 25–400% fit clamping, overflow reveal, panning and edge auto-scroll without anchor drift; ensure device-pixel ratio is not applied twice.
- [ ] T047 [P] [US3] Add pure placement tests in `apps/designer/src/app/editor/placement.spec.ts` for body-origin grid snapping/ties, union-top-left moves and dragged-edge resize snapping, selected/unknown exclusion, guide priority/ties/6-CSS-pixel tolerance across zoom, independent visibility/snapping settings and Alt bypass.
- [ ] T048 [P] [US3] Add navigation/preference/nudge integration cases in `apps/designer/src/app/editor/editor.component.spec.ts` and `apps/designer/src/app/editor/lifecycle.spec.ts` for validated webview restore, independent views, no XML/undo changes, exact arrows/Shift+arrows ignoring snapping, repeat aggregation/cancellation and normal input/clipboard shortcut isolation.

### Implementation for User Story 3

- [ ] T049 [US3] Implement pure viewport transforms/extent/fit/reveal calculations in `apps/designer/src/app/editor/viewport.ts`, using shared point/CSS-pixel conversions and the contract's single client→scroll→body-origin conversion; preserve immutable report anchors, clamp zoom only to 25–400%, keep overflow reachable and never modify report bounds.
- [ ] T050 [US3] Add validated view-state get/set through `apps/designer/src/app/editor/host-adapter.ts` and viewport helpers: "Per view: zoom in [0.25, 4], scroll offsets, display unit in {pt, pc, in, mm, cm}, positive finite grid spacing with unit, grid visibility/snapping and guide visibility/snapping"; "Defaults: zoom 1, pt, 10pt and all visibility/snapping enabled"; "No document version/undo coupling, persistence to XML or cross-view sharing"; reject invalid restored values and retain the last valid grid setting with explanation.
- [ ] T051 [US3] Integrate scrollable/transformed authoring surface, numeric zoom/in/out/100%, Fit Page/Body, Reveal Selection, pointer zoom and Space+drag pan in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html`, and `apps/designer/src/app/editor/editor.component.scss`; preserve center or pointer anchors as appropriate, selection/focus and the authoring-not-runtime label.
- [ ] T052 [US3] Implement edge auto-scroll in `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/manipulation.ts`, updating scroll before recomputing the same pointer anchor, continuing captured valid manipulation outside the viewport and cancelling on capture/focus/version loss without committing an invalid release.
- [ ] T053 [US3] Implement deterministic grid/guide selection in `apps/designer/src/app/editor/placement.ts`: "Eligible targets exclude selected items and unknown bounds. Threshold is 6 CSS pixels; tie order is nearest distance, body boundary, earlier source order, smaller coordinate"; include "Axis, target body/sibling identity, source order, target edge/center, report coordinate, proposed moving edge/center and screen distance"; use smaller-coordinate grid ties and per-axis nearest-guide precedence over grid with visibility independent of snapping.
- [ ] T054 [US3] Wire grid spacing/unit/display-unit inputs, four independent toggles, visible labeled guide/grid overlays and held-Alt bypass into `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html`, and `apps/designer/src/app/editor/editor.component.scss`; apply move snapping to the union top-left and resize snapping only to dragged edges without changing preferences or explicit align/distribute behavior.
- [ ] T055 [US3] Add canvas-scoped arrow/Shift+arrow nudge handling in `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/manipulation.ts`; accumulate exact 1pt/10pt deltas from original accepted geometry, ignore snapping, commit a discrete press once or a held sequence once on keyup, preserve accepted selection and cancel repeats on Escape/focus/version loss; do not intercept editable inputs or unrelated VS Code contexts.
- [ ] T056 [US3] Add zoom/unit/nudge numerical regressions in `tests/roundtrip/precision.test.ts` and `apps/designer/src/app/editor/viewport.spec.ts` proving equivalent report-space drag/resize/nudge at required zooms, scroll offsets and display scales, exact changed-unit retention, ≤0.01pt per value and ≤0.01pt drift after 100 forward/backward nudges.
- [ ] T057 [US3] Extend `tests/vscode/lifecycle.test.ts` and `tests/vscode/synchronization.test.ts` to prove held-repeat single native Undo, consecutive nudge selection retention, zero navigation dirty/history changes, independent view preferences and cancellation before native Undo/Redo or an independent source edit.
- [ ] T058 [US3] Verify keyboard controls and status/focus behavior for every new navigation/placement action in `apps/designer/src/app/editor/editor.component.spec.ts`, including invalid grid input retaining its previous setting, reachable overflow, field arrow isolation and no focus traps after refusal.
- [ ] T059 [US3] Run viewport/placement/designer/precision/native checks and record the independent-test zoom, display-scaling, snapping and 100-nudge results in `specs/002-interactive-visual-designer/checklists/implementation.md`.

**Checkpoint**: Precision/navigation works without changing report semantics, unit fidelity or native history boundaries.

## Phase 7: User Story 4 — Reuse Items without Losing Content (Priority: P2)

**Goal**: Same-window copy/cut/paste and clipboard-independent duplicate of complete supported subtrees with provable identities, namespaces, dependencies and atomic native edits.

**Independent test**: Copy/duplicate a textbox with classified safe foreign metadata, then a grouped table and mixed selection. Verify nested unique names, internal remapping, external dependency preservation, complete lexical metadata, 10pt/20pt repeated offsets, selected/revealed copies and unchanged clipboard on Duplicate. Transfer to a compatible open report; reject incompatible datasets/scopes/namespaces/opaque dependencies and clipboard failures without partial effects. One Undo exactly restores each accepted cut/paste/duplicate.

### Tests for User Story 4

- [ ] T060 [P] [US4] Add typed reference/identity tests in `packages/expressions/src/analyze.test.ts` and `packages/expressions/src/references.test.ts` for ReportItems operands, Sum dataset/group/data-region scopes, ToggleItem/RepeatWith/scalar bindings, literal lookalikes, entity/CDATA/raw lexical correspondence, Unicode names and opaque/dynamic/custom-code refusal without expression evaluation.
- [ ] T061 [P] [US4] Add insertion/removal policy tests in `packages/validation/src/clipboard.test.ts` and `packages/validation/src/datasets.test.ts` for complete removal sets, internal versus outside references, nested item/cell/group collisions, safe metadata classification versus opaque identity extensions, same-name incompatible field definitions/types/scopes and positive compatible cross-document reuse.
- [ ] T062 [P] [US4] Add preserved-subtree tests in `tests/roundtrip/clipboard.test.ts` for source-order capture, local namespace closure/rebinding/default/unprefixed attributes, missing/self-closing destination ReportItems, exact untouched lexical content, intended-only identity/reference/geometry changes and inserted-subtree semantic verification as well as outside-footprint equality.
  Include first/repeated same-body Paste, Duplicate and cross-document Paste into differently sized bodies for textboxes with omitted Width/Height. Assert captured physical size within 0.01pt, necessary-only dimension materialization in destination display units, preserved explicit size lexemes and exact Undo restoration. Use the positive/negative metadata examples in `contracts/clipboard.md` for T061/T062, including literal reference-looking annotation text that must not be rewritten.
- [ ] T063 [P] [US4] Add clipboard protocol/host orchestration tests in `apps/vscode-extension/src/protocol.test.ts` and `apps/vscode-extension/src/clipboard.test.ts` for exact token/message keys, budgets/version/window/capture identity, copy/cut await races, concurrent views/replacement, source closure/reload, read/write failure, duplicate guards, transient Duplicate and successful-only per-view paste counts.

### Implementation for User Story 4

- [ ] T064 [US4] Extend capture/reference contract types in `packages/report-model/src/expressions.ts` and `packages/report-model/src/clipboard.ts` with "complete selected XML subtrees in source order, their original point geometry, namespace environments, item/group identity declarations, understood reference spans and external dependency descriptors"; record schema/profile/format version and "one or more roots; a table root includes its cells/groups"; keep the capture an immutable host snapshot, not live source IDs or webview XML.
- [ ] T065 [US4] Extend bounded analysis in `packages/expressions/src/analyze.ts` and add narrow operand-to-raw correspondence in `packages/expressions/src/references.ts`, using `packages/report-model/src/syntax.ts` ranges and `packages/xml-parser/src/project-datasets.ts` inputs as needed; distinguish item/group/data-region/dataset identities, map only proven exact operands through entities/CDATA/whitespace, retain literals and refuse unsupported/ambiguous dependency rewriting without adding an expression evaluator or general grammar.
- [ ] T066 [US4] Implement typed declaration/name allocation and destination compatibility in `packages/validation/src/clipboard.ts`, reusing validation from `packages/validation/src/textboxes.ts` and `packages/validation/src/tables.ts`; reserve existing and new report-item/cell/group names together, generate deterministic valid case-sensitive generic-prefix names, map copied internal identities and validate retained external kinds/scopes plus identical required dataset field definitions/types without creating or changing resources.
- [ ] T067 [US4] Extend whole-removal-set guards in `packages/validation/src/datasets.ts` and clipboard policy in `packages/validation/src/clipboard.ts`: "Opaque potential references/identities carry an explicit uncertainty reason and prevent unsafe identity-changing insertion or removal"; exclude all removed roots when checking remaining known/opaque references, allow references wholly inside the removed set, require existing `delete-contained-content` acknowledgement once and do not reject Copy solely for outside references to surviving originals.
- [ ] T068 [US4] Implement immutable capture and semantic metadata classification in `apps/vscode-extension/src/clipboard.ts` using exact source slices/namespace environments and typed dependency proof; document explicitly proven identity-independent metadata in `specs/002-interactive-visual-designer/contracts/clipboard.md`, preserve it byte-for-byte and refuse unclassified identity/dependency-bearing extensions with corrective advice while leaving unrelated geometry editing available.
  Implement the contract's existing minimal `{urn:rdlc-code:extension}Opaque` text-only/`keep="1"` classification by expanded name and exact shape, not namespace-only trust. Refuse extra attributes, nested elements, processing instructions and unclassified `rd:DefaultName`; do not infer insertion safety from existing preservation fixtures or add classifications without documented semantics and regression cases.
- [ ] T069 [US4] Implement lossless fragment transformation/insertion/removal planning in `packages/xml-serializer/src/clipboard.ts`, reusing `packages/xml-serializer/src/structure.ts` and geometry primitives; change only allocated identities, understood references, offsets and necessary root-local namespace declarations, preserve internal rebinding/relative source order, support missing/self-closing ReportItems and build one complete candidate with no full report serialization or create-item reconstruction.
  Carry captured physical root sizes/provenance through T064/T068. Preserve those sizes after insertion offsets and destination body changes, inserting missing textbox dimensions only when necessary in the destination display unit; refuse unprovable required bounds. T070 must independently verify resulting sizes against the capture, including necessary-only materialization, not merely compare against the planner's transformed XML.
- [ ] T070 [US4] Extend `apps/vscode-extension/src/verify-candidate.ts` and `apps/vscode-extension/src/verify-candidate.test.ts` to compare every inserted subtree to its capture transformation, expanded-name/namespace meaning and resolved identity/dependency graph, plus exact outside-footprint and intended-only affected-parent changes; reject corruption that generic untouched-node/footprint checks would miss and prove complete removal-set restoration expectations.
- [ ] T071 [US4] Add closed `clipboard` requests and correlated `clipboardResult` variants to `packages/report-model/src/protocol.ts`, `apps/vscode-extension/src/protocol.ts`, and `apps/designer/src/app/editor/host-adapter.ts`; enforce action-specific selection/acknowledgement/version fields, document binding, duplicate protection and result mappings, distinguish nonmutating Copy from mutation outcomes and keep XML/manifests off the bridge.
- [ ] T072 [US4] Implement window-owned capture retention/native token I/O in `apps/vscode-extension/src/clipboard.ts` and wire ownership/disposal in `apps/vscode-extension/src/extension.ts` and `apps/vscode-extension/src/editor-provider.ts`; validate exact `rdlc-code/items` version-1 envelope/window/capture IDs, 1 KiB UTF-8 token and 8 MiB UTF-8 total retained payload including namespaces/dependencies, retain one capture without disk storage and serialize replacements across views; preserve 16 MiB/100,000-element/depth-256 XML and existing bridge budgets.
- [ ] T073 [US4] Integrate Copy/Cut orchestration in `apps/vscode-extension/src/clipboard.ts` and `apps/vscode-extension/src/document-session.ts`: validate insertion-safe capture and complete Cut removal before native clipboard write, install usable capture/generation after successful write, recheck source/version after every await, then submit Cut through one native queue/apply; write failure/stale source removes nothing and a failed post-write cut may retain the usable capture.
- [ ] T074 [US4] Integrate Paste/Duplicate orchestration in `apps/vscode-extension/src/clipboard.ts`, `apps/vscode-extension/src/edit-controller.ts`, and `apps/vscode-extension/src/document-session.ts`; resolve/revalidate immutable captures against the current destination, use transient capture for Duplicate, verify/apply one complete candidate and return inserted/removed mappings; enforce "next offset is `(successfulPastes + 1) * 10pt` on both axes; new copy/cut resets generation, failure does not advance, duplicate is always 10pt and leaves clipboard untouched" per destination view.
- [ ] T075 [US4] Add labeled Copy/Cut/Paste/Duplicate controls and canvas-only platform shortcuts to `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/editor.component.html`; use Ctrl/Cmd+C/X/V and Ctrl/Cmd+D, whole-body selection eligibility, existing contained-content acknowledgement and draft/pending guards; select mapped inserted roots and Reveal Selection after acceptance, announce refusal/failure and leave field editing untouched.
- [ ] T076 [US4] Add designer clipboard integration tests in `apps/designer/src/app/editor/editor.component.spec.ts` and `apps/designer/src/app/editor/lifecycle.spec.ts` for shortcut isolation, cell/locked refusal, pending/draft conflicts, 10pt/20pt successful-only offsets, capture-generation reset, selected/revealed inserted copies and clipboard-unchanged Duplicate.
- [ ] T077 [US4] Extend clipboard fixtures in `tests/fixtures/interactive/clipboard-dependencies.rdlc`, add `tests/fixtures/interactive/clipboard-namespaces.rdlc` and `tests/fixtures/interactive/clipboard-opaque.rdlc`, and update `tests/fixtures/manifest.json` with provenance/MS-RDL citations; cover positive classified foreign metadata, Unicode/nested naming, raw entity/CDATA references, compatible/incompatible scopes/fields and opaque refusal across the lexical corpus.
  Include the exact minimal metadata classification's positive and refusal variants from `contracts/clipboard.md`; positive annotations must not carry unrelated unclassified metadata. Reuse `tests/fixtures/interactive/optional-geometry.rdlc` for omitted-dimension clipboard cases with differently sized destination bodies.
- [ ] T078 [US4] Add native same/cross-document clipboard checks in `tests/vscode/clipboard.test.ts` and race cases in `tests/vscode/synchronization.test.ts` for source-close snapshot reuse, concurrent views, stale capture/source, foreign/plain-text/oversized tokens, read/write failure, refused Cut, unchanged Duplicate clipboard and exact one-step Undo/Redo for complete cut/paste/duplicate without partial source/destination changes.
- [ ] T079 [US4] Run expression/validation/serializer/controller/protocol/designer, clipboard roundtrip and built native clipboard checks; execute positive compatible cross-document reuse as well as every refusal class, and record the independent-test results in `specs/002-interactive-visual-designer/checklists/implementation.md` so universal refusal cannot count as supported reuse.

**Checkpoint**: Complete subtree reuse is independently accepted, with affirmative preservation/dependency proof and precise refusal behavior.

## Phase 8: Polish & Cross-Cutting Acceptance

**Purpose**: Prove the complete acceptance matrix and record new-feature evidence. Dependencies: all story checkpoints passed; test/evidence tasks marked `[P]` may then use separate files/environments.

- [ ] T080 Extend `tests/vscode/lifecycle.test.ts`, `tests/vscode/persistence.test.ts`, and `tests/vscode/synchronization.test.ts` with twenty consecutive mixed move/resize/group/align/distribute/nudge/cut/paste/duplicate operations followed by twenty native Undos and Redos; compare each complete expected source/selection state and verify rejected/stale/cancelled/no-op operations add zero steps, retaining save/close/read-only/encoding/EOL/multi-view coverage.
- [ ] T081 [P] Extend installed offline/inert-input coverage in `tests/package/offline.test.ts` and `tests/package/contents.test.ts` for every new workflow in trusted/untrusted local workspaces using the newly built VSIX; assert no report-triggered network/resource/data/code/expression execution, existing CSP/isolation and source access for unsupported content without adding web/remote/cross-window support claims.
- [ ] T082 [P] Extend `tests/performance/editor.test.ts` and add `tests/fixtures/interactive/performance-100.rdlc` with provenance in `tests/fixtures/manifest.json`; validate separate input→painted-feedback and submission→painted-authoritative-snapshot sample series at 100%/200%, including 20-item moves, ≤1 MiB/100 selectable items, complete environment/timing metadata and at least 95/100 samples meeting 50ms/200ms for every applicable series; use explicitly synthetic records only to test the evidence validator, not as acceptance evidence.
  Implement the installed-webview collector in `tests/performance/measure-interactive.ts` and its checks in `tests/performance/editor.test.ts`, following `quickstart.md`'s SC-005 collection protocol. Use same-webview monotonic input/submission timestamps, request/result-version correlation and Chromium presented-frame evidence with recorded clock alignment; DOM updates/host completion/animation callbacks alone are insufficient. Export raw timestamps, correlations and trace/frame references, verify wrong-version/missing-frame/clock-mismatch/invalid-duration/incomplete-series refusal, and document the runnable installed-driver invocation in `specs/002-interactive-visual-designer/quickstart.md`. T084 must consume actual collector exports and retain unresolved runs; synthetic records cannot satisfy acceptance.
- [ ] T083 Perform the installed keyboard-only and offline desktop scenarios from `specs/002-interactive-visual-designer/quickstart.md` using a newly built VSIX on Windows/macOS/Linux, recording results in `docs/validation/interactive-designer.md`; cover SC-006's selection/all alignments/distributions/nudge/precise sizing/clipboard/navigation/native commands with visible focus and no trap, normal form shortcuts, both workspace-trust modes and inert active content; explicitly leave unavailable platform evidence pending rather than claiming a pass.
- [ ] T084 Record actual reference-desktop performance and timed workflow evidence in `docs/validation/interactive-designer.md`: CPU/RAM/OS/display scaling/VS Code, candidate commit/VSIX/fixture, required 100-sample series at 100% and 200% including 20-item moves, and SC-001's selection→drag→corner resize→alignment→duplicate→save/reopen in ≤3 minutes without source edits or typed coordinates; retain failed/missing measurements as unresolved acceptance, separate from external RDLC runtime fidelity.
- [ ] T085 Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:roundtrip`, `pnpm test:compatibility`, `pnpm build`, `pnpm test:acceptance`, `pnpm test:vscode`, `pnpm package`, and `pnpm test:package` in the order documented by `specs/002-interactive-visual-designer/quickstart.md`, then `pnpm format:check`; record outcomes/artifact identity in `docs/validation/interactive-designer.md` and fix feature regressions while preserving the existing CI/release gates.
- [ ] T086 Reconcile every FR/SC and acceptance-matrix row against completed tests/evidence in `specs/002-interactive-visual-designer/checklists/implementation.md`, update author-facing interactive controls/shortcuts/boundaries in `README.md` and the final evidence status in `docs/validation/interactive-designer.md`; verify no vendor edits, dependency/profile expansion, second saved state or unproved runtime/release claim and leave no mandatory acceptance obligation silently waived.

**Checkpoint**: All automated checks pass and required installed/accessibility/offline/timed evidence is recorded. Missing real-desktop evidence blocks full feature acceptance even when automated suites pass.

## Dependencies & Execution Order

### Phase dependencies

```text
Setup T001–T003
  └─ Foundation T004–T013
       └─ US1 T014–T026 (P1, direct manipulation MVP)
            └─ US2 T027–T035 (P1, selection/arrangement)
                 └─ US5 T036–T045 (P1, workflow/limits)
                      ├─ US3 T046–T059 (P2, navigation/precision)
                      └─ US4 pure reference/policy/capture preparation T060–T070
                           └─ US4 integration T071–T079 (after US3 reveal/view-state support)
                                └─ Final acceptance T080–T086 (all stories)
```

- Setup: T001 precedes T003 (same checklist); T002 can proceed alongside baseline verification, and T003 can run alongside any remaining T002 fixture preparation. Foundation starts after all three setup tasks complete.
- Foundation: T004→T006; T006→T007→T008; T005 precedes T008. T009→T010; finalize scene validation in T010 after T007/T008. T011→T012. T013 depends on T010/T012 and trustworthy parsed identity/geometry. All are required before story implementation.
- US1: T014/T015/T016 can start together after foundation. T017→T018→T019→T020, with T021 ready after foundation/result tests; T022 consumes shared geometry; T023 depends on T017–T022; T024 completes cancellation/coordinator behavior; T025→T026 proves the integrated checkpoint. Draft conflict completion is explicitly in US5, not inferred from US1 acceptance.
- US2: Depends on US1's atomic layout and continuity. T027/T028 precede implementation; T029→T030; T031→T032; T033 joins both branches; T034→T035 validates. Tests can construct their own accepted fixture selections without another story's test state.
- US5: Depends on US1/US2 interaction routing. T036/T037 precede implementation; T038→T039; T040/T041/T042/T043 complete shared integration; T044→T045 validates existing workflows. This story extends shared editor/adapter files, so serialize those edits with other stories.
- US3: Depends on US1/US2/US5. T046/T047/T048 precede implementation; T049→T050→T051→T052; T053 consumes viewport conversions and precedes T054; T055 uses accepted selection/pending guards; T056/T057/T058→T059 validates the complete story. Navigation/snap/nudge cases start from fixtures, not clipboard output.
- US4: Depends on US1/US2/US5 atomic/selection/draft safeguards and US3's per-view state/Reveal Selection for full integration. T060–T063 can run together; T064→T065→T066→T067→T068→T069→T070 establishes proof/planning. T071→T072→T073→T074→T075 joins bridge/native/UI integration; T076/T077/T078→T079 validates. Capture/reference work can overlap US3 only when files and prerequisite types are stable; final editor/adapter/controller/verifier changes must be serialized.
- Final: T080/T081/T082 can proceed in separate ready files/environments. T083/T084 consume the built installed feature and validated evidence schema; T085 requires their test/evidence inputs; T086 reconciles all results. No release/tag/publish task is added by this feature.

### Within each story

1. Write its listed automated tests first and confirm the relevant behavior fails.
2. Implement shared/domain geometry or dependency proof before planning and native mutation.
3. Wire host transport, private adapter and UI without bypassing validators or capability guards.
4. Pass focused, lexical and native checks; validate the independent scenario from a fresh fixture.
5. Record evidence before marking the story checkpoint complete.

### Parallel opportunities

- Independent foundation test batches: T004, T005, T009 and T011 touch separate files. Their implementation consumers wait for the stated prerequisites.
- Independent story test batches: T014–T016; T027–T028; T036–T037; T046–T048; T060–T063.
- US3 pure viewport/placement work and US4 pure reference/policy work can overlap after P1 completion, using stable shared contracts and separate files. Shared protocol, editor, adapter, session, controller and verifier edits are integration points, not parallel opportunities.
- Final T080–T082 can overlap; installed desktop runs can use separate supported-platform environments after the same candidate VSIX exists.
- A `[P]` marker denotes an available ready-file lane, not permission to run all marked tasks globally or to skip prerequisite test/implementation gates.

## Parallel Example: User Story 1

After foundation, prepare these failure-first suites together:

```text
T014 — host operation/postcondition tests: apps/vscode-extension/src/edit-controller.test.ts and verify-candidate.test.ts
T015 — pointer/result-order tests: apps/designer/src/app/editor/editor.component.spec.ts and lifecycle.spec.ts
T016 — lexical geometry tests: tests/roundtrip/interactive.test.ts
```

## Parallel Example: User Story 2

After US1, prepare in parallel, then join before selection/host implementation:

```text
T027 — selection/marquee tests: apps/designer/src/app/editor/selection.spec.ts and editor.component.spec.ts
T028 — bulk geometry/footprint tests: packages/validation/src/layout.test.ts and tests/roundtrip/arrangement.test.ts
```

## Parallel Example: User Story 5

After US2, prepare independent UI/native regression suites:

```text
T036 — draft/limitation/focus tests: apps/designer/src/app/editor/*.spec.ts and authoring/authoring.component.spec.ts
T037 — native failure/race tests: tests/vscode/persistence.test.ts and synchronization.test.ts
```

## Parallel Example: User Story 3

After US5, prepare the three independent test lanes:

```text
T046 — viewport math tests: apps/designer/src/app/editor/viewport.spec.ts
T047 — placement/tie-rule tests: apps/designer/src/app/editor/placement.spec.ts
T048 — preference/nudge integration tests: apps/designer/src/app/editor/editor.component.spec.ts and lifecycle.spec.ts
```

## Parallel Example: User Story 4

After stable P1 contracts, prepare separate proof/transport suites; final UI integration waits for US3:

```text
T060 — exact typed operand tests: packages/expressions/src/analyze.test.ts and references.test.ts
T061 — compatibility/removal policy tests: packages/validation/src/clipboard.test.ts and datasets.test.ts
T062 — lexical subtree tests: tests/roundtrip/clipboard.test.ts
T063 — token/queue/race tests: apps/vscode-extension/src/protocol.test.ts and clipboard.test.ts
```

## Implementation Strategy

### MVP first

Complete Setup, Foundation and US1 (T001–T026). Demonstrate direct textbox/table positioning and sizing from the mixed fixture, native single-step Undo/Redo, save/reopen, source preservation, no-op/refusal and cancellation. This is the narrow direct-manipulation MVP, not full-feature acceptance; finish US5 draft/limitation obligations before presenting the complete P1 workflow as accepted.

### Incremental delivery

1. US1: trustworthy direct manipulation on the existing editor.
2. US2: multi-selection and host-authoritative all-or-nothing arrangement.
3. US5: complete P1 draft conflicts, limitation/source access, focus and native failure behavior.
4. US3: zoom/navigation, deterministic placement and repeat-safe exact keyboard nudges.
5. US4: affirmative safe clipboard reuse, dependency/namespace proof and complete native restoration.
6. Final acceptance: twenty-operation history, installed offline/keyboard checks, real timing samples and requirement traceability.

### Completion accounting

| Phase / story | Task range | Count |
| --- | --- | ---: |
| Setup | T001–T003 | 3 |
| Foundation | T004–T013 | 10 |
| US1 (P1) | T014–T026 | 13 |
| US2 (P1) | T027–T035 | 9 |
| US5 (P1) | T036–T045 | 10 |
| US3 (P2) | T046–T059 | 14 |
| US4 (P2) | T060–T079 | 20 |
| Final acceptance | T080–T086 | 7 |
| **Total** | **T001–T086** | **86** |

No task is pre-completed by planning evidence or the published 0.1.0 release. Full acceptance requires actual implementation checks and the feature-specific evidence above.
