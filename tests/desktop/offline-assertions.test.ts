import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOOPBACK_SCOPE,
  REPORT_ATTRIBUTION_SCOPE,
  REPORT_ZERO_SCOPE,
  cleanWindowFailures,
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

test('the recorded scope statements never claim absolute proof', () => {
  assert.match(LOOPBACK_SCOPE, /expected host runtime traffic/);
  assert.match(
    LOOPBACK_SCOPE,
    /proves neither host blocking nor report attribution/,
  );
  assert.match(REPORT_ATTRIBUTION_SCOPE, /no-attribution gap/);
  assert.match(REPORT_ZERO_SCOPE, /never absolute proof/);
});
