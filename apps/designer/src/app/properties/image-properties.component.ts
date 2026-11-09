import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import type {
  AuthoringRequest,
  ImageReplaceScope,
  ImageScalarProperty,
} from '@rdlc/report-model/editing';
import type { AuthoringState } from '@rdlc/report-model/protocol';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import type { InspectorSection } from '../editor/viewport';

export type ImageGeometryProperty = 'left' | 'top' | 'width' | 'height';
/** A geometry field commit; the editor turns it into the existing `LayoutIntent`. */
export interface ImageGeometryCommit {
  readonly property: ImageGeometryProperty;
  readonly value: string;
  /** The version-local item the field belonged to when it emitted. */
  readonly targetId?: string;
}
type FieldProperty = ImageScalarProperty | ImageGeometryProperty;
interface Field {
  readonly property: FieldProperty;
  readonly label: string;
  readonly kind: 'text' | 'select';
}

const sizings = ['AutoSize', 'Fit', 'FitProportional', 'Clip'] as const;
const geometryProperties: readonly FieldProperty[] = [
  'left',
  'top',
  'width',
  'height',
];
const kibibyte = 1024;
const mebibyte = kibibyte * kibibyte;

/** Encoded size in binary units; the length of the base64 text, never the text. */
function formatSize(bytes: number): string {
  if (bytes >= mebibyte) return `${(bytes / mebibyte).toFixed(1)} MiB`;
  if (bytes >= kibibyte) return `${(bytes / kibibyte).toFixed(1)} KiB`;
  return `${bytes} B`;
}

@Component({
  selector: 'rdlc-image-properties',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-properties.component.html',
  styleUrl: './image-properties.component.scss',
})
export class ImagePropertiesComponent {
  readonly item = input.required<DesignSceneItem>();
  /** Supplies the definition picker, the item's definition and its ToolTip. */
  readonly state = input<AuthoringState | null>(null);
  readonly refusal = input('');
  /** Per-view section expansion; absent sections default open. */
  readonly expanded = input<Partial<Record<InspectorSection, boolean>>>({});
  readonly request = output<AuthoringRequest>();
  readonly geometry = output<ImageGeometryCommit>();
  readonly expand = output<{ section: InspectorSection; open: boolean }>();

  readonly sizings = sizings;
  readonly fields: readonly Field[] = [
    { property: 'name', label: 'Name', kind: 'text' },
    { property: 'toolTip', label: 'ToolTip', kind: 'text' },
    { property: 'value', label: 'Embedded image', kind: 'select' },
    { property: 'sizing', label: 'Sizing', kind: 'select' },
    { property: 'left', label: 'Left', kind: 'text' },
    { property: 'top', label: 'Top', kind: 'text' },
    { property: 'width', label: 'Width', kind: 'text' },
    { property: 'height', label: 'Height', kind: 'text' },
  ];
  readonly sections = [
    { key: 'general', label: 'General', properties: ['name', 'toolTip'] },
    {
      key: 'appearance',
      label: 'Picture',
      properties: ['value', 'sizing'],
    },
    {
      key: 'position',
      label: 'Position and size',
      properties: ['left', 'top', 'width', 'height'],
    },
  ] as const;

  private readonly authored = computed(() =>
    this.state()?.images?.find((entry) => entry.id === this.item().id),
  );
  /** Name of the referenced definition; empty when none resolves. */
  readonly definition = computed(() => this.authored()?.definition ?? '');
  /** Displayable definitions of the report, plus the current one so it stays visible. */
  readonly definitions = computed(() => {
    const names = (this.state()?.embeddedImages ?? [])
      .filter((entry) => entry.displayable)
      .map((entry) => entry.name);
    const current = this.definition();
    return current && !names.includes(current) ? [...names, current] : names;
  });
  /** How many image items share the referenced definition (this one included). */
  readonly references = computed(
    () =>
      this.state()?.embeddedImages?.find(
        (entry) => entry.name === this.definition(),
      )?.references ?? 0,
  );
  readonly shared = computed(() => this.references() > 1);
  readonly canReplace = computed(
    () => !!this.item().capabilities?.includes('image'),
  );
  readonly metadata = computed(() => {
    const metadata = this.item().metadata;
    const pixels = metadata?.pixels;
    return {
      format:
        metadata?.format === 'png'
          ? 'PNG'
          : metadata?.format === 'jpeg'
            ? 'JPEG'
            : metadata?.format === 'other'
              ? 'Not displayable'
              : '—',
      dimensions: pixels ? `${pixels.width} × ${pixels.height} px` : '—',
      encoded:
        metadata?.encodedSize == null ? '—' : formatSize(metadata.encodedSize),
    };
  });
  readonly toolTipIsExpression = computed(
    () => !!this.authored()?.toolTip?.expression,
  );

  /** Accepted identity and values; a re-emitted equal item is not new. */
  private readonly accepted = computed(() =>
    JSON.stringify([
      this.item().id,
      ...this.fields.map((field) => this.current(field.property)),
    ]),
  );

  constructor() {
    // A newer accepted item supersedes typed text: see `TextboxPropertiesComponent`.
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    effect(() => {
      this.accepted();
      untracked(() => {
        for (const control of host.nativeElement.querySelectorAll<
          HTMLInputElement | HTMLSelectElement
        >('[data-property]'))
          control.value = this.current(
            control.dataset['property'] as FieldProperty,
          );
      });
    });
  }

  toggled(section: InspectorSection, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open !== (this.expanded()[section] ?? true))
      this.expand.emit({ section, open });
  }

  relevant(properties: readonly string[]): readonly Field[] {
    return this.fields.filter(
      (field) =>
        properties.includes(field.property) && this.can(field.property),
    );
  }

  can(property: FieldProperty): boolean {
    return !!this.item().capabilities?.includes(property);
  }

  current(property: FieldProperty): string {
    const item = this.item();
    switch (property) {
      case 'name':
        return item.name ?? '';
      case 'sizing':
        return item.sizing ?? '';
      case 'value':
        return this.definition();
      case 'toolTip':
        return this.authored()?.toolTip?.text ?? '';
      default:
        return item.geometry?.[property] ?? '';
    }
  }

  submit(property: FieldProperty, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    if (value === this.current(property)) return;
    const targetId = this.item().id;
    if (geometryProperties.includes(property))
      this.geometry.emit({
        property: property as ImageGeometryProperty,
        value,
        targetId,
      });
    else
      this.request.emit({
        targetId,
        payload: {
          action: 'setImageProperty',
          property: property as ImageScalarProperty,
          value,
        },
      });
  }

  cancel(property: FieldProperty, event: Event): void {
    (event.target as HTMLInputElement | HTMLSelectElement).value =
      this.current(property);
  }

  replace(scope: ImageReplaceScope): void {
    this.request.emit({
      targetId: this.item().id,
      payload: { action: 'replaceImagePicture', scope },
    });
  }
}
