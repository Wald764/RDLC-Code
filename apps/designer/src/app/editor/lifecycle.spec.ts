import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostAdapter } from './host-adapter';
import { EditorComponent } from './editor.component';

function snapshot(version: number, status = 'editable') {
  return {
    protocol: 1,
    kind: 'snapshot',
    version,
    sourceLength: 0,
    structure: { nodes: [], truncated: false },
    projection: { status, capabilities: [], diagnostics: [] },
    scene: null,
  };
}

describe('native history settlement', () => {
  it('retains source access for invalid hierarchy metadata and reflects failed history that changed the document', () => {
    TestBed.resetTestingModule();
    const host = TestBed.inject(HostAdapter);
    host.ingest({
      ...snapshot(2, 'source-only'),
      structure: { nodes: [{ id: 'forged' }], truncated: false },
    });
    expect(host.snapshot()?.version).toBe(2);
    expect(host.notice()).toContain('Code XML');
    host.openSource();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'openSource',
      version: 2,
    });
    host.sendHistory('failed-history', 'undo');
    host.ingest({
      protocol: 1,
      kind: 'historyResult',
      requestId: 'failed-history',
      baseVersion: 2,
      resultVersion: 3,
      action: 'undo',
      accepted: false,
      changed: true,
      reason: 'Command failed after observed change',
    });
    expect(host.pending()).not.toBeNull();
    host.ingest(snapshot(3, 'source-only'));
    expect(host.pending()).toBeNull();
    expect(host.snapshot()?.version).toBe(3);
    expect(host.outcome()?.accepted).toBe(false);
    expect(host.outcome()?.changed).toBe(true);
    expect(host.sent()).toHaveLength(2);
  });
  for (const snapshotFirst of [false, true])
    it(`settles changed history exactly once, snapshot first ${snapshotFirst}`, () => {
      TestBed.resetTestingModule();
      const host = TestBed.inject(HostAdapter);
      host.ingest(snapshot(2, 'source-only'));
      expect(host.sendHistory('history-1', 'undo')).toBe(true);
      expect(host.sendHistory('history-2', 'redo')).toBe(false);
      const result = {
        protocol: 1,
        kind: 'historyResult',
        requestId: 'history-1',
        baseVersion: 2,
        resultVersion: 3,
        action: 'undo',
        accepted: true,
        changed: true,
      };
      if (snapshotFirst) host.ingest(snapshot(3, 'source-only'));
      host.ingest(result);
      if (!snapshotFirst) {
        expect(host.pending()).not.toBeNull();
        host.ingest(snapshot(3, 'source-only'));
      }
      expect(host.pending()).toBeNull();
      host.ingest(result);
      expect(host.sent().length).toBe(1);
    });
  for (const accepted of [false, true])
    it(`settles no-op/failure without a new version (${accepted})`, () => {
      TestBed.resetTestingModule();
      const host = TestBed.inject(HostAdapter);
      host.ingest(snapshot(2));
      host.sendHistory('history-1', 'redo');
      host.ingest({
        protocol: 1,
        kind: 'historyResult',
        requestId: 'history-1',
        baseVersion: 2,
        resultVersion: 2,
        action: 'redo',
        accepted,
        changed: false,
        reason: 'Nothing changed',
      });
      expect(host.pending()).toBeNull();
      expect(host.notice()).toContain('Nothing changed');
    });
});

