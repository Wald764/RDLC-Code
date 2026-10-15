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

## R9 — GitHub Actions, reproducible checks and version synchronization

**Decision**: GitHub Actions alone runs PR/main CI and tag releases using the same pnpm root
scripts. Read exact Node from `.node-version` and pnpm from `packageManager`, use the frozen
lockfile and cache only the pnpm store. Preserve all TypeScript/Angular/domain decisions R1–R8.
Use pinned Prettier for check-only formatting, excluding generated/vendored material, and the
existing planned ESLint/TypeScript/test scripts for their respective quality checks.
Release tags are canonical stable SemVer; synchronize root and extension versions in a reviewed
pre-tag commit, leaving private workspace package versions independent. Never bump during release.
Use gitmoji-prefixed Conventional Commits as required by `AGENTS.md`, interpreting the conventional
subject after removing its shortcode prefix.

**Rationale**: A tagged source tree must already declare the version it publishes. Fail-fast
equality checks avoid silently publishing different metadata. Shared script contracts keep
developer, PR and release checks aligned without another orchestration framework. All PRs are
checked because constitution 1.1.0 is broader than only PRs targeting main.

**Alternatives considered**: CI-side version injection, automatic bump/tag bots, independent
marketplace builds, other CI platforms and cached `node_modules` add inconsistency or conflict
with explicit requirements. No release-management bot or new application dependency is needed.

