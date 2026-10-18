import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { EditorComponent } from './editor.component';
import { HostAdapter } from './host-adapter';

const diagnostic: Diagnostic = {
  code: 'PAGE_DIMENSIONS',
  category: 'invalid-value',
  severity: 'error',
  range: { start: 0, end: 0 },
  message: 'Use positive page dimensions.',
  correctiveAction: 'Correct the page size.',
  blockedOperations: [],
};

function snapshotMessage(options: {
  capabilities?: readonly string[];
  diagnostics?: readonly Diagnostic[];
  placeholder?: boolean;
  version?: number;
  id?: string;
  label?: string;
  name?: string;
}): HostMessage {
  const version = options.version ?? 2;
  return {
    protocol: 1,
    kind: 'snapshot',
    version,
    sourceLength: 0,
    structure: { nodes: [], truncated: false },
    projection: {
      status: 'editable',
      capabilities: ['source', 'projection'],
      diagnostics: options.diagnostics ?? [],
    },
    scene: {
      version,
      page: { left: 0, top: 0, width: 816, height: 1056 },
      body: { left: 0, top: 0, width: 576, height: 192 },
      items: [
        {
          id: options.id ?? '2:3',
          bounds: { left: 24, top: 24, width: 288, height: 48 },
          label: options.label ?? 'Title: Hello',
          placeholder: options.placeholder ?? false,
          name: options.name ?? 'Title',
          text: 'Hello',
          geometry: {
            left: '0.25in',
            top: '0.25in',
            width: '3in',
            height: '0.5in',
          },
          style: {
            fontFamily: null,
            fontSize: '14pt',
            fontWeight: 'Bold',
            fontStyle: null,
            color: null,
            textAlign: null,
          },
          capabilities: options.capabilities ?? [
            'textbox',
            'name',
            'text',
            'left',
            'top',
            'width',
            'height',
            'style',
          ],
        },
      ],
    },
  };
}

function mount() {
  const fixture = TestBed.createComponent(EditorComponent);
  const host = TestBed.inject(HostAdapter);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, host, element, settle };
}

