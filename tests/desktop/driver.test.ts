import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  desktopLaunchArgs,
  desktopPaths,
  ensureWorkspaceTrusted,
  finishDesktopProcess,
  launchDesktop,
  parseTrustProbe,
  readExecutableVersion,
  trustProbePath,
  validateDesktopOptions,
} from './driver.js';
import config from './playwright.config.js';

test('shutdown accepts a clean exit and refuses a crashed owned process', async () => {
  for (const code of [0, 7]) {
    const child = spawn(process.execPath, ['-e', `process.exit(${code})`]);
    await once(child, 'exit');
    if (code === 0)
      assert.deepEqual(await finishDesktopProcess(child), {
        forced: false,
        exitCode: 0,
        signal: null,
      });
    else await assert.rejects(finishDesktopProcess(child), /exited abnormally/);
  }
  const signalled = spawn(process.execPath, [
    '-e',
    'setInterval(() => {}, 1000)',
  ]);
  await once(signalled, 'spawn');
  const exited = once(signalled, 'exit');
  signalled.kill();
  await exited;
  await assert.rejects(finishDesktopProcess(signalled), /exited abnormally/);
});

test('shutdown terminates the owned process rather than certifying a disconnect', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  await once(child, 'spawn');
  try {
    const result = await finishDesktopProcess(child);
    assert.equal(result.forced, true);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

test('forced shutdown also terminates an owned descendant', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const { spawn } = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    descendant.once('spawn', () => console.log(descendant.pid));
    setInterval(() => {}, 1000);
  `,
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const [output] = await once(child.stdout!, 'data');
  const descendant = Number(String(output).trim());
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
  try {
    assert.doesNotThrow(() => process.kill(descendant, 0));
    assert.equal((await finishDesktopProcess(child)).forced, true);
    const deadline = Date.now() + 5000;
    let running = true;
    while (running && Date.now() < deadline) {
      try {
        process.kill(descendant, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        running = false;
      }
      if (running) await new Promise((done) => setTimeout(done, 20));
    }
    assert.equal(
      running,
      false,
      'descendant must not survive the root process',
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    try {
      process.kill(descendant, 'SIGKILL');
    } catch {
      /* Already terminated. */
    }
  }
});

test('binary identity requires actual version and build metadata, including hashed archive layouts', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-binary-identity-'));
  try {
    const executable = join(root, 'Code.exe');
    assert.throws(() => readExecutableVersion(executable), /Cannot verify/);
    const app = join(root, 'abcdef1234', 'resources', 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ version: '1.142.0' }),
    );
    writeFileSync(
      join(app, 'product.json'),
      JSON.stringify({ commit: 'a'.repeat(40) }),
    );
    assert.deepEqual(readExecutableVersion(executable), {
      version: '1.142.0',
      build: 'a'.repeat(40),
    });
    writeFileSync(
      join(app, 'product.json'),
      JSON.stringify({ commit: 'unknown' }),
    );
    assert.throws(() => readExecutableVersion(executable), /Cannot verify/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit workspace folder replaces the repository root as the opened folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-desktop-'));
  const workspace = join(root, 'fixture');
  mkdirSync(workspace);
  try {
    const base = {
      root,
      version: '1.142.0',
      packaged: false,
      artifactDir: join(root, 'artifacts'),
    };
    const plain = validateDesktopOptions(base);
    assert.equal(
      desktopLaunchArgs(plain, desktopPaths(plain, 'a')).at(-1),
      resolve(root),
    );
    const scoped = validateDesktopOptions({ ...base, workspaceDir: workspace });
    const paths = desktopPaths(scoped, 'a');
    assert.equal(paths.workspaceDir, resolve(workspace));
    assert.equal(desktopLaunchArgs(scoped, paths).at(-1), resolve(workspace));
    assert.throws(
      () =>
        validateDesktopOptions({
          ...base,
          workspaceDir: join(root, 'missing'),
        }),
      /Desktop workspace is not a directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('desktop launch plan is disposable, transport-neutral and trust-native', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-desktop-'));
  const vsixPath = join(root, 'candidate.vsix');
  const artifactDir = join(root, '.vscode-test', 'desktop-artifacts');
  writeFileSync(vsixPath, 'candidate');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ version: '9.9.9' }),
  );
  mkdirSync(join(root, 'dist'), { recursive: true });
  const defaultVsixPath = join(root, 'dist', 'rdlc-code-9.9.9.vsix');
  writeFileSync(defaultVsixPath, 'candidate');
  try {
    assert.equal(
      validateDesktopOptions({
        root,
        version: '1.142.0',
        packaged: true,
        artifactDir,
      }).vsixPath,
      defaultVsixPath,
    );
    const packaged = validateDesktopOptions({
      root,
      version: '1.142.0',
      packaged: true,
      artifactDir,
      vsixPath,
    });
    const paths = desktopPaths(packaged, 'capture-id');
    const args = desktopLaunchArgs(packaged, paths);

    assert.ok(paths.profileDir.startsWith(join(root, '.vscode-test')));
    assert.match(paths.profileDir, /packaged-1\.142\.0-capture-id$/);
    assert.ok(args.includes(`--user-data-dir=${paths.profileDir}`));
    assert.ok(args.includes(`--extensions-dir=${paths.extensionsDir}`));
    assert.equal(
      args.some((arg) => arg.startsWith('--extensionDevelopmentPath=')),
      false,
    );
    assert.equal(args.includes('--disable-workspace-trust'), false);
    assert.equal(
      args.some((arg) => arg.startsWith('--disable-workspace-trust')),
      false,
    );
    // Trusted folders live in VS Code's shared data dir (home by default): a
    // disposable profile must own it or it inherits and mutates the real trust list.
    assert.ok(
      args.includes(
        `--shared-data-dir=${join(paths.profileDir, 'shared-data')}`,
      ),
    );
    assert.equal(args.at(-1), resolve(root));
    const probeArgs = desktopLaunchArgs(
      { ...packaged, testHarness: true },
      paths,
    );
    assert.ok(
      probeArgs.includes(
        `--extensionDevelopmentPath=${join(root, 'tests', 'vscode', 'harness')}`,
      ),
    );
    assert.equal(
      probeArgs.includes(
        `--extensionDevelopmentPath=${join(root, 'apps', 'vscode-extension')}`,
      ),
      false,
      'installed probes must never load the development candidate',
    );

    const development = validateDesktopOptions({
      root,
      version: '1.142.0',
      packaged: false,
      artifactDir,
    });
    const developmentArgs = desktopLaunchArgs(
      development,
      desktopPaths(development, 'capture-id'),
    );
    assert.ok(
      developmentArgs.includes(
        `--extensionDevelopmentPath=${join(root, 'apps', 'vscode-extension')}`,
      ),
    );
    assert.ok(
      developmentArgs.includes(
        `--extensionDevelopmentPath=${join(root, 'tests', 'vscode', 'harness')}`,
      ),
    );

    rmSync(defaultVsixPath);
    assert.throws(
      () =>
        validateDesktopOptions({
          root,
          version: '1.142.0',
          packaged: true,
          artifactDir,
        }),
      /VSIX is not a file/,
    );
    assert.throws(
      () =>
        validateDesktopOptions({
          root,
          version: '1.142.0',
          packaged: false,
          artifactDir,
          vsixPath,
        }),
      /must not install a VSIX/,
    );

    assert.equal(typeof launchDesktop, 'function');
    assert.equal(config.fullyParallel, false);
    assert.equal(config.workers, 1);
    assert.equal(config.updateSnapshots, 'none');
    assert.equal(config.expect?.toHaveScreenshot?.threshold, 0.1);
    assert.equal(config.expect?.toHaveScreenshot?.maxDiffPixelRatio, 0.001);
    assert.equal(
      config.outputDir,
      '../../.vscode-test/desktop-artifacts/playwright',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trust is read from the harness probe, which the product never ships', () => {
  assert.equal(parseTrustProbe('{"isTrusted":false}'), false);
  assert.equal(parseTrustProbe('{"isTrusted":true}'), true);
  assert.throws(() => parseTrustProbe('{"isTrusted":"yes"}'), /boolean/);
  assert.throws(() => parseTrustProbe('{}'), /boolean/);
  assert.equal(
    trustProbePath('profile'),
    join(
      'profile',
      'User',
      'globalStorage',
      'rdlc-tests.rdlc-test-harness',
      'workspace-trust.json',
    ),
  );
  const root = resolve(import.meta.dirname, '..', '..', '..');
  const harness = join(root, 'tests', 'vscode', 'harness');
  const manifest = JSON.parse(
    readFileSync(join(harness, 'package.json'), 'utf8'),
  ) as {
    publisher: string;
    name: string;
    contributes: { commands: { command: string; title: string }[] };
    capabilities: { untrustedWorkspaces: { supported: unknown } };
  };
  assert.equal(
    `${manifest.publisher}.${manifest.name}`,
    'rdlc-tests.rdlc-test-harness',
  );
  assert.ok(
    manifest.contributes.commands.some(
      (c) =>
        c.command === 'rdlcTests.reportWorkspaceTrust' &&
        c.title === 'RDLC Test: Report Workspace Trust',
    ),
  );
  // Restricted Mode must still run the probe.
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
  assert.match(
    readFileSync(join(harness, 'drag-probe.cjs'), 'utf8'),
    /isTrusted/,
  );
  const product = readFileSync(
    join(root, 'apps', 'vscode-extension', 'package.json'),
    'utf8',
  );
  assert.equal(product.includes('rdlcTests'), false);
});

/** A driver whose "Report Workspace Trust" command writes the harness probe like the real extension. */
function trustFake(initial: boolean) {
  const profileDir = mkdtempSync(join(tmpdir(), 'rdlc-trust-'));
  const state = { trusted: initial, grants: 0 };
  const driver = {
    profileDir,
    async command(id: string) {
      assert.equal(id, 'RDLC Test: Report Workspace Trust');
      const file = trustProbePath(profileDir);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify({ isTrusted: state.trusted }));
    },
  };
  return {
    driver,
    state,
    cleanup: () => rmSync(profileDir, { recursive: true, force: true }),
  };
}

test('functional journeys grant trust through the public path and confirm it before running', async () => {
  const fake = trustFake(false);
  try {
    await ensureWorkspaceTrusted(fake.driver, async () => {
      fake.state.grants++;
      fake.state.trusted = true;
    });
    assert.equal(fake.state.grants, 1);
    // Already trusted: no second grant.
    await ensureWorkspaceTrusted(fake.driver, async () => {
      fake.state.grants++;
    });
    assert.equal(fake.state.grants, 1);
    // A grant that the public API does not confirm is a failure, never a pass.
    const stuck = trustFake(false);
    try {
      await assert.rejects(
        ensureWorkspaceTrusted(stuck.driver, async () => {}),
        /still reports Restricted Mode/,
      );
    } finally {
      stuck.cleanup();
    }
  } finally {
    fake.cleanup();
  }
});
