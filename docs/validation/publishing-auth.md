# Publishing authentication prerequisites

Date: 2026-10-17. Status: **Marketplace and Open VSX publication proven; T071 still
open**. T071 is incomplete: the GitHub token path and production conditions are not
proven.

The user reports Marketplace publisher `Wald764`, an Azure user-assigned managed
identity, configured GitHub variables and federation for the `marketplace`
environment. The extension manifest already declares publisher `Wald764`.
These are reported setup details, not observed authentication evidence. The
Marketplace Contributor membership and actual credential exchange remain unverified.
The pinned vsce/Entra end-to-end prebuilt upload and job-local GitHub token proof
must be performed following `docs/releases.md` before publisher jobs are enabled.
Record candidate/tag, controlled identity, run, pinned login/CLI versions, VSIX
SHA-256, acknowledged upload and sanitized role/login observations. Never record
tokens or request authorization headers.

## Observed evidence

| When       | Run                                                                          | Observed                                     |
| ---------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| 2026-10-17 | [39048501412](https://github.com/Wald764/RDLC-Code/actions/runs/39048501412) | Federated login and profile lookup succeeded |

Run 39048501412 (job 117441998369, workflow commit `2b62709`, ubuntu-24.04)
completed successfully on both the `azure/login` step and the profile lookup step.
That is evidence that the GitHub OIDC subject is accepted for the configured
identity and that the identity can read its own VS Marketplace profile. It is
**not** evidence of publish rights.

Preceding run 39048231389 failed at login with
`Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied.`
because the `AZURE_*` values had been stored as secrets while the workflow reads
repository variables. The successful rerun shows the values are now supplied at
run time; repository settings themselves are not observable from here.

Reported, not observed: the Marketplace profile ID retrieved by that run was added
as a **Contributor** member of publisher `Wald764`, and an Open VSX account,
namespace `Wald764` and PAT now exist. The profile UUID and the Azure Principal ID
are deliberately not recorded.

## Observed publication

Run [39051575697](https://github.com/Wald764/RDLC-Code/actions/runs/39051575697)
(workflow commit `f9d6491`) completed with all four jobs successful and published
the probe `Wald764.rdlc-code-auth-test` `0.0.1`. The steps
`vsce verify-pat Wald764 --azure-credential`,
`vsce publish --azure-credential --skip-duplicate --packagePath` and
`ovsx publish --skip-duplicate` each reported success in that run.

| Destination               | Registered state observed 2026-10-17                     |
| ------------------------- | -------------------------------------------------------- |
| Visual Studio Marketplace | `Wald764.rdlc-code-auth-test` 0.0.1, updated 17:01:43Z   |
| Open VSX                  | `Wald764.rdlc-code-auth-test` 0.0.1, published 16:57:58Z |

Each registry was then queried directly rather than trusted from the run output:

- The Marketplace package, the Open VSX download and Open VSX's own published
  `.sha256` file for `0.0.1` are the same bytes, SHA-256
  `b3c741e403856bc3e2fd786b4633b741e9f0a53a2c680573f79918f81380c694`.
- Every file inside that VSIX is byte-identical to a local rebuild of the committed
  fixture with the pinned toolchain. Only the ZIP entry timestamps differ, so two
  builds of the same source produce different archive digests. A recorded digest is
  therefore per-build and valid only for the artifact it was measured on; this is
  one more reason recovery reuses the original artifact instead of rebuilding.

Remaining T071 gaps: the release publication jobs now exist (T073–T076), but they
have only been exercised as local tooling and through the manual probe, never by a
production tag-restricted release. The GitHub job-local `GITHUB_TOKEN` publication
path is therefore implemented but unproven. The probe stays public at `0.0.1` and
must not be overwritten; Open VSX currently relies on a permanent PAT rather than
trusted OIDC.

The temporary `main` deployment-branch rules added for the manual runs were removed
from both the `marketplace` and `openvsx` environments, leaving only the release-tag
rules. That is the operator's statement; T080 covers inspecting the actual settings.

## Retrieve the Marketplace identity profile

The source-free `.github/workflows/marketplace-identity.yml` workflow performs
only federated Azure login and the official profile lookup. It does not install
tools from the repository, check out source, build, upload artifacts or publish
an extension. The azure/login v2.3.0 tag was resolved to commit
`a457da9ea143d694b1b9c7c869ebb04ebe844ef5` using GitHub's upstream API.

1. Merge the workflow into the repository's default `main` branch. In GitHub,
   verify repository Variables contain `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
   `AZURE_SUBSCRIPTION_ID`. This workflow uses the subscription mode.
2. In Settings > Environments > marketplace > Deployment branches and tags,
   temporarily add a selected **Branch** rule for exactly `main`, alongside
   the existing **Tag** rule `v*`. The manual setup workflow runs only from main;
   an environment restricted exclusively to release tags will block it. This is
   a one-time setup run, not a production release or post-tag approval gate.
3. Confirm the managed identity's credential uses issuer
   `https://token.actions.githubusercontent.com`, audience
   `api://AzureADTokenExchange` and subject
   `repo:Wald764@28262046/RDLC-Code@1421365002:environment:marketplace`.
   The numeric owner/repository IDs were checked in GitHub's public API. The
   repository uses the immutable default subject format introduced July 2026.
4. Open Actions > Marketplace identity check > Run workflow; select `main`.
   Copy the profile UUID from the completed run's Summary (also shown in the
   profile lookup step). This is not an access token or the Azure Principal ID.
5. Keep the temporary main-branch deployment rule until the controlled probe below
   passes, then remove it and keep only the release-tag restriction. In Marketplace
   Management, select publisher Wald764 > Members > Add member, enter the retrieved
   identity profile ID and assign Contributor.

If login or lookup fails, retain the failing step's sanitized error. Do not
substitute an ID retrieved while logged in as the personal Microsoft account.
Successful profile retrieval proves only login/profile discovery, not permission
to upload a VSIX; the controlled prebuilt publication below is the remaining
T071 obligation.

## Controlled prebuilt publication

`.github/workflows/publishing-auth-test.yml` is a manual `workflow_dispatch`
workflow, separate from the release path. It packages one deliberately inert probe
(`Wald764.rdlc-code-auth-test` `0.0.1`, a theme with no executable extension code)
from `tests/fixtures/publishing-auth`, verifies its contents, digest and identity,
and ships **the same bytes** to both registries. The test identity is fixed on
purpose: a published version is never intentionally overwritten, so re-runs use
`--skip-duplicate` and any change to the probe needs a new version and a new review.

1. Create the `openvsx` environment if it does not exist and add the
   `OVSX_PAT` environment secret. Both publishing environments must temporarily
   allow the `main` branch as well, otherwise the manual run is blocked before
   login. Keep the release-tag rule; remove the main-branch rule once this probe
   passes.
2. Run Actions > Publishing authentication test from `main`. Four jobs run in
   order: `package`, `openvsx-preflight`, `marketplace`, `openvsx`.
3. `package` asserts the pinned Node from `.node-version`, pinned vsce 3.7.1, the
   fixture identity and the exact VSIX file list, then uploads the VSIX and
   `auth-test.json` (identity, commit, run ID, SHA-256, tool pins). It compiles no
   extension code and runs no lifecycle script from the probe.
4. `openvsx-preflight` reads the `openvsx` environment secret `OVSX_PAT` and runs
   `ovsx verify-pat Wald764`, checking the token and namespace before any upload.
   It understands only the bootstrap PAT mode.
5. `marketplace` downloads the artifact **by immutable artifact ID**, fails on any
   digest change, signs in with `azure/login` pinned to
   `a457da9ea143d694b1b9c7c869ebb04ebe844ef5` (v2.3.0) in the `marketplace`
   environment, runs `vsce verify-pat Wald764 --azure-credential`, then
   `vsce publish --azure-credential --skip-duplicate --packagePath` on the prebuilt
   file. No source checkout, no build, no PAT.
6. `openvsx` repeats the digest check and publishes the same file with the pinned
   `ovsx` 1.3.0 CLI.

Record for T071: run ID, workflow commit, both CLI versions, the canonical
SHA-256, the registry-reported digest of each upload, and the acknowledged
`publish` output of each CLI. A successful `verify-pat` alone is not a
publication, and a skipped duplicate is not a fresh upload. If one destination
fails, fix only its configuration and re-run failed jobs; the successful `package`
job is never rebuilt.

Not yet done: the tag-restricted production conditions and the GitHub release path.
Open VSX trusted publishing (`OPENVSX_AUTH_MODE=oidc`) is untested. The probe is
expected to be publicly visible on both registries.
