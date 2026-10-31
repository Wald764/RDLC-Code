import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMessage } from '@rdlc/report-model/protocol';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';
import { DocumentBinding } from './protocol.js';

const view = {
  viewId: 'view-1',
  documentLifetimeId: 'life-1',
  contextGeneration: 0,
};
const nativeSelect = {
  protocol: 2,
  kind: 'nativeAction',
  requestId: 'native-1',
  documentLifetimeId: 'life-1',
  uri: 'file:///a.rdlc',
  baseVersion: 2,
  viewId: 'view-1',
  contextGeneration: 0,
  capability: 'select',
  targetIds: ['2:1', '2:2'],
  action: 'select',
  primaryId: '2:2',
  additive: true,
};
const accepted = {
  protocol: 2,
  kind: 'acceptedSelection',
  version: 2,
  viewId: 'view-1',
  sequence: 1,
  selection: {
    mode: 'body',
    targetIds: ['2:1', '2:2'],
    primaryId: '2:2',
  },
};
const outcome = {
  protocol: 2,
  kind: 'actionOutcome',
  requestId: 'native-1',
  baseVersion: 2,
  resultVersion: 3,
  status: 'accepted',
  selectionSequence: 1,
};

const edit = {
  protocol: 2,
  kind: 'edit',
  requestId: 'r1',
  baseVersion: 2,
  targetId: '2:1',
  operation: 'setProperty',
  payload: { property: 'text', value: 'safe <text>' },
};

test('structure is closed, version-local, source-bounded and parent ordered', () => {
  const node = {
    id: '2:1',
    parentId: null,
    kind: 'report',
    label: 'Report',
    name: null,
    range: { start: 0, end: 20 },
    preservedReason: null,
  };
  const snapshot = {
    protocol: 2,
    kind: 'snapshot',
    version: 2,
    sourceLength: 20,
    projection: { status: 'source-only', capabilities: [], diagnostics: [] },
    scene: null,
    structure: { nodes: [node], truncated: false },
  };
  assert.ok(validateMessage(snapshot));
  for (const nodes of [
    [node, node],
    [{ ...node, id: '1:1' }],
    [{ ...node, parentId: '2:9' }],
    [{ ...node, parentId: node.id }],
    [{ ...node, range: { start: 0, end: 21 } }],
    [{ ...node, kind: 'command' }],
    [{ ...node, uri: 'file:///secret' }],
    Array.from({ length: 2001 }, (_, i) => ({ ...node, id: `2:${i + 1}` })),
    Array.from({ length: 33 }, (_, i) => ({
      ...node,
      id: `2:${i + 1}`,
      parentId: i ? `2:${i}` : null,
    })),
  ])
    assert.equal(
      validateMessage({ ...snapshot, structure: { nodes, truncated: false } }),
      null,
    );
});

