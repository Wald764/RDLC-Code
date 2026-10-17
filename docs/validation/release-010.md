# RDLC Code 0.1.0 publication evidence

Date: 2026-10-18. Status: **published and independently downloaded**.

## Source and hosted run

- Candidate: `f59bad8d749069d58a4c18e687ab13e75e85423b`.
- Tag: `v0.1.0`, commit `4a8d3f58b2a28e185e41e796dc6bd0d4020278c6`.
- Candidate-to-tag diff: only `docs/validation/release-readiness.md`.
- Detached-tag validation passed locally before the atomic main/tag push.
- Release run: [39075357277](https://github.com/Wald764/RDLC-Code/actions/runs/39075357277),
  attempt 1, completed successfully. Evidence validation, quality, all six desktop
  jobs, Required checks, canonical packaging, both publication preflights, all
  three publishers and the final summary passed.
- The six desktop jobs cover Windows 2022, Ubuntu 24.04 and macOS 14 on VS Code
  1.142.0 and stable, with development and installed-VSIX suites.

## Canonical artifact

| Field                      | Observed value                                                     |
| -------------------------- | ------------------------------------------------------------------ |
| Artifact ID                | `12116543913`                                                      |
| Artifact name              | `canonical-v0.1.0-39075357277`                                     |
| Archive SHA-256            | `8ca6e8e419594e626823e3cdbc2ee8eff82c582cf91be57f33168c930f252f6c` |
| VSIX filename              | `rdlc-code-0.1.0.vsix`                                             |
| VSIX size                  | 99,686 bytes                                                       |
| VSIX SHA-256               | `13d7ed0be2110f81600615988b45e22eb596b3bdb37ff8b3b05f31503b5127f6` |
| Published manifest SHA-256 | `a621fb7f2bb281ecda060a453c23860076497227bb034ee3ec66e5a63052309e` |

The original artifact is retained under the configured 90-day policy. Its archive
digest is distinct from the VSIX digest. The published manifest identifies this
candidate, tag commit and original run. Local build hashes in readiness are not
substitutes for these canonical bytes.

## Destination checks

- [GitHub release](https://github.com/Wald764/RDLC-Code/releases/tag/v0.1.0):
  public, `draft=false`, `prerelease=false`, with VSIX and release-manifest.json.
- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Wald764.rdlc-code):
  the exact version `0.1.0` package downloaded successfully.
- [Open VSX](https://open-vsx.org/extension/Wald764/rdlc-code): metadata for
  `0.1.0`, package download and published checksum were retrieved successfully.

Independent downloads from all three destinations were byte-identical, each
matching the canonical manifest's VSIX SHA-256. Open VSX's checksum and GitHub's
asset digests also matched. Assertions checked the embedded production identity
`Wald764.rdlc-code` `0.1.0`, original MIT license, complete parser notices and
nonempty generated designer license inventory in the published 11-entry package.

Marketplace used the configured Azure federation; Open VSX used the configured
environment PAT. No credential values are recorded. This is the production editor,
not the earlier inert authentication probe. No artifact was rebuilt for publishing,
no existing version was overwritten and no tag was moved.

## Evidence boundaries

The first production publication succeeded without retry. The earlier probe proves
one real failed-job recovery; synthetic tests cover additional recovery branches.
This run does not demonstrate every hosted failure-injection variant, the entire
30-day/50-attempt window or Open VSX OIDC. Manual acceptance and optional unrun
checks retain the explicit boundaries in the tagged release-readiness record.
