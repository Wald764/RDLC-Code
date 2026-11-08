import { TestBed } from '@angular/core/testing';
import type { AuthoringRequest } from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import {
  ImagePropertiesComponent,
  type ImageGeometryCommit,
} from './image-properties.component';
import { defaultViewState } from '../editor/viewport';

const assetKey = 'a'.repeat(64);
const full = [
  'image',
  'name',
  'left',
  'top',
  'width',
  'height',
  'sizing',
  'value',
  'toolTip',
];

const item = (overrides: Partial<DesignSceneItem> = {}): DesignSceneItem =>
  ({
    id: '2:7',
    kind: 'image',
    bounds: { left: 0, top: 0, width: 96, height: 48 },
    label: 'Logo1',
    placeholder: false,
    name: 'Logo1',
    geometry: { left: '0in', top: '0.25in', width: '1in', height: '0.5in' },
    sizing: 'FitProportional',
    display: {
      state: 'picture',
      assetKey,
      pixels: { width: 120, height: 40 },
    },
    metadata: {
      format: 'png',
      pixels: { width: 120, height: 40 },
      encodedSize: 2048,
    },
    capabilities: full,
    ...overrides,
  }) as DesignSceneItem;

const state = (
  references = 2,
  toolTip: { text: string; expression: boolean } | null = null,
): AuthoringState =>
  ({
    id: '2:1',
    page: {},
    datasets: [],
    tables: [],
    embeddedImages: [
      { name: 'logo', displayable: true, references },
      { name: 'photo', displayable: true, references: 1 },
      { name: 'broken', displayable: false, references: 0 },
    ],
    images: [{ id: '2:7', definition: 'logo', toolTip }],
  }) as AuthoringState;

function mount(
  selected: DesignSceneItem = item(),
  authoring: AuthoringState | null = state(),
) {
  const fixture = TestBed.createComponent(ImagePropertiesComponent);
  fixture.componentRef.setInput('item', selected);
  fixture.componentRef.setInput('state', authoring);
  fixture.detectChanges();
  const requests: AuthoringRequest[] = [];
  const geometry: ImageGeometryCommit[] = [];
  fixture.componentInstance.request.subscribe((request) =>
    requests.push(request),
  );
  fixture.componentInstance.geometry.subscribe((commit) =>
    geometry.push(commit),
  );
  const root = fixture.nativeElement as HTMLElement;
  const control = <T extends HTMLElement>(property: string) =>
    root.querySelector<T>(`[data-property="${property}"]`);
  return { fixture, root, requests, geometry, control };
}

