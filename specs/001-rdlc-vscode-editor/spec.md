# Feature Specification: Open-Source RDLC Editor for VS Code

**Feature Branch**: `001-rdlc-vscode-editor`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "un éditeur de rapports rdlc en extension vscode opensource"

## Clarifications

### Session 2026-10-15

- Q: Must the first version support editing data tables, or can it be limited to text boxes? → A: Support text boxes and tables, including editing groups and totals.
- Q: Must the first version also support defining datasets and their fields in the editor? → A: Create and edit local dataset definitions and field names and types without database connections or queries.
- Q: Which open-source license should apply to the project's code? → A: MIT.
- Architecture direction (2026-10-15): Use a TypeScript-only pnpm workspace, the official VS Code extension APIs, and a recent Angular designer using SCSS and Signals. Bundle all runtime resources for offline use without an HTTP server. Separate parsing, XML serialization, validation, expression analysis, and design-surface rendering. Preserve unknown XML and namespaces losslessly. This direction supersedes any incompatible technical proposal; implementation is not authorized by this planning step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edit an Existing Report Safely (Priority: P1)

As a report author, I want to open an RDLC file inside VS Code, see its layout, change a text box, and save the report without losing existing content or requiring proprietary authoring software.

**Why this priority**: Safe maintenance of existing reports is the smallest useful editing workflow and establishes trust in saved files.

**Independent Test**: Open a supported report containing a body text box and unsupported content, change the text box's position and text, save, and reopen. Verify the intended changes and preservation of unrelated content.

**Acceptance Scenarios**:

1. **Given** a supported report, **When** the author opens its visual editor, **Then** the body layout displays editable text boxes and identifies unsupported items without presenting them as accurately rendered content.
2. **Given** a body text box containing one paragraph and one text run, **When** the author changes its literal text, position, size, or basic text formatting and saves, **Then** reopening shows those changes and preserves unrelated report content and the original report version.
3. **Given** an unmodified report, **When** the author saves and reopens it, **Then** its meaning, namespaces, and unsupported content remain unchanged.
4. **Given** an unsupported construct that prevents safe editing, **When** the author opens the report or attempts an affected edit, **Then** the editor explains the affected construct and blocks the unsafe operation while retaining access to the original source.

---

### User Story 2 - Create a Report with Grouped Tables (Priority: P2)

As a report author, I want to create a blank report and arrange text boxes and data tables visually, including groups and totals, without hand-writing its definition.

**Why this priority**: Creation and grouped tables make the editor useful for new reports that summarize application data.

**Independent Test**: Create a blank report, set page dimensions and margins, add and arrange two text boxes, save, and reopen. Separately, open a report with a dataset, add a two-column table, configure a row group and group/report totals, save, and reopen to verify the definitions.

**Acceptance Scenarios**:

1. **Given** an open workspace, **When** the author creates a report, **Then** a blank report using the supported version opens with one report section and editable page and body dimensions.
2. **Given** a blank report, **When** the author adds, selects, moves, resizes, formats, and deletes body text boxes, **Then** the layout reflects each accepted action and each new text box has a unique valid name.
3. **Given** an unsaved report, **When** the author saves it to a chosen `.rdlc` path, **Then** the saved report reopens with the same page settings and text boxes.
4. **Given** keyboard-only interaction, **When** the author selects a text box and edits its properties or deletes it, **Then** those operations are available with visible focus and labeled controls.
5. **Given** a report with a dataset, **When** the author creates a table and adds field-bound columns, **Then** the design surface shows the columns and their binding expressions without accessing the data source.
6. **Given** a table, **When** the author creates, changes, or removes a row group or group/report total and saves, **Then** reopening preserves the resulting grouping and total definitions without changing unrelated content.
7. **Given** a blank report, **When** the author defines a local dataset and its field names and types, **Then** those fields are available for table bindings and their definitions survive save and reopen without a database connection.
8. **Given** a dataset or field referenced by a table, group, or total, **When** the author attempts to rename or delete it, **Then** the editor blocks the operation with a list of affected references until the author updates or removes those references.

---

### User Story 3 - Use Familiar Document Controls (Priority: P2)

As a report author, I want the editor to follow the normal document lifecycle so that mistakes, source edits, and external file changes do not overwrite my work unexpectedly.

**Why this priority**: Predictable document behavior is necessary for everyday editing and preventing data loss.

