import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Request } from 'playwright';
import {
  assertCompleteObservation,
  createSecurityObserver,
  detectNativeCapability,
  detectSecurityCapability,
  enableHostBlocking,
  FILE_PATH_SLOTS,
  hostBlockingRules,
  newCanaryName,
  parseStraceLog,
  ruleHits,
  sanitizeTarget,
  sanitizeUrl,
  SecurityObserverUnsupportedError,
  startTracedCommand,
  STRACE_ARGS,
  sweepHostBlockingRules,
  unexpectedEvents,
} from './security-observer.js';

const TRACE = [
  '900 1700000000.100000 connect(3, {sa_family=AF_INET, sin_port=htons(1), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 ECONNREFUSED (Connection refused)',
  '900 1700000000.200000 openat(AT_FDCWD, "/home/alice/private/report.rdlc?token=sentinel-secret", O_RDONLY) = -1 ENOENT (No such file or directory)',
  '900 1700000000.300000 execve("/nonexistent/rdlc-probe", ["rdlc-probe"], 0x7ffd) = -1 ENOENT (No such file or directory)',
  '900 1700000000.400000 clone(child_stack=NULL, flags=SIGCHLD) = 901',
  '901 1700000000.500000 connect(4, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16 <unfinished ...>',
  '+++ exited with 0 +++',
  'strace: Process 901 attached',
].join('\n');

test('strace parsing keeps failed attempts, descendants and sanitized targets', () => {
  const { events, truncated } = parseStraceLog(TRACE, {
    redactions: ['/home/alice'],
  });
  assert.equal(truncated, false);
  assert.deepEqual(
    events.map((event) => [
      event.channel,
      event.operation,
      event.outcome,
      event.pid,
      event.target,
    ]),
    [
      ['network', 'connect', 'failed', 900, '127.0.0.1:1'],
      [
        'file',
        'openat',
        'failed',
        900,
        '<path>/private/report.rdlc?<redacted>',
      ],
      ['exec', 'execve', 'failed', 900, 'rdlc-probe'],
      ['process', 'clone', 'succeeded', 900, 'child-process'],
      ['network', 'connect', 'attempted', 901, '203.0.113.9:443'],
    ],
  );
  assert.equal(events[0]?.error, 'ECONNREFUSED');
  assert.equal(events[0]?.atMs, 1_700_000_000_100);
});

test('strace parsing bounds events and never emits payloads or identities', () => {
  const secret = 'A'.repeat(64);
  const text = [
    `1 1700000000.1 openat(AT_FDCWD, "/Users/bob/report.rdlc", O_RDONLY) = 3`,
    `1 1700000000.2 openat(AT_FDCWD, "/tmp/data?password=${secret}", O_RDONLY) = -1 EACCES (Permission denied)`,
    `1 1700000000.3 connect(3, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("198.51.100.4")}, 16) = -1 EPERM (Operation not permitted)`,
  ].join('\n');
  const parsed = parseStraceLog(text, { maxEvents: 2, redactions: ['bob'] });
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.truncated, true);
  assert.doesNotMatch(JSON.stringify(parsed.events), /bob|A{8}/i);
  assert.equal(parsed.events[0]?.target, '<path>/report.rdlc');
});

test('URL sanitization keeps only the origin', () => {
  assert.equal(
    sanitizeUrl('https://user:pass@Example.COM:8443/report?q=private#frag'),
    'https://example.com:8443',
  );
  assert.equal(sanitizeUrl('file:///home/alice/secret.rdlc'), 'file:');
  assert.equal(sanitizeUrl('not a url'), 'invalid-url');
  assert.equal(sanitizeTarget('/home/alice/x', ['alice']), '<path>/x');
});

test('non-Linux native capture fails closed instead of claiming observation', async () => {
  const capability = detectNativeCapability('win32');
  assert.equal(capability.tool, null);
  assert.equal(capability.launch.supported, false);
  assert.equal(capability.attach.supported, false);
  assert.match(capability.launch.reason, /No unprivileged native/);
  await assert.rejects(
    startTracedCommand(
      { command: process.execPath, args: ['-e', ''] },
      capability,
    ),
    SecurityObserverUnsupportedError,
  );
});

test('supported launch capture follows a short-lived process tree end to end', async (t) => {
  const capability = detectNativeCapability();
  if (!capability.launch.supported) {
    assert.ok(capability.launch.reason);
    t.diagnostic(`launch capture unsupported: ${capability.launch.reason}`);
    return;
  }
  const traced = await startTracedCommand(
    {
      command: process.execPath,
      args: [
        '-e',
        'const fs=require("node:fs");const cp=require("node:child_process");const net=require("node:net");try{fs.openSync("/nonexistent/rdlc-test","r")}catch{};cp.execFile("/nonexistent/rdlc-test-exec",()=>{});net.connect({host:"127.0.0.1",port:1}).on("error",()=>{});setTimeout(()=>process.exit(0),500)',
      ],
      maxDurationMs: 30_000,
    },
    capability,
  );
  const observation = await traced.stop();
  assert.equal(observation.state, 'observed', observation.reason ?? '');
  assert.ok(observation.events.some((event) => event.channel === 'exec'));
  assert.ok(
    observation.events.some(
      (event) => event.channel === 'file' && event.outcome === 'failed',
    ),
  );
  assert.ok(
    observation.events.some(
      (event) => event.channel === 'network' && event.outcome === 'failed',
    ),
  );
  assert.ok(observation.events.some((event) => event.channel === 'process'));
});

