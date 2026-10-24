import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WindowContextRegistry,
  type CapturedAction,
  type CaptureResult,
  type TerminatedCapture,
} from './sidebar/context.js';

function captured(result: CaptureResult): CapturedAction {
  if (!result.ok) assert.fail(`Capture refused: ${result.reason}`);
  return result.capture;
}

function editable(
  registry: WindowContextRegistry,
  handle: object,
  uri = 'file:///report.rdlc',
  version = 1,
): string {
  const id = registry.openDocument(handle, uri, version);
  registry.focusDocument(id);
  registry.setEvaluation(id, {
    state: 'editable',
    version,
    targets: ['t1', 't2'],
    capabilities: ['inspect', 'source', 'author'],
  });
  return id;
}

test('context moves no-report → loading → evaluated, retains on sidebar focus and clears on non-report', () => {
  const registry = new WindowContextRegistry();
  assert.deepEqual(registry.context(), {
    state: 'no-report',
    documentId: null,
    uri: null,
    version: 0,
    generation: 0,
    viewId: null,
  });
  assert.deepEqual(registry.capture('r1', 'inspect'), {
    ok: false,
    reason: 'no-report',
  });

  const handle = {};
  const id = registry.openDocument(handle, 'file:///a.rdlc', 1);
  // Registration alone does not steal context.
  assert.equal(registry.context().state, 'no-report');
  const loading = registry.focusDocument(id);
  assert.equal(loading.state, 'loading');
  assert.equal(loading.uri, 'file:///a.rdlc');
  assert.equal(loading.version, 1);
  assert.deepEqual(registry.capture('r1', 'inspect'), {
    ok: false,
    reason: 'loading',
  });

  registry.setEvaluation(id, {
    state: 'editable',
    version: 1,
    targets: ['t1'],
    capabilities: ['inspect'],
  });
  const active = registry.context();
  assert.equal(active.state, 'editable');
  const capture = captured(registry.capture('r1', 'inspect', ['t1']));
  assert.equal(capture.documentId, id);
  assert.equal(capture.baseVersion, 1);
  assert.equal(capture.viewId, null);
  assert.equal(capture.contextGeneration, active.generation);

  const retained = registry.focusSidebar();
  assert.equal(retained.generation, active.generation);
  assert.equal(retained.documentId, id);
  assert.equal(registry.revalidate(capture), null);

  const cleared = registry.focusOther();
  assert.equal(cleared.state, 'no-report');
  assert.equal(cleared.generation, active.generation + 1);
  assert.equal(registry.revalidate(capture), 'stale-document');

  const restored = registry.focusDocument(id);
  assert.equal(restored.state, 'editable');
  assert.equal(registry.revalidate(capture), 'stale-context');

  registry.closeDocument(id);
  assert.equal(registry.context().state, 'no-report');
});

test('a reopened URI gets a new lifetime and never reuses old views or captures', () => {
  const registry = new WindowContextRegistry();
  const first = {};
  const firstId = editable(registry, first, 'file:///same.rdlc');
  const viewId = registry.registerView(firstId);
  const capture = captured(registry.capture('old', 'inspect', ['t1']));
  assert.equal(capture.viewId, viewId);

  registry.closeDocument(firstId);
  assert.equal(registry.revalidate(capture), 'stale-document');

  const second = {};
  const secondId = registry.openDocument(second, 'file:///same.rdlc', 1);
  assert.notEqual(secondId, firstId);
  assert.equal(registry.openDocument(second, 'file:///same.rdlc', 1), secondId);

  registry.focusDocument(secondId);
  assert.equal(registry.context().state, 'loading');
  assert.equal(registry.context().version, 1);
  assert.equal(registry.context().viewId, null);
  assert.throws(() => registry.focusDocument(firstId), /Unknown document/);
});

test('source focus keeps the last surviving designer of the same document only', () => {
  const registry = new WindowContextRegistry();
  const a = {};
  const aId = editable(registry, a, 'file:///a.rdlc');
  const first = registry.registerView(aId);
  const second = registry.registerView(aId);
  assert.equal(registry.focusView(second).viewId, second);
  assert.equal(registry.focusDocument(aId).viewId, second);

  registry.disposeView(second);
  assert.equal(registry.focusDocument(aId).viewId, first);

  const b = {};
  const bId = editable(registry, b, 'file:///b.rdlc');
  const bView = registry.registerView(bId);
  assert.equal(registry.focusDocument(bId).viewId, bView);
  assert.equal(registry.focusDocument(aId).viewId, first);

  registry.disposeView(first);
  assert.equal(registry.focusDocument(aId).viewId, null);
  const preliminary = captured(registry.capture('nav', 'author', ['t1']));
  assert.equal(preliminary.viewId, null);
  assert.equal(registry.revalidate(preliminary), null);
});

