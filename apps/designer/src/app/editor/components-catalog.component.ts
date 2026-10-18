import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

export type CreationKind = 'textbox' | 'table' | 'dataset';
const categories = [
  {
    label: 'Report items',
    entries: ['Textbox', 'Table', 'Image', 'Line', 'Chart', 'Subreport'],
  },
  { label: 'Containers', entries: ['Rectangle', 'List', 'Matrix'] },
  { label: 'Data', entries: ['Dataset', 'Parameter'] },
] as const;
const supported = new Set(['Textbox', 'Table', 'Dataset']);

@Component({
  selector: 'rdlc-components-catalog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label
      >Search components
      <input
        type="search"
        [value]="query()"
        (input)="query.set(search.value)"
        #search
    /></label>
    @for (category of filtered(); track category.label) {
      <section [attr.aria-label]="category.label">
        <h3>{{ category.label }}</h3>
        @for (entry of category.entries; track entry) {
          <button
            type="button"
            [attr.data-card]="entry"
            [attr.aria-disabled]="!available(entry)"
            [attr.aria-describedby]="
              !available(entry) ? 'reason-' + entry : null
            "
            (click)="choose(entry)"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
              <rect
                x="2"
                y="2"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
              />
              <path d="M5 6h10M5 10h10M5 14h6" stroke="currentColor" />
            </svg>
            {{ entry }}
          </button>
          @if (!available(entry)) {
            <p class="reason" [id]="'reason-' + entry">{{ reason(entry) }}</p>
          }
        }
      </section>
    } @empty {
      <p role="status">No components match your search.</p>
      <button type="button" data-clear (click)="query.set('')">
        Clear search
      </button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    input {
      width: 100%;
      box-sizing: border-box;
    }
    button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 32px;
      margin-top: 4px;
      text-align: left;
    }
    [aria-disabled='true'] {
      opacity: 0.75;
    }
    .reason {
      margin: 2px 0 8px;
      font-size: 0.85em;
    }
  `,
})
export class ComponentsCatalogComponent {
  readonly disabled = input(false);
  readonly query = signal('');
  readonly create = output<CreationKind>();
  readonly filtered = computed(() =>
    categories
      .map((c) => ({
        ...c,
        entries: c.entries.filter((e) =>
          e.toLowerCase().includes(this.query().trim().toLowerCase()),
        ),
      }))
      .filter((c) => c.entries.length),
  );
  available(entry: string): boolean {
    return supported.has(entry) && !this.disabled();
  }
  reason(entry: string): string {
    return supported.has(entry)
      ? 'Wait for the current operation or open an editable report.'
      : `${entry} authoring is unavailable. Existing content is preserved; use Code XML.`;
  }
  choose(entry: string): void {
    if (this.available(entry))
      this.create.emit(entry.toLowerCase() as CreationKind);
  }
}