describe('nudge continuity', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const ops = Object.fromEntries(
    ['moveX', 'moveY', 'resizeX', 'resizeY'].map((k) => [
      k,
      { eligible: true, reason: null },
    ]),
  );
  const scene = (version: number, left: number) => ({
    ...snapshot(version),
    scene: {
      version,
      page: { left: 0, top: 0, width: 816, height: 1056 },
      body: { left: 0, top: 0, width: 576, height: 192 },
      items: [
        {
          id: `${version}:1`,
          kind: 'textbox',
          label: 'A',
          name: 'A',
          placeholder: false,
          bounds: { left, top: 24, width: 96, height: 24 },
          operations: ops,
          capabilities: [],
        },
      ],
    },
  });
  const press = (target: EventTarget, type: string, k = 'ArrowRight') =>
    target.dispatchEvent(
      new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }),
    );

  it('retains selection across accepted nudges so consecutive presses need no reselection', async () => {
    const fixture = TestBed.createComponent(EditorComponent);
    const host = TestBed.inject(HostAdapter);
    host.ingest(scene(2, 24));
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.select(0);
    fixture.detectChanges();
    const viewport = fixture.nativeElement.querySelector('.viewport');
    for (const [base, next] of [
      [2, 3],
      [3, 4],
    ] as const) {
      press(viewport, 'keydown');
      press(viewport, 'keyup');
      const edit = host.sent().at(-1) as { requestId: string };
      expect(edit).toMatchObject({
        kind: 'edit',
        baseVersion: base,
        payload: { targetIds: [`${base}:1`], dxPt: 1 },
      });
      host.ingest({
        protocol: 1,
        kind: 'editResult',
        requestId: edit.requestId,
        baseVersion: base,
        version: next,
        accepted: true,
        changed: true,
        mappings: [{ sourceId: `${base}:1`, resultId: `${next}:1` }],
        reason: 'APPLIED',
        diagnostics: [],
      });
      host.ingest(scene(next, 24 + (next - 2) * (4 / 3)));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.selectedIds()).toEqual([`${next}:1`]);
    }
    expect(
      host.sent().filter((m) => (m as { kind: string }).kind === 'edit'),
    ).toHaveLength(2);
  });

  it('blocks a nudge while pending and cancels repeats before native Undo', async () => {
    const fixture = TestBed.createComponent(EditorComponent);
    const host = TestBed.inject(HostAdapter);
    host.ingest(scene(2, 24));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.select(0);
    fixture.detectChanges();
    const viewport = fixture.nativeElement.querySelector('.viewport');
    press(viewport, 'keydown');
    viewport.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    expect(fixture.componentInstance.nudge()).toBeNull();
    press(viewport, 'keyup');
    expect(host.sent()).toHaveLength(1);
    expect(host.sent()[0]).toMatchObject({ kind: 'history', action: 'undo' });
    const request = host.sent()[0] as { requestId: string };
    host.ingest({
      protocol: 1,
      kind: 'historyResult',
      requestId: request.requestId,
      baseVersion: 2,
      resultVersion: 2,
      action: 'undo',
      accepted: true,
      changed: false,
    });
    press(viewport, 'keydown');
    press(viewport, 'keyup');
    expect(host.pending()).not.toBeNull();
    press(viewport, 'keydown');
    press(viewport, 'keyup');
    expect(host.sent()).toHaveLength(2);
  });
});

