import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as vscode from 'vscode';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';
import { WindowContextRegistry } from '../../apps/vscode-extension/src/sidebar/context.js';
import { SidebarHostContext } from '../../apps/vscode-extension/src/sidebar/host-context.js';
import {
  SidebarViews,
  insertionReason,
  stateMessage,
} from '../../apps/vscode-extension/src/sidebar/views.js';
import { until } from './session-checks.js';

const URI = 'file:///loading.rdlc';

const NATIVE_KINDS = ['structure', 'data', 'components'] as const;
type NativeKind = (typeof NATIVE_KINDS)[number];

/** The row guard's own refusal; it is thrown before any dispatch starts. */
const STALE_ROW =
  'This report item is stale. Activate its current row and try again.';

/** Only the facts the refresh contract needs from a native row. */
interface NativeRow {
  readonly component?: { readonly creatable: boolean };
  readonly children: readonly NativeRow[];
  readonly node?: { readonly id: string; readonly kind: string };
  /** Captured with the row; it must move whenever the context does. */
  readonly authority?: string;
}

interface SpiedTree {
  readonly provider: vscode.TreeDataProvider<unknown>;
  readonly selection: vscode.EventEmitter<unknown>;
  message: string;
  description: string | undefined;
  messageWrites: number;
  descriptionWrites: number;
  readonly dataEvents: unknown[];
  readonly reveals: NativeRow[];
}

interface WriteCount {
  readonly message: number;
  readonly description: number;
  readonly rows: number;
}

/** FR-003-loading (FR-003 Loading): the host resolves it in one tick, so it is driven here at the model level. */
export async function run(): Promise<void> {
  const loading = 'Loading accepted report…';
  // What the three native views render while a record is loading.
  assert.equal(stateMessage('structure', 'loading'), loading);
  assert.equal(stateMessage('data', 'loading'), loading);
  assert.ok(
    stateMessage('components', 'loading').startsWith(
      `${loading} Native drag is unavailable.`,
    ),
  );
  // Local next action: components show why insertion is unavailable and what to do.
  assert.equal(
    insertionReason('loading'),
    'Open an editable report to insert components.',
  );
  assert.equal(insertionReason('editable'), null);

  // FR-003 beyond loading: every other state says only what is true of it.
  const invalid = 'Invalid XML. Open Code XML to repair this report.';
  const sourceOnly =
    'Source-only report. Inspection and Code XML are available.';
  // No-report: Structure/Data stay empty so their viewsWelcome (New/Open Report) renders.
  assert.equal(stateMessage('structure', 'no-report'), '');
  assert.equal(stateMessage('data', 'no-report'), '');
  assert.match(
    stateMessage('components', 'no-report'),
    /^Open or create a report to begin\./,
  );
  // Editable: no banner, so the report itself is the state.
  assert.equal(stateMessage('structure', 'editable'), '');
  assert.equal(stateMessage('data', 'editable'), '');
  for (const kind of ['structure', 'data'] as const) {
    assert.equal(stateMessage(kind, 'invalid-source'), invalid);
    assert.equal(stateMessage(kind, 'source-only'), sourceOnly);
  }
  // Components keep the local recovery sentence in front of the drag limitation.
  for (const [state, text] of [
    ['invalid-source', invalid],
    ['source-only', sourceOnly],
  ] as const)
    assert.ok(stateMessage('components', state).startsWith(text));
  assert.match(
    stateMessage('components', 'editable'),
    /^Native drag is unavailable\./,
  );
  // Insertion is unavailable in every non-editable state, with one local next step.
  for (const state of [
    'no-report',
    'loading',
    'invalid-source',
    'source-only',
  ] as const)
    assert.equal(
      insertionReason(state),
      'Open an editable report to insert components.',
    );

  const registry = new WindowContextRegistry();
  // openDocument without evaluation: loading, active, and every action refused.
  const id = registry.openDocument({}, URI, 1);
  registry.focusDocument(id);
  assert.equal(registry.context().state, 'loading');
  for (const [request, capability] of [
    ['loading-create', 'create'],
    ['loading-select', 'select'],
    ['loading-source', 'source'],
  ] as const)
    assert.deepEqual(registry.capture(request, capability, []), {
      ok: false,
      reason: 'loading',
    });

  // documentChanged after an accepted evaluation returns to loading and revokes live captures.
  registry.setEvaluation(id, {
    version: 1,
    state: 'editable',
    targets: ['t1'],
    capabilities: ['select', 'create'],
  });
  assert.equal(registry.context().state, 'editable');
  const captured = registry.capture('before-edit', 'select', ['t1']);
  assert.ok(captured.ok);
  assert.equal(registry.revalidate(captured.capture), null);
  assert.equal(registry.documentChanged(id, 2), true);
  assert.equal(registry.context().state, 'loading');
  assert.equal(registry.revalidate(captured.capture), 'stale-version');
  assert.deepEqual(registry.capture('after-edit', 'select', ['t1']), {
    ok: false,
    reason: 'loading',
  });
  registry.setEvaluation(id, {
    version: 2,
    state: 'editable',
    targets: ['t1'],
    capabilities: ['select', 'create'],
  });
  assert.ok(registry.capture('resolved', 'select', ['t1']).ok);
  registry.dispose();

  await nativeRowRefreshContract();
}

