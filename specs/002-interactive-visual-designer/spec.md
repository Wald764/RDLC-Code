# Feature Specification: Interactive Visual Designer

**Feature Branch**: `main` (current branch; no branch-creation hook is configured)

**Created**: 2026-10-18

**Status**: Draft — specification quality validated; ready for planning

**Input**: Enrich the released RDLC Code 0.1.0 graphical editor with direct manipulation, multiple selection, viewport navigation, placement aids and safe clipboard operations. Extend the existing editor without rebuilding it. Every accepted graphical operation remains validated, atomic, undoable and lossless. This phase specifies behavior only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Position and Size Items Directly (Priority: P1)

As a report author, I want to drag supported items and resize them using handles, so that I can arrange a report without repeatedly typing coordinates.

**Why this priority**: Direct manipulation is the core improvement over existing selection and property forms.

**Independent Test**: Open a report with two body textboxes, a supported table and preserved foreign content. Drag a textbox diagonally, resize it from its top-left corner, move and resize the table, then undo, redo, save and reopen each accepted operation.

**Acceptance Scenarios**:

1. **Given** a supported textbox, **When** the author selects and drags it, **Then** a temporary preview and proposed body-relative coordinates follow the pointer; release commits its position once, updates its existing properties and retains selection.
2. **Given** a textbox with all four geometric properties editable, **When** the author drags any of its eight resize handles, **Then** only the corresponding edges move; a corner changes both dimensions in one operation, and the opposite edges stay fixed.
3. **Given** a supported table, **When** the author selects its outer frame and drags it, **Then** the whole table moves with unchanged cell contents, column widths, row heights, groups and totals.
4. **Given** a supported table, **When** the author resizes its outer frame, **Then** affected column widths and/or row heights scale proportionally, the outer dimensions remain consistent, and bindings, hierarchy, groups and totals are unchanged.
5. **Given** an in-progress gesture, **When** the author presses Escape, loses pointer capture, changes editor focus, or the document changes independently, **Then** the preview is discarded, no gesture edit is committed, and any cancellation caused by a document change is explained.
6. **Given** a completed move or corner resize, **When** the author invokes native Undo once and Redo once, **Then** the complete operation is reverted and reapplied; a save during preview contains only previously accepted document state.

---

### User Story 2 - Arrange Several Items Together (Priority: P1)

As a report author, I want to select multiple body items, move them together and align them precisely, so that repeated layout adjustments remain consistent.

**Why this priority**: Bulk arrangement delivers the next essential designer workflow and must prevent partially applied edits.

**Independent Test**: Select two textboxes and a table, move them together, align their left edges, distribute three nonoverlapping items horizontally, and undo each command once. Repeat with one ineligible member and check that nothing changes.

**Acceptance Scenarios**:

1. **Given** several body items, **When** the author modifier-clicks them or draws a marquee from blank body space, **Then** membership, selection count and the primary item are visibly indicated; repeating a modifier-click toggles membership.
2. **Given** a multi-selection, **When** the author drags one selected item, **Then** every member receives the same displacement, preserving relative offsets, without changing parent containers or source order.
3. **Given** two or more movable items, **When** the author chooses left, horizontal-center, right, top, vertical-center or bottom alignment, **Then** the corresponding edges or centers align to the primary item in a single operation.
4. **Given** at least three movable items with nonnegative space between the two outer anchors, **When** the author requests horizontal or vertical distribution, **Then** the outer items stay fixed and the gaps between consecutive item bounds become equal on that axis.
5. **Given** a mixed selection containing a locked placeholder, **When** the author attempts a bulk mutation, **Then** the whole operation is refused, the blocking member and reason are identified, and no supported member is changed silently.
6. **Given** an accepted group move or alignment, **When** its accepted state appears, **Then** the same logical items remain selected; subsequent Undo restores the entire group without extra undo steps.

---

### User Story 3 - Navigate and Place with Precision (Priority: P2)

