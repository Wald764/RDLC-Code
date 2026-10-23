# Designer UX/UI Overhaul — Validation

Scope: all phases (T001–T059). Automated and rendered-designer evidence is recorded below; human, screen-reader and installed-offline observations remain unrun and keep feature acceptance open.

## Candidate and baseline

- Base commit: `59d3b657e2e6d853a59581a0cc302c132a607cff` plus local MVP changes.
- Platform: Windows NT 10.0.26300.0; Node 24.22.0; pnpm 11.28.2 via Corepack.
- `corepack pnpm install --frozen-lockfile`: PASS, nine projects, no lockfile change.
- Baseline compiled Node unit checks: PASS, 97 tests. The combined command initially stopped because nested `pnpm` was absent from PATH; a Corepack shim in the approved temporary directory resolves this environment issue.
- Baseline `pnpm --filter @rdlc/designer test`: PASS, 115 tests. Existing NG0956 tracking warnings are present.
- Existing Node/Angular ignore files cover generated output, dependencies, environment files and editor caches. No Docker/Terraform/Helm setup exists; the root and designer packages are private.

## Evidence matrix

Fixture IDs refer to `tests/fixtures/manifest.json`. Inherited evidence is indexed in [interactive-designer.md](interactive-designer.md); it is not a measurement of this candidate.

| Criterion / journey                  | Fixture / evidence                                                           | Current candidate observation                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001 discovery                     | local-blank; catalog tests                                                   | Five-author discovery timings unrun                                                                                                           |
| SC-002 textbox ≤3 minutes            | local-blank, textbox-supported; native lifecycle and component suites        | Automated creation/format/save/tab-reopen PASS; human timed journey unrun                                                                     |
| SC-003 table ≤5 minutes              | grouped-table-scoped-totals, local-seven-types                               | Automated contextual creation/binding/group/total intents PASS; human timed journey unrun                                                     |
| SC-004 synchronized selection        | interactive-mixed; selection/component suites                                | Rendered run: 100/100 identity/primary/eligibility agreement; 100/100 input-to-paint ≤100ms (p95 36.1ms); zero edits                          |
| SC-005 feedback and acceptance       | interactive-mixed                                                            | Rendered run: feedback 100/100 ≤50ms (p95 11.3ms); accepted snapshot-to-paint 100/100 ≤200ms (p95 33.2ms); host roundtrip recorded separately |
| SC-006 stable coordinates            | interactive-mixed; viewport/manipulation suites                              | Rendered run: 100 drag/resize samples, 0px origin drift, 0pt geometry error; rulers ≤0.011px; zero-edit host-resize cancellation              |
| SC-007 accessibility                 | local-blank, malformed, textbox-supported-opaque                             | Rendered keyboard-only journey and measured contrast (transcribed default themes) PASS; screen reader and real VS Code themes unrun           |
| SC-008 responsive workspace          | local-blank, interactive-mixed                                               | Rendered 1280×800 / 1024×768 / 640×480 / 400×600 at 1× and 2× PASS (two defects fixed); VS Code editor-group sizing unrun                     |
| SC-009 search/panel response         | canonical catalog; component tests                                           | Rendered run: search 100/100 ≤100ms (p95 8.7ms); panel toggle 100/100 ≤100ms (p95 41.9ms)                                                     |
| SC-010 preservation/native lifecycle | lexical-extensions, grouped-table-scoped-totals; native and roundtrip suites | 17-fixture corpus equality, native suites and installed-VSIX suites PASS; installed offline/restricted journey unrun                          |

For every unrun desktop observation: viewport, theme, report zoom, display scaling, hardware and screen-reader identity are **unrecorded**, not assumed. Required zooms: 25/50/100/200/400%; scaling includes 200%. Timing boundaries distinguish input-to-paint, accepted-snapshot-to-paint, host roundtrip and request-to-visible-acceptance.

## Implementation checks

Candidate verification date: 2026-10-18. All results below apply to the local MVP changes over the base commit above; no release commit or installed VSIX is identified by these results.

