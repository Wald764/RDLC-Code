# Tasks: TypeScript-Only RDLC Editor Architecture

**Input**: Design documents from `/specs/001-rdlc-vscode-editor/`.

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [module contracts](contracts/modules.md),
[editor protocol](contracts/editor-protocol.md), [compatibility contract](contracts/compatibility.md),
[CI/CD contract](contracts/ci-cd.md) and [quickstart.md](quickstart.md).

**Status**: Phases 1–4 (T001–T052) implemented. See
[`docs/validation/foundations.md`](../../docs/validation/foundations.md),
[`docs/validation/us1.md`](../../docs/validation/us1.md) and
[`docs/validation/us2.md`](../../docs/validation/us2.md) for executed checks and
remaining evidence boundaries. The tested VS Code minimum is now 1.142.0 after the
1.110.0 untitled-document acceptance failure. Phase 5 implementation and automated checks are
present; T053's native dirty-close dialog choices and T061's final acceptance remain pending
(see [`docs/validation/us3.md`](../../docs/validation/us3.md)). Phase 6 remains pending. No accounts or
releases are created by this implementation.

**Tests**: Required by FR-020 and constitution III–IV. Use compiled TypeScript with Node's
built-in test/assert APIs for domain/tooling tests, Angular's supported test builder for UI and
the official VS Code Electron harness for integration. Write the listed checks first, observe
the intended failure, then implement; do not add alternative runtimes or placeholder passing gates.

**Organization**: Setup and foundation precede three story increments; delivery is cross-cutting.
V9/V10 are approved designs with unresolved operational proof obligations. V1–V8 remain in force.

## Format: `[ID] [P?] [Story] Description`

- Every task is an unchecked checkbox with a sequential `Tnnn` ID and explicit target paths.
- `[P]` identifies disjoint work that can run together after its stated prerequisites.
- `[US1]`, `[US2]` and `[US3]` appear only in their corresponding story phases.
- Paths below are repository-relative planned implementation paths, not existing-file claims.
- Every implementing task includes focused unit checks for its non-trivial logic even when a
  separate preceding test task already supplies integration/contract coverage.

## Path Conventions

- `apps/vscode-extension/`: official VS Code API integration and document orchestration.
- `apps/designer/`: standalone, zoneless Angular application, Signals, HTML and SCSS.
- `packages/{report-model,xml-parser,xml-serializer,validation,expressions,renderer}/`: independent
  `@rdlc/*` TypeScript packages with colocated `src/*.test.ts` checks and `workspace:*` imports.
- `tests/{fixtures,roundtrip,compatibility,vscode,package,performance,release}/`: cross-package checks.
- `scripts/*.ts`: only necessary project-owned automation, always TypeScript.
- `.github/workflows/{ci,release}.yml`: GitHub Actions only; no Azure Pipelines.
- `docs/validation/`: commit-bound evidence with tool/consumer versions, results and limitations.
- `vendor/` is reference-only. Discover relevant sections through indexes/targeted search; do
  not read the corpus exhaustively or edit its contents to satisfy a test.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the approved workspace and runnable build/test contracts without features.

- [X] T001 Verify V1 package availability and peer dependencies for Angular 22.2.x, TypeScript 6.0.x, Node 24 LTS >=24.15.0 and pnpm 11.x; record exact compatible patches and sources in `docs/validation/toolchain.md`, then declare Node in `.node-version` and pnpm in root `package.json`; stop on unsupported combinations rather than silently changing architecture.
- [X] T002 Create the two apps and six packages in `pnpm-workspace.yaml`, their `package.json` files and `tsconfig.base.json`; use strict TypeScript, private nonpublished libraries/designer and the dependency directions in `specs/001-rdlc-vscode-editor/contracts/modules.md`, without Nx/Turborepo or a backend; commit the generated `pnpm-lock.yaml` and reviewed dependency lifecycle-script allowlist.
- [X] T003 [P] Configure pinned ESLint and Prettier in `eslint.config.ts`, `.prettierignore` and `.prettierrc.json`; exclude generated/vendor material from formatting, enforce domain import boundaries, and prepare `scripts/check-commits.ts` configuration for gitmoji-prefixed Conventional Commit subjects with required scope.
- [X] T004 [P] Set up the official extension-host build and manifest in `apps/vscode-extension/package.json`, `apps/vscode-extension/tsconfig.json` and `apps/vscode-extension/src/extension.ts`; declare `.rdlc` custom-editor/command contributions and untrusted-workspace support, keeping VS Code runtime requirements separate from build Node and the proposed 1.110 minimum explicitly unverified.
- [X] T005 [P] Set up Angular standalone/zoneless AOT and Signals in `apps/designer/angular.json`, `apps/designer/src/main.ts`, `apps/designer/src/app/app.component.ts` and `apps/designer/src/styles.scss`; production output must be static local assets, with no server/SSR/CDN requirement.
- [X] T006 [P] Create the fixture manifest and test infrastructure in `tests/fixtures/manifest.json`, `tests/compatibility/manifest.test.ts` and `tests/vscode/run-tests.ts`; define provenance, redistribution permission, capability, MS-RDL citations, edit footprint, expected diagnostics/preservation and optional exact consumer/version evidence; wire Node, Angular and official Electron discovery, with real initial manifest-validation, `tests/vscode/activation.test.ts` and `tests/package/bootstrap.test.ts` checks for available scaffold behavior, never fake passing suites or claims of not-yet-implemented feature coverage.
- [X] T007 [P] Add MIT original-code licensing and third-party review records in `LICENSE`, `THIRD_PARTY_NOTICES.md` and `docs/validation/licenses.md`; distinguish vendored attribution and review saxes/xmlchars, Angular and shipped dependencies before adoption, recording unresolved incompatibilities as distribution blockers.
- [X] T008 Wire `format:check`, `lint`, `typecheck`, `test:unit`, `test:roundtrip`, `test:compatibility`, `build`, `package`, `test:vscode` and `test:package` in root `package.json`; add minimal TypeScript build/package orchestration in `scripts/build.ts` and `scripts/package.ts` only as needed, bundling workspace libraries and Angular assets with pinned vsce into the metadata-versioned VSIX; check scripts against `specs/001-rdlc-vscode-editor/quickstart.md`.

