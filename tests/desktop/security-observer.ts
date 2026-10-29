import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
} from 'node:fs';
import { connect as netConnect } from 'node:net';
import { homedir, platform as osPlatform } from 'node:os';
import { basename, join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserContext, Request } from 'playwright';

/**
 * Native syscall capture is only evidence for concrete attempts. Query, entity
 * and report-resource evaluation have no syscall identity: a file/network event
 * cannot prove that a report expression or data source was evaluated.
 */
export const SEMANTIC_PROOF_LIMITATION =
  'Query, entity, data-source and image-resource evaluation is not directly observable: file and network syscalls cannot be attributed to report evaluation without caller-provided correlation.';

export const NATIVE_CHANNELS = ['network', 'file', 'exec', 'process'] as const;

export type NativeChannel = (typeof NATIVE_CHANNELS)[number];
export type SemanticChannel = 'resource' | 'query' | 'entity';
export type ObservationSource = 'host-process-tree' | 'webview-network';
export type CoverageState = 'observed' | 'partial' | 'unsupported';
export type EventOutcome = 'attempted' | 'failed' | 'succeeded';

export interface SecurityEvent {
  /** Absolute epoch milliseconds from strace -ttt; null when unavailable. */
  readonly atMs: number | null;
  readonly source: ObservationSource;
  readonly channel: NativeChannel | 'webview';
  readonly operation: string;
  readonly outcome: EventOutcome;
  readonly pid: number | null;
  /** Sanitized target: origin only for network, basename for exec, redacted path for files. */
  readonly target: string;
  /** Sanitized errno/failure token, never a raw payload. */
  readonly error: string | null;
  /**
   * Classified against the raw (pre-sanitization) syscall arguments, only when an
   * allowlist was requested: opens outside it, execs outside it and connects to
   * non-loopback, non-unix addresses are unexpected.
   */
  readonly unexpected?: boolean;
}

export interface AllowedAccess {
  /**
   * Absolute roots every file syscall may touch, writes included (disposable
   * profile, a dedicated tmp dir, extension storage, fontconfig caches). The
   * enumerated runtime paths in RUNTIME_PATHS apply on top, read-only; there is
   * no blanket allowance.
   */
  readonly open: readonly string[];
  /**
   * Absolute roots that may only be read, stat-ed or traversed (VS Code install,
   * extension sources, auth files). A write below one is unexpected.
   */
  readonly readOnly?: readonly string[];
  /** Absolute roots that execve may run from; /proc/self/exe (Desktop re-exec) is always allowed. */
  readonly exec: readonly string[];
  /** Home directory used by the secret-path denylist; defaults to the runner's. */
  readonly home?: string;
}

export interface NativeCaptureControls {
  readonly network: boolean;
  readonly file: boolean;
  readonly exec: boolean;
  readonly process: boolean;
  readonly shortLived: boolean;
}

export interface NativeCaptureCapability {
  readonly supported: boolean;
  readonly reason: string;
  readonly controls: NativeCaptureControls;
}

export interface NativeCapability {
  readonly platform: NodeJS.Platform;
  readonly tool: 'strace' | null;
  readonly version: string | null;
  /** Full lifecycle: strace launches the command, so no pre-attach gap exists. */
  readonly launch: NativeCaptureCapability;
  /** Mid-life attach: covers the process tree from attach time, not launch. */
  readonly attach: NativeCaptureCapability;
}

export interface SecurityCapability {
  readonly platform: NodeJS.Platform;
  readonly native: NativeCapability;
  readonly webview: {
    readonly supported: true;
    readonly scope: string;
    readonly reason: string;
  };
  readonly semantic: Record<SemanticChannel, 'not-observable'>;
  readonly limitations: readonly string[];
}

export interface NativeObservation {
  readonly mode: 'launch' | 'attach';
  readonly state: CoverageState;
  readonly reason: string | null;
  readonly requestedPids: readonly number[];
  readonly attachedPids: readonly number[];
  readonly attachFailures: readonly string[];
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly events: readonly SecurityEvent[];
}

export interface WebviewObservation {
  readonly state: CoverageState;
  readonly reason: string | null;
  readonly truncated: boolean;
  readonly events: readonly SecurityEvent[];
}

export interface SecurityObservation {
  readonly startedAt: string;
  readonly stoppedAt: string;
  readonly durationMs: number;
  readonly capability: SecurityCapability;
  readonly native: NativeObservation;
  readonly webview: WebviewObservation;
  readonly events: readonly SecurityEvent[];
  /**
   * True only for host syscalls plus browser/webview network attempts. It never
   * proves query/entity/resource evaluation; see SEMANTIC_PROOF_LIMITATION.
   */
  readonly captureComplete: boolean;
  readonly failures: readonly string[];
  readonly limitations: readonly string[];
}

export interface NativeObserverOptions {
  readonly redactions?: readonly string[];
  readonly allowed?: AllowedAccess;
  readonly maxDurationMs?: number;
  readonly maxEvents?: number;
  readonly maxTraceBytes?: number;
}

export interface TracedCommandOptions extends NativeObserverOptions {
  readonly command: string;
  readonly args?: readonly string[];
}

export interface AttachedObservationOptions extends NativeObserverOptions {
  readonly rootPid: number;
}

export interface ObservationHandle<T> {
  stop(): Promise<T>;
}

export interface TracedCommand extends ObservationHandle<NativeObservation> {
  /** The strace process. It exits when the traced command and descendants exit. */
  readonly child: ChildProcess;
}

export interface SecurityObserverInput {
  readonly rootPid: number | null;
  readonly rootPidDetail?: string;
  readonly context: BrowserContext;
  readonly capability?: SecurityCapability;
  readonly redactions?: readonly string[];
  readonly allowed?: AllowedAccess;
  readonly maxDurationMs?: number;
  readonly maxEvents?: number;
  readonly maxTraceBytes?: number;
}

export interface SecurityObserver {
  readonly capability: SecurityCapability;
  start(): Promise<void>;
  stop(): Promise<SecurityObservation>;
}

export class SecurityObserverUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityObserverUnsupportedError';
  }
}

/** %network without the receive calls (recvfrom, recvmsg, recvmmsg). */
const NETWORK_CALLS_TRACED =
  'accept,accept4,bind,connect,getpeername,getsockname,getsockopt,listen,sendmmsg,sendmsg,sendto,setsockopt,shutdown,socket,socketpair';

/**
 * -yy decodes fd arguments to paths, so dirfd-relative and relative file
 * accesses can be resolved; -s 4096 keeps whole PATH_MAX paths untruncated.
 * The receive calls are never an outbound attempt, and Chromium's IPC polling
 * made them a large part of the trace with their 4096-byte payloads.
 */
export const STRACE_ARGS = [
  '-f',
  '-ttt',
  '-yy',
  '-s',
  '4096',
  // One positive list: a second `-e trace=!...` would turn the whole filter into
  // "every syscall except those" (futex, mmap, ... flood the trace). It is %file,
  // %process and the members of %network that put or tune something on a socket,
  // so the receive calls (recvfrom, recvmsg, recvmmsg: bulky, never outbound) are
  // left out by omission.
  '-e',
  `trace=%file,%process,${NETWORK_CALLS_TRACED}`,
] as const;

const DEFAULT_MAX_DURATION = 60_000;
const DEFAULT_MAX_EVENTS = 20_000;
const DEFAULT_MAX_TRACE_BYTES = 8 * 1024 * 1024;
const ATTACH_TIMEOUT = 5_000;
const STOP_TIMEOUT = 5_000;

const LAUNCH_CONTROL = `
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
try { fs.openSync('/nonexistent/rdlc-security-probe-file', 'r'); } catch {}
execFile('/nonexistent/rdlc-security-probe-exec', () => {});
const socket = net.connect({ host: '127.0.0.1', port: 1 });
socket.on('error', () => {});
const child = fs.existsSync('/bin/true') ? '/bin/true' : process.execPath;
execFile(child, child === process.execPath ? ['-e', 'process.exit(0)'] : [], () => {
  setTimeout(() => process.exit(0), 250);
});
setTimeout(() => process.exit(0), 1500);
`;

const ATTACH_CONTROL = `
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const child = fs.existsSync('/bin/true') ? '/bin/true' : process.execPath;
const attempt = () => {
  try { fs.openSync('/nonexistent/rdlc-security-attach-file', 'r'); } catch {}
  execFile('/nonexistent/rdlc-security-attach-exec', () => {});
  const socket = net.connect({ host: '127.0.0.1', port: 1 });
  socket.on('error', () => {});
  execFile(child, child === process.execPath ? ['-e', 'process.exit(0)'] : []);
};
attempt();
const timer = setInterval(attempt, 120);
setTimeout(() => { clearInterval(timer); process.exit(0); }, 1200);
`;

const NETWORK_CALLS = new Set([
  'connect',
  'socket',
  'socketpair',
  'bind',
  'listen',
  'accept',
  'accept4',
  'sendto',
  'sendmsg',
  'sendmmsg',
  'recvfrom',
  'recvmsg',
  'recvmmsg',
  'shutdown',
  'getsockname',
  'getpeername',
  'setsockopt',
  'getsockopt',
]);

/** Inbound only: never an outbound attempt, whatever address or peer the fd carries. */
const RECEIVE_CALLS = new Set(['recvfrom', 'recvmsg', 'recvmmsg']);

/** Socket state and options: they query or tune an fd and put nothing on the wire. */
const SOCKET_STATE_CALLS = new Set([
  'getsockname',
  'getpeername',
  'getsockopt',
  'setsockopt',
  'shutdown',
]);

const EXEC_CALLS = new Set(['execve', 'execveat']);

const PROCESS_SPAWN_CALLS = new Set(['clone', 'clone3', 'fork', 'vfork']);

const PROCESS_CALLS = new Set([
  'clone',
  'clone3',
  'fork',
  'vfork',
  'exit',
  'exit_group',
]);

const FILE_CALLS = new Set([
  'open',
  'openat',
  'openat2',
  'creat',
  'stat',
  'lstat',
  'fstat',
  'newfstatat',
  'statx',
  'access',
  'faccessat',
  'faccessat2',
  'readlink',
  'readlinkat',
  'unlink',
  'unlinkat',
  'rename',
  'renameat',
  'renameat2',
  'mkdir',
  'mkdirat',
  'rmdir',
  'chdir',
  'chmod',
  'fchmod',
  'fchmodat',
  'chown',
  'lchown',
  'fchown',
  'fchownat',
  'truncate',
  'ftruncate',
  'link',
  'linkat',
  'symlink',
  'symlinkat',
  'utime',
  'utimes',
  'utimensat',
]);

/**
 * Other traced %file syscalls. They have no path layout of their own, so they
 * are unexpected unless FILE_PATH_SLOTS lists them (read-only ones only).
 */
const OTHER_FILE_CALLS = new Set([
  'mknod',
  'mknodat',
  'statfs',
  'statfs64',
  'stat64',
  'lstat64',
  'fstatat64',
  'truncate64',
  'futimesat',
  'inotify_add_watch',
  'fanotify_mark',
  'setxattr',
  'lsetxattr',
  'getxattr',
  'lgetxattr',
  'listxattr',
  'llistxattr',
  'removexattr',
  'lremovexattr',
  'chroot',
  'pivot_root',
  'mount',
  'umount',
  'umount2',
  'swapon',
  'swapoff',
  'acct',
  'quotactl',
  'name_to_handle_at',
  'open_by_handle_at',
  'open_tree',
  'move_mount',
  'fchmodat2',
  'uselib',
]);

