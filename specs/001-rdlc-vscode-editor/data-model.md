# Data Model: Source-Preserving RDLC Authoring

**Status**: Design contract; no implementation. See [research](research.md) and [module contracts](contracts/modules.md).

## Authoritative representation

The VS Code `TextDocument` is the sole mutable report authority. Domain objects are immutable projections of a particular document version. Angular Signals hold the last accepted projection and temporary form/gesture state, never a second saved document. No normalized object graph is serialized wholesale.

| Entity | Fields and relationships | Invariants |
|---|---|---|
| DocumentSnapshot | URI, VS Code version, exact source string, encoding/EOL context supplied by host | Every range and projection belongs to this version; original file remains owned by VS Code |
| XmlSyntaxDocument | snapshot version, declaration, root, lexical tokens, namespace scopes, diagnostics | Complete source coverage including whitespace, comments, processing instructions and CDATA; no token rewriting |
| XmlNode | snapshot-local ID, kind, qualified name, expanded name `{namespaceUri, localName}`, parent/ordered children, start/end ranges, ordered attributes | Offsets are UTF-16, zero-based, half-open; prefixes and namespace redeclarations retained; IDs are not persisted in XML |
| XmlAttribute | qualified/expanded name, name/value/full ranges, quote character, decoded value | Raw lexical form remains in source; unprefixed attributes have no default namespace |
| ReportProjection | version, definition namespace, capabilities, section, datasets, item index, reference index, diagnostics | RDL 2016/01 and exactly one section for visual editing; other reports remain source-accessible |
| ReportSection | node reference, body width/height, page, body items | Width belongs to ReportSection in 2016/01; height belongs to Body; do not synthesize legacy Report.Width |
| Page | width, height, top/right/bottom/left margins, source property references | Positive dimensions; nonnegative margins; positive printable width and height |
| Textbox | node reference, name, bounds, paragraph/text-run references, value, supported style | Editable only with one paragraph and one text run; body-level textboxes and supported table-cell textboxes are distinct contexts |
| Table | tablix node, name, dataset reference, bounds, columns, rows, row hierarchy, column hierarchy | Only supported table-shaped tablix structures; matrix and opaque structural features are preservation-only |
| TableColumn | node reference, width, corresponding static column member | Positive width; body column count equals leaf column-member count |
| TableRow / Cell | height, ordered cells; cell textbox and source reference | Positive height; cell spans and hierarchy must match body shape; unsupported merged/spanning cells block structural edits |
| RowGroup | member reference, group name, grouping expressions, child members, associated static header/footer rows | Group names meet MS-RDL scope rules; hierarchy leaf rows match body rows; totals are explicit static rows, not metadata flags |
| TotalDefinition | target cell, aggregate expression, dataset/group scope reference, row placement | Explicit scope; preserved as unevaluated expression text; changing groups checks dependent totals |
| LocalDataset | node reference, unique name, fields, preserved query/data-source/designer metadata | No data connection or execution; creation follows the validated RDLC template decision |
| DatasetField | node reference, name, data-field mapping or calculated expression, declared type metadata | Field names unique per dataset; new data fields map to their own names; existing mappings/calculated fields preserved |
| ExpressionValue | exact source reference, decoded text, literal/expression classification, known references, analysis completeness | Never evaluated or translated to JavaScript; unknown syntax is retained and marked opaque |
| Reference | target kind/name, containing item/property, range, confidence | Known references can block rename/delete; incomplete analysis blocks potentially destructive changes conservatively |
| PreservedRegion | node/range, reason, namespace scope, affected capability | Not a detached copy: remains in place in source; mutation cannot move or regenerate it accidentally |
| Diagnostic | stable code, category, severity, source range, item/property, explanation, corrective action, blocked operations, optional spec citation | Distinguish malformed XML, invalid authored value, unsupported construct, stale edit and preservation risk |
| EditIntent | request ID, base document version, operation, target ID, typed payload | Host validates shape, version, capability and references; never accepts arbitrary patches from the webview |
| SourcePatch | source version, start/end offsets, expected original text, replacement | Sorted non-overlapping ranges; replacement affects only declared edit footprint; checked before one atomic WorkspaceEdit |
| DesignScene | projection version, page/body bounds, positioned items, table grid, labels and placeholders | Pure design geometry; no HTML, scripts, external resource URLs, or evaluated data |

## Value and naming rules

- Preserve original length strings and units (`pt`, `pc`, `in`, `mm`, `cm`); convert only for geometry using 96 CSS pixels/inch. Store newly authored values as explicit unit strings, avoiding repeated conversion drift.
- Positions are nonnegative and dimensions positive for authored items. MS-RDL property-specific defaults remain distinct from authoring validation. Existing expression-valued geometry is preservation-only when it cannot be laid out safely.
- RDL identifiers are not arbitrary XML names. Existing names are compared with the specification's case-sensitive scope rules. Newly generated names use a conservative ASCII CLS-compatible subset; do not reject preserved Unicode names just for being outside that generator subset. Item uniqueness includes preserved items and nested cell textboxes.
- Supported new field metadata: text → `System.String`; Boolean → `System.Boolean`; Int32 → `System.Int32`; Int64 → `System.Int64`; decimal → `System.Decimal`; double → `System.Double`; date/time → `System.DateTime`. These are XML metadata strings, not backend types or JavaScript numeric conversions. Runtime acceptance is a separate validation gate.
- Literal text and expressions remain strings. XML escaping occurs only when a changed value is written; decoded text is never substituted into unrelated raw XML.
- Preserve explicit/default namespace scopes, unknown attributes, mixed content, comments, CDATA boundaries, processing instructions, and relative sibling order. A whole-subtree deletion is allowed only when the user explicitly deletes that item and the UI identifies contained preserved content; dependent references still block it.
- An unknown namespace alone is not an error. An unknown namespace required by `MustUnderstand` disables visual authoring conservatively until its semantics are supported.

## State transitions

1. Open/change → capture snapshot → strict XML parse → classify compatibility → project model → validate → publish snapshot.
2. Well-formed supported source → `editable`; unsupported version/section/required extension → `source-only`; malformed XML → `invalid-source`; unsupported individual features reduce only affected capabilities.
3. `editable` + intent at current version → validate → plan patches → parse and verify candidate → host applies one WorkspaceEdit → normal document-change event publishes the next snapshot.
4. Stale intent or failed validation → reject without mutation and publish current state/diagnostics. Source edits invalidate all previous IDs and patch ranges.
5. Undo/redo/source changes → rebuild from the resulting TextDocument; no independent visual history or mirrored dirty flag.
6. External change with local edits → VS Code conflict workflow; host must not force overwrite, retry stale patches, or bypass the document service. Failed save keeps the dirty TextDocument.
7. Invalid source can still be saved deliberately through the normal text-editor workflow; graphical commands never rewrite it. A no-op graphical save delegates to VS Code without parsing-to-serialization.

## Required specification anchors

Use repository-root-relative references: MS-RDL §2.3.1 `vendor/02-structures/2.3.1-report.mustunderstand.md`; §2.6 `vendor/02-structures/2.6-reportsection.md`; §2.2.7 `vendor/02-structures/2.2.7-rdlsize.md`; §2.16.1 `vendor/02-structures/2.16.1-textbox.name.md`; §2.23 `vendor/02-structures/2.23-tablix.md`; §2.81 `vendor/02-structures/2.81-group.md`; §2.325/§2.328 `vendor/02-structures/2.325-dataset.md` and `vendor/02-structures/2.328-field.md`. Property mappings must use the matching version-specific sections, not inferred object names.
