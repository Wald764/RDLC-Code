# Installed isolation evidence

Updated: 2026-10-18. Status: **owner acceptance reported; instrumented automation
incomplete**. T062 remains open for the detailed checks below. The owner reported
isolation satisfactory for the initial release; that report is recorded in the
tagged readiness record. Production package checks and the three-OS installed
matrix passed, but do not supply independently retained runtime isolation traces.

Automated checks inspect the actual packaged HTML/JS/CSS, local resource graph,
strict CSP, nonce-bearing script tags, source-map exclusion and absence of remote
font/CSS references. Synthetic MIT local/remote external-entity fixtures in
`tests/fixtures/security/` must be rejected as source-only without source loss.
They cite MS-RDL security `vendor/04-security/4-security.md`; rejecting DTDs is
the editor's stricter input policy, not a claim that MS-RDL defines XML parsing.

These static/domain checks do not prove installed network/listener isolation,
browser runtime style nonces, chunk loading or execution absence. The current
Electron runner disables Workspace Trust and cannot supply untrusted-workspace
acceptance evidence. Do not label its normal installed smoke run as that proof.

Before accepting T062, install the exact candidate VSIX into an isolated profile,
enable Workspace Trust and open an explicitly untrusted workspace. Observe host
and webview network attempts (not only successful requests) and active listeners
before activation and throughout report operations. Open synthetic reports with
code modules, expression/function calls, queries, HTML-like literals, local and
remote images/hyperlinks, entities and nested opaque content. Use monitored
sentinel endpoints/files and assert zero access/execution. Confirm escaped text,
placeholders, usable source access, asset-only localResourceRoots, local chunks,
nonce-bound runtime component styles and zero CSP violations. Repeat minimum/
stable on all three OSes, separating VS Code's own traffic from report-triggered
traffic with call stacks/initiator attribution. Retain versions, fixture/digest
identities, observations and failures. No such instrumented session was run here.
