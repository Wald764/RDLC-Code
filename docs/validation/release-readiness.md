# Release readiness: 0.2.0

Date: 2026-10-23. Status: **accepted within the evidence boundaries below**.
Tested candidate: `88a01358bbcaac21d6628713c4a7baf57ef0a817`.
Root and extension versions are both `0.2.0`; private packages retain their own
versions. Only this readiness record may change between candidate and release.

## Candidate checks

Hosted [CI run 40028926039](https://github.com/Wald764/RDLC-Code/actions/runs/40028926039)
passed on this exact candidate: quality, all six desktop jobs and Required checks.
The matrix covers Windows 2022, Ubuntu 24.04 and macOS 14, each on VS Code 1.142.0
and stable. Every desktop job builds and packages the extension, then runs both
development-extension and installed-VSIX suites.

Quality passed formatting, lint, host/designer typechecking, Node and Angular unit
tests, roundtrip, compatibility, synthetic acceptance, release tests, commit policy
and the production build. Local Windows development and installed-VSIX checks on
VS Code 1.142.0 also passed all seven native suites; five package checks passed.
The packaged local version was `dist/rdlc-code-0.2.0.vsix`. Publication must use the
hosted canonical artifact, not that local build.

The previous CI failures were resolved without weakening assertions or removing
matrix entries. History-guard edits now use the document EOL and the regression
explicitly runs with LF and CRLF. The test launcher disables GPU rendering;
the previously unresponsive Ubuntu minimum-version job now passes. Failed desktop
jobs retain profile logs for diagnosis.

For tag pushes, commit-subject validation checks the tagged commit instead of
using the previous tag object's SHA as a branch-range base. That old tag object
can be absent after an authorized tag correction. Branch/PR range checks are
unchanged; new-tag pushes already checked only the tagged commit.

## Maintainer-reported acceptance

On 2026-10-23 the maintainer explicitly confirmed successful manual journeys for
the new editor: create/edit/save/reopen with Undo/Redo, keyboard creation and
restricted-workspace behavior. These are operator-reported results, not
independently recorded per-action traces. Component, native history, persistence,
read-only/refusal and packaged-isolation tests provide separate automated evidence.

The detailed feature observations and remaining limits are recorded in
[designer-ux-ui-overhaul.md](designer-ux-ui-overhaul.md) and
[drag-drop-creation.md](drag-drop-creation.md). Their older unrun observations are
not retroactively represented as executed experiments. This confirmation covers
only the manual journeys named above.

## Accepted evidence categories

- **Preservation / compatibility:** candidate CI roundtrip, fixture and
  compatibility tests; unknown content and refused/no-op edits remain preserved.
- **Lifecycle / V8:** seven native suites in development and installed modes on
  all matrix entries; maintainer-confirmed save/reopen and Undo/Redo.
- **Isolation:** maintainer-confirmed restricted-workspace behavior plus package
  CSP/local-resource and read-only/untrusted refusal tests. No independent runtime
  network trace is claimed.
- **Keyboard:** maintainer-confirmed keyboard creation plus component focus and
  navigation and native history checks. Screen-reader observations remain unrun.
- **Licenses:** existing review and packaged notices, plus candidate package
  checks; dependency lockfile and tool pins are unchanged. See licenses.md.
- **Cross-OS / V2:** all six candidate desktop jobs passed on minimum and stable.
- **V1:** Node 24.22.0, pnpm 11.28.2, TypeScript 6.0.3, Angular 22.2.3 and vsce
  3.7.1; unchanged pins and successful candidate CI.
- **V3:** candidate parser/refusal/source-preservation tests and shipped notices.
- **V4:** local typed fields and query-free authoring tests. External
  ReportViewer/Microsoft-designer interoperability is not a release claim.
- **V5 / V6:** candidate structural table/group/total and native creation/history
  tests; opaque or spanning structures remain preservation-only.
- **V7:** automated parser/protocol/snapshot budgets and the existing bounded
  rendered-designer observations. Synthetic acceptance is not a hardware benchmark.
- **GitHub / Marketplace / Open VSX PAT authentication:** retained controlled
  proof in publishing-auth.md and successful 0.1.0 production publication in
  release-010.md. Publishing code, workflows, tool pins and lockfile are unchanged
  from the previous accepted candidate. Fresh credential preflights still run
  before 0.2.0 publication.
- **Recovery / Open VSX recovery:** retained proof in publishing-auth.md and
  release-recovery.md; candidate release tests pass. No new hosted
  failure-injection experiment is claimed.
- **GitHub Actions:** candidate full CI passed. Main/tag rulesets were read
  through the authenticated API; publisher environments and the unchanged
  source-free publisher chain retain their previous evidence.

## Distribution and tag correction

Publisher/namespace: `Wald764`; Open VSX mode: `pat`. The release validator and
source-free publisher chain remain unchanged and still bind the canonical bytes
to source, toolchain, accepted evidence and successful gates.

The first `v0.2.0` tag pointed to `d7661d8342be3b097861e36e1ec4192138136512`,
whose root/extension versions were still `0.1.0`. Its release validation failed
before packaging or publication. The maintainer explicitly requested replacing
that tag with a CI-passing commit and authorized a temporary exception for this
tag alone. The tag was moved to the tested candidate; the original immutability
rule was immediately restored. The evidence-only release commit must be validated
and pass CI before the maintainer-authorized tag correction is finalized.

Rulesets inspected: `protect-main` (25321470), `release-tag-creation` (25321471)
and `release-tag-immutability` (25321474). Main blocks deletion/force pushes; tag
creation requires the admin bypass; tag updates/deletions have no standing bypass.
No general protection was disabled. The temporary exact-tag exception is an
explicitly authorized recovery operation, not the normal release procedure.

## Unclaimed results

No five-author study, human journey timings, screen-reader observations,
independent contributor reproduction, interactive macOS session or external RDLC
runtime-consumer acceptance is claimed. Open VSX OIDC and the complete hosted
failure-injection/retention window remain untested. The new release's registry
credentials and canonical-byte publication are verified by its own preflights and
publisher jobs, not assumed from earlier publication evidence.

## Machine-readable acceptance record

The `passed` statuses accept the explicitly bounded evidence above; they do not
turn unclaimed results into successful experiments.

```json
{
  "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817",
  "version": "0.2.0",
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
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "compatibility": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "lifecycle": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "isolation": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "keyboard": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "licenses": {
      "status": "passed",
      "path": "docs/validation/licenses.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "cross-os": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v1": {
      "status": "passed",
      "path": "docs/validation/toolchain.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v2": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v3": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v4": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v5": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v6": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v7": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "v8": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "github-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "marketplace-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "recovery": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "github-actions": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "openvsx-pat-auth": {
      "status": "passed",
      "path": "docs/validation/publishing-auth.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    },
    "openvsx-recovery": {
      "status": "passed",
      "path": "docs/validation/release-readiness.md",
      "candidate": "88a01358bbcaac21d6628713c4a7baf57ef0a817"
    }
  }
}
```
