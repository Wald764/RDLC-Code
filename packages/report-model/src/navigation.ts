import type { SourceRange } from './document.js';
import type { Bounds } from './scene.js';
import { sizeUnits, type SizeUnit } from './geometry.js';
import {
  authoringFields,
  type AuthoringAction,
  type AuthoringIntent,
} from './editing.js';
import { clipboardActions, type ClipboardAction } from './clipboard.js';

/** Actual syntax kinds; datasets/fields stay until the Data projection migration lands. */
export const structureKinds = [
  'report',
  'sections',
  'section',
  'body',
  'header',
  'footer',
  'textbox',
  'table',
  'table-body',
  'table-row',
  'table-cell',
  'row',
  'cell',
  'member',
  'member-header',
  'group',
  'dataset',
  'field',
  'container',
  'preserved',
] as const;
export interface StructureNode {
  /** Actual XML node ID in the accepted version; unique within snapshot. */
  readonly id: string;
  /** Emitted parent ID or null for root; no missing parent, cycle or >32-level chain. */
  readonly parentId: string | null;
  readonly kind: (typeof structureKinds)[number];
  /** Actual type/name or honest structural label; never evaluated content. */
  readonly label: string;
  /** Existing declared name or null; not an authorization to rename. */
  readonly name: string | null;
  /** Actual source range with finite integer 0 <= start <= end <= source.length. */
  readonly range: { readonly start: number; readonly end: number };
  /** Null or an explanation of preserved/opaque scope, including actual unsupported type where known. */
  readonly preservedReason: string | null;
}
export interface ReportStructure {
  /** Flat, source-ordered structural entries; maximum 2,000. */
  readonly nodes: readonly StructureNode[];
  /** True when entry/depth/available transport budgets prevent a complete projection; visible limitation and source access required. */
  readonly truncated: boolean;
}

/** Data kinds are displayed beside Structure; synthetic categories carry no node identity. */
export const dataKinds = [
  'dataset',
  'field',
  'parameter',
  'embedded-image',
  'data-source',
  'opaque',
] as const;
export const navigationKinds = [
  ...structureKinds,
  ...dataKinds.filter(
    (kind) => !(structureKinds as readonly string[]).includes(kind),
  ),
] as const;
export type NavigationKind = (typeof navigationKinds)[number];

/** Existing handler vocabulary; a recognized node kind never implies editability. */
export const navigationOperations = [
  'inspect',
  'source',
  'properties',
  'select',
  'clipboard',
  'delete',
  'author',
] as const;
export type NavigationOperation = (typeof navigationOperations)[number];
export interface NavigationCapability {
  readonly operation: NavigationOperation;
  /** False carries the visible refusal reason; true never carries one. */
  readonly eligible: boolean;
  readonly reason: string | null;
}
/** Actual node facts; flat parent-before-child arrays keep the JSON envelope shallow. */
export interface NavigationNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly sourceOrder: number;
  readonly range: SourceRange;
  readonly expandedName: string;
  readonly name: string | null;
  readonly kind: NavigationKind;
  readonly label: string;
  readonly opaqueReason: string | null;
  readonly capabilities: readonly NavigationCapability[];
  readonly details?: NavigationDetails;
  /** Optional accepted scene bounds; data/structural targets never synthesize one. */
  readonly bounds?: Bounds;
}
/** Closed inert metadata only; no expression, resource, connection or payload text. */
export interface NavigationDetails {
  readonly type?:
    | 'text'
    | 'Boolean'
    | 'Int32'
    | 'Int64'
    | 'decimal'
    | 'double'
    | 'date/time'
    | 'String'
    | 'Integer'
    | 'Float'
    | 'DateTime';
  readonly classification?: 'local' | 'mapped' | 'calculated' | 'unsupported';
  readonly mime?:
    | 'image/png'
    | 'image/jpeg'
    | 'image/gif'
    | 'image/bmp'
    | 'image/tiff'
    | 'image/svg+xml';
  readonly hasPayload?: boolean;
  readonly hasQuery?: boolean;
  readonly source?: 'inline' | 'shared' | 'unknown';
  readonly nullable?: boolean;
  readonly multiValue?: boolean;
  readonly allowBlank?: boolean;
  readonly hidden?: boolean;
}

