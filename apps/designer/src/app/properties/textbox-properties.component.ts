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
import type { TextboxProperty } from '@rdlc/report-model/editing';
import type { DesignSceneItem, SceneTextStyle } from '@rdlc/report-model/scene';
import type { InspectorSection } from '../editor/viewport';

export interface TextboxCommit {
  readonly property: TextboxProperty;
  readonly value: string;
  /** The version-local item the field belonged to when it emitted. */
  readonly targetId?: string;
}
interface Field {
  readonly property: TextboxProperty;
  readonly label: string;
  readonly kind: 'text' | 'select';
  readonly options: readonly string[];
}

const styleProperties: readonly TextboxProperty[] = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'textAlign',
];
const none: readonly string[] = [];

@Component({
  selector: 'rdlc-textbox-properties',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './textbox-properties.component.html',
  styleUrl: './textbox-properties.component.scss',
})
export class TextboxPropertiesComponent {
  readonly item = input.required<DesignSceneItem>();
  readonly refusal = input('');
  readonly commit = output<TextboxCommit>();
  /** Per-view section expansion; absent sections default open. */
  readonly expanded = input<Partial<Record<InspectorSection, boolean>>>({});
  readonly expand = output<{ section: InspectorSection; open: boolean }>();

  /** Accepted identity and values; a re-emitted equal item is not new. */
  private readonly accepted = computed(() =>
    JSON.stringify([
      this.item().id,
      ...this.fields.map((field) => this.current(field.property)),
    ]),
  );

  constructor() {
    // A newer accepted item supersedes typed text: `[value]` rewrites a control
    // only when its bound value changes, so a reload keeping that value would
    // otherwise leave the obsolete draft in place for its next blur to commit.
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    effect(() => {
      this.accepted();
      untracked(() => {
        for (const control of host.nativeElement.querySelectorAll<
          HTMLInputElement | HTMLSelectElement
        >('[data-property]'))
          control.value = this.current(
            control.dataset['property'] as TextboxProperty,
          );
      });
    });
  }

  readonly fields: readonly Field[] = [
    { property: 'name', label: 'Name', kind: 'text', options: none },
    { property: 'text', label: 'Text', kind: 'text', options: none },
    { property: 'left', label: 'Left', kind: 'text', options: none },
    { property: 'top', label: 'Top', kind: 'text', options: none },
    { property: 'width', label: 'Width', kind: 'text', options: none },
    { property: 'height', label: 'Height', kind: 'text', options: none },
    {
      property: 'fontFamily',
      label: 'Font family',
      kind: 'text',
      options: none,
    },
    { property: 'fontSize', label: 'Font size', kind: 'text', options: none },
    {
      property: 'fontWeight',
      label: 'Bold',
      kind: 'select',
      options: ['Normal', 'Bold'],
    },
    {
      property: 'fontStyle',
      label: 'Italic',
      kind: 'select',
      options: ['Normal', 'Italic'],
    },
    { property: 'color', label: 'Text color', kind: 'text', options: none },
    {
      property: 'textAlign',
      label: 'Horizontal alignment',
      kind: 'select',
      options: ['Default', 'Left', 'Center', 'Right'],
    },
  ];
  readonly sections = [
    { key: 'general', label: 'General', properties: ['name', 'text'] },
    {
      key: 'position',
      label: 'Position and size',
      properties: ['left', 'top', 'width', 'height'],
    },
    {
      key: 'typography',
      label: 'Typography',
      properties: [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'color',
        'textAlign',
      ],
    },
  ] as const;

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

  can(property: TextboxProperty): boolean {
    const item = this.item();
    if (item.placeholder) return false;
    const capabilities = item.capabilities ?? [];
    return styleProperties.includes(property)
      ? capabilities.includes('style')
      : capabilities.includes(property);
  }

  current(property: TextboxProperty): string {
    const item = this.item();
    switch (property) {
      case 'name':
        return item.name ?? '';
      case 'text':
        return item.text ?? '';
      case 'left':
      case 'top':
      case 'width':
      case 'height':
        return item.geometry?.[property] ?? '';
      default:
        return (
          (item.style as SceneTextStyle | null | undefined)?.[property] ?? ''
        );
    }
  }

  submit(property: TextboxProperty, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    if (value === this.current(property)) return;
    this.commit.emit({ property, value, targetId: this.item().id });
  }

  cancel(property: TextboxProperty, event: Event): void {
    (event.target as HTMLInputElement | HTMLSelectElement).value =
      this.current(property);
  }
}