As a report author, I want zoom, scrolling, a configurable grid, snapping, visual guides and keyboard nudging, so that I can work on small details and large report bodies accurately.

**Why this priority**: These aids improve precision without changing report semantics.

**Independent Test**: At 50%, 100% and 200% zoom, navigate to an offscreen item, move it by keyboard, snap its edge to a sibling and resize against a grid line. Check the same report-space result at every zoom.

**Acceptance Scenarios**:

1. **Given** a body larger than the viewport, **When** the author scrolls or uses the pan gesture, zoom controls, 100%, Fit Page, Fit Body or Reveal Selection, **Then** the requested area becomes reachable and neither report content nor undo history changes.
2. **Given** a 10pt grid with grid snapping enabled, **When** the author moves a selection near an intersection, **Then** its bounding box's top-left snaps to the nearest grid coordinates and all members retain their offsets.
3. **Given** a moving or resizing item near an eligible sibling edge or center, **When** guide snapping is enabled, **Then** a labeled guide identifies the target and the proposed matching edge or center; the tolerance is visually constant across zoom levels.
4. **Given** enabled snapping, **When** the author holds the documented temporary-bypass modifier during a gesture, **Then** both snapping modes are bypassed until release of that modifier.
5. **Given** canvas focus, **When** the author presses an arrow key or Shift+arrow, **Then** the eligible selection moves by exactly 1pt or 10pt respectively, regardless of zoom or grid spacing; a held key commits once on release.
6. **Given** focus in a property field, **When** the author types, selects text, uses clipboard shortcuts or presses arrow keys, **Then** normal field editing occurs without moving or copying report items.

---

### User Story 4 - Reuse Items without Losing Content (Priority: P2)

As a report author, I want to copy, cut, paste and duplicate supported items, so that I can reuse layouts while preserving their full definitions and dependencies.

**Why this priority**: Reuse saves repetitive work but requires stronger preservation and reference guarantees than a move.

**Independent Test**: Copy and duplicate a textbox with foreign metadata, then copy a grouped table and a multi-selection within one document. Check unique names, preserved metadata and valid references. Exercise safe transfer to another compatible report and refusal when a dataset or namespace dependency is unavailable.

**Acceptance Scenarios**:

1. **Given** a supported selection, **When** the author copies it, **Then** its full preserved definitions and relative layout are captured without changing the document; Paste into the same report inserts a selected copy offset by 10pt horizontally and vertically.
2. **Given** a compatible clipboard selection, **When** the author pastes it, **Then** every inserted report item and group receives a valid name unique in the destination, understood internal references follow the copies, and external dependencies are validated without being created or changed implicitly.
3. **Given** a supported selection, **When** the author invokes Duplicate, **Then** it creates the same result as copy-and-paste in one undoable operation while leaving the clipboard unchanged.
4. **Given** a selection whose removal is safe, **When** the author invokes Cut, **Then** the clipboard is successfully populated before the entire selection is removed in one undoable operation; clipboard failure leaves the source unchanged.
5. **Given** a referenced item or an opaque dependency that prevents proving safe removal or renaming, **When** the author cuts, copies for insertion, pastes or duplicates the affected selection, **Then** the affected operation is refused with the dependency and corrective action; it never drops metadata or leaves dangling references.
6. **Given** valid cross-document clipboard content, **When** destination dataset names, field names/types, expression scopes and namespace bindings are compatible, **Then** paste preserves its definitions; missing, incompatible or unprovable dependencies refuse the complete paste without modifying either report.
7. **Given** malformed, oversized, foreign-version or plain-text clipboard content, **When** the author pastes on the canvas, **Then** no report mutation occurs and a useful explanation appears; report content is never executed or treated as commands.

---

### User Story 5 - Understand Limits and Keep Existing Workflows (Priority: P1)

As a report author, I want clear feedback about editable and preserved content, consistent properties, and normal document commands, so that graphical editing remains trustworthy.

**Why this priority**: Data preservation and predictable integration are prerequisites for every new interaction.

