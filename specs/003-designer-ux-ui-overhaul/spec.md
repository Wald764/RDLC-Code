# Feature Specification: Designer UX/UI Overhaul

**Feature Branch**: `main` (current branch; no branch-creation hook is configured)

**Created**: 2026-10-18

**Status**: Draft — requirements quality validated; ready for planning and UX review

**Input**: Create feature 003: progressively overhaul the existing RDLC Code designer into a professional, compact five-zone report-design workspace. Improve discoverability, contextual editing, visual consistency and accessibility while preserving every supported workflow and report-preservation guarantee of features 001 and 002. Specification only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Format a Simple Report (Priority: P1)

As a report author, I want an obvious starting point, searchable components and a contextual inspector, so that I can create a simple report without navigating long technical forms.

**Why this priority**: This is the first-use journey and establishes the core workspace hierarchy.

**Independent Test**: Start without a report, invoke the existing New Report action, insert a textbox named Title, enter text, change its position, size, font and color, then save and reopen.

**Acceptance Scenarios**:

1. **Given** no report is open, **When** the author invokes New Report from the existing host entry point, **Then** the supported blank report opens in Design with components, structure access, the canvas, inspector and status available; no duplicate file-management workflow is introduced.
2. **Given** an editable report, **When** the author searches for Textbox and activates its card, **Then** a compact creation flow requests the required name, creates exactly one supported textbox on confirmation and selects it in canvas, structure and inspector.
3. **Given** the selected textbox, **When** the author edits position, dimensions, text, font and text color in the relevant inspector sections, **Then** accepted values and canvas selection agree, unrelated sections remain absent or collapsed, and native Undo/Redo recovers each accepted edit.
4. **Given** an invalid size or refused edit, **When** the author submits it, **Then** the affected control explains the problem, accepted geometry remains visible and the canvas does not move.
5. **Given** completed accepted changes, **When** the author saves and reopens the report, **Then** the content and formatting remain intact and no display preference has been saved as report content.

---

### User Story 2 - Find and Arrange Existing Items (Priority: P1)

As a report author, I want a report structure synchronized with the canvas and inspector, so that I can find obscured items and arrange them confidently.

**Why this priority**: Reliable selection and stable manipulation must survive the workspace redesign.

**Independent Test**: Open a report with overlapping textboxes, a table and preservation-only content. Select the lower overlapping textbox through Structure, reveal it, multi-select editable items, drag, resize, align, distribute and duplicate them.

**Acceptance Scenarios**:

1. **Given** two overlapping textboxes, **When** the author expands Structure and selects the obscured one, **Then** its identity becomes primary in all three views; its selection outline is distinguishable without changing drawing order or report visibility.
2. **Given** an offscreen item with known bounds, **When** the author selects its structure entry, **Then** the canvas reveals it without changing zoom; selecting an entry with unknown bounds shows its limitation and source action without inventing geometry.
3. **Given** a multi-selection, **When** it changes in either canvas or Structure, **Then** membership, primary item, selection count and eligible commands agree; the inspector shows the multi-selection summary rather than an arbitrary member's editable form.
4. **Given** a drag or resize at any supported zoom and scroll offset, **When** feedback, diagnostics or selection details change, **Then** the canvas origin and gesture anchor remain stable apart from deliberate navigation or edge auto-scroll.
5. **Given** a preservation-only item or unsupported selection member, **When** the author inspects it or opens its context menu, **Then** its limitation and source access are clear and unsupported mutations cannot be invoked.

---

### User Story 3 - Build a Dataset-Bound Table (Priority: P1)

As a report author, I want local data definitions and table controls in the context of my selection, so that I can author a bound table without seeing forms for every table and dataset simultaneously.

**Why this priority**: The overhaul must preserve the existing substantive report-authoring workflows.

**Independent Test**: Create a local dataset with text, number and date/time fields, create a table bound to it, add two field columns, edit a cell, configure a row group and totals, then save and reopen.

**Acceptance Scenarios**:

1. **Given** no dataset exists, **When** the author activates Table, **Then** a prerequisite explanation offers the existing local dataset-definition flow; no fake table or live data connection is created.
2. **Given** a dataset with eligible fields, **When** the author creates a named table and chooses its dataset, first field and width, **Then** the supported table appears and becomes selected with its binding visible in the inspector.
3. **Given** a selected whole table, **When** the author edits columns, row heights, groups or totals, **Then** only that table's contextual controls appear and all existing validation and reference safeguards apply.
4. **Given** a selected table cell, **When** the author changes its text or field binding, **Then** cell properties appear; independent cell movement, resizing and item clipboard operations remain unavailable.
5. **Given** saved grouping, totals and field bindings, **When** the report reopens, **Then** their definitions are unchanged; no populated preview or expression evaluation is implied.

---

### User Story 4 - Adapt the Workspace to Available Space (Priority: P2)

As a report author, I want resizable, hideable panels and persistent display choices, so that the canvas remains usable in both wide and narrow editor groups.

**Why this priority**: Compactness must remain functional when the editor shares space with source or other tools.

**Independent Test**: At each required viewport size, resize and hide panels, restore them, inspect an item, reopen the same editor view and continue working without modifying the report through layout changes.

**Acceptance Scenarios**:

1. **Given** the default wide layout, **When** the author drags a panel separator or uses its keyboard equivalent, **Then** the chosen width changes within bounds while retaining a usable canvas and independent panel scrolling.
2. **Given** an idle canvas, **When** the author hides or restores a panel, **Then** selection and zoom remain unchanged and the report point at the canvas center remains anchored, subject only to reachable scroll bounds.
3. **Given** a narrow editor, **When** both side panels would leave insufficient canvas space, **Then** secondary panels collapse into labeled access controls and open as dismissible overlays rather than compressing the canvas below its minimum width.
4. **Given** an in-progress gesture, **When** a panel toggle, automatic breakpoint or window resize would change the canvas origin, **Then** elective layout changes wait until the gesture ends; unavoidable host resizing cancels the gesture before rebasing the view, without committing it.
5. **Given** saved display preferences, **When** the same view is restored, **Then** valid preferences return, oversized widths are bounded to the available space, and no mutation or undo entry is created.

---

### User Story 5 - Work Accessibly with Honest Feedback (Priority: P1)

As a keyboard user or an author using a different theme, I want readable controls, visible focus and truthful status, so that every available workflow remains usable and understandable.

**Why this priority**: Accessibility, contrast and trustworthy capability signaling are release requirements.

**Independent Test**: Complete the textbox, table, structure-selection and arrangement journeys with the keyboard in light, dark and high-contrast themes. Exercise an invalid property, unsupported component and source-only report.

**Acceptance Scenarios**:

1. **Given** keyboard-only use, **When** the author navigates toolbar groups, component cards, the tree, canvas, inspector, menus and status, **Then** each action has an accessible name, visible focus and a usable activation or editing path without a focus trap.
2. **Given** a theme change, **When** the designer updates, **Then** text, controls, selection, handles, rules, guides and limitations remain distinguishable; report formatting values do not change.
3. **Given** unavailable Preview, Parameter or Image authoring, **When** the author encounters it, **Then** it is absent or explicitly marked unavailable as specified below; it never opens a simulated editor or data-populated report.
4. **Given** a diagnostic or rejected command, **When** the author opens its details, **Then** the affected target, reason and corrective action are available through keyboard-accessible feedback without moving the canvas.
5. **Given** malformed or unsupported report content, **When** Design cannot edit it, **Then** a useful source-only state preserves Code XML access and existing diagnostics instead of an endless loading message or enabled mutation controls.

### Edge Cases