**Checkpoint**: A frozen install and production app/library builds work; test commands discover
real suites as they are added. No feature, compatibility or distribution claim is made yet.
T003–T007 run together after T002; T006's activation/package checks execute after T004/T005/T008
make the corresponding build available. T008 waits for all setup task definitions.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared source authority, preservation, diagnostics and trust boundaries.

- [X] T009 Define shared immutable contracts in `packages/report-model/src/document.ts`, `syntax.ts`, `diagnostics.ts`, `editing.ts` and `scene.ts`: DocumentSnapshot has "Every range and projection belongs to this version; original file remains owned by VS Code"; XmlSyntaxDocument has "Complete source coverage including whitespace, comments, processing instructions and CDATA; no token rewriting"; XmlNode has "Offsets are UTF-16, zero-based, half-open; prefixes and namespace redeclarations retained; IDs are not persisted in XML"; XmlAttribute has "Raw lexical form remains in source; unprefixed attributes have no default namespace"; Diagnostic must "Distinguish malformed XML, invalid authored value, unsupported construct, stale edit and preservation risk"; EditIntent has "Host validates shape, version, capability and references; never accepts arbitrary patches from the webview"; SourcePatch has "Sorted non-overlapping ranges; replacement affects only declared edit footprint; checked before one atomic WorkspaceEdit"; DesignScene has "Pure design geometry; no HTML, scripts, external resource URLs, or evaluated data".
- [X] T010 [P] Add parser/preservation adversarial tests in `packages/xml-parser/src/parser.test.ts` and `tests/roundtrip/lexical.test.ts` plus cited fixtures in `tests/fixtures/xml/`; cover BOM/EOL, astral Unicode, CDATA, comments, quotes, entities, prefix rebinding, duplicate expanded attributes, invalid characters, XML 1.1, DTDs and original UTF-16 offsets, with no external retrieval.
- [X] T011 Implement strict namespace-aware saxes validation and independently retained lexical spans in `packages/xml-parser/src/parser.ts` and `scanner.ts`; prove reconciliation against T010, reject unsafe declarations without entity registration, stop at malformed XML, and enforce proposed 16 MiB/depth 256/100,000-element source-only budgets without truncating or preventing source access (V3/V7).
- [X] T012 Implement root/version/section/capability projection in `packages/xml-parser/src/project-report.ts` and focused tests; ReportProjection requires "RDL 2016/01 and exactly one section for visual editing; other reports remain source-accessible"; ReportSection requires "Width belongs to ReportSection in 2016/01; height belongs to Body; do not synthesize legacy Report.Width"; PreservedRegion is "Not a detached copy: remains in place in source; mutation cannot move or regenerate it accidentally"; preserve unknown XML and disable authoring for unknown required MustUnderstand semantics.
- [X] T013 [P] Add expression and reference-contract tests in `packages/expressions/src/analyze.test.ts` using preserved/query/opaque expression fixtures in `tests/fixtures/expressions/`; exercise strings/escaped quotes, leading `=`, static field references, dynamic access, known expression-bearing preserved properties and incomplete analysis without executing any expression.
- [X] T014 Implement the bounded nonexecuting expression lexer/reference analyzer in `packages/expressions/src/analyze.ts`; ExpressionValue is "Never evaluated or translated to JavaScript; unknown syntax is retained and marked opaque"; Reference requires "Known references can block rename/delete; incomplete analysis blocks potentially destructive changes conservatively"; do not claim regex matching proves absence of dependencies.
- [X] T015 Implement shared capability/value/reference validation with tests in `packages/validation/src/validate.ts` and `validate.test.ts`; Page requires "Positive dimensions; nonnegative margins; positive printable width and height"; preserve original length strings/units and use 96 CSS pixels/inch only for geometry; names follow case-sensitive MS-RDL scopes, generate conservative ASCII CLS-compatible names and retain valid existing Unicode names; do not reject unrelated safe edits merely because unsupported content exists.
- [X] T016 Add tests first and implement patch-plan validation/in-memory application in `packages/xml-serializer/src/patches.ts`, `patches.test.ts` and `apps/vscode-extension/src/verify-candidate.ts`; reject overlaps, stale/changed expected text and unresolved namespace dependencies; reparse candidate XML, verify intended change and untouched-source equality before any atomic WorkspaceEdit, without whole-document regeneration.
- [X] T017 Add tested host/webview envelope validation and per-document binding in `packages/report-model/src/protocol.ts`, `apps/vscode-extension/src/protocol.ts` and `protocol.test.ts`; implement protocol version 1 ready/snapshot/edit/editResult/openSource/protocolError, request/base-version checks, document-scoped IDs and payload bounds; refuse unknown operations, nonfinite numbers and attempts to choose file paths or supply XML patches.
- [X] T018 Implement `.github/workflows/ci.yml` after T008–T017 with all-PR/main triggers, declared Node/pnpm pins, pnpm-store cache, frozen install, ordered root checks, production build and minimum/stable VS Code lifecycle/packaged matrix on Windows/macOS/Linux (Linux virtual display); pin action SHAs/runner labels, read-only permissions, no secrets/path-filter bypasses/artifact uploads, and a stable required aggregate check that fails on required failure/cancellation; retain missing feature/acceptance evidence as release blockers, not invented passes.

