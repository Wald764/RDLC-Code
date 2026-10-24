# Feature Specification: Native VS Code Sidebar Integration

**Feature Branch**: `main` (current checkout; no branch hook is configured)

**Feature Directory**: `specs/005-native-sidebar-integration`

**Created**: 2026-10-24

**Status**: Implementation authorized by the user's explicit full-implementation instruction on 2026-10-24. Automation foundation is in progress; the feature is incomplete and no User Story has validated runtime acceptance.

**Input**: Add a native RDLC Code Activity Bar container with Report Structure, Report Data and Components views. Reuse the implemented features 001–004 and the central Angular designer. Preserve authoritative report text, atomic edits, offline operation and existing authoring capabilities. Every acceptance criterion must be validated automatically, including real Desktop end-to-end and visual coverage. Specification only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the Native Report Workspace (Priority: P1)

As a report author, I want RDLC Code alongside the other native tools, so that I can navigate reports without replacing the file Explorer or shrinking the designer with duplicate panels.

**Why this priority**: Establishes the native entry point and the correct document context for every other journey.

**Independent Test**: In a clean Desktop profile, open RDLC Code from the Activity Bar before opening any report. Open a report, hide and move a view, restore it, and check that Explorer and report content are unaffected. Automated coverage: AT-01, AT-07 and AT-08 in [automated-validation.md](automated-validation.md).

**Acceptance Scenarios**:

1. **Given** an installed extension with no report open, **When** RDLC Code is activated from the Activity Bar, **Then** its logo and title identify a native container containing Report Structure, Report Data and Components, with useful no-report guidance and New Report/Open Report access.
2. **Given** an active report, **When** the author opens the container, **Then** all three views identify that report and the central designer remains the primary editing surface; equivalent Angular navigation panels are not simultaneously expanded by default.
3. **Given** a hidden or moved view, **When** the author restores it through native view controls or restarts the workspace, **Then** the host's chosen placement and visibility are respected without forced relocation.
4. **Given** Explorer was visible before opening RDLC Code, **When** the author returns to Explorer, **Then** its files and ordinary functionality remain available, independently of RDLC views.

---

### User Story 2 - Navigate the Actual Report Structure (Priority: P1)

As a report author, I want to find and select report objects in a native hierarchy, including obscured and preserved content, so that I can navigate accurately and reach source when visual editing is unavailable.

**Why this priority**: Native navigation must reflect real report structure and agree with the existing canvas and inspector.

**Independent Test**: Open a fixture containing overlapping/offscreen textboxes, a grouped table, cells, nested preserved containers and actual header/footer content. Navigate with pointer and keyboard, select from either surface and inspect preserved XML. Automated coverage: AT-02, AT-03 and AT-07.

**Acceptance Scenarios**:

1. **Given** a parsed report, **When** Structure is expanded, **Then** actual sections, body, present headers/footers, containers, report items, table body/rows/cells and row/column member/group relationships are represented in source order, with type icons, names and truthful capability states; absent structures and runtime rows are not invented.
2. **Given** a visible tree entry with known canvas bounds, **When** it is activated, **Then** the same logical target becomes selected in the associated designer and inspector and is centered at unchanged zoom, subject to scroll bounds; oversized targets are centered as far as the reachable viewport permits.
3. **Given** a canvas selection or supported body-item multi-selection, **When** selection changes, **Then** Structure shows the corresponding membership and primary target, revealing ancestors without resetting unrelated expansion or stealing keyboard focus.
4. **Given** a cell, group, structural node or preservation-only item, **When** it is activated, **Then** cell versus table identity stays distinct; targets without known canvas bounds show details and Code XML access without a fabricated selection rectangle.
5. **Given** a supported or preserved target, **When** its context menu opens, **Then** relevant existing actions and limitations are available; selecting Code XML reveals the exact current source range. A supported mutation retains its existing safeguards and undo behavior.
6. **Given** source edits, accepted designer edits, Undo/Redo or external reload, **When** the accepted report changes, **Then** the tree refreshes automatically, preserving expansion and selection only where correspondence is unambiguous; deleted or ambiguous targets are not retargeted silently.

---

### User Story 3 - Inspect and Author Report Data (Priority: P1)

