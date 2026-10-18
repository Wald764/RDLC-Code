# Data Model: Designer UX/UI Overhaul

**Status**: Phase 1 design | **Authority**: [research.md](research.md)

This feature adds presentation metadata and view state, not a new report schema. Existing `TextDocument`, syntax, semantic projection, scene, authoring capabilities and validated edit intents remain authoritative. Source ranges use UTF-16 offsets, consistent with the current parser/document boundary.

## 1. Accepted report and structure projection

An accepted snapshot retains its existing version, status, scene, authoring state when eligible, and diagnostics. Add a read-only `structure` projection:

| Field       | Meaning / validation                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `nodes`     | Flat, source-ordered structural entries; maximum 2,000.                                                                         |
| `truncated` | True when entry/depth/available transport budgets prevent a complete projection; visible limitation and source access required. |

Each **StructureNode** has:

| Field             | Meaning / validation                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Actual XML node ID in the accepted version; unique within snapshot.                                                                               |
| `parentId`        | Emitted parent ID or null for root; no missing parent, cycle or >32-level chain.                                                                  |
| `kind`            | Closed presentation vocabulary: report, sections, section, body, header, footer, textbox, table, row, cell, dataset, field, container, preserved. |
| `label`           | Actual type/name or honest structural label; never evaluated content.                                                                             |
| `name`            | Existing declared name or null; not an authorization to rename.                                                                                   |
| `range`           | Actual source range with finite integer `0 <= start <= end <= source.length`.                                                                     |
| `preservedReason` | Null or an explanation of preserved/opaque scope, including actual unsupported type where known.                                                  |

Join scene items/authoring targets by node ID instead of duplicating their capabilities or geometry. Row/cell labels may describe positions for navigation, but those positions are not durable identities. A cell's actual textbox child may appear where safely identified; do not invent intermediate XML nodes. Layout frames come only from accepted scene bounds.

For parsed source-only reports, show safely identifiable structure while leaving authoring disabled. Missing/unsafe syntax yields no invented root or objects. Unsupported nested containers may expose safely known containment, but every descendant remains within its inherited preservation-only boundary. Unknown or complex subtrees are one labeled opaque entry. Truncation does not change source, parser budgets or report editability by itself; never imply a complete inventory.

## 2. Selection context

Extend `editor/selection.ts` rather than creating independent canvas/tree/inspector stores.

| Mode            | Fields / relationship                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None            | Accepted version, empty membership; report summary in inspector.                                                                                                  |
| Body items      | Existing ordered `bodyItemIds`, `primaryId`; primary must be a member. Includes whole-table frames, not cells.                                                    |
| Cell            | Existing exclusive `cellTargetId`; body membership empty.                                                                                                         |
| Structural/data | Exclusive `structureTargetId`; body/cell selection empty. Covers dataset, field, report/body/section/row and preservation-only targets without a scene selection. |

All modes refer to one accepted version. Tree selection uses the matching scene target when available; dataset/field and structural-only targets have no canvas rectangle. Known bounds support reveal at unchanged zoom; unknown bounds produce limitation/source actions. Multi-selection is restricted to the existing eligible body-item set and shared primary rules.

**Reconciliation**: own accepted operations use existing explicit target mappings. Independent changes retain only unique name/kind/parent identities in both snapshots, extended to unique dataset name and unique dataset+field name. Clear ambiguous, deleted or unnamed structural targets, explain stale cancellation and restore focus to a surviving parent or labeled tree/canvas control. IDs and ordinals never survive versions by assumption.

## 3. Component catalog

Static **ComponentCatalogEntry** fields: canonical type, label, category, original/local icon, search label, availability, prerequisite/limitation reason and optional supported creation action. Availability also depends on accepted report status, pending state and existing capabilities.

| Category     | Canonical cards                               | Action                                                              |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| Report items | Textbox, Table, Image, Line, Chart, Subreport | Textbox/Table invoke real creation; others unavailable with reason. |
| Containers   | Rectangle, List, Matrix                       | Unavailable with reason.                                            |
| Data         | Dataset, Parameter                            | Dataset invokes local-definition creation; Parameter unavailable.   |

Each type occurs exactly once. Case-insensitive label filtering retains category headings for matching entries. Empty results include clear-search. Missing dataset on Table opens the prerequisite explanation/real dataset flow; it creates no placeholder table. Creation inputs retain existing validation and string units. Confirm sends one existing intent; cancel creates no mutation/history entry.

## 4. View preferences