describe('editor surface', () => {
  for (const status of ['invalid-source', 'source-only'] as const)
    it(`keeps safe Structure, native history and source access in ${status}`, async () => {
      const { fixture, host, element, settle } = mount();
      const message = snapshotMessage({});
      if (message.kind !== 'snapshot') throw new Error('Expected snapshot');
      host.ingest({
        ...message,
        projection: { ...message.projection, status },
        scene: null,
      });
      await settle();
      expect(element.textContent).toContain(
        status === 'invalid-source' ? 'Invalid XML' : 'Source-only report',
      );
      expect(element.querySelector('rdlc-authoring')).toBeNull();
      expect(element.querySelector('rdlc-structure-tree')).not.toBeNull();
      expect(
        [...element.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Undo' && !button.disabled,
        ),
      ).toBe(true);
      expect(host.sent()).toEqual([]);
      fixture.destroy();
    });
  it('synchronizes Structure/body/data selections and uses view-only context menus', async () => {
    const { fixture, host, element, settle } = mount();
    const message = snapshotMessage({});
    if (message.kind !== 'snapshot') throw new Error('Expected snapshot');
    host.ingest({
      ...message,
      structure: {
        truncated: true,
        nodes: [
          {
            id: '2:1',
            parentId: null,
            kind: 'report',
            name: null,
            label: 'Report',
            range: { start: 0, end: 0 },
            preservedReason: null,
          },
          {
            id: '2:3',
            parentId: '2:1',
            kind: 'textbox',
            name: 'Title',
            label: 'Title',
            range: { start: 0, end: 0 },
            preservedReason: null,
          },
          {
            id: '2:8',
            parentId: '2:1',
            kind: 'dataset',
            name: 'Sales',
            label: 'Sales',
            range: { start: 0, end: 0 },
            preservedReason: null,
          },
        ],
      },
    });
    await settle();
    const component = fixture.componentInstance;
    const zoom = component.view().zoom;
    component.selectTree({ id: '2:3', additive: false });
    await settle();
    expect(component.selected()?.id).toBe('2:3');
    expect(component.view().zoom).toBe(zoom);
    component.selectTree({ id: '2:8', additive: true });
    await settle();
    expect(component.selectedIds()).toEqual([]);
    expect(component.acceptedSelection().structureTargetId).toBe('2:8');
    component.select(0);
    await settle();
    const canvas = element.querySelector<HTMLElement>('.viewport')!;
    canvas.focus();
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(component.contextMenu()).not.toBeNull();
    const menu = element.querySelector<HTMLElement>('[role=menu]')!;
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(component.contextMenu()).toBeNull();
    expect(document.activeElement).toBe(canvas);
    expect(host.sent()).toEqual([]);
    fixture.destroy();
  });
  it('keeps tree/menu typing native, navigates tabs and exposes truthful Preview/status', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(snapshotMessage({}));
    await settle();
    const preview = element.querySelector<HTMLButtonElement>(
      '[aria-label="Preview unavailable"]',
    );
    expect(preview?.disabled).toBe(true);
    const tabs = element.querySelectorAll<HTMLButtonElement>('[role=tab]');
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await settle();
    expect(fixture.componentInstance.leftTab()).toBe('structure');
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    tabs[1]!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(host.sent()).toEqual([]);
    fixture.destroy();
  });
  it('selects an accepted dataset definition without a geometry selection', async () => {
    const { fixture, host, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.openCreation('dataset');
    fixture.componentInstance.author({
      targetId: '2:1',
      payload: { action: 'createDataset', name: 'Orders' },
    });
    const request = host.sent().at(-1) as { requestId: string };
    const next = directSnapshot(3, '3:4');
    host.ingest({
      ...next,
      authoring: {
        ...next.authoring,
        datasets: [{ id: '3:20', name: 'Orders', fields: [] }],
      },
    });
    host.ingest({
      protocol: 1,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 3,
      changed: true,
      accepted: true,
      mappings: [],
      reason: 'APPLIED',
      diagnostics: [],
    });
    await settle();
    expect(fixture.componentInstance.selectedDataset()?.name).toBe('Orders');
    expect(fixture.componentInstance.selectedIds()).toEqual([]);
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(host.sent()).toHaveLength(1);
  });
  it('preserves raw expressions/colors on initialization and expansion and associates refusal with accepted fields', async () => {
    const { fixture, host, element, settle } = mount();
    const snapshot = directSnapshot();
    host.ingest({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        items: snapshot.scene.items.map((item) => ({
          ...item,
          style: {
            ...item.style,
            fontWeight: '=Parameters!Weight.Value',
            color: '#80112233',
          },
        })),
      },
    });
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    const weight = element.querySelector<HTMLSelectElement>(
      '[data-property="fontWeight"]',
    )!;
    const color = element.querySelector<HTMLInputElement>(
      '[data-property="color"]',
    )!;
    expect(weight.value).toBe('=Parameters!Weight.Value');
    expect(color.value).toBe('#80112233');
    for (const details of element.querySelectorAll<HTMLDetailsElement>(
      'rdlc-textbox-properties details',
    )) {
      details.open = false;
      details.open = true;
    }
    fixture.componentInstance.setView({ unit: 'mm' });
    expect(host.sent()).toHaveLength(0);
    fixture.componentInstance.commit({ property: 'width', value: '-1in' });
    const request = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 1,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Width must be positive',
      diagnostics: [],
    });
    await settle();
    expect(fixture.componentInstance.selected()?.bounds?.width).toBe(288);
    expect(
      element
        .querySelector('[data-property="width"]')
        ?.getAttribute('aria-describedby'),
    ).toBe('textbox-refusal');
    expect(element.textContent).toContain('Accepted Width: 3in');
  });
  for (const gesture of ['nudge', 'marquee', 'resize', 'pan'] as const)
    it(`host resize cancels ${gesture} and drains deferred panels without committing`, async () => {
      const { fixture, host, element, settle } = mount();
      host.ingest(directSnapshot());
      await settle();
      const component = fixture.componentInstance;
      component.select(0);
      await settle();
      const canvas = element.querySelector<HTMLElement>('.viewport')!;
      const target = element.querySelector<HTMLElement>(
        gesture === 'marquee' ? '.body' : '.item',
      )!;
      target.setPointerCapture = () => {};
      target.hasPointerCapture = () => false;
      const event = {
        button: 0,
        pointerId: 1,
        currentTarget: target,
        target,
        clientX: gesture === 'marquee' ? 500 : 30,
        clientY: gesture === 'marquee' ? 150 : 30,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as PointerEvent;
      if (gesture === 'pan') {
        canvas.setPointerCapture = () => {};
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 1,
            button: 0,
            clientX: 30,
            clientY: 30,
            bubbles: true,
          }),
        );
      } else if (gesture === 'nudge')
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      else if (gesture === 'marquee') component.startMarquee(event);
      else component.startGesture(event, 0, 'se');
      component.toggleOverlay('left');
      expect(component.overlay()).toBeNull();
      component.workspaceResize(640, 480);
      await settle();
      expect(component.preview()).toBeNull();
      expect(component.marquee()).toBeNull();
      expect(component.nudge()).toBeNull();
      expect(host.sent()).toHaveLength(0);
      expect(component.overlay()).toBe('left');
    });
  for (const snapshotFirst of [false, true])
    it(`closes creation and selects only an accepted named textbox (${snapshotFirst})`, async () => {
      const { fixture, host, element, settle } = mount();
      const blank = directSnapshot();
      host.ingest({ ...blank, scene: { ...blank.scene, items: [] } });
      await settle();
      fixture.componentInstance.openCreation('textbox');
      await settle();
      const form = element.querySelector<HTMLFormElement>('.left-panel form')!;
      form.querySelector('input')!.value = 'Title';
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await settle();
      const request = host.sent().at(-1) as { requestId: string };
      expect(fixture.componentInstance.selected()).toBeNull();
      const next = directSnapshot(3, '3:4');
      const result = {
        protocol: 1,
        kind: 'editResult',
        requestId: request.requestId,
        baseVersion: 2,
        version: 3,
        changed: true,
        accepted: true,
        mappings: [],
        reason: 'APPLIED',
        diagnostics: [],
      };
      host.ingest(snapshotFirst ? next : result);
      await settle();
      host.ingest(snapshotFirst ? result : next);
      await settle();
      expect(fixture.componentInstance.creation()).toBeNull();
      expect(fixture.componentInstance.selected()?.name).toBe('Title');
      expect(host.sent()).toHaveLength(1);
    });
  it('retains a refused creation without fabricating selection or retrying', async () => {
    const { fixture, host, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.openCreation('textbox');
    fixture.componentInstance.author({
      targetId: '2:1',
      payload: { action: 'createTextbox', name: 'Title' },
    });
    const request = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 1,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Name already exists',
      diagnostics: [],
    });
    await settle();
    expect(fixture.componentInstance.creation()).toBe('textbox');
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(host.sent()).toHaveLength(1);
  });
  it('keeps local input history native and guards Code XML behind Apply/Discard/Cancel', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    const input = element.querySelector<HTMLInputElement>(
      '[data-property="text"]',
    )!;
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const undo = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(false);
    fixture.componentInstance.openSource();
    expect(fixture.componentInstance.conflict()).not.toBeNull();
    expect(host.sent()).toHaveLength(0);
    fixture.componentInstance.cancelConflict();
    expect(input.value).toBe('Draft');
    fixture.componentInstance.openSource();
    fixture.componentInstance.discardDraft();
    expect(host.sent().at(-1)).toMatchObject({ kind: 'openSource' });
  });
  it('cancels even a below-threshold pointer anchor before host layout changes without sending edits', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.select(0);
    const item = element.querySelector<HTMLElement>('.item')!;
    item.setPointerCapture = vi.fn();
    item.hasPointerCapture = () => false;
    fixture.componentInstance.startGesture(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        button: 0,
        clientX: 30,
        clientY: 30,
      }),
      0,
      'move',
    );
    const count = host.sent().length;
    fixture.componentInstance.workspaceResize(640, 480);
    expect(fixture.componentInstance.preview()).toBeNull();
    expect(host.sent().length).toBe(count);
  });
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());
  function directSnapshot(version = 2, id = '2:3') {
    const message = snapshotMessage({ version, id });
    if (message.kind !== 'snapshot' || !message.scene)
      throw new Error('Expected scene');
    return {
      ...message,
      authoring: {
        id: `${version}:0`,
        page: {
          width: '8.5in',
          height: '11in',
          top: '0in',
          right: '0in',
          bottom: '0in',
          left: '0in',
          bodyWidth: '6in',
          bodyHeight: '2in',
        },
        datasets: [],
        tables: [],
      },
      scene: {
        ...message.scene,
        items: message.scene.items.map((item) => ({
          ...item,
          kind: 'textbox',
          operations: Object.fromEntries(
            ['moveX', 'moveY', 'resizeX', 'resizeY'].map((key) => [
              key,
              { eligible: true, reason: null },
            ]),
          ),
        })),
      },
    };
  }

  for (const handle of ['move', 'se'] as const) {
    for (const snapshotFirst of [true, false]) {
      it(`does not steal authoring focus after ${handle}, snapshot first: ${snapshotFirst}`, async () => {
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        const { fixture, host, element, settle } = mount();
        host.ingest(directSnapshot());
        await settle();
        const originalAuthoring = element.querySelector('rdlc-authoring')!;
        const item = element.querySelector('button.item') as HTMLElement;
        item.setPointerCapture = () => {};
        item.hasPointerCapture = () => false;
        const event = {
          button: 0,
          pointerId: 1,
          currentTarget: item,
          clientX: 0,
          clientY: 0,
          preventDefault() {},
          stopPropagation() {},
        } as unknown as PointerEvent;
        const component = fixture.componentInstance;
        focus.mockClear();
        component.startGesture(event, 0, handle);
        component.finishGesture({ ...event, clientX: 8, clientY: 4 });
        await settle();
        expect(host.pending()).not.toBeNull();
        const requestId = (host.sent()[0] as { requestId: string }).requestId;
        const next = directSnapshot(3, '3:4');
        const accepted = {
          ...next,
          scene: {
            ...next.scene,
            items: next.scene.items.map((item) => ({
              ...item,
              bounds:
                handle === 'move'
                  ? { left: 32, top: 28, width: 288, height: 48 }
                  : { left: 24, top: 24, width: 296, height: 52 },
            })),
          },
        };
        const result = {
          protocol: 1,
          kind: 'editResult',
          requestId,
          baseVersion: 2,
          version: 3,
          accepted: true,
          changed: true,
          mappings: [{ sourceId: '2:3', resultId: '3:4' }],
          reason: 'APPLIED',
          diagnostics: [],
        };
        host.ingest(snapshotFirst ? accepted : result);
        await settle();
        host.ingest(snapshotFirst ? result : accepted);
        await settle();
        expect(element.contains(originalAuthoring)).toBe(false);
        expect(host.pending()).toBeNull();
        expect(component.selected()?.id).toBe('3:4');
        expect(component.selected()?.bounds).toEqual(
          accepted.scene.items[0]!.bounds,
        );
        const authoringCalls = () =>
          focus.mock.calls.filter((_, index) => {
            const target = focus.mock.contexts[index];
            return (
              target instanceof HTMLElement &&
              target.tagName === 'RDLC-AUTHORING'
            );
          });
        expect(authoringCalls()).toHaveLength(0);
        host.ingest(accepted);
        await settle();
        expect(authoringCalls()).toHaveLength(0);
        expect(host.sent()).toHaveLength(1);
      });
    }
  }

  function multipleSnapshot() {
    const message = directSnapshot();
    const item = message.scene.items[0]!;
    return {
      ...message,
      scene: {
        ...message.scene,
        items: [
          { ...item, sourceOrder: 0 },
          {
            ...item,
            id: '2:4',
            kind: 'table',
            label: 'Other',
            name: 'Other',
            sourceOrder: 1,
            bounds: { left: 340, top: 100, width: 100, height: 40 },
          },
          {
            id: '2:5',
            kind: 'preserved',
            label: 'Locked',
            sourceOrder: 2,
            placeholder: true,
            bounds: null,
          },
          {
            ...item,
            id: '2:6',
            kind: 'cell',
            parentTableId: '2:4',
            label: 'Cell',
          },
        ],
      },
    };
  }

  it('toggles body membership and primary, hides scalar forms and includes locked placeholders in Select All', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(multipleSnapshot());
    await settle();
    const component = fixture.componentInstance;
    component.select(0);
    component.select(1, true);
    await settle();
    expect(component.selectedIds()).toEqual(['2:3', '2:4']);
    expect(element.textContent).toContain('2 selected');
    expect(element.querySelector('rdlc-textbox-properties')).toBeNull();
    expect(element.querySelector('rdlc-authoring')).toBeNull();
    expect(element.querySelectorAll('[data-handle]')).toHaveLength(0);
    component.arrange('align', 'right');
    expect(host.sent()[0]).toMatchObject({
      payload: {
        action: 'align',
        targetIds: ['2:3', '2:4'],
        primaryId: '2:4',
        mode: 'right',
      },
    });
  });

  it('Select All, cell exclusivity, Escape and accessible list membership leave the host untouched', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(multipleSnapshot());
    await settle();
    const component = fixture.componentInstance;
    component.selectAll();
    await settle();
    expect(component.selectedIds()).toEqual(['2:3', '2:4', '2:5']);
    expect(component.bulkReason('horizontal')).toContain('Locked');
    component.select(3, true);
    expect(component.selected()?.kind).toBe('cell');
    expect(component.selectedIds()).toEqual([]);
    component.keydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.selected()).toBeNull();
    const toggles = element.querySelectorAll<HTMLInputElement>(
      'input[data-membership]',
    );
    expect(toggles).toHaveLength(3);
    toggles[0]!.click();
    toggles[1]!.click();
    expect(component.selectedIds()).toEqual(['2:3', '2:4']);
    expect(host.sent()).toHaveLength(0);
  });

  it('moves every selected member from immutable origins and refuses an invalid group preview', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(multipleSnapshot());
    await settle();
    const component = fixture.componentInstance;
    component.setView({ gridSnap: false, guidesSnap: false });
    component.select(0);
    component.select(1, true);
    const item = element.querySelector('button.item') as HTMLElement;
    item.setPointerCapture = () => {};
    item.hasPointerCapture = () => false;
    const event = {
      button: 0,
      pointerId: 1,
      currentTarget: item,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as PointerEvent;
    component.startGesture(event, 0);
    component.moveGesture({ ...event, clientX: 8 });
    await settle();
    expect(element.querySelectorAll('.preview')).toHaveLength(2);
    component.moveGesture({ ...event, clientX: 200 });
    expect(component.gestureNotice()).toContain('beyond the body');
    component.finishGesture({ ...event, clientX: -1000 });
    expect(host.sent()).toHaveLength(0);
    component.startGesture(event, 0);
    component.finishGesture({ ...event, clientX: 8, clientY: 4 });
    expect(host.sent()[0]).toMatchObject({
      payload: { targetIds: ['2:3', '2:4'], dxPt: 6, dyPt: 3 },
    });
  });

  it('marquees only complete body bounds, adds with Shift, clears on blank click and cancels without XML', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(multipleSnapshot());
    await settle();
    const component = fixture.componentInstance;
    const body = element.querySelector('.body') as HTMLElement;
    body.setPointerCapture = () => {};
    body.hasPointerCapture = () => false;
    const event = {
      button: 0,
      pointerId: 1,
      target: body,
      currentTarget: body,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
    } as unknown as PointerEvent;
    component.startMarquee(event);
    component.moveGesture({ ...event, clientX: 12 });
    expect(component.marquee()?.active).toBe(false);
    component.finishGesture({ ...event, clientX: 320, clientY: 80 });
    expect(component.selectedIds()).toEqual(['2:3']);
    component.startMarquee({
      ...event,
      clientX: 330,
      clientY: 90,
      shiftKey: true,
    });
    component.finishGesture({ ...event, clientX: 450, clientY: 150 });
    expect(component.selectedIds()).toEqual(['2:3', '2:4']);
    expect(component.primary()?.id).toBe('2:4');
    component.startMarquee(event);
    component.finishGesture(event);
    expect(component.selectedIds()).toEqual([]);
    component.select(0);
    component.startMarquee(event);
    component.moveGesture({ ...event, clientX: 500, clientY: 180 });
    component.keydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.selectedIds()).toEqual(['2:3']);
    expect(component.marquee()).toBeNull();
    expect(host.sent()).toHaveLength(0);
  });

  it('does not collapse a group on the synthetic click after drag or toggle Shift twice', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(multipleSnapshot());
    await settle();
    const component = fixture.componentInstance;
    const item = element.querySelector('button.item') as HTMLElement;
    const event = {
      button: 0,
      pointerId: 1,
      currentTarget: item,
      clientX: 0,
      clientY: 0,
      shiftKey: true,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as PointerEvent;
    component.select(1);
    component.startGesture(event, 0);
    component.selectClick(
      new MouseEvent('click', { detail: 1, shiftKey: true }),
      0,
    );
    expect(component.selectedIds()).toEqual(['2:4', '2:3']);
    component.selectClick(
      new MouseEvent('click', { detail: 0, shiftKey: true }),
      0,
    );
    expect(component.selectedIds()).toEqual(['2:4']);
  });

  for (const snapshotFirst of [true, false])
    it(`retains ordered group selection and primary through result/snapshot order ${snapshotFirst}`, async () => {
      const { fixture, host, settle } = mount();
      const initial = multipleSnapshot();
      host.ingest(initial);
      await settle();
      const component = fixture.componentInstance;
      component.select(1);
      component.select(0, true);
      component.arrange('align', 'left');
      const requestId = (host.sent()[0] as { requestId: string }).requestId;
      const next = {
        ...initial,
        version: 3,
        scene: {
          ...initial.scene,
          version: 3,
          items: initial.scene.items.map((i, index) => ({
            ...i,
            id: `3:${index + 10}`,
            ...(i.kind === 'cell' ? { parentTableId: '3:11' } : {}),
          })),
        },
      };
      const result = {
        protocol: 1,
        kind: 'editResult',
        requestId,
        baseVersion: 2,
        version: 3,
        accepted: true,
        changed: true,
        mappings: [
          { sourceId: '2:4', resultId: '3:11' },
          { sourceId: '2:3', resultId: '3:10' },
        ],
        reason: 'APPLIED',
        diagnostics: [],
      };
      host.ingest(snapshotFirst ? next : result);
      await settle();
      host.ingest(snapshotFirst ? result : next);
      await settle();
      expect(component.selectedIds()).toEqual(['3:11', '3:10']);
      expect(component.primary()?.id).toBe('3:10');
      host.ingest(next);
      await settle();
      expect(component.selectedIds()).toEqual(['3:11', '3:10']);
    });

  it('previews after three CSS pixels, captures/releases once and submits one immutable move', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.setView({ gridSnap: false, guidesSnap: false });
    const item = element.querySelector('button.item') as HTMLElement;
    let captured = false;
    item.setPointerCapture = () => {
      captured = true;
    };
    item.hasPointerCapture = () => captured;
    item.releasePointerCapture = () => {
      captured = false;
    };
    const component = fixture.componentInstance;
    const event = (x: number, y = 0) =>
      ({
        button: 0,
        pointerId: 1,
        currentTarget: item,
        clientX: x,
        clientY: y,
        preventDefault() {},
        stopPropagation() {},
      }) as unknown as PointerEvent;
    component.startGesture(event(0), 0);
    expect(captured).toBe(true);
    component.moveGesture(event(2));
    expect(component.preview()?.active).toBe(false);
    component.moveGesture(event(4));
    component.moveGesture(event(8, 4));
    expect(component.preview()?.bounds.left).toBe(24);
    expect(host.sent()).toHaveLength(0);
    component.finishGesture(event(8, 4));
    expect(captured).toBe(false);
    expect(host.sent()).toHaveLength(1);
    expect(host.sent()[0]).toMatchObject({
      operation: 'layout',
      payload: { action: 'move', dxPt: 6, dyPt: 3 },
    });
    component.commit({ property: 'text', value: 'overlap' });
    expect(host.sent()).toHaveLength(1);
    await settle();
    expect(element.querySelectorAll('[data-handle]')).toHaveLength(8);
    expect(element.textContent).toContain('Applying edit');
  });

  it('cancels invalid release, Escape, native Undo, capture/focus loss and independent versions', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    const item = element.querySelector('button.item') as HTMLElement;
    item.setPointerCapture = () => {};
    item.hasPointerCapture = () => false;
    const component = fixture.componentInstance;
    const event = {
      button: 0,
      pointerId: 1,
      currentTarget: item,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as PointerEvent;
    component.startGesture(event, 0);
    component.finishGesture({ ...event, clientX: -1000 });
    expect(host.sent()).toHaveLength(0);
    for (const cancel of [
      () => component.keydown(new KeyboardEvent('keydown', { key: 'Escape' })),
      () =>
        component.keydown(
          new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
        ),
      () => component.blur(),
      () => component.captureLost(event),
    ]) {
      component.startGesture(event, 0);
      component.moveGesture({ ...event, clientX: 8 });
      cancel();
      expect(component.preview()).toBeNull();
    }
    component.startGesture(event, 0);
    host.ingest(directSnapshot(3, '3:4'));
    await settle();
    expect(component.preview()).toBeNull();
    expect(component.gestureNotice()).toContain('document changed');
    expect(host.sent()).toHaveLength(0);
  });

  for (const snapshotFirst of [true, false])
    it(`retains selection at the matching mapped result (${snapshotFirst})`, async () => {
      const { fixture, host, settle } = mount();
      host.ingest(directSnapshot());
      await settle();
      fixture.componentInstance.select(0);
      fixture.componentInstance.commit({ property: 'left', value: '1in' });
      const requestId = (host.sent()[0] as { requestId: string }).requestId;
      const result = {
        protocol: 1,
        kind: 'editResult',
        requestId,
        baseVersion: 2,
        version: 3,
        accepted: true,
        changed: true,
        mappings: [{ sourceId: '2:3', resultId: '3:4' }],
        reason: 'APPLIED',
        diagnostics: [],
      };
      host.ingest(snapshotFirst ? directSnapshot(3, '3:4') : result);
      await settle();
      host.ingest(snapshotFirst ? result : directSnapshot(3, '3:4'));
      await settle();
      expect(fixture.componentInstance.selected()?.id).toBe('3:4');
      host.ingest(directSnapshot(3, '3:4'));
      await settle();
      expect(fixture.componentInstance.selected()?.id).toBe('3:4');
      // An independent version reconciles by unique name/kind/parent, not by the old mapping.
      host.ingest(directSnapshot(4, '4:4'));
      await settle();
      expect(fixture.componentInstance.selected()?.id).toBe('4:4');
    });

  it('renders accepted scene items at their authored geometry with labels', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({}));
    await settle();
    const items = element.querySelectorAll('button.item');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('Title: Hello');
    const page = element.querySelector('.page') as HTMLElement;
    expect(page.style.width).toBe('816px');
  });

  it('selects an item and prefills the textbox property form', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({}));
    await settle();
    (element.querySelector('button.item') as HTMLButtonElement).click();
    await settle();
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    );
    expect(name?.value).toBe('Title');
    const fontSize = element.querySelector<HTMLInputElement>(
      '[data-property="fontSize"]',
    );
    expect(fontSize?.value).toBe('14pt');
  });

  it('commits a typed intent on keyboard commit without optimistic authority', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({}));
    await settle();
    (element.querySelector('button.item') as HTMLButtonElement).click();
    await settle();
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    name.value = 'Heading';
    name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await settle();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'edit',
      baseVersion: 2,
      targetId: '2:3',
      payload: { property: 'name', value: 'Heading' },
    });
    // The surface still shows the accepted snapshot until the host confirms.
    expect(element.querySelector('button.item')!.textContent).toContain(
      'Title: Hello',
    );
  });

  it('clears selection across versions and requires an explicit selection before editing', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({}));
    await settle();
    (element.querySelector('button.item') as HTMLButtonElement).click();
    await settle();
    host.ingest(
      snapshotMessage({
        version: 3,
        id: '3:9',
        label: 'Heading: Updated',
        name: 'Heading',
      }),
    );
    await settle();
    expect(element.querySelector('rdlc-textbox-properties')).toBeNull();
    expect(
      element.querySelector('button.item')!.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(host.sent().length).toBe(0);
    (element.querySelector('button.item') as HTMLButtonElement).click();
    await settle();
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    );
    expect(name?.value).toBe('Heading');
    name!.value = 'Heading 2';
    name!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await settle();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'edit',
      baseVersion: 3,
      targetId: '3:9',
      payload: { property: 'name', value: 'Heading 2' },
    });
  });

  it('does not retarget a selected textbox when source inserts or deletes earlier items', async () => {
    const { host, fixture, element, settle } = mount();
    const initial = snapshotMessage({});
    if (initial.kind !== 'snapshot' || !initial.scene)
      throw new Error('Missing scene');
    const item = initial.scene.items[0]!;
    const a = { ...item, id: '2:1', name: 'A' };
    const b = { ...item, id: '2:2', name: 'B' };
    host.ingest({ ...initial, scene: { ...initial.scene, items: [a, b] } });
    await settle();
    (element.querySelectorAll('button.item')[1] as HTMLButtonElement).click();
    await settle();
    expect(fixture.componentInstance.selected()?.name).toBe('B');
    host.ingest({
      ...initial,
      version: 3,
      scene: {
        ...initial.scene,
        version: 3,
        items: [
          { ...item, id: '3:1', name: 'X' },
          { ...a, id: '3:2' },
          { ...b, id: '3:3' },
        ],
      },
    });
    await settle();
    // The logical B survives by unique identity; ordinal 1 (now A) is never retargeted.
    expect(fixture.componentInstance.selected()?.id).toBe('3:3');
    (element.querySelectorAll('button.item')[1] as HTMLButtonElement).click();
    await settle();
    host.ingest({
      ...initial,
      version: 4,
      scene: { ...initial.scene, version: 4, items: [{ ...b, id: '4:1' }] },
    });
    await settle();
    expect(fixture.componentInstance.selected()).toBeNull();
  });

  it('omits unsupported sections while retaining supported textbox properties', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({ capabilities: ['textbox', 'name', 'text'] }));
    await settle();
    (element.querySelector('button.item') as HTMLButtonElement).click();
    await settle();
    expect(element.querySelector('[data-property="left"]')).toBeNull();
    expect(
      element.querySelector<HTMLInputElement>('[data-property="name"]')
        ?.disabled,
    ).toBe(false);
  });

  it('presents diagnostics and offers a source-access action', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({ diagnostics: [diagnostic] }));
    await settle();
    expect(element.textContent).toContain('PAGE_DIMENSIONS');
    expect(element.textContent).toContain('Use positive page dimensions.');
    const open = [...element.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Open source',
    )!;
    open.click();
    await settle();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'openSource',
      version: 2,
    });
  });
});

