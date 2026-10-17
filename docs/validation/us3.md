# User Story 3 verification: native document lifecycle

Date: 2026-10-17. Scope: phase 5, T053–T061. Working tree based on
`98cbe8728037e89a7b610a801b728a2a656bf440`; this is not a version-prepared
release candidate. Implementation is present; acceptance remains incomplete
until the native dirty-close dialog cases below are executed.

## Environment

Windows x64, Node 24.22.0, pnpm 11.28.2, TypeScript 6.0.3, Angular 22.2.3,
Vitest 5.0.5 and test-electron 3.1.0. VS Code stable resolves to 1.142.0,
also the declared minimum. The pinned Node directory is prepended to PATH;
the machine's default Node 22.22.3 was not used for validation.

## Implementation

- Views of one TextDocument share a serialized request queue. Bindings refresh
  when dequeuing, with another version check immediately before WorkspaceEdit.
  Disposed views cannot submit queued writes.
- Scalar planning independently rejects stale versions. The host handles
  applyEdit refusal/exceptions and checks live version/source against the verified
  candidate before acknowledging success. It publishes actual document state,
  including uncertain results; it never retries edits.
- Multiple custom editors per document are enabled. Source opening resolves the
  active custom-editor tab URI, including when activeTextEditor is absent or
  belongs to another group. Malformed XML remains source-accessible.
- Webview reception, document subscriptions and Angular message listeners are
  disposed with their owners. Dirty state, undo, persistence, Save As, close
  and external conflict handling remain native VS Code services.
- The adapter ignores delayed/duplicate snapshots and outdated results. Protocol
  errors block sends and request a fresh handshake/snapshot without replaying
  edits. Invalid source blocks visual writes while preserving source access.
- Version changes invalidate selection and recreate authoring forms with a
  visible stale-draft explanation and focus restart point. Form/keyboard commits
  remain explicit; no pointer-drag editing or visual undo stack exists. Request
  IDs use UUIDs. Accepted edits are labeled “Applied to document”, not “Saved”.

## Automated evidence

The synthetic MIT `textboxes/supported.rdlc` supplies the existing-report scenario;
provenance and MS-RDL citations are in the fixture manifest. No fixture or vendor
content was modified.

| Check                         | Observed outcome                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20 sequential visual intents  | All 20 native undo/redo steps match exact intermediate strings; dirty state clears at the saved baseline                                                                                                   |
| Structural lifecycle          | Dataset, decimal field, table, column, group and subtotal: each native undo/redo restores exact source, followed by save/reopen                                                                            |
| Native save/close/discard     | Saved content reopens exactly; explicit native Revert and Close discards the intentionally pending edit                                                                                                    |
| Failed/read-only save         | A test-only FileSystemProvider throws NoPermissions through the real save service; save returns false, pending text stays dirty, stored bytes stay unchanged, and retry succeeds after permissions recover |
| Save As                       | Existing new-report suite re-executes associated untitled save/reopen; no interactive picker is driven                                                                                                     |
| Multiple views                | Two actual designer tabs open for one URI; the source command resolves that URI; two observed sessions converge on versioned snapshots                                                                     |
| Races and replay              | Same-version racing requests produce only the first mutation; duplicate/delayed requests, foreign IDs and old versions cannot change source                                                                |
| Invalid-to-valid source       | Both observed sessions receive invalid-source snapshots; stale actions cannot replace malformed text; repairing source restores editing                                                                    |
| applyEdit failure/uncertainty | An injected apply function returns false, throws, or returns true without changing source; all yield rejected results and unchanged source, never speculative success                                      |
| Disposal                      | Disposed sessions emit no further snapshots and cannot submit writes                                                                                                                                       |
| No-op bytes                   | UTF-8, UTF-8 BOM and UTF-16LE BOM with CRLF preserve exact bytes through native no-op save; EOL remains CRLF                                                                                               |
| Clean filesystem change       | A filesystem-service write refreshes the clean TextDocument without forced reload                                                                                                                          |
| Dirty filesystem conflict     | Pending local text remains dirty; save returns false with File Modified Since, disk retains external source, and explicit native revert chooses disk content                                               |
| Angular lifecycle             | Delayed/duplicate snapshots/results are ignored; invalid-source sends are blocked; errors renegotiate without retry; obsolete input is removed, focus restarts and source remains available                |