test('history has fixed closed actions, correlated results and replay protection', () => {
  const history = {
    protocol: 2,
    kind: 'history',
    requestId: 'history-1',
    baseVersion: 2,
    action: 'undo',
  };
  assert.ok(validateMessage(history));
  for (const extra of [
    { action: 'save' },
    { uri: 'file:///other' },
    { command: 'undo' },
    { targetId: '2:1' },
  ])
    assert.equal(validateMessage({ ...history, ...extra }), null);
  assert.ok(validateMessage({ ...history, focused: true }));
  assert.ok(validateMessage({ ...history, focused: false }));
  assert.equal(validateMessage({ ...history, focused: 'yes' }), null);
  const result = {
    ...history,
    kind: 'historyResult',
    resultVersion: 3,
    accepted: false,
    changed: true,
    reason: 'Observed change after command failure',
  };
  assert.ok(validateMessage(result));
  assert.equal(validateMessage({ ...result, resultVersion: 2 }), null);
  assert.equal(
    validateMessage({ ...result, focused: true }),
    null,
    'a result never carries the focus evidence',
  );
  const binding = new DocumentBinding('fixture:a', 2, [], []);
  assert.equal(binding.receive(history).ok, false);
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.equal(binding.receive(history).ok, true);
  assert.equal(binding.receive(history).ok, false);
  assert.equal(
    binding.receive({ ...history, requestId: 'history-2', baseVersion: 1 }).ok,
    false,
  );
});
test('authoring envelopes accept only closed string-valued action payloads', () => {
  const author = {
    ...edit,
    operation: 'author',
    payload: { action: 'createField', name: 'Amount', type: 'decimal' },
  };
  assert.ok(validateMessage(author));
  for (const payload of [
    { action: 'constructor' },
    { action: 'createField', name: 'Amount', type: 'decimal', xml: '<Field/>' },
    { action: 'createField', name: 'Amount' },
    { action: 'setColumnWidth', column: 1, width: '1in' },
    { action: 'deleteDataset', path: 'other.rdlc' },
  ])
    assert.equal(validateMessage({ ...author, payload }), null);
});
test('protocol v2 accepts only bounded plain known envelopes and rejects v1', () => {
  assert.ok(validateMessage({ protocol: 2, kind: 'ready' }));
  assert.ok(validateMessage(edit));
  assert.ok(
    validateMessage({
      protocol: 2,
      kind: 'openSource',
      version: 2,
      targetId: '2:1',
    }),
  );
  assert.ok(
    validateMessage({
      protocol: 2,
      kind: 'editResult',
      version: 2,
      baseVersion: 2,
      changed: false,
      mappings: [],
      requestId: 'r1',
      accepted: false,
      reason: 'STALE',
      diagnostics: [],
    }),
  );
  assert.ok(
    validateMessage({
      protocol: 2,
      kind: 'protocolError',
      supportedVersion: 2,
      reason: 'Unsupported protocol',
    }),
  );
  for (const value of [
    null,
    [],
    { ...edit, protocol: 1 },
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

test('layout actions have closed bounded action-specific payloads', () => {
  const layout = {
    protocol: 2,
    kind: 'edit',
    requestId: 'layout-1',
    baseVersion: 2,
    operation: 'layout',
  };
  const move = {
    action: 'move',
    targetIds: ['2:1', '2:2'],
    dxPt: 1,
    dyPt: -1,
    unit: 'pt',
  };
  for (const payload of [
    move,
    ...['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((handle) => ({
      action: 'resize',
      targetIds: ['2:1'],
      handle,
      ...(handle.includes('e') || handle.includes('w') ? { xPt: 10 } : {}),
      ...(handle.includes('n') || handle.includes('s') ? { yPt: 10 } : {}),
      unit: 'cm',
    })),
    ...['left', 'center', 'right', 'top', 'middle', 'bottom'].map((mode) => ({
      action: 'align',
      targetIds: ['2:1', '2:2'],
      primaryId: '2:2',
      mode,
      unit: 'in',
    })),
    ...['horizontal', 'vertical'].map((axis) => ({
      action: 'distribute',
      targetIds: ['2:1', '2:2', '2:3'],
      axis,
      unit: 'mm',
    })),
  ])
    assert.ok(validateMessage({ ...layout, payload }), JSON.stringify(payload));
  for (const payload of [
    { ...move, targetIds: [] },
    { ...move, targetIds: ['2:1', '2:1'] },
    { ...move, targetIds: ['foreign/path'] },
    { ...move, targetIds: ['1:1'] },
    { ...move, dxPt: Infinity },
    { ...move, dyPt: NaN },
    { ...move, unit: 'px' },
    { ...move, xml: '<a/>' },
    { ...move, action: 'batch' },
    {
      action: 'resize',
      targetIds: ['2:1', '2:2'],
      handle: 'e',
      xPt: 10,
      unit: 'pt',
    },
    {
      action: 'resize',
      targetIds: ['2:1'],
      handle: 'e',
      xPt: 10,
      yPt: 10,
      unit: 'pt',
    },
    { action: 'resize', targetIds: ['2:1'], handle: 'nw', xPt: 10, unit: 'pt' },
    {
      action: 'align',
      targetIds: ['2:1', '2:2'],
      primaryId: '2:3',
      mode: 'left',
      unit: 'pt',
    },
    {
      action: 'distribute',
      targetIds: ['2:1', '2:2'],
      axis: 'horizontal',
      unit: 'pt',
    },
    {
      ...move,
      targetIds: Array.from({ length: 1001 }, (_, index) => `2:${index}`),
    },
  ])
    assert.equal(
      validateMessage({ ...layout, payload }),
      null,
      JSON.stringify(payload),
    );
  const binding = new DocumentBinding('file:layout', 2, ['2:1'], ['layout']);
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.equal(binding.receive({ ...layout, payload: move }).ok, false);
  assert.equal(
    binding.receive({ ...layout, payload: { ...move, targetIds: ['2:1'] } }).ok,
    true,
  );
  assert.equal(
    binding.receive({ ...layout, payload: { ...move, targetIds: ['2:1'] } }).ok,
    false,
  );
});

test('correlated results validate versions, no-op state and unique source correspondence', () => {
  const result = {
    protocol: 2,
    kind: 'editResult',
    requestId: 'r1',
    baseVersion: 2,
    version: 3,
    accepted: true,
    changed: true,
    mappings: [
      { sourceId: '2:1', resultId: '3:7' },
      { sourceId: '2:2', resultId: null },
    ],
    reason: 'APPLIED',
    diagnostics: [],
  };
  assert.ok(validateMessage(result));
  assert.ok(
    validateMessage({
      ...result,
      version: 2,
      changed: false,
      mappings: [{ sourceId: '2:1', resultId: '2:1' }],
    }),
  );
  for (const change of [
    { baseVersion: -1 },
    { version: 1 },
    { changed: false },
    { accepted: false },
    { mappings: [{ sourceId: '1:1', resultId: '3:7' }] },
    { mappings: [{ sourceId: '2:1', resultId: '2:7' }] },
    { mappings: [result.mappings[0], result.mappings[0]] },
    {
      mappings: [
        { sourceId: '2:1', resultId: '3:7' },
        { sourceId: '2:2', resultId: '3:7' },
      ],
    },
    { mappings: [{ sourceId: '2:1', resultId: '3:7', path: 'x' }] },
  ])
    assert.equal(validateMessage({ ...result, ...change }), null);
});

test('snapshot scenes accept only finite local geometry and descriptive labels', () => {
  const bounds = { left: 0, top: 0, width: 96, height: 96 };
  const message = {
    protocol: 2,
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

test('extended scenes retain unknown items but reject forged geometry and cell relationships', () => {
  const source = readFileSync(
    'tests/fixtures/interactive/optional-geometry.rdlc',
    'utf8',
  );
  const report = projectReport(
    parse({ uri: 'test:scene', source, version: 2, eol: '\n' }),
  );
  const scene = renderScene(report);
  const snapshot = {
    protocol: 2,
    kind: 'snapshot',
    version: 2,
    projection: {
      status: report.status,
      capabilities: report.capabilities,
      diagnostics: report.diagnostics,
    },
    scene,
  };
  assert.ok(scene.items.some((item) => item.bounds === null));
  assert.ok(validateMessage(snapshot));
  const item = scene.items[0]!;
  for (const change of [
    { bounds: { left: 0, top: 0, width: 0, height: 20 } },
    { kind: 'script' },
    { sourceOrder: -1 },
    { zIndex: Infinity },
    { kind: 'cell', parentTableId: '2:99999' },
    {
      resolvedGeometry: {
        ...item.resolvedGeometry,
        width: { raw: null, unit: null, provenance: 'derived', points: -1 },
      },
    },
    {
      operations: {
        ...item.operations,
        moveX: { eligible: true, reason: 'locked' },
      },
    },
  ])
    assert.equal(
      validateMessage({
        ...snapshot,
        scene: { ...scene, items: [{ ...item, ...change }] },
      }),
      null,
    );
});
test('host binds IDs, versions, handshake, capability and request IDs to one document', () => {
  const a = new DocumentBinding('file:a', 2, ['2:1'], ['setProperty']);
  const b = new DocumentBinding('file:b', 2, ['2:2'], ['setProperty']);
  assert.equal(a.receive(edit).ok, false);
  assert.ok(a.receive({ protocol: 2, kind: 'ready' }).ok);
  assert.ok(b.receive({ protocol: 2, kind: 'ready' }).ok);
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
    a.receive({ protocol: 2, kind: 'openSource', version: 2, targetId: '2:1' })
      .ok,
    false,
  );
  assert.ok(a.receive({ protocol: 2, kind: 'openSource', version: 3 }).ok);
  assert.equal(
    a.receive({
      protocol: 2,
      kind: 'snapshot',
      version: 3,
      projection: {},
      scene: null,
    }).ok,
    false,
  );
});

test('full snapshots support 100 textboxes near 1 MiB without increasing client edit budgets', () => {
  const fixture = readFileSync(
    'tests/fixtures/textboxes/supported.rdlc',
    'utf8',
  );
  const textbox = fixture
    .match(/<Textbox\b[\s\S]*?<\/Textbox>/)![0]
    .replace('Hello &amp; welcome', 'A'.repeat(9000));
  const source = fixture.replace(
    /<Textbox\b[\s\S]*?<\/Textbox>/,
    Array.from({ length: 100 }, (_, index) =>
      textbox.replaceAll('Title', `Title${index}`),
    ).join('\n'),
  );
  assert.ok(Buffer.byteLength(source) < 1024 * 1024);
  const projection = projectReport(
    parse({ uri: 'test:large', version: 1, source, eol: '\n' }),
  );
  assert.equal(projection.status, 'editable');
  const message = {
    protocol: 2,
    kind: 'snapshot',
    version: 1,
    projection: {
      status: projection.status,
      capabilities: projection.capabilities,
      diagnostics: projection.diagnostics,
    },
    scene: renderScene(projection),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(message)) > 65536);
  assert.ok(validateMessage(message));
  assert.equal(
    validateMessage({
      ...edit,
      payload: { property: 'text', value: 'A'.repeat(65537) },
    }),
    null,
  );
  assert.equal(
    validateMessage({
      ...message,
      scene: {
        ...message.scene,
        items: [
          {
            ...message.scene.items[0]!,
            text: 'A'.repeat(8 * 1024 * 1024),
          },
        ],
      },
    }),
    null,
  );
});

test('preservation-only source targets are navigable but never editable', () => {
  const binding = new DocumentBinding(
    'file:source',
    2,
    ['2:1'],
    ['setProperty'],
    ['2:1', '2:9'],
  );
  assert.ok(binding.receive({ protocol: 2, kind: 'ready' }).ok);
  assert.ok(
    binding.receive({
      protocol: 2,
      kind: 'openSource',
      version: 2,
      targetId: '2:9',
    }).ok,
  );
  assert.equal(
    binding.receive({
      protocol: 2,
      kind: 'edit',
      requestId: 'locked',
      baseVersion: 2,
      targetId: '2:9',
      operation: 'setProperty',
      payload: { property: 'text', value: 'x' },
    }).ok,
    false,
  );
});

test('clipboard requests are closed per action and never carry XML', () => {
  const base = {
    protocol: 2,
    kind: 'clipboard',
    requestId: 'c1',
    baseVersion: 2,
  };
  const valid = [
    { ...base, action: 'copy', targetIds: ['2:3', '2:4'] },
    { ...base, action: 'cut', targetIds: ['2:3'] },
    { ...base, action: 'paste', unit: 'mm' },
    { ...base, action: 'duplicate', targetIds: ['2:3'], unit: 'pt' },
  ];
  for (const message of valid)
    assert.ok(validateMessage(message), message.action);
  for (const message of [
    { ...base, action: 'copy', targetIds: [] },
    { ...base, action: 'copy', targetIds: ['2:3', '2:3'] },
    { ...base, action: 'copy', targetIds: ['1:3'] },
    { ...base, action: 'copy', targetIds: ['2:3'], unit: 'pt' },
    { ...base, action: 'cut' },
    { ...base, action: 'cut', targetIds: ['2:3'], confirm: 'yes' },
    { ...base, action: 'paste' },
    { ...base, action: 'paste', unit: 'px' },
    { ...base, action: 'paste', unit: 'pt', xml: '<Textbox/>' },
    { ...base, action: 'paste', unit: 'pt', targetIds: ['2:3'] },
    { ...base, action: 'paste', unit: 'pt', capture: 'id' },
    { ...base, action: 'move', targetIds: ['2:3'] },
    {
      ...base,
      action: 'copy',
      targetIds: Array.from({ length: 1001 }, (_, i) => `2:${i + 1}`),
    },
  ])
    assert.equal(
      validateMessage(message),
      null,
      JSON.stringify(message).slice(0, 80),
    );
});

test('clipboard results correlate versions, mutation status and inserted/removed IDs', () => {
  const result = {
    protocol: 2,
    kind: 'clipboardResult',
    requestId: 'c1',
    action: 'paste',
    baseVersion: 2,
    version: 3,
    accepted: true,
    changed: true,
    reason: 'APPLIED',
    inserted: ['3:40'],
    removed: [],
    diagnostics: [],
  };
  assert.ok(validateMessage(result));
  assert.ok(
    validateMessage({
      ...result,
      action: 'copy',
      version: 2,
      changed: false,
      inserted: [],
      reason: 'COPIED',
    }),
  );
  assert.ok(
    validateMessage({
      ...result,
      action: 'cut',
      inserted: [],
      removed: ['2:5'],
    }),
  );
  for (const forged of [
    { ...result, action: 'copy' },
    { ...result, inserted: ['2:40'] },
    { ...result, removed: ['2:5'] },
    { ...result, action: 'cut', removed: ['3:5'], inserted: [] },
    { ...result, changed: false },
    { ...result, accepted: false },
    { ...result, version: 1 },
    { ...result, xml: '<Textbox/>' },
  ])
    assert.equal(validateMessage(forged), null);
});

test('host binding accepts clipboard requests only for current targets and capability', () => {
  const binding = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:3'],
    ['clipboard'],
  );
  binding.receive({ protocol: 2, kind: 'ready' });
  const copy = {
    protocol: 2,
    kind: 'clipboard',
    requestId: 'k1',
    baseVersion: 2,
    action: 'copy',
    targetIds: ['2:3'],
  };
  assert.ok(binding.receive(copy).ok);
  assert.equal(binding.receive(copy).ok, false, 'duplicate request');
  assert.equal(
    binding.receive({ ...copy, requestId: 'k2', targetIds: ['2:9'] }).ok,
    false,
  );
  assert.equal(
    binding.receive({
      ...copy,
      requestId: 'k3',
      baseVersion: 1,
      targetIds: ['1:3'],
    }).ok,
    false,
  );
  const disabled = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:3'],
    ['layout'],
  );
  disabled.receive({ protocol: 2, kind: 'ready' });
  assert.equal(disabled.receive(copy).ok, false);
});

test('creation intents carry positions only and results may name the created item', () => {
  const author = (payload: Record<string, unknown>) =>
    validateMessage({ ...edit, operation: 'author', payload });
  for (const payload of [
    { action: 'createTextbox', left: '1in', top: '0.5in' },
    { action: 'createTable', left: '0pt', top: '12pt' },
    { action: 'createDataset' },
    { action: 'renameTable', name: 'Orders' },
    { action: 'setTableDataset', dataset: 'DataSet1' },
  ])
    assert.ok(author(payload), JSON.stringify(payload));
  for (const payload of [
    { action: 'createTextbox', name: 'Title' },
    { action: 'createTextbox', name: 'Title', left: '1in', top: '1in' },
    { action: 'createTextbox', left: '1in' },
    { action: 'createTextbox', left: 1, top: 2 },
    {
      action: 'createTable',
      name: 'T',
      dataset: 'D',
      field: 'F',
      width: '1in',
    },
    { action: 'createTable', left: '1in', top: '1in', dataset: 'D' },
    { action: 'createDataset', name: 'DataSet1' },
    { action: 'renameTable' },
    { action: 'setTableDataset', dataset: 1 },
  ])
    assert.equal(author(payload), null, JSON.stringify(payload));
  const result = {
    protocol: 2,
    kind: 'editResult',
    requestId: 'r1',
    baseVersion: 2,
    version: 3,
    accepted: true,
    changed: true,
    mappings: [],
    reason: 'APPLIED',
    diagnostics: [],
    created: { id: '3:9', name: 'Textbox1' },
  };
  assert.ok(validateMessage(result));
  for (const created of [
    { id: '3:9' },
    { id: '3:9', name: 'Textbox1', kind: 'textbox' },
    { id: 'bad id!', name: 'Textbox1' },
    { id: '3:9', name: '1Textbox' },
    { id: '3:9', name: 'x'.repeat(257) },
    'Textbox1',
  ])
    assert.equal(validateMessage({ ...result, created }), null);
  // A refused result never names a created item.
  assert.equal(
    validateMessage({
      ...result,
      accepted: false,
      changed: false,
      version: 2,
      reason: 'Refused',
    }),
    null,
  );
});

test('accepted navigation is closed, version-local, parent ordered and budgeted', () => {
  const node = (
    id: string,
    kind: string,
    parentId: string | null,
    sourceOrder: number,
  ) => ({
    id,
    parentId,
    sourceOrder,
    range: { start: sourceOrder, end: sourceOrder + 1 },
    expandedName: '{urn:test}Item',
    name: null,
    kind,
    label: 'Item',
    opaqueReason: null,
    capabilities: [
      { operation: 'inspect', eligible: true, reason: null },
      { operation: 'source', eligible: true, reason: null },
    ],
  });
  const navigation = {
    version: 2,
    structure: {
      nodes: [node('2:1', 'report', null, 0), node('2:2', 'textbox', '2:1', 1)],
      truncated: false,
    },
    data: {
      nodes: [node('2:3', 'dataset', null, 0)],
      truncated: false,
    },
  };
  const snapshot = {
    protocol: 2,
    kind: 'snapshot',
    version: 2,
    sourceLength: 20,
    projection: { status: 'editable', capabilities: [], diagnostics: [] },
    scene: null,
    navigation,
  };
  assert.ok(validateMessage(snapshot));
  for (const changed of [
    { ...snapshot, navigation: { ...navigation, version: 1 } },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [{ ...navigation.structure.nodes[0]!, uri: 'file:///b' }],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [{ ...navigation.structure.nodes[0]!, kind: 'command' }],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [
            { ...navigation.structure.nodes[0]!, expandedName: '<script>' },
          ],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [{ ...navigation.structure.nodes[0]!, id: '1:1' }],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [
            navigation.structure.nodes[1]!,
            navigation.structure.nodes[0]!,
          ],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [navigation.structure.nodes[1]!],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [{ ...navigation.structure.nodes[0]!, sourceOrder: -1 }],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [
            { ...navigation.structure.nodes[0]!, range: { start: 0, end: 21 } },
          ],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [
            {
              ...navigation.structure.nodes[0]!,
              capabilities: [
                { operation: 'inspect', eligible: true, reason: 'locked' },
              ],
            },
          ],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [
            {
              ...navigation.structure.nodes[0]!,
              capabilities: [
                { operation: 'inspect', eligible: false, reason: null },
              ],
            },
          ],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        data: {
          ...navigation.data,
          nodes: [
            {
              ...navigation.data.nodes[0]!,
              bounds: { left: 0, top: 0, width: 0, height: 1 },
            },
          ],
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          nodes: Array.from({ length: 2000 }, (_, index) =>
            node(`2:${index + 1}`, 'row', null, index),
          ),
          truncated: false,
        },
        data: {
          nodes: [node('2:2001', 'dataset', null, 2000)],
          truncated: false,
        },
      },
    },
    {
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          nodes: Array.from({ length: 33 }, (_, index) =>
            node(`2:${index + 1}`, 'row', index ? `2:${index}` : null, index),
          ),
          truncated: false,
        },
      },
    },
  ])
    assert.equal(validateMessage(changed), null);
  assert.ok(
    validateMessage({
      ...snapshot,
      navigation: {
        ...navigation,
        structure: {
          ...navigation.structure,
          nodes: [
            {
              ...navigation.structure.nodes[0]!,
              bounds: { left: 1, top: 2, width: 3, height: 4 },
            },
          ],
        },
      },
    }),
  );
});

