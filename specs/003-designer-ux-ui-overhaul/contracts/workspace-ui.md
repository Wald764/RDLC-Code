# Workspace UI Contract

**Status**: Phase 1 design | **Consumers**: report authors, keyboard/screen-reader users and the existing Angular editor.

This contract defines observable presentation behavior. Mutation eligibility and supported semantics remain with the accepted report capabilities and [editor integration contract](editor-integration.md).

## 1. Five stable zones and responsive layout

- A fixed-height single-row toolbar, left Components/Structure panel, central canvas, right Properties panel and fixed-height status strip form the only editor workspace. Panels scroll internally. Feedback/details cannot introduce new flow rows or resize the canvas.
- At 1280 × 800, default left/right widths are 220/300 CSS px; canvas viewport exceeds half the workspace width and reaches at least 70% of height. Keep gutters/separators compact enough to satisfy those measurements.
- Each panel is hideable/restorable and resizable within 180–360px left and 240–480px right, additionally constrained by >=320px canvas width. Keyboard separators expose labels, orientation, current/min/max values and 10px arrow steps.
- Below 1100px the left defaults to overlay access; below 800px both use overlays. At most one side overlay is open. Labeled restore controls and both left tabs stay reachable even when hidden. Escape dismisses overlays and restores invoking/surviving focus.
- At 1280 × 800, 1024 × 768, 640 × 480 and 400 × 600, all actions remain reachable without whole-workspace horizontal scroll; >=320px canvas is guaranteed from 400px upward with overlays closed. Below 400px keep commands available and canvas navigable.
- Layout preference changes are view-only. Idle panel changes preserve center report point and zoom subject to scroll bounds. During manipulation defer elective layout changes; unavoidable host resize cancels uncommitted work before responsive reflow.

## 2. Toolbar and native actions

Single-row groups: native history, arrangement, viewport, placement aids and page setup. Commands that do not fit move into a labeled keyboard-accessible overflow menu. Toolbar/status never wrap or grow vertically.

- Undo/Redo invoke the real document-bound native operations, preserve the report target, respect pending/draft decisions and settle no-op/failure. Normal field history is not stolen.
- Native New Report/Open/Save/Save As remain in existing host entry points; no duplicate file toolbar by default.
- Include all six alignments and both distributions with existing primary/eligibility semantics. Explain insufficient selection or ineligible members without protocol jargon or partial application.
- Retain zoom percentage/increase/decrease, 100%, Fit Page, Fit Body and Reveal Selection within 25%–400%.
- Grid visibility and snapping are immediate toolbar access. Compact placement settings retain separate grid/guide visibility/snapping, spacing and units. Any combined snap control exposes mixed state and never silently merges settings.
- Page setup uses existing page/body dimensions and margins with actual units. A recognized preset only groups existing supported edits; unmatched values show Custom. Never resize content or imply pagination/rendering.

Icon actions have accessible names, focus-visible tooltips and existing shortcuts where applicable. Activation areas are >=24 × 24 CSS px except precision handles with property-editing equivalents.

## 3. Components and compact creation

Components/Structure are two labeled header tabs, each one activation away with independent live scroll retention. Components is the default for a blank report.

