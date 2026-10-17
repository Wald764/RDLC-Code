# Phase 6 implementation and validation

Date: 2026-10-17. Committed as `a61a8f0` and `f5f8a08` on top of
`ab81920bef3b24105189f96e7361a344999808f6`; not a version-prepared release
candidate.
Phase 6 is **incomplete**. Existing user changes marking T053/T061 complete were
preserved; this work does not supply their still-documented interactive evidence.

## Delivered scope

| Tasks     | Local implementation                                                                                                                                                                                                                                                                                                                                                                                                                               | Remaining acceptance or implementation                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T062      | Actual-VSIX CSP/nonce/local-resource/source-map/font checks; synthetic MIT local/remote entity rejection fixtures                                                                                                                                                                                                                                                                                                                                  | Installed untrusted-workspace runtime-CSP, execution/network-attempt/listener observations; see isolation.md                                                                                                 |
| T063      | SC-004 measurement-record validator and adversarial boundary/count tests; exact paint, keyboard and five-author usability procedures                                                                                                                                                                                                                                                                                                               | Real hardware/20-open/100-interaction measurements and participant/keyboard results; see acceptance.md                                                                                                       |
| T064      | Package verification is mandatory after createVSIX; exact build-byte/identity/notices inventory rejects extra/dev/native files and missing assets                                                                                                                                                                                                                                                                                                  | Multi-OS installed results and full isolation proof; existing Windows installed suite is not a network-isolation assertion                                                                                   |
| T065      | English root/packaged README, contributor/build/install/profile/limitations and release instructions                                                                                                                                                                                                                                                                                                                                               | Independent contributor reproduction; see contributor-build.md                                                                                                                                               |
| T066      | Stable SemVer, tag peeling/ancestry, private-version independence, commit/breaking semantics and stale/missing evidence tests                                                                                                                                                                                                                                                                                                                      | Complete as a local tooling test task                                                                                                                                                                        |
| T067      | Read-only detached-tag/Git-object validator; full candidate diff allowlist, tool/version/evidence identity, accepted-path hashes; PR/commit CI checks                                                                                                                                                                                                                                                                                              | Complete as implementation; live protection and final candidate proof belong to T078–T080                                                                                                                    |
| T068–T069 | Digest/artifact-ID/run checks, immutable manifest/gate/evidence generation, conservative full-inventory recovery planner and synthetic partial/lost-response/conflict tests                                                                                                                                                                                                                                                                        | Remote adapters and retry integration now have local regression tests; hosted authenticated recovery and failure injection remain unproven                                                                   |
| T070      | Tested sanitized configuration preflight plus protected-tag/environment/Entra/Open VSX setup documentation                                                                                                                                                                                                                                                                                                                                         | Complete as shape/consistency validation; live authentication is T071                                                                                                                                        |
| T071      | Sanitized prerequisite record, controlled inert two-registry probe workflow and authenticated publication instructions                                                                                                                                                                                                                                                                                                                             | Marketplace and Open VSX publication proven; see publishing-auth.md. GitHub job-local token publication and production tag conditions remain unproven                                                        |
| T072      | Prepared secret-free tag/evidence job, reused complete CI matrix, canonical production/package/install stages, manifest and immutable artifact-ID output, tag concurrency and 90-day artifact retention                                                                                                                                                                                                                                            | Hosted execution and canonical installed offline/isolation acceptance remain unrun; not marked complete                                                                                                      |
| T073–T076 | Source-free preflight (tag/commit/publisher/run/artifact/VSIX binding, full destination inventory, federated publisher check), sequential GitHub/Marketplace/optional-Open-VSX publisher jobs from that one artifact, byte-required no-op and recovery decisions, verified draft then publish, no duplicate skipping or overwrite, `latest` never moved, bounded asynchronous Marketplace wait, always-on state summary, 90-day artifact retention | Hosted publication, failure injection and recovery on a production tag remain unrun; the GitHub job-local token path (T071 clause) and the 30-day/50-attempt rerun window stay unproven. Not marked complete |
| T077–T080 | Release/recovery/readiness procedures, controlled two-registry probe and explicit blockers                                                                                                                                                                                                                                                                                                                                                         | Controlled production publication and failure injection, version-prepared final acceptance and actual configuration inspection remain pending                                                                |

No dependency was added. Frozen install still succeeds. Existing ignore files
covered the detected setup; the new security fixture directory is excluded from
formatting. `vendor/`, checklist markers, versions and lockfile were not changed.

## Executed checks

Environment: Windows x64; Node 24.22.0 (explicit pinned toolchain, not the machine's
default Node 22); pnpm 11.28.2; TypeScript 6.0.3; Angular 22.2.3; vsce 3.7.1;
test-electron 3.1.0; VS Code stable resolves to 1.142.0, also the declared minimum.

