import { Injectable, signal } from '@angular/core';
import { validateMessage } from '@rdlc/report-model/protocol';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { EditIntent } from '@rdlc/report-model/editing';
import type { DesignScene } from '@rdlc/report-model/scene';

export interface EditorSnapshot {
  readonly version: number;
  readonly status: 'editable' | 'source-only' | 'invalid-source';
  readonly capabilities: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly scene: DesignScene | null;
}
export interface EditOutcome {
  readonly requestId: string;
  readonly accepted: boolean;
  readonly reason: string;
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
  private readonly api: VsCodeApi | null;

  constructor() {
    const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeApi })
      .acquireVsCodeApi;
    this.api = typeof acquire === 'function' ? acquire() : null;
    globalThis.addEventListener('message', (event: MessageEvent) =>
      this.ingest(event.data),
    );
    if (this.api) this.post({ protocol: 1, kind: 'ready' });
  }

  ingest(input: unknown): void {
    const message = validateMessage(input);
    if (!message) return;
    if (message.kind === 'snapshot')
      this.snapshot.set({
        version: message.version,
        status: message.projection.status,
        capabilities: message.projection.capabilities,
        diagnostics: message.projection.diagnostics,
        scene: message.scene,
      });
    else if (message.kind === 'editResult')
      this.outcome.set({
        requestId: message.requestId,
        accepted: message.accepted,
        reason: message.reason,
      });
  }

  sendEdit(intent: EditIntent): void {
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
    this.sent.update((messages) => [...messages, message]);
    this.api?.postMessage(message);
  }
}
