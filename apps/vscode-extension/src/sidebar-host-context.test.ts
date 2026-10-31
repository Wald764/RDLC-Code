import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { DocumentSession } from './document-session.js';
import type { SidebarHostContext as HostContext } from './sidebar/host-context.js';

type Listener = () => void;

class FakeEmitter {
  private listeners = new Set<Listener>();
  readonly event = (listener: Listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }
  dispose(): void {
    this.listeners.clear();
  }
}

class FakeDisposable {
  constructor(private readonly callback: () => void) {}
  dispose(): void {
    this.callback();
  }
}

class TabInputCustom {
  constructor(
    readonly uri: FakeUri,
    readonly viewType: string,
  ) {}
}
class TabInputText {}

interface FakeUri {
  toString(): string;
  path: string;
}

const tabs = new FakeEmitter();
const group = {
  viewColumn: 1,
  activeTab: undefined as { input: unknown } | undefined,
};
const executed: string[] = [];
const behavior = { commandFails: false, commandHangs: false };
const windowState = { focused: true };
const fakeVscode = {
  commands: {
    executeCommand: async (command: string) => {
      executed.push(command);
      if (behavior.commandHangs) await new Promise(() => {});
      if (behavior.commandFails) throw new Error('command failed');
    },
  },
  EventEmitter: FakeEmitter,
  Disposable: FakeDisposable,
  TabInputCustom,
  TabInputText,
  window: {
    state: windowState,
    onDidChangeActiveTextEditor: new FakeEmitter().event,
    tabGroups: {
      get activeTabGroup() {
        return group;
      },
      onDidChangeTabs: tabs.event,
      onDidChangeTabGroups: new FakeEmitter().event,
    },
  },
  workspace: {
    textDocuments: [] as unknown[],
    onDidOpenTextDocument: new FakeEmitter().event,
    onDidSaveTextDocument: new FakeEmitter().event,
    onDidRenameFiles: new FakeEmitter().event,
    onDidChangeTextDocument: new FakeEmitter().event,
    onDidCloseTextDocument: new FakeEmitter().event,
  },
};
(globalThis as Record<string, unknown>)['__rdlcFakeVscode'] = fakeVscode;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'vscode'
      ? { url: 'rdlc-test:vscode', shortCircuit: true }
      : next(specifier, context),
  load: (url, context, next) =>
    url === 'rdlc-test:vscode'
      ? {
          format: 'module',
          shortCircuit: true,
          source: [
            'const v = globalThis.__rdlcFakeVscode;',
            ...Object.keys(fakeVscode).map(
              (name) => `export const ${name} = v.${name};`,
            ),
          ].join('\n'),
        }
      : next(url, context),
});
const { SidebarHostContext, isDroppedOutcome } = await import(
  './sidebar/host-context.js'
);

const uri: FakeUri = {
  path: '/report.rdlc',
  toString: () => 'file:///report.rdlc',
};
const document = {
  uri,
  version: 1,
  isClosed: false,
  isUntitled: false,
  languageId: 'xml',
  eol: 1,
  getText: () => '<Report/>',
};
const editableReport =
  '<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">' +
  '<ReportSections><ReportSection><Width>8.5in</Width><Page><PageWidth>8.5in</PageWidth>' +
  '<PageHeight>11in</PageHeight><TopMargin>0in</TopMargin><RightMargin>0in</RightMargin>' +
  '<BottomMargin>0in</BottomMargin><LeftMargin>0in</LeftMargin></Page>' +
  '<Body><Height>11in</Height><ReportItems/></Body></ReportSection></ReportSections></Report>';

// Module-global fakes are shared by every test: start each one from a clean slate.
beforeEach(() => {
  group.viewColumn = 1;
  group.activeTab = undefined;
  executed.length = 0;
  behavior.commandFails = false;
  behavior.commandHangs = false;
  windowState.focused = true;
  fakeVscode.workspace.textDocuments = [];
  document.getText = () => '<Report/>';
});

