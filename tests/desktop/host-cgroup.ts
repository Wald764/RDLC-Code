import { execFile, execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Linux host blocking is scoped to the Desktop process tree through a dedicated
 * cgroup v2, never through the runner uid: on a hosted runner the runner agent
 * shares that uid, and rejecting its traffic cuts the job off from GitHub.
 *
 * The Desktop is started through a tiny generated launcher that moves its own
 * pid into the cgroup and then exec's the real executable, so the pid is the
 * Desktop's and every descendant inherits the cgroup. The iptables rule matches
 * that cgroup (`-m cgroup --path`, relative to the cgroup2 root).
 */

/** The cgroup, relative to the cgroup2 root, that holds the Desktop tree. */
export const HOST_CGROUP_NAME = 'rdlc-desktop';
export const CGROUP2_ROOT = '/sys/fs/cgroup';

/** Exit status of the launcher when it cannot enter the cgroup. */
export const LAUNCHER_FAILURE_STATUS = 97;

export class HostCgroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostCgroupError';
  }
}

const CGROUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** One path segment: it ends up in an iptables argument and a file path. */
export function assertCgroupName(name: string): string {
  if (!CGROUP_NAME.test(name))
    throw new HostCgroupError(
      `Invalid cgroup name "${name}": a single path segment of letters, digits, dot, underscore or dash is required.`,
    );
  return name;
}

export function hostCgroupSetupHint(name: string = HOST_CGROUP_NAME): string {
  return `Create it once before the run with: sudo mkdir -p ${CGROUP2_ROOT}/${name}`;
}

/** The Desktop is only scoped on Linux; elsewhere there is no host blocking at all. */
export function hostBlockingLaunchScope(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'linux' ? HOST_CGROUP_NAME : undefined;
}

/** Spread into the `launchDesktop` options of every test that enables host blocking. */
export function hostBlockingLaunchOption(
  platform: NodeJS.Platform = process.platform,
): { hostCgroup?: string } {
  const hostCgroup = hostBlockingLaunchScope(platform);
  return hostCgroup === undefined ? {} : { hostCgroup };
}

export type HostCommand = (file: string, args: readonly string[]) => void;

const defaultCommand: HostCommand = (file, args) => {
  execFileSync(file, [...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 15_000,
  });
};

export interface CgroupPrerequisiteOptions {
  readonly root?: string;
  readonly uid?: number | undefined;
  readonly command?: HostCommand;
}

/**
 * Why the cgroup cannot be used, or null when it can. Checks that cgroup v2 is
 * mounted, the cgroup exists, and the launcher will be allowed to write its
 * `cgroup.procs` (directly as root, otherwise through `sudo -n`).
 */
