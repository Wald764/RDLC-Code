import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptedFailures,
  isCriticalEvidence,
  nonCriticalEvidence,
  parseReadiness,
  type Readiness,
  requiredEvidence,
  resolveRelease,
  stableVersion,
  validateEvidence,
  validateQaExceptions,
} from '../../scripts/validate-release.js';
import { exceptionAllowed } from '../desktop/qa-classification.js';

test('only canonical stable release tags and equal root/extension versions are accepted', () => {
  assert.equal(stableVersion('v1.2.3', '1.2.3', '1.2.3'), '1.2.3');
  for (const tag of [
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    '1.2.3',
    'v1.2.3-beta',
    'v1.2.3+build',
    'v1.2.3\n',
  ])
    assert.throws(() => stableVersion(tag, '1.2.3', '1.2.3'));
  assert.throws(() => stableVersion('v1.2.3', '1.2.2', '1.2.3'));
  assert.throws(() => stableVersion('v1.2.3', '1.2.3', '1.2.2'));
});

test('annotated tags peel to main commits; unrelated branches are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-release-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commit = (name: string) => {
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      name,
    );
  };
  try {
    git('init', '-b', 'main');
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ version: '1.2.3' }),
    );
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    commit('initial');
    git('tag', '-a', 'v1.2.3', '-m', 'release');
    const sha = git('rev-parse', 'HEAD');
    assert.equal(resolveRelease('v1.2.3', 'main', directory), sha);
    git('checkout', '--orphan', 'other');
    commit('unrelated');
    git('tag', 'v2.0.0');
    assert.throws(() => resolveRelease('v2.0.0', 'main', directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI validates tagged Git objects, independent private versions and the full evidence-only diff', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-release-cli-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (path: string, value: unknown) =>
    writeFileSync(
      join(directory, path),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  const commit = () => {
    git('add', '.');
    git('commit', '-m', ':test_tube: test(release): Record evidence');
  };
  const cli = fileURLToPath(
    new URL('../../scripts/validate-release.js', import.meta.url),
  );
  const run = (tag: string) =>
    execFileSync(process.execPath, [cli, tag, 'main'], {
      cwd: directory,
      env: {
        ...process.env,
        MARKETPLACE_PUBLISHER: 'example',
        OPENVSX_NAMESPACE: '',
        OPENVSX_AUTH_MODE: '',
        OVSX_PAT: '',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    for (const path of [
      'apps/vscode-extension',
      'apps/designer',
      'packages/private',
      'docs/validation',
    ])
      mkdirSync(join(directory, path), { recursive: true });
    const tools = {
      node: '24.22.0',
      pnpm: '11.28.2',
      typescript: '6.0.3',
      angular: '22.2.3',
      vsce: '3.7.1',
    };
    const root = {
      version: '1.2.3',
      packageManager: 'pnpm@11.28.2',
      devDependencies: {
        typescript: tools.typescript,
        '@vscode/vsce': tools.vsce,
      },
    };
    write('package.json', root);
    write('apps/vscode-extension/package.json', {
      version: '1.2.3',
      publisher: 'example',
    });
    write('apps/designer/package.json', {
      version: '0.0.0',
      dependencies: { '@angular/core': tools.angular },
    });
    write('packages/private/package.json', { version: '0.0.7', private: true });
    write('.node-version', tools.node);
    commit();
    const candidate = git('rev-parse', 'HEAD');
    const path = 'docs/validation/proof.md';
    const record = {
      candidate,
      version: '1.2.3',
      tools,
      openvsx: 'not-configured',
      permittedEvidenceChanges: [path, 'docs/validation/release-readiness.md'],
      evidence: Object.fromEntries(
        requiredEvidence.map((id) => [
          id,
          { status: 'passed', path, candidate },
        ]),
      ),
    };
    write(path, 'Synthetic evidence, only for this validator test');
    write(
      'docs/validation/release-readiness.md',
      '```json\n' + JSON.stringify(record) + '\n```',
    );
    commit();
    git('tag', '-a', 'v1.2.3', '-m', 'release');
    git('checkout', '--detach', 'v1.2.3');
    // Worktree metadata is irrelevant: validation must read tagged objects.
    write('package.json', { ...root, version: '99.0.0' });
    const result = JSON.parse(run('v1.2.3'));
    assert.equal(result.candidate, candidate);
    assert.equal(result.version, '1.2.3');
    assert.match(result.evidence[path], /^[a-f0-9]{64}$/);
    git('restore', 'package.json');
    git('checkout', 'main');
    write('new-code.ts', 'export const changed = true;');
    commit();
    git('tag', 'v1.2.4');
    git('checkout', '--detach', 'v1.2.4');
    assert.throws(() => run('v1.2.4'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('mandatory evidence is complete, candidate-bound, tool-bound and allows only listed validation Markdown diffs', () => {
  const candidate = 'a'.repeat(40);
  const path = 'docs/validation/check.md';
  const tools = {
    node: '24.22.0',
    pnpm: '11.28.2',
    typescript: '6.0.3',
    angular: '22.2.3',
    vsce: '3.7.1',
  };
  const record = {
    candidate,
    version: '1.2.3',
    tools,
    openvsx: 'not-configured',
    permittedEvidenceChanges: [path, 'docs/validation/release-readiness.md'],
    evidence: Object.fromEntries(
      requiredEvidence.map((id) => [id, { status: 'passed', path, candidate }]),
    ),
  };
  const context = {
    version: '1.2.3',
    candidate,
    tools,
    openvsx: 'not-configured',
    changedPaths: [path],
    read: (file: string) => {
      assert.equal(file, path);
      return Buffer.from('Evidence');
    },
  };
  assert.doesNotThrow(() => validateEvidence(record, context));
  for (const optional of ['performance', 'usability', 'contributor-build'])
    assert.ok(!requiredEvidence.some((id) => id === optional));
  for (const changed of [
    'package.json',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    'scripts/tool.ts',
    'docs/validation/unlisted.md',
  ])
    assert.throws(() =>
      validateEvidence(record, { ...context, changedPaths: [changed] }),
    );
  for (const status of ['failed', 'unrun', 'pending'])
    assert.throws(() =>
      validateEvidence(
        {
          ...record,
          evidence: {
            ...record.evidence,
            isolation: { status, path, candidate },
          },
        },
        context,
      ),
    );
  const missing = { ...record.evidence };
  delete missing['isolation'];
  assert.throws(() =>
    validateEvidence({ ...record, evidence: missing }, context),
  );
  assert.throws(() =>
    validateEvidence({ ...record, candidate: 'b'.repeat(40) }, context),
  );
  assert.throws(() =>
    validateEvidence(
      { ...record, tools: { ...tools, node: '22.0.0' } },
      context,
    ),
  );
  assert.throws(() =>
    validateEvidence(record, { ...context, openvsx: 'oidc' }),
  );
  assert.throws(() =>
    validateEvidence(
      { ...record, openvsx: 'oidc' },
      { ...context, openvsx: 'oidc' },
    ),
  );
});

const issue = 'https://github.com/Wald764/RDLC-Code/issues/12';

function tiered() {
  const candidate = 'a'.repeat(40);
  const path = 'docs/validation/check.md';
  const tools = {
    node: '24.22.0',
    pnpm: '11.28.2',
    typescript: '6.0.3',
    angular: '22.2.3',
    vsce: '3.7.1',
  };
  const evidence = Object.fromEntries(
    requiredEvidence.map((id) => [id, { status: 'passed', path, candidate }]),
  ) as Readiness['evidence'];
  const record: Readiness = {
    candidate,
    version: '1.2.3',
    tools,
    openvsx: 'not-configured',
    permittedEvidenceChanges: [path],
    evidence,
  };
  const context = {
    version: '1.2.3',
    candidate,
    tools,
    openvsx: 'not-configured',
    changedPaths: [] as string[],
    read: () => Buffer.from('Evidence'),
  };
  return { record, context, path, candidate };
}

test('evidence tiers: only cross-platform, matrix and budget evidence may be an accepted failure', () => {
  assert.deepEqual([...nonCriticalEvidence].sort(), ['cross-os', 'v2', 'v7']);
  for (const id of [
    'preservation',
    'compatibility',
    'lifecycle',
    'isolation',
    'keyboard',
    'licenses',
    'github-auth',
    'marketplace-auth',
    'recovery',
    'github-actions',
    'v1',
    'v3',
    'v4',
    'v5',
    'v6',
    'v8',
    'openvsx-pat-auth',
    'openvsx-recovery',
  ])
    assert.ok(isCriticalEvidence(id), id);
  for (const id of nonCriticalEvidence)
    assert.ok(requiredEvidence.some((r) => r === id));
  const { record, context, path, candidate } = tiered();
  const accept = (id: string, extra: Record<string, string> = {}) => ({
    ...record,
    evidence: {
      ...record.evidence,
      [id]: {
        status: 'accepted-failure',
        path,
        candidate,
        issue,
        reason: 'macOS runner capacity',
        ...extra,
      },
    },
  });
  for (const id of nonCriticalEvidence)
    assert.doesNotThrow(() => validateEvidence(accept(id), context), id);
  assert.deepEqual(acceptedFailures(accept('cross-os')), [
    { id: 'cross-os', issue, reason: 'macOS runner capacity' },
  ]);
  // Critical evidence never tolerates a failure, with or without paperwork.
  for (const id of ['isolation', 'keyboard', 'github-actions', 'v3', 'v8'])
    assert.throws(() => validateEvidence(accept(id), context), /Critical/, id);
  assert.throws(
    () => validateEvidence(accept('v7', { issue: 'not-an-issue' }), context),
    /issue/,
  );
  assert.throws(
    () =>
      validateEvidence(
        accept('v7', { issue: 'https://example.com/issues/3' }),
        context,
      ),
    /issue/,
  );
  assert.throws(
    () => validateEvidence(accept('v7', { reason: ' ' }), context),
    /reason/,
  );
  assert.throws(
    () => validateEvidence(accept('v7', { status: 'failed' }), context),
    /not passed/,
  );
});

test('qaExceptions: schema, informational targets only, no duplicates', () => {
  const valid = {
    id: 'visual.spec.ts::US6.2-themes',
    scope: 'ubuntu-24.04/1.142.0',
    issue,
    reason: 'Known rendering difference',
    acceptedBy: 'Wald764',
    acceptedOn: '2026-11-07',
  };
  assert.deepEqual(validateQaExceptions(undefined), []);
  assert.deepEqual(validateQaExceptions([]), []);
  assert.deepEqual(validateQaExceptions([valid], exceptionAllowed), [valid]);
  const unscoped: Record<string, unknown> = { ...valid };
  delete unscoped['scope'];
  assert.equal(validateQaExceptions([unscoped])[0]!.scope, undefined);
  assert.throws(() => validateQaExceptions({}));
  assert.throws(() => validateQaExceptions(['x']));
  assert.throws(
    () => validateQaExceptions([{ ...valid, extra: 1 }]),
    /unknown/,
  );
  for (const key of ['id', 'issue', 'reason', 'acceptedBy', 'acceptedOn'])
    assert.throws(
      () => validateQaExceptions([{ ...valid, [key]: '' }]),
      new RegExp(key === 'id' ? 'id' : key),
      key,
    );
  assert.throws(
    () => validateQaExceptions([{ ...valid, scope: 'linux' }]),
    /scope/,
  );
  assert.throws(
    () => validateQaExceptions([{ ...valid, acceptedOn: '07/11/2026' }]),
    /acceptedOn/,
  );
  assert.throws(() => validateQaExceptions([valid, valid]), /Duplicate/);
  // An exception on a critical check or evidence id is an error.
  for (const id of [
    'isolation',
    'keyboard',
    'job:quality',
    'job:canonical',
    'components.spec.ts::US4.2-insert-once',
    'accessibility.spec.ts::US6.1-keyboard-journey',
  ])
    assert.throws(
      () => validateQaExceptions([{ ...valid, id }], exceptionAllowed),
      /critical|id must/,
      id,
    );
  assert.throws(
    () => validateQaExceptions([{ ...valid, id: 'isolation' }]),
    /id must/,
  );
});

test('the readiness record is validated for qaExceptions and one JSON block is required', () => {
  const { record, context } = tiered();
  assert.doesNotThrow(() =>
    validateEvidence(
      {
        ...record,
        qaExceptions: [
          {
            id: 'job:visual',
            issue,
            reason: 'Known',
            acceptedBy: 'Wald764',
            acceptedOn: '2026-11-07',
          },
        ],
      },
      context,
    ),
  );
  assert.throws(() =>
    validateEvidence(
      { ...record, qaExceptions: [{ id: 'job:visual' }] } as never,
      context,
    ),
  );
  assert.deepEqual(
    parseReadiness('text\n```json\n{"candidate":"x"}\n```\n').candidate,
    'x',
  );
  assert.throws(() => parseReadiness('none'));
  assert.throws(() => parseReadiness('```json\n{}\n```\n```json\n{}\n```'));
});

test('a release tag whose commit is not reachable from main is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-release-main-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(directory, 'a.txt'), 'a');
    git('add', '.');
    git('commit', '-m', 'main');
    git('checkout', '-b', 'feature');
    writeFileSync(join(directory, 'b.txt'), 'b');
    git('add', '.');
    git('commit', '-m', 'feature only');
    git('tag', 'v3.0.0');
    assert.throws(() => resolveRelease('v3.0.0', 'main', directory));
    git('checkout', 'main');
    git('merge', '--ff-only', 'feature');
    assert.equal(
      resolveRelease('v3.0.0', 'main', directory),
      git('rev-parse', 'HEAD'),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
