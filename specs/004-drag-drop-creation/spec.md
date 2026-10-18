# Feature Specification: Drag-and-Drop Component Creation

**Feature Branch**: `004-drag-drop-creation`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Drag-and-drop component creation in the RDLC designer, replacing the form-based creation flow. Authors drag a component card (Textbox, Table, Dataset where applicable) from the Components catalog onto the canvas; the item is created at the drop position (respecting grid/guide snapping and the existing Alt bypass), inside the report body, with an automatically assigned unique default name following Report Builder conventions (Textbox1, Textbox2, Table1, …), using the same unique-name rule already used when pasting. No name or creation form is shown before creation; the new item is selected and can be renamed afterwards through the existing Name property in the inspector. Creation is one atomic native edit (single undo), refused safely and visibly when the drop is invalid (outside the body, report not editable, pending edit, read-only). Keyboard and accessibility equivalent: activating a card (Enter/Space or click) creates the item at a sensible default position (e.g. top-left free area or viewport center) with the same default naming. Copy/paste and duplicate keep assigning deterministic unique names consistent with the creation rule. Open question to clarify: how a dropped Table chooses its dataset binding and columns (single dataset auto-bound, prompt only when several datasets exist, or unbound/empty table), and what default size each component gets. Out of scope: new component types not already supported (Image, Chart, Line, Rectangle, List, Matrix, Subreport, Parameter remain unavailable), runtime rendering, changes to the supported RDL 2016/01 profile beyond the creation position and naming."

## Compatibility Scope

- **Report format**: RDL 2016/01 namespace with exactly one report section, as established by features 001–003. No schema upgrade or new report construct is introduced.
- **Supported creation targets**: body Textbox, Table, and local Dataset definitions. All other catalog entries stay unavailable with their existing explanations.
- **Table profile extension**: the supported table profile is widened to allow a body table with no dataset binding. MS-RDL section 2.23.10 Tablix.DataSetName (`vendor/02-structures/2.23.10-tablix.datasetname.md`) makes the element optional, is interpreted as the only dataset when the report has exactly one, and MUST be specified for a top-level table when the report has more than one dataset. An unbound table is therefore valid with zero or one dataset and must be bound when several exist.
- **Naming rule**: report item names are case-sensitive CLS-compliant identifiers unique across all report items in the report (MS-RDL `vendor/02-structures/2.16.1-textbox.name.md`, section 2.16.1 Textbox.Name; duplicate names are a processing error, `vendor/06-appendix-b/6.42-rsduplicatereportitemname.md`, section 6.42). Dataset names keep the existing dataset-name uniqueness rules.
- **Authoring versus rendering**: creation places design-time items only. Nothing is evaluated, previewed or fetched.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Drop a textbox where it belongs (Priority: P1)

An author drags the Textbox card from the Components panel and releases it over the report body. A textbox appears at the drop point, already named (Textbox1, then Textbox2, and so on), selected, and ready to type into or rename from the inspector. No form or name prompt interrupts the gesture.

**Why this priority**: Placing items directly on the surface is the core expectation of a visual report designer. It removes the form step that authors currently perceive as foreign to Report Builder.

**Independent Test**: In a blank report, drag Textbox onto the body twice, then undo once. Verify the first drop creates Textbox1 at the snapped drop point, the second creates Textbox2, each drop is selected immediately, and one undo removes only Textbox2.

**Acceptance Scenarios**:

1. **Given** an editable report with no textbox named Textbox1, **When** the author drops the Textbox card inside the body, **Then** exactly one textbox named Textbox1 is created with its top-left corner at the drop point (snapped to grid or guides when snapping is on), and it becomes the selected item in canvas, Structure and inspector.
2. **Given** snapping is on, **When** the author holds Alt while dropping, **Then** the textbox is placed at the unsnapped drop point.
3. **Given** a textbox was just created by a drop, **When** the author invokes native Undo once, **Then** the report text returns exactly to its state before the drop.
4. **Given** the author drags a card and releases it outside the body (on the page margin, a panel or outside the editor), or presses Escape during the drag, **Then** nothing is created, no history entry is added and the report text is unchanged.
5. **Given** a dropped item would extend past the body's right or bottom edge, **When** it is created, **Then** it is placed at the drop point and the body is not resized; the item remains selectable and movable like any overflowing item.

---

### User Story 2 - Create components from the keyboard (Priority: P1)

An author who does not use a pointer focuses a component card and presses Enter or Space (or clicks it without dragging). The component is created immediately at a predictable default position with the same default naming, and focus moves to the new item so it can be renamed or edited at once.

**Why this priority**: Drag-and-drop alone would make creation inaccessible. The keyboard path must offer the same result in the same number of steps.

**Independent Test**: Using only the keyboard, activate the Textbox card twice and the Dataset card once. Verify Textbox1 and Textbox2 are created at distinct default positions, DataSet1 is created and selected in Structure, and each creation is one undo step.

