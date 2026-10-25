import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  validateMessage,
  type AcceptedSelectionMessage,
  type AcceptedNavigation,
  type ActionOutcomeMessage,
  type ActionStatus,
  type AuthoringState,
  type ClipboardRequestMessage,
  type NavigationSelection,
  type NativeActionMessage,
  type NavigationProjection,
  type ReportStructure,
  type ViewIdentity,
} from '@rdlc/report-model/protocol';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { EditIntent, TargetMapping } from '@rdlc/report-model/editing';
import type { DesignScene } from '@rdlc/report-model/scene';
import type { Selection } from './selection';
import { restoreViewState, type ViewState } from './viewport';

export interface EditorSnapshot {
  readonly version: number;
  readonly status: 'editable' | 'source-only' | 'invalid-source';
  readonly capabilities: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly scene: DesignScene | null;
  readonly structure?: ReportStructure;
  readonly navigation?: AcceptedNavigation;
  readonly authoring?: AuthoringState | null;
  readonly viewBinding?: ViewIdentity;
}
/** Plain wording for host refusal codes that carry no diagnostic. */
const hostReasons: Readonly<Record<string, string>> = {
  STALE_EDIT: 'The report changed before the edit could be applied.',
  DOCUMENT_CHANGED_DURING_APPLY:
    'The report changed while the edit was being applied.',
  DOCUMENT_READ_ONLY: 'This report is read-only.',
  HOST_EDIT_FAILED: 'VS Code could not apply the edit.',
  REJECTED_BY_HOST: 'VS Code rejected the edit.',
};

/** One readable sentence for a refused outcome; the code stays available separately. */
export function explainRefusal(outcome: {
  readonly reason: string;
  readonly diagnostics: readonly { readonly message: string }[];
}): string {
  return (
    outcome.diagnostics[0]?.message ??
    hostReasons[outcome.reason] ??
    outcome.reason
  );
}

export interface EditOutcome {
  readonly history?: boolean;
  readonly baseVersion: number;
  readonly version: number;
  readonly changed: boolean;
  readonly mappings: readonly TargetMapping[];
  readonly requestId: string;
  readonly accepted: boolean;
  readonly reason: string;
  readonly diagnostics: readonly Diagnostic[];
  /** Result-version IDs of roots inserted by Paste/Duplicate. */
  readonly inserted?: readonly string[];
  /** The item an accepted creation produced, named by the host. */
  readonly created?: { readonly id: string; readonly name: string };
}
export type ClipboardRequest = Omit<
  ClipboardRequestMessage,
  'protocol' | 'kind'
>;

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
}

/**
 * The only transport between the Angular surface and the extension host. The host
 * owns the document; this adapter sends intents and applies accepted snapshots.
 */
@Injectable({ providedIn: 'root' })
export class HostAdapter {
  readonly snapshot = signal<EditorSnapshot | null>(null);
  readonly outcome = signal<EditOutcome | null>(null);
  /** The scene replaced by the latest snapshot, for structural selection reconciliation only. */
  readonly previousScene = signal<DesignScene | null>(null);
  readonly previousStructure = signal<ReportStructure | null>(null);
  /** The Data projection replaced by the latest snapshot, for data-target reconciliation. */
  readonly previousData = signal<NavigationProjection | null>(null);
  readonly sent = signal<readonly unknown[]>([]);
  readonly notice = signal('');
  readonly pending = signal<{
    readonly requestId: string;
    readonly baseVersion: number;
    readonly result?: EditOutcome;
  } | null>(null);
  /** One captured native action at a time; it is never replayed on a newer version. */
  readonly nativeAction = signal<NativeActionMessage | null>(null);
  readonly nativeOutcome = signal<ActionOutcomeMessage | null>(null);
  private readonly nativeRequests = new Set<string>();
  readonly publishedSelection = signal<AcceptedSelectionMessage | null>(null);
  private view: {
    readonly viewId: string;
    readonly documentLifetimeId: string;
    readonly contextGeneration: number;
  } | null = null;
  private nativePending: {
    readonly message: NativeActionMessage;
    outcome?: ActionOutcomeMessage;
  } | null = null;
  /** Edit/clipboard request IDs generated for a captured native action. */
  private readonly nativeEdits = new Map<string, string>();
  private selectionSequence = 0;
  private lastSelection: NavigationSelection | null = null;
  private blocked = false;
  private readonly api: VsCodeApi | null;
  get connected(): boolean {
    return this.api !== null;
  }
  /** Validated per-view preferences from the webview state API; never sent to the host. */
  readonly restoredView: ReturnType<typeof restoreViewState>;

