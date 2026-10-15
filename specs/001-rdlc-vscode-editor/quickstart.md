# Quickstart: Planned Build and Acceptance Validation

**Status**: Future validation guide, not an executable setup delivered by this design phase. The repository currently contains specifications/reference material only. Package manifests, scripts, application code and tests described below must be created in the implementation phase. Running these pnpm commands now is expected to fail because those files do not exist.

## Prerequisites

- Node.js 24 LTS ≥24.15.0 and pnpm 11.x, with exact versions pinned after [V1](plan.md#technical-decisions-requiring-validation).
- Desktop VS Code; validate the proposed minimum 1.110 and current stable on Windows, macOS and Linux.
- A checked-out repository and dependency access for initial development setup, or a prepopulated pnpm cache for offline build setup. Installed extension users need only VS Code and the packaged VSIX.
- Redistributable representative XML fixtures and their manifest described in [compatibility contract](contracts/compatibility.md).
- No .NET, C#, Java, Python, database, report-processing service or HTTP listener is required.

## Planned root script contract

The following commands define the scripts the implementation must expose; they are not present yet. Run from the repository root. First validate framework peer dependencies and commit exact tool/package versions plus `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:roundtrip
pnpm test:compatibility
pnpm build
pnpm test:vscode
pnpm package
```

Expected results:

- `typecheck` / `lint`: both applications and all workspace libraries pass without cross-layer dependency violations.
- `test:unit`: domain tests run independently of VS Code/Angular; Angular component tests validate Signals-driven updates and accessible controls using the Angular test builder.
- `test:roundtrip`: exact no-op equality and edit-footprint preservation checks pass for all applicable fixtures.
- `test:compatibility`: fixture/specification rule matrix passes; unsupported and malformed cases produce expected non-destructive diagnostics. External-consumer verification is separately reported, never implied by this command.
- `build`: produces bundled extension code and local AOT Angular HTML/CSS/JS/assets, with no CDN or server dependency.
- `test:vscode`: official Electron harness verifies lifecycle, synchronization, stale-message rejection and failed/conflicting saves. Initial harness download may require network; prepare/cache it before disconnected validation.
- `package`: creates `dist/rdlc-code.vsix` containing all runtime assets and required notices, with no development server or external runtime requirement.

The installed offline manual acceptance below is mandatory even when automated tests pass. A future offline integration script may automate it, but no additional framework is prescribed.

## Install and validate offline

```sh
code --install-extension dist/rdlc-code.vsix
```

Use a clean VS Code profile and the packaged extension, disconnect networking, and verify the following scenarios. Record OS, VS Code/Electron versions, extension version, fixture IDs and reference-workstation details. Also inspect the packaged asset graph, CSP and active listeners; merely disconnecting the network does not prove there were no attempted requests.

### 1. Safe existing-report edit

Open a supported fixture with an editable textbox plus foreign XML, comments and unknown attributes. Change text and position, save, and reopen. Only the intended values change; all unrelated source ranges and namespace bindings remain identical. Save without editing and verify exact text and, for supported encodings, bytes. See [source ownership](data-model.md#authoritative-representation).

### 2. New report, local dataset, grouped table and totals

Use `RDLC Code: New Report` (planned command label), configure page/body dimensions, add two textboxes, create dataset `Orders`, and add fields covering all seven supported types. Add a two-column table bound to it, create/change/remove a row group, and add/change/remove group and dataset-wide report totals. Save As `.rdlc`, reopen, and verify field metadata, application-data mappings, hierarchy placement and exact unevaluated expressions. No data is requested or displayed.

### 3. Reference safety and unsupported content

Attempt to rename/delete a referenced field/dataset/group. Expect affected-reference diagnostics and no mutation. Include an opaque expression/extension where dependencies cannot be excluded. Open rich-text, matrix, spanning-cell, unknown-type, unsupported-version and multisection fixtures; preservation-only capabilities and source access must match [the compatibility matrix](contracts/compatibility.md), with no conversion.

### 4. Document lifecycle and failure paths

Perform 20 visual edits and undo/redo all of them. Change valid source in a second editor and verify all visual views refresh. Introduce invalid source and try a stale visual action: source remains untouched and graphical writes are disabled. Test two views, delayed/duplicate requests, failed applyEdit, read-only save, Save As, close/cancel and external change while dirty. No pending work is silently lost; conflicts use normal VS Code resolution.

### 5. Offline isolation and untrusted content

Open fixtures containing embedded code, expressions, queries, remote/local external entities and remote resources in an untrusted workspace. Expect zero execution, resource retrieval, data access or report-triggered network requests. DTD-bearing input remains source-accessible without entity resolution. Confirm all Angular chunks/styles load locally under the restrictive CSP with no fallback server.

### 6. Accessibility and performance

With the keyboard alone, complete create/select/property edit/delete, dataset/field/table/column/group/total editing, undo/redo and save; verify labels, visible focus and no focus traps. For a 1 MiB/100-textbox supported fixture, measure 20 opens and 100 property interactions against SC-004. Record failures rather than assuming performance from the architecture.

## Completion evidence

Retain command exit codes, test summaries, fixture/specification coverage, preservation comparisons, lifecycle results, network/listener observations, accessibility/performance measurements and packaged dependency/license inventory. Record [V1–V8](plan.md#technical-decisions-requiring-validation) as proved, failed or unverified. Any failed mandatory gate blocks release; absent runtime-consumer evidence blocks that compatibility claim, not offline source authoring.