**Checkpoint**: All foundation tasks are complete and verifiable before story work starts.
T010 and T013 are disjoint after T009; implementations wait for their preceding tests.
CI remains active while later story suites extend the root checks.

## Phase 3: User Story 1 - Edit an Existing Report Safely (Priority: P1) — MVP

**Goal**: Open supported existing reports, edit supported textbox values/geometry/style and save
without losing unrelated source, namespaces or opaque content.

**Independent Test**: Open a mixed supported/foreign-XML fixture, edit an existing body textbox,
save/reopen and compare the intended change plus exact untouched ranges. A no-op save preserves
source/encoding where supported; unsupported or malformed content retains usable source access.

### Tests for User Story 1

- [X] T019 [P] [US1] Add supported/supported-plus-opaque textbox and unsupported-profile fixtures with per-section citations and projection assertions in `tests/fixtures/textboxes/`, `tests/compatibility/textboxes.test.ts` and the fixture manifest; require exactly one paragraph/run, retain rich text and expression-valued geometry as preservation-only where unsafe.
- [X] T020 [P] [US1] Add no-op and edited textbox roundtrip checks in `tests/roundtrip/textboxes.test.ts`; cover every FR-005 editable value, XML escaping, unknown attributes/children, namespace bindings and lexical equality outside intended footprints, plus refusal of destructive edits.
- [X] T021 [P] [US1] Add deterministic scene/placeholder tests in `packages/renderer/src/render.test.ts` for page/body bounds, local-font text labels and unsupported items; assert scenes contain no executable HTML, scripts, evaluated values or resource retrieval.
- [X] T022 [P] [US1] Add Angular component/protocol tests in `apps/designer/src/app/editor/editor.component.spec.ts` for accepted snapshots, selection, textbox forms, supported styles, diagnostics, disabled capabilities, labels and keyboard commit behavior without optimistic document authority.
- [X] T023 [P] [US1] Add official Electron acceptance tests in `tests/vscode/existing-report.test.ts` for custom-editor opening, visual property edits, save/reopen, no-op save, source fallback and rejected unsafe operations on a fixture containing foreign XML.

### Implementation for User Story 1

- [X] T024 [US1] Add Textbox/report-body types and supported projection in `packages/report-model/src/report.ts` and `packages/xml-parser/src/project-textboxes.ts`; enforce "Editable only with one paragraph and one text run; body-level textboxes and supported table-cell textboxes are distinct contexts" and preserve exact source references to values/styles, unknown nodes and namespaces (T019).
- [X] T025 [US1] Add tested textbox editing rules in `packages/validation/src/textboxes.ts`; enforce nonnegative positions, positive dimensions, valid colors/sizes, report-wide unique names including preserved/nested items, literal/expression distinction and capability checks, with actionable locations and no runtime-validity overclaim.
- [X] T026 [US1] Implement minimal textbox property/text/style patch planning in `packages/xml-serializer/src/textboxes.ts` against T020/T025; preserve raw units when unchanged, apply XML escaping only to changed values, use the version-specific property-order rules and refuse any mutation that cannot retain unrelated/unknown content.
- [X] T027 [US1] Implement pure authoring scenes in `packages/renderer/src/render.ts` and `geometry.ts` against T021; render page/body, textbox geometry and labeled preservation placeholders with native arithmetic, never a report-processing or data-preview engine.
- [X] T028 [US1] Implement `CustomTextEditorProvider` and secure packaged webview bootstrap in `apps/vscode-extension/src/editor-provider.ts` and `webview.ts`; bind the authoritative TextDocument, serve assets through asWebviewUri with asset-only localResourceRoots, inject script/style nonces and Angular CSP_NONCE, enforce the protocol/CSP contract and declare no network/server/runtime dependency.
- [X] T029 [US1] Implement the local authoring surface with Angular Signals in `apps/designer/src/app/editor/editor.component.ts`, `editor.component.html` and `editor.component.scss`; consume only accepted immutable snapshots/scenes, use escaped text bindings, render placeholders and select items without turning XML/report URLs into DOM or fetches.
- [X] T030 [US1] Implement existing-textbox property/style forms in `apps/designer/src/app/properties/textbox-properties.component.ts`, `.html` and `.scss`; expose rename, literal/expression text, position, size, local font, font size, bold, italic, text color and horizontal alignment, with finite-value validation, labels and explicit commit boundaries (T022).
- [X] T031 [US1] Add diagnostic/source-access presentation in `apps/designer/src/app/diagnostics/diagnostics.component.ts` and `apps/vscode-extension/src/commands/open-source.ts`; reveal validated source ranges, distinguish invalid/unsupported/stale/preservation errors, retain source opening for all profiles and show actionable blocked-operation reasons.
- [X] T032 [US1] Connect typed visual intents to parse/analyze/validate/patch/reparse/verify/apply in `apps/vscode-extension/src/edit-controller.ts` and `apps/designer/src/app/editor/host-adapter.ts`; treat the source as sole authority, submit one WorkspaceEdit per logical action and publish state from document changes, never direct disk writes or unconditional success on refused applyEdit.
- [X] T033 [US1] Execute T019–T023 and the existing-report/offline checks from `specs/001-rdlc-vscode-editor/quickstart.md`; record exact fixture footprints, OS/VS Code versions, results and remaining blockers in `docs/validation/us1.md`, resolving any source loss before accepting the MVP.

**Checkpoint**: Existing-report editing works independently of new-report/table/dataset UI.
Basic native save/undo behavior is required here; US3 deepens lifecycle coverage, not permission
to ship a destructive MVP. Public release still requires all applicable cross-cutting gates.

