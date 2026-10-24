import { validateMessage } from '@rdlc/report-model/protocol';
import type {
  AcceptedSelectionMessage,
  ActionOutcomeMessage,
  ClientMessage,
  HostMessage,
  NativeActionMessage,
  ViewIdentity,
} from '@rdlc/report-model/protocol';
export type { ViewIdentity };

type ClientEnvelope = Extract<
  ClientMessage,
  { kind: 'ready' | 'edit' | 'openSource' | 'clipboard' | 'history' }
>;
type Result =
  | { readonly ok: true; readonly message: ClientEnvelope }
  | { readonly ok: false; readonly error: HostMessage };
export type BridgeResult<T> =
  | { readonly ok: true; readonly message: T }
  | {
      readonly ok: false;
      readonly reason: string;
      /** Benign stale or duplicate input: no state changed and no protocol error is owed. */
      readonly ignored?: true;
    };

function clientEnvelope(message: unknown): message is ClientEnvelope {
  return (
    message !== null &&
    typeof message === 'object' &&
    ['ready', 'edit', 'openSource', 'clipboard', 'history'].includes(
      (message as { kind?: string }).kind ?? '',
    )
  );
}
function opaque(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}
function generation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function reasonText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024)
    return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    )
      return false;
  }
  return true;
}

/** This binding never accepts a URI from the webview or applies an edit itself. */
export class DocumentBinding {
  private ready = false;
  private readonly requests = new Set<string>();
  private ids: ReadonlySet<string>;
  private sourceIds: ReadonlySet<string>;
  private capabilities: ReadonlySet<string>;
  /** One view binding per panel; a different view can never replace it. */
  private view: ViewIdentity | null = null;
  private readonly native = new Map<
    string,
    {
      readonly message: NativeActionMessage;
      outcome?: ActionOutcomeMessage;
      /** Set by the first authorized edit: authorization is single-use. */
      authorized?: true;
    }
  >();
  /** Native actions whose correlated edit is being applied; not invalidated meanwhile. */
  private readonly correlated = new Set<string>();
  private selectionSequence = 0;
  /** `sourceIds` may name any element, including preservation-only ones; it never authorizes edits. */
  constructor(
    readonly uri: string,
    private version: number,
    ids: readonly string[],
    capabilities: readonly string[],
    sourceIds: readonly string[] = ids,
  ) {
    this.ids = new Set(ids);
    this.sourceIds = new Set(sourceIds);
    this.capabilities = new Set(capabilities);
  }
  update(
    version: number,
    ids: readonly string[],
    capabilities: readonly string[],
    sourceIds: readonly string[] = ids,
  ): void {
    if (!Number.isSafeInteger(version) || version < this.version)
      throw new Error('Invalid document version');
    this.version = version;
    this.ids = new Set(ids);
    this.sourceIds = new Set(sourceIds);
    this.capabilities = new Set(capabilities);
  }
  bindView(identity: ViewIdentity): boolean {
    if (
      !opaque(identity.viewId) ||
      !opaque(identity.documentLifetimeId) ||
      !generation(identity.contextGeneration)
    )
      return false;
    if (!this.view) {
      this.view = { ...identity };
      return true;
    }
    // Same panel and document may move forward through context generations; never replace either.
    if (
      this.view.viewId !== identity.viewId ||
      this.view.documentLifetimeId !== identity.documentLifetimeId ||
      identity.contextGeneration < this.view.contextGeneration
    )
      return false;
    this.view = { ...this.view, contextGeneration: identity.contextGeneration };
    return true;
  }
  /** Bound identity for snapshots; null until the host registers this panel. */
  get viewIdentity(): ViewIdentity | null {
    return this.view ? { ...this.view } : null;
  }
  get isReady(): boolean {
    return this.ready;
  }
  private bodySelectionIds?: ReadonlySet<string>;
  private cellSelectionIds?: ReadonlySet<string>;
  setSelectionTargets(
    bodyIds: readonly string[],
    cellIds: readonly string[],
  ): void {
    this.bodySelectionIds = new Set(bodyIds);
    this.cellSelectionIds = new Set(cellIds);
  }
  /** Recheck a native action inside the mutation queue, after any await. */
  authorizeNativeEdit(
    requestId: string,
    baseVersion: number,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    const request = this.native.get(requestId);
    if (!request || request.outcome || request.authorized)
      return { ok: false, reason: 'The native action is no longer pending.' };
    if (
      this.view &&
      request.message.contextGeneration !== this.view.contextGeneration
    )
      return { ok: false, reason: 'The designer context changed.' };
    if (!['create', 'author', 'clipboard'].includes(request.message.action))
      return {
        ok: false,
        reason: 'This native action does not authorize a mutation.',
      };
    if (request.message.baseVersion !== baseVersion)
      return {
        ok: false,
        reason: 'The report changed before the edit applied.',
      };
    request.authorized = true;
    this.correlated.add(requestId);
    return { ok: true };
  }
  /**
   * Settle pending native actions whose capture no longer matches this document or
   * generation. Correlated in-flight edits stay until their own result arrives.
   */
  invalidateNative(
    reason: string,
    all = false,
  ): readonly ActionOutcomeMessage[] {
    if (!reasonText(reason)) return [];
    const outcomes: ActionOutcomeMessage[] = [];
    for (const [requestId, request] of this.native) {
      if (request.outcome || this.correlated.has(requestId)) continue;
      const current =
        request.message.baseVersion === this.version &&
        (!this.view ||
          request.message.contextGeneration === this.view.contextGeneration);
      if (current && !all) continue;
      const outcome: ActionOutcomeMessage = {
        protocol: 2,
        kind: 'actionOutcome',
        requestId,
        baseVersion: request.message.baseVersion,
        resultVersion: this.version,
        status: 'refused',
        reason,
        selectionSequence: this.selectionSequence,
      };
      request.outcome = outcome;
      outcomes.push(outcome);
    }
    return outcomes;
  }
  receive(input: unknown): Result {
    const reject = (reason: string): Result => ({
      ok: false,
      error: {
        protocol: 2,
        kind: 'protocolError',
        supportedVersion: 2,
        reason,
      },
    });
    const message = validateMessage(input);
    if (!message || !clientEnvelope(message))
      return reject('Invalid client envelope or unsupported protocol');
    if (message.kind === 'ready') {
      this.ready = true;
      return { ok: true, message };
    }
    if (!this.ready) return reject('Ready handshake required');
    if (message.kind === 'openSource') {
      if (
        message.version !== this.version ||
        (message.targetId !== undefined &&
          !this.sourceIds.has(message.targetId))
      )
        return reject('Stale or foreign source target');
      return { ok: true, message };
    }
    const targets =
      message.kind === 'history'
        ? []
        : message.kind === 'clipboard'
          ? (message.targetIds ?? [])
          : message.operation === 'layout'
            ? message.payload.targetIds
            : [message.targetId];
    if (
      message.baseVersion !== this.version ||
      targets.some((id) => !this.ids.has(id))
    )
      return reject('Stale edit or foreign target');
    if (
      message.kind !== 'history' &&
      !this.capabilities.has(
        message.kind === 'clipboard' ? 'clipboard' : message.operation,
      )
    )
      return reject('Operation capability is disabled');
    // shortcut: retain at most 1,024 request IDs; upgrade replay protection before long editing sessions.
    if (this.requests.has(message.requestId) || this.requests.size >= 1024)
      return reject('Duplicate request or session request budget reached');
    this.requests.add(message.requestId);
    return { ok: true, message };
  }