test('native actions are finite, closed, session-bound and capability-checked', () => {
  const actionBase = {
    protocol: 2,
    kind: 'nativeAction',
    requestId: 'native-2',
    documentLifetimeId: 'life-1',
    uri: 'file:///a.rdlc',
    baseVersion: 2,
    viewId: 'view-1',
    contextGeneration: 0,
    capability: 'properties',
    targetIds: ['2:1'],
  };
  const actions = [
    nativeSelect,
    { ...actionBase, action: 'properties' },
    {
      ...actionBase,
      requestId: 'native-3',
      capability: 'source',
      action: 'source',
    },
    {
      ...actionBase,
      requestId: 'native-4',
      capability: 'create',
      targetIds: [],
      action: 'create',
      create: 'table',
    },
    {
      ...actionBase,
      requestId: 'native-5',
      capability: 'clipboard',
      action: 'clipboard',
      clipboard: 'copy',
    },
    {
      ...actionBase,
      requestId: 'native-6',
      capability: 'clipboard',
      targetIds: [],
      action: 'clipboard',
      clipboard: 'paste',
      unit: 'pt',
    },
    {
      ...actionBase,
      requestId: 'native-7',
      capability: 'author',
      action: 'author',
      payload: { action: 'deleteTextbox', confirm: 'yes' },
    },
  ];
  for (const action of actions)
    assert.ok(validateMessage(action), JSON.stringify(action));
  for (const changed of [
    { ...nativeSelect, protocol: 1 },
    { ...nativeSelect, command: 'undo' },
    { ...nativeSelect, patch: [] },
    { ...nativeSelect, action: 'execute' },
    { ...nativeSelect, capability: 'author' },
    { ...nativeSelect, primaryId: '2:3' },
    { ...nativeSelect, targetIds: [] },
    { ...nativeSelect, targetIds: ['2:1', '2:1'] },
    { ...nativeSelect, targetIds: ['1:1'] },
    { ...actions[3]!, targetIds: ['2:1'] },
    { ...actions[3]!, create: 'image' },
    { ...actions[4]!, unit: 'pt' },
    { ...actions[5]!, targetIds: ['2:1'] },
    { ...actions[5]!, unit: 'px' },
    { ...actions[6]!, payload: { action: 'deleteTextbox' } },
    {
      ...actions[6]!,
      payload: { action: 'deleteTextbox', confirm: 'yes', xml: '<a/>' },
    },
    { ...nativeSelect, uri: 'not a uri' },
  ])
    assert.equal(validateMessage(changed), null, JSON.stringify(changed));

  const binding = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:1', '2:2'],
    ['setProperty', 'author', 'clipboard'],
  );
  assert.equal(binding.dispatchNativeAction(nativeSelect).ok, false);
  assert.ok(binding.bindView(view));
  assert.equal(binding.bindView({ ...view, viewId: 'view-2' }), false);
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.ok(binding.dispatchNativeAction(nativeSelect).ok);
  assert.equal(binding.dispatchNativeAction(nativeSelect).ok, false);
  for (const changed of [
    { ...nativeSelect, requestId: 'native-8', viewId: 'view-2' },
    { ...nativeSelect, requestId: 'native-9', documentLifetimeId: 'life-2' },
    { ...nativeSelect, requestId: 'native-10', contextGeneration: 1 },
    { ...nativeSelect, requestId: 'native-11', uri: 'file:///b.rdlc' },
    { ...nativeSelect, requestId: 'native-12', baseVersion: 1 },
    { ...nativeSelect, requestId: 'native-13', targetIds: ['2:9'] },
    {
      ...nativeSelect,
      requestId: 'native-14',
      capability: 'properties',
      action: 'properties',
      targetIds: ['2:1'],
    },
  ])
    assert.equal(binding.dispatchNativeAction(changed).ok, false);
  assert.ok(
    binding.dispatchNativeAction({
      ...actionBase,
      requestId: 'native-15',
      action: 'properties',
    }).ok,
  );
  const delivered = binding.dispatchNativeAction({
    ...actionBase,
    requestId: 'native-16',
    capability: 'source',
    targetIds: ['2:2'],
    action: 'source',
  });
  assert.ok(delivered.ok);
  const failed = binding.failNativeDelivery('native-16', 'Panel closed');
  assert.equal(failed?.status, 'refused');
  assert.equal(binding.failNativeDelivery('native-16', 'Panel closed'), null);
  assert.equal(
    binding.dispatchNativeAction(nativeSelect).ok,
    false,
    'failed request remains terminal',
  );
});