## Phase 4: User Story 2 - Create a Report with Grouped Tables (Priority: P2)

**Goal**: Create a supported report, edit page/body, add/edit/remove textboxes and tables, declare
local datasets/fields, configure groups/totals and save/reopen without data access or conversion.

**Independent Test**: From an untitled report, define `Orders` with all seven field types, add
two textboxes and a two-column table, edit a row group and both group/dataset totals, save/reopen
and verify metadata/hierarchy/expressions. Referenced or potentially referenced renames/deletes
must be refused with diagnostics; no query executes.

### Tests for User Story 2

- [X] T034 [P] [US2] Add cited blank-report/query-free dataset/all-seven-field-type fixtures and checks in `tests/fixtures/datasets/` and `tests/compatibility/datasets.test.ts`; record provenance and precise consumer-version evidence for V4 in `docs/validation/local-data.md`, withholding unsupported runtime claims rather than inventing Query/source metadata.
- [X] T035 [P] [US2] Add supported tablix/group/footer/scope fixtures and expression/shape checks in `tests/fixtures/tables/`, `tests/compatibility/tables.test.ts` and `packages/expressions/src/totals.test.ts`; use per-row/hierarchy invariants for V5, dataset-wide report totals and group-name subtotal scope for V6, explicitly retain the unresolved broad §2.23 ambiguity.
- [X] T036 [P] [US2] Add structural roundtrip/reference-safety checks in `tests/roundtrip/authoring.test.ts`; cover create/delete textbox, dataset/field changes, table column/group/total operations, atomic rejection, namespace preservation, dangling/opaque references, matrices, merged/spanning cells and unknown types.
- [X] T037 [P] [US2] Add Angular and Electron acceptance checks in `apps/designer/src/app/authoring/authoring.component.spec.ts` and `tests/vscode/new-report.test.ts` for blank creation, Save As/reopen, page/body forms, keyboard authoring, field selection, grouping/totals and blocked referenced renames/deletes.

### Implementation for User Story 2

- [X] T038 [US2] Extend immutable types in `packages/report-model/src/report.ts` for Table, TableColumn, TableRow/Cell, RowGroup, TotalDefinition, LocalDataset and DatasetField; quote/enforce "Only supported table-shaped tablix structures; matrix and opaque structural features are preservation-only", "Positive width; body column count equals leaf column-member count", "Positive height; cell spans and hierarchy must match body shape; unsupported merged/spanning cells block structural edits", "Group names meet MS-RDL scope rules; hierarchy leaf rows match body rows; totals are explicit static rows, not metadata flags", "Explicit scope; preserved as unevaluated expression text; changing groups checks dependent totals", "No data connection or execution; creation follows the validated RDLC template decision" and "Field names unique per dataset; new data fields map to their own names; existing mappings/calculated fields preserved".
- [X] T039 [US2] Extend source-bound projection in `packages/xml-parser/src/project-datasets.ts` and `project-tables.ts` against T034/T035; distinguish DataField/calculated Value, preserve absent/unknown designer metadata and existing Query/data-source mappings, and classify table scalar-edit versus structural-edit capabilities without flattening hierarchy.
- [X] T040 [US2] Implement tested dataset/field mutation validation in `packages/validation/src/datasets.ts`; enforce report-unique datasets, per-dataset unique fields and exact authored mappings text→System.String, Boolean→System.Boolean, Int32→System.Int32, Int64→System.Int64, decimal→System.Decimal, double→System.Double, date/time→System.DateTime; unknown existing types remain preserved and known/opaque dependency analysis blocks unsafe rename/remove.
- [X] T041 [US2] Implement local dataset/field patch planners in `packages/xml-serializer/src/datasets.ts` against T036/T040; new DataField equals its field name, designer TypeName uses the seven mappings, existing calculated fields/queries/metadata stay untouched, namespace additions use a noncolliding prefix in the narrowest safe scope and no database/query/expression is executed.
- [X] T042 [US2] Implement the validated single-section RDL 2016/01 blank template and new-report command in `apps/vscode-extension/src/templates/blank-report.ts`, `commands/new-report.ts`, plus page/body patches in `packages/xml-serializer/src/page.ts`; create an untitled TextDocument with normal Save As, expose width/height/margins/body dimensions and preserve positive printable area.
- [X] T043 [US2] Implement local dataset/field authoring and field picker in `apps/designer/src/app/datasets/datasets.component.ts`, `.html` and `.scss`; expose all seven types and create/rename/delete operations, show affected references on blocked changes, preserve unknown fields read-only and never request actual field values or data connections.
- [X] T044 [US2] Implement tested field-binding and scoped Sum-expression generation in `packages/expressions/src/totals.ts` against T035; keep exact unevaluated strings, explicit dataset-wide report-total scope and group-name subtotal scope, and conservatively mark unsupported/dynamic syntax incomplete.
- [X] T045 [US2] Implement tested table/group/total validation in `packages/validation/src/tables.ts`; require existing dataset/field references, unique group identities, positive row/column dimensions, matching leaf/body counts and correct static-footer placement, reject structural edits on opaque/spanning structures and distinguish dataset-wide totals from filtered tablix totals.
- [X] T046 [US2] Implement atomic create-table/column/cell/group/total planners in `packages/xml-serializer/src/tables.ts`; update body rows, cells, row/column hierarchy, widths, bindings and scoped totals together or refuse all, preserve unsupported siblings/attributes and satisfy structural roundtrip tests without global-cell-count assumptions.
- [X] T047 [US2] Extend pure design scenes in `packages/renderer/src/tables.ts` with focused geometry tests; project supported rows/cells/group/total labels and placeholders, never runtime records, pagination, external resources or expression results.
- [X] T048 [US2] Implement table/column/cell authoring in `apps/designer/src/app/tables/table-properties.component.ts`, `.html` and `.scss`; select local datasets/fields, add/remove columns and edit cell literal/expression text through typed intents, showing preservation-only/blocked capabilities and diagnostics.
- [X] T049 [US2] Implement row-group and scoped-total controls in `apps/designer/src/app/tables/groups-totals.component.ts`, `.html` and `.scss`; expose add/change/remove for grouping expressions and group/report totals, label report totals as dataset-wide and emit one structural intent per accepted operation.
- [X] T050 [US2] Implement creation/deletion/positioning/resizing controls and page/body forms in `apps/designer/src/app/authoring/authoring.component.ts`, `.html` and `.scss`, integrating intents in `apps/vscode-extension/src/edit-controller.ts`; use unique names, one committed edit per completed gesture, explicit deletion of contained preserved content and no stale draft reuse.
- [X] T051 [US2] Complete keyboard alternatives, labels and focus management in `apps/designer/src/app/authoring/authoring.component.ts`, `datasets/datasets.component.html` and `tables/table-properties.component.html`; verify every FR-012 creation/selection/property/table/column/group/total/dataset/field action without pointer input or focus traps.
- [X] T052 [US2] Run the independent create/save/reopen/reference-safety scenarios and T034–T037; record V4/V5/V6 fixture/consumer evidence, every field mapping and exact structural edit footprint in `docs/validation/us2.md`; resolve correctness failures or keep affected claims blocked, never expand the authoring profile implicitly.

