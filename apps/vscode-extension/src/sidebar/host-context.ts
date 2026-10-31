import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type {
  ActionOutcomeMessage,
  NativeActionMessage,
} from '@rdlc/report-model/protocol';
import {
  evaluateReport,
  snapshotOf,
  type ReportEvaluation,
} from '../report-evaluation.js';
import type { DocumentSession } from '../document-session.js';
import { activateHistoryTarget } from '../panel-activation.js';
import { WindowContextRegistry, type CapturedAction } from './context.js';

type Intent<T> = T extends NativeActionMessage
  ? Omit<
      T,
      | 'protocol'
      | 'kind'
      | 'requestId'
      | 'documentLifetimeId'
      | 'uri'
      | 'baseVersion'
      | 'viewId'
      | 'contextGeneration'
      | 'capability'
      | 'targetIds'
    >
  : never;
export type NativeIntent = Intent<NativeActionMessage>;

const dropped = new WeakSet<ActionOutcomeMessage>();

/**
 * True for the placeholder outcome of a native selection that never ran because
 * a newer one superseded it, or because its context went stale while it waited.
 * It is not a refusal: callers resolve it silently and show no warning.
 */
export function isDroppedOutcome(outcome: ActionOutcomeMessage): boolean {
  return dropped.has(outcome);
}

function droppedOutcome(reason: string): ActionOutcomeMessage {
  const outcome: ActionOutcomeMessage = {
    protocol: 2,
    kind: 'actionOutcome',
    requestId: `dropped-${randomUUID()}`,
    baseVersion: 0,
    resultVersion: 0,
    status: 'cancelled',
    reason,
    selectionSequence: 0,
  };
  dropped.add(outcome);
  return outcome;
}

export interface DispatchOptions {
  /**
   * Runs once the action reaches the head of the queue, before its context is
   * captured. Return false to drop a stale action silently (a dropped outcome);
   * throw to refuse it with a warning.
   */
  readonly beforeDispatch?: () => boolean | void;
}

interface QueuedDispatch {
  readonly select: boolean;
  supersede(): void;
}