test('selection and outcomes are closed, ordered and idempotent', () => {
  for (const selection of [
    { mode: 'empty' },
    { mode: 'body', targetIds: ['2:1'], primaryId: '2:1' },
    { mode: 'cell', targetId: '2:1' },
    { mode: 'structure', targetId: '2:1' },
  ])
    assert.ok(
      validateMessage({ ...accepted, selection }),
      JSON.stringify(selection),
    );
  for (const selection of [
    { mode: 'body', targetIds: [], primaryId: null },
    { mode: 'body', targetIds: ['2:1', '2:1'], primaryId: '2:1' },
    { mode: 'body', targetIds: ['2:1'], primaryId: '2:2' },
    { mode: 'body', targetIds: ['2:1'], primaryId: '2:1', cellId: '2:2' },
    { mode: 'cell', targetId: '2:1', primaryId: '2:1' },
    { mode: 'structure', targetId: '1:1' },
    { mode: 'mixed', targetId: '2:1' },
  ])
    assert.equal(
      validateMessage({ ...accepted, selection }),
      null,
      JSON.stringify(selection),
    );
  for (const changed of [
    { ...accepted, sequence: 0 },
    { ...accepted, version: 1 },
    { ...accepted, viewId: 'bad view' },
    { ...accepted, requestId: 'bad id!' },
    { ...accepted, extra: true },
    { ...accepted, sequence: 1.5 },
  ])
    assert.equal(validateMessage(changed), null, JSON.stringify(changed));
  assert.ok(validateMessage({ ...accepted, requestId: 'native-1' }));

  assert.ok(validateMessage(outcome));
  for (const changed of [
    { ...outcome, resultVersion: 1 },
    { ...outcome, status: 'maybe' },
    { ...outcome, reason: 'should not accompany acceptance' },
    { ...outcome, selectionSequence: -1 },
    { ...outcome, requestId: 'bad id!' },
    { ...outcome, viewId: 'view-1' },
  ])
    assert.equal(validateMessage(changed), null, JSON.stringify(changed));
  for (const status of ['refused', 'cancelled'])
    assert.ok(
      validateMessage({
        ...outcome,
        status,
        resultVersion: 2,
        reason: 'Changed before delivery',
      }),
    );
  assert.equal(
    validateMessage({
      ...outcome,
      status: 'refused',
      resultVersion: 2,
    }),
    null,
  );

  const binding = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:1', '2:2'],
    ['setProperty'],
  );
  assert.ok(binding.bindView(view));
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.ok(binding.dispatchNativeAction(nativeSelect).ok);
  assert.equal(
    binding.receiveSelection({ ...accepted, viewId: 'view-2' }).ok,
    false,
  );
  assert.equal(binding.receiveSelection({ ...accepted, version: 3 }).ok, false);
  assert.ok(binding.receiveSelection(accepted).ok);
  assert.equal(binding.receiveSelection(accepted).ok, false);
  assert.equal(
    binding.receiveSelection({ ...accepted, selection: { mode: 'empty' } }).ok,
    false,
  );
  assert.equal(
    binding.receiveSelection({
      ...accepted,
      sequence: 2,
      requestId: 'missing',
    }).ok,
    false,
  );
  assert.equal(
    binding.receiveOutcome({ ...outcome, requestId: 'missing' }).ok,
    false,
  );
  assert.equal(
    binding.receiveOutcome({ ...outcome, selectionSequence: 0 }).ok,
    false,
  );
  assert.ok(binding.receiveOutcome(outcome).ok);
  assert.ok(
    binding.receiveOutcome(outcome).ok,
    'duplicate outcome is idempotent',
  );
  assert.equal(
    binding.receiveOutcome({
      ...outcome,
      status: 'refused',
      reason: 'Changed',
    }).ok,
    false,
    'conflicting duplicate is refused',
  );
  binding.update(3, ['3:1'], ['setProperty']);
  assert.equal(
    binding.receiveOutcome({ ...outcome, resultVersion: 2 }).ok,
    false,
    'outcome older than the accepted version is stale',
  );
});