test('source-only evaluation allows inspection but refuses mutations before opening', () => {
  const registry = new WindowContextRegistry();
  const id = registry.openDocument({}, 'file:///readonly.rdlc', 4);
  registry.focusDocument(id);
  registry.setEvaluation(id, {
    state: 'source-only',
    version: 4,
    targets: ['s1'],
    capabilities: ['inspect', 'source'],
  });

  assert.equal(registry.context().state, 'source-only');
  assert.equal(registry.context().viewId, null);
  assert.equal(
    captured(registry.capture('inspect', 'inspect', ['s1'])).viewId,
    null,
  );
  assert.deepEqual(registry.capture('author', 'author', ['s1']), {
    ok: false,
    reason: 'unsupported',
  });
  assert.deepEqual(registry.capture('missing', 'inspect', ['s2']), {
    ok: false,
    reason: 'stale-target',
  });
  assert.equal(registry.pendingCount, 1);
});

test('another view of the same document invalidates captured view-local authority', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {});
  const first = registry.registerView(id);
  registry.focusView(first);
  const capture = captured(registry.capture('first-view', 'author', ['t1']));
  const second = registry.registerView(id);
  assert.equal(
    registry.context().viewId,
    first,
    'background registration does not steal association',
  );
  assert.equal(registry.revalidate(capture), null);
  registry.focusView(second);
  assert.equal(registry.revalidate(capture), 'stale-context');
  registry.focusView(first);
  assert.equal(
    registry.revalidate(capture),
    'stale-context',
    'returning must not revive a pending action',
  );
});

test('preservation-only source identities cannot authorize mutation captures', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {});
  const facts = {
    version: 1,
    state: 'editable' as const,
    targets: ['t1'],
    sourceTargets: ['t1', 'opaque'],
    capabilities: [
      'source',
      'select',
      'inspect',
      'author',
      'clipboard',
      'layout',
      'setProperty',
    ],
  };
  registry.setEvaluation(id, facts);
  for (const capability of ['source', 'select', 'inspect']) {
    assert.equal(
      registry.capture(`inspect-${capability}`, capability, ['opaque']).ok,
      true,
    );
  }
  for (const capability of ['author', 'clipboard', 'layout', 'setProperty']) {
    assert.deepEqual(
      registry.capture(`mutate-${capability}`, capability, ['opaque']),
      { ok: false, reason: 'stale-target' },
    );
  }
  const mutation = captured(registry.capture('mutable', 'author', ['t1']));
  registry.setEvaluation(id, { ...facts, targets: [] });
  assert.equal(
    registry.revalidate(mutation),
    'stale-target',
    'remaining source visibility must not retain mutation authority',
  );
});

test('invalid source clears actionable nodes and refuses captures until valid again', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {});
  const capture = captured(registry.capture('edit', 'author', ['t1']));

  registry.setEvaluation(id, {
    state: 'invalid-source',
    version: 1,
    targets: ['t1'],
    capabilities: ['author'],
  });
  assert.equal(registry.context().state, 'invalid-source');
  assert.equal(registry.revalidate(capture), 'invalid-source');
  assert.deepEqual(registry.capture('again', 'author', ['t1']), {
    ok: false,
    reason: 'invalid-source',
  });

  registry.setEvaluation(id, {
    state: 'editable',
    version: 1,
    targets: ['t1'],
    capabilities: ['author'],
  });
  assert.equal(registry.context().state, 'editable');
  captured(registry.capture('valid', 'author', ['t1']));
});

test('stale versions and stale evaluations cannot resurrect context', () => {
  const registry = new WindowContextRegistry();
  const a = {};
  const aId = editable(registry, a, 'file:///a.rdlc', 3);
  const capture = captured(registry.capture('r', 'inspect', ['t1']));

  assert.equal(registry.documentChanged(aId, 4), true);
  assert.equal(registry.context().state, 'loading');
  assert.equal(registry.revalidate(capture), 'stale-version');
  assert.deepEqual(registry.capture('late', 'inspect', ['t1']), {
    ok: false,
    reason: 'loading',
  });

  // An evaluation for the superseded version is ignored, not replayed.
  assert.equal(
    registry.setEvaluation(aId, {
      state: 'editable',
      version: 3,
      targets: ['t1'],
      capabilities: ['inspect'],
    }),
    false,
  );
  assert.equal(registry.context().state, 'loading');

  assert.equal(
    registry.setEvaluation(aId, {
      state: 'editable',
      version: 4,
      targets: ['t1'],
      capabilities: ['inspect'],
    }),
    true,
  );
  assert.equal(registry.context().version, 4);
  assert.equal(registry.revalidate(capture), 'stale-version');
  assert.equal(registry.documentChanged(aId, 4), false);

  // An inactive document's edit does not disturb the active capture.
  const bId = editable(registry, {}, 'file:///b.rdlc', 1);
  registry.focusDocument(aId);
  const current = captured(registry.capture('current', 'inspect', ['t1']));
  const before = registry.context().generation;
  assert.equal(registry.documentChanged(bId, 2), true);
  assert.equal(registry.context().generation, before);
  assert.equal(registry.revalidate(current), null);
});

