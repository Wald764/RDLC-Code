# User Story 1 verification: safe existing-report edit

Date: 2026-10-16. Scope: T019–T033 only. Evidence applies to the source tree
carrying this record; later stories and release tasks remain unchecked.

## Environment

- Windows x64, OS build `10.0.26300` (same reference workstation as
  [foundations](foundations.md)).
- Node `v24.22.0`, matching the declared engine range `>=24.15.0 <25` and the
  version pinned in [toolchain](toolchain.md). The shell's default `node` on
  `PATH` was an older `v22.22.3` install, so the pinned `v24.22.0` directory was
  prepended to `PATH` for the run below.
- pnpm 11.28.2, TypeScript 6.0.3, Angular 22.2.3, official test-electron 3.1.0.
- VS Code 1.142.0 (resolved stable) for the Electron acceptance run. The 1.110.0
  minimum was not re-run for the designer surface in this phase.

All repository scripts were exercised through `pnpm` under Node 24 with the
workspace root unchanged.

## Fixtures and exact edit footprints

New synthetic MIT fixtures, all cited in `tests/fixtures/manifest.json`:

| Fixture (`tests/fixtures/textboxes/`) | Bytes | Projection                                            | Capabilities                                                        |
| ------------------------------------- | ----- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `supported.rdlc`                      | 1481  | editable, one body textbox                            | `textbox,name,text,left,top,width,height,style`                     |
| `supported-plus-opaque.rdlc`          | 2112  | editable; rich text, expression geometry, foreign XML | `Dynamic`: `…,text,style` but no `width`; `Rich`: no `text`/`style` |
| `unsupported-profile.rdlc`            | —     | source-only (RDL 2010/01), `REPORT_SOURCE_ONLY`       | `source`                                                            |

Measured patch plans for `supported.rdlc` (byte offsets, single patch each):

| Edit                                   | Patch range | Kind                           | Namespace deps |
| -------------------------------------- | ----------- | ------------------------------ | -------------- |
| `name` → `Heading`                     | 410–415     | `Name` attribute value         | 0              |
| `text` → `Goodbye <world> & "friends"` | 875–894     | `<Value>` inner text (escaped) | 0              |
| `color` → `#112233`                    | 603–603     | insert inside existing `Style` | 1              |
| `fontSize` → `18pt`                    | 661–665     | replace `<FontSize>` inner     | 0              |

A missing textbox-level element (e.g. `Width`) inserts a zero-length patch before
the first following element in the version-specific order and records one
namespace dependency for the in-scope RDL prefix.

## Executed checks

All commands below were run through `pnpm` under Node 24.22.0 and exit with code 0
after corrections.

| Check                            | Result | Verified scope                                                                                                     |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | PASS   | Nine workspace projects resolved from the pinned lockfile under Node 24                                            |
| `pnpm format:check`              | PASS   | Maintained files; fixtures and generated/reference material excluded                                               |
| `pnpm lint`                      | PASS   | Host/domain/tooling boundaries and Angular source                                                                  |
| `pnpm typecheck`                 | PASS   | Strict host/domain/tooling types plus `ngc` Angular template type-check                                            |
| `pnpm test:unit` (Node)          | PASS   | 24 tests: protocol, candidate verification, commit-convention, expressions, projection, **renderer scenes**        |
| `pnpm test:unit` (Angular)       | PASS   | 7 tests: shell + editor surface (snapshots, selection, forms, disabled capabilities, diagnostics, keyboard commit) |
| `pnpm test:roundtrip`            | PASS   | 8 tests: 2 lexical + 6 textbox no-op/edit/escape/insertion/refusal                                                 |
| `pnpm test:compatibility`        | PASS   | 5 tests: 2 manifest/expected-behavior + 3 textbox projection                                                       |
| `pnpm build`                     | PASS   | Domain libraries, bundled host, Angular AOT assets, `build/designer/index.html` with the nonce placeholder         |
| `pnpm package`                   | PASS   | `dist/rdlc-code-0.1.0.vsix`, 11 files, 76.44 KiB, includes `extension.cjs` and `designer/` assets                  |
| `pnpm test:vscode`               | PASS   | 2 Electron suites: `activation.test.cjs` and `existing-report.test.cjs` on VS Code 1.142.0                         |
| `pnpm test:package`              | PASS   | Installed-VSIX bootstrap assertion + both Electron suites against the packaged extension                           |