test('view binding advances generations without replacing the panel', () => {
  const snapshot = {
    protocol: 2,
    kind: 'snapshot',
    version: 2,
    sourceLength: 20,
    projection: { status: 'source-only', capabilities: [], diagnostics: [] },
    scene: null,
    structure: { nodes: [], truncated: false },
  };
  assert.ok(validateMessage({ ...snapshot, viewBinding: view }));
  for (const changed of [
    { ...view, viewId: 'bad view' },
    { ...view, documentLifetimeId: '' },
    { ...view, contextGeneration: -1 },
    { ...view, extra: true },
    { viewId: 'view-1', documentLifetimeId: 'life-1' },
  ])
    assert.equal(
      validateMessage({ ...snapshot, viewBinding: changed }),
      null,
      JSON.stringify(changed),
    );

  const binding = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:1', '2:2'],
    ['setProperty', 'author'],
  );
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.ok(binding.bindView(view));
  assert.ok(binding.bindView({ ...view, contextGeneration: 1 }));
  assert.deepEqual(binding.viewIdentity, { ...view, contextGeneration: 1 });
  assert.equal(binding.bindView(view), false, 'generations never move back');
  assert.equal(binding.bindView({ ...view, viewId: 'view-2' }), false);
  assert.equal(
    binding.bindView({ ...view, documentLifetimeId: 'life-2' }),
    false,
  );

  assert.equal(binding.dispatchNativeAction(nativeSelect).ok, false);
  assert.ok(
    binding.dispatchNativeAction({
      ...nativeSelect,
      requestId: 'native-20',
      contextGeneration: 1,
    }).ok,
  );
  const invalidated = binding.invalidateNative('Context changed', true);
  assert.equal(invalidated.length, 1);
  assert.equal(invalidated[0]?.status, 'refused');
  assert.equal(invalidated[0]?.resultVersion, 2);
  assert.equal(binding.invalidateNative('Context changed', true).length, 0);

  const select = {
    protocol: 2,
    kind: 'nativeAction',
    uri: 'file:///a.rdlc',
    viewId: 'view-1',
    documentLifetimeId: 'life-1',
    baseVersion: 2,
    requestId: 'native-21',
    contextGeneration: 1,
    targetIds: [],
    action: 'create',
    capability: 'create',
    create: 'textbox',
  };
  assert.ok(binding.dispatchNativeAction(select).ok);
  assert.deepEqual(binding.authorizeNativeEdit('native-21', 2), { ok: true });
  assert.equal(
    binding.invalidateNative('Context changed', true).length,
    0,
    'correlated in-flight edits are not invalidated',
  );
  assert.equal(binding.authorizeNativeEdit('native-21', 3).ok, false);

  const properties = {
    protocol: 2,
    kind: 'nativeAction',
    requestId: 'native-22',
    documentLifetimeId: 'life-1',
    uri: 'file:///a.rdlc',
    baseVersion: 2,
    viewId: 'view-1',
    contextGeneration: 1,
    capability: 'properties',
    action: 'properties',
    targetIds: ['2:1'],
  };
  assert.ok(binding.dispatchNativeAction(properties).ok);
  assert.equal(
    binding.authorizeNativeEdit('native-22', 2).ok,
    false,
    'opening properties never authorizes an edit',
  );
  assert.equal(
    binding.authorizeNativeEdit('native-22', 3).ok,
    false,
    'draft Apply must not revive the original action at a newer version',
  );
});

