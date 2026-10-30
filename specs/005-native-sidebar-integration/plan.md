# Implementation Plan: Native VS Code Sidebar Integration

**Feature**: `005-native-sidebar-integration` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Branch**: Setup resolves `005-native-sidebar-integration` from the feature directory; actual Git checkout remains `main`. No branch hook is configured and planning creates no branch.

**Input**: `specs/005-native-sidebar-integration/spec.md`, [baseline-analysis.md](baseline-analysis.md) and [automated-validation.md](automated-validation.md).

## Summary

Provide one native RDLC Code Activity Bar container with Report Structure, Report Data and Components. Use native TreeViews over bounded accepted syntax projections, a window-scoped document/view router and a closed guarded bridge into the existing Angular designer. Preserve TextDocument authority, panel-local selection/drafts/viewport, the shared mutation queue, atomic bounded edits and existing 001–004 authoring. Extend read-only hierarchy/data coverage only where current navigation is incomplete. Default duplicate Angular navigation to compact/closed while preserving explicit fallback and existing drag insertion.

Require real Desktop functional, accessibility, visual, lifecycle, preservation and monitored offline evidence through root commands and GitHub Actions. Native dragging is unavailable until official-API probe plus full drop-contract proof; activation remains complete. This workflow ends at Phase 1 design, with runtime capabilities explicitly unimplemented/unvalidated.

## Technical Context

### Approved implementation-order adjustment — 2026-10-25

The user explicitly authorizes continuing US1–US6 implementation while the
platform security and reference-environment gates T010–T012 remain open. Shared
source contracts and routing prerequisites still apply. Implement and check each
story in specification order, retaining its pending acceptance evidence instead
of treating an external validation blocker as a ban on subsequent source work.
This changes execution order only: no security, preservation, accessibility,
visual, cross-platform, same-candidate or release requirement is waived. Do not
declare a story or the feature validated while its mandatory checks are missing,
failed or unrun. Earlier execution notes describe their historical checkpoints.

**Language/Version**: TypeScript 6.0.3; Node `>=24.15.0 <25` (`.node-version` 24.22.0); pnpm 11.28.2; Angular 22.2.3.

**Primary Dependencies**: Existing VS Code public APIs/types 1.110.0, Angular/RxJS 7.8.2 and workspace report-model/parser/validation/serializer/renderer. No new runtime dependency. Exact test-only `playwright@1.64.1` is the selected Electron-driver candidate, subject to mandatory capability bootstrap; retain `@vscode/test-electron@3.1.0` provisioning and host integration. Check required declarations against minimum runtime without broadening compatibility claims.

**Storage**: Authoritative VS Code TextDocument/XML only. Existing webview state for disposable per-view preferences; native host owns view placement/visibility. No new persistent report model or save path.

**Testing**: Existing Node tests, Vitest 5.0.5/jsdom Angular components, fixture roundtrip/compatibility, real extension-host and installed-VSIX tests. Add real Desktop E2E and fixed-reference pixel/semantic/geometry/contrast assertions; no browser stub or direct session call substitutes for UI evidence. See [Desktop validation contract](contracts/desktop-validation.md).

**Target Platform**: Local VS Code Desktop minimum 1.142.0 and resolved stable on Windows/macOS/Linux; functional matrix Ubuntu 24.04, Windows 2022, macOS 15. Fixed Ubuntu reference build/display for visuals. No web/remote/cross-window support added.

**Project Type**: pnpm TypeScript monorepo; VS Code custom text editor extension plus bundled Angular webview and shared libraries.

**Performance Goals**: 100 selection alternations with ≥95 visibly correct within 200ms; 100 view/document switches and 50 stale/race cases with zero wrong-target actions; ≤1 screen-pixel unintended origin drift across 100 interactions; placement ≤0.01pt; known-target center ≤1 CSS px at unchanged zoom. Reference reports ≤1 MiB/100 selectable body items; separate boundary fixtures stress budgets.

**Constraints**: Offline after installation; untrusted XML is inert; no query/expression/resource execution. Editable profile remains RDL 2016/01, one section and inherited 001–004 property capabilities. Read-only inspection is not authoring or runtime conformance. Exact text outside authorized edit footprints; one accepted mutation per native Undo step. Shared navigation cap 2,000 authored entries, 32 emitted levels per projection, existing parser and whole-message budgets retained. Missing mandatory evidence blocks feature validation.