test('a content version change keeps the generation; only a class change advances it', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {}, 'file:///a.rdlc', 1);
  const view = registry.registerView(id);
  registry.focusView(view);
  const start = registry.context().generation;
  const capture = captured(registry.capture('own-edit', 'author', ['t1']));
  assert.equal(capture.contextGeneration, start);

  // The correlated edit of a native action changes only content: same class, same generation.
  assert.equal(registry.documentChanged(id, 2), true);
  assert.equal(registry.context().state, 'loading');
  assert.equal(registry.context().generation, start, 'loading is not a class');
  registry.setEvaluation(id, {
    state: 'editable',
    version: 2,
    targets: ['t1', 't2'],
    capabilities: ['inspect', 'source', 'author'],
  });
  assert.equal(registry.context().generation, start);
  // Version authority still refuses the obsolete capture.
  assert.equal(registry.revalidate(capture), 'stale-version');
  assert.equal(
    captured(registry.capture('next', 'author', ['t1'])).contextGeneration,
    start,
  );

  // Class changes are context changes: editable → source-only → invalid → editable.
  const classes = ['source-only', 'invalid-source', 'editable'] as const;
  classes.forEach((state, index) => {
    const version = 3 + index;
    registry.documentChanged(id, version);
    assert.equal(registry.context().generation, start + index);
    registry.setEvaluation(id, {
      state,
      version,
      targets: ['t1'],
      capabilities: ['inspect', 'source', 'author'],
    });
    assert.equal(registry.context().generation, start + index + 1, state);
  });
});

test('switching reports and re-evaluated targets or capabilities invalidate captures', () => {
  const registry = new WindowContextRegistry();
  const aId = editable(registry, {}, 'file:///a.rdlc');
  registry.registerView(aId);
  const capture = captured(registry.capture('r', 'inspect', ['t1', 't2']));

  editable(registry, {}, 'file:///b.rdlc');
  assert.equal(registry.revalidate(capture), 'stale-document');
  registry.focusDocument(aId);
  assert.equal(registry.revalidate(capture), 'stale-context');

  // A same-version refresh keeps the generation but is rechecked fact by fact.
  const refreshed = captured(
    registry.capture('fresh', 'inspect', ['t1', 't2']),
  );
  const capability = captured(registry.capture('source', 'source', ['t2']));
  registry.setEvaluation(aId, {
    state: 'editable',
    version: 1,
    targets: ['t2'],
    capabilities: ['inspect'],
  });
  assert.equal(registry.revalidate(capture), 'stale-context');
  assert.equal(registry.revalidate(refreshed), 'stale-target');
  assert.equal(registry.revalidate(capability), 'unsupported');
});

test('captured actions are frozen host-owned snapshots and settle once', () => {
  const registry = new WindowContextRegistry();
  editable(registry, {});
  const context = registry.context();
  const capture = captured(registry.capture('r', 'inspect', ['t1']));

  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(capture));
  assert.ok(Object.isFrozen(capture.targetIds));
  assert.throws(
    () => ((capture as unknown as { uri: string }).uri = 'file:///evil.rdlc'),
    TypeError,
  );
  assert.equal(capture.uri, 'file:///report.rdlc');
  assert.equal(registry.revalidate(capture), null);

  registry.settle(capture);
  registry.settle(capture);
  assert.equal(registry.pendingCount, 0);
  assert.deepEqual(registry.capture('r', 'inspect', ['t1']), {
    ok: false,
    reason: 'duplicate',
  });
  assert.equal(registry.revalidate(capture), 'settled');
  assert.equal(registry.revalidate({ ...capture }), 'settled');
});

test('action tracking refuses exhaustion without reusing settled request IDs', () => {
  const registry = new WindowContextRegistry();
  editable(registry, {});
  for (let i = 0; i < 1024; i++) {
    const action = captured(registry.capture(`request-${i}`, 'inspect'));
    registry.settle(action);
  }
  assert.deepEqual(registry.capture('overflow', 'inspect'), {
    ok: false,
    reason: 'request-limit',
  });
  assert.equal(registry.pendingCount, 0);
});