export function hostCgroupProblem(
  name: string = HOST_CGROUP_NAME,
  options: CgroupPrerequisiteOptions = {},
): string | null {
  const root = options.root ?? CGROUP2_ROOT;
  if (!existsSync(join(root, 'cgroup.controllers')))
    return `cgroup v2 is not mounted at ${root} (no cgroup.controllers); cgroup-scoped host blocking needs the unified hierarchy.`;
  const dir = join(root, name);
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a directory');
  } catch {
    return `The cgroup ${dir} does not exist. ${hostCgroupSetupHint(name)}`;
  }
  const procs = join(dir, 'cgroup.procs');
  if (!existsSync(procs))
    return `${dir} is not a cgroup (no cgroup.procs). ${hostCgroupSetupHint(name)}`;
  const uid = 'uid' in options ? options.uid : process.getuid?.();
  const command = options.command ?? defaultCommand;
  try {
    if (uid === 0) accessSync(procs, constants.W_OK);
    else command('sudo', ['-n', 'test', '-w', procs]);
  } catch (error) {
    return `${procs} is not writable${uid === 0 ? '' : ' through "sudo -n" (passwordless sudo is required)'}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface LauncherOptions {
  /** cgroup.procs file the launcher writes its own pid to. */
  readonly procsFile: string;
  /** Executable the launcher replaces itself with. */
  readonly target: string;
  /** `sudo` writes through `sudo -n`; `none` writes directly (root, tests). */
  readonly elevate: 'sudo' | 'none';
}

/**
 * POSIX shell source of the launcher. It writes `$$` (its own pid) into the
 * cgroup and then `exec`s the target with every argument it was given: no fork
 * of the target, so the pid Playwright or the test runner sees is the target's.
 * When the move fails it exits without running the target, so the Desktop is
 * never started outside the cgroup.
 */
export function cgroupLauncherScript(options: LauncherOptions): string {
  const move =
    options.elevate === 'sudo'
      ? `sudo -n sh -c 'printf "%s\\n" "$1" > "$2"' rdlc-cgroup "$$" "$procs"`
      : `printf '%s\\n' "$$" > "$procs"`;
  return `#!/bin/sh
# Generated by tests/desktop/host-cgroup.ts. Moves this process into the host
# blocking cgroup, then replaces itself with the target (same pid, no fork).
procs=${shellQuote(options.procsFile)}
target=${shellQuote(options.target)}
if ! ${move}; then
  echo "rdlc host cgroup: cannot move pid $$ into $procs; the target was not started" >&2
  exit ${LAUNCHER_FAILURE_STATUS}
fi
exec "$target" "$@"
`;
}

/** Write an executable launcher into `directory`; returns its path. */
export function writeCgroupLauncher(
  directory: string,
  options: LauncherOptions,
): string {
  mkdirSync(directory, { recursive: true });
  const path = join(
    directory,
    `cgroup-launch-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`,
  );
  writeFileSync(path, cgroupLauncherScript(options), { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/**
 * Check the cgroup and write the launcher that starts `target` inside it.
 * Throws a HostCgroupError saying what to set up; never falls back to another
 * scope.
 */
export function prepareCgroupLauncher(options: {
  readonly cgroup: string;
  readonly target: string;
  readonly directory: string;
  readonly root?: string;
  readonly uid?: number | undefined;
  readonly command?: HostCommand;
}): string {
  const name = assertCgroupName(options.cgroup);
  const problem = hostCgroupProblem(name, options);
  if (problem)
    throw new HostCgroupError(
      `Host-blocking cgroup is unavailable: ${problem}`,
    );
  const uid = 'uid' in options ? options.uid : process.getuid?.();
  return writeCgroupLauncher(options.directory, {
    procsFile: join(options.root ?? CGROUP2_ROOT, name, 'cgroup.procs'),
    target: options.target,
    elevate: uid === 0 ? 'none' : 'sudo',
  });
}

/** The unified-hierarchy path of a `/proc/<pid>/cgroup` listing, or null. */
export function parseProcCgroup(listing: string): string | null {
  const line = listing.split(/\r?\n/).find((entry) => entry.startsWith('0::'));
  return line === undefined ? null : line.slice(3);
}

/** True when `listing` places the process in `/<name>` or one of its descendants. */
export function inCgroup(listing: string, name: string): boolean {
  const path = parseProcCgroup(listing);
  return path === `/${name}` || (path?.startsWith(`/${name}/`) ?? false);
}

/** /proc/<pid>/cgroup, or null when the process is gone. */
export function readProcCgroup(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/cgroup`, 'utf8');
  } catch {
    return null;
  }
}

/** Source run by `node -e` inside the cgroup; argv is [host, port]. */
export const CONNECT_PROBE_SOURCE = `
const [host, port] = process.argv.slice(1);
const socket = require('node:net').connect({ host, port: Number(port) || 443 });
const finish = (code) => { clearTimeout(timer); socket.destroy(); console.log(code); };
const timer = setTimeout(() => finish('TIMEOUT'), 4000);
socket.once('connect', () => finish('CONNECTED'));
socket.once('error', (error) => finish(error.code || 'ERROR'));
`;

/**
 * Connect to `host` from a process that lives in the cgroup, through the same
 * launcher the Desktop uses. A probe from the test runner would be outside the
 * cgroup and prove nothing about the rule. Resolves with the connect outcome;
 * rejects when the launcher cannot enter the cgroup.
 */
export function connectProbeInCgroup(
  options: {
    readonly cgroup: string;
    readonly host: string;
    readonly port?: number;
    readonly root?: string;
    readonly uid?: number | undefined;
  },
  executable: string = process.execPath,
): Promise<string> {
  const name = assertCgroupName(options.cgroup);
  const directory = mkdtempSync(join(tmpdir(), 'rdlc-cgroup-probe-'));
  const uid = 'uid' in options ? options.uid : process.getuid?.();
  const launcher = writeCgroupLauncher(directory, {
    procsFile: join(options.root ?? CGROUP2_ROOT, name, 'cgroup.procs'),
    target: executable,
    elevate: uid === 0 ? 'none' : 'sudo',
  });
  return new Promise<string>((resolve, reject) => {
    execFile(
      launcher,
      ['-e', CONNECT_PROBE_SOURCE, options.host, String(options.port ?? 443)],
      { timeout: 20_000, encoding: 'utf8' },
      (error, stdout, stderr) => {
        rmSync(directory, { recursive: true, force: true });
        const code = stdout.trim().split(/\r?\n/).pop() ?? '';
        if (error || !code)
          reject(
            new Error(
              `In-cgroup connect probe failed: ${
                stderr.trim() ||
                (error instanceof Error ? error.message : 'no result')
              }`,
            ),
          );
        else resolve(code);
      },
    );
  });
}
