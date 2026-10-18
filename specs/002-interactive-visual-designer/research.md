# Research: Interactive Visual Designer

**Date**: 2026-10-18. Research used two bounded source investigations (atomic geometry/lifecycle and clipboard/reference safety), plus selected designer/dependency and MS-RDL reads. No broad repository/vendor ingestion or runtime test execution was used.

## 1. Architecture and dependencies

**Decision:** Extend the current TypeScript 6.0.3 workspace, Angular 22.2.3 Signals designer, VS Code custom text editor and six domain packages. Keep Node 24 and pnpm 11.28.2 tooling; add no dependency or backend.

**Rationale:** `package.json`, `apps/designer/package.json`, `apps/vscode-extension/package.json` and [baseline analysis](baseline-analysis.md) establish the existing architecture and public release. Native DOM pointer capture, scrolling, keyboard events and Angular state suffice for this interaction feature.

**Alternatives considered:** New canvas framework, replacement editor, generic state/command framework and separate saved model add dependencies and conflict with inherited source authority.

## 2. Atomic compound edits

**Decision:** Extend `EditIntent` with a bounded geometry operation. Plan all members against one original source, normalize patches and namespace dependencies, verify one candidate and submit one existing native apply.

**Rationale:** `apps/vscode-extension/src/{edit-controller,document-session,verify-candidate}.ts` already separate validation/planning, source verification and the per-document queue. `packages/xml-serializer/src/{structure,patches,textboxes}.ts` provide scalar patches and overlap/version/footprint guards. Multiple missing properties can insert at one offset, so normalization is required; `structure.patchPlan` currently does not carry scalar namespace dependencies automatically. Existing no-op handling needs an explicit unchanged result before spelling changes.

**Alternatives considered:** Repeated scalar requests break atomic Undo and mixed-member refusal; generic arbitrary batches expose excess surface; whole-item regeneration risks unknown content.

## 3. Geometry and table resize

**Decision:** Keep scene coordinates in existing unzoomed 96px/in CSS units; calculate interaction geometry in pt and share pure size conversion/formatting through `report-model`. Make geometry provenance explicit. Derive absent textbox dimensions; never turn unknown geometry into zero. Add selectable table frames alongside existing cells. Resize table rows/columns in one dedicated plan, preserving explicit units and absent outer dimensions.

**Rationale:** `packages/renderer/src/{geometry,render,tables}.ts` currently lacks inverse/unit-preserving conversion and uses missing/unparseable fallback sizes. `packages/xml-serializer/src/tables.ts` scalar row/column setters synchronize outer dimensions in inches and can materialize absent dimensions; looping those setters violates this feature's contract. Immutable gesture origins, adequate decimal precision and deterministic residual handling satisfy the numerical/fixed-edge obligations.

**Alternatives considered:** Convert the entire renderer to points (unnecessary churn), retain fallback zero bounds (incorrect), resize only the outer frame (inconsistent table), or clamp invalid geometry (changes required UX).

## 4. Identity, pending state and drafts

**Decision:** Keep ordered version-scoped selection and primary in each view. Return host-proven request/base/result-version identity mappings for own edits. Reconcile independent versions only with unambiguous kind/parent/identity evidence; otherwise clear and explain. Add an explicit preview/pending state machine and apply/discard/cancel draft guard.

**Rationale:** `editor.component.ts` currently uses one version/index; `host-adapter.ts` clears old state, drops result version and has no pending lock. `DocumentSession` may publish snapshots before results and repeat the same-version snapshot. `protocol.ts` validates exact keys, so validators and consumers must evolve together. Existing property components use immediate change events and need dirtiness tracking before focus/selection transitions.

**Alternatives considered:** Persist ordinals or names as universal IDs (unsafe); optimistic XML/dirty state or a designer undo stack (conflicts with native lifecycle); automatic stale retries (may target different content).

## 5. Viewport, snapping and accessibility

**Decision:** Use a scrollable transformed authoring surface, pointer capture and pure geometry helpers. Store validated disposable preferences with the webview state API through `HostAdapter`. Implement deterministic grid/guide algorithms and explicit keyboard/list equivalents as specified in [interaction contract](contracts/interaction.md).

**Rationale:** Existing Angular item buttons, property forms, diagnostics and authoring controls are reusable. CSS pixel thresholds keep click/guide behavior stable across zoom; view-local state preserves offline isolation and no report mutations. Unknown geometry still needs list/source access.

