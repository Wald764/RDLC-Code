import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GESTURE_FOCUS_WINDOW_MS, HostAdapter } from './host-adapter';
import { emptySelection, selectItem } from './selection';
import type { ActionOutcomeMessage } from '@rdlc/report-model/protocol';
import type { DesignSceneItem } from '@rdlc/report-model/scene';

function snapshot(version: number) {
  return {
    protocol: 2,
    kind: 'snapshot',
    version,
    sourceLength: 10,
    projection: {
      status: 'editable',
      capabilities: ['author', 'clipboard', 'setProperty'],
      diagnostics: [],
    },
    scene: null,
    structure: {
      nodes: [
        {
          id: `${version}:1`,
          parentId: null,
          kind: 'textbox',
          label: 'Textbox',
          name: null,
          range: { start: 0, end: 1 },
          preservedReason: null,
        },
      ],
      truncated: false,
    },
  };
}

const nativeAction = {
  protocol: 2,
  kind: 'nativeAction',
  requestId: 'native-1',
  documentLifetimeId: 'life-1',
  uri: 'file:///a.rdlc',
  baseVersion: 2,
  viewId: 'view-1',
  contextGeneration: 0,
  capability: 'select',
  targetIds: ['2:1'],
  action: 'select',
  primaryId: '2:1',
  additive: false,
};

const item: DesignSceneItem = {
  id: '2:1',
  kind: 'textbox',
  label: 'Textbox',
  placeholder: false,
  bounds: { left: 0, top: 0, width: 10, height: 10 },
};

/** Authoritative Data row accepted as a known structural/data target. */
const dataRow = (id: string, kind: 'dataset' | 'field', name: string) => ({
  id,
  parentId: null,
  sourceOrder: 0,
  range: { start: 0, end: 1 },
  expandedName: '{urn:report}DataSet',
  name,
  kind,
  label: `DataSet: ${name}`,
  opaqueReason: null,
  capabilities: [{ operation: 'select', eligible: true, reason: null }],
});

function outcomes(host: HostAdapter) {
  return host
    .sent()
    .filter(
      (message): message is ActionOutcomeMessage =>
        (message as { kind?: string }).kind === 'actionOutcome',
    );
}

function setup() {
  TestBed.resetTestingModule();
  const host = TestBed.inject(HostAdapter);
  host.bindView('view-1', 'life-1', 0);
  host.ingest(snapshot(2));
  return host;
}