**Independent Test**: Open a report mixing supported content, rich text, unknown namespaces, an unsupported structure and expression geometry. Attempt each applicable interaction, use existing property/table commands, edit source in a second view and exercise failure handling.

**Acceptance Scenarios**:

1. **Given** preserved unsupported content with known bounds, **When** the author selects its labeled placeholder, **Then** the editor explains its limitations, offers source access and exposes no unsupported mutation handles; unknown bounds are listed without inventing a selectable area.
2. **Given** one selected supported item, **When** the author changes geometry using its existing properties, **Then** canvas bounds, handles and displayed values agree; a later gesture starts from the accepted values.
3. **Given** an unapplied property draft, **When** a gesture or selection change would discard it, **Then** the author must explicitly apply or discard it, or cancel the new action; the draft is not silently overwritten.
4. **Given** a source edit or another view's mutation during a gesture or pending submission, **When** the designer receives the new document state, **Then** it displays that state, cancels stale drafts with an explanation, and never applies the previous gesture to a different item.
5. **Given** a refused operation or failed Save, **When** the author inspects the report, **Then** accepted unsaved work is retained; the refused operation has no partial effects and source access remains available.
6. **Given** keyboard-only use, **When** the author selects items, extends selection, aligns, duplicates, uses clipboard commands, changes zoom and edits precise sizes through properties, **Then** every new function is reachable through labeled controls with visible focus and no focus trap.

### Edge Cases

| Case | Required observable result |
| --- | --- |
| Click or negligible motion | Motion below 3 screen pixels is a click, not a move; a geometrically unchanged result creates no edit or undo step. |
| Overlap, hidden or zero-sized placeholders | Use drawing order for hits and offer keyboard-accessible selection from the item list for obscured items; unknown/invalid bounds do not become fabricated editable rectangles. |
| Missing dimensions | Derive textbox dimensions from its container according to the cited rules; only commit properties whose resulting geometry can be determined and verified. Never equate a missing width/height with zero. |
| Expression or opaque geometry | Never evaluate or replace it with a literal as a side effect. Disable any gesture depending on an unknown dimension; unrelated safe properties retain their existing capabilities. |
| Negative position or inverted size | Show invalid preview and refuse release; do not flip, clamp silently or partially move a group. Width and height must remain positive. |
| Item extends beyond body/page | Keep overflow visible and reachable, show a boundary warning, and never enlarge body/page, crop content or repaginate implicitly. Nonnegative positions and positive dimensions remain required. |
| North/west table resizing | Adjust position and proportional sizes together; fixed opposite edges and consistency must survive rounding. |
| Mixed units and high zoom | Preserve units on changed explicit dimensions; never rewrite untouched equivalent values. Quantization must not turn a positive dimension into zero. |
| Pointer leaves viewport | Edge auto-scroll allows continued manipulation; release outside commits only with valid capture and preview, otherwise cancels. |
| Capture loss, Escape, focus loss | Cancel the entire uncommitted pointer or key-repeat preview, with no dirty-state change. |
| Unsupported selection member | Show the selection but disable/refuse ineligible bulk mutations as a whole; never operate on an undisclosed subset. |
| Distribution would require negative gaps | Refuse with an explanation; two-item distribution is unavailable. |
| Table cells versus table frame | Cell selection retains existing text/binding editing; cells cannot independently move, resize, cut or duplicate. A separate outer-frame target selects the body table. |
| Collision or unavailable reference analysis during duplication | Refuse the entire insertion if new unique names or safe reference mapping cannot be established. Never guess at opaque expression rewriting. |
| Unknown XML in copied subtrees | Retain raw content and namespace meaning; if dependencies or identity-bearing metadata cannot be safely preserved under insertion, refuse instead of stripping it. |
| Stale clipboard source | Copy is a captured snapshot, not a live pointer; paste revalidates that snapshot against the current destination. Cut rechecks the current source before removal. |
| Read-only, stale request, rejected host apply, parser budget | Refuse mutation, display the actual accepted state and actionable reason; no automatic stale retry or bypass of existing limits. |
| Native Undo/Redo while previewing | Cancel preview first, then perform the requested native document operation; do not create a separate designer history. |
| Reload, editor close or different view | Disposable viewport state is separate per view; pending gestures are never recovered as edits or written to the report. |