**Alternatives considered:** Serialize preferences into RDLC, use device pixels for report-space input, intercept global shortcuts or add touch/multi-item scaling: outside scope or incorrect.

## 6. Clipboard ownership and budgets

**Decision:** Use one host-retained immutable capture and a small versioned same-window native clipboard token; Duplicate uses the same planner transiently. New limits are 1 KiB token and 8 MiB retained capture payload. Reuse existing parser/protocol limits and native clipboard APIs; serialize capture replacement across views.

**Rationale:** `XmlNode` in `packages/report-model/src/syntax.ts` retains exact ranges and in-scope namespaces. Existing clipboard support is absent. Captured XML need not traverse the 64 KiB webview message boundary. One capture suffices for ordinary current-clipboard semantics; unavailable old/reloaded tokens explain that the author must copy again. The complete destination still obeys the 16 MiB / 100,000-element / depth-256 parser budgets.

**Alternatives considered:** Put arbitrary XML in webview messages/clipboard (larger trust surface); disk persistence, multi-capture caches and cross-window transfer (unrequested scope); recreate items from projections (lossy).

## 7. Names, reference mapping and dependencies

**Decision:** Build typed item/group/scope declarations and narrow exact-operand reference mapping. Preserve understood internal/external semantics and conservatively refuse opaque dependencies. Compare required dataset field definitions/types and scope context, not names alone. Extend destructive guards to exclude the complete cut set.

**Rationale:** `packages/expressions/src/analyze.ts` recognizes static report-item references and bounded `Sum` scopes but has no rewriting API; decoded ranges cannot be used as raw XML offsets. Nongroup aggregate scopes are not necessarily datasets. `packages/validation/src/datasets.ts` guards one removed subtree and must account for set removal. `reportItemNames` scans untyped `Name` attributes, while `uniqueName` has a narrower prefix grammar than `validateName`; typed allocation avoids false identity assumptions and Unicode traps. `project-datasets.ts` supplies field definitions and types for compatibility.

**Alternatives considered:** Regex/global-name replacement, assume unknown extensions inert, accept same-name datasets or call single-target deletion guards separately: unsafe or unnecessarily blocks references wholly inside a removed selection.

## 8. Verification and delivery

**Decision:** Extend existing package, Angular/Vitest, roundtrip, compatibility and VS Code integration suites. Record installed timed/accessibility/offline evidence and new performance samples separately from baseline release evidence. Keep existing GitHub Actions/release pipeline and MIT licensing.

**Rationale:** `tests/performance/editor.test.ts` validates older acceptance measurement boundaries, not this feature's 50ms preview/200ms accepted-paint targets. Existing synchronization/persistence tests cover native races and failures and should be extended, not replaced. A published 0.1.0 does not establish new interaction acceptance or external runtime fidelity.

**Alternatives considered:** Screenshot-only tests, parser-only performance or inferred native Undo behavior cannot prove atomic preservation and user-visible timing.

## Targeted format references

Use local MS-RDL v20251031, read-only. The [baseline evidence table](baseline-analysis.md#targeted-ms-rdl-evidence) supplies exact paths and supported-profile restrictions:

- §2.2.7, `vendor/02-structures/2.2.7-rdlsize.md`: supported size units.
- §2.16.10/.11/.14/.16: textbox container-relative positions and derived missing dimensions.
- §2.16.17 and §2.23.42: drawing priority; deterministic missing-table-priority/source-order ties are product rules.
- §2.23.16/.19/.38/.41: table positions and explicit/derived outer geometry. Header-bearing unsupported profiles remain excluded.
- §2.16.1: report-item naming; §1.7: extensible fields and stronger project preservation guarantees.
- §2.341.6, `vendor/02-structures/2.341.6-global-collections.md`, and §2.341.7, `vendor/02-structures/2.341.7-aggregate-functions.md`: report-item references and dataset/data-region/group scope distinctions, inspected in the clipboard investigation.

The inherited global tablix-cell-count extraction ambiguity remains outside this feature; no new conformance claim depends on it. External RDLC runtime execution is not asserted.

## Resolution

All technical-context decisions required for Phase 1 are resolved above. No unresolved clarification or constitutional exception remains. Numeric clipboard limits and token retention are explicit implementation decisions; required interaction semantics remain those in the specification.
