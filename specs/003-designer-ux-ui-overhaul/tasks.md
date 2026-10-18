# Tasks: Designer UX/UI Overhaul

**Input**: Design documents from `/specs/003-designer-ux-ui-overhaul/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/workspace-ui.md`, `contracts/editor-integration.md`, `quickstart.md` and `.specify/memory/constitution.md`.
**Tests**: Required by the specification's Required Acceptance Coverage and SC-001–010. Extend existing Angular/Node/native-editor suites; actual desktop observations are separate acceptance gates.
**Organization**: Setup → shared foundation → US1 (P1) → US2 (P1) → US3 (P1) → US5 (P1) → US4 (P2) → cross-cutting acceptance. Story labels retain their specification numbers despite priority ordering.

## Format: `[ID] [P?] [Story] Description`

- Every task has a checkbox, sequential ID and exact repository-relative file paths.
- `[P]` permits parallel work only within an explicitly described ready batch, on disjoint files. It does not bypass phase prerequisites or test-first ordering.
- Story tasks carry `[US1]`–`[US5]`; setup, foundation and polish do not.
- New filenames below are intended additions; reuse existing helpers and components rather than introducing a second application, document store, gesture engine or dependency.

## Path Conventions

- Angular presentation: `apps/designer/src/app/` and `apps/designer/src/styles.scss`.
- Host integration: `apps/vscode-extension/src/`.
- Shared types/projection: `packages/report-model/src/` and `packages/renderer/src/`.
- Regression/native checks: `tests/roundtrip/`, `tests/compatibility/`, `tests/vscode/`, `tests/performance/`.
- Recorded feature evidence: `docs/validation/designer-ux-ui-overhaul.md`.
- Reference discovery stays scoped to the inherited citation indexes in `research.md`; `vendor/` is read-only. Do not load the whole reference or fixture corpus into agent context.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the existing toolchain, fixtures and honest evidence boundaries without adding infrastructure.

- [ ] T001 Verify Node >=24.15.0 <25 and pnpm 11.28.2 against `package.json`, install with `pnpm install --frozen-lockfile`, run the existing designer and host unit checks, and record commands/results and pre-existing failures in `docs/validation/designer-ux-ui-overhaul.md` without changing dependency versions or the lockfile.
- [ ] T002 Map the required journeys and SC-001–010 to existing fixture IDs from `tests/fixtures/manifest.json` and inherited evidence in `docs/validation/interactive-designer.md`; create the evidence matrix in `docs/validation/designer-ux-ui-overhaul.md` with candidate commit, platform, viewport, theme, zoom, scaling, timing boundaries and explicit unrun states.

**Checkpoint**: Toolchain and baseline limitations recorded; no runtime acceptance claimed.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ship shared projection, host contracts and stable layout ownership before moving user workflows.

**Blocking**: Complete this phase before any user-story implementation. Retain all existing authoring, properties, datasets, table, source and diagnostics controls in reachable panel regions until replacements are verified.