test('native mutation selection settles in either selection/outcome order at the accepted version', () => {
  for (const outcomeFirst of [false, true]) {
    const binding = new DocumentBinding(
      'file:///a.rdlc',
      2,
      ['2:1'],
      ['author'],
    );
    binding.receive({ protocol: 2, kind: 'ready' });
    binding.bindView({
      viewId: 'view-1',
      documentLifetimeId: 'life-1',
      contextGeneration: 0,
    });
    assert.ok(
      binding.dispatchNativeAction({
        protocol: 2,
        kind: 'nativeAction',
        uri: 'file:///a.rdlc',
        viewId: 'view-1',
        documentLifetimeId: 'life-1',
        contextGeneration: 0,
        baseVersion: 2,
        requestId: 'native-create',
        capability: 'create',
        action: 'create',
        create: 'textbox',
        targetIds: [],
      }).ok,
    );
    assert.ok(binding.authorizeNativeEdit('native-create', 2).ok);
    binding.update(3, ['3:1', '3:2'], ['author']);
    const selection = {
      protocol: 2,
      kind: 'acceptedSelection',
      viewId: 'view-1',
      version: 3,
      sequence: 1,
      requestId: 'native-create',
      selection: { mode: 'body', targetIds: ['3:2'], primaryId: '3:2' },
    };
    const outcome = {
      protocol: 2,
      kind: 'actionOutcome',
      requestId: 'native-create',
      baseVersion: 2,
      resultVersion: 3,
      status: 'accepted',
      selectionSequence: 1,
    };
    if (outcomeFirst) assert.ok(binding.receiveOutcome(outcome).ok);
    assert.ok(binding.receiveSelection(selection).ok);
    if (!outcomeFirst) assert.ok(binding.receiveOutcome(outcome).ok);
    assert.equal(
      binding.receiveSelection({ ...selection, version: 4, sequence: 2 }).ok,
      false,
    );
  }
});

test('host cancellation is closed, bounded and never a client mutation', () => {
  const message = {
    protocol: 2,
    kind: 'nativeCancel',
    requestId: 'native-1',
    baseVersion: 2,
    reason: 'Timeout.',
  };
  assert.ok(validateMessage(message));
  for (const changed of [
    { ...message, reason: '' },
    { ...message, reason: 'x'.repeat(2049) },
    { ...message, patch: [] },
    { ...message, protocol: 1 },
  ])
    assert.equal(validateMessage(changed), null);
  const binding = new DocumentBinding('file:///a.rdlc', 2, ['2:1'], ['author']);
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.equal(binding.receive(message).ok, false);
});

test('accepted selections verify source membership and exclusive host-owned mode eligibility', () => {
  const binding = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:1'],
    ['author'],
    ['2:1', '2:2', '2:3'],
  );
  binding.receive({ protocol: 2, kind: 'ready' });
  binding.bindView({
    viewId: 'view-1',
    documentLifetimeId: 'life-1',
    contextGeneration: 0,
  });
  binding.setSelectionTargets(['2:1'], ['2:2']);
  const base = {
    protocol: 2,
    kind: 'acceptedSelection',
    version: 2,
    viewId: 'view-1',
    sequence: 1,
  };
  for (const selection of [
    { mode: 'body', targetIds: ['2:3'], primaryId: '2:3' },
    { mode: 'cell', targetId: '2:1' },
    { mode: 'structure', targetId: '2:9' },
  ])
    assert.equal(binding.receiveSelection({ ...base, selection }).ok, false);
  assert.ok(
    binding.receiveSelection({
      ...base,
      selection: { mode: 'body', targetIds: ['2:1'], primaryId: '2:1' },
    }).ok,
  );
  assert.ok(
    binding.receiveSelection({
      ...base,
      sequence: 2,
      selection: { mode: 'cell', targetId: '2:2' },
    }).ok,
  );
  assert.ok(
    binding.receiveSelection({
      ...base,
      sequence: 3,
      selection: { mode: 'structure', targetId: '2:3' },
    }).ok,
  );
});

test('edits and clipboard requests carry only an optional native correlation', () => {
  const edit = {
    protocol: 2,
    kind: 'edit',
    requestId: 'edit-1',
    baseVersion: 2,
    targetId: '2:1',
    operation: 'setProperty',
    payload: { property: 'text', value: 'Accepted' },
  };
  assert.ok(validateMessage(edit));
  assert.ok(validateMessage({ ...edit, nativeRequestId: 'native-1' }));
  for (const changed of [
    { ...edit, nativeRequestId: 'bad id!' },
    { ...edit, nativeRequestId: 1 },
    { ...edit, nativeRequestId: 'native-1', extra: true },
  ])
    assert.equal(validateMessage(changed), null, JSON.stringify(changed));

  const clipboard = {
    protocol: 2,
    kind: 'clipboard',
    requestId: 'clipboard-1',
    baseVersion: 2,
    action: 'copy',
    targetIds: ['2:1'],
  };
  assert.ok(validateMessage(clipboard));
  assert.ok(validateMessage({ ...clipboard, nativeRequestId: 'native-1' }));
  assert.equal(
    validateMessage({ ...clipboard, nativeRequestId: 'bad id!' }),
    null,
  );
});

const jsonNodes = (value: unknown): number =>
  1 +
  (Array.isArray(value)
    ? value.reduce<number>((total, child) => total + jsonNodes(child), 0)
    : value && typeof value === 'object'
      ? Object.values(value).reduce<number>(
          (total, child) => total + jsonNodes(child),
          0,
        )
      : 0);
const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value));
const diagnostic = (message = '', blockedOperations: string[] = []) => ({
  code: 'X',
  category: 'invalid-value',
  severity: 'error',
  range: { start: 0, end: 0 },
  message,
  correctiveAction: '',
  blockedOperations,
});
const smallResult = (reason = '', blocked: string[] = []) => ({
  protocol: 2,
  kind: 'editResult',
  requestId: 'r1',
  baseVersion: 2,
  version: 2,
  accepted: false,
  changed: false,
  mappings: [],
  reason,
  diagnostics: [diagnostic('', blocked)],
});
const smallSnapshot = (message = '', blocked: string[] = []) => ({
  protocol: 2,
  kind: 'snapshot',
  version: 2,
  sourceLength: 20,
  projection: {
    status: 'source-only',
    capabilities: [],
    diagnostics: [diagnostic(message, blocked)],
  },
  scene: null,
  structure: { nodes: [], truncated: false },
});