As a report author, I want datasets and fields next to preserved data definitions, so that I can reuse existing local-data editing without confusing inspection with executable connections or new authoring support.

**Why this priority**: Dataset and field authoring is already substantive functionality and must remain fully usable through the new navigation.

**Independent Test**: Create a dataset, add fields of all seven supported types, rename/change/remove eligible definitions and exercise blocked referenced changes. Inspect parameter, embedded image and data-source definitions in the same fixture. Automated coverage: AT-04, AT-06 and AT-09.

**Acceptance Scenarios**:

1. **Given** a report containing datasets/fields, parameters, embedded images and data sources, **When** Report Data opens, **Then** every identifiable definition within the documented limits is listed under its labeled category with its real identity and editable or preservation-only status; empty categories say that no definitions exist.
2. **Given** a supported dataset or field, **When** the author chooses Add, Edit, Rename or Delete as applicable, **Then** the existing contextual editor or guarded command handles the action against that definition; field types, reference protections and pending/draft behavior remain unchanged.
3. **Given** a parameter, embedded image, data source, calculated/unsupported field or opaque definition, **When** it is inspected, **Then** safe textual metadata and source access are available, unsupported mutations are unavailable, and no query, expression, image decoder, external resource or connection is executed merely to display the entry.
4. **Given** a known reference or preservation risk, **When** a destructive data operation is requested, **Then** existing reference rules either accept one complete safe edit or refuse it with an actionable explanation; no partial changes occur.
5. **Given** dataset selection or creation, **When** it is accepted, **Then** Report Data and its existing inspector context agree, without inventing a canvas object or moving the canvas to unrelated content.

---

### User Story 4 - Insert Existing Components from the Sidebar (Priority: P1)

As a report author, I want a compact, searchable native toolbox that inserts supported components, so that I can keep working on the canvas using the latest creation behavior.

**Why this priority**: Replaces navigation chrome while retaining feature 004's direct creation and naming behavior.

**Independent Test**: Filter the catalog, activate Textbox, Table and Dataset, inspect the resulting definitions, bind the unbound table afterwards, and undo/redo each insertion. Attempt every unavailable component. Automated coverage: AT-05, AT-06 and AT-07.

**Acceptance Scenarios**:

1. **Given** an editable report, **When** Components opens, **Then** Report items, Containers and Data contain the eleven canonical kinds from the capability matrix below, with coherent icons and concise unavailable reasons.
2. **Given** Textbox or Table, **When** its insertion action is activated by pointer or keyboard, **Then** exactly one item is created without a naming or binding form, using existing default placement, dimensions, automatic naming and post-acceptance selection; Table starts unbound.
3. **Given** Dataset, **When** its insertion action is activated, **Then** one automatically named empty local dataset is created and selected in Report Data and its inspector, without a canvas rectangle or data access.
4. **Given** a search string, **When** it changes, **Then** matching component labels are filtered case-insensitively with category context; unavailable matches remain truthful, and no results offers Clear Filter.
5. **Given** an unavailable kind or ineligible report state, **When** insertion is attempted through any entry point, **Then** no report text or history changes and the unavailable reason remains accessible.
6. **Given** a verified native-to-canvas drag path, **When** a supported component is dropped on the body, **Then** existing preview, coordinate conversion, snapping, Alt bypass, naming and cancellation semantics apply. If that path cannot be established using supported host behavior and automated Desktop evidence, the native toolbox exposes no misleading drag affordance; activation remains complete and existing in-designer drag insertion remains reachable.

---

### User Story 5 - Switch Reports without Losing Work (Priority: P1)

As a report author, I want the sidebar to follow the intended report and editor view, so that switching tabs or editing XML cannot send actions to the wrong document or overwrite newer work.

**Why this priority**: Cross-view targeting and stale-state refusal are data-integrity requirements for every native action.

**Independent Test**: Open A and B with identical object names and two designers for A plus its XML editor. Alternate active tabs and sidebar focus, edit each surface, inject delayed actions and external changes, then close views. Automated coverage: AT-03 and AT-06.

**Acceptance Scenarios**:

