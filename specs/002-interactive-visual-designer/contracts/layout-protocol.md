# Atomic Layout and Host Protocol Contract

Extends [001](../../001-rdlc-vscode-editor/contracts/editor-protocol.md) and the existing `packages/report-model/src/{editing,protocol,scene}.ts` contracts. Existing commands and scalar authoring operations remain compatible.

## Transport and authority

Retain protocol envelope version 1 for coordinated host/designer additions; both ship together. Extend the closed message/intent validators and tests together. Unknown fields/kinds, malformed IDs, nonfinite numbers, duplicate targets and unsupported operations refuse. Existing limits remain 64 KiB for nonsnapshot messages and 8 MiB for snapshots; do not raise them to carry clipboard XML. Existing request/duplicate protections remain active.

The webview is bound to one document and cannot supply paths, source ranges, patches or raw XML. Every mutation has `requestId` and `baseVersion`. The host checks all targets against that version and their body membership, property capabilities and current supported profile. A single ineligible member refuses the complete operation with its identity, reason and corrective action.

## Layout intent

Add a geometry-only `layout` variant to the existing `EditIntent` union, with a closed `action` and action-specific payload:

| Action | Payload | Authoritative computation |
| --- | --- | --- |
| `move` | Ordered target IDs; finite `dxPt`, `dyPt`; chosen unit | Apply identical displacement to all targets, preserving sizes and parent/source order. Covers pointer moves and accumulated nudges. |
| `resize` | Exactly one target ID; one of eight handles; proposed dragged edge coordinate(s) in pt; chosen unit | Hold opposite edges fixed; derive final textbox bounds or proportional table row/column sizes. |
| `align` | Ordered target IDs; primary ID; one of six edge/center modes; chosen unit | Align every member to the primary's corresponding line without changing size. |
| `distribute` | At least three ordered target IDs; horizontal/vertical axis; chosen unit | Sort by position/source order, preserve outer anchors, equalize nonnegative gaps. |

Snapping and viewport transforms compute a proposed pointer result in the view; the host independently validates the resulting report-space geometry. Alignment/distribution use host-derived geometry, not UI-supplied per-target rectangles. No generic arbitrary-action batch endpoint is introduced.

All operations detect geometric no-op before unit conversion or implicit property insertion. No-op yields an accepted unchanged outcome, no `WorkspaceEdit`, no dirty state and no undo step.

## Geometry rules and footprints

- Shared pure size parsing/conversion/formatting lives in an existing domain package (`report-model`), used by host and renderer. Keep scene CSS-pixel coordinates at 96px/in and interaction calculations in pt; conversion must not depend on zoom or device-pixel ratio.
- Missing textbox dimensions derive from the body container minus position, not zero. Unknown/expression geometry is not missing. A safe move inserts a missing dimension only when needed to retain accepted size; use the chosen unit, default pt.
- Preserve units of changed explicit values and exact spelling of untouched values. Formatting precision must ensure ≤0.01pt error and no positive-to-zero quantization. Recompute gestures from immutable accepted origins; test repeated moves for drift.
- Table resize scales all supported design column widths/row heights on affected axes, including totals. Synchronize only already-explicit outer dimensions in their original units; absent outer dimensions stay derived. Use deterministic residual adjustment on the last dimension to keep sums and fixed opposite edges within tolerance, provided every component remains positive and proportional within numerical tolerance. Refuse an inconsistent/unprovable profile or quantization result.
- Do not loop over current scalar table setters: they can insert outer dimensions and change units. Extend their shared patch primitives for one complete resize plan.
- Positions must be finite/nonnegative, dimensions finite/positive. Overflow only warns; no body/page mutation is implied.
- Footprints are the exact geometry scalar replacements/required property insertions. Normalize same-offset insertions deterministically and retain the union of namespace dependencies. No overlapping edits or whole-report regeneration.

## Verification and native commit

1. Validate message shape, request identity, base version and every member/capability.
2. Derive all resulting geometry from one original accepted projection; refuse any invalid member before planning changes.
3. Build one `PatchPlan` against that source, normalize insertions, then call existing `applyPlan` and `verifyCandidate` once for the complete candidate.
4. Operation-specific verification proves target geometry, unchanged unrelated geometry/content, fixed edges, group offsets, table proportionality/positivity/sums and unchanged bindings/groups/totals/hierarchy. Generic footprint checks alone are insufficient.
5. Enter the existing per-document queue shared across views, recheck version immediately before one `WorkspaceEdit`, and retain existing candidate-equality/expected-version checks after apply. Never sequentially apply target edits or retry stale operations.
6. Publish actual authoritative state on acceptance, refusal or uncertain application. Never overwrite an independent change to compensate for uncertainty.

## Results and selection continuity

Extend `editResult` with base/result version correlation, `changed` and host-proven target mappings/ordered inserted IDs as needed. Mapping entries refer only to source IDs in the base version and candidate IDs in the result version; deleted members have no surviving ID. Verify mappings from parsed source correspondence and inserted subtrees, never scene ordinals.

The private host adapter retains the result version and pending request. Snapshot-before-result and result-before-snapshot both reconcile only at the exact authoritative result version; a later independent version invalidates continuity. Repeated same-version snapshots are harmless. Preserve ordered membership/primary on own geometry edits; insertions select copies; removals remove members. A rejected operation displays actual accepted state and returns focus to a usable control.

Independent changes and Undo/Redo reconcile only an unambiguous item identity including kind/parent evidence; otherwise clear with explanation. View-local pending state is not a mutation queue and never replays an old gesture.

## Verification obligations

Extend existing model/protocol, renderer, serializer, controller and candidate-verifier tests. Add same-offset implicit insertions, namespace dependency retention, multi-member atomic refusal, all eight handles for textbox/table, mixed units, tiny positive sizes, no-op and snapshot/result order permutations. Extend native lifecycle tests to prove one complete Undo/Redo and unchanged text after refusal/cancellation, including source split-view races and read-only/apply failures. See [quickstart](../quickstart.md).
