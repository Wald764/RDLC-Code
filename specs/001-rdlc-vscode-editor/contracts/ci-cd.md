# CI/CD and Release Contract

**Status**: Design only. Workflow paths, scripts and records below are implementation contracts,
not existing automation. This extends the validated TypeScript/Angular/pnpm design under
constitution 1.1.0; it introduces no application service, runtime or functional scope change.

**Decision approval**: V9 and V10 were approved by the user on 2026-10-15. Approval concerns
the design, not proof of operational readiness. V1–V8 remain unchanged. GitHub Actions remains
the only CI/CD platform; using Entra as an identity provider does not introduce Azure Pipelines.

## Version and source authority

- Source hosting and CI/CD MUST use GitHub and GitHub Actions exclusively.
- Stable release tags MUST be canonical `vMAJOR.MINOR.PATCH`, with nonnegative decimal components
  and no leading zeros except zero itself. The broad trigger `v*.*.*` MUST be followed by strict
  validation; reject prerelease/build suffixes and malformed tags before installation/publication.
- The tag is authoritative. Strip exactly the initial `v` and require exact string equality with
  root `package.json.version` and `apps/vscode-extension/package.json.version`. These two release
  metadata fields MUST be synchronized in a reviewed version-preparation commit before tagging.
  Private designer/library packages retain their independent versions and `workspace:*` links;
  they are not separately published. Update `pnpm-lock.yaml` in that commit if metadata changes
  affect it. Release CI MUST NOT rewrite versions, create a version commit, or move the tag.
- Pin exact Node in `.node-version`, exact pnpm in root `packageManager`, and exact build/tool
  dependency versions in manifests plus `pnpm-lock.yaml`, within the already selected V1 ranges.
  CI reads these declarations rather than duplicating version numbers in workflows. Pin actions
  to reviewed full commit SHAs and record their upstream release; use an explicit runner image
  label rather than `*-latest`. Hosted image drift is recorded, not claimed bit-reproducible.
- Fetch the release tag and required main/tag history, resolve its commit (including annotated
  tags), and check out that detached commit. Verify it is on protected `main` history. Tags MUST
  be protected against unauthorized creation, updates and deletion. GitHub rulesets MUST protect
  main reviews and required checks; release code/workflows must come from reviewed source.
- Commit subjects use `:gitmoji: type(scope): description` per `AGENTS.md`, with an English
  imperative description. Conventional Commit interpretation removes only the leading gitmoji
  shortcode plus space. Permit the conventional breaking-change `!` and `BREAKING CHANGE:` footer.
  Validate PR titles and commit subjects; squash merges use the validated title. Commit categories
  inform human SemVer selection, not automatic version commits or tag creation.

## Workflow responsibilities and triggers

| Planned workflow | Trigger | Responsibility | Permissions / secrets |
|---|---|---|---|
| `.github/workflows/ci.yml` | Every `pull_request` (including PRs targeting `main`) and `push` to `main` | Run all quality gates; provide a stable required aggregate check | `contents: read`; no publication credentials or write token |
| `.github/workflows/release.yml` | `push` of tags matching `v*.*.*` | Validate, check, build and package tagged source, then publish the verified VSIX | Read-only build; `contents: write` only in GitHub publication job; platform credential only in its publisher job |

All PRs are included to meet the constitution's broader requirement. Do not use path filters
that suppress required checks. Cancel superseded PR checks to save work; serialize release runs
by tag without cancellation. Different runs MUST NOT race to publish the same version. No
`workflow_dispatch`, manual environment approval or marketplace confirmation is part of normal
delivery. GitHub's rerun controls recover failures; they are not an approval gate.

## Quality and build pipeline

Both workflows MUST invoke the same root script contracts, without duplicated test logic:

1. Install repository-pinned Node and pnpm. Cache the pnpm content-addressed store using runner
   OS, architecture, exact Node/pnpm versions and the `pnpm-lock.yaml` hash; never cache
   `node_modules`, publish credentials or a substitute release build. A cache miss is supported.
2. Run `pnpm install --frozen-lockfile`; a missing/stale lockfile fails. Respect pnpm's reviewed
   dependency lifecycle-script allowlist; never broadly enable unreviewed install scripts.
