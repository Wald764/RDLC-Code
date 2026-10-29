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
  commandAvailable,
  desktopLaunchArgs,
  desktopPaths,
  ensureWorkspaceTrusted,
  finishDesktopProcess,
  launchDesktop,
  parseTrustProbe,
  readExecutableVersion,
  trustProbePath,
  validateDesktopOptions,
  workbenchCommand,
  workbenchLocation,
} from './driver.js';
import config from './playwright.config.js';
import type { BrowserContext, Page } from 'playwright';

/** A page whose `.monaco-workbench` count never answers: the hung-transport case. */
const fakePage = (url: string, count: () => Promise<number>): Page =>
  ({
    isClosed: () => false,
    url: () => url,
    setDefaultTimeout: () => {},
    locator: () => ({ count }),
  }) as unknown as Page;

const fakeContext = (...pages: Page[]): BrowserContext =>
  ({ pages: () => pages }) as unknown as BrowserContext;

const hangingCount = (): Promise<number> => new Promise<number>(() => {});

test(
  'workbenchLocation bounds a hanging locator count by its deadline',
  { timeout: 15_000 },
  async () => {
    const url = 'vscode-file://fake/loading-window';
    const page = fakePage(url, hangingCount);
    const started = Date.now();
    await assert.rejects(
      workbenchLocation(() => [fakeContext(page)], 600),
      (error: unknown) =>
        error instanceof Error &&
        /not found within 600ms/.test(error.message) &&
        error.message.includes(url),
    );
    const elapsed = Date.now() - started;
    // Generous CI range: past the 600ms deadline, nowhere near test timeout.
    assert.ok(elapsed >= 550, `resolved before the deadline: ${elapsed}ms`);
    assert.ok(elapsed < 5_000, `deadline not respected: ${elapsed}ms`);
  },
);

test(
  'workbenchLocation still tries the other windows after a hanging count',
  { timeout: 15_000 },
  async () => {
    const hanging = fakePage('vscode-file://fake/loading', hangingCount);
    const ready = fakePage('vscode-file://fake/workbench', async () => 1);
    const started = Date.now();
    const located = await workbenchLocation(
      () => [fakeContext(hanging, ready)],
      10_000,
    );
    assert.equal(located.page, ready);
    assert.ok(
      Date.now() - started < 5_000,
      'a hanging window must not consume the whole deadline',
    );
  },
);

/**
 * A primitive page whose command palette never closes and whose Escape either
 * answers or never returns (the EDGE-08 transport). It stands in for the
 * unresponsive transport only: it guards the driver's recovery, no Desktop claim.
 */
function palettePage(escapeHangs: boolean) {
  const pressed: string[] = [];
  let rejectEscape: ((reason: Error) => void) | undefined;
  let reached: () => void = () => {};
  const escapeReached = new Promise<void>((done) => {
    reached = done;
  });
  const page = {
    bringToFront: async () => {},
    evaluate: async () => {},
    locator: (selector: string) => ({
      waitFor: async (options: { state?: string }) => {
        // Only "the palette is still open after its budget" fails here.
        if (selector.endsWith('input') && options.state === 'hidden')
          throw new Error('Timeout 30000ms exceeded.');
      },
      filter: () => ({
        count: async () => 1,
        first: () => ({ click: async () => {}, waitFor: async () => {} }),
        filter: () => ({
          count: async () => 1,
          first: () => ({ click: async () => {}, waitFor: async () => {} }),
        }),
      }),
    }),
    keyboard: {
      type: async () => {},
      press: async (key: string) => {
        pressed.push(key);
        if (key !== 'Escape') return;
        reached();
        if (escapeHangs)
          return new Promise<never>((_, reject) => {
            rejectEscape = reject;
          });
      },
    },
  };
  return {
    page: page as unknown as Page,
    pressed,
    escapeReached,
    rejectEscape: (reason: Error) => {
      assert.ok(rejectEscape, 'Escape must be pending before it can reject');
      rejectEscape(reason);
    },
  };
}