- [ ] T003 [P] Add failing contract cases in `apps/vscode-extension/src/protocol.test.ts` for malformed structure, duplicate/current-version IDs, missing parents, cycles, invalid source ranges, 2,000-entry/32-level limits, overall message budgets and closed history request/result shapes; reject arbitrary commands, URIs, extra keys, invalid actions and replay using the existing validation boundary.
- [ ] T004 [P] Add failing projector cases in `packages/renderer/src/structure.test.ts` using fixture IDs from `tests/fixtures/manifest.json` for real table/row/cell/dataset/field relationships, safely preserved nesting, opaque content, source-only multiple sections, missing syntax, unknown bounds, truncation and zero input mutation; add a minimal fixture and provenance/citations to the manifest only if an existing fixture cannot represent a required case.
- [ ] T005 Define structure DTOs and fixed history/historyResult variants in `packages/report-model/src/protocol.ts` and, where needed, `packages/report-model/src/scene.ts`; quote/enforce the data-model constraints: nodes are "Flat, source-ordered structural entries; maximum 2,000.", truncated is "True when entry/depth/available transport budgets prevent a complete projection; visible limitation and source access required.", id is "Actual XML node ID in the accepted version; unique within snapshot.", parentId is "Emitted parent ID or null for root; no missing parent, cycle or >32-level chain.", kind is "Closed presentation vocabulary: report, sections, section, body, header, footer, textbox, table, row, cell, dataset, field, container, preserved.", label is "Actual type/name or honest structural label; never evaluated content.", name is "Existing declared name or null; not an authorization to rename.", range is "Actual source range with finite integer `0 <= start <= end <= source.length`.", and preservedReason is "Null or an explanation of preserved/opaque scope, including actual unsupported type where known." Keep history request IDs in the existing bounded format, action `undo | redo`, version correlation, boolean accepted/changed and optional actionable reason; accept no client patch, URI or command ID.
- [ ] T006 Implement the read-only projector in `packages/renderer/src/structure.ts`, export it through `packages/renderer/src/index.ts`, and publish it from `apps/vscode-extension/src/document-session.ts`; derive actual nodes/ranges from accepted syntax, inherit preservation-only restrictions, include safe source-only structure, stop at presentation/remaining transport budgets with honest truncation, and leave parser compatibility, scene geometry and report XML unchanged. Make T004 pass.
- [ ] T007 Update shared message validation in `apps/vscode-extension/src/protocol.ts`, accepted snapshot consumers in `apps/designer/src/app/editor/host-adapter.ts`, and affected test snapshot builders in `apps/designer/src/app/editor/editor.component.spec.ts` and `apps/designer/src/app/editor/lifecycle.spec.ts`; enforce T005 and the existing 8 MiB/131,072-value host, 64 KiB/8,192-value client and depth-20 limits, handle missing/invalid structure with actionable source access, and keep source locations host-allowlisted rather than trusting client ranges. Make T003 structure cases pass; history execution is completed in US1.
- [ ] T008 [P] Add failing stable-layout/ruler/center-anchor checks in `apps/designer/src/app/editor/viewport.spec.ts` and gesture/layout regressions in `apps/designer/src/app/editor/manipulation.spec.ts`; cover page versus body origin, 25%/50%/100%/200%/400% zoom, scroll, display scaling, center preservation with scroll clamping, pointer-down below threshold, marquee, resize, drag, pan and key-repeat cancellation without commits.
- [ ] T009 Add pure center-rebase and ruler calculations beside the existing transforms in `apps/designer/src/app/editor/viewport.ts`; retain scroll-content page origin `(0,0)`, derive ruler ticks from page coordinate × zoom − scroll, distinguish body origin, and introduce no DPR correction, padding or layout-border offset. Make the pure checks in T008 pass.
- [ ] T010 Refactor `apps/designer/src/app/editor/editor.component.html` and `apps/designer/src/app/editor/editor.component.scss` into fixed toolbar/status rows, independently scrolling side panels and a stable canvas grid cell; keep all old workflows reachable, put feedback/draft/diagnostic surfaces outside canvas flow, place rulers outside the scroll viewport and use non-layout page/body decoration. Meet >50% canvas width and >=70% height at 1280 × 800 with 220px/300px default panels; preserve >=320px canvas from 400px upward with compact overlay fallback.
- [ ] T011 Coordinate layout changes with existing state in `apps/designer/src/app/editor/editor.component.ts` and extend `apps/designer/src/app/editor/editor.component.spec.ts`; observe outer workspace resizing, cancel uncommitted gestures before unavoidable reflow, defer elective transitions through pointer-down/key-repeat completion, restore idle center at unchanged zoom with browser-clamped scroll, and verify notifications, selection, drafts and inspector updates never rebase the frame. Make remaining T008 checks pass without replacing the gesture owner.

**Checkpoint**: Shared hierarchy is bounded and honest; inherited controls remain reachable; stable-shell and coordinate regressions pass. Real DOM measurements remain required in T056/T058.

## Phase 3: User Story 1 — Create and Format a Simple Report (Priority: P1) — MVP

**Goal**: Discover real creation, format a textbox contextually, use native history, save and reopen through the existing host.

**Independent Test**: From New Report, search Textbox, create exactly one named Title, change text/position/size/font/color, reject an invalid size without moving accepted geometry, undo/redo, save and reopen. Cancellation and display-only actions leave source/history unchanged.

### Tests for User Story 1

- [ ] T012 [P] [US1] Add failing catalog and compact creation tests in `apps/designer/src/app/editor/components-catalog.component.spec.ts` and `apps/designer/src/app/authoring/authoring.component.spec.ts` for eleven unique cards, categories, case-insensitive search, no-results/clear, unavailable reasons, required names, single pending submission, cancellation, refused creation and selection only after acceptance.
- [ ] T013 [P] [US1] Extend `tests/vscode/lifecycle.test.ts` and `tests/vscode/synchronization.test.ts` with real native-history routing cases: A in split designers after unrelated B was focused, exact A-only undo/redo, empty history, stale/disposed/inactive/unverifiable targets, pending races, source-only history and twenty mixed individually undoable/redoable edits. Verify both A views refresh and B remains exact; mocked activation alone is insufficient.
- [ ] T014 [P] [US1] Add failing textbox inspector and history/draft settlement cases in `apps/designer/src/app/editor/editor.component.spec.ts` and `apps/designer/src/app/editor/lifecycle.spec.ts` for accepted/refused values, initialization/expansion/unit-change no-ops, expression/raw-color preservation, Apply/Discard/Cancel, pending no-op/failure, snapshot/result order and local-input history isolation.