test('view, document and registry disposal terminate pending captures', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {});
  registry.focusView(registry.registerView(id));
  const first = registry.registerView(id);
  registry.focusView(first);
  const onFirst = captured(registry.capture('first', 'author', ['t1']));
  const unbound = registry.registerView(id);
  registry.focusView(unbound);
  const onSecond = captured(registry.capture('second', 'author', ['t2']));

  const terminated: TerminatedCapture[] = [];
  const stop = registry.onDidTerminate((event) => terminated.push(event));

  registry.disposeView(first);
  assert.deepEqual(
    terminated.map((event) => [event.capture.requestId, event.reason]),
    [['first', 'view-disposed']],
  );
  assert.equal(onFirst.viewId, first);
  assert.equal(registry.revalidate(onFirst), 'disposed-view');
  assert.equal(registry.revalidate(onSecond), null);
  assert.equal(registry.pendingCount, 1);

  registry.closeDocument(id);
  assert.deepEqual(
    terminated.map((event) => event.reason),
    ['view-disposed', 'document-closed'],
  );
  assert.equal(registry.revalidate(onSecond), 'stale-document');
  assert.equal(registry.pendingCount, 0);

  stop();
  const laterHandle = {};
  const laterId = editable(registry, laterHandle, 'file:///later.rdlc');
  assert.ok(laterId);
  const pending = captured(registry.capture('later', 'inspect', ['t1']));
  registry.dispose();
  assert.equal(terminated.length, 2);
  assert.equal(registry.pendingCount, 0);
  assert.equal(registry.revalidate(pending), 'disposed');
  assert.deepEqual(registry.capture('after', 'inspect'), {
    ok: false,
    reason: 'disposed',
  });
  assert.throws(
    () => registry.openDocument({}, 'file:///late.rdlc', 1),
    /disposed/,
  );

  const replacement = new WindowContextRegistry();
  assert.equal(
    editable(replacement, laterHandle, 'file:///later.rdlc'),
    'document-1',
  );
});

test('a preliminary capture binds exactly one same-document view once', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {});
  const preliminary = captured(registry.capture('prelim', 'author', ['t1']));
  assert.equal(preliminary.viewId, null);

  assert.deepEqual(registry.bind(preliminary, 'view-999'), {
    ok: false,
    reason: 'disposed-view',
  });

  const view = registry.registerView(id);
  const bound = registry.bind(preliminary, view);
  assert.ok(bound.ok);
  assert.equal(bound.capture.requestId, 'prelim');
  assert.equal(bound.capture.viewId, view);
  assert.equal(bound.capture.contextGeneration, preliminary.contextGeneration);
  assert.equal(registry.revalidate(bound.capture), null);
  assert.deepEqual(registry.bind(preliminary, view), {
    ok: false,
    reason: 'settled',
  });
  registry.settle(preliminary);
  assert.equal(
    registry.revalidate(bound.capture),
    null,
    'obsolete preliminary capture cannot settle its replacement',
  );
  assert.equal(registry.context().viewId, view);
  assert.deepEqual(registry.bind(bound.capture, view), {
    ok: false,
    reason: 'already-bound',
  });

  // Another report's panel is never borrowed.
  const bId = editable(registry, {}, 'file:///b.rdlc');
  const bView = registry.registerView(bId);
  registry.disposeView(view);
  registry.focusDocument(id);
  const unbound = captured(registry.capture('foreign', 'author', ['t1']));
  assert.equal(unbound.viewId, null);
  assert.deepEqual(registry.bind(unbound, bView), {
    ok: false,
    reason: 'foreign-view',
  });

  const reopened = registry.registerView(id);
  registry.documentChanged(id, 2);
  assert.deepEqual(registry.bind(unbound, reopened), {
    ok: false,
    reason: 'stale-version',
  });
});

test('Save As follows the real lifetime and invalidates obsolete captures', () => {
  const registry = new WindowContextRegistry();
  const id = editable(registry, {}, 'file:///old.rdlc', 2);
  const view = registry.registerView(id);
  const capture = captured(registry.capture('save', 'author', ['t1']));

  registry.retarget(id, 'file:///new.rdlc', 3);
  const moved = registry.context();
  assert.equal(moved.uri, 'file:///new.rdlc');
  assert.equal(moved.version, 3);
  assert.equal(moved.state, 'loading');
  assert.equal(moved.viewId, view);
  assert.equal(registry.revalidate(capture), 'stale-document');

  registry.setEvaluation(id, {
    state: 'editable',
    version: 3,
    targets: ['t1'],
    capabilities: ['author'],
  });
  const after = captured(registry.capture('after', 'author', ['t1']));
  assert.equal(after.uri, 'file:///new.rdlc');
  assert.equal(registry.focusSidebar().uri, 'file:///new.rdlc');
  registry.focusOther();
  assert.equal(registry.focusDocument(id).viewId, view);
});
