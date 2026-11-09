# Feature Specification: Embedded Image Component Authoring

**Feature Branch**: `main` (current checkout; no branch hook is configured — create a feature branch before implementation)

**Feature Directory**: `specs/006-embedded-image-authoring`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Create the next RDLC-Code feature specification: 006 — Embedded Image Component Authoring. Allow users to create and visually edit embedded images in RDLC reports directly from the designer: import local PNG/JPEG images, store them as embedded report resources, insert them from the Components toolbox, display them accurately on the canvas, support selection, movement, resizing, deletion, copy and duplication, native Undo/Redo, inspector properties, preservation of unsupported images and source definitions, and integration with the Report Structure and Report Data views. Preserve the authoritative report text architecture, reuse the existing parsing, serialization, validation and edit pipeline, preserve unrelated content exactly, avoid new runtime dependencies unless justified, enforce strict resource limits, never fetch external resources or execute expressions/queries, and stay offline. Out of scope: external image URLs, database-backed images, expression-based images, rendering/printing, charts and other unsupported report items."

## Specification References

Report-format semantics come from the vendored MS-RDL Markdown (constitution principle II):

| Topic | Vendored section |
|---|---|
| Image report item, attributes and children | `vendor/02-structures/2.12-image.md` |
| `Image.Source` (`External`, `Embedded`, `Database`) | `vendor/02-structures/2.12.19-image.source.md` |
| `Image.Value` (embedded image name when Source is `Embedded`) | `vendor/02-structures/2.12.20-image.value.md` |
| `Image.Sizing` (`AutoSize` default, `Fit`, `FitProportional`, `Clip`) | `vendor/02-structures/2.12.18-image.sizing.md` |
| `Image.MIMEType` (ignored unless Source is `Database`) | `vendor/02-structures/2.12.17-image.mimetype.md` |
| `Report.EmbeddedImages` collection | `vendor/02-structures/2.3.20-report.embeddedimages.md`, `2.305-embeddedimages.md` |
| `EmbeddedImage` Name, ImageData (base64), MIMEType (constant) | `vendor/02-structures/2.306-embeddedimage.md` |
| Allowed image MIME types | `vendor/02-structures/2.2.10-reportmimetype.md` |

Supported schema for authoring: RDL 2016/01 reports that already qualify for visual authoring (exactly one complete section, understood MustUnderstand namespaces), consistent with features 002–005. Other schema versions remain inspection/source-only; no schema conversion is performed. Authoring support does not imply that any report runtime will render the image identically (constitution Project Constraints).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Insert a Local Image into a Report (Priority: P1)

As a report author, I want to place a logo or picture from my computer into the report body by choosing Image in the Components toolbox, so that I can brand and illustrate reports without editing XML by hand.

**Why this priority**: This is the core value of the feature; without insertion, no other image journey is possible.

**Independent Test**: Open a supported report, activate the Image toolbox entry (click and drag-and-drop), choose a local PNG then a local JPEG, and check that each appears on the canvas, that the report text gains one embedded image definition and one image item per insertion, that unrelated text is byte-identical, and that a single Undo removes each insertion completely.

**Acceptance Scenarios**:

1. **Given** a supported report open in the designer, **When** the author activates the Image entry in the Components toolbox (click or drag onto the body), **Then** a local file chooser opens restricted to PNG and JPEG files, and cancelling it leaves the report unchanged with no entry in the undo history.
2. **Given** the author picks a valid PNG or JPEG within the limits, **When** the import completes, **Then** one image item referencing a new embedded image is added at the drop or default location, the embedded image definition is added to the report's embedded image collection (created if absent), the new item is selected, and the document becomes dirty.
3. **Given** a newly inserted image, **When** the author views the canvas, **Then** the picture itself is displayed within the item bounds using the item's sizing mode, with default dimensions derived from the picture's natural aspect ratio and constrained to fit the available body width.
4. **Given** an insertion just occurred, **When** the author invokes native Undo once, **Then** both the image item and the embedded image definition it introduced are removed and the report text matches its previous state exactly; Redo restores both.
5. **Given** the author picks a file that is not a valid PNG/JPEG, exceeds the size or pixel limits, or would push the report beyond the document size budget, **When** the import is attempted, **Then** it is refused with an actionable message naming the reason and the limit, and the report is unchanged.
6. **Given** the author imports a picture whose content is identical to an embedded image already in the report, **When** the import completes, **Then** the existing embedded definition is reused rather than duplicated.

