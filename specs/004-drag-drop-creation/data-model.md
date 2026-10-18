# Data Model: Drag-and-Drop Component Creation

## Creation request (designer → host, existing `edit` envelope)

| Action          | Payload keys  | Validation                                                                                   |
| --------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `createTextbox` | `left`, `top` | RdlSize strings with explicit unit, finite, >= 0; target is the report root of the base version |
| `createTable`   | `left`, `top` | Same as above                                                                                |
| `createDataset` | none          | Target is the report root                                                                    |

Removed keys: `name` (all three), `dataset`, `field`, `width` (table). No XML, names or patches are sent by the client.

## Creation outcome (host → designer, existing `editResult`)

| Field     | Rule                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `created` | Optional; present only when `accepted` and a creation action produced an item. `{ id, name }`, ID valid in `version`. |

Validation: `id` matches the existing bounded ID format; `name` is a CLS identifier of at most the existing name length; unknown keys rejected.

## Default name series

- `nextName(stem, reserved)` → `stem + n` for the lowest integer `n >= 1` with the result not in `reserved`.
- Stems: `Textbox`, `Table`, `DataSet`.
- Reserved: all report item names in the report (textboxes, tables, and preserved report items) for `Textbox`/`Table`; all dataset names for `DataSet`.
- Paste/duplicate: original name if free, else `nextName(original name without trailing digits || type fallback, reserved)`.

## Table binding

| State   | XML                                    | Diagnostic                                                                 |
| ------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Unbound | No `DataSetName`, static rows only     | `TABLE_DATASET_REQUIRED` (warning) when the report has more than one dataset |
| Bound   | `DataSetName` = an existing dataset    | Existing table diagnostics                                                 |

New actions: `setTableDataset { dataset }` (bind or rebind; dataset must exist), `renameTable { name }` (existing name validation, report-item scope).

## Drop preview (designer only, transient)

`{ kind, bounds (body px), valid, reason }`, derived on `dragover`; cleared on `dragleave`, `drop`, Escape, blur and workspace resize. Never persisted or sent.

## Keyboard placement state (designer only, transient)

Last keyboard-created top-left per accepted version; used only to offset the next keyboard creation by one grid step.