| Check                                                                                                                                                               | Result                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Compiled Node unit checks: `node --test packages/*/dist/*.test.js dist/apps/vscode-extension/src/*.test.js dist/scripts/*.test.js`                                  | PASS, 102 tests                                                                                     |
| Angular: `pnpm --filter @rdlc/designer test`                                                                                                                        | PASS, 167 tests across 14 files; inherited NG0956 warnings remain                                   |
| Targeted structure/protocol: `node --test packages/renderer/dist/structure.test.js dist/apps/vscode-extension/src/protocol.test.js`                                 | PASS, 17 tests, including deep preservation truncation                                              |
| Roundtrip, compatibility and synthetic acceptance: `node --test dist/tests/roundtrip/*.test.js dist/tests/compatibility/*.test.js dist/tests/performance/*.test.js` | PASS, 72 tests: 58 roundtrip, 13 compatibility, 1 synthetic acceptance; not measured UX performance |
| `pnpm format:check`                                                                                                                                                 | PASS                                                                                                |
| `pnpm lint`                                                                                                                                                         | PASS                                                                                                |
| `pnpm typecheck`                                                                                                                                                    | PASS, host/shared TypeScript and Angular                                                            |
| `pnpm build`                                                                                                                                                        | PASS; production designer entry `main-J2B5ORHC.js`                                                  |
| `VSCODE_VERSION=1.142.0 pnpm test:vscode` (PowerShell environment assignment)                                                                                       | PASS, all 7 native suites on VS Code 1.142.0                                                        |

The Corepack shim directory is prepended to PATH for pnpm commands. Compiled-output checks consume the build output without running the cleaning compiler concurrently. `scripts/compile.ts` clears `dist/tests`, so `pnpm build` must regenerate the native bundles before `test:vscode`; after that rebuild the seven native suites were rerun on this candidate and passed. After strengthening the tab-reopen test, the candidate was rebuilt and the native suites rerun successfully.

### US1 journey and interaction evidence

- `tests/vscode/lifecycle.test.ts`, `mvpTextboxJourney()`: starts from a disposable `local-blank` copy, creates exactly one textbox named `Title`, and accepts text, left/top, width/height, font family/size and raw color changes through `DocumentSession`. A negative width leaves the entire accepted source unchanged. Native Save writes the exact accepted source; the actual text-editor tab is closed and reopened, and reopened text equals saved text. This is host/native persistence evidence, not a rendered-webview click-through or human timing. New Report entry-point behavior is covered separately by `new-report.test.cjs`.
- `tests/vscode/synchronization.test.ts`: a test-only contributed custom editor creates real panels for A in split views. After B is focused, native history requests target the originating A panel. Twenty mixed textbox, geometry, table and dataset edits undo and redo individually to exact captured source states; both A views refresh and B remains exact. Empty and source-only history, pending/stale requests and inactive targets are also exercised. `guardedHistoryTargets()` covers unverifiable targets, independent version changes during activation and disposal. The test-only contribution is confined to the harness.
- `components-catalog.component.spec.ts`: eleven unique cards, category-preserving mixed-case search, no-results recovery, unavailable explanations and exactly one Textbox creation event from one card activation. `authoring.component.spec.ts` covers required names, cancellation, pending deduplication and real Table prerequisites.
- `editor.component.spec.ts`: accepted-only selection and creation closure with both result/snapshot orderings, refused creation without retry, draft Apply/Discard/Cancel, guarded Code XML and local-input history isolation. Existing selection and authoring guards remain the shared transition owner. Controls stay mounted across unrelated layout updates and insertion no longer forces authoring focus.
- Common textbox General, Position and size, Appearance and Typography controls are in relevant native sections, open by default, so access requires no section expansion. Component checks exercise selection/prefill, raw expressions and eight-digit color preservation, expansion/unit-change no-ops, field-associated refusals and visible accepted values. One-activation catalog dispatch is automated evidence; visual reachability and user-observed common-property access remain unrun.
- Pure viewport/gesture and component regressions cover the five zoom levels, page/body origins, center rebasing with clamping, pointer-down below threshold and resize cancellation of drag/resize/marquee/pan/key-repeat without gesture commits. These checks do not measure real DOM geometry.

### US2/US3/US5 journey and interaction evidence

