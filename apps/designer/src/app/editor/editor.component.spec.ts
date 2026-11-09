import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import {
  validateMessage,
  type AuthoringState,
  type HostMessage,
  type NavigationNode,
} from '@rdlc/report-model/protocol';
import type { DesignScene } from '@rdlc/report-model/scene';
import { EditorComponent } from './editor.component';
import { HostAdapter } from './host-adapter';
import {
  IMAGE_ASSET_ENVIRONMENT,
  type ImageAssetEnvironment,
} from './image-assets';
import { imagePlaceholderLabels } from './image-placeholder-labels';

const diagnostic: Diagnostic = {
  code: 'PAGE_DIMENSIONS',
  category: 'invalid-value',
  severity: 'error',
  range: { start: 0, end: 0 },
  message: 'Use positive page dimensions.',
  correctiveAction: 'Correct the page size.',
  blockedOperations: [],
};

/** Authoritative Data projection row; Structure never carries definitions again. */
function dataNode(
  id: string,
  kind: NavigationNode['kind'],
  name: string | null,
  parentId: string | null = null,
  expandedName?: string,
): NavigationNode {
  const expanded =
    expandedName ??
    `{urn:rdlc-code:report}${kind === 'dataset' ? 'DataSet' : kind === 'field' ? 'Field' : kind}`;
  const local = expanded.split('}').at(-1)!;
  return {
    id,
    parentId,
    sourceOrder: 0,
    range: { start: 0, end: 0 },
    expandedName: expanded,
    name,
    kind,
    label: name ? `${local}: ${name}` : local,
    opaqueReason: null,
    capabilities: [
      { operation: 'inspect', eligible: true, reason: null },
      { operation: 'select', eligible: true, reason: null },
      { operation: 'properties', eligible: true, reason: null },
    ],
  };
}

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
    protocol: 2,
    kind: 'snapshot',
    version,
    sourceLength: 0,
    structure: { nodes: [], truncated: false },
    navigation: {
      version,
      structure: { nodes: [], truncated: false },
      data: { nodes: [], truncated: false },
    },
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

function mount(fallback = true) {
  const fixture = TestBed.createComponent(EditorComponent);
  if (fallback)
    fixture.componentInstance.view.update((view) => ({
      ...view,
      leftVisible: true,
    }));
  const host = TestBed.inject(HostAdapter);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, host, element, settle };
}

