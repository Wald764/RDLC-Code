import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage } from '@rdlc/report-model/protocol';
import { DocumentBinding } from './protocol.js';

const edit = {
  protocol: 1,
  kind: 'edit',
  requestId: 'r1',
  baseVersion: 2,
  targetId: '2:1',
  operation: 'setProperty',
  payload: { property: 'text', value: 'safe <text>' },
};
test('protocol v1 accepts only bounded plain known envelopes', () => {
  assert.ok(validateMessage({ protocol: 1, kind: 'ready' }));
  assert.ok(validateMessage(edit));
  assert.ok(
    validateMessage({
      protocol: 1,
      kind: 'openSource',
      version: 2,
      targetId: '2:1',
    }),
  );
  assert.ok(
    validateMessage({
      protocol: 1,
      kind: 'editResult',
      version: 2,
      requestId: 'r1',
      accepted: false,
      reason: 'STALE',
      diagnostics: [],
    }),
  );
  assert.ok(
    validateMessage({
      protocol: 1,
      kind: 'protocolError',
      supportedVersion: 1,
      reason: 'Unsupported protocol',
    }),
  );
  for (const value of [
    null,
    [],
    { ...edit, protocol: 2 },
    { ...edit, filePath: '/secret' },
    { ...edit, patches: [] },
    { ...edit, operation: 'execute' },
    { ...edit, baseVersion: NaN },
    { ...edit, baseVersion: Infinity },
    { ...edit, baseVersion: -1 },
    { ...edit, payload: { property: 'text', value: 'x'.repeat(65537) } },
    { ...edit, payload: { property: 'text', value: 1 } },
    { ...edit, payload: { property: 'text', value: 'x', xml: '<a/>' } },
    Object.assign(new Date(), edit),
  ])
    assert.equal(validateMessage(value), null);
});

test('snapshot scenes accept only finite local geometry and descriptive labels', () => {
  const bounds = { left: 0, top: 0, width: 96, height: 96 };
  const message = {
    protocol: 1,
    kind: 'snapshot',
    version: 2,
    projection: {
      status: 'source-only',
      capabilities: ['source'],
      diagnostics: [],
    },
    scene: {
      version: 2,
      page: bounds,
      body: bounds,
      items: [
        { id: '2:1', bounds, label: '<script> is text', placeholder: true },
      ],
    },
  };
  assert.ok(validateMessage(message));
  assert.equal(
    validateMessage({ ...message, scene: { ...message.scene, version: 1 } }),
    null,
  );
  assert.equal(
    validateMessage({
      ...message,
      scene: { ...message.scene, page: { ...bounds, width: Infinity } },
    }),
    null,
  );
  assert.equal(
    validateMessage({
      ...message,
      scene: { ...message.scene, url: 'https://invalid.test' },
    }),
    null,
  );
  assert.equal(
    validateMessage({
      ...message,
      projection: { ...message.projection, diagnostics: [{}] },
    }),
    null,
  );
  const recursive: Record<string, unknown> = {};
  recursive.self = recursive;
  assert.equal(validateMessage(recursive), null);
});
test('host binds IDs, versions, handshake, capability and request IDs to one document', () => {
  const a = new DocumentBinding('file:a', 2, ['2:1'], ['setProperty']);
  const b = new DocumentBinding('file:b', 2, ['2:2'], ['setProperty']);
  assert.equal(a.receive(edit).ok, false);
  assert.ok(a.receive({ protocol: 1, kind: 'ready' }).ok);
  assert.ok(b.receive({ protocol: 1, kind: 'ready' }).ok);
  assert.equal(b.receive(edit).ok, false);
  assert.ok(a.receive(edit).ok);
  assert.equal(a.receive(edit).ok, false);
  a.update(3, ['3:1'], []);
  assert.equal(a.receive({ ...edit, requestId: 'r2' }).ok, false);
  assert.equal(
    a.receive({ ...edit, requestId: 'r3', baseVersion: 3, targetId: '3:1' }).ok,
    false,
  );
  assert.equal(
    a.receive({ protocol: 1, kind: 'openSource', version: 2, targetId: '2:1' })
      .ok,
    false,
  );
  assert.ok(a.receive({ protocol: 1, kind: 'openSource', version: 3 }).ok);
  assert.equal(
    a.receive({
      protocol: 1,
      kind: 'snapshot',
      version: 3,
      projection: {},
      scene: null,
    }).ok,
    false,
  );
});