- `selection.spec.ts`: exclusive structure/data, body and cell targets; scene-ID joins; body/primary membership; additive cell resolution through a parent cell; accepted mappings by unique name/kind/parent ancestry and dataset+field identities only, clearing ambiguous, deleted and unnamed targets without trusting IDs or ordinals across versions.
- `structure-tree.component.spec.ts`: one roving tab stop; Arrow Down/Up, Home/End, Right to expand then descend, Left to collapse then ascend; Enter/Space with additive modifiers; typing untouched; Supported-editing, Preservation-only, opaque-reason, incomplete-coverage and omitted-selection guidance; source access; unrelated expansion retained on a same-version update; focus mapped to the surviving named ancestry and falling back to the surviving parent across versions. `editor.component.spec.ts` adds tree/canvas/data synchronization, reveal at unchanged zoom, table-frame/cell distinctions and the Shift+F10 context menu with Escape and invoker focus return, and sends no host requests for view-only actions.
- `datasets.component.spec.ts`, `table-properties.component.spec.ts` and `groups-totals.component.spec.ts`: forms scope to the selected dataset, field, table or cell only; all seven field types remain; destructive confirmations retained; totals emit a scoped intent only on explicit submission; no initialization edits and no unrelated forms.
- `tests/roundtrip/authoring.test.ts` and `tests/compatibility/datasets.test.ts`: contextual dataset/table/group/total intents keep parser/serializer semantics, exact no-op/cancel/refusal text, saved/reopened definitions and preserved unknown content.
- `diagnostics.component.spec.ts` and `editor.component.spec.ts`: severity/target/reason instructions with a source-only corrective action; loading, no-report, editable, invalid-source, source-only and preservation-only presentations; truthful disabled Preview; live-region selection/status/pending/refusal announcements; labeled 24×24px targets, theme tokens and forced-colors rules. DOM roles and mocked focus checks are component evidence only and cannot satisfy SC-007.
- Focus retention change: when a focused control is destroyed by reconciliation (for example a version change cancelling a draft), focus now moves to the labeled canvas control instead of body. The updated `lifecycle.spec.ts` assertion records this FR-033 behavior.

### US4 panel and preference evidence

- `viewport.spec.ts`: `ViewState` gains preferred `leftWidth`/`rightWidth` (220/300, bounded 180–360/240–480), `leftVisible`/`rightVisible`, `leftTab` (`components | structure`) and a closed nine-section `inspectorExpanded` map. Each field defaults independently; unknown keys, obsolete fields and transient values (selection, drafts) are dropped. `panelLayout` derives effective widths: left overlays below 1100px, both below 800px, inline panels shrink toward their minimums to keep a 320px canvas, and preferences are never rewritten.
- `lifecycle.spec.ts`: toolbar Components/Properties controls hide/restore inline panels in the wide layout and toggle one overlay at a time in compact layouts; Escape restores invoker focus. Separators expose `role=separator`, orientation, current/min/max values, 10px arrow steps and Home/End. State persists only through the webview state API; independent webviews keep separate state; oversized preferences survive temporary clamping. Per-tab left-panel scroll is view-local. Elective panel changes defer during a key-repeat nudge and apply after keyup; host resize still cancels the gesture. Mounted drafts survive panel toggles; inspector section collapse persists. No host message other than `ready` is sent.
- Designer suite: PASS, 178 tests across 14 files (inherited NG0956 warnings); `pnpm lint`, root and designer typecheck, designer production build: PASS. Changed files pass Prettier; the remaining `format:check` warnings come from CRLF working-copy line endings (`core.autocrlf=true`, LF in the index), not content changes.
- T052 (four viewport sizes at 200% interface scaling, pointer resizing in a rendered webview, measured frame/center/focus results and native save) is **unrun**: jsdom has no layout, so these are component checks only.

### Visual alignment with the UI reference

- Presentation restyled toward `docs/design/rdlc-code-ui-reference.png` using VS Code theme tokens only: icon toolbar groups (history, clipboard, align, distribute, zoom, grid/snap toggles, named paper size), Components card grid, Structure tree with kind icons, two-column property grid with collapsible sections, status bar with Design / Preview (unavailable) / Code XML, diagnostics indicator and zoom slider. Icons are original 16-unit stroke drawings (`icon.component.ts`).
- Components and Structure sit side by side when the workspace keeps a 640px canvas (from 1400px), tabs otherwise; the Structure tree opens its first four levels on load. Canvas items show their authored text and text style; accessible names keep the full item label.
- Deliberately not reproduced: image/line/chart/nested-rectangle rendering, Styles tab, unsupported properties (visibility, border, padding, background, image source), grouping and z-order, populated preview, file buttons (native VS Code commands).
- Checked with rendered screenshots of a real fixture snapshot (`tests/fixtures/tables/grouped.rdlc`) in headless Edge over DevTools at 1700, 1416 and 1024px, light and dark token sets. This is a visual spot check, not the T052/T056 measurement matrix.

### Resolved verification failures

- Native history panels were initially absent because the test view type had no contribution. A test-only custom-editor contribution and dual development-extension loading now exercise actual panels.
- The raw font-weight expression initially displayed a default option. Explicit option selection preserves the accepted raw expression; the regression passes.
- A strengthened reopen check initially assumed `TextDocument.isClosed` immediately follows closing an editor. VS Code retained the document model. The test now closes the exact URI's text tabs, asserts their absence, reopens a tab and checks the reopened text against the separately verified on-disk source.

