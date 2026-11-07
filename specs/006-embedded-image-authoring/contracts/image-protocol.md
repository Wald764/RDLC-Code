# Contract: Image Edit Intents and Webview Messages

Extends protocol version 2 (`packages/report-model/src/protocol.ts`). Every intent travels in
the existing `edit` client message. Any unknown field, path, URI or byte payload in a
client message is a `protocolError` (`validateMessage`).

## Client → host intents (added to `EditIntent`)

| Action | Payload (all strings, matching the `authoringFields` style) | Result | Undo |
|---|---|---|---|
| `createImage` | `placement: 'default' \| 'drop'`, `left?`, `top?`, `definition?` | With no `definition`, the host opens the file chooser (`ImageSource`) and writes a new `EmbeddedImage` (or reuses an identical one) plus an `Image` item. With `definition`, the host inserts an item that references that definition | 1 step |
| `setImageProperty` | `item`, `property: 'sizing' \| 'value' \| 'toolTip' \| 'name'`, `value` | One scalar patch | 1 step |
| `replaceImagePicture` | `item`, `scope: 'item' \| 'all'` | The host opens the file chooser. `item` writes a new definition and repoints only this item. `all` rewrites the referenced definition's `ImageData`/`MIMEType` in place | 1 step |
| `renameEmbeddedImage` | `definition`, `newName` | Renames the definition and every constant reference, or is refused with `IMAGE_RENAME_BLOCKED` | 1 step |
| `removeEmbeddedImage` | `definition` | Removes an unreferenced definition, or is refused with `IMAGE_REMOVE_BLOCKED`, which lists the referencing items | 1 step |

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
| `imageAssets` (new) | `assets: {key, mime, data}[]` | Sent only for displayable PNG and JPEG definitions whose key the webview has not yet received. Base64 payload only. Never logged |

## Webview → host native actions (sidebar)

`CreateKind` in `packages/report-model/src/navigation.ts` gains `'image'`. The routes
`validateNativeAction` and `create` map to `createImage`.

## Sidebar commands (`apps/vscode-extension/package.json`)

| Command | View / context value | Behavior |
|---|---|---|
| `rdlcCode.sidebar.imageInsert` | Data, `dataEmbeddedImage.displayable` | `createImage {definition}` |
| `rdlcCode.sidebar.imageRename` | Data, `dataEmbeddedImage.*` | `showInputBox` → `renameEmbeddedImage` |
| `rdlcCode.sidebar.imageRemove` | Data, `dataEmbeddedImage.unreferenced` | `removeEmbeddedImage` |

The existing Structure commands (reveal, copy, cut, duplicate, delete, properties and
source) apply to `image` nodes according to their capability state.

## Content-Security-Policy

`apps/vscode-extension/src/webview.ts` sets `img-src ${cspSource} blob:`. `data:` is not
allowed, `connect-src` stays `'none'`, and every other directive is unchanged.
