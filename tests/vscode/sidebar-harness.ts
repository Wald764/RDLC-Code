import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  HostMessage,
  NativeActionMessage,
} from '@rdlc/report-model/protocol';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import type { ImageSource } from '../../apps/vscode-extension/src/image-import.js';
import { SidebarHostContext } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import { SidebarViews } from '../../apps/vscode-extension/src/sidebar/views.js';
import { until } from './session-checks.js';

/** Only the facts the sidebar tests need from a native row. */
export interface NativeRow {
  readonly label: string;
  readonly key: string;
  readonly children: readonly NativeRow[];
  readonly node?: {
    readonly id: string;
    readonly kind: string;
    readonly name: string | null;
    readonly details?: Record<string, unknown>;
  };
}

export type NativeKind = 'structure' | 'data' | 'components';

/** One scripted answer for `showInputBox`, recorded with the options it was given. */
export interface InputBoxCall {
  readonly options: vscode.InputBoxOptions;
  readonly answer: string | undefined;
}

export interface CommandRun {
  readonly warnings: string[];
  readonly infos: string[];
  readonly inputs: InputBoxCall[];
}

export interface NativeHarness {
  readonly host: SidebarHostContext;
  readonly document: vscode.TextDocument;
  readonly session: DocumentSession;
  readonly messages: HostMessage[];
  rows(kind: NativeKind): Promise<NativeRow[]>;
  item(kind: NativeKind, row: NativeRow): Promise<vscode.TreeItem>;
  reveals(kind: NativeKind): readonly NativeRow[];
  /** Runs a registered command as its tree item does, capturing messages and input boxes. */
  call(
    id: string,
    row?: NativeRow,
    answers?: readonly (string | undefined)[],
  ): Promise<CommandRun>;
}

/** A file chooser that must never open: inserting an existing definition needs none. */
export class ForbiddenImageSource implements ImageSource {
  calls = 0;
  async pick(): Promise<never> {
    this.calls++;
    throw new Error('The file chooser must not open.');
  }
  async stat(): Promise<number> {
    this.calls++;
    throw new Error('No file is read.');
  }
  async read(): Promise<Uint8Array> {
    this.calls++;
    throw new Error('No file is read.');
  }
}

/**
 * The real native views over a real document and DocumentSession, with the harness
 * playing the designer: it settles a native `author` action through the real edit path
 * (queue, verification and `applyEdit`) and accepts a native `select` the way the
 * canvas does. Tree views and command registration are spied so that the activated
 * extension's own registrations are untouched.
 */
