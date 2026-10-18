# Designer UX/UI Overhaul: Baseline Analysis and UX Decisions

**Date**: 2026-10-18
**Purpose**: Record the inspected Angular interface, reusable behavior, UX problems, visual-reference findings and decisions to validate before implementation. This is a source-based review, not a live usability evaluation or an implementation plan.

## Evidence and Method

Targeted discovery covered the editor shell/templates/styles, property and authoring components, host adapter, scene contract, extension command registration, relevant test locations and specifications 001/002. No exhaustive repository or vendor-corpus ingestion was performed.

- [Constitution](../../.specify/memory/constitution.md): native lifecycle, lossless source-authoritative edits, explicit compatibility, inert reports, offline use and bounded context.
- [001 specification](../001-rdlc-vscode-editor/spec.md): textbox/table/local-data authoring and native lifecycle baseline.
- [002 specification](../002-interactive-visual-designer/spec.md): existing interaction semantics and required preservation/precision coverage. Its older baseline analysis describes the pre-002 state; current source is the evidence for the interface being redesigned.
- [001 compatibility contract](../001-rdlc-vscode-editor/contracts/compatibility.md) and [002 targeted MS-RDL evidence](../002-interactive-visual-designer/baseline-analysis.md#targeted-ms-rdl-evidence) supply inherited version, construct, size, coordinate and preservation references. Feature 003 introduces no new report-format conformance claim and requires no vendor changes.

## Existing Interface and UX Problems

| Evidence | Observed behavior | User impact and specification response |
| --- | --- | --- |
| `apps/designer/src/app/app.component.ts` | Root renders the existing editor directly. | Refine this editor progressively; do not create a competing application. |
| `editor/editor.component.html`, `editor.component.scss` | One grid flow contains feedback, draft controls, authoring status, selection/arrangement buttons, wrapping view controls, viewport, flat item list, geometry/limitations, property forms, authoring forms and diagnostics. The viewport has a 70vh maximum height. | Commands and form volume compete with the canvas; introduce five stable zones and independent scrolling. |
| `editor.component.html` feedback and draft blocks | A fixed 5rem feedback area already limits message reflow, but status, conditional draft content and surrounding controls remain in the vertical flow. | Reuse the intent of reserved feedback space; prevent every diagnostic/draft/selection change from changing canvas layout. This is an expansion of an existing safeguard. |
| `editor.component.html` view controls | Zoom, multiple fit commands, spacing, two units selectors, four toggles and permanent shortcut text share a wrapping control area. | Keep core actions visible and move uncommon placement options/help into compact accessible surfaces. Preserve independent grid and guide controls. |
| `editor.component.html` item list | Flat item buttons plus individual membership checkboxes expose selection and primary state. | Preserve keyboard/multi-selection behavior while introducing meaningful hierarchy and access to obscured items. |
| `properties/textbox-properties.component.{ts,html}` | Fourteen text/select controls cover identity, text, four geometry values and six style properties; capabilities disable unsupported fields. | Reuse property vocabulary and capability checks; group relevant fields, add suitable presentations and show actual target type. No new border/visibility/pagination semantics are implied. |
| `authoring/authoring.component.html` | Textbox creation/deletion, page/body property forms, datasets and all table forms are stacked. Introductory text still tells users to reselect after edits. | Move creation to cards/compact flows, page settings to explicit setup, and target-specific editing to the inspector; remove stale instructional wording during implementation. |
| `tables/table-properties.component.html` | Repeated per-dataset creation and per-table structural forms, zero-based row/column inputs, fixed initial position values, groups/totals integration. | Contextualize the selected table and show accepted values; prefer understandable row/column descriptions while mapping to the same existing operation targets. Retain all structural guards. |
| `datasets/datasets.component.html` | Real dataset creation/rename/delete and field creation/rename/type/delete; no data fetching. | Reuse as contextual definition workflows, not a fake live-data explorer or canvas component. |
| `editor/editor.component.scss`, `apps/designer/src/styles.scss` | Some focus colors use host variables, but page/body/grid, selection, guide, placeholder and error colors are largely fixed. Global typeface is system-ui. | Establish theme-driven surfaces and consistent typography; distinguish paper color from UI chrome and respect high-contrast overrides. |
| Relevant templates | Native labels/status roles and focus styles exist; no dedicated catalog, tree, rulers, panel separators or contextual menu appear in the inspected editor template. | These are presentation gaps, not missing document engines; keyboard and screen-reader paths must accompany the new controls. |

Paths abbreviated in the table are relative to `apps/designer/src/app/` unless explicitly qualified. These findings are based on source behavior; pixel-level runtime appearance and measured user difficulty remain to be validated.

## Reusable Components and Mechanisms

| Existing asset | Reuse boundary |
| --- | --- |
| `editor/editor.component.ts` | Existing selection, draft conflict handling, scene projection, gesture lifecycle, clipboard/arrangement and viewport command routing. Relocation must retain logical targets and pending-state guards. |
| `editor/selection.ts` | Membership, primary selection, hit testing and safe selection reconciliation. Tree selection must share these semantics. |
| `editor/manipulation.ts`, `placement.ts`, `viewport.ts` | Direct proposals, snapping, coordinate conversion, zoom anchoring, fit/reveal, extent and edge scrolling. Rulers and panel offsets must not fork coordinate math. |
| `editor/host-adapter.ts` | Single transport, accepted snapshots, version checks, pending result reconciliation, source access and restored view state. View preferences currently exist; layout preferences must extend that boundary without becoming document edits. |
| `properties/textbox-properties.component.ts` | Existing property definitions, current-value access, capability gating and commit/cancel semantics. New widgets must preserve expression/opaque values and initialization no-ops. |
| `authoring/`, `datasets/`, `tables/` and `diagnostics/` components | Existing authoring requests, field types, structural actions, groups/totals and diagnostic/source behavior. Presentation can be decomposed without dropping controls or bypassing safety. |
| `packages/report-model/src/scene.ts` | Table/cell identity, parent-table links, source order, z-index, bounds, authored strings, capabilities and reasons. Useful existing selection data, but not a complete general-purpose hierarchy. |
| `apps/vscode-extension/src/extension.ts`, `commands/new-report.ts`, `document-session.ts` | Existing New Report and Open Source commands and native document session. Toolbar Undo/Redo must connect to native services; the inspected client protocol currently lists ready/edit/openSource/clipboard, not native-history requests. Bounded host integration may be needed in planning; no local history. |
| Parser, serializer, validation and expression packages | Retain their current responsibilities, preservation proof and supported scope. Tree metadata may require a bounded read-only projection; this is not authorization to rewrite the parser or evaluate content. |

## Visual Reference Analysis

The user-owned reference `docs/design/rdlc-code-ui-reference.png` exists and was inspected. It is an untracked input at task start and must remain untouched.

- The upper composition has compact grouped toolbar actions, component icon cards, an adjacent hierarchy, a dominant page workspace with rulers, a contextual inspector and a quiet bottom strip.
- The lower examples reinforce dark-theme adaptation, an item context menu and collapsible property groups.
- Retain the visual hierarchy, regular spacing, subtle boundaries, contextual controls and strong separation between workspace and page.
- Adapt its simultaneous Components/Structure columns into two tabs by default to avoid consuming most of the editor width. Retain hierarchy and report-item type icons without duplicating host activity bars, application chrome or file tabs.
- The sample invoice, logo/image selection, image properties, header/footer arrangement, parameters, matrix/chart cards, grouping command and border/background controls illustrate broader possibilities. They do not expand the implemented authoring profile. Existing content can be represented honestly as preserved where unsupported.
- Preview remains explicitly unavailable. No sample invoice values, image rendering, runtime pagination or evaluated expressions may masquerade as new functionality.
- The mockup's light and dark images are direction, not a custom theme or a source of reusable proprietary assets. Use original/permissively licensed icons and official host theme/font tokens.

## Change Reach and Regression Boundaries

Planning must account for the following connected surfaces; this section identifies scope, not an ordered implementation task list.

1. **Shell, templates and styling**: existing editor, global styles and authoring/property components; five-zone sizing, overflow, rulers, panels and feedback behavior.
2. **Callers and selection**: canvas actions, property commits, authoring request emitters, table/cell/data targets, source actions, keyboard focus and draft-conflict paths. A selected dataset must not be sent as a body-item geometry target.
3. **Read-only hierarchy/capability data**: accepted scene and authoring metadata plus bounded preserved hierarchy where safely available; no client XML reparsing, guessed object identities or new editability based on a tree icon.
4. **Native integration and view state**: existing adapter/protocol/session boundary for real host commands and validated per-view layout persistence. No new global service, network requirement or secondary undo stack.
5. **Tests and fixtures**: reuse `apps/designer/src/app/editor/{editor.component,lifecycle,viewport,selection,placement,manipulation}.spec.ts`, existing authoring tests, `tests/vscode/{new-report,existing-report,lifecycle,synchronization,persistence,clipboard}.test.ts`, `tests/roundtrip/` and `tests/compatibility/`. Extend meaningful UI interaction, selection, contrast/accessibility and stability coverage in planning. Keep fixture provenance and inherited format references.
6. **Configuration/exports**: no dependency, public export or setting change is required at specification time. Implementation planning must justify any icon dependency, contributed command or persistent-setting change; no heavy UI framework by default.

Main regression risks are gesture-origin drift after new chrome, broken focus/shortcut routing, stale identity targeting, accidentally applying drafts during panel transitions, dropping rarely used table/data commands, and visually suggesting unsupported mutations. Exact-source and native-lifecycle acceptance remain gates even though the intended changes are primarily presentational.

## UX Decisions for Validation

These are explicit proposed defaults, not unresolved requirements. Validate with a compact prototype/review and the specification's measured journeys before implementation details are finalized. Changing a default that affects acceptance requires updating the specification.

| Decision | Proposed default | Validation question and evidence |
| --- | --- | --- |
| Left information architecture | Components/Structure tabs in one 220px panel; Components first on a blank report. | Can four of five authors find insertion and obscured-item selection within the specified discovery times? |
| Narrow workspace | Left overlay below 1100px; both overlays below 800px; at most one overlay open. | Do the four viewport cases preserve reachable controls and the canvas minimum without whole-workspace scrolling? |
| Panel dimensions and density | Left 220px, right 300px; bounded resizing; compact single-row toolbar. | Do long names/expressions remain accessible, separators work by keyboard, and the default canvas retain the required majority? |
| Insertion | Click or keyboard activation opens a compact named creation flow; no new drag-to-create. | Can authors create a valid textbox without extra navigation and complete the timed journey? |
| Data/table prerequisites | Dataset card edits local declarations; Table offers prerequisite creation if needed. | Is the difference between dataset definition and runtime data clear in the five-author review? |
| Native file commands | Existing host entry points by default; native history in toolbar; no duplicate file toolbar. | Can users find creation/save and do Undo/Redo while designer controls have focus? |
| Inspector grouping and commit behavior | Common sections prominent, rare ones collapsed, unavailable categories absent; retain explicit draft protection. | Can authors change geometry/appearance quickly without accidental commits or losing drafts? |
| Catalog and Preview honesty | Unsupported cards remain labeled unavailable; Preview is disabled with a reason. | Do reviewers correctly identify every unavailable capability, without confusing the mockup with shipped functionality? |
| Theme and paper treatment | Neutral workspace, theme-compatible page and UI, strong selection/contrast; stored report colors unchanged. | Do all three theme checks pass and can reviewers distinguish page, body, selected items and placeholders? |
| Feedback | Quiet status summary, contextual field errors and overlay/reserved diagnostics. | Do feedback arrivals produce zero material gesture-origin drift and remain understandable with a screen reader? |

## Inherited Architecture Constraints

Retain Angular, TypeScript and SCSS, the current module boundaries and the native VS Code TextDocument as source of truth. Reuse the existing parser, serializer, renderer, validator, expression handling and document pipeline. Preserve atomic XML changes, native Undo/Redo/save, offline operation and original/permissively licensed resources. Use official VS Code CSS variables wherever suitable; a heavy UI framework requires concrete justification. No application code, dependencies or engine contracts are changed by this specification work.
