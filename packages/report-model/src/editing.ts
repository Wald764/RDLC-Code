import type { SourceRange } from './document.js';

/** Host validates shape/version/capability/references; webviews cannot supply patches. */
export interface EditIntent {
  readonly requestId: string;
  readonly baseVersion: number;
  readonly targetId: string;
  readonly operation: 'setProperty';
  readonly payload: {
    readonly property: 'name' | 'text' | 'left' | 'top' | 'width' | 'height';
    readonly value: string;
  };
}
/** Sorted, non-overlapping, footprint-scoped; checked before one atomic WorkspaceEdit. */
export interface SourcePatch extends SourceRange {
  readonly version: number;
  readonly expected: string;
  readonly replacement: string;
}
export interface PatchPlan {
  readonly version: number;
  readonly patches: readonly SourcePatch[];
  readonly footprint: readonly SourceRange[];
  readonly namespaceDependencies: readonly {
    readonly nodeId: string;
    readonly prefix: string;
    readonly uri: string;
  }[];
}
