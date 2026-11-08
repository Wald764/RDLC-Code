import type { XmlNode } from './syntax.js';
import type { SourceRange } from './document.js';
import type { Diagnostic } from './diagnostics.js';
import type {
  ImageFormat,
  ImagePixels,
  ImagePlaceholderReason,
  ImageReason,
  ImageSizing,
} from './images.js';

export const RDL_2016 =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';

export const DESIGNER_NAMESPACE =
  'http://schemas.microsoft.com/SQLServer/reporting/reportdesigner';
export const fieldTypes = {
  text: 'System.String',
  Boolean: 'System.Boolean',
  Int32: 'System.Int32',
  Int64: 'System.Int64',
  decimal: 'System.Decimal',
  double: 'System.Double',
  'date/time': 'System.DateTime',
} as const;
export type FieldType = keyof typeof fieldTypes;
/** Field names are unique per dataset; existing mappings/calculated fields are source-owned. */
export interface DatasetField {
  readonly node: XmlNode;
  readonly name: string;
  readonly dataField: string | null;
  readonly calculatedValue: string | null;
  readonly typeName: string | null;
  readonly type: FieldType | null;
}
/** No data connection or execution; new datasets are query-free local declarations. */
export interface LocalDataset {
  readonly node: XmlNode;
  readonly name: string;
  readonly fields: readonly DatasetField[];
  readonly query: XmlNode | null;
}
export interface TableColumn {
  readonly node: XmlNode;
  readonly member: XmlNode;
  readonly width: string;
}
export interface TableCell {
  readonly node: XmlNode;
  readonly textbox: Textbox | null;
}
export interface TableRow {
  readonly node: XmlNode;
  readonly member: XmlNode;
  readonly height: string;
  readonly cells: readonly TableCell[];
}
export interface RowGroup {
  readonly node: XmlNode;
  readonly member: XmlNode;
  readonly name: string;
  readonly expressions: readonly string[];
}
/** Totals are explicit static rows with unevaluated expressions and explicit scope. */
export interface TotalDefinition {
  readonly cell: TableCell;
  readonly expression: string;
  readonly scope: string;
  readonly kind: 'group' | 'dataset';
}
/** Matrix, spanning and opaque structural features are preservation-only. */
export interface Table {
  readonly node: XmlNode;
  readonly name: string;
  readonly dataset: string | null;
  readonly bounds: TextboxBounds;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly groups: readonly RowGroup[];
  readonly totals: readonly TotalDefinition[];
  readonly structural: boolean;
  readonly blockedReason: string | null;
}

export interface LengthValue {
  readonly raw: string;
  readonly pixels: number;
}
/** Positive dimensions, nonnegative margins, positive printable area. */
export interface Page {
  readonly width: string;
  readonly height: string;
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}
export interface ReportSection {
  readonly node: XmlNode;
  /** RDL 2016/01 width belongs to ReportSection, height to Body. */
  readonly width: string | null;
  readonly height: string | null;
  readonly page: Page | null;
}
/** Raw authored RDL strings; `null` means the element is absent. */
export interface TextboxBounds {
  readonly left: string | null;
  readonly top: string | null;
  readonly width: string | null;
  readonly height: string | null;
}
/** Supported RDL style values; `null` preserves an absent or expression value. */
export interface TextboxStyle {
  readonly fontFamily: string | null;
  readonly fontSize: string | null;
  readonly fontWeight: string | null;
  readonly fontStyle: string | null;
  readonly color: string | null;
  readonly textAlign: string | null;
}
/**
 * Body-level and supported table-cell textboxes are distinct contexts. Editing is
 * only offered for exactly one paragraph/run; richer content stays preservation-only.
 */
export interface Textbox {
  readonly node: XmlNode;
  readonly context: 'body' | 'table-cell' | 'preserved';
  readonly name: string | null;
  readonly nameRange: SourceRange | null;
  readonly bounds: TextboxBounds;
  readonly boundsRanges: Readonly<
    Record<'left' | 'top' | 'width' | 'height', SourceRange | null>
  >;
  readonly value: {
    readonly node: XmlNode;
    readonly range: SourceRange;
    readonly text: string;
  } | null;
  readonly style: TextboxStyle;
  readonly styleNode: XmlNode | null;
  /** Property-level capabilities; a missing name is preservation-only. */
  readonly capabilities: readonly string[];
}
/** MS-RDL 2.306. The decoded bytes are never projected, only facts derived from them. */
export interface EmbeddedImageDefinition {
  readonly node: XmlNode;
  readonly name: string;
  readonly nameRange: SourceRange;
  /** Constant `MIMEType` text; `null` when absent or an expression. */
  readonly mime: string | null;
  /** From the content signature, never from `mime` alone. */
  readonly format: ImageFormat | 'other';
  /** Length of the `ImageData` text with whitespace removed. */
  readonly encodedSize: number;
  /**
   * Decoded length when the base64 is valid. Null when invalid, and also when the text
   * is too long to be a permitted picture (`too-large`): it is then never decoded.
   */
  readonly byteSize: number | null;
  readonly pixels: ImagePixels | null;
  /** SHA-256 of the decoded bytes; `null` unless the host supplied a digest. */
  readonly hash: string | null;
  readonly displayable: boolean;
  readonly reason: ImageReason | null;
  /**
   * Names of the image items whose constant `Value` equals `name`; an unnamed item
   * counts under its node id. Always empty for a repeated definition name, which
   * never resolves.
   */
  readonly references: readonly string[];
}
/**
 * MS-RDL 2.12. Authoring is only offered in the body; the capability list encodes
 * the editable, geometry-only and preservation-only states.
 */
export interface ImageItem {
  readonly node: XmlNode;
  readonly name: string | null;
  readonly nameRange: SourceRange | null;
  readonly context: 'body' | 'table-cell' | 'preserved';
  readonly bounds: TextboxBounds;
  readonly boundsRanges: Readonly<
    Record<'left' | 'top' | 'width' | 'height', SourceRange | null>
  >;
  readonly source: 'Embedded' | 'External' | 'Database' | 'expression' | null;
  readonly value:
    | { readonly kind: 'constant'; readonly text: string }
    | { readonly kind: 'expression' }
    | null;
  /** `AutoSize` when the element is absent (MS-RDL 2.12.18). */
  readonly sizing: ImageSizing;
  readonly sizingRange: SourceRange | null;
  /** Inert; never evaluated. */
  readonly toolTip: {
    readonly text: string;
    readonly expression: boolean;
  } | null;
  /** Name of the resolved `EmbeddedImageDefinition`. */
  readonly definition: string | null;
  readonly capabilities: readonly string[];
  /** Placeholder reason; `null` when the picture can be displayed. */
  readonly reason: ImagePlaceholderReason | null;
}
/** Region remains in-place in source; never detached for regeneration. */
export interface PreservedRegion {
  readonly nodeId: string;
  readonly range: SourceRange;
  readonly reason: string;
  readonly namespaces: Readonly<Record<string, string>>;
}
export interface ReportProjection {
  readonly version: number;
  readonly namespace: string | null;
  readonly status: 'editable' | 'source-only' | 'invalid-source';
  readonly capabilities: readonly string[];
  readonly section: ReportSection | null;
  readonly textboxes: readonly Textbox[];
  readonly datasets: readonly LocalDataset[];
  readonly tables: readonly Table[];
  readonly images: readonly ImageItem[];
  readonly embeddedImages: readonly EmbeddedImageDefinition[];
  readonly preserved: readonly PreservedRegion[];
  readonly diagnostics: readonly Diagnostic[];
}