function panel(viewColumn: number) {
  const state = new FakeEmitter();
  return {
    viewColumn,
    active: false,
    visible: true,
    onDidChangeViewState: state.event,
    changeViewState: () => state.fire(),
    revealed: 0,
    revealArgs: [] as unknown[][],
    reveal(...args: unknown[]) {
      this.revealed += 1;
      this.revealArgs.push(args);
    },
    webview: { postMessage: async () => true },
  };
}

type Panel = ReturnType<typeof panel>;

function session() {
  return {
    evaluation: undefined,
    currentSelection: null,
    onEvaluation: () => new FakeDisposable(() => {}),
    onSelection: () => new FakeDisposable(() => {}),
    setViewIdentity: () => {},
  };
}

function setup() {
  fakeVscode.workspace.textDocuments = [document];
  const host: HostContext = new SidebarHostContext();
  const one = panel(1);
  const two = panel(2);
  for (const entry of [one, two])
    host.register(
      document as never,
      entry as never,
      session() as unknown as DocumentSession,
    );
  const activate = (column: number) => {
    group.viewColumn = column;
    group.activeTab = {
      input: new TabInputCustom(uri, 'rdlcCode.designer'),
    };
  };
  return { host, one, two, activate };
}

test('tab activation binds the matching view before panel.active is reported', () => {
  const { host, one, two, activate } = setup();
  one.active = true;
  activate(1);
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-1');

  // View 2's tab becomes active first; view 2 still reports active=false.
  activate(2);
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-2');

  two.active = true;
  one.active = false;
  two.changeViewState();
  one.changeViewState();
  assert.equal(host.registry.context().viewId, 'view-2');

  // Back to view 1: tab change arrives while both panels still report stale flags.
  activate(1);
  one.active = false;
  two.active = true;
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-1');
  host.dispose();
});

test('a panel reporting active rebinds when it agrees with the active tab group', () => {
  const { host, one, two, activate } = setup();
  activate(2);
  two.active = true;
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-2');

  // The group moved to column 1 and its panel reports active: no tab event needed.
  activate(1);
  two.active = false;
  one.active = true;
  one.changeViewState();
  assert.equal(host.registry.context().viewId, 'view-1');
  host.dispose();
});

test('a stale active panel never outvotes the active tab group', () => {
  const { host, one, two, activate } = setup();
  // Split: VS Code focuses the new group, then hands focus back to column 1.
  activate(2);
  two.active = true;
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-2');
  activate(1);
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-1');

  // View 2 still reports active=true when its view-state event is delivered
  // after the tab-group change: the tab group (column 1) wins.
  one.active = false;
  two.active = true;
  two.changeViewState();
  assert.equal(host.registry.context().viewId, 'view-1');

  // The group state is also respected when the stale event precedes the tab event.
  activate(2);
  two.active = true;
  tabs.fire();
  assert.equal(host.registry.context().viewId, 'view-2');
  group.viewColumn = 1;
  two.changeViewState();
  assert.equal(host.registry.context().viewId, 'view-1');
  host.dispose();
});

test('a panel reporting active is honoured when no tab is reported', () => {
  const { host, one } = setup();
  group.activeTab = undefined;
  one.active = true;
  one.changeViewState();
  assert.equal(host.registry.context().viewId, 'view-1');
  host.dispose();
});

/** A ready session whose designer answers every native action with `status`. */
function readySession(
  status: 'accepted' | 'refused',
  beforeOutcome?: () => void,
) {
  const listeners = new Set<(outcome: unknown) => void>();
  return {
    ...session(),
    isReady: true,
    onActionOutcome: (listener: (outcome: unknown) => void) => {
      listeners.add(listener);
      return new FakeDisposable(() => listeners.delete(listener));
    },
    cancelNativeAction: () => {},
    dispatchNativeAction: async (message: { requestId: string }) => {
      beforeOutcome?.();
      for (const listener of listeners)
        listener({
          requestId: message.requestId,
          status,
          ...(status === 'refused' ? { reason: 'No.' } : {}),
        });
      return { delivered: true };
    },
  };
}