describe('document lifecycle transport', () => {
  beforeEach(() => TestBed.resetTestingModule());
  for (const accepted of [true, false])
    it(`settles ${accepted ? 'no-op' : 'refusal'} without replay`, () => {
      const host = TestBed.inject(HostAdapter);
      host.ingest(snapshot(1));
      host.sendEdit({
        operation: 'layout',
        requestId: 'unchanged',
        baseVersion: 1,
        payload: {
          action: 'move',
          targetIds: ['1:1'],
          dxPt: 0,
          dyPt: 0,
          unit: 'pt',
        },
      });
      host.ingest({
        protocol: 1,
        kind: 'editResult',
        requestId: 'unchanged',
        baseVersion: 1,
        version: 1,
        accepted,
        changed: false,
        mappings: [],
        reason: 'UNCHANGED',
        diagnostics: [],
      });
      expect(host.pending()).toBeNull();
      expect(host.outcome()?.changed).toBe(false);
      expect(host.sent()).toHaveLength(1);
    });
  it('discards a delayed own result after a later independent version without replay', () => {
    const host = TestBed.inject(HostAdapter);
    host.ingest(snapshot(1));
    host.sendEdit({
      operation: 'layout',
      requestId: 'delayed-own',
      baseVersion: 1,
      payload: {
        action: 'move',
        targetIds: ['1:1'],
        dxPt: 1,
        dyPt: 0,
        unit: 'pt',
      },
    });
    host.ingest(snapshot(3));
    host.ingest({
      protocol: 1,
      kind: 'editResult',
      requestId: 'delayed-own',
      baseVersion: 1,
      version: 2,
      accepted: true,
      changed: true,
      mappings: [{ sourceId: '1:1', resultId: '2:2' }],
      reason: 'APPLIED',
      diagnostics: [],
    });
    expect(host.pending()).toBeNull();
    expect(host.outcome()).toBeNull();
    expect(host.snapshot()?.version).toBe(3);
    expect(host.sent()).toHaveLength(1);
  });
  it('serializes clipboard actions and discards a stale paste result without replay', () => {
    const host = TestBed.inject(HostAdapter);
    host.ingest(snapshot(1));
    const paste = {
      requestId: 'paste-1',
      baseVersion: 1,
      action: 'paste' as const,
      unit: 'pt' as const,
    };
    expect(host.sendClipboard(paste)).toBe(true);
    expect(host.sendClipboard({ ...paste, requestId: 'paste-2' })).toBe(false);
    expect(
      host.sendEdit({
        operation: 'layout',
        requestId: 'blocked',
        baseVersion: 1,
        payload: {
          action: 'move',
          targetIds: ['1:1'],
          dxPt: 1,
          dyPt: 0,
          unit: 'pt',
        },
      }),
    ).toBe(false);
    host.ingest(snapshot(3));
    host.ingest({
      protocol: 1,
      kind: 'clipboardResult',
      requestId: 'paste-1',
      action: 'paste',
      baseVersion: 1,
      version: 2,
      accepted: true,
      changed: true,
      reason: 'APPLIED',
      inserted: ['2:9'],
      removed: [],
      diagnostics: [],
    });
    expect(host.pending()).toBeNull();
    expect(host.outcome()).toBeNull();
    expect(host.sent()).toHaveLength(1);
  });
  for (const snapshotFirst of [true, false]) {
    it(`serializes mutation and reconciles ${snapshotFirst ? 'snapshot' : 'result'} first`, () => {
      const host = TestBed.inject(HostAdapter);
      host.ingest(snapshot(1));
      const intent = {
        operation: 'layout' as const,
        requestId: 'move',
        baseVersion: 1,
        payload: {
          action: 'move' as const,
          targetIds: ['1:1'],
          unit: 'pt' as const,
          dxPt: 1,
          dyPt: 0,
        },
      };
      host.sendEdit(intent);
      host.sendEdit({ ...intent, requestId: 'overlap' });
      expect(host.sent()).toHaveLength(1);
      expect(host.pending()).not.toBeNull();
      const result = {
        protocol: 1,
        kind: 'editResult',
        requestId: 'move',
        baseVersion: 1,
        version: 2,
        accepted: true,
        changed: true,
        mappings: [{ sourceId: '1:1', resultId: '2:2' }],
        reason: 'APPLIED',
        diagnostics: [],
      };
      host.ingest(snapshotFirst ? snapshot(2) : result);
      expect(host.pending()).not.toBeNull();
      host.ingest(snapshotFirst ? result : snapshot(2));
      expect(host.pending()).toBeNull();
      expect(host.outcome()).toMatchObject({
        version: 2,
        baseVersion: 1,
        changed: true,
        mappings: result.mappings,
      });
      const accepted = host.snapshot();
      host.ingest(snapshot(2));
      expect(host.snapshot()).toBe(accepted);
      host.ingest(snapshot(3));
      expect(host.outcome()).toBeNull();
    });
  }
  it('ignores delayed snapshots and duplicate versions without resetting local state', () => {
    const host = TestBed.inject(HostAdapter);
    host.ingest(snapshot(3));
    const accepted = host.snapshot();
    host.ingest(snapshot(2));
    host.ingest(snapshot(3));
    expect(host.snapshot()).toBe(accepted);
    host.ingest({
      protocol: 1,
      kind: 'editResult',
      baseVersion: 1,
      changed: false,
      mappings: [],
      version: 2,
      requestId: 'delayed',
      accepted: true,
      reason: 'APPLIED',
      diagnostics: [],
    });
    expect(host.outcome()).toBeNull();
  });
  it('blocks invalid-source writes but retains source access and explains cancelled drafts', () => {
    const host = TestBed.inject(HostAdapter);
    host.ingest(snapshot(1));
    host.ingest(snapshot(2, 'invalid-source'));
    host.sendEdit({
      requestId: 'invalid',
      baseVersion: 2,
      targetId: '2:1',
      operation: 'setProperty',
      payload: { property: 'text', value: 'Unsafe' },
    });
    expect(host.sent()).toHaveLength(0);
    expect(host.notice()).toContain('draft');
    host.openSource();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'openSource',
      version: 2,
    });
  });
  it('renegotiates protocol errors without retrying a refused edit', () => {
    const host = TestBed.inject(HostAdapter);
    host.ingest(snapshot(1));
    host.ingest({
      protocol: 1,
      kind: 'protocolError',
      supportedVersion: 1,
      reason: 'Stale edit',
    });
    expect(host.notice()).toContain('Stale edit');
    expect(host.sent().at(-1)).toEqual({ protocol: 1, kind: 'ready' });
    expect(
      host
        .sent()
        .some(
          (message: unknown) => (message as { kind: string }).kind === 'edit',
        ),
    ).toBe(false);
  });
  it('recreates version-scoped forms and focus without committing an obsolete draft', async () => {
    const fixture = TestBed.createComponent(EditorComponent);
    const host = TestBed.inject(HostAdapter);
    const element = fixture.nativeElement as HTMLElement;
    const accept = (version: number, status = 'editable') =>
      host.ingest({
        ...snapshot(version, status),
        scene: {
          version,
          page: { left: 0, top: 0, width: 800, height: 1000 },
          body: { left: 0, top: 0, width: 600, height: 200 },
          items: [],
        },
        authoring: {
          id: `${version}:0`,
          page: {
            width: '8in',
            height: '10in',
            top: '1in',
            right: '1in',
            bottom: '1in',
            left: '1in',
            bodyWidth: '6in',
            bodyHeight: '2in',
          },
          datasets: [],
          tables: [],
        },
      });
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    accept(1);
    await settle();
    const draft = element.querySelector<HTMLInputElement>('fieldset input')!;
    draft.value = 'Obsolete';
    draft.focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    accept(2);
    await settle();
    try {
      expect(focus).not.toHaveBeenCalled();
    } finally {
      focus.mockRestore();
    }
    expect(element.contains(draft)).toBe(false);
    expect(
      element.querySelector<HTMLInputElement>('fieldset input')!.value,
    ).toBe('');
    expect(document.activeElement?.tagName.toLowerCase()).not.toBe(
      'rdlc-authoring',
    );
    expect(element.textContent).toContain('Obsolete drafts were cancelled');
    expect(host.sent()).toHaveLength(0);
    accept(3, 'invalid-source');
    await settle();
    expect(element.querySelector('rdlc-authoring')).toBeNull();
    fixture.componentInstance.author({
      targetId: '2:0',
      payload: { action: 'createTextbox', name: 'Unsafe' },
    });
    expect(host.sent()).toHaveLength(0);
    fixture.componentInstance.openSource();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'openSource',
      version: 3,
    });
  });

  it('reconciles independent versions only through unambiguous structural identity', async () => {
    const fixture = TestBed.createComponent(EditorComponent);
    const host = TestBed.inject(HostAdapter);
    const item = (id: string, name: string | null, extra = {}) => ({
      id,
      name,
      kind: 'textbox',
      label: name ?? 'Line (unsupported)',
      placeholder: name === null,
      bounds: { left: 0, top: 0, width: 10, height: 10 },
      ...extra,
    });
    const accept = (version: number, items: unknown[]) =>
      host.ingest({
        ...snapshot(version),
        scene: {
          version,
          page: { left: 0, top: 0, width: 800, height: 1000 },
          body: { left: 0, top: 0, width: 600, height: 200 },
          items,
        },
      });
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const component = fixture.componentInstance;
    accept(1, [
      item('1:1', 'A'),
      item('1:2', 'Orders', { kind: 'table' }),
      item('1:3', 'Cell', { kind: 'cell', parentTableId: '1:2' }),
    ]);
    await settle();
    component.select(0);
    component.select(1, true);
    await settle();
    accept(2, [
      item('2:9', 'Inserted'),
      item('2:1', 'A'),
      item('2:2', 'Orders', { kind: 'table' }),
    ]);
    await settle();
    expect(component.selectedIds()).toEqual(['2:1', '2:2']);
    expect(component.primary()?.id).toBe('2:2');
    accept(3, [item('3:1', 'A'), item('3:2', 'A'), item('3:3', 'Orders')]);
    await settle();
    expect(component.selectedIds()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain(
      'could not be identified unambiguously',
    );
    accept(4, [
      item('4:2', 'Orders', { kind: 'table' }),
      item('4:3', 'Cell', { kind: 'cell', parentTableId: '4:2' }),
      item('4:4', null),
    ]);
    await settle();
    component.select(1);
    await settle();
    accept(5, [
      item('5:2', 'Orders', { kind: 'table' }),
      item('5:3', 'Cell', { kind: 'cell', parentTableId: '5:2' }),
      item('5:4', null),
    ]);
    await settle();
    expect(component.selected()?.id).toBe('5:3');
    component.select(2);
    await settle();
    accept(6, [item('6:4', null)]);
    await settle();
    expect(component.selected()).toBeNull();
  });
});