| Case | Required observable result |
| --- | --- |
| No selection | Inspector shows report identity, page/body summary and a clear invitation to select an item; page settings remain reachable. |
| Multiple selected items | Count and primary item are explicit; only supported bulk commands are offered; no new bulk property editor or partial mutation is implied. |
| Hidden, zero-sized or unknown-bounds content | Structure remains usable; known geometry can be revealed, unknown geometry cannot be invented, and runtime visibility is not evaluated or changed. |
| Rich text or nested unsupported containers | Preserved nodes identify their true type and limitation; hierarchy does not grant editing capability. |
| Independent XML change, Undo or Redo | Reconcile only unambiguous identities, cancel stale drafts/previews with feedback, and refresh all selection views together. |
| Unapplied draft when switching panel, selection or source | Preserve the draft or offer Apply, Discard and Cancel before an action that would discard it; never silently submit or lose it. Independent document changes retain existing stale-draft cancellation rules. |
| Opening an overlay or context menu over canvas | Overlay does not change the canvas bounds, dismisses with Escape, and restores focus to its invoking control or surviving selected target. |
| Search returns no components | Show a clear no-results state and a clear-search action; unsupported matching cards still identify their unavailable status. |
| Long names, expressions or many diagnostics | Text truncation retains the full accessible value; panels/details scroll internally; the toolbar and status do not grow vertically. |
| Read-only, rejected, stale or pending operation | Existing mutation guards remain effective; accepted unsaved work is retained; no extra retry, partial edit or separate history is introduced. |
| Panel restored wider than editor | Clamp layout preferences and use compact mode while preserving the user's preferred wide-layout dimensions for later restoration. |
| Window narrower than 400 CSS pixels | Preserve all commands through overflow/overlays and allow navigation within the available canvas; the 320-pixel canvas-width guarantee applies from 400 pixels upward. |
| High contrast overrides blue selection | Theme contrast and visible focus take precedence over the default blue accent; color is never the sole selection or error cue. |
| Page preset does not match current report | Show Custom and actual dimensions; choosing a preset requires an explicit supported page edit and never resizes report items implicitly. |

## Requirements *(mandatory)*

### Functional Requirements

#### Workspace and command organization

- **FR-001**: The existing designer MUST present five stable zones: top toolbar, left Components/Structure panel, central canvas, right contextual Properties panel and bottom designer status bar. At the default 1280 × 800 designer viewport, the canvas viewport MUST occupy more than half the workspace width and at least 70% of its height. Panels MUST scroll independently; routine authoring MUST NOT require scrolling the whole workspace to reach the canvas.
- **FR-002**: The top toolbar MUST remain a single compact row with visually separated groups for native history, arrangement, viewport, placement aids and page setup. Actions that do not fit MUST move to a labeled keyboard-accessible overflow menu without being lost or wrapping the toolbar. Icon actions MUST have accessible names and tooltips including existing shortcuts where applicable.
- **FR-003**: Undo/Redo MUST invoke native document history and preserve the active report target when focus is in the designer. Native New Report, Open, Save and Save As remain discoverable through existing host commands; redundant toolbar file actions MUST NOT be added by default. Any justified file-action shortcut MUST invoke the real native action, including dirty-state, cancellation and failure behavior.
- **FR-004**: The toolbar MUST expose all six existing alignments and both distributions with the same primary-item and eligibility rules as 002. Context menus MUST contain only relevant operations; an ineligible but relevant action may be disabled only with an accessible explanation. The toolbar MUST explain insufficient selection or blocked eligibility without presenting technical protocol details.
- **FR-005**: Zoom percentage, increase/decrease, 100%, Fit Page, Fit Body and Reveal Selection MUST remain reachable, retaining the 25%–400% range. Grid visibility and snapping MUST have immediate toolbar access; separate grid/guide visibility, snapping, spacing and units MUST remain available in a compact placement-settings surface. A combined snapping control MUST expose any mixed state and MUST NOT silently merge the independent settings.
- **FR-006**: Page setup MUST expose existing page dimensions, margins and body dimensions, display actual units and distinguish custom sizes from recognized presets. A preset, if offered, MUST only group existing supported page-setting edits; it MUST NOT imply automatic pagination, content scaling or paper-size rendering.

#### Components and structure

