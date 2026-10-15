# Compatibility and Preservation Contract

## Three different claims

1. **Authoring profile**: which constructs can be safely edited by this extension.
2. **MS-RDL compatibility**: which version-specific structural/property rules have fixture-backed evidence.
3. **RDLC consumer compatibility**: which specific external designer/runtime versions have accepted generated fixtures. No runtime compatibility is claimed merely from shared RDL vocabulary.

The installed extension requires no external runtime. Optional external compatibility evidence must be reproducible and versioned, but must not become a backend or runtime requirement.

## Profile and evidence matrix

References below are repository-root-relative and refer to the vendored MS-RDL v20251031 export.

| Construct | Authoring boundary | Reference and required evidence |
|---|---|---|
| Report | 2016/01, exactly one section | §2.3/§2.5/§2.6, `vendor/02-structures/2.3-report.md`, `2.5-reportsections.md`, `2.6-reportsection.md`; unsupported-version/multisection fixtures remain unmodified |
| Namespace extensions | Preserve all; unknown required semantics disables authoring | §1.7 `vendor/01-introduction/1.7-vendor-extensible-fields.md`; §2.3.1 `vendor/02-structures/2.3.1-report.mustunderstand.md`; prefix/default/rebinding/unknown-attribute fixtures |
| Textboxes | One paragraph/run, supported geometry/text/style | §2.16 `vendor/02-structures/2.16-textbox.md`; §2.16.1 item naming; §2.2.7 size units; literal, expression, Unicode and rich-text-preservation fixtures |
| Tables | Body-level tablix, static columns, unmerged cells, supported row groups | §2.23/§2.27/§2.29/§2.31 corresponding structural files; two-column/multirow/nested-group fixtures; synchronize body and hierarchy leaves |
| Groups and totals | Named row groups, static footer totals, explicit scope | §2.81 `vendor/02-structures/2.81-group.md`; §2.34.5 `2.34.5-tablixmember.group.md`; §2.34.8 `2.34.8-tablixmember.keepwithgroup.md`; §2.341.7 `2.341.7-aggregate-functions.md`; dataset-wide report total versus group subtotal evidence |
| Local datasets | Field declarations, no query execution | §2.325 `vendor/02-structures/2.325-dataset.md`; §2.328 `2.328-field.md`; existing query preservation, new query-free dataset and all seven designer-type fixtures |
| Other features | Preservation-only; affected unsafe actions blocked | Images, charts, rectangles, headers/footers, custom items, code, external resources, parameters, rich text, matrices, spanning cells and unknown types |

The §2.23 global-cell-count wording remains ambiguous in the official source (see [research R6](../research.md#r6--version-and-table-authoring-profile)). The selected table profile checks per-row counts and hierarchy consistency; it does not declare this wider prose ambiguity resolved.

## Required fixture record

Each accepted fixture records: ID; source/provenance and redistribution permission; report namespace; supported/unsupported/malformed status; applicable MS-RDL sections; authored capabilities; exact original source; operation and intended edit footprint; expected diagnostic/structural result; preservation assertions; and any external consumer/version evidence. Synthetic fixtures must be identified as synthetic. Microsoft reference text remains distinct from MIT project code.

Minimum corpus: 12 files covering supported blank/textbox/table/group/dataset cases and mixed unsupported items, rich text, expressions, custom namespaces, malformed XML and unsupported versions. Additional variants cover BOM/EOL, Unicode astral characters, CDATA, entities, comments, processing instructions, duplicate attributes, prefix rebinding, mandatory unknown extensions, external entity declarations and referenced-name protection. A file may cover several categories; every case needs explicit assertions.

## Mandatory pass/fail gates

- **Unit**: independent modules, boundaries and authored-property/reference rules; renderer geometry is deterministic and expressions never execute.
- **No-op roundtrip**: exact source-string equality, including namespaces, unknown XML and lexical details. For supported VS Code encodings, verify an installed no-op save does not alter file bytes. Encoding changes explicitly requested by the user are separate actions; do not claim byte equality for normalized text workflows.
- **Edited roundtrip**: intended changes persist after reparse/reopen; all source outside the declared edit footprint is exactly equal; unknown nodes/attributes and namespace bindings inside affected parents remain intact. Include add/remove columns/groups/totals, not only scalar text changes.
- **Compatibility**: generated supported structures satisfy cited version-specific rules and fixture expectations. Test each field type, data mapping, row hierarchy, group identity and aggregate scope. A syntactically valid XML document alone is insufficient.
- **Reference safety**: rename/delete blocked for known references and for opaque analysis that cannot exclude a dependency; diagnostics list the affected locations.
- **Lifecycle**: source/visual edits, invalid source, stale requests, duplicate requests, split views, applyEdit refusal, dirty save conflicts, failed save, close cancel, and 20 undo/redo operations cause zero silent loss.
- **Offline/isolation**: installed VSIX loads without network/server; no report-triggered network requests, expression/code execution, entity resolution or data-source access. Exercise local malicious references as well as remote ones.
- **Accessibility/performance/distribution**: keyboard-only full workflow, SC-004 timings, license/attribution inventory and reproducible contributor build.

Missing mandatory evidence is a failed gate. Record consumer compatibility as “not verified” unless the exact consumer/version has evidence; do not mislabel an unrun test as passing. See [plan V1–V10](../plan.md#technical-decisions-requiring-validation) for proof obligations before release.

## CI/CD enforcement

The [CI/CD contract](ci-cd.md) makes these gates mandatory on every PR, every push to main and
every release tag. All checks and available evidence MUST apply to the exact tested commit;
release evidence is linked to the tagged commit and canonical VSIX digest. Unit, roundtrip and
compatibility tests cannot be skipped because only workflow/version files changed. Hosted
checks MUST NOT replace unautomated mandatory acceptance evidence with an assumed pass.
No VSIX, handoff artifact or release is uploaded before the required quality gates succeed.

V9/V10 are user-approved design decisions, not passed technical checks. Before first publication,
resolve project-specific Entra/GitHub/vsce authentication and publisher/namespace permissions.
Before an existing-version recovery write, establish reliable association to the canonical
VSIX; unconfirmed remote integrity without prior-success evidence causes an explicit conflict.
V1–V8 and every compatibility/preservation gate above remain unchanged.
