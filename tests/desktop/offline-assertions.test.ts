import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOOPBACK_SCOPE,
  REPORT_ATTRIBUTION_SCOPE,
  REPORT_ZERO_SCOPE,
  cleanWindowFailures,
  extensionAssetPath,
  extensionAssetRoots,
  summarizeEvents,
  unclassifiedNetworkEvents,
} from './offline-assertions.js';
import {
  SEMANTIC_PROOF_LIMITATION,
  unexpectedEvents,
  type SecurityCapability,
  type SecurityEvent,
  type SecurityObservation,
} from './security-observer.js';

const CANARY = 'rdlc-canary-deadbeef.dat';

const controls = {
  network: true,
  file: true,
  exec: true,
  process: true,
  shortLived: true,
} as const;

const capability: SecurityCapability = {
  platform: 'linux',
  native: {
    platform: 'linux',
    tool: 'strace',
    version: 'test',
    launch: { supported: true, reason: 'positive control', controls },
    attach: { supported: true, reason: 'positive control', controls },
  },
  webview: {
    supported: true,
    scope: 'positive control',
    reason: 'positive control',
  },
  semantic: {
    resource: 'not-observable',
    query: 'not-observable',
    entity: 'not-observable',
  },
  limitations: [SEMANTIC_PROOF_LIMITATION],
};

const benignFile: SecurityEvent = {
  atMs: 1_700_000_000_000,
  source: 'host-process-tree',
  channel: 'file',
  operation: 'openat',
  outcome: 'succeeded',
  pid: 100,
  target: '/workspace/preserved.rdlc',
  error: null,
  unexpected: false,
};

/** An outgoing connect whose classification is missing entirely. */
const unclassifiedConnect: SecurityEvent = {
  atMs: 1_700_000_001_000,
  source: 'host-process-tree',
  channel: 'network',
  operation: 'connect',
  outcome: 'failed',
  pid: 101,
  target: '203.0.113.9:443',
  error: 'ECONNREFUSED',
};

function observationOf(events: readonly SecurityEvent[]): SecurityObservation {
  return {
    startedAt: '2026-10-25T00:00:00.000Z',
    stoppedAt: '2026-10-25T00:00:01.000Z',
    durationMs: 1_000,
    capability,
    native: {
      mode: 'attach',
      state: 'observed',
      reason: null,
      requestedPids: [100],
      attachedPids: [100],
      attachFailures: [],
      truncated: false,
      timedOut: false,
      events,
    },
    webview: { state: 'observed', reason: null, truncated: false, events: [] },
    events,
    captureComplete: true,
    failures: [],
    limitations: [SEMANTIC_PROOF_LIMITATION],
  };
}

const windowOf = (events: readonly SecurityEvent[]) => ({
  observation: observationOf(events),
  reportRequests: [] as readonly string[],
});

test('a genuinely quiet window with no network event is clean, so network traffic is never required', () => {
  assert.deepEqual(
    cleanWindowFailures('control', windowOf([benignFile]), CANARY),
    [],
  );
});

test('an outgoing connect with no classification fails closed, so the clean result is not vacuous', () => {
  const clean = windowOf([benignFile]);
  assert.deepEqual(cleanWindowFailures('control', clean, CANARY), []);

  const failures = cleanWindowFailures(
    'control',
    windowOf([benignFile, unclassifiedConnect]),
    CANARY,
  );
  assert.equal(failures.length, 1, failures.join(' '));
  assert.match(failures[0]!, /unclassified outgoing network attempt/);
  assert.equal(unclassifiedNetworkEvents([unclassifiedConnect]).length, 1);
  // The shared oracle alone would drop it, which is exactly why the window
  // check fails closed instead of trusting the oracle to be complete.
  assert.equal(unexpectedEvents([unclassifiedConnect]).length, 0);
});

test('sendmmsg without a classification is an unclassified outgoing attempt', () => {
  const sendmmsg: SecurityEvent = {
    ...unclassifiedConnect,
    operation: 'sendmmsg',
  };
  assert.equal(unclassifiedNetworkEvents([sendmmsg]).length, 1);
});

test('the recorded scope statements never claim absolute proof', () => {
  assert.match(LOOPBACK_SCOPE, /expected host runtime traffic/);
  assert.match(
    LOOPBACK_SCOPE,
    /proves neither host blocking nor report attribution/,
  );
  assert.match(REPORT_ATTRIBUTION_SCOPE, /no-attribution gap/);
  assert.match(REPORT_ZERO_SCOPE, /never absolute proof/);
});