- **FR-007**: The left panel MUST provide labeled Components and Structure tabs, defaulting to Components on a new blank report. Each MUST be reachable in one activation from the visible panel header, with its own scroll position retained. Both MUST remain reachable when the panel is hidden. Freely dockable or arbitrarily rearrangeable views are outside this feature.
- **FR-008**: Components MUST offer a labeled search, category headings and compact icon-and-label cards for Textbox, Table, Rectangle, Image, Line, List, Matrix, Chart, Subreport, Dataset and Parameter. Each type MUST have one canonical card; categories are Report items, Containers and Data. Case-insensitive label search MUST retain category context and expose a no-results state.
- **FR-009**: Textbox, Table and Dataset MUST activate real existing creation flows. Dataset creates a local definition, not a canvas object or data connection. Rectangle, Image, Line, List, Matrix, Chart, Subreport and Parameter MUST remain visibly unavailable with a brief accessible reason. Report status or missing prerequisites MAY further disable supported actions with an explanation; a supported table lacking a dataset MUST offer the dataset prerequisite flow.
- **FR-010**: Activating a supported card MUST open only the compact inputs required by the existing creation contract. Confirming MUST insert exactly one item or definition, select it in its relevant views and close the flow; cancelling MUST leave report content and history unchanged. No drag-to-create behavior or additional item-authoring profile is introduced.
- **FR-011**: Structure MUST represent the accepted report hierarchy with expandable/collapsible nodes, type icons, names and editable/preservation-only states. Within a maximum of 2,000 entries, 32 structural levels and the remaining inherited transport budget, it MUST include report/body items, table/row/cell relationships, local datasets/fields, and preserved containers or sections present in the report when their hierarchy can be identified safely. When any limit prevents a complete hierarchy, Structure MUST visibly and accessibly explain the truncation and offer Code XML access without claiming a complete inventory. Truncation alone MUST NOT change report content or editability. It MUST not fabricate missing headers, footers, objects, runtime rows or evaluated visibility. Opaque subtrees MUST be labeled as preserved rather than presented as fully understood.
- **FR-012**: Canvas, Structure and Properties MUST share selection identity, membership and primary target. Tree selection MUST reveal known offscreen bounds at unchanged zoom and expand ancestors as needed; canvas selection MUST reveal its tree entry without resetting expansion elsewhere. If that entry is omitted by FR-011's limits, selection MUST remain intact in canvas and Properties while Structure explains its incomplete coverage and offers Code XML access instead of fabricating an entry. Dataset/field and structural-only selection MUST show relevant details without inventing a canvas selection rectangle. Cell selection and whole-table selection MUST remain distinct.
- **FR-013**: Structure MUST provide keyboard selection, expansion/collapse and the existing additive selection equivalents for eligible body items. Within FR-011's presentation limits, obscured, preserved and unknown-bounds items MUST be discoverable without changing report visibility or drawing order; omitted content MUST remain accessible through Code XML with the truncation explanation. Existing safe identity reconciliation MUST apply after edits; version-specific positions or ordinals MUST NOT be treated as durable identities.

#### Canvas and interaction stability

- **FR-014**: The canvas MUST visually separate a neutral work area, authored page, margins and body boundary. Light mode MUST use a white page with a subtle outline/shadow; dark and high-contrast modes MUST maintain equivalent boundary clarity without altering stored report colors. Horizontal and vertical rulers MUST show readable graduations and chosen units aligned with report coordinates; they MUST track scrolling/zoom and distinguish page origin from body origin. Rulers are viewing aids, not persistent draggable guides.
- **FR-015**: Selected items MUST have an identifiable accent outline and eligible resize handles; multi-selection and the primary item MUST remain distinguishable from hover and focus. Existing optional grid and alignment guides MUST remain usable without obscuring report labels or expressions. The surface MUST continue to identify itself as authored design rather than runtime output.
- **FR-016**: All 002 interactions MUST remain available with unchanged eligibility and semantics: direct drag, eight-handle single-item resize, proportional table resize, marquee/additive selection, pan, scroll, edge auto-scroll, zoom anchoring, snapping/bypass, nudging, alignment/distribution and safe clipboard/duplicate operations. Table cells MUST retain their existing content-editing scope. The overhaul MUST NOT introduce multi-item scaling, reparenting, z-order editing or container authoring.
- **FR-017**: Notifications, validation updates, selection changes, draft warnings, inspector sections, menus and tooltips MUST NOT move or resize the canvas viewport. During active pointer or key-repeat manipulation, elective panel resizing/toggling and responsive transitions MUST be deferred; unavoidable host resizing MUST cancel the uncommitted gesture before changing its coordinate frame. Explicit scrolling, panning, edge auto-scroll and zoom remain intentional navigation.
- **FR-018**: Pointer/report coordinates MUST retain 002's correctness across zoom, scroll, rulers, page decoration, panel layouts and display scaling. Adding visual borders, padding or rulers MUST NOT change the meaning of an authored coordinate. Cancellation, no-op and refusal MUST preserve content and history; accepted geometry MUST remain accurate within 0.01pt.
- **FR-019**: Canvas-item context menus MUST offer relevant supported clipboard, duplicate, delete, arrangement, reveal, properties and source actions, enforcing all existing contained-content acknowledgements and reference guards. Canvas-background menus MUST expose relevant navigation/paste actions. Menus MUST be keyboard-invocable and dismissible, and MUST NOT advertise grouping or other unavailable mutations.

