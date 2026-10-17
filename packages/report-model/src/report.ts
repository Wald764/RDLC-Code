import type { XmlNode } from './syntax.js';
import type { SourceRange } from './document.js';
import type { Diagnostic } from './diagnostics.js';

export const RDL_2016 =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';

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
  readonly context: 'body' | 'table-cell';
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
  readonly preserved: readonly PreservedRegion[];
  readonly diagnostics: readonly Diagnostic[];
}
