# Release setup and operating procedure

## Current state

Release identity/evidence, configuration, artifact/recovery guard functions and
the publication jobs have local tests. `.github/workflows/release.yml` prepares the
secret-free validation, reused CI matrix and canonical-artifact stages, then runs a
destination preflight and the GitHub, Marketplace and optional Open VSX publisher
jobs from that single verified artifact. None of it has been run in hosted GitHub
Actions for a production tag: missing acceptance evidence still blocks its first
job, no `v*` tag has been pushed, and the publication path therefore remains
**unproven** until T077–T079 are executed. No tag, account, GitHub ruleset,
marketplace version or release is created by these tools.
See the [CI/CD contract](../specs/001-rdlc-vscode-editor/contracts/ci-cd.md).

## Controlled three-destination test

The reserved tag `v0.0.4-publishing-test` triggers `publishing-auth-test.yml` and is
explicitly excluded from the stable release trigger. It packages only the inert
`Wald764.rdlc-code-auth-test` fixture at registry version `0.0.4`. Marketplace
versions stay numeric; the test suffix belongs to the Git tag, not the VSIX version.
Both the test and the stable release call the same `publish.yml` jobs, with the
same artifact binding, credential preflights, remote asset checks and retry logic.
The test identity creates a GitHub prerelease and never moves the latest marker.
Publisher environments remain restricted to `v*` tags.

Both callers inherit secrets into the reusable workflow; credentials are consumed
only in its environment-scoped jobs. The first tag (`v0.0.2-publishing-test`, run 39069396319) stopped at the Open VSX authentication preflight because the caller
did not inherit secrets. No destination was published. That tag is retained; the
corrected attempt uses a new tag and probe version rather than moving it.

The next tag (`v0.0.3-publishing-test`, run 39069610156) passed both credential
preflights and uploaded a GitHub draft, but the tag lookup could not find that
draft. The shared verifier now also lists releases when the tag endpoint returns 404. This fixes draft verification and resumption; the draft and tag remain intact.

The probe's manifest gates describe its own packaging/guard tests, not application
acceptance. It does not validate the editor's production build or replace the
mandatory stable-release evidence. Its distinct extension ID and reserved test tag
are checked before packaging and handoff. Existing `0.0.1` probe versions are retained.

## GitHub setup before the first release

1. Protect `main` with reviews and required **Required checks** CI; forbid bypasses
   for unreviewed workflow/source changes. Use squash merges with validated PR
   titles. Protect `v*` tag creation, updates and deletion. Grant release authority
   only to maintainers; review the version-preparation PR before tagging.
2. Create isolated publisher environments restricted to protected release tags.
   Normal tag delivery has no manual environment approval gate. Build jobs use
   read-only tokens, no publication secrets and no persisted checkout credentials.
   Only the GitHub writer receives job-local `contents: write`; only federated
   publishers receive `id-token: write`. Never execute PR source with credentials.
3. Set `MARKETPLACE_PUBLISHER` equal to reviewed extension `publisher`, currently
   `Wald764`. Configure owned publisher membership/agreements first. Membership is
   configured, not observed; the controlled probe described in
   [publishing-auth.md](validation/publishing-auth.md) is what proves upload rights.
   Metadata changes require a new tested candidate, not a post-tag override.
4. Configure `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and either
   `AZURE_SUBSCRIPTION_ID` or `AZURE_ALLOW_NO_SUBSCRIPTIONS=true`, exclusively.
   The preflight rejects client secrets and `VSCE_PAT`; this implementation has
   not validated a PAT fallback. IDs are non-secret configuration; credentials
   never belong in a repository, artifact, command argument or log.
5. Configure Entra workload federation for issuer
   `https://token.actions.githubusercontent.com`, audience
   `api://AzureADTokenExchange` and the exact protected GitHub environment subject
   `repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID:environment:ENVIRONMENT`
   for repositories using GitHub's immutable subject format (the default for
   repositories created after July 15, 2026). Match the actual emitted subject.
   Grant the corresponding
   identity Marketplace publisher Contributor membership using its official
   profile identifier; Azure resource roles alone do not grant publishing rights.
   Select and review a pinned `azure/login` SHA, then prove GitHub login and the
   pinned vsce 3.7.1 `AzureCliCredential` / `--azure-credential --packagePath`
   upload in a controlled namespace. No direct Marketplace `--oidc`, invented
   token exchange or Azure Pipelines is used. Record sanitized proof in
   [publishing-auth.md](validation/publishing-auth.md) before enabling publication.
