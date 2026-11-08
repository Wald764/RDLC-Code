# RDLC Code

An offline, source-preserving RDLC designer for desktop Visual Studio Code.
Original code is MIT licensed. The implementation is under development; public
release acceptance and publishing credentials are not yet verified.

## Install and use

Build a local VSIX using [CONTRIBUTING.md](CONTRIBUTING.md), then install it:

```sh
code --install-extension dist/rdlc-code-0.3.0.vsix
```

VS Code 1.142.0 or newer is required. Windows has local automated evidence;
the configured CI matrix covers Windows, macOS and Linux. Initial developer
dependency and test-harness downloads need network access. Installed authoring
uses bundled assets and needs no server, .NET runtime or data connection.

- Use **RDLC Code: New Report** to create an untitled report; use native Save As.
- For an existing `.rdlc`, select **Reopen Editor With → RDLC Designer**, or run
  **RDLC Code: Open Designer**.
- Select an item and explicitly apply its property form. Native save, undo and
  redo operate on the same text document as source edits.
- Use **RDLC Code: Open Source** for XML, unsupported content or diagnostics.

### Native report workspace (in development)

Open **RDLC Code** in the Activity Bar for **Report Structure**, **Report Data**
and **Components**, including before opening a designer. **Open Report** uses a
local `.rdlc` picker. VS Code owns view placement, hiding and restoration.

- Structure follows accepted XML, including cells, members, groups and preserved
  report items. Activate a row to select its associated designer target; use
  **Properties** or **Code XML** from its context menu. Eligible body items also
  expose Copy, Cut and Duplicate. **Delete**, **Table Properties** and **Group
  Properties** open the existing inspector workflow; deletion still requires its
  contained-content acknowledgement and reference checks.
