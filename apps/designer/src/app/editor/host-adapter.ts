import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  validateMessage,
  type AuthoringState,
  type ClipboardRequestMessage,
} from '@rdlc/report-model/protocol';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { EditIntent, TargetMapping } from '@rdlc/report-model/editing';
import type { DesignScene } from '@rdlc/report-model/scene';
import { restoreViewState, type ViewState } from './viewport';

export interface EditorSnapshot {
  readonly version: number;
  readonly status: 'editable' | 'source-only' | 'invalid-source';
  readonly capabilities: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly scene: DesignScene | null;
  readonly authoring?: AuthoringState | null;
}
export interface EditOutcome {
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
  readonly sent = signal<readonly unknown[]>([]);
  readonly notice = signal('');
  readonly pending = signal<{
    readonly requestId: string;
    readonly baseVersion: number;
    readonly result?: EditOutcome;
  } | null>(null);
  private blocked = false;
  private readonly api: VsCodeApi | null;
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
    if (this.api) this.post({ protocol: 1, kind: 'ready' });
  }

  ingest(input: unknown): void {
    const message = validateMessage(input);
    if (!message) return;
    if (message.kind === 'snapshot') {
      const previous = this.snapshot();
      if (previous && message.version < previous.version) return;
      this.blocked = false;
      if (previous && message.version === previous.version) return;
      if (previous && !this.pending()) {
        this.notice.set(
          'The document changed. Obsolete drafts were cancelled; select an item and start a new edit.',
        );
        this.outcome.set(null);
      }
      this.previousScene.set(previous?.scene ?? null);
      this.snapshot.set({
        version: message.version,
        status: message.projection.status,
        capabilities: message.projection.capabilities,
        diagnostics: message.projection.diagnostics,
        scene: message.scene,
        authoring: message.authoring ?? null,
      });
      this.reconcile();
    } else if (message.kind === 'protocolError') {
      this.blocked = true;
      this.pending.set(null);
      this.notice.set(
        `Blocked: ${message.reason}. Refreshing the document; the edit will not be retried.`,
      );
      this.post({ protocol: 1, kind: 'ready' });
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
      };
      if (pending && pending.requestId !== message.requestId) return;
      this.outcome.set(result);
      if (pending && !message.accepted)
        this.notice.set(
          `Not applied (${message.reason}); the current accepted document is shown and the request will not be retried.`,
        );
      else if (pending && clipboard && message.action === 'copy')
        this.notice.set('Copied to the clipboard; the document is unchanged.');
      if (pending) {
        this.pending.set({ ...pending, result });
        this.reconcile();
      }
    }
  }

  sendEdit(intent: EditIntent): boolean {
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
    this.outcome.set(null);
    this.post({ protocol: 1, kind: 'edit', ...intent });
    return true;
  }

  /** Clipboard actions share the edit guards; the host owns capture and native I/O. */
  sendClipboard(request: ClipboardRequest): boolean {
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
    this.outcome.set(null);
    this.post({ protocol: 1, kind: 'clipboard', ...request });
    return true;
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
        ? { protocol: 1, kind: 'openSource', version }
        : { protocol: 1, kind: 'openSource', version, targetId },
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
