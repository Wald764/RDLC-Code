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
      it(`uses scroll-neutral authoring focus after ${handle}, snapshot first: ${snapshotFirst}`, async () => {
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
        expect(authoringCalls()).toEqual([[{ preventScroll: true }]]);
        host.ingest(accepted);
        await settle();
        expect(authoringCalls()).toHaveLength(1);
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

  it('disables preservation-only properties while keeping them visible', async () => {
    const { host, element, settle } = mount();
    host.ingest(snapshotMessage({ capabilities: ['textbox', 'name', 'text'] }));
    await settle();
    (element.querySelector('button.item') as HTMLButtonElement).click();
    await settle();
    expect(
      element.querySelector<HTMLInputElement>('[data-property="left"]')
        ?.disabled,
    ).toBe(true);
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
    const create = mounted.element.querySelector<HTMLFormElement>(
      '[aria-label="Create textbox"]',
    )!;
    create.querySelector('input')!.value = 'Heading';
    create.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
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
