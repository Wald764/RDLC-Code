import * as vscode from 'vscode';
import {
  filterComponents,
  type ComponentEntry,
  type CreationKind,
} from '@rdlc/report-model/components';
import type { NavigationNode } from '@rdlc/report-model/navigation';
import { SidebarHostContext } from './host-context.js';
import { clipboardIntent } from './actions.js';

interface Row {
  readonly key: string;
  readonly label: string;
  readonly parent?: Row;
  readonly node?: NavigationNode;
  readonly component?: ComponentEntry;
  readonly children: Row[];
  readonly authority: string;
}

/** Native display rows have no authority until their owned activation is rechecked. */
export class SidebarViews implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly providers: NativeView[];
  private readonly owned = new WeakSet<Row>();
  private query = '';
  private lastReport = '';
  private contentSignature = '';
  private lastTreeSelection = '';
  private readonly selecting = new Set<string>();

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
        const outcome = await this.host.dispatch(intent, [row.node.id]);
        if (outcome.status !== 'accepted')
          throw new Error(
            outcome.reason ?? 'The clipboard action was cancelled.',
          );
      });
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

  private async activate(
    input?: Row,
    nativeRows?: readonly Row[],
  ): Promise<void> {
    const row = this.checked(input);
    if (row.component) {
      if (!row.component.creatable) throw new Error(row.component.reason!);
      const outcome = await this.host.dispatch({
        action: 'create',
        create: row.component.kind as CreationKind,
      });
      if (outcome.status !== 'accepted')
        throw new Error(outcome.reason ?? 'Insertion was cancelled.');
    } else if (row.node) {
      const selected = this.providers[0]!.view.selection;
      const rows =
        nativeRows ??
        (selected.some((candidate) => candidate.key === row.key) &&
        selected.length > 1
          ? selected
          : [row]);
      rows.forEach((candidate) => this.checked(candidate));
      if (rows.some((candidate) => !candidate.node))
        throw new Error('Choose report nodes only.');
      const signature = JSON.stringify([
        row.authority,
        rows.map((candidate) => candidate.node!.id),
        row.node.id,
      ]);
      if (this.selecting.has(signature)) return;
      this.selecting.add(signature);
      try {
        const outcome = await this.host.dispatch(
          { action: 'select', primaryId: row.node.id, additive: false },
          rows.map((candidate) => candidate.node!.id),
        );
        if (outcome.status !== 'accepted')
          throw new Error(outcome.reason ?? 'Selection was cancelled.');
      } finally {
        this.selecting.delete(signature);
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
    const outcome = await this.host.dispatch({ action: 'properties' }, [
      row.node.id,
    ]);
    if (outcome.status !== 'accepted')
      throw new Error(outcome.reason ?? 'Properties were cancelled.');
  }

  private async source(input?: Row): Promise<void> {
    const row = this.checked(input);
    if (!row.node) throw new Error('Choose an authored report node.');
    await this.host.openSource(row.node.id);
  }

  private refresh(): void {
    const context = this.host.registry.context();
    const evaluation = this.host.evaluation;
    const authority = this.authority();
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
      provider.view.description = report;
      provider.insertionReason =
        context.state === 'editable'
          ? null
          : 'Open an editable report to insert components.';
      provider.view.message =
        context.state === 'no-report'
          ? 'Open or create a report to begin.'
          : context.state === 'loading'
            ? 'Loading accepted report…'
            : context.state === 'invalid-source'
              ? 'Invalid XML. Open Code XML to repair this report.'
              : context.state === 'source-only'
                ? 'Source-only report. Inspection and Code XML are available.'
                : '';
      const selection = this.host.selection;
      provider.pending = this.host.pendingTargets;
      provider.pendingComponents = this.host.pendingComponents;
      provider.selection =
        selection?.version === context.version
          ? selection.selection
          : { mode: 'empty' };
      if (rebuild && provider.kind === 'components') {
        provider.view.message =
          `${provider.view.message ?? ''} Native drag is unavailable. Activate Textbox, Table or Dataset to insert; use the compact designer fallback for drag.`.trim();
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
        const categories = new Map<string, Row>();
        if (provider.kind === 'data')
          for (const label of [
            'Datasets / Fields',
            'Parameters',
            'Embedded Images',
            'Data Sources',
          ]) {
            const row = create(label, `data-category:${label}`);
            categories.set(label, row);
            roots.push(row);
          }
        for (const node of projection.nodes) {
          let parent = node.parentId ? byId.get(node.parentId) : undefined;
          if (provider.kind === 'data' && !parent) {
            const label =
              {
                dataset: 'Datasets / Fields',
                field: 'Datasets / Fields',
                parameter: 'Parameters',
                'embedded-image': 'Embedded Images',
                'data-source': 'Data Sources',
              }[node.kind as 'dataset'] ?? 'Datasets / Fields';
            parent = categories.get(label);
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
        if (provider.kind === 'data')
          for (const parent of categories.values())
            if (!parent.children.length)
              create(
                projection.truncated
                  ? 'Inventory incomplete; inspect Code XML.'
                  : 'No definitions.',
                `${parent.key}:empty`,
                parent,
              );
        if (projection.truncated)
          roots.push(
            create(
              'Navigation incomplete. Inspect Code XML for the complete report.',
              `${provider.kind}:truncated`,
            ),
          );
      }
      if (rebuild) provider.setRows(roots);
      else provider.updateCues();
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
  private readonly changed = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly view: vscode.TreeView<Row>;
  private roots: Row[] = [];
  private cues = new WeakMap<Row, string>();
  selection: import('@rdlc/report-model/navigation').NavigationSelection = {
    mode: 'empty',
  };
  pending: ReadonlySet<string> = new Set();
  pendingComponents: ReadonlySet<string> = new Set();
  insertionReason: string | null = null;
  constructor(readonly kind: 'structure' | 'data' | 'components') {
    this.view = vscode.window.createTreeView(`rdlcCode.${kind}`, {
      treeDataProvider: this,
      canSelectMany: kind === 'structure',
    });
  }
  setRows(rows: Row[]): void {
    this.roots = rows;
    this.cues = new WeakMap();
    for (const row of this.allRows()) this.cues.set(row, this.cue(row));
    this.changed.fire(undefined);
  }
  updateCues(): void {
    for (const row of this.allRows()) {
      const cue = this.cue(row);
      if (this.cues.get(row) === cue) continue;
      this.cues.set(row, cue);
      this.changed.fire(row);
    }
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
    return row ? row.children : this.roots;
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
  getTreeItem(row: Row): vscode.TreeItem {
    const item = new vscode.TreeItem(
      row.label,
      row.children.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
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
      item.contextValue = row.node.capabilities.some(
        (capability) =>
          capability.operation === 'clipboard' && capability.eligible,
      )
        ? 'rdlcCode.body'
        : row.node.capabilities.some(
              (capability) =>
                capability.operation === 'properties' && capability.eligible,
            )
          ? 'rdlcCode.editable'
          : 'rdlcCode.source';
      item.description = [
        this.pending.has(id) ? 'Pending' : '',
        primary ? 'Primary' : selected ? 'Selected' : '',
        row.node.opaqueReason ? 'Source only' : '',
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
