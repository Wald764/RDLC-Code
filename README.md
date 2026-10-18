# RDLC Code

An offline, source-preserving RDLC designer for desktop Visual Studio Code.
Original code is MIT licensed. The implementation is under development; public
release acceptance and publishing credentials are not yet verified.

## Install and use

Build a local VSIX using [CONTRIBUTING.md](CONTRIBUTING.md), then install it:

```sh
code --install-extension dist/rdlc-code-0.1.0.vsix
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

### Interactive canvas

Each accepted gesture or command is one host-validated edit and one native Undo
step; cancelled, refused and no-op actions leave the document and history unchanged.

| Action                         | Pointer / keyboard                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Select, add/remove             | Click; Shift+click; marquee on blank canvas; item list; Ctrl/Cmd+A selects all     |
| Move / resize                  | Drag an item; drag one of eight handles (textboxes and whole tables)               |
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

## Supported authoring profile

- RDL namespace `http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`,
  exactly one report section, page/body dimensions and margins.
- Body textboxes with one paragraph and one text run: names, literal or expression
  text, geometry, local fonts, size, bold/italic, color and horizontal alignment.
- Local datasets/fields with text, Boolean, Int32, Int64, decimal, double and
  date/time metadata. No data is loaded or queried.
- Supported unmerged, static-column tables: cell text/bindings, columns, row
  groups, group subtotals and explicitly dataset-wide report totals using Sum.
- Keyboard-accessible authoring controls and normal VS Code document services.

The XML TextDocument is authoritative. Visual changes use validated, minimal,
atomic patches; untouched source, namespaces and unsupported content stay in
place. Referenced or potentially referenced destructive changes are refused.
See the [compatibility contract](specs/001-rdlc-vscode-editor/contracts/compatibility.md).

## Boundaries and evidence

This is an authoring surface, not a report renderer: expressions, embedded code,
queries and external resources are not executed. Images, charts, rich text,
matrices, spanning cells, unknown field types and unsupported structures are
preservation-only. Unsupported versions, multiple sections, required unknown
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