function channelFor(operation: string): NativeChannel | null {
  if (NETWORK_CALLS.has(operation)) return 'network';
  if (EXEC_CALLS.has(operation)) return 'exec';
  if (PROCESS_CALLS.has(operation)) return 'process';
  if (FILE_CALLS.has(operation) || OTHER_FILE_CALLS.has(operation))
    return 'file';
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Redact known roots, home directories, sensitive paths, credentials and payloads. */
export function sanitizeTarget(
  value: string,
  redactions: readonly string[] = [],
): string {
  let text = value;
  for (const redaction of [...redactions, homedir()]) {
    if (!redaction) continue;
    const pattern = new RegExp(escapeRegExp(redaction), 'gi');
    text = text.replace(pattern, '<path>');
  }
  text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, '<path>');
  text = text.replace(/\/(?:home|Users)\/[^/\s"']+/g, '<path>');
  text = text.replace(
    /(?:[\\/](?:\.ssh|\.aws|\.gnupg|\.netrc|\.git-credentials|\.docker|\.kube|\.npmrc|\.config|AppData|Cookies|Login Data|id_rsa|id_ed25519)[^\\/\s"']*)/gi,
    '/<path>',
  );
  text = text.replace(
    /(?:password|passwd|pwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*[^\s,;"']+/gi,
    '<redacted>',
  );
  text = text.replace(/\?[^\s"']*/g, '?<redacted>');
  text = text.replace(/[A-Za-z0-9+/=_-]{48,}/g, '<redacted>');
  text = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** Origins only: URL paths, queries, fragments and userinfo never enter the log. */
export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
      return url.protocol;
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-url';
  }
}

function sanitizeFailure(value: string | null): string | null {
  if (!value) return null;
  const known = /net::ERR_[A-Z0-9_]+/.exec(value);
  if (known?.[0]) return known[0];
  return sanitizeTarget(value);
}

function firstQuoted(args: string): string | null {
  const match = /"((?:[^"\\]|\\.)*)"/.exec(args);
  if (!match?.[1]) return null;
  return match[1].replace(/\\(["\\])/g, '$1');
}

/** `sun_path="/x"` (filesystem) or `sun_path=@"x"` (abstract namespace). */
const UNIX_SOCKET = /sun_path=(@?)"([^"]*)"/;

/** The -yy decoration of the fd argument: `UNIX-STREAM:[10->11]` gives family and detail. */
const FD_DECORATION = /^\d+<([A-Za-z0-9]+(?:-[A-Z]+)?):\[(.*?)\]>/;

/**
 * Addressless calls name no destination, so the target says what the fd is:
 * the remembered connect() peer of a datagram socket (`udp6->[2001:db8::1]:53`)
 * or its -yy decoration (`UDPv6:[...]`, `UNIX-STREAM:[<ino>-><ino>]`), with
 * bare inode numbers redacted and quoted socket paths left to sanitizeTarget.
 */
function networkTarget(args: string, remembered?: DatagramPeer): string {
  const ipv4 = /inet_addr\("([^"]+)"\)/.exec(args)?.[1];
  const ipv6 = /inet_pton\(AF_INET6, "([^"]+)"/.exec(args)?.[1];
  const port = /sin6?_port=htons\((\d+)\)/.exec(args)?.[1];
  if (ipv4) return `${ipv4}:${port ?? '?'}`;
  if (ipv6) return `[${ipv6}]:${port ?? '?'}`;
  const unix = UNIX_SOCKET.exec(args);
  if (unix) return `unix:${sanitizeTarget(`${unix[1]}${unix[2]}`)}`;
  const fd = FD_DECORATION.exec(args);
  if (!fd) return 'socket';
  const [, family = '', detail = ''] = fd;
  if (remembered && /^UDP(?:v6)?$/.test(family))
    return `${family.toLowerCase().replace(/v6$/, '6')}->${remembered.address}`;
  const redacted = detail.replace(/"[^"]*"|(?<![\w:.])\d+(?![\w:.])/g, (m) =>
    m.startsWith('"') ? m : '<ino>',
  );
  return `${family}:[${redacted}]`;
}

function eventTarget(
  channel: NativeChannel,
  args: string,
  redactions: readonly string[],
  remembered?: DatagramPeer,
): string {
  if (channel === 'network')
    return sanitizeTarget(networkTarget(args, remembered), redactions);
  if (channel === 'exec') {
    const executable = firstQuoted(args);
    return executable
      ? sanitizeTarget(basename(executable), redactions)
      : 'execve';
  }
  if (channel === 'process') return 'child-process';
  const path = firstQuoted(args);
  return path ? sanitizeTarget(path, redactions) : 'file';
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

interface StraceLine {
  readonly pid: number | null;
  readonly atMs: number | null;
  readonly operation: string;
  readonly args: string;
  readonly result: string;
  readonly unfinished: boolean;
  /** The tail of an interrupted call: its arguments were logged on the unfinished half. */
  readonly resumed?: boolean;
}

function parseStraceLine(line: string): StraceLine | null {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith('+++') ||
    trimmed.startsWith('---') ||
    trimmed.startsWith('strace:')
  )
    return null;

  const marker = ') = ';
  const resultIndex = trimmed.lastIndexOf(marker);
  if (resultIndex !== -1) {
    const header = trimmed.slice(0, resultIndex + 1);
    const result = trimmed.slice(resultIndex + marker.length);
    const resumed =
      /^(?:(\d+)\s+)?(?:(\d+(?:\.\d+)?)\s+)?<\.\.\.\s+([A-Za-z_][A-Za-z0-9_]*)\s+resumed>(.*)\)$/s.exec(
        header,
      );
    if (resumed?.[3] !== undefined) {
      return {
        pid: resumed[1] ? Number(resumed[1]) : null,
        atMs: parseTimestamp(resumed[2]),
        operation: resumed[3],
        args: resumed[4] ?? '',
        result,
        unfinished: false,
        resumed: true,
      };
    }
    const call =
      /^(?:(\d+)\s+)?(?:(\d+(?:\.\d+)?)\s+)?([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/s.exec(
        header,
      );
    if (!call?.[3]) return null;
    return {
      pid: call[1] ? Number(call[1]) : null,
      atMs: parseTimestamp(call[2]),
      operation: call[3],
      args: call[4] ?? '',
      result,
      unfinished: false,
    };
  }

  const unfinished =
    /^(?:(\d+)\s+)?(?:(\d+(?:\.\d+)?)\s+)?([A-Za-z_][A-Za-z0-9_]*)\((.*)<unfinished \.\.\.>$/s.exec(
      trimmed,
    );
  if (!unfinished?.[3]) return null;
  return {
    pid: unfinished[1] ? Number(unfinished[1]) : null,
    atMs: parseTimestamp(unfinished[2]),
    operation: unfinished[3],
    args: unfinished[4] ?? '',
    result: '?',
    unfinished: true,
  };
}

type PathSlot = 'p' | 'd' | 's';

/**
 * Path-taking file syscalls and their argument layout: `p` is a path, `d` a
 * dirfd followed by a path, `s` a string that is not accessed (symlink target).
 * Calls without a path argument (fstat, fchmod, ...) act on an fd that was
 * already classified when it was opened.
 */
export const FILE_PATH_SLOTS: Readonly<Record<string, readonly PathSlot[]>> = {
  open: ['p'],
  openat: ['d'],
  openat2: ['d'],
  creat: ['p'],
  stat: ['p'],
  lstat: ['p'],
  newfstatat: ['d'],
  statx: ['d'],
  access: ['p'],
  faccessat: ['d'],
  faccessat2: ['d'],
  readlink: ['p'],
  readlinkat: ['d'],
  unlink: ['p'],
  unlinkat: ['d'],
  rename: ['p', 'p'],
  renameat: ['d', 'd'],
  renameat2: ['d', 'd'],
  mkdir: ['p'],
  mkdirat: ['d'],
  rmdir: ['p'],
  chdir: ['p'],
  chmod: ['p'],
  fchmodat: ['d'],
  chown: ['p'],
  lchown: ['p'],
  fchownat: ['d'],
  truncate: ['p'],
  link: ['p', 'p'],
  linkat: ['d', 'd'],
  symlink: ['s', 'p'],
  symlinkat: ['s', 'd'],
  utime: ['p'],
  utimes: ['p'],
  utimensat: ['d'],
  execve: ['p'],
  execveat: ['d'],
  // Read-only members of OTHER_FILE_CALLS; every unlisted one stays unexpected.
  statfs: ['p'],
  statfs64: ['p'],
  stat64: ['p'],
  lstat64: ['p'],
  fstatat64: ['d'],
  getxattr: ['p'],
  lgetxattr: ['p'],
  listxattr: ['p'],
  llistxattr: ['p'],
  inotify_add_watch: ['s', 'p'],
};

/** Read-only for the denylist's write rule; every other path call mutates. */
const READ_ONLY_CALLS = new Set([
  'stat',
  'lstat',
  'newfstatat',
  'statx',
  'access',
  'faccessat',
  'faccessat2',
  'readlink',
  'readlinkat',
  'chdir',
  'execve',
  'execveat',
  'statfs',
  'statfs64',
  'stat64',
  'lstat64',
  'fstatat64',
  'getxattr',
  'lgetxattr',
  'listxattr',
  'llistxattr',
  'inotify_add_watch',
]);
/** Metadata-only calls may also touch the ancestors of an allowed root (realpath walks). */
const METADATA_CALLS = new Set([
  'stat',
  'lstat',
  'newfstatat',
  'statx',
  'access',
  'faccessat',
  'faccessat2',
  'readlink',
  'readlinkat',
  'statfs',
  'statfs64',
  'stat64',
  'lstat64',
  'fstatat64',
]);
const OPEN_WRITE_FLAGS = /\b(?:O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND)\b/;

/**
 * Enumerated runtime paths Electron/Chromium need on Linux, READ-ONLY (writes are
 * only allowed for RUNTIME_WRITABLE). ponytail: ceiling is the first Linux
 * baseline run; an entry added here must be a specific file or directory, never
 * a whole top-level tree (/etc, /usr, /proc, /sys, /dev, /tmp). Per-process
 * /proc files are PROC_FILES, not listed here.
 */
export const RUNTIME_PATHS: readonly string[] = [
  '/etc/ld.so.cache',
  // The dynamic loader probes the preload list of every exec; absent on a plain runner.
  '/etc/ld.so.preload',
  '/etc/localtime',
  '/etc/fonts',
  '/etc/ssl/certs',
  '/etc/ssl/cert.pem',
  '/usr/share/ca-certificates',
  '/etc/nsswitch.conf',
  '/etc/hosts',
  '/etc/resolv.conf',
  '/etc/machine-id',
  '/etc/os-release',
  // Enterprise policy files VS Code checks at startup (absent on a plain runner).
  '/etc/vscode/policy.json',
  '/etc/github-copilot/managed-settings.json',
  // jemalloc (ripgrep) reads its configuration and kernel hints when it starts.
  '/etc/malloc.conf',
  '/etc/_rjem_malloc.conf',
  '/proc/sys/vm/overcommit_memory',
  '/sys/kernel/mm/transparent_hugepage/enabled',
  '/etc/passwd',
  '/etc/group',
  '/usr/lib',
  '/usr/lib64',
  '/usr/share/fonts',
  '/usr/share/icons',
  '/usr/share/locale',
  '/usr/share/zoneinfo',
  '/usr/share/glib-2.0',
  '/usr/share/mime',
  '/usr/share/X11',
  '/lib',
  '/lib32',
  '/lib64',
  '/libx32',
  '/var/cache/fontconfig',
  '/proc/sys/kernel',
  '/proc/meminfo',
  '/proc/cpuinfo',
  '/proc/stat',
  '/proc/uptime',
  '/proc/loadavg',
  '/proc/filesystems',
  '/proc/version',
  '/sys/devices/system/cpu',
  '/sys/fs/cgroup',
  '/dev/null',
  '/dev/zero',
  '/dev/urandom',
  '/dev/random',
  '/dev/shm',
  '/dev/pts',
  '/dev/ptmx',
  '/dev/dri',
];

/** The only runtime paths that may be written: scratch devices and the system font cache. */
export const RUNTIME_WRITABLE: readonly string[] = [
  '/dev/null',
  '/dev/shm',
  '/dev/pts',
  '/dev/ptmx',
  '/dev/dri',
  '/var/cache/fontconfig',
];

/**
 * Per-process /proc files (own tree only: self, thread-self or a pid of the
 * observed tree) and why Chromium/Electron read them: memory maps and counters
 * for crash/memory reporting and the allocator, cgroup/mountinfo/limits for
 * sandbox and resource sizing, auxv/cmdline/comm for process identity.
 * root, cwd, map_files, mem and environ are deliberately absent (see isDenied).
 */
const PROC_FILES = new Set([
  'maps',
  'smaps',
  'smaps_rollup',
  'status',
  'stat',
  'statm',
  'cgroup',
  'mountinfo',
  'mounts',
  'limits',
  'cmdline',
  'auxv',
  'comm',
  'oom_score_adj',
  'oom_adj',
]);
/** Directories listed or opened by number (descriptor sweeps before exec, thread enumeration). */
const PROC_DIRS = new Set(['fd', 'fdinfo', 'task']);
/** Files the sandbox/zygote legitimately writes about itself. */
const PROC_WRITABLE = new Set(['oom_score_adj', 'oom_adj', 'comm']);
/** Unix-socket locations other than the dynamic roots: X11 and the D-Bus buses. */
const UNIX_SOCKET_ROOTS = ['/tmp/.X11-unix', '/run/dbus', '/var/run/dbus'];
const USER_BUS = /^\/run\/user\/\d+\/bus$/;
/** Magic links and memory: a path through them reaches arbitrary files or process memory. */
const PROC_MAGIC =
  /^\/proc\/(?:self|thread-self|\d+)(?:\/task\/\d+)?\/(?:root|cwd|map_files|mem)(?:\/|$)/;
/** A `..` after a magic link is resolved by the kernel, not lexically. */
const PROC_MAGIC_PARENT =
  /^\/proc\/(?:self|thread-self|\d+)(?:\/task\/\d+)?\/(?:root|cwd|exe|fd\/[^/]+|map_files\/[^/]+)\/(?:[^/]+\/)*\.\.(?:\/|$)/;

function normalPath(path: string): string {
  return posix.normalize(path).replace(/(.)\/+$/, '$1');
}

function underRoot(path: string, roots: readonly string[]): boolean {
  const normal = normalPath(path);
  return roots.some((root) => {
    const base = normalPath(root);
    return normal === base || normal.startsWith(`${base}/`.replace('//', '/'));
  });
}

function isAncestorOf(path: string, roots: readonly string[]): boolean {
  const normal = normalPath(path);
  return (
    normal === '/' ||
    roots.some((root) => normalPath(root).startsWith(`${normal}/`))
  );
}

/** Split strace arguments at top-level commas, keeping quoted strings and fd `<paths>` whole. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quoted = false;
  for (let index = 0; index < args.length; index++) {
    const char = args[index];
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[' || char === '(' || char === '<')
      depth++;
    else if (
      char === '}' ||
      char === ']' ||
      char === ')' ||
      (char === '>' && args[index - 1] !== '-')
    )
      depth--;
    else if (char === ',' && depth === 0) {
      out.push(args.slice(start, index).trim());
      start = index + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

function quotedPath(token: string | undefined): string | null {
  const match = /^"((?:[^"\\]|\\.)*)"$/s.exec(token ?? '');
  return match?.[1] === undefined ? null : match[1].replace(/\\(["\\])/g, '$1');
}

/** The path strace -yy decoded for an fd argument such as `AT_FDCWD</cwd>` or `7</dir>`. */
function fdPath(token: string | undefined): string | null {
  const match = /^[A-Za-z_0-9]+<(.*)>$/s.exec(token ?? '');
  return match?.[1] === undefined
    ? null
    : match[1].replace(/ \(deleted\)$/, '');
}

/**
 * Absolute path for one path slot; null when it cannot be resolved (unexpected,
 * fail closed); undefined when it names an already-open non-file object.
 */
function resolveSlot(
  dirfd: string | undefined,
  path: string | null,
  relativeBase: boolean,
  cwd: string | null,
): string | null | undefined {
  if (path === null) return null;
  if (PROC_MAGIC_PARENT.test(path.replace(/\/{2,}/g, '/'))) return null;
  if (path.startsWith('/')) return normalPath(path);
  // A plain (non-*at) call resolves against the process cwd, known only from
  // an earlier chdir or AT_FDCWD<cwd> of the same pid; otherwise fail closed.
  if (!relativeBase)
    return cwd !== null && path !== ''
      ? normalPath(posix.join(cwd, path))
      : null;
  const base = fdPath(dirfd);
  if (base === null) return null;
  if (!base.startsWith('/')) return path === '' ? undefined : null;
  return normalPath(path === '' ? base : posix.join(base, path));
}

function resolvedPaths(
  operation: string,
  args: string,
  cwd: string | null,
): readonly (string | null | undefined)[] | undefined {
  const slots = FILE_PATH_SLOTS[operation];
  if (!slots) return undefined;
  const tokens = splitArgs(args);
  let index = 0;
  return slots.flatMap((slot) => {
    if (slot === 's') {
      index++;
      return [];
    }
    if (slot === 'p')
      return [resolveSlot(undefined, quotedPath(tokens[index++]), false, cwd)];
    const dirfd = tokens[index++];
    return [resolveSlot(dirfd, quotedPath(tokens[index++]), true, cwd)];
  });
}

interface ClassifyContext {
  readonly allowed: AllowedAccess;
  readonly pid: number | null;
  readonly pids: ReadonlySet<number>;
  /** The calling pid's working directory when the trace has shown it. */
  readonly cwd: string | null;
  /**
   * The fd table the calling pid works on (see CwdTracker.fdTable); null when
   * the log names no pid.
   */
  readonly fdTable: number | null;
  /**
   * Per datagram socket, whether any destination connect()ed on it so far was
   * not local. Lets an addressless send, whose fd decoration names only the
   * bound local address, be judged by the peer it goes to.
   */
  readonly datagramPeers: DatagramPeers;
}

/** What connect() recorded on one datagram socket. */
interface DatagramPeer {
  /** Any destination connect()ed on it so far was not local. */
  readonly unexpected: boolean;
  /** The address text of the peer that decided `unexpected` (sanitized when logged). */
  readonly address: string;
}

/**
 * Connected datagram peers, keyed by fd table and -yy fd token. An fd number
 * belongs to a fd table, not to a thread: threads made with CLONE_FILES share
 * one, while another process can hold the same number for an unrelated socket
 * (and a closed number is reused). So the key starts with the fd table owner,
 * and an entry is dropped when that owner is handed the same fd number by a
 * new socket()/socketpair()/accept() (close is not traced).
 */
export class DatagramPeers {
  private readonly entries = new Map<string, DatagramPeer>();

  private static key(table: number | null, token: string): string {
    return `${table ?? '?'}\0${token}`;
  }

  get(table: number | null, token: string): DatagramPeer | undefined {
    return this.entries.get(DatagramPeers.key(table, token));
  }

  /** A non-local peer is sticky: a later loopback connect cannot clear it. */
  record(
    table: number | null,
    token: string,
    unexpected: boolean,
    address: string,
  ): void {
    const key = DatagramPeers.key(table, token);
    const known = this.entries.get(key);
    this.entries.set(key, known?.unexpected ? known : { unexpected, address });
  }

  /** The fd number now names a new file description: forget what it was. */
  forgetFd(table: number | null, fd: string): void {
    this.forgetPrefix(DatagramPeers.key(table, `${fd}<`));
  }

  forgetTable(table: number | null): void {
    this.forgetPrefix(DatagramPeers.key(table, ''));
  }

  private forgetPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()])
      if (key.startsWith(prefix)) this.entries.delete(key);
  }
}

const FD_PRODUCING_CALLS = new Set([
  'socket',
  'socketpair',
  'accept',
  'accept4',
]);

/** The fd numbers a successful socket()/socketpair()/accept() call has just handed out. */
function newFds(operation: string, args: string, result: string): string[] {
  if (!FD_PRODUCING_CALLS.has(operation) || result.startsWith('-1')) return [];
  if (operation === 'socketpair')
    return [...args.matchAll(/(?:^|[[\s,])(\d+)</g)].map((m) => m[1] ?? '');
  const fd = /^(\d+)/.exec(result)?.[1];
  return fd === undefined ? [] : [fd];
}

function isWrite(operation: string, args: string): boolean {
  return operation.startsWith('open')
    ? OPEN_WRITE_FLAGS.test(args)
    : !READ_ONLY_CALLS.has(operation);
}

/** Credential stores below a home directory (relative to it). */
const CREDENTIAL_NAMES = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.netrc',
  '.git-credentials',
  '.docker',
  '.kube',
  '.npmrc',
  '.local/share/keyrings',
];
const CREDENTIAL_PATH = new RegExp(
  `^/(?:home/[^/]+|Users/[^/]+|root)/(?:${CREDENTIAL_NAMES.map(escapeRegExp).join('|')})(?:/|$)`,
);

/** Always unexpected, checked before any allowance. */
function isDenied(path: string, write: boolean, context: ClassifyContext) {
  const home = (context.allowed.home ?? homedir()).replace(/\\/g, '/');
  // A disposable profile may itself live below ~/.config; nothing else there may.
  const inDisposable = (container: string): boolean =>
    context.allowed.open.some(
      (root) =>
        normalPath(root) !== normalPath(container) &&
        underRoot(root, [container]) &&
        underRoot(path, [root]),
    );
  if (
    underRoot(path, [
      '/etc/shadow',
      '/etc/shadow-',
      '/etc/gshadow',
      '/etc/gshadow-',
    ])
  )
    return true;
  if (write && underRoot(path, ['/etc/passwd', '/etc/passwd-'])) return true;
  if (
    CREDENTIAL_PATH.test(path) ||
    CREDENTIAL_NAMES.some((name) => underRoot(path, [`${home}/${name}`]))
  )
    return true;
  if (PROC_MAGIC.test(path)) return true;
  for (const container of [`${home}/.config`, '/root'])
    if (underRoot(path, [container]) && !inDisposable(container)) return true;
  const environ = /^\/proc\/(\d+)\/environ$/.exec(path);
  return environ?.[1] !== undefined && Number(environ[1]) !== context.pid;
}

/** The specific /proc/<pid> entries an observed process may touch; see PROC_FILES. */
function isAllowedProc(
  path: string,
  operation: string,
  write: boolean,
  context: ClassifyContext,
): boolean {
  const match =
    /^\/proc\/(self|thread-self|\d+)(?:\/task\/\d+)?(?:\/(.*))?$/.exec(path);
  if (!match) return false;
  const who = match[1] as string;
  if (/^\d+$/.test(who) && !context.pids.has(Number(who))) return false;
  const [entry = '', ...more] = (match[2] ?? '').split('/');
  if (entry === '') return !write && METADATA_CALLS.has(operation);
  if (PROC_FILES.has(entry))
    return more.length === 0 && (!write || PROC_WRITABLE.has(entry));
  if (entry === 'exe')
    return more.length === 0 && METADATA_CALLS.has(operation);
  return !write && PROC_DIRS.has(entry);
}

/**
 * Files directory walkers look for in every ancestor of the folder they search:
 * ripgrep (VS Code search and file discovery) reads the ignore files of all
 * parent directories and checks each one for a repository marker.
 */
const ANCESTOR_IGNORE_FILES = [
  '.gitignore',
  '.ignore',
  '.rgignore',
  '.jj',
  '.git',
  '.git/info/exclude',
];
/** Node module resolution stats `node_modules/[@scope/]name` in every ancestor of the install. */
const NODE_MODULE_PROBE = /^(.*)\/node_modules(?:\/(?:@[^/]+\/)?[^/]+)?$/;
/**
 * Agent-customization folders (user level) that the chat features look for
 * under the home directory. Only metadata calls (stat, statx, lstat, access,
 * readlink) may touch them or anything below them (instructions, agents,
 * skills, mcp-config.json probes). They may hold credentials, so opening,
 * reading, writing or watching anything there stays unexpected, and so does
 * the metadata of a credential-looking name.
 */
const HOME_CUSTOMIZATION_DIRS = [
  '.claude',
  '.copilot',
  '.agents',
  '.vscode/agent-plugins',
  // VS Code CLI metadata (tunnel and server state); the code-server probes
  // stat it on startup. Metadata only: it may hold tokens, so opens stay unexpected.
  '.vscode-cli',
  '.vscode/cli',
];
const CUSTOMIZATION_SECRET_NAME = /cred|secret|token|password|\.key$|\.pem$/i;
/** Home files VS Code reads for its runtime arguments (read-only, no secrets). */
const HOME_RUNTIME_FILES = ['.vscode/argv.json'];

/**
 * Read-only probes of locations around the allowed roots that benign host
 * software walks while it works inside them. Each is a specific name below an
 * ancestor of a root or below the home directory, never a blanket allowance,
 * and the denylist has already been applied by the caller.
 */
function isAllowedProbe(
  path: string,
  operation: string,
  write: boolean,
  context: ClassifyContext,
): boolean {
  if (write) return false;
  const { open, readOnly = [], home: configuredHome } = context.allowed;
  const roots = [...open, ...readOnly];
  const home = normalPath((configuredHome ?? homedir()).replace(/\\/g, '/'));
  if (HOME_RUNTIME_FILES.some((file) => path === `${home}/${file}`))
    return true;
  // A chdir reads nothing; into the home directory itself (the default cwd of
  // host helpers) it only changes where relative paths resolve, and those are
  // classified against it. Any other directory outside the roots stays unexpected.
  if (operation === 'chdir' && path === home) return true;
  const metadata = METADATA_CALLS.has(operation);
  if (metadata) {
    if (
      HOME_CUSTOMIZATION_DIRS.some(
        (dir) =>
          underRoot(path, [`${home}/${dir}`]) &&
          !CUSTOMIZATION_SECRET_NAME.test(basename(path)),
      )
    )
      return true;
    const node = NODE_MODULE_PROBE.exec(path);
    if (node?.[1] !== undefined && isAncestorOf(node[1] || '/', roots))
      return true;
  }
  if (!metadata && !operation.startsWith('open')) return false;
  return ANCESTOR_IGNORE_FILES.some(
    (name) =>
      path.endsWith(`/${name}`) &&
      isAncestorOf(path.slice(0, -name.length - 1) || '/', roots),
  );
}

function isAllowedFile(
  path: string,
  operation: string,
  write: boolean,
  context: ClassifyContext,
): boolean {
  const { open, readOnly = [] } = context.allowed;
  if (underRoot(path, open) || underRoot(path, RUNTIME_WRITABLE)) return true;
  if (underRoot(path, [...readOnly, ...RUNTIME_PATHS])) return !write;
  if (
    METADATA_CALLS.has(operation) &&
    isAncestorOf(path, [...open, ...readOnly])
  )
    return true;
  if (isAllowedProbe(path, operation, write, context)) return true;
  return isAllowedProc(path, operation, write, context);
}

/** A unix socket connects through the file rules: dynamic roots plus X11 and the D-Bus buses. */
function unixSocketUnexpected(
  abstract: boolean,
  path: string,
  context: ClassifyContext,
): boolean {
  // Abstract sockets have no file; an unnamed one carries no address.
  if (abstract || path === '') return false;
  if (!path.startsWith('/')) return true;
  const normal = normalPath(path);
  if (isDenied(normal, true, context)) return true;
  return !(
    underRoot(normal, [...context.allowed.open, ...UNIX_SOCKET_ROOTS]) ||
    USER_BUS.test(normal)
  );
}

function classifyUnexpected(
  channel: NativeChannel,
  operation: string,
  args: string,
  context: ClassifyContext | undefined,
): boolean | undefined {
  if (!context) return undefined;
  // Unlisted %file syscalls are never ignored (fd-based ones were classified at open).
  if (OTHER_FILE_CALLS.has(operation) && !(operation in FILE_PATH_SLOTS))
    return true;
  if (channel === 'file' || channel === 'exec') {
    const paths = resolvedPaths(operation, args, context.cwd);
    if (!paths) return undefined;
    if (paths.some((path) => path === null)) return true;
    const write = isWrite(operation, args);
    return paths.some((path) => {
      if (path === undefined || path === null) return false;
      if (isDenied(path, write, context)) return true;
      return channel === 'exec'
        ? !(path === '/proc/self/exe' || underRoot(path, context.allowed.exec))
        : !isAllowedFile(path, operation, write, context);
    });
  }
  if (channel !== 'network') return undefined;
  // Receiving and socket queries put nothing on the wire; any address they show
  // is the sender's or the local one (strace -yy decodes it), not a destination.
  if (RECEIVE_CALLS.has(operation) || SOCKET_STATE_CALLS.has(operation))
    return false;
  // connect() on a datagram socket only records the default peer in the kernel
  // (Chromium uses it to discover its local route); a later send is classified
  // on its own by the peer.
  if (operation === 'connect' && isDatagramSocket(args)) {
    const token = datagramToken(args);
    const peer = destinationUnexpected(args, context);
    if (token !== undefined && peer !== undefined)
      context.datagramPeers.record(
        context.fdTable,
        token,
        peer,
        networkTarget(args),
      );
    return false;
  }
  const destination = destinationUnexpected(args, context);
  if (destination !== undefined) return destination;
  const connected = connectedPeerUnexpected(args, context);
  if (connected !== undefined) return connected;
  // An outgoing attempt without a proven destination cannot certify an empty violation set.
  // Known limitation: write/writev on a socket fd are not in %network, so a
  // plain write() to a connected socket is never traced (not added on purpose:
  // %file/%desc tracing of every write would flood the trace).
  return ['connect', 'sendto', 'sendmsg', 'sendmmsg'].includes(operation)
    ? true
    : undefined;
}

/** The address a call names (inet, inet6 or unix), classified; undefined when it names none. */
function destinationUnexpected(
  args: string,
  context: ClassifyContext,
): boolean | undefined {
  const ipv4 = /inet_addr\("([^"]+)"\)/.exec(args)?.[1];
  if (ipv4) return !ipv4.startsWith('127.');
  const ipv6 = /inet_pton\(AF_INET6, "([^"]+)"/.exec(args)?.[1];
  if (ipv6) return !/^(?:::1$|::ffff:127\.)/i.test(ipv6);
  const unix = UNIX_SOCKET.exec(args);
  if (unix)
    return unixSocketUnexpected(unix[1] === '@', unix[2] ?? '', context);
  return args.includes('sun_path=') ? true : undefined;
}