  /** Host-authored, captured and session-bound; never a webview command string. */
  dispatchNativeAction(input: unknown): BridgeResult<NativeActionMessage> {
    const message = validateMessage(input);
    if (!message || message.kind !== 'nativeAction')
      return { ok: false, reason: 'Invalid native action envelope' };
    const view = this.view;
    if (!view) return { ok: false, reason: 'No designer view is bound' };
    if (!this.ready) return { ok: false, reason: 'Designer is not ready' };
    if (
      message.uri !== this.uri ||
      message.viewId !== view.viewId ||
      message.documentLifetimeId !== view.documentLifetimeId ||
      message.contextGeneration !== view.contextGeneration
    )
      return { ok: false, reason: 'Native action belongs to another session' };
    if (message.baseVersion !== this.version)
      return { ok: false, reason: 'Stale native action' };
    const source = message.action === 'source' || message.action === 'select';
    if (
      message.targetIds.some(
        (id) => !(source ? this.sourceIds : this.ids).has(id),
      )
    )
      return { ok: false, reason: 'Native action targets a foreign target' };
    const capability = {
      select: null,
      source: null,
      properties: 'setProperty',
      create: 'author',
      author: 'author',
      clipboard: 'clipboard',
    }[message.action];
    if (capability && !this.capabilities.has(capability))
      return { ok: false, reason: 'Operation capability is disabled' };
    // shortcut: retain at most 1,024 request IDs; upgrade replay protection before long editing sessions.
    if (this.requests.has(message.requestId) || this.requests.size >= 1024)
      return {
        ok: false,
        reason: 'Duplicate request or session request budget reached',
      };
    this.requests.add(message.requestId);
    this.native.set(message.requestId, { message });
    return { ok: true, message };
  }

