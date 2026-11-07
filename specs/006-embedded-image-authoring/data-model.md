# Data Model: Embedded Image Component Authoring

Types are TypeScript shapes owned by `packages/report-model` unless noted otherwise. Report
text stays the source of truth (constitution III). Every entity below is derived from it, or
is a transient request that never persists outside the report.

## EmbeddedImageDefinition (projection)

Owner: `packages/report-model/src/report.ts`. Produced by `packages/xml-parser/src/project-images.ts`.

| Field | Type | Source / rule |
|---|---|---|
| `node` | `XmlNode` | The `EmbeddedImage` element (MS-RDL 2.306) |
| `name` | `string` | `Name` attribute, case-sensitive, unique within `EmbeddedImages` |
| `nameRange` | `Range` | Span used by the rename patches |
| `mime` | `string \| null` | Constant `MIMEType` text. `null` when absent or an expression |
| `format` | `'png' \| 'jpeg' \| 'other'` | From the content signature, never from `mime` alone |
| `encodedSize` | `number` | Length of the `ImageData` text with whitespace removed |
| `byteSize` | `number \| null` | Decoded length when the base64 is valid |
| `pixels` | `{width,height} \| null` | From the PNG `IHDR` chunk or the JPEG SOF marker (research R2) |
| `hash` | `string \| null` | SHA-256 of the decoded bytes. Computed on the host only |
| `displayable` | `boolean` | True for valid PNG or JPEG data within the limits, when `mime` matches the format |
| `reason` | `ImageReason \| null` | Why the definition is not displayable |
| `references` | `string[]` | Names of the image items whose constant `Value` equals `name` |

`ImageReason` = `'format-unsupported' | 'data-invalid' | 'too-large' | 'pixels-exceeded'
| 'mime-mismatch' | 'value-expression'`.

## ImageItem (projection)

Owner: `report.ts`. The textbox pattern is mirrored for `bounds` and `boundsRanges`.

| Field | Type | Rule |
|---|---|---|
| `node`, `name`, `nameRange` | as for `Textbox` | `Image` element (MS-RDL 2.12) |
| `context` | `'body' \| 'table-cell' \| 'preserved'` | Authoring is only allowed for `body` |
| `bounds`, `boundsRanges` | as for `Textbox` | `Top`, `Left`, `Height`, `Width` |
| `source` | `'Embedded' \| 'External' \| 'Database' \| 'expression' \| null` | MS-RDL 2.12.19 |
| `value` | `{kind:'constant', text} \| {kind:'expression'} \| null` | MS-RDL 2.12.20 |
| `sizing` | `'AutoSize' \| 'Fit' \| 'FitProportional' \| 'Clip'` | Default `AutoSize` when absent (MS-RDL 2.12.18) |
| `sizingRange` | `Range \| null` | Used for scalar patches |
| `toolTip` | `{text, expression:boolean} \| null` | Inert; never evaluated (FR-024) |
| `definition` | `string \| null` | The name of the resolved `EmbeddedImageDefinition` |
| `capabilities` | `string[]` | See the state rules below |
| `reason` | `ImageReason \| 'source-preserved' \| 'reference-missing' \| null` | Placeholder reason |

### Capability state rules

An item is **editable**, with capabilities `image`, `name`, the geometry keys, `sizing`,
`value` and `toolTip`, only when all of the following are true:

1. The report status is `editable`.
2. `context = 'body'`.
3. `source = 'Embedded'` with a constant `value`.
4. The value resolves to a displayable definition.

When the item is otherwise valid but its referenced definition is not displayable or is
missing, it is **geometry-only**: the geometry keys plus `name`. The item can still be
moved and resized, and it shows a placeholder. Every other item is **preservation-only**
(`[]`). Unknown children and foreign attributes never change state. They are preserved
because every edit is a scalar patch.

## Scene item (renderer output)

Owner: `packages/report-model/src/scene.ts`, built in `packages/renderer/src/render.ts`.

`kind: 'image'` is added to the `items[].kind` union with these fields:
`{ id, name, bounds, sizing, display: {state:'picture', assetKey, pixels} |
{state:'placeholder', reason}, metadata: {format, pixels, encodedSize}, capabilities }`.
The scene never contains image bytes.

## ImageAsset (host → webview message only)