describe('native action ingestion', () => {
  it('publishes the XML cell separately from its rendered child textbox', () => {
    const host = TestBed.inject(HostAdapter);
    host.bindView('view-1', 'life-1', 0);
    const cell = {
      id: '2:4',
      parentId: null,
      sourceOrder: 0,
      range: { start: 0, end: 10 },
      expandedName: '{urn:report}TablixCell',
      name: null,
      kind: 'table-cell',
      label: 'Cell',
      opaqueReason: null,
      capabilities: [{ operation: 'select', eligible: true, reason: null }],
    };
    host.ingest({
      ...snapshot(2),
      navigation: {
        version: 2,
        structure: {
          nodes: [
            cell,
            {
              ...cell,
              id: '2:1',
              parentId: '2:4',
              sourceOrder: 1,
              range: { start: 2, end: 8 },
              kind: 'textbox',
              expandedName: '{urn:report}Textbox',
              label: 'Contents',
            },
          ],
          truncated: false,
        },
        data: { nodes: [], truncated: false },
      },
    });
    expect(
      host.publishSelection({ ...emptySelection(2), cellTargetId: '2:1' }),
    ).toBe(true);
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'acceptedSelection',
      selection: { mode: 'cell', targetId: '2:4' },
    });
    expect(
      host
        .sent()
        .some((message) => (message as { kind: string }).kind === 'edit'),
    ).toBe(false);
  });
  it('treats a Data definition as a known structural target and tracks it for reconciliation', () => {
    const host = TestBed.inject(HostAdapter);
    host.bindView('view-1', 'life-1', 0);
    host.ingest({
      ...snapshot(2),
      navigation: {
        version: 2,
        structure: { nodes: [], truncated: false },
        data: {
          nodes: [dataRow('2:20', 'dataset', 'Orders')],
          truncated: false,
        },
      },
    });
    expect(
      host.publishSelection({
        ...emptySelection(2),
        structureTargetId: '2:20',
      }),
    ).toBe(true);
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'acceptedSelection',
      selection: { mode: 'structure', targetId: '2:20' },
    });
    host.ingest({ ...nativeAction, targetIds: ['2:20'], primaryId: '2:20' });
    expect(host.nativeAction()?.requestId).toBe('native-1');
    host.ingest(snapshot(3));
    expect(host.previousData()?.nodes.map((node) => node.id)).toEqual(['2:20']);
    expect(host.previousStructure()?.nodes.map((node) => node.id)).toEqual([
      '2:1',
    ]);
  });
  it('host cancellation ends only its captured action and never replays it', () => {
    const host = setup();
    host.ingest(nativeAction);
    host.ingest({
      protocol: 2,
      kind: 'nativeCancel',
      requestId: 'foreign',
      baseVersion: 2,
      reason: 'Timeout.',
    });
    expect(host.nativeAction()?.requestId).toBe('native-1');
    host.ingest({
      protocol: 2,
      kind: 'nativeCancel',
      requestId: 'native-1',
      baseVersion: 1,
      reason: 'Timeout.',
    });
    expect(host.nativeAction()?.requestId).toBe('native-1');
    host.ingest({
      protocol: 2,
      kind: 'nativeCancel',
      requestId: 'native-1',
      baseVersion: 2,
      reason: 'The designer did not settle the action.',
    });
    expect(host.nativeAction()).toBeNull();
    expect(host.notice()).toContain('did not settle');
    host.ingest(nativeAction);
    expect(host.nativeAction()).toBeNull();
    host.ingest({ ...nativeAction, requestId: 'native-2' });
    expect(host.nativeAction()?.requestId).toBe('native-2');
    expect(host.sent()).toEqual([]);
  });
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('requires one bound view and a matching accepted version', () => {
    TestBed.resetTestingModule();
    const unbound = TestBed.inject(HostAdapter);
    unbound.ingest(snapshot(2));
    unbound.ingest(nativeAction);
    expect(unbound.nativeAction()).toBeNull();
    expect(unbound.notice()).toContain('another designer');
  });

  it('rejects foreign sessions, stale versions and overlapping requests', () => {
    const host = setup();
    for (const changed of [
      { ...nativeAction, viewId: 'view-2' },
      { ...nativeAction, documentLifetimeId: 'life-2' },
      // Target IDs carry their version, so a stale base needs same-version IDs to stay a valid envelope.
      { ...nativeAction, baseVersion: 1, targetIds: ['1:1'], primaryId: '1:1' },
      { ...nativeAction, contextGeneration: 1 },
      { ...nativeAction, targetIds: ['2:9'], primaryId: '2:9' },
    ]) {
      const before = outcomes(host).length;
      host.ingest(changed);
      expect(host.nativeAction()).toBeNull();
      const sent = outcomes(host);
      expect(sent).toHaveLength(before + 1);
      expect(sent.at(-1)).toMatchObject({
        protocol: 2,
        kind: 'actionOutcome',
        requestId: 'native-1',
        status: 'refused',
        baseVersion: changed.baseVersion,
      });
      expect(sent.at(-1)?.reason?.length).toBeGreaterThan(0);
    }
    expect(host.nativeAction()).toBeNull();
    host.ingest(nativeAction);
    expect(host.nativeAction()?.requestId).toBe('native-1');
    expect(outcomes(host)).toHaveLength(5);
    host.ingest({ ...nativeAction, requestId: 'native-2' });
    expect(host.nativeAction()?.requestId).toBe('native-1');
    expect(host.notice()).toContain('pending');
    expect(outcomes(host)).toHaveLength(6);
    expect(outcomes(host).at(-1)).toMatchObject({
      requestId: 'native-2',
      status: 'refused',
      reason: 'Another native action is already pending in this designer.',
    });
    // Redelivering the pending request is not a second refusal.
    host.ingest(nativeAction);
    expect(outcomes(host)).toHaveLength(6);
  });

  it('refuses with an outcome when the 1,024-request budget is exhausted', () => {
    const host = setup();
    for (let index = 0; index < 1024; index++) {
      host.ingest({ ...nativeAction, requestId: `budget-${index}` });
      expect(host.settleNativeAction('accepted')).toBe(true);
    }
    // The adapter keeps only 100 diagnostic messages, so assert the newest.
    expect(host.sent().at(-1)).toMatchObject({ requestId: 'budget-1023' });
    host.ingest({ ...nativeAction, requestId: 'overflow' });
    expect(host.nativeAction()).toBeNull();
    expect(host.notice()).toContain('budget');
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'actionOutcome',
      requestId: 'overflow',
      status: 'refused',
      reason: expect.stringContaining('budget'),
    });
  });

  it('publishes accepted selection once per state change and settles one outcome', () => {
    const host = setup();
    const selection = selectItem(emptySelection(2), item, false);
    host.ingest(nativeAction);
    expect(host.publishSelection(selection, 'native-1')).toBe(true);
    expect(host.sent().at(-1)).toMatchObject({
      protocol: 2,
      kind: 'acceptedSelection',
      version: 2,
      viewId: 'view-1',
      sequence: 1,
      requestId: 'native-1',
      selection: { mode: 'body', targetIds: ['2:1'], primaryId: '2:1' },
    });
    const sent = host.sent().length;
    expect(host.publishSelection(selection)).toBe(false);
    expect(host.sent()).toHaveLength(sent);

    expect(host.settleNativeAction('accepted')).toBe(true);
    expect(host.sent().at(-1)).toMatchObject({
      protocol: 2,
      kind: 'actionOutcome',
      requestId: 'native-1',
      baseVersion: 2,
      resultVersion: 2,
      status: 'accepted',
      selectionSequence: 1,
    });
    expect(host.nativeAction()).toBeNull();
    expect(host.settleNativeAction('accepted')).toBe(false);
    host.ingest({ ...nativeAction, requestId: 'native-3' });
    expect(host.nativeAction()?.requestId).toBe('native-3');
  });

  it('settles both outcome/snapshot orders without replaying the action', () => {
    for (const snapshotFirst of [false, true]) {
      const host = setup();
      host.ingest(nativeAction);
      host.sendEdit({
        requestId: 'create-1',
        baseVersion: 2,
        targetId: '2:1',
        operation: 'author',
        payload: { action: 'createTextbox', left: '1in', top: '1in' },
      });
      const result = {
        protocol: 2,
        kind: 'editResult',
        requestId: 'create-1',
        baseVersion: 2,
        version: 3,
        accepted: true,
        changed: true,
        mappings: [],
        reason: 'APPLIED',
        diagnostics: [],
        created: { id: '3:1', name: 'Textbox1' },
      };
      if (snapshotFirst) host.ingest(snapshot(3));
      host.ingest(result);
      if (!snapshotFirst) {
        expect(host.settleNativeAction('accepted')).toBe(true);
        expect(host.sent().at(-1)).toMatchObject({
          kind: 'actionOutcome',
          resultVersion: 3,
        });
        host.ingest(snapshot(3));
      } else {
        expect(host.settleNativeAction('accepted')).toBe(true);
        expect(host.sent().at(-1)).toMatchObject({
          kind: 'actionOutcome',
          resultVersion: 3,
        });
      }
      expect(host.nativeAction()).toBeNull();
      expect(host.settleNativeAction('accepted')).toBe(false);
      expect(host.pending()).toBeNull();
    }
  });

  it('refuses without a reason, restores accepted state and invalidates unrelated changes', () => {
    const host = setup();
    host.ingest(nativeAction);
    expect(host.settleNativeAction('refused')).toBe(false);
    expect(host.settleNativeAction('cancelled', 'Draft kept')).toBe(true);
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'actionOutcome',
      status: 'cancelled',
      resultVersion: 2,
      reason: 'Draft kept',
      selectionSequence: 0,
    });
    expect(host.nativeAction()).toBeNull();

    host.ingest({ ...nativeAction, requestId: 'native-4' });
    host.sendEdit({
      requestId: 'create-2',
      baseVersion: 2,
      targetId: '2:1',
      operation: 'author',
      payload: { action: 'createTextbox', left: '1in', top: '1in' },
    });
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: 'create-2',
      baseVersion: 2,
      version: 3,
      accepted: true,
      changed: true,
      mappings: [],
      reason: 'APPLIED',
      diagnostics: [],
    });
    expect(host.settleNativeAction('accepted')).toBe(true);
    host.ingest(snapshot(4));
    expect(
      host
        .sent()
        .filter(
          (message) => (message as { kind?: string }).kind === 'actionOutcome',
        ),
    ).toHaveLength(2);
    expect(host.nativeAction()).toBeNull();
    expect(host.notice()).toContain('changed');
  });
});