test('message budgets accept the exact limit and reject one past it', () => {
  // Non-snapshot messages: 64 KiB.
  const emptyBytes = jsonBytes(smallResult());
  const atBytes = smallResult('x'.repeat(65536 - emptyBytes));
  assert.equal(jsonBytes(atBytes), 65536);
  assert.ok(validateMessage(atBytes), '64 KiB is accepted');
  const overBytes = smallResult('x'.repeat(65536 - emptyBytes + 1));
  assert.equal(jsonBytes(overBytes), 65537);
  assert.equal(validateMessage(overBytes), null, '64 KiB + 1 is rejected');

  // Non-snapshot messages: 8,192 JSON values.
  const emptyNodes = jsonNodes(smallResult());
  const atNodes = smallResult('', Array(8192 - emptyNodes).fill('a'));
  assert.equal(jsonNodes(atNodes), 8192);
  assert.ok(validateMessage(atNodes), '8,192 values are accepted');
  const overNodes = smallResult('', Array(8193 - emptyNodes).fill('a'));
  assert.equal(jsonNodes(overNodes), 8193);
  assert.equal(validateMessage(overNodes), null, '8,193 values are rejected');

  // Snapshots: 131,072 JSON values.
  const snapshotNodes = jsonNodes(smallSnapshot());
  const atSnapshotNodes = smallSnapshot(
    '',
    Array(131072 - snapshotNodes).fill('a'),
  );
  assert.equal(jsonNodes(atSnapshotNodes), 131072);
  assert.ok(jsonBytes(atSnapshotNodes) > 65536);
  assert.ok(validateMessage(atSnapshotNodes), '131,072 values are accepted');
  const overSnapshotNodes = smallSnapshot(
    '',
    Array(131073 - snapshotNodes).fill('a'),
  );
  assert.equal(jsonNodes(overSnapshotNodes), 131073);
  assert.equal(
    validateMessage(overSnapshotNodes),
    null,
    '131,073 values are rejected',
  );

  // Snapshots: 8 MiB.
  const snapshotBytes = jsonBytes(smallSnapshot());
  const limit = 8 * 1024 * 1024;
  const atSnapshotBytes = smallSnapshot('x'.repeat(limit - snapshotBytes));
  assert.equal(jsonBytes(atSnapshotBytes), limit);
  assert.ok(validateMessage(atSnapshotBytes), '8 MiB is accepted');
  const overSnapshotBytes = smallSnapshot(
    'x'.repeat(limit - snapshotBytes + 1),
  );
  assert.equal(jsonBytes(overSnapshotBytes), limit + 1);
  assert.equal(
    validateMessage(overSnapshotBytes),
    null,
    '8 MiB + 1 is rejected',
  );
});

test('the session request budget is 1,024 and exhaustion is refused explicitly', () => {
  const binding = new DocumentBinding(
    'file:///a.rdlc',
    2,
    ['2:1'],
    ['setProperty'],
  );
  assert.ok(binding.bindView(view));
  assert.ok(binding.receive({ protocol: 2, kind: 'ready' }).ok);
  for (let index = 1; index <= 1024; index++)
    assert.ok(
      binding.receive({ ...edit, requestId: `bulk-${index}` }).ok,
      `request ${index}`,
    );
  for (const requestId of ['bulk-1025', 'bulk-1026']) {
    const refused = binding.receive({ ...edit, requestId });
    assert.equal(refused.ok, false, requestId);
    assert.match(JSON.stringify(refused), /budget/);
  }
  const native = binding.dispatchNativeAction({
    ...nativeSelect,
    requestId: 'native-over-budget',
    targetIds: ['2:1'],
    primaryId: '2:1',
  });
  assert.equal(native.ok, false, 'native actions share the same budget');
  assert.match(String((native as { reason?: string }).reason), /budget/);
});

test('navigation lists and selection sets reject duplicate IDs; each new family is closed', () => {
  const entry = (id: string, order: number) => ({
    id,
    parentId: null,
    sourceOrder: order,
    range: { start: order, end: order + 1 },
    expandedName: '{urn:test}Item',
    name: null,
    kind: 'row',
    label: 'Item',
    opaqueReason: null,
    capabilities: [{ operation: 'inspect', eligible: true, reason: null }],
  });
  const snapshot = (structure: unknown[], data: unknown[]) => ({
    protocol: 2,
    kind: 'snapshot',
    version: 2,
    sourceLength: 20,
    projection: { status: 'editable', capabilities: [], diagnostics: [] },
    scene: null,
    navigation: {
      version: 2,
      structure: { nodes: structure, truncated: false },
      data: { nodes: data, truncated: false },
    },
  });
  assert.ok(
    validateMessage(snapshot([entry('2:1', 0), entry('2:2', 1)], [])),
    'distinct IDs are accepted',
  );
  assert.equal(
    validateMessage(snapshot([entry('2:1', 0), entry('2:1', 1)], [])),
    null,
    'duplicate structure node ID',
  );
  assert.equal(
    validateMessage(snapshot([], [entry('2:1', 0), entry('2:1', 1)])),
    null,
    'duplicate data node ID',
  );

  // Missing required fields and unexpected fields on each family.
  const required = (message: Record<string, unknown>) => {
    for (const key of Object.keys(message)) {
      if (key === 'protocol' || key === 'kind') continue;
      const { [key]: _removed, ...rest } = message;
      void _removed;
      const optional =
        key === 'requestId' && message.kind === 'acceptedSelection';
      if (!optional)
        assert.equal(
          validateMessage(rest),
          null,
          `${message.kind} without ${key}`,
        );
    }
    assert.equal(validateMessage({ ...message, extra: 1 }), null);
    assert.equal(validateMessage({ ...message, kind: undefined }), null);
  };
  required(nativeSelect);
  required(accepted);
  required(outcome);

  // Mixed selection modes and cross-family fields.
  for (const selection of [
    { mode: 'empty', targetId: '2:1' },
    { mode: 'empty', targetIds: ['2:1'] },
    { mode: 'body', targetId: '2:1', targetIds: ['2:1'], primaryId: '2:1' },
    { mode: 'body', targetIds: ['2:1'], primaryId: '2:1', targetId: '2:1' },
    { mode: 'cell', targetId: '2:1', targetIds: ['2:1'] },
    { mode: 'structure', targetId: '2:1', targetIds: ['2:1'] },
    { mode: 'structure', targetIds: ['2:1'] },
  ])
    assert.equal(
      validateMessage({ ...accepted, selection }),
      null,
      JSON.stringify(selection),
    );
  for (const changed of [
    { ...nativeSelect, create: 'table' },
    { ...nativeSelect, clipboard: 'copy' },
    { ...nativeSelect, payload: { action: 'deleteTextbox', confirm: 'yes' } },
    { ...nativeSelect, unit: 'pt' },
    { ...outcome, selection: { mode: 'empty' } },
    { ...accepted, status: 'accepted' },
  ])
    assert.equal(validateMessage(changed), null, JSON.stringify(changed));
});