3. Run `pnpm format:check` (pinned Prettier, check-only), `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
   `pnpm test:roundtrip` and `pnpm test:compatibility`, in that order.
4. Run `pnpm build` in production mode for all domain packages, Angular AOT local assets and
   the VS Code extension. Inspect asset paths, required licenses and package contents.
5. Run `pnpm package`, `pnpm test:vscode` and `pnpm test:package` for packaged offline/isolation
   smoke validation against the proposed
   minimum and stable VS Code on Windows, macOS and Linux. Use the official Electron harness,
   with a virtual display on Linux. Browser/VS Code downloads are setup traffic, not permitted
   installed-extension/report traffic. Preserve accessibility, performance and other mandatory
   evidence from the compatibility contract; missing required evidence blocks release.

Unit and compatibility checks may run once on Linux; the lifecycle/packaged matrix covers all
three OSes. Jobs MUST propagate nonzero exits and expose a clear aggregate result; required
steps MUST NOT use `continue-on-error`. No artifact upload, GitHub Release or marketplace
publication is permitted until every required gate succeeds. Local package creation for tests
is not publication. PR jobs never receive publication secrets, including same-repository PRs.

## Package once and distribute

The release pipeline runs the quality sequence against the tag even if main CI already passed.
Matrix jobs build and locally package disposable test candidates from that same source to run
cross-OS installed checks; they upload no artifacts. Only after the complete quality matrix
passes does a secret-free Linux job build the universal TypeScript distribution in production
mode and package the canonical release VSIX with pinned `@vscode/vsce` into
`dist/rdlc-code-MAJOR.MINOR.PATCH.vsix`. It verifies that final package and runs the installed
offline smoke check before uploading anything. The universal package MUST contain no native or
OS-specific dependency. Cross-OS candidate tests are not claimed as byte-identical final-package
tests. Only one canonical release VSIX is handed off and published; publishers never rebuild it.

Packaging MUST verify the embedded VSIX version, publisher/name identity, production Angular
assets, bundled dependencies and notices. Compute a SHA-256 of the final VSIX. Record a release
manifest containing tag, resolved commit, version, extension ID, toolchain pins, lockfile hash,
VSIX filename/hash, workflow run identity and successful gate evidence. Do not include secrets.
The [release records](../data-model.md#release-provenance-records) define the data invariants.

After all gates pass, use a digest-checked Actions artifact for job handoff. Publisher jobs
download the artifact by its exact originating run/artifact identity and verify the manifest
and local VSIX hash. No implicit "latest artifact" lookup is allowed. Keep an explicit recovery
retention period of 90 days for the canonical artifact and its available gate/publication
evidence. Keep the GitHub Release VSIX and manifest as the durable copy after publication;
do not delete or replace them for recovery. Artifact expiry permits fallback to that copy only
when its original provenance and VSIX digest can still be verified.

A source-free preflight job MUST verify required authentication configuration and configured
Open VSX mode before the first external publication, using platform-supported identity checks
where available. It has publisher authentication but no application checkout, lifecycle scripts
or repository write token. Permissions that can only be confirmed by actual publication may
still fail later; those failures follow the partial-release recovery rules.

Publish sequentially with separately scoped jobs:

1. Generate release notes using GitHub's release-notes API with an explicit previous stable
   release tag in main history (omit for the first release). Record the comparison bounds and
   use the API result as the changelog; no invented notes or required hand-edited changelog.
2. Create the GitHub Release for the exact tag/commit, attaching the VSIX and manifest. Upload
   into a draft first, verify complete assets, then publish automatically. Do not mark an older
   maintenance release as latest ahead of a newer SemVer release. No asset replacement option.
3. Publish that VSIX with the pinned VS Code Marketplace CLI's prebuilt-package option. Disable
   any publish-time package/build hook; the publisher MUST NOT compile source or repack assets.
4. If Open VSX PAT or trusted-publisher authentication is configured, publish the same prebuilt
   VSIX with pinned `ovsx`. No configuration means an explicit `not-configured` skip; invalid
   configured authentication means failure, not a skip. Validate optional configuration before
   the first external publication.

## Authentication and trust boundaries

Use officially supported, maintained platform authentication subject to the remaining V9
publication prerequisites. GitHub Release creation uses the job-scoped `GITHUB_TOKEN`, not a
personal GitHub token, with `contents: write` only in the release-writing job and all other
permissions omitted unless individually required.

- Visual Studio Marketplace: select GitHub OIDC to Microsoft Entra workload identity federation,
  an authorized Marketplace publisher identity, pinned `azure/login`, and pinned `vsce` with
  `--azure-credential --packagePath` for the prebuilt VSIX. Configure repository variables
  `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and the login configuration required by that identity;
  limit its federated subject to this repository's protected release environment. Do not select
  direct `vsce --oidc`: current CLI documentation precedes full Marketplace backend support.
  A Marketplace Manage-scoped `VSCE_PAT` is a temporary supported fallback only after explicit
  validation; official documentation announces global PAT retirement on 2026-12-01.
