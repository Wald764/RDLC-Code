# Contract: Creation Protocol and Host Execution

Extends the 002/003 edit protocol (`packages/report-model/src/protocol.ts`, `packages/report-model/src/editing.ts`). Envelope, request IDs, version correlation, queueing, budgets and replay rules are unchanged.

## Vocabulary changes (`authoringFields`)

```text
createTextbox:   ['left', 'top']        (was ['name'])
createTable:     ['left', 'top']        (was ['name', 'dataset', 'field', 'width'])
createDataset:   []                     (was ['name'])
renameTable:     ['name']               (new)
setTableDataset: ['dataset']            (new)
```

Exact-key validation stays as is: every listed key is a required string, extra keys are refused.

## Host execution rules

1. Target must be the report root of the base version; otherwise refuse with the existing actionable reason.
2. `left`/`top` must parse as non-negative RdlSize values; otherwise refuse, no edit.
3. The host computes the name with `nextName` over the accepted syntax (reserved scope per data model), then plans one bounded insertion:
   - textbox: `Left`/`Top` from the payload, `Width` 1in, `Height` 0.25in, empty value;
   - table: unbound static layout (two 1in columns, header and detail rows of 0.25in, empty cells named by the existing cell-name rule), `Left`/`Top` from the payload;
   - dataset: empty local dataset with the existing default query shape.
4. Verification after applying checks the created item by the allocated name, kind and position; a failed verification is refused and reverted by the existing mechanism.
5. The accepted `editResult` carries `created: { id, name }` for the new item in the resulting version.
6. `setTableDataset` requires an existing dataset name; it inserts or replaces `DataSetName` and adds a detail group when absent. `renameTable` uses the report-item name validation and updates references handled by existing safeguards.
7. Creation never evaluates expressions, accesses data sources or edits content outside the inserted element.

## Diagnostics

`TABLE_DATASET_REQUIRED` (warning): emitted by the projector for a top-level table without `DataSetName` when the report declares more than one dataset. Cites MS-RDL 2.23.10. Corrective action: choose a dataset in the table's properties.

## Paste and duplicate

`allocateNames` keeps free original names; otherwise allocates with `nextName(stem, reserved)` where `stem` is the copied name without trailing digits, or the element fallback (`Textbox`, `Table`, `Group`).
