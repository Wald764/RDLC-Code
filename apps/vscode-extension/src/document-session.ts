import * as vscode from 'vscode';
import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { ClientMessage, HostMessage } from '@rdlc/report-model/protocol';
import type { ReportProjection } from '@rdlc/report-model/report';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';
import { DocumentBinding } from './protocol.js';
import { planTextboxIntent } from './edit-controller.js';

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
  private readonly binding: DocumentBinding;
  private readonly emitter = new vscode.EventEmitter<HostMessage>();
  private readonly subscriptions: vscode.Disposable[] = [];
  readonly onMessage = this.emitter.event;

  constructor(private readonly document: vscode.TextDocument) {
    const current = this.evaluate();
    this.binding = new DocumentBinding(
      document.uri.toString(),
      document.version,
      current.ids,
      current.capabilities,
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
      capabilities:
        projection.status === 'editable' ? ['setProperty', 'author'] : [],
    };
  }

  private sync(): void {
    const current = this.evaluate();
    this.binding.update(
      current.snapshot.version,
      current.ids,
      current.capabilities,
    );
  }

  private async publish(): Promise<void> {
    const { snapshot, projection, syntax } = this.evaluate();
    this.emitter.fire({
      protocol: 1,
      kind: 'snapshot',
      version: snapshot.version,
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
    });
  }

  receive(input: unknown): void {
    void this.handle(input);
  }

  private async handle(input: unknown): Promise<void> {
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
    await this.applyEdit(message);
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
    const textbox = this.evaluate().projection.textboxes.find(
      (candidate) => candidate.node.id === target,
    );
    if (!textbox) return;
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      editor.document.uri.toString() !== this.document.uri.toString()
    )
      return;
    const range = new vscode.Range(
      this.document.positionAt(textbox.node.range.start),
      this.document.positionAt(textbox.node.range.end),
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
        version: this.document.version,
        requestId: message.requestId,
        accepted: false,
        reason: outcome.diagnostics[0]?.code ?? 'REJECTED',
        diagnostics: outcome.diagnostics,
      });
      return;
    }
    const edits = outcome.plan.patches.map((patch) =>
      vscode.TextEdit.replace(
        new vscode.Range(
          this.document.positionAt(patch.start),
          this.document.positionAt(patch.end),
        ),
        patch.replacement,
      ),
    );
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(this.document.uri, edits);
    const accepted = await vscode.workspace.applyEdit(workspaceEdit);
    // Bind the new version before reporting success so the next intent cannot race the change event.
    this.sync();
    this.emitter.fire({
      protocol: 1,
      kind: 'editResult',
      version: this.document.version,
      requestId: message.requestId,
      accepted,
      reason: accepted ? 'APPLIED' : 'REJECTED_BY_HOST',
      diagnostics: [],
    });
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.emitter.dispose();
  }
}
