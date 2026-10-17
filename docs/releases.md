# Release setup and operating procedure

## Current state

Release identity/evidence, configuration and artifact/recovery guard functions
have local tests. `.github/workflows/release.yml` prepares the secret-free
validation, reused CI matrix and canonical-artifact stages; it has not been run
in GitHub Actions and current missing acceptance evidence blocks its first job.
Publication jobs are not implemented: T071's controlled authentication proof is
a prerequisite. No tag,
account, GitHub ruleset, marketplace version or release is created by these tools.
See the [CI/CD contract](../specs/001-rdlc-vscode-editor/contracts/ci-cd.md).

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
An archive digest is not the VSIX digest; a mismatch must fail explicitly.

Inventory GitHub, Marketplace and configured Open VSX before any write. Publish
sequentially from the same bytes, without source checkout/build hooks in publisher
jobs. GitHub notes use explicit previous stable tag bounds; draft assets must be
complete and verified before publishing. Do not replace assets or make an older
maintenance version latest ahead of a newer release.

On partial failure, use **Re-run failed jobs** on the original run. Do not rerun
the successful build. Reuse a destination only with matching remote bytes or
reliable acknowledged prior publication bound to this digest; existing version
numbers or a lost response are insufficient. Ambiguity is a conflict. Never use
duplicate skipping, deletion, overwrite, retagging or rebuilding as recovery.
Guard functions require canonical bytes/provenance and inventory all destinations
before returning any pending writes. They do not contact registries or acquire
a same-tag lock: the prepared release workflow declares tag-scoped noncancelling
concurrency, which still needs controlled operational proof, and publisher jobs
must supply authenticated evidence. See [recovery proof](validation/release-recovery.md).

Configure 90-day retention for the canonical artifact, manifest and available
gate/publication proof, within repository policy. Keep original GitHub VSIX and
manifest assets durably unmodified. GitHub reruns remain limited to 30 days and
50 attempts; longer artifact retention does not extend that window. Missing/
expired provenance or unavailable canonical bytes blocks automatic recovery
until a separately reviewed path exists. No recovery workflow is provided yet.
