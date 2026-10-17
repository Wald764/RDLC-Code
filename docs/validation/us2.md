# User Story 2 verification: local report authoring

Date: 2026-10-17. Scope: T034–T052. This record describes the implementation
working tree based on `3a34f6b5f6341df86d3ce8629e6a7f03bc82c16c`, not a
version-prepared release candidate or authorization to publish.

## Environment and compatibility correction

- Windows x64; Node 24.22.0 (the pinned NVM directory prepended to PATH),
  pnpm 11.28.2, TypeScript 6.0.3, Angular 22.2.3, test-electron 3.1.0.
- VS Code stable resolved to 1.142.0. Development and installed-VSIX suites pass.
- The additional 1.110.0 development run **failed**: opening an unassociated
  untitled document in the custom editor lost the template. Initializing the
  model after switching retained text but did not produce the required dirty
  state, even after waiting. These approaches were rejected, not counted as passes.
- Under plan V2's explicit minimum-version validation rule, the extension and
  CI minimum are now **1.142.0**. The harness manifest is aligned; the API typings
  remain 1.110.0 because no newer API is needed. Earlier versions are not supported.
  The final new-report command initializes an untitled document normally and
  re-resolves the live TextDocument after opening the custom editor.
- Newly authored untitled files follow VS Code's native EOL choice. The acceptance
  assertion normalizes EOL only when comparing a new template; save/reopen checks
  compare the actual document text and saved file without normalization.

## Implemented authoring profile

- New single-section RDL 2016/01 report through `RDLC Code: New Report`, native
  Save As, page dimensions/margins and body dimensions with positive printable area.
- Create/delete body textboxes, existing property/style forms, explicit deletion
  of contained XML, local field selection and unevaluated field bindings.
- Create/rename/delete local datasets and fields, and change known field types.
  All seven exact mappings are in [local-data](local-data.md). Existing application
  mappings, calculated expressions, queries and metadata stay in place. Empty
  datasets omit Fields and use the schema-supported `CaseSensitivity=Auto` default;
  removing the last field/dataset removes its now-invalid collection wrapper while
  retaining surrounding comments/whitespace, or refuses opaque container metadata.
- Create/delete tables, add/remove/resize columns, resize rows, change table
  position, edit cell literal/expression text, add/change/remove row groups and
  group/dataset-wide Sum total rows. Group insertion wraps one unambiguous detail
  member, including beneath an existing group; it does not flatten hierarchy.
- Scope changes move the explicit static footer row and matching hierarchy member
  atomically. Dataset-wide totals are outside dynamic groups; group subtotals are
  inside their named group. Labels explicitly distinguish the two semantics.
- Native labeled form controls and explicit commits cover every authoring action.
  Version changes recreate authoring forms, discard obsolete drafts and focus a
  stable authoring-region restart point. Host refusal diagnostics include affected
  reference locations. Unknown field types are read-only.
- Each logical action is one validated WorkspaceEdit. Candidate XML, intended
  projection, untouched source and surviving namespace semantics are verified
  before applying; no file writer, data access or expression execution is introduced.

## Fixtures and measured footprints

Synthetic MIT fixtures are registered with provenance/citations in
`tests/fixtures/manifest.json`: `datasets/blank.rdlc`, `datasets/local.rdlc`,
`datasets/preserved.rdlc` and `tables/grouped.rdlc`. They cover all seven types,
query/calculated/unknown metadata preservation, two-column multirow hierarchy,
group subtotal and dataset-wide total. Tests also construct matrix, span,
opaque-reference and nested-group variants without broadening the profile.

The following actual patch plans were measured against the committed fixture
spelling. Each tuple is `(start, end, replacement length)` in UTF-16 code units,
zero-based and half-open. All source outside the declared footprints is exact.

| Fixture and operation                                   | Patch tuples                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `datasets/preserved.rdlc`: append NewField, Int64       | `(627,627,121)`                                                                                            |
| `datasets/local.rdlc`: Orders → Renamed                 | `(232,238,7)`                                                                                              |
| `tables/grouped.rdlc`: append Amount column, 0.5in      | `(632,632,49)`, `(1133,1133,208)`, `(1645,1645,209)`, `(2160,2160,209)`, `(2282,2282,29)`, `(2831,2834,5)` |
| `tables/grouped.rdlc`: append ByLabel subtotal          | `(1671,1671,485)`, `(2626,2626,66)`, `(2850,2855,5)`                                                       |
| `tables/grouped.rdlc`: move dataset footer into ByLabel | `(1671,1671,515)`, `(1672,2186,0)`, `(2626,2626,66)`, `(2657,2723,0)`                                      |

Per-row cell counts equal static column leaves; body row counts equal row-hierarchy
leaves, following MS-RDL §2.27/§2.29. The general §2.23 global-cell-count prose
ambiguity remains unresolved. No broader conformance is inferred (V5).

## Executed checks

All final checks below pass under Node 24.22.0, exit code 0.

| Check                                | Result and scope                                                         |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`     | Nine workspace projects; no dependency additions                         |
| `pnpm lint`, `pnpm typecheck`        | Domain boundaries, host/tooling and Angular templates                    |
| `pnpm test:unit`                     | 35 Node tests and 10 Angular tests                                       |
| `pnpm test:roundtrip`                | 14 tests, including full authoring sequences and atomic refusals         |
| `pnpm test:compatibility`            | 10 tests, including manifest, template, type and hierarchy assertions    |
| `pnpm build`                         | Bundled host and local Angular AOT assets                                |
| `pnpm package`                       | `dist/rdlc-code-0.1.0.vsix`, 11 files, approximately 95 KB               |
| `pnpm test:vscode` (stable 1.142.0)  | Activation, existing report and new report suites                        |
| `pnpm test:package` (stable 1.142.0) | Package bootstrap plus all three Electron suites with the installed VSIX |

The independent Electron scenario creates an untitled report, two textboxes,
Orders with all seven types, two columns, a row group and both scoped totals;
it checks refused referenced renames/deletions and exact native save/reopen.
An associated untitled URI supplies the test destination without an interactive
Save As picker. Angular tests submit native forms and activate buttons without
pointer gestures, verify labels, disabled unknown fields and the closed protocol
vocabulary. These are component checks, not a human usability study.

## Remaining evidence boundaries

- V4: **no external Microsoft designer/ReportViewer consumer/version proof** for
  these fixtures; see [local-data](local-data.md). Runtime compatibility remains
  unverified for every mapping. The installed extension requires no such runtime.
- V5/V6: synthetic structural, footer-placement and exact-expression checks pass;
  external consumer acceptance remains unverified. Matrix, spanning and opaque
  structural edits are refused; safe existing scalar text remains source-bound.
- macOS/Linux and an installed 1.142.0 three-OS matrix have not run locally.
  CI now targets the corrected minimum and stable versions.
- Full manual keyboard/focus traversal, native Save As dialog interaction,
  installed-webview interaction automation, disconnected network/listener
  observation, performance/usability and extended race/conflict/encoding tests
  remain the corresponding US3/phase-6 acceptance work. Harness-level session
  tests do not prove all of those behaviors.
- No tag, account setup, remote publication or release approval was performed.
