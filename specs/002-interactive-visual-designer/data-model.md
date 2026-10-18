# Interactive Designer Data Model

All records below extend existing projections/contracts; none replaces the authoritative XML `TextDocument`. IDs from a projection are valid only at its document version. Proposed type names describe design responsibilities, not mandatory new classes.

## Accepted report state and scene

| Field | Meaning and validation |
| --- | --- |
| document version | Native monotonically changing version; every mutation targets an exact base version. |
| projection, authoring state, diagnostics | Existing parsed/profile-checked state and capability reasons. Invalid/source-only reports cannot mutate visually. |
| body item identity | Version-scoped source node ID; body textbox, table frame or preservation-only item. Cells retain a distinct parent-table relation. |
| source order / effective ZIndex | Container order and parsed drawing priority, default zero; used for hit order, not XML reorder. |
| geometry | Body-relative point bounds where determinable, plus exact explicit source spellings/units and explicit/derived/unknown provenance per property. Unknown is not zero. |
| capabilities | Per-property and per-operation eligibility with an affected construct/reason. Table scaling additionally requires a consistent supported row/column profile. |

Page/body bounds remain report-owned. Scene bounds remain a derived authoring projection, not a saved layout. Missing textbox width/height derives from container width/height minus Left/Top. A required unknown dimension disables dependent operations only. Placeholder entries without valid bounds remain in the item list without hit rectangles.

## Selection set

`version`, ordered unique `bodyItemIds`, `primaryId` (member or null), or an exclusive `cellTargetId`.

Membership can include locked placeholders; operation eligibility is the intersection for all selected members, with reasons rather than a filtered subset. The primary is the last newly added member; removal promotes the last remaining member. Selection is view-local and never dirty state.

For an own accepted edit, the host supplies a request-correlated old-to-new identity mapping, including inserted/deleted targets, tied to the authoritative result version. Apply that mapping only to the matching snapshot; ordinal carry-over is forbidden. Independent changes/Undo/Redo may reconcile only an unambiguous structural identity (unique item name, kind and parent relationship); otherwise clear with notice. Name alone is not a durable ID.

## Manipulation preview

| Field | Meaning |
| --- | --- |
| baseVersion / original targets | Immutable accepted version, members, primary and starting geometry. |
| kind | Move, one of eight resize handles, or key-repeat nudge. |
| anchor | Pointer report-space anchor or original keydown state, independent of subsequent zoom/scroll. |
| proposal | Proposed geometry, affected axes/properties, temporary placement guides and overflow warnings. |
| validity | Eligible/valid or refusal reason and blocking target; invalid proposals are never silently clamped. |
| requestId | Created at submission, links pending result and authoritative snapshot. |

Transitions: idle → preview → pending → idle; cancellation/refusal/no-op returns to idle with no native edit. Independent version/focus/capture loss or Escape cancels preview. Pending state accepts no overlapping mutation, and never retries against a new version. Result/snapshot delivery may arrive in either order; resolve by request and version rather than arrival order.

Coordinates must be finite, positions ≥ 0 and dimensions > 0. Preserve explicit units on changed properties; leave unchanged lexemes byte-for-byte. Use sufficient decimal precision to meet ≤ 0.01pt error and positive quantization. Starting bounds stay immutable during a gesture to avoid cumulative drift. For implicit textbox size, movement inserts only dimensions required to preserve the original accepted size, in the chosen display unit (pt by default).

## Viewport preferences

Per view: zoom in [0.25, 4], scroll offsets, display unit in {pt, pc, in, mm, cm}, positive finite grid spacing with unit, grid visibility/snapping and guide visibility/snapping. Defaults: zoom 1, pt, 10pt and all visibility/snapping enabled. Store disposable state through the private host adapter's webview state API; validate restored state. No document version/undo coupling, persistence to XML or cross-view sharing.

## Placement guide

Axis, target body/sibling identity, source order, target edge/center, report coordinate, proposed moving edge/center and screen distance. Eligible targets exclude selected items and unknown bounds. Threshold is 6 CSS pixels; tie order is nearest distance, body boundary, earlier source order, smaller coordinate. Guides are ephemeral and independent of visibility preferences.

## Clipboard capture and dependency graph

A capture is an immutable host-owned snapshot of complete selected XML subtrees in source order, their original point geometry, namespace environments, item/group identity declarations, understood reference spans and external dependency descriptors. It records source schema/profile and capture format version; it is not a live reference to source IDs.

Root geometry includes captured physical width/height and explicit/derived provenance. Insertion preserves those sizes across offsets and destination body changes, materializing missing textbox dimensions only when needed in the destination display unit; required unknown bounds refuse insertion. Metadata classification follows the explicit expanded-name/shape rules in the clipboard contract, never namespace-only trust.

Relationships: each capture has one or more roots; a table root includes its cells/groups; understood reference edges target internal copied identities or external dataset/field/item/scope dependencies. Opaque potential references/identities carry an explicit uncertainty reason and prevent unsafe identity-changing insertion or removal. Destination validation resolves external dependencies without creating them.

The native clipboard contains a bounded versioned same-window capture token, not patch authority. Host retention and limits are defined in the [clipboard contract](contracts/clipboard.md). View-local paste sequence is keyed to capture generation: next offset is `(successfulPastes + 1) * 10pt` on both axes; new copy/cut resets generation, failure does not advance, duplicate is always 10pt and leaves clipboard untouched.

## Atomic layout operation

An existing edit intent gains typed multi-target layout/insertion/removal variants: request ID, base version, complete target set, operation-specific values and chosen unit where needed. The host derives authoritative geometry, checks every capability/dependency, computes one footprint and one candidate, reparses/verifies it, and applies one native edit. The UI cannot provide raw patches, paths, arbitrary XML or a subset fallback.

Geometry footprints include only changed position/size values, required implicit-size insertion, proportional table row/column dimensions and synchronized existing outer dimensions. Clipboard footprints include inserted subtrees/local namespace declarations or complete selected-root removals. Target mappings and result version belong to the operation outcome; they are not serialized into the report.
