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
  readonly toPt = pixelsToPoints;
  readonly preview = signal<{
    version: number;
    id: string;
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
  private readonly selection = signal<{
    version: number;
    index: number;
    id: string;
  } | null>(null);
  // Source edits can reorder items, so never carry an ordinal into another version.
  readonly selectedIndex = computed(() => {
    const selection = this.selection();
    if (!selection) return null;
    const version = this.host.snapshot()?.version;
    if (selection.version === version) return selection.index;
    const result = this.host.outcome();
    if (
      result?.accepted &&
      result.baseVersion === selection.version &&
      result.version === version
    ) {
      const id = result.mappings.find(
        (m) => m.sourceId === selection.id,
      )?.resultId;
      const index =
        this.scene()?.items.findIndex((item) => item.id === id) ?? -1;
      return index >= 0 ? index : null;
    }
    return null;
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
    });
    effect(() => {
      const index = this.selectedIndex();
      const snapshot = this.host.snapshot();
      const selection = this.selection();
      if (
        index !== null &&
        snapshot &&
        selection?.version !== snapshot.version
      ) {
        this.selection.set({
          version: snapshot.version,
          index,
          id: snapshot.scene!.items[index]!.id,
        });
      }
    });
  }

  select(index: number): void {
    if (this.host.pending()) return;
    this.cancelGesture();
    const version = this.host.snapshot()?.version;
    const id = this.scene()?.items[index]?.id;
    if (version !== undefined && id) this.selection.set({ version, index, id });
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
    if (event.button !== 0 || this.host.pending() || this.preview()) return;
    const item = this.scene()?.items[index];
    if (!item || !this.canHandle(item, handle)) return;
    this.select(index);
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
    this.preview.set({
      version: this.host.snapshot()!.version,
      id: item.id,
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
    const preview = this.preview();
    if (!preview || event.pointerId !== preview.pointerId) return;
    const x = event.clientX + window.scrollX - preview.clientX,
      y = event.clientY + window.scrollY - preview.clientY;
    const dx = pixelsToPoints(x),
      dy = pixelsToPoints(y);
    const active = preview.active || Math.hypot(x, y) >= 3;
    const proposal = directProposal(preview.origin, preview.handle, dx, dy);
    this.preview.set({ ...preview, dx, dy, active, ...proposal });
    if (active) {
      const body = this.scene()!.body;
      this.gestureNotice.set(
        !proposal.valid
          ? 'Invalid geometry: positions must be nonnegative and sizes positive.'
          : pointsToPixels(proposal.bounds.left + proposal.bounds.width) >
                body.width ||
              pointsToPixels(proposal.bounds.top + proposal.bounds.height) >
                body.height
            ? 'Warning: item extends beyond the body.'
            : 'Preview only — release to apply.',
      );
    }
  }

  @HostListener('window:pointerup', ['$event'])
  finishGesture(event: PointerEvent): void {
    this.moveGesture(event);
    const preview = this.preview();
    if (!preview || event.pointerId !== preview.pointerId) return;
    this.preview.set(null);
    this.releaseCapture(preview);
    if (!preview.active) return;
    if (!preview.valid || preview.version !== this.host.snapshot()?.version) {
      this.gestureNotice.set('Invalid preview cancelled; document unchanged.');
      return;
    }
    const payload: LayoutIntent['payload'] =
      preview.handle === 'move'
        ? {
            action: 'move',
            targetIds: [preview.id],
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
    const preview = this.preview();
    if (!preview) return;
    this.preview.set(null);
    this.releaseCapture(preview);
    this.gestureNotice.set(reason);
  }

  private releaseCapture(
    preview: NonNullable<ReturnType<typeof this.preview>>,
  ): void {
    if (preview.element.hasPointerCapture(preview.pointerId))
      preview.element.releasePointerCapture(preview.pointerId);
  }

  @HostListener('window:pointercancel', ['$event'])
  @HostListener('window:lostpointercapture', ['$event'])
  captureLost(event: PointerEvent): void {
    if (event.pointerId === this.preview()?.pointerId) this.cancelGesture();
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
    if (
      event.key === 'Escape' ||
      ((event.ctrlKey || event.metaKey) &&
        ['z', 'y'].includes(event.key.toLowerCase()))
    )
      this.cancelGesture();
  }

  previewPixels(): Bounds | null {
    const preview = this.preview();
    if (!preview?.active) return null;
    return {
      left: pointsToPixels(preview.bounds.left),
      top: pointsToPixels(preview.bounds.top),
      width: pointsToPixels(preview.bounds.width),
      height: pointsToPixels(preview.bounds.height),
    };
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