/** The fd token strace -yy prints for a datagram socket, such as `23<UDP:[0.0.0.0:36948]>`. */
function datagramToken(args: string): string | undefined {
  return /^\d+<UDP(?:v6)?:\[[^\]>]*\]>/.exec(args)?.[0];
}

/** -yy decorates the socket fd with its peer: `3<UNIX-STREAM:[1->2,"/run/user/1000/bus"]>`. */
const SOCKET_FD = /^\d+<([A-Za-z0-9]+)(?:-[A-Z]+)?:\[(.*?)\]>/;

/** The fd is a UDP socket as strace -yy decorates it, such as `5<UDPv6:[123]>`. */
function isDatagramSocket(args: string): boolean {
  const family = SOCKET_FD.exec(args)?.[1];
  return family !== undefined && /^UDP(?:v6)?$/.test(family);
}

/**
 * Addressless sends on a connected socket reach the peer recorded on the fd.
 * Unix peers are local (named ones go through the unix socket rules), netlink
 * talks to the kernel, and inet peers must be loopback. -yy names only the
 * sender's own bound path, so the observed connect() is what enforces a unix
 * destination; a send on a socket connected before tracing escapes that rule.
 */
function connectedPeerUnexpected(
  args: string,
  context: ClassifyContext,
): boolean | undefined {
  const fd = SOCKET_FD.exec(args);
  if (!fd) return undefined;
  const [, family = '', detail = ''] = fd;
  if (family === 'NETLINK') return false;
  if (family === 'UNIX') {
    const path = /,"(@?)([^"]*)"$/.exec(detail);
    if (path)
      return unixSocketUnexpected(path[1] === '@', path[2] ?? '', context);
    // A name that did not parse (such as one holding `]` or `"`) fails closed.
    return detail.includes(',"') || !detail.includes('->');
  }
  if (!/^(?:TCP|UDP)(?:v6)?$/.test(family)) return undefined;
  const peer = detail.split('->')[1];
  if (peer === undefined) {
    // A datagram socket bound and then connect()ed is decorated with its local
    // address only (Chromium's DNS client): the observed connect() names the peer.
    const token = datagramToken(args);
    return token === undefined
      ? undefined
      : context.datagramPeers.get(context.fdTable, token)?.unexpected;
  }
  return !/^(?:127\.|\[::1\]:|\[::ffff:127\.)/i.test(peer);
}

