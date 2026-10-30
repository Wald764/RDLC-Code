import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DESKTOP_GROUPS } from '../tests/desktop/run-tests.js';
import {
  changedDesktopSpecs,
  changedSpecsGitArguments,
  DESKTOP_OSES,
  listChangedSpecs,
  parseRepeat,
  pick,
  planMatrix,
} from './desktop-matrix.js';

test('only added or modified top-level desktop specs are kept, as unique sorted file names', () => {
  assert.deepEqual(
    changedDesktopSpecs([
      'tests/desktop/workspace.spec.ts',
      'tests/desktop/data.spec.ts',
      'tests/desktop/data.spec.ts',
      'tests/desktop/driver.ts',
      'tests/desktop/run-tests.test.ts',
      'tests/desktop/baselines/x.spec.ts',
      'tests/vscode/other.spec.ts',
      'docs/tests/desktop/data.spec.ts',
      'tests\\desktop\\context.spec.ts',
      '',
    ]),
    ['context.spec.ts', 'data.spec.ts', 'workspace.spec.ts'],
  );
  assert.deepEqual(changedDesktopSpecs([]), []);
});

test('changed specs are listed with the three-dot diff against the base and unsafe bases are refused', () => {
  assert.deepEqual(changedSpecsGitArguments('main'), [
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    'origin/main...HEAD',
    '--',
    'tests/desktop/*.spec.ts',
  ]);
  assert.ok(changedSpecsGitArguments('release/1.x')[3]);
  for (const bad of ['', '--output=x', '-x', 'a..b', 'a b', 'a;b'])
    assert.throws(() => changedSpecsGitArguments(bad), /base branch/, bad);
});

test('a spec runs in its group, only in the modes that include it, on every OS and VS Code version', () => {
  const plan = planMatrix({ specs: ['data.spec.ts'] });
  assert.deepEqual(plan.unplanned, []);
  // core: functional and packaged, 3 OS x 2 VS Code versions.
  assert.equal(plan.include.length, 3 * 2 * 2);
  assert.ok(plan.include.every((entry) => entry.group === 'core'));
  assert.deepEqual(
    [...new Set(plan.include.map((entry) => entry.mode))].sort(),
    ['functional', 'packaged'],
  );
  assert.ok(plan.include.every((entry) => entry.specs === 'data.spec.ts'));
  assert.deepEqual(
    [...new Set(plan.include.map((entry) => entry.os))].sort(),
    [...DESKTOP_OSES].sort(),
  );
  assert.deepEqual(
    [...new Set(plan.include.map((entry) => entry.vscode))].sort(),
    ['1.142.0', 'stable'],
  );
});

test('the capability probe runs only for probe specs, once per OS and version, in core', () => {
  const plan = planMatrix({ specs: ['security-observer.spec.ts'] });
  assert.deepEqual(plan.unplanned, []);
  assert.deepEqual(
    [...new Set(plan.include.map((entry) => entry.mode))],
    ['probe-packaged'],
  );
  assert.ok(plan.include.every((entry) => entry.group === 'core'));
  assert.equal(plan.include.length, 3 * 2);
  // native-drag.spec.ts is in authoring and in the probe: both apply.
  const drag = planMatrix({ specs: ['native-drag.spec.ts'] });
  assert.deepEqual(
    [
      ...new Set(drag.include.map((entry) => `${entry.group}/${entry.mode}`)),
    ].sort(),
    ['authoring/functional', 'authoring/packaged', 'core/probe-packaged'],
  );
});

test('several specs share an entry per group and mode, restricted to the changed ones', () => {
  const plan = planMatrix({
    os: ['ubuntu-24.04'],
    specs: ['bootstrap.spec.ts', 'context.spec.ts', 'workspace.spec.ts'],
  });
  const forGroup = (group: string, mode: string) =>
    plan.include
      .filter(
        (entry) =>
          entry.group === group &&
          entry.mode === mode &&
          entry.vscode === 'stable',
      )
      .map((entry) => entry.specs);
  assert.deepEqual(forGroup('core', 'functional'), [
    'bootstrap.spec.ts,workspace.spec.ts',
  ]);
  assert.deepEqual(forGroup('core', 'probe-packaged'), ['bootstrap.spec.ts']);
  assert.deepEqual(forGroup('context', 'packaged'), ['context.spec.ts']);
  assert.deepEqual(forGroup('authoring', 'functional'), []);
});