1. **Given** A and B are open, **When** the active editor changes between their designer or source tabs, **Then** sidebar labels, nodes, selection and available commands follow the active report, never merely a matching object name.
2. **Given** focus moves from A into the sidebar, **When** a native action is invoked, **Then** A remains the target; focusing the sidebar does not clear or change its report context.
3. **Given** two designers for A with different selections and viewport preferences, **When** the author changes the active designer, **Then** the sidebar follows that view's selection; selecting from the sidebar affects that associated view only, while accepted document edits update both views.
4. **Given** an action captured for A/version N, **When** A changes, closes or its associated view is replaced before completion, **Then** that action is refused with a reason, without rebasing onto version N+1 or redirecting to B.
5. **Given** a native selection conflicts with an unapplied inspector draft, **When** the existing Apply/Discard/Cancel guard runs, **Then** cancellation keeps the accepted selection visible in the tree and draft intact; Apply does not replay a stale navigation action.
6. **Given** XML edits, native history or external changes including a dirty-file conflict, **When** the host publishes the accepted state, **Then** all views reflect it, stale previews/drafts cannot overwrite it, and normal save/conflict protections retain unsaved work.
7. **Given** a non-report editor is activated or all reports close, **When** sidebar context updates, **Then** no-report guidance replaces mutation controls. No background report is edited implicitly.

---

### User Story 6 - Use a Stable, Accessible Offline Workspace (Priority: P1)

As a keyboard or high-contrast user, I want native navigation and existing designer interactions to remain accessible, stable and local.

**Why this priority**: Native migration must preserve the UX delivered in 003/004 and satisfy automated verification principle VII.

**Independent Test**: Run stories 1–5 using keyboard navigation in light, dark and high-contrast Desktop themes, then with network access blocked. Measure layout during canvas gestures and native-panel transitions. Automated coverage: AT-07, AT-08 and AT-09.

**Acceptance Scenarios**:

1. **Given** keyboard-only input, **When** the author opens views, navigates/expands trees, selects an obscured item, invokes context menus, inserts components and returns to properties/canvas, **Then** every action is reachable with labeled controls, visible focus and no focus trap; field shortcuts keep their normal behavior.
2. **Given** light, dark or high-contrast themes and 100%/200% interface scaling, **When** the workspace is displayed, **Then** the logo, icons, selection, focus, unavailable reasons and report boundaries remain distinguishable and authored colors are unchanged.
3. **Given** a canvas gesture, **When** selection/diagnostic feedback arrives, **Then** the canvas origin remains stable; elective layout changes wait until interaction ends, while unavoidable native layout resizing cancels the preview before its frame changes and commits nothing.
4. **Given** offline operation after installation or an untrusted local workspace, **When** supported workflows run, **Then** existing local editing/trust rules remain effective and no report-triggered network, query, expression, code or external-entity execution occurs.

### Edge Cases

| Case | Required observable result |
| --- | --- |
| Untitled report or Save As changes location | Follow the host's current document identity; retain safe context and clear obsolete identities. Never identify a report by basename alone. |
| Duplicate, absent or renamed object names | Version-local target identity governs commands. Reconcile across versions only through explicit accepted mappings or unique kind/name/ancestry; otherwise clear selection with feedback. |
| Multi-selection includes cell/data/structural nodes | Retain existing exclusive cell/data/structural modes; do not turn mixed tree selection into unsupported bulk edits. Restore the last accepted selection when a combination is refused. |
| Source-only format or multiple sections | Inspect safely identifiable actual structure and data, label limitations, disable visual mutations and retain source access; do not convert the schema. |
| Malformed XML, unsafe declaration or exhausted parser budget | Show diagnostic/source guidance, clear stale actionable nodes and never present the previous valid snapshot as current. |
| Presentation truncation or opaque subtree | Explicit incomplete/opaque label and source access; no fabricated descendants or claim of complete inventory. Canvas selection outside the displayed subset remains valid. |
| Unknown/zero/oversized bounds or preserved nested item | No guessed geometry; reveal only known bounds without changing zoom or XML, and use source/details otherwise. |
| Closed/hidden/moved view or reload | Dispose listeners and pending view actions; honor native view preferences and restore only valid disposable state, never pending edits or drafts. |
| Delayed refresh/selection echo or rejected message delivery | Only current bound document/view/version can affect visible state; repeated state is idempotent, cannot bounce focus or produce repeated mutations. |
| Long labels, expressions or large embedded content | Full accessible label and source location remain available; tree rows stay compact. Do not transfer image payloads, connection secrets or query bodies into tooltips/logs. |
| Read-only, failed apply/save or dirty external conflict | Refuse safely, keep accepted unsaved content and normal host recovery; no forced reload, disk overwrite or compensating mutation. |

