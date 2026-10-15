# Implementation Plan: TypeScript-Only RDLC Editor Architecture

**Branch**: `001-rdlc-vscode-editor` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-rdlc-vscode-editor/spec.md`, the validated TypeScript/Angular architecture direction, and the GitHub Actions CI/CD amendment under constitution 1.1.0.

**Status**: Phase 0 research and Phase 1 design complete. Design only; implementation and task generation are not authorized by this document. Technical validation gates remain explicit below.

## Summary

Deliver a local VS Code RDLC authoring extension using official `CustomTextEditorProvider` APIs and a bundled Angular graphical designer. Keep the live XML TextDocument authoritative; visual actions produce validated minimal source patches so unknown XML, namespaces and extensions survive. Separate parsing, serialization, validation, expression analysis and authoring-layout rendering into independently tested TypeScript packages in a pnpm workspace.

The designer supports the specification's RDL 2016/01 single-section profile, textboxes, table-shaped tablix with row groups/totals, and local datasets/fields. Rendering means a design surface, not a report-processing engine. All installed functionality works offline without an HTTP listener, external service or .NET/C#/Java/Python backend.

GitHub hosts the source and GitHub Actions exclusively handles CI/CD. PR/main quality gates and
tag-triggered releases share the same checks. A release packages the tagged production build
once, then distributes that exact versioned VSIX to GitHub and the marketplaces. The detailed
workflow, trust, version and recovery contract is [CI/CD](contracts/ci-cd.md).

## Technical Context

**Language/Version**: TypeScript 6.0.x for all project-owned application/domain/tooling logic; strict checking. Angular templates and SCSS are compiled assets, not alternative backend languages. Build environment: Node.js 24 LTS ≥24.15.0 and pnpm 11.x. Exact patches must be locked during implementation.

**Primary Dependencies**: Angular 22.2.x, aligned Angular CLI/build tooling, Angular Signals, standalone components, zoneless change detection, SCSS compilation; official `vscode` API; proposed `saxes` 6.x for strict namespace-aware XML well-formedness (including its `xmlchars` transitive dependency). Angular-required RxJS 7.x is retained without adding a separate state framework. VS Code-provided runtime is separate from build Node requirements. Native messaging, DOM, arithmetic and Node test/assert APIs are preferred.

**Storage**: Local `.rdlc` text files through VS Code's document service; untitled documents for new reports. No database, migration, separate document store or direct filesystem save path. Webview state stores only disposable UI preferences.

**Testing**: Node built-in `node:test`/`node:assert` for compiled TypeScript domain tests and fixtures; Angular-supported test builder for UI tests; official `@vscode/test-electron` for desktop lifecycle integration; VSIX inspection and installed offline smoke checks. No .NET or other runtime is needed for mandatory extension tests. External runtime compatibility evidence is separately labeled and can be supplied as reviewed fixtures/artifacts.

**Target Platform**: Desktop VS Code on Windows/macOS/Linux, local workspaces. Proposed minimum VS Code 1.110 is a validation candidate, not a tested compatibility claim; its Electron/browser runtime must meet Angular 22 requirements. No browser-hosted or remote-workspace support claim.

**Project Type**: pnpm workspace containing a VS Code extension, a static Angular webview application and six domain/shared-model libraries. No backend or HTTP API.

**Delivery**: Planned `.github/workflows/ci.yml` and `release.yml`; repository-pinned Node/pnpm,
frozen pnpm lockfile, pnpm-store cache, pinned packaging/publishing tools, SemVer release tags,
Conventional Commits compatible with the required gitmoji prefix, and secret-free build jobs.

**Performance Goals**: SC-004: ≤1 MiB / 100 editable textboxes usable in ≤3 seconds for at least 19/20 opens; ≤200 ms for at least 95/100 property interactions, on a recorded reference workstation. Batch gesture commits and derive scenes from accepted snapshots. Workers are deferred unless measurements require them.

**Constraints**: Entirely offline after VSIX installation; local AOT assets; restrictive CSP; no execution of report expressions/code, entity resolution, data queries, or remote resource retrieval; lossless untouched XML; atomic source edits; keyboard accessibility; MIT original code and reviewed dependency licenses. Initial parser budgets are documented in [module contracts](contracts/modules.md).

**Scale/Scope**: One editable report section; body textboxes and non-matrix table-shaped tablix; row groups, scoped totals and seven local field types. At least 12 representative acceptance fixtures, including malformed and unsupported reports. Existing unsupported constructs remain preservation-only. No runtime report rendering, export, printing, version conversion, live data or matrix authoring.

**Research closure**: Initial unknowns were framework/build version alignment, official document lifecycle, lossless XML strategy, RDLC local-data conventions, and group/total mapping. Each has a selected design in [research.md](research.md). There are no open requirements clarifications. Empirical validation items remain visible; they do not constitute evidence of successful compatibility.

## Constitution Check

*Pre-research assessment used the specification and mandatory architecture constraints. Post-design assessment checks the generated contracts. PASS means the design provides the required safeguards, not that unimplemented software passed tests.*

| Gate | Before Phase 0 | After Phase 1 | Evidence / release obligation |
|---|---|---|---|
| I. Open-source, VS Code-native | PASS | PASS | Official text-editor lifecycle; MIT specification; dependency/notice review required before distribution |
| II. Specification-driven compatibility | PASS | PASS, bounded profile | Version-specific vendor citations and fixture requirements; RDLC runtime evidence separated; known §2.23 prose ambiguity explicitly excludes a broad conformance claim |
| III. Lossless predictable editing | PASS | PASS | Source authority, lexical spans, targeted patches, candidate verification, stale-edit rejection, refusal of unsafe operations |
| IV. Verifiable independent behavior | PASS | PASS | Separate domain packages; mandatory unit, roundtrip, compatibility and lifecycle checks |
| V. Bounded agent context | PASS | PASS | Filename/index discovery and selected sections only; research agents received bounded scopes; no corpus reads |
| VI. Reproducible automated releases | PASS | PASS (design) | Tag/package equality, frozen lockfile, tagged-commit gates, single VSIX, automatic GitHub/Marketplace and configured Open VSX publication; conflicting versions fail |
| GitHub Actions security and quality gates | PASS | PASS (design) | All PRs/main checked, no artifacts on failed gates, least-privilege isolated publishers, supported authentication, no secret logging; see CI/CD contract |
| Untrusted input and execution boundaries | PASS | PASS | No expression execution, external entities, data access or report-triggered networking; validated host messaging and CSP |
| TypeScript / Angular / pnpm / offline direction | PASS | PASS | All application logic TypeScript, Angular Signals/SCSS, static packaged webview, no backend/server |

**Gate outcome**: No constitutional exception is proposed. Any future test exposing loss or unsafe mutation is an ERROR/release blocker, not permission to weaken preservation. Expanding compatibility into an ambiguous or unverified construct requires resolving its evidence first.

## Project Structure

### Documentation (this feature)

```text
specs/001-rdlc-vscode-editor/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── modules.md
    ├── editor-protocol.md
    ├── compatibility.md
    └── ci-cd.md
