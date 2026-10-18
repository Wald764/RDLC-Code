# Interactive Designer Validation Guide

## Prerequisites

- Node 24.15.x (or the supported Node 24 version in `.node-version`), pnpm 11.28.2 and desktop VS Code compatible with the extension manifest.
- A checkout containing the implemented `002-interactive-visual-designer` feature (planning currently runs on Git branch `main`). These instructions describe validation after implementation; generating this plan does not implement the feature.
- Use the existing fixture corpus and `tests/fixtures/manifest.json`. Add documented interactive fixtures for mixed body textboxes/tables, missing geometry, foreign metadata and clipboard dependencies. Preserve fixture provenance and MS-RDL citations.

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:roundtrip
pnpm test:compatibility
pnpm build
pnpm test:acceptance
pnpm test:vscode
pnpm package
pnpm test:package
```

Build precedes acceptance/native/package checks because those commands consume compiled output. Existing commands are real; their current coverage is baseline coverage and must be extended for this feature. Installed checks must use the newly built VSIX, not only a development webview.

## Validation scenarios

1. **Manipulate and preserve.** Open `tests/fixtures/textboxes/supported.rdlc` and `tests/fixtures/tables/grouped.rdlc`, then a mixed interactive fixture. Move each whole item and exercise all eight handles, including north/west table scaling. Check property agreement, preserved contents/groups, one native Undo/Redo per operation and exact source restoration. Test optional dimensions, mixed units, invalid/nonpositive size, overflow and no-op. Assert exact equality outside the declared footprint, not only reparsed values.
2. **Select and arrange.** Shift-toggle and marquee mixed items; exercise keyboard item-list selection, primary changes, obscured/unknown-bounds placeholders and Select All. Move as a group, run all six alignments and both distributions. Refuse a locked member, an invalid member, fewer than three distribution targets and negative gaps with zero partial changes.
3. **Navigate precisely.** At 25%, 50%, 100%, 200%, 400%, with scroll and nondefault display scaling, compare equivalent moves/resizes within 0.01pt. Verify grid ties, guide ties/priority, 6-screen-pixel tolerance, Alt bypass, pointer anchor, Space pan, edge auto-scroll, fit commands and overflow access. Run 100 forward/backward nudges and require at most 0.01pt drift. View-only actions must not dirty the document.
4. **Reuse safely.** Copy textbox/table/multi-selection and paste repeatedly at 10pt then 20pt offsets. Duplicate offsets 10pt without changing clipboard. Verify report-wide item/cell/group names, mapped internal references, retained external references and namespace meaning. Transfer between compatible open reports; reject missing/type-incompatible fields, incompatible scopes, opaque identities, malformed/oversized/foreign-version/plain-text clipboard and a foreign-window token. Inject clipboard write failure and stale cut source; both leave source unchanged. One Undo restores every accepted cut exactly.
5. **Race and cancel.** During pointer/key preview use Escape, focus loss, capture loss, source split-view changes and native Undo/Redo. Save during preview must exclude preview changes. Submit a duplicate request, reject native apply, change source while pending and exercise read-only documents. Confirm actual authoritative state and no stale retry. Trigger property-draft apply/discard/cancel and independent invalidation.
6. **Native lifecycle.** Perform twenty consecutive mixed accepted operations, then twenty Undos and Redos; compare complete source and selection states. Exercise failed Save, Save As, close cancellation, encoding/EOL preservation and multiple views. Accepted unsaved work must survive failures.
7. **Keyboard and offline.** With only keyboard, perform all actions listed in SC-006, including numerical resize and every alignment/distribution. Ensure field typing/clipboard/arrows remain normal, focus is visible and not trapped, and statuses are announced. Repeat installed workflows offline in trusted and untrusted local workspaces; active report content must remain inert.

## Evidence and pass criteria

Record feature evidence in `docs/validation/interactive-designer.md` during implementation/acceptance: candidate commit, installed VSIX, platform/VS Code versions, fixture paths, commands/results and remaining external-runtime limitations. Follow the [interaction](contracts/interaction.md), [layout](contracts/layout-protocol.md), [clipboard](contracts/clipboard.md) and [data model](data-model.md) contracts.

For SC-001 record the representative fixture and a timed run of selection, diagonal drag, corner resize, alignment, duplication and save/reopen; the complete sequence must take at most three minutes without source edits or typed coordinates.

For SC-005 record CPU, RAM, OS, display scaling, VS Code version, fixture size (at most 1 MiB) and 100 selectable body items. At both 100% and 200%, collect 100 samples for selection/manipulation feedback (input event to painted preview) and accepted edits (submission to painted authoritative snapshot), including a 20-item move. At least 95 samples in each applicable series must meet 50ms/200ms respectively. Extend the existing measurement validator rather than interpreting baseline measurements as proof of these new boundaries.

### SC-005 collection protocol (implemented by T082)

- Entry point: `tests/performance/measure-interactive.ts`, invoked by the installed test driver; T082 documents its exact runnable invocation here after integration. Reuse the existing installed VSIX/test tooling and add no dependency.
- Start timestamps use the webview's monotonic `performance.now()` clock at the input handler entry (selection/manipulation feedback) or immediately before submission (accepted edit). Record operation/sample ID, zoom, selection size and, for submissions, request ID and base/result versions.
- The driver captures Chromium rendering trace/presented-frame evidence for the visible installed designer. Correlate the feedback state or matching request/result-version authoritative DOM state with its first presented frame; record trace clock alignment to the same webview clock. Selection feedback means its visible selection state, not a required drag preview. Do not combine unsynchronized host/webview clocks.
- DOM updates, host apply completion and requestAnimationFrame callbacks are readiness markers only, not proof of presentation. Hidden/throttled views, missing frame evidence or unmatched request/version leave the run unresolved; do not silently discard slow valid samples or substitute synthetic timings.
- Export raw start/end timestamps, durations, state/request/version correlations and trace/frame references alongside the candidate/VSIX/environment/fixture identity under the validation evidence location. Record 100 valid samples for each applicable selection, manipulation and accepted-edit series at each zoom, including 20-item moves. Validate the full export and retain failed/unresolved runs.
- Add focused harness/validator checks for wrong result versions, missing presentation evidence, clock mismatch, nonfinite/negative durations and incomplete series. Synthetic records exercise these checks only; T084 records actual desktop runs.

Automated tests establish source/layout behavior; installed timed, accessibility and offline runs supply their own evidence. Neither proves external RDLC runtime rendering fidelity.