**Acceptance Scenarios**:

1. **Given** an editable report, **When** the author activates the Textbox card, **Then** one textbox with the next default name is created at the default placement position and is selected, with focus on the inspector's Name field.
2. **Given** the default position is already occupied by the top-left corner of an item created this way, **When** the author activates the card again, **Then** the new item is offset so the two items do not exactly overlap.
3. **Given** a screen reader is running, **When** an item is created, **Then** the creation and the assigned name are announced once.

---

### User Story 3 - Add a dataset and a bound table without forms (Priority: P2)

An author drops the Table card on the body and a table named Table1 appears immediately, without asking for a dataset. Separately, activating the Dataset card creates a local dataset named DataSet1. The author then binds the table to a dataset and chooses columns from the inspector.

**Why this priority**: Tables are the main data presentation in RDLC reports; binding them is a follow-up step, so their flow follows the simpler textbox creation.

**Independent Test**: In a blank report, drop Table on the body, activate Dataset, add two fields, bind Table1 to DataSet1 from the inspector, save and reopen. Verify Table1 and DataSet1 persist with the chosen binding and no other definitions changed.

**Acceptance Scenarios**:

1. **Given** an editable report, **When** the author activates the Dataset card, **Then** exactly one local dataset with the next default name (DataSet1, DataSet2, …) is created and selected, with no fields, no data source access and no query execution.
2. **Given** an editable report with any number of datasets, **When** the author drops the Table card in the body, **Then** an unbound table with the next default name (Table1, …) is created at the drop point with the default static layout (FR-009), and no dataset prompt is shown.
3. **Given** an unbound table is selected, **When** the author chooses a dataset in the inspector, **Then** the table is bound in one undoable edit and its columns can then be added from that dataset's fields.
4. **Given** the report has more than one dataset and contains an unbound table, **When** the report is shown, **Then** the table is marked with an actionable diagnostic stating that a dataset must be chosen, with a direct action to bind it; saving remains possible and nothing is changed automatically.

---

### User Story 4 - Rename after creation and keep names consistent everywhere (Priority: P2)

After creating items with default names, the author renames them from the inspector's Name field. When the author copies, pastes or duplicates items, the copies receive the next free name in the same numbered series as creation, never a duplicate.

**Why this priority**: Default names are only acceptable if renaming is direct and later copies follow one predictable rule.

**Independent Test**: Create Textbox1 and Textbox2, rename Textbox1 to Title, duplicate Title and duplicate Textbox2. Verify the inspector rename is one undo step and the duplicates are named Title1 and Textbox3.

**Acceptance Scenarios**:

1. **Given** a created textbox, table or dataset is selected, **When** the author enters a new valid unique name in the inspector, **Then** the item is renamed as one undoable edit and references maintained by existing safeguards stay consistent.
2. **Given** the author enters a duplicate or invalid name, **When** applying it, **Then** the rename is refused with a field-associated explanation and the accepted name remains visible.
3. **Given** items named Textbox1 and Textbox2 exist, **When** the author duplicates Textbox2, **Then** the copy is named Textbox3.

---

### Edge Cases

