import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HostAdapter } from './host-adapter';
import { EditorComponent } from './editor.component';

function snapshot(version: number, status = 'editable') {
  return {
    protocol: 1,
    kind: 'snapshot',
    version,
    projection: { status, capabilities: [], diagnostics: [] },
    scene: null,
  };
}

describe('document lifecycle transport', () => {
  beforeEach(() => TestBed.resetTestingModule());
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
    const draft = element.querySelector<HTMLInputElement>('input')!;
    draft.value = 'Obsolete';
    draft.focus();
    accept(2);
    await settle();
    expect(element.contains(draft)).toBe(false);
    expect(element.querySelector<HTMLInputElement>('input')!.value).toBe('');
    expect(document.activeElement?.tagName.toLowerCase()).toBe(
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
});
