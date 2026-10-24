/**
 * Window-scoped report context routing, independent of the VS Code API.
 *
 * The host feeds document, focus, evaluation and panel events in; native views
 * read immutable context/captures out. Report content stays in the host
 * TextDocument: this registry only decides which document lifetime, version
 * and designer view an action belongs to.
 */

export type ContextState =
  | 'no-report'
  | 'loading'
  | 'editable'
  | 'source-only'
  | 'invalid-source';

export type EvaluatedState = Exclude<ContextState, 'no-report' | 'loading'>;

/** Disposable routing view of the accepted report context. */
export interface WindowContext {
  readonly state: ContextState;
  /** Opaque document lifetime: reopened URIs receive a new ID. */
  readonly documentId: string | null;
  readonly uri: string | null;
  readonly version: number;
  readonly generation: number;
  /** Last surviving designer of this document, never another report's view. */
  readonly viewId: string | null;
}

/** Accepted syntax/evaluation facts for one document version. */
export interface ReportEvaluation {
  readonly state: EvaluatedState;
  readonly version: number;
  readonly targets?: readonly string[];
  readonly sourceTargets?: readonly string[];
  readonly capabilities?: readonly string[];
}

/** Immutable authority captured at user activation. */
export interface CapturedAction {
  readonly requestId: string;
  readonly documentId: string;
  readonly uri: string;
  readonly baseVersion: number;
  readonly viewId: string | null;
  readonly contextGeneration: number;
  readonly targetIds: readonly string[];
  readonly capability: string;
}

export type CaptureFailure =
  | 'request-limit'
  | 'disposed'
  | 'invalid-request'
  | 'duplicate'
  | 'no-report'
  | 'loading'
  | 'invalid-source'
  | 'unsupported'
  | 'stale-target';

export type RevalidationFailure =
  | 'settled'
  | 'disposed'
  | 'stale-document'
  | 'stale-version'
  | 'stale-context'
  | 'loading'
  | 'invalid-source'
  | 'disposed-view'
  | 'unsupported'
  | 'stale-target';

export type CaptureResult =
  | { readonly ok: true; readonly capture: CapturedAction }
  | { readonly ok: false; readonly reason: CaptureFailure };

export type BindResult =
  | { readonly ok: true; readonly capture: CapturedAction }
  | {
      readonly ok: false;
      readonly reason: RevalidationFailure | 'already-bound' | 'foreign-view';
    };

export type TerminationReason =
  | 'view-disposed'
  | 'document-closed'
  | 'registry-disposed';

export interface TerminatedCapture {
  readonly capture: CapturedAction;
  readonly reason: TerminationReason;
}

interface DocumentRecord {
  readonly requests: Set<string>;
  readonly id: string;
  uri: string;
  version: number;
  state: 'loading' | EvaluatedState;
  /** Last accepted evaluation class; content changes alone never replace it. */
  evaluatedClass: EvaluatedState | null;
  targets: ReadonlySet<string>;
  sourceTargets: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
  /** Designer panels of this lifetime, in registration order. */
  readonly views: string[];
  lastView: string | null;
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0)
    throw new RangeError('Invalid document version');
}

function assertUri(uri: string): void {
  if (typeof uri !== 'string' || uri.length === 0)
    throw new TypeError('Invalid document URI');
}

export class WindowContextRegistry {
  private readonly documents = new Map<string, DocumentRecord>();
  /** Host document handles (VS Code TextDocument objects) to lifetime IDs. */
  private readonly lifetimes = new Map<unknown, string>();
  private readonly views = new Map<string, { readonly documentId: string }>();
  private readonly pending = new Map<string, CapturedAction>();
  private readonly listeners = new Set<(event: TerminatedCapture) => void>();
  private active: string | null = null;
  private generation = 0;
  private disposed = false;
  private nextDocument = 0;
  private nextView = 0;

  /** Current routing context. Reading it never changes the generation. */
  context(): WindowContext {
    const record = this.active ? this.documents.get(this.active) : undefined;
    return Object.freeze({
      state: record?.state ?? 'no-report',
      documentId: record?.id ?? null,
      uri: record?.uri ?? null,
      version: record?.version ?? 0,
      generation: this.generation,
      viewId: record?.lastView ?? null,
    });
  }

  /** Register a host document lifetime; the same handle returns the same ID. */
  openDocument(handle: unknown, uri: string, version: number): string {
    if (this.disposed) throw new Error('Context registry is disposed');
    assertUri(uri);
    assertVersion(version);
    const existing = this.lifetimes.get(handle);
    if (existing) return existing;
    const id = `document-${++this.nextDocument}`;
    this.documents.set(id, {
      requests: new Set(),
      id,
      uri,
      version,
      state: 'loading',
      evaluatedClass: null,
      targets: new Set(),
      sourceTargets: new Set(),
      capabilities: new Set(),
      views: [],
      lastView: null,
    });
    this.lifetimes.set(handle, id);
    return id;
  }

