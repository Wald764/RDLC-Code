import {
  authoringFields,
  textboxProperties,
  resizeHandles,
  alignModes,
  type AuthoringAction,
} from './editing.js';
import type { EditIntent, TargetMapping } from './editing.js';
import type { Diagnostic } from './diagnostics.js';
import type { DesignScene } from './scene.js';
import type { ReportProjection } from './report.js';
import { sizeUnits, type SizeUnit } from './geometry.js';
import { clipboardActions, type ClipboardAction } from './clipboard.js';
import {
  structureKinds,
  validateAcceptedNavigation,
  validateAcceptedSelection,
  validateActionOutcome,
  validateNativeAction,
  validateViewIdentity,
  type AcceptedNavigation,
  type AcceptedSelectionMessage,
  type ActionOutcomeMessage,
  type NativeActionMessage,
  type ReportStructure,
  type ViewIdentity,
} from './navigation.js';
export { structureKinds, validateViewIdentity } from './navigation.js';
export type {
  AcceptedNavigation,
  AcceptedSelectionMessage,
  ActionOutcomeMessage,
  ActionStatus,
  CreateKind,
  NavigationCapability,
  NavigationKind,
  NavigationNode,
  NavigationOperation,
  NavigationProjection,
  NavigationSelection,
  NativeActionMessage,
  NativeOperation,
  ReportStructure,
  StructureNode,
  ViewIdentity,
} from './navigation.js';

export interface AuthoringState {
  readonly id: string;
  readonly page: Readonly<Record<string, string>>;
  readonly datasets: readonly {
    readonly id: string;
    readonly name: string;
    readonly fields: readonly {
      readonly id: string;
      readonly name: string;
      readonly type: string | null;
    }[];
  }[];
  readonly tables: readonly {
    readonly id: string;
    readonly name: string;
    readonly dataset: string | null;
    readonly structural: boolean;
    readonly reason: string | null;
    readonly columns: number;
    readonly rows: readonly {
      readonly cells: readonly { readonly id: string; readonly text: string }[];
      readonly total: boolean;
    }[];
    readonly groups: readonly {
      readonly id: string;
      readonly name: string;
      readonly expression: string;
    }[];
  }[];
}

export interface HistoryRequestMessage {
  readonly protocol: 2;
  readonly kind: 'history';
  readonly requestId: string;
  readonly baseVersion: number;
  readonly action: 'undo' | 'redo';
}
export interface HistoryResultMessage
  extends Omit<HistoryRequestMessage, 'kind'> {
  readonly kind: 'historyResult';
  readonly resultVersion: number;
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason?: string;
}

export type ClientMessage =
  | { readonly protocol: 2; readonly kind: 'ready' }
  | ({
      readonly protocol: 2;
      readonly kind: 'edit';
      /** Optional correlation with the native action that opened this draft. */
      readonly nativeRequestId?: string;
    } & EditIntent)
  | {
      readonly protocol: 2;
      readonly kind: 'openSource';
      readonly version: number;
      readonly targetId?: string;
    }
  | ClipboardRequestMessage
  | HistoryRequestMessage
  | AcceptedSelectionMessage
  | ActionOutcomeMessage;
