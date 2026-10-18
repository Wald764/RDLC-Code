# Designer UX/UI Overhaul — MVP Validation

Scope: phases 1–6 (T001–T045), including US1, US2, US3 and US5. Later stories and release acceptance remain open.

## Candidate and baseline

- Base commit: `59d3b657e2e6d853a59581a0cc302c132a607cff` plus local MVP changes.
- Platform: Windows NT 10.0.26300.0; Node 24.22.0; pnpm 11.28.2 via Corepack.
- `corepack pnpm install --frozen-lockfile`: PASS, nine projects, no lockfile change.
- Baseline compiled Node unit checks: PASS, 97 tests. The combined command initially stopped because nested `pnpm` was absent from PATH; a Corepack shim in the approved temporary directory resolves this environment issue.
- Baseline `pnpm --filter @rdlc/designer test`: PASS, 115 tests. Existing NG0956 tracking warnings are present.
- Existing Node/Angular ignore files cover generated output, dependencies, environment files and editor caches. No Docker/Terraform/Helm setup exists; the root and designer packages are private.

## Evidence matrix

Fixture IDs refer to `tests/fixtures/manifest.json`. Inherited evidence is indexed in [interactive-designer.md](interactive-designer.md); it is not a measurement of this candidate.

| Criterion / journey                  | Fixture / evidence                                                           | Current candidate observation                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SC-001 discovery                     | local-blank; catalog tests                                                   | Five-author discovery timings unrun                                                                                               |
| SC-002 textbox ≤3 minutes            | local-blank, textbox-supported; native lifecycle and component suites        | Automated creation/format/save/tab-reopen PASS; human timed journey unrun                                                         |
| SC-003 table ≤5 minutes              | grouped-table-scoped-totals, local-seven-types                               | Automated contextual creation/binding/group/total intents PASS; human timed journey unrun                                         |
| SC-004 synchronized selection        | interactive-mixed; selection/component suites                                | Automated tree/body/data/cell reconciliation PASS; 100 input-to-painted-selection samples unrun                                   |
| SC-005 feedback and acceptance       | interactive-mixed                                                            | Automated status/diagnostics/refusal announcements PASS; 100 input-to-feedback / snapshot-to-paint / host-roundtrip samples unrun |
| SC-006 stable coordinates            | interactive-mixed; viewport/manipulation suites                              | Automated zoom-accurate manipulation/resize PASS; real DOM drift/geometry matrix unrun                                            |
| SC-007 accessibility                 | local-blank, malformed, textbox-supported-opaque                             | Automated roles/labels/keyboard focus PASS; screen reader and measured contrast unrun                                             |
| SC-008 responsive workspace          | local-blank, interactive-mixed                                               | Real 1280×800 / 1024×768 / 640×480 / 400×600 measurements unrun                                                                   |
| SC-009 search/panel response         | canonical catalog; component tests                                           | 100 input-to-paint samples unrun                                                                                                  |
| SC-010 preservation/native lifecycle | lexical-extensions, grouped-table-scoped-totals; native and roundtrip suites | Candidate automated results recorded below; installed/manual acceptance unrun                                                     |

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

### Resolved verification failures

- Native history panels were initially absent because the test view type had no contribution. A test-only custom-editor contribution and dual development-extension loading now exercise actual panels.
- The raw font-weight expression initially displayed a default option. Explicit option selection preserves the accepted raw expression; the regression passes.
- A strengthened reopen check initially assumed `TextDocument.isClosed` immediately follows closing an editor. VS Code retained the document model. The test now closes the exact URI's text tabs, asserts their absence, reopens a tab and checks the reopened text against the separately verified on-disk source.

## Scope and acceptance status

T001–T044 implementation and automated verification are complete. The T030, T037 and T045 real-desktop observations are **unrun** (obscured/offscreen journey, real dataset/table save/reopen timing within five minutes, keyboard-only completion in real light/dark/high-contrast themes, measured contrast and screen-reader review): automated results above, DOM roles and mocked focus checks replace none of them. Phases 7 onward remain open in the task list.

Full feature/release acceptance is **open**. Real desktop layout/scaling/drift measurements, rendered-webview end-to-end interaction, keyboard/theme/contrast/screen-reader observations, participant discovery/clarity/task timings and 100-sample paint/latency measurements are unrun. Installed-VSIX packaging/tests, offline and restricted-workspace observations are also unrun for this candidate. Native test-profile trust overrides and unrelated VS Code background network logs are not evidence of offline or restricted-workspace behavior.

No dependency or lockfile change, vendored-reference edit, report serialization change, commit, push or publication is part of this delivery. `.specify/extensions.yml` has `hooks: {}`; no pre/post implementation hooks are registered. Reviewer checklists remain unchanged.