### Implementation for User Story 1

- [ ] T015 [US1] Implement fixed native history dispatch in `apps/vscode-extension/src/document-session.ts` and originating-panel routing in `apps/vscode-extension/src/editor-provider.ts`; use the existing per-document queue/handshake/replay/disposal/version guards, activate and verify the actual bound panel/document, recheck version after asynchronous activation, execute only literal native undo/redo, publish actual state and acknowledge no-op/failure including observed changes after failure. Complete T003 history validation and T013 targeting proof; refuse unverifiable targets rather than acting on another editor.
- [ ] T016 [US1] Add correlated history settlement in `apps/designer/src/app/editor/host-adapter.ts` and guarded toolbar/non-input shortcut routing in `apps/designer/src/app/editor/editor.component.ts`; cancel previews, preserve field-native undo, settle pending once under either snapshot/result order, avoid retries, allow legitimate source-only history, and implement Apply once-and-stop, Discard-and-continue, Cancel-and-stay without replaying stale navigation.
- [ ] T017 [US1] Add the canonical catalog in `apps/designer/src/app/editor/components-catalog.component.ts` and mount it via `apps/designer/src/app/editor/editor.component.html`: Report items = Textbox/Table/Image/Line/Chart/Subreport, Containers = Rectangle/List/Matrix, Data = Dataset/Parameter. Use original local icons, labeled category-preserving search, no-results recovery and focus-accessible unavailable reasons; only Textbox/Table/Dataset emit existing creation actions, with Table offering the real dataset prerequisite flow.
- [ ] T018 [US1] Adapt `apps/designer/src/app/authoring/authoring.component.ts` and its template/styles as applicable for compact creation inputs (textbox name, dataset name, table name/dataset/first field/width) and existing page setup; retain validations/string units, dirty-state/native file behavior, exactly-one accepted creation and relevant selection, cancel/no-op equality, pending/refusal feedback, actual units and Custom dimensions. Keep page presets optional; any offered preset only groups supported explicit edits and never scales content.
- [ ] T019 [US1] Contextualize `apps/designer/src/app/properties/textbox-properties.component.ts` and its template/styles as applicable through a new `apps/designer/src/app/editor/contextual-inspector.component.ts`; derive report/no-selection, single-textbox, multi-selection and preserved summaries from accepted state. Use only relevant sections from General, Position and size, Appearance, Typography, Border and background, Data, Visibility and behavior, Pagination and Advanced; retain supported geometry/text/font/alignment, unit labels, constrained choices, raw-expression affordances and text alternatives for colors. Do not imply unsupported properties or rename.
- [ ] T020 [US1] Complete the compact toolbar in `apps/designer/src/app/editor/editor.component.html`, `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/editor.component.scss`: fixed groups, labeled accessible overflow, native history, all six alignments/two distributions and eligibility reasons, zoom 25%–400%/100%/Fit Page/Fit Body/Reveal, immediate grid/snapping, separate grid/guide visibility/snapping/spacing/units with mixed-state honesty and page setup; retain host file entry points and add no redundant default file buttons.
- [ ] T021 [US1] Route selection, Code XML and any creation/inspector transition that could discard a draft through the existing held-action guard in `apps/designer/src/app/editor/editor.component.ts`; preserve mounted controls on unrelated layout changes, remove unconditional creation autofocus, associate refusals with fields and keep accepted values visible. Run T012–T014 and record the blank/textbox save/reopen journey and one-activation insertion/common-property access in `docs/validation/designer-ux-ui-overhaul.md`.

**Checkpoint**: US1 works independently through retained controls even before Structure/table contextual replacements. Native targeting failure blocks MVP acceptance; later story and full release gates still apply.

## Phase 4: User Story 2 — Find and Arrange Existing Items (Priority: P1)

**Goal**: Synchronize Structure, canvas and inspector without broadening mutation capability or destabilizing gestures.

**Independent Test**: In the mixed fixture, select an obscured textbox through Structure, reveal known offscreen bounds at unchanged zoom, inspect unknown/preserved nodes, distinguish table/cell/data targets, multi-select eligible body items and drag/resize/align/distribute/duplicate with consistent primary identity.

### Tests for User Story 2

- [ ] T022 [P] [US2] Extend `apps/designer/src/app/editor/selection.spec.ts` for exclusive structural/data selection, body membership with primary as a member, exclusive cells, scene-ID joins, explicit accepted mappings and independent-change reconciliation only through unique name/kind/parent or dataset+field identities in both snapshots; clear ambiguous/deleted/unnamed targets without trusting IDs/ordinals across versions.
- [ ] T023 [P] [US2] Add failing hierarchy/navigation tests in `apps/designer/src/app/editor/structure-tree.component.spec.ts` for roving focus, Up/Down/Right/Left/Home/End/Enter/Space, eligible additive selection, preserved/opaque/truncated reasons, ancestor expansion, unrelated expansion retention, known-bound reveal, unknown-bound source access and surviving-parent focus fallback; when a selected canvas target is omitted by truncation, verify incomplete-coverage/source guidance without fabricated entries or lost selection.

