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
import { IconComponent, iconFor } from './icon.component';

@Component({
  selector: 'rdlc-structure-tree',
  standalone: true,
  imports: [IconComponent],
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
          [style.padding-left.px]="(levels().get(node.id)! - 1) * 14"
          [title]="node.preservedReason ?? node.label"
          (focus)="focused.set(node.id)"
          (contextmenu)="openMenu($event, node.id)"
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
              class="twisty"
              [attr.aria-label]="
                (expanded().has(node.id) ? 'Collapse ' : 'Expand ') + node.label
              "
              (click)="$event.stopPropagation(); toggle(node.id)"
            >
              <rdlc-icon
                [name]="
                  expanded().has(node.id) ? 'chevron-down' : 'chevron-right'
                "
                [size]="14"
              />
            </button>
          } @else {
            <span class="twisty"></span>
          }
          <rdlc-icon class="kind" [name]="icon(node.kind)" />
          <span class="label">{{ display(node) }}</span>
          @if (node.preservedReason) {
            <rdlc-icon class="lock" name="preserved" [size]="12" />
          }
          <small class="sr-only">{{
            editableIds().includes(node.id)
              ? 'Supported editing available'
              : node.preservedReason
                ? 'Preservation-only'
                : 'Structural / source target'
          }}</small>
          @if (node.preservedReason) {
            <small class="sr-only"
              >{{ node.preservedReason }} — use Code XML.</small
            >
          }
        </div>
      }
    </div>
    @if (!structure()) {
      <p class="note">Structure is unavailable. Use Code XML.</p>
    }
    @if (structure()?.truncated) {
      <p class="note">
        Structure is incomplete. Use Code XML for the complete report.
      </p>
    }
    @if (omitted()) {
      <p class="note">
        The selected target is not included in Structure. Selection is retained;
        use Code XML.
      </p>
    }
    <button type="button" class="source" (click)="source.emit()">
      Code XML
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    [role='treeitem'] {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 22px;
      padding-right: 6px;
      border-radius: 3px;
      white-space: nowrap;
      cursor: pointer;
    }
    [role='treeitem']:hover {
      background: var(--vscode-list-hoverBackground, var(--rd-hover));
    }
    [role='treeitem'][aria-selected='true'] {
      color: var(--rd-selected-fg);
      background: var(--rd-selected);
    }
    [role='treeitem']:focus-visible {
      outline: 1px solid var(--rd-accent);
      outline-offset: -1px;
    }
    .twisty {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 16px;
      min-width: 16px;
      min-height: 16px;
      padding: 0;
      border: 0;
      color: inherit;
      background: transparent;
    }
    .kind {
      color: var(--rd-accent);
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lock {
      color: var(--rd-muted);
    }
    .note {
      margin: 8px 0;
      font-size: 12px;
      color: var(--rd-muted);
    }
    .source {
      margin-top: 8px;
    }
  `,
})
export class StructureTreeComponent {
  readonly structure = input<ReportStructure | null>(null);
  readonly selectedIds = input<readonly string[]>([]);
  readonly editableIds = input<readonly string[]>([]);
  /** Levels opened when a report first loads; later expansion is the author's. */
  readonly autoExpand = input(0);
  readonly select = output<{ id: string; additive: boolean }>();
  readonly source = output<void>();
  /** Context menu request at client coordinates (pointer or keyboard). */
  readonly menu = output<{ id: string; x: number; y: number }>();
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
          const first = !this.previous.length;
          if (!sameVersion) {
            // Expansion may follow unique unnamed nodes; focus only named identities.
            const mappings = structureMappings(this.previous, nodes);
            expanded = new Set(
              structureMappings(this.previous, nodes, true)
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
          if (first)
            for (const node of nodes)
              if (this.levels().get(node.id)! < this.autoExpand())
                expanded.add(node.id);
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
  icon(kind: string) {
    return iconFor(kind);
  }
  /** "Textbox (Title)" for named nodes, the structural label otherwise. */
  display(node: StructureNode): string {
    const kind = node.label.split(': ')[0]!;
    return node.name ? `${kind} (${node.name})` : node.label;
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
  openMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    this.focused.set(id);
    this.menu.emit({ id, x: event.clientX, y: event.clientY });
  }
  keydown(event: KeyboardEvent): void {
    const nodes = this.visible(),
      index = nodes.findIndex((node) => node.id === this.focused());
    const node = nodes[index < 0 ? 0 : index];
    if (!node) return;
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      event.stopPropagation();
      const rect = this.row(node.id)?.getBoundingClientRect();
      this.menu.emit({
        id: node.id,
        x: (rect?.left ?? 0) + 24,
        y: rect?.bottom ?? 0,
      });
      return;
    }
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