**Checkpoint**: A complete report can be created from scratch and verified independently with
synthetic/local fixtures; no existing user report or external runtime is needed. This phase
uses the shared US1 editing pipeline, but has its own end-to-end acceptance scenario.

## Phase 5: User Story 3 - Use Familiar Document Controls (Priority: P2)

**Goal**: Exercise and complete the native document lifecycle across visual/source views,
undo/redo, cancellation, save failure and external changes, preserving all pending work.

**Independent Test**: Perform 20 visual edits, undo/redo all, update valid/invalid source in a
second view, attempt a stale visual action and exercise dirty close/cancel, failed save and
external conflicts. All views converge on the TextDocument or report a blocked operation;
zero pending changes are silently lost.

### Tests for User Story 3

- [ ] T053 [P] [US3] Add lifecycle checks in `tests/vscode/lifecycle.test.ts` for 20 edit/undo/redo operations, dirty indicators, normal save/Save As, clean reload, close save/discard/cancel and failed/read-only saves that retain pending edits.
- [X] T054 [P] [US3] Add race/protocol checks in `tests/vscode/synchronization.test.ts` for split views, asynchronous source edits, invalid-to-valid transitions, duplicate/delayed requests, stale IDs/version mismatches and a refused applyEdit; assert no speculative success, duplicate mutation or stale retry.
- [X] T055 [P] [US3] Add encoding/EOL/external-change checks in `tests/vscode/persistence.test.ts`; verify no-op bytes for supported encodings/BOM/CRLF, normal dirty-file conflict resolution and no direct disk overwrite or lossy forced reload.
- [X] T056 [P] [US3] Add Angular lifecycle-state checks in `apps/designer/src/app/editor/lifecycle.spec.ts` for multiple-view snapshots, invalid-source disabled writes, stale draft/gesture cancellation with explanation and selection/focus remaining disposable rather than persisted report state.

T053's automated undo/redo, structural-edit lifecycle, save/reopen, explicit native
discard and save-permission failure checks pass. Native dirty-close dialog choices
and interactive Save As cancellation remain unrun; keep T053 and the final T061
checkpoint open until the manual procedure in `docs/validation/us3.md` is recorded.

### Implementation for User Story 3

- [X] T057 [US3] Complete session serialization, duplicate-result handling and last-moment version checks in `apps/vscode-extension/src/document-session.ts` and `edit-controller.ts` against T054; every snapshot/ID/range remains document-version-scoped, and authoritative success/state follows accepted document changes rather than optimistic UI mutation.
- [X] T058 [US3] Complete source/visual/split-view synchronization and source-access commands in `apps/vscode-extension/src/editor-provider.ts`, `commands/open-source.ts` and `apps/designer/src/app/editor/host-adapter.ts`; invalid source disables visual writes but may be deliberately saved as text, and source changes invalidate stale IDs/drafts without discarding source access.
- [X] T059 [US3] Complete native document-service delegation and listener/session disposal in `apps/vscode-extension/src/document-session.ts` and `editor-provider.ts`; rely on VS Code for dirty/save/Save As/close/external conflict resolution, retain dirty state on errors/cancellation and never add a parallel saved document, filesystem writer or visual undo stack.
- [X] T060 [US3] Complete gesture/form commit and stale-draft behavior in `apps/designer/src/app/editor/editor.component.ts` and `authoring/authoring.component.ts`; selection/focus/zoom remain Signals-only preferences, pointer gestures commit once, host snapshots cancel obsolete work with a visible explanation and undo/redo reflect source changes.
- [ ] T061 [US3] Execute T053–T056 and record V8 lifecycle/encoding/EOL/multiple-view/failure outcomes in `docs/validation/us3.md`; require zero silent loss and treat any failing save/conflict/undo safeguard as a release blocker.

**Checkpoint**: US3 is independently tested using an existing-report fixture and needs no US2
table/dataset UI. When US2 is available, rerun the same lifecycle suite for its structural edits.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete mandatory security, accessibility/performance, distribution and approved
CI/CD delivery. These are release requirements, not optional embellishments or new user stories.

