import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
