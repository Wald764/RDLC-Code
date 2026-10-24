# Data Model: Native Sidebar Integration

All entities below are disposable projections/routing records. There is no database, new XML identity, serializer or independent history. Authoritative content remains the host TextDocument; existing editing types remain the only mutation language.

## ReportContext and DesignerView

| Entity | Fields | Ownership / relationships |
| --- | --- | --- |
| ReportContext | document lifetime ID, current URI/version, context generation, compatibility/status/diagnostics, optional associated view ID | Window routing registry; references accepted host evaluation and one live view of the same document |
| DesignerView | opaque view ID, document lifetime ID, panel/session, ready/disposed state, accepted selection/sequence | One per custom editor panel; viewport/preferences/drafts remain in that designer |
| AcceptedNavigation | version, Structure nodes/completeness, Data nodes/completeness | Derived from accepted syntax/evaluation, shared with native and Angular consumers |

Context states: no-report → loading → editable/source-only/invalid-source. Editor activation/lifecycle may return to no-report; invalid source clears stale actionable nodes. Source focus may have no associated designer. Sidebar focus changes no context. Explicit visual actions may open the same report's designer; ordinary view opening does not. Save As follows actual host identity transitions and invalidates obsolete action captures.

## NavigationNode and presentation rows

Actual nodes use flat parent-before-child arrays: version-local XML target ID, optional parent ID, source ordinal/range, expanded XML name, declared name when present, kind, display label, opaque/incomplete reason, and command-specific capabilities/reasons. Ranges are descriptive only; the host re-resolves source commands. Missing or duplicate names do not remove identifiable syntax nodes.

Structure kinds cover existing report/sections/section/body/header/footer/textbox/table/row/cell/container/preserved plus real table-body, row/column hierarchy, member, member-header and group. Actual ancestry and source order come from syntax, never runtime rows or authoring row/group associations. Unknown/foreign subtrees remain explicitly opaque. Source-only known namespaces permit inspection only, never editing eligibility.

Data kinds are dataset, field, parameter, embedded image, data source and opaque definition. Fields are children of their actual dataset; parameters/images/sources are displayed within fixed synthetic categories. Categories have synthetic UI keys but no XML target ID, range or mutation capability. Structure has no duplicate dataset branch. Compact fallback and inspector selection resolve both navigation collections.

Capability facts distinguish inspect/source/properties and each applicable existing operation; a recognized kind/name does not imply editability. Reuse current dataset/field/reference/table guards and their seven supported field types. Parameter/image/source mutations remain unavailable.

Metadata allowlist: recognized field/parameter type, validated boolean flags, calculated/mapped/unsupported classification, bounded image MIME/payload-present flag, dataset query-present flag and source inline/shared status. Do not project raw XmlNode objects, generic descendant text, image data, expressions, query text, credentials, connection strings or external reference contents. No decoding, evaluation or resource access occurs.

Limits follow [research.md](research.md#4-navigation-coverage-safety-and-allocation): shared 2,000-entry cap, 32 emitted levels per projection, fair initial split with unused-capacity transfer and whole-envelope trimming. Fixed synthetic categories/markers do not consume authored-node slots and cannot grow with source size. A truncated empty category says inventory incomplete, not no definitions. A selected canvas target omitted by presentation limits remains valid; show selection-outside-inventory feedback without inventing a node.

## ViewSelection

Exclusive modes: empty; ordered unique body-ID set with primary member; one cell; one structural/data target. Bind to accepted document version and designer ID, with monotonic sequence and optional originating request ID. XML cell identity and rendered child textbox identity remain distinct. Bounds are optional accepted scene facts, never inferred from source position or type.

Cross-version reconciliation uses explicit accepted mappings or unique expanded-type/name/ancestry correspondence. Unique unnamed report/section/body nodes may preserve expansion only. Deleted/ambiguous targets clear selection with feedback. UI IDs and expansion correspondence never authorize commands or survive as durable XML IDs.

## NativeAction and NavigationState

NativeAction fields/lifecycle follow [sidebar-bridge.md](contracts/sidebar-bridge.md): immutable request/document/URI/base-version/view/generation/target/capability capture; captured → waiting/guarded → accepted, cancelled or refused. Every asynchronous boundary revalidates. One terminal result per request; duplicate delivery is idempotent. Apply ends the original action; only its correlated accepted mutation can authorize a newer result version. No retries onto independent edits.

NavigationState contains expansion UI keys, component filter and accepted/pending/refused row cues. Native visibility/placement is host-owned; designer viewport/fallback preferences are view-local. None creates report history. Do not persist pending actions, drafts or version-local IDs. A view closes by disposing listeners and terminating its pending captures.

## ComponentEntry and AutomatedEvidence

ComponentEntry: canonical kind/category, icon, filter label, availability/reason and existing activation intent. Exactly eleven kinds, three creatable, as defined in [native-workspace.md](contracts/native-workspace.md). Filtering is case-insensitive over labels, with categories retained only for matches.

AutomatedEvidence: provenance commit, versioned input manifest/candidate fingerprint/scoped patch digest, separate VSIX SHA-256, fixture IDs/hashes, requirement/scenario/edge/SC and assertion IDs, environment/display/theme identity, outcome and artifact links/digests. Input membership, output exclusions and invalidation follow [Candidate fingerprint and evidence invalidation](contracts/desktop-validation.md#candidate-fingerprint-and-evidence-invalidation); evidence never hashes itself as a candidate input. Raw samples and comparisons substantiate thresholds; absent/unrun/failed mandatory assertions remain unvalidated. Native drag may be unavailable-with-evidence only under that contract.