---

### User Story 2 - Arrange and Manage Image Items on the Canvas (Priority: P1)

As a report author, I want to select, move, resize, delete, copy, paste and duplicate image items exactly as I do with other supported items, so that images are first-class layout elements.

**Why this priority**: Inserted images must be laid out; consistent manipulation is required for the feature to be usable.

**Independent Test**: In a fixture with an authored image, perform each manipulation with pointer and keyboard, then check the resulting report text, the selection state, and that each action is a single native undo step.

**Acceptance Scenarios**:

1. **Given** an image item on the canvas, **When** the author clicks it or reaches it with the keyboard, **Then** it is selected with the same handles, focus indication and accessible name as other supported items; it participates in supported multi-selection.
2. **Given** a selected image, **When** it is moved or resized with pointer or keyboard, **Then** only its position or size values change in the report text, existing snapping/alignment/bounds rules apply, and the displayed picture follows the sizing mode.
3. **Given** a selected image, **When** it is deleted, **Then** the image item is removed; the embedded image definition is retained (it may still be referenced elsewhere or reused), and the definition is reported as unused in Report Data if no item references it.
4. **Given** a selected image, **When** it is copied and pasted, or duplicated, **Then** a new image item with a unique report-item name is created, offset from the original, referencing the same embedded image definition without duplicating the image data.
5. **Given** an image is copied from one report and pasted into a different open report, **When** the paste is applied, **Then** the embedded image definition is carried into the target report (reusing an identical existing definition, renaming on name collision) so that the pasted item is never left with a dangling reference.
6. **Given** any of the above manipulations, **When** the author invokes native Undo/Redo, **Then** each manipulation is reverted/reapplied as exactly one step and the canvas, Report Structure and inspector reflect the restored state.

---

### User Story 3 - Edit Image Properties in the Inspector (Priority: P2)

As a report author, I want to change an image's name, sizing behavior, embedded picture, position, size, tooltip and alternative text in the existing inspector, so that I can fine-tune images without opening the XML.

**Why this priority**: Property editing refines placement and presentation; insertion and layout already deliver a usable MVP without it.

**Independent Test**: Select an authored image, change each exposed property, and confirm the report text changes only the corresponding element, that invalid values are refused with a diagnostic, and that each change is one undo step.

**Acceptance Scenarios**:

