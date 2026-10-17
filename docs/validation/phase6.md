# Phase 6 implementation and validation

Updated: 2026-10-18. **RDLC Code 0.1.0 is published; five verification/corpus tasks
remain open.** Publication is complete, not a claim that every original acceptance
experiment has been executed.

## Release evidence

- Candidate `f59bad8d749069d58a4c18e687ab13e75e85423b` passed
  [CI 39075054671](https://github.com/Wald764/RDLC-Code/actions/runs/39075054671).
- Tag `v0.1.0` points to `4a8d3f58b2a28e185e41e796dc6bd0d4020278c6`; only the
  listed readiness Markdown changed after candidate testing. Detached validation
  passed locally and in the release workflow.
- [Release 39075357277](https://github.com/Wald764/RDLC-Code/actions/runs/39075357277)
  passed on attempt 1, including quality, all six desktop jobs, canonical package,
  credential preflights and all three publishers. The same bytes were downloaded
  independently from GitHub, Marketplace and Open VSX.
- Canonical artifact: `12116543913`; VSIX SHA-256:
  `13d7ed0be2110f81600615988b45e22eb596b3bdb37ff8b3b05f31503b5127f6`.
- See [release-010.md](release-010.md) for manifest/archive hashes and the exact
  publication record, and the tagged [readiness record](release-readiness.md) for
  candidate-bound acceptance and its explicit claim boundaries.

## Task status

| Task      | Status                              | Basis / remaining work                                                                                                                                                                                                                 |
| --------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T062      | Open                                | Actual-package CSP/resources and malicious-entity tests pass; owner reports isolation accepted. Instrumented untrusted-workspace network/listener/runtime-CSP automation remains absent; see isolation.md.                             |
| T063      | Complete for approved scope         | Owner reports keyboard/functional/performance acceptance; automated budgets and record-validator tests pass. Detailed timing records and five-author study are optional, not claimed executed.                                         |
| T064      | Complete                            | Exact package identity/content checks, complete parser/project/designer licenses, six minimum/stable three-OS desktop jobs and independent published-package inspection pass.                                                          |
| T065      | Complete for approved scope         | English build/install/profile/release instructions, license review and CI build/install checks; independent contributor reproduction is optional.                                                                                      |
| T066–T067 | Complete                            | Stable tag/version/commit/evidence tests and actual detached-tag validation, including candidate/tool binding and full documentation-only diff checks.                                                                                 |
| T068      | Open                                | Digest/provenance/partial-success/conflict/window cases are tested. A focused concurrent same-tag exclusion test remains missing; workflow concurrency configuration alone is not that experiment.                                     |
| T069–T070 | Complete                            | Tested immutable manifest, full-inventory recovery planner, source-free CLI, sanitized configuration and credential preflight.                                                                                                         |
| T071      | Complete for PAT mode               | Job-local GitHub token, Marketplace Azure federation and Open VSX PAT published probe and production packages. Owner chose to retain PAT; OIDC is not required.                                                                        |
| T072      | Complete                            | Hosted validation/shared quality/canonical build/package/install stages passed with immutable artifact output, accepted evidence hashes and tag concurrency configured.                                                                |
| T073–T074 | Complete                            | Shared source-free jobs verified a GitHub draft then published, followed by Marketplace and Open VSX using one canonical artifact.                                                                                                     |
| T075      | Complete                            | Fresh inventory and successful no-op recovery demonstrated by probe run 39069849589 attempt 2, without rebuilding or re-uploading; summaries and conflicts also have regression coverage.                                              |
| T076      | Complete as configuration/procedure | 90-day retention and durable release assets configured; rerun/window/missing-proof behavior documented and unit-tested. Elapsed retention and the full rerun window have not been observed.                                            |
| T077      | Open                                | Probe recovery and production remote-byte equality proven; remaining hosted injected destination failures/lost responses are unrun. See release-recovery.md.                                                                           |
| T078      | Open                                | Normal production chain and selected real failures observed; full fork/PR secret-isolation, negative-gate, cache/lockfile and concurrency experiments remain unrun. See github-actions.md.                                             |
| T079      | Open                                | Candidate gates, scoped owner acceptance and license checks passed. Manifest audit found 11 fixtures rather than the required minimum 12; textbox-supported declares an edit with an empty footprint.                                  |
| T080      | Complete for published release      | Active main/tag rulesets, tag-only publisher environments, configured credential paths and intended-tag validation observed. Solo direct pushes and PAT mode match owner policy. Tag/publication followed an explicit release request. |

## Scope changes and limits

The owner removed detailed performance measurements, five-author usability,
independent contributor reproduction and a separate interactive macOS session as
initial-release prerequisites. The three-OS automated matrix remains required.
Main blocks force pushes/deletion but allows solo direct pushes; CI runs after
pushes and remains mandatory in the release chain. These are documented policy
changes, not fabricated test passes.

External Microsoft-designer/ReportViewer consumer compatibility remains unproven;
the release claims offline source authoring, not report execution. No unrun
instrumented isolation or hosted failure experiment is marked complete. The
remaining tasks are tracked above rather than described as pending publication.

## Executed checks and maintenance history

Toolchain: Node 24.22.0, pnpm 11.28.2, TypeScript 6.0.3, Angular 22.2.3,
vsce 3.7.1 and test-electron 3.1.0. Declared minimum and resolved stable were
VS Code 1.142.0. Candidate/release checks passed: 44 Node and 14 Angular tests,
14 roundtrip, 10 compatibility, 8 release, 1 synthetic measurement-record test,
4 package/static-isolation tests and all six Electron suites in the desktop matrix.

Publication review corrected shared publisher configuration, repository/token
context, job dependency/no-op handling, both GitHub asset hashes, retry inventory,
early Open VSX credential verification, reusable-workflow secret inheritance,
paginated draft discovery and bounded registry visibility checks. Source-free CLI
regressions cover these paths; mocks are distinguished from hosted receipts.

The inert probe was retired after production publication: Marketplace hidden and
unpublished with history preserved; Open VSX versions withdrawn. GitHub assets,
tags and fixtures remain. [Publishing evidence](publishing-auth.md) records the
successful retirement run and unchanged production package hashes.