const eligible = Object.fromEntries(
  ['moveX', 'moveY', 'resizeX', 'resizeY'].map((key) => [
    key,
    { eligible: true, reason: null },
  ]),
);
const locked = Object.fromEntries(
  ['moveX', 'moveY', 'resizeX', 'resizeY'].map((key) => [
    key,
    {
      eligible: false,
      reason: 'Unsupported construct; edit this item in source.',
    },
  ]),
);

function draftSnapshot(version = 2): HostMessage {
  const message = snapshotMessage({ version, id: `${version}:3` });
  if (message.kind !== 'snapshot' || !message.scene)
    throw new Error('Expected scene');
  const title = { ...message.scene.items[0]!, kind: 'textbox' as const };
  const preserved = {
    kind: 'preserved' as const,
    operations: locked,
    placeholder: true,
    name: null,
    text: null,
    geometry: null,
    style: null,
    capabilities: [],
  };
  return {
    ...message,
    authoring: {
      id: `${version}:0`,
      page: { width: '8.5in', bodyWidth: '6in', bodyHeight: '2in' },
      datasets: [],
      tables: [],
    },
    scene: {
      ...message.scene,
      items: [
        { ...title, operations: eligible },
        {
          ...title,
          id: `${version}:4`,
          name: 'Other',
          label: 'Other: Second',
          bounds: { left: 24, top: 96, width: 96, height: 24 },
          operations: eligible,
        },
        {
          ...preserved,
          id: `${version}:5`,
          bounds: { left: 360, top: 24, width: 96, height: 48 },
          label: 'Rectangle (unsupported)',
        },
        {
          ...preserved,
          id: `${version}:6`,
          bounds: null,
          label: 'Chart (unsupported)',
        },
      ],
    },
  } as unknown as HostMessage;
}

