import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import {
  resizeHandles,
  alignModes,
  type AuthoringRequest,
  type EditIntent,
  type LayoutIntent,
} from '@rdlc/report-model/editing';
import { pixelsToPoints, pointsToPixels } from '@rdlc/report-model/geometry';
import type { Bounds, DesignSceneItem } from '@rdlc/report-model/scene';
import { directProposal, type DirectHandle } from './manipulation';
import { AuthoringComponent } from '../authoring/authoring.component';
import type { DesignScene } from '@rdlc/report-model/scene';
import { DiagnosticsComponent } from '../diagnostics/diagnostics.component';
import {
  TextboxPropertiesComponent,
  type TextboxCommit,
} from '../properties/textbox-properties.component';
import { HostAdapter } from './host-adapter';
import {
  emptySelection,
  selectItem,
  selectAll,
  marqueeSelection,
  mapSelection,
  hitTest,
  type Selection,
} from './selection';

@Component({
  selector: 'rdlc-editor',
  standalone: true,
  imports: [
    DiagnosticsComponent,
    TextboxPropertiesComponent,
    AuthoringComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  readonly host = inject(HostAdapter);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly handles = resizeHandles;
  readonly alignModes = alignModes;
  readonly toPt = pixelsToPoints;
  readonly preview = signal<{
    version: number;
    id: string;
    origins: readonly { id: string; bounds: Bounds }[];
    pointerId: number;
    element: HTMLElement;
    handle: DirectHandle;
    origin: Bounds;
    clientX: number;
    clientY: number;
    dx: number;
    dy: number;
    active: boolean;
    bounds: Bounds;
    valid: boolean;
  } | null>(null);
  readonly gestureNotice = signal('');
  private readonly selection = signal<Selection>(emptySelection(0));
  private suppressClick = false;
  readonly marquee = signal<{
    version: number;
    pointerId: number;
    element: HTMLElement;
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    rect: Bounds;
    active: boolean;
    add: boolean;
  } | null>(null);
  readonly acceptedSelection = computed(() => {
    const selection = this.selection();
    const version = this.host.snapshot()?.version;
    if (selection.version === version) return selection;
    const result = this.host.outcome();
    if (
      result?.accepted &&
      result.baseVersion === selection.version &&
      result.version === version
    ) {
      return mapSelection(selection, version!, result.mappings);
    }
    return emptySelection(version ?? 0);
  });
  readonly selectedIds = computed(() => this.acceptedSelection().bodyItemIds);
  readonly primary = computed(
    () =>
      this.scene()?.items.find(
        (i) => i.id === this.acceptedSelection().primaryId,
      ) ?? null,
  );
  readonly selectedIndex = computed(() => {
    const selection = this.acceptedSelection();
    const id =
      selection.cellTargetId ??
      (selection.bodyItemIds.length === 1 ? selection.primaryId : null);
    const index = this.scene()?.items.findIndex((i) => i.id === id) ?? -1;
    return index < 0 ? null : index;
  });
  readonly scene = computed<DesignScene | null>(
    () => this.host.snapshot()?.scene ?? null,
  );
  readonly selected = computed(() => {
    const index = this.selectedIndex();
    return index === null ? null : (this.scene()?.items[index] ?? null);
  });
  readonly status = computed(() => this.host.snapshot()?.status ?? 'waiting');
  readonly diagnostics = computed(() => [
    ...(this.host.snapshot()?.diagnostics ?? []),
    ...(this.host.outcome()?.diagnostics ?? []),
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelGesture());
    effect(() => {
      const preview = this.preview();
      if (preview && this.host.snapshot()?.version !== preview.version)
        this.cancelGesture('The document changed; the preview was cancelled.');
      if (
        this.marquee() &&
        this.host.snapshot()?.version !== this.marquee()!.version
      )
        this.cancelGesture('The document changed; the marquee was cancelled.');
    });
    effect(() => {
      const accepted = this.acceptedSelection();
      const snapshot = this.host.snapshot();
      const selection = this.selection();
      if (
        (accepted.primaryId !== null || accepted.cellTargetId !== null) &&
        snapshot &&
        selection?.version !== snapshot.version
      ) {
        this.selection.set(accepted);
      }
    });
  }

  select(index: number, toggle = false): void {
    if (this.host.pending()) return;
    this.cancelGesture();
    const version = this.host.snapshot()?.version;
    const item = this.scene()?.items[index];
    if (version !== undefined && item)
      this.selection.set(selectItem(this.acceptedSelection(), item, toggle));
  }

  selectClick(event: MouseEvent, index: number): void {
    if (this.suppressClick && event.detail > 0) {
      this.suppressClick = false;
      return;
    }
    this.select(index, event.shiftKey);
  }

  isSelected(item: DesignSceneItem): boolean {
    return (
      this.selectedIds().includes(item.id) ||
      this.acceptedSelection().cellTargetId === item.id
    );
  }

  selectAll(): void {
    if (this.host.pending()) return;
    this.cancelGesture();
    this.selection.set(
      selectAll(this.host.snapshot()?.version ?? 0, this.scene()?.items ?? []),
    );
  }

  clearSelection(): void {
    if (this.host.pending()) return;
    this.cancelGesture();
    this.selection.set(emptySelection(this.host.snapshot()?.version ?? 0));
  }

  bulkReason(axis: 'horizontal' | 'vertical'): string {
    if (this.status() !== 'editable')
      return 'Fix source diagnostics before arranging items.';
    for (const id of this.selectedIds()) {
      const item = this.scene()?.items.find((i) => i.id === id);
      const operation =
        item?.operations?.[axis === 'horizontal' ? 'moveX' : 'moveY'];
      if (!item || !operation?.eligible)
        return `${item?.label ?? id}: ${operation?.reason ?? 'geometry is unknown or locked; inspect this item in source.'}`;
    }
    return '';
  }

  arrange(
    action: 'align' | 'distribute',
    mode: (typeof alignModes)[number] | 'horizontal' | 'vertical',
  ): void {
    const snapshot = this.host.snapshot();
    const ids = this.selectedIds();
    const horizontal = ['left', 'center', 'right', 'horizontal'].includes(mode);
    if (
      !snapshot ||
      this.host.pending() ||
      ids.length < (action === 'align' ? 2 : 3) ||
      this.bulkReason(horizontal ? 'horizontal' : 'vertical')
    )
      return;
    this.cancelGesture();
    const common = { targetIds: ids, unit: 'pt' as const };
    const payload: LayoutIntent['payload'] =
      action === 'align'
        ? {
            ...common,
            action,
            primaryId: this.primary()!.id,
            mode: mode as (typeof alignModes)[number],
          }
        : { ...common, action, axis: mode as 'horizontal' | 'vertical' };
    this.host.sendEdit({
      requestId: crypto.randomUUID(),
      baseVersion: snapshot.version,
      operation: 'layout',
      payload,
    });
  }

  startMarquee(event: PointerEvent): void {
    if (
      event.target !== event.currentTarget ||
      event.button !== 0 ||
      this.host.pending() ||
      this.preview() ||
      this.marquee()
    )
      return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    if (hitTest(this.scene()!.items, x, y)) return;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    this.marquee.set({
      version: this.host.snapshot()!.version,
      element,
      pointerId: event.pointerId,
      x,
      y,
      clientX: event.clientX + window.scrollX,
      clientY: event.clientY + window.scrollY,
      rect: { left: x, top: y, width: 0, height: 0 },
      active: false,
      add: event.shiftKey,
    });
    event.preventDefault();
  }

  canHandle(item: DesignSceneItem, handle: DirectHandle): boolean {
    if (
      !item.bounds ||
      !item.operations ||
      item.kind === 'cell' ||
      this.host.snapshot()?.status !== 'editable'
    )
      return false;
    const x = handle === 'move' || /[ew]/.test(handle),
      y = handle === 'move' || /[ns]/.test(handle);
    return (
      (!x ||
        item.operations[handle === 'move' ? 'moveX' : 'resizeX'].eligible) &&
      (!y || item.operations[handle === 'move' ? 'moveY' : 'resizeY'].eligible)
    );
  }

  startGesture(
    event: PointerEvent,
    index: number,
    handle: DirectHandle = 'move',
  ): void {
    if (
      event.button !== 0 ||
      this.host.pending() ||
      this.preview() ||
      this.marquee()
    )
      return;
    const item = this.scene()?.items[index];
    if (!item) return;
    this.suppressClick = true;
    event.stopPropagation();
    if (event.shiftKey && handle === 'move') {
      this.select(index, true);
      return;
    }
    if (!this.isSelected(item) || handle !== 'move') this.select(index);
    if (!this.canHandle(item, handle)) return;
    if (
      handle === 'move' &&
      (this.bulkReason('horizontal') || this.bulkReason('vertical'))
    ) {
      this.gestureNotice.set(
        this.bulkReason('horizontal') || this.bulkReason('vertical'),
      );
      return;
    }
    const element = event.currentTarget as HTMLElement;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const origin = Object.fromEntries(
      Object.entries(item.bounds!).map(([key, value]) => [
        key,
        pixelsToPoints(value),
      ]),
    ) as unknown as Bounds;
    const origins = (handle === 'move' ? this.selectedIds() : [item.id]).map(
      (id) => {
        const bounds = this.scene()!.items.find((i) => i.id === id)!.bounds!;
        return {
          id,
          bounds: {
            left: pixelsToPoints(bounds.left),
            top: pixelsToPoints(bounds.top),
            width: pixelsToPoints(bounds.width),
            height: pixelsToPoints(bounds.height),
          },
        };
      },
    );
    this.preview.set({
      version: this.host.snapshot()!.version,
      id: item.id,
      origins,
      pointerId: event.pointerId,
      element,
      handle,
      origin,
      clientX: event.clientX + window.scrollX,
      clientY: event.clientY + window.scrollY,
      dx: 0,
      dy: 0,
      active: false,
      bounds: origin,
      valid: true,
    });
    this.gestureNotice.set('');
    event.preventDefault();
    event.stopPropagation();
  }

  @HostListener('window:pointermove', ['$event'])
  moveGesture(event: PointerEvent): void {
    const marquee = this.marquee();
    if (marquee && event.pointerId === marquee.pointerId) {
      const dx = event.clientX + window.scrollX - marquee.clientX,
        dy = event.clientY + window.scrollY - marquee.clientY;
      this.marquee.set({
        ...marquee,
        active: marquee.active || Math.hypot(dx, dy) >= 3,
        rect: {
          left: marquee.x + Math.min(0, dx),
          top: marquee.y + Math.min(0, dy),
          width: Math.abs(dx),
          height: Math.abs(dy),
        },
      });
      return;
    }
    const preview = this.preview();
    if (!preview || event.pointerId !== preview.pointerId) return;
    const x = event.clientX + window.scrollX - preview.clientX,
      y = event.clientY + window.scrollY - preview.clientY;
    const dx = pixelsToPoints(x),
      dy = pixelsToPoints(y);
    const active = preview.active || Math.hypot(x, y) >= 3;
    const proposal = directProposal(preview.origin, preview.handle, dx, dy);
    const proposals = preview.origins.map((o) =>
      directProposal(o.bounds, preview.handle, dx, dy),
    );
    const valid = proposal.valid && proposals.every((p) => p.valid);
    this.preview.set({ ...preview, dx, dy, active, ...proposal, valid });
    if (active) {
      const body = this.scene()!.body;
      this.gestureNotice.set(
        !valid
          ? 'Invalid geometry: positions must be nonnegative and sizes positive.'
          : proposals.some(
                ({ bounds }) =>
                  pointsToPixels(bounds.left + bounds.width) > body.width ||
                  pointsToPixels(bounds.top + bounds.height) > body.height,
              )
            ? 'Warning: item extends beyond the body.'
            : 'Preview only — release to apply.',
      );
    }
  }

  @HostListener('window:pointerup', ['$event'])
  finishGesture(event: PointerEvent): void {
    this.moveGesture(event);
    const marquee = this.marquee();
    if (marquee && event.pointerId === marquee.pointerId) {
      this.marquee.set(null);
      this.releaseCapture(marquee);
      if (marquee.version !== this.host.snapshot()?.version) return;
      if (marquee.active)
        this.selection.set(
          marqueeSelection(
            this.acceptedSelection(),
            this.scene()!.items,
            marquee.rect,
            marquee.add,
          ),
        );
      else if (!marquee.add) this.clearSelection();
      return;
    }
    const preview = this.preview();
    if (!preview || event.pointerId !== preview.pointerId) return;
    this.preview.set(null);
    this.releaseCapture(preview);
    if (!preview.active) {
      const index =
        this.scene()?.items.findIndex((i) => i.id === preview.id) ?? -1;
      if (index >= 0) this.select(index);
      return;
    }
    if (!preview.valid || preview.version !== this.host.snapshot()?.version) {
      this.gestureNotice.set('Invalid preview cancelled; document unchanged.');
      return;
    }
    const payload: LayoutIntent['payload'] =
      preview.handle === 'move'
        ? {
            action: 'move',
            targetIds: preview.origins.map((o) => o.id),
            unit: 'pt',
            dxPt: preview.dx,
            dyPt: preview.dy,
          }
        : {
            action: 'resize',
            targetIds: [preview.id],
            unit: 'pt',
            handle: preview.handle,
            ...(/[ew]/.test(preview.handle)
              ? {
                  xPt: preview.handle.includes('w')
                    ? preview.bounds.left
                    : preview.bounds.left + preview.bounds.width,
                }
              : {}),
            ...(/[ns]/.test(preview.handle)
              ? {
                  yPt: preview.handle.includes('n')
                    ? preview.bounds.top
                    : preview.bounds.top + preview.bounds.height,
                }
              : {}),
          };
    this.host.sendEdit({
      requestId: crypto.randomUUID(),
      baseVersion: preview.version,
      operation: 'layout',
      payload,
    });
    this.gestureNotice.set('');
  }

  cancelGesture(reason = 'Preview cancelled; document unchanged.'): void {
    const marquee = this.marquee();
    if (marquee) {
      this.marquee.set(null);
      this.releaseCapture(marquee);
      this.gestureNotice.set(reason);
    }
    const preview = this.preview();
    if (!preview) return;
    this.preview.set(null);
    this.releaseCapture(preview);
    this.gestureNotice.set(reason);
  }

  private releaseCapture(preview: {
    element: HTMLElement;
    pointerId: number;
  }): void {
    if (preview.element.hasPointerCapture(preview.pointerId))
      preview.element.releasePointerCapture(preview.pointerId);
  }

  @HostListener('window:pointercancel', ['$event'])
  @HostListener('window:lostpointercapture', ['$event'])
  captureLost(event: PointerEvent): void {
    if (
      event.pointerId === this.preview()?.pointerId ||
      event.pointerId === this.marquee()?.pointerId
    )
      this.cancelGesture();
  }

  @HostListener('window:blur')
  blur(): void {
    this.cancelGesture();
  }

  @HostListener('focusout', ['$event'])
  focusOut(event: FocusEvent): void {
    if (
      !event.relatedTarget ||
      !this.element.nativeElement.contains(event.relatedTarget as Node)
    )
      this.cancelGesture();
  }

  @HostListener('window:keydown', ['$event'])
  keydown(event: KeyboardEvent): void {
    const editable =
      event.target instanceof HTMLElement &&
      !!event.target.closest(
        'input, textarea, select, [contenteditable="true"]',
      );
    if (event.key === 'Escape') {
      if (this.preview() || this.marquee()) this.cancelGesture();
      else if (!editable) this.clearSelection();
      return;
    }
    if (
      !editable &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a' &&
      event.target instanceof Node &&
      this.element.nativeElement.contains(event.target)
    ) {
      event.preventDefault();
      this.selectAll();
      return;
    }
    if (
      event.key === 'Escape' ||
      ((event.ctrlKey || event.metaKey) &&
        ['z', 'y'].includes(event.key.toLowerCase()))
    )
      this.cancelGesture();
  }

  groupPreviewPixels(): readonly Bounds[] {
    const preview = this.preview();
    if (!preview?.active) return [];
    return preview.origins.map((o) => {
      const { bounds } = directProposal(
        o.bounds,
        preview.handle,
        preview.dx,
        preview.dy,
      );
      return {
        left: pointsToPixels(bounds.left),
        top: pointsToPixels(bounds.top),
        width: pointsToPixels(bounds.width),
        height: pointsToPixels(bounds.height),
      };
    });
  }

  openSource(): void {
    this.host.openSource(this.selected()?.id);
  }

  author(request: AuthoringRequest): void {
    this.cancelGesture();
    const snapshot = this.host.snapshot();
    if (!snapshot || snapshot.status !== 'editable') return;
    this.host.sendEdit({
      requestId: crypto.randomUUID(),
      baseVersion: snapshot.version,
      operation: 'author',
      ...request,
    });
  }

  bindField(name: string): void {
    this.commit({ property: 'text', value: `=Fields!${name}.Value` });
  }

  /** Typed intent only; the host validates, patches, reparses and applies. */
  commit(edit: TextboxCommit): void {
    this.cancelGesture();
    const snapshot = this.host.snapshot();
    const item = this.selected();
    if (!snapshot || snapshot.status !== 'editable' || !item) return;
    const intent: EditIntent = {
      requestId: crypto.randomUUID(),
      baseVersion: snapshot.version,
      targetId: item.id,
      operation: 'setProperty',
      payload: { property: edit.property, value: edit.value },
    };
    this.host.sendEdit(intent);
  }
}