  constructor() {
    const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeApi })
      .acquireVsCodeApi;
    this.api = typeof acquire === 'function' ? acquire() : null;
    this.restoredView = restoreViewState(
      (this.api?.getState?.() as { view?: unknown } | undefined)?.view,
    );
    const listener = (event: MessageEvent) => this.ingest(event.data);
    globalThis.addEventListener('message', listener);
    inject(DestroyRef).onDestroy(() =>
      globalThis.removeEventListener('message', listener),
    );
    if (this.api) this.post({ protocol: 2, kind: 'ready' });
  }

  ingest(input: unknown): void {
    const message = validateMessage(input);
    if (!message) {
      if (
        input &&
        typeof input === 'object' &&
        (input as { kind?: unknown }).kind === 'snapshot'
      ) {
        // Invalid metadata grants no authority; retain validated report/source access only.
        const safe = { ...input } as Record<string, unknown>;
        delete safe['structure'];
        if (validateMessage(safe)) {
          this.ingest(safe);
          this.notice.set(
            'Structure is unavailable. Open Code XML to inspect the report.',
          );
        }
      }
      return;
    }
    if (message.kind === 'nativeAction') {
      if (this.nativeRequests.has(message.requestId)) return;
      if (this.nativeRequests.size >= 1024) {
        this.refuseIngested(
          message,
          'The native request budget is exhausted; reopen this designer before continuing.',
        );
        return;
      }
      if (this.nativePending) {
        if (this.nativePending.message.requestId !== message.requestId)
          this.refuseIngested(
            message,
            'Another native action is already pending in this designer.',
          );
        return;
      }
      const reason = this.nativeRefusal(message);
      if (reason) {
        this.refuseIngested(message, reason);
        return;
      }
      this.nativeRequests.add(message.requestId);
      this.nativePending = { message };
      this.nativeAction.set(message);
      return;
    }
    if (message.kind === 'snapshot') {
      const previous = this.snapshot();
      if (previous && message.version < previous.version) return;
      this.blocked = false;
      if (message.viewBinding) this.applyViewBinding(message.viewBinding);
      if (previous && message.version === previous.version) return;
      if (previous && !this.pending()) {
        this.notice.set(
          'The document changed. Obsolete drafts were cancelled; select an item and start a new edit.',
        );
        this.outcome.set(null);
      }
      this.previousScene.set(previous?.scene ?? null);
      this.previousStructure.set(previous?.structure ?? null);
      this.previousData.set(previous?.navigation?.data ?? null);
      this.snapshot.set({
        version: message.version,
        status: message.projection.status,
        capabilities: message.projection.capabilities,
        diagnostics: message.projection.diagnostics,
        scene: message.scene,
        authoring: message.authoring ?? null,
        ...(message.structure ? { structure: message.structure } : {}),
        ...(message.navigation ? { navigation: message.navigation } : {}),
        ...(message.viewBinding ? { viewBinding: message.viewBinding } : {}),
      });
      if (!message.structure)
        this.notice.update((text) =>
          `${text} Structure is unavailable. Open Code XML to inspect the report.`.trim(),
        );
      else if (message.structure.truncated)
        this.notice.update((text) =>
          `${text} Structure is incomplete because a presentation or transport limit was reached. Open Code XML for the complete report.`.trim(),
        );
      this.reconcile();
      const native = this.nativePending;
      if (
        native &&
        !native.outcome &&
        !this.pending() &&
        !this.nativeEdits.size &&
        message.version > native.message.baseVersion
      )
        this.settleNativeAction(
          'refused',
          'The report changed before the native action completed; it was not replayed.',
        );
      this.reconcileNative();
    } else if (message.kind === 'nativeCancel') {
      const action = this.nativeAction();
      if (
        action?.requestId === message.requestId &&
        action.baseVersion === message.baseVersion
      )
        this.cancelNative(message.reason, false);
    } else if (message.kind === 'historyResult') {
      const pending = this.pending();
      if (
        !pending ||
        pending.requestId !== message.requestId ||
        pending.baseVersion !== message.baseVersion
      )
        return;
      const result: EditOutcome = {
        baseVersion: message.baseVersion,
        version: message.resultVersion,
        requestId: message.requestId,
        accepted: message.accepted,
        changed: message.changed,
        reason:
          message.reason ??
          (message.changed ? 'Native history applied.' : 'No history change.'),
        mappings: [],
        diagnostics: [],
        history: true,
      };
      this.outcome.set(result);
      this.notice.set(result.reason);
      this.pending.set({ ...pending, result });
      this.reconcile();
    } else if (message.kind === 'protocolError') {
      this.blocked = true;
      this.pending.set(null);
      this.cancelNative(
        'The designer was blocked after a protocol error; the pending action was cancelled.',
      );
      this.notice.set(
        `Blocked: ${message.reason}. Refreshing the document; the edit will not be retried.`,
      );
      this.post({ protocol: 2, kind: 'ready' });
    } else if (
      message.kind === 'editResult' ||
      message.kind === 'clipboardResult'
    ) {
      const pending = this.pending();
      if (message.version < (this.snapshot()?.version ?? 0)) {
        if (pending?.requestId === message.requestId) {
          this.pending.set(null);
          this.outcome.set(null);
          this.notice.set(
            'The document changed independently; the obsolete result was discarded.',
          );
        }
        this.refuseCorrelated(
          message.requestId,
          'The document changed independently; the native action was not replayed.',
        );
        return;
      }
      const clipboard = message.kind === 'clipboardResult';
      const result: EditOutcome = {
        baseVersion: message.baseVersion,
        version: message.version,
        changed: message.changed,
        mappings: clipboard
          ? message.removed.map((sourceId) => ({ sourceId, resultId: null }))
          : message.mappings,
        requestId: message.requestId,
        accepted: message.accepted,
        reason: message.reason,
        diagnostics: message.diagnostics,
        ...(clipboard ? { inserted: message.inserted } : {}),
        ...(!clipboard && message.created ? { created: message.created } : {}),
      };
      if (pending && pending.requestId !== message.requestId) return;
      this.outcome.set(result);
      // Refusals are explained once by the editor's Blocked line.
      if (pending && !message.accepted) this.notice.set('');
      else if (pending && clipboard && message.action === 'copy')
        this.notice.set('Copied to the clipboard; the document is unchanged.');
      if (pending) {
        this.pending.set({ ...pending, result });
        this.reconcile();
      }
      this.settleCorrelated(message.requestId);
    }
  }

  sendEdit(intent: EditIntent, nativeRequestId?: string): boolean {
    const snapshot = this.snapshot();
    if (
      this.blocked ||
      this.pending() !== null ||
      snapshot?.status !== 'editable' ||
      intent.baseVersion !== snapshot.version
    )
      return false;
    this.pending.set({
      requestId: intent.requestId,
      baseVersion: intent.baseVersion,
    });
    if (nativeRequestId)
      this.nativeEdits.set(intent.requestId, nativeRequestId);
    this.outcome.set(null);
    this.post({
      protocol: 2,
      kind: 'edit',
      ...intent,
      ...(nativeRequestId ? { nativeRequestId } : {}),
    });
    return true;
  }

  sendHistory(requestId: string, action: 'undo' | 'redo'): boolean {
    const snapshot = this.snapshot();
    if (!snapshot || this.blocked || this.pending()) return false;
    this.pending.set({ requestId, baseVersion: snapshot.version });
    this.outcome.set(null);
    this.post({
      protocol: 2,
      kind: 'history',
      requestId,
      baseVersion: snapshot.version,
      action,
    });
    return true;
  }

  /** Clipboard actions share the edit guards; the host owns capture and native I/O. */
  sendClipboard(request: ClipboardRequest, nativeRequestId?: string): boolean {
    const snapshot = this.snapshot();
    if (
      this.blocked ||
      this.pending() !== null ||
      snapshot?.status !== 'editable' ||
      request.baseVersion !== snapshot.version
    )
      return false;
    this.pending.set({
      requestId: request.requestId,
      baseVersion: request.baseVersion,
    });
    if (nativeRequestId)
      this.nativeEdits.set(request.requestId, nativeRequestId);
    this.outcome.set(null);
    this.post({
      protocol: 2,
      kind: 'clipboard',
      ...request,
      ...(nativeRequestId ? { nativeRequestId } : {}),
    });
    return true;
  }

  /** Bind the panel once; later snapshots may only advance its context generation. */
  bindView(
    viewId: string,
    documentLifetimeId: string,
    contextGeneration = 0,
  ): boolean {
    if (
      !/^[A-Za-z0-9:_-]{1,128}$/.test(viewId) ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(documentLifetimeId) ||
      !Number.isSafeInteger(contextGeneration) ||
      contextGeneration < 0
    )
      return false;
    if (!this.view) {
      this.view = { viewId, documentLifetimeId, contextGeneration };
      return true;
    }
    if (
      this.view.viewId !== viewId ||
      this.view.documentLifetimeId !== documentLifetimeId ||
      contextGeneration < this.view.contextGeneration
    )
      return false;
    this.view = { viewId, documentLifetimeId, contextGeneration };
    return true;
  }

  private applyViewBinding(binding: ViewIdentity): void {
    const previous = this.view;
    if (
      !this.bindView(
        binding.viewId,
        binding.documentLifetimeId,
        binding.contextGeneration,
      )
    ) {
      this.notice.set(
        'This designer no longer matches its host view; native actions are unavailable.',
      );
      return;
    }
    // A correlated edit already sent keeps settling from its own result.
    if (
      previous &&
      previous.contextGeneration !== binding.contextGeneration &&
      !this.nativeEdits.size
    )
      this.cancelNative(
        'The designer context changed; the pending action was cancelled.',
      );
    const current = this.snapshot();
    if (current) this.snapshot.set({ ...current, viewBinding: binding });
  }

  /**
   * Never drop a pending action silently: settle it as cancelled unless the host already
   * did (`report` false for a host cancellation, which follows the host's own outcome).
   */
  private cancelNative(reason: string, report = true): void {
    if (!this.nativePending || this.nativePending.outcome) return;
    this.nativeEdits.clear();
    if (report && this.settleNativeAction('cancelled', reason)) {
      this.notice.set(reason);
      return;
    }
    this.nativePending = null;
    this.nativeAction.set(null);
    this.nativeOutcome.set(null);
    this.notice.set(reason);
  }

  /** A refused native action still settles once, so the host never waits for it. */
  private refuseIngested(message: NativeActionMessage, reason: string): void {
    this.notice.set(reason);
    this.post({
      protocol: 2,
      kind: 'actionOutcome',
      requestId: message.requestId,
      baseVersion: message.baseVersion,
      resultVersion: Math.max(
        message.baseVersion,
        this.snapshot()?.version ?? 0,
      ),
      status: 'refused',
      reason,
      selectionSequence: this.selectionSequence,
    });
  }

  /** Publish accepted state only; identical refreshes never become a new intent. */
  publishSelection(selection: Selection, requestId?: string): boolean {
    const view = this.view;
    const snapshot = this.snapshot();
    if (!view || !snapshot || selection.version !== snapshot.version)
      return false;
    if (requestId !== undefined) {
      const pending = this.nativePending;
      if (!pending || pending.message.requestId !== requestId) return false;
    }
    const nodes = snapshot.navigation?.structure.nodes ?? [];
    const selectedNode = nodes.find(
      (node) =>
        node.id === (selection.cellTargetId ?? selection.structureTargetId),
    );
    const xmlCell =
      selectedNode?.kind === 'table-cell'
        ? selectedNode
        : selectedNode?.parentId
          ? nodes.find(
              (node) =>
                node.id === selectedNode.parentId && node.kind === 'table-cell',
            )
          : undefined;
    const xmlCellId =
      snapshot.scene?.items.find((item) => item.id === selection.cellTargetId)
        ?.xmlCellId ?? xmlCell?.id;
    const navigation: NavigationSelection = xmlCellId
      ? { mode: 'cell', targetId: xmlCellId }
      : selection.structureTargetId
        ? { mode: 'structure', targetId: selection.structureTargetId }
        : selection.cellTargetId
          ? { mode: 'cell', targetId: selection.cellTargetId }
          : selection.bodyItemIds.length
            ? {
                mode: 'body',
                targetIds: [...selection.bodyItemIds],
                primaryId: selection.primaryId ?? selection.bodyItemIds.at(-1)!,
              }
            : { mode: 'empty' };
    if (
      requestId === undefined &&
      JSON.stringify(this.lastSelection) === JSON.stringify(navigation)
    )
      return false;
    const message: AcceptedSelectionMessage = {
      protocol: 2,
      kind: 'acceptedSelection',
      version: selection.version,
      viewId: view.viewId,
      sequence: ++this.selectionSequence,
      ...(requestId === undefined ? {} : { requestId }),
      selection: navigation,
    };
    this.lastSelection = navigation;
    this.publishedSelection.set(message);
    this.post(message);
    return true;
  }

  /** Settle the captured action from its correlated edit/clipboard result. */
  private settleCorrelated(requestId: string): void {
    const nativeId = this.nativeEdits.get(requestId);
    if (!nativeId) return;
    this.nativeEdits.delete(requestId);
    const pending = this.nativePending;
    const outcome = this.outcome();
    if (
      !pending ||
      pending.message.requestId !== nativeId ||
      pending.outcome ||
      !outcome ||
      outcome.requestId !== requestId
    )
      return;
    if (outcome.accepted) this.settleNativeAction('accepted');
    else
      this.settleNativeAction(
        'refused',
        outcome.reason || 'The native action was refused.',
      );
  }

  private refuseCorrelated(requestId: string, reason: string): void {
    if (!this.nativeEdits.has(requestId)) return;
    this.nativeEdits.delete(requestId);
    const pending = this.nativePending;
    if (!pending || pending.outcome) return;
    this.settleNativeAction('refused', reason);
  }

  /** One terminal outcome per captured request; no retry on a newer version. */
  settleNativeAction(status: ActionStatus, reason?: string): boolean {
    const pending = this.nativePending;
    const snapshot = this.snapshot();
    if (!pending || pending.outcome || !snapshot) return false;
    if (
      status === 'accepted'
        ? reason !== undefined
        : typeof reason !== 'string' ||
          reason.length === 0 ||
          reason.length > 1024
    )
      return false;
    const own = this.outcome();
    if (
      status === 'accepted' &&
      !own &&
      snapshot.version !== pending.message.baseVersion
    ) {
      this.notice.set(
        'The report changed before the native action completed; it was not replayed.',
      );
      return false;
    }
    const resultVersion =
      status === 'accepted'
        ? Math.max(
            pending.message.baseVersion,
            own?.version ?? snapshot.version,
          )
        : Math.max(pending.message.baseVersion, snapshot.version);
    const outcome: ActionOutcomeMessage = {
      protocol: 2,
      kind: 'actionOutcome',
      requestId: pending.message.requestId,
      baseVersion: pending.message.baseVersion,
      resultVersion,
      status,
      ...(reason === undefined ? {} : { reason }),
      selectionSequence: this.selectionSequence,
    };
    this.nativePending = { ...pending, outcome };
    this.nativeAction.set(null);
    this.nativeOutcome.set(outcome);
    this.post(outcome);
    this.reconcileNative();
    return true;
  }

  private nativeRefusal(message: NativeActionMessage): string | null {
    const view = this.view;
    if (
      !view ||
      message.viewId !== view.viewId ||
      message.documentLifetimeId !== view.documentLifetimeId ||
      message.contextGeneration !== view.contextGeneration
    )
      return 'This native action targets another designer; no action was dispatched.';
    const snapshot = this.snapshot();
    if (!snapshot) return 'The report is not ready for native actions.';
    if (message.baseVersion !== snapshot.version)
      return 'The report changed before the native action arrived.';
    const known = this.knownTargets(snapshot);
    if (message.targetIds.some((id) => !known.has(id)))
      return 'The selected target is no longer available.';
    if (
      ['properties', 'create', 'author'].includes(message.action) &&
      snapshot.status !== 'editable'
    )
      return 'This report is read-only for that action.';
    if (
      message.action === 'clipboard' &&
      !snapshot.capabilities.includes('clipboard')
    )
      return 'Clipboard actions are unavailable for this report.';
    return null;
  }

  private knownTargets(snapshot: EditorSnapshot): ReadonlySet<string> {
    const known = new Set<string>();
    for (const node of snapshot.structure?.nodes ?? []) known.add(node.id);
    for (const node of snapshot.navigation?.structure.nodes ?? [])
      known.add(node.id);
    for (const node of snapshot.navigation?.data.nodes ?? [])
      known.add(node.id);
    for (const item of snapshot.scene?.items ?? []) known.add(item.id);
    for (const dataset of snapshot.authoring?.datasets ?? []) {
      known.add(dataset.id);
      for (const field of dataset.fields) known.add(field.id);
    }
    for (const table of snapshot.authoring?.tables ?? []) {
      known.add(table.id);
      for (const group of table.groups) known.add(group.id);
      for (const row of table.rows)
        for (const cell of row.cells) known.add(cell.id);
    }
    return known;
  }

  private reconcileNative(): void {
    const pending = this.nativePending;
    if (!pending?.outcome) return;
    const version = this.snapshot()?.version;
    if (version === undefined) return;
    if (version > pending.outcome.resultVersion) {
      this.nativePending = null;
      this.nativeOutcome.set(null);
      this.notice.set(
        'The document changed independently; the native action result was discarded.',
      );
    } else if (version >= pending.outcome.resultVersion) {
      this.nativePending = null;
    }
  }

  private reconcile(): void {
    const pending = this.pending();
    const version = this.snapshot()?.version;
    if (!pending?.result || version === undefined) return;
    if (version >= pending.result.version) {
      if (version > pending.result.version) {
        this.outcome.set(null);
        this.notice.set(
          'The document changed independently; select an item again.',
        );
      }
      this.pending.set(null);
    }
  }

  openSource(targetId?: string): void {
    const version = this.snapshot()?.version;
    if (version === undefined) return;
    this.post(
      targetId === undefined
        ? { protocol: 2, kind: 'openSource', version }
        : { protocol: 2, kind: 'openSource', version, targetId },
    );
  }

  /** Disposable view state survives hide/show and reload of this view only. */
  saveView(view: ViewState): void {
    this.api?.setState?.({ view });
  }

  private post(message: unknown): void {
    // Keep only bounded diagnostic history, never a second document or undo stack.
    this.sent.update((messages) => [...messages.slice(-99), message]);
    this.api?.postMessage(message);
  }
}
