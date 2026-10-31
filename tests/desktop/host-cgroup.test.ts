import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HostCgroupError,
  LAUNCHER_FAILURE_STATUS,
  assertCgroupName,
  cgroupLauncherScript,
  connectProbeInCgroup,
  hostBlockingLaunchOption,
  hostCgroupProblem,
  inCgroup,
  parseProcCgroup,
  prepareCgroupLauncher,
  writeCgroupLauncher,
} from './host-cgroup.js';

/** A fake cgroup2 mount: controllers file plus one cgroup with a writable procs file. */
function fakeCgroupRoot(name = 'rdlc-desktop'): {
  root: string;
  procs: string;
  dir: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'rdlc-cgroup-test-'));
  const root = join(dir, 'cgroup');
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, 'cgroup.controllers'), 'cpu memory\n');
  const procs = join(root, name, 'cgroup.procs');
  writeFileSync(procs, '');
  return { root, procs, dir };
}

const PRINT_SELF = `console.log(JSON.stringify({ pid: process.pid, ppid: process.ppid, args: process.argv.slice(1) }))`;

test('cgroup names are a single safe path segment', () => {
  assert.equal(assertCgroupName('rdlc-desktop'), 'rdlc-desktop');
  assert.equal(assertCgroupName('a.b_c-1'), 'a.b_c-1');
  for (const bad of ['', '.', '..', '../x', 'a/b', '/a', 'a b', '-x', "a'b"])
    assert.throws(() => assertCgroupName(bad), HostCgroupError, bad);
});

test('the launch option scopes the Desktop on Linux only', () => {
  assert.deepEqual(hostBlockingLaunchOption('linux'), {
    hostCgroup: 'rdlc-desktop',
  });
  assert.deepEqual(hostBlockingLaunchOption('win32'), {});
  assert.deepEqual(hostBlockingLaunchOption('darwin'), {});
});

test('/proc/<pid>/cgroup is read as the unified entry, matched recursively and exactly', () => {
  assert.equal(parseProcCgroup('0::/rdlc-desktop\n'), '/rdlc-desktop');
  assert.equal(parseProcCgroup('12:cpu:/\n'), null);
  assert.equal(
    parseProcCgroup('12:cpu:/x\n0::/user.slice/a.scope\n'),
    '/user.slice/a.scope',
  );
  assert.ok(inCgroup('0::/rdlc-desktop\n', 'rdlc-desktop'));
  assert.ok(inCgroup('0::/rdlc-desktop/leaf\n', 'rdlc-desktop'));
  assert.ok(!inCgroup('0::/rdlc-desktop-other\n', 'rdlc-desktop'));
  assert.ok(!inCgroup('0::/user.slice/rdlc-desktop\n', 'rdlc-desktop'));
  assert.ok(!inCgroup('0::/\n', 'rdlc-desktop'));
  assert.ok(!inCgroup('12:cpu:/rdlc-desktop\n', 'rdlc-desktop'));
});

