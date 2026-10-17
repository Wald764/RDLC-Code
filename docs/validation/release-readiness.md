# Release readiness: 0.1.0

Date: 2026-10-18. Status: **accepted for the initial-release scope** by the owner.
Tested candidate: `f59bad8d749069d58a4c18e687ab13e75e85423b`.
Root and extension versions are both `0.1.0`; private packages retain their own
versions. The release tag may differ only in the validation Markdown listed below.

## Scope and operator acceptance

The owner confirmed the proposed create/edit/undo/save/reopen/source/native
lifecycle walkthrough, then confirmed isolation, keyboard/performance and Linux
checks as satisfactory. These are operator-reported acceptance results, not
independently recorded per-action traces. The initial Windows VSIX supplied for
that walkthrough had SHA-256
`f8eaebc8b338e214befc79a4981e81f876d947e5d1c1067a5289211b09beda1b`.

The candidate changes release policy/tooling, documentation and packaged notices,
not editor implementation, fixtures, dependencies or tool pins. A Git diff from
the manually tested source `bc992a957e03bc759119ba794d80944c0ce0293f` to the
candidate confirmed no changes in `apps/`, `packages/`, `tests/vscode/`,
`tests/fixtures/`, `pnpm-lock.yaml`, `.node-version` or `package.json`.
The owner-approved manual results are retained for that unchanged implementation;
the candidate package and its new notices were separately rebuilt and retested.

The owner explicitly removed detailed performance records, the five-author study,
independent contributor reproduction and a separate interactive macOS session as
initial-release prerequisites. They are not represented as executed tests.
Automated source-budget correctness, keyboard/functional/isolation acceptance,
three-OS CI, license review, artifact identity and publication checks remain.

## Candidate checks