6. Optional Open VSX: leave namespace/mode/PAT unset to record `not-configured`.
   Otherwise set `OPENVSX_NAMESPACE` to the same embedded publisher. Complete
   namespace ownership and Publisher Agreement first. Bootstrap mode uses the
   environment secret `OVSX_PAT` and optional `OPENVSX_AUTH_MODE=pat`. Trusted
   mode requires an active extension, registered GitHub trusted publisher and
   `OPENVSX_AUTH_MODE=oidc`, with PAT removed. Invalid/incomplete optional setup
   fails; it is never silently skipped. Select/pin/prove the Open VSX CLI before
   configuring its production publisher. Tag restrictions also apply to OIDC.
   The controlled probe in
   [publishing-auth.md](validation/publishing-auth.md) validates the bootstrap PAT
   against the configured namespace before any production release.

`validateReleaseConfig` checks shape/consistency, not live ownership or successful
login. Do not print its input environment. Authentication proof must identify
the tools, controlled publisher, run and canonical VSIX digest without tokens.

Stable job layout: `validation` (accepted evidence) → `quality` (reused CI matrix) →
`canonical` (build, package, manifest, immutable artifact) → `preflight` (artifact
binding, destination inventory, federated publisher check in the `marketplace`
environment) → `openvsx-preflight` (namespace credential or trusted-publisher check
in the `openvsx` environment) → `github` (the only job with `contents: write`) → `marketplace`
(`id-token: write` in the `marketplace` environment) → `openvsx` (`openvsx`
environment) → `summary` (always runs). Publication cannot start without the
accepted `github-auth`, `marketplace-auth`, `recovery` and `github-actions`
records, because the evidence validator runs before the build. Open VSX credentials
are confined to its authentication preflight and publisher jobs in that environment.
Publication jobs live in the reusable `.github/workflows/publish.yml`. The
publisher/tag/namespace configuration is shared at workflow level; the GitHub
writer explicitly sets `GH_REPO` and a job-local `GITHUB_TOKEN` for both `gh` and
the REST verifier, so no checkout is needed to select the repository or read drafts.

## Version and acceptance preparation

Prepare a reviewed commit synchronizing only root and extension stable SemVer
versions (and lockfile when needed). Private packages keep independent versions.
On that candidate, run the complete automated and mandatory manual acceptance.
Record results in validation Markdown, including the tested candidate, versions,
tool pins, applicable auth mode and every required evidence category. Use one
JSON block in `docs/validation/release-readiness.md` with these keys:

- `candidate`: full tested commit SHA; `version`: final root/extension version.
- `tools`: `node`, `pnpm`, `typescript`, `angular`, `vsce`, matching repository pins.
- `openvsx`: `not-configured`, `pat` or `oidc`.
- `permittedEvidenceChanges`: exact validation-evidence Markdown paths allowed
  between candidate and tag, including readiness itself when modified.
- `evidence`: required IDs exported by `scripts/validate-release.ts`, each with
  `status: passed`, `path` and the same `candidate`. Configured Open VSX additionally
  needs `openvsx-pat-auth` or `openvsx-oidc-auth`, plus `openvsx-recovery`.

Commit only explicitly listed evidence Markdown after testing. Any code, version,
lockfile, workflow or tool change invalidates that candidate. Missing/failed/
unrun results block release; never convert a procedure into a passed result.
The validator reads tagged Git objects and hashes accepted records, not arbitrary
working-tree files. After building tooling, validate the intended detached tag
using `pnpm validate:release vMAJOR.MINOR.PATCH origin/main`. This command is
read-only. It checks peeled tag/main ancestry, identity, tools and the full diff;
it does not prove actual GitHub protection settings, which require T080 inspection.