The Angular production build propagates `nonce="__CSP_NONCE__"` to the emitted
`<script>`/`<link>` and keeps the `ngcspnonce` placeholder on `rdlc-root`; the host
`renderWebviewHtml` replaces the placeholder, drops `<base>`, rewrites asset URLs to
`asWebviewUri` and injects a restrictive CSP (`default-src 'none'`, `connect-src 'none'`,
`base-uri 'none'`, `form-action 'none'`).

## Safety assertions exercised

- Editable only with exactly one `Paragraph`/`TextRun`/`Value` and no child
  elements; rich text, expression-valued geometry and run-level style stay
  preservation-only while the item remains visible as a labeled placeholder.
- FR-005 properties (`name`, `text`, `left`, `top`, `width`, `height`,
  `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `color`, `textAlign`) are
  validated before patching: nonnegative positions, positive dimensions, valid
  colors, 1pt–200pt font size, printable local font families, supported
  weight/style/alignment and report-wide unique names.
- XML escaping is applied only to changed values; foreign attributes, foreign
  elements, comments/CDATA and namespace bindings are byte-exact outside the
  single intended footprint.
- Node ids are version-scoped, so stale/foreign targets are rejected by the host
  binding. Selection is cleared across document versions: source edits can reorder
  scene items, so an ordinal cannot safely identify an item in a later snapshot.
- A refused edit performs no mutation; the acceptance test asserts the document is
  unchanged after a blocked rich-text edit.
- No-op save is byte-exact; save/reopen returns the edited text; the virtual
  source is the sole authority (one `WorkspaceEdit` per logical action, no disk
  writes).
- Scenes contain no executable HTML, scripts, URLs, remote resources or evaluated
  values — only geometry, labels and unevaluated authored strings.

## Resolved verification failures

Tests were written before the serializer, renderer, host session and Angular
surface; compilation initially failed on the new modules, then:

- the serializer imported `TextboxProperty` from the wrong module and a validation
  control-character pattern tripped `no-control-regex`;
- the renderer skipped foreign-namespace report items instead of showing them as
  unsupported placeholders;
- the Electron acceptance used `requestId`/payload-derived ids containing spaces,
  `&` and `.`, which the bounded protocol id rejected (fixed to a safe sequence),
  and re-used a stale target id after each accepted edit because ids embed the
  document version — the host syncs its binding before reporting success. The
  surface requires explicit reselection after a version change; host acceptance
  tests resolve ids from the latest snapshot.

## Remaining validation boundaries

- VS Code 1.110.0 (declared minimum) has not been re-run for the custom editor and
  Angular-in-webview path; only stable 1.142.0 passed.
- CSP/offline isolation is proven structurally (build output, `webview.ts`
  transform and the protocol/scene validators) but not observed against a live
  renderer request log or a disconnected network with the packaged VSIX.
- The manual offline acceptance in
  [quickstart](../../specs/001-rdlc-vscode-editor/quickstart.md) scenario 1 (packaged
  VSIX, untrusted workspace, rich/unsupported fixtures) has not been performed
  by hand; `test:package` runs the automated suites against the installed VSIX only.
- Visual editing is limited to body-level textboxes; table-cell textboxes project
  with a `table-cell` context and are shown as read-only placeholders. Table-cell and
  new-textbox authoring belong to later stories.
- Unsupported non-textbox items are rendered as placeholders without geometry
  inference; SC-004 open-latency and 100-interaction performance targets are not
  measured.
- No Microsoft designer or RDLC runtime/version acceptance is claimed; all
  `consumerEvidence` remains null.