describe('view binding and correlated native edits', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('consumes snapshot view bindings, advances generations and cancels stale actions', () => {
    const host = setup();
    host.ingest({
      ...snapshot(2),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'life-1',
        contextGeneration: 1,
      },
    });
    expect(host.snapshot()?.viewBinding?.contextGeneration).toBe(1);
    host.ingest({ ...nativeAction, contextGeneration: 1 });
    expect(host.nativeAction()?.requestId).toBe('native-1');

    host.ingest({
      ...snapshot(2),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'life-1',
        contextGeneration: 2,
      },
    });
    expect(host.nativeAction()).toBeNull();
    expect(host.notice()).toContain('context changed');

    host.ingest({
      ...snapshot(2),
      viewBinding: {
        viewId: 'view-2',
        documentLifetimeId: 'life-2',
        contextGeneration: 2,
      },
    });
    expect(host.snapshot()?.viewBinding?.viewId).toBe('view-1');
    expect(host.notice()).toContain('no longer matches');
  });

  it('correlates one edit with the captured action and settles it once', () => {
    const host = setup();
    host.ingest({
      protocol: 2,
      kind: 'nativeAction',
      requestId: 'native-5',
      documentLifetimeId: 'life-1',
      uri: 'file:///a.rdlc',
      baseVersion: 2,
      viewId: 'view-1',
      contextGeneration: 0,
      capability: 'author',
      targetIds: ['2:1'],
      action: 'author',
      payload: { action: 'deleteTextbox', confirm: 'yes' },
    });
    expect(
      host.sendEdit(
        {
          requestId: 'edit-5',
          baseVersion: 2,
          targetId: '2:1',
          operation: 'author',
          payload: { action: 'deleteTextbox', confirm: 'yes' },
        },
        'native-5',
      ),
    ).toBe(true);
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'edit',
      requestId: 'edit-5',
      nativeRequestId: 'native-5',
    });

    host.ingest(snapshot(3));
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: 'edit-5',
      baseVersion: 2,
      version: 3,
      accepted: true,
      changed: true,
      mappings: [],
      reason: 'APPLIED',
      diagnostics: [],
    });
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'actionOutcome',
      requestId: 'native-5',
      status: 'accepted',
      resultVersion: 3,
    });
    expect(host.nativeAction()).toBeNull();
    expect(host.settleNativeAction('accepted')).toBe(false);
  });
  const authorAction = {
    protocol: 2,
    kind: 'nativeAction',
    requestId: 'native-6',
    documentLifetimeId: 'life-1',
    uri: 'file:///a.rdlc',
    baseVersion: 2,
    viewId: 'view-1',
    contextGeneration: 0,
    capability: 'author',
    targetIds: ['2:1'],
    action: 'author',
    payload: { action: 'deleteTextbox', confirm: 'yes' },
  };
  const authorEdit = {
    requestId: 'edit-6',
    baseVersion: 2,
    targetId: '2:1',
    operation: 'author' as const,
    payload: { action: 'deleteTextbox' as const, confirm: 'yes' as const },
  };
  const authorResult = {
    protocol: 2,
    kind: 'editResult',
    requestId: 'edit-6',
    baseVersion: 2,
    version: 3,
    accepted: true,
    changed: true,
    mappings: [],
    reason: 'APPLIED',
    diagnostics: [],
  };
  const withGeneration = (version: number, contextGeneration: number) => ({
    ...snapshot(version),
    viewBinding: {
      viewId: 'view-1',
      documentLifetimeId: 'life-1',
      contextGeneration,
    },
  });

  it('settles a correlated edit exactly once when a generation advance arrives in any order', () => {
    const orders: [string, (host: HostAdapter) => void][] = [
      [
        'snapshot before result',
        (host) => {
          host.ingest(withGeneration(3, 1));
          host.ingest(authorResult);
        },
      ],
      [
        'same-version binding, snapshot, then result',
        (host) => {
          host.ingest(withGeneration(2, 1));
          host.ingest(withGeneration(3, 1));
          host.ingest(authorResult);
        },
      ],
      [
        'result before snapshot',
        (host) => {
          host.ingest(authorResult);
          host.ingest(withGeneration(3, 1));
        },
      ],
    ];
    for (const [label, deliver] of orders) {
      const host = setup();
      host.ingest(authorAction);
      expect(host.sendEdit(authorEdit, 'native-6'), label).toBe(true);
      deliver(host);
      expect(outcomes(host), label).toHaveLength(1);
      expect(outcomes(host)[0], label).toMatchObject({
        requestId: 'native-6',
        baseVersion: 2,
        resultVersion: 3,
        status: 'accepted',
      });
      expect(host.nativeAction(), label).toBeNull();
      expect(host.snapshot()?.viewBinding?.contextGeneration, label).toBe(1);
    }
  });

  it('settles an uncorrelated pending action once as cancelled when the generation really advances', () => {
    const host = setup();
    host.ingest(nativeAction);
    host.ingest(withGeneration(2, 1));
    expect(outcomes(host)).toHaveLength(1);
    expect(outcomes(host)[0]).toMatchObject({
      requestId: 'native-1',
      baseVersion: 2,
      resultVersion: 2,
      status: 'cancelled',
    });
    expect(outcomes(host)[0]?.reason).toContain('context changed');
    expect(host.nativeAction()).toBeNull();
    expect(host.notice()).toContain('context changed');
    // Later advances and the host's own cancellation add no second outcome.
    host.ingest(withGeneration(2, 2));
    host.ingest({
      protocol: 2,
      kind: 'nativeCancel',
      requestId: 'native-1',
      baseVersion: 2,
      reason:
        'The designer context changed; the pending action was not applied.',
    });
    expect(outcomes(host)).toHaveLength(1);
  });

  it('never drops a pending action on a protocol error without one outcome', () => {
    for (const correlated of [false, true]) {
      const host = setup();
      host.ingest(correlated ? authorAction : nativeAction);
      if (correlated) host.sendEdit(authorEdit, 'native-6');
      host.ingest({
        protocol: 2,
        kind: 'protocolError',
        supportedVersion: 2,
        reason: 'Malformed',
      });
      expect(outcomes(host)).toHaveLength(1);
      expect(outcomes(host)[0]).toMatchObject({ status: 'cancelled' });
      host.ingest(snapshot(3));
      host.ingest(authorResult);
      expect(outcomes(host), 'late result adds nothing').toHaveLength(1);
    }
  });
});

