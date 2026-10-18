import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { TextboxProperty } from '@rdlc/report-model/editing';
import type { DesignSceneItem, SceneTextStyle } from '@rdlc/report-model/scene';

export interface TextboxCommit {
  readonly property: TextboxProperty;
  readonly value: string;
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
    { label: 'General', properties: ['name', 'text'] },
    {
      label: 'Position and size',
      properties: ['left', 'top', 'width', 'height'],
    },
    {
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
    this.commit.emit({ property, value });
  }

  cancel(property: TextboxProperty, event: Event): void {
    (event.target as HTMLInputElement | HTMLSelectElement).value =
      this.current(property);
  }
}
