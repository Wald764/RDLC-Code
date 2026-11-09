# Implementation Plan: Embedded Image Component Authoring

**Branch**: `feat/006-embedded-image-authoring` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-embedded-image-authoring/spec.md`

## Summary

Authors can import local PNG and JPEG files as `EmbeddedImage` resources, insert `Image` items
from the Components toolbox, display them on the canvas according to their sizing mode,
manipulate them like other report items, edit their properties in the inspector, and
manage definitions in Report Structure and Report Data. Every other image remains
byte-identical and is displayed as a placeholder.

The technical approach extends the existing pipelines of features 001–005:

| Step | Existing mechanism reused |
|---|---|
| Projection | `xml-parser` |
| Plans | `xml-serializer`, `composePlans` |
| Edits | typed intents, `edit-controller` and `verify`, then one `WorkspaceEdit` |
| Display | `renderer` scene |

Five things are new:

- a pure-TypeScript content validator for PNG and JPEG data;
- a host-only `ImageSource`, which wraps `showOpenDialog` and `workspace.fs`;
- a dedicated `imageAssets` channel, which delivers validated bytes to the webview as `blob:` URLs;
- clipboard image requirements;
- sidebar image nodes and commands.

No runtime dependency is added ([research.md](research.md) R2, R6).

## Technical Context

**Language/Version**: TypeScript (repository `tsconfig.base.json`), Node test runner. Angular is used in `apps/designer`.

**Primary Dependencies**: The existing ones only: VS Code extension API, Angular, and `node:crypto` (built in) for hashing. No new package.

**Storage**: The `.rdlc` report text is the only storage. Pictures are stored as base64 in `Report/EmbeddedImages`.

**Testing**: `node --test`, which covers the colocated unit tests and the tests in `tests/roundtrip`, `tests/compatibility` and `tests/performance`. Extension-host tests are in `tests/vscode`, Desktop Playwright tests in `tests/desktop`, and the designer's own tests in `*.spec.ts` files.

**Target Platform**: VS Code desktop (minimum and stable versions in the CI matrix) on Linux, Windows and macOS.

**Project Type**: pnpm monorepo containing a VS Code extension, an Angular webview and pure packages.

**Performance Goals**: A 5 MiB picture is displayed less than 1 s after insertion. With 50 images, selection and move feedback takes 100 ms or less (SC-006).

**Constraints**:

- The editor is offline and makes no network access.
- File access is host-only, and only to the user-chosen file.
- Imports are limited to 5 MiB per file, 16,384 px per dimension, 40 MP in total, and a 16 MiB report budget.
- Each mutation is exactly one native undo step.
- Text outside the edit stays byte-identical.

**Scale/Scope**: 5 user stories, 28 functional requirements, 8 success criteria. The work spans 6 packages and 2 apps.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1. Result: **PASS**, with no violations.*

| Principle | How the plan complies |
|---|---|
| I. VS Code-native | Edits go through `WorkspaceEdit`, which gives native undo/redo and dirty state. The file chooser is the native `showOpenDialog`. The work honors Workspace Trust and read-only gating (`document-session.ts:558`). |
| II. Spec-driven | MS-RDL 2.12, 2.12.17–2.12.20, 2.3.20, 2.305, 2.306 and 2.2.10 are cited. The unordered `xsd:choice` was verified for `Report` and `Image` (R1). Authoring is RDL 2016/01 only, and authoring support is not claimed as a rendering guarantee. |
| III. Lossless | Edits are scalar and inserting patches inside `composePlans` footprints. Images and definitions that are not editable are preserved byte-identically. A roundtrip corpus covers them (`preserved.rdlc`). |
| IV. Boundaries | Format validation, projection and planning are pure packages that are testable without VS Code. The new abstractions (`ImageSource`, the `imageAssets` channel) each answer a stated requirement. |
| V. Bounded context | Exploration was scoped (two targeted reports). Implementation briefs name exact files. Agents read only the cited `vendor/` sections. |
| VI. Releases | No release or workflow semantics change. The CI classification gains only one informational latency signature, which carries a justification. |
| VII. Automated first | Every acceptance scenario maps to an automated test ([contracts/desktop-validation.md](contracts/desktop-validation.md)). The visual tests cover the sizing modes and the placeholder. The real file chooser is driven in Desktop tests (R5). Remaining unvalidated items will be reported. |
| Security constraints | Payloads never fetch, evaluate or resolve anything. The CSP adds only `blob:` to `img-src`, while `connect-src 'none'` stays. Payloads are absent from logs, diagnostics and labels. |

**Post-design re-check**: PASS. The `blob:` CSP widening is an explicit contract
([image-protocol.md](contracts/image-protocol.md)) driven by FR-014. It introduces neither
network nor file access, and the offline and isolation tests keep enforcing that.

## Project Structure

### Documentation (this feature)

```text
specs/006-embedded-image-authoring/
├── spec.md                       # existing (not regenerated)
├── plan.md                       # this file
├── research.md                   # Phase 0
├── data-model.md                 # Phase 1
├── quickstart.md                 # Phase 1
├── contracts/
│   ├── image-import.md
│   ├── image-protocol.md
│   └── desktop-validation.md
└── tasks.md                      # Phase 2 (/speckit.tasks), not created here
```

### Source code (existing owners and planned additions)

```text
packages/report-model/src/
  images.ts            NEW   limits, ImageReason, ImageAsset, EmbeddedImageRequirement types
  report.ts            EDIT  EmbeddedImageDefinition, ImageItem in ReportProjection
  scene.ts             EDIT  kind 'image' scene item
  editing.ts           EDIT  image intents, authoringFields entries
  protocol.ts          EDIT  intent validation, imageAssets message
  components.ts        EDIT  Image creatable; CreationKind 'image'
  navigation.ts        EDIT  CreateKind 'image'; embedded-image node metadata
  clipboard.ts         EDIT  Capture.images
  image-data.ts        NEW   platform-neutral byte walkers (sniffFormat, crc32, walkPng,
                             walkJpeg, decodeImageData), shared by validation and xml-parser