function details(value: unknown): value is NavigationDetails {
  if (
    !record(value) ||
    !keys(value, [
      'type',
      'classification',
      'mime',
      'hasPayload',
      'hasQuery',
      'source',
      'nullable',
      'multiValue',
      'allowBlank',
      'hidden',
    ])
  )
    return false;
  return (
    (value.type === undefined ||
      [
        'text',
        'Boolean',
        'Int32',
        'Int64',
        'decimal',
        'double',
        'date/time',
        'String',
        'Integer',
        'Float',
        'DateTime',
      ].includes(value.type as string)) &&
    (value.classification === undefined ||
      ['local', 'mapped', 'calculated', 'unsupported'].includes(
        value.classification as string,
      )) &&
    (value.mime === undefined ||
      [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/bmp',
        'image/tiff',
        'image/svg+xml',
      ].includes(value.mime as string)) &&
    (value.source === undefined ||
      ['inline', 'shared', 'unknown'].includes(value.source as string)) &&
    [
      'hasPayload',
      'hasQuery',
      'nullable',
      'multiValue',
      'allowBlank',
      'hidden',
    ].every(
      (key) => value[key] === undefined || typeof value[key] === 'boolean',
    )
  );
}
export interface NavigationProjection {
  readonly nodes: readonly NavigationNode[];
  readonly truncated: boolean;
}
/** Both native projections share the 2,000 entry cap. */
export interface AcceptedNavigation {
  readonly version: number;
  readonly structure: NavigationProjection;
  readonly data: NavigationProjection;
}

/** Host-owned identity of one designer panel; generations only move forward. */
export interface ViewIdentity {
  readonly viewId: string;
  readonly documentLifetimeId: string;
  readonly contextGeneration: number;
}

export const selectionModes = ['empty', 'body', 'cell', 'structure'] as const;
export type NavigationSelection =
  | { readonly mode: 'empty' }
  | {
      readonly mode: 'body';
      readonly targetIds: readonly string[];
      readonly primaryId: string;
    }
  | { readonly mode: 'cell'; readonly targetId: string }
  | { readonly mode: 'structure'; readonly targetId: string };

export interface AcceptedSelectionMessage {
  readonly protocol: 2;
  readonly kind: 'acceptedSelection';
  readonly version: number;
  readonly viewId: string;
  /** Monotonic per view; older sequences never reach accepted state. */
  readonly sequence: number;
  /** Optional correlation with the native action that caused this state. */
  readonly requestId?: string;
  readonly selection: NavigationSelection;
}

export const nativeOperations = [
  'select',
  'properties',
  'source',
  'create',
  'clipboard',
  'author',
] as const;
export type NativeOperation = (typeof nativeOperations)[number];
export const createKinds = ['textbox', 'table', 'dataset'] as const;
export type CreateKind = (typeof createKinds)[number];

interface NativeActionBase {
  readonly protocol: 2;
  readonly kind: 'nativeAction';
  readonly requestId: string;
  readonly documentLifetimeId: string;
  readonly uri: string;
  readonly baseVersion: number;
  readonly viewId: string;
  readonly contextGeneration: number;
  /** Must equal the finite action discriminator. */
  readonly capability: NativeOperation;
  readonly targetIds: readonly string[];
}
export type NativeActionMessage = NativeActionBase &
  (
    | {
        readonly action: 'select';
        readonly primaryId: string;
        readonly additive: boolean;
      }
    | { readonly action: 'properties' }
    | { readonly action: 'source' }
    | { readonly action: 'create'; readonly create: CreateKind }
    | {
        readonly action: 'clipboard';
        readonly clipboard: ClipboardAction;
        readonly unit?: SizeUnit;
      }
    | {
        readonly action: 'author';
        readonly payload: AuthoringIntent['payload'];
      }
  );

export const actionStatuses = ['accepted', 'cancelled', 'refused'] as const;
export type ActionStatus = (typeof actionStatuses)[number];
export interface ActionOutcomeMessage {
  readonly protocol: 2;
  readonly kind: 'actionOutcome';
  readonly requestId: string;
  readonly baseVersion: number;
  readonly resultVersion: number;
  readonly status: ActionStatus;
  /** Required for cancelled/refused; absent for accepted. */
  readonly reason?: string;
  readonly selectionSequence: number;
}