## Phase 8 and remaining-story evidence (2026-10-19)

Candidate: commit `e5d683dce394bc3726e605f4a1de7e2cdd806075` plus the uncommitted working tree of this run (all results below apply to that same tree). Workstation: Windows NT 10.0.26300, 11th Gen Intel Core i5-11600K × 12, 31.9 GiB RAM, Node 24.22.0, Microsoft Edge 155.0.4283.62 headless, VS Code 1.142.0 for native suites.

### Rendered-designer harness

`tests/browser/designer-ux.mjs` (run after `pnpm build` with `CHROME_PATH` set; `ONLY=<section,...>` selects sections) loads the production designer bundle in headless Edge over DevTools and connects it to the real `DocumentSession` (parse, plan, verify, publish, history routing) through a minimal in-memory `vscode` stub. It measures the real DOM and real host results. It is **not** a VS Code webview, so workbench chrome, editor-group sizing, real themes and OS interface scaling are not exercised. 200% scaling is emulated with `deviceScaleFactor: 2` at the same CSS viewport. Final run: **PASS, 68/68 checks**.

| Section                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout (T052/T056, SC-008), `local-blank`       | 1280×800: canvas 57.8% width / 89% height. Every viewport at 1× and 2×: canvas ≥320px (380px at 400×600), single-row toolbar and status, no page scroll, every toolbar command visible or brought into view by focus, overlay thresholds (left <1100, both <800), overlays open without canvas reflow, one at a time, Escape returns focus; insertion, tree selection, numeric width change and save/reopen accepted at every size.                                                                                                                      |
| Panels (T052), `interactive-mixed`              | Left separator 220 default, 10px steps, 180–360 bounds, pointer resize; right 300 / 240–480. Hide/restore centre drift 0px at unchanged 200% zoom. A 260px preference and the Structure tab survive a 1024px clamp and reload of the same view; a new view keeps defaults. Zero edits, source exact.                                                                                                                                                                                                                                                     |
| Coordinates (T056, SC-006), `textbox-supported` | 5 zooms × 2 scales × 2 scroll offsets: ruler ticks within 0.011px and body origin 0px of the DOM. 100 accepted drag/SE-resize samples (Alt-bypassed snapping) with feedback injected mid-gesture: origin drift 0px, preview anchor error 0px, request geometry error 0pt, one accepted edit each. Host resize during drag, resize, marquee and pan: gesture visibly active, then cancelled with zero edits and no leftover preview.                                                                                                                      |
| Journey (T030), `interactive-mixed`             | Obscured `Behind` selected via Structure with canvas/status/tree agreement; offscreen `LaterTie` revealed at unchanged 400%; `UnknownWidth` has no guessed frame and offers source access; table frame, exclusive cell (no handles) and rectangle-free dataset targets are distinct; selection, reveal and zoom left the source exact with zero edits. Three-member additive selection with primary agreement; align left, distribute vertical and duplicate settled through the host; one toolbar Undo per accepted change restored the exact original. |
| Timing (T058)                                   | 1 MiB / 100-textbox reference report (`tests/performance/reference-report.ts`); see the next table.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Keyboard (T045 partial), `local-blank`          | 80 Tab stops reach toolbar, Components/Structure, separators, canvas, Properties and status, all with visible focus (leaving the document at the end is not a trap). Keyboard-only creation from a catalog card, tree End/Enter selection, Shift+F10 menu with Escape return to the canvas; arrows inside a property field are not intercepted.                                                                                                                                                                                                          |
| Contrast (T045 partial)                         | Default-theme tokens transcribed into the page (Light Modern, Dark Modern, Dark High Contrast; values are approximations, not read from VS Code): 116 text elements, zero active text below 4.5:1. Selection 6.31:1; focus outline 5.94 / 3.92 / 8.18:1; page outline 3.96 / 3.04 / 9.22:1; body outline 3.43:1. Forced colors keep a visible selection boundary.                                                                                                                                                                                        |
| Honesty                                         | Malformed and unsupported-profile reports explain the limitation, offer Code XML and never stay loading. Read-only creation and history refuse with actionable text, source exact, no native command run. Preview is disabled with its populated-rendering explanation.                                                                                                                                                                                                                                                                                  |

Timing boundaries run from the input event `timeStamp` (or the snapshot `message` event) to the end of the first rendered frame showing the expected state. Host roundtrip is request post to result arrival in the page and includes the DevTools bridge.