- [ ] T062 [P] Add/execute installed-VSIX isolation checks in `tests/package/offline.test.ts` and `tests/fixtures/security/`; verify CSP/nonces/chunks, no active listener, no network attempts, no remote fonts/source maps/telemetry and zero code/expression/query/entity/resource execution for malicious local/remote input in untrusted workspaces; record V2/FR-011/SC-005 evidence in `docs/validation/isolation.md`.
- [ ] T063 [P] Add the bounded performance/keyboard/usability acceptance procedure and measurements in `tests/performance/editor.test.ts` and `docs/validation/acceptance.md`; record reference hardware, <=3 seconds for >=19/20 opens at 1 MiB (1,048,576 bytes)/100 textboxes and <=200 ms for >=95/100 property interactions. Follow SC-004 exactly: measure open command to painted first accepted snapshot with supported property controls enabled, starting each open with a closed report editor and fresh webview in running VS Code; measure valid property commit to the corresponding painted accepted document change. Verify the full SC-006 keyboard workflow and SC-001's 4/5 authors creating/saving/reopening in 10 minutes; validate/tune V7 budgets without weakening preservation and do not infer absent measurements as passes.
- [ ] T064 Complete production package-content/version/identity/license checks in `scripts/package.ts`, `scripts/verify-vsix.ts` and `tests/package/contents.test.ts`; verify the versioned VSIX contains all local Angular chunks/styles and bundled runtime modules/notices, excludes secrets/dev-only files and native/OS-specific dependencies, and loads on minimum/stable VS Code across the three OSes (V2).
- [ ] T065 [P] Write English contributor/install/profile/limitation/release documentation in `README.md`, `CONTRIBUTING.md` and `docs/releases.md`; preserve bounded vendor lookup and gitmoji Conventional Commits, and have an independent contributor follow `specs/001-rdlc-vscode-editor/quickstart.md` to build/install offline, recording SC-007 in `docs/validation/contributor-build.md`.
- [ ] T066 [P] Add release-version/commit-policy tests in `tests/release/version.test.ts` and `tests/release/commits.test.ts`; cover canonical stable SemVer, leading zeros, annotated tag peeling, wrong-main ancestry, tag/root/extension mismatch, unchanged private-package versions and gitmoji-prefixed scoped Conventional Commit/breaking-change parsing; cover missing/failed/unrun evidence, stale candidate records, permitted explicitly listed validation-evidence-only diffs, rejected code/version/lockfile/tool/workflow diffs and unconfigured versus invalid configured Open VSX evidence.
- [ ] T067 Implement tested read-only tag/metadata/evidence checks in `scripts/validate-release.ts` and finish `scripts/check-commits.ts`; ReleaseIdentity requires "Tag immutable; root and extension versions equal tag without `v`; commit on protected main history; configured destination identities match the publisher embedded in the single canonical VSIX". Enforce `specs/001-rdlc-vscode-editor/contracts/ci-cd.md#mandatory-acceptance-evidence` against `docs/validation/release-readiness.md`: reject missing/failed/unrun or stale required records, validate candidate/tool/version identity and the full candidate-to-tag diff, allowing only explicitly listed validation-evidence Markdown under `docs/validation/`; no metadata-change exemption. Never rewrite metadata/lockfile/tag during release, and validate PR titles/squash subjects plus applicable commit ranges in `.github/workflows/ci.yml`.
- [ ] T068 [P] Add manifest/digest/recovery checks in `tests/release/artifact.test.ts` and `tests/release/recovery.test.ts`; exercise explicit VSIX mismatch despite an archive-digest warning, immutable artifact-ID lookup, concurrent same-tag exclusion, each partial-destination failure, lost publish responses, proven-success no-ops, unknown existing-version conflict and unavailable/expired provenance without rebuilding.
- [ ] T069 Implement minimal tested artifact/provenance/recovery logic in `scripts/release-artifact.ts` and `scripts/verify-release.ts`; ReleaseManifest requires "Created only from verified tagged source; no secrets; VSIX metadata matches identity; immutable after attachment"; ArtifactReference requires "Archive hash is not the VSIX hash; explicit VSIX mismatch fails; no overwrite or latest-name lookup"; DestinationResult requires "Status is pending, succeeded, failed, conflict or not-configured; success requires acknowledged publication bound to this VSIX or verified prior evidence"; inventory all destinations before writes and fail closed when no supported evidence links an existing version to the canonical SHA-256.
- [ ] T070 Define configurable publisher/namespace/authentication preflight in `scripts/validate-release-config.ts` with focused tests and document exact GitHub setup in `docs/releases.md`; validate `MARKETPLACE_PUBLISHER`, optional `OPENVSX_NAMESPACE`, Entra client/tenant/login configuration and `OPENVSX_AUTH_MODE`/OVSX_PAT without exposing credentials, rejecting namespace/embedded-publisher mismatch, conflicting PAT/OIDC modes and invalid configured optional publication; document protected main/tags/environments with no post-tag approval gates.
- [ ] T071 Resolve V9's real authentication prerequisites and record sanitized proof in `docs/validation/publishing-auth.md`: configure required accounts/roles/agreements before first release, confirm pinned azure/login GitHub federation and pinned vsce AzureCliCredential/prebuilt upload in a controlled namespace, and use job-local GITHUB_TOKEN for GitHub. GitHub and Marketplace evidence is mandatory; only when Open VSX is configured, validate the bootstrap PAT or registered trusted-publisher mode being used. Record unconfigured Open VSX as not-configured without blocking release; invalid configured authentication or unsupported required methods block publication. No Azure Pipelines or invented token exchange.
- [ ] T072 Implement secret-free validation/quality/production-package stages in `.github/workflows/release.yml` on tag push `v*.*.*`; strict-check detached reviewed tag commit and invoke T067's mandatory evidence validator before any artifact upload, rerun the shared CI quality matrix, then build/verify/smoke-test one canonical versioned VSIX. Compute SHA-256/manifest including tested candidate identity, accepted evidence paths/hashes and the permitted documentation-only diff bound to the tagged commit and canonical digest; upload by immutable artifact ID only after all gates pass. Use pinned actions/runners, frozen lockfile, pnpm cache and tag-scoped noncancelling concurrency.
- [ ] T073 Add isolated authentication-preflight and GitHub publication jobs in `.github/workflows/release.yml`; require T071 evidence, grant contents write only to the GitHub writer, download/verify the exact canonical artifact, generate notes with explicit previous stable tag bounds, automatically create/complete/publish the exact-tag GitHub Release draft with VSIX/manifest and never overwrite assets or wrongly replace a newer latest release.
- [ ] T074 Add sequential isolated Marketplace and optional Open VSX jobs in `.github/workflows/release.yml`; use validated Entra federation with pinned vsce prebuilt-package publishing and Open VSX PAT/bootstrap or configured trusted OIDC, pass no source checkout/lifecycle build hooks, reuse the same verified VSIX bytes, scope credentials/OIDC per job and fail clearly on configured authentication/publication errors instead of silent skips.
- [ ] T075 Finish fail-closed retry/state summaries in `.github/workflows/release.yml` using the tested T069 logic; identify completed/failed/pending/not-configured destinations, resume missing stages from the original run/artifact ID or verified durable GitHub copy without compile/repackage, accept an existing version only with reliable canonical-artifact association, and never use duplicate skipping/deletion/overwrite as recovery.
- [ ] T076 Configure/document 90-day canonical artifact/manifest/available publication-evidence retention and durable unmodified GitHub assets in `.github/workflows/release.yml` and `docs/releases.md`; explain GitHub's 30-day/50-attempt rerun limit, use Re-run failed jobs rather than rerunning builds, and block expired-window or missing-proof recovery until a separately reviewed path exists.
- [ ] T077 Resolve V10 remote-association proof in `docs/validation/release-recovery.md` using controlled GitHub/Marketplace and configured Open VSX publication and injected failures from `tests/release/recovery.test.ts`; record unconfigured Open VSX as not-configured. Prove same SHA-256 artifact handoff, remote package equality where supported or reliable prior acknowledged success bound to the manifest, and explicit conflict on ambiguity; do not claim unchanged Marketplace download bytes or an undocumented checksum endpoint without evidence.
- [ ] T078 Verify the complete workflow behavior in a controlled repository/publisher namespace and record results in `docs/validation/github-actions.md`: fork/same-repository PR secret isolation, every failing quality/evidence gate blocking all uploads, cold cache/stale lockfile, tag/version rejection, exact tagged source, missing versus invalid Open VSX configuration, same-tag concurrency and failed-job recovery after each partial success; resolve applicable V9/V10 failures before production publication. Then prepare and review the root/extension version-synchronization commit, updating `pnpm-lock.yaml` if needed, before T079's final candidate acceptance.
- [ ] T079 On T078's reviewed version-prepared candidate commit, run all story/unit/roundtrip/compatibility/lifecycle/package gates, complete applicable mandatory manual acceptance and audit >=12 fully described accepted fixtures in `tests/fixtures/manifest.json`; update `docs/validation/release-readiness.md` with tested candidate identity, final root/extension versions, required evidence paths/results, applicable V1–V10 evidence, tool/consumer versions, licenses and explicit unresolved blockers. Record unconfigured Open VSX as not-configured; require evidence only for its configured authentication mode. Commit results as explicitly listed validation-evidence Markdown under `docs/validation/`, without changing candidate code/configuration/versions; design approval or unrun checks must never be marked as passing.
- [ ] T080 After T079 passes, verify the actual GitHub protection/environment/credential configuration against `docs/releases.md` for applicable destinations and run T067's evidence/identity validation against the intended release commit. Record final readiness in `docs/validation/release-readiness.md`; allow only explicitly listed evidence-documentation differences from the tested candidate and rerun applicable verification after any other change, including version synchronization. Leave tag creation/push and real production publication to an explicit release action rather than triggering them as part of task completion.

