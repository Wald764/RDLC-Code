import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stableVersion,
  validateEvidence,
  resolveRelease,
  requiredEvidence,
} from '../../scripts/validate-release.js';

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
