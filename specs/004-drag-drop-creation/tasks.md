# Tasks: Drag-and-Drop Component Creation

**Input**: Design documents from `specs/004-drag-drop-creation/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/editor-integration.md`, `contracts/workspace-ui.md`, `quickstart.md`, `.specify/memory/constitution.md`.
**Tests**: Required. The constitution (principle IV) requires focused verification for editing-semantics changes, and SC-002â€“SC-006 are automated measures. Write each test task before the implementation it covers and confirm it fails first.
**Organization**: Setup â†’ foundation (naming, vocabulary, host allocation, `created` result) â†’ US1 (P1) â†’ US2 (P1) â†’ US3 (P2) â†’ US4 (P2) â†’ polish.

## Format: `[ID] [P?] [Story] Description`

- `[P]`: parallelizable within its phase on disjoint files.
- Story labels `[US1]`â€“`[US4]` match `spec.md`.
- Reuse existing owners (selection, viewport transforms, snapping, edit queue, verification); add no package, dependency or gesture engine.
- Reference lookups stay scoped to MS-RDL 2.16.1, 6.42 and 2.23.10 as cited in `research.md`; `vendor/` is read-only.

## Phase 1: Setup

- [X] T001 Run `pnpm install --frozen-lockfile`, `pnpm test:unit`, `pnpm test:roundtrip` and `pnpm test:compatibility` on the current candidate and record the baseline (commands, pass counts, pre-existing failures) in a new `docs/validation/drag-drop-creation.md`; change no dependency or lockfile.

## Phase 2: Foundational (blocking all stories)

**Purpose**: Numbered naming, the new creation vocabulary, host-side allocation and the `created` result, so every story can create items without names from the client.

- [X] T002 [P] Add failing tests for `nextName` in `packages/validation/src/validate.test.ts`: "`stem + n` for the lowest integer `n >= 1` with the result not in `reserved`"; gaps are filled (Textbox1 and Textbox3 reserved â†’ Textbox2); the bare stem is never returned; reserved names of any report item kind count; invalid stems throw like `uniqueName`.
- [X] T003 Implement `nextName(stem, reserved)` beside `uniqueName` in `packages/validation/src/validate.ts` and export it from the package entry used by `clipboard.ts`. Make T002 pass.
- [X] T004 [P] Add failing protocol cases in `apps/vscode-extension/src/protocol.test.ts`: the vocabulary is exactly `createTextbox: ['left', 'top']`, `createTable: ['left', 'top']`, `createDataset: []`, `renameTable: ['name']`, `setTableDataset: ['dataset']`; old payloads with `name`, `dataset`, `field` or `width` on creation actions are refused; `editResult.created` is optional, allowed only when `accepted`, shaped `{ id, name }` with "`id` matches the existing bounded ID format; `name` is a CLS identifier of at most the existing name length; unknown keys rejected".
- [X] T005 Update `authoringFields` in `packages/report-model/src/editing.ts` and `editResult` typing/validation in `packages/report-model/src/protocol.ts` to the T004 vocabulary and `created` field; keep exact-key, string-only validation and all existing budgets. Make T004 pass; update existing callers that still send names so the workspace typechecks.
- [X] T006 [P] Add failing host cases in `apps/vscode-extension/src/edit-controller.test.ts` for `createTextbox` and `createDataset`: target must be the report root of the base version; `left`/`top` "RdlSize strings with explicit unit, finite, >= 0", otherwise refused with no edit; the allocated name is `nextName('Textbox', reportItemNames(root))` (including names inside preserved content) or `nextName('DataSet', dataset names)`; the accepted result carries `created: { id, name }` valid in the result version; verification refuses a candidate whose created item name, kind or position differs.
- [X] T007 Change `planCreateTextbox` in `packages/xml-serializer/src/authoring.ts` to take the allocated name and `left`/`top`, emitting `Left`/`Top` from the payload and `Width` 1in, `Height` 0.25in with an empty value; keep `textboxXml` defaults for other callers. Adjust `planDataset` in `packages/xml-serializer/src/datasets.ts` to receive the allocated name.
- [X] T008 Implement allocation, position validation and `created` in `apps/vscode-extension/src/edit-controller.ts` and pass `created` through the result in `apps/vscode-extension/src/document-session.ts`. Make T006 pass.
- [X] T009 [P] Extend `tests/roundtrip/authoring.test.ts`: textbox creation at a given position changes only the inserted element; refused creation (bad unit, negative, stale target) leaves the text byte-identical; one native-equivalent revert restores the exact prior text.
- [X] T010 Add `created` settlement to `apps/designer/src/app/editor/host-adapter.ts` and select the created ID in `apps/designer/src/app/editor/editor.component.ts` under either snapshot/result order, replacing the current match-by-requested-name logic; add order-independence cases to `apps/designer/src/app/editor/lifecycle.spec.ts`.