```

`tasks.md` belongs to the later task-generation phase and is not produced here.

### Planned source layout (not created)

```text
apps/
├── vscode-extension/src/       # API integration, document orchestration, webview bootstrap
└── designer/src/               # Angular standalone UI, Signals, HTML, SCSS
packages/
├── report-model/src/           # Shared immutable domain and protocol types
├── xml-parser/src/             # Well-formedness, lossless spans, versioned projection
├── xml-serializer/src/         # Intent-to-patch planning and escaping
├── validation/src/             # Authored-property, shape and reference rules
├── expressions/src/            # Nonexecuting classification/reference analysis
└── renderer/src/               # Pure authoring geometry/scene projection
tests/
├── fixtures/                   # Provenance, expected capability, citations, XML
├── roundtrip/
├── compatibility/
└── vscode/
scripts/                       # TypeScript build/package verification only when needed
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
vendor/                        # Existing reference material, unchanged
.node-version                  # Exact build Node patch; validated under V1
.github/workflows/ci.yml        # Planned PR/main checks, not generated here
.github/workflows/release.yml   # Planned tag release, not generated here
```

**Structure Decision**: The five required independent modules share one small model package to prevent cycles. The extension owns mutation orchestration; Angular owns presentation only. Workspace imports use `workspace:*`; no Nx/Turborepo, backend, generic transport layer or plugin framework is needed. Libraries colocate focused unit tests; cross-package corpus and lifecycle tests live under `tests/`.

## Phase 0: Research Results

See [research.md](research.md) for decisions, rationale, alternatives and sources. No earlier concrete technical architecture exists in the current repository: the previous plan was a scaffold and the specification was technology-neutral. The updated specification now records the mandatory direction. Any future proposal of a backend, HTTP dependency, non-Angular designer, full XML regeneration or executing expression engine conflicts with this decision.

## Phase 1: Design Results

- [Data model](data-model.md): immutable projections, XML lexical ownership, field types, capabilities and transitions.
- [Module contracts](contracts/modules.md): package boundaries, dependency direction, parsing, expressions, validation, patch serialization and rendering.
- [Editor protocol](contracts/editor-protocol.md): extension commands, versioned messages, document lifecycle, CSP and offline assets.
- [Compatibility contract](contracts/compatibility.md): supported profile, evidence matrix, preservation and compatibility gates.
- [CI/CD contract](contracts/ci-cd.md): triggers, version synchronization, checks, artifact identity, credentials and partial-release recovery.
- [Quickstart validation guide](quickstart.md): future build/test commands and observable acceptance scenarios.

## Technical Decisions Requiring Validation

These are selected design candidates, not unanswered product questions. No implementation may claim them proven yet.

**Approval recorded 2026-10-15**: The user approves V9 and V10 as design decisions with the
conditions below. This approval does not certify working authentication, remote integrity or
release automation. Their outstanding publication prerequisites remain blocking until verified.
V1–V8 and all previously selected architectural decisions remain unchanged.

| ID | Candidate decision | Required evidence / impact if it fails |
|---|---|---|
| V1 | Angular 22.2 / TS 6.0 / Node 24 / pnpm 11 | Confirm published peer dependencies and pin patches; official table currently lists the v22.0 range rather than every minor. Adjust pins within the supported Angular baseline if necessary |
| V2 | VS Code ≥1.110 and static Angular bundle | Test minimum/stable VS Code, chunk paths, runtime style nonce, keyboard access and offline load on three OSes; raise minimum or correct packaging if required |
| V3 | `saxes` plus source-span retention | Review ISC/MIT-compatible dependency notices, prove offsets and full lexical coverage on adversarial fixtures; do not permit rewriting until roundtrip gates pass |
| V4 | Query-free local datasets and seven `rd:TypeName` mappings | Obtain Microsoft-designer fixture evidence and intended consumer-version acceptance for each type; withhold runtime-compatibility claims where evidence is absent |
| V5 | Synchronized table/group/footer profile | Verify generated hierarchy against original sections and representative fixtures; keep spanning/opaque structures preservation-only. Do not implement the ambiguous global cell-count reading |
| V6 | Dataset-wide meaning of report total; group-name scope for subtotal | Confirm product acceptance and fixture expression/placement checks; distinguish dataset-wide totals from tablix-filtered totals explicitly |
| V7 | Source budgets and performance targets | Record reference workstation and benchmark bounded corpus; tune internal budgets without weakening no-loss behavior |
| V8 | Native text lifecycle protects all pending work | Exercise source edits, split views, undo/redo, encoding/EOL, applyEdit refusal, dirty external conflicts, failed saves and cancellation; any silent loss blocks release |
| V9 | APPROVED: job-scoped GITHUB_TOKEN; prefer Entra federation from GitHub Actions for Marketplace; Open VSX bootstrap PAT then GitHub OIDC; configurable publisher/namespace | Before first release, configure accounts/roles and matching identities; prove pinned vsce consumes the GitHub-federated Azure CLI credential and publishes the prebuilt VSIX. Documentation/source support is confirmed, authenticated end-to-end compatibility is not. No Azure Pipelines; unresolved authentication blocks publication |
| V10 | APPROVED: one canonical VSIX/version with SHA-256, exclusive reuse across destinations, evidence-based recovery without rebuild or overwrite | Prove tag/version rejection, secret isolation, all quality gates, cross-OS checks, digest handoff, concurrent-run exclusion and partial recovery. Before enabling existing-version recovery, establish reliable prior-success or remote-integrity evidence; otherwise stop with explicit conflict. Retain artifacts 90 days; GitHub reruns limited to 30 days/50 attempts |

## Complexity Tracking

No constitution violations or exceptions. The only extra domain package is shared immutable types, required to keep the five requested modules independent. The XML dependency handles strict well-formedness that native Node APIs do not provide; custom code is limited to source preservation and RDLC-specific projection/patching.
