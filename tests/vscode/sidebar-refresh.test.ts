import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as vscode from 'vscode';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import { SidebarHostContext } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import { SidebarViews } from '../../apps/vscode-extension/src/sidebar/views.js';
import { until } from './session-checks.js';

/** The row guard's own refusal; it is thrown before any dispatch starts. */
const STALE_ROW =
  'This report item is stale. Activate its current row and try again.';

/** Only the facts this contract needs from a native row. */
interface NativeRow {
  readonly label: string;
  readonly children: readonly NativeRow[];
  readonly node?: {
    readonly id: string;
    readonly kind: string;
    readonly capabilities: readonly {
      readonly operation: string;
      readonly eligible: boolean;
    }[];
  };
  /** Captured with the row; it must move whenever the context does. */
  readonly authority?: string;
}

interface SpiedTree {
  readonly provider: vscode.TreeDataProvider<unknown>;
  readonly dataEvents: unknown[];
  /** The tree reports the folds and expansions its user makes. */
  readonly collapse: vscode.EventEmitter<{ element: unknown }>;
  readonly expand: vscode.EventEmitter<{ element: unknown }>;
}

/**
 * Every `onDidChangeTreeData` makes the workbench refetch the whole tree, and a
 * fold or expand pressed while that refetch is in flight is dropped. A host
 * publication that changes nothing the user can see therefore must not fire it,
 * while a real change (a label, a pending cue) must still reach the tree.
 */
