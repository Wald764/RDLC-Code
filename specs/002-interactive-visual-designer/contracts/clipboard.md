# Same-Window Clipboard Contract

## Ownership, format and budgets

Use `vscode.env.clipboard` only in the extension host. Keep one immutable capture shared across document sessions in the same VS Code window. The operating-system clipboard contains only a JSON envelope:

```json
{
  "format": "rdlc-code/items",
  "version": 1,
  "window": "<random window-session identity>",
  "capture": "<random capture identity>"
}
```

The token is an untrusted lookup key, never edit authority. Validate exact keys, format/version, ID shape, window identity and retained capture identity. Plain text, arbitrary XML, foreign-window/version tokens and unavailable captures refuse with corrective advice to copy again. Closing the source does not invalidate an already retained snapshot; replacing capture or reloading the extension does. Cross-window/external-designer interoperability is outside scope.

New bounded design limits: 1 KiB UTF-8 envelope and 8 MiB UTF-8 retained payload, counting subtree text, namespace environments and dependency descriptors. Retain one capture, with no disk persistence. Reuse existing XML limits (16 MiB source measured in both JS string length and UTF-8 bytes, 100,000 elements, depth 256) on source and complete candidate. Existing protocol limits (64 KiB nonsnapshot, JSON depth 20 and value-count limits) remain unchanged because XML never crosses the webview bridge. These capture limits are new decisions, not existing implementation claims.

## Actions and protocol

Add a closed `clipboard` request with `requestId`, `baseVersion`, action and action-specific fields, plus a correlated `clipboardResult`. All IDs are document-bound and version-scoped. Shared message validation, extension binding and private designer adapter change together.

| Action | Input | Result and mutation |
| --- | --- | --- |
| Copy | Complete eligible body selection | Host validates insertion-safe capture, writes the token, then installs capture/generation. No document edit. |
| Cut | Complete eligible selection; the explicit Cut action is the acknowledgement | Validate capture and whole-set removal; successfully populate clipboard before rechecking source/version and removing all roots in one edit. |
| Paste | Current destination version; no user XML/manifest | Read token, resolve immutable capture, validate destination and insert complete selection in one edit. |
| Duplicate | Complete eligible selection | Transient capture plus insertion planner; one edit, clipboard and retained capture unchanged. |

Mutating actions reuse the existing per-document native edit queue and full-candidate verification. Copy still uses duplicate/request/version guards and returns a correlated result, without producing `editResult` mutation semantics. Mutation results include accepted/changed status, actual result version and inserted/removed target identity metadata consistent with [layout results](layout-protocol.md).

Serialize capture replacement through a window-local clipboard action queue so concurrent views cannot associate the OS token with the wrong capture. Keep actual native document commits in the per-document queue. After any clipboard await, recheck the relevant document version; never auto-retry. Clipboard failure leaves source untouched. A failed post-write cut may leave a usable capture, but removes no partial selection. Return actual accepted state and an actionable explanation.

Track capture generation and successful paste count per destination view. First paste offsets every root by (10pt,10pt), second by (20pt,20pt), etc.; a successful new copy/cut resets generation. Increment only after verified acceptance. Duplicate always offsets current selection by (10pt,10pt). Snapping does not apply. Select inserted roots and Reveal Selection; overflow only warns.

## Capture and insertion preservation

Capture exact `XmlNode.range` source slices, lexical namespace environments, relative geometry, source order, typed declarations and resolved dependencies. Table roots include cell textboxes, row groups and totals. Do not generate copies through existing create-textbox/table helpers.

Before insertion, allocate deterministic valid case-sensitive names for every nested report item and group, reserving destination and newly assigned names together. Use separate typed item/group/data-region indices, not the current untyped scan of every `Name` attribute. Validate generated names through existing name rules; do not pass arbitrary Unicode names into the ASCII-prefix-only helper. A safe valid generic prefix plus deterministic suffix is sufficient.

Patch captured fragments only for required identities, understood references, geometry offsets and local namespace closure. Add inherited declarations on copied roots where needed; preserve prefixes, default namespaces and internal rebinding without editing destination bindings. Compare expanded names and namespace meaning against the original capture, including unprefixed attribute rules. Preserve all other lexical content exactly.

Capture physical bounds and explicit/derived provenance before any offset. Paste/Duplicate preserve each root's captured width/height within 0.01pt, not the destination-relative derived size. After applying the offset, materialize a missing textbox Width/Height only if destination derivation would change that captured size, using the destination view's displayed unit (pt by default). Preserve existing explicit size lexemes and leave absent dimensions absent when derivation still matches. Refuse unknown/unprovable required bounds. Include necessary size insertion in the transformed subtree and the same native undo step. Test first/repeated Paste and Duplicate in the source body and Paste into narrower/wider and shorter/taller bodies, including both dimensions omitted and mixed units.