### Implementation for User Story 2

- [ ] T024 [US2] Extend the existing selection owner in `apps/designer/src/app/editor/selection.ts` with exclusive `structureTargetId` and version-aware reconciliation; enforce data-model invariants: body mode uses "Existing ordered `bodyItemIds`, `primaryId`; primary must be a member. Includes whole-table frames, not cells.", cell mode uses "Existing exclusive `cellTargetId`; body membership empty.", and structural/data mode uses "Exclusive `structureTargetId`; body/cell selection empty. Covers dataset, field, report/body/section/row and preservation-only targets without a scene selection." Keep no-selection membership empty and all targets scoped to one accepted version. Make T022 pass.
- [ ] T025 [US2] Implement `apps/designer/src/app/editor/structure-tree.component.ts` over accepted structure with actual type/name, source-order parent relationships and capability/limitation indicators; implement the keyboard contract in T023, safe live expansion and no invented geometry/runtime visibility/editable descendants. Show source guidance for opaque/truncated nodes rather than a complete-inventory claim.
- [ ] T026 [US2] Wire tree/canvas/inspector selection and reveal in `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/editor.component.html`; expand/reveal selected tree ancestors without resetting others, reveal known canvas bounds at unchanged zoom, keep structural/data targets rectangle-free, distinguish table frames/cells, and show multi-selection count/primary/eligibility rather than scalar properties. Retain canvas/inspector selection when its tree entry is omitted by truncation and show incomplete-coverage/source guidance without fabricating an entry. Add regression assertions in `apps/designer/src/app/editor/editor.component.spec.ts` for source edits, Undo/Redo, pending and stale-draft cancellation.
- [ ] T027 [US2] Add keyboard-invocable item/background context menus in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html` and `apps/designer/src/app/editor/editor.component.scss`; reuse existing clipboard/duplicate/delete/arrangement/reveal/properties/source actions and all contained-content/reference guards, support Shift+F10/platform key and menu arrows/Home/End/Enter/Escape, explain relevant disabled actions, restore focus and never reflow the canvas or advertise grouping/z-order editing.
- [ ] T028 [US2] Finalize canvas decoration and selection cues in `apps/designer/src/app/editor/editor.component.scss` and ruler rendering in `apps/designer/src/app/editor/editor.component.html`; distinguish page/margins/body, hover/focus/primary/multiple selection, eligible handles and authored-design status without obscuring expressions/grid/guides or changing report colors, geometry or interaction eligibility.
- [ ] T029 [US2] Extend `apps/designer/src/app/editor/manipulation.spec.ts`, `apps/designer/src/app/editor/placement.spec.ts` and `apps/designer/src/app/editor/editor.component.spec.ts` for drag/eight-handle resize/proportional table resize/marquee/pan/scroll/edge auto-scroll/anchored zoom/snapping bypass/nudge/arrangement/clipboard at all five zoom levels and offsets, including feedback/inspector arrival, deferred layout and zero-edit host-resize cancellation; retain <=0.01pt geometry accuracy and existing cancellation/refusal semantics.
- [ ] T030 [US2] Run the obscured/offscreen/unknown-bounds/table/cell/data/multi-selection journey and T022–T029 checks, recording exact source equality for view-only actions and actual selection/reveal/focus observations in `docs/validation/designer-ux-ui-overhaul.md`; leave the full 100-sample synchronization/gesture measurements to T058.

**Checkpoint**: US2 can be validated on existing reports independently of new dataset/table creation.

## Phase 5: User Story 3 — Build a Dataset-Bound Table (Priority: P1)

**Goal**: Migrate existing data/table authoring into the selected context without changing definitions, safeguards or cell scope.

**Independent Test**: Create a local three-field dataset, create a named table bound to it, add a second field column, edit a cell, configure a row group and total, save/reopen and compare definitions. Also exercise all seven inherited field types and guarded reference changes.

### Tests for User Story 3

- [ ] T031 [P] [US3] Add failing selected-definition tests in `apps/designer/src/app/datasets/datasets.component.spec.ts` for dataset/field selection, all seven existing field types, existing rename/delete/reference safeguards, no unrelated forms, missing-dataset Table prerequisites, pending/refusal and zero initialization edits.
- [ ] T032 [P] [US3] Add failing selected-table/cell tests in `apps/designer/src/app/tables/table-properties.component.spec.ts` and `apps/designer/src/app/tables/groups-totals.component.spec.ts` for contextual columns/row heights/binding/groups/totals, accepted-state reconciliation, confirmations, no unrelated-table forms and no cell geometry or item clipboard.

### Implementation for User Story 3

- [ ] T033 [US3] Scope `apps/designer/src/app/datasets/datasets.component.ts` and its template/styles as applicable to selected dataset/field inputs from the shared selection; retain all local-definition types, validations, guarded references/rename/delete and existing request outputs, with actual read-only names/types where rename is unsupported. Make T031 pass without creating canvas data objects or fetching data.
- [ ] T034 [US3] Scope `apps/designer/src/app/tables/table-properties.component.ts` and `apps/designer/src/app/tables/groups-totals.component.ts` and their templates/styles as applicable to the selected whole table or cell; retain all current column/row/group/total/reference protections and destructive confirmations, and reuse textbox/cell text/style/binding controls without granting cell movement/resize/clipboard. Make T032 pass.
- [ ] T035 [US3] Integrate table/dataset/field inspector contexts in `apps/designer/src/app/editor/contextual-inspector.component.ts` and accepted creation selection in `apps/designer/src/app/editor/editor.component.ts`; use shared IDs/capabilities, show only relevant Data/General/geometry sections, preserve drafts through panel changes and guard target changes, close creation only on acceptance, and remove superseded stacked table/data forms only after every inherited action remains reachable.
- [ ] T036 [US3] Extend `tests/roundtrip/authoring.test.ts` and `tests/compatibility/datasets.test.ts` with the migrated creation/field-binding/group/total intents and fixture-based assertions for exact no-op/cancel/refusal text, saved/reopened definitions/expressions, bounded footprints and preserved unknown content; use inherited MS-RDL references from `specs/003-designer-ux-ui-overhaul/research.md` and change no parser/serializer semantics.
- [ ] T037 [US3] Run T031–T036 and the real dataset/table/cell/group/total save/reopen journey, including missing prerequisites, all seven field types and guarded deletion, and record the <=5-minute acceptance timing and source comparisons in `docs/validation/designer-ux-ui-overhaul.md`; if unavailable, record the observation as unrun rather than satisfied.

**Checkpoint**: US3 is independently testable from a new report; contextual presentation retains every supported authoring operation.

## Phase 6: User Story 5 — Work Accessibly with Honest Feedback (Priority: P1)

**Goal**: Complete keyboard/theme/focus behavior and honest status/source-only feedback across migrated workflows.

**Independent Test**: Complete textbox, table, Structure and arrangement journeys using only the keyboard in light/dark/high-contrast themes; inspect an invalid property, unsupported card, diagnostics and malformed/source-only report without losing focus or source access.

### Tests for User Story 5

- [ ] T038 [P] [US5] Add failing keyboard/focus/shortcut tests in `apps/designer/src/app/editor/editor.component.spec.ts` for toolbar groups/overflow, tabs, context menus, focus return after deletion/reconciliation, focus-visible unavailable explanations, draft/refusal announcements and ordinary field/tree/menu typing/selection/clipboard/arrows not being intercepted by canvas shortcuts.
- [ ] T039 [P] [US5] Add failing diagnostic/status/state tests in `apps/designer/src/app/diagnostics/diagnostics.component.spec.ts` for target/severity/reason/corrective source actions, long values/internal scrolling, loading/no-report/invalid/source-only distinctions, disabled Preview and fixed-region feedback with no mutation controls or fake runtime output.

### Implementation for User Story 5

- [ ] T040 [US5] Implement the fixed-height status strip and diagnostic overlay wiring in `apps/designer/src/app/editor/editor.component.html`, `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/diagnostics/diagnostics.component.ts`; show Design, authoritative Code XML, severity/count, zoom, units, actual page/body dimensions and concise guidance, label Preview disabled with its populated-rendering limitation, and expose keyboard-accessible target/reason/corrective actions without moving canvas bounds or flooding routine success announcements.
- [ ] T041 [US5] Implement distinct loading/no-report/editable/invalid/source-only and preservation-only presentations in `apps/designer/src/app/editor/editor.component.html` and `apps/designer/src/app/editor/contextual-inspector.component.ts`; retain safe Structure where available, useful limitations/next actions and source access, never leave endless loading or guessed mutation controls, and keep pending/read-only/trust/budget restrictions and source-only native history eligibility separate.
- [ ] T042 [US5] Finish functional-group Tab/roving arrow navigation, accessible labels/focus-visible tooltips and keyboard activation in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/components-catalog.component.ts` and `apps/designer/src/app/editor/structure-tree.component.ts`; add screen-reader-readable selection/primary/count/pending/refusal/error states, scope canvas shortcuts correctly and restore invoking/surviving focus after menus, overlays, deletion and reconciliation. Make T038–T039 pass.
- [ ] T043 [US5] Apply host font/color tokens and light/dark/high-contrast/forced-colors treatments in `apps/designer/src/styles.scss` and `apps/designer/src/app/editor/editor.component.scss`; keep blue normal selection with contrast overrides, non-color state cues, >=24 × 24px toolbar targets, readable rulers/guides/handles/boundaries and full accessible truncated values. Preserve authored colors; target normal text >=4.5:1 and large text/essential boundaries >=3:1 with original local assets only.
- [ ] T044 [US5] Audit the relocated controls in `apps/designer/src/app/properties/textbox-properties.component.ts`, `apps/designer/src/app/authoring/authoring.component.ts`, `apps/designer/src/app/datasets/datasets.component.ts`, `apps/designer/src/app/tables/table-properties.component.ts` and `apps/designer/src/app/tables/groups-totals.component.ts` for names, focus retention, constrained choices, expression/color text alternatives, field-associated errors and accidental autofocus; correct presentation regressions without adding authoring semantics and rerun affected component suites.
- [ ] T045 [US5] Record real keyboard-only completion, reference-theme contrast measurements, screen-reader observations, unavailable card/Preview honesty and invalid/source-only feedback in `docs/validation/designer-ux-ui-overhaul.md`, including theme/reader versions and actual source equality; DOM roles and mocked focus checks alone cannot pass SC-007.