- Open VSX: first publication uses optional `OVSX_PAT`; namespace access and the Publisher
  Agreement MUST already be configured. After an active version exists, prefer registered
  GitHub trusted publishing with `ovsx --trusted-publishing`, explicitly enabled by repository
  variable `OPENVSX_AUTH_MODE=oidc`. The default is PAT when `OVSX_PAT` exists, otherwise disabled.
  Explicit OIDC mode requires registration and namespace ownership; conflicting PAT/OIDC settings
  fail preflight. Registry registration alone does not constrain tags, so GitHub rules remain
  mandatory. Bootstrap publication remains automatic using the configured PAT, not a manual upload.

See [research R10](../research.md#r10--publishing-authentication-and-trust) for official sources
and the current capability limits. Revalidate those capabilities before implementation.

Keep marketplace credentials in GitHub Actions Secrets scoped to publisher jobs, with a
publication environment restricted to protected release tags and no approval requirement.
The planned fallback secret names are `VSCE_PAT` and optional `OVSX_PAT`; publisher identity is
non-secret configuration in extension metadata. Validate platform ownership and namespace access
before the first release. Grant `id-token: write` only to jobs actually using supported OIDC;
do not grant repository write permissions to marketplace publishers.

### Configurable publication identities

The repository MUST allow configuration of the Marketplace publisher and Open VSX namespace
without changing workflow logic. The reviewed extension manifest's `publisher` and `name` are
the canonical packaged identity. GitHub variables `MARKETPLACE_PUBLISHER` and optional
`OPENVSX_NAMESPACE` declare the expected destination identities; do not hardcode account names
in workflows or documentation. Record the resolved identities in the release manifest.

For the same unmodified VSIX to be accepted on both registries, those configured identities
MUST match its embedded publisher namespace. Mismatch fails before publication, rather than
rewriting/repacking the VSIX. Choose matching owned identities before tagging; these variables
are validation/configuration inputs, not post-tag overrides of package metadata. All necessary
accounts, publisher memberships, namespace ownership, agreements and role assignments MUST
be configured before the first release.

### Entra federation procedure and confirmation boundary

1. Create an Entra application/service principal or user-assigned managed identity supported
   by the chosen Marketplace setup. Configure its federated credential for GitHub's issuer
   `https://token.actions.githubusercontent.com`, this repository's protected release-environment
   subject and the Azure Login audience `api://AzureADTokenExchange`. Enforce protected tag
   restrictions on that environment; do not create an Azure Pipelines service connection.
2. Record client/tenant IDs and subscription configuration required by the selected Azure Login
   setup in GitHub Actions configuration. Grant only necessary Azure access. Retrieve the
   identity's Marketplace profile identifier by the official setup procedure and grant it the
   Marketplace publisher Contributor role; Azure resource roles alone do not confer publishing.
3. In the isolated GitHub publisher job, grant `id-token: write`, authenticate using pinned
   `azure/login`, then use pinned `@vscode/vsce` with `--azure-credential --packagePath` against
   the already verified canonical VSIX. Use no client secret, interactive login, token-printing
   command, source checkout or package rebuild.
4. Before the first production release, verify that exact pinned toolchain in a controlled
   publisher namespace: GitHub federation, Azure CLI credential discovery, Marketplace token
   acceptance, correct publisher role and prebuilt-package upload. Retain sanitized evidence
   bound to identity, tool versions and VSIX digest. If unconfirmed, block publication and
   report the missing authentication prerequisite rather than inventing a credential exchange.

Official documentation confirms GitHub-to-Entra OIDC and `vsce --azure-credential` separately;
the inspected `vsce` credential chain includes `AzureCliCredential` and requests the Azure DevOps
resource scope. The Marketplace guide's sample uses Azure Pipelines, so it is not proof that
this project's complete GitHub combination has been exercised. That end-to-end check remains
open. Direct Marketplace `vsce --oidc` is neither substituted nor assumed operational.

Use read-only checkout tokens with credential persistence disabled in build jobs. Avoid
`pull_request_target` execution of PR code, fork artifacts as release inputs, and source checkout
or workspace lifecycle scripts in publisher jobs. Supply pinned publishing tools through an
isolated, reviewed installation without application hooks. Only the exact trusted tagged build
may supply a release artifact. Pass credentials through supported masked environment variables;
disable command tracing, never echo tokens/headers/environment dumps, and keep them out of
command-line arguments, caches, artifacts, manifests and logs. Treat tag/PR text as data, never
interpolate it into shell source. Any project-owned automation logic remains TypeScript.

## Failure, conflict and recovery rules

Every stage fails closed with its stage, tag, commit and credential-free diagnostic in the
Actions summary. A failed dependency blocks subsequent publication jobs. Already successful
external publications cannot be rolled back atomically across platforms and remain visible;
the summary MUST identify completed, failed, pending and not-configured destinations.

| Failure / existing state | Required behavior |
|---|---|
| Invalid tag, metadata mismatch, failed check/build or missing required authentication | Stop before any external publication; fix source/configuration as appropriate; never rewrite an existing release tag |
| Existing GitHub release/draft or asset | Reuse only when tag commit, manifest and exact VSIX digest match this verified release; mismatches or absent proof fail explicitly; never clobber assets |
| Marketplace version absent | Publish the stored, verified VSIX; wait with bounded retries for documented asynchronous processing before declaring success |
| Marketplace reports existing version or a publish request times out | Query authoritative status; accept completion only with exact artifact/provenance evidence; otherwise fail as an unresolved conflict, never silently ignore a duplicate-version response |
| GitHub succeeds; Marketplace or Open VSX fails | Rerun failed jobs from that run; download the same retained artifact or verified GitHub Release bytes, compare the manifest/hash, and resume the failed destination only |
| Open VSX not configured | Record a skip and finish successfully after mandatory destinations; later releases use new configuration; backfilling this version requires the same verified VSIX and a reviewed recovery path |
| No verified retained/durable copy, missing proof, tag moved or remote association conflicts | Fail closed; do not rebuild/re-upload the same version as a presumed recovery. Investigate; corrections requiring new bytes use a new SemVer/tag |

Re-running failed jobs is supported by GitHub for 30 days (at most 50 attempts), regardless of
the longer artifact retention. Use the original run ID and artifact ID, not the new attempt
number, to find the successful build. Outside that rerun window, recovery is blocked until a
separately reviewed recovery design exists; no new recovery workflow is introduced here.

On recovery, verify the tagged source identity, original successful gates and existing
publications before any write. Only a matching already-completed destination is an explicit
no-op, with evidence recorded. Byte comparison may use official package-download endpoints;
if a platform transforms the package or does not expose verifiable bytes, do not infer equality
from its version alone. A prior successful publisher job bound to this manifest and digest is
valid provenance evidence; mere CLI duplicate skipping (including `--skip-duplicate`) is not.
V10 must demonstrate a supported evidence path; ambiguous success
requires investigation rather than an overwrite. Recovery may need an operator to rerun a
failed Actions job; successful normal releases never need post-tag intervention.

## Design acceptance before implementation

V9 and V10 are approved design choices. Their technical evidence obligations remain mandatory:

- **Authentication prerequisite**: confirm the project-specific Entra/GitHub/pinned-vsce path
  above; configure accounts/roles before first release. Validate Open VSX PAT bootstrap and
  trusted-publisher registration before using each authentication mode.
- **Remote association prerequisite**: confirm a supported remote-byte comparison or reliable
  prior-success evidence bound to the canonical VSIX for each existing-version recovery path.
  Marketplace downloaded-byte identity is not confirmed. Version existence or signature validity
  alone is insufficient; lack of proof blocks that operation with an explicit conflict.
- **Recovery evidence**: exercise failed destinations, lost responses, expired artifacts,
  immutable digest handoff and job reruns without rebuilding/overwriting. Every rerun inventories
  all destinations and identifies previously successful publications before any write.

These are prerequisites to resolve before publication or enabling the affected recovery path,
not new requests to approve V9/V10. Existing V1–V8 remain in force. No successful implementation,
authenticated workflow or marketplace publication is claimed here.