const maxReason = 1024;
const maxLabel = 1024;
const maxExpandedName = 512;
const maxNodes = 2000;

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}
function nodeId(value: unknown, expectedVersion: number): value is string {
  return (
    id(value) && new RegExp(`^${expectedVersion}:[1-9][0-9]*$`).test(value)
  );
}
/** Closed identity; a snapshot may carry it, legacy snapshots omit it. */
export function validateViewIdentity(value: unknown): value is ViewIdentity {
  return (
    record(value) &&
    keys(value, ['viewId', 'documentLifetimeId', 'contextGeneration']) &&
    id(value.viewId) &&
    id(value.documentLifetimeId) &&
    version(value.contextGeneration)
  );
}
function control(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    )
      return true;
  }
  return false;
}
function text(
  value: unknown,
  max: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    (allowEmpty || value.length > 0) &&
    !control(value)
  );
}
function uri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) &&
    !control(value)
  );
}
function range(value: unknown, sourceLength?: number): boolean {
  if (
    !record(value) ||
    !keys(value, ['start', 'end']) ||
    !version(value.start) ||
    !version(value.end) ||
    value.end < value.start ||
    (sourceLength !== undefined && value.end > sourceLength)
  )
    return false;
  return true;
}
function bounds(value: unknown): value is Bounds {
  return (
    record(value) &&
    keys(value, ['left', 'top', 'width', 'height']) &&
    ['left', 'top', 'width', 'height'].every((key) =>
      Number.isFinite(value[key]),
    ) &&
    (value.left as number) >= 0 &&
    (value.top as number) >= 0 &&
    (value.width as number) > 0 &&
    (value.height as number) > 0
  );
}
function capabilities(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > navigationOperations.length)
    return false;
  const seen = new Set<string>();
  return value.every((capability) => {
    if (
      !record(capability) ||
      !keys(capability, ['operation', 'eligible', 'reason']) ||
      !navigationOperations.includes(capability.operation as never) ||
      typeof capability.eligible !== 'boolean' ||
      seen.has(capability.operation as string)
    )
      return false;
    seen.add(capability.operation as string);
    return capability.eligible
      ? capability.reason === null
      : text(capability.reason, maxReason);
  });
}
function navigationNode(
  value: unknown,
  expectedVersion: number,
  sourceLength?: number,
): value is NavigationNode {
  return (
    record(value) &&
    keys(value, [
      'id',
      'parentId',
      'sourceOrder',
      'range',
      'expandedName',
      'name',
      'kind',
      'label',
      'opaqueReason',
      'capabilities',
      'bounds',
      'details',
    ]) &&
    nodeId(value.id, expectedVersion) &&
    (value.parentId === null || nodeId(value.parentId, expectedVersion)) &&
    version(value.sourceOrder) &&
    range(value.range, sourceLength) &&
    text(value.expandedName, maxExpandedName) &&
    !/[<>]/.test(value.expandedName) &&
    (value.name === null || text(value.name, 256)) &&
    navigationKinds.includes(value.kind as never) &&
    text(value.label, maxLabel) &&
    (value.opaqueReason === null || text(value.opaqueReason, maxReason)) &&
    capabilities(value.capabilities) &&
    (value.details === undefined || details(value.details)) &&
    (value.bounds === undefined || bounds(value.bounds))
  );
}

/** Closed, parent-before-child, source-ordered and bounded navigation projection. */
export function validateNavigationProjection(
  value: unknown,
  expectedVersion: number,
  sourceLength?: number,
): value is NavigationProjection {
  if (
    !record(value) ||
    !keys(value, ['nodes', 'truncated']) ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > maxNodes
  )
    return false;
  const depths = new Map<string, number>();
  let start = -1;
  let order = -1;
  for (const node of value.nodes) {
    if (
      !navigationNode(node, expectedVersion, sourceLength) ||
      depths.has(node.id) ||
      node.sourceOrder < order ||
      node.range.start < start
    )
      return false;
    const depth =
      node.parentId === null ? 1 : (depths.get(node.parentId) ?? 99) + 1;
    if (depth > 32) return false;
    depths.set(node.id, depth);
    start = node.range.start;
    order = node.sourceOrder;
  }
  return true;
}

export function validateAcceptedNavigation(
  value: unknown,
  expectedVersion: number,
  sourceLength?: number,
): value is AcceptedNavigation {
  if (
    !record(value) ||
    !keys(value, ['version', 'structure', 'data']) ||
    value.version !== expectedVersion ||
    !validateNavigationProjection(
      value.structure,
      expectedVersion,
      sourceLength,
    ) ||
    !validateNavigationProjection(value.data, expectedVersion, sourceLength)
  )
    return false;
  const structure = value.structure as NavigationProjection;
  const data = value.data as NavigationProjection;
  return structure.nodes.length + data.nodes.length <= maxNodes;
}

export function validateNavigationSelection(
  value: unknown,
  expectedVersion: number,
): value is NavigationSelection {
  if (!record(value)) return false;
  switch (value.mode) {
    case 'empty':
      return keys(value, ['mode']);
    case 'body': {
      const ids = value.targetIds;
      return (
        keys(value, ['mode', 'targetIds', 'primaryId']) &&
        Array.isArray(ids) &&
        ids.length >= 1 &&
        ids.length <= 1000 &&
        ids.every((target) => nodeId(target, expectedVersion)) &&
        new Set(ids).size === ids.length &&
        nodeId(value.primaryId, expectedVersion) &&
        ids.includes(value.primaryId)
      );
    }
    case 'cell':
    case 'structure':
      return (
        keys(value, ['mode', 'targetId']) &&
        nodeId(value.targetId, expectedVersion)
      );
    default:
      return false;
  }
}