Build final fragment strings before a single destination insertion plan. Reparse/verify the complete candidate and every inserted subtree against its capture transformation, not only the untouched original nodes. For a missing/self-closing `ReportItems`, reuse namespace-aware structural insertion. Preserve existing root order and destination content outside the declared insertion footprint.

## Dependency proof

Extend bounded expression analysis with exact identity operands and typed dataset/group/data-region context. Existing decoded expression ranges are not raw XML offsets: map tokens through entity/CDATA/whitespace lexical correspondence before changing source. If that mapping is unprovable, refuse the affected insertion rather than reserialize expressions.

| Reference | Required handling |
| --- | --- |
| `ReportItems!Name.Value` | Resolve typed target; map copied internal target, otherwise retain and validate compatible external target. |
| `Sum(..., "scope")` | Resolve scope as dataset, group or data region; map copied group/table scope and retain proven external scope. Never classify every nongroup scope as a dataset. |
| `ToggleItem`, `RepeatWith`, supported scalar scope/dataset bindings | Resolve in their owning construct; map only proven copied identities and validate retained external targets. |
| Literals resembling references | Preserve as literals; no string substitution. |
| Dynamic collection access, unsupported aggregates, `Scopes!`, custom code or other opaque expressions | Refuse unsafe insertion/removal with the unknown dependency and corrective action; no guessed rewriting/evaluation. |

Destination dataset compatibility checks required field names, declared/supported types, definitions and scope placement. Same dataset name is insufficient. Conservatively require identical required field definitions; unknown/ambiguous types, unanalysable calculated fields and incompatible scope ancestry refuse. Do not duplicate/change external datasets/resources. External item/group name matches also require compatible kind and valid scope.

Namespace preservation does not prove extension semantics. Preserve known identity-independent metadata byte-for-byte; only an explicit documented semantic classification may establish its insertion safety. Unknown attributes/children/processing instructions that may carry identities or dependencies refuse insertion rather than being removed. Add positive fixtures for proven safe preserved metadata and refusal fixtures for opaque identity-bearing metadata. This restriction must not block unrelated geometry edits.

### Minimal foreign-metadata classification

This project explicitly defines `{urn:rdlc-code:extension}Opaque` as an inert annotation only when it has exactly one unqualified `keep` attribute with literal value `1`, no other non-namespace attributes, and text-only content (including CDATA/entity spelling), with no child elements or processing instructions. Its text and `keep` flag have no identity, reference, expression, resource or execution semantics. This is a project-owned extension contract, not an MS-RDL or external runtime compatibility claim. Preserve the complete original lexical content and namespace meaning; do not scan or rewrite annotation text as references. Match expanded names, not prefixes. The shape already occurs in `tests/fixtures/textboxes/supported.rdlc`; its separate `rd:DefaultName` attribute is not classified by this rule.

| Example | Decision |
| --- | --- |
| `<x:Opaque xmlns:x="urn:rdlc-code:extension" keep="1">preserve</x:Opaque>` | Safe annotation; preserve byte-for-byte except necessary namespace closure. |
| The same annotation with text `ReportItems!Title.Value` | Safe literal annotation; never rewrite its text. |
| Same element with `target="Title"`, a nested element, a processing instruction or a different `keep` value | Unclassified semantics; refuse insertion. |
| `Opaque` in another namespace, `x:Chart`, or `rd:DefaultName` | Not covered; refuse unless a separate reviewed classification/reference rule proves safety. |

The classification is implemented only by `inertAnnotation` in `packages/validation/src/clipboard.ts`, with positive/negative regressions in `packages/validation/src/clipboard.test.ts` and refusal fixtures in `tests/fixtures/interactive/clipboard-opaque.rdlc`.

Positive clipboard fixtures must isolate this classified annotation from other unclassified metadata. Existing fixtures remain preservation regressions; their presence alone does not establish insertion safety. Additional classifications require documented semantics and positive/negative regression fixtures before they can grant insertion capability.

For Cut, extend existing removal guards to exclude the complete removal set, then check every removed nested identity against the remaining report. References between removed members are safe; known references from remaining content block removal; opaque remaining content (unclassified extensions or incomplete expressions) blocks when its decoded or raw text spells a removed name. Outside references to originals do not themselves block Copy when originals survive and copied dependencies are valid. Decision 2026-10-18 (owner): Cut needs no separate checkbox; the explicit Cut command acknowledges removal of all contained XML, and one native Undo restores it. Existing authoring deletes keep their acknowledgement and fully conservative opaque guard.

## Required verification

Test same/cross-document snapshots, nested naming collisions, group/data-region mapping, all refusal classes, same-name incompatible datasets, namespace rebinding, lexical expressions, Unicode names, stale source after clipboard await, write/read failure, capture replacement, repeated offsets and duplicate clipboard equality. Accepted cut/paste/duplicate must each require one native Undo; every refusal leaves the destination/source unchanged. Canvas shortcuts must leave normal input editing intact.