**Checkpoint**: P1 workflows have accessible controls and truthful feedback; responsive separator/overlay keyboard coverage is completed with US4.

## Phase 7: User Story 4 — Adapt the Workspace to Available Space (Priority: P2)

**Goal**: Add bounded pointer/keyboard panel controls and isolated restorable view preferences over the stable shared layout.

**Independent Test**: At 1280 × 800, 1024 × 768, 640 × 480 and 400 × 600 and 200% interface scaling, resize/hide/restore panels, switch left tabs, inspect an item and restore the same view. Keep selection/zoom/drafts safe, independent views isolated and report text/history unchanged.

### Tests for User Story 4

- [ ] T046 [P] [US4] Extend `apps/designer/src/app/editor/viewport.spec.ts` for independently defaulted invalid/old state, finite bounded preferred widths, closed tabs/sections, existing independent grid/guide/zoom validation and transient-state exclusion; verify preferred wide widths survive temporary effective clamping and no report mutation is represented by restoration.
- [ ] T047 [P] [US4] Extend `apps/designer/src/app/editor/lifecycle.spec.ts` for panel hide/restore, same-view persistence and independent webviews, retained draft controls/guarded unmounting, compact one-overlay focus return, per-tab scroll and safe live expansion retention; test host-resize cancellation versus deferred elective transitions before changing the shared owner.

