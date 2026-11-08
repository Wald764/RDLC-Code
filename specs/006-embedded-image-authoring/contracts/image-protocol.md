# Contract: Image Edit Intents and Webview Messages

Extends protocol version 2 (`packages/report-model/src/protocol.ts`). Every intent travels in
the existing `edit` client message. Any unknown field, path, URI or byte payload in a
client message is a `protocolError` (`validateMessage`).

## Client → host intents (added to `EditIntent`)

| Action | Payload (all strings, matching the `authoringFields` style) | Result | Undo |
|---|---|---|---|
| `createImage` | `placement: 'default' \| 'drop'`, `left?`, `top?`, `definition?` | With no `definition`, the host opens the file chooser (`ImageSource`) and writes a new `EmbeddedImage` (or reuses an identical one) plus an `Image` item. With `definition`, the host inserts an item that references that definition | 1 step |
| `setImageProperty` | `property: 'sizing' \| 'value' \| 'toolTip' \| 'name'`, `value`. The item is the edit's `targetId` | One scalar patch. An empty `toolTip` removes the element. Geometry is not an image property: it travels as the existing `LayoutIntent` | 1 step |
| `replaceImagePicture` | `scope: 'item' \| 'all'`. The item is the edit's `targetId` | The host opens the file chooser. `item` writes a new definition and repoints only this item. `all` rewrites the referenced definition's `ImageData`/`MIMEType` in place | 1 step |
| `renameEmbeddedImage` | `definition`, `newName`. The target is the report | Renames the definition and every constant reference (`Source` Embedded) in one composed plan, or is refused with `IMAGE_RENAME_BLOCKED`, which lists the blocking items. An invalid or duplicate `newName` is `IMAGE_PROPERTY_INVALID`; the current name is a no-op | 1 step |
| `removeEmbeddedImage` | `definition`. The target is the report | Removes an unreferenced definition, or is refused with `IMAGE_REMOVE_BLOCKED`, which lists the referencing items. Removing the last definition removes the whole `EmbeddedImages` collection, because MS-RDL 2.306 requires at least one entry in a present collection (2.305 makes the collection optional) | 1 step |

**Blocking items** (`validateDefinitionMutation`, one diagnostic per item with its `itemId`; the first 20 are listed and the rest summarized by count). A constant `Value` naming the definition blocks a removal only, because a rename rewrites it. These block both operations: an `Image` whose `Value` is an expression and whose `Source` is Embedded, an expression or unknown; a constant `Value` behind an unknown or repeated `Source` or `Value`; a structured `Value`; any other image element that could name the definition (`BackgroundImage` and every RDL element named `*Image` with a `Value`, such as `MapMarkerImage`, `IndicatorImage`, `CapImage`, `TopImage`, `PointerImage`, `FrameImage`, `StateImage` and `GaugeImage`; it is listed under its nearest named ancestor and is never rewritten); a definition name that is missing or defined more than once. External and Database images never block. A rename also refuses a `newName` that has no definition but that an Embedded or unknown-source image item or element already references by constant, because the rename would silently give that item a picture (`IMAGE_RENAME_BLOCKED`, listing the item and never the submitted text). Messages carry authored names only, never picture data.

A definition `Name` is 1 to 256 characters (rsInvalidEmbeddedImageNameLength, MS-RDL 6.40) and a CLS-compatible identifier unique among the embedded images; the sidebar input box applies the same rule (`IMAGE_PROPERTY_INVALID`). The reference count of a definition is the number of image items and image elements whose constant `Value` names it behind a `Source` that is Embedded, an expression or unknown; External and Database never count. It is the same rule as removal, so a definition used by a `PointerImage` or `IndicatorImage` is `referenced` and its Remove entry is hidden.

These existing intents and messages accept image items without changing shape:
`LayoutIntent` (move and resize), deletion, the `clipboard` message (copy, cut, paste and
duplicate) and the selection messages.

**Refusals** come back as the existing `editResult` with `{accepted:false, diagnostic}`.
The diagnostic uses a code from [data-model.md](../data-model.md#validation-rules-summary).
A cancelled file chooser returns `editResult {accepted:false, cancelled:true}` with no
diagnostic and no history entry.

**Gating**: the existing `document-session.ts:558` refusal (untrusted workspace,
read-only file system) and source-only status apply before the file chooser opens
(FR-026). In those cases the file chooser is never shown.

## Host → webview messages

| Message | Fields | Rule |
|---|---|---|
| `snapshot` (existing) | The scene includes `kind:'image'` items | No bytes |
| `snapshot.authoring` (extended) | `embeddedImages: {name, displayable, references}[]` and `images: {id, definition, toolTip}[]` (body items) | Feeds the inspector's picker, reference count and ToolTip text. No bytes, hashes or paths |
| `imageAssets` (new) | `assets: {key, mime, data}[]` | Sent only for displayable PNG and JPEG definitions whose key the webview has not yet received. Base64 payload only. Never logged |

## Webview → host native actions (sidebar)

`CreateKind` in `packages/report-model/src/navigation.ts` gains `'image'`. The routes
`validateNativeAction` and `create` map to `createImage`.

## Sidebar commands (`apps/vscode-extension/package.json`)

| Command | View / context value | Behavior |
|---|---|---|
| `rdlcCode.sidebar.imageInsert` | Data, `dataEmbeddedImage.displayable` | Native `author` action with `createImage {placement:'default', definition}`; no file chooser |
| `rdlcCode.sidebar.imageRename` | Data, `dataEmbeddedImage.*` | `showInputBox` (same name rule) → native `author` action with `renameEmbeddedImage` |
| `rdlcCode.sidebar.imageRemove` | Data, `dataEmbeddedImage.*` (referenced definitions are refused with the referencing items listed) | Native `author` action with `removeEmbeddedImage` |

The three commands check the same reference analysis as the host edit before dispatching, so a refusal reaches the author as a warning that lists the blocking items. The native `author` payload accepts the optional fields of `authoringOptionalFields` (here `definition`).

A definition row's `contextValue` is a space-separated list: `dataEmbeddedImage.displayable` (present for a valid PNG or JPEG) followed by exactly one of `dataEmbeddedImage.referenced` and `dataEmbeddedImage.unreferenced`. The view passes the report state explicitly (`editable` only for status `editable`): in a report that is not editable (including a 2016 report that is only partly supported) the row stays `rdlcCode.source` and offers no image command (FR-026), but it still shows the same facts, because inspection works for every report (FR-021). The row description is `format · pixels · encoded size · reference count`; the closed `NavigationDetails` gain `format`, `encodedSize`, `pixelWidth`, `pixelHeight`, `references` and `displayable`. Image nodes in both views use the `file-media` ThemeIcon.

The existing Structure commands (reveal, copy, cut, duplicate, delete, properties and
source) apply to `image` nodes according to their capability state.

## Content-Security-Policy

`apps/vscode-extension/src/webview.ts` sets `img-src ${cspSource} blob:`. `data:` is not
allowed, `connect-src` stays `'none'`, and every other directive is unchanged.