**Independent Test**: Make an edit, undo and redo it, switch to source editing, change the source, and exercise closing and external-change handling with unsaved work.

**Acceptance Scenarios**:

1. **Given** an edited report, **When** the author uses undo and redo, **Then** the document and visual layout return to the corresponding states and the unsaved-change indicator reflects the current state.
2. **Given** unsaved changes, **When** the author closes the report, **Then** the normal save, discard, or cancel choice protects those changes.
3. **Given** a source edit, **When** the source becomes valid, **Then** the visual editor reflects it; if it is invalid, the editor identifies the error and prevents stale visual edits from replacing the source.
4. **Given** an externally changed report, **When** there are no local edits, **Then** the editor reloads it; **When** local edits exist, **Then** the author must resolve the conflict before either version is overwritten.

### Edge Cases

- Malformed reports: show an actionable diagnostic with a location when available; retain source access and do not rewrite the file automatically.
- Unsupported report versions or multiple report sections: explain the compatibility boundary, retain source access, and disable visual editing without converting the report.
- Mixed supported and unsupported items: identify unsupported items by name and kind, using a layout placeholder when their bounds are known; preserve their content and relative ordering.
- Rich text boxes with multiple paragraphs or text runs: preserve their content and display them as unsupported for visual editing rather than flattening them.
- Expression-valued text: display the expression as authoring text, never its evaluated result; preserve it unless the author explicitly edits that value.
- Invalid property values: reject duplicate or invalid item names, negative positions, nonpositive dimensions, invalid colors or sizes, and page margins that leave no printable area, with an explanation.
- Read-only files, failed saves, or conflicting edits: report the problem, keep unsaved work, and allow retry or saving elsewhere.
- Embedded code, external resources, and entity references: opening or editing must not execute code, evaluate expressions, access data sources, resolve external entities, or fetch remote resources.
- Untrusted workspaces: core local editing remains available without granting execution or network privileges.
- Table edits: reject missing dataset or field references and invalid group definitions; preserve unsupported table features and block operations that cannot preserve them safely.
- Dataset edits: reject duplicate dataset names, duplicate field names within a dataset, and unsupported field types. Block renaming or deleting referenced datasets or fields until affected bindings are updated or removed; preserve existing data-source and query metadata without executing it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST provide an installable, open-source VS Code extension whose core creation and editing workflows run locally without an account, network connection, or proprietary report authoring software.
- **FR-002**: The extension MUST let authors open existing `.rdlc` files, create blank reports, and save or save as a report at a chosen location.
- **FR-003**: Initial visual editing MUST support reports using the RDL 2016/01 definition namespace (`http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`) with exactly one report section. Other versions and section counts MUST receive an explicit unsupported diagnostic and remain accessible as source without automatic conversion.
- **FR-004**: Authors MUST be able to edit page width, page height, all four page margins, body width, and body height for supported reports.
- **FR-005**: Authors MUST be able to add, select, rename, move, resize, and delete body-level text boxes containing exactly one paragraph and one text run; edit their literal or expression text; and set font family, font size, bold, italic, text color, and horizontal text alignment. Other properties MUST be preserved.
- **FR-006**: The visual editor MUST display supported items at their defined positions and sizes, show page and body boundaries, and identify unsupported items. It MUST describe its display as a design surface rather than a rendered report preview.
- **FR-007**: Save operations MUST preserve report semantics, namespaces, unsupported elements and attributes, expression text, and unrelated content except where explicitly changed by the author. Unrelated source formatting MUST be preserved wherever feasible. Unsafe edits or saves MUST be blocked with an actionable diagnostic instead of discarding content.
- **FR-008**: The editor MUST integrate with normal dirty state, save, save as, undo, redo, and close-with-unsaved-changes behavior. Failed saves MUST retain pending edits.
- **FR-009**: Authors MUST be able to access the report source. Source changes, visual changes, and external file changes MUST share the current document state; invalid source MUST disable affected visual editing, and concurrent external changes MUST require conflict resolution before overwrite.
- **FR-010**: The editor MUST validate the properties it authors, including valid unique report-item names, supported size and color values, nonnegative positions, positive dimensions, and margins leaving positive printable width and height. Diagnostics MUST identify the item or property and explain a corrective action. Validation MUST distinguish unsupported content from malformed content and MUST NOT claim complete runtime validation.
- **FR-011**: Opening, displaying, editing, or saving reports MUST NOT execute embedded code, evaluate report expressions, access data sources, resolve external entities, or fetch remote resources. Core editing MUST respect Workspace Trust and remain isolated from report-supplied active content.
- **FR-012**: Selection, property editing, text-box creation and deletion, table and column editing, group and total editing, dataset and field editing, saving, undo, and redo MUST be keyboard accessible, with labeled controls and visible focus.
- **FR-013**: Before public distribution, the project MUST publish its original code under the MIT license, include the license text and copyright notice, record dependency license compatibility, retain vendored attribution and third-party licensing terms, and provide English installation, supported-feature, limitation, and contribution documentation. A contributor MUST be able to build and install the extension from that documentation.
- **FR-014**: Authors MUST be able to create and edit tables bound to report datasets, add and remove columns, edit cell text and field expressions, create and edit row groups and their grouping expressions, and add group and report totals. Table definitions MUST survive save and reopen with unrelated report content preserved; group and total expressions MUST remain unevaluated during editing.
- **FR-015**: Authors MUST be able to create, rename, and delete local dataset definitions and add, rename, remove, and set the types of their fields without a database connection or query. Field types MUST include text, Boolean, 32-bit integer, 64-bit integer, decimal, double-precision number, and date/time. Dataset names MUST be unique within a report and field names within their dataset. Definitions MUST survive save and reopen and be available for table bindings. Renaming or deleting a referenced dataset or field MUST be blocked with actionable reference diagnostics until affected references are updated or removed. Existing data-source, query, and designer metadata MUST be preserved unless explicitly edited through a supported operation.
- **FR-016**: Project-owned extension, designer, and domain logic MUST be written in TypeScript in a pnpm workspace monorepo. The extension MUST use official VS Code APIs; the graphical designer MUST use a recent supported Angular release, SCSS, and Signals.
- **FR-017**: Installed core workflows MUST operate entirely offline, with bundled local resources and no required HTTP server or .NET, C#, Java, or Python backend or runtime service.
- **FR-018**: Parsing, XML serialization, validation, expression analysis, and design-surface rendering MUST be independently testable modules. Rendering here means authoring layout, not report execution or populated-data preview.
- **FR-019**: Unknown XML elements, attributes, namespace declarations, and extensions MUST be retained without loss. A no-op graphical save MUST not regenerate the XML; supported edits MUST preserve untouched source ranges and namespace bindings. An operation whose preservation cannot be proved MUST be blocked.
- **FR-020**: Unit tests, XML roundtrip tests, and specification-linked compatibility tests MUST be release gates, alongside applicable VS Code lifecycle and offline integration checks. Native APIs MUST be preferred; dependencies MUST have a documented necessity and license review.