**Checkpoint**: All applicable evidence is complete before a production tag. A successful
normal tag release then runs without human approvals or manual marketplace uploads. A failed
release can require a deliberate failed-job rerun, never new bytes under an existing version.

## Dependencies & Execution Order

### Phase Dependencies

```text
T001 -> T002 -> {T003,T004,T005,T006,T007} -> T008
Setup -> T009 -> parser/expression/validation/patch/protocol foundation -> T018
Foundation -> US1 (T019-T033) -> US2 (T034-T052)
                            -> US3 (T053-T061)
US1 + US2 + US3 -> final acceptance + approved delivery -> release readiness
```

T011 follows T010; T012 follows T011. T014 follows T013. T015 consumes T012/T014.
T016 consumes T011/T015 and T017 consumes T009. T018 waits for T008–T017.

### User Story Dependencies

- **US1/P1** needs only the completed foundation. Its existing-report acceptance does not
  depend on US2 creation UI or US3's extended suite; source-preservation safeguards are already
  mandatory in foundation/US1.
- **US2/P2** builds on US1's source-editing/host/UI pipeline. Within US2, T038 precedes T039;
  T040/T041/T043 form the dataset path; T044/T045/T046/T047/T048/T049 form the table path;
  T042 supplies blank creation; T050/T051 integrate authoring; T052 validates the complete story.
