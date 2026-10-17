# Release readiness

Status: **blocked**, not a release candidate. Date: 2026-10-17.

Root and extension versions remain 0.1.0. No reviewed version-prepared candidate
has been accepted. This file deliberately has no passed JSON record; the release
validator must reject it rather than assume absent evidence passes.

Outstanding mandatory evidence includes native interactive lifecycle choices,
installed untrusted-workspace network/listener/runtime-CSP isolation, actual
paint-boundary SC-004 measurements, full installed keyboard workflow, five-author
usability acceptance, independent contributor reproduction and multi-OS results.
Consult the corresponding validation records for their exact boundaries.

GitHub/Marketplace authentication, controlled workflow and partial-publication
recovery proof are unrun. Open VSX is not configured by this implementation.
Publisher ownership, protected main/tags/environments and credential setup have
not been verified. Secret-free release stages are prepared but unrun; publisher
jobs remain pending T071's prerequisites.

Follow `docs/releases.md` to prepare the candidate and its single machine-readable
readiness record only after actual acceptance. Do not replace these blockers
with synthetic test outcomes or treat a local VSIX as publication approval.
