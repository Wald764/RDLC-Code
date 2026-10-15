# Phase 0 Research: TypeScript-Only RDLC Architecture

**Date**: 2026-10-15. **Status**: Design decisions selected; validation is not implementation evidence. [Plan validation items](plan.md#technical-decisions-requiring-validation) track remaining proofs. Research used two scoped agents for Angular/VS Code and MS-RDL/RDLC, plus targeted XML-library review.

## R1 — Platform, workspace and offline execution

**Decision**: Use TypeScript-only application logic, pnpm 11 workspaces, official VS Code APIs, and a bundled static Angular application. No backend, local HTTP server, language bridge, report runtime or network requirement after installation.

**Rationale**: Meets the user constraints directly. A webview already provides the browser environment, isolation, local resource scheme and messaging channel. Separate host and browser builds avoid coupling the extension-host Node version to build-time Node.

**Alternatives considered**: .NET/ReportViewer backend, Java/Python services, localhost REST server, external browser designer and non-Angular UI are incompatible. A monorepo orchestration framework adds no demonstrated requirement beyond pnpm recursive scripts.

**Evidence**: [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview), [pnpm 11 release](https://pnpm.io/blog/releases/11.0). Installation/build may download dependencies; installed report authoring must not. A separately prepared offline development cache can support `pnpm install --offline --frozen-lockfile`; this is distinct from extension runtime.

## R2 — Recent Angular and state management

**Decision**: Angular 22.2.x with aligned CLI/build packages, TypeScript 6.0.x, build Node 24 LTS ≥24.15.0, pnpm 11.x, SCSS, standalone components, AOT, Signals and computed state. Use zoneless defaults. Keep Angular's required RxJS dependency without introducing NgRx or another state store.

**Rationale**: Official release schedule places Angular 22.2 in September 2026; the researched documentation identifies build 22.2.3. The v22 compatibility row specifies TypeScript `>=6.0.0 <6.1.0` and Node `^22.22.3 || ^24.15.0 || ^26.0.0`. Signals fit immutable accepted snapshots and local UI state; Angular 21+ defaults to zoneless operation.

**Alternatives considered**: Angular 20 is near its listed November 2026 support end; older unsupported releases are unsuitable. Zone.js and a global RxJS state architecture are unnecessary for this application. Runtime compilation and SSR add no value inside a packaged webview.

**Evidence and limit**: [Compatibility table](https://angular.dev/reference/versions), [release policy](https://angular.dev/reference/releases), [Signals](https://angular.dev/guide/signals), [zoneless](https://angular.dev/guide/zoneless), [standalone components](https://angular.dev/guide/components). The table does not separately list every 22.x minor: verify the selected 22.2 package peer dependencies and exact patch availability before committing a lockfile (V1). No dependency versions are installed in this design step.

## R3 — Native document authority and synchronization

**Decision**: `CustomTextEditorProvider`, one authoritative TextDocument per URI, one WorkspaceEdit per logical visual action, versioned request messages, document-change-driven snapshots, no separate visual undo history or direct disk writes.

**Rationale**: XML is a text format. The official text custom-editor API supplies dirty/save/backup behavior and integrates source edits and text undo. Invalid source is a normal editing state, not a reason to overwrite it with a stale model. Recheck versions after asynchronous work and handle a false `workspace.applyEdit` result.

**Alternatives considered**: `CustomEditorProvider` with a custom binary document duplicates text lifecycle management. Serializing a mutable Angular model on save loses source edits. File watchers cannot represent unsaved TextDocument state. Forced disk writes bypass conflict protection.

**Evidence**: [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors), [applyEdit API](https://code.visualstudio.com/api/references/vscode-api#workspace.applyEdit). Proposed VS Code minimum 1.110 is subject to actual webview/API compatibility checks (V2/V8), not derived from Angular's build Node requirement.

## R4 — Lossless XML and justified dependency

**Decision**: Source-span-preserving syntax representation plus minimal patches. Propose `saxes` 6.x for strict namespace-aware well-formedness; retain raw lexical tokens independently of SAX decoded values. Stop on parser error. Reject DTDs for visual authoring; never resolve external entities or register custom entities.

**Rationale**: Node does not supply a native lossless XML parser. Browser DOMParser/XMLSerializer cannot retain original spelling, attribute ordering, CDATA, entities and source formatting, and does not run natively in the extension host. A reviewed strict XML dependency is smaller and safer than writing the XML well-formedness rules from scratch. `saxes` is TypeScript-authored, reports namespace/position information, and does not itself fetch DTDs. Its events are insufficient as a lossless serializer, so lexical coverage must be proved separately.

**Alternatives considered**: Whole-document DOM/object serialization fails preservation. A regex parser fails nesting, quoting and namespaces. Implementing a complete XML validator duplicates a mature security-sensitive dependency. An XML-to-JSON library without source spans does not solve the actual requirement.

**Evidence**: [saxes README](https://github.com/lddubeau/saxes#readme), [package metadata](https://github.com/lddubeau/saxes/blob/master/package.json): proposed 6.0.0 line, ISC license, `xmlchars` transitive dependency. MS-RDL §1.7 `vendor/01-introduction/1.7-vendor-extensible-fields.md` permits extension namespaces but does not require other tools to preserve them; this project's preservation guarantee is deliberately stronger. §2.3.1 `vendor/02-structures/2.3.1-report.mustunderstand.md` requires special treatment for mandatory extension semantics. Prove scanner/parser reconciliation and review shipped licenses before adoption (V3).

## R5 — Independent modules and rendering boundary

**Decision**: Five behavior packages (parser, XML serializer, validation, expression analysis, renderer) plus a shared immutable model. Renderer produces a pure design scene; Angular consumes it. Expressions are classified and analyzed, never evaluated.

**Rationale**: Separates trust-sensitive document changes from presentation and makes roundtrip verification possible without launching VS Code. The required rendering module need not become an RDLC execution engine, which the feature specification explicitly excludes.

**Alternatives considered**: Angular services containing XML mutation couple tests and UI. A general report runtime violates execution/scope constraints. A complete VB expression parser/interpreter is unnecessary; a bounded nonexecuting analyzer must mark unknown references conservatively rather than claim full understanding.

**Evidence**: Constitution §§III–IV; spec FR-006/FR-011/FR-018; MS-RDL §4 `vendor/04-security/4-security.md` identifies risks of expression/custom-code execution. [Module contracts](contracts/modules.md) define dependency direction.

## R6 — Version and table authoring profile

**Decision**: RDL 2016/01, exactly one section, supported simple textboxes, static-column table-shaped tablix, row groups and totals. Coordinate body columns/rows/cells with hierarchy leaves atomically. Group subtotals use static footer leaves inside the dynamic group; report totals are dataset-wide static footer leaves outside it, with explicit dataset aggregate scope. Do not silently substitute tablix-filtered totals.

**Rationale**: One section is a product boundary: MS-RDL permits multiple. Tablix is not a flat list of cells. Group identity, detail members, aggregate scope and footer placement must agree or a seemingly valid table becomes semantically wrong.

**Alternatives considered**: Matrix/spanning-cell authoring expands scope and safety requirements. Flat table serialization discards hierarchy. Unscoped totals can change meaning as hierarchy changes. A global count of all cells across all rows is not a usable multirow table invariant.

**Evidence**: MS-RDL §2.5 `vendor/02-structures/2.5-reportsections.md`; §2.23 `vendor/02-structures/2.23-tablix.md`; §2.27/§2.29/§2.31 corresponding `tablixrows`, `tablixcells`, `cellcontents` files; §2.81 `vendor/02-structures/2.81-group.md`; §2.34.5/§2.34.8 member group/footer rules; §2.341.7 `vendor/02-structures/2.341.7-aggregate-functions.md` for scopes.

**Original-source check**: The ambiguous §2.23 statement comparing column count to cells “within the tablix” is also present in the [official original online section](https://learn.microsoft.com/en-us/openspecs/sql_server_protocols/ms-rdl/e42fb86e-799a-4202-8845-ac38831efccb). It is not resolved by Markdown extraction. The selected unmerged profile uses the specific per-row rules in §2.29 and hierarchy invariants in §2.27; no claim of complete §2.23 conformance is made. Broader support remains blocked pending evidence (V5).

## R7 — Local datasets and declared field types

**Decision**: New datasets contain local field declarations without invented query/source connections; new fields use `DataField` equal to their name and designer-namespace `TypeName` metadata. Preserve existing queries, application-data mappings, calculated fields, missing/unknown metadata and namespaces. Seven mapping strings are defined in [data-model.md](data-model.md). Unknown types remain preservation-only.

**Rationale**: The 2016 schema allows omitted Query. `Field` requires exactly one of `DataField` or calculated `Value`. Designer CLR type-name metadata distinguishes decimal, Int64 and double without implying a CLR backend. `Field.Value.DataType` is not equivalent to the seven designer types.

**Alternatives considered**: Fake empty Query/CommandText metadata adds runtime assumptions. Treating every field as a string loses user intent. Using JavaScript numbers to represent field values is unnecessary because the editor never loads data. Inferring universal RDLC runtime acceptance from MS-RDL would overclaim compatibility.

**Evidence**: MS-RDL §2.325 `vendor/02-structures/2.325-dataset.md`, §2.325.9 `vendor/02-structures/2.325.9-dataset.query.md`, §2.328 `vendor/02-structures/2.328-field.md`, §2.332 `vendor/02-structures/2.332-query.md`. [Microsoft example with designer namespace/type names](https://learn.microsoft.com/en-us/openspecs/sql_server_protocols/ms-rdl/b60a7495-b47e-4af0-8c91-2f00b44e4e77) demonstrates String/Int32/Decimal. [Local ReportViewer integration](https://learn.microsoft.com/en-us/sql/reporting-services/application-integration/using-the-webforms-reportviewer-control?view=sql-server-ver17) demonstrates application-supplied data, not universal query-free 2016 compatibility. Boolean/Int64/Double/DateTime conventions and intended consumer versions require fixture evidence (V4).

## R8 — Packaging, security and test gates

**Decision**: Package local AOT chunks/styles with webview resource URIs and an explicit asset-only resource root. Use runtime style nonce via Angular `CSP_NONCE`, no network connections, no executable report HTML, and validated versioned messages. Test domain logic with Node's runner; use Angular's test builder and official VS Code Electron harness for applicable integration.

**Rationale**: Angular runtime component styles require more than an external-stylesheet allowance. A restrictive CSP and escaped bindings preserve the boundary between report text and application code. Unit tests alone cannot prove installed VSIX isolation, document lifecycle or namespace preservation.

**Alternatives considered**: CDN assets, remote fonts, development server, broad `unsafe-inline`/`unsafe-eval`, schema downloads and online validation fail offline/isolation constraints. A new general test framework for domain code is unnecessary.

**Evidence**: [Webview security and local resources](https://code.visualstudio.com/api/extension-guides/webview), [Angular CSP_NONCE](https://angular.dev/api/core/CSP_NONCE), [VS Code extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension), [Node test runner](https://nodejs.org/api/test.html). See [compatibility gates](contracts/compatibility.md) and [validation guide](quickstart.md).

## Supersession and research closure

Repository inspection found an architecture-neutral feature specification and an unfilled plan template, not an existing implemented architecture. The current direction explicitly excludes incompatible backends, HTTP transport requirements, alternative UI frameworks and lossy whole-document regeneration. No constitution change is needed.

All initial planning questions have selected decisions above; there are no `NEEDS CLARIFICATION` entries. Pending V1–V8 are technical proof/acceptance items with stated failure behavior. Missing evidence must block the corresponding release claim or unsafe operation, not cause an implicit fallback or erase unsupported XML.
