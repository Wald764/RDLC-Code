import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Original 16-unit stroke icons; no third-party or proprietary artwork. */
const paths = {
  undo: 'M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7h-3',
  redo: 'M10.5 3.5l3 3-3 3M13.5 6.5h-7a3.5 3.5 0 0 0 0 7h3',
  cut: 'M6.5 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM13.5 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM6 10.5l6-8M10 10.5l-6-8',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  paste: 'M5.5 1.5h5v2h-5zM10.5 2.5h2v11h-9v-11h2',
  duplicate: 'M2.5 2.5h8v8h-8zM5.5 13.5h8v-8M6.5 4.5v4M4.5 6.5h4',
  selectAll:
    'M2.5 2.5h2M6.5 2.5h3M11.5 2.5h2v2M13.5 6.5v3M13.5 11.5v2h-2M9.5 13.5h-3M4.5 13.5h-2v-2M2.5 9.5v-3M2.5 4.5v-2M5.5 5.5h5v5h-5z',
  clear: 'M2.5 2.5h11v11h-11zM5.5 5.5l5 5M10.5 5.5l-5 5',
  'align-left': 'M2.5 1.5v13M4.5 4h8v3h-8zM4.5 9h5v3h-5z',
  'align-center': 'M8 1.5v13M3.5 4h9v3h-9zM5.5 9h5v3h-5z',
  'align-right': 'M13.5 1.5v13M3.5 4h8v3h-8zM6.5 9h5v3h-5z',
  'align-top': 'M1.5 2.5h13M4 4.5h3v8H4zM9 4.5h3v5H9z',
  'align-middle': 'M1.5 8h13M4 3.5h3v9H4zM9 5.5h3v5H9z',
  'align-bottom': 'M1.5 13.5h13M4 3.5h3v8H4zM9 6.5h3v5H9z',
  'distribute-horizontal':
    'M1.5 2.5v11M14.5 2.5v11M4.5 5h2v6h-2zM9.5 5h2v6h-2z',
  'distribute-vertical': 'M2.5 1.5h11M2.5 14.5h11M5 4.5h6v2H5zM5 9.5h6v2H5z',
  minus: 'M3.5 8h9',
  plus: 'M3.5 8h9M8 3.5v9',
  'fit-page':
    'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5.5 4.5h5v7h-5z',
  'fit-body':
    'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M6 6.5h4v3H6z',
  reveal:
    'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM8 .5v2M8 13.5v2M.5 8h2M13.5 8h2',
  grid: 'M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11',
  snap: 'M3.5 2.5v6a4.5 4.5 0 0 0 9 0v-6h-3v6a1.5 1.5 0 0 1-3 0v-6zM3.5 5.5h3M9.5 5.5h3',
  guides: 'M5.5 1.5v13M1.5 10.5h13M9 4.5h3v3H9z',
  page: 'M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3',
  more: 'M8 3.5v.01M8 8v.01M8 12.5v.01',
  'panel-left': 'M1.5 2.5h13v11h-13zM5.5 2.5v11',
  'panel-right': 'M1.5 2.5h13v11h-13zM10.5 2.5v11',
  close: 'M4 4l8 8M12 4l-8 8',
  'chevron-right': 'M6 4l4 4-4 4',
  'chevron-down': 'M4 6l4 4 4-4',
  check: 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM5 8.2l2 2 4-4.2',
  warning: 'M8 2l6.5 11.5h-13zM8 6.5v3.5M8 11.8v.01',
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5',
  design: 'M2.5 2.5h11v11h-11zM2.5 6.5h11M6.5 6.5v7',
  preview:
    'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  search: 'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9ZM10.2 10.2l3.8 3.8',
  delete: 'M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9M6.8 7v4.5M9.2 7v4.5',
  properties: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.5 3v3M10.5 6.5v3M7 10v3',
  textbox: 'M2.5 3.5h11v9h-11zM5.5 6h5M8 6v4.5',
  table: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6.2 6.5v6M9.8 6.5v6',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5M10.5 6v.01',
  line: 'M3 13 13 3',
  chart: 'M2.5 13.5h11M4.5 13.5v-4M7.5 13.5v-8M10.5 13.5v-6',
  subreport: 'M3.5 1.5h6l3 3v10h-9zM5.5 8h5v4h-5z',
  rectangle: 'M2.5 3.5h11v9h-11z',
  list: 'M2.5 2.5h11v11h-11zM5 5.5h6M5 8h6M5 10.5h6',
  matrix: 'M2.5 2.5h11v11h-11zM2.5 6h11M2.5 9.7h11M6 2.5v11M9.7 2.5v11',
  dataset:
    'M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2ZM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
  parameter:
    'M8 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 13.5a5 5 0 0 1 10 0',
  field: 'M3.5 3.5h9M3.5 8h9M3.5 12.5h5',
  report: 'M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M5.5 8h5M5.5 10.5h5',
  sections: 'M2.5 2.5h11v5h-11zM2.5 9.5h11v4h-11z',
  section: 'M2.5 2.5h11v11h-11zM2.5 5.5h11M2.5 10.5h11',
  header: 'M2.5 2.5h11v11h-11zM2.5 5.5h11',
  footer: 'M2.5 2.5h11v11h-11zM2.5 10.5h11',
  body: 'M2.5 2.5h11v11h-11zM4.5 4.5h7v7h-7z',
  row: 'M1.5 5.5h13v5h-13zM6 5.5v5M10 5.5v5',
  cell: 'M3.5 3.5h9v9h-9zM5.5 8h5',
  container: 'M2.5 3.5h11v9h-11zM4.5 5.5h4v3h-4z',
  preserved: 'M4.5 7.5v-2a3.5 3.5 0 0 1 7 0v2M3.5 7.5h9v6h-9z',
} as const;
export type IconName = keyof typeof paths;

@Component({
  selector: 'rdlc-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 16 16"
    [attr.width]="size()"
    [attr.height]="size()"
  >
    <path [attr.d]="d()" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    path {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(16);
  d(): string {
    return paths[this.name()];
  }
}

export const iconFor = (name: string): IconName =>
  name in paths ? (name as IconName) : 'rectangle';