- **US3/P2** builds on US1 and can be accepted with existing fixtures before US2. Recheck its
  lifecycle behavior with US2 structural operations once integrated. US2 and US3 both modify
  host/controller/UI files, so do not concurrently edit shared files without explicit ownership.
- No claim is made that all three stories can be implemented independently from an empty repo;
  independent test scenarios use shared verified infrastructure and do not require user data.

### Within Each User Story

- Write the story checks before its implementation. Add unit assertions with non-trivial logic.
- Define shared types before projections and validation; validate before planning patches.
- Complete pure behavior before wiring the host/UI; verify candidate preservation before apply.
- Every authored operation must reach types, parser/projection, validation, serializer,
  renderer where applicable, typed host protocol, Angular controls and relevant fixture checks.
- Record checkpoint results; a failed safety gate blocks progression/publication.

### Parallel Opportunities

- T003–T007 are disjoint setup work after T002. T010 and T013 are separate test work after T009.
- US1 T019–T023, US2 T034–T037 and US3 T053–T056 are disjoint test batches after their phase
  prerequisites; coordinate the shared fixture manifest through T006's established format.
- T062, T063 and T065 are independent cross-cutting verification/documentation after the story
  implementation and packaging prerequisites. T066 and T068 are disjoint tooling test batches.
- Unmarked delivery tasks are sequential when they touch `.github/workflows/release.yml`.
  T067 follows T066; T069 follows T068; T072 needs T064/T067/T069/T070; T073/T074 additionally
  require T071. T075 follows T073/T074; T076–T078 exercise/configure the completed pipeline;
  T078 prepares the reviewed release versions before T079 validates that candidate; T080 checks
  final configuration/evidence identity without changing versions. T079/T080 are the final
  readiness barrier. T077 must resolve the affected recovery method
  before enabling that path in production; unknown remote versions always conflict meanwhile.
- T071 account/role setup can be prepared while application work progresses, but its controlled
  end-to-end publication requires an available test VSIX and is not a production release.

## Parallel Example: User Story 1

After Phase 2, prepare disjoint failing checks together:

```text
T020: tests/roundtrip/textboxes.test.ts — exact preservation for intended property edits
T021: packages/renderer/src/render.test.ts — deterministic scenes/placeholders
T022: apps/designer/src/app/editor/editor.component.spec.ts — forms and accepted state
T023: tests/vscode/existing-report.test.ts — actual custom-editor save/reopen
```

Implementation then follows the type/validation/patch/host dependencies; do not parallelize
shared `report.ts`, controller or component files merely because tests were parallel.

## Parallel Example: User Story 2

After US1, prepare these independent feature contracts together:

```text
T034: tests/compatibility/datasets.test.ts — query-free fields and type metadata
T035: tests/compatibility/tables.test.ts — body/hierarchy and subtotal/report scopes
T036: tests/roundtrip/authoring.test.ts — structural edit footprints and refusal
T037: tests/vscode/new-report.test.ts — complete blank-to-save journey
```

Agree the T038 shared types before dataset/table implementation streams. Merge edits to the
fixture manifest and host intent/controller contracts deliberately, not through concurrent writes.

## Parallel Example: User Story 3

After US1, the separate lifecycle test files can be written together:

```text
T053: tests/vscode/lifecycle.test.ts — undo/save/cancel
T054: tests/vscode/synchronization.test.ts — split views, duplicates and races
T055: tests/vscode/persistence.test.ts — encoding/EOL and dirty external changes
T056: apps/designer/src/app/editor/lifecycle.spec.ts — stale draft cancellation
```

Run Electron suites with isolated workspaces/profiles; do not share dirty fixture files between
concurrent test processes. T057–T060 coordinate the same host/editor files sequentially.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundation, including actual preservation/security checks and active CI.
2. Complete US1 and demonstrate safe existing-report textbox editing from an installed VSIX.
3. Stop and validate its exact independent scenario; do not label planned checks as passed.
4. This is a local MVP/demo checkpoint, not approval to publish without mandatory release gates.

### Incremental Delivery

1. Add US2 as a complete new-report/local-dataset/grouped-table increment with its own fixtures.
2. Complete US3 extended lifecycle proofs; its test preparation may overlap US2 after US1.
3. Complete cross-cutting acceptance, licensing, offline packaging and approved GitHub delivery.
4. Resolve V9 authentication and V10 association/retry proofs before publication or enabling
   affected recovery paths. Unconfirmed methods remain explicit prerequisites, not new designs.
5. A later explicit release action creates a tag; automation distributes the exact canonical
   artifact without another build or manual approval in any publisher job.

### Parallel Team Strategy

Agree shared interfaces and ownership first. Use the disjoint task batches above; keep shared
model/manifest/controller/workflow edits sequential. No subagent or parallel execution is
launched by this document itself.

## Notes

- Traceability: US1 covers FR-001/003/005/006/007/010/011/019; US2 covers
  FR-002/004/005/012/014/015; US3 covers FR-008/009. Setup/foundation/delivery cover
  FR-013/016/017/018/020 and constitution VI. Shared safety requirements apply to every story.
- Schema evidence: use the version-specific paths/sections already selected in contracts and
  discover only additional sections needed by the current task. Preserve the unresolved
  general §2.23 ambiguity rather than expanding scope or manufacturing conformance.
- Data-model constraints quoted in tasks are invariants, not permission to normalize existing
  unsupported source. Unknown constructs remain in-place source-owned regions.
- No database, authentication feature for extension users, application HTTP API, expression
  execution engine, matrix authoring or alternative implementation language is introduced.
- Commit coherent completed units with `:gitmoji: type(scope): description` in English. Task
  completion does not authorize production tags, destructive account changes or publication.