/**
 * A canary file name that survives sanitization: a name with a 48+ character
 * token (such as one holding a uuid) is redacted from event targets, which would
 * make a "canary was touched" check vacuous.
 */
export function newCanaryName(): string {
  return `rdlc-canary-${randomBytes(4).toString('hex')}.dat`;
}

export function unexpectedEvents(
  events: readonly SecurityEvent[],
): SecurityEvent[] {
  return events.filter((event) => event.unexpected === true);
}

export interface ParsedStrace {
  readonly events: readonly SecurityEvent[];
  readonly truncated: boolean;
}

interface CwdRecord {
  dir: string | undefined;
}

/** A thread's working directory read from /proc, and the process it belongs to. */
export interface InitialCwd {
  readonly dir: string;
  readonly process: number;
}

interface CloneEntry {
  readonly parent: number;
  /** CLONE_FS or CLONE_THREAD: the child and its parent share one cwd. */
  readonly shares: boolean;
  /** The flags could not be read: whether the cwd is shared or copied is unknown. */
  readonly unknown: boolean;
  /** CLONE_FILES: the child works on its parent's fd table. */
  readonly files: boolean;
  created: boolean;
}

/** The comma-free `flags=A|B` list of a clone/clone3 call. */
function cloneFlags(args: string): string | undefined {
  return /flags=([A-Za-z0-9_|]+)/.exec(args)?.[1];
}

function sharesFiles(flags: string | undefined): boolean {
  return flags?.split('|').includes('CLONE_FILES') === true;
}

function sharesCwd(flags: string | undefined): boolean {
  return (
    flags !== undefined &&
    flags
      .split('|')
      .some((flag) => flag === 'CLONE_FS' || flag === 'CLONE_THREAD')
  );
}

/**
 * Keeps the cwd that plain (non-*at) calls resolve against, per thread id.
 * strace -yy prints the calling thread's cwd as `AT_FDCWD</dir>` (the truth at
 * that moment); a successful chdir sets it; anything not provable (an
 * unfinished chdir) forgets it so that relative paths fail closed. A child made
 * with CLONE_FS or CLONE_THREAD shares its parent's mutable record, any other
 * child copies it. A child's lines can precede the parent's `clone resumed`
 * line, so a pre-scan of the whole log finds each child's parent and the
 * record is created when the child is first seen (the parent is blocked inside
 * clone until then), or at the clone result, whichever comes first.
 */
