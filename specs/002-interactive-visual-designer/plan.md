# Implementation Plan: Interactive Visual Designer

**Branch**: `main` (Git checkout) | **Feature / setup BRANCH**: `002-interactive-visual-designer` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-interactive-visual-designer/spec.md` and [baseline analysis](baseline-analysis.md).

The specification header correctly records `main`. The setup script resolves its `BRANCH` field from Spec Kit feature state rather than the Git checkout; no branch-creation hook is configured. This plan does not change branches or the functional specification.

## Summary

Extend the released editor with direct manipulation, multi-selection, arrangement, viewport/placement aids and safe same-window clipboard reuse. Keep the current Angular designer, authoritative native XML document and independent domain packages. New interaction state remains view-local; each accepted content change becomes one typed, host-validated, footprint-scoped candidate and one native edit/undo step.

The critical foundation is compound geometry with correct optional dimensions, table-frame identity and request-correlated selection continuity. Clipboard then reuses lexical subtree/namespace preservation, extended typed reference analysis and destination compatibility checks. No replacement editor, full XML serialization or new dependency is needed.

## Technical Context

**Language/Version**: TypeScript 6.0.3; Node >=24.15.0 <25; pnpm 11.28.2.

**Primary Dependencies**: Existing Angular 22.2.3, RxJS 7.8.2, VS Code API and workspace report-model/xml-parser/validation/xml-serializer/expressions/renderer packages. Existing esbuild packaging. No dependency additions.

**Storage**: The native `TextDocument` and saved RDLC XML are authoritative. Per-view disposable state uses the webview state API; one bounded immutable clipboard capture is host-memory-only per window. No database, second report store or saved preview.

**Testing**: Existing `node:test` package/controller/roundtrip/compatibility tests, Angular Vitest/jsdom tests, `@vscode/test-electron` native and installed-package tests. Extend fixture manifest and recorded acceptance/performance evidence.

**Target Platform**: Desktop VS Code compatible with manifest `^1.142.0`, Windows/macOS/Linux local trusted and untrusted workspaces, offline. No new web/remote/cross-window interoperability claim.

**Project Type**: pnpm workspace with a VS Code custom text editor, Angular webview and independently testable domain packages.

**Performance Goals**: On a recorded reference desktop, at both 100% and 200% zoom, feedback ≤50ms and accepted-operation paint ≤200ms in at least 95 of 100 samples per applicable series, including 20-item moves. Representative complete workflow ≤3 minutes. See SC-001/SC-005 and [validation guide](quickstart.md).

**Constraints**: 2016/01 definition namespace, one section, existing textbox and static-column/unmerged table profile only. ≤0.01pt changed-value error and 100-nudge roundtrip drift. Exact unrelated source preservation; one native undo per accepted non-no-op intent. No execution, expression evaluation, external entities, data/resource access or network requirement. Existing parser, protocol, profile and removal/reference guards remain active.

**Scale/Scope**: Bounded performance fixture ≤1 MiB/100 selectable body items; existing XML parser ceiling 16 MiB, 100,000 elements, depth 256. Existing nonsnapshot/snapshot message budgets 64 KiB/8 MiB. New clipboard limits: 1 KiB token, 8 MiB retained payload, one current capture/window. This feature implements FR-001–FR-027 without expanding report construct/version coverage.

## Constitution Check

Gate evaluated before research using the specification/baseline and re-evaluated against the Phase 1 contracts. Both evaluations **PASS**; no exception is requested.

| Principle / constraint | Pre-research gate | Post-design evidence |
| --- | --- | --- |
| I: open-source, native lifecycle | PASS — extend existing MIT extension and native document | One existing per-document apply path; native Save/Undo/Redo and failure retention; no proprietary requirement/new license. |
| II: specification-driven compatibility | PASS — bounded existing profile and cited local reference | [Research](research.md#targeted-format-references) and baseline cite individual geometry/naming/scope sections. Unresolved wider tablix extraction ambiguity is excluded, not assumed resolved. |
| III: lossless predictable editing | PASS — authoritative XML and declared footprints required | [Layout](contracts/layout-protocol.md) verifies one complete patch candidate; [clipboard](contracts/clipboard.md) preserves lexical subtrees/namespaces or refuses. No full regeneration/conversion. |
| IV: verifiable behavior and boundaries | PASS — existing package/UI separation retained | Pure geometry/reference work stays outside integration; extended tests cover preservation, atomicity and lifecycle. No speculative framework or dependency. |
| V: bounded agent context | PASS — baseline paths and targeted discovery only | Two scoped research assignments, selected source files and individually indexed MS-RDL sections. No corpus-wide reads. Implementation must continue scoped discovery. |
| VI: reproducible automated release | PASS — existing pipeline inherited | Preserve SemVer tag/package match, frozen lockfile, complete checks and identical non-overwritten VSIX distribution through GitHub Actions. No release/pipeline redesign. |
| Inert untrusted input / isolation | PASS — existing trust/CSP limits inherited | Typed intents and host-derived patches; bounded clipboard token; no browser clipboard/XML privileges, report execution or external fetch. |
| Observable scope / verification gates | PASS — FR/SC matrix exists before implementation | [Quickstart](quickstart.md) defines runnable checks and installed evidence; external runtime fidelity remains separate from authored layout. |

Implementation must stop on an unjustified gate failure; design approval is not evidence that runtime acceptance has already passed.

## Project Structure

### Documentation (this feature)

```text
specs/002-interactive-visual-designer/
├── spec.md                       # Existing functional requirements
├── baseline-analysis.md          # Existing source/reference evidence
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── interaction.md            # Selection, gestures, drafts, viewport, placement
    ├── layout-protocol.md        # Typed layout, verification, native commit/results
    └── clipboard.md              # Capture, transfer, references, removal safety
