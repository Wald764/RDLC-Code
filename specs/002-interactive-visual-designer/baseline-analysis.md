# Interactive Visual Designer: Baseline and Dependency Analysis

**Date**: 2026-10-18
**Purpose**: Record targeted repository findings and format evidence before functional specification. No application code, protocol implementation or implementation plan is produced here.

## Authority and Evidence

- [Constitution 1.1.0](../../.specify/memory/constitution.md): native document lifecycle; source authority; lossless, footprint-scoped editing; independent verification; explicit compatibility; bounded reference discovery; inert untrusted reports; offline operation.
- [001 specification](../001-rdlc-vscode-editor/spec.md), [plan](../001-rdlc-vscode-editor/plan.md), and contracts for [modules](../001-rdlc-vscode-editor/contracts/modules.md), [editor protocol](../001-rdlc-vscode-editor/contracts/editor-protocol.md), [compatibility](../001-rdlc-vscode-editor/contracts/compatibility.md) and [CI/CD](../001-rdlc-vscode-editor/contracts/ci-cd.md) remain inherited requirements.
- [0.1.0 publication evidence](../../docs/validation/release-010.md) records successful publication and byte-identical independent downloads from three destinations, including the six desktop CI jobs. The README and some 001 artifacts retain older development/planning language. Treat publication as established; it does not prove new gestures or universal external runtime fidelity.
- [README boundaries](../../README.md#boundaries-and-evidence) and [US1 evidence](../../docs/validation/us1.md) document preservation-only constructs, parser budgets, version-scoped selection and existing validation. Their remaining evidence limitations must not be mistaken for newly implemented interactive behavior.

## Existing Behavior versus Feature Delta

| Area | Inspected baseline | Required delta and affected boundary |
| --- | --- | --- |
| Canvas selection | `apps/designer/src/app/editor/editor.component.html` renders accessible item buttons with click selection. `editor.component.ts` stores one version/index and clears effective selection on any new version. | Keep single-click behavior; add selection sets, primary target, marquee, overlap access, stable continuity for own accepted edits, safe invalidation for independent changes. |
| Textbox editing | Existing properties send one typed `setProperty` intent; `packages/report-model/src/editing.ts` lists geometric/text/style properties. | Direct gestures are new input methods for inherited geometry, with compound x/y/width/height commits; do not recreate property authoring. |
| Table editing | Existing authoring actions include position, column width, row height, columns, cells, groups and totals. `packages/renderer/src/tables.ts` emits cell items, not an outer selectable table object. | Expose a distinguishable whole-table target, proportional outer resizing and selection routing while keeping cell editing. New bulk operations must not fake cell-local geometry. |
| Rendering | `packages/renderer/src/render.ts` produces deterministic labels, bounds and placeholders; it currently defaults absent item dimensions to zero. `geometry.ts` converts five RdlSize units to 96px/in authoring coordinates. | Derive missing textbox dimensions correctly before trustworthy hit-testing/handles; support interaction geometry independent of viewport; preserve pure authoring rendering, no execution. |
| Placement aids | Selected source files expose no multi-selection, gestures, handles, viewport controls, grid, snapping, guides or clipboard workflow. | Add the specified view-local interactions around the accepted scene; never write grid/zoom preferences into XML. |
| Host pipeline | `apps/vscode-extension/src/edit-controller.ts` validates current target/capability, plans minimal patches and uses `verifyCandidate` before returning a plan. Most actions express one property or one structural request. | Extend typed vocabulary and candidate verification for compound/multi-target operations and preserved subtree insertion/removal. Validate all members and one complete candidate before one apply, not a sequence of scalar edits. |
| Protocol/lifecycle | `document-session.ts` owns snapshots, per-document queues shared across views, document-change publication and native edits. Contract IDs are version-scoped; UI does not authorize patches or file paths. | Correlate own accepted results with new selection identities, cancel independent stale gestures and retain duplicate/version guards. Add clipboard communication only through validated, document-bound operations. |
| XML preservation | `packages/xml-serializer/src/{textboxes,tables,structure,patches}.ts` and `apps/vscode-extension/src/verify-candidate.ts` establish lexical patches, footprints, namespace dependencies and reparsed candidates. | Reuse these rules for multiple nonoverlapping geometry changes and complete subtree capture. No model-to-report full serialization; preserve unknown children even inside selected/copied nodes. |
| Dependencies and names | `packages/validation/src/{textboxes,tables,datasets}.ts` and `packages/expressions/src/analyze.ts` guard names, structural edits and known/opaque references. Existing controller removal paths use reference guards. | Whole-selection cut must consider dependencies outside the removal set; insertion needs report-wide item names, table-cell names, groups, known internal mapping and compatible external scopes. Opaque analysis refuses uncertain destructive/identity-changing operations. |
| Tests | Existing package tests, Angular editor/lifecycle tests, `tests/roundtrip/{lexical,textboxes,authoring}.test.ts`, `tests/compatibility/`, `tests/vscode/{lifecycle,synchronization,persistence}.test.ts` and fixture manifest. | Extend these existing test layers for the specification's acceptance coverage; native one-operation Undo and lexical preservation are release gates, not visual-only assertions. |

## Dependencies and Adaptations to Carry into Planning

1. Preserve the TypeScript workspace, Angular designer and domain package boundaries. Reuse parser/projection, validation, serializer, expression analysis and renderer rather than creating parallel report models or save paths.
2. Extend shared scene/selection semantics enough to distinguish table frames and cell content. Resolve report source ordering and effective ZIndex before reliable overlap hit-testing; the current renderer's textbox-first composition is not sufficient evidence of correct hit order.
3. Define safe own-edit selection reconciliation without treating version-scoped node IDs, scene indices or renamed item names as globally stable. Independent changes must still invalidate uncertain identities and drafts.
4. Extend host validation, intent shape checks, serialization and candidate verification together for atomic compound changes. Keep per-document serialization, version rechecks, idempotency, minimal footprints and native application.
5. Define inverse/unit-safe report geometry and correct optional-dimension semantics before adding gestures. Preserve lexical units and unknown property content; no expression evaluation or implicit body growth.
6. Add clipboard capture and insertion validation without granting the webview arbitrary XML-patch authority. Respect existing parser/message budgets and native clipboard failure behavior; do not add broad filesystem/network privileges.
7. For whole-table resize, verify all affected row/column and explicit/derived outer dimensions as one consistent candidate. Retain 001's supported structural profile and unresolved wider tablix ambiguity; do not claim broader conformance.
8. Reuse existing field/property controls, diagnostics, source commands and authoring actions. Define draft conflicts and focus routing for canvas shortcuts so form editing remains intact.
9. Extend focused automation and installed desktop acceptance. New performance/usability evidence must be recorded rather than inferred from baseline automated budget checks or publication success.

## Targeted MS-RDL Evidence

Reference version: local MS-RDL v20251031. Paths are relative to this analysis. These establish format semantics, not external RDLC runtime acceptance or prescribed UX.

| Reference | Observed rule and consequence |
| --- | --- |
| §2.2.7 [RdlSize](../../vendor/02-structures/2.2.7-rdlsize.md) | pt, pc, in, mm, cm are size units; unspecified properties usually default to zero unless overridden. Grid/display units and changed geometry must obey property-specific rules; screen pixels are not RDLC units. |
| §2.16.11 [Textbox.Left](../../vendor/02-structures/2.16.11-textbox.left.md), §2.16.14 [Textbox.Top](../../vendor/02-structures/2.16.14-textbox.top.md) | Coordinates are relative to the containing object. This feature manipulates body items only; zoom/pan cannot become source offsets and no reparenting is implied. |
| §2.16.16 [Textbox.Width](../../vendor/02-structures/2.16.16-textbox.width.md), §2.16.10 [Textbox.Height](../../vendor/02-structures/2.16.10-textbox.height.md) | Missing width/height is the corresponding container dimension minus Left/Top, not zero. The existing fallback needs a bounded correction for interactive geometry; changed position may require explicit dimensions to preserve intended unchanged size. |
| §2.16.17 [Textbox.ZIndex](../../vendor/02-structures/2.16.17-textbox.zindex.md), §2.23.42 [Tablix.ZIndex](../../vendor/02-structures/2.23.42-tablix.zindex.md) | Drawing order is container-local; textbox absence means zero, while the table section confirms its optional unsigned value. The feature uses zero for absent drawing priority and source order for ties as deterministic UX defaults. Inspection/hit order must account for explicit values without modifying the report. |
| §2.23.19 [Tablix.Left](../../vendor/02-structures/2.23.19-tablix.left.md), §2.23.38 [Tablix.Top](../../vendor/02-structures/2.23.38-tablix.top.md) | Table placement is relative to its containing object and optional. The table frame manipulates the body's table, not individual cell positions. |
| §2.23.41 [Tablix.Width](../../vendor/02-structures/2.23.41-tablix.width.md), §2.23.16 [Tablix.Height](../../vendor/02-structures/2.23.16-tablix.height.md) | Outer size may be explicit or derived from columns/rows and applicable headers. Resizing cannot merely change the displayed outer box while leaving internal sizes inconsistent. Header-bearing unsupported structures remain outside the profile. |
| §2.16.1 [Textbox.Name](../../vendor/02-structures/2.16.1-textbox.name.md) | Textbox identity is case-sensitive and unique among all report items. Copying tables requires considering cell textbox names, not only the table name. New names retain baseline authoring validation. |
| §1.7 [Vendor-Extensible Fields](../../vendor/01-introduction/1.7-vendor-extensible-fields.md) | Foreign attributes/children are allowed. RDLC Code deliberately provides a stronger preservation guarantee than the reference's allowance for other tools to discard them; copying cannot reduce a subtree to known fields. |

The existing [compatibility contract](../001-rdlc-vscode-editor/contracts/compatibility.md) supplies inherited citations for versions, required extensions, tablix hierarchy, group scope and local fields. Its §2.23 global-cell-count ambiguity remains unresolved. No new claim in this feature relies on resolving that ambiguous extracted table/prose; any later expansion must verify the original source excerpt first.

## Scope of This Analysis

Discovery used selected directory metadata, the feature contracts, specific relevant symbols/files and individual indexed vendor sections. It did not ingest the vendor corpus or every source file. This is source/document analysis, not a new execution of baseline tests or independent reproduction of published release evidence.