class CwdTracker {
  private readonly records = new Map<number, CwdRecord>();
  private readonly pending = new Map<number, CloneEntry[]>();
  private readonly byLine = new Map<number, CloneEntry>();
  /** Thread (or process) that shares the fd table of each child made with CLONE_FILES. */
  private readonly fdParents = new Map<number, number>();
  private readonly initialProcess = new Map<number, number>();

  constructor(
    lines: readonly (StraceLine | null)[],
    initial: ReadonlyMap<number, InitialCwd> = new Map(),
  ) {
    // Threads of one process with the same directory share one record, so a
    // later chdir by any of them is seen by all (they share an fs_struct).
    const shared = new Map<string, CwdRecord>();
    for (const [tid, { dir, process }] of initial) {
      this.initialProcess.set(tid, process);
      if (!dir.startsWith('/')) continue;
      const key = `${process}\0${dir}`;
      const record = shared.get(key) ?? { dir: normalPath(dir) };
      shared.set(key, record);
      this.records.set(tid, record);
    }
    const flags = new Map<number, string | undefined>();
    lines.forEach((line, index) => {
      if (
        !line ||
        line.pid === null ||
        !PROCESS_SPAWN_CALLS.has(line.operation)
      )
        return;
      if (line.unfinished) {
        flags.set(line.pid, cloneFlags(line.args));
        return;
      }
      const own = line.resumed ? flags.get(line.pid) : cloneFlags(line.args);
      flags.delete(line.pid);
      const child = /^(\d+)/.exec(line.result)?.[1];
      if (child === undefined) return;
      const entry: CloneEntry = {
        parent: line.pid,
        shares: sharesCwd(own),
        // fork and vfork take no flags: always a copy.
        unknown:
          own === undefined &&
          line.operation !== 'fork' &&
          line.operation !== 'vfork',
        files: sharesFiles(own),
        created: false,
      };
      this.byLine.set(index, entry);
      if (entry.files) this.fdParents.set(Number(child), line.pid);
      const queue = this.pending.get(Number(child)) ?? [];
      queue.push(entry);
      this.pending.set(Number(child), queue);
    });
  }

  private recordFor(pid: number): CwdRecord {
    let record = this.records.get(pid);
    if (!record) {
      record = { dir: undefined };
      this.records.set(pid, record);
    }
    return record;
  }

  private materialize(entry: CloneEntry, child: number): void {
    entry.created = true;
    const parent = this.lookup(entry.parent) ?? this.recordFor(entry.parent);
    // Unreadable flags fail closed: the child's cwd is unknown, never copied.
    this.records.set(
      child,
      entry.shares ? parent : { dir: entry.unknown ? undefined : parent.dir },
    );
  }

  private lookup(pid: number): CwdRecord | undefined {
    const known = this.records.get(pid);
    if (known) return known;
    const entry = this.pending.get(pid)?.find((item) => !item.created);
    if (!entry) return undefined;
    this.materialize(entry, pid);
    return this.records.get(pid);
  }

  /**
   * Identifies the fd table a thread works on: threads sharing it (CLONE_FILES,
   * which is what pthreads use) map to the same id, the pid of the group's
   * first known member, as do threads that were already running at attach and
   * belong to one process. Another process, even a forked copy, gets its own
   * table, so state kept per fd is never carried across unrelated tables.
   */
  fdTable(pid: number | null): number | null {
    if (pid === null) return null;
    let current = pid;
    for (let hops = 0; hops < 64; hops++) {
      const parent = this.fdParents.get(current);
      if (parent === undefined) break;
      current = parent;
    }
    return this.initialProcess.get(current) ?? current;
  }

  /** The thread's cwd, or null when it is not provable. */
  cwd(pid: number | null): string | null {
    return pid === null ? null : (this.lookup(pid)?.dir ?? null);
  }

  observe(line: StraceLine): void {
    if (line.pid === null || !line.args.startsWith('AT_FDCWD<')) return;
    const dir = fdPath(splitArgs(line.args)[0]);
    if (dir?.startsWith('/'))
      (this.lookup(line.pid) ?? this.recordFor(line.pid)).dir = normalPath(dir);
  }

  follow(line: StraceLine, index: number): void {
    const { pid } = line;
    if (pid === null) return;
    if (line.operation === 'exit' || line.operation === 'exit_group') {
      this.records.delete(pid);
      return;
    }
    if (line.operation === 'chdir' && !line.resumed) {
      const record = this.lookup(pid) ?? this.recordFor(pid);
      const target = quotedPath(splitArgs(line.args)[0]);
      const base = record.dir;
      if (line.unfinished || line.result.startsWith('-1')) {
        if (line.unfinished) record.dir = undefined;
      } else if (target?.startsWith('/')) record.dir = normalPath(target);
      else if (target && base !== undefined)
        record.dir = normalPath(posix.join(base, target));
      else record.dir = undefined;
      return;
    }
    const entry = this.byLine.get(index);
    const child = /^(\d+)/.exec(line.result)?.[1];
    if (!entry || child === undefined || entry.created) return;
    this.materialize(entry, Number(child));
  }
}

export function parseStraceLog(
  text: string,
  options: {
    readonly maxEvents?: number;
    readonly redactions?: readonly string[];
    readonly allowed?: AllowedAccess;
    /** Pids known to belong to the observed tree; every pid in the log is added. */
    readonly pids?: readonly number[];
    /**
     * Working directories (absolute) of threads already running when tracing
     * began, read from /proc at attach; any other thread starts unknown.
     */
    readonly cwds?: ReadonlyMap<number, InitialCwd>;
  } = {},
): ParsedStrace {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const redactions = options.redactions ?? [];
  const events: SecurityEvent[] = [];
  let truncated = false;
  const lines = text.split(/\r?\n/);
  const pids = new Set(options.pids ?? []);
  for (const line of lines) {
    const pid = /^\s*(\d+)\s/.exec(line)?.[1];
    if (pid) pids.add(Number(pid));
  }
  const parsedLines = lines.map(parseStraceLine);
  const cwds = new CwdTracker(parsedLines, options.cwds);
  const datagramPeers = new DatagramPeers();
  /** Index of the event made from each pid's unfinished call, until its resumed half. */
  const interrupted = new Map<string, number>();
  for (const [index, parsed] of parsedLines.entries()) {
    if (!parsed) continue;
    // The unfinished half is the one classified event of an interrupted call;
    // its resumed tail adds the result to that event (no second event) and
    // completes the cwd bookkeeping (clone results).
    if (parsed.resumed) {
      const key = `${parsed.pid ?? ''}:${parsed.operation}`;
      const at = interrupted.get(key);
      const half = at === undefined ? undefined : events[at];
      if (at !== undefined && half) {
        interrupted.delete(key);
        // Same outcome rule as an uninterrupted line (a non-blocking connect is
        // `-1 EINPROGRESS`, which the positive controls count as failed).
        const failed = parsed.result.startsWith('-1');
        const attempted = parsed.result.startsWith('?');
        events[at] = {
          ...half,
          outcome: failed ? 'failed' : attempted ? 'attempted' : 'succeeded',
          error: failed
            ? sanitizeTarget(
                /^-1\s+([A-Z0-9_]+)/.exec(parsed.result)?.[1] ?? 'failed',
                redactions,
              )
            : null,
        };
      }
      for (const fd of newFds(parsed.operation, parsed.args, parsed.result))
        datagramPeers.forgetFd(cwds.fdTable(parsed.pid), fd);
      cwds.follow(parsed, index);
      continue;
    }
    if (events.length >= maxEvents) {
      truncated = true;
      break;
    }
    const channel = channelFor(parsed.operation);
    if (!channel) continue;
    const failed = parsed.result.startsWith('-1');
    const attempted = parsed.unfinished || parsed.result.startsWith('?');
    cwds.observe(parsed);
    const fdTable = cwds.fdTable(parsed.pid);
    const token =
      channel === 'network' ? datagramToken(parsed.args) : undefined;
    const remembered =
      token === undefined ? undefined : datagramPeers.get(fdTable, token);
    const unexpected = classifyUnexpected(
      channel,
      parsed.operation,
      parsed.args,
      options.allowed
        ? {
            allowed: options.allowed,
            pid: parsed.pid,
            pids,
            cwd: cwds.cwd(parsed.pid),
            fdTable,
            datagramPeers,
          }
        : undefined,
    );
    for (const fd of newFds(parsed.operation, parsed.args, parsed.result))
      datagramPeers.forgetFd(fdTable, fd);
    if (parsed.operation === 'exit_group') datagramPeers.forgetTable(fdTable);
    cwds.follow(parsed, index);
    if (parsed.unfinished && parsed.pid !== null)
      interrupted.set(`${parsed.pid}:${parsed.operation}`, events.length);
    events.push({
      atMs: parsed.atMs,
      source: 'host-process-tree',
      channel,
      operation: parsed.operation,
      outcome: failed ? 'failed' : attempted ? 'attempted' : 'succeeded',
      pid: parsed.pid,
      target: eventTarget(channel, parsed.args, redactions, remembered),
      error: failed
        ? sanitizeTarget(
            /^-1\s+([A-Z0-9_]+)/.exec(parsed.result)?.[1] ?? 'failed',
            redactions,
          )
        : null,
      ...(unexpected === undefined ? {} : { unexpected }),
    });
  }
  return { events, truncated };
}

function controlsFromEvents(
  events: readonly SecurityEvent[],
): NativeCaptureControls {
  return {
    network: events.some(
      (event) =>
        event.channel === 'network' &&
        ['connect', 'sendto', 'sendmsg', 'sendmmsg', 'socket'].includes(
          event.operation,
        ),
    ),
    file: events.some(
      (event) => event.channel === 'file' && event.outcome === 'failed',
    ),
    exec: events.some(
      (event) => event.channel === 'exec' && event.outcome === 'failed',
    ),
    process: events.some((event) => event.channel === 'process'),
    // The control tree execs /bin/true, so this proves a followed descendant.
    shortLived: events.some(
      (event) => event.channel === 'exec' && event.target === 'true',
    ),
  };
}

function controlsPassed(controls: NativeCaptureControls): boolean {
  return Object.values(controls).every(Boolean);
}

function missingControls(controls: NativeCaptureControls): string[] {
  return (Object.keys(controls) as (keyof NativeCaptureControls)[]).filter(
    (key) => !controls[key],
  );
}

function readTrace(
  tracePath: string,
  maxBytes: number,
): { text: string; truncated: boolean; present: boolean } {
  try {
    const size = statSync(tracePath).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = openSync(tracePath, 'r');
    try {
      readSync(fd, buffer, 0, length, 0);
    } finally {
      closeSync(fd);
    }
    return {
      text: buffer.toString('utf8'),
      truncated: size > maxBytes,
      present: true,
    };
  } catch {
    return { text: '', truncated: false, present: false };
  }
}

interface ProbeResult {
  readonly text: string;
  readonly stderr: string;
}