packages/validation/src/
  images.ts            NEW   validatePicture, name allocator, validateImageProperty,
                             validateDefinitionMutation; re-exports the image-data walkers
  clipboard.ts         EDIT  image requirement reconciliation
packages/xml-parser/src/
  project-images.ts    NEW   projectImages(root) → definitions, items, capabilities
  project-report.ts    EDIT  wire images; remove editable images from preserved
  parser.ts            EDIT  export the budget constants
packages/xml-serializer/src/
  images.ts            NEW   planCreateImage, planImageProperty, planReplacePicture,
                             planRenameDefinition, planRemoveDefinition
  clipboard.ts         EDIT  carry/insert definitions on paste
packages/renderer/src/
  render.ts            EDIT  image scene items + display state
  structure.ts         EDIT  Image → 'image' kind
  data.ts              EDIT  definition metadata, reference counts, context values
apps/vscode-extension/src/
  image-import.ts      NEW   ImageSource (showOpenDialog + stat + readFile), import flow
  image-assets.ts      NEW   per-webview asset delivery cache
  edit-controller.ts   EDIT  image intent dispatch + verify
  document-session.ts  EDIT  inject ImageSource; send imageAssets
  clipboard.ts         EDIT  capture/paste definitions
  webview.ts           EDIT  CSP img-src blob:
  sidebar/views.ts, sidebar/actions.ts  EDIT  image nodes, icons, commands
  package.json         EDIT  commands and menus
apps/designer/src/app/
  editor/editor.component.{ts,html,scss}  EDIT  image rendering, sizing CSS, placeholder
  editor/image-assets.ts                  NEW   Blob URL cache
  editor/contextual-inspector.component.ts EDIT  route to image properties
  properties/image-properties.component.* NEW   inspector panel
