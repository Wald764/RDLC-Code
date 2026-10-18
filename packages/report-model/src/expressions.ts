import type { SourceRange } from './document.js';

/** Known references block destructive changes; incomplete analysis blocks conservatively. */
export interface Reference {
  readonly kind: 'field' | 'dataset' | 'group' | 'report-item';
  readonly name: string;
  readonly range: SourceRange;
  /** Decoded range of the name operand alone, when it can be rewritten exactly. */
  readonly nameRange?: SourceRange;
  readonly confidence: 'static';
}
/** Never evaluated or translated to JS; unknown syntax stays opaque. */
export interface ExpressionValue {
  readonly text: string;
  readonly classification: 'literal' | 'expression';
  readonly references: readonly Reference[];
  readonly complete: boolean;
}