  /** Source-editor focus: keep the last surviving designer of this document. */
  focusDocument(documentId: string): WindowContext {
    this.recordOf(documentId);
    if (this.active !== documentId) {
      this.active = documentId;
      this.touch();
    }
    return this.context();
  }

  /** Designer-panel focus: associate that exact panel with its lifetime. */
  focusView(viewId: string): WindowContext {
    const view = this.views.get(viewId);
    if (!view) throw new Error('Unknown designer view');
    const record = this.recordOf(view.documentId);
    if (this.active !== record.id) {
      this.active = record.id;
      this.touch();
    }
    if (record.lastView !== null && record.lastView !== viewId) this.touch();
    record.lastView = viewId;
    return this.context();
  }

  /** Sidebar focus changes no context, generation, version or association. */
  focusSidebar(): WindowContext {
    return this.context();
  }

  /** Explicit non-report activation clears context without touching content. */
  focusOther(): WindowContext {
    if (this.active !== null) {
      this.active = null;
      this.touch();
    }
    return this.context();
  }

  /**
   * Host text change: accepted facts are pending again for the new version. A content
   * change alone is not a context change; baseVersion checks already guard versions.
   */
  documentChanged(documentId: string, version: number): boolean {
    const record = this.recordOf(documentId);
    assertVersion(version);
    if (version <= record.version) return false;
    record.version = version;
    record.state = 'loading';
    record.targets = new Set();
    record.sourceTargets = new Set();
    record.capabilities = new Set();
    return true;
  }

  /** Accepted evaluation. Older versions are ignored so races cannot resurrect state. */
  setEvaluation(documentId: string, evaluation: ReportEvaluation): boolean {
    const record = this.recordOf(documentId);
    assertVersion(evaluation.version);
    if (evaluation.version < record.version) return false;
    const previousClass = record.evaluatedClass;
    const invalid = evaluation.state === 'invalid-source';
    record.version = evaluation.version;
    record.state = evaluation.state;
    record.evaluatedClass = evaluation.state;
    // Invalid source clears stale actionable nodes.
    record.targets = invalid ? new Set() : new Set(evaluation.targets ?? []);
    record.sourceTargets = invalid
      ? new Set()
      : new Set(evaluation.sourceTargets ?? evaluation.targets ?? []);
    record.capabilities = invalid
      ? new Set()
      : new Set(evaluation.capabilities ?? []);
    // Only an evaluation class change advances the generation; target/capability rechecks still apply.
    if (this.active === documentId && previousClass !== evaluation.state)
      this.touch();
    return true;
  }

  /** A panel became available for this lifetime; returns an opaque view ID. */
  registerView(documentId: string): string {
    const record = this.recordOf(documentId);
    const id = `view-${++this.nextView}`;
    this.views.set(id, { documentId });
    record.views.push(id);
    if (record.lastView === null) record.lastView = id;
    return id;
  }

  disposeView(viewId: string): boolean {
    const view = this.views.get(viewId);
    if (!view) return false;
    this.views.delete(viewId);
    const record = this.documents.get(view.documentId);
    if (record) {
      const index = record.views.indexOf(viewId);
      if (index >= 0) record.views.splice(index, 1);
      if (record.lastView === viewId)
        record.lastView = record.views.at(-1) ?? null;
    }
    this.terminate((capture) => capture.viewId === viewId, 'view-disposed');
    return true;
  }

  closeDocument(documentId: string): boolean {
    const record = this.documents.get(documentId);
    if (!record) return false;
    if (this.active === documentId) {
      this.active = null;
      this.touch();
    }
    this.terminate(
      (capture) => capture.documentId === documentId,
      'document-closed',
    );
    for (const viewId of record.views) this.views.delete(viewId);
    this.documents.delete(documentId);
    for (const [handle, id] of this.lifetimes)
      if (id === documentId) this.lifetimes.delete(handle);
    return true;
  }

  /** Save As on the same host lifetime: follow the real URI and invalidate. */
  retarget(documentId: string, uri: string, version: number): void {
    const record = this.recordOf(documentId);
    assertUri(uri);
    assertVersion(version);
    record.uri = uri;
    record.version = version;
    record.state = 'loading';
    record.evaluatedClass = null;
    record.targets = new Set();
    record.sourceTargets = new Set();
    record.capabilities = new Set();
    if (this.active === documentId) this.touch();
  }