#### Contextual properties and feedback

- **FR-020**: A single selected item MUST show its actual name, type and relevant editable properties in collapsible inspector sections. The available section vocabulary is General, Position and size, Appearance, Typography, Border and background, Data, Visibility and behavior, Pagination and Advanced. Only sections with relevant supported controls or useful read-only explanations MUST appear; empty sections and invented editing capabilities are prohibited.
- **FR-021**: Common supported properties MUST be prominent: textbox/cell text and bindings, supported geometry, font family/size/weight/style, text color and alignment. Numeric size controls MUST expose units; fixed options MUST use constrained controls; color selection MUST retain a text-entry alternative, including supported values that cannot be represented by a picker. Expression-capable fields MUST provide a labeled expression-editing affordance that preserves the unevaluated expression. No unsupported property may be replaced with a guessed literal.
- **FR-022**: Whole-table, cell, dataset and field selections MUST expose their existing contextual controls, including table columns/rows/groups/totals and local definition/reference protections. Controls for unrelated tables or datasets MUST NOT appear in the selected target's form. Read-only names/types MUST not imply rename support where none exists. Destructive commands MUST retain existing confirmations.
- **FR-023**: Editing MUST retain existing accepted-state, apply/cancel, pending-operation and stale-version behavior. Changing control style MUST NOT generate edits while initializing, expanding sections or converting display units. An action that would discard a local draft MUST offer Apply, Discard or Cancel; unrelated layout changes SHOULD preserve it. Refused values MUST be associated with their field and accepted state MUST remain identifiable.
- **FR-024**: No selection MUST show the report-level summary and selection guidance. Multiple selection MUST show count, primary identity, limitations and supported arrangement actions. Preservation-only selection MUST show actual type, reason and Code XML access without unsupported mutation controls. Loading, no-report, invalid-source and source-only states MUST each have a distinct explanation and relevant next action.
- **FR-025**: The bottom bar MUST show Design, Code XML access, diagnostic severity/count, current zoom, display units, actual document dimensions and concise contextual guidance. Overflow details MUST remain accessible without increasing its height. Preview MUST be visibly disabled and labeled unavailable, with an explanation that populated RDLC rendering is not provided; it MUST NOT behave as a working mode. Code XML MUST open the authoritative source using existing host behavior, not a separate editable report copy.
- **FR-026**: Diagnostic details MUST be available from the bottom indicator and expose the affected construct, severity, explanation and corrective/source action where available. Details and transient nonintrusive messages MUST occupy an overlay or reserved region outside canvas layout. Routine successful operations MUST not require dismissal or repeatedly announce technical success messages. Pending, refusal, limitation and failure states MUST remain accessible.

#### Responsive layout, themes and accessibility

