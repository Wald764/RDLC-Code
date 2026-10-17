# Local dataset compatibility evidence (V4)

The phase-4 fixtures are synthetic MIT authoring checks, not Microsoft-designer exports.
No external designer or ReportViewer consumer/version has been run. Consumer acceptance
is **not verified** for every mapping below; no universal RDLC runtime claim is made.

| Authored type | Designer `TypeName` |
| ------------- | ------------------- |
| text          | System.String       |
| Boolean       | System.Boolean      |
| Int32         | System.Int32        |
| Int64         | System.Int64        |
| decimal       | System.Decimal      |
| double        | System.Double       |
| date/time     | System.DateTime     |

MS-RDL §2.325 (`vendor/02-structures/2.325-dataset.md`, 2016/01 schema)
allows an omitted Query. §2.328 (`vendor/02-structures/2.328-field.md`)
requires DataField or calculated Value, never both. Authored fields map DataField
to their own name; existing mappings and calculated fields are not rewritten.
Designer metadata uses the expanded reportdesigner namespace, independent of prefix.
New namespace bindings are scoped to the inserted TypeName element, with a
noncolliding prefix. No connection, Query or CommandText is synthesized.

The Microsoft example cited in research R7 demonstrates String/Int32/Decimal
metadata conventions, not acceptance of these synthetic files by a specific runtime.
Boolean/Int64/Double/DateTime and the complete query-free template still require
reviewed original-designer fixtures and exact intended consumer-version evidence
before a runtime compatibility claim or release readiness approval.