const EXT = '/work/RDLC/apps/vscode-extension';
const ASSET_HOST = 'https://file+.vscode-resource.vscode-cdn.net';

test('only the extension build/designer bundle is an extension asset', () => {
  const roots = extensionAssetRoots([EXT, '/work/RDLC/tests/vscode/harness']);
  const asset = (path: string, host = ASSET_HOST) =>
    extensionAssetPath(`${host}${path}`, roots);
  assert.equal(
    asset(`${EXT}/build/designer/assets/index-abc.js`),
    'build/designer/assets/index-abc.js',
  );
  assert.equal(
    asset(`${EXT}/build/designer/index.html?x=1#y`),
    'build/designer/index.html',
  );
  assert.equal(
    asset('/work/RDLC/tests/vscode/harness/build/designer/a.css'),
    'build/designer/a.css',
  );
  assert.equal(
    asset(`${EXT}/build/designer/fonts/a%20b.woff2`),
    'build/designer/fonts/a b.woff2',
  );
  // The older percent-encoded authority is the same scheme.
  assert.notEqual(
    asset(
      `${EXT}/build/designer/a.js`,
      'https://file%2B.vscode-resource.vscode-cdn.net',
    ),
    null,
  );
  // Anything else stays report traffic: fixture dirs, images, data, siblings.
  for (const path of [
    '/work/fixture/logo.png',
    '/work/fixture/report.rdlc',
    `${EXT}/build/designer`,
    `${EXT}/build/designer/`,
    `${EXT}/build/designer-evil/a.js`,
    `${EXT}/build/other/a.js`,
    `${EXT}/media/rdlc-file-dark.svg`,
    `${EXT}/package.json`,
    '/',
    '',
  ])
    assert.equal(asset(path), null, path);
  // Traversal, encoded traversal, backslashes and NUL never escape the root.
  for (const path of [
    `${EXT}/build/designer/../../../../fixture/logo.png`,
    `${EXT}/build/designer/%2e%2e/%2e%2e/secret.png`,
    `${EXT}/build/designer/..%2f..%2fsecret.png`,
    `${EXT}/build/designer/a%5Cb.js`,
    `${EXT}/build/designer/a%00.js`,
    `${EXT}/build/designer/%E0%A4%A.js`,
  ])
    assert.equal(asset(path), null, path);
  // Other hosts and schemes never qualify, even with an extension path.
  for (const url of [
    `https://example.com${EXT}/build/designer/a.js`,
    `https://file+.vscode-resource.vscode-cdn.net.evil.com${EXT}/build/designer/a.js`,
    `https://evil.com/file+.vscode-resource.vscode-cdn.net${EXT}/build/designer/a.js`,
    `http://file+.vscode-resource.vscode-cdn.net${EXT}/build/designer/a.js`,
    `file://${EXT}/build/designer/a.js`,
    'not a url',
  ])
    assert.equal(extensionAssetPath(url, roots), null, url);
  // No loaded extension means nothing is exempt.
  assert.equal(
    extensionAssetPath(`${ASSET_HOST}${EXT}/build/designer/a.js`, []),
    null,
  );
});

test('a Windows drive path is matched case-insensitively and fails closed otherwise', () => {
  const roots = extensionAssetRoots(['C:\\work\\ext']);
  assert.equal(
    extensionAssetPath(
      `${ASSET_HOST}/c%3A/work/ext/build/designer/a.js`,
      roots,
    ),
    'build/designer/a.js',
  );
  assert.equal(
    extensionAssetPath(`${ASSET_HOST}/c%3A/work/other/a.js`, roots),
    null,
  );
});

test('event summaries list every distinct event with counts instead of the first five', () => {
  const event = (target: string): SecurityEvent => ({
    ...unclassifiedConnect,
    channel: 'file',
    operation: 'statx',
    target,
  });
  const many = [
    ...Array.from({ length: 50 }, () => event('<path>/.vscode-cli')),
    ...Array.from({ length: 8 }, (_, index) => event(`/x/${index}`)),
  ];
  const summary = summarizeEvents(many);
  assert.match(summary, /file:statx:<path>\/\.vscode-cli \(x50\)/);
  assert.match(summary, /file:statx:\/x\/7/);
  assert.equal(summarizeEvents([]), 'none');
  const wide = Array.from({ length: 70 }, (_, index) => event(`/y/${index}`));
  assert.match(summarizeEvents(wide), /and 10 more distinct event\(s\)$/);
});
