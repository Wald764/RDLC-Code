import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  HostListener,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  resizeHandles,
  alignModes,
  type AuthoringRequest,
  type EditIntent,
  type LayoutIntent,
} from '@rdlc/report-model/editing';
import {
  pixelsToPoints,
  pointsToPixels,
  sizeUnits,
  toPoints,
  type SizeUnit,
} from '@rdlc/report-model/geometry';
import type { Bounds, DesignSceneItem } from '@rdlc/report-model/scene';
import { directProposal, type DirectHandle } from './manipulation';
import { snapDelta, type Guide } from './placement';
import {
  anchoredScroll,
  centerScroll,
  rulerTicks,
  clampZoom,
  clientToBody,
  edgeScroll,
  extent,
  fitZoom,
  revealScroll,
  type Frame,
  type ViewState,
} from './viewport';
import { AuthoringComponent } from '../authoring/authoring.component';
import {
  ComponentsCatalogComponent,
  type CreationKind,
} from './components-catalog.component';
import { ContextualInspectorComponent } from './contextual-inspector.component';
import { StructureTreeComponent } from './structure-tree.component';
import type { DesignScene } from '@rdlc/report-model/scene';
import { DiagnosticsComponent } from '../diagnostics/diagnostics.component';
import type { TextboxCommit } from '../properties/textbox-properties.component';
import { HostAdapter } from './host-adapter';
import {
  emptySelection,
  selectItem,
  selectAll,
  marqueeSelection,
  mapSelection,
  reconcileSelection,
  reconcileStructureSelection,
  selectStructure,
  hitTest,
  type Selection,
} from './selection';

type DraftControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Origins = readonly { id: string; bounds: Bounds }[];
const arrows: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const ptBounds = (b: Bounds): Bounds => ({
  left: pixelsToPoints(b.left),
  top: pixelsToPoints(b.top),
  width: pixelsToPoints(b.width),
  height: pixelsToPoints(b.height),
});
const pxBounds = (b: Bounds): Bounds => ({
  left: pointsToPixels(b.left),
  top: pointsToPixels(b.top),
  width: pointsToPixels(b.width),
  height: pointsToPixels(b.height),
});
const union = (all: readonly Bounds[]): Bounds => {
  const left = Math.min(...all.map((b) => b.left)),
    top = Math.min(...all.map((b) => b.top));
  return {
    left,
    top,
    width: Math.max(...all.map((b) => b.left + b.width)) - left,
    height: Math.max(...all.map((b) => b.top + b.height)) - top,
  };
};
const leftTabs = ['components', 'structure'] as const;
/** Wrapping roving-focus target for a key, or null when the key does not move focus. */
const rovingIndex = (
  key: string,
  index: number,
  length: number,
  previous: string,
  next: string,
): number | null =>
  key === 'Home'
    ? 0
    : key === 'End'
      ? length - 1
      : key === next
        ? (index + 1) % length
        : key === previous
          ? (index - 1 + length) % length
          : null;