export function validateAcceptedSelection(
  value: unknown,
): value is AcceptedSelectionMessage {
  return (
    record(value) &&
    keys(value, [
      'protocol',
      'kind',
      'version',
      'viewId',
      'sequence',
      'requestId',
      'selection',
    ]) &&
    value.protocol === 2 &&
    value.kind === 'acceptedSelection' &&
    version(value.version) &&
    id(value.viewId) &&
    version(value.sequence) &&
    value.sequence >= 1 &&
    (value.requestId === undefined || id(value.requestId)) &&
    validateNavigationSelection(value.selection, value.version)
  );
}

function authoringPayload(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.action === 'string' &&
    Object.hasOwn(authoringFields, value.action) &&
    keys(value, [
      'action',
      ...authoringFields[value.action as AuthoringAction],
    ]) &&
    authoringFields[value.action as AuthoringAction].every((key) =>
      text(value[key], 2048, true),
    )
  );
}

function targets(
  value: Record<string, unknown>,
  minimum: number,
): value is Record<string, unknown> & {
  readonly targetIds: readonly string[];
} {
  const ids = value.targetIds;
  return (
    Array.isArray(ids) &&
    ids.length >= minimum &&
    ids.length <= 1000 &&
    ids.every((target) => nodeId(target, value.baseVersion as number)) &&
    new Set(ids).size === ids.length
  );
}

export function validateNativeAction(
  value: unknown,
): value is NativeActionMessage {
  if (
    !record(value) ||
    value.protocol !== 2 ||
    value.kind !== 'nativeAction' ||
    !id(value.requestId) ||
    !id(value.documentLifetimeId) ||
    !uri(value.uri) ||
    !version(value.baseVersion) ||
    !id(value.viewId) ||
    !version(value.contextGeneration) ||
    !nativeOperations.includes(value.capability as never) ||
    value.capability !== value.action
  )
    return false;
  const common = [
    'protocol',
    'kind',
    'requestId',
    'documentLifetimeId',
    'uri',
    'baseVersion',
    'viewId',
    'contextGeneration',
    'capability',
    'targetIds',
    'action',
  ];
  switch (value.action) {
    case 'select':
      return (
        keys(value, [...common, 'primaryId', 'additive']) &&
        targets(value, 1) &&
        nodeId(value.primaryId, value.baseVersion as number) &&
        (value.targetIds as readonly string[]).includes(value.primaryId) &&
        typeof value.additive === 'boolean'
      );
    case 'properties':
    case 'source':
      return (
        keys(value, common) && targets(value, 1) && value.targetIds.length === 1
      );
    case 'create':
      return (
        keys(value, [...common, 'create']) &&
        targets(value, 0) &&
        value.targetIds.length === 0 &&
        createKinds.includes(value.create as never)
      );
    case 'clipboard': {
      const action = value.clipboard as ClipboardAction;
      const selection = action !== 'paste';
      return (
        keys(value, [
          ...common,
          'clipboard',
          ...(action === 'paste' || action === 'duplicate' ? ['unit'] : []),
        ]) &&
        clipboardActions.includes(action) &&
        targets(value, selection ? 1 : 0) &&
        (selection || value.targetIds.length === 0) &&
        (!selection || value.targetIds.length >= 1) &&
        ((action !== 'paste' && action !== 'duplicate') ||
          sizeUnits.includes(value.unit as never))
      );
    }
    case 'author':
      return (
        keys(value, [...common, 'payload']) &&
        targets(value, 1) &&
        value.targetIds.length === 1 &&
        authoringPayload(value.payload)
      );
    default:
      return false;
  }
}

export function validateActionOutcome(
  value: unknown,
): value is ActionOutcomeMessage {
  if (
    !record(value) ||
    !keys(value, [
      'protocol',
      'kind',
      'requestId',
      'baseVersion',
      'resultVersion',
      'status',
      'reason',
      'selectionSequence',
    ]) ||
    value.protocol !== 2 ||
    value.kind !== 'actionOutcome' ||
    !id(value.requestId) ||
    !version(value.baseVersion) ||
    !version(value.resultVersion) ||
    value.resultVersion < value.baseVersion ||
    !actionStatuses.includes(value.status as never) ||
    !version(value.selectionSequence)
  )
    return false;
  return value.status === 'accepted'
    ? value.reason === undefined
    : text(value.reason, maxReason);
}