test('every spec of every CI group gets entries, and the whole matrix keeps the hunt axes', () => {
  for (const [group, files] of Object.entries(DESKTOP_GROUPS))
    for (const file of files) {
      const plan = planMatrix({ specs: [file] });
      assert.deepEqual(plan.unplanned, [], file);
      assert.ok(
        plan.include.some((entry) => entry.group === group),
        file,
      );
    }
  // Unrestricted: 2 + 1 modes in core, 2 each elsewhere = 3 x 2 x (3 + 2 + 2).
  const all = planMatrix({});
  assert.equal(all.include.length, 3 * 2 * 7);
  assert.ok(all.include.every((entry) => entry.specs === ''));
});

test('specs that no matrix entry runs are reported, visual-only ones apart', () => {
  const plan = planMatrix({
    specs: ['visual.spec.ts', 'brand-new.spec.ts', 'data.spec.ts'],
  });
  assert.deepEqual(plan.visualOnly, ['visual.spec.ts']);
  assert.deepEqual(plan.unplanned, ['brand-new.spec.ts']);
  const visualOnly = planMatrix({ specs: ['visual.spec.ts'] });
  assert.equal(visualOnly.include.length, 0);
  // Filters still narrow the matrix.
  assert.equal(
    planMatrix({
      os: ['macos-15'],
      groups: ['context'],
      specs: ['context.spec.ts'],
    }).include.length,
    2 * 2,
  );
});

test('inputs are validated like the manual workflow always did', () => {
  assert.equal(parseRepeat('5'), 5);
  for (const bad of ['0', '11', '2.5', 'x', ''])
    assert.throws(() => parseRepeat(bad), /repeat must be/, bad);
  assert.deepEqual(pick('os', '', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(pick('os', 'b, a', ['a', 'b']), ['a', 'b']);
  assert.throws(() => pick('os', 'c', ['a', 'b']), /Unknown os: c/);
});

test('a gate call without changed specs plans nothing, a manual run without specs plans everything', () => {
  assert.equal(planMatrix({ specsRequired: true }).include.length, 0);
  assert.equal(
    planMatrix({ specsRequired: true, specs: [] }).include.length,
    0,
  );
  assert.ok(
    planMatrix({ specsRequired: true, specs: ['data.spec.ts'] }).include
      .length > 0,
  );
  assert.ok(planMatrix({}).include.length > 0);
});

test('a renamed and edited spec, an added and a modified one are gated; a deleted one is not', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-changed-specs-'));
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8' },
    );
  try {
    git('init', '-q', '-b', 'main');
    mkdirSync(join(root, 'tests/desktop'), { recursive: true });
    const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    for (const name of ['old', 'kept', 'gone'])
      writeFileSync(join(root, `tests/desktop/${name}.spec.ts`), body);
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'topic');
    renameSync(
      join(root, 'tests/desktop/old.spec.ts'),
      join(root, 'tests/desktop/renamed.spec.ts'),
    );
    writeFileSync(join(root, 'tests/desktop/renamed.spec.ts'), `${body}\nedit`);
    writeFileSync(join(root, 'tests/desktop/kept.spec.ts'), `${body}\nedit`);
    writeFileSync(join(root, 'tests/desktop/added.spec.ts'), 'new');
    rmSync(join(root, 'tests/desktop/gone.spec.ts'));
    git('add', '-A');
    git('commit', '-q', '-m', 'topic');
    assert.deepEqual(listChangedSpecs('main', root), [
      'added.spec.ts',
      'kept.spec.ts',
      'renamed.spec.ts',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