  receiveSelection(input: unknown): BridgeResult<AcceptedSelectionMessage> {
    const message = validateMessage(input);
    if (!message || message.kind !== 'acceptedSelection')
      return { ok: false, reason: 'Invalid accepted selection' };
    if (!this.ready) return { ok: false, reason: 'Ready handshake required' };
    const view = this.view;
    if (!view) return { ok: false, reason: 'No designer view is bound' };
    if (message.viewId !== view.viewId)
      return { ok: false, reason: 'Selection belongs to another session' };
    // Older versions and sequences are benign late arrivals; newer or foreign ones are errors.
    if (message.version < this.version)
      return { ok: false, reason: 'Stale selection version', ignored: true };
    if (message.version !== this.version)
      return { ok: false, reason: 'Stale selection version' };
    if (message.sequence <= this.selectionSequence)
      return { ok: false, reason: 'Older selection sequence', ignored: true };
    const selection = message.selection;
    const targets =
      selection.mode === 'empty'
        ? []
        : selection.mode === 'body'
          ? selection.targetIds
          : [selection.targetId];
    if (
      targets.some((id) => !this.sourceIds.has(id)) ||
      (selection.mode === 'body' &&
        this.bodySelectionIds &&
        targets.some((id) => !this.bodySelectionIds!.has(id))) ||
      (selection.mode === 'cell' &&
        this.cellSelectionIds &&
        !this.cellSelectionIds.has(selection.targetId))
    )
      return {
        ok: false,
        reason: 'Selection is not eligible in this document.',
      };
    if (message.requestId !== undefined) {
      const request = this.native.get(message.requestId);
      if (
        !request ||
        (request.message.baseVersion !== message.version &&
          !this.correlated.has(message.requestId) &&
          !(
            request.outcome?.status === 'accepted' &&
            request.outcome.resultVersion === message.version
          ))
      )
        return { ok: false, reason: 'Selection has no matching request' };
    }
    this.selectionSequence = message.sequence;
    return { ok: true, message };
  }

  receiveOutcome(input: unknown): BridgeResult<ActionOutcomeMessage> {
    const message = validateMessage(input);
    if (!message || message.kind !== 'actionOutcome')
      return { ok: false, reason: 'Invalid action outcome' };
    const request = this.native.get(message.requestId);
    if (!request)
      return { ok: false, reason: 'Outcome has no matching request' };
    if (message.baseVersion !== request.message.baseVersion)
      return { ok: false, reason: 'Outcome base version does not match' };
    if (request.outcome) {
      this.correlated.delete(message.requestId);
      // The first settled result wins; a conflicting duplicate is dropped.
      return JSON.stringify(request.outcome) === JSON.stringify(message)
        ? { ok: true, message }
        : {
            ok: false,
            reason: 'Conflicting duplicate outcome',
            ignored: true,
          };
    }
    // Refusals and cancellations settle the pending request at any version so
    // the host never waits out its timeout; only accepted outcomes can be stale.
    if (message.status === 'accepted') {
      if (message.resultVersion < this.version)
        return {
          ok: false,
          reason: 'Outcome is older than the document',
          ignored: true,
        };
      if (message.selectionSequence < this.selectionSequence)
        return { ok: false, reason: 'Older selection sequence', ignored: true };
    }
    request.outcome = message;
    this.correlated.delete(message.requestId);
    return { ok: true, message };
  }

  /** Failed postMessage or an exhausted bounded wait settles the request once. */
  failNativeDelivery(
    requestId: string,
    reason = 'Designer message delivery was rejected',
  ): ActionOutcomeMessage | null {
    const request = this.native.get(requestId);
    if (!request || request.outcome || !reasonText(reason)) return null;
    this.correlated.delete(requestId);
    const outcome: ActionOutcomeMessage = {
      protocol: 2,
      kind: 'actionOutcome',
      requestId,
      baseVersion: request.message.baseVersion,
      resultVersion: this.version,
      status: 'refused',
      reason,
      selectionSequence: this.selectionSequence,
    };
    request.outcome = outcome;
    return outcome;
  }
}