function focusSetup(
  status: 'accepted' | 'refused',
  beforeOutcome?: (views: { one: Panel; two: Panel }) => void,
) {
  fakeVscode.workspace.textDocuments = [document];
  document.getText = () => editableReport;
  executed.length = 0;
  const host: HostContext = new SidebarHostContext();
  const one = panel(1);
  const two = panel(2);
  for (const entry of [one, two])
    host.register(
      document as never,
      entry as never,
      readySession(status, () =>
        beforeOutcome?.({ one, two }),
      ) as unknown as DocumentSession,
    );
  // The user works in view 2; both panels are visible, only it is the active tab.
  group.viewColumn = 2;
  group.activeTab = { input: new TabInputCustom(uri, 'rdlcCode.designer') };
  two.active = true;
  two.changeViewState();
  return { host, one, two };
}

test('an accepted native insert reveals and focuses the panel that took it', async () => {
  const { host, one, two } = focusSetup('accepted');
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(two.revealed, 1);
    assert.equal(one.revealed, 0);
    assert.deepEqual(two.revealArgs, [[2, false]]);
    assert.deepEqual(executed, ['workbench.action.focusActiveEditorGroup']);
  } finally {
    host.dispose();
  }
});

test('native selection leaves focus where the user put it', async () => {
  const { host, one, two } = focusSetup('accepted');
  try {
    const id = host.evaluation?.syntax.root?.id;
    assert.ok(id);
    const outcome = await host.dispatch(
      { action: 'select', primaryId: id, additive: false },
      [id],
    );
    assert.equal(outcome.status, 'accepted');
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('a refused native insert does not take focus', async () => {
  const { host, one, two } = focusSetup('refused');
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'refused');
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('an accepted insert does not take focus from an inactive panel', async () => {
  const { host, one, two } = focusSetup('accepted', ({ two }) => {
    two.active = false;
  });
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('an accepted insert does not take focus once the window lost focus', async () => {
  const { host, one, two } = focusSetup('accepted', () => {
    windowState.focused = false;
  });
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('an accepted insert does not take focus after the user moved to another view', async () => {
  const { host, one, two } = focusSetup('accepted', ({ one, two }) => {
    group.viewColumn = 1;
    one.active = true;
    two.active = false;
    one.changeViewState();
  });
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(host.registry.context().viewId, 'view-1');
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('an accepted insert does not take focus after the user left every report', async () => {
  const ref: { host?: HostContext } = {};
  const { host, one, two } = focusSetup('accepted', () => {
    group.activeTab = undefined;
    ref.host?.refreshFocus();
  });
  ref.host = host;
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(host.registry.context().viewId, null);
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('an older insert does not take focus once a later native action was dispatched', async () => {
  let later: Promise<unknown> | undefined;
  let started = false;
  const ref: { host?: HostContext } = {};
  const { host, one, two } = focusSetup('accepted', () => {
    // dispatch() reaches this hook synchronously: guard against re-entrance.
    if (started || !ref.host) return;
    started = true;
    const id = ref.host.evaluation?.syntax.root?.id;
    if (id)
      later = ref.host.dispatch(
        { action: 'select', primaryId: id, additive: false },
        [id],
      );
  });
  ref.host = host;
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.ok(later);
    await later;
    assert.equal(one.revealed + two.revealed, 0);
    assert.deepEqual(executed, []);
  } finally {
    host.dispose();
  }
});

test('a failing focus command never turns an accepted insert into a failure', async () => {
  behavior.commandFails = true;
  const { host, two } = focusSetup('accepted');
  try {
    const outcome = await host.dispatch({
      action: 'create',
      create: 'textbox',
    });
    assert.equal(outcome.status, 'accepted');
    assert.equal(two.revealed, 1);
    assert.deepEqual(executed, ['workbench.action.focusActiveEditorGroup']);
    // Let the swallowed rejection settle: an unhandled one would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    host.dispose();
  }
});

test('the insert outcome does not wait for the focus command', async () => {
  behavior.commandHangs = true;
  const { host } = focusSetup('accepted');
  try {
    const outcome = await Promise.race([
      host.dispatch({ action: 'create', create: 'textbox' }),
      new Promise<string>((resolve) => setTimeout(() => resolve('late'), 2000)),
    ]);
    assert.notEqual(outcome, 'late');
  } finally {
    host.dispose();
  }
});

/**
 * A ready designer that, like the real one, refuses a native action while
 * another is pending. Each delivered action waits for `settle()`; `failNext`
 * makes the next delivery fail instead.
 */
function gatedSetup() {
  document.version = 1;
  fakeVscode.workspace.textDocuments = [document];
  document.getText = () => editableReport;
  const listeners = new Set<(outcome: unknown) => void>();
  const log = {
    started: [] as string[],
    overlaps: 0,
    inflight: 0,
    failNext: false,
    gates: [] as Array<() => void>,
  };
  const gated = {
    ...session(),
    isReady: true,
    onActionOutcome: (listener: (outcome: unknown) => void) => {
      listeners.add(listener);
      return new FakeDisposable(() => listeners.delete(listener));
    },
    cancelNativeAction: () => {},
    dispatchNativeAction: async (message: {
      requestId: string;
      action: string;
    }) => {
      if (log.inflight > 0) log.overlaps += 1;
      log.started.push(message.action);
      if (log.failNext) {
        log.failNext = false;
        return { delivered: false, reason: 'Delivery failed.' };
      }
      log.inflight += 1;
      void new Promise<void>((resolve) => log.gates.push(resolve)).then(() => {
        log.inflight -= 1;
        // An insert applies a document edit; a selection never changes the version.
        if (message.action === 'create') {
          document.version += 1;
          (host as unknown as { accept(value: unknown): unknown }).accept(
            document,
          );
        }
        for (const listener of listeners)
          listener({ requestId: message.requestId, status: 'accepted' });
      });
      return { delivered: true };
    },
  };
  const host: HostContext = new SidebarHostContext();
  host.register(
    document as never,
    panel(1) as never,
    gated as unknown as DocumentSession,
  );
  group.viewColumn = 1;
  group.activeTab = { input: new TabInputCustom(uri, 'rdlcCode.designer') };
  host.refreshFocus();
  // Resolved per call: a new document version issues new target ids.
  const select = (options?: Parameters<HostContext['dispatch']>[2]) => {
    const id = host.evaluation?.syntax.root?.id;
    assert.ok(id);
    return host.dispatch(
      { action: 'select', primaryId: id, additive: false },
      [id],
      options,
    );
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  const settleNext = async () => {
    await tick();
    const gate = log.gates.shift();
    assert.ok(gate, 'an action is waiting at the designer');
    gate();
  };
  return { host, log, select, tick, settleNext };
}

test('a rejected dispatch lets the next queued action proceed', async () => {
  const { host, log, select, settleNext } = gatedSetup();
  try {
    log.failNext = true;
    const create = host.dispatch({ action: 'create', create: 'textbox' });
    const failed = assert.rejects(create, /Delivery failed/);
    const next = host.dispatch({ action: 'create', create: 'textbox' });
    await failed;
    await settleNext();
    assert.equal((await next).status, 'accepted');
    const after = select();
    await settleNext();
    assert.equal((await after).status, 'accepted');
    assert.equal(log.overlaps, 0);
  } finally {
    host.dispose();
  }
});

test('queued selections coalesce to the latest pending one', async () => {
  const { host, log, select, tick, settleNext } = gatedSetup();
  try {
    const running = select();
    await tick();
    assert.equal(log.started.length, 1);
    const older = select();
    const newer = select();
    // The superseded selection resolves at once, without waiting for the designer.
    const droppedOutcome = await older;
    assert.ok(isDroppedOutcome(droppedOutcome));
    await settleNext();
    assert.equal((await running).status, 'accepted');
    await settleNext();
    const outcome = await newer;
    assert.equal(outcome.status, 'accepted');
    assert.ok(!isDroppedOutcome(outcome));
    assert.deepEqual(log.started, ['select', 'select']);
    assert.equal(log.overlaps, 0);
  } finally {
    host.dispose();
  }
});

test('a select never drops a queued non-select action', async () => {
  const { host, log, select, tick, settleNext } = gatedSetup();
  try {
    const running = select();
    await tick();
    const create = host.dispatch({ action: 'create', create: 'textbox' });
    const later = select();
    await settleNext();
    await running;
    await settleNext();
    const created = await create;
    assert.equal(created.status, 'accepted');
    assert.ok(!isDroppedOutcome(created));
    // The insert changed the document version: the select captured before it
    // is refused, never rebased onto the new version.
    await assert.rejects(
      later,
      /report or designer changed while the action was being delivered/,
    );
    assert.deepEqual(log.started, ['select', 'create']);
    assert.equal(log.overlaps, 0);
  } finally {
    host.dispose();
  }
});

test('a second insert captured before the first applied is refused as stale', async () => {
  const { host, log, tick, settleNext } = gatedSetup();
  try {
    const first = host.dispatch({ action: 'create', create: 'textbox' });
    const second = host.dispatch({ action: 'create', create: 'textbox' });
    const refusal = assert.rejects(
      second,
      /report or designer changed while the action was being delivered/,
    );
    await tick();
    assert.deepEqual(log.started, ['create'], 'the second waits for the first');
    await settleNext();
    assert.equal((await first).status, 'accepted');
    await refusal;
    assert.deepEqual(
      log.started,
      ['create'],
      'the stale insert never delivers',
    );
    assert.equal(log.overlaps, 0);
    assert.equal(host.registry.pendingCount, 0);
    // A fresh capture after the settlement applies normally.
    const third = host.dispatch({ action: 'create', create: 'textbox' });
    await settleNext();
    assert.equal((await third).status, 'accepted');
  } finally {
    host.dispose();
  }
});

test('a select queued after an insert waits for it and is then dropped or refused as stale', async () => {
  const { host, log, select, tick, settleNext } = gatedSetup();
  try {
    const create = host.dispatch({ action: 'create', create: 'textbox' });
    await tick();
    // A caller whose rows went stale with the version drops silently...
    const silent = select({ beforeDispatch: () => false });
    // ...and one that does not guard is refused by the host.
    const loud = select();
    // Selections coalesce: only the latest waiting one is still pending.
    assert.ok(isDroppedOutcome(await silent));
    const refusal = assert.rejects(
      loud,
      /report or designer changed while the action was being delivered/,
    );
    await tick();
    assert.deepEqual(
      log.started,
      ['create'],
      'the select waits for the insert',
    );
    await settleNext();
    assert.equal((await create).status, 'accepted');
    await refusal;
    assert.deepEqual(log.started, ['create']);
    assert.equal(log.overlaps, 0);
    assert.equal(
      (host as unknown as { dispatchSequence: number }).dispatchSequence,
      3,
    );
    assert.equal(host.registry.pendingCount, 0);
  } finally {
    host.dispose();
  }
});

test('an action stale after its wait is dropped without reaching the designer', async () => {
  const { host, log, select, tick, settleNext } = gatedSetup();
  try {
    const running = select();
    await tick();
    let stale = false;
    const queued = select({ beforeDispatch: () => !stale });
    stale = true;
    await settleNext();
    await running;
    const outcome = await queued;
    assert.ok(isDroppedOutcome(outcome));
    assert.deepEqual(log.started, ['select']);
    // A guard that throws refuses the action instead, and the chain survives.
    const running2 = select();
    await tick();
    const refused = host.dispatch({ action: 'create', create: 'textbox' }, [], {
      beforeDispatch: () => {
        throw new Error('stale row');
      },
    });
    const refusal = assert.rejects(refused, /stale row/);
    await settleNext();
    await running2;
    await refusal;
    const next = select();
    await settleNext();
    assert.equal((await next).status, 'accepted');
    assert.equal(log.overlaps, 0);
  } finally {
    host.dispose();
  }
});