describe('property drafts, limitations and focus', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  const button = (root: HTMLElement, text: string) =>
    [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(text),
    ) as HTMLButtonElement;
  const listButton = (root: HTMLElement, text: string) =>
    [
      ...root.querySelectorAll<HTMLButtonElement>(
        'ul[aria-label="Report items"] button',
      ),
    ].find((b) => b.textContent?.includes(text))!;

  async function withDraft() {
    const mounted = mount();
    mounted.host.ingest(draftSnapshot());
    await mounted.settle();
    listButton(mounted.element, 'Title').click();
    await mounted.settle();
    const name = mounted.element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    name.focus();
    name.value = 'Draft';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await mounted.settle();
    return { ...mounted, name, component: mounted.fixture.componentInstance };
  }

  async function conflictBySelection(
    mounted: Awaited<ReturnType<typeof withDraft>>,
  ) {
    const other = listButton(mounted.element, 'Other');
    other.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    // Native blur/change happens between pointerdown and click.
    mounted.name.dispatchEvent(new Event('change', { bubbles: true }));
    other.click();
    await mounted.settle();
  }

  it('tracks dirtiness before blur and asks before a selection change', async () => {
    const mounted = await withDraft();
    const { element, host, component } = mounted;
    expect(component.draft()).not.toBeNull();
    expect(element.textContent).toContain('Unapplied draft');
    await conflictBySelection(mounted);
    expect(host.sent()).toHaveLength(0);
    expect(component.selected()?.name).toBe('Title');
    expect(component.conflict()).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Apply draft');
  });

  it('Cancel keeps the draft and the current action state', async () => {
    const mounted = await withDraft();
    await conflictBySelection(mounted);
    button(mounted.element, 'Cancel new action').click();
    await mounted.settle();
    expect(mounted.component.conflict()).toBeNull();
    expect(mounted.component.draft()).not.toBeNull();
    expect(mounted.name.value).toBe('Draft');
    expect(mounted.component.selected()?.name).toBe('Title');
    expect(document.activeElement).toBe(mounted.name);
    expect(mounted.host.sent()).toHaveLength(0);
  });

  it('Discard abandons the draft explicitly, then performs the action', async () => {
    const mounted = await withDraft();
    await conflictBySelection(mounted);
    button(mounted.element, 'Discard draft').click();
    await mounted.settle();
    expect(mounted.component.draft()).toBeNull();
    expect(mounted.component.selected()?.name).toBe('Other');
    expect(mounted.host.sent()).toHaveLength(0);
  });

  it('Apply submits once and waits for the accepted snapshot', async () => {
    const mounted = await withDraft();
    await conflictBySelection(mounted);
    const apply = button(mounted.element, 'Apply draft');
    apply.click();
    apply.click();
    await mounted.settle();
    expect(mounted.host.sent()).toHaveLength(1);
    expect(mounted.host.sent()[0]).toMatchObject({
      operation: 'setProperty',
      targetId: '2:3',
      payload: { property: 'name', value: 'Draft' },
    });
    expect(mounted.component.selected()?.name).toBe('Title');
    expect(mounted.component.conflict()).toBeNull();
    const requestId = (mounted.host.sent()[0] as { requestId: string })
      .requestId;
    mounted.host.ingest({
      protocol: 1,
      kind: 'editResult',
      requestId,
      baseVersion: 2,
      version: 2,
      accepted: false,
      changed: false,
      mappings: [],
      reason: 'INVALID_NAME',
      diagnostics: [],
    });
    await mounted.settle();
    expect(mounted.host.pending()).toBeNull();
    expect(mounted.element.contains(document.activeElement)).toBe(true);
    expect(mounted.element.textContent).toContain('Blocked');
  });

  it('gestures and other forms conflict with a draft instead of overwriting it', async () => {
    const mounted = await withDraft();
    const item =
      mounted.element.querySelectorAll<HTMLElement>('button.item')[1]!;
    item.setPointerCapture = () => {};
    item.hasPointerCapture = () => false;
    mounted.component.startGesture(
      {
        button: 0,
        pointerId: 1,
        currentTarget: item,
        clientX: 0,
        clientY: 0,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as PointerEvent,
      1,
    );
    expect(mounted.component.preview()).toBeNull();
    expect(mounted.component.conflict()).not.toBeNull();
    await mounted.settle();
    button(mounted.element, 'Cancel new action').click();
    await mounted.settle();
    mounted.component.author({
      targetId: '2:1',
      payload: { action: 'createTextbox', name: 'Heading' },
    });
    await mounted.settle();
    expect(mounted.host.sent()).toHaveLength(0);
    button(mounted.element, 'Discard draft').click();
    await mounted.settle();
    expect(mounted.host.sent().at(-1)).toMatchObject({
      operation: 'author',
      payload: { action: 'createTextbox', name: 'Heading' },
    });
  });

  it('an independent version invalidates the stale draft with notice', async () => {
    const mounted = await withDraft();
    mounted.host.ingest(draftSnapshot(3));
    await mounted.settle();
    expect(mounted.component.draft()).toBeNull();
    expect(mounted.component.conflict()).toBeNull();
    expect(mounted.element.textContent).toContain('draft was discarded');
    expect(
      mounted.element.querySelector<HTMLInputElement>('[data-property="name"]')
        ?.value,
    ).toBe('Title');
    expect(mounted.host.sent()).toHaveLength(0);
  });

  it('explains limitations, offers item source access and suppresses handles', async () => {
    const { host, element, settle } = mount();
    host.ingest(draftSnapshot());
    await settle();
    expect(element.querySelectorAll('button.item')).toHaveLength(3);
    expect(listButton(element, 'Chart').textContent).toContain(
      'unknown bounds',
    );
    listButton(element, 'Rectangle').click();
    await settle();
    const limits = element.querySelector('[aria-label="Limitations"]')!;
    expect(limits.textContent).toContain('Rectangle (unsupported)');
    expect(limits.textContent).toContain('edit this item in source');
    expect(element.querySelectorAll('[data-handle]')).toHaveLength(0);
    button(element, 'Open Rectangle (unsupported) in source').click();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'openSource',
      targetId: '2:5',
    });
    listButton(element, 'Chart').click();
    await settle();
    expect(
      element.querySelector('[aria-label="Limitations"]')!.textContent,
    ).toContain('unknown');
    expect(element.querySelector('[aria-label="Delete textbox"]')).toBeNull();
  });

  it('announces selection and status through live regions', async () => {
    const { host, element, settle, fixture } = mount();
    host.ingest(draftSnapshot());
    await settle();
    const feedback = element.querySelector('.feedback')!;
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    fixture.componentInstance.selectAll();
    await settle();
    expect(element.querySelector('.status')!.textContent).toContain(
      '4 selected',
    );
  });
});

