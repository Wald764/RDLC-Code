# Baseline Analysis: Native Sidebar Integration

**Inspected**: 2026-10-24 · **Candidate**: `fcdacba` on `main` · **Initial working tree**: clean (`git status --short` returned no entries).

This is a bounded source/document/API inspection, not runtime acceptance. Only specification artifacts and `.specify/feature.json` are changed in this phase. The constitution is version 1.2.0, including principle VII (automated verification first). `.specify/extensions.yml` contains `hooks: {}`; no branch hook is configured. Sequential numbering resolves the next feature to 005; the active template was resolved through `.specify/scripts/powershell/resolve-template.ps1` and copied before drafting.

## Evidence and Actual Reuse

The specs, plans and tasks of [001](../001-rdlc-vscode-editor/), [002](../002-interactive-visual-designer/), [003](../003-designer-ux-ui-overhaul/) and [004](../004-drag-drop-creation/) were examined alongside their relevant implementation paths below. The README was not used as the capability authority.

| Baseline | Source evidence | Reuse and bounded delta |
| --- | --- | --- |
| 001 native lifecycle and safe XML | `apps/vscode-extension/src/extension.ts`, `editor-provider.ts`, `document-session.ts`, `edit-controller.ts`, `verify-candidate.ts`; `packages/xml-parser/src/project-report.ts`, `packages/report-model/src/editing.ts`; `packages/xml-serializer/src/{authoring,datasets,tables,patches}.ts` | Keep the custom text editor, typed intents, validation/planning/candidate verification and native apply/history. Native actions must enter this pipeline, not write XML separately. |
| 001 local data and table authoring | `packages/report-model/src/editing.ts` contains dataset/field operations, column/row edits, groups/totals and page settings; `apps/designer/src/app/datasets/datasets.component.ts`, `tables/{table-properties,groups-totals}.component.ts` | Route native Edit actions into the selected existing inspector; retain seven field types, guarded references and supported table profile. No new data editor is needed. |
| 002 selection/geometry/clipboard | `apps/designer/src/app/editor/{selection,manipulation,placement,viewport}.ts`, `packages/report-model/src/{scene,geometry,clipboard}.ts`, host `clipboard.ts` | Reuse body-set/primary versus exclusive cell selection, unit/viewport calculations, snapping and clipboard protections. Cross-version correspondence uses explicit mappings or unique structural identity, never scene ordinal. |
| 003 accepted hierarchy | `packages/renderer/src/structure.ts`, `packages/report-model/src/protocol.ts`, `apps/designer/src/app/editor/structure-tree.component.ts` | Reuse the bounded read-only projection. Current kinds cover report/sections/body/header/footer/textbox/table/row/cell/dataset/field/container/preserved. Native tree adapters are new; extend the shared projection only for proven missing navigation coverage. |
| 003 workspace/inspector | `apps/designer/src/app/editor/editor.component.ts`, `contextual-inspector.component.ts`, `host-adapter.ts`, `viewport.ts` | Keep accepted-state ownership, draft settlement, contextual forms, keyboard isolation, layout cancellation and view preferences. Hide redundant expanded navigation by default; retain compact fallback rather than remove working 004 drag insertion. |
| 004 creation | Catalog `CreationKind = textbox | table | dataset`; `EditorComponent.create`, `defaultSpot`, `creationSpot`; `authoringFields` and host `createdIn`/`editResult.created` | Reuse no-form activation, visible-body inset, grid offsets, default sizes, host name allocation and accepted-result selection. Existing cards carry `application/x-rdlc-<kind>` in an HTML drag transfer; this proves in-webview drag only. |
| 004 table and naming changes | `authoringFields` includes `renameTable`, `setTableDataset`; serializer `tables.ts`; `packages/validation/src/validate.ts`/clipboard name allocation | Table is now created unbound with two 1in columns and two 0.25in rows; binding happens afterwards. Textbox is 1in × 0.25in. Do not restore 003's obsolete dataset/first-field creation prerequisite. |
| 004 post-delivery fixes | `specs/004-drag-drop-creation/tasks.md` T036–T043; current selection/menu/adapter/session code | Preserve quiet drafts until conflicting action, readable refusals, source-aware deletion safeguards, data/structural no-reveal behavior, unique unnamed expansion mapping, menu positioning and LF/CRLF insertion normalization. |

