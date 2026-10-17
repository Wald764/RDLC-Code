import { textboxProperties } from './editing.js';
import type { EditIntent } from './editing.js';
import type { Diagnostic } from './diagnostics.js';
import type { DesignScene } from './scene.js';
import type { ReportProjection } from './report.js';

export type ClientMessage =
  | { readonly protocol: 1; readonly kind: 'ready' }
  | ({ readonly protocol: 1; readonly kind: 'edit' } & EditIntent)
  | {
      readonly protocol: 1;
      readonly kind: 'openSource';
      readonly version: number;
      readonly targetId?: string;
    };
export type HostMessage =
  | {
      readonly protocol: 1;
      readonly kind: 'snapshot';
      readonly version: number;
      readonly projection: Pick<
        ReportProjection,
        'status' | 'capabilities' | 'diagnostics'
      >;
      readonly scene: DesignScene | null;
    }
  | {
      readonly protocol: 1;
      readonly kind: 'editResult';
      readonly version: number;
      readonly requestId: string;
      readonly accepted: boolean;
      readonly reason: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly protocol: 1;
      readonly kind: 'protocolError';
      readonly supportedVersion: 1;
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
function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
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
    (value.height as number) >= 0
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
    ]) &&
    id(value.id) &&
    bounds(value.bounds) &&
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
function nullableStrings(value: unknown, fields: readonly string[]): boolean {
  return (
    record(value) &&
    keys(value, fields) &&
    fields.every((field) => value[field] === null || string(value[field]))
  );
}
function scene(value: unknown, expectedVersion: number): boolean {
  return (
    value === null ||
    (record(value) &&
      keys(value, ['version', 'page', 'body', 'items']) &&
      value.version === expectedVersion &&
      bounds(value.page) &&
      bounds(value.body) &&
      Array.isArray(value.items) &&
      value.items.every(sceneItem))
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
    value.protocol !== 1
  )
    return null;
  let valid = false;
  switch (value.kind) {
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
          'targetId',
          'operation',
          'payload',
        ]) &&
        id(value.requestId) &&
        version(value.baseVersion) &&
        id(value.targetId) &&
        value.operation === 'setProperty' &&
        record(value.payload) &&
        keys(value.payload, ['property', 'value']) &&
        (textboxProperties as readonly string[]).includes(
          String(value.payload.property),
        ) &&
        string(value.payload.value);
      break;
    case 'openSource':
      valid =
        keys(value, ['protocol', 'kind', 'version', 'targetId']) &&
        version(value.version) &&
        (value.targetId === undefined || id(value.targetId));
      break;
    case 'protocolError':
      valid =
        keys(value, ['protocol', 'kind', 'supportedVersion', 'reason']) &&
        value.supportedVersion === 1 &&
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
        ]) &&
        version(value.version) &&
        id(value.requestId) &&
        typeof value.accepted === 'boolean' &&
        string(value.reason) &&
        diagnostics(value.diagnostics);
      break;
    case 'snapshot':
      valid =
        keys(value, ['protocol', 'kind', 'version', 'projection', 'scene']) &&
        version(value.version) &&
        record(value.projection) &&
        keys(value.projection, ['status', 'capabilities', 'diagnostics']) &&
        ['editable', 'source-only', 'invalid-source'].includes(
          String(value.projection.status),
        ) &&
        strings(value.projection.capabilities) &&
        diagnostics(value.projection.diagnostics) &&
        scene(value.scene, value.version);
      break;
  }
  return valid ? (value as unknown as ProtocolMessage) : null;
}