- Data lists datasets/fields, parameters, embedded images and data sources.
  Tooltips contain allowlisted metadata, never image payloads, query text or
  connection strings. Parameters and data sources remain inspection-only; embedded
  images are managed as described under [Embedded images](#embedded-images).
- Components shares the compact designer's eleven-kind catalog. Textbox, Table,
  Dataset and Image activate existing automatic creation. The title **Filter Components**
  action matches labels without case sensitivity; Escape retains the previous
  filter, and **Clear Filter** recovers an empty result.
- The designer starts with its duplicate navigation closed. Its **Components**
  toolbar button explicitly opens the compact fallback, including existing HTML
  drag insertion, even when native views are hidden. Explicit saved navigation
  preferences remain respected.

Native-tree drag delivery is unavailable in the executed Windows probe, so the
native views advertise activation rather than dragging. Every installed
functional journey passes locally on Windows with VS Code 1.142.0, including
the selection-latency gate. The native sidebar is not yet acceptance-complete:
pinned Linux visual references, monitored offline/security capture and the
cross-platform CI matrix remain outstanding.

### Interactive canvas

Each accepted gesture or command is one host-validated edit and one native Undo
step; cancelled, refused and no-op actions leave the document and history unchanged.

| Action                         | Pointer / keyboard                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Select, add/remove             | Click; Shift+click; marquee on blank canvas; item list; Ctrl/Cmd+A selects all     |
| Move / resize                  | Drag an item; drag one of eight handles (textboxes, images and whole tables)       |
| Align / distribute             | Toolbar: six alignments to the primary item; horizontal/vertical distribution (≥3) |
| Nudge                          | Arrow keys 1pt, Shift+arrow 10pt (canvas focus; snapping ignored)                  |
| Snap bypass                    | Hold Alt while dragging; grid and guide visibility/snapping toggle independently   |
| Zoom / pan                     | Zoom controls 25–400%, Fit Page/Body, Reveal Selection, Ctrl/Cmd+wheel, Space+drag |
| Copy / Cut / Paste / Duplicate | Ctrl/Cmd+C/X/V and Ctrl/Cmd+D on the canvas, or the labeled buttons                |
| Cancel                         | Escape cancels a preview, marquee or nudge; otherwise clears the selection         |

Shortcuts apply only on the canvas; form fields keep their normal typing,
clipboard and arrow behavior. Numerical property forms remain available for
precise sizing. Zoom, scroll, unit, grid and guide preferences are per view and
never written to the report. Paste offsets 10pt, then 20pt, per successful paste;
Duplicate offsets 10pt and does not touch the clipboard. Clipboard reuse works
within one VS Code window and refuses selections whose dependencies, scopes,
names or foreign metadata cannot be proven safe; Copy then explains why.

### Embedded images

Pictures are authored as embedded images only: the bytes are stored as base64 in
the report's `EmbeddedImages` collection and an `Image` item references them by
name. Nothing is linked, fetched or resolved.

- **Insert**: choose **Image** in Components (click, or the compact designer's HTML drag onto
  the body, since native tree drag is unavailable), then
  pick a local PNG or JPEG in the native file dialog. Cancelling, or a refusal,
  leaves the report and its history unchanged. Insertion adds the definition and
  the item as one Undo step; a picture identical to an existing definition reuses it.
- **Display**: the picture appears on the canvas using the item's Sizing mode
  (AutoSize, Fit, FitProportional or Clip).
- **Manipulate**: select, move, resize, delete, copy, paste, duplicate and
  cross-report paste work as for other items. Delete keeps the definition; copies
  share it instead of duplicating the data.
- **Inspector**: Name, geometry, Sizing, the embedded image (pick another or
  replace the picture from a local file), ToolTip.
- **Sidebar**: Report Structure lists image items and Report Data lists the
  definitions with format, size and usage. Use **RDLC Code: Insert Embedded Image**,
  **RDLC Code: Rename Embedded Image** (references are rewritten in one step) and
  **RDLC Code: Remove Embedded Image** (a definition still referenced by items is
  refused, with those items listed).

| Limit                     | Value                        |
| ------------------------- | ---------------------------- |
| Formats                   | PNG and JPEG                 |
| Raw file size per picture | 5 MiB                        |
| Pixels per side           | 16,384                       |
| Total pixels per picture  | 40 megapixels                |
| Report size after import  | 16 MiB visual-parsing budget |

A picture beyond a limit, in another format or not readable is refused with the
limit named, and the report is not changed. Images that cannot be authored are
preserved byte for byte and shown as labelled placeholders with source access:
external and database sources, expression values, GIF, BMP or x-png data, malformed
or oversized payloads, missing definitions and images in unsupported containers.
Unrelated edits and saves leave them, unknown children and foreign attributes
untouched. Pictures are decoded only for display inside the isolated webview.

## Supported authoring profile

- RDL namespace `http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`,
  exactly one report section, page/body dimensions and margins.
- Body textboxes with one paragraph and one text run: names, literal or expression
  text, geometry, local fonts, size, bold/italic, color and horizontal alignment.
- Local datasets/fields with text, Boolean, Int32, Int64, decimal, double and
  date/time metadata. No data is loaded or queried.
- Supported unmerged, static-column tables: cell text/bindings, columns, row
  groups, group subtotals and explicitly dataset-wide report totals using Sum.
- Body images with an embedded PNG or JPEG source and a constant definition name,
  within the limits above.
- Keyboard-accessible authoring controls and normal VS Code document services.

The XML TextDocument is authoritative. Visual changes use validated, minimal,
atomic patches; untouched source, namespaces and unsupported content stay in
place. Referenced or potentially referenced destructive changes are refused.
See the [compatibility contract](specs/001-rdlc-vscode-editor/contracts/compatibility.md).

## Boundaries and evidence

This is an authoring surface, not a report renderer: expressions, embedded code,
queries and external resources are not executed. External, database and
expression-based images, charts, rich text, matrices, spanning cells, unknown
field types and unsupported structures are preservation-only. Unsupported versions, multiple sections, required unknown
extensions, malformed XML and parser-budget limits retain source access.
Visual parsing currently has 16 MiB / depth 256 / 100,000-element budgets;
they do not truncate source or restrict native source editing.

External RDLC designer/runtime acceptance is separate from XML authoring support;
no universal consumer-compatibility claim is made. Browser-hosted and remote
workspaces are not supported targets. Native dialog, installed isolation,
performance/usability and multi-OS evidence still have outstanding obligations;
interactive-designer installed acceptance is closed by owner acceptance (see [the interactive validation record](docs/validation/interactive-designer.md)).
See [validation records](docs/validation/) and [release requirements](docs/releases.md).

## Development

Use [CONTRIBUTING.md](CONTRIBUTING.md). Architecture and acceptance scenarios are
in [the feature specification](specs/001-rdlc-vscode-editor/spec.md) and the
[interactive designer specification](specs/002-interactive-visual-designer/spec.md).
Microsoft reference material in `vendor/` is read-only and retains its own
notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