## Requirements *(mandatory)*

### Functional Requirements

#### Selection and supported operation boundary

- **FR-001**: The designer MUST extend existing single-item canvas selection with additive/toggle selection, marquee selection, Select All body items, clear selection and an explicit primary item. Plain click replaces selection; Shift+click toggles; the last newly added item becomes primary, and removing it makes the last remaining selected item primary. Blank click or Escape clears selection when no gesture/draft needs cancellation. A marquee selects wholly enclosed body-item bounds; Shift+marquee adds them in document order. No selection action changes the report.
- **FR-002**: The designer MUST distinguish body textboxes, whole body tables, table cells and preservation-only items. The capability matrix below MUST govern command availability and be enforced on submission. Selected placeholders MUST identify their construct and reason; source access MUST remain available for items lacking bounds.
- **FR-003**: Overlapping body items MUST be hit-tested in descending effective ZIndex, with later source order on ties; missing ZIndex means zero. This ordering MUST NOT reorder the XML or introduce ZIndex edits. A keyboard-accessible item list MUST allow selection of obscured items, membership toggling, Select All and primary-item identification without pointer input.
- **FR-004**: After the designer's own accepted operation, selection MUST remain on the same logical surviving items or the newly inserted copies, and deleted items MUST leave selection. After independent source changes or Undo/Redo, selection MUST be reconciled only when identity is unambiguous; otherwise clear it and explain why. Scene ordinals MUST NOT identify targets across document versions.

#### Atomic manipulation

- **FR-005**: Dragging MUST provide a nonpersistent preview of one item or a multi-selection, including proposed geometry. A completed move MUST change only intended position properties, with the same displacement for every selected body item, except that an implicit textbox dimension MUST be made explicit when necessary to preserve its accepted pre-move size. This necessary insertion is part of the same declared footprint and undo step. Gestures MUST NOT reparent items or change their drawing/source order.
- **FR-006**: Eligible single body items MUST expose eight resize handles. Textbox handles MUST change only relevant position/dimension properties, preserve the opposite edges, and allow independent axis sizing without an implicit aspect-ratio lock. Multi-selection scaling is outside scope; authors resize individual members through handles or existing properties.
- **FR-007**: Whole-table resize MUST proportionally change all columns on the horizontal axis and all rows on the vertical axis, including subtotal/total rows. Any explicit outer dimensions MUST be synchronized; absent outer dimensions MUST remain derived. The operation MUST preserve cell text, expressions, metadata and hierarchy, introduce no invalid/nonpositive dimension, and be refused if the supported table profile cannot prove consistency.
- **FR-008**: Every completed gesture, bulk command, paste, cut, duplicate and key-repeat sequence MUST be one validated, all-or-nothing document operation and exactly one native undo step when it changes content. Preview, cancellation, refusal and no-op MUST create no document changes, dirty state or undo entries. Partially eligible selections MUST NOT be mutated partially.
- **FR-009**: A new document version, Escape, pointer cancellation/capture loss or editor focus loss MUST cancel uncommitted manipulation. A submitted operation MUST be checked against its original document version; a stale operation MUST be rejected without automatic reinterpretation. During an unresolved submission, the designer MUST prevent overlapping new mutations and show pending status; independent document changes remain authoritative.
- **FR-010**: Proposed authored positions MUST be finite and nonnegative, dimensions finite and positive. Invalid release MUST restore accepted geometry with a reason; body/page overflow MUST warn without changing page/body settings or preventing a geometrically valid edit. Numerical report-space error MUST be at most 0.01pt per changed coordinate/dimension, without cumulative drift in repeated moves. Changed explicit values MUST retain their units; a newly needed size property uses the view's chosen unit, default pt. Unchanged values MUST retain their exact spelling.

