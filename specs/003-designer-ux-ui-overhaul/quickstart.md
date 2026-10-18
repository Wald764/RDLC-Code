# Quickstart Validation: Designer UX/UI Overhaul

**Purpose**: Validate the implemented feature end-to-end. These steps describe future implementation acceptance; planning has not run or passed them.

References: [plan](plan.md), [data model](data-model.md), [UI contract](contracts/workspace-ui.md), [host contract](contracts/editor-integration.md) and [feature acceptance criteria](spec.md#required-acceptance-coverage).

## Prerequisites

- Node.js >=24.15.0 <25 and pnpm 11.28.2, matching committed manifests/lockfile.
- Desktop VS Code satisfying the extension manifest (^1.142.0), on the platform under test. Record OS, VS Code version, interface scaling, screen-reader version, CPU/display and candidate commit.
- Use disposable copies of fixtures; retain exact originals for source equality checks. Start with `tests/fixtures/datasets/blank.rdlc`, `textboxes/supported.rdlc`, `tables/grouped.rdlc`, `interactive/mixed.rdlc`, `textboxes/unsupported-profile.rdlc` and `xml/malformed.rdlc`. Resolve provenance/profile details from `tests/fixtures/manifest.json` rather than ingesting the corpus indiscriminately.
- Network may be needed for initial dependency/VS Code test download and packaging. Offline feature acceptance starts after installation and test-runtime caching; it must require no network or server to edit reports.
- Run commands below from the repository root in PowerShell. Do not use the vendored reference directory for test outputs.

## 1. Reproducible automated checks

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:roundtrip
pnpm test:compatibility
pnpm build
pnpm test:acceptance
pnpm test:vscode
```

Expected: all checks pass on the same candidate commit. `build` prepares the compiled performance/native test inputs. For focused UI iteration, `pnpm --filter @rdlc/designer test` runs existing Angular component/helper checks. Once they pass, broaden to the listed inherited gates before acceptance; do not label performance budget tests as actual UX timing evidence.

For an installed-artifact run:

```powershell
pnpm package
pnpm test:package
```

Expected: package checks and installed-extension harness pass. `test:vscode` and `test:package` launch isolated test profiles; the harness disables Workspace Trust prompts, so they do not prove restricted-workspace behavior. Exercise that separately below. Do not publish a package during this validation workflow.

## 2. Start the real designer

After `pnpm build`, open a VS Code Extension Development Host using the repository's existing debug configuration or:

```powershell
code --new-window --extensionDevelopmentPath "$PWD/apps/vscode-extension"
```

In that host, invoke **RDLC Code: New Report**. For fixture copies, open the file and invoke **RDLC Code: Open Designer** (or Reopen Editor With → RDLC Designer). Use native Save/Save As and Undo/Redo. Confirm the report is an authored design surface, not populated preview.

Record the actual designer content viewport, excluding VS Code chrome. Resize editor groups to achieve the required CSS viewport cases; host window size alone is not the measurement.

## 3. Priority journeys

| Scenario              | Actions                                                                                                                                                                                                                     | Expected result / requirements                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank/textbox         | New Report; find Textbox; name it Title; set text, position, size, font and color; Save; reopen. Exercise invalid size, cancel creation and native Undo/Redo.                                                               | One real textbox; synchronized selection; field refusal leaves accepted geometry; content survives reopen; no-op/cancel leaves text exact. Stories 1/5, FR-001–010, 020–026, 034–036.    |
| Catalog honesty       | Search mixed-case labels, no match and clear; inspect all eleven cards; activate missing-dataset Table prerequisite; inspect disabled Preview.                                                                              | Canonical cards/category context, no-results recovery, real dataset flow only; unsupported cards/Preview explain limits and never simulate output. FR-007–010, 025.                      |
| Structure/arrangement | Open mixed fixture; select obscured item in tree; reveal offscreen item; select table then cell then dataset/field; additive-select body items; align/distribute/duplicate.                                                 | Primary/membership/count agree; unchanged zoom on reveal; no guessed bounds; table/cell/data controls distinct; preserved/opaque hierarchy truthful. Story 2, FR-011–013, 019, 022, 024. |
| Dataset-bound table   | Define text, number and date/time fields; create named bound table; add second field column; edit cell; configure row group and total; save/reopen. Also exercise all seven existing field types and guarded rename/delete. | Definitions/bindings/groups/totals preserved; only selected target forms appear; reference guards remain; no data retrieval/evaluation. Story 3, FR-009–012, 020–024.                    |
| Draft protection      | Change a field without applying; try tree selection, Code XML, creation/inspector transition and panel hide. Exercise Apply/Discard/Cancel, pending refusal and independent XML edit.                                       | Draft retained or explicitly guarded; Apply once, Discard continues, Cancel stays; no stale deferred replay; stale document change cancels safely with feedback. FR-017, 023, 029, 033.  |
| Source-only           | Open malformed, unsupported-version and unsupported-profile copies; view diagnostics, preserved entries where safe and Code XML.                                                                                            | Distinct useful explanation/source access, no endless loading or unsupported mutation; native history remains available when legitimately authorized. FR-024–026, 034–036.               |

Native file workflows must also cover Save As cancellation/failure, dirty-close cancellation, external changes and split-view reconciliation through existing 001/002 tests.

## 4. Native-history targeting proof

1. Open report A in two designer views and unrelated report B in a text editor. Make distinguishable accepted edits to A and B; capture both source texts.
2. Focus B, return to A's designer controls and invoke toolbar Undo/Redo. Repeat using non-input designer shortcuts.
3. Verify only A changes, both A views refresh, B remains exact and focus stays usable in the originating designer.
4. Exercise empty history, disposed/inactive panels, stale base version, another pending edit and result/snapshot arrival ordering. Every request settles or refuses without automatic retry.
5. Type inside a text field: local text Undo and arrow/clipboard behavior must not be intercepted as document history. Test draft Apply/Discard/Cancel before toolbar history.
6. Perform twenty mixed accepted document edits, including table/data and geometry changes. Undo and redo each individually; verify exact prior/final source and no history entries for view/no-op/cancel/refusal actions.

Expected: real native history, correct bound document and no competing local stack. Target-routing failure blocks this workflow's acceptance; it cannot be waived based on unit mocks.

## 5. Layout, coordinate and preference matrix

At **1280 × 800**, **1024 × 768**, **640 × 480** and **400 × 600**, then at **200% interface scaling**:

- Complete insertion, tree selection, numerical resizing and native save. No required action is lost in overflow; toolbar/status stay single-row and no whole-workspace horizontal scrolling is required.
- Measure default wide canvas >50% workspace width and >=70% height. With side overlays closed, measure >=320px canvas at workspace widths >=400px.
- Pointer-resize each panel; keyboard-resize in 10px steps. Verify defaults/bounds, hide/restore, left tabs, independent scrolling, compact overlay thresholds, one-overlay limit, Escape and focus return.
- Hide/show panels while idle: measure the same center report point at unchanged zoom, allowing only scroll-bound clamping. Overlay/menu/diagnostic opening does not change the viewport frame.
- Repeat at **25%, 50%, 100%, 200%, 400% report zoom** and scrolled offsets: drag, eight-handle resize, proportional table resize, marquee, pan, nudge repeat, snapping/bypass, clipboard and arrangement. Verify ruler/page/body coordinate agreement and no DPR-dependent offset.
- During active gestures, trigger validation/feedback/selection updates and elective panel/breakpoint transitions. Measure <=1 screen-pixel unintended origin drift and <=0.01pt geometry error. Deliberate scroll/pan/edge auto-scroll/zoom are recorded separately.
- Resize the host during each gesture type: cancellation must occur before coordinate rebase and commit zero gesture edits. Verify deferred elective transitions apply after completion/cancellation.
- Restore the same view, then open an independent view. Verify preferences restore per view, invalid/old values fall back, oversized effective widths clamp and preferred wide widths survive temporary narrowing. Restore no pending operations/drafts/gestures as edits. Test corrupt-state fallbacks in the existing mocked adapter/component suite, not by editing report XML.

Record actual frame bounds, source before/after and workstation/scaling. jsdom coordinate assertions are supporting evidence, not proof of actual DOM layout.

## 6. Themes, keyboard and screen reader

Repeat priority journeys in the host's reference light, dark and high-contrast themes. Record theme IDs. Measure text contrast >=4.5:1 and essential control/selection/focus boundaries >=3:1 (large text >=3:1), including guides, rulers, placeholders, disabled/unavailable explanations and page/body outlines. Theme changes must not alter authored colors or XML.

Keyboard-only: toolbar/overflow, tabs, tree expansion/additive selection, creation, inspector/expression controls, page setup, separators, context menus (Shift+F10/platform key), diagnostic details and source access. Confirm visible focus, predictable arrows/Tab, no traps, Escape dismissal and invoking/surviving focus return. Long values remain fully accessible; normal field shortcuts stay native.

Using the reference screen reader, confirm announced selection count/primary, unavailable reasons, pending state, field errors and source-only explanation. Routine successful operations must not flood announcements. Record actual observations; DOM roles alone do not pass this section.

## 7. Preservation, offline and untrusted input

Run the inherited >=12-file fixture corpus through no-op/view-only/cancel/refusal equality and accepted-edit footprint checks. Preserve unknown namespaces/content and exact outside-footprint spelling. Reopening preserves all supported definitions. Existing malformed/version/budget restrictions remain.

After installation, disable network and complete all priority journeys. Open local/remote resource and unsafe-entity fixtures from `tests/fixtures/security/` and `tests/fixtures/xml/unsafe-dtd.rdlc`: observe zero report-triggered retrieval, expression/code execution, external entity resolution or data-source access. Do not activate external resources to test them.

Repeat the applicable workflows in a real restricted workspace and read-only files. Verify existing trust/read-only guards, isolation and actionable refusal; accepted unsaved work remains safe. The automated harness's trust override is not evidence for this run.

## 8. Measured usability and performance

- Recruit five representative authors unfamiliar with the redesign. At least four discover insertion/Structure/page setup/source within 30 seconds per task, complete the textbox journey within 3 minutes and rate clarity >=4/5 on a recorded scale. Creation inputs and visible tree selection take one activation; common properties at most one section expansion.
- Record the dataset/table/group/total journey within 5 minutes and validate saved source after reopen.
- Across 100 selection changes, require 100% identity/primary/eligibility agreement and >=95 updates <=100ms. Include overlapping items, cells, data, unknown bounds and multi-selection; selection creates zero edits.
- Across 100 representative manipulation samples, record origin drift, actual geometry and zero-edit host-resize cancellation as above.
- On a recorded desktop with <=1 MiB/100 selectable items, require >=95/100 feedback samples <=50ms and accepted-display samples <=200ms. Search/panel feedback must be <=100ms in >=95/100 samples. Time from input dispatch to visible feedback, and accepted host snapshot arrival to painted accepted state; record host roundtrip separately. Record both selection input-to-visible-sync and report-edit request-to-visible-acceptance as additional end-to-end timings.

Do not infer these results from synthetic timers, source review or old release evidence. Failed usability outcomes require refinement within the specified scope.

## Evidence and completion

Implementation acceptance should record candidate commit, commands/results, fixture IDs, viewport/theme/report zoom/interface scaling, platform/hardware, timing boundaries, before/after source comparisons, screenshots or measurements and human observations under `docs/validation/`. Reuse existing evidence conventions and identify unrun checks explicitly. SC-001–010 all require evidence; a design gate PASS is not a runtime acceptance PASS.

Existing GitHub Actions/release contracts remain in force: frozen lockfile, lint/types/tests/build for the exact candidate, SemVer tag/package agreement and identical canonical VSIX publication with overwrite protection. This guide performs validation, not a release.