**Sources**: [SemVer](https://semver.org/),
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
[pnpm CI](https://pnpm.io/continuous-integration),
[pnpm frozen lockfile](https://pnpm.io/cli/install#--frozen-lockfile),
[GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## R10 — Publishing authentication and trust

**Approval**: V9 accepted by the user on 2026-10-15, including configurable publisher/namespace
identities and pre-release account/role setup. This is not an authenticated compatibility test.

**Decision**: Prefer GitHub OIDC to Microsoft Entra workload identity federation, an authorized
Marketplace identity and `vsce --azure-credential` for Visual Studio Marketplace. Do not rely on
direct `vsce --oidc` yet: current CLI documentation is ahead of backend availability. Reserve
`VSCE_PAT` as a temporary validated fallback, not the long-term default. Open VSX first publication
uses optional `OVSX_PAT`; after an active version exists, use registered trusted publishing when
explicitly configured. Isolate publication jobs from source execution and PR credentials.

**Rationale**: Official VS Code documentation supports Entra credentials and documents global
PAT retirement on 2026-12-01. Azure documents GitHub federated login. Open VSX supports GitHub
trusted publishers but requires an existing active extension version and namespace ownership;
bootstrap therefore still needs PAT authentication. Repository/environment tag restrictions
remain necessary because Open VSX trusted registration does not itself restrict tag refs.

**Alternatives considered**: Hardcoded credentials, broad personal GitHub tokens, publication
secrets in build/PR jobs and assuming npm trusted-publishing support applies here are rejected.
PAT-only Marketplace delivery is unsuitable as the durable default. Direct Marketplace OIDC
must wait for demonstrated backend support, not merely a CLI option.

**Sources and limits** (checked 2026-10-15; revalidate under V9):
[VS Code publishing and secure authentication](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
[Azure GitHub OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect),
[`vsce` credential implementation](https://github.com/microsoft/vscode-vsce/blob/main/src/auth.ts),
[Marketplace direct OIDC limitation](https://github.com/microsoft/vscode-vsce/issues/1275),
[Open VSX publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions),
[Open VSX trusted publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing).
Publisher-specific tenancy, identity membership, namespace ownership and credentials have not
been configured or tested; they are V9 validation requirements rather than presumed capabilities.

**Confirmation boundary**: A targeted recheck confirms that official Azure documentation supports
GitHub OIDC login for Entra applications and user-assigned managed identities. Official VS Code
documentation supports `--azure-credential` (its sample uses Azure Pipelines), and the inspected
`vsce` source includes `AzureCliCredential` and scope
`499b84ac-1321-427f-aa17-267ca6975798/.default`. These establish the component capabilities, not a
successful project-specific GitHub-to-Marketplace publication. The pinned-version end-to-end
test is a blocking first-release prerequisite. Follow the
[GitHub-only setup procedure](contracts/ci-cd.md#entra-federation-procedure-and-confirmation-boundary);
no Azure Pipelines, service connection or invented token exchange is introduced.

## R11 — Canonical VSIX, automatic notes and partial-release recovery

**Approval**: V10 accepted by the user on 2026-10-15. A single canonical VSIX per version and its
SHA-256 are mandatory across all three destinations. Existing successful publications must be
identified before resuming; approval does not establish remote-integrity capabilities.

**Decision**: Validate and test tagged source; package one canonical production VSIX after the
quality matrix. Distribute those exact bytes with pinned `vsce`/`ovsx` prebuilt-package options.
Generate notes with GitHub's release-notes API and publish GitHub assets before Marketplace and
configured Open VSX. Use a manifest, VSIX SHA-256 and immutable artifact ID to bind all stages.
Rerun failed destination jobs within GitHub's rerun window without rerunning the successful build.
Existing remote versions require matching bytes or reliable prior success evidence bound to
this artifact; otherwise report a conflict. Do not delete, replace or silently skip duplicates.

**Rationale**: Artifact archive digests are not VSIX digests, and automatic download digest
checks can warn rather than fail. Explicit local VSIX verification is required. Job reruns keep
the original ref/SHA/run ID but change the attempt. Separate publisher jobs make partial success
recoverable without compilation. There is no atomic transaction across the three destinations.

**Alternatives considered**: Rebuilding for each marketplace, `--skip-duplicate`, uploading with
overwrite, retagging and rolling back successful remote publications lose identity or history.
An unacknowledged timeout cannot be treated as successful just because the version exists.

**Sources and limits**:
[GitHub artifact immutability](https://github.com/actions/upload-artifact#overwriting-an-artifact),
[artifact digest validation](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow#validating-artifacts),
[rerun limits and behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs),
[generated release notes API](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release),
[`vsce` prebuilt publication](https://github.com/microsoft/vscode-vsce),
[`ovsx` publication/download](https://github.com/eclipse-openvsx/openvsx/blob/master/cli/README.md).
GitHub reruns are limited to 30 days and 50 attempts. Open VSX exposes version-specific package
downloads; Marketplace version existence alone does not establish original-byte identity.
No official guarantee of unchanged downloaded Marketplace bytes was established. Ambiguous
existing publications fail closed; V10 must exercise the actual recovery evidence path.

**Blocking prerequisite**: Resolve the actual supported remote association method before enabling
recovery for an existing marketplace version. A successful prior publisher job bound to the
manifest/digest can establish provenance; remote version existence cannot. If exact remote
bytes cannot be verified and reliable prior-success evidence is absent, stop with an explicit
conflict. Do not fabricate a registry checksum API or weaken the canonical-artifact rule.
The 90-day retained artifact and durable GitHub attachment permit reuse of the same bytes;
neither extends GitHub's 30-day/50-attempt rerun window. Missing/expired evidence forbids rebuild
as a recovery substitute.

## Supersession and research closure

Repository inspection found an architecture-neutral feature specification and an unfilled plan template, not an existing implemented architecture. The current direction explicitly excludes incompatible backends, HTTP transport requirements, alternative UI frameworks and lossy whole-document regeneration. No constitution change is needed.

All initial planning questions have selected decisions above; there are no unresolved requirements
clarifications. Pending V1–V8 remain unchanged technical proof/acceptance items; V9–V10 are
user-approved design decisions with unresolved operational publication/recovery prerequisites,
not pending design approvals. The CI/CD
amendment extends the existing design under constitution 1.1.0 without modifying functional
specifications. Missing evidence blocks the corresponding release claim or unsafe operation,
not an implicit fallback or loss of unsupported XML.