## Requirements *(mandatory)*

### Functional Requirements

#### Native workspace

- **FR-001**: Provide one native RDLC Code Activity Bar entry with the supplied project logo and a Side Bar container holding Report Structure, Report Data and Components, available even before a designer has opened.
- **FR-002**: Preserve Explorer and native movement, ordering, hiding and restoration of views. No activation or refresh may force a user's moved view back to its default location.
- **FR-003**: Each view MUST identify its current report and distinguish loading, no-report, empty category, no filter results, invalid-source, source-only and truncated states, with meaningful local next actions.
- **FR-004**: Use the native views as the default navigation/toolbox surfaces; do not show equivalent expanded Angular navigation simultaneously by default. Keep the central canvas, contextual inspector, toolbar, status, source access and all 003/004 interaction workflows. An explicit compact designer fallback MUST preserve existing in-designer drag insertion and access when native views are hidden, without automatically reopening them or changing layout during gestures.

#### Structure and data

- **FR-005**: Project actual report hierarchy and source order, including present sections/containers/items, table body/rows/cells and actual row/column hierarchy members/groups. Presentation categories MUST be distinguishable from real report nodes; never create absent report sections, fake group containment, runtime instances or evaluated visibility.
- **FR-006**: Nodes MUST expose actual type/name, consistent theme-aware icon, capability/limitation and current source identity. Preserve existing 2,000-entry/32-level hierarchy presentation limits and inherited parser/transport budgets; any omitted coverage MUST be explicit with source access, never silent.
- **FR-007**: Synchronize tree, associated canvas and inspector selection in both directions, preserving body multi-selection and primary identity while keeping cell, structural and data modes exclusive. Programmatic reveal MUST NOT become a new user action or feedback loop.
- **FR-008**: Activating a known-bounds target MUST center/reveal it at unchanged zoom within reachable scroll bounds; canvas-origin selection MUST reveal/expand its native ancestors without stealing focus. Unknown-bounds and data/structural targets MUST NOT trigger fabricated canvas navigation.
- **FR-009**: Refresh all affected native projections automatically from accepted document changes; preserve expansion for unambiguous surviving nodes and keep expansion separate from report edits/history. Do not persist version-local IDs as durable identities.
- **FR-010**: Context actions MUST reuse existing properties, source, supported clipboard/duplicate/delete and data/table/group editing capabilities as relevant. Unsupported actions MUST be absent or disabled with an accessible reason and MUST also be refused at execution time; inherited destructive acknowledgements/reference guards remain mandatory.
- **FR-011**: Code XML access MUST open the authoritative current report at a host-verified source range for the selected node, including preserved/opaque content. Stale ranges MUST be refused rather than used in another document/version.
- **FR-012**: Report Data MUST list Datasets and their Fields, Parameters, Embedded Images and Data Sources, including preserved entries not exposed by the current designer projection. Category labels are navigation aids, not inserted report structures. Supported definitions remain available there without duplicate dataset branches in Report Structure.
- **FR-013**: Dataset/field creation, editing, rename, removal and field-type changes MUST reuse existing contextual workflows and capability/reference protections, covering all seven supported field types. Other data definitions remain inspectable and source-accessible without new mutation semantics.
- **FR-014**: Inspect preserved definitions through bounded, inert textual metadata and source access only. Never decode/render image payloads, execute queries/expressions, connect to sources, resolve entities or fetch referenced resources to populate views. Do not expose connection/query secrets in routine labels, tooltips or diagnostics.

#### Components