```

`tasks.md` belongs to the later task-generation phase and is not produced by this command.

### Source Code (repository root)

```text
apps/
├── designer/src/app/
│   ├── editor/                   # Selection/gesture/viewport UI and private adapter
│   ├── properties/               # Existing textbox forms and draft coordination
│   ├── authoring/                # Existing command routing
│   └── tables/                   # Existing table/cell/group controls
└── vscode-extension/src/         # Protocol, planning, candidate verification, sessions
packages/
├── report-model/src/             # Editing/protocol/scene types and shared geometry
├── renderer/src/                 # Accepted bounds, table frames, source/ZIndex order
├── xml-parser/src/               # Source/namespace projection and dependency inputs
├── validation/src/               # All-target eligibility, naming/dependency/removal guards
├── expressions/src/              # Bounded typed identity operands and lexical mapping
└── xml-serializer/src/           # Compound geometry and preserved-subtree patches
tests/
├── fixtures/                     # Existing corpus and provenance manifest
├── roundtrip/                    # Exact no-op/outside-footprint/Undo preservation
├── compatibility/                # Profile and dependency acceptance/refusal
├── vscode/                       # Native lifecycle, clipboard and multi-view races
├── performance/                  # Updated interaction evidence validation
└── package/                      # Installed offline/CSP/package behavior
scripts/                          # Existing compilation/build/acceptance tooling
docs/validation/                  # Future recorded interactive acceptance evidence
```

**Structure Decision**: Extend existing package boundaries and editor components. Add small pure interaction helpers under `editor/` where needed for independent testing; no new package/service hierarchy. Shared immutable types/size conversions belong in `report-model`, expression recognition in `expressions`, policy in `validation`, raw patches in `xml-serializer`, orchestration/clipboard/native apply in the extension. Keep existing exports, explicit package subpaths and build dependency direction coherent when adding symbols.

## Phase 0: Research Outcomes

Completed [research.md](research.md) resolves architecture, atomic apply, optional/unit geometry, table scaling, identity/result ordering, draft conflicts, viewport input, clipboard retention/budgets, reference mapping and validation strategy. Research was delegated into two independent bounded investigations as requested, then consolidated with designer/toolchain evidence.

The highest-impact findings are same-offset missing-property insertion normalization, preservation of namespace dependencies, scalar table setters' incompatible implicit-size/unit behavior, snapshot-before-result ordering, and decoded-expression versus raw-XML reference ranges. The design handles these explicitly; no technical clarification remains unresolved.

## Phase 1: Design and Contracts

### Foundation and intended implementation order

1. **Geometry and scene foundation (FR-002–004, FR-010/024/025).** Add shared unit-safe conversion/formatting, explicit known/derived/unknown geometry and correct implicit textbox bounds. Add body table frames with cells/parent distinction and real source/ZIndex order. Update scene validators, renderer tests, fixtures and exports together. Do not fabricate geometry for unsupported content.
2. **Atomic host operations (FR-005–010, FR-015/016/023/024).** Extend edit vocabulary, strict shared/host validators, all-target checks, compound serializer plans and complete candidate postconditions. Preserve namespaces, implicit dimensions, fixed edges and table proportions in one plan. Add explicit no-op outcome and request/result target mapping. Retain existing version/duplicate/native apply guards across all callers.
3. **Selection and direct manipulation (P1; FR-001–009/022/026).** Extend `EditorComponent`/`HostAdapter` with ordered selection, primary, table-frame versus cell routing, pending coordination and snapshot/result reconciliation. Add all eight handles, pointer capture, group move, marquee, accessible item list and property draft apply/discard/cancel integration. Reuse existing forms/commands. Cover cancellation, native Undo during preview and source-change races.
4. **Arrangement and placement/navigation (FR-011–016/026).** Add host-authoritative align/distribute, keyboard repeat aggregation, zoom/fit/reveal/pan/scroll/edge auto-scroll and deterministic grid/guides/Alt bypass. Persist validated per-view preferences only. Test every tie/axis/zoom and normal form shortcut isolation.
5. **Clipboard and duplication (P2; FR-017–021/024/025).** Add typed captures/dependency declarations, narrow reference operands/raw lexical mapping, typed unique identities and whole-removal-set guards. Implement host token/clipboard coordination and complete insertion/removal plans; preserve full XML and local namespace meaning. Integrate labeled actions/platform canvas shortcuts, paste sequence and selected-copy reveal. No broad expression grammar or resource authoring expansion.
6. **Acceptance and regression completion (FR-027; SC-001–008).** Extend all affected test layers and provenance manifest, exercise 20-operation native Undo/Redo, source/visual races, clipboard refusal/failure, lexical corpus and installed offline/accessibility runs. Update existing measurement validation for new feedback/accepted-paint boundaries and record timed representative workflow. Preserve all existing quality/release gates.

This ordering is design guidance for subsequent tasks, not an implementation execution or a generated task list.

### Design artifacts

- [data-model.md](data-model.md): accepted scene/provenance, selection, preview, viewport, guide, capture/dependencies and operation state transitions.
- [contracts/interaction.md](contracts/interaction.md): view state, focus/drafts, selection, transforms and deterministic placement behavior.
- [contracts/layout-protocol.md](contracts/layout-protocol.md): closed action payloads, all-target authorization, footprints, result correlation and native commit.
- [contracts/clipboard.md](contracts/clipboard.md): exact token envelope, bounds/retention, capture/namespace/reference proof, cross-document compatibility and cut sequencing.
- [quickstart.md](quickstart.md): actual repository commands, end-to-end scenarios and measurable evidence requirements.

### Validation reach and compatibility

Changes must reach shared types/exports and strict validators, renderer/scene consumers, controller/planner/verifier/session, designer adapter/components/forms, fixture manifest and existing package/Angular/roundtrip/compatibility/native/package/performance tests. Keep old scalar intents and public extension commands compatible. Extend metadata rather than redefining node IDs as stable across versions.

Mandatory source assertions cover exact no-op equality, exact outside-footprint equality, intended-only changes inside affected parents/copied subtrees, namespace meaning, reference correctness and complete native restoration. A copy/paste validator must prove inserted subtree semantics; existing untouched-node verification alone is insufficient. Unknown dependency refusal is legitimate, but must not reduce supported same/cross-document reuse to universal refusal or block unrelated safe geometry.

### Post-design gate result

**PASS.** Every constitutional gate above has a design mechanism and verification obligation. No new dependency/license, runtime support claim, proprietary requirement, report-version expansion, parallel source of truth or release exception is introduced. Phase 1 design is complete; implementation and acceptance evidence remain subsequent work.

## Complexity Tracking

No constitutional violations or exception justifications. Added compound geometry and host capture/reference handling are required by atomic multi-item editing and lossless compatible clipboard transfer; existing mechanisms are reused wherever their semantics match.