  /** Capture authority at activation; refusals leave no pending entry. */
  capture(
    requestId: string,
    capability: string,
    targetIds: readonly string[] = [],
  ): CaptureResult {
    if (this.disposed) return { ok: false, reason: 'disposed' };
    if (typeof requestId !== 'string' || requestId.length === 0)
      return { ok: false, reason: 'invalid-request' };
    if (this.pending.has(requestId)) return { ok: false, reason: 'duplicate' };
    const record = this.active ? this.documents.get(this.active) : undefined;
    if (!record) return { ok: false, reason: 'no-report' };
    if (record.requests.has(requestId))
      return { ok: false, reason: 'duplicate' };
    // shortcut: retain 1,024 request IDs per document lifetime; revisit with long-session replay storage.
    if (record.requests.size >= 1024)
      return { ok: false, reason: 'request-limit' };
    if (record.state === 'loading') return { ok: false, reason: 'loading' };
    if (record.state === 'invalid-source')
      return { ok: false, reason: 'invalid-source' };
    if (!record.capabilities.has(capability))
      return { ok: false, reason: 'unsupported' };
    if (targetIds.some((id) => !this.targetsFor(record, capability).has(id)))
      return { ok: false, reason: 'stale-target' };
    const capture: CapturedAction = Object.freeze({
      requestId,
      documentId: record.id,
      uri: record.uri,
      baseVersion: record.version,
      viewId: record.lastView,
      contextGeneration: this.generation,
      targetIds: Object.freeze([...targetIds]),
      capability,
    });
    this.pending.set(requestId, capture);
    record.requests.add(requestId);
    return { ok: true, capture };
  }

  /** Recheck after every asynchronous boundary; null means still authorized. */
  revalidate(capture: CapturedAction): RevalidationFailure | null {
    if (this.disposed) return 'disposed';
    const record = this.documents.get(capture.documentId);
    if (
      !record ||
      this.active !== capture.documentId ||
      record.uri !== capture.uri
    )
      return 'stale-document';
    if (record.version !== capture.baseVersion) return 'stale-version';
    if (record.state === 'loading') return 'loading';
    if (record.state === 'invalid-source') return 'invalid-source';
    if (capture.viewId !== null) {
      const view = this.views.get(capture.viewId);
      if (!view || view.documentId !== record.id) return 'disposed-view';
      if (record.lastView !== capture.viewId) return 'stale-context';
    }
    if (this.generation !== capture.contextGeneration) return 'stale-context';
    if (!record.capabilities.has(capture.capability)) return 'unsupported';
    if (
      capture.targetIds.some(
        (id) => !this.targetsFor(record, capture.capability).has(id),
      )
    )
      return 'stale-target';
    if (this.pending.get(capture.requestId) !== capture) return 'settled';
    return null;
  }

  /**
   * Bind one just-opened designer panel to a preliminary capture. Generation
   * and version are unchanged, so an unrelated context change still refuses.
   */
  bind(capture: CapturedAction, viewId: string): BindResult {
    if (capture.viewId !== null) return { ok: false, reason: 'already-bound' };
    const invalid = this.revalidate(capture);
    if (invalid) return { ok: false, reason: invalid };
    const view = this.views.get(viewId);
    if (!view) return { ok: false, reason: 'disposed-view' };
    if (view.documentId !== capture.documentId)
      return { ok: false, reason: 'foreign-view' };
    const bound: CapturedAction = Object.freeze({ ...capture, viewId });
    this.pending.set(capture.requestId, bound);
    // The bound panel becomes the document's associated designer.
    this.recordOf(capture.documentId).lastView = viewId;
    return { ok: true, capture: bound };
  }

  /** One terminal result per request; duplicate settlement is a no-op. */
  settle(capture: CapturedAction): void {
    if (this.pending.get(capture.requestId) === capture)
      this.pending.delete(capture.requestId);
  }

  onDidTerminate(listener: (event: TerminatedCapture) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.terminate(() => true, 'registry-disposed');
    this.listeners.clear();
    this.documents.clear();
    this.lifetimes.clear();
    this.views.clear();
    this.active = null;
    this.disposed = true;
  }

  private recordOf(documentId: string): DocumentRecord {
    if (this.disposed) throw new Error('Context registry is disposed');
    const record = this.documents.get(documentId);
    if (!record) throw new Error('Unknown document lifetime');
    return record;
  }

  private targetsFor(
    record: DocumentRecord,
    capability: string,
  ): ReadonlySet<string> {
    return ['source', 'select', 'inspect'].includes(capability)
      ? record.sourceTargets
      : record.targets;
  }

  private touch(): void {
    this.generation++;
  }

  private terminate(
    matches: (capture: CapturedAction) => boolean,
    reason: TerminationReason,
  ): void {
    for (const [requestId, capture] of this.pending) {
      if (!matches(capture)) continue;
      this.pending.delete(requestId);
      for (const listener of this.listeners) listener({ capture, reason });
    }
  }
}