describe('editor surface', () => {
  it('defaults to compact navigation and exposes an explicit reversible fallback without edits', async () => {
    const { fixture, host, element, settle } = mount(false);
    host.ingest(snapshotMessage({}));
    await settle();
    expect(fixture.componentInstance.view().leftVisible).toBe(false);
    expect(fixture.componentInstance.panelShown('left')).toBe(false);
    fixture.componentInstance.panelAccess('left');
    await settle();
    expect(element.querySelector('[data-card="Textbox"]')).not.toBeNull();
    expect(fixture.componentInstance.panelShown('left')).toBe(true);
    fixture.componentInstance.panelAccess('left');
    await settle();
    expect(fixture.componentInstance.view().leftVisible).toBe(false);
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(false);
  });
  it('defaults absent navigation preferences to compact/closed and keeps inspector, toolbar and status', async () => {
    const { fixture, host, element, settle } = mount(false);
    host.ingest(directSnapshot());
    await settle();
    const component = fixture.componentInstance;
    expect(component.view()).toMatchObject({
      leftVisible: false,
      leftTab: 'components',
      rightVisible: true,
    });
    expect(component.panels().left).toBe(0);
    expect(component.panelShown('left')).toBe(false);
    expect(component.panelShown('right')).toBe(true);
    const toggle = element.querySelector<HTMLElement>('.left-access')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.title).toBe(
      'Show the compact Components and Structure fallback',
    );
    expect(
      element.querySelector<HTMLElement>('#components-panel')!.hidden,
    ).toBe(false);
    expect(element.querySelector<HTMLElement>('#structure-panel')!.hidden).toBe(
      true,
    );
    expect(element.querySelector('#properties-panel')).not.toBeNull();
    expect(
      element.querySelector('[role=toolbar][aria-label="Report commands"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('footer.status .status-text')?.textContent,
    ).toContain('items');
  });
  it('keeps an explicit preference for the open fallback across an open and close', async () => {
    const store = { view: { leftVisible: true } };
    const globals = globalThis as { acquireVsCodeApi?: unknown };
    globals.acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => store,
      setState: () => {},
    });
    try {
      const fixture = TestBed.createComponent(EditorComponent);
      const host = TestBed.inject(HostAdapter);
      const element = fixture.nativeElement as HTMLElement;
      const settle = async () => {
        fixture.detectChanges();
        await fixture.whenStable();
      };
      host.ingest(directSnapshot());
      await settle();
      const component = fixture.componentInstance;
      expect(host.restoredView.invalid).toEqual([]);
      expect(component.view().leftVisible).toBe(true);
      expect(component.panelShown('left')).toBe(true);
      expect(
        element
          .querySelector<HTMLElement>('.left-access')!
          .getAttribute('aria-expanded'),
      ).toBe('true');
      component.panelAccess('left');
      await settle();
      expect(component.view().leftVisible).toBe(false);
      component.panelAccess('left');
      await settle();
      expect(component.view().leftVisible).toBe(true);
      expect(component.panels().left).toBe(220);
      expect(
        host
          .sent()
          .some((message) => validateMessage(message)?.kind === 'edit'),
      ).toBe(false);
    } finally {
      delete globals.acquireVsCodeApi;
    }
  });
  it('retains structure, local data and catalog drag behind the labeled explicit fallback', async () => {
    const { fixture, host, element, settle } = mount(false);
    const snapshot = directSnapshot();
    host.ingest({
      ...snapshot,
      structure: {
        nodes: [
          {
            id: '2:1',
            parentId: null,
            kind: 'report',
            label: 'Report',
            name: null,
            range: { start: 0, end: 0 },
            preservedReason: null,
          },
        ],
        truncated: false,
      },
      navigation: {
        version: 2,
        structure: { nodes: [], truncated: false },
        data: {
          nodes: [dataNode('2:20', 'dataset', 'Orders')],
          truncated: false,
        },
      },
      authoring: {
        ...snapshot.authoring,
        datasets: [{ id: '2:20', name: 'Orders', fields: [] }],
      },
    });
    await settle();
    const component = fixture.componentInstance;
    component.select(0);
    await settle();
    const toggle = element.querySelector<HTMLElement>('.left-access')!;
    expect(toggle.getAttribute('aria-description')).toBe(
      'Compact designer navigation fallback with components, report structure and local data. Supports HTML drag insertion.',
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    component.panelAccess('left');
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      element.querySelector<HTMLButtonElement>('[data-card="Textbox"]')!
        .draggable,
    ).toBe(true);
    component.showTab('structure');
    await settle();
    const structure = element.querySelector<HTMLElement>('#structure-panel')!;
    expect(structure.hidden).toBe(false);
    expect(structure.textContent).toContain('Orders');
    expect(element.querySelector('#properties-panel')?.textContent).toContain(
      'Bind selected textbox to Orders field',
    );
    // Compact fallback keeps data access through the Data projection.
    const definition =
      structure.querySelector<HTMLElement>('[data-node="2:20"]');
    expect(definition).toBeTruthy();
    definition!.click();
    await settle();
    expect(component.selectedDataset()?.name).toBe('Orders');
    expect(component.selected()).toBeNull();
    expect(component.view().scrollTop).toBe(0);
    expect(component.view().scrollLeft).toBe(0);
  });
  it('defers an elective fallback toggle until the active gesture ends', async () => {
    const { fixture, host, element, settle } = mount(false);
    host.ingest(directSnapshot());
    await settle();
    const component = fixture.componentInstance;
    component.select(0);
    await settle();
    const canvas = element.querySelector<HTMLElement>('.viewport')!;
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(component.nudge()).not.toBeNull();
    const sent = host.sent().length;
    component.panelAccess('left');
    await settle();
    expect(component.view().leftVisible).toBe(false);
    expect(component.panelShown('left')).toBe(false);
    canvas.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }),
    );
    await settle();
    expect(component.view().leftVisible).toBe(true);
    expect(component.panelShown('left')).toBe(true);
    // Only the deferred nudge move is sent; toggling the panel sends nothing.
    expect(host.sent()).toHaveLength(sent + 1);
  });
  it('accepts native selection and properties once without creating an edit', async () => {
    const { fixture, host, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    const base = {
      protocol: 2,
      kind: 'nativeAction',
      uri: 'file:///report.rdlc',
      viewId: 'view-1',
      documentLifetimeId: 'document-1',
      contextGeneration: 1,
      baseVersion: 2,
      targetIds: ['2:3'],
    };
    const select = {
      ...base,
      requestId: 'select-native',
      action: 'select',
      capability: 'select',
      primaryId: '2:3',
      additive: false,
    };
    host.ingest(select);
    await settle();
    expect(fixture.componentInstance.acceptedSelection().primaryId).toBe('2:3');
    host.ingest(select);
    await settle();
    const properties = {
      ...base,
      requestId: 'properties-native',
      action: 'properties',
      capability: 'properties',
    };
    host.ingest(properties);
    await settle();
    expect(host.nativeAction()).toBeNull();
    const outcomes = host
      .sent()
      .map(validateMessage)
      .filter((message) => message?.kind === 'actionOutcome');
    expect(
      outcomes.filter((message) => message.requestId === 'select-native'),
    ).toHaveLength(1);
    expect(
      outcomes.filter(
        (message) =>
          message.requestId === 'properties-native' &&
          message.status === 'accepted',
      ),
    ).toHaveLength(1);
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(false);
  });

  it('routes the native Properties action to the first inspector field', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    const inspector = element.querySelector('.inspector');
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    name.focus();
    name.setSelectionRange(0, name.value.length);
    host.ingest({
      protocol: 2,
      kind: 'nativeAction',
      uri: 'file:///report.rdlc',
      viewId: 'view-1',
      documentLifetimeId: 'document-1',
      contextGeneration: 1,
      baseVersion: 2,
      targetIds: ['2:3'],
      requestId: 'properties-native',
      action: 'properties',
      capability: 'properties',
    });
    await settle();
    // The keyboard-reached command routes to the existing inspector and focuses
    // its first field; the panel chrome never takes focus away from the field.
    expect(element.querySelector('.inspector')).toBe(inspector);
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe('Title');
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
  });

  it('Escape leaves a revealed overlay field, restores it and returns to the canvas', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    // Compact workspace: both side panels are overlays (FR-028).
    fixture.componentInstance.workspaceResize(640, 480);
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    // The native Properties command reveals the panel without a toolbar
    // invoker, so no control exists to restore focus to on dismissal.
    host.ingest({
      protocol: 2,
      kind: 'nativeAction',
      uri: 'file:///report.rdlc',
      viewId: 'view-1',
      documentLifetimeId: 'document-1',
      contextGeneration: 1,
      baseVersion: 2,
      targetIds: ['2:3'],
      requestId: 'properties-native',
      action: 'properties',
      capability: 'properties',
    });
    await settle();
    expect(fixture.componentInstance.overlay()).toBe('right');
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    expect(document.activeElement).toBe(name);
    name.value = 'Draft';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    // The field restores the accepted value, the editor still receives the
    // Escape (the overlay closes), and focus lands on a usable control.
    expect(name.value).toBe('Title');
    expect(fixture.componentInstance.overlay()).toBeNull();
    expect(document.activeElement).toBe(
      element.querySelector<HTMLElement>('.viewport'),
    );
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(false);
  });

  it('Escape in a docked inspector field restores it and returns focus to the canvas', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    // Wide workspace: the inspector is docked, not an overlay.
    fixture.componentInstance.workspaceResize(1200, 800);
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    expect(fixture.componentInstance.overlay()).toBeNull();
    const name = element.querySelector<HTMLInputElement>(
      '.inspector [data-property="name"]',
    )!;
    name.focus();
    expect(document.activeElement).toBe(name);
    name.value = 'Draft';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(name.value).toBe('Title');
    expect(document.activeElement).toBe(
      element.querySelector<HTMLElement>('.viewport'),
    );
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(false);
  });

  it('Escape in a docked table form field leaves focus and the typed draft alone', async () => {
    const { fixture, host, element, settle } = mount();
    const multiple = multipleSnapshot();
    host.ingest({
      ...multiple,
      authoring: {
        ...multiple.authoring,
        tables: [
          {
            id: '2:4',
            name: 'Other',
            dataset: null,
            columns: 1,
            structural: true,
            reason: null,
            rows: [],
            groups: [],
          },
        ],
      },
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    fixture.componentInstance.workspaceResize(1200, 800);
    await settle();
    fixture.componentInstance.select(1);
    await settle();
    expect(fixture.componentInstance.overlay()).toBeNull();
    const field = element.querySelector<HTMLInputElement>(
      '.inspector rdlc-table-properties input',
    )!;
    expect(field).not.toBeNull();
    field.focus();
    field.value = 'Draft';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Draft');
  });

  it('restores the inspector control a pending refusal disabled, unless focus moved', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    const fieldset = element.querySelector('fieldset')!;
    const viewport = element.querySelector<HTMLElement>('.viewport')!;

    // The user moved focus away while the edit was pending: keep it.
    name.focus();
    fixture.componentInstance.commit({ property: 'name', value: 'Title2' });
    await settle();
    expect(fieldset.disabled).toBe(true);
    viewport.focus();
    const moved = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: moved.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Refused while focus moved',
      diagnostics: [],
    });
    await settle();
    expect(document.activeElement).toBe(viewport);

    // Focus stayed in the field: the disabled fieldset blurred it, and the
    // refusal settle must hand the still-usable control its focus back.
    name.focus();
    expect(document.activeElement).toBe(name);
    fixture.componentInstance.commit({ property: 'name', value: '9 invalid!' });
    await settle();
    expect(fieldset.disabled).toBe(true);
    // jsdom does not re-run focus fixups when a fieldset disables; drop focus
    // to the document exactly as a browser does with an unfocusable control.
    document.documentElement.focus();
    expect(document.activeElement).toBe(document.body);
    const refused = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: refused.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Use a unique name',
      diagnostics: [],
    });
    await settle();
    expect(fieldset.disabled).toBe(false);
    expect(document.activeElement).toBe(name);
    // The restored control still accepts typing (real input, not a set value).
    name.value = 'Draft';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(fixture.componentInstance.draft()).not.toBeNull();
    expect(fixture.componentInstance.selected()?.name).toBe('Title');
  });

  it('returns to the canvas when the settled control is connected but hidden', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    const name = element.querySelector<HTMLInputElement>(
      '[data-property="name"]',
    )!;
    const viewport = element.querySelector<HTMLElement>('.viewport')!;
    name.focus();
    fixture.componentInstance.commit({ property: 'name', value: '9 invalid!' });
    await settle();
    expect(element.querySelector('fieldset')!.disabled).toBe(true);
    // jsdom does not re-run focus fixups when a fieldset disables; drop focus
    // to the document exactly as a browser does with an unfocusable control.
    document.documentElement.focus();
    expect(document.activeElement).toBe(document.body);
    // The compact workspace closes the inspector while the edit is in flight:
    // the field stays connected but hidden, so a browser ignores its focus().
    fixture.componentInstance.workspaceResize(640, 480);
    await settle();
    expect(fixture.componentInstance.panelShown('right')).toBe(false);
    expect(name.isConnected).toBe(true);
    // jsdom has no layout, so model that browser no-op with a silent spy; the
    // observable requirement is only where focus ends up.
    vi.spyOn(name, 'focus').mockImplementation(() => {});
    const refused = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: refused.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Use a unique name',
      diagnostics: [],
    });
    await settle();
    expect(document.activeElement).toBe(viewport);
  });

  it('drops a field commit emitted for an item of an older version', async () => {
    const { fixture, host, settle } = mount();
    host.ingest(snapshotMessage({ version: 2, id: '2:3', name: 'Front' }));
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    // A reload rebuilds the inspector for the mapped item; Chromium fires the
    // removed dirty field's change with the previous version's target.
    host.ingest(snapshotMessage({ version: 3, id: '3:3', name: 'Front' }));
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    fixture.componentInstance.commit({
      property: 'name',
      value: 'DraftBeforeReload',
      targetId: '2:3',
    });
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(false);
    fixture.componentInstance.commit({
      property: 'name',
      value: 'Renamed',
      targetId: '3:3',
    });
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(true);
  });

  it('ends a held native action on Cancel and never replays its captured selection', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    fixture.componentInstance.select(0);
    await settle();
    const input = element.querySelector<HTMLInputElement>(
      'input[data-property="text"]',
    )!;
    input.value = 'Unsubmitted draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const action = {
      protocol: 2,
      kind: 'nativeAction',
      uri: 'file:///report.rdlc',
      viewId: 'view-1',
      documentLifetimeId: 'document-1',
      contextGeneration: 1,
      baseVersion: 2,
      targetIds: ['2:3'],
      requestId: 'held-native',
      action: 'select',
      capability: 'select',
      primaryId: '2:3',
      additive: false,
    };
    host.ingest(action);
    await settle();
    expect(fixture.componentInstance.conflict()).not.toBeNull();
    fixture.componentInstance.cancelConflict();
    await settle();
    expect(host.nativeOutcome()?.status).toBe('cancelled');
    expect(input.value).toBe('Unsubmitted draft');
    expect(
      host.sent().some((message) => validateMessage(message)?.kind === 'edit'),
    ).toBe(false);
    host.ingest(action);
    await settle();
    expect(
      host
        .sent()
        .map(validateMessage)
        .filter(
          (message) =>
            message?.kind === 'actionOutcome' &&
            message.requestId === 'held-native',
        ),
    ).toHaveLength(1);
  });

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
  it('inspects real Data definitions in the source-only empty state', async () => {
    const { fixture, host, element, settle } = mount();
    const message = snapshotMessage({});
    if (message.kind !== 'snapshot') throw new Error('Expected snapshot');
    host.ingest({
      ...message,
      projection: { ...message.projection, status: 'source-only' },
      scene: null,
      navigation: {
        version: 2,
        structure: { nodes: [], truncated: false },
        data: {
          nodes: [dataNode('2:20', 'dataset', 'Orders')],
          truncated: false,
        },
      },
    });
    await settle();
    const tree = element.querySelector('.empty-state rdlc-structure-tree')!;
    const definition = tree.querySelector<HTMLElement>('[data-node="2:20"]');
    expect(definition).not.toBeNull();
    definition!.click();
    await settle();
    expect(
      fixture.componentInstance.acceptedSelection().structureTargetId,
    ).toBe('2:20');
    expect(fixture.componentInstance.structureNode()?.kind).toBe('dataset');
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
        ],
      },
      navigation: {
        version: 2,
        structure: { nodes: [], truncated: false },
        data: {
          nodes: [dataNode('2:8', 'dataset', 'Sales')],
          truncated: false,
        },
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
  it('offers guarded dataset deletion and no arrangement in the Structure menu', async () => {
    const { fixture, host, element, settle } = mount();
    const snapshot = directSnapshot();
    host.ingest({
      ...snapshot,
      structure: {
        nodes: [
          {
            id: '2:1',
            parentId: null,
            kind: 'report',
            label: 'Report',
            name: null,
            range: { start: 0, end: 0 },
            preservedReason: null,
          },
        ],
        truncated: false,
      },
      navigation: {
        version: 2,
        structure: { nodes: [], truncated: false },
        data: {
          nodes: [dataNode('2:20', 'dataset', 'Orders')],
          truncated: false,
        },
      },
      authoring: {
        ...snapshot.authoring,
        datasets: [{ id: '2:20', name: 'Orders', fields: [] }],
      },
    });
    await settle();
    const component = fixture.componentInstance;
    component.structureMenu({ id: '2:20', x: 10, y: 60 });
    await settle();
    expect(component.selectedDataset()?.name).toBe('Orders');
    expect(component.contextMenu()?.source).toBe('structure');
    const labels = [...element.querySelectorAll('[role=menuitem]')].map((m) =>
      m.textContent?.trim(),
    );
    expect(labels.some((l) => l?.startsWith('Align'))).toBe(false);
    expect(element.textContent).not.toContain(
      'Select an item with known bounds',
    );
    const remove = [
      ...element.querySelectorAll<HTMLElement>('[role=menuitem]'),
    ].find((m) => m.textContent?.includes('Delete dataset Orders'))!;
    expect(remove).toBeTruthy();
    remove.click();
    await settle();
    expect(host.sent().at(-1)).toMatchObject({
      operation: 'author',
      targetId: '2:20',
      payload: { action: 'deleteDataset' },
    });
    expect(component.contextMenu()).toBeNull();
  });
  it('selects an accepted dataset definition without a geometry selection', async () => {
    for (const snapshotFirst of [true, false]) {
      TestBed.resetTestingModule();
      const { fixture, host, element, settle } = mount();
      host.ingest(directSnapshot());
      await settle();
      fixture.componentInstance.create('dataset');
      const request = host.sent().at(-1) as {
        requestId: string;
        payload: unknown;
      };
      expect(request.payload).toEqual({ action: 'createDataset' });
      const next = directSnapshot(3, '3:4');
      const accepted = {
        ...next,
        authoring: {
          ...next.authoring,
          datasets: [{ id: '3:20', name: 'Orders', fields: [] }],
        },
        navigation: {
          version: 3,
          structure: { nodes: [], truncated: false },
          data: {
            nodes: [dataNode('3:20', 'dataset', 'Orders')],
            truncated: false,
          },
        },
      };
      const result = {
        protocol: 2,
        kind: 'editResult',
        requestId: request.requestId,
        baseVersion: 2,
        version: 3,
        changed: true,
        accepted: true,
        mappings: [],
        reason: 'APPLIED',
        diagnostics: [],
        created: { id: '3:20', name: 'Orders' },
      };
      host.ingest(snapshotFirst ? accepted : result);
      await settle();
      host.ingest(snapshotFirst ? result : accepted);
      await settle();
      const order = snapshotFirst ? 'snapshot first' : 'result first';
      expect(fixture.componentInstance.selectedDataset()?.name, order).toBe(
        'Orders',
      );
      expect(
        fixture.componentInstance.acceptedSelection().structureTargetId,
        order,
      ).toBe('3:20');
      expect(fixture.componentInstance.selectedIds(), order).toEqual([]);
      expect(fixture.componentInstance.selected(), order).toBeNull();
      // A data definition never scrolls the canvas or claims a rectangle.
      expect(fixture.componentInstance.view().scrollTop, order).toBe(0);
      expect(fixture.componentInstance.view().scrollLeft, order).toBe(0);
      expect(element.textContent, order).toContain('Dataset: Orders');
      expect(host.sent(), order).toHaveLength(1);
    }
  });
  it('claims no Data target that only authoring carries and keeps later versions clear', async () => {
    const { fixture, host, element, settle } = mount();
    const component = fixture.componentInstance;
    host.ingest(authoringOnly(2, []));
    await settle();
    component.create('dataset');
    const request = host.sent().at(-1) as { requestId: string };
    host.ingest(authoringOnly(3, [{ id: '3:20', name: 'Orders', fields: [] }]));
    await settle();
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 3,
      changed: true,
      accepted: true,
      mappings: [],
      reason: 'APPLIED',
      diagnostics: [],
      created: { id: '3:20', name: 'Orders' },
    });
    await settle();
    // Authoring names the definition, but no projection carries a target identity.
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(false);
    expect(element.textContent).toContain('Created Orders.');
    // Ambiguous and deleted definitions in later versions still claim nothing.
    host.ingest(
      authoringOnly(4, [
        { id: '4:20', name: 'Orders', fields: [] },
        { id: '4:21', name: 'Orders', fields: [] },
      ]),
    );
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(false);
    host.ingest(authoringOnly(5, []));
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(false);
    expect(element.textContent).not.toContain('Selection cleared');
    expect(host.sent()).toHaveLength(1);
    fixture.destroy();
  });
  it('clears a Data selection when the next snapshot carries no navigation', async () => {
    const { fixture, host, element, settle } = mount();
    const component = fixture.componentInstance;
    host.ingest(dataSnapshot(2, [dataNode('2:20', 'dataset', 'Orders')]));
    await settle();
    component.selectTree({ id: '2:20', additive: false });
    await settle();
    expect(component.acceptedSelection().structureTargetId).toBe('2:20');
    // Ambiguous authoring proves no correspondence: clear with feedback.
    host.ingest(
      authoringOnly(3, [
        { id: '3:20', name: 'Orders', fields: [] },
        { id: '3:21', name: 'Orders', fields: [] },
      ]),
    );
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(true);
    expect(element.textContent).toContain('Selection cleared');
    // A deleted definition clears the same way instead of guessing.
    host.ingest(dataSnapshot(4, [dataNode('4:20', 'dataset', 'Orders')]));
    await settle();
    component.selectTree({ id: '4:20', additive: false });
    await settle();
    expect(component.acceptedSelection().structureTargetId).toBe('4:20');
    host.ingest(authoringOnly(5, []));
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(true);
    expect(element.textContent).toContain('Selection cleared');
    fixture.destroy();
  });
  it('accepts native Data selection while Structure carries no dataset branch', async () => {
    const { fixture, host, element, settle } = mount();
    const message = directSnapshot();
    host.ingest({
      ...message,
      structure: {
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
        ],
        truncated: false,
      },
      navigation: {
        version: 2,
        structure: { nodes: [], truncated: false },
        data: {
          nodes: [
            dataNode('2:20', 'dataset', 'Orders'),
            dataNode('2:21', 'field', 'Label', '2:20'),
          ],
          truncated: false,
        },
      },
      authoring: {
        ...message.authoring,
        datasets: [
          {
            id: '2:20',
            name: 'Orders',
            fields: [
              {
                id: '2:21',
                name: 'Label',
                type: 'text',
              },
            ],
          },
        ],
      },
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await settle();
    const component = fixture.componentInstance;
    host.ingest({
      protocol: 2,
      kind: 'nativeAction',
      requestId: 'native-data',
      uri: 'file:///report.rdlc',
      viewId: 'view-1',
      documentLifetimeId: 'document-1',
      contextGeneration: 1,
      baseVersion: 2,
      targetIds: ['2:21'],
      action: 'select',
      capability: 'select',
      primaryId: '2:21',
      additive: false,
    });
    await settle();
    expect(component.acceptedSelection().structureTargetId).toBe('2:21');
    expect(component.structureNode()).toMatchObject({
      id: '2:21',
      kind: 'field',
    });
    expect(component.selectedDataset()?.name).toBe('Orders');
    expect(component.selected()).toBeNull();
    expect(component.selectedIds()).toEqual([]);
    expect(component.view().scrollTop).toBe(0);
    expect(component.view().scrollLeft).toBe(0);
    expect(element.textContent).toContain('Dataset: Orders');
    expect(
      host
        .sent()
        .map(validateMessage)
        .filter((sent) => sent?.kind === 'acceptedSelection')
        .at(-1),
    ).toMatchObject({
      selection: { mode: 'structure', targetId: '2:21' },
    });
    expect(
      host
        .sent()
        .map(validateMessage)
        .filter(
          (sent) =>
            sent?.kind === 'actionOutcome' && sent.requestId === 'native-data',
        ),
    ).toHaveLength(1);
  });

  it('keeps a uniquely named Data target, clears a deleted, ambiguous or retyped one with feedback', async () => {
    const { fixture, host, element, settle } = mount();
    const version = (value: number, datasets: readonly NavigationNode[]) => ({
      ...directSnapshot(value, `${value}:4`),
      navigation: {
        version: value,
        structure: { nodes: [], truncated: false },
        data: { nodes: [...datasets], truncated: false },
      },
      authoring: {
        ...directSnapshot(value, `${value}:4`).authoring,
        datasets: datasets
          .filter((node) => node.kind === 'dataset')
          .map((node) => ({ id: node.id, name: node.name!, fields: [] })),
      },
    });
    const component = fixture.componentInstance;
    host.ingest(version(2, [dataNode('2:20', 'dataset', 'Orders')]));
    await settle();
    component.selectTree({ id: '2:20', additive: false });
    await settle();
    expect(component.acceptedSelection().structureTargetId).toBe('2:20');
    expect(component.selectionLost()).toBe(false);
    // Unique named ancestry keeps the definition across an independent version.
    host.ingest(version(3, [dataNode('3:20', 'dataset', 'Orders')]));
    await settle();
    expect(component.acceptedSelection().structureTargetId).toBe('3:20');
    expect(component.selectionLost()).toBe(false);
    // Two datasets with the same identity are ambiguous: clear and say so.
    host.ingest(
      version(4, [
        dataNode('4:20', 'dataset', 'Orders'),
        dataNode('4:21', 'dataset', 'Orders'),
      ]),
    );
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(true);
    expect(element.textContent).toContain('Selection cleared');
    // Deleting the remaining definition also clears instead of guessing.
    host.ingest(version(5, [dataNode('5:20', 'dataset', 'Orders')]));
    await settle();
    component.selectTree({ id: '5:20', additive: false });
    await settle();
    host.ingest(version(6, []));
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(true);
    // A changed expanded type is a different definition, same kind and name.
    host.ingest(
      version(7, [
        dataNode('7:20', 'opaque', 'Thing', null, '{urn:one}Widget'),
      ]),
    );
    await settle();
    component.selectTree({ id: '7:20', additive: false });
    await settle();
    expect(component.acceptedSelection().structureTargetId).toBe('7:20');
    host.ingest(
      version(8, [
        dataNode('8:20', 'opaque', 'Thing', null, '{urn:two}Widget'),
      ]),
    );
    await settle();
    expect(component.acceptedSelection().structureTargetId ?? null).toBeNull();
    expect(component.selectionLost()).toBe(true);
    expect(element.textContent).toContain('Selection cleared');
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
      protocol: 2,
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
    it(`selects the host-named creation under either order (${snapshotFirst})`, async () => {
      const { fixture, host, settle } = mount();
      const blank = directSnapshot();
      host.ingest({ ...blank, scene: { ...blank.scene, items: [] } });
      await settle();
      fixture.componentInstance.create('textbox');
      const request = host.sent().at(-1) as {
        requestId: string;
        payload: { left: string; top: string };
      };
      expect(request.payload).toMatchObject({ action: 'createTextbox' });
      expect(fixture.componentInstance.selected()).toBeNull();
      const next = directSnapshot(3, '3:4');
      const result = {
        protocol: 2,
        kind: 'editResult',
        requestId: request.requestId,
        baseVersion: 2,
        version: 3,
        changed: true,
        accepted: true,
        mappings: [],
        reason: 'APPLIED',
        diagnostics: [],
        created: { id: '3:4', name: 'Title' },
      };
      host.ingest(snapshotFirst ? next : result);
      await settle();
      host.ingest(snapshotFirst ? result : next);
      await settle();
      expect(fixture.componentInstance.selected()?.id).toBe('3:4');
      expect(fixture.componentInstance.gestureNotice()).toBe('Created Title.');
      expect(host.sent()).toHaveLength(1);
    });
  it('creates at the visible body corner and offsets repeats by one grid step', async () => {
    const { fixture, host, settle } = mount();
    const blank = directSnapshot();
    host.ingest({ ...blank, scene: { ...blank.scene, items: [] } });
    await settle();
    const component = fixture.componentInstance;
    component.create('textbox');
    expect(host.sent().at(-1)).toMatchObject({
      payload: { action: 'createTextbox', left: '20pt', top: '20pt' },
    });
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: (host.sent().at(-1) as { requestId: string }).requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Refused',
      diagnostics: [],
    });
    // An item already at that corner pushes the next creation by one grid step.
    host.ingest({
      ...blank,
      version: 3,
      navigation: { ...blank.navigation, version: 3 },
      scene: {
        ...blank.scene,
        version: 3,
        items: [
          {
            ...blank.scene.items[0]!,
            id: '3:3',
            bounds: { left: 26.6667, top: 26.6667, width: 96, height: 24 },
          },
        ],
      },
    });
    await settle();
    component.create('textbox');
    expect(host.sent().at(-1)).toMatchObject({
      payload: { action: 'createTextbox', left: '30pt', top: '30pt' },
    });
  });
  it('refuses creation while pending or source-only without sending', async () => {
    const { fixture, host, settle } = mount();
    const message = snapshotMessage({});
    if (message.kind !== 'snapshot') throw new Error('Expected snapshot');
    host.ingest({
      ...message,
      projection: { ...message.projection, status: 'source-only' },
    });
    await settle();
    fixture.componentInstance.create('textbox');
    expect(host.sent()).toEqual([]);
    expect(fixture.componentInstance.gestureNotice()).toContain('Code XML');
  });
  it('retains a refused creation without fabricating selection or retrying', async () => {
    const { fixture, host, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.create('textbox');
    const request = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Refused',
      diagnostics: [],
    });
    await settle();
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(host.sent()).toHaveLength(1);
  });
  it('sends an Image click as a default placement at the textbox default spot', async () => {
    const { fixture, host, settle } = mount();
    const blank = directSnapshot();
    host.ingest({ ...blank, scene: { ...blank.scene, items: [] } });
    await settle();
    const component = fixture.componentInstance;
    component.create('image');
    const first = host.sent().at(-1) as {
      requestId: string;
      targetId: string;
      operation: string;
    };
    expect(first).toMatchObject({
      operation: 'author',
      targetId: '2:0',
      payload: {
        action: 'createImage',
        placement: 'default',
        left: '20pt',
        top: '20pt',
      },
    });
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: first.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'Refused',
      diagnostics: [],
    });
    // The textbox occupied check applies: a taken corner moves the spot one grid step.
    host.ingest({
      ...blank,
      version: 3,
      navigation: { ...blank.navigation, version: 3 },
      scene: {
        ...blank.scene,
        version: 3,
        items: [
          {
            ...blank.scene.items[0]!,
            id: '3:3',
            bounds: { left: 26.6667, top: 26.6667, width: 96, height: 24 },
          },
        ],
      },
    });
    await settle();
    component.create('image');
    expect(host.sent().at(-1)).toMatchObject({
      payload: {
        action: 'createImage',
        placement: 'default',
        left: '30pt',
        top: '30pt',
      },
    });
  });
  it('selects the host-named image after an accepted createImage like a textbox', async () => {
    const { fixture, host, settle } = mount();
    const blank = directSnapshot();
    host.ingest({ ...blank, scene: { ...blank.scene, items: [] } });
    await settle();
    fixture.componentInstance.create('image');
    const request = host.sent().at(-1) as { requestId: string };
    expect(fixture.componentInstance.selected()).toBeNull();
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 3,
      changed: true,
      accepted: true,
      mappings: [],
      reason: 'APPLIED',
      diagnostics: [],
      created: { id: '3:4', name: 'Image1' },
    });
    await settle();
    host.ingest(directSnapshot(3, '3:4'));
    await settle();
    expect(fixture.componentInstance.selected()?.id).toBe('3:4');
    expect(fixture.componentInstance.gestureNotice()).toBe('Created Image1.');
    expect(host.sent()).toHaveLength(1);
  });
  it('treats a cancelled file chooser as no refusal, no error and a clean state', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.create('image');
    const request = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      cancelled: true,
      mappings: [],
      reason: 'CANCELLED',
      diagnostics: [],
    });
    await settle();
    expect(host.pending()).toBeNull();
    expect(element.querySelector('#report-refusal')).toBeNull();
    expect(element.textContent).not.toContain('Not applied');
    expect(element.textContent).not.toContain('CANCELLED');
    expect(fixture.componentInstance.gestureNotice()).toBe('');
    expect(fixture.componentInstance.selected()).toBeNull();
    // The author can try again: nothing is retained or blocked.
    fixture.componentInstance.create('image');
    expect(host.sent()).toHaveLength(2);
  });
  it('keeps showing a real refusal of createImage', async () => {
    const { fixture, host, element, settle } = mount();
    host.ingest(directSnapshot());
    await settle();
    fixture.componentInstance.create('image');
    const request = host.sent().at(-1) as { requestId: string };
    host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: request.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'IMAGE_UNSUPPORTED_FORMAT',
      diagnostics: [],
    });
    await settle();
    expect(element.querySelector('#report-refusal')).not.toBeNull();
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

  /** A validated snapshot from a host that publishes authoring without navigation. */
  function authoringOnly(
    version: number,
    datasets: AuthoringState['datasets'],
  ): Record<string, unknown> {
    const message: Record<string, unknown> = {
      ...directSnapshot(version, `${version}:4`),
    };
    delete message['navigation'];
    message['authoring'] = { ...(message['authoring'] as object), datasets };
    return message;
  }

  /** A snapshot whose Data projection carries the given definitions. */
  function dataSnapshot(version: number, datasets: readonly NavigationNode[]) {
    const direct = directSnapshot(version, `${version}:4`);
    return {
      ...direct,
      navigation: {
        version,
        structure: { nodes: [], truncated: false },
        data: { nodes: [...datasets], truncated: false },
      },
      authoring: {
        ...direct.authoring,
        datasets: datasets
          .filter((node) => node.kind === 'dataset')
          .map((node) => ({ id: node.id, name: node.name!, fields: [] })),
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
          protocol: 2,
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
        navigation: { ...initial.navigation, version: 3 },
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
        protocol: 2,
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
        protocol: 2,
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
    expect(items[0]!.getAttribute('aria-label')).toBe('Title: Hello');
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
    expect(
      element.querySelector('button.item')!.getAttribute('aria-label'),
    ).toBe('Title: Hello');
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
      navigation: { ...initial.navigation, version: 3 },
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
      navigation: { ...initial.navigation, version: 4 },
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
    // Typing alone is quiet; the banner appears only when an action would discard it.
    expect(element.textContent).not.toContain('Unapplied draft');
    await conflictBySelection(mounted);
    expect(element.textContent).toContain('Unapplied draft');
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
      protocol: 2,
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
    expect(mounted.element.textContent).toContain(
      'Not applied: INVALID_NAME The report is unchanged.',
    );
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
      payload: { action: 'createTextbox', left: '1in', top: '1in' },
    });
    await mounted.settle();
    expect(mounted.host.sent()).toHaveLength(0);
    button(mounted.element, 'Discard draft').click();
    await mounted.settle();
    expect(mounted.host.sent().at(-1)).toMatchObject({
      operation: 'author',
      payload: { action: 'createTextbox', left: '1in', top: '1in' },
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

describe('focusProperties retries', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A selected report whose inspector gets a controllable, initially disabled field. */
  async function mountedWithLateField() {
    const m = mount();
    m.host.ingest({
      ...snapshotMessage({}),
      viewBinding: {
        viewId: 'view-1',
        documentLifetimeId: 'document-1',
        contextGeneration: 1,
      },
    });
    await m.settle();
    m.fixture.componentInstance.select(0);
    await m.settle();
    const inspector = m.element.querySelector('.inspector')!;
    const field = (name: string, disabled: boolean) => {
      const input = document.createElement('input');
      input.dataset['late'] = name;
      input.disabled = disabled;
      inspector.appendChild(input);
      return input;
    };
    // Fake timers only start once the component is settled and rendered.
    vi.useFakeTimers();
    // Deterministic document focus instead of jsdom's ambient state.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    return { ...m, component: m.fixture.componentInstance, field, hasFocus };
  }

  it('focuses the preferred field once it becomes enabled within the retry budget', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.component.focusProperties(
      '.inspector input[data-late="a"], .inspector input',
    );
    m.fixture.detectChanges();
    // The first attempt already took a lower-priority enabled input.
    const fallback = document.activeElement;
    expect(fallback).not.toBe(late);
    expect(m.element.contains(fallback)).toBe(true);
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(fallback);
    late.disabled = false;
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(late);
  });

  it('falls back to a lower-priority match on the first attempt', async () => {
    const m = await mountedWithLateField();
    m.field('a', true);
    m.component.focusProperties(
      '.inspector input[data-late="a"], .inspector [data-property="name"]',
    );
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(
      m.element.querySelector('[data-property="name"]'),
    );
  });

  it('focuses a third-part match on the first attempt even when the document is unfocused', async () => {
    const m = await mountedWithLateField();
    const name = m.field('x', false);
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties(
      '.inspector input[data-late="p1"], .inspector input[name="p2"], .inspector input[data-late="x"]',
    );
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(name);
  });

  it('upgrades a fallback focus to the preferred field once it appears', async () => {
    const m = await mountedWithLateField();
    const low = m.field('low', false);
    m.component.focusProperties(
      '.inspector input[data-late="name"], .inspector input[data-late="low"]',
    );
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(low);
    vi.advanceTimersByTime(200);
    const preferred = m.field('name', false);
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(preferred);
    // Never downgraded back, and the loop is done.
    preferred.disabled = true;
    vi.advanceTimersByTime(500);
    expect(document.activeElement).not.toBe(low);
  });

  it('calls focus() exactly once on the fallback target while the document is unfocused', async () => {
    const m = await mountedWithLateField();
    m.field('a', true);
    const fallback = m.field('b', false);
    const focus = vi.spyOn(fallback, 'focus').mockImplementation(() => {});
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties(
      '.inspector input[data-late="a"], .inspector input[data-late="b"]',
    );
    m.fixture.detectChanges();
    expect(focus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not steal focus the user moved elsewhere during the retries', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const outside = document.createElement('button');
    m.element.appendChild(outside);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    outside.focus();
    late.disabled = false;
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(outside);
  });

  it('does not steal focus the user moved to another inspector field', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const other = m.field('b', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    other.focus();
    late.disabled = false;
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(other);
  });

  it('takes the button or summary fallback on the first attempt when no input is enabled', async () => {
    const m = await mountedWithLateField();
    // Disable every input in the inspector so only the lower parts can match.
    const inspector = m.element.querySelector('.inspector')!;
    for (const input of inspector.querySelectorAll('input'))
      input.disabled = true;
    const button = inspector.querySelector<HTMLElement>('button')!;
    m.component.focusProperties();
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(button);
  });

  it('stops retrying when the component is destroyed', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const focus = vi.spyOn(late, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    const before = focus.mock.calls.length;
    m.fixture.destroy();
    late.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(focus.mock.calls.length).toBe(before);
  });

  it('stops retrying while the window is blurred', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const focus = vi.spyOn(late, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    const before = focus.mock.calls.length;
    window.dispatchEvent(new Event('blur'));
    late.disabled = false;
    vi.advanceTimersByTime(1_900);
    expect(focus.mock.calls.length).toBe(before);
    expect(document.activeElement).not.toBe(late);
  });

  it('suspends on window blur and resumes on window focus within the handoff window', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('blur'));
    late.disabled = false;
    m.hasFocus.mockReturnValue(false);
    vi.advanceTimersByTime(400);
    expect(document.activeElement).not.toBe(late);
    m.hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(late);
  });

  it('refocuses the target when the host blur and refocus dropped it after success', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(field);
    // The host handoff blurs the webview and its inner element, then refocuses.
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).not.toBe(field);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(field);
  });

  it('does not resume once the whole handoff window has elapsed', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(2_500);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  /** Settle a request on `a`, then run the host blur at `blurAfter` and focus at `focusAfter` ms. */
  async function handoff(blurAfter: number, focusAfter: number) {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(field);
    vi.advanceTimersByTime(blurAfter);
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(focusAfter);
    window.dispatchEvent(new Event('focus'));
    return { m, field };
  }

  it('refocuses on the measured handoff trace (finish, blur +1 ms, focus +40 ms)', async () => {
    const { field } = await handoff(1, 40);
    expect(document.activeElement).toBe(field);
  });

  it('does not refocus when the window returns more than 500 ms after the blur', async () => {
    const { field } = await handoff(1, 501);
    expect(document.activeElement).not.toBe(field);
  });

  it('refocuses when the window returns exactly 500 ms after the blur', async () => {
    const { field } = await handoff(1, 500);
    expect(document.activeElement).toBe(field);
  });

  it('does not refocus when the blur comes more than 300 ms after the request settled', async () => {
    const { field } = await handoff(301, 40);
    expect(document.activeElement).not.toBe(field);
  });

  it('honours a second blur and focus pair in the same burst, close to the last settle', async () => {
    const { field } = await handoff(1, 40);
    expect(document.activeElement).toBe(field);
    vi.advanceTimersByTime(10);
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(40);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(field);
  });

  it('does not refocus on a second blur and focus cycle more than 300 ms after the last settle', async () => {
    const { field } = await handoff(1, 40);
    expect(document.activeElement).toBe(field);
    vi.advanceTimersByTime(301);
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(40);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('refocuses on the measured Linux trace (unfocused arm, first window focus, then blur +8 ms and focus +20 ms)', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    const focus = vi.spyOn(field, 'focus');
    // The first attempt runs while the document is unfocused and does not take.
    focus.mockImplementationOnce(() => undefined);
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    vi.advanceTimersByTime(17);
    m.fixture.detectChanges();
    expect(document.activeElement).not.toBe(field);
    // Host reveal: the document gains focus and the field settles.
    m.hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(field);
    // focusActiveEditorGroup: blur right after the settle, refocus ~20 ms later.
    vi.advanceTimersByTime(8);
    m.hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(20);
    m.hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(field);
  });

  it('does not refocus on a second window focus without a new blur', async () => {
    const { field } = await handoff(1, 40);
    field.blur();
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('does not resume when a second blur arrives before the focus', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(10);
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(10);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('ignores a window focus with no prior blur', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    field.blur();
    vi.advanceTimersByTime(10);
    const focus = vi.spyOn(field, 'focus');
    window.dispatchEvent(new Event('focus'));
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
  });

  it('never calls focus() on a window focus with no prior blur while the document never had focus', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', true);
    const focus = vi.spyOn(field, 'focus');
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    field.disabled = false;
    const before = focus.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    expect(focus.mock.calls.length).toBe(before);
    expect(document.activeElement).not.toBe(field);
  });

  /** A never-focused document whose retry budget ran out before the host focused it. */
  async function lateHostFocus() {
    const m = await mountedWithLateField();
    const field = m.field('a', true);
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(1_500);
    field.disabled = false;
    m.hasFocus.mockReturnValue(true);
    return { field };
  }

  it('focuses the target on the first window focus after the budget ran out on a never-focused document', async () => {
    const { field } = await lateHostFocus();
    expect(document.activeElement).not.toBe(field);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(field);
  });

  it('does not focus a never-focused document whose window focus comes after the deadline', async () => {
    const { field } = await lateHostFocus();
    vi.advanceTimersByTime(600);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('does not focus a never-focused document after a user pointerdown', async () => {
    const { field } = await lateHostFocus();
    document.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('survives a blur and focus before the first render and then focuses', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(40);
    window.dispatchEvent(new Event('focus'));
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(field);
  });

  it('does not focus while a blur before the first render is still pending', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    const focus = vi.spyOn(field, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    window.dispatchEvent(new Event('blur'));
    m.fixture.detectChanges();
    vi.advanceTimersByTime(300);
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not resume after a user keydown', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(field);
    window.dispatchEvent(new Event('blur'));
    field.blur();
    document.dispatchEvent(new Event('keydown'));
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('does not resume after a user pointerdown', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(field);
    window.dispatchEvent(new Event('blur'));
    field.blur();
    document.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('cancels in the capture phase even when a bubbling handler stops propagation', async () => {
    const m = await mountedWithLateField();
    for (const type of ['keydown', 'pointerdown']) {
      const field = m.field(type, false);
      const trap = document.createElement('div');
      trap.addEventListener(type, (event) => event.stopPropagation());
      m.element.appendChild(trap);
      m.component.focusProperties(`.inspector input[data-late="${type}"]`);
      m.fixture.detectChanges();
      expect(document.activeElement).toBe(field);
      window.dispatchEvent(new Event('blur'));
      field.blur();
      trap.dispatchEvent(new Event(type, { bubbles: true }));
      window.dispatchEvent(new Event('focus'));
      expect(document.activeElement).not.toBe(field);
    }
  });

  it('does not steal focus the user moved elsewhere during the retries', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const outside = document.createElement('button');
    m.element.appendChild(outside);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    outside.focus();
    late.disabled = false;
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(outside);
  });

  it('does not steal focus the user moved to another inspector field', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const other = m.field('b', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    other.focus();
    late.disabled = false;
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(other);
  });

  it('takes the button or summary fallback on the first attempt when no input is enabled', async () => {
    const m = await mountedWithLateField();
    // Disable every input in the inspector so only the lower parts can match.
    const inspector = m.element.querySelector('.inspector')!;
    for (const input of inspector.querySelectorAll('input'))
      input.disabled = true;
    const button = inspector.querySelector<HTMLElement>('button')!;
    m.component.focusProperties();
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(button);
  });

  it('stops retrying when the component is destroyed', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const focus = vi.spyOn(late, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    const before = focus.mock.calls.length;
    m.fixture.destroy();
    late.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(focus.mock.calls.length).toBe(before);
  });

  it('stops retrying while the window is blurred', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const focus = vi.spyOn(late, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    const before = focus.mock.calls.length;
    window.dispatchEvent(new Event('blur'));
    late.disabled = false;
    vi.advanceTimersByTime(1_900);
    expect(focus.mock.calls.length).toBe(before);
    expect(document.activeElement).not.toBe(late);
  });

  it('suspends on window blur and resumes on window focus within the handoff window', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('blur'));
    late.disabled = false;
    m.hasFocus.mockReturnValue(false);
    vi.advanceTimersByTime(400);
    expect(document.activeElement).not.toBe(late);
    m.hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(late);
  });

  it('refocuses the target when the host blur and refocus dropped it after success', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(field);
    // The host handoff blurs the webview and its inner element, then refocuses.
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).not.toBe(field);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(field);
  });

  it('does not resume after the handoff window has elapsed', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    window.dispatchEvent(new Event('blur'));
    field.blur();
    vi.advanceTimersByTime(2_500);
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(field);
  });

  it('does not resume after a user keydown or pointerdown', async () => {
    const m = await mountedWithLateField();
    for (const type of ['keydown', 'pointerdown']) {
      const field = m.field(type, false);
      m.component.focusProperties(`.inspector input[data-late="${type}"]`);
      m.fixture.detectChanges();
      expect(document.activeElement).toBe(field);
      window.dispatchEvent(new Event('blur'));
      field.blur();
      document.dispatchEvent(new Event(type));
      window.dispatchEvent(new Event('focus'));
      expect(document.activeElement).not.toBe(field);
    }
  });

  it('does not steal focus the user moved elsewhere when the window refocuses', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    const outside = document.createElement('button');
    m.element.appendChild(outside);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    window.dispatchEvent(new Event('blur'));
    outside.focus();
    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(field);
  });

  it('never calls focus() on window focus while the document lacks focus', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    const focus = vi.spyOn(field, 'focus');
    window.dispatchEvent(new Event('blur'));
    field.blur();
    m.hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('focus'));
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not call focus() once the document has lost focus', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const focus = vi.spyOn(late, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    const before = focus.mock.calls.length;
    m.hasFocus.mockReturnValue(false);
    late.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(focus.mock.calls.length).toBe(before);
    m.hasFocus.mockReturnValue(true);
    vi.advanceTimersByTime(2_000);
    expect(focus.mock.calls.length).toBe(before);
  });

  it('makes one attempt then no focus() while the document is unfocused', async () => {
    const m = await mountedWithLateField();
    const field = m.field('a', false);
    const focus = vi.spyOn(field, 'focus').mockImplementation(() => {});
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    expect(focus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('focuses the target when the document gains focus mid-budget', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.hasFocus.mockReturnValue(false);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    late.disabled = false;
    vi.advanceTimersByTime(300);
    expect(document.activeElement).not.toBe(late);
    m.hasFocus.mockReturnValue(true);
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(late);
  });

  it('ignores auto-repeat keydowns but stops on a real one', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', repeat: true }),
    );
    late.disabled = false;
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(late);
    const other = m.field('b', true);
    m.component.focusProperties('.inspector input[data-late="b"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    other.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).not.toBe(other);
  });

  it('stops retrying on a user keydown', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    late.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).not.toBe(late);
  });

  it('stops retrying on a user pointerdown', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    late.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).not.toBe(late);
  });

  it('removes its listeners on completion, cancel and destroy', async () => {
    const m = await mountedWithLateField();
    const late = m.field('a', true);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const count = (spy: typeof add, type: string) =>
      spy.mock.calls.filter(([t]) => t === type).length;
    // Completion: the retries run out and take the fallback field.
    m.component.focusProperties(
      '.inspector input[data-late="b"], .inspector input',
    );
    m.fixture.detectChanges();
    vi.advanceTimersByTime(2_000);
    expect(count(add, 'blur')).toBe(1);
    expect(count(remove, 'blur')).toBe(1);
    expect(count(add, 'focus')).toBe(1);
    expect(count(remove, 'focus')).toBe(1);
    expect(count(docRemove, 'keydown')).toBe(1);
    expect(count(docRemove, 'pointerdown')).toBe(1);
    // Cancel by a newer call, then destroy: every registration is balanced.
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    m.fixture.destroy();
    const handlers = (spy: typeof add, type: string) =>
      spy.mock.calls.filter(([t]) => t === type).map(([, h, o]) => [h, o]);
    for (const type of ['blur', 'focus']) {
      expect(handlers(remove, type)).toEqual(
        expect.arrayContaining(handlers(add, type)),
      );
    }
    for (const type of ['keydown', 'pointerdown']) {
      expect(handlers(docAdd, type).length).toBe(3);
      expect(handlers(docRemove, type)).toEqual(handlers(docAdd, type));
    }
    // A later blur has no effect.
    const focus = vi.spyOn(late, 'focus');
    late.disabled = false;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(2_000);
    expect(focus).not.toHaveBeenCalled();
  });

  it('cancels the previous loop when called again', async () => {
    const m = await mountedWithLateField();
    const first = m.field('a', true);
    const second = m.field('b', false);
    const firstFocus = vi.spyOn(first, 'focus');
    m.component.focusProperties('.inspector input[data-late="a"]');
    m.fixture.detectChanges();
    vi.advanceTimersByTime(100);
    const before = firstFocus.mock.calls.length;
    m.component.focusProperties('.inspector input[data-late="b"]');
    m.fixture.detectChanges();
    expect(document.activeElement).toBe(second);
    first.disabled = false;
    vi.advanceTimersByTime(2_000);
    expect(firstFocus.mock.calls.length).toBe(before);
    expect(document.activeElement).toBe(second);
  });
});