/** Selection-bearing actions name body roots; Paste carries no XML or manifest. */
export interface ClipboardRequestMessage {
  readonly protocol: 2;
  readonly kind: 'clipboard';
  readonly requestId: string;
  readonly baseVersion: number;
  readonly action: ClipboardAction;
  readonly targetIds?: readonly string[];
  readonly unit?: SizeUnit;
  /** Optional correlation with the native action that requested this clipboard work. */
  readonly nativeRequestId?: string;
}
export type HostMessage =
  | HistoryResultMessage
  | NativeActionMessage
  | {
      readonly protocol: 2;
      readonly kind: 'nativeCancel';
      readonly requestId: string;
      readonly baseVersion: number;
      readonly reason: string;
    }
  | {
      readonly protocol: 2;
      readonly kind: 'snapshot';
      readonly version: number;
      readonly projection: Pick<
        ReportProjection,
        'status' | 'capabilities' | 'diagnostics'
      >;
      readonly scene: DesignScene | null;
      readonly sourceLength?: number;
      readonly structure?: ReportStructure;
      readonly navigation?: AcceptedNavigation;
      /** Bound designer identity; omitted by legacy snapshots. */
      readonly viewBinding?: ViewIdentity;
      readonly authoring?: AuthoringState | null;
    }
  | {
      readonly protocol: 2;
      readonly kind: 'editResult';
      readonly version: number;
      readonly baseVersion: number;
      readonly changed: boolean;
      readonly mappings: readonly TargetMapping[];
      readonly requestId: string;
      readonly accepted: boolean;
      readonly reason: string;
      readonly diagnostics: readonly Diagnostic[];
      /** Accepted creations only: the item the host created and named in `version`. */
      readonly created?: { readonly id: string; readonly name: string };
    }
  | {
      readonly protocol: 2;
      readonly kind: 'clipboardResult';
      readonly requestId: string;
      readonly action: ClipboardAction;
      readonly version: number;
      readonly baseVersion: number;
      readonly accepted: boolean;
      readonly changed: boolean;
      readonly reason: string;
      /** Result-version IDs of inserted roots (Paste/Duplicate). */
      readonly inserted: readonly string[];
      /** Base-version IDs of removed roots (Cut). */
      readonly removed: readonly string[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly protocol: 2;
      readonly kind: 'protocolError';
      readonly supportedVersion: 2;
      readonly reason: string;
    };
export type ProtocolMessage = ClientMessage | HostMessage;

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
/** CLS-compliant report item name (MS-RDL 2.16.1), bounded for transport. */
function reportName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*$/u.test(value)
  );
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
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function layout(value: Record<string, unknown>, baseVersion: number): boolean {
  const ids = value.targetIds;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 1000 ||
    !ids.every((target) => nodeId(target, baseVersion)) ||
    new Set(ids).size !== ids.length ||
    !sizeUnits.includes(value.unit as never)
  )
    return false;
  const common = ['action', 'targetIds', 'unit'];
  switch (value.action) {
    case 'move':
      return (
        keys(value, [...common, 'dxPt', 'dyPt']) &&
        finite(value.dxPt) &&
        finite(value.dyPt)
      );
    case 'resize': {
      if (ids.length !== 1 || !resizeHandles.includes(value.handle as never))
        return false;
      const handle = value.handle as string;
      const x = /[ew]/.test(handle);
      const y = /[ns]/.test(handle);
      return (
        keys(value, [
          ...common,
          'handle',
          ...(x ? ['xPt'] : []),
          ...(y ? ['yPt'] : []),
        ]) &&
        (!x || (finite(value.xPt) && value.xPt >= 0)) &&
        (!y || (finite(value.yPt) && value.yPt >= 0))
      );
    }
    case 'align':
      return (
        ids.length >= 2 &&
        keys(value, [...common, 'primaryId', 'mode']) &&
        string(value.primaryId) &&
        ids.includes(value.primaryId) &&
        alignModes.includes(value.mode as never)
      );
    case 'distribute':
      return (
        ids.length >= 3 &&
        keys(value, [...common, 'axis']) &&
        ['horizontal', 'vertical'].includes(String(value.axis))
      );
    default:
      return false;
  }
}
function string(value: unknown): value is string {
  return typeof value === 'string';
}
function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every(string);
}
function range(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['start', 'end']) &&
    version(value.start) &&
    version(value.end) &&
    value.end >= value.start
  );
}
function diagnostics(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (d) =>
        record(d) &&
        keys(d, [
          'code',
          'category',
          'severity',
          'range',
          'message',
          'correctiveAction',
          'blockedOperations',
          'itemId',
          'property',
          'citation',
        ]) &&
        string(d.code) &&
        [
          'malformed-xml',
          'invalid-value',
          'unsupported',
          'stale-edit',
          'preservation-risk',
        ].includes(String(d.category)) &&
        ['error', 'warning', 'information'].includes(String(d.severity)) &&
        range(d.range) &&
        string(d.message) &&
        string(d.correctiveAction) &&
        strings(d.blockedOperations) &&
        ['itemId', 'property', 'citation'].every(
          (key) => d[key] === undefined || string(d[key]),
        ),
    )
  );
}
function bounds(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['left', 'top', 'width', 'height']) &&
    ['left', 'top', 'width', 'height'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    ) &&
    (value.width as number) >= 0 &&
    (value.height as number) >= 0 &&
    (value.left as number) >= 0 &&
    (value.top as number) >= 0
  );
}
function sceneItem(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, [
      'id',
      'bounds',
      'label',
      'placeholder',
      'name',
      'text',
      'geometry',
      'style',
      'capabilities',
      'kind',
      'parentTableId',
      'xmlCellId',
      'sourceOrder',
      'zIndex',
      'resolvedGeometry',
      'operations',
    ]) &&
    id(value.id) &&
    (value.bounds === null ||
      (bounds(value.bounds) &&
        (value.bounds as Record<string, number>).width! > 0 &&
        (value.bounds as Record<string, number>).height! > 0)) &&
    (value.kind === undefined ||
      ['textbox', 'table', 'cell', 'preserved'].includes(String(value.kind))) &&
    (value.parentTableId === undefined ||
      (value.kind === 'cell' && id(value.parentTableId))) &&
    (value.xmlCellId === undefined ||
      (value.kind === 'cell' &&
        id(value.xmlCellId) &&
        String(value.xmlCellId).split(':')[0] ===
          String(value.id).split(':')[0])) &&
    (value.sourceOrder === undefined || version(value.sourceOrder)) &&
    (value.zIndex === undefined || version(value.zIndex)) &&
    (value.resolvedGeometry === undefined ||
      resolvedGeometry(value.resolvedGeometry)) &&
    (value.operations === undefined || operations(value.operations)) &&
    string(value.label) &&
    typeof value.placeholder === 'boolean' &&
    (value.name === undefined || value.name === null || string(value.name)) &&
    (value.text === undefined || value.text === null || string(value.text)) &&
    (value.capabilities === undefined || strings(value.capabilities)) &&
    (value.geometry === undefined ||
      value.geometry === null ||
      nullableStrings(value.geometry, ['left', 'top', 'width', 'height'])) &&
    (value.style === undefined ||
      value.style === null ||
      nullableStrings(value.style, [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'color',
        'textAlign',
      ]))
  );
}
function resolvedGeometry(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['left', 'top', 'width', 'height']) &&
    ['left', 'top', 'width', 'height'].every((key) => {
      const property = value[key];
      return (
        record(property) &&
        keys(property, ['raw', 'unit', 'provenance', 'points']) &&
        (property.raw === null || string(property.raw)) &&
        (property.unit === null ||
          sizeUnits.includes(property.unit as never)) &&
        (property.provenance === 'unknown'
          ? property.points === null
          : ['explicit', 'derived'].includes(String(property.provenance)) &&
            finite(property.points) &&
            (['width', 'height'].includes(key)
              ? property.points > 0
              : property.points >= 0)) &&
        (property.provenance !== 'derived' || property.raw === null) &&
        (property.provenance !== 'explicit' || string(property.raw))
      );
    })
  );
}
function operations(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['moveX', 'moveY', 'resizeX', 'resizeY']) &&
    ['moveX', 'moveY', 'resizeX', 'resizeY'].every((key) => {
      const operation = value[key];
      return (
        record(operation) &&
        keys(operation, ['eligible', 'reason']) &&
        typeof operation.eligible === 'boolean' &&
        (operation.eligible
          ? operation.reason === null
          : string(operation.reason))
      );
    })
  );
}
function nullableStrings(value: unknown, fields: readonly string[]): boolean {
  return (
    record(value) &&
    keys(value, fields) &&
    fields.every((field) => value[field] === null || string(value[field]))
  );
}
function scene(value: unknown, expectedVersion: number): boolean {
  if (value === null) return true;
  if (!record(value)) return false;
  const items = value.items;
  return (
    keys(value, ['version', 'page', 'body', 'items']) &&
    value.version === expectedVersion &&
    bounds(value.page) &&
    bounds(value.body) &&
    Array.isArray(items) &&
    items.every(sceneItem) &&
    new Set(items.map((item) => item.id)).size === items.length &&
    items.every(
      (item) =>
        item.kind === undefined ||
        (nodeId(item.id, expectedVersion) &&
          (item.kind !== 'cell' ||
            items.some(
              (parent: Record<string, unknown>) =>
                parent.kind === 'table' && parent.id === item.parentTableId,
            ))),
    )
  );
}

