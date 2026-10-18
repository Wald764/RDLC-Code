import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type {
  ReportStructure,
  StructureNode,
} from '@rdlc/report-model/protocol';
import { structureMappings } from './selection';

@Component({
  selector: 'rdlc-structure-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="tree" aria-label="Report structure" (keydown)="keydown($event)">
      @for (node of visible(); track node.id) {
        <div
          role="treeitem"
          [attr.data-node]="node.id"
          [attr.aria-level]="levels().get(node.id)"
          [attr.aria-expanded]="
            hasChildren(node.id) ? expanded().has(node.id) : null
          "
          [attr.aria-selected]="selectedIds().includes(node.id)"
          [attr.tabindex]="(focused() ?? visible()[0]?.id) === node.id ? 0 : -1"
          [style.padding-left.px]="(levels().get(node.id)! - 1) * 12"
          (focus)="focused.set(node.id)"
          (click)="
            activate(
              node.id,
              $event.shiftKey || $event.ctrlKey || $event.metaKey
            )
          "
        >
          @if (hasChildren(node.id)) {
            <button
              type="button"
              tabindex="-1"
              [attr.aria-label]="
                (expanded().has(node.id) ? 'Collapse ' : 'Expand ') + node.label
              "
              (click)="$event.stopPropagation(); toggle(node.id)"
            >
              {{ expanded().has(node.id) ? '▾' : '▸' }}
            </button>
          }
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M2 1h7l3 3v9H2z M9 1v3h3 M4 7h6 M4 10h6"
              fill="none"
              stroke="currentColor"
            />
          </svg>
          <span>{{ node.kind }}: {{ node.label }}</span>
          <small>{{
            editableIds().includes(node.id)
              ? 'Supported editing available'
              : node.preservedReason
                ? 'Preservation-only'
                : 'Structural / source target'
          }}</small>
          @if (node.preservedReason) {
            <small>{{ node.preservedReason }} — use Code XML.</small>
          }
        </div>
      }
    </div>
    @if (!structure()) {
      <p>Structure is unavailable. Use Code XML.</p>
    }
    @if (structure()?.truncated) {
      <p>Structure is incomplete. Use Code XML for the complete report.</p>
    }
    @if (omitted()) {
      <p>
        The selected target is not included in Structure. Selection is retained;
        use Code XML.
      </p>
    }
    <button type="button" (click)="source.emit()">Code XML</button>
  `,
  styles: `
    :host {
      display: block;
    }
    [role='treeitem'] {
      cursor: pointer;
      padding-block: 4px;
      overflow-wrap: anywhere;
    }
    [aria-selected='true'] {
      outline: 1px solid var(--vscode-focusBorder, #3366cc);
      font-weight: bold;
    }
    small {
      display: block;
      font-weight: normal;
    }
    button {
      min-width: 24px;
      min-height: 24px;
    }
  `,
})
export class StructureTreeComponent {
  readonly structure = input<ReportStructure | null>(null);
  readonly selectedIds = input<readonly string[]>([]);
  readonly editableIds = input<readonly string[]>([]);
  readonly select = output<{ id: string; additive: boolean }>();
  readonly source = output<void>();
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly focused = signal<string | null>(null);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private previous: readonly StructureNode[] = [];
  readonly omitted = computed(() =>
    this.selectedIds().some(
      (id) => !this.structure()?.nodes.some((node) => node.id === id),
    ),
  );
  readonly visible = computed(() => {
    const nodes = this.structure()?.nodes ?? [];
    const visible = new Set<string>();
    return nodes.filter((node) => {
      const show =
        node.parentId === null ||
        (visible.has(node.parentId) && this.expanded().has(node.parentId));
      if (show) visible.add(node.id);
      return show;
    });
  });
  constructor() {
    effect(() => {
      const nodes = this.structure()?.nodes ?? [];
      const selected = this.selectedIds();
      untracked(() => {
        let expanded = new Set(this.expanded());
        if (this.previous !== nodes) {
          const sameVersion = this.previous[0]?.id === nodes[0]?.id;
          if (!sameVersion) {
            const mappings = structureMappings(this.previous, nodes);
            expanded = new Set(
              mappings
                .filter((m) => m.resultId && expanded.has(m.sourceId))
                .map((m) => m.resultId!),
            );
            let oldId = this.focused();
            let focused: string | null | undefined;
            while (oldId && !focused) {
              focused = mappings.find((m) => m.sourceId === oldId)?.resultId;
              oldId =
                this.previous.find((node) => node.id === oldId)?.parentId ??
                null;
            }
            const hadFocus = this.element.nativeElement.contains(
              document.activeElement,
            );
            this.focused.set(focused ?? nodes[0]?.id ?? null);
            if (hadFocus)
              afterNextRender(() => this.focusRow(this.focused()), {
                injector: this.injector,
              });
          }
          this.previous = nodes;
        }
        for (const id of selected) {
          let parent = nodes.find((node) => node.id === id)?.parentId;
          while (parent) {
            expanded.add(parent);
            parent = nodes.find((node) => node.id === parent)?.parentId;
          }
        }
        this.expanded.set(expanded);
        const reveal = selected.at(-1);
        if (reveal)
          afterNextRender(
            () => this.row(reveal)?.scrollIntoView?.({ block: 'nearest' }),
            { injector: this.injector },
          );
      });
    });
  }
  hasChildren(id: string): boolean {
    return !!this.structure()?.nodes.some((node) => node.parentId === id);
  }
  /** Parents precede children in structure order, as `visible` already relies on. */
  readonly levels = computed(() => {
    const levels = new Map<string, number>();
    for (const node of this.structure()?.nodes ?? [])
      levels.set(node.id, (levels.get(node.parentId ?? '') ?? 0) + 1);
    return levels;
  });
  toggle(id: string): void {
    this.focused.set(id);
    this.expanded.update((value) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  private row(id: string): HTMLElement | null {
    return this.element.nativeElement.querySelector<HTMLElement>(
      `[role=treeitem][data-node="${CSS.escape(id)}"]`,
    );
  }
  private focusRow(id: string | null): void {
    const row = id === null ? null : this.row(id);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: 'nearest' });
  }
  activate(id: string, additive: boolean): void {
    this.focused.set(id);
    this.select.emit({ id, additive });
  }
  keydown(event: KeyboardEvent): void {
    const nodes = this.visible(),
      index = nodes.findIndex((node) => node.id === this.focused());
    const node = nodes[index < 0 ? 0 : index];
    if (!node) return;
    let next: string | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = nodes[Math.min(nodes.length - 1, index + 1)]?.id;
        break;
      case 'ArrowUp':
        next = nodes[Math.max(0, index - 1)]?.id;
        break;
      case 'Home':
        next = nodes[0]?.id;
        break;
      case 'End':
        next = nodes.at(-1)?.id;
        break;
      case 'ArrowRight':
        if (this.hasChildren(node.id) && !this.expanded().has(node.id))
          this.toggle(node.id);
        else next = nodes.find((child) => child.parentId === node.id)?.id;
        break;
      case 'ArrowLeft':
        if (this.expanded().has(node.id)) this.toggle(node.id);
        else next = node.parentId ?? undefined;
        break;
      case 'Enter':
      case ' ':
        this.activate(
          node.id,
          event.shiftKey || event.ctrlKey || event.metaKey,
        );
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next) {
      this.focused.set(next);
      this.focusRow(next);
    }
  }
}
