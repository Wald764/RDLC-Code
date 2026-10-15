import type { DocumentSnapshot, SourceRange } from './document.js';
import type { Diagnostic } from './diagnostics.js';

export interface ExpandedName {
  readonly namespaceUri: string;
  readonly localName: string;
}
/** Raw lexical form stays in source; unprefixed attributes have no default namespace. */
export interface XmlAttribute {
  readonly qualifiedName: string;
  readonly expandedName: ExpandedName;
  readonly nameRange: SourceRange;
  readonly valueRange: SourceRange;
  readonly range: SourceRange;
  readonly quote: '"' | "'";
  readonly value: string;
}
export type TokenKind =
  | 'bom'
  | 'declaration'
  | 'processing-instruction'
  | 'comment'
  | 'cdata'
  | 'text'
  | 'start-tag'
  | 'end-tag';
export interface XmlToken {
  readonly kind: TokenKind;
  readonly range: SourceRange;
}
/** UTF-16 zero-based half-open ranges; retained prefixes/scopes; IDs never enter XML. */
export interface XmlNode {
  readonly id: string;
  readonly qualifiedName: string;
  readonly expandedName: ExpandedName;
  readonly range: SourceRange;
  readonly openRange: SourceRange;
  readonly closeRange: SourceRange | null;
  readonly parentId: string | null;
  readonly children: readonly XmlNode[];
  readonly attributes: readonly XmlAttribute[];
  readonly namespaces: Readonly<Record<string, string>>;
  readonly text: string;
}
/** Complete lexical coverage including whitespace/PI/CDATA; never rewrite tokens. */
export interface XmlSyntaxDocument {
  readonly snapshot: DocumentSnapshot;
  readonly root: XmlNode | null;
  readonly tokens: readonly XmlToken[];
  readonly diagnostics: readonly Diagnostic[];
  readonly status: 'valid' | 'invalid-source' | 'source-only';
}