test('the launcher script moves its own pid and then exec s the target without forking', () => {
  const sudo = cgroupLauncherScript({
    procsFile: '/sys/fs/cgroup/rdlc-desktop/cgroup.procs',
    target: '/opt/vscode/code',
    elevate: 'sudo',
  });
  assert.match(sudo, /^#!\/bin\/sh\n/);
  assert.match(sudo, /sudo -n sh -c .* rdlc-cgroup "\$\$" "\$procs"/);
  assert.match(sudo, /exit 97\n/);
  assert.match(sudo, /\nexec "\$target" "\$@"\n$/);
  assert.match(sudo, /procs='\/sys\/fs\/cgroup\/rdlc-desktop\/cgroup\.procs'/);
  const direct = cgroupLauncherScript({
    procsFile: '/p',
    target: '/t',
    elevate: 'none',
  });
  assert.doesNotMatch(direct, /sudo/);
  // A quote in a path cannot break out of the assignment.
  const quoted = cgroupLauncherScript({
    procsFile: '/p',
    target: "/tmp/it's here/code",
    elevate: 'none',
  });
  assert.match(quoted, /target='\/tmp\/it'\\''s here\/code'/);
});

test('an executed launcher keeps the pid, enters the cgroup first and forwards every argument', () => {
  const { dir, procs } = fakeCgroupRoot();
  try {
    const launcher = writeCgroupLauncher(join(dir, 'bin'), {
      procsFile: procs,
      target: process.execPath,
      elevate: 'none',
    });
    assert.ok((statSync(launcher).mode & 0o111) !== 0, 'executable');
    const result = spawnSync(
      launcher,
      ['-e', PRINT_SELF, 'two words', "it's", '$HOME', '--flag=1'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const seen = JSON.parse(result.stdout) as {
      pid: number;
      args: string[];
    };
    // Same pid as the process that was spawned: exec, not fork.
    assert.equal(seen.pid, result.pid);
    assert.deepEqual(seen.args, ['two words', "it's", '$HOME', '--flag=1']);
    // The pid written into cgroup.procs is that very process.
    assert.equal(readFileSync(procs, 'utf8').trim(), String(result.pid));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a launcher that cannot enter the cgroup fails without starting the target', () => {
  const { dir } = fakeCgroupRoot();
  try {
    const marker = join(dir, 'started');
    const launcher = writeCgroupLauncher(join(dir, 'bin'), {
      procsFile: join(dir, 'missing', 'cgroup.procs'),
      target: process.execPath,
      elevate: 'none',
    });
    const result = spawnSync(
      launcher,
      ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, LAUNCHER_FAILURE_STATUS);
    assert.match(
      result.stderr,
      /cannot move pid \d+ into .*target was not started/,
    );
    assert.throws(() => statSync(marker), 'the target never ran');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fake `sudo` that logs its arguments, requires -n, then runs the rest. */
function fakeSudo(
  dir: string,
  behaviour: 'run' | 'deny',
): { path: string; log: string } {
  const bin = join(dir, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, 'sudo.log');
  writeFileSync(
    join(bin, 'sudo'),
    behaviour === 'deny'
      ? `#!/bin/sh\necho "denied $*" >> '${log}'\necho "sudo: a password is required" >&2\nexit 1\n`
      : `#!/bin/sh\necho "$*" >> '${log}'\n[ "$1" = "-n" ] || exit 2\nshift\nexec "$@"\n`,
  );
  chmodSync(join(bin, 'sudo'), 0o755);
  return { path: `${bin}:${process.env['PATH'] ?? ''}`, log };
}

test('the sudo launcher writes through sudo -n and fails closed when sudo is denied', () => {
  const { dir, procs } = fakeCgroupRoot();
  try {
    const launcher = writeCgroupLauncher(join(dir, 'bin'), {
      procsFile: procs,
      target: process.execPath,
      elevate: 'sudo',
    });
    const allowed = fakeSudo(join(dir, 'allowed'), 'run');
    const ok = spawnSync(launcher, ['-e', PRINT_SELF], {
      encoding: 'utf8',
      env: { ...process.env, PATH: allowed.path },
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).pid, ok.pid);
    assert.equal(readFileSync(procs, 'utf8').trim(), String(ok.pid));
    assert.match(readFileSync(allowed.log, 'utf8'), /^-n sh -c /);

    writeFileSync(procs, '');
    const refused = fakeSudo(join(dir, 'refused'), 'deny');
    const denied = spawnSync(launcher, ['-e', PRINT_SELF], {
      encoding: 'utf8',
      env: { ...process.env, PATH: refused.path },
    });
    assert.equal(denied.status, LAUNCHER_FAILURE_STATUS);
    assert.equal(denied.stdout, '', 'the target did not run');
    assert.equal(readFileSync(procs, 'utf8'), '', 'nothing was moved');
    assert.match(denied.stderr, /password is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cgroup prerequisites name what to set up and never accept a missing cgroup', () => {
  const { dir, root } = fakeCgroupRoot();
  try {
    // Healthy as root: the procs file is writable directly.
    assert.equal(hostCgroupProblem('rdlc-desktop', { root, uid: 0 }), null);
    // Non-root goes through sudo -n test -w.
    const calls: string[] = [];
    assert.equal(
      hostCgroupProblem('rdlc-desktop', {
        root,
        uid: 1001,
        command: (file, args) => void calls.push([file, ...args].join(' ')),
      }),
      null,
    );
    assert.deepEqual(calls, [
      `sudo -n test -w ${join(root, 'rdlc-desktop', 'cgroup.procs')}`,
    ]);
    assert.match(
      hostCgroupProblem('rdlc-desktop', {
        root,
        uid: 1001,
        command: () => {
          throw new Error('sudo: a password is required');
        },
      }) ?? '',
      /passwordless sudo is required.*password is required/,
    );
    assert.match(
      hostCgroupProblem('absent', { root, uid: 0 }) ?? '',
      /does not exist\. Create it once before the run with: sudo mkdir -p \/sys\/fs\/cgroup\/absent/,
    );
    assert.match(
      hostCgroupProblem('rdlc-desktop', {
        root: join(dir, 'nowhere'),
        uid: 0,
      }) ?? '',
      /cgroup v2 is not mounted/,
    );
    // A plain directory is not a cgroup.
    mkdirSync(join(root, 'plain'));
    assert.match(
      hostCgroupProblem('plain', { root, uid: 0 }) ?? '',
      /is not a cgroup/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preparing a launcher fails clearly without the cgroup and writes an executable one with it', () => {
  const { dir, root, procs } = fakeCgroupRoot();
  try {
    assert.throws(
      () =>
        prepareCgroupLauncher({
          cgroup: 'absent',
          target: '/t',
          directory: join(dir, 'out'),
          root,
          uid: 0,
        }),
      (error: unknown) =>
        error instanceof HostCgroupError &&
        /Host-blocking cgroup is unavailable: .*does not exist/.test(
          error.message,
        ),
    );
    const path = prepareCgroupLauncher({
      cgroup: 'rdlc-desktop',
      target: '/opt/code',
      directory: join(dir, 'out'),
      root,
      uid: 1001,
      command: () => {},
    });
    const source = readFileSync(path, 'utf8');
    assert.match(source, /sudo -n/);
    assert.ok(source.includes(`procs='${procs}'`));
    assert.ok(source.includes("target='/opt/code'"));
    const asRoot = prepareCgroupLauncher({
      cgroup: 'rdlc-desktop',
      target: '/opt/code',
      directory: join(dir, 'out'),
      root,
      uid: 0,
    });
    assert.doesNotMatch(readFileSync(asRoot, 'utf8'), /sudo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the in-cgroup probe connects from a launcher-started process and reports its outcome', async () => {
  const { dir, root, procs } = fakeCgroupRoot();
  try {
    // A closed loopback port: the probe process itself reports the refusal.
    const port = await new Promise<number>((resolvePort, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const value = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolvePort(value));
      });
    });
    const code = await connectProbeInCgroup({
      cgroup: 'rdlc-desktop',
      host: '127.0.0.1',
      port,
      root,
      uid: 0,
    });
    assert.equal(code, 'ECONNREFUSED');
    assert.match(
      readFileSync(procs, 'utf8').trim(),
      /^\d+$/,
      'the probe process entered the cgroup before it connected',
    );
    // When the launcher cannot enter the cgroup the probe is an error, not a result.
    await assert.rejects(
      connectProbeInCgroup({
        cgroup: 'absent',
        host: '127.0.0.1',
        port,
        root,
        uid: 0,
      }),
      /In-cgroup connect probe failed: [\s\S]*cannot move pid/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
