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
          name: 'Title',
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
      host.ingest(directSnapshot(4, '4:4'));
      await settle();
      expect(fixture.componentInstance.selected()).toBeNull();
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
    expect(name?.value).toBe('Title');
    name!.value = 'Heading';
    name!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await settle();
    expect(host.sent().at(-1)).toMatchObject({
      kind: 'edit',
      baseVersion: 3,
      targetId: '3:9',
      payload: { property: 'name', value: 'Heading' },
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
    expect(fixture.componentInstance.selected()).toBeNull();
    fixture.componentInstance.commit({ property: 'text', value: 'Wrong item' });
    expect(host.sent().length).toBe(0);
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