| Check                                                 | Result                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Frozen install                                        | Exit 0, no lockfile changes                                       |
| Format, lint, typecheck                               | Exit 0, including Angular templates                               |
| Node unit / Angular component tests                   | 42 / 14 pass                                                      |
| Roundtrip / compatibility                             | 14 / 10 pass                                                      |
| Release tests                                         | 7 pass, including temporary-Git-repository CLI/tag checks         |
| Measurement-validator test                            | 1 pass using synthetic samples, not measured editor timings       |
| Production build and package                          | Exit 0; versioned 0.1.0 universal VSIX with exact reviewed assets |
| Package-content/static-isolation tests                | 4 pass                                                            |
| Official Electron development / installed-VSIX suites | All six suites pass in each mode on Windows VS Code 1.142.0       |
| Commit-policy CLI                                     | Exit 0 on current HEAD                                            |
| actionlint                                            | CI, release and publication-probe workflows pass local validation |

The initial new tests failed before their implementation modules existed. The
first package inventory failed because vsce normalizes `LICENSE` to
`extension/LICENSE.txt`; the verifier now checks those bytes under the actual
archive name. One Electron attempt failed before tests because a subsequent
domain-test compilation had removed bundled `.cjs` harness files. Rebuilding
restored the harness and both final Electron runs passed. No product behavior
was weakened to hide these failures. Expected read-only-save and modified-since
messages are existing failure-path assertions, not lost edits.

Release workflow action pins reuse the reviewed setup/checkout pins in CI.
The upload-artifact v4.6.2 SHA was checked against GitHub's upstream tag API:
`ea165f8d65b6e75b540449e92b4886f43607fa02`. This verifies the ref, not hosted
workflow behavior. Commenting on an earlier state of this work, no workflow,
publication or external account setup had been run. Since then the federated
identity check and the controlled inert probe were run in hosted GitHub Actions
and the probe was published to both registries; the sanitized records and the
independently downloaded package hashes are in
[publishing-auth.md](publishing-auth.md). No production release was performed and
the tooling creates no tag, account or release.

The prepared workflow validates evidence before installation/upload and keeps
publisher credentials absent. Current release-readiness deliberately lacks a
passed record, so release validation fails closed.

Publication jobs (T073–T076) were added on top of `9c70558`. Publisher jobs must
not check out source, so the canonical artifact now also carries the compiled
verifier scripts; the source-free preflight binds the downloaded artifact to the
tag, the commit, the configured publisher, the original run, the immutable
artifact ID and the VSIX SHA-256, inventories all three destinations and fails
closed on any existing version without matching bytes. The new planning and
verification CLI was exercised against the already-published inert probe: the
Marketplace download and the Open VSX declared checksum both matched the canonical
digest, the GitHub destination correctly resolved to `pending`, and an absent
GitHub release failed closed. That validates the queries and decisions, not the
hosted jobs: no production tag, no environment-scoped credential use and no
draft-to-published transition has been exercised, so T073–T076 stay unchecked and
the release path remains unproven. Normal installed Electron
tests still disable Workspace Trust and are not proof of T062. Actual offline
isolation automation must be completed before accepting T072's canonical smoke
requirement. No production release readiness is claimed.

## Publication review corrections

Review of `de60f08` and `568a3e3` found integration defects despite passing local
helper tests. The corrections share publisher configuration with every job, give
the source-free GitHub writer an explicit repository and REST token, require both
remote asset hashes, and place Open VSX authentication before every publication
destination. GitHub → Marketplace → Open VSX is now an actual dependency chain;
already-complete destinations finish as successful no-ops rather than skipped jobs.
Every publisher recomputes the inventory, including on failed-job reruns, so a
successful upload followed by a failed acknowledgement/check is not uploaded again.

Regression tests execute the shipped CLI in a temporary source-free directory
with mocked HTTP responses. They cover authenticated draft reads, missing and
conflicting manifest assets, draft/published checks, a retry discovering previously
uploaded bytes, and rejecting foreign bytes. Open VSX preflight tests cover PAT,
trusted-publisher exchange through the pinned client's API, missing/conflicting
credentials, and sanitized failures. These are local simulations, not new hosted
publication or OIDC evidence; T071 and T073–T076 remain open.

Local checks for these corrections: 44 Node unit tests and 14 Angular tests pass;
the 7 release tests, lint, typecheck and actionlint also pass. The pinned ovsx
1.3.0 package was installed outside the repository with lifecycle scripts disabled;
all client APIs used by the authentication preflight load successfully. Formatting
passes for the changed files. Generated Claude skills are now excluded from the
repository formatter, like the existing OpenCode integration, preserving their
Spec Kit manifest hashes.