| Measure (100 samples each)                                     | Within limit | p50 ms | p95 ms | max ms |
| -------------------------------------------------------------- | ------------ | ------ | ------ | ------ |
| Selection input-to-paint (canvas, tree, additive), limit 100ms | 100          | 15.8   | 36.1   | 49.9   |
| Drag feedback input-to-paint, limit 50ms                       | 100          | 7.8    | 11.3   | 16.1   |
| Accepted snapshot-to-paint, limit 200ms                        | 100          | 27.0   | 33.2   | 41.6   |
| Search input-to-paint, limit 100ms                             | 100          | 5.4    | 8.7    | 52.6   |
| Panel toggle input-to-paint, limit 100ms                       | 100          | 16.4   | 41.9   | 54.9   |
| Nudge keyup to visible acceptance (recorded)                   | —            | 1020   | 1289   | 1677   |
| Host roundtrip (recorded)                                      | —            | 1488   | 1876   | 2051   |

The end-to-end and roundtrip figures varied between runs on this workstation (an earlier same-day run: p50 258ms / 366ms). They cover parse, plan, verification and two snapshot publications of the 1 MiB report plus the bridge. No SC limit applies, but this is the slowest path observed and worth profiling in the real host.

### Defects found and fixed by the rendered runs

- Compact overlays (<1100px) opened at 1px width: an absolutely positioned grid child used its 0px grid column as its containing block. Overlay panels now use `grid-area: auto`. jsdom could not detect this.
- Toolbar commands partly scrolled out of the toolbar stayed clipped when reached with Tab. The toolbar now scrolls the focused command into view.
- The Light Modern page edge (≈1.1:1 against the canvas) and dashed body outline (≈1.6:1 against the page) were below 3:1. The page ring now uses `contrastBorder` or `#767676`, the body outline `#005fb8b3`.

### Regression and gate additions

- `tests/compatibility/manifest.test.ts`: all 17 manifest fixtures project bounded, cycle-free structure with valid ranges and leave the source exact; 54 textbox no-op renames across the 13 editable fixtures are byte-exact and 51 invalid widths refuse.
- `tests/performance/editor.test.ts`: the reference report fits the 2,000-node hierarchy and snapshot transport budgets without truncation.
- `tests/vscode/synchronization.test.ts`: on a read-only volume, contextual creation refuses with `DOCUMENT_READ_ONLY` and native history refuses without executing. History sent while another operation is queued is refused as busy, so the test waits for the creation result first.

| Gate (same tree)                                                 | Result                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck`                                    | PASS                                                                                                                                             |
| `pnpm format:check`                                              | Changed files clean; warnings remain on 13 untouched files checked out with CRLF and on the pre-existing `docs/validation/drag-drop-creation.md` |
| `pnpm test:unit`                                                 | PASS: 104 Node tests, 195 designer tests (14 files)                                                                                              |
| `pnpm test:roundtrip` / `test:compatibility` / `test:acceptance` | PASS: 61 / 15 / 2                                                                                                                                |
| `pnpm build`                                                     | PASS                                                                                                                                             |
| `VSCODE_VERSION=1.142.0 pnpm test:vscode`                        | PASS, 7 native suites                                                                                                                            |
| `pnpm package`, `pnpm test:package`                              | PASS: `dist/rdlc-code-0.1.0.vsix` (11 files), 5 package tests including the offline CSP check, 7 installed-extension suites                      |
| `node tests/browser/designer-ux.mjs`                             | PASS, 68/68                                                                                                                                      |

No dependency, lockfile, vendor, serializer or release-workflow change; nothing was published.

### Still unrun

- T037: the rendered dataset/table/cell/group/total click-through and its ≤5-minute human timing. Intents, roundtrip and native coverage pass.
- T045: screen-reader observations and measurements inside real VS Code themes with recorded theme IDs.
- T055: the installed editor with networking disabled and a real restricted workspace. The packaged CSP test and the stubbed read-only/untrusted refusals are not that evidence.
- T057: the five-author study; SC-001–003 remain unrun.

## Scope and acceptance status

T001–T036, T038–T044, T046–T054, T056, T058 and T059 are complete. T037, T045, T055 and T057 stay open because they require real-desktop, assistive-technology, offline or human observations that were not run. Full feature/release acceptance is **open**.

`.specify/extensions.yml` has `hooks: {}`; no pre/post implementation hooks are registered. Reviewer checklists remain unchanged.