@Component({
  selector: 'rdlc-editor',
  standalone: true,
  imports: [
    DiagnosticsComponent,
    ContextualInspectorComponent,
    AuthoringComponent,
    ComponentsCatalogComponent,
    StructureTreeComponent,
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
  readonly leftTabs = leftTabs;
  readonly units = sizeUnits;
  readonly toggles = [
    ['gridVisible', 'Show grid'],
    ['gridSnap', 'Snap to grid'],
    ['guidesVisible', 'Show guides'],
    ['guidesSnap', 'Snap to guides'],
  ] as const;
  readonly toPx = pointsToPixels;
  private readonly injector = inject(Injector);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  /** Per-view zoom, scroll, units and placement preferences. */
  readonly view = signal<ViewState>(this.host.restoredView.state);
  readonly guides = signal<readonly Guide[]>([]);
  /** Arrow-key repeats accumulated from the accepted geometry until keyup. */
  readonly nudge = signal<{
    version: number;
    origins: Origins;
    dx: number;
    dy: number;
  } | null>(null);
  private pan: {
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null = null;
  private space = false;
  private panned = false;
  readonly extent = computed(() => {
    const scene = this.scene();
    return scene ? extent(scene.page, scene.body, scene.items) : null;
  });
  readonly gridPt = computed(
    () => this.view().gridSpacing * toPoints(`1${this.view().gridUnit}`)!,
  );
  readonly preview = signal<{
    version: number;
    id: string;
    origins: Origins;
    pointerId: number;
    element: HTMLElement;
    handle: DirectHandle;
    origin: Bounds;
    /** Pointer start in client pixels, for the click threshold. */
    clientX: number;
    clientY: number;
    /** Body-relative report anchor in unzoomed pixels, independent of later zoom/scroll. */
    anchorX: number;
    anchorY: number;
    dx: number;
    dy: number;
    active: boolean;
    bounds: Bounds;
    valid: boolean;
  } | null>(null);
  readonly gestureNotice = signal('');
  readonly workspaceWidth = signal(1280);
  readonly overlay = signal<'left' | 'right' | null>(null);
  readonly creation = signal<CreationKind | null>(null);
  readonly leftTab = signal<'components' | 'structure'>('components');
  readonly diagnosticsOpen = signal(false);
  private diagnosticsInvoker: HTMLElement | null = null;
  readonly contextMenu = signal<{
    x: number;
    y: number;
    invoker: HTMLElement | null;
  } | null>(null);
  readonly contextActions = computed(() => {
    const selection = this.acceptedSelection();
    const count = selection.bodyItemIds.length;
    const selected = this.selected();
    const busy =
      this.status() === 'editable' && !this.host.pending()
        ? ''
        : 'Report is unavailable or busy.';
    const clipboardReason = !count
      ? 'Select whole body items; cells and data have no item clipboard.'
      : busy ||
        (this.scene()?.items.some(
          (item) => selection.bodyItemIds.includes(item.id) && item.placeholder,
        )
          ? 'Preservation-only members cannot be copied or deleted; use Code XML.'
          : '');
    return [
      ...(['copy', 'cut', 'paste', 'duplicate'] as const).map((action) => ({
        label: action[0]!.toUpperCase() + action.slice(1),
        reason: action === 'paste' ? busy : clipboardReason,
        run: () => this.clipboard(action),
      })),
      ...alignModes.map((mode) => ({
        label: `Align ${mode}`,
        reason:
          busy ||
          (count < 2
            ? 'Select at least two body items.'
            : this.bulkReason(
                ['left', 'center', 'right'].includes(mode)
                  ? 'horizontal'
                  : 'vertical',
              )),
        run: () => this.arrange('align', mode),
      })),
      ...(['horizontal', 'vertical'] as const).map((axis) => ({
        label: `Distribute ${axis}`,
        reason:
          busy ||
          (count < 3
            ? 'Select at least three body items.'
            : this.bulkReason(axis)),
        run: () => this.arrange('distribute', axis),
      })),
      {
        label: 'Reveal selection',
        reason: this.treeSelectedIds().length ? '' : 'Select a target first.',
        run: () => this.revealSelection(),
      },
      { label: 'Properties', reason: '', run: () => this.focusProperties() },
      ...(selected && selected.kind !== 'cell' && !selected.placeholder
        ? [
            {
              label: 'Delete… (confirm contained content)',
              reason: busy,
              run: () => {
                this.gestureNotice.set(
                  'Confirm deletion of contained XML in Properties. Reference and preservation guards still apply.',
                );
                this.focusProperties(
                  '.inspector input[type=checkbox][required]',
                );
              },
            },
          ]
        : []),
      { label: 'Code XML', reason: '', run: () => this.openSource() },
    ];
  });
  private creating: {
    requestId: string;
    kind: CreationKind;
    name: string;
    baseVersion: number;
  } | null = null;
  private layoutFrame: Frame | null = null;
  private workspaceHeight = 0;
  private deferredLayout: (() => void) | null = null;
  private overlayInvoker: HTMLElement | null = null;
  readonly rulerX = computed(() =>
    rulerTicks(
      this.workspaceWidth(),
      this.view().zoom,
      this.view().scrollLeft,
      this.view().unit,
    ),
  );
  readonly rulerY = computed(() =>
    rulerTicks(1600, this.view().zoom, this.view().scrollTop, this.view().unit),
  );
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
  /** A form edit not yet submitted; tracked on input, before blur/change. */
  readonly draft = signal<{ version: number; control: DraftControl } | null>(
    null,
  );
  /** A new action held back until the author applies, discards or cancels. */
  readonly conflict = signal<{ run: () => void } | null>(null);
  private revealed: string | null = null;
  private readonly originals = new WeakMap<DraftControl, string>();
  private pointerGuard = false;
  private submitted: EventTarget | null = null;
  private focusedControl: HTMLElement | null = null;
  private refusedForm: { requestId: string; form: HTMLFormElement } | null =
    null;
  private readonly reconciled = computed(() => {
    const selection = this.selection();
    const snapshot = this.host.snapshot();
    const version = snapshot?.version;
    if (selection.version === version) return { selection, lost: false };
    const result = this.host.outcome();
    if (
      result?.accepted &&
      !result.history &&
      result.baseVersion === selection.version &&
      result.version === version
    ) {
      // Pasted or duplicated copies replace the selection.
      if (result.inserted?.length)
        return {
          selection: {
            ...emptySelection(version),
            bodyItemIds: result.inserted,
            primaryId: result.inserted.at(-1)!,
          },
          lost: false,
        };
      return {
        selection: mapSelection(selection, version!, result.mappings),
        lost: false,
      };
    }
    const empty = { selection: emptySelection(version ?? 0), lost: false };
    const previous = this.host.previousScene();
    if (selection.structureTargetId && !this.host.pending() && snapshot) {
      const next = reconcileStructureSelection(
        selection,
        this.host.previousStructure()?.nodes ?? [],
        snapshot.structure?.nodes ?? [],
        snapshot.version,
      );
      return next ? { selection: next, lost: false } : { ...empty, lost: true };
    }
    // Own pending results resolve through their mapping; never guess by name meanwhile.
    if (
      this.host.pending() ||
      !snapshot?.scene ||
      previous?.version !== selection.version ||
      (!selection.bodyItemIds.length && selection.cellTargetId === null)
    )
      return empty;
    const next = reconcileSelection(selection, previous, snapshot.scene);
    return next ? { selection: next, lost: false } : { ...empty, lost: true };
  });
  readonly acceptedSelection = computed(() => this.reconciled().selection);
  readonly selectionLost = computed(() => this.reconciled().lost);
  readonly selectedIds = computed(() => this.acceptedSelection().bodyItemIds);
  readonly selectedDataset = computed(
    () =>
      this.host
        .snapshot()
        ?.authoring?.datasets.find(
          (dataset) =>
            dataset.id === this.acceptedSelection().structureTargetId ||
            dataset.fields.some(
              (field) =>
                field.id === this.acceptedSelection().structureTargetId,
            ),
        ) ?? null,
  );
  readonly structureNode = computed(
    () =>
      this.host
        .snapshot()
        ?.structure?.nodes.find(
          (node) => node.id === this.acceptedSelection().structureTargetId,
        ) ?? null,
  );
  readonly treeSelectedIds = computed(() => {
    const selection = this.acceptedSelection();
    return selection.structureTargetId
      ? [selection.structureTargetId]
      : selection.cellTargetId
        ? [selection.cellTargetId]
        : selection.bodyItemIds;
  });
  readonly treeEditableIds = computed(() => {
    if (this.status() !== 'editable') return [];
    const definitions = this.host.snapshot()?.authoring?.datasets ?? [];
    return [
      ...(this.scene()
        ?.items.filter(
          (item) =>
            !item.placeholder &&
            ((item.capabilities?.some((capability) => capability !== 'name') ??
              false) ||
              Object.values(item.operations ?? {}).some(
                (operation) => operation.eligible,
              )),
        )
        .map((item) => item.id) ?? []),
      ...definitions.flatMap((dataset) => [
        dataset.id,
        ...dataset.fields
          .filter((field) => field.type !== null)
          .map((field) => field.id),
      ]),
    ];
  });
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
  /** Why the selected item cannot be edited on the canvas, if it cannot. */
  readonly limitations = computed(() => {
    const item = this.selected();
    if (!item) return null;
    const reasons = new Set(
      Object.values(item.operations ?? {})
        .map((operation) => operation.reason)
        .filter((reason): reason is string => !!reason),
    );
    if (item.placeholder)
      reasons.add('Preservation-only: the designer offers no mutation.');
    if (!item.bounds)
      reasons.add('Bounds are unknown; no canvas area is shown.');
    return reasons.size ? [...reasons] : null;
  });
  readonly diagnostics = computed(() => [
    ...(this.host.snapshot()?.diagnostics ?? []),
    ...(this.host.outcome()?.diagnostics ?? []),
  ]);
  readonly diagnosticSummary = computed(() => {
    const diagnostics = this.diagnostics();
    const severity = diagnostics.some((item) => item.severity === 'error')
      ? 'error'
      : diagnostics.some((item) => item.severity === 'warning')
        ? 'warning'
        : 'information';
    return `${diagnostics.length} diagnostics${diagnostics.length ? ` · ${severity}` : ''}`;
  });

  toggleDiagnostics(): void {
    if (this.diagnosticsOpen()) {
      this.diagnosticsOpen.set(false);
      this.diagnosticsInvoker?.focus({ preventScroll: true });
    } else {
      this.diagnosticsInvoker =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.diagnosticsOpen.set(true);
      afterNextRender(
        () =>
          this.element.nativeElement
            .querySelector<HTMLElement>('.diagnostic-overlay button')
            ?.focus(),
        { injector: this.injector },
      );
    }
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelGesture());
    const root = this.element.nativeElement;
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) this.workspaceResize(rect.width, rect.height);
      });
      observer.observe(root);
      this.layoutFrame = this.frame();
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    // Capture phase: runs before native blur/change and before inner submit handlers.
    root.addEventListener(
      'pointerdown',
      (event) => {
        if (
          this.space &&
          this.viewport()?.nativeElement.contains(event.target as Node)
        )
          this.startPan(event);
        if (
          this.draft() &&
          (event.target as Element | null)?.closest?.('[data-conflicts]')
        )
          this.pointerGuard = true;
      },
      true,
    );
    root.addEventListener(
      'submit',
      (event) => (this.submitted = event.target),
      true,
    );
    root.addEventListener('focusout', (event) => {
      if (
        event.relatedTarget instanceof Node &&
        !root.contains(event.relatedTarget)
      )
        this.focusedControl = null;
    });
    effect(() => {
      const version = this.host.snapshot()?.version;
      const draft = this.draft();
      if (draft && draft.version !== version) {
        this.draft.set(null);
        this.conflict.set(null);
        this.gestureNotice.set(
          'The document changed; your unapplied draft was discarded.',
        );
      }
    });
    if (this.host.restoredView.invalid.length)
      this.gestureNotice.set(
        `Ignored invalid saved view settings (${this.host.restoredView.invalid.join(', ')}); defaults apply.`,
      );
    effect(() => this.host.saveView(this.view()));
    effect(() => {
      const outcome = this.host.outcome();
      const submitted = this.refusedForm;
      if (
        !outcome ||
        outcome.accepted ||
        !submitted ||
        outcome.requestId !== submitted.requestId ||
        !submitted.form.isConnected
      )
        return;
      submitted.form.setAttribute('aria-describedby', 'report-refusal');
      for (const control of submitted.form.querySelectorAll(
        'input, select, textarea',
      )) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', 'report-refusal');
      }
    });
    effect(() => {
      this.scene();
      this.host.snapshot();
      afterNextRender(
        () => {
          this.configureToolbar();
          const previous = this.focusedControl;
          if (
            previous &&
            !previous.isConnected &&
            document.activeElement === document.body
          ) {
            const property = previous.dataset['property'];
            const field = property
              ? root.querySelector<HTMLElement>(
                  `[data-property="${CSS.escape(property)}"]`,
                )
              : null;
            (
              field ??
              this.viewport()?.nativeElement ??
              root.querySelector<HTMLElement>('.empty-state button')
            )?.focus({ preventScroll: true });
          }
        },
        { injector: this.injector },
      );
    });
    effect(() => {
      // Restore the saved scroll whenever the canvas is (re)created.
      if (this.viewport()) {
        const { scrollLeft, scrollTop } = untracked(this.view);
        this.scrollTo(scrollLeft, scrollTop);
      }
    });
    effect(() => {
      const nudge = this.nudge();
      if (nudge && this.host.snapshot()?.version !== nudge.version)
        this.cancelGesture('The document changed; the nudge was cancelled.');
    });
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
      // Reveal inserted copies once their accepted snapshot is shown.
      const outcome = this.host.outcome();
      if (
        outcome?.inserted?.length &&
        outcome.requestId !== this.revealed &&
        this.host.snapshot()?.version === outcome.version
      ) {
        this.revealed = outcome.requestId;
        afterNextRender(() => this.revealSelection(), {
          injector: this.injector,
        });
      }
    });
    effect(() => {
      const outcome = this.host.outcome();
      const snapshot = this.host.snapshot();
      const creation = this.creating;
      if (
        !creation ||
        !outcome ||
        outcome.requestId !== creation.requestId ||
        !snapshot ||
        snapshot.version < outcome.version
      )
        return;
      this.creating = null;
      if (
        !outcome.accepted ||
        !outcome.changed ||
        snapshot.version !== outcome.version
      )
        return;
      this.creation.set(null);
      const matches =
        snapshot.scene?.items.filter(
          (item) => item.name === creation.name && item.kind === creation.kind,
        ) ?? [];
      if (matches.length === 1)
        this.select(snapshot.scene!.items.indexOf(matches[0]!));
      else if (creation.kind === 'dataset') {
        const datasets =
          snapshot.authoring?.datasets.filter(
            (dataset) => dataset.name === creation.name,
          ) ?? [];
        if (datasets.length === 1) {
          this.selection.set({
            ...emptySelection(snapshot.version),
            structureTargetId: datasets[0]!.id,
          });
          this.leftTab.set('structure');
          if (this.workspaceWidth() < 800) this.overlay.set('right');
        }
      }
    });
    effect(() => {
      const accepted = this.acceptedSelection();
      const snapshot = this.host.snapshot();
      const selection = this.selection();
      if (
        (accepted.primaryId !== null ||
          accepted.cellTargetId !== null ||
          !!accepted.structureTargetId) &&
        snapshot &&
        selection?.version !== snapshot.version
      ) {
        this.selection.set(accepted);
      }
    });
  }

  private readonly destroyRef = inject(DestroyRef);

  workspaceResize(width: number, height: number): void {
    if (width === this.workspaceWidth() && height === this.workspaceHeight)
      return;
    this.workspaceHeight = height;
    const before = this.layoutFrame ?? this.frame();
    this.cancelGesture(
      'Workspace resized; the uncommitted gesture was cancelled.',
    );
    this.workspaceWidth.set(width);
    afterNextRender(
      () => {
        const next = this.frame();
        const scroll = centerScroll(before, next);
        const viewport = this.viewport()?.nativeElement;
        if (viewport) {
          viewport.scrollLeft = scroll.scrollLeft;
          viewport.scrollTop = scroll.scrollTop;
          this.onScroll();
        }
        this.layoutFrame = this.frame();
      },
      { injector: this.injector },
    );
  }

  toggleOverlay(panel: 'left' | 'right'): void {
    this.overlayInvoker =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const run = () => this.overlay.set(this.overlay() === panel ? null : panel);
    if (this.preview() || this.marquee() || this.nudge() || this.pan)
      this.deferredLayout = run;
    else run();
  }

  select(index: number, toggle = false): void {
    if (this.host.pending() || this.held(() => this.select(index, toggle)))
      return;
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

  selectTree(target: { id: string; additive: boolean }): void {
    if (this.host.pending() || this.held(() => this.selectTree(target))) return;
    if (
      !this.host
        .snapshot()
        ?.structure?.nodes.some((node) => node.id === target.id)
    )
      return;
    this.cancelGesture();
    this.selection.set(
      selectStructure(
        this.acceptedSelection(),
        target.id,
        this.scene()?.items ?? [],
        target.additive,
        this.host.snapshot()?.structure?.nodes ?? [],
      ),
    );
    this.revealSelection();
  }

  showContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (this.host.pending() || this.held(() => this.showContextMenu(event)))
      return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const item = target?.closest<HTMLElement>('[data-item]');
    if (
      item &&
      !this.isSelected(this.scene()!.items[Number(item.dataset['item'])]!)
    )
      this.select(Number(item.dataset['item']));
    const rect = this.element.nativeElement.getBoundingClientRect();
    this.contextMenu.set({
      x: Math.max(0, Math.min(event.clientX - rect.left, rect.width - 280)),
      y: Math.max(40, Math.min(event.clientY - rect.top, rect.height - 360)),
      invoker:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    });
    afterNextRender(
      () =>
        this.element.nativeElement
          .querySelector<HTMLElement>('[role=menuitem]')
          ?.focus(),
      { injector: this.injector },
    );
  }

  closeContextMenu(): void {
    const invoker = this.contextMenu()?.invoker;
    this.contextMenu.set(null);
    if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    else this.viewport()?.nativeElement.focus({ preventScroll: true });
  }

  runContext(entry: { reason: string; run: () => void }): void {
    if (entry.reason) return;
    this.closeContextMenu();
    entry.run();
  }

  focusProperties(
    selector = '.inspector input, .inspector button, .inspector summary',
  ): void {
    if (this.workspaceWidth() < 800) this.overlay.set('right');
    afterNextRender(
      () =>
        this.element.nativeElement
          .querySelector<HTMLElement>(selector)
          ?.focus(),
      { injector: this.injector },
    );
  }

  menuKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      this.closeContextMenu();
      return;
    }
    const items = [
      ...this.element.nativeElement.querySelectorAll<HTMLElement>(
        '[role=menuitem]',
      ),
    ];
    const next = rovingIndex(
      event.key,
      items.indexOf(document.activeElement as HTMLElement),
      items.length,
      'ArrowUp',
      'ArrowDown',
    );
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  private groupPeers(group: HTMLElement): HTMLElement[] {
    return [
      ...group.querySelectorAll<HTMLElement>('button:not(:disabled), summary'),
    ].filter(
      (control) =>
        control.closest('[role=group], [role=toolbar]') === group &&
        !control.closest('.overflow-content'),
    );
  }

  private toolbarPeers(target: HTMLElement): HTMLElement[] {
    const group = target.closest<HTMLElement>('[role=group], [role=toolbar]');
    return group?.closest('.toolbar') && !target.closest('.overflow-content')
      ? this.groupPeers(group)
      : [];
  }

  private configureToolbar(): void {
    for (const group of this.element.nativeElement.querySelectorAll<HTMLElement>(
      '.toolbar, .toolbar [role=group], .toolbar [role=toolbar]',
    )) {
      const peers = this.groupPeers(group);
      const active = peers.includes(document.activeElement as HTMLElement)
        ? document.activeElement
        : peers[0];
      for (const peer of peers) peer.tabIndex = peer === active ? 0 : -1;
    }
  }

  isSelected(item: DesignSceneItem): boolean {
    return (
      this.selectedIds().includes(item.id) ||
      this.acceptedSelection().cellTargetId === item.id
    );
  }

  selectAll(): void {
    if (this.host.pending() || this.held(() => this.selectAll())) return;
    this.cancelGesture();
    this.selection.set(
      selectAll(this.host.snapshot()?.version ?? 0, this.scene()?.items ?? []),
    );
  }

  clearSelection(): void {
    if (this.host.pending() || this.held(() => this.clearSelection())) return;
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
      this.bulkReason(horizontal ? 'horizontal' : 'vertical') ||
      this.held(() => this.arrange(action, mode))
    )
      return;
    this.cancelGesture();
    const common = { targetIds: ids, unit: this.view().unit };
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

  /** Host-authoritative Copy/Cut/Paste/Duplicate of complete body selections. */
  clipboard(action: 'copy' | 'cut' | 'paste' | 'duplicate'): void {
    const snapshot = this.host.snapshot();
    if (
      !snapshot ||
      snapshot.status !== 'editable' ||
      this.host.pending() ||
      this.held(() => this.clipboard(action))
    )
      return;
    this.cancelGesture();
    const ids = this.selectedIds();
    const common = {
      requestId: crypto.randomUUID(),
      baseVersion: snapshot.version,
    };
    if (action === 'paste') {
      this.host.sendClipboard({ ...common, action, unit: this.view().unit });
      return;
    }
    if (!ids.length) {
      this.gestureNotice.set(
        this.acceptedSelection().cellTargetId
          ? 'Table cells cannot be copied separately; select the whole table.'
          : 'Select one or more body items first.',
      );
      return;
    }
    const items = ids.map((id) => this.scene()?.items.find((i) => i.id === id));
    const locked = items.findIndex((item) => !item || item.placeholder);
    if (locked >= 0) {
      this.gestureNotice.set(
        `${items[locked]?.label ?? ids[locked]} is preservation-only and cannot be copied; inspect it in source.`,
      );
      return;
    }
    this.gestureNotice.set('');
    // An explicit Cut is its own acknowledgement; one native Undo restores it.
    this.host.sendClipboard(
      action === 'copy' || action === 'cut'
        ? { ...common, action, targetIds: ids }
        : { ...common, action, targetIds: ids, unit: this.view().unit },
    );
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
    const { x, y } = this.bodyPoint(event.clientX, event.clientY);
    if (
      hitTest(this.scene()!.items, x, y) ||
      this.held(() => this.clearSelection())
    )
      return;
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
      clientX: event.clientX,
      clientY: event.clientY,
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
    if (this.held(() => this.select(index))) return;
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
    const origin = ptBounds(item.bounds!);
    const origins = this.origins(
      handle === 'move' ? this.selectedIds() : [item.id],
    );
    const anchor = this.bodyPoint(event.clientX, event.clientY);
    this.preview.set({
      version: this.host.snapshot()!.version,
      id: item.id,
      origins,
      pointerId: event.pointerId,
      element,
      handle,
      origin,
      clientX: event.clientX,
      clientY: event.clientY,
      anchorX: anchor.x,
      anchorY: anchor.y,
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
    const pan = this.pan,
      viewport = this.viewport()?.nativeElement;
    if (pan && viewport && event.pointerId === pan.pointerId) {
      viewport.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }
    const marquee = this.marquee();
    if (marquee && event.pointerId === marquee.pointerId) {
      this.autoScroll(event);
      const { x, y } = this.bodyPoint(event.clientX, event.clientY);
      this.marquee.set({
        ...marquee,
        active:
          marquee.active ||
          Math.hypot(
            event.clientX - marquee.clientX,
            event.clientY - marquee.clientY,
          ) >= 3,
        rect: {
          left: Math.min(marquee.x, x),
          top: Math.min(marquee.y, y),
          width: Math.abs(x - marquee.x),
          height: Math.abs(y - marquee.y),
        },
      });
      return;
    }
    const preview = this.preview();
    if (!preview || event.pointerId !== preview.pointerId) return;
    // Scroll first, then recompute the same report anchor under the pointer.
    this.autoScroll(event);
    const point = this.bodyPoint(event.clientX, event.clientY);
    let dx = pixelsToPoints(point.x - preview.anchorX),
      dy = pixelsToPoints(point.y - preview.anchorY);
    const active =
      preview.active ||
      Math.hypot(
        event.clientX - preview.clientX,
        event.clientY - preview.clientY,
      ) >= 3;
    let guides: Guide[] = [];
    if (active && !event.altKey) {
      const snap = this.snap(preview.origins, preview.handle, dx, dy);
      dx += snap.dx;
      dy += snap.dy;
      guides = snap.guides;
    }
    this.guides.set(guides);
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

  // One handler per window event: a second @HostListener for the same event replaces this one.
  @HostListener('window:pointerup', ['$event'])
  finishGesture(event: PointerEvent): void {
    queueMicrotask(() => this.drainLayout());
    this.releaseGuard();
    const pan = this.pan;
    if (pan && event.pointerId === pan.pointerId) {
      this.pan = null;
      const viewport = this.viewport()?.nativeElement;
      if (viewport?.hasPointerCapture?.(pan.pointerId))
        viewport.releasePointerCapture(pan.pointerId);
      return;
    }
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
    this.guides.set([]);
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
            unit: this.view().unit,
            dxPt: preview.dx,
            dyPt: preview.dy,
          }
        : {
            action: 'resize',
            targetIds: [preview.id],
            unit: this.view().unit,
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
    queueMicrotask(() => this.drainLayout());
    this.pan = null;
    this.guides.set([]);
    if (this.nudge()) {
      this.nudge.set(null);
      this.gestureNotice.set(reason);
    }
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

  private drainLayout(): void {
    if (this.preview() || this.marquee() || this.nudge() || this.pan) return;
    const run = this.deferredLayout;
    this.deferredLayout = null;
    run?.();
  }

  @HostListener('window:pointercancel', ['$event'])
  @HostListener('window:lostpointercapture', ['$event'])
  captureLost(event: PointerEvent): void {
    this.releaseGuard();
    if (
      event.pointerId === this.preview()?.pointerId ||
      event.pointerId === this.marquee()?.pointerId ||
      event.pointerId === this.pan?.pointerId
    )
      this.cancelGesture();
  }

  @HostListener('window:blur')
  blur(): void {
    this.space = false;
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
    if (event.defaultPrevented) return;
    const editable =
      event.target instanceof HTMLElement &&
      !!event.target.closest(
        'input, textarea, select, [contenteditable="true"]',
      );
    if (!editable && event.target instanceof HTMLElement) {
      const tab = !!event.target.closest('[role=tab]');
      const controls = tab ? [] : this.toolbarPeers(event.target);
      const next = rovingIndex(
        event.key,
        tab ? leftTabs.indexOf(this.leftTab()) : controls.indexOf(event.target),
        tab ? leftTabs.length : controls.length,
        'ArrowLeft',
        'ArrowRight',
      );
      if ((tab || controls.length) && next !== null) {
        event.preventDefault();
        if (tab) {
          this.leftTab.set(leftTabs[next]!);
          this.element.nativeElement
            .querySelector<HTMLElement>(`#${this.leftTab()}-tab`)
            ?.focus();
        } else controls[next]?.focus();
        return;
      }
    }
    if (event.key === 'Escape') {
      if (this.diagnosticsOpen()) {
        this.toggleDiagnostics();
        return;
      }
      if (this.contextMenu()) {
        this.closeContextMenu();
        return;
      }
      const overflow =
        event.target instanceof Element
          ? event.target.closest<HTMLDetailsElement>('details.command-overflow')
          : null;
      if (overflow?.open) {
        overflow.open = false;
        overflow
          .querySelector<HTMLElement>('summary')
          ?.focus({ preventScroll: true });
        return;
      }
      if (this.overlay()) {
        this.overlay.set(null);
        this.overlayInvoker?.focus({ preventScroll: true });
        return;
      }
      if (this.conflict()) this.cancelConflict();
      else if (this.preview() || this.marquee() || this.nudge())
        this.cancelGesture();
      else if (!editable) this.clearSelection();
      return;
    }
    const canvas =
      !editable &&
      !(
        event.target instanceof Element &&
        event.target.closest('[role=tree], [role=menu], [role=tablist]')
      ) &&
      event.target instanceof Node &&
      !!this.viewport()?.nativeElement.contains(event.target);
    if (
      canvas &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      event.preventDefault();
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      (event.target as HTMLElement).dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 16,
          clientY: rect.top + 16,
        }),
      );
      return;
    }
    if (
      !editable &&
      !event.altKey &&
      (event.ctrlKey || event.metaKey) &&
      ['z', 'y'].includes(event.key.toLowerCase()) &&
      event.target instanceof Node &&
      this.element.nativeElement.contains(event.target)
    ) {
      event.preventDefault();
      this.history(
        event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo',
      );
      return;
    }
    if (canvas && event.key === ' ') {
      this.space = true;
      if (event.target === this.viewport()?.nativeElement)
        event.preventDefault();
      return;
    }
    const arrow = arrows[event.key];
    if (canvas && arrow && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.nudgeBy(arrow[0], arrow[1], event.shiftKey ? 10 : 1);
      return;
    }
    // Ctrl/Cmd+C/X/V arrive as clipboard events (see `clipboardEvent`).
    if (
      this.canvasShortcut(event.target) &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 'd'
    ) {
      event.preventDefault();
      this.clipboard('duplicate');
      return;
    }
    if (
      canvas &&
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

  /**
   * VS Code's Electron webview cancels Ctrl/Cmd+C/X/V keydown and replays them as
   * execCommand, so the clipboard events are the only reliable signal.
   */
  @HostListener('document:copy', ['$event'])
  @HostListener('document:cut', ['$event'])
  @HostListener('document:paste', ['$event'])
  clipboardEvent(event: Event): void {
    if (!this.canvasShortcut(event.target)) return;
    event.preventDefault();
    this.clipboard(event.type as 'copy' | 'cut' | 'paste');
  }

  /** Canvas focus, or focus lost to the body after the scene was re-rendered; never form controls. */
  private canvasShortcut(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return false;
    const document = target.ownerDocument ?? (target as Document);
    return (
      !!this.viewport()?.nativeElement.contains(target) ||
      target === document.body ||
      target === document.documentElement ||
      target === document
    );
  }

  @HostListener('window:keyup', ['$event'])
  keyup(event: KeyboardEvent): void {
    queueMicrotask(() => this.drainLayout());
    if (event.key === ' ') {
      this.space = false;
      // A pan must not also activate the focused item button.
      if (this.panned) event.preventDefault();
      this.panned = false;
      return;
    }
    const nudge = this.nudge();
    if (!nudge || !arrows[event.key]) return;
    this.nudge.set(null);
    if (nudge.version !== this.host.snapshot()?.version) return;
    if (!nudge.dx && !nudge.dy) return;
    if (
      !nudge.origins.every(
        (o) => directProposal(o.bounds, 'move', nudge.dx, nudge.dy).valid,
      )
    ) {
      this.gestureNotice.set(
        'Invalid nudge cancelled: positions must be nonnegative; document unchanged.',
      );
      return;
    }
    this.gestureNotice.set('');
    this.host.sendEdit({
      requestId: crypto.randomUUID(),
      baseVersion: nudge.version,
      operation: 'layout',
      payload: {
        action: 'move',
        targetIds: nudge.origins.map((o) => o.id),
        unit: this.view().unit,
        dxPt: nudge.dx,
        dyPt: nudge.dy,
      },
    });
  }

  /** Exact 1pt/10pt steps from the accepted origins; snapping never applies. */
  private nudgeBy(x: number, y: number, step: number): void {
    const snapshot = this.host.snapshot();
    if (!snapshot || this.host.pending() || this.preview() || this.marquee())
      return;
    let nudge = this.nudge();
    if (!nudge) {
      const ids = this.selectedIds();
      if (!ids.length || this.held(() => {})) return;
      nudge = {
        version: snapshot.version,
        origins: this.origins(ids),
        dx: 0,
        dy: 0,
      };
    }
    const reason = this.bulkReason(x ? 'horizontal' : 'vertical');
    if (reason) {
      this.gestureNotice.set(reason);
      return;
    }
    const next = { ...nudge, dx: nudge.dx + x * step, dy: nudge.dy + y * step };
    this.nudge.set(next);
    this.gestureNotice.set(
      `Nudge preview ${next.dx}pt, ${next.dy}pt — release the key to apply.`,
    );
  }

  /** Accepted body-relative point bounds of the given items. */
  private origins(ids: readonly string[]): Origins {
    return ids.map((id) => ({
      id,
      bounds: ptBounds(this.scene()!.items.find((i) => i.id === id)!.bounds!),
    }));
  }

  /** Grid/guide adjustment for the moving union or dragged edge. */
  private snap(
    origins: Origins,
    handle: DirectHandle,
    dx: number,
    dy: number,
  ): ReturnType<typeof snapDelta> {
    const view = this.view(),
      scene = this.scene()!;
    if (!view.gridSnap && !view.guidesSnap && !view.guidesVisible)
      return { dx: 0, dy: 0, guides: [] };
    const selected = new Set(origins.map((o) => o.id));
    const moving = union(
      origins.map((o) => directProposal(o.bounds, handle, dx, dy).bounds),
    );
    return snapDelta(moving, handle, {
      scale: pointsToPixels(view.zoom),
      body: ptBounds(scene.body),
      targets: scene.items.flatMap((item, index) =>
        item.bounds && item.kind !== 'cell' && !selected.has(item.id)
          ? [
              {
                id: item.id,
                label: item.label,
                order: item.sourceOrder ?? index,
                bounds: ptBounds(item.bounds),
              },
            ]
          : [],
      ),
      grid: view.gridSnap ? this.gridPt() : null,
      guides: view.guidesSnap,
    });
  }

  groupPreviewPixels(): readonly { bounds: Bounds; valid: boolean }[] {
    const preview = this.preview(),
      nudge = this.nudge();
    if (nudge)
      return nudge.origins.map((o) => {
        const p = directProposal(o.bounds, 'move', nudge.dx, nudge.dy);
        return { bounds: pxBounds(p.bounds), valid: p.valid };
      });
    if (!preview?.active) return [];
    return preview.origins.map((o) => ({
      bounds: pxBounds(
        directProposal(o.bounds, preview.handle, preview.dx, preview.dy).bounds,
      ),
      valid: preview.valid,
    }));
  }

  setToggle(key: (typeof this.toggles)[number][0], on: boolean): void {
    this.setView({ [key]: on });
  }

  setView(patch: Partial<ViewState>): void {
    this.view.update((view) => ({ ...view, ...patch }));
  }

  private frame(): Frame {
    const element = this.viewport()?.nativeElement;
    if (!element)
      return {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        scrollLeft: 0,
        scrollTop: 0,
      };
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left + element.clientLeft,
      top: rect.top + element.clientTop,
      width: element.clientWidth,
      height: element.clientHeight,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    };
  }

  /** Body-relative unzoomed CSS pixels under a client point. */
  private bodyPoint(x: number, y: number): { x: number; y: number } {
    return clientToBody(
      x,
      y,
      this.frame(),
      this.view().zoom,
      this.scene()!.body,
    );
  }

  private autoScroll(event: PointerEvent): void {
    const viewport = this.viewport()?.nativeElement;
    const { dx, dy } = edgeScroll(event.clientX, event.clientY, this.frame());
    // ponytail: scrolls per pointermove only; add a timer if authors need scrolling while the pointer rests.
    if (viewport && (dx || dy)) {
      viewport.scrollLeft += dx;
      viewport.scrollTop += dy;
    }
  }

  private startPan(event: PointerEvent): void {
    const viewport = this.viewport()!.nativeElement;
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // Panning still follows window pointer events.
    }
    this.pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    this.panned = true;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Applies scroll after the resized extent renders; keeps the view state in step. */
  private scrollTo(scrollLeft: number, scrollTop: number): void {
    this.setView({ scrollLeft, scrollTop });
    afterNextRender(
      () => {
        const viewport = this.viewport()?.nativeElement;
        if (!viewport) return;
        viewport.scrollLeft = scrollLeft;
        viewport.scrollTop = scrollTop;
        this.onScroll();
        this.layoutFrame = this.frame();
      },
      { injector: this.injector },
    );
  }

  onScroll(): void {
    this.layoutFrame = this.frame();
    const viewport = this.viewport()?.nativeElement;
    if (viewport)
      this.setView({
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      });
  }

  zoomTo(next: number, x?: number, y?: number): void {
    const frame = this.frame(),
      zoom = clampZoom(next);
    const scroll = anchoredScroll(
      frame,
      this.view().zoom,
      zoom,
      x ?? frame.left + frame.width / 2,
      y ?? frame.top + frame.height / 2,
    );
    this.setView({ zoom });
    this.scrollTo(scroll.scrollLeft, scroll.scrollTop);
  }

  zoomStep(direction: 1 | -1): void {
    this.zoomTo(this.view().zoom * 1.25 ** direction);
  }

  zoomPercent(value: string): void {
    const percent = Number(value);
    if (!value.trim() || !Number.isFinite(percent) || percent <= 0) {
      this.gestureNotice.set(
        'Zoom must be a number from 25 to 400 percent; zoom unchanged.',
      );
      return;
    }
    this.zoomTo(percent / 100);
  }

  /** Pointer zoom (Ctrl/Cmd+wheel) keeps the report point under the pointer. */
  wheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomTo(
      this.view().zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
      event.clientX,
      event.clientY,
    );
  }

  fit(target: 'page' | 'body'): void {
    const scene = this.scene();
    if (!scene) return;
    const bounds =
      target === 'page'
        ? {
            left: 0,
            top: 0,
            width: scene.page.width,
            height: scene.page.height,
          }
        : scene.body;
    const zoom = fitZoom(bounds, this.frame());
    this.setView({ zoom });
    this.scrollTo(
      Math.max(0, bounds.left * zoom - 16),
      Math.max(0, bounds.top * zoom - 16),
    );
  }

  revealSelection(): void {
    const scene = this.scene();
    const selection = this.acceptedSelection();
    const ids = selection.cellTargetId
      ? [selection.cellTargetId]
      : selection.bodyItemIds;
    const known = (scene?.items ?? [])
      .filter((i) => ids.includes(i.id) && i.bounds)
      .map((i) => i.bounds!);
    if (!scene || !known.length) {
      this.gestureNotice.set('Select an item with known bounds to reveal it.');
      return;
    }
    const target = union(known);
    const scroll = revealScroll(
      {
        ...target,
        left: scene.body.left + target.left,
        top: scene.body.top + target.top,
      },
      this.frame(),
      this.view().zoom,
    );
    this.scrollTo(scroll.scrollLeft, scroll.scrollTop);
  }

  gridInput(value: string, unit: string): void {
    const spacing = Number(value);
    if (
      !value.trim() ||
      !Number.isFinite(spacing) ||
      spacing <= 0 ||
      !sizeUnits.includes(unit as SizeUnit)
    ) {
      const { gridSpacing, gridUnit } = this.view();
      this.gestureNotice.set(
        `Grid spacing must be a positive finite number in pt, pc, in, mm or cm; ${gridSpacing}${gridUnit} remains active.`,
      );
      return;
    }
    this.setView({ gridSpacing: spacing, gridUnit: unit as SizeUnit });
  }

  /** Accepted geometry in the chosen display unit. */
  inUnit(pixels: number): string {
    const unit = this.view().unit;
    return `${+(pixelsToPoints(pixels) / toPoints(`1${unit}`)!).toFixed(4)}${unit}`;
  }

  openSource(targetId?: string): void {
    if (this.held(() => this.openSource(targetId))) return;
    this.host.openSource(
      targetId ??
        this.selected()?.id ??
        this.acceptedSelection().structureTargetId ??
        undefined,
    );
  }

  history(action: 'undo' | 'redo'): void {
    if (this.host.pending() || this.held(() => this.history(action))) return;
    this.cancelGesture();
    this.host.sendHistory(crypto.randomUUID(), action);
  }

  openCreation(kind: CreationKind | null): void {
    if (this.host.pending() || this.held(() => this.openCreation(kind))) return;
    this.creation.set(kind);
    this.leftTab.set('components');
    if (this.workspaceWidth() < 1100) this.overlay.set('left');
  }

  pageSetup(): void {
    if (this.held(() => this.pageSetup())) return;
    if (this.workspaceWidth() < 800) this.overlay.set('right');
    const details =
      this.element.nativeElement.querySelector<HTMLDetailsElement>(
        '[data-page-setup]',
      );
    if (details) {
      details.open = true;
      details
        .querySelector<HTMLElement>('summary')
        ?.focus({ preventScroll: true });
    }
  }

  @HostListener('focusin', ['$event'])
  rememberOriginal(event: FocusEvent): void {
    if (event.target instanceof HTMLElement) {
      this.focusedControl = event.target;
      const peers = this.toolbarPeers(event.target);
      if (peers.includes(event.target))
        for (const peer of peers)
          peer.tabIndex = peer === event.target ? 0 : -1;
    }
    const control = this.draftControl(event.target);
    if (control && !this.originals.has(control))
      this.originals.set(control, control.value);
  }

  @HostListener('input', ['$event'])
  trackDraft(event: Event): void {
    const control = this.draftControl(event.target);
    const version = this.host.snapshot()?.version;
    if (control && version !== undefined) this.draft.set({ version, control });
  }

  /** Called from the pointer end handlers, which own those window events. */
  private releaseGuard(): void {
    // Release after the click that follows pointerup has been dispatched.
    setTimeout(() => (this.pointerGuard = false));
  }

  private draftControl(target: EventTarget | null): DraftControl | null {
    return (target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement) &&
      target.form &&
      !target.disabled
      ? target
      : null;
  }

  /** Holds `run` behind an explicit draft decision; returns true when held. */
  private held(run: () => void, form: EventTarget | null = null): boolean {
    const draft = this.draft();
    if (!draft || (form !== null && draft.control.form === form)) return false;
    this.cancelGesture();
    this.conflict.set({ run });
    this.element.nativeElement
      .querySelector<HTMLElement>('[data-draft-apply]')
      ?.focus();
    return true;
  }

  applyDraft(): void {
    const draft = this.draft();
    if (!draft || this.host.pending()) return;
    this.conflict.set(null);
    const property = draft.control.dataset['property'];
    if (property)
      this.sendCommit({
        property: property as TextboxCommit['property'],
        value: draft.control.value,
      });
    else draft.control.form?.requestSubmit();
    this.element.nativeElement.querySelector<HTMLElement>('.feedback')?.focus();
  }

  discardDraft(): void {
    const draft = this.draft();
    if (!draft) return;
    draft.control.value =
      this.originals.get(draft.control) ??
      (draft.control as HTMLInputElement).defaultValue ??
      '';
    this.originals.delete(draft.control);
    this.draft.set(null);
    const conflict = this.conflict();
    this.conflict.set(null);
    this.element.nativeElement.querySelector<HTMLElement>('.feedback')?.focus();
    conflict?.run();
  }

  cancelConflict(): void {
    this.conflict.set(null);
    this.draft()?.control.focus();
  }

  author(request: AuthoringRequest): void {
    const form = this.submitted;
    this.submitted = null;
    const submitted = form instanceof HTMLFormElement ? form : null;
    if (this.held(() => this.sendAuthor(request, submitted), form)) return;
    this.sendAuthor(request, submitted);
  }

  private sendAuthor(
    request: AuthoringRequest,
    form: HTMLFormElement | null = null,
  ): void {
    this.cancelGesture();
    const snapshot = this.host.snapshot();
    if (!snapshot || snapshot.status !== 'editable') return;
    const requestId = crypto.randomUUID();
    this.refusedForm = form ? { requestId, form } : null;
    if (form)
      for (const control of form.querySelectorAll('[aria-invalid]'))
        control.removeAttribute('aria-invalid');
    const accepted = this.host.sendEdit({
      requestId,
      baseVersion: snapshot.version,
      operation: 'author',
      ...request,
    });
    if (
      accepted &&
      ['createTextbox', 'createTable', 'createDataset'].includes(
        request.payload.action,
      )
    ) {
      const payload = request.payload as { name: string };
      this.creating = {
        requestId,
        baseVersion: snapshot.version,
        name: payload.name,
        kind:
          request.payload.action === 'createTextbox'
            ? 'textbox'
            : request.payload.action === 'createTable'
              ? 'table'
              : 'dataset',
      };
    }
    this.draft.set(null);
  }

  bindField(name: string): void {
    const form = this.submitted;
    this.submitted = null;
    const edit = { property: 'text' as const, value: `=Fields!${name}.Value` };
    if (this.held(() => this.sendCommit(edit), form)) return;
    this.sendCommit(edit);
  }

  /** Property-field commit (Enter/change); never while a draft decision or pointer action is pending. */
  commit(edit: TextboxCommit): void {
    if (this.conflict() || this.pointerGuard) return;
    this.sendCommit(edit);
  }

  /** Typed intent only; the host validates, patches, reparses and applies. */
  private sendCommit(edit: TextboxCommit): void {
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
    if (this.host.sendEdit(intent)) this.draft.set(null);
  }
}
