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
  WINDOWS_BLOCKING_REQUIREMENT,
  WINDOWS_CAPTURE_REQUIREMENT,
} from './security-observer.js';
import { unclassifiedNetworkEvents } from './offline-assertions.js';

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

test('a pid-prefixed unfinished+resumed call yields exactly one classified event', () => {
  const allowed = {
    open: ['/work/fixture'],
    exec: ['/opt/vscode'],
    home: '/home/alice',
  };
  const connect = [
    '900 1700000000.1 connect(3<TCP:[1->2]>, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("127.0.0.1")}, 16 <unfinished ...>',
    '901 1700000000.15 getpid() = 901',
    '900 1700000000.2 <... connect resumed>) = -1 EINPROGRESS (Operation now in progress)',
  ].join('\n');
  const net = parseStraceLog(connect, { allowed });
  assert.equal(net.events.length, 1);
  assert.equal(net.events[0]?.operation, 'connect');
  assert.equal(net.events[0]?.outcome, 'attempted');
  assert.equal(net.events[0]?.unexpected, false);
  assert.equal(unclassifiedNetworkEvents(net.events).length, 0);

  const open = [
    '900 1700000000.1 openat(AT_FDCWD</work/fixture>, "/etc/shadow", O_RDONLY <unfinished ...>',
    '900 1700000000.2 <... openat resumed>) = 3</etc/shadow>',
  ].join('\n');
  const file = parseStraceLog(open, { allowed });
  assert.equal(file.events.length, 1);
  assert.equal(file.events[0]?.unexpected, true);

  // A resumed line is no event: it neither counts toward maxEvents nor truncates.
  const counted = parseStraceLog(`${connect}\n${open}`, {
    allowed,
    maxEvents: 2,
  });
  assert.equal(counted.events.length, 2);
  assert.equal(counted.truncated, false);
  const capped = parseStraceLog(`${connect}\n${open}`, {
    allowed,
    maxEvents: 1,
  });
  assert.equal(capped.events.length, 1);
  assert.equal(capped.truncated, true);
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
  // No tool is implemented, so nothing can read as a proven control.
  assert.equal(capability.tool, null);
  assert.equal(capability.launch.supported, false);
  assert.equal(capability.attach.supported, false);
  assert.equal(capability.launch.reason, WINDOWS_CAPTURE_REQUIREMENT);
  assert.equal(capability.attach.reason, WINDOWS_CAPTURE_REQUIREMENT);
  assert.match(capability.launch.reason, /elevated ETW kernel session/);
  assert.match(capability.launch.reason, /bounded ETL consumer/);
  assert.ok(
    Object.values(capability.launch.controls).every((value) => !value),
    'an unsupported capability never carries proven controls',
  );
  assert.ok(Object.values(capability.attach.controls).every((value) => !value));
  // Other non-Linux platforms keep the generic fail-closed reason.
  assert.equal(detectNativeCapability('darwin').launch.supported, false);
  assert.match(
    detectNativeCapability('darwin').launch.reason ?? '',
    /No unprivileged native/,
  );
  await assert.rejects(
    startTracedCommand(
      { command: process.execPath, args: ['-e', ''] },
      capability,
    ),
    SecurityObserverUnsupportedError,
  );
});

test('Windows host blocking fails closed with the WFP rule and positive control named', async () => {
  assert.match(WINDOWS_BLOCKING_REQUIREMENT, /Windows Filtering Platform/);
  assert.match(WINDOWS_BLOCKING_REQUIREMENT, /administrator/);
  assert.match(WINDOWS_BLOCKING_REQUIREMENT, /positive control/);
  await assert.rejects(
    enableHostBlocking({ platform: 'win32', uid: 0, hasIpv6: false }),
    (error: unknown) =>
      error instanceof SecurityObserverUnsupportedError &&
      error.message === WINDOWS_BLOCKING_REQUIREMENT,
  );
});