Owner: `packages/report-model/src/protocol.ts`. `{ key: hash, mime: 'image/png'|'image/jpeg', data: base64 }`.
The host sends assets only for displayable definitions. The webview holds them as Blob
object URLs keyed by `key` and revokes them when no item references them any longer.
They are never logged or echoed in diagnostics.

## ImageImportRequest (host, transient)

Owner: `apps/vscode-extension/src/image-import.ts`.

The request moves through these states. Every outcome other than `accepted` leaves the
report unchanged and adds no history entry.

| State | Next | Meaning |
|---|---|---|
| `requested` | `cancelled` | The author closed the file chooser |
| `requested` | `read` | A file was chosen and read |
| `requested` | `refused(read-failed)` | The file could not be read |
| `read` | `validated` | The file passes `validatePicture` |
| `read` | `refused(format \| too-large \| pixels \| data-invalid)` | The file fails `validatePicture` |
| `validated` | `planned` | A plan was built against the latest accepted snapshot |
| `validated` | `refused(stale-target \| budget)` | The target is stale or the report budget would be exceeded |
| `planned` | `accepted` | The plan was verified and applied as one `WorkspaceEdit` |
| `planned` | `refused(verification)` | The plan failed verification |

`ValidatedPicture` = `{ format, mime, bytes: Uint8Array, pixels, hash, fileStem }`.
`ImageRefusal` = `{ code, limit?, actual?, fileName }`. A refusal carries the file name only,
never its content (spec Edge Cases).

## EmbeddedImageRequirement (clipboard)

Owner: `packages/report-model/src/clipboard.ts`. It extends `Capture` with
`images: EmbeddedImageRequirement[]`, one entry per definition name referenced by a captured
image item, in the source report's definition order:

| Field | Type | Rule |
|---|---|---|
| `name` | `string` | The definition name in the source report |
| `hash` | `string \| null` | SHA-256 of the decoded bytes of a displayable definition; `null` otherwise |
| `identity` | `string` | What makes two definitions interchangeable: `hash` when displayable, else `xml:` plus a SHA-256 of the exact `EmbeddedImage` source with the `Name` value removed |
| `mime` | `string \| null` | Constant `MIMEType` text, if any |
| `xml` | `string` | The exact `EmbeddedImage` source |
| `nameRange` | `SourceRange` | The `Name` value range within `xml`, used to rename on a collision |

Every referenced definition travels, displayable or not (GIF, malformed data, MIME mismatch):
a carried non-displayable definition stays non-displayable in the target, so the pasted item
is geometry-only. A referenced name with no definition has no entry and nothing is invented.
The bytes stay host-side and count toward `captureBudget` (research R10).

`CaptureRoot.kind` gains `'image'` and an image root carries `embedded: {name, range}`, the
constant `Value` and its exact operand range within `xml`.

`reconcileImages(requirements, targetDefinitions, reserved)` reuses a target definition only on an
equal `identity`; otherwise it inserts, renaming on a name collision. `reserved` holds names
that dangling captured items still point at, which an allocated name must avoid. Pasting an item
whose definition was missing into a report that defines that name is refused
(`IMAGE_DEFINITION_CONFLICT`), because the item would silently bind to an unrelated picture.

## Validation rules (summary)

| Rule | Where | Diagnostic code |
|---|---|---|
| Signature, structure and CRC checks | `packages/validation/src/images.ts` | `IMAGE_FORMAT_UNSUPPORTED`, `IMAGE_DATA_INVALID` |
| 5 MiB raw size limit | same file; the host `stat` check runs before the read | `IMAGE_TOO_LARGE` |
| 16,384 px per dimension, 40 MP total | same file | `IMAGE_PIXELS_EXCEEDED` |
| 16 MiB report budget | edit controller, checked on the candidate text | `IMAGE_REPORT_BUDGET` |
| Item name: CLS-compliant and unique | existing `validateName` | existing codes |
| Sizing value in the enum | `validateImageProperty` | `IMAGE_PROPERTY_INVALID` |
| Rename or remove blocked by an expression or a reference | `validateDefinitionMutation` | `IMAGE_RENAME_BLOCKED`, `IMAGE_REMOVE_BLOCKED` |
| Target removed during the import | edit controller | `IMAGE_TARGET_STALE` |
| File read failure | `image-import.ts` | `IMAGE_READ_FAILED` |
