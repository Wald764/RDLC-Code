# Research: Native VS Code Sidebar Integration

**Date**: 2026-10-24 · **Method**: bounded source inspection, three focused research agents and official API/package metadata. This resolves design choices; it does not claim executed product/probe evidence.

## 1. Native surface and filtering

**Decision**: Three native TreeViews in one Activity Bar container, native commands/menus/welcome states, title-action input filtering, and the supplied package-relative activity SVG. Keep host-owned view layout and use accepted membership/primary row cues alongside native highlight.

**Rationale**: Stable public APIs cover contribution, refresh, `getParent`/reveal and keyboard interactions. `TreeView.selection` is readonly; arbitrary programmatic multi-highlight is not available. A TreeDataProvider has no inline search widget. Native descriptions and accessible labels can truthfully represent accepted multi-selection without creating another sidebar webview.

**Alternatives considered**: A sidebar Angular webview duplicates navigation/accessibility work; replacing Explorer violates scope; pretending `reveal` sets an arbitrary selection loses body-set identity.

**Evidence**: `apps/vscode-extension/package.json`; `media/rdlc-activity.svg` within that package; official [Tree View guide](https://code.visualstudio.com/api/extension-guides/tree-view); installed `node_modules/@types/vscode/index.d.ts`. Runtime icon contrast and selection cues still require AT-01/03/07/08.

## 2. Document/view context and asynchronous authority

**Decision**: Add a window-scoped routing registry over existing panel-local sessions, keyed by document lifetime and opaque view ID. Extract reusable accepted evaluation for source-only context. Track actual custom-panel/tab/text-editor lifecycle; sidebar focus retains context, explicit unrelated editor activation clears it. Every action captures and rechecks document/view/version/generation after waits.

**Rationale**: `RdlcEditorProvider.resolveCustomTextEditor` creates one session per panel; `DocumentSession.queues` already shares mutation serialization per TextDocument. Selection, viewport and draft ownership must remain per designer. An active-text-editor-only shortcut misses custom panels. Source-only navigation needs accepted evaluation without silently opening a designer.

**Alternatives considered**: One mutable global current document risks wrong-file edits; singleton sessions lose split-view state; independent native mutation/save logic duplicates the authoritative pipeline.

**Evidence**: `apps/vscode-extension/src/{extension,editor-provider,document-session,protocol}.ts`, `commands/open-source.ts`. Close the post-await source-range validation gap in `DocumentSession.openSource` at its shared owner.

## 3. Guarded bridge and result correlation

**Decision**: Extend the closed shared protocol with native actions, accepted-selection publication and correlated outcomes. Reuse Angular selection/create/inspector handlers, existing pending/draft settlement and snapshot/edit-result reconciliation. Keep waiting outside the mutation queue; carry native correlation through existing edit requests.

**Rationale**: Current `ClientMessage`/`HostMessage` has no native selection bridge. `EditorComponent.held` and Apply/Discard/Cancel already protect drafts: Apply clears the deferred operation, Discard resumes it, Cancel retains draft. Native acknowledgements must reflect that behavior without stale replay. Result-before-snapshot and snapshot-before-result are already reconciled for edits.

**Alternatives considered**: Optimistic tree highlight as authority bypasses drafts; arbitrary command strings weaken validation; waiting for draft application inside its own document queue can deadlock; automatic retry rebases forbidden stale actions.

**Stale selections after a wait**: A native selection queued behind an insert or another action is re-checked once its turn comes. A caller that guards with `beforeDispatch` (the sidebar tree, whose rows went stale with the version) is dropped silently: `isDroppedOutcome` marks the placeholder outcome and no warning is shown, because a navigation-only select the user has already moved past is not an error. A caller without that guard is refused with "The report or designer changed while the action was being delivered: <reason>." where `<reason>` is the registry revalidation failure (for example `stale-version`). A refusal is never rebased onto the version that exists now.

**Evidence**: `packages/report-model/src/protocol.ts`; Angular `host-adapter.ts`, `selection.ts`, `editor.component.ts` methods `selectTree`, `create`, `held`, `applyDraft`, `discardDraft`, `cancelConflict`. See [bridge contract](contracts/sidebar-bridge.md).

## 4. Navigation coverage, safety and allocation

**Decision**: Extend read-only syntax navigation beside `projectStructure`, with a sibling Data projection. Emit actual table body/hierarchy/member/group/header relationships; move dataset navigation ownership to Data and update existing dataset-selection consumers. Keep unknown/foreign content opaque with source access. Recognize only explicitly tested known report namespaces for source-only inspection; do not loosen shared 2016 authoring helpers.

Allocate a shared maximum of 2,000 authored navigation entries across Structure and Data, with 32 emitted levels per projection. Reserve up to 1,000 entries for each, transfer unused capacity to the other deterministically, then validate the complete snapshot and halve each nonempty navigation prefix together until it fits. This deliberately retains the original total entry allowance instead of doubling it. Preserve parent-before-child prefixes and explicit per-projection truncation. Synthetic categories/markers carry no XML authority; cap their fixed count separately. If scene/authoring alone exceeds transport budgets, retain the existing source-only fallback with incomplete navigation states.

**Rationale**: Current host publication trims Structure to fit a snapshot also containing scene and authoring. Data appended independently could starve or overflow transport. Flat arrays separate 32-level hierarchy depth from the 20-level JSON envelope budget. Syntax, not authoring row-to-group mapping, establishes actual ancestry. Calculated/query-bearing/opaque data needs command-specific preservation classification.

**Alternatives considered**: Two independently entitled 2,000-entry projections increase the current aggregate; a fixed 1,000/1,000 split wastes capacity; raw XML metadata leaks payloads/secrets; adding parameter/image/source authoring types expands scope.

**Evidence**: renderer `structure.ts`; host `DocumentSession.publish`; report-model `validateMessage`; parser `parse`, `projectDatasets`, `projectTables`, `names.children`. Budgets: XML 16 MiB byte/code-unit checks, 100,000 elements/256 levels; snapshot 8 MiB/131,072 JSON values; other messages 64 KiB/8,192 values; JSON depth 20. Data is inert allowlisted metadata only.

**Format references**: MS-RDL §2.307 `vendor/02-structures/2.307-reportparameters.md`, §2.306 `2.306-embeddedimage.md`, §2.321 `2.321-datasources.md`, §2.34.5 `2.34.5-tablixmember.group.md`, §2.34.12 `2.34.12-tablixmember.tablixmembers.md`. Paths after the first share `vendor/02-structures/`. Group and nested members belong to TablixMember, not body rows. Inherited authoring citations remain in [baseline-analysis.md](baseline-analysis.md#format-references-and-compatibility-boundary); no runtime-fidelity claim or schema conversion follows.

## 5. Creation, centering and compact fallback

**Decision**: Route native activation through existing `create`, `defaultSpot`, `creationSpot` and authoring intents. Keep unbound Table creation, numbered naming and existing sizes. Default Angular left navigation to compact/closed with an explicit fallback toggle; retain inspector/toolbar/status and existing HTML drag. Add clamped center navigation at unchanged zoom at the existing viewport owner.

**Rationale**: Placement is view-local; the host cannot reconstruct it from document identity. Current `revealScroll` performs minimal reveal, not required centering. `ViewState.leftVisible` currently defaults true, so hiding duplicate expanded navigation requires a deliberate migration of absent/default state while respecting explicit fallback preferences. Existing gestures already own coordinate transforms and cancellation.

**Alternatives considered**: Host-computed placement, new creation forms and a second drag engine regress 004; removing Angular navigation entirely loses its working drag path; changing zoom to fit violates activation semantics.

**Evidence**: Angular `editor.component.ts`, `viewport.ts`, existing catalog/selection/inspector components. Use center `(target center × zoom) − viewport/2`, clamped to reachable scroll extents after page/body transforms; unknown geometry does not scroll.

## 6. Conditional native drag

**Decision**: Ship activation as the complete default; no native drag controller/affordance until a recorded public-API Desktop probe and full drop assertions pass. Unsupported probing is a documented capability outcome with mandatory activation/fallback proof.

**Rationale**: Installed VS Code declarations `TreeDragAndDropController` describe native transfers and `text/uri-list` editor resources, not guaranteed arbitrary HTML MIME delivery into custom-editor webviews. Existing in-webview MIME transfer proves only that surface.

**Alternatives considered**: URI smuggling, fake files and private APIs violate the specification; inferring support from types is not Desktop evidence.

**Evidence**: `node_modules/@types/vscode/index.d.ts:12056–12114`; [official API reference](https://code.visualstudio.com/api/references/vscode-api#TreeDragAndDropController). Probe requirements are fixed in [Desktop contract](contracts/desktop-validation.md); feasibility has not been run in planning.

## 7. Automated Desktop, visuals, offline and release gates

**Decision**: Reuse existing host/VSIX provisioning and evaluate exact test-only `playwright@1.64.1`, including `playwright/test`, for real Electron input and comparisons. This is the selected first driver candidate, conditional on a mandatory cross-platform capability bootstrap. Add root E2E/visual commands, matrix functional coverage, fixed reference comparisons and canonical-VSIX release checks. Observe blocked network attempts across host and webview with positive controls; use distinct trusted/restricted profiles.

**Rationale**: Current Node/Angular/native tests do not prove painted UI or actual workbench interaction. npm metadata retrieved on 2026-10-24 confirms version 1.64.1, Node ≥20, Apache-2.0 and exact matching core dependency. The official [Electron API](https://playwright.dev/docs/api/class-electron) supports executable-path launch but is experimental and documents Node CLI inspection fuse limitations. Current native runner disables trust; static offline tests cannot prove runtime attempt absence. Release canonical packaging rebuilds a VSIX, so matrix evidence alone cannot certify those exact bytes.

**Alternatives considered**: Existing browser-only stub cannot prove native integration; adding a separate screenshot framework duplicates the selected runner; treating failed bootstrap as optional would violate principle VII. If the candidate fails, record the operation/error and adapt the driver before mandatory delivery—not replace it with mocks/manual checks.

**Evidence**: root package scripts, `tests/vscode/run-tests.ts`, `tests/package/offline.test.ts`, `tests/browser/designer-ux.mjs`, `.github/workflows/{ci,release,publish}.yml`, npm registry `https://registry.npmjs.org/playwright/latest`. No install, binary launch, native drag probe or visual comparison was performed here.

## Resolution

### Implementation dependency verification — 2026-10-24

Installed exact root development dependency `playwright@1.64.1` using Node
24.22.0 and pnpm 11.28.2; the committed lockfile pins its matching
`playwright-core@1.64.1`. Installed package metadata confirms Apache-2.0 and
Node >=20. This test-only dependency is necessary for real Electron keyboard,
pointer, accessibility and screenshot assertions that the existing host and
jsdom suites cannot provide. It is not an extension runtime dependency. Its
installation does not establish Desktop driver capability or acceptance proof;
the mandatory bootstrap must still execute against the unmodified binary.

All technical design unknowns are resolved into bounded choices and explicit implementation probes. Runtime driver compatibility, native drag availability, accessibility capture and network-observer completeness remain unvalidated evidence obligations, not claimed working capabilities. No unresolved requirement interpretation or constitutional exception is carried forward.

### Executed Windows foundation probes — 2026-10-24

The actual VS Code 1.142.0 executable (build
`6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`, executable SHA-256
`5ca701a1facb91fec1ac6bbae11fc837821a1da34ddebb91a0bad7e87ab88144`)
launches through Playwright's **Electron** transport in this environment. The
anticipated fuse/loader problem did not occur here; the CDP fallback has not been
validated on a target that needs it.

Development and installed-VSIX probes reached real native rows and the actual
Angular designer, clicked Textbox, compared the complete saved report against an
independent literal XML oracle, invoked native Undo and recovered the complete
prior source. Accessibility-tree and screenshot/trace capture executed. These
capability observations are not full accessibility, security or visual proof.
Both initial probes failed at the required missing screenshot reference; at that
execution the security observation and native-drag suites were absent. No baseline
was auto-created and no native-drag capability was inferred from those probes.

The available Windows token is not elevated (`WindowsPrincipal.IsInRole` returned
false); WSL is not installed and Docker is unavailable. Pinned Ubuntu reference
visuals therefore cannot be generated or compared in the available environment.
No GitHub Actions run of this working-tree candidate has executed.

At the initial probe, T010 was unimplemented in addition to its platform capture limitation.
User-mode JavaScript/CDP interception and process snapshots could provide partial
observation, but cannot establish failed/short-lived/native attempted accesses
across the complete host process tree. The contract explicitly requires missing
mandatory platform coverage to fail. No elevated/system-wide trace, firewall
change or installation was attempted, and no partial observer is represented as
a passing security control. Native trust was left enabled; separate
trusted/restricted-profile proof remains unrun.

### Continued foundation implementation — 2026-10-24

The accepted report evaluator is now shared with source-editor context evaluation.
The window registry is connected to real document, panel and tab events without
opening a hidden designer. Pure regression checks cover document lifetimes,
source-only states, stale captures, one-time binding, disposal and request replay.
The real stable extension-host suite passed with a source-editor-only untitled
report, invalid-source transition and accepted-evaluation notifications. This does
not establish the later multi-view/draft/sidebar acceptance journeys.

The public-API native drag probe now uses a development-only TreeView contribution
in the existing test harness. On Windows with VS Code 1.142.0, real pointer input
invoked `handleDrag` for both cancellation and attempted delivery, but the custom
MIME did not reach an Angular drop. Cancellation delivered no drop, and saving
retained the exact fixture text. This local feasibility result is **unavailable**,
not a passing native insertion test or evidence for another platform. Production
has no native drag controller; activation/fallback acceptance remains unbuilt.

Desktop shutdown now checks the owned process exit status, records the shutdown
identity and propagates close/trace/cleanup failures. Real-process regressions
cover clean exit, abnormal exit and forced CDP termination. A new actual minimum
Desktop bootstrap reached XML/Undo/accessibility and clean shutdown, then failed
on the absent PNG reference as required.

CI now schedules the installed bootstrap on all six existing OS/version matrix
entries and uploads Desktop artifacts. No GitHub Actions execution of these
working-tree changes has occurred; this wiring is not cross-platform proof.

### Review corrections and executed revalidation — 2026-10-24

The evidence manifest now hashes normative status-marker contents, normalizes
checkbox state only in task/checklist documents, retains executable source inside
output directories, and rejects candidate symlinks. Malformed evidence/coverage
fails validation. Regression checks execute these invalidation cases. Executable
oracle binding, execution-time freezing and complete same-candidate aggregation
remain unfinished; historical manifests are stale after the current source edits.

Context authorization now distinguishes authored targets from preservation-only
source targets. Queued native edits retain and recheck their captured authority,
match the captured operation, and refuse selection/properties correlations as
mutation authority. Angular regressions cover exactly-once native selection,
properties and draft cancellation. An additional failing-then-passing protocol
regression covers selection at a native mutation's new version in both
selection/outcome orders. Native bridge and host wiring remain partial. The
matched protocol version migration required by T006 is complete: protocol
version 2 covers every message family, and version 1 messages are rejected by
tests.

`pnpm test:unit` passes **166 Node + 204 Angular** tests. An earlier full Angular
run hit two 5-second timeouts under load; the affected 107 tests and then the full
204 passed without changing assertions or timeouts. The real development host
suites pass on minimum **1.142.0** and stable **1.143.1**; the stable installed-VSIX
host suite also passes. Build/package, typecheck, lint and formatting checks passed
during this continuation. These checks do not complete any User Story.

The minimum `pnpm test:e2e -- --probe` run writes artifacts under
`.vscode-test/desktop-artifacts/run-b7c3e443-6560-4051-a0b8-aaa9518d726a/`.
Bootstrap fails on the missing reference PNG; native drag feasibility executes
and records **unavailable**; security fails. The observer implementation now
contains sanitized syscall/browser-attempt parsing and fail-closed unsupported
platform tests, but complete Windows host-tree observation, host-level outbound
blocking, real Angular-webview positive controls and query/entity/resource
attribution are missing. The attempted restricted/trusted profiles did not prove
their host trust states. Those gaps explicitly keep the security result
unvalidated, including on platforms where syscall capture might work. The owned
Desktop process ID is used rather than profile-name process discovery.

The requested independent targeted rereview was retried and again returned the
configured free model's usage-limit error. Earlier independent findings informed
these corrections; there is no successful independent rereview of the latest
candidate. No push, publication, deployment or GitHub Actions execution occurred.

The root `pnpm test:e2e` command also exits nonzero: bootstrap lacks its PNG
reference and nine required story/accessibility/layout/offline/coverage suites
are absent. Its artifacts are in
`.vscode-test/desktop-artifacts/run-0dc8f6b4-44b0-4d4b-ab04-01cab7ce9a3d/`.
`pnpm test:visual` exits nonzero before execution because `visual.spec.ts` and
`layout.spec.ts` are missing. Rebuilt and repackaged stable installed-VSIX checks
pass after the correlation correction. None of these diagnostics closes the
blocking foundation checkpoint or authorizes a feature acceptance claim.
