# Implementation Plan: Drag-and-Drop Component Creation

**Branch**: `004-drag-drop-creation` (feature identifier; no Git branch created) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-drag-drop-creation/spec.md`

## Summary

Replace the form-based creation flow with direct creation: Textbox and Table cards are dragged onto the canvas body (or activated from the keyboard) and created at that position with a host-allocated default name (Textbox1, Table1, DataSet1). Tables are created unbound and bound later from the inspector, which also gains table renaming. Paste and duplicate switch to the same numbered naming rule. The creation vocabulary carries positions instead of names; the host returns the created item's ID and name so the designer can select it.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Angular templates and SCSS; Node.js >=24.15.0 <25; pnpm 11.28.2.

**Primary Dependencies**: Angular 22.2.3 and existing `@rdlc/*` packages. Native HTML drag-and-drop; no new dependency.

**Storage**: VS Code `TextDocument` report XML (unchanged ownership).

**Testing**: Vitest/TestBed (designer), Node test runner (validation, serializer, protocol, roundtrip, compatibility), `@vscode/test-electron` native suites.

**Target Platform**: VS Code ^1.142.0 desktop webview on Windows, macOS, Linux.

**Project Type**: VS Code custom text editor with an Angular webview in a pnpm monorepo.

**Performance Goals**: Drop preview follows the pointer within the existing 50ms feedback budget; accepted creation displayed within the existing 200ms budget.

**Constraints**: One atomic bounded edit and one native undo per creation; exact no-op text on cancelled or refused creation; positions within 0.01pt at 25–400% zoom; unique report item names per MS-RDL 2.16.1; unbound top-level table only diagnostic-flagged, never auto-bound (MS-RDL 2.23.10).

**Scale/Scope**: 16 functional requirements, 4 user stories; three creatable kinds; two new authoring actions; one optional result field.

## Constitution Check

| Gate                                  | Before Phase 0                                                                     | After Phase 1 design                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| I — Open-source, native editing       | PASS: creation stays a native document edit with native undo.                      | PASS: no save path or history of its own; drag-and-drop is native platform behavior.                                                       |
| II — Versioned specification evidence | PASS: RDL 2016/01, one section; citations 2.16.1, 6.42, 2.23.10 recorded in spec. | PASS: unbound-table profile extension and its diagnostic cite 2.23.10; naming scope cites 2.16.1.                                           |
| III — Lossless source authority       | PASS: insertions only, bounded footprint.                                          | PASS: host allocates names from full syntax; verification after apply; refusal leaves text unchanged.                                      |
| IV — Verification and boundaries      | PASS: naming in validation, XML in serializer, UI in designer.                     | PASS: `nextName` in validation, unbound table planner in serializer, projector diagnostic in parser; roundtrip, compatibility, native tests. |
| V — Bounded context                   | PASS: scoped searches and two vendored sections only.                              | PASS: research lists exact paths; no corpus loading.                                                                                        |
| VI — Reproducible releases            | PASS: no release change.                                                           | PASS: unchanged.                                                                                                                            |
| Security and project constraints      | PASS: no evaluation, data access or fetching.                                      | PASS: closed vocabulary; client sends positions only; names allocated by the host.                                                         |

**Gate result**: PASS. No exception requested.

## Project Structure

### Documentation (this feature)

```text
specs/004-drag-drop-creation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── editor-integration.md
│   └── workspace-ui.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/
├── report-model/src/editing.ts       # authoringFields vocabulary changes
├── report-model/src/protocol.ts      # editResult.created validation
├── validation/src/validate.ts        # nextName
├── validation/src/clipboard.ts       # allocateNames uses nextName
├── xml-serializer/src/authoring.ts   # textbox creation at a position, 1in × 0.25in
├── xml-serializer/src/tables.ts      # unbound createTable, setTableDataset, renameTable
├── xml-serializer/src/datasets.ts    # nameless createDataset (host-allocated)
└── xml-parser/src/project-tables.ts  # TABLE_DATASET_REQUIRED diagnostic
apps/vscode-extension/src/
├── edit-controller.ts                # name allocation, position validation, created result
└── document-session.ts               # pass created through editResult
apps/designer/src/app/
├── editor/components-catalog.component.ts   # draggable cards, activation creates
├── editor/editor.component.{ts,html,scss}    # dragover/drop, preview, default position, selection of created
├── editor/host-adapter.ts                    # created settlement
├── authoring/authoring.component.*           # remove compact creation inputs
└── tables/table-properties.component.*       # Name and Dataset controls
tests/
├── roundtrip/authoring.test.ts
├── compatibility/datasets.test.ts (+ unbound table fixture)
└── vscode/lifecycle.test.ts, synchronization.test.ts
```

**Structure Decision**: Existing monorepo and editor only. Every change extends an existing owner; no new package, service or gesture engine.

## Phase 0 — Research

[research.md](research.md): R1 native drag-and-drop, R2 host name allocation, R3 `created` result field, R4 position payloads, R5 unbound table and binding, R6 paste naming, R7 keyboard default position.

## Phase 1 — Design and Contracts

- [data-model.md](data-model.md): payloads, result field, naming series, binding states, transient preview.
- [contracts/editor-integration.md](contracts/editor-integration.md): vocabulary, host execution, diagnostic, paste naming.
- [contracts/workspace-ui.md](contracts/workspace-ui.md): cards, drag feedback, post-creation focus and announcements, inspector additions.
- [quickstart.md](quickstart.md): automated and manual validation.

### Delivery order

1. Naming: `nextName`, paste/duplicate switch (testable alone, US4 partial).
2. Protocol and host: new payloads, allocation, `created`, textbox at position (US1/US2 backend).
3. Designer: draggable cards, drop preview and conversion, activation default position, created selection, form removal (US1, US2).
4. Tables: unbound creation, `setTableDataset`, `renameTable`, diagnostic, inspector controls (US3, US4).

**Regression scope**: protocol tests, edit-controller tests, serializer roundtrip and compatibility suites, clipboard tests, designer catalog/editor/lifecycle specs, native lifecycle and synchronization suites. Existing creation tests that send names are updated to the new payloads.

## Complexity Tracking

No violations.