**Scale/Scope**: Three native views, eleven component kinds/three creatable, seven inherited field types, ≥12 preservation fixtures, 20 exact mixed Undo/Redo states. Actual hierarchy/group/data inventory and safe source navigation; no new report authoring semantics, rendering or release publication.

## Constitution Check

*Initial gates evaluated from constitution 1.2.0 before selecting the design; rechecked against Phase 1 artifacts below. PASS means the design satisfies the gate, not that runtime acceptance passed.*

| Principle / gate | Initial | Post-design rationale |
| --- | --- | --- |
| I — Open-source/native lifecycle | PASS | Public TreeView/custom-editor APIs; existing native save/history retained. Project MIT; selected test-only Playwright Apache-2.0 is compatible and must retain notices if distributed. |
| II — Specification-driven compatibility | PASS | Explicit 2016/01 authoring boundary; actual read-only syntax relationships cite targeted MS-RDL sections in research/baseline. No inferred RDLC execution fidelity or schema conversion. |
| III — Lossless predictable editing | PASS | TextDocument authority, same queue/intents/candidate verification/bounded patches; stale target refusal, current source-range validation and exact Undo/outside-footprint assertions. |
| IV — Verifiable boundaries/minimal dependencies | PASS | Pure projections/validation remain separate from host/presentation; reuse existing forms, creation and serializers. One justified test-only driver candidate, no new runtime service or mutation engine. |
| V — Bounded agent context | PASS | Targeted file/symbol discovery and bounded reads; three focused research agents cover routing, projection/budgets and Desktop infrastructure. Vendor is read-only and only cited relevant sections are inspected. |
| VI — Automated releases | PASS | Preserve frozen lockfile/SemVer/tag/version/same-VSIX rules; add required E2E/visual checks to reusable CI and applicable installed checks to the canonical rebuilt VSIX before publication. |
| VII — Automated verification first | PASS | Existing AT-01–09 maps all scenarios/FR/edges/SC before implementation; root/CI real Desktop, visual, accessibility and monitored offline assertions required. Failed probes/missing baselines cannot pass delivery. |
| Trust/security/CI constraints | PASS | Inert allowlisted metadata, no payload/secrets/resource access, strict bounded protocol, separate trust profiles and host/webview attempt observation; GitHub Actions minimum permissions. |

**Post-design result**: PASS; no constitutional exception. All design choices are resolved. Driver capability, native drag, icon appearance and runtime test outcomes remain explicit implementation evidence gates rather than presumed successes. Any unresolved mandatory probe blocks validated delivery.

## Project Structure

### Documentation (this feature)

```text
specs/005-native-sidebar-integration/
├── spec.md                       # Existing requirements
├── baseline-analysis.md          # Existing source/API evidence
├── automated-validation.md       # Existing complete acceptance matrix
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── native-workspace.md
    ├── sidebar-bridge.md
    └── desktop-validation.md
```

### Source code (existing owners and planned additions)

```text
apps/vscode-extension/
├── package.json                  # Views/container/commands/menus/welcome
├── media/rdlc-activity.svg        # Existing supplied icon
└── src/
    ├── extension.ts              # Registry/provider lifetime
    ├── editor-provider.ts        # Register actual panel/session identity
    ├── document-session.ts       # Accepted evaluation, publication, queue
    ├── protocol.ts               # Host binding and authorization
    ├── commands/open-source.ts   # Shared context/range routing
    └── sidebar/                  # New context registry, tree adapters/actions
apps/designer/src/app/editor/     # Adapter, selection, inspector, viewport,
                                 # creation/catalog and compact fallback owners
packages/report-model/src/       # Closed protocol and navigation types
packages/renderer/src/           # structure.ts; new data navigation projector
packages/validation/src/         # Existing capability/reference guards reused
packages/xml-parser/src/         # Existing syntax/dataset/table facts reused
packages/xml-serializer/src/     # Existing bounded mutation pipeline reused
tests/
├── fixtures/                    # Representative/boundary/malicious reports
├── compatibility/               # Coverage/profile/manifest expectations
├── roundtrip/                   # Exact preservation/history oracles
├── vscode/                      # Real host lifecycle/race/provisioning
├── package/                     # Icon/resources/offline/VSIX checks
├── release/                     # Required job/canonical artifact contracts
└── desktop/                     # New real input/probes/visuals/evidence
scripts/                         # Existing build/package verification owners
.github/workflows/               # Existing CI/release required call graph
```