test(
  'command recovery is bounded when the palette transport stops answering',
  { timeout: 10_000 },
  async (t) => {
    const id = 'Focus on Report Structure View';
    const { page, pressed, escapeReached, rejectEscape } = palettePage(true);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const command = workbenchCommand(page, id);
    const checked = assert.rejects(command, (error: unknown) => {
      assert.ok(error instanceof AggregateError, String(error));
      // The palette failure is the headline and the first cause; the recovery
      // timeout rides along instead of replacing it.
      assert.equal(
        error.message,
        `Command palette did not execute ${id}: Timeout 30000ms exceeded.`,
      );
      assert.equal(error.errors.length, 2);
      assert.match(String(error.errors[0]), /Timeout 30000ms exceeded/);
      assert.match(
        String(error.errors[1]),
        /Command palette recovery timed out after 30000ms/,
      );
      return true;
    });
    await escapeReached;
    // The escape was attempted; the budget, not the transport, ends the wait.
    assert.equal(pressed.length, 2);
    t.mock.timers.tick(30_000);
    await checked;
    assert.equal(pressed.at(-1), 'Escape');
    // Closing the hung transport later must not produce an unhandled rejection.
    rejectEscape(new Error('Transport closed after recovery timed out.'));
    await new Promise<void>((done) => setImmediate(done));
  },
);

test('a failed palette keeps its original error once the Escape recovery answers', async () => {
  const id = 'View: Close Editor';
  const { page, pressed } = palettePage(false);
  await assert.rejects(workbenchCommand(page, id), (error: unknown) => {
    assert.ok(error instanceof Error && !(error instanceof AggregateError));
    assert.equal(
      error.message,
      `Command palette did not execute ${id}: Timeout 30000ms exceeded.`,
    );
    return true;
  });
  assert.equal(pressed.at(-1), 'Escape');
});

test(
  'command availability bounds dismissal of an unresponsive palette',
  { timeout: 10_000 },
  async (t) => {
    const { page, escapeReached } = palettePage(true);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const checked = assert.rejects(
      commandAvailable(page, 'Workspaces: Manage Workspace Trust'),
      /Command palette dismissal timed out after 30000ms/,
    );
    await escapeReached;
    t.mock.timers.tick(30_000);
    await checked;
  },
);

test('command availability returns the listed command after dismissing the palette', async () => {
  const { page, pressed } = palettePage(false);
  assert.equal(
    await commandAvailable(page, 'Workspaces: Manage Workspace Trust'),
    true,
  );
  assert.equal(pressed.at(-1), 'Escape');
});

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

test('a profile whose IPC socket would overflow the Unix limit moves to a short temp dir', () => {
  const deep = join(tmpdir(), 'x'.repeat(60));
  const options = {
    root: deep,
    version: '1.142.0',
    packaged: true,
    artifactDir: join(deep, 'artifacts'),
  } as const;
  const id = '5110-12c46e42-8221-43b8-9ddd-cdce2ce2e68e';
  const moved = desktopPaths(options, id, 'darwin', '/tmp');
  assert.match(moved.profileDir, /^[\\/]tmp[\\/]rdlc-[0-9a-f]{12}$/);
  assert.ok(join(moved.profileDir, '1.14-main.sock').length <= 103);
  assert.equal(moved.extensionsDir, join(moved.profileDir, 'extensions'));
  assert.equal(
    desktopPaths(options, id, 'darwin', '/tmp').profileDir,
    moved.profileDir,
    'stable for one launch identity',
  );
  // Windows uses named pipes, so the repository-local profile stays.
  assert.ok(
    desktopPaths(options, id, 'win32', '/tmp').profileDir.startsWith(
      resolve(deep),
    ),
  );
});

test('an extension inspector port is validated and passed before the folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-desktop-'));
  try {
    const base = {
      root,
      version: '1.142.0',
      packaged: false,
      artifactDir: join(root, 'artifacts'),
    };
    const plain = validateDesktopOptions(base);
    assert.equal(
      desktopLaunchArgs(plain, desktopPaths(plain, 'a')).some((arg) =>
        arg.startsWith('--inspect-extensions'),
      ),
      false,
    );
    const inspected = validateDesktopOptions({
      ...base,
      inspectExtensions: 9333,
    });
    const args = desktopLaunchArgs(inspected, desktopPaths(inspected, 'a'));
    assert.equal(args.at(-2), '--inspect-extensions=9333');
    for (const port of [0, 80, 70000, 1.5])
      assert.throws(() =>
        validateDesktopOptions({ ...base, inspectExtensions: port }),
      );
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
