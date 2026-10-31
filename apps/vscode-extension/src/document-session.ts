import * as vscode from 'vscode';
import type {
  AcceptedSelectionMessage,
  ActionOutcomeMessage,
  ClientMessage,
  HostMessage,
  NativeActionMessage,
  ViewIdentity,
} from '@rdlc/report-model/protocol';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { projectStructure } from '@rdlc/renderer/structure';
import { validateMessage } from '@rdlc/report-model/protocol';
import { DocumentBinding } from './protocol.js';
import { settleHistoryChange } from './history-settle.js';
import { planTextboxIntent, correlateTargets } from './edit-controller.js';
import { PasteCounter, runClipboard, WindowClipboard } from './clipboard.js';
import {
  evaluateReport,
  snapshotOf,
  syntaxNodes,
  type ReportEvaluation,
} from './report-evaluation.js';

/** One retained capture per extension host, i.e. per VS Code window. */
export const windowClipboard = new WindowClipboard(vscode.env.clipboard);

/** Locate the host-named creation in the accepted result so the designer can select it. */
function createdIn(
  root: XmlNode | null,
  created: { readonly element: string; readonly name: string },
): { created?: { id: string; name: string } } {
  const node = syntaxNodes(root).find(
    (candidate) =>
      candidate.expandedName.localName === created.element &&
      candidate.attributes.some(
        (attribute) =>
          attribute.expandedName.localName === 'Name' &&
          attribute.value === created.name,
      ),
  );
  return node ? { created: { id: node.id, name: created.name } } : {};
}

/** One host session per open custom-editor document; the webview never owns source. */
export type NativeDispatchResult =
  | { readonly delivered: true; readonly message: NativeActionMessage }
  | {
      readonly delivered: false;
      readonly reason: string;
      readonly outcome?: ActionOutcomeMessage;
    };

