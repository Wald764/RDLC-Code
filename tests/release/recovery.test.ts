import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPlan } from '../../scripts/verify-release.js';

test('inventory all destinations before writes; only canonical acknowledged or byte-proven successes are reused', () => {
  const digest = 'a'.repeat(64);
  const destinations = ['github', 'marketplace', 'openvsx'] as const;
  const absent = destinations.map((destination) => ({
    destination,
    configured: true,
    exists: false,
  }));
  const context = {
    digest,
    ageDays: 1,
    attempt: 2,
    provenanceAvailable: true,
    artifactAvailable: true,
  };
  assert.deepEqual(
    recoveryPlan(absent, context).map((entry) => entry.status),
    ['pending', 'pending', 'pending'],
  );
  for (let completed = 1; completed <= 3; completed++) {
    const inventory = absent.map((entry, index) =>
      index < completed
        ? { ...entry, exists: true, acknowledgedDigest: digest }
        : entry,
    );
    assert.deepEqual(
      recoveryPlan(inventory, context).map((entry) => entry.status),
      destinations.map((_, index) =>
        index < completed ? 'succeeded' : 'pending',
      ),
    );
  }
  assert.throws(() => recoveryPlan(absent.slice(1), context));
  assert.throws(() => recoveryPlan([...absent, absent[0]!], context));
  assert.throws(() =>
    recoveryPlan(
      absent.map((entry) => ({ ...entry, exists: true })),
      context,
    ),
  );
  assert.throws(() =>
    recoveryPlan(
      absent.map((entry) => ({
        ...entry,
        exists: true,
        remoteDigest: 'b'.repeat(64),
      })),
      context,
    ),
  );
  for (const change of [
    { ageDays: 31 },
    { attempt: 51 },
    { provenanceAvailable: false },
    { artifactAvailable: false },
  ])
    assert.throws(() => recoveryPlan(absent, { ...context, ...change }));
  assert.equal(
    recoveryPlan(
      absent.map((entry) =>
        entry.destination === 'openvsx'
          ? { ...entry, configured: false }
          : entry,
      ),
      context,
    )[2]?.status,
    'not-configured',
  );
  assert.equal(
    recoveryPlan(
      absent.map((entry) => ({ ...entry, exists: true, remoteDigest: digest })),
      context,
    )[0]?.status,
    'succeeded',
  );
});
