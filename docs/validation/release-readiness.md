# Release readiness: 0.3.0

Date: 2026-11-04. Status: **accepted within the evidence boundaries below**.
Tested candidate: `b965f598cd63d15d21ee7bdfbca347834bca2c7e`.
Root and extension versions are both `0.3.0`; private packages retain their own
versions. Only this readiness record may change between candidate and release.

## Scope

Version 0.3.0 adds feature 005, native sidebar integration. The spec was closed in
PR #2 with documented scope exclusions, recorded in the "Delivery Scope Decision"
section of `specs/005-native-sidebar-integration/automated-validation.md`. It also
includes the US6.1 test stabilization (PR #3).

## Candidate checks

Hosted [CI run 41896072591](https://github.com/Wald764/RDLC-Code/actions/runs/41896072591)
passed on `e0c53a946564d8a0c275e5b591b4a307176e2079` (attempt 2; in attempt 1 one
macOS job was never acquired by a hosted runner). It covered quality, 18 desktop
jobs (ubuntu-24.04, windows-2022 and macos-15, each on VS Code 1.142.0 and stable,
across the core, authoring and context suites), pinned visual references, the
stability gate and Required checks.

The candidate differs from `e0c53a9` only by the version strings in the two
`package.json` files and the VSIX path in `README.md`. The release workflow's
quality job reruns the full CI on the tag commit before canonical packaging and
publication, so publication is blocked if it fails. Publication must use the hosted
canonical artifact.

## Acceptance basis

No maintainer manual acceptance has been recorded for 0.3.0, unlike 0.2.0. The
evidence for this release is automated only.

Platform exclusions remain: host observation is Linux-only, four macOS-only cases
are out of scope, and native drag is unavailable-with-evidence.

## Accepted evidence categories

- **Preservation / compatibility:** candidate-equivalent CI roundtrip, fixture and
  compatibility tests; unknown content and refused/no-op edits remain preserved.
- **Lifecycle / V8:** native suites in development and installed modes on all
  matrix entries, including native history and persistence tests.
- **Isolation:** package CSP/local-resource and read-only/untrusted refusal tests.
  No independent runtime network trace is claimed.
- **Keyboard:** automated component focus and navigation and native history checks.
  Screen-reader observations remain unrun.
- **Licenses:** existing review and packaged notices, plus package checks; see
  licenses.md.
- **Cross-OS / V2:** all 18 desktop jobs passed on minimum and stable.
- **V1:** Node 24.22.0, pnpm 11.28.2, TypeScript 6.0.3, Angular 22.2.3 and vsce
  3.7.1; successful CI.
- **V3:** parser/refusal/source-preservation tests and shipped notices.
- **V4:** local typed fields and query-free authoring tests. External
  ReportViewer/Microsoft-designer interoperability is not a release claim.
- **V5 / V6:** structural table/group/total and native creation/history tests;
  opaque or spanning structures remain preservation-only.
- **V7:** automated parser/protocol/snapshot budgets and the pinned visual
  references. Synthetic acceptance is not a hardware benchmark.
- **GitHub / Marketplace / Open VSX PAT authentication:** retained controlled
  proof in publishing-auth.md and earlier production publications. Fresh
  credential preflights still run before 0.3.0 publication.
- **Recovery / Open VSX recovery:** retained proof in publishing-auth.md and
  release-recovery.md; release tests pass in CI. No new hosted failure-injection
  experiment is claimed.
- **GitHub Actions:** full CI passed on the tested commit; the tag-commit rerun in
  the release workflow is the final gate.

## Distribution

Publisher/namespace: `Wald764`; Open VSX mode: `pat`. The release validator and
source-free publisher chain bind the canonical bytes to source, toolchain,
accepted evidence and successful gates.

## Unclaimed results

No maintainer manual journeys, five-author study, human journey timings,
screen-reader observations, independent contributor reproduction, interactive macOS
session or external RDLC runtime-consumer acceptance is claimed. Open VSX OIDC and
the complete hosted failure-injection/retention window remain untested. The new
release's registry credentials and canonical-byte publication are verified by its
own preflights and publisher jobs, not assumed from earlier publication evidence.

## Machine-readable acceptance record

The `passed` statuses accept the explicitly bounded evidence above; they do not
turn unclaimed results into successful experiments.

```json
{
  "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e",
  "version": "0.3.0",
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
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "compatibility": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "lifecycle": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "isolation": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "keyboard": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "licenses": {
      "status": "passed",
      "path": "docs/validation/licenses.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "cross-os": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v1": {
      "status": "passed",
      "path": "docs/validation/toolchain.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v2": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v3": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v4": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v5": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v6": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v7": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "v8": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "github-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "marketplace-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "recovery": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "github-actions": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "openvsx-pat-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    },
    "openvsx-recovery": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "b965f598cd63d15d21ee7bdfbca347834bca2c7e"
    }
  }
}
```
