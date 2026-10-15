# Phases 1 and 2 verification

Date: 2026-10-15. Scope: T001–T018 only. Evidence applies to the foundation source
tree committed with this record. Later story and release tasks remain unchecked.

## Environment

- Windows x64, OS build `10.0.26300`.
- Node 24.22.0 LTS, pnpm 11.28.2, TypeScript 6.0.3.
- Angular core/compiler/CLI/build 22.2.3, RxJS 7.8.2.
- saxes 6.0.0, xmlchars 2.2.0; vsce 3.7.1; official test-electron 2.5.2.
- VS Code 1.110.0 (candidate minimum) and 1.142.0 (resolved stable).
- actionlint 1.7.12, checked against the upstream archive SHA-256
  `6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`.

See [toolchain](toolchain.md) for registry/peer-dependency sources and the isolated
build Node checksum, and [licenses](licenses.md) for dependency review.

## Executed checks

All commands below exit with code 0 after corrections.

| Check                                         | Result | Verified scope                                                                                                       |
| --------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`              | PASS   | Nine workspace projects; pinned lockfile and reviewed lifecycle policies                                             |
| `pnpm format:check`                           | PASS   | Maintained files; generated/reference material excluded                                                              |
| `pnpm lint`                                   | PASS   | TypeScript and domain import boundaries                                                                              |
| `pnpm typecheck`                              | PASS   | Strict host/domain/tooling TypeScript and Angular templates                                                          |
| `pnpm test:unit`                              | PASS   | 21 Node tests and one Angular component test                                                                         |
| `pnpm test:roundtrip`                         | PASS   | Two lexical no-op/edited-footprint tests                                                                             |
| `pnpm test:compatibility`                     | PASS   | Two manifest/expected-behavior tests over four synthetic XML fixtures                                                |
| `pnpm build`                                  | PASS   | Domain libraries, bundled host, standalone zoneless static Angular AOT assets, discoverable CommonJS Electron suites |
| `pnpm package`                                | PASS   | `dist/rdlc-code-0.1.0.vsix`, 11 archive files, approximately 41.31 KiB                                               |
| `pnpm test:vscode`, `VSCODE_VERSION=1.110.0`  | PASS   | Scaffold discovery, activation, command registration and source opening on Windows                                   |
| `pnpm test:package`, `VSCODE_VERSION=1.110.0` | PASS   | Asset/bootstrap assertion plus installed-VSIX scaffold test in a separate profile                                    |
| `pnpm test:vscode`, default stable            | PASS   | Same scaffold assertions on Windows / VS Code 1.142.0                                                                |
| `pnpm test:package`, default stable           | PASS   | Same installed-VSIX assertions on Windows / VS Code 1.142.0                                                          |
| `actionlint .github/workflows/ci.yml`         | PASS   | Workflow syntax, expressions, jobs and runner configuration                                                          |

The installed test uses a separate, empty development harness, so the extension
under test is the installed VSIX rather than the development extension directory.
Each run uses distinct user-data and extension directories. Test discovery fails
if no Electron suites exist or a suite lacks its `run()` entry.

## Safety assertions exercised

- Complete lexical source coverage, BOM/CRLF, comments, processing instructions,
  CDATA, astral Unicode, raw quotes/entities and original UTF-16 ranges.
- Namespace rebinding and unprefixed-attribute semantics; duplicate expanded
  attributes, undefined prefixes, invalid characters/entities and malformed nesting
  are rejected without a recovered editable tree.
- DTD/entity declarations and XML 1.1 remain source-only. No entity registration,
  resolver, expression evaluation or resource retrieval is implemented.
- Proposed 16 MiB UTF-8 source, depth 256 and 100,000-element parsing budgets
  retain the original source when exceeded.
- RDL 2016/01, one complete section, section-owned width/body-owned height and
  unknown required MustUnderstand semantics; foreign XML remains source-owned.
- Bounded string-aware expression lexing, escaped quotes, static field/Sum scope
  references, preserved/query expression properties and conservative opaque analysis.
- Positive printable page area, preserved unit strings, case-sensitive scoped
  name checks, retained Unicode identifiers and ASCII generated names.
- Stale/overlapping/out-of-footprint/changed-expected-text patches and unresolved
  namespace dependencies are refused. Candidate reparsing verifies the supplied
  intention predicate, exact untouched source and unchanged namespace semantics
  for untouched descendants before any future WorkspaceEdit.
- Protocol v1 rejects unknown operations, paths, XML patches, stale/foreign IDs,
  duplicate requests, nonfinite geometry, nonplain or excessive payloads, cycles
  and host-only messages arriving at the host.

## Resolved verification failures

Tests were introduced before the parser, analyzer, projection, validation, patch
and protocol implementations; compilation initially failed on missing modules.
A namespace-rebinding regression test then demonstrated that byte preservation
alone was insufficient; candidate verification now checks untouched namespace
semantics as well.

Initial setup failures were corrected: explicit denials for optional native
lifecycle scripts; extension TypeScript module metadata; absolute VSIX output
path; copying Angular's generated license inventory; Angular test configuration;
nested generated-directory lint exclusions; package-local compiled library
resolution; and a genuine installed-extension test harness. The first minimum
VS Code ESM test-entry attempt hung; CommonJS Electron suites pass on both tested
versions. Earlier failed attempts are not counted as passes.

## Remaining validation boundaries

- The six-job Windows/macOS/Linux × minimum/stable CI matrix is defined with
  SHA-pinned actions, explicit runner labels, read-only permissions, a pnpm-store
  cache keyed by lockfile and tool declarations, frozen installation, Linux virtual
  displays and a fail-closed `Required checks` aggregate. It has not been run on
  GitHub; Linux/macOS results are unverified. There are no artifact uploads.
- These are scaffold activation/source-access checks, not report-editing lifecycle,
  Angular-in-webview, CSP/offline isolation, encoding, performance or usability
  acceptance. VS Code 1.110 remains an unverified minimum for the eventual designer.
- Four XML fixture records identify synthetic MIT provenance, citations, exact
  edit footprints, diagnostics and preservation expectations. `consumerEvidence`
  is null: no Microsoft designer or RDLC runtime/version acceptance is claimed.
  Future nonnull evidence must identify the exact consumer/version and reproducible
  evidence artifact. The final 12-fixture acceptance corpus belongs to later tasks.
- The scaffold commands provide source access and an explicit unavailable-designer
  message. No custom-editor provider, visual mutation pipeline or authoring UI is
  implemented. The foundation protocol only admits the typed `setProperty` shape;
  story-specific authoring operations and capabilities are added in later phases.
- Expression analysis intentionally supports a bounded subset; all unknown syntax
  is opaque. The inactive host binding caps accepted request IDs at 1,024 per
  binding and requires renewed binding thereafter; extend replay protection before
  enabling long authoring sessions.
- Publisher identity is provisional. Final shipped dependency/package auditing,
  parser notices when bundled, external compatibility and all release evidence
  remain required before public distribution. No tags, credentials or publication
  were created.