describe('context menu retargeting', () => {
  beforeEach(() => TestBed.resetTestingModule());
  it('reopens the extension menu where a second right-click lands', async () => {
    const m = mount();
    m.host.ingest(draftSnapshot());
    await m.settle();
    const component = m.fixture.componentInstance;
    const items = m.element.querySelectorAll<HTMLElement>('button.item');
    component.showContextMenu(
      new MouseEvent('contextmenu', { clientX: 20, clientY: 80 }),
    );
    await m.settle();
    const backdrop = m.element.querySelector<HTMLElement>('.context-backdrop')!;
    expect(backdrop).not.toBeNull();
    const original = document.elementFromPoint;
    document.elementFromPoint = () => items[1]!;
    try {
      const second = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 120,
      });
      backdrop.dispatchEvent(second);
      await m.settle();
      expect(second.defaultPrevented).toBe(true);
      expect(component.contextMenu()?.source).toBe('canvas');
      expect(component.selectedIds()).toEqual([
        component.scene()!.items[Number(items[1]!.dataset['item'])]!.id,
      ]);
      document.elementFromPoint = () => m.element.querySelector('.inspector')!;
      m.element
        .querySelector<HTMLElement>('.context-backdrop')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );
      await m.settle();
      expect(component.contextMenu()).toBeNull();
      expect(m.host.sent()).toEqual([]);
    } finally {
      document.elementFromPoint = original;
    }
  });
});