**Checkpoint**: The host creates named textboxes and datasets from positions alone; the designer selects what the host created.

## Phase 3: User Story 1 â€” Drop a textbox where it belongs (P1) â€” MVP

**Goal**: Drag the Textbox card onto the body and get a named, selected textbox at the snapped drop point in one gesture.

**Independent Test**: In a blank report, drag Textbox onto the body twice, undo once. Textbox1 and Textbox2 appear at the snapped drop points, each selected; one undo removes only Textbox2.

### Tests for User Story 1

- [X] T011 [P] [US1] Add failing cases in `apps/designer/src/app/editor/components-catalog.component.spec.ts`: Textbox, Table and Dataset cards are `draggable` and set a closed drag type carrying only the component kind; unavailable cards are not draggable and keep `aria-describedby` reasons.
- [X] T012 [P] [US1] Add failing cases in `apps/designer/src/app/editor/editor.component.spec.ts`: a drop inside the body sends one `createTextbox` with `left`/`top` equal to the snapped body point in the display unit at 25/50/100/200/400% zoom and nonzero scroll (within 0.01pt); Alt drops unsnapped; drops outside the body, Escape, `dragleave`, window blur, workspace resize and ineligible states (pending, read-only, source-only, invalid) send nothing; an unapplied draft routes the drop through the existing held-action guard.

### Implementation for User Story 1

- [X] T013 [US1] Make available cards draggable in `apps/designer/src/app/editor/components-catalog.component.ts` (drag data: kind only, `effectAllowed = 'copy'`), keep click activation, and emit nothing on drag start. Make T011 pass.
- [X] T014 [US1] Handle `dragover`/`dragleave`/`drop` on the canvas viewport in `apps/designer/src/app/editor/editor.component.ts` and `editor.component.html`: convert with `clientToBody`, snap with the existing grid/guide logic (Alt bypass), show the "Drop preview (designer only, transient)" footprint with the existing `.preview`/`.invalid` styles at the default size (Textbox 1in Ã— 0.25in), set `dropEffect = 'none'` over invalid areas, clear the preview on cancel, blur and resize, and send one `createTextbox` through the existing edit queue. Make T012 pass.
- [X] T015 [US1] Announce "Created <name>." once in the existing live region on acceptance and the host reason once on refusal in `apps/designer/src/app/editor/editor.component.ts`; after a drop, focus the canvas with the created item selected.
- [X] T016 [US1] Extend `tests/vscode/lifecycle.test.ts` with a native check: creating a textbox at a position is one native undo step restoring the exact prior text, and a pending or stale creation is refused without retry.

**Checkpoint**: US1 works end to end; the old creation form still exists for tables until US3.

## Phase 4: User Story 2 â€” Create components from the keyboard (P1)

**Goal**: Activating a card creates the component at a predictable position with the same naming; focus lands on the Name field.

**Independent Test**: Keyboard only: activate Textbox twice and Dataset once. Textbox1 and Textbox2 at distinct default positions, DataSet1 selected in Structure, each one undo step.

### Tests for User Story 2

- [X] T017 [P] [US2] Add failing cases in `apps/designer/src/app/editor/editor.component.spec.ts`: activation (Enter, Space, click without drag) sends `createTextbox` at the visible body top-left plus 0.25in in the display unit (snapped when on); a second activation that would reuse the same top-left is offset by one grid step; `createDataset` sends an empty payload; on acceptance focus moves to the inspector Name field (textbox) or the dataset entry in Structure (dataset); one announcement per creation.

### Implementation for User Story 2

- [X] T018 [US2] Implement activation creation in `apps/designer/src/app/editor/editor.component.ts` using the "Keyboard placement state (designer only, transient)" rule from `data-model.md`; reuse the T014 send path. Make T017 pass.
- [X] T019 [US2] Remove the compact textbox and dataset creation inputs from `apps/designer/src/app/authoring/authoring.component.ts`, `authoring.component.html` and `authoring.component.scss`, and the creation fieldset from `apps/designer/src/app/editor/editor.component.html`; keep page setup. Update `apps/designer/src/app/authoring/authoring.component.spec.ts` and `apps/designer/src/app/editor/components-catalog.component.spec.ts` to the new flow without weakening refusal/pending coverage.

**Checkpoint**: Textbox and Dataset creation have no forms; pointer and keyboard paths share one request shape.

## Phase 5: User Story 3 â€” Add a dataset and an unbound table (P2)

**Goal**: Drop Table to create an unbound Table1; bind it to a dataset from the inspector.

**Independent Test**: Blank report: drop Table, activate Dataset, add two fields, bind Table1 in the inspector, add a column, save and reopen; only the intended definitions changed.