describe('focus probe', () => {
  afterEach(() => {
    delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
    vi.restoreAllMocks();
  });

  it('attests the frame DOM focus and changes no designer state', () => {
    for (const focused of [true, false]) {
      const posted: unknown[] = [];
      (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
        postMessage: (message: unknown) => posted.push(message),
      });
      vi.spyOn(globalThis.document, 'hasFocus').mockReturnValue(focused);
      TestBed.resetTestingModule();
      const host = TestBed.inject(HostAdapter);
      posted.length = 0;
      const sent = host.sent().length;
      host.ingest({ protocol: 2, kind: 'focusProbe', probeId: 'probe-1' });
      expect(posted).toEqual([
        { protocol: 2, kind: 'focusProbeResult', probeId: 'probe-1', focused },
      ]);
      expect(host.sent(), 'not a document message').toHaveLength(sent);
    }
  });

  describe('without OS window focus', () => {
    // `isTrusted` cannot be forged on a real event: capture the frame's own
    // listeners and invoke them with event-shaped objects.
    const answers = (): {
      ask: () => boolean;
      fire: (type: string, trusted: boolean) => void;
      host: HostAdapter;
      posted: unknown[];
    } => {
      const posted: unknown[] = [];
      (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
        postMessage: (message: unknown) => posted.push(message),
      });
      vi.restoreAllMocks();
      vi.spyOn(globalThis.document, 'hasFocus').mockReturnValue(false);
      const listeners = new Map<string, (event: unknown) => void>();
      const add = globalThis.addEventListener.bind(globalThis);
      vi.spyOn(globalThis, 'addEventListener').mockImplementation(((
        type: string,
        listener: (event: unknown) => void,
        options?: unknown,
      ) => {
        listeners.set(type, listener);
        add(type, listener as EventListener, options as boolean);
      }) as typeof globalThis.addEventListener);
      TestBed.resetTestingModule();
      const host = TestBed.inject(HostAdapter);
      return {
        host,
        posted,
        ask: () => {
          posted.length = 0;
          host.ingest({ protocol: 2, kind: 'focusProbe', probeId: 'probe-1' });
          return (posted[0] as { focused: boolean }).focused;
        },
        fire: (type, trusted) =>
          listeners.get(type)!({ type, isTrusted: trusted }),
      };
    };

    it('is not focused before any gesture', () => {
      expect(answers().ask()).toBe(false);
    });

    it('counts a trusted pointer or key gesture until the frame blurs', () => {
      for (const gesture of ['pointerdown', 'keydown']) {
        const { ask, fire } = answers();
        expect(ask()).toBe(false);
        fire(gesture, true);
        expect(ask(), `${gesture} moves workbench focus here`).toBe(true);
        fire('blur', true);
        expect(ask(), 'focus left the frame').toBe(false);
        fire(gesture, true);
        expect(ask(), 'a new gesture returns it').toBe(true);
      }
    });

    it('attests a history request at the moment of the gesture, whatever follows', () => {
      const { ask, fire, host, posted } = answers();
      host.ingest(snapshot(2));
      fire('pointerdown', true);
      expect(host.sendHistory('history-1', 'undo')).toBe(true);
      expect(posted.at(-1)).toMatchObject({ kind: 'history', focused: true });
      // VS Code's own focus handoff blurs the frame after the click: the
      // request keeps what it said, a later read does not.
      fire('blur', true);
      expect(ask()).toBe(false);
    });

    it('does not attest a history request issued without focus', () => {
      const { host, posted } = answers();
      host.ingest(snapshot(2));
      expect(host.sendHistory('history-2', 'undo')).toBe(true);
      expect(posted.at(-1)).toMatchObject({ kind: 'history', focused: false });
    });

    it('lets a gesture vouch for focus only while it is recent', () => {
      let now = 1_000_000;
      const { ask, fire, host, posted } = answers();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      host.ingest(snapshot(2));
      fire('pointerdown', true);
      now += GESTURE_FOCUS_WINDOW_MS - 1;
      expect(ask(), 'a recent gesture').toBe(true);
      expect(host.domFocusEvidence()).toBe(true);
      // A long idle with no blur: the user may have moved on silently.
      now += 10_000;
      expect(ask(), 'the probe follows the same rule').toBe(false);
      expect(host.sendHistory('history-idle', 'undo')).toBe(true);
      expect(posted.at(-1)).toMatchObject({ kind: 'history', focused: false });
      fire('keydown', true);
      expect(ask(), 'a new gesture renews it').toBe(true);
    });

    it('carries the original evidence when a request is replayed later', () => {
      let now = 1_000_000;
      const { fire, host, posted } = answers();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      host.ingest(snapshot(2));
      fire('pointerdown', true);
      const atGesture = host.domFocusEvidence();
      now += 30_000;
      expect(host.sendHistory('history-held', 'undo', atGesture)).toBe(true);
      expect(posted.at(-1)).toMatchObject({ kind: 'history', focused: true });
    });

    it('never counts a scripted gesture', () => {
      const { ask, fire } = answers();
      fire('pointerdown', false);
      fire('keydown', false);
      expect(ask()).toBe(false);
    });

    it('removes its listeners when destroyed', () => {
      answers();
      const remove = vi.spyOn(globalThis, 'removeEventListener');
      TestBed.resetTestingModule();
      const types = remove.mock.calls.map(([type]) => type);
      for (const type of ['pointerdown', 'keydown', 'blur'])
        expect(types).toContain(type);
    });
  });

  it('ignores a malformed probe', () => {
    const posted: unknown[] = [];
    (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
      postMessage: (message: unknown) => posted.push(message),
    });
    TestBed.resetTestingModule();
    const host = TestBed.inject(HostAdapter);
    posted.length = 0;
    host.ingest({ protocol: 2, kind: 'focusProbe', probeId: 'bad id' });
    host.ingest({ protocol: 2, kind: 'focusProbe' });
    expect(posted).toEqual([]);
  });
});