describe('navigation, placement and keyboard nudges', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
  });

  async function mounted() {
    const m = mount();
    m.host.ingest(draftSnapshot());
    await m.settle();
    const component = m.fixture.componentInstance;
    const viewport = m.element.querySelector<HTMLElement>('.viewport')!;
    return { ...m, component, viewport };
  }
  const pointer = (target: HTMLElement, x: number, y: number, alt = false) =>
    ({
      button: 0,
      pointerId: 1,
      currentTarget: target,
      clientX: x,
      clientY: y,
      altKey: alt,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as PointerEvent;
  function grab(m: Awaited<ReturnType<typeof mounted>>, index: number) {
    const item = m.element.querySelectorAll<HTMLElement>('button.item')[index]!;
    item.setPointerCapture = () => {};
    item.hasPointerCapture = () => false;
    m.component.startGesture(pointer(item, 0, 0), index);
    return item;
  }
  function drag(
    m: Awaited<ReturnType<typeof mounted>>,
    index: number,
    dx: number,
    dy: number,
    alt = false,
  ) {
    const item = grab(m, index);
    m.component.moveGesture(pointer(item, dx, dy, alt));
    m.component.finishGesture(pointer(item, dx, dy, alt));
  }
  const key = (
    target: EventTarget,
    type: 'keydown' | 'keyup',
    init: KeyboardEventInit,
  ) => {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  const edits = (host: HostAdapter) =>
    host.sent().filter((m) => (m as { kind: string }).kind === 'edit');

  it('restores validated per-view state and persists it only through the webview state API', async () => {
    let saved: unknown = {
      view: { zoom: 2, unit: 'mm', gridSpacing: -1, guidesSnap: false },
    };
    (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
      postMessage() {},
      getState: () => saved,
      setState: (state: unknown) => (saved = state),
    });
    const m = await mounted();
    expect(m.component.view()).toMatchObject({
      zoom: 2,
      unit: 'mm',
      gridSpacing: 10,
      guidesSnap: false,
    });
    expect(m.element.textContent).toContain('Ignored invalid saved view');
    m.component.zoomStep(1);
    m.component.setView({ gridVisible: false });
    await m.settle();
    expect(saved).toMatchObject({
      view: { zoom: 2.5, gridVisible: false, unit: 'mm' },
    });
    expect(
      m.host.sent().map((message) => (message as { kind: string }).kind),
    ).toEqual(['ready']);
  });

  it('zooms within 25–400% and navigates without edits or selection changes', async () => {
    const m = await mounted();
    m.component.select(0);
    for (let i = 0; i < 20; i++) m.component.zoomStep(1);
    expect(m.component.view().zoom).toBe(4);
    for (let i = 0; i < 20; i++) m.component.zoomStep(-1);
    expect(m.component.view().zoom).toBe(0.25);
    m.component.zoomPercent('150');
    expect(m.component.view().zoom).toBe(1.5);
    m.component.zoomPercent('abc');
    expect(m.component.view().zoom).toBe(1.5);
    expect(m.component.gestureNotice()).toContain('Zoom');
    m.component.zoomPercent('1000');
    expect(m.component.view().zoom).toBe(4);
    m.component.fit('page');
    m.component.fit('body');
    m.component.revealSelection();
    m.component.zoomTo(1);
    await m.settle();
    const page = m.element.querySelector<HTMLElement>('.page')!;
    expect(page.style.transform).toBe('scale(1)');
    expect(m.component.selectedIds()).toEqual(['2:3']);
    expect(edits(m.host)).toHaveLength(0);
    expect(m.element.textContent).toContain('Authoring layout');
  });

  for (const zoom of [0.25, 0.5, 1, 2, 4])
    it(`drags the same report-space distance at ${zoom * 100}% with scroll`, async () => {
      const m = await mounted();
      m.component.setView({ gridSnap: false, guidesSnap: false });
      m.component.zoomTo(zoom);
      await m.settle();
      m.viewport.scrollLeft = 37;
      m.viewport.scrollTop = 11;
      // 32×16 unzoomed CSS px = 24×12pt, beyond the 3px click threshold even at 25%.
      drag(m, 0, 32 * zoom, 16 * zoom);
      expect(edits(m.host)[0]).toMatchObject({
        payload: { action: 'move', dxPt: 24, dyPt: 12 },
      });
    });

  it('snaps x to the body-origin grid, y to a nearer guide, and Alt bypasses both', async () => {
    const m = await mounted();
    drag(m, 0, 8, 4);
    // Title (18pt, 18pt) + (6pt, 3pt) = (24, 21): x → grid 20; y → Rectangle top 18
    // (3pt = 4 CSS px) wins over grid 20 on that axis.
    const first = edits(m.host)[0] as {
      payload: { dxPt: number; dyPt: number };
    };
    expect(first.payload.dxPt).toBeCloseTo(2, 9);
    expect(first.payload.dyPt).toBeCloseTo(0, 9);
    TestBed.resetTestingModule();
    const alt = await mounted();
    drag(alt, 0, 8, 4, true);
    expect(edits(alt.host)[0]).toMatchObject({
      payload: { dxPt: 6, dyPt: 3 },
    });
    expect(alt.component.view()).toMatchObject({ gridSnap: true });
  });

  it('labels the active sibling guide and snaps to it before the grid', async () => {
    const m = await mounted();
    m.component.setView({ gridSnap: false });
    const item = grab(m, 1);
    m.component.moveGesture(pointer(item, 4, 40));
    await m.settle();
    expect(m.element.querySelector('.guide')?.textContent).toContain('Title');
    m.component.setView({ guidesVisible: false });
    await m.settle();
    expect(m.element.querySelector('.guide')).toBeNull();
    m.component.finishGesture(pointer(item, 4, 40));
    expect(edits(m.host)[0]).toMatchObject({
      payload: { targetIds: ['2:4'], dxPt: 0, dyPt: 30 },
    });
  });

  it('keeps the previous grid setting when spacing input is invalid', async () => {
    const m = await mounted();
    m.component.gridInput('0', 'pt');
    expect(m.component.view().gridSpacing).toBe(10);
    expect(m.component.gestureNotice()).toContain('Grid spacing');
    m.component.gridInput('0.5', 'cm');
    expect(m.component.view()).toMatchObject({
      gridSpacing: 0.5,
      gridUnit: 'cm',
    });
    m.component.gridInput('Infinity', 'mm');
    expect(m.component.view().gridUnit).toBe('cm');
    expect(edits(m.host)).toHaveLength(0);
  });

  it('nudges exactly 1pt and aggregates held repeats into one move on keyup', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    m.viewport.focus();
    const down = key(m.viewport, 'keydown', { key: 'ArrowRight' });
    expect(down.defaultPrevented).toBe(true);
    key(m.viewport, 'keydown', { key: 'ArrowRight', repeat: true });
    key(m.viewport, 'keydown', { key: 'ArrowRight', repeat: true });
    expect(edits(m.host)).toHaveLength(0);
    expect(m.component.nudge()).toMatchObject({ dx: 3, dy: 0 });
    key(m.viewport, 'keyup', { key: 'ArrowRight' });
    expect(edits(m.host)).toHaveLength(1);
    // Exact deltas: the 10pt grid does not apply to nudges.
    expect(edits(m.host)[0]).toMatchObject({
      payload: { action: 'move', targetIds: ['2:3'], dxPt: 3, dyPt: 0 },
    });
  });

  it('Shift+arrow nudges 10pt and a discrete press is its own operation', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    key(m.viewport, 'keydown', { key: 'ArrowDown', shiftKey: true });
    key(m.viewport, 'keyup', { key: 'ArrowDown', shiftKey: true });
    expect(edits(m.host)).toHaveLength(1);
    expect(edits(m.host)[0]).toMatchObject({
      payload: { dxPt: 0, dyPt: 10 },
    });
  });

  it('cancels repeats on Escape, focus loss and independent versions', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    key(m.viewport, 'keydown', { key: 'ArrowDown' });
    key(m.viewport, 'keydown', { key: 'Escape' });
    key(m.viewport, 'keyup', { key: 'ArrowDown' });
    key(m.viewport, 'keydown', { key: 'ArrowDown' });
    window.dispatchEvent(new Event('blur'));
    key(m.viewport, 'keyup', { key: 'ArrowDown' });
    key(m.viewport, 'keydown', { key: 'ArrowDown' });
    m.host.ingest(draftSnapshot(3));
    await m.settle();
    expect(m.component.nudge()).toBeNull();
    key(m.viewport, 'keyup', { key: 'ArrowDown' });
    expect(edits(m.host)).toHaveLength(0);
  });

  it('refuses an invalid nudge and never intercepts inputs or clipboard shortcuts', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    for (let i = 0; i < 19; i++)
      key(m.viewport, 'keydown', { key: 'ArrowLeft', repeat: i > 0 });
    key(m.viewport, 'keyup', { key: 'ArrowLeft' });
    expect(edits(m.host)).toHaveLength(0);
    expect(m.component.gestureNotice()).toContain('Invalid');
    const input = m.element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    expect(key(input, 'keydown', { key: 'ArrowLeft' }).defaultPrevented).toBe(
      false,
    );
    expect(m.component.nudge()).toBeNull();
    expect(
      key(input, 'keydown', { key: 'c', ctrlKey: true }).defaultPrevented,
    ).toBe(false);
    expect(
      key(m.viewport, 'keydown', { key: 'ArrowRight', ctrlKey: true })
        .defaultPrevented,
    ).toBe(false);
    expect(edits(m.host)).toHaveLength(0);
  });

  it('keeps keyboard controls labeled, overflow reachable and focus usable after refusal', async () => {
    const m = await mounted();
    for (const label of [
      'Zoom out',
      'Zoom in',
      '100%',
      'Fit Page',
      'Fit Body',
      'Reveal Selection',
    ])
      expect(
        [...m.element.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === label && !b.disabled,
        ),
      ).toBe(true);
    const zoomOut = [...m.element.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Zoom out',
    )!;
    zoomOut.focus();
    zoomOut.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement?.textContent?.trim()).toBe('Zoom in');
    for (const label of [
      'Zoom percent',
      'Grid spacing',
      'Grid unit',
      'Display unit',
      'Show grid',
      'Snap to grid',
      'Show guides',
      'Snap to guides',
    ])
      expect(
        m.element.querySelector(`[aria-label="${label}"]`),
        label,
      ).not.toBeNull();
    expect(m.viewport.tabIndex).toBe(0);
    expect(m.viewport.getAttribute('aria-label')).toContain('Authoring layout');
    // A refused nudge leaves focus on the canvas, not trapped elsewhere.
    m.viewport.focus();
    key(m.viewport, 'keydown', { key: 'ArrowLeft' });
    key(m.viewport, 'keyup', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(m.viewport);
  });
});