test(
  'supported launch capture follows a short-lived process tree end to end',
  { timeout: 60_000 },
  async (t) => {
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
    // Let the short-lived tree finish under strace: stopping mid-trace can leave
    // a stopped tracee holding this test's pipes open.
    if (traced.child.exitCode === null && traced.child.signalCode === null)
      await new Promise<void>((done) => {
        const timer = setTimeout(done, 20_000);
        traced.child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
      });
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
  },
);

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
    [
      'connect(5<TCPv6:[6]>, {sa_family=AF_INET6, sin6_port=htons(443), inet_pton(AF_INET6, "::1234", &sin6_addr)}, 28) = -1 ENETUNREACH (Network is unreachable)',
      true,
    ],
    [
      'connect(5<TCPv6:[6]>, {sa_family=AF_INET6, sin6_port=htons(9222), inet_pton(AF_INET6, "::1", &sin6_addr)}, 28) = 0',
      false,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('unrecognized outgoing network addresses fail closed rather than disappear from the oracle', () => {
  for (const line of [
    'connect(3, {sa_family=AF_FUTURE, destination="unknown"}, 16) = -1 EINVAL (Invalid argument)',
    'sendto(3, "payload", 7, 0, NULL, 0) = 7',
    'sendmsg(3, {msg_name=NULL, msg_namelen=0}, 0) = 7',
    'sendmmsg(3, [{msg_hdr={msg_name=NULL, msg_namelen=0}, msg_len=7}], 1, 0) = 1',
  ]) {
    const { events } = parseStraceLog(call(line), { allowed: ALLOWED });
    assert.equal(events.length, 1, line);
    assert.equal(events[0]!.unexpected, true, line);
    assert.equal(unexpectedEvents(events).length, 1, line);
  }
});

test('addressless sends are classified by the connected peer -yy records on the fd', () => {
  const cases: [string, boolean | undefined][] = [
    ['sendto(3<UNIX-STREAM:[272961->272962]>, "x", 1, 0, NULL, 0) = 1', false],
    [
      'sendmsg(5<UNIX-STREAM:[10->11,"/run/user/1000/bus"]>, {msg_name=NULL, msg_namelen=0}, 0) = 7',
      false,
    ],
    [
      'sendmmsg(5<UNIX-STREAM:[10->11,"/run/user/1000/bus"]>, [{msg_hdr={msg_name=NULL, msg_namelen=0}, msg_len=7}], 1, 0) = 1',
      false,
    ],
    [
      'sendto(5<UNIX-STREAM:[10->11,"/var/run/docker.sock"]>, "x", 1, 0, NULL, 0) = 1',
      true,
    ],
    ['sendto(6<UNIX-DGRAM:[12]>, "x", 1, 0, NULL, 0) = 1', true],
    [
      'sendto(6<UNIX-STREAM:[10->11,"/tmp/a]b"]>, "x", 1, 0, NULL, 0) = 1',
      true,
    ],
    ['sendto(7<NETLINK:[ROUTE:4321]>, "x", 1, 0, NULL, 0) = 1', false],
    [
      'sendto(8<TCP:[127.0.0.1:4000->127.0.0.1:9222]>, "x", 1, 0, NULL, 0) = 1',
      false,
    ],
    [
      'sendto(8<TCPv6:[[::1]:4000->[::1]:9222]>, "x", 1, 0, NULL, 0) = 1',
      false,
    ],
    [
      'sendto(9<TCP:[10.0.0.2:4000->203.0.113.9:443]>, "x", 1, 0, NULL, 0) = 1',
      true,
    ],
    ['sendto(10<UDP:[0.0.0.0:5353]>, "x", 1, 0, NULL, 0) = 1', true],
  ];
  for (const [line, expected] of cases) {
    const { events } = parseStraceLog(call(line), { allowed: ALLOWED });
    assert.equal(events.length, 1, line);
    assert.equal(events[0]!.unexpected, expected, line);
  }
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

test('strace does not trace the receive calls, which are never an outbound attempt', () => {
  const joined = STRACE_ARGS.join(' ');
  assert.match(joined, /-e trace=%network,%file,%process(?: |$)/);
  assert.match(joined, /-e trace=!recvfrom,recvmsg,recvmmsg(?: |$)/);
  // Sends, connects and sockets stay traced: the positive controls depend on them.
  assert.doesNotMatch(joined, /!(?:[a-z]+,)*(?:send|connect|socket|bind)/);
});

test('receive calls and socket queries are never unexpected, whatever peer or address they show', () => {
  const peer = '9<TCP:[10.0.0.2:4000->203.0.113.9:443]>';
  const cases: [string, boolean][] = [
    [`recvfrom(${peer}, "x", 1, MSG_PEEK, NULL, NULL) = 1`, false],
    [
      `recvfrom(${peer}, 0x7ffd, 1, MSG_PEEK, NULL, NULL) = -1 EAGAIN (x)`,
      false,
    ],
    [`recvfrom(${peer}, <unfinished ...>`, false],
    [
      'recvfrom(3, "x", 1, 0, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("203.0.113.9")}, [16]) = 1',
      false,
    ],
    [
      'recvmsg(8<UDPv6:[[2a01::1]:4000->[2001:db8::1]:443]>, {msg_namelen=128}, 0) = 12',
      false,
    ],
    ['recvmmsg(8<UDP:[0.0.0.0:5353]>, 0x7ffd, 4, 0, NULL) = 1', false],
    [
      'recvmsg(5<UNIX-STREAM:[10->11,"/var/run/docker.sock"]>, {msg_namelen=0}, 0) = 3',
      false,
    ],
    [`getsockopt(${peer}, SOL_SOCKET, SO_ERROR, [0], [4]) = 0`, false],
    [
      'getsockname(8<UDPv6:[[2a01::1]:4000->[2001:db8::1]:443]>, {sa_family=AF_INET6, sin6_port=htons(4000), inet_pton(AF_INET6, "2a01::1", &sin6_addr)}, [28]) = 0',
      false,
    ],
    [
      'getsockname(3<TCP:[1]>, {sa_family=AF_INET, sin_port=htons(4000), sin_addr=inet_addr("192.0.2.7")}, [16]) = 0',
      false,
    ],
    [`getpeername(${peer}, {sa_family=AF_INET}, [16]) = 0`, false],
    [`setsockopt(${peer}, SOL_TCP, TCP_NODELAY, [1], 4) = 0`, false],
    [`shutdown(${peer}, SHUT_RDWR) = 0`, false],
    // Transmitting on the very same socket is still judged by its peer.
    [`sendto(${peer}, "x", 1, 0, NULL, 0) = 1`, true],
    [`sendmsg(${peer}, {msg_name=NULL, msg_namelen=0}, 0) = 1`, true],
    [
      `sendmmsg(${peer}, [{msg_hdr={msg_name=NULL, msg_namelen=0}, msg_len=1}], 1, 0) = 1`,
      true,
    ],
    [
      'sendmmsg(4<UDP:[127.0.0.1:40213->127.0.0.1:42403]>, [{msg_hdr={msg_name=NULL, msg_namelen=0}, msg_len=1}], 1, 0) = 1',
      false,
    ],
    [
      'sendto(3, "x", 1, 0, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("203.0.113.9")}, 16) = 1',
      true,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
  // The channel and the operation are still recorded: only the verdict changes.
  const { events } = parseStraceLog(
    call(`recvfrom(${peer}, "x", 1, 0, NULL, NULL) = 1`),
    { allowed: ALLOWED },
  );
  assert.deepEqual(
    events.map((event) => [event.channel, event.operation]),
    [['network', 'recvfrom']],
  );
});

test('connect on a UDP socket sends no packet, but TCP connects and later sends are still judged', () => {
  const probe = (fd: string, address: string, tail = '= 0') =>
    `connect(${fd}, ${address}, 28) ${tail}`;
  const v6 =
    '{sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:4860:4860::8888", &sin6_addr), sin6_scope_id=0}';
  const v4 =
    '{sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("8.8.8.8")}';
  const cases: [string, boolean][] = [
    // Chromium's route discovery, as strace -yy decorates the unconnected fd.
    [probe('5<UDPv6:[123]>', v6), false],
    [probe('5<UDPv6:[123]>', v6, '= -1 ENETUNREACH (x)'), false],
    [probe('5<UDP:[0.0.0.0:48888]>', v4), false],
    [`connect(5<UDPv6:[123]>, ${v6} <unfinished ...>`, false],
    // Everything that does put a connection on the wire stays unexpected.
    [probe('5<TCPv6:[123]>', v6), true],
    [probe('5<TCP:[123]>', v4), true],
    [probe('5', v6), true],
    [probe('5<UNIX-STREAM:[123]>', v4), true],
    [probe('5<NETLINK:[ROUTE:1]>', v6), true],
    // A later send on the connected UDP socket is classified by its peer.
    [
      'sendto(5<UDPv6:[[2a01::1]:43791->[2001:4860:4860::8888]:443]>, "x", 1, 0, NULL, 0) = 1',
      true,
    ],
    [
      'sendto(5<UDP:[127.0.0.1:43791->127.0.0.53:53]>, "x", 1, 0, NULL, 0) = 1',
      false,
    ],
    ['sendto(5<UDP:[0.0.0.0:48888]>, "x", 1, 0, NULL, 0) = 1', true],
    [
      'sendto(5<UDPv6:[123]>, "x", 1, 0, {sa_family=AF_INET6, sin6_port=htons(443), inet_pton(AF_INET6, "2001:4860:4860::8888", &sin6_addr)}, 28) = 1',
      true,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('read-only runtime allowances cover the TLS stores, policy files and allocator hints seen on Linux', () => {
  const cases: [string, boolean][] = [
    ['openat(AT_FDCWD</>, "/etc/ssl/cert.pem", O_RDONLY) = 3', false],
    [
      'openat(AT_FDCWD</>, "/etc/ssl/certs/ca-certificates.crt", O_RDONLY) = 3',
      false,
    ],
    [
      'openat(AT_FDCWD</>, "/usr/share/ca-certificates/mozilla/ISRG_Root_X1.crt", O_RDONLY) = 3',
      false,
    ],
    [
      'openat(AT_FDCWD</>, "/etc/vscode/policy.json", O_RDONLY) = -1 ENOENT (x)',
      false,
    ],
    [
      'statx(AT_FDCWD</>, "/etc/github-copilot/managed-settings.json", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)',
      false,
    ],
    ['readlink("/etc/_rjem_malloc.conf", 0x7ffd, 4096) = -1 ENOENT (x)', false],
    ['readlink("/etc/malloc.conf", 0x7ffd, 4096) = -1 ENOENT (x)', false],
    ['open("/proc/sys/vm/overcommit_memory", O_RDONLY) = 3', false],
    [
      'open("/sys/kernel/mm/transparent_hugepage/enabled", O_RDONLY) = 3',
      false,
    ],
    // Read-only: no write, creation or removal below any of them.
    ['openat(AT_FDCWD</>, "/etc/ssl/cert.pem", O_WRONLY|O_TRUNC) = 3', true],
    ['openat(AT_FDCWD</>, "/etc/ssl/cert.pem", O_RDWR) = 3', true],
    ['unlink("/etc/ssl/cert.pem") = 0', true],
    [
      'openat(AT_FDCWD</>, "/usr/share/ca-certificates/x.crt", O_WRONLY|O_CREAT, 0644) = 3',
      true,
    ],
    ['open("/etc/vscode/policy.json", O_WRONLY|O_CREAT, 0644) = 3', true],
    ['open("/proc/sys/vm/overcommit_memory", O_WRONLY) = 3', true],
    [
      'open("/sys/kernel/mm/transparent_hugepage/enabled", O_WRONLY|O_TRUNC) = 3',
      true,
    ],
    // Specific files and directories, never their neighbours.
    ['openat(AT_FDCWD</>, "/etc/ssl/private/server.key", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/etc/ssl/openssl.cnf", O_RDONLY) = 3', true],
    ['openat(AT_FDCWD</>, "/usr/share/doc/x", O_RDONLY) = 3', true],
    ['open("/etc/vscode/other.json", O_RDONLY) = 3', true],
    ['open("/proc/sys/vm/swappiness", O_RDONLY) = 3', true],
    ['open("/sys/kernel/mm/ksm/run", O_RDONLY) = 3', true],
    ['open("/sys/kernel/mm/transparent_hugepage/defrag", O_RDONLY) = 3', true],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('host software may probe ignore files and node_modules in the ancestors of the allowed roots, read-only', () => {
  const cases: [string, boolean][] = [
    // ripgrep: ignore files and repository markers of every ancestor.
    ['stat("/work/.gitignore", {st_mode=S_IFREG|0644}) = 0', false],
    ['stat("/.gitignore", 0x7ffd) = -1 ENOENT (x)', false],
    ['stat("/.ignore", 0x7ffd) = -1 ENOENT (x)', false],
    ['stat("/work/.rgignore", 0x7ffd) = -1 ENOENT (x)', false],
    ['stat("/opt/.jj", 0x7ffd) = -1 ENOENT (x)', false],
    ['stat("/work/.git", 0x7ffd) = -1 ENOENT (x)', false],
    ['stat("/.git/info/exclude", 0x7ffd) = -1 ENOENT (x)', false],
    [
      'openat(AT_FDCWD</work/fixture>, "/work/.gitignore", O_RDONLY) = 3',
      false,
    ],
    [
      'openat(AT_FDCWD</work/fixture>, "/work/.git/info/exclude", O_RDONLY) = 3',
      false,
    ],
    // Writes, removals and every other name stay unexpected.
    [
      'openat(AT_FDCWD</work/fixture>, "/work/.gitignore", O_WRONLY|O_CREAT, 0644) = 3',
      true,
    ],
    [
      'openat(AT_FDCWD</work/fixture>, "/work/.git/info/exclude", O_RDWR) = 3',
      true,
    ],
    ['unlink("/work/.gitignore") = 0', true],
    ['rename("/work/.gitignore", "/work/fixture/x") = 0', true],
    [
      'openat(AT_FDCWD</work/fixture>, "/work/.git/config", O_RDONLY) = 3',
      true,
    ],
    ['openat(AT_FDCWD</work/fixture>, "/work/.git/HEAD", O_RDONLY) = 3', true],
    ['stat("/work/.gitconfig", 0x7ffd) = 0', true],
    ['stat("/work/gitignore", 0x7ffd) = 0', true],
    // Only ancestors of an allowed root, not arbitrary directories.
    ['stat("/etc/.gitignore", 0x7ffd) = -1 ENOENT (x)', true],
    ['stat("/work/other/.gitignore", 0x7ffd) = -1 ENOENT (x)', true],
    ['openat(AT_FDCWD</>, "/home/bob/.gitignore", O_RDONLY) = 3', true],
    // The denylist still wins.
    [`openat(AT_FDCWD</>, "${HOME}/.ssh/.gitignore", O_RDONLY) = 3`, true],
    // Node module resolution: metadata of node_modules/[@scope/]name only.
    [
      'statx(AT_FDCWD</>, "/node_modules/@vscode/ripgrep-universal", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)',
      false,
    ],
    [
      'statx(AT_FDCWD</>, "/opt/node_modules/@vscode/ripgrep-universal", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)',
      false,
    ],
    ['stat("/work/node_modules", 0x7ffd) = -1 ENOENT (x)', false],
    ['stat("/work/node_modules/left-pad", 0x7ffd) = -1 ENOENT (x)', false],
    [
      'openat(AT_FDCWD</>, "/opt/node_modules/@vscode/ripgrep-universal", O_RDONLY) = 3',
      true,
    ],
    [
      'stat("/opt/node_modules/@vscode/ripgrep-universal/package.json", 0x7ffd) = 0',
      true,
    ],
    ['stat("/etc/node_modules/left-pad", 0x7ffd) = -1 ENOENT (x)', true],
    ['stat("/work/other/node_modules/left-pad", 0x7ffd) = -1 ENOENT (x)', true],
    ['unlink("/work/node_modules/left-pad") = 0', true],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
  // With a read-only root, its ancestors are probed the same way.
  const withInstall = { ...ALLOWED, readOnly: ['/srv/ci/vscode-1.0'] };
  assert.equal(
    classify('stat("/srv/ci/.gitignore", 0x7ffd) = 0', withInstall),
    false,
  );
  assert.equal(
    classify(
      'stat("/srv/ci/node_modules/@vscode/ripgrep-universal", 0x7ffd) = 0',
      withInstall,
    ),
    false,
  );
  assert.equal(
    classify('stat("/srv/other/.gitignore", 0x7ffd) = 0', withInstall),
    true,
  );
});

test('user-level agent folders are probed by metadata only and argv.json is read-only', () => {
  const cases: [string, boolean][] = [
    [
      `statx(AT_FDCWD</>, "${HOME}/.claude", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      false,
    ],
    // Only the folders themselves: a stat of anything below them is unexpected.
    [
      `statx(AT_FDCWD</>, "${HOME}/.claude/skills", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      true,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.claude/settings.json", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      true,
    ],
    [`stat("${HOME}/.claude/.credentials.json", 0x7ffd) = 0`, true],
    [
      `statx(AT_FDCWD</>, "${HOME}/.copilot/mcp-config.json", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      true,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.agents/skills", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      true,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.copilot", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      false,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.agents", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      false,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.vscode/agent-plugins", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      false,
    ],
    [`access("${HOME}/.claude/agents", R_OK) = -1 ENOENT (x)`, true],
    // Contents may hold credentials: opening or changing anything there is unexpected.
    [
      `openat(AT_FDCWD</>, "${HOME}/.claude/.credentials.json", O_RDONLY) = 3`,
      true,
    ],
    [`openat(AT_FDCWD</>, "${HOME}/.copilot/config.json", O_RDONLY) = 3`, true],
    [`openat(AT_FDCWD</>, "${HOME}/.claude", O_RDONLY|O_DIRECTORY) = 3`, true],
    [`mkdir("${HOME}/.copilot/logs", 0755) = 0`, true],
    [`inotify_add_watch(5, "${HOME}/.claude/skills", IN_ALL_EVENTS) = 1`, true],
    // Other homes and sibling names are not covered.
    [
      'statx(AT_FDCWD</>, "/home/bob/.claude", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)',
      true,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.claudex", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      true,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.vscode/other", 0, STATX_ALL, 0x7ffd) = -1 ENOENT (x)`,
      true,
    ],
    // VS Code reads its runtime arguments; that file is read, never written.
    [
      `openat(AT_FDCWD</>, "${HOME}/.vscode/argv.json", O_RDONLY|O_CLOEXEC) = 3`,
      false,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.vscode/argv.json", 0, STATX_ALL, 0x7ffd) = 0`,
      false,
    ],
    [
      `openat(AT_FDCWD</>, "${HOME}/.vscode/argv.json", O_WRONLY|O_CREAT, 0644) = 3`,
      true,
    ],
    [`unlink("${HOME}/.vscode/argv.json") = 0`, true],
    [
      `openat(AT_FDCWD</>, "${HOME}/.vscode/extensions/x.js", O_RDONLY) = 3`,
      true,
    ],
    // fstat on the opened descriptor resolves to the same allowed file.
    [
      `newfstatat(3<${HOME}/.vscode/argv.json>, "", {st_mode=S_IFREG|0644}, AT_EMPTY_PATH) = 0`,
      false,
    ],
    // Credential stores and the config tree remain denied.
    [
      `statx(AT_FDCWD</>, "${HOME}/.ssh/id_rsa", 0, STATX_ALL, 0x7ffd) = 0`,
      true,
    ],
    [
      `statx(AT_FDCWD</>, "${HOME}/.config/git/config", 0, STATX_ALL, 0x7ffd) = 0`,
      true,
    ],
  ];
  for (const [text, expected] of cases)
    assert.equal(classify(text), expected, text);
});

test('plain relative paths resolve against the cwd the trace has shown for that pid, else fail closed', () => {
  const chdir = (path: string, tail = '= 0', pid = 900) =>
    `${pid} 1700000000.0 chdir("${path}") ${tail}`;
  const cases: [string, string, boolean][] = [
    // chdir into an allowed root: relative stats and opens resolve inside it.
    [
      chdir('/work/fixture'),
      'stat(".gitignore", 0x7ffd) = -1 ENOENT (x)',
      false,
    ],
    [chdir('/work/fixture'), 'open("./", O_RDONLY|O_DIRECTORY) = 3', false],
    [
      chdir('/work/fixture'),
      'stat("./.git/info/exclude", 0x7ffd) = -1 ENOENT (x)',
      false,
    ],
    [chdir('/work/fixture'), 'stat("./", 0x7ffd) = 0', false],
    // ... but a relative path that leaves the root is judged where it lands.
    [chdir('/work/fixture'), 'stat("../../etc/hostname", 0x7ffd) = 0', true],
    [chdir('/work/fixture'), 'open("../../etc/hostname", O_RDONLY) = 3', true],
    [
      chdir('/work/fixture'),
      'open("new.txt", O_WRONLY|O_CREAT, 0644) = 3',
      false,
    ],
    [
      chdir('/opt/vscode'),
      'open("new.txt", O_WRONLY|O_CREAT, 0644) = 3',
      false,
    ],
    // A cwd outside the roots, or a denied one, gives no allowance.
    [chdir('/etc'), 'open("hostname", O_RDONLY) = 3', true],
    [chdir(`${HOME}/.ssh`), 'open("id_rsa", O_RDONLY) = 3', true],
    // AT_FDCWD<dir> of an earlier call is the cwd too.
    [
      '900 1700000000.0 openat(AT_FDCWD</work/fixture>, "a", O_RDONLY) = 3',
      'stat("b", 0x7ffd) = 0',
      false,
    ],
    [
      '900 1700000000.0 openat(AT_FDCWD</etc>, "a", O_RDONLY) = 3',
      'stat("hostname", 0x7ffd) = 0',
      true,
    ],
    // A relative chdir is joined to the known cwd.
    [
      `${chdir('/work/fixture')}\n${chdir('sub')}`,
      'open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/work/fixture')}\n${chdir('../../etc')}`,
      'open("hostname", O_RDONLY) = 3',
      true,
    ],
    // A failed chdir keeps the previous cwd; an unfinished one is not provable.
    [
      `${chdir('/work/fixture')}\n${chdir('/etc', '= -1 EACCES (x)')}`,
      'open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/work/fixture')}\n900 1700000000.0 chdir("/etc" <unfinished ...>`,
      'open("x", O_RDONLY) = 3',
      true,
    ],
    // No cwd shown yet, or shown for another pid: fail closed.
    ['', 'open("x", O_RDONLY) = 3', true],
    [chdir('/work/fixture', '= 0', 901), 'open("x", O_RDONLY) = 3', true],
    // A child inherits the cwd of its parent at clone time.
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone3({flags=CLONE_VM}, 88) = 901`,
      '901 1700000000.2 open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/etc')}\n900 1700000000.1 clone3({flags=CLONE_VM}, 88) = 901`,
      '901 1700000000.2 open("x", O_RDONLY) = 3',
      true,
    ],
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone3({flags=CLONE_VM}, 88) = -1 EAGAIN (x)`,
      '901 1700000000.2 open("x", O_RDONLY) = 3',
      true,
    ],
    // CLONE_FS children share the parent's cwd: a chdir in either is seen by both.
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|CLONE_FS|SIGCHLD) = 901\n${chdir('/etc', '= 0', 901)}`,
      '900 1700000000.3 open("hostname", O_RDONLY) = 3',
      true,
    ],
    [
      `${chdir('/etc')}\n900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|CLONE_FS|SIGCHLD) = 901\n${chdir('/work/fixture', '= 0', 901)}`,
      '900 1700000000.3 open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/etc')}\n900 1700000000.1 clone3({flags=CLONE_VM|CLONE_THREAD|CLONE_FS}, 88) = 901\n${chdir('/work/fixture', '= 0', 901)}`,
      '900 1700000000.3 open("x", O_RDONLY) = 3',
      false,
    ],
    // Without CLONE_FS the child gets a copy: later chdirs stay private.
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD) = 901\n${chdir('/etc', '= 0', 901)}`,
      '900 1700000000.3 open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 fork() = 901\n${chdir('/etc', '= 0', 900)}`,
      '901 1700000000.3 open("x", O_RDONLY) = 3',
      false,
    ],
    // The child's lines may precede the parent's `clone resumed` line.
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD <unfinished ...>\n901 1700000000.15 getpid() = 901\n900 1700000000.2 <... clone resumed>) = 901`,
      '901 1700000000.3 open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/etc')}\n900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD <unfinished ...>\n${chdir('/work/fixture', '= 0', 901)}\n900 1700000000.2 <... clone resumed>) = 901`,
      '901 1700000000.3 open("x", O_RDONLY) = 3',
      false,
    ],
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|CLONE_FS|SIGCHLD <unfinished ...>\n${chdir('/etc', '= 0', 901)}\n900 1700000000.2 <... clone resumed>) = 901`,
      '900 1700000000.3 open("hostname", O_RDONLY) = 3',
      true,
    ],
    // A child of an unknown cwd (shared or copied) fails closed.
    [
      '900 1700000000.1 clone(child_stack=NULL, flags=CLONE_VM|CLONE_FS|SIGCHLD) = 901',
      '901 1700000000.3 open("x", O_RDONLY) = 3',
      true,
    ],
    [
      '900 1700000000.1 clone(child_stack=NULL, flags=SIGCHLD <unfinished ...>\n900 1700000000.2 <... clone resumed>) = 901',
      '901 1700000000.3 open("x", O_RDONLY) = 3',
      true,
    ],
    // Unreadable clone flags: the child's cwd is unknown, never copied.
    [
      `${chdir('/work/fixture')}\n900 1700000000.1 clone3(0x7ffd1234, 88) = 901`,
      '901 1700000000.3 open("x", O_RDONLY) = 3',
      true,
    ],
    // An empty path is not a plain relative path.
    [chdir('/work/fixture'), 'stat("", 0x7ffd) = -1 ENOENT (x)', true],
  ];
  for (const [extra, text, expected] of cases) {
    const line = /^\d+ /.test(text) ? text : call(text);
    const { events } = parseStraceLog(
      [extra, line].filter(Boolean).join('\n'),
      {
        allowed: ALLOWED,
      },
    );
    assert.equal(events.at(-1)?.unexpected, expected, `${extra} => ${text}`);
  }
});
