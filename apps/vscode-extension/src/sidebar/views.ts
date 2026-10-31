import * as vscode from 'vscode';
import { groupDataCategories, type DataCategoryKey } from '@rdlc/renderer/data';
import {
  filterComponents,
  type ComponentEntry,
  type CreationKind,
} from '@rdlc/report-model/components';
import type { NavigationNode } from '@rdlc/report-model/navigation';
import { SidebarHostContext, isDroppedOutcome } from './host-context.js';
import type { ContextState } from './context.js';
import {
  clipboardIntent,
  dataIntent,
  datasetCreateRoute,
  structureContextValue,
  structureIntent,
  type DataAction,
} from './actions.js';

interface Row {
  readonly key: string;
  readonly label: string;
  readonly parent?: Row;
  readonly node?: NavigationNode;
  readonly component?: ComponentEntry;
  readonly children: Row[];
  /** Captured with the row; rows that survive a context change only move it. */
  authority: string;
}

/**
 * Registered native Data commands. Every key must exist in package.json's
 * `contributes.commands`, and only these rows reach the existing guarded
 * dataset form — no command carries an authoring payload of its own.
 */
export const dataCommandActions = {
  dataEdit: 'edit',
  dataAddField: 'add-field',
  dataRename: 'rename',
  dataDelete: 'delete',
} as const satisfies Record<string, DataAction>;

/** Title command with no row target: the existing creation route owns defaults. */
export const dataCreateCommand = 'dataAddDataset';

/** Why insertion is unavailable (null when it is available). */
export function insertionReason(state: ContextState): string | null {
  return state === 'editable'
    ? null
    : 'Open an editable report to insert components.';
}

/**
 * Native view message per state. No-report: Structure/Data leave it empty so their
 * viewsWelcome (New/Open Report) renders; Components keeps rows and conveys it by message.
 */
export function stateMessage(
  kind: 'structure' | 'data' | 'components',
  state: ContextState,
): string {
  const text =
    state === 'no-report'
      ? kind === 'components'
        ? 'Open or create a report to begin.'
        : ''
      : state === 'loading'
        ? 'Loading accepted report…'
        : state === 'invalid-source'
          ? 'Invalid XML. Open Code XML to repair this report.'
          : state === 'source-only'
            ? 'Source-only report. Inspection and Code XML are available.'
            : '';
  return kind === 'components'
    ? `${text} Native drag is unavailable. Activate Textbox, Table or Dataset to insert; use the compact designer fallback for drag.`.trim()
    : text;
}

interface OwnReveal {
  readonly authority: string;
  readonly provider: NativeView;
  readonly selection: string;
}