An additional interleaving check applies a real WorkspaceEdit, changes source and
restores the candidate before returning. The host rejects speculative success
because the version advanced again, while preserving and publishing actual source.

Permission-error and modified-since messages in Electron output are expected
native failure-path assertions. Session checks use production session code and
real TextDocuments; the three apply-function substitutions are synthetic. They
do not automate messaging inside installed Angular webviews. Filesystem-service
writes test model conflicts, not a separate process's OS watcher.

Before implementation, Angular lifecycle tests failed because the notice did not
exist. Initial Electron attempts using immediate raw filesystem writes outside
the workspace did not observe clean reload. These were not counted as passes
or solved with forced reload: the final deterministic check uses filesystem
notifications with an explicit native watcher for the outside-workspace temporary
directory. Removing that watcher caused the packaged clean-reload check to fail;
restoring it resolves the test setup without adding a production reload path.
The separate external-process OS-watcher obligation remains below.

## Executed commands

Final checks pass with exit code 0 under the environment above:

| Command                                            | Result                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Formatting, boundaries, TypeScript and Angular templates pass          |
| `pnpm test:unit`                                   | 36 Node tests and 14 Angular tests pass                                |
| `pnpm test:roundtrip`                              | 14 preservation/authoring checks pass                                  |
| `pnpm test:compatibility`                          | 10 fixture/profile checks pass                                         |
| `pnpm build`                                       | Bundled host and local Angular production assets                       |
| `pnpm package`                                     | `dist/rdlc-code-0.1.0.vsix`, 11 files, approximately 96 KB             |
| `pnpm test:vscode`                                 | Six Electron suites pass on Windows / VS Code 1.142.0                  |
| `pnpm test:package`                                | Package bootstrap and the same six suites pass with the installed VSIX |

The final Electron runs include the version-interleaving regression. The last
unit run precedes that host acknowledgement guard; its focused coverage is the
Electron synchronization suite. No dependencies, package versions or lockfile
were changed. Root ignore files already cover generated Node/Angular material;
no Docker, Terraform, Helm or npm library publication setup required new ignores.

## Required manual acceptance: pending

T053 and the final T061 checkpoint remain unchecked. The public extension-test API
does not expose native dirty-close dialog choices; no private dialog API or
synthetic passing substitute was added.

With the installed VSIX and a disposable copy of the supported textbox fixture:

1. Edit a textbox visually, confirm the dirty tab, close and choose **Cancel**.
   Verify source, dirty state and pending edits remain; undo/redo and further
   visual/source edits must still work.
2. Close again and choose **Save**. Reopen from disk; compare intended changes and
   exact untouched XML, including the opaque extension element.
3. Edit again, close and choose **Don't Save**. Reopen and verify only that pending
   edit was discarded. Repeat cancellation on an untitled report; cancel its
   Save As picker and confirm the complete report remains dirty.
4. In another process, modify a clean file and confirm reload; repeat while dirty
   and exercise native conflict comparison/resolution. Confirm both pending and
   external contents remain available before choosing either. Repeat with an
   actual read-only file and cancel any overwrite prompt.
5. Repeat with two designers and source. Introduce invalid XML, confirm disabled
   visual writes, deliberately save as text, then repair source.

Record OS, VS Code/extension versions, tested commit, fixture, every choice and
exact source/disk outcomes. Any silent loss or failing save/conflict/undo safeguard
blocks release. Missing evidence also blocks full V8 acceptance. macOS/Linux,
physical read-only files, OS watchers and full installed-webview interaction are
unverified locally.

The existing 1,024-request session replay budget remains a documented limit in
`apps/vscode-extension/src/protocol.ts`; exceeding it refuses edits without losing
source. Long-session replay-protection redesign is outside this increment.