1. **Given** a selected authored image, **When** the inspector opens, **Then** it shows Name, Left, Top, Width, Height, Sizing (AutoSize, Fit, FitProportional, Clip), the referenced embedded image (selectable from the report's embedded images), ToolTip and alternative text where an applicable element exists, plus read-only metadata of the picture (format, pixel dimensions, encoded size).
2. **Given** the author changes Sizing, **When** the change is accepted, **Then** the canvas display updates to the new mode (AutoSize displays at natural size, Fit stretches, FitProportional letterboxes, Clip crops at the top-left) and only the Sizing element changes in the text.
3. **Given** the author selects a different embedded image or replaces the picture with a newly imported local file, **When** the change is accepted, **Then** the item references the chosen definition and the canvas updates; replacing a picture used by several items asks whether to update only this item (new definition) or all items using it.
4. **Given** an invalid value (duplicate or non-CLS-compliant name, negative size, unknown sizing mode), **When** the author applies it, **Then** it is refused using the existing validation diagnostics and the report is unchanged.
5. **Given** a ToolTip value that is an expression, **When** it is displayed, **Then** it is shown as inert text and never evaluated.

---

### User Story 4 - Find Images in Report Structure and Report Data (Priority: P2)

As a report author, I want image items listed in Report Structure and embedded image definitions listed in Report Data with their usage, so that I can navigate to images and manage the embedded resources.

**Why this priority**: Navigation and resource management build on feature 005's views; useful but not required for basic authoring.

**Independent Test**: Open a fixture containing authored images, an unused embedded definition, and preserved non-embedded images; check view contents, activation behavior, and rename/remove actions on definitions.

**Acceptance Scenarios**:

1. **Given** a report with image items, **When** Report Structure is expanded, **Then** each image item appears in source order with an image icon, its name and its capability state (editable or preservation-only); activating an editable one selects and reveals it on the canvas.
2. **Given** a report with embedded image definitions, **When** Report Data is opened, **Then** each definition is listed with its name, format, encoded size and number of referencing items; no image payload appears in labels, tooltips or logs.
3. **Given** an embedded image definition, **When** the author renames it, **Then** every image item that references it by a constant name is updated in the same single undo step; renaming is blocked with an explanation if any reference is an expression or otherwise not safely rewritable.
4. **Given** an embedded image definition with zero references, **When** the author removes it, **Then** it is removed as one undo step; removal of a definition with references is blocked and lists the referencing items.
5. **Given** the author selects an embedded image definition, **When** they choose to insert it, **Then** a new image item referencing that definition is inserted without a file chooser.

---

### User Story 5 - Preserve Unsupported and Existing Images (Priority: P1)

As a report author, I want reports that already contain images I cannot edit here (external, database, expression-based, other formats, or in unsupported containers) to remain intact and safely visible, so that opening the designer never damages my existing reports.

**Why this priority**: Lossless editing is a non-negotiable constitutional principle; regressions here would corrupt reports.

**Independent Test**: Open fixtures containing external-URL images, database images, expression-valued embedded images, GIF/BMP embedded images, malformed base64, oversized payloads and images nested in unsupported containers; perform unrelated edits, save, and compare the text to verify preservation; confirm no network or file access occurred.

**Acceptance Scenarios**:

1. **Given** an image whose Source is External or Database, or whose Value is an expression, **When** the report is displayed, **Then** the item is shown as a labelled placeholder at its declared bounds, marked preservation-only with source access, and nothing is fetched, resolved, or evaluated.
2. **Given** an embedded image in BMP, GIF or x-png format, malformed or oversized data, or a reference to a missing definition, **When** the report is displayed, **Then** the item shows a placeholder with a diagnostic naming the reason; existing items whose picture is a valid PNG/JPEG within limits are displayed.
3. **Given** preserved images and definitions, **When** the author makes unrelated edits and saves, **Then** those images, definitions, unknown child elements, foreign-namespace attributes and their formatting remain byte-identical.
4. **Given** an existing embedded-source image item with a constant Value referencing a displayable definition, **When** it is selected, **Then** it supports the same manipulations and inspector editing as an authored image, while any unknown child elements it contains are preserved.

### Edge Cases

| Condition | Required behavior |
|---|---|
| File chooser cancelled, file unreadable, or file removed between selection and read | No change, no undo entry; a read failure is reported with the file name only (no content). |
| File extension says PNG/JPEG but content signature does not match, or file is truncated/corrupted | Refused; format is determined from content, not extension. |
| Picture exceeds the per-image limit (5 MiB raw) or 16,384 pixels on either dimension, or 40 megapixels total | Refused with the exceeded limit stated. |
| Resulting report would exceed the existing 16 MiB visual-parsing source budget | Refused before any edit is applied; the report stays visually editable. |
| Embedded image name collides with an existing definition | A unique CLS-compliant name is generated from the file name (e.g. `logo`, `logo_1`). File names with unsupported characters are normalized. |
| Image document is read-only, untrusted workspace, or report is source-only/not visually editable | Image insertion and mutation are unavailable with the existing explanation; inspection still works. |
| Report text changes externally while a file import is in progress | The import is applied against the latest accepted text or refused if the target no longer exists; never applied to stale content. |
| Very large existing payloads in the report | Views and the inspector show size metadata only; payload text is never copied into tooltips, logs, diagnostics or messages exchanged beyond what is needed for display. |
| Many images in one report | Canvas remains responsive (see Success Criteria); display of each picture is decoded locally from the report only. |
| Picture with embedded metadata (EXIF orientation, color profiles, text chunks) | Stored unchanged as provided; display follows the picture's stored orientation with no metadata interpretation beyond what standard decoding does. |
| Image inside a table cell or other container | Existing image items there are displayed and preserved; authoring of images into table cells is out of scope for this feature and remains unavailable. |
| Pasting an image when the clipboard came from another application | Only RDLC Code's own copy payloads are accepted; arbitrary clipboard bitmaps are not imported in this feature. |

## Requirements *(mandatory)*

### Functional Requirements

**Import and storage**

- **FR-001**: Users MUST be able to import an image from a local file chosen through the native file chooser, limited to PNG and JPEG content.
- **FR-002**: The system MUST identify the image format from the file content signature and MUST refuse files whose content is not a decodable PNG or JPEG, regardless of file extension.
- **FR-003**: The system MUST enforce a per-image limit of 5 MiB of raw file data and 16,384 pixels per dimension (40 megapixels total), and MUST refuse any import that would make the report exceed the existing 16 MiB visual-parsing budget.
- **FR-004**: An imported image MUST be stored as an `EmbeddedImage` in the report's `EmbeddedImages` collection, with a unique CLS-compliant case-sensitive Name, a constant MIMEType of `image/png` or `image/jpeg`, and ImageData containing the unmodified file bytes encoded as base64 (MS-RDL 2.306).
- **FR-005**: The `EmbeddedImages` collection MUST be created at the schema-valid location when absent; existing collections MUST receive new entries without reformatting existing entries.
- **FR-006**: An import whose content is byte-identical to an existing displayable embedded image MUST reuse that definition.

**Insertion and manipulation**

- **FR-007**: The Components toolbox (designer catalog and native Components view) MUST expose Image as an available entry for supported reports, inserted by click (default location) or drag-and-drop (drop location), replacing its current "unavailable" state.
- **FR-008**: Insertion MUST create an `Image` report item with `Source` = `Embedded`, a constant `Value` equal to the embedded image name, `Sizing` = `FitProportional`, and Top/Left/Width/Height computed from the drop point and the picture's aspect ratio, clamped to the body width.
- **FR-009**: Insertion of a new picture MUST add the embedded definition and the image item as one atomic edit and one native undo step.
- **FR-010**: Image items MUST support selection, multi-selection, movement, resizing, deletion, copy, paste and duplication with the same interaction, snapping, keyboard and accessibility behavior as existing supported report items.
- **FR-011**: Deleting an image item MUST NOT remove its embedded definition implicitly.
- **FR-012**: Copy/paste and duplicate within a report MUST reference the same embedded definition; pasting into another report MUST carry the definition along, reusing identical content and renaming on collision, as part of the same undo step.
- **FR-013**: Every image mutation MUST be applied through the existing typed-intent and edit pipeline to the authoritative report text, as a single native VS Code undo step, and MUST preserve all unrelated text exactly.

**Display**

- **FR-014**: The canvas MUST display a displayable embedded PNG/JPEG within the item's bounds according to its Sizing mode (MS-RDL 2.12.18); AutoSize MUST display the picture at its natural size at the current zoom without modifying the report's declared size.
- **FR-015**: Images that cannot be displayed (non-embedded source, expression Value, unsupported format, invalid/oversized data, missing definition) MUST render as a labelled placeholder at their declared bounds with a reason, without fetching, resolving or evaluating anything.
- **FR-016**: Image data used for display MUST come only from the report text; decoding MUST happen locally and offline, with no network, file-system or external resource access.

**Inspector**

- **FR-017**: The inspector MUST expose, for editable image items: Name, Left, Top, Width, Height, Sizing, referenced embedded image, ToolTip, and read-only picture metadata (format, pixel dimensions, encoded size).
- **FR-018**: Users MUST be able to replace an item's picture from a local file (subject to FR-001–FR-006); when the definition is referenced by several items, users MUST choose between updating this item only or all referencing items.
- **FR-019**: Property edits MUST be validated by the existing validation pipeline, refusing invalid names, sizes and enumeration values with actionable diagnostics.

**Views**

- **FR-020**: Report Structure MUST list image items with an image icon, name and capability state, and keep selection synchronized with the canvas as for other report items.
- **FR-021**: Report Data MUST list embedded image definitions with name, format, encoded size and reference count, and MUST support rename (updating constant references atomically), removal of unreferenced definitions, and insertion of an existing definition as a new image item.
- **FR-022**: Rename or removal MUST be blocked, with the blocking references listed, when references are expressions or otherwise not safely rewritable, or when a referenced definition would be removed.

**Preservation and safety**

- **FR-023**: Existing images and definitions that are not editable (External/Database sources, expression values, BMP/GIF/x-png formats, invalid data, unsupported containers, unknown children or foreign-namespace content) MUST be preserved byte-identically through unrelated edits and saves, and remain inspectable with source access.
- **FR-024**: The system MUST NEVER fetch external image resources, open URLs, access data sources, or evaluate report expressions or queries to display, inspect or validate images.
- **FR-025**: Image payloads MUST NOT appear in logs, diagnostics, tooltips, view labels or error messages; only size and format metadata may be shown.
- **FR-026**: Image authoring MUST be unavailable for read-only documents, untrusted workspaces where editing is restricted, and reports that are not visually editable, with the existing explanation.
- **FR-027**: Existing editor and sidebar behavior for non-image items MUST remain unchanged; no new runtime dependency MAY be added unless the plan demonstrates it is required and license-compatible.

**Verification**

- **FR-028**: Every acceptance scenario MUST have automated coverage at the appropriate level (unit, integration, Desktop end-to-end), including automated visual tests of image display and placeholders, per constitution principle VII.

### Key Entities

- **Embedded Image Definition**: A named picture resource stored inside the report. Attributes: unique name, format (PNG/JPEG for authoring; other formats preserved), encoded data, derived pixel dimensions and encoded size, reference count. One definition can be referenced by many image items.
- **Image Item**: A report item placed in the body. Attributes: unique report-item name, position, size, sizing mode, source kind, value (embedded definition name), tooltip, plus any preserved unknown content. Editable only when its source is Embedded with a constant value referencing a displayable definition.
- **Image Import Request**: A user-initiated, local, one-file operation producing either a validated picture (format, dimensions, bytes) or a refusal reason (format, size, pixel or budget limit, read failure).
- **Image Clipboard Payload**: RDLC Code's own copy payload for image items, carrying the item description and, when needed across reports, the definition it references.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An author can insert a local logo into a report and position it in under 30 seconds, using only the toolbox, file chooser and canvas.
- **SC-002**: 100% of image insertions, manipulations, property edits and definition rename/removals are reversible with exactly one native Undo and re-applicable with one Redo, in automated tests.
- **SC-003**: For every fixture in the preservation corpus (including external, database, expression, GIF/BMP, malformed and oversized images), an unrelated edit followed by save leaves all image-related text byte-identical, and the text outside the intended edit is byte-identical for every image edit.
- **SC-004**: Zero network requests and zero file-system reads other than the user-chosen import file occur during report opening, display, inspection and editing of images, as observed by automated offline/isolation tests.
- **SC-005**: 100% of invalid imports in the test corpus (wrong signature, truncated, over size, over pixel limit, over document budget) are refused with a message stating the reason, and leave the report and undo history unchanged.
- **SC-006**: A displayable image appears on the canvas within 1 second of insertion for a 5 MiB image, and a report containing 50 embedded images remains interactive (selection and movement feedback within 100 ms).
- **SC-007**: Automated visual tests confirm that each of the four sizing modes and the placeholder state display as specified.
- **SC-008**: All existing automated tests for features 001–005 continue to pass with no change to their expected outcomes, except the Image toolbox entry, which changes from unavailable to available.

## Assumptions

- Authoring is limited to reports that already qualify for visual authoring (RDL 2016/01, single complete section); other reports stay inspection/source-only as today.
- Image authoring targets the report body; image placement inside table cells, rectangles or headers/footers is not authored in this feature, though existing images there are preserved and displayed where the container is already displayed.
- Default sizing for new items is FitProportional, which keeps the picture's aspect ratio when resized; AutoSize remains selectable and is shown at natural size without changing declared bounds.
- Limits (5 MiB per image, 16,384 px per dimension, 40 megapixels, 16 MiB report budget) are conservative defaults aligned with the existing 16 MiB parsing budget; the plan may tighten but not loosen them without updating this spec.
- Imported bytes are stored as-is (no re-encoding, compression, resizing or metadata stripping), so the stored picture matches the source file exactly.
- Alternative text: RDL 2016/01 has no dedicated alt-text element for images; ToolTip serves as the accessible description and is exposed in the inspector.
- Displaying images in the designer relies on the platform's built-in local image decoding within the webview isolation; no external image library is expected.
- Clipboard support uses the designer's existing internal copy/paste mechanism; importing arbitrary bitmaps from the system clipboard is out of scope.
- Out of scope: external image URLs, database-backed images, expression-based image evaluation, background images and other image-typed style properties, GIF/BMP authoring, report rendering, preview, printing or export, charts and other unsupported report items, schema conversion.
- Development happens on a feature branch with a pull request into protected `main`; local QA follows the targeted QA policy and comprehensive validation is provided by GitHub Actions.
