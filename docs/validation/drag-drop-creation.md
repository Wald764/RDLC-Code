# Drag-and-Drop Component Creation — Validation

Feature: `specs/004-drag-drop-creation`.

## Baseline (T001)

- Platform: Windows 11, Node 24, pnpm 11.28.2 (on PATH). Dependencies and lockfile unchanged.
- `pnpm test:unit`: PASS — 102 Node tests, 179 designer tests.
- `pnpm test:roundtrip`: PASS — 58 tests.
- `pnpm test:compatibility`: PASS — 13 tests.
- Candidate includes the uncommitted 003 US4 and visual-alignment changes.

## Implementation checks

- Naming: `nextName` (validation) returns the stem plus the lowest free number; paste and duplicate use it (`Textbox2` duplicated beside `Textbox1`/`Textbox2` → `Textbox3`; non-ASCII names fall back to `Textbox1`). The previous `uniqueName`-based rule returned the bare stem first.
- Protocol: creation payloads are `createTextbox`/`createTable` `{ left, top }` and `createDataset {}`; `renameTable {name}` and `setTableDataset {dataset}` added; old named payloads are refused. Accepted results may carry `created: { id, name }`, valid only when changed and with a current-version node ID and a CLS name.
- Host: names are allocated from the full syntax (`reportItemNames` / dataset names); positions are validated as nonnegative explicit-unit sizes; verification checks name, kind and position. Textbox creation size 1in × 0.25in; unbound tables have two 1in columns, header and detail rows of 0.25in, no `DataSetName`. Binding inserts `DataSetName` and a detail group.
- Diagnostic: `TABLE_DATASET_REQUIRED` (warning, MS-RDL 2.23.10) for an unbound table when the report has more than one dataset; fixture `tests/fixtures/tables/unbound.rdlc` registered in the manifest.
- Designer: available cards are draggable (kind carried in the drag type); the canvas converts the drop point with the existing transform, snaps to grid/guides (Alt bypasses), shows the footprint preview and refuses drops outside the body or in ineligible states. Activation creates at the visible body top-left plus 0.25in, offset by one grid step while occupied. The created item is selected by its returned ID; keyboard creation focuses the inspector. The old creation forms (textbox, dataset, table) are removed; tables gain Name and Dataset controls.
- Existing native lifecycle check on `textboxes/supported.rdlc`: dataset renaming is refused there by the existing unknown-extension safeguard, so the structural sequence binds to the host-named `DataSet1`.

## Automated results

- `pnpm test:unit`: PASS — 104 Node tests, 187 designer tests.
- `pnpm test:roundtrip`: PASS — 60 tests.
- `pnpm test:compatibility`: PASS — 14 tests.
- `pnpm lint`, `pnpm typecheck`: PASS.
- `VSCODE_VERSION=1.142.0 pnpm test:vscode`: PASS � all 7 native suites (activation, clipboard, existing-report, lifecycle, new-report, persistence, synchronization). Creation, binding and table steps undo/redo to exact prior text in the native 20-edit and structural history checks; the created textbox name is returned as `Textbox1`.

## Unrun

- T033 installed-VSIX manual journeys (real drag-and-drop gesture, keyboard-only creation, screen-reader announcement): **unrun**. jsdom tests call the drag handlers directly; no real browser drag has been observed.
- T034 / SC-007 five-author session: **unrun**.
- An untracked `vendor/Vendor Purchase List.rdlc` exists in the working tree; it was not created or modified by this feature.

## Feedback fixes (T036–T039)

- Draft banner appears only when an action would discard the typed value; typing alone is silent.
- Deletions (dataset, field, table, group, cell, textbox) use the source-aware opaque-reference rule already used by Cut: an opaque expression blocks only when it spells the name. Renames keep the strict rule. Regression: `opaque expressions block a dataset deletion only when they spell its name`.
- Refusals show the host diagnostic message, with the code in parentheses; selecting a dataset or field in Structure no longer reports "Select an item with known bounds".
- Structure context menu (right-click, Shift+F10, menu key) reuses the canvas menu without Align/Distribute and adds guarded dataset/field deletion.
- Gates after the fixes: unit 104 Node + 189 designer, roundtrip 61, compatibility 14, lint, typecheck, all 7 native suites: PASS. Real-desktop observation of the menu and messages: unrun.

## Cross-report paste line endings (T043)

- Cause: VS Code converts inserted line breaks to the destination document's EOL, so text copied from a CRLF report into an LF report (or the reverse) no longer equalled the verified candidate and the commit was refused as `DOCUMENT_CHANGED_DURING_APPLY`.
- Fix: commit writes replacements and compares the candidate in the destination EOL. XML line-end normalization makes both forms equivalent.
- Evidence: native `crossLineEndings` (LF?CRLF and CRLF?LF, multi-line copied textbox) failed with `DOCUMENT_CHANGED_DURING_APPLY` before the fix and passes after; all 7 native suites PASS; unit 104 + 195, roundtrip 61, compatibility 14, lint, typecheck PASS.
