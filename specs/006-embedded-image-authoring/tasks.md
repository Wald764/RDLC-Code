---

description: "Task list for feature 006 — Embedded Image Component Authoring"
---

# Tasks: Embedded Image Component Authoring

**Input**: Design documents in `specs/006-embedded-image-authoring/`: [plan.md](plan.md),
[spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: These are required. FR-028 and constitution principle VII call for unit,
integration, Desktop E2E and visual coverage. Write each story's test tasks first, and
check that they fail before you implement.

**Delivery**: One branch (`feat/006-embedded-image-authoring`), one PR at the end. Tasks
are grouped into **batches B0–B10**. Each batch ends with a *gate task*, which covers:

1. **Targeted QA by `general`**: `pnpm qa:quick` or `pnpm qa:integration` as stated. The
   report states the exact commands and results.
2. **Independent review by `quality-review`**: the reviewer receives the batch tasks,
   changed files and QA evidence. Every CRITICAL or HIGH finding is fixed by `implement`
   and re-verified.
3. **One local commit**: format `:gitmoji: type(scope): description`, with the
   `Co-Authored-By` trailer required by the session. The commit is not pushed.

Desktop, visual and package suites run in GitHub Actions only, unless the user requests a
local run (`docs/validation/qa-policy.md`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: The task can run in parallel, because it touches different files and depends on
  no incomplete task.
- **[Story]**: The user story the task belongs to, from US1 to US5 in spec.md.

## Shared conventions (apply to every task)

- **Specification reading**: read only the cited `vendor/02-structures/*.md` sections.
  Never read `vendor/` exhaustively (constitution V).
- **Limits**: use the constants from `packages/report-model/src/images.ts`, defined as
  `rawImageLimit = 5 * 1024 * 1024`, `dimensionLimit = 16384` and
  `pixelLimit = 40_000_000`. Never use literal values.
- **Payload leak rule**: image payloads (base64 or bytes) MUST NOT appear in diagnostics,
  logs, scene objects, view labels, tooltips or error messages (FR-025). Each test that
  produces such output asserts that the output contains no payload substring.
- **Edits**: every report mutation goes through a `PatchPlan` produced in
  `packages/xml-serializer`, which is verified and applied as one `WorkspaceEdit` by
  `apps/vscode-extension/src/document-session.ts`. That makes it one native undo step.
- **Byte identity**: byte-identity assertions reuse the helpers pattern of
  `tests/roundtrip/textboxes.test.ts` (`snapshotOf`, `apply`, `assertSinglePatch`).

---

## Phase 1: Setup (Batch B0: fixtures and coverage loader)

**Purpose**: create the shared fixture corpus and multi-feature coverage support.

- [X] T001 [P] Create the deterministic fixture generator `scripts/fixtures/generate-images.ts`.
  - It uses no dependency: `node:zlib` for PNG deflate and a hand-written CRC-32.
  - It writes these files to `tests/fixtures/images/pictures/`:
    - `logo.png`: 120×40 RGBA.
    - `photo.jpg`: a 200×150 baseline JPEG, committed as a minimal valid file.
    - `progressive.jpg`: an SOF2 JPEG.
    - `spoofed.png`: JPEG bytes under a `.png` name.
    - `truncated.png`: `logo.png` cut before `IEND`.
    - `bad-crc.png`: one IDAT byte flipped.
    - `huge-dims.png`: valid chunks with an `IHDR` of 16385×10.
    - `mega-pixels.png`: an `IHDR` of 8000×5001.
    - `gif.gif`: a minimal GIF.
  - The generator documents that `over-5mib.jpg` is built at test time and never committed.
- [X] T002 [P] Create RDL 2016/01 fixture reports in `tests/fixtures/images/`. Model them on
  `tests/fixtures/textboxes/supported.rdlc` (one section, one Body).
  - `blank.rdlc`: no `EmbeddedImages`.
  - `authored.rdlc`:
    - definitions `logo` (PNG) and `photo` (JPEG), plus `unused` (PNG, no reference);
    - four body `Image` items, one per Sizing mode;
    - one item with an unknown child element and a foreign-namespace attribute.
  - `preserved.rdlc`:
    - External, Database and expression-`Value` items;
    - GIF, BMP and `image/x-png` definitions;
    - malformed base64;
    - a missing-definition reference;
    - an image inside a Tablix cell.
  - `collision.rdlc`: a definition named `logo` whose PNG content differs from `logo.png`.
  - `many.rdlc`: 50 definitions and 50 items, emitted by the T001 generator.
- [X] T003 Register every T002 fixture with its capabilities in `tests/fixtures/manifest.json`.
  Then run the existing check in `tests/compatibility/manifest.test.ts` to verify it.
- [X] T004 Generalize the coverage loader in `tests/desktop/coverage-assertions.ts`.
  - It loads every `tests/desktop/coverage*.json` (the existing `coverage.json` stays as is)
    and validates each file against its own `authority`.
  - Add a case to `tests/desktop/coverage-assertions.test.ts` proving that two coverage
    files are both checked.
- [X] T005 **Gate B0**. Run `pnpm qa:quick`. Then run the review. Then commit
  `:white_check_mark: test(fixtures): add embedded image fixture corpus and multi-file coverage loading`.

---

## Phase 2: Foundational (Batches B1–B3: blocking prerequisites)

**Purpose**: picture validation, image projection and the display pipeline. US1, US2 and
US5 all depend on them. ⚠️ No story work starts until T027 is done.

### Batch B1: Format, limits and names

- [X] T006 [P] Write the failing tests first in `packages/validation/src/images.test.ts`.
  - Every T001 picture, with its expected result or refusal code:
    - `IMAGE_FORMAT_UNSUPPORTED`: `spoofed.png` is accepted as JPEG; `gif.gif` is refused.
    - `IMAGE_DATA_INVALID`: `truncated.png`, `bad-crc.png`.
    - `IMAGE_PIXELS_EXCEEDED`: `huge-dims.png`, `mega-pixels.png`.
  - Exact-limit and limit+1 cases for `rawImageLimit`, `dimensionLimit` and `pixelLimit`.
  - Refusal results that carry `{code, limit, actual, fileName}` and no content.
  - `decodeImageData` on whitespace-wrapped base64, and its refusal on invalid characters.
  - `allocateDefinitionName`:
    - `logo.png` gives `logo`, then `logo_1`;
    - `"2 my logo!.png"` gives a stem starting with a letter;
    - an empty or non-ASCII-only stem gives `Image`;
    - names are case-sensitive.
- [X] T007 [P] Create `packages/report-model/src/images.ts` and export it from the package
  index. It contains:
  - the limit constants (see shared conventions);
  - `ImageReason = 'format-unsupported' | 'data-invalid' | 'too-large' | 'pixels-exceeded' | 'mime-mismatch' | 'value-expression'`;
  - `ImageSizing = 'AutoSize' | 'Fit' | 'FitProportional' | 'Clip'`;
  - `ValidatedPicture = { format, mime, bytes: Uint8Array, pixels, hash, fileStem }`;
  - `ImageRefusal = { code, limit?, actual?, fileName }`;
  - `ImageAsset = { key, mime: 'image/png'|'image/jpeg', data }`;
  - the refusal code constants listed in [data-model.md](data-model.md#validation-rules-summary).
- [X] T008 [P] In `packages/xml-parser/src/parser.ts`, export the 16 MiB string-length and
  UTF-8 byte budget constants (lines 20-24) under named exports. This changes no behavior.
- [X] T009 Implement `packages/validation/src/images.ts` so that T006 passes. It provides:
  - `sniffFormat`, `crc32`, `walkPng` and `walkJpeg`, which together do the following:
    - PNG: `IHDR` first, `IEND` last, every CRC valid.
    - JPEG: walk the markers to SOF0–SOF15, excluding `C4`, `C8` and `CC`; read the
      dimensions; require a trailing `EOI`.
  - `validatePicture(bytes, fileName, digest)`: checks in the order of
    [contracts/image-import.md](contracts/image-import.md#validation-validatepicturebytes-filename-in-packagesvalidationsrcimagests).
    `digest` is injected, so this package stays free of `node:crypto`.
  - `decodeImageData` and `allocateDefinitionName(fileName, existingDefinitionNames)`,
    which normalizes to an ASCII CLS identifier and appends the suffixes `_1`, `_2`… (research R8).
- [X] T010 **Gate B1**. Run `pnpm qa:quick`. Then run the review. Then commit
  `:sparkles: feat(validation): add PNG and JPEG content validation and image limits`.

### Batch B2: Projection

- [ ] T011 [P] Write the failing tests first in `packages/xml-parser/src/project-images.test.ts`.
  They assert the capability state table in [data-model.md](data-model.md#capability-state-rules):
  - **editable**: `image`, `name`, the geometry keys, `sizing`, `value`, `toolTip`;
  - **geometry-only**: the geometry keys plus `name`;
  - **preservation-only**: `[]`.
  For each item in `authored.rdlc` and `preserved.rdlc`, they also check `reason`,
  `references` counts and `encodedSize`, and that `Sizing` defaults to `AutoSize` when absent.
- [ ] T012 [P] Write the failing tests first in `tests/roundtrip/images.test.ts` and
  `tests/compatibility/images.test.ts`.
  - Roundtrip: open and save with no edit produces byte-identical text for every
    `tests/fixtures/images/*.rdlc`.
  - Compatibility: the projection status and per-item state match the manifest capabilities.
- [ ] T013 Extend `packages/report-model/src/report.ts`.
  - Add `EmbeddedImageDefinition` with the fields `node`, `name`, `nameRange`, `mime`,
    `format`, `encodedSize`, `byteSize`, `pixels`, `hash`, `displayable`, `reason` and
    `references`, as defined in data-model.md.
  - Add `ImageItem` with the fields `node`, `name`, `nameRange`, `context`, `bounds`,
    `boundsRanges`, `source`, `value`, `sizing`, `sizingRange`, `toolTip`, `definition`,
    `capabilities` and `reason`.
  - Add `ReportProjection.images: ImageItem[]` and
    `ReportProjection.embeddedImages: EmbeddedImageDefinition[]`.
- [ ] T014 Implement `projectImages(root, options?: {digest?})` in
  `packages/xml-parser/src/project-images.ts`.
  - Mirror `project-textboxes.ts` for names, bounds and ranges.
  - Use `child`/`children` from `names.ts`.
  - Validate the definition data with `decodeImageData` plus `walkPng`/`walkJpeg` from T009.
  - When `digest` is absent, `hash` is `null`.
- [ ] T015 Wire `projectImages` into `packages/xml-parser/src/project-report.ts`.
  - Body `Image` items that are editable or geometry-only leave `preserved`.
  - Items in a table cell and items that are preservation-only stay preserved.
  - The host passes a SHA-256 `digest` (`node:crypto`) when it projects in
    `apps/vscode-extension/src/document-session.ts`.
- [ ] T016 **Gate B2**. Run `pnpm qa:quick`, which adds the roundtrip and compatibility
  suites. Then run the review. Then commit
  `:sparkles: feat(parser): project embedded images and image items`.

### Batch B3: Display pipeline

- [ ] T017 [P] Write the failing tests first in `packages/renderer/src/render.test.ts`.
  - `authored.rdlc` yields `kind:'image'` items carrying `display.state` `picture` with
    `assetKey`.
  - `preserved.rdlc` yields `placeholder` items with their `reason`.
  - The JSON of the whole scene contains no base64 substring, `data:`, `http`, `file:` or
    `blob:`.
- [ ] T018 [P] Write the failing tests first for the asset channel and the CSP.
  - In `apps/vscode-extension/src/image-assets.test.ts`:
    - each key is sent once per webview;
    - only `image/png` and `image/jpeg` are sent;
    - no asset is sent for non-displayable definitions.
  - In `tests/package/offline.test.ts`: `img-src` equals exactly `${cspSource} blob:`,
    and `data:` is absent.
- [ ] T019 Add an `image` scene item to `packages/report-model/src/scene.ts`:
  `{ id, name, bounds, sizing, display: {state:'picture', assetKey, pixels} | {state:'placeholder', reason}, metadata: {format, pixels, encodedSize}, capabilities }`.
- [ ] T020 Add the image branch to `packages/renderer/src/render.ts`, next to the textbox
  branch (around lines 95-125). It builds the scene item from `ReportProjection.images`.
- [ ] T021 Add the host→webview message `imageAssets {assets: ImageAsset[]}` and its webview
  validator to `packages/report-model/src/protocol.ts`. Keep protocol version 2.
- [ ] T022 Implement `ImageAssetCache` in `apps/vscode-extension/src/image-assets.ts`.
  - It is per webview and keyed by hash.
  - `document-session.ts` sends any new assets right after each `snapshot`, and clears the
    cache when the panel is disposed.
- [ ] T023 Change the CSP in `apps/vscode-extension/src/webview.ts:20` to
  `img-src ${cspSource} blob:`. Leave every other directive unchanged.
- [ ] T024 [P] Update the policy comment in `packages/renderer/src/data.ts:20`. It must say
  that only validated displayable payloads reach the webview, and only through the
  `imageAssets` channel.
- [ ] T025 [P] Create the Blob URL cache in `apps/designer/src/app/editor/image-assets.ts`,
  with `image-assets.spec.ts`.
  - It turns base64 into a `Blob` and an object URL.
  - It revokes an object URL when no scene item references its key any longer.
  - When `HTMLImageElement.decode()` fails, it marks the key undecodable.
- [ ] T026 Render image items in `apps/designer/src/app/editor/editor.component.html`,
  `.scss` and `.ts`. Sizing uses the CSS of research R7:
  - `Fit`: `object-fit: fill`.
  - `FitProportional`: `object-fit: contain`.
  - `Clip`: `object-fit: none; object-position: 0 0`, with overflow hidden.
  - `AutoSize`: the natural size × zoom at 96 DPI, anchored top-left, with the declared
    bounds frame kept.
  Placeholders show a reason label from T058. An undecodable picture shows the
  `data-invalid` placeholder. Selection handles and focus stay generic. Add designer
  `editor.component.spec.ts` cases for each sizing class.
- [ ] T027 **Gate B3**. Run `pnpm qa:quick`, then `pnpm qa:integration`, because the
  extension is affected. Then run the review. Then commit
  `:sparkles: feat(designer): display embedded images through an isolated asset channel`.

**Checkpoint**: Existing images are projected and displayed (as a picture or a
placeholder), and nothing can be authored yet.

---

## Phase 3: User Story 1: Insert a Local Image (Priority: P1) 🎯 MVP

**Goal**: Insert a local PNG or JPEG from the toolbox, by click or drop, as one atomic undo step.

**Independent Test**:
1. Open `blank.rdlc` and insert `logo.png`, then `photo.jpg`.
2. Check that there is one `EmbeddedImages` collection, with two definitions and two items.
3. Check that the unrelated bytes are unchanged.
4. Check that one Undo removes each insertion completely.
5. Check that cancelling the file chooser and every refusal leave the text and the history
   unchanged.

### Batch B4: Creation plan and host import

- [ ] T028 [P] [US1] Write the failing tests first in `packages/xml-serializer/src/images.test.ts`
  for `planCreateImage`.
  - When `EmbeddedImages` is absent, it is created as the last child of `Report`.
  - When `EmbeddedImages` exists, the new entry is appended and existing entries stay
    byte-identical.
  - When the definition is reused, only the item is written.
  - The item XML exactly matches the
    [new image item](contracts/image-import.md#new-image-item) in the contract, including
    `Sizing` = `FitProportional`.
  - `Body/ReportItems` is created when absent.
  - The result is one composed plan, and the text outside the footprint is byte-identical.
- [ ] T029 [P] [US1] Write the failing tests first in `tests/vscode/images.test.ts`. They use
  a `FakeImageSource` and the helpers in `tests/vscode/suite.ts` and `session-checks.ts`.
  - Insert PNG, then JPEG.
  - One undo and one redo.
  - Cancel: no edit and no history entry.
  - The refusal corpus, including `over-5mib.jpg` generated at test time: `stat` refuses
    it without calling `readFile`.
  - `IMAGE_REPORT_BUDGET`, using a fixture padded to just under 16 MiB at test time.
  - Deduplication: inserting `logo.png` twice reuses the definition.
  - Read-only file system and untrusted workspace: the file chooser is never invoked.
  - A stale snapshot: the text changes during the pending import, and the plan applies to
    the latest version.
  - The new item is selected and the document becomes dirty.
- [ ] T030 [P] [US1] Write the failing tests first for the protocol in
  `packages/report-model/src/protocol.test.ts` (create the file if it is absent).
  - `createImage` accepts only `placement`, `left`, `top` and `definition`.
  - A `path`, `uri`, `data` or `bytes` field produces a `protocolError`.
- [ ] T031 [US1] Implement `planCreateImage(root, {definition?: {name, mime, base64}, item: {name, value, top, left, height, width}})`
  in `packages/xml-serializer/src/images.ts`.
  - Use `element`, `insertChild` and `composePlans` from `structure.ts`.
  - Use `escapeText` and `escapeAttribute` from `textboxes.ts`.
  - Follow the shape of `planCreateTextbox` in `authoring.ts:31-50`.
- [ ] T032 [US1] Add the `createImage` intent to `packages/report-model/src/editing.ts`
  (`authoringFields`, `EditIntent`) and validate it in `packages/report-model/src/protocol.ts`
  `validateMessage`.
- [ ] T033 [US1] Create `apps/vscode-extension/src/image-import.ts`.
  - `interface ImageSource { pick(): Promise<{uri, fileName} | 'cancelled'>; stat(uri): Promise<number>; read(uri): Promise<Uint8Array> }`.
  - A default implementation, which calls `vscode.window.showOpenDialog` with
    `{canSelectMany:false, filters:{Images:['png','jpg','jpeg']}}`, then
    `workspace.fs.stat` and `workspace.fs.readFile`.
  - `runImport(source, digest)`, which follows the state machine in
    [data-model.md](data-model.md#imageimportrequest-host-transient).
  - A read failure produces `IMAGE_READ_FAILED` and carries the file name only.
- [ ] T034 [US1] Inject `ImageSource` into `apps/vscode-extension/src/document-session.ts`,
  using the same constructor-dependency pattern as `applyWorkspaceEdit` (line 106), with
  the vscode implementation as the default. Apply the existing trust and writability gate
  (lines 558-559) before `pick()` is ever called.
- [ ] T035 [US1] Add the `createImage` branch to `apps/vscode-extension/src/edit-controller.ts`.
  - Run the import; the definition is only used when it is given and displayable.
  - After the await, re-read the latest accepted snapshot.
  - Deduplicate by hash.
  - Allocate the definition name with `allocateDefinitionName`.
  - Allocate the item name with `nextName('Image', reportItemNames(root))`.
  - Compute the size: natural pixels at 96 DPI, in the unit convention of `planCreateTextbox`.
    Scale the width down to `bodyWidth − left` while keeping the aspect ratio, and keep
    the existing minimum item size.
  - Check the candidate text against the T008 budget, which refuses with `IMAGE_REPORT_BUDGET`.
  - Run `verify`, and set `created = {element:'Image', name}`.
- [ ] T036 [US1] **Gate B4**. Run `pnpm qa:integration` (one extension-host run). Then run
  the review. Then commit `:sparkles: feat(extension): import local images as embedded report images`.

### Batch B5: Toolbox insertion

- [ ] T037 [P] [US1] Update the tests first.
  - In `packages/report-model/src/components.test.ts:24`, Image becomes `creatable === true`
    with no reason.
  - In `apps/designer/src/app/editor/components-catalog.component.spec.ts`, Image is
    draggable and its click emits `createImage`.
- [ ] T038 [US1] In `packages/report-model/src/components.ts`, add `'image'` to
  `CreationKind` and mark Image creatable (lines 1 and 26-29). Remove the "unavailable"
  reason.
- [ ] T039 [US1] In `packages/report-model/src/navigation.ts`, add `'image'` to `CreateKind`
  and accept it in `validateNativeAction`.
- [ ] T040 [US1] Route Image insertion in the designer, in
  `apps/designer/src/app/editor/components-catalog.component.ts` and `editor.component.ts`,
  reusing the existing textbox creation path:
  - a click sends `createImage {placement:'default'}`;
  - a drop onto the body sends `createImage {placement:'drop', left, top}`.
- [ ] T041 [US1] In `apps/vscode-extension/src/sidebar/views.ts` (around lines 190-200), map
  the native Components activation of Image to `createImage {placement:'default'}`.
- [ ] T042 [US1] Update `tests/desktop/components.spec.ts`.
  - Remove Image from the unavailable-kind lists and from `US4.5-unavailable-kinds`
    (around lines 55, 66 and 1372).
  - Keep every other unavailable kind unchanged (SC-008).
- [ ] T043 [US1] **Gate B5**. Run `pnpm qa:integration`. Then run the review. Then commit
  `:sparkles: feat(designer): enable Image insertion from the Components toolbox`.

**Checkpoint**: MVP. Images can be inserted, displayed and undone.

---

## Phase 4: User Story 2: Arrange and Manage Image Items (Priority: P1)

**Goal**: Image items can be selected, moved, resized, deleted, copied, pasted and
duplicated like other items, including in a cross-report paste.

**Independent Test**: In `authored.rdlc`, apply each manipulation with the pointer and with
the keyboard. Each one is one undo step. Deletion keeps the definition. A paste into
`blank.rdlc` or `collision.rdlc` carries the definition: an identical one is reused and a
colliding name is renamed.

### Batch B6: Manipulation and clipboard

- [ ] T044 [P] [US2] Write the failing tests first in `tests/roundtrip/arrangement.test.ts`.
  - Move, resize and delete on image items change only `Top`/`Left`/`Height`/`Width`, or
    remove only the `Image` element.
  - `EmbeddedImages` stays byte-identical after a deletion.
- [ ] T045 [P] [US2] Write the failing tests first for the clipboard.
  - In `packages/validation/src/clipboard.test.ts`, `reconcileImages` covers the reuse,
    insert and rename-on-collision cases.
  - In `tests/roundtrip/clipboard.test.ts`, a same-report paste writes no definition.
  - In `tests/vscode/clipboard.test.ts`:
    - a cross-report paste `authored`→`blank` inserts the definition once;
    - a paste `authored`→`collision` gives `logo_1`, with the pasted `Value` rewritten;
    - a capture over `captureBudget` is refused with the existing budget error;
    - each operation is one undo step.
- [ ] T046 [US2] Make image items targetable by layout and deletion.
  - Add `validateImageCapability` in `packages/validation/src/images.ts`, mirroring
    `validateTextboxCapability` in `textboxes.ts:227`.
  - Make the item lookup in `apps/vscode-extension/src/edit-controller.ts` include
    `projection.images`, so that `LayoutIntent` and `planLayout`
    (`packages/xml-serializer/src/layout.ts:21`) and `planRemoval` accept them.
- [ ] T047 [US2] Treat image items like other items in the designer
  (`apps/designer/src/app/editor/selection.ts`, `manipulation.ts` and `editor.component.ts`):
  - they take part in selection and multi-selection;
  - they move and resize with the keyboard and accept snapping;
  - their accessible name is `Image {name}`.
  Add `.spec.ts` cases for these behaviors.
- [ ] T048 [US2] In `packages/report-model/src/clipboard.ts`, add
  `EmbeddedImageRequirement = {name, hash, mime, xml}` and `Capture.images`.
- [ ] T049 [US2] In `apps/vscode-extension/src/clipboard.ts`, extend the capture.
  - Collect the exact `EmbeddedImage` source and the hash of every definition referenced
    by a captured image item.
  - Count the requirements against `captureBudget`.
- [ ] T050 [US2] In `packages/validation/src/clipboard.ts`, implement
  `reconcileImages(requirements, targetDefinitions)`. It returns `{reuse, insert, rename: Map<old,new>}`
  and uses `allocateDefinitionName` for renames.
- [ ] T051 [US2] Extend `planInsertion` and `transformRoot` in
  `packages/xml-serializer/src/clipboard.ts`.
  - Apply the rename map to the constant `Value` of pasted `Image` elements.
  - Compose the `EmbeddedImages` inserts into the same plan (via `composePlans`).
- [ ] T052 [US2] Wire the reconciliation in the host paste path
  (`apps/vscode-extension/src/clipboard.ts`, `planInsertion` use near line 460).
  - A same-document paste writes no definitions.
  - Duplicate follows the same path.
- [ ] T053 [US2] **Gate B6**. Run `pnpm qa:integration`. Then run the review. Then commit
  `:sparkles: feat(clipboard): copy, paste and duplicate image items with their definitions`.

**Checkpoint**: US1 and US2 work independently.

---

## Phase 5: User Story 5: Preserve Unsupported and Existing Images (Priority: P1)

**Goal**: Images that are not editable stay byte-identical and show a reasoned placeholder.
Existing embedded items can be edited while their unknown content is preserved.

**Independent Test**: With `preserved.rdlc` and `authored.rdlc`, make unrelated edits and
save. All image text stays byte-identical. Each placeholder shows its reason. Nothing is
fetched.

### Batch B7: Preservation hardening

- [ ] T054 [P] [US5] Write the failing tests first in `tests/roundtrip/images.test.ts`.
  - On both fixtures, apply unrelated edits (a textbox text edit, a move of a non-image
    item, a textbox insert, an image insert).
  - Assert that every `Image` and `EmbeddedImage` source range, the unknown children and
    the foreign-namespace attributes are byte-identical.
- [ ] T055 [P] [US5] Write the failing tests first in `tests/compatibility/images.test.ts`.
  They assert the placeholder reason for each preserved item: `source-preserved`,
  `value-expression`, `format-unsupported`, `mime-mismatch`, `data-invalid` and
  `reference-missing`.
- [ ] T056 [P] [US5] Write the failing tests first in `tests/vscode/images.test.ts`.
  - Moving and resizing the existing `authored.rdlc` item that has an unknown child keeps
    that child byte-identical.
  - An item that references a missing definition is geometry-only and can be moved.
  - A preservation-only item refuses mutation with the existing diagnostic.
- [ ] T057 [US5] Complete the reason and capability mapping in
  `packages/xml-parser/src/project-images.ts`. It must cover `image/x-png`, a MIME/content
  mismatch, an expression `MIMEType` and the geometry-only state.
- [ ] T058 [US5] Add `imageReasonLabel(reason)` to `packages/report-model/src/images.ts`.
  It returns human-readable placeholder and diagnostic text with no payload, and is used by
  the designer placeholder from T026.
- [ ] T059 [US5] Add a test to `packages/renderer/src/render.test.ts` and
  `packages/xml-parser/src/project-images.test.ts`. Projecting and rendering
  `preserved.rdlc` must produce no URL, resolve no path and evaluate no expression
  (FR-024). Assert this on the output objects.
- [ ] T060 [US5] **Gate B7**. Run `pnpm qa:integration`. Then run the review. Then commit
  `:white_check_mark: test(roundtrip): prove preservation of unsupported and existing images`.

---

## Phase 6: User Story 3: Edit Image Properties in the Inspector (Priority: P2)

**Goal**: Edit Name, geometry, Sizing, the referenced definition and ToolTip, and replace
the picture with a scope choice.

**Independent Test**: In `authored.rdlc`, change each property. Each change touches only its
element, is one undo step, and an invalid value is refused.

### Batch B8: Inspector

- [ ] T061 [P] [US3] Write the failing tests first in `packages/xml-serializer/src/images.test.ts`.
  - `planImageProperty` for `sizing`, `value`, `toolTip` and `name`: a scalar replace when
    the element is present, an inserted element when it is absent, and `ToolTip` removed
    when it is set to an empty value.
  - `planReplacePicture` with `item` scope: a new definition and a repoint of this item only.
  - `planReplacePicture` with `all` scope: `ImageData` and `MIMEType` rewritten in place.
- [ ] T062 [P] [US3] Write the failing tests first in `packages/validation/src/images.test.ts`
  for `validateImageProperty`.
  - Sizing must be one of `AutoSize | Fit | FitProportional | Clip`.
  - Value must name an existing displayable definition.
  - Name goes through the existing `validateName`, which refuses duplicate and
    non-CLS-compliant names.
  - A ToolTip value is accepted and escaped.
  - Invalid values produce `IMAGE_PROPERTY_INVALID`.
- [ ] T063 [P] [US3] Write the failing tests first in
  `apps/designer/src/app/properties/image-properties.component.spec.ts`.
  - The fields are rendered.
  - The read-only metadata (format, pixels, encoded size) contains no payload.
  - "Replace for this item" and "Replace for all N items" both appear when the reference
    count is greater than 1.
  - A ToolTip expression is shown as inert text.
- [ ] T064 [P] [US3] Write the failing tests first in `tests/vscode/images.test.ts`.
  - Every property intent is one undo step.
  - Replace with `item` scope and with `all` scope.
  - An invalid value leaves the text unchanged.
- [ ] T065 [US3] Implement `planImageProperty` in `packages/xml-serializer/src/images.ts`,
  using `setScalar`, `insertChild` and `renameNode` from `structure.ts`.
- [ ] T066 [US3] Implement `planReplacePicture` in `packages/xml-serializer/src/images.ts`.
- [ ] T067 [US3] Implement `validateImageProperty` in `packages/validation/src/images.ts`.
- [ ] T068 [US3] Add the `setImageProperty` and `replaceImagePicture` intents to
  `packages/report-model/src/editing.ts` and validate them in `protocol.ts`, as defined in
  [image-protocol.md](contracts/image-protocol.md).
- [ ] T069 [US3] Dispatch both intents in `apps/vscode-extension/src/edit-controller.ts`.
  Replace reuses `runImport` from T033, and a removed target produces `IMAGE_TARGET_STALE`.
- [ ] T070 [US3] Create `apps/designer/src/app/properties/image-properties.component.{ts,html,scss}`.
  - The fields are Name, Left, Top, Width, Height, Sizing, the definition picker (from the
    report's displayable definitions) and ToolTip, plus the read-only metadata from the
    scene's `metadata`.
  - Geometry fields send the existing `LayoutIntent`.
- [ ] T071 [US3] Route `kind:'image'` to `rdlc-image-properties` in
  `apps/designer/src/app/editor/contextual-inspector.component.ts` (near lines 83-92).
- [ ] T072 [US3] **Gate B8**. Run `pnpm qa:integration`. Then run the review. Then commit
  `:sparkles: feat(designer): edit image properties in the inspector`.

---

## Phase 7: User Story 4: Find Images in Report Structure and Report Data (Priority: P2)

**Goal**: Report Structure lists image items. Report Data lists definitions with their
metadata and reference counts, and supports rename, remove and insert-existing.

**Independent Test**: In `authored.rdlc`:
- the views list the items and definitions with correct counts;
- renaming `logo` rewrites every constant reference in one step;
- removing `unused` succeeds, and removing `logo` is blocked with the referencing items listed;
- "insert" adds an item without opening the file chooser.

### Batch B9: Sidebar views

- [ ] T073 [P] [US4] Write the failing tests first.
  - In `packages/renderer/src/structure.test.ts`, `Image` items get kind `image` and appear
    in source order with their capability state.
  - In `packages/renderer/src/data.test.ts`:
    - definitions have format, encoded size, pixels, reference count and context values;
    - no label or tooltip contains a payload.
- [ ] T074 [P] [US4] Write the failing tests first in `packages/xml-serializer/src/images.test.ts`.
  - `planRenameDefinition` renames the definition and all constant references in one
    composed plan.
  - `planRemoveDefinition` produces a single removal.
- [ ] T075 [P] [US4] Write the failing tests first in `tests/vscode/sidebar-data.test.ts`.
  - The `imageRename`, `imageRemove` and `imageInsert` commands, including their blocked
    cases (an expression reference; a referenced definition).
  - In `tests/vscode/sidebar-context.test.ts`, activating an image node reveals and selects
    it on the canvas.
- [ ] T076 [US4] Add `'image'` to `NavigationNode['kind']` in
  `packages/report-model/src/navigation.ts`, and map `Image: 'image'` in
  `packages/renderer/src/structure.ts` (lines 15-27).
- [ ] T077 [US4] Extend the embedded-image metadata in `packages/renderer/src/data.ts`
  (around line 295) with reference counts and the context values
  `dataEmbeddedImage.displayable`, `.referenced` and `.unreferenced`.
- [ ] T078 [US4] Implement `planRenameDefinition` and `planRemoveDefinition` in
  `packages/xml-serializer/src/images.ts`.
- [ ] T079 [US4] Implement `validateDefinitionMutation` in `packages/validation/src/images.ts`.
  It returns `IMAGE_RENAME_BLOCKED` or `IMAGE_REMOVE_BLOCKED` together with the list of
  blocking items.
- [ ] T080 [US4] Add the `renameEmbeddedImage` and `removeEmbeddedImage` intents to
  `packages/report-model/src/editing.ts` and `protocol.ts`, and dispatch them in
  `apps/vscode-extension/src/edit-controller.ts`.
- [ ] T081 [US4] In `apps/vscode-extension/src/sidebar/views.ts`, give image nodes the
  `file-media` ThemeIcon and their context values (`structureContextValue`, line 875).
- [ ] T082 [US4] Add the image commands.
  - Register `rdlcCode.sidebar.imageInsert`, `imageRename` (`showInputBox` with name
    validation) and `imageRemove` in `apps/vscode-extension/src/sidebar/actions.ts`.
  - Contribute the commands and menus in `apps/vscode-extension/package.json`.
- [ ] T083 [US4] **Gate B9**. Run `pnpm qa:integration`. Then run the review. Then commit
  `:sparkles: feat(sidebar): list and manage images in Report Structure and Report Data`.

---

## Phase 8: Polish and Cross-Cutting (Batch B10: E2E, visual, offline, docs), then the final PR

- [ ] T084 [P] In `tests/desktop/driver.ts`, set `"files.simpleDialog.enable": true` in the
  provisioned user settings, and add a `chooseFile(page, absolutePath)` helper that drives
  the quick-input dialog (research R5).
- [ ] T085 Create `tests/desktop/images.spec.ts` with one journey per story. They are critical
  by default:
  - `US1-insert-undo`: click and drop, PNG and JPEG, cancel, one refusal, Undo and Redo,
    source-byte checks. It also records the elapsed time as SC-001 evidence.
  - `US2-manipulate`: pointer and keyboard move and resize, delete, copy and paste,
    duplicate, cross-report paste.
  - `US3-inspector`: Sizing, the definition picker, ToolTip, replace scope.
  - `US4-views`: Structure reveal, Data rename, remove and insert.
  - `US5-preserve`: open `preserved.rdlc`, make an unrelated edit and save, then check
    byte identity and the placeholders.
  - `SC-006-timing`: on `many.rdlc`, the selection and move feedback takes 100 ms or
    less, and a 5 MiB picture appears in less than 1 s.
- [ ] T086 [P] Add these cases to `tests/desktop/visual.spec.ts`:
  `US-IMG-sizing-AutoSize`, `US-IMG-sizing-Fit`, `US-IMG-sizing-FitProportional`,
  `US-IMG-sizing-Clip` and `US-IMG-placeholder`.
  - Use `authored.rdlc` and `preserved.rdlc` through the manifest ids.
  - Follow the existing pinned-reference baseline process (`--update-baselines` on the
    reference image) and document the generation step in the PR.
- [ ] T087 [P] Add the image fixtures to the existing fixture loops of
  `tests/desktop/offline.spec.ts` and `tests/desktop/security-observer.spec.ts`.
  - Allow only the user-chosen import file read in `tests/desktop/security-observer.ts`,
    and leave every other rule unchanged.
  - Assert zero network requests (SC-004).
- [ ] T088 [P] In `tests/desktop/qa-classification.ts`, classify
  `images.spec.ts::SC-006-timing` as informational for the latency-budget signature only,
  with the justification "Runner speed is not a product defect", mirroring `SC-003-timing`.
  Cover it in `qa-classification.test.ts`.
- [ ] T089 [P] Create `tests/performance/images.test.ts`. For `many.rdlc`, the projection
  and the scene render stay within a budget recorded in the test, and the payload is never
  copied into the scene.
- [ ] T090 Create `tests/desktop/coverage-006.json` following
  [contracts/desktop-validation.md](contracts/desktop-validation.md).
  - Add rows US1.1–US5.4 and SC-001–SC-008, and reference only test titles that now exist.
  - Check it with `tests/desktop/coverage-assertions.test.ts`.
- [ ] T091 [P] Update the documentation in English: the feature list and limits in
  `README.md`, the CSP and isolation note in `docs/` where isolation is described, and
  `THIRD_PARTY_NOTICES.md`, which needs no change because no dependency was added (state
  this in the PR).
- [ ] T092 **Gate B10**.
  1. `general` runs `pnpm qa:integration` on the final HEAD.
  2. `quality-review` runs a feature-wide review against spec.md, plan.md, the contracts and
     `git diff main...HEAD`.
  3. Commit `:white_check_mark: test(desktop): cover embedded image journeys, visuals and isolation`.
- [ ] T093 Push `feat/006-embedded-image-authoring` and open **one** PR to `main`.
  - The body includes the summary, the batch list B0–B10 and the locally verified evidence
    with commands.
  - It states that Desktop, visual and stability checks are CI-validated, and lists any
    known unvalidated items.
  - It ends with the required attribution line.
- [ ] T094 Monitor CI for the PR's candidate SHA and read `qa-summary-<sha>`.
  - Diagnose each failure before re-running anything.
  - Fix it on the same branch (`implement` → targeted `general` → review if the fix is
    substantive), then push.
  - Do **not** merge or publish.
  - Report MERGEABLE or FULLY VALIDATED, plus every informational or unvalidated item.

---

## Dependencies and Execution Order

### Phase and batch dependencies

```text
B0 (Setup) → B1 → B2 → B3 (Foundational)
          → B4 → B5 (US1, MVP)
          → B6 (US2)       [needs B4]
          → B7 (US5)       [needs B4; B6 for move of existing items]
          → B8 (US3)       [needs B4, B5]
          → B9 (US4)       [needs B4; independent of B6–B8]
          → B10 (Polish)   [needs all] → PR → CI
```

### User story dependencies

- **US1 (P1)**: needs only the Foundational phase.
- **US2 (P1)**: needs US1's host dispatch (T035) for the item lookup. It can be tested
  independently on `authored.rdlc`.
- **US5 (P1)**: needs the Foundational phase. Its existing-item edit tests reuse the US2
  layout targeting (T046).
- **US3 (P2)**: needs the import (T033) to replace a picture.
- **US4 (P2)**: needs the Foundational phase and T033 to insert an existing definition. It
  is independent of US2 and US3.

### Shared-file serialization (no parallel edits)

These files are edited by several batches. Edit them strictly in batch order, and commit a
batch before the next one touches them:

- `packages/report-model/src/editing.ts`, `protocol.ts`
- `packages/xml-serializer/src/images.ts`, `packages/validation/src/images.ts`
- `apps/vscode-extension/src/edit-controller.ts`, `document-session.ts`, `sidebar/views.ts`
- `apps/designer/src/app/editor/editor.component.ts`
- `tests/vscode/images.test.ts`, `tests/roundtrip/images.test.ts`

### Parallel opportunities

- **B0**: T001 ∥ T002 (generator vs. hand-written reports).
- **B1**: T006 ∥ T007 ∥ T008.
- **B2**: T011 ∥ T012.
- **B3**: T017 ∥ T018 ∥ T024 ∥ T025.
- In every story, the test-first tasks marked [P] run in parallel before implementation.
- **B9 ∥ B6–B8**: possible only after B5, and only if the shared files are serialized. By
  default, run the batches sequentially.
- **B10**: T084, T086, T087, T088, T089 and T091 run in parallel.

---

## Parallel Example: User Story 1

```text
Task (implement): "T028 planCreateImage tests in packages/xml-serializer/src/images.test.ts"
Task (implement): "T029 import journey tests in tests/vscode/images.test.ts"
Task (implement): "T030 createImage protocol tests in packages/report-model/src/protocol.test.ts"
```

## Parallel Example: User Story 3

```text
Task (implement): "T061 property/replace plan tests in packages/xml-serializer/src/images.test.ts"
Task (implement): "T062 validateImageProperty tests in packages/validation/src/images.test.ts"
Task (implement): "T063 inspector component spec in apps/designer/src/app/properties/image-properties.component.spec.ts"
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Run B0 to B3 (setup plus foundations): existing images are displayed safely.
2. Run B4 and B5 (US1): insert, display and undo. **Stop and check** with the US1
   Independent Test.

### Incremental delivery (same branch, no intermediate PR)

1. Run B6 (US2), B7 (US5), B8 (US3) and B9 (US4). Each ends with a gate and a commit.
2. Run B10, then open the single PR, then CI. Fix on the branch and never merge
   automatically.

### Orchestration

Opus orchestrates and gives `implement` exact task IDs with their file ownership. `general`
runs only the gate's QA command. `quality-review` reviews each batch without changing files.
A CRITICAL or HIGH finding blocks the commit until it is fixed and re-verified.

## Notes

- 94 tasks. The test-first tasks MUST fail before their implementation tasks run.
- A locally unverified Desktop or visual task is reported as CI-validated or unvalidated,
  never as passed.