- Drop while another edit is pending, while the report is read-only, untrusted, source-only, invalid, or on a version that changes before the drop completes: nothing is created, a visible non-blocking explanation is shown, and no retry happens automatically.
- Default name already taken by a non-sequential item (Textbox1 exists, Textbox2 does not, Textbox3 exists): the lowest free number is used (Textbox2).
- Names in use by any report item type count for uniqueness: a rectangle named Textbox1 preserved from the source makes the next textbox Textbox2.
- Preserved or unsupported content in the body is never modified by a creation; the drop target may overlap such content visually.
- Drop at any of the supported zoom levels (25%–400%) and scroll offsets: the created position corresponds to the drop point within the existing geometry accuracy.
- Drag cancelled by losing pointer capture, window blur or a workspace resize: treated as a cancelled drop.
- Very small body (smaller than the default item size): the item is created at the drop point and may overflow; no automatic resize of the body.
- Unavailable cards (Image, Chart, Line, Rectangle, List, Matrix, Subreport, Parameter) cannot be dragged and keep their existing explanation; attempting to drag them shows that explanation.
- An unapplied inspector draft exists when a drop occurs: the existing apply / discard / cancel guard resolves the draft before creation proceeds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Available component cards (Textbox, Table, Dataset) MUST be draggable from the Components panel onto the canvas; unavailable cards MUST NOT be draggable and MUST keep their existing explanation.
- **FR-002**: While dragging over the canvas, the editor MUST show a preview of the new item's footprint at the prospective position, including snapping feedback, and indicate when the current position is not a valid drop target.
- **FR-003**: Dropping a Textbox or Table card inside the report body MUST create exactly one item whose top-left corner is the drop point converted to report coordinates, snapped to grid or guides when snapping is enabled, and unsnapped when Alt is held.
- **FR-004**: Every created item MUST receive an automatic default name: the component's type name followed by the lowest positive integer that makes it unique (Textbox1, Table1, DataSet1). Uniqueness MUST consider all report item names for report items and all dataset names for datasets.
- **FR-005**: Creation MUST NOT show a name prompt or creation form for Textbox and Dataset. The item MUST be selected after the host accepts it, and focus MUST move to the inspector's Name field for keyboard creation.
- **FR-006**: Each creation MUST be a single atomic, bounded document edit that produces exactly one native undo step and leaves all other report content textually unchanged.
- **FR-007**: A drop outside the body, a cancelled drag (Escape, pointer capture loss, window blur, workspace resize) or an ineligible editor state (pending edit, read-only, untrusted, source-only, invalid, stale version) MUST create nothing, add no history entry, and show a concise explanation for ineligible states.
- **FR-008**: Activating an available card with the keyboard or a click without drag MUST create the component with the same naming rule at a default position: the top-left of the visible body area plus a fixed inset, snapped when snapping is on, offset diagonally by one grid step for each consecutive keyboard creation that would otherwise share the same position.
- **FR-009**: Default sizes MUST be fixed and stated: Textbox 1in × 0.25in; Table two columns of 1in with a header row and a detail row of 0.25in each, containing empty static cells; Dataset has no canvas geometry.
- **FR-010**: A dropped or activated Table MUST be created unbound (no dataset binding), regardless of how many datasets the report contains, without any prompt.
- **FR-011**: The inspector MUST let the author bind a selected unbound table to an existing dataset, change that binding, and add columns from the bound dataset's fields, each as one undoable edit using the existing table safeguards. When the report has more than one dataset, an unbound top-level table MUST show an actionable diagnostic with a bind action, per MS-RDL 2.23.10; the editor MUST NOT bind it automatically.
- **FR-012**: Created textboxes, tables and datasets MUST be renamable from the inspector's Name field with the existing name validation, field-associated refusal and one undo step per rename, including tables.
- **FR-013**: Paste and duplicate MUST assign names by the same lowest-free-number rule applied to the source item's name, consistent with FR-004, and MUST never produce duplicate report item names.
- **FR-014**: The previous form-based creation flow (name, dataset, first field and width inputs) MUST be removed from the Components panel once FR-001–FR-013 are available; remaining table and dataset settings stay in the inspector.
- **FR-015**: Creation, refusal and the assigned name MUST be announced to assistive technology once, without repeated success notifications or dialogs requiring dismissal.
- **FR-016**: Creation MUST NOT evaluate expressions, access data sources, fetch content or alter unsupported or preserved content.

### Key Entities

- **Creation request**: component type, target position in report body coordinates (absent for Dataset), snapping state, base document version; produces exactly one accepted or refused outcome.
- **Default name series**: per component type, the type name plus the lowest free positive integer within the relevant uniqueness scope (all report items, or all datasets).
- **Drop preview**: transient footprint and validity shown during a drag; never persisted and never sent as an edit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An author places a textbox at a chosen spot in a single drag gesture, with zero dialogs or forms, in 100% of valid drops across the five supported zoom levels.
- **SC-002**: The created item's position matches the snapped drop point within the existing geometry tolerance (0.01pt) in at least 99 of 100 automated drop samples at mixed zoom and scroll offsets.
- **SC-003**: Every creation is undone by exactly one native Undo, restoring the exact prior report text, in 100% of automated checks.
- **SC-004**: Cancelled or invalid drops change the report text in 0% of cases.
- **SC-005**: A keyboard-only author creates a textbox and renames it in at most 4 key actions after focusing the card (activate, type name, confirm).
- **SC-006**: No created, pasted or duplicated item ever shares a name with another report item in the fixture corpus and generated test sequences.
- **SC-007**: At least four of five authors in an acceptance session create a textbox and a bound table without guidance in under 2 minutes, and rate the creation flow at least 4 of 5 for clarity.

## Assumptions

- The existing selection, inspector, snapping, guide, zoom and native undo behaviors from feature 003 are reused unchanged; this feature changes only how items are created and named.
- Report Builder conventions are used for default names (Textbox1, Table1, DataSet1); the numbered series starts at 1 even when the bare type name is free.
- The default keyboard placement inset is 0.25in from the visible body's top-left corner.
- The table profile is widened only to admit unbound body tables (static cells) and their later binding; other table constructs keep the existing restrictions.
- Adding a second dataset to a report that already contains an unbound table makes that table require a binding; this is reported by the diagnostic of FR-011, not prevented.
- Renaming an item does not rename expressions referring to it beyond what existing reference safeguards already handle.
- Drag-and-drop uses pointer interaction within the designer only; dragging cards to other applications or from the file system is out of scope.
- Image, Chart, Line, Rectangle, List, Matrix, Subreport and Parameter creation, runtime rendering and data preview remain out of scope.
