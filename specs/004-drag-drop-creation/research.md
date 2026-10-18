# Research: Drag-and-Drop Component Creation

Scoped to the creation and naming paths found by targeted search. MS-RDL citations come from two vendored sections only.

## R1 — Drag mechanism in the webview

**Decision**: Use native HTML drag-and-drop (`draggable` cards, `dragover`/`drop` on the canvas viewport) for pointer creation. The drop point is converted with the existing `clientToBody` transform and snapped with the existing `snapDelta`/guide logic; Alt during `dragover`/`drop` bypasses snapping as for moves.

**Rationale**: The source (catalog) and target (canvas) are separate panels; the existing pointer-capture gesture owner is bound to items inside the canvas. Native DnD crosses panels without a new gesture engine or dependency, works in VS Code webviews, and supplies Escape cancellation for free. The footprint preview reuses the existing `.preview` rendering.

**Alternatives considered**: Extending the pointer-capture gesture owner to start in the catalog (couples two panels to one owner and duplicates cancellation rules); a drag library (new dependency for a single interaction, rejected by principle IV).

## R2 — Who allocates the default name

**Decision**: The host allocates the name from the accepted document syntax at execution time, using a new `nextName(stem, reserved)` helper beside `uniqueName` in `packages/validation/src/validate.ts`: the stem plus the lowest positive integer not in use (Textbox1, Textbox2…). The reserved set is all report item names (`reportItemNames(root)`) for textboxes and tables, and all dataset names for datasets.

**Rationale**: Only the host sees the full syntax, including preserved and opaque subtrees and truncated structure, so only it can guarantee MS-RDL 2.16.1 uniqueness ("unique for all report items within a Report"). Allocation at execution also removes races with independent edits between request and execution.

**Alternatives considered**: Client-proposed names validated by the host (the client cannot see names inside preserved content and would need retries on collision; retries are forbidden by the existing transport rules).

## R3 — Telling the designer what was created

**Decision**: Add an optional `created: { id, name }` to the `editResult` message for accepted creations. The designer selects that ID in the matching accepted snapshot, using the existing snapshot/result order settlement.

**Rationale**: Scene and structure IDs are version-scoped, so a newly created item cannot be recognized by diffing IDs. The current flow matches by the client-chosen name, which no longer exists.

**Alternatives considered**: Reusing `mappings` with a synthetic source ID (overloads its source-to-result meaning); matching by "the one name not present before" (fails when structure is truncated).

## R4 — Positions in creation payloads

**Decision**: `createTextbox` and `createTable` payloads carry `left` and `top` as RdlSize strings in the current display unit (validated with the existing size parser), replacing `name` (and `dataset`, `field`, `width` for tables). The payload key validator requires exact keys, so the vocabulary entries change rather than gaining optional keys. `createDataset` payload becomes empty.

**Rationale**: Keeps the closed authoring vocabulary and exact-key validation unchanged in mechanism. Units remain explicit strings, as in all existing geometry edits.

**Alternatives considered**: A separate move edit after creation (two undo steps, violates FR-006).

## R5 — Unbound tables and the table profile

**Decision**: `planTable` gains an unbound creation branch: two `1in` columns, a header row and a detail row of `0.25in`, empty static cells, no `DataSetName`, no detail group. The projector already reads `DataSetName` as optional (`dataset: null`). Binding uses a new `setTableDataset` action (inserts or replaces `DataSetName`, and adds the detail group when the table has none), and `renameTable` handles renaming. A new diagnostic is emitted for an unbound top-level table when the report has more than one dataset.

**Rationale**: MS-RDL 2.23.10 Tablix.DataSetName (`vendor/02-structures/2.23.10-tablix.datasetname.md`): the element is optional; with exactly one dataset it is interpreted as that dataset; with more than one it MUST be specified for a top-level table. The diagnostic surfaces the invalid case without auto-binding (FR-011).

**Alternatives considered**: Blocking table creation when several datasets exist (contradicts the clarified option C); auto-binding to the first dataset (rejected in clarification).

## R6 — Paste and duplicate naming

**Decision**: `allocateNames` in `packages/validation/src/clipboard.ts` keeps a free original name (cut/paste unchanged) and otherwise uses `nextName(stem, reserved)` instead of `uniqueName(stem, reserved)`.

**Rationale**: `uniqueName` returns the bare stem first, so duplicating Textbox2 when the bare name "Textbox" is free produces "Textbox" instead of Textbox3. One numbered rule for creation and copies satisfies FR-004/FR-013.

**Alternatives considered**: Keeping two rules (inconsistent names across creation and paste).

## R7 — Keyboard default position

**Decision**: The designer computes the default position: visible body top-left (from the current scroll and zoom) plus a 0.25in inset, snapped when snapping is on, offset by one grid step for each consecutive keyboard creation of the same session that would reuse an occupied top-left. It is sent through the same payload as a drop.

**Rationale**: Position is view-dependent; the host cannot know the visible area. The same payload keeps one creation path.
