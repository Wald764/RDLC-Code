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
performance/usability and multi-OS evidence still have outstanding obligations.
See [validation records](docs/validation/) and [release requirements](docs/releases.md).

## Development

Use [CONTRIBUTING.md](CONTRIBUTING.md). Architecture and acceptance scenarios are
in [the feature specification](specs/001-rdlc-vscode-editor/spec.md).
Microsoft reference material in `vendor/` is read-only and retains its own
notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