export async function run(): Promise<void> {
  const trees = new Map<string, SpiedTree>();
  const handlers = new Map<string, (row?: NativeRow) => unknown>();

  const plain = await vscode.workspace.openTextDocument({
    language: 'plaintext',
    content: 'Not a report. Nothing here is a report context.\n',
  });
  const report = await vscode.workspace.openTextDocument({
    language: 'xml',
    content: readFileSync(
      resolve(__dirname, '../../../tests/fixtures/interactive/mixed.rdlc'),
      'utf8',
    ),
  });
  // A known non-report context to start from.
  await vscode.window.showTextDocument(plain);
  const host = new SidebarHostContext();

  const createTreeView = vscode.window.createTreeView;
  const registerCommand = vscode.commands.registerCommand;
  let views: SidebarViews | undefined;
  try {
    vscode.window.createTreeView = ((
      id: string,
      options: vscode.TreeViewOptions<unknown>,
    ) => {
      const tree: SpiedTree = {
        provider: options.treeDataProvider,
        dataEvents: [],
        collapse: new vscode.EventEmitter<{ element: unknown }>(),
        expand: new vscode.EventEmitter<{ element: unknown }>(),
      };
      trees.set(id, tree);
      options.treeDataProvider.onDidChangeTreeData?.((event) => {
        tree.dataEvents.push(event);
      });
      const never = new vscode.EventEmitter<unknown>().event;
      return {
        message: '',
        description: undefined,
        visible: true,
        selection: [],
        onDidChangeSelection: never,
        onDidCollapseElement: tree.collapse.event,
        onDidExpandElement: tree.expand.event,
        reveal: () => Promise.resolve(),
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

    const tree = (kind: 'structure' | 'data'): SpiedTree => {
      const found = trees.get(`rdlcCode.${kind}`);
      assert.ok(found, `the ${kind} view is registered`);
      return found;
    };
    const events = () => ({
      structure: tree('structure').dataEvents.length,
      data: tree('data').dataEvents.length,
    });
    const rowsOf = async (kind: 'structure' | 'data'): Promise<NativeRow[]> => {
      const roots = (await tree(kind).provider.getChildren()) as
        | readonly NativeRow[]
        | undefined;
      const rows: NativeRow[] = [];
      const visit = (list: readonly NativeRow[]): void => {
        for (const row of list) {
          rows.push(row);
          visit(row.children);
        }
      };
      visit(roots ?? []);
      return rows;
    };
    const itemOf = async (
      row: NativeRow,
      kind: 'structure' | 'data' = 'structure',
    ): Promise<vscode.TreeItem> =>
      (await tree(kind).provider.getTreeItem(row)) as vscode.TreeItem;
    /** The exact authority `SidebarViews.checked()` compares a row against. */
    const authorityNow = (): string => {
      const context = host.registry.context();
      return JSON.stringify([
        context.documentId,
        context.version,
        context.generation,
        context.viewId,
      ]);
    };
    /** Run a registered command as its tree item does, returning the warning it showed. */
    const call = async (
      id: string,
      row?: NativeRow,
    ): Promise<string | undefined> => {
      const handler = handlers.get(id);
      assert.ok(handler, `${id} is registered by the native views`);
      const warnings: string[] = [];
      const showWarningMessage = vscode.window.showWarningMessage;
      vscode.window.showWarningMessage = (async (message: string) => {
        warnings.push(message);
        return undefined;
      }) as unknown as typeof vscode.window.showWarningMessage;
      try {
        await handler(row);
      } finally {
        vscode.window.showWarningMessage = showWarningMessage;
      }
      return warnings[0];
    };
    const edit = async (
      replace: (text: string) => { at: number; length: number; text: string },
      label: string,
    ): Promise<void> => {
      const version = report.version;
      const change = replace(report.getText());
      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.replace(
        report.uri,
        new vscode.Range(
          report.positionAt(change.at),
          report.positionAt(change.at + change.length),
        ),
        change.text,
      );
      assert.equal(
        await vscode.workspace.applyEdit(workspaceEdit),
        true,
        label,
      );
      await until(
        () =>
          report.version > version &&
          host.registry.context().version === report.version &&
          host.registry.context().state === 'editable',
        `${label}: the host accepts the new version`,
      );
    };

    await vscode.window.showTextDocument(report);
    await until(
      () => host.registry.context().state === 'editable',
      'the report becomes the editable context',
    );
    const before = await rowsOf('structure');
    const dataBefore = await rowsOf('data');
    assert.ok(
      before.some((row) => row.label.includes('Front')),
      'the structure view lists the Front textbox',
    );
    assert.ok(dataBefore.length > 0, 'the data view lists the report data');

    // 1. A new version whose rows render the same publishes nothing: the
    // source moves under every row and every node id changes with the version,
    // but no row looks different. The Data rows are all named, so their keys
    // survive the version; unnamed Structure rows are keyed by node id and are
    // new tree elements by design.
    const category = dataBefore.find((row) => !row.node);
    assert.ok(category, 'the Data view has a category row to probe the guard');
    const datasetRow = dataBefore.find((row) => row.node?.kind === 'dataset');
    assert.ok(datasetRow?.node, 'the Data view lists a dataset');
    const previousId = datasetRow.node.id;
    const previousAuthority = category.authority;
    const dataEvents = tree('data').dataEvents.length;
    await edit(
      (text) => ({ at: text.indexOf('<DataSets>'), length: 0, text: '\n' }),
      'whitespace-only edit',
    );
    assert.equal(
      tree('data').dataEvents.length,
      dataEvents,
      'a version that renders the same rows publishes no tree-data event',
    );
    const served = await rowsOf('data');
    assert.equal(served.length, dataBefore.length, 'the rows are unchanged');
    for (const [index, row] of dataBefore.entries())
      assert.ok(
        served[index] === row,
        `row ${index} keeps the identity the tree holds`,
      );
    assert.notEqual(
      previousAuthority,
      authorityNow(),
      'the context did move to a new version',
    );
    assert.equal(
      category.authority,
      authorityNow(),
      'the kept rows adopted the current authority',
    );
    const current = host.evaluation?.navigation.data.nodes.find(
      (node) => node.kind === 'dataset',
    );
    assert.ok(current, 'the new version lists the dataset');
    assert.notEqual(
      current.id,
      previousId,
      'its node id moved with the version',
    );
    assert.equal(
      datasetRow.node.id,
      current.id,
      'the kept row targets the node of the current version',
    );
    const item = (await tree('data').provider.getTreeItem(
      datasetRow,
    )) as vscode.TreeItem;
    assert.equal(
      item.command?.command,
      'rdlcCode.sidebar.activate',
      'a kept row keeps its activation command',
    );
    assert.equal(
      item.command?.arguments?.[0],
      datasetRow,
      'the command still carries the very row the tree holds',
    );
    const warning = await call('rdlcCode.sidebar.properties', category);
    assert.notEqual(warning, STALE_ROW, 'a kept row is not stale');
    assert.match(
      warning ?? '',
      /^Properties are unavailable for this target\./,
      'the kept row reaches its own guarded route',
    );

    // A fold is the tree's own state: it reports it, and the provider hands it
    // back on the next fetch. It is not a publication, so a no-op publication
    // after a fold still fires nothing.
    assert.ok(datasetRow.children.length > 0, 'the dataset row has children');
    const folding = async (): Promise<number | undefined> =>
      (await itemOf(datasetRow, 'data')).collapsibleState;
    assert.equal(
      await folding(),
      vscode.TreeItemCollapsibleState.Expanded,
      'the dataset row starts open',
    );
    tree('data').collapse.fire({ element: datasetRow });
    assert.equal(
      await folding(),
      vscode.TreeItemCollapsibleState.Collapsed,
      'the fold is reported back',
    );
    const folded = tree('data').dataEvents.length;
    await edit(
      (text) => ({ at: text.indexOf('<DataSets>'), length: 0, text: '\n' }),
      'whitespace-only edit after a fold',
    );
    assert.equal(
      tree('data').dataEvents.length,
      folded,
      'a no-op publication after a fold publishes nothing',
    );
    assert.equal(
      await folding(),
      vscode.TreeItemCollapsibleState.Collapsed,
      'and the fold stands',
    );
    tree('data').expand.fire({ element: datasetRow });
    assert.equal(
      await folding(),
      vscode.TreeItemCollapsibleState.Expanded,
      'an expansion is reported back too',
    );

    // 2. A real change still publishes, and only the view it changed.
    const published = events();
    await edit((text) => {
      const name = 'Name="Front"';
      return {
        at: text.indexOf(name),
        length: name.length,
        text: 'Name="Foremost"',
      };
    }, 'rename');
    const renamed = events();
    assert.ok(
      renamed.structure > published.structure,
      'a changed label reaches the Structure view',
    );
    assert.equal(
      renamed.data,
      published.data,
      'the Data view renders the same and publishes nothing',
    );
    const relabeled = await rowsOf('structure');
    assert.ok(
      relabeled.some((row) => row.label.includes('Foremost')) &&
        !relabeled.some((row) => row.label.includes('Front')),
      'the Structure view serves the new label',
    );
    // A row that appears is a structural change and publishes too.
    await edit((text) => {
      const fields = '</Fields>';
      return {
        at: text.indexOf(fields),
        length: 0,
        text: '<Field Name="Extra"><DataField>Extra</DataField></Field>',
      };
    }, 'new field');
    assert.ok(
      events().data > renamed.data,
      'a new Data row reaches the Data view',
    );
    assert.ok(
      (await rowsOf('data')).length > dataBefore.length,
      'the Data view serves the new row',
    );

    // 3. Pending and selection cues are real changes; a selection that only
    // repeats what the designer already accepted changes nothing.
    const session = new DocumentSession(report);
    let hold: Promise<void> | null = null;
    let sequence = 0;
    const posted: string[][] = [];
    const panel = {
      active: false,
      visible: false,
      viewColumn: undefined,
      onDidChangeViewState: () => new vscode.Disposable(() => undefined),
      webview: {
        postMessage: async (input: unknown) => {
          const action = input as {
            kind?: string;
            requestId: string;
            baseVersion: number;
            viewId: string;
            targetIds: readonly string[];
            primaryId: string;
          };
          if (action.kind !== 'nativeAction') return true;
          posted.push([...action.targetIds]);
          if (hold) await hold;
          sequence += 1;
          session.receive({
            protocol: 2,
            kind: 'acceptedSelection',
            version: action.baseVersion,
            viewId: action.viewId,
            sequence,
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
          return true;
        },
      },
    } as unknown as vscode.WebviewPanel;
    let registration: vscode.Disposable | undefined;
    try {
      const unbound = events();
      registration = host.register(report, panel, session);
      session.receive({ protocol: 2, kind: 'ready' });
      await until(() => session.isReady, 'the designer handshake completes');
      assert.ok(
        host.registry.context().viewId,
        'the designer is bound to this report',
      );
      assert.deepEqual(
        events(),
        unbound,
        'binding the designer renders the same rows and publishes nothing',
      );
      const sceneIds = new Set(
        (host.evaluation?.scene?.items ?? [])
          .filter((entry) => entry.kind !== 'cell')
          .map((entry) => entry.id),
      );
      const [target, second] = (await rowsOf('structure')).filter(
        (row) => row.node?.kind === 'textbox' && sceneIds.has(row.node.id),
      );
      assert.ok(target?.node && second?.node, 'two selectable body rows');
      const targetId = target.node.id;
      const secondId = second.node.id;
      const describe = async (row: NativeRow): Promise<string> =>
        String((await itemOf(row)).description ?? '');
      assert.equal(await describe(target), '', 'the row starts without a cue');

      // A new selection is pending until the designer settles it.
      let settle!: () => void;
      hold = new Promise<void>((resolve) => (settle = resolve));
      const idle = events().structure;
      const selecting = call('rdlcCode.sidebar.activate', target);
      await until(
        () => posted.length === 1,
        'the selection reaches the designer',
      );
      assert.equal(
        events().structure - idle,
        1,
        'the pending cue reaches the tree',
      );
      assert.match(await describe(target), /Pending/);
      settle();
      hold = null;
      assert.equal(await selecting, undefined, 'the selection is accepted');
      assert.equal(
        await describe(target),
        'Primary',
        'the settled row shows the accepted selection only',
      );

      // Selecting it again changes nothing the user can see, in flight or settled.
      const settled = events();
      assert.equal(sequence, 1, 'one designer round trip so far');
      hold = new Promise<void>((resolve) => (settle = resolve));
      const repeating = call('rdlcCode.sidebar.activate', target);
      await until(() => posted.length === 2, 'the repeat reaches the designer');
      assert.deepEqual(
        events(),
        settled,
        'a repeated selection in flight publishes nothing',
      );
      assert.equal(
        await describe(target),
        'Primary',
        'and marks no row pending',
      );
      settle();
      hold = null;
      assert.equal(await repeating, undefined, 'the repeat is accepted');
      assert.deepEqual(
        events(),
        settled,
        'a settled repeated selection publishes nothing',
      );

      // A, B, A: while B is still on its way the second A is not a repeat, the
      // tree is about to show B and A has to come back.
      const select = (primaryId: string, targetIds: string[]) =>
        host.dispatch(
          { action: 'select', primaryId, additive: false },
          targetIds,
        );
      hold = new Promise<void>((resolve) => (settle = resolve));
      const before = posted.length;
      const clickB = call('rdlcCode.sidebar.activate', second);
      await until(() => posted.length === before + 1, 'B reaches the designer');
      const clickA = call('rdlcCode.sidebar.activate', target);
      assert.match(await describe(second), /Pending/, 'B is pending');
      assert.match(
        await describe(target),
        /Pending/,
        'A is pending behind B, though the designer still holds A',
      );
      settle();
      hold = null;
      assert.equal(await clickB, undefined, 'B is accepted');
      assert.equal(await clickA, undefined, 'A is accepted after B');
      assert.equal(await describe(target), 'Primary', 'A is held again');
      assert.equal(await describe(second), '', 'and B is not');

      // A multi-selection is a real change from a single one.
      await select(secondId, [targetId, secondId]);
      assert.equal(
        await describe(second),
        'Primary',
        'the designer holds both, B primary',
      );
      for (const [label, primaryId, targetIds] of [
        [
          'the same targets with another primary',
          targetId,
          [targetId, secondId],
        ],
        ['fewer targets', targetId, [targetId]],
      ] as const) {
        hold = new Promise<void>((resolve) => (settle = resolve));
        const count = posted.length;
        const changing = select(primaryId, [...targetIds]);
        await until(() => posted.length === count + 1, `${label} is delivered`);
        assert.match(await describe(target), /Pending/, `${label} is pending`);
        settle();
        hold = null;
        assert.equal((await changing).status, 'accepted', label);
      }

      // Repeats of a repeat still publish nothing while the first is in flight.
      const quiet = events();
      hold = new Promise<void>((resolve) => (settle = resolve));
      const count = posted.length;
      const first = select(targetId, [targetId]);
      await until(() => posted.length === count + 1, 'the repeat is delivered');
      const again = select(targetId, [targetId]);
      assert.deepEqual(events(), quiet, 'repeats in flight publish nothing');
      settle();
      hold = null;
      await Promise.all([first, again]);
      assert.deepEqual(events(), quiet, 'and nothing once they settle');
    } finally {
      registration?.dispose();
      session.dispose();
    }
  } finally {
    vscode.window.createTreeView = createTreeView;
    vscode.commands.registerCommand = registerCommand;
    views?.dispose();
    host.dispose();
    for (const document of [report, plain]) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
    }
  }
}