Hosted run [39075054671](https://github.com/Wald764/RDLC-Code/actions/runs/39075054671)
completed successfully on this exact candidate. Its quality job and all six
desktop jobs passed, followed by **Required checks**. The desktop matrix covers
Windows 2022, Ubuntu 24.04 and macOS 14, each on VS Code 1.142.0 and stable.
Each desktop job builds/packages and runs development and installed-VSIX suites.
VS Code 1.142.0 is the actual declared minimum, superseding older 1.110 proposals.

The quality job passed formatting, lint, typecheck, 44 Node tests, 14 Angular tests,
14 roundtrip tests, 10 compatibility tests, the synthetic measurement-record test,
8 release tests, commit policy and the production build. The synthetic performance
test validates records; it is not a measured editor benchmark.

A local Windows candidate build/package and installed-VSIX run also passed:
4 package/static-isolation tests and all six Electron suites (activation,
existing-report, lifecycle, new-report, persistence, synchronization). Expected
read-only and externally modified save errors were passing refusal assertions.
The resulting local VSIX SHA-256 was
`85c7e82a32d79bd93ff931ed942643b0442ab61aa31b7c455969ccc928daa103`.
This is a local build digest, not a prediction of the hosted canonical digest;
ZIP timestamps may differ. Publication must use the hosted artifact exclusively.

## Accepted evidence categories

All categories below apply to the candidate's unchanged editor implementation,
current toolchain and initial-release claim boundaries.

| Category                                          | Accepted basis and boundary                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| preservation / compatibility                      | Candidate CI roundtrip, fixture and capability/refusal tests; exact source-footprint evidence in us1.md and us2.md                                                                                                                                           |
| lifecycle / V8                                    | Six installed suites plus owner-reported native lifecycle acceptance; refusal, conflict and failed-save assertions do not discard pending work                                                                                                               |
| isolation                                         | Owner-reported untrusted-workspace isolation acceptance plus actual-package CSP/local-resource and malicious-entity checks; no independently retained network/listener/runtime-CSP traces are claimed                                                        |
| keyboard                                          | Owner-reported keyboard acceptance plus component label/form/keyboard checks; no separate recorded macOS interactive session                                                                                                                                 |
| licenses                                          | Complete original MIT, saxes ISC/inherited and xmlchars MIT notices, plus generated Angular notices; see licenses.md                                                                                                                                         |
| cross-os / V2                                     | All six candidate desktop jobs passed on minimum/stable; owner also reports Linux working                                                                                                                                                                    |
| V1                                                | Pinned Angular 22.2.3, TypeScript 6.0.3, Node 24.22.0, pnpm 11.28.2 and vsce 3.7.1; published metadata in toolchain.md and successful candidate CI                                                                                                           |
| V3                                                | Parser/refusal/offset/namespace/source-preservation tests and shipped dependency notices                                                                                                                                                                     |
| V4                                                | Seven local field-type mappings and query-free authoring tested; external ReportViewer/Microsoft-designer interoperability is not a release claim; see local-data.md                                                                                         |
| V5 / V6                                           | Synthetic table hierarchy, scoped Sum/footer, atomic structural edits and installed creation tests; opaque/spanning structures stay preservation-only; no external runtime execution claim                                                                   |
| V7                                                | Automated bounded parser/protocol tests and owner functional/performance acceptance; detailed workstation timings remain optional and unmeasured                                                                                                             |
| github-auth / marketplace-auth / openvsx-pat-auth | Tag-restricted shared publication jobs authenticated and uploaded the inert probe; records and exact registry hashes in publishing-auth.md                                                                                                                   |
| recovery / openvsx-recovery                       | Probe run 39069849589 attempt 2 reused artifact 12114239416 after a real partial-publication/visibility failure, with fresh inventory and no rebuild or duplicate upload; local release/CLI tests cover conflicts, missing proof and other recovery branches |
| github-actions                                    | Candidate CI passed; actual publisher chain passed with the tagged probe; main/tag rulesets and tag-only publisher environments inspected through authenticated API                                                                                          |

## Distribution and repository settings

Publisher/namespace: `Wald764`. Open VSX uses the configured environment PAT mode,
not untested OIDC. The shared source-free publisher jobs verify the tag, source,
run, immutable artifact ID and VSIX digest and re-inventory before writes.

Active rulesets were read back from the GitHub API:

- `protect-main` (25321470): no deletion or force pushes. The owner selected solo
  mode: direct pushes are allowed, CI runs after pushes, and release gates remain.
- `release-tag-creation` (25321471): `v*` creation restricted to Repository admin.
- `release-tag-immutability` (25321474): `v*` updates/deletions restricted, no bypass.

Only `Wald764` has repository push/admin permissions; no collaborator invitations
were pending at inspection. Application installations were not exhaustively audited.
Both publisher environments have only a `v*` tag deployment rule. Administrators
can edit policy; no destructive live ref mutation was attempted to test rejection.

## Unclaimed results

No detailed performance samples, five-author study, independent reproduction,
interactive macOS run or external RDLC runtime-consumer acceptance is claimed.
Operator reports are distinguished from automated observations. Open VSX OIDC,
the full 30-day/50-attempt window and every hosted failure-injection variant have
not been exercised. Synthetic recovery cases are not hosted receipts. The stable
editor publication itself will be observed only after tagging; the tagged inert
probe establishes the pre-release credential/artifact/recovery path.

## Machine-readable acceptance record

The `passed` statuses below accept the explicitly bounded evidence above; they
do not turn the unclaimed results into successful experiments.

```json
{
  "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b",
  "version": "0.1.0",
  "tools": {
    "node": "24.22.0",
    "pnpm": "11.28.2",
    "typescript": "6.0.3",
    "angular": "22.2.3",
    "vsce": "3.7.1"
  },
  "openvsx": "pat",
  "permittedEvidenceChanges": ["docs/validation/release-readiness.md"],
  "evidence": {
    "preservation": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "compatibility": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "lifecycle": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "isolation": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "keyboard": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "licenses": {
      "status": "passed",
      "path": "docs/validation/licenses.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "cross-os": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v1": {
      "status": "passed",
      "path": "docs/validation/toolchain.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v2": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v3": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v4": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v5": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v6": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v7": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "v8": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "github-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "marketplace-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "recovery": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "github-actions": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "openvsx-pat-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    },
    "openvsx-recovery": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "f59bad8d749069d58a4c18e687ab13e75e85423b"
    }
  }
}
```