tests/
  fixtures/images/ + manifest.json        NEW/EDIT
  roundtrip/images.test.ts, compatibility/images.test.ts, performance/images.test.ts  NEW
  vscode/images.test.ts                   NEW
  desktop/images.spec.ts, coverage-006.json  NEW
  desktop/components.spec.ts, visual.spec.ts, offline.spec.ts, security-observer.spec.ts,
  coverage-assertions.ts, qa-classification.ts, driver.ts (simpleDialog setting)  EDIT
```

**Structure Decision**: The plan uses the existing monorepo layout. Each new module sits
beside the textbox and dataset equivalents in the same package, so that dependency direction
(`report-model` ← `validation`/`xml-parser` ← `xml-serializer`/`renderer` ← apps) is unchanged.

## Phase 0 — Research Results

See [research.md](research.md). The key decisions are:

| Topic | Decision | Research |
|---|---|---|
| Insertion order | Append-only insertion is schema-valid | R1 |
| Format validation | Structural PNG/JPEG validation with no decoder dependency | R2 |
| Limits | Shared limit constants | R3 |
| File access | Host-only `ImageSource` | R4 |
| Desktop file chooser | The real dialog, driven through `files.simpleDialog.enable` | R5 |
| Display | A `blob:` asset channel; the scene stays byte-free | R6 |
| Sizing modes | CSS `object-fit` mapping | R7 |
| Deduplication | SHA-256 of the decoded bytes | R8 |
| Atomicity | `composePlans` | R9 |
| Clipboard | Image requirements in `Capture` | R10 |
| Sidebar | Node kinds and commands | R11 |
| Verification | Test placement | R12 |

## Phase 1 — Design and Contracts

- [data-model.md](data-model.md): projections, capability state rules, the import state
  machine and validation codes.
- [contracts/image-import.md](contracts/image-import.md): the import pipeline, the XML shapes
  written and the limits.
- [contracts/image-protocol.md](contracts/image-protocol.md): intents, messages, sidebar
  commands and the CSP.
- [contracts/desktop-validation.md](contracts/desktop-validation.md): test levels, fixtures,
  coverage and classification.
- [quickstart.md](quickstart.md): validation commands and scenario oracles.

### Change reach and compatibility obligations

- **Existing tests that change**:
  - `packages/report-model/src/components.test.ts:24` (the Image entry becomes creatable).
  - `tests/desktop/components.spec.ts`: the `US4.5-unavailable-kinds` case and the Image
    rows at lines 55, 66 and 1372. Image is removed from the unavailable list; the other
    unavailable kinds keep their assertions.
  These are the only allowed expectation changes (SC-008).
- **Behavior change for existing reports**: existing embedded images become editable when
  they meet the state rules in data-model.md, and stop being preserved regions. Their text
  stays identical unless an edit targets them (US5.4).
- **Security rule change**: the comment at `packages/renderer/src/data.ts:20` and the CSP
  change together, and only on the `imageAssets` channel.
- **Protocol**: version 2 is kept, because the changes are additive intents and one new
  host message. If the webview receives an unknown message, it keeps today's behavior.

## Implementation Batches

> **Note (2026-11-07)**: [tasks.md](tasks.md) is authoritative for batch numbering and order.
> It regroups the batches below by user story:
>
> | tasks.md batch | Content | Plan batch |
> |---|---|---|
> | B3 | Display | plan B5 |
> | B4 | Creation plan and host import | plan B3 (creation) and plan B4 |
> | B5 | Toolbox | plan B6 |
> | B6 | Manipulation and clipboard | plan B8 |
> | B7 | Preservation hardening (US5) | new batch |
> | B8 | Inspector, with the property and replace plans | plan B7 |
> | B9 | Views, with the rename and remove plans | plan B9 |
> | B10 | Polish | plan B10 |
>
> Plan B3's property, replace, rename and remove plans move into the story batches that
> use them. File ownership and integration points are unchanged.

All batches run on `feat/006-embedded-image-authoring`. **Each batch ends with:**

1. Targeted QA through `general`: `pnpm qa:quick`, and `pnpm qa:integration` where marked
   ⚙. The reviewer is given exact commands and results.
2. An independent `quality-review` (Sonnet) with the batch requirements, changed files and
   QA evidence. Every CRITICAL or HIGH finding is fixed by `implement` and re-verified
   before the batch continues.
3. One local commit in the format `:gitmoji: type(scope): description`, with no push.

Batches run in dependency order. ∥ marks batches that may run in parallel because their
file ownership does not overlap.

| # | Batch | Depends on | Owner agent / files (exclusive) | Focused tests | QA |
|---|---|---|---|---|---|
| B0 | **Validation scaffolding and fixtures** | — | implement: `tests/fixtures/images/**`, `tests/fixtures/manifest.json`, the fixture generator script, `tests/desktop/coverage-006.json` (rows that reference planned tests are marked planned), multi-file loading in `coverage-assertions.ts` | `tests/compatibility/manifest.test.ts`, `tests/desktop/coverage-assertions.test.ts` | quick |
| B1 | **Format, limits and names** | B0 | implement: `packages/report-model/src/images.ts`, `packages/validation/src/images.ts` (+ test), export of the budget constants in `xml-parser/src/parser.ts` | Signature/CRC/SOF/EOI corpus, limit edge values (exact limit and limit+1), name normalization and `_n` suffix | quick |
| B2 | **Projection and preservation** | B1 | implement: `report.ts`, `xml-parser/src/project-images.ts` (+ test), `project-report.ts` | Capability state table (data-model), reference counts, preservation of `preserved.rdlc`; `tests/roundtrip/images.test.ts` (open/save no-op), `tests/compatibility/images.test.ts` | quick (adds roundtrip and compatibility) |
| B3 | **Serializer plans** | B2 | implement: `xml-serializer/src/images.ts` (+ test) | Each plan: expected XML, byte identity outside the footprint, `EmbeddedImages` created or appended, composed atomic plan, rename of all constant references, removal blocked | quick |
| B4 ⚙ | **Host import and edit dispatch** | B3 | implement: `editing.ts`, `protocol.ts` (intents), `apps/vscode-extension/src/image-import.ts`, `edit-controller.ts`, `document-session.ts` (ImageSource injection), `tests/vscode/images.test.ts` | Protocol rejection of path/bytes; insert/undo/redo; cancel adds no history entry; refusal corpus; budget; stale target; read-only and untrusted gating; deduplication | integration (one extension-host run) |
| B5 ∥ B4 | **Display pipeline** | B2 | implement: `scene.ts`, `renderer/src/render.ts` (+ test), `protocol.ts` (`imageAssets` message only; coordinate with B4 by landing B5 after B4 if both touch `protocol.ts`), `apps/vscode-extension/src/image-assets.ts`, `webview.ts` (CSP), designer `editor/*` image rendering, `image-assets.ts`; `tests/package/offline.test.ts` CSP assertion | Scene items carry no bytes; placeholder reasons; asset sent once per key; CSP string; designer specs for sizing CSS and Blob URL revocation; generic selection, move and resize on `kind:'image'` | quick, then integration at the end of the batch |
| B6 | **Toolbox insertion** | B4, B5 | implement: `components.ts` (+ test update), `navigation.ts` (`CreateKind`), designer `components-catalog` and editor drop handling, `sidebar/views.ts` create route | Catalog creatable, click vs drop placement intents, native Components activation; update the `components.spec.ts` Image rows | quick |
| B7 | **Inspector** | B6 | implement: `properties/image-properties.component.*`, `contextual-inspector.component.ts`, `planReplacePicture` wiring in `edit-controller.ts`, `validateImageProperty` | Each property is one patch and one undo step; invalid values refused; replace with item vs all scope; ToolTip expression inert; read-only metadata shows no payload | integration |
| B8 ∥ B9 | **Clipboard** | B4 | implement: `report-model/src/clipboard.ts`, `validation/src/clipboard.ts`, `xml-serializer/src/clipboard.ts`, `apps/vscode-extension/src/clipboard.ts` | Same-report copy/paste/duplicate reuses the definition; cross-report paste with reuse, insert and rename on collision; `captureBudget` refusal; `tests/roundtrip/clipboard.test.ts`, `tests/vscode/clipboard.test.ts` additions | integration |
| B9 ∥ B8 | **Sidebar views** | B4 | implement: `renderer/src/structure.ts`, `data.ts` (+ tests), `sidebar/views.ts`, `sidebar/actions.ts`, `apps/vscode-extension/package.json` | Image nodes with icon and state; Data metadata and reference counts; rename, remove and insert commands; blocked cases list references; no payload in labels or tooltips | integration |
| B10 ⚙ | **End-to-end, visual, offline and documentation** | B6–B9 | implement: `tests/desktop/images.spec.ts`, image cases in `visual.spec.ts`, `offline.spec.ts`, `security-observer.spec.ts` (allow the chosen fixture file read), the `simpleDialog` setting in `driver.ts`, `qa-classification.ts` (`SC-006-timing`), `tests/performance/images.test.ts`, the remaining rows of `coverage-006.json`, `README.md`/docs feature list | Static: coverage assertions, classification tests and `tsc`. The Desktop and visual specs run in CI only, unless the user requests a focused local run | integration |

**Sequencing**: B0 → B1 → B2 → B3 → {B4, B5} → B6 → B7 → {B8, B9} → B10. Parallel
branches only run when file ownership is disjoint. The files shared by both branches are
`protocol.ts` (B4 and B5) and `sidebar/views.ts` and `edit-controller.ts` (B6, B7, B9).
To avoid collisions, those shared files are edited serially: the second batch starts after
the first has been committed.

### Integration points between batches

| Interface | Produced by | Consumed by |
|---|---|---|
| `validatePicture`, the limits, `allocateDefinitionName` | B1 | B4, B7, B8 |
| `ReportProjection.images` / `.embeddedImages`, capability states | B2 | B3, B5, B9 |
| `plan*` functions in `xml-serializer/src/images.ts` | B3 | B4, B7, B8, B9 |
| Image intents and `ImageSource` | B4 | B6 (toolbox), B7 (replace), B9 (insert existing, rename, remove) |
| The `kind:'image'` scene and `imageAssets` | B5 | B6 (immediate display), B7 (metadata), B10 (visual) |
| `Capture.images` | B8 | B10 (`US2-manipulate`) |
| `coverage-006.json` rows | B0 (skeleton) | completed in B10 |

## Final PR and comprehensive validation

1. After B10 is committed, `general` runs `pnpm qa:integration` once on the final HEAD.
   `quality-review` then does a feature-wide review across the spec, plan, contracts and
   full diff.
2. The branch is pushed and **one PR** is opened to `main`. The PR body includes a summary,
   the batch list, the evidence that was verified locally, and the statement that the
   Desktop, visual and stability checks are validated only by CI.
3. CI runs the comprehensive matrix (`Required checks`, the visual job, `changed-specs`,
   stability). The result is read from `qa-summary-<sha>` for the exact candidate SHA.
4. Each CI failure is diagnosed first (no automatic full-suite escalation). The fix is
   committed on the same branch, and only the affected checks are re-run locally before
   the next push.
5. The PR is **not merged and nothing is published**. The final report states the outcome:
   MERGEABLE, or FULLY VALIDATED if earned. It also lists every informational or
   unvalidated item, including any visual baseline gap (research R12).

## Risks

| Risk | Mitigation |
|---|---|
| The Desktop simple dialog is unreliable on one OS | Fall back to the extension-host import test plus a platform skip recorded as UNVALIDATED (R5), applied only after diagnosis |
| Visual baselines are missing for the new cases | Follow the existing pinned-reference generation path. Until the baselines exist, the rows are reported unvalidated |
| `editor.component.ts` is large (about 2,900 lines) | Keep image logic in new files (`image-assets.ts`, the properties component). Limit edits to the template branch and the drop handler |
| Base64 size inflation near the budget | The budget is checked on the candidate text before verify, and tests cover the exact limit |
| Existing reports change capability | The roundtrip corpus proves zero bytes change without edits. SC-008 limits the expectation changes |

## Complexity Tracking

No constitution violations. No entries.