function authoring(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return (
    record(value) &&
    keys(value, ['id', 'page', 'datasets', 'tables']) &&
    id(value.id) &&
    record(value.page) &&
    Object.keys(value.page).every(
      (key) =>
        [
          'width',
          'height',
          'top',
          'right',
          'bottom',
          'left',
          'bodyWidth',
          'bodyHeight',
        ].includes(key) && string((value.page as Record<string, unknown>)[key]),
    ) &&
    Array.isArray(value.datasets) &&
    value.datasets.every(
      (dataset) =>
        record(dataset) &&
        keys(dataset, ['id', 'name', 'fields']) &&
        id(dataset.id) &&
        string(dataset.name) &&
        Array.isArray(dataset.fields) &&
        dataset.fields.every(
          (field) =>
            record(field) &&
            keys(field, ['id', 'name', 'type']) &&
            id(field.id) &&
            string(field.name) &&
            (field.type === null || string(field.type)),
        ),
    ) &&
    Array.isArray(value.tables) &&
    value.tables.every(
      (table) =>
        record(table) &&
        keys(table, [
          'id',
          'name',
          'dataset',
          'structural',
          'reason',
          'columns',
          'rows',
          'groups',
        ]) &&
        id(table.id) &&
        string(table.name) &&
        (table.dataset === null || string(table.dataset)) &&
        typeof table.structural === 'boolean' &&
        (table.reason === null || string(table.reason)) &&
        version(table.columns) &&
        Array.isArray(table.rows) &&
        table.rows.every(
          (row) =>
            record(row) &&
            keys(row, ['cells', 'total']) &&
            typeof row.total === 'boolean' &&
            Array.isArray(row.cells) &&
            row.cells.every(
              (cell) =>
                record(cell) &&
                keys(cell, ['id', 'text']) &&
                id(cell.id) &&
                string(cell.text),
            ),
        ) &&
        Array.isArray(table.groups) &&
        table.groups.every(
          (group) =>
            record(group) &&
            keys(group, ['id', 'name', 'expression']) &&
            id(group.id) &&
            string(group.name) &&
            string(group.expression),
        ),
    )
  );
}

