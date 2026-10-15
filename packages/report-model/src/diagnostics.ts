import type { SourceRange } from './document.js';

export type DiagnosticCategory =
  | 'malformed-xml'
  | 'invalid-value'
  | 'unsupported'
  | 'stale-edit'
  | 'preservation-risk';
export interface Diagnostic {
  readonly code: string;
  readonly category: DiagnosticCategory;
  readonly severity: 'error' | 'warning' | 'information';
  readonly range: SourceRange;
  readonly message: string;
  readonly correctiveAction: string;
  readonly blockedOperations: readonly string[];
  readonly itemId?: string;
  readonly property?: string;
  readonly citation?: string;
}