### Compatibility and Scope

The initial authoring contract covers the version and constructs in FR-003 through FR-005, table authoring in FR-014, and local dataset and field authoring in FR-015. Tables use the tablix report construct; matrix/crosstab authoring is outside this feature. Existing data sources, query definitions, parameters, headers, footers, images, lines, rectangles, charts, subreports, custom items, rich text, unsupported field types, and unsupported tablix features are preservation-only. Their presence does not imply visual authoring or execution support. If preservation cannot be guaranteed for an affected operation, that operation is blocked.

Report execution, populated-data preview, printing, export, data-source querying, expression evaluation, schema conversion, and full designer parity are outside this feature. Support for general RDL structures does not establish compatibility with any particular RDLC runtime. The report definition remains the authoritative saved document.

The following local references define the relevant format vocabulary and guide later compatibility verification; they are not a claim of complete conformance:

- MS-RDL §1.6, [Versioning and Localization](../../vendor/01-introduction/1.6-versioning-and-localization.md): distinguishes report definition versions.
- MS-RDL §2.3, [Report](../../vendor/02-structures/2.3-report.md): identifies report structure and report sections for 2016/01.
- MS-RDL §2.11, [ReportItems](../../vendor/02-structures/2.11-reportitems.md): distinguishes text boxes from preservation-only item types.
- MS-RDL §2.16, [Textbox](../../vendor/02-structures/2.16-textbox.md): identifies text-box properties and version-dependent text structure.
- MS-RDL §2.23, [Tablix](../../vendor/02-structures/2.23-tablix.md): defines table layout and row/column hierarchy constraints.
- MS-RDL §2.81, [Group](../../vendor/02-structures/2.81-group.md): defines grouping expressions and group identity.
- MS-RDL §2.325, [DataSet](../../vendor/02-structures/2.325-dataset.md), and §2.328, [Field](../../vendor/02-structures/2.328-field.md): define dataset and field structures. RDLC local-data conventions and designer field-type metadata must be verified separately during planning rather than inferred from general RDL support.

