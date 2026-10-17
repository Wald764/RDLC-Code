# RDLC Code

An offline, source-preserving RDLC authoring extension for desktop VS Code
1.142.0 or newer. Use **RDLC Code: New Report**, **RDLC Code: Open Designer**
or **Reopen Editor With → RDLC Designer**. Use **RDLC Code: Open Source** for XML.
Save, Save As, undo and redo use the native text document.

Authoring supports single-section RDL 2016/01, simple textboxes, page/body
properties, local datasets with seven field types, and supported unmerged tables
with row groups, Sum subtotals and dataset-wide report totals. All assets are
local; expressions, queries, code and report resources are never executed.

Unsupported content stays in source, with affected unsafe edits blocked. Rich
text, matrices, spanning cells, images and charts are preservation-only. This is
a design surface, not a report-processing engine or a claim of universal RDLC
runtime compatibility. Web/remote workspaces are not supported targets.

Development package: final release acceptance, multi-OS installed isolation and
publishing authentication remain unverified. Publisher identity is provisional.
Original code is MIT licensed; see the bundled third-party notices.