function probeTrace(
  directory: string,
  args: readonly string[],
  timeoutMs: number,
): ProbeResult | null {
  const tracePath = join(directory, `trace-${randomUUID()}.log`);
  try {
    const stderr = execFileSync(
      'strace',
      [...STRACE_ARGS, '-o', tracePath, ...args],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    return { text: readFileSync(tracePath, 'utf8'), stderr };
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    try {
      return {
        text: readFileSync(tracePath, 'utf8'),
        stderr,
      };
    } catch {
      return { text: '', stderr };
    }
  }
}

function probeLaunch(directory: string): NativeCaptureCapability {
  const probe = probeTrace(
    directory,
    ['--', process.execPath, '-e', LAUNCH_CONTROL],
    20_000,
  );
  const parsed = parseStraceLog(probe?.text ?? '', {
    redactions: [directory, homedir()],
  });
  const controls = controlsFromEvents(parsed.events);
  if (controlsPassed(controls) && !parsed.truncated)
    return {
      supported: true,
      reason:
        'strace -f launched a positive-control tree and captured network, file, exec, process and short-lived attempts.',
      controls,
    };
  const missing = missingControls(controls);
  return {
    supported: false,
    reason: sanitizeTarget(
      `strace -f launch capture missed: ${
        missing.join(', ') || 'no events'
      }. ${probe?.stderr ?? ''}`,
      [directory, homedir()],
    ),
    controls,
  };
}

function probeAttach(directory: string): NativeCaptureCapability {
  const child = spawn(process.execPath, ['-e', ATTACH_CONTROL], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) {
    return {
      supported: false,
      reason: 'Could not spawn the attach positive-control process.',
      controls: {
        network: false,
        file: false,
        exec: false,
        process: false,
        shortLived: false,
      },
    };
  }
  try {
    const probe = probeTrace(directory, ['-p', String(child.pid)], 10_000);
    const parsed = parseStraceLog(probe?.text ?? '', {
      redactions: [directory, homedir()],
    });
    const controls = controlsFromEvents(parsed.events);
    const denied = /(?:Could not attach|Operation not permitted|EPERM)/i.test(
      probe?.stderr ?? '',
    );
    if (controlsPassed(controls) && !denied && !parsed.truncated)
      return {
        supported: true,
        reason:
          'strace -f attached to a live process and captured network, file, exec, process and short-lived attempts.',
        controls,
      };
    const missing = missingControls(controls);
    return {
      supported: false,
      reason: sanitizeTarget(
        `strace -f attach capture failed: ${
          denied ? 'attach denied by the platform' : 'missing events'
        } (${missing.join(', ') || 'none'}). ${probe?.stderr ?? ''}`,
        [directory, homedir()],
      ),
      controls,
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

/**
 * Windows host-tree capture needs an elevated ETW kernel session plus a
 * bounded ETL consumer; neither is implemented, so win32 stays unsupported.
 */
export const WINDOWS_CAPTURE_REQUIREMENT =
  'Windows host-tree capture needs an elevated ETW kernel session (logman/wpr/xperf, "Windows Kernel Trace") recording file, process and network attempts, plus a bounded ETL consumer parsing them into events; no elevated capture path and no ETL consumer are implemented. Browser routing is not host observation.';

/**
 * Windows host blocking needs an administrator-elevated WFP rule plus a
 * positive control proving it matched; neither is implemented.
 */
export const WINDOWS_BLOCKING_REQUIREMENT =
  'Windows host outbound blocking needs an administrator-elevated Windows Filtering Platform rule (netsh advfirewall or FirewallAPI) plus a positive control proving the rule matched (for example a per-rule packet counter); no elevated rule mechanism and no positive control are implemented. Browser routing is not host blocking.';

/**
 * Prove what the platform can actually do. A missing strace, denied attach, or
 * a probe that misses failed attempts is reported, never upgraded to a pass.
 */
export function detectNativeCapability(
  platform: NodeJS.Platform = osPlatform(),
): NativeCapability {
  const empty: NativeCaptureControls = {
    network: false,
    file: false,
    exec: false,
    process: false,
    shortLived: false,
  };
  const unsupported = (reason: string): NativeCaptureCapability => ({
    supported: false,
    reason,
    controls: empty,
  });

  if (platform === 'win32')
    return {
      platform,
      tool: null,
      version: null,
      launch: unsupported(WINDOWS_CAPTURE_REQUIREMENT),
      attach: unsupported(WINDOWS_CAPTURE_REQUIREMENT),
    };

  if (platform !== 'linux')
    return {
      platform,
      tool: null,
      version: null,
      launch: unsupported(
        `No unprivileged native host process-tree observer is implemented for ${platform}; browser routing is not host observation.`,
      ),
      attach: unsupported(
        `No unprivileged native host process-tree observer is implemented for ${platform}; browser routing is not host observation.`,
      ),
    };

  let version: string | null = null;
  try {
    version =
      execFileSync('strace', ['-V'], {
        encoding: 'utf8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
        .split(/\r?\n/)[0]
        ?.trim() ?? null;
  } catch (error) {
    const reason = `strace is unavailable on Linux: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return {
      platform,
      tool: null,
      version: null,
      launch: unsupported(reason),
      attach: unsupported(reason),
    };
  }

  const directory = join(
    tmpdir(),
    `rdlc-security-probe-${process.pid}-${randomUUID()}`,
  );
  mkdirSync(directory, { recursive: true });
  try {
    return {
      platform,
      tool: 'strace',
      version,
      launch: probeLaunch(directory),
      attach: probeAttach(directory),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function detectSecurityCapability(
  platform: NodeJS.Platform = osPlatform(),
): SecurityCapability {
  return {
    platform,
    native: detectNativeCapability(platform),
    webview: {
      supported: true,
      scope:
        'Playwright BrowserContext request/requestfailed events for renderer and webview network attempts. File, process, exec, query and resource access inside a webview is not observable.',
      reason:
        'Browser-context network observation is available but is only a network channel; it never substitutes for host process-tree capture.',
    },
    semantic: {
      resource: 'not-observable',
      query: 'not-observable',
      entity: 'not-observable',
    },
    limitations: [
      'Host capture is syscall-level: it records attempted/failed network, file, exec and process operations, including short-lived descendants when strace follows them.',
      'Attach mode starts after the target is already running; attempts before attach are outside coverage. Full lifecycle capture requires the launch mode.',
      SEMANTIC_PROOF_LIMITATION,
      'Generic file/network syscalls are not attributed to report workflows; callers must correlate events and exclude identified host background traffic.',
      'Webview capture covers network attempts only; it cannot prove local execution, file, query or resource access inside webview or extension-host processes.',
    ],
  };
}

interface Session {
  readonly mode: 'launch' | 'attach';
  readonly directory: string;
  readonly tracePath: string;
  readonly child: ChildProcess;
  readonly startedAtMs: number;
  readonly maxEvents: number;
  readonly maxTraceBytes: number;
  readonly redactions: readonly string[];
  readonly allowed: AllowedAccess | undefined;
  readonly requestedPids: readonly number[];
  readonly attachedPids: readonly number[];
  readonly attachFailures: readonly string[];
  /** Thread working directories read from /proc before attaching. */
  readonly initialCwds: ReadonlyMap<number, InitialCwd>;
  readonly stderr: () => string;
  timedOut: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

function collectStderr(child: ChildProcess): () => string {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    if (stderr.length < 32_768) stderr += chunk.toString();
  });
  return () => stderr;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = (exited: boolean) => {
      if (settled) return;
      settled = true;
      resolve(exited);
    };
    child.once('exit', () => done(true));
    const timer = setTimeout(() => done(false), timeoutMs);
    timer.unref();
  });
}

async function finishSession(session: Session): Promise<NativeObservation> {
  if (session.stopTimer) {
    clearTimeout(session.stopTimer);
    session.stopTimer = null;
  }
  if (session.child.exitCode === null && session.child.signalCode === null) {
    session.child.kill('SIGINT');
    if (!(await waitForExit(session.child, STOP_TIMEOUT))) {
      session.child.kill('SIGKILL');
      await waitForExit(session.child, 2_000);
    }
  }
  const trace = readTrace(session.tracePath, session.maxTraceBytes);
  const parsed = parseStraceLog(trace.text, {
    maxEvents: session.maxEvents,
    redactions: session.redactions,
    pids: session.requestedPids,
    cwds: session.initialCwds,
    ...(session.allowed ? { allowed: session.allowed } : {}),
  });
  const failures = [...session.attachFailures];
  if (!trace.present)
    failures.push('strace did not produce a trace file for this observation.');
  // Routine attach/detach notices are expected. Anything else is a capture fault.
  const stderr = session
    .stderr()
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() &&
        !/^strace: Process \d+ (?:attached|detached)$/.test(line.trim()),
    )
    .join(' ');
  if (stderr)
    failures.push(sanitizeTarget(stderr.slice(-4_000), session.redactions));
  const truncated = trace.truncated || parsed.truncated;
  if (truncated)
    failures.push(
      `Trace exceeded the bounded capture limit (${session.maxTraceBytes} bytes / ${session.maxEvents} events).`,
    );
  const state: CoverageState =
    session.mode === 'attach' && session.attachFailures.length > 0
      ? 'partial'
      : failures.length > 0
        ? 'partial'
        : 'observed';
  rmSync(session.directory, { recursive: true, force: true });
  return {
    mode: session.mode,
    state,
    reason: failures.length ? failures.join(' ') : null,
    requestedPids: session.requestedPids,
    attachedPids: session.attachedPids,
    attachFailures: session.attachFailures,
    truncated,
    timedOut: session.timedOut,
    events: parsed.events,
  };
}

function createSession(
  mode: 'launch' | 'attach',
  child: ChildProcess,
  options: {
    directory: string;
    tracePath: string;
    requestedPids: readonly number[];
    attachedPids: readonly number[];
    attachFailures: readonly string[];
    initialCwds?: ReadonlyMap<number, InitialCwd>;
    redactions: readonly string[];
    allowed?: AllowedAccess | undefined;
    maxDurationMs: number;
    maxEvents: number;
    maxTraceBytes: number;
  },
): { session: Session; stop: () => Promise<NativeObservation> } {
  const session: Session = {
    mode,
    directory: options.directory,
    tracePath: options.tracePath,
    child,
    startedAtMs: Date.now(),
    maxEvents: options.maxEvents,
    maxTraceBytes: options.maxTraceBytes,
    redactions: options.redactions,
    allowed: options.allowed,
    requestedPids: options.requestedPids,
    attachedPids: options.attachedPids,
    attachFailures: options.attachFailures,
    initialCwds: options.initialCwds ?? new Map(),
    stderr: collectStderr(child),
    timedOut: false,
    stopTimer: null,
  };
  let closing: Promise<NativeObservation> | undefined;
  const stop = (): Promise<NativeObservation> => {
    if (!closing) closing = finishSession(session);
    return closing;
  };
  session.stopTimer = setTimeout(() => {
    session.timedOut = true;
    void stop();
  }, options.maxDurationMs);
  session.stopTimer.unref();
  return { session, stop };
}

function normalizeOptions(options: NativeObserverOptions): {
  maxDurationMs: number;
  maxEvents: number;
  maxTraceBytes: number;
  redactions: readonly string[];
} {
  return {
    maxDurationMs: options.maxDurationMs ?? DEFAULT_MAX_DURATION,
    maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
    maxTraceBytes: options.maxTraceBytes ?? DEFAULT_MAX_TRACE_BYTES,
    redactions: options.redactions ?? [],
  };
}

function traceDirectory(): { directory: string; tracePath: string } {
  const directory = join(
    tmpdir(),
    `rdlc-security-${process.pid}-${randomUUID()}`,
  );
  mkdirSync(directory, { recursive: true });
  return { directory, tracePath: join(directory, 'strace.log') };
}

/**
 * Run a command under `strace -f` from its first instruction. This is the only
 * mode that covers the complete lifecycle, including short-lived descendants.
 */
export async function startTracedCommand(
  options: TracedCommandOptions,
  capability: NativeCapability = detectNativeCapability(),
): Promise<TracedCommand> {
  if (!capability.launch.supported)
    throw new SecurityObserverUnsupportedError(
      `Native launch capture is unsupported: ${capability.launch.reason}`,
    );
  const bounds = normalizeOptions(options);
  const { directory, tracePath } = traceDirectory();
  const child = spawn(
    'strace',
    [
      ...STRACE_ARGS,
      '-o',
      tracePath,
      '--',
      options.command,
      ...(options.args ?? []),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw new SecurityObserverUnsupportedError(
      `Could not start strace launch capture: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { stop } = createSession('launch', child, {
    directory,
    tracePath,
    requestedPids: [],
    attachedPids: [],
    attachFailures: [],
    redactions: [...bounds.redactions, homedir()],
    maxDurationMs: bounds.maxDurationMs,
    maxEvents: bounds.maxEvents,
    maxTraceBytes: bounds.maxTraceBytes,
  });
  return { child, stop };
}

function processParentMap(): Map<number, number> {
  const parents = new Map<number, number>();
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return parents;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
    } catch {
      continue;
    }
    const close = stat.lastIndexOf(')');
    if (close === -1) continue;
    const fields = stat
      .slice(close + 1)
      .trim()
      .split(/\s+/);
    if (fields[0] === 'Z' || fields[0] === 'X') continue;
    const parent = Number(fields[1]);
    if (Number.isSafeInteger(parent)) parents.set(Number(entry), parent);
  }
  return parents;
}

/** The working directory of every thread of the given processes; unreadable ones are left out (unknown). */
function threadCwds(pids: readonly number[]): Map<number, InitialCwd> {
  const cwds = new Map<number, InitialCwd>();
  for (const pid of pids) {
    let tasks: string[] = [String(pid)];
    try {
      tasks = [...tasks, ...readdirSync(`/proc/${pid}/task`)];
    } catch {
      // The process exited or hides its tasks.
    }
    for (const task of new Set(tasks)) {
      try {
        const dir = readlinkSync(
          task === String(pid)
            ? `/proc/${pid}/cwd`
            : `/proc/${pid}/task/${task}/cwd`,
        ).replace(/ \(deleted\)$/, '');
        if (dir.startsWith('/')) cwds.set(Number(task), { dir, process: pid });
      } catch {
        // Unknown stays unknown: relative paths of this thread fail closed.
      }
    }
  }
  return cwds;
}

function processTree(rootPid: number): number[] {
  const parents = processParentMap();
  if (!parents.has(rootPid))
    throw new SecurityObserverUnsupportedError(
      `Desktop host process ${rootPid} is no longer running.`,
    );
  const children = new Map<number, number[]>();
  for (const [pid, parent] of parents) {
    const list = children.get(parent) ?? [];
    list.push(pid);
    children.set(parent, list);
  }
  const result: number[] = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.shift();
    if (pid === undefined) break;
    if (result.includes(pid)) continue;
    result.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return result;
}

/** Locate the Electron main process for a disposable profile via /proc cmdline. */
export function findDesktopRootPid(profileDir: string): number | null {
  if (osPlatform() !== 'linux') return null;
  const marker = `--user-data-dir=${profileDir}`;
  const matches: number[] = [];
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const commandLine = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (commandLine.split('\0').includes(marker)) matches.push(Number(entry));
    } catch {
      // The process exited while scanning.
    }
  }
  if (matches.length > 1)
    throw new SecurityObserverUnsupportedError(
      `Ambiguous Desktop root processes for profile ${profileDir}: ${matches.join(', ')}`,
    );
  return matches[0] ?? null;
}

/**
 * Attach to an existing host process tree. Coverage starts at attach time and
 * any descendant that cannot be attached makes the result partial.
 */
export async function startAttachedObservation(
  options: AttachedObservationOptions,
  capability: NativeCapability = detectNativeCapability(),
): Promise<ObservationHandle<NativeObservation>> {
  if (!capability.attach.supported)
    throw new SecurityObserverUnsupportedError(
      `Native process-tree attach is unsupported: ${capability.attach.reason}`,
    );
  const bounds = normalizeOptions(options);
  const pids = processTree(options.rootPid);
  // Read before attaching: plain calls such as stat("./") of a process that was
  // already running resolve against a directory the trace never shows.
  const initialCwds = threadCwds(pids);
  const { directory, tracePath } = traceDirectory();
  const child = spawn(
    'strace',
    [
      ...STRACE_ARGS,
      '-o',
      tracePath,
      ...pids.flatMap((pid) => ['-p', String(pid)]),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw new SecurityObserverUnsupportedError(
      `Could not start strace attach capture: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const getStderr = collectStderr(child);
  const attached = new Set<number>();
  const failures: string[] = [];
  const deadline = Date.now() + ATTACH_TIMEOUT;
  while (
    Date.now() < deadline &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    const stderr = getStderr();
    for (const match of stderr.matchAll(/Process (\d+) attached/g))
      attached.add(Number(match[1]));
    for (const match of stderr.matchAll(
      /Could not attach to process (\d+)[:]?\s*([^\n]*)/g,
    )) {
      const pid = Number(match[1]);
      if (!failures.some((failure) => failure.startsWith(`pid ${pid}:`)))
        failures.push(
          `pid ${pid}: ${sanitizeTarget(match[2] ?? 'attach failed', bounds.redactions)}`,
        );
    }
    if (attached.size + failures.length >= pids.length) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100);
      timer.unref();
    });
  }
  const stderr = getStderr();
  for (const pid of pids) {
    if (attached.has(pid)) continue;
    if (failures.some((failure) => failure.startsWith(`pid ${pid}:`))) continue;
    failures.push(`pid ${pid}: attach not confirmed`);
  }
  if (!attached.has(options.rootPid)) {
    await waitForExit(child, STOP_TIMEOUT);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    rmSync(directory, { recursive: true, force: true });
    throw new SecurityObserverUnsupportedError(
      sanitizeTarget(
        `Could not attach to the Desktop host root ${options.rootPid}: ${
          failures.find((failure) =>
            failure.startsWith(`pid ${options.rootPid}:`),
          ) ?? stderr
        }`,
        bounds.redactions,
      ),
    );
  }
  const { stop } = createSession('attach', child, {
    directory,
    tracePath,
    requestedPids: pids,
    attachedPids: [...attached],
    attachFailures: failures,
    initialCwds,
    redactions: [...bounds.redactions, homedir()],
    allowed: options.allowed,
    maxDurationMs: bounds.maxDurationMs,
    maxEvents: bounds.maxEvents,
    maxTraceBytes: bounds.maxTraceBytes,
  });
  return { stop };
}

function webviewEvent(
  request: Request,
  outcome: 'attempted' | 'failed',
  error: string | null,
): SecurityEvent {
  return {
    atMs: Date.now(),
    source: 'webview-network',
    channel: 'webview',
    operation: request.method().toLowerCase(),
    outcome,
    pid: null,
    target: sanitizeUrl(request.url()),
    error,
  };
}

export function createSecurityObserver(
  input: SecurityObserverInput,
): SecurityObserver {
  const capability = input.capability ?? detectSecurityCapability();
  const maxEvents = input.maxEvents ?? DEFAULT_MAX_EVENTS;
  const webviewEvents: SecurityEvent[] = [];
  let webviewTruncated = false;
  let attached = false;
  let nativeHandle: ObservationHandle<NativeObservation> | undefined;
  let unsupportedNative: NativeObservation | null = null;
  let startedAt = 0;
  let startedIso = '';
  let stopping: Promise<SecurityObservation> | undefined;

  const onRequest = (request: Request) => {
    if (!sanitizeUrl(request.url()).startsWith('http')) return;
    if (webviewEvents.length >= maxEvents) {
      webviewTruncated = true;
      return;
    }
    webviewEvents.push(webviewEvent(request, 'attempted', null));
  };
  const onRequestFailed = (request: Request) => {
    if (!sanitizeUrl(request.url()).startsWith('http')) return;
    if (webviewEvents.length >= maxEvents) {
      webviewTruncated = true;
      return;
    }
    webviewEvents.push(
      webviewEvent(
        request,
        'failed',
        sanitizeFailure(request.failure()?.errorText ?? null),
      ),
    );
  };

  const start = async (): Promise<void> => {
    if (attached) throw new Error('Security observer is already started.');
    startedAt = Date.now();
    startedIso = new Date(startedAt).toISOString();
    input.context.on('request', onRequest);
    input.context.on('requestfailed', onRequestFailed);
    attached = true;
    if (input.rootPid !== null && capability.native.attach.supported) {
      try {
        nativeHandle = await startAttachedObservation(
          {
            rootPid: input.rootPid,
            ...(input.redactions ? { redactions: input.redactions } : {}),
            ...(input.allowed ? { allowed: input.allowed } : {}),
            ...(input.maxDurationMs !== undefined
              ? { maxDurationMs: input.maxDurationMs }
              : {}),
            ...(input.maxEvents !== undefined
              ? { maxEvents: input.maxEvents }
              : {}),
            ...(input.maxTraceBytes !== undefined
              ? { maxTraceBytes: input.maxTraceBytes }
              : {}),
          },
          capability.native,
        );
      } catch (error) {
        input.context.off('request', onRequest);
        input.context.off('requestfailed', onRequestFailed);
        attached = false;
        throw error;
      }
      return;
    }
    unsupportedNative = {
      mode: 'attach',
      state: 'unsupported',
      reason: !capability.native.attach.supported
        ? capability.native.attach.reason
        : `Desktop host process tree was not located (${
            input.rootPidDetail ?? 'no profile match'
          }).`,
      requestedPids: [],
      attachedPids: [],
      attachFailures: [],
      truncated: false,
      timedOut: false,
      events: [],
    };
  };

  const stop = (): Promise<SecurityObservation> => {
    if (!stopping) {
      stopping = (async () => {
        if (!startedIso)
          throw new Error('Security observer was stopped before it started.');
        input.context.off('request', onRequest);
        input.context.off('requestfailed', onRequestFailed);
        const native = nativeHandle
          ? await nativeHandle.stop()
          : (unsupportedNative ?? {
              mode: 'attach' as const,
              state: 'unsupported' as const,
              reason: 'Native observation was not requested.',
              requestedPids: [],
              attachedPids: [],
              attachFailures: [],
              truncated: false,
              timedOut: false,
              events: [],
            });
        const webview: WebviewObservation = {
          state: webviewTruncated ? 'partial' : 'observed',
          reason: webviewTruncated
            ? 'Webview network events exceeded the bounded capture limit.'
            : null,
          truncated: webviewTruncated,
          events: webviewEvents,
        };
        const events = [...native.events, ...webview.events].sort(
          (left, right) => (left.atMs ?? 0) - (right.atMs ?? 0),
        );
        const failures: string[] = [];
        if (native.state === 'unsupported')
          failures.push(
            `Native host process-tree capture is unsupported: ${native.reason ?? 'no reason recorded'}`,
          );
        else if (native.state === 'partial')
          failures.push(
            `Native host process-tree capture is partial: ${native.reason ?? 'no reason recorded'}`,
          );
        if (native.truncated) failures.push('Native capture was truncated.');
        if (webview.truncated) failures.push('Webview capture was truncated.');
        const stoppedAt = Date.now();
        return {
          startedAt: startedIso,
          stoppedAt: new Date(stoppedAt).toISOString(),
          durationMs: stoppedAt - startedAt,
          capability,
          native,
          webview,
          events,
          captureComplete:
            native.state === 'observed' &&
            webview.state === 'observed' &&
            !native.truncated &&
            !webview.truncated,
          failures,
          limitations: [
            ...capability.limitations,
            'Observation begins only when this observer starts; earlier attempts are outside its coverage.',
            SEMANTIC_PROOF_LIMITATION,
          ],
        };
      })();
    }
    return stopping;
  };

  return { capability, start, stop };
}

/** Fail closed instead of treating partial browser or syscall data as proof. */
export function assertCompleteObservation(
  observation: SecurityObservation,
): void {
  if (observation.captureComplete) return;
  throw new SecurityObserverUnsupportedError(
    `Security observation is incomplete: ${
      observation.failures.join(' ') || 'no failure detail recorded'
    } ${SEMANTIC_PROOF_LIMITATION}`,
  );
}

const BLOCK_COMMENT = 'rdlc-desktop-security';
const BLOCKED_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EACCES',
  'EPERM',
]);

/**
 * Owner-scoped REJECT of every non-loopback packet. Loopback stays open because
 * the driver reaches the Desktop over it. ponytail: scopes the whole runner uid
 * for the observation window, not only the Desktop tree; use a cgroup match if
 * a dedicated user/cgroup is ever provisioned.
 */
export function hostBlockingRules(uid: number): {
  tool: 'iptables' | 'ip6tables';
  add: string[];
  remove: string[];
}[] {
  return (
    [
      ['iptables', '127.0.0.0/8'],
      ['ip6tables', '::1/128'],
    ] as const
  ).map(([tool, loopback]) => {
    const spec = [
      '-m',
      'owner',
      '--uid-owner',
      String(uid),
      '!',
      '-d',
      loopback,
      '-m',
      'comment',
      '--comment',
      BLOCK_COMMENT,
      '-j',
      'REJECT',
    ];
    return {
      tool,
      add: ['-I', 'OUTPUT', '1', ...spec],
      remove: ['-D', 'OUTPUT', ...spec],
    };
  });
}

/**
 * Packets matched by each of our tagged rules in an `iptables -L OUTPUT -v -n -x`
 * listing, one entry per tagged line. They are never summed: a stale rule's
 * counter must not stand in for the fresh rule's.
 */
export function ruleHits(listing: string): number[] {
  return listing
    .split(/\r?\n/)
    .filter((line) => line.includes(BLOCK_COMMENT))
    .map((line) => Number(/^\s*(\d+)/.exec(line)?.[1] ?? 0));
}

/** Delete every rule carrying our tag from each tool's OUTPUT chain; returns how many. */
function sweepTagged(
  tools: readonly ('iptables' | 'ip6tables')[],
  invoke: (tool: string, args: readonly string[]) => string,
): number {
  let removed = 0;
  for (const tool of tools)
    for (const line of invoke(tool, ['-S', 'OUTPUT']).split(/\r?\n/)) {
      if (!line.startsWith('-A OUTPUT ') || !line.includes(BLOCK_COMMENT))
        continue;
      const tokens = (line.match(/"[^"]*"|[^ ]+/g) ?? []).map((token) =>
        token.replace(/^"|"$/g, ''),
      );
      invoke(tool, ['-D', 'OUTPUT', ...tokens.slice(2)]);
      removed++;
    }
  return removed;
}

/**
 * Runner-level cleanup after the test process is gone: removes leftover tagged
 * rules (root, or `sudo -n`). Throws when iptables cannot be reached.
 */
export function sweepHostBlockingRules(
  options: {
    platform?: NodeJS.Platform;
    uid?: number;
    hasIpv6?: boolean;
    run?: HostCommandRunner;
  } = {},
): { removed: number; skipped: string | null } {
  if ((options.platform ?? osPlatform()) !== 'linux')
    return { removed: 0, skipped: 'not linux' };
  const uid = options.uid ?? process.getuid?.();
  const run = options.run ?? defaultRun;
  const invoke = (tool: string, args: readonly string[]): string =>
    uid === 0 ? run(tool, args) : run('sudo', ['-n', tool, ...args]);
  const hasIpv6 = options.hasIpv6 ?? existsSync('/proc/net/if_inet6');
  return {
    removed: sweepTagged(
      hasIpv6 ? ['iptables', 'ip6tables'] : ['iptables'],
      invoke,
    ),
    skipped: null,
  };
}

export type HostCommandRunner = (
  file: string,
  args: readonly string[],
) => string;

export interface HostBlocking {
  readonly mechanism: string;
  /** `unavailable` (with a reason) when no IPv6 connect can reach the OUTPUT chain; never inferred. */
  readonly ipv6: 'blocked' | 'unavailable';
  readonly ipv6Reason: string | null;
  /** Packets our IPv4 rule rejected during the probe (counter delta); proves the rule, not a lack of network. */
  readonly hits: number;
  /** Same for the ip6tables rule; 0 unless `ipv6` is `blocked`. */
  readonly ipv6Hits: number;
  /** Removes the rules; throws and stays retryable until every removal succeeded. */
  release(): void;
}

/** What process-exit cleanup needs from `process`; injectable for tests. */
export interface ProcessHooks {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  exit(code: number): unknown;
}

function defaultRun(file: string, args: readonly string[]): string {
  try {
    return execFileSync(file, [...args], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = String(
      (error as { stderr?: unknown }).stderr ?? (error as Error).message,
    ).trim();
    throw new Error(`${file} ${args.slice(0, 2).join(' ')}: ${stderr}`);
  }
}

function connectProbe(host: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port: 443 });
    const timer = setTimeout(() => done('TIMEOUT'), 4_000);
    const done = (code: string) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(code);
    };
    socket.once('connect', () => done('CONNECTED'));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      done(error.code ?? 'ERROR'),
    );
  });
}

// TEST-NET-3 and the IPv6 documentation prefix: never routable, never loopback.
const defaultProbe = (): Promise<string> => connectProbe('203.0.113.9');
const defaultProbe6 = (): Promise<string> => connectProbe('2001:db8::1');

/** Failures that happen in the kernel before a packet reaches the OUTPUT chain. */
const NO_ROUTE_CODES = new Set([
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'EAFNOSUPPORT',
]);

/**
 * Block non-loopback traffic of the runner uid (so the launched Desktop tree).
 * Call after provisioning/launch. Fails with an explicit reason when the
 * mechanism is unavailable, not effective, or its rule counter never moved.
 */
export async function enableHostBlocking(
  options: {
    platform?: NodeJS.Platform;
    uid?: number;
    hasIpv6?: boolean;
    run?: HostCommandRunner;
    probe?: () => Promise<string>;
    probe6?: () => Promise<string>;
    proc?: ProcessHooks;
  } = {},
): Promise<HostBlocking> {
  const platform = options.platform ?? osPlatform();
  if (platform === 'win32')
    throw new SecurityObserverUnsupportedError(WINDOWS_BLOCKING_REQUIREMENT);
  if (platform !== 'linux')
    throw new SecurityObserverUnsupportedError(
      `Host-level outbound blocking is not implemented for ${platform}; browser routing is not host blocking.`,
    );
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined)
    throw new SecurityObserverUnsupportedError(
      'Host-level outbound blocking is unavailable: the runner uid cannot be determined.',
    );
  const hasIpv6 = options.hasIpv6 ?? existsSync('/proc/net/if_inet6');
  const run = options.run ?? defaultRun;
  const proc: ProcessHooks = options.proc ?? process;
  const invoke = (tool: string, args: readonly string[]): string =>
    uid === 0 ? run(tool, args) : run('sudo', ['-n', tool, ...args]);
  const rules = hostBlockingRules(uid).filter(
    (rule) => hasIpv6 || rule.tool === 'iptables',
  );
  const installed: typeof rules = [];
  let released = false;

  // A killed earlier run can leave tagged rules behind; drop them before ours.
  const sweepStale = (): void => {
    sweepTagged(
      rules.map((rule) => rule.tool),
      invoke,
    );
  };

  const release = (): void => {
    if (released) return;
    const errors: string[] = [];
    for (const rule of [...installed].reverse())
      try {
        invoke(rule.tool, rule.remove);
        installed.splice(installed.indexOf(rule), 1);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    if (errors.length)
      throw new Error(
        `Host blocking rule removal failed: ${errors.join('; ')}`,
      );
    // Only a fully successful removal ends the obligation; failures stay retryable.
    released = true;
    unhook();
  };
  const onExit = (): void => {
    try {
      release();
    } catch {
      // Best effort at process end; the next run's startup sweep removes leftovers.
    }
  };
  const onSignal = (code: number) => (): void => {
    onExit();
    proc.exit(code);
  };
  const handlers: [string, () => void][] = [
    ['exit', onExit],
    ['SIGINT', onSignal(130)],
    ['SIGTERM', onSignal(143)],
    ['SIGHUP', onSignal(129)],
    ['SIGQUIT', onSignal(131)],
  ];
  const unhook = (): void => {
    for (const [event, handler] of handlers) proc.off(event, handler);
  };
  const rollback = (): string => {
    try {
      release();
      return '';
    } catch (error) {
      return ` (${error instanceof Error ? error.message : String(error)})`;
    }
  };
  const counter = (tool: 'iptables' | 'ip6tables'): number => {
    const hits = ruleHits(invoke(tool, ['-L', 'OUTPUT', '-v', '-n', '-x']));
    if (hits.length !== 1)
      throw new Error(
        `${tool} lists ${hits.length} tagged rules, expected exactly 1`,
      );
    return hits[0] ?? 0;
  };

  for (const [event, handler] of handlers) proc.on(event, handler);
  try {
    sweepStale();
    for (const rule of rules) {
      invoke(rule.tool, rule.add);
      installed.push(rule);
    }
  } catch (error) {
    throw new SecurityObserverUnsupportedError(
      `Host-level outbound blocking is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }${rollback()}`,
    );
  }

  let code: string;
  let code6: string | null = null;
  let hits: number;
  let ipv6Hits = 0;
  try {
    const before = counter('iptables');
    const before6 = hasIpv6 ? counter('ip6tables') : 0;
    code = await (options.probe ?? defaultProbe)();
    if (hasIpv6) code6 = await (options.probe6 ?? defaultProbe6)();
    hits = counter('iptables') - before;
    if (hasIpv6) ipv6Hits = counter('ip6tables') - before6;
  } catch (error) {
    throw new SecurityObserverUnsupportedError(
      `Host-level outbound blocking cannot be verified: ${
        error instanceof Error ? error.message : String(error)
      }${rollback()}`,
    );
  }
  if (!BLOCKED_CODES.has(code))
    throw new SecurityObserverUnsupportedError(
      `Host-level outbound blocking is not effective: a non-loopback probe returned ${code}; traffic is not blocked.${rollback()}`,
    );
  if (hits <= 0)
    throw new SecurityObserverUnsupportedError(
      `Host-level outbound blocking is unproven: the rule did not match the probe packet.${rollback()}`,
    );

  let ipv6: HostBlocking['ipv6'] = 'blocked';
  let ipv6Reason: string | null = null;
  if (!hasIpv6) {
    ipv6 = 'unavailable';
    ipv6Reason = 'No IPv6 stack on this host (/proc/net/if_inet6 is absent).';
  } else if (ipv6Hits <= 0) {
    if (code6 === 'CONNECTED')
      throw new SecurityObserverUnsupportedError(
        `Host-level IPv6 outbound blocking is not effective: a non-loopback IPv6 probe connected; IPv6 traffic is not blocked.${rollback()}`,
      );
    if (!code6 || !NO_ROUTE_CODES.has(code6))
      throw new SecurityObserverUnsupportedError(
        `Host-level IPv6 blocking is unproven: the ip6tables rule did not match the IPv6 probe (${code6 ?? 'no result'}).${rollback()}`,
      );
    ipv6 = 'unavailable';
    ipv6Reason = `The IPv6 connect failed locally (${code6}) before reaching the OUTPUT chain, so no ip6tables counter could move.`;
  }
  return {
    mechanism: 'iptables owner-uid REJECT of non-loopback traffic',
    ipv6,
    ipv6Reason,
    hits,
    ipv6Hits,
    release,
  };
}
