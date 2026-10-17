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
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:roundtrip
pnpm test:compatibility
pnpm build
pnpm package
pnpm test:vscode
pnpm test:package
```

Expected results:

- `format:check`: pinned Prettier checks maintained source/configuration/documentation without rewriting files; generated and vendored material is excluded.
- `typecheck` / `lint`: both applications and all workspace libraries pass without cross-layer dependency violations.
- `test:unit`: domain tests run independently of VS Code/Angular; Angular component tests validate Signals-driven updates and accessible controls using the Angular test builder.
- `test:roundtrip`: exact no-op equality and edit-footprint preservation checks pass for all applicable fixtures.
- `test:compatibility`: fixture/specification rule matrix passes; unsupported and malformed cases produce expected non-destructive diagnostics. External-consumer verification is separately reported, never implied by this command.
- `build`: production-builds bundled extension code and local AOT Angular HTML/CSS/JS/assets, with no CDN or server dependency.
- `test:vscode`: official Electron harness verifies lifecycle, synchronization, stale-message rejection and failed/conflicting saves. Initial harness download may require network; prepare/cache it before disconnected validation.
- `package`: creates `dist/rdlc-code-MAJOR.MINOR.PATCH.vsix` using the validated extension version, containing all runtime assets and required notices, with no development server or external runtime requirement. Release publishers consume this file without rebuilding.
- `test:package`: installs that local VSIX in an isolated profile and checks offline local assets, isolation, manifest identity and notices using the existing VS Code harness; it does not rebuild or publish the package.

The installed offline manual acceptance below is mandatory even when automated tests pass. A future offline integration script may automate it, but no additional framework is prescribed.

## Install and validate offline

```sh
code --install-extension dist/rdlc-code-1.2.3.vsix
```

Replace illustrative version `1.2.3` with the actual package version. Use a clean VS Code profile and the packaged extension, disconnect networking, and verify the following scenarios. Record OS, VS Code/Electron versions, extension version, fixture IDs and reference-workstation details. Also inspect the packaged asset graph, CSP and active listeners; merely disconnecting the network does not prove there were no attempted requests.

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

Initial-release policy (2026-10-18): retain keyboard acceptance and automated
budget tests. The detailed timing protocol below, five-author usability study
and independent contributor reproduction are optional, not release blockers.
The required three-OS automated matrix includes macOS; a separate interactive
Mac session is not required. See `contracts/ci-cd.md` for mandatory evidence.

With the keyboard alone, complete create/select/property edit/delete, dataset/field/table/column/group/total editing, undo/redo and save; verify labels, visible focus and no focus traps. For a 1 MiB (1,048,576 bytes)/100-textbox supported fixture, measure 20 opens and 100 property interactions against SC-004: open command to painted first accepted snapshot with supported property controls enabled, each time starting with a closed report editor and fresh webview in running VS Code; valid property commit to the corresponding painted accepted document change. Record failures rather than assuming performance from the architecture.

## Completion evidence

Retain command exit codes, test summaries, fixture/specification coverage, preservation comparisons, lifecycle results, network/listener observations, accessibility/performance measurements and packaged dependency/license inventory. Record [V1–V10](plan.md#technical-decisions-requiring-validation) as proved, failed or unverified. Any failed mandatory gate blocks release; absent runtime-consumer evidence blocks that compatibility claim, not offline source authoring.

## Planned GitHub and marketplace setup

Complete these prerequisites before the first tag, after automation is implemented:

V9 and V10 are approved design decisions (2026-10-15). The checks below establish technical
readiness, not renewed design approval. Preserve all existing V1–V8 validation obligations.

1. Commit exact `.node-version`, root `packageManager`, tool versions and `pnpm-lock.yaml`.
   Configure GitHub Actions and required aggregate CI checks on protected `main`; protect release
   tag creation and forbid tag update/deletion. Restrict workflow changes through review.
2. Configure the reviewed extension manifest's publisher/name, `MARKETPLACE_PUBLISHER` and
   optional `OPENVSX_NAMESPACE`. Destination identities must match the publisher embedded in
   the canonical VSIX; they are configurable without workflow edits, not post-tag overrides.
   Create/verify the VS Code publisher identity and extension ID. Configure Microsoft Entra
   federation to the protected release environment, authorize its identity in the publisher,
   and set `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` plus identity-specific login configuration as
   GitHub configuration. Complete the
   [GitHub-only Entra procedure](contracts/ci-cd.md#entra-federation-procedure-and-confirmation-boundary),
   including Marketplace Contributor membership and a controlled pinned-toolchain publication.
   Component support is documented; this end-to-end authentication is not yet tested and blocks
   first publication until confirmed. Do not introduce Azure Pipelines. Direct
   Marketplace `vsce --oidc` is not the selected strategy. A temporary PAT fallback requires
   explicit validation because global PAT retirement is announced for 2026-12-01.
3. Optionally create the matching Open VSX namespace, accept its Publisher Agreement and store
   `OVSX_PAT` in GitHub Actions Secrets for automatic first publication. For subsequent versions,
   register the trusted publisher and set `OPENVSX_AUTH_MODE=oidc`, removing the PAT. No Open VSX
   configuration means a documented skip; invalid configured authentication fails.
4. Restrict publishing environments to protected release tags without manual approvals. Grant
   read-only build permissions, job-local GitHub release write permission and OIDC permission
   only to federated publishers. Set artifact retention to 90 days within repository policy.
   Keep all credentials out of files, shell arguments and logs.

GitHub Releases use the job-scoped `GITHUB_TOKEN`, with `contents: write` confined to their
publication job. Accounts, namespace ownership, agreements and necessary roles/permissions must
be configured before the first release; none are presumed to exist from this design approval.

The full trigger, permission, credential and recovery rules are in the [CI/CD contract](contracts/ci-cd.md).

## Planned new-version procedure

1. Choose the next stable SemVer using gitmoji-prefixed Conventional Commits and compatibility
   impact. Prepare a PR synchronizing root and extension `package.json.version`; update the
   lockfile if needed. Do not synchronize unrelated private workspace package versions.
2. Review/merge the version-preparation PR, then perform final mandatory acceptance on that exact
   version-prepared main commit. Record its identity, tool versions, evidence paths/results and
   configured destinations in `docs/validation/release-readiness.md`. Commit results only in
   explicitly listed validation-evidence Markdown under `docs/validation/`; any other change,
   including versions, requires renewed applicable verification and a new candidate record.
   Confirm green main CI and run the planned `scripts/validate-release.ts` evidence/identity
   checks against the intended release commit. Unconfigured Open VSX is not-configured and does
   not block release; invalid configured authentication does. Release automation rechecks the
   tag, evidence freshness and all automated gates independently before uploading artifacts.
3. Create and push an immutable annotated tag; for illustrative version `1.2.3`:

   ```sh
   git checkout main
   git pull --ff-only
   git tag -a v1.2.3 -m "Release 1.2.3"
   git push origin v1.2.3
   ```

4. Observe the automatic tag workflow: strict version checks, frozen install, quality gates,
   production build, versioned VSIX/manifest, generated notes, GitHub Release, Marketplace,
   then configured Open VSX. No approval, local package upload or manual publication follows
   the tag. The GitHub attachment and all marketplace uploads originate from the same VSIX.

## Planned CI/CD validation and recovery scenarios

Run these scenarios in a controlled test repository/publisher namespace during V10, after
implementation; do not exercise intentionally failing publications on production versions.

| Scenario | Expected result |
|---|---|
| Fork PR and main push | All root quality checks run; fork/same-repository PRs receive no publication secrets; no release is created |
| Broken formatting, lint, types, unit, roundtrip, compatibility or build | Required check fails and no artifact/release/marketplace upload occurs |
| Missing/stale lockfile or cold cache | Stale/missing lockfile fails; cold cache still completes with frozen install |
| Malformed `v*.*.*` tag or tag/package mismatch | Release stops before publication and names the invalid metadata |
| Valid tag on reviewed main history | All gates pass; exact tag/commit and package version are recorded; one canonical versioned VSIX is distributed |
| Modified handoff VSIX or conflicting existing release | Explicit digest/provenance failure; no replacement or silent duplicate skip |
| Missing Open VSX configuration | Mandatory GitHub/Marketplace delivery succeeds; Open VSX is marked not-configured |
| Configured but invalid Open VSX authentication | Preflight fails clearly; optional does not mean failures are ignored |
| Marketplace/Open VSX failure after GitHub publication | Successful destinations remain; summary identifies the failed stage; failed-job rerun reuses the original verified artifact without compiling |
| Publish response lost, but remote version exists | Verify remote bytes or prior acknowledged success bound to the manifest; ambiguity fails instead of overwriting |
| Concurrent same-tag runs | Publication serialized without cancellation; matching completed destinations explicitly reused, conflicting ones fail |

For a transient failure, use GitHub Actions **Re-run failed jobs** on the original run, within
30 days/50 attempts and while its verified artifact remains available. Do not rerun all jobs
to rebuild a partially published version. Inventory all destination states and identify already
successful publications before any write. Compare the original tag/commit and manifest/hash
before resuming. A verified GitHub Release attachment may supply the same bytes; a moved tag,
missing proof, conflicting remote version or expired rerun window blocks automatic recovery.
Fix credentials in GitHub configuration; any correction needing different package bytes requires
a new version-preparation commit and new SemVer tag. Never move the old tag or replace its assets.

Retain the canonical Actions artifact, manifest and available gate/publication evidence for
90 days within repository policy. Keep the GitHub Release's original VSIX and manifest as the
durable public copy; do not delete/replace them for recovery. Retention does not extend the
30-day rerun limit. If neither retained storage nor the verified GitHub attachment provides
the canonical bytes and proof, stop; recompilation is not a recovery option.

**Unconfirmed remote-integrity prerequisite**: Before enabling an existing-version recovery
path, demonstrate remote-byte identity or reliable prior acknowledged publication tied to the
canonical digest. Marketplace download identity is not confirmed. A duplicate-version response,
version number or registry signature alone is insufficient. If the association cannot be proved,
report an explicit conflict without overwriting; do not assume an undocumented integrity API.