Any ambiguous extracted schema tables or property rules must be verified against the corresponding original source excerpt during planning before a conformance claim is made.

### Key Entities *(include if feature involves data)*

- **Report document**: A saved or unsaved report with a location, definition version, current content, change history, and diagnostics.
- **Report section and page**: The single editable section, its body dimensions, page dimensions, and margins.
- **Text box**: A named body item with position, dimensions, text or expression, and supported formatting.
- **Table**: A named body-level data region bound to a report dataset, containing columns, cells, row groups, and total expressions.
- **Row group**: A named grouping of table rows defined by grouping expressions and associated group totals.
- **Local dataset definition**: A report-scoped named description of application-supplied data, containing named fields and their declared types, available to tables without retrieving data.
- **Dataset field**: A field name, application-data field mapping, and declared type belonging to one dataset; table expressions may reference it. New fields initially use their name as their application-data mapping, while existing mappings are preserved.
- **Preserved content**: Report constructs outside the editable subset that remain associated with their original report location and namespaces.
- **Diagnostic**: An error or limitation identifying an affected construct or property, its impact on editing or saving, and a corrective action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 4 of 5 representative report authors can create a report, add and format two text boxes, save, and reopen it within 10 minutes using only the supplied getting-started instructions.
- **SC-002**: Every report in an acceptance corpus of at least 12 representative files passes its applicable preservation checks: no semantic change on an unedited save and no unrelated semantic change after one supported edit. The corpus includes supported reports, mixed unsupported items, rich text, expressions, custom namespaces, malformed input, and unsupported versions.
- **SC-003**: Across 20 consecutive edits in the acceptance workflow, undo and redo restore the expected state every time; closing, save failure, and external-change conflict scenarios cause zero silent losses of pending work.
- **SC-004**: On a documented reference workstation, a supported report of up to 1 MB with 100 editable text boxes becomes usable within 3 seconds in at least 19 of 20 opens, and property edits appear within 200 milliseconds in at least 95 of 100 interactions.
- **SC-005**: Every acceptance case containing embedded code, expressions, external resources, data-source definitions, or external entities produces zero report-triggered code executions, data-source accesses, or network requests during core editing.
- **SC-006**: A keyboard-only reviewer completes the create, select, property-edit, delete, undo, redo, and save workflow, including dataset, field, table, column, group, and total editing, without pointer input or a focus trap.
- **SC-007**: Before release, an independent contributor builds and installs the extension from the published English instructions, the distribution includes the MIT license text and copyright notice for original project code, and every distributed dependency has a recorded license review with no unresolved incompatibility.
- **SC-008**: An author can create a table bound to a dataset, add two field columns, configure a row group, and add group and report totals; after save and reopen, all bindings, grouping expressions, and total expressions remain unchanged. Acceptance cases cover creating, changing, and removing groups and totals without evaluating report expressions.
- **SC-009**: Starting with a blank report and no network connection, an author can define a local dataset with text, number, and date/time fields, bind a table to it, and save and reopen with all field names, types, and bindings intact. Acceptance cases verify every supported field type, rejection of duplicate names, and blocking of dataset or field changes that would leave known references invalid.

## Assumptions

- Primary users are developers and report authors maintaining local report files in desktop VS Code on Windows, macOS, or Linux; browser-hosted and remote-workspace support are outside the initial scope.
- A visual design surface with a property editor is the default interpretation of “report editor”; source-only editing would not meet the intended authoring need.
- RDL 2016/01, simple body text boxes, and tables with row groups and totals are the initial compatibility baseline. Additional versions and matrix/crosstab authoring require separately scoped features rather than implied support.
- Report data is supplied by the consuming application at execution time. Local dataset and field definitions are editable, while existing expressions and unrelated dataset metadata are preserved. This feature does not require a report-processing runtime, live database, or sample-data service.
- Performance targets are initial acceptance targets for the bounded report size above, rather than promises for arbitrarily large files.
- Original project code is licensed under MIT. Vendored reference material and third-party components retain their own notices and licensing terms.
- Planning depends on the vendored MS-RDL reference and representative RDLC fixtures. Compatibility checks must distinguish shared RDL format rules from RDLC runtime behavior.
