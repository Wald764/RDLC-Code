import * as vscode from 'vscode';
import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { ClientMessage, HostMessage } from '@rdlc/report-model/protocol';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { ReportProjection } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';
import { projectStructure } from '@rdlc/renderer/structure';
import { validateMessage } from '@rdlc/report-model/protocol';
import { DocumentBinding } from './protocol.js';
import { planTextboxIntent, correlateTargets } from './edit-controller.js';
import { PasteCounter, runClipboard, WindowClipboard } from './clipboard.js';

/** One retained capture per extension host, i.e. per VS Code window. */
export const windowClipboard = new WindowClipboard(vscode.env.clipboard);

function nodes(node: XmlNode | null): XmlNode[] {
  return node ? [node, ...node.children.flatMap(nodes)] : [];
}

/** Locate the host-named creation in the accepted result so the designer can select it. */
function createdIn(
  root: XmlNode | null,
  created: { readonly element: string; readonly name: string },
): { created?: { id: string; name: string } } {
  const node = nodes(root).find(
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

function snapshotOf(document: vscode.TextDocument): DocumentSnapshot {
  return {
    uri: document.uri.toString(),
    version: document.version,
    source: document.getText(),
    eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
  };
}

/** One host session per open custom-editor document; the webview never owns source. */
export class DocumentSession {
  // Views of the same TextDocument share a queue, including while applyEdit is pending.
  private static readonly queues = new WeakMap<
    vscode.TextDocument,
    Promise<void>
  >();
  private disposed = false;
  private readonly binding: DocumentBinding;
  private readonly emitter = new vscode.EventEmitter<HostMessage>();
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Successful pastes in this destination view, per capture generation. */
  private readonly pastes = new PasteCounter();
  readonly onMessage = this.emitter.event;

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly applyWorkspaceEdit = vscode.workspace.applyEdit,
    private readonly clipboard = windowClipboard,
    private readonly activateHistoryTarget?: () => Promise<boolean>,
  ) {
    const current = this.evaluate();
    this.binding = new DocumentBinding(
      document.uri.toString(),
      document.version,
      current.ids,
      current.capabilities,
      current.sourceIds,
    );
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== document.uri.toString()) return;
        this.sync();
        void this.publish();
      }),
    );
  }

  private evaluate(): {
    snapshot: DocumentSnapshot;
    projection: ReportProjection;
    syntax: ReturnType<typeof parse>;
    ids: readonly string[];
    sourceIds: readonly string[];
    capabilities: readonly string[];
  } {
    const snapshot = snapshotOf(this.document);
    const syntax = parse(snapshot);
    const projection = projectReport(syntax);
    return {
      snapshot,
      projection,
      syntax,
      ids: [
        ...(syntax.root ? [syntax.root.id] : []),
        ...projection.textboxes.map((textbox) => textbox.node.id),
        ...projection.datasets.flatMap((dataset) => [
          dataset.node.id,
          ...dataset.fields.map((field) => field.node.id),
        ]),
        ...projection.tables.flatMap((table) => [
          table.node.id,
          ...table.groups.map((group) => group.node.id),
        ]),
      ],
      sourceIds: nodes(syntax.root).map((node) => node.id),
      capabilities:
        projection.status === 'editable'
          ? ['setProperty', 'author', 'layout', 'clipboard']
          : [],
    };
  }

  private sync(): void {
    const current = this.evaluate();
    this.binding.update(
      current.snapshot.version,
      current.ids,
      current.capabilities,
      current.sourceIds,
    );
  }

  private async publish(): Promise<void> {
    const { snapshot, projection, syntax } = this.evaluate();
    let message: HostMessage & { kind: 'snapshot' } = {
      protocol: 1,
      kind: 'snapshot',
      version: snapshot.version,
      sourceLength: snapshot.source.length,
      structure: projectStructure(syntax, projection),
      projection: {
        status: projection.status,
        capabilities: projection.capabilities,
        diagnostics: projection.diagnostics,
      },
      scene: renderScene(projection),
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
    while (!validateMessage(message) && message.structure?.nodes.length) {
      message = {
        ...message,
        structure: {
          nodes: message.structure.nodes.slice(
            0,
            Math.floor(message.structure.nodes.length / 2),
          ),
          truncated: true,
        },
      };
    }
    if (validateMessage(message)) this.emitter.fire(message);
    else
      this.emitter.fire({
        protocol: 1,
        kind: 'snapshot',
        version: snapshot.version,
        sourceLength: snapshot.source.length,
        structure: { nodes: [], truncated: true },
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
    const historyBusy =
      DocumentSession.queues.has(this.document) &&
      validateMessage(input)?.kind === 'history';
    const previous =
      DocumentSession.queues.get(this.document) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (this.disposed || this.document.isClosed) return;
      try {
        this.sync();
        await this.handle(input, historyBusy);
      } catch {
        this.emitter.fire({
          protocol: 1,
          kind: 'protocolError',
          supportedVersion: 1,
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
        await vscode.commands.executeCommand(
          message.action === 'undo' ? 'undo' : 'redo',
        );
        accepted = true;
      }
    } catch {
      reason =
        'Native history failed. The actual current document is shown; inspect Code XML.';
    }
    if (this.disposed || this.document.isClosed) return;
    this.sync();
    await this.publish();
    this.emitter.fire({
      protocol: 1,
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
    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.document.uri,
      'default',
    );
    const target = message.targetId;
    if (!target) return;
    // Any element, including preservation-only content without bounds, is navigable.
    const node = nodes(this.evaluate().syntax.root).find(
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

  private async applyEdit(
    message: ClientMessage & { kind: 'edit' },
  ): Promise<void> {
    const current = this.evaluate();
    const outcome = planTextboxIntent(
      current.snapshot,
      current.syntax,
      current.projection,
      message,
    );
    if (!outcome.ok) {
      this.emitter.fire({
        protocol: 1,
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
        protocol: 1,
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
    );
    this.emitter.fire({
      protocol: 1,
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
  ): Promise<{
    accepted: boolean;
    reason: string;
    version: number;
    syntax: ReturnType<typeof parse>;
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
    if (this.document.version !== baseVersion || this.disposed) {
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
    const result = await runClipboard(
      this.clipboard,
      {
        version: () => this.document.version,
        evaluate: () => this.evaluate(),
        commit: async (plan, candidate, baseVersion, starts) => {
          const committed = await this.commit(plan, candidate, baseVersion);
          const inserted = nodes(committed.syntax.root)
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
      protocol: 1,
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
    for (const subscription of this.subscriptions) subscription.dispose();
    this.emitter.dispose();
  }
}
