import type { SourceRange } from './document.js';

/** Authored textbox value/style/geometry properties. FR-005. */
export const textboxProperties = [
  'name',
  'text',
  'left',
  'top',
  'width',
  'height',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'textAlign',
] as const;
export type TextboxProperty = (typeof textboxProperties)[number];
export const textboxStyleProperties = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'textAlign',
] as const;
export const textboxGeometryProperties = [
  'left',
  'top',
  'width',
  'height',
] as const;

/** Host validates shape/version/capability/references; webviews cannot supply patches. */
export interface TextboxIntent {
  readonly requestId: string;
  readonly baseVersion: number;
  readonly targetId: string;
  readonly operation: 'setProperty';
  readonly payload: {
    readonly property: TextboxProperty;
    readonly value: string;
  };
}

/** Closed authoring vocabulary; no XML, patches, file paths or data values. */
export const authoringFields = {
  createDataset: ['name'],
  renameDataset: ['name'],
  deleteDataset: [],
  createField: ['name', 'type'],
  renameField: ['name'],
  deleteField: [],
  setFieldType: ['type'],
  setPage: ['property', 'value'],
  createTextbox: ['name'],
  deleteTextbox: ['confirm'],
  createTable: ['name', 'dataset', 'field', 'width'],
  setTableProperty: ['property', 'value'],
  setColumnWidth: ['column', 'width'],
  setRowHeight: ['row', 'height'],
  deleteTable: ['confirm'],
  addColumn: ['field', 'width'],
  removeColumn: ['column'],
  addGroup: ['name', 'expression'],
  changeGroup: ['name', 'expression'],
  removeGroup: [],
  addTotal: ['field', 'scope', 'column'],
  changeTotal: ['field', 'scope', 'column', 'row'],
  removeTotal: ['row'],
} as const;
export type AuthoringAction = keyof typeof authoringFields;
type AuthoringPayload = {
  [K in AuthoringAction]: { readonly action: K } & {
    readonly [F in (typeof authoringFields)[K][number]]: string;
  };
}[AuthoringAction];
export interface AuthoringIntent {
  readonly requestId: string;
  readonly baseVersion: number;
  readonly targetId: string;
  readonly operation: 'author';
  readonly payload: AuthoringPayload;
}
export type EditIntent = TextboxIntent | AuthoringIntent;
export interface AuthoringRequest {
  readonly targetId: string;
  readonly payload: AuthoringIntent['payload'];
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
