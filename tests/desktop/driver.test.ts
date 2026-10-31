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
  assessWindowGeometry,
  commandAvailable,
  desktopLaunchArgs,
  desktopPaths,
  ensureWorkspaceTrusted,
  finishDesktopProcess,
  fitContentSize,
  launchDesktop,
  openRequestPath,
  openResultPath,
  openWorkspaceFile,
  parseOpenResult,
  parseTrustProbe,
  readExecutableVersion,
  retryTransientEvaluate,
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
      count: async () => 1,
      fill: async () => {},
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

/**
 * A palette whose row fails its actionability check for the first `failures`
 * attempts (the quick input hid itself) and, when `pressThrows` is set, runs
 * the command on the real press and then throws. `open` is what the quick
 * input reports after a failure.
 */
function closingPalettePage(options: {
  failures: number;
  pressThrows?: boolean;
  open?: boolean;
}) {
  const pressed: string[] = [];
  const trials: number[] = [];
  const presses: number[] = [];
  const ran: number[] = [];
  const row = {
    click: async (clickOptions?: { trial?: boolean }) => {
      if (clickOptions?.trial) {
        trials.push(trials.length + 1);
        if (trials.length <= options.failures)
          throw new Error('locator.click: Timeout 10000ms exceeded.');
        return;
      }
      presses.push(presses.length + 1);
      ran.push(ran.length + 1);
      if (options.pressThrows) throw new Error('locator.click: target closed');
    },
    waitFor: async () => {},
  };
  const rows = { count: async () => 1, first: () => row };
  const page = {
    bringToFront: async () => {},
    evaluate: async () => {},
    locator: () => ({
      count: async () => (options.open === false ? 0 : 1),
      fill: async () => {},
      waitFor: async () => {},
      filter: () => ({ ...rows, filter: () => rows }),
    }),
    keyboard: {
      press: async (key: string) => {
        pressed.push(key);
      },
    },
  };
  return { page: page as unknown as Page, pressed, trials, presses, ran };
}

test('a palette that closed before the row click is reopened and the command runs once', async () => {
  const { page, pressed, trials, ran } = closingPalettePage({ failures: 1 });
  await workbenchCommand(page, 'RDLC Test: Open Requested File');
  // Two palette openings, one dismissal between them, one command run.
  assert.equal(trials.length, 2);
  assert.equal(ran.length, 1);
  assert.equal(pressed.filter((key) => key === 'Escape').length, 1);
  assert.equal(pressed.length, 3);
});

test('a palette that is already gone is not dismissed with Escape', async () => {
  const { page, pressed, ran } = closingPalettePage({
    failures: 1,
    open: false,
  });
  await workbenchCommand(page, 'RDLC Test: Open Requested File');
  assert.equal(ran.length, 1);
  assert.equal(pressed.includes('Escape'), false);
});

test('a palette that never passes the click checks fails after the bounded attempts with every cause', async () => {
  const { page, presses } = closingPalettePage({ failures: Infinity });
  const id = 'RDLC Test: Open Requested File';
  await assert.rejects(workbenchCommand(page, id), (error: unknown) => {
    assert.ok(error instanceof AggregateError, String(error));
    assert.match(
      error.message,
      new RegExp(`^Command palette did not run ${id} after 3 attempts: `),
    );
    assert.equal(error.errors.length, 3);
    return true;
  });
  assert.equal(presses.length, 0);
});