- **FR-015**: Components MUST provide the eleven canonical kinds/categories below with compact icon-and-label rows, one entry per kind, case-insensitive label filtering and a clear-filter/no-results path; unavailable matches MUST remain identifiable.
- **FR-016**: Textbox, Table and Dataset insertion MUST reuse 004's existing creation mechanism, automatic lowest-free-number names, default sizes/placement, accepted-result selection and one native undo boundary; no name or dataset prompt may reintroduce removed creation forms. Tables are created unbound and bind/rebind through the existing inspector afterwards.
- **FR-017**: Pointer and keyboard activation MUST provide equivalent insertion. Keyboard item creation MUST focus the existing Name property; dataset creation MUST focus the relevant data/inspector target, with one accessible accepted/refused announcement and no fake geometry.
- **FR-018**: Native-to-canvas drag insertion is conditional on an official-API feasibility probe and real automated Desktop proof. Enable and advertise it only if the path passes the full 004 drop contract, including cancellation/staleness and coordinate accuracy. Otherwise record the limitation, show activation instructions instead, and keep existing designer drag insertion available. Do not introduce URI tricks, private workbench APIs or a second insertion engine to simulate support.

#### Authoritative context and synchronization

- **FR-019**: The host report text document MUST remain the only content source of truth. Native views and Angular consume accepted projections; no independent report copy, history, filesystem save path or serializer is permitted.
- **FR-020**: Resolve context from the active RDLC designer or RDLC text editor, including untitled reports; preserve that context while focus enters native views. Non-report editors/no surviving report MUST yield a no-report state, without mutations to a remembered background file.
- **FR-021**: Track the associated editor view separately from document identity. For multiple designers of one report, sidebar selection and creation placement MUST use the active/last-associated view of that same document; document updates reach all views while selection, viewport and drafts remain view-local. With source-only focus, reuse the last surviving designer of that document or open its designer when an explicit visual navigation/authoring action requires one; never borrow another report's view.
- **FR-022**: Every native action MUST retain and verify its original report identity, document version, associated view and target/capability context, rechecking after asynchronous waits. Stale, disposed, ambiguous, read-only or incompatible requests MUST be refused with no automatic retry or reinterpretation.
- **FR-023**: Correlate accepted selection and creation results with the matching request/version under either snapshot/result arrival order. Ignore outdated selection/refresh delivery and duplicate echoes; cancellation/refusal MUST restore the accepted native selection rather than falsely claiming a target was selected.
- **FR-024**: Reuse the shared document mutation queue, typed intents, candidate verification and atomic bounded edit pipeline. One accepted content-changing intent MUST be one native Undo/Redo step; selection, expansion, filters, reveal, cancellation, refusal and no-op MUST add no report edit, dirty state or history entry.
- **FR-025**: XML edits, Undo/Redo, clean external reloads, dirty external conflicts, Save/Save As and failures MUST retain existing source-authoritative behavior and unsaved work across multiple views. Invalidate obsolete previews/drafts with an explanation; do not allow stale UI state to overwrite independent edits.
- **FR-026**: Native selection, insertion and context actions MUST honor existing Apply/Discard/Cancel and pending-operation rules. A changed tree highlight alone MUST NOT bypass draft settlement, commit a preview or submit an implicit edit.

#### UX, security and verification

- **FR-027**: All new/relocated workflows MUST support full keyboard navigation, accessible names, visible focus, focus return, readable selection/primary/pending/refusal states and ordinary field shortcuts. Native menus/trees MUST follow host conventions; essential states cannot depend on color alone.
- **FR-028**: Support light, dark and high-contrast host themes and 100%/200% interface scaling. In reference themes, normal text MUST meet 4.5:1 contrast and essential focus/selection/control boundaries 3:1. Use the supplied activity icon without silently claiming its theme appearance has been verified.
- **FR-029**: Selection, errors, menus and notifications MUST NOT shift canvas layout during interactions. Elective layout changes MUST defer; unavoidable native resizing MUST cancel the preview before rebasing, with zero gesture edits. Preserve 003's responsive navigation, zoom/units/rulers, snapping, viewport anchoring and 004's placement accuracy.
- **FR-030**: Work fully offline after installation using existing local trust/isolation rules and minimal dependencies. No additional runtime server, execution/resource-fetch path or broader report compatibility is authorized.
- **FR-031**: Every new mutation MUST preserve exact text outside its authorized footprint and unrelated XML/namespace content inside affected parents, with exact prior text on native Undo. No schema conversion or whole-document rewrite is allowed; uncertainty MUST refuse the operation.
- **FR-032**: Every acceptance scenario, functional requirement, edge case and success criterion MUST map to automated assertions and reproducible fixtures, including real Desktop interaction, visuals and regression coverage. Compilation, mocks, screenshots without comparisons and human confirmation MUST NOT substitute for functional proof.
- **FR-033**: Required automated suites MUST run through root monorepo validation commands and GitHub Actions, including applicable installed-VSIX checks. Preserve existing quality/release gates, minimum/stable Desktop matrix, frozen dependencies and same-artifact release guarantees; failed/missing required evidence blocks completion.
- **FR-034**: Record candidate identity, environment, fixtures, executed assertions and artifacts. Unimplemented, unrun, failed or technically blocked behaviors remain explicitly unvalidated. Investigate automation gaps and adapt test infrastructure instead of assigning mandatory manual validation. A conditional drag capability may be unavailable only with recorded probe evidence and automated activation/fallback checks; an untested advertised behavior cannot pass.