test('benign stale selections and duplicate outcomes are ignored without state change', () => {
  const binding = new DocumentBinding(
    'file:///a.rdlc',
    3,
    ['3:1', '3:2'],
    ['author'],
  );
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.ok(binding.bindView(view));
  assert.ok(
    binding.dispatchNativeAction({
      ...nativeSelect,
      baseVersion: 3,
      targetIds: ['3:1'],
      primaryId: '3:1',
      additive: false,
    }).ok,
  );
  const selection = {
    ...accepted,
    version: 3,
    sequence: 2,
    selection: { mode: 'empty' },
  };
  assert.ok(binding.receiveSelection(selection).ok);
  const ignored = { ok: false, ignored: true };
  for (const stale of [
    { ...selection },
    { ...selection, sequence: 1 },
    { ...selection, sequence: 3, version: 2 },
  ])
    assert.deepEqual(
      { ...binding.receiveSelection(stale), reason: undefined },
      { ...ignored, reason: undefined },
      JSON.stringify(stale),
    );
  assert.ok(
    binding.receiveSelection({ ...selection, sequence: 3 }).ok,
    'ignored messages change no sequence state',
  );
  // Genuinely malformed or foreign selections remain errors.
  for (const bad of [
    { ...selection, sequence: 4, viewId: 'view-2' },
    { ...selection, sequence: 4, version: 4 },
    {
      ...selection,
      sequence: 4,
      selection: { mode: 'body', targetIds: ['3:9'], primaryId: '3:9' },
    },
    { ...selection, sequence: 4, extra: true },
  ]) {
    const result = binding.receiveSelection(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(!result.ok && result.ignored, undefined, JSON.stringify(bad));
  }

  binding.update(4, ['4:1'], ['author']);
  const settled = {
    ...outcome,
    baseVersion: 3,
    resultVersion: 4,
    selectionSequence: 3,
  };
  assert.ok(binding.receiveOutcome(settled).ok, 'a current outcome settles');
  assert.ok(binding.receiveOutcome(settled).ok, 'identical duplicate dedupes');
  for (const conflicting of [
    { ...settled, status: 'refused', reason: 'Changed' },
    { ...settled, resultVersion: 3 },
  ]) {
    const result = binding.receiveOutcome(conflicting);
    assert.equal(
      !result.ok && result.ignored,
      true,
      JSON.stringify(conflicting),
    );
  }
  assert.equal(
    binding.invalidateNative('Context changed', true).length,
    0,
    'the first settled result is kept',
  );
  for (const bad of [
    { ...settled, requestId: 'missing' },
    { ...settled, baseVersion: 2, resultVersion: 4 },
  ]) {
    const result = binding.receiveOutcome(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(!result.ok && result.ignored, undefined, JSON.stringify(bad));
  }
});

test('stale outcomes of every status settle a pending request exactly once', () => {
  const binding = new DocumentBinding('file:///a.rdlc', 3, ['3:1'], ['author']);
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.ok(binding.bindView(view));
  assert.ok(
    binding.dispatchNativeAction({
      ...nativeSelect,
      baseVersion: 3,
      targetIds: ['3:1'],
      primaryId: '3:1',
      additive: false,
    }).ok,
  );
  binding.update(4, ['4:1'], ['author']);
  const base = { ...outcome, baseVersion: 3, selectionSequence: 0 };
  // The designer sends one outcome per request: an accepted one overtaken by
  // the independent change settles once as a refusal, never stays pending.
  const overtaken = binding.receiveOutcome({ ...base, resultVersion: 3 });
  assert.ok(overtaken.ok);
  assert.equal(overtaken.message.status, 'refused');
  assert.equal(overtaken.message.resultVersion, 4);
  assert.match(overtaken.message.reason ?? '', /report changed/);
  const late = binding.receiveOutcome({ ...base, resultVersion: 4 });
  assert.equal(!late.ok && late.ignored, true, 'settled once');
  assert.equal(binding.invalidateNative('Context changed', true).length, 0);
  assert.equal(
    binding.receiveOutcome({ ...base, resultVersion: 4, selectionSequence: -1 })
      .ok,
    false,
    'an out-of-order selection sequence stays ignored',
  );
  // The host would otherwise wait for its timeout; refusals settle at once.
  for (const status of ['refused', 'cancelled'] as const) {
    const fresh = new DocumentBinding('file:///a.rdlc', 3, ['3:1'], ['author']);
    fresh.receive({ protocol: 2, kind: 'ready' });
    assert.ok(fresh.bindView(view));
    assert.ok(
      fresh.dispatchNativeAction({
        ...nativeSelect,
        baseVersion: 3,
        targetIds: ['3:1'],
        primaryId: '3:1',
        additive: false,
      }).ok,
    );
    fresh.update(4, ['4:1'], ['author']);
    const stale = {
      ...base,
      resultVersion: 3,
      status,
      reason: 'Refused for a stale context',
    };
    assert.ok(fresh.receiveOutcome(stale).ok, `${status} settles`);
    assert.ok(fresh.receiveOutcome(stale).ok, 'identical duplicate dedupes');
    const late = fresh.receiveOutcome({ ...base, resultVersion: 4 });
    assert.equal(!late.ok && late.ignored, true, 'settled once');
    assert.equal(fresh.invalidateNative('Context changed', true).length, 0);
  }
});

test('native edit authorization is single-use regardless of the first outcome', () => {
  const binding = new DocumentBinding('file:///a.rdlc', 2, ['2:1'], ['author']);
  binding.receive({ protocol: 2, kind: 'ready' });
  assert.ok(binding.bindView(view));
  assert.ok(
    binding.dispatchNativeAction({
      protocol: 2,
      kind: 'nativeAction',
      uri: 'file:///a.rdlc',
      viewId: 'view-1',
      documentLifetimeId: 'life-1',
      contextGeneration: 0,
      baseVersion: 2,
      requestId: 'native-once',
      capability: 'create',
      action: 'create',
      create: 'textbox',
      targetIds: [],
    }).ok,
  );
  assert.deepEqual(binding.authorizeNativeEdit('native-once', 2), { ok: true });
  // The first edit may be refused or a no-op; a second edit still cannot reuse the action.
  assert.equal(binding.authorizeNativeEdit('native-once', 2).ok, false);
  assert.equal(binding.authorizeNativeEdit('native-once', 3).ok, false);
});

test('focus probes are closed, correlated panel messages', () => {
  const probe = { protocol: 2, kind: 'focusProbe', probeId: 'focus-1' };
  assert.ok(validateMessage(probe));
  const result = { ...probe, kind: 'focusProbeResult', focused: false };
  assert.ok(validateMessage(result));
  for (const invalid of [
    { ...probe, focused: true },
    { ...probe, extra: 1 },
    { ...probe, probeId: 'not valid' },
    { ...probe, probeId: undefined },
    { ...result, focused: 'yes' },
    { ...result, focused: undefined },
    { ...result, probeId: '' },
  ])
    assert.equal(validateMessage(invalid), null);
});
