import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent, iconFor } from './icon.component';

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
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="search"
      ><span class="sr-only">Search components</span>
      <input
        type="search"
        placeholder="Search components"
        [value]="query()"
        (input)="query.set(search.value)"
        #search
    /></label>
    @for (category of filtered(); track category.label) {
      <section [attr.aria-label]="category.label">
        <h3>{{ category.label }}</h3>
        <div class="cards">
          @for (entry of category.entries; track entry) {
            <button
              type="button"
              [attr.data-card]="entry"
              [attr.aria-disabled]="!available(entry)"
              [attr.aria-describedby]="
                !available(entry) ? 'reason-' + entry : null
              "
              [title]="
                available(entry)
                  ? 'Drag onto the report, or press Enter to insert ' + entry
                  : reason(entry)
              "
              [draggable]="available(entry)"
              (dragstart)="dragStart($event, entry)"
              (click)="choose(entry)"
            >
              <rdlc-icon [name]="icon(entry)" [size]="24" />{{ entry }}
            </button>
            @if (!available(entry)) {
              <p class="sr-only" [id]="'reason-' + entry">
                {{ reason(entry) }}
              </p>
            }
          }
        </div>
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
    .search input {
      width: 100%;
      margin: 2px 0 6px;
    }
    h3 {
      margin: 12px 0 6px;
      font-size: 12px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
      gap: 6px;
    }
    [data-card] {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 64px;
      padding: 6px 2px;
      font-size: 12px;
      color: inherit;
      background: var(--rd-bg);
      border: 1px solid var(--rd-border);
      border-radius: 6px;
    }
    [data-card] rdlc-icon {
      color: var(--rd-accent);
    }
    [data-card]:hover:not([aria-disabled='true']) {
      background: var(--rd-bg);
      border-color: var(--rd-accent);
    }
    [data-card][aria-disabled='true'] {
      color: var(--vscode-disabledForeground, #8b8b8b);
      background: transparent;
      border-style: dashed;
    }
    [data-card][aria-disabled='true'] rdlc-icon {
      color: inherit;
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
  icon(entry: string) {
    return iconFor(entry.toLowerCase());
  }
  available(entry: string): boolean {
    return supported.has(entry) && !this.disabled();
  }
  reason(entry: string): string {
    return supported.has(entry)
      ? 'Wait for the current operation or open an editable report.'
      : `${entry} authoring is unavailable. Existing content is preserved; use Code XML.`;
  }
  dragStart(event: DragEvent, entry: string): void {
    if (!this.available(entry) || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const kind = entry.toLowerCase();
    // The kind travels in the type so drop targets can read it during dragover.
    event.dataTransfer.setData(`application/x-rdlc-${kind}`, kind);
    event.dataTransfer.effectAllowed = 'copy';
  }
  choose(entry: string): void {
    if (this.available(entry))
      this.create.emit(entry.toLowerCase() as CreationKind);
  }
}