Extend existing `ViewState`; persist through the existing webview `view` state envelope. Unknown fields are ignored; missing or invalid fields default independently so old saved state remains usable.

| Field                                          | Default / validation                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing zoom/scroll/units/grid/guide settings | Retain current validation and independent grid/guide visibility/snapping. Zoom 25%–400%; finite/clamped reachable scroll.                                 |
| `leftWidth` / `rightWidth`                     | Preferred CSS px: 220 / 300; finite, bounded 180–360 / 240–480.                                                                                           |
| `leftVisible` / `rightVisible`                 | Booleans, default true; preference for expanded access, not permission to violate compact mode.                                                           |
| `leftTab`                                      | `components \| structure`, default components for blank reports.                                                                                           |
| `inspectorExpanded`                            | Closed boolean map keyed by supported section vocabulary; common relevant controls default open, rare supported sections collapsed. Unknown keys ignored. |

Effective widths, breakpoint mode and open overlay are derived/transient, not substitutes for preferred widths. If preferred widths cannot preserve a 320px canvas, constrain effective dimensions/collapse secondary panels. At <1100px left uses overlay; at <800px both do, at most one open. Below 400px preserve action access without promising a 320px canvas.

Per-tab scroll, live tree expansion and focus-return targets remain view-local UI state. Reconcile expansion by safe identities on accepted updates. Do not persist version-scoped expansion IDs as durable state. Never restore drafts, pending requests, gestures or selection as report edits. View preferences create zero XML edits and zero native undo entries.

## 5. Layout and interaction state

**WorkspaceLayout**: measured outer width/height, effective panel widths, responsive mode, active overlay, optional deferred elective layout change and pre-transition center anchor. The canvas frame remains the existing viewport client-content origin, dimensions and scroll.

**ManipulationState** remains existing preview/marquee/nudge/pan, with one derived active condition that includes pointer-down below threshold. No independent gesture engine is added.

| Event                                      | Transition / invariant                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Idle panel resize/toggle                   | Capture report center, apply bounded layout, remeasure, restore center at unchanged zoom, clamp scroll. |
| Elective transition while active           | Defer layout; keep coordinate frame and gesture anchor stable.                                          |
| Unavoidable host resize                    | Cancel uncommitted manipulation before applying new layout/rebase; send zero gesture edits.             |
| Gesture completion/cancellation            | Existing commit/cancel semantics, then drain deferred layout.                                           |
| Feedback/selection/draft/diagnostic update | Overlay or reserved fixed region; no frame-size/origin change.                                          |

Ruler ticks are derived from page coordinate × zoom − scroll. Body origin uses the same transform and a distinct marker. Page origin stays `(0,0)` in scroll content; no DPR factor, ruler padding or layout-affecting body border enters report math.

## 6. Inspector and drafts

**PropertySection** fields: closed section key, label, relevant existing controls/read-only explanation, expansion preference and accepted target/version. Vocabulary: General, Position and size, Appearance, Typography, Border and background, Data, Visibility and behavior, Pagination, Advanced. Omit empty/unsupported sections; vocabulary does not grant capabilities.

**InspectorContext** is derived from selection: report summary, multi-selection summary, textbox, whole table, cell, dataset/field or preservation-only. It uses existing authoring lookups and capability checks; no unrelated target forms. Cells never acquire independent geometry/clipboard. Fixed options remain constrained; expressions and non-picker color values keep raw text alternatives.

**Draft** remains the existing target/version/control/original/current state. Relevant transition states are clean, local draft, held conflicting action, submitted/pending, accepted or refused/stale.

- Preserve mounted controls across unrelated layout changes. A potentially destructive target/source/flow transition invokes the existing draft guard before unmounting.
- Apply submits exactly once and clears held navigation; it does not replay stale targets or automatically execute history afterward.
- Discard restores accepted values and runs the explicitly held action. Cancel retains draft/selection/focus.
- Refusal associates the reason with the field and keeps accepted state identifiable. Independent changes cancel stale drafts/previews with feedback; no automatic retry.

## 7. Designer status and operation state

Derived **DesignerStatus** fields: actual snapshot state (loading, no report, editable, invalid/source-only), Design/source actions, disabled Preview explanation, diagnostic severity/count, zoom, units, actual page/body dimensions and concise contextual guidance. Diagnostic details retain target/reason/corrective action and use source navigation where available.

The existing pending report-operation boundary gains correlated native-history settlement. A history result includes request ID, base/result version, action, accepted/changed and optional reason; no-op history still completes. Do not infer current authoring availability from history availability. All accepted report mutations and actual history effects remain host-owned.