### Tests for User Story 3

- [X] T020 [P] [US3] Add failing serializer/roundtrip cases in `tests/roundtrip/authoring.test.ts` for the unbound table: two 1in columns, a header row and a detail row of 0.25in, empty static cells named by the existing cell-name rule, no `DataSetName`, no detail group, `Left`/`Top` from the payload; `setTableDataset` inserts or replaces `DataSetName` and adds a detail group when absent; refusals are byte-identical.
- [X] T021 [P] [US3] Add an unbound-table fixture with provenance and the MS-RDL 2.23.10 citation to `tests/fixtures/manifest.json` and failing cases in `tests/compatibility/tables.test.ts`: the table projects as structural with `dataset: null`; `TABLE_DATASET_REQUIRED` (warning) appears only when the report declares more than one dataset; zero or one dataset produces no diagnostic.
- [X] T022 [P] [US3] Add failing host cases in `apps/vscode-extension/src/edit-controller.test.ts` for `createTable` (`nextName('Table', reportItemNames(root))`, position validation, `created`) and `setTableDataset` ("dataset must exist"; unknown dataset refused).

### Implementation for User Story 3

- [X] T023 [US3] Add the unbound creation branch and `setTableDataset` to `planTable` in `packages/xml-serializer/src/tables.ts`, removing the dataset/field/width creation inputs. Make T020 pass.
- [X] T024 [US3] Emit `TABLE_DATASET_REQUIRED` from `packages/xml-parser/src/project-tables.ts` (or the report projector that owns table diagnostics), with an actionable message and corrective action citing MS-RDL 2.23.10, and keep unbound static tables structural. Make T021 pass.
- [X] T025 [US3] Wire `createTable` and `setTableDataset` in `apps/vscode-extension/src/edit-controller.ts` with verification of name, kind, position and binding. Make T022 pass.
- [X] T026 [US3] Enable Table drops and activation in `apps/designer/src/app/editor/editor.component.ts` (default footprint two 1in columns Ã— 0.5in) and add a Dataset select (bind/rebind, existing datasets only) to `apps/designer/src/app/tables/table-properties.component.ts` and `.html`, showing the `TABLE_DATASET_REQUIRED` message next to it; keep column/group/total controls once bound. Remove the remaining table creation inputs from `apps/designer/src/app/authoring/`. Extend `apps/designer/src/app/tables/table-properties.component.spec.ts`.
- [X] T027 [US3] Extend `tests/compatibility/datasets.test.ts` and `tests/roundtrip/authoring.test.ts` with the full journey (create unbound table, create dataset, add fields, bind, add column) asserting saved/reopened definitions and preserved unrelated content.

**Checkpoint**: Tables are created without prompts and bound afterwards; multi-dataset reports flag unbound tables.

## Phase 6: User Story 4 â€” Rename after creation, consistent copy names (P2)

**Goal**: Rename textboxes, tables and datasets from the inspector; paste and duplicate follow the numbered rule.

**Independent Test**: Create Textbox1 and Textbox2, rename Textbox1 to Title, duplicate Title and Textbox2 â†’ Title1 and Textbox3; each rename is one undo step.

### Tests for User Story 4

- [X] T028 [P] [US4] Add failing cases in `packages/validation/src/clipboard.test.ts` and `tests/roundtrip/clipboard.test.ts`: `allocateNames` keeps a free original name; otherwise uses `nextName(stem, reserved)` with the trailing digits stripped (Textbox2 with Textbox1/Textbox2 present â†’ Textbox3; Title â†’ Title1); no duplicate report item names in generated sequences.
- [X] T029 [P] [US4] Add failing `renameTable` cases in `apps/vscode-extension/src/edit-controller.test.ts` and `tests/roundtrip/authoring.test.ts`: report-item-scope uniqueness, invalid identifiers refused with a field-associated reason, existing reference safeguards applied, one undoable edit.

### Implementation for User Story 4

- [X] T030 [US4] Switch `allocateNames` in `packages/validation/src/clipboard.ts` to `nextName`. Make T028 pass.
- [X] T031 [US4] Implement `renameTable` in `packages/xml-serializer/src/tables.ts` and `apps/vscode-extension/src/edit-controller.ts`, and add the table Name field to `apps/designer/src/app/tables/table-properties.component.html`/`.ts` with the existing field-associated refusal pattern. Make T029 pass.

**Checkpoint**: All created and copied items follow one naming rule and are renamable.

## Phase 7: Polish & Cross-Cutting

