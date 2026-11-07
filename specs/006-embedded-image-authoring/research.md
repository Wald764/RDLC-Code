# Phase 0 Research: Embedded Image Component Authoring

All decisions below were made against the current repository (`main` at `3022042`) and the
vendored MS-RDL sections cited in [spec.md](spec.md). Each entry records the decision, the
rationale and the alternatives rejected. No `NEEDS CLARIFICATION` item remains open.

## R1. Schema element order for new elements

- **Decision**: Append `EmbeddedImages` as the last child of `Report` when absent, append
  new `EmbeddedImage` entries at the end of the existing collection, and write `Image`
  children in the order `Source, Value, Sizing, Top, Left, Height, Width` (then `ToolTip`
  when set). Reuse `insertChild` from `packages/xml-serializer/src/structure.ts`.
- **Rationale**: `Report` (`vendor/02-structures/2.3-report.md`, line 66) and `Image`
  (`vendor/02-structures/2.12-image.md`, line 50) are both `xsd:choice maxOccurs="unbounded"`,
  so child order has no schema meaning. Appending keeps the patch footprint minimal and
  leaves existing entries byte-identical (FR-005).
- **Alternatives**: Schema-ordered insertion helper: rejected because the schema imposes
  no order and it would add an abstraction with no demonstrated need (constitution IV).

## R2. Image format detection and "decodable" content without a dependency