#### Viewport and placement aids

- **FR-011**: Authors MUST have numeric zoom from 25% to 400%, zoom in/out, 100%, Fit Page, Fit Body, Reveal Selection, horizontal/vertical scrolling and Space+drag panning over the canvas. Toolbar zoom preserves the viewport center; pointer zoom preserves the report point under the pointer. Fit commands choose the largest zoom in the supported range that fits the requested bounds; if the bounds cannot fit at 25%, scrolling remains available. Navigation MUST leave geometry and selection unchanged.
- **FR-012**: Report-space coordinates MUST be independent of zoom, scrolling and display scaling. Items beyond the page/body boundary MUST remain navigable. Pointer manipulation near a viewport edge MUST auto-scroll without changing the report-space anchor unexpectedly. The surface MUST continue to identify itself as an authoring layout, not runtime pagination or a data-populated preview.
- **FR-013**: Authors MUST independently control grid visibility, grid snapping, guide visibility and guide snapping, choose a positive finite grid spacing in pt, pc, in, mm or cm, and choose displayed units. Defaults are 10pt spacing, visible grid/guides and both snapping modes enabled. Invalid spacing MUST leave the previous valid setting active with an explanation. Settings MUST be retained per editor view across hide/show and MUST NOT be serialized into RDLC or shared undo history.
- **FR-014**: Grid snapping MUST use the body origin. Move snaps the selection bounding box's top-left to the nearest grid intersection; resize snaps the dragged edges. Exact grid ties choose the smaller coordinate. Sibling/body-boundary guide snapping MUST consider matching left/center/right and top/center/bottom lines within 6 screen pixels, excluding selected members and items with unknown geometry. Per axis, the nearest guide wins over the grid; guide ties prefer body boundaries, then earlier source order, then the smaller target coordinate. The active guide and proposed value MUST be visible when guide visibility is enabled. Alt temporarily bypasses both snapping modes during pointer manipulation without changing preferences.
- **FR-015**: For two or more eligible body items, alignment commands MUST align left, horizontal center, right, top, vertical center or bottom to the primary item's corresponding line, preserving sizes. Distribution MUST require three or more eligible items, sort by position on the chosen axis with source-order ties, keep the outer two fixed and equalize nonnegative edge-to-edge gaps. These explicit commands MUST ignore snapping settings and reject any invalid result atomically.
- **FR-016**: With canvas focus, arrow keys MUST move the eligible selection by 1pt and Shift+arrow by 10pt, without snapping. Each discrete press is one command; repeats between keydown and keyup form one operation. Escape/focus loss cancels repeat preview. Selection MUST survive accepted nudges so consecutive presses do not require reselection. These bindings MUST NOT intercept editing in inputs or unrelated VS Code contexts.

#### Clipboard and duplication

- **FR-017**: Copy, Cut, Paste and Duplicate MUST be available as labeled designer actions and through standard platform clipboard shortcuts with canvas focus; Duplicate uses Ctrl+D on Windows/Linux and Cmd+D on macOS. They MUST apply only to eligible whole body items, never implicitly to their cells or external resources. Copy MUST not change the document or undo history; Duplicate MUST not modify the clipboard.
- **FR-018**: Copy/Paste MUST support a single textbox, whole supported table and same-body multi-selection within the current report and between open compatible reports in the same VS Code window. Clipboard capture MUST preserve complete selected subtrees, relative order/layout, unknown attributes/children and namespace meaning, not just the visually supported properties. Paste MUST validate clipboard structure, supported version, size/depth limits and destination dependencies before any mutation. Plain text/arbitrary XML import, cross-window and external-designer clipboard interoperability are outside scope.
- **FR-019**: Paste MUST insert into the destination's body, preserving relative positions and order, offset by 10pt on each axis for the first paste, 20pt for the next consecutive paste of the same capture in that view, and so on. A new copy/cut resets the sequence. Duplicate MUST always offset the current selection by 10pt. Offsets MUST ignore snapping; overlap is allowed and overflow warns. Inserted items MUST be selected and visible using Reveal Selection. Failed operations MUST not advance the offset sequence.
- **FR-020**: Paste/Duplicate MUST assign valid report-wide unique names to every copied report item, including table-cell textboxes, and unique group identities where applicable. Understood internal references MUST be mapped to the corresponding copied identity; external references MUST retain their intended targets. Existing datasets, fields, groups outside the capture and other resources MUST never be duplicated, renamed or modified implicitly. A same-name dataset is insufficient if referenced field types/scopes differ. Any ambiguous reference or opaque identity-bearing extension preventing proof of preservation MUST refuse the complete insertion.
- **FR-021**: Cut MUST require the existing contained-content deletion acknowledgement and pass existing reference/removal guards for all members, including references from outside the selection and opaque potential references. It MUST ensure a usable clipboard capture before removing any source content. Clipboard failure or stale source MUST leave the source untouched; source Undo MUST restore the complete cut selection. Clipboard contents themselves are outside document Undo/Redo.

