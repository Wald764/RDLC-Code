# Sidebar / Designer Bridge Contract

**Status**: Proposed extension of the closed protocol in `packages/report-model/src/protocol.ts`; existing protocol versioning and strict validators must be updated together.

## Authority and binding

One window-scoped registry owns context routing, not report content. Accepted `TextDocument` text/version remains authoritative. Existing panel-local `DocumentSession`s retain view state and share their existing per-document mutation queue. Source-only projections reuse extracted host evaluation; they do not require creating a hidden designer or editable report copy.

Capture each action as `{requestId, documentLifetimeId, uri, baseVersion, viewId, contextGeneration, targetIds, capability}`. Host-owned opaque IDs distinguish document lifetimes and panel instances, including reopened URIs. A request is bound to its receiving session; URI/view values supplied over the wire cannot route to another session. Opening a designer is an explicit preliminary action for that captured document only: bind the newly registered view once, check original document/version/context again, then dispatch. Never replace a captured existing view with another after disposal.

Resolve active context using custom-panel view-state events, verified tab type/viewType/URI, active text editor and close/document lifecycle events. Sidebar focus retains the current context. Explicit non-report activation clears it. Source focus uses the last surviving associated designer of the same document, or no associated view. Save As follows the host's actual document transition, invalidates obsolete captures and never guesses identity from a filename.

### Source-editor actions without an open designer

Source-editor focus is not the same as source-only compatibility: an editable report may have no open designer. Opening/refreshing native views, inspecting inert metadata and Code XML access remain host-side operations and must not open a designer. Visual navigation, properties and supported authoring actions requiring the existing Angular handlers explicitly open the captured report's designer through the existing public custom-editor path when no same-document designer survives; unsupported/source-only mutations are refused before opening.

The preliminary capture has no view ID until binding. Register the opened panel, await its readiness and accepted snapshot with a bounded wait, then bind that panel once before dispatch. The expected activation/association caused by this opening may complete the binding only while the original document lifetime, URI, base version and report context still match; it must not authorize an unrelated context-generation change. Recheck target/capability and bound view after each await. Opening itself changes no report text/history. Failure, timeout, document change/close/Save As, intervening report/non-report activation or panel disposal terminates the request with an accessible reason and no mutation, retry or replacement binding. Existing same-document designers are reused with their view-local selection, viewport and draft guards; another report's view is never borrowed.

Automated host and real Desktop cases must start with only A's source editor open and no designer for A: prove host-only inspection/source actions open none; explicit navigation/properties and each supported creation open/bind A once and use existing 001–004 behavior; and inject edits, closure, context switches, readiness failure/timeout and disposal during opening to prove refusal, zero wrong-target/duplicate edits and zero opening-only history entries. Also cover same-document designer reuse and source-only compatibility refusal.

## Closed message families

Exact TypeScript names may follow surrounding conventions; the fields and semantics below are mandatory. All message variants reject unexpected fields and unsafe values.

| Direction / family | Required payload | Semantics |
| --- | --- | --- |
| Host → designer: native action | Request ID, base version, bound view identity; finite action discriminator and typed target/action fields | Select, create Textbox/Table/Dataset, properties, source, or supported contextual clipboard/delete/data/table/group operation; no arbitrary command string or XML patch |
| Designer → host: accepted selection | Accepted version, monotonic per-view sequence, exclusive selection, optional originating native request ID | Publishes accepted state only, including changes made on canvas; never asks host to send another selection |
| Designer → host: action outcome | Native request ID, captured base version, result version, accepted/cancelled/refused status, bounded reason and selection sequence | Settles the original action; refusal/cancel retain the last accepted selection |

Selection is the existing ordered body-ID set plus primary member, **or** one cell ID, **or** one structural/data ID, **or** empty. Primary must belong to a unique body set. Verify version-local target membership, selection eligibility and current capabilities against the host projection. Structural/data nodes may be inspectable without having scene bounds. Do not promote presentation categories to authored targets.

The contextual discriminator enumerates only operations already implemented by existing selection/inspector/clipboard handlers. Data edits open existing contextual forms or use their typed guarded intents; no native form engine or free-form handler lookup is added. Keep view-local pending state, draft guards, keyboard behavior and authoritative host mutation validation.

## Request lifecycle

1. Capture immutable context at user activation; reject no-report, stale, incompatible or unavailable requests immediately.
2. Revalidate after every await, panel open/readiness, draft settlement and transport delivery. Check document lifetime/URI/version, context generation, live associated view and target capability—not just object name or version.
3. Designer verifies its accepted snapshot and existing pending/draft state. Mark tree selection pending; do not claim it accepted before acknowledgement.
4. Cancel settles without changing accepted selection or draft. Discard may continue only if the original capture is still valid. Apply submits only the draft, terminates the original action and never retries it on the new version.
5. Selection-only actions publish accepted selection and outcome without document history. Creation/mutation delegates to existing typed intent → shared queue → candidate verification → bounded atomic edit → snapshot/edit-result path. Carry native request correlation through the generated edit request.
6. Match both result-before-snapshot and snapshot-before-result orders. A mutation result may legitimately identify a newer accepted result version than its captured base; only that correlated transition authorizes post-creation selection. Unrelated intervening changes invalidate the action. Never replay a mutation because an outcome was delayed.
7. Dedupe outcomes and ignore older selection sequences/versions. Refresh/ancestor reveal carries no new user intent. Restore accepted native cues on refusal/cancel. A false/rejected `postMessage`, closed panel or exhausted bounded wait settles with a reason and clears pending state.

Keep bridge/draft waiting outside the document mutation queue: a queue entry waiting for a draft edit queued behind itself would deadlock. Mutation authorization is checked again inside the existing pipeline. Maintain bounded request tracking and the existing 1,024-request session limit; budget exhaustion refuses explicitly rather than silently raising it.

## Source and protocol boundaries

Source actions accept a target ID, never a client range. Resolve the exact current syntax range on the host, verify the document/version before and after opening the source editor, then reveal it. The existing `DocumentSession.openSource` asynchronous gap must be closed at its shared owner, with affected source-command callers covered by regression tests.

Retain inherited budgets: snapshots ≤8 MiB / 131,072 JSON nodes, other messages ≤64 KiB / 8,192 nodes, JSON depth ≤20; navigation ≤2,000 authored entries total across both native projections, with ≤32 emitted hierarchy levels per projection. Validators, builders, host publication, Angular ingestion and test fixtures change together. Reject malformed IDs, mixed modes, oversized payloads, duplicate IDs, invalid sequences and unmatched request/version outcomes. Keep navigation payloads flat enough to fit JSON depth; no secrets or embedded payloads cross this bridge.

Required proof: AT-02/03/06 from [automated-validation.md](../automated-validation.md), including 100 switches, 50 race cases, both delivery orders, source-only/untitled/Save As, two designers of A versus B, draft settlement and exact history preservation.
