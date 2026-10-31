import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withRetries } from './download-vscode.js';

const quiet = { log: () => {}, sleep: async () => {} };

test('a download that succeeds on the third attempt is retried with backoff', async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await withRetries(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('ETIMEDOUT');
      return 'ok';
    },
    {
      log: () => {},
      backoffMs: [10, 20],
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test('the last failure is rethrown after the attempts are used', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(async () => {
      calls += 1;
      throw new Error(`failure ${calls}`);
    }, quiet),
    /failure 3/,
  );
  assert.equal(calls, 3);
});

test('a first success never waits', async () => {
  let slept = false;
  await withRetries(async () => 1, {
    log: () => {},
    sleep: async () => {
      slept = true;
    },
  });
  assert.equal(slept, false);
});