**Structure Decision**: Keep all production work in current package boundaries. New `sidebar/` owns native adapters/routing only; `tests/desktop/` owns real Desktop tooling and reference artifacts. Read-only data navigation belongs beside current renderer structure projection, not new parameter/image/source authoring models. Preserve existing package wildcard exports; update explicit renderer index and every strict protocol consumer/builder together.

## Phase 0 — Research Results

Completed [research.md](research.md): native API constraints/filtering, routing and source-only evaluation, guarded result correlation, safe hierarchy/data projection and shared allocation, creation/centering/fallback, conditional drag and test-only Desktop/CI architecture. Evidence combines targeted source inspection, focused agents, official API documentation and published dependency metadata.

Research does not execute probes or certify inherited behavior. There are no unresolved requirement clarifications. First implementation slice must prove driver launch/input/webview/accessibility/capture and trustworthy network observation before relying on that infrastructure.

## Phase 1 — Design and Contracts

- [data-model.md](data-model.md): document/view identity, actual navigation versus synthetic rows, exclusive selection, bounded action lifecycle and evidence.
- [native-workspace.md](contracts/native-workspace.md): view/command/catalog/filter/selection/focus/fallback contracts.
- [sidebar-bridge.md](contracts/sidebar-bridge.md): closed message families, captured authority, async rechecks, draft handling and mutation correlation.
- [desktop-validation.md](contracts/desktop-validation.md): mandatory probes, proposed root commands, reference environment and exact-candidate evidence.
- [quickstart.md](quickstart.md): existing prerequisite commands and future runnable end-to-end validation scenarios, explicitly marked by availability.

### Change reach and compatibility obligations

| Owner | Required reach |
| --- | --- |
| Manifest/activation/assets | Contributions, activation before designer, disposal, commands/menus/welcome, supplied icon packaging and exact reviewed VSIX inventory. |
| Session/context/source | Panel registry, shared accepted evaluation for source focus, action captures and source post-await recheck; preserve queue and existing public commands. |
| Shared projections/protocol | New actual hierarchy kinds and Data inventory, command-specific capability facts, fair total budget/visible truncation, strict validators/builders, renderer index exports and snapshot fallback. |
| Angular consumers | HostAdapter messages/correlation, accepted selection and mappings, dataset creation after Data split, contextual inspector, fallback structure/data navigation, canonical catalog, centering and gesture-safe layout. |
| Tests/fixtures | Update compatibility tests currently expecting datasets in Structure; projection/protocol/selection/controller tests, source-only profiles, limits, secrets, race and preservation fixtures; real Desktop and installed VSIX assertions. |
| Tooling/CI/release | Root scripts, exact dev-only dependency/lockfile, package exclusion, required aggregate + release call graph, canonical VSIX digest evidence, deterministic visual references and artifacts. |

### Delivery sequence for subsequent task generation

1. **A — Automation foundation**: against existing 004 designer, prove actual executable launch/input/webview/capture, independent XML/Undo and trust/network observer controls. Record public-API native drag probe separately; failure cannot excuse missing mandatory automation.
2. **B — Native shell/context**: container/three views/asset and active document/view registry, no new mutations; AT-01 and targeted AT-06.
3. **C — Read-only projections**: real hierarchy/groups/data and fair budget allocation; pure/protocol/fixture AT-02/04. Can proceed independently of B once interfaces agree.
4. **D — Selection/source bridge**: combine B+C, retain draft/selection ownership, exact current source ranges and clamped centering; AT-03/06 plus keyboard/Desktop proof.
5. **E — Data workflows**: route native actions into existing inspector/intents, all seven types and reference protection; AT-04/06 exact history/save/reopen.
6. **F — Components/fallback**: use existing creation/canonical catalog, filter, guarded activation and no duplicate expanded default panels; AT-05 and real 004 fallback drag. Native drag stays unadvertised unless its full contract passes.
7. **G — Complete evidence/CI**: all AT-01–09, SC thresholds, reference visuals and installed canonical artifact coverage in required root/CI gates. Missing mandatory evidence blocks feature validation.

Maintain 001–004 workflows throughout migration. Actual format capability/metadata ambiguity must refuse or remain opaque, not silently widen authoring. Task generation must include the source/dataset-selection/transport couplings above and every existing acceptance-matrix row. No tasks or application implementation are generated by this planning command.

## Complexity Tracking

No constitutional violations or exceptions. The context registry, closed bridge, read-only Data projector and test-only Desktop driver each address a concrete missing integration requirement; existing editing/serialization/forms remain the owners of authoring behavior.