describe('image properties', () => {
  it('opens the Picture section with the sizing select under the default view state', () => {
    const { fixture, root, control } = mount();
    fixture.componentRef.setInput(
      'expanded',
      defaultViewState.inspectorExpanded,
    );
    fixture.detectChanges();
    const picture = [...root.querySelectorAll('details')].find(
      (details) =>
        details.querySelector('summary')?.textContent?.trim() === 'Picture',
    );
    expect(picture).toBeTruthy();
    expect(picture!.open).toBe(true);
    expect(picture!.contains(control('sizing'))).toBe(true);
    expect(control<HTMLSelectElement>('sizing')).not.toBeNull();
  });

  it('renders every field with the current accepted values', () => {
    const { root, control } = mount();
    expect(root.querySelector('form')?.getAttribute('aria-label')).toBe(
      'Image properties',
    );
    expect(control<HTMLInputElement>('name')!.value).toBe('Logo1');
    expect(control<HTMLInputElement>('left')!.value).toBe('0in');
    expect(control<HTMLInputElement>('top')!.value).toBe('0.25in');
    expect(control<HTMLInputElement>('width')!.value).toBe('1in');
    expect(control<HTMLInputElement>('height')!.value).toBe('0.5in');
    const sizing = control<HTMLSelectElement>('sizing')!;
    expect(sizing.value).toBe('FitProportional');
    expect([...sizing.options].map((option) => option.value)).toEqual([
      'AutoSize',
      'Fit',
      'FitProportional',
      'Clip',
    ]);
    const definition = control<HTMLSelectElement>('value')!;
    expect(definition.value).toBe('logo');
    // Only definitions that can be displayed are offered.
    expect([...definition.options].map((option) => option.value)).toEqual([
      'logo',
      'photo',
    ]);
    expect(control<HTMLInputElement>('toolTip')!.value).toBe('');
  });

  it('shows read-only metadata that carries no payload', () => {
    const { root } = mount();
    const metadata = root.querySelector('[aria-label="Picture metadata"]')!;
    expect(metadata).toBeTruthy();
    const text = metadata.textContent ?? '';
    expect(text).toContain('PNG');
    expect(text).toContain('120 × 40 px');
    expect(text).toContain('2.0 KiB');
    expect(metadata.querySelector('input, select, textarea')).toBeNull();
    // Neither the asset key nor any image payload reaches the document.
    expect(root.textContent).not.toContain(assetKey);
    expect(root.innerHTML).not.toContain(assetKey);
    expect(root.innerHTML).not.toContain('iVBOR');
    expect(root.querySelector('img')).toBeNull();
  });

  it('shows unavailable metadata as a dash, never as a value', () => {
    const { root } = mount(
      item({
        metadata: { format: null, pixels: null, encodedSize: null },
        display: { state: 'placeholder', reason: 'reference-missing' },
        capabilities: ['name', 'left', 'top', 'width', 'height'],
      }),
    );
    const text = root.querySelector(
      '[aria-label="Picture metadata"]',
    )!.textContent;
    expect(text).toContain('—');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('offers both replace scopes when several items share the definition', () => {
    const { root, requests } = mount(item(), state(3));
    const buttons = [...root.querySelectorAll('button')].map((button) =>
      button.textContent!.trim(),
    );
    expect(buttons).toContain('Replace for this item');
    expect(buttons).toContain('Replace for all 3 items');
    const click = (label: string) =>
      [...root.querySelectorAll('button')]
        .find((button) => button.textContent!.trim() === label)!
        .click();
    click('Replace for this item');
    click('Replace for all 3 items');
    expect(requests).toEqual([
      {
        targetId: '2:7',
        payload: { action: 'replaceImagePicture', scope: 'item' },
      },
      {
        targetId: '2:7',
        payload: { action: 'replaceImagePicture', scope: 'all' },
      },
    ]);
  });

  it('offers a single replace action when the definition has one reference', () => {
    const { root, requests } = mount(item(), state(1));
    const buttons = [...root.querySelectorAll('button')].map((button) =>
      button.textContent!.trim(),
    );
    expect(buttons.filter((label) => label.startsWith('Replace'))).toEqual([
      'Replace picture',
    ]);
    root.querySelector('button')!.click();
    expect(requests).toEqual([
      {
        targetId: '2:7',
        payload: { action: 'replaceImagePicture', scope: 'all' },
      },
    ]);
  });

  it('shows a ToolTip expression as inert text', () => {
    const expression = '=Fields!Caption.Value & "<b>x</b>"';
    const { root, control } = mount(
      item(),
      state(2, { text: expression, expression: true }),
    );
    const field = control<HTMLInputElement>('toolTip')!;
    expect(field.value).toBe(expression);
    expect(root.textContent).toContain('never evaluated');
    // Text is never interpreted as markup.
    expect(root.querySelector('b')).toBeNull();
  });

  it('emits typed intents for property changes and nothing for unchanged values', () => {
    const { control, requests, geometry } = mount();
    const change = (property: string, value: string) => {
      const field = control<HTMLInputElement | HTMLSelectElement>(property)!;
      field.value = value;
      field.dispatchEvent(new Event('change'));
    };
    change('sizing', 'Clip');
    change('value', 'photo');
    change('name', 'Brand');
    change('toolTip', 'Company logo');
    change('name', 'Logo1');
    expect(requests).toEqual([
      {
        targetId: '2:7',
        payload: {
          action: 'setImageProperty',
          property: 'sizing',
          value: 'Clip',
        },
      },
      {
        targetId: '2:7',
        payload: {
          action: 'setImageProperty',
          property: 'value',
          value: 'photo',
        },
      },
      {
        targetId: '2:7',
        payload: {
          action: 'setImageProperty',
          property: 'name',
          value: 'Brand',
        },
      },
      {
        targetId: '2:7',
        payload: {
          action: 'setImageProperty',
          property: 'toolTip',
          value: 'Company logo',
        },
      },
    ]);
    expect(geometry).toEqual([]);
  });

  it('sends geometry through its own output, never as an image property', () => {
    const { control, requests, geometry } = mount();
    const left = control<HTMLInputElement>('left')!;
    left.value = '1in';
    left.dispatchEvent(new Event('change'));
    const height = control<HTMLInputElement>('height')!;
    height.value = '0.5in';
    height.dispatchEvent(new Event('change'));
    expect(geometry).toEqual([
      { property: 'left', value: '1in', targetId: '2:7' },
    ]);
    expect(requests).toEqual([]);
  });

  it('keeps a geometry-only item to name and geometry', () => {
    const { control, root } = mount(
      item({
        display: { state: 'placeholder', reason: 'reference-missing' },
        capabilities: ['name', 'left', 'top', 'width', 'height'],
      }),
    );
    for (const property of ['name', 'left', 'top', 'width', 'height'])
      expect(control<HTMLInputElement>(property)).toBeTruthy();
    for (const property of ['sizing', 'value', 'toolTip'])
      expect(control(property)).toBeNull();
    expect(
      [...root.querySelectorAll('button')].some((button) =>
        button.textContent!.includes('Replace'),
      ),
    ).toBe(false);
  });

  it('hides the ToolTip field when the capability is withheld for a structured ToolTip', () => {
    const { control } = mount(
      item({ capabilities: full.filter((entry) => entry !== 'toolTip') }),
    );
    expect(control('toolTip')).toBeNull();
    expect(control('sizing')).toBeTruthy();
  });

  it('drops typed text superseded by a newer accepted item', () => {
    const { fixture, control, requests } = mount();
    const name = control<HTMLInputElement>('name')!;
    name.value = 'Draft';
    fixture.componentRef.setInput('item', item({ name: 'Reloaded' }));
    fixture.detectChanges();
    expect(control<HTMLInputElement>('name')!.value).toBe('Reloaded');
    control<HTMLInputElement>('name')!.dispatchEvent(new Event('change'));
    expect(requests).toEqual([]);
  });

  it('reports a refusal next to the fields', () => {
    const fixture = TestBed.createComponent(ImagePropertiesComponent);
    fixture.componentRef.setInput('item', item());
    fixture.componentRef.setInput('state', state());
    fixture.componentRef.setInput('refusal', 'IMAGE_PROPERTY_INVALID');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#image-refusal')?.textContent).toContain(
      'IMAGE_PROPERTY_INVALID',
    );
  });
});
