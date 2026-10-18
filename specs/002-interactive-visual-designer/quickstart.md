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

SC-005 (presented-feedback latency) was removed from acceptance by owner decision on 2026-10-18; no latency collection is required.

Automated tests establish source/layout behavior; installed timed (SC-001), accessibility and offline runs supply their own evidence. Neither proves external RDLC runtime rendering fidelity.