### Existing Integration Gaps

1. `extension.ts` registers only the custom editor and New/Open Designer/Open Source commands. The extension manifest has no `viewsContainers`, `views`, native tree menus or native sidebar providers.
2. The icon really exists at `apps/vscode-extension/media/rdlc-activity.svg`. Its contribution path is **`media/rdlc-activity.svg` relative to the extension package**, not repository root. It is a 24 × 24 monochrome SVG using `#C5C5C5`; actual host tint/contrast must be established by visual tests, not inferred from raw SVG colors. Verify the asset survives packaging.
3. `RdlcEditorProvider.resolveCustomTextEditor` creates one `DocumentSession` per panel. Sessions of the same `TextDocument` share a static mutation queue, but there is no public active-panel registry or accepted-state/selection feed for native views. Reuse the session's evaluations; introduce only the document/view coordination needed by sidebar actions. Do not claim there is already a singleton session per document.
4. `HostAdapter` currently accepts snapshots/results and posts edit/clipboard/history/source requests. The shared protocol has **no selection-change or native-action-to-designer message**. Native synchronization needs a bounded, closed, document/view/version-bound contract and matched validators/consumers. Do not reinterpret existing generic message transport as that contract already existing.
5. Current structure traversal skips unknown non-wrapper local elements and treats opaque/foreign subtrees as leaves. It does not traverse `TablixRowHierarchy`/`TablixColumnHierarchy`/members/Group, nor root `ReportParameters`, `EmbeddedImages` or `DataSources`. Thus existing group editing does not establish native group-tree coverage; `ReportProjection.tables[].groups` can supply understood group details, but real ancestry comes from syntax. Parameter/image/source read-only navigation requires a bounded projection extension, not authoring-engine expansion.
6. Dataset/field authoring metadata in snapshots is available only when the report has a projected section/page; read-only data navigation for unsupported/source-only profiles must use safe parsed syntax, not assume `authoring` is always present.
7. The existing `selectTree` routes through pending/draft guards, delegates to `selectStructure`, and reveals only body/cell targets. Existing `revealSelection` uses `revealScroll`; 005 explicitly requires centering subject to reachable bounds. Extend/reuse viewport navigation as needed instead of assuming current reveal proves centering.
8. Cross-version selection requires named unique ancestry; expansion can also map unique unnamed report/section/body nodes. Native `TreeItem.id` stability must be a UI identity over this safe correspondence, separate from command IDs/ranges tied to the accepted version. No new persistent report IDs should be inserted.

## Official API Feasibility

Sources consulted on 2026-10-24:

- [VS Code Tree View guide](https://code.visualstudio.com/api/extension-guides/tree-view): Activity Bar containers, views, activation, data providers, refresh, menus, welcome content and `createTreeView`.
- [VS Code Webview guide](https://code.visualstudio.com/api/extension-guides/webview): panel state/disposal, postMessage isolation, themes and security.
- [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api): corresponding local declarations inspected in `node_modules/@types/vscode/index.d.ts` (installed types 1.110.0).
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron): executable-path launch, real window input/screenshots and documented experimental status/launch limitations.

| Need | Official mechanism and feasibility | Limitation / required proof |
| --- | --- | --- |
| Activity Bar and three native views | `contributes.viewsContainers.activitybar`, `contributes.views`, `window.createTreeView` with `TreeDataProvider`; feasible without a sidebar webview | Views activate via contributed view events in supported VS Code versions. Test activation in a fresh profile before any custom editor opens. Honor host-owned placement/visibility. |
| Native actions/states | `contributes.commands`, `view/title`, `view/item/context`, `TreeItem.contextValue`, command enablement/context keys, `viewsWelcome`, view messages | Menu visibility is not authorization. Recheck current capabilities and bound target in handlers. Native tree rows have no general disabled-row API; unavailable entries can expose inspection/reason but never a mutation command. |
| Refresh/selection/reveal | Provider `onDidChangeTreeData`, `getParent`, `TreeView.onDidChangeSelection`, `onDidExpandElement`, `onDidCollapseElement`, `TreeView.reveal` | Native `selection` is readonly; reveal is not an arbitrary ordered multi-selection setter. Maintain authoritative membership/primary through the existing selection owner and supported per-row selection cues if native multi-highlight cannot represent it. Automated multi-selection proof is mandatory; do not pretend the API has a setter. |
| Active custom/text editor | `WebviewPanel.onDidChangeViewState`, `window.tabGroups`/tab events and active text-editor/document events | `onDidChangeActiveTextEditor` alone misses custom editor panels. Side Bar focus is distinct from report/view identity. Track actual panel instances and dispose listeners; use existing tab URI/type verification patterns. |
| Host ↔ Angular actions | `Webview.postMessage` / `onDidReceiveMessage` and existing HostAdapter validation | Delivery and focus are asynchronous; accept/reject navigation through the draft guard, correlate outcome and prevent echo. Production transport stays isolated and uses no private workbench APIs. |
| Compact filter | Native tree find where adequate, or a title Filter action using native input/Quick Pick and a clear-filter action | A `TreeDataProvider` has no inline search-box widget. Do not add a sidebar webview just to reproduce the Angular search field. Test case-insensitive filtered content and zero-results recovery. |
| Native tree → Angular drag | `TreeDragAndDropController` permits native tree drag transfers; existing webview handles HTML drag events | **Not established** as a supported arbitrary custom-MIME bridge to a custom-editor webview. Local declarations at lines 12011–12114 limit transfer availability and document `text/uri-list` for editor drops; they do not guarantee the desired HTML drop path. A real supported-version Desktop probe is required. No use of `text/uri-list` to smuggle executable commands, private internals or fake files. |
| Real Desktop E2E/visuals | Reuse downloaded VS Code executable/profile provisioning; evaluate pinned Playwright Electron driver with the real workbench and Angular webview | Electron automation is experimental; target launch fuses or webview isolation may prevent direct use. A bootstrap must prove actual launch, native-tree input, webview traversal and screenshots on target binaries before depending on it. If incompatible, use a maintained Desktop driver supporting that binary, record the dependency rationale and keep affected criteria blocked until proof. This is test-only tooling, not runtime API usage. |

The activity/tree/menu requirements are supported by stable public APIs. Cross-surface drag and exact multi-highlight are constrained independently; neither limitation authorizes losing insertion or multi-selection behavior. The default product path is native activation plus the existing in-designer drag fallback. API feasibility is not a runtime pass.

## Current Automated Infrastructure and Gaps

- Root scripts in `package.json`: format/lint/typecheck, Node/Angular unit tests, roundtrip, compatibility, acceptance/performance-record checks, release checks, build/package, `test:vscode` and `test:package`.
- `tests/vscode/run-tests.ts` uses `@vscode/test-electron` 3.1.0, `VSCODE_VERSION` defaulting to `stable`, disposable profiles and a separate installed-VSIX harness. It launches with `--disable-workspace-trust`, so it cannot establish restricted-workspace behavior by itself.
- Native lifecycle/synchronization tests exercise real host documents and `DocumentSession` behavior. They are valuable integration coverage, but direct session messages do not prove clicking native rows or real Angular selection.
- Angular unit/component tests use Vitest/TestBed/jsdom. They do not establish real Desktop layout, painted focus/selection, pixel contrast, cross-surface drag or screenshot equality.
- `tests/package/offline.test.ts` verifies CSP, packaged content channels and unsafe entity parsing statically. That is not the same as observing runtime network attempts during every journey.
- No root Desktop UI E2E or visual comparison command/driver is currently present. Lockfile references to optional Vitest browser providers do not mean a Playwright driver is installed/configured.
- `.github/workflows/ci.yml` runs quality checks plus minimum `1.142.0`/`stable` Desktop integration/package tests on Ubuntu 24.04, Windows 2022 and macOS 14; Ubuntu uses Xvfb. The required aggregate depends on both jobs. Release automation reuses quality gates; new mandatory test jobs must join that dependency chain rather than bypass it.
- Existing task/evidence status is heterogeneous: 003 T055 remains unchecked; 002 T082 latency collection was removed by an owner decision; 004 tasks include historical manual journeys/studies. This does not negate implemented code, but none supplies 005's required automated evidence. No inherited manual sign-off becomes a new mandatory gate.

## Format References and Compatibility Boundary

Navigation extends read-only coverage; editing remains 2016/01 single-section and existing capability profiles. Selected new format sections were read, not the vendor corpus:

- MS-RDL §2.307 [ReportParameters](../../vendor/02-structures/2.307-reportparameters.md): actual ordered parameter declarations under Report.
- MS-RDL §2.306 [EmbeddedImage](../../vendor/02-structures/2.306-embeddedimage.md): real embedded definition, Name/MIMEType/ImageData; inventory does not require decoding ImageData.
- MS-RDL §2.321 [DataSources](../../vendor/02-structures/2.321-datasources.md): actual ordered source definitions under Report.
- MS-RDL §2.34.5 [TablixMember.Group](../../vendor/02-structures/2.34.5-tablixmember.group.md): Group belongs to a hierarchy member; do not fabricate a relationship under a body row.

Inherited compatibility citations remain in [001 spec](../001-rdlc-vscode-editor/spec.md#compatibility-and-scope), [002 spec](../002-interactive-visual-designer/spec.md#compatibility-and-scope) and [004 spec](../004-drag-drop-creation/spec.md#compatibility-scope), including §2.3 Report, §2.11 ReportItems, §2.23 Tablix, §2.81 Group, §2.325 DataSet, §2.328 Field, §2.16.1 naming and §2.23.10 optional/required table dataset binding. Read the specific original excerpt if an extracted rule becomes ambiguous before making a new conformance claim. No RDLC runtime fidelity or schema expansion is implied.

## Change Reach for Subsequent Planning

| Area | Required consumers / compatibility checks |
| --- | --- |
| Contributions/assets | Extension manifest, activation/disposal, icon packaging and package-content tests; keep existing public file/editor commands compatible. |
| Shared projections/contracts | Report-model types/strict validators, renderer projection/exports, host snapshot production, Angular adapter and fixtures/builders. Add only missing bounded navigation metadata and closed action/selection correlation. |
| Context/session routing | Provider panel registry, document/session accepted state, native providers/commands, shared queue and source actions; verify close/split/source/active-tab races and actual execution target. |
| Angular consumers | Existing selection, tree/catalog, inspector, draft and viewport/creation owners; coordinate native actions without replacing gesture or authoring engines. |
| Data/source access | Parsed actual definitions and safe current ranges; existing dataset/field/table/group operations and guards; no new image/parameter/source mutation. |
| Tests/fixtures/config | Unit/protocol/controller/Angular tests; native host lifecycle; manifest-cited fixtures; roundtrip/compatibility; package/offline tests; new Desktop/visual driver, pinned display settings and baselines; root scripts, lockfile only for justified dev tooling, GitHub Actions required gate/release reuse. |

## Principal Risks and Required Mitigation

| Risk | Required mitigation and automated evidence |
| --- | --- |
| Wrong report after sidebar focus/await | Capture document/view/version, revalidate after waits; A/B same-name fixtures and closure/split races (AT-06). |
| Tree highlight bypasses draft guard | Acknowledge actual accepted selection, restore previous highlight on cancel, no echo; dirty inspector/Desktop cases (AT-03/07). |
| Stable UI IDs grant stale authority | Separate expansion identity from version-local target/range; rename/delete/duplicate/ambiguous ancestry tests (AT-02/06). |
| Incomplete data/group inventory called complete | Extend shared read-only navigation and test exact source ancestry, foreign/opaque nodes and limits with explicit truncation (AT-02/04). |
| Native panel movement rebases canvas mid-gesture | Cancel on unavoidable resize before coordinate rebase; defer elective changes; real bounding-box/frame sampling (AT-08). |
| Test driver silently substitutes mocked application | Bootstrap real binary + packaged extension + workbench/webview input; assertions inspect independent XML and actual rendered selection (AT-01/07/08). |
| Mutable stable runtime creates visual drift | Separate compatibility matrix from pinned reference screenshots; record binary/build/fonts/DPR/profile/settings; fail on comparison mismatch, no auto-accept (AT-08). |
| Security passes inferred from static scans | Runtime offline/trust tests with outbound-attempt observation and malicious fixtures, retaining static package checks (AT-09). |

All runtime capabilities of 005 remain **unimplemented/unvalidated** at this specification stage. No test result is inferred from this analysis.