## Canonical artifact and recovery contract

After the release workflow's complete quality/evidence matrix,
build one canonical universal VSIX and verify package contents and installed
offline behavior. Bind its explicit SHA-256 to tag/commit, candidate, toolchain,
lockfile, original workflow run and evidence hashes in an immutable manifest.
Retrieve handoffs by original run and immutable artifact ID, never a latest name.
An archive digest is not the VSIX digest; a mismatch must fail explicitly. The
canonical artifact also carries the compiled verifier scripts, so publisher jobs
never check out source and never run workspace lifecycle hooks.

The source-free `preflight` job downloads that artifact by ID, binds it to the
tagged commit, the configured publisher and the original run, and inventories
GitHub, Marketplace and configured Open VSX before any write. It resolves each
destination to `pending`, `succeeded` or `not-configured`. A destination that
exists without bytes matching the canonical VSIX — or without any digest to
compare — is a conflict: the job fails closed and no publisher runs. The same job
proves the federated identity's publisher rights with the pinned vsce
`verify-pat --azure-credential`.

Before any release or package write, `openvsx-preflight` checks the configured
credential with the pinned ovsx 1.3.0 client. PAT mode verifies namespace access;
OIDC mode requests the GitHub ID token and uses the client's supported registry
exchange to prove the trusted-publisher registration, discarding the short-lived
token. Tokens are not logged or passed to later jobs. Missing credentials, a PAT
in OIDC mode, or stray configuration in `not-configured` mode fail before publication.
The trusted mode still requires its separate controlled authentication evidence.

Publisher jobs run sequentially even for an already completed destination: a
verified no-op succeeds and allows the next job to run. Each job re-verifies the
handoff and re-inventories all destinations before deciding whether to write;
the initial preflight plan is never used as a cached write decision. Every
publisher re-checks the remote bytes after writing. GitHub notes use explicit
previous stable tag bounds, the release is created as a draft, its assets are
proven complete by matching both the VSIX and the exact manifest SHA-256 before
it is published, assets are never replaced and the latest
marker is never moved. Marketplace publishes the verified prebuilt VSIX with
`--azure-credential --packagePath` and no `--skip-duplicate`; an asynchronous
Marketplace write is waited for with bounded retries and accepted only when the
downloaded bytes match. Open VSX verifies the configured namespace before
publishing and uses the bootstrap PAT or the registered trusted-publisher mode.
The final `summary` job reports every stage and destination result.

On partial failure, use **Re-run failed jobs** on the original run. Do not rerun
the successful build. A rerun rebuilds no bytes: it reuses the original run and
artifact ID, queries current registry state again and resumes only the destinations still
`pending`. Reuse of an existing version requires matching remote bytes; an
existing version number, a lost response or duplicate skipping is insufficient.
Ambiguity is a conflict. Never use duplicate skipping, deletion, overwrite,
retagging or rebuilding as recovery. Guard functions require canonical
bytes/provenance and inventory all destinations before returning any pending
writes. They do not contact registries themselves and do not acquire a same-tag
lock: the release workflow declares tag-scoped noncancelling concurrency, which
still needs controlled operational proof, and the planning job supplies the
authenticated inventory. See [recovery proof](validation/release-recovery.md).

Configure 90-day retention for the canonical artifact, manifest and available
gate/publication proof, within repository policy. Keep original GitHub VSIX and
manifest assets durably unmodified. GitHub reruns remain limited to 30 days and
50 attempts; longer artifact retention does not extend that window. Missing/
expired provenance or unavailable canonical bytes blocks automatic recovery
until a separately reviewed path exists. Recovery is therefore limited to
re-running the failed jobs of the original run while its artifact and provenance
remain inside that window; no tooling rebuilds, deletes or retags anything.