export function validateMessage(value: unknown): ProtocolMessage | null {
  // Host snapshots carry a full scene; client intents retain the smaller budget.
  const snapshot = record(value) && value.kind === 'snapshot';
  let nodes = 0;
  const plainJson = (input: unknown, depth: number): boolean => {
    if (++nodes > (snapshot ? 131072 : 8192) || depth > 20) return false;
    if (
      input === null ||
      typeof input === 'boolean' ||
      typeof input === 'string'
    )
      return true;
    if (typeof input === 'number') return Number.isFinite(input);
    if (Array.isArray(input))
      return input.every((child) => plainJson(child, depth + 1));
    return (
      record(input) &&
      Object.keys(input).every(
        (key) =>
          !['__proto__', 'constructor', 'prototype'].includes(key) &&
          plainJson(input[key], depth + 1),
      )
    );
  };
  if (
    !plainJson(value, 0) ||
    new TextEncoder().encode(JSON.stringify(value)).length >
      (snapshot ? 8 * 1024 * 1024 : 65536) ||
    !record(value) ||
    value.protocol !== 2
  )
    return null;
  let valid = false;
  switch (value.kind) {
    case 'nativeAction':
      valid = validateNativeAction(value);
      break;
    case 'nativeCancel':
      valid =
        keys(value, [
          'protocol',
          'kind',
          'requestId',
          'baseVersion',
          'reason',
        ]) &&
        id(value.requestId) &&
        version(value.baseVersion) &&
        string(value.reason) &&
        value.reason.length > 0 &&
        value.reason.length <= 2048;
      break;
    case 'acceptedSelection':
      valid = validateAcceptedSelection(value);
      break;
    case 'actionOutcome':
      valid = validateActionOutcome(value);
      break;
    case 'history':
    case 'historyResult': {
      const result = value.kind === 'historyResult';
      valid =
        keys(value, [
          'protocol',
          'kind',
          'requestId',
          'baseVersion',
          'action',
          ...(result ? ['resultVersion', 'accepted', 'changed', 'reason'] : []),
        ]) &&
        id(value.requestId) &&
        version(value.baseVersion) &&
        ['undo', 'redo'].includes(String(value.action)) &&
        (!result ||
          (version(value.resultVersion) &&
            value.resultVersion >= value.baseVersion &&
            typeof value.accepted === 'boolean' &&
            typeof value.changed === 'boolean' &&
            value.changed === value.resultVersion > value.baseVersion &&
            (value.reason === undefined || string(value.reason))));
      break;
    }
    case 'ready':
      valid = keys(value, ['protocol', 'kind']);
      break;
    case 'edit':
      valid =
        keys(value, [
          'protocol',
          'kind',
          'requestId',
          'baseVersion',
          'nativeRequestId',
          ...(value.operation === 'layout' ? [] : ['targetId']),
          'operation',
          'payload',
        ]) &&
        id(value.requestId) &&
        version(value.baseVersion) &&
        (value.nativeRequestId === undefined || id(value.nativeRequestId)) &&
        (value.operation === 'layout' || id(value.targetId)) &&
        record(value.payload) &&
        ((value.operation === 'layout' &&
          layout(value.payload, value.baseVersion as number)) ||
          (value.operation === 'setProperty' &&
            keys(value.payload, ['property', 'value']) &&
            (textboxProperties as readonly string[]).includes(
              String(value.payload.property),
            ) &&
            string(value.payload.value)) ||
          (value.operation === 'author' &&
            string(value.payload.action) &&
            Object.hasOwn(authoringFields, value.payload.action) &&
            keys(value.payload, [
              'action',
              ...authoringFields[value.payload.action as AuthoringAction],
            ]) &&
            authoringFields[value.payload.action as AuthoringAction].every(
              (key) => string((value.payload as Record<string, unknown>)[key]),
            )));
      break;
    case 'clipboard': {
      const action = value.action as ClipboardAction;
      const selection = action !== 'paste';
      const ids = value.targetIds;
      valid =
        clipboardActions.includes(action) &&
        keys(value, [
          'protocol',
          'kind',
          'requestId',
          'baseVersion',
          'nativeRequestId',
          'action',
          ...(selection ? ['targetIds'] : []),
          ...(action === 'paste' || action === 'duplicate' ? ['unit'] : []),
        ]) &&
        id(value.requestId) &&
        version(value.baseVersion) &&
        (value.nativeRequestId === undefined || id(value.nativeRequestId)) &&
        (!selection ||
          (Array.isArray(ids) &&
            ids.length >= 1 &&
            ids.length <= 1000 &&
            ids.every((target) =>
              nodeId(target, value.baseVersion as number),
            ) &&
            new Set(ids).size === ids.length)) &&
        ((action !== 'paste' && action !== 'duplicate') ||
          sizeUnits.includes(value.unit as never));
      break;
    }
    case 'clipboardResult': {
      const action = value.action as ClipboardAction;
      const list = (input: unknown, expected: number, allowed: boolean) =>
        Array.isArray(input) &&
        input.length <= 1000 &&
        (allowed || input.length === 0) &&
        input.every((entry) => nodeId(entry, expected)) &&
        new Set(input).size === input.length;
      valid =
        clipboardActions.includes(action) &&
        keys(value, [
          'protocol',
          'kind',
          'requestId',
          'action',
          'version',
          'baseVersion',
          'accepted',
          'changed',
          'reason',
          'inserted',
          'removed',
          'diagnostics',
        ]) &&
        id(value.requestId) &&
        version(value.version) &&
        version(value.baseVersion) &&
        value.version >= value.baseVersion &&
        typeof value.accepted === 'boolean' &&
        typeof value.changed === 'boolean' &&
        (!value.changed ||
          (value.accepted && value.version > value.baseVersion)) &&
        (!value.accepted ||
          value.changed ||
          value.version === value.baseVersion) &&
        (action !== 'copy' || !value.changed) &&
        list(
          value.inserted,
          value.version,
          value.changed === true &&
            (action === 'paste' || action === 'duplicate'),
        ) &&
        list(
          value.removed,
          value.baseVersion,
          value.changed === true && action === 'cut',
        ) &&
        string(value.reason) &&
        diagnostics(value.diagnostics);
      break;
    }
    case 'openSource':
      valid =
        keys(value, ['protocol', 'kind', 'version', 'targetId']) &&
        version(value.version) &&
        (value.targetId === undefined || id(value.targetId));
      break;
    case 'protocolError':
      valid =
        keys(value, ['protocol', 'kind', 'supportedVersion', 'reason']) &&
        value.supportedVersion === 2 &&
        string(value.reason);
      break;
    case 'editResult':
      valid =
        keys(value, [
          'protocol',
          'kind',
          'version',
          'requestId',
          'accepted',
          'reason',
          'diagnostics',
          'baseVersion',
          'changed',
          'mappings',
          'created',
        ]) &&
        version(value.version) &&
        version(value.baseVersion) &&
        value.version >= value.baseVersion &&
        typeof value.changed === 'boolean' &&
        (!value.changed ||
          (value.accepted === true && value.version > value.baseVersion)) &&
        (!value.accepted ||
          value.changed ||
          value.version === value.baseVersion) &&
        mappings(
          value.mappings,
          value.baseVersion,
          value.version,
          value.accepted === true,
        ) &&
        (value.changed ||
          !value.accepted ||
          (value.mappings as TargetMapping[]).every(
            (mapping) => mapping.sourceId === mapping.resultId,
          )) &&
        id(value.requestId) &&
        typeof value.accepted === 'boolean' &&
        string(value.reason) &&
        diagnostics(value.diagnostics) &&
        (value.created === undefined ||
          (value.changed === true &&
            !!value.created &&
            typeof value.created === 'object' &&
            keys(value.created as Record<string, unknown>, ['id', 'name']) &&
            nodeId(
              (value.created as Record<string, unknown>).id,
              value.version as number,
            ) &&
            reportName((value.created as Record<string, unknown>).name)));
      break;
    case 'snapshot':
      valid =
        keys(value, [
          'protocol',
          'kind',
          'version',
          'projection',
          'scene',
          'authoring',
          'sourceLength',
          'structure',
          'navigation',
          'viewBinding',
        ]) &&
        version(value.version) &&
        record(value.projection) &&
        keys(value.projection, ['status', 'capabilities', 'diagnostics']) &&
        ['editable', 'source-only', 'invalid-source'].includes(
          String(value.projection.status),
        ) &&
        strings(value.projection.capabilities) &&
        diagnostics(value.projection.diagnostics) &&
        scene(value.scene, value.version) &&
        authoring(value.authoring) &&
        (value.sourceLength === undefined || version(value.sourceLength)) &&
        (value.viewBinding === undefined ||
          validateViewIdentity(value.viewBinding)) &&
        (value.structure === undefined ||
          (version(value.sourceLength) &&
            structure(value.structure, value.version, value.sourceLength))) &&
        (value.navigation === undefined ||
          (version(value.sourceLength) &&
            validateAcceptedNavigation(
              value.navigation,
              value.version,
              value.sourceLength,
            ) &&
            (!value.structure ||
              (value.structure as ReportStructure).nodes.length +
                (value.navigation as AcceptedNavigation).structure.nodes
                  .length +
                (value.navigation as AcceptedNavigation).data.nodes.length <=
                2000)));
      break;
  }
  return valid ? (value as unknown as ProtocolMessage) : null;
}

