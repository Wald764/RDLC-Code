# Installed isolation evidence

Updated: 2026-11-08. Status: **owner acceptance reported; instrumented automation
incomplete**. T062 is closed by explicit owner acceptance for the current scope;
the unperformed instrumented checks below are waived for now. The owner reported
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

For an optional future instrumented check, install the exact candidate VSIX into an isolated profile,
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

## Embedded images: CSP and asset channel (feature 006)

Displaying embedded pictures changes one CSP directive and adds one message channel.
Everything else in the isolation model above is unchanged.

- The webview CSP is `img-src ${cspSource} blob:`. `blob:` was added for pictures;
  `data:` stays forbidden, and `connect-src 'none'`, the nonce-bound scripts and the
  asset-only `localResourceRoots` are untouched. `tests/package/offline.test.ts`
  asserts that `img-src` contains exactly `cspSource` and `blob:`.
- The scene and the snapshot stay geometry-only. An image scene item carries an asset
  key (the SHA-256 of the decoded bytes) and a display state or placeholder reason,
  never the payload. `tests/performance/images.test.ts` asserts that no base64 payload
  of the 50-picture fixture appears in the serialized scene.
- The host sends payloads only on the dedicated `imageAssets` message, once per key
  per webview. It sends validated PNG and JPEG definitions within the import limits
  (5 MiB, 16,384 px per side, 40 megapixels) and never SVG, GIF, BMP, external,
  database or expression-based images. The webview turns each payload into a `Blob`
  object URL, caches it by key and revokes it when no scene item references the key.
- Payloads never appear in logs, diagnostics, labels or tooltips. No picture is fetched,
  resolved or evaluated; the only file read is the user-chosen import file.

These are static and unit-level guarantees. `offline.spec.ts` and
`security-observer.spec.ts` now include image windows; they run on CI only and have
not been run locally. The instrumented network and listener observation described
above has not been run for images either.