/** Dispatches through the DOM, so host listener bindings are exercised (drag-preview-cancelled). */
describe('real pointer event dispatch', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  const pointer = (type: string, init: { x: number; y: number }) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: init.x,
      clientY: init.y,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    return event;
  };
  /** Mimics a browser: capture on pointerdown, implicit release after pointerup. */
  function capturing(element: HTMLElement) {
    let captured = false;
    element.setPointerCapture = () => (captured = true);
    element.hasPointerCapture = () => captured;
    element.releasePointerCapture = () => (captured = false);
  }
  function gesture(target: HTMLElement, path: readonly [number, number][]) {
    const [start, ...rest] = path;
    target.dispatchEvent(
      pointer('pointerdown', { x: start![0], y: start![1] }),
    );
    for (const [x, y] of rest)
      window.dispatchEvent(pointer('pointermove', { x, y }));
    const [x, y] = path.at(-1)!;
    window.dispatchEvent(pointer('pointerup', { x, y }));
    window.dispatchEvent(pointer('lostpointercapture', { x, y }));
    target.dispatchEvent(pointer('click', { x, y }));
  }
  async function mounted() {
    const m = mount();
    m.host.ingest(draftSnapshot());
    await m.settle();
    const component = m.fixture.componentInstance;
    component.setView({ gridSnap: false, guidesSnap: false });
    await m.settle();
    const edits = () =>
      m.host.sent().filter((s) => (s as { kind: string }).kind === 'edit');
    return { ...m, component, edits };
  }

  it('submits a released move instead of cancelling it on capture loss', async () => {
    const m = await mounted();
    const item = m.element.querySelector<HTMLElement>('button.item')!;
    capturing(item);
    gesture(item, [
      [0, 0],
      [4, 2],
      [8, 4],
    ]);
    await m.settle();
    expect(m.edits()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'move',
          targetIds: ['2:3'],
          dxPt: 6,
          dyPt: 3,
        }),
      }),
    ]);
    expect(m.element.textContent).not.toContain('Preview cancelled');
  });

  it('submits a released resize handle', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    const handle = m.element.querySelector<HTMLElement>('[data-handle="se"]')!;
    capturing(handle);
    gesture(handle, [
      [0, 0],
      [8, 4],
    ]);
    // Title is 18,18 216×36pt; +6pt/+3pt on the south-east corner.
    expect(m.edits()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'resize',
          handle: 'se',
          xPt: 240,
          yPt: 57,
        }),
      }),
    ]);
  });

  it('applies a released marquee selection', async () => {
    const m = await mounted();
    const body = m.element.querySelector<HTMLElement>('.body')!;
    capturing(body);
    gesture(body, [
      [400, 150],
      [10, 10],
    ]);
    await m.settle();
    expect(m.component.selectedIds()).toEqual(['2:3', '2:4']);
    expect(m.element.textContent).not.toContain('Preview cancelled');
  });

  it('a real pointercancel still cancels the preview without an edit', async () => {
    const m = await mounted();
    const item = m.element.querySelector<HTMLElement>('button.item')!;
    capturing(item);
    item.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    window.dispatchEvent(pointer('pointermove', { x: 8, y: 4 }));
    expect(m.component.preview()?.active).toBe(true);
    window.dispatchEvent(pointer('pointercancel', { x: 8, y: 4 }));
    await m.settle();
    expect(m.component.preview()).toBeNull();
    expect(m.edits()).toHaveLength(0);
    expect(m.component.gestureNotice()).toBe(
      'Preview cancelled; document unchanged.',
    );
  });

  it('releases the draft pointer guard after a real pointerup', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    const name = m.element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    name.focus();
    name.value = 'Renamed';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    // A press on a conflicting region arms the guard; its release must disarm it.
    const list = m.element.querySelector<HTMLElement>(
      'ul[aria-label="Report items"] button',
    )!;
    list.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    m.component.commit({ property: 'name', value: 'Guarded' });
    expect(m.edits()).toHaveLength(0);
    window.dispatchEvent(pointer('pointerup', { x: 0, y: 0 }));
    await new Promise((resolve) => setTimeout(resolve));
    m.component.commit({ property: 'name', value: 'Renamed' });
    expect(m.edits()).toEqual([
      expect.objectContaining({
        operation: 'setProperty',
        payload: { property: 'name', value: 'Renamed' },
      }),
    ]);
  });
});

