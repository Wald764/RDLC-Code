import assert from 'node:assert/strict';

type Destination = 'github' | 'marketplace' | 'openvsx';
export interface DestinationInventory {
  destination: Destination;
  configured: boolean;
  exists: boolean;
  remoteDigest?: string;
  acknowledgedDigest?: string;
}
export function recoveryPlan(
  inventory: readonly DestinationInventory[],
  context: {
    digest: string;
    ageDays: number;
    attempt: number;
    provenanceAvailable: boolean;
    artifactAvailable: boolean;
  },
): {
  destination: Destination;
  status: 'succeeded' | 'pending' | 'not-configured';
}[] {
  assert.match(context.digest, /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isFinite(context.ageDays) &&
      context.ageDays >= 0 &&
      context.ageDays <= 30,
    'Recovery is outside the rerun window',
  );
  assert.ok(
    Number.isInteger(context.attempt) &&
      context.attempt >= 1 &&
      context.attempt <= 50,
    'Rerun attempt limit exceeded',
  );
  assert.ok(
    context.provenanceAvailable && context.artifactAvailable,
    'Canonical bytes and original provenance are required; do not rebuild',
  );
  assert.deepEqual(
    inventory.map((entry) => entry.destination).sort(),
    ['github', 'marketplace', 'openvsx'],
    'Inventory every destination exactly once before writes',
  );
  return inventory.map((entry) => {
    if (!entry.configured) {
      assert.equal(
        entry.destination,
        'openvsx',
        'Required destination is not configured',
      );
      return { destination: entry.destination, status: 'not-configured' };
    }
    for (const digest of [entry.remoteDigest, entry.acknowledgedDigest])
      if (digest !== undefined)
        assert.equal(
          digest,
          context.digest,
          `Conflict at ${entry.destination}: artifact differs`,
        );
    if (entry.exists)
      assert.ok(
        entry.remoteDigest === context.digest ||
          entry.acknowledgedDigest === context.digest,
        `Conflict at ${entry.destination}: existing version has no canonical association`,
      );
    else
      assert.ok(
        !entry.acknowledgedDigest && !entry.remoteDigest,
        `Inconsistent inventory at ${entry.destination}`,
      );
    return {
      destination: entry.destination,
      status: entry.exists ? 'succeeded' : 'pending',
    };
  });
}
