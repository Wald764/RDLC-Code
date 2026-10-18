# Implementation Plan: Designer UX/UI Overhaul

**Branch**: `main` (checked-out branch) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Feature identifier**: `003-designer-ux-ui-overhaul` (the setup script's `BRANCH` value, resolved from `.specify/feature.json`; no Git branch was created).

**Input**: `specs/003-designer-ux-ui-overhaul/spec.md` and [baseline-analysis.md](baseline-analysis.md). Planning ends after Phase 1; implementation and task generation are subsequent workflows.

## Summary

Progressively refactor the existing Angular designer into five fixed workspace zones: compact toolbar, Components/Structure panel, stable canvas, contextual inspector and status strip. Preserve every supported 001/002 workflow and the native, source-authoritative document pipeline. Reuse selection, manipulation, viewport math, property forms, authoring intents and host validation. Add only the read-only hierarchy metadata, document-bound native-history routing and per-view layout state needed by the redesigned interface.

The supported format remains the RDL 2016/01 namespace with exactly one report section. Textboxes, the existing restricted table profile, table cells and local dataset definitions retain their current property-level capabilities. Unsupported content remains preserved with truthful limitations and source access. No new rendering/runtime or authoring profile is introduced.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Angular templates and SCSS; Node.js >=24.15.0 <25; pnpm 11.28.2.

**Primary Dependencies**: Angular 22.2.3, RxJS 7.8.2 and existing `@rdlc/*` workspace packages. Use installed Angular/native DOM primitives and original local icons; no new UI, state, XML or icon dependency.

**Storage**: Existing VS Code `TextDocument` for report XML; existing webview state for validated per-editor display preferences. No report schema, database, global settings service or document-history migration.

**Testing**: Existing Angular TestBed/Vitest 5.0.5/jsdom 30.1.3, Node test runner, roundtrip/compatibility fixtures and `@vscode/test-electron` 3.1.0 integration harness. Real installed-editor checks supply layout, screen-reader, contrast and measured performance evidence that jsdom cannot establish.

**Target Platform**: Desktop VS Code on Windows, macOS and Linux; extension manifest requires VS Code ^1.142.0. Respect existing extension-host/webview isolation, Workspace Trust and offline behavior.

**Project Type**: Existing VS Code custom text editor with an Angular webview in a pnpm workspace.

**Performance Goals**: At least 95/100 samples: interaction feedback <=50ms, accepted-edit display <=200ms, selection synchronization <=100ms and component search/panel feedback <=100ms, using up to 1 MiB/100 selectable body items. Unintended origin drift <=1 screen pixel; geometry error <=0.01pt. Record hardware, candidate commit and measurement boundaries.

**Constraints**: Native history and atomic bounded XML edits only; no execution/network retrieval from report content; exact no-op text and outside-footprint preservation. Toolbar/status heights are invariant. Wide panel defaults 220/300 CSS px, bounds 180–360/240–480; retain >=320px canvas from 400px workspace width upward. Left overlay below 1100px, both below 800px. Zoom 25%–400%; independent grid/guide settings retained. Normal text contrast >=4.5:1 and essential boundaries >=3:1.

**Scale/Scope**: One existing editor, 36 functional requirements, five user journeys, four required viewport sizes and light/dark/high-contrast themes. Reuse the preservation corpus of >=12 fixtures. Five-author usability study and 100-sample selection/gesture/performance runs are release acceptance work, not completed planning evidence.

## Constitution Check

_Gate: checked before Phase 0 and re-evaluated against Phase 1 design._

| Gate                                  | Before Phase 0                                                                               | After Phase 1 design                                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I — Open-source, native editing       | PASS: existing MIT license, Angular editor and native document lifecycle retained.           | PASS: host contract routes real native history/source actions; no duplicate save path or proprietary assets.                                                                                                                      |
| II — Versioned specification evidence | PASS: 2016/01, one section and inherited capabilities explicitly fixed by the specification. | PASS: reuse [001 compatibility](../001-rdlc-vscode-editor/contracts/compatibility.md) and [002 targeted evidence](../002-interactive-visual-designer/baseline-analysis.md#targeted-ms-rdl-evidence); no wider RDLC/runtime claim. |
| III — Lossless source authority       | PASS: no new report semantics or serializer replacement.                                     | PASS: hierarchy/view state are read-only projections; mutations use existing validation, atomic footprints and refusal paths.                                                                                                     |
| IV — Verification and boundaries      | PASS: existing packages remain separate from presentation.                                   | PASS: contract/model checks, inherited fixture gates, actual native-history tests and measured installed-editor acceptance are specified in [quickstart.md](quickstart.md).                                                       |
| V — Bounded context                   | PASS: discovery starts from feature baseline and scoped file/symbol searches.                | PASS: focused research delegates use disjoint paths and bounded reads; inherited reference indexes/citations suffice without loading the vendor corpus. Implementation must retain this method.                                   |
| VI — Reproducible automated release   | PASS: no publication-process change proposed.                                                | PASS: existing GitHub Actions frozen-lockfile quality gates, SemVer tag/package match, same-VSIX publication and overwrite prevention remain required.                                                                            |
| Security and project constraints      | PASS: untrusted reports stay inert and offline; capability/read-only/budget guards retained. | PASS: host validates fixed request vocabulary and version-scoped targets; tree metadata grants no authority to edit or fetch content.                                                                                             |

**Gate result**: PASS for planning and design; no constitutional exception requested. This is a design review, not evidence that implementation, integration, usability or release checks have run. The inherited tablix wording ambiguity remains outside this feature's compatibility claim.

## Project Structure

### Documentation (this feature)

```text
specs/003-designer-ux-ui-overhaul/
├── spec.md
├── baseline-analysis.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── workspace-ui.md
    └── editor-integration.md
```

`tasks.md` belongs to the subsequent task-generation workflow.

### Source Code (repository root)

```text
apps/designer/src/
├── styles.scss
└── app/
    ├── editor/         # shell, selection, interaction and viewport ownership
    ├── properties/     # contextual property controls and draft behavior
    ├── authoring/      # compact creation and page setup
    ├── datasets/       # selected local definition controls
    ├── tables/         # selected table/cell/group/total controls
    └── diagnostics/    # overlay details and source actions
apps/vscode-extension/src/
├── editor-provider.ts
├── document-session.ts
├── protocol.ts
└── commands/
packages/
├── report-model/src/   # shared metadata and protocol types
├── renderer/src/       # accepted scene/read-only hierarchy projection
├── xml-parser/src/     # existing syntax and source identities
├── validation/src/     # existing authoring guards
└── xml-serializer/src/ # existing bounded patches
tests/
├── fixtures/
├── roundtrip/
├── compatibility/
├── vscode/
└── performance/
```

**Structure decision**: Keep the existing monorepo and editor as the only application. Add focused standalone presentation children under the existing editor area as necessary for toolbar, catalog/tree, panels, inspector, rulers and status. They consume accepted state and emit existing intents; they do not own a second document store or gesture engine. Keep coordinate/selection/draft ownership in the current editor boundary. Extend shared type/projection/host files together only for the bounded integration delta; parser/serializer/validation behavior stays inherited.

## Phase 0 — Research Outcomes

[research.md](research.md) resolves the technical decisions for presentation decomposition, safe hierarchy projection, selection/drafts, native history, versioned per-view preferences, stable coordinates and accessible validation. Source inspection and focused research establish implementation choices; none substitutes for runtime acceptance.

## Phase 1 — Design and Contracts

- [data-model.md](data-model.md): accepted hierarchy, version-scoped selection, component catalog, preferences, layout/gesture state, inspector drafts and status.
- [contracts/workspace-ui.md](contracts/workspace-ui.md): public authoring UI, command eligibility, keyboard/focus, responsive layout and feedback contracts.
- [contracts/editor-integration.md](contracts/editor-integration.md): host projection, native history, state validation and trust boundaries.
- [quickstart.md](quickstart.md): runnable verification commands and end-to-end evidence matrix.

### Progressive delivery and change reach

1. **Stabilize shell and viewport** (FR-001–006, 014–018, 025–030): put canvas in a fixed grid cell, move feedback outside its layout, add bounded panels, rulers and overflow. Retain reachable existing authoring/property controls in panels until their contextual replacements land. Verify panel anchoring, coordinate math and resize cancellation before migrating more controls.
2. **Unify navigation** (FR-007–013, 019, 024, 029, 032–033): add catalog/creation surfaces, bounded read-only hierarchy and shared selection. Extend snapshot/projection types, adapter consumers, host shape validation and targeted fixture expectations together. Keep cells, body items and data targets distinct.
3. **Contextualize properties and authoring** (FR-020–024, 031–034): migrate textbox/cell, table, dataset/field and page controls into supported sections; preserve every structural/reference safeguard, expression value, initialization no-op, apply/cancel and draft transition. Remove superseded stacked controls only after their workflows remain reachable.
4. **Integrate and validate all journeys** (FR-003, 026, 030–036): connect document-bound native history, finalize keyboard menus/focus, contrast and source-only states, and collect actual end-to-end, preservation and performance evidence. Every increment retains offline/inert behavior, native history and all inherited workflows.

**Callers and exports**: update shared protocol/snapshot consumers in the provider, session/adapter and Angular editor; update renderer exports only if new hierarchy projection needs an export. Reuse existing creation/property request outputs in all relocated controls. Host history adds a fixed protocol branch with matching validation/tests, not an arbitrary command contribution. No package dependency, new contributed setting or new public authoring command is planned.

**Regression scope**: editor, lifecycle, viewport, selection, placement/manipulation and authoring component suites; host protocol/session/controller tests; native lifecycle/synchronization/persistence/clipboard tests; existing fixture manifest, roundtrip, compatibility and performance suites. Add small fixtures only where the existing corpus lacks nested/preserved hierarchy or unknown-bounds coverage, recording provenance and inherited citations. Exact preservation and native undo gates apply even to presentation-only increments.

## Complexity Tracking

No violations or additional architectural layers are proposed. Existing state owners and packages are reused; new metadata and presentation components serve explicit requirements.