- [X] T032 Run the quickstart automated gates (`pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:roundtrip`, `pnpm test:compatibility`, `pnpm build`, `pnpm test:vscode`) and record results in `docs/validation/drag-drop-creation.md`.
- [ ] T033 Run the six manual journeys from `specs/004-drag-drop-creation/quickstart.md` in the installed VSIX (`pnpm package`) and record observations, including keyboard-only creation and screen-reader announcement; mark any unrun journey as unrun.
- [ ] T034 Run the SC-007 five-author session if participants are available and record times and clarity ratings in `docs/validation/drag-drop-creation.md`; otherwise mark SC-007 unrun.
- [X] T035 Update `specs/003-designer-ux-ui-overhaul/spec.md` cross-references only where they describe the removed creation form, noting it is superseded by feature 004; verify no vendor file, dependency or lockfile changed.

## Addendum: feedback fixes after first delivery

Requested after the MVP review; they expose or relax existing behavior only and add no report semantics. Dataset duplication stays out of scope.

- [X] T036 Show the unapplied-draft banner in `apps/designer/src/app/editor/editor.component.html` only when an action would discard the draft (conflict), focusing Apply after it renders; typing alone stays quiet. Update `apps/designer/src/app/editor/editor.component.spec.ts`.
- [X] T037 Apply the source-aware reference rule already used by Cut (feature 002) to deletions in `apps/vscode-extension/src/edit-controller.ts` and `packages/validation/src/tables.ts`: opaque content blocks a dataset, field, table, group, cell or textbox deletion only where it spells the name; renames stay strict. Add the regression to `tests/roundtrip/authoring.test.ts`.
- [X] T038 Show the host diagnostic message (code kept in parentheses) for refusals in `apps/designer/src/app/editor/host-adapter.ts` and `editor.component.html`, and do not run canvas reveal for data or structural Structure targets in `editor.component.ts`.
- [X] T039 Add a Structure context menu (pointer, Shift+F10, menu key) in `apps/designer/src/app/editor/structure-tree.component.ts`, opening the shared editor menu without arrangement entries and with guarded `deleteDataset`/`deleteField` entries for data targets; cover it in `structure-tree.component.spec.ts` and `editor.component.spec.ts`.
- [X] T040 Keep Structure expansion across versions for unique unnamed nodes (Report, ReportSections, ReportSection, Body) via an expansion-only option of `structureMappings` in `apps/designer/src/app/editor/selection.ts`; focus and selection keep named-only mapping. Open five levels on first load. Regression in `structure-tree.component.spec.ts`.
- [X] T041 Retarget a right-click made while a menu is open: the backdrop closes the menu and reopens the extension menu for the canvas item or Structure entry under the pointer, never the webview's native menu (`apps/designer/src/app/editor/editor.component.ts`/`.html`; test in `editor.component.spec.ts`).
- [X] T042 Keep context menus inside the webview by measuring the rendered menu and opening it above/left of the pointer near the bottom/right edges, scrolling when taller than the area (`menuPosition` in `apps/designer/src/app/editor/viewport.ts`, tests in `viewport.spec.ts`). The webview cannot draw over VS Code panels.
- [X] T043 Write inserted text with the target document's line endings at commit (`apps/vscode-extension/src/document-session.ts`) so pasting between LF and CRLF reports no longer fails with `DOCUMENT_CHANGED_DURING_APPLY`; native regression `crossLineEndings` in `tests/vscode/clipboard.test.ts` (reproduced before the fix). Refusals show one readable line via `explainRefusal` in `apps/designer/src/app/editor/host-adapter.ts`.

## Dependencies & Execution Order

```text
T001 â†’ Foundation T002â€“T010 â†’ US1 T011â€“T016 â†’ US2 T017â€“T019 â†’ US3 T020â€“T027 â†’ US4 T028â€“T031 â†’ Polish T032â€“T035
```

- Foundation: T002 â†’ T003; T004 â†’ T005; T006 â†’ T007 â†’ T008; T009 after T008; T010 after T005.
- US1 and US2 share `editor.component.*`; run their implementation tasks sequentially. US2 depends on T014's send path.
- US3 depends on the foundation and on T014 (drop handling). T023 â†’ T025; T024 is independent of T023.
- US4 depends only on the foundation (T003); T030 can start right after T003 if desired.

## Parallel Opportunities

| Phase      | Parallel batch                     |
| ---------- | ---------------------------------- |
| Foundation | T002 + T004 + T006                 |
| US1        | T011 + T012                        |
| US3        | T020 + T021 + T022                 |
| US4        | T028 + T029                        |

## Implementation Strategy

1. **MVP**: Setup, foundation and US1 â€” drag a textbox onto the body with an automatic name and single undo.
2. Add US2 (keyboard parity, form removal for textbox/dataset).
3. Add US3 (unbound tables, binding, diagnostic).
4. Add US4 (table rename, paste naming).
5. Polish: full gates, installed-VSIX journeys, acceptance session.