function structure(
  value: unknown,
  expectedVersion: number,
  sourceLength: number,
): boolean {
  if (
    !record(value) ||
    !keys(value, ['nodes', 'truncated']) ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 2000
  )
    return false;
  const depths = new Map<string, number>();
  let start = -1;
  for (const node of value.nodes) {
    if (
      !record(node) ||
      !keys(node, [
        'id',
        'parentId',
        'kind',
        'label',
        'name',
        'range',
        'preservedReason',
      ]) ||
      !nodeId(node.id, expectedVersion) ||
      depths.has(node.id) ||
      !structureKinds.includes(node.kind as never) ||
      !string(node.label) ||
      !(node.name === null || string(node.name)) ||
      !(node.preservedReason === null || string(node.preservedReason)) ||
      !range(node.range)
    )
      return false;
    const r = node.range as { start: number; end: number };
    if (r.start < start || r.end > sourceLength) return false;
    const depth =
      node.parentId === null
        ? 1
        : typeof node.parentId === 'string'
          ? (depths.get(node.parentId) ?? 99) + 1
          : 99;
    if (depth > 32) return false;
    depths.set(node.id, depth);
    start = r.start;
  }
  return true;
}

function mappings(
  value: unknown,
  baseVersion: number,
  resultVersion: number,
  accepted: boolean,
): boolean {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    (!accepted && value.length > 0)
  )
    return false;
  const sources = new Set<string>();
  const results = new Set<string>();
  return value.every((entry) => {
    if (
      !record(entry) ||
      !keys(entry, ['sourceId', 'resultId']) ||
      !nodeId(entry.sourceId, baseVersion) ||
      !(entry.resultId === null || nodeId(entry.resultId, resultVersion)) ||
      sources.has(entry.sourceId) ||
      (entry.resultId !== null && results.has(entry.resultId))
    )
      return false;
    sources.add(entry.sourceId);
    if (entry.resultId !== null) results.add(entry.resultId);
    return true;
  });
}