### Compatibility and Scope

Editable scope remains the RDL 2016/01 namespace (`http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`), exactly one report section, and the implemented property-level profile of 001–004. Feature 004's unbound static table profile and later binding are included. Safe navigation can inspect identifiable unsupported sections/versions without granting visual editability or asserting runtime conformance.

| Capability | Native presentation and reused behavior | Boundary |
| --- | --- | --- |
| Textbox | Report items; creation, properties, geometry, clipboard and arrangement | Existing simple body profile; cell and preserved/rich-text restrictions remain. |
| Table | Report items; unbound creation, rename, bind/rebind, columns/rows/cells/groups/totals and whole-frame manipulation | Existing static-column/unmerged profile; no matrix authoring or runtime rows. |
| Dataset | Data; automatic definition creation and existing field/type/reference workflows | Seven supported local field types; no duplication, query execution or data connection. |
| Image, Line, Chart, Subreport | Report items; visibly unavailable insertion entries | Existing occurrences are preservation-only, with inspection/source access. |
| Rectangle, List, Matrix | Containers; visibly unavailable insertion entries | Real preserved nesting is navigable where safely identified; no reparenting/container editing. |
| Parameter | Data; visibly unavailable insertion entry | Existing parameter definitions are read-only with source access. |
| Embedded Images and Data Sources | Report Data categories with preserved definitions | No new toolbox kind, decoder, connection editor or mutation. |
| Toolbar, inspector, page settings, diagnostics | Existing designer controls remain contextual and reachable | No duplicate form system or feature rollback during migration. |

The source evidence, actual reuse map, official API feasibility and format citations are in [baseline-analysis.md](baseline-analysis.md). Required automated methods, the acceptance-to-test mapping, non-regression matrix and independently verifiable delivery slices are in [automated-validation.md](automated-validation.md). These are specification inputs and validation obligations, not implementation authorization or executed acceptance evidence.

Out of scope: new report-item/parameter/image/data-source authoring semantics, rendering/populated preview, printing/export, live data, expression evaluation, schema conversion, replacement engine, web/remote/cross-window support, arbitrary docking inside Angular and release publication during this feature.

### Key Entities *(include if feature involves data)*