test('a click that landed and then threw never runs the command a second time', async () => {
  const { page, presses, ran } = closingPalettePage({
    failures: 0,
    pressThrows: true,
  });
  const id = 'RDLC Test: Open Requested File';
  await assert.rejects(workbenchCommand(page, id), (error: unknown) => {
    assert.ok(error instanceof AggregateError, String(error));
    assert.match(error.message, /failed after it was dispatched/);
    assert.match(error.message, /target closed/);
    return true;
  });
  assert.equal(presses.length, 1);
  assert.equal(ran.length, 1);
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

test('a host cgroup is validated as a single path segment and never changes the launch arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'rdlc-desktop-'));
  try {
    const base = {
      root,
      version: '1.142.0',
      packaged: false,
      artifactDir: join(root, 'artifacts'),
    };
    const plain = validateDesktopOptions(base);
    assert.equal('hostCgroup' in plain, false);
    const scoped = validateDesktopOptions({
      ...base,
      hostCgroup: 'rdlc-desktop',
    });
    assert.equal(scoped.hostCgroup, 'rdlc-desktop');
    assert.deepEqual(
      desktopLaunchArgs(scoped, desktopPaths(scoped, 'a')),
      desktopLaunchArgs(plain, desktopPaths(plain, 'a')),
    );
    for (const hostCgroup of ['', 'a/b', '../x', '/rdlc', 'a b'])
      assert.throws(
        () => validateDesktopOptions({ ...base, hostCgroup }),
        /Invalid cgroup name/,
        hostCgroup,
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
  assert.ok(
    manifest.contributes.commands.some(
      (c) =>
        c.command === 'rdlcTests.openRequestedFile' &&
        c.title === 'RDLC Test: Open Requested File',
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

test('files open through the harness request, confirmed by a matching result', async () => {
  assert.equal(
    parseOpenResult('{"id":"a","ok":true,"opened":"/w/a"}', 'a'),
    '/w/a',
  );
  assert.throws(
    () => parseOpenResult('{"id":"b","ok":true}', 'a'),
    /different/,
  );
  assert.throws(
    () => parseOpenResult('{"id":"a","ok":false,"error":"boom"}', 'a'),
    /boom/,
  );
  const profileDir = mkdtempSync(join(tmpdir(), 'rdlc-open-'));
  try {
    const seen: { path: string; viewType?: string }[] = [];
    const driver = {
      profileDir,
      async command(id: string) {
        assert.equal(id, 'RDLC Test: Open Requested File');
        const request = JSON.parse(
          readFileSync(openRequestPath(profileDir), 'utf8'),
        ) as { id: string; path: string; viewType?: string };
        seen.push(request);
        writeFileSync(
          openResultPath(profileDir),
          JSON.stringify({ id: request.id, ok: true, opened: request.path }),
        );
      },
    };
    await openWorkspaceFile(driver, '/w/a.rdlc');
    await openWorkspaceFile(driver, '/w/b.rdlc', 'rdlcCode.editor');
    assert.deepEqual(
      seen.map(({ path, viewType }) => [path, viewType]),
      [
        ['/w/a.rdlc', undefined],
        ['/w/b.rdlc', 'rdlcCode.editor'],
      ],
    );
    const answering = (...answers: (string | (() => void))[]) => ({
      profileDir,
      async command() {
        for (const answer of answers)
          if (typeof answer === 'string')
            writeFileSync(openResultPath(profileDir), answer);
          else answer();
      },
    });
    // A result for another request is never evidence: the wait names the last cause.
    await assert.rejects(
      openWorkspaceFile(
        answering(JSON.stringify({ id: 'stale', ok: true })),
        '/w/c.rdlc',
        undefined,
        300,
      ),
      /did not report opening \/w\/c\.rdlc: .*different open request/,
    );
    // No result at all.
    await assert.rejects(
      openWorkspaceFile(answering(), '/w/c.rdlc', undefined, 300),
      /did not report opening .*ENOENT/,
    );
    // A harness failure is final and reports its error, even without an id.
    await assert.rejects(
      openWorkspaceFile(
        answering(JSON.stringify({ id: null, ok: false, error: 'boom' })),
        '/w/c.rdlc',
      ),
      /Opening \/w\/c\.rdlc: .*boom/,
    );
    // A torn read is retried, and a late mismatched id is followed by the right one.
    let request = '';
    const late = {
      profileDir,
      async command() {
        request = (
          JSON.parse(readFileSync(openRequestPath(profileDir), 'utf8')) as {
            id: string;
          }
        ).id;
        writeFileSync(openResultPath(profileDir), '{"id":');
        setTimeout(
          () =>
            writeFileSync(
              openResultPath(profileDir),
              JSON.stringify({ id: 'stale', ok: true }),
            ),
          150,
        );
        setTimeout(
          () =>
            writeFileSync(
              openResultPath(profileDir),
              JSON.stringify({ id: request, ok: true, opened: '/w/d.rdlc' }),
            ),
          350,
        );
      },
    };
    await openWorkspaceFile(late, '/w/d.rdlc');
    await assert.rejects(
      openWorkspaceFile(answering(), 'relative/e.rdlc'),
      /must be absolute/,
    );
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

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

test('a transient evaluate failure is repeated at most three times, nothing else is', async () => {
  const garbage = new Error(
    'electronApplication.evaluate: Resulting promise was garbage collected.',
  );
  let calls = 0;
  assert.equal(
    await retryTransientEvaluate(async () => {
      if (++calls < 3) throw garbage;
      return 'done';
    }),
    'done',
  );
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    retryTransientEvaluate(async () => {
      calls++;
      throw garbage;
    }),
    garbage,
  );
  assert.equal(calls, 3);

  calls = 0;
  const other = new Error('Target closed');
  await assert.rejects(
    retryTransientEvaluate(async () => {
      calls++;
      throw other;
    }),
    other,
  );
  assert.equal(calls, 1);
});

test('fitContentSize reduces the request to the display work area', () => {
  const desired = { width: 1440, height: 900 };
  const frame = { width: 0, height: 28 };
  assert.deepEqual(
    fitContentSize(desired, { width: 1920, height: 1040 }, frame),
    desired,
  );
  assert.deepEqual(
    fitContentSize(desired, { width: 1440, height: 712 }, frame),
    { width: 1440, height: 684 },
  );
  assert.deepEqual(
    fitContentSize(desired, { width: 1024, height: 700 }, frame),
    { width: 1024, height: 672 },
  );
});

test('assessWindowGeometry reports full, constrained and refuses a cramped window', () => {
  const workArea = { width: 1440, height: 712 };
  const full = assessWindowGeometry({
    requested: { width: 1440, height: 900 },
    content: { width: 1440, height: 900 },
    workArea: { width: 1920, height: 1040 },
  });
  assert.equal(full.status, 'full');

  const constrained = assessWindowGeometry({
    requested: { width: 1440, height: 684 },
    content: { width: 1440, height: 684 },
    workArea,
  });
  assert.equal(constrained.status, 'constrained');
  assert.deepEqual(constrained.desired, { width: 1440, height: 900 });

  assert.throws(
    () =>
      assessWindowGeometry({
        requested: { width: 1440, height: 560 },
        content: { width: 1440, height: 560 },
        workArea: { width: 1440, height: 588 },
      }),
    /1440x560, below the 1280x600 minimum/,
  );
  assert.throws(
    () =>
      assessWindowGeometry({
        requested: { width: 1024, height: 768 },
        content: { width: 1024, height: 768 },
        workArea: { width: 1024, height: 768 },
      }),
    /below the 1280x600 minimum/,
  );
});