Use the canonical eleven-card catalog and categories in [data-model.md](../data-model.md#3-component-catalog). Search is labeled, case-insensitive and retains category context; no results provides clear-search. Unsupported cards are visibly unavailable with focus-accessible reasons, not simulated editors.

- Textbox: required name; one existing creation intent.
- Dataset: required name; local definition only, then select its data entry/details.
- Table: required name, dataset, first field and width; absence of datasets opens an honest prerequisite path to real dataset creation. Do not create a fake table or auto-connect data.
- Confirm creates exactly one supported target, selects it in relevant views and closes on acceptance. While pending, prevent duplicate submission. Refusal keeps actionable feedback and no fabricated selection. Cancel changes no source/history.

## 4. Structure and selection

Use accepted read-only hierarchy with actual nodes, type/name and capability/limitation cues. Include body/table/row/cell, local data and safely identifiable preserved sections/containers. Opaque/truncated content is labeled with source access. Never fabricate absent sections or runtime content.

Canvas, tree and inspector share membership and primary identity. Tree selection reveals known bounds without changing zoom and expands ancestors; canvas selection reveals the tree node without resetting unrelated expansion. Dataset/field/structural-only selection clears geometry selection. Cells and table frames remain distinct. Eligible additive body selection uses existing membership rules; multiple selection shows a count/primary/limitations summary and supported arrangement actions, not one arbitrary member's scalar form.

Tree keyboard behavior: one roving tab stop, Up/Down between visible nodes, Right expand/first child, Left collapse/parent, Home/End bounds, Enter/Space select and existing additive equivalents for eligible body targets. Expand controls never grant mutation eligibility. Unknown bounds explain the limitation instead of inventing a reveal location.

## 5. Canvas, rulers and context menus

Retain every 002 interaction and its guards: drag, eight-handle single-item resize, proportional table resize, marquee/additive selection, pan/scroll/edge auto-scroll, anchored zoom, snapping/bypass, nudging, alignment/distribution and safe clipboard/duplicate. Cells have content editing only. No multi-item scaling, reparenting, z-order editing, grouping or container authoring.

Show neutral work area, authored page, margins and body boundary with rulers tracking chosen units/zoom/scroll and distinct page/body origins. In light mode page is white with subtle outline/shadow; dark/high-contrast retain boundaries without changing stored report colors. Rulers/decoration add no report offsets. Feedback/drafts/diagnostics/selection updates cause <=1 screen-pixel unintended origin displacement; accepted geometry remains within 0.01pt.

Item context menus expose only relevant supported clipboard/duplicate/delete/arrangement/reveal/properties/source actions. Background menus offer relevant navigation/paste. Retain reference guards and contained-content acknowledgements. Relevant disabled actions expose reasons. Shift+F10 or the platform context-menu key opens the menu for the focused target; arrow/Home/End/Enter/Escape navigation and focus return are supported. No unavailable mutation is advertised.

## 6. Inspector, drafts and feedback

Derive inspector exclusively from accepted selection:

| Context           | Presentation                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| None              | Report identity, actual page/body summary, select-item guidance and page setup access.                    |
| One textbox       | Actual name/type and supported text, geometry and style sections.                                         |
| Whole table       | Selected table's binding, columns/rows/groups/totals and supported geometry only.                         |
| Cell              | Supported text/style/field-binding; no independent move/resize/item clipboard.                            |
| Dataset/field     | Selected definition and existing type/rename/delete protections; all seven existing field types retained. |
| Multiple          | Count, primary, limitations and supported bulk commands; no new bulk property editor.                     |
| Preservation-only | Actual type/reason/source, no unsupported mutation controls.                                              |

Only relevant section vocabulary appears. Common properties require at most one expansion; rare supported fields can start collapsed. Unit controls show actual units; fixed options use constrained inputs; colors retain text entry for non-picker values; expressions remain unevaluated raw strings with a labeled editing affordance. Read-only names never imply unsupported rename.

Keep drafts across unrelated layout changes. Before any transition that would discard a draft, offer Apply/Discard/Cancel using existing behavior. Apply sends once and clears held navigation; Discard continues the held transition; Cancel stays. Do not submit on control initialization, section expansion, theme/layout changes or display-unit conversion. Refusal identifies the field/reason while accepted geometry stays visible; stale versions cancel unsafe previews/drafts with accessible feedback.

Status shows Design, real Code XML access, diagnostic severity/count, zoom, display units, actual dimensions and concise guidance. Preview is disabled and explicitly explains populated RDLC rendering is unavailable. Details use overlays/reserved fixed space with keyboard source/corrective actions. Routine successes need no dismissal or repeated technical announcements. Loading/no-report/invalid/source-only states have distinct explanation and next action.

## 7. Focus, themes and accessibility

Toolbar/tabs/trees/menus use predictable arrow-key navigation and functional-group Tab stops. Separators and every action have visible focus/accessibility names. Keep normal editing, clipboard, arrows and selection native within fields; scope canvas shortcuts to their actual interaction contexts.

Menus/overlays restore invoking focus; deleted targets fall back to surviving parent or labeled canvas/tree. Reconciliation never blanket-autofocuses a newly mounted authoring form. Selection/primary/count, pending, refusal/error and unavailable reasons have screen-reader-readable equivalents without flooding announcements.

Use host theme/font tokens, contrast boundaries and high-contrast overrides. Normal text >=4.5:1; large text and essential control/selection/focus boundaries >=3:1. Blue is the normal selection accent but high-contrast theme takes precedence. Shape/text/icons accompany color; truncated names/values retain full accessible content. At 200% interface scaling retain all action access through responsive surfaces.

## 8. Preservation and acceptance

Every relocated control uses existing accepted-state validation and atomic mutation pipeline. No-op/view/cancel/refusal actions change zero report text. Unknown namespaces, unsupported content and outside-footprint spelling are preserved. No card/property/tree/image/dataset display runs code, resolves entities, evaluates expressions or fetches resources; offline and restricted-workspace behavior remain required.

[quickstart.md](../quickstart.md) defines automated and real-desktop acceptance. Manual contrast/layout, screen-reader, timing and five-author results must be recorded; DOM assertions alone do not establish this contract.