- **Decision**: Add a pure TypeScript module `packages/validation/src/images.ts` that:
  - sniffs the content signature (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`);
  - for PNG, walks every chunk, checks each chunk CRC-32, requires `IHDR` first and `IEND`
    last, and reads width and height from `IHDR`;
  - for JPEG, walks the marker segments up to the first SOF0–SOF15 marker (excluding DHT,
    JPG and DAC), reads width and height, and requires an `EOI` marker at the end of the
    data;
  - enforces the limits (R3) and returns either a `ValidatedPicture` or an `ImageRefusal`.
  The webview decodes the picture again with `HTMLImageElement.decode()`. If that decode
  fails, the item shows the `IMAGE_DATA_INVALID` placeholder; the decode never affects the
  report text.
- **Rationale**: FR-002 and FR-027 rule out a decoder dependency. A structural walk with
  CRC checks catches signature spoofing, truncation and corruption of the container
  deterministically, and is unit-testable in Node. The platform decoder already in the
  webview covers pixel-level decoding (spec Assumptions).
- **Alternatives**: A full PNG/JPEG decoder library: rejected because it is a new runtime
  dependency, the spec forbids it unless justified, and it adds licensing review. A host-side
  `sharp` or native decoder: rejected because it needs a native binary, which breaks the
  offline and portable VSIX. Trusting the file extension: forbidden by FR-002.
- **Documented limitation**: "Decodable" is verified structurally on the host and by the
  platform decoder at display time. A file that passes the structural checks but fails
  platform decoding is stored, if the author imports it, and displayed as a placeholder.
  The tests cover this case.

## R3. Limits and the document budget

- **Decision**: The constants live in `packages/report-model/src/images.ts`:
  `rawImageLimit = 5 * 1024 * 1024`, `dimensionLimit = 16384`,
  `pixelLimit = 40_000_000`. The document budget reuses the existing 16 MiB visual-parsing
  constants in `packages/xml-parser/src/parser.ts:20-24`, exported rather than duplicated.
  The host checks the budget on the candidate text (both string length and UTF-8 bytes)
  before verification, so a refused import never reaches `applyEdit`.
- **Rationale**: These are the spec values (FR-003). They may only be tightened, not
  loosened. 5 MiB of raw data becomes about 6.67 MiB of base64, which stays below the
  clipboard `captureBudget` of 8 MiB (`packages/report-model/src/clipboard.ts`).
- **Alternatives**: Separate limit constants in each package: rejected because they would
  drift apart.

## R4. File chooser and file read (host only)

- **Decision**: Add a host-side `ImageSource` dependency, injected into `DocumentSession`
  the same way `applyWorkspaceEdit` is (`apps/vscode-extension/src/document-session.ts:106`).
  The default implementation calls `vscode.window.showOpenDialog` with
  `{canSelectMany:false, filters:{Images:['png','jpg','jpeg']}}`, then calls
  `workspace.fs.stat`. If the size exceeds `rawImageLimit`, the import is refused before
  any read. Otherwise it calls `workspace.fs.readFile`. The webview never sends a path or
  URI, which keeps the invariant at `apps/vscode-extension/src/protocol.ts:60`. Cancelling
  the dialog returns `cancelled`: there is no edit and no history entry.
- **Rationale**: This keeps file access in the trusted host. It follows the only existing
  dialog pattern (`sidebar/views.ts:218`), and the injection point makes it testable in
  `tests/vscode` without stubbing global VS Code APIs.
- **Alternatives**: `<input type=file>` in the webview: rejected because it moves untrusted
  bytes through the webview and bypasses the host-only file access rule. A stub of
  `showOpenDialog` on the global `vscode.window`: rejected because it is brittle and the
  extension already uses the injection pattern.

## R5. Desktop E2E file selection

- **Decision**: The Desktop tests set the user setting `"files.simpleDialog.enable": true`
  in the provisioned profile. The file chooser then renders as a VS Code quick input, so
  Playwright can type the absolute fixture path and press Enter. No test-only code path is
  added to the extension.
- **Rationale**: This exercises the real `showOpenDialog` integration (constitution VII:
  no mock in place of the user workflow) and needs no product hook.
- **Alternatives**: An environment-variable override of the picker: rejected because a
  test-only branch in shipped code is a security smell. Native OS dialog automation:
  rejected because it is not portable across the CI matrix.
- **Risk**: If the simple dialog proves unreliable on one platform, fall back to an
  extension-host test of the import (tests/vscode) and record the Desktop insertion row
  as `UNVALIDATED` with a platform skip. Decide this only after a CI failure has been
  diagnosed.

## R6. Displaying pictures in the isolated webview

- **Decision**:
  - The scene stays geometry-only. An `image` scene item carries an `assetKey` (a SHA-256
    hex of the decoded bytes) and a display state, never the payload.
  - A new host-to-webview message `imageAssets` delivers `{key, mime, data(base64)}` for
    validated, displayable definitions only. It is sent once per key per webview and
    whenever new keys appear.
  - The webview converts each payload to a `Blob` and an object URL, caches the URL by key,
    and revokes it when no scene item references the key.
  - The CSP in `apps/vscode-extension/src/webview.ts:20` becomes
    `img-src ${cspSource} blob:`. `data:` stays forbidden.
  - The host never sends image types other than `image/png` and `image/jpeg`, and never
    sends SVG.
- **Rationale**: `blob:` URLs can only be minted by the webview's own script from bytes
  the host has validated. They involve no network or file access, so they keep the offline
  and isolation guarantees (FR-016, SC-004). Keeping the payload out of the scene and the
  snapshot avoids re-sending megabytes on every edit and keeps image data out of logs and
  diagnostics (FR-025). The comment at `packages/renderer/src/data.ts:20` ("image
  payloads never leave the host") is updated to the new, narrower rule: only validated
  displayable payloads, only on the asset channel.
- **Alternatives**: `img-src data:`: rejected because it widens the CSP to any inline data
  URL. A host-rendered thumbnail: rejected because it needs a host decoder (R2). The
  payload in the scene: rejected for size and leak-surface reasons.
- **Test impact**: `tests/desktop/offline-assertions.ts` and
  `tests/package/offline.test.ts` keep rejecting `http(s)` traffic and out-of-bundle
  `vscode-resource` paths. One new assertion checks that `img-src` contains exactly
  `cspSource` and `blob:`.

## R7. Sizing-mode rendering (MS-RDL 2.12.18)

- **Decision**: Use CSS on an `<img>` inside the item box:
  - `Fit` uses `object-fit: fill`.
  - `FitProportional` uses `object-fit: contain`, centred.
  - `Clip` uses `object-fit: none` with `object-position: 0 0`, and the box hides overflow.
  - `AutoSize` displays the picture at its natural pixel size × zoom (96 DPI), anchored
    top-left and clipped to the canvas. The declared bounds stay drawn as the selection
    frame, and the report's declared size is never modified.
  - Item boxes and their selection handles keep the existing generic rendering.
- **Rationale**: These mappings are deterministic, need no dependency and can be verified
  in visual tests (SC-007).
- **Alternatives**: Canvas 2D drawing: rejected as unnecessary complexity.

## R8. Identity, deduplication and naming

- **Decision**:
  - **Identity**: two definitions are identical when the SHA-256 of their decoded bytes
    match. Whitespace in existing base64 is ignored when decoding. Hashing uses
    `node:crypto` on the host, which adds no dependency.
  - **Deduplication**: an import or cross-report paste first reuses a displayable
    definition with an identical hash (FR-006, FR-012).
  - **Definition names**: the name stem is the file's base name, normalized to an ASCII
    CLS identifier (letters, digits and `_`, starting with a letter; otherwise the
    fallback `Image`). The first free name of `stem`, `stem_1`, `stem_2`... within the
    report's `EmbeddedImage` names wins.
  - **Item names**: these keep the existing `nextName('Image', reportItemNames(root))`
    (`packages/validation/src/validate.ts:82`, `textboxes.ts:139`). That helper is
    conservative: it also reserves `EmbeddedImage` names, which is harmless.
- **Rationale**: Hashing decoded bytes is robust to base64 line wrapping. The spec's
  example of the `_1` suffix pattern requires a small name allocator alongside
  `uniqueName`.

## R9. Editing model and atomicity

- **Decision**:
  - **Intents**: new intents are added to `EditIntent` in
    `packages/report-model/src/editing.ts`, validated in
    `packages/report-model/src/protocol.ts:validateMessage`, and dispatched in
    `apps/vscode-extension/src/edit-controller.ts`. They follow the existing pattern:
    validate, allocate names, build the plan, then a `verify` closure.
  - **Plans**: multi-location edits (definition plus item, rename plus references,
    replace-all) are built from `composePlans` (`packages/xml-serializer/src/structure.ts:119`)
    and applied as one `WorkspaceEdit`, which is one native undo step
    (`document-session.ts:842-894`).
  - **Moves and resizes**: these reuse the existing `LayoutIntent` and `planLayout` once
    image items carry `boundsRanges` like textboxes.
  - **Deletion**: this reuses the existing removal path (`planRemoval`) and never touches
    `EmbeddedImages` (FR-011).
- **Stale imports**: the file chooser and read are asynchronous. After they resolve, the
  controller re-reads the session's latest accepted snapshot. It refuses the import with
  `IMAGE_TARGET_STALE` if the target item (for a replace) no longer exists, and plans
  against the latest version otherwise. Plans carry `version`, so the existing stale-patch
  rejection still applies.

## R10. Clipboard

- **Decision**: Extend the host-side `Capture` (`packages/report-model/src/clipboard.ts:65`)
  with `images: EmbeddedImageRequirement[]` = `{name, hash, identity, mime, xml, nameRange}`,
  where `xml` is the exact `EmbeddedImage` source and `identity` is the picture hash, or for a
  definition without a displayable picture a digest of its exact source with the `Name` removed.
  Every definition a captured image item references is carried, displayable or not (FR-012).
  Both kinds of paste reuse the same function:
  - **Same report**: the item keeps its `Value`, and no definition is written, because the
    existing definition has the same identity.
  - **Other report**: a definition is reused when the identities match, inserted when the name
    is free, and renamed when a different definition already uses the name. When it is renamed,
    the pasted item's `Value` is rewritten. Names that dangling captured items point at are
    never handed out.
  - **Missing definition**: nothing is invented. If the target defines that name, the paste is
    refused (`IMAGE_DEFINITION_CONFLICT`), so the item cannot silently bind to another picture.
  The definition and the items are inserted in one composed plan. If the capture would
  exceed `captureBudget`, the copy is refused with the existing budget error. Arbitrary
  system clipboard bitmaps are ignored, as they already are today.
- **Rationale**: This follows the existing `DatasetRequirement` model, keeps payloads
  host-side (the OS clipboard only holds the token) and satisfies FR-012.

## R11. Sidebar views

- **Decision**:
  - **Report Structure**: add `Image: 'image'` to the kind map in
    `packages/renderer/src/structure.ts:15-27`, with the `file-media` ThemeIcon and
    `structureContextValue` capability states.
  - **Report Data**: the existing `embedded-image` nodes (`packages/renderer/src/data.ts:295`)
    gain format, encoded size, pixel dimensions and reference count, plus context values
    `dataEmbeddedImage.editable` and `.referenced`.
  - **Commands**: new `rdlcCode.sidebar.imageRename`, `imageRemove` and `imageInsert`,
    registered in `sidebar/actions.ts` and contributed in `apps/vscode-extension/package.json`.
    Rename uses `showInputBox` with the existing name validation. Insert runs the existing
    native create route with the definition name.
  - **Components view**: a new `CreateKind` value `'image'` in
    `packages/report-model/src/navigation.ts`.

## R12. Verification placement and the QA policy

- **Decision**:
  - **Unit tests**: colocated `*.test.ts` files cover format, limits, projection, plans,
    renderer, validation and protocol.
  - **Roundtrip and compatibility**: `tests/roundtrip/images.test.ts` and
    `tests/compatibility/images.test.ts` cover the fixture corpus and byte identity.
  - **Extension host**: `tests/vscode/images.test.ts` covers import with an injected
    `ImageSource`, cancel, refusal, undo and redo, stale and read-only cases, cross-report
    paste and the sidebar commands.
  - **Desktop**: one new focused spec, `tests/desktop/images.spec.ts`, covers the critical
    end-to-end journeys (one test per user story, not a matrix). Image cases are added to
    the existing `visual.spec.ts` (sizing modes and placeholder), `offline.spec.ts` and
    `security-observer.spec.ts`, which reuse their existing fixture loops.
  - **Coverage**: an acceptance coverage file `tests/desktop/coverage-006.json`, with
    authority `specs/006-embedded-image-authoring/`. The loader in `coverage-assertions.ts`
    is generalized to read every `coverage*.json` (Batch 0).
  - **Classification**: new Desktop tests are critical by default. Only an `SC-006-timing`
    latency signature is classified informational in `tests/desktop/qa-classification.ts`,
    with a justification that mirrors `SC-003-timing`.
  - **Local runs**: the Desktop and visual specs run in GitHub Actions only, unless the user
    asks for a focused local run.
- **Open risk**: Visual baselines are generated on the pinned reference image
  (`visual.spec.ts:268-281`), and the suite fails when a baseline is missing. Batch 10 must
  follow the existing baseline-generation path used by features 003–005 before the visual
  rows can pass. Until then, the visual rows remain unvalidated and are reported as such.
