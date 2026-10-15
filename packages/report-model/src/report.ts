import type { XmlNode } from './syntax.js';
import type { SourceRange } from './document.js';
import type { Diagnostic } from './diagnostics.js';

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
  readonly preserved: readonly PreservedRegion[];
  readonly diagnostics: readonly Diagnostic[];
}