describe('clipboard reuse', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  async function mounted(message: HostMessage = draftSnapshot()) {
    const m = mount();
    m.host.ingest(message);
    await m.settle();
    const component = m.fixture.componentInstance;
    const viewport = m.element.querySelector<HTMLElement>('.viewport')!;
    return { ...m, component, viewport };
  }
  const keydown = (target: EventTarget, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  /** Ctrl/Cmd+C/X/V reach the webview as clipboard events (VS Code replays them via execCommand). */
  const clipboardKeys: Readonly<Record<string, string>> = {
    c: 'copy',
    x: 'cut',
    v: 'paste',
  };
  const key = (target: EventTarget, init: KeyboardEventInit) => {
    const type = clipboardKeys[init.key ?? ''];
    if (!type) return keydown(target, init);
    const event = new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const requests = (host: HostAdapter) =>
    host.sent().filter((m) => (m as { kind: string }).kind === 'clipboard') as {
      action: string;
      targetIds?: string[];
      unit?: string;
      requestId: string;
      baseVersion: number;
    }[];
  const result = (
    request: { requestId: string; action: string },
    patch: Record<string, unknown>,
  ) => ({
    protocol: 1,
    kind: 'clipboardResult',
    requestId: request.requestId,
    action: request.action,
    baseVersion: 2,
    version: 3,
    accepted: true,
    changed: true,
    reason: 'APPLIED',
    inserted: [],
    removed: [],
    diagnostics: [],
    ...patch,
  });

  it('canvas shortcuts send host requests; form shortcuts stay native', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    const input = m.element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    for (const k of ['c', 'x', 'v', 'd'])
      expect(key(input, { key: k, ctrlKey: true }).defaultPrevented).toBe(
        false,
      );
    expect(requests(m.host)).toHaveLength(0);
    expect(key(m.viewport, { key: 'c', metaKey: true }).defaultPrevented).toBe(
      true,
    );
    const [copy] = requests(m.host);
    expect(copy).toMatchObject({
      action: 'copy',
      targetIds: ['2:3'],
      baseVersion: 2,
    });
    expect(copy!.unit).toBeUndefined();
    m.host.ingest(
      result(copy!, { version: 2, changed: false, reason: 'COPIED' }),
    );
    await m.settle();
    expect(m.host.pending()).toBeNull();
    expect(m.host.notice()).toContain('Copied');
    // A raw keydown alone never triggers twice; focus lost to the body still pastes.
    keydown(m.viewport, { key: 'v', ctrlKey: true });
    expect(requests(m.host)).toHaveLength(1);
    key(document.body, { key: 'v' });
    expect(requests(m.host)).toHaveLength(2);
    m.host.ingest(
      result(requests(m.host)[1]!, {
        accepted: false,
        changed: false,
        version: 2,
        reason: 'CLIPBOARD_UNAVAILABLE',
      }),
    );
    await m.settle();
    expect(m.component.selectedIds()).toEqual(['2:3']);
    key(m.viewport, { key: 'v', ctrlKey: true });
    const paste = requests(m.host).at(-1)!;
    // The host owns offsets (10pt, 20pt, ...); paste carries only the display unit.
    expect(paste).toEqual({
      protocol: 1,
      kind: 'clipboard',
      requestId: paste.requestId,
      baseVersion: 2,
      action: 'paste',
      unit: 'pt',
    });
  });

  it('an explicit cut needs no extra acknowledgement', async () => {
    const m = await mounted();
    m.component.select(0);
    await m.settle();
    key(m.viewport, { key: 'x', ctrlKey: true });
    const [cut] = requests(m.host);
    expect(cut).toEqual({
      protocol: 1,
      kind: 'clipboard',
      requestId: cut!.requestId,
      baseVersion: 2,
      action: 'cut',
      targetIds: ['2:3'],
    });
    expect(m.element.querySelector('[data-cut-confirm]')).toBeNull();
  });

  it('refuses locked placeholders, pending and draft conflicts without requests', async () => {
    const m = await mounted();
    m.component.selectAll();
    await m.settle();
    m.component.clipboard('copy');
    expect(m.component.gestureNotice()).toContain('preservation-only');
    m.component.clearSelection();
    m.component.clipboard('duplicate');
    expect(m.component.gestureNotice()).toContain('Select one or more');
    expect(requests(m.host)).toHaveLength(0);
    m.component.select(0);
    await m.settle();
    m.component.clipboard('duplicate');
    expect(requests(m.host)).toHaveLength(1);
    m.component.clipboard('copy');
    key(m.viewport, { key: 'v', ctrlKey: true });
    expect(requests(m.host)).toHaveLength(1);
    m.host.ingest(
      result(requests(m.host)[0]!, {
        accepted: false,
        changed: false,
        version: 2,
        reason: 'PASTE_REFUSED',
      }),
    );
    await m.settle();
    expect(m.host.pending()).toBeNull();
    const input = m.element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await m.settle();
    key(m.viewport, { key: 'd', ctrlKey: true });
    expect(requests(m.host)).toHaveLength(1);
    expect(m.component.conflict()).not.toBeNull();
  });

  it('a table cell selection cannot be copied separately', async () => {
    const message = draftSnapshot() as Extract<
      HostMessage,
      { kind: 'snapshot' }
    >;
    const items = message.scene!.items;
    const table = {
      ...items[0]!,
      id: '2:7',
      kind: 'table' as const,
      name: 'T',
      label: 'T',
    };
    const cell = {
      ...items[0]!,
      id: '2:8',
      kind: 'cell' as const,
      parentTableId: '2:7',
      name: 'C',
      label: 'C',
      bounds: { left: 30, top: 30, width: 20, height: 10 },
    };
    const m = await mounted({
      ...message,
      scene: { ...message.scene!, items: [...items, table, cell] },
    });
    m.component.select(5);
    await m.settle();
    m.component.clipboard('copy');
    expect(m.component.gestureNotice()).toContain('whole table');
    expect(requests(m.host)).toHaveLength(0);
  });

  for (const snapshotFirst of [true, false])
    it(`selects and reveals inserted copies (${snapshotFirst ? 'snapshot' : 'result'} first)`, async () => {
      const m = await mounted();
      m.component.select(0);
      await m.settle();
      const reveal = vi.spyOn(m.component, 'revealSelection');
      m.component.clipboard('duplicate');
      const [duplicate] = requests(m.host);
      expect(duplicate).toMatchObject({ action: 'duplicate', unit: 'pt' });
      const next = draftSnapshot(3);
      const outcome = result(duplicate!, { inserted: ['3:4'] });
      if (snapshotFirst) m.host.ingest(next);
      m.host.ingest(outcome);
      if (!snapshotFirst) m.host.ingest(next);
      await m.settle();
      await m.settle();
      expect(m.component.selectedIds()).toEqual(['3:4']);
      expect(m.component.primary()?.id).toBe('3:4');
      expect(reveal).toHaveBeenCalledTimes(1);
      expect(m.host.pending()).toBeNull();
    });
});
