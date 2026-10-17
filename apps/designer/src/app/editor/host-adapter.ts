import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  validateMessage,
  type AuthoringState,
} from '@rdlc/report-model/protocol';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { EditIntent } from '@rdlc/report-model/editing';
import type { DesignScene } from '@rdlc/report-model/scene';

export interface EditorSnapshot {
  readonly version: number;
  readonly status: 'editable' | 'source-only' | 'invalid-source';
  readonly capabilities: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly scene: DesignScene | null;
  readonly authoring?: AuthoringState | null;
}
export interface EditOutcome {
  readonly requestId: string;
  readonly accepted: boolean;
  readonly reason: string;
  readonly diagnostics: readonly Diagnostic[];
}

interface VsCodeApi {
  postMessage(message: unknown): void;
}

/**
 * The only transport between the Angular surface and the extension host. The host
 * owns the document; this adapter sends intents and applies accepted snapshots.
 */
@Injectable({ providedIn: 'root' })
export class HostAdapter {
  readonly snapshot = signal<EditorSnapshot | null>(null);
  readonly outcome = signal<EditOutcome | null>(null);
  readonly sent = signal<readonly unknown[]>([]);
  readonly notice = signal('');
  private blocked = false;
  private readonly api: VsCodeApi | null;

  constructor() {
    const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeApi })
      .acquireVsCodeApi;
    this.api = typeof acquire === 'function' ? acquire() : null;
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
      if (previous) {
        this.notice.set(
          'The document changed. Obsolete drafts were cancelled; select an item and start a new edit.',
        );
        this.outcome.set(null);
      }
      this.snapshot.set({
        version: message.version,
        status: message.projection.status,
        capabilities: message.projection.capabilities,
        diagnostics: message.projection.diagnostics,
        scene: message.scene,
        authoring: message.authoring ?? null,
      });
    } else if (message.kind === 'protocolError') {
      this.blocked = true;
      this.notice.set(
        `Blocked: ${message.reason}. Refreshing the document; the edit will not be retried.`,
      );
      this.post({ protocol: 1, kind: 'ready' });
    } else if (message.kind === 'editResult') {
      if (message.version < (this.snapshot()?.version ?? 0)) return;
      this.outcome.set({
        requestId: message.requestId,
        accepted: message.accepted,
        reason: message.reason,
        diagnostics: message.diagnostics,
      });
    }
  }

  sendEdit(intent: EditIntent): void {
    const snapshot = this.snapshot();
    if (
      this.blocked ||
      snapshot?.status !== 'editable' ||
      intent.baseVersion !== snapshot.version
    )
      return;
    this.post({ protocol: 1, kind: 'edit', ...intent });
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

  private post(message: unknown): void {
    // Keep only bounded diagnostic history, never a second document or undo stack.
    this.sent.update((messages) => [...messages.slice(-99), message]);
    this.api?.postMessage(message);
  }
}