class FakeContext extends EventEmitter {}

function fakeRequest(url: string, method = 'GET', error?: string): Request {
  return {
    url: () => url,
    method: () => method,
    failure: () => (error ? { errorText: error } : null),
  } as unknown as Request;
}

test('observer reports unsupported native capture and sanitized webview attempts', async () => {
  const context = new FakeContext();
  const observer = createSecurityObserver({
    rootPid: null,
    context: context as unknown as BrowserContext,
    capability: detectSecurityCapability('win32'),
  });
  await observer.start();
  context.emit(
    'request',
    fakeRequest('https://example.com/report?query=secret-value'),
  );
  context.emit(
    'requestfailed',
    fakeRequest(
      'http://127.0.0.1:1/private',
      'POST',
      'net::ERR_CONNECTION_REFUSED',
    ),
  );
  const observation = await observer.stop();

  assert.equal(observation.webview.state, 'observed');
  assert.deepEqual(
    observation.webview.events.map((event) => [
      event.target,
      event.outcome,
      event.error,
    ]),
    [
      ['https://example.com', 'attempted', null],
      ['http://127.0.0.1:1', 'failed', 'net::ERR_CONNECTION_REFUSED'],
    ],
  );
  assert.equal(observation.native.state, 'unsupported');
  assert.equal(observation.captureComplete, false);
  assert.match(observation.failures.join(' '), /Native host process-tree/);
  assert.throws(
    () => assertCompleteObservation(observation),
    /Security observation is incomplete/,
  );
  assert.equal(context.listenerCount('request'), 0);
  assert.equal(context.listenerCount('requestfailed'), 0);
});

const HOME = '/home/alice';
const ALLOWED = {
  open: ['/opt/vscode', '/work/fixture', '/work/profile'],
  exec: ['/opt/vscode'],
  home: HOME,
};
const call = (text: string, pid = 900) => `${pid} 1700000000.1 ${text}`;
const classify = (
  text: string,
  allowed: typeof ALLOWED = ALLOWED,
  extra = '',
) =>
  parseStraceLog([extra, call(text)].filter(Boolean).join('\n'), {
    allowed,
  }).events.at(-1)?.unexpected;

test('strace is asked to decode fd paths (-yy) with whole paths', () => {
  const joined = STRACE_ARGS.join(' ');
  assert.match(joined, /(?:^| )-yy(?: |$)/);
  assert.ok(Number(STRACE_ARGS[STRACE_ARGS.indexOf('-s') + 1]) >= 4096);
});