#### Integration and preservation

- **FR-022**: Single selection MUST reuse existing property, binding and authoring commands for the selected logical target. Whole-table selection MUST expose the existing table controls; cell selection MUST retain existing cell controls. Multi-selection MUST show count, primary item and bulk arrangement commands, with single-target mutation forms unavailable until one target is selected. Unapplied property drafts MUST follow User Story 5 scenario 3; independent document changes MUST invalidate stale drafts with an explanation.
- **FR-023**: New operations MUST use the same authoritative RDLC XML document and native Save, Save As, Undo, Redo, dirty state and conflict behavior as 001. No graphical operation may regenerate the whole XML, maintain an independent saved report, or silently apply previews on Save. Failure handling MUST retain previously accepted unsaved content.
- **FR-024**: Every edit MUST preserve all source outside its declared edit footprint exactly, and all unrelated XML, namespaces, comments, attributes, unknown properties and unsupported structures within affected parents. Copied subtrees MUST preserve namespace meaning and untouched lexical content except explicitly necessary identity, geometry and local namespace adjustments. An operation whose preservation cannot be established MUST be refused with the affected item, reason and corrective action. No schema conversion or whole-document formatting may occur implicitly.
- **FR-025**: Existing unsupported profiles, parser budgets, property capabilities, validation and reference protections MUST remain effective. Unsupported neighbors MUST not prevent safe unrelated geometry edits; selecting one MUST not grant authoring capability. No operation may evaluate expressions, execute code, access datasets, resolve external entities or fetch resources. All new workflows MUST work offline in trusted and untrusted local workspaces.
- **FR-026**: Every new function MUST be keyboard accessible with visible focus, labeled controls and announced selection count, pending state, invalid operation and limitation feedback. Pointer resize MUST have the existing numerical property controls as its keyboard equivalent; marquee selection MUST have item-list selection equivalents. Focus MUST remain in a usable designer control after acceptance/refusal and never be trapped by a gesture.
- **FR-027**: Automated acceptance coverage MUST exercise the matrix below, operation footprints and exact source preservation, multi-target atomicity, gesture cancellation, clipboard/reference refusal, unit/zoom equivalence, version races and native lifecycle integration. Fixture provenance and applicable MS-RDL sections MUST be recorded. Tests MUST distinguish authored layout correctness from unverified external RDLC runtime fidelity.

### Compatibility and Scope

This is an incremental interaction feature for the existing 2016/01 definition namespace (`http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`) with exactly one report section. It introduces no new report-version or construct-authoring profile. All entries below remain subject to property-level capabilities and preservation proof.

