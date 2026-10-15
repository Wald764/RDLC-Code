export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/** Every range/projection belongs to this version; VS Code owns the original file. */
export interface DocumentSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly source: string;
  readonly eol: '\n' | '\r\n';
  readonly encoding?: string;
}