/** Native display rows have no authority until their owned activation is rechecked. */
export class SidebarViews implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly providers: NativeView[];
  private readonly owned = new WeakSet<Row>();
  private query = '';
  private lastReport = '';
  private contentSignature = '';
  private lastFilter: string | undefined;
  private lastTreeSelection = '';
  /** Signature of the newest native selection requested and not yet settled. */
  private latestSelection: string | null = null;
  /**
   * One native selection this view itself dispatched, held until the host
   * accepts it: the tree the user just clicked already shows that row with its
   * ancestors open, so revealing it would only reset their scroll. The authority
   * scopes it to the context that captured it and it is consumed by the exact
   * accepted selection it caused, so it can neither outlive that context nor
   * suppress an unrelated canvas selection.
   */
  private ownReveal: OwnReveal | null = null;

  constructor(private readonly host: SidebarHostContext) {
    this.providers = (['structure', 'data', 'components'] as const).map(
      (kind) => new NativeView(kind),
    );
    this.disposables.push(
      ...this.providers,
      host.onDidChange(() => this.refresh()),
    );
    const register = (id: string, handler: (row?: Row) => unknown) =>
      this.disposables.push(
        vscode.commands.registerCommand(
          `rdlcCode.sidebar.${id}`,
          async (row?: Row) => {
            try {
              return await handler(row);
            } catch (error) {
              await vscode.window.showWarningMessage(
                error instanceof Error
                  ? error.message
                  : 'The report action could not be completed.',
              );
            }
          },
        ),
      );
    register('activate', (row) => this.activate(row));
    for (const provider of this.providers.filter(
      (provider) => provider.kind !== 'components',
    )) {
      this.disposables.push(
        provider.view.onDidChangeSelection((event) => {
          const rows = event.selection;
          if (
            !rows.length ||
            rows.some((row) => !row.node || row.authority !== this.authority())
          )
            return;
          const signature = JSON.stringify(rows.map((row) => row.key));
          if (signature === this.lastTreeSelection) return;
          this.lastTreeSelection = signature;
          void this.activate(rows.at(-1), rows).catch(
            async (error: unknown) => {
              await vscode.window.showWarningMessage(
                error instanceof Error
                  ? error.message
                  : 'The report selection was refused.',
              );
            },
          );
        }),
      );
    }
    register('properties', (row) => this.properties(row));
    register('source', (row) => this.source(row));
    for (const action of ['copy', 'cut', 'duplicate'] as const)
      register(action, async (input) => {
        const row = this.checked(input);
        if (!row.node) throw new Error('Choose an eligible report body item.');
        const intent = clipboardIntent(
          row.node,
          this.host.evaluation?.scene ?? null,
          action,
        );
        const outcome = await this.host.dispatch(intent, [row.node.id], {
          beforeDispatch: this.stillCurrent(row),
        });
        if (outcome.status !== 'accepted')
          throw new Error(
            outcome.reason ?? 'The clipboard action was cancelled.',
          );
      });
    for (const action of ['delete', 'table', 'group'] as const)
      register(action, async (input) => {
        const row = this.checked(input);
        if (!row.node)
          throw new Error('Choose a report node in Report Structure.');
        const route = structureIntent(
          row.node,
          this.host.evaluation?.scene ?? null,
          action,
          this.host.evaluation?.navigation.structure.nodes ?? [],
        );
        const outcome = await this.host.dispatch(
          route.intent,
          route.targetIds,
          { beforeDispatch: this.stillCurrent(row) },
        );
        if (outcome.status !== 'accepted')
          throw new Error(outcome.reason ?? 'The report action was cancelled.');
        void vscode.window.showInformationMessage(route.notice);
      });
    for (const [id, action] of Object.entries(dataCommandActions))
      register(id, (input) => this.dataAction(input, action));
    register(dataCreateCommand, () => this.dataCreateDataset());
    register('filter', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Filter Components',
        prompt:
          'Filter component labels. Native drag is unavailable; activate a supported item to insert.',
        value: this.query,
      });
      if (query !== undefined) {
        this.query = query;
        this.refresh();
      }
    });
    register('clearFilter', () => {
      this.query = '';
      this.refresh();
    });
    register('openReport', async () => {
      const uris = await vscode.window.showOpenDialog({
        title: 'Open RDLC Report',
        canSelectMany: false,
        filters: { 'RDLC reports': ['rdlc'] },
      });
      if (uris?.[0])
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uris[0],
          'rdlcCode.designer',
        );
    });
    this.refresh();
  }

  private authority(): string {
    const context = this.host.registry.context();
    return JSON.stringify([
      context.documentId,
      context.version,
      context.generation,
      context.viewId,
    ]);
  }

  private checked(row?: Row): Row {
    if (!row || !this.owned.has(row) || row.authority !== this.authority())
      throw new Error(
        'This report item is stale. Activate its current row and try again.',
      );
    return row;
  }

  /**
   * Host dispatches queue behind the one in flight: a row that went stale while
   * its action waited is refused with the same warning as a stale click.
   */
  private stillCurrent(row: Row): () => void {
    return () => {
      this.checked(row);
    };
  }

  private async activate(
    input?: Row,
    nativeRows?: readonly Row[],
  ): Promise<void> {
    const row = this.checked(input);
    if (row.component) {
      if (!row.component.creatable) throw new Error(row.component.reason!);
      const outcome = await this.host.dispatch(
        {
          action: 'create',
          create: row.component.kind as CreationKind,
        },
        [],
        { beforeDispatch: this.stillCurrent(row) },
      );
      if (outcome.status !== 'accepted')
        throw new Error(outcome.reason ?? 'Insertion was cancelled.');
    } else if (row.node) {
      // The command's row belongs to exactly one native view, so a multi-select
      // must come from that view's own selection and never from another view's.
      const provider = this.providers.find(
        (candidate) => candidate.find(row.node!.id) === row,
      );
      const selected = provider?.view.selection ?? [];
      const inSelection = selected.some(
        (candidate) => candidate.key === row.key,
      );
      // Command route only: when the owning view no longer holds this row, its
      // selection event already carried this interaction, so the command must
      // not re-select a row the user just removed.
      if (
        nativeRows === undefined &&
        provider &&
        selected.length > 0 &&
        !inSelection
      )
        return;
      const rows =
        nativeRows ?? (inSelection && selected.length > 1 ? selected : [row]);
      rows.forEach((candidate) => this.checked(candidate));
      if (rows.some((candidate) => !candidate.node))
        throw new Error('Choose report nodes only.');
      const targetIds = rows.map((candidate) => candidate.node!.id);
      const signature = JSON.stringify([row.authority, targetIds, row.node.id]);
      // The same selection requested again while it is the newest one (a tree
      // event and its command route) is one interaction.
      if (this.latestSelection === signature) return;
      this.latestSelection = signature;
      let own: OwnReveal | null = null as OwnReveal | null;
      try {
        const outcome = await this.host.dispatch(
          { action: 'select', primaryId: row.node.id, additive: false },
          targetIds,
          {
            // The host queues native actions and may run this one long after the
            // click: a selection for a previous projection is dropped, as its
            // event route already does, rather than warned about.
            beforeDispatch: () => {
              if (
                rows.some(
                  (candidate) => candidate.authority !== this.authority(),
                )
              )
                return false;
              if (provider)
                this.ownReveal = own = {
                  authority: row.authority,
                  provider,
                  selection: JSON.stringify([targetIds, row.node!.id]),
                };
              return true;
            },
          },
        );
        if (isDroppedOutcome(outcome)) return;
        if (outcome.status !== 'accepted')
          throw new Error(outcome.reason ?? 'Selection was cancelled.');
      } catch (error) {
        // A refused selection never arrives as an accepted one. Only the claim
        // this very selection made is withdrawn, never an earlier pending one.
        if (own && this.ownReveal === own) this.ownReveal = null;
        throw error;
      } finally {
        if (this.latestSelection === signature) this.latestSelection = null;
      }
    }
  }

  private async properties(input?: Row): Promise<void> {
    const row = this.checked(input);
    if (
      !row.node?.capabilities.some(
        (capability) =>
          capability.operation === 'properties' && capability.eligible,
      )
    )
      throw new Error(
        'Properties are unavailable for this target. Inspect Code XML.',
      );
    const outcome = await this.host.dispatch(
      { action: 'properties' },
      [row.node.id],
      { beforeDispatch: this.stillCurrent(row) },
    );
    if (outcome.status !== 'accepted')
      throw new Error(outcome.reason ?? 'Properties were cancelled.');
  }

  private async source(input?: Row): Promise<void> {
    const row = this.checked(input);
    if (!row.node) throw new Error('Choose an authored report node.');
    await this.host.openSource(row.node.id);
  }

  /**
   * Native Data row → the existing guarded dataset form: capability first,
   * captured authority at dispatch, and exactly one notice only on acceptance.
   */
  private async dataAction(input: Row | undefined, action: DataAction) {
    const row = this.checked(input);
    if (!row.node) throw new Error('Choose a dataset or field in Report Data.');
    const route = dataIntent(
      row.node,
      action,
      this.host.evaluation?.navigation.data.nodes ?? [],
    );
    const outcome = await this.host.dispatch(route.intent, route.targetIds, {
      beforeDispatch: this.stillCurrent(row),
    });
    if (outcome.status !== 'accepted')
      throw new Error(outcome.reason ?? 'The data action was refused.');
    void vscode.window.showInformationMessage(route.notice);
  }

  /** Title action with no row: the existing creation route supplies its defaults. */
  private async dataCreateDataset(): Promise<void> {
    const route = datasetCreateRoute();
    const outcome = await this.host.dispatch(route.intent, route.targetIds);
    if (outcome.status !== 'accepted')
      throw new Error(outcome.reason ?? 'Dataset creation was cancelled.');
    void vscode.window.showInformationMessage(route.notice);
  }

  private refresh(): void {
    const context = this.host.registry.context();
    const evaluation = this.host.evaluation;
    const authority = this.authority();
    // A native selection captured for another context can never be the one the
    // host is accepting now, so it stops being a candidate at all.
    if (this.ownReveal && this.ownReveal.authority !== authority)
      this.ownReveal = null;
    const report = context.uri
      ? vscode.Uri.parse(context.uri).path.split('/').at(-1) ||
        'Untitled report'
      : '';
    if ((context.documentId ?? '') !== this.lastReport) {
      this.query = '';
      this.lastReport = context.documentId ?? '';
    }
    void vscode.commands.executeCommand(
      'setContext',
      'rdlcCode.hasReport',
      context.state !== 'no-report',
    );
    void vscode.commands.executeCommand(
      'setContext',
      'rdlcCode.componentsFiltered',
      !!this.query.trim(),
    );
    const contentSignature = JSON.stringify([
      context.documentId,
      context.uri,
      context.version,
      context.state,
      context.generation,
      context.viewId,
      this.query,
    ]);
    const rebuild = contentSignature !== this.contentSignature;
    this.contentSignature = contentSignature;
    // Toolbox rows derive from the filter alone, never from the document:
    // republishing them on every edit replaces each row inside a pointer
    // gesture, and the list then reports the click on their common ancestor, so
    // the row's command never runs.
    const filterRebuild = this.query !== this.lastFilter;
    this.lastFilter = this.query;
    const create = (
      label: string,
      key: string,
      parent?: Row,
      node?: NavigationNode,
      component?: ComponentEntry,
    ): Row => {
      const row: Row = {
        label,
        key,
        ...(parent ? { parent } : {}),
        ...(node ? { node } : {}),
        ...(component ? { component } : {}),
        authority,
        children: [],
      };
      this.owned.add(row);
      if (parent) parent.children.push(row);
      return row;
    };
    for (const provider of this.providers) {
      let roots: Row[] = [];
      const rowsRebuild =
        provider.kind === 'components' ? filterRebuild : rebuild;
      // The TreeView message setter has no equality guard, so every write fires the
      // extension host data event and reopens its 200 ms debounce in front of the
      // row refresh below: write the view chrome only when its value changed.
      const message = stateMessage(provider.kind, context.state);
      // The header may only claim the report the next fetch will paint: it is
      // published with those rows, so it can never lead its own projection.
      provider.pendingDescription =
        provider.view.description === report ? undefined : report;
      if (provider.view.message !== message) provider.view.message = message;
      provider.insertionReason = insertionReason(context.state);
      provider.scene = evaluation?.scene ?? null;
      const selection = this.host.selection;
      provider.pending = this.host.pendingTargets;
      provider.pendingComponents = this.host.pendingComponents;
      provider.selection =
        selection?.version === context.version
          ? selection.selection
          : { mode: 'empty' };
      if (rowsRebuild && provider.kind === 'components') {
        roots = filterComponents(this.query).map((category) => {
          const parent = create(category.label, `category:${category.label}`);
          category.entries.forEach((entry) =>
            create(
              entry.label,
              `component:${entry.kind}`,
              parent,
              undefined,
              entry,
            ),
          );
          return parent;
        });
        if (!roots.length) {
          roots = [
            create('No components match. Use Clear Filter.', 'empty-filter'),
          ];
        }
      } else if (
        provider.kind !== 'components' &&
        rebuild &&
        evaluation &&
        context.state !== 'invalid-source' &&
        context.state !== 'loading'
      ) {
        const projection = evaluation.navigation[provider.kind];
        const byId = new Map<string, Row>();
        const identities = new Map<string, number>();
        const paths = new Map<string, string>();
        const ancestry = new Map<string, readonly unknown[]>();
        const stableAncestors = new Set<string>();
        for (const node of projection.nodes) {
          const segments = [
            ...(node.parentId ? (ancestry.get(node.parentId) ?? []) : []),
            [node.expandedName, node.name],
          ];
          ancestry.set(node.id, segments);
          const path = JSON.stringify(segments);
          paths.set(node.id, path);
          identities.set(path, (identities.get(path) ?? 0) + 1);
        }
        const grouped =
          provider.kind === 'data'
            ? groupDataCategories(projection.nodes, evaluation.syntax)
            : null;
        const categoryRows = new Map<DataCategoryKey, Row>();
        const categoryOf = new Map<string, DataCategoryKey>();
        if (grouped) {
          for (const group of grouped.categories) {
            const row = create(group.label, `data-category:${group.key}`);
            categoryRows.set(group.key, row);
            roots.push(row);
            for (const node of group.nodes) categoryOf.set(node.id, group.key);
          }
        }
        for (const node of projection.nodes) {
          let parent = node.parentId ? byId.get(node.parentId) : undefined;
          if (!parent && grouped) {
            // No supported collection claims it: keep the row visible at the root
            // instead of inventing a category for it.
            const key = categoryOf.get(node.id);
            parent = key === undefined ? undefined : categoryRows.get(key);
          }
          const path = paths.get(node.id)!;
          const stable =
            (node.parentId === null || stableAncestors.has(node.parentId)) &&
            identities.get(path) === 1 &&
            (node.name !== null ||
              ['report', 'sections', 'section', 'body'].includes(node.kind));
          if (stable) stableAncestors.add(node.id);
          const row = create(
            node.label,
            `${context.documentId}:${stable ? path : node.id}`,
            parent,
            node,
          );
          byId.set(node.id, row);
          if (!parent) roots.push(row);
        }
        for (const parent of categoryRows.values())
          if (!parent.children.length)
            create(
              projection.truncated
                ? 'Inventory incomplete; inspect Code XML.'
                : 'No definitions.',
              `${parent.key}:empty`,
              parent,
            );
        // Definitions no supported collection claims stay visible at the root and
        // say the inventory is incomplete instead of borrowing a category.
        if (grouped?.unassigned.length && !projection.truncated)
          roots.push(
            create(
              'Unrecognized definitions; inventory incomplete. Inspect Code XML.',
              'data:unassigned',
            ),
          );
        if (projection.truncated)
          roots.push(
            create(
              'Navigation incomplete. Inspect Code XML for the complete report.',
              `${provider.kind}:truncated`,
            ),
          );
      }
      if (rowsRebuild) provider.setRows(roots);
      else {
        // Rows that survive a context change only move their authority: their
        // content is unchanged, so republishing them would repaint rows a
        // pointer gesture may already be holding.
        provider.retag(authority);
        provider.updateCues();
      }
      // Toolbox rows belong to no document, so their header never waits on a
      // repaint — including the first one the constructor owes — and the armed
      // value is what keeps an unchanged refresh from rewriting it.
      if (provider.kind === 'components') provider.flushDescription();
      const primary =
        provider.selection.mode === 'body'
          ? provider.selection.primaryId
          : provider.selection.mode === 'empty'
            ? null
            : provider.selection.targetId;
      const row = primary ? provider.find(primary) : undefined;
      if (!primary) provider.lastReveal = '';
      const revealKey = JSON.stringify([
        context.documentId,
        context.viewId,
        primary,
      ]);
      if (row && provider.view.visible && provider.lastReveal !== revealKey) {
        provider.lastReveal = revealKey;
        const accepted = provider.selection;
        const own = this.ownReveal;
        // The tree the user just clicked already shows this row with its
        // ancestors open; a programmatic reveal would only reset that scroll.
        if (
          own &&
          own.authority === authority &&
          own.provider === provider &&
          accepted.mode === 'body' &&
          own.selection ===
            JSON.stringify([accepted.targetIds, accepted.primaryId])
        )
          this.ownReveal = null;
        else
          void Promise.resolve(
            provider.view.reveal(row, {
              focus: false,
              select: false,
              expand: true,
            }),
          ).catch(() => {});
      }
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}

class NativeView implements vscode.TreeDataProvider<Row>, vscode.Disposable {
  lastReveal = '';
  /** Description owed to this view; published with the rows it describes. */
  pendingDescription: string | undefined = undefined;
  private readonly changed = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly view: vscode.TreeView<Row>;
  private roots: Row[] = [];
  private cues = new WeakMap<Row, string>();
  /**
   * Row keys the user folded. The host drops fold state beneath a collapsed
   * ancestor on refresh, so the provider reports it back instead of Expanded.
   * In memory only, pruned to the current rows.
   */
  private readonly collapsed = new Set<string>();
  selection: import('@rdlc/report-model/navigation').NavigationSelection = {
    mode: 'empty',
  };
  pending: ReadonlySet<string> = new Set();
  pendingComponents: ReadonlySet<string> = new Set();
  insertionReason: string | null = null;
  scene: import('@rdlc/report-model/scene').DesignScene | null = null;
  constructor(readonly kind: 'structure' | 'data' | 'components') {
    this.view = vscode.window.createTreeView(`rdlcCode.${kind}`, {
      treeDataProvider: this,
      canSelectMany: kind === 'structure',
    });
    this.view.onDidCollapseElement((event) =>
      this.collapsed.add(event.element.key),
    );
    this.view.onDidExpandElement((event) =>
      this.collapsed.delete(event.element.key),
    );
  }
  setRows(rows: Row[]): void {
    this.roots = rows;
    this.cues = new WeakMap();
    const keys = new Set<string>();
    for (const row of this.allRows()) {
      this.cues.set(row, this.cue(row));
      keys.add(row.key);
    }
    for (const key of this.collapsed)
      if (!keys.has(key)) this.collapsed.delete(key);
    this.changed.fire(undefined);
  }
  /** Rows kept across a context change only adopt its authority. */
  retag(authority: string): void {
    for (const row of this.allRows()) row.authority = authority;
  }
  updateCues(): void {
    let changed = false;
    for (const row of this.allRows()) {
      const cue = this.cue(row);
      if (this.cues.get(row) === cue) continue;
      this.cues.set(row, cue);
      changed = true;
    }
    // One whole-view event per cue pass. A row-level refresh disposes the row it
    // replaces, and that disposal also deletes the cached command identity
    // (`<command> /<n>`) the workbench is still about to execute for the very
    // click that caused this cue change, which surfaces as
    // "Actual command not found" instead of an activation.
    if (changed) this.changed.fire(undefined);
  }
  private *allRows(rows = this.roots): Iterable<Row> {
    for (const row of rows) {
      yield row;
      yield* this.allRows(row.children);
    }
  }
  private cue(row: Row): string {
    if (row.node) {
      const selected =
        this.selection.mode === 'body'
          ? this.selection.targetIds.includes(row.node.id)
          : this.selection.mode !== 'empty' &&
            this.selection.targetId === row.node.id;
      return JSON.stringify([
        this.pending.has(row.node.id),
        selected,
        this.selection.mode === 'body' &&
          this.selection.primaryId === row.node.id,
        selected && this.selection.mode === 'body'
          ? this.selection.targetIds.length
          : 0,
      ]);
    }
    return row.component
      ? JSON.stringify([
          this.pendingComponents.has(row.component.kind),
          this.insertionReason,
        ])
      : '';
  }
  getChildren(row?: Row): Row[] {
    // These are the rows the next paint will show, so the header may claim
    // their report now: it can never lead the projection it describes.
    if (!row) this.flushDescription();
    return row ? row.children : this.roots;
  }
  /** Publish the description owed to this view, if one is pending. */
  flushDescription(): void {
    const description = this.pendingDescription;
    if (description === undefined) return;
    this.pendingDescription = undefined;
    if (this.view.description !== description)
      this.view.description = description;
  }
  getParent(row: Row): Row | undefined {
    return row.parent;
  }
  find(id: string): Row | undefined {
    const visit = (rows: Row[]): Row | undefined => {
      for (const row of rows) {
        if (row.node?.id === id) return row;
        const child = visit(row.children);
        if (child) return child;
      }
      return undefined;
    };
    return visit(this.roots);
  }
  /** Table/group rows expose the owning table, the only surface that owns those forms. */
  private owningTable(row: Row): NavigationNode | undefined {
    for (let parent = row.parent; parent; parent = parent.parent)
      if (parent.node?.kind === 'table') return parent.node;
    return undefined;
  }
  getTreeItem(row: Row): vscode.TreeItem {
    const item = new vscode.TreeItem(
      row.label,
      !row.children.length
        ? vscode.TreeItemCollapsibleState.None
        : this.collapsed.has(row.key)
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded,
    );
    item.id = row.key;
    if (
      row.node ||
      (row.component?.creatable &&
        !this.insertionReason &&
        !this.pendingComponents.has(row.component.kind))
    )
      item.command = {
        command: 'rdlcCode.sidebar.activate',
        title: 'Activate report item',
        arguments: [row],
      };
    if (row.node) {
      const id = row.node.id;
      const selected =
        this.selection.mode === 'body'
          ? this.selection.targetIds.includes(id)
          : this.selection.mode !== 'empty' && this.selection.targetId === id;
      const primary =
        this.selection.mode === 'body' && this.selection.primaryId === id;
      const contextValue = structureContextValue(
        row.node,
        this.owningTable(row),
        this.scene,
      );
      item.contextValue = contextValue;
      item.description = [
        this.pending.has(id) ? 'Pending' : '',
        primary ? 'Primary' : selected ? 'Selected' : '',
        // Only inspect/source-only rows claim it; the projection reason stays in the tooltip.
        contextValue === 'rdlcCode.source' ? 'Source only' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      item.tooltip = `${row.label}\n${row.node.opaqueReason ?? 'Accepted report definition.'}\n${Object.entries(
        row.node.details ?? {},
      )
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')}\nCode XML opens the current source range.`;
      item.iconPath = new vscode.ThemeIcon(
        row.node.kind === 'dataset'
          ? 'database'
          : row.node.kind === 'field'
            ? 'symbol-field'
            : row.node.kind === 'textbox'
              ? 'symbol-string'
              : 'symbol-structure',
      );
      item.accessibilityInformation = {
        label: `${row.label}${item.description ? `, ${item.description}` : ''}${this.selection.mode === 'body' && selected ? `, ${this.selection.targetIds.length} selected` : ''}`,
      };
    } else if (row.component) {
      item.description = this.pendingComponents.has(row.component.kind)
        ? 'Pending'
        : row.component.creatable && !this.insertionReason
          ? 'Insert'
          : 'Unavailable';
      item.tooltip =
        row.component.reason ??
        this.insertionReason ??
        `Insert ${row.component.label} using the associated designer.`;
      item.iconPath = new vscode.ThemeIcon(
        row.component.creatable ? 'add' : 'circle-slash',
      );
      item.accessibilityInformation = {
        label: `${row.label}, ${item.description}. ${item.tooltip}`,
      };
    }
    return item;
  }
  dispose(): void {
    this.view.dispose();
    this.changed.dispose();
  }
}