| Existing construct | New interactive scope | Explicit boundary |
| --- | --- | --- |
| Body textbox with one paragraph/run | Whole-item selection, move, eight-handle resize, multi-select, align/distribute, nudge, copy/cut/paste/duplicate | Geometric values must be determinable; unsupported individual properties remain locked. |
| Body table in 001's supported static-column, unmerged profile, including supported row groups/totals | Whole-table frame, move, proportional outer resize, multi-select, align/distribute, nudge, safe whole-subtree clipboard/duplicate | No new table structure editing, matrix, merged cells, cell dragging, row/column handle editing or runtime row expansion. |
| Cell textbox in a supported table | Existing cell selection, text/style/binding and table commands | Not a free-positioned body item; no independent geometry or item clipboard operations. |
| Rich text, images, lines, rectangles, charts, subreports, custom items, complex/unsupported tablix, nested containers, headers/footers | Inspectable preservation-only placeholders/list entries and source access | No new mutation, reparenting, clipboard or alignment participation. |
| Expression-valued or unknown geometry | Safe existing capabilities only; explicit unavailable-gesture reasons | No evaluation, literal replacement or guessed bounds. |
| Unsupported version, multiple sections, malformed XML, required unknown semantics, budget exceeded | Existing diagnostics and source access | No visual mutation or automatic conversion. |

Existing creation/deletion, textual property editing, page/body configuration, dataset/field authoring, table columns/cells/groups/totals, source access, offline packaging and native document services remain baseline requirements of [001](../001-rdlc-vscode-editor/spec.md), not newly introduced features. This specification adds interaction behavior and regression obligations to them.

Out of scope: report execution, populated preview, printing/export, automatic pagination, live data, additional item kinds or schema versions, grouping into containers, rotation, z-order editing, multi-item resizing, persistent custom ruler guides, touch-specific gestures and collaboration. Existing body/page dimensions change only through their existing explicit controls.

### Required Acceptance Coverage

| Coverage | Mandatory checks |
| --- | --- |
| Direct manipulation | All eight handles for textbox/table, all resize directions, mixed units, implicit dimensions, body overflow, zero/no-op, invalid bounds, cancellation and edge auto-scroll. |
| Group operations | Mixed textbox/table selections; primary changes; all six alignments; both distributions; locked member; one invalid member; no partial edits. |
| Precision/navigation | 25%, 50%, 100%, 200%, 400%; scrolled viewport and display scaling; exact nudge increments; grid ties; guide priority/ties/tolerance; Alt bypass; no navigation edits. |
| Clipboard | Single/multi-item/table subtree; repeated offset; all report-item/group name collisions; known internal/external references; unknown metadata; missing/incompatible dataset; stale capture; invalid clipboard; clipboard write failure; refused cut; exact restoration after Undo. |
| Source preservation | Reuse and extend 001's at-least-12-file corpus with prefixed/default/rebound namespaces, foreign attributes/children inside edited/copied nodes, comments, processing instructions, CDATA, entity spelling, CRLF/LF, Unicode, optional geometry and unsupported neighbors. Assert exact no-op equality, exact outside-footprint equality, intended-only changes, namespace meaning and unchanged unrelated references. |
| Document services | Twenty consecutive mixed operations with complete native Undo/Redo; source/visual split views; independent changes during gesture/submission; duplicate requests; apply refusal; save during preview; failed save; close/cancel; read-only document; encoding/EOL preservation. |
| Offline/accessibility | Installed extension with no network; report-supplied active content remains inert; keyboard-only selection, arrangement, clipboard, numerical sizing and navigation on supported desktop platforms. |

### Key Entities *(include if feature involves data)*