export async function withNativeViews(
  source: string,
  run: (harness: NativeHarness) => Promise<void>,
  imageSource: ImageSource = new ForbiddenImageSource(),
): Promise<void> {
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-sidebar-')),
    'report.rdlc',
  );
  writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  const host = new SidebarHostContext();
  const session = new DocumentSession(
    document,
    undefined,
    undefined,
    undefined,
    undefined,
    imageSource,
  );
  const messages: HostMessage[] = [];
  let sequence = 0;
  const subscriptions = [
    session.onMessage((message) => {
      messages.push(message);
      if (message.kind !== 'editResult') return;
      const nativeId = message.requestId.replace(/^edit-/, '');
      // The designer settles the captured action from its correlated edit result.
      session.receive({
        protocol: 2,
        kind: 'actionOutcome',
        requestId: nativeId,
        baseVersion: message.baseVersion,
        resultVersion: message.version,
        ...(message.accepted
          ? { status: 'accepted' }
          : { status: 'refused', reason: message.reason }),
        selectionSequence: sequence,
      });
    }),
  ];
  const panel = {
    active: false,
    visible: false,
    viewColumn: undefined,
    onDidChangeViewState: () => new vscode.Disposable(() => undefined),
    webview: {
      postMessage: async (input: unknown) => {
        const action = input as NativeActionMessage;
        void Promise.resolve().then(() => {
          if (action.action === 'author')
            session.receive({
              protocol: 2,
              kind: 'edit',
              requestId: `edit-${action.requestId}`,
              nativeRequestId: action.requestId,
              baseVersion: action.baseVersion,
              targetId: action.targetIds[0]!,
              operation: 'author',
              payload: action.payload,
            });
          else if (action.action === 'select') {
            const viewId = host.registry.context().viewId!;
            session.receive({
              protocol: 2,
              kind: 'acceptedSelection',
              version: action.baseVersion,
              viewId,
              sequence: ++sequence,
              requestId: action.requestId,
              selection: {
                mode: 'body',
                targetIds: [...action.targetIds],
                primaryId: action.primaryId,
              },
            });
            session.receive({
              protocol: 2,
              kind: 'actionOutcome',
              requestId: action.requestId,
              baseVersion: action.baseVersion,
              resultVersion: action.baseVersion,
              status: 'accepted',
              selectionSequence: sequence,
            });
          }
        });
        return true;
      },
    },
  } as unknown as vscode.WebviewPanel;

  const trees = new Map<
    string,
    { provider: vscode.TreeDataProvider<unknown>; reveals: NativeRow[] }
  >();
  const handlers = new Map<string, (row?: NativeRow) => unknown>();
  const createTreeView = vscode.window.createTreeView;
  const registerCommand = vscode.commands.registerCommand;
  let views: SidebarViews | undefined;
  let registration: vscode.Disposable | undefined;
  try {
    vscode.window.createTreeView = ((
      id: string,
      options: vscode.TreeViewOptions<unknown>,
    ) => {
      const tree = {
        provider: options.treeDataProvider,
        reveals: [] as NativeRow[],
      };
      trees.set(id, tree);
      const never = new vscode.EventEmitter<unknown>().event;
      return {
        message: '',
        description: undefined,
        visible: true,
        selection: [],
        onDidChangeSelection: never,
        onDidCollapseElement: never,
        onDidExpandElement: never,
        reveal: (row: unknown) => {
          tree.reveals.push(row as NativeRow);
          return Promise.resolve();
        },
        dispose: () => undefined,
      };
    }) as unknown as typeof vscode.window.createTreeView;
    vscode.commands.registerCommand = ((
      id: string,
      handler: (row?: NativeRow) => unknown,
    ) => {
      handlers.set(id, handler);
      return new vscode.Disposable(() => handlers.delete(id));
    }) as unknown as typeof vscode.commands.registerCommand;
    views = new SidebarViews(host);
    assert.equal(trees.size, 3, 'the native views use the spied window');

    await vscode.window.showTextDocument(document);
    registration = host.register(document, panel, session);
    session.receive({ protocol: 2, kind: 'ready' });
    await until(() => session.isReady, 'harness: designer handshake');
    await until(
      () => host.registry.context().state === 'editable',
      'harness: the report is the editable context',
    );

    const tree = (kind: NativeKind) => {
      const found = trees.get(`rdlcCode.${kind}`);
      assert.ok(found, `the ${kind} view is registered`);
      return found;
    };
    const harness: NativeHarness = {
      host,
      document,
      session,
      messages,
      async rows(kind) {
        const roots = ((await tree(kind).provider.getChildren()) ??
          []) as readonly NativeRow[];
        const rows: NativeRow[] = [];
        const visit = (list: readonly NativeRow[]): void => {
          for (const row of list) {
            rows.push(row);
            visit(row.children);
          }
        };
        visit(roots);
        return rows;
      },
      async item(kind, row) {
        return (await tree(kind).provider.getTreeItem(row)) as vscode.TreeItem;
      },
      reveals: (kind) => tree(kind).reveals,
      async call(id, row, answers = []) {
        const handler = handlers.get(id);
        assert.ok(handler, `${id} is registered by the native views`);
        const result: CommandRun = { warnings: [], infos: [], inputs: [] };
        const queue = [...answers];
        const { showWarningMessage, showInformationMessage, showInputBox } =
          vscode.window;
        vscode.window.showWarningMessage = (async (message: string) => {
          result.warnings.push(message);
          return undefined;
        }) as unknown as typeof vscode.window.showWarningMessage;
        vscode.window.showInformationMessage = (async (message: string) => {
          result.infos.push(message);
          return undefined;
        }) as unknown as typeof vscode.window.showInformationMessage;
        vscode.window.showInputBox = (async (
          options: vscode.InputBoxOptions,
        ) => {
          const answer = queue.shift();
          result.inputs.push({ options, answer });
          return answer;
        }) as unknown as typeof vscode.window.showInputBox;
        try {
          await handler(row);
        } finally {
          vscode.window.showWarningMessage = showWarningMessage;
          vscode.window.showInformationMessage = showInformationMessage;
          vscode.window.showInputBox = showInputBox;
        }
        return result;
      },
    };
    await run(harness);
  } finally {
    vscode.window.createTreeView = createTreeView;
    vscode.commands.registerCommand = registerCommand;
    for (const subscription of subscriptions) subscription.dispose();
    views?.dispose();
    registration?.dispose();
    session.dispose();
    host.dispose();
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}