- **Report context**: Host document identity, current accepted version, compatibility/diagnostics and associated designer view; distinct from the sidebar's keyboard focus.
- **Structure entry**: Real current report node with parent, source order/range, type/name, bounded children and operation capabilities; a presentation category has no authored report identity.
- **Data definition entry**: Dataset/field or preserved parameter/image/source definition with category, source identity, inert metadata and supported actions.
- **Component entry**: Canonical kind, category, icon, filter label, capability/prerequisite reason and existing insertion action.
- **View selection**: Version-bound body-item set/primary, exclusive cell or exclusive structural/data target; scoped to one associated designer, not shared persistent report state.
- **Native action context**: Captured report/view/version/target, user intent, pending/accepted/refused outcome and correlation information; never an arbitrary source patch.
- **Navigation state**: Disposable native expansion/filter/visibility and per-designer viewport/preferences; no report history or pending draft persistence.
- **Automated evidence record**: Requirement/scenario identifiers, candidate/fixture/environment identity, actual assertion outcomes, timing samples and comparison artifacts with explicit unvalidated status where needed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a clean profile, RDLC Code opens in one Activity Bar activation and exposes all three named views; all automated hide/move/restore cases preserve Explorer functionality and change zero report text.
- **SC-002**: Across the representative hierarchy/data corpus, 100% of expected identifiable nodes within limits appear with correct parent/type/source location, and 100% of omitted or opaque cases identify their limitation rather than claiming completeness.
- **SC-003**: Across 100 alternating native/canvas selection operations, all applicable views agree on target, membership and primary identity; at least 95 updates become visibly correct within 200ms, with zero focus bounces, document changes or repeated selection loops.
- **SC-004**: Textbox, unbound Table and Dataset are each inserted exactly once per explicit activation without a creation form in every valid automated case; every accepted insertion is removed/restored by one Undo/Redo, and every unsupported/refused/cancelled insertion changes zero report text.
- **SC-005**: Across 100 document/view switches and 50 delayed/stale/duplicate/closed-target cases involving A, B and two views of A, zero actions affect the wrong report or view and zero independent accepted edits are lost.
- **SC-006**: Every supported new journey completes using keyboard input alone in each reference theme, with zero unreachable required actions, lost-focus states or focus traps; all reference contrast assertions pass.
- **SC-007**: Across 100 representative canvas interactions with selection/error/inspector/native-view updates, unintended origin displacement is at most 1 screen pixel. Every unavoidable resize cancellation commits zero preview edits; retained placement/movement results stay within 0.01pt.
- **SC-008**: Across the inherited corpus of at least 12 reports, every view-only/refused/no-op/cancelled case preserves exact text, every accepted edit preserves its authorized footprint, and twenty consecutive mixed accepted edits are individually undone/redone to their exact expected states, with zero silent data loss.
- **SC-009**: Every installed supported journey completes with network access blocked, producing zero report-triggered external requests, query/data accesses, entity resolutions or code/expression executions; preserved definitions remain unchanged.
- **SC-010**: Every mandatory acceptance case has an executed passing automated assertion tied to the same candidate and applicable environment before this feature is declared validated; missing evidence and failed visual comparisons block completion without human sign-off as a substitute.

## Assumptions

- Features 001–004 are the implemented baseline, confirmed through source inspection. Historic draft labels, checked task boxes and manual evidence do not establish automated proof for 005. This specification does not rerun or certify inherited acceptance.
- Primary targets remain local VS Code Desktop on Windows, macOS and Linux. Current manifest minimum is `^1.142.0`; browser-hosted/remote targets are not added. Offline means after installation; reproducible tool/runtime downloads during test provisioning are separate from extension runtime behavior.
- The last associated designer is retained only within the same document while sidebar focus or source focus makes direct designer focus unavailable. Explicit navigation may reveal/open that designer; merely opening a view never changes report content or silently opens unrelated files.
- Report Data owns data-definition navigation in the native layout; Report Structure owns layout/group structure. Existing data relationships remain available in contextual table controls without creating duplicate editable stores.
- The native toolbox uses explicit activation for insertion and native filtering rather than reproducing an Angular card grid. Native-to-webview drag is a conditional enhancement requiring proof; existing 004 drag insertion remains supported through the compact designer fallback.
- Presentation limits inherit 003's 2,000 entries/32 levels per bounded hierarchy projection; planning must allocate shared transport budget explicitly, with visible truncation for either native view rather than silently raising limits.
- Measured selection/layout targets use reports up to 1 MiB with 100 selectable body items; dedicated boundary fixtures exercise presentation/parser limits separately. Measurements identify the exact reference environment and input-to-visible-result boundary.
- Historical mandatory usability studies or manual walkthroughs are not imported as completion gates. New/affected workflows and inherited behavior exercised by this feature require automated functional, accessibility, Desktop, visual and preservation evidence as defined here.
- Planning, task generation and analysis artifacts exist. The earlier 2026-10-24 instruction authorized U1/U2 documentary corrections only. The subsequent explicit full-implementation instruction authorizes implementation against these artifacts. This authorization is not acceptance evidence; mandatory failed, blocked or unrun assertions remain unvalidated.