/**
 * Native view chrome and row authority (FR-005, US5.1 context switches).
 *
 * The pinned host's `TreeView.message` setter has no equality guard: every write
 * fires the extension host data event and reopens its 200 ms debounce ahead of
 * the row refresh that replaces the previous context's rows, so a refresh that
 * changes no state must write neither message nor description, and a row held
 * from a previous context must still be refused while a current row reaches the
 * host dispatch.
 */
async function nativeRowRefreshContract(): Promise<void> {
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
  // A known non-report context: the contract compares exact write counts.
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
      const selection = new vscode.EventEmitter<unknown>();
      const tree: SpiedTree = {
        provider: options.treeDataProvider,
        selection,
        message: '',
        description: undefined,
        messageWrites: 0,
        descriptionWrites: 0,
        dataEvents: [],
        reveals: [],
      };
      trees.set(id, tree);
      options.treeDataProvider.onDidChangeTreeData?.((event) => {
        tree.dataEvents.push(event);
      });
      return {
        get message() {
          return tree.message;
        },
        set message(value: string | vscode.MarkdownString) {
          if (typeof value !== 'string') return;
          tree.message = value;
          tree.messageWrites++;
        },
        get description() {
          return tree.description;
        },
        set description(value: string | undefined) {
          tree.description = value;
          tree.descriptionWrites++;
        },
        visible: true,
        selection: [],
        onDidChangeSelection: selection.event,
        onDidCollapseElement: new vscode.EventEmitter<unknown>().event,
        onDidExpandElement: new vscode.EventEmitter<unknown>().event,
        reveal: (row: unknown) => {
          tree.reveals.push(row as NativeRow);
          return Promise.resolve();
        },
        dispose: () => selection.dispose(),
      };
    }) as unknown as typeof vscode.window.createTreeView;
    vscode.commands.registerCommand = ((
      id: string,
      handler: (row?: NativeRow) => unknown,
    ) => {
      handlers.set(id, handler);
      return new vscode.Disposable(() => handlers.delete(id));
    }) as unknown as typeof vscode.commands.registerCommand;
    assert.notEqual(
      vscode.window.createTreeView,
      createTreeView,
      'the tree view spy must be installed',
    );
    assert.notEqual(
      vscode.commands.registerCommand,
      registerCommand,
      'the command spy must be installed',
    );
    views = new SidebarViews(host);
    assert.equal(
      trees.size,
      3,
      'the native views must be created through the spied window',
    );
    assert.equal(
      host.registry.context().state,
      'no-report',
      'the contract starts from a known non-report context',
    );

    const snapshot = (): Record<NativeKind, WriteCount> =>
      Object.fromEntries(
        NATIVE_KINDS.map((kind) => {
          const tree = trees.get(`rdlcCode.${kind}`);
          assert.ok(tree, `the ${kind} view is registered`);
          return [
            kind,
            {
              message: tree.messageWrites,
              description: tree.descriptionWrites,
              rows: tree.dataEvents.length,
            } satisfies WriteCount,
          ];
        }),
      ) as Record<NativeKind, WriteCount>;

    /** Run the registered command exactly as its TreeItem does, capturing warnings. */
    /** Run one activation path with the warning channel captured instead of shown. */
    const quietly = async (run: () => unknown): Promise<string[]> => {
      const warnings: string[] = [];
      const showWarningMessage = vscode.window.showWarningMessage;
      vscode.window.showWarningMessage = (async (message: string) => {
        warnings.push(message);
        return undefined;
      }) as unknown as typeof vscode.window.showWarningMessage;
      try {
        await run();
      } finally {
        vscode.window.showWarningMessage = showWarningMessage;
      }
      return warnings;
    };

    const call = async (
      id: string,
      row?: NativeRow,
    ): Promise<string | undefined> => {
      const handler = handlers.get(id);
      assert.ok(handler, `${id} is registered by the native views`);
      return (await quietly(() => handler(row)))[0];
    };

    const rowsOf = async (kind: NativeKind): Promise<NativeRow[]> => {
      const tree = trees.get(`rdlcCode.${kind}`);
      assert.ok(tree, `the ${kind} view is registered`);
      const roots = (await tree.provider.getChildren()) as
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

    // 1. Refreshes that change no state rewrite neither message nor description.
    const quiet = snapshot();
    for (let refresh = 0; refresh < 3; refresh++)
      await call('rdlcCode.sidebar.clearFilter');
    const settled = snapshot();
    for (const kind of NATIVE_KINDS) {
      assert.equal(
        settled[kind].message - quiet[kind].message,
        0,
        `${kind}: an unchanged message must not be rewritten`,
      );
      assert.equal(
        settled[kind].description - quiet[kind].description,
        0,
        `${kind}: an unchanged description must not be rewritten`,
      );
      assert.equal(
        trees.get(`rdlcCode.${kind}`)?.message,
        stateMessage(kind, 'no-report'),
        `${kind}: the message still holds the current state`,
      );
    }

    // 2. A current row reaches the host; only the guard's own refusal may answer it.
    const current = (await rowsOf('components')).find(
      (row) => row.component?.creatable,
    );
    assert.ok(current, 'the Components view exposes a creatable row');
    const currentWarning = await call('rdlcCode.sidebar.activate', current);
    assert.ok(
      currentWarning?.includes('Report action is unavailable'),
      `a current row must reach the host dispatch, not the row guard: ${
        currentWarning ?? 'no warning'
      }`,
    );

    // 3. The real state change writes exactly what changed and rebuilds the rows.
    const opening = snapshot();
    await vscode.window.showTextDocument(report);
    assert.equal(
      host.registry.context().state,
      'editable',
      'the accepted report becomes the current context',
    );
    // The republished views owe their header to the rows that follow it: until
    // a view serves them it claims nothing, so it can never lead its projection.
    for (const kind of ['structure', 'data'] as const)
      assert.equal(
        snapshot()[kind].description - opening[kind].description,
        0,
        `${kind}: the header waits for the rows it describes`,
      );
    // The static toolbox publishes straight away: its rows are already current
    // and nothing asks it for children again until its own rows change.
    assert.equal(
      snapshot().components.description - opening.components.description,
      1,
      'components: the header updates without a fetch',
    );
    for (const kind of ['structure', 'data'] as const) await rowsOf(kind);
    const accepted = snapshot();
    for (const kind of NATIVE_KINDS) {
      assert.equal(
        accepted[kind].description - opening[kind].description,
        1,
        `${kind}: the report name is written once`,
      );
      assert.equal(
        accepted[kind].message - opening[kind].message,
        kind === 'components' ? 1 : 0,
        `${kind}: only a changed message is written`,
      );
      assert.ok(
        accepted[kind].rows - opening[kind].rows >= 1,
        `${kind}: the rows still refresh with the context`,
      );
      assert.equal(
        trees.get(`rdlcCode.${kind}`)?.message,
        stateMessage(kind, 'editable'),
        `${kind}: the message holds the accepted state`,
      );
    }

    // 4. The toolbox rows are re-tagged instead of republished: their content
    // is context-independent, so the context change that would otherwise make
    // them stale only moves the authority the guard checks.
    assert.equal(
      current.authority,
      authorityNow(),
      'the toolbox row adopted the current authority without a republish',
    );

    // 4b. A version-only accepted change never republishes the toolbox: the row
    // objects survive, the view emits no tree-data event, and the command the
    // workbench holds still captures the current authority.
    const components = trees.get('rdlcCode.components');
    assert.ok(components, 'the components view is registered');
    const toolbox = await rowsOf('components');
    const quietVersion = snapshot();
    const version = report.version;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(report.uri, report.positionAt(report.getText().length), '\n');
    assert.equal(
      await vscode.workspace.applyEdit(edit),
      true,
      'the version-only change applies',
    );
    await until(() => report.version > version, 'the version is accepted');
    assert.equal(
      host.registry.context().state,
      'editable',
      'the report stays accepted after the version-only change',
    );
    const versioned = snapshot();
    assert.equal(
      versioned.components.rows - quietVersion.components.rows,
      0,
      'the toolbox emits no tree-data event for a version-only change',
    );
    const served = await rowsOf('components');
    assert.equal(served.length, toolbox.length, 'the toolbox keeps its rows');
    for (const [index, row] of toolbox.entries())
      assert.ok(
        served[index] === row,
        `toolbox row ${index} keeps its identity across the change`,
      );
    const component = toolbox.find((row) => row.component?.creatable);
    assert.ok(component, 'the toolbox exposes a creatable row');
    const toolboxItem = await components.provider.getTreeItem(component);
    const captured = toolboxItem?.command?.arguments?.[0] as
      | NativeRow
      | undefined;
    assert.equal(
      captured,
      component,
      'the command carries the very row that is rendered',
    );
    assert.equal(
      captured?.authority,
      authorityNow(),
      'the command captures the current authority',
    );

    // 5. Own native clicks never reveal what the user just clicked; an
    // accepted selection from the canvas still reveals its exact row.
    const structure = trees.get('rdlcCode.structure');
    assert.ok(structure, 'the structure view is registered');
    const session = new DocumentSession(report);
    let sequence = 0;
    let outcomeFirst = false;
    // The real designer settles one native action at a time and refuses another
    // as already pending: the double records overlaps and can hold a settlement.
    let inflight = 0;
    let overlaps = 0;
    const posted: string[][] = [];
    let hold: Promise<void> | null = null;
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
          if (inflight > 0) overlaps += 1;
          inflight += 1;
          posted.push([...action.targetIds]);
          if (hold) await hold;
          inflight -= 1;
          sequence += 1;
          const accepted = {
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
          };
          const outcome = {
            protocol: 2,
            kind: 'actionOutcome',
            requestId: action.requestId,
            baseVersion: action.baseVersion,
            resultVersion: action.baseVersion,
            status: 'accepted',
            selectionSequence: sequence,
          };
          // The protocol settles either message first; both orders carry the
          // selection the tree itself asked for.
          if (outcomeFirst) {
            session.receive(outcome);
            session.receive(accepted);
          } else {
            session.receive(accepted);
            session.receive(outcome);
          }
          return true;
        },
      },
    } as unknown as vscode.WebviewPanel;
    const acceptedPrimary = (): string | null => {
      const selection = session.currentSelection?.selection;
      return selection?.mode === 'body' ? selection.primaryId : null;
    };
    // Captured before the designer binds: registering it moves the authority,
    // so this row must belong to the previous one afterwards.
    const staleRows = (await rowsOf('structure')).filter((row) => row.node);
    assert.ok(
      staleRows.length > 0,
      'the structure view exposes rows before the designer binds',
    );
    const staleRow = staleRows[0]!;
    let registration: vscode.Disposable | undefined;
    try {
      registration = host.register(report, panel, session);
      assert.ok(registration, 'the designer registration is created');
      const viewId = host.registry.context().viewId;
      assert.ok(viewId, 'the registered designer owns this document');
      session.receive({ protocol: 2, kind: 'ready' });
      await until(() => session.isReady, 'reveal contract: handshake');
      // The rows only exist after the view identity rebuilt them.
      const sceneIds = new Set(
        (host.evaluation?.scene?.items ?? [])
          .filter((item) => item.kind !== 'cell')
          .map((item) => item.id),
      );
      const bodyRows = (await rowsOf('structure')).filter(
        (row) => row.node?.kind === 'textbox' && sceneIds.has(row.node.id),
      );
      assert.ok(
        bodyRows.length >= 3,
        'the accepted report exposes three selectable body rows',
      );
      // The rebuild always follows the authority: no row may survive a context
      // change carrying the previous one the guard compares against.
      const authority = authorityNow();
      for (const row of await rowsOf('structure'))
        assert.equal(
          row.authority,
          authority,
          'every rendered row carries the current authority',
        );
      assert.notEqual(
        staleRow.authority,
        authority,
        'the captured row belongs to the previous authority',
      );
      // That stale row's selection route stays silent and dispatches nothing,
      // so a click on the previous projection can never reach a target.
      assert.deepEqual(
        await quietly(() =>
          structure.selection.fire({ selection: [staleRow] }),
        ),
        [],
        'a stale row in the selection route never warns',
      );
      assert.equal(
        session.currentSelection,
        null,
        'and never reaches a dispatch',
      );
      // A context-bound row captured before the change stays refused: the guard
      // keeps its own authority and neither route may action it.
      assert.equal(
        await call('rdlcCode.sidebar.activate', staleRow),
        STALE_ROW,
        'a row from a previous context is never actioned',
      );
      // The toolbox rows follow the same view identity, without a republish.
      for (const row of await rowsOf('components'))
        assert.equal(
          row.authority,
          authority,
          'the toolbox rows adopt the current authority',
        );
      const revealed = structure.reveals.length;
      for (const [index, row] of bodyRows.slice(0, 2).entries()) {
        outcomeFirst = index === 1;
        const warning = await call('rdlcCode.sidebar.activate', row);
        assert.equal(warning, undefined, `own click ${index} is accepted`);
        assert.equal(
          acceptedPrimary(),
          row.node!.id,
          `own click ${index} reaches the accepted selection`,
        );
      }
      assert.equal(
        structure.reveals.length,
        revealed,
        'an own native click never reveals the row the user just clicked',
      );
      // A selection that follows another before it settled queues behind it:
      // the designer refuses a second native action while one is pending.
      let settle!: () => void;
      hold = new Promise<void>((resolve) => (settle = resolve));
      const [first, second] = bodyRows;
      const before = posted.length;
      const warnings = await quietly(async () => {
        structure.selection.fire({ selection: [first!] });
        await until(
          () => posted.length === before + 1,
          'queued selection: the first reaches the designer',
        );
        structure.selection.fire({ selection: [first!, second!] });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          posted.length,
          before + 1,
          'the second selection waits for the first to settle',
        );
        settle();
        hold = null;
        await until(
          () =>
            posted.length === before + 2 &&
            acceptedPrimary() === second!.node!.id,
          'queued selection: the second is delivered after the first',
        );
      });
      assert.deepEqual(warnings, [], 'a queued selection never warns');
      assert.equal(overlaps, 0, 'native selections never overlap');
      assert.deepEqual(
        posted.slice(before),
        [[first!.node!.id], [first!.node!.id, second!.node!.id]],
        'both selections reach the designer in order',
      );

      // The next refresh (the user scrolled on) keeps that promise.
      await call('rdlcCode.sidebar.clearFilter');
      assert.equal(
        structure.reveals.length,
        revealed,
        'no later refresh reveals the accepted own selection either',
      );

      // Every cue change reaches the tree as one whole-view event: a row-level
      // refresh disposes the row it replaces, which also deletes the cached
      // `<command> /<n>` identity the workbench is about to execute for the
      // click that caused it ("Actual command not found").
      assert.ok(
        structure.dataEvents.length >= 2,
        'the cue changes reached the tree',
      );
      assert.ok(
        structure.dataEvents.every((event) => event === undefined),
        'cue updates are whole-view refreshes, never row-level dispositions',
      );
      // The activation command stays attached, so keyboard Enter and a re-click
      // on the current row still reach the same guarded route.
      const item = await structure.provider.getTreeItem(bodyRows[0]!);
      assert.ok(item, 'the native row renders as a tree item');
      assert.equal(
        item.command?.command,
        'rdlcCode.sidebar.activate',
        'a native row keeps its activation command',
      );
      assert.equal(
        item.command?.arguments?.length,
        1,
        'the row argument is the identity the command still carries',
      );

      const external = bodyRows[2]!;
      sequence += 1;
      session.receive({
        protocol: 2,
        kind: 'acceptedSelection',
        version: report.version,
        viewId,
        sequence,
        selection: {
          mode: 'body',
          targetIds: [external.node!.id],
          primaryId: external.node!.id,
        },
      });
      assert.equal(
        acceptedPrimary(),
        external.node!.id,
        'the external selection is accepted',
      );
      assert.equal(
        structure.reveals.length,
        revealed + 1,
        'an external accepted selection still reveals its row',
      );
      assert.equal(
        structure.reveals.at(-1)?.node?.id,
        external.node!.id,
        'the revealed row is the exact accepted target',
      );
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