- **FR-027**: Both side panels MUST be independently resizable and hideable with labeled restore actions. Default wide-layout widths are 220 CSS pixels left and 300 right; resize bounds are 180–360 left and 240–480 right, constrained further to preserve a canvas at least 320 pixels wide. Keyboard-operated separators MUST expose their values and support 10-pixel steps. Explicit panel resizing is a view operation, never a report edit.
- **FR-028**: Below 1100 CSS pixels workspace width, the left panel MUST default to overlay access; below 800, both panels MUST use overlay access. On compact layouts, at most one side overlay MUST be open at a time, with keyboard dismissal and focus return. At designer viewports 1280 × 800, 1024 × 768, 640 × 480 and 400 × 600, canvas navigation, selection and property editing MUST remain reachable without whole-workspace horizontal scrolling; compact toolbar/status overflow MUST retain all actions.
- **FR-029**: Panel widths/visibility, active left tab, inspector-section expansion and inherited viewport/grid/unit preferences MUST be retained for the same editor view across hide/show and restoration where host view restoration is available. They MUST remain separate from report content and native undo history. Independent editor views MUST not overwrite each other's preferences; invalid/obsolete saved values MUST fall back safely. Active gestures, pending requests and unapplied drafts MUST NOT be restored as edits.
- **FR-030**: The interface MUST follow the active host light, dark and high-contrast themes, fonts and preferred contrast. Normal text MUST reach at least 4.5:1 contrast; large text and essential control/selection/focus boundaries MUST reach at least 3:1 against adjacent surfaces in the reference themes. Blue is the normal selection accent, with theme-defined high-contrast overrides. Shape, text or icons MUST accompany color-only states.
- **FR-031**: Toolbar controls MUST use a consistent compact size with a minimum 24 × 24 CSS pixel activation area, except direct-manipulation handles whose keyboard equivalent is precise property editing. Spacing, typography, separators and icons MUST be consistent across zones; no proprietary Microsoft/Figma assets may be copied. Full names or values hidden by visual truncation MUST remain accessible through focus or details.
- **FR-032**: Every operation introduced or relocated by this feature MUST be keyboard reachable with visible focus and labeled controls. Toolbars, tabs, trees and menus MUST have predictable arrow-key navigation; Tab MUST move between functional groups without visiting every decorative element. Existing canvas shortcuts MUST never intercept normal typing, selection, clipboard or arrow navigation inside fields. Hover explanations MUST also be available on focus, and panel/menu dismissal MUST restore usable focus.
- **FR-033**: Selection count/primary changes, unavailable-action reasons, pending status and errors MUST have screen-reader-readable equivalents. Focus MUST not disappear when sections reconcile, content is deleted or a panel closes. If the invoking item no longer exists, focus MUST move to its surviving parent or a labeled canvas/structure control. At 200% interface scaling, the effective narrow layout MUST preserve the same action access and readable content.

#### Preservation and progressive delivery

- **FR-034**: All supported 001/002 creation, selection, authoring, geometry, clipboard, data-definition, source-access, diagnostics, native Save/Save As, Undo/Redo, dirty-state, conflict and offline behaviors MUST remain available throughout progressive replacement of the current interface. Each migrated workflow MUST remain connected to the existing accepted report state; a separate designer or alternate saved report is prohibited.
- **FR-035**: The serialized report MUST remain authoritative. Every accepted report mutation MUST retain existing validation, bounded atomic edits and native undo boundaries. No-op, view-only, cancelled, refused and initialization actions MUST change no report text. Supported edits MUST preserve unrelated content, unknown structures/attributes, namespace meaning and outside-footprint spelling; no automatic schema conversion or full-document rewrite is permitted.
- **FR-036**: Reports MUST remain inert and fully editable offline within the inherited supported scope. Merely displaying cards, properties, expressions, images or datasets MUST not execute expressions/code, retrieve data, resolve external entities or fetch resources. Existing workspace-trust, read-only, isolation and budget restrictions MUST remain effective.

### Compatibility and Scope

This feature changes presentation and discoverability, not supported report semantics. Its editable scope remains the RDL 2016/01 definition namespace (`http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`) with exactly one report section, inherited from [001](../001-rdlc-vscode-editor/spec.md) and [002](../002-interactive-visual-designer/spec.md).

| Construct or capability | Feature 003 presentation | Boundary |
| --- | --- | --- |
| Simple body textbox, one paragraph/run | Available creation card, tree entry, direct manipulation and contextual properties | Existing property-level capabilities only. |
| Supported body table with static, unmerged columns and supported row groups/totals | Available Table card, table/cell hierarchy, frame selection and contextual controls | Same table profile and proportional resize as 001/002; no matrix or broader tablix support. |
| Supported table cell | Tree/canvas selection, supported text/style/binding controls | No independent body geometry or item clipboard. |
| Local dataset and fields | Available Dataset card, data hierarchy and contextual definition editing | Declarations only; no data retrieval or live preview. |
| Rectangle, Image, Line, List, Matrix, Chart, Subreport, Parameter | Unavailable component cards; existing report content inspectable/preserved where identifiable | No new authoring or execution support. |
| Headers/footers, rich text, complex nested containers and unsupported tablix | Honest hierarchical preservation entries or labeled opaque subtree, limitations and source access | No fabricated layout, editable descendants or unsupported operations. |
| Unknown/expressive geometry or unsupported individual properties | Existing safe capabilities, readable limitations and source access | No expression evaluation or implicit replacement. |
| Malformed XML, unsupported version, multiple sections, exceeded budgets | Existing diagnostics and source-only state | No new compatibility claim, implicit upgrade or destructive save path. |

