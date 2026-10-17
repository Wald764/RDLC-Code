# Publishing authentication prerequisites

## Probe retirement (2026-10-18)

At the owner's request, the inert probe `Wald764.rdlc-code-auth-test` was retired
after the production `0.1.0` publication. Run
[39076203081](https://github.com/Wald764/RDLC-Code/actions/runs/39076203081),
tag `vprobe-cleanup-20261018`, completed both source-free environment-scoped jobs
successfully. The manual workflow is restricted to that exact maintenance tag;
it cannot target an arbitrary extension and checks production bytes before/after.

- Marketplace: the authenticated Gallery client set and read back **Unpublished**
  and **Hidden**, preserving the extension identity, versions and statistics.
  This is not the destructive `vsce unpublish` operation. Store/API caches may
  retain historical metadata; retirement is not a claim that every URL returns 404.
- Open VSX: the pinned client withdrew all published probe versions (`0.0.1` and
  `0.0.4`); the public probe metadata endpoint subsequently returned HTTP 404.
  The publisher client offers version withdrawal rather than an equivalent
  Marketplace-style hiding operation. Retired version numbers must not be reused.
- Independent production downloads from Marketplace and Open VSX still matched
  `13d7ed0be2110f81600615988b45e22eb596b3bdb37ff8b3b05f31503b5127f6`.
  Production identity `Wald764.rdlc-code` was not modified.

Probe fixture/workflows, Git tags, GitHub prerelease assets and the historical
evidence below are retained. Registry hashes below describe downloads verified
before retirement; those probe registry downloads may no longer be available.
Any future probe publication needs a reviewed new version and tag.

Current status (2026-10-18): **T071 complete for configured PAT mode**. The probe
and production editor both published successfully through the shared jobs. See
[release-010.md](release-010.md) for the production tag, run and remote hashes.
The owner explicitly retained the working Open VSX PAT; OIDC remains untested
but is not required for that selected mode. T073–T076 are complete; remaining
hosted failure experiments are retained as owner-waived follow-ups under T077–T078 in
[github-actions.md](github-actions.md).

## Historical authentication and probe observations

The dated observations below describe the evidence available before production
publication. Earlier production blockers were resolved by the recorded 0.1.0 run;
historical probe evidence is not a claim that editor acceptance gates ran there.

The user reports Marketplace publisher `Wald764`, an Azure user-assigned managed
identity, configured GitHub variables and federation for the `marketplace`
environment. The extension manifest already declares publisher `Wald764`.
The successful uploads below demonstrate credential exchange and publish rights;
the exact Marketplace role assignment was not independently inspected.
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

At the probe stage, the remaining T071 gaps were: the shared publication jobs had
been exercised by the tagged probe below, but not by a production editor release. Existing probe versions must
not be overwritten; Open VSX currently relies on a bootstrap PAT rather than
trusted OIDC.

The temporary `main` deployment-branch rules added for the manual runs were removed
from both the `marketplace` and `openvsx` environments, leaving only the release-tag
rules. An authenticated API inspection during the tagged test confirmed that each
environment has exactly one deployment rule: tag `v*`. This is partial settings
evidence, not completion of the entire T080 audit.

## Tagged three-destination probe and recovery

Run [39069849589](https://github.com/Wald764/RDLC-Code/actions/runs/39069849589),
tag `v0.0.4-publishing-test`, commit
`beed034f0d52b4bffa2d5cd89f9f6a92a8c83d84`, publishes only the inert extension
`Wald764.rdlc-code-auth-test` version `0.0.4`. Both callers use the same reusable
`publish.yml` chain. The test tag is excluded from the stable release trigger.

- Attempt 1 passed both credential preflights, created and verified a GitHub draft,
  published it as a prerelease, then uploaded the original VSIX to Marketplace
  through Azure federation and to Open VSX through the environment PAT.
- Open VSX acknowledged publication before its public version endpoint was ready.
  The immediate recheck failed on HTTP 404; the run correctly remained failed.
- Once the version was visible, only failed jobs were rerun. Attempt 2 completed
  successfully, downloading original artifact `12114239416` (archive SHA-256
  `56122189642d3256b1e01a2eef447dafe9884ad846a661d509e90c9f42aeb6dc`).
  Open VSX was freshly inventoried, its bytes matched, and its upload step was
  skipped. Packaging was not rerun; no duplicate skipping or overwrite was used.
- Independent downloads from all three destinations and the Open VSX checksum
  agree with the original manifest's VSIX SHA-256:
  `d2651729b678036d7a2f89c9ec422a32a71bf531162b9c88a7a8c188ea0079a2`.
- The published GitHub `release-manifest.json` SHA-256 is
  `c5493655bbe4e20b3a4284a0fbe226693d616c0d7fe7565f3d7b72515de05396`.
  The release is public, `draft=false`, `prerelease=true`:
  https://github.com/Wald764/RDLC-Code/releases/tag/v0.0.4-publishing-test.

Earlier immutable test tags are retained: `v0.0.2-publishing-test` stopped before
publication because reusable-workflow secret inheritance was missing;
`v0.0.3-publishing-test` uploaded a draft but could not discover it through the
tag endpoint. Secret inheritance and paginated draft discovery were corrected
before the successful `0.0.4` publication. The `0.0.3` draft remains intact.

Pinned tools: Node 24.22.0, vsce 3.7.1, ovsx 1.3.0; Azure login v2.3.0 uses the
previously recorded action SHA. No credentials are recorded here.

The follow-up code gives Open VSX the same bounded visibility wait as Marketplace
(ten 30-second waits). Local CLI regressions cover delayed visibility, wrong bytes
and exhaustion. That new wait was not part of the immutable test artifact, so the
hosted success proves recovery after visibility, not execution of the new wait.
Production readiness, other injected failure modes, the full recovery window and
Open VSX OIDC remained unproven at this point; T071 and T073–T076 were then open.
The later production run closes their configured-mode implementation/publication
scope; full failure-injection work remains under T077–T078.

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

## Historical manual prebuilt publication (0.0.1)

At commit `f9d6491`, `.github/workflows/publishing-auth-test.yml` was a manual `workflow_dispatch`
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

The current tag-triggered procedure is documented in `docs/releases.md` and the
observed results above. Production editor release conditions and Open VSX trusted
publishing (`OPENVSX_AUTH_MODE=oidc`) remain untested.