/** Connect actual host document/panel/tab events to the window's routing registry. */
export class SidebarHostContext implements vscode.Disposable {
  private disposed = false;
  /** Bumped by every native dispatch so a late outcome can tell the user moved on. */
  private dispatchSequence = 0;
  /**
   * The designer settles one native action at a time and refuses a second as
   * already pending, so every dispatch of this window waits for the one before
   * it. The tail only ever resolves (never rejects): a failed dispatch cannot
   * poison the chain. Each action stays bounded by its own timeouts.
   */
  private dispatchTail: Promise<void> = Promise.resolve();
  private readonly queued = new Set<QueuedDispatch>();
  private readonly panels = new Set<vscode.Disposable>();
  readonly registry = new WindowContextRegistry();
  private previousContext = JSON.stringify(this.registry.context());
  private readonly actions = new Map<
    string,
    { targets: readonly string[]; create?: string }
  >();
  get pendingTargets(): ReadonlySet<string> {
    return new Set(
      [...this.actions.values()].flatMap((action) => action.targets),
    );
  }
  get pendingComponents(): ReadonlySet<string> {
    return new Set(
      [...this.actions.values()].flatMap((action) =>
        action.create ? [action.create] : [],
      ),
    );
  }
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly documents = new Map<
    vscode.TextDocument,
    { id: string; uri: string; evaluation: ReportEvaluation }
  >();
  private readonly views = new Map<
    string,
    {
      document: vscode.TextDocument;
      panel: vscode.WebviewPanel;
      session: DocumentSession;
    }
  >();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor() {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshFocus()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.refreshFocus()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.refreshFocus()),
      vscode.workspace.onDidOpenTextDocument(() => this.refreshFocus()),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.documents.has(document) || this.isReport(document))
          this.accept(document);
        this.refreshFocus();
      }),
      vscode.workspace.onDidRenameFiles(() => {
        for (const document of this.documents.keys())
          if (!document.isClosed) this.accept(document);
        this.refreshFocus();
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (this.documents.has(document) || this.isReport(document)) {
          this.accept(document);
          this.refreshFocus();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const record = this.documents.get(document);
        if (record) {
          this.registry.closeDocument(record.id);
          this.documents.delete(document);
          this.publishContext();
        }
        this.refreshFocus();
      }),
    );
    this.refreshFocus();
  }

  get evaluation(): ReportEvaluation | undefined {
    const id = this.registry.context().documentId;
    return [...this.documents.values()].find((entry) => entry.id === id)
      ?.evaluation;
  }

  register(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    session: DocumentSession,
  ): vscode.Disposable {
    if (this.disposed) throw new Error('Sidebar context is disposed');
    const record = this.accept(document, session.evaluation);
    const id = this.registry.registerView(record.id);
    this.views.set(id, { document, panel, session });
    const evaluation = session.onEvaluation((accepted) => {
      this.accept(document, accepted);
      this.publishContext();
    });
    const state = panel.onDidChangeViewState(() => {
      // The tab group is the source of truth: a panel's `active` flag can lag a
      // group change (VS Code returns focus to the previous group right after a
      // split), so a stale active=true must never outvote the active tab. It only
      // short-circuits when it agrees with that tab, or when no tab is reported.
      if (
        panel.active &&
        panel.visible &&
        !document.isClosed &&
        this.agreesWithActiveTab(panel, document)
      ) {
        this.registry.focusView(id);
        this.publishContext();
      } else this.refreshFocus();
    });
    const selection = session.onSelection(() => this.changed.fire());
    this.refreshFocus();
    const registration = new vscode.Disposable(() => {
      this.panels.delete(registration);
      evaluation.dispose();
      state.dispose();
      selection.dispose();
      this.views.delete(id);
      this.registry.disposeView(id);
      this.refreshFocus();
    });
    this.panels.add(registration);
    return registration;
  }

  get selection() {
    const view = this.registry.context().viewId;
    return view
      ? (this.views.get(view)?.session.currentSelection ?? null)
      : null;
  }

  /**
   * Queue a native action behind the ones already dispatched. The report, view,
   * version and targets are captured now, at call time, and revalidated once the
   * action reaches the head of the queue: an action whose document or designer
   * changed while it waited is refused, never rebased onto the new version.
   * Selections coalesce: only the latest still-waiting selection runs, older waiting ones
   * resolve as dropped outcomes. Every other action always runs, in order.
   */
  async dispatch(
    intent: NativeIntent,
    targetIds: readonly string[] = [],
    options: DispatchOptions = {},
  ): Promise<ActionOutcomeMessage> {
    if (intent.action === 'properties') {
      const navigation = this.evaluation?.navigation;
      const nodes = [
        ...(navigation?.structure.nodes ?? []),
        ...(navigation?.data.nodes ?? []),
      ];
      if (
        targetIds.length !== 1 ||
        !nodes.some(
          (node) =>
            node.id === targetIds[0] &&
            node.capabilities.some(
              (capability) =>
                capability.operation === 'properties' && capability.eligible,
            ),
        )
      )
        throw new Error(
          'Properties are unavailable for this report target. Inspect Code XML.',
        );
    }
    const captured = this.registry.capture(
      `native-${randomUUID()}`,
      intent.action,
      targetIds,
    );
    if (!captured.ok)
      throw new Error(`Report action is unavailable: ${captured.reason}.`);
    const capture = captured.capture;
    this.actions.set(capture.requestId, {
      targets: capture.targetIds,
      ...(intent.action === 'create' ? { create: intent.create } : {}),
    });
    this.changed.fire();
    // A later action, even one still queued, means the user moved on.
    const sequence = ++this.dispatchSequence;
    let supersede!: () => void;
    const superseded = new Promise<true>((resolve) => {
      supersede = () => resolve(true);
    });
    const entry: QueuedDispatch = {
      select: intent.action === 'select',
      supersede,
    };
    if (entry.select)
      for (const waiting of this.queued)
        if (waiting.select) waiting.supersede();
    this.queued.add(entry);
    const previous = this.dispatchTail;
    let release!: () => void;
    this.dispatchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    try {
      const wasSuperseded = await Promise.race([
        previous.then(() => false as const),
        superseded,
      ]);
      this.queued.delete(entry);
      if (wasSuperseded)
        return droppedOutcome('Superseded by a newer selection.');
      if (this.disposed) throw new Error('Sidebar context is disposed');
      // The queue can outlive the context the caller acted on.
      if (options.beforeDispatch?.() === false)
        return droppedOutcome('The report context changed while queued.');
      // Same refusal as a capture that went stale while being delivered: the
      // action is never rebased onto the version that exists now.
      const stale = this.registry.revalidate(capture);
      if (stale)
        throw new Error(
          `The report or designer changed while the action was being delivered: ${stale}.`,
        );
      started = true;
      return await this.execute(intent, capture, sequence);
    } finally {
      this.queued.delete(entry);
      if (!started) {
        // Never reached the designer: only the capture made at call time remains.
        this.registry.settle(capture);
        this.actions.delete(capture.requestId);
        if (!this.disposed) this.changed.fire();
      }
      // A superseded entry never owned the designer: it frees its place in the
      // chain only once everything before it did.
      if (started) release();
      else void previous.then(release);
    }
  }

  /** Open only the captured document, and never borrow another report's panel. */
  private async execute(
    intent: NativeIntent,
    initial: CapturedAction,
    sequence: number,
  ): Promise<ActionOutcomeMessage> {
    let capture = initial;
    let outcomeSubscription: vscode.Disposable | undefined;
    let termination: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let session: DocumentSession | undefined;
    try {
      if (capture.viewId === null) {
        await Promise.race([
          vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.parse(capture.uri),
            'rdlcCode.designer',
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Opening the report designer timed out.')),
              15_000,
            );
          }),
        ]);
        clearTimeout(timer);
        this.requireCurrent(capture);
      }
      const deadline = Date.now() + 15_000;
      let view = capture.viewId ? this.views.get(capture.viewId) : undefined;
      while (!view?.session.isReady) {
        this.requireCurrent(capture);
        if (Date.now() >= deadline)
          throw new Error('The report designer did not become ready.');
        if (capture.viewId === null) {
          const viewId = this.registry.context().viewId;
          if (viewId) {
            const bound = this.registry.bind(capture, viewId);
            if (!bound.ok)
              throw new Error(
                `The opened designer cannot be bound: ${bound.reason}.`,
              );
            capture = bound.capture;
            view = this.views.get(viewId);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      this.requireCurrent(capture);
      this.publishContext();
      const boundView = view;
      session = boundView.session;
      const result = new Promise<ActionOutcomeMessage>((resolve, reject) => {
        outcomeSubscription = boundView.session.onActionOutcome((outcome) => {
          if (outcome.requestId === capture.requestId) resolve(outcome);
        });
        termination = this.registry.onDidTerminate((event) => {
          if (event.capture.requestId === capture.requestId)
            reject(new Error(`Report action ended: ${event.reason}.`));
        });
        timer = setTimeout(
          () =>
            reject(new Error('The report designer did not settle the action.')),
          30_000,
        );
      });
      // Attach a rejection handler before delivery can yield to disposal/timeout.
      void result.catch(() => {});
      const delivered = await boundView.session.dispatchNativeAction(
        {
          ...intent,
          protocol: 2,
          kind: 'nativeAction',
          requestId: capture.requestId,
          documentLifetimeId: capture.documentId,
          uri: capture.uri,
          baseVersion: capture.baseVersion,
          viewId: capture.viewId,
          contextGeneration: capture.contextGeneration,
          capability: intent.action,
          targetIds: [...capture.targetIds],
        },
        () => this.registry.revalidate(capture) === null,
        async (message) => boundView.panel.webview.postMessage(message),
      );
      if (!delivered.delivered) throw new Error(delivered.reason);
      const outcome = await result;
      // A native insert hands keyboard focus to the panel that accepted it so the
      // designer can focus the new element's first inspector field (FR-017). The
      // webview never gets OS focus while the native tree keeps it. Selection,
      // clipboard and other actions leave focus where the user put it. The
      // handoff never delays the outcome: settlement and announcement come first.
      if (intent.action === 'create' && outcome.status === 'accepted')
        this.focusDesigner(boundView, capture, sequence);
      return outcome;
    } catch (error) {
      session?.cancelNativeAction(
        capture.requestId,
        error instanceof Error
          ? error.message
          : 'The native report action was cancelled.',
      );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      outcomeSubscription?.dispose();
      termination?.();
      this.registry.settle(capture);
      this.actions.delete(capture.requestId);
      if (!this.disposed) this.changed.fire();
    }
  }

  /**
   * Best effort and fire-and-forget: the accepted mutation stands even if the
   * focus handoff fails. The outcome can arrive long after the dispatch, so focus
   * moves only while the user is still on the captured view and document, no
   * later native action was dispatched, and the window itself has focus.
   */
  private focusDesigner(
    view: { document: vscode.TextDocument; panel: vscode.WebviewPanel },
    capture: CapturedAction,
    sequence: number,
  ): void {
    // The panel wait can last seconds: every guard is re-checked right before
    // focus actually moves.
    const wanted = (): boolean => {
      if (this.disposed || sequence !== this.dispatchSequence) return false;
      const context = this.registry.context();
      return (
        context.viewId === capture.viewId &&
        context.documentId === capture.documentId &&
        vscode.window.state.focused
      );
    };
    if (!wanted()) return;
    try {
      activateHistoryTarget(view.document, view.panel, undefined, wanted).catch(
        () => {
          // Focus is a convenience; never report an applied creation as failed.
        },
      );
    } catch {
      // Same: a synchronous failure must not fail the accepted creation.
    }
  }

  async openSource(targetId: string): Promise<void> {
    const captured = this.registry.capture(`source-${randomUUID()}`, 'source', [
      targetId,
    ]);
    if (!captured.ok)
      throw new Error(`Source access is unavailable: ${captured.reason}.`);
    const capture = captured.capture;
    try {
      const document = [...this.documents.entries()].find(
        ([, record]) => record.id === capture.documentId,
      )?.[0];
      const node = this.evaluation?.syntax.root;
      const find = (entry: typeof node): typeof node =>
        entry?.id === targetId
          ? entry
          : entry?.children.map(find).find(Boolean);
      const target = find(node);
      if (!document || !target)
        throw new Error('The source target is no longer available.');
      this.requireCurrent(capture);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      this.requireCurrent(capture);
      const range = new vscode.Range(
        document.positionAt(target.range.start),
        document.positionAt(target.range.end),
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(
        range,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    } finally {
      this.registry.settle(capture);
    }
  }

  private requireCurrent(capture: CapturedAction): void {
    const reason = this.registry.revalidate(capture);
    if (reason)
      throw new Error(
        `The captured report action is no longer current: ${reason}.`,
      );
  }

  /** True when the active tab group shows this panel's document, or shows no tab. */
  private agreesWithActiveTab(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
  ): boolean {
    const group = vscode.window.tabGroups.activeTabGroup;
    const input = group.activeTab?.input;
    if (!group.activeTab) return true;
    return (
      input instanceof vscode.TabInputCustom &&
      input.viewType === 'rdlcCode.designer' &&
      group.viewColumn === panel.viewColumn &&
      input.uri.toString() === document.uri.toString()
    );
  }

  /** Resolve the active tab, including custom tabs with no active TextEditor. */
  refreshFocus(): void {
    if (this.disposed) return;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) {
      this.registry.focusOther();
      this.publishContext();
      return;
    }
    const input = tab.input;
    if (
      input instanceof vscode.TabInputCustom &&
      input.viewType === 'rdlcCode.designer'
    ) {
      // Tab events can precede the panel's own `active` flag, so the active tab's
      // input and group identify the view; panel.active only breaks ties.
      const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
      const candidates = [...this.views.entries()].filter(
        ([, entry]) =>
          !entry.document.isClosed &&
          entry.panel.viewColumn === column &&
          entry.document.uri.toString() === input.uri.toString(),
      );
      const view =
        candidates.find(([, entry]) => entry.panel.active) ?? candidates[0];
      if (view) this.registry.focusView(view[0]);
      else {
        // The public openWith tab may activate before its provider registers the panel.
        const document = vscode.workspace.textDocuments.find(
          (entry) =>
            !entry.isClosed && entry.uri.toString() === input.uri.toString(),
        );
        if (document) this.registry.focusDocument(this.accept(document).id);
        else this.registry.focusOther();
      }
    } else if (input instanceof vscode.TabInputText) {
      const document = vscode.workspace.textDocuments.find(
        (entry) =>
          !entry.isClosed && entry.uri.toString() === input.uri.toString(),
      );
      if (document && this.isReport(document))
        this.registry.focusDocument(this.accept(document).id);
      else this.registry.focusOther();
    } else this.registry.focusOther();
    this.publishContext();
  }

  private isReport(document: vscode.TextDocument): boolean {
    if (this.documents.has(document) || /\.rdlc$/i.test(document.uri.path))
      return true;
    if (!document.isUntitled || document.languageId !== 'xml') return false;
    if (!/<(?:[^<>\s/:]+:)?Report(?:[\s/>])/.test(document.getText()))
      return false;
    const root = evaluateReport(snapshotOf(document)).syntax.root;
    return root?.expandedName.localName === 'Report';
  }

  private accept(document: vscode.TextDocument, accepted?: ReportEvaluation) {
    const uri = document.uri.toString();
    let record = this.documents.get(document);
    if (
      record &&
      record.uri === uri &&
      record.evaluation.snapshot.version === document.version &&
      !accepted
    )
      return record;
    const evaluation =
      accepted?.snapshot.version === document.version &&
      accepted.snapshot.uri === uri
        ? accepted
        : evaluateReport(snapshotOf(document));
    if (!record) {
      record = {
        id: this.registry.openDocument(document, uri, document.version),
        uri,
        evaluation,
      };
      this.documents.set(document, record);
    } else if (record.uri !== uri) {
      this.registry.retarget(record.id, uri, document.version);
      record.uri = uri;
    } else this.registry.documentChanged(record.id, document.version);
    record.evaluation = evaluation;
    this.registry.setEvaluation(record.id, {
      version: evaluation.snapshot.version,
      state: evaluation.projection.status,
      targets: evaluation.ids,
      sourceTargets: evaluation.sourceIds,
      capabilities: [
        'inspect',
        'source',
        'select',
        ...(evaluation.projection.status === 'editable'
          ? ['properties', 'create']
          : []),
        ...evaluation.capabilities,
      ],
    });
    return record;
  }

  private publishContext(): void {
    if (this.disposed) return;
    const context = this.registry.context();
    for (const [viewId, view] of this.views) {
      const record = this.documents.get(view.document);
      if (record && !view.document.isClosed)
        view.session.setViewIdentity({
          viewId,
          documentLifetimeId: record.id,
          contextGeneration: context.generation,
        });
    }
    const signature = JSON.stringify(context);
    if (signature === this.previousContext) return;
    this.previousContext = signature;
    this.changed.fire();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const panel of this.panels) panel.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.views.clear();
    this.actions.clear();
    this.documents.clear();
    this.registry.dispose();
    this.changed.dispose();
  }
}