Out of scope: populated preview, rendering runtime, print/export, live/sample data, new item/property authoring semantics, new report versions, free docking, persistent custom ruler guides, container grouping, z-order editing, collaboration and new touch-specific gestures. Existing properties such as border/background, visibility or pagination appear only if the inherited capability contract actually supports them; category names do not authorize engine extensions.

### Required Acceptance Coverage

| Coverage | Required evidence and requirement mapping |
| --- | --- |
| Simple report and discoverability | Stories 1 and 5; all cards and search states; native file/history actions; toolbar overflow; unavailable preview. FR-001–FR-010, FR-020–FR-026. |
| Hierarchical selection | Story 2; body/table/cell/dataset/field/preserved nodes; overlap, unknown bounds, expansion retention, multi-selection and source edits. FR-011–FR-013, FR-022, FR-024. |
| Manipulation stability | Story 2; drag/resize/marquee/pan/nudge and clipboard at 25%, 50%, 100%, 200%, 400%, scrolled offsets and display scaling; feedback arrival, host resize and deferred panel transitions. FR-014–FR-019, FR-023. |
| Data/table authoring | Story 3; creation prerequisites, every previously supported field type, columns/rows/cells, groups/totals, bindings and guarded deletion. FR-009–FR-012, FR-020–FR-024. |
| Responsive preferences | Story 4; four required viewport sizes, pointer/keyboard separator bounds, hide/restore, overlays, 200% interface scaling, independent views and invalid restored values. FR-027–FR-029, FR-033. |
| Theme/accessibility/feedback | Story 5 in light, dark and high contrast; contrast checks, keyboard completion, focus return, screen-reader announcements, errors, long values and empty/source-only states. FR-025–FR-033. |
| Inherited regression | All applicable 001/002 acceptance cases and existing preservation corpus of at least 12 files; no-op equality, exact outside-footprint preservation, unsupported content, native lifecycle, clipboard safety, offline and inert content. FR-034–FR-036. |

Acceptance must record viewport/theme/zoom, report fixture, workstation and timing boundaries for measured runs. Existing automated checks remain regression gates; visual, accessibility and timed usability outcomes require actual recorded observations. Specification review does not count as executed acceptance.

### Key Entities *(include if feature involves data)*