### Implementation for User Story 4

- [ ] T048 [US4] Extend `ViewState`/restoration in `apps/designer/src/app/editor/viewport.ts` and persistence in `apps/designer/src/app/editor/host-adapter.ts`; enforce the data-model constraints verbatim: existing fields "Retain current validation and independent grid/guide visibility/snapping. Zoom 25%–400%; finite/clamped reachable scroll.", widths "Preferred CSS px: 220 / 300; finite, bounded 180–360 / 240–480.", visibility "Booleans, default true; preference for expanded access, not permission to violate compact mode.", and inspector expansion "Closed boolean map keyed by supported section vocabulary; common relevant controls default open, rare supported sections collapsed. Unknown keys ignored." Validate `leftTab` as `components | structure`, default components for blank reports. Ignore unknown fields, default invalid/missing values independently, keep each `getState()?.view`/`setState({ view })` isolated and restore no draft/pending/gesture/version-scoped IDs as edits. Make T046 pass.
- [ ] T049 [US4] Implement hide/restore actions and pointer/keyboard separators in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html` and `apps/designer/src/app/editor/editor.component.scss`; expose labels/orientation/current/min/max with 10px steps, default widths 220/300 and bounds 180–360/240–480, constrain effective layout for >=320px canvas from 400px upward, preserve idle center/zoom and defer elective changes during active manipulation using T011.
- [ ] T050 [US4] Complete responsive overlay coordination in `apps/designer/src/app/editor/editor.component.ts` and `apps/designer/src/app/editor/editor.component.scss`: left overlay below 1100px, both below 800px, at most one open, labeled access to both left tabs/Properties, Escape/focus return and no canvas reflow on overlay opening; below 400px preserve command access without the 320px promise. Preserve preferred wide sizes separately from effective dimensions and retain one-row toolbar/status overflow at 200% scaling.
- [ ] T051 [US4] Wire left-tab scroll and inspector expansion preferences in `apps/designer/src/app/editor/editor.component.ts`, `apps/designer/src/app/editor/editor.component.html` and `apps/designer/src/app/editor/contextual-inspector.component.ts`; keep live tree expansion/focus return view-local and safely reconciled, preserve mounted drafts across unrelated layout changes, guard any unavoidable unmount and verify no XML edit/undo entry on initialization or view changes. Make T047 pass and run affected selection/layout/component checks.
- [ ] T052 [US4] Execute the four-viewport/200%-scaling panel, navigation, property-editing and native-save matrix from `specs/003-designer-ux-ui-overhaul/quickstart.md`, including pointer/keyboard bounds, minimum canvas, independent scrolling/views, obsolete restoration, oversized preferences and active-gesture transitions, and record measured frame/center/source/focus results in `docs/validation/designer-ux-ui-overhaul.md`.

**Checkpoint**: Every story is independently testable, with completed responsive acceptance including keyboard separators and compact overlays.

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Close inherited regressions and gather real evidence before claiming the feature complete.

- [ ] T053 Extend `tests/roundtrip/interactive.test.ts`, `tests/roundtrip/lexical.test.ts` and `tests/compatibility/manifest.test.ts` as needed for the existing >=12-file corpus: structure/search/theme/layout/view-only/no-op/cancel/refusal exact equality, accepted-edit outside-footprint preservation, unknown namespaces/content, source-only/version/budget cases and exact native Undo prior text. Reuse existing assertions and fixture provenance rather than duplicating serializers or broadening the supported table/schema profile.
- [ ] T054 Complete applicable inherited native lifecycle checks in `tests/vscode/persistence.test.ts`, `tests/vscode/lifecycle.test.ts`, `tests/vscode/synchronization.test.ts` and `tests/vscode/clipboard.test.ts` for Save/Save As cancellation/failure, dirty-close, external changes, split views, bounded accepted edits, guarded clipboard and pending/stale/read-only behavior; preserve the T013 twenty-edit history proof and record exact outcomes in `docs/validation/designer-ux-ui-overhaul.md`.
- [ ] T055 Run the installed-editor offline and restricted-workspace journeys with disposable fixtures selected from `tests/fixtures/security/` and `tests/fixtures/xml/unsafe-dtd.rdlc`; record zero report-triggered retrieval, external-entity resolution, data access or expression/code execution, retained authoring/source workflows and actual trust/read-only refusal in `docs/validation/designer-ux-ui-overhaul.md`. Do not treat the native harness's disabled trust prompts or initial runtime download as this evidence.
- [ ] T056 Run the real DOM coordinate/interaction matrix from `specs/003-designer-ux-ui-overhaul/quickstart.md` at all required zooms, viewport sizes, offsets and interface scaling; measure ruler/page/body alignment, <=1px unintended origin drift, <=0.01pt geometry error, no layout shift from feedback/drafts/menus and zero committed gesture edits on unavoidable resize. Record fixtures, workstation and measurements/screenshots in `docs/validation/designer-ux-ui-overhaul.md` and fix observed presentation regressions before rechecking affected cases.
- [ ] T057 Conduct the five-author acceptance study and record raw task times, coaching status and the five-point clarity scale in `docs/validation/designer-ux-ui-overhaul.md`: >=4/5 discover insertion/Structure/page setup/source within 30 seconds each, >=4/5 complete the textbox journey <=3 minutes and rate clarity >=4/5; verify one-activation creation/tree selection, at most one common-section expansion and the <=5-minute table journey. If participants are unavailable, mark SC-001–003 unrun and keep feature acceptance open.
- [ ] T058 Extend existing synthetic budget coverage in `tests/performance/editor.test.ts` only where the new bounded hierarchy changes its scope, then record actual 100-selection, 100-manipulation and 100-sample performance runs in `docs/validation/designer-ux-ui-overhaul.md` on a documented <=1 MiB/100-selectable-item reference report: 100% identity/primary/eligibility agreement, >=95 selection updates <=100ms, feedback <=50ms, accepted display <=200ms and search/panel feedback <=100ms in >=95/100 samples. Record input-to-paint, accepted-snapshot-to-paint, host roundtrip and request-to-visible-acceptance separately; synthetic timers cannot substitute for measured SC-004/005/009 outcomes.
- [ ] T059 Run the frozen-lockfile, format, lint, typecheck, unit, roundtrip, compatibility, build, acceptance and VS Code gates from `specs/003-designer-ux-ui-overhaul/quickstart.md`, then package/test the installed VSIX with `pnpm package` and `pnpm test:package`; record same-candidate results, final FR-001–036/SC-001–010 evidence links and any unrun checks in `docs/validation/designer-ux-ui-overhaul.md`. Verify no added dependency, alternative saved report, changed release workflow or vendor modification; preserve existing GitHub Actions/SemVer/same-VSIX release rules and do not publish as part of validation.

**Final checkpoint**: All requested workflows and inherited regression gates pass; actual visual, accessibility, performance, offline and usability evidence is recorded. An unrun or failed mandatory acceptance check remains open and is never relabeled as a pass.

## Dependencies & Execution Order

### Phase dependencies

```text
Setup T001–T002
  └─ Foundation T003–T011
       └─ US1 T012–T021 (P1 / MVP)
            └─ US2 T022–T030 (P1)
                 └─ US3 T031–T037 (P1)
                      └─ US5 T038–T045 (P1)
                           └─ US4 T046–T052 (P2)
                                └─ Cross-cutting T053–T059
