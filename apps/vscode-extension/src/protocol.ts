import { validateMessage } from '@rdlc/report-model/protocol';
import type { ClientMessage, HostMessage } from '@rdlc/report-model/protocol';

type Result =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly error: HostMessage };

/** This binding never accepts a URI from the webview or applies an edit itself. */
export class DocumentBinding {
  private ready = false;
  private readonly requests = new Set<string>();
  private ids: ReadonlySet<string>;
  private capabilities: ReadonlySet<string>;
  constructor(
    readonly uri: string,
    private version: number,
    ids: readonly string[],
    capabilities: readonly string[],
  ) {
    this.ids = new Set(ids);
    this.capabilities = new Set(capabilities);
  }
  update(
    version: number,
    ids: readonly string[],
    capabilities: readonly string[],
  ): void {
    if (!Number.isSafeInteger(version) || version < this.version)
      throw new Error('Invalid document version');
    this.version = version;
    this.ids = new Set(ids);
    this.capabilities = new Set(capabilities);
  }
  receive(input: unknown): Result {
    const reject = (reason: string): Result => ({
      ok: false,
      error: {
        protocol: 1,
        kind: 'protocolError',
        supportedVersion: 1,
        reason,
      },
    });
    const message = validateMessage(input);
    if (!message || !['ready', 'edit', 'openSource'].includes(message.kind))
      return reject('Invalid client envelope or unsupported protocol');
    if (message.kind === 'ready') {
      this.ready = true;
      return { ok: true, message };
    }
    if (!this.ready) return reject('Ready handshake required');
    if (message.kind === 'openSource') {
      if (
        message.version !== this.version ||
        (message.targetId !== undefined && !this.ids.has(message.targetId))
      )
        return reject('Stale or foreign source target');
      return { ok: true, message };
    }
    if (message.kind !== 'edit') return reject('Host-only message');
    if (message.baseVersion !== this.version || !this.ids.has(message.targetId))
      return reject('Stale edit or foreign target');
    if (!this.capabilities.has(message.operation))
      return reject('Operation capability is disabled');
    // shortcut: retain at most 1,024 request IDs; upgrade replay protection before long editing sessions.
    if (this.requests.has(message.requestId) || this.requests.size >= 1024)
      return reject('Duplicate request or session request budget reached');
    this.requests.add(message.requestId);
    return { ok: true, message };
  }
}
