# Domain Module Contracts

**Status**: Planned TypeScript interfaces expressed as behavior, not implementation. All package names use `@rdlc/`. All domain packages are free of VS Code, Angular, filesystem, process and network imports. No HTTP endpoints exist.

## Dependency direction

| Workspace package | Inputs → outputs | Permitted dependencies |
|---|---|---|
| `report-model` | Shared immutable snapshots, ranges, projections, diagnostics, edit intents and scenes | TypeScript/platform types only |
| `xml-parser` | Exact source snapshot → syntax tree, report projection, parse/compatibility diagnostics | report-model; justified XML well-formedness dependency |
| `expressions` | Expression string and scope context → classification, references, completeness, diagnostics; explicit field/aggregate requests → expression text | report-model |
| `validation` | Projection, reference analysis and optional edit intent → diagnostics and capabilities | report-model, expressions |
| `xml-serializer` | Syntax snapshot + validated edit intent → source patch plan or refusal | report-model; no parser/renderer import |
| `renderer` | Immutable projection + authoring viewport settings → design scene | report-model; native arithmetic only |

The extension orchestrates parse → analyze/validate → plan patches → apply patches in memory → reparse/validate → apply WorkspaceEdit. Package independence does not require duplicating shared types. No dependency cycles or generic plugin framework are needed.

## Parsing

- Namespace-aware strict XML parsing with original spelling and complete lexical source spans. Expanded names determine meaning, not a hard-coded prefix.
- The proposed strict parser is `saxes` 6.x with `xmlns: true`, XML 1.0 and no external resolver or custom entity registration. Its decoded SAX events do not constitute a lossless tree: a source-span scanner must retain raw tokens and reconcile them with validated events.
- Reject DOCTYPE/declarations that could define entities for visual editing, without fetching or expanding anything. Retain exact source for text access. Predefined and numeric XML references remain supported. Never recover malformed XML into an editable projection.
- XML 1.0 is the authored profile. Explicit XML 1.1 declarations remain source-only; do not let the parser's automatic version selection silently broaden the supported profile.
- Reject undefined prefixes, duplicate expanded attributes, malformed character/entity references, and mismatched tags. Preserve foreign nodes without attempting schema interpretation.
- Initial internal budgets proposed for validation: 16 MiB source text, depth 256, 100,000 elements. On limit, stop visual parsing with a source-only diagnostic; do not truncate, rewrite or impose a file-open restriction. Confirm these budgets against the acceptance workstation before release.
- Offsets must use original UTF-16 string indices, including CRLF and surrogate pairs. Parser line/column counters alone cannot serve as replacement ranges.

## Expression analysis

- Recognize literal values and leading-`=` expressions without evaluation. Support exact field references and the field/group/dataset scopes needed for generated bindings and `Sum` totals.
- Lex strings and escaped quotes correctly; a regex search alone cannot prove absence of references. Qualified syntax outside the supported analyzer is opaque.
- Reference analysis covers all known expression-bearing properties, including preserved report constructs. Unknown extension semantics and dynamic field/scope access produce incomplete analysis.
- Incomplete analysis must block dataset/field/group rename or removal when references cannot be excluded, with affected locations and reason. Ordinary unrelated textbox moves remain possible.
- No `eval`, `Function`, VB compiler/interpreter, report processing runtime or arbitrary formula execution.

## Validation and serialization

- Validate authored property values, report-wide item names, dataset/field scopes, known references, page dimensions, group hierarchy and tablix body/hierarchy shape before mutation.
- New property placement follows a version-specific rule table. Never assume every RDL sequence has the same ordering rule. Preserve existing source order.
- Serializer patches only values, attributes or explicitly authored structural insertions/removals. New names use the namespace binding already in scope; required new namespace declarations use a noncolliding prefix and the narrowest safe scope.
- Reject overlapping patches, changed expected text, stale versions, unresolved namespace dependencies and unsupported structural edits.
- Preserve raw XML outside the edit footprint exactly. Within the footprint, preserve unknown attributes/children when changing a known value; if that is impossible, refuse the edit. Do not pretty-print the document.
- Candidate verification must establish well-formed XML, expected intended change, no new invalid authored structure, and preservation of untouched ranges. Pre-existing unsupported content does not justify blanket rejection of unrelated safe edits.
- For column/group/total edits, all affected body rows, hierarchy members, widths, bindings and scoped aggregate expressions change atomically or none do. A complex existing tablix may support scalar text edits while structural edits remain blocked.

## Renderer

- Produces deterministic geometry, item labels, table cells and preservation placeholders only. It is not an RDLC report execution engine and does not promise pagination, font metrics or runtime fidelity.
- Browser DOM access belongs to the Angular application, not this package. Angular renders the scene with safe text bindings and accessible semantic controls.
- Font selection uses locally available fonts; no web font download. External images/resources are labeled placeholders. Existing embedded images remain preservation-only in this feature.

## Verification contract

Each package has unit tests. Parser/serializer changes additionally require exact no-op source equality and targeted-edit roundtrip tests with unknown XML and namespace cases. Validation and generated XML require specification-linked compatibility fixtures; lifecycle and offline isolation are integration gates. See [quickstart](../quickstart.md) for the acceptance commands and outcomes.