- **Accepted report**: Authoritative current report version, supported capabilities, document dimensions and diagnostics; unchanged in role from 001/002.
- **Workspace view preferences**: Panel dimensions/visibility, active tab, expanded sections and inherited zoom/grid/unit/navigation state for one editor view; never report content.
- **Component catalog entry**: A named type, category, icon, search label, availability/prerequisite reason and real supported creation action, if any.
- **Structure node**: A report, item, row/cell, dataset/field or preserved structural entry, with parent, type, identity, expansion state, selection eligibility and limitations.
- **Selection context**: Current target or selected body-item set, primary identity, operation eligibility and corresponding canvas/tree/inspector state.
- **Property section**: A relevant group of supported controls or read-only explanations associated with the selected target; expansion is a view preference.
- **Designer status**: Available mode/source actions, diagnostic summary, zoom, units/dimensions and concise interaction guidance, independent of document mutation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a recorded walkthrough with five representative report authors unfamiliar with this redesign, at least four find Textbox insertion, Structure selection, page settings and source access without coaching within 30 seconds per task. At least four rate overall clarity at least 4/5 on a documented five-point scale.
- **SC-002**: At least four of the five authors complete the simple report journey from a blank report through named textbox creation, text/position/size/font/color changes and save in at most 3 minutes, without source editing. Activating Textbox reaches its creation inputs in one activation; a visible tree entry selects its target in one activation; common selected-item properties require at most one section expansion.
- **SC-003**: In a recorded acceptance run, an author defines a three-field local dataset, creates a bound table with two field columns, edits a cell, configures a row group and total, then saves/reopens in at most 5 minutes. All resulting definitions, bindings and expressions remain intact.
- **SC-004**: Across 100 selection changes including canvas/tree, obscured items, cells, datasets and multi-selection, all applicable views agree on identity, primary target and eligibility; in at least 95 cases the visible update completes within 100ms. Selection changes create zero report edits.
- **SC-005**: During 100 representative drag, resize, marquee and key-repeat interactions with feedback/diagnostic/inspector updates, unintended viewport-origin displacement is at most 1 screen pixel and changed report coordinates remain within 0.01pt of the intended result. Every unavoidable host-resize cancellation commits zero gesture edits. Intentional navigation is recorded separately.
- **SC-006**: At all four required viewport sizes and at 200% interface scaling, a reviewer completes selection, insertion, numerical resizing, tree access and native save; zero required actions are unreachable, no whole-workspace horizontal scrolling is necessary, and the canvas remains at least 320 CSS pixels wide from a 400-pixel workspace upward when overlays are closed.
- **SC-007**: In light, dark and high-contrast reference themes, all required text and essential control/focus/selection boundaries meet FR-030 contrast thresholds. A keyboard-only reviewer completes every priority journey, all relocated actions and panel resizing without pointer input, missing focus or focus traps; a screen-reader review identifies selection, unavailable actions, pending state and errors correctly.
- **SC-008**: Across the inherited report corpus of at least 12 files and all applicable 001/002 acceptance cases, there are zero lost workflows, silent content losses, unauthorized semantic changes or new incompatibilities. Every no-op/view-only/cancelled/refused operation leaves report text identical; accepted edits preserve their required footprints and native Undo restores exact prior text. Twenty consecutive mixed accepted edits remain individually undoable and redoable.
- **SC-009**: On a recorded reference desktop with a report up to 1 MiB and 100 selectable body items, selection/manipulation feedback remains within 50ms and accepted-edit display within 200ms in at least 95 of 100 samples, retaining 002's performance targets. Search and panel open/close feedback appears within 100ms in at least 95 of 100 samples. No improvement claim is made without measurement.
- **SC-010**: Every supported journey completes with the network unavailable, with zero report-triggered resource/data retrieval or expression/code execution. Every unavailable catalog action and Preview is correctly identified in the acceptance review; none creates fake output or mutates report content.

## Assumptions

- Primary users remain developers and report authors working in desktop editor windows on supported Windows, macOS and Linux environments. Viewport sizes refer to the designer's available editor area, excluding host chrome; interface scaling is distinct from report zoom.
- Features 001 and 002 are implemented baselines supplied by the user. Source inspection confirms their relevant controls and interaction helpers exist; this specification does not claim their tests or acceptance measurements were rerun.
- The existing Angular/TypeScript/SCSS stack and document engines remain mandatory inherited architecture constraints, recorded with affected paths in [baseline-analysis.md](baseline-analysis.md). The functional requirements prescribe user outcomes rather than a replacement architecture.
- The reference [mockup](../../docs/design/rdlc-code-ui-reference.png) is available and was inspected. Its proportions, compactness, hierarchy and theme examples are inspiration; its depicted image editing, parameters, grouping, populated-looking content and richer properties are not evidence of supported capabilities.
- Proposed defaults are deliberately bounded: two left tabs rather than simultaneous docked subpanels; compact prerequisite forms rather than drag insertion; native host file actions rather than redundant toolbar buttons; Preview disabled with an explanation. The [UX decision register](baseline-analysis.md#ux-decisions-for-validation) records these defaults and the evidence required to validate them. None is an unresolved scope question.
- Display preferences persist per restorable view, not globally across unrelated reports, machines or profiles. No new cross-device settings service or migration of report content is required.
- Five-author usability review is a feature-specific acceptance target, not a claim of already completed research. If results fail, presentation must be refined within this scope rather than treating subjective approval as a substitute for the measurable criteria.
- Progressive delivery may migrate the shell, catalog/tree and inspector in bounded increments, but every increment must retain access to inherited workflows. This specification authorizes no application implementation before planning.