test('file classification resolves relative and dirfd paths and fails closed when it cannot', () => {
  const cases: [string, boolean | undefined][] = [
    [
      'openat(AT_FDCWD</work/fixture>, "/opt/vscode/resources/app/a.js", O_RDONLY|O_CLOEXEC) = 3</opt/vscode/resources/app/a.js>',
      false,
    ],
    // The repository root is no longer allowed.
    [
      'openat(AT_FDCWD</work>, "/work/other/file", O_RDONLY) = 3</work/other/file>',
      true,
    ],
    [
      'openat(AT_FDCWD</work/fixture>, "x.rdlc", O_RDONLY) = 5</work/fixture/x.rdlc>',
      false,
    ],
    [
      'openat(AT_FDCWD</work/fixture>, "../../etc/hostname", O_RDONLY) = 5',
      true,
    ],
    // Relative with no decodable cwd/dirfd cannot be resolved: unexpected, never ignored.
    ['openat(AT_FDCWD, "relative/x", O_RDONLY) = 5', true],
    ['openat(7, "x", O_RDONLY) = 5', true],
    ['open("relative/x", O_RDONLY) = 5', true],
    ['openat(7</work/fixture>, "a/b", O_RDONLY) = 5</work/fixture/a/b>', false],
    ['openat(7</etc/ssl/certs>, "ca.pem", O_RDONLY) = 5', false],
    ['openat(7</home/alice/.aws>, "credentials", O_RDONLY) = 5', true],
    // AT_EMPTY_PATH stats an already-open object: resolved from the fd, or not a path at all.
    [
      'newfstatat(3</home/alice/.ssh/id_rsa>, "", {st_mode=S_IFREG|0600}, AT_EMPTY_PATH) = 0',
      true,
    ],
    [
      'newfstatat(3<pipe:[123]>, "", {st_mode=S_IFIFO|0600}, AT_EMPTY_PATH) = 0',
      false,
    ],
    // Truncated or unparsable path arguments are unexpected.
    [
      'openat(AT_FDCWD</work/fixture>, "/work/fixture/aaaa"..., O_RDONLY) = 5',
      true,
    ],
    [
      'openat(AT_FDCWD</work/fixture>, 0x7ffd1234, O_RDONLY) = -1 EFAULT (Bad address)',
      true,
    ],
    // Unfinished calls carry the arguments; their resumed halves do not.
    ['openat(AT_FDCWD</work>, "/etc/shadow", O_RDONLY <unfinished ...>', true],
    ['<... openat resumed>) = 3</etc/shadow>', undefined],
    // Enumerated runtime paths.
    ['openat(AT_FDCWD</>, "/etc/ld.so.cache", O_RDONLY) = 3', false],
    [
      'openat(AT_FDCWD</>, "/usr/lib/x86_64-linux-gnu/libc.so.6", O_RDONLY) = 3',
      false,
    ],
    ['openat(AT_FDCWD</>, "/usr/bin/curl", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/etc/hostname", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/var/lib/dpkg/status", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/maps", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/900/stat", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/777/stat", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/dev/urandom", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/dev/sda", O_RDONLY) = 3', true],
    // Metadata of the ancestors of an allowed root is allowed; opening them is not.
    ['lstat("/work", {st_mode=S_IFDIR|0755}) = 0', false],
    ['lstat("/home", {st_mode=S_IFDIR|0755}) = 0', true],
    ['openat(AT_FDCWD</>, "/work", O_RDONLY|O_DIRECTORY) = 3', true],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('denylisted secret paths are unexpected even where the allowlist would permit them', () => {
  const wide = {
    ...ALLOWED,
    open: [...ALLOWED.open, '/etc', '/home', '/root', '/proc'],
  };
  const cases: [string, boolean][] = [
    ['openat(AT_FDCWD</>, "/etc/shadow", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/etc/gshadow", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/etc/passwd", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/etc/passwd", O_WRONLY|O_APPEND) = 3', true],
    ['unlink("/etc/passwd") = -1 EACCES (Permission denied)', true],
    ['openat(AT_FDCWD</>, "/home/alice/.ssh/id_rsa", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/home/bob/.aws/credentials", O_RDONLY) = 3', true],
    [
      'openat(AT_FDCWD</>, "/home/alice/.gnupg/pubring.kbx", O_RDONLY) = 3',
      true,
    ],
    [
      'openat(AT_FDCWD</>, "/home/alice/.config/Code/User/settings.json", O_RDONLY) = 3',
      true,
    ],
    ['openat(AT_FDCWD</>, "/root/.bashrc", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/901/environ", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/900/environ", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/self/environ", O_RDONLY) = 3', false],
  ];
  for (const [text, expected] of cases)
    assert.equal(
      classify(text, wide, call('clone(child_stack=NULL) = 901', 901)),
      expected,
      text,
    );
  // A disposable profile under ~/.config stays allowed; the rest of ~/.config does not.
  const profile = {
    ...ALLOWED,
    open: [...ALLOWED.open, '/home/alice/.config/rdlc-profile'],
  };
  assert.equal(
    classify(
      'openat(AT_FDCWD</>, "/home/alice/.config/rdlc-profile/User/a.json", O_RDONLY) = 3',
      profile,
    ),
    false,
  );
  assert.equal(
    classify(
      'openat(AT_FDCWD</>, "/home/alice/.config/other/a.json", O_RDONLY) = 3',
      profile,
    ),
    true,
  );
});

test('every path-taking file syscall is classified at every path position', () => {
  for (const op of [
    'open',
    'openat',
    'openat2',
    'creat',
    'unlink',
    'unlinkat',
    'rename',
    'renameat',
    'renameat2',
    'mkdir',
    'mkdirat',
    'rmdir',
    'chmod',
    'fchmodat',
    'chown',
    'lchown',
    'fchownat',
    'link',
    'linkat',
    'symlink',
    'symlinkat',
    'readlink',
    'readlinkat',
    'stat',
    'lstat',
    'newfstatat',
    'statx',
    'access',
    'faccessat',
    'faccessat2',
    'truncate',
    'utimensat',
    'execve',
    'execveat',
  ])
    assert.ok(op in FILE_PATH_SLOTS, `${op} is not classified`);
  // Exec roots are separate; give exec calls an allowed root for the inside path.
  const allowed = {
    ...ALLOWED,
    exec: [...ALLOWED.exec, '/work/fixture'],
  };
  const inside = '/work/fixture/in';
  const outside = '/outside/out';
  for (const [op, slots] of Object.entries(FILE_PATH_SLOTS)) {
    const pathCount = slots.filter((slot) => slot !== 's').length;
    for (let position = 0; position <= pathCount; position++) {
      let index = 0;
      const args = slots.map((slot) => {
        if (slot === 's') return '"symlink-target"';
        const path = index++ === position ? outside : inside;
        return slot === 'd' ? `AT_FDCWD</work>, "${path}"` : `"${path}"`;
      });
      const text = `${op}(${args.join(', ')}, 0) = -1 ENOENT (No such file or directory)`;
      const [event] = parseStraceLog(call(text), { allowed }).events;
      // position === pathCount keeps every path inside the allowlist.
      assert.equal(event?.unexpected, position < pathCount, text);
    }
  }
});

test('exec classification resolves paths, honors the denylist and the re-exec exception', () => {
  const cases: [string, boolean][] = [
    ['execve("/proc/self/exe", ["code"], 0x7ffd) = 0', false],
    ['execve("/opt/vscode/code", ["code"], 0x7ffd) = 0', false],
    [
      'execveat(AT_FDCWD</opt/vscode>, "bin/helper", ["h"], 0x7ffd, 0) = 0',
      false,
    ],
    ['execve("/usr/bin/curl", ["curl"], 0x7ffd) = 0', true],
    ['execve("/opt/vscode/../../usr/bin/curl", ["curl"], 0x7ffd) = 0', true],
    [
      'execve("relative/tool", ["t"], 0x7ffd) = -1 ENOENT (No such file or directory)',
      true,
    ],
    [
      'execve("/home/alice/.ssh/tool", ["t"], 0x7ffd) = -1 ENOENT (No such file or directory)',
      true,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('network classification flags non-loopback inet/inet6 and allows loopback and unix sockets', () => {
  const cases: [string, boolean][] = [
    [
      'connect(3<TCP:[1234]>, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16) = -1 ECONNREFUSED (Connection refused)',
      true,
    ],
    [
      'connect(3<TCP:[1234]>, {sa_family=AF_INET, sin_port=htons(9222), sin_addr=inet_addr("127.0.0.1")}, 16) = 0',
      false,
    ],
    [
      'connect(4<UNIX:[5]>, {sa_family=AF_UNIX, sun_path="/run/user/1000/bus"}, 20) = 0',
      false,
    ],
    [
      'connect(5<TCPv6:[6]>, {sa_family=AF_INET6, sin6_port=htons(443), inet_pton(AF_INET6, "2001:db8::1", &sin6_addr)}, 28) = -1 ENETUNREACH (Network is unreachable)',
      true,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('harness-only positive control: a canary outside the allowlist is detected, an allowed twin is not', () => {
  const canary =
    'openat(AT_FDCWD</work/fixture>, "/tmp/rdlc-canary-abc/canary.dat", O_RDONLY) = 3</tmp/rdlc-canary-abc/canary.dat>';
  const twin =
    'openat(AT_FDCWD</work/fixture>, "/work/fixture/canary.dat", O_RDONLY) = 3';
  const events = parseStraceLog([call(canary), call(twin)].join('\n'), {
    allowed: ALLOWED,
    redactions: ['/work'],
  }).events;
  assert.deepEqual(
    unexpectedEvents(events).map((event) => event.target),
    ['/tmp/rdlc-canary-abc/canary.dat'],
  );
  // Without a classification request the event shape is unchanged.
  assert.equal(
    parseStraceLog(call(canary)).events.some(
      (event) => event.unexpected !== undefined,
    ),
    false,
  );
});

const LISTING = (hits: number, tagged = 1) =>
  [
    'Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)',
    '    pkts      bytes target     prot opt in     out     source               destination',
    ...Array.from(
      { length: tagged },
      () =>
        `${String(hits).padStart(8)}      180 REJECT     all  --  *      *       0.0.0.0/0           !127.0.0.0/8          OWNER UID match 1001 /* rdlc-desktop-security */ reject-with icmp-port-unreachable`,
    ),
    '       9      540 ACCEPT     all  --  *      *       0.0.0.0/0            0.0.0.0/0  /* other */',
  ].join('\n');

test('host blocking rules are owner scoped, tagged and removable', () => {
  const rules = hostBlockingRules(1001);
  assert.deepEqual(
    rules.map((rule) => rule.tool),
    ['iptables', 'ip6tables'],
  );
  const [v4, v6] = rules;
  assert.ok(v4 && v6);
  assert.deepEqual(v4.add.slice(0, 5), ['-I', 'OUTPUT', '1', '-m', 'owner']);
  assert.ok(v4.add.includes('!') && v4.add.includes('127.0.0.0/8'));
  assert.ok(v6.add.includes('::1/128'));
  assert.ok(v4.add.includes('rdlc-desktop-security'));
  assert.deepEqual(v4.remove, ['-D', 'OUTPUT', ...v4.add.slice(3)]);
  // One entry per tagged line; callers decide what an ambiguous count means.
  assert.deepEqual(ruleHits(LISTING(3)), [3]);
  assert.deepEqual(ruleHits(LISTING(7, 2)), [7, 7]);
  assert.deepEqual(ruleHits('Chain OUTPUT (policy ACCEPT)'), []);
});

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  exit(code: number): void {
    this.exitCode = code;
  }
}

interface FakeHost {
  readonly calls: string[];
  readonly hits: { v4: number; v6: number };
  readonly run: (file: string, args: readonly string[]) => string;
}

function fakeHost(
  options: {
    failOn?: string;
    /** Per-tool `-S OUTPUT` listing, e.g. stale tagged rules to sweep. */
    stale?: Partial<Record<'iptables' | 'ip6tables', string>>;
    /** Number of rule removals that fail before succeeding. */
    failRemovals?: number;
    taggedLines?: number;
  } = {},
): FakeHost {
  const calls: string[] = [];
  const hits = { v4: 0, v6: 0 };
  let removalFailures = options.failRemovals ?? 0;
  const run = (file: string, args: readonly string[]): string => {
    const line = [file, ...args].join(' ');
    calls.push(line);
    const tool = line.includes('ip6tables') ? 'ip6tables' : 'iptables';
    if (options.failOn && line.includes(options.failOn))
      throw new Error(`denied: ${options.failOn}`);
    if (
      args.includes('-D') &&
      removalFailures > 0 &&
      line.includes('--uid-owner 0 ')
    ) {
      removalFailures--;
      throw new Error('busy');
    }
    if (args.includes('-S'))
      return options.stale?.[tool] ?? '-P OUTPUT ACCEPT\n';
    if (args.includes('-L'))
      return LISTING(
        tool === 'ip6tables' ? hits.v6 : hits.v4,
        options.taggedLines ?? 1,
      );
    return '';
  };
  return { calls, hits, run };
}

const probeFor =
  (host: FakeHost, code = 'ECONNREFUSED') =>
  async () => {
    host.hits.v4++;
    return code;
  };
const probe6For =
  (host: FakeHost, code = 'ECONNREFUSED', counted = true) =>
  async () => {
    if (counted) host.hits.v6++;
    return code;
  };

test('host blocking is proven by counter deltas around the probe, never by summing tagged lines', async () => {
  const host = fakeHost();
  const blocking = await enableHostBlocking({
    platform: 'linux',
    uid: 1001,
    hasIpv6: true,
    run: host.run,
    probe: probeFor(host),
    probe6: probe6For(host),
    proc: new FakeProcess(),
  });
  assert.equal(blocking.hits, 1);
  assert.equal(blocking.ipv6, 'blocked');
  assert.equal(blocking.ipv6Hits, 1);
  assert.match(
    host.calls.find((c) => c.includes(' -I ')) ?? '',
    /^sudo -n iptables -I OUTPUT 1 -m owner --uid-owner 1001 /,
  );
  assert.ok(host.calls.some((c) => c.startsWith('sudo -n ip6tables -I')));
  host.calls.length = 0;
  blocking.release();
  blocking.release();
  assert.equal(host.calls.filter((c) => c.includes(' -D OUTPUT ')).length, 2);

  // A pre-existing hit count does not count: only the delta around the probe does.
  const stale = fakeHost();
  stale.hits.v4 = 50;
  await assert.rejects(
    enableHostBlocking({
      platform: 'linux',
      uid: 1001,
      hasIpv6: false,
      run: stale.run,
      probe: async () => 'ECONNREFUSED',
      proc: new FakeProcess(),
    }),
    /did not match/,
  );
  assert.ok(stale.calls.some((c) => c.includes(' -D OUTPUT ')));

  // Two tagged rules are ambiguous, so the counters prove nothing.
  const twice = fakeHost({ taggedLines: 2 });
  await assert.rejects(
    enableHostBlocking({
      platform: 'linux',
      uid: 1001,
      hasIpv6: false,
      run: twice.run,
      probe: probeFor(twice),
      proc: new FakeProcess(),
    }),
    /expected exactly 1/,
  );

  // The blocked probe actually connected: not blocked, rule removed.
  const open = fakeHost();
  await assert.rejects(
    enableHostBlocking({
      platform: 'linux',
      uid: 1001,
      hasIpv6: false,
      run: open.run,
      probe: probeFor(open, 'CONNECTED'),
      proc: new FakeProcess(),
    }),
    /not blocked/,
  );
  assert.ok(open.calls.some((c) => c.includes(' -D OUTPUT ')));

  // Mechanism unavailable: explicit reason and rollback of anything installed.
  const denied = fakeHost({ failOn: 'ip6tables -I' });
  await assert.rejects(
    enableHostBlocking({
      platform: 'linux',
      uid: 1001,
      hasIpv6: true,
      run: denied.run,
      probe: probeFor(denied),
      probe6: probe6For(denied),
      proc: new FakeProcess(),
    }),
    /Host-level outbound blocking is unavailable: .*denied: ip6tables -I/,
  );
  assert.ok(denied.calls.some((c) => c.includes('iptables -D OUTPUT')));

  await assert.rejects(
    enableHostBlocking({ platform: 'win32', uid: 0, hasIpv6: false }),
    (error: unknown) =>
      error instanceof SecurityObserverUnsupportedError &&
      /not implemented for win32/.test(error.message),
  );
});

test('IPv6 blocking needs a real ip6tables counter delta; no IPv6 is recorded as unavailable', async () => {
  // No IPv6 stack at all.
  const none = fakeHost();
  const absent = await enableHostBlocking({
    platform: 'linux',
    uid: 0,
    hasIpv6: false,
    run: none.run,
    probe: probeFor(none, 'ENETUNREACH'),
    proc: new FakeProcess(),
  });
  assert.equal(absent.ipv6, 'unavailable');
  assert.match(absent.ipv6Reason ?? '', /no IPv6/i);
  assert.ok(
    !none.calls.some((c) => c.startsWith('sudo') || c.includes('ip6tables')),
  );
  absent.release();

  // IPv6 stack without a route: the connect fails before the OUTPUT chain.
  const routeless = fakeHost();
  const unavailable = await enableHostBlocking({
    platform: 'linux',
    uid: 0,
    hasIpv6: true,
    run: routeless.run,
    probe: probeFor(routeless),
    probe6: probe6For(routeless, 'ENETUNREACH', false),
    proc: new FakeProcess(),
  });
  assert.equal(unavailable.ipv6, 'unavailable');
  assert.match(unavailable.ipv6Reason ?? '', /ENETUNREACH/);
  assert.equal(unavailable.ipv6Hits, 0);
  unavailable.release();

  // Refused with no counter delta proves nothing.
  const unproven = fakeHost();
  await assert.rejects(
    enableHostBlocking({
      platform: 'linux',
      uid: 0,
      hasIpv6: true,
      run: unproven.run,
      probe: probeFor(unproven),
      probe6: probe6For(unproven, 'ECONNREFUSED', false),
      proc: new FakeProcess(),
    }),
    /IPv6 blocking is unproven/,
  );
  // Connected over IPv6: not blocked.
  const leaking = fakeHost();
  await assert.rejects(
    enableHostBlocking({
      platform: 'linux',
      uid: 0,
      hasIpv6: true,
      run: leaking.run,
      probe: probeFor(leaking),
      probe6: probe6For(leaking, 'CONNECTED', false),
      proc: new FakeProcess(),
    }),
    /IPv6 .*not blocked/,
  );
});

test('release is retryable, hooks cover exit and signals, and stale tagged rules are swept first', async () => {
  // A failed removal leaves the rule installed and release retryable.
  const flaky = fakeHost({ failRemovals: 1 });
  const hooks = new FakeProcess();
  const blocking = await enableHostBlocking({
    platform: 'linux',
    uid: 0,
    hasIpv6: false,
    run: flaky.run,
    probe: probeFor(flaky),
    proc: hooks,
  });
  assert.equal(hooks.listenerCount('exit'), 1);
  assert.equal(hooks.listenerCount('SIGINT'), 1);
  assert.equal(hooks.listenerCount('SIGTERM'), 1);
  assert.equal(hooks.listenerCount('SIGHUP'), 1);
  assert.equal(hooks.listenerCount('SIGQUIT'), 1);
  assert.throws(() => blocking.release(), /removal failed/);
  assert.equal(
    hooks.listenerCount('exit'),
    1,
    'hooks stay until removal succeeds',
  );
  const removals = () =>
    flaky.calls.filter((c) => c.includes(' -D OUTPUT ')).length;
  const before = removals();
  blocking.release();
  assert.equal(removals(), before + 1, 'the retry removes the rule');
  blocking.release();
  assert.equal(removals(), before + 1, 'a released rule is not removed twice');
  assert.equal(hooks.listenerCount('exit'), 0);
  assert.equal(hooks.listenerCount('SIGINT'), 0);
  assert.equal(hooks.listenerCount('SIGHUP'), 0);
  assert.equal(hooks.listenerCount('SIGQUIT'), 0);

  // Process exit and signals remove an unreleased rule.
  for (const event of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
    const host = fakeHost();
    const proc = new FakeProcess();
    await enableHostBlocking({
      platform: 'linux',
      uid: 0,
      hasIpv6: false,
      run: host.run,
      probe: probeFor(host),
      proc,
    });
    host.calls.length = 0;
    proc.emit(event);
    assert.equal(
      host.calls.filter((c) => c.includes(' -D OUTPUT ')).length,
      1,
      event,
    );
    if (event !== 'exit')
      assert.ok(proc.exitCode !== null, `${event} ends the process`);
  }

  // Stale tagged rules from a killed run are removed before installing.
  const stale =
    '-P OUTPUT ACCEPT\n' +
    '-A OUTPUT -m owner --uid-owner 1001 ! -d 127.0.0.0/8 -m comment --comment rdlc-desktop-security -j REJECT --reject-with icmp-port-unreachable\n' +
    '-A OUTPUT -m comment --comment "other rule" -j ACCEPT\n';
  const host = fakeHost({ stale: { iptables: stale } });
  const swept = await enableHostBlocking({
    platform: 'linux',
    uid: 0,
    hasIpv6: false,
    run: host.run,
    probe: probeFor(host),
    proc: new FakeProcess(),
  });
  const firstInsert = host.calls.findIndex((c) => c.includes(' -I OUTPUT '));
  const sweep = host.calls.findIndex((c) =>
    c.includes(' -D OUTPUT -m owner --uid-owner 1001 ! -d 127.0.0.0/8 '),
  );
  assert.ok(sweep !== -1 && sweep < firstInsert, 'sweep precedes install');
  assert.ok(
    !host.calls.some((c) => c.includes('other rule')),
    'untagged rules are untouched',
  );
  swept.release();
});

const classifyWith = (text: string, allowed: typeof ALLOWED = ALLOWED) =>
  classify(text, allowed, call('clone(child_stack=NULL) = 901', 901));

test('the canary name keeps its identity through sanitization with a realistic directory', () => {
  const name = newCanaryName();
  assert.match(name, /^rdlc-canary-[0-9a-f]{8}\.dat$/);
  const path = `/tmp/rdlc-canary-Xy12Ab/${name}`;
  assert.equal(sanitizeTarget(path, ['/work']), path);
  const [event] = parseStraceLog(
    call(`openat(AT_FDCWD</work/fixture>, "${path}", O_RDONLY) = 3<${path}>`),
    { allowed: ALLOWED, redactions: ['/work'] },
  ).events;
  assert.equal(event?.target, path);
  assert.equal(event?.unexpected, true);
  // The old uuid-shaped name was swallowed by the long-token redaction.
  const long =
    '/tmp/rdlc-canary-Xy12Ab/rdlc-canary-0b3c2d1e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.dat';
  assert.ok(!sanitizeTarget(long).includes('0b3c2d1e'));
});

test('/proc allowances are specific files; magic links and memory are denied', () => {
  const cases: [string, boolean][] = [
    ['openat(AT_FDCWD</>, "/proc/self/maps", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/self/status", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/self/task/901/stat", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/self/fd/3", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/self/fdinfo/3", O_RDONLY) = 3', false],
    ['readlink("/proc/self/exe", "/opt/vscode/code", 4096) = 16', false],
    ['openat(AT_FDCWD</>, "/proc/self/exe", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/900/cgroup", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/901/limits", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/777/limits", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/oom_score_adj", O_WRONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/proc/self/maps", O_WRONLY) = 3', true],
    // Not enumerated, so unexpected.
    ['openat(AT_FDCWD</>, "/proc/self/pagemap", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/environ", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/root/etc/passwd", O_RDONLY) = 3', true],
    [
      'openat(AT_FDCWD</>, "/proc/self/root/home/u/.ssh/id_rsa", O_RDONLY) = 3',
      true,
    ],
    ['openat(AT_FDCWD</>, "/proc/self/cwd/secret", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/cwd/..", O_RDONLY) = 3', true],
    [
      'openat(AT_FDCWD</>, "/proc/self/cwd/../../etc/hosts", O_RDONLY) = 3',
      true,
    ],
    ['openat(AT_FDCWD</>, "/proc/self/fd/3/../x", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/map_files/1-2", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/mem", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/900/root/x", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/proc/self/task/901/cwd/x", O_RDONLY) = 3', true],
  ];
  for (const [text, expected] of cases)
    assert.equal(classifyWith(text), expected, text);
  // Magic links stay denied even when a root would otherwise allow the whole tree.
  const wide = { ...ALLOWED, open: [...ALLOWED.open, '/proc'] };
  for (const path of ['root/x', 'cwd/x', 'map_files/1-2', 'mem'])
    assert.equal(
      classifyWith(
        `openat(AT_FDCWD</>, "/proc/self/${path}", O_RDONLY) = 3`,
        wide,
      ),
      true,
      path,
    );
});

test('runtime allowances are read-only except enumerated writable devices and caches', () => {
  const cases: [string, boolean][] = [
    ['openat(AT_FDCWD</>, "/etc/hosts", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/etc/hosts", O_WRONLY|O_APPEND) = 3', true],
    ['openat(AT_FDCWD</>, "/usr/lib/libc.so.6", O_RDWR) = 3', true],
    [
      'openat(AT_FDCWD</>, "/usr/lib/evil.so", O_WRONLY|O_CREAT, 0644) = 3',
      true,
    ],
    ['unlink("/usr/lib/libc.so.6") = -1 EACCES (Permission denied)', true],
    [
      'chmod("/etc/ld.so.cache", 0777) = -1 EPERM (Operation not permitted)',
      true,
    ],
    ['openat(AT_FDCWD</>, "/dev/urandom", O_WRONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/dev/null", O_WRONLY) = 3', false],
    [
      'openat(AT_FDCWD</>, "/dev/shm/.org.chromium.X", O_RDWR|O_CREAT, 0600) = 3',
      false,
    ],
    ['openat(AT_FDCWD</>, "/dev/pts/0", O_RDWR) = 3', false],
    ['openat(AT_FDCWD</>, "/dev/ptmx", O_RDWR) = 3', false],
    ['openat(AT_FDCWD</>, "/dev/dri/renderD128", O_RDWR) = 3', false],
    [
      'openat(AT_FDCWD</>, "/var/cache/fontconfig/a.cache-9", O_WRONLY|O_CREAT, 0644) = 3',
      false,
    ],
    // Dynamic roots stay writable.
    [
      'openat(AT_FDCWD</>, "/work/profile/a", O_WRONLY|O_CREAT, 0644) = 3',
      false,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classifyWith(text), expected, text);
  // Caller-declared read-only roots (install, extension sources) never accept writes.
  const readOnly = {
    ...ALLOWED,
    open: ['/work/profile'],
    readOnly: ['/opt/vscode'],
  };
  for (const [text, expected] of [
    ['openat(AT_FDCWD</>, "/opt/vscode/a.js", O_RDONLY) = 3', false],
    ['openat(AT_FDCWD</>, "/opt/vscode/a.js", O_WRONLY) = 3', true],
    ['stat("/opt", {st_mode=S_IFDIR|0755}) = 0', false],
  ] as const)
    assert.equal(classifyWith(text, readOnly), expected, text);
});

test('unix sockets follow the file rules; unlisted file syscalls are unexpected by default', () => {
  const connect = (path: string) =>
    `connect(4<UNIX:[5]>, {sa_family=AF_UNIX, sun_path=${path}}, 20) = 0`;
  const sockets: [string, boolean][] = [
    ['"/tmp/.X11-unix/X0"', false],
    ['"/run/dbus/system_bus_socket"', false],
    ['"/var/run/dbus/system_bus_socket"', false],
    ['"/run/user/1000/bus"', false],
    ['@"/tmp/.X11-unix/X0"', false],
    ['@"dbus-abc"', false],
    ['"/work/profile/1.sock"', false],
    ['"/run/user/1000/keyring/ssh"', true],
    ['"/tmp/ssh-AbCdEf/agent.123"', true],
    ['"/var/run/docker.sock"', true],
    ['"/run/user/1000/gnupg/S.gpg-agent"', true],
    ['"/home/alice/.ssh/agent.sock"', true],
    ['"relative.sock"', true],
  ];
  for (const [path, expected] of sockets)
    assert.equal(classifyWith(connect(path)), expected, path);
  assert.equal(
    classifyWith(
      'bind(4<UNIX:[5]>, {sa_family=AF_UNIX, sun_path="/var/run/docker.sock"}, 20) = 0',
    ),
    true,
  );
  // Unlisted traced %file syscalls are classified, never dropped.
  const unlisted: [string, boolean][] = [
    ['mknod("/work/profile/fifo", S_IFIFO|0600, 0) = 0', true],
    ['mknodat(AT_FDCWD</>, "/work/profile/fifo", S_IFIFO|0600, 0) = 0', true],
    ['chroot("/work/profile") = -1 EPERM (Operation not permitted)', true],
    [
      'mount("none", "/work/profile", "tmpfs", 0, NULL) = -1 EPERM (Operation not permitted)',
      true,
    ],
    ['setxattr("/work/profile/a", "user.x", "v", 1, 0) = 0', true],
    ['removexattr("/work/profile/a", "user.x") = 0', true],
    [
      'fanotify_mark(3<anon_inode:[fanotify]>, FAN_MARK_ADD, FAN_OPEN, AT_FDCWD</>, "/work/profile") = 0',
      true,
    ],
    // Explicitly allowed read-only on an allowed path.
    ['statfs("/work/profile", {f_type=EXT4_SUPER_MAGIC}) = 0', false],
    ['statfs("/home/alice/.ssh", {f_type=EXT4_SUPER_MAGIC}) = 0', true],
    ['statfs("/mnt/data", {f_type=EXT4_SUPER_MAGIC}) = 0', true],
    [
      'getxattr("/work/profile/a", "user.x", NULL, 0) = -1 ENODATA (No data available)',
      false,
    ],
    [
      'getxattr("/etc/hostname", "user.x", NULL, 0) = -1 ENODATA (No data available)',
      true,
    ],
    [
      'inotify_add_watch(3<anon_inode:inotify>, "/work/profile", IN_MODIFY) = 1',
      false,
    ],
    [
      'inotify_add_watch(3<anon_inode:inotify>, "/root/.cache", IN_MODIFY) = 1',
      true,
    ],
    [
      'inotify_add_watch(3<anon_inode:inotify>, "/mnt/data", IN_MODIFY) = 1',
      true,
    ],
  ];
  for (const [text, expected] of unlisted)
    assert.equal(classifyWith(text), expected, text);
});

test('the secret denylist covers credential stores of the home directory', () => {
  const wide = { ...ALLOWED, open: [...ALLOWED.open, '/home'] };
  for (const path of [
    '.netrc',
    '.git-credentials',
    '.docker/config.json',
    '.kube/config',
    '.npmrc',
    '.local/share/keyrings/login.keyring',
  ])
    assert.equal(
      classifyWith(
        `openat(AT_FDCWD</>, "/home/alice/${path}", O_RDONLY) = 3`,
        wide,
      ),
      true,
      path,
    );
  assert.equal(
    classifyWith(
      'openat(AT_FDCWD</>, "/home/alice/.local/share/other", O_RDONLY) = 3',
      wide,
    ),
    false,
  );
});

test('the runner sweep removes tagged rules of a killed run and nothing else', () => {
  const stale =
    '-P OUTPUT ACCEPT\n' +
    '-A OUTPUT -m owner --uid-owner 1001 ! -d 127.0.0.0/8 -m comment --comment rdlc-desktop-security -j REJECT --reject-with icmp-port-unreachable\n' +
    '-A OUTPUT -m comment --comment "other rule" -j ACCEPT\n';
  const host = fakeHost({ stale: { iptables: stale } });
  const sweep = sweepHostBlockingRules({
    platform: 'linux',
    uid: 1001,
    hasIpv6: false,
    run: host.run,
  });
  assert.deepEqual(sweep, { removed: 1, skipped: null });
  assert.equal(host.calls.filter((c) => c.includes(' -D OUTPUT ')).length, 1);
  assert.ok(!host.calls.some((c) => c.includes('other rule')));
  // Non-Linux hosts have nothing to sweep.
  assert.deepEqual(sweepHostBlockingRules({ platform: 'win32' }), {
    removed: 0,
    skipped: 'not linux',
  });
  // Without root or sudo the sweep fails; the caller decides what that means.
  const denied = fakeHost({ failOn: '-S OUTPUT' });
  assert.throws(
    () =>
      sweepHostBlockingRules({
        platform: 'linux',
        uid: 1001,
        hasIpv6: false,
        run: denied.run,
      }),
    /denied/,
  );
});