export class DocumentSession {
  // Views of the same TextDocument share a queue, including while applyEdit is pending.
  private static readonly queues = new WeakMap<
    vscode.TextDocument,
    Promise<void>
  >();
  private disposed = false;
  private readonly binding: DocumentBinding;
  private readonly emitter = new vscode.EventEmitter<HostMessage>();
  private readonly evaluationEmitter =
    new vscode.EventEmitter<ReportEvaluation>();
  private readonly selectionEmitter =
    new vscode.EventEmitter<AcceptedSelectionMessage>();
  private readonly outcomeEmitter =
    new vscode.EventEmitter<ActionOutcomeMessage>();
  private readonly reportedOutcomes = new Set<string>();
  private readonly nativeAuthority = new Map<
    string,
    { action: NativeActionMessage; revalidate: () => boolean }
  >();
  private readonly nativeAcceptedVersions = new Map<string, number>();
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Successful pastes in this destination view, per capture generation. */
  private readonly pastes = new PasteCounter();
  private accepted?: ReportEvaluation;
  private publishedVersion: number | null = null;
  private selection?: AcceptedSelectionMessage;
  readonly onMessage = this.emitter.event;
  /** Accepted content changes for native consumers; no webview is required. */
  readonly onEvaluation = this.evaluationEmitter.event;
  /** Last accepted designer selection, for host-side cue restoration. */
  readonly onSelection = this.selectionEmitter.event;
  /** Terminal native-action outcomes, including host-side invalidation. */
  readonly onActionOutcome = this.outcomeEmitter.event;
  get currentSelection(): AcceptedSelectionMessage | null {
    return this.selection ?? null;
  }
  get isReady(): boolean {
    return (
      !this.disposed &&
      !this.document.isClosed &&
      this.binding.isReady &&
      this.publishedVersion === this.document.version
    );
  }
  /** Current accepted facts for consumers that attach after construction. */
  get evaluation(): ReportEvaluation {
    return this.accepted ?? this.evaluate();
  }

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly applyWorkspaceEdit = vscode.workspace.applyEdit,
    private readonly clipboard = windowClipboard,
    private readonly activateHistoryTarget?: () => Promise<boolean>,
    private readonly revealSource = (uri: vscode.Uri): Thenable<unknown> =>
      vscode.commands.executeCommand('vscode.openWith', uri, 'default'),
  ) {
    const current = this.evaluate();
    this.binding = new DocumentBinding(
      document.uri.toString(),
      document.version,
      current.ids,
      current.capabilities,
      current.sourceIds,
    );
    this.bindSelectionTargets(current);
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== document.uri.toString()) return;
        this.sync();
        void this.publish();
      }),
    );
  }

  private evaluate(): ReportEvaluation {
    if (
      this.accepted?.snapshot.version === this.document.version &&
      this.accepted.snapshot.uri === this.document.uri.toString()
    )
      return this.accepted;
    const current = evaluateReport(snapshotOf(this.document));
    const previous = this.accepted;
    this.accepted = current;
    if (
      previous &&
      (previous.snapshot.version !== current.snapshot.version ||
        previous.snapshot.source !== current.snapshot.source)
    )
      this.evaluationEmitter.fire(current);
    return current;
  }

  private sync(): void {
    const current = this.evaluate();
    this.binding.update(
      current.snapshot.version,
      current.ids,
      current.capabilities,
      current.sourceIds,
    );
    this.bindSelectionTargets(current);
  }

  private bindSelectionTargets(evaluation: ReportEvaluation): void {
    this.binding.setSelectionTargets(
      (evaluation.scene?.items ?? [])
        .filter((item) => item.kind !== 'cell')
        .map((item) => item.id),
      (evaluation.scene?.items ?? [])
        .filter((item) => item.kind === 'cell')
        .map((item) => item.xmlCellId ?? item.id),
    );
  }

  /** Bind or renew this panel once; generations only move forward. */
  setViewIdentity(identity: ViewIdentity): boolean {
    if (this.disposed || this.document.isClosed) return false;
    const previous = this.binding.viewIdentity;
    if (
      previous?.viewId === identity.viewId &&
      previous.documentLifetimeId === identity.documentLifetimeId &&
      previous.contextGeneration === identity.contextGeneration
    )
      return true;
    if (!this.binding.bindView(identity)) return false;
    if (previous && previous.contextGeneration !== identity.contextGeneration)
      this.invalidateNative(
        'The designer context changed; the pending action was not applied.',
      );
    void this.publish();
    return true;
  }

  /**
   * Deliver a host-captured native action outside the document queue. The draft
   * guard lives in the designer, so waiting for it must not block document edits.
   */
  async dispatchNativeAction(
    input: unknown,
    revalidate: () => boolean,
    deliver: (message: NativeActionMessage) => Promise<boolean>,
  ): Promise<NativeDispatchResult> {
    if (this.disposed || this.document.isClosed)
      return {
        delivered: false,
        reason: 'The designer is no longer available.',
      };
    this.sync();
    if (!revalidate())
      return {
        delivered: false,
        reason: 'The captured report context is no longer current.',
      };
    const dispatched = this.binding.dispatchNativeAction(input);
    if (!dispatched.ok) return { delivered: false, reason: dispatched.reason };
    const message = dispatched.message;
    this.nativeAuthority.set(message.requestId, {
      action: message,
      revalidate,
    });
    let accepted = false;
    try {
      accepted = await deliver(message);
    } catch {
      accepted = false;
    }
    if (!accepted)
      return this.refuseNative(
        message.requestId,
        'The designer did not accept the action.',
      );
    const view = this.binding.viewIdentity;
    if (
      this.nativeAcceptedVersions.get(message.requestId) ===
        this.document.version &&
      !this.disposed &&
      !this.document.isClosed &&
      message.uri === this.document.uri.toString() &&
      view?.viewId === message.viewId &&
      view.documentLifetimeId === message.documentLifetimeId
    )
      return { delivered: true, message };
    if (
      !revalidate() ||
      this.disposed ||
      this.document.isClosed ||
      this.document.version !== message.baseVersion ||
      !view ||
      view.viewId !== message.viewId ||
      view.documentLifetimeId !== message.documentLifetimeId ||
      view.contextGeneration !== message.contextGeneration
    )
      return this.refuseNative(
        message.requestId,
        'The report or designer changed while the action was being delivered.',
      );
    return { delivered: true, message };
  }

  private refuseNative(
    requestId: string,
    reason: string,
  ): NativeDispatchResult {
    const outcome = this.binding.failNativeDelivery(requestId, reason);
    if (outcome) {
      this.reportOutcome(outcome);
      this.emitter.fire({
        protocol: 2,
        kind: 'nativeCancel',
        requestId,
        baseVersion: outcome.baseVersion,
        reason,
      });
    }
    return {
      delivered: false,
      reason: outcome?.reason ?? reason,
      ...(outcome ? { outcome } : {}),
    };
  }

  private invalidateNative(reason: string): void {
    for (const outcome of this.binding.invalidateNative(reason)) {
      this.reportOutcome(outcome);
      this.emitter.fire({
        protocol: 2,
        kind: 'nativeCancel',
        requestId: outcome.requestId,
        baseVersion: outcome.baseVersion,
        reason,
      });
    }
  }

  cancelNativeAction(requestId: string, reason: string): void {
    this.refuseNative(requestId, reason);
  }

  private reportOutcome(outcome: ActionOutcomeMessage): void {
    if (this.reportedOutcomes.has(outcome.requestId)) return;
    this.reportedOutcomes.add(outcome.requestId);
    const authority = this.nativeAuthority.get(outcome.requestId);
    if (authority) authority.revalidate = () => false;
    this.outcomeEmitter.fire(outcome);
  }

  private async publish(): Promise<void> {
    const { snapshot, projection, syntax, navigation, scene } = this.evaluate();
    let message: HostMessage & { kind: 'snapshot' } = {
      protocol: 2,
      kind: 'snapshot',
      version: snapshot.version,
      sourceLength: snapshot.source.length,
      ...(this.binding.viewIdentity
        ? { viewBinding: this.binding.viewIdentity }
        : {}),
      structure: projectStructure(syntax, projection),
      navigation,
      projection: {
        status: projection.status,
        capabilities: projection.capabilities,
        diagnostics: projection.diagnostics,
      },
      scene,
      authoring:
        syntax.root && projection.section?.page
          ? {
              id: syntax.root.id,
              page: {
                ...projection.section.page,
                bodyWidth: projection.section.width ?? '',
                bodyHeight: projection.section.height ?? '',
              },
              datasets: projection.datasets.map((dataset) => ({
                id: dataset.node.id,
                name: dataset.name,
                fields: dataset.fields.map((field) => ({
                  id: field.node.id,
                  name: field.name,
                  type: field.type,
                })),
              })),
              tables: projection.tables.map((table) => ({
                id: table.node.id,
                name: table.name,
                dataset: table.dataset,
                structural: table.structural,
                reason: table.blockedReason,
                columns: table.columns.length,
                rows: table.rows.map((row) => ({
                  cells: row.cells.map((cell) => ({
                    id: cell.textbox?.node.id ?? cell.node.id,
                    text: cell.textbox?.value?.text ?? '',
                  })),
                  total: row.cells.some((cell) =>
                    table.totals.some((total) => total.cell === cell),
                  ),
                })),
                groups: table.groups.map((group) => ({
                  id: group.node.id,
                  name: group.name,
                  expression: group.expressions[0] ?? '',
                })),
              })),
            }
          : null,
    };
    // Use the remaining transport budget; never enlarge the existing envelope limits.
    while (
      !validateMessage(message) &&
      (message.structure?.nodes.length ||
        message.navigation?.structure.nodes.length ||
        message.navigation?.data.nodes.length)
    ) {
      message = {
        ...message,
        structure: {
          nodes: (message.structure?.nodes ?? []).slice(
            0,
            Math.floor((message.structure?.nodes.length ?? 0) / 2),
          ),
          truncated: true,
        },
        navigation: {
          version: snapshot.version,
          structure: {
            nodes: (message.navigation?.structure.nodes ?? []).slice(
              0,
              Math.floor((message.navigation?.structure.nodes.length ?? 0) / 2),
            ),
            truncated: true,
          },
          data: {
            nodes: (message.navigation?.data.nodes ?? []).slice(
              0,
              Math.floor((message.navigation?.data.nodes.length ?? 0) / 2),
            ),
            truncated: true,
          },
        },
      };
    }
    this.publishedVersion = snapshot.version;
    if (validateMessage(message)) this.emitter.fire(message);
    else
      this.emitter.fire({
        protocol: 2,
        kind: 'snapshot',
        version: snapshot.version,
        sourceLength: snapshot.source.length,
        structure: { nodes: [], truncated: true },
        ...(this.binding.viewIdentity
          ? { viewBinding: this.binding.viewIdentity }
          : {}),
        navigation: {
          version: snapshot.version,
          structure: { nodes: [], truncated: true },
          data: { nodes: [], truncated: true },
        },
        scene: null,
        projection: {
          status: 'source-only',
          capabilities: [],
          diagnostics: [
            {
              code: 'TRANSPORT_BUDGET',
              category: 'unsupported',
              severity: 'warning',
              range: { start: 0, end: 0 },
              message: 'Report exceeds the designer transport budget.',
              correctiveAction: 'Open Code XML to inspect the report.',
              blockedOperations: ['visual-edit'],
            },
          ],
        },
      });
  }

  receive(input: unknown): void {
    if (this.disposed) return;
    const parsed = validateMessage(input);
    const kind = parsed?.kind;
    // Focus probe answers belong to the panel activation awaiting them.
    if (kind === 'focusProbeResult') return;
    if (
      parsed &&
      (parsed.kind === 'acceptedSelection' || parsed.kind === 'actionOutcome')
    ) {
      const requestId = parsed.requestId;
      const capture = requestId
        ? this.nativeAuthority.get(requestId)?.action
        : undefined;
      const newerVersion =
        parsed.kind === 'acceptedSelection'
          ? parsed.version
          : parsed.resultVersion;
      if (
        requestId &&
        (parsed.kind === 'acceptedSelection' || parsed.status === 'accepted') &&
        (!capture ||
          (newerVersion !== capture.baseVersion &&
            this.nativeAcceptedVersions.get(requestId) !== newerVersion))
      ) {
        this.emitter.fire({
          protocol: 2,
          kind: 'protocolError',
          supportedVersion: 2,
          reason: 'The native result has no matching accepted mutation.',
        });
        return;
      }
      // These settle designer state; never queue them behind document mutations.
      const result =
        kind === 'acceptedSelection'
          ? this.binding.receiveSelection(input)
          : this.binding.receiveOutcome(input);
      if (!result.ok) {
        // Stale selections and duplicate outcomes are benign: change nothing, block nothing.
        if (result.ignored) return;
        this.emitter.fire({
          protocol: 2,
          kind: 'protocolError',
          supportedVersion: 2,
          reason: result.reason,
        });
      } else if (kind === 'acceptedSelection') {
        this.selection = result.message as AcceptedSelectionMessage;
        this.selectionEmitter.fire(result.message as AcceptedSelectionMessage);
      } else {
        this.reportOutcome(result.message as ActionOutcomeMessage);
      }
      return;
    }
    const historyBusy =
      DocumentSession.queues.has(this.document) && kind === 'history';
    const previous =
      DocumentSession.queues.get(this.document) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (this.disposed || this.document.isClosed) return;
      try {
        this.sync();
        await this.handle(input, historyBusy);
      } catch {
        this.emitter.fire({
          protocol: 2,
          kind: 'protocolError',
          supportedVersion: 2,
          reason:
            'Document operation failed; inspect the current source before retrying.',
        });
        await this.publish();
      }
    });
    DocumentSession.queues.set(this.document, next);
    void next.finally(() => {
      if (DocumentSession.queues.get(this.document) === next)
        DocumentSession.queues.delete(this.document);
    });
  }

  private async handle(input: unknown, historyBusy = false): Promise<void> {
    const result = this.binding.receive(input);
    if (!result.ok) {
      this.emitter.fire(result.error);
      return;
    }
    const message = result.message;
    if (message.kind === 'ready') {
      await this.publish();
      return;
    }
    if (message.kind === 'openSource') {
      await this.openSource(message);
      return;
    }
    if (message.kind === 'clipboard') {
      await this.runClipboard(message);
      return;
    }
    if (message.kind === 'history') {
      await this.history(message, historyBusy);
      return;
    }
    await this.applyEdit(message);
  }

  private async history(
    message: ClientMessage & { kind: 'history' },
    busy: boolean,
  ): Promise<void> {
    const before = this.document.version;
    let accepted = false;
    let foreignChanged = false;
    let reason = '';
    try {
      if (busy)
        reason =
          'Another report operation was pending. Wait for it to finish before invoking history.';
      else if (
        !vscode.workspace.isTrusted ||
        vscode.workspace.fs.isWritableFileSystem(this.document.uri.scheme) ===
          false
      )
        reason =
          'Native history is unavailable in this read-only or restricted document.';
      else if (
        !this.activateHistoryTarget ||
        !(await this.activateHistoryTarget())
      )
        reason =
          'Cannot verify the originating designer. Focus this report and try again.';
      else if (
        this.disposed ||
        this.document.isClosed ||
        this.document.version !== message.baseVersion
      )
        reason =
          'The report changed while activating history; no command was executed.';
      else {
        const forThisDocument = (document: vscode.TextDocument): boolean =>
          document.uri.toString() === this.document.uri.toString();
        // Last line of defence: activation attests this designer owns DOM
        // focus, but if the workbench still routed the command to another
        // document, say so instead of reporting a successful history step.
        // Only user documents count (not output, SCM inputs, ...), and only
        // when this document did not move: an unrelated document changing
        // while this report's history applied correctly is no misroute.
        const foreign = vscode.workspace.onDidChangeTextDocument((event) => {
          if (
            !forThisDocument(event.document) &&
            event.contentChanges.length &&
            ['file', 'untitled'].includes(event.document.uri.scheme)
          )
            foreignChanged = true;
        });
        try {
          await vscode.commands.executeCommand(
            message.action === 'undo' ? 'undo' : 'redo',
          );
          accepted = true;
          // The workbench may resolve the command before this host's document
          // mirror receives the change: wait for it instead of reporting a
          // no-op for a history step that was applied.
          await settleHistoryChange(
            this.document,
            before,
            (listener) =>
              vscode.workspace.onDidChangeTextDocument((event) => {
                if (forThisDocument(event.document)) listener();
              }),
            (listener) =>
              vscode.workspace.onDidCloseTextDocument((document) => {
                if (forThisDocument(document)) listener();
              }),
          );
        } finally {
          foreign.dispose();
        }
        if (foreignChanged && this.document.version === before) {
          accepted = false;
          reason =
            'Native history changed another document, not this report. Check the open editors before continuing.';
        }
      }
    } catch {
      reason =
        'Native history failed. The actual current document is shown; inspect Code XML.';
    }
    if (this.disposed || this.document.isClosed) return;
    this.sync();
    await this.publish();
    this.emitter.fire({
      protocol: 2,
      kind: 'historyResult',
      requestId: message.requestId,
      baseVersion: message.baseVersion,
      resultVersion: this.document.version,
      action: message.action,
      accepted,
      changed: this.document.version !== before,
      ...(reason ? { reason } : {}),
    });
  }

  private async openSource(
    message: ClientMessage & { kind: 'openSource' },
  ): Promise<void> {
    const version = this.document.version;
    const uri = this.document.uri.toString();
    const identity = this.binding.viewIdentity;
    await this.revealSource(this.document.uri);
    // Opening is asynchronous: the accepted document may have changed meanwhile.
    if (
      this.disposed ||
      this.document.isClosed ||
      this.document.uri.toString() !== uri ||
      this.binding.viewIdentity?.viewId !== identity?.viewId ||
      this.binding.viewIdentity?.documentLifetimeId !==
        identity?.documentLifetimeId ||
      this.binding.viewIdentity?.contextGeneration !==
        identity?.contextGeneration ||
      this.document.version !== version ||
      this.document.version !== message.version
    ) {
      if (!this.disposed && !this.document.isClosed) {
        this.sync();
        await this.publish();
      }
      return;
    }
    const target = message.targetId;
    if (!target) return;
    // Any element, including preservation-only content without bounds, is navigable.
    const node = syntaxNodes(this.evaluate().syntax.root).find(
      (candidate) => candidate.id === target,
    );
    if (!node) return;
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      editor.document.uri.toString() !== this.document.uri.toString()
    )
      return;
    const range = new vscode.Range(
      this.document.positionAt(node.range.start),
      this.document.positionAt(node.range.end),
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range);
  }

  private authorizeNativeMutation(
    message: Extract<ClientMessage, { kind: 'edit' | 'clipboard' }>,
  ): { ok: true } | { ok: false; reason: string } {
    const captured = message.nativeRequestId
      ? this.nativeAuthority.get(message.nativeRequestId)
      : undefined;
    const action = captured?.action;
    const refuse = {
      ok: false as const,
      reason: 'The native action no longer authorizes this operation.',
    };
    if (
      !action ||
      !captured?.revalidate() ||
      action.uri !== this.document.uri.toString() ||
      action.baseVersion !== message.baseVersion
    )
      return refuse;
    let matches = false;
    if (message.kind === 'clipboard') {
      matches =
        action.action === 'clipboard' &&
        action.clipboard === message.action &&
        (message.action === 'paste' ||
          JSON.stringify(action.targetIds) ===
            JSON.stringify(message.targetIds));
    } else if (message.operation === 'author') {
      if (action.action === 'create') {
        const creation = {
          textbox: 'createTextbox',
          table: 'createTable',
          dataset: 'createDataset',
        }[action.create];
        matches =
          message.payload.action === creation &&
          message.targetId === this.evaluation.syntax.root?.id;
      } else if (action.action === 'author') {
        matches =
          message.targetId === action.targetIds[0] &&
          JSON.stringify(message.payload) === JSON.stringify(action.payload);
      }
    }
    return matches
      ? this.binding.authorizeNativeEdit(
          message.nativeRequestId!,
          message.baseVersion,
        )
      : refuse;
  }

  private async applyEdit(
    message: ClientMessage & { kind: 'edit' },
  ): Promise<void> {
    const current = this.evaluate();
    if (message.nativeRequestId) {
      const authorized = this.authorizeNativeMutation(message);
      if (!authorized.ok) {
        this.emitter.fire({
          protocol: 2,
          kind: 'editResult',
          baseVersion: message.baseVersion,
          changed: false,
          mappings: [],
          version: current.snapshot.version,
          requestId: message.requestId,
          accepted: false,
          reason: authorized.reason,
          diagnostics: [],
        });
        await this.publish();
        return;
      }
    }
    const outcome = planTextboxIntent(
      current.snapshot,
      current.syntax,
      current.projection,
      message,
    );
    if (!outcome.ok) {
      this.emitter.fire({
        protocol: 2,
        kind: 'editResult',
        baseVersion: message.baseVersion,
        changed: false,
        mappings: [],
        version: this.document.version,
        requestId: message.requestId,
        accepted: false,
        reason: outcome.diagnostics[0]?.code ?? 'REJECTED',
        diagnostics: outcome.diagnostics,
      });
      await this.publish();
      return;
    }
    if (!outcome.changed) {
      const targets =
        message.operation === 'layout'
          ? message.payload.targetIds
          : [message.targetId];
      this.emitter.fire({
        protocol: 2,
        kind: 'editResult',
        baseVersion: message.baseVersion,
        version: current.snapshot.version,
        requestId: message.requestId,
        accepted: true,
        changed: false,
        mappings: correlateTargets(
          current.syntax,
          current.syntax,
          outcome.plan,
          targets,
        ),
        reason: 'UNCHANGED',
        diagnostics: [],
      });
      await this.publish();
      return;
    }
    const result = await this.commit(
      outcome.plan,
      outcome.candidate,
      message.baseVersion,
      message.nativeRequestId,
    );
    this.emitter.fire({
      protocol: 2,
      kind: 'editResult',
      baseVersion: message.baseVersion,
      changed: result.accepted,
      mappings: result.accepted
        ? correlateTargets(
            current.syntax,
            result.syntax,
            outcome.plan,
            message.operation === 'layout'
              ? message.payload.targetIds
              : [message.targetId],
          )
        : [],
      version: result.version,
      requestId: message.requestId,
      accepted: result.accepted,
      reason: result.accepted ? 'APPLIED' : result.reason,
      diagnostics: [],
      ...(result.accepted && outcome.created
        ? createdIn(result.syntax.root, outcome.created)
        : {}),
    });
  }

  /** One native WorkspaceEdit for a verified candidate; publishes before reporting. */
  private async commit(
    plan: PatchPlan,
    candidate: string,
    baseVersion: number,
    nativeRequestId?: string,
  ): Promise<{
    accepted: boolean;
    reason: string;
    version: number;
    syntax: XmlSyntaxDocument;
  }> {
    // VS Code writes inserted line breaks in the document's EOL; do the same up front
    // so text from a report with other line endings matches the verified candidate.
    const eol = this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const toEol = (text: string) => text.replace(/\r\n|\r|\n/g, eol);
    candidate = toEol(candidate);
    const edits = plan.patches.map((patch) =>
      vscode.TextEdit.replace(
        new vscode.Range(
          this.document.positionAt(patch.start),
          this.document.positionAt(patch.end),
        ),
        toEol(patch.replacement),
      ),
    );
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(this.document.uri, edits);
    if (
      this.document.version !== baseVersion ||
      this.disposed ||
      this.document.isClosed ||
      (nativeRequestId !== undefined &&
        !this.nativeAuthority.get(nativeRequestId)?.revalidate())
    ) {
      await this.publish();
      const actual = this.evaluate();
      return {
        accepted: false,
        reason: 'STALE_EDIT',
        version: actual.snapshot.version,
        syntax: actual.syntax,
      };
    }
    let applied = false;
    let reason = 'REJECTED_BY_HOST';
    try {
      if (
        vscode.workspace.fs.isWritableFileSystem(this.document.uri.scheme) ===
        false
      )
        reason = 'DOCUMENT_READ_ONLY';
      else applied = await this.applyWorkspaceEdit(workspaceEdit);
    } catch {
      reason = 'HOST_EDIT_FAILED';
    }
    // Intervening changes make success uncertain even if someone restores the candidate text.
    const actual = this.evaluate();
    const accepted =
      applied &&
      !this.document.isClosed &&
      actual.snapshot.version === baseVersion + 1 &&
      actual.snapshot.source === candidate;
    if (applied && !accepted) reason = 'DOCUMENT_CHANGED_DURING_APPLY';
    if (accepted && nativeRequestId)
      this.nativeAcceptedVersions.set(nativeRequestId, actual.snapshot.version);
    // Bind the new version before reporting success so the next intent cannot race the change event.
    this.sync();
    await this.publish();
    return {
      accepted,
      reason,
      version: actual.snapshot.version,
      syntax: actual.syntax,
    };
  }

  private async runClipboard(
    message: ClientMessage & { kind: 'clipboard' },
  ): Promise<void> {
    if (message.nativeRequestId) {
      const authorized = this.authorizeNativeMutation(message);
      if (!authorized.ok) {
        this.emitter.fire({
          protocol: 2,
          kind: 'clipboardResult',
          requestId: message.requestId,
          action: message.action,
          baseVersion: message.baseVersion,
          version: this.document.version,
          accepted: false,
          changed: false,
          reason: authorized.reason,
          inserted: [],
          removed: [],
          diagnostics: [],
        });
        await this.publish();
        return;
      }
    }
    const result = await runClipboard(
      this.clipboard,
      {
        version: () =>
          message.nativeRequestId &&
          !this.nativeAuthority.get(message.nativeRequestId)?.revalidate()
            ? -1
            : this.document.version,
        evaluate: () => this.evaluate(),
        commit: async (plan, candidate, baseVersion, starts) => {
          const committed = await this.commit(
            plan,
            candidate,
            baseVersion,
            message.nativeRequestId,
          );
          const inserted = syntaxNodes(committed.syntax.root)
            .filter((node) => starts.includes(node.range.start))
            .map((node) => node.id);
          return { ...committed, inserted };
        },
      },
      this.pastes,
      message,
    );
    if (!result.changed) await this.publish();
    this.emitter.fire({
      protocol: 2,
      kind: 'clipboardResult',
      requestId: message.requestId,
      action: message.action,
      baseVersion: message.baseVersion,
      version:
        result.accepted && !result.changed
          ? message.baseVersion
          : result.version,
      accepted: result.accepted,
      changed: result.changed,
      reason: result.reason,
      inserted: result.inserted,
      removed: result.removed,
      diagnostics: result.diagnostics,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.nativeAuthority.clear();
    this.nativeAcceptedVersions.clear();
    for (const outcome of this.binding.invalidateNative(
      'The designer was closed before the action completed.',
      true,
    ))
      this.outcomeEmitter.fire(outcome);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.emitter.dispose();
    this.evaluationEmitter.dispose();
    this.selectionEmitter.dispose();
    this.outcomeEmitter.dispose();
  }
}