```

- Foundation: T003/T004 can run together; T005 precedes T006/T007. T008 precedes T009–T011; T010 establishes the DOM shell before T011 integrates observation/cancellation.
- US1: write T012–T014 before implementation. T015 precedes T016; T017 precedes catalog integration, T018/T019 precede final guarded-flow verification. T020 uses completed history routing; T021 is the story acceptance gate.
- US2: tests T022/T023 precede implementation. T024/T025 precede T026; T027/T028 retain shared editor ownership and are sequential with editor integration. T029/T030 verify the complete migrated story.
- US3: tests T031/T032 precede implementation. T033/T034 precede inspector integration T035 and regression/acceptance T036/T037.
- US5: tests T038/T039 precede implementation. Status/state/keyboard/theme work precedes the migrated-form audit and actual accessibility observations.
- US4: tests T046/T047 precede implementation. State validation T048 precedes persistence integration; T049/T050 use foundation layout cancellation, then T051/T052 finish restoration and acceptance.
- Final checks depend on all stories. T059 follows source changes and targeted checks; repeat only checks invalidated by subsequent fixes.

### User story dependencies and independent validation

- **US1** depends only on foundation and retained baseline capabilities. This is the smallest demoable increment.
- **US2** uses US1's inspector/catalog shell and draft/source routing, but can be tested entirely on existing reports.
- **US3** uses US1 creation and US2 data/table selection to scope forms; its independent journey begins with a new report.
- **US5** validates the migrated P1 surfaces; accessibility is implemented with each control, not postponed until this phase. US4 later extends the same contract to separators/overlays.
- **US4** builds on foundation stability and existing P1 controls; its journey requires no new report semantics.
- These stories share `editor.component.*` and the inspector; do not execute their integration tasks concurrently. Independent acceptance means a bounded testable journey, not absence of shared implementation prerequisites.

## Parallel Execution Examples

These are disjoint-file work batches after their stated prerequisites, not instructions to launch agents automatically. Run integration tasks sequentially when they share the editor owner.

| Phase/story | Ready parallel batch | Wait before integration |
| --- | --- | --- |
| Foundation | T003 host validation tests + T004 projector tests | Complete T005 types before T006/T007 production integration. |
| US1 | T012 catalog/creation tests + T013 native history tests + T014 editor settlement tests | All require foundation; T015/T016 then provide working history. |
| US2 | T022 selection tests + T023 tree tests | T024/T025 finish before T026 shared editor wiring. |
| US3 | T031 dataset tests + T032 table/group tests | Complete target components before T035 inspector wiring. |
| US5 | T038 editor keyboard tests + T039 diagnostics tests | Implement and integrate before T045 desktop observations. |
| US4 | T046 preference math tests + T047 lifecycle tests | Integrate validated state/layout before T052 real viewport runs. |

## Implementation Strategy

### MVP first

1. Complete setup and foundation while retaining all inherited forms/actions.
2. Deliver US1: discoverable catalog, real creation, textbox inspector, toolbar and proven document-bound history.
3. Stop and validate US1 independently, including real Save/reopen and targeting proof. Record a demo/MVP as partial feature delivery; do not claim the other mandatory stories or acceptance criteria are complete.

### Incremental delivery

1. Add US2 hierarchy/selection/context menus and rerun manipulation/preservation checks.
2. Add US3 contextual data/table/cell authoring and remove old forms only after every operation remains reachable.
3. Finish US5 cross-surface keyboard, themes, status and accessible feedback.
4. Add US4 interactive resizing, compact overlays and validated per-view restoration.
5. Complete cross-cutting native, inert/offline, fixture, real-layout, usability and measured performance gates on the same final candidate.

### Verification discipline

- Write regression tests before the implementation they exercise and confirm their intended failures; do not add tests that merely mirror markup.
- Use focused package/component checks during iteration, followed by T059's full gates. Record failures and unrun desktop checks honestly.
- Inspect only relevant source paths/symbols and fixture/reference indexes; preserve inherited format citations and the constitution's bounded-context rule.
- Keep existing native mutation validation, atomic footprints, source authority and refusal handling throughout every increment.
- Human participation and real desktop tooling are prerequisites for measured acceptance; lack of either blocks the relevant acceptance task, not honest task-list generation.