- **Accepted report state**: Current authoritative document content/version, supported capabilities and diagnostics inherited from 001.
- **Selection set**: View-local logical item membership, primary item, item kinds and shared operation eligibility; never report content.
- **Manipulation preview**: Original accepted geometry, captured document version, proposed geometry and valid/cancelled/pending outcome; disposable until one accepted commit.
- **Viewport preferences**: Per-view zoom, scroll position, display units, grid spacing and independent visibility/snapping settings.
- **Placement guide**: Temporary edge/center or body-boundary match with a target, axis and proposed report-space coordinate.
- **Clipboard capture**: Complete preserved item definitions, relative layout, format compatibility and dependencies used to validate insertion; independent of later source edits.
- **Atomic layout operation**: One user intent affecting one or more supported items, with a bounded edit footprint and one native undo boundary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An author completes selection, a diagonal drag, corner resize, multi-item alignment, duplication and save/reopen on the representative report in at most 3 minutes, using no source edits or typed coordinates. The maintainer records a timed acceptance run and its report fixture.
- **SC-002**: Across the acceptance corpus, 100% of no-op/view-only/cancelled/refused cases leave document content unchanged; every accepted edit changes only its intended footprint, preserves all unrelated content and restores exact pre-operation document text after Undo. There are zero silent data losses.
- **SC-003**: Twenty consecutive mixed graphical operations each require exactly one Undo and one Redo, restoring every expected whole-selection state. Invalid, stale and failed operations create zero partial results or extra undo steps.
- **SC-004**: At every required zoom and viewport offset, a 1pt or 10pt nudge, equivalent drag, snap and resize resolve to the expected report-space result within 0.01pt per changed value. After 100 forward/backward nudges, each coordinate differs from its starting value by no more than 0.01pt.
- **SC-005**: On a recorded reference desktop and a report of at most 1 MiB with 100 selectable body items, selection and manipulation feedback appears within 50ms in at least 95 of 100 sampled interactions, and an accepted operation appears within 200ms in at least 95 of 100 samples. Measurements run at 100% and 200% zoom, including a 20-item group move; results identify environment, fixtures and timing boundaries.
- **SC-006**: A keyboard-only reviewer completes multi-selection, each alignment/distribution command, nudging, precise sizing, copy/cut/paste/duplicate, zoom, Reveal Selection, Undo/Redo and Save without pointer input or a focus trap.
- **SC-007**: All clipboard acceptance cases either insert complete valid definitions with preserved metadata and correct identities/references, or refuse with unchanged destination content. All cut failures leave source content unchanged; all accepted cuts are fully recoverable with one Undo.
- **SC-008**: The installed extension completes every new authoring workflow with the network unavailable, with zero report-triggered network/resource/data access or code/expression execution. Unsupported cases remain clearly identified and retain source access.

## Assumptions

- Primary users and desktop/local-workspace targets remain those of 001; publication of 0.1.0 is established by [release evidence](../../docs/validation/release-010.md), despite older draft wording in baseline documents.
- A body table is an atomic layout object. Its cells retain existing content editing; interactive outer resize proportionally adjusts design rows/columns, not runtime rows. Multi-selection is a temporary set, not a new RDLC group/container.
- Defaults and deterministic behaviors in FR-001 and FR-010–FR-021 are product decisions for this feature; planning may refine presentation but must not silently alter these acceptance semantics.
- Copy/paste between compatible reports in the same window is included; external/designer interoperability is not. “Supported” never overrides reference or unknown-content preservation checks, so particular copied subtrees may be refused with an actionable reason.
- Safe known internal reference mapping is required for copied tables/groups; opaque expressions or extensions may legitimately block insertion. Unrelated safe moves must still work.
- The existing TypeScript/Angular architecture and independently testable parsing, validation, serialization, expression analysis and rendering modules are mandatory inherited constraints. No replacement editor, second source of truth, full XML regeneration, new backend or online dependency is authorized.
- The [baseline and dependency analysis](baseline-analysis.md) records inspected source paths, inherited contracts, adaptation needs and MS-RDL citations. These are planning inputs, not an implementation plan or a claim that this new feature is already implemented.
- Existing preservation, compatibility and lifecycle contracts are prerequisites. Selection continuity, whole-table scene identity, batch validation/atomic commits, unit-safe geometry and clipboard/reference handling require bounded extensions of that foundation. Existing public commands and supported reports must remain compatible.
- The grid, guides, zoom and selection are disposable authoring preferences, never report properties. Performance targets are bounded acceptance obligations, not promises for arbitrarily large reports.