describe('drag-and-drop creation', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const drag = (
    kind: string,
    clientX: number,
    clientY: number,
    altKey = false,
  ) => {
    let prevented = false;
    const event = {
      clientX,
      clientY,
      altKey,
      relatedTarget: null,
      dataTransfer: {
        types: [`application/x-rdlc-${kind}`],
        dropEffect: 'move',
      },
      preventDefault: () => (prevented = true),
    };
    return {
      event: event as unknown as DragEvent,
      raw: event,
      prevented: () => prevented,
    };
  };
  async function mounted() {
    const m = mount();
    m.host.ingest(draftSnapshot());
    await m.settle();
    const edits = () =>
      m.host.sent().filter((s) => (s as { kind: string }).kind === 'edit');
    return { ...m, component: m.fixture.componentInstance, edits };
  }

  it('creates one textbox at the unsnapped drop point with Alt at any zoom and scroll', async () => {
    const m = await mounted();
    const over = drag('textbox', 100, 50, true);
    m.component.canvasDragOver(over.event);
    expect(over.prevented()).toBe(true);
    expect(over.raw.dataTransfer.dropEffect).toBe('copy');
    expect(m.component.dropPreview()?.valid).toBe(true);
    m.component.canvasDrop(drag('textbox', 100, 50, true).event);
    expect(m.component.dropPreview()).toBeNull();
    expect(m.edits()).toHaveLength(1);
    expect(m.edits()[0]).toMatchObject({
      operation: 'author',
      payload: { action: 'createTextbox', left: '75pt', top: '37.5pt' },
    });
  });

  it('sends an Image drop as a drop placement at the unsnapped drop point', async () => {
    const m = await mounted();
    const over = drag('image', 100, 50, true);
    m.component.canvasDragOver(over.event);
    expect(over.prevented()).toBe(true);
    expect(over.raw.dataTransfer.dropEffect).toBe('copy');
    expect(m.component.dropPreview()?.valid).toBe(true);
    m.component.canvasDrop(drag('image', 100, 50, true).event);
    expect(m.component.dropPreview()).toBeNull();
    expect(m.edits()).toHaveLength(1);
    expect(m.edits()[0]).toMatchObject({
      operation: 'author',
      payload: {
        action: 'createImage',
        placement: 'drop',
        left: '75pt',
        top: '37.5pt',
      },
    });
  });

  it('refuses an Image drop outside the body without sending', async () => {
    const m = await mounted();
    const outside = drag('image', 2000, 50, true);
    m.component.canvasDragOver(outside.event);
    expect(outside.raw.dataTransfer.dropEffect).toBe('none');
    m.component.canvasDrop(drag('image', 2000, 50, true).event);
    expect(m.edits()).toHaveLength(0);
  });

  it('converts the drop point through zoom and scroll', async () => {
    const m = await mounted();
    m.component.zoomTo(2);
    await m.settle();
    const viewport = m.element.querySelector<HTMLElement>('.viewport')!;
    viewport.scrollLeft = 40;
    m.component.canvasDrop(drag('textbox', 100, 50, true).event);
    expect(m.edits().at(-1)).toMatchObject({
      payload: { action: 'createTextbox', left: '52.5pt', top: '18.75pt' },
    });
  });

  it('snaps to the grid without Alt', async () => {
    const m = await mounted();
    m.component.setView({ gridSnap: true, guidesSnap: false, gridSpacing: 10 });
    m.component.canvasDrop(drag('textbox', 101, 49).event);
    const payload = (m.edits().at(-1) as { payload: { left: string } }).payload;
    expect(Number.parseFloat(payload.left) % 10).toBe(0);
  });

  it('sends nothing for drops outside the body, cancelled drags or ineligible states', async () => {
    const m = await mounted();
    const outside = drag('textbox', 2000, 50, true);
    m.component.canvasDragOver(outside.event);
    expect(outside.raw.dataTransfer.dropEffect).toBe('none');
    expect(m.component.dropPreview()?.valid).toBe(false);
    m.component.canvasDrop(drag('textbox', 2000, 50, true).event);
    expect(m.edits()).toHaveLength(0);
    expect(m.component.gestureNotice()).toContain('inside the report body');
    m.component.canvasDragOver(drag('textbox', 10, 10).event);
    m.component.clearDrop();
    expect(m.component.dropPreview()).toBeNull();
    m.component.canvasDragOver(drag('textbox', 10, 10).event);
    m.component.blur();
    expect(m.component.dropPreview()).toBeNull();
    m.component.canvasDragOver(drag('textbox', 10, 10).event);
    m.component.workspaceResize(900, 700);
    expect(m.component.dropPreview()).toBeNull();
    const foreign = {
      ...drag('textbox', 10, 10).raw,
      dataTransfer: { types: ['text/plain'], dropEffect: 'move' },
    };
    m.component.canvasDrop(foreign as unknown as DragEvent);
    expect(m.edits()).toHaveLength(0);
    m.component.canvasDrop(drag('textbox', 10, 10, true).event);
    expect(m.edits()).toHaveLength(1);
    m.component.canvasDrop(drag('textbox', 20, 20, true).event);
    expect(m.edits()).toHaveLength(1);
    expect(m.component.gestureNotice()).toContain('Wait for the current edit');
  });

  it('creates a table at the drop point and a dataset anywhere on the canvas', async () => {
    const m = await mounted();
    m.component.canvasDrop(drag('table', 40, 40, true).event);
    expect(m.edits().at(-1)).toMatchObject({
      payload: { action: 'createTable', left: '30pt', top: '30pt' },
    });
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
    protocol: 2,
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
      protocol: 2,
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
      protocol: 2,
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

describe('embedded image items', () => {
  const bytesOf = (base64: string) =>
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const payload =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';
  const asset = (key: string) => ({
    key,
    mime: 'image/png' as const,
    data: bytesOf(payload),
  });
  /** A JPEG: the harness maps every JPEG blob to a URL whose decode() rejects. */
  const brokenPayload = '/9j/4AAQSkZJRgABAQEASABIAAD/2Q==';
  const broken = (key: string) => ({
    key,
    mime: 'image/jpeg' as const,
    data: bytesOf(brokenPayload),
  });
  type SceneItem = DesignScene['items'][number];

  const imageItem = (
    id: string,
    display: NonNullable<SceneItem['display']>,
    sizing: NonNullable<SceneItem['sizing']> = 'Fit',
    bounds: SceneItem['bounds'] = { left: 24, top: 24, width: 96, height: 72 },
  ): SceneItem => ({
    id: `2:${id}`,
    kind: 'image',
    name: `Image${id}`,
    // The scene label is the bare item name; the canvas prefixes `Image `.
    label: `Image${id}`,
    bounds,
    placeholder: display.state === 'placeholder',
    sizing,
    display,
    metadata: {
      format: 'png',
      pixels: { width: 120, height: 40 },
      encodedSize: payload.length,
    },
    operations: Object.fromEntries(
      ['moveX', 'moveY', 'resizeX', 'resizeY'].map((key) => [
        key,
        { eligible: true, reason: null },
      ]),
    ) as NonNullable<SceneItem['operations']>,
    capabilities: ['left', 'top', 'width', 'height'],
  });
  const picture = (assetKey = 'k1') => ({
    state: 'picture' as const,
    assetKey,
    pixels: { width: 120, height: 40 },
  });

  function snapshotWith(items: readonly SceneItem[], version = 2): HostMessage {
    const base = snapshotMessage({ version });
    if (base.kind !== 'snapshot' || !base.scene)
      throw new Error('Expected scene');
    return { ...base, scene: { ...base.scene, items } };
  }

  interface Env {
    created: string[];
    revoked: string[];
    failing: Set<string>;
  }
  let env: Env;

  async function mountImages(items: readonly SceneItem[]) {
    TestBed.resetTestingModule();
    env = { created: [], revoked: [], failing: new Set(['blob:test/fail']) };
    const provided: ImageAssetEnvironment = {
      createObjectURL: (blob) => {
        const url =
          blob.type === 'image/jpeg'
            ? 'blob:test/fail'
            : `blob:test/${env.created.length + 1}`;
        env.created.push(url);
        return url;
      },
      revokeObjectURL: (url) => void env.revoked.push(url),
      decode: (url) =>
        env.failing.has(url)
          ? Promise.reject(new Error('EncodingError'))
          : Promise.resolve(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: IMAGE_ASSET_ENVIRONMENT, useValue: provided }],
    });
    const m = mount();
    m.host.ingest(snapshotWith(items));
    await m.settle();
    return m;
  }
  const item = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('.item[data-kind="image"]')!;
  const img = (root: HTMLElement) => item(root).querySelector('img');
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  const sizings = [
    ['Fit', 'fill', 'image-fit'],
    ['FitProportional', 'contain', 'image-fit-proportional'],
    ['Clip', 'none', 'image-clip'],
  ] as const;
  for (const [sizing, objectFit, className] of sizings)
    it(`renders ${sizing} as object-fit ${objectFit} anchored at the top-left`, async () => {
      const m = await mountImages([imageItem('1', picture(), sizing)]);
      m.host.ingest({
        protocol: 2,
        kind: 'imageAssets',
        assets: [asset('k1')],
      });
      await flush();
      await m.settle();
      const picture_ = img(m.element)!;
      expect(picture_).not.toBeNull();
      expect(picture_.getAttribute('src')).toMatch(/^blob:/);
      expect(picture_.classList.contains(className)).toBe(true);
      expect(picture_.getAttribute('data-sizing')).toBe(sizing);
      expect(picture_.getAttribute('alt')).toBe('');
      const style = getComputedStyle(picture_);
      expect(style.objectFit).toBe(objectFit);
      // jsdom serialises a zero length as `0`, browsers as `0px`.
      expect(style.objectPosition).toMatch(
        sizing === 'FitProportional' ? /^50% 50%$/ : /^0(px)? 0(px)?$/,
      );
      expect(style.width).toBe('100%');
      expect(getComputedStyle(item(m.element)).overflow).toBe('hidden');
      expect(item(m.element).getAttribute('data-image-state')).toBe('picture');
    });

  it('renders AutoSize at the natural pixel size, anchored top-left, keeping the declared frame', async () => {
    const m = await mountImages([imageItem('1', picture(), 'AutoSize')]);
    m.host.ingest({ protocol: 2, kind: 'imageAssets', assets: [asset('k1')] });
    await flush();
    await m.settle();
    const picture_ = img(m.element)!;
    expect(picture_.classList.contains('image-autosize')).toBe(true);
    // The page layer is scaled by the zoom, so natural pixels x zoom is on screen.
    expect(picture_.style.width).toBe('120px');
    expect(picture_.style.height).toBe('40px');
    expect(getComputedStyle(picture_).objectFit).toBe('none');
    expect(getComputedStyle(picture_).position).toBe('absolute');
    expect(picture_.closest<HTMLElement>('.page')!.style.transform).toBe(
      `scale(${m.fixture.componentInstance.view().zoom})`,
    );
    // The declared bounds stay the item frame and are never resized by the picture.
    const frame = item(m.element);
    expect(frame.style.width).toBe('96px');
    expect(frame.style.height).toBe('72px');
    expect(getComputedStyle(frame).overflow).toBe('visible');
    expect(getComputedStyle(picture_).pointerEvents).toBe('none');
    // Clipped to the canvas (the scroll extent), not to the declared frame: a layer
    // spanning the extent, expressed in the item's coordinates, holds the picture.
    const layer = picture_.parentElement!;
    expect(layer.classList.contains('image-layer')).toBe(true);
    expect(getComputedStyle(layer).overflow).toBe('hidden');
    expect(getComputedStyle(layer).pointerEvents).toBe('none');
    expect(getComputedStyle(layer).position).toBe('absolute');
    // Body origin 0,0; item at 24,24; the 1px frame border puts the origin at 25,25.
    expect(layer.style.left).toBe('-25px');
    expect(layer.style.top).toBe('-25px');
    const extent = m.fixture.componentInstance.extent()!;
    expect(layer.style.width).toBe(`${extent.width}px`);
    expect(layer.style.height).toBe(`${extent.height}px`);
    expect(picture_.style.left).toBe('25px');
    expect(picture_.style.top).toBe('25px');
    // Zoom scales the picture with the page layer, never the declared size.
    m.fixture.componentInstance.zoomTo(2);
    await m.settle();
    expect(picture_.closest<HTMLElement>('.page')!.style.transform).toBe(
      'scale(2)',
    );
    expect(picture_.style.width).toBe('120px');
  });

  for (const sizing of ['AutoSize', 'Fit', 'FitProportional', 'Clip'] as const)
    it(`puts the ${sizing} picture at the inner edge of the declared frame`, async () => {
      const m = await mountImages([imageItem('1', picture(), sizing)]);
      m.host.ingest({
        protocol: 2,
        kind: 'imageAssets',
        assets: [asset('k1')],
      });
      await flush();
      await m.settle();
      // Same origin for every mode: no padding, so switching sizing never shifts it.
      const frame = getComputedStyle(item(m.element));
      expect(frame.padding).toMatch(/^0(px)?( 0(px)?){0,3}$/);
      expect(frame.borderTopWidth).toBe('1px');
      const picture_ = img(m.element)!;
      const style = getComputedStyle(picture_);
      expect(style.margin).toMatch(/^(0(px)?( 0(px)?){0,3})?$/);
      if (sizing !== 'AutoSize') expect(picture_.style.left).toBe('');
    });

  it('names an image by its item name and exposes the reason through aria-description', async () => {
    const m = await mountImages([
      imageItem('1', { state: 'placeholder', reason: 'too-large' }),
      imageItem('2', picture('k1'), 'Fit', {
        left: 200,
        top: 24,
        width: 96,
        height: 72,
      }),
      imageItem('3', picture('bad'), 'Fit', {
        left: 300,
        top: 24,
        width: 96,
        height: 72,
      }),
    ]);
    const items = [
      ...m.element.querySelectorAll<HTMLElement>('.item[data-kind="image"]'),
    ];
    // Name stays the item name; the reason or pending text is the description.
    expect(items[0]!.getAttribute('aria-label')).toBe('Image Image1');
    expect(items[0]!.getAttribute('aria-description')).toBe(
      imagePlaceholderLabels['too-large'],
    );
    expect(items[1]!.getAttribute('aria-description')).toBe('Loading image…');
    m.host.ingest({
      protocol: 2,
      kind: 'imageAssets',
      assets: [asset('k1'), broken('bad')],
    });
    await flush();
    await m.settle();
    expect(items[1]!.getAttribute('aria-description')).toBeNull();
    expect(items[2]!.getAttribute('aria-description')).toBe(
      imagePlaceholderLabels['data-invalid'],
    );
    for (const element of items) {
      expect(element.getAttribute('aria-label')).toMatch(/^Image Image\d$/);
      for (const reason of Object.keys(imagePlaceholderLabels))
        expect(
          `${element.getAttribute('aria-label')}|${element.getAttribute('aria-description')}`,
        ).not.toContain(reason);
    }
  });

  for (const [reason, label] of Object.entries(imagePlaceholderLabels))
    it(`shows the ${reason} placeholder label and no picture`, async () => {
      const m = await mountImages([
        imageItem('1', {
          state: 'placeholder',
          reason: reason as keyof typeof imagePlaceholderLabels,
        }),
      ]);
      expect(label.length).toBeGreaterThan(0);
      expect(img(m.element)).toBeNull();
      const note = item(m.element).querySelector('.image-placeholder')!;
      expect(note.textContent?.trim()).toBe(label);
      expect(note.getAttribute('data-reason')).toBe(reason);
      expect(item(m.element).getAttribute('data-image-state')).toBe(
        'placeholder',
      );
      expect(item(m.element).classList.contains('placeholder')).toBe(true);
    });

  it('shows a pending state, never a broken image, until the asset arrives', async () => {
    const m = await mountImages([imageItem('1', picture())]);
    expect(img(m.element)).toBeNull();
    expect(m.element.querySelector('[src]')).toBeNull();
    const state = item(m.element);
    expect(state.getAttribute('data-image-state')).toBe('pending');
    expect(state.querySelector('.image-placeholder')?.textContent?.trim()).toBe(
      'Loading image…',
    );
    expect(state.hasAttribute('data-invalid')).toBe(false);
    m.host.ingest({ protocol: 2, kind: 'imageAssets', assets: [asset('k1')] });
    await flush();
    await m.settle();
    expect(img(m.element)?.getAttribute('src')).toMatch(/^blob:/);
    expect(item(m.element).getAttribute('data-image-state')).toBe('picture');
    expect(item(m.element).querySelector('.image-placeholder')).toBeNull();
  });

  it('shows the data-invalid placeholder when the picture cannot be decoded', async () => {
    const m = await mountImages([imageItem('1', picture('bad'))]);
    m.host.ingest({
      protocol: 2,
      kind: 'imageAssets',
      assets: [broken('bad')],
    });
    await flush();
    await m.settle();
    expect(img(m.element)).toBeNull();
    const note = item(m.element).querySelector('.image-placeholder')!;
    expect(note.hasAttribute('data-invalid')).toBe(true);
    expect(note.getAttribute('data-reason')).toBe('data-invalid');
    expect(note.textContent?.trim()).toBe(
      imagePlaceholderLabels['data-invalid'],
    );
    expect(item(m.element).getAttribute('data-image-state')).toBe(
      'undecodable',
    );
    expect(env.revoked).toEqual(['blob:test/fail']);
  });

  it('keeps the DOM free of base64 payloads, data: URLs and picture titles', async () => {
    const m = await mountImages([
      imageItem('1', picture(), 'Fit'),
      imageItem('2', picture('bad'), 'Clip', {
        left: 200,
        top: 24,
        width: 96,
        height: 72,
      }),
      imageItem('3', { state: 'placeholder', reason: 'too-large' }, 'Fit', {
        left: 300,
        top: 24,
        width: 96,
        height: 72,
      }),
    ]);
    m.host.ingest({
      protocol: 2,
      kind: 'imageAssets',
      assets: [asset('k1'), broken('bad')],
    });
    await flush();
    await m.settle();
    const html = m.element.innerHTML;
    for (const slice of [
      payload.slice(0, 20),
      payload.slice(30, 60),
      brokenPayload.slice(0, 16),
    ])
      expect(html).not.toContain(slice);
    expect(html).not.toContain('data:');
    const sources = [...m.element.querySelectorAll('[src]')].map((node) =>
      node.getAttribute('src'),
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/^blob:/);
    expect(m.element.querySelectorAll('img[title], .item[title]')).toHaveLength(
      0,
    );
  });

  it('revokes the object URL once a later snapshot no longer references the picture', async () => {
    const m = await mountImages([imageItem('1', picture())]);
    m.host.ingest({ protocol: 2, kind: 'imageAssets', assets: [asset('k1')] });
    await flush();
    await m.settle();
    expect(env.revoked).toEqual([]);
    m.host.ingest(snapshotWith([], 3));
    await m.settle();
    expect(env.revoked).toEqual(['blob:test/1']);
    expect(m.element.querySelector('img')).toBeNull();
  });

  it('keeps selection, handles and focus on the generic item frame', async () => {
    const m = await mountImages([imageItem('1', picture(), 'AutoSize')]);
    m.host.ingest({ protocol: 2, kind: 'imageAssets', assets: [asset('k1')] });
    await flush();
    await m.settle();
    m.fixture.componentInstance.select(0);
    await m.settle();
    expect(item(m.element).tagName).toBe('BUTTON');
    expect(item(m.element).getAttribute('aria-label')).toBe('Image Image1');
    expect(item(m.element).getAttribute('aria-pressed')).toBe('true');
    expect(m.element.querySelector('.selection-frame')).not.toBeNull();
    expect(m.element.querySelectorAll('.selection-frame .handle').length).toBe(
      8,
    );
  });
});

describe('image items among body items', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.restoreAllMocks());

  const geometryKeys = ['left', 'top', 'width', 'height'];
  const imageBase = {
    kind: 'image' as const,
    sizing: 'Fit' as const,
    metadata: {
      format: 'png',
      pixels: { width: 120, height: 40 },
      encodedSize: 10,
    },
    text: null,
    style: null,
  };
  /** The draft scene plus three images: editable (4), geometry-only (5), preservation-only (6). */
  function withImages(version = 2): HostMessage {
    const base = draftSnapshot(version);
    if (base.kind !== 'snapshot' || !base.scene)
      throw new Error('Expected scene');
    const images = [
      {
        ...imageBase,
        id: `${version}:7`,
        name: 'Logo',
        label: 'Logo',
        placeholder: false,
        display: {
          state: 'picture',
          assetKey: 'k1',
          pixels: { width: 120, height: 40 },
        },
        bounds: { left: 200, top: 140, width: 96, height: 72 },
        geometry: {
          left: '150pt',
          top: '105pt',
          width: '72pt',
          height: '54pt',
        },
        operations: eligible,
        capabilities: [
          'image',
          'name',
          'left',
          'top',
          'width',
          'height',
          'sizing',
          'value',
          'toolTip',
        ],
      },
      {
        ...imageBase,
        id: `${version}:8`,
        name: 'Missing',
        label: 'Missing',
        placeholder: true,
        display: { state: 'placeholder', reason: 'reference-missing' },
        bounds: { left: 320, top: 140, width: 96, height: 72 },
        geometry: {
          left: '240pt',
          top: '105pt',
          width: '72pt',
          height: '54pt',
        },
        operations: eligible,
        capabilities: [...geometryKeys, 'name'],
      },
      {
        ...imageBase,
        id: `${version}:9`,
        name: null,
        label: 'Image',
        placeholder: true,
        display: { state: 'placeholder', reason: 'source-preserved' },
        bounds: { left: 440, top: 140, width: 96, height: 72 },
        geometry: null,
        operations: locked,
        capabilities: [],
      },
    ];
    return {
      ...base,
      scene: { ...base.scene, items: [...base.scene.items, ...images] },
    } as unknown as HostMessage;
  }
  async function mounted() {
    const m = mount();
    m.host.ingest(withImages());
    await m.settle();
    const component = m.fixture.componentInstance;
    component.setView({ gridSnap: false, guidesSnap: false });
    await m.settle();
    const viewport = m.element.querySelector<HTMLElement>('.viewport')!;
    const edits = () =>
      m.host.sent().filter((s) => (s as { kind: string }).kind === 'edit');
    const clipboards = () =>
      m.host.sent().filter((s) => (s as { kind: string }).kind === 'clipboard');
    return { ...m, component, viewport, edits, clipboards };
  }
  type Mounted = Awaited<ReturnType<typeof mounted>>;
  const pointer = (target: HTMLElement, x: number, y: number) =>
    ({
      button: 0,
      pointerId: 1,
      currentTarget: target,
      clientX: x,
      clientY: y,
      altKey: false,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as PointerEvent;
  function drag(
    m: Mounted,
    index: number,
    dx: number,
    dy: number,
    handle?: Parameters<Mounted['component']['startGesture']>[2],
  ) {
    const item = m.element.querySelector<HTMLElement>(
      `button.item[data-item="${index}"]`,
    )!;
    item.setPointerCapture = () => {};
    item.hasPointerCapture = () => false;
    m.component.startGesture(pointer(item, 0, 0), index, handle);
    m.component.moveGesture(pointer(item, dx, dy));
    m.component.finishGesture(pointer(item, dx, dy));
  }
  const key = (target: EventTarget, type: 'keydown' | 'keyup', init = {}) =>
    target.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
    );
  const labels = (m: Mounted) =>
    m.component.menuActions().map((entry) => entry.label);
  const names = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('button.item')].map((element) =>
      element.getAttribute('aria-label'),
    );

  it('names an image "Image {name}" and keeps the other items on their label', async () => {
    const m = await mounted();
    expect(names(m.element)).toEqual([
      'Title: Hello',
      'Other: Second',
      'Rectangle (unsupported)',
      'Image Logo',
      'Image Missing',
      'Image',
    ]);
    m.component.select(4);
    await m.settle();
    expect(
      m.element
        .querySelector('.selection-frame .handle[data-handle="se"]')
        ?.getAttribute('aria-label'),
    ).toBe('Resize Image Logo se');
  });

  it('selects an image, extends the selection with a textbox and selects all', async () => {
    const m = await mounted();
    m.component.select(4);
    await m.settle();
    expect(m.component.selectedIds()).toEqual(['2:7']);
    expect(m.component.primary()?.id).toBe('2:7');
    expect(
      m.element
        .querySelector('button.item[data-item="4"]')!
        .classList.contains('selected'),
    ).toBe(true);
    m.component.select(0, true);
    await m.settle();
    expect(m.component.selectedIds()).toEqual(['2:7', '2:3']);
    expect(m.component.primary()?.id).toBe('2:3');
    m.component.select(4, true);
    expect(m.component.selectedIds()).toEqual(['2:3']);
    m.component.selectAll();
    expect(m.component.selectedIds()).toEqual([
      '2:3',
      '2:4',
      '2:5',
      '2:6',
      '2:7',
      '2:8',
      '2:9',
    ]);
  });

  it('marquee-selects images together with textboxes', async () => {
    const m = await mounted();
    const body = m.element.querySelector<HTMLElement>('.body')!;
    let captured = false;
    body.setPointerCapture = () => (captured = true);
    body.hasPointerCapture = () => captured;
    body.releasePointerCapture = () => (captured = false);
    const event = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      return e;
    };
    body.dispatchEvent(event('pointerdown', 190, 130));
    window.dispatchEvent(event('pointermove', 600, 300));
    window.dispatchEvent(event('pointerup', 600, 300));
    window.dispatchEvent(event('lostpointercapture', 600, 300));
    await m.settle();
    // Only the three images lie completely inside the rectangle.
    expect(m.component.selectedIds()).toEqual(['2:7', '2:8', '2:9']);
    expect(m.edits()).toHaveLength(0);
  });

  it('moves an image with the keyboard, alone and with a textbox', async () => {
    const m = await mounted();
    m.component.select(4);
    await m.settle();
    m.viewport.focus();
    key(m.viewport, 'keydown', { key: 'ArrowRight' });
    key(m.viewport, 'keyup', { key: 'ArrowRight' });
    expect(m.edits()).toHaveLength(1);
    expect(m.edits()[0]).toMatchObject({
      operation: 'layout',
      payload: { action: 'move', targetIds: ['2:7'], dxPt: 1, dyPt: 0 },
    });
    TestBed.resetTestingModule();
    const big = await mounted();
    big.component.select(4);
    await big.settle();
    big.viewport.focus();
    key(big.viewport, 'keydown', { key: 'ArrowDown', shiftKey: true });
    key(big.viewport, 'keyup', { key: 'ArrowDown' });
    expect(big.edits()[0]).toMatchObject({
      payload: { action: 'move', targetIds: ['2:7'], dxPt: 0, dyPt: 10 },
    });
    TestBed.resetTestingModule();
    const both = await mounted();
    both.component.select(4);
    both.component.select(0, true);
    await both.settle();
    both.viewport.focus();
    key(both.viewport, 'keydown', { key: 'ArrowLeft' });
    key(both.viewport, 'keyup', { key: 'ArrowLeft' });
    expect(both.edits()[0]).toMatchObject({
      payload: { action: 'move', targetIds: ['2:7', '2:3'], dxPt: -1, dyPt: 0 },
    });
  });

  it('moves and resizes an image with the pointer', async () => {
    const m = await mounted();
    drag(m, 4, 8, 4);
    expect(m.edits()[0]).toMatchObject({
      payload: { action: 'move', targetIds: ['2:7'], dxPt: 6, dyPt: 3 },
    });
    TestBed.resetTestingModule();
    const resize = await mounted();
    resize.component.select(4);
    await resize.settle();
    expect(
      resize.element.querySelectorAll('.selection-frame .handle').length,
    ).toBe(8);
    drag(resize, 4, 8, 4, 'se');
    // Logo is 150,105 72×54pt; +6pt/+3pt on the south-east corner.
    expect(resize.edits()[0]).toMatchObject({
      payload: { action: 'resize', handle: 'se', xPt: 228, yPt: 162 },
    });
  });

  it('snaps an image to the grid, and to other items, and uses it as a guide target', async () => {
    const m = await mounted();
    m.component.setView({ gridSnap: true, guidesSnap: false, gridSpacing: 10 });
    drag(m, 4, 8, 0);
    // Left 150pt + 6pt = 156pt snaps to the 160pt grid line; top 105pt to 100pt.
    expect(m.edits()[0]).toMatchObject({
      payload: { targetIds: ['2:7'], dxPt: 10, dyPt: -5 },
    });
    TestBed.resetTestingModule();
    const guides = await mounted();
    guides.component.setView({ gridSnap: false, guidesSnap: true });
    const item = guides.element.querySelector<HTMLElement>(
      'button.item[data-item="4"]',
    )!;
    item.setPointerCapture = () => {};
    item.hasPointerCapture = () => false;
    // Dragging up 68px = 51pt puts the image top (105pt) on Title's 54pt bottom edge.
    guides.component.startGesture(pointer(item, 0, 0), 4);
    guides.component.moveGesture(pointer(item, 0, -68));
    await guides.settle();
    const text = [...guides.element.querySelectorAll('.guide')].map(
      (guide) => guide.textContent,
    );
    expect(text.some((entry) => entry?.includes('Title'))).toBe(true);
    guides.component.cancelGesture();
    // The image is itself a guide target for other items.
    const title = guides.element.querySelector<HTMLElement>(
      'button.item[data-item="0"]',
    )!;
    title.setPointerCapture = () => {};
    title.hasPointerCapture = () => false;
    guides.component.startGesture(pointer(title, 0, 0), 0);
    guides.component.moveGesture(pointer(title, 0, 68));
    await guides.settle();
    const toward = [...guides.element.querySelectorAll('.guide')].map(
      (guide) => guide.textContent,
    );
    expect(toward.some((entry) => entry?.includes('Logo'))).toBe(true);
  });

  it('lets a geometry-only image move, resize, copy, cut, duplicate and delete', async () => {
    const m = await mounted();
    m.component.select(5);
    await m.settle();
    expect(m.component.treeEditableIds()).toContain('2:8');
    expect(m.component.limitations()).toBeNull();
    expect(m.element.textContent).not.toContain('Preservation-only');
    expect(m.element.querySelectorAll('.selection-frame .handle').length).toBe(
      8,
    );
    const clipboard = m.component
      .contextActions()
      .filter((entry) => ['Copy', 'Cut', 'Duplicate'].includes(entry.label));
    expect(clipboard.map((entry) => entry.reason)).toEqual(['', '', '']);
    expect(labels(m)).toContain('Delete… (confirm contained content)');
    expect(m.clipboards()).toHaveLength(0);
    drag(m, 5, 8, 4);
    expect(m.edits()[0]).toMatchObject({
      payload: { action: 'move', targetIds: ['2:8'], dxPt: 6, dyPt: 3 },
    });
    TestBed.resetTestingModule();
    const copy = await mounted();
    copy.component.select(5);
    await copy.settle();
    expect(copy.component.clipboard('copy')).toBe(true);
    expect(copy.clipboards()[0]).toMatchObject({
      action: 'copy',
      targetIds: ['2:8'],
    });
  });

  it('offers a geometry-only image no image or sizing edit', async () => {
    const m = await mounted();
    m.component.select(5);
    await m.settle();
    const item = m.component.selected()!;
    expect(item.capabilities).toEqual([...geometryKeys, 'name']);
    for (const capability of ['image', 'sizing', 'value', 'toolTip'])
      expect(item.capabilities).not.toContain(capability);
    expect(
      m.element.querySelector(
        '[data-property="image"], [data-property="sizing"]',
      ),
    ).toBeNull();
  });

  it('keeps a preservation-only image preserved: no mutation, copy or delete', async () => {
    const m = await mounted();
    m.component.select(6);
    await m.settle();
    expect(m.component.treeEditableIds()).not.toContain('2:9');
    expect(m.component.limitations()).toContain(
      'Preservation-only: the designer offers no mutation.',
    );
    expect(m.element.querySelectorAll('.selection-frame .handle').length).toBe(
      0,
    );
    expect(m.component.canHandle(m.component.selected()!, 'move')).toBe(false);
    expect(labels(m)).not.toContain('Delete… (confirm contained content)');
    expect(
      m.component.contextActions().find((entry) => entry.label === 'Copy')
        ?.reason,
    ).toContain('Preservation-only');
    expect(m.component.clipboard('copy')).toBe(false);
    expect(m.component.gestureNotice()).toContain('preservation-only');
    m.viewport.focus();
    key(m.viewport, 'keydown', { key: 'ArrowRight' });
    key(m.viewport, 'keyup', { key: 'ArrowRight' });
    drag(m, 6, 8, 4);
    expect(m.edits()).toHaveLength(0);
    expect(m.clipboards()).toHaveLength(0);
  });

  const deleteForm = (m: Mounted) =>
    m.element.querySelector<HTMLFormElement>('[aria-label="Delete image"]');
  const authored = (m: Mounted) =>
    m
      .edits()
      .filter(
        (entry) => (entry as { operation?: string }).operation === 'author',
      );

  it('offers an editable image a confirmed Delete image control, not the textbox form', async () => {
    const m = await mounted();
    m.component.select(4);
    await m.settle();
    expect(m.element.textContent).not.toContain('Preserved content');
    expect(m.element.querySelector('[aria-label="Delete textbox"]')).toBeNull();
    expect(m.element.querySelector('rdlc-textbox-properties')).toBeNull();
    expect(m.element.querySelector('rdlc-image-properties')).not.toBeNull();
    const form = deleteForm(m)!;
    expect(form).not.toBeNull();
    expect(form.textContent).toContain('Logo');
    expect(form.querySelector('button')!.textContent).toContain('Delete image');
    // Unconfirmed: the request carries an empty confirmation, which the host refuses.
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await m.settle();
    expect(authored(m).at(-1)).toMatchObject({
      targetId: '2:7',
      payload: { action: 'deleteImage', confirm: '' },
    });
  });

  it('routes an editable image to the image inspector and its geometry to a LayoutIntent', async () => {
    const m = await mounted();
    m.component.select(4);
    await m.settle();
    const field = (property: string) =>
      m.element.querySelector<HTMLInputElement>(
        `rdlc-image-properties [data-property="${property}"]`,
      )!;
    expect(field('name').value).toBe('Logo');
    expect(field('left').value).toBe('150pt');
    // The inspector is disabled while an edit is pending, so each one is answered first.
    const answer = async () => {
      const sent = m.edits().at(-1) as { requestId: string };
      m.host.ingest({
        protocol: 2,
        kind: 'editResult',
        requestId: sent.requestId,
        baseVersion: 2,
        version: 2,
        changed: false,
        accepted: false,
        mappings: [],
        reason: 'REFUSED',
        diagnostics: [],
      });
      await m.settle();
    };
    const commit = async (property: string, value: string) => {
      field(property).value = value;
      field(property).dispatchEvent(new Event('change'));
      await m.settle();
    };
    await commit('left', '200pt');
    expect(m.edits().at(-1)).toMatchObject({
      operation: 'layout',
      payload: { action: 'move', targetIds: ['2:7'], dxPt: 50, dyPt: 0 },
    });
    await answer();
    await commit('top', '100pt');
    expect(m.edits().at(-1)).toMatchObject({
      operation: 'layout',
      payload: { action: 'move', targetIds: ['2:7'], dxPt: 0, dyPt: -5 },
    });
    await answer();
    await commit('width', '100pt');
    expect(m.edits().at(-1)).toMatchObject({
      operation: 'layout',
      payload: { action: 'resize', handle: 'e', xPt: 250 },
    });
    await answer();
    await commit('height', '60pt');
    expect(m.edits().at(-1)).toMatchObject({
      operation: 'layout',
      payload: { action: 'resize', handle: 's', yPt: 165 },
    });
    await answer();
    // The host refuses a negative position; a value that is not a size never leaves.
    const sent = m.edits().length;
    await commit('left', 'wide');
    expect(m.edits()).toHaveLength(sent);
    expect(m.component.gestureNotice()).toContain('valid size');
  });

  it('sends image property and replace requests as typed author intents', async () => {
    const m = await mounted();
    m.component.select(4);
    await m.settle();
    const sizing = m.element.querySelector<HTMLSelectElement>(
      'rdlc-image-properties [data-property="sizing"]',
    )!;
    sizing.value = 'Clip';
    sizing.dispatchEvent(new Event('change'));
    await m.settle();
    expect(authored(m).at(-1)).toMatchObject({
      targetId: '2:7',
      payload: {
        action: 'setImageProperty',
        property: 'sizing',
        value: 'Clip',
      },
    });
    const sent = authored(m).at(-1) as { requestId: string };
    m.host.ingest({
      protocol: 2,
      kind: 'editResult',
      requestId: sent.requestId,
      baseVersion: 2,
      version: 2,
      changed: false,
      accepted: false,
      mappings: [],
      reason: 'IMAGE_PROPERTY_INVALID',
      diagnostics: [],
    });
    await m.settle();
    const replace = [
      ...m.element.querySelectorAll<HTMLButtonElement>(
        'rdlc-image-properties button',
      ),
    ].find((button) => button.textContent!.includes('Replace'))!;
    replace.click();
    await m.settle();
    expect(authored(m).at(-1)).toMatchObject({
      targetId: '2:7',
      payload: { action: 'replaceImagePicture', scope: 'all' },
    });
  });

  describe('image field commits', () => {
    async function fields() {
      const m = await mounted();
      m.component.select(4);
      await m.settle();
      const field = (property: string) =>
        m.element.querySelector<HTMLSelectElement | HTMLInputElement>(
          `rdlc-image-properties [data-property="${property}"]`,
        )!;
      // A real select or typed field fires `input` (a tracked draft) before `change`.
      const edit = (property: string, value: string) => {
        const control = field(property);
        control.focus();
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        return control;
      };
      const answer = async (version = 2) => {
        const sent = authored(m).at(-1) as { requestId: string };
        m.host.ingest({
          protocol: 2,
          kind: 'editResult',
          requestId: sent.requestId,
          baseVersion: version,
          version,
          changed: false,
          accepted: false,
          mappings: [],
          reason: 'IMAGE_PROPERTY_INVALID',
          diagnostics: [],
        });
        await m.settle();
      };
      return { m, field, edit, answer };
    }

    it('commits a select and a text field after the input event that precedes change', async () => {
      const { m, edit, answer } = await fields();
      edit('sizing', 'Clip').dispatchEvent(
        new Event('change', { bubbles: true }),
      );
      await m.settle();
      expect(m.component.conflict()).toBeNull();
      expect(authored(m).at(-1)).toMatchObject({
        targetId: '2:7',
        payload: {
          action: 'setImageProperty',
          property: 'sizing',
          value: 'Clip',
        },
      });
      expect(m.component.draft()).toBeNull();
      await answer();
      edit('toolTip', 'Company logo').dispatchEvent(
        new Event('change', { bubbles: true }),
      );
      await m.settle();
      expect(authored(m)).toHaveLength(2);
      expect(authored(m).at(-1)).toMatchObject({
        payload: { property: 'toolTip', value: 'Company logo' },
      });
    });

    it('holds the commit behind the banner when a pointer action is under way', async () => {
      const { m, edit } = await fields();
      const control = edit('toolTip', 'Draft tip');
      const other = m.element.querySelector<HTMLButtonElement>(
        'ul[aria-label="Report items"] button',
      )!;
      other.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      // Native blur/change happens between pointerdown and click.
      control.dispatchEvent(new Event('change', { bubbles: true }));
      other.click();
      await m.settle();
      expect(authored(m)).toHaveLength(0);
      expect(m.component.conflict()).not.toBeNull();
      expect(m.element.textContent).toContain('Unapplied draft');
      expect(m.component.selected()?.id).toBe('2:7');
    });

    it('sends once when Enter is followed by change', async () => {
      const { m, edit, answer } = await fields();
      const control = edit('toolTip', 'Once');
      key(control, 'keydown', { key: 'Enter' });
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await m.settle();
      expect(authored(m)).toHaveLength(1);
      await answer();
      // The next, unrelated request is not affected by the earlier commit.
      const replace = [
        ...m.element.querySelectorAll<HTMLButtonElement>(
          'rdlc-image-properties button',
        ),
      ].find((button) => button.textContent!.includes('Replace'))!;
      replace.click();
      await m.settle();
      expect(authored(m)).toHaveLength(2);
      expect(authored(m).at(-1)).toMatchObject({
        payload: { action: 'replaceImagePicture' },
      });
    });

    it('keeps a draft of another form protected', async () => {
      const { m, edit } = await fields();
      const foreign = document.createElement('form');
      const input = document.createElement('input');
      foreign.append(input);
      m.element.append(foreign);
      const control = edit('toolTip', 'Mine');
      m.component.draft.set({
        version: 2,
        control: input as unknown as NonNullable<
          ReturnType<typeof m.component.draft>
        >['control'],
      });
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await m.settle();
      expect(authored(m)).toHaveLength(0);
      expect(m.component.conflict()).not.toBeNull();
    });

    it('applies and discards an image draft held behind the banner', async () => {
      const { m, edit } = await fields();
      const hold = async () => {
        const control = edit('toolTip', 'Held tip');
        const other = m.element.querySelector<HTMLButtonElement>(
          'ul[aria-label="Report items"] button',
        )!;
        other.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        other.click();
        await m.settle();
        return control;
      };
      const label = (text: string) =>
        [...m.element.querySelectorAll('button')].find((b) =>
          b.textContent?.includes(text),
        ) as HTMLButtonElement;
      const control = await hold();
      label('Discard draft').click();
      await m.settle();
      expect(authored(m)).toHaveLength(0);
      expect(m.edits()).toHaveLength(0);
      expect(control.value).toBe('');
      m.component.select(4);
      await m.settle();
      await hold();
      label('Apply draft').click();
      await m.settle();
      expect(m.edits()).toHaveLength(1);
      expect(authored(m)).toHaveLength(1);
      expect(authored(m)[0]).toMatchObject({
        targetId: '2:7',
        payload: {
          action: 'setImageProperty',
          property: 'toolTip',
          value: 'Held tip',
        },
      });
    });

    it('drops a field commit of an older item', async () => {
      const { m, edit } = await fields();
      const control = edit('toolTip', 'Stale');
      m.component.select(3);
      await m.settle();
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await m.settle();
      expect(authored(m)).toHaveLength(0);
    });
  });

  it('shows a geometry-only image its name and Delete image, not the preserved text', async () => {
    const m = await mounted();
    m.component.select(5);
    await m.settle();
    expect(m.element.querySelector('.inspector')?.textContent).toContain(
      'Missing',
    );
    expect(m.element.textContent).not.toContain('Preserved content');
    expect(deleteForm(m)).not.toBeNull();
    expect(
      m.element.querySelector(
        '[data-property="image"], [data-property="sizing"]',
      ),
    ).toBeNull();
    deleteForm(m)!.querySelector<HTMLInputElement>(
      'input[type=checkbox]',
    )!.checked = true;
    deleteForm(m)!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(authored(m).at(-1)).toMatchObject({
      targetId: '2:8',
      payload: { action: 'deleteImage', confirm: 'delete-contained-content' },
    });
  });

  it('keeps a preservation-only image preserved with no delete control', async () => {
    const m = await mounted();
    m.component.select(6);
    await m.settle();
    expect(m.element.textContent).toContain('Preserved content');
    expect(deleteForm(m)).toBeNull();
    expect(authored(m)).toHaveLength(0);
  });

  it('offers no clipboard action for an image the host would refuse', async () => {
    const m = mount();
    const snapshot = withImages() as unknown as {
      scene: { items: { id: string; capabilities: string[] }[] };
    };
    // An expression-valued Left drops the capability, as the projection does.
    snapshot.scene.items.find((item) => item.id === '2:7')!.capabilities = [
      'image',
      'name',
      'top',
      'width',
      'height',
      'sizing',
    ];
    m.host.ingest(snapshot as unknown as HostMessage);
    await m.settle();
    m.fixture.componentInstance.select(4);
    await m.settle();
    const entries = m.fixture.componentInstance
      .contextActions()
      .filter((entry) => ['Copy', 'Cut', 'Duplicate'].includes(entry.label));
    expect(entries).toHaveLength(3);
    for (const entry of entries) expect(entry.reason).not.toBe('');
    expect(m.fixture.componentInstance.clipboard('copy')).toBe(false);
    expect(
      m.host.sent().filter((s) => (s as { kind: string }).kind === 'clipboard'),
    ).toHaveLength(0);
  });

  it('leaves non-image preserved items preserved', async () => {
    const m = await mounted();
    m.component.select(2);
    await m.settle();
    expect(m.component.treeEditableIds()).not.toContain('2:5');
    expect(m.component.limitations()).toContain(
      'Preservation-only: the designer offers no mutation.',
    );
    expect(labels(m)).not.toContain('Delete… (confirm contained content)');
    expect(m.component.clipboard('copy')).toBe(false);
    expect(m.clipboards()).toHaveLength(0);
  });
});
